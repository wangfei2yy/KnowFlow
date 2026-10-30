/**
 * 生产静态服务器：托管 `dist/`，给部署平台用。
 *
 * 为什么要它：之前线上跑的是 `vite dev`，每个模块单独请求、不打包不压缩，
 * 首屏要发几百个请求、转译一堆 TS，所以「加载慢」。这里改成服务构建产物。
 *
 * 只依赖 Node 内置模块（部署沙箱里不必再装东西）：
 * - 文本资源默认 br / gzip 压缩（词库 JSON 单文件 500 KB+，压完只剩三分之一）
 * - 带哈希的 /assets/* 给一年 immutable 缓存；index.html 不缓存
 * - 路径穿越防护；不存在时回退 index.html（本项目用 hash 路由，通常只用到根路径）
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { brotliCompressSync, gzipSync, constants as zc } from "node:zlib";

const ROOT = resolve(process.cwd(), "dist");
const PORT = Number(process.env.PORT) || 3000;
const HOST = "0.0.0.0";

if (!existsSync(join(ROOT, "index.html"))) {
  console.error(`[serve] 找不到 ${ROOT}/index.html，请先执行 vite build`);
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json; charset=utf-8"
};

/**
 * 旧客户端自救脚本。
 *
 * 触发条件：请求了不存在的 /assets/*.js —— 说明页面 HTML 是旧的（引用上一版构建的哈希）。
 * 这段脚本会：清空 Cache Storage → 注销 Service Worker → 带 `_v=` 重载页面。
 * 这样用户不需要手动「清除站点数据」，卡住的设备下一次加载就自动回到最新版。
 */
const RECOVERY_SCRIPT = `/* KnowFlow: stale-asset recovery */
(async () => {
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch (e) {}
  try {
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch (e) {}
  try {
    const u = new URL(location.href);
    u.searchParams.set("_v", String(Date.now()));
    location.replace(u.toString());
  } catch (e) {
    location.reload();
  }
})();
`;

/** 预压缩缓存：文件内容不变就一直复用，避免每次请求都压一遍 */
const compressed = new Map();

function compress(file, buffer, encoding) {
  // key 用「路径 + mtime + 编码」：同长度的两个文件不能撞在一起，
  // 构建产物换了内容（mtime 变）也要重新压
  const key = `${file}:${statSync(file).mtimeMs}:${encoding}`;
  const hit = compressed.get(key);
  if (hit) return hit;
  const body =
    encoding === "br"
      ? brotliCompressSync(buffer, {
          params: {
            [zc.BROTLI_PARAM_QUALITY]: 9,
            [zc.BROTLI_PARAM_SIZE_HINT]: buffer.length
          }
        })
      : gzipSync(buffer, { level: 9 });
  // 只留最近 40 个，防止词库多版本时内存无限涨
  if (compressed.size > 40) compressed.clear();
  compressed.set(key, body);
  return body;
}

function cacheControl(pathname) {
  // 带内容哈希：可以放心长期缓存
  if (pathname.startsWith("/assets/")) return "public, max-age=31536000, immutable";
  // index.html / sw.js / version.json 必须即时更新，否则用户拿不到新版本
  if (
    pathname === "/" ||
    pathname.endsWith(".html") ||
    pathname.endsWith("sw.js") ||
    pathname.endsWith("version.json")
  ) {
    return "no-cache";
  }
  // 知识包文件名固定但内容会随构建变：短缓存，兼顾速度与更新
  return "public, max-age=600";
}

/** 解析请求路径到磁盘文件，顺带挡掉路径穿越 */
function resolveFile(pathname) {
  let rel = decodeURIComponent(pathname.split("?")[0]);
  if (rel === "/" || rel === "") rel = "/index.html";
  const target = normalize(join(ROOT, rel));
  if (!target.startsWith(ROOT + sep) && target !== ROOT) return null;
  if (!existsSync(target)) return null;
  const st = statSync(target);
  if (st.isDirectory()) {
    const idx = join(target, "index.html");
    return existsSync(idx) ? idx : null;
  }
  return target;
}

const server = createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }

  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  let file = resolveFile(url.pathname);

  // 静态资源缺失才回退首页；/assets 下的哈希文件缺失不能回退成 HTML
  // （浏览器会把 JS 当 HTML 解析），走下面的「自愈脚本」
  if (!file && !url.pathname.startsWith("/assets/")) file = join(ROOT, "index.html");
  if (!file) {
    // 缺失的 JS/CSS chunk：说明客户端拿着**旧 HTML**（引用的是上一版构建的文件名）。
    // 这时如果老实返回 404，入口脚本就加载失败、一行 JS 都跑不起来，
    // 页面会永远卡在骨架屏，且 Service Worker 也无法自我更新（注册代码就在那个包体里）。
    // 所以改成返回一段「清缓存 + 注销 SW + 重载」的脚本，让旧客户端自己恢复。
    if (/\.(js|mjs)$/i.test(url.pathname)) {
      res.writeHead(200, {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      });
      res.end(RECOVERY_SCRIPT);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const ext = extname(file).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";
  const headers = {
    "Content-Type": type,
    "Cache-Control": cacheControl(url.pathname),
    "X-Content-Type-Options": "nosniff"
  };

  const isText = /^(text\/|application\/(json|manifest\+json)|image\/svg)/.test(type);
  const accept = String(req.headers["accept-encoding"] ?? "");
  const size = statSync(file).size;
  // 小于 1 KB 的文件压缩收益不如开销
  const encoding = isText && size > 1024 ? (accept.includes("br") ? "br" : accept.includes("gzip") ? "gzip" : null) : null;

  if (encoding) {
    const body = compress(file, readFileSync(file), encoding);
    headers["Content-Encoding"] = encoding;
    headers["Content-Length"] = String(body.length);
    // 同一 URL 会因编码不同返回不同字节，缓存层必须区分
    headers.Vary = "Accept-Encoding";
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : body);
    return;
  }

  headers["Content-Length"] = String(size);
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`[serve] dist/ 已就绪 → http://${HOST}:${PORT}`);
});

// 部署平台发 SIGTERM 时干净退出，避免端口占用导致重启失败
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
