import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { runMigrations } from "./db/migrations";
import { IS_MINITOOL } from "./utils/runtime";
import "./assets/main.css";

const app = createApp(App);

app.use(createPinia());
app.use(router);

/**
 * 全局兜底：组件树之外的异常不再直接黑屏。
 * 画面级错误由 ErrorBoundary 接管，这里只负责记录与提示。
 */
app.config.errorHandler = (err, _instance, info) => {
  console.error("[KnowFlow] 未捕获的组件错误：", err, info);
};

window.addEventListener("unhandledrejection", (event) => {
  console.error("[KnowFlow] 未处理的 Promise 异常：", event.reason);
});

runMigrations().then(() => {
  app.mount("#app");
});

// PWA：仅网页生产构建注册（小工具容器禁用 Service Worker）
if (!IS_MINITOOL && import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker.register(swUrl).catch((e) => {
      console.warn("[KnowFlow] Service Worker 注册失败：", e);
    });
  });
}
