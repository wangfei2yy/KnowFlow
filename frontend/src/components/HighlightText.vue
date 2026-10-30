<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ text: string; keyword: string }>();

// 将文本按关键词命中位置拆分为片段，命中部分高亮
const parts = computed(() => {
  if (!props.keyword) return [{ text: props.text, hit: false }];
  const kw = props.keyword.toLowerCase();
  const lower = props.text.toLowerCase();
  const res: { text: string; hit: boolean }[] = [];
  let i = 0;
  while (i < lower.length) {
    const idx = lower.indexOf(kw, i);
    if (idx < 0) {
      res.push({ text: props.text.slice(i), hit: false });
      break;
    }
    if (idx > i) res.push({ text: props.text.slice(i, idx), hit: false });
    res.push({ text: props.text.slice(idx, idx + kw.length), hit: true });
    i = idx + kw.length;
  }
  return res;
});
</script>

<template>
  <!--
    只给命中片段套 <mark>。
    之前所有片段都用 <mark>，而浏览器对 mark 有默认样式（亮黄底），
    于是没命中的正文也全是黄底 —— 资料库看起来满屏「黄亮字」。
  -->
  <span>
    <template v-for="(p, i) in parts" :key="i">
      <mark
        v-if="p.hit"
        class="rounded-[3px] bg-amber-200/70 px-[1px] text-slate-900 dark:bg-amber-300/25 dark:text-amber-100"
      >{{ p.text }}</mark>
      <span v-else>{{ p.text }}</span>
    </template>
  </span>
</template>
