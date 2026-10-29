/**
 * 食材图鉴的纯逻辑：筛选、排序、营养表行、卡片文案、食谱反查。
 *
 * 不碰网络与 DOM，方便单测；数据加载仍在 knowledgePack.ts（统一走 fetch 缓存）。
 */
import type { IngredientCategory, IngredientEntry, RecipeEntry } from "@/services/knowledgePack";

export const CATEGORY_LABEL: Record<IngredientCategory, string> = {
  vegetable: "蔬菜",
  fruit: "水果",
  mushroom: "菌菇",
  bean: "豆类",
  grain: "谷物",
  meat: "肉类",
  egg: "蛋类",
  seafood: "水产",
  dairy: "奶类",
  nut: "坚果"
};

/** 列表里的分类顺序：先菜、后肉、最后坚果奶 */
export const CATEGORY_ORDER: IngredientCategory[] = [
  "vegetable",
  "mushroom",
  "fruit",
  "bean",
  "grain",
  "meat",
  "seafood",
  "egg",
  "dairy",
  "nut"
];

export type Season = "春" | "夏" | "秋" | "冬";

/** 3-5 春 / 6-8 夏 / 9-11 秋 / 12-2 冬 */
export function seasonOf(date: Date = new Date()): Season {
  const m = date.getMonth() + 1;
  if (m >= 3 && m <= 5) return "春";
  if (m >= 6 && m <= 8) return "夏";
  if (m >= 9 && m <= 11) return "秋";
  return "冬";
}

export function isInSeason(entry: IngredientEntry, season: Season): boolean {
  return entry.seasons.includes(season);
}

function norm(text: string): string {
  return (text ?? "").replace(/\s+/g, "").toLowerCase();
}

/** 名称 + 别名 + 功效 都参与关键词匹配，搜「补铁」也能找到 */
function matchKeyword(entry: IngredientEntry, keyword: string): boolean {
  const k = norm(keyword);
  if (!k) return true;
  const hay = [entry.name, ...(entry.alias ?? []), entry.benefit, CATEGORY_LABEL[entry.category]]
    .map(norm)
    .join(" ");
  return hay.includes(k);
}

export interface FilterOptions {
  keyword?: string;
  category?: IngredientCategory | "";
  /** 只看当季 */
  onlySeason?: boolean;
  season?: Season;
}

export function filterIngredients(list: IngredientEntry[], opts: FilterOptions = {}): IngredientEntry[] {
  const season = opts.season ?? seasonOf();
  return list.filter((e) => {
    if (opts.category && e.category !== opts.category) return false;
    if (opts.onlySeason && !isInSeason(e, season)) return false;
    if (opts.keyword && !matchKeyword(e, opts.keyword)) return false;
    return true;
  });
}

/** 当季优先 → 分类顺序 → 名称 */
export function sortIngredients(list: IngredientEntry[], season: Season = seasonOf()): IngredientEntry[] {
  return [...list].sort((a, b) => {
    const sa = isInSeason(a, season) ? 0 : 1;
    const sb = isInSeason(b, season) ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const ca = CATEGORY_ORDER.indexOf(a.category);
    const cb = CATEGORY_ORDER.indexOf(b.category);
    if (ca !== cb) return ca - cb;
    return a.name.localeCompare(b.name, "zh");
  });
}

export interface NutritionRow {
  label: string;
  value: string;
  unit: string;
}

const NUTRIENT_FIELDS: { key: keyof IngredientEntry["nutrition"]; label: string; unit: string }[] = [
  { key: "kcal", label: "能量", unit: "kcal" },
  { key: "protein", label: "蛋白质", unit: "g" },
  { key: "carb", label: "碳水化合物", unit: "g" },
  { key: "fat", label: "脂肪", unit: "g" },
  { key: "fiber", label: "膳食纤维", unit: "g" },
  { key: "vc", label: "维生素 C", unit: "mg" },
  { key: "potassium", label: "钾", unit: "mg" },
  { key: "calcium", label: "钙", unit: "mg" },
  { key: "iron", label: "铁", unit: "mg" },
  { key: "carotene", label: "胡萝卜素", unit: "μg" }
];

