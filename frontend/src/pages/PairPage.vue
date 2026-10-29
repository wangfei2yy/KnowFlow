<script setup lang="ts">
/**
 * 中英配对：8 对卡片（英文 / 中文）铺成 4×4，翻两张，配上了就消除。
 *
 * 用 requestAnimationFrame 推进引擎的 tick —— 翻错后「等 0.75 秒翻回去」由引擎负责，
 * 页面不用自己维护定时器，也就不会出现卸载后还在跑的 setTimeout。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "@/stores/appStore";
import { useReviewStore } from "@/stores/reviewStore";
import { loadPackIndex, loadWords, type PackMeta } from "@/services/knowledgePack";
import { addWordToReview } from "@/services/quest/wordCards";
import { loadPlayPack, savePlayPack, saveGameResult, loadUntimed, saveUntimed } from "@/services/gameService";
import {
  createPairGame,
  flipCard,
  pairProgress,
  pairStars,
  startPairGame,
  tickPair,
  PAIR_GAME,
  type PairGameState
} from "@/games/pair/engine";
import { IS_MINITOOL } from "@/utils/runtime";
import { Clock, Trophy, RotateCcw, ArrowLeft, Play, Sparkles, Star } from "lucide-vue-next";

const router = useRouter();
const route = useRoute();
const appStore = useAppStore();
const reviewStore = useReviewStore();

type Phase = "ready" | "playing" | "over";

const phase = ref<Phase>("ready");
const loading = ref(false);
const packs = ref<PackMeta[]>([]);
const packId = ref((route.query.pack as string) || loadPlayPack());
const game = ref<PairGameState | null>(null);
const result = ref<PairGameState | null>(null);
const banked = ref(0);
/** 练习模式：不限时 */
const untimed = ref(loadUntimed());

let raf = 0;
let lastTs = 0;

const wordPacks = computed(() => packs.value.filter((p) => p.kind === "words" && p.id !== "idiom"));
const packTitle = computed(() => packs.value.find((p) => p.id === packId.value)?.title ?? "");
const timeLeft = computed(() =>
  untimed.value ? 0 : Math.ceil((game.value?.duration ?? PAIR_GAME.duration) - (game.value?.elapsed ?? 0))
);
const matched = computed(() => game.value?.matchedPairs ?? 0);
const totalPairs = computed(() => game.value?.totalPairs ?? PAIR_GAME.pairs);
const stars = computed(() => (result.value ? pairStars(result.value) : 0));

