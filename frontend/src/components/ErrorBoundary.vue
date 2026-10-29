<script setup lang="ts">
import { onErrorCaptured, ref } from "vue";
import { AlertTriangle, RotateCcw, Home } from "lucide-vue-next";

const error = ref<Error | null>(null);
const info = ref("");

onErrorCaptured((err, _instance, detail) => {
  error.value = err instanceof Error ? err : new Error(String(err));
  info.value = detail;
  console.error("[KnowFlow] 页面渲染出错：", err, detail);
  // 返回 false 阻止继续向上冒泡（避免整页白屏）
  return false;
});

function retry() {
  error.value = null;
  info.value = "";
}

function goHome() {
  retry();
  location.hash = "#/";
}
</script>

<template>
  <div v-if="error" class="mx-auto max-w-lg px-4 py-16">
    <div class="card p-6 text-center">
      <div class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-500">
        <AlertTriangle :size="24" />
      </div>
      <h2 class="mt-4 text-lg font-semibold text-slate-900">这个页面出了点问题</h2>
      <p class="mt-2 text-sm text-slate-500">
        你的数据保存在本地，不会丢失。可以重试加载，或先回首页。
      </p>

      <div class="mt-5 flex justify-center gap-2">
        <button class="btn-secondary" @click="retry">
          <RotateCcw :size="16" /> 重试
        </button>
        <button class="btn-primary" @click="goHome">
          <Home :size="16" /> 回首页
        </button>
      </div>

      <details class="mt-4 text-left">
        <summary class="cursor-pointer text-xs text-slate-400">查看错误详情</summary>
        <pre class="mt-2 max-h-40 overflow-auto rounded-lg bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-600">{{ error.message }}
{{ info }}</pre>
      </details>
    </div>
  </div>
  <slot v-else />
</template>
