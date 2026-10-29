/**
 * 菜谱材料抽取：从「做法文字」里认出材料，补上 recipes.json 里 84% 的空 materials。
 *
 * 为什么要有这一步：现有 121 道菜里 102 道没有材料清单，而购物清单、食材反查、
 * 本周食材构成全靠 materials —— 不补，这三个功能只有 19 道菜在撑。
 *
 * 做法是「词表最长匹配」，不是让模型自由发挥：
 * - 词表 = 食材图鉴 154 条（name + alias）+ data/food/extra-materials.txt（会买但不进图鉴的）
 * - 黑名单过滤调味料（盐/油/酱油/料酒/糖/醋/葱姜蒜…），与图鉴口径一致
 * - 只在「菜名 + 做法文字」里找，不猜、不补同义词
 *
 * 产物：data/food/recipe-materials.psv（菜名|材料1,材料2,…），由 build-life-packs 合并。
 * 用法：npm run build:food:materials
 */
import fs from "node:fs";
import path from "node:path";

const OUT_FILE = path.join(process.cwd(), "data", "food", "recipe-materials.psv");
const INGREDIENTS = path.join(process.cwd(), "data", "food", "ingredients.psv");
const EXTRA = path.join(process.cwd(), "data", "food", "extra-materials.txt");
const RECIPES = path.join(process.cwd(), "public", "packs", "recipes.json");

/** 调味料与烹饪用语：永远不当材料（和食材图鉴的收录口径一致） */
const BLACKLIST = new Set([
  "盐", "食盐", "精盐", "油", "素油", "香油", "麻油", "芝麻油", "橄榄油", "花生油", "色拉油", "菜油", "猪油",
  "酱油", "生抽", "老抽", "鲜酱油", "宴会酱油", "豉油", "豆豉油", "鱼露", "蚝油",
  "料酒", "黄酒", "米酒", "白酒", "酒", "啤酒", "葡萄酒",
  "糖", "白糖", "冰糖", "红糖", "砂糖", "醋", "香醋", "陈醋", "白醋", "米醋",
  "味精", "鸡精", "鸡粉", "胡椒粉", "胡椒", "五香粉", "十三香", "椒盐", "咖喱粉", "淀粉", "生粉", "芡粉",
  "葱", "大葱", "小葱", "葱花", "葱段", "葱末", "葱结", "姜", "生姜", "姜片", "姜丝", "姜末", "姜块", "蒜", "大蒜", "蒜泥", "蒜片", "蒜末", "蒜台", "蒜苗",
  "花椒", "茴香", "八角", "桂皮", "香叶", "砂仁", "山奈", "香果", "丁香", "草果", "辣椒", "干辣椒", "干红辣椒", "辣椒丝",
  "水", "清水", "开水", "热水", "温水", "凉水", "冷水", "冰水", "沸水", "高汤", "鸡汤", "骨汤", "鲜汤", "佐料", "调料",
  "芝麻", "白芝麻", "黑芝麻", "香菜", "香葱", "小葱末", "香菜末", "洋香菜", "细香葱",
  "豆豉", "适量", "少许", "若干", "一勺", "调羹", "色拉",
  // 「面」在做法里几乎都是「表面 / 两面」，单字太容易误命中，需要时写「面条 / 面包」
  "面"
]);

/** 食材图鉴的 name + alias，以及补充词表 */
function buildLexicon() {
  const lex = new Map(); // 词 → 规范名（别名归一到 name）

  for (const line of fs.readFileSync(INGREDIENTS, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const name = cells[0];
    if (!name) continue;
    lex.set(name, name);
    const alias = (cells[6] ?? "").split(/[、,，;；\s]+/).filter(Boolean);
    for (const a of alias) if (!lex.has(a) && !BLACKLIST.has(a)) lex.set(a, name);
  }

  if (fs.existsSync(EXTRA)) {
    for (const raw of fs.readFileSync(EXTRA, "utf8").split(/\r?\n/)) {
      const w = raw.trim();
      if (!w || w.startsWith("#") || BLACKLIST.has(w)) continue;
      if (!lex.has(w)) lex.set(w, w);
    }
  }
  for (const w of BLACKLIST) lex.delete(w);
  return lex;
}

/**
 * 在文本里做最长匹配。为什么必须最长：图鉴里同时有「白萝卜」和「萝卜」，
 * 先匹配到「萝卜」会把「白萝卜」拆错。
 */
function matchMaterials(text, lexicon, minLen = 2) {
  const words = [...lexicon.keys()].filter((w) => w.length >= minLen).sort((a, b) => b.length - a.length);
  const hits = new Set();
  let i = 0;
  while (i < text.length) {
    let matched = "";
    for (const w of words) {
      if (w.length > text.length - i) continue;
      if (text.startsWith(w, i)) {
        matched = w;
        break;
      }
    }
    if (matched) {
      hits.add(lexicon.get(matched));
      i += matched.length;
    } else {
      i += 1;
    }
  }
  return hits;
}

/** 裁掉「下一条菜谱」串进来的尾巴：出现「数字、菜名：」即视为边界 */
function trimBleed(text) {
  const m = text.slice(1).match(/[0-9]{1,3}[、.．][\u4e00-\u9fa5]{2,8}[：:]/);
  return m ? text.slice(0, text.indexOf(m[0])) : text;
}

function main() {
  const lexicon = buildLexicon();
  const recipes = JSON.parse(fs.readFileSync(RECIPES, "utf8"));

  const rows = [];
  const lowConfidence = [];
  let filled = 0;
  let skipped = 0;

  for (const r of recipes) {

    // 做法里可能串进下一条（源文本里「23红烧生麸球：」挤在同一句），先裁掉
    const stepsText = trimBleed((r.steps ?? []).join(""));
    // 单字词（藕/虾/蟹）只在菜名里认，做法里认容易把「表面」当「面」
    const hits = new Set([
      ...matchMaterials(r.name.replace(/\s+/g, ""), lexicon, 1),
      ...matchMaterials(stepsText, lexicon, 2)
    ]);

    if (hits.size < 1) {
      skipped += 1;
      lowConfidence.push(`${r.name}（一种都没认出）`);
      continue;
    }
    const list = [...hits].slice(0, 12);

    rows.push(`${r.name}|${list.join(",")}`);
    filled += 1;

    if (list.length >= 10) lowConfidence.push(`${r.name}（${list.length} 种，可能混入非材料词）`);
  }

  const header = [
    "# 菜谱材料源表（由 scripts/extract-materials.mjs 从做法文字抽取，可手工修正）",
    "# 格式：菜名|材料1,材料2,…；# 开头为注释；已解析出材料的菜不会被这里覆盖",
    ""
  ].join("\n");
  fs.writeFileSync(OUT_FILE, `${header}${rows.join("\n")}\n`, "utf8");

  console.log(`词表规模：${lexicon.size} 个词（图鉴 + 补充词表，已剔除调味料）`);
  console.log(`抽到材料：${filled} 道 / ${recipes.length} 道`);
  console.log(`认不出（<2 种，跳过）：${skipped} 道`);
  if (lowConfidence.length) {
    console.log("\n需要人工看一眼：");
    for (const s of lowConfidence.slice(0, 20)) console.log("  -", s);
  }
  console.log(`\n产物：${path.relative(process.cwd(), OUT_FILE)}`);
}

main();
