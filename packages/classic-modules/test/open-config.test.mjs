import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAbiParameters, encodeAbiParameters } from 'viem';
import { canonicalJson } from '../src/canonical-json.mjs';
import { assertOpenConfigSchema, compileOpenConfig, OpenConfigError, OPEN_CONFIG_LIMITS } from '../src/open-config.mjs';

const ACCOUNT = '0x1111111111111111111111111111111111111111';
const QUOTE = '0x2222222222222222222222222222222222222222';
const VAULT = '0x3333333333333333333333333333333333333333';
const CHECKSUM = '0x52908400098527886E0F7030069857D2E4169EE7';
const ZERO = `0x${'0'.repeat(40)}`;
const record = (fields, required = Object.keys(fields)) => ({ type: 'record', fields, required });
const array = (items, maxItems = 10, minItems = 0) => ({ type: 'array', items, maxItems, minItems });
const uint = (extra = {}) => ({ type: 'uint', ...extra });
const context = () => ({ roles: { creator: ACCOUNT }, assets: { quote: { chainId: 4663, address: QUOTE, decimals: 6 } }, components: { vault: VAULT } });
const decode = (compiled) => decodeAbiParameters(compiled.abiParameters, compiled.encoded)[0];
function error(action, code, path) {
  assert.throws(action, (caught) => {
    assert.ok(caught instanceof OpenConfigError);
    assert.equal(caught.code, code);
    if (path !== undefined) assert.equal(caught.path, path);
    return true;
  });
}

test('nested configuration round-trips sorted ABI fields, lists and bound references', () => {
  const schema = record({
    vault: { type: 'component' }, asset: { type: 'asset' },
    allocations: array(record({ weight: uint({ bits: 16, min: 1, max: 10_000, unit: 'bps' }), recipient: { type: 'account' } }), 3, 1),
    memo: { type: 'string', maxLength: 16 }, enabled: { type: 'bool' },
  }, ['allocations', 'vault', 'asset', 'enabled']);
  const values = { enabled: false, vault: { component: 'vault' }, asset: { asset: 'quote' }, allocations: [
    { weight: '0003000', recipient: { role: 'creator' } }, { weight: 7000, recipient: { address: CHECKSUM } },
  ] };
  const compiled = compileOpenConfig(schema, values, context());
  assert.deepEqual(compiled.abiParameters[0].components.map((field) => field.name), ['allocations', 'asset', 'enabled', 'memo', 'vault']);
  assert.deepEqual(decode(compiled), {
    allocations: [{ recipient: ACCOUNT, weight: 3000 }, { recipient: CHECKSUM, weight: 7000 }],
    asset: QUOTE, enabled: false, memo: { present: false, value: '' }, vault: VAULT,
  });
  assert.deepEqual(compiled.value.allocations, [
    { recipient: { role: 'creator' }, weight: '3000' }, { recipient: { address: CHECKSUM.toLowerCase() }, weight: '7000' },
  ]);
  assert.equal(Object.hasOwn(compiled.value, 'memo'), false);
  assert.deepEqual(compiled.bindings, [
    { path: '/allocations/0/recipient', kind: 'account', reference: 'creator', resolved: ACCOUNT },
    { path: '/asset', kind: 'asset', reference: 'quote', resolved: { chainId: '4663', address: QUOTE, decimals: 6 } },
    { path: '/vault', kind: 'component', reference: 'vault', resolved: VAULT },
  ]);
  assert.equal(compiled.encoded, encodeAbiParameters(compiled.abiParameters, compiled.abiValues));
  assert.equal(canonicalJson(compiled.value), JSON.stringify(compiled.value));
});

test('record/schema insertion order and required-list order do not change compilation', () => {
  const first = record({ z: { type: 'account' }, a: array(uint(), 2), optional: { type: 'bool' } }, ['z', 'a']);
  const second = record({ optional: { type: 'bool' }, a: array(uint(), 2), z: { type: 'account' } }, ['a', 'z']);
  const left = compileOpenConfig(first, { z: { role: 'creator' }, a: [1, '02'] }, context());
  const right = compileOpenConfig(second, { a: ['01', 2], z: { role: 'creator' } }, context());
  assert.deepEqual(left, right);
  assert.notEqual(left.encoded, compileOpenConfig(first, { a: [2, 1], z: { role: 'creator' } }, context()).encoded);
  assert.deepEqual(left, compileOpenConfig({ ...first, help: 'Presentation only' }, { a: [1, 2], z: { role: 'creator' } }, context()));
});

