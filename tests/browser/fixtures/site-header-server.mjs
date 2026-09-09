import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { build } from "esbuild";

// Exercise the production header with deterministic wallet outcomes, without
// connecting, signing, or sending requests to a real wallet.
export async function createSiteHeaderServer() {
  const root = process.cwd();
  const state = `
    import React, {createContext, useContext, useState} from 'react';
    const Context = createContext(null);
    export function Fixture({children, selector}) {
      const [wallet, setWallet] = useState({account:'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', chainId:'0x1'});
      const [viewChainId, setViewChainId] = useState(1);
      const [pending, setPending] = useState(false);
      const [disconnecting, setDisconnecting] = useState(false);
      const [hydrating, setHydrating] = useState(false);
      const [reject, setReject] = useState(false);
      const [failDisconnect, setFailDisconnect] = useState(false);
      const [requests, setRequests] = useState([]);
      const [dialog, setDialog] = useState(false);
      const [disconnectOptions, setDisconnectOptions] = useState('');
      const value = {
        wallet: hydrating ? null : wallet,
        authReady:!hydrating, sessionReady:!hydrating, openingWallet:false,
        hasSession:!!wallet, connecting:hydrating,
        disconnecting, switchingNetwork:pending, preloadWallet:()=>{},
        openWallet:()=>setDialog(true),
        switchNetwork:async (chain) => {
          setRequests(previous=>[...previous, chain]); setPending(true);
          await new Promise(resolve=>setTimeout(resolve,250));
          setPending(false);
          if(reject) return false;
          setWallet(current=>current && {...current, chainId:'0x'+Number(chain).toString(16)});
          return true;
        },
        disconnect:async (options) => {
          setDisconnectOptions(JSON.stringify(options));
          setDisconnecting(true);
          await new Promise(resolve=>setTimeout(resolve,250));
          setDisconnecting(false);
          if(failDisconnect) return false;
          setWallet(null); return true;
        },
        hydrated:true, viewChainId, setViewChainId,
      };
      return <Context.Provider value={value}>{children}<main style={{padding:24}}>
        <h1>Header interaction fixture</h1><p>Deterministic test wallet. No real wallet requests.</p>
        {selector}
        <button aria-pressed={reject} onClick={()=>setReject(!reject)}>Reject network switch</button>
        <button aria-pressed={failDisconnect} onClick={()=>setFailDisconnect(!failDisconnect)}>Fail disconnect</button>
        <button onClick={()=>setWallet(null)}>Use anonymous session</button>
        <button aria-pressed={hydrating} onClick={()=>setHydrating(!hydrating)}>Toggle wallet hydration</button>
        <p data-testid="requests">{requests.join(',')}</p>
        <p data-testid="view-chain">{viewChainId}</p>
        <p data-testid="wallet-chain">{wallet?.chainId ?? 'disconnected'}</p>
        <p data-testid="disconnect-options">{disconnectOptions}</p>
        <a href="#outside">Outside control</a>
        {dialog ? <div role="dialog" aria-label="Connect wallet fixture">Connect wallet fixture</div> : null}
      </main></Context.Provider>;
    }
    export const useWallet = () => useContext(Context);
    export const useViewChain = () => useContext(Context);
  `;
  const bundled = await build({
    stdin: {
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {ExploreChainSelector} from './components/explore-chain-selector'; import {SiteHeader} from './components/site-navigation'; import {Fixture} from 'fixture-state'; import './app/globals.css'; import './app/programmable-experience.css'; import './app/interface.css'; import './app/webde-final-ui.css'; createRoot(document.getElementById('root')).render(<Fixture selector={<ExploreChainSelector/>}><SiteHeader/></Fixture>);`,
      loader: "tsx", resolveDir: root,
    },
    bundle: true, format: "esm", platform: "browser", write: false,
    outdir: "/fixture-output", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
    external: ["/brand/*", "/fonts/*"],
    plugins: [{ name: "wallet-fixture", setup(plugin) {
      plugin.onResolve({filter:/^(fixture-state|@\/components\/(wallet-provider|view-chain))$/},()=>({path:"state",namespace:"fixture"}));
      plugin.onResolve({filter:/^next\/(navigation|link|image)$/}, args=>({path:args.path,namespace:"fixture"}));
      plugin.onLoad({filter:/.*/,namespace:"fixture"}, args=>({
        loader:"tsx", resolveDir:root,
        contents: args.path === "state" ? state : args.path === "next/navigation"
          ? `export const usePathname=()=>window.location.pathname; const router={prefetch:()=>{},push:(url)=>window.history.pushState(null,'',url),replace:(url)=>window.history.replaceState(null,'',url)}; export const useRouter=()=>router;`
          : args.path === "next/link"
            ? `import React from 'react'; export default function Link({prefetch,...props}) { return <a {...props}/>; }`
            : `import React from 'react'; export default function Image({priority,fill,...props}) { return <img {...props}/>; }`,
      }));
    }}],
  });
  const sources = new Map(bundled.outputFiles.map(file=>[file.path.endsWith('.css') ? '/fixture.css':'/fixture.js',file.contents]));
  return createServer(async (request,response)=>{
    const url = new URL(request.url, 'http://localhost');
    if(sources.has(url.pathname)) {
      response.setHeader('Content-Type',url.pathname.endsWith('.css')?'text/css':'text/javascript');
      response.end(sources.get(url.pathname)); return;
    }
    if(url.pathname.startsWith('/brand/') || url.pathname.startsWith('/fonts/')) {
      const base=resolve(root,'public'); const file=resolve(base,'.'+url.pathname);
      if(!file.startsWith(base+sep)) {response.writeHead(404);response.end();return;}
      try {response.setHeader('Content-Type',file.endsWith('.svg')?'image/svg+xml':file.endsWith('.woff2')?'font/woff2':'image/png');response.end(await readFile(file));}
      catch {response.writeHead(404);response.end();} return;
    }
    response.setHeader('Content-Type','text/html');
    response.end('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{background:#000;color:#fff;font-family:Arial,sans-serif}main label{display:block;margin:16px 0}main button{padding:12px}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}
