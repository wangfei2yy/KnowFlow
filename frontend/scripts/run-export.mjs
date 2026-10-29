import * as esbuild from "esbuild";
import { pathToFileURL } from "node:url";
await esbuild.build({
  entryPoints: ["scripts/smoke-export.ts"],
  bundle: true, platform: "node", format: "esm",
  outfile: "scripts/.smoke-export.mjs",
  alias: { "@/db/database": "./src/minitool/database.stub.ts", "@": "./src" },
  define: { __KF_MINITOOL__: "true" },
  logLevel: "error"
});
await import(pathToFileURL(process.cwd() + "/scripts/.smoke-export.mjs").href);
