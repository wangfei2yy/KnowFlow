<script setup lang="ts">
/**
 * 四季时令：按季节看当季蔬菜与水果，帮用户优先买当季的。
 */
import { computed, onMounted, ref } from "vue";
import { Sprout, Loader2 } from "lucide-vue-next";
import { loadSeasons, type SeasonEntry } from "@/services/knowledgePack";

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
</script>

<template>
  <div>
    <p class="mb-4 text-xs text-slate-500">
      当季的蔬果更新鲜、价格也更亲民。当前是
      <span class="font-medium text-brand-600">{{ current }}季</span>，优先看这一栏。
    </p>

    <div v-if="loading" class="card flex items-center gap-2 p-6 text-sm text-slate-500">
      <Loader2 :size="16" class="animate-spin" /> 正在加载时令表…
    </div>
    <div v-else-if="error" class="card p-6 text-sm text-slate-500">{{ error }}</div>

    <div v-else class="grid gap-3 sm:grid-cols-2">
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
