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
  X
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
  } catch (e) {
    error.value = e instanceof Error ? e.message : "词库加载失败";
    words.value = [];
  } finally {
    loading.value = false;
  }
}

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

function gotoQuest() {
  router.push({ path: "/study/play/quest", query: { pack: packId.value } });
}

function meaning(w: WordEntry): string {
  return shortMeaning(w.m, 60);
}
</script>

<template>
  <div>
    <p class="mb-4 text-xs text-slate-500">
      按字母翻阅词库，遇到不熟的词点「加入复习」，交给复习计划安排回看。
      想边玩边背就去
      <button class="text-brand-600 hover:underline" @click="gotoQuest">闯关</button>。
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

    <!-- 搜索 + 首字母 -->
    <div class="mb-3 space-y-2 rounded-xl border border-slate-100 bg-white p-3">
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
    <div v-else-if="!total" class="card p-6 text-center text-sm text-slate-500">
      没找到匹配的词，换个关键词或清掉首字母筛选。
    </div>

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
