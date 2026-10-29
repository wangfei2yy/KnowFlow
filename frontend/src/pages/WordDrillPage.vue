<script setup lang="ts">
/**
 * 背单词：一关 50 个词，四选一，做完为止（不设生命）。
 *
 * 关卡划分由总词量决定（4424 词 → 89 关），进度按词库分别存，
 * 所以切词库不会互相覆盖 —— 与闯关存档同一套思路。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "@/stores/appStore";
import { useReviewStore } from "@/stores/reviewStore";
import { loadPackIndex, loadWords, type PackMeta } from "@/services/knowledgePack";
import {
  answerDrill,
  currentDrillQuestion,
  drillAccuracy,
  drillPassed,
  levelCount,
  levelRange,
  levelSlice,
  nextDrill,
  passLine,
  saveDrillResult,
  startDrill,
  type DrillSession
} from "@/services/wordLearn";
import { addWordToReview } from "@/services/quest/wordCards";
import { shortMeaning, type WordEntry } from "@/services/quest/engine";
import { IS_MINITOOL } from "@/utils/runtime";
import { ArrowLeft, ArrowRight, Check, Loader2, RotateCcw, X, ListPlus } from "lucide-vue-next";

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const reviewStore = useReviewStore();

const packs = ref<PackMeta[]>([]);
const packId = ref(String(route.query.pack ?? "cet4"));
const level = ref(Math.max(0, Number(route.query.level ?? 0) || 0));
const allWords = ref<WordEntry[]>([]);
const loading = ref(true);
const error = ref("");

const session = ref<DrillSession | null>(null);
/** 结算只做一次（避免重复写进度） */
const settled = ref(false);
const banked = ref(0);
const banking = ref(false);

let timer: number | undefined;
function clearTimer() {
  if (timer !== undefined) window.clearTimeout(timer);
  timer = undefined;
}

const totalWords = computed(() => allWords.value.length);
const levels = computed(() => levelCount(totalWords.value));
const range = computed(() => levelRange(level.value, totalWords.value));
const slice = computed(() => levelSlice(allWords.value, level.value));

const q = computed(() => (session.value ? currentDrillQuestion(session.value) : null));
const answered = computed(() => session.value?.answered ?? false);
const progress = computed(() =>
  session.value ? Math.min(session.value.questions.length, session.value.correct + session.value.wrong) : 0
);
const total = computed(() => session.value?.questions.length ?? 0);
const accuracyNow = computed(() => (session.value ? Math.round(drillAccuracy(session.value) * 100) : 100));
const finished = computed(() => session.value?.finished ?? false);
const picked = computed(() => session.value?.picked ?? "");
const correctCount = computed(() => session.value?.correct ?? 0);
const wrongList = computed(() => session.value?.wrongWords ?? []);

onMounted(async () => {
  if (IS_MINITOOL) {
    appStore.showToast("背单词需要联网加载词库，请在网页版使用", "info");
    loading.value = false;
    return;
  }
  try {
    const index = await loadPackIndex();
    packs.value = index.packs;
  } catch (e) {
    console.warn("[KnowFlow] 词库索引加载失败：", e);
  }
  await load();
});

async function load() {
  loading.value = true;
  error.value = "";
  try {
    const list = await loadWords(packId.value);
    // 与词表页一致按字母排：关卡必须稳定，否则今天的第 3 关和下周的第 3 关不是同一批词
    allWords.value = [...list].sort((a, b) => a.w.localeCompare(b.w));
    level.value = Math.min(level.value, Math.max(0, levels.value - 1));
    begin();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "词库加载失败";
  } finally {
    loading.value = false;
  }
}

function begin() {
  clearTimer();
  settled.value = false;
  banked.value = 0;
  session.value = startDrill(slice.value);
}

