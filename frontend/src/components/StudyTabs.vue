<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { LayoutDashboard, Layers, BookOpen, Languages, Gamepad2 } from "lucide-vue-next";
import { useReviewStore } from "@/stores/reviewStore";
import { IS_MINITOOL } from "@/utils/runtime";

const route = useRoute();
const reviewStore = useReviewStore();

interface Tab {
  path: string;
  label: string;
  icon: unknown;
  badge?: number;
}

/** 端内没有知识包（无网络），语法 / 成语 / 快乐学习三个 Tab 不出现 */
const tabs = computed<Tab[]>(() => {
  const base: Tab[] = [
    { path: "/study", label: "概览", icon: LayoutDashboard },
    { path: "/study/cards", label: "复习", icon: Layers, badge: reviewStore.pending }
  ];
  if (IS_MINITOOL) return base;
  return [
    ...base,
    { path: "/study/grammar", label: "语法", icon: BookOpen },
    { path: "/study/idiom", label: "成语", icon: Languages },
    { path: "/study/play", label: "快乐学习", icon: Gamepad2 }
  ];
});

/**
 * 概览是父路径，必须精确匹配，否则所有子路由都会点亮它；
 * 快乐学习下面还挂着 /play/quest、/play/orb，要用前缀匹配。
 */
function isActive(path: string): boolean {
  if (path === "/study") return route.path === "/study";
  return route.path === path || route.path.startsWith(`${path}/`);
}
</script>

<template>
  <nav class="mb-5 flex gap-1 overflow-x-auto rounded-xl bg-slate-100 p-1" aria-label="学习模块导航">
    <router-link
      v-for="t in tabs"
      :key="t.path"
      :to="t.path"
      class="flex flex-1 items-center justify-center gap-1 whitespace-nowrap rounded-lg px-1.5 py-2 text-[13px] transition sm:gap-1.5 sm:px-3 sm:text-sm"
      :class="
        isActive(t.path)
          ? 'bg-white font-medium text-brand-700 shadow-sm'
          : 'text-slate-500 hover:text-slate-700'
      "
      :aria-current="isActive(t.path) ? 'page' : undefined"
    >
      <!-- 手机宽度紧张，图标隐藏，保证四个 Tab 一屏放得下 -->
      <component :is="t.icon" :size="15" class="hidden shrink-0 sm:block" />
      <span>{{ t.label }}</span>
      <span
        v-if="t.badge"
        class="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
      >
        {{ t.badge > 99 ? "99+" : t.badge }}
      </span>
    </router-link>
  </nav>
</template>
