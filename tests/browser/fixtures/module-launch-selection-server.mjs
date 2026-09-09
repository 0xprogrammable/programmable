import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { build } from "esbuild";

/** Real selection components and view-chain provider. Synthetic release; no wallet or RPC. */
export async function createModuleLaunchSelectionServer() {
  const root = process.cwd();
  const entry = `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ModuleModeBuilder} from './components/module-mode-builder';
    import {ModuleEngineLibrary} from './components/module-engine-library';
    import {ViewChainProvider} from './components/view-chain';
    import {bindActiveModuleModeRelease, computeModuleModeReleaseDigest, MODULE_MODE_ECONOMICS_POLICY_V2} from './lib/module-mode/release';
    import {bindNativeCatalogEntry} from './lib/module-mode/native-catalog';
    import {moduleEvidenceFixture} from './tests/fixtures/module-mode-evidence';
    import {fixture} from './tests/module-engine-fixture';
    import catalog from './config/module-mode/catalog.json';
    import './app/globals.css'; import './app/interface.css'; import './app/programmable-experience.css'; import './app/webde-final-ui.css';
    const mode = new URLSearchParams(location.search).get('mode');
    const base = moduleEvidenceFixture().release;
    const identity = {...base, schemaVersion:'programmable.module-mode-source.v2', sourceVersion:'module-native-v2', economicsPolicyId:MODULE_MODE_ECONOMICS_POLICY_V2};
    const release = bindActiveModuleModeRelease({...identity, releaseDigest:computeModuleModeReleaseDigest(identity)});
    const publishedEntry = bindNativeCatalogEntry(catalog.entries[0].entry);
    if (mode === 'unknown') delete publishedEntry.nativeBinding.feeEligibility;
    function App() {return <ViewChainProvider initialViewChainId={1}><div className="fixture-note">Local UI fixture</div>
      {mode==='engine' ? <main className="fixture-engine"><ModuleEngineLibrary templates={[fixture().template]} selectedId="" onSelect={()=>{}}/></main>
        : <ModuleModeBuilder release={release} catalog={mode==='empty'?[]:[publishedEntry]} launchAction={{label:'Review launch',description:'Local fixture only',onContinue:async()=>{throw new Error('This fixture cannot launch a coin.');}}}/>}
    </ViewChainProvider>};
    createRoot(document.getElementById('root')).render(<App/>);
  `;
  const bundled = await build({ stdin: { contents: entry, loader: "tsx", resolveDir: root }, bundle: true, format: "esm", platform: "browser", write: false,
    outdir: "/fixture-output", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, external: ["/fonts/*", "/brand/*"],
    plugins: [{ name: "module-selection-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(vitest|next\/(link|image))$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: root,
        contents: args.path === "vitest" ? `export const vi={fn:(implementation=()=>undefined)=>implementation};`
          : args.path === "next/link" ? `import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}`
          : `import React from 'react';export default function Image({priority,fill,unoptimized,...props}){return <img {...props}/>}` }));
    } }],
  });
  const files = new Map(bundled.outputFiles.map(file => [file.path.endsWith(".css") ? "/fixture.css" : "/fixture.js", file.contents]));
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (files.has(url.pathname)) { response.setHeader("Content-Type", url.pathname.endsWith(".css") ? "text/css" : "text/javascript"); response.end(files.get(url.pathname)); return; }
    if (url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/brand/")) {
      const base = resolve(root, "public"), file = resolve(base, "." + url.pathname);
      if (!file.startsWith(base + sep)) { response.writeHead(404); response.end(); return; }
      try { response.setHeader("Content-Type", file.endsWith(".woff2") ? "font/woff2" : "image/svg+xml"); response.end(await readFile(file)); } catch { response.writeHead(404); response.end(); } return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><title>Local module selection fixture</title><link rel="stylesheet" href="/fixture.css"><style>body{--font-instrument:Arial;--font-plex-mono:monospace;background:#050606;color:#fff}.fixture-note{padding:12px 24px;font-size:12px;color:#aaa}.fixture-engine{max-width:640px;margin:40px auto;padding:24px}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}
