<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useAppStore } from "@/stores/appStore";
import { useCompanionStore } from "@/stores/companionStore";
import { useReviewStore } from "@/stores/reviewStore";
import { loadPackIndex, loadWords, type PackMeta } from "@/services/knowledgePack";
import {
  startSession,
  answerCurrent,
  nextQuestion,
  currentQuestion,
  accuracy,
  saveProgress,
  loadProgress,
  type QuestSession,
  type WordEntry
} from "@/services/quest/engine";
import { addWrongWordToReview } from "@/services/quest/wordCards";
import {
  loadQuestSessions,
  saveQuestSession,
  clearQuestSession,
  resumeSession,
  type SavedQuest,
  type SavedQuestMap
} from "@/services/gameService";
import { IS_MINITOOL } from "@/utils/runtime";
import { Heart, Flame, Trophy, ArrowRight, ArrowLeft, RotateCcw, BookOpen, Sparkles, Play } from "lucide-vue-next";

const router = useRouter();
const route = useRoute();
const appStore = useAppStore();
const companionStore = useCompanionStore();
const reviewStore = useReviewStore();

type Phase = "lobby" | "playing" | "result";

const phase = ref<Phase>("lobby");
const packs = ref<PackMeta[]>([]);
const loading = ref(false);
const activePack = ref("cet4");
const words = ref<WordEntry[]>([]);
const session = ref<QuestSession | null>(null);
const progress = ref(loadProgress());
const bankedCount = ref(0);
/** 未完成的一局（按词库存档），用于大厅显示「继续」 */
const saves = ref<SavedQuestMap>(loadQuestSessions());

const question = computed(() => (session.value ? currentQuestion(session.value) : null));
const stars = computed(() => progress.value[activePack.value]?.bestScore ?? 0);

/** 可选词库（来自 index.json 的 words 类型包） */
const wordPacks = computed(() => packs.value.filter((p) => p.kind === "words"));

/** 某个词库是否有可继续的存档 */
function resumeOf(packId: string): SavedQuest | null {
  const s = saves.value[packId];
  if (!s) return null;
  return resumeSession(s);
}

onMounted(async () => {
  try {
    const index = await loadPackIndex();
    packs.value = index.packs;
  } catch (e) {
    console.warn("[KnowFlow] 词库索引加载失败：", e);
  }

  // 从快乐学习进来时会带 ?pack=cet6：直接开局（有存档就续上），少点一次
  const q = route.query.pack as string | undefined;
  if (q && !IS_MINITOOL) {
    await start(q, !!resumeOf(q));
  }
});

/**
 * 开始 / 继续一局。
 * 继续时仍然重新拉词库：题目来自存档，但「再来一局」需要完整词库。
 */
async function start(packId: string, fromSaved = false) {
  activePack.value = packId;
  if (IS_MINITOOL) {
    appStore.showToast("小工具内不支持在线词库，请在网页版体验", "info");
    return;
  }
  loading.value = true;
  try {
    words.value = await loadWords(packId);
    const saved = fromSaved ? resumeOf(packId) : null;
    if (saved) {
      session.value = saved.session;
      appStore.showToast(`已回到第 ${saved.session.index + 1} 题`, "info");
    } else {
      if (fromSaved) clearQuestSession(packId);
      saves.value = loadQuestSessions();
      session.value = startSession(words.value, { size: 10, lives: 3 });
    }
    phase.value = "playing";
    bankedCount.value = 0;
  } catch (e) {
    appStore.showToast(e instanceof Error ? e.message : "词库加载失败", "error");
  } finally {
    loading.value = false;
  }
}

/** 写存档；一局结束（finished）时改为清除这一个词库的存档 */
function persist(s: QuestSession | null) {
  if (!s) return;
  if (s.finished) {
    clearQuestSession(activePack.value);
    saves.value = loadQuestSessions();
    return;
  }
  saveQuestSession(activePack.value, s);
  saves.value = loadQuestSessions();
}

