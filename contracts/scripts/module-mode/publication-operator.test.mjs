import '../module-engine/wallet-operator.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeFunctionResult, keccak256, parseAbi } from 'viem';
import { hexQuantity } from './core.mjs';
import { createPublicationPlan, assertPublicationPlan, bindPublicationModule, assertAuthenticatedOperationPlan, registryAbi, registryV2Abi } from './publication-plan.mjs';
import { publicationFixture } from './publication-test-fixtures.mjs';
import { lifecycleV2RpcFixture } from './lifecycle-v2-test-fixtures.mjs';
import { publicationWalletRequest, assertPublicationRequest, observePublicationOperation, preparePublicationRequest, revalidatePublicationRequest, observePublicationReceipt, preparePublicationRetry } from './publication-rpc.mjs';
import { startPublicationOperator } from './publication-operator.mjs';

const ceilings = { maxGas: '2000000', maxFeePerGas: '1000', maxPriorityFeePerGas: '10', maxValue: '1000' };
const h = n => `0x${n.toString(16).padStart(64, '0')}`;
const reviewedLaunchCeilings = { maxGas: '4600000', maxFeePerGas: '800000000', maxPriorityFeePerGas: '10000000', maxValue: '400000000000000' };
async function gasDriftFixture() {
  const fixture = await lifecycleV2RpcFixture('launch', false);
  let estimate = 4292099n, balance;
  const providers = fixture.providers.map(provider => ({ ...provider, rpc(method, params) {
    if (method === 'eth_estimateGas') return Promise.resolve(hexQuantity(estimate));
    if (method === 'eth_getBalance' && balance !== undefined) return Promise.resolve(hexQuantity(balance));
    return provider.rpc(method, params);
  } }));
  return { ...fixture, providers, setEstimate(value) { estimate = value; }, setBalance(value) { balance = value; } };
}
function rpcFixture() {
  const owner = '0x0000000000000000000000000000000000000001', registry = '0x0000000000000000000000000000000000000002', runtime = '0x600100';
  const family = h(4), wallet = '0x0000000000000000000000000000000000000003';
  const args = [wallet, h(9), wallet, h(10)], abi = registryAbi;
  const call = { to: registry, functionName: 'families', data: '0x1234', result: '0x' };
  const step = { kind: 'family', sender: owner, to: registry, value: '0', target: registry, data: '0xabcd', result: encodeFunctionResult({ abi, functionName: 'registerReviewedFamily', result: family }), preReads: [], postReads: [], newCode: [], arguments: args, functionName: 'registerReviewedFamily' };
  const plan = { planDigest: h(7), identity: { releaseDigest: h(8), contracts: { registry: { address: registry, runtimeCodeHash: keccak256(runtime) } } }, owner, steps: [step] };
  const block = { number: '0x100', hash: h(30), timestamp: hexQuantity(Math.floor(Date.now() / 1000)), baseFeePerGas: '0x1', transactions: [h(20)] };
  let request, nonce = '0x1', pending = false, reverted = false, mutateField = null, wrongState = false;
  const rpc = async (method, params) => {
    if (method === 'eth_chainId') return '0x1237'; if (method === 'eth_getBlockByNumber') return block;
    if (method === 'eth_getCode') return params[0] === registry ? runtime : '0x';
    if (method === 'eth_getTransactionCount') return params[1] === 'pending' && pending ? '0x2' : nonce;
    if (method === 'eth_getBalance') return '0xffffffffffffffff'; if (method === 'eth_estimateGas') return '0x186a0';
    if (method === 'eth_call') { if (params[0].data === step.data) return step.result; if (params[0].data === call.data) return wrongState ? '0x01' : call.result;
      return encodeFunctionResult({ abi: parseAbi(['function owner() view returns (address)']), functionName: 'owner', result: owner }); }
    if (method === 'eth_getTransactionByHash') { const tx = { hash: h(20), ...request, input: request.data, blockHash: block.hash, blockNumber: block.number }; if (mutateField) tx[mutateField] = '0x2'; return tx; }
    if (method === 'eth_getTransactionReceipt') return { transactionHash: h(20), blockHash: block.hash, blockNumber: block.number, status: reverted ? '0x0' : '0x1', gasUsed: '0x100', transactionIndex: '0x0', logs: [] };
    throw new Error('Unexpected synthetic RPC');
  };
  const providers = [0, 1].map(i => ({ providerId: `fixture-${i}`, trustDomain: `fixture-${i}.invalid`, role: i ? 'secondary' : 'primary', authentication: 'fixture', endpointCommitment: `sha256:${h(i + 40).slice(2)}`, rpc }));
  return { plan, providers, call, step, setRequest(v) { request = v; }, setNonce(v) { nonce = v; }, setPending() { pending = true; }, setReverted() { reverted = true; }, setChangedField(v) { mutateField = v; }, setWrongState() { wrongState = true; } };
}

