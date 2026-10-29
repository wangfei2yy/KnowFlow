/**
 * 时令「按月」抽取：从《超全一年四季时令蔬菜水果表》PDF 的「按月份排」一节，
 * 抽出每种食材出现的月份，只保留能在食材图鉴里对上的那些。
 *
 * 为什么只抽「能对上的」：PDF 是南方/台湾叫法（释迦、莲雾、鹤首瓜、蒲瓜、牛奶蕉…），
 * 图鉴里没有的写了也没地方展示；硬补同义词等于我替数据做主，对不上就不写。
 *
 * 产物：data/food/season-months.psv（食材名|月份,月份…），由 build-food-packs 合并进包。
 * 用法：npm run build:food:seasons
 */
import fs from "node:fs";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const SRC = path.join(process.cwd(), "..", "data", "食谱", "超全一年四季时令蔬菜水果表，(1).pdf");
const INGREDIENTS = path.join(process.cwd(), "data", "food", "ingredients.psv");
const OUT_FILE = path.join(process.cwd(), "data", "food", "season-months.psv");

/** PDF 里的写法 → 图鉴里的规范名（只列真正需要的） */
const ALIAS = {
  樱桃番茄: "番茄",
  西红柿: "番茄",
  台湾莲雾: "莲雾",
  莲雾: "莲雾",
  台湾青枣: "青枣",
  青枣: "青枣",
  白萝卜: "白萝卜",
  萝卜: "白萝卜",
  青菜: "小白菜",
  鸡毛菜: "小白菜",
  菜尖: "小白菜",
  花菜: "花椰菜",
  花揶菜: "花椰菜",
  卷心菜: "卷心菜",
  土豆: "土豆",
  马铃薯: "土豆",
  芋艿: "芋头",
  芋头: "芋头",
  慈菇: "慈菇",
  茨菇: "慈菇",
  茭白: "茭白",
  莴笋: "莴笋",
  空心菜: "空心菜",
  竹笋: "竹笋",
  冬笋: "冬笋",
  春笋: "春笋",
  豇豆: "豇豆",
  毛豆: "毛豆",
  扁豆: "扁豆",
  "刀豆（菜豆）": "四季豆",
  菜豆: "四季豆",
  "四季豆（芸豆）": "四季豆",
  南瓜: "南瓜",
  冬瓜: "冬瓜",
  丝瓜: "丝瓜",
  苦瓜: "苦瓜",
  黄瓜: "黄瓜",
  茄子: "茄子",
  辣椒: "辣椒",
  番茄: "番茄",
  芹菜: "芹菜",
  菠菜: "菠菜",
  生菜: "生菜",
  韭菜: "韭菜",
  荠菜: "荠菜",
  香菜: "香菜",
  香椿: "香椿",
  木耳菜: "木耳菜",
  苋菜: "苋菜",
  秋葵: "秋葵",
  莲藕: "莲藕",
  菱角: "菱角",
  山药: "山药",
  白菜: "白菜",
  芥菜: "芥菜",
  洋葱: "洋葱",
  胡萝卜: "胡萝卜",
  甜豆: "甜豆",
  豌豆: "豌豆",
  芦笋: "芦笋",
  草莓: "草莓",
  枇杷: "枇杷",
  桑葚: "桑葚",
  樱桃: "樱桃",
  桃: "桃子",
  桃子: "桃子",
  李: "李子",
  李子: "李子",
  西瓜: "西瓜",
  菠萝: "菠萝",
  芒果: "芒果",
  柠檬: "柠檬",
  百香果: "百香果",
  火龙果: "火龙果",
  杏: "杏",
  荔枝: "荔枝",
  猕猴桃: "猕猴桃",
  香蕉: "香蕉",
  椰子: "椰子",
  柚子: "柚子",
  梨: "梨",
  柿子: "柿子",
  木瓜: "木瓜",
  苹果: "苹果",
  甘蔗: "甘蔗",
  葡萄: "葡萄",
  杨桃: "杨桃",
  番石榴: "番石榴",
  橘子: "橘子",
  橙: "橙子",
  柑橘橙: "橙子",
  柑桔: "橘子",
  红枣: "红枣",
  山楂: "山楂",
  核桃: "核桃",
  栗子: "栗子",
  无花果: "无花果",
  石榴: "石榴",
  哈密瓜: "哈密瓜",
  甜瓜: "甜瓜",
  香瓜: "甜瓜"
};

