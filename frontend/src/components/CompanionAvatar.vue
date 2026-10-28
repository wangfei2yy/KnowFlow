<script setup lang="ts">
// 机器人「小知」头像，三种形态随好感度自动升级：
//   形态一（默认）：静态圆润机器人
//   形态二（好感度 >= 30）：带四肢、会动的成长形态
//   形态三（好感度 >= 60）：有立体感（透视 + 光影 + 悬浮）的蜕变形态
import { computed } from "vue";
import type { CompanionForm } from "@/services/companion/types";

const props = withDefaults(
  defineProps<{ size?: number; level?: number; avatarUrl?: string; form?: CompanionForm }>(),
  {
    size: 48,
    level: 0,
    avatarUrl: "",
    form: 1
  }
);

// 表情随等级变化（0-6 级）
const face = computed(() => {
  const l = props.level;
  if (l >= 4) {
    return {
      eyes: "M15 17c1.5 0 2.5-1.5 3-3M33 17c-1.5 0-2.5-1.5-3-3",
      mouth: "M20 27c2.5 2.5 5.5 2.5 8 0",
      blush: true
    };
  }
  if (l >= 2) {
    return {
      eyes: "M17 19h2M29 19h2",
      mouth: "M21 27c2 1.5 4 1.5 6 0",
      blush: true
    };
  }
  return {
    eyes: "M18 18.5h3M27 18.5h3",
    mouth: "M22 27h4",
    blush: false
  };
});
</script>

