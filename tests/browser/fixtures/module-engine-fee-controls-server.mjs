import { createServer } from "node:http";
import { build } from "esbuild";
export async function createModuleEngineFeeControlsServer() {
  const bundle = await build({ entryPoints: ["tests/browser/fixtures/module-engine-fee-controls.tsx"], bundle: true, format: "esm", platform: "browser", write: false, outdir: "/fixture-output", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" }, plugins: [{ name: "local-spy", setup(builder) {
      builder.onResolve({ filter: /^vitest$/ }, () => ({ path: "vitest", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ loader: "js", contents: "export const vi={fn:(implementation=()=>undefined)=>implementation};" }));
    } }] });
  const files = new Map(bundle.outputFiles.map(file => [file.path.endsWith(".css") ? "/fixture.css" : "/fixture.js", file.contents]));
  return createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (files.has(url.pathname)) { response.setHeader("Content-Type", url.pathname.endsWith(".css") ? "text/css" : "text/javascript"); response.end(files.get(url.pathname)); return; }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"><title>Fee recipient controls · local test</title></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}
