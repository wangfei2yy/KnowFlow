<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onBeforeUnmount, watch } from "vue";
import { useCompanionStore } from "@/stores/companionStore";
import CompanionAvatar from "@/components/CompanionAvatar.vue";
import {
  levelTitle,
  levelFromAffection,
  levelProgress,
  daysSince,
  formFromAffection,
  FORM_NAMES,
  FORM_UPGRADE_THRESHOLD,
  FORM_UPGRADE_THRESHOLD_3
} from "@/services/companion/types";
import { useRouter } from "vue-router";
import { X, Heart, Power, ImagePlus, Mic } from "lucide-vue-next";
import { useVoiceInput } from "@/composables/useVoiceInput";
import { IS_MINITOOL, detectInAppBrowser } from "@/utils/runtime";

const router = useRouter();
const store = useCompanionStore();

const open = ref(false);
const input = ref("");
const listRef = ref<HTMLDivElement | null>(null);
const avatarInput = ref<HTMLInputElement | null>(null);

// ---------- 语音输入（按住说话）----------
const {
  status: voiceStatus,
  seconds: voiceSeconds,
  cancelArmed: voiceCancelArmed,
  hint: voiceHint,
  mode: voiceMode,
  available: voiceAvailable,
  visible: voiceVisible,
  unavailableHint: voiceUnavailableHint,
  start: voiceStart,
  finish: voiceFinish,
  setSlide: voiceSlide
} = useVoiceInput({
  onText(text) {
    // 松手即发送，与微信语音一致：转写完直接交给小知处理（含 function calling）
    input.value = text;
    send();
  },
  onError(message) {
    showVoiceTip(message);
  }
});

/** 面板内的语音提示（面板打开时鼓励气泡是隐藏的，错误必须显示在面板里） */
const voiceTip = ref("");
/** 提示条上的动作：去设置 / 复制链接（便于在系统浏览器打开） */
const voiceTipActions = ref<("settings" | "copy")[]>([]);
let voiceTipTimer: number | undefined;
function showVoiceTip(message: string, actions: ("settings" | "copy")[] = []) {
  voiceTip.value = message;
  voiceTipActions.value = actions;
  window.clearTimeout(voiceTipTimer);
  voiceTipTimer = window.setTimeout(() => {
    voiceTip.value = "";
    voiceTipActions.value = [];
  }, 8000);
}

function goSettings() {
  voiceTip.value = "";
  voiceTipActions.value = [];
  router.push("/settings");
}

async function copyLink() {
  const url = window.location.href;
  try {
    await navigator.clipboard.writeText(url);
    showVoiceTip("链接已复制，粘贴到手机自带浏览器打开即可用语音", ["settings"]);
  } catch {
    // 部分端内浏览器禁用剪贴板：退化为提示手动复制
    showVoiceTip("请长按地址栏复制链接，再到手机自带浏览器打开", ["settings"]);
  }
}

/** 按住时记录起点，用于判断上滑取消 */
let pressY = 0;
/** 触摸设备：改用「点一下开始、再点发送」，避免长按被浏览器菜单（如「标记广告」）抢走 */
const isTouchDevice = ref(false);
/** 触摸按下的时间戳：用于区分「点按」（继续录）与「按住说话」（抬手即发送） */
let touchDownAt = 0;

function voiceDown(e: PointerEvent) {
  if (!voiceAvailable.value && voiceStatus.value === "idle") {
    showVoiceTip(voiceUnavailableHint.value, ["copy", "settings"]);
    return;
  }
  e.preventDefault();

  if (isTouchDevice.value) {
    touchDownAt = Date.now();
    // 第一次点按开始录音；录音中再点一次 = 结束并发送
    if (voiceStatus.value === "listening") {
      void voiceFinish(false);
      return;
    }
    if (voiceStatus.value === "idle") void voiceStart();
    return;
  }

  // 鼠标/触控笔：按住说话
  if (voiceStatus.value !== "idle") return;
  pressY = e.clientY;
  try {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  } catch {
    /* ignore */
  }
  void voiceStart();
}

function voiceMove(e: PointerEvent) {
  if (isTouchDevice.value) return;
  if (voiceStatus.value !== "listening") return;
  voiceSlide(pressY - e.clientY);
}

