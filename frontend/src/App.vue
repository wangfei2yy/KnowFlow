<script setup lang="ts">
import { onMounted } from "vue";
import AppSidebar from "@/components/AppSidebar.vue";
import Toast from "@/components/Toast.vue";
import CompanionWidget from "@/components/CompanionWidget.vue";
import GlobalSearch from "@/components/GlobalSearch.vue";
import BottomNav from "@/components/BottomNav.vue";
import ErrorBoundary from "@/components/ErrorBoundary.vue";
import { useDocumentStore } from "@/stores/documentStore";
import { useAppStore } from "@/stores/appStore";
import { Menu, Search } from "lucide-vue-next";

const docStore = useDocumentStore();
const appStore = useAppStore();

/** 品牌图标（public/icons 下，随 base 走，兼容子路径部署） */
const logoSrc = `${import.meta.env.BASE_URL}icons/icon-192.png`;

onMounted(() => {
  docStore.loadAll();
  appStore.initTheme();
});

/** 移动端顶栏搜索按钮：转交给 GlobalSearch 处理 */
function openSearch() {
  window.dispatchEvent(new CustomEvent("knowflow:open-search"));
}
</script>

<template>
  <div class="flex min-h-screen">
    <a href="#main" class="skip-link">跳到主要内容</a>
    <AppSidebar />

    <div class="flex min-w-0 flex-1 flex-col lg:pl-64">
      <!-- 移动端顶栏 -->
      <header class="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-100 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
        <button class="text-slate-500" @click="appStore.sidebarOpen = true">
          <Menu :size="22" />
        </button>
        <img :src="logoSrc" alt="知间 AI" class="h-7 w-7 rounded-lg object-cover ring-1 ring-slate-100" />
        <span class="font-semibold text-slate-900">知间 AI</span>
        <button
          class="ml-auto text-slate-500"
          aria-label="搜索"
          @click="openSearch"
        >
          <Search :size="20" />
        </button>
      </header>

      <main id="main" class="flex-1 pb-16 lg:pb-0">
        <ErrorBoundary>
          <router-view />
        </ErrorBoundary>
      </main>
    </div>

    <!-- 全局 Toast -->
    <div class="fixed right-4 top-4 z-50 flex flex-col gap-2">
      <Toast />
    </div>

    <!-- 移动端底部导航 -->
    <BottomNav />

    <!-- 全局搜索（⌘K / Ctrl+K） -->
    <GlobalSearch />

    <!-- 陪伴机器人 -->
    <CompanionWidget />
  </div>
</template>
