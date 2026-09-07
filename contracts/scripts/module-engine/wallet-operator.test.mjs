import test from 'node:test';
import { mkdtemp, chmod, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { REPOSITORY_ROOT } from '../module-mode/build.mjs';
import { armJournal, armRetryJournal, journalEntry, recordTransaction, recordReceipt } from '../module-mode/journal.mjs';
import assert from 'node:assert/strict';
import { decodeFunctionData, erc20Abi } from 'viem';
import { engineWalletFixture, engineWorld, a, h } from './wallet-test-fixtures.mjs';
import { createEnginePublicationOperatorPlan, assertEnginePublicationOperatorPlan, assertCurrentEngineReview } from './publication-plan.mjs';
import { createEngineLifecycleOperatorPlan, assertEngineLifecycleOperatorPlan } from './lifecycle-operator-plan.mjs';
import { assertAuthenticatedOperationPlan } from '../module-mode/publication-plan.mjs';
import { assertOperationPlan, startPublicationOperator } from '../module-mode/publication-operator.mjs';
import { preparePublicationRequest, revalidatePublicationRequest, preparePublicationRetry, observePublicationReceipt, observePublicationOperation } from '../module-mode/publication-rpc.mjs';
const ceilings = { maxGas: '2000000', maxFeePerGas: '1000', maxPriorityFeePerGas: '10', maxValue: '10000' };
async function launched(initial = false) {
  const f = await engineWalletFixture({ initial }), plan = await createEngineLifecycleOperatorPlan(f), world = engineWorld(f, plan); let entry, evidence;
  for (let i = 0; i < plan.steps.length; i++) {
    const prepared = await preparePublicationRequest(plan, i, world.providers, ceilings);
    entry = await world.mine(prepared); evidence = await observePublicationReceipt(plan, entry, world.providers);
  }
  return { f, plan, world, entry, evidence };
}
function executeAction(f, reference, { permission = 2, actor = f.owner, nonce = '0', amount = '2' } = {}) {
  const grant = f.artifact.operationPermissions[permission];
  return { kind: 'execute', launch: reference, intent: { operationId: grant.operationId, recipient: actor, inputAsset: permission === 2 ? 'quote' : 'native', inputAmount: permission === 2 ? amount : '0',
    outputAsset: permission === 3 ? 'quote' : 'native', minimumOutput: permission === 3 ? '1' : '0', data: h(2) }, nonce, deadline: f.action.deadline, funding: { mode: permission === 2 ? 'approve' : 'none', expectedAllowance: '0' } };
}
test('Engine publication reuses actual accepted manifest/calls and separates operator source, contract source, reviewer and owner', async () => {
  const f = await engineWalletFixture(), owner = a(993), plan = await createEnginePublicationOperatorPlan({ ...f, owner, familyState: 'absent' });
  assert.equal(plan.owner, owner); assert.equal(plan.reviewAuthority, f.reviewer); assert.notEqual(plan.sourceCommit, plan.identity.sourceCommit);
  assert.deepEqual(plan.steps.map(s => s.kind), ['engine-family', 'engine-revision']);
  assert.ok(plan.steps.every(s => s.value === '0')); await assertOperationPlan(plan); await assertEnginePublicationOperatorPlan(plan);
  await assertCurrentEngineReview(plan, await f.current());
  const current = await f.current(); await assert.rejects(assertCurrentEngineReview(plan, structuredClone(current)), /authenticated/);
  await assert.rejects(assertAuthenticatedOperationPlan(plan), /session file/);
  f.detail.job.state = 'rejected'; await assert.rejects(async () => assertCurrentEngineReview(plan, await f.current()));
});
test('Engine owner plan rejects altered acceptance/build/calldata, unknown profile, excess keys and private activation claims', async () => {
  const f = await engineWalletFixture();
  for (const mutate of [b => { b.review.command.hostManifestHash = h(15); }, b => { b.artifact.engine.creationBytecode += '00'; }, b => { b.manifest.manifest.revision.moneyRights = 7; }]) {
    const bundle = structuredClone(f.bundle); mutate(bundle); await assert.rejects(createEnginePublicationOperatorPlan({ ...f, bundle, familyState: 'existing' }));
  }
  const plan = await createEnginePublicationOperatorPlan({ ...f, familyState: 'existing' });
  for (const mutate of [p => { p.steps[0].data += '00'; }, p => { p.enabled = true; }, p => { p.reviewAuthority = a(3); }, p => { p.identity.status = 'active'; }]) {
    const changed = structuredClone(plan); mutate(changed); await assert.rejects(assertOperationPlan(changed));
  }
  await assert.rejects(assertOperationPlan({ ...plan, schemaVersion: 'invented-engine-profile' }), /Unknown/);
});
test('Engine family/admission transport verifies the actual owner, both providers, absence and exact admitted getters/event', async () => {
  const f = await engineWalletFixture(), plan = await createEnginePublicationOperatorPlan({ ...f, owner: f.reviewer, familyState: 'absent' }), w = engineWorld(f, plan, { published: false });
  w.mutations.registryOwner = a(995); await assert.rejects(observePublicationOperation(plan, 0, w.providers), /Registry EOA owner/); delete w.mutations.registryOwner;
  for (let i = 0; i < plan.steps.length; i++) {
    const prepared = await preparePublicationRequest(plan, i, w.providers, ceilings); const entry = await w.mine(prepared), receipt = await observePublicationReceipt(plan, entry, w.providers);
    assert.equal(receipt.sourceKind, 'module-engine-v1'); assert.equal(receipt.status, 'included-code-verified-unfinalized');
  }
  await assert.rejects(observePublicationOperation(plan, 1, w.providers), /already exists/);
  const estimates = w.methods.filter(c => c.method === 'eth_estimateGas'); assert.ok(estimates.length >= 4 && estimates.every(c => c.params[1]?.startsWith('0x')));
  assert.deepEqual(new Set(estimates.map(c => c.provider)), new Set([0, 1]));
});
test('Engine launch uses the shared pure codec and exact bounded ERC20 approval before its atomic initial operation', async () => {
  const f = await engineWalletFixture({ initial: true }), plan = await createEngineLifecycleOperatorPlan(f); await assertEngineLifecycleOperatorPlan(plan);
  assert.deepEqual(plan.steps.map(s => s.kind), ['engine-approve', 'engine-launch']);
  const approval = decodeFunctionData({ abi: erc20Abi, data: plan.steps[0].data }); assert.deepEqual(approval.args, [f.identity.contracts.host.address, 2n]);
  const launch = decodeFunctionData({ abi: f.api.moduleEngineHostAbi, data: plan.steps[1].data });
  assert.equal(launch.functionName, 'launch'); assert.equal(launch.args[0].initialOperation.inputAmount, 2n); assert.equal(launch.args[0].initialOperation.nonce, 0n);
  assert.equal(plan.steps[1].value, '0'); assert.equal(plan.owner, f.owner); assert.notEqual(plan.owner, f.reviewer);
  const w = engineWorld(f, plan); await assert.rejects(observePublicationOperation(plan, 1, w.providers), /allowance|allowance.*differs/i);
  const entry = await w.mine(await preparePublicationRequest(plan, 0, w.providers, ceilings)); await observePublicationReceipt(plan, entry, w.providers);
  const prepared = await preparePublicationRequest(plan, 1, w.providers, ceilings); await revalidatePublicationRequest(plan, prepared, w.providers, ceilings);
  const actual = await observePublicationReceipt(plan, await w.mine(prepared), w.providers);
  assert.equal(actual.operation.nonce, '0'); assert.equal(actual.canary.planHash, plan.steps[1].expectation.planHash); assert.equal(w.state.allowance, '0');
  assert.ok(!w.methods.some(c => c.method === 'eth_call' && c.params[0].data.startsWith('0x') && (() => { try { return decodeFunctionData({ abi: f.api.moduleEngineReadAbi, data: c.params[0].data }).functionName === 'familyFeeEligibility'; } catch { return false; } })()));
});
test('Engine funding is exact, with explicit zero-reset and no unlimited, unrelated or stand-alone approval', async () => {
  const f = await engineWalletFixture({ initial: true });
  for (const funding of [{ mode: 'existing', expectedAllowance: '3' }, { mode: 'approve', expectedAllowance: '2' }, { mode: 'none', expectedAllowance: '0' }]) await assert.rejects(createEngineLifecycleOperatorPlan({ ...f, action: { ...f.action, funding } }));
  const reset = await createEngineLifecycleOperatorPlan({ ...f, action: { ...f.action, funding: { mode: 'reset-approve', expectedAllowance: '4' } } });
  assert.deepEqual(reset.steps.filter(s => s.kind === 'engine-approve').map(s => s.approval.amount), ['0', '2']);
  const world = engineWorld(f, reset); world.state.allowance = '4'; world.sync();
  for (let i = 0; i < reset.steps.length; i++) { const entry = await world.mine(await preparePublicationRequest(reset, i, world.providers, ceilings)); await observePublicationReceipt(reset, entry, world.providers); }
  for (const mutate of [a => { a.initialOperation.inputAsset = a.quote.address; }, a => { a.initialOperation.actor = f.reviewer; }, a => { a.kind = 'approve'; }, a => { a.initialOperation.minimumOutput = '-1'; }, a => { a.initialOperation.inputAmount = ((1n << 256n) - 1n).toString(); }]) {
    const action = structuredClone(f.action); mutate(action); await assert.rejects(createEngineLifecycleOperatorPlan({ ...f, action }));
  }
});
test('Engine execute binds original launch receipt, exact Host nonce, immutable permission and creator-only authority', async () => {
  const { f, plan, world, entry, evidence } = await launched(true), reference = { plan, entry, evidence };
  const actor = a(996), action = executeAction(f, reference, { actor, nonce: '0' });
  const next = await createEngineLifecycleOperatorPlan({ ...f, owner: actor, action }); world.setPlan(next);
  for (let i = 0; i < next.steps.length; i++) { const e = await world.mine(await preparePublicationRequest(next, i, world.providers, ceilings)); const result = await observePublicationReceipt(next, e, world.providers); assert.equal(result.sourceKind, 'module-engine-v1'); }
  assert.equal(world.state.actorNonce[actor], '1'); assert.equal(world.state.actorNonce[f.owner], '1');
  const creatorOnly = executeAction(f, reference, { permission: 3, actor, nonce: '1' });
  await assert.rejects(createEngineLifecycleOperatorPlan({ ...f, owner: actor, action: creatorOnly }), /creator authority/);
  const authorized = await createEngineLifecycleOperatorPlan({ ...f, action: executeAction(f, reference, { permission: 3, nonce: '1' }) }); world.setPlan(authorized);
  const prepared = await preparePublicationRequest(authorized, 0, world.providers, ceilings);
  const fulfilled = await observePublicationReceipt(authorized, await world.mine(prepared), world.providers); assert.equal(fulfilled.operation.outputAmount, '1');
  const forged = structuredClone(reference); forged.evidence.canary.planHash = h(888);
  await assert.rejects(createEngineLifecycleOperatorPlan({ ...f, action: executeAction(f, forged) }), /Referenced/);
});
test('Engine nonce, deadline, wallet ceilings, quote code and provider disagreement fail before arming', async () => {
  const f = await engineWalletFixture(), plan = await createEngineLifecycleOperatorPlan(f), w = engineWorld(f, plan);
  await assert.rejects(preparePublicationRequest(plan, 0, [w.providers[0], w.providers[0]], ceilings), /quorum/);
  w.mutations.pending = true; await assert.rejects(preparePublicationRequest(plan, 0, w.providers, ceilings), /pending/); delete w.mutations.pending;
  await assert.rejects(preparePublicationRequest(plan, 0, w.providers, { ...ceilings, maxGas: '1' }), /Gas estimate/);
  w.mutations.balance = '0x0'; await assert.rejects(preparePublicationRequest(plan, 0, w.providers, ceilings), /balance/); delete w.mutations.balance;
  const request = await preparePublicationRequest(plan, 0, w.providers, ceilings);
  const retry = await preparePublicationRetry(plan, { ...request, transactionHash: null }, w.providers, ceilings, request.requestDigest, 1); assert.deepEqual(retry.request, request.request);
  w.state.eoaNonce = '9'; w.sync(); await assert.rejects(revalidatePublicationRequest(plan, request, w.providers, ceilings), /nonce/); w.state.eoaNonce = '1'; w.sync();
  w.mutations.rpc = (method, params, provider) => method === 'eth_getCode' && params[0] === f.quote.address && provider === 1 ? '0x6002' : undefined;
  await assert.rejects(preparePublicationRequest(plan, 0, w.providers, ceilings), /disagreement/); delete w.mutations.rpc;
  const stale = await createEngineLifecycleOperatorPlan({ ...f, action: { ...f.action, deadline: '1' } });
  await assert.rejects(preparePublicationRequest(stale, 0, w.providers, ceilings), /deadline/);
});
test('Engine receipt rejects a changed wallet request, wrong network, missing/duplicate/altered parameter event and absent result hash', async () => {
  const { f, plan, world, entry } = await launched();
  for (const patch of [{ nonce: '0x99' }, { value: '0x1' }, { input: '0x' }, { from: a(1) }]) { world.mutations.tx = patch; await assert.rejects(observePublicationReceipt(plan, entry, world.providers)); }
  delete world.mutations.tx; world.mutations.chain = '0x1'; await assert.rejects(observePublicationReceipt(plan, entry, world.providers), /chain/); delete world.mutations.chain;
  const r = world.receipts.get(entry.transactionHash), original = structuredClone(r.logs);
  for (const logs of [original.slice(0, 1), [...original, original[1]], original.map((l,i) => i === 1 ? { ...l, data: `${l.data}00` } : l), original.map((l,i) => i === 1 ? { ...l, removed: true } : l)]) {
    r.logs = logs; await assert.rejects(observePublicationReceipt(plan, entry, world.providers));
  }
  r.logs = original; const evidence = await observePublicationReceipt(plan, entry, world.providers);
  const next = await createEngineLifecycleOperatorPlan({ ...f, action: executeAction(f, { plan, entry, evidence }, { permission: 0 }) }); world.setPlan(next);
  const prepared = await preparePublicationRequest(next, 0, world.providers, ceilings), execution = await world.mine(prepared), receipt = world.receipts.get(execution.transactionHash);
  receipt.logs[0].data = `${receipt.logs[0].data.slice(0, -64)}${h(0).slice(2)}`;
  await assert.rejects(observePublicationReceipt(next, execution, world.providers), /result hash/);
});
test('Engine same server has a disabled inspection mode and retains the original wallet/source authority gate', async () => {
  const f = await engineWalletFixture(), plan = await createEngineLifecycleOperatorPlan(f);
  await assert.rejects(startPublicationOperator({ plan, port: 18883, reviewedPlanDigest: plan.planDigest }), /clean-source/);
  const { server, url } = await startPublicationOperator({ plan, uiCheck: true, port: 18883 });
  try {
    const page = await (await fetch(url)).text(), token = page.match(/name="operator-token" content="([a-f0-9]+)"/)[1];
    const headers = { origin: url, 'x-module-operator-token': token, 'content-type': 'application/json' };
    const state = await (await fetch(`${url}/state`, { method: 'POST', headers, body: '{}' })).json();
    assert.equal(state.owner, f.owner); assert.equal(state.contractSourceCommit, f.identity.sourceCommit); assert.equal(state.sourceCommit, f.sourceState.sourceCommit);
    assert.equal((await fetch(`${url}/arm`, { method: 'POST', headers, body: '{}' })).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('Engine resource IDs may advance but their actual Host event and getter must agree with the exact signed plan', async () => {
  const f = await engineWalletFixture(), plan = await createEngineLifecycleOperatorPlan(f), world = engineWorld(f, plan);
  const prepared = await preparePublicationRequest(plan, 0, world.providers, ceilings);
  world.mutations.resourcesHash = h(2222);
  await revalidatePublicationRequest(plan, prepared, world.providers, ceilings);
  const entry = await world.mine(prepared), evidence = await observePublicationReceipt(plan, entry, world.providers);
  assert.equal(evidence.canary.resourcesHash, h(2222)); assert.equal(evidence.canary.planHash, prepared.observation.simulatedResult.planHash);
  assert.notEqual(evidence.canary.resourcesHash, prepared.observation.simulatedResult.resourcesHash);
  await createEngineLifecycleOperatorPlan({ ...f, action: executeAction(f, { plan, entry, evidence }, { permission: 0 }) });
});
test('Engine grant keeps zero-valued ERC20 roles meaningful and actor nonce independent of the EOA nonce', async () => {
  const { f, plan, world, entry, evidence } = await launched(), reference = { plan, entry, evidence };
  const action = executeAction(f, reference, { permission: 0 }); action.intent.inputAsset = 'quote';
  await assert.rejects(createEngineLifecycleOperatorPlan({ ...f, action }), /asset roles/);
  const next = await createEngineLifecycleOperatorPlan({ ...f, action: executeAction(f, reference, { permission: 0 }) }); world.setPlan(next);
  const prepared = await preparePublicationRequest(next, 0, world.providers, ceilings);
  world.state.actorNonce[f.owner] = '1'; world.sync();
  await assert.rejects(revalidatePublicationRequest(next, prepared, world.providers, ceilings), /actor nonce/);
  world.state.actorNonce[f.owner] = '0'; world.state.enabled = false; world.sync(true);
  // Existing launches remain operable after the reviewed revision is disabled for new launches.
  await revalidatePublicationRequest(next, prepared, world.providers, ceilings);
});

test('Engine handoff uses the original durable unknown-outcome journal and same-nonce retry with no write/sign RPC', async () => {
  const f = await engineWalletFixture(), plan = await createEngineLifecycleOperatorPlan(f), world = engineWorld(f, plan);
  const directory = await mkdtemp(path.join(path.dirname(REPOSITORY_ROOT), '.engine-operator-journal-test-')); await chmod(directory, 0o700);
  try {
    const prepared = await preparePublicationRequest(plan, 0, world.providers, ceilings);
    await armJournal(directory, prepared, { evidenceClass: 'synthetic-test-only' });
    const pending = await journalEntry(directory, plan.planDigest, 0); assert.equal(pending.state, 'wallet-requested-outcome-unknown'); assert.equal(pending.transactionHash, null);
    await assert.rejects(armJournal(directory, prepared, {}), /exist/i);
    const retry = await preparePublicationRetry(plan, pending, world.providers, ceilings, pending.requestDigest, 1);
    await armRetryJournal(directory, retry, { evidenceClass: 'synthetic-test-only' }); assert.deepEqual(retry.request, pending.request);
    const mined = await world.mine(prepared); await recordTransaction(directory, plan.planDigest, 0, mined.transactionHash);
    const entry = await journalEntry(directory, plan.planDigest, 0), evidence = await observePublicationReceipt(plan, entry, world.providers);
    await recordReceipt(directory, plan.planDigest, 0, evidence);
    assert.equal(JSON.parse(await readFile(path.join(directory, `${plan.planDigest}-0.receipt.json`))).sourceKind, 'module-engine-v1');
    await assert.rejects(recordTransaction(directory, plan.planDigest, 0, h(999999)), /different transaction/);
    const count = world.methods.length;
    for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_sign', 'personal_sign', 'debug_traceCall', 'anvil_impersonateAccount']) await assert.rejects(world.providers[0].rpc(method, []), /read-only inventory/);
    assert.equal(world.methods.length, count);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('Engine execution permits state-dependent results while enforcing the exact signed output minimum', async () => {
  const { f, plan, world, entry, evidence } = await launched();
  const next = await createEngineLifecycleOperatorPlan({ ...f, action: executeAction(f, { plan, entry, evidence }, { permission: 3 }) }); world.setPlan(next);
  const prepared = await preparePublicationRequest(next, 0, world.providers, ceilings), execution = await world.mine(prepared), receipt = world.receipts.get(execution.transactionHash);
  const original = receipt.logs[0].data;
  receipt.logs[0].data = `${original.slice(0, -64)}${h(12345).slice(2)}`;
  const observed = await observePublicationReceipt(next, execution, world.providers);
  assert.equal(observed.operation.resultHash, h(12345)); assert.equal(observed.operation.outputAmount, '1');
  // outputAmount is the penultimate non-indexed word; actual output below one is rejected.
  receipt.logs[0].data = `${original.slice(0, -128)}${h(0).slice(2)}${original.slice(-64)}`;
  await assert.rejects(observePublicationReceipt(next, execution, world.providers), /below the reviewed minimum/);
});