function choose(option: string) {
  const s = session.value;
  if (!s || s.answered) return;
  const current = currentDrillQuestion(s);
  if (!current) return;
  session.value = answerDrill(s, option);
  // 答对给 750ms 看清绿框就走，答错停住让人读完整释义
  if (option === current.answer) timer = window.setTimeout(advance, 750);
}

function advance() {
  clearTimer();
  const s = session.value;
  if (!s) return;
  const next = nextDrill(s);
  session.value = next;
  if (next.finished) settle(next);
}

function settle(s: DrillSession) {
  if (settled.value) return;
  settled.value = true;
  saveDrillResult(packId.value, level.value, s.correct, s.questions.length);
}

function retry() {
  begin();
}

/** 下一关；已到最后一关就给一句提示 */
function nextLevel() {
  if (level.value + 1 >= levels.value) {
    appStore.showToast("已经是最后一关了", "info");
    return;
  }
  gotoLevel(level.value + 1);
}

function gotoLevel(i: number) {
  if (i < 0 || i >= levels.value) return;
  level.value = i;
  router.replace({ path: "/study/words/drill", query: { pack: packId.value, level: i } });
  begin();
}

/** 结算：把本关答错的词一起塞进复习队列 */
async function bankWrong() {
  const s = session.value;
  if (!s || banking.value || !s.wrongWords.length) return;
  banking.value = true;
  let n = 0;
  for (const w of s.wrongWords) {
    try {
      await addWordToReview(packId.value, w, true);
      n += 1;
    } catch {
      /* 单个失败不影响其余 */
    }
  }
  banked.value = n;
  banking.value = false;
  void reviewStore.refresh();
  appStore.showToast(n ? `已把 ${n} 个错词加入复习` : "加入失败，请稍后再试", n ? "success" : "error");
}

function backToList() {
  router.push({ path: "/study/words", query: { pack: packId.value } });
}

function optionClass(option: string): string {
  const s = session.value;
  const cur = q.value;
  if (!s?.answered || !cur) {
    return "border-slate-200 bg-white hover:border-brand-300 hover:bg-brand-50/40";
  }
  if (option === cur.answer) return "border-emerald-400 bg-emerald-50 text-emerald-800";
  if (option === s.picked) return "border-rose-400 bg-rose-50 text-rose-700";
  return "border-slate-200 bg-white opacity-60";
}

const passed = computed(() => {
  const s = session.value;
  return s ? s.finished && drillPassed(s) : false;
});
const line = computed(() => passLine(total.value));

// 直接改地址栏里的 ?level= 也要生效
watch(
  () => route.query.level,
  (v) => {
    const n = Math.max(0, Number(v ?? 0) || 0);
    if (n !== level.value) {
      level.value = n;
      begin();
    }
  }
);

onBeforeUnmount(clearTimer);
</script>