function voiceUp() {
  if (isTouchDevice.value) {
    // 按住超过 0.7s 再抬手 = 微信式「按住说话」，抬手即发送；
    // 快速点按则继续录音，等用户再点一次或用「发送」按钮
    if (voiceStatus.value === "listening" && Date.now() - touchDownAt > 700) {
      void voiceFinish(false);
    }
    return;
  }
  if (voiceStatus.value !== "listening") return;
  void voiceFinish(voiceCancelArmed.value);
}

/** 按钮 title：手机是点按，桌面是按住 */
const voiceButtonTitle = computed(() => {
  if (!voiceAvailable.value) return "语音输入（当前浏览器不支持，点击查看方案）";
  const how = isTouchDevice.value ? "点按说话" : "按住说话";
  const via = voiceMode.value === "whisper" ? "AI 转写" : "浏览器识别";
  return `${how}（${via}）`;
});

/** 触摸端提示文案：不再是「松开发送」 */
const voiceHintText = computed(() => {
  if (isTouchDevice.value && voiceStatus.value === "listening") return "说完点发送";
  return voiceHint.value;
});

// 面板高度（可拖拽调整），默认 480px
const panelHeight = ref(480);
const resizing = ref(false);
const resizeStart = ref({ y: 0, h: 0 });

const progress = computed(() => levelProgress(store.companion.affection));
const level = computed(() => levelFromAffection(store.companion.affection));
const days = computed(() => daysSince(store.companion.firstMetAt));
const form = computed(() => formFromAffection(store.companion.affection));
const formName = computed(() => FORM_NAMES[form.value]);

// ---------- 拖动 ----------
// 悬浮按钮位置（右下角），单位 px；用 bottom/right 表达
const pos = ref({ bottom: 20, right: 20 });
/** 移动端底部导航高度：悬浮球需上移，避免遮挡 Tab */
const navOffset = ref(0);

function syncNavOffset() {
  navOffset.value = typeof window !== "undefined" && window.innerWidth < 1024 ? 60 : 0;
}
const dragging = ref(false);
// 拖动起点（用于判断是否真的移动了）
const startPos = ref({ x: 0, y: 0 });
// 拖动时鼠标相对按钮左上角的偏移
const dragOffset = ref({ x: 0, y: 0 });
// 本次按下是否发生了拖动（在 pointerup 时立即置位，供随后触发的 click 判断）
const suppressClick = ref(false);

function startDrag(e: PointerEvent) {
  if (open.value) return; // 面板打开时不拖动
  dragging.value = true;
  suppressClick.value = false;
  startPos.value = { x: e.clientX, y: e.clientY };
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  dragOffset.value = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top
  };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onDrag(e: PointerEvent) {
  if (!dragging.value) return;
  // 移动超过 4px 判定为拖动
  const dx = e.clientX - startPos.value.x;
  const dy = e.clientY - startPos.value.y;
  if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
    suppressClick.value = true;
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const size = 64; // 按钮宽高
  let right = vw - (e.clientX - dragOffset.value.x) - size;
  let bottom = vh - (e.clientY - dragOffset.value.y) - size;
  // 限制在可视区域内
  right = Math.max(8, Math.min(right, vw - size - 8));
  bottom = Math.max(8, Math.min(bottom, vh - size - 8));
  pos.value = { right, bottom };
}

function endDrag() {
  dragging.value = false;
}

function onButtonClick() {
  // 发生过拖动则不触发展开（suppressClick 在 pointerup 时已置位）
  if (suppressClick.value) {
    suppressClick.value = false;
    return;
  }
  toggleOpen();
}

function toggleOpen() {
  open.value = !open.value;
  if (open.value) {
    scrollBottom();
    maybeHintUnsupportedBrowser();
  }
}

/**
 * 首次在第三方浏览器（百度/微信/QQ 等）打开面板时，主动提示换系统浏览器。
 * 只提示一次，避免打扰。
 */
function maybeHintUnsupportedBrowser() {
  if (IS_MINITOOL || voiceAvailable.value) return;
  const inApp = detectInAppBrowser();
  if (!inApp) return;
  try {
    if (localStorage.getItem("knowflow.voice.hintShown")) return;
    localStorage.setItem("knowflow.voice.hintShown", "1");
  } catch {
    /* ignore */
  }
  showVoiceTip(`${inApp.name}里没有可用的网页语音识别：${inApp.tip}`, ["copy", "settings"]);
}

