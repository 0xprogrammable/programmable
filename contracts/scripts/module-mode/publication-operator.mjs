#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hash, need } from './core.mjs';
import { REPOSITORY_ROOT } from './build.mjs';
import { assertSourceAuthority } from './authority.mjs';
import { sameOrigin } from './operator.mjs';
import { exactJson } from './source-readback.mjs';
import { armJournal, armRetryJournal, journalDirectory, journalEntry, recordTransaction, recordReceipt, retryJournalEntry } from './journal.mjs';
import { reviewedProviders } from './rpc.mjs';
import { PUBLICATION_PLAN_SCHEMA, assertPublicationPlan, assertAuthenticatedOperationPlan, readOperatorJson } from './publication-plan.mjs';
import { LIFECYCLE_OPERATOR_SCHEMA, assertLifecyclePlan } from './lifecycle-plan.mjs';
import { preparePublicationRequest, preparePublicationRetry, revalidatePublicationRequest, observePublicationReceipt, observePublicationOperation } from './publication-rpc.mjs';
const directory = path.dirname(fileURLToPath(import.meta.url));
export async function assertOperationPlan(plan) {
  if (plan.schemaVersion === PUBLICATION_PLAN_SCHEMA) return assertPublicationPlan(plan);
  if (plan.schemaVersion === LIFECYCLE_OPERATOR_SCHEMA) return assertLifecyclePlan(plan);
  throw new Error('Unknown module publication or lifecycle operation plan');
}
async function body(req) { let size = 0; const chunks = []; for await (const chunk of req) { size += chunk.length; need(size <= 4096, 'Request exceeds limit'); chunks.push(chunk); } return exactJson(size ? Buffer.concat(chunks) : Buffer.from('{}'), 'Operator request'); }
function headers(nonce) { return { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
  'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
  'cross-origin-opener-policy': 'same-origin', 'cross-origin-resource-policy': 'same-origin' }; }
