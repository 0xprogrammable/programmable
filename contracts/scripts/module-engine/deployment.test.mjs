import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeFunctionData, encodeFunctionResult, getContractAddress, keccak256, parseAbi, parseAbiParameters, toHex } from 'viem';
import { fixtures, params } from '../module-mode/test-fixtures.mjs';
import { buildPlan, digest, REWARD_ADMIN, TREASURY } from '../module-mode/core.mjs';
import { evidenceBytes, evidenceDigest } from '../module-mode/evidence.mjs';
import { ECONOMICS_POLICY_ID } from '../module-native-v2/core.mjs';
import { assertEnginePlan, buildEnginePlan, ENGINE_DEPLOYMENT_SCHEMA, ENGINE_REUSED_ROLES, ENGINE_REUSE_DOMAIN } from './core.mjs';
import { engineConstructorArguments, engineSourceCreation, engineSourceRequests, engineSourceReuse } from './evidence.mjs';
import { observeEngineBindings } from './rpc.mjs';
import { createEngineLifecyclePlan } from './lifecycle-plan.mjs';
import { engineWire } from './shared.mjs';
const h = value => keccak256(toHex(value));

// Explicitly synthetic test fixtures. Engine preparation always invokes the real pinned compiler/source sealer.
async function fixture() {
  const base = fixtures(), previousPlan = buildPlan(base, params), names = ['tokenFactory', 'launchPolicy', 'registry', 'ledger'];
  const host = { abi: [{ type: 'constructor', stateMutability: 'nonpayable', inputs: parseAbiParameters('address tokenFactory,address launchPolicy,address registry,address poolManager,address treasury,address rewardAdmin') }],
    bytecode: { object: '0x6000206000' }, deployedBytecode: { object: `0x${'00'.repeat(128)}`,
      immutableReferences: Object.fromEntries(names.map((name, index) => [String(index), [{ start: index * 32, length: 32 }]])) },
    immutableNames: Object.fromEntries(names.map((name, index) => [String(index), name])), compilationTarget: { 'src/host.sol': 'HostFixture' } };
  const ledger = structuredClone(base.artifacts.rewardLedger);
  ledger.abi[0].inputs = parseAbiParameters('address poolManager,address registry,address treasury,address rewardAdmin');
  delete ledger.immutableNames['5']; delete ledger.deployedBytecode.immutableReferences['5'];
  const artifacts = { ...Object.fromEntries(['tokenFactory', 'token', 'launchPolicy', 'registry'].map(role => [role, base.artifacts[role]])), host, ledger };
  const build = { ...base, sourceClean: false, artifacts,
    standardInputs: Object.fromEntries(Object.keys(artifacts).map(role => [role, { language: 'Solidity', sources: { [`src/${role}.sol`]: { content: '// fixture only' } }, settings: {} }])) };
  const previousRelease = { ...previousPlan.identityCandidate, enabled: true, status: 'active', startBlock: '10', releaseDigest: h('historical-release-fixture') };
  const previousSource = { chainId: 4663, releaseDigest: previousRelease.releaseDigest, sourceCommit: previousRelease.sourceCommit,
    status: 'exact-source-and-runtime-verified', records: ENGINE_REUSED_ROLES.map(role => ({ role, ...previousPlan.identityCandidate.contracts[role],
      sourcePaths: [`src/${role}.sol`], sourceCommit: previousRelease.sourceCommit, creationTransactionHash: h(`old-${role}`) })) };
  const previousRaw = evidenceBytes(previousSource); previousRelease.sourceVerificationDigest = evidenceDigest(previousRaw);
  const body = { schemaVersion: 'programmable.module-mode-native-v2-basis.v1', chainId: 4663, provenance: { sourceCommit: build.sourceCommit },
    previousRelease, deploymentOwner: params.owner, registryOwner: params.reviewAuthority, treasury: TREASURY, rewardAdmin: REWARD_ADMIN };
  const basis = { ...body, basisDigest: digest(body.schemaVersion, body) };
  build.reuseSourceProvenance = { previousReleaseDigest: previousRelease.releaseDigest, previousSourceCommit: previousRelease.sourceCommit };
  build.reuseSourceDigest = digest(ENGINE_REUSE_DOMAIN, build.reuseSourceProvenance);
  const parameters = { owner: params.owner, reviewAuthority: params.reviewAuthority, releaseLabel: 'fixture-engine-v1' };
  const plan = await buildEnginePlan(build, parameters, basis);
  return { build, plan, parameters, basis, previousPlan, previousRaw };
}

