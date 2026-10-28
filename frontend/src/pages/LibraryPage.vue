<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useDocumentStore } from "@/stores/documentStore";
import { useAppStore } from "@/stores/appStore";
import SearchBar from "@/components/SearchBar.vue";
import DocumentCard from "@/components/DocumentCard.vue";
import EmptyState from "@/components/EmptyState.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { Plus, Star, Layers, X } from "lucide-vue-next";

const router = useRouter();
const docStore = useDocumentStore();
const appStore = useAppStore();

const showDeleteDialog = ref(false);
const deleteTargetId = ref("");

// 直接使用 store 的 filteredDocuments（含搜索打分 + 分类/收藏筛选）
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
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <div class="mb-5 flex items-center justify-between">
      <h1 class="text-2xl font-bold text-slate-900">资料库</h1>
      <router-link to="/editor" class="btn-primary">
        <Plus :size="16" /> 新增资料
      </router-link>
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
      </button>
      <button
        v-for="c in docStore.categories"
        :key="c.id"
        class="rounded-full px-3 py-1.5 text-sm transition"
        :class="docStore.activeCategoryId === c.id ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
        @click="docStore.activeCategoryId = c.id"
      >
        {{ c.name }}
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
    <EmptyState
      v-if="docStore.documents.length === 0"
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

    <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <DocumentCard
        v-for="d in filtered"
        :key="d.id"
        :document="d"
        :keyword="docStore.searchKeyword"
        @click="openDocument(d.id)"
        @toggle-favorite="docStore.toggleFavorite(d.id)"
      />
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
