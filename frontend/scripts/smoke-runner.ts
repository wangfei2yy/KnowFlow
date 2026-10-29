/**
 * 单词跑酷引擎单测：波次生成、穿门判定、换道、计分、命数、加速、计时、不限时。
 * 跑法：npm run test:runner
 */
import {
  createRunnerGame,
  moveLane,
  runnerAccuracy,
  setLane,
  startRunner,
  stepRunner,
  RUNNER,
  type RunnerState
} from "@/games/runner/engine";
import type { WordEntry } from "@/services/quest/engine";

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error("断言失败：" + m);
};

const words: WordEntry[] = Array.from({ length: 40 }, (_, i) => ({
  w: `word${String(i).padStart(2, "0")}`,
  m: `释义${i}`
}));

/** 等一波新的门，然后换到指定对错的那条道并跑完这一波 */
function playNextWave(s: RunnerState, wantCorrect: boolean): RunnerState {
  let state = s;
  for (let i = 0; i < 900; i++) {
    if (state.phase !== "playing") return state;
    if (state.gates.some((g) => !g.resolved)) break;
    state = stepRunner(state, 1 / 60);
  }
  const gate = state.gates.find((g) => !g.resolved && g.correct === wantCorrect);
  if (!gate) throw new Error("这一波里找不到目标类型的门");
  state = setLane(state, gate.lane);
  return runUntilResolved(state);
}

/** 一直推进到「三扇门都判定完」为止 */
function runUntilResolved(s: RunnerState, limit = 400): RunnerState {
  let state = s;
  for (let i = 0; i < limit; i++) {
    state = stepRunner(state, 1 / 60);
    if (state.phase !== "playing") return state;
    if (state.gates.length && state.gates.every((g) => g.resolved)) return state;
  }
  throw new Error("推进超时：门没有被判定");
}

// 1) 建局
const base = createRunnerGame({ words, seed: 20261029 });
ok(base.phase === "ready", "新建应为 ready");
ok(base.lane === 1, "玩家初始在中间道");
ok(base.gates.length === RUNNER.lanes, `应生成 ${RUNNER.lanes} 扇门，实际 ${base.gates.length}`);
ok(base.gates.filter((g) => g.correct).length === 1, "每波恰好 1 个正确");
ok(new Set(base.gates.map((g) => g.lane)).size === RUNNER.lanes, "三扇门分别在三条道");
ok(base.gates.every((g) => g.x === RUNNER.spawnX), "门都从同一起点生成");
ok(base.gates.find((g) => g.correct)!.word === base.target!.w, "正确门写的必须是目标词");
ok(!!base.label, "应有中文提示");
console.log("1) 建局：", base.gates.map((g) => g.lane + ":" + g.word).join(" / "));

// 2) 同种子可复现
const again = createRunnerGame({ words, seed: 20261029 });
ok(
  JSON.stringify(again.gates.map((g) => [g.lane, g.word, g.correct])) ===
    JSON.stringify(base.gates.map((g) => [g.lane, g.word, g.correct])),
  "同种子应生成同一波"
);

// 3) 换道边界
let lane: RunnerState = startRunner(base);
ok(lane.phase === "playing", "start 后应进入 playing");
ok(moveLane(lane, -1).lane === 0, "中间道向上应到 0");
ok(moveLane(lane, 1).lane === 2, "中间道向下应到 2");
const top: RunnerState = { ...lane, lane: 0 };
ok(moveLane(top, -1).lane === 0, "已在最上不能再上");
const bottom: RunnerState = { ...lane, lane: 2 };
ok(moveLane(bottom, 1).lane === 2, "已在最下不能再下");
ok(setLane(lane, 2).lane === 2, "setLane 可直接跳");
ok(setLane(lane, 99).lane === 2, "setLane 越界应夹住");
ok(setLane(lane, -5).lane === 0, "setLane 负值应夹住");
console.log("3) 换道 OK（0~2 边界夹住）");

// 4) 穿对：加分 + 连击 + 加速
let good: RunnerState = startRunner(createRunnerGame({ words, seed: 7 }));
const correctLane = good.gates.find((g) => g.correct)!.lane;
good = setLane(good, correctLane);
good = runUntilResolved(good);
ok(good.correct === 1, `穿对应记 1 次，实际 ${good.correct}`);
ok(good.score === RUNNER.base, `首次穿对应得 ${RUNNER.base} 分，实际 ${good.score}`);
ok(good.combo === 1, "连击 1");
ok(good.lives === RUNNER.lives, "穿对不扣命");
// 速度在每帧开头按当前分数重算，所以得分那一帧还没变，多跑一帧再断言
good = stepRunner(good, 1 / 60);
ok(good.speed > RUNNER.baseSpeed, `穿对后应提速，实际 ${good.speed}`);
console.log("4) 穿对：分数", good.score, "速度", good.speed.toFixed(0));

