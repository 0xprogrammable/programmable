import { canonicalJson } from './canonical-json.mjs';
import { assertOpenConfigSchema } from './open-config.mjs';

/** Candidate resource limits, not an onchain execution profile or an economic admission policy. */
export const OPEN_CONSTRAINT_LIMITS = Object.freeze({
  constraints: 64,
  bindings: 64,
  expressionDepth: 12,
  expressionNodes: 1_024,
  addTerms: 64,
  pathSegments: 16,
  identifierLength: 64,
  messageLength: 512,
  unitLength: 128,
  jsonDepth: 32,
  jsonNodes: 32_768,
  jsonArrayLength: 256,
  jsonObjectKeys: 256,
  jsonStringLength: 131_072,
  jsonBytes: 524_288,
  evaluationSteps: 262_144,
});

const L = OPEN_CONSTRAINT_LIMITS;
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const OPERATORS = new Set(['eq', 'lte', 'lt', 'gte', 'gt']);
const UINT_MAX = (1n << 256n) - 1n;
const encoder = new TextEncoder();

export class OpenConstraintError extends Error {
  constructor(code, message, path = '') {
    super(message);
    this.name = 'OpenConstraintError';
    this.code = code;
    this.path = path;
  }
}

function requireThat(condition, code, message, path) {
  if (!condition) throw new OpenConstraintError(code, message, path);
}

function pointer(path, part) {
  return `${path}/${String(part).replaceAll('~', '~0').replaceAll('/', '~1')}`;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function exactKeys(value, keys, path) {
  requireThat(isRecord(value) && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key)), 'CONSTRAINT_SHAPE',
  `Expected exactly: ${keys.join(', ')}`, path);
}

/** Inspect data descriptors before canonicalJson; neither array accessors nor toJSON are invoked. */
function preflight(value, root) {
  const ancestors = new Set();
  let nodes = 0;
  let textBytes = 0;
  function visit(item, path, depth) {
    requireThat(++nodes <= L.jsonNodes && depth <= L.jsonDepth,
      'CONSTRAINT_JSON_LIMIT', 'JSON node or depth limit exceeded', path);
    if (item === null || typeof item === 'boolean') return;
    if (typeof item === 'string') {
      requireThat(item.isWellFormed(), 'CONSTRAINT_JSON_DATA', 'Unpaired Unicode surrogates are not supported', path);
      requireThat(item.length <= L.jsonStringLength, 'CONSTRAINT_JSON_LIMIT', 'JSON string too long', path);
      textBytes += encoder.encode(JSON.stringify(item)).length;
      requireThat(textBytes <= L.jsonBytes, 'CONSTRAINT_JSON_LIMIT', 'JSON text budget exceeded', path);
      return;
    }
    if (typeof item === 'number') {
      requireThat(Number.isSafeInteger(item) && !Object.is(item, -0),
        'CONSTRAINT_JSON_DATA', 'JSON numbers must be safe integers', path);
      return;
    }
    requireThat(typeof item === 'object' && !ancestors.has(item),
      'CONSTRAINT_JSON_DATA', 'Expected acyclic JSON data', path);
    const array = Array.isArray(item);
    requireThat(array ? Object.getPrototypeOf(item) === Array.prototype : isRecord(item),
      'CONSTRAINT_JSON_DATA', 'Expected plain JSON objects and arrays', path);
    if (array) {
      requireThat(item.length <= L.jsonArrayLength, 'CONSTRAINT_JSON_LIMIT', 'JSON array too long', path);
    }
    const keys = Reflect.ownKeys(item);
    requireThat(keys.length <= (array ? L.jsonArrayLength + 1 : L.jsonObjectKeys),
      'CONSTRAINT_JSON_LIMIT', 'Too many JSON properties', path);
    if (array) requireThat(keys.length === item.length + 1,
      'CONSTRAINT_JSON_DATA', 'Sparse arrays and extra array properties are not JSON data', path);
    ancestors.add(item);
    for (const key of keys) {
      if (array && key === 'length') continue;
      const childPath = typeof key === 'string' ? pointer(path, key) : path;
      requireThat(typeof key === 'string' && !RESERVED.has(key),
        'CONSTRAINT_JSON_DATA', 'Reserved or non-string JSON property', childPath);
      requireThat(key.length <= L.jsonStringLength && key.isWellFormed(),
        'CONSTRAINT_JSON_DATA', 'Invalid JSON property name', childPath);
      if (array) {
        requireThat(/^(0|[1-9][0-9]*)$/.test(key) && Number(key) < item.length,
          'CONSTRAINT_JSON_DATA', 'Invalid array property', childPath);
      }
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      requireThat(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable,
        'CONSTRAINT_JSON_DATA', 'JSON properties must be enumerable data properties', childPath);
      textBytes += encoder.encode(JSON.stringify(key)).length;
      requireThat(textBytes <= L.jsonBytes, 'CONSTRAINT_JSON_LIMIT', 'JSON text budget exceeded', childPath);
      visit(descriptor.value, childPath, depth + 1);
    }
    ancestors.delete(item);
  }
  visit(value, root, 0);
  requireThat(encoder.encode(canonicalJson(value)).length <= L.jsonBytes,
    'CONSTRAINT_JSON_LIMIT', 'Canonical JSON byte limit exceeded', root);
}

