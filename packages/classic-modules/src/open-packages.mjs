import { sha256, stringToHex } from 'viem';
import { canonicalJson, familyIdFor, safeRelativePath } from './index.mjs';
import { assertOpenConfigSchema, compileOpenConfig } from './open-config.mjs';
import { assertOpenConstraints, evaluateOpenConstraints } from './open-constraints.mjs';

export { assertOpenConfigSchema, compileOpenConfig, OPEN_CONFIG_LIMITS, OpenConfigError } from './open-config.mjs';
export { assertOpenConstraints, evaluateOpenConstraints, OPEN_CONSTRAINT_LIMITS, OpenConstraintError } from './open-constraints.mjs';

export const OPEN_PACKAGE_FORMAT = 'programmable.classic.source-package.v0.1';
export const OPEN_TEMPLATE_FORMAT = 'programmable.classic.template.v0.1';
export const OPEN_PLAN_FORMAT = 'programmable.classic.configuration-plan.v0.1';
export const OPEN_PLAN_LIMITS = Object.freeze({ packages: 128, instances: 64, links: 256, bytes: 512 * 1024 });

export class OpenPackageError extends Error {
  constructor(code, message, path = '') {
    super(message); this.name = 'OpenPackageError'; this.code = code; this.path = path;
  }
}
const fail = (code, message, path) => { throw new OpenPackageError(code, message, path); };
const need = (condition, code, message, path = '') => { if (!condition) fail(code, message, path); };
const reserved = new Set(['__proto__', 'prototype', 'constructor']);
const zeroAddress = `0x${'0'.repeat(40)}`;
const hex32 = /^0x[0-9a-f]{64}$/;
const sourceDigest = /^[0-9a-f]{64}$/;
const identifier = /^[a-z][a-z0-9_-]{0,63}$/;
const interfaceName = /^[a-z][a-z0-9_.-]{0,95}@[1-9][0-9]{0,5}$/;
const digest = (domain, value) => sha256(stringToHex(canonicalJson({ domain, value })));
const outcome = (work) => {
  try { return { ok: true, ...work() }; }
  catch (error) { return { ok: false, errors: [{ code: error.code || 'OPEN_INPUT_INVALID', message: error.message, path: error.path || '' }] }; }
};

