import type { AIProvider } from "@/services/ai/AIProvider";
import type { Document } from "@/types/document";
import {
  summarizeDocument,
  extractTasksFromContent,
  generateCardsFromContent
} from "@/services/ai/aiService";
import { createFlashcard, listFlashcards, type CreateFlashcardInput } from "@/services/flashcardService";
import { createTask, listTasks } from "@/services/taskService";
import { updateDocument } from "@/services/documentService";
import { useDocumentStore } from "@/stores/documentStore";
import {
  DATA_GROUPS,
  buildSectionViews,
  clearAllData,
  clearGroup,
  formatStat,
  groupItemCount,
  statAll,
  type DataGroup
} from "@/services/dataCleanup";
import {
  buildCleanupPrompt,
  isCancel,
  isConfirm,
  isStorageQuery,
  matchCleanupScope,
  resolveCleanupGroups
} from "@/services/companion/dataTools";
import { IS_MINITOOL } from "@/utils/runtime";

/**
 * 小知的「工具调用」：让 AI 判断用户意图（要做什么、对哪份资料做），
 * 前端据此调用对应模块落地。比正则匹配健壮，能处理各种自然说法。
 */

export interface ToolResult {
  handled: boolean;
  reply: string;
}

type ToolName = "flashcards" | "summary" | "tasks" | "stats" | "storage" | "cleanup" | "chat";

interface Intent {
  tool: ToolName;
  /** 目标资料标题（可为空，表示用户没指定，用最新一条） */
  target?: string;
  /** cleanup 专用：清除范围（分组 id / section:xx / all） */
  scope?: string;
}

/** 从文本里找一份资料：四级兜底 */
function findDocument(docStore: ReturnType<typeof useDocumentStore>, text: string): Document | undefined {
  const docs = docStore.documents;
  if (docs.length === 0) return undefined;
  let doc = docs.find((d) => d.title === text);
  if (!doc) doc = docs.find((d) => d.title.includes(text));
  if (!doc) doc = docs.find((d) => d.content.includes(text));
  if (!doc) doc = docs[docs.length - 1];
  return doc;
}

