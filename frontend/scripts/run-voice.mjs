import * as esbuild from "esbuild";
import { JSDOM } from "jsdom";
import { pathToFileURL } from "node:url";

await esbuild.build({
  entryPoints: ["scripts/smoke-voice.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "scripts/.smoke-voice.mjs",
  alias: { "@": "./src" },
  define: { __KF_MINITOOL__: "false" },
  logLevel: "error"
});

const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
Object.defineProperty(globalThis, "localStorage", { value: dom.window.localStorage, configurable: true });

await import(pathToFileURL(process.cwd() + "/scripts/.smoke-voice.mjs").href);
