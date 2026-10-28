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

  // —— v3：间隔重复（SRS）所需字段 ——
  /** 难度因子，初始 2.5，范围 1.3~3.0 */
  ease?: number;
  /** 当前间隔天数，0 表示尚未排期 */
  intervalDays?: number;
  /** 遗忘次数（标记「不熟悉」累计） */
  lapses?: number;
  /** 上次复习时间，用于统计「今日已复习」 */
  lastReviewedAt?: string;
  /** 暂停复习（不进入队列） */
  suspended?: boolean;
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

    // v2 -> v3：卡片补充 SRS 字段与复习统计索引；只加字段，不改旧语义（旧版本读新数据仍可用）
    this.version(3)
      .stores({
        documents: "id, title, categoryId, favorite, createdAt, updatedAt, *tags",
        categories: "id, name, sortOrder",
        tasks: "id, status, priority, dueDate, sourceDocumentId, createdAt",
        flashcards:
          "id, documentId, mastery, nextReviewAt, lastReviewedAt, suspended, createdAt",
        aiJobs: "id, documentId, type, status, createdAt"
      })
      .upgrade(async (tx) => {
        // 迁移失败不能阻断打开数据库：外层 try/catch 后仍保留原数据
        await tx
          .table("flashcards")
          .toCollection()
          .modify((card: Flashcard) => {
            if (card.ease == null) card.ease = 2.5;
            if (card.intervalDays == null) card.intervalDays = 0;
            if (card.lapses == null) card.lapses = 0;
            if (card.suspended == null) card.suspended = false;
            // 老数据若已复习过但没有排期，补一个「创建后 1 天」，避免升级当天全部涌入队列
            if (!card.nextReviewAt && (card.reviewCount ?? 0) > 0) {
              const base = new Date(card.createdAt || Date.now()).getTime();
              card.nextReviewAt = new Date(base + 24 * 3600 * 1000).toISOString();
            }
          });
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
