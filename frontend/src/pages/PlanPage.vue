<script setup lang="ts">
/**
 * 饮食计划：从食谱池按餐次生成 7 天 / 28 天菜单，附购物清单。
 * 规则生成为主：同餐次最近两天不重复，忌口食材直接排除；不涉及营养计算（暂无营养数据）。
 */
import { computed, onMounted, ref } from "vue";
import {
  Loader2,
  RefreshCw,
  ShoppingBasket,
  Carrot,
  CalendarRange,
  ListPlus,
  ChevronDown,
  AlertCircle,
  Copy,
  CheckCheck,
  Lock,
  LockOpen,
  Repeat
} from "lucide-vue-next";
import { loadRecipes, loadIngredients, type IngredientEntry, type MealKey, type RecipeEntry } from "@/services/knowledgePack";
import { CATEGORY_LABEL, categorizeIngredients } from "@/services/foodPack";
import {
  findTodayMealTask,
  groupShopping,
  isSameMealTask,
  loadChecked,
  loadLocks,
  saveChecked,
  saveLocks,
  shoppingText,
  slotKeyOf,
  todayKey,
  type LockMap
} from "@/services/kitchenService";
import { useTaskStore } from "@/stores/taskStore";
import { useAppStore } from "@/stores/appStore";

const taskStore = useTaskStore();
const appStore = useAppStore();

const recipes = ref<RecipeEntry[]>([]);
const loading = ref(true);
const error = ref("");

const planDays = ref(7);
const exclude = ref("");
const generating = ref(false);
const showList = ref(false);

interface PlanMeal {
  key: MealKey;
  recipe: RecipeEntry;
}
interface PlanDay {
  date: Date;
  label: string;
  meals: PlanMeal[];
}

const plan = ref<PlanDay[]>([]);
const ingredients = ref<IngredientEntry[]>([]);

/** 购物清单勾选（按周隔离：换周自动清空，不会把上週的勾带过来） */
const checked = ref<Set<string>>(loadChecked());
/** 锁定的格子：`天数:餐次` → 菜 id；换周自动失效 */
const locks = ref<LockMap>(loadLocks());
const shoppingGroups = computed(() => groupShopping(shopping.value, ingredients.value, checked.value));
const checkedCount = computed(() => shoppingGroups.value.reduce((n, g) => n + g.items.filter((i) => i.checked).length, 0));

