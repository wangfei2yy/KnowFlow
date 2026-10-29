<script setup lang="ts">
import { ref, computed, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useDocumentStore } from "@/stores/documentStore";
import { useTaskStore } from "@/stores/taskStore";
import { useAIStore } from "@/stores/aiStore";
import { useAppStore } from "@/stores/appStore";
import EmptyState from "@/components/EmptyState.vue";
import {
  summarizeDocument,
  answerFromDocuments,
  extractTasksFromContent,
  generateCardsFromContent,
  estimateCards,
  CanceledError
} from "@/services/ai/aiService";
import { createFlashcard } from "@/services/flashcardService";
import type { SummaryResult, AnswerResult, ExtractedTask, FlashcardDraft } from "@/types/ai";
import type { Document } from "@/types/document";
import { Loader2, Sparkles, MessageCircleQuestion, ListTodo, Layers, FileText } from "lucide-vue-next";

const router = useRouter();
const route = useRoute();
const docStore = useDocumentStore();
const taskStore = useTaskStore();
const aiStore = useAIStore();
const appStore = useAppStore();

type Tab = "summary" | "qa" | "tasks" | "cards";
const activeTab = ref<Tab>("qa");

const tabs: { key: Tab; label: string; icon: any }[] = [
  { key: "qa", label: "资料问答", icon: MessageCircleQuestion },
  { key: "summary", label: "生成摘要", icon: Sparkles },
  { key: "tasks", label: "提取行动项", icon: ListTodo },
  { key: "cards", label: "生成卡片", icon: Layers }
];

// 目标资料选择
const selectedDocId = ref("");
const selectedDoc = computed(() => docStore.documents.find((d) => d.id === selectedDocId.value));

// 问答
const question = ref("");
const qaResult = ref<AnswerResult | null>(null);

// 摘要
const summaryResult = ref<SummaryResult | null>(null);

// 行动项
const extractedTasks = ref<ExtractedTask[]>([]);

// 卡片
const cardCount = ref(0);
const cardProgress = ref("");
/** 卡片生成的取消控制器 */
let cardAbort: AbortController | null = null;

/** 生成前预估：段数 / 张数 / 请求次数 */
const cardEstimate = computed(() => {
  const doc = selectedDoc.value;
  if (!doc) return null;
  return estimateCards(doc.content?.length ?? 0, cardCount.value);
});
const cardDrafts = ref<FlashcardDraft[]>([]);

const loading = ref(false);
const errorMsg = ref("");

onMounted(async () => {
  await docStore.loadAll();
  await taskStore.load();
  // 从 query 参数恢复目标资料与 Tab（详情页跳转）
  const qDoc = route.query.doc as string | undefined;
  const qTab = route.query.tab as Tab | undefined;
  if (qDoc && docStore.documents.some((d) => d.id === qDoc)) {
    selectedDocId.value = qDoc;
  } else if (docStore.documents.length > 0) {
    selectedDocId.value = docStore.documents[0].id;
  }
  if (qTab && tabs.some((t) => t.key === qTab)) {
    activeTab.value = qTab;
  }
});

function resetResults() {
  qaResult.value = null;
  summaryResult.value = null;
  extractedTasks.value = [];
  cardDrafts.value = [];
  errorMsg.value = "";
}

function switchTab(t: Tab) {
  activeTab.value = t;
  resetResults();
}

function requireDoc(): Document | null {
  if (!selectedDoc.value) {
    appStore.showToast("请先选择一份资料", "error");
    return null;
  }
  return selectedDoc.value;
}

async function runSummary() {
  const doc = requireDoc();
  if (!doc) return;
  loading.value = true;
  errorMsg.value = "";
  try {
    summaryResult.value = (await summarizeDocument(aiStore.provider, doc.title, doc.content)) as SummaryResult;
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : "AI 服务暂时不可用";
  } finally {
    loading.value = false;
  }
}

async function runQA() {
  if (!question.value.trim()) {
    appStore.showToast("请输入问题", "error");
    return;
  }
  loading.value = true;
  errorMsg.value = "";
  try {
    qaResult.value = (await answerFromDocuments(aiStore.provider, question.value, docStore.documents)) as AnswerResult;
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : "AI 服务暂时不可用";
  } finally {
    loading.value = false;
  }
}

async function runExtract() {
  const doc = requireDoc();
  if (!doc) return;
  loading.value = true;
  errorMsg.value = "";
  try {
    extractedTasks.value = (await extractTasksFromContent(aiStore.provider, doc.content, doc.id)) as ExtractedTask[];
    if (extractedTasks.value.length === 0) {
      appStore.showToast("这份资料里没有可提取的任务或待办", "info");
    }
  } catch (e) {
    errorMsg.value = e instanceof Error ? e.message : "AI 服务暂时不可用";
  } finally {
    loading.value = false;
  }
}

