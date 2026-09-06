import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { decodeAbiParameters, keccak256, stringToHex } from 'viem';
import { validateOpenPackage, compileOpenConfig } from '../../../src/open-packages.mjs';
import { loadOpenSourcePackage } from '../../../src/open-package-io.mjs';
import { moduleSubmissionFromPack, validateModuleSubmissionRequest, parseModuleSubmissionJSON } from '../../../src/open-transport.mjs';
import { encodeRewardConfiguration, encodeReclaimInputs, CONFIG_ABI, RECLAIM_UNUSED } from './config-codec.mjs';
import { prepareDescriptor, readSource, FIXTURE_IDENTITY } from './prepare.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = async (name) => JSON.parse(await readFile(resolve(root, name), 'utf8'));

test('complete source package validates, packs and becomes only inert API source bytes', async () => {
  const descriptor = await json('module.json');
  assert.equal(Object.hasOwn(descriptor.source, 'repository'), false);
  assert.equal(Object.hasOwn(descriptor.source, 'revision'), false);
  assert.deepEqual(descriptor.configuration, await json('config.schema.json'));
  const syntax = validateOpenPackage(descriptor);
  assert.equal(syntax.ok, true, JSON.stringify(syntax.errors));
  const pack = await loadOpenSourcePackage(root, 'module.json');
  assert.equal(pack.localFileHashesVerified, true);
  const request = moduleSubmissionFromPack(pack);
  assert.deepEqual(Object.keys(request).sort(), ['descriptor', 'files', 'format']);
  const result = parseModuleSubmissionJSON(JSON.stringify(request));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.packageId, syntax.packageId);
  assert.equal(result.familyId, syntax.familyId);
  assert.equal(result.reviewStatus, 'unreviewed');
  for (const evidence of ['sourceRevisionVerified', 'authorAuthenticated', 'buildVerified', 'runtimeVerified', 'onchainApproved', 'available']) {
    assert.equal(result[evidence], false, evidence);
  }
  assert.equal(result.totalSourceBytes, pack.files.reduce((sum, file) => sum + Buffer.from(file.bytes, 'base64').length, 0));
  assert.ok(result.totalSourceBytes <= 16 * 1024 * 1024 && pack.files.length <= 128);
});

test('altering uploaded source bytes fails the actual submission validator', async () => {
  const request = moduleSubmissionFromPack(await loadOpenSourcePackage(root, 'module.json'));
  request.files[0].bytes = Buffer.from('tampered bytes').toString('base64');
  const result = validateModuleSubmissionRequest(request);
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'MODULE_FILE_HASH');
});

test('every bundled host dependency is byte-for-byte pinned to its declared source revision', async () => {
  const pins = await json('SOURCE-PINS.json');
  const repositoryRoot = resolve(root, '../../../..');
  assert.equal(pins.files.length, 11);
  for (const pin of pins.files) {
    const bytes = await readSource(root, pin.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256, pin.path);
    assert.match(pin.revision, /^[0-9a-f]{40}$/);
    if (pin.repository === 'https://github.com/programmablehq/PROGRAMMABLE') {
      assert.deepEqual(bytes, await readFile(resolve(repositoryRoot, pin.sourcePath)), `Canonical source drift: ${pin.path}`);
    }
  }
});

test('configuration explicitly encodes the six contract fields rather than lexical record order', async () => {
  const schema = await json('config.schema.json');
  const values = await json('configuration.fixture.json');
  const { config, configHash, normalized } = encodeRewardConfiguration(schema, values, 1_000_000);
  assert.equal((config.length - 2) / 2, 192);
  assert.equal(configHash, keccak256(config));
  assert.deepEqual(decodeAbiParameters(CONFIG_ABI, config), [
    3, 10_000_000_000_000_000n, 1_000_000_000_000_000n, 2_000_000_000n, false,
    '0x3333333333333333333333333333333333333333',
  ]);
  assert.deepEqual(normalized, values);
  assert.notEqual(compileOpenConfig(schema, values).encoded, config);
  assert.throws(() => encodeRewardConfiguration(schema, { ...values, refundWallet: `0x${'0'.repeat(40)}` }, 1), /nonzero/);
  assert.throws(() => encodeRewardConfiguration(schema, values, 2_000_000_000), /after/);
  assert.throws(() => encodeRewardConfiguration(schema, { ...values, everyN: '0' }, 1));
  assert.throws(() => encodeRewardConfiguration(schema, { ...values, rewardNative: '340282366920938463463374607431768211456' }, 1));
  assert.throws(() => encodeRewardConfiguration(schema, values, Number.MAX_SAFE_INTEGER + 1));
});

