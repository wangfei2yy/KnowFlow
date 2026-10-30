/**
 * 单词跑酷 · 纯逻辑引擎。
 *
 * 玩法：三条跑道，玩家在最左边；一波门从右侧过来（三条道各一扇，只有一个词对），
 * 用上下键换道穿对的门。穿对加分加速，穿错扣命。
 *
 * 同屏只放「一波」门：波与波之间不重叠，HUD 的中文提示才不会指代不明。
 * 和其它游戏一样：不碰 DOM、随机数走 state 里的 LCG，可复现、可单测。
 */
import { spellSimilarity, type WordEntry } from "@/games/orb/engine";
import { healForStreak, maxLivesOf } from "@/games/lives";
import { buildDistractorPool, buildWordOrder, cleanWords, type WordMode } from "@/games/words";
import { shortMeaning } from "@/services/quest/engine";

export const RUNNER = {
  lanes: 3,
  /** 门生成的 x（玩家在 x=0，向右为正） */
  spawnX: 900,
  /** 判定窗口：门中心进入 |x| < hitWindow 就算穿门 */
  hitWindow: 28,
  /** 飞出这个位置就回收 */
  removeX: -160,
  /** 基础速度（单位/秒） */
  baseSpeed: 330,
  /** 每分提升的速度 */
  speedPerScore: 0.55,
  maxSpeed: 820,
  base: 10,
  comboStep: 2,
  comboCap: 20,
  lives: 3,
  duration: 60,
  /** 本局词池大小 */
  /** 干扰项候选池大小（从整库随机抽，形近词排序只在它上面做） */
  poolSize: 240
} as const;

export interface RunnerGate {
  id: number;
  x: number;
  lane: number;
  word: string;
  correct: boolean;
  /** 已经判定过（穿门或错过） */
  resolved: boolean;
}

export type RunnerPhase = "ready" | "playing" | "over";

export interface RunnerHit {
  seq: number;
  lane: number;
  correct: boolean;
  word: string;
}

export interface RunnerState {
  phase: RunnerPhase;
  lane: number;
  gates: RunnerGate[];
  pool: WordEntry[];
  /** 出词模式与取词顺序（同球球，定义在 games/words.ts） */
  mode: WordMode;
  order: number[];
  orderPos: number;
  /** 干扰项候选池（只在它上面挑形近词） */
  distractors: WordEntry[];
  /** 当前这一波该穿哪个词（中文提示用） */
  target: WordEntry | null;
  /** 本波是否已经换过目标（防止每帧重复推进） */
  waveAdvanced: boolean;
  label: string;
  score: number;
  combo: number;
  bestCombo: number;
  correct: number;
  wrong: number;
  lives: number;
  maxLives: number;
  elapsed: number;
  duration: number;
  /** 当前速度（单位/秒） */
  speed: number;
  wrongWords: WordEntry[];
  shake: number;
  hitSeq: number;
  lastHit: RunnerHit | null;
  rngState: number;
  nextGateId: number;
}

export interface RunnerConfig {
  words: WordEntry[];
  duration?: number;
  lives?: number;
  untimed?: boolean;
  /** 出词模式：顺序（按词库关卡，一轮不重复、可续刷）/ 随机（整库洗牌） */
  mode?: WordMode;
  /** 顺序模式的起点（0 基，越界取模） */
  startIndex?: number;
  seed?: number;
}

function rand(s: RunnerState): number {
  s.rngState = (Math.imul(s.rngState, 1664525) + 1013904223) >>> 0;
  return s.rngState / 4294967296;
}

function shuffle<T>(list: T[], s: RunnerState): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function nextTarget(s: RunnerState): WordEntry | null {
  if (!s.pool.length) return null;
  const idx = s.order[s.orderPos % s.order.length];
  return s.pool[idx] ?? null;
}

/** 干扰词：形近优先，避免「看长度猜」 */
function distractor(s: RunnerState, exclude: Set<string>): string {
  const target = s.target?.w ?? "";
  const candidates = s.distractors.filter((w) => w.w !== target && !exclude.has(w.w));
  if (!candidates.length) return target;
  const scored = candidates.map((w) => ({ w: w.w, score: spellSimilarity(target, w.w) + rand(s) * 2 }));
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.max(3, Math.ceil(scored.length * 0.5)));
  return top[Math.floor(rand(s) * top.length)].w;
}

/** 生成一波：三条道各放一个词，恰好一个正确，正确的位置随机 */
function spawnWave(s: RunnerState): RunnerGate[] {
  const target = s.target;
  if (!target) return [];
  const correctLane = Math.floor(rand(s) * RUNNER.lanes);
  const used = new Set<string>([target.w]);
  const gates: RunnerGate[] = [];
  for (let lane = 0; lane < RUNNER.lanes; lane++) {
    const isCorrect = lane === correctLane;
    const word = isCorrect ? target.w : distractor(s, used);
    if (!isCorrect) used.add(word);
    gates.push({
      id: s.nextGateId++,
      x: RUNNER.spawnX,
      lane,
      word,
      correct: isCorrect,
      resolved: false
    });
  }
  return gates;
}

