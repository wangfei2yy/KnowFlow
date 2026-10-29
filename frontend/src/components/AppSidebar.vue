<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useDocumentStore } from "@/stores/documentStore";
import { useAppStore } from "@/stores/appStore";
import { useReviewStore } from "@/stores/reviewStore";
import { IS_MINITOOL } from "@/utils/runtime";
import {
  Home,
  Library,
  Sparkles,
  CheckSquare,
  GraduationCap,
  Gamepad2,
  BookOpen,
  ChefHat,
  Upload,
  Settings,
  X,
  HardDrive,
  Sun,
  Moon,
  ChevronDown
} from "lucide-vue-next";

const route = useRoute();
const docStore = useDocumentStore();
const appStore = useAppStore();
const reviewStore = useReviewStore();

// 待复习数量：首屏加载一次，标记掌握后在 StudyPage 内刷新
onMounted(() => {
  void reviewStore.refresh();
});

/** 品牌图标（public/icons 下，随 base 走，兼容子路径部署） */
const logoSrc = `${import.meta.env.BASE_URL}icons/icon-192.png`;

interface NavChild {
  path: string;
  label: string;
}

interface NavItem {
  path: string;
  label: string;
  icon: unknown;
  /** 只有学习中心带二级列表 */
  children?: NavChild[];
  /** 需要展示待复习角标 */
  badge?: "review";
}

const navItems: NavItem[] = [
  { path: "/", label: "首页", icon: Home },
  { path: "/library", label: "资料库", icon: Library },
  { path: "/assistant", label: "AI 工作台", icon: Sparkles },
  { path: "/tasks", label: "任务清单", icon: CheckSquare },
  {
    path: "/study",
    label: "学习中心",
    icon: GraduationCap,
    badge: "review",
    children: [
      { path: "/study/cards", label: "卡片复习" },
      // 端内无网络，知识包加载不了，这几个子项只在网页版出现
      ...(IS_MINITOOL
        ? []
        : [
            { path: "/study/grammar", label: "语法学习" },
            { path: "/study/idiom", label: "成语学习" },
            { path: "/study/words", label: "单词学习" },
            { path: "/study/play", label: "快乐学习" }
          ])
    ]
  },
  // 端内无网络，食谱/时令加载不了
  ...(IS_MINITOOL ? [] : [{ path: "/kitchen", label: "饮食", icon: ChefHat }]),
  { path: "/import", label: "文件导入", icon: Upload },
  { path: "/settings", label: "设置", icon: Settings }
];

/** 进入学习模块时自动展开二级列表 */
const studyOpen = ref(false);
watch(
  () => route.path,
  (p) => {
    if (p.startsWith("/study")) studyOpen.value = true;
  },
  { immediate: true }
);

function toggleStudy() {
  studyOpen.value = !studyOpen.value;
}

function isActive(path: string): boolean {
  if (path === "/") return route.path === "/";
  return route.path.startsWith(path);
}

function onNavigate() {
  appStore.sidebarOpen = false;
}
</script>

<template>
  <!-- 移动端遮罩 -->
  <div
    v-if="appStore.sidebarOpen"
    class="fixed inset-0 z-30 bg-black/30 lg:hidden"
    @click="appStore.sidebarOpen = false"
  ></div>

  <aside
    class="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-100 bg-white transition-transform lg:translate-x-0"
    :class="appStore.sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
  >
    <!-- Logo -->
    <div class="flex items-center gap-3 px-5 py-5">
      <img
        :src="logoSrc"
        alt="知间 AI"
        class="h-9 w-9 shrink-0 rounded-[10px] object-cover shadow-sm ring-1 ring-slate-100"
      />
      <div class="flex-1">
        <div class="text-base font-semibold text-slate-900">知间 AI</div>
        <div class="text-xs text-slate-400">KnowFlow</div>
      </div>
      <button
        class="text-slate-400 lg:hidden"
        aria-label="关闭侧边栏"
        @click="appStore.sidebarOpen = false"
      >
        <X :size="20" />
      </button>
    </div>

    <!-- 导航 -->
    <nav class="flex-1 space-y-1 overflow-y-auto px-3 py-2">
      <div v-for="item in navItems" :key="item.path">
        <router-link
          :to="item.path"
          class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition"
          :class="isActive(item.path) ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-50'"
          @click="onNavigate"
        >
          <component :is="item.icon" :size="18" />
          <span>{{ item.label }}</span>
          <span
            v-if="item.badge === 'review' && reviewStore.hasPending"
            class="ml-auto rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none"
            :class="isActive(item.path) ? 'bg-brand-100 text-brand-700' : 'bg-red-50 text-red-500'"
            :title="`待复习 ${reviewStore.pending} 张（逾期 ${reviewStore.overdue} 张）`"
          >
            {{ reviewStore.pending > 99 ? "99+" : reviewStore.pending }}
          </span>
          <button
            v-if="item.children?.length"
            class="ml-auto rounded p-0.5 text-slate-400 transition hover:text-slate-600"
            :class="item.badge === 'review' && reviewStore.hasPending ? 'ml-1' : 'ml-auto'"
            :aria-label="studyOpen ? '收起学习子项' : '展开学习子项'"
            :aria-expanded="studyOpen"
            @click.prevent.stop="toggleStudy"
          >
            <ChevronDown :size="14" :class="studyOpen ? 'rotate-180 transition' : 'transition'" />
          </button>
        </router-link>

        <!-- 二级列表 -->
        <transition name="bubble">
          <div
            v-if="item.children?.length && studyOpen"
            class="ml-5 mt-0.5 space-y-0.5 border-l border-slate-100 pl-3"
          >
            <router-link
              v-for="c in item.children"
              :key="c.path"
              :to="c.path"
              class="block rounded-lg px-2 py-1.5 text-[13px] transition"
              :class="
                route.path === c.path
                  ? 'bg-brand-50 font-medium text-brand-700'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              "
              @click="onNavigate"
            >
              {{ c.label }}
            </router-link>
          </div>
        </transition>
      </div>
    </nav>

    <!-- 底部状态 -->
    <div class="border-t border-slate-100 px-4 py-3">
      <button
        class="mb-2 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-500 transition hover:bg-slate-50"
        :aria-label="appStore.isDark ? '切换到浅色模式' : '切换到深色模式'"
        @click="appStore.toggleDark()"
      >
        <component :is="appStore.isDark ? Sun : Moon" :size="15" />
        {{ appStore.isDark ? "浅色模式" : "深色模式" }}
      </button>
      <div class="flex items-center gap-2 text-xs text-slate-400">
        <HardDrive :size="14" />
        <span>本地模式 · 数据保存在浏览器</span>
      </div>
      <div class="mt-1.5 text-xs text-slate-400">
        {{ docStore.totalCount }} 份资料 · {{ docStore.favoriteCount }} 份收藏
      </div>
    </div>
  </aside>
</template>
