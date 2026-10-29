import {
  buildQuestions,
  startSession,
  answerCurrent,
  nextQuestion,
  currentQuestion,
  accuracy,
  saveProgress,
  loadProgress,
  shuffle
} from "@/services/quest/engine";
import type { WordEntry } from "@/services/quest/engine";

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error("断言失败：" + m);
};

/** 可复现的伪随机 */
function seeded(seed = 1) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

const words: WordEntry[] = Array.from({ length: 40 }, (_, i) => ({
  w: `word${i}`,
  p: `/w${i}/`,
  m: `释义${i}`
}));

// 1) 出题：数量、选项数、含正确答案
const qs = buildQuestions(words, 10, seeded(7));
ok(qs.length === 10, "应生成 10 题");
ok(qs.every((q) => q.options.length === 4), "每题应有 4 个选项");
ok(qs.every((q) => q.options.includes(q.answer)), "选项必须包含正确答案");
ok(qs.every((q) => new Set(q.options).size === 4), "选项不应重复");
const uniqWords = new Set(qs.map((q) => q.word));
ok(uniqWords.size === 10, "同一局不应出现重复单词");

// 2) shuffle 不丢元素
const sh = shuffle([1, 2, 3, 4, 5], seeded(3));
ok(sh.length === 5 && new Set(sh).size === 5, "shuffle 应保持元素集");

// 3) 答对：加分 + 连击
let s = startSession(words, { size: 3, lives: 3, rng: seeded(11) });
const q1 = currentQuestion(s)!;
s = answerCurrent(s, q1.answer);
ok(s.score === 10, `首题答对应得 10 分，实际 ${s.score}`);
ok(s.streak === 1 && s.correctCount === 1, "连击/正确数应 +1");
ok(s.lives === 3, "答对不应扣命");
ok(s.answered === true, "应标记已作答");
s = nextQuestion(s);
const q2 = currentQuestion(s)!;
s = answerCurrent(s, q2.answer);
console.log("3) 连对两题得分:", s.score, "连击:", s.streak);
ok(s.score === 10 + 12, `连击加成应为 +12，实际 ${s.score}`);
s = nextQuestion(s);

// 4) 答错：扣命 + 记录错词（重复作答不生效）
const q3 = currentQuestion(s)!;
const wrongOption = q3.options.find((o) => o !== q3.answer)!;
s = answerCurrent(s, wrongOption);
ok(s.lives === 2, "答错应扣 1 条命");
ok(s.wrongWords.length === 1 && s.wrongWords[0].w === q3.word, "应记录错词");
const livesAfter = s.lives;
s = answerCurrent(s, wrongOption);
ok(s.lives === livesAfter, "重复作答不应再次扣命");

// 5) 生命耗尽即结束
let s2 = startSession(words, { size: 10, lives: 1, rng: seeded(5) });
const qq = currentQuestion(s2)!;
s2 = answerCurrent(s2, qq.options.find((o) => o !== qq.answer)!);
ok(s2.finished === true, "生命耗尽应立即结束");
ok(currentQuestion(s2) === null, "结束后无当前题");

// 6) 答完所有题结束
let s3 = startSession(words, { size: 2, lives: 5, rng: seeded(9) });
s3 = answerCurrent(s3, currentQuestion(s3)!.answer);
s3 = nextQuestion(s3);
ok(!s3.finished, "第 1 题后不应结束");
s3 = answerCurrent(s3, currentQuestion(s3)!.answer);
s3 = nextQuestion(s3);
ok(s3.finished === true, "答完全部题目应结束");
ok(accuracy(s3) === 1, "全对正确率应为 1");

// 7) 进度读写
saveProgress("cet4", 30);
const p1 = saveProgress("cet4", 20);
console.log("7) 进度:", JSON.stringify(p1), JSON.stringify(loadProgress().cet4));
ok(p1.bestScore === 30, "最高分不应被更低分覆盖");
ok(p1.plays === 2, "局数应累加");
ok(loadProgress().cet4.bestScore === 30, "进度应持久化");

// 8) 词库不足时不出题
ok(buildQuestions(words.slice(0, 2), 10).length === 0, "词量不足 4 时不应出题");

console.log("QUEST SMOKE PASS");
process.exit(0);