test('absent optional fields have explicit false flags and type-level zero payloads', () => {
  const schema = record({
    flag: { type: 'bool' }, amount: uint({ min: '10' }), list: array(uint(), 3, 2),
    nested: record({ owner: { type: 'account' }, delay: uint({ min: 60 }) }),
  }, []);
  const compiled = compileOpenConfig(schema, {});
  assert.deepEqual(compiled.value, {});
  assert.deepEqual(decode(compiled), {
    amount: { present: false, value: 0n }, flag: { present: false, value: false },
    list: { present: false, value: [] }, nested: { present: false, value: { delay: 0n, owner: ZERO } },
  });
  assert.deepEqual(compiled.bindings, []);
  error(() => compileOpenConfig(schema, { amount: 0 }), 'OPEN_CONFIG_UINT_RANGE', '/amount');
  error(() => compileOpenConfig(schema, { list: [] }), 'OPEN_CONFIG_ARRAY_LIMIT', '/list');
  error(() => compileOpenConfig(schema, { nested: {} }), 'OPEN_CONFIG_REQUIRED', '/nested/owner');
});

test('zero, false, empty bytes, empty string and empty list are distinct from omission', () => {
  for (const [field, value] of [[uint(), 0], [{ type: 'bool' }, false], [{ type: 'bytes', maxLength: 0 }, '0x'],
    [{ type: 'string', maxLength: 0 }, ''], [array(uint(), 0), []], [record({}), {}]]) {
    const schema = record({ setting: field }, []);
    const absent = compileOpenConfig(schema, {});
    const present = compileOpenConfig(schema, { setting: value });
    assert.notEqual(absent.encoded, present.encoded);
    assert.equal(decode(present).setting.present, true);
    assert.equal(decode(absent).setting.present, false);
  }
});

test('variants use sorted branch indexes and an independently decodable branch tuple', () => {
  const fixed = record({ amount: uint({ bits: 64 }), recipient: { type: 'account' }, memo: { type: 'string', maxLength: 8 } }, ['amount', 'recipient']);
  const schema = { type: 'variant', tag: 'mode', variants: { vested: record({ duration: uint() }), fixed } };
  const compiled = compileOpenConfig(schema, { recipient: { role: 'creator' }, mode: 'fixed', amount: '9007199254740993' }, context());
  const outer = decode(compiled);
  assert.equal(outer.index, 0);
  const expected = compileOpenConfig(fixed, { amount: '9007199254740993', recipient: { role: 'creator' } }, context());
  assert.equal(outer.data, expected.encoded);
  assert.deepEqual(decodeAbiParameters(expected.abiParameters, outer.data)[0], {
    amount: 9007199254740993n, memo: { present: false, value: '' }, recipient: ACCOUNT,
  });
  assert.deepEqual(compiled.value, { amount: '9007199254740993', mode: 'fixed', recipient: { role: 'creator' } });
  assert.equal(compiled.bindings[0].path, '/recipient');
  const swapped = { ...schema, variants: { fixed, vested: schema.variants.vested } };
  assert.deepEqual(compiled, compileOpenConfig(swapped, compiled.value, context()));
  assert.equal(decode(compileOpenConfig(schema, { mode: 'vested', duration: 60 })).index, 1);
  error(() => compileOpenConfig(schema, { mode: 'fixed', duration: 60 }), 'OPEN_CONFIG_UNKNOWN_FIELD', '/duration');
  error(() => compileOpenConfig(schema, { mode: 'absent' }), 'OPEN_CONFIG_VARIANT_TAG', '/mode');
  error(() => compileOpenConfig(schema, {}), 'OPEN_CONFIG_VARIANT_TAG', '/mode');
});

test('nested, optional and empty variants preserve presence and branch identity', () => {
  const choice = { type: 'variant', tag: 'kind', variants: { zero: record({}), one: record({ choice: uint() }) } };
  const schema = record({ selected: choice }, []);
  const absent = compileOpenConfig(schema, {});
  const empty = compileOpenConfig(schema, { selected: { kind: 'zero' } });
  const nonempty = compileOpenConfig(schema, { selected: { kind: 'one', choice: 0 } });
  assert.notEqual(absent.encoded, empty.encoded);
  assert.notEqual(empty.encoded, nonempty.encoded);
  assert.deepEqual(decode(absent).selected, { present: false, value: { index: 0, data: '0x' } });
  assert.deepEqual(decode(empty).selected, { present: true, value: { index: 1, data: `0x${'0'.repeat(64)}` } });
  const nested = compileOpenConfig(array(array(choice, 2), 2), [[{ kind: 'zero' }], [{ kind: 'one', choice: 1 }]]);
  assert.equal(decode(nested)[1][0].index, 0);
});

