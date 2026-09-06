import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { encodeAbiParameters, keccak256 } from 'viem';
import { validateModuleManifest, validateRecipe, recipeHash, manifestDigest, versionIdFor, familyIdFor,
  encodeFallingCreatorFeeConfig, encodeQuoteTradeLimitConfig, feeDisclosure, splitAuthorPool,
  canonicalJson, configurationSchemaDigest, hashRecipeSnapshot, snapshotItemHash, MAX_QUOTE_LIMIT } from '../src/index.mjs';

const json = async (relative) => JSON.parse(await readFile(new URL(relative, import.meta.url), 'utf8'));
const catalogueFixture = await json('../examples/offline-fixture-catalogue.json');
const recipeFixture = await json('../examples/offline-fixture-recipe.json');
const vector = await json('./recipe-hash-vector-v1.json');
const fresh = () => ({ recipe: structuredClone(recipeFixture), catalogue: structuredClone(catalogueFixture) });
const code = (result) => { assert.equal(result.ok, false); return result.errors[0].code; };
const entryOf = (catalogue, kind) => catalogue.entries.find((entry) => entry.manifest.kind === kind);
const selectionOf = (recipe, catalogue, kind) => recipe.modules.find((selection) => selection.versionId === entryOf(catalogue, kind).manifest.versionId);
function addFamily(catalogue, kind, saltIndex) {
  const entry = structuredClone(entryOf(catalogue, kind));
  entry.manifest.familySalt = `0x${BigInt(saltIndex).toString(16).padStart(64, '0')}`;
  entry.manifest.familyId = familyIdFor(entry.manifest.author, entry.manifest.familySalt);
  entry.manifest.versionId = versionIdFor(entry.manifest.familyId, entry.manifest.version);
  entry.manifestHash = manifestDigest(entry.manifest);
  catalogue.entries.push(entry); return entry;
}
function sortSelections(recipe, catalogue) {
  recipe.modules.sort((a, b) => catalogue.entries.find((entry) => entry.manifest.versionId === a.versionId).manifest.familyId
    .localeCompare(catalogue.entries.find((entry) => entry.manifest.versionId === b.versionId).manifest.familyId));
}

