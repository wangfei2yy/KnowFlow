import * as esbuild from "esbuild";
import { pathToFileURL } from "node:url";
await esbuild.build({
  entryPoints: ["scripts/smoke-markdown.ts"],
  bundle: true, platform: "node", format: "esm",
  outfile: "scripts/.smoke-markdown.mjs",
  alias: { "@": "./src" },
  define: { __KF_MINITOOL__: "false" },
  logLevel: "error"
});
await import(pathToFileURL(process.cwd() + "/scripts/.smoke-markdown.mjs").href);
