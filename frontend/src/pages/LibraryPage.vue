<script setup lang="ts">
import { computed, ref, onBeforeUnmount } from "vue";
import { useRouter } from "vue-router";
import { useDocumentStore } from "@/stores/documentStore";
import { useAppStore } from "@/stores/appStore";
import { useAIStore } from "@/stores/aiStore";
import { useReviewStore } from "@/stores/reviewStore";
import { generateCardsFromContent } from "@/services/ai/aiService";
import { createFlashcard } from "@/services/flashcardService";
import { documentsToMarkdown } from "@/utils/export";
import { downloadText } from "@/utils/download";
import type { Document } from "@/types/document";
import SearchBar from "@/components/SearchBar.vue";
import DocumentCard from "@/components/DocumentCard.vue";
import EmptyState from "@/components/EmptyState.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import SkeletonCard from "@/components/SkeletonCard.vue";
import {
  Plus,
  Star,
  Layers,
  X,
  CheckSquare,
  Square,
  Trash2,
  Download,
  Sparkles,
  FolderInput
} from "lucide-vue-next";

const router = useRouter();
const docStore = useDocumentStore();
const appStore = useAppStore();
const aiStore = useAIStore();
const reviewStore = useReviewStore();

const showDeleteDialog = ref(false);
const deleteTargetId = ref("");