onMounted(() => {
  syncNavOffset();
  window.addEventListener("resize", syncNavOffset);
  window.addEventListener("resize", clampPos);
  // 触摸设备（手机/平板）用点按式录音，鼠标端保留按住说话
  try {
    isTouchDevice.value =
      window.matchMedia?.("(hover: none) and (pointer: coarse)")?.matches ||
      (navigator.maxTouchPoints > 0 && !window.matchMedia?.("(hover: hover)")?.matches);
  } catch {
    isTouchDevice.value = false;
  }
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", clampPos);
});
function clampPos() {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  pos.value.right = Math.max(8, Math.min(pos.value.right, vw - 64 - 8));
  pos.value.bottom = Math.max(8, Math.min(pos.value.bottom, vh - 64 - 8));
}

// ---------- 面板高度拖拽调整 ----------
function startResize(e: PointerEvent) {
  resizing.value = true;
  resizeStart.value = { y: e.clientY, h: panelHeight.value };
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}

function onResize(e: PointerEvent) {
  if (!resizing.value) return;
  // 向上拖动 = 拉高；向下拖动 = 压低
  const delta = resizeStart.value.y - e.clientY;
  const h = resizeStart.value.h + delta;
  // 限制范围：最小 240，最大不超出视口可用高度
  const maxH = window.innerHeight - 120;
  panelHeight.value = Math.max(240, Math.min(h, maxH));
}

function endResize() {
  resizing.value = false;
}

function pickAvatar() {
  avatarInput.value?.click();
}

async function onAvatarChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    store.showBubble("图片太大了，请选 2MB 以内的图片哦");
    input.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    store.setAvatar(reader.result as string);
    store.showBubble("新头像真好看！以后我就是这个样子啦～");
  };
  reader.readAsDataURL(file);
  input.value = "";
}

function send() {
  const t = input.value.trim();
  if (!t) return;
  store.sendMessage(t);
  input.value = "";
  scrollBottom();
}

function scrollBottom() {
  nextTick(() => {
    listRef.value?.scrollTo({ top: listRef.value.scrollHeight, behavior: "smooth" });
  });
}

/**
 * 机器人回复是异步落进消息列表的（工具调用还要查库），
 * 发送时那次 scrollBottom 早就滚完了，回复会留在视口外。
 * 这里盯住消息条数，新消息一到就滚到底。
 */
watch(
  () => store.messages.length,
  () => {
    if (open.value) scrollBottom();
  }
);
</script>

