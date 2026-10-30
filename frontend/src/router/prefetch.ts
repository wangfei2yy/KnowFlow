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

/** 顺序 = 用户最可能点开的顺序，靠前的更早发出 */
const HOT: Loader[] = [
  () => import("@/pages/LibraryPage.vue"),
  () => import("@/pages/StudyLayout.vue"),
  () => import("@/pages/StudyOverview.vue"),
  () => import("@/pages/TasksPage.vue"),
  () => import("@/pages/SettingsPage.vue"),
  () => import("@/pages/PlayHomePage.vue"),
  () => import("@/pages/AssistantPage.vue")
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

  const run = () => {
    // 每个间隔 120ms 触发：既不会一次打满连接池把带宽从首屏抢走，
    // 又能保证「首屏出来后 1 秒内」常用模块都已就绪（点击时才不会卡）
    HOT.forEach((load, i) => {
      window.setTimeout(() => {
        load().catch(() => undefined);
      }, i * 120);
    });
  };

  const idle = (cb: () => void) => {
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => void })
      .requestIdleCallback;
    if (typeof ric === "function") ric(cb, { timeout: 3000 });
    else window.setTimeout(cb, 1200);
  };

  // 必须等 load：首屏的字体/图标还在抢带宽，此时预取只会让首屏更慢
  if (document.readyState === "complete") idle(run);
  else window.addEventListener("load", () => idle(run), { once: true });
}
