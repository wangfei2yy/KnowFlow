import { db, type Flashcard } from "@/db/database";
import { uuid } from "@/utils/format";
import { toPlain } from "@/utils/plain";

export type Mastery = 0 | 1 | 2;

export interface CreateFlashcardInput {
  documentId: string;
  question: string;
  answer: string;
}

export async function listFlashcards(): Promise<Flashcard[]> {
  return db.flashcards.orderBy("createdAt").reverse().toArray();
}

export async function createFlashcard(input: CreateFlashcardInput): Promise<Flashcard> {
  const card: Flashcard = {
    id: uuid(),
    documentId: input.documentId,
    question: input.question,
    answer: input.answer,
    mastery: 0,
    reviewCount: 0,
    createdAt: new Date().toISOString()
  };
  await db.flashcards.add(toPlain(card));
  return card;
}

export async function deleteFlashcard(id: string): Promise<void> {
  await db.flashcards.delete(id);
}

/**
 * 标记掌握程度并更新复习间隔（简单间隔：1/3/7 天）。
 */
export async function markMastery(id: string, mastery: Mastery): Promise<void> {
  const card = await db.flashcards.get(id);
  if (!card) return;
  const intervals = [1, 3, 7];
  const nextReviewAt = new Date(Date.now() + intervals[mastery] * 24 * 3600 * 1000).toISOString();
  await db.flashcards.update(id, {
    mastery,
    reviewCount: card.reviewCount + 1,
    nextReviewAt
  });
}
