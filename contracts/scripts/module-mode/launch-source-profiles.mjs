import { decodeAbiParameters, decodeEventLog, encodeAbiParameters, getCreate2Address, keccak256, parseAbi,
  parseAbiParameters, toEventSelector, toHex, zeroAddress, zeroHash } from 'viem';
import { canonicalJson, need } from './core.mjs';

export const CHECKPOINT_SCHEMA = 'programmable.module-mode-launch-source-checkpoints.v2';
const ENTRY_SCHEMA = 'programmable.module-mode-launch-source-checkpoint.v2';
const LEGACY_SCHEMA = 'programmable.module-mode-launch-source-checkpoint.v1';
const equal = (a, b, label) => need(canonicalJson(a) === canonicalJson(b), label);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
const exact = (value, keys, label) => {
  need(value && typeof value === 'object' && !Array.isArray(value)
    && canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort()), label);
};

/** Dispatch only by an authenticated release schema/version, never by token, symbol or contributor code. */
export function sourceProfile(release, wire) {
  const native = ['module-native-v1', 'module-native-v2'].includes(release.sourceVersion);
  const anyQuote = ['module-engine-any-quote-v1', 'module-engine-any-quote-eth-v1'].includes(release.sourceVersion);
  need(native || release.sourceVersion === 'module-engine-v1' || anyQuote && (release.sourceVersion === 'module-engine-any-quote-v1' ? wire.isModuleEngineAnyQuoteRelease(release) : wire.isModuleEngineAnyQuoteEthRelease(release)), 'Unsupported launch source profile');
  const abi = native ? wire.moduleNativeLaunchAbiFor(release) : wire.moduleEngineHostAbi;
  const eventName = native ? 'ModuleNativeLaunched' : 'EngineLaunchBound';
  const event = abi.find(item => item.type === 'event' && item.name === eventName);
  need(event, 'Canonical source event is absent');
  return { version: release.sourceVersion, native, abi, eventName, topic: toEventSelector(event), tokenTopic: native ? 3 : 2,
    source: release.contracts[native ? 'launcher' : 'host'].address };
}
export function nativeForwarderSalt(release, token) {
  need(['module-native-v1', 'module-native-v2'].includes(release.sourceVersion), 'Native forwarder profile required');
  return keccak256(encodeAbiParameters(parseAbiParameters('string,uint256,address,address'),
    [`programmable.module-mode.native-position.${release.sourceVersion === 'module-native-v2' ? 'v2' : 'v1'}`, 4663n, release.contracts.launcher.address, token]));
}
export function bindNativeTokenIdentity(release, launch, receipt, graffiti) {
  if (release.sourceVersion === 'module-native-v1') return;
  need(release.sourceVersion === 'module-native-v2', 'Unsupported native token profile');
  const identity = receiptEvent(receipt, NATIVE_IDENTITY_ABI, release.contracts.launcher.address, 'ModuleNativeTokenIdentityBound', launch.launchId);
  const expected = keccak256(encodeAbiParameters(parseAbiParameters('string,uint256,address,address,bytes32'),
    ['programmable.module-mode.native-token.v2', 4663n, release.contracts.launcher.address, launch.launchWallet, identity.args.creatorSalt]));
  need(same(identity.args.graffiti, graffiti) && same(graffiti, expected), 'V2 token identity commitment differs');
  return identity.log;
}

