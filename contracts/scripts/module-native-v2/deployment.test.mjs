import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, encodeFunctionResult, getCreate2Address, getContractAddress, keccak256, parseAbi, parseAbiParameters, toHex } from 'viem';
import { fixtures, params } from '../module-mode/test-fixtures.mjs';
import { buildPlan, digest, HOOK_FLAGS, HOOK_MASK, REWARD_ADMIN, TREASURY } from '../module-mode/core.mjs';
import { evidenceBytes, evidenceDigest } from '../module-mode/evidence.mjs';
import { buildNativeV2Plan, assertNativeV2Plan, ECONOMICS_POLICY_ID, NEW_ROLES, REUSED_ROLES } from './core.mjs';
import { nativeV2ConstructorArguments, nativeV2ExplorerRequests, nativeV2SourceRequests, nativeV2SourceReuse } from './evidence.mjs';
import { observeNativeV2Bindings } from './rpc.mjs';
import { createNativeV2LifecycleCollectorPlan } from './lifecycle.mjs';
import { sharedValidators } from '../module-mode/shared.mjs';
const h = value => keccak256(toHex(value));

// Synthetic fixtures remain confined to this unit test. Preparation always seals real compiler output.
function fixture() {
  const build = fixtures(), old = buildPlan(build, params);
  build.sourceClean = false;
  build.artifacts.hook.abi[0].inputs = parseAbiParameters('address poolManager,address registry,address runtimeFactory,address treasury,address rewardAdmin');
  build.artifacts.rewardLedger.abi[0].inputs = parseAbiParameters('address poolManager,address registry,address treasury,address rewardAdmin');
  delete build.artifacts.rewardLedger.immutableNames['5']; delete build.artifacts.rewardLedger.deployedBytecode.immutableReferences['5'];
  build.standardInputs = Object.fromEntries(Object.keys(build.artifacts).map(role => [role, { language: 'Solidity', sources: { [`src/${role}.sol`]: { content: '// test fixture only' } }, settings: {} }]));
  const previousRelease = { ...old.identityCandidate, enabled: true, status: 'active', startBlock: '123', releaseDigest: h('fixture-v1-release') };
  const previousSource = { chainId: 4663, releaseDigest: previousRelease.releaseDigest, sourceCommit: previousRelease.sourceCommit,
    status: 'exact-source-and-runtime-verified', records: REUSED_ROLES.map(role => ({ role, ...old.identityCandidate.contracts[role],
      sourcePaths: [`src/${role}.sol`], sourceCommit: previousRelease.sourceCommit, creationTransactionHash: h(`old-${role}`) })) };
  const previousRaw = evidenceBytes(previousSource); previousRelease.sourceVerificationDigest = evidenceDigest(previousRaw);
  const body = { schemaVersion: 'programmable.module-mode-native-v2-basis.v1', chainId: 4663, previousRelease,
    provenance: { sourceCommit: build.sourceCommit },
    deploymentOwner: params.owner, registryOwner: params.reviewAuthority, treasury: TREASURY, rewardAdmin: REWARD_ADMIN,
    minimumInitialBuyNative: params.minimumInitialBuyNative };
  const basis = { ...body, basisDigest: digest(body.schemaVersion, body) };
  build.reuseSourceProvenance = { previousReleaseDigest: previousRelease.releaseDigest, previousSourceCommit: previousRelease.sourceCommit };
  build.reuseSourceDigest = digest('programmable.module-mode-native-v2-reused-source.v1', build.reuseSourceProvenance);
  const parameters = { ...params, releaseLabel: 'fixture-native-v2' };
  return { build, basis, parameters, plan: buildNativeV2Plan(build, parameters, basis), previousRaw };
}

