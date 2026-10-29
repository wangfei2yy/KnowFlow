<script setup lang="ts">
/**
 * 食材图鉴：把「食材本身」补上 —— 营养、功效、挑选保存、宜忌，以及它在哪些菜里出现。
 *
 * 学习动作只有一处：详情里的「加入复习」。点下去就进入现有 SRS 队列，
 * 学习中心会照常提醒，不需要在这里另造一套记忆机制。
 */
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAppStore } from "@/stores/appStore";
import { useReviewStore } from "@/stores/reviewStore";
import { loadIngredients, loadRecipes, type IngredientCategory, type IngredientEntry, type RecipeEntry } from "@/services/knowledgePack";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  cardAnswerOf,
  filterIngredients,
  highlightOf,
  isInSeason,
  nutritionRows,
  recipesUsing,
  seasonOf,
  sortIngredients
} from "@/services/foodPack";
import { hasWordInReview, addWordToReview } from "@/services/quest/wordCards";
import { Loader2, Search, Sprout, ChefHat, Plus, Check, Info, ArrowLeft } from "lucide-vue-next";

const route = useRoute();
const router = useRouter();
const appStore = useAppStore();
const reviewStore = useReviewStore();

const all = ref<IngredientEntry[]>([]);
const recipes = ref<RecipeEntry[]>([]);
const loading = ref(true);
const error = ref("");

const keyword = ref("");
const category = ref<IngredientCategory | "">("");
const onlySeason = ref(false);

const active = ref<IngredientEntry | null>(null);
const inReview = ref(false);
const adding = ref(false);

const season = seasonOf();

const filtered = computed(() =>
  sortIngredients(
    filterIngredients(all.value, {
      keyword: keyword.value,
      category: category.value,
      onlySeason: onlySeason.value,
      season
    }),
    season
  )
);

const seasonCount = computed(() => all.value.filter((e) => isInSeason(e, season)).length);

const activeRecipes = computed(() => (active.value ? recipesUsing(recipes.value, active.value) : []));
const activeRows = computed(() => (active.value ? nutritionRows(active.value) : []));

onMounted(async () => {
  try {
    const [ing, rec] = await Promise.all([loadIngredients(), loadRecipes().catch(() => [])]);
    all.value = ing;
    recipes.value = rec;
  } catch (e) {
    error.value = e instanceof Error ? e.message : "食材数据加载失败";
  } finally {
    loading.value = false;
  }
  // 从食谱页跳过来时带 ?focus=菠菜：直接展开这条
  const focus = route.query.focus as string | undefined;
  if (focus) await openByName(focus);
});

watch(
  () => route.query.focus,
  (v) => {
    if (v) void openByName(String(v));
  }
);

async function openByName(name: string) {
  const hit = all.value.find((e) => e.name === name || (e.alias ?? []).includes(name));
  if (!hit) {
    appStore.showToast(`还没有「${name}」的食材条目`, "info");
    return;
  }
  await open(hit);
}

async function open(entry: IngredientEntry) {
  active.value = entry;
  inReview.value = await hasWordInReview(entry.name);
}

function close() {
  active.value = null;
  inReview.value = false;
  if (route.query.focus) router.replace({ path: "/kitchen/ingredient", query: {} });
}

async function addToReview() {
  const entry = active.value;
  if (!entry || adding.value || inReview.value) return;
  adding.value = true;
  try {
    await addWordToReview("food", { w: entry.name, m: cardAnswerOf(entry) }, false);
    inReview.value = true;
    void reviewStore.refresh();
    appStore.showToast(`「${entry.name}」已加入复习队列`, "success");
  } catch (e) {
    appStore.showToast(e instanceof Error ? e.message : "加入复习失败", "error");
  } finally {
    adding.value = false;
  }
}

function gotoRecipe(id: string) {
  router.push({ path: "/kitchen", query: { recipe: id } });
}
</script>

