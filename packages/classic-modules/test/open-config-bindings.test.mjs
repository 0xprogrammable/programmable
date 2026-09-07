import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAbiParameters } from 'viem';
import { assertOpenConfigSchema, compileOpenConfig, resolveOpenConfigBindings,
  openPackageId, validateOpenPackage, compileOpenTemplate } from '../src/open-packages.mjs';
import { sourcePackage, templateFor, context, AUTHOR, CREATOR } from '../examples/open-packages/fixture.mjs';

const record = (fields, required = Object.keys(fields)) => ({ type: 'record', fields, required });
const fixed = (type, value) => ({ type, binding: { mode: 'fixed', value } });
const input = (type, value) => ({ type, binding: { mode: 'input', ...(value === undefined ? {} : { default: value }) } });
const error = (fn, code, path) => assert.throws(fn, (caught) => {
  assert.equal(caught.code, code);
  if (path !== undefined) assert.equal(caught.path, path);
  return true;
});

function packageWith(schema) {
  const pkg = sourcePackage(); pkg.configuration = schema; pkg.constraints = [];
  return pkg;
}
function plan(pkg, parameters) {
  const template = templateFor(pkg); template.instances[0].parameters = parameters;
  return compileOpenTemplate(template, [pkg]);
}

test('one input template accepts two quote CAs without changing its package or family', () => {
  const pkg = packageWith(record({ quoteAsset: input('address'), window: input('uint', 60) }));
  const packageId = openPackageId(pkg);
  const first = plan(pkg, { quoteAsset: AUTHOR });
  const second = plan(pkg, { quoteAsset: CREATOR, window: '120' });
  assert.equal(first.ok, true, JSON.stringify(first)); assert.equal(second.ok, true, JSON.stringify(second));
  assert.equal(openPackageId(pkg), packageId);
  assert.equal(first.plan.instances[0].packageId, second.plan.instances[0].packageId);
  assert.notEqual(first.plan.instances[0].configurationBytes, second.plan.instances[0].configurationBytes);
  assert.notEqual(first.planId, second.planId);
  assert.deepEqual(first.plan.authorFamilies, second.plan.authorFamilies);
  assert.deepEqual(first.plan.instances[0].configuration, { quoteAsset: AUTHOR, window: '60' });
  assert.equal(second.plan.instances[0].configuration.window, '120', 'defaults remain editable');
  assert.equal(plan(pkg, {}).errors[0].code, 'OPEN_CONFIG_REQUIRED');
});

test('fixed quote is inserted before encoding and overrides fail at SDK/template boundaries', () => {
  const schema = record({ quoteAsset: fixed('address', AUTHOR), window: input('uint', 60) });
  const pkg = packageWith(schema);
  const supplied = {};
  const compiled = compileOpenConfig(schema, supplied);
  assert.deepEqual(supplied, {}, 'resolution does not rewrite user input');
  assert.deepEqual(resolveOpenConfigBindings(schema, supplied), { value: compiled.value, bindings: compiled.bindings });
  assert.deepEqual(decodeAbiParameters(compiled.abiParameters, compiled.encoded)[0], { quoteAsset: AUTHOR, window: 60n });
  assert.equal(compiled.encoded, compileOpenConfig(schema, { quoteAsset: AUTHOR }).encoded);
  error(() => resolveOpenConfigBindings(schema, { quoteAsset: CREATOR }), 'OPEN_CONFIG_FIXED_OVERRIDE', '/quoteAsset');
  error(() => compileOpenConfig(schema, { quoteAsset: CREATOR }), 'OPEN_CONFIG_FIXED_OVERRIDE', '/quoteAsset');
  assert.equal(plan(pkg, { quoteAsset: CREATOR }).errors[0].code, 'OPEN_CONFIG_FIXED_OVERRIDE');
  const changed = structuredClone(pkg); changed.configuration.fields.quoteAsset.binding.value = CREATOR;
  assert.notEqual(openPackageId(changed), openPackageId(pkg));
  assert.equal(validateOpenPackage(changed).familyId, validateOpenPackage(pkg).familyId, 'another CA grants no new family');
  assert.equal(compileOpenTemplate(templateFor(pkg), [changed]).errors[0].code, 'OPEN_PACKAGE_MISSING');
});

test('nested records, ordered arrays, variants and optional fixed values use the existing ABI', () => {
  const release = { type: 'variant', tag: 'mode', variants: {
    delayed: record({ delay: { type: 'uint', min: 1 }, stages: { type: 'array', maxItems: 3, items: record({ amount: { type: 'uint' }, recipient: { type: 'account' } }) } }),
    immediate: record({}),
  }, binding: { mode: 'fixed', value: { mode: 'delayed', delay: 60, stages: [{ amount: '0007', recipient: { address: AUTHOR } }] } } };
  const schema = record({ release, feeHint: input('uint', 3), enabled: fixed('bool', false) }, ['release', 'feeHint']);
  const compiled = compileOpenConfig(schema, { feeHint: 4 });
  assert.equal(compiled.value.release.stages[0].amount, '7');
  assert.equal(compiled.value.feeHint, '4');
  assert.deepEqual(decodeAbiParameters(compiled.abiParameters, compiled.encoded)[0].enabled, { present: true, value: false });
  for (const mutate of [
    (value) => { value.delay = '61'; },
    (value) => { value.stages[0].recipient.address = CREATOR; },
    (value) => { value.stages.push({ amount: '1', recipient: { address: AUTHOR } }); },
  ]) {
    const override = structuredClone(compiled.value.release); mutate(override);
    error(() => compileOpenConfig(schema, { release: override }), 'OPEN_CONFIG_FIXED_OVERRIDE', '/release');
  }
  error(() => compileOpenConfig(schema, { release: { mode: 'immediate' } }), 'OPEN_CONFIG_FIXED_OVERRIDE', '/release');
  const equivalent = structuredClone(compiled.value.release); equivalent.delay = '00060';
  assert.equal(compileOpenConfig(schema, { release: equivalent, feeHint: 4 }).encoded, compiled.encoded);
});

