import { canonicalJson } from './canonical-json.mjs';
import { encodeAbiParameters, isAddress } from 'viem';

/** Local candidate limits, not a promise about an onchain engine's execution budget. */
export const OPEN_CONFIG_LIMITS = Object.freeze({
  schemaDepth: 12, schemaNodes: 512, recordFields: 64, variantBranches: 64, arrayItems: 256,
  stringBytes: 16_384, bytesLength: 16_384, schemaBytes: 65_536, valueBytes: 131_072,
  contextBytes: 131_072, jsonDepth: 32, jsonNodes: 16_384, encodedBytes: 262_144,
});

export class OpenConfigError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = 'OpenConfigError';
    this.code = code;
    this.path = path;
  }
}

const UTF8 = new TextEncoder();
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const REFERENCE_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT256_DECIMAL = MAX_UINT256.toString();

function fail(code, path, message) { throw new OpenConfigError(code, path, message); }
function need(condition, code, path, message) { if (!condition) fail(code, path, message); }
function at(path, key) { return `${path}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`; }
function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function wellFormed(value) {
  for (let index = 0; index < value.length; index++) {
    const point = value.charCodeAt(index);
    if (point >= 0xd800 && point <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (point >= 0xdc00 && point <= 0xdfff) return false;
  }
  return true;
}
function dataString(value, path, maximum, allowEmpty = true) {
  need(typeof value === 'string', 'OPEN_CONFIG_TYPE', path, 'Expected a string');
  need(wellFormed(value), 'OPEN_CONFIG_UNICODE', path, 'Unpaired Unicode surrogates are not supported');
  need((allowEmpty || value.length > 0) && value.length <= maximum && UTF8.encode(value).length <= maximum,
    'OPEN_CONFIG_STRING_LIMIT', path, `String exceeds its ${maximum}-byte UTF-8 bound or is empty`);
}

/**
 * Inspect descriptors before reading data. In particular, canonicalJson's array
 * mapping must never be the first operation on an untrusted accessor array.
 * Plain in-memory JSON data is accepted; functions, BigInts and exotic objects are not.
 */
function inspectJson(value, path, maximumBytes) {
  const ancestors = new Set();
  let nodes = 0;
  let bytes = 0;
  function charge(amount, location) {
    bytes += amount;
    need(bytes <= maximumBytes, 'OPEN_CONFIG_JSON_LIMIT', location, `JSON exceeds ${maximumBytes} bytes`);
  }
  function visit(item, location, depth) {
    need(depth <= OPEN_CONFIG_LIMITS.jsonDepth, 'OPEN_CONFIG_JSON_DEPTH', location, 'JSON nesting is too deep');
    need(++nodes <= OPEN_CONFIG_LIMITS.jsonNodes, 'OPEN_CONFIG_JSON_NODES', location, 'JSON has too many values');
    if (typeof item === 'string') {
      dataString(item, location, maximumBytes);
      charge(UTF8.encode(JSON.stringify(item)).length, location); return;
    }
    if (item === null || typeof item === 'boolean') { charge(item === null ? 4 : item ? 4 : 5, location); return; }
    if (typeof item === 'number') {
      need(Number.isSafeInteger(item) && !Object.is(item, -0), 'OPEN_CONFIG_NUMBER', location, 'JSON numbers must be safe integers; use a decimal string for large uint values');
      charge(String(item).length, location); return;
    }
    need(item !== null && typeof item === 'object', 'OPEN_CONFIG_JSON_TYPE', location, 'Expected plain JSON data');
    need(!ancestors.has(item), 'OPEN_CONFIG_CYCLE', location, 'Cyclic data is not supported');
    need(Array.isArray(item) ? Object.getPrototypeOf(item) === Array.prototype : plain(item),
      'OPEN_CONFIG_PROTOTYPE', location, 'Only plain records and ordinary arrays are supported');
    const keys = Reflect.ownKeys(item);
    need(keys.length <= OPEN_CONFIG_LIMITS.jsonNodes, 'OPEN_CONFIG_JSON_NODES', location, 'Too many object properties');
    need(keys.every((key) => typeof key === 'string'), 'OPEN_CONFIG_PROPERTY', location, 'Symbol properties are not supported');
    ancestors.add(item);
    charge(2, location);
    if (Array.isArray(item)) {
      const length = Object.getOwnPropertyDescriptor(item, 'length').value;
      need(length <= OPEN_CONFIG_LIMITS.jsonNodes && keys.length === length + 1,
        'OPEN_CONFIG_ARRAY_SHAPE', location, 'Arrays must be dense and have no extra properties');
      for (let index = 0; index < length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        need(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable,
          'OPEN_CONFIG_ACCESSOR', at(location, index), 'Array entries must be enumerable data properties');
        if (index) charge(1, location);
        visit(descriptor.value, at(location, index), depth + 1);
      }
    } else {
      let index = 0;
      for (const key of keys) {
        need(!RESERVED.has(key), 'OPEN_CONFIG_RESERVED_KEY', at(location, key), 'Reserved keys are not supported');
        dataString(key, at(location, key), maximumBytes);
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        need(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable,
          'OPEN_CONFIG_ACCESSOR', at(location, key), 'Object fields must be enumerable data properties');
        charge(UTF8.encode(JSON.stringify(key)).length + 1 + (index++ ? 1 : 0), location);
        visit(descriptor.value, at(location, key), depth + 1);
      }
    }
    ancestors.delete(item);
  }
  visit(value, path, 0);
  // The safe walk precedes canonicalization and gives its errors structured paths.
  return canonicalJson(value);
}

function keysOnly(value, required, optional, path) {
  need(plain(value), 'OPEN_CONFIG_TYPE', path, 'Expected a plain object');
  const permitted = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) need(permitted.has(key), 'OPEN_CONFIG_UNKNOWN_FIELD', at(path, key), 'Unknown field');
  for (const key of required) need(Object.hasOwn(value, key), 'OPEN_CONFIG_REQUIRED', at(path, key), 'Required field is missing');
}
function name(value, path, reference = false) {
  need(typeof value === 'string' && (reference ? REFERENCE_NAME : FIELD_NAME).test(value) && !RESERVED.has(value),
    'OPEN_CONFIG_NAME', path, 'Expected a bounded non-reserved identifier');
}
function integerBound(value, path, maximum, minimum = 0) {
  need(Number.isSafeInteger(value) && value >= minimum && value <= maximum,
    'OPEN_CONFIG_BOUND', path, `Expected an integer from ${minimum} through ${maximum}`);
}
function uint(value, path) {
  if (typeof value === 'number') {
    need(Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0),
      'OPEN_CONFIG_UINT', path, 'Use a nonnegative safe integer or unsigned decimal string');
    return BigInt(value);
  }
  need(typeof value === 'string' && /^[0-9]+$/.test(value), 'OPEN_CONFIG_UINT', path, 'Expected an unsigned decimal string');
  const normalized = value.replace(/^0+(?=.)/, '');
  need(normalized.length < MAX_UINT256_DECIMAL.length
    || (normalized.length === MAX_UINT256_DECIMAL.length && normalized <= MAX_UINT256_DECIMAL),
  'OPEN_CONFIG_UINT_RANGE', path, 'Value exceeds uint256');
  return BigInt(normalized);
}
function uintRange(schema, path) {
  const bits = schema.bits ?? 256;
  integerBound(bits, at(path, 'bits'), 256, 8);
  need(bits % 8 === 0, 'OPEN_CONFIG_UINT_BITS', at(path, 'bits'), 'ABI uint widths must be multiples of eight');
  const typeMaximum = (1n << BigInt(bits)) - 1n;
  const minimum = Object.hasOwn(schema, 'min') ? uint(schema.min, at(path, 'min')) : 0n;
  const maximum = Object.hasOwn(schema, 'max') ? uint(schema.max, at(path, 'max')) : typeMaximum;
  need(minimum <= maximum && maximum <= typeMaximum, 'OPEN_CONFIG_UINT_RANGE', path, 'Invalid uint range for its ABI width');
  return { bits, minimum, maximum };
}

