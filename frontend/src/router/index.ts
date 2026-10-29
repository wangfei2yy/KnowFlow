import { createRouter, createWebHashHistory } from "vue-router";

const routes = [
  { path: "/", name: "home", component: () => import("@/pages/HomePage.vue"), meta: { title: "首页" } },
  { path: "/library", name: "library", component: () => import("@/pages/LibraryPage.vue"), meta: { title: "资料库" } },
  { path: "/library/:id", name: "detail", component: () => import("@/pages/DocumentDetailPage.vue"), meta: { title: "资料详情" } },
  { path: "/editor", name: "editor", component: () => import("@/pages/EditorPage.vue"), meta: { title: "新增资料" } },
  { path: "/editor/:id", name: "editor-edit", component: () => import("@/pages/EditorPage.vue"), meta: { title: "编辑资料" } },
  { path: "/assistant", name: "assistant", component: () => import("@/pages/AssistantPage.vue"), meta: { title: "AI 工作台" } },
  { path: "/tasks", name: "tasks", component: () => import("@/pages/TasksPage.vue"), meta: { title: "任务清单" } },
  { path: "/study", name: "study", component: () => import("@/pages/StudyPage.vue"), meta: { title: "学习中心" } },
  { path: "/import", name: "import", component: () => import("@/pages/ImportPage.vue"), meta: { title: "文件导入" } },
  { path: "/settings", name: "settings", component: () => import("@/pages/SettingsPage.vue"), meta: { title: "设置" } }
];

export const router = createRouter({
  // 使用 hash 路由，静态托管刷新不 404，便于发布到任意子路径
  history: createWebHashHistory(),
  routes
});

/**
 * 弱网下懒加载 chunk 失败时，旧代码会停在空白页。
 * 这里自动重载一次（用 sessionStorage 防死循环），仍失败则提示。
 */
router.onError((error) => {
  const message = String(error?.message ?? error);
  const isChunkError = /Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(message);
  if (!isChunkError) return;
  const KEY = "knowflow.chunkRetry";
  if (sessionStorage.getItem(KEY)) {
    sessionStorage.removeItem(KEY);
    console.error("[KnowFlow] 页面资源加载失败：", message);
    return;
  }
  sessionStorage.setItem(KEY, "1");
  location.reload();
});
