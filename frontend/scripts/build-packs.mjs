/**
 * 把 data/英语 下的原始素材编译成前端可用的知识包。
 *
 * 输入：
 *   data/英语/单词/大学英语四级词汇-乱序版-答案.pdf
 *   data/英语/单词/大学英语六级词汇-乱序版-答案.pdf
 *   data/英语/语法/**\/*.md
 *
 * 输出：
 *   frontend/public/packs/index.json      包清单
 *   frontend/public/packs/junior.json     初中词库（中考核心）
 *   frontend/public/packs/cet4.json       四级词库
 *   frontend/public/packs/cet6.json       六级词库
 *   frontend/public/packs/grammar.json    语法专题
 *
 * 用法：cd frontend && node scripts/build-packs.mjs
 */
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "..");
const SRC = path.join(ROOT, "data", "英语");
const OUT = path.join(process.cwd(), "public", "packs");

/** 从表头（序号/单词/音标/释义）推导列边界 */
function detectColumns(items) {
  const heads = {};
  for (const it of items) {
    const s = it.s.trim();
    if (["序号", "单词", "音标", "释义"].includes(s)) heads[s] = it.x;
  }
  if (!heads["序号"] || !heads["单词"] || !heads["音标"] || !heads["释义"]) return null;
  const n = heads["序号"], w = heads["单词"], p = heads["音标"], m = heads["释义"];
  return {
    numMax: (n + w) / 2,
    wordMax: (w + p) / 2,
    phonMax: (p + m) / 2
  };
}

function colOf(x, cols) {
  if (x < cols.numMax) return "num";
  if (x < cols.wordMax) return "word";
  if (x < cols.phonMax) return "phon";
  return "mean";
}

/** 清洗释义：去掉人名/地名等考试无关义项，控制长度 */
function cleanMeaning(raw) {
  let s = (raw || "").replace(/\s+/g, " ").trim();
  s = s.replace(/n\.\s*\([^)]{1,12}\)\s*人名[^；]*?(?=(adj\.|adv\.|n\.|vt\.|vi\.|prep\.|pron\.|conj\.|$))/g, "");
  s = s.replace(/n\.\s*（[^）]{1,12}）[^；]*?(?=(adj\.|adv\.|n\.|vt\.|vi\.|prep\.|pron\.|conj\.|$))/g, "");
  s = s.replace(/\s{2,}/g, " ").trim();
  if (s.length > 150) s = s.slice(0, 150) + "…";
  return s;
}

async function parsePdfWords(file) {
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise;
  const out = [];

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const c = await page.getTextContent();
    const items = c.items
      .filter((i) => i.str && i.str.trim() && (i.transform?.[5] ?? 0) > 40)
      .map((i) => ({ x: i.transform[4], y: i.transform[5], s: i.str }));

    const cols = detectColumns(items);
    if (!cols) continue;

    const nums = items.filter((i) => colOf(i.x, cols) === "num" && /^\d{1,4}$/.test(i.s.trim()));
    nums.forEach((n) => (n.__isNum = true));
    if (nums.length === 0) continue;
    const ys = nums.map((n) => n.y);

    const buckets = new Map();
    for (const it of items) {
      if (it.__isNum) continue;
      let best = -1;
      let bestD = Infinity;
      for (const y of ys) {
        const d = Math.abs(it.y - y);
        if (d < bestD) {
          bestD = d;
          best = y;
        }
      }
      if (bestD > 40) continue;
      if (!buckets.has(best)) buckets.set(best, { word: [], phon: [], mean: [] });
      const col = colOf(it.x, cols);
      if (col === "word") buckets.get(best).word.push(it);
      else if (col === "phon") buckets.get(best).phon.push(it);
      else if (col === "mean") buckets.get(best).mean.push(it);
    }

    for (const n of nums) {
      const b = buckets.get(n.y);
      if (!b) continue;
      const word = b.word.sort((a, c2) => a.x - c2.x).map((i) => i.s).join("").trim();
      const meaning = cleanMeaning(
        b.mean
          .sort((a, c2) => (Math.abs(a.y - c2.y) > 3 ? c2.y - a.y : a.x - c2.x))
          .map((i) => i.s)
          .join("")
      );
      if (!word || !/^[A-Za-z]/.test(word)) continue;
      const phonetic = b.phon
        .sort((a, c2) => a.x - c2.x)
        .map((i) => i.s)
        .join("")
        .replace(/\s+/g, "")
        .trim();
      out.push({ no: Number(n.s), word, phonetic, meaning });
    }
  }
  return out;
}

