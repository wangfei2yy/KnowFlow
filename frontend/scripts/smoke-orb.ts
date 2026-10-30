/**
 * 球球引擎单测：不碰 DOM、不碰 canvas，纯状态推进。
 * 跑法：npm run test:orb
 */
import { LIFE_RULE } from "@/games/lives";
import {
  createOrbGame,
  startOrb,
  stepOrb,
  cameraScale,
  tierOf,
  targetLabel,
  fullLabel,
  timeText,
  orbAccuracy,
  fieldRadius,
  moveSpeed,
  spellSimilarity,
  difficultyOf,
  CAMERA_MIN,
  screenSpeed,
  DIFFICULTIES,
  ORB,
  TIERS,
  type OrbState,
  type WordEntry
} from "@/games/orb/engine";

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error("断言失败：" + m);
};

const words: WordEntry[] = Array.from({ length: 60 }, (_, i) => ({
  w: `word${String(i).padStart(2, "0")}`,
  p: `/w${i}/`,
  m: `释义${i}`
}));

/** 稳定推进 n 帧（1/60 秒），方向固定 */
function run(state: OrbState, frames: number, dir = { x: 0, y: 0 }, dt = 1 / 60): OrbState {
  let s = state;
  for (let i = 0; i < frames; i++) s = stepOrb(s, dt, dir);
  return s;
}

/** 把玩家挪到最近的某个球上，制造一次「吃」 */
function eat(state: OrbState, correct: boolean): OrbState {
  const food = state.foods.find((f) => f.correct === correct);
  ok(!!food, `场上应存在 ${correct ? "正确" : "错误"} 球`);
  const moved: OrbState = {
    ...state,
    player: { ...state.player, x: food!.x, y: food!.y, vx: 0, vy: 0 }
  };
  return stepOrb(moved, 1 / 60, { x: 0, y: 0 });
}

// ---------------- 1) 建局 ----------------
const base = createOrbGame({ words, seed: 20261029, difficulty: "expert" });
ok(base.phase === "ready", "新建应为 ready");
ok(base.lives === ORB.lives && base.maxLives === LIFE_RULE.cap, `初始 ${ORB.lives} 条命、上限 ${LIFE_RULE.cap}`);
ok(base.player.r === ORB.startR, "初始半径 40");
ok(base.foods.length === 10, `困难档场上应有 10 个球，实际 ${base.foods.length}`);
ok(base.foods.filter((f) => f.correct).length === 1, "场上必须恰好 1 个正确球");
ok(!!base.target, "应有目标词");
ok(base.pool.length === Math.min(ORB.poolSize, words.length), "词池应截断到 30 个");
ok(base.score === 0 && base.elapsed === 0, "初始分数与时间应为 0");
console.log("1) 建局：球数", base.foods.length, "词池", base.pool.length, "层级", TIERS[base.tier].name);

// 正确球的词必须等于目标词
const correctFood = base.foods.find((f) => f.correct)!;
ok(correctFood.word === base.target!.w, "正确球应写着目标词");
// 其它球不能写同样的词（否则一个题意两个答案）
const dupCount = base.foods.filter((f) => f.word === base.target!.w).length;
ok(dupCount === 1, `目标词在场上只应出现 1 次，实际 ${dupCount}`);
ok(new Set(base.foods.map((f) => f.word)).size === base.foods.length, "食物球不应重复用词");

// ---------------- 2) 同一 seed 可复现 ----------------
const again = createOrbGame({ words, seed: 20261029, difficulty: "expert" });
ok(
  JSON.stringify(again.foods.map((f) => [f.word, f.correct])) ===
    JSON.stringify(base.foods.map((f) => [f.word, f.correct])),
  "同一种子应生成同一局"
);

// ---------------- 3) 吃对 ----------------
let s = startOrb(base);
const before = { r: s.player.r, score: s.score, word: s.target!.w };
s = eat(s, true);
ok(Math.abs(s.player.r - before.r * ORB.grow) < 1e-9, `吃对半径应 ×${ORB.grow}`);
ok(s.score === 10, `首题答对应得 10 分，实际 ${s.score}`);
ok(s.correct === 1 && s.wrong === 0, "答对计数 +1");
ok(s.combo === 1 && s.bestCombo === 1, "连击应为 1");
ok(s.lives === ORB.lives, "答对不扣命");
ok(s.target!.w !== before.word, "答对后应换目标词");
ok(s.foods.length === s.options, "吃掉一个应立刻补位");
ok(s.foods.filter((f) => f.correct).length === 1, "换目标后仍应恰好 1 个正确球");
ok(s.foods.find((f) => f.correct)!.word === s.target!.w, "正确球应换成新目标词");
ok(s.wrongWords.length === 0, "答对不该记错词");

