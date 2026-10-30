<script setup lang="ts">
/**
 * 单词跑酷：三跑道穿门。上方给中文，三条道上各有一个英文词，换道穿过对的那扇。
 *
 * 引擎负责移动、判定、计分；这里只管把状态喂给渲染器，以及把键盘/触屏输入转成换道。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "@/stores/appStore";
import { useReviewStore } from "@/stores/reviewStore";
import { loadPackIndex, loadWords, type PackMeta } from "@/services/knowledgePack";
import { addWordToReview } from "@/services/quest/wordCards";
import {
  loadPlayPack,
  savePlayPack,
  saveGameResult,
  loadUntimed,
  saveUntimed,
  loadWordMode,
  saveWordMode,
  loadWordCursor,
  saveWordCursor,
  type PlayWordMode
} from "@/services/gameService";
import {
  createRunnerGame,
  runnerAccuracy,
  setLane,
  startRunner,
  stepRunner,
  moveLane,
  RUNNER,
  type RunnerState
} from "@/games/runner/engine";
import { createRunnerRenderer, laneFromY, type RunnerRenderer } from "@/games/runner/render";
import { IS_MINITOOL } from "@/utils/runtime";
import { Heart, Flame, Trophy, RotateCcw, ArrowLeft, Play, Target, ChevronUp, ChevronDown } from "lucide-vue-next";

const router = useRouter();
const route = useRoute();
const appStore = useAppStore();
const reviewStore = useReviewStore();

type Phase = "pick" | "ready" | "playing" | "over";

const phase = ref<Phase>("pick");
const loading = ref(false);
const packs = ref<PackMeta[]>([]);
const packId = ref((route.query.pack as string) || loadPlayPack());
const untimed = ref(loadUntimed());
/** 出词模式（同球球）：顺序 = 按词库关卡一轮不重复、可续刷；随机 = 整库洗牌 */
const wordMode = ref<PlayWordMode>(loadWordMode());
const cursor = ref(loadWordCursor(packId.value));
const totalWords = ref(0);
let startCursor = 0;
const packCount = computed(() => packs.value.find((p) => p.id === packId.value)?.count ?? 0);

const stageEl = ref<HTMLElement | null>(null);
const canvasEl = ref<HTMLCanvasElement | null>(null);

const hud = ref({ time: 0, score: 0, lives: 3, maxLives: 5, combo: 0, label: "" });
const result = ref<RunnerState | null>(null);
const banked = ref(0);

let game: RunnerState | null = null;
let renderer: RunnerRenderer | null = null;
let observer: ResizeObserver | null = null;
let raf = 0;
let lastTs = 0;
let lastHitSeq = 0;
let lastCorrect = 0;

const wordPacks = computed(() => packs.value.filter((p) => p.kind === "words" && p.id !== "idiom"));
const packTitle = computed(() => packs.value.find((p) => p.id === packId.value)?.title ?? "");
const accuracy = computed(() => (result.value ? Math.round(runnerAccuracy(result.value) * 100) : 0));

onMounted(async () => {
  if (IS_MINITOOL) {
    appStore.showToast("单词跑酷需要联网加载词库，请在网页版体验", "info");
    router.replace("/study/play");
    return;
  }
  try {
    const index = await loadPackIndex();
    packs.value = index.packs;
    if (!wordPacks.value.some((p) => p.id === packId.value)) packId.value = wordPacks.value[0]?.id ?? "cet4";
  } catch (e) {
    console.warn("[KnowFlow] 词库索引加载失败：", e);
  }
  // 带着 ?pack 进来（从趣味学习点卡片）就直接备好一局，像球球一样少点一次
  if (route.query.pack) await prepare(packId.value);
  window.addEventListener("keydown", onKey);
});

onBeforeUnmount(() => {
  stopLoop();
  window.removeEventListener("keydown", onKey);
  observer?.disconnect();
  renderer?.destroy();
});

