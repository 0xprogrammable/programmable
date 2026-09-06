import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertOpenConstraints, evaluateOpenConstraints, OpenConstraintError, OPEN_CONSTRAINT_LIMITS as L,
} from '../src/open-constraints.mjs';
import { assertOpenConfigSchema } from '../src/open-config.mjs';

const uint = (unit, extra = {}) => ({ type: 'uint', ...(unit === undefined ? {} : { unit }), ...extra });
const record = (fields, required = Object.keys(fields)) => ({ type: 'record', fields, required });
const literal = (value, unit = 'bps') => ({ literal: value, unit });
const ref = (instance, ...path) => ({ ref: { instance, path } });
const sum = (instance, path = ['recipients'], member = ['shareBps']) => ({ sum: { instance, path, member } });
const constraint = (id, left, operator = 'lte', right = literal('10000')) => ({
  id, message: `${id} must hold`, left, operator, right,
});
const binding = (value, schema = record({ share: uint('bps') })) => ({ schema, value });
const sharesSchema = (leaf = uint('bps'), required = ['shareBps']) => record({
  recipients: { type: 'array', maxItems: 256, items: record({ shareBps: leaf }, required) },
});
function code(result, expected, id) {
  assert.equal(result.ok, false);
  assert.ok(result.violations.some((violation) => violation.code === expected && (!id || violation.id === id)),
    JSON.stringify(result));
}
function malformed(value, expected) {
  assert.throws(() => assertOpenConstraints(value), (error) => error instanceof OpenConstraintError
    && error.code === expected && typeof error.path === 'string' && error.path.startsWith('/constraints'));
  code(evaluateOpenConstraints(value, {}), expected, '$constraints');
}

test('three independently valid 40-percent allocations exceed one shared budget', () => {
  const bindings = Object.fromEntries(['a', 'b', 'c'].map((name) => [name, binding({ share: '4000' })]));
  const all = ['a', 'b', 'c'].map((name) => ref(name, 'share'));
  for (let index = 0; index < 3; index++) {
    assert.deepEqual(evaluateOpenConstraints([constraint('budget', { add: all.filter((_, i) => i !== index) })], bindings),
      { ok: true, violations: [] });
  }
  assert.deepEqual(evaluateOpenConstraints([constraint('budget', { add: all })], bindings), {
    ok: false, violations: [{ id: 'budget', message: 'budget must hold', path: '/constraints/budget', code: 'CONSTRAINT_UNSATISFIED' }],
  });
});

test('all comparisons use exact unsigned arithmetic, including above uint256 aggregate sums', () => {
  for (const [operator, expected] of [['eq', true], ['lte', true], ['lt', false], ['gte', true], ['gt', false]]) {
    assert.equal(evaluateOpenConstraints([constraint('equal', literal('10000'), operator)], {}).ok, expected);
  }
  assert.equal(evaluateOpenConstraints([constraint('precise', literal('9007199254740993'), 'gt', literal('9007199254740992'))], {}).ok, true);
  const maximum = ((1n << 256n) - 1n).toString();
  assert.equal(evaluateOpenConstraints([constraint('aggregate', { add: [literal(maximum), literal(maximum)] }, 'gt', literal(maximum))], {}).ok, true);
});

test('cross-field limits fail when the minimum exceeds the maximum', () => {
  const schema = record({ minimum: uint('quote.raw'), maximum: uint('quote.raw') });
  const conditions = [constraint('limits', ref('$self', 'minimum'), 'lte', ref('$self', 'maximum'))];
  code(evaluateOpenConstraints(conditions, { $self: binding({ minimum: '101', maximum: '100' }, schema) }), 'CONSTRAINT_UNSATISFIED');
  assert.equal(evaluateOpenConstraints(conditions, { $self: binding({ minimum: '100', maximum: '100' }, schema) }).ok, true);
});

test('units are required, case sensitive and compared without conversion', () => {
  for (const left of [literal('1', 'seconds'), { add: [literal('1'), literal('1', 'seconds')] }, literal('1', 'BPS')]) {
    code(evaluateOpenConstraints([constraint('mixed', left)], {}), 'CONSTRAINT_UNIT_MISMATCH');
  }
  const schema = record({ share: uint(undefined) });
  assert.equal(evaluateOpenConstraints([constraint('unitless', ref('a', 'share'), 'eq', literal('5', 'unitless'))],
    { a: binding({ share: '5' }, schema) }).ok, true);
  malformed([constraint('unit', { literal: '1' })], 'CONSTRAINT_SHAPE');
});

