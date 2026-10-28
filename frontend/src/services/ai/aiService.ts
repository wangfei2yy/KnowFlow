import { db } from "@/db/database";
import { uuid } from "@/utils/format";
import { toPlain } from "@/utils/plain";
import type { AIProvider } from "./AIProvider";
import type { AIJob, AIJobType, FlashcardDraft } from "@/types/ai";
import type { Document } from "@/types/document";
import { searchDocuments } from "@/services/searchService";

const MAX_INPUT_CHARS = 12000;

/** 卡片生成的单段字符上限：超过就分段调用，保证长文档不被截断 */
const FLASHCARD_CHUNK_CHARS = 2500;
/** 单份资料一次最多生成的卡片数（防止误刷额度） */
const FLASHCARD_HARD_MAX = 60;
/** 单份资料最多发起的模型请求数（含失败重试），防止反复重试刷爆额度 */
const FLASHCARD_MAX_CALLS = 80;
/** 最多分段数：超长资料按需放大每段字符数，避免几十次请求 */
const FLASHCARD_MAX_CHUNKS = 60;

function clampContent(content: string): string {
  return content.length > MAX_INPUT_CHARS ? content.slice(0, MAX_INPUT_CHARS) + "…" : content;
}

/**
 * 执行一次 AI 任务，记录 job 状态（pending/running/success/failed）。
 */
export async function runJob(
  provider: AIProvider,
  type: AIJobType,
  fn: () => Promise<unknown>,
  documentId?: string
): Promise<unknown> {
  const job: AIJob = {
    id: uuid(),
    documentId,
    type,
    status: "running",
    createdAt: new Date().toISOString()
  };
  await db.aiJobs.add(toPlain(job));
  try {
    const result = await fn();
    await db.aiJobs.update(job.id, {
      status: "success",
      result: toPlain(result),
      completedAt: new Date().toISOString()
    });
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "AI 服务暂时不可用";
    await db.aiJobs.update(job.id, {
      status: "failed",
      errorMessage: msg,
      completedAt: new Date().toISOString()
    });
    throw e;
  }
}

/**
 * 基于问题检索相关资料片段，用于问答上下文构造。
 */
export function buildQaContexts(question: string, docs: Document[], limit = 3) {
  const results = searchDocuments(docs, question);
  return results.slice(0, limit).map((r) => ({
    documentId: r.document.id,
    title: r.document.title,
    excerpt: r.excerpt ?? r.document.content.slice(0, 120)
  }));
}

/**
 * 供页面调用的四个高层封装，统一处理输入长度限制。
 */
export function summarizeDocument(provider: AIProvider, title: string, content: string) {
  return runJob(provider, "summary", () =>
    provider.summarize({ title, content: clampContent(content) })
  );
}

export function answerFromDocuments(
  provider: AIProvider,
  question: string,
  docs: Document[]
) {
  const contexts = buildQaContexts(question, docs);
  return runJob(provider, "qa", () =>
    provider.answerQuestion({ question, contexts })
  );
}

export function extractTasksFromContent(provider: AIProvider, content: string, documentId?: string) {
  return runJob(provider, "actions", () =>
    provider.extractTasks({ content: clampContent(content) })
  , documentId);
}