export async function startPublicationOperator(options) {
  const { plan, stepIndex = 0, uiCheck = false } = options; await assertOperationPlan(plan); const step = plan.steps[stepIndex]; need(step, 'Unknown operation step');
  need(Number.isSafeInteger(options.port) && options.port > 1024 && options.port < 65536, 'Valid loopback port required');
  need(Boolean(options.retryAttempt) === Boolean(options.reviewedRequestDigest), 'Retry attempt and original reviewed request digest are both required');
  if (options.retryAttempt) need(Number.isSafeInteger(options.retryAttempt) && options.retryAttempt > 0, 'Positive retry attempt required');
  let providers, authority;
  const refreshAuthority = async () => { await assertOperationPlan(plan); const proof = await assertSourceAuthority(plan, options.reviewedPlanDigest, options.runId, options.runAttempt); await assertAuthenticatedOperationPlan(plan, options.sessionFile); return proof; };
  if (!uiCheck) { need(plan.sourceClean === true && plan.planDigest === options.reviewedPlanDigest, 'Exact reviewed clean-source operation plan required'); await journalDirectory(options.journal); providers = await reviewedProviders(); authority = await refreshAuthority(); }
  const token = randomBytes(24).toString('hex'), nonce = randomBytes(18).toString('base64'), origin = `http://127.0.0.1:${options.port}`;
  let prepared = null, busy = false;
  async function predecessors() {
    for (let i = 0; i < stepIndex; i++) {
      const entry = await journalEntry(options.journal, plan.planDigest, i); need(entry?.transactionHash, 'Earlier operation must have its actual transaction recorded');
      const evidence = await observePublicationReceipt(plan, entry, providers); need(evidence.status === 'included-code-verified-unfinalized', 'Earlier operation is not verified');
    }
  }
  const server = createServer(async (req, res) => {
    const secure = headers(nonce), reply = (code, value) => { res.writeHead(code, { ...secure, 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      need(req.headers.host === new URL(origin).host, 'Unexpected Host');
      if (req.method === 'GET' && req.url === '/') { const html = (await readFile(path.join(directory, 'publication-operator.html'), 'utf8')).replaceAll('__NONCE__', nonce).replace('__TOKEN__', token); res.writeHead(200, { ...secure, 'content-type': 'text/html; charset=utf-8' }); res.end(html); return; }
      if (req.method === 'GET' && ['/publication-operator.js', '/operator.css'].includes(req.url)) { res.writeHead(200, { ...secure, 'content-type': req.url.endsWith('.css') ? 'text/css' : 'text/javascript' }); res.end(await readFile(path.join(directory, req.url.slice(1)))); return; }
      if (req.method === 'GET' && req.url === '/geist.woff2') { res.writeHead(200, { ...secure, 'content-type': 'font/woff2' }); res.end(await readFile(path.join(REPOSITORY_ROOT, 'node_modules/next/dist/next-devtools/server/font/geist-latin.woff2'))); return; }
      if (req.method === 'GET' && req.url === '/favicon.ico') { res.writeHead(204, secure); res.end(); return; }
      need(req.method === 'POST', 'Unsupported method'); sameOrigin(req, origin, token); const input = await body(req);
      if (req.url === '/state') {
        const entry = uiCheck ? null : await journalEntry(options.journal, plan.planDigest, stepIndex);
        const retry = !uiCheck && options.retryAttempt ? await retryJournalEntry(options.journal, plan.planDigest, stepIndex, options.retryAttempt) : null;
        reply(200, { uiCheck, owner: plan.owner, chainId: 4663, sourceCommit: plan.sourceCommit, contractSourceCommit: plan.identity.sourceCommit, releaseDigest: plan.identity.releaseDigest,
          planDigest: plan.planDigest, stepIndex, totalSteps: plan.steps.length, step, ceilings: options.ceilings ?? null, authority: authority ?? null, actionInProgress: busy,
          canRetry: Boolean(options.retryAttempt && entry && !entry.transactionHash && !retry && entry.requestDigest === options.reviewedRequestDigest),
          journalState: entry ? entry.transactionHash ? 'transaction-recorded' : 'outcome-unknown' : 'not-requested', transactionHash: entry?.transactionHash ?? null }); return;
      }
      need(!uiCheck, 'UI-check mode cannot access providers, wallets or the journal'); need(!busy, 'Another operator action is running'); busy = true;
      try {
        if (req.url === '/prepare' || req.url === '/prepare-retry') {
          authority = await refreshAuthority(); await predecessors();
          const entry = await journalEntry(options.journal, plan.planDigest, stepIndex);
          if (req.url === '/prepare') { need(!entry, 'Wallet handoff already exists; reconcile its outcome'); prepared = await preparePublicationRequest(plan, stepIndex, providers, options.ceilings); }
          else { need(options.retryAttempt && !await retryJournalEntry(options.journal, plan.planDigest, stepIndex, options.retryAttempt), 'An unused explicitly reviewed retry is required');
            prepared = await preparePublicationRetry(plan, entry, providers, options.ceilings, options.reviewedRequestDigest, options.retryAttempt); }
          reply(200, prepared); return;
        }
        if (req.url === '/arm') {
          need(prepared && input.requestDigest === prepared.requestDigest, 'Prepared request digest differs'); authority = await refreshAuthority(); await predecessors();
          await revalidatePublicationRequest(plan, prepared, providers, options.ceilings);
          if (prepared.retryAttempt) await armRetryJournal(options.journal, prepared, authority); else await armJournal(options.journal, prepared, authority);
          reply(200, { request: prepared.request, requestDigest: prepared.requestDigest }); prepared = null; return;
        }
        if (req.url === '/record') { hash(input.transactionHash); const entry = await recordTransaction(options.journal, plan.planDigest, stepIndex, input.transactionHash.toLowerCase()); reply(200, { transactionHash: entry.transactionHash }); return; }
        if (req.url === '/receipt') { const entry = await journalEntry(options.journal, plan.planDigest, stepIndex); need(entry?.transactionHash, 'Record the actual transaction hash first');
          const evidence = await observePublicationReceipt(plan, entry, providers); if (evidence.status === 'included-code-verified-unfinalized') await recordReceipt(options.journal, plan.planDigest, stepIndex, evidence); reply(200, evidence); return; }
        throw new Error('Unknown operator action');
      } finally { busy = false; }
    } catch (error) { reply(400, { error: error.message }); }
  });
  server.requestTimeout = 20000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port, '127.0.0.1', resolve); });
  return { server, url: origin, uiCheck };
}
async function main(argv) {
  const command = argv[0] && !argv[0].startsWith('--') ? argv.shift() : 'serve';
  need(['serve', 'observe', 'record', 'receipt'].includes(command), 'Expected serve, observe, record or receipt');
  const options = { port: 8787, stepIndex: 0, uiCheck: false, ceilings: {} }; let planFile, transactionHash;
  const valued = { '--step': 'stepIndex', '--port': 'port', '--journal': 'journal', '--session-file': 'sessionFile', '--reviewed-plan-digest': 'reviewedPlanDigest', '--verify-run-id': 'runId', '--verify-run-attempt': 'runAttempt', '--retry-attempt': 'retryAttempt', '--reviewed-request-digest': 'reviewedRequestDigest' };
  const fees = { '--max-gas': 'maxGas', '--max-fee-per-gas-wei': 'maxFeePerGas', '--priority-fee-per-gas-wei': 'maxPriorityFeePerGas', '--max-value-wei': 'maxValue' }; const seen = new Set();
  for (let i = 0; i < argv.length; i++) { const key = argv[i]; need(!seen.has(key), 'Duplicate operator argument'); seen.add(key);
    if (key === '--ui-check') { options.uiCheck = true; continue; } const value = argv[++i]; need(value && !value.startsWith('--'), 'Missing operator argument');
    if (key === '--plan') planFile = value; else if (key === '--transaction-hash') transactionHash = value;
    else if (valued[key]) options[valued[key]] = value; else if (fees[key]) options.ceilings[fees[key]] = value; else throw new Error('Unsupported operator argument'); }
  for (const key of ['stepIndex', 'port', 'runId', 'runAttempt', 'retryAttempt']) if (options[key] !== undefined) options[key] = Number(options[key]);
  need(planFile && Number.isSafeInteger(options.stepIndex) && options.stepIndex >= 0, 'Plan and valid step required'); options.plan = await readOperatorJson(planFile); await assertOperationPlan(options.plan);
  if (command === 'serve') { console.log((await startPublicationOperator(options)).url); return; }
  need(!options.uiCheck, 'UI-check applies only to serve'); const providers = await reviewedProviders();
  if (command === 'observe') { console.log(JSON.stringify(await observePublicationOperation(options.plan, options.stepIndex, providers), null, 2)); return; }
  if (command === 'record') await recordTransaction(options.journal, options.plan.planDigest, options.stepIndex, hash(transactionHash));
  const entry = await journalEntry(options.journal, options.plan.planDigest, options.stepIndex); need(entry?.transactionHash, 'Actual transaction hash required');
  const evidence = await observePublicationReceipt(options.plan, entry, providers); if (evidence.status === 'included-code-verified-unfinalized') await recordReceipt(options.journal, options.plan.planDigest, options.stepIndex, evidence);
  console.log(JSON.stringify(evidence, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
