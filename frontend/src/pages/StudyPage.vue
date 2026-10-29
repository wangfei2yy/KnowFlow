<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAppStore } from "@/stores/appStore";
import { useCompanionStore } from "@/stores/companionStore";
import { useDocumentStore } from "@/stores/documentStore";
import EmptyState from "@/components/EmptyState.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import { type Flashcard } from "@/db/database";
import {
  listFlashcards,
  listDueCards,
  deleteFlashcard,
  markMastery,
  setSuspended,
  type Mastery
} from "@/services/flashcardService";
import { useReviewStore } from "@/stores/reviewStore";
import {
  ArrowLeft,
  ArrowRight,
  Trash2,
  RotateCcw,
  FileText,
  Layers,
  List,
  Filter,
  Layers3,
  PauseCircle,
  PlayCircle,
  CheckCircle2
} from "lucide-vue-next";

const router = useRouter();
const route = useRoute();
const appStore = useAppStore();
const reviewStore = useReviewStore();
const companionStore = useCompanionStore();
const docStore = useDocumentStore();

const cards = ref<Flashcard[]>([]);

// 视图：review（翻卡复习）/ list（列表管理）
const viewMode = ref<"review" | "list">("review");

// 复习队列：默认只复习「到期待复习」的卡片
const queueMode = ref(route.query.mode !== "all");
const queueIds = ref<string[]>([]);
const queueStats = ref({ due: 0, overdue: 0, fresh: 0, todayDone: 0, pending: 0 });

// 筛选与排序
const filterCategoryId = ref(""); // 空 = 全部分类
const filterMastery = ref<"" | Mastery>(""); // 空 = 全部熟悉度
const sortBy = ref<"createdAt" | "mastery" | "category">("createdAt");

const currentIndex = ref(0);
const flipped = ref(false);
const showDeleteDialog = ref(false);

// ---------- 卡片增强信息 ----------
interface CardWithMeta {
  card: Flashcard;
  docTitle: string;
  categoryId: string;
  categoryName: string;
}
const baseCards = computed<Flashcard[]>(() => {
  if (!queueMode.value) return cards.value;
  const map = new Map(cards.value.map((c) => [c.id, c]));
  return queueIds.value.map((id) => map.get(id)).filter((c): c is Flashcard => !!c);
});

const cardsWithMeta = computed<CardWithMeta[]>(() =>
  baseCards.value.map((card) => {
    const doc = docStore.documents.find((d) => d.id === card.documentId);
    const catId = doc?.categoryId ?? "";
    const cat = docStore.categoryById(catId);
    return {
      card,
      docTitle: doc?.title ?? "未知资料",
      categoryId: catId,
      categoryName: cat?.name ?? "未分类"
    };
  })
);

// 分类列表（供下拉）
const categoryOptions = computed(() => [
  { id: "", name: "全部分类" },
  ...docStore.categories.map((c) => ({ id: c.id, name: c.name }))
]);

// 过滤 + 排序后的卡片
const filteredCards = computed(() => {
  let list = cardsWithMeta.value;
  if (filterCategoryId.value) {
    list = list.filter((m) => m.categoryId === filterCategoryId.value);
  }
  // 队列模式保持调度顺序（逾期 → 到期 → 新卡），不受列表排序/熟悉度筛选影响
  if (queueMode.value) return list;

  if (filterMastery.value !== "") {
    list = list.filter((m) => m.card.mastery === filterMastery.value);
  }
  const sorted = [...list];
  if (sortBy.value === "mastery") {
    // 熟悉度升序：不熟悉(0)在前，已掌握(2)在后
    sorted.sort((a, b) => a.card.mastery - b.card.mastery);
  } else if (sortBy.value === "category") {
    sorted.sort((a, b) => a.categoryName.localeCompare(b.categoryName, "zh"));
  } else {
    // createdAt 降序（新→旧）
    sorted.sort((a, b) => (a.card.createdAt < b.card.createdAt ? 1 : -1));
  }
  return sorted;
});

