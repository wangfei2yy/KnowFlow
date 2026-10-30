import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { prefetchHotRoutes } from "./router/prefetch";
import { checkFreshness } from "./utils/appUpdate";
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
  // 首屏挂载完再预取其它模块的 chunk（内部会等 load + 空闲，不抢首屏带宽）
  prefetchHotRoutes();
  // 版本自检：如果页面是 Service Worker 缓存下来的旧版本，自动拉新（见 utils/appUpdate）
  if (!IS_MINITOOL && import.meta.env.PROD) void checkFreshness(__BUILD_ID__);
});

// PWA：仅网页生产构建注册（小工具容器禁用 Service Worker）
if (!IS_MINITOOL && import.meta.env.PROD && "serviceWorker" in navigator) {
  /**
   * 这次踩的坑：用户手机上一直看到旧版本（黄底回来了、设置页还是老样子），
   * 而清过缓存的百度浏览器正常 —— 是 Service Worker 把旧 HTML 顶住了。
   * 三处一起改：
   * 1. updateViaCache: "none" —— sw.js 的更新检查不走 HTTP 缓存，能第一时间发现新版本；
   * 2. 启动时主动 update() —— 常驻页面（PWA）浏览器不一定自己检查；
   * 3. 新 SW 接管后自动刷新一次，用户不用手动清缓存。
   */
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // 首次安装也会触发 controllerchange（clients.claim），那种情况不该刷页
    if (!hadController || reloaded) return;
    reloaded = true;
    window.location.reload();
  });

  window.addEventListener("load", () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker
      .register(swUrl, { updateViaCache: "none" })
      .then((reg) => reg.update().catch(() => undefined))
      .catch((e) => {
        console.warn("[KnowFlow] Service Worker 注册失败：", e);
      });
  });
}