/** Existing current/history formats are the inventory. No new active release or publication is manufactured. */
export function releaseInventory(files, wire) {
  const found = new Map();
  for (const kind of ['native', 'engine']) {
    const group = files[kind], historySchema = kind === 'native' ? 'programmable.module-mode-historical-releases.v1' : 'programmable.module-engine.historical-releases.v1';
    exact(group.history, ['schemaVersion', 'releases'], 'Invalid release history');
    need(group.history.schemaVersion === historySchema && Array.isArray(group.history.releases) && group.history.releases.length <= 32, 'Invalid release history');
    const bind = kind === 'native' ? wire.bindActiveModuleModeRelease : wire.bindActiveModuleEngineRelease;
    const entries = [...group.history.releases];
    for (const entry of entries) exact(entry, ['release', 'catalog'], 'Invalid historical source entry');
    const historyDigests = entries.map(entry => bind(entry.release).releaseDigest);
    need(new Set(historyDigests).size === historyDigests.length, 'Duplicate historical source release');
    if (group.current !== null && !(kind === 'native' && group.current.enabled === false && group.current.status === 'preview'))
      entries.push({ release: group.current, catalog: group.catalog });
    for (const entry of entries) {
      const release = bind(entry.release), profile = sourceProfile(release, wire);
      need(profile.native === (kind === 'native'), 'Release inventory source kind differs');
      if (found.has(release.releaseDigest)) {
        equal(found.get(release.releaseDigest).release, release, 'Conflicting release identity');
        equal(found.get(release.releaseDigest).catalog, entry.catalog, 'Conflicting current/historical catalogue');
      } else found.set(release.releaseDigest, { release, catalog: entry.catalog, profile });
    }
  }
  return [...found.values()].sort((a, b) => BigInt(a.release.startBlock) < BigInt(b.release.startBlock) ? -1
    : BigInt(a.release.startBlock) > BigInt(b.release.startBlock) ? 1 : a.release.releaseDigest.localeCompare(b.release.releaseDigest));
}
export function checkpointEntry(release, nextBlock, blockHash, checkedAt) {
  return { schemaVersion: ENTRY_SCHEMA, chainId: 4663, releaseDigest: release.releaseDigest, sourceVersion: release.sourceVersion,
    sourceAddress: release.contracts[['module-engine-v1', 'module-engine-any-quote-v1', 'module-engine-any-quote-eth-v1'].includes(release.sourceVersion) ? 'host' : 'launcher'].address,
    nextBlock: String(nextBlock), blockHash, checkedAt };
}
export function bindCheckpointEntry(value, release) {
  exact(value, ['schemaVersion', 'chainId', 'releaseDigest', 'sourceVersion', 'sourceAddress', 'nextBlock', 'blockHash', 'checkedAt'], 'Invalid source checkpoint entry');
  need(/^(0|[1-9][0-9]*)$/.test(value.nextBlock) && BigInt(value.nextBlock) > BigInt(release.startBlock)
    && /^0x[0-9a-f]{64}$/.test(value.blockHash) && Number.isFinite(Date.parse(value.checkedAt)), 'Invalid checkpoint block');
  equal(value, checkpointEntry(release, value.nextBlock, value.blockHash, value.checkedAt), 'Checkpoint belongs to a different release');
  return value;
}
export function checkpointState(value, inventory) {
  const result = { schemaVersion: CHECKPOINT_SCHEMA, chainId: 4663, releases: {} };
  if (value === undefined) return result;
  const byDigest = new Map(inventory.map(entry => [entry.release.releaseDigest, entry.release]));
  if (value.schemaVersion === LEGACY_SCHEMA) {
    exact(value, ['schemaVersion', 'chainId', 'releaseDigest', 'launcher', 'nextBlock', 'blockHash', 'checkedAt'], 'Invalid legacy checkpoint');
    const release = byDigest.get(value.releaseDigest);
    need(release?.sourceVersion === 'module-native-v1' && value.chainId === 4663
      && same(value.launcher, release.contracts.launcher.address), 'Legacy checkpoint has no matching historical V1 release');
    result.releases[value.releaseDigest] = bindCheckpointEntry(checkpointEntry(release, value.nextBlock, value.blockHash, value.checkedAt), release);
    return result;
  }
  exact(value, ['schemaVersion', 'chainId', 'releases'], 'Invalid source checkpoint');
  need(value.schemaVersion === CHECKPOINT_SCHEMA && value.chainId === 4663 && value.releases && typeof value.releases === 'object'
    && !Array.isArray(value.releases) && Object.keys(value.releases).length <= 66, 'Invalid source checkpoint inventory');
  for (const [digest, record] of Object.entries(value.releases)) {
    need(byDigest.has(digest), 'Checkpoint release is absent from current/history inventory');
    result.releases[digest] = bindCheckpointEntry(record, byDigest.get(digest));
  }
  return result;
}