// 复习模式使用的卡片列表（应用筛选与排序）
const reviewCards = computed(() => filteredCards.value.map((m) => m.card));
const total = computed(() => reviewCards.value.length);
const currentCard = computed(() => reviewCards.value[currentIndex.value] ?? null);
const currentMeta = computed(() =>
  currentCard.value
    ? filteredCards.value.find((m) => m.card.id === currentCard.value!.id) ?? null
    : null
);

// 分类分组（列表视图用）
const groupedByCategory = computed(() => {
  const groups = new Map<string, CardWithMeta[]>();
  for (const m of filteredCards.value) {
    const key = m.categoryName;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }
  return [...groups.entries()].map(([name, items]) => ({ name, items }));
});

onMounted(async () => {
  // 先加载资料与分类，再加载卡片，确保卡片能正确关联分类
  await docStore.loadAll();
  await loadCards();

  // 从全局搜索跳转：?card=<id> 直接定位到该卡片（退出队列模式以便在全部卡片中查找）
  const targetId = route.query.card as string | undefined;
  if (targetId) {
    queueMode.value = false;
    const idx = reviewCards.value.findIndex((c) => c.id === targetId);
    if (idx >= 0) {
      currentIndex.value = idx;
      flipped.value = false;
    } else {
      appStore.showToast("这张卡片可能已被删除", "info");
    }
  }

  window.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
});

async function loadCards() {
  cards.value = await listFlashcards();
  const buckets = await listDueCards();
  queueIds.value = buckets.queue.map((c) => c.id);
  queueStats.value = {
    due: buckets.due,
    overdue: buckets.overdue,
    fresh: buckets.fresh,
    todayDone: buckets.todayDone,
    pending: buckets.pending
  };
  // 同步侧边栏 badge
  void reviewStore.refresh();
  if (currentIndex.value >= reviewCards.value.length) currentIndex.value = 0;
  flipped.value = false;
}

// 筛选/排序变化时重置翻卡位置
watch([filterCategoryId, filterMastery, sortBy], () => {
  currentIndex.value = 0;
  flipped.value = false;
});

function sourceTitle(card: Flashcard): string | undefined {
  return docStore.documents.find((d) => d.id === card.documentId)?.title;
}

function gotoSource(card: Flashcard) {
  router.push(`/library/${card.documentId}`);
}

function next() {
  if (currentIndex.value < total.value - 1) {
    currentIndex.value++;
    flipped.value = false;
  }
}

function prev() {
  if (currentIndex.value > 0) {
    currentIndex.value--;
    flipped.value = false;
  }
}

async function rate(mastery: Mastery) {
  if (!currentCard.value) return;
  await markMastery(currentCard.value.id, mastery);
  appStore.showToast(mastery === 2 ? "已标记掌握" : "已记录，稍后复习", "success");
  if (mastery === 2) {
    companionStore.addAffection("reviewCard", "这张卡片你已经掌握啦，记忆力越来越强！🧠 好感度 +4");
  }
  await loadCards();
  if (queueMode.value) {
    // 队列模式：刚评分的卡片已离开队列，索引保持不变即为下一张
    flipped.value = false;
    if (currentIndex.value >= total.value) currentIndex.value = Math.max(0, total.value - 1);
    return;
  }
  // 全部卡片模式：自动翻到下一张
  if (currentIndex.value < total.value - 1) {
    next();
  } else {
    flipped.value = false;
  }
}

async function rateFromList(m: CardWithMeta, mastery: Mastery) {
  await markMastery(m.card.id, mastery);
  if (mastery === 2) {
    companionStore.addAffection("reviewCard", "这张卡片你已经掌握啦！🧠 好感度 +4");
  }
  appStore.showToast("掌握度已更新", "success");
  await loadCards();
}

async function toggleSuspend(card: Flashcard) {
  const next = !card.suspended;
  await setSuspended(card.id, next);
  appStore.showToast(next ? "已暂停复习，不再进入队列" : "已恢复复习", "success");
  await loadCards();
}

/** 顶部进度百分比 */
const progressPercent = computed(() =>
  total.value === 0 ? 0 : Math.round(((currentIndex.value + 1) / total.value) * 100)
);

