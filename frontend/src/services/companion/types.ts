// 陪伴机器人「小知」的类型与规则定义

export type CompanionMood = "happy" | "normal" | "encouraging";

/** 小知的形态，随好感度自动升级 */
export type CompanionForm = 1 | 2 | 3;

export interface ChatMessage {
  role: "user" | "bot";
  text: string;
  at: string;
}

export interface CompanionState {
  enabled: boolean;
  name: string;
  // 好感度（0-100 基础分）+ 累计相处天数
  affection: number;
  level: number;
  // 累计使用行为次数
  activityCount: number;
  // 首次见面时间（用于计算相处天数）
  firstMetAt: string;
  // 最近互动时间
  lastActiveAt: string;
  // 自定义头像（base64 图片，空则用默认机器人形象）
  avatarUrl: string;
  // 对话历史
  messages: ChatMessage[];
}

export const COMPANION_NAME = "小知";

// 每个等级所需好感度
export const LEVEL_THRESHOLDS = [0, 20, 50, 100, 200, 400, 800];

export const LEVEL_TITLES = [
  "初识",
  "熟悉",
  "信赖",
  "亲密",
  "挚友",
  "知己",
  "灵魂伙伴"
];

// 不同行为带来的好感度增长
export const AFFECTION_REWARDS = {
  createDocument: 3,
  completeTask: 5,
  reviewCard: 4,
  search: 1,
  aiAction: 2,
  importFile: 3,
  chat: 1
} as const;

/** 形态升级阈值：好感度 >= 30 进形态二，>= 60 进形态三 */
export const FORM_UPGRADE_THRESHOLD = 30;
export const FORM_UPGRADE_THRESHOLD_3 = 60;

export function formFromAffection(affection: number): CompanionForm {
  if (affection >= FORM_UPGRADE_THRESHOLD_3) return 3;
  if (affection >= FORM_UPGRADE_THRESHOLD) return 2;
  return 1;
}

export const FORM_NAMES: Record<CompanionForm, string> = {
  1: "幼芽形态",
  2: "成长形态",
  3: "蜕变形态"
};

export function levelFromAffection(affection: number): number {
  let lvl = 0;
  for (let i = 0; i < LEVEL_THRESHOLDS.length; i++) {
    if (affection >= LEVEL_THRESHOLDS[i]) lvl = i;
  }
  return lvl;
}

export function levelTitle(level: number): string {
  return LEVEL_TITLES[Math.min(level, LEVEL_TITLES.length - 1)];
}

export function levelProgress(affection: number): { current: number; next: number; percent: number } {
  const lvl = levelFromAffection(affection);
  const current = LEVEL_THRESHOLDS[lvl] ?? 0;
  const next = LEVEL_THRESHOLDS[lvl + 1];
  if (next === undefined) {
    return { current, next: current, percent: 100 };
  }
  const percent = Math.min(100, Math.round(((affection - current) / (next - current)) * 100));
  return { current, next, percent };
}

export function daysSince(iso: string): number {
  const diff = Date.now() - new Date(iso).getTime();
  return Math.floor(diff / (24 * 3600 * 1000));
}
