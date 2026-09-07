import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { encodeAbiParameters, encodeEventTopics, keccak256, parseAbi, parseAbiParameters, toHex as textHex, zeroAddress } from 'viem';
import { parseOptions, patchImmutables, scanRange, validatePublished, boundLaunchBatch, resolveCreationTransactions } from './verify-launch-source.mjs';
import { canonicalJson } from './core.mjs';

const address = `0x${'12'.repeat(20)}`;
const release = { chainId: 4663, startBlock: '100', releaseDigest: `0x${'34'.repeat(32)}`, contracts: { launcher: { address } } };

test('publication and checkpoint writes are explicit', () => {
  assert.equal(parseOptions([]).publish, false);
  assert.throws(() => parseOptions(['--state-file', '/tmp/state.json']), /require --publish/);
  assert.throws(() => parseOptions(['--publish', '--state-file', '/tmp/state.json', '--from-block', '100']), /override/);
  assert.throws(() => parseOptions(['--max-blocks', '1000001']), /between/);
  assert.throws(() => parseOptions(['--max-launches', '0']), /between/);
  assert.throws(() => parseOptions(['--from-block', '-1']), /scan block range/);
  assert.throws(() => parseOptions(['--from-block', '101', '--to-block', '100']), /scan block range/);
  assert.throws(() => parseOptions(['--token', 'oops']), /Invalid token/);
  assert.throws(() => parseOptions(['--submit']), /Unknown/);
  assert.equal(parseOptions(['--publish', '--state-file', '/tmp/state.json']).publish, true);
});

test('scan checkpoints bind the active release and never include unfinalized logs', () => {
  const options = parseOptions(['--max-blocks', '20']);
  assert.deepEqual(scanRange(release, options, 150n), { from: 100n, to: 119n, finalized: 150n, caughtUp: false });
  const state = { schemaVersion: 'programmable.module-mode-launch-source-checkpoint.v1', chainId: 4663, releaseDigest: release.releaseDigest, launcher: address, nextBlock: '140', blockHash: `0x${'78'.repeat(32)}` };
  assert.deepEqual(scanRange(release, options, 150n, state), { from: 140n, to: 150n, finalized: 150n, caughtUp: true });
  assert.throws(() => scanRange(release, options, 150n, { ...state, releaseDigest: 'old' }), /different release/);
  assert.throws(() => scanRange(release, options, 150n, { ...state, blockHash: undefined }), /block hash/);
  assert.throws(() => scanRange(release, { ...options, fromBlock: 99n }, 150n), /precede/);
  assert.throws(() => scanRange(release, { ...options, toBlock: 151n }, 150n), /unfinalized/);
});

test('runtime substitution accepts only compiler-declared immutable slots', () => {
  const artifact = { evm: { deployedBytecode: { object: `11${'00'.repeat(32)}22`, immutableReferences: { 7: [{ start: 1, length: 32 }] } } } };
  const compilation = { sources: { 'Token.sol': { ast: { nodes: [{ nodeType: 'VariableDeclaration', mutability: 'immutable', id: 7, name: 'creator' }] } } } };
  assert.equal(patchImmutables(artifact, compilation, { creator: address }), `0x11${address.slice(2).padStart(64, '0')}22`);
  assert.throws(() => patchImmutables(artifact, compilation, { owner: address }), /Unexpected immutable/);
  assert.throws(() => patchImmutables(artifact, compilation, { creator: address, operator: address }), /absent/);
  assert.throws(() => patchImmutables({ evm: { deployedBytecode: { ...artifact.evm.deployedBytecode, immutableReferences: { 7: [{ start: 1, length: 1 }] } } } }, compilation, { creator: address }), /offset/);
});

test('large batches advance through complete blocks without skipping launches', () => {
  const range = { from: 100n, to: 200n, finalized: 200n, caughtUp: true };
  const logs = [100, 101, 101, 102].map(block => ({ blockNumber: toHex(block) }));
  assert.deepEqual(boundLaunchBatch(logs, range, 2), [logs[0]]);
  assert.equal(range.to, 100n);
  assert.equal(range.caughtUp, false);
  assert.throws(() => boundLaunchBatch(logs.slice(1), { ...range, from: 101n }, 1), /single block/);
});

function toHex(value) { return `0x${value.toString(16)}`; }