function identifier(value, path, allowSelf = false) {
  requireThat((allowSelf && value === '$self') || (typeof value === 'string'
    && value.length <= L.identifierLength && /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value)
    && !RESERVED.has(value)), 'CONSTRAINT_IDENTIFIER', 'Invalid or reserved identifier', path);
}

function unit(value, path) {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= L.unitLength
    && value.isWellFormed() && encoder.encode(value).length <= L.unitLength,
  'CONSTRAINT_UNIT', 'Expected nonempty, well-formed unit text of at most 128 UTF-8 bytes', path);
  return value;
}

function uint(value, path) {
  requireThat(typeof value === 'string' && value.length <= 78 && /^(0|[1-9][0-9]*)$/.test(value),
    'CONSTRAINT_UINT', 'Expected a canonical unsigned decimal string', path);
  const result = BigInt(value);
  requireThat(result <= UINT_MAX, 'CONSTRAINT_UINT', 'Unsigned value exceeds 256 bits', path);
  return result;
}

function referencePath(value, path, minimum = 0) {
  requireThat(Array.isArray(value) && value.length >= minimum && value.length <= L.pathSegments,
    'CONSTRAINT_REFERENCE', 'Invalid reference path length', path);
  for (let index = 0; index < value.length; index++) {
    const segment = value[index];
    if (typeof segment === 'number') {
      requireThat(Number.isSafeInteger(segment) && segment >= 0 && segment < L.jsonArrayLength,
        'CONSTRAINT_REFERENCE', 'Array index is outside the supported range', pointer(path, index));
    } else {
      identifier(segment, pointer(path, index));
    }
  }
}

function assertExpression(expression, path, depth, state) {
  requireThat(depth <= L.expressionDepth && ++state.nodes <= L.expressionNodes,
    'CONSTRAINT_LIMIT', 'Expression depth or node limit exceeded', path);
  requireThat(isRecord(expression), 'CONSTRAINT_EXPRESSION', 'Expected an expression object', path);
  if (Object.hasOwn(expression, 'literal')) {
    exactKeys(expression, ['literal', 'unit'], path);
    uint(expression.literal, pointer(path, 'literal'));
    unit(expression.unit, pointer(path, 'unit'));
  } else if (Object.hasOwn(expression, 'ref') || Object.hasOwn(expression, 'sum')) {
    const kind = Object.hasOwn(expression, 'ref') ? 'ref' : 'sum';
    exactKeys(expression, [kind], path);
    const source = expression[kind];
    const sourcePath = pointer(path, kind);
    exactKeys(source, kind === 'ref' ? ['instance', 'path'] : ['instance', 'path', 'member'], sourcePath);
    identifier(source.instance, pointer(sourcePath, 'instance'), true);
    referencePath(source.path, pointer(sourcePath, 'path'));
    if (kind === 'sum') referencePath(source.member, pointer(sourcePath, 'member'), 1);
  } else if (Object.hasOwn(expression, 'add')) {
    exactKeys(expression, ['add'], path);
    requireThat(Array.isArray(expression.add) && expression.add.length > 0 && expression.add.length <= L.addTerms,
      'CONSTRAINT_LIMIT', 'Addition needs a bounded nonempty list of expressions', pointer(path, 'add'));
    for (let index = 0; index < expression.add.length; index++) {
      assertExpression(expression.add[index], pointer(pointer(path, 'add'), index), depth + 1, state);
    }
  } else {
    throw new OpenConstraintError('CONSTRAINT_EXPRESSION', 'Unknown expression form', path);
  }
}