/** PDF 文本 → 行数组（按 y 坐标聚合） */
function toLines(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.transform[5]);
    const line = rows.find((r) => Math.abs(r.y - y) <= 2);
    if (line) line.text += it.str;
    else rows.push({ y, text: it.str });
  }
  return rows.sort((a, b) => b.y - a.y).map((r) => r.text);
}

async function readPdf(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    pages.push(toLines((await page.getTextContent()).items));
  }
  return pages;
}

/** 图鉴里的规范名（含别名），用来判断「这条能不能落到图鉴上」 */
function lexicon() {
  const names = new Set();
  for (const line of fs.readFileSync(INGREDIENTS, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells[0]) names.add(cells[0]);
    for (const a of (cells[6] ?? "").split(/[、,，;；\s]+/).filter(Boolean)) names.add(a);
  }
  return names;
}

function main() {
  const known = lexicon();
  const raw = fs.readFileSync(SRC, "utf8"); // 只为确认文件存在，实际用 pdfjs 读
  void raw;

  return readPdf(SRC).then((pages) => {
    // 只保留「按月份排」之后的内容，避免把「按季节」那段也扫进来
    const all = pages.map((p) => p.join("\n")).join("\n");
    const monthPart = all.slice(Math.max(0, all.indexOf("按月份排")));

    const byMonth = new Map(); // 月份 → Set(名字)
    // 形如「5 月（春季）蔬菜：…水果：…」；月份之间没有换行，只能顺序扫
    const re = /(\d{1,2})\s*月[（(]?[^）)]*[）)]?\s*蔬菜[：:]([\s\S]*?)(?=\d{1,2}\s*月|$)/g;
    let m;
    while ((m = re.exec(monthPart))) {
      const month = Number(m[1]);
      if (!(month >= 1 && month <= 12)) continue;
      const block = m[2];
      // 蔬菜段 + 水果段都扫；不区分类别，反正只输出「几月有」
      const tokens = block
        .replace(/[，,。、；;（）()【】]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 1 && t.length <= 6);
      const set = byMonth.get(month) ?? new Set();
      for (const t of tokens) {
        const name = ALIAS[t] ?? t;
        if (known.has(name)) set.add(name);
        else if (known.has(t)) set.add(t);
      }
      byMonth.set(month, set);
    }

    // 名字 → 月份[]
    const months = new Map();
    for (const [month, set] of [...byMonth.entries()].sort((a, b) => a[0] - b[0])) {
      for (const name of set) {
        const list = months.get(name) ?? [];
        if (!list.includes(month)) list.push(month);
        months.set(name, list);
      }
    }

    const rows = [...months.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], "zh"))
      .map(([name, list]) => `${name}|${list.join(",")}`);
    const header = [
      "# 时令月份源表（由 scripts/extract-seasons.mjs 从时令表 PDF 抽取，可手工修正）",
      "# 格式：食材名|月份,月份…；# 开头为注释；只收录能对上食材图鉴的名字",
      ""
    ].join("\n");
    fs.writeFileSync(OUT_FILE, `${header}${rows.join("\n")}\n`, "utf8");

    console.log(`描到月份：${[...byMonth.keys()].sort((a, b) => a - b).join(", ")}`);
    console.log(`能对上图鉴的食材：${rows.length} 种`);
    console.log("样例：", rows.slice(0, 6).join(" / "));
    console.log(`产物：${path.relative(process.cwd(), OUT_FILE)}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
