/**
 * 中英配对 · 纯逻辑引擎。
 *
 * 8 对卡片（8 个英文 + 8 个中文）铺成 4×4，翻两张，配上了就消除。
 * 和 orb / 成语填空一样：不碰 DOM、随机数走内部 LCG，可复现、可单测。
 *
 * 「翻错两张再翻回去」这件事放在引擎里做（tick 到点自动翻回），
 * 页面只管画和响应点击，不用自己维护定时器。
 */
import type { WordEntry } from "@/services/quest/engine";
import { shortMeaning } from "@/services/quest/engine";

export const PAIR_GAME = {
  /** 对数（4×4 = 16 张 = 8 对） */
  pairs: 8,
  /** 时长（秒） */
  duration: 90,
  /** 配对成功基础分 */
  base: 10,
  /** 连对加分 */
  comboStep: 3,
  comboCap: 12,
  /** 翻错后翻回去的等待时间（秒） */
  flipBackDelay: 0.75,
  /** 全部配完的时间奖励系数（剩余秒数 × 该值） */
  timeBonus: 2
} as const;

export type PairKind = "word" | "meaning";

export interface PairCard {
  /** 在牌堆里的固定下标 */
  index: number;
  /** 同一对的两张卡 pairId 相同 */
  pairId: number;
  text: string;
  kind: PairKind;
  matched: boolean;
}

export type PairPhase = "ready" | "playing" | "over";

export interface PairGameState {
  phase: PairPhase;
  cards: PairCard[];
  /** 本局抽到的词（pairId 即下标），结算时用来记录没配出来的词 */
  words: WordEntry[];
  /** 当前翻开、还没判定的卡（0~2 张） */
  flipped: number[];
  matchedPairs: number;
  totalPairs: number;
  moves: number;
  score: number;
  combo: number;
  bestCombo: number;
  elapsed: number;
  duration: number;
  /** 翻错后翻回去的时刻；0 表示没有待翻回 */
  flipBackAt: number;
  /** 最近一次配对结果，用于 UI 反馈 */
  lastMatch: { seq: number; ok: boolean } | null;
  matchSeq: number;
  won: boolean;
  rngState: number;
}

export interface PairConfig {
  words: WordEntry[];
  pairs?: number;
  duration?: number;
  seed?: number;
}

function rand(s: PairGameState): number {
  s.rngState = (Math.imul(s.rngState, 1664525) + 1013904223) >>> 0;
  return s.rngState / 4294967296;
}

function shuffle<T>(list: T[], s: PairGameState): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** 中文面只留最前面一小段，太长了牌面放不下 */
export function meaningFace(word: WordEntry, limit = 12): string {
  return shortMeaning(word.m, limit);
}

export function createPairGame(config: PairConfig, seedOverride?: number): PairGameState {
  const pairs = config.pairs ?? PAIR_GAME.pairs;
  const usable = config.words.filter((w) => w.w && w.m);

  const state: PairGameState = {
    phase: "ready",
    cards: [],
    words: [],
    flipped: [],
    matchedPairs: 0,
    totalPairs: 0,
    moves: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    elapsed: 0,
    duration: config.duration ?? PAIR_GAME.duration,
    flipBackAt: 0,
    lastMatch: null,
    matchSeq: 0,
    won: false,
    rngState: (seedOverride ?? config.seed ?? Date.now()) >>> 0
  };

  const picked = shuffle(usable.slice(), state).slice(0, pairs);
  state.totalPairs = picked.length;
  state.words = picked;

  const cards: PairCard[] = [];
  picked.forEach((word, pairId) => {
    cards.push({ index: 0, pairId, text: word.w, kind: "word", matched: false });
    cards.push({ index: 0, pairId, text: meaningFace(word), kind: "meaning", matched: false });
  });
  shuffle(cards, state);
  cards.forEach((c, i) => (c.index = i));
  state.cards = cards;

  return state;
}

export function startPairGame(state: PairGameState): PairGameState {
  if (state.phase === "playing") return state;
  return { ...state, phase: "playing", elapsed: 0 };
}

function cloneCards(cards: PairCard[]): PairCard[] {
  return cards.map((c) => ({ ...c }));
}

/**
 * 翻一张牌。已配对的、已翻开的、已经翻了两张等待判定的，都不响应。
 */
export function flipCard(prev: PairGameState, index: number): PairGameState {
  if (prev.phase !== "playing") return prev;
  if (prev.flipped.length >= 2) return prev;
  const card = prev.cards[index];
  if (!card || card.matched) return prev;
  if (prev.flipped.includes(index)) return prev;

  const state: PairGameState = { ...prev, cards: cloneCards(prev.cards), flipped: [...prev.flipped, index] };
  if (state.flipped.length < 2) return state;

  const [a, b] = state.flipped;
  const cardA = state.cards[a];
  const cardB = state.cards[b];
  state.moves = prev.moves + 1;
  state.matchSeq = prev.matchSeq + 1;

  if (cardA.pairId === cardB.pairId && cardA.kind !== cardB.kind) {
    cardA.matched = true;
    cardB.matched = true;
    state.matchedPairs = prev.matchedPairs + 1;
    state.combo = prev.combo + 1;
    state.bestCombo = Math.max(prev.bestCombo, state.combo);
    state.score = prev.score + PAIR_GAME.base + Math.min(PAIR_GAME.comboCap, (state.combo - 1) * PAIR_GAME.comboStep);
    state.flipped = [];
    state.lastMatch = { seq: state.matchSeq, ok: true };

    if (state.matchedPairs >= state.totalPairs) {
      // 全配完：按剩余时间给奖励，提前结束
      const remain = Math.max(0, state.duration - state.elapsed);
      state.score += Math.round(remain * PAIR_GAME.timeBonus);
      state.won = true;
      state.phase = "over";
      state.elapsed = Math.min(state.elapsed, state.duration);
    }
    return state;
  }

  // 没配上：等 flipBackDelay 后由 tick 翻回去
  state.combo = 0;
  state.flipBackAt = prev.elapsed + PAIR_GAME.flipBackDelay;
  state.lastMatch = { seq: state.matchSeq, ok: false };
  return state;
}

/** 推进计时 + 处理「翻错回位」 */
export function tickPair(prev: PairGameState, dt: number): PairGameState {
  if (prev.phase !== "playing") return prev;
  const step = Math.max(0, Math.min(dt, 0.5));
  const elapsed = prev.elapsed + step;
  let state: PairGameState = { ...prev, elapsed };

  if (state.flipBackAt > 0 && elapsed >= state.flipBackAt) {
    state = { ...state, flipped: [], flipBackAt: 0 };
  }

  if (elapsed >= state.duration) {
    state = { ...state, elapsed: state.duration, phase: "over", flipped: [], flipBackAt: 0 };
  }
  return state;
}

/** 配对数进度（0~1） */
export function pairProgress(state: PairGameState): number {
  return state.totalPairs === 0 ? 0 : state.matchedPairs / state.totalPairs;
}

/** 结算评星：按配对数与剩余时间 */
export function pairStars(state: PairGameState): number {
  if (state.won) return 3;
  const ratio = pairProgress(state);
  if (ratio >= 0.75) return 2;
  if (ratio >= 0.4) return 1;
  return 0;
}