export function receiptEvent(receipt, abi, source, eventName, subject) {
  const declaration = abi.find(item => item.type === 'event' && item.name === eventName);
  need(declaration, 'Missing source event ABI');
  const topic = toEventSelector(declaration);
  const logs = receipt.logs.filter(log => same(log.address, source) && same(log.topics?.[0], topic)
    && (subject === undefined || same(log.topics?.[1], subject)));
  need(logs.length === 1, `Expected one ${eventName} event`);
  const log = logs[0];
  need(log.removed === false && same(log.transactionHash, receipt.transactionHash) && log.blockHash === receipt.blockHash
    && BigInt(log.blockNumber) === BigInt(receipt.blockNumber), 'Source event receipt binding differs');
  return { log, args: decodeEventLog({ abi, eventName, topics: log.topics, data: log.data, strict: true }).args };
}

/** Pure event/constructor binding, with the same ABI and immutable materializer as review and deployment. */
export function engineLaunchIdentity({ release, receipt, log, publication, revision }, wire) {
  const host = release.contracts.host.address;
  const emitted = receiptEvent(receipt, wire.moduleEngineHostAbi, host, 'EngineLaunchBound', log.topics[1]);
  need(emitted.log.logIndex === log.logIndex && emitted.log.data === log.data, 'Engine event differs from scan');
  const a = emitted.args, input = receiptEvent(receipt, wire.moduleEngineHostAbi, host, 'EngineLaunchParametersBound', a.launchId);
  need(BigInt(input.log.logIndex) > BigInt(log.logIndex), 'Engine parameters precede their launch event');
  const abi = parseAbiParameters(`${wire.ENGINE_LAUNCH_PARAMETERS} parameters`), encoded = input.args.encodedParameters;
  need(encoded.length <= 2 + 113984 * 2, 'Engine parameters exceed host bound');
  const p = decodeAbiParameters(abi, encoded)[0];
  need(same(encodeAbiParameters(abi, [p]), encoded), 'Engine parameters are not canonical ABI');
  const manifest = publication.template.manifest.manifest, reviewed = manifest.source.engine, expected = manifest.revision;
  need(same(a.economicsPolicyId, release.economicsPolicyId) && same(p.revisionId, a.revisionId)
    && same(p.quoteAsset, a.quoteAsset) && !same(a.token, a.quoteAsset), 'Engine release/quote/revision differs');
  need(same(p.creationCode, reviewed.creationBytecode) && same(p.runtimeTemplate, reviewed.runtimeTemplate), 'Engine code differs from accepted public build');
  const [onchain, offsets, bindings, families] = revision;
  const fields = { familyId: expected.familyId, creationCodeHash: reviewed.creationCodeHash, runtimeTemplateHash: reviewed.runtimeTemplateHash,
    manifestHash: publication.template.manifestHash, fixedQuoteAsset: expected.fixedQuoteAsset, fixedConfigurationHash: expected.fixedConfigurationHash,
    initialOperationId: expected.initialOperationId, executionGas: expected.executionGas, moneyRights: expected.moneyRights, coinRights: expected.coinRights };
  for (const [key, value] of Object.entries(fields)) need(same(onchain[key], value), `Engine reviewed revision ${key} differs`);
  // A later disable in the same block does not undo this already-successful launch; enabled is not publication authority.
  need(typeof onchain.enabled === 'boolean', 'Invalid revision enablement');
  equal(offsets, reviewed.immutableRuntimeOffsets, 'Engine immutable runtime offsets differ');
  equal(bindings, reviewed.immutableConstructorOffsets, 'Engine immutable constructor bindings differ');
  equal(families.map(x => x.toLowerCase()), expected.eligibleFamilies, 'Engine eligible families differ');
  need(p.configuration.length <= 2 + 16384 * 2 && p.launchData.length <= 2 + 16384 * 2, 'Engine configuration exceeds host bounds');
  const configHash = keccak256(p.configuration);
  need(same(configHash, a.configurationHash) && (expected.fixedQuoteAsset === zeroAddress || same(expected.fixedQuoteAsset, a.quoteAsset))
    && (expected.fixedConfigurationHash === zeroHash || same(expected.fixedConfigurationHash, configHash)), 'Engine fixed configuration/quote differs');
  const launchId = keccak256(encodeAbiParameters(parseAbiParameters('uint256,address,address,bytes32,bytes32'), [4663n, host, a.token, a.revisionId, configHash]));
  const planHash = keccak256(encodeAbiParameters(wire.moduleEnginePlanParameters, [4663n, host, a.creator, p]));
  need(same(launchId, a.launchId) && same(planHash, a.planHash), 'Engine launch/plan hash differs');
  const anyQuote = wire.isModuleEngineAnyQuoteRelease?.(release) === true || wire.isModuleEngineAnyQuoteEthRelease?.(release) === true;
  const nativeFeeRoute = wire.isModuleEngineAnyQuoteEthRelease?.(release) === true
    ? wire.decodeAnyQuoteNativeFeeRoute(p.launchData, { quoteAsset: a.quoteAsset, token: a.token, sharedHook: release.contracts.sharedHook.address }) : undefined;
  const context = { host, launchId, token: a.token, creator: a.creator, quoteAsset: a.quoteAsset, feeCollector: anyQuote ? release.contracts.ledger.address : host };
  const constructorArguments = encodeAbiParameters(wire.moduleEngineConstructorParameters, [context, p.configuration]);
  const creationCode = `${p.creationCode}${constructorArguments.slice(2)}`;
  need((creationCode.length - 2) / 2 <= 49152 && same(keccak256(creationCode), a.initCodeHash)
    && same(keccak256(constructorArguments), a.constructorHash), 'Engine creation commitment differs');
  const salt = keccak256(encodeAbiParameters(parseAbiParameters('address,bytes32,bytes32'), [a.creator, p.engineSalt, launchId]));
  need(same(getCreate2Address({ from: host, salt, bytecodeHash: keccak256(creationCode) }), a.engine), 'Engine CREATE2 address differs');
  const runtime = wire.materializeModuleEngineRuntimeV1(reviewed, constructorArguments);
  need(same(keccak256(runtime), a.runtimeCodeHash), 'Engine immutable runtime differs');
  const graffiti = keccak256(encodeAbiParameters(parseAbiParameters('string,address,bytes32'), [anyQuote ? 'programmable.module-engine.any-quote-token.v1' : 'programmable.module-engine.token.v1', a.creator, p.creatorSalt]));
  const tokenSalt = keccak256(encodeAbiParameters(parseAbiParameters('string,string,uint8,address,bytes32'), [p.name, p.symbol, 18, host, graffiti]));
  need(same(getCreate2Address({ from: release.contracts.tokenFactory.address, salt: tokenSalt, bytecodeHash: release.tokenCreationCodeHash }), a.token), 'Engine token CREATE2 differs');
  return { launch: a, parameters: p, context, graffiti, runtime, constructorArguments, creationCode, manifest,
    ...(anyQuote ? { anyQuoteRelease: release } : {}), ...(nativeFeeRoute ? { nativeFeeRoute } : {}) };
}

