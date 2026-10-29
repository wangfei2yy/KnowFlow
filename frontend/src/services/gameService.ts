/**
 * 学习进度的本地存档：闯关会话、复习位置、游戏成绩。
 *
 * 三块数据分三个键存，互不干扰：
 * - knowflow.quest.session   单词闯关「未完成的一局」（一局结束即清）
 * - knowflow.study.position  卡片复习停在第几张（队列指纹校验）
 * - knowflow.game.progress   各游戏各词库的历史成绩
 *
 * 统一原则：读写全部 try/catch 静默。存档丢了顶多回到第一题，
 * 不能因为 localStorage 满 / 隐私模式禁写而把正在进行的这一局卡死。
 */
import type { QuestSession } from "@/services/quest/engine";

const QUEST_KEY = "knowflow.quest.session";
const POSITION_KEY = "knowflow.study.position";
const GAME_KEY = "knowflow.game.progress";

/** 存档有效期：超过 7 天视为过期，避免半年前的半局突然冒出来 */
const QUEST_TTL = 7 * 24 * 3600 * 1000;

export interface SavedQuest {
  packId: string;
  /** 必须存整个会话：只存 index 没意义，题目是每局重新抽的 */
  session: QuestSession;
  savedAt: string;
}

export interface SavedPosition {
  /** 复习队列卡片 id 拼成的简易 hash，队列一变就失效 */
  fingerprint: string;
  index: number;
}

export interface GameScore {
  bestScore: number;
  plays: number;
  lastPlayedAt: string;
}

/** { gameId: { packId: GameScore } } —— 球球和闯关的分数不混在一起 */
export type GameProgress = Record<string, Record<string, GameScore>>;

function readJSON<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 忽略：写不进去不影响当前这一局 */
  }
}

function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* 忽略 */
  }
}

// ---------------- 闯关会话 ----------------

/** 按词库分开存：切到 cet6 不该把 cet4 的半局冲掉 */
export type SavedQuestMap = Record<string, SavedQuest>;

function readQuestMap(): SavedQuestMap {
  const raw = readJSON<SavedQuestMap | SavedQuest>(QUEST_KEY);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  // 兼容旧版「一个键存一局」的结构
  if ("session" in raw && "packId" in raw) {
    const single = raw as SavedQuest;
    return single.packId ? { [single.packId]: single } : {};
  }
  return raw as SavedQuestMap;
}

function isUsable(saved: SavedQuest | undefined): saved is SavedQuest {
  if (!saved || !saved.packId || !saved.session) return false;
  if (!Array.isArray(saved.session.questions) || saved.session.questions.length === 0) return false;
  if (saved.session.finished) return false;
  const at = new Date(saved.savedAt).getTime();
  if (!Number.isFinite(at) || Date.now() - at > QUEST_TTL) return false;
  return true;
}

/**
 * 读取全部可用存档（已过滤过期 / 已结束 / 空题目）。
 * 顺手把脏数据写回去，避免越攒越多。
 */
export function loadQuestSessions(): SavedQuestMap {
  const map = readQuestMap();
  const clean: SavedQuestMap = {};
  let dirty = false;
  for (const [packId, saved] of Object.entries(map)) {
    if (isUsable(saved)) clean[packId] = saved;
    else dirty = true;
  }
  if (dirty) writeJSON(QUEST_KEY, clean);
  return clean;
}

export function loadQuestSession(packId: string): SavedQuest | null {
  const saved = readQuestMap()[packId];
  return isUsable(saved) ? saved : null;
}

export function saveQuestSession(packId: string, session: QuestSession): void {
  const map = loadQuestSessions();
  map[packId] = { packId, session, savedAt: new Date().toISOString() };
  writeJSON(QUEST_KEY, map);
}

