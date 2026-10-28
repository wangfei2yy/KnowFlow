import { defineStore } from "pinia";
import {
  COMPANION_NAME,
  AFFECTION_REWARDS,
  type CompanionState,
  type ChatMessage
} from "@/services/companion/types";
import { getCompanionReply, encouragement } from "@/services/companion/companionService";
import { runCompanionTool } from "@/services/companion/companionTool";
import { useAIStore } from "@/stores/aiStore";
import { useDocumentStore } from "@/stores/documentStore";

const STORAGE_KEY = "knowflow.companion";

const COMPANION_SYSTEM_PROMPT =
  "你是「小知」，知间 AI 资料管家里的陪伴型学习助手。你的职责是：鼓励用户坚持学习、整理知识，并解答关于软件使用的问题。语气温暖、友好、简短（通常不超过 3 句话），适当使用 emoji。不要编造软件没有的功能。\n" +
  "重要：你具备直接帮用户完成任务的能力。当用户要求「生成卡片」「做卡片」「总结」「提取任务」等操作时，你可以直接执行，绝不要说「我做不到」「我无法直接生成」「你去资料库看看」这类推诿的话——如果系统已经通过工具替你完成了，就确认完成；如果尚未完成，就明确告诉用户你会帮他做，而不是拒绝。\n" +
  "你可以根据用户资料库的概览信息回答「我有哪些资料」之类的问题，但不要臆造概览里不存在的内容。";

function loadState(): CompanionState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { ...defaultState(), ...parsed };
    }
  } catch {
    // ignore
  }
  return defaultState();
}

function defaultState(): CompanionState {
  return {
    enabled: true,
    name: COMPANION_NAME,
    affection: 0,
    level: 0,
    activityCount: 0,
    firstMetAt: new Date().toISOString(),
    lastActiveAt: new Date().toISOString(),
    avatarUrl: "",
    messages: [
      {
        role: "bot",
        text: "你好呀，我是小知，你的学习陪伴助手！我会在你使用软件时给你鼓励，也能帮你解答软件怎么用。有什么想问的吗？",
        at: new Date().toISOString()
      }
    ]
  };
}

export type RewardKey = keyof typeof AFFECTION_REWARDS;

