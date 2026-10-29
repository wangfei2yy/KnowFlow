import type { AIProvider } from "./AIProvider";
import type {
  SummaryResult,
  SourceContext,
  AnswerResult,
  ExtractedTask,
  FlashcardDraft
} from "@/types/ai";

/**
 * OpenAI 兼容 Provider：调用后端代理，或直接调用兼容 OpenAI 的服务。
 *
 * 两种使用方式：
 * 1. 传 apiKey（BYOK）：浏览器直接请求 baseUrl，Key 只在本机浏览器内存/localStorage，
 *    不会上传到任何服务器。适合个人自用、无后端部署的场景。
 * 2. 不传 apiKey：请求发往后端代理（baseUrl 指向 FastAPI），由服务端保管密钥。
 *    适合面向公众的生产环境。
 */
export class OpenAICompatibleProvider implements AIProvider {
  readonly name = "OpenAICompatibleProvider";

  constructor(
    private baseUrl: string,
    private model: string,
    private apiKey?: string
  ) {}

  /** 规范化 baseUrl：去掉末尾斜杠，并兼容只填到域名/版本的情况 */
  private endpoint(): string {
    const base = this.baseUrl.trim().replace(/\/+$/, "");
    return `${base}/chat/completions`;
  }

  private async chatRaw(
    messages: { role: string; content: string }[],
    maxTokens?: number,
    signal?: AbortSignal
  ): Promise<string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    const body: Record<string, unknown> = { model: this.model, messages, temperature: 0.3 };
    // 卡片类任务输出较长，显式提高上限，避免模型提前截断只给前几张
    if (maxTokens && maxTokens > 0) body.max_tokens = maxTokens;
    const res = await fetch(this.endpoint(), {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal
    });
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error("API Key 无效或已过期，请检查设置中的密钥");
      }
      if (res.status === 403) {
        throw new Error("无访问权限（403），该 Key 可能未开通此模型或地区受限");
      }
      if (res.status === 429) {
        throw new Error("请求过于频繁或额度不足，请稍后再试");
      }
      throw new Error(`AI 请求失败（${res.status}），请检查服务地址与模型名`);
    }
    const data = await res.json();
    const choice = data?.choices?.[0];
    const content: string = choice?.message?.content ?? "";
    const finishReason: string | undefined = choice?.finish_reason;

    if (!content.trim()) {
      if (finishReason === "length") {
        // 输出上限被用尽：内容还没生成完就截断了
        throw new Error("AI 输出被截断（达到输出上限），请减少卡片数量，或换用输出上限更大的模型");
      }
      if (finishReason === "content_filter") {
        throw new Error("内容被服务商安全策略拦截，请检查资料内容或更换服务商");
      }
      throw new Error("AI 返回为空，请重试；若持续出现，可减少卡片数量或换用更稳定的模型");
    }
    return content;
  }

  /**
   * 测试连接：用最小请求验证 baseUrl + model + apiKey 是否可用。
   * 成功返回 true；失败抛出带具体原因的 Error。
   */
  async testConnection(): Promise<boolean> {
    // 先做本地前置校验，避免无意义的网络请求
    if (!this.baseUrl.trim()) {
      throw new Error("服务地址不能为空");
    }
    if (!this.model.trim()) {
      throw new Error("模型名不能为空");
    }
    if (!this.apiKey) {
      throw new Error("未填写 API Key");
    }
    try {
      await this.chatRaw([{ role: "user", content: "ping" }]);
      return true;
    } catch (e: any) {
      // 网络层错误单独提示
      if (e?.name === "TypeError" || /fetch|network|Failed to fetch/i.test(e?.message ?? "")) {
        throw new Error("无法连接到服务地址，请检查地址是否正确、是否可访问");
      }
      throw e;
    }
  }

  async summarize({ title, content }: { title: string; content: string }): Promise<SummaryResult> {
    const raw = await this.chatRaw([
      { role: "system", content: "你是资料整理助手。你必须只输出一个 JSON 对象，不要输出任何其他文字，格式：{\"summary\":\"...\",\"keyPoints\":[\"...\"],\"keywords\":[\"...\"]}" },
      { role: "user", content: `标题：${title}\n正文：${content}` }
    ]);
    return parseJSON<SummaryResult>(raw);
  }

  async answerQuestion({ question, contexts }: { question: string; contexts: SourceContext[] }): Promise<AnswerResult> {
    const ctx = contexts
      .map((c) => `[${c.documentId}] ${c.title}：${c.excerpt}`)
      .join("\n---\n");
    const raw = await this.chatRaw([
      { role: "system", content: "仅根据给定资料回答，引用资料 ID；无依据时明确说明。你必须只输出一个 JSON 对象，格式：{\"answer\":\"...\",\"sources\":[{\"documentId\":\"...\",\"title\":\"...\",\"excerpt\":\"...\"}],\"confidence\":\"low|medium|high\"}" },
      { role: "user", content: `资料：\n${ctx}\n\n问题：${question}` }
    ]);
    return parseJSON<AnswerResult>(raw);
  }

  async extractTasks({ content }: { content: string }): Promise<ExtractedTask[]> {
    const raw = await this.chatRaw([
      { role: "system", content: "你是任务提取助手。从文本中提取「明确存在的、可执行的任务或待办事项」（如：完成某件事、跟进某事、提交某物、开发某功能等）。如果文本中没有任何任务，就输出空数组 []。你必须只输出一个 JSON 数组，不要输出任何其他文字，格式：[{\"title\":\"...\",\"description\":\"...\",\"dueDate\":null,\"priority\":\"low|medium|high\",\"evidence\":\"...\"}]" },
      { role: "user", content }
    ]);
    return parseJSONArray<ExtractedTask>(raw);
  }

  async generateFlashcards(
    { content, count }: { content: string; count: number },
    options: { signal?: AbortSignal } = {}
  ): Promise<FlashcardDraft[]> {
    const want = count > 0 ? count : 8;
    const countHint =
      count > 0
        ? `请生成 ${count} 张卡片。`
        : "请根据内容的信息量和要点数量，自行决定生成几张卡片（建议 3~8 张）。";

    const strictPrompt =
      `${countHint}\n` +
      "要求：\n" +
      "1. 覆盖这段内容的全部知识点，不要只提取开头部分；\n" +
      "2. 每个知识点一张卡片，一张卡片只考一个点，避免重复；\n" +
      "3. 问题要具体（能用一句话回答），答案准确完整，涉及语法/用法时可附简短例句；\n" +
      `4. 数组元素个数尽量接近 ${want} 张。\n` +
      `内容如下：\n${content}`;

    // 三级降级：完整提示 → 简化提示（更少张数）→ 逐行文本格式（不要求 JSON）
    const attempts: { system: string; user: string; maxTokens: number; expectJson: boolean }[] = [
      {
        system:
          "你是学习卡片生成器。你必须只输出一个 JSON 数组，不要输出任何其他文字，格式：[{\"question\":\"...\",\"answer\":\"...\"}]",
        user: strictPrompt,
        maxTokens: Math.min(8000, Math.max(2000, want * 300)),
        expectJson: true
      },
      {
        system: "你是学习卡片生成器。只输出 JSON 数组，不要解释。",
        user:
          `生成 ${Math.min(want, 4)} 张卡片，只覆盖最关键的知识点。` +
          `格式严格为：[{"question":"问题","answer":"答案"}]\n内容：\n${content}`,
        maxTokens: 1500,
        expectJson: true
      },
      {
        system: "你是学习卡片生成器。按指定格式逐行输出，不要输出任何解释或编号说明。",
        user:
          `请从下面的内容中提取 ${Math.min(want, 4)} 个知识点，` +
          "每行一条，格式为：问题 ||| 答案（不要输出 JSON、不要多余空行）\n" +
          `内容：\n${content}`,
        // 纯文本输出更省 token，也更不容易被截断
        maxTokens: 1200,
        expectJson: false
      }
    ];

    let lastError: unknown = null;
    for (const attempt of attempts) {
      if (options.signal?.aborted) throw new DOMException("已取消", "AbortError");
      try {
        const raw = await this.chatRaw(
          [
            { role: "system", content: attempt.system },
            { role: "user", content: attempt.user }
          ],
          attempt.maxTokens,
          options.signal
        );
        const cards = attempt.expectJson ? parseCardsLoose(raw) : parseDelimitedCards(raw);
        if (cards.length > 0) return cards;
        lastError = new Error("AI 未返回可用卡片");
      } catch (e) {
        // 取消不是失败：直接抛出，由上层保留已生成结果
        if (e instanceof DOMException && e.name === "AbortError") throw e;
        lastError = e;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("AI 没有返回可用卡片");
  }

  async chat({ system, messages }: { system: string; messages: { role: "user" | "assistant"; content: string }[] }): Promise<string> {
    const msgs = [
      { role: "system", content: system },
      ...messages.map((m) => ({ role: m.role, content: m.content }))
    ];
    return this.chatRaw(msgs);
  }
}

/**
 * 解析卡片：先按 JSON 数组解析；失败则退回「按行解析」，
 * 兼容模型偶尔不按格式输出（如 问：xxx 答：yyy / 一行一张卡）。
 */
function parseCardsLoose(raw: string): FlashcardDraft[] {
  try {
    const arr = parseJSONArray<FlashcardDraft>(raw);
    const cleaned = arr
      .map((c) => ({ question: (c?.question ?? "").trim(), answer: (c?.answer ?? "").trim() }))
      .filter((c) => c.question && c.answer);
    if (cleaned.length > 0) return cleaned;
  } catch {
    /* 落到按行解析 */
  }
  return parseDelimitedCards(raw);
}

/** 逐行解析：支持 `问题 ||| 答案`、`问：… 答：…`、`Q: … A: …` 等常见退化格式 */
function parseDelimitedCards(raw: string): FlashcardDraft[] {
  const out: FlashcardDraft[] = [];
  const lines = (raw ?? "").split(/\r?\n+/);
  for (const line of lines) {
    const text = line.replace(/^[-*\d.、\s]+/, "").trim();
    if (!text) continue;

    const parts = text.split(/\s*\|\|\|\s*|\t+/);
    if (parts.length >= 2) {
      const question = parts[0].replace(/^(问|Q|问题)[:：]\s*/i, "").trim();
      const answer = parts.slice(1).join(" ").replace(/^(答|A|答案)[:：]\s*/i, "").trim();
      if (question && answer) out.push({ question, answer });
      continue;
    }

    const m = text.match(/^(?:问|Q|问题)[:：]\s*(.+?)\s*(?:答|A|答案)[:：]\s*(.+)$/i);
    if (m) {
      const question = m[1].trim();
      const answer = m[2].trim();
      if (question && answer) out.push({ question, answer });
    }
  }
  return out;
}

/**
 * 健壮地从 AI 返回的文本中提取 JSON。
 * 处理各种脏输出：markdown 代码块、前后说明文字、多余括号、尾随逗号等。
 */
function parseJSON<T>(raw: string): T {
  if (!raw) throw new Error("AI 返回为空");
  let s = raw.trim();

  // 1. 去掉 markdown 代码块围栏
  s = s.replace(/```(?:json|JSON)?/g, "").trim();

  // 2. 找到第一个 { 或 [ 作为起点
  const firstBrace = s.indexOf("{");
  const firstBracket = s.indexOf("[");
  let start = -1;
  if (firstBrace === -1) start = firstBracket;
  else if (firstBracket === -1) start = firstBrace;
  else start = Math.min(firstBrace, firstBracket);
  if (start < 0) throw new Error("未找到 JSON 内容");

  // 3. 从起点做括号配对，截取完整的 JSON 片段
  s = extractBalanced(s, start);

  // 4. 清理常见非法字符：尾随逗号、注释
  s = s.replace(/,\s*([}\]])/g, "$1").replace(/\/\/[^\n]*/g, "");

  try {
    return JSON.parse(s) as T;
  } catch {
    // 5. 再尝试：如果是 {..., "xxx":[...]} 外层包裹，取数组/对象值兜底
    // 已经失败则抛出
    throw new Error("AI 返回格式异常，请重试");
  }
}

/**
 * 解析 AI 返回的「数组型」JSON。
 * 兼容两种返回：直接数组 `[...]`，或对象包裹 `{"cards":[...]}` / `{"items":[...]}` / `{"tasks":[...]}`。
 */
function parseJSONArray<T>(raw: string): T[] {
  const parsed = parseJSON<unknown>(raw);
  if (Array.isArray(parsed)) return parsed as T[];
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["cards", "items", "tasks", "flashcards", "questions", "list"]) {
      const v = obj[key];
      if (Array.isArray(v)) return v as T[];
    }
    // 也检查任意值是数组的情况
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) return v as T[];
    }
  }
  throw new Error("AI 返回格式异常，请重试");
}

/** 从 start 位置开始，按括号配对截取一段平衡的 JSON 字符串 */
function extractBalanced(s: string, start: number): string {
  const open = s[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        return s.slice(start, i + 1);
      }
    }
  }
  return s.slice(start);
}
