#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, need } from '../module-mode/core.mjs';
import { REPOSITORY_ROOT } from '../module-mode/build.mjs';
import { exactJson } from '../module-mode/source-readback.mjs';
import { sealAnyQuoteEthBuild } from './any-quote-eth-build.mjs';
import { anyQuoteEthBasis, buildAnyQuoteEthPlan, ANY_QUOTE_ETH_NEW_ROLES } from './any-quote-eth-core.mjs';
import { anyQuoteEthExplorerRequests, anyQuoteEthSourceRequests } from './any-quote-eth-evidence.mjs';

export async function prepareAnyQuoteEth({ root = REPOSITORY_ROOT, parametersFile, outputDirectory, candidate = false }) {
  need(parametersFile && outputDirectory, 'Explicit owner nonce parameters and output directory required');
  const build = await sealAnyQuoteEthBuild({ root, candidate }), basis = await anyQuoteEthBasis(root);
  const plan = await buildAnyQuoteEthPlan(build, exactJson(await readFile(parametersFile), 'Any Quote deployment parameters'), basis);
  await mkdir(outputDirectory, { recursive: true });
  const files = { 'plan.json': plan, 'build.json': build, 'basis.json': basis,
    'abi.json': { schemaVersion: 'programmable.module-engine-any-quote-eth-deployment-abi.v1', sourceCommit: build.sourceCommit, buildDigest: build.buildDigest,
      contracts: Object.fromEntries(ANY_QUOTE_ETH_NEW_ROLES.map(role => [role, { ...plan.identityCandidate.contracts[role], abi: build.artifacts[role].abi }])) },
    'sourcify-verification-requests.json': anyQuoteEthSourceRequests(plan, build), 'source-verification-requests.json': anyQuoteEthExplorerRequests(plan, build),
    'review-bindings.json': { status: 'unapproved-unpublished', sourceVersion: plan.identityCandidate.sourceVersion,
      engineProfile: plan.identityCandidate.engineProfile, sourceId: plan.sourceId, economics: plan.economics,
      configurationSchemaId: plan.configurationSchemaId, contracts: plan.identityCandidate.contracts,
      engine: { repositorySourcePath: 'contracts/src/module-engine/any-quote/AnyQuoteLPModuleV1.sol',
        profile: 'programmable.module-engine-solidity@1', deployment: 'per-launch-from-the-current-protected-reviewed-artifact',
        artifact: 'required-from-existing-independent-review-not-the-foundation-compiler' },
      publication: 'Authenticated accepted bundle for platform author/reward wallet 0xd88539d3c4c460136a733a3fd60cf6bf269079da in new family 0x91ec5e77c54fc78d8cd1240c9caf3252a8ee656b9ad9e6b3f454399985d0760b and separate Registry owner approval required; no global LP engine is deployed' } };
  for (const [name, value] of Object.entries(files)) await writeFile(path.join(outputDirectory, name), `${canonicalJson(value)}\n`, { flag: 'wx', mode: 0o600 });
  const directory = path.join(outputDirectory, 'source-verification'); await mkdir(directory);
  for (const [role, input] of Object.entries(build.standardInputs)) await writeFile(path.join(directory, `${role}.standard-input.json`), canonicalJson(input), { flag: 'wx', mode: 0o600 });
  return { status: 'unsigned-unapproved-any-quote-eth-preparation', sourceCommit: plan.sourceCommit, sourceClean: plan.sourceClean,
    planDigest: plan.planDigest, owner: plan.parameters.owner, nonces: plan.steps.map(step => step.nonce), contracts: plan.identityCandidate.contracts,
    sizes: Object.fromEntries(ANY_QUOTE_ETH_NEW_ROLES.map(role => [role, { runtimeBytes: plan.contracts[role].runtimeBytes,
      initcodeBytes: role === 'ledger' ? undefined : role === 'sharedHook' ? plan.sharedHookCreation.initcodeBytes : plan.steps.find(step => step.role === role).initcodeBytes }])),
    output: outputDirectory };
}
async function main(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--candidate') { need(!options.candidate, 'Duplicate candidate'); options.candidate = true; continue; }
    const key = { '--parameters': 'parametersFile', '--output': 'outputDirectory', '--source-root': 'root' }[argv[i]];
    need(key && !options[key] && argv[i + 1] && !argv[i + 1].startsWith('--'), 'Use --parameters FILE --output DIRECTORY [--source-root DIRECTORY] [--candidate]');
    options[key] = path.resolve(argv[++i]);
  }
  console.log(JSON.stringify(await prepareAnyQuoteEth(options), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
