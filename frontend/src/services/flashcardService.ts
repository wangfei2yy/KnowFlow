import { db, type Flashcard } from "@/db/database";
import { uuid } from "@/utils/format";
import { toPlain } from "@/utils/plain";

export type Mastery = 0 | 1 | 2;

export interface CreateFlashcardInput {
  documentId: string;
  question: string;
  answer: string;
}

const DAY_MS = 24 * 3600 * 1000;
/** 答错后多久再次出现（10 分钟，当天可再练） */
const RELEARN_MS = 10 * 60 * 1000;
const EASE_INIT = 2.5;
const EASE_MIN = 1.3;
const EASE_MAX = 3.0;
const MAX_INTERVAL_DAYS = 180;

/** 三档评价对应的 SM-2 quality（<3 视为答错） */
const QUALITY: Record<Mastery, number> = { 0: 1, 1: 3, 2: 5 };

export interface ScheduleResult {
  mastery: Mastery;
  ease: number;
  intervalDays: number;
  lapses: number;
  nextReviewAt: string;
}

/**
 * 简化版 SM-2 调度。
 *
 * - 评价「不熟悉」：lapses+1，10 分钟后再次出现，ease 下调 0.2（不低于 1.3）
 * - 前两次答对：间隔 1 天、3 天
 * - 之后答对：间隔 = 上次间隔 × ease（上限 180 天）
 * - 「基本掌握」ease 微降 0.05，「已掌握」ease 上调 0.1（不超过 3.0）
 *
 * 注意：先更新 ease 再计算间隔，这样连续「已掌握」得到 1 → 3 → 8 的序列。
 */
export function schedule(card: Flashcard, rating: Mastery, now: Date = new Date()): ScheduleResult {
  const quality = QUALITY[rating];
  let ease = card.ease ?? EASE_INIT;
  let intervalDays = card.intervalDays ?? 0;
  let lapses = card.lapses ?? 0;

  if (quality < 3) {
    lapses += 1;
    ease = Math.max(EASE_MIN, ease - 0.2);
    return {
      mastery: rating,
      ease,
      intervalDays: 0,
      lapses,
      nextReviewAt: new Date(now.getTime() + RELEARN_MS).toISOString()
    };
  }

  ease = quality === 5 ? Math.min(EASE_MAX, ease + 0.1) : Math.max(EASE_MIN, ease - 0.05);

  if (intervalDays <= 0) intervalDays = 1;
  else if (intervalDays === 1) intervalDays = 3;
  else intervalDays = Math.min(MAX_INTERVAL_DAYS, Math.round(intervalDays * ease));

  intervalDays = Math.max(1, intervalDays);

  return {
    mastery: rating,
    ease,
    intervalDays,
    lapses,
    nextReviewAt: new Date(now.getTime() + intervalDays * DAY_MS).toISOString()
  };
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
    ease: EASE_INIT,
    intervalDays: 0,
    lapses: 0,
    suspended: false,
    createdAt: new Date().toISOString()
  };
  await db.flashcards.add(toPlain(card));
  return card;
}

export async function deleteFlashcard(id: string): Promise<void> {
  await db.flashcards.delete(id);
}

/** 标记掌握程度并写入下一次复习时间（调度规则见 schedule） */
export async function markMastery(id: string, mastery: Mastery): Promise<void> {
  const card = await db.flashcards.get(id);
  if (!card) return;
  const now = new Date();
  const result = schedule(card, mastery, now);
  await db.flashcards.update(id, {
    mastery: result.mastery,
    reviewCount: (card.reviewCount ?? 0) + 1,
    ease: result.ease,
    intervalDays: result.intervalDays,
    lapses: result.lapses,
    nextReviewAt: result.nextReviewAt,
    lastReviewedAt: now.toISOString()
  });
}

/** 暂停 / 恢复复习 */
export async function setSuspended(id: string, suspended: boolean): Promise<void> {
  await db.flashcards.update(id, { suspended });
}

export interface ReviewStats {
  /** 今天到期（含逾期） */
  due: number;
  /** 其中早于今天 0 点 */
  overdue: number;
  /** 从未复习过的新卡片 */
  fresh: number;
  /** 今日已复习张数 */
  todayDone: number;
  /** 队列总量 = due + fresh */
  pending: number;
}

export interface DueBuckets extends ReviewStats {
  /** 待复习卡片（逾期 → 到期 → 新卡） */
  queue: Flashcard[];
}

function startOfToday(now: Date): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * 计算复习队列与统计。
 * 排序：逾期（最久优先）→ 今日到期 → 新卡（按创建时间升序）。
 */
export async function listDueCards(now: Date = new Date()): Promise<DueBuckets> {
  const all = await db.flashcards.toArray();
  const nowTs = now.getTime();
  const todayStart = startOfToday(now);

  const overdue: Flashcard[] = [];
  const due: Flashcard[] = [];
  const fresh: Flashcard[] = [];
  let todayDone = 0;

  for (const card of all) {
    if (card.suspended) continue;

    if (card.lastReviewedAt) {
      const last = new Date(card.lastReviewedAt).getTime();
      if (!Number.isNaN(last) && last >= todayStart) todayDone += 1;
    }

    if (!card.nextReviewAt) {
      // 从未排期：未复习过的算新卡；已复习过的（老数据）直接进队列
      if ((card.reviewCount ?? 0) === 0) fresh.push(card);
      else due.push(card);
      continue;
    }

    const next = new Date(card.nextReviewAt).getTime();
    if (Number.isNaN(next)) continue;
    if (next < todayStart) overdue.push(card);
    else if (next <= nowTs) due.push(card);
  }

  const byNext = (a: Flashcard, b: Flashcard) =>
    new Date(a.nextReviewAt ?? 0).getTime() - new Date(b.nextReviewAt ?? 0).getTime();
  overdue.sort(byNext);
  due.sort(byNext);
  fresh.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  const queue = [...overdue, ...due, ...fresh];

  return {
    due: due.length + overdue.length,
    overdue: overdue.length,
    fresh: fresh.length,
    todayDone,
    pending: queue.length,
    queue
  };
}
