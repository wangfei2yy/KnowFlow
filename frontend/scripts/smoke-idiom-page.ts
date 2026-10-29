/**
 * 成语页纯逻辑单测：索引、筛选组合、URL 往返、掌握度与错词存储。
 * 跑法：npm run test:idiom-page
 */
import {
  EMPTY_FILTER,
  buildFacets,
  bumpMistakes,
  filterIdioms,
  loadLevels,
  loadMistakes,
  parseFilter,
  setLevel,
  toQuery,
  type IdiomFilter,
  type IdiomLevel
} from "@/services/idiomPack";
import type { IdiomEntry } from "@/services/knowledgePack";

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error("断言失败：" + m);
};

// localStorage 桩（Node 里没有）
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: () => null,
  length: 0
} as unknown as Storage;

const idioms: IdiomEntry[] = [
  { w: "画蛇添足", m: "比喻多此一举。", len: 4 },
  { w: "水到渠成", m: "条件成熟，事情自然成功。", len: 4 },
  { w: "水落石出", m: "真相终于显露。", len: 4 },
  { w: "一成不变", m: "不再改变。", len: 4 },
  { w: "一鸣惊人", m: "平时无声，突然做出成绩。", len: 4 },
  { w: "微不足道", m: "非常渺小。", len: 4 },
  { w: "大喜过望", m: "结果比期望的更好，因此特别高兴。", len: 4 },
  { w: "百闻不如一见", m: "听得多不如亲眼看到。", len: 6 }
];

// ---------- 1) 索引 ----------
const facets = buildFacets(idioms);
ok(facets.firsts.length === 6, `首字应 6 个，实际 ${facets.firsts.length}`);
ok(facets.firsts[0].ch === "水" && facets.firsts[0].count === 2, "「水」应为最高频首字（2 条）");
ok(facets.lasts.some((x) => x.ch === "成"), "尾字应含「成」");
ok(facets.lengths.map((x) => x.len).join(",") === "4,6", `字数分布应为 4,6，实际 ${facets.lengths.map((x) => x.len)}`);
console.log("1) 索引：首字", facets.firsts.length, "尾字", facets.lasts.length, "字数", facets.lengths.map((x) => x.len).join("/"));

// ---------- 2) 单条件筛选 ----------
const f = (patch: Partial<IdiomFilter>): IdiomFilter => ({ ...EMPTY_FILTER, ...patch });
ok(filterIdioms(idioms, f({ keyword: "水" })).length === 2, "搜「水」应命中 2 条");
ok(filterIdioms(idioms, f({ keyword: "高兴" })).length === 1, "按释义搜「高兴」应命中 1 条");
ok(filterIdioms(idioms, f({ first: "水" })).length === 2, "首字筛选应命中 2 条");
ok(filterIdioms(idioms, f({ last: "变" })).length === 1, "尾字筛选应命中 1 条");
ok(filterIdioms(idioms, f({ len: 6 })).length === 1, "6 字筛选应命中 1 条");
console.log("2) 单条件筛选 OK");

// ---------- 3) 组合筛选（首字 + 关键字） ----------
const combo = filterIdioms(idioms, f({ first: "水", keyword: "成功" }));
ok(combo.length === 1 && combo[0].w === "水到渠成", `首字+关键字应命中「水到渠成」，实际 ${combo.map((x) => x.w)}`);
// 两个条件冲突时必须是 0，而不是忽略其中一个
ok(filterIdioms(idioms, f({ first: "水", keyword: "多此一举" })).length === 0, "条件冲突应返回空");
console.log("3) 组合筛选 OK");

// ---------- 4) 掌握度筛选 ----------
const levels: Record<string, IdiomLevel> = { 水到渠成: "known", 画蛇添足: "unknown" };
ok(filterIdioms(idioms, f({ level: "known" }), levels).length === 1, "「会」应只命中 1 条");
ok(filterIdioms(idioms, f({ level: "unknown" }), levels).length === 1, "「不会」应只命中 1 条");
ok(filterIdioms(idioms, f({ level: "none" }), levels).length === 6, `「未标」应 6 条，实际 ${filterIdioms(idioms, f({ level: "none" }), levels).length}`);
ok(filterIdioms(idioms, f({ level: "all" }), levels).length === idioms.length, "「不限」应为全部");
console.log("4) 掌握度筛选 OK");

// ---------- 5) 只看错过 ----------
const mistakes: Record<string, number> = { 一鸣惊人: 3 };
const onlyBad = filterIdioms(idioms, f({ onlyMistake: true }), {}, mistakes);
ok(onlyBad.length === 1 && onlyBad[0].w === "一鸣惊人", "只看错过应命中 1 条");
console.log("5) 错词筛选 OK");

// ---------- 6) URL 往返 ----------
const src = f({ keyword: "水", first: "水", last: "成", len: 4, level: "fuzzy", onlyMistake: true });
const q = toQuery(src);
ok(q.q === "水" && q.first === "水" && q.last === "成" && q.len === "4" && q.level === "fuzzy" && q.mistake === "1", "toQuery 字段不全");
const back = parseFilter(q as Record<string, unknown>);
ok(
  back.keyword === src.keyword && back.first === src.first && back.last === src.last &&
    back.len === src.len && back.level === src.level && back.onlyMistake === src.onlyMistake,
  `URL 往返不一致：${JSON.stringify(back)}`
);
// 空条件不写进 URL
ok(Object.keys(toQuery(EMPTY_FILTER)).length === 0, "空筛选不应产生 query");
// 非法值容错
const bad = parseFilter({ len: "abc", level: "xyz", first: "水水" });
ok(bad.len === 0 && bad.level === "all" && bad.first === "水", "非法 query 应回落为不限/截首字");
console.log("6) URL 往返 OK");

// ---------- 7) 掌握度与错词持久化 ----------
store.clear();
setLevel("画蛇添足", "known");
ok(loadLevels()["画蛇添足"] === "known", "掌握度应写入");
setLevel("画蛇添足", null);
ok(loadLevels()["画蛇添足"] === undefined, "清除掌握度应生效");

bumpMistakes(["一鸣惊人", "一鸣惊人", "水到渠成"]);
let m = loadMistakes();
ok(m["一鸣惊人"] === 2 && m["水到渠成"] === 1, `错词应累加，实际 ${JSON.stringify(m)}`);
bumpMistakes(["一鸣惊人"]);
m = loadMistakes();
ok(m["一鸣惊人"] === 3, "再次累加");
// 坏 JSON 不应抛错
store.set("knowflow.idiom.level", "{bad json");
ok(typeof loadLevels() === "object", "坏 JSON 应返回空对象");
console.log("7) 持久化 OK");

console.log("\n✅ 成语页逻辑 7 组断言全部通过");
