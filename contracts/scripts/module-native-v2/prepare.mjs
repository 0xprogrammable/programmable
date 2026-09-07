#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, need, simulationInput } from '../module-mode/core.mjs';
import { exactJson } from '../module-mode/source-readback.mjs';
import { REPOSITORY_ROOT } from '../module-mode/build.mjs';
import { nativeV2Basis } from './basis.mjs';
import { sealNativeV2Build } from './build.mjs';
import { buildNativeV2Plan, ECONOMICS_POLICY_ID, NEW_ROLES } from './core.mjs';
import { nativeV2ExplorerRequests, nativeV2SourceRequests } from './evidence.mjs';

export async function prepareNativeV2({ root = REPOSITORY_ROOT, parametersFile, outputDirectory, candidate = false }) {
  const build = await sealNativeV2Build({ root, candidate }), basis = await nativeV2Basis(root);
  const parameters = parametersFile ? exactJson(await readFile(parametersFile), 'V2 deployment parameters') : {
    owner: basis.deploymentOwner, reviewAuthority: basis.registryOwner, minimumInitialBuyNative: basis.minimumInitialBuyNative,
    releaseLabel: 'robinhood-native-v2' };
  const plan = buildNativeV2Plan(build, parameters, basis), simulation = simulationInput(plan);
  const abi = { schemaVersion: 'programmable.module-mode-deployment-abi.v1', sourceVersion: 'module-native-v2',
    economicsPolicyId: ECONOMICS_POLICY_ID, sourceCommit: plan.sourceCommit, buildDigest: plan.buildDigest,
    contracts: Object.fromEntries(Object.entries(build.artifacts).map(([role, artifact]) => [role, { compilationTarget: artifact.compilationTarget,
      ...(plan.contracts[role] ? { address: plan.contracts[role].address, runtimeCodeHash: plan.contracts[role].runtimeCodeHash } : {}), abi: artifact.abi }])) };
  const draft = { schemaVersion: 'programmable.module-mode-native-v2-release-draft.v1', chainId: 4663, sourceVersion: 'module-native-v2',
    enabled: false, status: 'planned-not-deployed', planDigest: plan.planDigest, economicsPolicyId: ECONOMICS_POLICY_ID,
    identityCandidate: plan.identityCandidate, authority: plan.authority,
    pending: ['fresh-independent-provider-quorum-and-inherited-authority', 'fork-simulation-at-quorum-block', 'owner-review-and-wallet-authorization',
      'actual-four-deployment-receipts', 'actual-source-verification-with-five-V1-reuse-proofs', 'native-v2-ten-canary-receipts-and-finality', 'release-activation'] };
  await mkdir(outputDirectory, { recursive: true });
  const files = { 'plan.json': JSON.stringify(plan, null, 2), 'build.json': JSON.stringify(build), 'basis.json': JSON.stringify(basis, null, 2),
    'release-draft.json': JSON.stringify(draft, null, 2), 'abi.json': JSON.stringify(abi, null, 2),
    'source-verification-requests.json': JSON.stringify(nativeV2ExplorerRequests(plan, build), null, 2),
    'sourcify-verification-requests.json': JSON.stringify(nativeV2SourceRequests(plan, build), null, 2), 'simulation-input.hex': simulation };
  for (const [name, contents] of Object.entries(files)) await writeFile(path.join(outputDirectory, name), `${contents}\n`, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(outputDirectory, 'simulation-input.bin'), Buffer.from(simulation.slice(2), 'hex'), { flag: 'wx', mode: 0o600 });
  const verificationDirectory = path.join(outputDirectory, 'source-verification'); await mkdir(verificationDirectory);
  for (const role of NEW_ROLES) await writeFile(path.join(verificationDirectory, `${role}.standard-input.json`), canonicalJson(build.standardInputs[role]), { flag: 'wx', mode: 0o600 });
  return { status: 'unsigned-unapproved-preparation', chainId: 4663, sourceCommit: plan.sourceCommit, sourceClean: plan.sourceClean,
    planDigest: plan.planDigest, buildDigest: build.buildDigest, basisDigest: basis.basisDigest, reuseSourceDigest: plan.reuseSourceDigest,
    owner: parameters.owner, reviewAuthority: parameters.reviewAuthority, treasury: plan.economics.treasury,
    economicsPolicyId: ECONOMICS_POLICY_ID, basisStatus: basis.status, reusedRoles: plan.reusedRoles,
    stages: plan.steps.map(step => ({ index: step.index, role: step.role, target: step.target, value: step.value,
      initcodeBytes: step.initcodeBytes, initcodeHeadroom: 49152 - step.initcodeBytes, runtimeBytes: plan.contracts[step.role].runtimeBytes })), files: outputDirectory };
}

async function main(argv) {
  const options = { candidate: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]; if (key === '--candidate') { need(!options.candidate, 'Duplicate candidate option'); options.candidate = true; }
    else { need(['--parameters', '--output'].includes(key) && argv[i + 1] && !argv[i + 1].startsWith('--'), 'Use --output DIRECTORY [--parameters FILE] [--candidate]');
      const name = key === '--output' ? 'outputDirectory' : 'parametersFile'; need(!options[name], 'Duplicate option'); options[name] = path.resolve(argv[++i]); }
  }
  need(options.outputDirectory, '--output required');
  console.log(JSON.stringify(await prepareNativeV2(options), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