// 连击加成：第二次答对 +12
s = eat(s, true);
ok(s.score === 10 + 12, `连击加成应为 +12，实际 ${s.score}`);
ok(s.combo === 2, "连击应为 2");
console.log("3) 连对两题：分数", s.score, "半径", s.player.r.toFixed(2), "连击", s.combo);

// ---------------- 4) 吃错 ----------------
let w = startOrb(createOrbGame({ words, seed: 7 }));
const targetBefore = w.target!.w;
const rBefore = w.player.r;
w = eat(w, false);
ok(Math.abs(w.player.r - rBefore * ORB.shrink) < 1e-9, `吃错半径应 ×${ORB.shrink}`);
ok(w.lives === ORB.lives - 1, "吃错扣 1 命");
ok(w.score === 0, "吃错不得分");
ok(w.combo === 0, "吃错连击清零");
ok(w.shake > 0, "吃错应触发抖动");
ok(w.target!.w === targetBefore, "吃错后目标词不变，还得继续找它");
ok(w.wrongWords.length === 1 && w.wrongWords[0].w === targetBefore, "错词应记录目标词");
ok(w.correct === 0 && w.wrong === 1, "答错计数 +1");
ok(w.foods.filter((f) => f.correct).length === 1, "吃错后正确球仍在场上");

// ---------------- 5) 半径下限 ----------------
// 命给足，只验证「球不会越吃越小到消失」
let min = startOrb(createOrbGame({ words, seed: 11, lives: 99 }));
for (let i = 0; i < 25; i++) min = eat(min, false);
ok(Math.abs(min.player.r - ORB.minR) < 1e-9, `连续吃错应停在下限 ${ORB.minR}，实际 ${min.player.r}`);
ok(min.phase === "playing", "还有命时应继续");

// ---------------- 6) 命耗尽 ----------------
let dead = startOrb(createOrbGame({ words, seed: 3 }));
dead = eat(dead, false);
dead = eat(dead, false);
ok(dead.phase === "playing", "掉两条命还没结束");
dead = eat(dead, false);
ok(dead.phase === "over", "第三条命掉完应结束");
ok(dead.lives === 0, "生命应为 0");
const scoreAtOver = dead.score;
const afterOver = run(dead, 30, { x: 1, y: 0 });
ok(afterOver.score === scoreAtOver, "结束后再推进不应改变分数");

// ---------------- 7) 时间到 ----------------
let timed = startOrb(createOrbGame({ words, seed: 5, duration: 2 }));
// 60 帧 × 1/60 × 4 = 4 秒，超过 2 秒的时长
timed = run(timed, 240);
ok(timed.phase === "over", "时间到应结束");
ok(timed.elapsed === 2, `结束后 elapsed 应停在时长上，实际 ${timed.elapsed}`);

// ---------------- 8) dt 夹取 ----------------
let jump = startOrb(createOrbGame({ words, seed: 9 }));
const posBefore = { x: jump.player.x, y: jump.player.y };
jump = stepOrb(jump, 5, { x: 1, y: 0 }); // 切标签回来 dt=5s
const moved = Math.hypot(jump.player.x - posBefore.x, jump.player.y - posBefore.y);
// 夹到 100ms：速度 300 → 一帧最多 30 世界像素（含加速平滑，约 27）
ok(moved > 20 && moved < 40, `dt 应被夹到 100ms，5 秒只该走一小步，实际 ${moved.toFixed(1)}`);

// ---------------- 9) 相机 / 层级 / 屏幕速度 ----------------
ok(cameraScale(ORB.startR) === 1, "初始半径时相机不缩放");
ok(Math.abs(cameraScale(ORB.maxR) - CAMERA_MIN) < 1e-9, `到上限时相机缩到 ${CAMERA_MIN}`);
ok(cameraScale(100000) === CAMERA_MIN, "相机下限就是 CAMERA_MIN，超出半径也不再继续缩");
ok(cameraScale(ORB.minR) === 1, "吃错缩小后不放大视野（不超过 1）");
// 视野只轻微后撤：可见面积 ≤ 1.8 倍，绘制量才控得住
const areaGrow = 1 / (CAMERA_MIN * CAMERA_MIN);
ok(areaGrow < 2, `满级时可见面积应 ≤2 倍（实际 ${areaGrow.toFixed(2)} 倍），否则背景绘制量翻几倍`);
// 球在屏幕上会真的长大，但幅度温和（40 → ~57px）
const screenMin = ORB.startR * cameraScale(ORB.startR);
const screenMax = ORB.maxR * cameraScale(ORB.maxR);
ok(screenMax > screenMin, "球越大，屏幕上也确实更大（成长要看得见）");
ok(screenMax / screenMin < 1.5, `屏幕半径增长应温和（<1.5 倍），实际 ${(screenMax / screenMin).toFixed(2)} 倍`);

