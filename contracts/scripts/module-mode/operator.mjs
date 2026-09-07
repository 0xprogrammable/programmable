#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAN_SCHEMA, assertPlan, hash, need } from './core.mjs';
import { exactJson } from './source-readback.mjs';
import { REPOSITORY_ROOT, sealBuild, git } from './build.mjs';
import { assertSourceAuthority } from './authority.mjs';
import { reviewedProviders, prepareWalletRequest, revalidateWalletRequest, observeStage, observeReceipt } from './rpc.mjs';
import { armJournal, armRetryJournal, retryJournalEntry, journalDirectory, journalEntry, recordTransaction, recordReceipt } from './journal.mjs';
import { assertContinuationPlan, assertOriginalRequest, prepareWalletRetry } from './recovery.mjs';
import { sealNativeV2Build } from '../module-native-v2/build.mjs';
import { assertNativeV2Basis } from '../module-native-v2/basis.mjs';
import { PLAN_SCHEMA_V2, ECONOMICS_POLICY_ID, assertNativeV2Plan } from '../module-native-v2/core.mjs';
import { observeNativeV2Stage, observeNativeV2Receipt } from '../module-native-v2/rpc.mjs';
import { sealEngineBuild } from '../module-engine/build.mjs';
import { ENGINE_PLAN_SCHEMA, assertEnginePlan, assertEngineBasis } from '../module-engine/core.mjs';
import { observeEngineStage, observeEngineReceipt } from '../module-engine/rpc.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const profiles = [
  { planSchema: PLAN_SCHEMA, identitySchema: 'programmable.module-mode-source.v1', sourceVersion: 'module-native-v1',
    sealBuild, assertPlan, observeStage, observeReceipt },
  { planSchema: PLAN_SCHEMA_V2, identitySchema: 'programmable.module-mode-source.v2', sourceVersion: 'module-native-v2',
    sealBuild: sealNativeV2Build, assertPlan: assertNativeV2Plan, assertBasis: assertNativeV2Basis,
    observeStage: observeNativeV2Stage, observeReceipt: observeNativeV2Receipt },
  { planSchema: ENGINE_PLAN_SCHEMA, identitySchema: 'programmable.module-engine.release.v1', sourceVersion: 'module-engine-v1',
    sealBuild: sealEngineBuild, assertPlan: assertEnginePlan, assertBasis: assertEngineBasis,
    observeStage: observeEngineStage, observeReceipt: observeEngineReceipt },
].map(Object.freeze);

