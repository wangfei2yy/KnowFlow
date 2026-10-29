/**
 * 闯关与卡片系统之间的桥：答错的词写入学习中心，交给 SRS 安排复习。
 */
import { db } from "@/db/database";
import { createDocument, listDocuments } from "@/services/documentService";
import { createCategory, listCategories } from "@/services/categoryService";
import { createFlashcard, listFlashcards, markMastery } from "@/services/flashcardService";
import type { WordEntry } from "@/services/quest/engine";

const PACK_CATEGORY = "英语";
const PACK_DOC_TITLE: Record<string, string> = {
  cet4: "四级词汇（闯关错词）",
  cet6: "六级词汇（闯关错词）",
  idiom: "成语复习（闯关错词）",
  // 食材图鉴是「主动加入」，不是答错，标题不带「闯关错词」
  food: "食材图鉴（饮食）"
};

/** 每类包归属的分类：食材放「饮食」，其余按英语归档 */
const PACK_CATEGORY_OF: Record<string, string> = {
  food: "饮食"
};

/** 确保内置资料与分类存在，返回资料 id（卡片挂在这份资料下便于回溯） */
export async function ensurePackDocument(packId: string): Promise<string> {
  const title = PACK_DOC_TITLE[packId] ?? `${packId} 闯关错词`;
  const categoryName = PACK_CATEGORY_OF[packId] ?? PACK_CATEGORY;
  const docs = await listDocuments();
  const existing = docs.find((d) => d.title === title);
  if (existing) return existing.id;

  const cats = await listCategories();
  let categoryId = cats.find((c) => c.name === categoryName)?.id;
  if (!categoryId) {
    const cat = await createCategory(categoryName);
    categoryId = cat.id;
  }

  const fromQuest = categoryName === PACK_CATEGORY;
  const doc = await createDocument({
    title,
    content: fromQuest
      ? "这些卡片来自「单词闯关」：答错的词会自动加入这里，并由复习计划安排回看。"
      : `这些卡片来自「食材图鉴」：你在图鉴里主动加入的${categoryName}知识，由复习计划安排回看。`,
    sourceType: "note",
    categoryId
  });
  return doc.id;
}

/** 这个知识点是不是已经在复习队列里（详情页按钮用） */
export async function hasWordInReview(question: string): Promise<boolean> {
  const cards = await db.flashcards.toArray();
  return cards.some((c) => c.question === question);
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

/**
 * 把已经进过复习队列的词标记为「已掌握」（不必再按遗忘曲线来回看）。
 *
 * 成语页的「会」走这里：只写本地标签而不管 SRS 的话，卡片还会继续出现在复习里，
 * 两个地方状态会互相打脸。没建过卡片则返回 false，由调用方决定只记标签。
 */
export async function markWordKnown(word: string): Promise<boolean> {
  const cards = await listFlashcards();
  const hit = cards.find((c) => c.question === word && !c.suspended);
  if (!hit) return false;
  await markMastery(hit.id, 2);
  return true;
}
