<script setup lang="ts">
import { useAppStore } from "@/stores/appStore";
import { CheckCircle2, AlertCircle, Info, X } from "lucide-vue-next";

const appStore = useAppStore();

const iconMap = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info
};

const colorMap = {
  success: "text-emerald-500",
  error: "text-red-500",
  info: "text-brand-500"
};
</script>

<template>
  <transition name="toast">
    <div
      v-if="appStore.toast.visible"
      class="pointer-events-auto flex items-center gap-2 rounded-lg border border-slate-100 bg-white px-4 py-3 shadow-lg"
    >
      <component :is="iconMap[appStore.toast.type]" :size="18" :class="colorMap[appStore.toast.type]" />
      <span class="text-sm text-slate-700">{{ appStore.toast.message }}</span>
      <button class="ml-1 text-slate-300 hover:text-slate-500" @click="appStore.hideToast">
        <X :size="16" />
      </button>
    </div>
  </transition>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}
</style>