test('schema and constraints accept identical opaque unit text through literals, references and empty sums', () => {
  const units = ['%', 'USD per share', '€ pro Anteil', '引用/単位', ' ', 'é', 'e\u0301',
    'a'.repeat(128), 'é'.repeat(64), '🙂'.repeat(32)];
  for (const name of units) {
    const schema = record({ share: uint(name) });
    const conditions = [constraint('opaque', ref('a', 'share'), 'eq', literal('1', name))];
    assert.doesNotThrow(() => assertOpenConfigSchema(schema));
    assert.doesNotThrow(() => assertOpenConstraints(conditions));
    assert.deepEqual(evaluateOpenConstraints(conditions, { a: binding({ share: '1' }, schema) }),
      { ok: true, violations: [] });
    assert.deepEqual(evaluateOpenConstraints([constraint('empty', sum('a'), 'eq', literal('0', name))], {
      a: binding({ recipients: [] }, sharesSchema(uint(name))),
    }), { ok: true, violations: [] });
    assert.equal(schema.fields.share.unit, name);
    assert.equal(conditions[0].right.unit, name);
  }
});

test('opaque units retain whitespace, case and Unicode normalization differences', () => {
  for (const [left, right] of [['USD per share', 'USD per share '], ['É', 'é'], ['é', 'e\u0301']]) {
    const schema = record({ share: uint(left) });
    assert.doesNotThrow(() => assertOpenConfigSchema(schema));
    const conditions = [constraint('exact', ref('a', 'share'), 'eq', literal('1', right))];
    assert.doesNotThrow(() => assertOpenConstraints(conditions));
    code(evaluateOpenConstraints(conditions, { a: binding({ share: '1' }, schema) }), 'CONSTRAINT_UNIT_MISMATCH');
  }
});

test('schema and constraints both reject empty, overlong UTF-8 and malformed surrogate unit text', () => {
  for (const name of ['', 'a'.repeat(129), 'é'.repeat(65), '🙂'.repeat(33), '\ud800', '\udfff', 'prefix\ud800suffix']) {
    const schema = record({ share: uint(name) });
    assert.throws(() => assertOpenConfigSchema(schema), (error) => typeof error.code === 'string'
      && typeof error.path === 'string');
    const conditions = [constraint('invalid', literal('1', name))];
    const expected = name.isWellFormed() ? 'CONSTRAINT_UNIT' : 'CONSTRAINT_JSON_DATA';
    malformed(conditions, expected);
    code(evaluateOpenConstraints([constraint('invalid-schema', ref('a', 'share'))], {
      a: binding({ share: '1' }, schema),
    }), name.isWellFormed() ? 'CONSTRAINT_BINDING_SCHEMA' : 'CONSTRAINT_JSON_DATA');
  }
});

test('array sums infer units from declared members even when no rows exist', () => {
  const empty = { a: binding({ recipients: [] }, sharesSchema()) };
  assert.equal(evaluateOpenConstraints([constraint('empty', sum('a'), 'eq', literal('0'))], empty).ok, true);
  code(evaluateOpenConstraints([constraint('empty-unit', sum('a'), 'eq', literal('0', 'seconds'))], empty), 'CONSTRAINT_UNIT_MISMATCH');
  code(evaluateOpenConstraints([constraint('bad-member', sum('a', ['recipients'], ['missing']))], empty), 'CONSTRAINT_REFERENCE');
  const notNumeric = { a: binding({ recipients: [] }, sharesSchema({ type: 'bool' })) };
  code(evaluateOpenConstraints([constraint('numeric', sum('a'))], notNumeric), 'CONSTRAINT_NOT_UINT');
});

test('sum checks every row and never treats absent optional values as zero', () => {
  const schema = sharesSchema(uint('bps'), []);
  assert.equal(evaluateOpenConstraints([constraint('shares', sum('a'), 'eq')], {
    a: binding({ recipients: [{ shareBps: '2500' }, { shareBps: '7500' }] }, schema),
  }).ok, true);
  for (const second of [{}, { shareBps: 7500 }, { shareBps: '7500.0' }]) {
    const result = evaluateOpenConstraints([constraint('shares', sum('a'), 'eq')], {
      a: binding({ recipients: [{ shareBps: '2500' }, second] }, schema),
    });
    code(result, Object.hasOwn(second, 'shareBps') ? 'CONSTRAINT_UINT' : 'CONSTRAINT_MISSING_VALUE');
    assert.equal(result.violations[0].path, '/bindings/a/value/recipients/1/shareBps');
  }
});