export function assertOpenConfigSchema(schema) {
  inspectJson(schema, '/schema', OPEN_CONFIG_LIMITS.schemaBytes);
  let nodes = 0;
  function visit(node, path, depth) {
    need(depth <= OPEN_CONFIG_LIMITS.schemaDepth, 'OPEN_CONFIG_SCHEMA_DEPTH', path, 'Schema nesting is too deep');
    need(++nodes <= OPEN_CONFIG_LIMITS.schemaNodes, 'OPEN_CONFIG_SCHEMA_NODES', path, 'Schema has too many nodes');
    need(plain(node) && typeof node.type === 'string', 'OPEN_CONFIG_SCHEMA_TYPE', path, 'Every schema node needs a type');
    const metadata = ['label', 'help'];
    if (Object.hasOwn(node, 'label')) dataString(node.label, at(path, 'label'), 120, false);
    if (Object.hasOwn(node, 'help')) dataString(node.help, at(path, 'help'), 2000, false);
    if (node.type === 'record') {
      keysOnly(node, ['type', 'fields', 'required'], metadata, path);
      need(plain(node.fields), 'OPEN_CONFIG_SCHEMA_FIELDS', at(path, 'fields'), 'Record fields must be an object');
      const fields = Object.keys(node.fields).sort();
      need(fields.length <= OPEN_CONFIG_LIMITS.recordFields, 'OPEN_CONFIG_SCHEMA_FIELDS', at(path, 'fields'), 'Record has too many fields');
      need(Array.isArray(node.required), 'OPEN_CONFIG_SCHEMA_REQUIRED', at(path, 'required'), 'required must be an array');
      const required = new Set();
      for (let index = 0; index < node.required.length; index++) {
        const key = node.required[index];
        name(key, at(at(path, 'required'), index));
        need(Object.hasOwn(node.fields, key) && !required.has(key), 'OPEN_CONFIG_SCHEMA_REQUIRED', at(at(path, 'required'), index), 'Required field must exist and occur once');
        required.add(key);
      }
      for (const field of fields) { name(field, at(at(path, 'fields'), field)); visit(node.fields[field], at(at(path, 'fields'), field), depth + 1); }
    } else if (node.type === 'array') {
      keysOnly(node, ['type', 'items', 'maxItems'], [...metadata, 'minItems'], path);
      integerBound(node.maxItems, at(path, 'maxItems'), OPEN_CONFIG_LIMITS.arrayItems);
      integerBound(node.minItems ?? 0, at(path, 'minItems'), node.maxItems);
      visit(node.items, at(path, 'items'), depth + 1);
    } else if (node.type === 'uint') {
      keysOnly(node, ['type'], [...metadata, 'bits', 'min', 'max', 'unit'], path);
      uintRange(node, path);
      if (Object.hasOwn(node, 'unit')) dataString(node.unit, at(path, 'unit'), 128, false);
    } else if (node.type === 'string' || node.type === 'bytes') {
      keysOnly(node, ['type', 'maxLength'], metadata, path);
      integerBound(node.maxLength, at(path, 'maxLength'), node.type === 'string' ? OPEN_CONFIG_LIMITS.stringBytes : OPEN_CONFIG_LIMITS.bytesLength);
    } else if (['bool', 'address', 'account', 'asset', 'component'].includes(node.type)) {
      keysOnly(node, ['type'], metadata, path);
    } else if (node.type === 'variant') {
      keysOnly(node, ['type', 'tag', 'variants'], metadata, path);
      name(node.tag, at(path, 'tag'));
      need(plain(node.variants), 'OPEN_CONFIG_SCHEMA_VARIANTS', at(path, 'variants'), 'Variant branches must be an object');
      const branches = Object.keys(node.variants).sort();
      need(branches.length > 0 && branches.length <= OPEN_CONFIG_LIMITS.variantBranches,
        'OPEN_CONFIG_SCHEMA_VARIANTS', at(path, 'variants'), 'Variant needs one to 64 branches');
      for (const branch of branches) {
        const location = at(at(path, 'variants'), branch);
        name(branch, location);
        need(plain(node.variants[branch]) && node.variants[branch].type === 'record',
          'OPEN_CONFIG_VARIANT_RECORD', location, 'Each variant branch must be a record schema');
        visit(node.variants[branch], location, depth + 1);
        need(!Object.hasOwn(node.variants[branch].fields, node.tag), 'OPEN_CONFIG_VARIANT_TAG', location, 'Branch fields cannot contain the discriminator');
      }
    } else fail('OPEN_CONFIG_SCHEMA_TYPE', at(path, 'type'), 'Unsupported schema type');
  }
  visit(schema, '/schema', 0);
}

