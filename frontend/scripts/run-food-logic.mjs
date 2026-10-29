import * as esbuild from "esbuild";
import { pathToFileURL } from "node:url";
await esbuild.build({
  entryPoints: ["scripts/smoke-food-logic.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "scripts/.smoke-food-logic.mjs",
  alias: { "@": "./src" },
  define: { __KF_MINITOOL__: "false" },
  logLevel: "error"
});
await import(pathToFileURL(process.cwd() + "/scripts/.smoke-food-logic.mjs").href);