/** 下次复习时间的可读文案 */
function nextReviewText(card: Flashcard): string {
  if (!card.nextReviewAt) return "未安排";
  const now = Date.now();
  const ts = new Date(card.nextReviewAt).getTime();
  if (Number.isNaN(ts)) return "未安排";
  const diff = ts - now;
  if (diff <= 0) return "待复习";
  const days = Math.ceil(diff / DAY_MS_LOCAL);
  if (days <= 1) {
    const hours = Math.max(1, Math.round(diff / 3600000));
    return hours < 24 ? `${hours} 小时后` : "明天";
  }
  return `${days} 天后`;
}

const DAY_MS_LOCAL = 24 * 3600 * 1000;

/** 键盘快捷键：←/→ 翻页、空格翻面、1/2/3 标记 */
function onKeydown(e: KeyboardEvent) {
  if (viewMode.value !== "review") return;
  const el = e.target as HTMLElement | null;
  if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === "ArrowLeft") {
    e.preventDefault();
    prev();
  } else if (e.key === "ArrowRight") {
    e.preventDefault();
    next();
  } else if (e.key === " ") {
    e.preventDefault();
    flipped.value = !flipped.value;
  } else if (e.key === "1") {
    void rate(0);
  } else if (e.key === "2") {
    void rate(1);
  } else if (e.key === "3") {
    void rate(2);
  }
}

function askDelete(card?: Flashcard) {
  deleteTargetId.value = card?.id ?? currentCard.value?.id ?? "";
  if (deleteTargetId.value) showDeleteDialog.value = true;
}

const deleteTargetId = ref("");

async function confirmDelete() {
  if (!deleteTargetId.value) return;
  await deleteFlashcard(deleteTargetId.value);
  appStore.showToast("卡片已删除", "success");
  showDeleteDialog.value = false;
  await loadCards();
}

