import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { uploadFileInChunks } from "./chunked-upload.js";

const tempDirs: string[] = [];
afterAll(async () => Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true }))));

describe("chunked deployment upload", () => {
  it("uploads more than 8 MiB without any oversized request", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "demox-mcp-chunks-"));
    tempDirs.push(dir);
    const source = Buffer.alloc(9 * 1024 * 1024 + 17, 0x41);
    const filePath = path.join(dir, "large.zip");
    await writeFile(filePath, source);

    const chunks: Buffer[] = [];
    let largestRequest = 0;
    const result = await uploadFileInChunks({
      filePath,
      fileName: "large.zip",
      callApi: async (payload) => {
        largestRequest = Math.max(largestRequest, Buffer.byteLength(JSON.stringify(payload)));
        if (payload.action === "init_deploy_upload") {
          return { success: true, uploadId: "upload-1", chunkSize: 2 * 1024 * 1024, totalChunks: 5 };
        }
        if (payload.action === "upload_deploy_chunk") {
          const chunk = Buffer.from(payload.chunkBase64 as string, "base64");
          expect(createHash("sha256").update(chunk).digest("hex")).toBe(payload.chunkSha256);
          chunks[payload.chunkIndex as number] = chunk;
          return { success: true };
        }
        if (payload.action === "complete_deploy_upload") {
          expect(createHash("sha256").update(Buffer.concat(chunks)).digest("hex"))
            .toBe(createHash("sha256").update(source).digest("hex"));
          return { success: true, url: "https://example.demox.site/" };
        }
        throw new Error(`unexpected action: ${payload.action}`);
      }
    });

    expect(result.success).toBe(true);
    expect(largestRequest).toBeLessThan(4 * 1024 * 1024);
  });
});
