import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeAbiParameters } from 'viem';
import { OPEN_TEMPLATE_FORMAT, validateOpenPackage, openPackageId, compileOpenTemplate } from '../src/open-packages.mjs';
import { AUTHOR, CREATOR, OTHER_CREATOR, sourcePackage, values, templateFor, context, uint } from '../examples/open-packages/fixture.mjs';

test('source-first identity binds every declaration without requiring deployment or asserting approval', () => {
  const p = sourcePackage();
  const checked = validateOpenPackage(p);
  assert.equal(checked.ok, true, JSON.stringify(checked));
  assert.equal(checked.reviewStatus, 'unreviewed'); assert.equal(checked.authorAuthenticated, false);
  assert.equal(checked.sourceVerified, false); assert.equal(checked.onchainApproved, false);
  const copy = structuredClone(p); copy.management.summary += ' changed';
  assert.notEqual(openPackageId(copy), checked.packageId);
  const reordered = Object.fromEntries(Object.entries(p).reverse());
  assert.equal(openPackageId(reordered), checked.packageId);
});

test('unknown package fields, unsafe source, unpinned documentation and undeclared actions fail closed', () => {
  const mutations = [
    (p) => { p.approved = true; },
    (p) => { p.source.files[0].path = '../secret'; },
    (p) => { p.source.files.push(p.source.files[0]); },
    (p) => { p.source.repository = 'https://user:password@example.invalid'; },
    (p) => { p.source.repository = ['https://example.invalid/repository']; },
    (p) => { p.documentation = 'missing.md'; },
    (p) => { p.components[0].sourcePath = 'missing.sol'; },
    (p) => { p.management.actions = [{ id: 'run', label: 'Run', component: 'missing', entrypoint: 'run', description: 'run', role: 'operator', inputs: uint() }]; },
    (p) => { p.extensions = null; },
  ];
  for (const mutate of mutations) { const p = sourcePackage(); mutate(p); assert.equal(validateOpenPackage(p).ok, false); }
});

test('preview encodes nested data, rebinds symbolic creator and preserves literal third-party recipient', () => {
  const p = sourcePackage(); const t = templateFor(p);
  const a = compileOpenTemplate(t, [p], context());
  const b = compileOpenTemplate(t, [p], context(OTHER_CREATOR));
  assert.equal(a.ok, true, JSON.stringify(a)); assert.equal(b.ok, true, JSON.stringify(b));
  assert.notEqual(a.planId, b.planId);
  assert.notEqual(a.plan.instances[0].configurationBytes, b.plan.instances[0].configurationBytes);
  const decoded = decodeAbiParameters(a.plan.instances[0].abiParameters, a.plan.instances[0].configurationBytes);
  assert.ok(JSON.stringify(decoded, (_, value) => typeof value === 'bigint' ? value.toString() : value).toLowerCase().includes(CREATOR));
  assert.equal(a.plan.instances[0].configuration.recipients[1].wallet.address.toLowerCase(), AUTHOR);
  for (const result of [a, b]) {
    assert.equal(result.launchable, false); assert.equal(result.authorizationVerified, false);
    assert.equal(result.engineStatus, 'not-implemented'); assert.equal(result.runtimeVerified, false);
    assert.deepEqual(result.missingHostCapabilities, ['example.allocation-view@1']);
  }
});

test('package constraints reject a misallocated sum and crossing limits with useful violation ids', () => {
  const p = sourcePackage(); const t = templateFor(p);
  t.instances[0].parameters.recipients[0].share = '8000';
  t.instances[0].parameters.minimum = '101';
  const result = compileOpenTemplate(t, [p], context());
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.id).sort(), ['allocation-total', 'ordered-limits']);
  assert.equal(result.launchable, false);
  assert.equal(t.instances[0].parameters.recipients[0].share, '8000', 'invalid user edits are retained');
});

function graphFixture() {
  const a = sourcePackage();
  const b = sourcePackage(); b.name = 'Consumer'; b.familySalt = `0x${'0'.repeat(63)}2`;
  b.ports = { inputs: { source: 'example.allocation@1' }, outputs: { result: 'example.result@1' } };
  const t = templateFor(a);
  t.instances.push({ id: 'consumer', packageId: openPackageId(b), parameters: values() });
  t.links = [{ from: { instance: 'rewards', port: 'allocation' }, to: { instance: 'consumer', port: 'source' } }];
  return { a, b, t };
}

test('typed connections resolve deterministic order independent of catalogue and selection order', () => {
  const { a, b, t } = graphFixture();
  const first = compileOpenTemplate(t, [a, b], context());
  const second = compileOpenTemplate({ ...t, instances: [...t.instances].reverse() }, [b, a], context());
  assert.equal(first.ok, true, JSON.stringify(first)); assert.equal(first.planId, second.planId);
  assert.deepEqual(first.plan.preparationOrder, ['rewards', 'consumer']);
});

test('graph rejects missing ports, duplicate targets, incompatible interfaces and preparation cycles', () => {
  for (const variation of ['missing', 'duplicate', 'type', 'cycle']) {
    const { a, b, t } = graphFixture();
    if (variation === 'missing') t.links = [];
    if (variation === 'duplicate') t.links.push(structuredClone(t.links[0]));
    if (variation === 'type') { b.ports.inputs.source = 'example.other@1'; t.instances[1].packageId = openPackageId(b); }
    if (variation === 'cycle') {
      a.ports.inputs.cycle = 'example.result@1'; t.instances[0].packageId = openPackageId(a);
      t.links.push({ from: { instance: 'consumer', port: 'result' }, to: { instance: 'rewards', port: 'cycle' } });
    }
    assert.equal(compileOpenTemplate(t, [a, b], context()).ok, false, variation);
  }
});