export function assertOpenConstraints(constraints) {
  preflight(constraints, '/constraints');
  requireThat(Array.isArray(constraints) && constraints.length <= L.constraints,
    'CONSTRAINT_LIMIT', 'Expected a bounded array of constraints', '/constraints');
  const ids = new Set();
  const state = { nodes: 0 };
  for (let index = 0; index < constraints.length; index++) {
    const constraint = constraints[index];
    let path = pointer('/constraints', index);
    exactKeys(constraint, ['id', 'message', 'left', 'operator', 'right'], path);
    identifier(constraint.id, pointer(path, 'id'));
    path = pointer('/constraints', constraint.id);
    requireThat(!ids.has(constraint.id), 'CONSTRAINT_DUPLICATE_ID', 'Constraint IDs must be unique', path);
    ids.add(constraint.id);
    requireThat(typeof constraint.message === 'string' && constraint.message.length > 0
      && constraint.message.length <= L.messageLength, 'CONSTRAINT_MESSAGE', 'Invalid constraint message', path);
    requireThat(OPERATORS.has(constraint.operator), 'CONSTRAINT_OPERATOR', 'Unknown comparison operator', path);
    assertExpression(constraint.left, pointer(path, 'left'), 0, state);
    assertExpression(constraint.right, pointer(path, 'right'), 0, state);
  }
}

function step(context, path) {
  requireThat(++context.steps <= L.evaluationSteps,
    'CONSTRAINT_EVALUATION_LIMIT', 'Constraint evaluation budget exceeded', path);
}

function selectedSchema(schema, value, path, context) {
  step(context, path);
  if (schema.type !== 'variant') return schema;
  requireThat(isRecord(value) && Object.hasOwn(value, schema.tag),
    'CONSTRAINT_MISSING_VALUE', 'Variant tag is missing', pointer(path, schema.tag));
  const tag = value[schema.tag];
  requireThat(typeof tag === 'string' && Object.hasOwn(schema.variants, tag),
    'CONSTRAINT_REFERENCE', 'Unknown variant tag', pointer(path, schema.tag));
  return schema.variants[tag];
}

function resolve(schema, value, segments, path, context) {
  for (const segment of segments) {
    schema = selectedSchema(schema, value, path, context);
    if (schema.type === 'record') {
      requireThat(typeof segment === 'string' && Object.hasOwn(schema.fields, segment),
        'CONSTRAINT_REFERENCE', 'Reference does not name a declared field in the active branch', pointer(path, segment));
      requireThat(isRecord(value) && Object.hasOwn(value, segment),
        'CONSTRAINT_MISSING_VALUE', 'Referenced field is missing', pointer(path, segment));
      schema = schema.fields[segment];
    } else if (schema.type === 'array') {
      requireThat(typeof segment === 'number', 'CONSTRAINT_REFERENCE', 'Array references require numeric indices', path);
      requireThat(Array.isArray(value) && segment < value.length && Object.hasOwn(value, segment),
        'CONSTRAINT_MISSING_VALUE', 'Referenced array element is missing', pointer(path, segment));
      schema = schema.items;
    } else {
      throw new OpenConstraintError('CONSTRAINT_REFERENCE', 'Reference traverses a scalar value', path);
    }
    value = value[segment];
    path = pointer(path, segment);
  }
  return { schema: selectedSchema(schema, value, path, context), value, path };
}

function numeric(leaf) {
  const { schema, value, path } = leaf;
  requireThat(schema.type === 'uint', 'CONSTRAINT_NOT_UINT', 'Numeric references require a uint schema', path);
  const amount = uint(value, path);
  const maximum = (1n << BigInt(schema.bits ?? 256)) - 1n;
  requireThat(amount <= maximum && (!Object.hasOwn(schema, 'min') || amount >= BigInt(schema.min))
    && (!Object.hasOwn(schema, 'max') || amount <= BigInt(schema.max)),
  'CONSTRAINT_UINT_RANGE', 'Referenced value violates its uint schema bounds', path);
  return { amount, unit: unit(schema.unit ?? 'unitless', path) };
}

/** Infer from the schema, not from the first row. Every possible branch must declare the same numeric unit. */
function memberUnit(schema, segments, path, context) {
  step(context, path);
  if (schema.type === 'variant') {
    const units = Object.keys(schema.variants).sort().map((tag) => memberUnit(schema.variants[tag], segments, path, context));
    requireThat(units.every((entry) => entry === units[0]),
      'CONSTRAINT_UNIT_MISMATCH', 'Sum member has different units across variant branches', path);
    return units[0];
  }
  if (segments.length === 0) {
    requireThat(schema.type === 'uint', 'CONSTRAINT_NOT_UINT', 'Sum member must have a uint schema', path);
    return unit(schema.unit ?? 'unitless', path);
  }
  const [segment, ...remaining] = segments;
  if (schema.type === 'record') {
    requireThat(typeof segment === 'string' && Object.hasOwn(schema.fields, segment),
      'CONSTRAINT_REFERENCE', 'Sum member does not name a declared field in every branch', pointer(path, segment));
    return memberUnit(schema.fields[segment], remaining, pointer(path, segment), context);
  }
  requireThat(schema.type === 'array' && typeof segment === 'number',
    'CONSTRAINT_REFERENCE', 'Sum member traverses an incompatible schema', path);
  return memberUnit(schema.items, remaining, pointer(path, segment), context);
}

