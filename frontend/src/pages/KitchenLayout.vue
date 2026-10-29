<script setup lang="ts">
/**
 * 饮食模块外壳：食谱 / 时令 / 计划三个面板共用顶部导航。
 */
import KitchenTabs from "@/components/KitchenTabs.vue";
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
    <KitchenTabs />
    <router-view />
  </div>
</template>
