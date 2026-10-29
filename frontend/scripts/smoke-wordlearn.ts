/**
 * 背单词（关卡四选一）逻辑冒烟。
 */
import {
  DRILL,
  answerDrill,
  currentDrillQuestion,
  drillAccuracy,
  drillPassed,
  levelCount,
  levelRange,
  levelSlice,
  nextDrill,
  passLine,
  saveDrillResult,
  loadDrillProgress,
  startDrill,
  summarizeDrill,
  type LevelMap
} from "@/services/wordLearn";
import type { WordEntry } from "@/services/quest/engine";

let pass = 0;
const failed: string[] = [];
function ok(cond: boolean, msg: string) {
  if (cond) pass += 1;
  else failed.push(msg);
}

// 假 localStorage
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0
} as unknown as Storage;

const words: WordEntry[] = Array.from({ length: 4424 }, (_, i) => ({
  w: `word${String(i).padStart(4, "0")}`,
  p: `[w${i}]`,
  m: `释义${i}`
}));

// ---------------- 1) 关卡数按词量算 ----------------
ok(levelCount(4424) === 89, `4424 词应 89 关，实际 ${levelCount(4424)}`);
ok(levelCount(5518) === 111, `5518 词应 111 关，实际 ${levelCount(5518)}`);
ok(levelCount(50) === 1 && levelCount(51) === 2, "整 50 与 51 词的边界");
ok(levelCount(0) === 0, "空词库 0 关");

// ---------------- 2) 切关稳定、末关取余 ----------------
const l0 = levelSlice(words, 0);
ok(l0.length === 50 && l0[0].w === "word0000", "第 1 关应取前 50 词");
const lastLevel = levelCount(words.length) - 1;
const lastSlice = levelSlice(words, lastLevel);
ok(lastSlice.length === 4424 - lastLevel * 50, `末关应取余数，实际 ${lastSlice.length}`);
ok(levelSlice(words, 0)[0].w === levelSlice(words, 0)[0].w, "同一关两次取到的词一致");

// ---------------- 3) 关卡词序范围 ----------------
ok(levelRange(0, 4424).start === 1 && levelRange(0, 4424).end === 50, "第 1 关是第 1~50 词");
ok(levelRange(1, 4424).start === 51 && levelRange(1, 4424).end === 100, "第 2 关是第 51~100 词");
const tail = levelRange(lastLevel, 4424);
ok(tail.end === 4424, `末关结束词应是 4424，实际 ${tail.end}`);

// ---------------- 4) 过关线 ----------------
ok(passLine(50) === 40, `50 题过关线应 40，实际 ${passLine(50)}`);
ok(passLine(24) === 20, `24 题过关线应 20，实际 ${passLine(24)}`);
ok(DRILL.perLevel === 50 && DRILL.passRate === 0.8, "常量口径");

// ---------------- 5) 一局的题面 ----------------
let seed = 1;
const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
let s = startDrill(l0, rng);
ok(s.questions.length === 50, `一关应 50 题，实际 ${s.questions.length}`);
ok(s.questions.every((q) => q.options.length === 4), "每题 4 个选项");
ok(s.questions.every((q) => q.options.includes(q.answer)), "正确答案必须在选项里");
ok(new Set(s.questions.map((q) => q.word)).size === 50, "同一关内不出重复词");
const pickedWords = new Set(s.questions.map((q) => q.word));
ok([...pickedWords].every((w) => l0.some((x) => x.w === w)), "题目只能来自本关的词");
ok(!s.finished && s.index === 0 && s.correct === 0, "开局状态");

// ---------------- 6) 作答：答对不记错词、答错记 ----------------
const q0 = currentDrillQuestion(s)!;
s = answerDrill(s, q0.answer);
ok(s.correct === 1 && s.wrong === 0 && s.answered, "答对计 1");
ok(s.wrongWords.length === 0, "答对不该进错词");
const again = answerDrill(s, q0.options.find((o) => o !== q0.answer)!);
ok(again.correct === 1 && again.wrong === 0, "重复作答不应重复计数");

