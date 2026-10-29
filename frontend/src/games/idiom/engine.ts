/**
 * 成语填空 · 纯逻辑引擎。
 *
 * 为什么不叫「成语接龙」：内置 172 条成语里只有 22 条（13%）的末字能接上另一条的首字，
 * 严格接龙两步就断，几乎每局都在「这条链断了」。所以改成同一份数据能撑起来的玩法：
 * 每个成语挖掉一个字，从候选字里选回来 —— 考的还是对成语的熟悉度。
 *
 * 和 orb 一样不碰 DOM、不用 Math.random（种子存在 state 里），便于复现与单测。
 */
import type { IdiomEntry } from "@/services/knowledgePack";

export const IDIOM_GAME = {
  /** 一局时长（秒） */
  duration: 60,
  /** 初始命 */
  lives: 3,
  /** 每题的候选字数 */
  optionCount: 4,
  /** 答对基础分 */
  base: 8,
  /** 连击每级加分 */
  comboStep: 2,
  /** 连击加分封顶 */
  comboCap: 10
} as const;

export interface BlankQuestion {
  /** 挖掉的正确字 */
  answer: string;
  /** 候选字（含正确答案），已打乱 */
  options: string[];
  /** 挖掉的位置，0~3 */
  blankIndex: number;
  /** 完整成语 */
  word: string;
  meaning: string;
}

export interface IdiomHit {
  seq: number;
  correct: boolean;
  picked: string;
  answer: string;
}

export type IdiomPhase = "ready" | "playing" | "over";

export interface IdiomGameState {
  phase: IdiomPhase;
  /** 本局词池（洗牌后） */
  pool: IdiomEntry[];
  /** 题目顺序（下标），循环取用 */
  order: number[];
  pos: number;
  question: BlankQuestion | null;
  score: number;
  combo: number;
  bestCombo: number;
  correct: number;
  wrong: number;
  lives: number;
  maxLives: number;
  elapsed: number;
  duration: number;
  /** 本局答错的成语，结算时批量入队 */
  wrongWords: IdiomEntry[];
  lastHit: IdiomHit | null;
  hitSeq: number;
  rngState: number;
}

export interface IdiomConfig {
  idioms: IdiomEntry[];
  duration?: number;
  lives?: number;
  seed?: number;
}

function rand(s: IdiomGameState): number {
  s.rngState = (Math.imul(s.rngState, 1664525) + 1013904223) >>> 0;
  return s.rngState / 4294967296;
}

function shuffle<T>(list: T[], s: IdiomGameState): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * 干扰字：优先取「同位置出现过的字」，这样看起来像真的（比如第三位常出现「之」「不」），
 * 而不是从整个字库乱抽 —— 乱抽一眼就能排除。
 */
export function pickDistractors(
  pool: IdiomEntry[],
  answer: string,
  blankIndex: number,
  count: number,
  s: IdiomGameState
): string[] {
  const sameSlot = new Set<string>();
  const anywhere = new Set<string>();
  for (const it of pool) {
    const w = it.w;
    if (w[blankIndex] && w[blankIndex] !== answer) sameSlot.add(w[blankIndex]);
    for (const ch of w) if (ch !== answer) anywhere.add(ch);
  }

  const out: string[] = [];
  const same = shuffle([...sameSlot], s);
  for (const ch of same) {
    if (out.length >= count) break;
    if (!out.includes(ch)) out.push(ch);
  }
  if (out.length < count) {
    const rest = shuffle([...anywhere].filter((c) => !out.includes(c)), s);
    for (const ch of rest) {
      if (out.length >= count) break;
      out.push(ch);
    }
  }
  return out.slice(0, count);
}

function buildQuestion(state: IdiomGameState): BlankQuestion | null {
  if (!state.pool.length) return null;
  const item = state.pool[state.order[state.pos % state.order.length]];
  if (!item) return null;

  const word = item.w;
  const blankIndex = Math.floor(rand(state) * word.length);
  const answer = word[blankIndex];
  const distractors = pickDistractors(state.pool, answer, blankIndex, IDIOM_GAME.optionCount - 1, state);
  const options = shuffle([answer, ...distractors], state);

  return { answer, options, blankIndex, word, meaning: item.m };
}

