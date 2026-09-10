// Uses existing component-fixture conventions; keeps bundles in memory on disk-constrained hosts.
import { context } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const repo = fileURLToPath(new URL("../..", import.meta.url));
const adapter = path.join(repo, "tests/browser-fixtures/any-quote-ui-adapter.ts");
const build = await context({ absWorkingDir: repo, entryPoints: ["tests/browser-fixtures/any-quote-ui.tsx"], outdir: path.join(repo, "work/any-quote-ui-browser"), write: false, bundle: true, format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" }, plugins: [
  { name: "local-any-quote-api", setup(builder) { builder.onResolve({ filter: /^@\/lib\/module-engine\/any-quote\/integration-client$/ }, () => ({ path: adapter })); } },
  { name: "fixture-spies", setup(builder) { builder.onResolve({ filter: /^vitest$/ }, () => ({ path: "fixture-spies", namespace: "fixture" })); builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: "export const vi = { fn: implementation => implementation || (() => {}) };", loader: "js" })); } },
] });
let files = new Map();
async function rebuild() { const result = await build.rebuild(); files = new Map(result.outputFiles.map(file => [path.basename(file.path), file.contents])); }
await rebuild();
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Any Quote LP · local UI test</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/any-quote-ui.css"></head><body><div id="root"></div><script type="module" src="/any-quote-ui.js"></script></body></html>';
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://127.0.0.1").pathname;
  try {
    if (pathname === "/") { await rebuild(); res.setHeader("Content-Type", "text/html"); res.end(html); return; }
    if (pathname === "/brand/loop/programmable-module-token-default-v1.png") { res.setHeader("Content-Type", "image/png"); res.end(await readFile(path.join(process.env.ANY_QUOTE_UI_ASSETS ?? path.join(repo, "public"), pathname.slice(1)))); return; }
    const file = files.get(pathname.slice(1));
    if (!file) { res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", pathname.endsWith(".css") ? "text/css" : "application/javascript"); res.end(file);
  } catch (error) { res.writeHead(503).end(String(error)); }
});
server.listen(Number(process.env.ANY_QUOTE_UI_PORT ?? 4327), "127.0.0.1", () => process.stdout.write(`Any Quote local UI: http://127.0.0.1:${server.address().port}\n`));
process.on("SIGINT", async () => { server.close(); await build.dispose(); process.exit(); });
