<script setup lang="ts">
/**
 * 单词球球页面：把引擎、渲染、输入三段接起来，自己只管 HUD 和结算。
 *
 * 分工：
 * - engine 纯逻辑（无 DOM），每帧 stepOrb 出新状态
 * - render 只读状态画布
 * - input 把键鼠/触屏统一成方向向量
 *
 * 页面不持有游戏规则，改数值只改 engine 里的 ORB 常量。
 */
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "@/stores/appStore";
import { useReviewStore } from "@/stores/reviewStore";
import { loadPackIndex, loadWords, type PackMeta } from "@/services/knowledgePack";
import { addWordToReview } from "@/services/quest/wordCards";
import { saveGameResult, loadPlayPack, savePlayPack, loadUntimed, saveUntimed } from "@/services/gameService";
import {
  createOrbGame,
  startOrb,
  stepOrb,
  cameraScale,
  orbAccuracy,
  timeText,
  ORB,
  TIERS,
  type OrbState
} from "@/games/orb/engine";
import { createOrbRenderer, tierName, type OrbRenderer } from "@/games/orb/render";
import { LIFE_RULE } from "@/games/lives";
import { createOrbInput, type JoystickState, type OrbInput } from "@/games/orb/input";
import { IS_MINITOOL } from "@/utils/runtime";
import {
  ArrowLeft,
  Heart,
  Flame,
  Trophy,
  RotateCcw,
  ChevronRight,
  Target,
  Play
} from "lucide-vue-next";

const router = useRouter();
const route = useRoute();
const appStore = useAppStore();
const reviewStore = useReviewStore();

type Phase = "pick" | "ready" | "playing" | "over";

const phase = ref<Phase>("pick");
const packs = ref<PackMeta[]>([]);
const packId = ref(loadPlayPack());
const loading = ref(false);

const canvasEl = ref<HTMLCanvasElement | null>(null);
const stageEl = ref<HTMLElement | null>(null);

const result = shallowRef<OrbState | null>(null);
/** 练习模式：不限时 */
const untimed = ref(loadUntimed());
const banked = ref(0);
const banner = ref("");
const joystick = ref<JoystickState>({ active: false, x: 0, y: 0, dx: 0, dy: 0 });

interface Hud {
  time: number;
  score: number;
  lives: number;
  maxLives: number;
  combo: number;
  tier: number;
  label: string;
}

const hud = ref<Hud>({
  time: ORB.duration,
  score: 0,
  lives: ORB.lives,
  maxLives: LIFE_RULE.cap,
  combo: 0,
  tier: 0,
  label: ""
});

const wordPacks = computed(() => packs.value.filter((p) => p.kind === "words"));
const packTitle = computed(() => packs.value.find((p) => p.id === packId.value)?.title ?? "");
const tierLabel = computed(() => tierName(hud.value.tier));

// 非响应式：60fps 更新的状态放 Vue 响应式里只是负担
let game: OrbState | null = null;
let renderer: OrbRenderer | null = null;
let input: OrbInput | null = null;
let raf = 0;
let lastTs = 0;
let lastHitSeq = 0;
let bannerTimer = 0;
let observer: ResizeObserver | null = null;

onMounted(async () => {
  if (IS_MINITOOL) {
    appStore.showToast("单词球球需要联网加载词库，请在网页版体验", "info");
    router.replace("/study/play");
    return;
  }

  try {
    const index = await loadPackIndex();
    packs.value = index.packs;
  } catch (e) {
    console.warn("[KnowFlow] 词库索引加载失败：", e);
  }

  const q = route.query.pack as string | undefined;
  if (q) packId.value = q;
  else if (!wordPacks.value.some((p) => p.id === packId.value)) {
    packId.value = wordPacks.value[0]?.id ?? "cet4";
  }

  if (q) await prepare(packId.value);
});

onBeforeUnmount(() => {
  stopLoop();
  input?.dispose();
  renderer?.destroy();
  observer?.disconnect();
  window.clearTimeout(bannerTimer);
});

function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