// 5) 连击加成（等下一波再穿对）
const good2 = playNextWave(good, true);
ok(good2.combo === 2, `应连上 2，实际 ${good2.combo}`);
ok(
  good2.score === RUNNER.base * 2 + RUNNER.comboStep,
  `第二波应多给 ${RUNNER.comboStep}，实际 ${good2.score}`
);

// 6) 穿错：扣命 + 断连击 + 记错词
let bad: RunnerState = startRunner(createRunnerGame({ words, seed: 11 }));
const targetWord = bad.target!.w;
const wrongLane = bad.gates.find((g) => !g.correct)!.lane;
bad = setLane(bad, wrongLane);
bad = runUntilResolved(bad);
ok(bad.wrong === 1, "穿错记 1 次");
ok(bad.lives === RUNNER.lives - 1, "穿错扣 1 命");
ok(bad.combo === 0, "穿错断连击");
ok(bad.score === 0, "穿错不得分");
ok(bad.wrongWords.length === 1 && bad.wrongWords[0].w === targetWord, "应记录没认出来的目标词");
ok(bad.shake > 0, "穿错应抖动");
console.log("6) 穿错：记录", bad.wrongWords[0].w);

// 7) 命耗尽
let dead: RunnerState = startRunner(createRunnerGame({ words, seed: 13 }));
for (let i = 0; i < 3; i++) {
  dead = playNextWave(dead, false);
  if (dead.phase !== "playing") break;
}
ok(dead.phase === "over", "三条命掉完应结束");
ok(dead.lives === 0, "生命应为 0");
ok(dead.gates.length === 0, "结束后清空门");

// 8) 限时到点
let timed: RunnerState = startRunner(createRunnerGame({ words, seed: 17, duration: 1 }));
for (let i = 0; i < 100 && timed.phase === "playing"; i++) timed = stepRunner(timed, 0.05);
ok(timed.phase === "over", "到点应结束");
ok(timed.elapsed === 1, `elapsed 应停在时长，实际 ${timed.elapsed}`);

// 9) 不限时：永远不因时间结束
let free: RunnerState = startRunner(createRunnerGame({ words, seed: 19, untimed: true }));
ok(!Number.isFinite(free.duration), "不限时 duration 应为 Infinity");
for (let i = 0; i < 200; i++) free = stepRunner(free, 0.05);
ok(free.phase === "playing", "不限时不应因时间结束");
ok(free.elapsed > 9, `时间应正常累计，实际 ${free.elapsed.toFixed(1)}`);

// 10) 门飞出后被回收 + 会持续生成新波
let flow: RunnerState = startRunner(createRunnerGame({ words, seed: 23, untimed: true }));
let sawNewWave = false;
let lastTarget = flow.target!.w;
for (let i = 0; i < 600 && flow.phase === "playing"; i++) {
  flow = stepRunner(flow, 1 / 60);
  if (flow.target && flow.target.w !== lastTarget) {
    sawNewWave = true;
    lastTarget = flow.target.w;
  }
  if (flow.gates.some((g) => g.x < RUNNER.removeX)) throw new Error("没有回收飞出屏幕的门");
}
ok(sawNewWave, "跑久了应换过目标词（说明有新波）");

// 11) 正确率
let acc: RunnerState = startRunner(createRunnerGame({ words, seed: 29, untimed: true }));
acc = playNextWave(acc, true);
acc = playNextWave(acc, false);
ok(Math.abs(runnerAccuracy(acc) - 0.5) < 1e-9, `正确率应为 0.5，实际 ${runnerAccuracy(acc)}`);

// 12) dt 夹取：一次 5 秒不会让门瞬移穿过
let jump: RunnerState = startRunner(createRunnerGame({ words, seed: 31, untimed: true }));
const before = jump.gates[0].x;
jump = stepRunner(jump, 5);
ok(before - jump.gates[0].x < RUNNER.baseSpeed * 0.06, "dt 应被夹到 50ms");

console.log("\n✅ 单词跑酷引擎 12 组断言全部通过");
