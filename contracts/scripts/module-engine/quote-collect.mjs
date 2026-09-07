#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { need } from '../module-mode/core.mjs';
import { REPOSITORY_ROOT } from '../module-mode/build.mjs';
import { exactJson } from '../module-mode/source-readback.mjs';
import { reviewedProviders } from '../module-mode/rpc.mjs';
import { journalEntry, recordReceipt, recordTransaction } from '../module-mode/journal.mjs';
import { sealQuoteBuild } from './quote-build.mjs';
import { assertQuotePlan, assertQuoteBasis, assertQuoteIdentity } from './quote-core.mjs';
import { collectQuoteDeployment, collectQuoteSource, quoteSourceRequests, writeQuoteEvidence } from './quote-evidence.mjs';
import { observeQuoteReceipt, observeQuoteStage } from './quote-rpc.mjs';

async function main(argv) {
  const command = argv.shift(), options = {};
  for (let i = 0; i < argv.length; i += 2) {
    need(['--plan', '--step', '--journal', '--output', '--identity', '--transaction-hash', '--deployment', '--previous-source', '--source-root'].includes(argv[i])
      && argv[i + 1] && !argv[i + 1].startsWith('--') && !options[argv[i].slice(2)], 'Unsupported, incomplete or duplicate argument');
    options[argv[i].slice(2)] = argv[i + 1];
  }
  need(['observe', 'record', 'deployment', 'source', 'source-requests'].includes(command) && options.plan,
    'Use observe, record, deployment, source or source-requests with --plan');
  const root = options['source-root'] ? path.resolve(options['source-root']) : REPOSITORY_ROOT;
  const plan = exactJson(await readFile(options.plan), 'Quote deployment plan'), build = await sealQuoteBuild({ root });
  assertQuotePlan(plan, build); await assertQuoteBasis(plan.basis, root);
  if (['observe', 'record'].includes(command)) {
    need(options.step === '0' || options.step === '1', 'Explicit --step 0 or --step 1 required');
    const stepIndex = Number(options.step), providers = await reviewedProviders();
    if (command === 'observe') { console.log(JSON.stringify({ planDigest: plan.planDigest, status: 'read-only-observation-not-wallet-authority',
      observation: await observeQuoteStage(plan, stepIndex, providers) }, null, 2)); return; }
    need(options.journal, '--journal required');
    if (options['transaction-hash']) await recordTransaction(options.journal, plan.planDigest, stepIndex, options['transaction-hash']);
    const entry = await journalEntry(options.journal, plan.planDigest, stepIndex); need(entry?.transactionHash, 'Actual transaction hash and original armed request required');
    const evidence = await observeQuoteReceipt(plan, entry, providers);
    if (evidence.status === 'included-code-verified-unfinalized') await recordReceipt(options.journal, plan.planDigest, stepIndex, evidence);
    console.log(JSON.stringify(evidence, null, 2)); return;
  }
  need(options.step === undefined && options['transaction-hash'] === undefined, 'Stage options are only valid for observe/record');
  need(options.output, '--output required'); await mkdir(options.output, { recursive: true });
  if (command === 'deployment') {
    need(options.journal, '--journal required'); const result = await collectQuoteDeployment(plan, options.journal, await reviewedProviders());
    const file = await writeQuoteEvidence(options.output, 'deployment', result.evidence, result.identity.infrastructureDigest);
    await writeFile(path.join(options.output, 'identity.json'), `${JSON.stringify(result.identity, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ ...file, infrastructureDigest: result.identity.infrastructureDigest,
      status: 'quote-infrastructure-observed-template-publication-unproven' }, null, 2)); return;
  }
  need(options.identity && options.deployment, '--identity and --deployment from actual collection required');
  const identity = assertQuoteIdentity(plan, exactJson(await readFile(options.identity), 'Actual Quote infrastructure identity'));
  const deployment = exactJson(await readFile(options.deployment), 'Actual Quote deployment');
  need(deployment.infrastructureDigest === identity.infrastructureDigest, 'Quote deployment identity differs');
  if (command === 'source-requests') {
    const requests = quoteSourceRequests(plan, build, deployment);
    await writeFile(path.join(options.output, 'sourcify-verification-requests.json'), `${JSON.stringify(requests, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    for (const [role, request] of Object.entries(requests)) await writeFile(path.join(options.output, `${role}.sourcify-body.json`), JSON.stringify(request.body), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: 'unsubmitted-creation-bound', roles: Object.keys(requests), output: options.output })); return;
  }
  need(options['previous-source'], '--previous-source must contain the exact historical V1 source evidence bytes');
  const evidence = await collectQuoteSource(plan, build, deployment, await readFile(options['previous-source']));
  console.log(JSON.stringify(await writeQuoteEvidence(options.output, 'sourceVerification', evidence, identity.infrastructureDigest), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
