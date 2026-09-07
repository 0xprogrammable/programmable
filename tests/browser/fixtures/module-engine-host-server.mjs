import { build } from "esbuild";
import { createServer } from "node:http";
import { resolve } from "node:path";
export async function createEngineHostServer() {
  const root = process.cwd(), adapter = resolve(root, "tests/browser/fixtures/module-engine-host-state.tsx");
  const bundled = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ModuleEngineHost} from './components/module-engine-host'; import {FixtureWallet} from './tests/browser/fixtures/module-engine-host-state'; import './app/globals.css'; import './app/interface.css'; createRoot(document.getElementById('root')).render(<FixtureWallet><ModuleEngineHost/></FixtureWallet>);`, loader: "tsx", resolveDir: root },
    bundle: true, format: "esm", platform: "browser", write: false, outdir: "/fixture", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, external: ["/brand/*", "/fonts/*"],
    plugins: [{ name: "bounded-host-test-adapters", setup(plugin) {
      plugin.onResolve({ filter: /^@\/components\/(wallet-provider|module-engine-builder|module-engine-console)$/ }, () => ({ path: adapter }));
      plugin.onResolve({ filter: /^@\/lib\/module-engine\/client$/ }, args => args.importer.endsWith("/components/module-engine-host.tsx") ? { path: adapter } : undefined);
      plugin.onResolve({ filter: /^@\/lib\/module-mode-operation-recovery$/ }, () => ({ path: adapter }));
      plugin.onResolve({ filter: /^(next\/(link|image|navigation)|vitest)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: root, contents: args.path === "vitest" ? "export const vi = { fn: implementation => implementation || (() => {}) };" : args.path === "next/navigation" ? "export const useRouter = () => ({ push: url => window.location.assign(url) });" : args.path === "next/link" ? "import React from 'react'; export default function Link({prefetch,...props}) {return <a {...props}/>;}" : "import React from 'react'; export default function Image({priority,fill,...props}) {return <img {...props}/>;}" }));
    } }],
  });
  const files = new Map(bundled.outputFiles.map(file => [file.path.endsWith(".css") ? "/fixture.css" : "/fixture.js", file.contents]));
  return createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (files.has(path)) { response.setHeader("Content-Type", path.endsWith(".css") ? "text/css" : "text/javascript"); response.end(files.get(path)); return; }
    if (path === "/favicon.ico") { response.writeHead(204).end(); return; }
    if (path.startsWith("/fonts/")) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Local host orchestration test</title><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}
