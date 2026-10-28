<script setup lang="ts">
import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useDocumentStore } from "@/stores/documentStore";
import { Search, X } from "lucide-vue-next";

const props = withDefaults(
  defineProps<{
    /** 回车时是否跳转到资料库页展示结果（用于首页等无结果列表的页面） */
    enterToNavigate?: boolean;
  }>(),
  { enterToNavigate: false }
);

const router = useRouter();
const docStore = useDocumentStore();
const keyword = ref("");

watch(
  () => docStore.searchKeyword,
  (v) => {
    if (keyword.value !== v) keyword.value = v;
  }
);

function onInput() {
  docStore.searchKeyword = keyword.value;
}

function onEnter() {
  if (props.enterToNavigate && keyword.value.trim()) {
    // 跳转到资料库页，关键词已写入 store，落地后自动展示结果
    router.push("/library");
  }
}

function onClear() {
  keyword.value = "";
  docStore.searchKeyword = "";
}
</script>

<template>
  <div class="relative">
    <Search :size="18" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
    <input
      v-model="keyword"
      type="text"
      placeholder="搜索标题、正文或标签…"
      class="input-base pl-10 pr-9"
      @input="onInput"
      @keyup.enter="onEnter"
    />
    <button
      v-if="keyword"
      class="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
      @click="onClear"
    >
      <X :size="16" />
    </button>
  </div>
</template>
