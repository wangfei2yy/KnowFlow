/**
 * 小工具构建替身：端内禁用 Web Worker，pdfjs-dist 无法运行，
 * 打包时以本文件替换（vite alias），确保产物中不残留 pdfjs 代码。
 */
export const GlobalWorkerOptions = { workerSrc: "" };

export function getDocument(_options: unknown): never {
  throw new Error("小工具内不支持 PDF 解析，请使用网页版导入文件");
}
