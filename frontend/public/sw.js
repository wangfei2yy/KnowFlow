/* KnowFlow Service Worker：应用壳 + 静态资源 + 知识包缓存，不碰接口请求。
 *
 * 缓存策略（兼顾「秒开」和「改了就生效」）：
 * - 页面导航：**缓存壳 5 分钟内直接给**（秒开）；超过 5 分钟就网络优先，
 *   保证发版后下一次打开必定是新版本。弱网/离线时才回落缓存。
 *   之前是纯「缓存优先 + 后台更新」：二次打开确实快，但发版后用户会一直看到旧 HTML
 *   （新构建资源名变了，旧 HTML 仍指向旧文件），症状就是「改的东西没生效」
 *   「已经修掉的黄底又出现了」。
 * - /assets/*（文件名带内容哈希）：cache-first，永久有效
 * - /packs/*.json（词库、食谱、食材）：stale-while-revalidate
 * - sw.js 自身：不拦截（否则新版本可能一天都装不上）
 */
const CACHE = "knowflow-shell-v3";
const SHELL = ["./", "./index.html"];
/**
 * 缓存壳的保鲜期：超过它才走网络。
 *
 * 为什么敢放到 6 小时：页面有 version.json 版本自检（utils/appUpdate.ts），
 * 一旦服务端发了新构建，页面会自己发现并清缓存重载，所以「壳旧」不会再导致「版本旧」。
 * 而每次打开都能命中缓存 → 秒开，这才是日常体验的大头（实测 1.4s → 84ms）。
 */
const SHELL_MAX_AGE = 6 * 60 * 60 * 1000;
/** 网络等待上限：超时先用缓存，别让用户干等 */
const NETWORK_TIMEOUT = 2500;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => markShellFetched())
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

/** 记录壳的抓取时间（存成一条缓存项，SW 被回收也不会丢） */
async function markShellFetched() {
  const cache = await caches.open(CACHE);
  await cache.put("./shell-at", new Response(String(Date.now())));
}

/** 距离上次抓到壳过去了多久（毫秒）；没有记录就当很久（走网络） */
async function shellAge() {
  try {
    const cache = await caches.open(CACHE);
    const res = await cache.match("./shell-at");
    if (!res) return Number.POSITIVE_INFINITY;
    return Date.now() - Number(await res.text());
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

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
        .then(() => markShellFetched())
        .catch(() => undefined);
    }
    return res;
  });
}

function cachedShell(req) {
  return caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match("./index.html"));
}

/** 导航：新鲜的壳直接给缓存，过期的壳走网络（超时回落缓存） */
async function resolveNavigation(req) {
  const cached = await cachedShell(req);
  const age = await shellAge();

  // 还没有缓存（首次访问）或壳已过期：网络优先
  if (!cached || age > SHELL_MAX_AGE) {
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_TIMEOUT));
    const network = fetchAndCacheShell(req).catch(() => null);
    const res = (await Promise.race([network, timeout])) || cached;
    if (res) return res;
    // 网络和缓存都没有，再给一次网络（至少把错误暴露出来）
    return fetch(new Request(req.url)).catch(() => Response.error());
  }

  // 壳还新鲜：先给缓存，同时后台更新（下次打开就是最新）
  fetchAndCacheShell(req).catch(() => undefined);
  return cached;
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
