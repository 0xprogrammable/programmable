import test from 'node:test';
import assert from 'node:assert/strict';
import { concatHex, decodeFunctionData, decodeFunctionResult, encodeAbiParameters, encodeFunctionResult, encodeFunctionData, keccak256, parseAbi, parseAbiParameters, toHex } from 'viem';
import { hexQuantity } from './core.mjs';
import { createLifecyclePlan, assertLifecyclePlan, createLifecycleCollectorPlan, bindLifecycleLaunchReference, lifecycleLaunchCommitments, predictLifecycleToken } from './lifecycle-plan.mjs';
import { publicationFixture, launchAction } from './publication-test-fixtures.mjs';
import { publicationV2Fixture, nativeLaunchReference, lifecycleV2RpcFixture } from './lifecycle-v2-test-fixtures.mjs';
import { publicationValidators } from './publication-shared.mjs';
import { observePublicationOperation, preparePublicationRequest, observePublicationReceipt, revalidatePublicationRequest } from './publication-rpc.mjs';
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

test('V1 and V2 token predictions match their independent contract domains and CREATE2 formula', async () => {
  const api = await publicationValidators(), predictions = [];
  for (const [fixture, domain] of [[publicationFixture, 'programmable.module-mode.native-token.v1'], [publicationV2Fixture, 'programmable.module-mode.native-token.v2']]) {
    const f = await fixture(), pins = f.identity.contracts;
    for (const selected of [false, true]) {
      const action = launchAction(f, selected);
      // ModuleNativeLaunchV1/V2._effectiveGraffiti and UERC20Factory's salt.
      // The oracle supplies literal contract domains and hashes CREATE2 directly,
      // independently of predictLifecycleToken and its sourceVersion dispatch.
      const graffiti = keccak256(encodeAbiParameters(parseAbiParameters('string,uint256,address,address,bytes32'),
        [domain, 4663n, pins.launcher.address, f.owner, action.creatorSalt]));
      const salt = keccak256(encodeAbiParameters(parseAbiParameters('string,string,uint8,address,bytes32'),
        [action.name, action.symbol, 18, pins.launcher.address, graffiti]));
      const token = `0x${keccak256(concatHex(['0xff', pins.tokenFactory.address, salt, f.identity.tokenCreationCodeHash])).slice(-40)}`;
      assert.deepEqual(predictLifecycleToken(f.identity, f.owner, action), { token, graffiti });
      const plan = await createLifecyclePlan({ ...f, modules: selected ? [f.module] : [], action }), step = plan.steps[0];
      assert.equal(step.target, token); assert.equal(step.expectation.token, token);
      const prediction = step.preReads.find(read => read.functionName === 'predictTokenAddress');
      assert.deepEqual(decodeFunctionResult({ abi: api.moduleNativeLaunchAbiFor(f.identity), functionName: 'predictTokenAddress', data: prediction.result }).map(value => value.toLowerCase()), [token, graffiti]);
      assert.equal(step.expectation.poolId, keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'),
        ['0x0000000000000000000000000000000000000000', token, 0, 200, pins.hook.address])));
      if (!selected) predictions.push({ token, graffiti });
    }
  }
  assert.notEqual(predictions[0].token, predictions[1].token);
  assert.notEqual(predictions[0].graffiti, predictions[1].graffiti);
});

test('V2 prediction preserves the two publicly observed launcher vectors', () => {
  // Both providers returned these values at Robinhood block 57263393,
  // hash 0x08cea9cd7bea0b804ef92a089cd297b8e4e98461a622789c8b44a69348c7be23.
  // Fixed public inputs/results only; this regression makes no provider calls.
  const owner = '0x79879fe6f00c0986ca521ea6f5b276b5e28b1b9c';
  const identity = { sourceVersion: 'module-native-v2', tokenCreationCodeHash: '0x445809d9f7a34e959de4a96dec1e1beddfb265755bf28c57c42744adea1128ef', // gitleaks:allow -- public UERC20 creation-bytecode commitment
    contracts: { launcher: { address: '0x362dac28ac64ce11989a90e0da6715313e0162c5' }, tokenFactory: { address: '0x754e8c1ade3c6c4c863590a91f2ed020baf8e779' } } };
  const vectors = [
    { name: 'Module53 Plain Canary', symbol: 'M53P', creatorSalt: '0xdfa72fe0fc203b78d2248b6f90569930bff67ebfcc54366fa4511eaaf336a91e',
      expected: { token: '0xbf993e56a0259300d45cf2385ddb7d12cdfa340f', graffiti: '0x211d0dfde9cd7a94c7276a5225f5a28f2fe1aa4ca392e2dc08d6de68f5aed0af' } }, // gitleaks:allow -- public M53P token prediction and graffiti
    { name: 'Module53 Cap Canary', symbol: 'M53C', creatorSalt: '0xe1e7795d2e8fa6bdbfe3eb2f2bda958fcc8ed0f1e75e4588bb628a8be857194f',
      expected: { token: '0xf364cbe8a0019c61f03b4cf1180153966fd8f9a2', graffiti: '0xa4497ebe93e13d69f2612fec0af1a715ebdf96fe5aecd19a2d5c2f2e0768df6f' } }, // gitleaks:allow -- public M53C token prediction and graffiti
  ];
  for (const { expected, ...action } of vectors) assert.deepEqual(predictLifecycleToken(identity, owner, action), expected);
});

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