const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
function address(value, path) {
  need(typeof value === 'string' && isAddress(value), 'OPEN_CONFIG_ADDRESS', path,
    'Expected an EVM address with a valid checksum when mixed case');
  return value.toLowerCase();
}

function checkedContext(context) {
  inspectJson(context, '/context', OPEN_CONFIG_LIMITS.contextBytes);
  keysOnly(context, [], ['roles', 'assets', 'components'], '/context');
  const output = { roles: {}, assets: {}, components: {} };
  for (const kind of ['roles', 'assets', 'components']) {
    if (!Object.hasOwn(context, kind)) continue;
    const map = context[kind]; const path = at('/context', kind);
    need(plain(map), 'OPEN_CONFIG_CONTEXT', path, 'Reference context must be a plain map');
    need(Object.keys(map).length <= OPEN_CONFIG_LIMITS.arrayItems, 'OPEN_CONFIG_CONTEXT_LIMIT', path, 'Reference map has too many entries');
    for (const key of Object.keys(map).sort()) {
      const location = at(path, key); name(key, location, true);
      if (kind !== 'assets') output[kind][key] = address(map[key], location);
      else {
        const asset = map[key];
        keysOnly(asset, ['chainId', 'address', 'decimals'], [], location);
        const chainId = uint(asset.chainId, at(location, 'chainId'));
        need(chainId > 0n, 'OPEN_CONFIG_CHAIN_ID', at(location, 'chainId'), 'Asset chainId must be positive');
        integerBound(asset.decimals, at(location, 'decimals'), 255);
        output.assets[key] = { chainId: chainId.toString(), address: address(asset.address, at(location, 'address')), decimals: asset.decimals };
      }
    }
  }
  return output;
}

