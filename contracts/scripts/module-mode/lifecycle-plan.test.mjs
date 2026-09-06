import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, encodeFunctionData, keccak256, parseAbi, parseAbiParameters } from 'viem';
import { hexQuantity } from './core.mjs';
import { createLifecyclePlan, assertLifecyclePlan, createLifecycleCollectorPlan, bindLifecycleLaunchReference } from './lifecycle-plan.mjs';
import { publicationFixture, launchAction } from './publication-test-fixtures.mjs';
import { publicationValidators } from './publication-shared.mjs';
import { observePublicationOperation } from './publication-rpc.mjs';
import { registryAbi } from './publication-plan.mjs';
const h = n => `0x${n.toString(16).padStart(64, '0')}`;
async function launchReference(f, selected = false, changes = {}) {
  const modules = selected ? [f.module] : [], action = { ...launchAction(f, selected), ...changes };
  const plan = await createLifecyclePlan({ ...f, modules, action }), step = plan.steps[0];
  const transaction = { hash: h(100), from: f.owner, to: step.to, input: step.data, value: hexQuantity(step.value), nonce: '0x1', chainId: '0x1237', type: '0x2',
    gas: '0x100000', maxFeePerGas: '0x3e8', maxPriorityFeePerGas: '0xa', blockHash: h(200), blockNumber: '0x100' };
  const receipt = { transactionHash: transaction.hash, blockHash: transaction.blockHash, blockNumber: transaction.blockNumber, status: '0x1', gasUsed: '0x80000', transactionIndex: '0x0', logs: [] };
  return { plan, evidence: { status: 'included-code-verified-unfinalized', chainId: 4663, planDigest: plan.planDigest, releaseDigest: f.identity.releaseDigest,
    stepIndex: 0, kind: 'launch', transaction, receipt } };
}


test('plain canary has no modules, zero creator fee, exact initial value and bound prediction', async () => {
  const f = await publicationFixture(), action = launchAction(f), plan = await createLifecyclePlan({ ...f, modules: [], action });
  await assertLifecyclePlan(plan); const api = await publicationValidators();
  const call = decodeFunctionData({ abi: api.moduleNativeLaunchAbi, data: plan.steps[0].data });
  assert.equal(call.functionName, 'launch'); assert.equal(call.args[0].buyCreatorFeeBps, 0); assert.deepEqual(call.args[0].modules, []);
  assert.equal(plan.steps[0].value, action.initialBuyNative); assert.equal(call.args[0].minimumInitialTokenOut, 1000n);
  const changed = structuredClone(plan); changed.steps[0].value = '1'; await assert.rejects(assertLifecyclePlan(changed));
});
test('module canary requires positive creator fees and forces nonfundable modules to zero', async () => {
  const f = await publicationFixture(), action = launchAction(f, true);
  const plan = await createLifecyclePlan({ ...f, modules: [f.module], action });
  assert.equal(plan.steps[0].arguments.buyCreatorFeeBps, 100); assert.equal(plan.steps[0].arguments.modules.length, 1);
  await assert.rejects(createLifecyclePlan({ ...f, modules: [f.module], action: { ...action, creatorFeeBps: 0 } }), /creator fee/);
  const funded = structuredClone(action); funded.moduleConfigurations[0].funding = '1';
  assert.equal(f.module.manifest.manifest.catalogDefinition.management.budget.fundable, false);
  await assert.rejects(createLifecyclePlan({ ...f, modules: [f.module], action: funded }), /funding budget/);
});
test('approval is exact and only the immutable native router may spend', async () => {
  const f = await publicationFixture(), launch = await launchReference(f), action = { kind: 'approve', canaryKind: 'plain', token: launch.plan.steps[0].target, tokenCodeHash: h(77), amount: '12345', launch };
  const plan = await createLifecyclePlan({ ...f, modules: [], action }), api = await publicationValidators();
  const call = decodeFunctionData({ abi: api.moduleNativeApprovalAbi, data: plan.steps[0].data });
  assert.deepEqual(call.args, [f.identity.contracts.swapRouter.address, 12345n]); assert.equal(plan.steps[0].value, '0');
  await assert.rejects(createLifecyclePlan({ ...f, modules: [], action: { ...action, amount: ((1n << 256n) - 1n).toString() } }), /amount bound/);
});
test('buy and sell use exact input, positive output floor and the owner as recipient', async () => {
  const f = await publicationFixture(), api = await publicationValidators(), launch = await launchReference(f);
  for (const kind of ['buy', 'sell']) {
    const action = { kind, canaryKind: 'plain', token: launch.plan.steps[0].target, launch, tokenCodeHash: h(7), amount: '10000', minimumOut: '20', deadline: String(Math.floor(Date.now() / 1000) + 600) };
    const plan = await createLifecyclePlan({ ...f, modules: [], action }), call = decodeFunctionData({ abi: api.moduleNativeRouterAbi, data: plan.steps[0].data });
    assert.equal(call.args[2], -10000n); assert.equal(call.args[3], 20n); assert.equal(call.args[4].toLowerCase(), f.owner);
    assert.equal(plan.steps[0].value, kind === 'buy' ? '10000' : '0');
    await assert.rejects(createLifecyclePlan({ ...f, modules: [], action: { ...action, minimumOut: '0' } }), /minimum output/);
  }
});

