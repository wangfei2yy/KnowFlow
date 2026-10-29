<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  BookOpen,
  Search,
  ArrowLeft,
  Plus,
  CheckCircle2,
  Sparkles,
  Loader2,
  X
} from "lucide-vue-next";
import { loadGrammar, type GrammarTopic } from "@/services/knowledgePack";
import { renderMarkdown, markdownToPlain } from "@/utils/markdown";
import { createDocument } from "@/services/documentService";
import { createFlashcard } from "@/services/flashcardService";
import { generateCardsFromContent, CanceledError } from "@/services/ai/aiService";
import { useDocumentStore } from "@/stores/documentStore";
import { useAppStore } from "@/stores/appStore";
import { useAIStore } from "@/stores/aiStore";
import { useReviewStore } from "@/stores/reviewStore";

const router = useRouter();
const docStore = useDocumentStore();
const appStore = useAppStore();
const aiStore = useAIStore();
const reviewStore = useReviewStore();

const loading = ref(true);
const loadError = ref("");
const topics = ref<GrammarTopic[]>([]);

const keyword = ref("");
const category = ref("");
/** 手机首屏先看目录，桌面端默认打开第一篇 */
const activeId = ref("");
/** 分类标签默认只显示常用的几个，避免把目录挤下去 */
const showAllCategories = ref(false);

const adding = ref(false);
const generating = ref(false);
const genProgress = ref("");
let genAbort: AbortController | null = null;

onMounted(async () => {
  await docStore.loadAll(false);
  try {
    topics.value = await loadGrammar();
    // 桌面端两栏可边看目录边读，默认打开第一篇；手机先停在目录
    if (topics.value.length > 0 && window.innerWidth >= 1024) {
      activeId.value = topics.value[0].id;
    }
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : "语法内容加载失败";
  } finally {
    loading.value = false;
  }
});

/** 分类 + 篇数 */
const categories = computed(() => {
  const map = new Map<string, number>();
  for (const t of topics.value) map.set(t.category, (map.get(t.category) ?? 0) + 1);
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "zh"));
});

/** 折叠时只显示前 8 个专题（按篇数排序，覆盖大部分场景） */
const visibleCategories = computed(() =>
  showAllCategories.value ? categories.value : categories.value.slice(0, 8)
);

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase();
  const list = topics.value.filter((t) => {
    if (category.value && t.category !== category.value) return false;
    if (!kw) return true;
    return t.title.toLowerCase().includes(kw) || t.content.toLowerCase().includes(kw);
  });
  if (!kw) return list;
  // 标题命中的排前面，仅在正文里出现的靠后（避免「搜虚拟却把倒装排第一」）
  const weight = (t: GrammarTopic) => (t.title.toLowerCase().includes(kw) ? 0 : 1);
  return [...list].sort((a, b) => weight(a) - weight(b));
});

/** 当前搜索是否只命中了正文（列表上给出「正文提及」提示） */
function isContentOnly(t: GrammarTopic): boolean {
  const kw = keyword.value.trim().toLowerCase();
  if (!kw) return false;
  return !t.title.toLowerCase().includes(kw) && t.content.toLowerCase().includes(kw);
}

const active = computed(() => topics.value.find((t) => t.id === activeId.value) ?? null);

/** 已导入资料库的标题集合 */
const addedTitles = computed(() => new Set(docStore.documents.map((d) => d.title)));
const isAdded = (t: GrammarTopic) => addedTitles.value.has(t.title);

const activeAdded = computed(() => (active.value ? isAdded(active.value) : false));
const activeHtml = computed(() => (active.value ? renderMarkdown(active.value.content) : ""));
const activePlainLength = computed(() =>
  active.value ? markdownToPlain(active.value.content).length : 0
);

function open(topic: GrammarTopic) {
  activeId.value = topic.id;
}

function back() {
  activeId.value = "";
}

