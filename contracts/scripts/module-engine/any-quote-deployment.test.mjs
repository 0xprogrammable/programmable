import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAbiParameters, encodeAbiParameters, getCreate2Address, getContractAddress,
  keccak256, parseAbiParameters, toHex } from 'viem';
import { fixtures, params, addr } from '../module-mode/test-fixtures.mjs';
import { buildPlan, digest, HOOK_FLAGS, HOOK_MASK } from '../module-mode/core.mjs';
import { observeReceipt, walletRequest } from '../module-mode/rpc.mjs';
import { operatorSourceProfile } from '../module-mode/operator.mjs';
import { anyQuoteConstructorArguments, anyQuoteSourceCreation, anyQuoteSourceRequests } from './any-quote-evidence.mjs';
import { assertAnyQuotePlan, assertAnyQuoteProfile, buildAnyQuotePlan, ANY_QUOTE_DEPLOYMENT_SCHEMA,
  ANY_QUOTE_REUSE_DOMAIN, ANY_QUOTE_ROUTER } from './any-quote-core.mjs';
import { observeAnyQuoteReceipt, observeAnyQuoteStage } from './any-quote-rpc.mjs';
import { engineResourceCommitment, sourceProfile } from '../module-mode/launch-source-profiles.mjs';
import { selectAnyQuoteNativeBasis } from './any-quote-basis.mjs';
import { createEngineLifecyclePlan } from './lifecycle-plan.mjs';
import { engineWire } from './shared.mjs';
const h = s => keccak256(toHex(s));
function artifact(role, names = [], inputs = '') {
  return { abi: inputs ? [{ type: 'constructor', stateMutability: 'nonpayable', inputs: parseAbiParameters(inputs) }] : [],
    bytecode: { object: `0x60${role.length.toString(16).padStart(2, '0')}6000` },
    deployedBytecode: { object: `0x6000${'00'.repeat(names.length * 32)}`, immutableReferences: Object.fromEntries(names.map((name, i) => [String(i), [{ start: 2 + i * 32, length: 32 }]])) },
    immutableNames: Object.fromEntries(names.map((name, i) => [String(i), name])), compilationTarget: { [`src/${role}.sol`]: `${role}Fixture` } };
}
let fixturePromise;
async function fixture() {
  if (!fixturePromise) fixturePromise = (async () => {
    const base = fixtures(), previousPlan = buildPlan(base, params);
    const artifacts = { tokenFactory: base.artifacts.tokenFactory, launchPolicy: base.artifacts.launchPolicy, registry: base.artifacts.registry, token: base.artifacts.token,
      nativeRouteGuard: artifact('guard'), engine: artifact('engine'),
      host: artifact('host', ['tokenFactory', 'launchPolicy', 'registry', 'sharedHook', 'nativeRouteGuard', 'ledger', 'quotePoolManager', 'quotePoolManagerCodeHash'],
        'address tokenFactory,address launchPolicy,address registry,address poolManager,address rewardAdmin,bytes32 hookSalt,address nativeRouteGuard'),
      sharedHook: artifact('sharedHook', ['poolManager', 'host', 'ledger'], 'address poolManager,address host,address rewardAdmin'),
      ledger: artifact('ledger', ['poolManager', 'host', 'hook', 'rewardAdmin'], 'address poolManager,address host,address rewardAdmin') };
    const hostSource = `SOURCE_VERSION = keccak256("programmable.module-engine.any-quote.v1");\n${Object.entries({
      TOKEN_FACTORY_CODE_HASH: previousPlan.contracts.tokenFactory.runtimeCodeHash,
      LAUNCH_POLICY_CODE_HASH: previousPlan.contracts.launchPolicy.runtimeCodeHash,
      NATIVE_ROUTE_GUARD_CODE_HASH: keccak256(artifacts.nativeRouteGuard.deployedBytecode.object),
      UNIVERSAL_ROUTER: ANY_QUOTE_ROUTER.address, UNIVERSAL_ROUTER_CODE_HASH: ANY_QUOTE_ROUTER.runtimeCodeHash,
    }).map(([key, value]) => `${key} = ${value};`).join('\n')}`;
    const build = { ...base, artifacts, standardInputs: Object.fromEntries(Object.keys(artifacts).map(role => [role,
      { language: 'Solidity', sources: { [role === 'host' ? 'src/module-engine/any-quote/ModuleEngineAnyQuoteHostV1.sol' : `src/${role}.sol`]: { content: role === 'host' ? hostSource : '// synthetic fixture only' } }, settings: {} }])) };
    const previousRelease = { ...previousPlan.identityCandidate, enabled: true, status: 'active', startBlock: '10', releaseDigest: h('prior-release') };
    const body = { schemaVersion: 'programmable.module-mode-native-v2-basis.v1', chainId: 4663, provenance: { sourceCommit: build.sourceCommit },
      previousRelease, deploymentOwner: params.owner, registryOwner: params.reviewAuthority, rewardAdmin: previousPlan.economics.rewardAdmin };
    const basis = { ...body, basisDigest: digest(body.schemaVersion, body) };
    build.reuseSourceProvenance = { previousReleaseDigest: previousRelease.releaseDigest, previousSourceCommit: previousRelease.sourceCommit };
    build.reuseSourceDigest = digest(ANY_QUOTE_REUSE_DOMAIN, build.reuseSourceProvenance);
    const parameters = { owner: params.owner, ownerNonce: '42', reviewAuthority: params.reviewAuthority, releaseLabel: 'test-any-quote-v1' };
    return { build, basis, parameters, plan: await buildAnyQuotePlan(build, parameters, basis) };
  })();
  return structuredClone(await fixturePromise);
}
test('Any Quote lifecycle references use actual shared-pool swap and quote-claim log identities', async () => {
  const f = await fixture(), candidate = { ...f.plan.identityCandidate, startBlock: '123' };
  const release = { ...candidate, releaseDigest: (await engineWire()).computeModuleEngineReleaseDigest(candidate) };
  const canary = { launchId: h('launch'), launchTransactionHash: h('launch-transaction'), manifestHash: h('manifest'), operations: [
    { kind: 'quote-pool-swap', transactionHash: h('buy'), logIndex: 4, poolId: h('pool'), buy: true },
    { kind: 'quote-pool-swap', transactionHash: h('sell'), logIndex: 7, poolId: h('pool'), buy: false },
    { kind: 'quote-claim', transactionHash: h('claim'), logIndex: 2, asset: addr(98), beneficiary: addr(90), recipient: addr(91) },
  ] };
  const plan = await createEngineLifecyclePlan(release, [canary]); assert.deepEqual(plan.canaries[0], canary);
  for (const mutate of [v => { v.operations[0].logIndex = -1; }, v => { delete v.operations[1].poolId; },
    v => { v.operations[2].actor = addr(90); }, v => { v.operations[2].transactionHash = v.operations[1].transactionHash; },
    v => { v.operations[0].kind = 'execute'; }]) {
    const changed = structuredClone(canary); mutate(changed); await assert.rejects(createEngineLifecyclePlan(release, [changed]));
  }
});
test('shared hook is mined once for nonce-bound CREATE Host; guard, Hook child ledger and nine pins are exact', async () => {
  const { plan, build } = await fixture(); await assertAnyQuotePlan(plan, build); assertAnyQuoteProfile(plan);
  assert.equal(plan.steps[1].to, null); assert.equal(plan.steps[1].nonce, '43');
  assert.equal(plan.contracts.host.address, getContractAddress({ from: plan.parameters.owner, nonce: 43n }).toLowerCase());
  assert.equal(plan.contracts.nativeRouteGuard.address, getCreate2Address({ from: plan.steps[0].to, salt: plan.steps[0].salt, bytecodeHash: plan.steps[0].initcodeHash }).toLowerCase());
  assert.equal(plan.contracts.sharedHook.address, getCreate2Address({ from: plan.contracts.host.address, salt: plan.sharedHookCreation.salt,
    bytecodeHash: plan.sharedHookCreation.initcodeHash }).toLowerCase());
  assert.equal(BigInt(plan.contracts.sharedHook.address) & HOOK_MASK, HOOK_FLAGS);
  assert.equal(plan.contracts.ledger.address, getContractAddress({ from: plan.contracts.sharedHook.address, nonce: 1n }).toLowerCase());
  assert.equal(Object.keys(plan.identityCandidate.contracts).length, 9);
  const args = decodeAbiParameters(plan.steps[1].constructorInputs, anyQuoteConstructorArguments(plan, 'host'));
  assert.equal(args[5], plan.sharedHookCreation.salt); assert.equal(args[6].toLowerCase(), plan.contracts.nativeRouteGuard.address);
  assert.equal(anyQuoteConstructorArguments(plan, 'nativeRouteGuard'), '0x');
  assert.equal(plan.economics.platformFeeBps, 30); assert.equal(plan.economics.feeAsset, 'per-launch-quote-asset');
  assert.deepEqual(Object.keys(anyQuoteSourceRequests(plan, build)), ['nativeRouteGuard', 'host', 'sharedHook', 'ledger']);
});
test('retained V1 basis survives current V2 activation and refuses different or ambiguous retained pins', async () => {
  const { basis } = await fixture(), v1 = basis.previousRelease, engine = { contracts: v1.contracts };
  const empty = { schemaVersion: 'programmable.module-mode-historical-releases.v1', releases: [] };
  assert.deepEqual(selectAnyQuoteNativeBasis(v1, empty, engine), v1);
  const history = { ...empty, releases: [{ release: v1 }] }, current = { ...v1, sourceVersion: 'module-native-v2' };
  assert.deepEqual(selectAnyQuoteNativeBasis(current, history, engine), v1);
  assert.deepEqual(selectAnyQuoteNativeBasis(v1, history, engine), v1, 'Same current/history identity is deduplicated');
  assert.throws(() => selectAnyQuoteNativeBasis(current, history, { contracts: { ...engine.contracts, registry: { ...engine.contracts.registry, address: addr(88) } } }), /Exactly one/);
  assert.throws(() => selectAnyQuoteNativeBasis(current, { ...empty, releases: [{ release: v1 }, { release: { ...v1, releaseDigest: h('different') } }] }, engine), /Exactly one/);
});
test('source identity, guard runtime pin, economics and economic-size limits fail closed', async () => {
  const { plan, build, parameters, basis } = await fixture();
  for (const mutate of [p => { p.steps[1].nonce = '44'; }, p => { p.identityCandidate.contracts.nativeRouteGuard.runtimeCodeHash = h('wrong'); },
    p => { p.economics.platformFeeBps = 10; }, p => { p.economics.platformRecipient = addr(22); }, p => { p.sharedHookCreation.salt = h('wrong'); }]) {
    const copy = structuredClone(plan); mutate(copy); await assert.rejects(assertAnyQuotePlan(copy, build), /differs/);
  }
  const bad = structuredClone(build); bad.standardInputs.host.sources['src/module-engine/any-quote/ModuleEngineAnyQuoteHostV1.sol'].content = '';
  await assert.rejects(buildAnyQuotePlan(bad, parameters, basis), /compiled Host/);
  const huge = structuredClone(build); huge.artifacts.host.bytecode.object = `0x${'01'.repeat(48929)}`;
  await assert.rejects(buildAnyQuotePlan(huge, parameters, basis), /EIP-3860/);
  const wrongGuard = structuredClone(build); wrongGuard.artifacts.nativeRouteGuard.deployedBytecode.object = '0x6001';
  await assert.rejects(buildAnyQuotePlan(wrongGuard, parameters, basis), /NATIVE_ROUTE_GUARD_CODE_HASH/);
});
test('existing manual operator selects only the exact Any Quote profile and preserves the nonce in wallet request', async () => {
  const { plan } = await fixture(), profile = operatorSourceProfile(plan);
  assert.equal(profile.observeStage, observeAnyQuoteStage); assert.equal(profile.observeReceipt, observeAnyQuoteReceipt);
  const observation = { state: 'vacant-simulated', stepIndex: 1, nonce: '43', gasLimit: '100000', baseFeePerGas: '1', minimumBalance: '1000000000' };
  const ceilings = { maxGas: '100001', maxFeePerGas: '10', maxPriorityFeePerGas: '1' }, request = walletRequest(plan, observation, ceilings);
  assert.equal(Object.hasOwn(request, 'to'), false); assert.equal(request.nonce, '0x2b');
  assert.throws(() => walletRequest(plan, { ...observation, nonce: '44' }, ceilings), /nonce/);
  const mixed = structuredClone(plan); mixed.identityCandidate.sourceVersion = 'module-engine-v1'; assert.throws(() => operatorSourceProfile(mixed));
  const old = structuredClone(plan); old.schemaVersion = 'programmable.module-engine-deployment-plan.v1'; assert.throws(() => walletRequest(old, observation, ceilings), /Direct creation/);
});
test('direct Host receipt requires CREATE address, reserved nonce, wallet payload and all child runtimes', async () => {
  const { plan } = await fixture(), step = plan.steps[1], transactionHash = h('included-host'), blockHash = h('inclusion-block');
  const request = walletRequest(plan, { state: 'vacant-simulated', stepIndex: 1, nonce: '43', gasLimit: '100000', baseFeePerGas: '1', minimumBalance: '1000000000' },
    { maxGas: '100000', maxFeePerGas: '10', maxPriorityFeePerGas: '1' });
  const entry = { request, stepIndex: 1, transactionHash };
  function providers(overrides = {}) {
    const tx = { ...request, to: null, input: request.data, hash: transactionHash, blockHash, blockNumber: '0x70', ...overrides.transaction };
    const receipt = { transactionHash, blockHash, blockNumber: '0x70', status: '0x1', gasUsed: '0x100', transactionIndex: '0x1', contractAddress: step.target, ...overrides.receipt };
    return [0, 1].map(i => ({ providerId: `fixture-${i}`, trustDomain: `fixture-${i}.example`, rpc: async (method, args) => {
      if (method === 'eth_getTransactionByHash') return tx;
      if (method === 'eth_getTransactionReceipt') return receipt;
      if (method === 'eth_getBlockByNumber') return { hash: blockHash, transactions: [transactionHash] };
      if (method === 'eth_getCode') return Object.values(plan.contracts).find(pin => pin.address === args[0])?.runtime ?? '0x';
      throw new Error(`Unexpected receipt RPC ${method}`);
    } }));
  }
  const evidence = await observeReceipt(plan, entry, providers());
  assert.equal(evidence.status, 'included-code-verified-unfinalized'); assert.equal(evidence.receipt.contractAddress, step.target);
  assert.deepEqual(Object.keys(evidence.contracts), ['host', 'sharedHook', 'ledger']);
  await assert.rejects(observeReceipt(plan, entry, providers({ receipt: { contractAddress: addr(88) } })), /different address/);
  await assert.rejects(observeReceipt(plan, entry, providers({ transaction: { nonce: '0x2c' } })), /nonce/);
  await assert.rejects(observeReceipt(plan, entry, providers({ transaction: { to: addr(88) } })), /does not match/);
});
test('receipt source lineage requires actual matching host creation transaction and constructor', async () => {
  const { plan } = await fixture(); const records = plan.steps.map(step => ({ status: 'included-code-verified-unfinalized', stepIndex: step.index, role: step.role,
    transaction: { hash: h(`tx-${step.index}`), from: step.sender, to: step.to, input: step.data, nonce: toHex(BigInt(step.nonce)) },
    receipt: { status: '0x1', transactionHash: h(`tx-${step.index}`), blockNumber: '0x70', transactionIndex: '0x1', ...(step.to === null ? { contractAddress: step.target } : {}) },
    contracts: Object.fromEntries(step.expectedRoles.map(role => [role, plan.identityCandidate.contracts[role]])) }));
  const evidence = { schemaVersion: ANY_QUOTE_DEPLOYMENT_SCHEMA, chainId: 4663, sourceVersion: plan.identityCandidate.sourceVersion,
    sourceId: plan.sourceId, economicsPolicyId: plan.economics.economicsPolicyId, sourceCommit: plan.sourceCommit,
    planDigest: plan.planDigest, buildDigest: plan.buildDigest, status: 'included-code-verified', records };
  assert.equal(anyQuoteSourceCreation(plan, 'sharedHook', evidence).deployer, plan.contracts.host.address);
  assert.equal(anyQuoteSourceCreation(plan, 'ledger', evidence).deployer, plan.contracts.sharedHook.address);
  assert.equal(anyQuoteSourceCreation(plan, 'host', evidence).deployer, plan.parameters.owner);
  const wrong = structuredClone(evidence); wrong.records[1].receipt.contractAddress = addr(88);
  assert.throws(() => anyQuoteSourceCreation(plan, 'host', wrong), /creation address/);
  const changed = structuredClone(evidence); changed.records[1].transaction.nonce = '0x2c';
  assert.throws(() => anyQuoteSourceCreation(plan, 'sharedHook', changed), /lineage/);
});
test('Any Quote source resources use the shared hook, signed tick and 0..36 decimal range', async () => {
  const { plan } = await fixture(), token = addr(99), quoteAsset = addr(98), initialTick = -1200;
  const abi = parseAbiParameters('(bytes32 schemaId,address poolManager,bytes32 poolManagerCodeHash,address sharedHook,address quoteAsset,int24 initialTick,uint64 validUntil,bytes32 priceEvidenceHash)');
  const configuration = encodeAbiParameters(abi, [{ schemaId: plan.configurationSchemaId, poolManager: plan.official.poolManager.address,
    poolManagerCodeHash: plan.official.poolManager.runtimeCodeHash, sharedHook: plan.contracts.sharedHook.address, quoteAsset, initialTick,
    validUntil: 100n, priceEvidenceHash: h('price') }]);
  const poolId = keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'), [quoteAsset, token, 0, 200, plan.contracts.sharedHook.address]));
  const state = { poolId, initialTick, tickLower: -887200, tickUpper: initialTick, lockedLiquidity: 10000n, lockedTokenDust: 1n, quoteDecimals: 36 };
  const resourcesHash = keccak256(encodeAbiParameters(parseAbiParameters('bytes32,int24,int24,uint128,uint256,uint8'), [poolId, state.tickLower, state.tickUpper, state.lockedLiquidity, state.lockedTokenDust, state.quoteDecimals]));
  const identity = { launch: { token, quoteAsset, resourcesHash }, parameters: { configuration, launchData: '0x' },
    manifest: { catalogDefinition: { interface: 'quote-shared-v1' } }, anyQuoteRelease: plan.identityCandidate };
  assert.equal(engineResourceCommitment(identity, state), resourcesHash);
  assert.throws(() => engineResourceCommitment(identity, { ...state, quoteDecimals: 37 }), /resources/);
  assert.throws(() => engineResourceCommitment(identity, { ...state, poolId: h('wrong') }), /resources/);
  assert.throws(() => engineResourceCommitment({ ...identity, anyQuoteRelease: undefined }, state), /Authenticated/);
  assert.throws(() => sourceProfile(plan.identityCandidate, { isModuleEngineAnyQuoteRelease: () => false }), /Unsupported/);
});