test('canary simulation rejects a returned launch identity belonging to another owner', async () => {
  const f = await publicationFixture(), action = launchAction(f), plan = structuredClone(await createLifecyclePlan({ ...f, modules: [], action }));
  const api = await publicationValidators(), runtime = '0x600100';
  // Synthetic runtime coordinates; no release evidence is produced by this isolated RPC case.
  for (const pin of Object.values(plan.identity.contracts)) pin.runtimeCodeHash = keccak256(runtime);
  const step = plan.steps[0], block = { number: '0x100', hash: h(90), timestamp: hexQuantity(Math.floor(Date.now() / 1000)), baseFeePerGas: '0x1', transactions: [h(91)] };
  const token = step.target, pins = plan.identity.contracts;
  const launch = { launchId: h(3), launchWallet: f.owner, token, poolId: keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'), ['0x0000000000000000000000000000000000000000', token, 0, 200, pins.hook.address])),
    recipeHash: step.expectation.recipeHash, hook: pins.hook.address, positionRecipient: f.owner, positionTokenId: 1n, initialBuyNative: BigInt(action.initialBuyNative), initialBuyTokens: 2000n, runtime: pins.runtime.address, launchKey: step.expectation.launchKey };
  let wrongOwner = false;
  const rpc = async (method, params) => {
    if (method === 'eth_chainId') return '0x1237'; if (method === 'eth_getBlockByNumber') return block;
    if (method === 'eth_getCode') return params[0] === f.owner || params[0] === token ? '0x' : runtime;
    if (method === 'eth_getTransactionCount') return '0x0'; if (method === 'eth_getBalance') return '0xffffffffffffffff'; if (method === 'eth_estimateGas') return '0x186a0';
    if (method === 'eth_call') {
      if (params[0].data === step.data) return encodeFunctionResult({ abi: api.moduleNativeLaunchAbi, functionName: 'launch', result: { ...launch, launchWallet: wrongOwner ? pins.registry.address : f.owner } });
      const expected = step.preReads.find(r => r.data === params[0].data); if (expected) return expected.result;
      return encodeFunctionResult({ abi: registryAbi, functionName: 'owner', result: f.owner });
    }
    throw new Error('Unexpected test RPC');
  };
  const providers = [0, 1].map(i => ({ providerId: `synthetic${i}`, trustDomain: `synthetic${i}.invalid`, role: i ? 'secondary' : 'primary', authentication: 'fixture', endpointCommitment: `sha256:${h(80 + i).slice(2)}`, rpc }));
  const observation = await observePublicationOperation(plan, 0, providers); assert.equal(observation.simulatedResult.initialBuyTokens, '2000');
  wrongOwner = true; await assert.rejects(observePublicationOperation(plan, 0, providers), /identity differs/);
});

