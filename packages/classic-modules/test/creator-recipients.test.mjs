import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { concatHex, decodeFunctionData, encodeAbiParameters, hexToBytes, keccak256, parseAbi } from 'viem';
import { buildCreatorSplit, encodeCreatorTakeover, CREATOR_SPLIT_DOMAIN, MAX_CREATOR_SPLIT_RECIPIENTS,
  ClassicModuleError } from '../src/index.mjs';
import { runCli } from '../src/cli.mjs';

const vector = JSON.parse(await fs.readFile(new URL('./creator-split-vector-v1.json', import.meta.url), 'utf8'));
const wallet = (number) => `0x${BigInt(number).toString(16).padStart(40, '0')}`;
const ZERO = wallet(0);
const ZERO_HASH = `0x${'0'.repeat(64)}`;
const MAX_UINT256 = (1n << 256n) - 1n;
const takeoverInput = () => ({ ledger: wallet(99), poolId: `0x${'12'.repeat(32)}`,
  newWallets: [wallet(2), wallet(1), wallet(2)], expectedAdminRevision: '7', deadline: '2000000000' });
const independentTakeoverAbi = parseAbi([
  'function replaceCreatorWallets(bytes32 poolId,address[] newWallets,uint256 expectedAdminRevision,uint256 deadline)',
]);
function solidityLeaf({ index, wallet, shareBps }) {
  const encoded = encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint16' }],
    [vector.domain, BigInt(index), wallet, Number(shareBps)],
  );
  return keccak256(keccak256(encoded));
}
function recoverRoot(row, overrides = {}) {
  const changed = { ...row, ...overrides };
  let hash = solidityLeaf(changed);
  for (const sibling of changed.proof) {
    hash = keccak256(concatHex(BigInt(hash) <= BigInt(sibling) ? [hash, sibling] : [sibling, hash]));
  }
  return hash;
}
async function temporary(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'classic-creator-recipients-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function cli(root, args) {
  let stdout = ''; let stderr = '';
  const status = await runCli([...args, '--root', root], {
    stdout: { write(value) { stdout += value; } }, stderr: { write(value) { stderr += value; } },
  });
  return { status, stdout, stderr };
}