export function generateCardsFromContent(
  provider: AIProvider,
  content: string,
  count: number,
  documentId?: string,
  onProgress?: (done: number, total: number) => void
) {
  const text = (content ?? "").trim();
  // count=0 表示自动：按篇幅估算知识点数量，避免「几十个知识点只出 3 张」
  const target = count > 0 ? Math.min(count, FLASHCARD_HARD_MAX) : autoCardTarget(text.length);

  return runJob(
    provider,
    "flashcards",
    async () => {
      // 固定小段循环调用：绝不因资料超长而放大单段内容（长输入最容易让模型返回空）
      let chunks = splitIntoChunks(text, FLASHCARD_CHUNK_CHARS);
      if (chunks.length > FLASHCARD_MAX_CHUNKS) {
        // 极端超长（>15 万字）只处理前 60 段，避免上百次请求
        console.warn(
          `[KnowFlow] 资料过长（${text.length} 字），本次只处理前 ${FLASHCARD_MAX_CHUNKS} 段`
        );
        chunks = chunks.slice(0, FLASHCARD_MAX_CHUNKS);
      }
      if (chunks.length <= 1) {
        onProgress?.(1, 1);
        const cards = await generateChunkWithRetry(provider, text, target, 0, { left: FLASHCARD_MAX_CALLS });
        // 单段也要去重/清理，避免模型返回重复或空卡片
        return dedupeCards(cards, target);
      }

      // 每段分摊目标张数，单次最多 8 张（再多容易输出截断或质量下降）
      const perChunk = Math.max(2, Math.ceil(target / chunks.length));
      const all: FlashcardDraft[] = [];
      const budget = { left: FLASHCARD_MAX_CALLS };
      for (let i = 0; i < chunks.length; i++) {
        onProgress?.(i + 1, chunks.length);
        try {
          const cards = await generateChunkWithRetry(provider, chunks[i], Math.min(perChunk, 8), 0, budget);
          all.push(...cards);
        } catch {
          // 某一段彻底失败不拖垮整体：已生成的卡片照常返回
          if (all.length === 0) throw new Error("AI 没有返回可用卡片，请减少卡片数量或缩短资料后重试");
        }
      }
      return dedupeCards(all, target);
    },
    documentId
  );
}

/**
 * 单段生成，失败时自动二分重试。
 * 模型对长输入容易返回空内容或截断的 JSON，把段落拆小、张数减半往往就能成功。
 */
async function generateChunkWithRetry(
  provider: AIProvider,
  content: string,
  count: number,
  depth = 0,
  budget: { left: number } = { left: FLASHCARD_MAX_CALLS }
): Promise<FlashcardDraft[]> {
  try {
    if (budget.left <= 0) throw new Error("请求次数已达上限，请减少卡片数量后重试");
    budget.left -= 1;
    return await provider.generateFlashcards({ content, count });
  } catch (e) {
    // 预算耗尽 / 已到最大重试深度 / 内容本身已经很短，直接抛出
    if (budget.left <= 0 || depth >= 3 || content.length < 600) throw e;

    const parts = splitIntoChunks(content, Math.ceil(content.length / 2)).filter((p) => p.trim());
    if (parts.length <= 1) throw e;

    const perPart = Math.max(2, Math.ceil(count / parts.length));
    const out: FlashcardDraft[] = [];
    let lastError: unknown = e;
    for (const part of parts) {
      try {
        out.push(...(await generateChunkWithRetry(provider, part, perPart, depth + 1, budget)));
      } catch (err) {
        lastError = err;
      }
    }
    if (out.length === 0) throw lastError;
    return out;
  }
}

/** 自动模式的张数估算：约每 500 字一个知识点，5~60 张 */
function autoCardTarget(length: number): number {
  if (length <= 0) return 5;
  return Math.min(FLASHCARD_HARD_MAX, Math.max(5, Math.round(length / 500)));
}

/** 按段落/换行/句号切分，尽量不切断语义 */
function splitIntoChunks(text: string, size: number): string[] {
  if (text.length <= size) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf("\n\n", size);
    if (cut < size * 0.5) cut = rest.lastIndexOf("\n", size);
    if (cut < size * 0.5) cut = rest.lastIndexOf("。", size);
    if (cut < size * 0.5) cut = size;
    if (cut <= 0) cut = size;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest.trim()) chunks.push(rest);
  return chunks;
}

/** 去重 + 清理空卡片，并按目标张数截断 */
function dedupeCards(cards: FlashcardDraft[], limit: number): FlashcardDraft[] {
  const seen = new Set<string>();
  const out: FlashcardDraft[] = [];
  for (const c of cards) {
    const question = (c?.question ?? "").trim();
    const answer = (c?.answer ?? "").trim();
    if (!question || !answer) continue;
    const key = question.toLowerCase().replace(/[\s\p{P}]/gu, "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ question, answer });
  }
  return out.slice(0, limit);
}
