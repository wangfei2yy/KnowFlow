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
  <span>
    <mark
      v-for="(p, i) in parts"
      :key="i"
      :class="p.hit ? 'rounded-sm bg-yellow-200 px-0.5 text-slate-900' : ''"
    >{{ p.text }}</mark>
  </span>
</template>
