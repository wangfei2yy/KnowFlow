/**
 * 把「中考核心词汇」原始 JSON 转成项目统一的词库源表。
 *
 * 原始数据：qwerty-learner 的 ZhongKaoHeXin.json（2140 条，含 us/uk 音标与释义），
 * 放在 data/英语/单词/ 下（该目录因版权不入库），产物 data/words/junior.psv 入库。
 *
 * 用法：cd frontend && node scripts/import-junior-words.mjs
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(process.cwd(), "..");
const SRC = path.join(ROOT, "data", "英语", "单词", "初中词汇-中考核心.json");
const OUT = path.join(process.cwd(), "data", "words", "junior.psv");

if (!fs.existsSync(SRC)) {
  console.error(`找不到原始词表：${SRC}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(SRC, "utf8"));
const list = Array.isArray(raw) ? raw : raw.list ?? [];

/**
 * 释义清洗：
 * - 去掉 `[复数 parties]`、`[过去式 ...]` 这类变形说明，它们在卡面上只会添乱
 * - 多条 trans 用「；」连成一句（和四级源表口径一致：第一个义项在「；」之前）
 * - 词库字段里不能出现竖线（源表就是用它分隔的）
 */
function cleanMeaning(trans) {
  const parts = (Array.isArray(trans) ? trans : [trans])
    .filter((t) => typeof t === "string" && t.trim())
    .map((t) =>
      t
        .replace(/\[[^\]]*\]/g, "")
        .replace(/\s+/g, " ")
        .trim()
    )
    .filter(Boolean);
  let s = parts.join("；").replace(/\|/g, " ").trim();
  s = s.replace(/；{2,}/g, "；").replace(/^；|；$/g, "");
  return s.length > 150 ? `${s.slice(0, 150)}…` : s;
}

/** 音标统一成 /.../；部分数据用英文逗号标重音，换成 ˈ */
function cleanPhonetic(w) {
  const p = String(w.usphone || w.ukphone || "").trim();
  if (!p) return "";
  return `/${p.replace(/^\/|\/$/g, "").replace(/^,/, "ˈ").replace(/,/g, "ˈ")}/`;
}

const seen = new Set();
const rows = [];
let dropped = 0;

for (const w of list) {
  const word = String(w.name ?? "").trim();
  const meaning = cleanMeaning(w.trans);
  if (!word || !meaning || !/[a-zA-Z]/.test(word)) {
    dropped += 1;
    continue;
  }
  const key = word.toLowerCase();
  if (seen.has(key)) {
    dropped += 1;
    continue;
  }
  seen.add(key);
  rows.push(`${word}|${cleanPhonetic(w)}|${meaning}`);
}

const header = [
  "# 初中词汇源表（中考核心，2140 → 去重后入库）",
  "# 原始数据：qwerty-learner 的 ZhongKaoHeXin.json，位于 data/英语/单词/（不入库）",
  "# 格式：单词|音标|释义；# 开头为注释",
  ""
].join("\n");

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, header + rows.join("\n") + "\n", "utf8");

const noPhone = rows.filter((r) => r.split("|")[1] === "//").length;
console.log(`junior: ${list.length} 条 → 入库 ${rows.length} 条（丢弃 ${dropped}），无音标 ${noPhone} 条`);
console.log(`写入 ${OUT}（${(fs.statSync(OUT).size / 1024).toFixed(0)} KB）`);