onMounted(async () => {
  if (IS_MINITOOL) {
    appStore.showToast("中英配对需要联网加载词库，请在网页版体验", "info");
    router.replace("/study/play");
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
  // 直接按上次选的词库备好一局，玩家点「开始」就能进
  await prepare();
});

onBeforeUnmount(() => stopLoop());

function stopLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

async function prepare() {
  loading.value = true;
  try {
    const words = await loadWords(packId.value);
    game.value = createPairGame({ words, untimed: untimed.value });
    phase.value = "ready";
    result.value = null;
    banked.value = 0;
  } catch (e) {
    appStore.showToast(e instanceof Error ? e.message : "词库加载失败", "error");
  } finally {
    loading.value = false;
  }
}

function start() {
  if (!game.value) return;
  game.value = startPairGame(game.value);
  phase.value = "playing";
  lastTs = 0;
  stopLoop();
  raf = requestAnimationFrame(loop);
}

function loop(ts: number) {
  const g = game.value;
  if (!g) return;
  const dt = lastTs ? (ts - lastTs) / 1000 : 0;
  lastTs = ts;
  const next = tickPair(g, dt);
  game.value = next;
  if (next.phase === "over") {
    settle();
    return;
  }
  raf = requestAnimationFrame(loop);
}

function onCard(index: number) {
  const g = game.value;
  if (!g || g.phase !== "playing") return;
  game.value = flipCard(g, index);
  if (game.value.phase === "over") settle();
}

async function settle() {
  const g = game.value;
  if (!g) return;
  stopLoop();
  phase.value = "over";
  result.value = g;
  saveGameResult("pair", packId.value, g.score);

  // 没配出来的词批量入队（时间到 / 命不命都不影响：没配出来就是没记住）
  const seen = new Set<number>();
  banked.value = 0;
  for (const card of g.cards) {
    if (card.matched || seen.has(card.pairId)) continue;
    seen.add(card.pairId);
    const word = g.words[card.pairId];
    if (!word) continue;
    try {
      await addWordToReview(packId.value, word, true);
      banked.value += 1;
    } catch (e) {
      console.warn("[KnowFlow] 配对错词入队失败：", e);
    }
  }
  if (banked.value) void reviewStore.refresh();
}

function replay() {
  void prepare().then(start);
}

function goHome() {
  stopLoop();
  router.push("/study/play");
}

function setUntimed(value: boolean) {
  if (untimed.value === value) return;
  untimed.value = value;
  saveUntimed(value);
  void prepare();
}

function switchPack(id: string) {
  if (id === packId.value || loading.value) return;
  packId.value = id;
  savePlayPack(id);
  game.value = null;
  void prepare();
}

function cardVisible(cardIndex: number): boolean {
  const g = game.value;
  if (!g) return false;
  const card = g.cards[cardIndex];
  if (!card) return false;
  return card.matched || g.flipped.includes(cardIndex);
}
</script>

<template>
  <div>
    <div class="mb-3 flex items-center justify-between gap-3">
      <button class="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700" @click="goHome">
        <ArrowLeft :size="15" /> 趣味学习
      </button>
      <span class="text-xs text-slate-400">中英配对 · {{ packTitle }}</span>
    </div>

    <!-- 选词库 + 开始 -->
    <div v-if="phase === 'ready'" class="card p-6">
      <div class="text-center">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-sky-50 text-sky-500">
          <Sparkles :size="22" />
        </div>
        <div class="mt-3 text-base font-semibold text-slate-800">中英配对</div>
        <p class="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-500">
          8 对卡片翻成 4×4，翻开两张：英文和它的中文意思凑成一对就消除。90 秒内全部配完有时间奖励。
        </p>
      </div>

      <div class="mt-4 flex flex-wrap justify-center gap-2">
        <button
          v-for="p in wordPacks"
          :key="p.id"
          class="rounded-full px-3 py-1.5 text-sm transition"
          :class="p.id === packId ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
          :disabled="loading"
          @click="switchPack(p.id)"
        >
          {{ p.title }}
        </button>
      </div>

      <div class="mt-4 text-center">
        <div class="inline-flex rounded-full bg-slate-100 p-0.5 text-xs">
          <button
            class="rounded-full px-3 py-1 transition"
            :class="!untimed ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'"
            @click="setUntimed(false)"
          >
            限时 90 秒
          </button>
          <button
            class="rounded-full px-3 py-1 transition"
            :class="untimed ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'"
            @click="setUntimed(true)"
          >
            练习 · 不限时
          </button>
        </div>
      </div>
      <div class="mt-3 text-center">
        <button class="btn-primary" :disabled="loading || !game" @click="start">
          <Play :size="15" /> 开始
        </button>
        <p v-if="!game && !loading" class="mt-2 text-[11px] text-slate-400">先选一个词库</p>
        <p v-if="loading" class="mt-2 text-[11px] text-slate-400">词库加载中…</p>
      </div>
    </div>

    <!-- 游戏中 -->
    <div v-else-if="phase === 'playing' && game" class="space-y-3">
      <div class="flex items-center justify-between text-sm">
        <span class="flex items-center gap-1 rounded-lg bg-slate-900/80 px-2.5 py-1 font-semibold tabular-nums text-white">
          <Clock :size="12" /> {{ untimed ? "练习" : Math.max(0, timeLeft) + "s" }}
        </span>
        <span class="text-xs text-slate-500">已配对 {{ matched }} / {{ totalPairs }}</span>
        <span class="font-semibold tabular-nums text-slate-700">{{ game.score }} 分</span>
      </div>

      <div class="grid grid-cols-4 gap-2">
        <button
          v-for="card in game.cards"
          :key="card.index"
          class="flex h-20 items-center justify-center rounded-xl border p-1 text-center transition"
          :class="
            card.matched
              ? 'border-emerald-200 bg-emerald-50 text-emerald-600 opacity-60'
              : cardVisible(card.index)
                ? 'border-brand-300 bg-white text-slate-800 shadow-sm'
                : 'border-slate-200 bg-slate-100 text-slate-300 hover:bg-slate-200'
          "
          :disabled="card.matched"
          @click="onCard(card.index)"
        >
          <span v-if="card.matched" class="text-lg">✓</span>
          <span
            v-else-if="cardVisible(card.index)"
            class="text-[13px] font-medium leading-tight"
            :class="card.kind === 'word' ? 'break-all' : ''"
          >
            {{ card.text }}
          </span>
          <span v-else class="text-lg">?</span>
        </button>
      </div>
      <p class="text-center text-[11px] text-slate-400">
        翻错的两张会在 0.75 秒后自动盖回去
      </p>
    </div>

    <!-- 结算 -->
    <div v-else-if="phase === 'over' && result" class="card p-6 text-center">
      <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-500">
        <Trophy :size="22" />
      </div>
      <div class="mt-2 flex items-center justify-center gap-1">
        <Star
          v-for="i in 3"
          :key="i"
          :size="16"
          :class="i <= stars ? 'fill-amber-400 text-amber-400' : 'text-slate-200'"
        />
      </div>
      <div class="mt-1 text-3xl font-bold tabular-nums text-slate-900">{{ result.score }} 分</div>
      <div class="mt-1 text-xs text-slate-500">
        {{ result.won ? "全部配完！" : `配出 ${result.matchedPairs} / ${result.totalPairs} 对` }} ·
        翻了 {{ result.moves }} 次 · 最高连对 {{ result.bestCombo }}
      </div>
      <div v-if="banked" class="mt-2 text-xs text-emerald-600">已把 {{ banked }} 个没配出来的词加入复习</div>

      <div class="mt-5 flex flex-wrap justify-center gap-2">
        <button class="btn-secondary" @click="goHome">趣味学习</button>
        <button class="btn-secondary" @click="replay">换一组词</button>
        <button class="btn-primary" @click="replay"><RotateCcw :size="15" /> 再来一局</button>
      </div>
    </div>
  </div>
</template>
