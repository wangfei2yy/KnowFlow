<script setup lang="ts">
import { useRoute } from "vue-router";
import { Home, Library, GraduationCap, CheckSquare, Settings } from "lucide-vue-next";

const route = useRoute();

const items = [
  { path: "/", label: "首页", icon: Home },
  { path: "/library", label: "资料库", icon: Library },
  { path: "/study", label: "学习", icon: GraduationCap },
  { path: "/tasks", label: "任务", icon: CheckSquare },
  { path: "/settings", label: "设置", icon: Settings }
];

function isActive(path: string) {
  if (path === "/") return route.path === "/";
  return route.path.startsWith(path);
}
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-40 border-t border-slate-100 bg-white/95 backdrop-blur lg:hidden"
    style="padding-bottom: env(safe-area-inset-bottom)"
    aria-label="主导航"
  >
    <div class="mx-auto flex max-w-lg">
      <router-link
        v-for="item in items"
        :key="item.path"
        :to="item.path"
        class="flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] transition"
        :class="isActive(item.path) ? 'text-brand-600' : 'text-slate-400'"
        :aria-current="isActive(item.path) ? 'page' : undefined"
      >
        <component :is="item.icon" :size="20" />
        <span>{{ item.label }}</span>
      </router-link>
    </div>
  </nav>
</template>