function abiParameter(schema, parameterName = 'value') {
  if (schema.type === 'record') {
    // Zero-field tuples are not interoperable with ordinary ABI decoders. This
    // constant sentinel gives an empty semantic record an unambiguous ABI word.
    if (Object.keys(schema.fields).length === 0) return { name: parameterName, type: 'tuple', components: [{ name: '_empty', type: 'bool' }] };
    const required = new Set(schema.required);
    return { name: parameterName, type: 'tuple', components: Object.keys(schema.fields).sort().map((field) => {
      const parameter = abiParameter(schema.fields[field], field);
      return required.has(field) ? parameter : { name: field, type: 'tuple', components: [
        { name: 'present', type: 'bool' }, { ...parameter, name: 'value' },
      ] };
    }) };
  }
  if (schema.type === 'array') {
    const item = abiParameter(schema.items, parameterName);
    return { ...item, type: `${item.type}[]` };
  }
  if (schema.type === 'variant') return { name: parameterName, type: 'tuple', components: [
    { name: 'index', type: 'uint16' }, { name: 'data', type: 'bytes' },
  ] };
  if (schema.type === 'uint') return { name: parameterName, type: `uint${schema.bits ?? 256}` };
  if (['account', 'asset', 'component'].includes(schema.type)) return { name: parameterName, type: 'address' };
  return { name: parameterName, type: schema.type };
}

/** Type-level zero only. It need not satisfy semantic min/required rules because presence is false. */
function absentAbiValue(schema) {
  if (schema.type === 'record') {
    if (Object.keys(schema.fields).length === 0) return [false];
    const required = new Set(schema.required);
    return Object.keys(schema.fields).sort().map((field) => {
      const value = absentAbiValue(schema.fields[field]);
      return required.has(field) ? value : [false, value];
    });
  }
  if (schema.type === 'array') return [];
  if (schema.type === 'variant') return [0n, '0x'];
  if (schema.type === 'uint') return 0n;
  if (schema.type === 'bool') return false;
  if (schema.type === 'bytes') return '0x';
  if (schema.type === 'string') return '';
  return ZERO_ADDRESS;
}

