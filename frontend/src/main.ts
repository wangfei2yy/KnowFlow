import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { prefetchHotRoutes } from "./router/prefetch";
import { checkFreshness, recoverFromPreloadError } from "./utils/appUpdate";
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

/**
 * 路由 chunk 404（旧 HTML 指向已删除的构建产物）→ 自动清缓存重载。
 * 没有这个兜底，用户点某个模块只会看到一个失败提示，且永远好不了。
 */
window.addEventListener("vite:preloadError", () => {
  void recoverFromPreloadError();
});

/**
 * 挂载应用 —— 立即执行，不等任何东西。
 *
 * 这里踩过一个坑：把 mount 放在 runMigrations().then() 里，一旦迁移（或其依赖的
 * 数据库初始化）在某个浏览器环境卡住或抛错，mount 就永远不执行 —— 用户会一直停在
 * 「正在打开你的资料库」的骨架屏，而换个浏览器又正常，是环境差异触发。
 *
 * 现在 mount 完全不依赖迁移：先渲染，迁移作为后台任务并行跑，成败都记日志。
 * 数据库真正被用到时（各页面读资料）由页面各自兜底。
 */
app.mount("#app");
// 首屏挂载完再预取其它模块的 chunk（内部会等 load + 空闲，不抢首屏带宽）
prefetchHotRoutes();
// 版本自检：如果页面是 Service Worker 缓存下来的旧版本，自动拉新（见 utils/appUpdate）
if (!IS_MINITOOL && import.meta.env.PROD) void checkFreshness(__BUILD_ID__);

// 迁移：后台并行，不阻塞 UI
void runMigrations().catch((e) => {
  console.warn("[KnowFlow] 数据迁移失败：", e);
});

// PWA：仅网页生产构建注册（小工具容器禁用 Service Worker）
if (!IS_MINITOOL && import.meta.env.PROD && "serviceWorker" in navigator) {
  /**
   * 踩过的两个坑，这里一并规避：
   * 1. 之前「缓存优先 + 后台更新」把旧 HTML 顶住，导致改了没生效 —— 已由
   *    sw.js 的壳保鲜期 + version.json 版本自检解决（见 utils/appUpdate.ts）。
   * 2. 后来加的「controllerchange 自动 reload + 每次 load 主动 update()」组合，
   *    在 Edge 上会反复触发 controllerchange 形成 reload 死循环 —— 用户一直停在
   *    骨架屏。所以这里**只做最朴素的注册**：让浏览器按它自己的节奏更新 SW，
   *    版本正确性交给版本自检，绝不靠「主动刷新页面」来强推。
   */
  window.addEventListener("load", () => {
    const swUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker
      .register(swUrl)
      .catch((e) => {
        console.warn("[KnowFlow] Service Worker 注册失败：", e);
      });
  });
}
