import test from 'node:test';
import { mkdtemp, chmod, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { runInNewContext } from 'node:vm';
import { REPOSITORY_ROOT } from '../module-mode/build.mjs';
import { canonicalJson, digest, sha256 } from '../module-mode/core.mjs';
import { armJournal, armRetryJournal, journalEntry, recordTransaction, recordReceipt } from '../module-mode/journal.mjs';
import assert from 'node:assert/strict';
import { decodeFunctionData, decodeFunctionResult, encodeFunctionData, encodeFunctionResult, erc20Abi } from 'viem';
import { engineWalletFixture, engineWorld, a, h } from './wallet-test-fixtures.mjs';
import { createEnginePublicationOperatorPlan, assertEnginePublicationOperatorPlan, assertCurrentEngineReview, assertAnyQuotePublicationIdentity, ENGINE_LIFECYCLE_OPERATOR_SCHEMA } from './publication-plan.mjs';
import { createEngineLifecycleOperatorPlan, assertEngineLifecycleOperatorPlan, bindAnyQuotePreactivationPacket } from './lifecycle-operator-plan.mjs';
import { assertAuthenticatedOperationPlan } from '../module-mode/publication-plan.mjs';
import { assertOperationPlan, startPublicationOperator } from '../module-mode/publication-operator.mjs';
import { preparePublicationRequest, revalidatePublicationRequest, preparePublicationRetry, observePublicationReceipt, observePublicationOperation,
  assertPublicationRequest, publicationWalletRequest } from '../module-mode/publication-rpc.mjs';
import { anyQuoteWalletStep, anyQuoteRequestExpiry } from './operation-rpc.mjs';
const ceilings = { maxGas: '2000000', maxFeePerGas: '1000', maxPriorityFeePerGas: '10', maxValue: '10000' };

test('Any Quote publication binds the platform wallet to a new family without rewriting prior authorship', async () => {
  const f = await engineWalletFixture(), author = '0xd88539d3c4c460136a733a3fd60cf6bf269079da';
  const request = structuredClone(f.source);
  Object.assign(request.descriptor, { author, rewardWallet: author, familySalt: '0x26106d3b3ae444a8974ec9900aa35321d616d0dd8bd4850fc3855ae6cc539069' });
  delete request.supersedesSubmissionId;
  const validate = value => { const checked = f.api.validateModuleSubmissionRequest(value); assert.equal(checked.ok, true); return checked; };
  const source = validate(request), subject = { ...f.bundle.review.subject, author, requestDigest: source.requestDigest };
  assert.equal(source.familyId, '0x91ec5e77c54fc78d8cd1240c9caf3252a8ee656b9ad9e6b3f454399985d0760b');
  assertAnyQuotePublicationIdentity(source, subject);
  for (const mutate of [
    value => { value.descriptor.author = '0x2bb333d48dfaf1596d9036671d2e43168994249e'; },
    value => { value.descriptor.rewardWallet = a(99); },
    value => { value.descriptor.familySalt = h(99); },
    value => { value.supersedesSubmissionId = '87ff3c7c-1e6a-4196-9ac4-279daa63c72a'; },
  ]) {
    const changed = structuredClone(request); mutate(changed);
    assert.throws(() => assertAnyQuotePublicationIdentity(validate(changed), subject), /platform author and reward wallet/);
  }
  assert.throws(() => assertAnyQuotePublicationIdentity(source, { ...subject, author: a(99) }), /platform author and reward wallet/);
});

// Wire-only synthetic cases. They cannot pass the real source/deployment/admission initialization.
function anyQuoteWire(kind = 'buy') {
  const owner = a(1), token = a(2), recipient = a(3), router = a(4), ledger = a(5), host = a(6), permit2 = a(7), timestamp = Math.floor(Date.now() / 1000);
  const identity = { sourceVersion: 'module-engine-any-quote-v1', releaseDigest: h(1), contracts: { host: { address: host }, universalRouter: { address: router }, ledger: { address: ledger } } };
  const bundle = { manifest: { manifest: { catalogDefinition: { id: 'wire-only' } } }, review: { command: { hostManifestHash: h(2) }, decisionDigest: h(3) } };
  const template = { status: 'available', manifest: bundle.manifest, manifestHash: h(2), reviewDigest: h(3) };
  const intent = kind === 'claim' ? { token, recipient } : { token, recipient, inputAmount: '10', slippageBps: 100,
    ...(kind === 'approve' ? { amount: '10', allowanceKind: 'permit2', spender: router, maximumApprovalLifetimeSeconds: 300 } : {}) };
  const to = kind === 'claim' ? ledger : kind === 'approve' ? permit2 : router, value = kind === 'buy' ? '10' : '0';
  const step = { kind: `any-quote-${kind}`, intent, to, value, data: null, target: token, newCode: [], preReads: [], postReads: [] };
  const plan = { schemaVersion: ENGINE_LIFECYCLE_OPERATOR_SCHEMA, identity, owner, bundle, steps: [step], planDigest: h(4) };
  const quote = { releaseDigest: identity.releaseDigest, templateId: 'wire-only', account: owner, token, recipient, buy: kind === 'buy', inputAmount: '10', slippageBps: 100,
    validUntil: String(timestamp + 40), checkpoint: { number: '100', timestamp: String(timestamp), hash: h(5) }, minimumOutput: '9', externalRoute: { evidenceHash: h(6) } };
  const recipe = kind === 'claim' ? { kind, template, account: owner, token, recipient } : { kind: kind === 'approve' ? 'approve' : 'swap', template, account: owner, quote };
  const prepared = { kind: kind === 'buy' ? 'swap' : kind, account: owner, releaseDigest: identity.releaseDigest, blockNumber: '100', expiresAt: String(timestamp + 300),
    transaction: { from: owner, to, value: `0x${BigInt(value).toString(16)}`, data: '0x1234', gas: '0x10000' },
    ...(kind === 'claim' ? { token, recipient, minimumAmount: '2' } : kind === 'approve' ? { token, amount: '10', allowanceKind: 'permit2', spender: permit2, permit2Spender: router, expiration: String(timestamp + 300) } : {}) };
  const envelope = { schemaVersion: 'programmable.any-quote.lifecycle-preparation.v1', identity, recipe, prepared,
    ...(kind === 'approve' ? { funding: { kind: 'approval-required', amount: '10' } } : {}), evidenceHash: h(7) };
  const observation = { state: 'operation-simulated', stepIndex: 0, anyQuote: envelope, simulatedResult: prepared,
    nonce: '1', gasLimit: '100000', baseFeePerGas: '1', minimumBalance: '10000000000' };
  const issuedAt = Date.now(), body = { planDigest: plan.planDigest, stepIndex: 0, observation, request: publicationWalletRequest(plan, observation, ceilings),
    issuedAt, expiresAt: Math.min(issuedAt + 45000, anyQuoteRequestExpiry(envelope)) };
  return { plan, envelope, body, entry: { ...body, requestDigest: digest('programmable.module-mode-publication-owner-request.v1', body) } };
}
test('Any Quote cannot use an identity-only or missing-admission packet', async () => {
  const f = anyQuoteWire();
  await assert.rejects(bindAnyQuotePreactivationPacket({ identity: f.plan.identity }, f.plan.identity, f.plan.bundle));
  await assert.rejects(bindAnyQuotePreactivationPacket({ schemaVersion: 'programmable.module-engine-any-quote-preactivation-packet.v1',
    deploymentPlan: {}, build: {}, deploymentEntries: [], deploymentEvidenceRaw: '{}', sourceVerificationEvidenceRaw: '{}', previousSourceVerificationEvidenceRaw: '{}' }, f.plan.identity, f.plan.bundle));
});
test('Any Quote exact route payload, pins, actor and recipient are bound by the stored request', async () => {
  const f = anyQuoteWire(); assertPublicationRequest(f.plan, f.entry); assert.equal(f.entry.request.value, '0xa');
  assert.equal(f.body.expiresAt, Number(f.envelope.recipe.quote.validUntil) * 1000);
  for (const mutate of [e => { e.observation.anyQuote.identity.contracts.host.address = a(99); }, e => { e.request.data = '0x1235'; },
    e => { e.observation.anyQuote.recipe.quote.recipient = a(99); }, e => { e.observation.anyQuote.recipe.quote.externalRoute.evidenceHash = h(99); },
    e => { e.expiresAt += 60000; }]) {
    const entry = structuredClone(f.entry); mutate(entry); assert.throws(() => assertPublicationRequest(f.plan, entry));
  }
  const mutated = structuredClone(f.envelope); mutated.recipe.quote.inputAmount = '11'; assert.throws(() => anyQuoteWalletStep(f.plan, 0, mutated), /inputAmount/);
});
test('Any Quote expired arm and unknown-outcome retry fail before reads and cannot extend a route', async () => {
  const f = anyQuoteWire(), expiresAt = Date.now() - 1;
  f.body.issuedAt = expiresAt - 40000; f.body.expiresAt = expiresAt;
  const entry = { ...f.body, requestDigest: digest('programmable.module-mode-publication-owner-request.v1', f.body) };
  assertPublicationRequest(f.plan, entry);
  await assert.rejects(revalidatePublicationRequest(f.plan, entry, [], ceilings), /expired/);
  await assert.rejects(preparePublicationRetry(f.plan, { ...entry, transactionHash: null }, [], ceilings, entry.requestDigest, 1), /cannot extend/);
});
test('Any Quote permits only the required exact finite sell allowance and a positive beneficiary claim', () => {
  const f = anyQuoteWire('approve'); anyQuoteWalletStep(f.plan, 0, f.envelope);
  for (const mutate of [e => { e.prepared.amount = (2n ** 160n - 1n).toString(); }, e => { e.prepared.permit2Spender = a(99); },
    e => { delete e.funding; }, e => { e.prepared.expiration = String(BigInt(e.prepared.expiration) + 1n); }, e => { e.recipe.quote.buy = true; }]) {
    const envelope = structuredClone(f.envelope); mutate(envelope); assert.throws(() => anyQuoteWalletStep(f.plan, 0, envelope));
  }
  const claim = anyQuoteWire('claim'); anyQuoteWalletStep(claim.plan, 0, claim.envelope);
  claim.envelope.prepared.minimumAmount = '0'; assert.throws(() => anyQuoteWalletStep(claim.plan, 0, claim.envelope), /Positive actual beneficiary/);
});
test('existing publication UI expires an unarmed Any Quote review while retaining unknown-outcome recovery', async () => {
  const f = anyQuoteWire(), nodes = new Map(), timers = new Map(); let now = Date.now(), id = 0, handedOff = false;
  const node = key => { if (!nodes.has(key)) nodes.set(key, { hidden: false, disabled: false, checked: false, textContent: '', value: '', append() {}, focus() {}, querySelector: () => ({ focus() {} }) }); return nodes.get(key); };
  const state = { uiCheck: false, owner: f.plan.owner, chainId: 4663, sourceCommit: 'fixture', contractSourceCommit: 'fixture', releaseDigest: h(1), planDigest: h(4),
    stepIndex: 0, totalSteps: 1, step: { ...f.plan.steps[0], label: 'Synthetic UI test', functionName: 'buy', arguments: f.plan.steps[0].intent, preparation: 'fresh-canonical-any-quote' },
    authority: { runId: 'fixture' }, journalState: 'not-requested', actionInProgress: false, canRetry: false };
  const provider = { isMetaMask: true, on() {}, async request({ method }) {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [f.plan.owner];
    if (method === 'eth_chainId') return '0x1237';
    if (method === 'eth_sendTransaction') throw new Error('Synthetic ambiguous wallet rejection');
    throw new Error('Unexpected fixture wallet call');
  } };
  const source = await readFile(path.join(REPOSITORY_ROOT, 'contracts/scripts/module-mode/publication-operator.js'), 'utf8');
  runInNewContext(source, { document: { getElementById: node, querySelector: () => ({ content: 'fixture' }), createElement: () => ({ append() {} }) }, window: { ethereum: provider },
    Date: class extends Date { static now() { return now; } }, setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(key) { timers.delete(key); },
    fetch: async route => ({ ok: true, async json() {
      if (route === '/state') return { ...state, journalState: handedOff ? 'outcome-unknown' : 'not-requested' };
      if (route === '/prepare') return { ...f.entry, expiresAt: now + 40000 };
      if (route === '/arm') { handedOff = true; return { request: f.entry.request, requestDigest: f.entry.requestDigest }; }
      throw new Error('Unexpected fixture operator call');
    } }), console });
  await new Promise(resolve => setImmediate(resolve)); await node('connect').onclick(); await node('prepare').onclick();
  node('reviewed').checked = true; node('reviewed').onchange(); assert.equal(node('send').disabled, false);
  now += 40000; for (const timer of [...timers.values()]) timer();
  assert.equal(node('confirmation').hidden, true); assert.equal(node('send').disabled, true); assert.match(node('status').textContent, /expired/);
  await node('prepare').onclick(); node('reviewed').checked = true; node('reviewed').onchange(); await node('send').onclick();
  assert.equal(handedOff, true); assert.equal(node('recovery').hidden, false); assert.equal(node('prepare').hidden, true);
  assert.equal(node('send').disabled, true); assert.match(node('error').textContent, /not sent again automatically/);
});
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
test('Engine token creator normalizes ABI address casing and rejects a different address', async () => {
  const f = await engineWalletFixture(), previousHost = f.identity.contracts.host.address, host = a(0xabcd);
  const creatorResult = encodeFunctionResult({ abi: f.api.moduleEngineReadAbi, functionName: 'creator', result: host });
  const decodedCreator = decodeFunctionResult({ abi: f.api.moduleEngineReadAbi, functionName: 'creator', data: creatorResult });
  assert.notEqual(decodedCreator, host); assert.equal(decodedCreator.toLowerCase(), host);
  // Rebind the existing synthetic review fixture to a Host whose ABI-decoded address has checksum capitals.
  f.identity.contracts.host.address = host;
  f.identity.releaseDigest = f.api.computeModuleEngineReleaseDigest(f.identity);
  f.codes.set(host, f.codes.get(previousHost)); f.codes.delete(previousHost);
  f.bundle.manifest = f.api.createReviewedModuleEngineManifest({ job: { artifact: f.artifact, plan: f.bundle.buildPlan },
    descriptor: f.source.descriptor, release: f.identity, definition: f.definition.catalogDefinition, revision: f.definition.revision });
  f.bundle.review.command.hostManifestHash = f.api.computeModuleEngineHostManifestHash(f.bundle.manifest);
  const review = { ...f.bundle.review }; delete review.decisionDigest;
  f.bundle.review.decisionDigest = `0x${sha256(canonicalJson({ domain: review.schemaVersion, value: review }))}`;
  const plan = await createEngineLifecycleOperatorPlan(f), world = engineWorld(f, plan);
  const entry = await world.mine(await preparePublicationRequest(plan, 0, world.providers, ceilings));
  const evidence = await observePublicationReceipt(plan, entry, world.providers);
  assert.equal(evidence.status, 'included-code-verified-unfinalized');
  assert.equal(evidence.canary.token, plan.steps[0].expectation.token);
  const creatorData = encodeFunctionData({ abi: f.api.moduleEngineReadAbi, functionName: 'creator' });
  world.mutations.rpc = (method, params) => method === 'eth_call' && params[0].to === evidence.canary.token && params[0].data === creatorData
    ? encodeFunctionResult({ abi: f.api.moduleEngineReadAbi, functionName: 'creator', result: a(0xabce) }) : undefined;
  await assert.rejects(observePublicationReceipt(plan, entry, world.providers), /Engine token creator differs/);
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
    for (const method of ['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_sign', 'personal_sign', 'anvil_impersonateAccount']) await assert.rejects(world.providers[0].rpc(method, []), /read-only inventory/);
    await assert.rejects(world.providers[0].rpc('debug_traceCall', []), /Trace requires/);
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
