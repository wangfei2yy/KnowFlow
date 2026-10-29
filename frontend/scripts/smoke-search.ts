import { searchAll } from "@/services/searchService";
import type { Document } from "@/types/document";

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error("断言失败：" + m);
};

function doc(id: string, title: string, content = "正文"): Document {
  return {
    id, title, content, sourceType: "note", tags: ["语法"], keywords: [],
    favorite: false, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z"
  } as Document;
}
const card = (id: string, q: string, a = "答案") => ({ id, documentId: "d1", question: q, answer: a });
const task = (id: string, title: string, description = "", status = "todo") => ({ id, title, description, status });

const docs = [doc("d1", "定语从句笔记", "定语从句用于修饰名词。"), doc("d2", "时态总结", "现在完成时表示已完成。")];
const cards = [card("c1", "什么是定语从句？"), card("c2", "关系代词有哪些？", "which/that/who")];
const tasks = [task("t1", "复习定语从句", "把从句笔记看一遍", "doing"), task("t2", "买牛奶")];

// 1) 空关键词
ok(searchAll({ keyword: "   ", documents: docs, cards, tasks }).length === 0, "空关键词应无结果");

// 2) 三类都能命中
const r = searchAll({ keyword: "定语从句", documents: docs, cards, tasks });
console.log("2) 命中：", r.map((h) => `${h.kind}:${h.id}`).join(", "));
ok(r.some((h) => h.kind === "document" && h.id === "d1"), "应命中资料");
ok(r.some((h) => h.kind === "card" && h.id === "c1"), "应命中卡片");
ok(r.some((h) => h.kind === "task" && h.id === "t1"), "应命中任务");
ok(!r.some((h) => h.id === "t2"), "不应命中无关任务");

// 3) 标题命中优先于答案命中
const r2 = searchAll({ keyword: "关系代词", documents: docs, cards, tasks });
ok(r2[0].id === "c2", `标题/问题命中应排前，实际 ${r2[0].id}`);

// 4) 每类条数上限
const many = Array.from({ length: 10 }, (_, i) => card(`m${i}`, `定语从句问题${i}`));
const r3 = searchAll({ keyword: "定语从句", documents: docs, cards: many, tasks });
const cardHits = r3.filter((h) => h.kind === "card");
console.log("4) 卡片命中数（每类上限 6）：", cardHits.length);
ok(cardHits.length === 6, `每类最多 6 条，实际 ${cardHits.length}`);

// 5) 任务状态文案 + 摘录包含关键词
const t = searchAll({ keyword: "看一遍", documents: [], cards: [], tasks })[0];
console.log("5) 任务命中：", JSON.stringify(t));
ok(t.kind === "task" && t.meta === "进行中", "任务状态文案错误");
ok(t.excerpt.includes("看一遍"), "摘录应包含关键词");

// 6) 资料摘录裁剪
const longDoc = doc("d3", "长文", "前奏".repeat(80) + "关键词在中间" + "后记".repeat(80));
const d = searchAll({ keyword: "关键词在中间", documents: [longDoc], cards: [], tasks })[0];
console.log("6) 摘录：", d.excerpt);
ok(d.excerpt.length < 130, "摘录应被裁剪");
ok(d.excerpt.includes("关键词在中间"), "摘录应包含关键词");

console.log("SEARCH SMOKE PASS");
process.exit(0);