/** Existing reviewed resource interfaces only. Unknown/custom child-contract profiles remain closed. */
export function engineResourceCommitment(identity, state) {
  const { launch: a, parameters: p, manifest } = identity;
  const nativeFees = identity.anyQuoteRelease?.sourceVersion === 'module-engine-any-quote-eth-v1';
  if (nativeFees) need(identity.nativeFeeRoute?.launchData === p.launchData && same(identity.nativeFeeRoute.routeHash, keccak256(p.launchData))
    && same(state.nativeFeeRouteHash, identity.nativeFeeRoute.routeHash), 'Native fee route resource binding differs');
  else need(p.launchData === '0x', 'Unsupported engine initialization resource data');
  let hash;
  if (manifest.catalogDefinition.interface === 'settlement-v1') {
    const definition = manifest.catalogDefinition;
    // The protected publication binds these source bytes. A presentation interface alone does not select a new codec.
    const quoteBound = definition.source.path === 'src/QuoteBoundSettlementV1.sol'
      && definition.source.sha256 === 'bbf3d19c6244d1a9ad37ee33b2c147f11662475f72904f24c4d13be208797bcf';
    if (quoteBound) equal(definition.configurationAbi, [
      { path: ['quoteAsset'], type: 'address' }, { path: ['minimumWindow'], type: 'uint256' }, { path: ['maximumWindow'], type: 'uint256' },
    ], 'Settlement configuration ABI differs from the reviewed source profile');
    const abi = parseAbiParameters(quoteBound ? 'address,uint256,uint256' : 'uint256,uint256');
    const values = decodeAbiParameters(abi, p.configuration), [minimum, maximum] = quoteBound ? values.slice(1) : values;
    if (quoteBound) need(same(values[0], a.quoteAsset) && minimum === 60n && maximum === 30n * 86400n, 'Settlement quote/fixed windows differ');
    need(same(encodeAbiParameters(abi, values), p.configuration) && minimum > 0n && maximum >= minimum
      && maximum <= 365n * 86400n && state.minimumWindow === minimum && state.maximumWindow === maximum, 'Settlement resources differ');
    hash = keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint256,uint256'), [a.quoteAsset, a.creator, minimum, maximum]));
  } else if (manifest.catalogDefinition.interface === 'escrow-v1') {
    const abi = parseAbiParameters('address,uint256'), [quote, unlock] = decodeAbiParameters(abi, p.configuration);
    need(same(encodeAbiParameters(abi, [quote, unlock]), p.configuration) && (same(quote, zeroAddress) || same(quote, a.quoteAsset))
      && state.unlockTime === unlock, 'Escrow resources differ');
    hash = keccak256(encodeAbiParameters(parseAbiParameters('address,uint256'), [a.quoteAsset, unlock]));
  } else if (manifest.catalogDefinition.interface === 'quote-shared-v1') {
    const release = identity.anyQuoteRelease;
    need(['module-engine-any-quote-v1', 'module-engine-any-quote-eth-v1'].includes(release?.sourceVersion) && p.configuration.length === 514, 'Authenticated Any Quote source and exact configuration required');
    const abi = parseAbiParameters('(bytes32 schemaId,address poolManager,bytes32 poolManagerCodeHash,address sharedHook,address quoteAsset,int24 initialTick,uint64 validUntil,bytes32 priceEvidenceHash)');
    const [config] = decodeAbiParameters(abi, p.configuration), pins = release.contracts;
    need(same(encodeAbiParameters(abi, [config]), p.configuration)
      && same(config.schemaId, keccak256(toHex('programmable.any-quote.configuration.v1')))
      && same(config.poolManager, pins.poolManager.address) && same(config.poolManagerCodeHash, pins.poolManager.runtimeCodeHash)
      && same(config.sharedHook, pins.sharedHook.address) && same(config.quoteAsset, a.quoteAsset)
      && config.validUntil > 0n && config.priceEvidenceHash !== zeroHash && config.initialTick > -887200
      && config.initialTick < 887200 && config.initialTick % 200 === 0, 'Any Quote configuration binding differs');
    const currencies = [a.token, a.quoteAsset].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()));
    const poolId = keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'), [...currencies, 0, 200, pins.sharedHook.address]));
    const quote0 = a.quoteAsset.toLowerCase() < a.token.toLowerCase(), lower = quote0 ? -887200 : config.initialTick, upper = quote0 ? config.initialTick : 887200;
    need(same(state.poolId, poolId) && state.initialTick === config.initialTick && state.tickLower === lower && state.tickUpper === upper
      && state.lockedLiquidity > 0n && state.lockedLiquidity <= ((1n << 128n) - 1n) / 8873n
      && state.lockedTokenDust >= 0n && state.lockedTokenDust < 10n ** 27n
      && Number.isInteger(state.quoteDecimals) && state.quoteDecimals >= 0 && state.quoteDecimals <= 36,
    'Any Quote locked position resources differ');
    hash = keccak256(encodeAbiParameters(parseAbiParameters('bytes32,int24,int24,uint128,uint256,uint8'),
      [poolId, lower, upper, state.lockedLiquidity, state.lockedTokenDust, state.quoteDecimals]));
  } else if (manifest.catalogDefinition.interface === 'quote-v1') {
    need(manifest.revision.fixedConfigurationHash !== zeroHash, 'Quote resources require reviewed fixed configuration');
    const currencies = [a.token, a.quoteAsset].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase()));
    const poolId = keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'), [...currencies, 0, 200, a.engine]));
    need(same(state.poolId, poolId) && state.positionTokenId > 0n && Number.isInteger(state.initialAbsoluteTick)
      && state.initialAbsoluteTick > 0 && state.initialAbsoluteTick < 887272 && state.initialAbsoluteTick % 200 === 0
      && Number.isInteger(state.quoteDecimals) && state.quoteDecimals >= 0 && state.quoteDecimals <= 18, 'Quote resources differ');
    const tick = a.quoteAsset.toLowerCase() < a.token.toLowerCase() ? state.initialAbsoluteTick : -state.initialAbsoluteTick;
    hash = keccak256(encodeAbiParameters(parseAbiParameters('bytes32,uint256,address,int24,uint8,uint256'),
      [poolId, state.positionTokenId, state.positionRecipient, tick, state.quoteDecimals, state.lockedTokenDust]));
  } else throw new Error('Unsupported engine resource source profile; publication requires an explicit bound adapter');
  need(same(hash, a.resourcesHash), 'Engine resources hash differs from launch commitment');
  return hash;
}