test('fixed cross-stack vector binds sorted rows, domain, double-hashed leaves and zero padding', () => {
  const original = structuredClone(vector.input);
  const split = buildCreatorSplit(original);
  assert.equal(CREATOR_SPLIT_DOMAIN, vector.domain);
  assert.equal(split.root, '0xa029c704c340ede99fcfb05f026675438f4546abed551eb9e0feea8f5c1ff122');
  assert.deepEqual(split, vector.expected);
  assert.deepEqual(original, vector.input, 'input order is never mutated');
  assert.deepEqual(JSON.parse(JSON.stringify(split)), split, 'all output fields are JSON-safe');
  assert.equal(split.recipients[2].proof[0], ZERO_HASH, 'third leaf is paired with bytes32(0)');
  for (const row of split.recipients) {
    assert.equal(solidityLeaf(row), row.leaf);
    assert.equal(recoverRoot(row), split.root);
  }
});
test('allocation bytes use address20 plus big-endian uint16 in strictly ascending wallet order', () => {
  const split = buildCreatorSplit(vector.input);
  const bytes = hexToBytes(split.allocations);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(bytes.length, split.recipientCount * 22);
  for (let index = 0; index < split.recipientCount; index++) {
    const address = `0x${Buffer.from(bytes.slice(index * 22, index * 22 + 20)).toString('hex')}`;
    assert.equal(address, split.recipients[index].wallet);
    assert.equal(view.getUint16(index * 22 + 20, false), Number(split.recipients[index].shareBps));
    if (index > 0) assert.ok(BigInt(address) > BigInt(split.recipients[index - 1].wallet));
  }
});
test('one recipient has a leaf root and an empty proof', () => {
  const split = buildCreatorSplit([{ wallet: wallet(1), shareBps: 10_000n }]);
  assert.equal(split.recipientCount, 1);
  assert.equal(split.root, split.recipients[0].leaf);
  assert.deepEqual(split.recipients[0].proof, []);
  assert.equal(split.recipients[0].shareBps, '10000');
  assert.equal(split.allocations, `${wallet(1)}2710`);
});
test('all 1000 recipient proofs verify in ten steps and altered claim tuples fail', () => {
  const rows = Array.from({ length: 1000 }, (_, index) => ({ wallet: wallet(1000 - index), shareBps: 10 }));
  const split = buildCreatorSplit(rows);
  assert.equal(MAX_CREATOR_SPLIT_RECIPIENTS, 1000);
  assert.equal(split.recipientCount, 1000);
  assert.equal(hexToBytes(split.allocations).length, 22_000);
  for (const row of split.recipients) {
    assert.equal(row.proof.length, 10);
    assert.equal(recoverRoot(row), split.root);
    assert.notEqual(recoverRoot(row, { shareBps: '11' }), split.root);
  }
  for (const row of [split.recipients[0], split.recipients[500], split.recipients[999]]) {
    assert.notEqual(recoverRoot(row, { index: String((Number(row.index) + 1) % 1000) }), split.root);
    assert.notEqual(recoverRoot(row, { wallet: wallet(9999) }), split.root);
    assert.notEqual(recoverRoot(row, { proof: row.proof.slice(1) }), split.root);
    assert.notEqual(recoverRoot(row, { proof: [...row.proof, ZERO_HASH] }), split.root);
  }
});
test('recipient counts outside 1 through 1000 and malformed array shapes are rejected', () => {
  const recipient = { wallet: wallet(1), shareBps: '10000' };
  const sparse = Array(1);
  const extended = [recipient]; extended.extra = 'unexpected';
  const symbol = [recipient]; symbol[Symbol('extra')] = true;
  class OtherArray extends Array {}
  for (const input of [undefined, null, {}, recipient, [], Array(1001).fill(recipient), sparse, extended, symbol, new OtherArray(recipient)]) {
    assert.throws(() => buildCreatorSplit(input), { code: 'CREATOR_SPLIT_COUNT' });
  }
});
test('nonzero wallet addresses are required and duplicate normalization cannot create two claims', () => {
  for (const invalid of [ZERO, undefined, null, '', wallet(1).slice(0, -1), `${wallet(1)}00`, ` ${wallet(1)}`,
    '0xgg00000000000000000000000000000000000000', '0x52908400098527886e0F7030069857D2E4169EE7']) {
    assert.throws(() => buildCreatorSplit([{ wallet: invalid, shareBps: 10_000 }]), { code: 'INVALID_ADDRESS' });
  }
  const lower = '0x52908400098527886e0f7030069857d2e4169ee7';
  const checked = '0x52908400098527886E0F7030069857D2E4169EE7';
  assert.equal(buildCreatorSplit([{ wallet: checked, shareBps: 10_000 }]).recipients[0].wallet, lower);
  assert.throws(() => buildCreatorSplit([{ wallet: lower, shareBps: 5000 }, { wallet: checked, shareBps: 5000 }]),
    { code: 'CREATOR_SPLIT_DUPLICATE' });
});
test('positive integer shares must total exactly 10000 without coercion or truncation', () => {
  for (const invalid of ['010000', '1e4', '10000.0', '0x2710', '+10000', ' 10000', '10000 ', '', '-1',
    -1, -0, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, true, false, null, {}, [], 10_000.1]) {
    assert.throws(() => buildCreatorSplit([{ wallet: wallet(1), shareBps: invalid }]), { code: 'INVALID_INTEGER' });
  }
  assert.throws(() => buildCreatorSplit([{ wallet: wallet(1), shareBps: 0 }]), { code: 'CREATOR_SPLIT_SHARE' });
  for (const invalid of [10_001, 65_536, MAX_UINT256]) {
    assert.throws(() => buildCreatorSplit([{ wallet: wallet(1), shareBps: invalid }]), { code: 'INTEGER_RANGE' });
  }
  for (const shares of [[4999, 5000], [5001, 5000]]) {
    assert.throws(() => buildCreatorSplit(shares.map((shareBps, index) => ({ wallet: wallet(index + 1), shareBps }))),
      { code: 'CREATOR_SPLIT_SHARE_TOTAL' });
  }
});
test('unknown fields, inherited data and accessors cannot enter the allocation commitment', () => {
  let executed = false;
  const accessor = { shareBps: 10_000, get wallet() { executed = true; return wallet(1); } };
  const arrayAccessor = [];
  Object.defineProperty(arrayAccessor, '0', { get() { executed = true; return { wallet: wallet(1), shareBps: 10_000 }; } });
  for (const invalid of [{ wallet: wallet(1), shareBps: 10_000, admin: wallet(2) },
    { wallet: wallet(1) }, Object.create({ wallet: wallet(1), shareBps: 10_000 }), accessor,
    { wallet: wallet(1), shareBps: 10_000, [Symbol('extra')]: 'ignored?' }]) {
    assert.throws(() => buildCreatorSplit([invalid]), { code: 'CREATOR_SPLIT_RECIPIENT' });
  }
  assert.throws(() => buildCreatorSplit(arrayAccessor), { code: 'CREATOR_SPLIT_COUNT' });
  assert.equal(executed, false);
});
test('takeover ABI preserves slot order, duplicate destinations, revision and deadline', () => {
  const input = takeoverInput();
  const transaction = encodeCreatorTakeover(input);
  assert.deepEqual(Object.keys(transaction), ['target', 'data', 'value']);
  assert.equal(transaction.target, input.ledger);
  assert.equal(transaction.value, '0');
  const decoded = decodeFunctionData({ abi: independentTakeoverAbi, data: transaction.data });
  assert.equal(decoded.functionName, 'replaceCreatorWallets');
  assert.deepEqual(decoded.args, [input.poolId, input.newWallets, 7n, 2_000_000_000n]);
  assert.notEqual(encodeCreatorTakeover({ ...input, expectedAdminRevision: '8' }).data, transaction.data);
  assert.notEqual(encodeCreatorTakeover({ ...input, deadline: '2000000001' }).data, transaction.data);
  assert.deepEqual(JSON.parse(JSON.stringify(transaction)), transaction);
});
test('takeover accepts one through ten destinations and the complete uint256 revision range', () => {
  for (const count of [1, 10]) {
    const transaction = encodeCreatorTakeover({ ...takeoverInput(), newWallets: Array(count).fill(wallet(1)),
      expectedAdminRevision: count === 1 ? '0' : MAX_UINT256.toString(), deadline: MAX_UINT256 });
    const { args } = decodeFunctionData({ abi: independentTakeoverAbi, data: transaction.data });
    assert.equal(args[1].length, count);
    assert.equal(args[2], count === 1 ? 0n : MAX_UINT256);
    assert.equal(args[3], MAX_UINT256);
  }
  for (const newWallets of [[], Array(11).fill(wallet(1)), [wallet(1), , wallet(2)], 'wallet']) {
    assert.throws(() => encodeCreatorTakeover({ ...takeoverInput(), newWallets }), { code: 'CREATOR_TAKEOVER_SLOTS' });
  }
});
test('takeover rejects malformed or ambiguous targets, integers and fee-rate fields', () => {
  for (const ledger of [ZERO, '0x123', null]) {
    assert.throws(() => encodeCreatorTakeover({ ...takeoverInput(), ledger }), { code: 'INVALID_ADDRESS' });
  }
  for (const poolId of [ZERO_HASH, `0x${'12'.repeat(31)}`, 'pool']) {
    assert.throws(() => encodeCreatorTakeover({ ...takeoverInput(), poolId }), { code: 'INVALID_POOL_ID' });
  }
  assert.throws(() => encodeCreatorTakeover({ ...takeoverInput(), newWallets: [ZERO] }), { code: 'INVALID_ADDRESS' });
  for (const key of ['expectedAdminRevision', 'deadline']) {
    for (const value of ['01', '0x1', '1e9', ' 1', '-1', -0, 1.1, null, true, Number.MAX_SAFE_INTEGER + 1]) {
      assert.throws(() => encodeCreatorTakeover({ ...takeoverInput(), [key]: value }), { code: 'INVALID_INTEGER' });
    }
    assert.throws(() => encodeCreatorTakeover({ ...takeoverInput(), [key]: MAX_UINT256 + 1n }), { code: 'INTEGER_RANGE' });
  }
  assert.throws(() => encodeCreatorTakeover({ ...takeoverInput(), deadline: '0' }), { code: 'INVALID_DEADLINE' });
  assert.throws(() => encodeCreatorTakeover({ ...takeoverInput(), newFeeBps: 100 }), { code: 'CREATOR_TAKEOVER_INPUT' });
  const missing = takeoverInput(); delete missing.expectedAdminRevision;
  assert.throws(() => encodeCreatorTakeover(missing), { code: 'CREATOR_TAKEOVER_INPUT' });
  let executed = false;
  const accessor = takeoverInput();
  Object.defineProperty(accessor, 'deadline', { get() { executed = true; return 2_000_000_000; } });
  assert.throws(() => encodeCreatorTakeover(accessor), { code: 'CREATOR_TAKEOVER_INPUT' });
  assert.equal(executed, false);
  assert.throws(() => encodeCreatorTakeover({ ...takeoverInput(), deadline: '0' }), ClassicModuleError);
});
test('prepare-creator-split CLI writes the fixed vector exclusively without signing or deployment', async (t) => {
  const root = await temporary(t);
  await fs.writeFile(path.join(root, 'recipients.json'), JSON.stringify(vector.input));
  const bin = new URL('../bin/programmable-classic-modules.mjs', import.meta.url).pathname;
  const result = spawnSync(process.execPath, [bin, 'prepare-creator-split', '--root', root,
    '--recipients', 'recipients.json', '--out', 'split.json'], { encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { ok: true, scope: 'local-only', output: 'split.json',
    root: vector.expected.root, recipientCount: 3 });
  const saved = await fs.readFile(path.join(root, 'split.json'), 'utf8');
  assert.deepEqual(JSON.parse(saved), vector.expected);
  const repeat = await cli(root, ['prepare-creator-split', '--recipients', 'recipients.json', '--out', 'split.json']);
  assert.equal(repeat.status, 1); assert.match(repeat.stderr, /Output exists/);
  assert.equal(await fs.readFile(path.join(root, 'split.json'), 'utf8'), saved);
});
test('creator split CLI rejects unsafe paths and symlink inputs or outputs', async (t) => {
  const root = await temporary(t);
  await fs.writeFile(path.join(root, 'recipients.json'), JSON.stringify(vector.input));
  await fs.symlink(path.join(root, 'recipients.json'), path.join(root, 'input-link.json'));
  await fs.symlink(path.join(root, 'recipients.json'), path.join(root, 'output-link.json'));
  for (const [input, output] of [['../recipients.json', 'split.json'], ['recipients.json', '../split.json'],
    ['input-link.json', 'split.json'], ['recipients.json', 'output-link.json']]) {
    const result = await cli(root, ['prepare-creator-split', '--recipients', input, '--out', output]);
    assert.equal(result.status, 1);
    assert.match(JSON.parse(result.stderr).errors[0].code, /UNSAFE_PATH|ELOOP|EMLINK/);
  }
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, 'recipients.json'), 'utf8')), vector.input);
});
test('creator split CLI bounds JSON bytes and refuses malformed data and unsupported actions', async (t) => {
  const root = await temporary(t);
  for (const [name, content, expected] of [
    ['large.json', ' '.repeat(256 * 1024 + 1), 'FILE_LIMIT'],
    ['invalid.json', '[', 'INVALID_JSON'],
    ['invalid-utf8.json', Buffer.from([0xff]), 'INVALID_JSON'],
    ['wrapper.json', JSON.stringify({ recipients: vector.input }), 'CREATOR_SPLIT_COUNT'],
    ['extra.json', JSON.stringify([{ ...vector.input[0], deployment: 'approve' }]), 'CREATOR_SPLIT_RECIPIENT'],
  ]) {
    await fs.writeFile(path.join(root, name), content);
    const result = await cli(root, ['prepare-creator-split', '--recipients', name, '--out', 'split.json']);
    assert.equal(result.status, 1, name);
    assert.equal(JSON.parse(result.stderr).errors[0].code, expected, name);
  }
  const unsupported = await cli(root, ['prepare-creator-split', '--recipients', 'wrapper.json', '--out', 'split.json', '--deploy', 'true']);
  assert.equal(unsupported.status, 1); assert.match(unsupported.stderr, /Invalid or duplicate option/);
  const missing = await cli(root, ['prepare-creator-split', '--out', 'split.json']);
  assert.equal(missing.status, 1); assert.match(missing.stderr, /Missing --recipients/);
  await assert.rejects(fs.stat(path.join(root, 'split.json')), { code: 'ENOENT' });
});
