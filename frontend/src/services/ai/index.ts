import { MockAIProvider } from "./MockAIProvider";
// 用 "@" 别名引入：小工具构建需要按路径整体替换为不联网的替身实现
import { OpenAICompatibleProvider } from "@/services/ai/OpenAICompatibleProvider";
import type { AIProvider } from "./AIProvider";

export interface AIProviderConfig {
  mode: "mock" | "openai";
  /** 服务地址：后端代理地址，或兼容 OpenAI 的官方/第三方 API 地址 */
  baseUrl?: string;
  model?: string;
  /**
   * 语音转写模型（可选，默认 whisper-1）。
   * 部分服务商使用 FunAudioLLM/SenseVoiceSmall 等命名，需按服务商文档填写。
   */
  speechModel?: string;
  /**
   * 用户自备 API Key（BYOK）。
   * - 有值：浏览器直接调用 baseUrl，Key 仅存在本机 localStorage，不上传服务器。
   * - 无值：请求发往后端代理，由服务端持有 Key（推荐用于生产环境）。
   */
  apiKey?: string;
}

/**
 * 根据配置创建 Provider。默认 mock。
 */
export function createProvider(config: AIProviderConfig): AIProvider {
  if (config.mode === "openai" && config.baseUrl) {
    return new OpenAICompatibleProvider(
      config.baseUrl,
      config.model ?? "gpt-4o-mini",
      config.apiKey
    );
  }
  return new MockAIProvider();
}
