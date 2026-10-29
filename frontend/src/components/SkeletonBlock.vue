<script setup lang="ts">
withDefaults(defineProps<{ cls?: string }>(), { cls: "h-4 w-full" });
</script>

<template>
  <div class="animate-pulse rounded-md bg-slate-100" :class="cls" aria-hidden="true"></div>
</template>
