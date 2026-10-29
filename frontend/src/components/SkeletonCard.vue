<script setup lang="ts">
import SkeletonBlock from "@/components/SkeletonBlock.vue";
</script>

<template>
  <div class="card space-y-3 p-4" aria-hidden="true">
    <div class="flex items-center gap-2">
      <SkeletonBlock cls="h-4 w-4 rounded" />
      <SkeletonBlock cls="h-3 w-16" />
    </div>
    <SkeletonBlock cls="h-4 w-3/4" />
    <SkeletonBlock cls="h-3 w-full" />
    <SkeletonBlock cls="h-3 w-5/6" />
    <div class="flex gap-2 pt-1">
      <SkeletonBlock cls="h-5 w-12 rounded-full" />
      <SkeletonBlock cls="h-5 w-12 rounded-full" />
    </div>
  </div>
</template>