/** Bound inert data before reading fields: even direct JS callers cannot inject getters. */
function jsonInput(value) {
  let nodes = 0;
  const visiting = new Set();
  function visit(item, depth) {
    need(++nodes <= 30_000 && depth <= 28, 'OPEN_INPUT_LIMIT', 'Input nesting or node budget exceeded');
    if (typeof item === 'string') {
      need(item.length <= OPEN_PLAN_LIMITS.bytes, 'OPEN_INPUT_LIMIT', 'String exceeds input budget'); return;
    }
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'number') {
      need(Number.isSafeInteger(item) && !Object.is(item, -0), 'OPEN_INPUT_INVALID', 'Use exact integer data'); return;
    }
    need(typeof item === 'object' && !visiting.has(item), 'OPEN_INPUT_INVALID', 'Use acyclic JSON data');
    need(Array.isArray(item) ? Object.getPrototypeOf(item) === Array.prototype
      : [Object.prototype, null].includes(Object.getPrototypeOf(item)), 'OPEN_INPUT_INVALID', 'Use ordinary JSON objects');
    const keys = Reflect.ownKeys(item);
    need(keys.length <= 4097, 'OPEN_INPUT_LIMIT', 'Too many properties');
    visiting.add(item);
    for (const key of keys) {
      if (Array.isArray(item) && key === 'length') continue;
      need(typeof key === 'string' && !reserved.has(key), 'OPEN_INPUT_INVALID', 'Reserved or symbolic property');
      const property = Object.getOwnPropertyDescriptor(item, key);
      need(property.enumerable && !property.get && !property.set, 'OPEN_INPUT_INVALID', 'Accessors and hidden properties are unsupported');
      if (Array.isArray(item)) need(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < item.length,
        'OPEN_INPUT_INVALID', 'Unexpected array property');
      visit(property.value, depth + 1);
    }
    if (Array.isArray(item)) need(keys.length === item.length + 1, 'OPEN_INPUT_INVALID', 'Sparse arrays are unsupported');
    visiting.delete(item);
  }
  visit(value, 0);
  const serialized = canonicalJson(value);
  need(new TextEncoder().encode(serialized).length <= OPEN_PLAN_LIMITS.bytes, 'OPEN_INPUT_LIMIT', 'Input exceeds byte budget');
  return JSON.parse(serialized);
}
function object(value, required, optional, path) {
  need(value && typeof value === 'object' && !Array.isArray(value), 'OPEN_SHAPE', 'Expected an object', path);
  need(required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => required.includes(key) || optional.includes(key)),
  'OPEN_SHAPE', `Expected ${required.join(', ')}${optional.length ? `; optional: ${optional.join(', ')}` : ''}`, path);
}
function list(value, maximum, path) {
  need(Array.isArray(value) && value.length <= maximum, 'OPEN_LIST_LIMIT', `Expected a list of at most ${maximum} entries`, path);
}
function label(value, maximum, path) {
  need(typeof value === 'string' && value.trim().length > 0 && value.length <= maximum,
    'OPEN_TEXT', `Expected nonempty text of at most ${maximum} characters`, path);
}
function id(value, path) {
  need(typeof value === 'string' && identifier.test(value) && !reserved.has(value), 'OPEN_ID', 'Invalid identifier', path);
}
function address(value, path) {
  need(typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
    && value.toLowerCase() !== zeroAddress, 'OPEN_ADDRESS', 'Expected a nonzero EVM address', path);
}
function unique(values, path) {
  need(new Set(values).size === values.length, 'OPEN_DUPLICATE', 'Duplicate entries are not allowed', path);
}
function namedPorts(ports, path) {
  object(ports, [], Object.keys(ports || {}), path);
  need(Object.keys(ports).length <= 32, 'OPEN_LIST_LIMIT', 'At most 32 ports per direction', path);
  for (const [name, type] of Object.entries(ports)) {
    id(name, `${path}/${name}`);
    need(typeof type === 'string' && interfaceName.test(type), 'OPEN_INTERFACE', 'Use an exact namespaced interface@version', `${path}/${name}`);
  }
}
function assertPackage(p) {
  object(p, ['format', 'name', 'version', 'author', 'rewardWallet', 'familySalt', 'source', 'components',
    'configuration', 'ports', 'constraints', 'management', 'requiresHost', 'documentation'], ['extensions'], '');
  need(p.format === OPEN_PACKAGE_FORMAT, 'OPEN_FORMAT', 'Unsupported source package format', '/format');
  label(p.name, 96, '/name');
  need(typeof p.version === 'string' && /^[0-9]{1,6}\.[0-9]{1,6}\.[0-9]{1,6}(?:-[a-z0-9.-]{1,40})?$/.test(p.version),
    'OPEN_VERSION', 'Use an explicit semantic version', '/version');
  address(p.author, '/author'); address(p.rewardWallet, '/rewardWallet');
  need(typeof p.familySalt === 'string' && hex32.test(p.familySalt), 'OPEN_FAMILY', 'Family salt must be lowercase bytes32', '/familySalt');
  object(p.source, ['files'], ['repository', 'revision'], '/source');
  const repositoryDeclared = Object.hasOwn(p.source, 'repository');
  need(repositoryDeclared === Object.hasOwn(p.source, 'revision'),
    'OPEN_SOURCE', 'Optional Git provenance requires both repository and revision', '/source');
  if (repositoryDeclared) {
    need(typeof p.source.repository === 'string', 'OPEN_SOURCE', 'Repository URL must be a string', '/source/repository');
    let url;
    try { url = new URL(p.source.repository); } catch { fail('OPEN_SOURCE', 'Invalid repository URL', '/source/repository'); }
    need(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash,
      'OPEN_SOURCE', 'Repository must be HTTPS without credentials, query or fragment', '/source/repository');
    need(typeof p.source.revision === 'string' && /^[0-9a-f]{40}$/.test(p.source.revision) && !/^0+$/.test(p.source.revision),
      'OPEN_SOURCE', 'Pin an exact Git revision', '/source/revision');
  }
  list(p.source.files, 128, '/source/files');
  need(p.source.files.length > 0, 'OPEN_SOURCE', 'Declare source files', '/source/files');
  for (const [i, file] of p.source.files.entries()) {
    object(file, ['path', 'sha256'], [], `/source/files/${i}`);
    need(safeRelativePath(file.path), 'OPEN_SOURCE_PATH', 'Source paths are relative to the explicit workspace root', `/source/files/${i}/path`);
    need(typeof file.sha256 === 'string' && sourceDigest.test(file.sha256), 'OPEN_SOURCE', 'Expected lowercase SHA-256', `/source/files/${i}/sha256`);
  }
  unique(p.source.files.map((f) => f.path), '/source/files');
  const files = new Set(p.source.files.map((f) => f.path));
  need(files.has(p.documentation), 'OPEN_DOCUMENTATION', 'Documentation must be a pinned source file', '/documentation');
  list(p.components, 64, '/components');
  need(p.components.length > 0, 'OPEN_COMPONENT', 'Declare at least one component', '/components');
  for (const [i, component] of p.components.entries()) {
    const at = `/components/${i}`;
    object(component, ['id', 'runtime', 'sourcePath', 'entrypoint'], [], at);
    id(component.id, `${at}/id`);
    need(typeof component.runtime === 'string' && interfaceName.test(component.runtime), 'OPEN_RUNTIME', 'Runtime must be namespaced and versioned', `${at}/runtime`);
    need(files.has(component.sourcePath), 'OPEN_COMPONENT', 'Component source must be pinned', `${at}/sourcePath`);
    label(component.entrypoint, 160, `${at}/entrypoint`);
  }
  unique(p.components.map((c) => c.id), '/components');
  assertOpenConfigSchema(p.configuration);
  object(p.ports, ['inputs', 'outputs'], [], '/ports');
  namedPorts(p.ports.inputs, '/ports/inputs'); namedPorts(p.ports.outputs, '/ports/outputs');
  assertOpenConstraints(p.constraints);
  object(p.management, ['summary', 'reads', 'actions'], [], '/management');
  label(p.management.summary, 1000, '/management/summary');
  const componentIds = new Set(p.components.map((c) => c.id));
  for (const collection of ['reads', 'actions']) {
    list(p.management[collection], 64, `/management/${collection}`);
    for (const [i, operation] of p.management[collection].entries()) {
      const at = `/management/${collection}/${i}`;
      object(operation, ['id', 'label', 'component', 'entrypoint', 'description'], collection === 'actions' ? ['role', 'inputs'] : [], at);
      id(operation.id, `${at}/id`); label(operation.label, 96, `${at}/label`);
      label(operation.entrypoint, 160, `${at}/entrypoint`); label(operation.description, 1000, `${at}/description`);
      need(componentIds.has(operation.component), 'OPEN_COMPONENT', 'Operation refers to an undeclared component', `${at}/component`);
      if (collection === 'actions') {
        need(Object.hasOwn(operation, 'role') && Object.hasOwn(operation, 'inputs'), 'OPEN_ACTION', 'Actions must declare role and input schema', at);
        id(operation.role, `${at}/role`); assertOpenConfigSchema(operation.inputs);
      }
    }
    unique(p.management[collection].map((op) => op.id), `/management/${collection}`);
  }
  list(p.requiresHost, 64, '/requiresHost'); unique(p.requiresHost, '/requiresHost');
  for (const capability of p.requiresHost) need(typeof capability === 'string' && interfaceName.test(capability),
    'OPEN_CAPABILITY', 'Host requirements need exact namespaced versions', '/requiresHost');
  if (Object.hasOwn(p, 'extensions')) {
    object(p.extensions, [], Object.keys(p.extensions), '/extensions');
    for (const key of Object.keys(p.extensions)) need(interfaceName.test(key), 'OPEN_EXTENSION', 'Extensions need versioned namespaces', '/extensions');
  }
  return {
    descriptor: p, packageId: digest(OPEN_PACKAGE_FORMAT, p), familyId: familyIdFor(p.author, p.familySalt),
    sourceVerified: false, authorAuthenticated: false, reviewStatus: 'unreviewed', onchainApproved: false,
  };
}

