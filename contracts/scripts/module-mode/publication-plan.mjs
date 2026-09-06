#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeFunctionData, encodeFunctionResult, getCreate2Address, keccak256, parseAbi } from 'viem';
import { OFFICIAL, address, bytes, canonicalJson, digest, exactKeys, hash, jsonSafe, need, sha256 } from './core.mjs';
import { repositoryState } from './build.mjs';
import { exactJson } from './source-readback.mjs';
import { publicationValidators } from './publication-shared.mjs';

export const PUBLICATION_PLAN_SCHEMA = 'programmable.module-mode-publication-owner-plan.v1';
export const registryAbi = parseAbi([
  'function owner() view returns (address)',
  'function families(bytes32 familyId) view returns (address author,address wallet)',
  'function registerReviewedFamily(address author,bytes32 salt,address rewardWallet,bytes32 submissionDigest) returns (bytes32 familyId)',
  'function approveRevision(bytes32 packageId,bytes32 familyId,address factory,bytes32 moduleCodeHash,bytes32 manifestHash,uint32 callbackGas)',
  'function getRevision(bytes32 packageId) view returns ((bytes32 familyId,address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,bytes32 manifestHash,uint32 callbackGas,bool enabled))',
]);
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
function equal(a, b, name) { need(canonicalJson(a) === canonicalJson(b), `${name} differs`); }
export function readCondition(to, abi, functionName, args, result) {
  return { to, functionName, data: encodeFunctionData({ abi, functionName, args }), result: encodeFunctionResult({ abi, functionName, result }) };
}
export async function bindIdentity(identity) {
  const api = await publicationValidators(); need(api.computeModuleModeReleaseDigest(identity) === identity.releaseDigest, 'Immutable release digest differs');
  for (const role of ['poolManager', 'positionManager']) equal(identity.contracts[role], OFFICIAL[role], `Official ${role}`);
  return identity;
}
export async function bindPublicationModule(input, identity, owner) {
  exactKeys(input, ['source', 'manifest', 'review', 'artifact', 'factorySalt'], 'Module publication input');
  const api = await publicationValidators(), source = api.validateModuleSubmissionRequest(input.source);
  need(source.ok, 'Source package is invalid');
  const { manifest, review, artifact } = input, binding = manifest?.manifest?.runtimeBinding;
  need(binding && review?.command?.outcome === 'accept', 'Actual accepted review record and host manifest are required');
  need(address(review.reviewerWallet) === owner, 'Accepted reviewer differs from the owner publishing this plan');
  const manifestHash = api.computeModuleModeHostManifestHash(manifest);
  const entry = { ...manifest.manifest.catalogDefinition, status: 'available', nativeBinding: {
    ...Object.fromEntries(['familyId', 'packageId', 'factory', 'factoryCodeHash', 'moduleCodeHash', 'callbackGas'].map(key => [key, binding[key]])),
    manifestHash, reviewDigest: review.decisionDigest,
  } };
  api.verifyModuleModePublication({ release: identity, publication: { entry, requestDigest: source.requestDigest, review }, ...input });
  const { artifactDigest, ...contents } = artifact;
  need(artifact.schemaVersion === 'programmable.modules.native-build.v1' && artifact.authority === 'programmable.module-review.native-build.v1'
    && artifactDigest === `0x${sha256(canonicalJson({ domain: artifact.schemaVersion, value: contents }))}`
    && artifactDigest === review.command.artifactDigest, 'Accepted build artifact digest differs');
  equal(artifact.subject, review.subject, 'Artifact review subject');
  need(artifact.approved === false && artifact.registryApproved === false && artifact.available === false
    && artifact.tests?.allRequiredChecksPassed === true && artifact.compiler?.reproducible === true, 'Passing immutable build artifact required');
  need(Array.isArray(artifact.reviewRequired) && artifact.reviewRequired.length > 0
    && artifact.reviewRequired.every(area => review.command.acknowledgedReviewAreas.includes(area)), 'Accepted review has unacknowledged required areas');
  for (const key of ['packageId', 'familyId', 'callbackGas']) equal(artifact[key], binding[key], `Artifact ${key}`);
  equal(artifact.programAbi, manifest.manifest.configuration.abiMapping, 'Artifact configuration ABI');
  const descriptor = source.request.descriptor;
  equal(artifact.rewardWallet, address(descriptor.rewardWallet), 'Artifact reward wallet');
  const factory = artifact.factory, program = artifact.program;
  need(factory && program && Array.isArray(factory.abi) && !factory.abi.some(item => item.type === 'constructor' && item.inputs?.length), 'This factory path requires no constructor arguments');
  for (const part of [factory, program]) {
    need(bytes(part.creationBytecode) !== '0x' && bytes(part.runtimeBytecode) !== '0x'
      && keccak256(part.creationBytecode) === hash(part.creationCodeHash) && keccak256(part.runtimeBytecode) === hash(part.runtimeCodeHash), 'Artifact bytecode hash differs');
    need(descriptor.components.some(component => component.sourcePath === part.sourcePath && component.entrypoint === part.contractName), 'Artifact source component differs');
  }
  need((factory.creationBytecode.length - 2) / 2 <= 49152 && (factory.runtimeBytecode.length - 2) / 2 <= 24576, 'Factory EVM size bound exceeded');
  equal(factory.runtimeCodeHash, binding.factoryCodeHash, 'Factory runtime'); equal(program.runtimeCodeHash, binding.moduleCodeHash, 'Module runtime');
  const predicted = getCreate2Address({ from: OFFICIAL.deterministicDeployer.address, salt: hash(input.factorySalt), bytecode: factory.creationBytecode }).toLowerCase();
  need(predicted === binding.factory, 'Factory is not the exact supplied CREATE2 salt and reviewed bytecode address');
  return { title: manifest.manifest.catalogDefinition.title, packageId: source.packageId, familyId: source.familyId, author: address(descriptor.author), familySalt: hash(descriptor.familySalt),
    rewardWallet: address(descriptor.rewardWallet), requestDigest: source.requestDigest, manifestHash, reviewDigest: review.decisionDigest, artifactDigest,
    factory: predicted, factorySalt: hash(input.factorySalt), factoryCodeHash: factory.runtimeCodeHash, moduleCodeHash: program.runtimeCodeHash, callbackGas: binding.callbackGas,
    factoryCreationBytecode: factory.creationBytecode, factoryRuntimeBytecode: factory.runtimeBytecode };
}
export async function createPublicationPlan({ identity, owner, modules, sourceState }) {
  await bindIdentity(identity); owner = address(owner); need(Array.isArray(modules) && modules.length > 0 && modules.length <= 8, 'One to eight reviewed modules required');
  const checked = []; for (const item of modules) checked.push(await bindPublicationModule(item, identity, owner));
  need(new Set(checked.map(m => m.packageId)).size === checked.length && new Set(checked.map(m => m.familyId)).size === checked.length, 'Duplicate module package or family');
  const registry = identity.contracts.registry.address, steps = [];
  for (const item of checked) {
    const pin = { address: item.factory, runtimeCodeHash: item.factoryCodeHash };
    steps.push({ kind: 'factory', label: `Deploy ${item.title} factory`, sender: owner, to: OFFICIAL.deterministicDeployer.address, value: '0',
      data: `${item.factorySalt}${item.factoryCreationBytecode.slice(2)}`, target: item.factory, packageId: item.packageId,
      functionName: 'CREATE2', arguments: { salt: item.factorySalt, creationCodeHash: keccak256(item.factoryCreationBytecode), constructorArguments: [] },
      result: item.factory, preReads: [], postReads: [], newCode: [pin] });
    const args = [item.author, item.familySalt, item.rewardWallet, item.requestDigest];
    steps.push({ kind: 'family', label: `Register ${item.title} contributor family`, sender: owner, to: registry, value: '0', target: registry, packageId: item.packageId,
      functionName: 'registerReviewedFamily', arguments: jsonSafe(args), data: encodeFunctionData({ abi: registryAbi, functionName: 'registerReviewedFamily', args }),
      result: encodeFunctionResult({ abi: registryAbi, functionName: 'registerReviewedFamily', result: item.familyId }),
      preReads: [readCondition(registry, registryAbi, 'families', [item.familyId], [ZERO_ADDRESS, ZERO_ADDRESS])],
      postReads: [readCondition(registry, registryAbi, 'families', [item.familyId], [item.author, item.rewardWallet])], newCode: [] });
    const revision = { familyId: item.familyId, factory: item.factory, factoryCodeHash: item.factoryCodeHash, moduleCodeHash: item.moduleCodeHash,
      manifestHash: item.manifestHash, callbackGas: item.callbackGas, enabled: true };
    const revisionArgs = [item.packageId, item.familyId, item.factory, item.moduleCodeHash, item.manifestHash, item.callbackGas];
    steps.push({ kind: 'revision', label: `Admit ${item.title} revision`, sender: owner, to: registry, value: '0', target: registry, packageId: item.packageId,
      functionName: 'approveRevision', arguments: jsonSafe(revisionArgs), data: encodeFunctionData({ abi: registryAbi, functionName: 'approveRevision', args: revisionArgs }), result: '0x',
      preReads: [readCondition(registry, registryAbi, 'families', [item.familyId], [item.author, item.rewardWallet])],
      postReads: [readCondition(registry, registryAbi, 'getRevision', [item.packageId], revision)], newCode: [] });
  }
  const body = { schemaVersion: PUBLICATION_PLAN_SCHEMA, chainId: 4663, sourceCommit: sourceState.sourceCommit, sourceTree: sourceState.sourceTree,
    sourceClean: sourceState.sourceClean, identity, owner, modules, steps };
  return { ...body, planDigest: digest(PUBLICATION_PLAN_SCHEMA, body) };
}
export async function assertPublicationPlan(plan) {
  const rebuilt = await createPublicationPlan({ identity: plan.identity, owner: plan.owner, modules: plan.modules, sourceState: plan });
  equal(plan, rebuilt, 'Publication plan'); return plan;
}
/** The existing fixed-origin private BFF reader is the only runtime review authority. Local JSON is a consistency input. */
export async function assertAuthenticatedOperationPlan(plan, sessionFile) {
  if (!plan.modules.length) return;
  need(typeof sessionFile === 'string' && sessionFile.length > 0, 'Private reviewer session file required for module operations');
  const api = await publicationValidators(), session = await api.readOperatorSession(sessionFile);
  need(address(session.walletAddress) === plan.owner, 'Reviewer session differs from the owner');
  const reader = api.createAuthenticatedReviewReader(session);
  for (const input of plan.modules) {
    const current = await reader.read(input.review.subject.submissionId), decision = api.acceptedDecision(current);
    equal(decision, input.review, 'Current authenticated review decision');
    equal(current.source, input.source, 'Current authenticated source'); equal(current.artifact, input.artifact, 'Current protected worker artifact');
    const host = api.createHostPreparation(current, plan.identity, input.manifest.manifest.catalogDefinition);
    equal(host.manifest, input.manifest, 'Canonical authenticated host manifest'); equal(host.salt, input.factorySalt, 'Canonical factory salt');
  }
}
export async function readOperatorJson(filename) { const data = await readFile(filename); need(data.length <= 32 * 1024 * 1024, 'Operator input exceeds 32 MiB'); return exactJson(data, 'Operator input'); }
async function main(argv) {
  const options = {}; let candidate = false;
  for (let i = 0; i < argv.length; i++) { const key = argv[i]; if (key === '--candidate') { need(!candidate, 'Duplicate candidate option'); candidate = true; continue; }
    need(['--identity', '--modules', '--owner', '--output'].includes(key) && !options[key] && argv[i + 1] && !argv[i + 1].startsWith('--'), 'Expected --identity FILE --modules FILE --owner ADDRESS --output FILE [--candidate]'); options[key] = argv[++i]; }
  need(Object.keys(options).length === 4, 'All publication inputs are required'); const state = await repositoryState();
  need(candidate || state.sourceClean, 'Clean source required; --candidate never authorizes a wallet');
  const plan = await createPublicationPlan({ identity: await readOperatorJson(options['--identity']), modules: await readOperatorJson(options['--modules']), owner: options['--owner'], sourceState: { ...state, sourceClean: !candidate && state.sourceClean } });
  await writeFile(options['--output'], `${canonicalJson(plan)}\n`, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ planDigest: plan.planDigest, steps: plan.steps.length, sourceClean: plan.sourceClean, authority: 'preparation-only' }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
