/**
 * 小工具构建替身：端内容器不联网，禁止 fetch / XHR，
 * 因此真实模型直连 Provider 在小工具产物中以本文件替换（vite alias）。
 */
import type { AIProvider } from "@/services/ai/AIProvider";
import type {
  SummaryResult,
  SourceContext,
  AnswerResult,
  ExtractedTask,
  FlashcardDraft
} from "@/types/ai";

const MESSAGE = "小工具内不支持联网调用 AI，请使用网页版配置模型";

function unsupported(): never {
  throw new Error(MESSAGE);
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly name = "OpenAICompatibleProvider(minitool-stub)";

  constructor(_baseUrl?: string, _model?: string, _apiKey?: string) {}

  summarize(_input: { title: string; content: string }): Promise<SummaryResult> {
    return unsupported();
  }

  answerQuestion(_input: { question: string; contexts: SourceContext[] }): Promise<AnswerResult> {
    return unsupported();
  }

  extractTasks(_input: { content: string }): Promise<ExtractedTask[]> {
    return unsupported();
  }

  generateFlashcards(_input: { content: string; count: number }): Promise<FlashcardDraft[]> {
    return unsupported();
  }

  chat(_input: {
    system: string;
    messages: { role: "user" | "assistant"; content: string }[];
  }): Promise<string> {
    return unsupported();
  }

  testConnection(): Promise<void> {
    return unsupported();
  }
}
