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
import {
  saveGameResult,
  loadPlayPack,
  savePlayPack,
  loadUntimed,
  saveUntimed,
  loadDifficulty,
  saveDifficulty
} from "@/services/gameService";
import {
  createOrbGame,
  startOrb,
  stepOrb,
  cameraScale,
  orbAccuracy,
  timeText,
  difficultyOf,
  DIFFICULTIES,
  ORB,
  TIERS,
  type DifficultyId,
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
/** 难度档：只影响场上待选单词数（4 / 6 / 8 / 10） */
const difficulty = ref<DifficultyId>(loadDifficulty() as DifficultyId);
const difficultyMeta = computed(() => difficultyOf(difficulty.value));
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
  labelFull: string;
}

const hud = ref<Hud>({
  time: ORB.duration,
  score: 0,
  lives: ORB.lives,
  maxLives: LIFE_RULE.cap,
  combo: 0,
  tier: 0,
  label: "",
  labelFull: ""
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
    const g = createOrbGame({ words, untimed: untimed.value, difficulty: difficulty.value });
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
  acc = 0;
  stopLoop();
  raf = requestAnimationFrame(loop);
}

/**
 * 固定步长 1/120 秒。
 *
 * 原来直接把「上一帧到这一帧的真实间隔」喂给引擎（还夹在 50ms），
 * 帧率一掉，每帧算的时间就比真实时间短，球看起来就变慢 —— 而球长大后
 * 背景装饰按缩放要多画好几倍格子，正好是最容易掉帧的时候。
 * 现在把真实时间攒进 acc，按固定步长补齐：掉帧只会更卡，不会更慢。
 */
const STEP = 1 / 120;
/** 切标签回来最多补 250ms，再多就是瞬移了 */
const MAX_FRAME = 0.25;
let acc = 0;

function loop(ts: number) {
  if (!game || !renderer) return;
  const frame = lastTs ? Math.min(MAX_FRAME, (ts - lastTs) / 1000) : 0;
  lastTs = ts;

  const dir = input?.dir() ?? { x: 0, y: 0 };
  acc += frame;
  let steps = 0;
  // 上限 30 步：万一卡了 1 秒，也只补到 250ms 的量，不追着补
  while (acc >= STEP && steps < 30) {
    game = stepOrb(game, STEP, dir);
    acc -= STEP;
    steps += 1;
    if (game.phase === "over") break;
  }

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

  renderer.draw(game, frame);
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
    label: game.label,
    labelFull: game.labelFull
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

/**
 * 切换难度：同样重建一局。
 * 只改「场上有几个待选单词」，速度、血量、时长这些规则一个字都不动 ——
 * 否则玩家会以为「简单档连移动都变慢了」。
 */
function setDifficulty(id: DifficultyId) {
  if (difficulty.value === id) return;
  difficulty.value = id;
  saveDifficulty(id);
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
        {{ packTitle }} · {{ difficultyMeta.name }}档 · 吃对变大，吃错掉命
      </span>
    </div>

    <!-- 选词库 -->
    <template v-if="phase === 'pick'">
      <!-- 难度：只改「场上有几个待选单词」，不改速度/血量/时长 -->
      <div class="card mb-3 p-4">
        <div class="mb-2 flex flex-wrap items-baseline justify-between gap-1">
          <span class="text-sm font-semibold text-slate-800">难度</span>
          <span class="text-[11px] text-slate-400">只改场上待选单词数，速度、血量、时长都一样</span>
        </div>
        <div class="grid grid-cols-4 gap-2">
          <button
            v-for="d in DIFFICULTIES"
            :key="d.id"
            class="rounded-xl border px-1 py-2 text-center transition"
            :class="difficulty === d.id
              ? 'border-brand-500 bg-brand-50 text-brand-700 shadow-sm'
              : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'"
            @click="setDifficulty(d.id)"
          >
            <div class="text-sm font-semibold">{{ d.name }}</div>
            <div class="text-[11px] tabular-nums" :class="difficulty === d.id ? 'text-brand-500' : 'text-slate-400'">
              {{ d.options }} 词
            </div>
          </button>
        </div>
        <p class="mt-2 text-[11px] leading-relaxed text-slate-400">{{ difficultyMeta.desc }}</p>
      </div>

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
        <div class="flex flex-col items-start gap-1">
          <div class="rounded-lg bg-slate-900/70 px-2.5 py-1 text-sm font-semibold tabular-nums text-white">
            {{ untimed ? "练习" : timeText(hud.time) }}
          </div>
          <!-- 层级 + 难度：放同一行，别往下挤，不然会被中间的目标提示条盖住 -->
          <div class="flex items-center gap-1">
            <!-- 层级：半径封顶后，进度感靠它体现（越吃背景越远） -->
            <span class="rounded-md bg-white/85 px-2 py-0.5 text-[11px] text-slate-500">
              {{ tierLabel }}
            </span>
            <span class="rounded-md bg-white/85 px-2 py-0.5 text-[11px] text-slate-500">
              {{ difficultyMeta.name }} · {{ difficultyMeta.options }} 词
            </span>
          </div>
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

      <!-- 目标提示（只给中文，不能给英文，否则一眼就找到答案了）
           这里用完整释义：球内只有十几个字，长释义放不下；横条可以换行
           位置从 52px 下移到 64px：左上角现在是「时间 + 层级/难度」两行，不能让提示条压上去 -->
      <div class="pointer-events-none absolute inset-x-0 top-[64px] flex flex-col items-center gap-1.5 px-3">
        <div
          class="max-w-[94%] rounded-xl bg-white/90 px-3 py-1.5 text-center text-xs leading-relaxed text-slate-600 shadow-sm"
        >
          <Target :size="12" class="mr-1 inline-block align-[-2px] text-brand-500" />
          吃掉意思是
          <span class="font-semibold text-slate-800">{{ hud.labelFull || hud.label }}</span>
          的球
        </div>

        <!-- 事件提示（升级 / 回血） -->
        <transition name="fade">
          <span
            v-if="banner"
            class="rounded-full bg-slate-900/80 px-4 py-1.5 text-sm font-medium text-white"
          >
            {{ banner }}
          </span>
        </transition>
      </div>

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
        <!-- 难度：随时可换，换了立刻重建这一局 -->
        <div class="mt-1 flex flex-wrap items-center justify-center gap-1.5">
          <button
            v-for="d in DIFFICULTIES"
            :key="d.id"
            class="rounded-full px-2.5 py-1 text-[11px] transition"
            :class="difficulty === d.id
              ? 'bg-brand-600 text-white'
              : 'bg-white text-slate-500 ring-1 ring-slate-200 hover:bg-slate-50'"
            @click="setDifficulty(d.id)"
          >
            {{ d.name }} · {{ d.options }} 词
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
            最高连击 {{ result.bestCombo }} · {{ bestTierName }} · {{ difficultyMeta.name }}档
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