export const NATIVE_IDENTITY_ABI = parseAbi(['event ModuleNativeTokenIdentityBound(bytes32 indexed launchId,bytes32 creatorSalt,bytes32 graffiti)']);

/** Sourcify can deduplicate immutableReferences and transformations from different local AST-id spaces.
 * Relabel only a bijection of identical complete offset groups. Bytes, values and transforms are untouched;
 * the shared validator still checks every slot, full creation/runtime, metadata and source setting. */
export function alignPublishedImmutableIds(value) {
  const runtime = value?.runtimeBytecode, references = runtime?.immutableReferences ?? {}, transforms = runtime?.transformations;
  need(references && typeof references === 'object' && !Array.isArray(references) && Array.isArray(transforms), 'Immutable provider evidence is unavailable');
  const groups = new Map(), renamed = {}, bindings = {}, transformed = new Map();
  const key = ranges => canonicalJson([...ranges].sort((a, b) => a.start - b.start));
  for (const [id, ranges] of Object.entries(references)) {
    need(/^(0|[1-9][0-9]*)$/.test(id) && Array.isArray(ranges) && ranges.length > 0, 'Invalid provider immutable reference');
    for (const range of ranges) {
      exact(range, ['start', 'length'], 'Invalid provider immutable range');
      need(Number.isSafeInteger(range.start) && range.start >= 0 && range.length === 32, 'Invalid provider immutable range');
    }
    const group = key(ranges); need(!groups.has(group), 'Duplicate immutable offset group'); groups.set(group, { id, ranges });
  }
  for (const transform of transforms) {
    exact(transform, ['id', 'type', 'offset', 'reason'], 'Invalid immutable transformation');
    need(typeof transform.id === 'string' && /^(0|[1-9][0-9]*)$/.test(transform.id) && transform.type === 'replace'
      && transform.reason === 'immutable' && Number.isSafeInteger(transform.offset) && transform.offset >= 0, 'Unsupported immutable transformation');
    const group = transformed.get(transform.id) ?? []; group.push({ start: transform.offset, length: 32 }); transformed.set(transform.id, group);
  }
  need(groups.size === transformed.size, 'Incomplete immutable transformation groups');
  for (const [id, offsets] of transformed) {
    const group = key(offsets), reference = groups.get(group);
    need(reference, 'Immutable transformation offset groups differ'); groups.delete(group);
    renamed[id] = reference.ranges; if (reference.id !== id) bindings[reference.id] = id;
  }
  need(groups.size === 0, 'Missing immutable transformation group');
  return { value: Object.keys(bindings).length ? { ...value, runtimeBytecode: { ...runtime, immutableReferences: renamed } } : value, bindings };
}
