import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { build } from "esbuild";

export async function createModuleAuthorProfileServer() {
  const root = process.cwd();
  const fixture = `
    const hash = value => '0x' + value.toString(16).padStart(64, '0');
    export const account = '0x' + 'a'.repeat(40);
    const versions = ['1.0.0', '2.0.0'].map((version,index) => ({packageId:hash(10),familyId:hash(11),manifestHash:hash(20+index),
      title:'Opening rules', description:'Limits trading during the opening window. Each version keeps its reviewed configuration and behavior.',
      version, author:account, category:'trading/opening-rules',sourceReleaseDigests:[hash(100+index)]}));
    const control = {status:'partial',empty:false,fail:false}; window.__moduleAuthorProfileFixture=control;
    const fetchOriginal=window.fetch.bind(window);
    window.fetch=async (input,init)=>{
      const url=new URL(String(input),window.location.origin);
      if(url.pathname!=='/api/profile/modules') return fetchOriginal(input,init);
      if(control.fail) return Response.json({error:'modules_unavailable'},{status:503});
      const items=control.empty?[]:versions;
      return Response.json({schemaVersion:'programmable.module-mode.author-profile.v1',chainId:4663,account,status:control.status,
        releaseDigest:hash(100),releaseDigests:[hash(100),hash(101)],unavailableReleaseDigests:control.status==='partial'?[hash(102)]:[],items,
        page:{number:1,size:12,totalItems:items.length,totalPages:1}});
    };
  `;
  const bundled = await build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ProfileModules} from './components/profile-modules'; import {account} from 'author-profile-fixture'; import './app/globals.css'; import './app/interface.css'; import './app/programmable-experience.css'; import './app/webde-final-ui.css'; createRoot(document.getElementById('root')).render(<main><h1>Contributor profile</h1><ProfileModules account={account}/></main>);`, loader: "tsx", resolveDir: root },
    bundle: true, format: "esm", platform: "browser", write: false, outdir: "/fixture-output", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, external: ["/fonts/*", "/brand/*"],
    plugins: [{ name: "module-author-profile-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(author-profile-fixture|next\/link)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: root, contents: args.path === "author-profile-fixture" ? fixture : `import React from 'react'; export default function Link({prefetch,...props}) { return <a {...props}/>; }` }));
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
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Historical contributor modules fixture</title><link rel="stylesheet" href="/fixture.css"><style>body{background:#050606;color:#fff;font-family:system-ui,sans-serif}main{max-width:1080px;margin:64px auto;padding:16px}h1{font-size:24px;font-weight:500}@media(max-width:650px){main{margin:16px auto}}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}