const masteryLabel: Record<Mastery, string> = { 0: "不熟悉", 1: "基本掌握", 2: "已掌握" };
const masteryColor: Record<Mastery, string> = {
  0: "bg-red-50 text-red-600",
  1: "bg-amber-50 text-amber-600",
  2: "bg-emerald-50 text-emerald-600"
};
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <div class="mb-5 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-slate-900">学习中心</h1>
        <p class="mt-1 text-sm text-slate-500">翻面查看答案，标记掌握程度，让知识真正被记住。</p>
      </div>
      <!-- 视图切换 -->
      <div class="flex rounded-lg bg-slate-100 p-1">
        <button
          class="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition"
          :class="viewMode === 'review' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500'"
          @click="viewMode = 'review'"
        >
          <RotateCcw :size="14" /> 复习
        </button>
        <button
          class="flex items-center gap-1 rounded-md px-3 py-1.5 text-sm transition"
          :class="viewMode === 'list' ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-500'"
          @click="viewMode = 'list'"
        >
          <List :size="14" /> 列表
        </button>
      </div>
    </div>

    <EmptyState
      v-if="cards.length === 0"
      title="还没有学习卡片"
      description="可从资料生成学习卡片，把知识变成可复习的记忆卡片。"
    >
      <router-link to="/library" class="btn-primary">去资料库看看</router-link>
    </EmptyState>

    <template v-else>
      <!-- 筛选工具条 -->
      <div class="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-white p-3">
        <span class="flex items-center gap-1 text-xs text-slate-400">
          <Filter :size="14" /> 筛选
        </span>
        <!-- 分类下拉 -->
        <select v-model="filterCategoryId" class="input-base w-36 py-1.5">
          <option v-for="c in categoryOptions" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
        <!-- 熟悉度下拉 -->
        <select v-model="filterMastery" class="input-base w-32 py-1.5">
          <option value="">全部熟悉度</option>
          <option :value="0">不熟悉</option>
          <option :value="1">基本掌握</option>
          <option :value="2">已掌握</option>
        </select>
        <!-- 排序下拉 -->
        <select v-model="sortBy" class="input-base w-36 py-1.5">
          <option value="createdAt">按创建时间</option>
          <option value="mastery">按熟悉程度</option>
          <option value="category">按分类</option>
        </select>
        <span class="ml-auto text-xs text-slate-400">{{ filteredCards.length }} 张</span>
      </div>

      <!-- 复习视图 -->
      <template v-if="viewMode === 'review'">
        <!-- 队列切换 -->
        <div class="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-white px-3 py-2 text-xs">
          <button
            class="flex items-center gap-1 rounded-full px-2.5 py-1 transition"
            :class="queueMode ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
            @click="queueMode = true"
          >
            <Layers3 :size="13" /> 复习队列 {{ queueStats.pending }}
          </button>
          <button
            class="flex items-center gap-1 rounded-full px-2.5 py-1 transition"
            :class="!queueMode ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
            @click="queueMode = false"
          >
            <List :size="13" /> 全部卡片 {{ cards.length }}
          </button>
          <span v-if="queueStats.overdue" class="rounded-full bg-red-50 px-2 py-0.5 text-red-500">
            逾期 {{ queueStats.overdue }}
          </span>
          <span v-if="queueStats.fresh" class="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
            新卡 {{ queueStats.fresh }}
          </span>
          <span class="ml-auto text-slate-400">今日已复习 {{ queueStats.todayDone }} 张</span>
        </div>

        <EmptyState
          v-if="total === 0"
          :title="queueMode && cards.length > 0 ? '今天的复习都完成啦 🎉' : '没有符合条件的卡片'"
          :description="
            queueMode && cards.length > 0
              ? `今日已复习 ${queueStats.todayDone} 张，明天再来继续吧。`
              : '调整筛选条件，或换个熟悉度试试。'
          "
        >
          <button
            v-if="queueMode && cards.length > 0"
            class="btn-secondary"
            @click="queueMode = false"
          >
            看看全部卡片
          </button>
          <button
            v-else
            class="btn-secondary"
            @click="filterCategoryId = ''; filterMastery = ''; sortBy = 'createdAt'"
          >
            清除筛选
          </button>
        </EmptyState>

        <template v-else>
          <div class="mb-2 h-1 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              class="h-full rounded-full bg-brand-500 transition-all"
              :style="{ width: progressPercent + '%' }"
            ></div>
          </div>
          <div class="mb-4 flex items-center justify-between text-sm text-slate-500">
            <span>第 {{ currentIndex + 1 }} / {{ total }} 张</span>
            <span class="rounded px-2 py-0.5 text-xs" :class="masteryColor[currentCard!.mastery]">
              {{ masteryLabel[currentCard!.mastery] }}
            </span>
          </div>

          <div
            class="card relative flex min-h-[220px] cursor-pointer select-none flex-col items-center justify-center p-8 text-center transition hover:shadow-md"
            @click="flipped = !flipped"
          >
            <div v-if="currentCard" class="absolute right-3 top-3 flex items-center gap-1">
              <button
                class="rounded p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600"
                :title="currentCard.suspended ? '恢复复习' : '暂停复习'"
                @click.stop="toggleSuspend(currentCard)"
              >
                <component :is="currentCard.suspended ? PlayCircle : PauseCircle" :size="16" />
              </button>
              <button
                class="rounded p-1.5 text-slate-300 hover:bg-red-50 hover:text-red-500"
                @click.stop="askDelete()"
              >
                <Trash2 :size="16" />
              </button>
            </div>

            <template v-if="currentCard">
              <div v-if="!flipped">
                <div class="mb-2 text-xs uppercase tracking-wide text-slate-400">问题</div>
                <div class="text-lg font-semibold leading-relaxed text-slate-800">{{ currentCard.question }}</div>
              </div>
              <div v-else>
                <div class="mb-2 text-xs uppercase tracking-wide text-emerald-500">答案</div>
                <div class="text-base leading-relaxed text-slate-700">{{ currentCard.answer }}</div>
              </div>
              <div class="mt-6 text-xs text-slate-400">点击卡片{{ flipped ? "回到问题" : "查看答案" }}</div>
            </template>
          </div>

          <div v-if="currentMeta" class="mt-3 flex justify-center gap-3">
            <button class="flex items-center gap-1 text-xs text-brand-500 hover:text-brand-700" @click="gotoSource(currentCard!)">
              <FileText :size="12" /> 来源：{{ currentMeta.docTitle }}
            </button>
            <span class="text-xs text-slate-400">· {{ currentMeta.categoryName }}</span>
            <span v-if="currentCard" class="text-xs text-slate-400">
              · 已复习 {{ currentCard.reviewCount }} 次 · {{ nextReviewText(currentCard) }}
            </span>
          </div>

          <div v-if="currentCard" class="mt-5 grid grid-cols-3 gap-2">
            <button class="btn-secondary border-red-200 text-red-600 hover:bg-red-50" @click="rate(0)">不熟悉</button>
            <button class="btn-secondary border-amber-200 text-amber-600 hover:bg-amber-50" @click="rate(1)">基本掌握</button>
            <button class="btn-secondary border-emerald-200 text-emerald-600 hover:bg-emerald-50" @click="rate(2)">已掌握</button>
          </div>

          <div class="mt-4 flex items-center justify-between">
            <button class="btn-ghost" :disabled="currentIndex === 0" @click="prev">
              <ArrowLeft :size="16" /> 上一张
            </button>
            <button class="btn-ghost" :disabled="currentIndex === total - 1" @click="next">
              下一张 <ArrowRight :size="16" />
            </button>
          </div>
        </template>
      </template>

      <!-- 列表视图（按分类分组） -->
      <template v-else>
        <EmptyState
          v-if="filteredCards.length === 0"
          title="没有符合条件的卡片"
          description="调整筛选条件试试。"
        >
          <button class="btn-secondary" @click="filterCategoryId = ''; filterMastery = ''; sortBy = 'createdAt'">清除筛选</button>
        </EmptyState>

        <div v-else class="space-y-6">
          <div v-for="group in groupedByCategory" :key="group.name">
            <div class="mb-2 flex items-center gap-2">
              <Layers :size="14" class="text-slate-400" />
              <span class="text-sm font-medium text-slate-600">{{ group.name }}</span>
              <span class="text-xs text-slate-400">（{{ group.items.length }}）</span>
            </div>
            <div class="space-y-2">
              <div
                v-for="m in group.items"
                :key="m.card.id"
                class="card flex items-start gap-3 p-4"
              >
                <div class="min-w-0 flex-1">
                  <div class="mb-1 flex items-center gap-2">
                    <span class="rounded px-1.5 py-0.5 text-xs" :class="masteryColor[m.card.mastery]">
                      {{ masteryLabel[m.card.mastery] }}
                    </span>
                  </div>
                  <div class="text-sm font-medium text-slate-800">{{ m.card.question }}</div>
                  <div class="mt-1 text-sm text-slate-500">{{ m.card.answer }}</div>
                  <button class="mt-2 flex items-center gap-1 text-xs text-brand-500 hover:text-brand-700" @click="gotoSource(m.card)">
                    <FileText :size="12" /> 来源：{{ m.docTitle }}
                  </button>
                </div>
                <div class="flex shrink-0 flex-col gap-1.5">
                  <button class="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50" @click="rateFromList(m, 0)">不熟悉</button>
                  <button class="rounded px-2 py-1 text-xs text-amber-500 hover:bg-amber-50" @click="rateFromList(m, 1)">基本</button>
                  <button class="rounded px-2 py-1 text-xs text-emerald-500 hover:bg-emerald-50" @click="rateFromList(m, 2)">掌握</button>
                  <button class="rounded px-2 py-1 text-xs text-slate-400 hover:bg-red-50 hover:text-red-500" @click="askDelete(m.card)">
                    <Trash2 :size="14" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </template>

    <ConfirmDialog
      :visible="showDeleteDialog"
      title="删除卡片"
      message="删除后不可恢复，确定要删除这张卡片吗？"
      confirm-text="删除"
      danger
      @confirm="confirmDelete"
      @cancel="showDeleteDialog = false"
    />
  </div>
</template>
