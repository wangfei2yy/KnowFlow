<script setup lang="ts">
import { Inbox } from "lucide-vue-next";

defineProps<{
  title: string;
  description: string;
}>();
</script>

<template>
  <div class="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white px-6 py-16 text-center">
    <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-50 text-slate-300">
      <Inbox :size="28" />
    </div>
    <h3 class="text-base font-medium text-slate-700">{{ title }}</h3>
    <p class="mt-1 max-w-sm text-sm text-slate-400">{{ description }}</p>
    <div class="mt-5">
      <slot />
    </div>
  </div>
</template>
