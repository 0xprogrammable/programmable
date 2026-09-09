import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { build } from "esbuild";

export async function createWalletSessionServer() {
  const root = process.cwd();
  const runtime = resolve(root, "tests/browser/fixtures/wallet-session-runtime.tsx");
  const bundled = await build({
    stdin: {
      contents: `
        import React, {useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {WalletProvider, WalletButton, useWallet} from './components/wallet-provider';
        import {SiteHeader} from './components/site-navigation';
        import {FixtureControls} from './tests/browser/fixtures/wallet-session-runtime';
        import './app/globals.css';
        import './app/interface.css';
        import './app/programmable-experience.css';
        import './app/webde-final-ui.css';
        function Consumer() {
          const value = useWallet();
          const [networkResults, setNetworkResults] = useState([]);
          const switchNetwork = () => {
            void value.switchNetwork('1').then(
              result => setNetworkResults(previous => [...previous, result]),
              () => setNetworkResults(previous => [...previous, 'rejected']),
            );
          };
          return <main>
            <h1>{location.pathname === '/profile' ? 'Profile' : 'API keys'} wallet session regression</h1>
            <section aria-label="Inline wallet controls"><WalletButton/></section>
            <output aria-label="Selected account">{value.wallet?.account ?? 'none'}</output>
            <output aria-label="Selected wallet network">{value.wallet?.chainId ?? 'none'}</output>
            <output aria-label="Wallet linked">{String(value.walletLinked)}</output>
            <output aria-label="Session authenticated">{String(value.authenticated)}</output>
            <output aria-label="Session ready">{String(value.sessionReady)}</output>
            <output aria-label="Wallet opening">{String(value.openingWallet)}</output>
            <output aria-label="Wallet busy">{String(value.connecting)}</output>
            <output aria-label="Network switch busy">{String(value.switchingNetwork)}</output>
            <output aria-label="Network switch results">{JSON.stringify(networkResults)}</output>
            <button onClick={value.openWallet}>Open account</button>
            <button onClick={switchNetwork}>Request Ethereum wallet network</button>
            <button onClick={() => void value.disconnect({showDialogOnFailure:false})}>Sign out of app</button>
            <FixtureControls/>
          </main>;
        }
        createRoot(document.getElementById('root')).render(<WalletProvider><SiteHeader/><Consumer/></WalletProvider>);
      `,
      loader: "tsx", resolveDir: root,
    },
    bundle: true, format: "esm", platform: "browser", write: false,
    outdir: "/fixture-output", jsx: "automatic",
    define: {
      "process.env.NODE_ENV": '"production"',
      "process.env.NEXT_PUBLIC_PRIVY_APP_ID": '"wallet-session-test-only"',
      "process.env.NEXT_PUBLIC_PROGRAMMABLE_ONCHAIN_NETWORK": '"mainnet"',
    },
    external: ["/brand/*", "/fonts/*"],
    plugins: [{ name: "wallet-session-boundaries", setup(plugin) {
      plugin.onResolve({ filter: /^\.\/wallet-provider-runtime$/ }, () => ({ path: runtime }));
      plugin.onResolve({ filter: /^next\/(navigation|link|image)$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
      plugin.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
        loader: "tsx", resolveDir: root,
        contents: args.path === "next/navigation"
          ? `export const usePathname=()=>window.location.pathname; const router={prefetch:()=>{},push:(url)=>window.history.pushState(null,'',url),replace:(url)=>window.history.replaceState(null,'',url)}; export const useRouter=()=>router;`
          : args.path === "next/link"
            ? `import React from 'react'; export default function Link({prefetch,...props}) { return <a {...props}/>; }`
            : `import React from 'react'; export default function Image({priority,fill,...props}) { return <img {...props}/>; }`,
      }));
    } }],
  });
  const sources = new Map(bundled.outputFiles.map((file) => [file.path.endsWith(".css") ? "/fixture.css" : "/fixture.js", file.contents]));
  return createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
    if (sources.has(url.pathname)) {
      response.setHeader("Content-Type", url.pathname.endsWith(".css") ? "text/css" : "text/javascript");
      response.end(sources.get(url.pathname)); return;
    }
    if (url.pathname.startsWith("/brand/") || url.pathname.startsWith("/fonts/")) {
      const base = resolve(root, "public");
      const file = resolve(base, "." + url.pathname);
      if (!file.startsWith(base + sep)) { response.writeHead(404); response.end(); return; }
      try {
        response.setHeader("Content-Type", file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".woff2") ? "font/woff2" : "image/png");
        response.end(await readFile(file));
      } catch { response.writeHead(404); response.end(); }
      return;
    }
    if (!["/profile", "/developers/api-keys"].includes(url.pathname)) {
      response.writeHead(404); response.end(); return;
    }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{background:#111;color:#fff;font-family:Arial,sans-serif}main{padding:24px}main output{display:block;margin:8px 0}main button,main select{padding:10px;margin:5px}section[aria-label="SDK fixture controls"]{margin-top:24px}section[aria-label="SDK wallet dialog"]{position:fixed;inset:25% 15%;z-index:10000;background:#222;padding:24px}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}
