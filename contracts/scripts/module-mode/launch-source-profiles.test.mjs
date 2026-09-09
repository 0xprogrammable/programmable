import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionResult, getCreate2Address,
  keccak256, parseAbi, parseAbiParameters, toHex, zeroAddress, zeroHash } from 'viem';
import { launchSourceWire } from './launch-source-shared.mjs';
import { sharedValidators } from './shared.mjs';
import { alignPublishedImmutableIds, bindNativeTokenIdentity, checkpointEntry, checkpointState, CHECKPOINT_SCHEMA, engineLaunchIdentity,
  engineResourceCommitment, nativeForwarderSalt, NATIVE_IDENTITY_ABI, releaseInventory, sourceProfile } from './launch-source-profiles.mjs';
import { bindPositionMint, creationEvidence, engineBuild, ensurePublished, parseOptions, releaseCode, run, validatePublished } from './verify-launch-source.mjs';

// All receipts, activation fields and review decisions below are isolated parser fixtures, never authority.
const wire = await launchSourceWire(), nativeWire = await sharedValidators();
const a = n => `0x${n.toString(16).padStart(40, '0')}`, h = n => `0x${n.toString(16).padStart(64, '0')}`;
const native = JSON.parse(await readFile(new URL('../../../config/module-mode/historical-releases.json', import.meta.url)))
  .releases.find(entry => entry.release.sourceVersion === 'module-native-v1').release;
const engine = JSON.parse(await readFile(new URL('../../../tests/fixtures/module-engine-index.json', import.meta.url))).cases[0].release;
const frozen = JSON.parse(await readFile(new URL('../../../tests/fixtures/module-engine-review-build.json', import.meta.url)));
const v2raw = { ...native, sourceVersion: 'module-native-v2', schemaVersion: 'programmable.module-mode-source.v2',
  economicsPolicyId: engine.economicsPolicyId, startBlock: (BigInt(native.startBlock) + 100n).toString() };
const v2 = wire.bindActiveModuleModeRelease({ ...v2raw, releaseDigest: nativeWire.computeModuleModeReleaseDigest(v2raw) });
function files() {
  const catalog = { synthetic: 'inventory-only' };
  return { native: { current: v2, catalog, history: { schemaVersion: 'programmable.module-mode-historical-releases.v1', releases: [{ release: native, catalog }] } },
    engine: { current: engine, catalog, history: { schemaVersion: 'programmable.module-engine.historical-releases.v1', releases: [] } } };
}
test('current V2, historical V1 and Engine are selected from existing schemas without changing old identities', () => {
  const inventory = releaseInventory(files(), wire);
  assert.deepEqual(new Set(inventory.map(x => x.release.releaseDigest)), new Set([native.releaseDigest, v2.releaseDigest, engine.releaseDigest]));
  assert.equal(sourceProfile(native, wire).topic, sourceProfile(v2, wire).topic, 'actual V2 event retains the V1 signature');
  assert.equal(sourceProfile(engine, wire).tokenTopic, 2);
  assert.equal(sourceProfile(v2, wire).tokenTopic, 3);
  assert.notEqual(nativeForwarderSalt(native, a(2)), nativeForwarderSalt(v2, a(2)));
  const sameGeneration = files(); sameGeneration.native.current = native;
  assert.equal(releaseInventory(sameGeneration, wire).length, 2, 'identical current/history entry is scanned only once');
  sameGeneration.native.catalog = { changed: true };
  assert.throws(() => releaseInventory(sameGeneration, wire), /Conflicting/);
  const duplicate = files(); duplicate.native.history.releases.push(duplicate.native.history.releases[0]);
  assert.throws(() => releaseInventory(duplicate, wire), /Duplicate/);
  const bad = files(); bad.engine.current = { ...engine, sourceCommit: 'f'.repeat(40) };
  assert.throws(() => releaseInventory(bad, wire), /digest/i);
  assert.throws(() => sourceProfile({ ...native, sourceVersion: 'contributor-choice' }, wire), /Unsupported/);
});
test('V1 checkpoint migrates only to its exact historical digest; new profiles start independently', () => {
  const inventory = releaseInventory(files(), wire), nextBlock = String(BigInt(native.startBlock) + 5n), checkedAt = '2026-09-07T00:00:00Z';
  const legacy = { schemaVersion: 'programmable.module-mode-launch-source-checkpoint.v1', chainId: 4663,
    releaseDigest: native.releaseDigest, launcher: native.contracts.launcher.address, nextBlock, blockHash: h(10), checkedAt };
  const state = checkpointState(legacy, inventory);
  assert.equal(state.schemaVersion, CHECKPOINT_SCHEMA);
  assert.equal(state.releases[native.releaseDigest].nextBlock, nextBlock);
  assert.equal(state.releases[v2.releaseDigest], undefined);
  state.releases[v2.releaseDigest] = checkpointEntry(v2, BigInt(v2.startBlock) + 1n, h(11), checkedAt);
  assert.deepEqual(checkpointState(state, inventory), state);
  for (const change of [v => { v.schemaVersion = 'unknown'; }, v => { v.releases[v2.releaseDigest].sourceVersion = 'module-native-v1'; },
    v => { v.releases[v2.releaseDigest].sourceAddress = a(9); }, v => { v.releases[v2.releaseDigest].nextBlock = '1e20'; },
    v => { v.releases[h(99)] = v.releases[v2.releaseDigest]; }, v => { v.releases[v2.releaseDigest].blockHash = '0x'; }]) {
    const value = structuredClone(state); change(value); assert.throws(() => checkpointState(value, inventory));
  }
  assert.throws(() => checkpointState({ ...legacy, releaseDigest: v2.releaseDigest }, inventory), /historical V1/);
});

