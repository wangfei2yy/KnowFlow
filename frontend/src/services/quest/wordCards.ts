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
  cet6: "六级词汇（闯关错词）",
  idiom: "成语复习（闯关错词）"
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
 * 把一个词条加入复习。
 * @param wrong true = 闯关答错（重置为「不熟悉」，10 分钟后重现）；
 *              false = 主动加入（保持新卡状态，进「新卡」队列）
 * @returns true 表示新建了卡片
 */
export async function addWordToReview(
  packId: string,
  word: WordEntry,
  wrong = true
): Promise<boolean> {
  const documentId = await ensurePackDocument(packId);
  const existing = (await db.flashcards.toArray()).find((c) => c.question === word.w);
  if (existing) {
    if (wrong) await markMastery(existing.id, 0);
    return false;
  }
  const card = await createFlashcard({
    documentId,
    question: word.w,
    answer: word.m
  });
  if (wrong) await markMastery(card.id, 0);
  return true;
}

/** 兼容旧调用名 */
export const addWrongWordToReview = (packId: string, word: WordEntry) =>
  addWordToReview(packId, word, true);
