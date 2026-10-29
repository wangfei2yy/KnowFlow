/**
 * 背单词（关卡式四选一）的纯逻辑。
 *
 * 和「单词闯关」的区别只在规则取向，题目生成直接复用 quest/engine：
 * - 闯关：10 题 + 3 条命，答错扣命，命耗尽就结束 —— 偏游戏
 * - 背单词：一关 50 词，**不设生命**，做完为止，只看正确率 —— 偏学习
 *
 * 为什么不做成同一套：闯关能在第 4 题就结束，背单词半途结束等于这关白背，
 * 学习场景不该有「因为手滑而死」的挫败。
 */
import {
  buildQuestions,
  type Question,
  type Rng,
  type WordEntry
} from "@/services/quest/engine";

export const DRILL = {
  /** 一关多少词 */
  perLevel: 50,
  /** 正确率达到这个比例算过关 */
  passRate: 0.8
} as const;

/** 关卡总数：按词量算，最后不满一关也算一关 */
export function levelCount(total: number, perLevel = DRILL.perLevel): number {
  if (total <= 0) return 0;
  return Math.ceil(total / perLevel);
}

/**
 * 第 level 关（0 起）包含的词。
 *
 * 按传入顺序切，不随机 —— 关卡必须稳定：今天背第 3 关和下周背第 3 关要背同一批词，
 * 否则「进度」失去意义。调用方先把词库按字母排好。
 */
export function levelSlice(words: WordEntry[], levelIndex: number, perLevel = DRILL.perLevel): WordEntry[] {
  const start = Math.max(0, levelIndex) * perLevel;
  return words.slice(start, start + perLevel);
}

/** 某关在第几关到第几关（页面上显示「第 51~100 词」） */
export function levelRange(levelIndex: number, total: number, perLevel = DRILL.perLevel) {
  const start = levelIndex * perLevel + 1;
  const end = Math.min(total, (levelIndex + 1) * perLevel);
  return { start: Math.min(start, total), end };
}

/** 过关所需答对数 */
export function passLine(total: number): number {
  return Math.ceil(total * DRILL.passRate);
}

// ---------------- 一局的答题状态 ----------------

export interface DrillSession {
  questions: Question[];
  index: number;
  picked: string;
  answered: boolean;
  correct: number;
  wrong: number;
  /** 答错的词，结算时可一键加入复习 */
  wrongWords: WordEntry[];
  finished: boolean;
}

export function startDrill(words: WordEntry[], rng?: Rng): DrillSession {
  const picked = words.slice(0, DRILL.perLevel);
  const questions = buildQuestions(picked, picked.length, rng);
  return {
    questions,
    index: 0,
    picked: "",
    answered: false,
    correct: 0,
    wrong: 0,
    wrongWords: [],
    finished: questions.length === 0
  };
}

export function currentDrillQuestion(s: DrillSession): Question | null {
  return s.finished ? null : (s.questions[s.index] ?? null);
}

/** 作答当前题；已作答或已结束原样返回，避免重复计数 */
export function answerDrill(s: DrillSession, choice: string): DrillSession {
  const q = currentDrillQuestion(s);
  if (!q || s.answered) return s;
  const ok = choice === q.answer;
  return {
    ...s,
    correct: s.correct + (ok ? 1 : 0),
    wrong: s.wrong + (ok ? 0 : 1),
    wrongWords: ok ? s.wrongWords : [...s.wrongWords, { w: q.word, p: q.phonetic, m: q.answerFull }],
    answered: true,
    picked: choice
  };
}

/** 下一题；最后一题之后结束（本关做完，不是「死掉」） */
export function nextDrill(s: DrillSession): DrillSession {
  if (s.finished) return s;
  const next = s.index + 1;
  if (next >= s.questions.length) return { ...s, finished: true, answered: false, picked: "" };
  return { ...s, index: next, answered: false, picked: "" };
}

/** 正确率 0~1 */
export function drillAccuracy(s: DrillSession): number {
  const total = s.correct + s.wrong;
  return total === 0 ? 0 : s.correct / total;
}

export function drillPassed(s: DrillSession): boolean {
  return s.correct >= passLine(s.questions.length);
}

// ---------------- 关卡进度（按词库存） ----------------

export interface LevelProgress {
  /** 历史最好一次的答对数 */
  best: number;
  /** 那一关的题数（末关可能不足 50） */
  total: number;
  /** 是否已过关 */
  passed: boolean;
  at: string;
}

export type LevelMap = Record<string, LevelProgress>;

const KEY = "knowflow.words.drill";

function readAll(): Record<string, LevelMap> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, LevelMap>) : {};
  } catch {
    return {};
  }
}

export function loadDrillProgress(packId: string): LevelMap {
  return { ...(readAll()[packId] ?? {}) };
}

/** 记录一次结果；只在成绩更好时覆盖 best，但「过了就是过了」 */
export function saveDrillResult(packId: string, levelIndex: number, correct: number, total: number): LevelMap {
  const all = readAll();
  const map = { ...(all[packId] ?? {}) };
  const prev = map[levelIndex];
  const passed = correct >= passLine(total);
  map[levelIndex] = {
    best: Math.max(prev?.best ?? 0, correct),
    total,
    passed: Boolean(prev?.passed) || passed,
    at: new Date().toISOString()
  };
  all[packId] = map;
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 存不下就不存，不影响这次答题 */
  }
  return map;
}

export function clearDrillProgress(packId: string): void {
  const all = readAll();
  delete all[packId];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* 忽略 */
  }
}

export interface DrillSummary {
  /** 关卡总数 */
  levels: number;
  /** 已过关数 */
  cleared: number;
  /** 已过关覆盖的词数（按每关词数累加，末关按实际） */
  wordsDone: number;
  /** 第一个没过的关卡（0 起）；全过则等于 levels */
  next: number;
}

export function summarizeDrill(map: LevelMap, totalWords: number, perLevel = DRILL.perLevel): DrillSummary {
  const levels = levelCount(totalWords, perLevel);
  let cleared = 0;
  let wordsDone = 0;
  for (let i = 0; i < levels; i++) {
    if (!map[i]?.passed) continue;
    cleared += 1;
    wordsDone += Math.min(perLevel, totalWords - i * perLevel);
  }
  // 从第一关开始找第一个没过的：中间断档时先补前面的，而不是跳到最后一关
  let next = 0;
  while (next < levels && map[next]?.passed) next += 1;
  return { levels, cleared, wordsDone, next };
}
