/**
 * 食材图鉴编译：data/food/ingredients.psv → public/packs/ingredients.json
 *
 * 源表是手写的竖线分隔文本（释义里有中文逗号，用逗号会串列），
 * 这个脚本负责：解析 → 校验 → 从 seasons.json 反查季节 → 写 pack + 更新索引。
 *
 * 跑法：npm run build:food（已并入 build:packs）
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(process.cwd(), "data/food/ingredients.psv");
const PACK_DIR = path.resolve(process.cwd(), "public/packs");
const OUT = path.join(PACK_DIR, "ingredients.json");
const INDEX = path.join(PACK_DIR, "index.json");

const CATEGORIES = new Set([
  "vegetable",
  "fruit",
  "mushroom",
  "meat",
  "egg",
  "seafood",
  "bean",
  "grain",
  "nut",
  "dairy"
]);

/** 营养数值列：空字符串表示没有可靠数据，输出时省略而不是填 0 */
const NUMERIC = [
  "kcal",
  "protein",
  "carb",
  "fat",
  "fiber",
  "vc",
  "potassium",
  "calcium",
  "iron",
  "carotene"
];

/** 去掉空白与「等」这类占位，便于和时令表对齐 */
function norm(name) {
  return String(name)
    .replace(/\s+/g, "")
    .replace(/等$/, "")
    .replace(/[（(].*?[)）]/g, "")
    .trim();
}

function parse() {
  if (!fs.existsSync(SRC)) {
    throw new Error(`找不到源表：${SRC}`);
  }
  const lines = fs.readFileSync(SRC, "utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
  const rows = [];
  const problems = [];

  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const cells = line.split("|").map((c) => c.trim());
    // 表头行（name|alias|…）不是数据，跳过
    if (cells[0] === "name") return;
    if (cells.length !== 17) {
      problems.push(`第 ${i + 1} 行列数为 ${cells.length}（应为 17）：${line.slice(0, 30)}…`);
      return;
    }
    const [
      name,
      alias,
      emoji,
      category,
      kcal,
      protein,
      carb,
      fat,
      fiber,
      vc,
      potassium,
      calcium,
      iron,
      carotene,
      benefit,
      storage,
      caution
    ] = cells;

    if (!name) {
      problems.push(`第 ${i + 1} 行缺少名称`);
      return;
    }
    if (!CATEGORIES.has(category)) {
      problems.push(`${name}：分类 "${category}" 不在约定范围内`);
      return;
    }
    if (!benefit) {
      problems.push(`${name}：缺少功效描述`);
      return;
    }
    if (!/^\d+(\.\d+)?$/.test(kcal)) {
      problems.push(`${name}：热量 "${kcal}" 不是数字`);
      return;
    }

    const entry = {
      name,
      emoji: emoji && emoji !== "—" ? emoji : "🍽️",
      category,
      seasons: [],
      nutrition: { kcal: Number(kcal) }
    };
    if (alias && alias !== "—") entry.alias = alias.split("/").map((a) => a.trim()).filter(Boolean);

    const values = { protein, carb, fat, fiber, vc, potassium, calcium, iron, carotene };
    for (const key of NUMERIC.slice(1)) {
      const v = values[key];
      if (!v) continue;
      if (!/^\d+(\.\d+)?$/.test(v)) {
        problems.push(`${name}：${key} "${v}" 不是数字，已忽略`);
        continue;
      }
      entry.nutrition[key] = Number(v);
    }

    entry.benefit = benefit;
    entry.storage = storage || "";
    if (caution && caution !== "—") entry.caution = caution;

    rows.push(entry);
  });

  return { rows, problems };
}

