import Ajv from 'ajv';
import { encodeAbiParameters, keccak256, sha256, stringToHex } from 'viem';
import moduleSchema from '../schemas/module-manifest-v1.json' with { type: 'json' };
import recipeSchema from '../schemas/recipe-v1.json' with { type: 'json' };
import { canonicalJson } from './canonical-json.mjs';

export { canonicalJson } from './canonical-json.mjs';
export { buildCreatorSplit, encodeCreatorTakeover, MAX_CREATOR_SPLIT_RECIPIENTS, CREATOR_SPLIT_DOMAIN } from './creator-recipients.mjs';
export const MAX_MODULES = 8;
export const MAX_CONFIG_BYTES = 256;
export const MAX_CATALOGUE_ENTRIES = 10_000;
export const RECIPE_DOMAIN = keccak256(stringToHex('programmable.classic.recipe.v1'));
export const MAX_UINT256 = (1n << 256n) - 1n;
export const MAX_QUOTE_LIMIT = (1n << 127n) - 1n;
const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const ZERO_HASH = `0x${'0'.repeat(64)}`;
const ajvOptions = { allErrors: true, strict: true, ownProperties: true };
const ajv = new Ajv(ajvOptions);
const manifestShape = ajv.compile(moduleSchema);
const recipeShape = ajv.compile(recipeSchema);
const configurationValidators = new Map();

export class ClassicModuleError extends Error {
  constructor(code, message, path = '') {
    super(message);
    this.name = 'ClassicModuleError';
    this.code = code;
    this.path = path;
  }
}
function requireCondition(condition, code, message, path = '') {
  if (!condition) throw new ClassicModuleError(code, message, path);
}
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function exactKeys(value, keys, code, path) {
  requireCondition(isRecord(value) && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key)), code, `Expected fields: ${keys.join(', ')}`, path);
}
function schemaFailure(validator, value, code) {
  requireCondition(validator(value), code,
    validator.errors?.map((error) => `${error.instancePath || '/'} ${error.message}`).join('; ') || code);
}
function boundedJson(value, maximum, code) {
  const serialized = canonicalJson(value);
  requireCondition(new TextEncoder().encode(serialized).length <= maximum, code, 'JSON payload exceeds its size limit');
  return serialized;
}
function outcome(callback) {
  try { return { ok: true, ...callback() }; } catch (error) {
    return { ok: false, errors: [{ code: error.code || 'INVALID_INPUT', message: error.message, path: error.path || '' }] };
  }
}
function assertUint(value, maximum = MAX_UINT256, label = 'integer') {
  requireCondition((typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 78)
    || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    || (typeof value === 'bigint' && value >= 0n), 'INVALID_INTEGER', `${label} must be an unsigned integer`);
  const integer = BigInt(value);
  requireCondition(integer <= maximum, 'INTEGER_RANGE', `${label} is outside the supported range`);
  return integer;
}
function nonzeroAddress(value, label) {
  requireCondition(typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
    && value.toLowerCase() !== ZERO_ADDRESS, 'INVALID_ADDRESS', `${label} must be a nonzero address`);
}
export function safeRelativePath(value) {
  return typeof value === 'string' && value.length <= 240
    && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
    && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}
