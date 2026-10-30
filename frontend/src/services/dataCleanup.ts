/**
 * 本地数据分类与清除。
 *
 * 为什么要分类：原来设置页只有一个「清除所有数据」，而且只清了 IndexedDB 五张表 ——
 * 闯关存档、背单词进度、游戏成绩、成语掌握度这些都在 localStorage 里，根本没被清掉，
 * 用户会觉得「没删干净」。反过来，只想清掉某类记录时也没有入口。
 *
 * 为什么要分区：分组从 4 个长到 10 个，一行一条全铺开，设置页会被撑成一长条，
 * 而且再加分组只会更糟。所以分组之上加一层「分区」（我的内容 / 学习记录 / 偏好配置），
 * 页面按分区折叠展示 —— 新增分组只要填一个 section 字段，自动落到对应分区里，
 * UI 不用跟着改。
 *
 * 内置内容（词库 / 语法 / 成语 / 食谱 / 食材）是打包在应用里的静态 JSON，
 * 不占用户数据空间、也不需要「删除」——它们产生的是学习记录，那部分才在这里。
 */
import { db } from "@/db/database";

export type TableName = "documents" | "categories" | "tasks" | "flashcards" | "aiJobs";

export type SectionId = "content" | "learning" | "prefs";

export interface DataSection {
  id: SectionId;
  title: string;
  /** 折叠时的一句话说明 */
  hint: string;
  /** 概览分段条与分区圆点的颜色 */
  tone: string;
}

/**
 * 分区：设置页按这个顺序折叠展示。
 * 顺序有讲究 —— 越靠前越是「用户自己产生、删了会心疼」的数据。
 */
export const DATA_SECTIONS: DataSection[] = [
  {
    id: "content",
    title: "我的内容",
    hint: "资料、卡片、任务，删了要重新整理",
    tone: "bg-brand-400"
  },
  {
    id: "learning",
    title: "学习记录",
    hint: "闯关、背单词、小游戏、成语与饮食的痕迹",
    tone: "bg-amber-400"
  },
  {
    id: "prefs",
    title: "偏好与设置",
    hint: "外观、陪伴机器人与 AI 配置",
    tone: "bg-slate-300"
  }
];

export interface DataGroup {
  id: string;
  /** 归属分区 */
  section: SectionId;
  label: string;
  desc: string;
  tables?: TableName[];
  /** localStorage 键（精确匹配） */
  keys?: string[];
}

const LS = {
  quest: ["knowflow.quest.session", "knowflow.quest.progress", "knowflow.study.position"],
  drill: ["knowflow.words.drill", "knowflow.words.drill.session"],
  games: ["knowflow.game.progress"],
  idiom: ["knowflow.idiom.level", "knowflow.idiom.mistakes"],
  kitchen: ["knowflow.kitchen.checked", "knowflow.kitchen.locks"],
  prefs: [
    "knowflow.theme",
    "knowflow.companion",
    "knowflow.play.pack",
    "knowflow.play.untimed",
    "knowflow.play.difficulty"
  ],
  ai: [
    "knowflow.ai.config",
    "knowflow.ai.key.persist",
    "knowflow.ai.key.session",
    "knowflow.ai.speech.config",
    "knowflow.ai.speech.key.persist",
    "knowflow.ai.speech.key.session"
  ]
};

export const DATA_GROUPS: DataGroup[] = [
  {
    id: "content",
    section: "content",
    label: "资料与分类",
    desc: "你创建或导入的资料、以及分类本身",
    tables: ["documents", "categories"]
  },
  {
    id: "cards",
    section: "content",
    label: "卡片与复习进度",
    desc: "记忆卡片、掌握度、下次复习时间",
    tables: ["flashcards"]
  },
  {
    id: "tasks",
    section: "content",
    label: "任务清单",
    desc: "待办、进行中、已完成的任务",
    tables: ["tasks"]
  },
  {
    id: "quest",
    section: "learning",
    label: "闯关与复习位置",
    desc: "单词闯关存档、成绩、复习到第几张",
    keys: LS.quest
  },
  {
    id: "drill",
    section: "learning",
    label: "背单词进度",
    desc: "各词库的关卡成绩、未做完的那一关",
    keys: LS.drill
  },
  {
    id: "games",
    section: "learning",
    label: "小游戏成绩",
    desc: "球球、跑酷、配对等玩法的最高分与局数",
    keys: LS.games
  },
  {
    id: "idiom",
    section: "learning",
    label: "成语掌握度",
    desc: "「会 / 模糊 / 不会」标记与错词次数",
    keys: LS.idiom
  },
  {
    id: "kitchen",
    section: "learning",
    label: "购物清单与计划锁定",
    desc: "勾选状态、锁定的菜（换周自动失效）",
    keys: LS.kitchen
  },
  {
    id: "prefs",
    section: "prefs",
    label: "外观与偏好",
    desc: "主题、陪伴设置、上次选的词库",
    keys: LS.prefs
  },
  {
    id: "ai",
    section: "prefs",
    label: "AI 配置与记录",
    desc: "模型配置、密钥、AI 任务记录",
    tables: ["aiJobs"],
    keys: LS.ai
  }
];