test('fixed asset pins address, chain and decimals; caller context cannot rebind it', () => {
  const asset = { chainId: 4663, address: AUTHOR, decimals: 18 };
  const schema = record({ quote: fixed('asset', asset), engine: fixed('component', { address: CREATOR }) });
  const a = compileOpenConfig(schema, {});
  const b = compileOpenConfig(schema, {}, { assets: { quote: { ...asset, address: CREATOR } }, components: { engine: AUTHOR } });
  assert.deepEqual(a, b);
  assert.deepEqual(a.bindings, [{ path: '/quote', kind: 'asset', reference: null, resolved: { ...asset, chainId: '4663' } }]);
  for (const override of [{ ...asset, address: CREATOR }, { ...asset, chainId: 1 }, { ...asset, decimals: 6 }]) {
    error(() => compileOpenConfig(schema, { quote: override }), 'OPEN_CONFIG_FIXED_OVERRIDE', '/quote');
  }
  error(() => compileOpenConfig(schema, { quote: { asset: 'quote' } }, { assets: { quote: asset } }), 'OPEN_CONFIG_FIXED_OVERRIDE', '/quote');
  for (const [type, value] of [['asset', { asset: 'quote' }], ['account', { role: 'creator' }], ['component', { component: 'engine' }]]) {
    error(() => assertOpenConfigSchema(fixed(type, value)), 'OPEN_CONFIG_FIXED_REFERENCE');
    const nested = { ...record({ target: { type } }), binding: { mode: 'fixed', value: { target: value } } };
    error(() => assertOpenConfigSchema(nested), 'OPEN_CONFIG_FIXED_REFERENCE');
  }
  assert.deepEqual(compileOpenConfig(input('asset', { asset: 'quote' }), undefined, { assets: { quote: asset } }).value, { asset: 'quote' });
});

test('binding descriptors and their values are validated before package acceptance', () => {
  const cases = [
    [{ type: 'uint', binding: { mode: 'other' } }, 'OPEN_CONFIG_BINDING'],
    [{ type: 'uint', binding: { mode: 'fixed' } }, 'OPEN_CONFIG_REQUIRED'],
    [{ type: 'uint', binding: { mode: 'input', value: '3' } }, 'OPEN_CONFIG_UNKNOWN_FIELD'],
    [{ type: 'uint', binding: { mode: 'fixed', value: '3', default: '4' } }, 'OPEN_CONFIG_UNKNOWN_FIELD'],
    [{ type: 'uint', max: 2, binding: { mode: 'fixed', value: '3' } }, 'OPEN_CONFIG_UINT_RANGE'],
    [{ type: 'uint', max: 2, binding: { mode: 'input', default: '3' } }, 'OPEN_CONFIG_UINT_RANGE'],
    [{ ...record({ amount: { type: 'uint' } }), binding: { mode: 'fixed', value: { amount: 1, extra: 2 } } }, 'OPEN_CONFIG_UNKNOWN_FIELD'],
    [{ ...record({ amount: fixed('uint', 1) }), binding: { mode: 'input', default: { amount: 2 } } }, 'OPEN_CONFIG_FIXED_OVERRIDE'],
  ];
  for (const [schema, code] of cases) {
    error(() => assertOpenConfigSchema(schema), code);
    assert.equal(validateOpenPackage(packageWith(schema)).errors[0].code, code);
  }
  assert.equal(compileOpenConfig(fixed('uint', '0007'), 7).value, '7');
  assert.equal(resolveOpenConfigBindings(fixed('bool', false), undefined).value, false);
});

test('binding payload accessors, prototypes and oversized default expansion fail closed', () => {
  let calls = 0;
  const schema = fixed('uint', 1);
  Object.defineProperty(schema.binding, 'value', { enumerable: true, get() { calls++; return 1; } });
  error(() => resolveOpenConfigBindings(schema, 1), 'OPEN_CONFIG_ACCESSOR');
  assert.equal(calls, 0);
  const polluted = JSON.parse('{"type":"record","fields":{},"required":[],"binding":{"mode":"fixed","value":{"__proto__":{"polluted":true}}}}');
  error(() => assertOpenConfigSchema(polluted), 'OPEN_CONFIG_RESERVED_KEY');
  assert.equal({}.polluted, undefined);
  let large = input('string', 'x'.repeat(1000)); large.maxLength = 1000;
  for (let i = 0; i < 3; i++) large = { type: 'array', maxItems: 16,
    items: record({ nested: large }), binding: { mode: 'input', default: Array.from({ length: 16 }, () => ({})) } };
  error(() => compileOpenConfig(large, undefined), 'OPEN_CONFIG_JSON_LIMIT');
});

test('historical package, plan and configuration bytes retain their frozen identities', () => {
  const pkg = sourcePackage();
  const result = compileOpenTemplate(templateFor(pkg), [pkg], context());
  assert.equal(result.ok, true);
  assert.equal(openPackageId(pkg), '0x4958372b77b45a52b80d04ea13a13f37ec9217e0df89c4ed0cd0325d89530178');
  assert.equal(result.planId, '0x05310fd89d6942b7eb6523d05499df1cd3e7e84dbf59f089fdfe50d059741d3b');
  assert.equal(result.plan.instances[0].configurationBytes,
    '0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000064000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000001b5800000000000000000000000022222222222222222222222222222222222222220000000000000000000000000000000000000000000000000000000000000bb80000000000000000000000001111111111111111111111111111111111111111');
});