test('whole-template constraints reject three individually valid allocations and unit mismatches', () => {
  const p = sourcePackage(); p.configuration = { type: 'record', fields: { allocation: uint() }, required: ['allocation'] }; p.constraints = [];
  const t = { format: OPEN_TEMPLATE_FORMAT, name: 'Aggregate allocation',
    instances: ['a', 'b', 'c'].map((id) => ({ id, packageId: openPackageId(p), parameters: { allocation: '4000' } })), links: [],
    constraints: [{ id: 'budget', message: 'Combined allocation exceeds the available share',
      left: { add: ['a', 'b', 'c'].map((instance) => ({ ref: { instance, path: ['allocation'] } })) }, operator: 'lte',
      right: { literal: '10000', unit: 'bps' } }] };
  assert.equal(compileOpenTemplate(t, [p], context()).ok, false);
  t.instances[2].parameters.allocation = '2000';
  const valid = compileOpenTemplate(t, [p], context()); assert.equal(valid.ok, true, JSON.stringify(valid));
  assert.equal(valid.plan.authorFamilies.length, 1, 'repeated instances do not create additional families');
  t.constraints[0].right.unit = 'seconds'; assert.equal(compileOpenTemplate(t, [p], context()).ok, false);
});

test('different explicit instances change commitment; family wallet disagreements are rejected', () => {
  const p = sourcePackage(); const t = templateFor(p);
  const first = compileOpenTemplate(t, [p], context());
  t.instances.push({ ...structuredClone(t.instances[0]), id: 'separate' });
  const second = compileOpenTemplate(t, [p], context());
  assert.equal(second.ok, true); assert.notEqual(first.planId, second.planId);
  assert.equal(second.plan.authorFamilies.length, 1);
  const other = structuredClone(p); other.version = '0.2.0'; other.rewardWallet = OTHER_CREATOR;
  t.instances[1].packageId = openPackageId(other);
  const conflict = compileOpenTemplate(t, [p, other], context());
  assert.equal(conflict.ok, false); assert.equal(conflict.errors[0].code, 'OPEN_FAMILY_CONFLICT');
});

test('opaque UTF-8 units survive package validation and template constraints without narrowing', () => {
  for (const unit of ['%', 'USD per share', 'Anteile €']) {
    const p = sourcePackage();
    p.configuration = { type: 'record', fields: { amount: { type: 'uint', unit } }, required: ['amount'] };
    p.constraints = [{ id: 'unit-check', message: 'Expected the declared amount',
      left: { ref: { instance: '$self', path: ['amount'] } }, operator: 'eq', right: { literal: '10', unit } }];
    assert.equal(validateOpenPackage(p).ok, true);
    const t = templateFor(p); t.instances[0].parameters = { amount: '10' };
    const result = compileOpenTemplate(t, [p], context());
    assert.equal(result.ok, true, JSON.stringify(result));
  }
});

test('present invalid bindings are not coerced into omitted maps, including in an empty template', () => {
  const empty = { format: OPEN_TEMPLATE_FORMAT, name: 'Empty draft', instances: [], links: [], constraints: [] };
  for (const key of ['roles', 'assets', 'components', 'hostCapabilities']) {
    for (const value of [null, false, 0, '']) {
      const result = compileOpenTemplate(empty, [], { [key]: value });
      assert.equal(result.ok, false, `${key} = ${JSON.stringify(value)}`);
    }
  }
  assert.equal(compileOpenTemplate(empty, [], { roles: { creator: 'malformed' } }).ok, false);
});

test('unselected catalogue entries do not change the plan and a zero-module draft remains possible', () => {
  const p = sourcePackage(); const unused = sourcePackage(); unused.name = 'Unused'; unused.version = '0.3.0';
  const t = templateFor(p);
  assert.equal(compileOpenTemplate(t, [p], context()).planId, compileOpenTemplate(t, [unused, p], context()).planId);
  const empty = compileOpenTemplate({ format: OPEN_TEMPLATE_FORMAT, name: 'Plain Classic draft', instances: [], links: [], constraints: [] }, [], {});
  assert.equal(empty.ok, true, JSON.stringify(empty)); assert.equal(empty.launchable, false);
  assert.deepEqual(empty.plan.authorFamilies, []);
});

test('unknown packages and undeclared template fields cannot inherit V1 approval', () => {
  const p = sourcePackage(); const t = templateFor(p);
  assert.equal(compileOpenTemplate(t, [], context()).ok, false);
  assert.equal(compileOpenTemplate({ ...t, onchainApproved: true }, [p], context()).ok, false);
  assert.equal(compileOpenTemplate(t, [p, p], context()).ok, false);
});

test('malformed direct JS inputs are rejected without getters, sparse traversal or prototype effects', () => {
  let called = 0;
  const p = sourcePackage(); Object.defineProperty(p, 'name', { enumerable: true, get() { called++; return 'evil'; } });
  assert.equal(validateOpenPackage(p).ok, false); assert.equal(called, 0);
  const t = templateFor(); Object.defineProperty(t.instances, '0', { enumerable: true, get() { called++; return null; } });
  assert.equal(compileOpenTemplate(t, [sourcePackage()], context()).ok, false); assert.equal(called, 0);
  const polluted = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.equal(validateOpenPackage(polluted).ok, false); assert.equal({}.polluted, undefined);
  assert.equal(validateOpenPackage({ ...sourcePackage(), name: 'x'.repeat(600_000) }).ok, false);
  const sparse = new Array(2); sparse[1] = sourcePackage();
  assert.equal(compileOpenTemplate(templateFor(), sparse, context()).ok, false);
});
