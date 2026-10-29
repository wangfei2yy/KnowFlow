/**
 * 把已编译的词库产物导出成入库源表：public/packs/<id>.json → data/words/<id>.psv
 *
 * 用途：原始 PDF 在仓库根的 data/ 下、因版权不入库，换机器就只剩产物 JSON。
 * 把词条落成源表后，`build:packs` 会优先读源表，改词条也不用碰 PDF。
 *
 * 用法：
 *   node scripts/export-word-table.mjs cet4       # 只导四级
 *   node scripts/export-word-table.mjs cet4 cet6  # 两个都导
 */
import fs from "node:fs";
import path from "node:path";

const ids = process.argv.slice(2).filter((a) => !a.startsWith("-"));
if (!ids.length) {
  console.error("用法：node scripts/export-word-table.mjs <cet4> [cet6]");
  process.exit(1);
}

const OUT_DIR = path.join(process.cwd(), "data", "words");
fs.mkdirSync(OUT_DIR, { recursive: true });

let failed = 0;
for (const id of ids) {
  const src = path.join(process.cwd(), "public", "packs", `${id}.json`);
  if (!fs.existsSync(src)) {
    console.error(`✗ ${id}: 找不到 ${path.relative(process.cwd(), src)}`);
    failed += 1;
    continue;
  }
  const words = JSON.parse(fs.readFileSync(src, "utf8"));
  if (!Array.isArray(words) || !words.length) {
    console.error(`✗ ${id}: 产物不是数组或为空`);
    failed += 1;
    continue;
  }

  const bad = words.filter((w) => !w.w || !w.m || /[|\r\n]/.test(`${w.w}${w.p ?? ""}${w.m}`));
  if (bad.length) {
    console.error(`✗ ${id}: ${bad.length} 条含竖线/换行或字段为空，PSV 会被写坏`);
    failed += 1;
    continue;
  }

  const header = [
    `# ${id} 词汇源表（由 public/packs/${id}.json 导出，原始来源见 docs）`,
    "# 格式：单词|音标|释义；# 开头为注释；build:packs 会优先读这张表",
    ""
  ].join("\n");
  const body = words.map((w) => [w.w, w.p ?? "", w.m].join("|")).join("\n");
  const out = path.join(OUT_DIR, `${id}.psv`);
  fs.writeFileSync(out, `${header}${body}\n`, "utf8");
  console.log(`✓ ${id}: ${words.length} 条 → ${path.relative(process.cwd(), out)}（${(fs.statSync(out).size / 1024).toFixed(0)} KB）`);
}

process.exit(failed ? 1 : 0);
