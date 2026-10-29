<script setup lang="ts">
import { computed, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useDocumentStore } from "@/stores/documentStore";
import { useTaskStore } from "@/stores/taskStore";
import { useReviewStore } from "@/stores/reviewStore";
import { IS_MINITOOL } from "@/utils/runtime";
import SearchBar from "@/components/SearchBar.vue";
import DocumentCard from "@/components/DocumentCard.vue";
import EmptyState from "@/components/EmptyState.vue";
import {
  Plus,
  Sparkles,
  MessageCircleQuestion,
  GraduationCap,
  FolderOpen,
  Star,
  CalendarDays,
  CheckSquare,
  Gamepad2,
  BookOpen,
  ChevronRight
} from "lucide-vue-next";

const router = useRouter();
const docStore = useDocumentStore();
const taskStore = useTaskStore();
const reviewStore = useReviewStore();

onMounted(() => {
  taskStore.load();
  void reviewStore.refresh();
});

const allQuickActions = [
  { label: "新增资料", desc: "快速记录想法和知识", icon: Plus, to: "/editor", color: "bg-brand-50 text-brand-600" },
  { label: "AI 整理", desc: "提炼重点与行动项", icon: Sparkles, to: "/assistant", color: "bg-violet-50 text-violet-600" },
  { label: "资料问答", desc: "基于资料查找答案", icon: MessageCircleQuestion, to: "/assistant", color: "bg-emerald-50 text-emerald-600" },
  { label: "学习复习", desc: "把知识变成记忆卡片", icon: GraduationCap, to: "/study", color: "bg-amber-50 text-amber-600" },
  { label: "语法学习", desc: "50 个语法点，可生成卡片", icon: BookOpen, to: "/study/grammar", color: "bg-indigo-50 text-indigo-600" },
  { label: "单词闯关", desc: "10 题一组，错词自动复习", icon: Gamepad2, to: "/study/quest", color: "bg-rose-50 text-rose-600" }
];

/** 端内无网络、知识包加载不了，语法与闯关两个快捷入口不渲染 */
const quickActions = computed(() =>
  IS_MINITOOL
    ? allQuickActions.filter(
        (a) => !a.to.startsWith("/study/grammar") && !a.to.startsWith("/study/quest")
      )
    : allQuickActions
);

const stats = computed(() => [
  { label: "我的资料", value: docStore.totalCount, icon: FolderOpen, color: "text-brand-600 bg-brand-50", to: "/library" },
  { label: "我的收藏", value: docStore.favoriteCount, icon: Star, color: "text-amber-500 bg-amber-50", to: "/library" },
  { label: "近期新增", value: docStore.recentAddedCount, icon: CalendarDays, color: "text-emerald-600 bg-emerald-50", to: "/library" },
  { label: "待办任务", value: taskStore.pendingCount, icon: CheckSquare, color: "text-violet-600 bg-violet-50", to: "/tasks" }
]);

function openDocument(id: string) {
  router.push(`/library/${id}`);
}
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <!-- 顶部标语 -->
    <div class="mb-6">
      <h1 class="text-2xl font-bold text-slate-900">你的个人知识与行动中心</h1>
      <p class="mt-1 text-sm text-slate-500">收藏、理解、检索，让知识不止于收藏，让信息成为行动。</p>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div
        v-for="s in stats"
        :key="s.label"
        class="card flex cursor-pointer items-center gap-3 p-4 transition hover:shadow-md"
        @click="router.push(s.to)"
      >
        <div class="flex h-11 w-11 items-center justify-center rounded-lg" :class="s.color">
          <component :is="s.icon" :size="22" />
        </div>
        <div>
          <div class="text-2xl font-bold leading-none text-slate-900">{{ s.value }}</div>
          <div class="mt-1 text-xs text-slate-400">{{ s.label }}</div>
        </div>
      </div>
    </div>

    <!-- 今日复习行动卡 -->
    <div
      v-if="reviewStore.hasPending || reviewStore.todayDone > 0"
      class="card mt-4 flex flex-wrap items-center gap-4 p-4"
    >
      <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-rose-50 text-rose-500">
        <GraduationCap :size="22" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="text-sm font-medium text-slate-800">
          <template v-if="reviewStore.hasPending">
            今天有 <span class="font-bold text-rose-500">{{ reviewStore.pending }}</span> 张卡片待复习
            <span v-if="reviewStore.overdue" class="ml-1 text-xs font-normal text-rose-400">
              （逾期 {{ reviewStore.overdue }} 张）
            </span>
          </template>
          <template v-else>今天的复习已经清空啦 🎉</template>
        </div>
        <div class="mt-0.5 text-xs text-slate-400">
          今日已复习 {{ reviewStore.todayDone }} 张 · 按记忆曲线安排，先温故再学新
        </div>
      </div>
      <router-link
        v-if="reviewStore.hasPending"
        to="/study/cards?mode=review"
        class="btn-primary shrink-0"
      >
        开始复习
      </router-link>
      <router-link v-else to="/study" class="btn-secondary shrink-0">查看学习中心</router-link>
    </div>

    <!-- 搜索 -->
    <div class="mt-6">
      <SearchBar enter-to-navigate />
      <p class="mt-1.5 text-xs text-slate-400">输入关键词后按回车，跳转到资料库查看搜索结果</p>
    </div>

    <!-- 快捷操作 -->
    <div class="mt-6">
      <h2 class="mb-3 text-sm font-medium text-slate-500">快捷操作</h2>
      <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <button
          v-for="a in quickActions"
          :key="a.label"
          class="card flex items-center gap-3 p-4 text-left transition hover:shadow-md"
          @click="router.push(a.to)"
        >
          <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" :class="a.color">
            <component :is="a.icon" :size="20" />
          </div>
          <div class="min-w-0">
            <div class="font-medium text-slate-800">{{ a.label }}</div>
            <div class="truncate text-xs text-slate-400">{{ a.desc }}</div>
          </div>
        </button>
      </div>
    </div>

    <!-- 最近资料 -->
    <div class="mt-8">
      <div class="mb-3 flex items-center justify-between">
        <h2 class="text-sm font-medium text-slate-500">最近资料</h2>
        <router-link to="/library" class="flex items-center text-sm text-brand-600 hover:text-brand-700">
          查看全部 <ChevronRight :size="16" />
        </router-link>
      </div>

      <EmptyState
        v-if="docStore.documents.length === 0"
        title="还没有资料"
        description="从记录第一条知识开始，或加载示例资料快速体验完整流程。"
      >
        <button class="btn-primary" @click="docStore.loadExamples">加载示例资料</button>
      </EmptyState>

      <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <DocumentCard
          v-for="d in docStore.recentDocuments"
          :key="d.id"
          :document="d"
          @click="openDocument(d.id)"
          @toggle-favorite="docStore.toggleFavorite(d.id)"
        />
      </div>
    </div>
  </div>
</template>
