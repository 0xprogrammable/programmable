#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPlan, canonicalJson, need } from './core.mjs';
import { sharedValidators } from './shared.mjs';
import { sealBuild } from './build.mjs';
import { reviewedProviders, observeReceipt, observeStage } from './rpc.mjs';
import { journalEntry, recordReceipt, recordTransaction } from './journal.mjs';
import { collectDeploymentEvidence, collectSourceVerificationEvidence, sourcifyVerificationRequests, writeEvidence } from './evidence.mjs';
import { exactJson } from './source-readback.mjs';

async function main(argv) {
  const command = argv.shift(); const options = {};
  for (let i = 0; i < argv.length; i += 2) { need(['--plan', '--journal', '--output', '--identity', '--step', '--transaction-hash', '--deployment', '--provider'].includes(argv[i]) && argv[i + 1], 'Unsupported or incomplete collection argument'); options[argv[i].slice(2)] = argv[i + 1]; }
  need(['observe', 'record', 'deployment', 'source', 'source-requests'].includes(command) && options.plan, 'Use observe, record, deployment, source or source-requests with --plan');
  const plan = exactJson(await readFile(options.plan), 'Deployment plan'); const build = await sealBuild(); assertPlan(plan, build);
  if (command === 'observe') {
    const index = Number(options.step); need(options.step !== undefined && Number.isSafeInteger(index), '--step required');
    const observation = await observeStage(plan, index, await reviewedProviders());
    console.log(JSON.stringify({ planDigest: plan.planDigest, sourceCommit: plan.sourceCommit, chainId: 4663,
      status: 'read-only-observation-not-wallet-authority', observation }, null, 2)); return;
  }
  if (command === 'record') {
    const index = Number(options.step); need(Number.isSafeInteger(index) && options.journal, '--step and --journal required');
    if (options['transaction-hash']) await recordTransaction(options.journal, plan.planDigest, index, options['transaction-hash']);
    const entry = await journalEntry(options.journal, plan.planDigest, index); need(entry?.transactionHash, 'A recorded transaction hash is required');
    const evidence = await observeReceipt(plan, entry, await reviewedProviders());
    if (evidence.status === 'included-code-verified-unfinalized') await recordReceipt(options.journal, plan.planDigest, index, evidence);
    console.log(JSON.stringify(evidence, null, 2)); return;
  }
  need(options.output, '--output evidence directory required'); await mkdir(options.output, { recursive: true });
  if (command === 'deployment') {
    need(options.journal, '--journal required'); const result = await collectDeploymentEvidence(plan, options.journal, await reviewedProviders());
    const file = await writeEvidence(options.output, 'deployment', result.evidence, result.identity.releaseDigest);
    await writeFile(path.join(options.output, 'identity.json'), `${JSON.stringify(result.identity, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ ...file, releaseDigest: result.identity.releaseDigest, status: 'deployment-observed-activation-disabled' }, null, 2)); return;
  }
  need(options.identity && options.deployment, '--identity and --deployment from actual deployment collection required');
  const identity = exactJson(await readFile(options.identity), 'Release identity');
  for (const [key, value] of Object.entries(plan.identityCandidate)) need(canonicalJson(identity[key]) === canonicalJson(value), `Immutable release identity differs: ${key}`);
  const { computeModuleModeReleaseDigest } = await sharedValidators();
  need(computeModuleModeReleaseDigest(identity) === identity.releaseDigest, 'Release identity digest differs');
  const deployment = exactJson(await readFile(options.deployment), 'Deployment evidence');
  need(deployment.releaseDigest === identity.releaseDigest, 'Deployment release differs');
  if (command === 'source-requests') {
    const requests = sourcifyVerificationRequests(plan, build, deployment);
    await writeFile(path.join(options.output, 'sourcify-verification-requests.json'), `${JSON.stringify(requests, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    for (const [role, request] of Object.entries(requests)) await writeFile(path.join(options.output, `${role}.sourcify-body.json`), JSON.stringify(request.body), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: 'unsubmitted-creation-bound', roles: Object.keys(requests), output: options.output })); return;
  }
  const evidence = await collectSourceVerificationEvidence(plan, build, deployment, fetch, options.provider ?? 'sourcify-v2');
  console.log(JSON.stringify(await writeEvidence(options.output, 'sourceVerification', evidence, identity.releaseDigest), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
