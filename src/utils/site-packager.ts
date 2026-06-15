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

  for (const line of lines) {
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

function normalizeTemplateId(templateId?: string): DocTemplateId {
  return DOC_TEMPLATE_IDS.includes(templateId as DocTemplateId)
    ? (templateId as DocTemplateId)
    : "insight";
}

function renderDocHtml({ title, bodyHtml, templateId }: {
  title: string;
  bodyHtml: string;
  templateId?: string;
}): string {
  const template = normalizeTemplateId(templateId);
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

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(title)}</title>
<style>
:root { ${themes[template]} }
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: var(--font);
  line-height: 1.75;
  color: var(--fg);
  background: var(--bg);
}
main {
  max-width: 760px;
  margin: 0 auto;
  padding: clamp(2.5rem, 6vw, 5rem) clamp(1.2rem, 5vw, 2rem) 4rem;
}
h1, h2, h3, h4, h5, h6 { color: var(--heading); line-height: 1.25; }
.doc-title { font-size: clamp(2rem, 5vw, 3rem); margin: 0 0 2rem; letter-spacing: -0.03em; }
article h2 { border-bottom: 1px solid var(--border); padding-bottom: .35rem; }
a { color: var(--accent); }
blockquote { margin: 1.5rem 0; padding: .3rem 1rem; border-left: 4px solid var(--accent); background: var(--card); color: var(--muted); }
code { background: var(--card); padding: .15rem .35rem; border-radius: 4px; }
pre { background: var(--card); padding: 1rem; overflow-x: auto; border: 1px solid var(--border); border-radius: 10px; }
img { max-width: 100%; height: auto; }
footer { margin-top: 4rem; padding-top: 1rem; border-top: 1px solid var(--border); color: var(--muted); font-size: .85rem; }
</style>
</head>
<body>
<main>
<h1 class="doc-title">${escapeHtml(title)}</h1>
<article>
${bodyHtml}
</article>
<footer>由 <a href="https://demox.site" target="_blank" rel="noopener">demox</a> 部署</footer>
</main>
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

  const bodyHtml = sanitizeHtml(rawHtml);
  const title = extractTitleFromHtml(bodyHtml) || stripExt(filePath) || "document";
  const html = renderDocHtml({ title, bodyHtml, templateId });
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