export function familyIdFor(author, salt) {
  nonzeroAddress(author, 'author');
  requireCondition(/^0x[0-9a-fA-F]{64}$/.test(salt), 'INVALID_SALT', 'Family salt must be bytes32');
  return keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [author, salt]));
}
export function versionIdFor(familyId, version) {
  requireCondition(/^0x[0-9a-fA-F]{64}$/.test(familyId) && familyId.toLowerCase() !== ZERO_HASH,
    'INVALID_FAMILY', 'Family ID must be nonzero bytes32');
  const number = assertUint(version, (1n << 32n) - 1n, 'version');
  requireCondition(number > 0n, 'INVALID_VERSION', 'Versions start at one');
  return keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint32' }], [familyId, Number(number)]));
}
export function manifestDigest(manifest) {
  return keccak256(stringToHex(boundedJson(manifest, 16_384, 'MANIFEST_TOO_LARGE')));
}
export function configurationSchemaDigest(schema) {
  return sha256(stringToHex(boundedJson(schema, 16_384, 'CONFIG_SCHEMA_TOO_LARGE'))).slice(2);
}
function assertManifest(manifest) {
  boundedJson(manifest, 16_384, 'MANIFEST_TOO_LARGE');
  schemaFailure(manifestShape, manifest, 'MANIFEST_SCHEMA');
  for (const key of ['author', 'rewardWallet', 'implementation']) nonzeroAddress(manifest[key], key);
  requireCondition(manifest.runtimeCodeHash.toLowerCase() !== ZERO_HASH, 'INVALID_CODE_HASH', 'Runtime codehash cannot be zero');
  requireCondition(assertUint(manifest.chainId) > 0n, 'INVALID_CHAIN', 'chainId must be positive');
  requireCondition(familyIdFor(manifest.author, manifest.familySalt) === manifest.familyId.toLowerCase(),
    'FAMILY_ID_MISMATCH', 'Family ID does not match author and salt');
  requireCondition(versionIdFor(manifest.familyId, manifest.version) === manifest.versionId.toLowerCase(),
    'VERSION_ID_MISMATCH', 'Version ID does not match family and version');
  requireCondition(safeRelativePath(manifest.source.artifactPath) && safeRelativePath(manifest.configuration.schemaUri),
    'UNSAFE_PATH', 'Artifact and schema paths must be local relative paths without traversal');
  const repository = new URL(manifest.source.repository);
  requireCondition(repository.protocol === 'https:' && !repository.username && !repository.password
    && !repository.search && !repository.hash, 'INVALID_REPOSITORY', 'Repository URL must be HTTPS without credentials, query or fragment');
  const names = manifest.configuration.fields.map((field) => field.name);
  requireCondition(new Set(names).size === names.length, 'DUPLICATE_CONFIG_FIELD', 'Configuration field names must be unique');
  const profile = manifest.configuration.profile;
  if (profile !== 'static-abi-v1') {
    const expected = profile === 'falling-creator-fee-v1' ? ['buyEnd', 'sellEnd', 'duration'] : ['buyLimit', 'sellLimit'];
    requireCondition(manifest.kind === (profile === 'falling-creator-fee-v1' ? 1 : 2)
      && canonicalJson(manifest.configuration.fields) === canonicalJson(expected.map((name) => ({ name, type: 'uint256' }))),
    'PROFILE_MISMATCH', 'Reference profile kind and ABI fields must match the contract exactly');
  }
}
export function validateModuleManifest(manifest) {
  return outcome(() => { assertManifest(manifest); return { manifestHash: manifestDigest(manifest), reviewStatus: 'requested' }; });
}