/** Syntax, type and identity validation only. This does not fetch source or authenticate an author. */
export function validateOpenPackage(descriptor) {
  return outcome(() => assertPackage(jsonInput(descriptor)));
}
export function openPackageId(descriptor) { return assertPackage(jsonInput(descriptor)).packageId; }

function assertTemplate(t) {
  object(t, ['format', 'name', 'instances', 'links', 'constraints'], [], '');
  need(t.format === OPEN_TEMPLATE_FORMAT, 'OPEN_FORMAT', 'Unsupported template format', '/format');
  label(t.name, 96, '/name'); list(t.instances, OPEN_PLAN_LIMITS.instances, '/instances');
  for (const [i, instance] of t.instances.entries()) {
    object(instance, ['id', 'packageId', 'parameters'], [], `/instances/${i}`);
    id(instance.id, `/instances/${i}/id`);
    need(typeof instance.packageId === 'string' && hex32.test(instance.packageId), 'OPEN_PACKAGE_ID', 'Expected an exact source package digest', `/instances/${i}/packageId`);
  }
  unique(t.instances.map((instance) => instance.id), '/instances');
  list(t.links, OPEN_PLAN_LIMITS.links, '/links');
  for (const [i, link] of t.links.entries()) {
    object(link, ['from', 'to'], [], `/links/${i}`);
    for (const end of ['from', 'to']) {
      object(link[end], ['instance', 'port'], [], `/links/${i}/${end}`);
      id(link[end].instance, `/links/${i}/${end}/instance`); id(link[end].port, `/links/${i}/${end}/port`);
    }
  }
  assertOpenConstraints(t.constraints);
}
function orderedGraph(instances, links) {
  const ids = instances.map((i) => i.id).sort();
  const edges = new Map(ids.map((key) => [key, new Set()]));
  const indegree = new Map(ids.map((key) => [key, 0]));
  for (const link of links) {
    const a = link.from.instance; const b = link.to.instance;
    if (!edges.get(a).has(b)) { edges.get(a).add(b); indegree.set(b, indegree.get(b) + 1); }
  }
  const ready = ids.filter((key) => indegree.get(key) === 0);
  const order = [];
  while (ready.length) {
    const next = ready.shift(); order.push(next);
    for (const dependent of [...edges.get(next)].sort()) {
      indegree.set(dependent, indegree.get(dependent) - 1);
      if (indegree.get(dependent) === 0) { ready.push(dependent); ready.sort(); }
    }
  }
  need(order.length === ids.length, 'OPEN_GRAPH_CYCLE', 'This configuration compiler requires acyclic preparation links; no runtime cycle semantics are inferred', '/links');
  return order;
}