// 直接使用 store 的 filteredDocuments（含搜索打分 + 分类/收藏筛选）
/** 每个分类下有多少份资料（全量计数，不受筛选影响） */
const categoryCounts = computed(() => {
  const m = new Map<string, number>();
  for (const d of docStore.documents) {
    const k = d.categoryId ?? "";
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
});

const filtered = computed(() => docStore.filteredDocuments);

function clearFilters() {
  docStore.searchKeyword = "";
  docStore.activeCategoryId = "";
  docStore.onlyFavorite = false;
}

function openDocument(id: string) {
  router.push(`/library/${id}`);
}

function askDelete(id: string) {
  deleteTargetId.value = id;
  showDeleteDialog.value = true;
}

async function confirmDelete() {
  await docStore.remove(deleteTargetId.value);
  appStore.showToast("资料已删除", "success");
  showDeleteDialog.value = false;
}

/* ------------------------- 选择模式 ------------------------- */
const selectionMode = ref(false);
const selectedIds = ref<string[]>([]);
const selectedCount = computed(() => selectedIds.value.length);
const allSelected = computed(
  () => filtered.value.length > 0 && selectedIds.value.length === filtered.value.length
);

function toggleSelectMode() {
  selectionMode.value = !selectionMode.value;
  selectedIds.value = [];
}

function isSelected(id: string) {
  return selectedIds.value.includes(id);
}

function toggleSelect(id: string) {
  selectedIds.value = isSelected(id)
    ? selectedIds.value.filter((x) => x !== id)
    : [...selectedIds.value, id];
}

function toggleSelectAll() {
  selectedIds.value = allSelected.value ? [] : filtered.value.map((d) => d.id);
}

function onCardClick(id: string) {
  if (selectionMode.value) toggleSelect(id);
  else openDocument(id);
}

/* ------------------------- 撤销删除 ------------------------- */
const undoDocs = ref<Document[]>([]);
let undoTimer: number | undefined;

function scheduleUndo(docs: Document[]) {
  undoDocs.value = docs;
  window.clearTimeout(undoTimer);
  undoTimer = window.setTimeout(() => {
    undoDocs.value = [];
  }, 8000);
}

async function undoDelete() {
  const docs = undoDocs.value;
  undoDocs.value = [];
  window.clearTimeout(undoTimer);
  if (docs.length === 0) return;
  await docStore.restoreSnapshot(docs);
  appStore.showToast(`已恢复 ${docs.length} 份资料`, "success");
}

onBeforeUnmount(() => window.clearTimeout(undoTimer));

/* ------------------------- 批量删除 / 改分类 / 导出 ------------------------- */
const showBulkDelete = ref(false);
const bulkCategory = ref("");

async function confirmBulkDelete() {
  const ids = [...selectedIds.value];
  const removed = await docStore.bulkRemove(ids);
  showBulkDelete.value = false;
  selectedIds.value = [];
  selectionMode.value = false;
  scheduleUndo(removed);
  appStore.showToast(`已删除 ${removed.length} 份资料`, "success");
}

async function applyBulkCategory() {
  if (selectedCount.value === 0) return;
  await docStore.bulkUpdateCategory(selectedIds.value, bulkCategory.value);
  appStore.showToast("分类已更新", "success");
  selectedIds.value = [];
}

function exportSelectedMarkdown() {
  const docs = docStore.documents.filter((d) => selectedIds.value.includes(d.id));
  if (docs.length === 0) return;
  const md = documentsToMarkdown(docs, (id) => docStore.categoryById(id)?.name);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  downloadText(md, `knowflow-${stamp}.md`, "text/markdown;charset=utf-8");
  appStore.showToast(`已导出 ${docs.length} 份资料`, "success");
}

/* ------------------------- 批量生成卡片 ------------------------- */
const showGenerate = ref(false);
const generating = ref(false);
const genProgress = ref("");
const selectedDocs = computed(() =>
  docStore.documents.filter((d) => selectedIds.value.includes(d.id))
);
/** 预估张数：约每 500 字一张，最少 5 张 */
const estimatedCards = computed(() =>
  selectedDocs.value.reduce(
    (sum, d) => sum + Math.max(5, Math.round((d.content?.length ?? 0) / 500)),
    0
  )
);

async function runBatchGenerate() {
  const docs = [...selectedDocs.value];
  if (docs.length === 0) return;
  generating.value = true;
  let okDocs = 0;
  let failed = 0;
  let totalCards = 0;

  for (let i = 0; i < docs.length; i++) {
    genProgress.value = `第 ${i + 1} / ${docs.length} 份 · 已生成 ${totalCards} 张`;
    try {
      const drafts = (await generateCardsFromContent(
        aiStore.provider,
        docs[i].content,
        0,
        docs[i].id
      )) as { question: string; answer: string }[];
      for (const d of drafts) {
        await createFlashcard({
          documentId: docs[i].id,
          question: d.question,
          answer: d.answer
        });
      }
      totalCards += drafts.length;
      okDocs += 1;
    } catch (e) {
      console.warn("[KnowFlow] 批量生成失败：", docs[i].title, e);
      failed += 1;
    }
  }

  generating.value = false;
  genProgress.value = "";
  showGenerate.value = false;
  selectedIds.value = [];
  selectionMode.value = false;
  void reviewStore.refresh();

  if (totalCards === 0) {
    appStore.showToast("没有生成卡片，请检查 AI 配置后重试", "error");
  } else {
    appStore.showToast(
      `成功 ${okDocs} 份 · 生成 ${totalCards} 张${failed ? ` · 失败 ${failed} 份` : ""}`,
      failed ? "info" : "success"
    );
  }
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <div class="mb-5 flex items-center justify-between gap-3">
      <h1 class="text-2xl font-bold text-slate-900">资料库</h1>
      <div class="flex items-center gap-2">
        <button class="btn-secondary" @click="toggleSelectMode">
          <component :is="selectionMode ? X : CheckSquare" :size="16" />
          {{ selectionMode ? "退出选择" : "选择" }}
        </button>
        <router-link to="/editor" class="btn-primary">
          <Plus :size="16" /> 新增资料
        </router-link>
      </div>
    </div>

    <!-- 搜索与筛选 -->
    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <div class="flex-1">
        <SearchBar />
      </div>
      <div class="flex items-center gap-2">
        <button
          class="btn-secondary"
          :class="docStore.onlyFavorite ? 'border-amber-300 bg-amber-50 text-amber-600' : ''"
          @click="docStore.onlyFavorite = !docStore.onlyFavorite"
        >
          <Star :size="16" /> 收藏
        </button>
      </div>
    </div>

    <!-- 分类筛选 -->
    <div class="mb-5 flex flex-wrap items-center gap-2">
      <button
        class="rounded-full px-3 py-1.5 text-sm transition"
        :class="!docStore.activeCategoryId ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
        @click="docStore.activeCategoryId = ''"
      >
        全部
        <span class="ml-1 text-[11px] tabular-nums opacity-60">{{ docStore.documents.length }}</span>
      </button>
      <button
        v-for="c in docStore.categories"
        :key="c.id"
        class="rounded-full px-3 py-1.5 text-sm transition"
        :class="docStore.activeCategoryId === c.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
        @click="docStore.activeCategoryId = c.id"
      >
        {{ c.name }}
        <span class="ml-1 text-[11px] tabular-nums opacity-60">{{ categoryCounts.get(c.id) ?? 0 }}</span>
      </button>
      <span class="ml-1 text-xs text-slate-400">{{ filtered.length }} 条结果</span>
      <button
        v-if="docStore.searchKeyword || docStore.activeCategoryId || docStore.onlyFavorite"
        class="ml-auto flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
        @click="clearFilters"
      >
        <X :size="14" /> 清除筛选
      </button>
    </div>

    <!-- 列表 -->
    <div v-if="docStore.loading && docStore.documents.length === 0" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <SkeletonCard v-for="i in 6" :key="i" />
    </div>

    <EmptyState
      v-else-if="docStore.documents.length === 0"
      title="还没有资料"
      description="从记录第一条知识开始，或加载示例资料快速体验完整流程。"
    >
      <button class="btn-primary" @click="docStore.loadExamples">加载示例资料</button>
    </EmptyState>

    <EmptyState
      v-else-if="filtered.length === 0"
      title="没有匹配的资料"
      description="换个关键词试试，或清除筛选条件。"
    >
      <button class="btn-secondary" @click="clearFilters">清除筛选</button>
    </EmptyState>

    <div v-else class="grid gap-4 pb-24 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="d in filtered"
        :key="d.id"
        class="relative"
        :class="selectionMode && isSelected(d.id) ? 'rounded-xl ring-2 ring-brand-400' : ''"
        @click="onCardClick(d.id)"
      >
        <DocumentCard
          :document="d"
          :keyword="docStore.searchKeyword"
          @toggle-favorite="docStore.toggleFavorite(d.id)"
        />
        <div
          v-if="selectionMode"
          class="absolute left-3 top-3 z-10 rounded-md bg-white/95 p-1 shadow-sm ring-1 ring-slate-200"
        >
          <component
            :is="isSelected(d.id) ? CheckSquare : Square"
            :size="16"
            :class="isSelected(d.id) ? 'text-brand-600' : 'text-slate-300'"
          />
        </div>
      </div>
    </div>

    <!-- 选中操作条 -->
    <transition name="bubble">
      <div
        v-if="selectionMode && selectedCount > 0"
        class="fixed inset-x-0 bottom-4 z-30 mx-auto flex w-[min(920px,calc(100vw-2rem))] flex-wrap items-center gap-2 rounded-2xl bg-slate-900/95 px-4 py-3 text-white shadow-2xl backdrop-blur"
      >
        <span class="text-sm">已选 {{ selectedCount }} 项</span>
        <button class="rounded-full bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20" @click="toggleSelectAll">
          {{ allSelected ? "反选" : "全选" }}
        </button>
        <span class="mx-1 h-4 w-px bg-white/20"></span>

        <button class="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20" @click="showGenerate = true">
          <Sparkles :size="13" /> 生成卡片
        </button>
        <button class="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20" @click="exportSelectedMarkdown">
          <Download :size="13" /> 导出 MD
        </button>
        <div class="flex items-center gap-1 rounded-full bg-white/10 px-2 py-1 text-xs">
          <FolderInput :size="13" />
          <select v-model="bulkCategory" class="bg-transparent text-xs text-white outline-none">
            <option value="" class="text-slate-800">未分类</option>
            <option v-for="c in docStore.categories" :key="c.id" :value="c.id" class="text-slate-800">
              {{ c.name }}
            </option>
          </select>
          <button class="ml-1 rounded px-1.5 py-0.5 hover:bg-white/20" @click="applyBulkCategory">应用</button>
        </div>
        <button
          class="ml-auto flex items-center gap-1 rounded-full bg-red-500 px-3 py-1 text-xs hover:bg-red-600"
          @click="showBulkDelete = true"
        >
          <Trash2 :size="13" /> 删除
        </button>
        <button class="rounded-full p-1 text-white/60 hover:text-white" title="取消选择" @click="selectedIds = []">
          <X :size="14" />
        </button>
      </div>
    </transition>

    <!-- 撤销删除 -->
    <transition name="bubble">
      <div
        v-if="undoDocs.length > 0"
        class="fixed inset-x-0 bottom-20 z-30 mx-auto flex w-[min(520px,calc(100vw-2rem))] items-center gap-3 rounded-xl bg-slate-800 px-4 py-2 text-sm text-white shadow-xl"
      >
        <span>已删除 {{ undoDocs.length }} 份资料</span>
        <button class="ml-auto rounded-full bg-white/15 px-3 py-1 text-xs hover:bg-white/25" @click="undoDelete">
          撤销
        </button>
      </div>
    </transition>

    <!-- 批量删除确认 -->
    <ConfirmDialog
      :visible="showBulkDelete"
      title="批量删除"
      :message="`将删除选中的 ${selectedCount} 份资料及其关联卡片入口，删除后可在 8 秒内撤销。`"
      confirm-text="删除"
      danger
      @confirm="confirmBulkDelete"
      @cancel="showBulkDelete = false"
    />

    <!-- 批量生成卡片 -->
    <div v-if="showGenerate" class="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
      <div class="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <h3 class="text-base font-semibold text-slate-900">批量生成学习卡片</h3>
        <p class="mt-2 text-sm text-slate-500">
          将按分段逐份调用模型，预计生成
          <span class="font-semibold text-brand-600">{{ estimatedCards }}</span> 张卡片，共
          {{ selectedCount }} 份资料。
        </p>
        <p class="mt-2 text-xs text-slate-400">
          长资料会拆成多段调用，可能产生多次模型请求；生成结果直接写入学习中心。
        </p>
        <p v-if="generating" class="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
          {{ genProgress || "准备中…" }}
        </p>
        <div class="mt-4 flex justify-end gap-2">
          <button class="btn-secondary" :disabled="generating" @click="showGenerate = false">取消</button>
          <button class="btn-primary" :disabled="generating" @click="runBatchGenerate">
            {{ generating ? "生成中…" : "开始生成" }}
          </button>
        </div>
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