/** 语法 md → 专题；按文件夹归类 */
function parseGrammar() {
  const base = path.join(SRC, "语法");
  const topics = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (name.endsWith(".md")) {
        const content = fs.readFileSync(full, "utf-8").trim();
        const rel = path.relative(base, full).replace(/\\/g, "/");
        const category = rel.includes("/") ? rel.split("/")[0] : "综合";
        const firstLine = content.split("\n").find((l) => l.startsWith("# "));
        const title = (firstLine ? firstLine.replace(/^#\s*/, "") : name.replace(/\.md$/, "")).trim();
        topics.push({ id: rel.replace(/\.md$/, ""), title, category, content });
      }
    }
  };
  walk(base);
  topics.sort((a, b) => a.category.localeCompare(b.category, "zh") || a.id.localeCompare(b.id));
  return topics;
}

function dedupe(words) {
  const seen = new Set();
  const out = [];
  for (const w of words) {
    const key = w.word.toLowerCase();
    if (seen.has(key) || !w.meaning) continue;
    seen.add(key);
    out.push({ w: key, p: w.phonetic, m: w.meaning });
  }
  return out;
}

/**
 * 入库的词库源表（frontend/data/words/<id>.psv）。
 *
 * 为什么要这张表：原始 PDF 在仓库根的 data/ 下、因版权不入库，
 * 换一台机器就只剩产物 JSON，没法重建。源表入库后，改词条也不用碰 PDF。
 * 格式：单词|音标|释义，# 开头为注释。
 */
function readWordTable(id) {
  const file = path.join(process.cwd(), "data", "words", `${id}.psv`);
  if (!fs.existsSync(file)) return null;
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim() || line.startsWith("#")) continue;
    const [w, phonetic, meaning] = line.split("|");
    if (!w || !meaning) continue;
    out.push({ w: w.trim(), p: (phonetic ?? "").trim(), m: meaning.trim() });
  }
  return out.length ? out : null;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const packs = [];

  // 顺序即前端词库列表的顺序：初中 → 四级 → 六级，按难度递进
  for (const [id, file, title] of [
    ["junior", "初中词汇-中考核心.json", "初中词汇"],
    ["cet4", "大学英语四级词汇-乱序版-答案.pdf", "四级词汇"],
    ["cet6", "大学英语六级词汇-乱序版-答案.pdf", "六级词汇"]
  ]) {
    // 有入库源表就用源表；没有才回落到 PDF 解析（PDF 不入库，新机器上拿不到）
    const table = readWordTable(id);
    const raw = table ?? (await parsePdfWords(path.join(SRC, "单词", file)));
    const words = table ?? dedupe(raw);
    const target = path.join(OUT, `${id}.json`);
    fs.writeFileSync(target, JSON.stringify(words));
    packs.push({
      id,
      kind: "words",
      title,
      count: words.length,
      bytes: fs.statSync(target).size,
      file: `${id}.json`
    });
    console.log(
      `${id}: ${table ? "源表" : "PDF"} ${raw.length} 条 → 可用 ${words.length} 词，` +
        `${(fs.statSync(target).size / 1024).toFixed(0)} KB`
    );
  }

  const topics = parseGrammar();
  const gTarget = path.join(OUT, "grammar.json");
  fs.writeFileSync(gTarget, JSON.stringify(topics));
  packs.push({
    id: "grammar",
    kind: "docs",
    title: "英语语法专题",
    count: topics.length,
    bytes: fs.statSync(gTarget).size,
    file: "grammar.json"
  });
  console.log(`grammar: ${topics.length} 篇，${(fs.statSync(gTarget).size / 1024).toFixed(0)} KB`);

  fs.writeFileSync(
    path.join(OUT, "index.json"),
    JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), packs }, null, 2)
  );
  console.log("index.json 写入完成");
}

main().catch((e) => {
  console.error("构建知识包失败：", e);
  process.exit(1);
});
