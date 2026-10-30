/**
 * 数据清理逻辑冒烟：分组定义、分区聚合、统计、分类清除、全清兜底，
 * 以及小知那一侧的「认范围 / 认确认」纯逻辑。
 * 用 fake-indexeddb 让 Dexie 在 Node 里跑起来。
 */
import "fake-indexeddb/auto";
import {
  DATA_GROUPS,
  DATA_SECTIONS,
  buildSectionViews,
  clearAllData,
  clearGroup,
  formatStat,
  groupItemCount,
  statAll,
  statGroup
} from "@/services/dataCleanup";
import {
  buildCleanupPrompt,
  isCancel,
  isConfirm,
  isStorageQuery,
  matchCleanupScope,
  resolveCleanupGroups
} from "@/services/companion/dataTools";
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
  "knowflow.play.difficulty",
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
  ok(
    DATA_SECTIONS.some((s) => s.id === g.section),
    `${g.id} 的 section「${g.section}」不在分区表里，设置页会漏显示`
  );
}
ok(DATA_SECTIONS.length >= 3, "分区数量偏少");
ok(new Set(DATA_SECTIONS.map((s) => s.id)).size === DATA_SECTIONS.length, "分区 id 不能重复");

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

// ---------------- 5) 分区聚合 ----------------
for (const k of ALL_KEYS) store.set(k, "{}");
const allStats = await statAll(DATA_GROUPS);
ok(Object.keys(allStats).length === DATA_GROUPS.length, "statAll 应覆盖所有分组");
ok(groupItemCount(allStats.quest) === 3, "闯关组应有 3 项");
ok(groupItemCount(undefined) === 0, "没统计到时应算 0 项");

const views = buildSectionViews(DATA_GROUPS, allStats);
ok(views.length === DATA_SECTIONS.length, `分区视图数量应为 ${DATA_SECTIONS.length}，实际 ${views.length}`);
ok(
  views.reduce((n, v) => n + v.groups.length, 0) === DATA_GROUPS.length,
  "每个分组都应落在某个分区里（不能有孤儿分组）"
);
const learning = views.find((v) => v.id === "learning")!;
ok(learning.groups.length === 5, `学习记录分区应有 5 类，实际 ${learning.groups.length}`);
ok(learning.filled === 5, `学习记录分区有数据的类数应为 5，实际 ${learning.filled}`);
ok(learning.items > 0, "学习记录分区应有条目");
// 空分区不出现在视图里，避免页面出现空标题
const emptyView = buildSectionViews([], {});
ok(emptyView.length === 0, "没有分组时不应产生空分区");

// ---------------- 6) 小知：认范围 / 认确认 ----------------
const g = DATA_GROUPS;
const scopeOf = (t: string) => matchCleanupScope(t, g)?.scope ?? null;
ok(scopeOf("把小游戏成绩清掉") === "games", "「小游戏成绩」应命中 games");
ok(scopeOf("清理背单词进度") === "drill", "「背单词进度」应命中 drill");
ok(scopeOf("删除成语记录") === "idiom", "「成语」应命中 idiom");
ok(scopeOf("清空所有学习记录") === "section:learning", "「所有学习记录」应命中分区");
ok(scopeOf("清除所有数据") === "all", "「所有数据」应命中全清");
ok(scopeOf("清空所有游戏成绩") === "games", "带「所有」也应优先命中具体分组");
ok(scopeOf("清掉任务清单") === "tasks", "「任务」应命中 tasks");
ok(matchCleanupScope("我的资料有多少", g) === null, "纯提问不该被当成清理");
ok(matchCleanupScope("游戏怎么玩", g) === null, "没有删除动作词就不算清理");
ok(matchCleanupScope("我本地存了多少数据", g) === null, "存储查询不该被当成清理");

ok(isStorageQuery("我本地存了多少数据"), "存储查询应被识别");
ok(isStorageQuery("本地数据占多少"), "「占多少」应被识别");
ok(!isStorageQuery("清空本地数据"), "清理请求不该被当成查询");

ok(isConfirm("确认") && isConfirm("好的") && isConfirm("嗯"), "确认词识别");
ok(!isConfirm("确认一下我的资料"), "长句不算确认（避免误删）");
ok(isCancel("算了") && isCancel("取消") && isCancel("不用了"), "取消词识别");

const rGames = resolveCleanupGroups("games", DATA_GROUPS)!;
ok(rGames.groups.length === 1 && rGames.groups[0].id === "games", "games 只应解析出一个分组");
const rLearning = resolveCleanupGroups("section:learning", DATA_GROUPS)!;
ok(rLearning.groups.length === 5, `分区应解析出 5 个分组，实际 ${rLearning.groups.length}`);
ok(resolveCleanupGroups("all", DATA_GROUPS)!.groups.length === DATA_GROUPS.length, "all 应解析出全部分组");
ok(resolveCleanupGroups("不存在的组", DATA_GROUPS) === null, "未知范围应返回 null");

const prompt = buildCleanupPrompt("小游戏成绩", rGames.groups, ["小游戏成绩 6 项记录"]);
ok(prompt.includes("小游戏成绩") && prompt.includes("确认"), "确认文案应包含范围与「确认」");
ok(buildCleanupPrompt("全部本地数据", DATA_GROUPS, ["x"]).includes("10 类"), "多类时应提示一次清掉几类");

if (failed.length) {
  console.error("\n❌ 数据清理冒烟失败：");
  for (const f of failed) console.error("  •", f);
  process.exit(1);
}
console.log(`\n✅ 数据清理 / 分区 / 小知数据工具断言全部通过（${pass} 条）`);