<template>
  <!-- 自定义图片优先 -->
  <div
    v-if="avatarUrl"
    class="overflow-hidden rounded-full"
    :style="{ width: size + 'px', height: size + 'px' }"
  >
    <img :src="avatarUrl" alt="小知头像" class="h-full w-full object-cover" />
  </div>

  <!-- 形态三：三维立体（悬浮 + 透视光影） -->
  <div v-else-if="form === 3" class="companion-3d" :style="{ width: size + 'px', height: size + 'px' }">
    <svg :width="size" :height="size" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="c3d-body" x1="6" y1="10" x2="42" y2="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#8aa8ff" />
          <stop offset="0.5" stop-color="#4d7bff" />
          <stop offset="1" stop-color="#2b4fc0" />
        </linearGradient>
        <radialGradient id="c3d-face" cx="0.4" cy="0.35" r="0.8">
          <stop offset="0" stop-color="#ffffff" />
          <stop offset="1" stop-color="#dbe4ff" />
        </radialGradient>
      </defs>
      <!-- 阴影（立体悬浮感） -->
      <ellipse cx="24" cy="45" rx="15" ry="2.6" fill="#2b3a67" opacity="0.22" />
      <!-- 悬浮身体，带透视的胶囊 -->
      <g class="float-3d">
        <path d="M9 18c0-6 3.5-10 15-10s15 4 15 10v9c0 8-3.5 12-15 12S9 35 9 27z" fill="url(#c3d-body)" />
        <path d="M12 14c0-5 2.8-8 12-8s12 3 12 8v6c0 5-2.8 8-12 8s-12-3-12-8z" fill="#ffffff" opacity="0.14" />
        <line x1="24" y1="5" x2="24" y2="10" stroke="#4d7bff" stroke-width="2.5" stroke-linecap="round" />
        <circle cx="24" cy="3.5" r="3" fill="#ffd166" />
        <circle cx="24" cy="3.5" r="3" fill="#fff7d6" opacity="0.5" />
        <rect x="2" y="19" width="5.5" height="11" rx="2.8" fill="#2b4fc0" />
        <rect x="2" y="19" width="2" height="11" rx="1" fill="#8aa8ff" opacity="0.5" />
        <rect x="40.5" y="19" width="5.5" height="11" rx="2.8" fill="#2b4fc0" />
        <rect x="12" y="15" width="24" height="18" rx="7" fill="url(#c3d-face)" />
        <rect x="12" y="15" width="24" height="18" rx="7" stroke="#3b5bbf" stroke-width="0.8" opacity="0.3" />
        <path :d="face.eyes" stroke="#2b3a67" stroke-width="2.4" stroke-linecap="round" />
        <circle v-if="face.blush" cx="14.5" cy="25" r="2.2" fill="#ff8fab" fill-opacity="0.7" />
        <circle v-if="face.blush" cx="33.5" cy="25" r="2.2" fill="#ff8fab" fill-opacity="0.7" />
        <path :d="face.mouth" stroke="#2b3a67" stroke-width="2.2" stroke-linecap="round" fill="none" />
        <circle cx="24" cy="40" r="1.5" fill="#aef5c7" />
      </g>
    </svg>
  </div>

  <!-- 形态二：带四肢、会动 -->
  <div v-else-if="form === 2" class="companion-2d" :style="{ width: size + 'px', height: size + 'px' }">
    <svg :width="size" :height="size" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="c2-body" x1="0" y1="0" x2="56" y2="56" gradientUnits="userSpaceOnUse">
          <stop stop-color="#6d8dff" />
          <stop offset="1" stop-color="#3b6ef6" />
        </linearGradient>
      </defs>
      <g class="arm-left">
        <rect x="3" y="24" width="10" height="4" rx="2" fill="#3b6ef6" />
        <circle cx="4" cy="26" r="2.4" fill="#ffd166" />
      </g>
      <g class="arm-right">
        <rect x="43" y="24" width="10" height="4" rx="2" fill="#3b6ef6" />
        <circle cx="52" cy="26" r="2.4" fill="#ffd166" />
      </g>
      <rect x="12" y="12" width="32" height="30" rx="12" fill="url(#c2-body)" />
      <line x1="28" y1="4" x2="28" y2="11" stroke="#3b6ef6" stroke-width="2.5" stroke-linecap="round" />
      <circle cx="28" cy="3" r="3" fill="#ffd166" />
      <rect x="8" y="19" width="5" height="10" rx="2.5" fill="#3b6ef6" />
      <rect x="43" y="19" width="5" height="10" rx="2.5" fill="#3b6ef6" />
      <rect x="17" y="16" width="22" height="16" rx="6" fill="white" fill-opacity="0.95" />
      <path :d="face.eyes" stroke="#2b3a67" stroke-width="2.3" stroke-linecap="round" />
      <circle v-if="face.blush" cx="19.5" cy="25" r="2" fill="#ff8fab" fill-opacity="0.7" />
      <circle v-if="face.blush" cx="36.5" cy="25" r="2" fill="#ff8fab" fill-opacity="0.7" />
      <path :d="face.mouth" stroke="#2b3a67" stroke-width="2.1" stroke-linecap="round" fill="none" />
      <g class="leg-left">
        <rect x="21" y="42" width="6" height="8" rx="3" fill="#3b6ef6" />
      </g>
      <g class="leg-right">
        <rect x="29" y="42" width="6" height="8" rx="3" fill="#3b6ef6" />
      </g>
    </svg>
  </div>

  <!-- 形态一：静态（默认） -->
  <svg
    v-else
    :width="size"
    :height="size"
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    <defs>
      <linearGradient id="c1-body" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
        <stop stop-color="#6d8dff" />
        <stop offset="1" stop-color="#3b6ef6" />
      </linearGradient>
    </defs>
    <line x1="24" y1="6" x2="24" y2="12" stroke="#3b6ef6" stroke-width="2.5" stroke-linecap="round" />
    <circle cx="24" cy="5" r="3" fill="#ffd166" />
    <rect x="6" y="12" width="36" height="31" rx="11" fill="url(#c1-body)" />
    <rect x="2.5" y="20" width="5" height="10" rx="2.5" fill="#3b6ef6" />
    <rect x="40.5" y="20" width="5" height="10" rx="2.5" fill="#3b6ef6" />
    <rect x="12" y="17" width="24" height="17" rx="6" fill="white" fill-opacity="0.95" />
    <path :d="face.eyes" stroke="#2b3a67" stroke-width="2.4" stroke-linecap="round" />
    <circle v-if="face.blush" cx="14.5" cy="26.5" r="2.2" fill="#ff8fab" fill-opacity="0.7" />
    <circle v-if="face.blush" cx="33.5" cy="26.5" r="2.2" fill="#ff8fab" fill-opacity="0.7" />
    <path :d="face.mouth" stroke="#2b3a67" stroke-width="2.2" stroke-linecap="round" fill="none" />
    <circle cx="24" cy="40" r="1.5" fill="#aef5c7" />
  </svg>
</template>

<style scoped>
.companion-2d .arm-left {
  transform-origin: 6px 26px;
  animation: arm-wave 1.6s ease-in-out infinite;
}
.companion-2d .arm-right {
  transform-origin: 50px 26px;
  animation: arm-wave 1.6s ease-in-out infinite 0.8s;
}
.companion-2d .leg-left {
  animation: leg-step 0.8s ease-in-out infinite;
}
.companion-2d .leg-right {
  animation: leg-step 0.8s ease-in-out infinite 0.4s;
}
@keyframes arm-wave {
  0%, 100% { transform: rotate(0deg); }
  50% { transform: rotate(-18deg); }
}
@keyframes leg-step {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-2.5px); }
}

.companion-3d .float-3d {
  transform-origin: 24px 24px;
  animation: float3d 2.4s ease-in-out infinite;
}
@keyframes float3d {
  0%, 100% { transform: translateY(0) rotate(-1deg); }
  50% { transform: translateY(-3px) rotate(1deg); }
}
</style>