test('sum rejects malformed rows, wrong array bounds and non-record item schemas', () => {
  for (const recipients of [[null], ['5'], {}]) {
    assert.equal(evaluateOpenConstraints([constraint('sum', sum('a'))], { a: binding({ recipients }, sharesSchema()) }).ok, false);
  }
  const schema = sharesSchema();
  schema.fields.recipients.minItems = 1;
  code(evaluateOpenConstraints([constraint('sum', sum('a'))], { a: binding({ recipients: [] }, schema) }), 'CONSTRAINT_REFERENCE');
  const scalars = record({ recipients: { type: 'array', maxItems: 10, items: uint('bps') } });
  code(evaluateOpenConstraints([constraint('sum', sum('a'))], { a: binding({ recipients: [] }, scalars) }), 'CONSTRAINT_REFERENCE');
});

test('optional references and unknown instances fail rather than reading inherited or fabricated values', () => {
  const conditions = [constraint('required-value', ref('a', 'share'))];
  code(evaluateOpenConstraints(conditions, { a: binding({}, record({ share: uint('bps') }, [])) }), 'CONSTRAINT_MISSING_VALUE');
  code(evaluateOpenConstraints(conditions, {}), 'CONSTRAINT_BINDING');
  code(evaluateOpenConstraints(conditions, { a: binding({ other: '5' }, record({ other: uint('bps') })) }), 'CONSTRAINT_REFERENCE');
  const inherited = Object.create({ share: '1' });
  code(evaluateOpenConstraints(conditions, { a: binding(inherited) }), 'CONSTRAINT_JSON_DATA');
});

test('variant references follow the selected flat branch, including nested variants', () => {
  const variant = { type: 'variant', tag: 'mode', variants: {
    fixed: record({ amount: uint('bps') }),
    timed: record({ duration: uint('seconds') }),
  } };
  const schema = record({ rule: variant });
  const conditions = [constraint('amount', ref('a', 'rule', 'amount'))];
  assert.equal(evaluateOpenConstraints(conditions, { a: binding({ rule: { mode: 'fixed', amount: '1' } }, schema) }).ok, true);
  code(evaluateOpenConstraints(conditions, { a: binding({ rule: { mode: 'timed', duration: '1' } }, schema) }), 'CONSTRAINT_REFERENCE');
  code(evaluateOpenConstraints(conditions, { a: binding({ rule: { amount: '1' } }, schema) }), 'CONSTRAINT_MISSING_VALUE');
  code(evaluateOpenConstraints(conditions, { a: binding({ rule: { mode: 'unknown', amount: '1' } }, schema) }), 'CONSTRAINT_REFERENCE');
  code(evaluateOpenConstraints(conditions, { a: binding({ rule: { mode: '__proto__', amount: '1' } }, schema) }), 'CONSTRAINT_REFERENCE');
});

test('empty sums over nested variants require a consistently numeric member in every branch', () => {
  const item = record({ rule: { type: 'variant', tag: 'mode', variants: {
    one: record({ amount: uint('bps') }), two: record({ amount: uint('bps') }),
  } } });
  const schema = record({ rows: { type: 'array', maxItems: 4, items: item } });
  const conditions = [constraint('variants', sum('a', ['rows'], ['rule', 'amount']), 'eq', literal('0'))];
  assert.equal(evaluateOpenConstraints(conditions, { a: binding({ rows: [] }, schema) }).ok, true);
  schema.fields.rows.items.fields.rule.variants.two.fields.amount.unit = 'seconds';
  code(evaluateOpenConstraints(conditions, { a: binding({ rows: [] }, schema) }), 'CONSTRAINT_UNIT_MISMATCH');
});

test('array index references are explicit integers with checked presence', () => {
  const bindings = { a: binding({ recipients: [{ shareBps: '5000' }] }, sharesSchema()) };
  assert.equal(evaluateOpenConstraints([constraint('first', ref('a', 'recipients', 0, 'shareBps'))], bindings).ok, true);
  code(evaluateOpenConstraints([constraint('absent', ref('a', 'recipients', 1, 'shareBps'))], bindings), 'CONSTRAINT_MISSING_VALUE');
  code(evaluateOpenConstraints([constraint('string-index', ref('a', 'recipients', 'length'))], bindings), 'CONSTRAINT_REFERENCE');
  malformed([constraint('negative-index', ref('a', 'recipients', -1))], 'CONSTRAINT_REFERENCE');
});

