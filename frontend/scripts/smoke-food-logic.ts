/**
 * 食材图鉴纯逻辑单测：筛选、排序、营养行、卡片文案、食谱反查、材料归类。
 * 跑法：npm run test:food:logic
 */
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  cardAnswerOf,
  categorizeIngredients,
  filterIngredients,
  findIngredient,
  highlightOf,
  isInSeason,
  nutritionRows,
  recipesUsing,
  seasonOf,
  sortIngredients
} from "@/services/foodPack";
import type { IngredientEntry, RecipeEntry } from "@/services/knowledgePack";

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error("断言失败：" + m);
};

const mk = (name: string, patch: Partial<IngredientEntry> = {}): IngredientEntry => ({
  name,
  emoji: "🍅",
  category: "vegetable",
  seasons: [],
  nutrition: { kcal: 20 },
  benefit: "富含维生素 C，有助于维持正常免疫功能",
  storage: "冷藏",
  ...patch
});

const list: IngredientEntry[] = [
  mk("番茄", { alias: ["西红柿"], seasons: ["夏"], nutrition: { kcal: 20, vc: 19, potassium: 163 } }),
  mk("菠菜", { seasons: ["春", "秋"], nutrition: { kcal: 28, vc: 32, iron: 2.9, carotene: 2920 } }),
  mk("鸡蛋", { category: "egg", nutrition: { kcal: 144, protein: 13.3 } }),
  mk("香菇", { category: "mushroom", seasons: ["冬"], nutrition: { kcal: 26, fiber: 3.3 } }),
  mk("橙", { category: "fruit", seasons: ["冬"], nutrition: { kcal: 48, vc: 33 } })
];

// ---------------- 1) 季节判定 ----------------
ok(seasonOf(new Date(2026, 2, 15)) === "春", "3 月应是春");
ok(seasonOf(new Date(2026, 4, 31)) === "春", "5 月应是春");
ok(seasonOf(new Date(2026, 5, 1)) === "夏", "6 月应是夏");
ok(seasonOf(new Date(2026, 7, 31)) === "夏", "8 月应是夏");
ok(seasonOf(new Date(2026, 8, 1)) === "秋", "9 月应是秋");
ok(seasonOf(new Date(2026, 11, 1)) === "冬", "12 月应是冬");
ok(seasonOf(new Date(2026, 0, 20)) === "冬", "1 月应是冬");
ok(isInSeason(list[1], "春") && !isInSeason(list[1], "夏"), "菠菜应只标春秋");
console.log("1) 季节判定：12/3/6/9 月分别落在冬/春/夏/秋");

// ---------------- 2) 关键词 ----------------
ok(filterIngredients(list, { keyword: "" }).length === 5, "空关键词应返回全部");
ok(filterIngredients(list, { keyword: "番茄" }).length === 1, "按名称搜");
ok(filterIngredients(list, { keyword: "西红柿" }).length === 1, "按别名搜");
ok(filterIngredients(list, { keyword: "维C" }).length === 0, "中文大小写不影响（搜不到时应为空）");
ok(filterIngredients(list, { keyword: "维生素" }).length >= 4, "功效关键词应能命中多条");
ok(filterIngredients(list, { keyword: "菌菇" }).length === 1, "分类名也能搜");
console.log("2) 关键词：名称 / 别名 / 功效 / 分类名 均可命中");

// ---------------- 3) 分类与当季筛选 ----------------
ok(filterIngredients(list, { category: "egg" }).length === 1, "按分类筛");
const summer = filterIngredients(list, { onlySeason: true, season: "夏" });
ok(summer.length === 1 && summer[0].name === "番茄", "只看夏季应只剩番茄");
const winter = filterIngredients(list, { onlySeason: true, season: "冬" });
ok(winter.length === 2, `冬季应有 2 条，实际 ${winter.length}`);
ok(
  filterIngredients(list, { keyword: "番", category: "fruit" }).length === 0,
  "分类与关键词是「与」关系"
);
console.log("3) 分类 + 当季筛选：夏季 1 条、冬季 2 条");

// ---------------- 4) 排序：当季优先 ----------------
const sorted = sortIngredients(list, "冬");
ok(sorted[0].seasons.includes("冬"), "当季的应排在前面");
const tail = sorted.slice(-1)[0];
ok(!tail.seasons.includes("冬"), "非当季的排在后面");
// 同季时按分类顺序
const sameSeason = sortIngredients(
  [mk("乙", { category: "nut", seasons: ["冬"] }), mk("甲", { category: "vegetable", seasons: ["冬"] })],
  "冬"
);
ok(sameSeason[0].name === "甲", "同为当季时，应按分类顺序（蔬菜在坚果前）");
console.log("4) 排序：当季优先 →", sorted.map((e) => e.name).join(" "));

