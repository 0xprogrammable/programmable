#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, need } from '../module-mode/core.mjs';
import { REPOSITORY_ROOT } from '../module-mode/build.mjs';
import { exactJson } from '../module-mode/source-readback.mjs';
import { reviewedProviders } from '../module-mode/rpc.mjs';
import { journalEntry, recordReceipt, recordTransaction } from '../module-mode/journal.mjs';
import { writeEvidence } from '../module-mode/evidence.mjs';
import { sharedValidators } from '../module-mode/shared.mjs';
import { assertNativeV2Basis } from './basis.mjs';
import { sealNativeV2Build } from './build.mjs';
import { assertNativeV2Plan } from './core.mjs';
import { collectNativeV2Deployment, collectNativeV2Source, nativeV2SourceRequests } from './evidence.mjs';
import { observeNativeV2Receipt, observeNativeV2Stage } from './rpc.mjs';

async function main(argv) {
  const command = argv.shift(), options = {};
  for (let i = 0; i < argv.length; i += 2) {
    need(['--plan', '--journal', '--output', '--identity', '--step', '--transaction-hash', '--deployment', '--previous-source', '--source-root'].includes(argv[i])
      && !options[argv[i].slice(2)] && argv[i + 1] && !argv[i + 1].startsWith('--'), 'Unsupported, duplicate or incomplete collection argument');
    options[argv[i].slice(2)] = argv[i + 1];
  }
  need(['observe', 'record', 'deployment', 'source', 'source-requests'].includes(command) && options.plan, 'Use observe, record, deployment, source or source-requests with --plan');
  const root = options['source-root'] ? path.resolve(options['source-root']) : REPOSITORY_ROOT;
  const plan = exactJson(await readFile(options.plan), 'Native V2 deployment plan'), build = await sealNativeV2Build({ root });
  assertNativeV2Plan(plan, build); await assertNativeV2Basis(plan.basis, root);
  if (['observe', 'record'].includes(command)) {
    const index = Number(options.step); need(options.step !== undefined && Number.isSafeInteger(index) && index >= 0, '--step required');
    const providers = await reviewedProviders();
    if (command === 'observe') {
      console.log(JSON.stringify({ planDigest: plan.planDigest, status: 'read-only-observation-not-wallet-authority',
        observation: await observeNativeV2Stage(plan, index, providers) }, null, 2)); return;
    }
    need(options.journal, '--journal required');
    if (options['transaction-hash']) await recordTransaction(options.journal, plan.planDigest, index, options['transaction-hash']);
    const entry = await journalEntry(options.journal, plan.planDigest, index); need(entry?.transactionHash, 'Actual transaction hash and original armed request required');
    const evidence = await observeNativeV2Receipt(plan, entry, providers);
    if (evidence.status === 'included-code-verified-unfinalized') await recordReceipt(options.journal, plan.planDigest, index, evidence);
    console.log(JSON.stringify(evidence, null, 2)); return;
  }
  need(options.output, '--output required'); await mkdir(options.output, { recursive: true });
  if (command === 'deployment') {
    need(options.journal, '--journal required'); const result = await collectNativeV2Deployment(plan, options.journal, await reviewedProviders());
    const file = await writeEvidence(options.output, 'deployment', result.evidence, result.identity.releaseDigest);
    await writeFile(path.join(options.output, 'identity.json'), `${JSON.stringify(result.identity, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ ...file, releaseDigest: result.identity.releaseDigest, status: 'deployment-observed-activation-disabled' }, null, 2)); return;
  }
  need(options.identity && options.deployment, '--identity and --deployment from actual collection required');
  const identity = exactJson(await readFile(options.identity), 'Release identity'), deployment = exactJson(await readFile(options.deployment), 'Deployment evidence');
  for (const [key, value] of Object.entries(plan.identityCandidate)) need(canonicalJson(identity[key]) === canonicalJson(value), `Immutable release identity differs: ${key}`);
  const { computeModuleModeReleaseDigest } = await sharedValidators();
  need(computeModuleModeReleaseDigest(identity) === identity.releaseDigest && deployment.releaseDigest === identity.releaseDigest, 'Actual release identity differs');
  if (command === 'source-requests') {
    const requests = nativeV2SourceRequests(plan, build, deployment);
    await writeFile(path.join(options.output, 'sourcify-verification-requests.json'), `${JSON.stringify(requests, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    for (const [role, request] of Object.entries(requests)) await writeFile(path.join(options.output, `${role}.sourcify-body.json`), JSON.stringify(request.body), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: 'unsubmitted-creation-bound', roles: Object.keys(requests), output: options.output })); return;
  }
  need(options['previous-source'], '--previous-source must contain the exact existing V1 source verification evidence bytes');
  const evidence = await collectNativeV2Source(plan, build, deployment, await readFile(options['previous-source']));
  console.log(JSON.stringify(await writeEvidence(options.output, 'sourceVerification', evidence, identity.releaseDigest), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
