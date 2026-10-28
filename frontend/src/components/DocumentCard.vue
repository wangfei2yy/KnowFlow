<script setup lang="ts">
import { computed } from "vue";
import type { Document } from "@/types/document";
import { SOURCE_TYPE_LABEL } from "@/types/document";
import { useDocumentStore } from "@/stores/documentStore";
import { formatDate, excerpt } from "@/utils/format";
import HighlightText from "@/components/HighlightText.vue";
import { Star, FileText, Globe, StickyNote, Type } from "lucide-vue-next";

const props = defineProps<{ document: Document; keyword?: string }>();
const emit = defineEmits<{ (e: "toggle-favorite"): void }>();

const docStore = useDocumentStore();
const category = computed(() => docStore.categoryById(props.document.categoryId));

const sourceIcon = {
  note: StickyNote,
  text: Type,
  file: FileText,
  web: Globe
};

const sourceIconComp = computed(() => sourceIcon[props.document.sourceType] ?? StickyNote);

const summary = computed(() => props.document.summary || excerpt(props.document.content));
</script>

<template>
  <div class="card group flex cursor-pointer flex-col gap-3 p-4 transition hover:shadow-md">
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-center gap-2 text-xs text-slate-400">
        <component :is="sourceIconComp" :size="14" />
        <span>{{ SOURCE_TYPE_LABEL[document.sourceType] }}</span>
        <span v-if="category" class="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">{{ category.name }}</span>
      </div>
      <button
        class="rounded p-1 transition"
        :class="document.favorite ? 'text-amber-400' : 'text-slate-300 hover:text-amber-400'"
        @click.stop="emit('toggle-favorite')"
      >
        <Star :size="18" :fill="document.favorite ? 'currentColor' : 'none'" />
      </button>
    </div>

    <div class="flex-1">
      <h3 class="font-medium leading-snug text-slate-900 group-hover:text-brand-600">
        <HighlightText :text="document.title" :keyword="keyword || ''" />
      </h3>
      <p class="mt-1 line-clamp-2 text-sm text-slate-500">
        <HighlightText :text="summary" :keyword="keyword || ''" />
      </p>
    </div>

    <div class="flex items-center justify-between">
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="tag in document.tags.slice(0, 3)"
          :key="tag"
          class="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-600"
        >
          <HighlightText :text="tag" :keyword="keyword || ''" />
        </span>
      </div>
      <span class="whitespace-nowrap text-xs text-slate-400">{{ formatDate(document.updatedAt) }}</span>
    </div>
  </div>
</template>
