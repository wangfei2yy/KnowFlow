/**
 * 饮食纯逻辑单测：冰箱反查、清单分组/导出、勾选按周隔离。
 * 跑法：npm run test:kitchen
 */
import {
  commonMaterials,
  groupShopping,
  loadChecked,
  saveChecked,
  searchByPantry,
  shoppingText,
  weekKeyOf
} from "@/services/kitchenService";
import type { IngredientEntry, RecipeEntry } from "@/services/knowledgePack";

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error("断言失败：" + m);
};

const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0
} as unknown as Storage;

const ing = (name: string, category: IngredientEntry["category"], alias: string[] = []): IngredientEntry =>
  ({ name, alias, category, emoji: "", seasons: [], nutrition: {} } as unknown as IngredientEntry);

const ingredients: IngredientEntry[] = [
  ing("番茄", "vegetable", ["西红柿"]),
  ing("鸡蛋", "egg", ["蛋"]),
  ing("青椒", "vegetable"),
  ing("猪肉", "meat"),
  ing("面条", "grain")
];

const r = (id: string, name: string, materials: string[]): RecipeEntry =>
  ({ id, name, meal: "lunch", materials, steps: ["做法"], tags: [] } as unknown as RecipeEntry);

const recipes: RecipeEntry[] = [
  r("r1", "番茄炒蛋", ["番茄", "鸡蛋"]),
  r("r2", "青椒炒蛋", ["青椒", "鸡蛋"]),
  r("r3", "番茄鸡蛋面", ["番茄", "鸡蛋", "面条"]),
  r("r4", "红烧肉", ["猪肉", "青椒", "番茄"]),
  r("r5", "无材料菜", [])
];

// ---------- 1) 反查：全齐 ----------
const a = searchByPantry(recipes, ["番茄", "鸡蛋"], 2, ingredients);
ok(a.full.length === 1 && a.full[0].name === "番茄炒蛋", `应只剩「番茄炒蛋」，实际 ${a.full.map((x) => x.name)}`);
// 差一两样：青椒炒蛋（缺青椒，覆盖 1/2）、番茄鸡蛋面（缺面条，覆盖 2/3）；
// 红烧肉缺两样且只覆盖 1/3，达不到「已覆盖一半」，默认不该出现
ok(a.near.length === 2, `差一两样应 2 道，实际 ${a.near.map((n) => n.recipe.name)}`);
ok(!a.near.some((n) => n.recipe.name === "红烧肉"), "覆盖率不足一半的菜不应出现在「差一两样」里");
const nearQing = a.near.find((n) => n.recipe.name === "青椒炒蛋");
ok(!!nearQing && nearQing.missing.join() === "青椒", `青椒炒蛋应缺「青椒」，实际 ${nearQing?.missing}`);
ok(a.near[0].missing.length === 1, "差得少的应排前面");
console.log("1) 反查：能做", a.full.length, "道 · 差一两样", a.near.length, "道");

// ---------- 2) 别名归一：拿西红柿也能做番茄菜 ----------
const b = searchByPantry(recipes, ["西红柿", "蛋"], 2, ingredients);
ok(b.full.some((x) => x.name === "番茄炒蛋"), "「西红柿 + 蛋」应命中番茄炒蛋（图鉴 alias）");
console.log("2) 别名归一 OK");

// ---------- 3) 差 3 样以上不列 ----------
const c2 = searchByPantry(recipes, ["番茄"], 1, ingredients);
ok(c2.near.every((n) => n.missing.length === 1), "maxMissing=1 时只留差一样");
ok(!c2.near.some((n) => n.recipe.name === "红烧肉"), "红烧肉差两样，maxMissing=1 时应被排除");
// 放宽覆盖率门槛后，红烧肉（差两样、覆盖 1/3）才会出现
const wide = searchByPantry(recipes, ["番茄"], 2, ingredients, 0);
ok(wide.near.some((n) => n.recipe.name === "红烧肉"), "覆盖率门槛为 0 时红烧肉应出现");
console.log("3) 缺口阈值 OK");

// ---------- 4) 没有材料的菜不参与 ----------
ok(
  !a.full.some((x) => x.name === "无材料菜") && !a.near.some((n) => n.recipe.name === "无材料菜"),
  "无材料的菜不应被当成「全都够」"
);
ok(searchByPantry(recipes, [], 2, ingredients).full.length === 0, "没勾任何食材应返回空");
console.log("4) 边界 OK");

// ---------- 5) 常见材料 ----------
const cm = commonMaterials(recipes, 3);
ok(cm[0].name === "番茄" || cm[0].name === "鸡蛋", `最高频应是番茄/鸡蛋，实际 ${cm[0].name}`);
ok(cm.length === 3, "limit 生效");
console.log("5) 常见材料:", cm.map((x) => `${x.name}×${x.count}`).join(" "));

// ---------- 6) 清单分组 ----------
const items: [string, number][] = [["番茄", 3], ["猪肉", 1], ["面条", 2], ["盐焗粉", 1]];
const groups = groupShopping(items, ingredients);
const labels = groups.map((g) => g.label);
ok(labels[0] === "蔬菜", `蔬菜应排最前，实际 ${labels.join("/")}`);
ok(labels.includes("其他"), "图鉴外的材料应归入「其他」");
ok(groups.every((g, i) => i === 0 || labels.length > 0), "分组结构正常");
const veg = groups.find((g) => g.label === "蔬菜")!;
ok(veg.items.length === 1 && veg.items[0].name === "番茄" && veg.items[0].count === 3, "蔬菜组内容不对");
console.log("6) 分组:", labels.join(" → "));

// ---------- 7) 导出文本 ----------
const groups2 = groupShopping(items, ingredients, new Set(["番茄"]));
const text = shoppingText(groups2);
ok(text.includes("【蔬菜】") && text.includes("☑ 番茄 ×3") && text.includes("□ 面条 ×2"), `导出文本不对：\n${text}`);
console.log("7) 导出文本 OK");

// ---------- 8) 勾选按周隔离 ----------
store.clear();
const mon = new Date(2026, 9, 26); // 2026-10-26 周一
const nextMon = new Date(2026, 10, 2);
ok(weekKeyOf(mon) === "2026-10-26", `周一应回到自身，实际 ${weekKeyOf(mon)}`);
ok(weekKeyOf(new Date(2026, 9, 29)) === "2026-10-26", "周四应归到周一那周");

saveChecked(new Set(["番茄"]), weekKeyOf(mon));
ok(loadChecked(weekKeyOf(mon)).has("番茄"), "本周应记住勾选");
ok(!loadChecked(weekKeyOf(nextMon)).has("番茄"), "下一周不应继承上週的勾");
saveChecked(new Set(["鸡蛋"]), weekKeyOf(nextMon));
// 只保留最近两周
ok(loadChecked(weekKeyOf(mon)).size + loadChecked(weekKeyOf(nextMon)).size === 2, "两周都应在");
saveChecked(new Set(["面条"]), "2026-11-09");
ok(!loadChecked("2026-10-26").size, "超过两周的最旧一份应被清掉");
console.log("8) 勾选按周隔离 OK");

console.log("\n✅ 饮食逻辑 8 组断言全部通过");