/** 营养表行：只输出有值的字段，缺数据的不显示（不是 0） */
export function nutritionRows(entry: IngredientEntry): NutritionRow[] {
  return NUTRIENT_FIELDS.filter((f) => typeof entry.nutrition[f.key] === "number").map((f) => ({
    label: f.label,
    value: String(entry.nutrition[f.key]),
    unit: f.unit
  }));
}

/** 复习卡片的答案：热量打头 + 功效，控制在 70 字内，太长就截断功效 */
export function cardAnswerOf(entry: IngredientEntry, limit = 70): string {
  const head = `每 100g 约 ${entry.nutrition.kcal} kcal；`;
  const room = Math.max(10, limit - head.length - 1);
  const benefit = entry.benefit.length > room ? `${entry.benefit.slice(0, room)}…` : entry.benefit;
  return `${head}${benefit}`;
}

/** 反查：哪些菜谱用得上这个食材（材料名或别名命中） */
export function recipesUsing(recipes: RecipeEntry[], entry: IngredientEntry, limit = 5): RecipeEntry[] {
  const keys = [entry.name, ...(entry.alias ?? [])].map(norm).filter(Boolean);
  const hit: RecipeEntry[] = [];
  for (const r of recipes) {
    const materials = (r.materials ?? []).map(norm);
    if (materials.some((m) => keys.some((k) => m === k || m.includes(k)))) {
      hit.push(r);
      if (hit.length >= limit) break;
    }
  }
  return hit;
}

/** 一个食材最亮眼的营养素，用于卡片上的一句话标签 */
export function highlightOf(entry: IngredientEntry): string {
  const n = entry.nutrition;
  if ((n.vc ?? 0) >= 40) return "维 C 高";
  if ((n.carotene ?? 0) >= 1000) return "胡萝卜素高";
  if ((n.fiber ?? 0) >= 3) return "纤维多";
  if ((n.calcium ?? 0) >= 100) return "钙高";
  if ((n.iron ?? 0) >= 3) return "铁高";
  if ((n.protein ?? 0) >= 15) return "蛋白高";
  if (n.kcal <= 30) return "低热量";
  return "";
}

/** 按名称或别名找食材；材料串里常带「适量」之类的尾巴，用包含匹配兜一层 */
export function findIngredient(list: IngredientEntry[], name: string): IngredientEntry | undefined {
  const key = norm(name);
  if (!key) return undefined;
  const exact = list.find((e) => [e.name, ...(e.alias ?? [])].some((n) => norm(n) === key));
  if (exact) return exact;
  return list.find((e) => key.includes(norm(e.name)) || (e.alias ?? []).some((a) => key.includes(norm(a))));
}

export interface CategoryCount {
  category: IngredientCategory;
  count: number;
}

/**
 * 把一堆材料名归类计数（饮食计划页的「本周食材构成」用）。
 * 返回已按 CATEGORY_ORDER 排序的列表，并给出可识别的总数。
 */
export function categorizeIngredients(
  names: string[],
  list: IngredientEntry[]
): { counts: CategoryCount[]; matched: number; total: number } {
  const seen = new Map<IngredientCategory, Set<string>>();
  let matched = 0;
  for (const name of names) {
    const hit = findIngredient(list, name);
    if (!hit) continue;
    matched += 1;
    if (!seen.has(hit.category)) seen.set(hit.category, new Set());
    seen.get(hit.category)!.add(hit.name);
  }
  const counts = CATEGORY_ORDER.filter((c) => seen.has(c)).map((c) => ({
    category: c,
    count: seen.get(c)!.size
  }));
  return { counts, matched, total: names.length };
}
