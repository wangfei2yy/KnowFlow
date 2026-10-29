<script setup lang="ts">
/**
 * 单词学习：把词库当成「可翻阅的清单」，而不是只能靠闯关撞见。
 *
 * 4000+ 条一次全渲染会卡，所以用固定行高的窗口化列表（只渲染视口附近的几十行），
 * 不引第三方库：行高固定 → 起始下标 = scrollTop / 行高，够用且可控。
 */
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "@/stores/appStore";
import { useReviewStore } from "@/stores/reviewStore";
import { loadPackIndex, loadWords, type PackMeta } from "@/services/knowledgePack";
import { shortMeaning, type WordEntry } from "@/services/quest/engine";
import {
  DRILL,
  levelRange,
  loadDrillProgress,
  summarizeDrill,
  type LevelMap
} from "@/services/wordLearn";
import { addWordToReview } from "@/services/quest/wordCards";
import { listFlashcards } from "@/services/flashcardService";
import { IS_MINITOOL } from "@/utils/runtime";
import {
  Search,
  Loader2,
  Plus,
  Check,
  Gamepad2,
  ArrowUpDown,
  X,
  Layers,
  BookOpen,
  Play,
  CheckCircle2
} from "lucide-vue-next";

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const reviewStore = useReviewStore();

/** 行高与视口高度要和模板里的数值保持一致 */
const ROW_H = 68;
const VIEW_H = 520;

const packs = ref<PackMeta[]>([]);
const packId = ref((route.query.pack as string) || "cet4");
const words = ref<WordEntry[]>([]);
const loading = ref(true);
const error = ref("");

const keyword = ref("");
const letter = ref("");
const added = ref<Set<string>>(new Set());
const addingWord = ref("");

const scrollTop = ref(0);
const scrollEl = ref<HTMLElement | null>(null);

/** 词表 / 背单词 两个视图：同一个页面的两种用法，不另开入口 */
const mode = ref<"list" | "drill">((route.query.mode as string) === "drill" ? "drill" : "list");
const drillMap = ref<LevelMap>({});

/** 只保留真正的单词包，成语有自己的页面 */
const wordPacks = computed(() => packs.value.filter((p) => p.kind === "words" && p.id !== "idiom"));
const packTitle = computed(() => packs.value.find((p) => p.id === packId.value)?.title ?? "");

onMounted(async () => {
  if (IS_MINITOOL) {
    appStore.showToast("单词学习需要联网加载词库，请在网页版使用", "info");
    return;
  }
  try {
    const index = await loadPackIndex();
    packs.value = index.packs;
    if (!wordPacks.value.some((p) => p.id === packId.value)) {
      packId.value = wordPacks.value[0]?.id ?? "cet4";
    }
  } catch (e) {
    console.warn("[KnowFlow] 词库索引加载失败：", e);
  }
  await Promise.all([loadPack(packId.value), refreshAdded()]);
});

async function refreshAdded() {
  try {
    const cards = await listFlashcards();
    added.value = new Set(cards.map((c) => c.question));
  } catch {
    added.value = new Set();
  }
}

async function loadPack(id: string) {
  loading.value = true;
  error.value = "";
  try {
    const list = await loadWords(id);
    // 词库本身是乱序版，浏览时按字母排更好找
    words.value = [...list].sort((a, b) => a.w.localeCompare(b.w));
    letter.value = "";
    keyword.value = "";
    scrollTop.value = 0;
    if (scrollEl.value) scrollEl.value.scrollTop = 0;
    drillMap.value = loadDrillProgress(id);
  } catch (e) {
    error.value = e instanceof Error ? e.message : "词库加载失败";
    words.value = [];
  } finally {
    loading.value = false;
  }
}

// 地址栏改 ?pack 也要跟着换（分享链接、浏览器前进后退都走这条），
// 否则页面停在上一个词库、URL 却显示新词库，两者对不上
watch(
  () => route.query.pack,
  (v) => {
    const id = String(v ?? "");
    if (!id || id === packId.value) return;
    // 词库索引已加载时只接受真正的单词包；未加载完则先放行，由 loadPack 自己报错
    if (packs.value.length && !wordPacks.value.some((p) => p.id === id)) return;
    packId.value = id;
    void loadPack(id);
  }
);