function dynamicAbi(parameter) {
  if (parameter.type.endsWith('[]') || parameter.type === 'string' || parameter.type === 'bytes') return true;
  return parameter.type === 'tuple' && parameter.components.some(dynamicAbi);
}
function abiSize(parameters, values, path) {
  let size = 0;
  function add(amount) {
    size += amount;
    need(size <= OPEN_CONFIG_LIMITS.encodedBytes, 'OPEN_CONFIG_ENCODED_LIMIT', path, 'Encoded configuration exceeds its byte budget');
  }
  function payload(parameter, value) {
    if (parameter.type.endsWith('[]')) {
      const item = { ...parameter, type: parameter.type.slice(0, -2) };
      return 32 + abiSize(value.map(() => item), value, path);
    }
    if (parameter.type === 'tuple') return abiSize(parameter.components, value, path);
    if (parameter.type === 'bytes') return 32 + Math.ceil((value.length - 2) / 2 / 32) * 32;
    if (parameter.type === 'string') return 32 + Math.ceil(UTF8.encode(value).length / 32) * 32;
    return 32;
  }
  for (let index = 0; index < parameters.length; index++) {
    if (dynamicAbi(parameters[index])) add(32);
    add(payload(parameters[index], values[index]));
  }
  return size;
}
function encodeChecked(parameters, values, path) {
  const expectedLength = abiSize(parameters, values, path);
  let encoded;
  try { encoded = encodeAbiParameters(parameters, values); }
  catch { fail('OPEN_CONFIG_ABI', path, 'ABI encoding failed for the normalized configuration'); }
  need((encoded.length - 2) / 2 === expectedLength, 'OPEN_CONFIG_ABI_SIZE', path, 'ABI size does not match the bounded encoding plan');
  return encoded;
}

/**
 * Compile one root ABI parameter. Records sort field names; arrays retain input order.
 * Optional record fields use tuple(bool present, T value), with type-level zero T
 * when absent. Missing fields remain absent in normalized `value`; zero/false/empty
 * supplied explicitly are present. Decode T only when present=true.
 * An empty record stays {} in `value` and uses tuple(bool _empty) fixed to false,
 * avoiding zero-field tuples that common ABI decoders cannot round-trip.
 *
 * Variants retain { [tag]: branchName, ...branchFields } in normalized input and
 * encode tuple(uint16 sortedBranchIndex, bytes abi.encode(branchRecordTuple)).
 * There is no fallback branch or field coercion.
 *
 * Nonliteral handles remain in `value`, while `bindings` records their resolved
 * context. An asset address alone does not commit chainId/decimals: callers must
 * commit bindings together with normalized value, ABI descriptors and encoded bytes.
 * The context is caller-supplied data, NOT proof of wallet authority, deployed code,
 * asset metadata, chain readiness or possession of a role. No RPC/schema fetch occurs.
 * String maxLength counts UTF-8 bytes; bytes maxLength counts decoded bytes. uint
 * unit is exact declarative metadata and never causes implicit amount conversion.
 * Inputs must be inert JSON data. The direct JavaScript API is not a sandbox for
 * executable JavaScript objects such as Proxies; parse JSON at untrusted boundaries.
 */
