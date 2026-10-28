<script setup lang="ts">
import { Construction } from "lucide-vue-next";

defineProps<{
  title: string;
  description: string;
}>();
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
    <div class="card flex flex-col items-center justify-center px-6 py-20 text-center">
      <div class="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-50 text-slate-300">
        <Construction :size="28" />
      </div>
      <h1 class="text-lg font-semibold text-slate-800">{{ title }}</h1>
      <p class="mt-2 max-w-md text-sm text-slate-400">{{ description }}</p>
      <router-link to="/" class="btn-secondary mt-6">返回首页</router-link>
    </div>
  </div>
</template>