test('one zero-value Host+Ledger deployment preserves actual retained roles and the separate six-pin Engine wire', async () => {
  const { build, plan } = await fixture(), wire = await engineWire(); await assertEnginePlan(plan, build);
  assert.equal(plan.steps.length, 1); assert.equal(plan.steps[0].role, 'host'); assert.equal(plan.steps[0].value, '0');
  assert.deepEqual(plan.steps[0].expectedRoles, ['host', 'ledger']);
  assert.deepEqual(Object.keys(plan.identityCandidate.contracts).sort(), [...wire.MODULE_ENGINE_CONTRACTS].sort());
  assert.equal(plan.sourceId, wire.MODULE_ENGINE_SOURCE_ID); assert.equal(plan.identityCandidate.sourceVersion, 'module-engine-v1');
  assert.equal(plan.identityCandidate.economicsPolicyId, ECONOMICS_POLICY_ID);
  assert.equal(Object.hasOwn(plan.identityCandidate, 'tokenRuntimeCodeHash'), false);
  assert.equal((engineConstructorArguments(plan, 'host').length - 2) / 2, 192);
  assert.equal((engineConstructorArguments(plan, 'ledger').length - 2) / 2, 128);
  assert.equal(getContractAddress({ from: plan.contracts.host.address, nonce: 1n }).toLowerCase(), plan.contracts.ledger.address);
  assert.equal(Object.hasOwn(plan.identityCandidate, 'startBlock'), false); assert.equal(Object.hasOwn(plan.identityCandidate, 'releaseDigest'), false);
  for (const role of ENGINE_REUSED_ROLES) assert.deepEqual(plan.identityCandidate.contracts[role], plan.basis.previousRelease.contracts[role]);
  assert.equal(Object.hasOwn(plan.contracts, 'converter'), false); assert.equal(Object.hasOwn(plan.parameters, 'weth'), false);
});

test('different retained registry, source, treasury, token and oversized Host cannot be prepared', async () => {
  const f = await fixture(), altered = structuredClone(f.plan); altered.sourceId = h('native-source');
  await assert.rejects(assertEnginePlan(altered, f.build), /differs/);
  const build = structuredClone(f.build); build.artifacts.registry.deployedBytecode.object = '0xdeadbeef';
  await assert.rejects(buildEnginePlan(build, f.parameters, f.basis), /reused compiled runtime/);
  const oversized = structuredClone(f.build); oversized.artifacts.host.bytecode.object = `0x${'00'.repeat(48961)}`;
  await assert.rejects(buildEnginePlan(oversized, f.parameters, f.basis), /EIP-3860/);
  const token = structuredClone(f.build); token.artifacts.token.bytecode.object = '0xdeadbeef';
  await assert.rejects(buildEnginePlan(token, f.parameters, f.basis), /primary-token/);
  const badBasis = structuredClone(f.basis); badBasis.treasury = params.owner; const { basisDigest, ...body } = badBasis; badBasis.basisDigest = digest(body.schemaVersion, body);
  await assert.rejects(buildEnginePlan(f.build, f.parameters, badBasis), /rights differ/);
});

