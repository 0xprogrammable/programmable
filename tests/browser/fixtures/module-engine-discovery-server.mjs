import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { build } from "esbuild";

/** Real components with synthetic public DTOs and a client parser fixture; no wallet/RPC calls. */
export async function createModuleEngineDiscoveryServer() {
  const root = process.cwd();
  const entry = `
    import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
    import {fixture} from './tests/module-engine-fixture';
    import {computeModuleEngineHostManifestHash} from './lib/module-engine/catalog';
    import {ENGINE_OPERATIONS} from './lib/module-engine/client';
    import {ModuleEngineLibrary} from './components/module-engine-library';
    import {ProfileModules} from './components/profile-modules';
    import {TokenLaunchModules} from './components/token-launch-modules';
    import './app/globals.css'; import './app/interface.css'; import './app/programmable-experience.css'; import './app/webde-final-ui.css';
    const f=fixture(), account='0x'+'a'.repeat(40), hash=n=>'0x'+n.toString(16).padStart(64,'0');
    const first=f.template; first.manifest.manifest.catalogDefinition.title='Quote escrow';
    first.manifest.manifest.catalogDefinition.summary='Deposit a quote asset and withdraw under fixed unlock rules.';
    first.manifestHash=computeModuleEngineHostManifestHash(first.manifest);
    const second=structuredClone(first); second.manifest.manifest.catalogDefinition={...second.manifest.manifest.catalogDefinition,id:'settlement-v1',title:'Conditional payment',interface:'settlement-v1',summary:'Request a payment, fulfill the obligation or recover refundable funds.'};
    second.manifest.manifest.revision.packageId=hash(888); second.manifest.manifest.revision.operationPermissions=[
      {operationId:ENGINE_OPERATIONS.request,authorization:0,inputRoles:2,outputRoles:0},
      {operationId:ENGINE_OPERATIONS.fulfill,authorization:1,inputRoles:0,outputRoles:2},
      {operationId:ENGINE_OPERATIONS.refund,authorization:0,inputRoles:0,outputRoles:2}];
    second.manifestHash=computeModuleEngineHostManifestHash(second.manifest);
    const m=first.manifest.manifest, item={sourceKind:'module-engine-v1',packageId:m.revision.packageId,familyId:m.revision.familyId,
      manifestHash:first.manifestHash,title:'Quote escrow',description:'Deposit a quote asset and withdraw under the published unlock rules.',version:'1.0.0',author:account,category:'experiments',
      engine:{interface:'escrow-v1',operations:m.revision.operationPermissions},sourceReleaseDigests:[f.release.releaseDigest]};
    window.__moduleEngineDetailsRequests=[];
    const original=window.fetch.bind(window); window.fetch=async(input,init)=>{
      const url=new URL(String(input),location.origin);
      if(url.pathname==='/api/profile/modules') return Response.json({schemaVersion:'programmable.module-mode.author-profile.v1',chainId:4663,account,status:'ready',releaseDigest:f.release.releaseDigest,
        releaseDigests:[f.release.releaseDigest],unavailableReleaseDigests:[],items:[item],page:{number:1,size:12,totalItems:1,totalPages:1}});
      if(url.pathname==='/api/module-mode/details'){window.__moduleEngineDetailsRequests.push(url.search);return Response.json({sourceKind:'module-engine-v1',releaseDigest:f.release.releaseDigest,items:[item]});}
      return original(input,init);
    };
    function App(){const[selected,setSelected]=useState(first.manifest.manifest.catalogDefinition.id);return <main>
      <h1>Module interface fixture</h1><section aria-label="Template selection"><h2>Choose a template</h2><ModuleEngineLibrary templates={[first,second]} selectedId={selected} onSelect={t=>setSelected(t.manifest.manifest.catalogDefinition.id)}/></section>
      <section aria-label="Contributor publications"><h2>Contributor profile</h2><ProfileModules account={account}/></section>
      <section aria-label="Coin publication"><h2>Coin details</h2><TokenLaunchModules launch={{sourceKind:'module-engine-v1',sourceReleaseDigest:f.release.releaseDigest,modulePackageIds:[item.packageId],moduleFamilyIds:[item.familyId]}}/></section>
    </main>};createRoot(document.getElementById('root')).render(<App/>);
  `;
  const bundled = await build({ stdin: { contents: entry, loader: "tsx", resolveDir: root }, bundle: true, format: "esm", platform: "browser", write: false,
    outdir: "/fixture-output", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, external: ["/fonts/*", "/brand/*"],
    plugins: [{ name: "engine-discovery-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(vitest|next\/link)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: root,
        contents: args.path === "vitest" ? `export const vi={fn:(implementation=()=>undefined)=>implementation};` : `import React from 'react';export default function Link({prefetch,...props}){return <a {...props}/>}` }));
    } }],
  });
  const sources = new Map(bundled.outputFiles.map(file => [file.path.endsWith(".css") ? "/fixture.css" : "/fixture.js", file.contents]));
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (sources.has(url.pathname)) { response.setHeader("Content-Type", url.pathname.endsWith(".css") ? "text/css" : "text/javascript"); response.end(sources.get(url.pathname)); return; }
    if (url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/brand/")) {
      const base = resolve(root, "public"), file = resolve(base, "." + url.pathname);
      if (!file.startsWith(base + sep)) { response.writeHead(404); response.end(); return; }
      try { response.setHeader("Content-Type", file.endsWith(".woff2") ? "font/woff2" : "image/svg+xml"); response.end(await readFile(file)); } catch { response.writeHead(404); response.end(); } return;
    }
    response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Module interface fixture</title><link rel="stylesheet" href="/fixture.css"><style>body{background:#050606;color:#fff;font-family:system-ui,sans-serif}main{max-width:1000px;margin:48px auto;padding:16px}main>section{margin-top:40px}h1{font-size:24px;font-weight:500}h2{font-size:20px;font-weight:500}@media(max-width:650px){main{margin:16px auto}}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}