async function choose(option: string) {
  const s = session.value;
  if (!s || s.answered) return;
  const before = currentQuestion(s);
  session.value = answerCurrent(s, option);
  persist(session.value);

  // 答错：立刻写进复习队列（不阻塞交互）
  if (before && option !== before.answer) {
    void addWrongWordToReview(activePack.value, { w: before.word, p: before.phonetic, m: before.answer })
      .then(() => {
        bankedCount.value += 1;
        void reviewStore.refresh();
      })
      .catch((e) => console.warn("[KnowFlow] 错词入队失败：", e));
  }

  // 稍作停顿再进入下一题，让用户看到对错
  window.setTimeout(() => {
    const cur = session.value;
    if (!cur) return;
    if (cur.finished) finish();
    else {
      session.value = nextQuestion(cur);
      persist(session.value);
    }
  }, 750);
}

function finish() {
  const s = session.value;
  if (!s) return;
  const p = saveProgress(activePack.value, s.score);
  progress.value = { ...progress.value, [activePack.value]: p };
  clearQuestSession(activePack.value);
  saves.value = loadQuestSessions();
  phase.value = "result";
  if (s.wrongCount === 0) {
    companionStore.addAffection("reviewCard", "全对通关！单词记得真牢，好感度 +4 🔥");
  }
}

function retry() {
  session.value = startSession(words.value, { size: 10, lives: 3 });
  phase.value = "playing";
  bankedCount.value = 0;
  persist(session.value);
}

function backToLobby() {
  phase.value = "lobby";
  session.value = null;
}

const accuracyText = computed(() =>
  session.value ? `${Math.round(accuracy(session.value) * 100)}%` : "0%"
);
</script>

