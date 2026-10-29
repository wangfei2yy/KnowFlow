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

/** 触发浏览器下载任意文本文件（Markdown / CSV 等） */
export function downloadText(text: string, filename: string, mime = "text/plain;charset=utf-8"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