function expressionValue(expression, path, bindings, context) {
  step(context, path);
  if (Object.hasOwn(expression, 'literal')) return { amount: BigInt(expression.literal), unit: expression.unit };
  if (Object.hasOwn(expression, 'add')) {
    let total;
    for (let index = 0; index < expression.add.length; index++) {
      const childPath = pointer(pointer(path, 'add'), index);
      const value = expressionValue(expression.add[index], childPath, bindings, context);
      if (!total) total = { ...value };
      else {
        requireThat(total.unit === value.unit, 'CONSTRAINT_UNIT_MISMATCH', 'Addition requires identical units', childPath);
        total.amount += value.amount;
      }
    }
    return total;
  }
  const sum = Object.hasOwn(expression, 'sum');
  const reference = expression[sum ? 'sum' : 'ref'];
  requireThat(Object.hasOwn(bindings, reference.instance),
    'CONSTRAINT_BINDING', 'Referenced instance is not bound', path);
  const binding = bindings[reference.instance];
  const bindingPath = pointer(pointer('/bindings', reference.instance), 'value');
  const leaf = resolve(binding.schema, binding.value, reference.path, bindingPath, context);
  if (!sum) return numeric(leaf);
  requireThat(leaf.schema.type === 'array' && leaf.schema.items.type === 'record',
    'CONSTRAINT_REFERENCE', 'Sum requires an array with a record item schema', leaf.path);
  requireThat(Array.isArray(leaf.value) && leaf.value.length >= (leaf.schema.minItems ?? 0)
    && leaf.value.length <= leaf.schema.maxItems,
  'CONSTRAINT_REFERENCE', 'Sum value violates its array schema bounds', leaf.path);
  const inferred = memberUnit(leaf.schema.items, reference.member, leaf.path, context);
  let amount = 0n;
  for (let index = 0; index < leaf.value.length; index++) {
    const value = numeric(resolve(leaf.schema.items, leaf.value[index], reference.member,
      pointer(leaf.path, index), context));
    requireThat(value.unit === inferred, 'CONSTRAINT_UNIT_MISMATCH', 'Sum row has an incompatible unit', leaf.path);
    amount += value.amount;
  }
  return { amount, unit: inferred };
}

function compare(left, operator, right) {
  switch (operator) {
    case 'eq': return left === right;
    case 'lte': return left <= right;
    case 'lt': return left < right;
    case 'gte': return left >= right;
    case 'gt': return left > right;
    default: return false; // assertOpenConstraints rejects unknown operators.
  }
}

function issue(error, id) {
  return { id, message: error.message || 'Invalid constraint input',
    path: error.path || '', code: error.code || 'CONSTRAINT_INVALID_INPUT' };
}

/** Evaluate compiled/normalized values. This does not replace full configuration validation or financial review. */
export function evaluateOpenConstraints(constraints, bindings) {
  try { assertOpenConstraints(constraints); } catch (error) {
    return { ok: false, violations: [issue(error, '$constraints')] };
  }
  try {
    preflight(bindings, '/bindings');
    requireThat(isRecord(bindings) && Object.keys(bindings).length <= L.bindings,
      'CONSTRAINT_BINDING', 'Expected a bounded map of instance bindings', '/bindings');
    for (const name of Object.keys(bindings).sort()) {
      const path = pointer('/bindings', name);
      identifier(name, path, true);
      exactKeys(bindings[name], ['schema', 'value'], path);
      try { assertOpenConfigSchema(bindings[name].schema); } catch (error) {
        const suffix = (error.path || '').replace(/^\/schema(?=\/|$)/, '');
        throw new OpenConstraintError('CONSTRAINT_BINDING_SCHEMA', error.message,
          `${pointer(path, 'schema')}${suffix}`);
      }
    }
  } catch (error) {
    return { ok: false, violations: [issue(error, '$bindings')] };
  }
  const violations = [];
  const context = { steps: 0 };
  for (const constraint of [...constraints].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) {
    const path = pointer('/constraints', constraint.id);
    try {
      const left = expressionValue(constraint.left, pointer(path, 'left'), bindings, context);
      const right = expressionValue(constraint.right, pointer(path, 'right'), bindings, context);
      requireThat(left.unit === right.unit, 'CONSTRAINT_UNIT_MISMATCH', 'Comparison requires identical units', path);
      requireThat(compare(left.amount, constraint.operator, right.amount),
        'CONSTRAINT_UNSATISFIED', constraint.message, path);
    } catch (error) {
      violations.push(issue(error, constraint.id));
    }
  }
  return { ok: violations.length === 0, violations };
}
