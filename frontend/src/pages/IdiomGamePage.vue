<script setup lang="ts">
/**
 * 成语填空：每个成语挖掉一个字，从 4 个候选字里选回来。
 *
 * 原本的占位玩法是「成语接龙」，但内置 172 条成语里只有 13% 的末字能接上另一条，
 * 严格接龙两步就断，所以换成同数据能撑起来的填空。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useAppStore } from "@/stores/appStore";
import { useReviewStore } from "@/stores/reviewStore";
import { loadIdioms, type IdiomEntry } from "@/services/knowledgePack";
import { addWordToReview } from "@/services/quest/wordCards";
import { saveGameResult, loadUntimed, saveUntimed } from "@/services/gameService";
import {
  answerBlank,
  createIdiomGame,
  currentIdiom,
  idiomAccuracy,
  splitBlank,
  startIdiomGame,
  tickIdiom,
  IDIOM_GAME,
  type IdiomGameState
} from "@/games/idiom/engine";
import { IS_MINITOOL } from "@/utils/runtime";
import { Heart, Flame, Trophy, RotateCcw, ArrowLeft, Lightbulb, Play, Check } from "lucide-vue-next";

const router = useRouter();
const appStore = useAppStore();
const reviewStore = useReviewStore();

type Phase = "ready" | "playing" | "over";

const phase = ref<Phase>("ready");
const loading = ref(true);
const allIdioms = ref<IdiomEntry[]>([]);
/** 练习模式：不限时 */
const untimed = ref(loadUntimed());
const game = ref<IdiomGameState | null>(null);
const result = ref<IdiomGameState | null>(null);
const picked = ref("");
const revealed = ref(false);
const banked = ref(0);

let timer = 0;
let lastTs = 0;
let advanceTimer = 0;

const q = computed(() => game.value?.question ?? null);
const parts = computed(() => (q.value ? splitBlank(q.value) : { before: "", after: "" }));
const timeLeft = computed(() =>
  untimed.value ? 0 : Math.ceil((game.value?.duration ?? IDIOM_GAME.duration) - (game.value?.elapsed ?? 0))
);
const accuracy = computed(() => (result.value ? Math.round(idiomAccuracy(result.value) * 100) : 0));