// Contributor schemas are deliberately restricted: flat ABI fields, bounded strings,
// no references, arbitrary regular expressions, custom keywords or executable validators.
function assertConfigurationSchema(schema, fields) {
  boundedJson(schema, 16_384, 'CONFIG_SCHEMA_TOO_LARGE');
  requireCondition(isRecord(schema), 'CONFIG_SCHEMA_INVALID', 'Configuration schema must be an object');
  const topKeys = ['$schema', 'title', 'description', 'type', 'properties', 'required', 'additionalProperties'];
  requireCondition(Object.keys(schema).every((key) => topKeys.includes(key))
    && schema.type === 'object' && schema.additionalProperties === false && isRecord(schema.properties)
    && Array.isArray(schema.required), 'CONFIG_SCHEMA_UNSUPPORTED', 'Use a closed flat object schema');
  const names = fields.map((field) => field.name).sort();
  requireCondition(canonicalJson(Object.keys(schema.properties).sort()) === canonicalJson(names)
    && canonicalJson([...schema.required].sort()) === canonicalJson(names),
  'CONFIG_SCHEMA_FIELDS', 'Every ABI field must be present and required exactly once');
  for (const [name, field] of Object.entries(schema.properties)) {
    requireCondition(isRecord(field) && Object.keys(field).every((key) =>
      ['type', 'minimum', 'maximum', 'multipleOf', 'minLength', 'maxLength', 'enum', 'title', 'description'].includes(key))
      && ['integer', 'string', 'boolean'].includes(field.type),
    'CONFIG_SCHEMA_UNSUPPORTED', `Unsupported schema for ${name}`);
    if (field.type === 'string') requireCondition(Number.isSafeInteger(field.maxLength) && field.maxLength <= 160,
      'CONFIG_SCHEMA_UNBOUNDED', `String ${name} needs a maximum length of at most 160`);
    if (field.enum !== undefined) requireCondition(Array.isArray(field.enum) && field.enum.length <= 32,
      'CONFIG_SCHEMA_UNBOUNDED', `Enum ${name} exceeds 32 values`);
  }
  const key = configurationSchemaDigest(schema);
  const cached = configurationValidators.get(key);
  if (cached) { configurationValidators.delete(key); configurationValidators.set(key, cached); return cached; }
  // Ajv otherwise retains each newly materialized schema object forever. Keep this
  // process-local cache bounded even when a service reloads many catalogue revisions.
  const validator = new Ajv(ajvOptions).compile(schema);
  configurationValidators.set(key, validator);
  if (configurationValidators.size > 128) configurationValidators.delete(configurationValidators.keys().next().value);
  return validator;
}
export function validateConfigurationSchema(schema, manifest) {
  return outcome(() => {
    assertManifest(manifest);
    assertConfigurationSchema(schema, manifest.configuration.fields);
    requireCondition(configurationSchemaDigest(schema) === manifest.configuration.schemaSha256,
      'CONFIG_SCHEMA_DIGEST_MISMATCH', 'Configuration schema does not match its manifest digest');
    return {};
  });
}
export function encodeConfiguration(fields, parameters) {
  requireCondition(Array.isArray(fields) && fields.length <= 8, 'CONFIG_FIELDS', 'At most eight static ABI fields are supported');
  exactKeys(parameters, fields.map((field) => field.name), 'CONFIG_FIELDS', '/parameters');
  const values = fields.map(({ name, type }) => {
    const value = parameters[name];
    if (/^uint(8|16|32|64|128|256)$/.test(type)) return assertUint(value, (1n << BigInt(type.slice(4))) - 1n, name);
    if (type === 'bool') { requireCondition(typeof value === 'boolean', 'CONFIG_TYPE', `${name} must be boolean`); return value; }
    if (type === 'address') {
      requireCondition(typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value), 'CONFIG_TYPE', `${name} must be an address`);
      return value;
    }
    requireCondition(type === 'bytes32' && typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value),
      'CONFIG_TYPE', `${name} must be bytes32`);
    return value;
  });
  return encodeAbiParameters(fields.map(({ type }) => ({ type })), values);
}
export function encodeFallingCreatorFeeConfig({ buyEnd, sellEnd, duration }) {
  return encodeConfiguration(['buyEnd', 'sellEnd', 'duration'].map((name) => ({ name, type: 'uint256' })), { buyEnd, sellEnd, duration });
}
export function encodeQuoteTradeLimitConfig({ buyLimit, sellLimit }) {
  return encodeConfiguration(['buyLimit', 'sellLimit'].map((name) => ({ name, type: 'uint256' })), { buyLimit, sellLimit });
}
function assertProfileConfiguration(manifest, parameters, recipe) {
  if (manifest.configuration.profile === 'falling-creator-fee-v1') {
    const { buyEnd, sellEnd, duration } = Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, assertUint(value)]));
    requireCondition(duration >= 60n && duration <= 2_592_000n && buyEnd <= BigInt(recipe.baseBuyFeeBps)
      && sellEnd <= BigInt(recipe.baseSellFeeBps)
      && (buyEnd < BigInt(recipe.baseBuyFeeBps) || sellEnd < BigInt(recipe.baseSellFeeBps)),
    'FALLING_FEE_CONFIG', 'Falling fees need a real decrease and a duration from 60 seconds to 30 days');
  }
  if (manifest.configuration.profile === 'quote-trade-limit-v1') {
    const buy = assertUint(parameters.buyLimit, MAX_QUOTE_LIMIT);
    const sell = assertUint(parameters.sellLimit, MAX_QUOTE_LIMIT);
    requireCondition(buy > 0n || sell > 0n, 'TRADE_LIMIT_CONFIG', 'At least one trade limit must be positive');
  }
}

