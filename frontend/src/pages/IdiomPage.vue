<script setup lang="ts">
/**
 * 成语学习：172 条常用四字成语，支持搜索、随机、加入复习卡片。
 * 数据来自 data/成语 PDF，由 scripts/build-life-packs.mjs 编译成 packs/idiom.json。
 */
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { Search, X, Shuffle, Plus, CheckCircle2, Quote, Loader2, RotateCcw, Filter } from "lucide-vue-next";
import { loadIdioms, type IdiomEntry } from "@/services/knowledgePack";
import { addWordToReview, markWordKnown } from "@/services/quest/wordCards";
import {
  EMPTY_FILTER,
  LEVEL_META,
  buildFacets,
  filterIdioms,
  loadLevels,
  loadMistakes,
  parseFilter,
  setLevel,
  toQuery,
  type IdiomFilter,
  type IdiomLevel
} from "@/services/idiomPack";
import { useAppStore } from "@/stores/appStore";
import { useReviewStore } from "@/stores/reviewStore";

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const reviewStore = useReviewStore();

const loading = ref(true);
const error = ref("");
const all = ref<IdiomEntry[]>([]);
const active = ref<IdiomEntry | null>(null);
const adding = ref(false);
const addedSet = ref<Set<string>>(new Set());

/** 筛选条件放 URL：这样「含水的四字成语」可以直接复制给别人 */
const filter = ref<IdiomFilter>(parseFilter(route.query as Record<string, unknown>));
const levels = ref<Record<string, IdiomLevel>>(loadLevels());
const mistakes = ref<Record<string, number>>(loadMistakes());

const facets = computed(() => buildFacets(all.value));

onMounted(async () => {
  try {
    all.value = await loadIdioms();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "成语数据加载失败";
  } finally {
    loading.value = false;
  }
});

const filtered = computed(() => filterIdioms(all.value, filter.value, levels.value, mistakes.value));

/** keyword 是 filter.keyword 的便捷绑定（输入框用） */
const keyword = computed({
  get: () => filter.value.keyword,
  set: (v: string) => (filter.value = { ...filter.value, keyword: v })
});

watch(
  filter,
  (f) => router.replace({ query: toQuery(f) }),
  { deep: true }
);

const hasFilter = computed(
  () => JSON.stringify(toQuery(filter.value)) !== JSON.stringify(toQuery(EMPTY_FILTER))
);

function resetFilter() {
  filter.value = { ...EMPTY_FILTER };
}

function toggleLevel(lv: IdiomLevel) {
  filter.value = { ...filter.value, level: filter.value.level === lv ? "all" : lv };
}

/** 三档掌握度：会 → 拉长复习间隔；模糊/不会 → 进队列 */
async function markLevel(item: IdiomEntry, lv: IdiomLevel, e?: Event) {
  e?.stopPropagation();
  const next = levels.value[item.w] === lv ? null : lv;
  levels.value = setLevel(item.w, next);
  if (!next) {
    appStore.showToast(`已取消「${item.w}」的标记`, "info");
    return;
  }
  if (next === "known") {
    const touched = await markWordKnown(item.w);
    appStore.showToast(
      touched ? `「${item.w}」标为会，复习间隔拉长` : `「${item.w}」标为会（还没进过复习队列）`,
      "success"
    );
    return;
  }
  // 模糊 / 不会：进现有的 SRS 队列，不新建机制
  if (!addedSet.value.has(item.w)) {
    try {
      await addWordToReview("idiom", { w: item.w, p: "", m: item.m }, next === "unknown");
      addedSet.value = new Set([...addedSet.value, item.w]);
      void reviewStore.refresh();
    } catch (err) {
      appStore.showToast(err instanceof Error ? err.message : "加入失败", "error");
    }
  }
  appStore.showToast(
    next === "unknown" ? `「${item.w}」已加入复习（不会）` : `「${item.w}」已加入复习（模糊）`,
    "success"
  );
}

function open(item: IdiomEntry) {
  active.value = item;
}

function randomOne() {
  if (all.value.length === 0) return;
  const idx = Math.floor(Math.random() * all.value.length);
  active.value = all.value[idx];
}

