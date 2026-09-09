import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

// Render the production launch components with synthetic public and owner data.
// No identity, signing, account mutation or provider call is available here.
export async function createProfileLaunchPaginationServer() {
  const root = process.cwd();
  // Reuse the fonts compiled by the normal local Next flow when it has run.
  const fontCss = await readFile(resolve(root, ".next/dev/static/css/app/layout.css"), "utf8")
    .then(css => (css.match(/@font-face\s*\{[^}]*\}/g) ?? []).join("\n")).catch(() => "");
  const state = `
    import React, {createContext, useContext, useState} from 'react';
    const Context = createContext(null);
    const address = value => '0x' + value.toString(16).padStart(40, '0');
    const hash = value => '0x' + value.toString(16).padStart(64, '0');
    const initial = {account:'0x'+'a'.repeat(40), view:'robinhood', totalItems:11, failPage:0, fail:false, delay:0, status:'ready'};
    const control = {...initial, requests:[], configure:()=>{}};
    window.__profileLaunchPaginationFixture = control;
    const accessToken = async () => 'synthetic-local-fixture';
    const identityToken = async () => null;
    function rows(account, total) {
      return Array.from({length:total}, (_,index) => {
        const id = total-index;
        return {launchId:hash(id), tokenAddress:address(id), creator:account,
          name:'Sample launch '+String(id).padStart(2,'0'), symbol:'S'+id,
          launchedAt:'2026-09-08T12:00:00.000Z'};
      });
    }
    function projects(account, total) {
      return rows(account,total).map(row => ({chainId:1, tokenAddress:row.tokenAddress,
        name:row.name,symbol:row.symbol,imageUrl:'/brand/loop/programmable-module-token-default-v1.png',
        source:'canonical-launch-stamp-router',article:null}));
    }
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(String(input),window.location.origin);
      const paths = ['/api/profile/robinhood','/api/profile/projects','/api/explore/robinhood/presentation'];
      if (!paths.includes(url.pathname)) return originalFetch(input,init);
      const account = url.searchParams.get('account') || control.account;
      const requested = Number(url.searchParams.get('page') || '1');
      const pageSize = url.searchParams.get('pageSize') ?? '50';
      if(pageSize !== '5' && pageSize !== '50') return Response.json({error:'invalid_query'},{status:400});
      const size = Number(pageSize);
      control.requests.push({path:url.pathname,account,page:requested,pageSize:size});
      if(control.delay) await new Promise(resolve => setTimeout(resolve,control.delay));
      if(init?.signal?.aborted) throw new DOMException('Aborted','AbortError');
      if(control.fail || (url.pathname === '/api/profile/robinhood' && requested === control.failPage)) {
        return Response.json({error:'fixture_unavailable'},{status:503});
      }
      const totalItems = control.totalItems;
      const totalPages = Math.ceil(totalItems/size);
      const number = Math.max(1,Math.min(requested,totalPages));
      const items = rows(account,totalItems).slice((number-1)*size,number*size);
      if(url.pathname === '/api/profile/projects') return Response.json({schemaVersion:'programmable.creator-project-list.v1',projects:projects(account,totalItems)});
      if(url.pathname === '/api/explore/robinhood/presentation') return Response.json({items:items.map(row => ({
        tokenAddress:row.tokenAddress, imageUrl:'/brand/loop/programmable-module-token-default-v1.png',
        description:null,links:[],market:null
      }))});
      return Response.json({chainId:4663,account,status:control.status,updatedAt:new Date().toISOString(),items,
        page:{number,size,totalItems,totalPages,hasMore:number<totalPages}});
    };
    export function FixtureProvider({children}) {
      const [value,setValue] = useState(initial);
      control.configure = patch => {Object.assign(control,patch);setValue(current => ({...current,...patch}));};
      return <Context.Provider value={{...value,projects:projects(value.account,value.totalItems),
        entries:rows(value.account,value.totalItems).map(row => ({token:{address:row.tokenAddress,name:row.name,
          symbol:row.symbol,launchedAt:row.launchedAt,href:'/token/'+row.tokenAddress,launchModel:'classic',
          imageUrl:'/brand/loop/programmable-module-token-default-v1.png'}})),
        wallet:{account:value.account},getAccessToken:accessToken,getIdentityToken:identityToken}}>{children}</Context.Provider>;
    }
    export const useFixture = () => useContext(Context);
    export const useWallet = useFixture;
  `;
  const bundled = await build({
    stdin: { contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {RobinhoodProfileLaunches} from './components/robinhood-profile-launches';
      import {ProfileProjects} from './components/profile-projects';
      import {ProfileRouterLaunches} from './components/profile-view';
      import {ProfileChainSelector} from './components/profile-chain-selector';
      import {FixtureProvider,useFixture} from 'fixture-state';
      import styles from './components/profile-experience.module.css';
      import './app/globals.css'; import './app/programmable-experience.css'; import './app/interface.css'; import './app/webde-final-ui.css';
      function Fixture() {
        const state=useFixture(); const configure=window.__profileLaunchPaginationFixture.configure;
        return <main className={styles.page+' page-width'}><h1>Creator profile</h1>
          <p className="fixture-note">Synthetic launches for local pagination QA.</p>
          <ProfileChainSelector value={state.view==='robinhood'?4663:1} onChange={chain=>configure({view:chain===4663?'robinhood':'public-ethereum'})}/>
          {state.view==='robinhood'?<RobinhoodProfileLaunches account={state.account}/>:state.view==='owner-ethereum'
            ?<ProfileProjects key={state.account} walletProjects={state.projects}/>
            :<ProfileRouterLaunches key={state.account} entries={state.entries}/>}
          <details className="fixture-controls"><summary>Fixture controls</summary>
            <button onClick={()=>configure({view:'owner-ethereum'})}>Owner Ethereum</button>
            <button onClick={()=>configure({view:'public-ethereum'})}>Public Ethereum</button>
            <button onClick={()=>configure({account:'0x'+'b'.repeat(40)})}>Switch sample account</button>
          </details>
        </main>;
      }
      createRoot(document.getElementById('root')).render(<FixtureProvider><Fixture/></FixtureProvider>);
    `, loader: "tsx", resolveDir: root },
    bundle: true, format: "esm", platform: "browser", write: false,
    outdir: "/fixture-output", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"', "process.env": "{}" },
    external: ["/brand/*", "/fonts/*"],
    plugins: [{ name: "profile-pagination-fixture", setup(plugin) {
      plugin.onResolve({ filter: /^(fixture-state|@\/components\/wallet-provider)$/ }, () => ({ path: "state", namespace: "fixture" }));
      plugin.onResolve({ filter: /^next\/(navigation|link|image|dynamic)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      plugin.onResolve({ filter: /creator-article-editor$/ }, () => ({ path: "editor", namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ loader: "tsx", resolveDir: root,
        contents: args.path === "state" ? state : args.path === "next/navigation"
          ? "export const useSearchParams=()=>new URLSearchParams(window.location.search);"
          : args.path === "next/link" ? "import React from 'react'; export default function Link({prefetch,...props}) { return <a {...props}/>; }"
          : args.path === "next/image" ? "import React from 'react'; export default function Image({priority,fill,unoptimized,style,...props}) { return <img {...props} style={fill?{position:'absolute',inset:0,width:'100%',height:'100%',...style}:style}/>; }"
          : "export default function Empty(){return null;}",
      }));
    } }],
  });
  const sources = new Map(bundled.outputFiles.map(file => [file.path.endsWith(".css") ? "/fixture.css" : "/fixture.js", file.contents]));
  sources.set("/fixture-fonts.css", fontCss);
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (sources.has(url.pathname)) { response.setHeader("Content-Type", url.pathname.endsWith(".css") ? "text/css" : "text/javascript"); response.end(sources.get(url.pathname)); return; }
    if (url.pathname.startsWith("/_next/static/media/")) {
      const base = resolve(root, ".next/dev/static/media"), file = resolve(base, url.pathname.slice("/_next/static/media/".length));
      if (!file.startsWith(base + sep) || !file.endsWith(".woff2")) { response.writeHead(404); response.end(); return; }
      try { response.setHeader("Content-Type", "font/woff2"); response.end(await readFile(file)); }
      catch { response.writeHead(404); response.end(); } return;
    }
    if (url.pathname.startsWith("/fonts/") || url.pathname.startsWith("/brand/")) {
      const base = resolve(root, "public"), file = resolve(base, "." + url.pathname);
      if (!file.startsWith(base + sep)) { response.writeHead(404); response.end(); return; }
      try { response.setHeader("Content-Type", file.endsWith(".woff2") ? "font/woff2" : file.endsWith(".png") ? "image/png" : "image/svg+xml"); response.end(await readFile(file)); }
      catch { response.writeHead(404); response.end(); } return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html lang="en" data-theme="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Profile launches pagination fixture</title><link rel="stylesheet" href="/fixture.css"><link rel="stylesheet" href="/fixture-fonts.css"><style>:root{--font-instrument:"Instrument Sans",Arial,sans-serif;--font-plex-mono:"IBM Plex Mono",monospace}main{margin-inline:auto}h1{font-size:24px;font-weight:500}.fixture-note,.fixture-controls{color:var(--webde-muted);font-size:14px}.fixture-controls{margin-top:24px}.fixture-controls button{min-height:44px;padding:12px}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = await createProfileLaunchPaginationServer();
  server.listen(Number(process.env.PROFILE_PAGINATION_PORT || 3158), "127.0.0.1", () => {
    console.log(`Profile pagination fixture: http://127.0.0.1:${server.address().port}`);
  });
}