<template>
  <div>
    <p class="mb-4 text-xs text-slate-500">
      每 100g 可食部的营养参考值。当前是
      <span class="font-medium text-brand-600">{{ season }}季</span>，共 {{ seasonCount }} 种当季食材。
      数据为常见品种参考值，不同产地会有差异，不作为医疗或膳食处方依据。
    </p>

    <!-- 工具条 -->
    <div class="mb-4 space-y-2 rounded-xl border border-slate-100 bg-white p-3">
      <div class="flex items-center gap-2">
        <div class="relative flex-1">
          <Search :size="14" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            v-model="keyword"
            class="input-base w-full py-1.5 pl-8 text-sm"
            placeholder="搜食材名、别名或功效，如「菠菜」「补铁」"
          />
        </div>
        <button
          class="flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-xs transition"
          :class="onlySeason ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
          @click="onlySeason = !onlySeason"
        >
          <Sprout :size="13" /> 只看当季
        </button>
      </div>

      <div class="flex flex-wrap gap-1.5">
        <button
          class="rounded-full px-2.5 py-1 text-xs transition"
          :class="category === '' ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
          @click="category = ''"
        >
          全部 {{ all.length }}
        </button>
        <button
          v-for="c in CATEGORY_ORDER"
          :key="c"
          class="rounded-full px-2.5 py-1 text-xs transition"
          :class="category === c ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
          @click="category = c"
        >
          {{ CATEGORY_LABEL[c] }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="card flex items-center gap-2 p-6 text-sm text-slate-500">
      <Loader2 :size="16" class="animate-spin" /> 正在加载食材图鉴…
    </div>
    <div v-else-if="error" class="card p-6 text-sm text-slate-500">{{ error }}</div>
    <div v-else-if="!filtered.length" class="card p-6 text-center text-sm text-slate-500">
      没有匹配的食材，换个词试试，或关掉「只看当季」。
    </div>

    <!-- 网格 -->
    <div v-else class="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      <button
        v-for="e in filtered"
        :key="e.name"
        class="card flex flex-col items-start gap-1 p-3 text-left transition hover:shadow-md"
        @click="open(e)"
      >
        <div class="flex w-full items-start justify-between">
          <span class="text-2xl leading-none">{{ e.emoji }}</span>
          <span
            v-if="isInSeason(e, season)"
            class="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600"
          >
            当季
          </span>
        </div>
        <div class="mt-1 text-sm font-medium text-slate-800">{{ e.name }}</div>
        <div class="text-[11px] text-slate-400">
          {{ e.nutrition.kcal }} kcal · {{ CATEGORY_LABEL[e.category] }}
        </div>
        <div v-if="highlightOf(e)" class="mt-auto pt-1 text-[10px] text-brand-500">
          {{ highlightOf(e) }}
        </div>
      </button>
    </div>

    <!-- 详情弹层 -->
    <div v-if="active" class="fixed inset-0 z-40 flex items-end justify-center bg-black/30 p-0 sm:items-center sm:p-4" @click.self="close">
      <div class="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div class="flex items-start gap-3">
          <span class="text-3xl leading-none">{{ active.emoji }}</span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-baseline gap-2">
              <span class="text-lg font-semibold text-slate-900">{{ active.name }}</span>
              <span class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                {{ CATEGORY_LABEL[active.category] }}
              </span>
              <span
                v-for="s in active.seasons"
                :key="s"
                class="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-600"
              >
                {{ s }}
              </span>
            </div>
            <div v-if="active.alias?.length" class="mt-0.5 text-xs text-slate-400">
              别名：{{ active.alias.join(" / ") }}
            </div>
          </div>
          <button class="rounded p-1 text-slate-400 hover:bg-slate-100" @click="close">
            <ArrowLeft :size="16" />
          </button>
        </div>

        <!-- 营养表 -->
        <div class="mt-4 rounded-xl border border-slate-100">
          <div class="border-b border-slate-100 px-3 py-2 text-xs font-medium text-slate-600">
            营养（每 100g 可食部 · 参考值）
          </div>
          <div class="grid grid-cols-2 gap-x-4 gap-y-1.5 px-3 py-2.5 text-xs sm:grid-cols-3">
            <div v-for="row in activeRows" :key="row.label" class="flex items-baseline justify-between">
              <span class="text-slate-400">{{ row.label }}</span>
              <span class="font-medium tabular-nums text-slate-700">
                {{ row.value }}<span class="ml-0.5 text-[10px] font-normal text-slate-400">{{ row.unit }}</span>
              </span>
            </div>
          </div>
        </div>

        <div class="mt-3 space-y-2.5 text-sm">
          <div>
            <div class="mb-0.5 text-xs font-medium text-slate-500">功效</div>
            <p class="leading-relaxed text-slate-700">{{ active.benefit }}</p>
          </div>
          <div v-if="active.storage">
            <div class="mb-0.5 text-xs font-medium text-slate-500">挑选与保存</div>
            <p class="leading-relaxed text-slate-700">{{ active.storage }}</p>
          </div>
          <div v-if="active.caution" class="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2">
            <Info :size="13" class="mt-0.5 shrink-0 text-amber-500" />
            <p class="text-xs leading-relaxed text-amber-700">{{ active.caution }}</p>
          </div>
        </div>

        <!-- 用得上它的菜 -->
        <div v-if="activeRecipes.length" class="mt-4">
          <div class="mb-1.5 flex items-center gap-1 text-xs font-medium text-slate-500">
            <ChefHat :size="13" /> 用得上它的菜
          </div>
          <div class="flex flex-wrap gap-1.5">
            <button
              v-for="r in activeRecipes"
              :key="r.id"
              class="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-brand-50 hover:text-brand-700"
              @click="gotoRecipe(r.id)"
            >
              {{ r.name }}
            </button>
          </div>
        </div>

        <div class="mt-5 flex gap-2">
          <button class="btn-secondary flex-1" @click="close">关闭</button>
          <button
            class="btn-primary flex-1"
            :disabled="inReview || adding"
            @click="addToReview"
          >
            <component :is="inReview ? Check : Plus" :size="15" />
            {{ inReview ? "已加入复习" : "加入复习" }}
          </button>
        </div>
        <p class="mt-2 text-center text-[11px] text-slate-400">
          加入后由复习计划安排回看，明天在学习中心提醒你
        </p>
      </div>
    </div>
  </div>
</template>
