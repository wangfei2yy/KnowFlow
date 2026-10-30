/**
 * 游戏出词的公共规则：怎么洗词、按什么顺序出、哪些词不能出。
 *
 * 抽出来的原因：球球和跑酷原来是同一份「只抽 30 个词反复轮回」的逻辑，
 * 用户反馈「两分钟就把 30 个词背下来了」——两个游戏要一起改，就别各写一遍。
 */

/** 顺序 = 按词库关卡顺序（一轮不重复、可续刷）；随机 = 整库洗牌（一局内不重复） */
export type WordMode = "order" | "random";

export interface WordLike {
  w: string;
  m: string;
}

/**
 * 源数据里的占位释义。初中词库（junior）以前真有 17 条（am / August / Internet…），
 * 猜词时直接显示「找不到解释」，等于把题出成了废题 —— 现在数据补上了，
 * 这里再兜一层，避免以后换词库又混进来。
 */
const PLACEHOLDER_MEANING = /找不到解释|暂无释义|未找到释义|^无$/;

/** 过滤掉不能出题的词：缺单词、缺释义、占位释义 */
export function cleanWords<T extends WordLike>(words: T[]): T[] {
  return words.filter((w) => {
    const m = (w.m ?? "").trim();
    return !!w.w && !!m && !PLACEHOLDER_MEANING.test(m);
  });
}

/**
 * 生成取词顺序（下标数组）。
 *
 * @param mode       order 按原顺序；random 洗牌
 * @param total      可用词数
 * @param startIndex 顺序模式的起点（越界自动取模）
 * @param shuffle    洗牌函数（引擎各自的 LCG，便于复现）
 */
export function buildWordOrder(
  mode: WordMode,
  total: number,
  startIndex: number,
  shuffle: <T>(list: T[]) => T[]
): number[] {
  if (total <= 0) return [];
  if (mode === "order") {
    const start = ((Math.trunc(startIndex) % total) + total) % total;
    return Array.from({ length: total }, (_, i) => (start + i) % total);
  }
  return shuffle(Array.from({ length: total }, (_, i) => i));
}

/**
 * 干扰项候选池：从整库随机抽一部分。
 *
 * 为什么不在整库上挑：形近词评分要对候选排序，整库四五千条时每挑一次都排一遍太浪费。
 * 顺序模式下再把「接下来 20 个词」塞进来，保证干扰项和当前关卡水平接近。
 */
export function buildDistractorPool<T extends WordLike>(
  words: T[],
  order: number[],
  startPos: number,
  size: number,
  shuffle: <U>(list: U[]) => U[]
): T[] {
  const pool = shuffle(words.slice()).slice(0, Math.min(size, words.length));
  for (let i = 1; i <= 20; i++) {
    const idx = order[(startPos + i) % order.length];
    const w = words[idx];
    if (w && !pool.some((p) => p.w === w.w)) pool.push(w);
  }
  return pool;
}
