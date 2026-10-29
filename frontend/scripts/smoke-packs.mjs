/**
 * 知识包完整性检查：编译脚本改坏数据时能立刻发现。
 * 直接读 public/packs/*.json，不依赖前端代码。
 */
import fs from "node:fs";
import path from "node:path";

const DIR = path.resolve(process.cwd(), "public", "packs");
const read = (f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
const ok = (c, m) => {
  if (!c) throw new Error("断言失败：" + m);
};

const index = read("index.json");
const ids = index.packs.map((p) => p.id);
console.log("包清单:", index.packs.map((p) => `${p.id}(${p.count})`).join(" "));
for (const need of ["cet4", "cet6", "grammar", "idiom", "recipes", "seasons"]) {
  ok(ids.includes(need), `缺少包 ${need}`);
}

// ---------- 成语 ----------
const idioms = read("idiom.json");
ok(idioms.length >= 120, `成语数量偏少：${idioms.length}`);
ok(new Set(idioms.map((i) => i.w)).size === idioms.length, "成语有重复");
for (const it of idioms) {
  ok(typeof it.w === "string" && it.w.length === 4, `成语不是 4 字：${it.w}`);
  ok(typeof it.m === "string" && it.m.length >= 4, `释义为空：${it.w}`);
  ok(!/解释[：:]|出处[：:]/.test(it.m), `释义残留字段名：${it.w}`);
}
const withFrom = idioms.filter((i) => i.from).length;
console.log(`成语：${idioms.length} 条，带出处 ${withFrom} 条，最长释义 ${Math.max(...idioms.map((i) => i.m.length))} 字`);

// ---------- 食谱 ----------
const recipes = read("recipes.json");
ok(recipes.length >= 100, `食谱数量偏少：${recipes.length}`);
ok(new Set(recipes.map((r) => r.name)).size === recipes.length, "食谱名称有重复");
const MEALS = new Set(["breakfast", "lunch", "dinner", "snack"]);
for (const r of recipes) {
  ok(r.name && r.name.length >= 2, `菜名为空：${r.id}`);
  ok(!/[“”"（）();；，.或]$/.test(r.name), `菜名残留标点：${r.name}`);
  ok(MEALS.has(r.meal), `餐次非法：${r.name} → ${r.meal}`);
  ok(Array.isArray(r.steps) && r.steps.length >= 1, `没有步骤：${r.name}`);
  ok(r.steps.every((s) => typeof s === "string" && s.length >= 4), `步骤过短：${r.name}`);
  ok(Array.isArray(r.materials), `材料不是数组：${r.name}`);
}
const byMeal = recipes.reduce((a, r) => ((a[r.meal] = (a[r.meal] ?? 0) + 1), a), {});
const withMat = recipes.filter((r) => r.materials.length > 0).length;
const matRate = withMat / recipes.length;
console.log(
  "食谱：",
  recipes.length,
  "道，餐次",
  JSON.stringify(byMeal),
  `| 有材料 ${withMat} 道（${(matRate * 100).toFixed(0)}%）`
);
// 购物清单、食材反查、本周食材构成都靠 materials，覆盖率掉下来这三个功能就废一半
ok(matRate >= 0.8, `材料覆盖率偏低：${(matRate * 100).toFixed(0)}%，应 ≥ 80%`);
for (const r of recipes) {
  ok(r.materials.length <= 12, `材料过多（可能抽错）：${r.name} ${r.materials.length} 种`);
  ok(
    r.materials.every((m) => typeof m === "string" && m.length >= 1 && m.length <= 6),
    `材料名异常：${r.name} → ${r.materials.join("/")}`
  );
  ok(
    !r.materials.some((m) => /^(盐|油|酱油|生抽|料酒|糖|醋|味精|鸡精|淀粉|葱|姜|蒜|水)$/.test(m)),
    `混入调味料：${r.name} → ${r.materials.join("/")}`
  );
}
ok((byMeal.breakfast ?? 0) >= 4, `早餐太少，无法轮换：${byMeal.breakfast}`);
ok((byMeal.lunch ?? 0) >= 10 && (byMeal.dinner ?? 0) >= 10, "午/晚餐池太小");

// ---------- 时令 ----------
const seasons = read("seasons.json");
ok(seasons.length === 4, `季节数应为 4，实际 ${seasons.length}`);
for (const s of seasons) {
  ok(["春", "夏", "秋", "冬"].includes(s.season), `季节名非法：${s.season}`);
  ok(s.vegetables.length >= 8, `${s.season}季蔬菜太少：${s.vegetables.length}`);
  ok(s.fruits.length >= 4, `${s.season}季水果太少：${s.fruits.length}`);
  ok(![...s.vegetables, ...s.fruits].some((x) => /\d|月/.test(x)), `${s.season}季混入了月份/数字`);
}
console.log("时令：", seasons.map((s) => `${s.season}蔬${s.vegetables.length}/果${s.fruits.length}`).join(" "));

// ---------- 语法（回归） ----------
const grammar = read("grammar.json");
ok(grammar.length >= 40, `语法篇数偏少：${grammar.length}`);
ok(grammar.every((g) => g.title && g.content), "语法条目缺字段");
console.log("语法：", grammar.length, "篇");

// ---------- index 与实际文件一致 ----------
for (const p of index.packs) {
  ok(fs.existsSync(path.join(DIR, p.file)), `索引里的文件不存在：${p.file}`);
  ok(p.bytes > 0 && p.count > 0, `索引字段异常：${p.id}`);
}

console.log("PACKS SMOKE PASS");
