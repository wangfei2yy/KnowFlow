/**
 * 成语页的纯逻辑：首字/尾字/字数索引、筛选、掌握度与错词记录。
 *
 * 放这里而不是页面里，是为了能单测 —— 筛选组合与 URL 往返最容易被改坏，
 * 而它们错了用户不会报错，只会觉得「搜不到东西」。
 */
import type { IdiomEntry } from "@/services/knowledgePack";

export type IdiomLevel = "known" | "fuzzy" | "unknown";
/** 筛选用的档位比实际档位多两个：「不限」与「未标」 */
export type IdiomLevelFilter = IdiomLevel | "all" | "none";

export const LEVEL_KEY = "knowflow.idiom.level";
export const MISTAKE_KEY = "knowflow.idiom.mistakes";

export interface IdiomFacets {
  /** 出现过的首字及条数，按条数降序 */
  firsts: { ch: string; count: number }[];
  lasts: { ch: string; count: number }[];
  /** 字数分布，按字数升序 */
  lengths: { len: number; count: number }[];
}

export interface IdiomFilter {
  keyword: string;
  first: string;
  last: string;
  /** 0 表示不限 */
  len: number;
  level: IdiomLevelFilter;
  /** 只看「在游戏里错过」的 */
  onlyMistake: boolean;
}

export const EMPTY_FILTER: IdiomFilter = {
  keyword: "",
  first: "",
  last: "",
  len: 0,
  level: "all",
  onlyMistake: false
};

export function buildFacets(list: IdiomEntry[]): IdiomFacets {
  const firsts = new Map<string, number>();
  const lasts = new Map<string, number>();
  const lengths = new Map<number, number>();
  for (const it of list) {
    const w = it.w;
    if (!w) continue;
    firsts.set(w[0], (firsts.get(w[0]) ?? 0) + 1);
    lasts.set(w[w.length - 1], (lasts.get(w[w.length - 1]) ?? 0) + 1);
    lengths.set(w.length, (lengths.get(w.length) ?? 0) + 1);
  }
  const toSorted = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([ch, count]) => ({ ch, count }))
      .sort((a, b) => b.count - a.count || a.ch.localeCompare(b.ch, "zh"));
  return {
    firsts: toSorted(firsts),
    lasts: toSorted(lasts),
    lengths: [...lengths.entries()]
      .map(([len, count]) => ({ len, count }))
      .sort((a, b) => a.len - b.len)
  };
}

export function filterIdioms(
  list: IdiomEntry[],
  filter: IdiomFilter,
  levels: Record<string, IdiomLevel> = {},
  mistakes: Record<string, number> = {}
): IdiomEntry[] {
  const kw = filter.keyword.trim();
  return list.filter((it) => {
    const w = it.w;
    if (kw && !w.includes(kw) && !it.m.includes(kw)) return false;
    if (filter.first && w[0] !== filter.first) return false;
    if (filter.last && w[w.length - 1] !== filter.last) return false;
    if (filter.len && w.length !== filter.len) return false;
    if (filter.onlyMistake && !(mistakes[w] > 0)) return false;
    if (filter.level === "none") {
      // 没有任何记录才算「未标」
      if (levels[w]) return false;
    } else if (filter.level !== "all" && levels[w] !== filter.level) {
      return false;
    }
    return true;
  });
}

/** URL query → 筛选条件（容错：非法值一律当「不限」） */
export function parseFilter(query: Record<string, unknown>): IdiomFilter {
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const len = Number(str(query.len));
  const level = str(query.level);
  return {
    keyword: str(query.q),
    first: str(query.first).slice(0, 1),
    last: str(query.last).slice(0, 1),
    len: Number.isFinite(len) && len > 0 ? len : 0,
    level: ["known", "fuzzy", "unknown", "none"].includes(level)
      ? (level as IdiomLevelFilter)
      : "all",
    onlyMistake: str(query.mistake) === "1"
  };
}

/** 筛选条件 → URL query（空的字段不写，链接才短） */
export function toQuery(filter: IdiomFilter): Record<string, string> {
  const q: Record<string, string> = {};
  if (filter.keyword.trim()) q.q = filter.keyword.trim();
  if (filter.first) q.first = filter.first;
  if (filter.last) q.last = filter.last;
  if (filter.len) q.len = String(filter.len);
  if (filter.level !== "all") q.level = filter.level;
  if (filter.onlyMistake) q.mistake = "1";
  return q;
}

// ---------------- 本地存储（掌握度 / 错词） ----------------

function readMap<T>(key: string): Record<string, T> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, T>) : {};
  } catch {
    return {};
  }
}

function writeMap(key: string, value: Record<string, unknown>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 存储不可用就当作没记住，不影响当前页面 */
  }
}

export function loadLevels(): Record<string, IdiomLevel> {
  return readMap<IdiomLevel>(LEVEL_KEY);
}

export function setLevel(word: string, level: IdiomLevel | null): Record<string, IdiomLevel> {
  const map = loadLevels();
  if (level) map[word] = level;
  else delete map[word];
  writeMap(LEVEL_KEY, map);
  return map;
}

export function loadMistakes(): Record<string, number> {
  return readMap<number>(MISTAKE_KEY);
}

/** 一局游戏结束后累加错词次数（同一条本局错多次只算一次由调用方去重） */
export function bumpMistakes(words: string[]): Record<string, number> {
  const map = loadMistakes();
  for (const w of words) {
    if (!w) continue;
    map[w] = (map[w] ?? 0) + 1;
  }
  writeMap(MISTAKE_KEY, map);
  return map;
}

/** 掌握度徽标文案与配色（列表与详情共用） */
export const LEVEL_META: Record<IdiomLevel, { label: string; cls: string }> = {
  known: { label: "会", cls: "bg-emerald-50 text-emerald-600" },
  fuzzy: { label: "模糊", cls: "bg-amber-50 text-amber-600" },
  unknown: { label: "不会", cls: "bg-rose-50 text-rose-500" }
};
