<script setup lang="ts">
/**
 * 学习概览：把「今天该学什么」收敛到一屏——待复习、卡片进度、语法与闯关入口。
 */
import { computed, onMounted, ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import {
  GraduationCap,
  Layers,
  BookOpen,
  Gamepad2,
  ArrowRight,
  AlertCircle,
  Sparkles,
  PlayCircle
} from "lucide-vue-next";
import { listFlashcards } from "@/services/flashcardService";
import { loadPackIndex } from "@/services/knowledgePack";
import { loadProgress } from "@/services/quest/engine";
import { useReviewStore } from "@/stores/reviewStore";
import { useDocumentStore } from "@/stores/documentStore";
import { IS_MINITOOL } from "@/utils/runtime";
import type { Flashcard } from "@/db/database";

const router = useRouter();
const route = useRoute();
const reviewStore = useReviewStore();
const docStore = useDocumentStore();

const cards = ref<Flashcard[]>([]);
const grammarTotal = ref(0);
const questBest = ref(0);
const questPlays = ref(0);
const loading = ref(true);

onMounted(async () => {
  // 旧链接兼容：/study?mode=review 与 /study?card=xxx 是上一版卡片复习的地址
  if (route.query.mode || route.query.card) {
    await router.replace({ path: "/study/cards", query: route.query });
    return;
  }

  await docStore.loadAll(false);
  void reviewStore.refresh();
  cards.value = await listFlashcards();
  if (!IS_MINITOOL) {
    try {
      const index = await loadPackIndex();
      grammarTotal.value = index.packs.find((p) => p.id === "grammar")?.count ?? 0;
    } catch {
      // 知识包加载失败不影响概览其余部分
    }
    const progress = loadProgress();
    questBest.value = Math.max(progress.cet4?.bestScore ?? 0, progress.cet6?.bestScore ?? 0);
    questPlays.value = (progress.cet4?.plays ?? 0) + (progress.cet6?.plays ?? 0);
  }
  loading.value = false;
});

const mastered = computed(() => cards.value.filter((c) => c.mastery === 2).length);
const learning = computed(() => cards.value.filter((c) => c.mastery === 1).length);
/** 已加入资料库的语法篇数（按导入时打的标签识别） */
const grammarAdded = computed(
  () => docStore.documents.filter((d) => (d.tags ?? []).includes("英语语法")).length
);

const hasAny = computed(() => cards.value.length > 0);

const DAY_MS = 24 * 3600 * 1000;

/**
 * 未来 7 天复习量预测：按 nextReviewAt 分桶。
 * 没有排期的卡片（刚生成、尚未复习）算在「今天」，因为随时可复习。
 */
const forecast = computed(() => {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const week = ["日", "一", "二", "三", "四", "五", "六"];
  const days = Array.from({ length: 7 }, (_, i) => {
    const from = start.getTime() + i * DAY_MS;
    const label =
      i === 0
        ? "今天"
        : i === 1
          ? "明天"
          : `周${week[new Date(from).getDay()]}`;
    return { label, count: 0, from, to: from + DAY_MS };
  });

  for (const c of cards.value) {
    if (c.suspended) continue;
    const t = c.nextReviewAt ? new Date(c.nextReviewAt).getTime() : days[0].from;
    const bucket = days.find((d) => t >= d.from && t < d.to);
    if (bucket) bucket.count += 1;
  }
  return days;
});

const forecastMax = computed(() => Math.max(1, ...forecast.value.map((d) => d.count)));
</script>

<template>
  <div>
    <!-- 今日行动卡 -->
    <div
      class="card flex flex-wrap items-center gap-4 border-l-4 p-5"
      :class="reviewStore.hasPending ? 'border-l-rose-400' : 'border-l-emerald-400'"
    >
      <div
        class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
        :class="reviewStore.hasPending ? 'bg-rose-50 text-rose-500' : 'bg-emerald-50 text-emerald-500'"
      >
        <GraduationCap :size="24" />
      </div>
      <div class="min-w-0 flex-1">
        <div class="text-base font-semibold text-slate-900">
          <template v-if="reviewStore.hasPending">
            今天有 {{ reviewStore.pending }} 张卡片待复习
          </template>
          <template v-else-if="hasAny">今天的复习已完成 🎉</template>
          <template v-else>还没有学习卡片</template>
        </div>
        <div class="mt-1 text-xs text-slate-500">
          <template v-if="reviewStore.hasPending">
            今日已复习 {{ reviewStore.todayDone }} 张
            <span v-if="reviewStore.overdue" class="ml-1 text-rose-500">
              · 逾期 {{ reviewStore.overdue }} 张
            </span>
          </template>
          <template v-else-if="hasAny">
            今日已复习 {{ reviewStore.todayDone }} 张，明天再来继续
          </template>
          <template v-else>
            导入资料后让 AI 生成卡片{{ IS_MINITOOL ? "" : "，或用「单词闯关」边玩边记" }}
          </template>
        </div>
      </div>
      <router-link
        v-if="reviewStore.hasPending"
        to="/study/cards?mode=review"
        class="btn-primary shrink-0"
      >
        <PlayCircle :size="16" /> 开始复习
      </router-link>
      <router-link v-else-if="hasAny" to="/study/cards" class="btn-secondary shrink-0">
        查看全部卡片 <ArrowRight :size="14" />
      </router-link>
      <router-link v-else to="/library" class="btn-primary shrink-0">
        <Sparkles :size="16" /> 去导入资料
      </router-link>
    </div>

    <!-- 卡片进度 -->
    <div v-if="hasAny" class="mt-3 grid grid-cols-3 gap-3">
      <div class="card p-4">
        <div class="text-xs text-slate-400">卡片总数</div>
        <div class="mt-1 text-xl font-bold text-slate-900">{{ cards.length }}</div>
      </div>
      <div class="card p-4">
        <div class="text-xs text-slate-400">已掌握</div>
        <div class="mt-1 text-xl font-bold text-emerald-600">{{ mastered }}</div>
      </div>
      <div class="card p-4">
        <div class="text-xs text-slate-400">正在巩固</div>
        <div class="mt-1 text-xl font-bold text-amber-600">{{ learning }}</div>
      </div>
    </div>

    <!-- 未来 7 天复习量 -->
    <div v-if="hasAny" class="card mt-3 p-4">
      <div class="mb-3 flex items-center justify-between">
        <span class="text-xs font-medium text-slate-600">未来 7 天复习量</span>
        <span class="text-[11px] text-slate-400">按记忆曲线排期，逾期会累积到当天</span>
      </div>
      <div class="flex items-end gap-2">
        <div v-for="(d, i) in forecast" :key="d.label" class="flex flex-1 flex-col items-center gap-1">
          <span class="text-[11px] font-medium" :class="d.count ? 'text-slate-600' : 'text-slate-300'">
            {{ d.count }}
          </span>
          <div class="flex h-14 w-full items-end justify-center">
            <div
              class="w-6 rounded-t-sm transition-all"
              :class="d.count === 0 ? 'bg-slate-200' : i === 0 ? 'bg-brand-500' : 'bg-brand-300'"
              :style="{ height: `${d.count === 0 ? 3 : Math.max(8, Math.round((d.count / forecastMax) * 56))}px` }"
            ></div>
          </div>
          <span class="text-[10px]" :class="i === 0 ? 'font-medium text-brand-600' : 'text-slate-400'">
            {{ d.label }}
          </span>
        </div>
      </div>
    </div>

    <!-- 三个功能入口 -->
    <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <button
        class="card flex flex-col gap-2 p-4 text-left transition hover:shadow-md"
        @click="router.push('/study/cards')"
      >
        <div class="flex items-center gap-2">
          <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
            <Layers :size="18" />
          </span>
          <span class="font-medium text-slate-800">卡片复习</span>
        </div>
        <p class="text-xs text-slate-500">
          {{ hasAny ? `共 ${cards.length} 张，待复习 ${reviewStore.pending} 张` : "暂无卡片，先去生成" }}
        </p>
      </button>

      <button
        v-if="!IS_MINITOOL"
        class="card flex flex-col gap-2 p-4 text-left transition hover:shadow-md"
        @click="router.push('/study/grammar')"
      >
        <div class="flex items-center gap-2">
          <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <BookOpen :size="18" />
          </span>
          <span class="font-medium text-slate-800">语法学习</span>
        </div>
        <p class="text-xs text-slate-500">
          {{ grammarTotal }} 个语法点
          <span v-if="grammarAdded">· 已加入 {{ grammarAdded }} 篇</span>
        </p>
      </button>

      <button
        v-if="!IS_MINITOOL"
        class="card flex flex-col gap-2 p-4 text-left transition hover:shadow-md"
        @click="router.push('/study/quest')"
      >
        <div class="flex items-center gap-2">
          <span class="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
            <Gamepad2 :size="18" />
          </span>
          <span class="font-medium text-slate-800">单词闯关</span>
        </div>
        <p class="text-xs text-slate-500">
          {{ questPlays > 0 ? `已玩 ${questPlays} 局 · 最高 ${questBest} 分` : "四六级词库，答错自动复习" }}
        </p>
      </button>
    </div>

    <!-- 提示 -->
    <p
      v-if="!loading && !hasAny"
      class="mt-4 flex items-start gap-2 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-500"
    >
      <AlertCircle :size="14" class="mt-0.5 shrink-0" />
      <span>
        卡片来自「AI 工作台」的资料提炼{{ IS_MINITOOL ? "" : "，或「单词闯关」答错的词" }}。生成后按记忆曲线安排复习，
        标记「已掌握」的间隔会逐步拉长。
      </span>
    </p>
  </div>
</template>
