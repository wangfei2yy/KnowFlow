<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { AlertTriangle } from "lucide-vue-next";

const props = defineProps<{
  visible: boolean;
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
}>();

const emit = defineEmits<{ (e: "confirm"): void; (e: "cancel"): void }>();

const dialogRef = ref<HTMLElement | null>(null);
const cancelBtn = ref<HTMLButtonElement | null>(null);
/** 关闭后把焦点还给触发元素 */
let lastFocused: HTMLElement | null = null;

function focusables(): HTMLElement[] {
  const nodes = dialogRef.value?.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  return nodes ? [...nodes].filter((n) => !n.hasAttribute("disabled")) : [];
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    emit("cancel");
    return;
  }
  if (e.key !== "Tab") return;
  // 焦点锁定在对话框内，Tab / Shift+Tab 循环
  const nodes = focusables();
  if (nodes.length === 0) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

watch(
  () => props.visible,
  async (visible) => {
    if (visible) {
      lastFocused = document.activeElement as HTMLElement | null;
      await nextTick();
      cancelBtn.value?.focus();
      document.addEventListener("keydown", onKeydown);
    } else {
      document.removeEventListener("keydown", onKeydown);
      lastFocused?.focus?.();
      lastFocused = null;
    }
  },
  { immediate: true }
);

onBeforeUnmount(() => document.removeEventListener("keydown", onKeydown));
</script>

<template>
  <transition name="dialog">
    <div v-if="visible" class="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div class="absolute inset-0 bg-black/40" @click="emit('cancel')"></div>
      <div
        ref="dialogRef"
        class="relative w-full max-w-sm rounded-xl bg-white p-6 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
      >
        <div class="flex items-start gap-3">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            :class="danger ? 'bg-red-50 text-red-500' : 'bg-brand-50 text-brand-600'"
          >
            <AlertTriangle :size="20" />
          </div>
          <div class="flex-1">
            <h3 id="confirm-dialog-title" class="text-base font-semibold text-slate-900">{{ title }}</h3>
            <p id="confirm-dialog-desc" class="mt-1 text-sm text-slate-500">{{ message }}</p>
          </div>
        </div>
        <div class="mt-6 flex justify-end gap-2">
          <button ref="cancelBtn" class="btn-secondary" @click="emit('cancel')">取消</button>
          <button
            class="btn-primary"
            :class="danger ? 'bg-red-600 hover:bg-red-700' : ''"
            @click="emit('confirm')"
          >
            {{ confirmText || "确定" }}
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.dialog-enter-active,
.dialog-leave-active {
  transition: opacity 0.2s ease;
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
</style>
