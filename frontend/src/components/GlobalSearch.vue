<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useDocumentStore } from "@/stores/documentStore";
import { useTaskStore } from "@/stores/taskStore";
import { listFlashcards } from "@/services/flashcardService";
import { searchAll, type GlobalHit, type GlobalHitKind } from "@/services/searchService";
import HighlightText from "@/components/HighlightText.vue";
import { Search, FileText, Layers, CheckSquare, CornerDownLeft } from "lucide-vue-next";

const router = useRouter();
const docStore = useDocumentStore();
const taskStore = useTaskStore();

const open = ref(false);
const keyword = ref("");
const activeIndex = ref(0);
const inputEl = ref<HTMLInputElement | null>(null);
const cards = ref<{ id: string; documentId: string; question: string; answer: string }[]>([]);

const hits = computed<GlobalHit[]>(() =>
  searchAll({
    keyword: keyword.value,
    documents: docStore.documents,
    cards: cards.value,
    tasks: taskStore.tasks
  })
);

const grouped = computed(() => {
  const map: Record<GlobalHitKind, GlobalHit[]> = { document: [], card: [], task: [] };
  for (const h of hits.value) map[h.kind].push(h);
  return map;
});

const flat = computed(() => [...grouped.value.document, ...grouped.value.card, ...grouped.value.task]);

const kindLabel: Record<GlobalHitKind, string> = {
  document: "资料",
  card: "卡片",
  task: "任务"
};
const kindIcon = { document: FileText, card: Layers, task: CheckSquare };

async function openSearch() {
  if (open.value) return;
  open.value = true;
  keyword.value = "";
  activeIndex.value = 0;
  if (cards.value.length === 0) {
    try {
      cards.value = (await listFlashcards()).map((c) => ({
        id: c.id,
        documentId: c.documentId,
        question: c.question,
        answer: c.answer
      }));
    } catch {
      /* 忽略：卡片检索不可用时只搜资料与任务 */
    }
  }
  await nextTick();
  inputEl.value?.focus();
}

function closeSearch() {
  open.value = false;
  keyword.value = "";
}

function move(delta: number) {
  const total = flat.value.length;
  if (total === 0) return;
  activeIndex.value = (activeIndex.value + delta + total) % total;
}

function goto(hit: GlobalHit | undefined) {
  if (!hit) return;
  // 先记下关键词：closeSearch 会清空它，否则跳转参数会变成空串
  const kw = keyword.value.trim();
  closeSearch();
  if (hit.kind === "document") {
    router.push(`/library/${hit.id}${kw ? `?hit=${encodeURIComponent(kw)}` : ""}`);
  } else if (hit.kind === "card") {
    router.push(`/study?card=${hit.id}`);
  } else {
    router.push(`/tasks?task=${hit.id}`);
  }
}

function onKeydown(e: KeyboardEvent) {
  const isOpenCombo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
  if (isOpenCombo) {
    e.preventDefault();
    if (open.value) closeSearch();
    else void openSearch();
    return;
  }
  if (!open.value) return;
  if (e.key === "Escape") {
    e.preventDefault();
    closeSearch();
  } else if (e.key === "ArrowDown") {
    e.preventDefault();
    move(1);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    move(-1);
  } else if (e.key === "Enter") {
    e.preventDefault();
    goto(flat.value[activeIndex.value]);
  }
}

/** 供移动端顶栏等外部入口触发 */
function onExternalOpen() {
  void openSearch();
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("knowflow:open-search", onExternalOpen);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("knowflow:open-search", onExternalOpen);
});

watch(keyword, () => {
  activeIndex.value = 0;
});

/** 结果项在扁平列表中的起始下标，用于高亮判断 */
function indexOf(hit: GlobalHit): number {
  return flat.value.indexOf(hit);
}
</script>

<template>
  <transition name="dialog">
    <div v-if="open" class="fixed inset-0 z-50 flex items-start justify-center px-4 pt-[12vh]">
      <div class="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" @click="closeSearch"></div>

      <div
        class="relative w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
        role="dialog"
        aria-modal="true"
        aria-label="全局搜索"
      >
        <!-- 输入 -->
        <div class="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <Search :size="18" class="shrink-0 text-slate-400" />
          <input
            ref="inputEl"
            v-model="keyword"
            type="text"
            class="w-full bg-transparent text-base text-slate-800 outline-none placeholder:text-slate-400"
            placeholder="搜索资料、卡片、任务…"
            aria-label="搜索关键词"
          />
          <button class="rounded px-1.5 py-0.5 text-xs text-slate-400 ring-1 ring-slate-200" @click="closeSearch">
            Esc
          </button>
        </div>

        <!-- 结果 -->
        <div class="max-h-[52vh] overflow-y-auto py-2">
          <p v-if="!keyword.trim()" class="px-4 py-6 text-center text-sm text-slate-400">
            输入关键词开始搜索；支持标题、正文、标签、卡片问答与任务描述
          </p>
          <p v-else-if="flat.length === 0" class="px-4 py-6 text-center text-sm text-slate-400">
            没有匹配结果
          </p>

          <template v-else>
            <div v-for="kind in (['document', 'card', 'task'] as GlobalHitKind[])" :key="kind">
              <template v-if="grouped[kind].length > 0">
                <div class="px-4 pb-1 pt-2 text-xs font-medium text-slate-400">
                  {{ kindLabel[kind] }} · {{ grouped[kind].length }}
                </div>
                <button
                  v-for="hit in grouped[kind]"
                  :key="`${hit.kind}-${hit.id}`"
                  class="flex w-full items-start gap-3 px-4 py-2 text-left transition"
                  :class="indexOf(hit) === activeIndex ? 'bg-brand-50' : 'hover:bg-slate-50'"
                  @mouseenter="activeIndex = indexOf(hit)"
                  @click="goto(hit)"
                >
                  <component :is="kindIcon[hit.kind]" :size="16" class="mt-0.5 shrink-0 text-slate-400" />
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-sm text-slate-800">
                      <HighlightText :text="hit.title" :keyword="keyword" />
                    </div>
                    <div v-if="hit.excerpt" class="mt-0.5 truncate text-xs text-slate-400">
                      <HighlightText :text="hit.excerpt" :keyword="keyword" />
                    </div>
                  </div>
                  <span v-if="hit.meta" class="shrink-0 text-[11px] text-slate-300">{{ hit.meta }}</span>
                </button>
              </template>
            </div>
          </template>
        </div>

        <!-- 底部提示 -->
        <div class="flex items-center gap-3 border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
          <span class="flex items-center gap-1"><kbd class="rounded bg-slate-100 px-1">↑</kbd><kbd class="rounded bg-slate-100 px-1">↓</kbd> 选择</span>
          <span class="flex items-center gap-1"><CornerDownLeft :size="12" /> 打开</span>
          <span class="ml-auto">⌘K / Ctrl+K 随时唤出</span>
        </div>
      </div>
    </div>
  </transition>
</template>