test('scheduled publication uses production, read-only repository access and a checked compiler', () => {
  const workflow = readFileSync(new URL('../../../.github/workflows/verify-module-launch-sources.yml', import.meta.url), 'utf8');
  assert.match(workflow, /cron: '17 \* \* \* \*'/);
  assert.match(workflow, /github\.repository == 'programmablehq\/PROGRAMMABLE' && github\.ref == 'refs\/heads\/production'/);
  assert.match(workflow, /permissions:\n  contents: read/);
  assert.doesNotMatch(workflow, /(?:issues|actions|contents|id-token): write|secrets\./);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /d5f23436f443edb85d8e76906d12f0a86ce0490e7663a9e608efeb7a93f149ef/);
  assert.match(workflow, /sha256sum --check --status/);
  assert.match(workflow, /--publish/);
  assert.match(workflow, /--max-launches 100/);
  assert.match(workflow, /--state-file \.module-source-state\/checkpoint\.json/);
  for (const match of workflow.matchAll(/uses: ([^\s]+)/g)) assert.match(match[1], /@[a-f0-9]{40}$/);
});

export function publishedFixture() {
  const transactionHash = `0x${'56'.repeat(32)}`, sourceCommit = 'a'.repeat(40);
  const input = { language: 'Solidity', sources: { 'Token.sol': { content: '// synthetic source, never onchain\ncontract Token {}' } },
    settings: { optimizer: { enabled: true, runs: 1000 }, evmVersion: 'cancun', metadata: { appendCBOR: false, bytecodeHash: 'none' }, libraries: {}, remappings: [] } };
  const metadata = { compiler: { version: '0.8.26+commit.8a97fa7a' }, settings: { compilationTarget: { 'Token.sol': 'Token' } } };
  const creation = { transactionHash, blockNumber: '123', transactionIndex: '2', transactionSender: address };
  const target = { role: 'token', address, file: 'Token.sol', name: 'Token', input, transactionHash, creation, sourceCommit,
    constructorArguments: '0x', creationCode: '0x1122', runtime: '0x3344', artifact: { abi: [], metadata: JSON.stringify(metadata),
      evm: { bytecode: { object: '1122' }, deployedBytecode: { object: '3344', immutableReferences: {} } } } };
  const value = { chainId: '4663', address, match: 'match', creationMatch: 'match', runtimeMatch: 'match', matchId: '12',
    compilation: { language: 'Solidity', compiler: 'solc', compilerVersion: '0.8.26+commit.8a97fa7a', name: 'Token', fullyQualifiedName: 'Token.sol:Token', compilerSettings: input.settings },
    stdJsonInput: structuredClone(input), metadata, abi: [], sources: input.sources, deployment: { ...creation, deployer: address },
    creationBytecode: { onchainBytecode: '0x1122', recompiledBytecode: '0x1122', cborAuxdata: {}, linkReferences: {}, transformations: [], transformationValues: {} },
    runtimeBytecode: { onchainBytecode: '0x3344', recompiledBytecode: '0x3344', cborAuxdata: {}, linkReferences: {}, immutableReferences: {}, transformations: [], transformationValues: {} },
    verifiedAt: '2026-09-07T00:00:00Z' };
  return { target, value };
}
test('an omitted empty library default needs the exact pinned provider recompilation and never permits links', () => {
  const { target, value } = publishedFixture();
  value.compilation.compilerSettings = structuredClone(value.compilation.compilerSettings);
  delete value.compilation.compilerSettings.libraries;
  delete value.stdJsonInput.settings.libraries;
  const proof = { compilerVersion: '0.8.26+commit.8a97fa7a', inputDigest: keccak256(textHex(canonicalJson(value.stdJsonInput))),
    creationBytecode: '0x1122', runtimeBytecode: '0x3344', abi: [] };
  assert.throws(() => validatePublished(target, value), /exact pinned recompilation/);
  assert.equal(validatePublished(target, value, proof).providerCompilerDefaultBinding, 'omitted-empty-library-map-after-exact-recompilation');
  assert.deepEqual(target.input.settings.libraries, {});
  for (const altered of [{ ...proof, compilerVersion: '0.8.25' }, { ...proof, inputDigest: `0x${'00'.repeat(32)}` },
    { ...proof, creationBytecode: '0x1123' }, { ...proof, runtimeBytecode: '0x3345' }, { ...proof, abi: [{}] }]) {
    assert.throws(() => validatePublished(target, value, altered), /exact pinned recompilation/);
  }
  const mismatched = structuredClone(value); mismatched.stdJsonInput.settings.libraries = {};
  assert.throws(() => validatePublished(target, mismatched, proof), /input\/settings disagree/);
  const linked = structuredClone(target); linked.artifact.evm.bytecode.linkReferences = { 'Lib.sol': {} };
  assert.throws(() => validatePublished(linked, value, proof), /exact pinned recompilation/);
  const configured = structuredClone(target); configured.input.settings.libraries = { 'Lib.sol': { Library: address } };
  assert.throws(() => validatePublished(configured, value, proof), /compiler settings differ/);
  const providerLink = structuredClone(value); providerLink.runtimeBytecode.linkReferences = { 'Lib.sol': {} };
  assert.throws(() => validatePublished(target, providerLink, proof), /library link/);
});
test('provider flags cannot replace the shared complete creation/runtime, settings, metadata and actual transaction proof', () => {
  const { target, value } = publishedFixture();
  assert.equal(validatePublished(target, value).comparison, 'exact-complete-creation-and-runtime');
  const changes = [v => { v.chainId = '1'; }, v => { v.runtimeMatch = null; }, v => { v.sources = {}; },
    v => { v.deployment.transactionHash = `0x${'00'.repeat(32)}`; }, v => { v.deployment.blockNumber = '124'; },
    v => { v.deployment.transactionIndex = '3'; }, v => { v.runtimeBytecode.onchainBytecode = '0x3345'; },
    v => { v.creationBytecode.onchainBytecode += '00'; }, v => { v.compilation.compilerSettings.optimizer.runs++; },
    v => { v.metadata.settings.compilationTarget = {}; }, v => { v.runtimeBytecode.transformations = [{ reason: 'cborAuxdata' }]; }];
  for (const change of changes) { const altered = structuredClone(value); change(altered); assert.throws(() => validatePublished(target, altered)); }
  assert.throws(() => validatePublished({ ...target, creation: undefined }, value), /Actual creation/);
});
test('provider id-space alignment still rejects a different immutable value or missing transformation', () => {
  const { target, value } = publishedFixture(), word = `0x${address.slice(2).padStart(64, '0')}`;
  const template = `11${'00'.repeat(32)}22`, runtime = `0x11${word.slice(2)}22`;
  target.runtime = runtime; target.artifact.evm.deployedBytecode = { object: template, immutableReferences: { 7: [{ start: 1, length: 32 }] } };
  value.runtimeBytecode = { ...value.runtimeBytecode, recompiledBytecode: `0x${template}`, onchainBytecode: runtime,
    immutableReferences: { 900: [{ start: 1, length: 32 }] }, transformations: [{ id: '700', type: 'replace', offset: 1, reason: 'immutable' }],
    transformationValues: { immutables: { 700: word } } };
  assert.deepEqual(validatePublished(target, value).providerImmutableIdRelabelling, { 900: '700' });
  const changed = structuredClone(value); changed.runtimeBytecode.transformationValues.immutables['700'] = `0x${'ff'.repeat(32)}`;
  assert.throws(() => validatePublished(target, changed), /immutable values/);
  changed.runtimeBytecode.transformationValues.immutables['700'] = word;
  changed.runtimeBytecode.transformationValues.immutables['701'] = word;
  assert.throws(() => validatePublished(target, changed), /immutable values/);
  const missing = structuredClone(value); missing.runtimeBytecode.transformations = [];
  assert.throws(() => validatePublished(target, missing), /Incomplete immutable/);
});