test('Engine source requests require real Host receipt lineage and preserve three original source creation hashes', async () => {
  const { build, plan, previousRaw } = await fixture(), requests = engineSourceRequests(plan, build);
  assert.deepEqual(Object.keys(requests), ['host', 'ledger']);
  for (const request of Object.values(requests)) assert.equal(Object.hasOwn(request.body, 'creationTransactionHash'), false);
  assert.throws(() => engineSourceCreation(plan, 'ledger', { schemaVersion: 'programmable.module-mode-deployment-evidence.v1' }), /Engine deployment/);
  const evidence = { schemaVersion: ENGINE_DEPLOYMENT_SCHEMA, chainId: 4663, sourceVersion: plan.identityCandidate.sourceVersion, sourceId: plan.sourceId,
    economicsPolicyId: plan.economics.economicsPolicyId,
    sourceCommit: plan.sourceCommit, planDigest: plan.planDigest, buildDigest: plan.buildDigest, status: 'included-code-verified', records: [{
      role: 'host', status: 'included-code-verified-unfinalized', transaction: { from: params.owner, hash: h('host-tx') }, receipt: { status: '0x1', transactionHash: h('host-tx'), blockNumber: '0x20', transactionIndex: '0x0' },
      contracts: { host: plan.identityCandidate.contracts.host, ledger: plan.identityCandidate.contracts.ledger } }] };
  assert.equal(engineSourceCreation(plan, 'ledger', evidence).deployer, plan.contracts.host.address);
  assert.throws(() => engineSourceCreation(plan, 'ledger', { ...evidence, economicsPolicyId: h('old-policy') }), /Engine deployment/);
  assert.equal(engineSourceRequests(plan, build, evidence).ledger.body.creationTransactionHash, h('host-tx'));
  const reused = engineSourceReuse(plan, build, previousRaw); assert.equal(reused.length, 3);
  for (const record of reused) { assert.equal(record.creationTransactionHash, h(`old-${record.role}`)); assert.equal(record.reuse.newCreationTransaction, false); }
  assert.throws(() => engineSourceReuse(plan, build, Buffer.concat([previousRaw, Buffer.from(' ')])), /historical source evidence/);
});