<template>
  <div class="mx-auto max-w-2xl">
    <p class="mb-4 text-xs text-slate-500">
      10 题一组，3 条命。答错的词会自动进入复习队列，明天由学习中心提醒你。
    </p>

    <!-- 选词库 -->
    <template v-if="phase === 'lobby'">
      <div class="grid gap-3 sm:grid-cols-2">
        <div
          v-for="p in wordPacks"
          :key="p.id"
          class="card flex flex-col items-start gap-2 p-5 text-left transition"
        >
          <div class="flex w-full items-center justify-between">
            <span class="text-base font-semibold text-slate-900">{{ p.title }}</span>
            <span class="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-600">
              {{ p.count }} {{ p.id === "idiom" ? "条" : "词" }}
            </span>
          </div>
          <div class="text-xs text-slate-400">
            最高分 {{ progress[p.id]?.bestScore ?? 0 }} · 已玩 {{ progress[p.id]?.plays ?? 0 }} 次
          </div>

          <!-- 有未完成存档：主按钮变成继续 -->
          <template v-if="resumeOf(p.id)">
            <button
              class="btn-primary mt-1 w-full"
              :disabled="loading"
              @click="start(p.id, true)"
            >
              <Play :size="14" />
              继续 · 第 {{ resumeOf(p.id)!.session.index + 1 }}/{{ resumeOf(p.id)!.session.questions.length }} 题
            </button>
            <button
              class="mt-1 flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
              :disabled="loading"
              @click="start(p.id)"
            >
              <RotateCcw :size="12" /> 重新开始
            </button>
          </template>
          <button
            v-else
            class="mt-1 flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700"
            :disabled="loading"
            @click="start(p.id)"
          >
            <Sparkles :size="14" /> 开始闯关
          </button>
        </div>
      </div>

      <div class="card mt-4 flex items-center gap-3 p-4 text-sm text-slate-500">
        <BookOpen :size="18" class="shrink-0 text-brand-500" />
        <span>
          词库来自内置的《四级/六级词汇·乱序版》与常用成语。想背自己的词表？到
          <router-link to="/import" class="text-brand-600 hover:underline">导入</router-link>
          里上传 CSV 即可。
        </span>
      </div>
    </template>

    <!-- 答题 -->
    <template v-else-if="phase === 'playing' && session">
      <div class="mb-3 flex items-center justify-between text-sm">
        <span class="flex items-center gap-2 text-slate-500">
          <button
            class="flex items-center gap-0.5 text-xs text-slate-400 hover:text-slate-600"
            title="进度已保存，随时可以回来继续"
            @click="router.push('/study/play')"
          >
            <ArrowLeft :size="13" /> 退出
          </button>
          第 {{ session.index + 1 }} / {{ session.questions.length }} 题
        </span>
        <div class="flex items-center gap-3">
          <span class="flex items-center gap-1 text-rose-500">
            <Heart v-for="i in session.maxLives" :key="i" :size="14" :class="i <= session.lives ? 'fill-rose-500' : 'text-slate-200'" />
          </span>
          <span class="flex items-center gap-1 text-amber-500"><Flame :size="14" /> {{ session.streak }}</span>
          <span class="font-semibold text-slate-700">{{ session.score }} 分</span>
        </div>
      </div>

      <div class="mb-2 h-1 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          class="h-full rounded-full bg-brand-500 transition-all"
          :style="{ width: ((session.index + 1) / session.questions.length) * 100 + '%' }"
        ></div>
      </div>

      <div v-if="question" class="card p-6 text-center">
        <div class="text-3xl font-bold tracking-tight text-slate-900">{{ question.word }}</div>
        <div v-if="question.phonetic" class="mt-1 text-sm text-slate-400">{{ question.phonetic }}</div>
      </div>

      <div v-if="question" class="mt-4 grid gap-2">
        <button
          v-for="opt in question.options"
          :key="opt"
          class="card px-4 py-3 text-left text-sm transition"
          :class="
            !session.answered
              ? 'hover:border-brand-300 hover:shadow-md'
              : opt === question.answer
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : opt === session.picked
                  ? 'border-rose-300 bg-rose-50 text-rose-600'
                  : 'opacity-60'
          "
          :disabled="session.answered"
          @click="choose(opt)"
        >
          {{ opt }}
        </button>
      </div>

      <p v-if="bankedCount > 0" class="mt-3 text-xs text-slate-400">
        已有 {{ bankedCount }} 个错词加入复习队列
      </p>
    </template>

    <!-- 结果 -->
    <template v-else-if="phase === 'result' && session">
      <div class="card p-6 text-center">
        <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-500">
          <Trophy :size="24" />
        </div>
        <div class="mt-3 text-2xl font-bold text-slate-900">{{ session.score }} 分</div>
        <div class="mt-1 text-sm text-slate-500">
          正确率 {{ accuracyText }} · 最高连击 {{ session.bestStreak }} · 错 {{ session.wrongCount }} 题
        </div>
        <div class="mt-2 text-xs text-slate-400">
          {{ session.wrongWords.length }} 个错词已加入复习队列
        </div>

        <div class="mt-5 flex flex-wrap justify-center gap-2">
          <button class="btn-secondary" @click="backToLobby">换个词库</button>
          <button class="btn-secondary" @click="router.push('/study/play')">返回快乐学习</button>
          <button class="btn-primary" @click="retry">
            <RotateCcw :size="16" /> 再来一局
          </button>
        </div>
      </div>

      <div v-if="session.wrongWords.length" class="card mt-4 p-4">
        <div class="mb-2 text-sm font-medium text-slate-700">本局错词</div>
        <ul class="space-y-1.5 text-sm">
          <li v-for="w in session.wrongWords" :key="w.w" class="flex items-baseline gap-2">
            <span class="font-medium text-slate-800">{{ w.w }}</span>
            <span class="truncate text-xs text-slate-500">{{ w.m }}</span>
          </li>
        </ul>
        <button class="btn-secondary mt-3" @click="router.push('/study/cards?mode=review')">
          去复习这些词 <ArrowRight :size="14" />
        </button>
      </div>
    </template>
  </div>
</template>