async function runCards() {
  const doc = requireDoc();
  if (!doc) return;
  loading.value = true;
  errorMsg.value = "";
  cardProgress.value = "";
  cardAbort = new AbortController();

  try {
    cardDrafts.value = (await generateCardsFromContent(
      aiStore.provider,
      doc.content,
      cardCount.value,
      doc.id,
      (done, total) => {
        cardProgress.value =
          total > 1 ? `已处理 ${done}/${total} 段 · 已生成 ${cardDrafts.value.length} 张` : "";
      },
      { signal: cardAbort.signal }
    )) as FlashcardDraft[];
  } catch (e) {
    if (e instanceof CanceledError) {
      cardDrafts.value = e.partial;
      appStore.showToast(
        e.partial.length > 0 ? `已取消，保留前 ${e.partial.length} 张` : "已取消生成",
        "info"
      );
    } else {
      errorMsg.value = e instanceof Error ? e.message : "AI 服务暂时不可用";
    }
  } finally {
    loading.value = false;
    cardAbort = null;
    cardProgress.value = "";
  }
}

/** 取消正在进行的卡片生成（保留已生成部分） */
function cancelCards() {
  cardAbort?.abort();
}

// 确认写入操作
async function saveSummary() {
  const doc = selectedDoc.value;
  if (!doc || !summaryResult.value) return;
  await docStore.update(doc.id, {
    summary: summaryResult.value.summary,
    keywords: summaryResult.value.keywords
  });
  appStore.showToast("摘要已保存到资料", "success");
  summaryResult.value = null;
}

async function saveTasks() {
  const doc = selectedDoc.value;
  if (!doc) return;
  let saved = 0;
  for (const t of extractedTasks.value) {
    if (!t.title.trim()) continue;
    await taskStore.create({
      title: t.title,
      description: t.description,
      sourceDocumentId: doc.id,
      priority: t.priority,
      dueDate: t.dueDate ?? undefined
    });
    saved++;
  }
  appStore.showToast(`已创建 ${saved} 个任务`, "success");
  extractedTasks.value = [];
}

async function saveCards() {
  const doc = selectedDoc.value;
  if (!doc) return;
  let saved = 0;
  for (const c of cardDrafts.value) {
    if (!c.question.trim() || !c.answer.trim()) continue;
    await createFlashcard({ documentId: doc.id, question: c.question, answer: c.answer });
    saved++;
  }
  appStore.showToast(`已创建 ${saved} 张卡片`, "success");
  cardDrafts.value = [];
}