export function createIdiomGame(config: IdiomConfig, seedOverride?: number): IdiomGameState {
  const usable = config.idioms.filter((it) => it.w && it.w.length >= 2 && it.m);
  const state: IdiomGameState = {
    phase: "ready",
    pool: [],
    order: [],
    pos: 0,
    question: null,
    score: 0,
    combo: 0,
    bestCombo: 0,
    correct: 0,
    wrong: 0,
    lives: config.lives ?? IDIOM_GAME.lives,
    maxLives: config.lives ?? IDIOM_GAME.lives,
    elapsed: 0,
    duration: config.duration ?? IDIOM_GAME.duration,
    wrongWords: [],
    lastHit: null,
    hitSeq: 0,
    rngState: (seedOverride ?? config.seed ?? Date.now()) >>> 0
  };

  state.pool = shuffle(usable.slice(), state).slice(0, 60);
  state.order = shuffle(
    state.pool.map((_, i) => i),
    state
  );
  state.question = buildQuestion(state);
  return state;
}

export function startIdiomGame(state: IdiomGameState): IdiomGameState {
  if (state.phase === "playing") return state;
  return { ...state, phase: "playing", elapsed: 0 };
}

/** 当前题对应的词条（结算记录错题用） */
export function currentIdiom(state: IdiomGameState): IdiomEntry | null {
  if (!state.question) return null;
  return state.pool.find((it) => it.w === state.question!.word) ?? null;
}

export function answerBlank(prev: IdiomGameState, picked: string): IdiomGameState {
  if (prev.phase !== "playing" || !prev.question) return prev;

  const state: IdiomGameState = { ...prev };
  const q = prev.question;
  const correct = picked === q.answer;
  state.hitSeq = prev.hitSeq + 1;
  state.lastHit = { seq: state.hitSeq, correct, picked, answer: q.answer };

  if (correct) {
    state.correct = prev.correct + 1;
    state.combo = prev.combo + 1;
    state.bestCombo = Math.max(prev.bestCombo, state.combo);
    state.score = prev.score + IDIOM_GAME.base + Math.min(IDIOM_GAME.comboCap, (state.combo - 1) * IDIOM_GAME.comboStep);
  } else {
    state.wrong = prev.wrong + 1;
    state.combo = 0;
    state.lives = Math.max(0, prev.lives - 1);
    const item = currentIdiom(prev);
    if (item && !prev.wrongWords.some((w) => w.w === item.w)) {
      state.wrongWords = [...prev.wrongWords, item];
    }
  }

  // 无论对错都进入下一题（答错多看一眼正确答案，页面上有 700ms 停顿）
  state.pos = prev.pos + 1;
  state.question = buildQuestion(state);

  if (state.lives <= 0) {
    return { ...state, phase: "over", question: null };
  }
  return state;
}

/** 推进计时；到点结束 */
export function tickIdiom(prev: IdiomGameState, dt: number): IdiomGameState {
  if (prev.phase !== "playing") return prev;
  const elapsed = prev.elapsed + Math.max(0, Math.min(dt, 0.5));
  if (elapsed >= prev.duration) {
    return { ...prev, elapsed: prev.duration, phase: "over", question: null };
  }
  return { ...prev, elapsed };
}

export function idiomAccuracy(state: IdiomGameState): number {
  const total = state.correct + state.wrong;
  return total === 0 ? 0 : state.correct / total;
}

/** 把成语拆成「挖空前 / 空 / 挖空后」，渲染用 */
export function splitBlank(q: BlankQuestion): { before: string; after: string } {
  return {
    before: q.word.slice(0, q.blankIndex),
    after: q.word.slice(q.blankIndex + 1)
  };
}
