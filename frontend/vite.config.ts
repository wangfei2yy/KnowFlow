import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath, URL } from "node:url";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * 构建目标：
 * - 默认（未设置 KF_TARGET）：普通 Web 应用，输出 dist/
 * - KF_TARGET=minitool：小红书小工具离线包，输出 dist-minitool/
 *
 * 小工具容器有三条硬约束，因此单独一套构建：
 * 1. 只能加载 classic script（不能 type="module"、不能 import/export）
 * 2. 禁止联网（fetch / XHR）、禁止 Web Worker
 * 3. 面向 Chrome 61 / ES2017 基线
 */
const isMiniTool =
  process.env.KF_TARGET === "minitool" || process.env.npm_lifecycle_event === "build:minitool";

/**
 * `npm run build:minitool` 即触发小工具构建（跨平台，无需额外环境变量）。
 */

/** 把 Vite 默认的 module script 改写成 classic script */
function minitoolHtmlPlugin(): Plugin {
  return {
    name: "kf-minitool-html",
    enforce: "post",
    transformIndexHtml(html: string) {
      return html
        // 关键：module script 默认延迟执行；改成 classic script 后必须显式补 defer，
        // 否则脚本会在 <div id="app"> 解析前同步执行，Vue 挂载失败导致整页无法交互
        .replace(/<script([^>]*?)\stype="module"([^>]*)>/g, "<script$1 defer$2>")
        .replace(/<script([^>]*?)\scrossorigin([^>]*)>/g, "<script$1$2>")
        .replace(/\s*<link[^>]+rel="modulepreload"[^>]*>/g, "")
        // 容器统一管理安全策略，规范要求包内不得自建 CSP <meta>
        .replace(/\s*<!--\s*安全策略[\s\S]*?-->/g, "")
        .replace(/\s*<meta\s+http-equiv="Content-Security-Policy"[\s\S]*?\/>/g, "")
        .replace(/\s*<link rel="stylesheet" crossorigin/g, '<link rel="stylesheet"');
    }
  };
}

/**
 * 把入口 CSS 内联进 index.html。
 *
 * 为什么：`<link rel="stylesheet">` 是**渲染阻塞**的 —— 浏览器要等它回来才画第一帧。
 * 部署环境单次往返约 0.6s，这一等就是 0.6s 的白屏（骨架屏都被挡住）。
 * 入口 CSS 只有 8KB（gzip 约 2KB），内联进 HTML 后省掉一个往返，首帧立刻可见。
 * 页面级 CSS（OrbPage 等）仍然按 chunk 分开，不受影响。
 *
 * 只对网页构建生效：小工具容器的安全策略由容器管理，不塞内联样式更稳妥。
 */
function inlineEntryCssPlugin(): Plugin {
  return {
    name: "kf-inline-entry-css",
    apply: "build",
    enforce: "post",
    closeBundle() {
      if (isMiniTool) return;
      const dir = "dist";
      const htmlPath = `${dir}/index.html`;
      if (!existsSync(htmlPath)) return;
      const html = readFileSync(htmlPath, "utf8");
      const next = html.replace(
        /<link[^>]+rel="stylesheet"[^>]*href="\.?\/?(assets\/[^"]+\.css)"[^>]*>/g,
        (tag, href: string) => {
          const cssPath = `${dir}/${href}`;
          if (!existsSync(cssPath)) return tag;
          return `<style>${readFileSync(cssPath, "utf8")}</style>`;
        }
      );
      if (next !== html) writeFileSync(htmlPath, next);
      // 版本自检文件：SW 缓存了旧 HTML 时，页面靠它发现自己过期了
      writeFileSync(
        `${dir}/version.json`,
        JSON.stringify({ buildId: BUILD_ID, builtAt: new Date().toISOString() })
      );
    }
  };
}

/** 这次构建的版本号：写进 JS（define）也写进 dist/version.json，页面加载后对比两者判断是否旧版本 */
const BUILD_ID = `${Date.now().toString(36)}`;

