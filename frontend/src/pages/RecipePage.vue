<script setup lang="ts">
/**
 * 食谱库：24 道家常菜，按餐次筛选、搜索材料，详情可看步骤并加入任务清单。
 * 数据来自 data/食谱 的三份 PDF，由 scripts/build-life-packs.mjs 编译。
 */
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  Search,
  X,
  Loader2,
  Clock,
  CheckCircle2,
  ListPlus,
  ChefHat,
  Refrigerator,
  Check
} from "lucide-vue-next";
import {
  loadRecipes,
  loadIngredients,
  type IngredientEntry,
  type MealKey,
  type RecipeEntry
} from "@/services/knowledgePack";
import { findIngredient } from "@/services/foodPack";
import { commonMaterials, searchByPantry } from "@/services/kitchenService";
import { useTaskStore } from "@/stores/taskStore";
import { useAppStore } from "@/stores/appStore";

const route = useRoute();
const router = useRouter();
const taskStore = useTaskStore();
const appStore = useAppStore();

const recipes = ref<RecipeEntry[]>([]);
const loading = ref(true);
const error = ref("");
const keyword = ref("");
const meal = ref<"" | MealKey>("");
const active = ref<RecipeEntry | null>(null);
const doneSteps = ref<Set<number>>(new Set());
/** 图鉴里收录的食材，用来决定材料标签能不能点 */
const ingredients = ref<IngredientEntry[]>([]);

/** 「我有这些食材」：勾选后反查能做的菜 */
const pantryOpen = ref(false);
const pantry = ref<Set<string>>(new Set());
const pantryKeyword = ref("");

const allMaterials = computed(() => commonMaterials(recipes.value, 999));
const pantryCandidates = computed(() => {
  const kw = pantryKeyword.value.trim();
  const base = allMaterials.value;
  // 不做条数截断：高频材料只占前几十个，一旦截断，「番茄」这种低频词就彻底看不见了，
  // 而用户并不知道要搜什么。全量铺开 + 搜索框收敛更符合「翻冰箱」的场景。
  return kw ? base.filter((m) => m.name.includes(kw)) : base;
});
const pantryResult = computed(() =>
  searchByPantry(recipes.value, [...pantry.value], 2, ingredients.value)
);