test('numeric leaves use schema ranges and never coerce numbers or text', () => {
  const schema = record({ share: uint('bps', { bits: 8, min: '1', max: 200 }) });
  for (const value of [1, true, null, '', '01', '-1', '+1', '1e2', ' 1', '1.0']) {
    code(evaluateOpenConstraints([constraint('number', ref('a', 'share'))], { a: binding({ share: value }, schema) }), 'CONSTRAINT_UINT');
  }
  for (const value of ['0', '201', '256']) {
    code(evaluateOpenConstraints([constraint('range', ref('a', 'share'))], { a: binding({ share: value }, schema) }), 'CONSTRAINT_UINT_RANGE');
  }
  assert.equal(evaluateOpenConstraints([constraint('valid', ref('a', 'share'))], { a: binding({ share: '200' }, schema) }).ok, true);
});

test('violation ordering and paths do not depend on constraint or binding insertion order', () => {
  const conditions = [constraint('z', ref('a', 'share'), 'lt', literal('1')),
    constraint('a', ref('b', 'share'), 'gt', literal('2')), constraint('m', literal('1', 'seconds'))];
  const first = evaluateOpenConstraints(conditions, { a: binding({ share: '1' }), b: binding({ share: '2' }) });
  const second = evaluateOpenConstraints([...conditions].reverse(), { b: binding({ share: '2' }), a: binding({ share: '1' }) });
  assert.deepEqual(first, second);
  assert.deepEqual(first.violations.map(({ id }) => id), ['a', 'm', 'z']);
});

test('no constraints is valid, and null-prototype data is supported without mutation', () => {
  assert.deepEqual(evaluateOpenConstraints([], {}), { ok: true, violations: [] });
  const value = Object.freeze(Object.assign(Object.create(null), { share: '1' }));
  const bindings = Object.assign(Object.create(null), { a: binding(value) });
  const before = JSON.stringify(bindings);
  assert.equal(evaluateOpenConstraints([constraint('plain', ref('a', 'share'))], bindings).ok, true);
  assert.equal(JSON.stringify(bindings), before);
});

test('malformed expressions, operators, duplicate IDs and reserved references are structured failures', () => {
  const valid = constraint('valid', literal('1'));
  malformed([valid, valid], 'CONSTRAINT_DUPLICATE_ID');
  malformed([{ ...valid, operator: 'eval' }], 'CONSTRAINT_OPERATOR');
  malformed([{ ...valid, extra: true }], 'CONSTRAINT_SHAPE');
  malformed([constraint('bad', { add: [] })], 'CONSTRAINT_LIMIT');
  malformed([constraint('bad', { js: 'return 1' })], 'CONSTRAINT_EXPRESSION');
  malformed([constraint('bad', { literal: '1', unit: 'bps', ref: { instance: 'a', path: [] } })], 'CONSTRAINT_SHAPE');
  for (const name of ['__proto__', 'constructor', 'prototype']) {
    malformed([constraint(name, literal('1'))], 'CONSTRAINT_IDENTIFIER');
    malformed([constraint('bad', ref(name, 'x'))], 'CONSTRAINT_IDENTIFIER');
    malformed([constraint('bad', ref('a', name))], 'CONSTRAINT_IDENTIFIER');
  }
  malformed([constraint('bad', literal(((1n << 256n)).toString()))], 'CONSTRAINT_UINT');
});

test('definition sizes are bounded before evaluation', () => {
  malformed(Array.from({ length: L.constraints + 1 }, (_, index) => constraint(`c${index}`, literal('1'))), 'CONSTRAINT_LIMIT');
  malformed([constraint('wide', { add: Array.from({ length: L.addTerms + 1 }, () => literal('1')) })], 'CONSTRAINT_LIMIT');
  let deep = literal('1');
  for (let index = 0; index <= L.expressionDepth; index++) deep = { add: [deep] };
  malformed([constraint('deep', deep)], 'CONSTRAINT_LIMIT');
  malformed([constraint('path', ref('a', ...Array(L.pathSegments + 1).fill('x')))], 'CONSTRAINT_REFERENCE');
  malformed([constraint('message', literal('1'), 'eq', literal('1'))].map((value) => ({ ...value, message: 'x'.repeat(L.messageLength + 1) })), 'CONSTRAINT_MESSAGE');
  const manyNodes = Array.from({ length: 17 }, (_, index) => constraint(`c${index}`, { add: Array.from({ length: 64 }, () => literal('1')) }));
  malformed(manyNodes, 'CONSTRAINT_LIMIT');
});

