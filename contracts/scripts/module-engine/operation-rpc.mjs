import { createPublicClient, custom, decodeEventLog, decodeFunctionResult, encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, keccak256, parseAbi, parseAbiParameters, toHex } from 'viem';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { address, bytes, digest, exactKeys, hash, jsonSafe, need, sha256, uint } from '../module-mode/core.mjs';
import { REPOSITORY_ROOT } from '../module-mode/build.mjs';
import { exactJson } from '../module-mode/source-readback.mjs';
import { publicationValidators } from '../module-mode/publication-shared.mjs';
import { ZERO_ADDRESS, registryAbi } from '../module-mode/publication-plan.mjs';
import { ENGINE_PUBLICATION_OPERATOR_SCHEMA, equal, equalEngineLaunchPlan } from './publication-plan.mjs';
import { assertEnginePermission, bindAnyQuotePreactivationPacket, isAnyQuoteLifecyclePlan } from './lifecycle-operator-plan.mjs';
import { observeAnyQuoteReceipt } from './any-quote-rpc.mjs';
import { collectAnyQuoteSource } from './any-quote-evidence.mjs';
import { observeAnyQuoteEthReceipt } from './any-quote-eth-rpc.mjs';
import { collectAnyQuoteEthSource } from './any-quote-eth-evidence.mjs';
import { bindAnyQuoteEthGuardSourceClosure } from './any-quote-eth-build.mjs';
import { ANY_QUOTE_ETH_REUSE_DOMAIN } from './any-quote-eth-core.mjs';
import { bindReusedSourceClosure } from '../module-native-v2/build.mjs';
const ZERO_HASH = `0x${'0'.repeat(64)}`;
const optionalAddress = v => v.toLowerCase() === ZERO_ADDRESS ? ZERO_ADDRESS : address(v);
const qty = v => BigInt(v);
function launchShape(raw) {
  const out = {};
  for (const key of ['launchId', 'revisionId', 'engineCodeHash', 'constructorHash', 'initCodeHash', 'configurationHash', 'planHash', 'resourcesHash']) out[key] = hash(raw[key], key);
  for (const key of ['creator', 'token', 'quoteAsset', 'engine']) out[key] = address(raw[key], key);
  for (const key of ['buyCreatorFeeBps', 'sellCreatorFeeBps']) { need(Number.isInteger(raw[key]) && raw[key] >= 0 && raw[key] <= 1000, 'Invalid creator fee'); out[key] = raw[key]; }
  return out;
}
async function releaseBindings(plan, providers, block, c, api) {
  const pins = plan.identity.contracts, host = pins.host.address, ledger = pins.ledger.address;
  need(c.quantity(block) >= BigInt(plan.identity.startBlock), 'Engine release start block not reached');
  const read = (to, name, args = [], abi = api.moduleEngineReadAbi) => c.read(providers, to, abi, name, args, block);
  equal(await read(host, 'SOURCE_VERSION', [], api.moduleEngineHostAbi), api.moduleEngineSourceId(plan.identity), 'Engine source version');
  for (const name of ['registry', 'ledger', 'tokenFactory', 'launchPolicy']) equal(address(await read(host, name, [], api.moduleEngineHostAbi)), pins[name].address, `Engine ${name}`);
  if (api.isModuleEngineSharedQuoteRelease(plan.identity)) {
    need(plan.schemaVersion === ENGINE_PUBLICATION_OPERATOR_SCHEMA || isAnyQuoteLifecyclePlan(plan), 'Closed Any Quote operator profile required');
    const nativeFees = api.isModuleEngineAnyQuoteEthRelease(plan.identity);
    const hostAbi = nativeFees ? api.moduleEngineAnyQuoteEthHostAbi : api.moduleEngineAnyQuoteHostAbi;
    const hookAbi = nativeFees ? api.moduleEngineAnyQuoteEthHookAbi : api.moduleEngineAnyQuoteHookAbi;
    const ledgerAbi = nativeFees ? api.moduleEngineAnyQuoteEthLedgerAbi : api.moduleEngineAnyQuoteLedgerAbi;
    for (const [name, expected] of [['sharedHook', pins.sharedHook.address], ['nativeRouteGuard', pins.nativeRouteGuard.address],
      ['NATIVE_ROUTE_GUARD_CODE_HASH', pins.nativeRouteGuard.runtimeCodeHash], ['quotePoolManager', pins.poolManager.address],
      ['quotePoolManagerCodeHash', pins.poolManager.runtimeCodeHash], ['UNIVERSAL_ROUTER', pins.universalRouter.address],
      ['UNIVERSAL_ROUTER_CODE_HASH', pins.universalRouter.runtimeCodeHash], ['quoteFeeProfileId', nativeFees ? api.MODULE_ENGINE_ANY_QUOTE_ETH_PROFILE_ID : api.MODULE_ENGINE_ANY_QUOTE_PROFILE_ID],
      ...(nativeFees ? [['sharedHookCodeHash', pins.sharedHook.runtimeCodeHash]] : [])])
      equal((await read(host, name, [], hostAbi)).toLowerCase(), expected, `Any Quote Host ${name}`);
    for (const [name, role] of [['host', 'host'], ['ledger', 'ledger'], ['poolManager', 'poolManager']])
      equal(address(await read(pins.sharedHook.address, name, [], hookAbi)), pins[role].address, `Any Quote hook ${name}`);
    for (const [name, role] of [['host', 'host'], ['hook', 'sharedHook'], ['poolManager', 'poolManager']])
      equal(address(await read(ledger, name, [], ledgerAbi)), pins[role].address, `Any Quote ledger ${name}`);
    equal(await read(ledger, 'ECONOMICS_POLICY_ID', [], ledgerAbi), plan.identity.economicsPolicyId, 'Any Quote economics policy');
    if (nativeFees) equal(await read(pins.sharedHook.address, 'NATIVE_FEE_MAX_LOSS_BPS', [], hookAbi), 500n, 'Fixed native fee conversion bound');
  } else {
    for (const [name, role] of [['hook', 'host'], ['registry', 'registry'], ['poolManager', 'poolManager']]) equal(address(await read(ledger, name)), pins[role].address, `Engine ledger ${name}`);
    equal(await read(ledger, 'ECONOMICS_POLICY_ID'), plan.identity.economicsPolicyId, 'Engine economics policy');
    need(await read(ledger, 'PROTOCOL_FEE_BPS') === 10 && await read(ledger, 'AUTHOR_POOL_FEE_BPS') === 20, 'Engine fee policy constants differ');
  }
  const owner = address(await read(pins.registry.address, 'owner'));
  if (plan.schemaVersion === ENGINE_PUBLICATION_OPERATOR_SCHEMA) need(owner === plan.owner, 'Current Registry EOA owner differs');
}
async function revisionBindings(plan, providers, block, c, api, absent = false, historical = false) {
  const m = plan.bundle.manifest.manifest, host = plan.identity.contracts.host.address, engine = m.source.engine;
  const result = await c.read(providers, host, api.moduleEngineHostAbi, 'getRevision', [m.revision.packageId], block);
  need(Array.isArray(result) && result.length === 4, 'Invalid Engine revision getter');
  const expected = api.engineRegistryRevision({ manifest: plan.bundle.manifest, manifestHash: api.computeModuleEngineHostManifestHash(plan.bundle.manifest) });
  if (absent) {
    need(result[0].creationCodeHash === ZERO_HASH && result[0].manifestHash === ZERO_HASH && result[0].enabled === false && result.slice(1).every(v => v.length === 0), 'Engine revision already exists; immutable admission cannot be retried as new');
    return;
  }
  const r = { ...result[0], fixedQuoteAsset: optionalAddress(result[0].fixedQuoteAsset) };
  // Disabled revisions still govern already-launched coins; only new launches require enabled=true.
  if (historical || plan.action?.kind === 'execute') expected.enabled = r.enabled;
  equal(r, expected, 'Immutable Engine revision'); equal(result[1], engine.immutableRuntimeOffsets, 'Engine runtime immutable offsets');
  equal(result[2], engine.immutableConstructorOffsets, 'Engine constructor offsets'); equal(result[3], m.revision.eligibleFamilies, 'Engine fee families');
  for (const permission of m.revision.operationPermissions) equal(await c.read(providers, host, api.moduleEngineHostAbi, 'permission', [m.revision.packageId, permission.operationId], block), permission, 'Actual Engine operation permission');
}
async function familyBindings(plan, providers, block, c, api) {
  const m = plan.bundle.manifest.manifest, source = plan.bundle.source.descriptor;
  const family = await c.read(providers, plan.identity.contracts.registry.address, api.moduleEngineReadAbi, 'families', [m.revision.familyId], block);
  equal(family.map(address => optionalAddress(address)), [address(source.author), address(source.rewardWallet)], 'Engine family author and reward');
  for (const id of m.revision.eligibleFamilies) {
    const family = await c.read(providers, plan.identity.contracts.registry.address, api.moduleEngineReadAbi, 'families', [id], block); family.forEach(v => address(v));
  }
}
function launchStep(plan) { return plan.steps.find(s => s.kind === 'engine-launch'); }
function launchContext(plan, expected) { return { host: plan.identity.contracts.host.address, launchId: expected.launchId, token: expected.token, creator: expected.creator, quoteAsset: expected.quoteAsset, feeCollector: plan.identity.contracts.host.address }; }
function tokenGraffiti(plan, creator, creatorSalt, api) {
  const domain = api.isModuleEngineSharedQuoteRelease(plan.identity) ? 'programmable.module-engine.any-quote-token.v1' : 'programmable.module-engine.token.v1';
  return keccak256(encodeAbiParameters(parseAbiParameters('string,address,bytes32'), [domain, creator, creatorSalt]));
}
async function boundLaunch(plan, step, providers, block, c, api) {
  const pins = plan.identity.contracts, host = pins.host.address, expected = step.expectation;
  const actual = launchShape(await c.read(providers, host, api.moduleEngineHostAbi, 'getLaunch', [expected.launchId], block));
  for (const [key, value] of Object.entries(expected)) equal(actual[key], value, `Engine launch ${key}`);
  equal(await c.read(providers, host, api.moduleEngineHostAbi, 'launchIdOf', [expected.token], block), expected.launchId, 'Token launch registration');
  equal(await c.read(providers, host, api.moduleEngineHostAbi, 'engineLaunchId', [expected.engine], block), expected.launchId, 'Engine launch registration');
  await c.code(providers, { address: expected.engine, runtimeCodeHash: expected.engineCodeHash }, block);
  const tokenRuntime = bytes(c.same(await c.pair(providers, 'eth_getCode', [expected.token, block]), 'Engine token runtime')); need(tokenRuntime !== '0x', 'Engine token runtime missing');
  const parameters = launchStep(plan.action.kind === 'launch' ? plan : plan.action.launch.plan).arguments[0];
  for (const [name, expectedValue] of [['name', parameters.name], ['symbol', parameters.symbol], ['decimals', 18], ['totalSupply', 1000000000n * 10n ** 18n]])
    equal(await c.read(providers, expected.token, api.moduleEngineReadAbi, name, [], block), expectedValue, `Engine token ${name}`);
  equal(address(await c.read(providers, expected.token, api.moduleEngineReadAbi, 'creator', [], block)), host, 'Engine token creator');
  const graffiti = tokenGraffiti(plan, expected.creator, parameters.creatorSalt, api);
  equal(await c.read(providers, expected.token, api.moduleEngineReadAbi, 'graffiti', [], block), graffiti, 'Engine token graffiti');
  equal(address(await c.read(providers, pins.tokenFactory.address, api.moduleEngineReadAbi, 'getUERC20Address', [parameters.name, parameters.symbol, 18, host, graffiti], block)), expected.token, 'Factory token identity');
  equal(await c.read(providers, expected.engine, api.moduleEngineReadAbi, 'contextHash', [], block), keccak256(encodeAbiParameters(parseAbiParameters(api.ENGINE_CONTEXT), [launchContext(plan, expected)])), 'Engine instance context');
  const platform = plan.bundle.manifest.manifest.revision.eligibleFamilies.length ? 30 : 10;
  equal(await c.read(providers, pins.ledger.address, api.moduleEngineReadAbi, 'platformFeeBps', [expected.launchId], block), platform, 'Launch-bound platform fee');
  const creators = await c.read(providers, pins.ledger.address, api.moduleEngineLedgerAbi, 'creatorRecipients', [expected.launchId], block);
  equal(creators[0].map(address), parameters.creatorWallets, 'Launch creator recipients'); equal(creators[1], parameters.creatorSharesBps, 'Launch creator shares');
  for (const buy of [true, false]) equal(await c.read(providers, host, api.moduleEngineHostAbi, 'feeTerms', [expected.launchId, buy], block), [platform, buy ? parameters.buyCreatorFeeBps : parameters.sellCreatorFeeBps], 'Engine fee terms');
  equal(await c.read(providers, host, api.moduleEngineHostAbi, 'fixedConfigurationHash', [expected.launchId], block), plan.bundle.manifest.manifest.revision.fixedConfigurationHash, 'Host fixed configuration admission');
  return { actual, tokenRuntimeCodeHash: keccak256(tokenRuntime) };
}
async function nonceAndFunding(plan, step, providers, block, c, api, approvalStep) {
  const op = step.operation, host = plan.identity.contracts.host.address;
  if (op.operationId === ZERO_HASH) return;
  assertEnginePermission(plan.bundle.manifest.manifest.revision, step.expectation, op, plan.owner);
  equal(await c.read(providers, host, api.moduleEngineHostAbi, 'nonces', [step.expectation.launchId, plan.owner], block), qty(op.nonce), 'Engine actor nonce');
  if (op.inputAsset !== ZERO_ADDRESS && BigInt(op.inputAmount) > 0n) {
    need(BigInt(await c.read(providers, op.inputAsset, erc20Abi, 'balanceOf', [plan.owner], block)) >= BigInt(op.inputAmount), 'Insufficient balance in the exact Engine input asset');
    if (!approvalStep) equal(await c.read(providers, op.inputAsset, erc20Abi, 'allowance', [plan.owner, host], block), BigInt(op.inputAmount), 'Exact Host allowance');
  }
}
export async function assertEngineOperationPreflight(plan, stepIndex, providers, block, c) {
  const api = await publicationValidators(), step = plan.steps[stepIndex]; await releaseBindings(plan, providers, block.number, c, api);
  // A reset's zero allowance is superseded by the later exact approval. The original
  // server still verifies each predecessor's receipt at its own canonical inclusion block.
  const latestPostReads = new Map();
  for (const previous of plan.steps.slice(0, stepIndex)) for (const read of previous.postReads) latestPostReads.set(`${read.to}:${read.data}`, read);
  await c.readConditions(providers, [...latestPostReads.values()], block.number);
  await c.readConditions(providers, step.preReads, block.number);
  if (plan.schemaVersion === ENGINE_PUBLICATION_OPERATOR_SCHEMA) {
    await revisionBindings(plan, providers, block.number, c, api, true);
    if (step.kind === 'engine-revision') await familyBindings(plan, providers, block.number, c, api);
    return;
  }
  if (isAnyQuoteLifecyclePlan(plan)) {
    await assertAnyQuotePacketAnchors(plan, providers, c);
    await revisionBindings(plan, providers, block.number, c, api, false, plan.action.kind !== 'launch');
    await familyBindings(plan, providers, block.number, c, api);
    return;
  }
  const launching = plan.action.kind === 'launch', quote = launching ? plan.action.quote : plan.action.launch.plan.action.quote;
  await c.code(providers, quote, block.number);
  equal(await c.read(providers, quote.address, erc20Abi, 'decimals', [], block.number), quote.decimals, 'Actual quote asset decimals');
  await revisionBindings(plan, providers, block.number, c, api);
  if (launching) {
    const p = launchStep(plan).arguments[0], expected = step.expectation;
    const graffiti = tokenGraffiti(plan, plan.owner, p.creatorSalt, api);
    const prediction = await c.read(providers, plan.identity.contracts.host.address, api.moduleEngineHostAbi, 'predictTokenAddress', [p.name, p.symbol, plan.owner, p.creatorSalt], block.number);
    equal([address(prediction[0]), prediction[1]], [expected.token, graffiti], 'Actual Host token prediction');
    for (const target of [expected.token, expected.engine]) {
      need(c.same(await c.pair(providers, 'eth_getCode', [target, block.number]), 'Engine target vacancy') === '0x', 'Engine target is already deployed; reconcile its receipt');
      need(c.quantity(c.same(await c.pair(providers, 'eth_getTransactionCount', [target, block.number]), 'Engine target nonce')) === 0n, 'Engine CREATE2 target has a nonzero nonce');
    }
    await familyBindings(plan, providers, block.number, c, api);
  } else {
    const reference = plan.action.launch;
    const original = await c.observeReceipt(reference.plan, reference.entry, providers);
    equal(original, reference.evidence, 'Canonical original Engine launch evidence');
    const live = await boundLaunch(plan, step, providers, block.number, c, api);
    equal(live.actual, reference.evidence.canary, 'Existing Engine launch identity');
  }
  await nonceAndFunding(plan, step, providers, block.number, c, api, step.kind === 'engine-approve');
}
export async function bindEngineSimulation(plan, step, simulation) {
  const api = await publicationValidators();
  if (step.kind === 'engine-family') {
    equal(decodeFunctionResult({ abi: registryAbi, functionName: 'registerReviewedFamily', data: simulation }), plan.bundle.manifest.manifest.revision.familyId, 'Simulated Engine family'); return null;
  }
  if (step.kind === 'engine-revision') { need(simulation === '0x', 'Engine admission returned unexpected data'); return null; }
  if (step.kind === 'engine-approve') { need(simulation === '0x' || decodeFunctionResult({ abi: erc20Abi, functionName: 'approve', data: simulation }) === true, 'Token rejected exact Host approval'); return null; }
  if (step.kind === 'engine-launch') {
    const result = launchShape(decodeFunctionResult({ abi: api.moduleEngineHostAbi, functionName: 'launch', data: simulation }));
    for (const [key, value] of Object.entries(step.expectation)) equal(result[key], value, `Simulated Engine ${key}`); return result;
  }
  need(step.kind === 'engine-execute', 'Unsupported engine simulation profile');
  const result = bytes(decodeFunctionResult({ abi: api.moduleEngineHostAbi, functionName: 'execute', data: simulation })); need(result.length <= 65536 * 2 + 2, 'Engine result exceeds bounds'); return { result, resultHash: keccak256(result) };
}
function events(receipt, target, name, abi) {
  return receipt.logs.filter(l => l.address === target).flatMap(log => {
    let parsed; try { parsed = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true }); } catch { return []; }
    if (parsed.eventName !== name) return [];
    need(!log.removed && log.transactionHash === receipt.transactionHash && log.blockHash === receipt.blockHash && log.blockNumber === receipt.blockNumber, 'Engine event inclusion differs');
    equal(encodeEventTopics({ abi, eventName: name, args: parsed.args }), log.topics, 'Canonical Engine event topics');
    const fields = abi.find(item => item.type === 'event' && item.name === name).inputs.filter(i => !i.indexed);
    equal(encodeAbiParameters(fields, fields.map(f => parsed.args[f.name])), log.data, 'Canonical Engine event payload'); return [parsed.args];
  });
}
function one(receipt, target, name, abi) { const found = events(receipt, target, name, abi); need(found.length === 1, `Expected exactly one ${name} event`); return found[0]; }
async function operationReceipt(plan, step, receipt, providers, c, api) {
  const op = step.operation, host = plan.identity.contracts.host.address;
  if (op.operationId === ZERO_HASH) { need(events(receipt, host, 'EngineOperationExecuted', api.moduleEngineHostAbi).length === 0, 'Unexpected Engine initial operation'); return null; }
  const event = one(receipt, host, 'EngineOperationExecuted', api.moduleEngineHostAbi);
  for (const [key, expected] of Object.entries({ launchId: step.expectation.launchId, operationId: op.operationId, actor: plan.owner, recipient: op.recipient,
    nonce: BigInt(op.nonce), inputAsset: op.inputAsset, inputAmount: BigInt(op.inputAmount), outputAsset: op.outputAsset })) equal(typeof event[key] === 'string' ? event[key].toLowerCase() : event[key], expected, `Engine operation ${key}`);
  need(event.outputAmount >= BigInt(op.minimumOutput), 'Engine output is below the reviewed minimum');
  // Approved engines can return market/state-dependent bytes. The canonical Host event
  // attests the actual result; the signed output floor, assets and funding are the limits.
  hash(event.resultHash, 'Actual Engine result hash');
  equal(await c.read(providers, host, api.moduleEngineHostAbi, 'nonces', [step.expectation.launchId, plan.owner], receipt.blockNumber), BigInt(op.nonce) + 1n, 'Consumed Engine actor nonce');
  if (op.inputAsset !== ZERO_ADDRESS && BigInt(op.inputAmount) > 0n) equal(await c.read(providers, op.inputAsset, erc20Abi, 'allowance', [plan.owner, host], receipt.blockNumber), 0n, 'Consumed exact Engine allowance');
  return jsonSafe(event);
}
export async function finishEngineReceipt(plan, entry, providers, receipt, transaction, pins, c) {
  const api = await publicationValidators(), step = plan.steps[entry.stepIndex], host = plan.identity.contracts.host.address;
  await releaseBindings(plan, providers, receipt.blockNumber, c, api); let canary = null, operation = null, tokenRuntimeCodeHash = null;
  if (isAnyQuoteLifecyclePlan(plan)) {
    await revisionBindings(plan, providers, receipt.blockNumber, c, api, false, true);
    const preparation = entry.observation.anyQuote; anyQuoteWalletStep(plan, entry.stepIndex, preparation);
    const client = anyQuoteClient(providers, c, { number: receipt.blockNumber });
    const actualReceipt = await client.getTransactionReceipt({ hash: receipt.transactionHash });
    equal(actualReceipt.blockHash, receipt.blockHash, 'Any Quote receipt anchor');
    const result = await api.verifyAnyQuoteLifecycleReceiptV1({ client, identity: plan.identity, preparation, receipt: actualReceipt });
    need((await c.pair(providers, 'eth_getBlockByNumber', [receipt.blockNumber, false])).every(b => b?.hash === receipt.blockHash), 'Any Quote receipt anchor changed');
    return { status: 'included-code-verified-unfinalized', sourceKind: 'module-engine-v1', chainId: 4663, planDigest: plan.planDigest,
      releaseDigest: plan.identity.releaseDigest, stepIndex: entry.stepIndex, kind: step.kind, transaction, receipt, contracts: pins,
      anyQuote: result, providers: c.publicBindings(providers) };
  }
  if (plan.schemaVersion === ENGINE_PUBLICATION_OPERATOR_SCHEMA) {
    await familyBindings(plan, providers, receipt.blockNumber, c, api);
    if (step.kind === 'engine-revision') {
      await revisionBindings(plan, providers, receipt.blockNumber, c, api, false, true);
      const event = one(receipt, host, 'EngineRevisionApproved', api.moduleEngineHostAbi), m = plan.bundle.manifest.manifest;
      equal(event.revisionId, m.revision.packageId, 'Admitted Engine revision'); equal(event.familyId, m.revision.familyId, 'Admitted Engine family');
      const expected = api.engineRegistryRevision({ manifest: plan.bundle.manifest, manifestHash: api.computeModuleEngineHostManifestHash(plan.bundle.manifest) });
      equal({ ...event.revision, fixedQuoteAsset: optionalAddress(event.revision.fixedQuoteAsset) }, expected, 'Exact Engine revision event');
    }
  } else if (step.kind !== 'engine-approve') {
    await revisionBindings(plan, providers, receipt.blockNumber, c, api, false, true);
    ({ actual: canary, tokenRuntimeCodeHash } = await boundLaunch(plan, step, providers, receipt.blockNumber, c, api));
    if (step.kind === 'engine-launch') {
      equalEngineLaunchPlan(canary, entry.observation.simulatedResult, 'Actual/simulated Engine launch');
      const event = one(receipt, host, 'EngineLaunchBound', api.moduleEngineHostAbi);
      for (const [key, value] of Object.entries({ ...step.expectation, runtimeCodeHash: step.expectation.engineCodeHash, resourcesHash: canary.resourcesHash, economicsPolicyId: plan.identity.economicsPolicyId }).filter(([key]) => !['engineCodeHash', 'buyCreatorFeeBps', 'sellCreatorFeeBps'].includes(key))) equal(typeof event[key] === 'string' ? event[key].toLowerCase() : event[key], value, `Engine launch event ${key}`);
      const parameters = one(receipt, host, 'EngineLaunchParametersBound', api.moduleEngineHostAbi);
      equal(parameters.launchId, canary.launchId, 'Engine parameter launch'); equal(parameters.encodedParameters, encodeAbiParameters(api.moduleEngineLaunchParameters, [step.arguments[0]]), 'Exact Engine launch parameters');
    } else equal(canary, plan.action.launch.evidence.canary, 'Executed Engine launch identity');
    operation = await operationReceipt(plan, step, receipt, providers, c, api);
  } else {
    // Receipt uses the same bounded asset/runtime/allowance. It never grants launch membership to an approval.
    const quote = plan.action.kind === 'launch' ? plan.action.quote : plan.action.launch.plan.action.quote;
    await c.code(providers, quote, receipt.blockNumber);
    if (step.to === step.expectation.token) ({ tokenRuntimeCodeHash } = await boundLaunch(plan, step, providers, receipt.blockNumber, c, api));
  }
  need((await c.pair(providers, 'eth_getBlockByNumber', [receipt.blockNumber, false])).every(b => b?.hash === receipt.blockHash), 'Engine receipt anchor changed during verification');
  return { status: 'included-code-verified-unfinalized', sourceKind: 'module-engine-v1', chainId: 4663, planDigest: plan.planDigest, releaseDigest: plan.identity.releaseDigest,
    stepIndex: entry.stepIndex, kind: step.kind, transaction, receipt, contracts: pins, canary, operation, tokenRuntimeCodeHash, providers: c.publicBindings(providers) };
}

