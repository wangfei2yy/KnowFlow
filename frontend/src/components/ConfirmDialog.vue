<script setup lang="ts">
import { AlertTriangle } from "lucide-vue-next";

defineProps<{
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
}>();

const emit = defineEmits<{ (e: "confirm"): void; (e: "cancel"): void }>();
</script>

<template>
  <transition name="dialog">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div class="absolute inset-0 bg-black/40" @click="emit('cancel')"></div>
      <div class="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <div class="flex items-start gap-3">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            :class="danger ? 'bg-red-50 text-red-500' : 'bg-brand-50 text-brand-600'"
          >
            <AlertTriangle :size="20" />
          </div>
          <div class="flex-1">
            <h3 class="text-base font-semibold text-slate-900">{{ title }}</h3>
            <p class="mt-1 text-sm text-slate-500">{{ message }}</p>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button class="btn-secondary" @click="emit('cancel')">取消</button>
          <button
            class="btn-primary"
            :class="danger ? 'bg-red-600 hover:bg-red-700' : ''"
            @click="emit('confirm')"
          >
            {{ confirmText || "确定" }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s ease;
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
</style>