test('uint256 decimal normalization never rounds through JavaScript numbers', () => {
  const maximum = ((1n << 256n) - 1n).toString();
  for (const value of [maximum, '9007199254740993', Number.MAX_SAFE_INTEGER, '0000']) {
    const compiled = compileOpenConfig(uint(), value);
    assert.equal(compiled.value, BigInt(value).toString());
    assert.equal(decode(compiled), BigInt(value));
  }
  for (let bits = 8; bits <= 256; bits += 8) {
    const value = ((1n << BigInt(bits)) - 1n).toString();
    const compiled = compileOpenConfig(uint({ bits }), value);
    assert.equal(compiled.abiParameters[0].type, `uint${bits}`);
    assert.equal(BigInt(decode(compiled)), BigInt(value));
  }
  for (const value of ['-1', '+1', '1.5', '1e3', ' 1', '', '0x10']) error(() => compileOpenConfig(uint(), value), 'OPEN_CONFIG_UINT', '');
  error(() => compileOpenConfig(uint(), (1n << 256n).toString()), 'OPEN_CONFIG_UINT_RANGE', '');
  for (const value of [2 ** 53, NaN, Infinity, -0, 0.5]) error(() => compileOpenConfig(uint(), value), 'OPEN_CONFIG_NUMBER', '');
  error(() => compileOpenConfig(uint(), 1n), 'OPEN_CONFIG_JSON_TYPE', '');
  error(() => compileOpenConfig(uint(), -1), 'OPEN_CONFIG_UINT', '');
  error(() => compileOpenConfig(uint({ bits: 8 }), '256'), 'OPEN_CONFIG_UINT_RANGE', '');
  error(() => compileOpenConfig(uint({ min: '10', max: '20', unit: 'quote.raw' }), '9'), 'OPEN_CONFIG_UINT_RANGE', '');
  assert.equal(compileOpenConfig(uint({ min: '0010', max: 20, unit: 'quote.raw' }), '00010').value, '10');
});

test('address literals, roles, assets and components are explicit distinct input types', () => {
  assert.equal(compileOpenConfig({ type: 'address' }, CHECKSUM).value, CHECKSUM.toLowerCase());
  const explicit = compileOpenConfig({ type: 'account' }, { address: CHECKSUM });
  assert.deepEqual(explicit.value, { address: CHECKSUM.toLowerCase() });
  assert.deepEqual(explicit.bindings, []);
  assert.equal(compileOpenConfig({ type: 'address' }, ZERO).value, ZERO);
  error(() => compileOpenConfig({ type: 'address' }, { role: 'creator' }, context()), 'OPEN_CONFIG_ADDRESS', '');
  error(() => compileOpenConfig({ type: 'account' }, ACCOUNT), 'OPEN_CONFIG_TYPE', '');
  error(() => compileOpenConfig({ type: 'account' }, { role: 'creator', address: ACCOUNT }, context()), 'OPEN_CONFIG_UNKNOWN_FIELD', '/address');
  error(() => compileOpenConfig({ type: 'asset' }, { address: QUOTE }, context()), 'OPEN_CONFIG_UNKNOWN_FIELD', '/address');
  error(() => compileOpenConfig({ type: 'component' }, { role: 'vault' }, context()), 'OPEN_CONFIG_UNKNOWN_FIELD', '/role');
  error(() => compileOpenConfig({ type: 'address' }, '0x52908400098527886E0F7030069857D2E4169Ee7'), 'OPEN_CONFIG_ADDRESS', '');
  const reference = compileOpenConfig({ type: 'account' }, { role: 'namespace.creator' }, { roles: { 'namespace.creator': ACCOUNT } });
  assert.deepEqual(reference.bindings, [{ path: '', kind: 'account', reference: 'namespace.creator', resolved: ACCOUNT }]);
});

