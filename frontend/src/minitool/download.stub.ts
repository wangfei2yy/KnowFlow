/**
 * 小工具构建替身：端内禁止 `a[download]` 与 blob 下载，导出功能不可用。
 */
import type { BackupPayload } from "@/utils/export";

export function downloadJSON(_payload: BackupPayload, _filename?: string): void {
  throw new Error("小工具内不支持文件下载，请在网页版导出备份");
}
