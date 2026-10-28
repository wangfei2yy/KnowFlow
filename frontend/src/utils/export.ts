import { db } from "@/db/database";
import type { Document, Category } from "@/types/document";
import type { Task } from "@/types/task";
import type { AIJob } from "@/types/ai";
import type { Flashcard } from "@/db/database";

export interface BackupPayload {
  app: "knowflow";
  version: number;
  exportedAt: string;
  documents: Document[];
  categories: Category[];
  tasks: Task[];
  flashcards: Flashcard[];
  aiJobs: AIJob[];
}

/**
 * 导出全部数据为备份对象。
 */
export async function exportAll(): Promise<BackupPayload> {
  const [documents, categories, tasks, flashcards, aiJobs] = await Promise.all([
    db.documents.toArray(),
    db.categories.toArray(),
    db.tasks.toArray(),
    db.flashcards.toArray(),
    db.aiJobs.toArray()
  ]);
  return {
    app: "knowflow",
    version: 1,
    exportedAt: new Date().toISOString(),
    documents,
    categories,
    tasks,
    flashcards,
    aiJobs
  };
}

/**
 * 触发浏览器下载 JSON 文件（见 `@/utils/download`）。
 * 已拆分到独立模块，便于小工具构建整体替换掉下载能力。
 */

/**
 * 校验备份文件结构。
 */
export function validateBackup(data: any): { valid: boolean; error?: string } {
  if (!data || typeof data !== "object") {
    return { valid: false, error: "备份文件内容无效" };
  }
  if (data.app !== "knowflow") {
    return { valid: false, error: "不是有效的 KnowFlow 备份文件" };
  }
  const required = ["documents", "categories", "tasks", "flashcards"];
  for (const key of required) {
    if (!Array.isArray(data[key])) {
      return { valid: false, error: `备份数据结构不完整：缺少 ${key}` };
    }
  }
  return { valid: true };
}

/**
 * 导入备份数据。
 * mode=replace：清空后导入；mode=merge：仅导入不存在的 ID，避免覆盖。
 */
export async function importAll(data: BackupPayload, mode: "merge" | "replace"): Promise<void> {
  await db.transaction(
    "rw",
    db.documents,
    db.categories,
    db.tasks,
    db.flashcards,
    db.aiJobs,
    async () => {
      if (mode === "replace") {
        await Promise.all([
          db.documents.clear(),
          db.categories.clear(),
          db.tasks.clear(),
          db.flashcards.clear(),
          db.aiJobs.clear()
        ]);
      }
      // merge：仅导入不存在的 ID
      for (const d of data.documents) if (!(await db.documents.get(d.id))) await db.documents.add(d);
      for (const c of data.categories) if (!(await db.categories.get(c.id))) await db.categories.add(c);
      for (const t of data.tasks) if (!(await db.tasks.get(t.id))) await db.tasks.add(t);
      for (const f of data.flashcards) if (!(await db.flashcards.get(f.id))) await db.flashcards.add(f);
      for (const j of data.aiJobs) if (!(await db.aiJobs.get(j.id))) await db.aiJobs.add(j);
    }
  );
}
