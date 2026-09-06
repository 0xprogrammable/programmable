#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPlan, hash, need } from './core.mjs';
import { exactJson } from './source-readback.mjs';
import { REPOSITORY_ROOT, sealBuild } from './build.mjs';
import { assertSourceAuthority } from './authority.mjs';
import { reviewedProviders, prepareWalletRequest, revalidateWalletRequest, observeReceipt } from './rpc.mjs';
import { armJournal, journalDirectory, journalEntry, recordTransaction, recordReceipt } from './journal.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
export function sameOrigin(req, origin, token) {
  need(req.headers.host === new URL(origin).host, 'Unexpected Host');
  need(req.headers.origin === origin && req.headers['x-module-operator-token'] === token, 'Same-origin operator authorization required');
  need(!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin', 'Cross-site request rejected');
}
async function body(req) { let total = 0; const chunks = []; for await (const chunk of req) { total += chunk.length; need(total <= 4096, 'Request exceeds size limit'); chunks.push(chunk); } return exactJson(total ? Buffer.concat(chunks) : Buffer.from('{}'), 'Operator request'); }
function secureHeaders(nonce) { return { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self'; connect-src 'self'; font-src 'self'; img-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
  'cross-origin-opener-policy': 'same-origin', 'cross-origin-resource-policy': 'same-origin' }; }
export async function startOperator(options) {
  const { plan, stepIndex, uiCheck = false } = options; const step = plan.steps[stepIndex]; need(step, 'Unknown deployment step');
  let providers, authority;
  if (!uiCheck) {
    const freshBuild = await sealBuild(); assertPlan(plan, freshBuild);
    await journalDirectory(options.journal); providers = await reviewedProviders();
    authority = await assertSourceAuthority(plan, options.reviewedPlanDigest, options.runId, options.runAttempt);
  }
  const token = randomBytes(24).toString('hex'), nonce = randomBytes(18).toString('base64'); let prepared = null, busy = false;
  const origin = `http://127.0.0.1:${options.port}`;
  const server = createServer(async (req, res) => {
    const headers = secureHeaders(nonce); const reply = (code, value) => { res.writeHead(code, { ...headers, 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      need(req.headers.host === new URL(origin).host, 'Unexpected Host');
      if (req.method === 'GET' && req.url === '/favicon.ico') { res.writeHead(204, headers); res.end(); return; }
      if (req.method === 'GET' && req.url === '/') {
        let html = await readFile(path.join(directory, 'operator.html'), 'utf8'); html = html.replaceAll('__NONCE__', nonce).replace('__TOKEN__', token);
        res.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' }); res.end(html); return;
      }
      if (req.method === 'GET' && ['/operator.css', '/operator.js'].includes(req.url)) {
        const content = await readFile(path.join(directory, req.url.slice(1))); res.writeHead(200, { ...headers, 'content-type': req.url.endsWith('.css') ? 'text/css' : 'text/javascript' }); res.end(content); return;
      }
      if (req.method === 'GET' && req.url === '/geist.woff2') {
        const font = await readFile(path.join(REPOSITORY_ROOT, 'node_modules/next/dist/next-devtools/server/font/geist-latin.woff2')); res.writeHead(200, { ...headers, 'content-type': 'font/woff2' }); res.end(font); return;
      }
      need(req.method === 'POST', 'Unsupported method'); sameOrigin(req, origin, token); const input = await body(req);
      if (req.url === '/state') {
        const entry = uiCheck ? null : await journalEntry(options.journal, plan.planDigest, stepIndex);
        reply(200, { uiCheck, chainId: 4663, planDigest: plan.planDigest, sourceCommit: plan.sourceCommit, stepIndex, totalSteps: plan.steps.length,
          role: step.role, target: step.target, transactionRecipient: step.to, owner: step.sender, value: step.value, parameters: plan.parameters, economics: plan.economics,
          constructorInputs: step.constructorInputs, constructorValues: step.constructorValues, initcodeHash: step.initcodeHash,
          initcodeBytes: step.initcodeBytes, runtime: { ...plan.contracts[step.role], runtime: undefined },
          ceilings: options.ceilings ?? null, authority: authority ?? null, journalState: entry ? entry.transactionHash ? 'transaction-recorded' : 'outcome-unknown' : 'not-requested', transactionHash: entry?.transactionHash ?? null }); return;
      }
      need(!uiCheck, 'UI-check mode cannot access providers, wallets or the journal'); need(!busy, 'Another operator action is running'); busy = true;
      try {
        if (req.url === '/prepare') {
          need(!await journalEntry(options.journal, plan.planDigest, stepIndex), 'This step was already handed to a wallet; reconcile its outcome instead of retrying');
          authority = await assertSourceAuthority(plan, options.reviewedPlanDigest, options.runId, options.runAttempt);
          prepared = await prepareWalletRequest(plan, stepIndex, providers, options.ceilings);
          reply(200, prepared); return;
        }
        if (req.url === '/arm') {
          need(prepared && input.requestDigest === prepared.requestDigest, 'Prepared request digest differs');
          authority = await assertSourceAuthority(plan, options.reviewedPlanDigest, options.runId, options.runAttempt);
          await revalidateWalletRequest(plan, prepared, providers, options.ceilings); await armJournal(options.journal, prepared, authority);
          reply(200, { request: prepared.request, requestDigest: prepared.requestDigest }); prepared = null; return;
        }
        if (req.url === '/record') {
          hash(input.transactionHash); const entry = await recordTransaction(options.journal, plan.planDigest, stepIndex, input.transactionHash.toLowerCase());
          reply(200, { recorded: true, transactionHash: entry.transactionHash }); return;
        }
        if (req.url === '/receipt') {
          const entry = await journalEntry(options.journal, plan.planDigest, stepIndex); need(entry?.transactionHash, 'Record the transaction hash first');
          const evidence = await observeReceipt(plan, entry, providers); if (evidence.status === 'included-code-verified-unfinalized') await recordReceipt(options.journal, plan.planDigest, stepIndex, evidence);
          reply(200, evidence); return;
        }
        throw new Error('Unknown operator action');
      } finally { busy = false; }
    } catch (error) { reply(400, { error: error.message }); }
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port, '127.0.0.1', resolve); });
  return { server, url: origin, uiCheck };
}
async function main(argv) {
  const options = { port: 8787, stepIndex: 0, uiCheck: false, ceilings: {} }; let planFile;
  const valued = { '--step': 'stepIndex', '--port': 'port', '--journal': 'journal', '--reviewed-plan-digest': 'reviewedPlanDigest', '--verify-run-id': 'runId', '--verify-run-attempt': 'runAttempt' };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--ui-check') options.uiCheck = true;
    else if (key === '--plan') planFile = argv[++i];
    else if (key === '--max-gas') options.ceilings.maxGas = argv[++i];
    else if (key === '--max-fee-per-gas-wei') options.ceilings.maxFeePerGas = argv[++i];
    else if (key === '--priority-fee-per-gas-wei') options.ceilings.maxPriorityFeePerGas = argv[++i];
    else if (valued[key]) options[valued[key]] = argv[++i];
    else throw new Error(`Unsupported option: ${key.split('=')[0]}`);
  }
  for (const key of ['stepIndex', 'port', 'runId', 'runAttempt']) if (options[key] !== undefined) options[key] = Number(options[key]);
  need(planFile && Number.isSafeInteger(options.port) && options.port > 1024 && options.port < 65536 && Number.isSafeInteger(options.stepIndex), 'Valid plan, step and local port required');
  options.plan = exactJson(await readFile(planFile), 'Deployment plan'); const result = await startOperator(options);
  console.log(`${result.url} (${options.uiCheck ? 'UI check: wallet and RPC disabled' : 'owner-controlled wallet handoff'})`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