async function prepare(id: string) {
  loading.value = true;
  try {
    const words = await loadWords(id);
    packId.value = id;
    savePlayPack(id);
    totalWords.value = words.length;
    startCursor = wordMode.value === "order" ? loadWordCursor(id) : 0;
    cursor.value = startCursor;
    game = createRunnerGame({
      words,
      untimed: untimed.value,
      mode: wordMode.value,
      startIndex: startCursor
    });
    if (!game.target || !game.gates.length) {
      appStore.showToast("这个词库的词太少，换个词库试试", "error");
      return;
    }
    lastHitSeq = 0;
    result.value = null;
    banked.value = 0;
    syncHud(true);
    phase.value = "ready";
    await new Promise((r) => requestAnimationFrame(r));
    setupStage();
  } catch (e) {
    appStore.showToast(e instanceof Error ? e.message : "词库加载失败", "error");
  } finally {
    loading.value = false;
  }
}

function setupStage() {
  const canvas = canvasEl.value;
  const stage = stageEl.value;
  if (!canvas || !stage) return;
  if (!renderer) renderer = createRunnerRenderer(canvas);
  const rect = stage.getBoundingClientRect();
  renderer.resize(rect.width, rect.height);
  if (!observer) {
    observer = new ResizeObserver(() => {
      const r = stage.getBoundingClientRect();
      renderer?.resize(r.width, r.height);
      if (game) renderer?.draw(game, 0);
    });
    observer.observe(stage);
  }
  if (game) renderer.draw(game, 0);
}

function start() {
  if (!game) return;
  game = startRunner(game);
  phase.value = "playing";
  lastTs = 0;
  stopLoop();
  raf = requestAnimationFrame(loop);
}

function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function loop(ts: number) {
  if (!game || !renderer) return;
  const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
  lastTs = ts;

  game = stepRunner(game, dt);

  // 穿门时撒粒子
  if (game.lastHit && game.lastHit.seq !== lastHitSeq) {
    lastHitSeq = game.lastHit.seq;
    const stage = stageEl.value;
    if (stage) {
      const rect = stage.getBoundingClientRect();
      const laneH = rect.height / RUNNER.lanes;
      const y = laneH * (game.lastHit.lane + 0.5);
      const x = Math.max(56, rect.width * 0.2);
      renderer.burst(x, y, game.lastHit.correct ? "#34d399" : "#fb7185", game.lastHit.correct ? 10 : 6);
    }
  }

  renderer.draw(game, dt);
  syncHud();

  if (game.phase === "over") {
    settle();
    return;
  }
  raf = requestAnimationFrame(loop);
}

function syncHud(force = false) {
  if (!game) return;

  // 顺序模式：每穿对一扇门就把游标往前推一格并落盘
  if (game.correct !== lastCorrect) {
    lastCorrect = game.correct;
    if (wordMode.value === "order" && totalWords.value) {
      cursor.value = (startCursor + game.correct) % totalWords.value;
      saveWordCursor(packId.value, cursor.value);
    }
  }
  const next = {
    time: Number.isFinite(game.duration) ? Math.ceil(Math.max(0, game.duration - game.elapsed)) : 0,
    score: game.score,
    lives: game.lives,
    maxLives: game.maxLives,
    combo: game.combo,
    label: game.label
  };
  const prev = hud.value;
  if (
    !force &&
    next.time === prev.time &&
    next.score === prev.score &&
    next.lives === prev.lives &&
    next.combo === prev.combo &&
    next.label === prev.label
  ) {
    return;
  }
  // 连穿 3 扇对的门回一格
  if (next.lives > prev.lives) appStore.showToast("连对 3 个 · 血量 +1", "success");
  hud.value = next;
}

/** 切换出词模式：重建这一局（顺序模式接着游标继续刷） */
function setWordMode(mode: PlayWordMode) {
  if (wordMode.value === mode) return;
  wordMode.value = mode;
  saveWordMode(mode);
  if (game && !result.value) void prepare(packId.value);
}

function resetCursor() {
  cursor.value = 0;
  saveWordCursor(packId.value, 0);
  if (game && !result.value) void prepare(packId.value);
  appStore.showToast("已回到这个词库的第 1 个词", "success");
}