function gotoDoc(id: string) {
  router.push(`/library/${id}`);
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <div class="mb-5">
      <h1 class="text-2xl font-bold text-slate-900">AI 工作台</h1>
      <p class="mt-1 text-sm text-slate-500">
        让 AI 帮你理解资料：生成摘要、回答问题、提取行动项、制作记忆卡片。
        <span v-if="aiStore.isMock" class="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-400">演示模式</span>
      </p>
    </div>

    <!-- 资料选择 -->
    <div class="mb-5">
      <label class="mb-1.5 block text-sm font-medium text-slate-700">选择资料</label>
      <select v-model="selectedDocId" class="input-base max-w-md" @change="resetResults">
        <option value="" disabled>请选择一份资料</option>
        <option v-for="d in docStore.documents" :key="d.id" :value="d.id">{{ d.title }}</option>
      </select>
    </div>

    <EmptyState
      v-if="docStore.documents.length === 0"
      title="还没有资料"
      description="AI 需要基于你保存的资料工作，请先新增或加载示例资料。"
    >
      <button class="btn-primary" @click="docStore.loadExamples">加载示例资料</button>
    </EmptyState>

    <template v-else>
      <!-- Tab 切换 -->
      <div class="mb-5 flex gap-1 border-b border-slate-100">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium transition"
          :class="activeTab === t.key ? 'text-brand-600' : 'text-slate-500 hover:text-slate-700'"
          @click="switchTab(t.key)"
        >
          <component :is="t.icon" :size="16" />
          {{ t.label }}
          <span v-if="activeTab === t.key" class="absolute inset-x-2 bottom-0 h-0.5 rounded bg-brand-600"></span>
        </button>
      </div>

      <!-- 加载状态 -->
      <div v-if="loading" class="card flex items-center justify-center gap-2 p-8 text-slate-500">
        <Loader2 :size="18" class="animate-spin text-brand-500" /> AI 处理中…
      </div>

      <!-- 错误提示 -->
      <div v-else-if="errorMsg" class="card border-red-100 p-5 text-sm text-red-600">
        {{ errorMsg }}
      </div>

      <!-- 资料问答 -->
      <div v-else-if="activeTab === 'qa'">
        <div class="card p-5">
          <textarea
            v-model="question"
            rows="2"
            class="input-base resize-none"
            placeholder="基于你的资料提问，例如：本周需要完成哪些任务？"
          ></textarea>
          <div class="mt-3 flex justify-end">
            <button class="btn-primary" :disabled="loading" @click="runQA">
              <MessageCircleQuestion :size="16" /> 提问
            </button>
          </div>
        </div>

        <div v-if="qaResult" class="card mt-4 p-5">
          <div class="text-sm leading-relaxed text-slate-700">{{ qaResult.answer }}</div>
          <div v-if="qaResult.sources.length > 0" class="mt-4 border-t border-slate-100 pt-3">
            <div class="mb-2 text-xs font-medium text-slate-400">来源引用</div>
            <div v-for="s in qaResult.sources" :key="s.documentId" class="mb-2">
              <button class="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700" @click="gotoDoc(s.documentId)">
                <FileText :size="14" /> {{ s.title }}
              </button>
              <p class="mt-1 rounded bg-slate-50 px-3 py-2 text-xs text-slate-500">{{ s.excerpt }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 生成摘要 -->
      <div v-else-if="activeTab === 'summary'">
        <div class="flex justify-end">
          <button class="btn-primary" :disabled="loading" @click="runSummary">
            <Sparkles :size="16" /> 生成摘要
          </button>
        </div>
        <div v-if="summaryResult" class="card mt-4 p-5">
          <div class="mb-2 text-sm font-medium text-slate-700">摘要</div>
          <p class="text-sm leading-relaxed text-slate-700">{{ summaryResult.summary }}</p>
          <div v-if="summaryResult.keyPoints.length" class="mt-4">
            <div class="mb-2 text-xs font-medium text-slate-400">重点</div>
            <ul class="space-y-1">
              <li v-for="(k, i) in summaryResult.keyPoints" :key="i" class="flex gap-2 text-sm text-slate-600">
                <span class="text-brand-500">•</span>{{ k }}
              </li>
            </ul>
          </div>
          <div v-if="summaryResult.keywords.length" class="mt-4 flex flex-wrap gap-1.5">
            <span v-for="k in summaryResult.keywords" :key="k" class="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-600">{{ k }}</span>
          </div>
          <div class="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button class="btn-secondary" @click="summaryResult = null">丢弃</button>
            <button class="btn-primary" @click="saveSummary">保存到资料</button>
          </div>
        </div>
      </div>

      <!-- 提取行动项 -->
      <div v-else-if="activeTab === 'tasks'">
        <div class="flex justify-end">
          <button class="btn-primary" :disabled="loading" @click="runExtract">
            <ListTodo :size="16" /> 提取行动项
          </button>
        </div>
        <div v-if="extractedTasks.length > 0" class="card mt-4 p-5">
          <div class="mb-3 text-sm font-medium text-slate-700">识别到的任务（请确认后保存）</div>
          <div class="space-y-3">
            <div v-for="(t, i) in extractedTasks" :key="i" class="rounded-lg border border-slate-100 p-3">
              <input v-model="t.title" type="text" class="input-base" />
              <div class="mt-2 flex items-center gap-2 text-xs text-slate-400">
                <span class="rounded px-1.5 py-0.5" :class="t.priority === 'high' ? 'bg-red-50 text-red-600' : t.priority === 'low' ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-600'">
                  {{ t.priority === 'high' ? '高' : t.priority === 'low' ? '低' : '中' }}优先级
                </span>
                <span v-if="t.evidence">证据：{{ t.evidence }}</span>
              </div>
            </div>
          </div>
          <div class="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button class="btn-secondary" @click="extractedTasks = []">丢弃</button>
            <button class="btn-primary" @click="saveTasks">保存任务</button>
          </div>
        </div>
      </div>

      <!-- 生成卡片 -->
      <div v-else-if="activeTab === 'cards'">
        <div class="card flex items-center justify-between p-5">
          <div class="flex items-center gap-2 text-sm text-slate-600">
            卡片数量
            <select v-model="cardCount" class="input-base w-32">
              <option :value="0">自动（按篇幅）</option>
              <option :value="5">5 张</option>
              <option :value="10">10 张</option>
              <option :value="15">15 张</option>
              <option :value="20">20 张</option>
              <option :value="30">30 张</option>
            </select>
          </div>
          <div class="flex items-center gap-2">
            <span v-if="loading && cardProgress" class="text-xs text-slate-400">{{ cardProgress }}</span>
            <button v-if="loading" class="btn-secondary" @click="cancelCards">取消</button>
            <button class="btn-primary" :disabled="loading" @click="runCards">
              <Layers :size="16" /> {{ loading ? "生成中…" : "生成卡片" }}
            </button>
          </div>
        </div>
        <p class="mt-2 text-xs text-slate-400">
          长资料会自动分段逐段提取，覆盖全文；自动模式约每 500 字一个知识点（5~60 张）。
          <span v-if="cardEstimate" class="text-slate-500">
            本次预计：{{ cardEstimate.chunks }} 段 / 约 {{ cardEstimate.cards }} 张 /
            {{ cardEstimate.calls }} 次请求。
          </span>
        </p>
        <div v-if="cardDrafts.length > 0" class="mt-4 space-y-3">
          <div v-for="(c, i) in cardDrafts" :key="i" class="card p-4">
            <div class="mb-1 text-xs font-medium text-slate-400">问题</div>
            <input v-model="c.question" type="text" class="input-base" />
            <div class="mb-1 mt-3 text-xs font-medium text-slate-400">答案</div>
            <textarea v-model="c.answer" rows="2" class="input-base resize-none"></textarea>
          </div>
          <div class="flex justify-end gap-2">
            <button class="btn-secondary" @click="cardDrafts = []">丢弃</button>
            <button class="btn-primary" @click="saveCards">保存卡片</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
