/* KnowFlow Service Worker：应用壳 + 静态资源 + 知识包缓存，不碰接口请求。
 *
 * 缓存策略（正确性优先）：
 * - 页面导航：**永远网络优先**，只有超时/离线才回落缓存。
 *   HTML 里写死了带哈希的 JS 文件名，旧 HTML + 新构建 = 入口脚本 404，
 *   页面直接白屏/卡骨架屏（Edge 上真实发生）。这类死锁只能靠「HTML 永远来自网络」根除。
 * - /assets/*（文件名带内容哈希）：cache-first，永久有效（文件名变了自然会重新取）
 * - /packs/*.json（词库、食谱、食材）：stale-while-revalidate
 * - sw.js 自身：不拦截；SW 内部 fetch 一律用 new Request 绕开自身，避免递归
 */
const CACHE = "knowflow-shell-v4";
const SHELL = ["./", "./index.html"];
/** 网络等待上限：超时先用缓存，别让用户干等（弱网/离线场景的兜底） */
const NETWORK_TIMEOUT = 2500;

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

/** 拉网络并把 HTML 写回缓存 */
function fetchAndCacheShell(req) {
  // 关键：不能直接 fetch(req)。SW 内部 fetch 一个 mode=navigate 的同源请求，
  // 会再次触发本 SW 的 fetch 事件 → 又走 resolveNavigation → 又 fetch，无限递归
  // （Edge 上尤其明显，表现为页面一直加载不出来）。重新构造一个普通 Request，
  // mode 默认是 "cors"，就不会命中导航分支。
  const plain = new Request(req.url, { cache: "no-cache", headers: req.headers });
  return fetch(plain).then((res) => {
    if (res.ok) {
      const copy = res.clone();
      caches
        .open(CACHE)
        .then((cache) => cache.put("./index.html", copy))
        .catch(() => undefined);
    }
    return res;
  });
}

function cachedShell(req) {
  return caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("./index.html"));
}

/**
 * 导航：**始终网络优先**，只有网络超时/失败才回落缓存。
 *
 * 为什么放弃「缓存壳秒开」：页面 HTML 里写死了带哈希的 JS 文件名，
 * 一旦用户拿着旧 HTML、而服务器上那份 JS 已经随新构建删掉 —— 入口脚本 404，
 * 一行 JS 都跑不起来，页面就永远停在骨架屏（Edge 上真实发生过）。
 * 这类「旧壳指向已删除资源」的死锁，只能靠「HTML 永远来自网络」根除。
 * HTML 本身很小（内联 CSS 后约 10KB gzip），这点往返换正确性值得。
 */
async function resolveNavigation(req) {
  const cached = await cachedShell(req);

  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT));
  const network = fetchAndCacheShell(req).catch(() => null);
  const res = (await Promise.race([network, timeout])) || cached;
  if (res) return res;
  return fetch(new Request(req.url)).catch(() => Response.error());
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Service Worker 自身永远走网络，否则新版本可能一天都装不上
  if (url.pathname.endsWith("/sw.js")) return;

  if (req.mode === "navigate") {
    event.respondWith(resolveNavigation(req));
    return;
  }

  // 知识包：先给缓存，再后台更新（词库单文件 500 KB+，第二次进入不该再等）
  if (url.pathname.includes("/packs/")) {
    event.respondWith(
      caches.match(req, { ignoreSearch: true }).then(
        (hit) =>
          hit ||
          fetch(new Request(req.url))
            .then((res) => {
              if (res.ok) {
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
              }
              return res;
            })
            .catch(() => Response.error())
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
          fetch(new Request(req.url))
            .then((res) => {
              if (res.ok) {
                const copy = res.clone();
                caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => undefined);
              }
              return res;
            })
            .catch(() => Response.error())
      )
    );
  }
});
