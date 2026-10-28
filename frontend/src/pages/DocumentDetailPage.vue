<script setup lang="ts">
import { computed, ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useDocumentStore } from "@/stores/documentStore";
import { useTaskStore } from "@/stores/taskStore";
import { useAIStore } from "@/stores/aiStore";
import { useAppStore } from "@/stores/appStore";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { SOURCE_TYPE_LABEL } from "@/types/document";
import { TASK_STATUS_LABEL } from "@/types/task";
import { formatDate } from "@/utils/format";
import { summarizeDocument } from "@/services/ai/aiService";
import type { SummaryResult } from "@/types/ai";
import {
  ArrowLeft,
  Star,
  Pencil,
  Trash2,
  StickyNote,
  FileText,
  Globe,
  Type,
  Sparkles,
  ListTodo,
  Layers,
  CheckCircle2,
  Circle,
  Clock3,
  Loader2
} from "lucide-vue-next";

const route = useRoute();
const router = useRouter();
const docStore = useDocumentStore();
const taskStore = useTaskStore();
const aiStore = useAIStore();
const appStore = useAppStore();

const doc = computed(() => docStore.documents.find((d) => d.id === route.params.id));
const category = computed(() => docStore.categoryById(doc.value?.categoryId));

// 关联任务
const relatedTasks = computed(() =>
  taskStore.tasks.filter((t) => t.sourceDocumentId === route.params.id)
);

const showDeleteDialog = ref(false);

// 摘要
const generatingSummary = ref(false);
const summaryDraft = ref<SummaryResult | null>(null);

onMounted(() => {
  taskStore.load();
});

const sourceIcon = { note: StickyNote, text: Type, file: FileText, web: Globe };
const sourceIconComp = computed(() => (doc.value ? sourceIcon[doc.value.sourceType] ?? StickyNote : StickyNote));

function goBack() {
  router.back();
}

async function toggleFavorite() {
  if (!doc.value) return;
  await docStore.toggleFavorite(doc.value.id);
}

async function confirmDelete() {
  if (!doc.value) return;
  await docStore.remove(doc.value.id);
  appStore.showToast("资料已删除", "success");
  router.push("/library");
}

// AI 摘要：在详情页内联生成并确认
async function generateSummary() {
  if (!doc.value) return;
  generatingSummary.value = true;
  try {
    summaryDraft.value = (await summarizeDocument(aiStore.provider, doc.value.title, doc.value.content)) as SummaryResult;
  } catch (e) {
    appStore.showToast(e instanceof Error ? e.message : "AI 服务暂时不可用", "error");
  } finally {
    generatingSummary.value = false;
  }
}

async function saveSummary() {
  if (!doc.value || !summaryDraft.value) return;
  await docStore.update(doc.value.id, {
    summary: summaryDraft.value.summary,
    keywords: summaryDraft.value.keywords
  });
  appStore.showToast("摘要已保存", "success");
  summaryDraft.value = null;
}

// 行动项 / 卡片：跳转 AI 工作台（携带当前资料）
function gotoAssistant(tab: "tasks" | "cards") {
  router.push({ path: "/assistant", query: { doc: doc.value?.id, tab } });
}