test('four necessary V2 deployments reuse five exact V1 pins and bind the new policy', () => {
  const { build, plan } = fixture();
  assertNativeV2Plan(plan, build);
  assert.deepEqual(plan.steps.map(step => step.role), ['registry', 'swapRouterFactory', 'hook', 'launcher']);
  assert.equal(Object.keys(plan.contracts).length, 13);
  assert.equal(Object.keys(plan.identityCandidate.contracts).length, 15);
  assert.equal(plan.identityCandidate.sourceVersion, 'module-native-v2');
  assert.equal(plan.identityCandidate.economicsPolicyId, ECONOMICS_POLICY_ID);
  assert.equal(plan.economics.platformFeeBpsWithoutEligibleFamilies, 10);
  assert.equal(plan.economics.platformFeeBpsWithEligibleFamilies, 30);
  assert.equal(Object.hasOwn(plan.identityCandidate, 'startBlock'), false);
  assert.equal(Object.hasOwn(plan.identityCandidate, 'releaseDigest'), false);
  for (const role of REUSED_ROLES) assert.deepEqual(plan.identityCandidate.contracts[role], plan.basis.previousRelease.contracts[role]);
  const hook = plan.steps[2];
  assert.equal(BigInt(hook.target) & HOOK_MASK, HOOK_FLAGS);
  for (const step of plan.steps) {
    assert.equal(step.value, '0'); assert.equal(step.sender, params.owner);
    assert.equal(getCreate2Address({ from: plan.official.deterministicDeployer.address, salt: step.salt, bytecodeHash: step.initcodeHash }).toLowerCase(), step.target);
    assert.equal(keccak256(`0x${step.data.slice(66)}`), step.initcodeHash);
  }
  assert.equal(getContractAddress({ from: hook.target, nonce: 1n }).toLowerCase(), plan.contracts.rewardLedger.address);
  assert.equal((nativeV2ConstructorArguments(plan, 'rewardLedger').length - 2) / 2, 128);
  assert.equal(nativeV2ConstructorArguments(plan, 'rewardLedger'), encodeAbiParameters(parseAbiParameters('address,address,address,address'),
    [plan.official.poolManager.address, plan.contracts.registry.address, TREASURY, REWARD_ADMIN]));
  assert.throws(() => nativeV2ConstructorArguments(plan, 'tokenFactory'), /no new creation/);
});

test('altered policy, inherited authority, reused source/runtime, and EIP-3860 overflow fail closed', () => {
  const f = fixture();
  const changed = structuredClone(f.plan); changed.economics.protocolFeeBps = 11;
  assert.throws(() => assertNativeV2Plan(changed, f.build), /differs/);
  const basis = structuredClone(f.basis); basis.treasury = params.owner;
  const { basisDigest, ...body } = basis; basis.basisDigest = digest(basis.schemaVersion, body);
  assert.throws(() => buildNativeV2Plan(f.build, f.parameters, basis), /protocol recipient/);
  const build = structuredClone(f.build); build.artifacts.runtimeFactory.deployedBytecode.object = '0xdeadbeef';
  assert.throws(() => buildNativeV2Plan(build, f.parameters, f.basis), /compiled bytecode differs/);
  const noSource = structuredClone(f.build); delete noSource.reuseSourceProvenance;
  assert.throws(() => buildNativeV2Plan(noSource, f.parameters, f.basis), /original reused V1 source/);
  const oversized = structuredClone(f.build); oversized.artifacts.hook.bytecode.object = `0x${'00'.repeat(48993)}`;
  assert.throws(() => buildNativeV2Plan(oversized, f.parameters, f.basis), /EIP-3860/);
});

test('source requests are eight new contracts only and cannot invent creation receipts', () => {
  const { plan, build } = fixture(), requests = nativeV2SourceRequests(plan, build), explorer = nativeV2ExplorerRequests(plan, build);
  assert.deepEqual(Object.keys(requests), [...NEW_ROLES]);
  assert.deepEqual(Object.keys(explorer), [...NEW_ROLES]);
  for (const request of Object.values(requests)) { assert.equal(request.status, 'incomplete-actual-creation-transaction-required'); assert.equal(Object.hasOwn(request.body, 'creationTransactionHash'), false); }
  assert.equal(explorer.rewardLedger.body.constructor_args.length, 128 * 2);
  assert.throws(() => nativeV2SourceRequests(plan, build, {}), /Matching actual deployment/);
});