/** 从时令表反查季节：名称或别名对上都算 */
function attachSeasons(rows) {
  const file = path.join(PACK_DIR, "seasons.json");
  if (!fs.existsSync(file)) {
    console.warn("⚠️  没有 seasons.json，跳过季节标注");
    return 0;
  }
  const seasons = JSON.parse(fs.readFileSync(file, "utf8"));
  const table = new Map(); // 归一化名称 → Set<季节>
  for (const s of seasons) {
    for (const item of [...(s.vegetables ?? []), ...(s.fruits ?? [])]) {
      const key = norm(item);
      if (!key) continue;
      if (!table.has(key)) table.set(key, new Set());
      table.get(key).add(s.season);
    }
  }

  let matched = 0;
  const order = ["春", "夏", "秋", "冬"];
  for (const row of rows) {
    const keys = [row.name, ...(row.alias ?? [])].map(norm);
    const hit = new Set();
    for (const key of keys) {
      const s = table.get(key);
      if (s) s.forEach((x) => hit.add(x));
    }
    if (hit.size) {
      row.seasons = order.filter((x) => hit.has(x));
      matched += 1;
    }
  }
  return matched;
}

/**
 * 从 data/food/season-months.psv 读「哪几个月当季」，只给对得上的食材写 months。
 *
 * 时令表 PDF 是南方叫法（释迦、莲雾、鹤首瓜…），图鉴里没有的名字就不写 ——
 * 页面上会显示「未收录月份」，比编一个月份诚实。
 */
function attachMonths(rows) {
  const file = path.join(process.cwd(), "data", "food", "season-months.psv");
  if (!fs.existsSync(file)) {
    console.warn("⚠️  没有 season-months.psv，跳过月份标注");
    return 0;
  }
  const table = new Map();
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [name, list] = line.split("|");
    if (!name || !list) continue;
    const months = list
      .split(/[,，]/)
      .map((x) => Number(x.trim()))
      .filter((n) => n >= 1 && n <= 12);
    if (months.length) table.set(norm(name), months.sort((a, b) => a - b));
  }
  let matched = 0;
  for (const row of rows) {
    for (const key of [row.name, ...(row.alias ?? [])].map(norm)) {
      const months = table.get(key);
      if (months) {
        row.months = months;
        matched += 1;
        break;
      }
    }
  }
  return matched;
}

function writeIndex(count, bytes) {
  const index = JSON.parse(fs.readFileSync(INDEX, "utf8"));
  index.packs = (index.packs ?? []).filter((p) => p.id !== "ingredients");
  index.packs.push({
    id: "ingredients",
    kind: "docs",
    group: "life",
    title: "食材图鉴",
    count,
    bytes,
    file: "ingredients.json"
  });
  index.generatedAt = new Date().toISOString();
  fs.writeFileSync(INDEX, JSON.stringify(index, null, 2) + "\n", "utf8");
}

const { rows, problems } = parse();
if (!rows.length) {
  console.error("❌ 没有解析出任何食材，检查源表分隔符是否为 |");
  process.exit(1);
}

const matched = attachSeasons(rows);
const monthMatched = attachMonths(rows);

// 按分类 + 名称排序，页面直接按数组顺序渲染即可
const CAT_ORDER = ["vegetable", "mushroom", "fruit", "bean", "grain", "meat", "egg", "seafood", "dairy", "nut"];
rows.sort((a, b) => {
  const ca = CAT_ORDER.indexOf(a.category);
  const cb = CAT_ORDER.indexOf(b.category);
  if (ca !== cb) return ca - cb;
  return a.name.localeCompare(b.name, "zh");
});

const json = JSON.stringify(rows, null, 0);
fs.writeFileSync(OUT, json + "\n", "utf8");
writeIndex(rows.length, Buffer.byteLength(json + "\n"));

const byCat = rows.reduce((acc, r) => ((acc[r.category] = (acc[r.category] ?? 0) + 1), acc), {});
console.log(`食材图鉴：${rows.length} 条，${matched} 条带季节，${monthMatched} 条带月份`);
console.log("分类分布：", byCat);
console.log(`产物：${path.relative(process.cwd(), OUT)}（${(json.length / 1024).toFixed(1)} KB）`);

if (problems.length) {
  console.warn(`⚠️  ${problems.length} 处问题：`);
  problems.slice(0, 20).forEach((p) => console.warn("   -", p));
} else {
  console.log("校验：无问题");
}