const v2Ceilings = { maxGas: '2000000', maxFeePerGas: '1000', maxPriorityFeePerGas: '10', maxValue: '1000000000000000' };

test('V2 plain launch uses the released selector and preview-bound 10/0 recipe, keeping contract source distinct', async () => {
  const f = await publicationV2Fixture(), api = await publicationValidators(), action = launchAction(f);
  const plan = await createLifecyclePlan({ ...f, modules: [], action, sourceState: { ...f.sourceState, sourceCommit: 'c'.repeat(40) } });
  await assertLifecyclePlan(plan);
  const step = plan.steps[0], call = decodeFunctionData({ abi: api.moduleNativeLaunchAbiFor(f.identity), data: step.data });
  assert.equal(call.functionName, 'launch'); assert.equal(call.args[0].expectedRecipeHash, step.expectation.recipeHash);
  assert.equal(step.expectation.platformFeeBps, 10); assert.equal(step.expectation.authorPoolFeeBps, 0);
  assert.deepEqual(step.expectation.selectionEligibilityHashes, []); assert.deepEqual(step.expectation.families, []);
  const expected = keccak256(encodeAbiParameters(parseAbiParameters('string,uint256,address,address,bytes32,bytes32[],uint16,uint16,bytes32[],(bytes32 packageId,address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,uint32 callbackGas,bytes config)[]'),
    ['programmable.module-mode.native-recipe.v2', 4663n, f.identity.contracts.hook.address, f.identity.contracts.registry.address,
      keccak256(toHex('programmable.module-mode.native-economics.v2')), [], 0, 0, [], []]));
  assert.equal(step.expectation.recipeHash, expected);
  assert.equal(step.preReads.filter(read => read.functionName === 'previewRecipe').length, 1);
  assert.equal(plan.sourceCommit, 'c'.repeat(40)); assert.equal(plan.identity.sourceCommit, f.identity.sourceCommit);
  const legacy = await publicationFixture(), old = await createLifecyclePlan({ ...legacy, modules: [], action: launchAction(legacy) });
  assert.notEqual(step.data.slice(0, 10), old.steps[0].data.slice(0, 10));
  const changed = structuredClone(plan); changed.steps[0].arguments.expectedRecipeHash = h(99);
  await assert.rejects(assertLifecyclePlan(changed), /plan differs/);
});

test('V2 module recipe commits the accepted eligibility digest and rejects an unaccepted or ineligible replacement', async () => {
  const f = await publicationV2Fixture(), plan = await createLifecyclePlan({ ...f, modules: [f.module], action: launchAction(f, true) });
  await assertLifecyclePlan(plan);
  const step = plan.steps[0], review = f.module.manifest.manifest.runtimeBinding.feeEligibility;
  assert.deepEqual(step.expectation.selectionEligible, [true]);
  assert.deepEqual(step.expectation.selectionReviewDigests, [review.reviewDigest]);
  assert.deepEqual(step.expectation.selectionEligibilityHashes, [keccak256(encodeAbiParameters(parseAbiParameters('bytes32,bool,bytes32'), [f.artifact.familyId, true, review.reviewDigest]))]);
  assert.deepEqual(step.expectation.families, [f.artifact.familyId]); assert.equal(step.expectation.platformFeeBps, 30);
  assert.equal(step.preReads.filter(read => read.functionName === 'familyFeeEligibility').length, 1);
  const tampered = structuredClone(f.module); tampered.manifest.manifest.runtimeBinding.feeEligibility.reviewDigest = h(999);
  await assert.rejects(createLifecyclePlan({ ...f, modules: [tampered], action: launchAction(f, true) }));
  const changed = await publicationV2Fixture({ eligible: true, reviewDigest: h(908) });
  const changedPlan = await createLifecyclePlan({ ...changed, modules: [changed.module], action: launchAction(changed, true) });
  assert.notEqual(changedPlan.steps[0].expectation.recipeHash, step.expectation.recipeHash);
  const rejected = await publicationV2Fixture({ eligible: false, reviewDigest: h(0) });
  await assert.rejects(createLifecyclePlan({ ...rejected, modules: [rejected.module], action: launchAction(rejected, true) }), /eligible families/);
});