function forwarderFixture(sameTransaction = false) {
  const factory = `0x${'21'.repeat(20)}`, positionManager = `0x${'43'.repeat(20)}`;
  const launchWallet = `0x${'65'.repeat(20)}`, forwarder = `0x${'87'.repeat(20)}`;
  const salt = `0x${'a9'.repeat(32)}`, launchTransaction = `0x${'cb'.repeat(32)}`;
  const creationTransaction = sameTransaction ? launchTransaction : `0x${'ed'.repeat(32)}`;
  const launchBlockHash = `0x${'19'.repeat(32)}`, creationBlockHash = sameTransaction ? launchBlockHash : `0x${'39'.repeat(32)}`;
  const configurationHash = keccak256(encodeAbiParameters(parseAbiParameters('uint256,address,address,address,address,uint256,address'),
    [4663n, factory, forwarder, positionManager, zeroAddress, (1n << 256n) - 1n, launchWallet]));
  const abi = parseAbi(['event LockedPositionFeeForwarderDeployed(address indexed forwarder,address indexed feeRecipient,bytes32 indexed salt,bytes32 configurationHash,address positionManager)']);
  const creationLog = { address: factory, blockNumber: toHex(sameTransaction ? 100 : 75), blockHash: creationBlockHash,
    transactionHash: creationTransaction, logIndex: '0x2', removed: false,
    topics: encodeEventTopics({ abi, args: { forwarder, feeRecipient: launchWallet, salt } }),
    data: encodeAbiParameters(parseAbiParameters('bytes32,address'), [configurationHash, positionManager]) };
  const input = { release: { ...release, contracts: { ...release.contracts, positionForwarderFactory: { address: factory }, positionManager: { address: positionManager } } },
    launch: { positionRecipient: forwarder, launchWallet }, launchLog: { transactionHash: launchTransaction, blockNumber: '0x64', blockHash: launchBlockHash, logIndex: '0x9' },
    launchReceipt: { status: '0x1', transactionHash: launchTransaction, blockNumber: '0x64', blockHash: launchBlockHash, logs: sameTransaction ? [creationLog] : [] },
    salt, configurationHash, factoryDeploymentBlock: 50n };
  const receipt = { status: '0x1', transactionHash: creationTransaction, blockNumber: creationLog.blockNumber, blockHash: creationBlockHash, logs: [creationLog] };
  return { input, creationLog, receipt, block: { number: creationLog.blockNumber, hash: creationBlockHash } };
}

