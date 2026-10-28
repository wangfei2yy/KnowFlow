import type { Document, SourceType } from "@/types/document";
import { createDocument } from "@/services/documentService";
import { resolvePdfWorkerUrl } from "@/services/pdfWorkerUrl";
import { IS_MINITOOL } from "@/utils/runtime";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const MAX_PDF_TEXT = 100000; // PDF 提取文本上限（字符）

export interface ParseResult {
  ok: boolean;
  text?: string;
  fileName?: string;
  error?: string;
}

export interface ImportItem {
  fileName: string;
  title: string;
  content: string;
  sourceType: SourceType;
  categoryId?: string;
  tags: string[];
}

/**
 * 从文件扩展名推断来源类型（MVP 统一归为 file）。
 */
export function getFileExt(fileName: string): string {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * 解析单个文件为文本。支持 txt / md / pdf。
 */
export async function parseFile(file: File): Promise<ParseResult> {
  // 小工具容器仅允许通过 <input type="file"> 选择图片/视频，
  // 且禁用 Web Worker（PDF 解析依赖），因此端内不支持文件导入。
  if (IS_MINITOOL) {
    return {
      ok: false,
      fileName: file.name,
      error: "小工具内暂不支持文件导入，请使用「文本 / 笔记」方式新增，或前往网页版导入"
    };
  }
  if (file.size > MAX_FILE_SIZE) {
    return { ok: false, fileName: file.name, error: "文件超过 10 MB 上限" };
  }
  const ext = getFileExt(file.name);
  try {
    if (ext === "txt" || ext === "md") {
      const text = await file.text();
      return { ok: true, text, fileName: file.name };
    }
    if (ext === "pdf") {
      return await parsePdf(file);
    }
    return { ok: false, fileName: file.name, error: "暂不支持该格式（仅支持 TXT / MD / PDF）" };
  } catch (e) {
    return { ok: false, fileName: file.name, error: "文件解析失败，可能是加密 PDF 或无法提取文本" };
  }
}

async function parsePdf(file: File): Promise<ParseResult> {
  try {
    // 动态引入 pdfjs-dist，未安装时抛出，由上层降级处理
    const pdfjs = await import("pdfjs-dist");
    // 关键：显式指定同源 worker，避免默认从 CDN 加载被 CSP / 网络拦截
    const workerUrl = resolvePdfWorkerUrl();
    if (workerUrl) pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const buf = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: buf });
    const pdf = await loadingTask.promise;
    let text = "";
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((it: any) => it.str).join(" ") + "\n";
      if (text.length > MAX_PDF_TEXT) {
        text = text.slice(0, MAX_PDF_TEXT);
        break;
      }
    }
    if (!text.trim()) {
      return { ok: false, fileName: file.name, error: "未能从 PDF 提取到文本（可能是扫描件，暂不支持 OCR）" };
    }
    return { ok: true, text, fileName: file.name };
  } catch (e: any) {
    // 把真实错误一并记入控制台，便于诊断
    console.error("[KnowFlow] PDF 解析失败：", e);
    if (e?.message?.includes("Failed to fetch") || e?.code === "ERR_MODULE_NOT_FOUND") {
      return { ok: false, fileName: file.name, error: "PDF 解析组件未安装，请联系开发者" };
    }
    return {
      ok: false,
      fileName: file.name,
      error: `PDF 解析失败：${e?.message ?? "可能是加密或扫描件 PDF"}`
    };
  }
}

/**
 * 将解析结果写入资料库。
 */
export async function importItem(item: ImportItem): Promise<Document> {
  return createDocument({
    title: item.title,
    content: item.content,
    sourceType: item.sourceType,
    sourceName: item.fileName,
    categoryId: item.categoryId,
    tags: item.tags
  });
}