function togglePantry(name: string) {
  const next = new Set(pantry.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  pantry.value = next;
}

function clearPantry() {
  pantry.value = new Set();
}

/** 从反查结果直接打开某道菜 */
function openFromPantry(r: RecipeEntry) {
  pantryOpen.value = false;
  open(r);
}

const MEALS: { key: "" | MealKey; label: string }[] = [
  { key: "", label: "全部" },
  { key: "breakfast", label: "早餐" },
  { key: "lunch", label: "午餐" },
  { key: "dinner", label: "晚餐" }
];
const MEAL_LABEL: Record<MealKey, string> = {
  breakfast: "早餐",
  lunch: "午餐",
  dinner: "晚餐",
  snack: "加餐"
};

onMounted(async () => {
  void loadIngredients()
    .then((list) => (ingredients.value = list))
    .catch(() => {});
  try {
    recipes.value = await loadRecipes();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "食谱加载失败";
  } finally {
    loading.value = false;
  }
  openFromQuery(typeof route.query.recipe === "string" ? route.query.recipe : undefined);
});

const filtered = computed(() => {
  const kw = keyword.value.trim();
  return recipes.value.filter((r) => {
    if (meal.value && r.meal !== meal.value) return false;
    if (!kw) return true;
    return (
      r.name.includes(kw) ||
      r.materials.some((m) => m.includes(kw)) ||
      r.tags.some((t) => t.includes(kw))
    );
  });
});

const mealCount = computed(() =>
  MEALS.filter((m) => m.key).map((m) => ({
    ...m,
    count: recipes.value.filter((r) => r.meal === m.key).length
  }))
);

function closeDetail() {
  active.value = null;
  if (route.query.recipe) router.replace({ path: "/kitchen", query: {} });
}

function open(r: RecipeEntry) {
  active.value = r;
  doneSteps.value = new Set();
}

/** 从食材图鉴跳过来：?recipe=<id> 直接展开这道菜 */
function openFromQuery(id: string | undefined) {
  if (!id) return;
  const hit = recipes.value.find((r) => r.id === id);
  if (hit) open(hit);
}

/** 材料在图鉴里有收录才可点，没收录的保持纯文本 */
function knownMaterial(name: string): IngredientEntry | undefined {
  return findIngredient(ingredients.value, name);
}

function gotoIngredient(name: string) {
  router.push({ path: "/kitchen/ingredient", query: { focus: name } });
}

watch(
  () => route.query.recipe,
  (v) => openFromQuery(typeof v === "string" ? v : undefined)
);

function toggleStep(idx: number) {
  const next = new Set(doneSteps.value);
  if (next.has(idx)) next.delete(idx);
  else next.add(idx);
  doneSteps.value = next;
}

/** 把这道菜的步骤变成一条任务，今天照着做 */
async function addToTasks(r: RecipeEntry) {
  try {
    await taskStore.create({
      title: `做一道：${r.name}`,
      description: r.steps.map((s, i) => `${i + 1}. ${s}`).join("\n"),
      priority: "medium"
    });
    appStore.showToast("已加入任务清单，今天照着做", "success");
    active.value = null;
  } catch (e) {
    appStore.showToast(e instanceof Error ? e.message : "加入失败", "error");
  }
}
</script>

<template>
  <div>
    <!-- 工具条 -->
    <div class="mb-4 flex flex-wrap items-center gap-2">
      <div class="relative min-w-[200px] flex-1">
        <Search :size="15" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          v-model="keyword"
          class="input-base pl-9"
          placeholder="搜菜名或材料，如「茄子」「鸡蛋」"
          aria-label="搜索食谱"
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
      <div class="flex gap-1">
        <button
          v-for="m in MEALS"
          :key="m.key"
          class="rounded-full px-2.5 py-1 text-xs transition"
          :class="meal === m.key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
          @click="meal = m.key"
        >
          {{ m.label }}
          <span v-if="m.key" class="opacity-70">{{ mealCount.find((c) => c.key === m.key)?.count }}</span>
        </button>
      </div>
      <button class="btn-secondary" :disabled="!recipes.length" @click="pantryOpen = true">
        <Refrigerator :size="14" />
        我有这些食材
        <span v-if="pantry.size" class="ml-1 rounded-full bg-brand-600 px-1.5 text-[10px] text-white">{{ pantry.size }}</span>
      </button>
    </div>

    <div v-if="loading" class="card flex items-center gap-2 p-6 text-sm text-slate-500">
      <Loader2 :size="16" class="animate-spin" /> 正在加载食谱…
    </div>
    <div v-else-if="error" class="card p-6 text-sm text-slate-500">{{ error }}</div>

    <div v-else class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="r in filtered"
        :key="r.id"
        class="card flex flex-col items-start gap-2 p-4 text-left transition hover:shadow-md"
        @click="open(r)"
      >
        <div class="flex w-full items-start gap-2">
          <span class="text-base font-semibold text-slate-900">{{ r.name }}</span>
          <span class="ml-auto shrink-0 rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-600">
            {{ MEAL_LABEL[r.meal] }}
          </span>
        </div>
        <div class="flex flex-wrap gap-1">
          <span
            v-for="t in r.tags.slice(0, 3)"
            :key="t"
            class="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"
          >
            {{ t }}
          </span>
        </div>
        <div class="mt-auto flex items-center gap-3 text-[11px] text-slate-400">
          <span class="flex items-center gap-1">
            <ChefHat :size="12" />
            {{ r.materials.length ? `${r.materials.length} 种材料` : "材料未列" }}
          </span>
          <span class="flex items-center gap-1"><Clock :size="12" /> {{ r.steps.length }} 步</span>
        </div>
      </button>
      <p v-if="filtered.length === 0" class="col-span-full py-10 text-center text-sm text-slate-400">
        没有匹配的菜，换个材料试试
      </p>
    </div>

    <!-- 冰箱反查：家里有什么 → 能做什么 -->
    <div
      v-if="pantryOpen"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      @click.self="pantryOpen = false"
    >
      <div class="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div class="flex items-center gap-2">
          <Refrigerator :size="18" class="text-brand-600" />
          <h2 class="text-base font-semibold text-slate-900">我有这些食材</h2>
          <button class="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100" aria-label="关闭" @click="pantryOpen = false">
            <X :size="18" />
          </button>
        </div>
        <p class="mt-1 text-xs text-slate-500">勾一下家里现有的，看看今天能做什么。差一两样的也会列出来。</p>

        <div class="relative mt-3">
          <Search :size="14" class="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input v-model="pantryKeyword" class="input-base pl-9 text-sm" placeholder="找食材，如「番茄」" aria-label="搜索食材" />
        </div>

        <div class="mt-3 flex flex-wrap gap-1.5">
          <button
            v-for="m in pantryCandidates"
            :key="m.name"
            class="rounded-full px-2.5 py-1 text-xs transition"
            :class="pantry.has(m.name) ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
            @click="togglePantry(m.name)"
          >
            <Check v-if="pantry.has(m.name)" :size="10" class="mr-0.5 inline" />
            {{ m.name }}
          </button>
          <span v-if="!pantryCandidates.length" class="text-xs text-slate-400">没有匹配的食材</span>
        </div>

        <div v-if="pantry.size" class="mt-4 border-t border-slate-100 pt-3">
          <div class="flex items-center gap-2 text-xs text-slate-500">
            <span>已选 {{ pantry.size }} 种</span>
            <button class="text-slate-400 hover:text-slate-600" @click="clearPantry">清空</button>
            <span class="ml-auto">
              能做 {{ pantryResult.full.length }} 道 · 差一两样 {{ pantryResult.near.length }} 道
            </span>
          </div>

          <div v-if="pantryResult.full.length" class="mt-3">
            <div class="mb-1.5 text-xs font-medium text-emerald-600">现在就能做</div>
            <div class="grid gap-1.5 sm:grid-cols-2">
              <button
                v-for="r in pantryResult.full.slice(0, 12)"
                :key="'full' + r.id"
                class="rounded-lg border border-emerald-100 bg-emerald-50/50 px-2.5 py-2 text-left text-sm text-slate-700 transition hover:border-emerald-200"
                @click="openFromPantry(r)"
              >
                {{ r.name }}
                <span class="ml-1 text-[11px] text-slate-400">{{ r.materials.length }} 种料</span>
              </button>
            </div>
          </div>

          <div v-if="pantryResult.near.length" class="mt-3">
            <div class="mb-1.5 text-xs font-medium text-amber-600">差一两样</div>
            <div class="grid gap-1.5 sm:grid-cols-2">
              <button
                v-for="n in pantryResult.near.slice(0, 12)"
                :key="'near' + n.recipe.id"
                class="rounded-lg border border-slate-100 bg-white px-2.5 py-2 text-left text-sm text-slate-700 transition hover:border-slate-200"
                @click="openFromPantry(n.recipe)"
              >
                {{ n.recipe.name }}
                <span class="ml-1 text-[11px] text-amber-600">缺 {{ n.missing.join("、") }}</span>
              </button>
            </div>
          </div>

          <p v-if="!pantryResult.full.length && !pantryResult.near.length" class="mt-3 text-xs text-slate-400">
            这几样凑不出菜，再勾一两样试试（差三样以上的不列，免得清单太长）。
          </p>
        </div>
      </div>
    </div>

    <!-- 详情弹层 -->
    <div
      v-if="active"
      class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      @click.self="active = null"
    >
      <div class="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-2xl sm:rounded-2xl">
        <div class="flex items-start gap-2">
          <div>
            <h2 class="text-xl font-bold text-slate-900">{{ active.name }}</h2>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
              <span class="rounded-full bg-brand-50 px-2 py-0.5 text-brand-600">{{ MEAL_LABEL[active.meal] }}</span>
              <span v-for="t in active.tags" :key="t" class="rounded bg-slate-100 px-1.5 py-0.5">{{ t }}</span>
            </div>
          </div>
          <button
            class="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100"
            aria-label="关闭"
            @click="closeDetail"
          >
            <X :size="18" />
          </button>
        </div>

        <div v-if="active.materials.length" class="mt-4">
          <div class="mb-2 text-xs font-medium text-slate-600">材料</div>
          <div class="flex flex-wrap gap-1.5">
            <template v-for="m in active.materials" :key="m">
              <button
                v-if="knownMaterial(m)"
                class="rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600 transition hover:bg-brand-50 hover:text-brand-700"
                :title="`看看「${m}」的营养与功效`"
                @click="gotoIngredient(m)"
              >
                {{ m }}
              </button>
              <span
                v-else
                class="rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-400"
              >
                {{ m }}
              </span>
            </template>
          </div>
        </div>

        <div v-else class="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
          这道菜的原文没有单独列材料清单，做法里提到的用量按需准备。
        </div>

        <div class="mt-4">
          <div class="mb-2 text-xs font-medium text-slate-600">做法</div>
          <ol class="space-y-2">
            <li
              v-for="(s, i) in active.steps"
              :key="i"
              class="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 transition hover:bg-slate-50"
              @click="toggleStep(i)"
            >
              <span
                class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]"
                :class="doneSteps.has(i) ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'"
              >
                <CheckCircle2 v-if="doneSteps.has(i)" :size="13" />
                <template v-else>{{ i + 1 }}</template>
              </span>
              <span
                class="text-sm leading-relaxed"
                :class="doneSteps.has(i) ? 'text-slate-400 line-through' : 'text-slate-700'"
              >
                {{ s }}
              </span>
            </li>
          </ol>
        </div>

        <div class="mt-5 flex gap-2">
          <button class="btn-primary flex-1" @click="addToTasks(active)">
            <ListPlus :size="14" /> 加入任务清单
          </button>
          <button class="btn-secondary" @click="active = null">关闭</button>
        </div>
      </div>
    </div>
  </div>
</template>
