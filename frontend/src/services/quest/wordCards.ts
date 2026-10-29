/**
 * 闯关与卡片系统之间的桥：答错的词写入学习中心，交给 SRS 安排复习。
 */
import { db } from "@/db/database";
import { createDocument, listDocuments } from "@/services/documentService";
import { createCategory, listCategories } from "@/services/categoryService";
import { createFlashcard, markMastery } from "@/services/flashcardService";
import type { WordEntry } from "@/services/quest/engine";

const PACK_CATEGORY = "英语";
const PACK_DOC_TITLE: Record<string, string> = {
  cet4: "四级词汇（闯关错词）",
  cet6: "六级词汇（闯关错词）"
};

/** 确保内置资料与分类存在，返回资料 id（卡片挂在这份资料下便于回溯） */
export async function ensurePackDocument(packId: string): Promise<string> {
  const title = PACK_DOC_TITLE[packId] ?? `${packId} 闯关错词`;
  const docs = await listDocuments();
  const existing = docs.find((d) => d.title === title);
  if (existing) return existing.id;

  const cats = await listCategories();
  let categoryId = cats.find((c) => c.name === PACK_CATEGORY)?.id;
  if (!categoryId) {
    const cat = await createCategory(PACK_CATEGORY);
    categoryId = cat.id;
  }

  const doc = await createDocument({
    title,
    content: "这些卡片来自「单词闯关」：答错的词会自动加入这里，并由复习计划安排回看。",
    sourceType: "note",
    categoryId
  });
  return doc.id;
}

/**
 * 把一个错词加入复习：已存在同名卡片则重置为「不熟悉」，否则新建后标记。
 * 返回 true 表示新建了卡片。
 */
export async function addWrongWordToReview(packId: string, word: WordEntry): Promise<boolean> {
  const documentId = await ensurePackDocument(packId);
  const existing = (await db.flashcards.toArray()).find((c) => c.question === word.w);
  if (existing) {
    await markMastery(existing.id, 0);
    return false;
  }
  const card = await createFlashcard({
    documentId,
    question: word.w,
    answer: word.m
  });
  // 答错 → 10 分钟后再次出现，直接进入今日复习队列
  await markMastery(card.id, 0);
  return true;
}