export default defineConfig({
  plugins: [vue(), ...(isMiniTool ? [minitoolHtmlPlugin()] : [inlineEntryCssPlugin()])],
  // 使用相对路径，便于部署到任意静态托管（含子路径）
  base: "./",
  define: {
    __KF_MINITOOL__: JSON.stringify(isMiniTool),
    __BUILD_ID__: JSON.stringify(BUILD_ID)
  },
  resolve: {
    alias: {
      // 小工具构建：用替身模块整体替换被容器禁止的能力，
      // 保证产物中不残留 fetch / pdfjs / Web Worker / a[download] 代码。
      // ⚠️ 必须排在 "@" 之前：字符串 alias 按前缀匹配，放后面会被 "@" 抢先命中。
      ...(isMiniTool
        ? {
            "@/db/database": fileURLToPath(
              new URL("./src/minitool/database.stub.ts", import.meta.url)
            ),
            "@/services/ai/OpenAICompatibleProvider": fileURLToPath(
              new URL("./src/minitool/openai.stub.ts", import.meta.url)
            ),
            "@/services/pdfWorkerUrl": fileURLToPath(
              new URL("./src/minitool/pdfWorkerUrl.stub.ts", import.meta.url)
            ),
            // 内置知识包需要联网拉取 → 换成空实现/抛错替身
            "@/services/knowledgePack": fileURLToPath(
              new URL("./src/minitool/knowledgePack.stub.ts", import.meta.url)
            ),
            // 语音转写需要上传音频，容器禁止联网 → 换成抛错替身
            "@/services/speech/transcribe": fileURLToPath(
              new URL("./src/minitool/transcribe.stub.ts", import.meta.url)
            ),
            // 录音（getUserMedia / MediaRecorder）在容器内不可用 → 整体替身
            "@/services/speech/whisperRecorder": fileURLToPath(
              new URL("./src/minitool/whisperRecorder.stub.ts", import.meta.url)
            ),
            "@/utils/download": fileURLToPath(
              new URL("./src/minitool/download.stub.ts", import.meta.url)
            ),
            "pdfjs-dist": fileURLToPath(new URL("./src/minitool/pdfjs.stub.ts", import.meta.url))
          }
        : {}),
      "@": fileURLToPath(new URL("./src", import.meta.url))
    }
  },
  // 允许发布平台的反向代理域名访问（避免 "Blocked request" 拦截）
  // port：本地固定 5195（原 5173 + 22）；托管平台会注入 PORT，必须优先跟随，否则被判「启动失败」
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: Number(process.env.PORT) || 5195,
    strictPort: true
  },
  preview: {
    host: "0.0.0.0",
    allowedHosts: true,
    port: Number(process.env.PORT) || 4195,
    strictPort: true
  },
  build: {
    outDir: isMiniTool ? "dist-minitool" : "dist",
    sourcemap: false,
    target: isMiniTool ? ["es2017", "chrome61"] : "es2020",
    // 小工具：单文件 CSS + 单个 classic script，无 code splitting
    cssCodeSplit: !isMiniTool,
    // 网页构建打开 modulepreload：路由 chunk 的静态依赖会被并行预取，
    // 少一层「先下 A 才知道要下 B」的水位线（部署环境单次请求约 0.6s，这一层很贵）
    modulePreload: isMiniTool ? false : { polyfill: false },
    rollupOptions: isMiniTool
      ? {
          output: {
            format: "iife",
            inlineDynamicImports: true,
            entryFileNames: "assets/app.js",
            chunkFileNames: "assets/[name].js",
            assetFileNames: "assets/[name][extname]"
          }
        }
      : {
          output: {
            /**
             * 手动分包的价值不只是「首屏更小」，更是**缓存命中**：
             * 以前所有第三方库和业务代码挤在 index-*.js 里，改一行文案整个 110KB 都要重下。
             * 现在框架、图标、工具库各有独立 chunk，改业务代码时它们都还在缓存里。
             */
            manualChunks(id: string) {
              if (!id.includes("node_modules")) return;
              if (id.includes("pdfjs-dist")) return "pdfjs";
              if (id.includes("dexie")) return "dexie";
              if (id.includes("lucide")) return "icons";
              if (id.includes("/vue/") || id.includes("vue-router") || id.includes("pinia") || id.includes("@vue")) {
                return "vue";
              }
              return "vendor";
            }
          }
        }
  }
});
