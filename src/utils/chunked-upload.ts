import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";

export type DeployApiCall = (payload: Record<string, unknown>) => Promise<any>;

export interface ChunkedUploadParams {
  filePath: string;
  fileName: string;
  websiteId?: string;
  projectId?: string;
  callApi: DeployApiCall;
  onProgress?: (uploadedChunks: number, totalChunks: number) => void;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function retry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await sleep(400 * 2 ** attempt);
    }
  }
  throw lastError;
}

export async function uploadFileInChunks(params: ChunkedUploadParams): Promise<any> {
  const fileStat = await stat(params.filePath);
  if (!fileStat.isFile() || fileStat.size <= 0) throw new Error("部署文件必须是非空文件");

  const requestId = randomUUID();
  const fileSha256 = await sha256File(params.filePath);
  const init = await retry(() => params.callApi({
    action: "init_deploy_upload",
    fileName: params.fileName,
    websiteId: params.websiteId,
    projectId: params.projectId,
    totalSize: fileStat.size,
    sha256: fileSha256,
    requestId
  }));
  if (!init.success || !init.uploadId || !init.chunkSize || !init.totalChunks) {
    throw new Error(init.message || "初始化上传失败");
  }

  let completionStarted = false;
  const file = await open(params.filePath, "r");
  try {
    for (let index = 0; index < init.totalChunks; index++) {
      const offset = index * init.chunkSize;
      const length = Math.min(init.chunkSize, fileStat.size - offset);
      const chunk = Buffer.allocUnsafe(length);
      const { bytesRead } = await file.read(chunk, 0, length, offset);
      if (bytesRead !== length) throw new Error(`读取分块 ${index + 1} 不完整`);
      const chunkSha256 = createHash("sha256").update(chunk).digest("hex");
      const result = await retry(() => params.callApi({
        action: "upload_deploy_chunk",
        uploadId: init.uploadId,
        chunkIndex: index,
        chunkSha256,
        chunkBase64: chunk.toString("base64")
      }));
      if (!result.success) throw new Error(result.message || `上传分块 ${index + 1} 失败`);
      params.onProgress?.(index + 1, init.totalChunks);
    }

    completionStarted = true;
    for (let attempt = 0; attempt < 80; attempt++) {
      const result = await retry(() => params.callApi({
        action: "complete_deploy_upload",
        uploadId: init.uploadId
      }));
      if (result.success) return result;
      if (result.code !== "UPLOAD_COMPLETING") throw new Error(result.message || "部署失败");
      await sleep(result.retryAfterMs || 1500);
    }
    throw new Error("等待部署完成超时");
  } catch (error) {
    if (!completionStarted) {
      await params.callApi({ action: "abort_deploy_upload", uploadId: init.uploadId }).catch(() => {});
    }
    throw error;
  } finally {
    await file.close();
  }
}
