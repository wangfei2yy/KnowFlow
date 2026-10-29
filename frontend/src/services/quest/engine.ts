/**
 * 单词闯关的纯逻辑（不依赖 DOM / 数据库，便于单测）。
 *
 * 规则：每题 4 选 1，答对加分（连击加成），答错扣 1 条命并记入错词；
 * 生命耗尽或题目答完即结束。
 */
import { healForStreak, maxLivesOf } from "@/games/lives";

export interface WordEntry {
  w: string;
  /** 音标：成语没有，单词才有 */
  p?: string;
  m: string;
}

export interface Question {
  word: string;
  phonetic: string;
  /** 选项里显示与判分用的短释义 */
  answer: string;
  /** 完整释义（答错入队时用，信息不丢） */
  answerFull: string;
  options: string[];
}

/**
 * 释义太长会把选项撑成一堵墙，取第一个分号/逗号前的核心义项。
 * 中文释义常见分隔：；; 、 ，,
 */
export function shortMeaning(meaning: string, limit = 24): string {
  const m = (meaning ?? "").trim();
  if (!m) return "";
  const head = m.split(/[；;]/)[0].split(/[，,]/)[0].trim() || m;
  return head.length > limit ? `${head.slice(0, limit)}…` : head;
}

export interface QuestSession {
  questions: Question[];
  index: number;
  lives: number;
  maxLives: number;
  score: number;
  streak: number;
  bestStreak: number;
  correctCount: number;
  wrongCount: number;
  wrongWords: WordEntry[];
  /** 当前题是否已作答 */
  answered: boolean;
  /** 当前题选择的选项 */
  picked: string;
  finished: boolean;
}

export type Rng = () => number;

/** Fisher-Yates，注入 rng 便于测试 */
export function shuffle<T>(list: T[], rng: Rng = Math.random): T[] {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

const OPTION_COUNT = 4;

/**
 * 生成题目：正确答案 + 3 个来自同库的干扰释义。
 * 干扰项会去重（同义词释义相同的情况），不足时循环补齐。
 */
export function buildQuestions(words: WordEntry[], size = 10, rng: Rng = Math.random): Question[] {
  const usable = words.filter((w) => w.w && w.m);
  if (usable.length < OPTION_COUNT) return [];

  const picked = shuffle(usable, rng).slice(0, Math.min(size, usable.length));
  const pool = usable.map((w) => ({ short: shortMeaning(w.m), full: w.m }));

  return picked.map((word) => {
    const correctShort = shortMeaning(word.m);
    const options = new Set<string>([correctShort]);
    let guard = 0;
    while (options.size < OPTION_COUNT && guard < 300) {
      guard += 1;
      const candidate = pool[Math.floor(rng() * pool.length)];
      if (!candidate) continue;
      // 排除正确项本身（按完整释义判断，避免同义短释义误判）
      if (candidate.full === word.m) continue;
      const text = candidate.short || shortMeaning(candidate.full);
      if (text) options.add(text);
    }

    // 短释义撞车导致不足 4 个时，用更长的释义兜底
    guard = 0;
    while (options.size < OPTION_COUNT && guard < 300) {
      guard += 1;
      const candidate = pool[Math.floor(rng() * pool.length)];
      if (!candidate || candidate.full === word.m) continue;
      options.add(shortMeaning(candidate.full, 40));
    }

    return {
      word: word.w,
      phonetic: word.p || "",
      answer: correctShort,
      answerFull: word.m,
      options: shuffle([...options], rng)
    };
  });
}

export function startSession(
  words: WordEntry[],
  options: { size?: number; lives?: number; rng?: Rng } = {}
): QuestSession {
  const size = options.size ?? 10;
  const lives = options.lives ?? 3;
  const questions = buildQuestions(words, size, options.rng);
  return {
    questions,
    index: 0,
    lives,
    maxLives: maxLivesOf(lives),
    score: 0,
    streak: 0,
    bestStreak: 0,
    correctCount: 0,
    wrongCount: 0,
    wrongWords: [],
    answered: false,
    picked: "",
    finished: questions.length === 0
  };
}

/** 当前题；已结束时返回 null */
export function currentQuestion(session: QuestSession): Question | null {
  return session.finished ? null : session.questions[session.index] ?? null;
}

/**
 * 作答当前题，返回新状态（不修改入参）。
 * 已作答或已结束的会话原样返回，避免重复扣命。
 */
export function answerCurrent(session: QuestSession, choice: string): QuestSession {
  const q = currentQuestion(session);
  if (!q || session.answered) return session;

  const isCorrect = choice === q.answer;
  const streak = isCorrect ? session.streak + 1 : 0;
  // 连击加成：基础 10 分 + 连击 ×2（最多 +10）
  const gained = isCorrect ? 10 + Math.min(10, session.streak * 2) : 0;
  // 答对不扣命；连对 3 个回一格（上限 5），答错清零重新数
  const lives = isCorrect
    ? healForStreak(session.lives, session.maxLives, streak)
    : session.lives - 1;
  const wrongWords = isCorrect
    ? session.wrongWords
    : [...session.wrongWords, { w: q.word, p: q.phonetic, m: q.answerFull }];

  return {
    ...session,
    lives,
    score: session.score + gained,
    streak,
    bestStreak: Math.max(session.bestStreak, streak),
    correctCount: session.correctCount + (isCorrect ? 1 : 0),
    wrongCount: session.wrongCount + (isCorrect ? 0 : 1),
    wrongWords,
    answered: true,
    picked: choice,
    finished: lives <= 0
  };
}

/** 进入下一题（答完最后一题则结束） */
export function nextQuestion(session: QuestSession): QuestSession {
  if (session.finished) return session;
  const nextIndex = session.index + 1;
  const finished = nextIndex >= session.questions.length;
  return {
    ...session,
    index: finished ? session.index : nextIndex,
    answered: false,
    picked: "",
    finished
  };
}

/** 正确率（0~1） */
export function accuracy(session: QuestSession): number {
  const total = session.correctCount + session.wrongCount;
  return total === 0 ? 0 : session.correctCount / total;
}

export interface QuestProgress {
  /** 已通关的最高题数（用于显示进度） */
  bestScore: number;
  plays: number;
  lastPlayedAt: string;
}

const PROGRESS_KEY = "knowflow.quest.progress";

export function loadProgress(): Record<string, QuestProgress> {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, QuestProgress>) : {};
  } catch {
    return {};
  }
}

export function saveProgress(packId: string, score: number): QuestProgress {
  const all = loadProgress();
  const prev = all[packId] ?? { bestScore: 0, plays: 0, lastPlayedAt: "" };
  const next: QuestProgress = {
    bestScore: Math.max(prev.bestScore, score),
    plays: prev.plays + 1,
    lastPlayedAt: new Date().toISOString()
  };
  all[packId] = next;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  } catch {
    /* 忽略：进度存不下不影响答题 */
  }
  return next;
}
