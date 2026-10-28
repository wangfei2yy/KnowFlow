/**
 * 小工具构建替身：端内使用 xhs Storage + 内存镜像（LiteTable），
 * 完全不含 Dexie / IndexedDB 代码。
 */
import { createLiteDB } from "@/db/liteStore";

export const db = createLiteDB();