<template>
  <!-- 悬浮按钮（可拖动），容器只锚定按钮，面板/气泡独立定位不挤占按钮 -->
  <div
    v-if="store.enabled"
    class="fixed z-40"
    :style="{ right: pos.right + 'px', bottom: pos.bottom + navOffset + 'px' }"
    :class="dragging ? 'cursor-grabbing select-none' : ''"
  >
    <!-- 鼓励气泡（绝对定位，不挤占按钮） -->
    <transition name="bubble">
      <div
        v-if="store.bubble.visible && !open"
        class="pointer-events-none absolute bottom-[72px] right-0 max-w-[260px] rounded-2xl rounded-br-sm bg-brand-600 px-4 py-3 text-sm text-white shadow-lg"
      >
        {{ store.bubble.text }}
      </div>
    </transition>

    <!-- 机器人按钮 -->
    <button
      class="companion-float relative flex h-16 w-16 touch-none select-none items-center justify-center rounded-full bg-white shadow-lg ring-2 ring-brand-100 transition hover:scale-105 hover:shadow-xl"
      @pointerdown="startDrag"
      @pointermove="onDrag"
      @pointerup="endDrag"
      @pointercancel="endDrag"
      @click="onButtonClick"
    >
      <CompanionAvatar :size="52" :level="level" :form="form" :avatar-url="store.companion.avatarUrl" />
      <span
        v-if="open"
        class="absolute -right-0.5 -top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-slate-700 text-white"
      >
        <X :size="12" />
      </span>
    </button>

    <!-- 对话面板（绝对定位，向上展开且不把按钮顶上去） -->
    <transition name="panel">
      <div
        v-if="open"
        class="absolute bottom-[72px] right-0 flex w-[340px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-2xl"
        :style="{ height: panelHeight + 'px' }"
      >
        <!-- 顶部拖拽调整高度条 -->
        <div
          class="flex h-2 shrink-0 touch-none cursor-row-resize items-center justify-center border-b border-slate-100 bg-slate-50 hover:bg-slate-100"
          @pointerdown="startResize"
          @pointermove="onResize"
          @pointerup="endResize"
          @pointercancel="endResize"
        >
          <div class="h-1 w-8 rounded-full bg-slate-300"></div>
        </div>

        <!-- 头部 -->
        <div class="flex items-center gap-3 border-b border-slate-100 bg-gradient-to-r from-brand-600 to-brand-500 px-4 py-3 text-white">
          <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white shadow-sm">
            <CompanionAvatar :size="40" :level="level" :form="form" :avatar-url="store.companion.avatarUrl" />
          </div>
          <div class="flex-1">
            <div class="flex items-center gap-2 text-sm font-semibold">
              {{ store.companion.name }}
              <span class="rounded-full bg-white/20 px-2 py-0.5 text-xs font-normal">
                {{ levelTitle(level) }} Lv.{{ level + 1 }}
              </span>
            </div>
            <div class="text-xs text-white/80">
              陪伴 {{ days }} 天 · {{ formName }}
            </div>
          </div>
          <button class="text-white/80 hover:text-white" @click="pickAvatar" title="更换头像">
            <ImagePlus :size="18" />
          </button>
          <button class="text-white/80 hover:text-white" @click="store.toggle" title="关闭机器人">
            <Power :size="18" />
          </button>
          <input ref="avatarInput" type="file" accept="image/*" class="hidden" @change="onAvatarChange" />
        </div>

        <!-- 好感度进度 -->
        <div class="border-b border-slate-100 px-4 py-2">
          <div class="mb-1 flex items-center justify-between text-xs text-slate-400">
            <span class="flex items-center gap-1"><Heart :size="12" class="text-pink-500" /> 好感度 {{ store.companion.affection }}</span>
            <span>
              形态：{{ formName }}（{{ form === 1 ? `到 ${FORM_UPGRADE_THRESHOLD} 进化` : form === 2 ? `到 ${FORM_UPGRADE_THRESHOLD_3} 蜕变` : "已最终形态" }}）
            </span>
          </div>
          <div class="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div class="h-full rounded-full bg-gradient-to-r from-pink-400 to-brand-500 transition-all" :style="{ width: progress.percent + '%' }"></div>
          </div>
        </div>

        <!-- 消息列表 -->
        <div ref="listRef" class="flex-1 space-y-3 overflow-y-auto bg-slate-50 p-4">
          <div
            v-for="(m, i) in store.messages"
            :key="i"
            class="flex"
            :class="m.role === 'user' ? 'justify-end' : 'justify-start'"
          >
            <div
              class="max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm"
              :class="m.role === 'user' ? 'rounded-br-sm bg-brand-600 text-white' : 'rounded-bl-sm bg-white text-slate-700 shadow-sm'"
            >
              {{ m.text }}
            </div>
          </div>
        </div>

        <!-- 快捷提问 -->
        <div class="flex gap-2 overflow-x-auto border-t border-slate-100 bg-white px-3 py-2">
          <button
            v-for="q in ['软件的作用是什么', '资料库有哪些资料', '把最新的资料做成卡片', '我本地存了多少数据', '把小游戏成绩清掉']"
            :key="q"
            class="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 hover:bg-brand-50 hover:text-brand-600"
            @click="store.sendMessage(q); scrollBottom()"
          >
            {{ q }}
          </button>
        </div>

        <!-- 语音提示（如权限被拒、没听清、浏览器不支持） -->
        <transition name="bubble">
          <div
            v-if="voiceTip"
            class="flex items-start gap-2 border-t border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-700"
          >
            <span class="flex-1">{{ voiceTip }}</span>
            <button
              v-if="voiceTipActions.includes('copy')"
              class="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] text-amber-700 ring-1 ring-amber-300"
              @click="copyLink"
            >
              复制链接
            </button>
            <button
              v-if="voiceTipActions.includes('settings')"
              class="shrink-0 rounded-full bg-amber-600 px-2 py-0.5 text-[11px] text-white"
              @click="goSettings"
            >
              去设置
            </button>
          </div>
        </transition>

        <!-- 输入区 -->
        <div class="flex items-center gap-2 border-t border-slate-100 bg-white p-3">
          <!-- 语音按钮：按住说话（微信式）。不支持时仍显示，点击给出引导 -->
          <button
            v-if="voiceVisible"
            class="relative flex h-9 w-9 shrink-0 touch-none select-none items-center justify-center rounded-full border transition"
            :class="
              voiceStatus === 'listening'
                ? 'border-rose-300 bg-rose-500 text-white'
                : voiceAvailable
                  ? 'border-slate-200 bg-white text-slate-500 hover:border-brand-300 hover:text-brand-600'
                  : 'border-slate-200 bg-slate-50 text-slate-300'
            "
            :title="voiceButtonTitle"
            :aria-label="voiceButtonTitle"
            @pointerdown="voiceDown"
            @pointermove="voiceMove"
            @pointerup="voiceUp"
            @pointercancel="voiceUp"
            @touchstart.prevent
            @selectstart.prevent
            @contextmenu.prevent
          >
            <Mic :size="17" />
            <span
              v-if="voiceStatus === 'listening'"
              class="pointer-events-none absolute inset-0 animate-ping rounded-full bg-rose-400/40"
            ></span>
          </button>

          <!-- 录音中：波形 + 计时 + 提示 -->
          <div
            v-if="voiceStatus !== 'idle'"
            class="flex h-9 flex-1 items-center gap-2 overflow-hidden rounded-full px-3 text-xs"
            :class="voiceCancelArmed ? 'bg-slate-100 text-slate-500' : 'bg-rose-50 text-rose-600'"
          >
            <span
              class="h-1.5 w-1.5 shrink-0 rounded-full"
              :class="voiceStatus === 'transcribing' ? 'bg-slate-400' : 'animate-pulse bg-rose-500'"
            ></span>
            <div v-if="voiceStatus === 'listening'" class="flex h-4 shrink-0 items-end gap-[2px]">
              <span v-for="i in 5" :key="i" class="voice-bar" :style="{ animationDelay: i * 0.11 + 's' }"></span>
            </div>
            <span v-if="voiceStatus === 'listening'" class="shrink-0 tabular-nums">
              {{ voiceSeconds.toFixed(0) }}s
            </span>
            <span class="min-w-0 flex-1 truncate">{{ voiceHintText }}</span>
            <template v-if="isTouchDevice && voiceStatus === 'listening'">
              <button
                class="shrink-0 rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-500 ring-1 ring-slate-200"
                @click.stop="voiceFinish(true)"
              >
                取消
              </button>
              <button
                class="shrink-0 rounded-full bg-rose-500 px-2 py-0.5 text-[11px] text-white"
                @click.stop="voiceFinish(false)"
              >
                发送
              </button>
            </template>
          </div>

          <input
            v-show="voiceStatus === 'idle'"
            v-model="input"
            type="text"
            class="input-base flex-1"
            placeholder="问问我吧…"
            @keyup.enter="send"
          />
          <button v-show="voiceStatus === 'idle'" class="btn-primary !px-3 !py-2" @click="send">发送</button>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.bubble-enter-active,
.bubble-leave-active {
  transition: all 0.2s ease;
}
.bubble-enter-from,
.bubble-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
.panel-enter-active,
.panel-leave-active {
  transition: all 0.2s ease;
}
.panel-enter-from,
.panel-leave-to {
  opacity: 0;
  transform: translateY(16px) scale(0.96);
}

/* 悬浮球：触摸拖拽时禁止页面滚动与长按菜单/图片拖拽，否则移动端会误判为滚动并触发 pointercancel */
.companion-float {
  touch-action: none;
  -webkit-touch-callout: none;
  -webkit-user-drag: none;
  user-select: none;
  cursor: grab;
}

/* 录音波形条 */
.voice-bar {
  width: 2px;
  height: 100%;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.75;
  transform-origin: bottom;
  animation: voiceWave 0.9s ease-in-out infinite;
}
@keyframes voiceWave {
  0%,
  100% {
    transform: scaleY(0.3);
  }
  50% {
    transform: scaleY(1);
  }
}
</style>