test('reference contexts reject missing roles, wrong domains and malformed metadata', () => {
  error(() => compileOpenConfig({ type: 'account' }, { role: 'creator' }), 'OPEN_CONFIG_UNRESOLVED_REFERENCE', '');
  error(() => compileOpenConfig({ type: 'account' }, { role: 'vault' }, context()), 'OPEN_CONFIG_UNRESOLVED_REFERENCE', '');
  error(() => compileOpenConfig({ type: 'component' }, { component: 'creator' }, context()), 'OPEN_CONFIG_UNRESOLVED_REFERENCE', '');
  error(() => compileOpenConfig({ type: 'asset' }, { asset: 'quote' }, { roles: { quote: QUOTE } }), 'OPEN_CONFIG_UNRESOLVED_REFERENCE', '');
  error(() => compileOpenConfig(uint(), 1, { admin: ACCOUNT }), 'OPEN_CONFIG_UNKNOWN_FIELD', '/context/admin');
  error(() => compileOpenConfig(uint(), 1, { roles: [] }), 'OPEN_CONFIG_CONTEXT', '/context/roles');
  error(() => compileOpenConfig(uint(), 1, { roles: { creator: { address: ACCOUNT } } }), 'OPEN_CONFIG_ADDRESS', '/context/roles/creator');
  error(() => compileOpenConfig(uint(), 1, { assets: { quote: { address: QUOTE, decimals: 6 } } }), 'OPEN_CONFIG_REQUIRED', '/context/assets/quote/chainId');
  for (const [change, code, field] of [[{ chainId: 0 }, 'OPEN_CONFIG_CHAIN_ID', 'chainId'], [{ decimals: 256 }, 'OPEN_CONFIG_BOUND', 'decimals'],
    [{ address: 'bad' }, 'OPEN_CONFIG_ADDRESS', 'address'], [{ trusted: true }, 'OPEN_CONFIG_UNKNOWN_FIELD', 'trusted']]) {
    const bad = context(); Object.assign(bad.assets.quote, change);
    error(() => compileOpenConfig(uint(), 1, bad), code, `/context/assets/quote/${field}`);
  }
  const tooMany = { roles: Object.fromEntries(Array.from({ length: 257 }, (_, index) => [`r${index}`, ACCOUNT])) };
  error(() => compileOpenConfig(uint(), 1, tooMany), 'OPEN_CONFIG_CONTEXT_LIMIT', '/context/roles');
});

test('asset metadata and semantic reference identity remain separately committed from ABI address', () => {
  const schema = { type: 'asset' }; const value = { asset: 'quote' };
  const originalContext = context();
  const original = compileOpenConfig(schema, value, originalContext);
  const changedContext = context(); changedContext.assets.quote.chainId = '1'; changedContext.assets.quote.decimals = 18;
  const changed = compileOpenConfig(schema, value, changedContext);
  assert.equal(original.encoded, changed.encoded);
  assert.notEqual(canonicalJson(original.bindings), canonicalJson(changed.bindings));
  const alias = compileOpenConfig(schema, { asset: 'alternate' }, { assets: { alternate: originalContext.assets.quote } });
  assert.equal(original.encoded, alias.encoded);
  assert.notDeepEqual(original.value, alias.value);
  assert.notDeepEqual(original.bindings, alias.bindings);
  originalContext.assets.quote.decimals = 0; value.asset = 'changed';
  assert.equal(original.bindings[0].resolved.decimals, 6);
  assert.equal(original.value.asset, 'quote');
});

test('bounded UTF-8 strings and bytes reject malformed encoding without coercion', () => {
  const schema = { type: 'string', maxLength: 4 };
  assert.equal(decode(compileOpenConfig(schema, '🚀')), '🚀');
  assert.equal(decode(compileOpenConfig(schema, 'éé')), 'éé');
  error(() => compileOpenConfig(schema, '🚀a'), 'OPEN_CONFIG_STRING_LIMIT', '');
  error(() => compileOpenConfig(schema, '\ud800'), 'OPEN_CONFIG_UNICODE', '');
  error(() => compileOpenConfig(schema, '\udc00'), 'OPEN_CONFIG_UNICODE', '');
  error(() => compileOpenConfig(schema, 1), 'OPEN_CONFIG_TYPE', '');
  assert.equal(compileOpenConfig({ type: 'bytes', maxLength: 2 }, '0xABcd').value, '0xabcd');
  for (const value of ['0x1', '0xgg', 'abcd', '0Xaa']) error(() => compileOpenConfig({ type: 'bytes', maxLength: 4 }, value), 'OPEN_CONFIG_BYTES', '');
  error(() => compileOpenConfig({ type: 'bytes', maxLength: 1 }, '0xaabb'), 'OPEN_CONFIG_BYTES_LIMIT', '');
  error(() => compileOpenConfig({ type: 'bool' }, 'false'), 'OPEN_CONFIG_TYPE', '');
});

