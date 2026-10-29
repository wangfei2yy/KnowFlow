import * as esbuild from "esbuild";
import { pathToFileURL } from "node:url";
await esbuild.build({
  entryPoints: ["scripts/smoke-search.ts"],
  bundle: true, platform: "node", format: "esm",
  outfile: "scripts/.smoke-search.mjs",
  alias: { "@": "./src" },
  define: { __KF_MINITOOL__: "true" },
  logLevel: "error"
});
await import(pathToFileURL(process.cwd() + "/scripts/.smoke-search.mjs").href);
