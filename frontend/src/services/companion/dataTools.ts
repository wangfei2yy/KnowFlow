/**
 * 小知的「数据管理」工具：让机器人也能查本地存了什么、按类别清掉。
 *
 * 这里只放纯逻辑（不 import store / db），方便单测：
 * ① 从一句话里认出「要清哪一类」；
 * ② 认出「确认 / 取消」这类短回复；
 * ③ 把清除范围解析成具体的分组列表。
 *
 * 真正执行清除在 companionTool.ts 里，且**必须经过一次确认**——
 * 删数据不可撤销，机器人不能一句话就动手。
 */
import type { DataGroup, SectionId } from "@/services/dataCleanup";
import { DATA_SECTIONS } from "@/services/dataCleanup";

/** 明确表达的「要删」动作词 */
const CLEAN_VERB = /清除|清掉|清理|清空|删除|删掉|删了|抹掉|重置|恢复出厂/;

const CONFIRM_RE =
  /^(确认|确定|是的|是的呀|是|嗯|嗯嗯|好|好的|可以|行|对|执行|删吧|清吧|清除吧|清空吧|确认清除|确认清空|确认删除)[。.!！~～]?$/;

const CANCEL_RE = /^(取消|算了|不用了?|不要了?|先不|别删|别清|不删了?|不清了?)[。.!！~～]?$/;

export function isConfirm(text: string): boolean {
  return CONFIRM_RE.test(text.trim().toLowerCase());
}

export function isCancel(text: string): boolean {
  return CANCEL_RE.test(text.trim().toLowerCase());
}

/**
 * 分组关键词：用户很少说得出「闯关与复习位置」这种全名，
 * 更多是「把小游戏成绩清掉」「成语记录不要了」。
 * 顺序 = 匹配优先级，越具体的放越前（避免「单词」被「游戏」抢走）。
 */
const GROUP_KEYWORDS: { id: string; re: RegExp }[] = [
  { id: "drill", re: /背单词|单词关卡|单词进度|单词学习/ },
  { id: "quest", re: /闯关|复习位置|复习到哪|学习位置/ },
  { id: "idiom", re: /成语/ },
  { id: "kitchen", re: /购物清单|购物|买菜|计划锁定|饮食|菜谱|食材/ },
  { id: "games", re: /游戏|球球|跑酷|配对|街机|成绩/ },
  { id: "cards", re: /卡片|闪卡|复习记录|掌握度/ },
  { id: "tasks", re: /任务|待办|行动项/ },
  { id: "content", re: /资料|文档|笔记|分类/ },
  { id: "prefs", re: /偏好|外观|主题|主题色/ },
  { id: "ai", re: /\bai\b|密钥|key|模型配置|配置/ }
];

/** 分区级关键词：一次清一整片（学习记录最容易「全清」） */
const SECTION_KEYWORDS: { id: SectionId; re: RegExp }[] = [
  { id: "learning", re: /学习记录|学习进度|所有进度|全部进度/ }
];

/** 全清关键词 */
const ALL_RE = /全部|所有|一切|整个|清空所有|恢复出厂|所有数据|全部数据/;

export interface CleanupScope {
  /** 分组 id / `section:<id>` / `all` */
  scope: string;
  /** 给人看的名字 */
  label: string;
}

/** 把 scope 解析成要清的分组列表 */
export function resolveCleanupGroups(
  scope: string,
  groups: DataGroup[]
): { label: string; groups: DataGroup[] } | null {
  if (scope === "all") {
    return { label: "全部本地数据", groups };
  }
  if (scope.startsWith("section:")) {
    const id = scope.slice("section:".length) as SectionId;
    const meta = DATA_SECTIONS.find((s) => s.id === id);
    const list = groups.filter((g) => g.section === id);
    if (!meta || list.length === 0) return null;
    return { label: `全部${meta.title}`, groups: list };
  }
  const g = groups.find((x) => x.id === scope);
  if (!g) return null;
  return { label: g.label, groups: [g] };
}

/**
 * 从用户的话里认出清除范围。
 * 返回 null 表示「这不是清理请求」。
 *
 * 判定顺序：先看有没有删除动作词 → 再看是不是分区级 → 再看具体分组 → 最后全清。
 * 具体分组优先于全清，是因为「清除所有游戏成绩」里也有个「所有」。
 */
export function matchCleanupScope(text: string, groups: DataGroup[]): CleanupScope | null {
  const t = text.trim();
  if (!t || !CLEAN_VERB.test(t)) return null;

  for (const s of SECTION_KEYWORDS) {
    const meta = DATA_SECTIONS.find((x) => x.id === s.id);
    if (s.re.test(t) && meta && groups.some((g) => g.section === s.id)) {
      return { scope: `section:${s.id}`, label: `全部${meta.title}` };
    }
  }

  for (const k of GROUP_KEYWORDS) {
    const g = groups.find((x) => x.id === k.id);
    if (g && k.re.test(t)) return { scope: g.id, label: g.label };
  }

  if (ALL_RE.test(t)) return { scope: "all", label: "全部本地数据" };
  return null;
}

/** 查询类：用户问「本地存了多少数据 / 有哪些记录」 */
export function isStorageQuery(text: string): boolean {
  const t = text.trim();
  if (CLEAN_VERB.test(t)) return false;
  return /本地(存|有|占|数据)|存储(占用|空间|多少)|占(了)?多少|缓存(有|占)|哪些数据|数据(有|占)多少|存了(多少|哪些|什么)/.test(
    t
  );
}

/** 确认前的提示文案 */
export function buildCleanupPrompt(label: string, groups: DataGroup[], counts: string[]): string {
  // 全清时可能有十类，全列出来会刷屏：只给前三类，其余折叠成「等 N 类」
  const detail =
    counts.length > 3
      ? `${counts.slice(0, 3).join("、")} 等 ${counts.length} 类`
      : counts.filter(Boolean).join("、");
  const warn =
    groups.length > 1
      ? `会一次性清掉 ${groups.length} 类数据`
      : `只会清掉「${label}」`;
  return (
    `准备清除「${label}」${detail ? `（${detail}）` : ""}。\n` +
    `${warn}，其它数据不受影响，内置词库和食谱也都在。\n` +
    `这一步删掉就找不回来了，建议先到「设置 → 导出备份」。\n` +
    `确定的话回我「确认」，不想删就说「算了」。`
  );
}
