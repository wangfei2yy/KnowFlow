import type { Document } from "@/types/document";

export interface SearchResult {
  document: Document;
  score: number;
  matchedFields: ("title" | "content" | "tags")[];
  excerpt?: string;
}

/**
 * 分词：英文按单词，中文按单字 + bigram（字符 n-gram）。
 * 避免只依赖英文空格分词，保证中文检索可用。
 */
export function tokenize(text: string): string[] {
  const normalized = text.toLowerCase();
  const tokens = new Set<string>();

  // 英文单词与数字
  const words = normalized.match(/[a-z0-9]+/g) ?? [];
  words.forEach((w) => tokens.add(w));

  // 中文字符：单字 + bigram
  const cjk = normalized.replace(/[^\u4e00-\u9fa5]/g, "");
  for (let i = 0; i < cjk.length; i++) {
    tokens.add(cjk[i]);
    if (i + 1 < cjk.length) tokens.add(cjk.slice(i, i + 2));
  }
  return [...tokens];
}

/**
 * 在文档列表中检索，返回带分数与上下文的匹配结果。
 * 打分：标题 100 > 标签 50 > 正文精确 30 > 正文 token 命中 10。
 */
export function searchDocuments(docs: Document[], keyword: string): SearchResult[] {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return [];

  const kwTokens = tokenize(kw);
  const results: SearchResult[] = [];

  for (const doc of docs) {
    let score = 0;
    const matchedFields: SearchResult["matchedFields"] = [];

    const titleLower = doc.title.toLowerCase();
    if (titleLower.includes(kw)) {
      score += 100;
      matchedFields.push("title");
    }

    if (doc.tags.some((t) => t.toLowerCase().includes(kw))) {
      score += 50;
      matchedFields.push("tags");
    }

    const contentLower = doc.content.toLowerCase();
    const idx = contentLower.indexOf(kw);
    if (idx >= 0) {
      score += 30;
      matchedFields.push("content");
      results.push({
        document: doc,
        score,
        matchedFields,
        excerpt: makeExcerpt(doc.content, idx, kw.length)
      });
      continue;
    }

    // 无精确命中时，按 token 命中打分
    const tokenHit = kwTokens.some((t) => contentLower.includes(t));
    if (tokenHit) {
      score += 10;
      matchedFields.push("content");
    }

    if (score > 0) {
      results.push({ document: doc, score, matchedFields });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

function makeExcerpt(content: string, idx: number, len: number): string {
  const start = Math.max(0, idx - 30);
  const end = Math.min(content.length, idx + len + 40);
  return (start > 0 ? "…" : "") + content.slice(start, end) + (end < content.length ? "…" : "");
}

/* ------------------------- 跨模块全局搜索 ------------------------- */

export type GlobalHitKind = "document" | "card" | "task";

export interface GlobalHit {
  kind: GlobalHitKind;
  id: string;
  title: string;
  excerpt: string;
  score: number;
  /** 次要信息：资料标题 / 任务状态等 */
  meta?: string;
}

/** 结构化类型，避免 searchService 依赖 db 层 */
interface CardLike {
  id: string;
  documentId: string;
  question: string;
  answer: string;
}
interface TaskLike {
  id: string;
  title: string;
  description?: string;
  status: string;
}

const KIND_WEIGHT: Record<GlobalHitKind, number> = { document: 1, card: 0.9, task: 0.75 };

function clip(text: string, keyword: string, radius = 40): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(keyword.toLowerCase());
  if (idx < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + keyword.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/**
 * 全局搜索：文档（复用打分）、卡片（问题为主、答案为辅）、任务（标题为主）。
 * 同分时按「文档 → 卡片 → 任务」排序，保证结果稳定。
 */
export function searchAll(input: {
  keyword: string;
  documents: Document[];
  cards: CardLike[];
  tasks: TaskLike[];
  /** 每个模块最多返回多少条，默认 6 */
  perKind?: number;
  /** 总条数上限，默认 20 */
  limit?: number;
}): GlobalHit[] {
  const kw = input.keyword.trim().toLowerCase();
  if (!kw) return [];
  const perKind = input.perKind ?? 6;
  const limit = input.limit ?? 20;

  const hits: GlobalHit[] = [];

  // 文档
  for (const r of searchDocuments(input.documents, kw).slice(0, perKind)) {
    hits.push({
      kind: "document",
      id: r.document.id,
      title: r.document.title,
      excerpt: r.excerpt ?? clip(r.document.content, kw),
      score: r.score * KIND_WEIGHT.document,
      meta: r.document.tags.slice(0, 3).join(" · ")
    });
  }

  // 卡片
  let cardCount = 0;
  for (const c of input.cards) {
    if (cardCount >= perKind) break;
    const q = c.question.toLowerCase();
    const a = c.answer.toLowerCase();
    let score = 0;
    if (q.includes(kw)) score += 90;
    if (a.includes(kw)) score += 35;
    if (score === 0) continue;
    hits.push({
      kind: "card",
      id: c.id,
      title: c.question,
      excerpt: clip(c.answer, kw),
      score: score * KIND_WEIGHT.card,
      meta: "学习卡片"
    });
    cardCount += 1;
  }

  // 任务
  let taskCount = 0;
  for (const t of input.tasks) {
    if (taskCount >= perKind) break;
    const titleHit = t.title.toLowerCase().includes(kw);
    const descHit = (t.description ?? "").toLowerCase().includes(kw);
    if (!titleHit && !descHit) continue;
    hits.push({
      kind: "task",
      id: t.id,
      title: t.title,
      excerpt: clip(t.description ?? "", kw),
      score: ((titleHit ? 80 : 0) + (descHit ? 25 : 0)) * KIND_WEIGHT.task,
      meta: t.status === "done" ? "已完成" : t.status === "doing" ? "进行中" : "待办"
    });
    taskCount += 1;
  }

  const kindOrder: Record<GlobalHitKind, number> = { document: 0, card: 1, task: 2 };
  return hits
    .sort((a, b) => b.score - a.score || kindOrder[a.kind] - kindOrder[b.kind])
    .slice(0, limit);
}
