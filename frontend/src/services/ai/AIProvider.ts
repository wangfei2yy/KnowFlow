import type {
  SummaryResult,
  SourceContext,
  AnswerResult,
  ExtractedTask,
  FlashcardDraft
} from "@/types/ai";

/**
 * 统一 AI Provider 接口。
 * 所有 AI 调用一律通过此接口，禁止在页面组件中直接 fetch 模型 API。
 */
export interface AIProvider {
  readonly name: string;
  summarize(input: { title: string; content: string }): Promise<SummaryResult>;
  answerQuestion(input: { question: string; contexts: SourceContext[] }): Promise<AnswerResult>;
  extractTasks(input: { content: string }): Promise<ExtractedTask[]>;
  /**
   * 生成卡片。
   * @param options.signal 取消信号：卡片生成可能发起多次请求，用户可中途取消
   */
  generateFlashcards(
    input: { content: string; count: number },
    options?: { signal?: AbortSignal }
  ): Promise<FlashcardDraft[]>;
  /**
   * 通用对话：给一个系统提示词 + 对话历史，返回文本回复。
   * 用于陪伴机器人等自由对话场景。
   */
  chat(input: { system: string; messages: { role: "user" | "assistant"; content: string }[] }): Promise<string>;
}
