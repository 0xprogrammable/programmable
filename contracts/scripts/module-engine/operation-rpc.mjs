import { decodeEventLog, decodeFunctionResult, encodeAbiParameters, encodeEventTopics, erc20Abi, keccak256, parseAbiParameters } from 'viem';
import { address, bytes, hash, jsonSafe, need } from '../module-mode/core.mjs';
import { publicationValidators } from '../module-mode/publication-shared.mjs';
import { ZERO_ADDRESS, registryAbi } from '../module-mode/publication-plan.mjs';
import { ENGINE_PUBLICATION_OPERATOR_SCHEMA, equal, equalEngineLaunchPlan } from './publication-plan.mjs';
import { assertEnginePermission } from './lifecycle-operator-plan.mjs';
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
  if (api.isModuleEngineAnyQuoteRelease(plan.identity)) {
    need(plan.schemaVersion === ENGINE_PUBLICATION_OPERATOR_SCHEMA, 'Any Quote launches and trades use the existing public website/API preparation');
    for (const [name, expected] of [['sharedHook', pins.sharedHook.address], ['nativeRouteGuard', pins.nativeRouteGuard.address],
      ['NATIVE_ROUTE_GUARD_CODE_HASH', pins.nativeRouteGuard.runtimeCodeHash], ['quotePoolManager', pins.poolManager.address],
      ['quotePoolManagerCodeHash', pins.poolManager.runtimeCodeHash], ['UNIVERSAL_ROUTER', pins.universalRouter.address],
      ['UNIVERSAL_ROUTER_CODE_HASH', pins.universalRouter.runtimeCodeHash], ['quoteFeeProfileId', api.MODULE_ENGINE_ANY_QUOTE_PROFILE_ID]])
      equal((await read(host, name, [], api.moduleEngineAnyQuoteHostAbi)).toLowerCase(), expected, `Any Quote Host ${name}`);
    for (const [name, role] of [['host', 'host'], ['ledger', 'ledger'], ['poolManager', 'poolManager']])
      equal(address(await read(pins.sharedHook.address, name, [], api.moduleEngineAnyQuoteHookAbi)), pins[role].address, `Any Quote hook ${name}`);
    for (const [name, role] of [['host', 'host'], ['hook', 'sharedHook'], ['poolManager', 'poolManager']])
      equal(address(await read(ledger, name, [], api.moduleEngineAnyQuoteLedgerAbi)), pins[role].address, `Any Quote ledger ${name}`);
    equal(await read(ledger, 'ECONOMICS_POLICY_ID', [], api.moduleEngineAnyQuoteLedgerAbi), plan.identity.economicsPolicyId, 'Any Quote economics policy');
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
  const graffiti = keccak256(encodeAbiParameters(parseAbiParameters('string,address,bytes32'), ['programmable.module-engine.token.v1', expected.creator, parameters.creatorSalt]));
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
  const launching = plan.action.kind === 'launch', quote = launching ? plan.action.quote : plan.action.launch.plan.action.quote;
  await c.code(providers, quote, block.number);
  equal(await c.read(providers, quote.address, erc20Abi, 'decimals', [], block.number), quote.decimals, 'Actual quote asset decimals');
  await revisionBindings(plan, providers, block.number, c, api);
  if (launching) {
    const p = launchStep(plan).arguments[0], expected = step.expectation;
    const graffiti = keccak256(encodeAbiParameters(parseAbiParameters('string,address,bytes32'), ['programmable.module-engine.token.v1', plan.owner, p.creatorSalt]));
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
