/**
 * 食材图鉴数据冒烟：校验 public/packs/ingredients.json 的质量与合规。
 * 跑法：npm run test:food（先 npm run build:food）
 */
import fs from "node:fs";
import path from "node:path";

const ok = (c, m) => {
  if (!c) throw new Error("断言失败：" + m);
};

const file = path.resolve(process.cwd(), "public/packs/ingredients.json");
ok(fs.existsSync(file), "找不到 ingredients.json，先跑 npm run build:food");

const list = JSON.parse(fs.readFileSync(file, "utf8"));
ok(Array.isArray(list), "产物应该是数组");

// 1) 规模
ok(list.length >= 120, `食材条目应不少于 120，实际 ${list.length}`);
ok(list.length <= 220, `条目过多（${list.length}），检查是否混入调味料`);
console.log("1) 条目数:", list.length);

// 2) 字段完整性
const CATS = new Set(["vegetable", "fruit", "mushroom", "meat", "egg", "seafood", "bean", "grain", "nut", "dairy"]);
const names = new Set();
for (const e of list) {
  ok(!!e.name, "有条目缺少 name");
  ok(!names.has(e.name), `名称重复：${e.name}`);
  names.add(e.name);
  ok(CATS.has(e.category), `${e.name}：分类非法 ${e.category}`);
  ok(!!e.emoji, `${e.name}：缺少 emoji`);
  ok(!!e.benefit && e.benefit.length >= 8, `${e.name}：功效描述过短`);
  ok(typeof e.nutrition?.kcal === "number", `${e.name}：缺少热量`);
  ok(Array.isArray(e.seasons), `${e.name}：seasons 应是数组`);
  for (const s of e.seasons) ok(["春", "夏", "秋", "冬"].includes(s), `${e.name}：非法季节 ${s}`);
}
console.log("2) 字段完整、名称无重复");

// 3) 营养数值区间（明显的录入错误在这里拦住）
const RANGE = {
  kcal: [0, 900],
  protein: [0, 100],
  carb: [0, 100],
  fat: [0, 100],
  fiber: [0, 40],
  vc: [0, 500],
  potassium: [0, 2000],
  calcium: [0, 1000],
  iron: [0, 60],
  carotene: [0, 6000]
};
for (const e of list) {
  for (const [k, [min, max]] of Object.entries(RANGE)) {
    const v = e.nutrition[k];
    if (v === undefined) continue;
    ok(typeof v === "number" && Number.isFinite(v), `${e.name}：${k} 不是数字`);
    ok(v >= min && v <= max, `${e.name}：${k}=${v} 超出合理区间 ${min}~${max}`);
  }
}
console.log("3) 营养数值区间正常");

// 4) 分类覆盖
const byCat = {};
for (const e of list) byCat[e.category] = (byCat[e.category] ?? 0) + 1;
for (const c of ["vegetable", "fruit", "meat", "seafood", "bean", "grain", "mushroom"]) {
  ok((byCat[c] ?? 0) >= 3, `分类 ${c} 条目太少（${byCat[c] ?? 0}）`);
}
console.log("4) 分类覆盖:", byCat);

// 5) 合规：不能出现医疗宣称
const BANNED = ["治", "防癌", "抗癌", "降血压", "降血糖", "降血脂", "排毒", "消炎", "杀菌", "增强免疫", "预防"];
for (const e of list) {
  const text = `${e.benefit} ${e.caution ?? ""}`;
  for (const w of BANNED) {
    ok(!text.includes(w), `${e.name}：出现了疑似医疗宣称「${w}」→ ${text}`);
  }
}
console.log("5) 功效/宜忌无医疗宣称");

// 6) 季节标注：蔬果里应有相当比例带上季节
const veggies = list.filter((e) => e.category === "vegetable" || e.category === "fruit");
const withSeason = veggies.filter((e) => e.seasons.length > 0);
ok(withSeason.length / veggies.length >= 0.6, `带季节的蔬果比例偏低：${withSeason.length}/${veggies.length}`);
console.log(`6) 季节标注: ${withSeason.length}/${veggies.length} 蔬果`);

// 7) 索引里有这条 pack
const index = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "public/packs/index.json"), "utf8"));
const meta = index.packs.find((p) => p.id === "ingredients");
ok(!!meta, "index.json 缺少 ingredients 条目");
ok(meta.count === list.length, `索引 count=${meta.count} 与实际 ${list.length} 不一致`);
ok(meta.kind === "docs", "ingredients 的 kind 应为 docs");
console.log("7) 已登记到 index.json:", meta.title, meta.count, "条");

// 8) 别名可用于搜索
const withAlias = list.filter((e) => (e.alias ?? []).length);
ok(withAlias.length >= 10, "别名太少，搜索体验会差");
ok(list.find((e) => e.name === "番茄")?.alias?.includes("西红柿"), "番茄应带别名「西红柿」");
console.log(`8) 别名: ${withAlias.length} 条（番茄 → 西红柿）`);

console.log("\n✅ 食材图鉴数据 8 组断言全部通过");