test('manifest IDs, author identity and immutable version use the registry ABI', () => {
  for (const { manifest } of catalogueFixture.entries) {
    const result = validateModuleManifest(manifest); assert.equal(result.ok, true);
    assert.equal(manifest.versionId, keccak256(encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint32' }], [manifest.familyId, 1])));
    assert.equal(result.manifestHash, manifestDigest(manifest));
  }
  const manifest = structuredClone(catalogueFixture.entries[0].manifest); manifest.version = 2;
  assert.equal(code(validateModuleManifest(manifest)), 'VERSION_ID_MISMATCH');
});
test('contributors cannot approve themselves or add undeclared manifest fields', () => {
  const manifest = structuredClone(catalogueFixture.entries[0].manifest); manifest.reviewStatus = 'approved';
  assert.equal(code(validateModuleManifest(manifest)), 'MANIFEST_SCHEMA');
  manifest.reviewStatus = 'requested'; manifest.approved = true;
  assert.equal(code(validateModuleManifest(manifest)), 'MANIFEST_SCHEMA');
});
test('zero wallet, cross-author family and path traversal fail validation', () => {
  const original = catalogueFixture.entries[0].manifest;
  assert.equal(code(validateModuleManifest({ ...original, rewardWallet: `0x${'0'.repeat(40)}` })), 'INVALID_ADDRESS');
  assert.equal(code(validateModuleManifest({ ...original, author: `0x${'33'.repeat(20)}` })), 'FAMILY_ID_MISMATCH');
  assert.equal(code(validateModuleManifest({ ...original, source: { ...original.source, artifactPath: 'src/../../key.json' } })), 'UNSAFE_PATH');
});
test('recipe binds exact approved snapshots and has a fixed cross-stack vector', () => {
  const result = validateRecipe(recipeFixture, catalogueFixture); assert.equal(result.ok, true);
  assert.equal(result.recipeHash, '0xa5d4695aee87647b7d17ba71d7e2718ad777ba2784c0cd5bc5cb691bc62e94c9');
  assert.equal(hashRecipeSnapshot(vector.recipe, vector.snapshots), vector.recipeHash);
  assert.deepEqual(vector.snapshots.map(snapshotItemHash), vector.itemHashes);
  assert.equal(recipeHash(recipeFixture, catalogueFixture), vector.recipeHash);
  assert.notEqual(hashRecipeSnapshot({ ...vector.recipe, chainId: '4663' }, vector.snapshots), vector.recipeHash);
  assert.notEqual(hashRecipeSnapshot({ ...vector.recipe, registry: `0x${'44'.repeat(20)}` }, vector.snapshots), vector.recipeHash);
  assert.notEqual(hashRecipeSnapshot({ ...vector.recipe, baseBuyFeeBps: 600 }, vector.snapshots), vector.recipeHash);
});
test('unknown, pending, suspended and omitted catalogue approvals fail closed', () => {
  const { recipe, catalogue } = fresh();
  assert.equal(code(validateRecipe(recipe)), 'CATALOGUE_SCHEMA');
  for (const status of ['pending', 'rejected', 'suspended']) {
    catalogue.entries.forEach((entry) => { entry.status = status; });
    assert.equal(code(validateRecipe(recipe, catalogue)), 'MODULE_UNAPPROVED');
  }
  catalogue.entries = [];
  assert.equal(code(validateRecipe(recipe, catalogue)), 'MODULE_UNKNOWN');
});
test('approval is bound to manifest digest, schema and chain/registry context', () => {
  const { recipe, catalogue } = fresh();
  catalogue.entries[0].manifest.rewardWallet = `0x${'44'.repeat(20)}`;
  assert.equal(code(validateRecipe(recipe, catalogue)), 'MANIFEST_DIGEST_MISMATCH');
  const next = fresh(); next.catalogue.registry = `0x${'44'.repeat(20)}`;
  assert.equal(code(validateRecipe(next.recipe, next.catalogue)), 'CATALOGUE_CONTEXT_MISMATCH');
  const other = fresh(); other.catalogue.entries[0].configSchema.properties.buyEnd.maximum = 900;
  assert.equal(code(validateRecipe(other.recipe, other.catalogue)), 'CONFIG_SCHEMA_DIGEST_MISMATCH');
});
test('family uniqueness and ordering prevent duplicate royalties', () => {
  const { recipe, catalogue } = fresh(); recipe.modules.push(structuredClone(recipe.modules.at(-1)));
  assert.equal(code(validateRecipe(recipe, catalogue)), 'FAMILY_DUPLICATE');
  const next = fresh(); next.recipe.modules.reverse();
  assert.equal(code(validateRecipe(next.recipe, next.catalogue)), 'FAMILY_ORDER');
  const versioned = fresh(); const entry = structuredClone(versioned.catalogue.entries[0]);
  entry.manifest.version = 2; entry.manifest.versionId = versionIdFor(entry.manifest.familyId, 2); entry.manifestHash = manifestDigest(entry.manifest);
  versioned.catalogue.entries.push(entry);
  const selection = versioned.recipe.modules.find((item) => item.versionId === versioned.catalogue.entries[0].manifest.versionId);
  versioned.recipe.modules.push({ ...selection, versionId: entry.manifest.versionId }); sortSelections(versioned.recipe, versioned.catalogue);
  assert.equal(code(validateRecipe(versioned.recipe, versioned.catalogue)), 'FAMILY_DUPLICATE');
});
test('two independent creator fee policies conflict', () => {
  const { recipe, catalogue } = fresh();
  const entry = addFamily(catalogue, 1, 999);
  const selection = recipe.modules.find((item) => item.versionId === entryOf(catalogue, 1).manifest.versionId);
  recipe.modules.push({ ...selection, versionId: entry.manifest.versionId }); sortSelections(recipe, catalogue);
  assert.equal(code(validateRecipe(recipe, catalogue)), 'FEE_POLICY_CONFLICT');
});
test('a thousand catalogue entries do not expand the launch execution budget', () => {
  const { recipe, catalogue } = fresh();
  for (let i = 2; i < 1000; i++) addFamily(catalogue, 2, i + 1000);
  assert.equal(catalogue.entries.length, 1000);
  const result = validateRecipe(recipe, catalogue); assert.equal(result.ok, true); assert.equal(result.snapshots.length, 2);
  const ninth = fresh(); ninth.recipe.modules = Array.from({ length: 9 }, () => ninth.recipe.modules[0]);
  assert.equal(code(validateRecipe(ninth.recipe, ninth.catalogue)), 'RECIPE_SCHEMA');
});
test('structured parameters and raw ABI bytes must agree', () => {
  const { recipe, catalogue } = fresh(); selectionOf(recipe, catalogue, 1).parameters.duration = 7200;
  assert.equal(code(validateRecipe(recipe, catalogue)), 'CONFIG_BYTES_MISMATCH');
  const next = fresh(); next.recipe.modules[0].config += '00';
  assert.equal(code(validateRecipe(next.recipe, next.catalogue)), 'CONFIG_BYTES_MISMATCH');
  const tooLong = fresh(); tooLong.recipe.modules[0].config = `0x${'00'.repeat(257)}`;
  assert.equal(code(validateRecipe(tooLong.recipe, tooLong.catalogue)), 'RECIPE_SCHEMA');
});
test('falling fee and quote-limit ABI match uint256 contract layouts', () => {
  assert.equal(encodeFallingCreatorFeeConfig({ buyEnd: 0, sellEnd: 100, duration: 3600 }),
    encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [0n, 100n, 3600n]));
  assert.equal(encodeQuoteTradeLimitConfig({ buyLimit: '1', sellLimit: '2' }),
    encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [1n, 2n]));
  const { recipe, catalogue } = fresh(); const fee = selectionOf(recipe, catalogue, 1);
  fee.parameters = { buyEnd: 500, sellEnd: 700, duration: 3600 }; fee.config = encodeFallingCreatorFeeConfig(fee.parameters);
  assert.equal(code(validateRecipe(recipe, catalogue)), 'FALLING_FEE_CONFIG');
  const next = fresh(); const limit = selectionOf(next.recipe, next.catalogue, 2);
  limit.parameters = { buyLimit: '0', sellLimit: '0' }; limit.config = encodeQuoteTradeLimitConfig(limit.parameters);
  assert.equal(code(validateRecipe(next.recipe, next.catalogue)), 'TRADE_LIMIT_CONFIG');
  limit.parameters.buyLimit = String(MAX_QUOTE_LIMIT + 1n); limit.config = encodeQuoteTradeLimitConfig(limit.parameters);
  assert.equal(code(validateRecipe(next.recipe, next.catalogue)), 'INTEGER_RANGE');
});
test('schemas cannot introduce code, references, arbitrary regex or unbounded string values', () => {
  for (const alteration of [
    (schema) => { schema.$ref = 'https://attacker.invalid/schema'; },
    (schema) => { schema.properties.buyLimit.pattern = '(a+)+$'; },
    (schema) => { delete schema.properties.buyLimit.maxLength; },
  ]) {
    const { recipe, catalogue } = fresh(); const entry = entryOf(catalogue, 2); alteration(entry.configSchema);
    entry.manifest.configuration.schemaSha256 = configurationSchemaDigest(entry.configSchema); entry.manifestHash = manifestDigest(entry.manifest);
    assert.match(code(validateRecipe(recipe, catalogue)), /^CONFIG_SCHEMA_/);
  }
});
test('zero creator fees still disclose the fixed 20 bps', () => {
  assert.deepEqual(feeDisclosure(0, 0), { scope: 'hook-fees', programmableFeeBps: 20, treasuryBps: 10, authorsBps: 10,
    buyCreatorBps: 0, sellCreatorBps: 0, buyHookFeeBps: 20, sellHookFeeBps: 20,
    poolLpFeePips: 0, poolProtocolFeePips: { buy: null, sell: null }, combinedFeeQuoteRequired: true });
  assert.equal(feeDisclosure(1000, 100).buyHookFeeBps, 1020);
  assert.throws(() => feeDisclosure(50, 0), /100 bps steps/);
  assert.throws(() => feeDisclosure(1100, 0), /100 bps steps/);
  const { recipe, catalogue } = fresh(); recipe.modules = []; recipe.baseBuyFeeBps = 0; recipe.baseSellFeeBps = 0;
  assert.equal(validateRecipe(recipe, catalogue).ok, true);
});
test('Uniswap protocol fees remain separate from hook bps and unknown does not become zero', () => {
  const known = feeDisclosure(0, 100, { buyPoolProtocolFeePips: 1000, sellPoolProtocolFeePips: 0 });
  assert.deepEqual(known.poolProtocolFeePips, { buy: 1000, sell: 0 });
  assert.equal(known.buyHookFeeBps, 20); assert.equal(known.combinedFeeQuoteRequired, true);
  assert.equal(feeDisclosure(0, 0).poolProtocolFeePips.buy, null);
  assert.throws(() => feeDisclosure(0, 0, { buyPoolProtocolFeePips: 1001 }), /POOL|Pool protocol fee/);
});
test('author pool uses equal selected-family slots with explicit integer remainder', () => {
  assert.deepEqual(splitAuthorPool(1000n, 5), { perModule: 200n, remainder: 0n, moduleCount: 5 });
  assert.deepEqual(splitAuthorPool(1001n, 5), { perModule: 200n, remainder: 1n, moduleCount: 5 });
  assert.throws(() => splitAuthorPool(1000n, 0), /deployment policy/);
  for (let count = 1; count <= 8; count++) {
    for (const amount of [0n, 1n, 7n, 10n, 1000000000000000001n]) {
      const split = splitAuthorPool(amount, count);
      assert.equal(split.perModule * BigInt(count) + split.remainder, amount);
      assert.ok(split.remainder < BigInt(count));
    }
  }
});
test('canonical hashing is independent of key order and rejects non-JSON values', () => {
  assert.equal(canonicalJson({ z: [3, 2], a: 1 }), '{"a":1,"z":[3,2]}');
  const entry = catalogueFixture.entries[0];
  assert.equal(manifestDigest(Object.fromEntries(Object.entries(entry.manifest).reverse())), manifestDigest(entry.manifest));
  for (const invalid of [NaN, Infinity, 9007199254740992, -0, undefined, 1n, { get value() { throw new Error('must not execute'); } }]) {
    assert.throws(() => canonicalJson(invalid));
  }
});