test('reuse retains actual historical creation hashes and requires the exact V1 evidence file', () => {
  const { plan, build, previousRaw } = fixture(), records = nativeV2SourceReuse(plan, build, previousRaw);
  assert.equal(records.length, 5);
  for (const record of records) { assert.equal(record.creationTransactionHash, h(`old-${record.role}`)); assert.equal(record.reuse.newCreationTransaction, false); }
  assert.throws(() => nativeV2SourceReuse(plan, build, Buffer.concat([previousRaw, Buffer.from(' ')])), /byte-bound V1/);
});

function providerFixture(plan, override = {}) {
  const calls = new Map(), blockHash = h('fixture-block'), blockNumber = '0x99';
  function getter(target, signature, value) {
    const abi = parseAbi([signature]), functionName = abi[0].name;
    calls.set(`${target}:${encodeFunctionData({ abi, functionName })}`, encodeFunctionResult({ abi, functionName, result: value }));
  }
  const previous = plan.basis.previousRelease.contracts, p = plan.contracts;
  getter(previous.registry.address, 'function owner() view returns (address)', plan.basis.registryOwner);
  getter(previous.rewardLedger.address, 'function treasury() view returns (address)', TREASURY);
  getter(previous.rewardLedger.address, 'function rewardAdmin() view returns (address)', REWARD_ADMIN);
  getter(p.registry.address, 'function owner() view returns (address)', plan.parameters.reviewAuthority);
  for (const role of ['hook', 'rewardLedger', 'launcher', 'swapRouter']) getter(p[role].address, 'function ECONOMICS_POLICY_ID() view returns (bytes32)', override.policy ?? ECONOMICS_POLICY_ID);
  const links = { hook: { poolManager: plan.official.poolManager.address, registry: p.registry.address, runtimeFactory: p.runtimeFactory.address, ledger: p.rewardLedger.address, runtime: p.runtime.address },
    rewardLedger: { poolManager: plan.official.poolManager.address, registry: p.registry.address, hook: p.hook.address, treasury: TREASURY, rewardAdmin: REWARD_ADMIN },
    launcher: { feeHook: p.hook.address, swapRouter: p.swapRouter.address, swapRouterFactory: p.swapRouterFactory.address },
    swapRouter: { poolManager: plan.official.poolManager.address, hook: p.hook.address, source: p.launcher.address },
    runtime: { engine: p.hook.address, vault: p.budgetVault.address }, budgetVault: { runtime: p.runtime.address } };
  for (const [role, fields] of Object.entries(links)) for (const [field, value] of Object.entries(fields)) getter(p[role].address, `function ${field}() view returns (address)`, value);
  getter(p.launcher.address, 'function sourceVersion() view returns (string)', override.sourceVersion ?? 'module-native-v2');
  const old = buildPlan(fixtures(), params), runtimes = new Map([...Object.values(old.contracts), ...Object.values(p)].map(pin => [pin.address, pin.runtime]));
  let blocks = 0;
  const rpc = async (method, args) => {
    if (method === 'eth_chainId') return '0x1237';
    if (method === 'eth_getBlockByNumber') return { number: blockNumber, hash: override.reorg && ++blocks > 2 ? h('reorg') : blockHash };
    if (method === 'eth_getCode') { assert.equal(args[1], blockNumber); return override.badCode === args[0] ? '0xdeadbeef' : runtimes.get(args[0]); }
    if (method === 'eth_call') { assert.equal(args[1], blockNumber); const value = calls.get(`${args[0].to}:${args[0].data}`); assert.ok(value, 'Only bound known getters'); return value; }
    throw new Error(`Unexpected RPC method ${method}`);
  };
  return { providers: [{ providerId: 'fixture-a', trustDomain: 'a.test', rpc }, { providerId: 'fixture-b', trustDomain: 'b.test', rpc }], blockNumber, blockHash };
}

