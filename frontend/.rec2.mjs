const port = 9295;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0; const waiters = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } });
await new Promise((r) => ws.addEventListener("open", r));
const send = (method, params = {}) => { const mid = ++id; ws.send(JSON.stringify({ id: mid, method, params })); return new Promise((r) => waiters.set(mid, r)); };
const evalJs = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send("Page.enable");
await sleep(3000);
console.log("初始 URL:", await evalJs("location.href"), "| 缓存:", await evalJs(`caches.keys().then(k=>k.join(',')||'(空)')`));
// 以 src 方式加载（模拟浏览器加载入口脚本，不受内联 CSP 限制）
await evalJs(`(() => { const s=document.createElement('script'); s.type='module'; s.src='/assets/index-MISSING.js'; document.head.appendChild(s); return 'appended'; })()`);
await sleep(3000);
console.log("执行后 URL:", await evalJs("location.href"));
console.log("缓存:", await evalJs(`caches.keys().then(k=>k.join(',')||'(已清空)')`), "| SW:", await evalJs(`navigator.serviceWorker.getRegistrations().then(r=>r.length?'仍有':'已注销')`), "| 页面正常:", await evalJs(`!!(document.querySelector('h1')||{}).textContent`));
ws.close();