test('records reject unknown/missing keys, while arrays enforce declared bounds', () => {
  const schema = record({ amount: uint() });
  error(() => compileOpenConfig(schema, {}), 'OPEN_CONFIG_REQUIRED', '/amount');
  error(() => compileOpenConfig(schema, { amount: 1, extra: 2 }), 'OPEN_CONFIG_UNKNOWN_FIELD', '/extra');
  error(() => compileOpenConfig(schema, null), 'OPEN_CONFIG_TYPE', '');
  error(() => compileOpenConfig(array(uint(), 2, 1), []), 'OPEN_CONFIG_ARRAY_LIMIT', '');
  error(() => compileOpenConfig(array(uint(), 2, 1), [1, 2, 3]), 'OPEN_CONFIG_ARRAY_LIMIT', '');
  error(() => compileOpenConfig(array(uint(), 2), {}), 'OPEN_CONFIG_TYPE', '');
  assert.deepEqual(compileOpenConfig(record({}), {}).value, {});
  assert.deepEqual(decode(compileOpenConfig(array(record({}), 3), [{}, {}])), [{ _empty: false }, { _empty: false }]);
});

test('schema keywords, labels, uint widths and branch structures are exact and bounded', () => {
  const cases = [
    [uint({ execute: 'return 1' }), 'OPEN_CONFIG_UNKNOWN_FIELD', '/schema/execute'],
    [{ type: 'number' }, 'OPEN_CONFIG_SCHEMA_TYPE', '/schema/type'],
    [{ type: 'record', fields: {} }, 'OPEN_CONFIG_REQUIRED', '/schema/required'],
    [record({ a: uint() }, ['missing']), 'OPEN_CONFIG_SCHEMA_REQUIRED', '/schema/required/0'],
    [record({ a: uint() }, ['a', 'a']), 'OPEN_CONFIG_SCHEMA_REQUIRED', '/schema/required/1'],
    [record({ 'a-b': uint() }), 'OPEN_CONFIG_NAME', '/schema/required/0'],
    [uint({ bits: 7 }), 'OPEN_CONFIG_BOUND', '/schema/bits'],
    [uint({ bits: 9 }), 'OPEN_CONFIG_UINT_BITS', '/schema/bits'],
    [uint({ bits: 264 }), 'OPEN_CONFIG_BOUND', '/schema/bits'],
    [uint({ min: 20, max: 10 }), 'OPEN_CONFIG_UINT_RANGE', '/schema'],
    [uint({ bits: 8, max: 256 }), 'OPEN_CONFIG_UINT_RANGE', '/schema'],
    [uint({ unit: '' }), 'OPEN_CONFIG_STRING_LIMIT', '/schema/unit'],
    [uint({ unit: 'a'.repeat(129) }), 'OPEN_CONFIG_STRING_LIMIT', '/schema/unit'],
    [uint({ label: 1 }), 'OPEN_CONFIG_TYPE', '/schema/label'],
    [uint({ label: 'a'.repeat(121) }), 'OPEN_CONFIG_STRING_LIMIT', '/schema/label'],
    [uint({ help: 'a'.repeat(2001) }), 'OPEN_CONFIG_STRING_LIMIT', '/schema/help'],
    [{ type: 'string' }, 'OPEN_CONFIG_REQUIRED', '/schema/maxLength'],
    [{ type: 'bytes', maxLength: 16385 }, 'OPEN_CONFIG_BOUND', '/schema/maxLength'],
    [array(uint(), 257), 'OPEN_CONFIG_BOUND', '/schema/maxItems'],
    [array(uint(), 1, 2), 'OPEN_CONFIG_BOUND', '/schema/minItems'],
    [{ type: 'variant', tag: 'mode', variants: {} }, 'OPEN_CONFIG_SCHEMA_VARIANTS', '/schema/variants'],
    [{ type: 'variant', tag: 'mode', variants: { a: uint() } }, 'OPEN_CONFIG_VARIANT_RECORD', '/schema/variants/a'],
    [{ type: 'variant', tag: 'mode', variants: { a: record({ mode: uint() }) } }, 'OPEN_CONFIG_VARIANT_TAG', '/schema/variants/a'],
  ];
  for (const [schema, code, path] of cases) error(() => assertOpenConfigSchema(schema), code, path);
  for (const type of ['bool', 'address', 'account', 'asset', 'component']) assertOpenConfigSchema({ type, label: 'Label', help: 'Description' });
});