/** 加入资料库（按标题去重，分类用语法专题名） */
async function addToLibrary(topic: GrammarTopic): Promise<string | null> {
  const existing = docStore.documents.find((d) => d.title === topic.title);
  if (existing) return existing.id;

  adding.value = true;
  try {
    const cat =
      docStore.categories.find((c) => c.name === topic.category) ??
      (await docStore.addCategory(topic.category));
    const doc = await createDocument({
      title: topic.title,
      content: topic.content,
      sourceType: "note",
      categoryId: cat.id,
      tags: ["英语语法"]
    });
    await docStore.loadAll(false);
    return doc.id;
  } catch (e) {
    appStore.showToast(e instanceof Error ? e.message : "加入失败", "error");
    return null;
  } finally {
    adding.value = false;
  }
}

async function onAdd(topic: GrammarTopic) {
  const id = await addToLibrary(topic);
  if (id) appStore.showToast(`「${topic.title}」已加入资料库`, "success");
}

/** 直接为这篇语法生成学习卡片并入库 */
async function genCards(topic: GrammarTopic) {
  if (aiStore.isMock) {
    // 演示模式只会产出示例内容，写进学习中心反而污染数据，直接引导去配置
    appStore.showToast("演示模式不能生成真实卡片，请先在设置里接入模型", "info");
    router.push("/settings");
    return;
  }
  const docId = await addToLibrary(topic);
  if (!docId) return;

  generating.value = true;
  genProgress.value = "准备中…";
  genAbort = new AbortController();
  let created = 0;

  try {
    const drafts = (await generateCardsFromContent(
      aiStore.provider,
      topic.content,
      0,
      docId,
      (done, total) => {
        genProgress.value = total > 1 ? `${done}/${total} 段 · 已生成 ${created} 张` : "";
      },
      { signal: genAbort.signal }
    )) as { question: string; answer: string }[];

    for (const d of drafts) {
      await createFlashcard({ documentId: docId, question: d.question, answer: d.answer });
      created += 1;
    }
    void reviewStore.refresh();
    appStore.showToast(`已生成 ${created} 张卡片，可在学习中心复习`, "success");
  } catch (e) {
    if (e instanceof CanceledError) {
      for (const d of e.partial) {
        await createFlashcard({ documentId: docId, question: d.question, answer: d.answer });
        created += 1;
      }
      void reviewStore.refresh();
      appStore.showToast(created > 0 ? `已取消，保留 ${created} 张` : "已取消生成", "info");
    } else {
      appStore.showToast(e instanceof Error ? e.message : "生成失败", "error");
    }
  } finally {
    generating.value = false;
    genProgress.value = "";
    genAbort = null;
  }
}

function cancelGen() {
  genAbort?.abort();
}
</script>

