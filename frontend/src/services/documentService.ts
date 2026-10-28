import { db } from "@/db/database";
import type { Document, SourceType } from "@/types/document";
import { uuid } from "@/utils/format";
import { toPlain, stripProxy } from "@/utils/plain";

export interface CreateDocumentInput {
  title: string;
  content: string;
  sourceType?: SourceType;
  sourceName?: string;
  categoryId?: string;
  tags?: string[];
}

export async function createDocument(input: CreateDocumentInput): Promise<Document> {
  const now = new Date().toISOString();
  const doc: Document = {
    id: uuid(),
    title: input.title.trim(),
    content: input.content,
    sourceType: input.sourceType ?? "note",
    ...(input.sourceName ? { sourceName: input.sourceName } : {}),
    ...(input.categoryId ? { categoryId: input.categoryId } : {}),
    tags: [...(input.tags ?? [])],
    keywords: [],
    favorite: false,
    createdAt: now,
    updatedAt: now
  };
  await db.documents.add(toPlain(doc));
  return doc;
}

export async function updateDocument(id: string, patch: Partial<Document>): Promise<void> {
  // 用 stripProxy 而非 toPlain：必须保留 undefined，
  // 因为 Dexie 用 `{ field: undefined }` 来表达「删除该字段」
  // （例如把资料改为「未分类」时清除 categoryId）。
  await db.documents.update(
    id,
    stripProxy({ ...patch, updatedAt: new Date().toISOString() })
  );
}

export async function deleteDocument(id: string): Promise<void> {
  await db.documents.delete(id);
}

export async function listDocuments(): Promise<Document[]> {
  return db.documents.orderBy("updatedAt").reverse().toArray();
}

export async function getDocument(id: string): Promise<Document | undefined> {
  return db.documents.get(id);
}

export async function toggleFavorite(id: string): Promise<void> {
  const doc = await db.documents.get(id);
  if (doc) {
    await db.documents.update(id, { favorite: !doc.favorite });
  }
}

export async function countDocuments(): Promise<number> {
  return db.documents.count();
}
