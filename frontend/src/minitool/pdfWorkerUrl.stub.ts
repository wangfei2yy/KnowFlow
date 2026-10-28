/**
 * 小工具构建替身：`import.meta.url` 在 classic script（IIFE）产物中不可用，
 * 端内也不支持 PDF，故直接返回 null。
 */
export function resolvePdfWorkerUrl(): string | null {
  return null;
}