/** Resolve a source-bound configuration graph. It is deliberately not a launch transaction. */
export function compileOpenTemplate(template, packages, context = {}) {
  return outcome(() => {
    const t = jsonInput(template); assertTemplate(t);
    const rawPackages = jsonInput(packages); list(rawPackages, OPEN_PLAN_LIMITS.packages, '/packages');
    const checked = rawPackages.map(assertPackage);
    unique(checked.map((p) => p.packageId), '/packages');
    const catalogue = new Map(checked.map((p) => [p.packageId, p]));
    const c = jsonInput(context);
    object(c, [], ['roles', 'assets', 'components', 'hostCapabilities'], '/context');
    const capabilities = Object.hasOwn(c, 'hostCapabilities') ? c.hostCapabilities : [];
    list(capabilities, 256, '/context/hostCapabilities'); unique(capabilities, '/context/hostCapabilities');
    for (const capability of capabilities) need(typeof capability === 'string' && interfaceName.test(capability),
      'OPEN_CAPABILITY', 'Host capability must be namespaced and versioned', '/context/hostCapabilities');
    const configContext = Object.fromEntries(['roles', 'assets', 'components']
      .filter((key) => Object.hasOwn(c, key)).map((key) => [key, c[key]]));
    // Validate supplied maps even for an empty template; present null/false is not omission.
    compileOpenConfig({ type: 'record', fields: {}, required: [] }, {}, configContext);
    const instances = [];
    const byInstance = new Map();
    const environments = Object.create(null);
    const violations = [];
    for (const instance of [...t.instances].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
      const pkg = catalogue.get(instance.packageId);
      need(pkg, 'OPEN_PACKAGE_MISSING', `Missing exact source package for ${instance.id}`, `/instances/${instance.id}/packageId`);
      const config = compileOpenConfig(pkg.descriptor.configuration, instance.parameters, configContext);
      const environment = { schema: pkg.descriptor.configuration, value: config.value };
      environments[instance.id] = environment;
      const local = evaluateOpenConstraints(pkg.descriptor.constraints, { $self: environment });
      for (const violation of local.violations) violations.push({ ...violation, instance: instance.id });
      const item = {
        id: instance.id, packageId: pkg.packageId, familyId: pkg.familyId,
        configuration: config.value, configurationBytes: config.encoded, abiParameters: config.abiParameters,
        bindings: config.bindings, components: pkg.descriptor.components,
        management: pkg.descriptor.management,
      };
      instances.push(item); byInstance.set(instance.id, pkg);
    }
    const occupied = new Set();
    const links = [];
    for (const link of t.links) {
      const from = byInstance.get(link.from.instance); const to = byInstance.get(link.to.instance);
      need(from && to, 'OPEN_LINK_INSTANCE', 'Connection references a missing instance', '/links');
      const output = from.descriptor.ports.outputs[link.from.port];
      const input = to.descriptor.ports.inputs[link.to.port];
      need(output && input, 'OPEN_LINK_PORT', 'Connection references an undeclared port', '/links');
      need(output === input, 'OPEN_LINK_TYPE', `Interface mismatch: ${output} versus ${input}`, '/links');
      const target = `${link.to.instance}/${link.to.port}`;
      need(!occupied.has(target), 'OPEN_LINK_DUPLICATE', 'An input must have exactly one declared source', `/links/${target}`);
      occupied.add(target); links.push({ ...link, interface: input });
    }
    for (const [instanceId, pkg] of byInstance) {
      for (const port of Object.keys(pkg.descriptor.ports.inputs)) need(occupied.has(`${instanceId}/${port}`),
        'OPEN_LINK_MISSING', 'Required input has no connected source', `/instances/${instanceId}/ports/${port}`);
    }
    links.sort((a, b) => canonicalJson(a) < canonicalJson(b) ? -1 : canonicalJson(a) > canonicalJson(b) ? 1 : 0);
    const preparationOrder = orderedGraph(instances, links);
    violations.push(...evaluateOpenConstraints(t.constraints, environments).violations);
    if (violations.length) return { ok: false, scope: 'configuration-preview', errors: violations,
      launchable: false, onchainApproved: false };
    const families = new Map();
    for (const pkg of byInstance.values()) {
      const entry = { familyId: pkg.familyId, author: pkg.descriptor.author.toLowerCase(), rewardWallet: pkg.descriptor.rewardWallet.toLowerCase() };
      const existing = families.get(entry.familyId);
      need(!existing || canonicalJson(existing) === canonicalJson(entry), 'OPEN_FAMILY_CONFLICT',
        'Selected revisions disagree about the same family identity or declared reward wallet', '/instances');
      families.set(entry.familyId, entry);
    }
    const requirements = [...new Set([...byInstance.values()].flatMap((p) => p.descriptor.requiresHost))].sort();
    const model = {
      format: OPEN_PLAN_FORMAT, instances, links, preparationOrder,
      constraints: [...t.constraints].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      authorFamilies: [...families.values()].sort((a, b) => a.familyId < b.familyId ? -1 : a.familyId > b.familyId ? 1 : 0),
      hostRequirements: requirements,
    };
    // The entire artifact is checked again: composition can expand bounded inputs.
    const plan = jsonInput(model);
    return {
      scope: 'configuration-preview', plan, planId: digest(OPEN_PLAN_FORMAT, plan),
      missingHostCapabilities: requirements.filter((capability) => !capabilities.includes(capability)),
      launchable: false, onchainApproved: false, sourceVerified: false, runtimeVerified: false,
      authorizationVerified: false, reviewStatus: 'unreviewed', engineStatus: 'not-implemented',
    };
  });
}
