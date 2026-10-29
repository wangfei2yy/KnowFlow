/**
 * 端内产物清理：内置知识包与 Service Worker 都不能进入小工具包。
 *   - packs/：在线词库（约 1.5MB）无网络不可用，且会挤爆包体
 *   - sw.js：容器禁用 Service Worker
 */
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(process.cwd(), "dist-minitool");
for (const target of ["packs", "sw.js"]) {
  const full = path.join(dir, target);
  if (fs.existsSync(full)) {
    fs.rmSync(full, { recursive: true, force: true });
    console.log(`removed ${target}`);
  }
}
