import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { build } from "esbuild";

export async function createModuleModeOperationServer() {
  const root = process.cwd();
  const bundle = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ModuleModeLaunchHost} from './components/module-mode-launch-host'; import {ModuleCoinConsole} from './components/module-coin-console'; import {FixtureWallet,token} from './tests/browser/fixtures/module-mode-operation-wallet'; import './app/globals.css'; import './app/interface.css'; import './app/programmable-experience.css'; import './app/webde-final-ui.css'; createRoot(document.getElementById('root')).render(<FixtureWallet>{window.location.pathname.includes('/manage/') ? <ModuleCoinConsole token={token}/> : <ModuleModeLaunchHost/>}</FixtureWallet>);`, loader: "tsx", resolveDir: root },
    bundle: true, format: "esm", platform: "browser", write: false, outdir: "/fixture-output", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, external: ["/brand/*", "/fonts/*"],
    plugins: [{ name: "module-mode-operation-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(?:@\/components\/(?:wallet-provider|view-chain)|@\/lib\/module-mode\/(?:native-client|management)|\.\/module-mode\/native-client)$/ }, () => ({ path: resolve(root, "tests/browser/fixtures/module-mode-operation-wallet.tsx") }));
      plugin.onResolve({ filter: /^next\/(link|image)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: root, contents: args.path === "next/link" ? `import React from 'react'; export default function Link({prefetch,...props}) { return <a {...props}/>; }` : `import React from 'react'; export default function Image({priority,fill,...props}) { return <img {...props}/>; }` }));
    } }],
  });
  const sources = new Map(bundle.outputFiles.map(file => [file.path.endsWith(".css") ? "/fixture.css" : "/fixture.js", file.contents]));
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (sources.has(url.pathname)) { response.setHeader("Content-Type", url.pathname.endsWith(".css") ? "text/css" : "text/javascript"); response.end(sources.get(url.pathname)); return; }
    if (url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/brand/")) {
      const base = resolve(root, "public"), file = resolve(base, "." + url.pathname);
      if (!file.startsWith(base + sep)) { response.writeHead(404); response.end(); return; }
      try { response.setHeader("Content-Type", file.endsWith(".woff2") ? "font/woff2" : "image/svg+xml"); response.end(await readFile(file)); } catch { response.writeHead(404); response.end(); } return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Module Mode operation recovery fixture</title><link rel="stylesheet" href="/fixture.css"><style>body{background:#050606;color:#fff;font-family:system-ui,sans-serif}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}