s = nextDrill(s);
const q1 = currentDrillQuestion(s)!;
const wrongChoice = q1.options.find((o) => o !== q1.answer)!;
s = answerDrill(s, wrongChoice);
ok(s.wrong === 1 && s.wrongWords.length === 1, "答错记 1 个错词");
ok(s.wrongWords[0].w === q1.word && s.wrongWords[0].m === q1.answerFull, "错词要存完整释义");
ok(drillAccuracy(s) === 0.5, `正确率应 0.5，实际 ${drillAccuracy(s)}`);

// ---------------- 7) 做完 50 题即结束（不是够了就结束） ----------------
let run = startDrill(l0, () => 0.42);
for (let i = 0; i < 50; i++) {
  const q = currentDrillQuestion(run)!;
  run = nextDrill(answerDrill(run, q.answer));
}
ok(run.finished, "答满 50 题应结束");
ok(run.correct === 50, `全答应 50 对，实际 ${run.correct}`);
ok(currentDrillQuestion(run) === null, "结束后没有当前题");
ok(drillPassed(run), "全对必过");

// 39 对 11 错不过，40 对过
let edge = startDrill(l0, () => 0.42);
for (let i = 0; i < 50; i++) {
  const q = currentDrillQuestion(edge)!;
  const useRight = i < 39;
  edge = nextDrill(answerDrill(edge, useRight ? q.answer : q.options.find((o) => o !== q.answer)!));
}
ok(edge.correct === 39 && !drillPassed(edge), "39 对不过关");
edge = startDrill(l0, () => 0.42);
for (let i = 0; i < 50; i++) {
  const q = currentDrillQuestion(edge)!;
  edge = nextDrill(answerDrill(edge, i < 40 ? q.answer : q.options.find((o) => o !== q.answer)!));
}
ok(edge.correct === 40 && drillPassed(edge), "40 对过关");

// ---------------- 8) 进度：best 取最大、passed 不回退 ----------------
store.delete("knowflow.words.drill");
let map = saveDrillResult("cet4", 0, 30, 50);
ok(map[0].passed === false && map[0].best === 30, "30 对未过关");
map = saveDrillResult("cet4", 0, 42, 50);
ok(map[0].passed === true && map[0].best === 42, "42 对过关");
map = saveDrillResult("cet4", 0, 35, 50);
ok(map[0].passed === true, "重做更差不该把「已过关」抹掉");
ok(map[0].best === 42, "best 应保留最高分");
ok(loadDrillProgress("cet4")[0].best === 42, "读回来一致");
ok(Object.keys(loadDrillProgress("cet6")).length === 0, "词库之间互不影响");

// ---------------- 9) 汇总：next 指向第一个没过的 ----------------
const partial: LevelMap = {
  0: { best: 45, total: 50, passed: true, at: "" },
  1: { best: 20, total: 50, passed: false, at: "" }
};
const sum = summarizeDrill(partial, 4424);
ok(sum.levels === 89, `关卡数应 89，实际 ${sum.levels}`);
ok(sum.cleared === 1, `已过 1 关，实际 ${sum.cleared}`);
ok(sum.wordsDone === 50, `已学 50 词，实际 ${sum.wordsDone}`);
ok(sum.next === 1, `下一关应是第 2 关（index 1），实际 ${sum.next}`);

// 断档：过了 0 和 2，next 应回到 1
const gap: LevelMap = {
  0: { best: 50, total: 50, passed: true, at: "" },
  2: { best: 50, total: 50, passed: true, at: "" }
};
ok(summarizeDrill(gap, 4424).next === 1, "断档时应先补前面没过的");

// 全过
const all: LevelMap = {};
for (let i = 0; i < 89; i++) all[i] = { best: 50, total: i === 88 ? 24 : 50, passed: true, at: "" };
const full = summarizeDrill(all, 4424);
ok(full.cleared === 89 && full.next === 89, "全过时 next 等于关卡数");
ok(full.wordsDone === 4424, `全过应覆盖 4424 词，实际 ${full.wordsDone}`);

if (failed.length) {
  console.error("\n❌ 背单词逻辑冒烟失败：");
  for (const f of failed) console.error("  •", f);
  process.exit(1);
}
console.log(`\n✅ 背单词逻辑 9 组断言全部通过（${pass} 条）`);