export interface GroupStat {
  /** 各表条数 */
  tables: Partial<Record<TableName, number>>;
  /** 有内容的 localStorage 键数 */
  keys: number;
  /** 是否为空（全都没数据） */
  empty: boolean;
}

/** 某一类的条目总数（表行数 + 有值的键数） */
export function groupItemCount(stat: GroupStat | undefined): number {
  if (!stat) return 0;
  return Object.values(stat.tables).reduce((n, v) => n + (v ?? 0), 0) + stat.keys;
}

/** 统计某一类的数据量；读失败按空处理，不让设置页整个崩掉 */
export async function statGroup(group: DataGroup): Promise<GroupStat> {
  const tables: Partial<Record<TableName, number>> = {};
  for (const name of group.tables ?? []) {
    try {
      tables[name] = await db[name].count();
    } catch {
      tables[name] = 0;
    }
  }
  let keys = 0;
  for (const k of group.keys ?? []) {
    try {
      if (localStorage.getItem(k) != null) keys += 1;
    } catch {
      /* 隐私模式下不可用，忽略 */
    }
  }
  const tableTotal = Object.values(tables).reduce((n, v) => n + (v ?? 0), 0);
  return { tables, keys, empty: tableTotal === 0 && keys === 0 };
}

/** 一次统计所有分组（顺序与传入一致，方便页面直接遍历） */
export async function statAll(groups: DataGroup[] = DATA_GROUPS): Promise<Record<string, GroupStat>> {
  const out: Record<string, GroupStat> = {};
  for (const g of groups) out[g.id] = await statGroup(g);
  return out;
}

/** 把统计结果转成一句人话 */
export function formatStat(group: DataGroup, stat: GroupStat): string {
  const t = stat.tables;
  switch (group.id) {
    case "content":
      return `${t.documents ?? 0} 份资料 · ${t.categories ?? 0} 个分类`;
    case "cards":
      return `${t.flashcards ?? 0} 张卡片`;
    case "tasks":
      return `${t.tasks ?? 0} 条任务`;
    case "ai":
      return `${t.aiJobs ?? 0} 条记录 · ${stat.keys} 项配置`;
    default:
      return stat.keys ? `${stat.keys} 项记录` : "无记录";
  }
}

/** 清除某一类；只动这一类，不影响其它 */
export async function clearGroup(group: DataGroup): Promise<void> {
  const tables = group.tables ?? [];
  if (tables.length) {
    await db.transaction("rw", tables.map((t) => db[t]), async () => {
      await Promise.all(tables.map((t) => db[t].clear()));
    });
  }
  for (const k of group.keys ?? []) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* 忽略 */
    }
  }
}

/**
 * 清空所有本地数据：所有分组 + 兜底扫掉剩余的 knowflow.* 键
 * （以防以后新增了键却忘了登记，导致「全清」名不副实）。
 */
export async function clearAllData(groups: DataGroup[] = DATA_GROUPS): Promise<void> {
  for (const g of groups) await clearGroup(g);
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("knowflow.")) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    /* 忽略 */
  }
}

// ---------------- 分区聚合 ----------------

export interface SectionView extends DataSection {
  groups: DataGroup[];
  /** 该分区内的条目总数 */
  items: number;
  /** 该分区内有数据的分组数 */
  filled: number;
}

/** 按分区聚合分组与统计，页面只渲染这个结构，不再自己算 */
export function buildSectionViews(
  groups: DataGroup[],
  stats: Record<string, GroupStat>
): SectionView[] {
  return DATA_SECTIONS.map((s) => {
    const list = groups.filter((g) => g.section === s.id);
    const items = list.reduce((n, g) => n + groupItemCount(stats[g.id]), 0);
    const filled = list.filter((g) => stats[g.id] && !stats[g.id].empty).length;
    return { ...s, groups: list, items, filled };
  }).filter((s) => s.groups.length > 0);
}