test('V2 per-selection reviews deduplicate eligible families without losing repeated-family commitments', async () => {
  const f = await publicationV2Fixture(), launch = await nativeLaunchReference(f, true), step = launch.plan.steps[0];
  const family = f.artifact.familyId, review = f.module.manifest.manifest.runtimeBinding.feeEligibility;
  const selections = [step.expectation.selections[0], { ...step.expectation.selections[0], packageId: h(55), config: '0x1234' }];
  const commitment = lifecycleLaunchCommitments(f.identity, f.owner, launch.plan.action, [family, family], selections, step.target, [review, review]);
  assert.deepEqual(commitment.families, [family]); assert.deepEqual(commitment.selectionEligible, [true, true]);
  assert.equal(commitment.selectionEligibilityHashes.length, 2); assert.equal(commitment.authorPoolFeeBps, 20);
  assert.notEqual(commitment.recipeHash, step.expectation.recipeHash);
  assert.throws(() => lifecycleLaunchCommitments(f.identity, f.owner, launch.plan.action, [family, family], selections, step.target,
    [review, { eligible: false, reviewDigest: h(909) }]), /Same-family fee eligibility/);
  assert.throws(() => lifecycleLaunchCommitments(f.identity, f.owner, launch.plan.action, [family], [selections[0]], step.target,
    [{ eligible: true, reviewDigest: h(0) }]), /Invalid reviewed/);
});

test('V2 launch preparation and revalidation enforce independent policy and the same reviewed preview', async () => {
  const fixture = await lifecycleV2RpcFixture('launch', true);
  const prepared = await preparePublicationRequest(fixture.plan, 0, fixture.providers, v2Ceilings);
  for (const [fault, message] of [['policy', /economics policy/], ['protocol', /economics rates/], ['authors', /economics rates/],
    ['eligibility-pre', /familyFeeEligibility binding/], ['preview-recipe', /previewRecipe binding/]]) {
    fixture.faults.add(fault);
    await assert.rejects(revalidatePublicationRequest(fixture.plan, prepared, fixture.providers, v2Ceilings), message);
    fixture.faults.delete(fault);
  }
  const api = await publicationValidators(), selector = encodeFunctionData({ abi: api.moduleNativeReadV2Abi, functionName: 'ECONOMICS_POLICY_ID' });
  for (const role of ['launcher', 'hook', 'swapRouter', 'rewardLedger']) {
    const calls = fixture.reads.filter(read => read.method === 'eth_call' && read.params[0].to === fixture.plan.identity.contracts[role].address && read.params[0].data === selector);
    assert.ok(calls.length >= 2 && calls.every(call => call.params[1] === '0x110'));
  }
});

for (const kind of ['buy', 'sell', 'buyExactOutput', 'sellExactOutput']) test(`V2 ${kind} binds funding, exact side, output bounds and actual trade receipt`, async () => {
  const fixture = await lifecycleV2RpcFixture(kind), { plan, providers } = fixture, api = await publicationValidators();
  const exactOutput = kind.endsWith('ExactOutput'), isBuy = kind.startsWith('buy');
  const decoded = decodeFunctionData({ abi: api.moduleNativeRouterAbi, data: plan.steps[0].data });
  assert.equal(decoded.args[1], isBuy); assert.equal(decoded.args[2], exactOutput ? 10000n : -10000n);
  assert.equal(decoded.args[3], exactOutput ? 20000n : 20n); assert.equal(decoded.args[4].toLowerCase(), plan.owner);
  assert.equal(plan.steps[0].value, isBuy ? exactOutput ? '20000' : '10000' : '0');
  const prepared = await preparePublicationRequest(plan, 0, providers, v2Ceilings);
  if (exactOutput) {
    assert.equal(prepared.observation.simulatedResult.maximumInput, '20000');
    assert.equal(prepared.observation.simulatedResult.refundNative, isBuy ? '5000' : '0');
  }
  const entry = fixture.include(prepared), evidence = await observePublicationReceipt(plan, entry, providers);
  assert.equal(evidence.status, 'included-code-verified-unfinalized');
  if (exactOutput) assert.equal(evidence.trade.refundNative, isBuy ? '5000' : '0');
  for (const [paid, received] of exactOutput ? [[20001n, 10000n], [15000n, 9999n], [15000n, 10001n], [0n, 10000n]] : [[9999n, 100n], [10000n, 19n]]) {
    fixture.setAmounts(paid, received);
    await assert.rejects(observePublicationOperation(plan, 0, providers), /Swap amounts differ/);
    await assert.rejects(observePublicationReceipt(plan, entry, providers), /Swap amounts differ/);
  }
  fixture.setAmounts(exactOutput ? 15000n : 10000n, exactOutput ? 10000n : 100n);
  for (const fault of ['event-sign', 'event-side', 'event-recipient']) {
    fixture.faults.add(fault); await assert.rejects(observePublicationReceipt(plan, entry, providers), /Trade event identity|Swap amounts differ/); fixture.faults.delete(fault);
  }
});

