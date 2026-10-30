/**
 * 空闲预取：首页渲染完之后，在浏览器空闲时把「大概率下一步要点」的页面 chunk 先拉下来。
 *
 * 为什么需要它：部署环境单次请求的往返约 0.6s，而路由是懒加载的 ——
 * 点「资料库」要现下载 chunk，实测要 1.7s 才出内容，体感就是「卡住」。
 * 预取之后这一跳基本为零，且完全不影响首屏（等 load + 空闲才跑）。
 *
 * 几个克制的点：
 * - 端内（小工具）是单文件包，没有 chunk，直接跳过；
 * - 省流模式 / 2G 网络不预取，避免和首屏抢带宽；
 * - 全部失败静默，预取只是锦上添花。
 */
import { IS_MINITOOL } from "@/utils/runtime";

type Loader = () => Promise<unknown>;

/**
 * 主级：底部/侧边导航的五个目的地 —— 用户最常点，chunk 不在就「点了没反应」。
 * 这些优先预取，首屏 load 后就开始。
 */
const PRIMARY: Loader[] = [
  () => import("@/pages/LibraryPage.vue"),
  () => import("@/pages/StudyLayout.vue"),
  () => import("@/pages/StudyOverview.vue"),
  () => import("@/pages/TasksPage.vue"),
  () => import("@/pages/SettingsPage.vue"),
  () => import("@/pages/AssistantPage.vue")
];

/** 次级：从导航再往下一层才到，晚一点预取，别和首屏抢带宽 */
const SECONDARY: Loader[] = [
  () => import("@/pages/PlayHomePage.vue"),
  () => import("@/pages/WordPage.vue"),
  () => import("@/pages/IdiomPage.vue")
];

function shouldPrefetch(): boolean {
  if (IS_MINITOOL) return false;
  if (typeof window === "undefined") return false;
  const conn = (navigator as unknown as {
    connection?: { saveData?: boolean; effectiveType?: string };
  }).connection;
  if (conn?.saveData) return false;
  if (conn?.effectiveType && /(^|-)2g$/.test(conn.effectiveType)) return false;
  return true;
}

export function prefetchHotRoutes(): void {
  if (!shouldPrefetch()) return;

  const fire = (list: Loader[], gap: number) => {
    list.forEach((load, i) => {
      window.setTimeout(() => {
        load().catch(() => undefined);
      }, i * gap);
    });
  };

  const run = () => {
    // 主级 80ms 一个：首屏已经 paint 完，尽快把这几个 nav chunk 备好
    fire(PRIMARY, 80);
    // 次级推到 1.5s 之后，避免和首屏/主级抢带宽
    window.setTimeout(() => fire(SECONDARY, 120), 1500);
  };

  const idle = (cb: () => void) => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
      .requestIdleCallback;
    if (typeof ric === "function") ric(cb, { timeout: 3000 });
    else window.setTimeout(cb, 1200);
  };

  /**
   * 等 load 之后再等 300ms：给首屏的图标/字体让路，但别等太久 ——
   * 用户往往首屏一出来就去点导航，chunk 没就绪就会「点了没反应」。
   */
  const schedule = () => window.setTimeout(() => idle(run), 300);
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
}
