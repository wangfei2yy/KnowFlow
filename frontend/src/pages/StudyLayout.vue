<script setup lang="ts">
/**
 * 学习模块外壳：三个子功能（概览 / 卡片复习 / 语法 / 闯关）共用同一个页面与顶部导航，
 * 切换 Tab 只替换下方面板，不整页跳转、不丢上下文。
 */
import StudyTabs from "@/components/StudyTabs.vue";
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
    <StudyTabs />
    <router-view />
  </div>
</template>
