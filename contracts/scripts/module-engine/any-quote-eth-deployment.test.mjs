import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAbiParameters, encodeAbiParameters, encodeFunctionData, getCreate2Address, getContractAddress, keccak256, parseAbi, parseAbiParameters, toHex, zeroAddress } from 'viem';
import { fixtures, params, addr } from '../module-mode/test-fixtures.mjs';
import { buildPlan, digest, HOOK_FLAGS, HOOK_MASK } from '../module-mode/core.mjs';
import { observeReceipt, walletRequest } from '../module-mode/rpc.mjs';
import { operatorSourceProfile } from '../module-mode/operator.mjs';
import { assertContinuationPlan } from '../module-mode/recovery.mjs';
import { evidenceDigest } from '../module-mode/evidence.mjs';
import { ANY_QUOTE_ROUTER, assertAnyQuoteProfile } from './any-quote-core.mjs';
import { ANY_QUOTE_ETH_DEPLOYMENT_SCHEMA, ANY_QUOTE_ETH_REUSE_DOMAIN, ANY_QUOTE_ETH_GUARD_REUSE_DOMAIN,
  assertAnyQuoteEthPlan, assertAnyQuoteEthProfile, buildAnyQuoteEthPlan } from './any-quote-eth-core.mjs';
import { anyQuoteEthConstructorArguments, anyQuoteEthGuardSourceReuse, anyQuoteEthSourceCreation, anyQuoteEthSourceRequests } from './any-quote-eth-evidence.mjs';
import { observeAnyQuoteEthReceipt, observeAnyQuoteEthStage } from './any-quote-eth-rpc.mjs';
import { createEngineLifecyclePlan } from './lifecycle-plan.mjs';
import { engineWire } from './shared.mjs';
import { anyQuoteWalletStep } from './operation-rpc.mjs';
import { ENGINE_LIFECYCLE_OPERATOR_SCHEMA } from './publication-plan.mjs';
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
      nativeRouteGuard: artifact('guard'),
      host: artifact('host', ['tokenFactory', 'launchPolicy', 'registry', 'sharedHook', 'sharedHookCodeHash', 'nativeRouteGuard', 'ledger', 'quotePoolManager', 'quotePoolManagerCodeHash'],
        'address tokenFactory,address launchPolicy,address registry,address poolManager,address rewardAdmin,address sharedHook,bytes32 sharedHookCodeHash,address nativeRouteGuard'),
      sharedHook: artifact('sharedHook', ['poolManager', 'host', 'ledger'], 'address poolManager,address host,address rewardAdmin'),
      ledger: artifact('ledger', ['poolManager', 'host', 'hook', 'rewardAdmin'], 'address poolManager,address host,address rewardAdmin') };
    const hostSource = `SOURCE_VERSION = keccak256("programmable.module-engine.any-quote.native-eth.v1");\n${Object.entries({
      TOKEN_FACTORY_CODE_HASH: previousPlan.contracts.tokenFactory.runtimeCodeHash,
      LAUNCH_POLICY_CODE_HASH: previousPlan.contracts.launchPolicy.runtimeCodeHash,
      NATIVE_ROUTE_GUARD_CODE_HASH: keccak256(artifacts.nativeRouteGuard.deployedBytecode.object),
      UNIVERSAL_ROUTER: ANY_QUOTE_ROUTER.address, UNIVERSAL_ROUTER_CODE_HASH: ANY_QUOTE_ROUTER.runtimeCodeHash,
    }).map(([key, value]) => `${key} = ${value};`).join('\n')}`;
    const build = { ...base, artifacts, standardInputs: Object.fromEntries(Object.keys(artifacts).map(role => [role,
      { language: 'Solidity', sources: { [role === 'host' ? 'src/module-engine/any-quote/ModuleEngineAnyQuoteEthHostV1.sol' : `src/${role}.sol`]: { content: role === 'host' ? hostSource : '// synthetic fixture only' } }, settings: {} }])) };
    const previousRelease = { ...previousPlan.identityCandidate, enabled: true, status: 'active', startBlock: '10', releaseDigest: h('prior-native-release') };
    // Synthetic transport fixtures are deliberately unrelated to real deployment evidence.
    const guardRelease = { sourceVersion: 'module-engine-any-quote-v1', sourceCommit: 'a'.repeat(40), releaseDigest: h('prior-quote-release'),
      sourceVerificationDigest: h('prior-guard-source'), contracts: { nativeRouteGuard: { address: addr(89), runtimeCodeHash: keccak256(artifacts.nativeRouteGuard.deployedBytecode.object) } } };
    const body = { schemaVersion: 'programmable.module-mode-native-v2-basis.v1', chainId: 4663, provenance: { sourceCommit: build.sourceCommit },
      previousRelease, guardRelease, deploymentOwner: params.owner, registryOwner: params.reviewAuthority, rewardAdmin: previousPlan.economics.rewardAdmin };
    const basis = { ...body, basisDigest: digest(body.schemaVersion, body) };
    build.reuseSourceProvenance = { previousReleaseDigest: previousRelease.releaseDigest, previousSourceCommit: previousRelease.sourceCommit };
    build.reuseSourceDigest = digest(ANY_QUOTE_ETH_REUSE_DOMAIN, build.reuseSourceProvenance);
    build.guardSourceProvenance = { previousReleaseDigest: guardRelease.releaseDigest, previousSourceCommit: guardRelease.sourceCommit };
    build.guardSourceDigest = digest(ANY_QUOTE_ETH_GUARD_REUSE_DOMAIN, build.guardSourceProvenance);
    const parameters = { owner: params.owner, ownerNonce: '42', reviewAuthority: params.reviewAuthority, releaseLabel: 'test-any-quote-eth-v1' };
    return { build, basis, parameters, plan: await buildAnyQuoteEthPlan(build, parameters, basis) };
  })();
  return structuredClone(await fixturePromise);
}
test('native hook deploys first with its future Host bound; retained guard is never redeployed', async () => {
  const { plan, build } = await fixture(); await assertAnyQuoteEthPlan(plan, build); assertAnyQuoteEthProfile(plan);
  assert.deepEqual(plan.steps.map(s => [s.role, s.deploymentKind, s.nonce]), [['sharedHook', 'create2', '42'], ['host', 'create', '43']]);
  assert.deepEqual(plan.steps[0].expectedRoles, ['sharedHook', 'ledger']); assert.deepEqual(plan.steps[1].expectedRoles, ['host']);
  assert.equal(plan.contracts.host.address, getContractAddress({ from: plan.parameters.owner, nonce: 43n }).toLowerCase());
  assert.equal(plan.contracts.sharedHook.address, getCreate2Address({ from: plan.official.deterministicDeployer.address,
    salt: plan.sharedHookCreation.salt, bytecodeHash: plan.sharedHookCreation.initcodeHash }).toLowerCase());
  assert.equal(BigInt(plan.contracts.sharedHook.address) & HOOK_MASK, HOOK_FLAGS);
  assert.equal(plan.contracts.ledger.address, getContractAddress({ from: plan.contracts.sharedHook.address, nonce: 1n }).toLowerCase());
  const args = decodeAbiParameters(plan.steps[1].constructorInputs, anyQuoteEthConstructorArguments(plan, 'host'));
  assert.equal(args.length, 8); assert.equal(args[5].toLowerCase(), plan.contracts.sharedHook.address);
  assert.equal(args[6], plan.contracts.sharedHook.runtimeCodeHash); assert.equal(args[7].toLowerCase(), plan.contracts.nativeRouteGuard.address);
  assert.deepEqual(Object.keys(anyQuoteEthSourceRequests(plan, build)), ['sharedHook', 'ledger', 'host']);
  assert.throws(() => anyQuoteEthConstructorArguments(plan, 'nativeRouteGuard'), /Only new/);
  assert.equal(plan.economics.feeAsset, zeroAddress); assert.equal(plan.economics.platformFeeBps, 30);
  assert.throws(() => assertAnyQuoteProfile(plan), /Exact Any Quote/);
});
test('native owner dispatch binds exact schema, CREATE nonce and constructor economics', async () => {
  const { plan, build } = await fixture(), profile = operatorSourceProfile(plan);
  assert.equal(profile.observeStage, observeAnyQuoteEthStage); assert.equal(profile.observeReceipt, observeAnyQuoteEthReceipt);
  const observation = { state: 'vacant-simulated', stepIndex: 1, nonce: '43', gasLimit: '100000', baseFeePerGas: '1', minimumBalance: '1000000000' };
  const ceilings = { maxGas: '100001', maxFeePerGas: '10', maxPriorityFeePerGas: '1' }, request = walletRequest(plan, observation, ceilings);
  assert.equal(Object.hasOwn(request, 'to'), false); assert.equal(request.nonce, '0x2b');
  assert.throws(() => walletRequest(plan, { ...observation, nonce: '44' }, ceilings), /nonce/);
  for (const mutate of [p => { p.identityCandidate.sourceVersion = 'module-engine-any-quote-v1'; },
    p => { p.steps[0].role = 'nativeRouteGuard'; }, p => { p.economics.feeAsset = 'per-launch-quote-asset'; }]) {
    const copy = structuredClone(plan); mutate(copy); assert.throws(() => operatorSourceProfile(copy));
  }
  for (const mutate of [p => { p.steps[1].nonce = '44'; }, p => { p.contracts.host.immutableValues.sharedHookCodeHash = h('wrong'); },
    p => { p.economics.platformFeeBps = 20; }, p => { p.basis.guardRelease.releaseDigest = p.basis.previousRelease.releaseDigest; }]) {
    const copy = structuredClone(plan); mutate(copy); await assert.rejects(assertAnyQuoteEthPlan(copy, build));
  }
});
test('native source lineage locates hook and child ledger in transaction zero, Host in transaction one', async () => {
  const { plan } = await fixture();
  const records = plan.steps.map(step => ({ status: 'included-code-verified-unfinalized', stepIndex: step.index, role: step.role,
    transaction: { hash: h(`tx-${step.index}`), from: step.sender, to: step.to, input: step.data, nonce: toHex(BigInt(step.nonce)) },
    receipt: { status: '0x1', transactionHash: h(`tx-${step.index}`), blockNumber: '0x70', transactionIndex: toHex(step.index), ...(step.to === null ? { contractAddress: step.target } : {}) },
    contracts: Object.fromEntries(step.expectedRoles.map(role => [role, plan.identityCandidate.contracts[role]])) }));
  const evidence = { schemaVersion: ANY_QUOTE_ETH_DEPLOYMENT_SCHEMA, chainId: 4663, sourceVersion: plan.identityCandidate.sourceVersion,
    sourceId: plan.sourceId, economicsPolicyId: plan.economics.economicsPolicyId, sourceCommit: plan.sourceCommit,
    planDigest: plan.planDigest, buildDigest: plan.buildDigest, status: 'included-code-verified', records };
  assert.equal(anyQuoteEthSourceCreation(plan, 'sharedHook', evidence).deployer, plan.official.deterministicDeployer.address);
  assert.equal(anyQuoteEthSourceCreation(plan, 'ledger', evidence).transactionHash, records[0].transaction.hash);
  assert.equal(anyQuoteEthSourceCreation(plan, 'ledger', evidence).deployer, plan.contracts.sharedHook.address);
  assert.equal(anyQuoteEthSourceCreation(plan, 'host', evidence).transactionHash, records[1].transaction.hash);
  const wrong = structuredClone(evidence); wrong.records.reverse(); assert.throws(() => anyQuoteEthSourceCreation(plan, 'ledger', wrong), /lineage/);
  const wrongHost = structuredClone(evidence); wrongHost.records[1].receipt.contractAddress = addr(88);
  assert.throws(() => anyQuoteEthSourceCreation(plan, 'host', wrongHost), /creation address/);
});
test('native Host receipt uses original wallet request and its own CREATE runtime only', async () => {
  const { plan } = await fixture(), step = plan.steps[1], transactionHash = h('host-tx'), blockHash = h('block');
  const request = walletRequest(plan, { state: 'vacant-simulated', stepIndex: 1, nonce: '43', gasLimit: '100000', baseFeePerGas: '1', minimumBalance: '1000000000' },
    { maxGas: '100000', maxFeePerGas: '10', maxPriorityFeePerGas: '1' });
  const entry = { request, stepIndex: 1, transactionHash };
  const providers = wrong => [0, 1].map(i => ({ providerId: `fixture-${i}`, trustDomain: `fixture-${i}.example`, rpc: async (method, args) => {
    if (method === 'eth_getTransactionByHash') return { ...request, to: null, input: request.data, hash: transactionHash, blockHash, blockNumber: '0x70' };
    if (method === 'eth_getTransactionReceipt') return { transactionHash, blockHash, blockNumber: '0x70', status: '0x1', gasUsed: '0x100', transactionIndex: '0x1', contractAddress: wrong ? addr(88) : step.target };
    if (method === 'eth_getBlockByNumber') return { hash: blockHash, transactions: [transactionHash] };
    if (method === 'eth_getCode') return Object.values(plan.contracts).find(pin => pin.address === args[0])?.runtime ?? '0x';
    throw new Error(`Unexpected receipt RPC ${method}`);
  } }));
  const observed = await observeReceipt(plan, entry, providers(false)); assert.deepEqual(Object.keys(observed.contracts), ['host']);
  await assert.rejects(observeReceipt(plan, entry, providers(true)), /different address/);
});
test('retained guard proof cannot substitute native V1 provenance or a different source closure', async () => {
  const { plan, build } = await fixture(), prior = plan.basis.guardRelease;
  const raw = Buffer.from(JSON.stringify({ schemaVersion: 'programmable.module-engine-any-quote-source-verification-evidence.v1',
    chainId: 4663, sourceVersion: prior.sourceVersion, releaseDigest: prior.releaseDigest, sourceCommit: prior.sourceCommit,
    status: 'exact-source-and-runtime-verified', records: [{ role: 'nativeRouteGuard', ...prior.contracts.nativeRouteGuard,
      sourcePaths: Object.keys(build.standardInputs.nativeRouteGuard.sources), creationTransactionHash: h('synthetic-guard-creation') }] }));
  prior.sourceVerificationDigest = evidenceDigest(raw);
  const reuse = anyQuoteEthGuardSourceReuse(plan, build, raw);
  assert.equal(reuse.reuse.previousReleaseDigest, prior.releaseDigest); assert.notEqual(reuse.reuse.previousReleaseDigest, plan.basis.previousRelease.releaseDigest);
  assert.equal(reuse.originalSourceCommit, prior.sourceCommit); assert.equal(reuse.reuse.newCreationTransaction, false);
  assert.throws(() => anyQuoteEthGuardSourceReuse(plan, build, Buffer.concat([raw, Buffer.from('\n')])), /byte-bound/);
  const wrong = structuredClone(build); wrong.standardInputs.nativeRouteGuard.sources = { 'src/another.sol': { content: 'wrong' } };
  assert.throws(() => anyQuoteEthGuardSourceReuse(plan, wrong, raw), /closure/);
});
test('native lifecycle references reject legacy quote claims and preserve both ETH beneficiaries', async () => {
  const { plan } = await fixture(), candidate = { ...plan.identityCandidate, startBlock: '123' };
  const release = { ...candidate, releaseDigest: (await engineWire()).computeModuleEngineReleaseDigest(candidate) };
  const canary = { launchId: h('launch'), launchTransactionHash: h('launch-tx'), manifestHash: h('manifest'), operations: [
    { kind: 'native-fee-pool-swap', transactionHash: h('buy'), logIndex: 4, poolId: h('pool'), buy: true },
    { kind: 'native-fee-pool-swap', transactionHash: h('sell'), logIndex: 7, poolId: h('pool'), buy: false },
    { kind: 'native-eth-claim', transactionHash: h('creator-claim'), logIndex: 2, beneficiary: addr(90), recipient: addr(90) },
    { kind: 'native-eth-claim', transactionHash: h('platform-claim'), logIndex: 2, beneficiary: plan.economics.platformRecipient, recipient: plan.economics.platformRecipient },
  ] };
  assert.deepEqual((await createEngineLifecyclePlan(release, [canary])).canaries[0], canary);
  for (const mutate of [v => { v.operations[2].kind = 'quote-claim'; }, v => { v.operations[2].asset = addr(98); },
    v => { v.operations[3].transactionHash = v.operations[2].transactionHash; }, v => { v.operations[0].buy = 1; }]) {
    const changed = structuredClone(canary); mutate(changed); await assert.rejects(createEngineLifecyclePlan(release, [changed]));
  }
});
test('native operator continuation keeps both historical sources and all deployment bytes', async () => {
  const { plan, build, basis, parameters } = await fixture(), nextBasis = structuredClone(basis), sourceCommit = 'c'.repeat(40);
  nextBasis.provenance.sourceCommit = sourceCommit; const body = { ...nextBasis }; delete body.basisDigest;
  nextBasis.basisDigest = digest(nextBasis.schemaVersion, body);
  const current = await buildAnyQuoteEthPlan({ ...build, sourceCommit, sourceTree: 'd'.repeat(40), buildDigest: h('operator-only-build') }, parameters, nextBasis);
  assert.equal(assertContinuationPlan(plan, current), plan);
  current.basis.guardRelease.sourceCommit = 'e'.repeat(40);
  const changedBasis = { ...current.basis }; delete changedBasis.basisDigest; current.basis.basisDigest = digest(current.basis.schemaVersion, changedBasis);
  const changed = { ...current }; delete changed.planDigest; current.planDigest = digest(current.schemaVersion, changed);
  assert.throws(() => assertContinuationPlan(plan, current), /Continuation/);
});

