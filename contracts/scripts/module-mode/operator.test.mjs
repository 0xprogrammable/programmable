import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { keccak256, toHex } from 'viem';
import { buildPlan, assertPlan, HOOK_MASK, HOOK_FLAGS, materializeRuntime } from './core.mjs';
import { walletRequest, revalidateWalletRequest, rpcClient, observeReceipt } from './rpc.mjs';
import { armJournal, journalEntry, recordTransaction, journalDirectory } from './journal.mjs';
import { sameOrigin, startOperator } from './operator.mjs';
import { evidenceBytes, evidenceDigest, writeEvidence, sourceVerificationRequests, validatePublishedSource } from './evidence.mjs';

import { addr, params, build, plan } from './test-fixtures.mjs';

test('all deployment payloads bind deterministic targets, zero ETH, owner, roles and hook bits', () => {
  assert.equal(plan.steps.length, 9); assert.equal(new Set(Object.values(plan.contracts).map(pin => pin.address)).size, 13);
  assert.equal(Object.hasOwn(plan.contracts, 'rewardFactory'), false); assert.equal(Object.hasOwn(plan.contracts, 'capFactory'), false);
  assert.equal(Object.keys(plan.identityCandidate.contracts).length, 15, 'Thirteen core contracts plus two official Uniswap contracts');
  assert.equal(BigInt(plan.contracts.hook.address) & HOOK_MASK, HOOK_FLAGS);
  assert.equal(plan.economics.noModuleRecipient, plan.economics.treasury);
  assert.equal(plan.economics.protocolFeeBps, 20); assert.equal(plan.parameters.minimumInitialBuyNative, '400000000000000');
  assert.ok(plan.steps.every(step => step.value === '0' && step.sender === params.owner && step.data.startsWith(step.salt)));
  assert.deepEqual(assertPlan(plan, build), plan);
  const changed = structuredClone(plan); changed.steps[8].value = '1'; assert.throws(() => assertPlan(changed, build), /differs/);
  changed.steps[8].value = '0'; changed.parameters.minimumInitialBuyNative = '400000000000001'; assert.throws(() => assertPlan(changed, build), /differs/);
});
test('constructor inputs and native minimum cannot be omitted or silently replaced', () => {
  assert.throws(() => buildPlan(build, { ...params, minimumInitialBuyNative: '0' }), /integer/);
  assert.throws(() => buildPlan(build, { ...params, owner: addr(0) }), /nonzero/);
  assert.throws(() => buildPlan(build, { ...params, chainId: 1 }), /keys/);
  assert.notEqual(buildPlan(build, { ...params, reviewAuthority: addr(7) }).contracts.registry.address, plan.contracts.registry.address);
  assert.equal(buildPlan(build, { ...params, owner: addr(7) }).contracts.hook.address, plan.contracts.hook.address, 'Gas payer does not silently become an authority');
});
test('immutable reconstruction rejects unknown, overlapping, missing or surplus replacements', () => {
  const artifact = build.artifacts.positionForwarderFactory;
  assert.throws(() => materializeRuntime(artifact), /Missing/);
  assert.throws(() => materializeRuntime(artifact, { positionManager: addr(1), extra: addr(2) }), /Unexpected/);
  const broken = structuredClone(artifact); broken.deployedBytecode.immutableReferences['1'] = [{ start: 0, length: 32 }]; broken.immutableNames['1'] = 'positionManager';
  assert.throws(() => materializeRuntime(broken, { positionManager: addr(1) }), /Overlapping/);
  assert.equal(materializeRuntime(artifact, { positionManager: addr(1) }), `0x${'0'.repeat(63)}1`);
});
const observation = { state: 'vacant-simulated', stepIndex: 0, nonce: '3', minimumBalance: '1000000000000000000', baseFeePerGas: '10', gasLimit: '3000000' };
const ceilings = { maxGas: '12000000', maxFeePerGas: '100', maxPriorityFeePerGas: '1' };
test('EIP1559 request is exact, fully funded and bounded', () => {
  const request = walletRequest(plan, observation, ceilings);
  assert.deepEqual(Object.keys(request).sort(), ['chainId', 'from', 'to', 'value', 'data', 'nonce', 'gas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'accessList', 'type'].sort());
  assert.equal(request.chainId, '0x1237'); assert.equal(request.value, '0x0'); assert.equal(request.nonce, '0x3');
  assert.throws(() => walletRequest(plan, { ...observation, minimumBalance: '0' }, ceilings), /insufficient/);
  assert.throws(() => walletRequest(plan, observation, { ...ceilings, maxGas: '100' }), /gas limit/);
  assert.throws(() => walletRequest(plan, observation, { ...ceilings, maxFeePerGas: '10' }), /base fee/);
  assert.throws(() => walletRequest(plan, { ...observation, state: 'already-deployed-receipt-required' }, ceilings), /vacant/);
  assert.throws(() => walletRequest(plan, observation, { ...ceilings, gasPrice: null }), /keys/);
});
test('expiry stops the handoff before any RPC or wallet access', async () => {
  await assert.rejects(revalidateWalletRequest(plan, { planDigest: plan.planDigest, issuedAt: 0, expiresAt: 1 }, [], ceilings), /expired/);
});
function receiptFixture(stepIndex = 0) {
  const step = plan.steps[stepIndex], transactionHash = keccak256(toHex('included-transaction-fixture'));
  const request = walletRequest(plan, { ...observation, stepIndex }, ceilings);
  const entry = { planDigest: plan.planDigest, stepIndex, request, transactionHash };
  const transaction = { ...request, input: request.data, hash: transactionHash, blockHash: keccak256(toHex('canonical-block-fixture')), blockNumber: '0x123' };
  const receipt = { transactionHash, blockHash: transaction.blockHash, blockNumber: transaction.blockNumber, status: '0x1', gasUsed: '0x1000', transactionIndex: '0x0' };
  const block = { hash: transaction.blockHash, transactions: [transactionHash] };
  const responses = [0, 1].map(() => structuredClone({ transaction, receipt, block }));
  const codeOverrides = [{}, {}];
  const providers = responses.map((response, index) => ({ providerId: `fixture-${index}`, trustDomain: `independent-${index}`, rpc: async (method, params) => {
    if (method === 'eth_getTransactionByHash') return response.transaction;
    if (method === 'eth_getTransactionReceipt') return response.receipt;
    if (method === 'eth_getBlockByNumber') return response.block;
    if (method === 'eth_getCode') {
      assert.equal(params[1], transaction.blockNumber, 'Every child runtime is read at the receipt block');
      return codeOverrides[index][params[0]] ?? Object.values(plan.contracts).find(pin => pin.address === params[0])?.runtime ?? '0x';
    }
    throw new Error(`Unexpected receipt method ${method}`);
  } }));
  return { entry, step, providers, responses, codeOverrides };
}
test('receipt readback binds the actual wallet transaction and every constructor-created child', async () => {
  const fixture = receiptFixture(8);
  const result = await observeReceipt(plan, fixture.entry, fixture.providers);
  assert.equal(result.status, 'included-code-verified-unfinalized');
  assert.deepEqual(Object.keys(result.contracts), ['launcher', 'runtime', 'budgetVault', 'swapRouter']);
  assert.equal(result.receipt.transactionHash, fixture.entry.transactionHash);
  assert.equal(Object.hasOwn(result, 'finalized'), false);
});
test('pending inclusion is preserved without claiming successful deployment', async () => {
  const fixture = receiptFixture(); fixture.responses[1].receipt = null;
  assert.deepEqual(await observeReceipt(plan, fixture.entry, fixture.providers), { status: 'pending', transactionHash: fixture.entry.transactionHash });
});
test('receipt rejects changed calldata, payer, nonce, gas, chain and provider disagreement', async () => {
  for (const [field, value] of [['input', '0x1234'], ['from', addr(99)], ['nonce', '0x4'], ['gas', '0x1'], ['maxFeePerGas', '0x1'], ['chainId', '0x1']]) {
    const fixture = receiptFixture(); fixture.responses.forEach(response => { response.transaction[field] = value; });
    await assert.rejects(observeReceipt(plan, fixture.entry, fixture.providers), /does not match|changed/);
  }
  const fixture = receiptFixture(); fixture.responses[1].transaction.gas = '0x1';
  await assert.rejects(observeReceipt(plan, fixture.entry, fixture.providers), /Provider disagreement/);
});
test('reverted, reorganized or mismatched child bytecode never becomes deployment evidence', async () => {
  const reverted = receiptFixture(); reverted.responses.forEach(response => { response.receipt.status = '0x0'; });
  await assert.rejects(observeReceipt(plan, reverted.entry, reverted.providers), /reverted/);
  const reorg = receiptFixture(); reorg.responses.forEach(response => { response.block.hash = keccak256(toHex('replacement')); });
  await assert.rejects(observeReceipt(plan, reorg.entry, reorg.providers), /canonical block/);
  const code = receiptFixture(8); code.codeOverrides.forEach(overrides => { overrides[plan.contracts.budgetVault.address] = '0x'; });
  await assert.rejects(observeReceipt(plan, code.entry, code.providers), /Runtime code mismatch/);
  const sameProvider = receiptFixture(); sameProvider.providers[1].trustDomain = sameProvider.providers[0].trustDomain;
  await assert.rejects(observeReceipt(plan, sameProvider.entry, sameProvider.providers), /Independent provider quorum/);
});
test('RPC client refuses mutation methods and never exposes credential URLs or error bodies', async () => {
  let calls = 0; const rpc = rpcClient('https://example.invalid/secret-canary-credential', 'primary', async () => { calls++; throw new Error('secret-canary-credential'); });
  await assert.rejects(rpc('eth_sendRawTransaction', ['0x']), /read-only/); assert.equal(calls, 0);
  await assert.rejects(rpc('eth_getCode', []), error => error.message === 'primary: eth_getCode read failed');
});
test('owner journal locks even an ambiguous wallet handoff and rejects duplicate/replaced tx', async () => {
  const directory = await mkdtemp(path.join(os.homedir(), '.module-owner-test-')); await chmod(directory, 0o700);
  const prepared = { planDigest: plan.planDigest, stepIndex: 0, request: walletRequest(plan, observation, ceilings), requestDigest: keccak256(toHex('request')) };
  try {
    await armJournal(directory, prepared, { fixture: true });
    assert.equal((await journalEntry(directory, plan.planDigest, 0)).state, 'wallet-requested-outcome-unknown');
    await assert.rejects(armJournal(directory, prepared, {}), { code: 'EEXIST' });
    const tx = keccak256(toHex('actual-recorded-hash-fixture')); await recordTransaction(directory, plan.planDigest, 0, tx);
    assert.equal((await recordTransaction(directory, plan.planDigest, 0, tx)).transactionHash, tx);
    await assert.rejects(recordTransaction(directory, plan.planDigest, 0, keccak256(toHex('different'))), /different transaction/);
    await chmod(directory, 0o755); await assert.rejects(journalDirectory(directory), /0700/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('same-origin boundary rejects cross-origin requests, missing session token and host rebinding', () => {
  const req = { headers: { host: '127.0.0.1:8787', origin: 'http://127.0.0.1:8787', 'x-module-operator-token': 'bound', 'sec-fetch-site': 'same-origin' } };
  sameOrigin(req, 'http://127.0.0.1:8787', 'bound');
  for (const [key, value] of [['host', 'attacker.example'], ['origin', 'https://attacker.example'], ['x-module-operator-token', 'wrong'], ['sec-fetch-site', 'cross-site']]) assert.throws(() => sameOrigin({ headers: { ...req.headers, [key]: value } }, 'http://127.0.0.1:8787', 'bound'));
});
test('UI-check server rejects every mutation and keeps the real prepare path disabled', async () => {
  const port = 18787; const { server, url } = await startOperator({ plan, stepIndex: 8, uiCheck: true, port });
  try {
    const page = await fetch(url); const html = await page.text(); const token = html.match(/name="operator-token" content="([a-f0-9]+)"/)[1];
    assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    for (const route of ['/arm', '/prepare', '/record', '/receipt']) {
      const r = await fetch(`${url}${route}`, { method: 'POST', headers: { origin: url, 'x-module-operator-token': token, 'content-type': 'application/json' }, body: '{}' });
      assert.equal(r.status, 400); assert.match((await r.json()).error, /UI-check/);
    }
    const state = await fetch(`${url}/state`, { method: 'POST', headers: { origin: url, 'x-module-operator-token': token } });
    const actualState = await state.json(); assert.equal(actualState.authority, null);
    assert.equal(actualState.transactionRecipient, plan.steps[8].to);
    const duplicate = await fetch(`${url}/state`, { method: 'POST', headers: { origin: url, 'x-module-operator-token': token }, body: '{"x":1,"x":2}' });
    assert.equal(duplicate.status, 400); assert.match((await duplicate.json()).error, /Duplicate/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('evidence hashes exact bytes including whitespace and cannot cross release identity', async () => {
  const value = { schemaVersion: 'fixture', chainId: 4663, releaseDigest: plan.planDigest };
  assert.notEqual(evidenceDigest(evidenceBytes(value)), evidenceDigest(Buffer.from(JSON.stringify(value))));
  assert.equal(evidenceDigest(evidenceBytes(value)), keccak256(evidenceBytes(value)));
  await assert.rejects(writeEvidence('/unused', 'deployment', { ...value, chainId: 1 }, value.releaseDigest), /identity/);
});
test('source publication requests bind actual constructor args and cannot assert verification', () => {
  const sourceBuild = { ...build, standardInputs: Object.fromEntries(Object.keys(build.artifacts).map(role => [role, { language: 'Solidity', sources: {}, settings: {} }])) };
  const requests = sourceVerificationRequests(plan, sourceBuild);
  assert.equal(requests.launcher.status, 'unsubmitted'); assert.match(requests.launcher.url, new RegExp(plan.contracts.launcher.address));
  assert.equal(requests.launcher.body.constructor_args, plan.steps[8].constructorArguments.slice(2));
  assert.throws(() => validatePublishedSource(plan, sourceBuild, 'launcher', { is_verified: true }), /full source/);
});