/** 拉词库 + 建局，停在 ready 等玩家点开始 */
async function prepare(id: string) {
  loading.value = true;
  try {
    const words = await loadWords(id);
    packId.value = id;
    savePlayPack(id);
    const g = createOrbGame({ words, untimed: untimed.value });
    if (!g.target || g.foods.length === 0) {
      appStore.showToast("这个词库的词太少，换个词库试试", "error");
      return;
    }
    game = g;
    lastHitSeq = 0;
    result.value = null;
    banked.value = 0;
    syncHud(true);
    phase.value = "ready";
    // 等 DOM 切完再挂画布
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

  if (!renderer) renderer = createOrbRenderer(canvas);
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

  if (!input) input = createOrbInput(stage, (s) => (joystick.value = s));

  if (game) renderer.draw(game, 0);
}

function play() {
  if (!game) return;
  game = startOrb(game);
  phase.value = "playing";
  lastTs = 0;
  stopLoop();
  raf = requestAnimationFrame(loop);
}

function loop(ts: number) {
  if (!game || !renderer) return;
  const dt = lastTs ? Math.min(0.05, (ts - lastTs) / 1000) : 0;
  lastTs = ts;

  game = stepOrb(game, dt, input?.dir() ?? { x: 0, y: 0 });

  // 吃中时撒一把粒子（屏幕坐标）
  if (game.lastHit && game.lastHit.seq !== lastHitSeq) {
    lastHitSeq = game.lastHit.seq;
    const stage = stageEl.value;
    if (stage) {
      const rect = stage.getBoundingClientRect();
      const scale = cameraScale(game.player.r);
      const sx = rect.width / 2 + (game.lastHit.x - game.player.x) * scale;
      const sy = rect.height / 2 + (game.lastHit.y - game.player.y) * scale;
      renderer.burst(sx, sy, game.lastHit.correct ? "#34d399" : "#fb7185", game.lastHit.correct ? 10 : 6);
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

/** HUD 只在数值真的变了才赋值，避免 60fps 触发整块重排 */
function syncHud(force = false) {
  if (!game) return;
  const next = {
    time: Number.isFinite(game.duration) ? Math.ceil(Math.max(0, game.duration - game.elapsed)) : 0,
    score: game.score,
    lives: game.lives,
    maxLives: game.maxLives,
    combo: game.combo,
    tier: game.tier,
    label: game.label
  };
  const prev = hud.value;
  const changed =
    force ||
    next.time !== prev.time ||
    next.score !== prev.score ||
    next.lives !== prev.lives ||
    next.combo !== prev.combo ||
    next.tier !== prev.tier ||
    next.label !== prev.label;
  if (!changed) return;

  // 回血提示：连对 3 个才会 +1，不提示玩家根本注意不到
  if (next.lives > prev.lives) {
    banner.value = `连对 3 个 · 血量 +1`;
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => (banner.value = ""), 1400);
  }
  // 升级提示
  if (next.tier > prev.tier) {
    banner.value = `已进入 ${TIERS[next.tier]?.name ?? ""}`;
    window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => (banner.value = ""), 1600);
  }
  hud.value = next;
}

async function settle() {
  stopLoop();
  if (!game) return;
  phase.value = "over";
  result.value = game;
  saveGameResult("orb", packId.value, game.score);

  // 批量入队：一局最多 3 个错词，结算时一次写完，不在游戏过程中反复开事务
  const list = game.wrongWords;
  banked.value = 0;
  for (const w of list) {
    try {
      await addWordToReview(packId.value, w, true);
      banked.value += 1;
    } catch (e) {
      console.warn("[KnowFlow] 错词入队失败：", e);
    }
  }
  if (banked.value) void reviewStore.refresh();
}

function replay() {
  void startWith(packId.value);
}

/** 切换练习模式：重建一局，避免半局中途改规则 */
function setUntimed(value: boolean) {
  if (untimed.value === value) return;
  untimed.value = value;
  saveUntimed(value);
  if (game && !result.value) void prepare(packId.value);
}

function changePack() {
  stopLoop();
  // 画布会被 v-else 卸掉，渲染器与输入都绑在旧元素上，必须一起清掉重建
  input?.dispose();
  input = null;
  renderer?.destroy();
  renderer = null;
  observer?.disconnect();
  observer = null;
  game = null;
  result.value = null;
  phase.value = "pick";
}

/** 选词库 → 建局 → 直接开玩 */
async function startWith(id: string) {
  await prepare(id);
  if (phase.value === "ready") play();
}

const accuracyText = computed(() =>
  result.value ? `${Math.round(orbAccuracy(result.value) * 100)}%` : "0%"
);

const bestTierName = computed(() => (result.value ? tierName(result.value.tier) : ""));
</script>

<template>
  <div>
    <div class="mb-3 flex items-center justify-between gap-3">
      <button
        class="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        @click="router.push('/study/play')"
      >
        <ArrowLeft :size="15" /> 趣味学习
      </button>
      <span class="text-xs text-slate-400">
        {{ packTitle }} · 吃对变大，吃错掉命
      </span>
    </div>

    <!-- 选词库 -->
    <template v-if="phase === 'pick'">
      <div class="grid gap-3 sm:grid-cols-2">
        <button
          v-for="p in wordPacks"
          :key="p.id"
          class="card flex items-center justify-between p-5 text-left transition hover:shadow-md"
          :disabled="loading"
          @click="startWith(p.id)"
        >
          <div>
            <div class="text-base font-semibold text-slate-900">{{ p.title }}</div>
            <div class="mt-0.5 text-xs text-slate-400">{{ p.count }} 词 · 60 秒一局</div>
          </div>
          <ChevronRight :size="18" class="text-slate-300" />
        </button>
      </div>
      <p v-if="loading" class="mt-3 text-xs text-slate-400">词库加载中…</p>
    </template>

    <!-- 游戏舞台 -->
    <div
      v-else
      ref="stageEl"
      class="relative touch-none select-none overflow-hidden rounded-2xl border border-slate-200 shadow-sm"
      style="height: clamp(360px, 66vh, 620px)"
    >
      <canvas ref="canvasEl" class="block h-full w-full touch-none"></canvas>

      <!-- 顶部 HUD -->
      <div class="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3">
        <div class="rounded-lg bg-slate-900/70 px-2.5 py-1 text-sm font-semibold tabular-nums text-white">
          {{ untimed ? "练习" : timeText(hud.time) }}
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

      <!-- 目标提示（只给中文，不能给英文，否则一眼就找到答案了） -->
      <div class="pointer-events-none absolute inset-x-0 top-12 flex justify-center">
        <div class="flex items-center gap-1.5 rounded-full bg-white/85 px-3 py-1 text-xs text-slate-600 shadow-sm">
          <Target :size="12" class="text-brand-500" />
          吃掉意思是「<span class="font-semibold text-slate-800">{{ hud.label }}</span>」的球
        </div>
      </div>

      <!-- 层级提示 -->
      <transition name="fade">
        <div
          v-if="banner"
          class="pointer-events-none absolute inset-x-0 top-24 flex justify-center"
        >
          <span class="rounded-full bg-slate-900/80 px-4 py-1.5 text-sm font-medium text-white">
            {{ banner }}
          </span>
        </div>
      </transition>

      <!-- 虚拟摇杆 -->
      <div
        v-if="joystick.active"
        class="pointer-events-none absolute h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white/50 bg-white/15"
        :style="{ left: `${joystick.x}px`, top: `${joystick.y}px` }"
      >
        <div
          class="absolute left-1/2 top-1/2 h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/70"
          :style="{ transform: `translate(calc(-50% + ${joystick.dx}px), calc(-50% + ${joystick.dy}px))` }"
        ></div>
      </div>

      <!-- 开始前 -->
      <div
        v-if="phase === 'ready'"
        class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/75 px-6 text-center backdrop-blur-sm"
      >
        <div class="text-base font-semibold text-slate-800">准备好了吗？</div>
        <p class="max-w-xs text-xs leading-relaxed text-slate-500">
          球上写着中文意思，场上只有一个球的英文是对的。吃对它，球就变大；吃错了掉一条命。
        </p>
        <div class="mt-1 inline-flex rounded-full bg-slate-100 p-0.5 text-xs">
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
        <button class="btn-primary mt-2" @click="play"><Play :size="15" /> 开始</button>
        <span class="text-[11px] text-slate-400">电脑：鼠标或 WASD 移动 · 手机：按住屏幕拖动</span>
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
            答对 {{ result.correct }} · 答错 {{ result.wrong }} · 正确率 {{ accuracyText }} ·
            最高连击 {{ result.bestCombo }} · {{ bestTierName }}
          </div>
          <div v-if="banked" class="mt-2 text-xs text-emerald-600">
            已加入 {{ banked }} 个词到复习队列
          </div>

          <div v-if="result.wrongWords.length" class="mt-4 rounded-xl border border-slate-100 bg-white p-3 text-left">
            <div class="mb-1.5 text-xs font-medium text-slate-500">本局没认出来的词</div>
            <ul class="space-y-1">
              <li v-for="w in result.wrongWords" :key="w.w" class="text-sm">
                <span class="font-medium text-slate-800">{{ w.w }}</span>
                <span class="ml-1 text-xs text-slate-500">{{ w.m }}</span>
              </li>
            </ul>
          </div>

          <div class="mt-5 flex flex-wrap justify-center gap-2">
            <button class="btn-secondary" @click="changePack">换个词库</button>
            <button class="btn-secondary" @click="router.push('/study/play')">趣味学习</button>
            <button class="btn-primary" @click="replay"><RotateCcw :size="15" /> 再来一局</button>
          </div>
        </div>
      </div>
    </div>

    <p v-if="phase === 'playing'" class="mt-3 text-center text-[11px] text-slate-400">
      答错的词会在结算时自动进入复习队列
    </p>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