// 层级改按「吃对个数」
ok(tierOf(0) === 0 && tierOf(5) === 0, "0~5 个都是村庄");
ok(tierOf(6) === 1, "吃对 6 个进城镇");
ok(tierOf(13) === 1 && tierOf(14) === 2, "14 个进城市");
ok(tierOf(80) === TIERS.length - 1, "80 个到太阳系");
ok(tierOf(9999) === TIERS.length - 1, "超出上限停在最高层");

ok(fieldRadius(40) < fieldRadius(600), "球越大，可吃区域越大");

// 屏幕速度恒定：世界速度 × 缩放 = speedBase
for (const r of [ORB.startR, ORB.maxR]) {
  const perSec = moveSpeed(r) * cameraScale(r);
  ok(Math.abs(perSec - ORB.speedBase) < 1e-6, `r=${r} 时屏幕速度应恒为 ${ORB.speedBase}，实际 ${perSec.toFixed(2)}`);
  ok(Math.abs(perSec - screenSpeed()) < 1e-6, "屏幕速度应与半径无关（这就是「不变慢」的保证）");
}
ok(moveSpeed(ORB.maxR) > moveSpeed(ORB.startR), "球大了世界速度要更快（补偿视野缩小），不能更慢");

// ---------------- 10) 干扰项是形近词 ----------------
const sim = spellSimilarity("adapt", "adopt");
ok(sim > spellSimilarity("adapt", "zebra"), "形近词相似度应更高");
let pool = startOrb(createOrbGame({ words, seed: 21 }));
ok(pool.foods.length === pool.options, "干扰项数量正确");
ok(new Set(pool.foods.map((f) => f.word)).size === pool.foods.length, "干扰项不重复");

// ---------------- 11) 展示辅助 ----------------
const longWord: WordEntry = { w: "abandon", m: "放弃，抛弃；遗弃；沉溺" };
ok(targetLabel(longWord) === "放弃，抛弃", `短义应保留第一个义项（含逗号），实际 ${targetLabel(longWord)}`);
ok(targetLabel(longWord, 2) === "放弃…", `限制 2 字时应截断并省略，实际 ${targetLabel(longWord, 2)}`);
ok(targetLabel({ w: "x", m: "adj. 准时的，守时的；精确的" }).length >= 5, "释义不应只留逗号前两个字");
ok(targetLabel(null) === "", "空目标返回空串");
// 词性前缀要去掉：球上空间小，「n. 假期」不如「假期」
ok(targetLabel({ w: "vacation", m: "n. 假期；休假" }) === "假期", "应去掉词性前缀 n.");
ok(targetLabel({ w: "run", m: "vt. 跑；经营" }) === "跑", "应去掉 vt.");
ok(targetLabel({ w: "x", m: "n." }) === "n.", "只有词性时保留原文");

// 顶部提示用完整释义：保留全部义项，词性换成「；」分隔
ok(
  fullLabel({ w: "x", m: "adj. 准时的，守时的；精确的" }) === "准时的，守时的；精确的",
  `完整释义应保留所有义项，实际 ${fullLabel({ w: "x", m: "adj. 准时的，守时的；精确的" })}`
);
ok(
  fullLabel({ w: "cost", m: "n.成本,价钱,代价vt.价值为" }) === "成本,价钱,代价；价值为",
  `词性应变成义项分隔，实际 ${fullLabel({ w: "cost", m: "n.成本,价钱,代价vt.价值为" })}`
);
// 球内短义只到第一个义项，顶部要更长 —— 这正是这次改动要保证的
const longM = { w: "x", m: "adj. 准时的，守时的；精确的，准确的" };
ok(fullLabel(longM).length > targetLabel(longM).length, "顶部释义必须比球内短义更长");
ok(fullLabel(longM, 4) === "准时的，…", `limit 4 应截断（保留前 4 字），实际 ${fullLabel(longM, 4)}`);
ok(fullLabel(null) === "" && fullLabel({ w: "x", m: "" }) === "", "空目标返回空串");
ok(timeText(60) === "1:00" && timeText(9) === "0:09" && timeText(-1) === "0:00", "计时文案");
ok(orbAccuracy(startOrb(createOrbGame({ words, seed: 4 }))) === 0, "没答过时正确率为 0");

