import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parseOptions, patchImmutables, scanRange, validatePublished, boundLaunchBatch } from './verify-launch-source.mjs';

const address = `0x${'12'.repeat(20)}`;
const release = { chainId: 4663, startBlock: '100', releaseDigest: `0x${'34'.repeat(32)}`, contracts: { launcher: { address } } };

test('publication and checkpoint writes are explicit', () => {
  assert.equal(parseOptions([]).publish, false);
  assert.throws(() => parseOptions(['--state-file', '/tmp/state.json']), /require --publish/);
  assert.throws(() => parseOptions(['--publish', '--state-file', '/tmp/state.json', '--from-block', '100']), /override/);
  assert.throws(() => parseOptions(['--max-blocks', '1000001']), /between/);
  assert.throws(() => parseOptions(['--max-launches', '0']), /between/);
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

test('provider match cannot replace exact address, deployment, source and byte comparisons', () => {
  const transactionHash = `0x${'56'.repeat(32)}`;
  const target = { role: 'token', address, file: 'Token.sol', name: 'Token', input: { sources: { 'Token.sol': { content: 'contract Token {}' } } }, transactionHash, creationCode: '0x1122', runtime: '0x3344', artifact: { evm: { bytecode: { object: '1122' }, deployedBytecode: { object: '3344' } } } };
  const value = { chainId: '4663', address, match: 'match', creationMatch: 'match', runtimeMatch: 'match', compilation: { compilerVersion: '0.8.26+commit.8a97fa7a', fullyQualifiedName: 'Token.sol:Token' }, sources: target.input.sources, deployment: { transactionHash }, creationBytecode: { onchainBytecode: '0x1122', recompiledBytecode: '0x1122' }, runtimeBytecode: { onchainBytecode: '0x3344', recompiledBytecode: '0x3344' }, verifiedAt: '2026-09-07T00:00:00Z' };
  assert.equal(validatePublished(target, value).comparison, 'exact-complete-creation-and-runtime');
  assert.throws(() => validatePublished(target, { ...value, chainId: '1' }), /chain\/address/);
  assert.throws(() => validatePublished(target, { ...value, runtimeMatch: null }), /creation\/runtime match/);
  assert.throws(() => validatePublished(target, { ...value, sources: {} }), /source closure/);
  assert.throws(() => validatePublished(target, { ...value, deployment: { transactionHash: `0x${'00'.repeat(32)}` } }), /transaction/);
  assert.throws(() => validatePublished(target, { ...value, runtimeBytecode: { ...value.runtimeBytecode, onchainBytecode: '0x3345' } }), /runtime bytecode/);
  assert.throws(() => validatePublished(target, { ...value, creationBytecode: { ...value.creationBytecode, onchainBytecode: '0x112200' } }), /creation bytecode/);
});
