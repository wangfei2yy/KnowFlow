/**
 * 构建产物体检：守住首屏那几条关键约束，防止以后无意中改回去。
 *
 * 为什么需要它：首屏慢过一次（线上跑 dev server），后来又踩过
 * 「modulePreload 关掉 → 点模块要现下载 → 卡 1.7s」。这些都不是运行时报错，
 * 只能靠检查产物。跑法：npm run test:build（需先 build）
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";

let pass = 0;
const failed = [];
const ok = (cond, msg) => {
  if (cond) pass += 1;
  else failed.push(msg);
};

const DIST = "dist";
const htmlPath = `${DIST}/index.html`;
if (!existsSync(htmlPath)) {
  console.error("❌ 找不到 dist/index.html，先跑 npm run build");
  process.exit(1);
}
const html = readFileSync(htmlPath, "utf8");
const assets = readdirSync(`${DIST}/assets`);

// 1) 入口 CSS 必须内联：<link rel="stylesheet"> 会阻塞首帧，等于多等一个 RTT
ok(/<style>/.test(html), "index.html 应内联入口 CSS（首帧不被渲染阻塞）");
ok(
  !/<link[^>]+rel="stylesheet"[^>]*assets\/[^"]+\.css/.test(html),
  "index.html 不应再引入外链入口 CSS（会阻塞首帧）"
);

// 2) 首屏骨架：JS 没到位时不能是白屏
ok(html.includes("kf-boot"), "index.html 应包含首屏骨架（避免 1s+ 白屏）");

// 3) 依赖预加载：路由 chunk 的公共依赖要能并行拉，不然是串行水位线
const preloads = [...html.matchAll(/<link rel="modulepreload"[^>]*href="([^"]+)"/g)].map((m) => m[1]);
ok(preloads.length >= 2, `index.html 应有 modulepreload（实际 ${preloads.length} 个）`);
ok(
  preloads.some((p) => /vue-[A-Za-z0-9_-]+\.js/.test(p)),
  "vue 运行时应被 modulepreload（否则要等主包下载完才知道要它）"
);

// 4) 分包：框架、dexie、图标应各自独立，改动业务代码不会让它们失效
for (const name of ["vue", "dexie", "icons"]) {
  ok(
    assets.some((f) => f.startsWith(`${name}-`) && f.endsWith(".js")),
    `应存在独立的 ${name} chunk（便于长期缓存）`
  );
}

// 5) 入口包不该把 pdfjs 拖进来（它是懒加载的重家伙）
const entry = assets.find((f) => /^index-[A-Za-z0-9_-]+\.js$/.test(f));
ok(!!entry, "应有入口 chunk");
if (entry) {
  const size = statSync(`${DIST}/assets/${entry}`).size;
  ok(size < 200 * 1024, `入口 chunk 应 <200KB，实际 ${Math.round(size / 1024)}KB`);
  const code = readFileSync(`${DIST}/assets/${entry}`, "utf8");
  ok(!code.includes("vite/client"), "入口包不应含 dev server 代码（说明跑的不是生产构建）");
  ok(!code.includes("PDFDocumentProxy"), "入口包不应含 pdfjs（应留在按需加载的 chunk 里）");
}

// 6) 版本自检：version.json 与 network-first 的 SW
const versionPath = `${DIST}/version.json`;
ok(existsSync(versionPath), "应产出 dist/version.json（用于页面自检是否旧版本）");
if (existsSync(versionPath)) {
  const v = JSON.parse(readFileSync(versionPath, "utf8"));
  ok(!!v.buildId, "version.json 应包含 buildId");
}
const swPath = `${DIST}/sw.js`;
if (existsSync(swPath)) {
  const sw = readFileSync(swPath, "utf8");
  ok(!sw.includes("SHELL_MAX_AGE"), "sw.js 导航不应再有「缓存壳」捷径（HTML 必须永远来自网络）");
  ok(sw.includes("/sw.js"), "sw.js 不应把自己也缓存（否则新版本永远装不上）");
  ok(!sw.includes("knowflow-shell-v2") && !sw.includes("knowflow-shell-v3"), "sw.js 的缓存版本号应已升级（旧缓存会被清掉）");
  ok(sw.includes("new Request(req.url)"), "sw.js 内部 fetch 必须用 new Request 绕过自身，否则 fetch 递归卡死页面");
}

// 6.5) 服务端自救脚本：缺失的 /assets/*.js 不能返回 404
const serverPath = "server.mjs";
if (existsSync(serverPath)) {
  const server = readFileSync(serverPath, "utf8");
  ok(server.includes("RECOVERY_SCRIPT"), "server.mjs 应内置 RECOVERY_SCRIPT（旧客户端自救）");
  ok(
    /startsWith\("\/assets\/"\)/.test(server),
    "server.mjs 应区分 /assets/ 缺失（自愈）与其它 404"
  );
}

// 7) 网页构建不应残留小工具的替身模块
ok(!assets.some((f) => f.includes("stub")), "网页产物不应包含 *stub* 替身 chunk");

if (failed.length) {
  console.error("\n❌ 构建产物体检失败：");
  for (const f of failed) console.error("  •", f);
  process.exit(1);
}
console.log(`\n✅ 构建产物体检通过（${pass} 条）：CSS 内联 / 首屏骨架 / 依赖预加载 / 分包`);