function eventLog(abi, eventName, args, index, source, receipt) {
  const event = abi.find(item => item.type === 'event' && item.name === eventName), fields = event.inputs.filter(item => !item.indexed);
  return { address: source, topics: encodeEventTopics({ abi, eventName, args }), data: encodeAbiParameters(fields, fields.map(field => args[field.name])),
    removed: false, transactionHash: receipt.transactionHash, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, logIndex: toHex(index) };
}
test('V2 token identity binds the real additional event and creator salt, without imposing it on V1', () => {
  const launch = { launchId: h(20), launchWallet: a(5) }, receipt = { transactionHash: h(21), blockHash: h(22), blockNumber: '0x64', logs: [] };
  const creatorSalt = h(23), graffiti = keccak256(encodeAbiParameters(parseAbiParameters('string,uint256,address,address,bytes32'),
    ['programmable.module-mode.native-token.v2', 4663n, v2.contracts.launcher.address, launch.launchWallet, creatorSalt]));
  receipt.logs = [eventLog(NATIVE_IDENTITY_ABI, 'ModuleNativeTokenIdentityBound', { ...launch, creatorSalt, graffiti }, 3, v2.contracts.launcher.address, receipt)];
  assert.equal(bindNativeTokenIdentity(v2, launch, receipt, graffiti).logIndex, '0x3');
  assert.equal(bindNativeTokenIdentity(native, launch, { logs: [] }, graffiti), undefined);
  assert.throws(() => bindNativeTokenIdentity(v2, launch, receipt, h(24)), /identity/);
  const duplicate = structuredClone(receipt); duplicate.logs.push(duplicate.logs[0]);
  assert.throws(() => bindNativeTokenIdentity(v2, launch, duplicate, graffiti), /Expected one/);
  assert.throws(() => bindNativeTokenIdentity(v2, launch, { ...receipt, transactionHash: h(25) }, graffiti), /receipt/);
});
test('all release code/version reads use the same canonical hash and the actual V1, V2 or Engine getter', async () => {
  const snapshot = { blockHash: h(28), requireCanonical: true }, code = '0x6000';
  for (const original of [native, v2, engine]) {
    const release = { ...original, contracts: Object.fromEntries(Object.entries(original.contracts).map(([role, pin]) => [role, { ...pin, runtimeCodeHash: keccak256(code) }])) };
    const isEngine = original.sourceVersion === 'module-engine-v1', legacy = original.sourceVersion === 'module-native-v1';
    const abi = parseAbi([isEngine ? 'function SOURCE_VERSION() view returns (bytes32)' : legacy
      ? 'function launchIdentityVersion() view returns (uint256)' : 'function sourceVersion() view returns (string)']);
    const request = async calls => calls.map(call => {
      assert.deepEqual(call.params[1], snapshot);
      if (call.method === 'eth_getCode') return code;
      const decoded = decodeFunctionData({ abi, data: call.params[0].data });
      return encodeFunctionResult({ abi, functionName: decoded.functionName, result: isEngine ? keccak256(toHex('programmable.module-engine.evm.v1')) : legacy ? 1n : 'module-native-v2' });
    });
    assert.equal(Object.keys(await releaseCode(release, snapshot, { request })).length, Object.keys(release.contracts).length);
    await assert.rejects(releaseCode(release, snapshot, { request: async calls => calls.map(() => '0x6001') }), /code hash/);
  }
});
test('LP creation comes from the finalized mint receipt, not a mutable current owner lookup', () => {
  const abi = parseAbi(['event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
  const receipt = { transactionHash: h(29), blockHash: h(30), blockNumber: '0x64', logs: [] };
  const launched = { ...receipt, logIndex: '0x5' };
  receipt.logs.push(eventLog(abi, 'Transfer', { from: zeroAddress, to: a(10), tokenId: 7n }, 2, a(11), receipt));
  assert.equal(bindPositionMint(receipt, launched, a(11), 7n, a(10)), undefined);
  assert.throws(() => bindPositionMint(receipt, launched, a(11), 7n, a(12)), /recipient/);
  assert.throws(() => bindPositionMint(receipt, launched, a(13), 7n, a(10)), /unique mint/);
});

function reviewedPublication() {
  const { source, subject, plan, artifact } = structuredClone(frozen);
  const definition = { id: 'source-operator-fixture', title: 'Fixture engine', summary: 'Synthetic only.', detail: 'Not a public acceptance.',
    version: source.descriptor.version, interface: 'custom-v1', source: source.descriptor.source.files.find(item => item.path === artifact.engine.sourcePath),
    schema: source.descriptor.configuration, defaults: { cap: '5' }, configurationAbi: artifact.configurationAbi, constraints: [] };
  const revision = { packageId: artifact.packageId, familyId: artifact.familyId, fixedQuoteAsset: zeroAddress, fixedConfigurationHash: zeroHash,
    initialOperationId: zeroHash, executionGas: artifact.executionGas, moneyRights: artifact.moneyRights, coinRights: 0,
    operationPermissions: artifact.operationPermissions, eligibleFamilies: [artifact.familyId] };
  const manifest = wire.createReviewedModuleEngineManifest({ job: { artifact, plan }, descriptor: source.descriptor, release: engine, definition, revision });
  const manifestHash = wire.computeModuleEngineHostManifestHash(manifest);
  const contents = { schemaVersion: 'programmable.modules.review-decision.v1', reviewerWallet: a(999), policyDigest: h(55), subject,
    command: { schemaVersion: 'programmable.modules.review-command.v1', submissionId: subject.submissionId, requestDigest: subject.requestDigest,
      expectedReviewRevision: 2, outcome: 'accept', reason: 'Synthetic parser acceptance only, never publication authority.', artifactDigest: artifact.artifactDigest,
      hostManifestHash: manifestHash, acknowledgedReviewAreas: [...artifact.reviewRequired] }, decidedAt: '2026-09-07T01:00:00.000Z', registryApproved: false, available: false };
  const review = { ...contents, decisionDigest: wire.computeModuleReviewDecisionDigestV1(contents) };
  const publication = { template: { status: 'available', manifest, manifestHash, reviewDigest: review.decisionDigest }, requestDigest: subject.requestDigest,
    review, reviewedBuild: { subject, plan, artifact } };
  return { release: engine, publication, source, manifest, review };
}
function engineLaunchFixture() {
  const f = reviewedPublication(), manifest = f.manifest.manifest, e = manifest.source.engine, host = engine.contracts.host.address, creator = a(800);
  const p = { name: 'Synthetic source fixture', symbol: 'FIX', creatorSalt: h(30), revisionId: manifest.revision.packageId,
    quoteAsset: a(900), configuration: encodeAbiParameters(parseAbiParameters('uint64'), [5n]), creationCode: e.creationBytecode, runtimeTemplate: e.runtimeTemplate,
    engineSalt: h(31), launchData: '0x', metadata: { description: '', website: '', image: '', extraData: '0x' }, creatorWallets: [creator], creatorSharesBps: [10000],
    buyCreatorFeeBps: 0, sellCreatorFeeBps: 0, initialOperation: { operationId: zeroHash, actor: zeroAddress, recipient: zeroAddress, inputAsset: zeroAddress, inputAmount: 0n,
      outputAsset: zeroAddress, minimumOutput: 0n, deadline: 0n, nonce: 0n, data: '0x' } };
  const graffiti = keccak256(encodeAbiParameters(parseAbiParameters('string,address,bytes32'), ['programmable.module-engine.token.v1', creator, p.creatorSalt]));
  const token = getCreate2Address({ from: engine.contracts.tokenFactory.address, salt: keccak256(encodeAbiParameters(parseAbiParameters('string,string,uint8,address,bytes32'), [p.name, p.symbol, 18, host, graffiti])), bytecodeHash: engine.tokenCreationCodeHash });
  const configurationHash = keccak256(p.configuration), launchId = keccak256(encodeAbiParameters(parseAbiParameters('uint256,address,address,bytes32,bytes32'), [4663n, host, token, p.revisionId, configurationHash]));
  const context = { host, launchId, token, creator, quoteAsset: p.quoteAsset, feeCollector: host };
  const args = encodeAbiParameters(wire.moduleEngineConstructorParameters, [context, p.configuration]), creationCode = `${p.creationCode}${args.slice(2)}`;
  const runtime = wire.materializeModuleEngineRuntimeV1(e, args), engineAddress = getCreate2Address({ from: host,
    salt: keccak256(encodeAbiParameters(parseAbiParameters('address,bytes32,bytes32'), [creator, p.engineSalt, launchId])), bytecodeHash: keccak256(creationCode) });
  const event = { launchId, token, engine: engineAddress, creator, quoteAsset: p.quoteAsset, revisionId: p.revisionId, constructorHash: keccak256(args),
    initCodeHash: keccak256(creationCode), runtimeCodeHash: keccak256(runtime), configurationHash, resourcesHash: h(36), economicsPolicyId: engine.economicsPolicyId,
    planHash: keccak256(encodeAbiParameters(wire.moduleEnginePlanParameters, [4663n, host, creator, p])) };
  const receipt = { status: '0x1', transactionHash: h(40), blockNumber: '0x64', blockHash: h(41), logs: [] };
  receipt.logs = [eventLog(wire.moduleEngineHostAbi, 'EngineLaunchBound', event, 5, host, receipt), eventLog(wire.moduleEngineHostAbi,
    'EngineLaunchParametersBound', { launchId, encodedParameters: encodeAbiParameters(parseAbiParameters(`${wire.ENGINE_LAUNCH_PARAMETERS} parameters`), [p]) }, 6, host, receipt)];
  const revision = [{ ...manifest.revision, enabled: true, creationCodeHash: e.creationCodeHash, runtimeTemplateHash: e.runtimeTemplateHash, manifestHash: f.publication.template.manifestHash }, e.immutableRuntimeOffsets, e.immutableConstructorOffsets, manifest.revision.eligibleFamilies];
  return { ...f, receipt, log: receipt.logs[0], revision, args, runtime, creationCode, p, event };
}
test('Engine event/parameters, accepted code, revision and immutable constructor determine the actual deployment', () => {
  const f = engineLaunchFixture(), actual = engineLaunchIdentity(f, wire);
  assert.equal(actual.runtime, f.runtime); assert.equal(actual.constructorArguments, f.args); assert.equal(actual.creationCode, f.creationCode);
  for (const change of [v => { v.revision[0].manifestHash = h(70); }, v => { v.revision[0].creationCodeHash = h(71); },
    v => { v.revision[1] = []; }, v => { v.revision[2][0] += 32; }, v => { v.publication.template.manifest.manifest.source.engine.runtimeTemplate += '00'; },
    v => { v.receipt.logs[1].logIndex = '0x1'; }, v => { v.receipt.logs[1].transactionHash = h(72); },
    v => { v.publication.template.manifest.manifest.revision.fixedQuoteAsset = a(123); },
    v => { v.publication.template.manifest.manifest.revision.fixedConfigurationHash = h(73); }]) {
    const changed = structuredClone(f); change(changed); assert.throws(() => engineLaunchIdentity(changed, wire), undefined, change.toString());
  }
});
test('known settlement/escrow/quote resource hashes are exact; custom or extra resource data is closed', () => {
  const f = engineLaunchIdentity(engineLaunchFixture(), wire);
  assert.throws(() => engineResourceCommitment(f, {}), /explicit bound adapter/);
  const settlement = structuredClone(f); settlement.manifest.catalogDefinition.interface = 'settlement-v1';
  settlement.parameters.configuration = encodeAbiParameters(parseAbiParameters('uint256,uint256'), [60n, 2592000n]);
  settlement.launch.resourcesHash = keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint256,uint256'), [settlement.launch.quoteAsset, settlement.launch.creator, 60n, 2592000n]));
  assert.equal(engineResourceCommitment(settlement, { minimumWindow: 60n, maximumWindow: 2592000n }), settlement.launch.resourcesHash);
  assert.throws(() => engineResourceCommitment(settlement, { minimumWindow: 61n, maximumWindow: 2592000n }), /resources/);
  const escrow = structuredClone(f); escrow.manifest.catalogDefinition.interface = 'escrow-v1';
  escrow.parameters.configuration = encodeAbiParameters(parseAbiParameters('address,uint256'), [zeroAddress, 100n]);
  escrow.launch.resourcesHash = keccak256(encodeAbiParameters(parseAbiParameters('address,uint256'), [escrow.launch.quoteAsset, 100n]));
  assert.equal(engineResourceCommitment(escrow, { unlockTime: 100n }), escrow.launch.resourcesHash);
  escrow.parameters.launchData = '0x01'; assert.throws(() => engineResourceCommitment(escrow, { unlockTime: 100n }), /resource data/);
  const quote = structuredClone(f); quote.manifest.catalogDefinition.interface = 'quote-v1'; quote.manifest.revision.fixedConfigurationHash = h(51);
  const state = { positionTokenId: 4n, positionRecipient: a(1000), initialAbsoluteTick: 10000, quoteDecimals: 6, lockedTokenDust: 3n };
  const currencies = [quote.launch.token.toLowerCase(), quote.launch.quoteAsset.toLowerCase()].sort();
  state.poolId = keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint24,int24,address'), [...currencies, 0, 200, quote.launch.engine]));
  const tick = quote.launch.quoteAsset.toLowerCase() < quote.launch.token.toLowerCase() ? 10000 : -10000;
  quote.launch.resourcesHash = keccak256(encodeAbiParameters(parseAbiParameters('bytes32,uint256,address,int24,uint8,uint256'), [state.poolId, 4n, state.positionRecipient, tick, 6, 3n]));
  assert.equal(engineResourceCommitment(quote, state), quote.launch.resourcesHash);
  assert.throws(() => engineResourceCommitment(quote, { ...state, positionRecipient: a(1001) }), /resources hash/);
});

test('the published quote-bound settlement codec preserves its quote, fixed windows and exact source profile', async () => {
  const catalog = JSON.parse(await readFile(new URL('../../../config/module-engine/catalog.json', import.meta.url)));
  const definition = catalog.entries.find(entry => entry.template.manifest.manifest.catalogDefinition.id === 'quote-bound-settlement-v1')
    .template.manifest.manifest.catalogDefinition;
  const settlement = engineLaunchIdentity(engineLaunchFixture(), wire);
  settlement.manifest.catalogDefinition = structuredClone(definition);
  const abi = parseAbiParameters('address,uint256,uint256'), state = { minimumWindow: 60n, maximumWindow: 2592000n };
  settlement.parameters.configuration = encodeAbiParameters(abi, [settlement.launch.quoteAsset, state.minimumWindow, state.maximumWindow]);
  settlement.launch.resourcesHash = keccak256(encodeAbiParameters(parseAbiParameters('address,address,uint256,uint256'),
    [settlement.launch.quoteAsset, settlement.launch.creator, state.minimumWindow, state.maximumWindow]));
  assert.equal(engineResourceCommitment(settlement, state), settlement.launch.resourcesHash);
  for (const change of [
    value => { value.manifest.catalogDefinition.source.sha256 = '0'.repeat(64); },
    value => { value.manifest.catalogDefinition.source.path = 'src/OtherSettlement.sol'; },
    value => { value.manifest.catalogDefinition.configurationAbi[0].type = 'uint256'; },
    value => { value.manifest.catalogDefinition.configurationAbi.reverse(); },
    value => { value.parameters.configuration = encodeAbiParameters(abi, [a(999), 60n, 2592000n]); },
    value => { value.parameters.configuration = encodeAbiParameters(abi, [value.launch.quoteAsset, 61n, 2592000n]); },
    value => { value.parameters.configuration = encodeAbiParameters(abi, [value.launch.quoteAsset, 60n, 2592001n]); },
    value => { value.parameters.configuration = encodeAbiParameters(parseAbiParameters('uint256,uint256'), [60n, 2592000n]); },
    value => { value.parameters.configuration += '00'.repeat(32); },
    value => { value.launch.resourcesHash = h(999); },
  ]) {
    const changed = structuredClone(settlement); change(changed);
    assert.throws(() => engineResourceCommitment(changed, state), undefined, change.toString());
  }
  assert.throws(() => engineResourceCommitment(settlement, { ...state, maximumWindow: 2592001n }), /resources/);
});

test('the public Engine packet is verified by the same protected catalogue/build/manifest validators', async () => {
  const f = reviewedPublication();
  assert.equal(wire.verifyModuleEnginePublication(f).manifestHash, f.publication.template.manifestHash);
  const standard = wire.moduleEngineStandardInputV1(f.source, f.publication.reviewedBuild.subject, f.publication.reviewedBuild.plan);
  assert.equal(wire.reviewDigest('programmable.modules.compiler-input.v1', standard), f.publication.reviewedBuild.artifact.compiler.completeInputHash);
  const changed = structuredClone(f); changed.source.files[0].bytes = Buffer.from('changed').toString('base64');
  assert.throws(() => wire.verifyModuleEnginePublication(changed), /source bytes/);
  const changedManifest = structuredClone(f); changedManifest.manifest.manifest.source.compiler.completeInputHash = h(90);
  assert.throws(() => wire.verifyModuleEnginePublication(changedManifest));
});
test('deduplicated provider AST ids may relabel only identical full offset groups, never slots or values', () => {
  const value = { runtimeBytecode: { immutableReferences: { 100: [{ start: 1, length: 32 }, { start: 33, length: 32 }], 200: [{ start: 65, length: 32 }] },
    transformations: [{ id: '900', type: 'replace', offset: 1, reason: 'immutable' }, { id: '900', type: 'replace', offset: 33, reason: 'immutable' },
      { id: '800', type: 'replace', offset: 65, reason: 'immutable' }], transformationValues: { immutables: { 900: h(1), 800: h(2) } } } };
  const aligned = alignPublishedImmutableIds(value);
  assert.deepEqual(aligned.bindings, { 100: '900', 200: '800' });
  assert.deepEqual(aligned.value.runtimeBytecode.immutableReferences['900'], value.runtimeBytecode.immutableReferences['100']);
  assert.deepEqual(aligned.value.runtimeBytecode.transformationValues, value.runtimeBytecode.transformationValues);
  assert.equal(value.runtimeBytecode.immutableReferences['900'], undefined, 'raw provider result remains unchanged');
  for (const mutate of [v => { v.runtimeBytecode.transformations.pop(); }, v => { v.runtimeBytecode.transformations[0].offset++; },
    v => { v.runtimeBytecode.transformations[0].reason = 'cborAuxdata'; }, v => { v.runtimeBytecode.transformations[1].id = '800'; },
    v => { v.runtimeBytecode.immutableReferences['100'][0].length = 31; }, v => { v.runtimeBytecode.transformations.push(v.runtimeBytecode.transformations[0]); }]) {
    const bad = structuredClone(value); mutate(bad); assert.throws(() => alignPublishedImmutableIds(bad));
  }
});
test('exact reviewed Engine source compiles locally and provider comparison retains every immutable and version-trailer byte',
  { skip: !process.env.MODULE_MODE_SOLC }, async () => {
    const f = reviewedPublication(), responses = { source: f.source, manifest: f.manifest, review: f.review }, methods = [];
    const fetchPublic = async (url, init) => { methods.push(init.method); return Response.json(responses[String(url).split('/').at(-1).replace('.json', '')]); };
    const build = await engineBuild({ release: engine }, f.publication, { wire, fetchPublic, binary: process.env.MODULE_MODE_SOLC });
    assert.deepEqual(methods, ['GET', 'GET', 'GET']);
    const launch = engineLaunchFixture(), e = f.publication.reviewedBuild.artifact.engine;
    const target = { ...build, address: launch.event.engine, runtime: launch.runtime, creationCode: launch.creationCode, constructorArguments: launch.args,
      transactionHash: launch.receipt.transactionHash, creation: { transactionHash: launch.receipt.transactionHash, blockNumber: '100', transactionIndex: '2', transactionSender: launch.event.creator } };
    const refs = build.artifact.evm.deployedBytecode.immutableReferences, transforms = Object.entries(refs).flatMap(([id, ranges]) => ranges.map(ref => ({ id, type: 'replace', offset: ref.start, reason: 'immutable' })));
    const value = { chainId: '4663', address: target.address, match: 'match', creationMatch: 'match', runtimeMatch: 'match', matchId: '1', verifiedAt: '2026-09-07T00:00:00Z',
      compilation: { language: 'Solidity', compiler: 'solc', compilerVersion: frozen.artifact.compiler.version, name: build.name, fullyQualifiedName: `${build.file}:${build.name}`,
        compilerSettings: build.input.settings }, stdJsonInput: build.input, sources: build.input.sources, metadata: JSON.parse(build.artifact.metadata), abi: build.artifact.abi,
      deployment: { ...target.creation, deployer: target.creation.transactionSender },
      creationBytecode: { recompiledBytecode: e.creationBytecode, onchainBytecode: target.creationCode, cborAuxdata: {}, linkReferences: {}, transformations: [{ type: 'insert', offset: (e.creationBytecode.length - 2) / 2, reason: 'constructorArguments' }], transformationValues: { constructorArguments: target.constructorArguments } },
      runtimeBytecode: { recompiledBytecode: e.runtimeTemplate, onchainBytecode: target.runtime, cborAuxdata: {}, linkReferences: {}, immutableReferences: refs, transformations: transforms,
        transformationValues: { immutables: Object.fromEntries(Object.entries(refs).map(([id, [ref]]) => [id, `0x${target.runtime.slice(2 + ref.start * 2, 2 + (ref.start + 32) * 2)}`])) } } };
    assert.equal(validatePublished(target, value).runtimeCodeHash, keccak256(launch.runtime));
    const relabelled = structuredClone(value);
    relabelled.runtimeBytecode.immutableReferences = Object.fromEntries(Object.entries(refs).map(([id, ranges]) => [String(Number(id) + 100000), ranges]));
    assert.equal(validatePublished(target, relabelled).runtimeCodeHash, keccak256(launch.runtime));
    const wrongValue = structuredClone(relabelled); wrongValue.runtimeBytecode.transformationValues.immutables[Object.keys(refs)[0]] = h(999);
    assert.throws(() => validatePublished(target, wrongValue), /immutable values/);
    assert.ok(e.runtimeTemplate.endsWith('a164736f6c634300081a000a'), 'actual pinned solc version trailer is included');
    const changed = structuredClone(value); changed.runtimeBytecode.onchainBytecode = `${changed.runtimeBytecode.onchainBytecode.slice(0, -2)}00`;
    assert.throws(() => validatePublished(target, changed), /complete creation\/runtime/);
    let writes = 0;
    const missing = await ensurePublished(target, false, { fetchPublic: async (_, init) => { if (init.method === 'POST') writes++; return new Response(null, { status: 404 }); } });
    assert.equal(missing.status, 'not-published'); assert.equal(writes, 0);
    await assert.rejects(ensurePublished(target, true, { fetchPublic: async (_, init) => { if (init.method === 'POST') writes++; return new Response(null, { status: 404 }); } }), /snapshot recheck required/);
    await assert.rejects(ensurePublished({ ...target, creation: undefined }, true, { fetchPublic: async () => { writes++; throw new Error('must not call'); } }), /Bound source/);
    assert.equal(writes, 0);
  });

test('actual creation evidence rejects receipt, sender transaction and canonical block substitutions', async () => {
  const receipt = { status: '0x1', transactionHash: h(10), blockHash: h(11), blockNumber: '0x64', transactionIndex: '0x2', logs: [] };
  const transaction = { hash: h(10), from: a(9), blockHash: h(11), blockNumber: '0x64', transactionIndex: '0x2' };
  const block = { hash: h(11), number: '0x64' };
  const rpc = async calls => calls.map(call => call.method === 'eth_getTransactionReceipt' ? receipt : call.method === 'eth_getTransactionByHash' ? transaction : block);
  assert.equal((await creationEvidence(h(10), rpc)).creation.transactionSender, a(9));
  transaction.transactionIndex = '0x3'; await assert.rejects(creationEvidence(h(10), rpc), /receipt\/transaction/);
  transaction.transactionIndex = '0x2'; block.hash = h(12); await assert.rejects(creationEvidence(h(10), rpc), /canonical/);
});
test('one generation failure cannot overwrite another digest checkpoint; inventory scanning uses each real event filter', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'module-source-profiles-'));
  try {
    const f = files(), last = BigInt(v2.startBlock) + 2n, head = last + 5n, blockHash = h(81), headHash = h(82), requests = [], stateFile = path.join(root, 'state.json');
    let changedSnapshot = false;
    for (const [kind, dir] of [['native', 'module-mode'], ['engine', 'module-engine']]) {
      const destination = path.join(root, 'config', dir); await mkdir(destination, { recursive: true });
      for (const [name, value] of [[kind === 'native' ? 'robinhood.preview.json' : 'robinhood.json', f[kind].current], ['catalog.json', f[kind].catalog], ['historical-releases.json', f[kind].history]])
        await writeFile(path.join(destination, name), JSON.stringify(value));
    }
    const request = async calls => calls.map(call => { requests.push(call); if (call.method === 'eth_chainId') return '0x1237';
      if (call.method === 'eth_getBlockByNumber') {
        const selected = call.params[0];
        if (selected === 'latest') return { number: toHex(head), hash: headHash };
        if (selected === toHex(head)) return { number: toHex(head), hash: changedSnapshot ? h(83) : headHash };
        return { number: selected === 'finalized' ? toHex(last) : selected, hash: blockHash };
      }
      if (call.method === 'eth_getLogs') { if (call.params[0].address === engine.contracts.host.address) throw new Error('Synthetic engine provider failure'); return []; }
      throw new Error(`Unexpected call ${call.method}`); });
    const result = await run(parseOptions(['--publish', '--state-file', stateFile]), { root, request, fetchPublic: async () => { throw new Error('No launch, no source write'); } });
    assert.equal(result.status, 'failed');
    assert.equal(result.releases.find(x => x.sourceVersion === 'module-engine-v1').status, 'failed');
    const state = JSON.parse(await readFile(stateFile));
    assert.equal(Object.keys(state.releases).length, 2);
    assert.equal(state.releases[engine.releaseDigest], undefined);
    for (const r of [native, v2]) assert.equal(state.releases[r.releaseDigest].releaseDigest, r.releaseDigest);
    const filters = requests.filter(x => x.method === 'eth_getLogs').map(x => x.params[0]);
    assert.equal(filters.length, 3); assert.equal(filters.find(x => x.address === engine.contracts.host.address).topics[0], sourceProfile(engine, wire).topic);
    assert.match(result.observation.assurance, /not-quorum/);
    assert.equal(result.observation.runtimeSnapshot.blockNumber, String(head));
    assert.notEqual(result.observation.runtimeSnapshot.blockHash, result.observation.finalizedScan.blockHash);
    changedSnapshot = true; await rm(stateFile);
    const failed = await run(parseOptions(['--publish', '--state-file', stateFile]), { root, request, fetchPublic: async () => { throw new Error('No source write'); } });
    assert.equal(failed.status, 'failed');
    assert.ok(failed.releases.filter(x => x.sourceVersion !== 'module-engine-v1').every(x => x.error.includes('snapshot changed')));
    await assert.rejects(readFile(stateFile), { code: 'ENOENT' });
    for (const args of [[], ['--publish']]) {
      const withoutCheckpoint = await run(parseOptions(args), { root, request, fetchPublic: async () => { throw new Error('No launch, no source write'); } });
      assert.equal(withoutCheckpoint.status, 'failed');
      assert.ok(withoutCheckpoint.releases.filter(x => x.sourceVersion !== 'module-engine-v1').every(x => x.error.includes('snapshot changed after source readback')));
    }
    changedSnapshot = false; requests.length = 0;
    const historical = await run(parseOptions(['--from-block', native.startBlock, '--to-block', String(BigInt(native.startBlock) + 2n)]), { root, request });
    const newer = historical.releases.find(x => x.sourceVersion === 'module-native-v2');
    assert.equal(newer.status, 'verified'); assert.ok(newer.range.from > newer.range.to);
    assert.ok(requests.filter(x => x.method === 'eth_getLogs').every(x => BigInt(x.params[0].fromBlock) < BigInt(v2.startBlock)));
    assert.equal(historical.releases.find(x => x.sourceVersion === 'module-native-v1').status, 'verified');
  } finally { await rm(root, { recursive: true, force: true }); }
});