test('publication binds source, accepted artifact, exact factory and immutable registry calls', async () => {
  const f = await publicationFixture(); const plan = await createPublicationPlan({ ...f, modules: [f.module] });
  assert.equal(plan.steps.length, 3); assert.equal(plan.steps[0].data, `${f.module.factorySalt}${f.artifact.factory.creationBytecode.slice(2)}`);
  assert.deepEqual(plan.steps.map(s => s.value), ['0', '0', '0']); await assertPublicationPlan(plan);
  const tampered = structuredClone(plan); tampered.steps[1].arguments[2] = f.owner; await assert.rejects(assertPublicationPlan(tampered), /plan differs/);
});
test('missing acceptance, changed artifact and supplied salt fail closed', async () => {
  const f = await publicationFixture();
  for (const mutate of [v => { v.review = null; }, v => { v.artifact.factory.creationBytecode += '00'; }, v => { v.factorySalt = h(50); }]) {
    const changed = structuredClone(f.module); mutate(changed); await assert.rejects(bindPublicationModule(changed, f.identity, f.owner));
  }
  await assert.rejects(assertAuthenticatedOperationPlan({ modules: [f.module], owner: f.owner }, undefined), /session file/);
});
test('NativeV2 owner plan records exactly the accepted family fee review and verifies its getter before admission', async () => {
  const feeEligibility = { eligible: true, reviewDigest: h(101) }, f = await publicationFixture(feeEligibility);
  const checked = await bindPublicationModule(f.module, f.identity, f.owner);
  assert.deepEqual(checked.feeEligibility, feeEligibility);
  const plan = await createPublicationPlan({ ...f, modules: [f.module] });
  assert.deepEqual(plan.steps.map(step => step.kind), ['factory', 'family', 'feeEligibility', 'revision']);
  const fee = plan.steps[2];
  assert.equal(fee.sender, f.owner); assert.equal(fee.to, f.identity.contracts.registry.address); assert.equal(fee.value, '0');
  assert.deepEqual(decodeFunctionData({ abi: registryV2Abi, data: fee.data }), { functionName: 'setFamilyFeeEligibility', args: [checked.familyId, true, feeEligibility.reviewDigest] });
  assert.equal(fee.preReads[1].result, encodeFunctionResult({ abi: registryV2Abi, functionName: 'familyFeeEligibility', result: [false, h(0)] }));
  assert.equal(fee.postReads[0].result, encodeFunctionResult({ abi: registryV2Abi, functionName: 'familyFeeEligibility', result: [true, feeEligibility.reviewDigest] }));
  assert.deepEqual(plan.steps[3].preReads.at(-1), fee.postReads[0]);
  assert.deepEqual(plan.steps[3].postReads.at(-1), fee.postReads[0]); await assertPublicationPlan(plan);
  for (const change of [b => { b.feeEligibility.eligible = false; }, b => { b.feeEligibility.reviewDigest = h(102); }, b => { delete b.feeEligibility; }]) {
    const changed = structuredClone(f.module); change(changed.manifest.manifest.runtimeBinding);
    await assert.rejects(bindPublicationModule(changed, f.identity, f.owner));
  }
  const tampered = structuredClone(plan); tampered.steps[2].postReads = [];
  await assert.rejects(assertPublicationPlan(tampered), /plan differs/);
});
test('NativeV2 false/zero keeps the untouched default and NativeV1 cannot adopt an eligibility field', async () => {
  const f = await publicationFixture({ eligible: false, reviewDigest: h(0) });
  const plan = await createPublicationPlan({ ...f, modules: [f.module] });
  assert.deepEqual(plan.steps.map(step => step.kind), ['factory', 'family', 'revision']);
  assert.equal(plan.steps[2].postReads.at(-1).functionName, 'familyFeeEligibility'); await assertPublicationPlan(plan);
  const v1 = await publicationFixture(); v1.module.manifest.manifest.runtimeBinding.feeEligibility = { eligible: false, reviewDigest: h(0) };
  await assert.rejects(bindPublicationModule(v1.module, v1.identity, v1.owner));
});
test('wallet ceilings include ETH value and gas, with no automatic fee raise', () => {
  const f = rpcFixture(); f.step.value = '1000'; const observation = { state: 'operation-simulated', stepIndex: 0, gasLimit: '100000', baseFeePerGas: '1', minimumBalance: '2000001000', nonce: '1' };
  const request = publicationWalletRequest(f.plan, observation, ceilings); assert.equal(request.value, '0x3e8'); assert.equal(BigInt(request.gas), 2000000n);
  assert.throws(() => publicationWalletRequest(f.plan, { ...observation, minimumBalance: '2000000999' }, ceilings), /balance/);
  assert.throws(() => publicationWalletRequest(f.plan, observation, { ...ceilings, maxValue: '999' }), /ETH value/);
  assert.throws(() => publicationWalletRequest(f.plan, observation, { ...ceilings, maxGas: '99999' }), /Gas estimate/);
});
test('fixed reviewed launch gas tolerates modest estimate drift without changing the armed or retry request', async () => {
  const f = await gasDriftFixture(), prepared = await preparePublicationRequest(f.plan, 0, f.providers, reviewedLaunchCeilings), original = structuredClone(prepared);
  assert.equal(prepared.observation.gasLimit, '4531704');
  // Archived not-armed Native V2 observations: 4292099 -> 4292479 gas.
  f.setEstimate(4292479n);
  const fresh = await revalidatePublicationRequest(f.plan, prepared, f.providers, reviewedLaunchCeilings);
  assert.equal(fresh.gasLimit, '4532103'); assert.equal(BigInt(prepared.request.gas), 4600000n);
  assert.deepEqual(prepared, original);
  const retry = await preparePublicationRetry(f.plan, { ...prepared, transactionHash: null }, f.providers, reviewedLaunchCeilings, prepared.requestDigest, 1);
  assert.deepEqual(retry.request, original.request); assertPublicationRequest(f.plan, retry);
  f.setEstimate(4357142n); // ceil(estimate * 1.05) + 25000 reaches the ceiling exactly.
  assert.equal((await revalidatePublicationRequest(f.plan, prepared, f.providers, reviewedLaunchCeilings)).gasLimit, '4600000');
  assert.deepEqual(prepared, original);
});
test('fixed reviewed launch gas still requires the full fresh buffer and balance for its maximum cost', async () => {
  const f = await gasDriftFixture(), prepared = await preparePublicationRequest(f.plan, 0, f.providers, reviewedLaunchCeilings);
  for (const estimate of [4357143n, 4600001n]) {
    f.setEstimate(estimate); // The first raw estimate fits, but its unchanged buffer needs 4600001 gas.
    await assert.rejects(preparePublicationRequest(f.plan, 0, f.providers, reviewedLaunchCeilings), /Gas estimate/);
    await assert.rejects(revalidatePublicationRequest(f.plan, prepared, f.providers, reviewedLaunchCeilings), /Gas estimate/);
    await assert.rejects(preparePublicationRetry(f.plan, { ...prepared, transactionHash: null }, f.providers, reviewedLaunchCeilings, prepared.requestDigest, 1), /Gas estimate/);
  }
  f.setEstimate(4292479n);
  const maximumCost = BigInt(prepared.request.value) + 4600000n * BigInt(prepared.request.maxFeePerGas);
  f.setBalance(maximumCost); await revalidatePublicationRequest(f.plan, prepared, f.providers, reviewedLaunchCeilings);
  f.setBalance(maximumCost - 1n);
  await assert.rejects(preparePublicationRequest(f.plan, 0, f.providers, reviewedLaunchCeilings), /balance/);
  await assert.rejects(revalidatePublicationRequest(f.plan, prepared, f.providers, reviewedLaunchCeilings), /balance/);
  await assert.rejects(preparePublicationRetry(f.plan, { ...prepared, transactionHash: null }, f.providers, reviewedLaunchCeilings, prepared.requestDigest, 1), /balance/);
});
test('fixed launch gas cannot replace reviewed gas, fees, value, nonce or calldata at arm or retry', async () => {
  const f = await gasDriftFixture(), prepared = await preparePublicationRequest(f.plan, 0, f.providers, reviewedLaunchCeilings);
  for (const change of [{ maxGas: '4599999' }, { maxGas: '4600001' }, { maxFeePerGas: '800000001' }, { maxPriorityFeePerGas: '10000001' }]) {
    await assert.rejects(revalidatePublicationRequest(f.plan, prepared, f.providers, { ...reviewedLaunchCeilings, ...change }), /changed/);
    await assert.rejects(preparePublicationRetry(f.plan, { ...prepared, transactionHash: null }, f.providers, { ...reviewedLaunchCeilings, ...change }, prepared.requestDigest, 1), /changed/);
  }
  for (const [key, value] of [['gas', '0x1'], ['nonce', '0x3'], ['value', '0x0'], ['data', '0x00'], ['maxFeePerGas', '0x1']]) {
    assert.notEqual(value, prepared.request[key]);
    const changed = structuredClone(prepared); changed.request[key] = value;
    await assert.rejects(revalidatePublicationRequest(f.plan, changed, f.providers, reviewedLaunchCeilings), /digest differs/);
    await assert.rejects(preparePublicationRetry(f.plan, { ...changed, transactionHash: null }, f.providers, reviewedLaunchCeilings, changed.requestDigest, 1), /digest differs/);
  }
});
test('independent providers and no pending owner nonce are required', async () => {
  const f = rpcFixture(); await observePublicationOperation(f.plan, 0, f.providers);
  await assert.rejects(observePublicationOperation(f.plan, 0, [f.providers[0], f.providers[0]]), /quorum/);
  f.setPending(); await assert.rejects(observePublicationOperation(f.plan, 0, f.providers), /pending/);
});
test('revalidation rejects nonce drift and exact retry retains the original gas and payload', async () => {
  const f = rpcFixture(), prepared = await preparePublicationRequest(f.plan, 0, f.providers, ceilings);
  assertPublicationRequest(f.plan, prepared); await revalidatePublicationRequest(f.plan, prepared, f.providers, ceilings);
  const retry = await preparePublicationRetry(f.plan, { ...prepared, transactionHash: null }, f.providers, ceilings, prepared.requestDigest, 1);
  assert.deepEqual(retry.request, prepared.request); assertPublicationRequest(f.plan, retry);
  f.setNonce('0x2'); await assert.rejects(revalidatePublicationRequest(f.plan, prepared, f.providers, ceilings), /nonce/);
  await assert.rejects(preparePublicationRetry(f.plan, prepared, f.providers, ceilings, prepared.requestDigest, 2), /nonce/);
});
test('receipt requires the original EIP-1559 fields, success, canonical block and post-state', async () => {
  const f = rpcFixture(), prepared = await preparePublicationRequest(f.plan, 0, f.providers, ceilings); f.setRequest(prepared.request);
  const entry = { ...prepared, transactionHash: h(20) }; assert.equal((await observePublicationReceipt(f.plan, entry, f.providers)).status, 'included-code-verified-unfinalized');
  f.setChangedField('nonce'); await assert.rejects(observePublicationReceipt(f.plan, entry, f.providers), /nonce/);
  f.setChangedField(null); f.step.postReads = [f.call]; f.setWrongState(); await assert.rejects(observePublicationReceipt(f.plan, entry, f.providers), /binding differs/);
  f.step.postReads = []; f.setReverted(); await assert.rejects(observePublicationReceipt(f.plan, entry, f.providers), /reverted/);
});
test('UI-check server enforces exact origin and disables all wallet/journal/provider actions', async () => {
  const f = await publicationFixture(), plan = await createPublicationPlan({ ...f, modules: [f.module] });
  const { server, url } = await startPublicationOperator({ plan, uiCheck: true, port: 18987 });
  try {
    const page = await (await fetch(url)).text(); const token = page.match(/name="operator-token" content="([a-f0-9]+)"/)[1];
    const headers = { origin: url, 'x-module-operator-token': token, 'content-type': 'application/json' };
    const state = await fetch(`${url}/state`, { method: 'POST', headers, body: '{}' }); assert.equal((await state.json()).uiCheck, true);
    assert.equal((await fetch(`${url}/prepare`, { method: 'POST', headers, body: '{}' })).status, 400);
    assert.equal((await fetch(`${url}/state`, { method: 'POST', headers: { ...headers, origin: 'https://untrusted.invalid' }, body: '{}' })).status, 400);
    assert.equal((await fetch(`${url}/state`, { method: 'POST', headers, body: '{"a":1,"a":2}' })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
