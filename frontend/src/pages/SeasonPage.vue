<script setup lang="ts">
/**
 * 四季时令：按季节看当季蔬菜与水果，帮用户优先买当季的。
 */
import { computed, onMounted, ref } from "vue";
import { Sprout, Loader2 } from "lucide-vue-next";
import {
  loadIngredients,
  loadSeasons,
  type IngredientEntry,
  type SeasonEntry
} from "@/services/knowledgePack";
import { CATEGORY_LABEL, CATEGORY_ORDER } from "@/services/foodPack";

const seasons = ref<SeasonEntry[]>([]);
const loading = ref(true);
const error = ref("");

onMounted(async () => {
  try {
    seasons.value = await loadSeasons();
  } catch (e) {
    error.value = e instanceof Error ? e.message : "时令数据加载失败";
  } finally {
    loading.value = false;
  }
});

/** 当前季节：3-5 春 / 6-8 夏 / 9-11 秋 / 12-2 冬 */
const current = computed(() => {
  const m = new Date().getMonth() + 1;
  if (m >= 3 && m <= 5) return "春";
  if (m >= 6 && m <= 8) return "夏";
  if (m >= 9 && m <= 11) return "秋";
  return "冬";
});

const ordered = computed(() => {
  const order = ["春", "夏", "秋", "冬"];
  return [...seasons.value].sort((a, b) => order.indexOf(a.season) - order.indexOf(b.season));
});

// ---------------- 按月（数据来自时令表 PDF 的「按月份排」一节）----------------

const mode = ref<"season" | "month">("season");
const ingredients = ref<IngredientEntry[]>([]);
const month = ref(new Date().getMonth() + 1);

onMounted(async () => {
  try {
    ingredients.value = await loadIngredients();
  } catch {
    // 图鉴加载失败不影响「按季」视图
  }
});

/** 当月当季的食材（只算时令表里能对上图鉴的那 66 种） */
const monthList = computed(() => ingredients.value.filter((i) => i.months?.includes(month.value)));

const monthGroups = computed(() => {
  const buckets = new Map<string, string[]>();
  for (const it of monthList.value) {
    const label = CATEGORY_LABEL[it.category] ?? "其他";
    const list = buckets.get(label) ?? [];
    list.push(it.name);
    buckets.set(label, list);
  }
  const order = CATEGORY_ORDER.map((c) => CATEGORY_LABEL[c]);
  return [...buckets.entries()]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]) || a[0].localeCompare(b[0], "zh"))
    .map(([label, names]) => ({ label, names }));
});

/** 有多少种食材没被时令表收录月份 —— 说明口径，不要让人以为漏了 */
const monthGap = computed(() => ingredients.value.filter((i) => !i.months?.length).length);
</script>

<template>
  <div>
    <p class="mb-4 text-xs text-slate-500">
      当季的蔬果更新鲜、价格也更亲民。当前是
      <span class="font-medium text-brand-600">{{ current }}季</span>，优先看这一栏。
    </p>

    <!-- 按季 / 按月 -->
    <div class="mb-4 inline-flex rounded-full bg-slate-100 p-0.5 text-xs">
      <button
        class="rounded-full px-3 py-1 transition"
        :class="mode === 'season' ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'"
        @click="mode = 'season'"
      >
        按季
      </button>
      <button
        class="rounded-full px-3 py-1 transition"
        :class="mode === 'month' ? 'bg-white font-medium text-slate-800 shadow-sm' : 'text-slate-500'"
        @click="mode = 'month'"
      >
        按月
      </button>
    </div>

    <!-- 按月：时令表里 1~12 月都有，比四季细一档 -->
    <div v-if="mode === 'month'" class="card p-4">
      <div class="flex flex-wrap items-center gap-1.5">
        <span class="mr-1 text-xs text-slate-400">月份</span>
        <button
          v-for="m in 12"
          :key="m"
          class="rounded-full px-2 py-1 text-xs transition"
          :class="month === m ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'"
          @click="month = m"
        >
          {{ m }} 月
        </button>
      </div>

      <div class="mt-3 space-y-3">
        <div v-for="g in monthGroups" :key="g.label">
          <div class="mb-1 text-xs font-medium text-slate-500">
            {{ g.label }}
            <span class="ml-1 font-normal text-slate-400">{{ g.names.length }} 种</span>
          </div>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="n in g.names"
              :key="n"
              class="rounded-lg bg-emerald-50 px-2 py-1 text-xs text-emerald-700"
            >
              {{ n }}
            </span>
          </div>
        </div>
        <p v-if="!monthGroups.length" class="text-xs text-slate-400">这个月的食材还在加载…</p>
      </div>

      <p class="mt-3 text-[11px] leading-relaxed text-slate-400">
        {{ month }} 月共 {{ monthList.length }} 种。月份来自《一年四季时令蔬菜水果表》，
        只有能对上食材图鉴的名字才计入 —— 另有 {{ monthGap }} 种食材该表未收录月份，
        在「按季」里仍按四季展示。
      </p>
    </div>

    <div v-if="mode === 'season' && loading" class="card flex items-center gap-2 p-6 text-sm text-slate-500">
      <Loader2 :size="16" class="animate-spin" /> 正在加载时令表…
    </div>
    <div v-else-if="mode === 'season' && error" class="card p-6 text-sm text-slate-500">{{ error }}</div>

    <div v-else-if="mode === 'season'" class="grid gap-3 sm:grid-cols-2">
      <div
        v-for="s in ordered"
        :key="s.season"
        class="card p-4"
        :class="s.season === current ? 'ring-2 ring-brand-300' : ''"
      >
        <div class="mb-3 flex items-center gap-2">
          <span
            class="flex h-8 w-8 items-center justify-center rounded-lg"
            :class="s.season === current ? 'bg-brand-50 text-brand-600' : 'bg-slate-50 text-slate-400'"
          >
            <Sprout :size="16" />
          </span>
          <span class="font-semibold text-slate-800">{{ s.season }}季</span>
          <span
            v-if="s.season === current"
            class="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] text-white"
          >
            当季
          </span>
        </div>

        <div class="mb-1 text-[11px] text-slate-400">蔬菜</div>
        <div class="mb-3 flex flex-wrap gap-1">
          <span
            v-for="v in s.vegetables"
            :key="v"
            class="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700"
          >
            {{ v }}
          </span>
        </div>

        <div class="mb-1 text-[11px] text-slate-400">水果</div>
        <div class="flex flex-wrap gap-1">
          <span
            v-for="f in s.fruits"
            :key="f"
            class="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700"
          >
            {{ f }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