async function addToReview(item: IdiomEntry) {
  if (addedSet.value.has(item.w)) {
    appStore.showToast("这条已经在复习队列里了", "info");
    return;
  }
  adding.value = true;
  try {
    await addWordToReview("idiom", { w: item.w, p: "", m: item.m }, false);
    addedSet.value = new Set([...addedSet.value, item.w]);
    void reviewStore.refresh();
    appStore.showToast(`「${item.w}」已加入学习中心`, "success");
  } catch (e) {
    appStore.showToast(e instanceof Error ? e.message : "加入失败", "error");
  } finally {
    adding.value = false;
  }
}
</script>

<template>
  <div>
    <!-- 工具条 -->
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <div class="relative min-w-[200px] flex-1">
        <Search :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          v-model="keyword"
          class="input-base pl-9"
          placeholder="搜索成语或释义，如「高兴」「一鸣惊人」"
          aria-label="搜索成语"
        />
        <button
          v-if="keyword"
          class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          aria-label="清空搜索"
          @click="keyword = ''"
        >
          <X :size="14" />
        </button>
      </div>
      <span class="text-xs text-slate-400">共 {{ all.length }} 条</span>
      <button class="btn-secondary" :disabled="all.length === 0" @click="randomOne">
        <Shuffle :size="14" /> 随机一条
      </button>
    </div>

    <!-- 筛选：首字 / 尾字 / 字数 / 掌握度 / 只看错过（全部写进 URL） -->
    <div class="mb-4 rounded-xl border border-slate-100 bg-white p-3">
      <div class="flex flex-wrap items-center gap-2">
        <span class="flex items-center gap-1 text-xs text-slate-400"><Filter :size="12" /> 筛选</span>

        <select
          :value="filter.first"
          class="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
          aria-label="首字"
          @change="filter = { ...filter, first: ($event.target as HTMLSelectElement).value }"
        >
          <option value="">首字不限</option>
          <option v-for="f in facets.firsts" :key="'f' + f.ch" :value="f.ch">{{ f.ch }}（{{ f.count }}）</option>
        </select>

        <select
          :value="filter.last"
          class="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600"
          aria-label="尾字"
          @change="filter = { ...filter, last: ($event.target as HTMLSelectElement).value }"
        >
          <option value="">尾字不限</option>
          <option v-for="l in facets.lasts" :key="'l' + l.ch" :value="l.ch">{{ l.ch }}（{{ l.count }}）</option>
        </select>

        <div class="flex items-center gap-1">
          <button
            v-for="l in facets.lengths"
            :key="'n' + l.len"
            class="rounded-full px-2 py-1 text-xs transition"
            :class="filter.len === l.len ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
            @click="filter = { ...filter, len: filter.len === l.len ? 0 : l.len }"
          >
            {{ l.len }} 字
          </button>
        </div>

        <span class="mx-1 h-4 w-px bg-slate-200"></span>

        <button
          class="rounded-full px-2 py-1 text-xs transition"
          :class="filter.level === 'known' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-600'"
          @click="toggleLevel('known')"
        >
          会
        </button>
        <button
          class="rounded-full px-2 py-1 text-xs transition"
          :class="filter.level === 'fuzzy' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-600'"
          @click="toggleLevel('fuzzy')"
        >
          模糊
        </button>
        <button
          class="rounded-full px-2 py-1 text-xs transition"
          :class="filter.level === 'unknown' ? 'bg-rose-500 text-white' : 'bg-rose-50 text-rose-500'"
          @click="toggleLevel('unknown')"
        >
          不会
        </button>
        <button
          class="rounded-full px-2 py-1 text-xs transition"
          :class="filter.level === 'none' ? 'bg-slate-700 text-white' : 'bg-slate-100 text-slate-600'"
          @click="filter = { ...filter, level: filter.level === 'none' ? 'all' : 'none' }"
        >
          未标
        </button>
        <button
          class="rounded-full px-2 py-1 text-xs transition"
          :class="filter.onlyMistake ? 'bg-orange-500 text-white' : 'bg-orange-50 text-orange-600'"
          @click="filter = { ...filter, onlyMistake: !filter.onlyMistake }"
        >
          只看错过
        </button>

        <button
          v-if="hasFilter"
          class="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
          @click="resetFilter"
        >
          <RotateCcw :size="12" /> 清空筛选
        </button>
      </div>
      <p class="mt-2 text-[11px] text-slate-400">
        命中 {{ filtered.length }} 条 · 筛选条件已写进地址栏，可直接复制分享
      </p>
    </div>

    <div v-if="loading" class="card flex items-center gap-2 p-6 text-sm text-slate-500">
      <Loader2 :size="16" class="animate-spin" /> 正在加载成语…
    </div>
    <div v-else-if="error" class="card p-6 text-sm text-slate-500">{{ error }}</div>

    <!-- 列表 -->
    <div v-else class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="item in filtered"
        :key="item.w"
        class="card flex flex-col items-start gap-1 p-3 text-left transition hover:shadow-md"
        @click="open(item)"
      >
        <div class="flex w-full items-center gap-2">
          <span class="text-base font-semibold tracking-wide text-slate-900">{{ item.w }}</span>
          <span
            v-if="levels[item.w]"
            class="rounded px-1 py-0.5 text-[10px]"
            :class="LEVEL_META[levels[item.w]].cls"
          >
            {{ LEVEL_META[levels[item.w]].label }}
          </span>
          <span
            v-if="mistakes[item.w]"
            class="rounded bg-orange-50 px-1 py-0.5 text-[10px] text-orange-500"
            :title="`在趣味学习里错过 ${mistakes[item.w]} 次`"
          >
            错 {{ mistakes[item.w] }}
          </span>
          <CheckCircle2
            v-if="addedSet.has(item.w)"
            :size="13"
            class="ml-auto shrink-0 text-emerald-500"
            aria-label="已加入复习"
          />
        </div>
        <p class="line-clamp-2 text-xs leading-relaxed text-slate-500">{{ item.m }}</p>

        <!-- 三档标记：不打开详情也能快速过一遍 -->
        <div class="mt-1 flex w-full gap-1">
          <button
            v-for="lv in (['known', 'fuzzy', 'unknown'] as const)"
            :key="lv"
            class="flex-1 rounded px-1 py-0.5 text-[11px] transition"
            :class="
              levels[item.w] === lv
                ? LEVEL_META[lv].cls + ' font-medium'
                : 'bg-slate-50 text-slate-400 hover:bg-slate-100'
            "
            @click="markLevel(item, lv, $event)"
          >
            {{ LEVEL_META[lv].label }}
          </button>
        </div>
      </button>
      <p v-if="filtered.length === 0" class="col-span-full py-10 text-center text-sm text-slate-400">
        没有匹配的成语，换个关键词试试
      </p>
    </div>

    <!-- 详情弹层 -->
    <div
      v-if="active"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      @click.self="active = null"
    >
      <div class="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div class="flex items-start gap-2">
          <h2 class="text-2xl font-bold tracking-wider text-slate-900">{{ active.w }}</h2>
          <button
            class="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100"
            aria-label="关闭"
            @click="active = null"
          >
            <X :size="18" />
          </button>
        </div>

        <p class="mt-3 text-sm leading-relaxed text-slate-700">{{ active.m }}</p>

        <div v-if="active.from" class="mt-3 rounded-lg bg-slate-50 p-3">
          <div class="mb-1 flex items-center gap-1 text-[11px] font-medium text-slate-500">
            <Quote :size="12" /> 出处
          </div>
          <p class="text-xs leading-relaxed text-slate-600">{{ active.from }}</p>
        </div>

        <div class="mt-4 flex items-center gap-2">
          <span class="text-xs text-slate-400">掌握度</span>
          <button
            v-for="lv in (['known', 'fuzzy', 'unknown'] as const)"
            :key="'d' + lv"
            class="rounded-full px-2.5 py-1 text-xs transition"
            :class="levels[active.w] === lv ? LEVEL_META[lv].cls + ' font-medium' : 'bg-slate-100 text-slate-500'"
            @click="markLevel(active, lv)"
          >
            {{ LEVEL_META[lv].label }}
          </button>
          <span v-if="mistakes[active.w]" class="ml-auto text-xs text-orange-500">
            在趣味学习里错过 {{ mistakes[active.w] }} 次
          </span>
        </div>

        <div class="mt-5 flex gap-2">
          <button class="btn-primary flex-1" :disabled="adding" @click="addToReview(active)">
            <Loader2 v-if="adding" :size="14" class="animate-spin" />
            <CheckCircle2 v-else-if="addedSet.has(active.w)" :size="14" />
            <Plus v-else :size="14" />
            {{ addedSet.has(active.w) ? "已加入复习" : "加入复习卡片" }}
          </button>
          <button class="btn-secondary" @click="active = null">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>