test('V2 maximum input is explicit and bounded; V1 exact-output requests remain rejected', async () => {
  const f = await publicationV2Fixture(), launch = await nativeLaunchReference(f);
  const action = { kind: 'buyExactOutput', canaryKind: 'plain', token: launch.plan.steps[0].target, tokenCodeHash: h(7),
    amount: '10000', maximumInput: '20000', deadline: launch.plan.action.deadline, launch };
  for (const maximumInput of ['0', (1n << 127n).toString()]) await assert.rejects(createLifecyclePlan({ ...f, modules: [], action: { ...action, maximumInput } }), /maximum input|Maximum input/);
  const wrongField = { ...action, minimumOut: '1' }; delete wrongField.maximumInput;
  await assert.rejects(createLifecyclePlan({ ...f, modules: [], action: wrongField }), /Trade action/);
  const legacy = await publicationFixture();
  await assert.rejects(createLifecyclePlan({ ...legacy, modules: [], action }), /Unsupported native lifecycle/);
});

test('V2 receipt binds the exact eligibility event and immutable pool/ledger snapshot for both canaries', async () => {
  for (const selected of [false, true]) {
    const fixture = await lifecycleV2RpcFixture('launch', selected), { plan, providers } = fixture;
    const prepared = await preparePublicationRequest(plan, 0, providers, v2Ceilings), entry = fixture.include(prepared);
    assert.equal((await observePublicationReceipt(plan, entry, providers)).status, 'included-code-verified-unfinalized');
    for (const [fault, message] of [['missing-economics', /exactly one NativeEconomicsBound/], ['duplicate-economics', /exactly one NativeEconomicsBound/],
      ['event-policy', /economics event/], ['event-protocol', /economics event/], ['event-authors', /economics event/], ['event-families', /economics event/],
      ['event-eligible', /economics event/], ['event-review', /economics event/], ['pool-fee', /pool or ledger fee/], ['ledger-fee', /pool or ledger fee/],
      ['snapshot-eligible', /eligibility snapshot/], ['snapshot-review', /eligibility snapshot/], ['components', /fee components/], ['protocol-pips', /fee components/], ['lp-pips', /fee components/]]) {
      fixture.faults.add(fault); await assert.rejects(observePublicationReceipt(plan, entry, providers), message); fixture.faults.delete(fault);
    }
  }
});

test('V2 subsequent trades keep the launch eligibility snapshot and exact sell approval', async () => {
  const fixture = await lifecycleV2RpcFixture('approve', true), { plan, providers } = fixture, api = await publicationValidators();
  const decoded = decodeFunctionData({ abi: api.moduleNativeApprovalAbi, data: plan.steps[0].data });
  assert.deepEqual(decoded.args, [plan.identity.contracts.swapRouter.address, 10000n]);
  assert.equal(plan.steps[0].value, '0');
  assert.equal(plan.steps[0].preReads.filter(read => ['familyFeeEligibility', 'previewRecipe'].includes(read.functionName)).length, 0);
  const prepared = await preparePublicationRequest(plan, 0, providers, v2Ceilings), entry = fixture.include(prepared);
  assert.equal((await observePublicationReceipt(plan, entry, providers)).status, 'included-code-verified-unfinalized');
  fixture.faults.add('snapshot-review'); await assert.rejects(observePublicationReceipt(plan, entry, providers), /eligibility snapshot/);
});