async function settle() {
  const g = game;
  if (!g) return;
  stopLoop();
  phase.value = "over";
  result.value = g;
  saveGameResult("runner", packId.value, g.score);

  banked.value = 0;
  for (const word of g.wrongWords) {
    try {
      await addWordToReview(packId.value, word, true);
      banked.value += 1;
    } catch (e) {
      console.warn("[KnowFlow] 错词入队失败：", e);
    }
  }
  if (banked.value) void reviewStore.refresh();
}

function replay() {
  void prepare(packId.value).then(() => start());
}

function switchPack(id: string) {
  if (id === packId.value || loading.value) return;
  void prepare(id);
}

/** 上下键 / W S 换道；空键不做事 */
function onKey(e: KeyboardEvent) {
  if (phase.value !== "playing" || !game) return;
  const k = e.key.toLowerCase();
  if (k === "arrowup" || k === "w") {
    game = moveLane(game, -1);
    e.preventDefault();
  } else if (k === "arrowdown" || k === "s") {
    game = moveLane(game, 1);
    e.preventDefault();
  }
}

/** 触屏：点哪条跑道就换到哪条 */
function onTap(e: PointerEvent) {
  if (phase.value !== "playing" || !game) return;
  const stage = stageEl.value;
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  const y = e.clientY - rect.top;
  game = setLane(game, laneFromY(y, rect.height));
}

function goHome() {
  stopLoop();
  router.push("/study/play");
}

function setUntimed(value: boolean) {
  if (untimed.value === value) return;
  untimed.value = value;
  saveUntimed(value);
  if (phase.value !== "playing") void prepare(packId.value);
}
</script>

