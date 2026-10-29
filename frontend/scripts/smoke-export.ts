import { documentsToMarkdown, cardsToAnkiCsv } from "@/utils/export";
import type { Document } from "@/types/document";
import type { Flashcard } from "@/db/database";

const ok = (c: boolean, m: string) => {
  if (!c) throw new Error("断言失败：" + m);
};

function doc(id: string, title: string, extra: Partial<Document> = {}): Document {
  return {
    id,
    title,
    content: "正文一段\n\n正文二段",
    sourceType: "note",
    tags: ["语法", "英语"],
    keywords: ["定语从句"],
    favorite: false,
    summary: "这是摘要",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-02T10:00:00.000Z",
    ...extra
  } as Document;
}

function card(q: string, a: string): Flashcard {
  return {
    id: q,
    documentId: "d1",
    question: q,
    answer: a,
    mastery: 0,
    reviewCount: 0,
    createdAt: "2026-10-01T10:00:00.000Z"
  } as Flashcard;
}

// 1) 单篇 Markdown 结构
const md1 = documentsToMarkdown([doc("d1", "定语从句笔记")], () => "英语语法");
console.log("1) Markdown 片段:\n" + md1.split("\n").slice(0, 8).join("\n"));
ok(md1.startsWith("# 定语从句笔记"), "应以一级标题开头");
ok(md1.includes("> 来源：笔记 · 分类：英语语法 · 标签：语法、英语"), "元信息缺失");
ok(md1.includes("## 摘要"), "缺少摘要章节");
ok(md1.includes("## 关键词"), "缺少关键词章节");
ok(md1.includes("## 正文"), "缺少正文章节");
ok(md1.includes("正文二段"), "正文未完整包含");

// 2) 多篇用分隔线
const md2 = documentsToMarkdown([doc("d1", "A"), doc("d2", "B")]);
ok(md2.includes("\n\n---\n\n"), "多篇导出未使用分隔线");
ok(md2.indexOf("# A") < md2.indexOf("# B"), "顺序错误");

// 3) Anki CSV：BOM + 表头 + 转义
const csv = cardsToAnkiCsv([card('什么是"定语从句"?', "用来修饰名词\n或代词的从句")]);
console.log("3) CSV 原始:", JSON.stringify(csv));
ok(csv.charCodeAt(0) === 0xfeff, "缺少 UTF-8 BOM");
ok(csv.includes('"question","answer"'), "缺少表头");
ok(csv.includes('"什么是""定语从句""?"'), "双引号未转义");
ok(csv.includes("用来修饰名词<br>或代词的从句"), "换行未转 <br>");
ok(csv.includes("\r\n"), "未使用 CRLF");

// 4) 空卡片列表
const empty = cardsToAnkiCsv([]);
ok(empty.replace("\ufeff", "").trim() === '"question","answer"', "空列表应只有表头");

// 5) 无摘要/关键词时不产生空章节
const plain = documentsToMarkdown([doc("d3", "C", { summary: undefined, keywords: [] })]);
ok(!plain.includes("## 摘要"), "无摘要却生成了章节");
ok(!plain.includes("## 关键词"), "无关键词却生成了章节");

console.log("EXPORT SMOKE PASS");
process.exit(0);
