import { OpenAICompatibleProvider } from "@/services/ai/OpenAICompatibleProvider";

type Reply = { content: string; finish?: string };

function stubFetch(replies: Reply[]) {
  let i = 0;
  const calls: string[] = [];
  (globalThis as any).fetch = async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    calls.push(body.messages?.[1]?.content ?? "");
    const r = replies[Math.min(i++, replies.length - 1)];
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: r.content }, finish_reason: r.finish ?? "stop" }] })
    };
  };
  return calls;
}

async function main() {
  const provider = new OpenAIAccumulator();

  // 1) 第一次空返回 → 第二次返回「问：… 答：…」纯文本 → 应按行解析成功
  stubFetch([
    { content: "", finish: "stop" },
    { content: "问：什么是定语从句？答：用来修饰名词或代词的从句。\n问：关系代词有哪些？答：who/whom/which/that/whose。" }
  ]);
  let cards = await provider.generateFlashcards({ content: "语法内容", count: 3 });
  console.log("1) 空返回后降级为纯文本 →", cards.length, "张：", JSON.stringify(cards.slice(0, 2)));
  if (cards.length !== 2) throw new Error("按行解析失败");

  // 2) markdown 包裹的 JSON
  stubFetch([{ content: '```json\n[{"question":"Q1","answer":"A1"},{"question":"Q2","answer":"A2"}]\n```' }]);
  cards = await provider.generateFlashcards({ content: "语法内容", count: 2 });
  console.log("2) 代码块 JSON →", cards.length, "张");
  if (cards.length !== 2) throw new Error("代码块 JSON 解析失败");

  // 3) 空白问题/答案要被过滤
  stubFetch([{ content: '[{"question":"Q1","answer":"A1"},{"question":"  ","answer":"x"}]' }]);
  cards = await provider.generateFlashcards({ content: "语法内容", count: 2 });
  console.log("3) 过滤空卡片 →", cards.length, "张");
  if (cards.length !== 1) throw new Error("空卡片未过滤");

  // 4) 三次都空 → 抛出可读错误
  stubFetch([{ content: "" }, { content: "" }, { content: "" }]);
  try {
    await provider.generateFlashcards({ content: "语法内容", count: 3 });
    throw new Error("应当抛错");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("4) 全空时的提示：", msg);
    if (!/为空|未返回可用卡片/.test(msg)) throw new Error("错误提示不明确：" + msg);
  }

  // 5) JSON 越界字符（前后有说明文字）仍能取出
  stubFetch([{ content: '好的，下面是卡片：\n[{"question":"Q1","answer":"A1"}]\n希望有帮助' }]);
  cards = await provider.generateFlashcards({ content: "语法内容", count: 1 });
  console.log("5) 前后带说明文字 →", cards.length, "张");
  if (cards.length !== 1) throw new Error("宽松 JSON 提取失败");

  console.log("PROVIDER SMOKE PASS");
  process.exit(0);
}

// 简单包装，避免与类名冲突
function OpenAIAccumulator() {
  return new OpenAICompatibleProvider("https://example.com/v1", "test-model", "sk-test");
}

main().catch((e) => { console.error("PROVIDER SMOKE FAIL:", e); process.exit(1); });
