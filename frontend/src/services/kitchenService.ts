/**
 * 饮食模块的纯逻辑：从「家里有什么」反查菜谱、购物清单的分组/导出/勾选。
 *
 * 这些都不该写在页面里 —— 反查的「差几样」排序和清单的勾选持久化
 * 一旦写错，用户只会觉得「查不到」「勾了又回来」，不会报错。
 */
import type { IngredientCategory, IngredientEntry, RecipeEntry } from "@/services/knowledgePack";
import { CATEGORY_LABEL, CATEGORY_ORDER, findIngredient } from "@/services/foodPack";

/** 反查结果：能直接做的 + 差一两样的（差得越少排越前） */
export interface PantryResult {
  full: RecipeEntry[];
  near: { recipe: RecipeEntry; missing: string[] }[];
}

const norm = (s: string) => s.trim();

/**
 * 按「家里现有食材」反查菜谱。
 *
 * - 只比材料名，不做同义词推断：菜谱里写「番茄」而你有「西红柿」时靠图鉴 alias 归一
 * - 差 0 样 = 能做；差 1~maxMissing 样 = 快能做（列出缺什么）
 * - 没有任何材料的菜（少数没抽出来的）不参与，否则会被误判成「全都够」
 */
export function searchByPantry(
  recipes: RecipeEntry[],
  pantry: string[],
  maxMissing = 2,
  ingredients: IngredientEntry[] = [],
  minCoverage = 0.5
): PantryResult {
  const have = new Set<string>();
  for (const p of pantry.map(norm).filter(Boolean)) {
    have.add(p);
    const hit = findIngredient(ingredients, p);
    if (hit) {
      have.add(hit.name);
      for (const a of hit.alias ?? []) have.add(a);
    }
  }
  if (!have.size) return { full: [], near: [] };

  const full: RecipeEntry[] = [];
  const near: { recipe: RecipeEntry; missing: string[] }[] = [];

  for (const r of recipes) {
    const mats = (r.materials ?? []).map(norm).filter(Boolean);
    if (!mats.length) continue;
    const missing = mats.filter((m) => {
      if (have.has(m)) return false;
      // 材料名与图鉴名互为别名时也算有
      const hit = findIngredient(ingredients, m);
      if (!hit) return true;
      return !have.has(hit.name) && !(hit.alias ?? []).some((a) => have.has(a));
    });
    if (!missing.length) {
      full.push(r);
      continue;
    }
    // 只勾了两样时，几乎所有菜都「差一两样」—— 若不看覆盖率，结果会长到几十条，
    // 里面很多是「还差两样但那两样是主料」的菜。要求已覆盖一半以上才进列表。
    const covered = (mats.length - missing.length) / mats.length;
    if (missing.length <= maxMissing && covered >= minCoverage) {
      near.push({ recipe: r, missing });
    }
  }

  // 先按缺口少的，再按覆盖率高的（同样是差一样，材料更集中的更值得做）
  near.sort(
    (a, b) =>
      a.missing.length - b.missing.length ||
      a.recipe.materials.length - b.recipe.materials.length ||
      a.recipe.name.localeCompare(b.recipe.name, "zh")
  );
  return { full, near };
}

/** 出现次数最多的材料（弹层里给几个「常备」快捷选项） */
export function commonMaterials(recipes: RecipeEntry[], limit = 24): { name: string; count: number }[] {
  const m = new Map<string, number>();
  for (const r of recipes) for (const x of r.materials ?? []) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"))
    .slice(0, limit);
}

export interface ShoppingGroup {
  category: IngredientCategory | "other";
  label: string;
  items: { name: string; count: number; checked: boolean }[];
}

/**
 * 购物清单分组：按食材图鉴的分类排（蔬菜→肉蛋→水产→豆谷→菌菇→坚果→奶类→其他）。
 * 图鉴里没有的（调味料、面点等）归到「其他」，不丢。
 */
export function groupShopping(
  items: [string, number][],
  ingredients: IngredientEntry[],
  checked: Set<string> = new Set()
): ShoppingGroup[] {
  const buckets = new Map<string, ShoppingGroup["items"]>();
  for (const [name, count] of items) {
    const cat = findIngredient(ingredients, name)?.category ?? "other";
    const list = buckets.get(cat) ?? [];
    list.push({ name, count, checked: checked.has(name) });
    buckets.set(cat, list);
  }
  const order: (IngredientCategory | "other")[] = [...CATEGORY_ORDER, "other"];
  return order
    .filter((c) => buckets.has(c))
    .map((c) => ({
      category: c,
      label: c === "other" ? "其他" : CATEGORY_LABEL[c as IngredientCategory],
      items: buckets.get(c)!.sort((a, b) => a.name.localeCompare(b.name, "zh"))
    }));
}

/** 导出成纯文本：带去超市的是手机备忘录，不是网页 */
export function shoppingText(groups: ShoppingGroup[]): string {
  const lines: string[] = [];
  for (const g of groups) {
    lines.push(`【${g.label}】`);
    for (const it of g.items) lines.push(`${it.checked ? "☑" : "□"} ${it.name} ×${it.count}`);
  }
  return lines.join("\n");
}

// ---------------- 勾选状态（按周隔离） ----------------

const CHECKED_KEY = "knowflow.kitchen.checked";

/** 本周起始日（周一）作为 key 的一部分：换周自动清空，不会把上週的勾带过来 */
export function weekKeyOf(date: Date = new Date()): string {
  const d = new Date(date);
  const day = (d.getDay() + 6) % 7; // 周一 = 0
  d.setDate(d.getDate() - day);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type CheckedStore = Record<string, string[]>;

function readAll(): CheckedStore {
  try {
    const raw = localStorage.getItem(CHECKED_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as CheckedStore) : {};
  } catch {
    return {};
  }
}

export function loadChecked(week = weekKeyOf()): Set<string> {
  return new Set(readAll()[week] ?? []);
}

export function saveChecked(set: Set<string>, week = weekKeyOf()): void {
  try {
    const all = readAll();
    all[week] = [...set];
    // 只留最近两周，避免无限增长
    const keys = Object.keys(all).sort();
    while (keys.length > 2) {
      const k = keys.shift()!;
      delete all[k];
    }
    localStorage.setItem(CHECKED_KEY, JSON.stringify(all));
  } catch {
    /* 存储不可用就当没勾，不影响当前页面 */
  }
}

// ---------------- 计划锁定（按周，换周即清） ----------------

const LOCK_KEY = "knowflow.kitchen.locks";

/**
 * 锁定的粒度是「第几天 + 哪一餐」，不是「第几天的某一餐吃了什么菜」。
 * 这样点「换一换」时锁住的那格不动，其余重抽；换周自动失效，不会把上週的锁带过来。
 */
export type LockMap = Record<string, string>;

function readLocks(): Record<string, LockMap> {
  try {
    const raw = localStorage.getItem(LOCK_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, LockMap>) : {};
  } catch {
    return {};
  }
}

export function loadLocks(week = weekKeyOf()): LockMap {
  return { ...(readLocks()[week] ?? {}) };
}

export function saveLocks(locks: LockMap, week = weekKeyOf()): void {
  try {
    const all = readLocks();
    all[week] = locks;
    const keys = Object.keys(all).sort();
    while (keys.length > 2) {
      const k = keys.shift()!;
      delete all[k];
    }
    localStorage.setItem(LOCK_KEY, JSON.stringify(all));
  } catch {
    /* 存储不可用就不锁，不影响当前页面 */
  }
}

export const slotKeyOf = (dayIndex: number, meal: string) => `${dayIndex}:${meal}`;