test('a forwarder created before launch keeps its own verified creation transaction', async () => {
  const fixture = forwarderFixture();
  const requests = [];
  const result = await resolveCreationTransactions(fixture.input, async calls => {
    requests.push(calls);
    return requests.length === 1 ? [[fixture.creationLog]] : [fixture.receipt, fixture.block];
  });
  assert.deepEqual(result, { token: fixture.input.launchLog.transactionHash, forwarder: fixture.creationLog.transactionHash });
  assert.notEqual(result.token, result.forwarder);
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], [{ method: 'eth_getLogs', params: [{ address: fixture.input.release.contracts.positionForwarderFactory.address,
    fromBlock: '0x32', toBlock: '0x64', topics: fixture.creationLog.topics }] }]);
  assert.deepEqual(requests[1], [
    { method: 'eth_getTransactionReceipt', params: [result.forwarder] },
    { method: 'eth_getBlockByNumber', params: ['0x4b', false] },
  ]);
});

test('a forwarder created during launch reuses the verified launch receipt without history reads', async () => {
  const fixture = forwarderFixture(true);
  const result = await resolveCreationTransactions(fixture.input, async () => assert.fail('Unexpected historical read'));
  assert.deepEqual(result, { token: fixture.input.launchLog.transactionHash, forwarder: fixture.input.launchLog.transactionHash });
});

test('forwarder creation requires the correct factory, configuration, ordering and successful canonical receipt', async () => {
  const fixture = forwarderFixture();
  const fakeRpc = (logs, receipt = fixture.receipt, block = fixture.block) => async calls => calls[0].method === 'eth_getLogs' ? [logs] : [receipt, block];
  await assert.rejects(resolveCreationTransactions({ ...fixture.input, configurationHash: `0x${'00'.repeat(32)}` }, async () => assert.fail('Unexpected RPC')), /factory configuration/);
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([])), /exactly one/);
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([fixture.creationLog, fixture.creationLog])), /exactly one/);
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([{ ...fixture.creationLog, address: zeroAddress }])), /factory range/);
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([{ ...fixture.creationLog, blockNumber: '0x31' }])), /factory range/);
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([{ ...fixture.creationLog, blockNumber: '0x64', logIndex: '0xa' }])), /precede/);
  const wrongConfiguration = { ...fixture.creationLog, data: encodeAbiParameters(parseAbiParameters('bytes32,address'), [fixture.input.configurationHash, zeroAddress]) };
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([wrongConfiguration])), /event configuration/);
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([fixture.creationLog], { ...fixture.receipt, status: '0x0' })), /receipt differs/);
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([fixture.creationLog], { ...fixture.receipt, transactionHash: fixture.input.launchLog.transactionHash })), /receipt differs/);
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([fixture.creationLog], { ...fixture.receipt, logs: [] })), /receipt differs/);
  await assert.rejects(resolveCreationTransactions(fixture.input, fakeRpc([fixture.creationLog], fixture.receipt, { ...fixture.block, hash: fixture.input.launchLog.blockHash })), /no longer canonical/);
});