function toggleChecked(name: string) {
  const next = new Set(checked.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  checked.value = next;
  saveChecked(next);
}

/** 导出成纯文本：真正去超市带的是备忘录，不是网页 */
async function copyList() {
  const text = shoppingText(shoppingGroups.value);
  try {
    await navigator.clipboard.writeText(text);
    appStore.showToast("购物清单已复制，粘到备忘录就能带走", "success");
  } catch {
    // 没有剪贴板权限时退回「选中文本」的老办法
    appStore.showToast("复制失败，可长按选中清单手动复制", "error");
  }
}

const MEALS: MealKey[] = ["breakfast", "lunch", "dinner"];
const MEAL_LABEL: Record<MealKey, string> = {
  breakfast: "早",
  lunch: "午",
  dinner: "晚",
  snack: "加餐"
};
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

onMounted(async () => {
  // 必须先把任务读出来，否则「今天是否已加过」永远判断为没加过，就会重复创建
  void taskStore.load().catch(() => {});
  // 食材图鉴加载失败不影响计划生成，只是少了「食材构成」这一块
  void loadIngredients()
    .then((list) => (ingredients.value = list))
    .catch(() => {});
  try {
    recipes.value = await loadRecipes();
    generate();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "食谱加载失败";
  } finally {
    loading.value = false;
  }
});

/** 每个餐次可选数量，用来提示「早餐池太小会轮换」 */
const poolSizes = computed(() => {
  const map = {} as Record<MealKey, number>;
  for (const key of MEALS) map[key] = recipes.value.filter((r) => r.meal === key).length;
  return map;
});

/**
 * 加权随机：带材料清单的菜权重 3（购物清单才完整），只写了做法的权重 1（保证菜色多样）。
 * 硬性优先会让早餐只剩 3 道、午餐只剩 4 道反复出现。
 */
function pickOne(pool: RecipeEntry[], recent: string[]): RecipeEntry {
  const fresh = pool.filter((r) => !recent.includes(r.id));
  const list = fresh.length > 0 ? fresh : pool;
  const bag: RecipeEntry[] = [];
  for (const r of list) {
    const weight = r.materials.length > 0 ? 3 : 1;
    for (let i = 0; i < weight; i++) bag.push(r);
  }
  return bag[Math.floor(Math.random() * bag.length)];
}

function generate() {
  if (recipes.value.length === 0) return;
  generating.value = true;

  const banned = exclude.value
    .split(/[,，、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const usable = recipes.value.filter(
    (r) => !r.materials.some((m) => banned.some((b) => m.includes(b)))
  );
  if (usable.length === 0) {
    appStore.showToast("忌口太多，没有可用的菜了，放宽一下试试", "info");
    generating.value = false;
    return;
  }

  const byMeal = {} as Record<MealKey, RecipeEntry[]>;
  for (const key of MEALS) byMeal[key] = usable.filter((r) => r.meal === key);

  const recent = {} as Record<MealKey, string[]>;
  for (const key of MEALS) recent[key] = [];

  const base = new Date();
  base.setHours(0, 0, 0, 0);
  const days: PlanDay[] = [];

  for (let i = 0; i < planDays.value; i++) {
    const date = new Date(base.getTime() + i * 86400000);
    const meals: PlanMeal[] = [];
    for (const key of MEALS) {
      const pool = byMeal[key];
      if (pool.length === 0) continue;
      const recipe = pickOne(pool, recent[key]);
      meals.push({ key, recipe });
      // 最近两天不重复，池子小于 3 时自然轮换
      recent[key] = [recipe.id, ...recent[key]].slice(0, 2);
    }
    days.push({
      date,
      label: `${date.getMonth() + 1}/${date.getDate()} 周${WEEK[date.getDay()]}`,
      meals
    });
  }

  plan.value = days;
  generating.value = false;
}

/** 购物清单：所有天用到的材料去重计数 */
const shopping = computed(() => {
  const map = new Map<string, number>();
  for (const day of plan.value) {
    for (const m of day.meals) {
      for (const mat of m.recipe.materials) {
        map.set(mat, (map.get(mat) ?? 0) + 1);
      }
    }
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"));
});

/**
 * 本周食材构成：按图鉴的分类归类计数。
 * 只数「种数」，不折算热量 —— 原始菜谱没有份量（写的是「适量」），
 * 硬算热量只会得出一个假的数字。
 */
const foodSummary = computed(() => {
  if (!ingredients.value.length || !shopping.value.length) return null;
  return categorizeIngredients(
    shopping.value.map(([name]) => name),
    ingredients.value
  );
});

/** 计划里没有材料清单的菜数（原始数据只有做法） */
const noMaterialCount = computed(
  () => plan.value.flatMap((d) => d.meals).filter((m) => m.recipe.materials.length === 0).length
);

/** 今天的三餐加进任务清单，照着做就行 */
/** 单餐换一道：只动这一格，别的菜不动 */
function swapMeal(dayIndex: number, mealKey: MealKey) {
  const day = plan.value[dayIndex];
  const slot = day?.meals.find((m) => m.key === mealKey);
  if (!slot) return;

  // 换菜即视为放弃锁定，否则换了又被锁回去，等于没换
  const key = slotKeyOf(dayIndex, mealKey);
  if (locks.value[key]) {
    const next = { ...locks.value };
    delete next[key];
    locks.value = next;
    saveLocks(next);
  }

  const pool = recipes.value.filter((r) => r.meal === mealKey);
  if (pool.length <= 1) {
    appStore.showToast("这个餐次只有一道菜，换不了", "info");
    return;
  }
  // 排除本格现有的 + 相邻两天同餐次的，避免换完还是重复
  const banned = new Set<string>([slot.recipe.id]);
  for (const d of [plan.value[dayIndex - 1], plan.value[dayIndex + 1]]) {
    const sib = d?.meals.find((m) => m.key === mealKey);
    if (sib) banned.add(sib.recipe.id);
  }
  const candidates = pool.filter((r) => !banned.has(r.id));
  const list = candidates.length ? candidates : pool;
  slot.recipe = list[Math.floor(Math.random() * list.length)];
}

/** 锁定 / 解锁某一格 */
function toggleLock(dayIndex: number, mealKey: MealKey) {
  const slot = plan.value[dayIndex]?.meals.find((m) => m.key === mealKey);
  if (!slot) return;
  const key = slotKeyOf(dayIndex, mealKey);
  const next = { ...locks.value };
  if (next[key]) {
    delete next[key];
    appStore.showToast("已解锁", "info");
  } else {
    next[key] = slot.recipe.id;
    appStore.showToast("已锁定，点「换一换」时这道菜不动", "success");
  }
  locks.value = next;
  saveLocks(next);
}

/** 今天那条「今日三餐」任务（同一天只允许有一条） */
const todayTask = computed(() => findTodayMealTask(taskStore.tasks, todayKey()));

async function addTodayToTasks() {
  const today = plan.value[0];
  if (!today) return;
  const names = today.meals.map((m) => m.recipe.name).join(" / ");
  const detail = today.meals
    .map((m) => `${MEAL_LABEL[m.key]}餐 · ${m.recipe.name}\n${m.recipe.steps.map((s, i) => `  ${i + 1}. ${s}`).join("\n")}`)
    .join("\n\n");
  const title = `今日三餐：${names}`;
  try {
    const existing = todayTask.value;
    if (existing) {
      // 同一天只留一条：菜单没变就只提示，变了就覆盖内容（而不是再建一条）
      if (isSameMealTask(existing, title, detail)) {
        appStore.showToast("今天的三餐已经在任务清单里了", "info");
        return;
      }
      await taskStore.update(existing.id, { title, description: detail });
      appStore.showToast("今日任务已同步为当前菜单", "success");
      return;
    }
    await taskStore.create({
      title,
      description: detail,
      priority: "medium",
      // dueDate 是「同一天」的判据，也是任务清单里能看出来的日期
      dueDate: todayKey()
    });
    appStore.showToast("今日菜单已加入任务清单", "success");
  } catch (e) {
    appStore.showToast(e instanceof Error ? e.message : "加入失败", "error");
  }
}
</script>

<template>
  <div>
    <!-- 生成器 -->
    <div class="card p-4">
      <div class="flex flex-wrap items-end gap-3">
        <div>
          <div class="mb-1 text-xs text-slate-500">周期</div>
          <div class="flex gap-1">
            <button
              v-for="d in [7, 28]"
              :key="d"
              class="rounded-full px-3 py-1.5 text-xs transition"
              :class="planDays === d ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
              @click="planDays = d"
            >
              {{ d === 7 ? "一周" : "四周" }}
            </button>
          </div>
        </div>

        <div class="min-w-[180px] flex-1">
          <div class="mb-1 text-xs text-slate-500">忌口 / 不吃（逗号分隔）</div>
          <input
            v-model="exclude"
            class="input-base"
            placeholder="如：虾、花生、香菜"
            aria-label="忌口食材"
          />
        </div>

        <button class="btn-primary" :disabled="generating || loading" @click="generate">
          <RefreshCw :size="14" :class="generating ? 'animate-spin' : ''" />
          {{ plan.length ? "换一换" : "生成计划" }}
        </button>
      </div>

      <p class="mt-2 flex items-start gap-1.5 text-[11px] text-slate-400">
        <AlertCircle :size="12" class="mt-0.5 shrink-0" />
        <span>
          按「同餐次最近两天不重复」轮换，带材料清单的菜权重更高（购物清单更完整）；
          原始菜谱里有一部分只写了做法，共 {{ recipes.length }} 道可选，早餐 {{ poolSizes.breakfast }} 道。
          营养合计需要食材营养表，当前数据未包含。
        </span>
      </p>
    </div>

    <div v-if="loading" class="card mt-3 flex items-center gap-2 p-6 text-sm text-slate-500">
      <Loader2 :size="16" class="animate-spin" /> 正在加载食谱…
    </div>
    <div v-else-if="error" class="card mt-3 p-6 text-sm text-slate-500">{{ error }}</div>

    <template v-else-if="plan.length">
      <!-- 概览 -->
      <div class="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span class="flex items-center gap-1">
          <CalendarRange :size="13" /> {{ plan.length }} 天 ·
          {{ plan.reduce((n, d) => n + d.meals.length, 0) }} 餐
        </span>
        <span class="flex items-center gap-1">
          <ShoppingBasket :size="13" /> 共 {{ shopping.length }} 种材料
          <span v-if="noMaterialCount" class="text-slate-400">
            （{{ noMaterialCount }} 道菜未列材料）
          </span>
        </span>
        <button
          class="ml-auto btn-secondary"
          :title="todayTask ? '今天已经加过，点了会用当前菜单覆盖那一条' : '把今天三餐建成一条任务'"
          @click="addTodayToTasks"
        >
          <ListPlus :size="14" />
          {{ todayTask ? "同步今日菜单" : "今日菜单加入任务" }}
        </button>
      </div>

      <!-- 每日菜单 -->
      <div class="mt-3 space-y-2">
        <div
          v-for="(day, i) in plan"
          :key="i"
          class="card flex flex-wrap items-center gap-x-4 gap-y-1 p-3"
          :class="i === 0 ? 'ring-1 ring-brand-200' : ''"
        >
          <div class="flex w-24 shrink-0 items-center gap-2">
            <span class="text-xs font-medium text-slate-600">第 {{ i + 1 }} 天</span>
            <span v-if="i === 0" class="rounded bg-brand-600 px-1.5 py-0.5 text-[10px] text-white">今天</span>
          </div>
          <span class="w-28 shrink-0 text-[11px] text-slate-400">{{ day.label }}</span>
          <div class="flex flex-1 flex-wrap gap-x-4 gap-y-1">
            <span
              v-for="m in day.meals"
              :key="m.key"
              class="group inline-flex items-center gap-1 text-xs text-slate-600"
            >
              <span class="text-xs text-slate-400">{{ MEAL_LABEL[m.key] }}</span>
              {{ m.recipe.name }}
              <button
                class="rounded p-0.5 text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
                :title="`换一道${MEAL_LABEL[m.key]}餐`"
                :aria-label="`换一道${MEAL_LABEL[m.key]}餐`"
                @click="swapMeal(i, m.key)"
              >
                <Repeat :size="12" />
              </button>
              <button
                class="rounded p-0.5 transition hover:bg-slate-100"
                :class="locks[slotKeyOf(i, m.key)] ? 'text-brand-600' : 'text-slate-300 hover:text-slate-600'"
                :title="locks[slotKeyOf(i, m.key)] ? '已锁定，点一下解锁' : '锁定这道菜（换一换时不动）'"
                :aria-label="locks[slotKeyOf(i, m.key)] ? '解锁' : '锁定'"
                @click="toggleLock(i, m.key)"
              >
                <Lock v-if="locks[slotKeyOf(i, m.key)]" :size="12" />
                <LockOpen v-else :size="12" />
              </button>
            </span>
          </div>
        </div>
      </div>

      <!-- 购物清单 -->
      <div class="card mt-4 p-4">
        <button class="flex w-full items-center gap-2 text-sm font-medium text-slate-700" @click="showList = !showList">
          <ShoppingBasket :size="16" class="text-brand-600" />
          购物清单（{{ shopping.length }} 种）
          <ChevronDown :size="14" class="ml-auto transition" :class="showList ? 'rotate-180' : ''" />
        </button>
        <div v-if="showList" class="mt-3 space-y-3">
          <div class="flex items-center gap-2 text-[11px] text-slate-400">
            <span>已勾 {{ checkedCount }} / {{ shopping.length }}</span>
            <button
              v-if="checkedCount"
              class="hover:text-slate-600"
              @click="checked = new Set(); saveChecked(checked)"
            >
              全部取消
            </button>
            <button class="ml-auto flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 hover:bg-slate-200" @click="copyList">
              <Copy :size="11" /> 复制清单
            </button>
          </div>

          <div v-for="g in shoppingGroups" :key="g.category">
            <div class="mb-1 text-[11px] font-medium text-slate-500">
              {{ g.label }}
              <span class="ml-1 font-normal text-slate-400">{{ g.items.length }} 项</span>
            </div>
            <div class="flex flex-wrap gap-1.5">
              <button
                v-for="it in g.items"
                :key="it.name"
                class="flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition"
                :class="it.checked ? 'bg-slate-100 text-slate-400 line-through' : 'bg-slate-50 text-slate-600 hover:bg-slate-100'"
                @click="toggleChecked(it.name)"
              >
                <CheckCheck v-if="it.checked" :size="11" class="text-emerald-500" />
                {{ it.name }}
                <span class="text-[10px] text-slate-400">×{{ it.count }}</span>
              </button>
            </div>
          </div>
        </div>
        <p v-else class="mt-2 text-[11px] text-slate-400">点开可看完整清单，数字表示出现在几餐里。</p>
      </div>

      <!-- 食材构成（按图鉴归类） -->
      <div v-if="foodSummary && foodSummary.matched" class="card mt-4 p-4">
        <div class="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Carrot :size="16" class="text-brand-600" />
          本周食材构成
          <router-link
            to="/kitchen/ingredient"
            class="ml-auto text-xs font-normal text-brand-600 hover:underline"
          >
            看营养与功效
          </router-link>
        </div>
        <div class="mt-2.5 flex flex-wrap gap-1.5">
          <span
            v-for="c in foodSummary.counts"
            :key="c.category"
            class="rounded-lg bg-slate-50 px-2 py-1 text-xs text-slate-600"
          >
            {{ CATEGORY_LABEL[c.category] }}
            <span class="ml-0.5 font-medium text-slate-800">{{ c.count }}</span>
          </span>
        </div>
        <p class="mt-2 text-[11px] leading-relaxed text-slate-400">
          共 {{ foodSummary.total }} 种材料，其中 {{ foodSummary.matched }} 种已收录图鉴。
          菜谱只写「适量」没有份量，因此这里只统计种数，不折算热量。
        </p>
      </div>
    </template>
  </div>
</template>