test('a plain launch cannot masquerade as a module canary in downstream actions', async () => {
  const f = await publicationFixture(), launch = await launchReference(f), action = { kind: 'buy', canaryKind: 'modules', launch,
    token: launch.plan.steps[0].target, tokenCodeHash: h(7), amount: '10000', minimumOut: '20', deadline: String(Math.floor(Date.now() / 1000) + 600) };
  await assert.rejects(createLifecyclePlan({ ...f, modules: [f.module], action }), /canary kind/);
  const moduleLaunch = await launchReference(f, true);
  await assert.rejects(bindLifecycleLaunchReference(moduleLaunch, f.identity, f.owner, [], 'modules', moduleLaunch.plan.steps[0].target), /module bundle/);
});
test('changed fee or configuration in a recreated launch plan cannot borrow an older receipt', async () => {
  const f = await publicationFixture(), launch = await launchReference(f, true);
  for (const change of ['fee', 'configuration']) {
    const action = structuredClone(launch.plan.action);
    if (change === 'fee') action.creatorFeeBps = 200; else action.moduleConfigurations[0].config += '00';
    const changedPlan = await createLifecyclePlan({ ...f, modules: [f.module], action });
    assert.notEqual(changedPlan.steps[0].expectation.recipeHash, launch.plan.steps[0].expectation.recipeHash);
    assert.notEqual(changedPlan.steps[0].expectation.launchKey, launch.plan.steps[0].expectation.launchKey);
    const substituted = { plan: changedPlan, evidence: { ...launch.evidence, planDigest: changedPlan.planDigest } };
    await assert.rejects(bindLifecycleLaunchReference(substituted, f.identity, f.owner, [f.module], 'modules', changedPlan.steps[0].target), /transaction differs/);
  }
});
test('recipe commitments bind selected configuration and fees while metadata and creator allocation have separate commitments', async () => {
  const f = await publicationFixture(), baseline = await launchReference(f, true);
  const feeChanged = await launchReference(f, true, { creatorFeeBps: 200 });
  assert.notEqual(baseline.plan.steps[0].expectation.recipeHash, feeChanged.plan.steps[0].expectation.recipeHash);
  const metadataChanged = await launchReference(f, true, { metadata: { ...baseline.plan.action.metadata, description: 'Different metadata' } });
  assert.equal(baseline.plan.steps[0].expectation.recipeHash, metadataChanged.plan.steps[0].expectation.recipeHash);
  assert.notEqual(baseline.plan.steps[0].expectation.metadataHash, metadataChanged.plan.steps[0].expectation.metadataHash);
  const recipientChanged = await launchReference(f, true, { creatorWallets: [f.source.descriptor.rewardWallet] });
  assert.notEqual(baseline.plan.steps[0].expectation.creatorConfigurationHash, recipientChanged.plan.steps[0].expectation.creatorConfigurationHash);
});
test('metadata limits match the deployed policy before any RPC call', async () => {
  const f = await publicationFixture(), baseline = launchAction(f);
  for (const changes of [{ name: 'x'.repeat(49) }, { symbol: 'X'.repeat(13) },
    { metadata: { ...baseline.metadata, description: 'x'.repeat(281) } }, { metadata: { ...baseline.metadata, image: 'x'.repeat(2049) } },
    { metadata: { ...baseline.metadata, extraData: `0x${'ff'.repeat(1201)}` } }]) {
    await assert.rejects(createLifecyclePlan({ ...f, modules: [], action: { ...baseline, ...changes } }));
  }
  await createLifecyclePlan({ ...f, modules: [], action: { ...baseline, name: 'x'.repeat(48), symbol: 'X'.repeat(12), metadata: { ...baseline.metadata, description: 'x'.repeat(280), extraData: `0x${'ff'.repeat(1200)}` } } });
});