/** Exact source dispatch only; every live path still reseals and uses the existing source/wallet authority. */
export function operatorSourceProfile(plan) {
  const identity = plan?.identityCandidate;
  need(plan?.chainId === 4663 && identity?.chainId === 4663, 'Deployment source chain differs');
  const profile = profiles.find(item => plan.schemaVersion === item.planSchema && identity.schemaVersion === item.identitySchema
    && identity.sourceVersion === item.sourceVersion);
  need(profile && (plan.sourceVersion === undefined || plan.sourceVersion === profile.sourceVersion), 'Unsupported or mixed deployment source schemas');
  if (profile.sourceVersion !== 'module-native-v1') need(identity.economicsPolicyId === ECONOMICS_POLICY_ID
    && plan.economics?.economicsPolicyId === ECONOMICS_POLICY_ID, 'Deployment economics policy differs');
  return profile;
}
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
  const { plan, stepIndex, uiCheck = false } = options; const profile = operatorSourceProfile(plan);
  const step = plan.steps[stepIndex]; need(step, 'Unknown deployment step');
  const authorityPlan = options.continuationPlan ?? plan;
  const authorityProfile = operatorSourceProfile(authorityPlan);
  need(profile === authorityProfile, 'Continuation cannot change the deployment source generation');
  const authorityDigest = options.continuationPlan ? options.reviewedContinuationPlanDigest : options.reviewedPlanDigest;
  const refreshAuthority = () => assertSourceAuthority(authorityPlan, authorityDigest, options.runId, options.runAttempt);
  if (options.retryAttempt !== undefined) {
    need(Number.isSafeInteger(options.retryAttempt) && options.retryAttempt > 0, 'Explicit positive retry attempt required');
    hash(options.reviewedRequestDigest, 'reviewed original request digest');
  } else need(options.reviewedRequestDigest === undefined, 'Retry digest requires an explicit retry attempt');
  let providers, authority;
  if (!uiCheck) {
    const freshBuild = await authorityProfile.sealBuild(); await authorityProfile.assertPlan(authorityPlan, freshBuild);
    if (authorityProfile.assertBasis) await authorityProfile.assertBasis(authorityPlan.basis);
    if (options.continuationPlan) {
      need(plan.planDigest === options.reviewedPlanDigest, 'Original reviewed plan digest differs');
      assertContinuationPlan(plan, authorityPlan);
      try { await git(REPOSITORY_ROOT, ['merge-base', '--is-ancestor', plan.sourceCommit, authorityPlan.sourceCommit]); }
      catch { throw new Error('Original contract source must be an ancestor of the reviewed operator source'); }
    }
    await journalDirectory(options.journal); providers = await reviewedProviders();
    authority = await refreshAuthority();
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
        const retry = !uiCheck && options.retryAttempt ? await retryJournalEntry(options.journal, plan.planDigest, stepIndex, options.retryAttempt) : null;
        reply(200, { uiCheck, chainId: 4663, sourceVersion: profile.sourceVersion, planSchema: profile.planSchema,
          planDigest: plan.planDigest, sourceCommit: plan.sourceCommit, stepIndex, totalSteps: plan.steps.length,
          operatorSourceCommit: authorityPlan.sourceCommit, operatorPlanDigest: authorityPlan.planDigest, actionInProgress: busy,
          canRetry: !uiCheck && Boolean(options.retryAttempt && entry && !entry.transactionHash && !retry && entry.requestDigest === options.reviewedRequestDigest), retryAttempt: options.retryAttempt ?? null,
          role: step.role, target: step.target, transactionRecipient: step.to, owner: step.sender, value: step.value, parameters: plan.parameters, economics: plan.economics,
          constructorInputs: step.constructorInputs, constructorValues: step.constructorValues, initcodeHash: step.initcodeHash,
          initcodeBytes: step.initcodeBytes, runtime: { ...plan.contracts[step.role], runtime: undefined },
          ceilings: options.ceilings ?? null, authority: authority ?? null, journalState: entry ? entry.transactionHash ? 'transaction-recorded' : 'outcome-unknown' : 'not-requested', transactionHash: entry?.transactionHash ?? null }); return;
      }
      need(!uiCheck, 'UI-check mode cannot access providers, wallets or the journal'); need(!busy, 'Another operator action is running'); busy = true;
      try {
        if (req.url === '/prepare') {
          need(!await journalEntry(options.journal, plan.planDigest, stepIndex), 'This step was already handed to a wallet; reconcile its outcome instead of retrying');
          authority = await refreshAuthority();
          prepared = await prepareWalletRequest(plan, stepIndex, providers, options.ceilings, profile.observeStage);
          reply(200, prepared); return;
        }
        if (req.url === '/arm') {
          need(prepared && !prepared.retryAttempt && input.requestDigest === prepared.requestDigest, 'Prepared request digest differs');
          authority = await refreshAuthority();
          await revalidateWalletRequest(plan, prepared, providers, options.ceilings, profile.observeStage); await armJournal(options.journal, prepared, authority);
          reply(200, { request: prepared.request, requestDigest: prepared.requestDigest }); prepared = null; return;
        }
        if (req.url === '/prepare-retry') {
          need(options.retryAttempt, 'An explicitly reviewed retry attempt is required');
          need(!await retryJournalEntry(options.journal, plan.planDigest, stepIndex, options.retryAttempt), 'This retry was already handed off; reconcile its outcome');
          const entry = await journalEntry(options.journal, plan.planDigest, stepIndex);
          authority = await refreshAuthority();
          prepared = await prepareWalletRetry(plan, entry, providers, options.ceilings, options.reviewedRequestDigest, options.retryAttempt, profile.observeStage);
          reply(200, prepared); return;
        }
        if (req.url === '/arm-retry') {
          need(prepared?.retryAttempt === options.retryAttempt && options.retryAttempt && input.requestDigest === prepared.requestDigest, 'Prepared retry digest differs');
          const entry = await journalEntry(options.journal, plan.planDigest, stepIndex);
          assertOriginalRequest(plan, entry, options.reviewedRequestDigest);
          authority = await refreshAuthority();
          await revalidateWalletRequest(plan, prepared, providers, options.ceilings, profile.observeStage);
          await armRetryJournal(options.journal, prepared, authority);
          reply(200, { request: prepared.request, requestDigest: prepared.requestDigest }); prepared = null; return;
        }
        if (req.url === '/record') {
          hash(input.transactionHash); const entry = await recordTransaction(options.journal, plan.planDigest, stepIndex, input.transactionHash.toLowerCase());
          reply(200, { recorded: true, transactionHash: entry.transactionHash }); return;
        }
        if (req.url === '/receipt') {
          const entry = await journalEntry(options.journal, plan.planDigest, stepIndex); need(entry?.transactionHash, 'Record the transaction hash first');
          const evidence = await profile.observeReceipt(plan, entry, providers); if (evidence.status === 'included-code-verified-unfinalized') await recordReceipt(options.journal, plan.planDigest, stepIndex, evidence);
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
  const options = { port: 8787, stepIndex: 0, uiCheck: false, ceilings: {} }; let planFile, continuationFile;
  const valued = { '--step': 'stepIndex', '--port': 'port', '--journal': 'journal', '--reviewed-plan-digest': 'reviewedPlanDigest', '--verify-run-id': 'runId', '--verify-run-attempt': 'runAttempt',
    '--reviewed-continuation-plan-digest': 'reviewedContinuationPlanDigest', '--retry-attempt': 'retryAttempt', '--reviewed-request-digest': 'reviewedRequestDigest' };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--ui-check') options.uiCheck = true;
    else if (key === '--plan') planFile = argv[++i];
    else if (key === '--continuation-plan') continuationFile = argv[++i];
    else if (key === '--max-gas') options.ceilings.maxGas = argv[++i];
    else if (key === '--max-fee-per-gas-wei') options.ceilings.maxFeePerGas = argv[++i];
    else if (key === '--priority-fee-per-gas-wei') options.ceilings.maxPriorityFeePerGas = argv[++i];
    else if (valued[key]) options[valued[key]] = argv[++i];
    else throw new Error(`Unsupported option: ${key.split('=')[0]}`);
  }
  for (const key of ['stepIndex', 'port', 'runId', 'runAttempt', 'retryAttempt']) if (options[key] !== undefined) options[key] = Number(options[key]);
  need(planFile && Number.isSafeInteger(options.port) && options.port > 1024 && options.port < 65536 && Number.isSafeInteger(options.stepIndex), 'Valid plan, step and local port required');
  need(Boolean(continuationFile) === Boolean(options.reviewedContinuationPlanDigest), 'Continuation plan and its explicitly reviewed digest are both required');
  options.plan = exactJson(await readFile(planFile), 'Deployment plan');
  if (continuationFile) options.continuationPlan = exactJson(await readFile(continuationFile), 'Reviewed operator continuation plan');
  const result = await startOperator(options);
  console.log(`${result.url} (${options.uiCheck ? 'UI check: wallet and RPC disabled' : 'owner-controlled wallet handoff'})`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