test('quorum V2 binding observer checks retained code, inherited authority, four policy getters, and source version at one block', async () => {
  const { plan } = fixture(), f = providerFixture(plan);
  const result = await observeNativeV2Bindings(plan, f.providers, f.blockNumber, f.blockHash, NEW_ROLES);
  assert.equal(result.previousReleaseDigest, plan.basis.previousRelease.releaseDigest);
  assert.equal(Object.keys(result.reusedContracts).length, 5); assert.equal(Object.keys(result.policyGetters).length, 4);
  for (const override of [{ policy: h('wrong-policy') }, { sourceVersion: 'module-native-v1' }, { badCode: plan.contracts.runtimeFactory.address }, { reorg: true }]) {
    const bad = providerFixture(plan, override);
    await assert.rejects(observeNativeV2Bindings(plan, bad.providers, bad.blockNumber, bad.blockHash, NEW_ROLES), /differs|reorganized|disagreement/);
  }
  await assert.rejects(observeNativeV2Bindings(plan, [f.providers[0], f.providers[0]], f.blockNumber, f.blockHash, []), /Independent/);
});

async function lifecycleFixture() {
  const f = fixture(), { computeModuleModeReleaseDigest } = await sharedValidators();
  const candidate = { ...f.plan.identityCandidate, startBlock: '123' }, identity = { ...candidate, releaseDigest: computeModuleModeReleaseDigest(candidate) };
  const selection = '(bytes32 packageId,address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,uint32 callbackGas,bytes config)';
  f.build.artifacts.launcher.abi = parseAbi([`function launch((string name,string symbol,uint16 buyCreatorFeeBps,uint16 sellCreatorFeeBps,bytes32 creatorSalt,(string description,string website,string image,bytes extraData) metadata,address[] creatorWallets,uint16[] creatorSharesBps,${selection}[] modules,uint256[] moduleFunding,uint256 initialBuyNative,uint256 minimumInitialTokenOut,uint256 deadline,bytes32 expectedRecipeHash) parameters) payable`]);
  f.build.artifacts.swapRouter.abi = parseAbi(['function swap(address token,bool isBuy,int256 amountSpecified,uint256 limit,address recipient,uint256 deadline) payable returns(uint256 nativeAmount,uint256 tokenAmount)']);
  f.build.artifacts.hook.abi = parseAbi(['event NativeEconomicsBound(bytes32 indexed poolId,bytes32 indexed economicsPolicyId,uint16 protocolFeeBps,uint16 authorPoolFeeBps,bytes32[] eligibleFamilies,bool[] selectionEligible,bytes32[] selectionReviewDigests)']);
  const canaries = ['plain', 'modules'].map((kind, index) => {
    const token = `0x${(900 + index).toString(16).padStart(40, '0')}`, poolId = h(`${kind}-pool`), recipeHash = h(`${kind}-recipe`);
    const modules = index ? [{ packageId: h('package'), factory: params.owner, factoryCodeHash: h('factory'), moduleCodeHash: h('module'), callbackGas: 50000, config: '0x' }] : [];
    const canary = { kind, token };
    for (const action of ['launch', 'buy', 'sell', 'buyExactOutput', 'sellExactOutput']) {
      const launch = action === 'launch', isBuy = action.startsWith('buy'), exactOutput = action.endsWith('ExactOutput'), to = identity.contracts[launch ? 'launcher' : 'swapRouter'].address;
      const parameters = { name: 'Fixture', symbol: 'FIX', buyCreatorFeeBps: index ? 100 : 0, sellCreatorFeeBps: index ? 100 : 0,
        creatorSalt: h(kind), metadata: { description: '', website: '', image: '', extraData: '0x' }, creatorWallets: [params.owner], creatorSharesBps: [10000],
        modules, moduleFunding: modules.map(() => 0n), initialBuyNative: 10n, minimumInitialTokenOut: 1n, deadline: 9999n, expectedRecipeHash: recipeHash };
      const data = encodeFunctionData({ abi: f.build.artifacts[launch ? 'launcher' : 'swapRouter'].abi, functionName: launch ? 'launch' : 'swap',
        args: launch ? [parameters] : [token, isBuy, exactOutput ? 10n : -10n, 20n, params.owner, 9999n] });
      const step = { sender: params.owner, to, data, value: launch || isBuy ? '20' : '0', expectation: { token, poolId, recipeHash } };
      const plan = { identity, action: { kind: action, canaryKind: kind }, steps: [step], planDigest: h(`${kind}-${action}-plan`) };
      const transaction = { hash: h(`${kind}-${action}-tx`), from: params.owner, to, input: data, value: launch || isBuy ? '0x14' : '0x0',
        chainId: '0x1237', type: '0x2', blockHash: h(`${kind}-${action}-block`), blockNumber: '0xfa' };
      const logs = launch ? [{ address: identity.contracts.hook.address, topics: encodeEventTopics({ abi: f.build.artifacts.hook.abi, eventName: 'NativeEconomicsBound', args: { poolId, economicsPolicyId: ECONOMICS_POLICY_ID } }),
        data: encodeAbiParameters(parseAbiParameters('uint16,uint16,bytes32[],bool[],bytes32[]'), [10, index ? 20 : 0, index ? [h('family')] : [], index ? [true] : [], index ? [h('review')] : []]) }] : [];
      canary[action] = { plan, evidence: { planDigest: plan.planDigest, status: 'included-code-verified-unfinalized', transaction,
        receipt: { transactionHash: transaction.hash, blockHash: transaction.blockHash, blockNumber: transaction.blockNumber, status: '0x1', logs } } };
    }
    return canary;
  });
  return { ...f, identity, canaries };
}

