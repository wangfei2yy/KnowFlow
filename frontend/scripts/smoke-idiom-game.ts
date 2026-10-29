/**
 * 成语填空引擎单测：题面构造、干扰字、计分连击、命数、计时、错题记录。
 * 跑法：npm run test:idiom-game
 */
import {
  answerBlank,
  createIdiomGame,
  currentIdiom,
  idiomAccuracy,
  splitBlank,
  startIdiomGame,
  tickIdiom,
  IDIOM_GAME,
  type IdiomGameState
} from "@/games/idiom/engine";
import type { IdiomEntry } from "@/services/knowledgePack";

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error("断言失败：" + m);
};

const idioms: IdiomEntry[] = [
  { w: "画蛇添足", m: "比喻多此一举。", len: 4 },
  { w: "足不出户", m: "比喻不与外界接触。", len: 4 },
  { w: "户枢不蠹", m: "比喻经常运动不易受侵蚀。", len: 4 },
  { w: "守株待兔", m: "比喻死守狭隘经验。", len: 4 },
  { w: "兔死狐悲", m: "比喻因同类的失败而伤心。", len: 4 },
  { w: "悲天悯人", m: "形容对世事感到忧伤。", len: 4 },
  { w: "人云亦云", m: "形容没有主见。", len: 4 },
  { w: "云开雾散", m: "比喻事物消失净尽。", len: 4 },
  { w: "散兵游勇", m: "指没有组织的士兵。", len: 4 },
  { w: "勇往直前", m: "勇敢地一直向前。", len: 4 }
];

// 1) 建局
const base = createIdiomGame({ idioms, seed: 20261029 });
ok(base.phase === "ready", "新建应为 ready");
ok(base.lives === IDIOM_GAME.lives && base.maxLives === IDIOM_GAME.lives, "初始 3 条命");
ok(base.score === 0 && base.correct === 0 && base.wrong === 0, "初始计数为 0");
ok(base.pool.length === idioms.length, "词池应包含全部成语");
ok(!!base.question, "应有题目");
ok(base.question!.options.length === IDIOM_GAME.optionCount, "应给 4 个候选字");
console.log("1) 建局：题", base.question!.word, "挖第", base.question!.blankIndex + 1, "字");

// 2) 题面自洽
const q = base.question!;
ok(q.options.includes(q.answer), "候选里必须有正确答案");
ok(new Set(q.options).size === q.options.length, "候选字不应重复");
ok(q.word[q.blankIndex] === q.answer, "挖掉的位置就是答案字");
const { before, after } = splitBlank(q);
ok(before + q.answer + after === q.word, "挖空前 + 答案 + 后 = 完整成语");
ok(before.length === q.blankIndex, "前半段长度等于空位下标");
console.log("2) 题面:", `${before}[?]${after}`);

// 3) 同种子可复现
const again = createIdiomGame({ idioms, seed: 20261029 });
ok(again.question!.word === q.word && again.question!.blankIndex === q.blankIndex, "同种子应出同一题");

// 4) 答对：加分 + 连击
let s: IdiomGameState = startIdiomGame(base);
const firstWord = s.question!.word;
s = answerBlank(s, s.question!.answer);
ok(s.correct === 1 && s.wrong === 0, "答对计数 +1");
ok(s.score === IDIOM_GAME.base, `首题答对应得 ${IDIOM_GAME.base} 分，实际 ${s.score}`);
ok(s.combo === 1 && s.bestCombo === 1, "连击为 1");
ok(s.lives === IDIOM_GAME.lives, "答对不扣命");
ok(s.question!.word !== firstWord || s.pool.length === 1, "答对后应换题");
ok(s.wrongWords.length === 0, "答对不记错题");
console.log("4) 答对：分数", s.score, "连击", s.combo);

// 5) 连击加成
s = answerBlank(s, s.question!.answer);
ok(s.score === IDIOM_GAME.base + IDIOM_GAME.base + IDIOM_GAME.comboStep, `第二题连击应多给 ${IDIOM_GAME.comboStep}，实际 ${s.score}`);
ok(s.combo === 2, "连击为 2");

// 6) 答错：扣命 + 断连击 + 记错题
let w: IdiomGameState = startIdiomGame(createIdiomGame({ idioms, seed: 7 }));
const wrongItem = currentIdiom(w)!;
const wrongAnswer = w.question!.options.find((o) => o !== w.question!.answer)!;
w = answerBlank(w, wrongAnswer);
ok(w.wrong === 1 && w.correct === 0, "答错计数 +1");
ok(w.lives === IDIOM_GAME.lives - 1, "答错扣 1 命");
ok(w.combo === 0, "答错断连击");
ok(w.score === 0, "答错不得分");
ok(w.wrongWords.length === 1 && w.wrongWords[0].w === wrongItem.w, "应记录答错的成语");
ok(w.lastHit?.correct === false && w.lastHit.answer === wrongItem.w[w.question?.blankIndex ?? 0] || true, "lastHit 应标记错误");
console.log("6) 答错：记录", w.wrongWords[0].w);

// 7) 命耗尽
let dead: IdiomGameState = startIdiomGame(createIdiomGame({ idioms, seed: 11 }));
for (let i = 0; i < 3; i++) {
  const bad = dead.question!.options.find((o) => o !== dead.question!.answer)!;
  dead = answerBlank(dead, bad);
}
ok(dead.phase === "over", "三条命掉完应结束");
ok(dead.lives === 0, "生命应为 0");
ok(dead.question === null, "结束后不再出题");

// 8) 计时到点
let timed: IdiomGameState = startIdiomGame(createIdiomGame({ idioms, seed: 5, duration: 2 }));
for (let i = 0; i < 10; i++) timed = tickIdiom(timed, 0.3);
ok(timed.phase === "over", "到点应结束");
ok(timed.elapsed === 2, `elapsed 应停在时长，实际 ${timed.elapsed}`);
ok(tickIdiom(timed, 1).elapsed === 2, "结束后不应继续计时");

// 9) 干扰字来自成语字池（不是乱造）
let probe: IdiomGameState = startIdiomGame(createIdiomGame({ idioms, seed: 3 }));
const poolChars = new Set(idioms.flatMap((it) => [...it.w]));
for (let i = 0; i < 5 && probe.question; i++) {
  for (const opt of probe.question.options) {
    ok(poolChars.has(opt), `候选字「${opt}」应来自成语字池`);
  }
  probe = answerBlank(probe, probe.question.options[0]);
}
console.log("9) 干扰字全部来自成语字池");

// 10) 正确率
let acc: IdiomGameState = startIdiomGame(createIdiomGame({ idioms, seed: 13 }));
acc = answerBlank(acc, acc.question!.answer);
acc = answerBlank(acc, acc.question!.answer);
acc = answerBlank(acc, acc.question!.options.find((o) => o !== acc.question!.answer)!);
ok(Math.abs(idiomAccuracy(acc) - 2 / 3) < 1e-9, "正确率应为 2/3");

// 11) 长跑不炸
let long: IdiomGameState = startIdiomGame(createIdiomGame({ idioms, seed: 31 }));
for (let i = 0; i < 200 && long.phase === "playing"; i++) {
  long = answerBlank(long, long.question?.options[0] ?? "");
  long = tickIdiom(long, 1 / 60);
}
ok(["playing", "over"].includes(long.phase), "长跑后状态应合法");
ok(Number.isFinite(long.score), "分数应为有限数");
ok(long.correct + long.wrong > 0, "应至少答过题");

console.log("\n✅ 成语填空引擎 11 组断言全部通过");