<template>
  <div>
    <button class="mb-3 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700" @click="backToList">
      <ArrowLeft :size="13" /> 单词学习
    </button>

    <div v-if="loading" class="card flex items-center gap-2 p-6 text-sm text-slate-500">
      <Loader2 :size="16" class="animate-spin" /> 正在准备这一关…
    </div>
    <div v-else-if="error" class="card p-6 text-sm text-slate-500">{{ error }}</div>

    <template v-else-if="session">
      <!-- 顶部进度 -->
      <div class="mb-3 flex items-center gap-3 text-xs text-slate-500">
        <span class="font-medium text-slate-700">第 {{ level + 1 }} / {{ levels }} 关</span>
        <span class="text-slate-400">第 {{ range.start }}~{{ range.end }} 词</span>
        <span class="ml-auto">已答 {{ progress }} / {{ total }}</span>
        <span :class="accuracyNow >= 80 ? 'text-emerald-600' : 'text-slate-500'">正确率 {{ accuracyNow }}%</span>
      </div>
      <div class="mb-4 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          class="h-full rounded-full bg-brand-500 transition-all"
          :style="{ width: `${total ? (progress / total) * 100 : 0}%` }"
        />
      </div>

      <!-- 答题中 -->
      <div v-if="!finished" class="card p-5">
        <div class="text-center">
          <div class="text-3xl font-semibold tracking-wide text-slate-900">{{ q?.word }}</div>
          <div v-if="q?.phonetic" class="mt-1 text-xs text-slate-400">{{ q.phonetic }}</div>
        </div>

        <div class="mt-5 space-y-2">
          <button
            v-for="(opt, i) in q?.options ?? []"
            :key="opt"
            class="flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition"
            :class="optionClass(opt)"
            :disabled="answered"
            @click="choose(opt)"
          >
            <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/70 text-xs text-slate-500">
              {{ "ABCD"[i] }}
            </span>
            <span class="flex-1">{{ opt }}</span>
            <Check v-if="answered && opt === q?.answer" :size="15" class="shrink-0 text-emerald-600" />
            <X v-else-if="answered && opt === picked" :size="15" class="shrink-0 text-rose-500" />
          </button>
        </div>

        <!-- 答错才展开完整释义；答对直接进下一题，不打断节奏 -->
        <div v-if="answered && picked !== q?.answer" class="mt-4 rounded-xl bg-slate-50 p-3">
          <div class="text-xs text-slate-500">
            <span class="font-medium text-slate-700">{{ q?.word }}</span>
            <span class="mx-1 text-slate-300">·</span>
            {{ q?.answerFull }}
          </div>
          <button class="btn-primary mt-3 w-full py-2 text-sm" @click="advance">
            记下了，继续 <ArrowRight :size="14" />
          </button>
        </div>
        <p v-else-if="answered" class="mt-4 text-center text-xs text-emerald-600">答对了</p>
        <p v-else class="mt-4 text-center text-[11px] text-slate-400">选出正确的中文释义</p>
      </div>

      <!-- 结算 -->
      <div v-else class="card p-5 text-center">
        <div class="text-sm text-slate-500">第 {{ level + 1 }} 关完成</div>
        <div class="mt-1 text-3xl font-semibold" :class="passed ? 'text-emerald-600' : 'text-amber-600'">
          {{ correctCount }} / {{ total }}
        </div>
        <div class="mt-1 text-xs text-slate-500">
          正确率 {{ accuracyNow }}% ·
          {{ passed ? "过关" : `差 ${line - correctCount} 题到过关线（${line} 题）` }}
        </div>

        <div v-if="wrongList.length" class="mt-4 rounded-xl bg-slate-50 p-3 text-left">
          <div class="mb-1.5 flex items-center gap-1 text-xs font-medium text-slate-600">
            本关错词 {{ wrongList.length }} 个
            <button
              class="ml-auto flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] text-brand-600 hover:bg-brand-50"
              :disabled="banking || banked > 0"
              @click="bankWrong"
            >
              <ListPlus :size="11" />
              {{ banked > 0 ? `已加入 ${banked}` : banking ? "加入中…" : "全部加入复习" }}
            </button>
          </div>
          <div class="max-h-40 space-y-1 overflow-y-auto">
            <div v-for="w in wrongList" :key="w.w" class="text-xs text-slate-600">
              <span class="font-medium text-slate-800">{{ w.w }}</span>
              <span class="mx-1 text-slate-300">·</span>{{ shortMeaning(w.m, 40) }}
            </div>
          </div>
        </div>

        <div class="mt-5 flex gap-2">
          <button class="btn-secondary flex-1 justify-center py-2 text-sm" @click="retry">
            <RotateCcw :size="14" /> 重做本关
          </button>
          <button class="btn-primary flex-1 justify-center py-2 text-sm" @click="nextLevel">
            下一关 <ArrowRight :size="14" />
          </button>
        </div>
        <button class="mt-2 text-xs text-slate-400 hover:text-slate-600" @click="backToList">
          回到关卡列表
        </button>
      </div>
    </template>
  </div>
</template>
