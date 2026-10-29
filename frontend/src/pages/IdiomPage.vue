<script setup lang="ts">
/**
 * 成语学习：172 条常用四字成语，支持搜索、随机、加入复习卡片。
 * 数据来自 data/成语 PDF，由 scripts/build-life-packs.mjs 编译成 packs/idiom.json。
 */
import { computed, onMounted, ref } from "vue";
import { Search, X, Shuffle, Plus, CheckCircle2, Quote, Loader2 } from "lucide-vue-next";
import { loadIdioms, type IdiomEntry } from "@/services/knowledgePack";
import { addWordToReview } from "@/services/quest/wordCards";
import { useAppStore } from "@/stores/appStore";
import { useReviewStore } from "@/stores/reviewStore";

const appStore = useAppStore();
const reviewStore = useReviewStore();

const loading = ref(true);
const error = ref("");
const all = ref<IdiomEntry[]>([]);
const keyword = ref("");
const active = ref<IdiomEntry | null>(null);
const adding = ref(false);
const addedSet = ref<Set<string>>(new Set());

onMounted(async () => {
  try {
    all.value = await loadIdioms();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "成语数据加载失败";
  } finally {
    loading.value = false;
  }
});

const filtered = computed(() => {
  const kw = keyword.value.trim();
  if (!kw) return all.value;
  return all.value.filter((i) => i.w.includes(kw) || i.m.includes(kw));
});

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
          <CheckCircle2
            v-if="addedSet.has(item.w)"
            :size="13"
            class="ml-auto shrink-0 text-emerald-500"
            aria-label="已加入复习"
          />
        </div>
        <p class="line-clamp-2 text-xs leading-relaxed text-slate-500">{{ item.m }}</p>
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