export function equalEngineSimulation(plan, stepIndex, actual, expected) {
  if (plan.steps[stepIndex].kind === 'engine-launch') equalEngineLaunchPlan(actual, expected, 'Engine revalidation launch plan');
  else if (plan.steps[stepIndex].kind !== 'engine-execute') equal(actual, expected, 'Engine revalidation result');
  // execute was freshly simulated by the pinned Host with the unchanged signed
  // input/recipient/minimumOutput/deadline. Its returned bytes are not a limit.
}

const checkedPackets = new Map();
const exec = promisify(execFile);
/** Rebind the original seal to Git objects without recompiling or trusting sourceClean alone. */
async function sourceObjects(build) {
  const c = build.commitments;
  need(c?.sourceCommit === build.sourceCommit && c.sourceTree === build.sourceTree
    && c.compiler === '0.8.26+commit.8a97fa7a' && c.forge === '1.7.1+4072e48705af9d93e3c0f6e29e93b5e9a40caed8'
    && digest('programmable.module-mode-build.v1', c) === build.buildDigest, 'Exact deployment compiler/source seal differs');
  const gitObject = async (root, revision, file) => (await exec('git', ['show', `${revision}:${file}`], { cwd: root, maxBuffer: 8 * 1024 * 1024 })).stdout;
  const tree = (await exec('git', ['rev-parse', `${build.sourceCommit}^{tree}`], { cwd: REPOSITORY_ROOT })).stdout.trim();
  need(tree === build.sourceTree, 'Deployment source tree differs');
  const pinBytes = await gitObject(REPOSITORY_ROOT, build.sourceCommit, 'contracts/dependencies/source-pins.json');
  need(sha256(pinBytes) === c.sourcePinsDigest, 'Deployment dependency pins differ');
  const sourcePins = JSON.parse(pinBytes), seen = new Set();
  for (const [role, input] of Object.entries(build.standardInputs)) {
    need(digest('programmable.module-mode-build-artifact.v1', build.artifacts[role]) === c.artifacts[role], 'Deployment artifact seal differs');
    need(input.settings?.optimizer?.enabled === true && input.settings.optimizer.runs === 1000 && !input.settings.viaIR
      && input.settings.evmVersion === 'cancun' && input.settings.metadata?.appendCBOR === false && input.settings.metadata.bytecodeHash === 'none'
      && Object.keys(input.settings.libraries ?? {}).length === 0, 'Protected foundation compiler settings differ');
    exactKeys(input.settings.optimizer, ['enabled', 'runs'], 'Protected foundation optimizer');
    for (const [file, source] of Object.entries(input.sources)) {
      need(/^(?:src|lib\/[a-z0-9-]+)\/[A-Za-z0-9_./-]+\.sol$/.test(file) && !file.split('/').includes('..'), 'Invalid source seal path');
      need(keccak256(toHex(source.content)) === c.sources[file], 'Compiled source seal differs');
      if (seen.has(file)) continue; seen.add(file);
      let root = REPOSITORY_ROOT, commit = build.sourceCommit, relative = `contracts/${file}`;
      if (file.startsWith('lib/')) {
        const [, dependency, ...tail] = file.split('/'), pin = c.dependencies[dependency];
        need(pin && sourcePins.dependencies.some(item => item.commit === pin.commit && item.repository === pin.repository), 'Unpinned source dependency');
        root = await realpath(path.join(REPOSITORY_ROOT, 'contracts/lib', dependency)); commit = pin.commit; relative = tail.join('/');
      }
      need(keccak256(toHex(await gitObject(root, commit, relative))) === c.sources[file], 'Compiled source does not match its Git object');
    }
  }
  equal([...seen].sort(), Object.keys(c.sources).sort(), 'Complete compiled source closure');
}
/** Session initialization is expensive and precedes route readiness. The cache is process-local, never packet authority. */
export async function initializeAnyQuoteLifecycle(plan, providers, c) {
  if (!isAnyQuoteLifecyclePlan(plan)) return;
  const bindings = await bindAnyQuotePreactivationPacket(plan.preactivation, plan.identity, plan.bundle);
  equal(bindings, plan.proofBindings, 'Any Quote proof packet commitments');
  const key = digest('programmable.any-quote.operator-session.v1', { sourceCommit: plan.sourceCommit, planDigest: plan.planDigest, identity: plan.identity, bindings, providers: c.publicBindings(providers) });
  if (checkedPackets.has(key)) { await checkedPackets.get(key); return; }
  const validation = (async () => {
    const packet = plan.preactivation, deployment = exactJson(Buffer.from(packet.deploymentEvidenceRaw), 'Actual deployment evidence');
    await sourceObjects(packet.build);
    if (plan.identity.sourceVersion === 'module-engine-any-quote-eth-v1') {
      const retained = await bindReusedSourceClosure(packet.build, REPOSITORY_ROOT, { roles: ['registry', 'tokenFactory', 'launchPolicy'],
        domain: ANY_QUOTE_ETH_REUSE_DOMAIN, previousRelease: packet.deploymentPlan.basis.previousRelease });
      const guard = await bindAnyQuoteEthGuardSourceClosure(retained, REPOSITORY_ROOT, packet.deploymentPlan.basis.guardRelease);
      equal(guard.reuseSourceDigest, packet.build.reuseSourceDigest, 'Retained native V1 source closure');
      equal(guard.guardSourceDigest, packet.build.guardSourceDigest, 'Retained Any Quote guard source closure');
    }
    for (let i = 0; i < 2; i++) {
      const observe = plan.identity.sourceVersion === 'module-engine-any-quote-eth-v1' ? observeAnyQuoteEthReceipt : observeAnyQuoteReceipt;
      const { engineBindings, ...observed } = await observe(packet.deploymentPlan, packet.deploymentEntries[i], providers);
      equal(observed, deployment.records[i], 'Actual Any Quote deployment receipt');
      if (i === 1) equal(engineBindings, deployment.engineBindings, 'Actual Any Quote deployment relationships');
    }
    const live = plan.identity.sourceVersion === 'module-engine-any-quote-eth-v1'
      ? await collectAnyQuoteEthSource(packet.deploymentPlan, packet.build, deployment, Buffer.from(packet.previousSourceVerificationEvidenceRaw), Buffer.from(packet.previousGuardSourceVerificationEvidenceRaw))
      : await collectAnyQuoteSource(packet.deploymentPlan, packet.build, deployment, Buffer.from(packet.previousSourceVerificationEvidenceRaw));
    const stored = exactJson(Buffer.from(packet.sourceVerificationEvidenceRaw), 'Actual source evidence');
    // A public source server can change response serialization; exact compiler, source, creation and runtime records cannot change.
    const stable = value => ({ ...value, providerPreflight: undefined, records: value.records.map(({ responseBytesDigest, ...record }) => record) });
    equal(stable(live), stable(stored), 'Independent exact source readback');
    const admission = await c.observeReceipt(packet.admission.plan, packet.admission.entry, providers);
    equal(admission, packet.admission.evidence, 'Actual canonical revision admission');
  })();
  checkedPackets.set(key, validation);
  try { await validation; } catch (error) { checkedPackets.delete(key); throw error; }
}
async function assertAnyQuotePacketAnchors(plan, providers, c) {
  const packet = plan.preactivation;
  equal(await bindAnyQuotePreactivationPacket(packet, plan.identity, plan.bundle), plan.proofBindings, 'Any Quote packet binding');
  const deployment = exactJson(Buffer.from(packet.deploymentEvidenceRaw), 'Actual deployment evidence');
  for (const record of [...deployment.records, packet.admission.evidence])
    need((await c.pair(providers, 'eth_getBlockByNumber', [record.receipt.blockNumber, false])).every(block => block?.hash === record.receipt.blockHash
      && block.transactions.includes(record.transaction.hash)), 'Pre-activation deployment/admission anchor changed');
}
function anyQuoteClient(providers, c, block) {
  return createPublicClient({ cacheTime: 0, batch: { multicall: false }, transport: custom({ request: async ({ method, params = [] }) => {
    const anchored = method === 'eth_getBlockByNumber' && params[0] === 'latest' ? [block.number, ...params.slice(1)] : params;
    return c.same(await c.pair(providers, method, anchored), `Any Quote ${method}`);
  } }) });
}
export function anyQuoteWalletStep(plan, stepIndex, envelope) {
  const step = plan.steps[stepIndex]; need(isAnyQuoteLifecyclePlan(plan) && step?.kind.startsWith('any-quote-'), 'Closed Any Quote wallet step required');
  need(envelope?.schemaVersion === 'programmable.any-quote.lifecycle-preparation.v1', 'Canonical Any Quote preparation required');
  equal(envelope.identity, plan.identity, 'Prepared Any Quote identity');
  const { recipe, prepared } = envelope, intent = step.intent;
  equal(recipe.template, { status: 'available', manifest: plan.bundle.manifest, manifestHash: plan.bundle.review.command.hostManifestHash, reviewDigest: plan.bundle.review.decisionDigest }, 'Prepared accepted template');
  need(prepared.account === plan.owner && prepared.releaseDigest === plan.identity.releaseDigest, 'Prepared actor or release differs');
  const action = step.kind.slice('any-quote-'.length);
  if (action === 'launch') {
    need(recipe.kind === 'launch' && prepared.kind === 'launch', 'Prepared launch differs');
    const { anyQuotePreparation, ...input } = recipe.input;
    const { releaseDigest, initialBuyWei, slippageBps, ...compilerInput } = intent;
    equal(input, compilerInput, 'Prepared launch compiler inputs');
    const { description, imageUri, socialLinks, ...priceIntent } = intent;
    equal(anyQuotePreparation?.intent, priceIntent, 'Prepared launch price intent');
    // Metadata belongs to the exact compiler input, while these three values are
    // canonically retained only in the separately bound price/readiness intent.
    need(releaseDigest === plan.identity.releaseDigest && (plan.identity.sourceVersion === 'module-engine-any-quote-eth-v1' ? BigInt(initialBuyWei) > 0n : initialBuyWei === '0') && Number.isInteger(slippageBps)
      && typeof description === 'string' && typeof imageUri === 'string' && socialLinks, 'Complete reviewed bootstrap intent required');
    need(anyQuotePreparation?.intent?.initialBuyWei === initialBuyWei && anyQuotePreparation.predictedToken === step.target, 'Prepared bootstrap launch differs');
  } else if (action === 'claim') {
    equal(recipe, { kind: 'claim', template: recipe.template, account: plan.owner, token: intent.token, recipient: intent.recipient }, 'Prepared beneficiary claim');
    need(prepared.kind === 'claim' && prepared.token === intent.token && prepared.recipient === intent.recipient && BigInt(prepared.minimumAmount) > 0n, 'Positive actual beneficiary fees required');
    if (plan.identity.sourceVersion === 'module-engine-any-quote-eth-v1')
      need(prepared.transaction?.data === encodeFunctionData({ abi: parseAbi(['function claimEthTo(address recipient) returns (uint256)']),
        functionName: 'claimEthTo', args: [intent.recipient] }), 'Native-fee claim must call the exact ETH beneficiary payout');
  } else {
    need(recipe.kind === (action === 'approve' ? 'approve' : 'swap') && recipe.account === plan.owner, 'Prepared trade kind differs');
    const quote = recipe.quote;
    for (const [key, value] of Object.entries({ releaseDigest: plan.identity.releaseDigest, templateId: plan.bundle.manifest.manifest.catalogDefinition.id,
      account: plan.owner, token: intent.token, recipient: intent.recipient, buy: action === 'buy', inputAmount: intent.inputAmount, slippageBps: intent.slippageBps })) equal(quote[key], value, `Prepared trade ${key}`);
    if (action === 'approve') {
      need(prepared.kind === 'approve' && prepared.allowanceKind === intent.allowanceKind && prepared.token === intent.token && prepared.amount === intent.amount
        && (intent.allowanceKind === 'erc20' ? address(prepared.spender) === intent.spender : address(prepared.permit2Spender) === intent.spender), 'Exact sell predecessor allowance differs');
      need(envelope.funding?.kind === 'approval-required' && envelope.funding.amount === intent.amount, 'Actual deficient allowance required');
      if (intent.allowanceKind === 'permit2') need(BigInt(prepared.expiration) > BigInt(quote.checkpoint.timestamp)
        && BigInt(prepared.expiration) <= BigInt(quote.checkpoint.timestamp) + 300n, 'Permit2 approval expiry exceeds the reviewed bound');
    } else need(prepared.kind === 'swap', 'Prepared swap differs');
  }
  const transaction = prepared.transaction;
  need(transaction?.from === plan.owner && address(transaction.to) === step.to && BigInt(transaction.value) === BigInt(step.value), 'Prepared transaction target/value differs');
  bytes(transaction.data); uint(prepared.expiresAt, 'Canonical preparation expiry', true);
  return { ...step, to: address(transaction.to), data: transaction.data, value: BigInt(transaction.value).toString() };
}
export function anyQuoteRequestExpiry(envelope) {
  let expiry = BigInt(envelope.prepared.expiresAt);
  if (envelope.recipe.quote) expiry = expiry < BigInt(envelope.recipe.quote.validUntil) ? expiry : BigInt(envelope.recipe.quote.validUntil);
  if (envelope.recipe.input?.anyQuotePreparation) expiry = expiry < BigInt(envelope.recipe.input.anyQuotePreparation.validUntil) ? expiry : BigInt(envelope.recipe.input.anyQuotePreparation.validUntil);
  need(expiry > 0n && expiry <= 9007199254740n, 'Preparation expiry exceeds safe timestamp');
  return Number(expiry) * 1000;
}
async function anyQuoteFunding(plan, stepIndex, providers, block, c, api) {
  if (plan.action.kind !== 'sell') return;
  const step = plan.steps[stepIndex], funding = plan.action.funding, amount = BigInt(plan.action.inputAmount), token = plan.action.token, permit2 = api.ANY_QUOTE_INFRASTRUCTURE.permit2;
  const erc20 = await c.read(providers, token, erc20Abi, 'allowance', [plan.owner, permit2], block.number);
  const permit = await c.read(providers, permit2, api.moduleEnginePermit2Abi, 'allowance', [plan.owner, token, plan.identity.contracts.universalRouter.address], block.number);
  const erc20Approved = plan.steps.slice(0, stepIndex).some(s => s.intent?.allowanceKind === 'erc20');
  equal(erc20, erc20Approved ? amount : BigInt(funding.erc20Allowance), 'Reviewed token to Permit2 allowance');
  const permitApproved = plan.steps.slice(0, stepIndex).some(s => s.intent?.allowanceKind === 'permit2');
  if (!permitApproved) equal(permit.map(String), [funding.permit2Amount, funding.permit2Expiration, funding.permit2Nonce], 'Reviewed Permit2 allowance snapshot');
  else need(permit[0] === amount && BigInt(permit[2]) === BigInt(funding.permit2Nonce), 'Exact Permit2 predecessor amount/nonce differs');
  if (step.kind === 'any-quote-sell') need(erc20 >= amount && permit[0] >= amount && BigInt(permit[1]) > c.quantity(block.timestamp), 'Sell funding predecessors are not complete');
}
export async function materializeAnyQuoteOperation(plan, stepIndex, providers, block, c, original) {
  const api = await publicationValidators(), client = anyQuoteClient(providers, c, block), step = plan.steps[stepIndex];
  await anyQuoteFunding(plan, stepIndex, providers, block, c, api);
  if (original) {
    anyQuoteWalletStep(plan, stepIndex, original);
    await api.revalidateAnyQuoteLifecyclePreparationV1({ client, identity: plan.identity, preparation: original }); return original;
  }
  const template = { status: 'available', manifest: plan.bundle.manifest, manifestHash: plan.bundle.review.command.hostManifestHash, reviewDigest: plan.bundle.review.decisionDigest };
  const common = { client, identity: plan.identity, template, account: plan.owner }, rpcs = providers.map(provider => (method, params = []) => provider.rpc(method,
    method === 'eth_getBlockByNumber' && params[0] === 'latest' ? [block.number, ...params.slice(1)] : params));
  const dependencies = { client, options: { rpcs } }; let envelope;
  if (step.kind === 'any-quote-launch') {
    const preview = await api.readAnyQuoteIdentityLaunchPreviewV1({ ...step.intent, identity: plan.identity, template }, dependencies);
    envelope = await api.prepareAnyQuoteLifecycleLaunchV1({ ...common, input: { ...step.intent, anyQuotePreparation: preview } });
  } else if (step.kind === 'any-quote-claim') envelope = await api.prepareAnyQuoteLifecycleClaimV1({ ...common, ...step.intent });
  else {
    const quote = await api.readAnyQuoteIdentityTradeQuoteV1({ ...common, ...step.intent, releaseDigest: plan.identity.releaseDigest,
      templateId: plan.bundle.manifest.manifest.catalogDefinition.id, buy: step.kind === 'any-quote-buy' }, dependencies);
    envelope = await (step.kind === 'any-quote-approve' ? api.prepareAnyQuoteLifecycleApprovalV1 : api.prepareAnyQuoteLifecycleSwapV1)({ ...common, quote });
  }
  anyQuoteWalletStep(plan, stepIndex, envelope);
  need(api.anyQuoteEvidenceHashV1({ ...envelope, evidenceHash: undefined }) === envelope.evidenceHash, 'Canonical preparation evidence hash differs');
  need(anyQuoteRequestExpiry(envelope) > Date.now(), 'Canonical Any Quote preparation expired'); return envelope;
}
