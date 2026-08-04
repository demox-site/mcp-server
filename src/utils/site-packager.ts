import fs from "fs";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";
import AdmZip from "adm-zip";

export const SUPPORTED_DOC_EXTENSIONS = [".md", ".markdown", ".txt", ".doc", ".docx"];
export const SUPPORTED_PDF_EXTENSIONS = [".pdf"];
export const DOC_TEMPLATE_IDS = ["insight", "warm", "dark"] as const;

type DocTemplateId = (typeof DOC_TEMPLATE_IDS)[number];

export interface SiteZipResult {
  zipFilePath: string;
  title: string;
}

export function extOf(filePath: string): string {
  return path.extname(filePath || "").toLowerCase();
}

export function isSupportedDocPath(filePath: string): boolean {
  return SUPPORTED_DOC_EXTENSIONS.includes(extOf(filePath));
}

export function isSupportedPdfPath(filePath: string): boolean {
  return SUPPORTED_PDF_EXTENSIONS.includes(extOf(filePath));
}

function stripExt(name: string): string {
  const base = path.basename(name || "");
  const ext = path.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

function escapeHtml(input: string): string {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(input: string): string {
  return escapeHtml(input).replace(/'/g, "&#39;");
}

function safeSlug(name: string, fallback = "document"): string {
  return stripExt(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || fallback;
}

function tempZipPath(prefix: string): string {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${randomUUID()}.zip`);
}

function sanitizeHtml(html: string): string {
  return String(html || "")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\s(href|src)\s*=\s*(['"])\s*javascript:.*?\2/gi, "");
}

function applyInlineMarkdown(input: string): string {
  return escapeHtml(input)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      (_match, text, url) =>
        `<a href="${escapeAttr(url)}" target="_blank" rel="noopener">${text}</a>`
    );
}function isMarkdownTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes("|") && /^\|?.+\|.+\|?$/.test(trimmed);
}

function isMarkdownTableDelimiter(line: string): boolean {
  const cells = splitMarkdownTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function splitMarkdownTableRow(line: string): string[] {
  let trimmed = line.trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
  return trimmed.split("|").map((cell) => cell.trim());
}

function tableAlignments(delimiterLine: string): Array<"left" | "center" | "right" | undefined> {
  return splitMarkdownTableRow(delimiterLine).map((cell) => {
    const trimmed = cell.trim();
    if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
    if (trimmed.endsWith(":")) return "right";
    return undefined;
  });
}

function renderTableCell(tag: "th" | "td", value: string, align?: "left" | "center" | "right"): string {
  const alignAttr = align ? ` style="text-align:${align}"` : "";
  return `<${tag}${alignAttr}>${applyInlineMarkdown(value)}</${tag}>`;
}

function renderMarkdownTable(headerLine: string, delimiterLine: string, bodyLines: string[]): string {
  const headers = splitMarkdownTableRow(headerLine);
  const aligns = tableAlignments(delimiterLine);
  const thead = `<thead><tr>${headers.map((cell, index) => renderTableCell("th", cell, aligns[index])).join("")}</tr></thead>`;
  const rows = bodyLines
    .map((line) => {
      const cells = splitMarkdownTableRow(line);
      return `<tr>${headers.map((_header, index) => renderTableCell("td", cells[index] || "", aligns[index])).join("")}</tr>`;
    })
    .join("");
  return `<table>${thead}${rows ? `<tbody>${rows}</tbody>` : ""}</table>`;
}

function markdownToHtml(markdown: string): string {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html: string[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let ordered = false;
  let inCode = false;
  let codeLines: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    html.push(`<p>${applyInlineMarkdown(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (listItems.length === 0) return;
    html.push(`<${ordered ? "ol" : "ul"}>${listItems.join("")}</${ordered ? "ol" : "ul"}>`);
    listItems = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
        inCode = false;
      } else {
        flushParagraph();
        flushList();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushParagraph();
      flushList();
      html.push("<hr />");
      continue;
    }

    if (isMarkdownTableRow(trimmed) && lines[i + 1] && isMarkdownTableDelimiter(lines[i + 1])) {
      flushParagraph();
      flushList();
      const delimiterLine = lines[i + 1];
      const bodyLines: string[] = [];
      i += 2;
      while (i < lines.length && isMarkdownTableRow(lines[i]) && !isMarkdownTableDelimiter(lines[i])) {
        bodyLines.push(lines[i]);
        i += 1;
      }
      i -= 1;
      html.push(renderMarkdownTable(trimmed, delimiterLine, bodyLines));
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      flushList();
      const level = heading[1].length;
      html.push(`<h${level}>${applyInlineMarkdown(heading[2])}</h${level}>`);
      continue;
    }

    const unorderedMatch = /^[-*+]\s+(.+)$/.exec(trimmed);
    const orderedMatch = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (unorderedMatch || orderedMatch) {
      flushParagraph();
      const nextOrdered = Boolean(orderedMatch);
      if (listItems.length > 0 && ordered !== nextOrdered) flushList();
      ordered = nextOrdered;
      listItems.push(`<li>${applyInlineMarkdown((unorderedMatch || orderedMatch)![1])}</li>`);
      continue;
    }

    const quote = /^>\s+(.+)$/.exec(trimmed);
    if (quote) {
      flushParagraph();
      flushList();
      html.push(`<blockquote><p>${applyInlineMarkdown(quote[1])}</p></blockquote>`);
      continue;
    }

    paragraph.push(trimmed);
  }

  if (inCode) html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  flushParagraph();
  flushList();
  return html.join("\n");
}

function textToHtml(text: string): string {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br />")}</p>`)
    .join("\n");
}

function extractTitleFromHtml(html: string): string {
  const match = /<h[1-3][^>]*>(.*?)<\/h[1-3]>/i.exec(html);
  if (!match) return "";
  return match[1].replace(/<[^>]+>/g, "").trim();
}

function stripTags(html: string): string {
  return String(html || "").replace(/<[^>]+>/g, "").trim();
}

function slugifyHeading(text: string): string {
  const slug = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w\u4e00-\u9fff-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "section";
}

/** 给正文标题补 id，并生成目录 HTML（与 Web 端行为一致） */
function enrichBodyWithToc(html: string): { bodyHtml: string; tocHtml: string } {
  const used = new Set<string>();
  const items: Array<{ level: number; text: string; id: string }> = [];

  const uniqueSlug = (text: string) => {
    const base = slugifyHeading(text);
    let slug = base;
    let i = 2;
    while (used.has(slug)) slug = `${base}-${i++}`;
    used.add(slug);
    return slug;
  };

  const bodyHtml = String(html || "").replace(
    /<h([1-6])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi,
    (match, levelStr: string, attrs = "", inner: string) => {
      const text = stripTags(inner);
      if (!text) return match;

      const existing = /\sid\s*=\s*["']([^"']+)["']/i.exec(attrs || "");
      let id: string;
      if (existing) {
        id = existing[1];
        used.add(id);
      } else {
        id = uniqueSlug(text);
      }

      items.push({ level: Number(levelStr), text, id });
      if (existing) return match;
      return `<h${levelStr}${attrs} id="${id}">${inner}</h${levelStr}>`;
    }
  );

  let tocItems = items;
  if (tocItems.length && tocItems[0].level === 1) tocItems = tocItems.slice(1);
  if (tocItems.length < 2) return { bodyHtml, tocHtml: "" };

  const minLevel = Math.min(...tocItems.map((item) => item.level));
  const tocHtml = `<ul class="doc-toc-list">
${tocItems
  .map(
    (item) =>
      `<li class="doc-toc-item level-${item.level - minLevel}"><a href="#${escapeAttr(item.id)}">${escapeHtml(item.text)}</a></li>`
  )
  .join("\n")}
</ul>`;

  return { bodyHtml, tocHtml };
}

function normalizeTemplateId(templateId?: string): DocTemplateId {
  return DOC_TEMPLATE_IDS.includes(templateId as DocTemplateId)
    ? (templateId as DocTemplateId)
    : "insight";
}

function renderDocHtml({ title, bodyHtml, tocHtml = "", templateId }: {
  title: string;
  bodyHtml: string;
  tocHtml?: string;
  templateId?: string;
}): string {
  const template = normalizeTemplateId(templateId);
  const hasToc = Boolean(tocHtml);
  const themes: Record<DocTemplateId, string> = {
    insight: `
      --bg:#ffffff; --fg:#27272a; --heading:#18181b; --muted:#71717a;
      --border:#e4e4e7; --accent:#2563eb; --card:#fafafa; --font: "Avenir Next", "Gill Sans", "PingFang SC", sans-serif;`,
    warm: `
      --bg:#fbf7f0; --fg:#463f35; --heading:#3a2f24; --muted:#8a7b68;
      --border:#e8ddcb; --accent:#d97706; --card:#f5ecdd; --font: Georgia, "Songti SC", serif;`,
    dark: `
      --bg:#0a0a0b; --fg:#d4d4d8; --heading:#fafafa; --muted:#a1a1aa;
      --border:#27272a; --accent:#a3e635; --card:#18181b; --font: "IBM Plex Sans", "Avenir Next", "PingFang SC", sans-serif;`
  };

  const tocBlock = hasToc
    ? `<aside class="doc-toc" aria-label="目录">
<details class="doc-toc-panel" open>
<summary class="doc-toc-summary">目录</summary>
<nav class="doc-toc-nav">
<p class="doc-toc-label">目录</p>
${tocHtml}
</nav>
</details>
</aside>`
    : "";

  const tocScript = hasToc
    ? `<script>
(function () {
  var links = document.querySelectorAll(".doc-toc-list a");
  if (!links.length) return;
  var map = [];
  links.forEach(function (a) {
    var href = a.getAttribute("href") || "";
    if (href.charAt(0) !== "#") return;
    var el = document.getElementById(decodeURIComponent(href.slice(1)));
    if (el) map.push({ el: el, a: a });
  });
  if (!map.length) return;
  function onScroll() {
    var y = window.scrollY + 96;
    var current = map[0].a;
    for (var i = 0; i < map.length; i++) {
      if (map[i].el.offsetTop <= y) current = map[i].a;
    }
    links.forEach(function (a) {
      a.classList.toggle("is-active", a === current);
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
})();
</script>`
    : "";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>
:root { ${themes[template]} }
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: var(--font);
  line-height: 1.75;
  color: var(--fg);
  background: var(--bg);
}
.doc-layout {
  max-width: 760px;
  margin: 0 auto;
  padding: clamp(2.5rem, 6vw, 5rem) clamp(1.2rem, 5vw, 2rem) 4rem;
}
.has-toc .doc-layout { max-width: calc(760px + 14rem); }
.doc { min-width: 0; }
h1, h2, h3, h4, h5, h6 { color: var(--heading); line-height: 1.25; scroll-margin-top: 1.25rem; }
.doc-title { font-size: clamp(2rem, 5vw, 3rem); margin: 0 0 2rem; letter-spacing: -0.03em; }
article h2 { border-bottom: 1px solid var(--border); padding-bottom: .35rem; }
a { color: var(--accent); }
blockquote { margin: 1.5rem 0; padding: .3rem 1rem; border-left: 4px solid var(--accent); background: var(--card); color: var(--muted); }
code { background: var(--card); padding: .15rem .35rem; border-radius: 4px; }
pre { background: var(--card); padding: 1rem; overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; }
hr { border: 0; border-top: 1px solid var(--border); margin: 2.5rem 0; }
table { width: 100%; border-collapse: collapse; margin: 1.5rem 0; font-size: .95em; display: block; overflow-x: auto; }
th, td { border: 1px solid var(--border); padding: .55rem .8rem; text-align: left; vertical-align: top; }
th { background: var(--card); color: var(--heading); font-weight: 700; }
img { max-width: 100%; height: auto; }
footer { margin-top: 4rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--muted); font-size: .85rem; }
.doc-toc { margin: 0 0 1.75rem; }
.doc-toc-panel { border: 1px solid var(--border); border-radius: 10px; background: var(--card); padding: .15rem .9rem .75rem; }
.doc-toc-summary { cursor: pointer; list-style: none; font-size: .85rem; font-weight: 650; color: var(--heading); padding: .7rem 0 .35rem; user-select: none; }
.doc-toc-summary::-webkit-details-marker { display: none; }
.doc-toc-summary::before { content: "›"; display: inline-block; margin-right: .45rem; color: var(--muted); }
.doc-toc-panel[open] > .doc-toc-summary::before { transform: rotate(90deg); }
.doc-toc-label { display: none; margin: 0 0 .65rem; font-size: .72rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
.doc-toc-list { list-style: none; margin: 0; padding: 0; }
.doc-toc-item { margin: 0; }
.doc-toc-item a { display: block; padding: .28rem 0 .28rem .65rem; font-size: .9rem; line-height: 1.4; color: var(--muted); text-decoration: none; border-left: 2px solid transparent; }
.doc-toc-item a:hover { color: var(--heading); }
.doc-toc-item a.is-active { color: var(--heading); border-left-color: var(--accent); font-weight: 600; }
.doc-toc-item.level-1 a { padding-left: 1.25rem; font-size: .86rem; }
.doc-toc-item.level-2 a { padding-left: 1.85rem; font-size: .84rem; }
.doc-toc-item.level-3 a, .doc-toc-item.level-4 a, .doc-toc-item.level-5 a { padding-left: 2.4rem; font-size: .82rem; }
@media (min-width: 1100px) {
  .has-toc .doc-layout { display: grid; grid-template-columns: 12.5rem minmax(0, 760px); gap: 2.5rem; align-items: start; justify-content: center; }
  .doc-toc { margin: 0; position: sticky; top: 2rem; max-height: calc(100vh - 4rem); overflow: auto; }
  .doc-toc-panel { border: none; background: transparent; border-radius: 0; padding: 0; }
  .doc-toc-summary { display: none; }
  .doc-toc-label { display: block; }
  .doc-toc-nav { display: block !important; }
}
</style>
</head>
<body class="${hasToc ? "has-toc" : ""}">
<div class="doc-layout">
${tocBlock}
<main class="doc">
<h1 class="doc-title">${escapeHtml(title)}</h1>
<article>
${bodyHtml}
</article>
<footer>由 <a href="https://demox.site" target="_blank" rel="noopener">demox</a> 部署</footer>
</main>
</div>
${tocScript}
</body>
</html>`;
}

function renderPdfHtml(title: string, pdfName: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { display: flex; flex-direction: column; background: #525659; font-family: "Avenir Next", "PingFang SC", sans-serif; }
.bar { display: flex; align-items: center; gap: 1rem; padding: .65rem 1rem; background: #1f2023; color: #e4e4e7; }
.title { font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.actions { margin-left: auto; display: flex; gap: .5rem; }
.actions a { color: #e4e4e7; text-decoration: none; border: 1px solid #3f3f46; border-radius: 6px; padding: .35rem .75rem; font-size: .85rem; }
iframe { flex: 1; width: 100%; border: 0; }
footer { padding: .45rem; text-align: center; background: #1f2023; color: #a1a1aa; font-size: .75rem; }
footer a { color: #a1a1aa; }
</style>
</head>
<body>
<div class="bar">
  <span class="title">${escapeHtml(title)}</span>
  <span class="actions">
    <a href="${escapeAttr(pdfName)}" target="_blank" rel="noopener">在新标签打开</a>
    <a href="${escapeAttr(pdfName)}" download>下载</a>
  </span>
</div>
<iframe src="${escapeAttr(pdfName)}" title="${escapeAttr(title)}"></iframe>
<footer>由 <a href="https://demox.site" target="_blank" rel="noopener">demox</a> 部署</footer>
</body>
</html>`;
}

export async function buildDocumentSiteZip(filePath: string, templateId?: string): Promise<SiteZipResult> {
  const ext = extOf(filePath);
  let rawHtml = "";

  if (ext === ".md" || ext === ".markdown") {
    rawHtml = markdownToHtml(fs.readFileSync(filePath, "utf8"));
  } else if (ext === ".txt") {
    rawHtml = textToHtml(fs.readFileSync(filePath, "utf8"));
  } else if (ext === ".docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.convertToHtml({ path: filePath });
    rawHtml = result.value || "";
  } else if (ext === ".doc") {
    throw new Error("旧版 .doc 暂不支持，请另存为 .docx 后重试");
  } else {
    throw new Error("不支持的文档格式");
  }

  const cleaned = sanitizeHtml(rawHtml);
  const title = extractTitleFromHtml(cleaned) || stripExt(filePath) || "document";
  const { bodyHtml, tocHtml } = enrichBodyWithToc(cleaned);
  const html = renderDocHtml({ title, bodyHtml, tocHtml, templateId });
  const zip = new AdmZip();
  (zip as any).addFile("index.html", Buffer.from(html, "utf8"));

  const zipFilePath = tempZipPath(`demox-doc-${safeSlug(filePath, "doc")}`);
  zip.writeZip(zipFilePath);
  return { zipFilePath, title };
}

export async function buildPdfSiteZip(filePath: string): Promise<SiteZipResult> {
  const title = stripExt(filePath) || "document";
  const pdfName = `${safeSlug(filePath, "document")}.pdf`;
  const html = renderPdfHtml(title, pdfName);
  const zip = new AdmZip();
  (zip as any).addFile("index.html", Buffer.from(html, "utf8"));
  (zip as any).addFile(pdfName, fs.readFileSync(filePath));

  const zipFilePath = tempZipPath(`demox-pdf-${safeSlug(filePath, "pdf")}`);
  zip.writeZip(zipFilePath);
  return { zipFilePath, title };
}
