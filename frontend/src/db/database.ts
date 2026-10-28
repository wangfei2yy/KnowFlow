import Dexie, { type Table } from "dexie";
import type { Document, Category } from "@/types/document";
import type { Task } from "@/types/task";
import type { AIJob } from "@/types/ai";
import { stripProxy } from "@/utils/plain";
import { IS_MINITOOL } from "@/utils/runtime";
import { createLiteDB } from "./liteStore";

export interface Flashcard {
  id: string;
  documentId: string;
  question: string;
  answer: string;
  mastery: 0 | 1 | 2;
  reviewCount: number;
  nextReviewAt?: string;
  createdAt: string;
}

export class KnowFlowDB extends Dexie {
  documents!: Table<Document, string>;
  categories!: Table<Category, string>;
  tasks!: Table<Task, string>;
  flashcards!: Table<Flashcard, string>;
  aiJobs!: Table<AIJob, string>;

  constructor() {
    super("knowflow");
    // v1 -> v2：flashcards 表补充 createdAt 索引（学习中心按 createdAt 排序必需）
    this.version(1).stores({
      documents: "id, title, categoryId, favorite, createdAt, updatedAt, *tags",
      categories: "id, name, sortOrder",
      tasks: "id, status, priority, dueDate, sourceDocumentId, createdAt",
      flashcards: "id, documentId, mastery, nextReviewAt",
      aiJobs: "id, documentId, type, status, createdAt"
    });
    this.version(2).stores({
      documents: "id, title, categoryId, favorite, createdAt, updatedAt, *tags",
      categories: "id, name, sortOrder",
      tasks: "id, status, priority, dueDate, sourceDocumentId, createdAt",
      flashcards: "id, documentId, mastery, nextReviewAt, createdAt",
      aiJobs: "id, documentId, type, status, createdAt"
    });
  }
}

export const db: KnowFlowDB = IS_MINITOOL
  ? (createLiteDB() as unknown as KnowFlowDB)
  : new KnowFlowDB();

/**
 * 全局最后一道防线：所有写入前剥离 Vue 响应式 Proxy。
 *
 * IndexedDB 的结构化克隆算法无法处理 Proxy 对象，会抛
 * `DataCloneError: xxx could not be cloned`。
 * 各 service 层已自行调用 toPlain，这里再包一层，
 * 保证任何新增的调用点都不会踩坑。
 *
 * 使用 stripProxy 而非 toPlain：保留 undefined 语义，
 * 因为 Dexie 的 update 依赖 `{ field: undefined }` 删除字段。
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
function hardenTable(table: Table<any, any>): void {
  const rawAdd = table.add.bind(table);
  const rawPut = table.put.bind(table);
  const rawUpdate = table.update.bind(table);
  const rawBulkAdd = table.bulkAdd.bind(table);
  const rawBulkPut = table.bulkPut.bind(table);

  table.add = ((item: any, key?: any) => rawAdd(stripProxy(item), key)) as any;
  table.put = ((item: any, key?: any) => rawPut(stripProxy(item), key)) as any;
  table.update = ((key: any, changes: any) => rawUpdate(key, stripProxy(changes))) as any;
  table.bulkAdd = ((items: any[], keys?: any[]) => rawBulkAdd(stripProxy(items), keys)) as any;
  table.bulkPut = ((items: any[], keys?: any[]) => rawBulkPut(stripProxy(items), keys)) as any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

[db.documents, db.categories, db.tasks, db.flashcards, db.aiJobs].forEach((table) => {
  // 小工具版使用 LiteTable，内部已做 stripProxy，无需再包一层
  if (!IS_MINITOOL) hardenTable(table as never);
});