watch(
  () => route.query.mode,
  (v) => {
    const next = v === "drill" ? "drill" : "list";
    if (next !== mode.value) mode.value = next;
  }
);

function switchPack(id: string) {
  if (id === packId.value) return;
  packId.value = id;
  router.replace({ path: "/study/words", query: { pack: id } });
  void loadPack(id);
}

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  return words.value.filter((w) => {
    if (letter.value && (w.w[0] ?? "").toUpperCase() !== letter.value) return false;
    if (!kw) return true;
    return w.w.toLowerCase().includes(kw) || w.m.includes(kw);
  });
});

/** 每个首字母有多少词，用来决定显示哪些字母 */
const letterCounts = computed(() => {
  const map = new Map<string, number>();
  for (const w of words.value) {
    const k = (w.w[0] ?? "").toUpperCase();
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return map;
});
const letters = computed(() =>
  [...letterCounts.value.keys()].filter((k) => /[A-Z]/.test(k)).sort()
);

/** 当前词库里已经加过复习的词数 */
const addedInPack = computed(() => {
  let n = 0;
  for (const w of words.value) if (added.value.has(w.w)) n += 1;
  return n;
});

// ---------------- 窗口化列表 ----------------
const total = computed(() => filtered.value.length);
const startIdx = computed(() => Math.max(0, Math.floor(scrollTop.value / ROW_H) - 4));
const endIdx = computed(() => Math.min(total.value, Math.ceil((scrollTop.value + VIEW_H) / ROW_H) + 4));
const visible = computed(() => filtered.value.slice(startIdx.value, endIdx.value));
const padTop = computed(() => startIdx.value * ROW_H);

function onScroll(e: Event) {
  scrollTop.value = (e.target as HTMLElement).scrollTop;
}

function resetScroll() {
  scrollTop.value = 0;
  if (scrollEl.value) scrollEl.value.scrollTop = 0;
}

watch([keyword, letter], resetScroll);

// 搜索是更强的意图：输入关键词时自动清掉首字母筛选，否则两个条件「与」起来容易 0 结果
watch(keyword, (v) => {
  if (v.trim() && letter.value) letter.value = "";
});

async function add(word: WordEntry) {
  if (addingWord.value || added.value.has(word.w)) return;
  addingWord.value = word.w;
  try {
    await addWordToReview(packId.value, word, false);
    const next = new Set(added.value);
    next.add(word.w);
    added.value = next;
    void reviewStore.refresh();
  } catch (e) {
    appStore.showToast(e instanceof Error ? e.message : "加入复习失败", "error");
  } finally {
    addingWord.value = "";
  }
}

/** 关卡总览：已过几关、已覆盖多少词、下一关是第几关 */
const drillSummary = computed(() => summarizeDrill(drillMap.value, words.value.length));

function startLevel(i: number) {
  router.push({ path: "/study/words/drill", query: { pack: packId.value, level: i } });
}

function switchMode(next: "list" | "drill") {
  if (mode.value === next) return;
  mode.value = next;
  router.replace({ path: "/study/words", query: { pack: packId.value, ...(next === "drill" ? { mode: "drill" } : {}) } });
}

function levelState(i: number): "passed" | "tried" | "todo" {
  const rec = drillMap.value[i];
  if (rec?.passed) return "passed";
  if (rec) return "tried";
  return "todo";
}

function gotoQuest() {
  router.push({ path: "/study/play/quest", query: { pack: packId.value } });
}

function meaning(w: WordEntry): string {
  return shortMeaning(w.m, 60);
}
</script>

<template>
  <div>
    <!-- 词表 / 背单词：同一份词库的两种用法 -->
    <div class="mb-3 inline-flex rounded-full bg-slate-100 p-0.5 text-xs">
      <button
        class="flex items-center gap-1 rounded-full px-3 py-1 transition"
        :class="mode === 'list' ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'"
        @click="switchMode('list')"
      >
        <BookOpen :size="12" /> 词表
      </button>
      <button
        class="flex items-center gap-1 rounded-full px-3 py-1 transition"
        :class="mode === 'drill' ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'"
        @click="switchMode('drill')"
      >
        <Layers :size="12" /> 背单词
      </button>
    </div>

    <p v-if="mode === 'list'" class="mb-4 text-xs text-slate-500">
      按字母翻阅词库，遇到不熟的词点「加入复习」，交给复习计划安排回看。
    </p>
    <p v-else class="mb-4 text-xs text-slate-500">
      一关 {{ DRILL.perLevel }} 个词，四选一，答完为止（不掉命）；正确率
      {{ Math.round(DRILL.passRate * 100) }}% 算过关。关卡按词量自动划分。
    </p>

    <!-- 词库切换 -->
    <div class="mb-3 flex flex-wrap items-center gap-2">
      <button
        v-for="p in wordPacks"
        :key="p.id"
        class="rounded-full px-3 py-1.5 text-sm transition"
        :class="p.id === packId ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
        @click="switchPack(p.id)"
      >
        {{ p.title }}
        <span class="ml-1 text-xs opacity-70">{{ p.count }}</span>
      </button>
      <span v-if="words.length" class="ml-auto text-xs text-slate-400">
        已加入复习 {{ addedInPack }} / {{ words.length }}
      </span>
    </div>

    <!-- 搜索 + 首字母（词表模式） -->
    <div v-if="mode === 'list'" class="mb-3 space-y-2 rounded-xl border border-slate-100 bg-white p-3">
      <div class="flex items-center gap-2">
        <div class="relative flex-1">
          <Search :size="14" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            v-model="keyword"
            class="input-base w-full py-1.5 pl-8 pr-8 text-sm"
            :placeholder="`在 ${packTitle} 里搜单词或释义`"
            aria-label="搜索单词"
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
        <button class="btn-secondary shrink-0 px-3 py-1.5 text-sm" @click="gotoQuest">
          <Gamepad2 :size="14" /> 去闯关
        </button>
      </div>

      <div class="flex flex-wrap gap-1">
        <button
          class="rounded px-1.5 py-0.5 text-[11px] transition"
          :class="letter === '' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'"
          @click="letter = ''"
        >
          全部
        </button>
        <button
          v-for="l in letters"
          :key="l"
          class="w-6 rounded py-0.5 text-center text-[11px] transition"
          :class="letter === l ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'"
          @click="letter = letter === l ? '' : l"
        >
          {{ l }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="card flex items-center gap-2 p-6 text-sm text-slate-500">
      <Loader2 :size="16" class="animate-spin" /> 正在加载词库…
    </div>
    <div v-else-if="error" class="card p-6 text-sm text-slate-500">{{ error }}</div>

    <!-- 背单词：关卡总览 -->
    <template v-else-if="mode === 'drill'">
      <div class="card p-4">
        <div class="flex flex-wrap items-center gap-3">
          <div>
            <div class="text-sm font-medium text-slate-800">
              已过 {{ drillSummary.cleared }} / {{ drillSummary.levels }} 关
            </div>
            <div class="mt-0.5 text-xs text-slate-500">
              覆盖 {{ drillSummary.wordsDone }} / {{ words.length }} 词
            </div>
          </div>
          <button
            class="btn-primary ml-auto py-2 text-sm"
            :disabled="!drillSummary.levels"
            @click="startLevel(drillSummary.next < drillSummary.levels ? drillSummary.next : 0)"
          >
            <Play :size="14" />
            {{
              drillSummary.cleared >= drillSummary.levels && drillSummary.levels > 0
                ? "重新从第 1 关开始"
                : `继续第 ${drillSummary.next + 1} 关`
            }}
          </button>
        </div>
        <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
          <div
            class="h-full rounded-full bg-emerald-500 transition-all"
            :style="{ width: `${drillSummary.levels ? (drillSummary.cleared / drillSummary.levels) * 100 : 0}%` }"
          />
        </div>
      </div>

      <div class="card mt-3 p-4">
        <div class="mb-2 flex items-center justify-between text-xs text-slate-400">
          <span>全部关卡</span>
          <span class="flex items-center gap-3">
            <span class="flex items-center gap-1">
              <i class="inline-block h-2 w-2 rounded-sm bg-emerald-500"></i> 已过关
            </span>
            <span class="flex items-center gap-1">
              <i class="inline-block h-2 w-2 rounded-sm bg-amber-400"></i> 做过了
            </span>
          </span>
        </div>
        <div class="grid max-h-[420px] grid-cols-6 gap-1.5 overflow-y-auto sm:grid-cols-10">
          <button
            v-for="i in drillSummary.levels"
            :key="i"
            class="flex h-11 flex-col items-center justify-center rounded-lg border text-xs transition"
            :class="
              levelState(i - 1) === 'passed'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300'
                : levelState(i - 1) === 'tried'
                  ? 'border-amber-200 bg-amber-50 text-amber-700 hover:border-amber-300'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-brand-300 hover:bg-brand-50/40'
            "
            :title="`第 ${levelRange(i - 1, words.length).start}~${levelRange(i - 1, words.length).end} 词${
              drillMap[i - 1] ? ` · 最好 ${drillMap[i - 1].best}/${drillMap[i - 1].total}` : ''
            }`"
            @click="startLevel(i - 1)"
          >
            <span class="font-medium">{{ i }}</span>
            <CheckCircle2 v-if="levelState(i - 1) === 'passed'" :size="9" class="opacity-70" />
          </button>
        </div>
        <p class="mt-2 text-[11px] text-slate-400">
          关卡按词量自动划分：共 {{ words.length }} 词 → {{ drillSummary.levels }} 关，最后一关
          {{ levelRange(drillSummary.levels - 1, words.length).end - levelRange(drillSummary.levels - 1, words.length).start + 1 }} 个词。
        </p>
      </div>
    </template>

    <template v-else-if="!total">
      <div class="card p-6 text-center text-sm text-slate-500">
        没找到匹配的词，换个关键词或清掉首字母筛选。
      </div>
    </template>

    <template v-else>
      <div class="mb-2 flex items-center justify-between text-xs text-slate-400">
        <span class="flex items-center gap-1">
          <ArrowUpDown :size="12" /> 共 {{ total }} 个词{{ letter ? `（${letter} 开头）` : "" }}
        </span>
        <span>按字母顺序</span>
      </div>

      <!-- 窗口化列表：只渲染视口附近的行 -->
      <div
        ref="scrollEl"
        class="overflow-y-auto rounded-xl border border-slate-100 bg-white"
        :style="{ height: `${VIEW_H}px` }"
        @scroll.passive="onScroll"
      >
        <div :style="{ height: `${total * ROW_H}px`, position: 'relative' }">
          <div :style="{ transform: `translateY(${padTop}px)` }">
            <div
              v-for="w in visible"
              :key="w.w"
              class="flex items-center gap-3 border-b border-slate-50 px-3"
              :style="{ height: `${ROW_H}px` }"
            >
              <div class="min-w-0 flex-1">
                <div class="flex items-baseline gap-2">
                  <span class="truncate text-sm font-semibold text-slate-800">{{ w.w }}</span>
                  <span v-if="w.p" class="shrink-0 text-[11px] text-slate-400">{{ w.p }}</span>
                </div>
                <div class="line-clamp-2 text-xs leading-snug text-slate-500">{{ meaning(w) }}</div>
              </div>
              <button
                class="shrink-0 rounded-full px-2 py-1 text-[11px] transition"
                :class="
                  added.has(w.w)
                    ? 'bg-emerald-50 text-emerald-600'
                    : 'bg-slate-100 text-slate-500 hover:bg-brand-50 hover:text-brand-700'
                "
                :disabled="added.has(w.w) || addingWord === w.w"
                @click="add(w)"
              >
                <component :is="added.has(w.w) ? Check : Plus" :size="12" class="inline" />
                {{ added.has(w.w) ? "已加入" : "加入复习" }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