function providersFor(plan, previousPlan, override = {}) {
  const calls = new Map(), blockNumber = '0x20', blockHash = h('engine-block');
  function getter(target, signature, result) {
    const abi = parseAbi([signature]), functionName = abi[0].name;
    calls.set(`${target}:${encodeFunctionData({ abi, functionName })}`, encodeFunctionResult({ abi, functionName, result }));
  }
  const p = plan.contracts, old = plan.basis.previousRelease.contracts.rewardLedger;
  getter(p.registry.address, 'function owner() view returns (address)', params.reviewAuthority);
  getter(old.address, 'function treasury() view returns (address)', TREASURY); getter(old.address, 'function rewardAdmin() view returns (address)', REWARD_ADMIN);
  getter(p.host.address, 'function SOURCE_VERSION() view returns (bytes32)', override.sourceId ?? plan.sourceId);
  getter(p.ledger.address, 'function ECONOMICS_POLICY_ID() view returns (bytes32)', override.policy ?? ECONOMICS_POLICY_ID);
  getter(p.ledger.address, 'function PROTOCOL_FEE_BPS() view returns (uint16)', 10); getter(p.ledger.address, 'function AUTHOR_POOL_FEE_BPS() view returns (uint16)', 20);
  const links = { host: { tokenFactory: p.tokenFactory.address, launchPolicy: p.launchPolicy.address, registry: p.registry.address, ledger: p.ledger.address },
    ledger: { poolManager: plan.official.poolManager.address, registry: p.registry.address, hook: p.host.address, treasury: TREASURY, rewardAdmin: REWARD_ADMIN } };
  for (const [role, fields] of Object.entries(links)) for (const [field, result] of Object.entries(fields)) getter(p[role].address, `function ${field}() view returns (address)`, result);
  const runtimes = new Map([...Object.values(previousPlan.contracts), ...Object.values(p)].map(pin => [pin.address, pin.runtime]));
  const pmRuntime = '0x60206000'; const copy = structuredClone(plan); copy.official.poolManager.runtimeCodeHash = keccak256(pmRuntime); runtimes.set(copy.official.poolManager.address, pmRuntime);
  let blocks = 0;
  const rpc = async (method, args) => {
    if (method === 'eth_chainId') return '0x1237';
    if (method === 'eth_getBlockByNumber') return { number: blockNumber, hash: override.reorg && ++blocks > 2 ? h('reorganized') : blockHash };
    if (method === 'eth_getCode') { assert.equal(args[1], blockNumber); return override.badCode === args[0] ? '0xdeadbeef' : runtimes.get(args[0]); }
    if (method === 'eth_call') { assert.equal(args[1], blockNumber); const result = calls.get(`${args[0].to}:${args[0].data}`); assert.ok(result, 'Only known pinned getters'); return result; }
    throw new Error(`Unexpected RPC ${method}`);
  };
  return { plan: copy, providers: [{ providerId: 'a', trustDomain: 'a.test', rpc }, { providerId: 'b', trustDomain: 'b.test', rpc }], blockNumber, blockHash };
}
test('Engine quorum binds source-ID, actual policy, inherited authority and Host-owned Ledger at the same block', async () => {
  const { plan, previousPlan } = await fixture(), f = providersFor(plan, previousPlan);
  const observed = await observeEngineBindings(f.plan, f.providers, f.blockNumber, f.blockHash, true);
  assert.equal(observed.sourceId, plan.sourceId); assert.equal(observed.reads['ledger.hook'], plan.contracts.host.address);
  assert.equal(observed.reads['ledger.PROTOCOL_FEE_BPS'], '10'); assert.equal(observed.reads['ledger.AUTHOR_POOL_FEE_BPS'], '20');
  for (const override of [{ sourceId: h('native-source') }, { policy: h('old-policy') }, { badCode: plan.contracts.registry.address }, { reorg: true }]) {
    const bad = providersFor(plan, previousPlan, override);
    await assert.rejects(observeEngineBindings(bad.plan, bad.providers, bad.blockNumber, bad.blockHash, true), /differs|disagreement|reorganized/);
  }
  await assert.rejects(observeEngineBindings(f.plan, [f.providers[0], f.providers[0]], f.blockNumber, f.blockHash, true), /Independent/);
});

test('Engine lifecycle plan accepts only bounded actual transaction references and never Native or supplied fee evidence', async () => {
  const { plan } = await fixture(), wire = await engineWire(), candidate = { ...plan.identityCandidate, startBlock: '123' };
  const release = { ...candidate, releaseDigest: wire.computeModuleEngineReleaseDigest(candidate) };
  const canaries = [{ launchId: h('launch-id'), launchTransactionHash: h('launch-tx'), manifestHash: h('manifest'), operations: [
    { transactionHash: h('operation-tx'), operationId: h('settlement.request.v1'), actor: params.owner, nonce: '0' }] }];
  const result = await createEngineLifecyclePlan(release, canaries); assert.equal(result.schemaVersion, 'programmable.module-engine-lifecycle-plan.v1');
  assert.equal(Object.hasOwn(result, 'feeState'), false); assert.equal(Object.hasOwn(result, 'receipts'), false);
  const injected = structuredClone(canaries); injected[0].feeState = {};
  await assert.rejects(createEngineLifecyclePlan(release, injected), /unexpected keys/);
  const duplicate = structuredClone(canaries); duplicate[0].operations[0].transactionHash = duplicate[0].launchTransactionHash;
  await assert.rejects(createEngineLifecyclePlan(release, duplicate), /Duplicate lifecycle/);
  await assert.rejects(createEngineLifecyclePlan({ ...release, sourceVersion: 'module-native-v2' }, canaries), /Unsupported engine/);
});
