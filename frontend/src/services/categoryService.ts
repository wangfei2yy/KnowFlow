import { db } from "@/db/database";
import type { Category } from "@/types/document";
import { uuid } from "@/utils/format";
import { toPlain } from "@/utils/plain";

export async function createCategory(name: string, color?: string): Promise<Category> {
  const count = await db.categories.count();
  const cat: Category = {
    id: uuid(),
    name: name.trim(),
    color: color ?? "#3b6ef6",
    sortOrder: count,
    createdAt: new Date().toISOString()
  };
  await db.categories.add(toPlain(cat));
  return cat;
}

export async function listCategories(): Promise<Category[]> {
  return db.categories.orderBy("sortOrder").toArray();
}

export async function renameCategory(id: string, name: string): Promise<void> {
  await db.categories.update(id, { name: name.trim() });
}

export async function deleteCategory(id: string): Promise<void> {
  await db.categories.delete(id);
  // 将属于该分类的资料 categoryId 置空，避免资料丢失
  const docs = await db.documents.where("categoryId").equals(id).toArray();
  await Promise.all(
    docs.map((d) => db.documents.update(d.id, { categoryId: undefined }))
  );
}