test('downstream live observation rechecks the actual launch receipt, pool fees, module config and creator allocation', async () => {
  const f = await publicationFixture(), launch = await launchReference(f, true), api = await publicationValidators();
  const runtime = '0x600100', action = { kind: 'buy', canaryKind: 'modules', token: launch.plan.steps[0].target, launch,
    tokenCodeHash: keccak256(runtime), amount: '10000', minimumOut: '20', deadline: String(Math.floor(Date.now() / 1000) + 600) };
  const plan = structuredClone(await createLifecyclePlan({ ...f, modules: [f.module], action }));
  // These independent provider fixtures exercise observation checks, not source/deployment authority.
  for (const pin of Object.values(plan.identity.contracts)) pin.runtimeCodeHash = keccak256(runtime);
  const pins = plan.identity.contracts, step = plan.steps[0], expected = step.expectation, faults = new Set();
  const stateAbi = parseAbi([
    'function creatorRecipients(bytes32 poolId) view returns (address[] wallets,uint16[] sharesBps,uint256 adminRevision)',
    'function instances(bytes32 launchKey) view returns ((bytes32 instanceId,bytes32 packageId,bytes32 configHash,address factory,bytes32 factoryCodeHash,address module,bytes32 moduleCodeHash,uint32 callbackGas)[])',
    'function launchBinding(bytes32 launchKey) view returns ((address source,address launchWallet,address token,address poolManager,bytes32 poolId,bytes32 recipeHash,bytes32 programHash))',
  ]);
  const nativeRecord = { launchId: h(300), launchWallet: f.owner, token: step.target, poolId: expected.poolId, recipeHash: expected.recipeHash,
    hook: pins.hook.address, positionRecipient: f.owner, positionTokenId: 1n, initialBuyNative: BigInt(expected.initialBuyNative), initialBuyTokens: 2000n, runtime: pins.runtime.address, launchKey: expected.launchKey };
  const instances = expected.selections.map((selection, index) => ({ instanceId: h(index + 501), packageId: selection.packageId, configHash: keccak256(selection.config),
    factory: selection.factory, factoryCodeHash: selection.factoryCodeHash, module: `0x${(index + 701).toString(16).padStart(40, '0')}`,
    moduleCodeHash: selection.moduleCodeHash, callbackGas: selection.callbackGas }));
  const selectors = Object.fromEntries([
    ['getLaunch', api.moduleNativeLaunchAbi, [step.target]], ['poolConfig', api.moduleNativeReadAbi, [expected.poolId]],
    ['creatorRecipients', stateAbi, [expected.poolId]], ['instances', stateAbi, [expected.launchKey]], ['launchBinding', stateAbi, [expected.launchKey]], ['owner', registryAbi, []],
  ].map(([name, abi, args]) => [name, encodeFunctionData({ abi, functionName: name, args })]));
  const block = { number: '0x110', hash: h(210), timestamp: hexQuantity(Math.floor(Date.now() / 1000)), baseFeePerGas: '0x1', transactions: [] };
  const rpc = async (method, params) => {
    if (method === 'eth_chainId') return '0x1237';
    if (method === 'eth_getBlockByNumber') return params[0] === '0x100' ? { ...block, number: '0x100', hash: launch.evidence.transaction.blockHash, transactions: [launch.evidence.transaction.hash] } : block;
    if (method === 'eth_getTransactionByHash') return { ...launch.evidence.transaction, ...(faults.has('original-transaction') ? { input: '0x00' } : {}) };
    if (method === 'eth_getTransactionReceipt') return launch.evidence.receipt;
    if (method === 'eth_getCode') {
      if (params[0] === f.owner) return '0x';
      if (params[0] === expected.selections[0].factory) return f.artifact.factory.runtimeBytecode;
      if (params[0] === instances[0].module) return f.artifact.program.runtimeBytecode;
      return runtime;
    }
    if (method === 'eth_getTransactionCount') return '0x2'; if (method === 'eth_getBalance') return '0xffffffffffffffff'; if (method === 'eth_estimateGas') return '0x186a0';
    if (method === 'eth_call') {
      const data = params[0].data, selected = step.preReads.find(value => value.data === data); if (selected) return selected.result;
      if (data === selectors.owner) return encodeFunctionResult({ abi: registryAbi, functionName: 'owner', result: f.owner });
      if (data === selectors.getLaunch) return encodeFunctionResult({ abi: api.moduleNativeLaunchAbi, functionName: 'getLaunch', result: { ...nativeRecord, ...(faults.has('recipe') ? { recipeHash: h(600) } : {}) } });
      if (data === selectors.poolConfig) return encodeFunctionResult({ abi: api.moduleNativeReadAbi, functionName: 'poolConfig', result: [pins.launcher.address, f.owner, pins.swapRouter.address, pins.swapRouter.runtimeCodeHash, faults.has('fee') ? 200 : 100, 100, expected.recipeHash, expected.launchKey] });
      if (data === selectors.launchBinding) return encodeFunctionResult({ abi: stateAbi, functionName: 'launchBinding', result: { source: pins.launcher.address, launchWallet: f.owner,
        token: step.target, poolManager: pins.poolManager.address, poolId: expected.poolId, recipeHash: expected.recipeHash, programHash: expected.programHash } });
      if (data === selectors.instances) return encodeFunctionResult({ abi: stateAbi, functionName: 'instances', result: faults.has('empty-modules') ? [] : instances.map(instance => ({ ...instance, ...(faults.has('configuration') ? { configHash: h(610) } : {}) })) });
      if (data === selectors.creatorRecipients) return encodeFunctionResult({ abi: stateAbi, functionName: 'creatorRecipients', result: [faults.has('creator') ? [pins.registry.address] : expected.creatorWallets, expected.creatorSharesBps, 0n] });
      if (data === step.data) return encodeFunctionResult({ abi: api.moduleNativeRouterAbi, functionName: 'swap', result: [10000n, 100n] });
    }
    throw new Error('Unexpected synthetic lifecycle read');
  };
  const providers = [0, 1].map(i => ({ providerId: `bound${i}`, trustDomain: `bound${i}.invalid`, role: i ? 'secondary' : 'primary', authentication: 'fixture', endpointCommitment: `sha256:${h(80 + i).slice(2)}`, rpc }));
  assert.equal((await observePublicationOperation(plan, 0, providers)).state, 'operation-simulated');
  for (const [fault, error] of [['original-transaction', /Referenced launch transaction/], ['recipe', /recipe or launch key/], ['fee', /pool fees/],
    ['configuration', /selection or configuration/], ['empty-modules', /module count/], ['creator', /creator recipients/]]) {
    faults.add(fault); await assert.rejects(observePublicationOperation(plan, 0, providers), error); faults.delete(fault);
  }
});

