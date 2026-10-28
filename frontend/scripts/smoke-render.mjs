import { JSDOM } from "jsdom";
import fs from "node:fs";

const html = fs.readFileSync("dist-minitool/index.html", "utf8");
const js = fs.readFileSync("dist-minitool/assets/app.js", "utf8");

const dom = new JSDOM(html, {
  url: "http://localhost/index.html",
  pretendToBeVisual: true,
  runScripts: "outside-only"
});
const { window } = dom;

// 补齐 jsdom 缺失、真实容器(Chrome 61+)肯定有的 API
window.matchMedia = window.matchMedia || ((q) => ({ matches: false, media: q, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return false; } }));
window.ResizeObserver = window.ResizeObserver || class { observe(){} unobserve(){} disconnect(){} };
window.IntersectionObserver = window.IntersectionObserver || class { observe(){} unobserve(){} disconnect(){} takeRecords(){ return []; } };
window.scrollTo = window.scrollTo || (() => {});
window.HTMLElement.prototype.scrollIntoView = window.HTMLElement.prototype.scrollIntoView || function(){};

const errors = [];
window.addEventListener("error", (e) => errors.push(String(e.message)));

// 按 defer 语义：DOM 就绪后执行脚本
try {
  window.eval(js);
} catch (e) {
  console.error("SCRIPT THREW:", e.message);
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(500);

const doc = window.document;
const app = doc.querySelector("#app");
const text = app ? app.innerHTML : "";
console.log("app innerHTML length:", text.length);
if (text.length < 500) { console.error("APP NOT RENDERED"); process.exit(1); }

const visible = app.textContent.replace(/\s+/g, " ").trim().slice(0, 200);
console.log("PAGE TEXT:", visible);

// 统计可点击元素
const buttons = [...doc.querySelectorAll("button, a")];
console.log("clickable elements:", buttons.length);

// 模拟点击：找到侧边栏/底栏导航项，验证路由切换
const navTexts = ["资料库", "学习", "导入", "任务", "设置"];
let clicked = 0;
for (const label of navTexts) {
  const el = buttons.find((b) => (b.textContent || "").includes(label));
  if (!el) { console.log(`nav "${label}": NOT FOUND`); continue; }
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await sleep(300);
  const after = app.textContent.replace(/\s+/g, " ").trim().slice(0, 80);
  console.log(`nav "${label}" ->`, after);
  clicked++;
}
console.log("nav clicked:", clicked, "/", navTexts.length);

// 点击一个普通按钮（如首页搜索或功能入口）
const anyBtn = buttons.find((b) => (b.textContent || "").trim() && !navTexts.some(n => (b.textContent||"").includes(n)));
if (anyBtn) {
  anyBtn.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await sleep(200);
  console.log("generic button clicked OK:", (anyBtn.textContent||"").trim().slice(0, 30));
}

// 小工具容器内不应出现麦克风/语音入口（无权限、无网络）
const micBtn = doc.querySelector('[title^="按住说话"]');
console.log("mic button in minitool:", micBtn ? "PRESENT (unexpected)" : "absent (ok)");
if (micBtn) { console.error("MIC SHOULD BE HIDDEN IN MINITOOL"); process.exit(1); }

console.log("runtime errors:", errors.length ? errors : "none");
if (errors.length) process.exit(1);
console.log("SMOKE PASS");
