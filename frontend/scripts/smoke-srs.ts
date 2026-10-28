import { db, type Flashcard } from "@/db/database";
import { schedule, listDueCards } from "@/services/flashcardService";

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-28T20:00:00+08:00");

function makeCard(p: Partial<Flashcard> & { id: string }): Flashcard {
  return {
    documentId: "doc-1",
    question: "问题",
    answer: "答案",
    mastery: 0,
    reviewCount: 0,
    ease: 2.5,
    intervalDays: 0,
    lapses: 0,
    suspended: false,
    createdAt: new Date(NOW.getTime() - DAY).toISOString(),
    ...p
  } as Flashcard;
}

const ok = (cond: boolean, msg: string) => {
  if (!cond) throw new Error("断言失败：" + msg);
};

async function main() {
  // ---------- 1. 评价「不熟悉」 ----------
  const c1 = makeCard({ id: "c1" });
  const r1 = schedule(c1, 0, NOW);
  console.log("1) 不熟悉 →", { ease: r1.ease.toFixed(2), interval: r1.intervalDays, lapses: r1.lapses, next: r1.nextReviewAt });
  ok(r1.lapses === 1, "lapses 应 +1");
  ok(r1.intervalDays === 0, "间隔应归零");
  ok(Math.abs(new Date(r1.nextReviewAt).getTime() - (NOW.getTime() + 10 * 60 * 1000)) < 1000, "应 10 分钟后重现");
  ok(Math.abs(r1.ease - 2.3) < 1e-9, "ease 应降到 2.3");

  // ---------- 2. 连续「已掌握」：1 → 3 → 8 天 ----------
  let card = makeCard({ id: "c2" });
  const seq: number[] = [];
  const eases: number[] = [];
  for (let i = 0; i < 3; i++) {
    const r = schedule(card, 2, NOW);
    seq.push(r.intervalDays);
    eases.push(Number(r.ease.toFixed(2)));
    card = { ...card, ease: r.ease, intervalDays: r.intervalDays, reviewCount: (card.reviewCount ?? 0) + 1 };
  }
  console.log("2) 连对三次 →", { intervals: seq, eases });
  ok(JSON.stringify(seq) === JSON.stringify([1, 3, 8]), `期望 1/3/8，实际 ${seq}`);
  ok(JSON.stringify(eases) === JSON.stringify([2.6, 2.7, 2.8]), `期望 ease 2.6/2.7/2.8，实际 ${eases}`);

  // ---------- 3. 间隔上限 180 天 ----------
  const r3 = schedule(makeCard({ id: "c3", intervalDays: 100, ease: 2.5 }), 2, NOW);
  console.log("3) 间隔封顶 →", r3.intervalDays);
  ok(r3.intervalDays === 180, "间隔应封顶 180 天");

  // ---------- 4. ease 上下限 ----------
  const r4a = schedule(makeCard({ id: "c4", ease: 1.35 }), 0, NOW);
  const r4b = schedule(makeCard({ id: "c5", ease: 2.98 }), 2, NOW);
  console.log("4) ease 边界 →", { low: r4a.ease.toFixed(2), high: r4b.ease.toFixed(2) });
  ok(r4a.ease >= 1.3, "ease 不得低于 1.3");
  ok(r4b.ease <= 3.0, "ease 不得高于 3.0");

  // ---------- 5. 队列与统计 ----------
  await db.flashcards.clear();
  const todayStart = new Date(NOW);
  todayStart.setHours(0, 0, 0, 0);

  const overdue = makeCard({ id: "overdue", nextReviewAt: new Date(todayStart.getTime() - 3 * DAY).toISOString() });
  const dueNow = makeCard({ id: "due", nextReviewAt: new Date(NOW.getTime() - HOUR).toISOString() });
  const future = makeCard({ id: "future", nextReviewAt: new Date(NOW.getTime() + 2 * DAY).toISOString() });
  const fresh = makeCard({ id: "fresh" });
  const paused = makeCard({ id: "paused", suspended: true, nextReviewAt: new Date(NOW.getTime() - HOUR).toISOString() });
  const doneToday = makeCard({
    id: "done",
    nextReviewAt: new Date(NOW.getTime() + 3 * DAY).toISOString(),
    lastReviewedAt: new Date(NOW.getTime() - HOUR).toISOString(),
    reviewCount: 1
  });

  for (const c of [overdue, dueNow, future, fresh, paused, doneToday]) {
    await db.flashcards.add(c as unknown as Record<string, unknown>);
  }

  const buckets = await listDueCards(NOW);
  console.log("5) 队列 →", {
    due: buckets.due,
    overdue: buckets.overdue,
    fresh: buckets.fresh,
    pending: buckets.pending,
    todayDone: buckets.todayDone,
    order: buckets.queue.map((c) => c.id)
  });

  ok(buckets.overdue === 1, "逾期应为 1");
  ok(buckets.due === 2, "到期（含逾期）应为 2");
  ok(buckets.fresh === 1, "新卡应为 1");
  ok(buckets.pending === 3, "队列总量应为 3");
  ok(buckets.todayDone === 1, "今日已复习应为 1");
  ok(!buckets.queue.some((c) => c.id === "paused"), "暂停卡片不应进队列");
  ok(!buckets.queue.some((c) => c.id === "future"), "未来卡片不应进队列");
  ok(buckets.queue[0].id === "overdue", "逾期应排最前");
  ok(buckets.queue[buckets.queue.length - 1].id === "fresh", "新卡应排最后");

  // ---------- 6. markMastery 落库字段 ----------
  await db.flashcards.clear();
  const target = makeCard({ id: "target" });
  await db.flashcards.add(target as unknown as Record<string, unknown>);
  const { markMastery } = await import("@/services/flashcardService");
  await markMastery("target", 2);
  const saved = await db.flashcards.get("target");
  console.log("6) markMastery 落库 →", {
    interval: saved?.intervalDays,
    ease: saved?.ease,
    reviewCount: saved?.reviewCount,
    hasLastReviewed: !!saved?.lastReviewedAt
  });
  ok(saved?.intervalDays === 1, "首次掌握间隔应为 1 天");
  ok((saved?.reviewCount ?? 0) === 1, "复习次数应为 1");
  ok(!!saved?.lastReviewedAt, "应写入 lastReviewedAt");

  console.log("SRS SMOKE PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error("SRS SMOKE FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
