<script setup lang="ts">
/**
 * 快乐学习：把「单词闯关」收纳成一种玩法，为后续小游戏留位置。
 *
 * 页面上只做三件事：选词库、看成绩、进游戏。
 * 具体玩法各自是独立页面（/study/play/quest、/study/play/orb），
 * 这样球球那种全屏 Canvas 游戏不会把这个列表页拖成大杂烩。
 */
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { loadPackIndex, type PackMeta } from "@/services/knowledgePack";
import { loadProgress, type QuestProgress } from "@/services/quest/engine";
import {
  loadGameProgress,
  gameScoreOf,
  loadPlayPack,
  savePlayPack,
  loadQuestSessions,
  resumeSession
} from "@/services/gameService";
import { IS_MINITOOL } from "@/utils/runtime";
import {
  Gamepad2,
  CircleDot,
  Languages,
  Shuffle,
  Trophy,
  ChevronRight,
  Lock
} from "lucide-vue-next";

const router = useRouter();

interface GameCard {
  id: string;
  title: string;
  desc: string;
  icon: unknown;
  /** 路由；没做完的玩法留空 */
  path?: string;
  accent: string;
}

const games: GameCard[] = [
  {
    id: "quest",
    title: "单词闯关",
    desc: "10 题一组，3 条命，答错自动收进复习",
    icon: Gamepad2,
    path: "/study/play/quest",
    accent: "bg-brand-50 text-brand-600"
  },
  {
    id: "orb",
    title: "单词球球",
    desc: "吃掉正确的英文球，球越大世界越大",
    icon: CircleDot,
    path: "/study/play/orb",
    accent: "bg-emerald-50 text-emerald-600"
  },
  {
    id: "idiom",
    title: "成语接龙",
    desc: "用上一个成语的末字接下一个",
    icon: Languages,
    accent: "bg-amber-50 text-amber-600"
  },
  {
    id: "pair",
    title: "中英配对",
    desc: "限时翻开卡片，把词和义连起来",
    icon: Shuffle,
    accent: "bg-sky-50 text-sky-600"
  }
];

const packs = ref<PackMeta[]>([]);
const packId = ref(loadPlayPack());
const questProgress = ref<Record<string, QuestProgress>>(loadProgress());
const gameProgress = ref(loadGameProgress());

const wordPacks = computed(() => packs.value.filter((p) => p.kind === "words"));

/** 当前词库是否有没打完的一局（只对闯关有意义，球球是一局制） */
const questResume = computed(() => {
  const saved = loadQuestSessions()[packId.value];
  return saved ? resumeSession(saved) : null;
});

onMounted(async () => {
  if (IS_MINITOOL) return;
  try {
    const index = await loadPackIndex();
    packs.value = index.packs;
    // 上次选的词库可能已不存在，回落到第一个
    if (!wordPacks.value.some((p) => p.id === packId.value)) {
      packId.value = wordPacks.value[0]?.id ?? "cet4";
    }
  } catch (e) {
    console.warn("[KnowFlow] 词库索引加载失败：", e);
  }
});

function selectPack(id: string) {
  packId.value = id;
  savePlayPack(id);
}

/** 卡片上的成绩：闯关沿用旧键，球球走新键 */
function scoreText(g: GameCard): string {
  if (g.id === "quest") {
    const p = questProgress.value[packId.value];
    return p ? `最高 ${p.bestScore} 分 · ${p.plays} 局` : "还没玩过";
  }
  if (g.id === "orb") {
    const s = gameScoreOf(gameProgress.value, "orb", packId.value);
    return s.plays > 0 ? `最高 ${s.bestScore} 分 · ${s.plays} 局` : "还没玩过";
  }
  return "即将上线";
}

function enter(g: GameCard) {
  if (!g.path) return;
  savePlayPack(packId.value);
  router.push({ path: g.path, query: { pack: packId.value } });
}

/** 闯关有存档时按钮变成「继续 · 第 n/10 题」，其余玩法直接「开始」 */
function actionLabel(g: GameCard): string {
  if (g.id === "quest" && questResume.value) {
    const s = questResume.value.session;
    return `继续 · 第 ${s.index + 1}/${s.questions.length} 题`;
  }
  return "开始";
}
</script>

<template>
  <div>
    <p class="mb-4 text-xs text-slate-500">
      边玩边学：答错的词会自动进入复习队列，明天由学习中心提醒你。
    </p>

    <!-- 词库选择 -->
    <div v-if="!IS_MINITOOL" class="mb-5 rounded-xl border border-slate-100 bg-white p-3">
      <div class="mb-2 text-xs text-slate-400">选择词库</div>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="p in wordPacks"
          :key="p.id"
          class="rounded-full px-3 py-1.5 text-sm transition"
          :class="
            p.id === packId
              ? 'bg-brand-600 text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          "
          @click="selectPack(p.id)"
        >
          {{ p.title }}
          <span class="ml-1 text-xs opacity-70">{{ p.count }}</span>
        </button>
        <span v-if="!wordPacks.length" class="text-sm text-slate-400">词库加载中…</span>
      </div>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <div
        v-for="g in games"
        :key="g.id"
        class="card flex flex-col gap-3 p-5 transition"
        :class="g.path ? 'hover:shadow-md' : 'opacity-60'"
      >
        <div class="flex items-start gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" :class="g.accent">
            <component :is="g.icon" :size="20" />
          </span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="text-base font-semibold text-slate-900">{{ g.title }}</span>
              <span
                v-if="!g.path"
                class="flex items-center gap-0.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-400"
              >
                <Lock :size="9" /> 即将上线
              </span>
            </div>
            <p class="mt-0.5 text-xs leading-relaxed text-slate-500">{{ g.desc }}</p>
          </div>
        </div>

        <div class="flex items-center justify-between">
          <span class="flex items-center gap-1 text-xs text-slate-400">
            <Trophy :size="12" /> {{ scoreText(g) }}
          </span>
          <button
            v-if="g.path"
            class="btn-primary px-3 py-1.5 text-sm"
            @click="enter(g)"
          >
            {{ actionLabel(g) }} <ChevronRight :size="14" />
          </button>
        </div>
      </div>
    </div>

    <div class="card mt-4 p-4 text-xs leading-relaxed text-slate-500">
      游戏成绩只记在本机。答错才会进复习队列；答对只加分，不打乱你原有的复习节奏。
    </div>
  </div>
</template>
