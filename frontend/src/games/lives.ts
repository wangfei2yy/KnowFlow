/**
 * 血量规则：四个玩法共用同一套，避免各写一份还写得不一样。
 *
 * - 初始血量不变（3 格），上限 5 格：连续答对 3 个回 1 格，回满就停
 * - 「连续」= combo，答错清零后重新数
 *
 * 为什么上限比初始高：血条是一个「稳住就能回本」的正反馈，
 * 上限等于初始的话，玩家永远只能挨打，回血机制就没有意义。
 */
export const LIFE_RULE = {
  /** 初始血量 */
  initial: 3,
  /** 血量上限 */
  cap: 5,
  /** 连对多少个回一格 */
  streak: 3
} as const;

/**
 * 连对达到阈值时回血。
 *
 * @param lives    当前血量
 * @param maxLives 上限（调用方传 state.maxLives，便于测试里放宽）
 * @param combo    当前连对数（含这一次）
 * @returns 回血后的血量；没到阈值或已满则原值返回
 */
export function healForStreak(lives: number, maxLives: number, combo: number): number {
  if (combo <= 0 || combo % LIFE_RULE.streak !== 0) return lives;
  return Math.min(maxLives, lives + 1);
}

/** 建局时的血量上限：至少给到 cap，测试里显式放宽（如 lives: 99）时按传入值 */
export function maxLivesOf(initialLives: number): number {
  return Math.max(initialLives, LIFE_RULE.cap);
}