function nativeWalletFixture(kind) {
  // Wire-only objects; these do not satisfy the deployment/admission authority gate.
  const owner = addr(80), token = addr(81), recipient = addr(82), host = addr(83), ledger = addr(84);
  const identity = { sourceVersion: 'module-engine-any-quote-eth-v1', releaseDigest: h('release'), contracts: { host: { address: host }, ledger: { address: ledger } } };
  const bundle = { manifest: { manifest: { catalogDefinition: { id: 'wire-only' } } }, review: { command: { hostManifestHash: h('manifest') }, decisionDigest: h('review') } };
  const template = { status: 'available', manifest: bundle.manifest, manifestHash: h('manifest'), reviewDigest: h('review') };
  const intent = kind === 'claim' ? { token, recipient } : { releaseDigest: identity.releaseDigest, templateId: 'wire-only', account: owner,
    name: 'Wire', symbol: 'WIRE', description: '', imageUri: '', socialLinks: {}, initialBuyWei: '100', slippageBps: 100 };
  const to = kind === 'claim' ? ledger : host, value = kind === 'claim' ? '0' : intent.initialBuyWei;
  const step = { kind: `any-quote-${kind}`, intent, to, value, target: token };
  const plan = { schemaVersion: ENGINE_LIFECYCLE_OPERATOR_SCHEMA, owner, identity, bundle, steps: [step] };
  let recipe;
  if (kind === 'claim') recipe = { kind, template, account: owner, token, recipient };
  else {
    const { releaseDigest, initialBuyWei, slippageBps, ...input } = intent;
    const { description, imageUri, socialLinks, ...priceIntent } = intent;
    recipe = { kind, template, input: { ...input, anyQuotePreparation: { intent: priceIntent, predictedToken: token } } };
  }
  const prepared = { kind, account: owner, releaseDigest: identity.releaseDigest, token, recipient, minimumAmount: '10', expiresAt: '2000000000',
    transaction: { from: owner, to, value, data: kind === 'claim'
      ? encodeFunctionData({ abi: parseAbi(['function claimEthTo(address recipient) returns (uint256)']), functionName: 'claimEthTo', args: [recipient] }) : '0x1234' } };
  return { plan, envelope: { schemaVersion: 'programmable.any-quote.lifecycle-preparation.v1', identity, recipe, prepared } };
}
test('native claim handoff accepts only the exact ETH selector and payout recipient', () => {
  const { plan, envelope } = nativeWalletFixture('claim'); anyQuoteWalletStep(plan, 0, envelope);
  for (const data of [encodeFunctionData({ abi: parseAbi(['function claimQuoteTo(address asset,address recipient) returns (uint256)']),
    functionName: 'claimQuoteTo', args: [addr(88), envelope.prepared.recipient] }),
  encodeFunctionData({ abi: parseAbi(['function claimEthTo(address recipient) returns (uint256)']), functionName: 'claimEthTo', args: [addr(89)] })]) {
    const changed = structuredClone(envelope); changed.prepared.transaction.data = data;
    assert.throws(() => anyQuoteWalletStep(plan, 0, changed), /exact ETH beneficiary/);
  }
});
test('native launch handoff retains the positive initial purchase and exact ETH value', () => {
  const { plan, envelope } = nativeWalletFixture('launch'); anyQuoteWalletStep(plan, 0, envelope);
  const wrongValue = structuredClone(envelope); wrongValue.prepared.transaction.value = '101';
  assert.throws(() => anyQuoteWalletStep(plan, 0, wrongValue), /target\/value/);
  const empty = nativeWalletFixture('launch'); empty.plan.steps[0].intent.initialBuyWei = '0'; empty.envelope.recipe.input.anyQuotePreparation.intent.initialBuyWei = '0';
  assert.throws(() => anyQuoteWalletStep(empty.plan, 0, empty.envelope), /bootstrap intent/);
});