test('managed action has exactly zero-byte inputs and an exact declared action identifier', async () => {
  const descriptor = await json('module.json');
  const action = descriptor.management.actions[0];
  assert.equal(action.role, 'refund-wallet');
  assert.equal(action.id, 'reclaim-unused');
  assert.equal(encodeReclaimInputs({}), '0x');
  assert.notEqual(compileOpenConfig(action.inputs, {}).encoded, '0x');
  assert.equal(RECLAIM_UNUSED.length, 66);
  const binding = await json('runtime-binding.json');
  assert.equal(RECLAIM_UNUSED, keccak256(stringToHex(binding.actions[action.id].actionIdKeccakUtf8)));
  assert.equal(binding.actions[action.id].inputs, '0x');
  assert.equal(binding.configuration.bytes, 192);
  assert.deepEqual(binding.configuration.orderedFields, CONFIG_ABI.map(({ name }) => name));
  assert.throws(() => encodeReclaimInputs({ recipient: FIXTURE_IDENTITY.author }), /empty/);
});

test('fixture identity cannot silently become a real contributor descriptor', async () => {
  await assert.rejects(prepareDescriptor(root), /Replace fixture/);
  await assert.rejects(prepareDescriptor(root, FIXTURE_IDENTITY), /Replace fixture/);
  await assert.rejects(prepareDescriptor(root, { author: FIXTURE_IDENTITY.author }, { fixture: true }), /cannot be combined/);
});

test('copied source needs no Git metadata and regenerates author-bound identity and all hashes', async () => {
  const temp = await mkdtemp(resolve(tmpdir(), 'programmable-native-starter-'));
  try {
    const original = await loadOpenSourcePackage(root, 'module.json');
    for (const file of original.files) {
      await mkdir(dirname(resolve(temp, file.path)), { recursive: true });
      await writeFile(resolve(temp, file.path), Buffer.from(file.bytes, 'base64'));
    }
    const identity = {
      author: '0x4444444444444444444444444444444444444444',
      rewardWallet: '0x5555555555555555555555555555555555555555',
      familySalt: `0x${'ab'.repeat(32)}`,
    }; // Test values only; no account ownership is claimed.
    const prepared = await prepareDescriptor(temp, identity);
    assert.equal(prepared.fixtureOnly, false);
    const copy = await loadOpenSourcePackage(temp, 'module.json');
    assert.notEqual(copy.packageId, original.packageId);
    assert.notEqual(copy.familyId, original.familyId);
    assert.equal(copy.descriptor.author, identity.author);
    assert.equal(copy.authorAuthenticated, false);
    assert.equal(validateModuleSubmissionRequest(moduleSubmissionFromPack(copy)).ok, true);
    const path = 'REVIEW.md';
    await writeFile(resolve(temp, path), `${await readFile(resolve(temp, path), 'utf8')}\nChanged candidate review.\n`);
    await assert.rejects(loadOpenSourcePackage(temp, 'module.json'), (error) => error.code === 'OPEN_SOURCE_HASH');
    await prepareDescriptor(temp, identity);
    const revised = await loadOpenSourcePackage(temp, 'module.json');
    assert.notEqual(revised.packageId, copy.packageId);
    assert.equal(revised.familyId, copy.familyId);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('local preparation rejects traversal, symlink sources and oversized files before packaging', async () => {
  const temp = await mkdtemp(resolve(tmpdir(), 'programmable-native-paths-'));
  try {
    await writeFile(resolve(temp, 'source.txt'), 'source');
    await symlink(resolve(temp, 'source.txt'), resolve(temp, 'linked.txt'));
    await assert.rejects(readSource(temp, '../outside'), /below/);
    await assert.rejects(readSource(temp, 'linked.txt'), /Symlink/);
    await assert.rejects(readSource(temp, 'source.txt', 1), /oversized/);
    assert.equal((await readSource(temp, 'source.txt')).toString(), 'source');
  } finally { await rm(temp, { recursive: true, force: true }); }
});