test('V2 lifecycle references require ten distinct actual operations, expectedRecipeHash and V2 eligibility event', async () => {
  const f = await lifecycleFixture(), result = await createNativeV2LifecycleCollectorPlan(f.identity, f.canaries, f.build);
  assert.equal(result.schemaVersion, 'programmable.module-mode-lifecycle-plan.v2');
  assert.ok(result.canaries.every(canary => canary.buyExactOutputTransactionHash && canary.sellExactOutputTransactionHash));
  const missing = structuredClone(f.canaries); missing[1].launch.evidence.receipt.logs = [];
  await assert.rejects(createNativeV2LifecycleCollectorPlan(f.identity, missing, f.build), /NativeEconomicsBound/);
  const v1 = structuredClone(f.canaries); v1[0].launch.plan.identity.sourceVersion = 'module-native-v1';
  await assert.rejects(createNativeV2LifecycleCollectorPlan(f.identity, v1, f.build), /Actual native V2/);
  const duplicate = structuredClone(f.canaries); duplicate[1].sellExactOutput.evidence.transaction.hash = duplicate[0].sellExactOutput.evidence.transaction.hash;
  await assert.rejects(createNativeV2LifecycleCollectorPlan(f.identity, duplicate, f.build), /Duplicate canary/);
  const wrongQuadrant = structuredClone(f.canaries), item = wrongQuadrant[1].buyExactOutput;
  item.plan.steps[0].data = encodeFunctionData({ abi: f.build.artifacts.swapRouter.abi, functionName: 'swap', args: [wrongQuadrant[1].token, true, -10n, 20n, params.owner, 9999n] });
  item.evidence.transaction.input = item.plan.steps[0].data;
  await assert.rejects(createNativeV2LifecycleCollectorPlan(f.identity, wrongQuadrant, f.build), /swap quadrant/);
});
