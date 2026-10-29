import * as esbuild from "esbuild";
import { pathToFileURL } from "node:url";
await esbuild.build({
  entryPoints: ["scripts/smoke-kitchen.ts"],
  bundle: true, platform: "node", format: "esm",
  outfile: "scripts/.smoke-kitchen.mjs",
  alias: { "@": "./src" },
  define: { __KF_MINITOOL__: "false" },
  logLevel: "error"
});
await import(pathToFileURL(process.cwd() + "/scripts/.smoke-kitchen.mjs").href);