export function feeDisclosure(baseBuyFeeBps, baseSellFeeBps, { buyPoolProtocolFeePips = null, sellPoolProtocolFeePips = null } = {}) {
  for (const value of [baseBuyFeeBps, baseSellFeeBps]) requireCondition(Number.isInteger(value)
    && value >= 0 && value <= 1000 && value % 100 === 0, 'CREATOR_FEE_RANGE', 'Base creator fees must be 0–1000 bps in 100 bps steps');
  for (const value of [buyPoolProtocolFeePips, sellPoolProtocolFeePips]) requireCondition(value === null
    || (Number.isInteger(value) && value >= 0 && value <= 1000),
  'POOL_PROTOCOL_FEE_RANGE', 'Pool protocol fee must be unknown (null) or freshly read directional pips from 0 through 1000');
  return {
    scope: 'hook-fees', programmableFeeBps: 20, treasuryBps: 10, authorsBps: 10,
    buyCreatorBps: baseBuyFeeBps, sellCreatorBps: baseSellFeeBps,
    buyHookFeeBps: 20 + baseBuyFeeBps, sellHookFeeBps: 20 + baseSellFeeBps,
    poolLpFeePips: 0, poolProtocolFeePips: { buy: buyPoolProtocolFeePips, sell: sellPoolProtocolFeePips },
    combinedFeeQuoteRequired: true,
  };
}
/** Equal module slots; the unallocated smallest units remain explicit, never awarded to a preferred slot. */
export function splitAuthorPool(amount, moduleCount) {
  const total = assertUint(amount);
  requireCondition(Number.isInteger(moduleCount) && moduleCount >= 1 && moduleCount <= MAX_MODULES,
    'AUTHOR_SLOT_COUNT', 'One to eight selected module families are required; zero-module routing is deployment policy');
  const slots = BigInt(moduleCount);
  return { perModule: total / slots, remainder: total % slots, moduleCount };
}
export function snapshotItemHash(snapshot) {
  return keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }, { type: 'bytes32' }, { type: 'uint8' }, { type: 'bytes32' }],
    [snapshot.versionId, snapshot.familyId, snapshot.implementation, snapshot.codeHash, snapshot.kind, keccak256(snapshot.config)],
  ));
}
export function hashRecipeSnapshot({ chainId, hook, registry, baseBuyFeeBps, baseSellFeeBps }, snapshots) {
  // Low-level cross-stack primitive. Use validateRecipe for all untrusted recipes.
  return keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'bytes32[]' }],
    [RECIPE_DOMAIN, BigInt(chainId), hook, registry, baseBuyFeeBps, baseSellFeeBps, snapshots.map(snapshotItemHash)],
  ));
}
function assertCatalogue(catalogue, recipe) {
  exactKeys(catalogue, ['schemaVersion', 'chainId', 'registry', 'entries'], 'CATALOGUE_SCHEMA', '/catalogue');
  requireCondition(catalogue.schemaVersion === '1.0' && catalogue.chainId === recipe.chainId
    && typeof catalogue.registry === 'string' && catalogue.registry.toLowerCase() === recipe.registry.toLowerCase(),
  'CATALOGUE_CONTEXT_MISMATCH', 'Trusted catalogue must bind the recipe chain and registry');
  requireCondition(Array.isArray(catalogue.entries) && catalogue.entries.length <= MAX_CATALOGUE_ENTRIES,
    'CATALOGUE_SIZE', `Catalogue supports up to ${MAX_CATALOGUE_ENTRIES} entries`);
  const index = new Map();
  for (const entry of catalogue.entries) {
    exactKeys(entry, ['manifest', 'manifestHash', 'status', 'configSchema'], 'CATALOGUE_ENTRY', '/catalogue/entries');
    const id = entry.manifest?.versionId;
    requireCondition(typeof id === 'string' && /^0x[0-9a-fA-F]{64}$/.test(id)
      && ['approved', 'suspended', 'pending', 'rejected'].includes(entry.status), 'CATALOGUE_ENTRY', 'Invalid catalogue entry');
    requireCondition(!index.has(id.toLowerCase()), 'CATALOGUE_DUPLICATE', 'Catalogue contains a repeated version ID');
    index.set(id.toLowerCase(), entry);
  }
  return index;
}