// 结算数据自洽
let acc = startOrb(createOrbGame({ words, seed: 17, lives: 9 }));
acc = eat(acc, true);
acc = eat(acc, true);
acc = eat(acc, false);
ok(Math.abs(orbAccuracy(acc) - 2 / 3) < 1e-9, "正确率 = 2/3");

// ---------------- 12) 长时间跑帧不炸 ----------------
let budget = startOrb(createOrbGame({ words, seed: 31 }));
for (let i = 0; i < 1000; i++) {
  const dir = { x: Math.sin(i / 30), y: Math.cos(i / 47) };
  budget = stepOrb(budget, 1 / 60, dir);
  if (budget.phase === "over") break;
}
ok(Number.isFinite(budget.player.x) && Number.isFinite(budget.player.y), "坐标不应变成 NaN");
ok(budget.foods.length <= budget.options + 1, "球数不应无限增长");
ok(budget.foods.every((f) => Number.isFinite(f.x) && Number.isFinite(f.y)), "球坐标不应 NaN");
console.log("12) 跑 1000 帧：得分", budget.score, "正确", budget.correct, "错误", budget.wrong, "球数", budget.foods.length);

// ---------------- 13) 连对 3 个回一格（上限 5）----------------
let heal = startOrb(createOrbGame({ words, seed: 41 }));
heal = eat(heal, false);
ok(heal.lives === ORB.lives - 1, "吃错掉一格");
heal = eat(heal, true);
heal = eat(heal, true);
ok(heal.lives === ORB.lives - 1, "连对 2 个还不回血");
heal = eat(heal, true);
ok(heal.lives === ORB.lives, "连对第 3 个回一格");

// 答错清零重新数：2 对 + 1 错 + 2 对 不应回血
let reset = startOrb(createOrbGame({ words, seed: 42 }));
reset = eat(reset, false);
reset = eat(reset, true);
reset = eat(reset, true);
reset = eat(reset, false);
reset = eat(reset, true);
reset = eat(reset, true);
ok(reset.lives === ORB.lives - 2, "答错后连对数应重新开始，不能凑满 3 个就回血");

// 连对 9 个：4 → 5 之后封顶
let capped = startOrb(createOrbGame({ words, seed: 43 }));
for (let i = 0; i < 9; i++) capped = eat(capped, true);
ok(capped.lives === LIFE_RULE.cap, `连对 9 个应停在 ${LIFE_RULE.cap} 格，实际 ${capped.lives}`);
console.log("13) 回血：连对 3 个 +1，封顶", capped.lives, "格");

// ---------------- 14) 半径封顶 + 一帧只吃一个 ----------------
// 用户反馈「越吃越大，会一次吃到多个」：判定范围是 r×eatFactor，r 无上限时能吞掉半屏
let growRun = startOrb(createOrbGame({ words, seed: 61, lives: 99 }));
for (let i = 0; i < 20; i++) growRun = eat(growRun, true);
ok(growRun.player.r === ORB.maxR, `连吃 20 个半径应停在上限 ${ORB.maxR}，实际 ${growRun.player.r.toFixed(1)}`);
ok(
  growRun.player.r * ORB.eatFactor < fieldRadius(growRun.player.r),
  "判定半径必须远小于场地（否则会一口好几个）"
);

// 一帧只结算一个：把两个球都摆到玩家身上，推进一帧应该只少一个
const two = startOrb(createOrbGame({ words, seed: 62, lives: 99 }));
const [f1, f2] = two.foods;
const stacked: OrbState = {
  ...two,
  player: { ...two.player, r: ORB.maxR, x: f1.x, y: f1.y, vx: 0, vy: 0 },
  foods: two.foods.map((f, i) => (i === 0 || i === 1 ? { ...f, x: f1.x, y: f1.y } : f))
};
const afterOne = stepOrb(stacked, 1 / 60, { x: 0, y: 0 });
const eatenCount = stacked.foods.length - afterOne.foods.length;
ok(eatenCount <= 1, `一帧最多吃一个，实际吃了 ${eatenCount} 个（f2=${f2.word}）`);

