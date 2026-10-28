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
