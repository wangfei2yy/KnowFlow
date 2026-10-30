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
await sleep(4000);
console.log("① 初始：SW =", await evalJs(`navigator.serviceWorker.controller ? 'controlled' : 'none'`),
  "| 缓存 =", await evalJs(`caches.keys().then(k=>k.join(',')||'(空)')`));

// 模拟旧页面的自救：把缺号 chunk 的响应当脚本执行
console.log("② 缺号 chunk 响应类型:", await evalJs(`fetch('/assets/index-MISSING.js').then(r=>r.status + ' ' + r.headers.get('content-type'))`));
await evalJs(`fetch('/assets/index-MISSING.js').then(r=>r.text()).then(t=>{ const s=document.createElement('script'); s.textContent=t; document.body.appendChild(s); }).catch(()=>{})`);
await sleep(2500);
console.log("③ 自救脚本执行后 → URL:", await evalJs("location.search"));
console.log("   缓存 =", await evalJs(`caches.keys().then(k=>k.join(',')||'(已清空)')`),
  "| SW =", await evalJs(`navigator.serviceWorker.getRegistrations().then(r=>r.length ? '仍有'+r.length : '已注销')`));
console.log("   页面是否正常:", await evalJs(`!!(document.querySelector('h1')||{}).textContent`));
ws.close();
