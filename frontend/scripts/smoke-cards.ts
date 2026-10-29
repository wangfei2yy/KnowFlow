import { generateCardsFromContent, estimateCards, CanceledError } from "@/services/ai/aiService";
import { db } from "@/db/database";
import type { AIProvider } from "@/services/ai/AIProvider";

function makeFake() {
  const calls: { len: number; count: number }[] = [];
  const provider: AIProvider = {
    name: "fake",
    summarize: async () => { throw new Error("n/a"); },
    answerQuestion: async () => { throw new Error("n/a"); },
    extractTasks: async () => [],
    chat: async () => "",
    generateFlashcards: async ({ content, count }) => {
      calls.push({ len: content.length, count });
      return Array.from({ length: count }, (_, i) => ({
        question: `第${calls.length}段问题${i}`,
        answer: `答案${i}`
      }));
    }
  };
  return { provider, calls };
}

async function main() {
  // 1) 长文档：应分段、覆盖全文、按篇幅定张数
  const long = "英语语法知识点。".repeat(1600); // ~12800 字
  const f1 = makeFake();
  const progress: string[] = [];
  const cards1 = await generateCardsFromContent(f1.provider, long, 0, "d1", (d, t) => progress.push(`${d}/${t}`));
  console.log("1) 长文长度:", long.length, "| 调用次数:", f1.calls.length, "| 每段长度:", f1.calls.map((c) => c.len), "| 每段张数:", f1.calls.map((c) => c.count));
  console.log("   生成卡片:", cards1.length, "| 进度:", progress.join(","));
  if (f1.calls.length < 3) throw new Error("长文档没有被分段");
  if (cards1.length < 20) throw new Error(`长文档卡片过少：${cards1.length}`);
  if (f1.calls.some((c) => c.len > 2600)) throw new Error("存在超长分段");

  // 2) 短文：单次调用
  const short = "现在完成时表示过去发生但与现在有关的动作。".repeat(10);
  const f2 = makeFake();
  const cards2 = await generateCardsFromContent(f2.provider, short, 0, "d2");
  console.log("2) 短文长度:", short.length, "| 调用次数:", f2.calls.length, "| 张数:", cards2.length);
  if (f2.calls.length !== 1) throw new Error("短文不该分段");

  // 3) 指定张数
  const f3 = makeFake();
  const cards3 = await generateCardsFromContent(f3.provider, long, 10, "d3");
  console.log("3) 指定 10 张 → 实得:", cards3.length, "| 调用:", f3.calls.map((c) => c.count));
  if (cards3.length !== 10) throw new Error(`指定张数不生效：${cards3.length}`);

  // 4) 去重：模型返回重复问题
  const dupProvider: AIProvider = {
    name: "dup",
    summarize: async () => { throw new Error("n/a"); },
    answerQuestion: async () => { throw new Error("n/a"); },
    extractTasks: async () => [],
    chat: async () => "",
    generateFlashcards: async () => [
      { question: "什么是现在完成时？", answer: "A" },
      { question: "什么是现在完成时?", answer: "A2" },
      { question: "  ", answer: "空问题" }
    ]
  };
  const cards4 = await generateCardsFromContent(dupProvider, "短文", 10, "d4");
  console.log("4) 去重后:", cards4.length, JSON.stringify(cards4));
  if (cards4.length !== 1) throw new Error(`去重失败：${cards4.length}`);

  // 5) 模型对长输入返回空 → 应自动二分重试成功
  const fragile: AIProvider = {
    name: "fragile",
    summarize: async () => { throw new Error("n/a"); },
    answerQuestion: async () => { throw new Error("n/a"); },
    extractTasks: async () => [],
    chat: async () => "",
    generateFlashcards: async ({ content, count }) => {
      if (content.length > 1200) throw new Error("AI 返回为空，请重试");
      return Array.from({ length: Math.min(count, 4) }, (_, i) => ({
        question: `脆${content.length}-${i}`,
        answer: "A"
      }));
    }
  };
  const fragileCards = await generateCardsFromContent(fragile, "语法点。".repeat(800), 0, "d5");
  console.log("5) 长输入易失败模型 → 仍生成:", fragileCards.length, "张（自动二分重试）");
  if (fragileCards.length === 0) throw new Error("二分重试没有生效");

  // 6) 预估：段数 / 张数 / 请求次数
  const est = estimateCards(12800, 0);
  console.log("6) 预估 →", JSON.stringify(est));
  if (est.chunks !== 6) throw new Error(`段数预估应为 6，实际 ${est.chunks}`);
  if (est.cards < 20 || est.cards > 30) throw new Error(`张数预估异常：${est.cards}`);
  if (est.calls !== est.chunks) throw new Error("请求次数应等于段数");

  // 7) 取消：保留已生成部分，任务状态记为 canceled
  await db.aiJobs.clear();
  let calls = 0;
  const slow: AIProvider = {
    name: "slow",
    summarize: async () => { throw new Error("n/a"); },
    answerQuestion: async () => { throw new Error("n/a"); },
    extractTasks: async () => [],
    chat: async () => "",
    generateFlashcards: async ({ count }, options) => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 15));
      if (options?.signal?.aborted) throw new DOMException("已取消", "AbortError");
      return Array.from({ length: Math.min(count, 3) }, (_, i) => ({
        question: `慢${calls}-${i}`,
        answer: "A"
      }));
    }
  };
  const ac = new AbortController();
  let canceledPartial = -1;
  try {
    await generateCardsFromContent(
      slow,
      "语法点。".repeat(1600),
      0,
      "d7",
      (done) => { if (done >= 2) ac.abort(); },
      { signal: ac.signal }
    );
    throw new Error("应当抛出 CanceledError");
  } catch (e) {
    if (!(e instanceof CanceledError)) throw new Error("取消应抛 CanceledError，实际：" + e);
    canceledPartial = e.partial.length;
  }
  const jobs = await db.aiJobs.toArray();
  const lastJob = jobs[jobs.length - 1];
  console.log("7) 取消 → 已保留", canceledPartial, "张；任务状态", lastJob?.status);
  if (canceledPartial <= 0) throw new Error("取消后应保留已生成部分");
  if (lastJob?.status !== "canceled") throw new Error(`任务状态应为 canceled，实际 ${lastJob?.status}`);

  console.log("CARDS SMOKE PASS");
  process.exit(0);
}
main().catch((e) => { console.error("CARDS SMOKE FAIL:", e); process.exit(1); });
