import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { encodeAbiParameters, keccak256, parseAbiParameters } from 'viem';
import { address, bytes, canonicalJson, hash, need } from './core.mjs';
import { sharedValidators } from './shared.mjs';
import { journalEntry } from './journal.mjs';
import { observeReceipt } from './rpc.mjs';
import { SOURCIFY_BASE, SOURCIFY_COMPILER, boundedPublicJson, exactJson, sourcifyNeedsRecompilation, sourcifyPreflight, validateSourcifySource } from './source-readback.mjs';
import { recompileSourcifyInput } from './source-recompile.mjs';

export const EVIDENCE_FILENAMES = Object.freeze({ deployment: 'deployment.json', sourceVerification: 'source-verification.json', lifecycle: 'lifecycle.json' });
export function evidenceBytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'); }
/** Digest of EXACT UTF-8 file bytes, including the final newline. No second canonicalization. */
export function evidenceDigest(raw) { need(Buffer.isBuffer(raw) || raw instanceof Uint8Array, 'Raw evidence file bytes required'); return keccak256(raw); }
export async function writeEvidence(directory, kind, evidence, releaseDigest) {
  need(Object.hasOwn(EVIDENCE_FILENAMES, kind), 'Unknown release evidence kind');
  need(evidence.chainId === 4663 && evidence.releaseDigest === hash(releaseDigest), 'Evidence release identity differs');
  const raw = evidenceBytes(evidence); await writeFile(path.join(directory, EVIDENCE_FILENAMES[kind]), raw, { flag: 'wx', mode: 0o600 });
  return { file: EVIDENCE_FILENAMES[kind], digest: evidenceDigest(raw) };
}
export async function collectDeploymentEvidence(plan, journal, providers) {
  const records = [];
  for (const step of plan.steps) {
    const entry = await journalEntry(journal, plan.planDigest, step.index); need(entry?.transactionHash, `Stage ${step.index}: actual transaction hash missing`);
    const record = await observeReceipt(plan, entry, providers); need(record.status === 'included-code-verified-unfinalized', `Stage ${step.index}: inclusion or code unproven`); records.push(record);
  }
  const launcher = records.find(record => record.role === 'launcher');
  const identity = { ...plan.identityCandidate, startBlock: BigInt(launcher.receipt.blockNumber).toString() };
  // Exact shared export used by the indexer and backend; no second identity formula.
  const { computeModuleModeReleaseDigest } = await sharedValidators();
  const releaseDigest = computeModuleModeReleaseDigest(identity);
  return { identity: { ...identity, releaseDigest }, evidence: { schemaVersion: 'programmable.module-mode-deployment-evidence.v1', chainId: 4663, releaseDigest,
    sourceCommit: plan.sourceCommit, planDigest: plan.planDigest, buildDigest: plan.buildDigest,
    status: 'included-code-verified', finality: 'not-asserted', records } };
}
export function constructorArguments(plan, role) {
  const step = plan.steps.find(step => step.role === role); if (step) return step.constructorArguments;
  const pins = plan.contracts;
  if (role === 'runtime') return encodeAbiParameters(parseAbiParameters('address'), [pins.hook.address]);
  if (role === 'budgetVault') return '0x';
  if (role === 'swapRouter') return encodeAbiParameters(parseAbiParameters('address,address,address'), [plan.official.poolManager.address, pins.hook.address, pins.launcher.address]);
  if (role === 'rewardLedger') return encodeAbiParameters(parseAbiParameters('address,address,address,address,address'), [plan.official.poolManager.address, pins.registry.address,
    plan.economics.treasury, plan.economics.rewardAdmin, plan.economics.noModuleRecipient]);
  throw new Error(`Unknown deployed source role ${role}`);
}
/** Children are created inside their parent's successful deployment transaction. Never infer this from tx.from. */
export function sourceCreation(plan, role, deploymentEvidence) {
  need(deploymentEvidence?.schemaVersion === 'programmable.module-mode-deployment-evidence.v1'
    && deploymentEvidence.chainId === 4663 && deploymentEvidence.planDigest === plan.planDigest
    && deploymentEvidence.buildDigest === plan.buildDigest && deploymentEvidence.sourceCommit === plan.sourceCommit
    && deploymentEvidence.status === 'included-code-verified' && deploymentEvidence.records?.length === plan.steps.length,
  'Matching actual deployment evidence required for source verification');
  const parentRole = { rewardLedger: 'hook', runtime: 'launcher', budgetVault: 'launcher', swapRouter: 'launcher' }[role] ?? role;
  const records = deploymentEvidence.records.filter(record => record.role === parentRole);
  need(records.length === 1, `${role}: unique creation transaction missing`);
  const record = records[0], pin = record.contracts?.[role];
  need(record.status === 'included-code-verified-unfinalized' && record.receipt.status === '0x1'
    && pin?.address === plan.contracts[role].address && pin.runtimeCodeHash === plan.contracts[role].runtimeCodeHash
    && record.transaction.hash === record.receipt.transactionHash, `${role}: deployment code/receipt differs`);
  const deployer = { rewardLedger: plan.contracts.hook.address, runtime: plan.contracts.runtimeFactory.address,
    budgetVault: plan.contracts.runtime.address, swapRouter: plan.contracts.swapRouterFactory.address }[role] ?? plan.official.deterministicDeployer.address;
  const step = plan.steps.find(step => step.role === parentRole);
  need(address(record.transaction.from) === address(step.sender), `${role}: creation transaction sender differs`);
  return { transactionHash: hash(record.receipt.transactionHash), blockNumber: record.receipt.blockNumber,
    transactionIndex: record.receipt.transactionIndex, deployer, transactionSender: address(record.transaction.from) };
}
export function sourcifyVerificationRequests(plan, build, deploymentEvidence = null) {
  return Object.fromEntries(Object.entries(plan.contracts).map(([role, pin]) => {
    const [file, name] = Object.entries(build.artifacts[role].compilationTarget)[0];
    const creation = deploymentEvidence ? sourceCreation(plan, role, deploymentEvidence) : null;
    return [role, { method: 'POST', url: `${SOURCIFY_BASE}/v2/verify/4663/${pin.address}`,
      body: { stdJsonInput: build.standardInputs[role], compilerVersion: SOURCIFY_COMPILER,
        contractIdentifier: `${file}:${name}`, ...(creation ? { creationTransactionHash: creation.transactionHash } : {}) },
      status: creation ? 'unsubmitted-creation-bound' : 'incomplete-actual-creation-transaction-required',
      runtimeCodeHash: pin.runtimeCodeHash,
      publicationNotice: 'Submitting source grants Sourcify its published irrevocable source archival/display licence. This preparation submits nothing.' }];
  }));
}
export function sourceVerificationRequests(plan, build) {
  return Object.fromEntries(Object.entries(plan.contracts).map(([role, pin]) => {
    const target = build.artifacts[role].compilationTarget; const [sourcePath, name] = Object.entries(target)[0];
    return [role, { method: 'POST', url: `https://robinhoodchain.blockscout.com/api/v2/smart-contracts/${pin.address}/verification/via/standard-input`,
      body: { compiler_version: 'v0.8.26+commit.8a97fa7a', license_type: 'none', contract_name: `${sourcePath}:${name}`,
        constructor_args: constructorArguments(plan, role).slice(2), input: canonicalJson(build.standardInputs[role]) },
      status: 'unsubmitted', runtimeCodeHash: pin.runtimeCodeHash }];
  }));
}
export function validatePublishedSource(plan, build, role, response) {
  const pin = plan.contracts[role], artifact = build.artifacts[role]; need(pin && artifact, 'Unknown source role');
  need(response?.is_verified === true && response.is_fully_verified === true && response.is_partially_verified === false
    && response.is_changed_bytecode === false && !response.minimal_proxy_address_hash && !response.verified_twin_address_hash, `${role}: exact full source verification is unavailable`);
  need(response.compiler_version === 'v0.8.26+commit.8a97fa7a' && response.optimization_enabled === true
    && response.optimizations_runs === 1000 && response.evm_version === 'cancun', `${role}: explorer compiler differs`);
  const [sourcePath, name] = Object.entries(artifact.compilationTarget)[0];
  need(response.name === name && response.file_path === sourcePath && bytes(response.deployed_bytecode) === pin.runtime
    && bytes(response.creation_bytecode) === `${bytes(artifact.bytecode.object)}${constructorArguments(plan, role).slice(2)}`, `${role}: explorer source or complete creation/runtime target differs`);
  const constructor = response.constructor_args ?? '0x';
  need(bytes(constructor.startsWith('0x') ? constructor : `0x${constructor}`) === constructorArguments(plan, role), `${role}: published constructor arguments differ`);
  const published = new Map([[response.file_path, response.source_code]]);
  need(Array.isArray(response.additional_sources), `${role}: source closure unavailable`);
  for (const source of response.additional_sources) { need(!published.has(source.file_path), `${role}: duplicate explorer source`); published.set(source.file_path, source.source_code); }
  const expected = build.standardInputs[role].sources;
  need(published.size === Object.keys(expected).length, `${role}: source closure size differs`);
  for (const [file, value] of Object.entries(expected)) need(published.get(file) === value.content, `${role}: published source differs: ${file}`);
  const compilationTarget = response.compiler_settings?.compilationTarget;
  const settings = Object.fromEntries(Object.entries(response.compiler_settings ?? {}).filter(([key]) => !['compilationTarget', 'outputSelection'].includes(key)));
  const expectedSettings = Object.fromEntries(Object.entries(build.standardInputs[role].settings).filter(([key]) => key !== 'outputSelection'));
  need(canonicalJson(settings) === canonicalJson(expectedSettings), `${role}: published compiler settings differ`);
  need(canonicalJson(compilationTarget) === canonicalJson(artifact.compilationTarget), `${role}: compilation target differs`);
  return { role, address: pin.address, runtimeCodeHash: pin.runtimeCodeHash, constructorArguments: constructorArguments(plan, role),
    sourcePaths: [...published.keys()].sort(), sourceCommit: plan.sourceCommit, provider: 'blockscout',
    providerClassification: 'EXPLORER_FULL', independentByteComparison: 'exact-complete-creation-and-runtime' };
}
export async function collectSourceVerificationEvidence(plan, build, deploymentEvidence, fetchImpl = fetch, provider = 'sourcify-v2') {
  need(['sourcify-v2', 'blockscout'].includes(provider), 'Choose the official Sourcify V2 or Blockscout source API');
  const releaseDigest = hash(deploymentEvidence?.releaseDigest);
  const providerPreflight = provider === 'sourcify-v2' ? await sourcifyPreflight(fetchImpl) : null;
  const records = [];
  for (const [role, pin] of Object.entries(plan.contracts)) {
    const creation = sourceCreation(plan, role, deploymentEvidence);
    const url = provider === 'sourcify-v2' ? `${SOURCIFY_BASE}/v2/contract/4663/${pin.address}?fields=all`
      : `https://robinhoodchain.blockscout.com/api/v2/smart-contracts/${pin.address}`;
    const { raw, value } = await boundedPublicJson(url, fetchImpl);
    const recompilation = provider === 'sourcify-v2' && sourcifyNeedsRecompilation(build.standardInputs[role], value)
      ? await recompileSourcifyInput(value, build.standardInputs[role]) : undefined;
    const verified = provider === 'sourcify-v2' ? validateSourcifySource({ plan, build, role, constructorArguments: constructorArguments(plan, role), creation, recompilation }, value)
      : { ...validatePublishedSource(plan, build, role, value), creationTransactionHash: creation.transactionHash };
    records.push({ ...verified, url, responseBytesDigest: evidenceDigest(raw) });
  }
  return { schemaVersion: 'programmable.module-mode-source-verification-evidence.v1', chainId: 4663, releaseDigest: hash(releaseDigest),
    sourceCommit: plan.sourceCommit, buildDigest: plan.buildDigest, status: 'exact-source-and-runtime-verified', providerPreflight, records };
}
/** Lifecycle evidence is supplied by the authenticated native canary/finality collector, never invented here. */
export async function installLifecycleEvidence(directory, sourceFile, releaseDigest, authenticateLifecycle) {
  need(typeof authenticateLifecycle === 'function', 'An authenticated lifecycle collector is required');
  const raw = await readFile(sourceFile); need(raw.length <= 16 * 1024 * 1024, 'Lifecycle evidence too large');
  const evidence = exactJson(raw, 'Lifecycle evidence'); need(evidence.chainId === 4663 && evidence.releaseDigest === hash(releaseDigest), 'Lifecycle identity differs');
  need(await authenticateLifecycle(evidence) === true, 'Lifecycle collector did not authenticate the canary/finality evidence');
  await writeFile(path.join(directory, EVIDENCE_FILENAMES.lifecycle), raw, { flag: 'wx', mode: 0o600 });
  return { file: EVIDENCE_FILENAMES.lifecycle, digest: evidenceDigest(raw) };
}
