/**
 * 数据清理逻辑冒烟：分组定义、统计、分类清除、全清兜底。
 * 用 fake-indexeddb 让 Dexie 在 Node 里跑起来。
 */
import "fake-indexeddb/auto";
import {
  DATA_GROUPS,
  clearAllData,
  clearGroup,
  formatStat,
  statGroup
} from "@/services/dataCleanup";
import { db } from "@/db/database";

let pass = 0;
const failed: string[] = [];
function ok(cond: boolean, msg: string) {
  if (cond) pass += 1;
  else failed.push(msg);
}

// 假 localStorage
const store = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => void store.set(k, String(v)),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
  key: (i: number) => [...store.keys()][i] ?? null,
  get length() {
    return store.size;
  }
} as unknown as Storage;

// 代码里出现过的全部本地键（新增键时必须同步进 DATA_GROUPS，否则「全部清除」会漏）
const ALL_KEYS = [
  "knowflow.ai.config",
  "knowflow.ai.key.persist",
  "knowflow.ai.key.session",
  "knowflow.ai.speech.config",
  "knowflow.ai.speech.key.persist",
  "knowflow.ai.speech.key.session",
  "knowflow.companion",
  "knowflow.game.progress",
  "knowflow.idiom.level",
  "knowflow.idiom.mistakes",
  "knowflow.kitchen.checked",
  "knowflow.kitchen.locks",
  "knowflow.play.pack",
  "knowflow.play.untimed",
  "knowflow.quest.progress",
  "knowflow.quest.session",
  "knowflow.study.position",
  "knowflow.theme",
  "knowflow.words.drill",
  "knowflow.words.drill.session"
];

// ---------------- 1) 分组覆盖 ----------------
const declared = new Set(DATA_GROUPS.flatMap((g) => g.keys ?? []));
const missing = ALL_KEYS.filter((k) => !declared.has(k));
ok(missing.length === 0, `以下键未登记进清除分组：${missing.join(", ")}`);
ok(DATA_GROUPS.length >= 8, `分组数量偏少：${DATA_GROUPS.length}`);
ok(new Set(DATA_GROUPS.map((g) => g.id)).size === DATA_GROUPS.length, "分组 id 不能重复");
for (const g of DATA_GROUPS) {
  ok(Boolean(g.label && g.desc), `${g.id} 缺少名称或说明`);
  ok((g.tables?.length ?? 0) + (g.keys?.length ?? 0) > 0, `${g.id} 既没有表也没有键`);
}

// ---------------- 2) 统计与文案 ----------------
for (const k of ALL_KEYS) store.set(k, "{}");
store.set("knowflow.theme", "dark");
const quest = DATA_GROUPS.find((g) => g.id === "quest")!;
const qStat = await statGroup(quest);
ok(qStat.keys === 3, `闯关组应有 3 项记录，实际 ${qStat.keys}`);
ok(qStat.empty === false, "有记录时 empty 应为 false");
ok(formatStat(quest, qStat) === "3 项记录", `文案应为「3 项记录」，实际 ${formatStat(quest, qStat)}`);

const cardsGroup = DATA_GROUPS.find((g) => g.id === "cards")!;
const cStat = await statGroup(cardsGroup);
ok(formatStat(cardsGroup, cStat) === "0 张卡片", `卡片文案，实际 ${formatStat(cardsGroup, cStat)}`);
ok(cStat.empty === true, "没有卡片时 empty 应为 true（清除按钮置灰）");

// ---------------- 3) 分类清除：只动这一类 ----------------
await db.flashcards.add({
  id: "card1",
  documentId: "d1",
  question: "q",
  answer: "a",
  mastery: 0,
  nextReviewAt: new Date().toISOString(),
  lastReviewedAt: "",
  createdAt: new Date().toISOString()
} as never);
await db.documents.add({
  id: "d1",
  title: "测试资料",
  content: "x",
  sourceType: "note",
  tags: [],
  favorite: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
} as never);

await clearGroup(quest);
ok(quest.keys!.every((k) => localStorage.getItem(k) === null), "闯关组的键应全部清掉");
ok(localStorage.getItem("knowflow.theme") === "dark", "其它组（主题）不该被误删");
ok((await db.flashcards.count()) === 1, "清 localStorage 不该动卡片表");
ok((await db.documents.count()) === 1, "清 localStorage 不该动资料表");

await clearGroup(DATA_GROUPS.find((g) => g.id === "cards")!);
ok((await db.flashcards.count()) === 0, "清卡片组应清空 flashcards");
ok((await db.documents.count()) === 1, "清卡片组不该动资料");

// ---------------- 4) 全部清除：含未登记的键 ----------------
store.set("knowflow.某天新增的键", "1");
await clearAllData(DATA_GROUPS);
ok((await db.documents.count()) === 0, "全清应清空资料");
ok(store.size === 0, `全清后不应残留 knowflow.* 键，实际还剩：${[...store.keys()].join(", ")}`);

if (failed.length) {
  console.error("\n❌ 数据清理冒烟失败：");
  for (const f of failed) console.error("  •", f);
  process.exit(1);
}
console.log(`\n✅ 数据清理 4 组断言全部通过（${pass} 条）`);