<template>
  <div>
    <div class="mb-3 flex items-center justify-between gap-3">
      <button class="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700" @click="goHome">
        <ArrowLeft :size="15" /> 趣味学习
      </button>
      <span class="text-xs text-slate-400">单词跑酷 · {{ packTitle }}</span>
    </div>

    <!-- 选词库 -->
    <template v-if="phase === 'pick'">
      <div class="card mb-3 flex flex-wrap items-center justify-between gap-2 p-4">
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold text-slate-800">出词</span>
          <div class="inline-flex rounded-full bg-slate-100 p-0.5 text-xs">
            <button
              class="rounded-full px-3 py-1 transition"
              :class="wordMode === 'order' ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'"
              @click="setWordMode('order')"
            >
              顺序
            </button>
            <button
              class="rounded-full px-3 py-1 transition"
              :class="wordMode === 'random' ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'"
              @click="setWordMode('random')"
            >
              随机
            </button>
          </div>
        </div>
        <span v-if="wordMode === 'order'" class="text-[11px] text-slate-400">
          已刷 {{ cursor }} / {{ packCount }}
          <button v-if="cursor > 0" class="ml-1 text-brand-600 hover:underline" @click="resetCursor">从头开始</button>
        </span>
        <span v-else class="text-[11px] text-slate-400">每局重洗整库，一轮不重复</span>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <button
          v-for="p in wordPacks"
          :key="p.id"
          class="card flex items-center justify-between p-5 text-left transition hover:shadow-md"
          :disabled="loading"
          @click="prepare(p.id)"
        >
          <div>
            <div class="text-base font-semibold text-slate-900">{{ p.title }}</div>
            <div class="mt-0.5 text-xs text-slate-400">{{ p.count }} 词 · 三条跑道穿对的门</div>
          </div>
          <Play :size="16" class="text-slate-300" />
        </button>
      </div>
      <p v-if="loading" class="mt-3 text-xs text-slate-400">词库加载中…</p>
    </template>

    <!-- 舞台 -->
    <div
      v-else
      ref="stageEl"
      class="relative touch-none select-none overflow-hidden rounded-2xl border border-slate-200 shadow-sm"
      style="height: clamp(380px, 66vh, 620px)"
      @pointerdown="onTap"
    >
      <canvas ref="canvasEl" class="block h-full w-full touch-none"></canvas>

      <!-- HUD -->
      <div class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
        <div class="rounded-lg bg-slate-900/70 px-2.5 py-1 text-sm font-semibold tabular-nums text-white">
          {{ untimed ? "练习" : `${hud.time}s` }}
        </div>
        <div class="flex items-center gap-2">
          <span class="flex items-center gap-1 rounded-lg bg-white/85 px-2 py-1 text-rose-500">
            <Heart
              v-for="i in hud.maxLives"
              :key="i"
              :size="13"
              :class="i <= hud.lives ? 'fill-rose-500' : 'text-slate-300'"
            />
          </span>
          <span
            v-if="hud.combo >= 2"
            class="flex items-center gap-0.5 rounded-lg bg-amber-400/90 px-2 py-1 text-xs font-semibold text-white"
          >
            <Flame :size="12" /> {{ hud.combo }}
          </span>
          <span class="rounded-lg bg-slate-900/70 px-2.5 py-1 text-sm font-semibold tabular-nums text-white">
            {{ hud.score }} 分
          </span>
        </div>
      </div>

      <!-- 目标词（只给中文） -->
      <div class="pointer-events-none absolute inset-x-0 top-12 flex justify-center">
        <div class="flex items-center gap-1.5 rounded-full bg-white/90 px-3 py-1 text-xs text-slate-600 shadow-sm">
          <Target :size="12" class="text-brand-500" />
          穿过意思是「<span class="font-semibold text-slate-800">{{ hud.label }}</span>」的门
        </div>
      </div>

      <!-- 上下换道按钮（鼠标/触屏都能用） -->
      <div v-if="phase === 'playing'" class="absolute bottom-3 right-3 flex flex-col gap-1.5">
        <button
          class="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-600 shadow"
          aria-label="上一道"
          @pointerdown.stop="game && (game = moveLane(game, -1))"
        >
          <ChevronUp :size="18" />
        </button>
        <button
          class="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-600 shadow"
          aria-label="下一道"
          @pointerdown.stop="game && (game = moveLane(game, 1))"
        >
          <ChevronDown :size="18" />
        </button>
      </div>

      <!-- 开始前 -->
      <div
        v-if="phase === 'ready'"
        class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/80 px-6 text-center backdrop-blur-sm"
      >
        <div class="text-base font-semibold text-slate-800">准备好了吗？</div>
        <p class="max-w-xs text-xs leading-relaxed text-slate-500">
          三条跑道各有一扇门，只有一个词的英文是对的。用上下键换道（手机点跑道或右下角箭头），穿过对的那扇。
        </p>
        <div class="inline-flex rounded-full bg-slate-100 p-0.5 text-xs">
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
        <button class="btn-primary" @click="start"><Play :size="15" /> 开始</button>
        <span class="text-[11px] text-slate-400">电脑：↑ ↓ 或 W S · 手机：点跑道</span>
      </div>

      <!-- 结算 -->
      <div
        v-if="phase === 'over' && result"
        class="absolute inset-0 overflow-y-auto bg-white/95 px-5 py-6 backdrop-blur"
      >
        <div class="mx-auto max-w-sm text-center">
          <div class="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-50 text-amber-500">
            <Trophy :size="22" />
          </div>
          <div class="mt-2 text-3xl font-bold tabular-nums text-slate-900">{{ result.score }} 分</div>
          <div class="mt-1 text-xs text-slate-500">
            穿对 {{ result.correct }} · 穿错 {{ result.wrong }} · 正确率 {{ accuracy }}% · 最高连击
            {{ result.bestCombo }}
          </div>
          <div v-if="banked" class="mt-2 text-xs text-emerald-600">已加入 {{ banked }} 个词到复习队列</div>

          <div v-if="result.wrongWords.length" class="mt-4 rounded-xl border border-slate-100 bg-white p-3 text-left">
            <div class="mb-1.5 text-xs font-medium text-slate-500">这局没认出来的词</div>
            <ul class="space-y-1">
              <li v-for="w in result.wrongWords" :key="w.w" class="text-sm">
                <span class="font-medium text-slate-800">{{ w.w }}</span>
                <span class="ml-1 text-xs text-slate-500">{{ w.m }}</span>
              </li>
            </ul>
          </div>

          <div class="mt-5 flex flex-wrap justify-center gap-2">
            <button class="btn-secondary" @click="goHome">趣味学习</button>
            <button class="btn-secondary" @click="phase = 'pick'">换个词库</button>
            <button class="btn-primary" @click="replay"><RotateCcw :size="15" /> 再来一局</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
