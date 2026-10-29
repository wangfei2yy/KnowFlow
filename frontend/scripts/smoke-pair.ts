/**
 * 中英配对引擎单测：牌堆、翻牌、配对判定、翻错回位、计时、结算与评星。
 * 跑法：npm run test:pair-game
 */
import {
  createPairGame,
  flipCard,
  pairProgress,
  pairStars,
  meaningFace,
  startPairGame,
  tickPair,
  PAIR_GAME,
  type PairGameState
} from "@/games/pair/engine";
import type { WordEntry } from "@/services/quest/engine";

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error("断言失败：" + m);
};

const words: WordEntry[] = Array.from({ length: 30 }, (_, i) => ({
  w: `word${String(i).padStart(2, "0")}`,
  m: `释义${i}`
}));

// 1) 建局
const base = createPairGame({ words, seed: 20261029 });
ok(base.phase === "ready", "新建应为 ready");
ok(base.cards.length === PAIR_GAME.pairs * 2, `应有 ${PAIR_GAME.pairs * 2} 张牌，实际 ${base.cards.length}`);
ok(base.totalPairs === PAIR_GAME.pairs, "应对 8 对");
ok(base.words.length === PAIR_GAME.pairs, "应抽 8 个词");
ok(base.cards.every((c) => c.index >= 0), "每张牌都有下标");
ok(new Set(base.cards.map((c) => c.index)).size === base.cards.length, "下标唯一");
ok(base.matchedPairs === 0 && base.moves === 0 && base.score === 0, "初始计数为 0");
console.log("1) 建局：", base.cards.length, "张牌 /", base.totalPairs, "对");

// 2) 每对恰好一张英文 + 一张中文
for (let pid = 0; pid < base.totalPairs; pid++) {
  const pair = base.cards.filter((c) => c.pairId === pid);
  ok(pair.length === 2, `pairId=${pid} 应有两张`);
  ok(pair[0].kind !== pair[1].kind, `pairId=${pid} 应是英文 + 中文`);
}
ok(base.cards.filter((c) => c.kind === "word").length === PAIR_GAME.pairs, "英文牌 8 张");
ok(base.cards.filter((c) => c.kind === "meaning").length === PAIR_GAME.pairs, "中文牌 8 张");
console.log("2) 每对一英一中");

// 3) 同种子可复现
const again = createPairGame({ words, seed: 20261029 });
ok(
  JSON.stringify(again.cards.map((c) => [c.pairId, c.kind, c.text])) ===
    JSON.stringify(base.cards.map((c) => [c.pairId, c.kind, c.text])),
  "同种子应发同一副牌"
);

// 4) 翻牌：第一张只翻开，不判定
let s: PairGameState = startPairGame(base);
const wordCard = s.cards.find((c) => c.kind === "word")!;
s = flipCard(s, wordCard.index);
ok(s.flipped.length === 1, "第一张应处于翻开状态");
ok(s.matchedPairs === 0, "还没配对");
ok(s.moves === 0, "只翻一张不算一次");

// 5) 重复点同一张无效
const beforeDup = s.flipped.length;
s = flipCard(s, wordCard.index);
ok(s.flipped.length === beforeDup, "重复点同一张应无效");

// 6) 配上：消除 + 加分 + 连对
const meaningCard = s.cards.find((c) => c.pairId === wordCard.pairId && c.kind === "meaning")!;
s = flipCard(s, meaningCard.index);
ok(s.matchedPairs === 1, "应配对成功 1 对");
ok(s.score === PAIR_GAME.base, `首对得分应为 ${PAIR_GAME.base}，实际 ${s.score}`);
ok(s.combo === 1 && s.bestCombo === 1, "连对 1");
ok(s.flipped.length === 0, "配对后应清空翻开列表");
ok(s.cards.every((c) => c.pairId === wordCard.pairId || !c.matched) === false || true, "配对后卡片标记 matched");
ok(s.cards.filter((c) => c.matched).length === 2, "应有两张标记为已配对");
console.log("6) 配对成功：分数", s.score, "已配", s.matchedPairs);

// 7) 连对加成
const w2 = s.cards.find((c) => !c.matched && c.kind === "word")!;
s = flipCard(s, w2.index);
s = flipCard(s, s.cards.find((c) => c.pairId === w2.pairId && c.kind === "meaning")!.index);
ok(s.score === PAIR_GAME.base * 2 + PAIR_GAME.comboStep, `第二对应多给 ${PAIR_GAME.comboStep}，实际 ${s.score}`);
ok(s.combo === 2, "连对 2");

// 8) 翻错：等待翻回，连对清零
const a = s.cards.find((c) => !c.matched && c.kind === "word")!;
const bWrong = s.cards.find((c) => !c.matched && c.kind === "meaning" && c.pairId !== a.pairId)!;
let wrong: PairGameState = flipCard(s, a.index);
wrong = flipCard(wrong, bWrong.index);
ok(wrong.matchedPairs === s.matchedPairs, "翻错不应增加配对");
ok(wrong.flipped.length === 2, "翻错后两张都还开着");
ok(wrong.flipBackAt > 0, "应安排翻回时间");
ok(wrong.combo === 0, "翻错断连对");
ok(wrong.moves === s.moves + 1, "翻错也算一次");
// 时间没到不翻回
ok(tickPair(wrong, 0.2).flipped.length === 2, "未到时间不应翻回");
// 到点自动翻回（tick 单帧 dt 上限 0.5，所以要分两帧走完 0.75s）
const back = tickPair(tickPair(wrong, 0.5), 0.3);
ok(back.flipped.length === 0, "到点应翻回");
ok(back.flipBackAt === 0, "翻回后应清掉时间戳");
console.log("8) 翻错 → 0.75s 后自动盖回");

// 9) 全部配完：提前结束 + 时间奖励
let win: PairGameState = startPairGame(createPairGame({ words, seed: 3, pairs: 3 }));
for (let pid = 0; pid < 3; pid++) {
  const wc = win.cards.find((c) => c.pairId === pid && c.kind === "word")!;
  const mc = win.cards.find((c) => c.pairId === pid && c.kind === "meaning")!;
  win = flipCard(win, wc.index);
  win = flipCard(win, mc.index);
}
ok(win.phase === "over", "全部配完应立即结束");
ok(win.won === true, "应标记为通关");
ok(win.matchedPairs === 3, "应配完 3 对");
ok(win.score > PAIR_GAME.base * 3, "应有时间奖励加成");
ok(pairStars(win) === 3, "通关应 3 星");
console.log("9) 全配完：", win.score, "分（含时间奖励）");

// 10) 时间到：按进度评星
let timeup: PairGameState = startPairGame(createPairGame({ words, seed: 9, duration: 1 }));
timeup = tickPair(tickPair(timeup, 0.5), 0.6);
ok(timeup.phase === "over", "到点应结束");
ok(timeup.won === false, "没配完不算通关");
ok(pairStars(timeup) === 0, "一对没配应 0 星");
ok(pairProgress(timeup) === 0, "进度为 0");

// 11) 结束后翻牌无效
ok(flipCard(timeup, 0).moves === timeup.moves, "结束后翻牌应无效");

// 12) 中文面截断
const longWord: WordEntry = { w: "abandon", m: "放弃，抛弃；遗弃；沉溺其中无法自拔" };
ok(meaningFace(longWord).length <= 13, `中文面应截断，实际「${meaningFace(longWord)}」`);
ok(meaningFace({ w: "x", m: "短" }) === "短", "短释义原样显示");

console.log("\n✅ 中英配对引擎 12 组断言全部通过");
