import * as esbuild from "esbuild";
import { pathToFileURL } from "node:url";

await esbuild.build({
  entryPoints: ["scripts/smoke-srs.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "scripts/.smoke-srs.mjs",
  alias: { "@/db/database": "./src/minitool/database.stub.ts", "@": "./src" },
  define: { __KF_MINITOOL__: "true" },
  logLevel: "error"
});

const store = new Map();
globalThis.window = {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};
await import(pathToFileURL(process.cwd() + "/scripts/.smoke-srs.mjs").href);