test('no custom schema execution, remote reference or inherited validation hook is accepted', () => {
  let called = 0;
  error(() => assertOpenConfigSchema(uint({ validate: () => { called++; } })), 'OPEN_CONFIG_JSON_TYPE', '/schema/validate');
  error(() => assertOpenConfigSchema(uint({ $ref: 'https://example.invalid/schema' })), 'OPEN_CONFIG_UNKNOWN_FIELD', '/schema/$ref');
  error(() => assertOpenConfigSchema(Object.create({ type: 'uint' })), 'OPEN_CONFIG_PROTOTYPE', '/schema');
  assert.equal(called, 0);
});

test('accessor objects and arrays fail before any getter, including toJSON, executes', () => {
  let calls = 0;
  const getter = () => { calls++; throw new Error('Getter must not run'); };
  const schema = { type: 'uint' }; Object.defineProperty(schema, 'min', { get: getter, enumerable: true });
  error(() => assertOpenConfigSchema(schema), 'OPEN_CONFIG_ACCESSOR', '/schema/min');
  const input = {}; Object.defineProperty(input, 'amount', { get: getter, enumerable: true });
  error(() => compileOpenConfig(record({ amount: uint() }), input), 'OPEN_CONFIG_ACCESSOR', '/amount');
  const list = [1]; Object.defineProperty(list, '0', { get: getter, enumerable: true });
  error(() => compileOpenConfig(array(uint()), list), 'OPEN_CONFIG_ACCESSOR', '/0');
  const withJSON = { amount: 1 }; Object.defineProperty(withJSON, 'toJSON', { get: getter, enumerable: true });
  error(() => compileOpenConfig(record({ amount: uint() }), withJSON), 'OPEN_CONFIG_ACCESSOR', '/toJSON');
  const badContext = {}; Object.defineProperty(badContext, 'roles', { get: getter, enumerable: true });
  error(() => compileOpenConfig(uint(), 1, badContext), 'OPEN_CONFIG_ACCESSOR', '/context/roles');
  assert.equal(calls, 0);
});

test('symbols, sparse arrays, extra array properties, exotic prototypes and reserved keys fail closed', () => {
  const symbol = { amount: 1, [Symbol('hidden')]: 2 };
  error(() => compileOpenConfig(record({ amount: uint() }), symbol), 'OPEN_CONFIG_PROPERTY', '');
  error(() => compileOpenConfig(array(uint()), new Array(2)), 'OPEN_CONFIG_ARRAY_SHAPE', '');
  const extra = [1]; extra.extra = 2;
  error(() => compileOpenConfig(array(uint()), extra), 'OPEN_CONFIG_ARRAY_SHAPE', '');
  const nonenumerable = { amount: 1 }; Object.defineProperty(nonenumerable, 'hidden', { value: 1 });
  error(() => compileOpenConfig(record({ amount: uint() }), nonenumerable), 'OPEN_CONFIG_ACCESSOR', '/hidden');
  const list = [1]; Object.defineProperty(list, '0', { enumerable: false });
  error(() => compileOpenConfig(array(uint()), list), 'OPEN_CONFIG_ACCESSOR', '/0');
  class List extends Array {}
  for (const value of [new Date(), new Uint8Array(2), new List(1)]) error(() => compileOpenConfig(uint(), value), 'OPEN_CONFIG_PROTOTYPE', '');
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const value = JSON.parse(`{"${key}":1}`);
    error(() => compileOpenConfig(record({}), value), 'OPEN_CONFIG_RESERVED_KEY', `/${key}`);
  }
  error(() => compileOpenConfig(record({}), { 'a/b~c': 1 }), 'OPEN_CONFIG_UNKNOWN_FIELD', '/a~1b~0c');
  assert.deepEqual(compileOpenConfig(record({}), Object.create(null)).value, {});
});