function parseIntent(raw: string): Intent | null {
  try {
    let s = raw.trim().replace(/```(?:json|JSON)?/g, "").trim();
    const firstBrace = s.indexOf("{");
    const firstBracket = s.indexOf("[");
    let start = -1;
    if (firstBrace === -1) start = firstBracket;
    else if (firstBracket === -1) start = firstBrace;
    else start = Math.min(firstBrace, firstBracket);
    if (start < 0) return null;

    // 括号配对截取完整 JSON
    const open = s[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0, inStr = false, escaped = false, end = s.length;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === open) depth++;
      else if (ch === close) { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    s = s.slice(start, end).replace(/,\s*([}\]])/g, "$1");
    const obj = JSON.parse(s);
    const tool = obj?.tool;
    if (
      tool === "flashcards" ||
      tool === "summary" ||
      tool === "tasks" ||
      tool === "stats" ||
      tool === "storage" ||
      tool === "cleanup" ||
      tool === "chat"
    ) {
      return {
        tool,
        target: typeof obj.target === "string" ? obj.target.trim() : undefined,
        scope: typeof obj.scope === "string" ? obj.scope.trim() : undefined
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 用 AI 判断用户意图。返回结构化 Intent；无法判断或失败返回 null。
 */
async function detectIntent(
  provider: AIProvider,
  text: string,
  docs: Document[]
): Promise<Intent | null> {
  const titles = docs.slice(0, 30).map((d) => d.title).join("、");
  const prompt =
    `你是知间 AI 资料管家的意图识别器。根据用户这句话，判断他想做什么，并输出 JSON。\n` +
    `可选 tool 值：\n` +
    `- "flashcards"：用户想把某份资料做成记忆卡片/闪卡\n` +
    `- "summary"：用户想总结、概括、提炼某份资料的重点\n` +
    `- "tasks"：用户想从某份资料提取行动项/任务/待办\n` +
    `- "stats"：用户在询问学习统计，例如有多少张学习卡片、卡片掌握情况、有多少份资料、有多少个待办任务、学习进度如何\n` +
    `- "storage"：用户在问本地存了哪些数据、占多少空间、有多少条本地记录（不是学习统计）\n` +
    `- "cleanup"：用户想清除/删除/清空本地数据（如「把小游戏成绩清掉」「清理背单词进度」）。此时另给 scope 字段，取值只能是：\n` +
    `  content（资料与分类）、cards（卡片与复习进度）、tasks（任务清单）、quest（闯关与复习位置）、\n` +
    `  drill（背单词进度）、games（小游戏成绩）、idiom（成语掌握度）、kitchen（购物清单与计划锁定）、\n` +
    `  prefs（外观与偏好）、ai（AI 配置与记录）、section:learning（全部学习记录）、all（全部本地数据）\n` +
    `- "chat"：以上都不是，只是普通聊天或提问\n` +
    `若命中前三种，尽量从资料标题里找 target（用户指定的资料标题），找不到就省略 target 字段。\n` +
    `只输出 JSON，格式：{"tool":"...","target":"...","scope":"..."}。\n\n` +
    `资料标题列表：${titles || "（空）"}\n` +
    `用户的话：${text}`;

  try {
    const raw = await provider.chat({
      system: "你是一个意图识别器，只输出 JSON，不要输出多余内容。",
      messages: [{ role: "user", content: prompt }]
    });
    return parseIntent(raw);
  } catch {
    return null;
  }
}

/** 正则兜底：AI 不可用或判断失败时，用简单规则识别 */
function fallbackIntent(text: string, groups: DataGroup[]): Intent | null {
  const t = text.trim();
  // 数据清理 / 存储查询：纯本地能力，演示模式下也能用
  const clean = matchCleanupScope(t, groups);
  if (clean) return { tool: "cleanup", scope: clean.scope };
  if (isStorageQuery(t)) return { tool: "storage" };
  if (/卡片|记忆卡|闪卡/.test(t) && /做|生成|制作|弄|变|整理/.test(t)) {
    const m = t.match(/(?:把|给|将)?(.{1,40}?)(?:做|弄|变)成?卡片/);
    return { tool: "flashcards", target: m?.[1]?.trim() || undefined };
  }
  if (/总结|摘要|概括|提炼.*重点|讲.*重点/.test(t)) {
    const m = t.match(/总结(?:一下)?(.{1,40})/);
    return { tool: "summary", target: m?.[1]?.trim() || undefined };
  }
  if (/提取.*(任务|行动|待办)|行动项|待办事项/.test(t)) {
    const m = t.match(/(?:从|把)?(.{1,40}?)(?:提取|里的任务|的任务)/);
    return { tool: "tasks", target: m?.[1]?.trim() || undefined };
  }
  // 统计类：多少/几张/总数 + 卡片|资料|任务，或掌握情况/学习进度
  if (
    /多少|几张|几个|统计|数量|总数|一共|总共/.test(t) &&
    /卡片|记忆卡|闪卡|资料|文档|任务|待办/.test(t)
  ) {
    return { tool: "stats" };
  }
  if (/掌握(情况|程度|进度)|学习进度|复习进度/.test(t)) {
    return { tool: "stats" };
  }
  return null;
}

// ---------------- 数据清理（需二次确认） ----------------

/** 端内没有 AI 相关能力，那一类不参与清理 */
function availableGroups(): DataGroup[] {
  return DATA_GROUPS.filter((g) => !(IS_MINITOOL && g.id === "ai"));
}

interface PendingCleanup {
  label: string;
  groups: DataGroup[];
  counts: string[];
  at: number;
}

/** 待确认的清除请求：模块级即可，超时作废，不落盘 */
let pendingCleanup: PendingCleanup | null = null;
const PENDING_TTL = 2 * 60 * 1000;

/** 测试用：清掉待确认状态 */
export function resetPendingCleanup(): void {
  pendingCleanup = null;
}

async function startCleanup(scope: string | undefined, groups: DataGroup[]): Promise<ToolResult> {
  if (!scope) {
    return {
      handled: true,
      reply:
        "想清哪一类呀？可以说「清掉小游戏成绩」「清理背单词进度」，也可以说「清空所有学习记录」。\n" +
        "我只删你点名的那一类，其它数据不动。"
    };
  }
  const resolved = resolveCleanupGroups(scope, groups);
  if (!resolved) {
    return {
      handled: true,
      reply: "没对上要清哪一类数据。可以到「设置 → 数据管理」看一眼分类，或者直接告诉我清哪一类～"
    };
  }

  const stats = await statAll(resolved.groups);
  const single = resolved.groups.length === 1;
  const counts: string[] = [];
  for (const g of resolved.groups) {
    const st = stats[g.id];
    if (st && !st.empty) {
      // 单类时不再重复一遍名字，避免「（小游戏成绩 小游戏成绩 1 项记录）」
      counts.push(single ? formatStat(g, st) : `${g.label} ${formatStat(g, st)}`);
    }
  }
  if (counts.length === 0) {
    return { handled: true, reply: `「${resolved.label}」本来就是空的，不用清啦～其它数据都还在。` };
  }

  pendingCleanup = { label: resolved.label, groups: resolved.groups, counts, at: Date.now() };
  return { handled: true, reply: buildCleanupPrompt(resolved.label, resolved.groups, counts) };
}

async function executeCleanup(p: PendingCleanup): Promise<ToolResult> {
  const docStore = useDocumentStore();
  const all = availableGroups();
  const isAll = p.groups.length === all.length;
  try {
    if (isAll) {
      await clearAllData(p.groups);
    } else {
      for (const g of p.groups) await clearGroup(g);
    }
    // 资料被清掉时，页面上的列表要立刻变空
    if (p.groups.some((g) => g.tables?.includes("documents") || g.tables?.includes("categories"))) {
      await docStore.loadAll();
    }
  } catch (e: any) {
    return { handled: true, reply: `清除时出了点问题：${e?.message ?? "请稍后再试"}` };
  }
  pendingCleanup = null;
  return {
    handled: true,
    reply: isAll
      ? "都清干净啦，现在是出厂状态。内置的词库、语法、成语和食谱都还在，随时可以重新开始～\n如果以后想反悔，之前导出的备份文件可以再导入回来。"
      : `「${p.label}」已经清掉了，其它数据都还在。内置内容不受影响，随时可以重新开始～`
  };
}

/**
 * 识别并执行工具调用。返回 handled=false 表示未命中工具，走普通聊天。
 */
export async function runCompanionTool(
  provider: AIProvider,
  isMock: boolean,
  text: string
): Promise<ToolResult> {
  const docStore = useDocumentStore();
  // 确保资料已加载（避免 documents 为空导致误判"资料库为空"）
  if (docStore.documents.length === 0) {
    await docStore.loadAll();
  }
  const docs = docStore.documents;
  const groups = availableGroups();

  // 0. 有未确认的清除请求时，先消化「确认 / 取消」
  //    删数据不可撤销，所以只认明确的确认词；说别的就作废，避免误删。
  if (pendingCleanup) {
    if (Date.now() - pendingCleanup.at > PENDING_TTL) {
      pendingCleanup = null;
    } else if (isCancel(text)) {
      pendingCleanup = null;
      return { handled: true, reply: "好，那就不删了～数据原样都在。" };
    } else if (isConfirm(text)) {
      return executeCleanup(pendingCleanup);
    } else {
      pendingCleanup = null;
    }
  }

  // 1. 意图识别：优先用 AI（非 mock），否则用正则兜底
  let intent: Intent | null = null;
  if (!isMock) {
    intent = await detectIntent(provider, text, docs);
  }
  if (!intent) {
    intent = fallbackIntent(text, groups);
  }
  if (!intent || intent.tool === "chat") {
    return { handled: false, reply: "" };
  }

  // 2. 纯本地工具：统计 / 存储查询 / 数据清理（不消耗 AI，演示模式同样可用）
  if (intent.tool === "stats") {
    return { handled: true, reply: await buildStatsReply(docStore) };
  }
  if (intent.tool === "storage") {
    return { handled: true, reply: await buildStorageReply(groups) };
  }
  if (intent.tool === "cleanup") {
    return startCleanup(intent.scope, groups);
  }

  // 3. 需要 AI 的三种工具，在 mock 模式下给出引导
  if (isMock) {
    const names: Record<string, string> = {
      flashcards: "生成卡片",
      summary: "生成摘要",
      tasks: "提取行动项"
    };
    return {
      handled: true,
      reply: `${names[intent.tool]}需要接入真实模型哦。你可以到「设置 → AI 配置」接入模型，或去资料详情页操作。`
    };
  }

  if (docs.length === 0) {
    return { handled: true, reply: "你的资料库还是空的哦，先新增或导入一份资料，我才能帮你处理～" };
  }

  // 3. 定位目标资料
  const doc = intent.target ? findDocument(docStore, intent.target) : docs[docs.length - 1];
  if (!doc) {
    return { handled: true, reply: "没找到对应的资料，告诉我资料标题试试？" };
  }

  // 4. 执行对应工具
  try {
    if (intent.tool === "flashcards") {
      // count=0 让 AI 根据内容自主决定张数
      const cards = (await generateCardsFromContent(provider, doc.content, 0, doc.id)) as { question: string; answer: string }[];
      console.log("[KnowFlow] 生成卡片原始返回：", JSON.stringify(cards).slice(0, 300));
      let saved = 0;
      for (const raw of cards ?? []) {
        // 容错：question/answer 可能是空或字段名差异
        const c = raw as Record<string, unknown>;
        const q = (c?.question ?? c?.q ?? "").toString().trim();
        const a = (c?.answer ?? c?.a ?? "").toString().trim();
        if (!q || !a) continue;
        await createFlashcard({ documentId: doc.id, question: q, answer: a } as CreateFlashcardInput);
        saved++;
      }
      console.log("[KnowFlow] 已保存卡片数：", saved);
      if (saved === 0) {
        return { handled: true, reply: "卡片生成出来了，但内容格式有点问题，没能保存。再试一次看看？" };
      }
      return {
        handled: true,
        reply: `搞定啦！已根据「${doc.title}」生成 ${saved} 张记忆卡片，去「学习中心」就能开始复习了～📚`
      };
    }

    if (intent.tool === "summary") {
      const r = (await summarizeDocument(provider, doc.title, doc.content)) as { summary: string; keyPoints: string[] };
      await updateDocument(doc.id, { summary: r.summary });
      const points = r.keyPoints?.slice(0, 3).map((p) => `· ${p}`).join("\n") ?? "";
      return {
        handled: true,
        reply: `「${doc.title}」的核心结论：\n${r.summary}${points ? `\n\n重点：\n${points}` : ""}\n\n（摘要已保存到该资料）`
      };
    }

    if (intent.tool === "tasks") {
      const tasks = (await extractTasksFromContent(provider, doc.content, doc.id)) as { title: string; priority: string }[];
      if (!tasks?.length) {
        return { handled: true, reply: `「${doc.title}」这份资料里没有可提取的任务或待办哦～换一份含任务记录的资料（比如会议记录、需求文档）试试吧。` };
      }
      let saved = 0;
      for (const task of tasks) {
        if (!task.title) continue;
        await createTask({
          title: task.title,
          sourceDocumentId: doc.id,
          priority: (task.priority as "low" | "medium" | "high") ?? "medium"
        });
        saved++;
      }
      const list = tasks.slice(0, 5).map((x) => `· ${x.title}`).join("\n");
      return {
        handled: true,
        reply: `从「${doc.title}」提取到 ${saved} 个任务，已加入「任务清单」：\n${list}\n\n去任务页就能看到啦～✅`
      };
    }
  } catch (e: any) {
    return { handled: true, reply: `操作时出错了：${e?.message ?? "请稍后再试"}` };
  }

  return { handled: false, reply: "" };
}

/**
 * 生成统计概览回复：卡片数、掌握度分布、资料数、待办任务数。
 * 纯本地查库，不消耗 AI 额度。
 */
async function buildStatsReply(
  docStore: ReturnType<typeof useDocumentStore>
): Promise<string> {
  const [cards, tasks] = await Promise.all([listFlashcards(), listTasks()]);
  const docCount = docStore.documents.length;
  const cardCount = cards.length;

  const unmastered = cards.filter((c) => c.mastery === 0).length;
  const basic = cards.filter((c) => c.mastery === 1).length;
  const mastered = cards.filter((c) => c.mastery === 2).length;
  const pendingTasks = tasks.filter((t) => t.status !== "done").length;

  const lines: string[] = [];

  if (cardCount === 0) {
    lines.push("学习中心现在还没有卡片哦～可以从资料详情页或 AI 工作台生成一些，再回来复习 📚");
  } else {
    lines.push(`学习中心共有 **${cardCount} 张**卡片：`);
    lines.push(`· 不熟悉 ${unmastered} 张`);
    lines.push(`· 基本掌握 ${basic} 张`);
    lines.push(`· 已掌握 ${mastered} 张`);
    const rate = Math.round((mastered / cardCount) * 100);
    lines.push(`掌握率约 ${rate}%`);
  }

  lines.push(`资料库共 ${docCount} 份资料，待办任务 ${pendingTasks} 个。`);
  return lines.join("\n");
}

/**
 * 生成「本地存了什么」的回复：按分区列出有数据的分组。
 * 和小知的数据清理能力配套 —— 先让用户看见，再决定清哪一类。
 */
async function buildStorageReply(groups: DataGroup[]): Promise<string> {
  const stats = await statAll(groups);
  const views = buildSectionViews(groups, stats);
  const total = views.reduce((n, v) => n + v.items, 0);

  if (total === 0) {
    return "本地目前是干净的，一条记录都没有～内置的词库、语法、成语和食谱不算在内，它们是随应用打包的静态内容。";
  }

  const lines: string[] = [`本地一共 **${total} 项**记录：`];
  for (const v of views) {
    const filled = v.groups.filter((g) => stats[g.id] && !stats[g.id].empty);
    if (filled.length === 0) continue;
    lines.push(`\n【${v.title}】`);
    for (const g of filled) {
      lines.push(`· ${g.label}：${formatStat(g, stats[g.id])}`);
    }
  }
  lines.push("\n想清掉哪一类直接说，比如「把小游戏成绩清掉」，我会先跟你确认一次再动手。");
  return lines.join("\n");
}