/** Catalogue is an explicit trust input, supplied by a verified release/indexer, never by the contributor package. */
export function validateRecipe(recipe, trustedCatalogue) {
  return outcome(() => {
    boundedJson(recipe, 32_768, 'RECIPE_TOO_LARGE');
    schemaFailure(recipeShape, recipe, 'RECIPE_SCHEMA');
    requireCondition(assertUint(recipe.chainId) > 0n, 'INVALID_CHAIN', 'chainId must be positive');
    nonzeroAddress(recipe.hook, 'hook'); nonzeroAddress(recipe.registry, 'registry');
    const fees = feeDisclosure(recipe.baseBuyFeeBps, recipe.baseSellFeeBps);
    const index = assertCatalogue(trustedCatalogue, recipe);
    const snapshots = [];
    const authors = [];
    const families = new Set();
    let previousFamily = '';
    let feePolicies = 0;
    for (const selection of recipe.modules) {
      const entry = index.get(selection.versionId.toLowerCase());
      requireCondition(entry, 'MODULE_UNKNOWN', 'Selected module is absent from the trusted catalogue');
      requireCondition(entry.status === 'approved', 'MODULE_UNAPPROVED', 'Selected module is not approved for new launches');
      const { manifest, configSchema } = entry;
      assertManifest(manifest);
      requireCondition(typeof entry.manifestHash === 'string' && manifestDigest(manifest) === entry.manifestHash.toLowerCase(),
        'MANIFEST_DIGEST_MISMATCH', 'Approved manifest digest does not match the selected module');
      requireCondition(manifest.chainId === recipe.chainId, 'MODULE_CHAIN_MISMATCH', 'Module implementation belongs to another chain');
      const family = manifest.familyId.toLowerCase();
      requireCondition(!families.has(family), 'FAMILY_DUPLICATE', 'A family receives at most one selected version and one author slot');
      requireCondition(family > previousFamily, 'FAMILY_ORDER', 'Select modules in ascending family ID order');
      families.add(family); previousFamily = family;
      if (manifest.kind === 1) feePolicies += 1;
      requireCondition(feePolicies <= 1, 'FEE_POLICY_CONFLICT', 'Only one creator fee policy may be selected');
      const configValidator = assertConfigurationSchema(configSchema, manifest.configuration.fields);
      requireCondition(configurationSchemaDigest(configSchema) === manifest.configuration.schemaSha256,
        'CONFIG_SCHEMA_DIGEST_MISMATCH', 'Selected configuration schema is not the reviewed schema');
      schemaFailure(configValidator, selection.parameters, 'CONFIG_PARAMETERS');
      const encoded = encodeConfiguration(manifest.configuration.fields, selection.parameters);
      requireCondition(encoded === selection.config.toLowerCase(), 'CONFIG_BYTES_MISMATCH', 'Raw configuration bytes do not match the displayed parameters');
      assertProfileConfiguration(manifest, selection.parameters, recipe);
      snapshots.push({ versionId: manifest.versionId, familyId: manifest.familyId, implementation: manifest.implementation,
        codeHash: manifest.runtimeCodeHash, kind: manifest.kind, config: encoded });
      authors.push({ familyId: manifest.familyId, author: manifest.author, rewardWalletAtReview: manifest.rewardWallet, slots: 1 });
    }
    return { recipeHash: hashRecipeSnapshot(recipe, snapshots), snapshots, fees, authors,
      validationBoundary: 'Local validation only. Verify registry approval, current runtime codehash, onchain validateConfig, author wallet and release binding before launch.' };
  });
}
export function recipeHash(recipe, trustedCatalogue) {
  const result = validateRecipe(recipe, trustedCatalogue);
  if (!result.ok) throw new ClassicModuleError(result.errors[0].code, result.errors[0].message, result.errors[0].path);
  return result.recipeHash;
}
