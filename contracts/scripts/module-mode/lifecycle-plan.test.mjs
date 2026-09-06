import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, keccak256, parseAbiParameters } from 'viem';
import { hexQuantity } from './core.mjs';
import { createLifecyclePlan, assertLifecyclePlan, createLifecycleCollectorPlan } from './lifecycle-plan.mjs';
import { publicationFixture, launchAction } from './publication-test-fixtures.mjs';
import { publicationValidators } from './publication-shared.mjs';
import { observePublicationOperation } from './publication-rpc.mjs';
import { registryAbi } from './publication-plan.mjs';
const h = n => `0x${n.toString(16).padStart(64, '0')}`;

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
  const f = await publicationFixture(), action = { kind: 'approve', canaryKind: 'plain', token: f.identity.contracts.tokenFactory.address, tokenCodeHash: h(77), amount: '12345' };
  const plan = await createLifecyclePlan({ ...f, modules: [], action }), api = await publicationValidators();
  const call = decodeFunctionData({ abi: api.moduleNativeApprovalAbi, data: plan.steps[0].data });
  assert.deepEqual(call.args, [f.identity.contracts.swapRouter.address, 12345n]); assert.equal(plan.steps[0].value, '0');
  await assert.rejects(createLifecyclePlan({ ...f, modules: [], action: { ...action, amount: ((1n << 256n) - 1n).toString() } }), /amount bound/);
});
test('buy and sell use exact input, positive output floor and the owner as recipient', async () => {
  const f = await publicationFixture(), api = await publicationValidators();
  for (const kind of ['buy', 'sell']) {
    const action = { kind, canaryKind: 'plain', token: f.identity.contracts.tokenFactory.address, tokenCodeHash: h(7), amount: '10000', minimumOut: '20', deadline: String(Math.floor(Date.now() / 1000) + 600) };
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
    recipeHash: h(4), hook: pins.hook.address, positionRecipient: f.owner, positionTokenId: 1n, initialBuyNative: BigInt(action.initialBuyNative), initialBuyTokens: 2000n, runtime: pins.runtime.address, launchKey: h(5) };
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
