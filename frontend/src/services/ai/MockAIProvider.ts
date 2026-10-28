import type { AIProvider } from "./AIProvider";
import type {
  SummaryResult,
  SourceContext,
  AnswerResult,
  ExtractedTask,
  FlashcardDraft
} from "@/types/ai";

/**
 * Mock AI Provider：无 API Key 时的确定性演示实现。
 * 基于简单规则/关键词返回可读示例，用于完整演示产品流程。
 * 注意：仅用于演示，不宣称真实智能。
 */
export class MockAIProvider implements AIProvider {
  readonly name = "MockAIProvider";

  async summarize({ title, content }: { title: string; content: string }): Promise<SummaryResult> {
    const sentences = splitSentences(content);
    const first = sentences[0] ?? content.slice(0, 50);
    return {
      summary: `本文围绕「${title}」展开，核心内容为：${first}`,
      keyPoints: sentences.slice(0, 3),
      keywords: this.extractKeywords(content).slice(0, 5)
    };
  }

  async answerQuestion({ question, contexts }: { question: string; contexts: SourceContext[] }): Promise<AnswerResult> {
    if (contexts.length === 0) {
      return {
        answer: "现有资料中没有找到足够依据，无法回答这个问题。",
        sources: [],
        confidence: "low"
      };
    }
    const top = contexts[0];
    // 优先返回与问题关键词最相关的片段
    const matched = this.findBestContext(question, contexts);
    return {
      answer: `根据资料「${matched.title}」：${matched.excerpt}`,
      sources: contexts.slice(0, 3),
      confidence: contexts.length >= 2 ? "medium" : "low"
    };
  }

  async extractTasks({ content }: { content: string }): Promise<ExtractedTask[]> {
    const sentences = splitSentences(content);
    return sentences
      .filter((s) => /完成|提交|跟进|确认|准备|整理|评审|输出|搭建|负责|开发/.test(s))
      .slice(0, 5)
      .map((s) => ({
        title: s.slice(0, 30),
        description: s,
        dueDate: null,
        priority: (/周[一二三四五六日]前|今天|截止|必须|尽快/.test(s) ? "high" : "medium") as "high" | "medium" | "low",
        evidence: s
      }));
  }

  async generateFlashcards({ content, count }: { content: string; count: number }): Promise<FlashcardDraft[]> {
    const sentences = splitSentences(content);
    // count=0 表示"自动"，mock 模式按句子数取（最多 5）
    const n = count > 0 ? count : Math.min(sentences.length, 5);
    return sentences.slice(0, n).map((s) => {
      // 简单规则：尝试用关键词构造问题
      const kw = this.extractKeywords(s)[0] ?? "要点";
      return {
        question: `请简述关于「${kw}」的要点？`,
        answer: s
      };
    });
  }

  async chat(): Promise<string> {
    // Mock 模式下不宣称真实智能，返回固定引导语。
    // 实际对话逻辑由 companionService 的本地规则兜底，不会走到这里。
    return "我现在是演示模式，只能回答关于软件使用的常见问题。接入真实模型后我就能和你自由聊天啦！";
  }

  private extractKeywords(text: string): string[] {
    const words = text.match(/[a-zA-Z\u4e00-\u9fa5]{2,}/g) ?? [];
    const stop = new Set(["这个", "那个", "我们", "他们", "以及", "进行", "一个", "关于"]);
    return [...new Set(words)].filter((w) => !stop.has(w));
  }

  private findBestContext(question: string, contexts: SourceContext[]): SourceContext {
    let best = contexts[0];
    let bestScore = -1;
    for (const c of contexts) {
      const qChars = [...new Set(question.replace(/\s/g, ""))];
      const score = qChars.filter((ch) => c.excerpt.includes(ch)).length;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    return best;
  }
}

function splitSentences(text: string): string[] {
  return text
    .split(/[。！？!?\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