/** 不传 packId 表示清空全部 */
export function clearQuestSession(packId?: string): void {
  if (!packId) {
    removeKey(QUEST_KEY);
    return;
  }
  const map = loadQuestSessions();
  if (!(packId in map)) return;
  delete map[packId];
  writeJSON(QUEST_KEY, map);
}

/**
 * 存档恢复：上次是在「已作答、还没切到下一题」的瞬间退出的，
 * 直接恢复会卡在无法操作的题目上，这里自动推进一格。
 * 推进后已结束则返回 null（这局本来就算结束了）。
 */
export function resumeSession(saved: SavedQuest): SavedQuest | null {
  if (!saved.session.answered) return saved;
  const index = saved.session.index + 1;
  if (index >= saved.session.questions.length) return null;
  return {
    ...saved,
    session: {
      ...saved.session,
      index,
      answered: false,
      picked: ""
    }
  };
}

// ---------------- 复习位置 ----------------

/** 队列指纹：djb2 变体，只用来判断「队列还是不是那一批」 */
export function fingerprintOf(ids: string[]): string {
  let hash = 5381;
  for (const id of ids) {
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) + hash + id.charCodeAt(i)) | 0;
    }
    // 分隔符，避免 ["ab","c"] 与 ["a","bc"] 撞车
    hash = ((hash << 5) + hash + 124) | 0;
  }
  return `${ids.length}:${(hash >>> 0).toString(36)}`;
}

export function loadStudyPosition(): SavedPosition | null {
  const pos = readJSON<SavedPosition>(POSITION_KEY);
  if (!pos || typeof pos.index !== "number" || typeof pos.fingerprint !== "string") return null;
  return pos;
}

export function saveStudyPosition(fingerprint: string, index: number): void {
  writeJSON(POSITION_KEY, { fingerprint, index } satisfies SavedPosition);
}

export function clearStudyPosition(): void {
  removeKey(POSITION_KEY);
}

// ---------------- 不限时（练习模式）偏好 ----------------

const UNTIMED_KEY = "knowflow.play.untimed";

/** 练习模式：不限时。默认关闭（限时才有紧迫感） */
export function loadUntimed(): boolean {
  try {
    return localStorage.getItem(UNTIMED_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveUntimed(value: boolean): void {
  try {
    localStorage.setItem(UNTIMED_KEY, value ? "1" : "0");
  } catch {
    /* 忽略 */
  }
}

// ---------------- 游戏成绩 ----------------

export function loadGameProgress(): GameProgress {
  const raw = readJSON<GameProgress>(GAME_KEY);
  // 手动改过 / 旧版本残留的数据可能是字符串或数组，别让它把页面带崩
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw;
}

export function saveGameResult(gameId: string, packId: string, score: number): GameProgress {
  const all = loadGameProgress();
  const byPack = all[gameId] ?? {};
  const prev = byPack[packId] ?? { bestScore: 0, plays: 0, lastPlayedAt: "" };
  byPack[packId] = {
    bestScore: Math.max(prev.bestScore, Math.round(score)),
    plays: prev.plays + 1,
    lastPlayedAt: new Date().toISOString()
  };
  all[gameId] = byPack;
  writeJSON(GAME_KEY, all);
  return all;
}

export function gameScoreOf(progress: GameProgress, gameId: string, packId: string): GameScore {
  return progress[gameId]?.[packId] ?? { bestScore: 0, plays: 0, lastPlayedAt: "" };
}

// ---------------- 趣味学习里选中的词库 ----------------

const PLAY_PACK_KEY = "knowflow.play.pack";

/** 趣味学习里选的词库，进入具体游戏时带在路由上，这里只做「上次选的」记忆 */
export function loadPlayPack(fallback = "cet4"): string {
  try {
    return localStorage.getItem(PLAY_PACK_KEY) || fallback;
  } catch {
    return fallback;
  }
}

export function savePlayPack(packId: string): void {
  try {
    localStorage.setItem(PLAY_PACK_KEY, packId);
  } catch {
    /* 忽略 */
  }
}