export function createRunnerGame(config: RunnerConfig): RunnerState {
  const usable = cleanWords(config.words);
  const mode: WordMode = config.mode ?? "random";
  const state: RunnerState = {
    phase: "ready",
    lane: 1,
    gates: [],
    pool: [],
    mode,
    order: [],
    orderPos: 0,
    distractors: [],
    target: null,
    waveAdvanced: false,
    label: "",
    score: 0,
    combo: 0,
    bestCombo: 0,
    correct: 0,
    wrong: 0,
    lives: config.lives ?? RUNNER.lives,
    maxLives: maxLivesOf(config.lives ?? RUNNER.lives),
    elapsed: 0,
    duration: config.untimed ? Number.POSITIVE_INFINITY : (config.duration ?? RUNNER.duration),
    speed: RUNNER.baseSpeed,
    wrongWords: [],
    shake: 0,
    hitSeq: 0,
    lastHit: null,
    rngState: (config.seed ?? Date.now()) >>> 0,
    nextGateId: 1
  };

  // 词池 = 整库（以前只抽 30 个反复轮回）
  state.pool = usable;
  const shuffled = <T,>(list: T[]) => shuffle(list, state);
  state.order = buildWordOrder(mode, usable.length, config.startIndex ?? 0, shuffled);
  state.distractors = buildDistractorPool(
    usable,
    state.order,
    state.orderPos,
    RUNNER.poolSize,
    shuffled
  );
  state.target = nextTarget(state);
  state.label = state.target ? shortMeaning(state.target.m, 8) : "";
  state.gates = spawnWave(state);
  state.waveAdvanced = false;
  return state;
}

export function startRunner(state: RunnerState): RunnerState {
  if (state.phase === "playing") return state;
  return { ...state, phase: "playing", elapsed: 0 };
}

/** 换道：-1 上 / +1 下；越界不动 */
export function moveLane(prev: RunnerState, dir: number): RunnerState {
  if (prev.phase !== "playing") return prev;
  const lane = Math.max(0, Math.min(RUNNER.lanes - 1, prev.lane + dir));
  if (lane === prev.lane) return prev;
  return { ...prev, lane };
}

/** 直接跳到指定道（触屏点选跑道上/中/下） */
export function setLane(prev: RunnerState, lane: number): RunnerState {
  if (prev.phase !== "playing") return prev;
  const next = Math.max(0, Math.min(RUNNER.lanes - 1, Math.round(lane)));
  if (next === prev.lane) return prev;
  return { ...prev, lane: next };
}

function advanceTarget(state: RunnerState) {
  state.orderPos = (state.orderPos + 1) % Math.max(1, state.order.length);
  state.target = nextTarget(state);
  state.label = state.target ? shortMeaning(state.target.m, 8) : "";
}

/**
 * 推进一帧：移动门、判定穿门、按需生成下一波。
 * dt 上限 50ms，切标签回来不会让门瞬间穿过玩家。
 */
export function stepRunner(prev: RunnerState, dtRaw: number): RunnerState {
  if (prev.phase !== "playing") return prev;
  const dt = Math.max(0, Math.min(dtRaw, 0.05));

  const state: RunnerState = {
    ...prev,
    gates: prev.gates.map((g) => ({ ...g }))
  };

  state.elapsed = prev.elapsed + dt;
  if (state.elapsed >= state.duration) {
    return { ...state, phase: "over", elapsed: state.duration, shake: 0 };
  }

  state.speed = Math.min(RUNNER.maxSpeed, RUNNER.baseSpeed + state.score * RUNNER.speedPerScore);
  const dx = state.speed * dt;

  if (state.shake > 0) state.shake = Math.max(0, state.shake - dt * 2.5);

  // 1) 判定：门中心进入窗口 → 穿上；飞出左侧 → 错过
  for (const gate of state.gates) {
    gate.x -= dx;
    if (gate.resolved) continue;
    if (gate.x <= RUNNER.hitWindow) {
      gate.resolved = true;
      if (gate.lane === state.lane) {
        state.hitSeq = state.hitSeq + 1;
        state.lastHit = { seq: state.hitSeq, lane: gate.lane, correct: gate.correct, word: gate.word };
        if (gate.correct) {
          state.correct += 1;
          state.combo += 1;
          state.bestCombo = Math.max(state.bestCombo, state.combo);
          state.score += RUNNER.base + Math.min(RUNNER.comboCap, (state.combo - 1) * RUNNER.comboStep);
          // 连穿 3 扇对的门回一格（上限 5）
          state.lives = healForStreak(state.lives, state.maxLives, state.combo);
        } else {
          state.wrong += 1;
          state.combo = 0;
          state.lives = Math.max(0, state.lives - 1);
          state.shake = 1;
          if (state.target && !state.wrongWords.some((w) => w.w === state.target!.w)) {
            state.wrongWords = [...state.wrongWords, state.target];
          }
        }
      }
    }
  }

  // 2) 这一波被处理完（三扇门都判定过）→ 换目标词，只换一次
  if (!state.waveAdvanced && state.gates.length > 0 && state.gates.every((g) => g.resolved)) {
    advanceTarget(state);
    state.waveAdvanced = true;
  }

  // 3) 回收飞出屏幕的门
  state.gates = state.gates.filter((g) => g.x > RUNNER.removeX);

  // 4) 场上没有门了 → 生成下一波
  if (state.gates.length === 0) {
    state.gates = spawnWave(state);
    state.waveAdvanced = false;
  }

  if (state.lives <= 0) {
    return { ...state, phase: "over", shake: 0, gates: [] };
  }
  return state;
}

export function runnerAccuracy(state: RunnerState): number {
  const total = state.correct + state.wrong;
  return total === 0 ? 0 : state.correct / total;
}
