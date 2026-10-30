/**
 * 手动「立即更新」：把离线缓存清干净再重载。
 *
 * 为什么需要它：Service Worker 把应用壳缓存下来之后，个别浏览器（尤其是手机自带浏览器）
 * 会长时间不给新版本。用户看到的就是「改了的东西没生效」「已经修掉的 bug 又出现了」。
 * 自动更新已经在 sw.js / main.ts 里处理，这里留一个手动兜底，报障时点一下即可。
 */
export async function forceUpdate(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    }
  } catch {
    /* 忽略：没有 SW 也不影响接下来清缓存 */
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    }
  } catch {
    /* 忽略 */
  }
  // 加一个查询参数，绕开浏览器对 HTML 的强缓存
  const url = new URL(window.location.href);
  url.searchParams.set("_v", String(Date.now()));
  window.location.replace(url.toString());
}

/**
 * 版本自检：页面加载后向服务器要一下 version.json（不走缓存），
 * 和编译进 JS 的 buildId 比一比。
 *
 * 为什么需要：Service Worker 把旧 HTML 顶住时，JS 里嵌的也是旧 buildId，
 * 靠页面自身完全无法察觉 —— 但 version.json 是网络请求，能立刻暴露差异。
 * 一旦发现不一致就自动清缓存重载一次；同一个新版本只触发一次，避免死循环。
 */
export async function checkFreshness(buildId: string): Promise<void> {
  try {
    const res = await fetch(`./version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { buildId?: string };
    if (!data?.buildId || data.buildId === buildId) return;

    // 已经为这个新版本刷过一次就不再刷（防止服务端只更新了一半时反复重载）
    const key = "knowflow.version.seen";
    if (sessionStorage.getItem(key) === data.buildId) return;
    sessionStorage.setItem(key, data.buildId);
    console.info("[KnowFlow] 检测到新版本，正在更新：", buildId, "→", data.buildId);
    await forceUpdate();
  } catch {
    /* 离线或 version.json 不存在（小工具包）都忽略 */
  }
}
