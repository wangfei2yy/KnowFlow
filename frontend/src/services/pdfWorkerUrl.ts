/**
 * 单独成文件：`import.meta.url` 只应出现在 web 构建中。
 * 小工具构建会把本模块替换为 minitool/pdfWorkerUrl.stub.ts。
 */
export function resolvePdfWorkerUrl(): string | null {
  try {
    return new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  } catch {
    return null;
  }
}