export const useCompanionStore = defineStore("companion", {
  state: () => ({
    companion: loadState() as CompanionState,
    // 待展示的鼓励气泡
    bubble: { visible: false, text: "" }
  }),
  getters: {
    enabled: (s) => s.companion.enabled,
    affection: (s) => s.companion.affection,
    messages: (s) => s.companion.messages
  },
  actions: {
    persist() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.companion));
      } catch {
        // ignore
      }
    },
    toggle() {
      this.companion.enabled = !this.companion.enabled;
      this.persist();
    },
    setEnabled(v: boolean) {
      this.companion.enabled = v;
      this.persist();
    },
    setAvatar(url: string) {
      this.companion.avatarUrl = url;
      this.persist();
    },
    clearAvatar() {
      this.companion.avatarUrl = "";
      this.persist();
    },
    // 记录一次行为，增加好感度并可能触发鼓励
    addAffection(key: RewardKey, customText?: string) {
      if (!this.companion.enabled) return;
      const gain = AFFECTION_REWARDS[key];
      this.companion.affection += gain;
      this.companion.activityCount += 1;
      this.companion.lastActiveAt = new Date().toISOString();
      this.persist();
      // 达到新等级时给出特别提示
      // 通过 bubble 展示鼓励
      if (customText) {
        this.showBubble(customText);
      }
    },
    showBubble(text: string) {
      if (!this.companion.enabled) return;
      this.bubble = { visible: true, text };
      setTimeout(() => {
        this.bubble.visible = false;
      }, 4000);
    },
    // 用户发送消息
    async sendMessage(text: string) {
      const trimmed = text.trim();
      if (!trimmed) return;
      const userMsg: ChatMessage = { role: "user", text: trimmed, at: new Date().toISOString() };
      this.companion.messages.push(userMsg);

      let reply: string;
      const aiStore = useAIStore();

      // 1. 先尝试「工具调用」：识别生成卡片/摘要/提取任务等意图，直接落地
      const tool = await runCompanionTool(aiStore.provider, aiStore.isMock, trimmed);
      if (tool.handled) {
        reply = tool.reply;
      } else if (!aiStore.isMock) {
        // 2. 接入真实模型时用 AI 回答
        reply = await this.aiReply(trimmed);
      } else {
        // 3. 本地规则（FAQ + 鼓励 + 资料库问答）
        reply = this.localReply(trimmed);
      }

      const botMsg: ChatMessage = { role: "bot", text: reply, at: new Date().toISOString() };
      this.companion.messages.push(botMsg);
      this.addAffection("chat");
      // 限制历史长度
      if (this.companion.messages.length > 100) {
        this.companion.messages = this.companion.messages.slice(-100);
      }
      this.persist();
    },

    // 用真实 AI 生成回复；失败时降级到本地规则
    async aiReply(text: string): Promise<string> {
      const aiStore = useAIStore();
      try {
        // 取最近若干条对话作为上下文（不含刚插入的 user 消息，最多 10 条）
        const history = this.companion.messages
          .slice(-11, -1)
          .map((m) => ({
            role: m.role === "user" ? ("user" as const) : ("assistant" as const),
            content: m.text
          }));

        // 注入资料库概览，让 AI 能回答「资料库有哪些资料」等问题
        const docStore = useDocumentStore();
        const libraryContext = buildLibraryContext(docStore);

        const answer = await aiStore.provider.chat({
          system: COMPANION_SYSTEM_PROMPT,
          messages: [
            ...history,
            { role: "user" as const, content: `[你的资料库概览]：\n${libraryContext}` },
            { role: "assistant" as const, content: "收到，我会基于你的资料库概览来回答。" },
            { role: "user" as const, content: text }
          ]
        });
        return answer?.trim() || "我在呢，你想聊点什么？";
      } catch (e) {
        console.warn("[KnowFlow] 小知 AI 回复失败，降级本地规则：", e);
        return this.localReply(text);
      }
    },

    // 本地规则回复（未接 AI 或 AI 失败时）：资料库问答 + FAQ + 鼓励
    localReply(text: string): string {
      // 资料库相关提问，用本地生成的列表回答
      if (/资料库.*(哪些|什么|多少)|有哪些资料|我的资料|资料库有/.test(text)) {
        const docStore = useDocumentStore();
        return buildLibraryContext(docStore);
      }
      return getCompanionReply(text, this.companion);
    },

    // 主动鼓励（用户点击时）
    cheerUp() {
      const text = encouragement(this.companion);
      this.companion.messages.push({ role: "bot", text, at: new Date().toISOString() });
      this.persist();
    }
  }
});

/**
 * 构建资料库概览文本，注入给 AI 上下文。
 * 只提供标题/分类/标签/摘要等轻量信息，不塞全文，避免上下文过大。
 */
function buildLibraryContext(docStore: ReturnType<typeof useDocumentStore>): string {
  const docs = docStore.documents;
  if (docs.length === 0) {
    return "（当前资料库为空，还没有任何资料）";
  }
  const catName = (id?: string) => docStore.categories.find((c) => c.id === id)?.name ?? "未分类";
  const lines = docs.slice(0, 50).map((d, i) => {
    const tags = d.tags?.length ? ` [标签:${d.tags.join("/")}]` : "";
    const summary = d.summary ? ` | 摘要:${d.summary.slice(0, 40)}` : "";
    return `${i + 1}. ${d.title}（分类:${catName(d.categoryId)}）${tags}${summary}`;
  });
  const more = docs.length > 50 ? `\n… 以及另外 ${docs.length - 50} 份资料（略）` : "";
  return `共 ${docs.length} 份资料：\n${lines.join("\n")}${more}`;
}