console.log("14) 半径封顶", ORB.maxR, "，一帧最多吃 1 个");

// ---------------- 15) 四档难度：4 / 6 / 8 / 10 ----------------
const wanted: [string, number][] = [
  ["easy", 4],
  ["normal", 6],
  ["hard", 8],
  ["expert", 10]
];
ok(DIFFICULTIES.length === 4, `难度应有 4 档，实际 ${DIFFICULTIES.length}`);
for (const [id, n] of wanted) {
  const g = createOrbGame({ words, seed: 77, difficulty: id as never });
  ok(g.difficulty === id, `${id} 档应写进 state`);
  ok(g.options === n, `${id} 档应为 ${n} 个待选，实际 ${g.options}`);
  ok(g.foods.length === n, `${id} 档场上应有 ${n} 个球，实际 ${g.foods.length}`);
  ok(g.foods.filter((f) => f.correct).length === 1, `${id} 档也要恰好 1 个正确球`);
  ok(new Set(g.foods.map((f) => f.word)).size === n, `${id} 档的球不能重词`);
}
// 选项少时场地跟着收，避免 4 个球铺满 10 个球的场地
ok(fieldRadius(40, 4) < fieldRadius(40, 10), "简单档场地应比困难档小");
ok(fieldRadius(40, 10) === fieldRadius(40), "不传选项时按默认档（困难）算");
// 认不出来的档位回落普通，别把难度弄丢
ok(difficultyOf("nope").id === "normal", "未知档位应回落普通档");
ok(difficultyOf(undefined).id === "normal", "不传档位默认普通");
ok(createOrbGame({ words, seed: 78 }).options === 6, "不指定难度时默认 6 个待选");
console.log("15) 难度档：", wanted.map(([id, n]) => `${difficultyOf(id).name}${n}`).join(" / "));

// ---------------- 16) 吃再大，屏幕速度也不变 ----------------
// 直接把半径写死跑 1 秒（不吃东西），比较「走过的屏幕距离」
function screenTravel(r: number): number {
  let g = startOrb(createOrbGame({ words, seed: 91, difficulty: "normal", lives: 99 }));
  g = { ...g, player: { ...g.player, r, x: 0, y: 0, vx: 0, vy: 0 }, foods: [] };
  for (let i = 0; i < 120; i++) g = stepOrb(g, 1 / 120, { x: 1, y: 0 });
  return g.player.x * cameraScale(g.player.r);
}
const travelStart = screenTravel(ORB.startR);
const travelMax = screenTravel(ORB.maxR);
ok(
  Math.abs(travelStart - travelMax) < 1,
  `r=40 走 ${travelStart.toFixed(1)}px、r=76 走 ${travelMax.toFixed(1)}px，屏幕距离必须一致`
);
ok(travelStart > 200, `1 秒应能走过 ${ORB.speedBase}px 左右（含起步加速），实际 ${travelStart.toFixed(1)}`);

// 帧率掉到 20fps 也不该变慢：用 1/120 固定步长补帧，等价于 60fps
function travelWithSteps(stepSeconds: number, totalSeconds: number): number {
  let g = startOrb(createOrbGame({ words, seed: 93, difficulty: "normal", lives: 99 }));
  g = { ...g, player: { ...g.player, r: ORB.maxR, x: 0, y: 0, vx: 0, vy: 0 }, foods: [] };
  let acc = 0;
  let left = totalSeconds;
  while (left > 0) {
    // 模拟「每帧真实间隔 = stepSeconds」，再按 1/120 补步 —— 与页面主循环一致
    acc += stepSeconds;
    left -= stepSeconds;
    while (acc >= 1 / 120) {
      g = stepOrb(g, 1 / 120, { x: 1, y: 0 });
      acc -= 1 / 120;
    }
  }
  return g.player.x * cameraScale(g.player.r);
}
const at60 = travelWithSteps(1 / 60, 1);
const at20 = travelWithSteps(1 / 20, 1);
ok(Math.abs(at60 - at20) < 1, `60fps 走 ${at60.toFixed(1)}、20fps 走 ${at20.toFixed(1)}，掉帧不该变慢`);

console.log("16) 1 秒屏幕位移：", travelStart.toFixed(1), "px（起始）→", travelMax.toFixed(1), "px（最大）");

console.log("\n✅ 球球引擎 16 组断言全部通过");
