/**
 * 把 data/成语 与 data/食谱 编译成前端知识包。
 *
 * 输入：
 *   data/成语/四字成语大全带解释.(汇总3篇).pdf
 *   data/食谱/家庭健康饮食菜谱精选(1).pdf
 *   data/食谱/家常菜谱-简单免费下载可打印.pdf
 *   data/食谱/超全一年四季时令蔬菜水果表，(1).pdf
 *
 * 输出（合并进 public/packs/index.json，保留英语部分）：
 *   packs/idiom.json     成语
 *   packs/recipes.json   食谱
 *   packs/seasons.json   四季时令蔬果
 *
 * 用法：cd frontend && node scripts/build-life-packs.mjs
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "..");
const SRC = path.join(ROOT, "data");
const OUT = path.join(process.cwd(), "public", "packs");

/** 按纵坐标把文本片段还原成行（4pt 容差，适配不同字号） */
function toLines(items) {
  const rows = new Map();
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round((it.transform?.[5] ?? 0) / 4) * 4;
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y).push({ x: it.transform?.[4] ?? 0, s: it.str });
  }
  return [...rows.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, parts]) =>
      parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.s)
        .join("")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
}

async function readPdf(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    pages.push(toLines(content.items));
  }
  return pages;
}

/* ------------------------------ 成语 ------------------------------ */

/** 页眉页脚与分篇标题，直接丢弃 */
const IDIOM_NOISE = /^(四字成语(及解释)?大全?|四字成语及解释\s*篇\s*\d+|四字词语是指|的四字词语加解释|下面是小编)/;

/**
 * 一行里可能塞了多条词条（PDF 排版导致「眉花眼笑（解释）…白草黄云（解释）…」连成一行），
 * 在「词条（解释）」「词条解释：」处切开，再走正常解析。
 */
