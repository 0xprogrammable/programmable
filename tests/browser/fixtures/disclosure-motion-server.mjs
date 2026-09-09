import { createServer } from "node:http";
import { build } from "esbuild";

export async function createDisclosureMotionServer() {
  const bundle = await build({ entryPoints: ["tests/browser/fixtures/disclosure-motion.tsx"], bundle: true, format: "esm", platform: "browser", write: false, outdir: "/fixture-output", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  const files = new Map(bundle.outputFiles.map(file => [file.path.endsWith(".css") ? "/fixture.css" : "/fixture.js", file.contents]));
  return createServer((request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (files.has(url.pathname)) { response.setHeader("Content-Type", url.pathname.endsWith(".css") ? "text/css" : "text/javascript"); response.end(files.get(url.pathname)); return; }
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/fixture.css"><title>Disclosure fixture</title><style>*{box-sizing:border-box}body{margin:0;background:#171717;color:#f5f3ef;font:16px/1.5 Arial}main{max-width:640px;padding:24px;margin:auto}button,summary{min-height:48px;cursor:pointer}button{display:block;margin-block:12px}summary{padding:12px;border:1px solid #777;list-style:none}.body{padding:20px;min-height:180px}label{display:block}input,textarea,select{display:block;max-width:100%;min-height:44px}a{color:inherit}summary:focus-visible,button:focus-visible{outline:2px solid #e786b2;outline-offset:3px}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
}