// ---------------- 5) 营养行 ----------------
const rows = nutritionRows(list[0]);
ok(rows.length === 3, `番茄应有 3 行（能量/维C/钾），实际 ${rows.length}`);
ok(rows[0].label === "能量" && rows[0].value === "20" && rows[0].unit === "kcal", "首行应为能量");
ok(rows.every((r) => r.value !== "undefined"), "没有数据的字段不应出现");
ok(nutritionRows(mk("白水", { nutrition: { kcal: 0 } })).length === 1, "只有热量时只出 1 行");
console.log("5) 营养行:", rows.map((r) => `${r.label}${r.value}${r.unit}`).join(" / "));

// ---------------- 6) 卡片文案 ----------------
const answer = cardAnswerOf(list[0]);
ok(answer.startsWith("每 100g 约 20 kcal；"), `文案应以热量打头，实际「${answer}」`);
ok(answer.length <= 70, `文案应 ≤ 70 字，实际 ${answer.length}`);
const long = cardAnswerOf(mk("超长", { nutrition: { kcal: 100 }, benefit: "啊".repeat(200) }));
ok(long.length <= 70 && long.endsWith("…"), "超长功效应截断并加省略号");
console.log("6) 卡片文案:", answer);

// ---------------- 7) 食谱反查 ----------------
const recipes: RecipeEntry[] = [
  { id: "r1", name: "番茄炒蛋", meal: "lunch", materials: ["番茄", "鸡蛋"], steps: ["炒"], tags: [] },
  { id: "r2", name: "菠菜汤", meal: "dinner", materials: ["菠菜", "盐"], steps: ["煮"], tags: [] },
  { id: "r3", name: "香菇滑鸡", meal: "dinner", materials: ["香菇", "鸡腿"], steps: ["蒸"], tags: [] }
];
const hit = recipesUsing(recipes, list[0]);
ok(hit.length === 1 && hit[0].id === "r1", "番茄应只命中番茄炒蛋");
ok(recipesUsing(recipes, mk("菠菜")).length === 1, "菠菜命中菠菜汤");
ok(recipesUsing(recipes, mk("不存在的菜")).length === 0, "没有命中应返回空数组");
const many = recipesUsing(
  Array.from({ length: 10 }, (_, i) => ({
    id: `x${i}`,
    name: `菜${i}`,
    meal: "lunch" as const,
    materials: ["番茄"],
    steps: [],
    tags: []
  })),
  list[0],
  5
);
ok(many.length === 5, "应受 limit 限制");
console.log("7) 食谱反查：番茄 →", hit.map((r) => r.name).join("/"), "（limit 生效）");

// ---------------- 8) 按名称找食材 / 材料归类 ----------------
ok(findIngredient(list, "番茄")?.name === "番茄", "按名称找");
ok(findIngredient(list, "西红柿")?.name === "番茄", "按别名找");
ok(findIngredient(list, "番茄1个")?.name === "番茄", "带后缀的材料串也能认出");
ok(findIngredient(list, "无关") === undefined, "找不到返回 undefined");

const summary = categorizeIngredients(["番茄", "鸡蛋", "菠菜", "不存在的调料"], list);
ok(summary.total === 4 && summary.matched === 3, `应有 3/4 命中，实际 ${summary.matched}/${summary.total}`);
ok(summary.counts.find((c) => c.category === "vegetable")?.count === 2, "蔬菜 2 种");
ok(summary.counts.find((c) => c.category === "egg")?.count === 1, "蛋类 1 种");
ok(summary.counts[0].category === "vegetable", "应按分类顺序排列");
console.log(
  "8) 归类:",
  summary.counts.map((c) => `${CATEGORY_LABEL[c.category]}${c.count}`).join(" "),
  `| 命中 ${summary.matched}/${summary.total}`
);

// ---------------- 9) 卡片亮点 ----------------
ok(highlightOf(list[1]) === "胡萝卜素高", "菠菜应标胡萝卜素高");
ok(highlightOf(list[2]) === "", "鸡蛋（蛋白 13.3）不该被标蛋白高");
ok(highlightOf(mk("蛋白粉", { nutrition: { kcal: 300, protein: 20 } })) === "蛋白高", "蛋白 20g 应标蛋白高");
ok(highlightOf(mk("清水", { nutrition: { kcal: 0 } })) === "低热量", "0 kcal 应标低热量");

console.log("\n✅ 食材图鉴逻辑 9 组断言全部通过");