function splitIdiomLine(line) {
  const marks = [];
  const re = /([\u4e00-\u9fa5]{2,8})(?:[（(](?:解释|释义)[）)]|解释[：:])/g;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > 0) marks.push(m.index);
  }
  if (marks.length === 0) return [line];
  const parts = [];
  let start = 0;
  for (const idx of marks) {
    parts.push(line.slice(start, idx));
    start = idx;
  }
  parts.push(line.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** 词典字段名，会被误判成词条 */
const LABEL_WORDS = new Set(["解释", "释义", "示例", "出处", "近义", "反义", "拼音", "用法", "辨析"]);

function parseIdioms(pages) {
  const items = [];
  let cur = null;

  const flush = () => {
    if (cur && cur.m.trim()) {
      cur.m = cur.m.replace(/\s+/g, "");
      if (cur.from) cur.from = cur.from.replace(/\s+/g, "").slice(0, 120);
      items.push(cur);
    }
    cur = null;
  };

  for (const lines of pages) {
    for (const raw of lines) {
      if (!raw.trim() || IDIOM_NOISE.test(raw)) continue;

      // 一行可能塞了多条词条，切开后逐条解析
      for (const line of splitIdiomLine(raw.replace(/\s+/g, ""))) {
        // 条目起点有四种写法（PDF 汇总了多个来源）：
        //   韬光养晦：比喻隐藏才能
        //   焦思苦虑解释：着急忧虑
        //   后车之戒(huchēzhījiè)对后面跟上来的车子的警戒
        //   白草黄云（解释）形容边塞秋季的荒凉景象
        const colon = line.match(/^([\u4e00-\u9fa5]{2,8})[：:](.+)$/);
        const inline = line.match(/^([\u4e00-\u9fa5]{2,8}?)(?:解释|释义)[：:](.+)$/);
        const pinyin = line.match(/^([\u4e00-\u9fa5]{2,8})[（(][a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü\s]+[）)](.+)$/);
        const label = line.match(/^([\u4e00-\u9fa5]{2,8})[（(](?:解释|释义|示例|出处)[）)](.+)$/);

        const hit = colon && colon[2].length >= 4 ? colon : (inline ?? pinyin ?? label);
        if (hit && !LABEL_WORDS.has(hit[1])) {
          flush();
          cur = { w: hit[1], m: hit[2].trim() };
          continue;
        }
        if (!cur) continue;

        // 出处单独记录，避免把大段引文塞进释义
        const src = line.match(/^[（(]?出处[）)]?[：:]?(.+)$/);
        if (src && src[1].length >= 2) {
          cur.from = (cur.from ?? "") + src[1];
          continue;
        }
        // 续行：接上一条（PDF 按列宽折行、跨页断句）
        cur.m += line;
      }
    }
  }
  flush();

  // 去重（同名取解释更长的一条）
  const map = new Map();
  for (const it of items) {
    const prev = map.get(it.w);
    if (!prev || it.m.length > prev.m.length) map.set(it.w, it);
  }
  return [...map.values()]
    .filter((it) => it.w.length === 4 && it.m.length >= 6 && it.m.length <= 150)
    .map((it) => ({
      w: it.w,
      m: it.m,
      ...(it.from ? { from: it.from } : {}),
      len: it.w.length
    }));
}

/* ------------------------------ 食谱 ------------------------------ */

const MEAL_MAP = [
  [/早餐|早饭/, "breakfast"],
  [/午餐|中餐|午饭/, "lunch"],
  [/晚餐|晚饭/, "dinner"],
  [/加餐|宵夜|夜宵/, "snack"]
];

function normalizeMeal(text) {
  for (const [re, key] of MEAL_MAP) if (re.test(text)) return key;
  return "";
}

/** 从「家庭健康饮食菜谱精选」解析：N.菜名 + -材料： + -做法： */
function parseHealthyRecipes(pages) {
  const list = [];
  let meal = "";
  let cur = null;
  let field = ""; // materials | steps

  const flush = () => {
    if (cur && cur.name) {
      cur.materials = cur.materials.filter(Boolean);
      cur.steps = cur.steps.filter(Boolean);
      if (cur.steps.length > 0) list.push(cur);
    }
    cur = null;
    field = "";
  };

  for (const lines of pages) {
    for (const raw of lines) {
      let line = raw.trim();
      if (!line) continue;
      if (/^家庭健康饮食菜谱精选$/.test(line)) continue;

      const mealHit = normalizeMeal(line);
      if (mealHit && line.length <= 8) {
        flush();
        meal = mealHit;
        continue;
      }

      // 新菜：1.营养早餐三明治
      const dish = line.match(/^\d+\s*[.、]\s*(.+)$/);
      if (dish) {
        flush();
        cur = { name: dish[1].trim(), meal: meal || "lunch", materials: [], steps: [], tags: [] };
        continue;
      }

      if (!cur) continue;

      if (/^-?\s*材料[：:]/.test(line)) {
        field = "materials";
        cur.materials.push(...splitMaterials(line.replace(/^-?\s*材料[：:]/, "")));
        continue;
      }
      if (/^-?\s*(做法|步骤)[：:]/.test(line)) {
        field = "steps";
        cur.steps.push(line.replace(/^-?\s*(做法|步骤)[：:]/, "").trim());
        continue;
      }

      // 续行
      if (field === "materials") cur.materials.push(...splitMaterials(line));
      else if (field === "steps" && cur.steps.length > 0) cur.steps[cur.steps.length - 1] += line;
    }
  }
  flush();
  return list;
}

/** 材料串按顿号/逗号拆成数组 */
function splitMaterials(text) {
  return text
    .replace(/^-/, "")
    .split(/[、，,]/)
    .map((s) => s.trim())
    .filter((s) => s && s.length <= 12);
}

/** 从「家常菜谱」解析：一、红烧茄子 + 步骤（无材料时留空） */
const JIACHANG_NOISE = /word格式|可编辑|感谢下载支持|美食中国/;

function parseJiachangRecipes(pages) {
  const list = [];
  let cur = null;

  const flush = () => {
    if (cur && cur.name && cur.steps.length > 0) list.push(cur);
    cur = null;
  };

  for (const lines of pages) {
    for (const raw of lines) {
      const line = raw.replace(JIACHANG_NOISE, "").trim();
      if (!line) continue;

      // 菜名：一、红烧茄子： / 四、醋溜卷心菜
      const dish = line.match(/^[一二三四五六七八九十百]{1,3}\s*[、.]\s*(.{2,20}?)[：:]?$/);
      if (dish && !/^(材料|原料|调料|做法|烹制)/.test(dish[1])) {
        flush();
        cur = { name: dish[1].trim().replace(/[：:]$/, ""), meal: "", materials: [], steps: [], tags: [] };
        continue;
      }

      if (!cur) continue;

      const mat = line.match(/^(原料|材料|调料|配料)[：:](.*)$/);
      if (mat) {
        const rest = mat[2].trim();
        if (rest) cur.materials.push(...splitMaterials(rest));
        continue;
      }
      if (/^(做法|烹制方法|制作方法|制法)[：:]?/.test(line)) continue;
      if (/^[（(].*[)）]$/.test(line) && line.length < 12) continue; // （两人份）

      // 步骤：1把… / 2、… / 3 . …
      const step = line.match(/^\d{1,2}\s*[.、]?\s*(.+)$/);
      if (step && step[1].length >= 4) {
        cur.steps.push(step[1].trim());
        continue;
      }
      // 材料续行（如「卷心菜750克，猪油60克」）
      if (/^\S+[0-9]+\s*(克|g|毫升|ml|汤匙|勺|只|个|根|片)/.test(line) && cur.steps.length === 0) {
        cur.materials.push(...splitMaterials(line));
        continue;
      }
      // 步骤续行
      if (cur.steps.length > 0) cur.steps[cur.steps.length - 1] += line;
    }
  }
  flush();
  return list;
}

/**
 * 从「健康菜谱 100 例.doc」解析（Word 转成 txt 后读取）。
 * 格式：`11、蘑菇鱼片汤：` 换行接做法，做法可能折行。
 */
const DOC_NOISE = /^健\s*康\s*菜\s*谱|^\d{1,3}\s*$/;

function parseDocRecipes(text) {
  const list = [];
  let cur = null;

  const flush = () => {
    if (cur && cur.steps.length > 0) {
      // 做法是逗号连贯的长句，按句号/分号切成步骤，避免一步一屏
      const steps = cur.steps
        .join("")
        .split(/(?<=[。！；])/)
        .map((x) => x.trim())
        .filter((x) => x.length >= 4);
      if (steps.length) list.push({ ...cur, steps });
    }
    cur = null;
  };

  // Word 导出的换行是单独的 \r，用 \r\n?|\n 才能正确切行
  for (const raw of text.split(/\r\n?|\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (DOC_NOISE.test(line)) continue;

    // 11、蘑菇鱼片汤： / 3.鸡汤百叶
    const dish = line.match(/^\d{1,3}\s*[、.．]\s*(.{2,20}?)\s*[：:]?$/);
    if (dish && !/^\d+$/.test(dish[1])) {
      flush();
      cur = { name: dish[1].replace(/[：:]$/, "").trim(), meal: "", materials: [], steps: [], tags: [] };
      continue;
    }
    if (!cur) continue;
    cur.steps.push(line);
  }
  flush();
  return list;
}

/** 从菜名与步骤推断标签 */
function inferTags(r) {
  const text = r.name + r.steps.join("");
  const tags = new Set();
  if (/蒸/.test(r.name)) tags.add("清蒸");
  if (/炒/.test(r.name)) tags.add("快炒");
  if (/汤|粥/.test(r.name)) tags.add("汤粥");
  if (/凉拌|拌/.test(r.name)) tags.add("凉菜");
  if (/低脂|清淡|健康|蔬菜|菠菜|青菜|黄瓜|番茄|西兰花/.test(text)) tags.add("清淡");
  if (/鸡|鱼|虾|蛋|豆腐|牛肉|猪/.test(r.name)) tags.add("蛋白");
  if (r.steps.join("").length <= 120) tags.add("快手");
  return [...tags];
}

/** 按餐次粗分：含粥/面包/蛋/燕麦/牛奶 → 早餐；含汤/鱼/肉 → 午晚餐 */
function inferMeal(r) {
  if (r.meal) return r.meal;
  const n = r.name;
  if (/粥|面包|三明治|燕麦|牛奶|豆浆|蛋饼|煎蛋|馄饨|饺子|馒头|包子/.test(n)) return "breakfast";
  if (/汤|鱼|肉|鸡|虾|排骨|牛/.test(n)) return "dinner";
  return "lunch";
}

/* --------------------------- 时令蔬果 --------------------------- */

function parseSeasons(pages) {
  const seasons = { 春: { vegetables: [], fruits: [] }, 夏: { vegetables: [], fruits: [] }, 秋: { vegetables: [], fruits: [] }, 冬: { vegetables: [], fruits: [] } };
  let cur = null;
  let field = "";
  let extra = 0;

  for (const lines of pages) {
    for (const raw of lines) {
      const line = raw.replace(/\s+/g, "");
      if (!line) continue;

      const season = line.match(/^(春|夏|秋|冬)季/);
      if (season) {
        cur = seasons[season[1]];
        field = "";
        continue;
      }
      if (!cur) continue;

      if (/^蔬菜[：:]/.test(line)) {
        field = "vegetables";
        extra = 2;
        cur.vegetables.push(...splitList(line.replace(/^蔬菜[：:]/, "")));
        continue;
      }
      if (/^水果[：:]/.test(line)) {
        field = "fruits";
        extra = 2;
        cur.fruits.push(...splitList(line.replace(/^水果[：:]/, "")));
        continue;
      }
      // 只续两行：时令表后面紧跟的是「按月时令」正文，继续拼会把 1月/2月 当成水果
      if (field && extra > 0 && !/月|季|养生|功效/.test(line)) {
        cur[field].push(...splitList(line));
        extra -= 1;
        continue;
      }
      field = "";
    }
  }

  return Object.entries(seasons).map(([season, v]) => ({
    season,
    vegetables: [...new Set(v.vegetables)].filter((x) => x.length <= 6 && !/\d|月/.test(x)).slice(0, 40),
    fruits: [...new Set(v.fruits)].filter((x) => x.length <= 6 && !/\d|月/.test(x)).slice(0, 40)
  }));
}

function splitList(text) {
  return text
    .split(/[、，,。]/)
    .map((s) => s.trim().replace(/[（(].*?[)）]/g, ""))
    .filter(Boolean);
}

/* ------------------------------ 主流程 ------------------------------ */

/** 菜名清洗：去括号注释、引号、尾部分号、逗号后的补充说明 */
function normalizeName(name) {
  return name
    .replace(/[（(][^）)]*[）)]/g, "")
    .replace(/[“”"']/g, "")
    .replace(/[，,；;].*$/, "")
    .replace(/或.+$/, "")
    .replace(/[\s　：:。.，,；;]+$/, "")
    .trim();
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  // 成语
  const idiomPages = await readPdf(path.join(SRC, "成语", "四字成语大全带解释.(汇总3篇).pdf"));
  const idioms = parseIdioms(idiomPages);
  console.log(`成语：${idioms.length} 条（4 字 ${idioms.filter((i) => i.len === 4).length}）`);
  console.log("  样例：", JSON.stringify(idioms.slice(0, 3)));
  console.log("  最长解释：", Math.max(...idioms.map((i) => i.m.length)), "字");

  // 食谱：三份合并去重
  const healthy = parseHealthyRecipes(await readPdf(path.join(SRC, "食谱", "家庭健康饮食菜谱精选(1).pdf")));
  const jiachang = parseJiachangRecipes(await readPdf(path.join(SRC, "食谱", "家常菜谱-简单免费下载可打印.pdf")));
  // .doc 老格式 pdfjs 读不了：由 Word 先转成同名 .txt（脚本里存在才读）
  const docTxt = path.join(SRC, "食谱", "健康菜谱.txt");
  const fromDoc = fs.existsSync(docTxt) ? parseDocRecipes(fs.readFileSync(docTxt, "utf8")) : [];
  console.log(`食谱：精选 ${healthy.length} 道 / 家常 ${jiachang.length} 道 / 100例 ${fromDoc.length} 道`);

  const recipeMap = new Map();
  for (const r of [...fromDoc, ...healthy, ...jiachang]) {
    const name = normalizeName(r.name);
    if (!name || recipeMap.has(name)) continue;
    recipeMap.set(name, {
      id: `r${recipeMap.size + 1}`,
      name,
      meal: inferMeal(r),
      materials: [...new Set(r.materials.map((m) => m.trim()).filter(Boolean))].slice(0, 12),
      steps: r.steps
        .flatMap((s) => s.split(/(?<=[。！；])/))
        .map((s) => s.trim())
        .filter((s) => s.length >= 4)
        .slice(0, 12),
      tags: inferTags(r)
    });
  }
  // ---- 材料清单：清洗旧数据 + 用抽取结果兜底 ----
  // 旧材料来自「家常菜谱」PDF 的材料串，被切得很碎（「郫县豆/瓣」「克」「1/鲤鱼一条」），
  // 直接展示会让购物清单变成噪声。所以分三步：剥份量 → 过滤调味料 → 判断可信度。
  const CONDIMENT = new Set([
    "盐", "食盐", "精盐", "油", "香油", "麻油", "酱油", "生抽", "老抽", "料酒", "黄酒", "米酒",
    "糖", "白糖", "冰糖", "醋", "香醋", "白醋", "陈醋", "味精", "鸡精", "淀粉", "生粉",
    "葱", "姜", "蒜", "葱段", "葱花", "葱末", "姜末", "姜片", "蒜末", "蒜片", "青蒜",
    "花椒", "茴香", "八角", "桂皮", "辣椒", "辣椒油", "红油", "水", "清水", "高汤", "清汤",
    "佐料", "调料", "豆豉", "甜面酱", "豆瓣酱", "黄酱",
    "花生油", "猪油", "菜油", "色拉油", "橄榄油", "玉米油", "葵花油", "湿淀粉", "干淀粉",
    "干辣椒节", "胡椒粉", "椒盐", "香料包", "各少许", "克", "毫升", "汤匙", "茶匙", "瓣", "节",
    "小葱", "大葱", "香葱", "郫县豆瓣", "郫县豆"
  ]);
  const QTY_UNIT = "克|千克|公斤|斤|两|毫升|ml|汤匙|茶匙|大勺|小勺|勺|只|个|根|片|瓣|杯|碗|条|把|节|头|粒|颗|块|张|段";
  // 剥掉份量：「鸡蛋(4只)」「卷心菜750克」「10克精盐」
  const stripQty = (m) =>
    m
      .replace(/[（(][^）)]*[）)]/g, "")
      .replace(new RegExp(`[0-9０-９./~～\\-—]+\\s*(?:${QTY_UNIT})+$`, "i"), "")
      .replace(new RegExp(`^[0-9０-９./~～\\-—]+\\s*(?:${QTY_UNIT})`, "i"), "")
      .replace(/[。；;，,、]+$/g, "")
      .trim();
  const looksLikeFood = (m) =>
    /^[\u4e00-\u9fa5]{2,6}$/.test(m) &&
    !CONDIMENT.has(m) &&
    !/(各少许|适量|少许|各半|若干|做法|主料|辅料|调料)$/.test(m);

  // 抽取结果（scripts/extract-materials.mjs）：菜名|材料1,材料2
  const overlay = new Map();
  const overlayFile = path.join(process.cwd(), "data", "food", "recipe-materials.psv");
  if (fs.existsSync(overlayFile)) {
    for (const line of fs.readFileSync(overlayFile, "utf8").split(/\r?\n/)) {
      if (!line.trim() || line.startsWith("#")) continue;
      const [name, list] = line.split("|");
      if (!name || !list) continue;
      overlay.set(name.trim(), list.split(/[,，]/).map((x) => x.trim()).filter(Boolean));
    }
  }

  let fromOverlay = 0;
  let droppedCondiment = 0;
  for (const [name, r] of recipeMap) {
    const raw = r.materials ?? [];
    const cleaned = [...new Set(raw.map(stripQty))].filter(looksLikeFood);
    droppedCondiment += raw.length - cleaned.length;
    const ov = (overlay.get(name) ?? []).filter(looksLikeFood);

    // 旧数据「不可信」的信号：剥完几乎不剩，或条目被切碎（出现 1 字词）。
    // 这时宁可改用从做法里抽的，也不要把「郫县豆/瓣」端给用户。
    const legacyBroken = cleaned.length === 0 || cleaned.some((m) => m.length < 2);
    if (legacyBroken && ov.length) {
      r.materials = ov.slice(0, 12);
      fromOverlay += 1;
    } else {
      r.materials = cleaned;
    }
  }
  console.log(`  材料：清洗旧数据剔除 ${droppedCondiment} 项；用抽取结果替换 ${fromOverlay} 道`);

  const recipes = [...recipeMap.values()];
  const byMeal = recipes.reduce((acc, r) => ((acc[r.meal] = (acc[r.meal] ?? 0) + 1), acc), {});
  const withMat = recipes.filter((r) => r.materials.length).length;
  console.log(`  有材料清单 ${withMat} / ${recipes.length} 道（${((withMat / recipes.length) * 100).toFixed(0)}%）`);
  console.log(`  去重后 ${recipes.length} 道，餐次分布：`, byMeal);
  console.log("  样例：", JSON.stringify(recipes[0], null, 0).slice(0, 300));

  // 时令
  const seasons = parseSeasons(await readPdf(path.join(SRC, "食谱", "超全一年四季时令蔬菜水果表，(1).pdf")));
  console.log("时令：", seasons.map((s) => `${s.season} 蔬${s.vegetables.length}/果${s.fruits.length}`).join(" "));

  // 写包
  const write = (file, data) => {
    fs.writeFileSync(path.join(OUT, file), JSON.stringify(data), "utf8");
    return fs.statSync(path.join(OUT, file)).size;
  };

  const meta = [
    { id: "idiom", kind: "words", group: "zh", title: "常用成语", count: idioms.length, file: "idiom.json", bytes: write("idiom.json", idioms) },
    { id: "recipes", kind: "docs", group: "life", title: "家常食谱", count: recipes.length, file: "recipes.json", bytes: write("recipes.json", recipes) },
    { id: "seasons", kind: "docs", group: "life", title: "四季时令", count: seasons.length, file: "seasons.json", bytes: write("seasons.json", seasons) }
  ];

  const indexFile = path.join(OUT, "index.json");
  const index = fs.existsSync(indexFile)
    ? JSON.parse(fs.readFileSync(indexFile, "utf8"))
    : { version: 1, packs: [] };
  const keep = index.packs.filter((p) => !meta.some((m) => m.id === p.id));
  index.packs = [...keep, ...meta.map(({ file, ...rest }) => ({ ...rest, file }))];
  index.generatedAt = new Date().toISOString();
  fs.writeFileSync(indexFile, JSON.stringify(index, null, 2), "utf8");
  console.log("index.json →", index.packs.map((p) => `${p.id}(${p.count})`).join(" "));
}

main().catch((e) => {
  console.error("编译失败：", e);
  process.exit(1);
});