test('preflight rejects accessors without executing them, including array entries', () => {
  let called = 0;
  const object = { ...constraint('getter', literal('1')) };
  Object.defineProperty(object, 'left', { enumerable: true, get() { called++; return literal('1'); } });
  malformed([object], 'CONSTRAINT_JSON_DATA');
  const array = [constraint('getter', literal('1'))];
  Object.defineProperty(array, '0', { enumerable: true, get() { called++; return constraint('getter', literal('1')); } });
  malformed(array, 'CONSTRAINT_JSON_DATA');
  const value = {};
  Object.defineProperty(value, 'share', { enumerable: true, get() { called++; return '1'; } });
  code(evaluateOpenConstraints([constraint('getter', ref('a', 'share'))], { a: binding(value) }), 'CONSTRAINT_JSON_DATA');
  assert.equal(called, 0);
});

test('preflight rejects cycles, sparse arrays, symbols, hidden keys and executable objects', () => {
  const cycle = [];
  cycle.push(cycle);
  malformed(cycle, 'CONSTRAINT_JSON_DATA');
  malformed(new Array(1), 'CONSTRAINT_JSON_DATA');
  const extra = [];
  extra.extra = true;
  malformed(extra, 'CONSTRAINT_JSON_DATA');
  const symbol = constraint('symbol', literal('1'));
  symbol[Symbol('hidden')] = true;
  malformed([symbol], 'CONSTRAINT_JSON_DATA');
  const hidden = constraint('hidden', literal('1'));
  Object.defineProperty(hidden, 'invisible', { value: true });
  malformed([hidden], 'CONSTRAINT_JSON_DATA');
  for (const value of [new Date(), () => 1, 1n, NaN, Infinity, -0, Number.MAX_SAFE_INTEGER + 1]) {
    malformed([constraint('json', { literal: value, unit: 'bps' })], 'CONSTRAINT_JSON_DATA');
  }
  malformed(JSON.parse('[{"__proto__": {}}]'), 'CONSTRAINT_JSON_DATA');
  malformed([{ ...constraint('unicode', literal('1')), message: '\ud800' }], 'CONSTRAINT_JSON_DATA');
});

test('binding failures are bounded and preserve useful schema error paths', () => {
  const conditions = [constraint('bound', ref('a', 'share'))];
  code(evaluateOpenConstraints(conditions, null), 'CONSTRAINT_BINDING');
  const bindings = Object.fromEntries(Array.from({ length: L.bindings + 1 }, (_, index) => [`a${index}`, binding({ share: '1' })]));
  code(evaluateOpenConstraints(conditions, bindings), 'CONSTRAINT_BINDING');
  code(evaluateOpenConstraints(conditions, { a: { ...binding({ share: '1' }), extra: true } }), 'CONSTRAINT_SHAPE');
  const malformedSchema = record({ share: uint('bps', { bits: 7 }) });
  const result = evaluateOpenConstraints(conditions, { a: binding({ share: '1' }, malformedSchema) });
  code(result, 'CONSTRAINT_BINDING_SCHEMA');
  assert.equal(result.violations[0].path, '/bindings/a/schema/fields/share/bits');
  code(evaluateOpenConstraints(conditions, { a: binding({ share: '1', rows: Array(L.jsonArrayLength + 1).fill('1') }) }), 'CONSTRAINT_JSON_LIMIT');
  code(evaluateOpenConstraints(conditions, { a: binding({ share: '1', text: 'x'.repeat(L.jsonStringLength + 1) }) }), 'CONSTRAINT_JSON_LIMIT');
});

test('one aggregate work budget also bounds many individually admissible array sums', () => {
  let itemSchema = record({ share: uint('bps') });
  let itemValue = { share: '1' };
  const member = ['share'];
  for (let index = 0; index < 8; index++) {
    itemSchema = record({ nested: itemSchema });
    itemValue = { nested: itemValue };
    member.unshift('nested');
  }
  const schema = record({ rows: { type: 'array', maxItems: 256, items: itemSchema } });
  const bindings = { a: binding({ rows: Array.from({ length: 256 }, () => structuredClone(itemValue)) }, schema) };
  const conditions = Array.from({ length: 64 }, (_, index) => constraint(`c${index}`, {
    add: Array.from({ length: 12 }, () => sum('a', ['rows'], member)),
  }));
  assert.doesNotThrow(() => assertOpenConstraints(conditions));
  const result = evaluateOpenConstraints(conditions, bindings);
  code(result, 'CONSTRAINT_EVALUATION_LIMIT');
  assert.ok(result.violations.length < conditions.length, 'early constraints fit inside the shared work budget');
  assert.deepEqual(evaluateOpenConstraints([...conditions].reverse(), bindings), result);
});