<template>
  <div>
    <!-- 头部：标题由顶部 Tab 承担，这里只留说明与操作 -->
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <div class="min-w-0 flex-1">
        <p class="text-xs text-slate-500">
          内置 {{ topics.length }} 个语法点 · {{ categories.length }} 个专题，可直接阅读、加入资料库或生成卡片
        </p>
      </div>
      <button
        v-if="activeId"
        class="btn-secondary lg:hidden"
        aria-label="返回目录"
        @click="activeId = ''"
      >
        <ArrowLeft :size="16" /> 目录
      </button>
    </div>

    <!-- 加载 / 失败 -->
    <div v-if="loading" class="card flex items-center gap-2 p-6 text-sm text-slate-500">
      <Loader2 :size="16" class="animate-spin" /> 正在加载语法内容…
    </div>
    <div v-else-if="loadError" class="card p-6 text-sm text-slate-500">
      {{ loadError }}
      <button class="btn-secondary ml-3" @click="loadError = ''; loading = true; $router.go(0)">
        重试
      </button>
    </div>

    <div v-else class="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <!-- 目录栏 -->
      <aside
        id="grammar-toc"
        class="lg:sticky lg:top-4 lg:self-start"
        :class="activeId ? 'hidden lg:block' : ''"
      >
        <div class="card p-3">
          <div class="relative">
            <Search :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              v-model="keyword"
              class="input-base pl-9"
              placeholder="搜索语法点…"
              aria-label="搜索语法点"
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

          <!-- 专题筛选 -->
          <div class="mt-3 flex flex-wrap gap-1.5">
            <button
              class="rounded-full px-2 py-0.5 text-[11px] transition"
              :class="category === '' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
              @click="category = ''"
            >
              全部 {{ topics.length }}
            </button>
            <button
              v-for="c in visibleCategories"
              :key="c.name"
              class="rounded-full px-2 py-0.5 text-[11px] transition"
              :class="category === c.name ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
              @click="category = category === c.name ? '' : c.name"
            >
              {{ c.name }} {{ c.count }}
            </button>
            <button
              v-if="categories.length > 8"
              class="rounded-full px-2 py-0.5 text-[11px] text-brand-600 hover:bg-brand-50"
              @click="showAllCategories = !showAllCategories"
            >
              {{ showAllCategories ? "收起" : `+${categories.length - 8}` }}
            </button>
          </div>

          <!-- 列表 -->
          <div
            id="grammar-list"
            class="mt-3 max-h-[52vh] space-y-0.5 overflow-y-auto pr-1 lg:max-h-[calc(100vh-320px)]"
          >
            <button
              v-for="t in filtered"
              :key="t.id"
              class="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition"
              :class="activeId === t.id ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-50'"
              @click="open(t)"
            >
              <span class="min-w-0 flex-1 truncate">{{ t.title }}</span>
              <span
                v-if="isContentOnly(t)"
                class="shrink-0 rounded bg-slate-100 px-1 text-[10px] text-slate-500"
              >正文提及</span>
              <CheckCircle2
                v-if="isAdded(t)"
                :size="13"
                class="shrink-0 text-emerald-500"
                aria-label="已加入资料库"
              />
            </button>
            <p v-if="filtered.length === 0" class="px-2 py-6 text-center text-xs text-slate-400">
              没有匹配的语法点
            </p>
          </div>
        </div>
      </aside>

      <!-- 阅读区 -->
      <section id="grammar-reader" :class="activeId ? '' : 'hidden lg:block'">
        <div v-if="!active" class="card flex flex-col items-center justify-center p-12 text-center">
          <BookOpen :size="28" class="text-slate-300" />
          <p class="mt-3 text-sm text-slate-500">从左侧选一个语法点开始阅读</p>
        </div>

        <article v-else class="card p-5 lg:p-7">
          <div class="mb-4 flex flex-wrap items-center gap-2">
            <span class="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-700">
              {{ active.category }}
            </span>
            <span class="text-[11px] text-slate-400">约 {{ activePlainLength }} 字</span>
            <span
              v-if="activeAdded"
              class="flex items-center gap-1 text-[11px] text-emerald-600"
            >
              <CheckCircle2 :size="12" /> 已在资料库
            </span>

            <div class="ml-auto flex items-center gap-2">
              <button
                v-if="activeAdded"
                class="btn-secondary"
                @click="router.push(`/library?keyword=${encodeURIComponent(active.title)}`)"
              >
                去资料库
              </button>
              <button
                v-else
                class="btn-secondary"
                :disabled="adding"
                @click="onAdd(active)"
              >
                <Loader2 v-if="adding" :size="14" class="animate-spin" />
                <Plus v-else :size="14" /> 加入资料库
              </button>
              <button class="btn-primary" :disabled="generating" @click="genCards(active)">
                <Loader2 v-if="generating" :size="14" class="animate-spin" />
                <Sparkles v-else :size="14" />
                {{ generating ? "生成中…" : "生成卡片" }}
              </button>
            </div>
          </div>

          <p v-if="generating && genProgress" class="mb-3 rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
            {{ genProgress }}
            <button class="ml-2 underline" @click="cancelGen">取消</button>
          </p>

          <!-- 正文（Markdown 渲染：标题、表格、引用、列表） -->
          <div class="md-body" v-html="activeHtml"></div>
        </article>
      </section>
    </div>
  </div>
</template>
