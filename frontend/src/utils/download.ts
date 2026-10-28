import type { BackupPayload } from "@/utils/export";

/**
 * 触发浏览器下载 JSON 文件。
 *
 * 注意：容器禁止 `a[download]` / blob 下载，小工具构建会把本模块
 * 替换为 minitool/download.stub.ts。
 */
export function downloadJSON(payload: BackupPayload, filename = "knowflow-backup.json"): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