test('cycles fail deterministically but shared acyclic data is reusable', () => {
  const circular = { type: 'array', maxItems: 1 }; circular.items = circular;
  error(() => assertOpenConfigSchema(circular), 'OPEN_CONFIG_CYCLE', '/schema/items');
  const list = []; list.push(list);
  error(() => compileOpenConfig(array(array(uint())), list), 'OPEN_CONFIG_CYCLE', '/0');
  const sharedSchema = uint();
  assertOpenConfigSchema(record({ a: sharedSchema, b: sharedSchema }));
  const sharedValue = { amount: 1 };
  const compiled = compileOpenConfig(array(record({ amount: uint() }), 2), [sharedValue, sharedValue]);
  assert.deepEqual(compiled.value, [{ amount: '1' }, { amount: '1' }]);
  sharedValue.amount = 2;
  assert.equal(compiled.value[0].amount, '1');
});

test('schema depth, total nodes, fields and variants have independently enforced budgets', () => {
  let deep = uint();
  for (let depth = 0; depth < OPEN_CONFIG_LIMITS.schemaDepth; depth++) deep = array(deep, 1);
  assertOpenConfigSchema(deep);
  error(() => assertOpenConfigSchema(array(deep, 1)), 'OPEN_CONFIG_SCHEMA_DEPTH');
  const fields = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`f${index}`, uint()]));
  error(() => assertOpenConfigSchema(record(fields)), 'OPEN_CONFIG_SCHEMA_FIELDS', '/schema/fields');
  const variants = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`v${index}`, record({})]));
  error(() => assertOpenConfigSchema({ type: 'variant', tag: 'mode', variants }), 'OPEN_CONFIG_SCHEMA_VARIANTS', '/schema/variants');
  const many = record(Object.fromEntries(Array.from({ length: 8 }, (_, index) => [`group${index}`, record(
    Object.fromEntries(Array.from({ length: 64 }, (_, field) => [`f${field}`, uint()])),
  )])));
  error(() => assertOpenConfigSchema(many), 'OPEN_CONFIG_SCHEMA_NODES');
});

test('JSON bytes/nodes/depth and ABI bytes are bounded before large encoding allocations', () => {
  const schema = record(Object.fromEntries(Array.from({ length: 40 }, (_, index) => [`f${index}`, uint({ help: 'h'.repeat(2000) })])));
  error(() => assertOpenConfigSchema(schema), 'OPEN_CONFIG_JSON_LIMIT');
  const text = 'a'.repeat(8192);
  error(() => compileOpenConfig(array({ type: 'string', maxLength: 8192 }, 16), Array(16).fill(text)), 'OPEN_CONFIG_JSON_LIMIT');
  error(() => compileOpenConfig(uint(), 0, { padding: 'a'.repeat(131072) }), 'OPEN_CONFIG_JSON_LIMIT');
  let deep = '0'; for (let level = 0; level < 33; level++) deep = [deep];
  error(() => compileOpenConfig(uint(), deep), 'OPEN_CONFIG_JSON_DEPTH');
  const tooManyNodes = Array.from({ length: 130 }, () => Array(130).fill(0));
  error(() => compileOpenConfig(array(array(uint(), 130), 130), tooManyNodes), 'OPEN_CONFIG_JSON_NODES');
  const tooManyAbiBytes = Array.from({ length: 100 }, () => Array(100).fill('0'));
  error(() => compileOpenConfig(array(array(uint(), 100), 100), tooManyAbiBytes), 'OPEN_CONFIG_ENCODED_LIMIT', '');
});

test('dynamic tuple arrays and long nested string payloads retain standard ABI offsets', () => {
  const schema = array(record({
    payload: array(array({ type: 'string', maxLength: 96 }, 3), 2),
    data: { type: 'bytes', maxLength: 33 }, other: uint({ bits: 32 }),
  }, ['payload', 'data']), 3);
  const values = [{ payload: [['a'.repeat(33), '🚀'], []], data: `0x${'ab'.repeat(33)}` },
    { payload: [[], ['x']], data: '0x', other: '7' }];
  const compiled = compileOpenConfig(schema, values);
  assert.deepEqual(decode(compiled), [
    { data: values[0].data, other: { present: false, value: 0 }, payload: values[0].payload },
    { data: '0x', other: { present: true, value: 7 }, payload: values[1].payload },
  ]);
  assert.equal(compiled.encoded, encodeAbiParameters(compiled.abiParameters, compiled.abiValues));
});