test('collector plan includes only actual bound distinct operation receipt records', async () => {
  const f = await publicationFixture(); const tokens = [f.identity.contracts.tokenFactory.address, f.identity.contracts.runtime.address];
  let sequence = 100;
  const canaries = ['plain', 'modules'].map((kind, i) => ({ kind, token: tokens[i], ...Object.fromEntries(['launch', 'buy', 'sell'].map(action => {
    const planDigest = h(sequence++); return [action, { plan: { identity: f.identity, planDigest, action: { kind: action, canaryKind: kind }, steps: [{ expectation: { token: tokens[i] } }] },
      evidence: { status: 'included-code-verified-unfinalized', planDigest, transaction: { hash: h(sequence++) } } }];
  })) }));
  const result = createLifecycleCollectorPlan(f.identity, canaries); assert.equal(result.schemaVersion, 'programmable.module-mode-lifecycle-plan.v1'); assert.equal(result.canaries.length, 2);
  canaries[1].buy.evidence.transaction.hash = canaries[0].buy.evidence.transaction.hash;
  assert.throws(() => createLifecycleCollectorPlan(f.identity, canaries), /Duplicate/);
  canaries[0].launch.evidence.status = 'pending'; assert.throws(() => createLifecycleCollectorPlan(f.identity, canaries), /Actual bound/);
});