onMounted(async () => {
  if (IS_MINITOOL) {
    appStore.showToast("成语填空需要联网加载成语库，请在网页版体验", "info");
    router.replace("/study/play");
    return;
  }
  try {
    allIdioms.value = await loadIdioms();
    game.value = createIdiomGame({ idioms: allIdioms.value, untimed: untimed.value });
  } catch (e) {
    appStore.showToast(e instanceof Error ? e.message : "成语库加载失败", "error");
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => stopLoop());

function start() {
  if (!game.value) return;
  game.value = startIdiomGame(game.value);
  phase.value = "playing";
  picked.value = "";
  revealed.value = false;
  lastTs = 0;
  stopLoop();
  timer = requestAnimationFrame(loop);
}

function stopLoop() {
  if (timer) cancelAnimationFrame(timer);
  timer = 0;
  window.clearTimeout(advanceTimer);
}

function loop(ts: number) {
  const g = game.value;
  if (!g || g.phase !== "playing") return;
  const dt = lastTs ? (ts - lastTs) / 1000 : 0;
  lastTs = ts;
  game.value = tickIdiom(g, dt);
  if (game.value.phase === "over") {
    settle();
    return;
  }
  timer = requestAnimationFrame(loop);
}

function choose(option: string) {
  const g = game.value;
  if (!g || g.phase !== "playing" || revealed.value) return;
  picked.value = option;
  revealed.value = true;
  const next = answerBlank(g, option);
  game.value = next;

  advanceTimer = window.setTimeout(() => {
    revealed.value = false;
    picked.value = "";
    if (next.phase === "over") settle();
  }, 700);
}

async function settle() {
  const g = game.value;
  if (!g) return;
  stopLoop();
  phase.value = "over";
  result.value = g;
  saveGameResult("idiom", "idiom", g.score);

  // 答错的成语批量入队，复用现有 SRS
  banked.value = 0;
  for (const item of g.wrongWords) {
    try {
      await addWordToReview("idiom", { w: item.w, p: "", m: item.m }, true);
      banked.value += 1;
    } catch (e) {
      console.warn("[KnowFlow] 成语入队失败：", e);
    }
  }
  if (banked.value) void reviewStore.refresh();
}

function replay() {
  if (!allIdioms.value.length) return;
  result.value = null;
  banked.value = 0;
  picked.value = "";
  revealed.value = false;
  game.value = createIdiomGame({ idioms: allIdioms.value, untimed: untimed.value });
  start();
}

function setUntimed(value: boolean) {
  if (untimed.value === value) return;
  untimed.value = value;
  saveUntimed(value);
  if (allIdioms.value.length) game.value = createIdiomGame({ idioms: allIdioms.value, untimed: value });
}

function goHome() {
  stopLoop();
  router.push("/study/play");
}
</script>

<template>
  <div>
    <div class="mb-3 flex items-center justify-between gap-3">
      <button class="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700" @click="goHome">
        <ArrowLeft :size="15" /> 趣味学习
      </button>
      <span class="text-xs text-slate-400">成语填空 · 60 秒</span>
    </div>

    <div v-if="loading" class="card flex items-center gap-2 p-6 text-sm text-slate-500">
      <span class="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-transparent"></span>
      正在加载成语库…
    </div>

    <!-- 开始前 -->
    <div v-else-if="phase === 'ready'" class="card p-6 text-center">
      <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-500">
        <Lightbulb :size="22" />
      </div>
      <div class="mt-3 text-base font-semibold text-slate-800">成语填空</div>
      <p class="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-500">
        每个成语挖掉一个字，从四个候选里选回来。答错扣一条命，答错的成语会自动进入复习队列。
      </p>
      <div class="mt-4 inline-flex rounded-full bg-slate-100 p-0.5 text-xs">
        <button
          class="rounded-full px-3 py-1 transition"
          :class="!untimed ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'"
          @click="setUntimed(false)"
        >
          限时 60 秒
        </button>
        <button
          class="rounded-full px-3 py-1 transition"
          :class="untimed ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'"
          @click="setUntimed(true)"
        >
          练习 · 不限时
        </button>
      </div>
      <div>
        <button class="btn-primary mt-2" :disabled="!game" @click="start">
          <Play :size="15" /> 开始
        </button>
      </div>
    </div>

    <!-- 游戏中 -->
    <div v-else-if="phase === 'playing' && q && game" class="space-y-4">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-3 text-sm">
          <span class="rounded-lg bg-slate-900/80 px-2.5 py-1 font-semibold tabular-nums text-white">
            {{ untimed ? "练习" : Math.max(0, timeLeft) + "s" }}
          </span>
          <span class="flex items-center gap-1 text-rose-500">
            <Heart
              v-for="i in game.maxLives"
              :key="i"
              :size="13"
              :class="i <= game.lives ? 'fill-rose-500' : 'text-slate-300'"
            />
          </span>
          <span v-if="game.combo >= 2" class="flex items-center gap-0.5 text-amber-500">
            <Flame :size="13" /> {{ game.combo }}
          </span>
        </div>
        <span class="text-sm font-semibold tabular-nums text-slate-700">{{ game.score }} 分</span>
      </div>

      <div class="card p-6 text-center">
        <div class="flex items-center justify-center gap-2 text-3xl font-bold tracking-widest text-slate-800">
          <span>{{ parts.before }}</span>
          <span
            class="inline-flex h-11 w-11 items-center justify-center rounded-lg border-2 border-dashed text-2xl"
            :class="
              revealed
                ? picked === q.answer
                  ? 'border-emerald-400 bg-emerald-50 text-emerald-600'
                  : 'border-rose-400 bg-rose-50 text-rose-600'
                : 'border-slate-300 text-slate-300'
            "
          >
            {{ revealed ? q.answer : "?" }}
          </span>
          <span>{{ parts.after }}</span>
        </div>
        <p class="mt-3 text-xs leading-relaxed text-slate-500">{{ q.meaning }}</p>
      </div>

      <div class="grid grid-cols-4 gap-2">
        <button
          v-for="opt in q.options"
          :key="opt"
          class="card flex h-16 items-center justify-center text-xl font-semibold transition"
          :class="
            revealed
              ? opt === q.answer
                ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                : opt === picked
                  ? 'border-rose-400 bg-rose-50 text-rose-700'
                  : 'opacity-50'
              : 'text-slate-700 hover:shadow-md'
          "
          :disabled="revealed"
          @click="choose(opt)"
        >
          {{ opt }}
        </button>
      </div>
    </div>

    <!-- 结算 -->
    <div v-else-if="phase === 'over' && result" class="card p-6 text-center">
      <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-500">
        <Trophy :size="22" />
      </div>
      <div class="mt-2 text-3xl font-bold tabular-nums text-slate-900">{{ result.score }} 分</div>
      <div class="mt-1 text-xs text-slate-500">
        答对 {{ result.correct }} · 答错 {{ result.wrong }} · 正确率 {{ accuracy }}% · 最高连击 {{ result.bestCombo }}
      </div>
      <div v-if="banked" class="mt-2 text-xs text-emerald-600">已加入 {{ banked }} 个成语到复习队列</div>

      <div v-if="result.wrongWords.length" class="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-3 text-left">
        <div class="mb-1.5 text-xs font-medium text-slate-500">本局没答对</div>
        <ul class="space-y-1">
          <li v-for="w in result.wrongWords" :key="w.w" class="text-sm">
            <span class="font-medium text-slate-800">{{ w.w }}</span>
            <span class="ml-1 text-xs text-slate-500">{{ w.m }}</span>
          </li>
        </ul>
      </div>

      <div class="mt-5 flex flex-wrap justify-center gap-2">
        <button class="btn-secondary" @click="goHome">趣味学习</button>
        <button class="btn-primary" @click="replay"><RotateCcw :size="15" /> 再来一局</button>
      </div>
    </div>
  </div>
</template>
