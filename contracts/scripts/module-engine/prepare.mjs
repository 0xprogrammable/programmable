#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, need, simulationInput } from '../module-mode/core.mjs';
import { REPOSITORY_ROOT } from '../module-mode/build.mjs';
import { exactJson } from '../module-mode/source-readback.mjs';
import { sealEngineBuild } from './build.mjs';
import { buildEnginePlan, engineBasis, ENGINE_NEW_ROLES } from './core.mjs';
import { engineExplorerRequests, engineSourceRequests } from './evidence.mjs';

export async function prepareEngine({ root = REPOSITORY_ROOT, parametersFile, outputDirectory, candidate = false }) {
  const build = await sealEngineBuild({ root, candidate }), basis = await engineBasis(root);
  const parameters = parametersFile ? exactJson(await readFile(parametersFile), 'Engine deployment parameters')
    : { owner: basis.deploymentOwner, reviewAuthority: basis.registryOwner, releaseLabel: 'robinhood-engine-v1' };
  const plan = await buildEnginePlan(build, parameters, basis), simulation = simulationInput(plan);
  const draft = { schemaVersion: 'programmable.module-engine-release-draft.v1', sourceVersion: 'module-engine-v1', chainId: 4663,
    enabled: false, status: 'planned-not-deployed', planDigest: plan.planDigest, sourceId: plan.sourceId, identityCandidate: plan.identityCandidate,
    authority: plan.authority, pending: ['independent-money-and-static-review', 'fresh-independent-rpc-quorum', 'fork-simulation-at-bound-block',
      'final-owner-transaction-review', 'actual-host-ledger-deployment', 'source-verification-with-historical-reuse-proofs',
      'engine-specific-finalized-lifecycle', 'separate-reviewed-template-availability', 'public-source-activation'] };
  const abi = { schemaVersion: 'programmable.module-engine-deployment-abi.v1', sourceCommit: build.sourceCommit, buildDigest: build.buildDigest,
    sourceId: plan.sourceId, contracts: Object.fromEntries(Object.entries(build.artifacts).map(([role, artifact]) => [role, {
      compilationTarget: artifact.compilationTarget, abi: artifact.abi,
      ...(plan.contracts[role] ? { address: plan.contracts[role].address, runtimeCodeHash: plan.contracts[role].runtimeCodeHash } : {}) }])) };
  await mkdir(outputDirectory, { recursive: true });
  const files = { 'plan.json': JSON.stringify(plan, null, 2), 'build.json': JSON.stringify(build), 'basis.json': JSON.stringify(basis, null, 2),
    'release-draft.json': JSON.stringify(draft, null, 2), 'abi.json': JSON.stringify(abi, null, 2),
    'sourcify-verification-requests.json': JSON.stringify(engineSourceRequests(plan, build), null, 2),
    'source-verification-requests.json': JSON.stringify(engineExplorerRequests(plan, build), null, 2), 'simulation-input.hex': simulation };
  for (const [name, data] of Object.entries(files)) await writeFile(path.join(outputDirectory, name), `${data}\n`, { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(outputDirectory, 'simulation-input.bin'), Buffer.from(simulation.slice(2), 'hex'), { flag: 'wx', mode: 0o600 });
  const sourceDirectory = path.join(outputDirectory, 'source-verification'); await mkdir(sourceDirectory);
  for (const role of ENGINE_NEW_ROLES) await writeFile(path.join(sourceDirectory, `${role}.standard-input.json`), canonicalJson(build.standardInputs[role]), { flag: 'wx', mode: 0o600 });
  return { status: 'unsigned-unapproved-engine-preparation', chainId: 4663, sourceCommit: build.sourceCommit, sourceClean: build.sourceClean,
    planDigest: plan.planDigest, buildDigest: build.buildDigest, basisDigest: basis.basisDigest, reuseSourceDigest: build.reuseSourceDigest,
    sourceId: plan.sourceId, owner: parameters.owner, registryOwner: parameters.reviewAuthority, treasury: plan.economics.treasury,
    registry: plan.contracts.registry.address, host: plan.contracts.host.address, ledger: plan.contracts.ledger.address,
    initcodeBytes: plan.steps[0].initcodeBytes, initcodeHeadroom: 49152 - plan.steps[0].initcodeBytes,
    reusedRoles: plan.reusedRoles, basisStatus: basis.status, files: outputDirectory };
}
async function main(argv) {
  const options = { candidate: false };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i]; if (key === '--candidate') { need(!options.candidate, 'Duplicate candidate option'); options.candidate = true; }
    else { need(['--parameters', '--output'].includes(key) && argv[i + 1] && !argv[i + 1].startsWith('--'), 'Use --output DIRECTORY [--parameters FILE] [--candidate]');
      const name = key === '--output' ? 'outputDirectory' : 'parametersFile'; need(!options[name], 'Duplicate option'); options[name] = path.resolve(argv[++i]); }
  }
  need(options.outputDirectory, '--output required'); console.log(JSON.stringify(await prepareEngine(options), null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
