<script setup lang="ts">
import { useRoute } from "vue-router";
import { ChefHat, Sprout, CalendarRange } from "lucide-vue-next";

const route = useRoute();

const tabs = [
  { path: "/kitchen", label: "食谱", icon: ChefHat },
  { path: "/kitchen/season", label: "时令", icon: Sprout },
  { path: "/kitchen/plan", label: "计划", icon: CalendarRange }
];

function isActive(path: string): boolean {
  return route.path === path;
}
</script>

<template>
  <nav class="mb-5 flex gap-1 rounded-xl bg-slate-100 p-1" aria-label="饮食模块导航">
    <router-link
      v-for="t in tabs"
      :key="t.path"
      :to="t.path"
      class="flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[13px] transition sm:text-sm"
      :class="
        isActive(t.path)
          ? 'bg-white font-medium text-brand-700 shadow-sm'
          : 'text-slate-500 hover:text-slate-700'
      "
      :aria-current="isActive(t.path) ? 'page' : undefined"
    >
      <component :is="t.icon" :size="15" class="hidden shrink-0 sm:block" />
      <span>{{ t.label }}</span>
    </router-link>
  </nav>
</template>