export function compileOpenConfig(schema, values, context = { roles: {}, assets: {}, components: {} }) {
  assertOpenConfigSchema(schema);
  inspectJson(values, '', OPEN_CONFIG_LIMITS.valueBytes);
  const references = checkedContext(context);
  const bindings = [];

  function reference(kind, referenceName, path) {
    name(referenceName, path, true);
    const map = references[kind === 'account' ? 'roles' : kind === 'asset' ? 'assets' : 'components'];
    need(Object.hasOwn(map, referenceName), 'OPEN_CONFIG_UNRESOLVED_REFERENCE', path, `No ${kind} binding exists for ${referenceName}`);
    const resolved = kind === 'asset' ? { ...map[referenceName] } : map[referenceName];
    bindings.push({ path, kind, reference: referenceName, resolved });
    return resolved;
  }

  function record(node, input, path) {
    keysOnly(input, node.required, Object.keys(node.fields).filter((key) => !node.required.includes(key)), path);
    const value = {}; const abi = Object.keys(node.fields).length === 0 ? [false] : []; const required = new Set(node.required);
    for (const field of Object.keys(node.fields).sort()) {
      if (Object.hasOwn(input, field)) {
        const compiled = visit(node.fields[field], input[field], at(path, field));
        value[field] = compiled.value;
        abi.push(required.has(field) ? compiled.abi : [true, compiled.abi]);
      } else abi.push([false, absentAbiValue(node.fields[field])]);
    }
    return { value, abi };
  }
  function visit(node, input, path) {
    if (node.type === 'record') return record(node, input, path);
    if (node.type === 'array') {
      need(Array.isArray(input), 'OPEN_CONFIG_TYPE', path, 'Expected an array');
      need(input.length >= (node.minItems ?? 0) && input.length <= node.maxItems, 'OPEN_CONFIG_ARRAY_LIMIT', path, 'Array length is outside its declared bounds');
      const entries = input.map((value, index) => visit(node.items, value, at(path, index)));
      return { value: entries.map((entry) => entry.value), abi: entries.map((entry) => entry.abi) };
    }
    if (node.type === 'variant') {
      need(plain(input), 'OPEN_CONFIG_TYPE', path, 'Expected a tagged object');
      need(Object.hasOwn(input, node.tag), 'OPEN_CONFIG_VARIANT_TAG', at(path, node.tag), 'Variant discriminator is required');
      const branchName = input[node.tag];
      need(typeof branchName === 'string' && Object.hasOwn(node.variants, branchName),
        'OPEN_CONFIG_VARIANT_TAG', at(path, node.tag), 'Unknown variant branch');
      const branch = node.variants[branchName];
      const branchInput = Object.fromEntries(Object.entries(input).filter(([key]) => key !== node.tag));
      const result = record(branch, branchInput, path);
      const bytes = encodeChecked([abiParameter(branch)], [result.abi], path);
      return { value: { [node.tag]: branchName, ...result.value }, abi: [BigInt(Object.keys(node.variants).sort().indexOf(branchName)), bytes] };
    }
    if (node.type === 'uint') {
      const amount = uint(input, path);
      const { minimum, maximum } = uintRange(node, path);
      need(amount >= minimum && amount <= maximum, 'OPEN_CONFIG_UINT_RANGE', path, 'Unsigned amount is outside its declared range');
      return { value: amount.toString(), abi: amount };
    }
    if (node.type === 'bool') {
      need(typeof input === 'boolean', 'OPEN_CONFIG_TYPE', path, 'Expected a boolean');
      return { value: input, abi: input };
    }
    if (node.type === 'string') {
      dataString(input, path, node.maxLength);
      return { value: input, abi: input };
    }
    if (node.type === 'bytes') {
      need(typeof input === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(input), 'OPEN_CONFIG_BYTES', path, 'Expected even-length hexadecimal bytes');
      need((input.length - 2) / 2 <= node.maxLength, 'OPEN_CONFIG_BYTES_LIMIT', path, 'Bytes exceed the declared length');
      return { value: input.toLowerCase(), abi: input.toLowerCase() };
    }
    if (node.type === 'address') {
      const normalized = address(input, path);
      return { value: normalized, abi: normalized };
    }
    if (node.type === 'account') {
      need(plain(input), 'OPEN_CONFIG_TYPE', path, 'Expected an account role or explicit address');
      if (Object.hasOwn(input, 'role')) {
        keysOnly(input, ['role'], [], path);
        return { value: { role: input.role }, abi: reference('account', input.role, path) };
      }
      keysOnly(input, ['address'], [], path);
      const normalized = address(input.address, at(path, 'address'));
      return { value: { address: normalized }, abi: normalized };
    }
    if (node.type === 'asset') {
      keysOnly(input, ['asset'], [], path);
      const resolved = reference('asset', input.asset, path);
      return { value: { asset: input.asset }, abi: resolved.address };
    }
    keysOnly(input, ['component'], [], path);
    return { value: { component: input.component }, abi: reference('component', input.component, path) };
  }

  const result = visit(schema, values, '');
  const abiParameters = [abiParameter(schema)];
  const abiValues = [result.abi];
  const encoded = encodeChecked(abiParameters, abiValues, '');
  // Canonical JSON also establishes that normalized values/bindings can be committed
  // without serializing abiValues, which deliberately contain full-width BigInts.
  const value = JSON.parse(canonicalJson(result.value));
  canonicalJson(bindings);
  return { value, abiParameters, abiValues, encoded, bindings };
}
