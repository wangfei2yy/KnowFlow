/* KnowFlow Service Worker：应用壳 + 静态资源 + 知识包缓存，不碰接口请求。
 *
 * 缓存策略按「第二次打开应该几乎瞬时」设计：
 * - 页面导航：stale-while-revalidate —— 先给缓存（秒开），后台拉新版本下次用
 * - /assets/*（文件名带内容哈希）：cache-first，永久有效
 * - /packs/*.json（词库、食谱、食材）：stale-while-revalidate，先给旧的再更新
 * - 其余接口（/api、AI 调用）：完全不拦截
 */
const CACHE = "knowflow-shell-v2";
const SHELL = ["./", "./index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => undefined)
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** 后台更新缓存，失败静默（离线时不该影响正在返回的旧内容） */
function revalidate(req, cacheKey) {
  return fetch(req)
    .then((res) => {
      // 只缓存成功响应，避免把 404 / 授权失败页缓存下来
      if (res.ok) {
        const copy = res.clone();
        caches
          .open(CACHE)
          .then((cache) => cache.put(cacheKey ?? req, copy))
          .catch(() => undefined);
      }
      return res;
    })
    .catch(() => undefined);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 页面导航：先给缓存，再后台更新
  if (req.mode === "navigate") {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then((hit) => {
        const network = revalidate(req, "./index.html");
        // 有缓存就立即返回，同时把网络结果写回（下次访问即是新版本）
        return hit || network.then((res) => res || caches.match("./index.html")).then((res) => res || Response.error());
      })
    );
    return;
  }

  // 知识包：先给缓存，再后台更新（词库单文件 500 KB+，第二次进入不该再等）
  if (url.pathname.includes("/packs/")) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(
        (hit) =>
          hit ||
          revalidate(req).then((res) => res || Response.error())
      )
    );
    return;
  }

  // 带哈希的静态资源：缓存优先；命中即返回，未命中才请求并写入
  if (url.pathname.includes("/assets/") || /\.(png|svg|ico|woff2?|css|js)$/.test(url.pathname)) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(
        (hit) =>
          hit ||
          revalidate(req).then((res) => res || Response.error())
      )
    );
  }
});