function comingSoon(name: string) {
  appStore.showToast(`「${name}」请在 AI 工作台使用`, "info");
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <div v-if="!doc" class="card flex flex-col items-center justify-center px-6 py-16 text-center">
      <p class="text-slate-500">未找到该资料</p>
      <router-link to="/library" class="btn-secondary mt-4">返回资料库</router-link>
    </div>

    <div v-else>
      <!-- 顶部操作栏 -->
      <div class="mb-5 flex items-center justify-between">
        <button class="btn-ghost" @click="goBack">
          <ArrowLeft :size="18" /> 返回
        </button>
        <div class="flex items-center gap-2">
          <button
            class="btn-secondary"
            :class="doc.favorite ? 'border-amber-300 text-amber-500' : ''"
            @click="toggleFavorite"
          >
            <Star :size="16" :fill="doc.favorite ? 'currentColor' : 'none'" />
            {{ doc.favorite ? "已收藏" : "收藏" }}
          </button>
          <router-link :to="`/editor/${doc.id}`" class="btn-secondary">
            <Pencil :size="16" /> 编辑
          </router-link>
          <button class="btn-secondary text-red-500 hover:bg-red-50" @click="showDeleteDialog = true">
            <Trash2 :size="16" />
          </button>
        </div>
      </div>

      <!-- 标题与元信息 -->
      <div class="card p-6">
        <div class="flex items-center gap-2 text-xs text-slate-400">
          <component :is="sourceIconComp" :size="14" />
          <span>{{ SOURCE_TYPE_LABEL[doc.sourceType] }}</span>
          <span v-if="category" class="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">{{ category.name }}</span>
          <span>· 更新于 {{ formatDate(doc.updatedAt) }}</span>
        </div>

        <h1 class="mt-2 text-xl font-bold leading-snug text-slate-900">{{ doc.title }}</h1>

        <!-- 来源附加信息 -->
        <div v-if="doc.sourceName" class="mt-2 text-xs">
          <template v-if="doc.sourceType === 'web'">
            <!-- 容器禁止打开外链/新窗口（target=_blank 与站外跳转均不可用），
                 因此来源链接只做可选中文本展示，供用户长按复制。 -->
            <span class="inline-flex items-start gap-1 select-text text-slate-400">
              <Globe :size="12" class="mt-0.5 shrink-0" /> 来源：{{ doc.sourceName }}
            </span>
          </template>
          <template v-else-if="doc.sourceType === 'file'">
            <span class="inline-flex items-center gap-1 text-slate-400">
              <FileText :size="12" /> 源文件：{{ doc.sourceName }}
            </span>
          </template>
        </div>

        <div class="mt-3 flex flex-wrap gap-1.5">
          <span
            v-for="tag in doc.tags"
            :key="tag"
            class="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-600"
          >
            {{ tag }}
          </span>
        </div>

        <!-- 摘要 -->
        <div v-if="doc.summary" class="mt-5 rounded-lg bg-brand-50/50 p-4">
          <div class="mb-1 flex items-center gap-1.5 text-xs font-medium text-brand-600">
            <Sparkles :size="14" /> AI 摘要
          </div>
          <p class="text-sm leading-relaxed text-slate-700">{{ doc.summary }}</p>
        </div>

        <!-- 正文 -->
        <div class="mt-5">
          <div class="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{{ doc.content }}</div>
        </div>
      </div>

      <!-- 关联任务 -->
      <div v-if="relatedTasks.length > 0" class="card mt-5 p-5">
        <div class="mb-3 flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <ListTodo :size="16" class="text-brand-600" /> 关联任务（{{ relatedTasks.length }}）
        </div>
        <div class="space-y-2">
          <div
            v-for="t in relatedTasks"
            :key="t.id"
            class="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-slate-50"
            @click="router.push('/tasks')"
          >
            <CheckCircle2 v-if="t.status === 'done'" :size="16" class="text-emerald-500" />
            <Clock3 v-else-if="t.status === 'doing'" :size="16" class="text-amber-500" />
            <Circle v-else :size="16" class="text-slate-300" />
            <span class="flex-1 text-sm" :class="t.status === 'done' ? 'text-slate-400 line-through' : 'text-slate-700'">
              {{ t.title }}
            </span>
            <span class="text-xs text-slate-400">{{ TASK_STATUS_LABEL[t.status] }}</span>
          </div>
        </div>
      </div>

      <!-- AI 摘要（内联生成） -->
      <div v-if="generatingSummary" class="card mt-5 flex items-center justify-center gap-2 p-6 text-slate-500">
        <Loader2 :size="18" class="animate-spin text-brand-500" /> 正在生成摘要…
      </div>

      <div v-if="summaryDraft" class="card mt-5 p-5">
        <div class="mb-2 flex items-center gap-1.5 text-sm font-medium text-slate-700">
          <Sparkles :size="16" class="text-violet-600" /> 摘要预览
        </div>
        <p class="text-sm leading-relaxed text-slate-700">{{ summaryDraft.summary }}</p>
        <div v-if="summaryDraft.keywords.length" class="mt-3 flex flex-wrap gap-1.5">
          <span v-for="k in summaryDraft.keywords" :key="k" class="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-600">{{ k }}</span>
        </div>
        <div class="mt-4 flex justify-end gap-2 border-t border-slate-100 pt-4">
          <button class="btn-secondary" @click="summaryDraft = null">丢弃</button>
          <button class="btn-primary" @click="saveSummary">保存摘要</button>
        </div>
      </div>

      <!-- AI 操作 -->
      <div class="mt-5 grid gap-3 sm:grid-cols-3">
        <button
          class="card flex items-center gap-3 p-4 text-left transition hover:shadow-md"
          :disabled="generatingSummary"
          @click="generateSummary"
        >
          <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
            <Sparkles :size="18" />
          </div>
          <div>
            <div class="text-sm font-medium text-slate-700">生成摘要</div>
            <div class="text-xs text-slate-400">提炼核心要点</div>
          </div>
        </button>
        <button class="card flex items-center gap-3 p-4 text-left transition hover:shadow-md" @click="gotoAssistant('tasks')">
          <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            <ListTodo :size="18" />
          </div>
          <div>
            <div class="text-sm font-medium text-slate-700">提取行动项</div>
            <div class="text-xs text-slate-400">生成待办任务</div>
          </div>
        </button>
        <button class="card flex items-center gap-3 p-4 text-left transition hover:shadow-md" @click="gotoAssistant('cards')">
          <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <Layers :size="18" />
          </div>
          <div>
            <div class="text-sm font-medium text-slate-700">生成卡片</div>
            <div class="text-xs text-slate-400">制作记忆卡片</div>
          </div>
        </button>
      </div>
    </div>

    <ConfirmDialog
      :visible="showDeleteDialog"
      title="删除资料"
      message="删除后不可恢复，确定要删除这份资料吗？"
      confirm-text="删除"
      danger
      @confirm="confirmDelete"
      @cancel="showDeleteDialog = false"
    />
  </div>
</template>
