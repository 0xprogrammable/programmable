// Local component fixture only. No product routes, source configuration, RPC or wallet provider is changed.
import { context } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const repo = fileURLToPath(new URL("../..", import.meta.url));
const output = path.join(repo, "work/module-engine-browser");
const build = await context({ absWorkingDir: repo, entryPoints: ["tests/browser-fixtures/module-engine-ui.tsx"], outdir: output, bundle: true, format: "esm", platform: "browser", jsx: "automatic", sourcemap: true, define: { "process.env.NODE_ENV": '"development"', "process.env": "{}" }, plugins: [{ name: "test-spy-adapter", setup(builder) { builder.onResolve({ filter: /^vitest$/ }, () => ({ path: "test-spy-adapter", namespace: "test-fixture" })); builder.onLoad({ filter: /.*/, namespace: "test-fixture" }, () => ({ contents: "export const vi = { fn: implementation => implementation || (() => {}) };", loader: "js" })); } }] });
await build.watch();
const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Module controls · local UI test</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/module-engine-ui.css"></head><body><div id="root"></div><script type="module" src="/module-engine-ui.js"></script></body></html>';
const server = createServer(async (req, res) => { const pathname = new URL(req.url, "http://127.0.0.1").pathname; try { if (pathname === "/") { await build.rebuild(); res.setHeader("Content-Type", "text/html"); res.end(html); return; } const allowed = new Set(["/module-engine-ui.js", "/module-engine-ui.js.map", "/module-engine-ui.css", "/module-engine-ui.css.map"]); if (!allowed.has(pathname)) { res.writeHead(404).end(); return; } res.setHeader("Content-Type", pathname.endsWith(".css") ? "text/css" : pathname.endsWith(".js") ? "text/javascript" : "application/json"); res.end(await readFile(path.join(output, pathname.slice(1)))); } catch { res.writeHead(503).end("Fixture build pending"); } });
server.listen(Number(process.env.MODULE_ENGINE_UI_PORT ?? 4317), "127.0.0.1", () => process.stdout.write(`Local UI test fixture: http://127.0.0.1:${server.address().port}\n`));
process.on("SIGINT", async () => { server.close(); await build.dispose(); process.exit(); });
