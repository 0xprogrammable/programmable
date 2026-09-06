import {
  decodeEventLog,
  encodeAbiParameters,
  encodeEventTopics,
  getCreate2Address,
  isAddress,
  keccak256,
  parseAbi,
  toHex,
  type Address,
  type Hex,
} from "viem";

export const CLASSIC_MODULE_SOURCE_SCHEMA = "programmable.classic-modules-source.v1";
export const CLASSIC_MODULE_EVIDENCE_SCHEMA = "programmable.classic-modules-evidence.v1";
export const CLASSIC_MODULE_PROVENANCE_SCHEMA = "programmable.classic-modules-provenance.v1";
export const CLASSIC_MODULE_FINALITY_POLICY = "robinhood-ethereum-finalized-v1";
export const CLASSIC_MODULE_SOURCE_VERSION = "classic-modules-v1";
export const MAX_CLASSIC_MODULES = 8;

export const classicModuleProvenanceAbi = parseAbi([
  "event ClassicModuleLaunched(bytes32 indexed launchId,address indexed launchWallet,address indexed token,bytes32 poolId,bytes32 recipeHash,address hook,address positionRecipient,uint256 positionTokenId,uint256 initialBuyNative,uint256 initialBuyTokens)",
  "function getLaunch(address token) view returns ((bytes32 launchId,address launchWallet,address token,bytes32 poolId,bytes32 recipeHash,address hook,address positionRecipient,uint256 positionTokenId,uint256 initialBuyNative,uint256 initialBuyTokens) record)",
  "function tokenFactory() view returns (address)",
]);

export const classicModuleTokenIdentityAbi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function creator() view returns (address)",
  "function graffiti() view returns (bytes32)",
]);

export const classicModuleTokenFactoryAbi = parseAbi([
  "function getUERC20Address(string name,string symbol,uint8 decimals,address creator,bytes32 graffiti) view returns (address token)",
]);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const UINT256_MAX = (1n << 256n) - 1n;
const PROFILE_KEYS = [
  "schemaVersion", "chainId", "sourceVersion", "status", "enabled", "releaseDigest",
  "launcher", "launcherRuntimeCodeHash", "hook", "hookRuntimeCodeHash", "registry", "registryRuntimeCodeHash", "poolManager",
  "poolManagerRuntimeCodeHash", "tokenFactory", "tokenFactoryRuntimeCodeHash", "tokenCreationCodeHash", "startBlock", "minimumInitialBuyNative",
  "poolFee", "tickSpacing", "finalityPolicy",
] as const;
const RECORD_KEYS = [
  "launchId", "launchWallet", "token", "poolId", "recipeHash", "hook", "positionRecipient",
  "positionTokenId", "initialBuyNative", "initialBuyTokens",
] as const;

export class ClassicModuleProvenanceError extends Error {
  constructor(readonly code: string) {
    super(`Classic module provenance: ${code}`);
    this.name = "ClassicModuleProvenanceError";
  }
}

function fail(code: string): never {
  throw new ClassicModuleProvenanceError(code);
}

function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${label}.object`);
  const result = value as Record<string, unknown>;
  const actual = Object.keys(result);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail(`${label}.keys`);
  return result;
}

function bytes(value: unknown, label: string, maximumBytes = 24_576): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value) ||
    (value.length - 2) / 2 > maximumBytes) fail(`${label}.bytes`);
  return value.toLowerCase() as Hex;
}

function hash(value: unknown, label: string): Hex {
  const result = bytes(value, label, 32);
  if (result.length !== 66 || BigInt(result) === 0n) fail(`${label}.hash`);
  return result;
}

function address(value: unknown, label: string, allowZero = false): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) fail(`${label}.address`);
  const result = value.toLowerCase() as Address;
  if (!allowZero && result === ZERO_ADDRESS) fail(`${label}.zero-address`);
  return result;
}

function uint(value: unknown, label: string, positive = false): string {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value) || value.length > 78) {
    fail(`${label}.uint`);
  }
  const integer = BigInt(value);
  if (integer > UINT256_MAX || (positive && integer === 0n)) fail(`${label}.uint-range`);
  return value;
}

function integer(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
    fail(`${label}.integer`);
  }
  return value;
}

function tokenText(value: unknown, label: string, maximumBytes: number): string {
  if (typeof value !== "string" || value.length === 0 || new TextEncoder().encode(value).length > maximumBytes) {
    fail(`${label}.text`);
  }
  return value;
}

function equal(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) fail(`${label}.mismatch`);
}

export type ClassicModuleSource = Readonly<{
  schemaVersion: typeof CLASSIC_MODULE_SOURCE_SCHEMA;
  chainId: 4663;
  sourceVersion: typeof CLASSIC_MODULE_SOURCE_VERSION;
  status: "active";
  enabled: true;
  releaseDigest: Hex;
  launcher: Address;
  launcherRuntimeCodeHash: Hex;
  hook: Address;
  hookRuntimeCodeHash: Hex;
  registry: Address;
  registryRuntimeCodeHash: Hex;
  poolManager: Address;
  poolManagerRuntimeCodeHash: Hex;
  tokenFactory: Address;
  tokenFactoryRuntimeCodeHash: Hex;
  tokenCreationCodeHash: Hex;
  startBlock: string;
  minimumInitialBuyNative: string;
  poolFee: 0;
  tickSpacing: 200;
  finalityPolicy: typeof CLASSIC_MODULE_FINALITY_POLICY;
}>;

/** A profile is configuration, not release authority. Only a trusted caller may supply an active profile. */
export function bindActiveClassicModuleSource(value: unknown): ClassicModuleSource {
  const profile = record(value, PROFILE_KEYS, "source");
  equal(profile.schemaVersion, CLASSIC_MODULE_SOURCE_SCHEMA, "source.schemaVersion");
  equal(profile.chainId, 4663, "source.chainId");
  equal(profile.sourceVersion, CLASSIC_MODULE_SOURCE_VERSION, "source.sourceVersion");
  equal(profile.status, "active", "source.status");
  equal(profile.enabled, true, "source.enabled");
  equal(profile.poolFee, 0, "source.poolFee");
  equal(profile.tickSpacing, 200, "source.tickSpacing");
  equal(profile.finalityPolicy, CLASSIC_MODULE_FINALITY_POLICY, "source.finalityPolicy");
  const launcher = address(profile.launcher, "source.launcher");
  const hook = address(profile.hook, "source.hook");
  const registry = address(profile.registry, "source.registry");
  const poolManager = address(profile.poolManager, "source.poolManager");
  const tokenFactory = address(profile.tokenFactory, "source.tokenFactory");
  if (new Set([launcher, hook, registry, poolManager, tokenFactory]).size !== 5) fail("source.duplicate-address");
  return Object.freeze({
    schemaVersion: CLASSIC_MODULE_SOURCE_SCHEMA,
    chainId: 4663,
    sourceVersion: CLASSIC_MODULE_SOURCE_VERSION,
    status: "active",
    enabled: true,
    releaseDigest: hash(profile.releaseDigest, "source.releaseDigest"),
    launcher,
    launcherRuntimeCodeHash: hash(profile.launcherRuntimeCodeHash, "source.launcherRuntimeCodeHash"),
    hook,
    hookRuntimeCodeHash: hash(profile.hookRuntimeCodeHash, "source.hookRuntimeCodeHash"),
    registry,
    registryRuntimeCodeHash: hash(profile.registryRuntimeCodeHash, "source.registryRuntimeCodeHash"),
    poolManager,
    poolManagerRuntimeCodeHash: hash(profile.poolManagerRuntimeCodeHash, "source.poolManagerRuntimeCodeHash"),
    tokenFactory,
    tokenFactoryRuntimeCodeHash: hash(profile.tokenFactoryRuntimeCodeHash, "source.tokenFactoryRuntimeCodeHash"),
    tokenCreationCodeHash: hash(profile.tokenCreationCodeHash, "source.tokenCreationCodeHash"),
    startBlock: uint(profile.startBlock, "source.startBlock", true),
    minimumInitialBuyNative: uint(profile.minimumInitialBuyNative, "source.minimumInitialBuyNative", true),
    poolFee: 0,
    tickSpacing: 200,
    finalityPolicy: CLASSIC_MODULE_FINALITY_POLICY,
  });
}

type LaunchRecord = Readonly<{
  launchId: Hex;
  launchWallet: Address;
  token: Address;
  poolId: Hex;
  recipeHash: Hex;
  hook: Address;
  positionRecipient: Address;
  positionTokenId: string;
  initialBuyNative: string;
  initialBuyTokens: string;
}>;

function normalizeRecord(value: unknown): LaunchRecord {
  const item = record(value, RECORD_KEYS, "getLaunch.record");
  return Object.freeze({
    launchId: hash(item.launchId, "launchId"),
    launchWallet: address(item.launchWallet, "launchWallet"),
    token: address(item.token, "token"),
    poolId: hash(item.poolId, "poolId"),
    recipeHash: hash(item.recipeHash, "recipeHash"),
    hook: address(item.hook, "hook"),
    positionRecipient: address(item.positionRecipient, "positionRecipient"),
    positionTokenId: uint(item.positionTokenId, "positionTokenId", true),
    initialBuyNative: uint(item.initialBuyNative, "initialBuyNative", true),
    initialBuyTokens: uint(item.initialBuyTokens, "initialBuyTokens", true),
  });
}

type BlockBinding = Readonly<{ chainId: 4663; blockNumber: string; blockHash: Hex }>;

function boundBlock(value: Record<string, unknown>, expected: BlockBinding, label: string) {
  equal(value.chainId, expected.chainId, `${label}.chainId`);
  equal(uint(value.blockNumber, `${label}.blockNumber`, true), expected.blockNumber, `${label}.blockNumber`);
  equal(hash(value.blockHash, `${label}.blockHash`), expected.blockHash, `${label}.blockHash`);
}

function validateFinality(value: unknown, source: ClassicModuleSource, block: BlockBinding, transactionHash: Hex) {
  const proof = record(value, [
    "status", "policy", "verificationDigest", "sourceReleaseDigest", "l2", "l1Posting", "l1Finalized", "providers",
  ], "verification");
  equal(proof.status, "verified", "verification.status");
  equal(proof.policy, source.finalityPolicy, "verification.policy");
  equal(hash(proof.sourceReleaseDigest, "verification.sourceReleaseDigest"), source.releaseDigest,
    "verification.sourceReleaseDigest");
  const l2 = record(proof.l2, ["chainId", "blockNumber", "blockHash", "transactionHash"], "verification.l2");
  boundBlock(l2, block, "verification.l2");
  equal(hash(l2.transactionHash, "verification.l2.transactionHash"), transactionHash, "verification.l2.transactionHash");
  const posting = record(proof.l1Posting, ["chainId", "blockNumber", "blockHash", "transactionHash"], "verification.l1Posting");
  equal(posting.chainId, 1, "verification.l1Posting.chainId");
  const postingNumber = uint(posting.blockNumber, "verification.l1Posting.blockNumber", true);
  const postingHash = hash(posting.blockHash, "verification.l1Posting.blockHash");
  hash(posting.transactionHash, "verification.l1Posting.transactionHash");
  const finalized = record(proof.l1Finalized, ["chainId", "blockNumber", "blockHash", "tag"], "verification.l1Finalized");
  equal(finalized.chainId, 1, "verification.l1Finalized.chainId");
  equal(finalized.tag, "finalized", "verification.l1Finalized.tag");
  const finalizedNumber = uint(finalized.blockNumber, "verification.l1Finalized.blockNumber", true);
  const finalizedHash = hash(finalized.blockHash, "verification.l1Finalized.blockHash");
  if (BigInt(postingNumber) > BigInt(finalizedNumber)) fail("verification.posting-after-finality");
  if (postingNumber === finalizedNumber) equal(postingHash, finalizedHash, "verification.posting-finalized-block");
  if (!Array.isArray(proof.providers) || proof.providers.length !== 2) fail("verification.providers");
  const providerIds = new Set<string>();
  for (const value of proof.providers) {
    const provider = record(value, ["id", "blockNumber", "blockHash"], "verification.provider");
    if (typeof provider.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(provider.id) ||
      providerIds.has(provider.id)) fail("verification.provider.id");
    providerIds.add(provider.id);
    equal(uint(provider.blockNumber, "verification.provider.blockNumber", true), finalizedNumber,
      "verification.provider.blockNumber");
    equal(hash(provider.blockHash, "verification.provider.blockHash"), finalizedHash, "verification.provider.blockHash");
  }
  return Object.freeze({
    policy: CLASSIC_MODULE_FINALITY_POLICY,
    verificationDigest: hash(proof.verificationDigest, "verification.verificationDigest"),
    ethereumBlockNumber: finalizedNumber,
    ethereumBlockHash: finalizedHash,
  });
}

export type ClassicModuleSnapshot = Readonly<{
  familyId: Hex;
  versionId: Hex;
  implementation: Address;
  codeHash: Hex;
  kind: 1 | 2;
  config: Hex;
}>;

function normalizeModules(value: unknown): readonly ClassicModuleSnapshot[] {
  if (!Array.isArray(value) || value.length > MAX_CLASSIC_MODULES) fail("recipe.modules");
  const families = new Set<string>();
  const revisions = new Set<string>();
  let feePolicies = 0;
  let previousFamily = "";
  const modules = value.map((raw): ClassicModuleSnapshot => {
    const item = record(raw, ["versionId", "familyId", "implementation", "codeHash", "kind", "config"], "recipe.module");
    const familyId = hash(item.familyId, "recipe.module.familyId");
    const versionId = hash(item.versionId, "recipe.module.versionId");
    if (families.has(familyId) || revisions.has(versionId)) fail("recipe.duplicate-module-slot");
    if (familyId <= previousFamily) fail("recipe.module-order");
    previousFamily = familyId;
    families.add(familyId);
    revisions.add(versionId);
    if (item.kind !== 1 && item.kind !== 2) fail("recipe.module.kind");
    if (item.kind === 1 && ++feePolicies > 1) fail("recipe.conflicting-fee-policies");
    return Object.freeze({
      familyId,
      versionId,
      implementation: address(item.implementation, "recipe.module.implementation"),
      codeHash: hash(item.codeHash, "recipe.module.codeHash"),
      kind: item.kind,
      config: bytes(item.config, "recipe.module.config", 256),
    });
  });
  return Object.freeze(modules);
}

/**
 * Checks the internal consistency of collector-verified evidence. This function does not call an RPC,
 * authenticate the collector, establish Ethereum finality, or authorize a release profile.
 */
export function normalizeClassicModuleLaunch(evidence: unknown, profile: unknown) {
  const source = bindActiveClassicModuleSource(profile);
  const input = record(evidence, [
    "schemaVersion", "header", "receipt", "event", "getLaunch", "token", "factoryPrediction", "pool", "recipe", "registry", "runtimeReads", "verification",
  ], "evidence");
  equal(input.schemaVersion, CLASSIC_MODULE_EVIDENCE_SCHEMA, "evidence.schemaVersion");
  const header = record(input.header, ["chainId", "blockNumber", "blockHash"], "header");
  equal(header.chainId, source.chainId, "header.chainId");
  const block = Object.freeze({
    chainId: source.chainId,
    blockNumber: uint(header.blockNumber, "header.blockNumber", true),
    blockHash: hash(header.blockHash, "header.blockHash"),
  });
  if (BigInt(block.blockNumber) < BigInt(source.startBlock)) fail("header.before-deployment");
  const receipt = record(input.receipt, ["chainId", "blockNumber", "blockHash", "transactionHash", "status"], "receipt");
  boundBlock(receipt, block, "receipt");
  equal(receipt.status, "success", "receipt.status");
  const transactionHash = hash(receipt.transactionHash, "receipt.transactionHash");
  const verification = validateFinality(input.verification, source, block, transactionHash);
  const event = record(input.event, [
    "chainId", "blockNumber", "blockHash", "transactionHash", "logIndex", "address", "topics", "data", "removed",
  ], "event");
  boundBlock(event, block, "event");
  equal(hash(event.transactionHash, "event.transactionHash"), transactionHash, "event.transactionHash");
  equal(address(event.address, "event.address"), source.launcher, "event.address");
  equal(event.removed, false, "event.removed");
  const logIndex = integer(event.logIndex, "event.logIndex");
  if (!Array.isArray(event.topics) || event.topics.length !== 4) fail("event.topics");
  const topics = event.topics.map((topic) => hash(topic, "event.topic")) as [Hex, ...Hex[]];
  const data = bytes(event.data, "event.data", 224);
  if (data.length !== 450) fail("event.data-length");
  let emitted: LaunchRecord;
  try {
    const decoded = decodeEventLog({ abi: classicModuleProvenanceAbi, eventName: "ClassicModuleLaunched", topics, data, strict: true });
    emitted = normalizeRecord({
      ...decoded.args,
      positionTokenId: decoded.args.positionTokenId.toString(),
      initialBuyNative: decoded.args.initialBuyNative.toString(),
      initialBuyTokens: decoded.args.initialBuyTokens.toString(),
    });
  } catch {
    fail("event.decode");
  }
  const canonicalTopics = encodeEventTopics({
    abi: classicModuleProvenanceAbi,
    eventName: "ClassicModuleLaunched",
    args: { launchId: emitted.launchId, launchWallet: emitted.launchWallet, token: emitted.token },
  });
  for (let index = 0; index < topics.length; index++) equal(topics[index], canonicalTopics[index], "event.canonical-topics");
  equal(data, encodeAbiParameters([
    { type: "bytes32" }, { type: "bytes32" }, { type: "address" }, { type: "address" },
    { type: "uint256" }, { type: "uint256" }, { type: "uint256" },
  ], [emitted.poolId, emitted.recipeHash, emitted.hook, emitted.positionRecipient, BigInt(emitted.positionTokenId),
    BigInt(emitted.initialBuyNative), BigInt(emitted.initialBuyTokens)]), "event.canonical-data");
  equal(emitted.hook, source.hook, "event.hook");
  if (BigInt(emitted.initialBuyNative) < BigInt(source.minimumInitialBuyNative)) fail("event.initial-buy-below-minimum");
  if ([source.launcher, source.hook, source.registry, source.poolManager, source.tokenFactory].includes(emitted.token)) {
    fail("event.token-infrastructure");
  }
  const getter = record(input.getLaunch, ["chainId", "blockNumber", "blockHash", "address", "token", "tokenFactory", "record"], "getLaunch");
  boundBlock(getter, block, "getLaunch");
  equal(address(getter.address, "getLaunch.address"), source.launcher, "getLaunch.address");
  equal(address(getter.token, "getLaunch.token"), emitted.token, "getLaunch.token");
  // This wrapper field is a separate launcher.tokenFactory() read, not a LaunchRecord ABI field.
  equal(address(getter.tokenFactory, "getLaunch.tokenFactory"), source.tokenFactory, "getLaunch.tokenFactory");
  const stored = normalizeRecord(getter.record);
  for (const key of RECORD_KEYS) equal(stored[key], emitted[key], `getLaunch.record.${key}`);

  const token = record(input.token, [
    "chainId", "blockNumber", "blockHash", "address", "name", "symbol", "decimals", "totalSupply", "creator", "graffiti", "creatorSalt",
  ], "token");
  boundBlock(token, block, "token");
  equal(address(token.address, "token.address"), emitted.token, "token.address");
  const name = tokenText(token.name, "token.name", 48);
  const symbol = tokenText(token.symbol, "token.symbol", 12);
  equal(token.decimals, 18, "token.decimals");
  equal(uint(token.totalSupply, "token.totalSupply", true), "1000000000000000000000000000", "token.totalSupply");
  equal(address(token.creator, "token.creator"), source.launcher, "token.creator");
  const creatorSalt = bytes(token.creatorSalt, "token.creatorSalt", 32);
  if (creatorSalt.length !== 66) fail("token.creatorSalt.length");
  const graffiti = hash(token.graffiti, "token.graffiti");
  equal(graffiti, keccak256(encodeAbiParameters([
    { type: "string" }, { type: "uint256" }, { type: "address" }, { type: "address" }, { type: "bytes32" },
  ], ["programmable.classic-module-token.v1", BigInt(source.chainId), source.launcher, emitted.launchWallet, creatorSalt])),
  "token.computedGraffiti");
  const tokenSalt = keccak256(encodeAbiParameters([
    { type: "string" }, { type: "string" }, { type: "uint8" }, { type: "address" }, { type: "bytes32" },
  ], [name, symbol, 18, source.launcher, graffiti]));
  const predictedToken = getCreate2Address({ from: source.tokenFactory, salt: tokenSalt, bytecodeHash: source.tokenCreationCodeHash }).toLowerCase();
  equal(predictedToken, emitted.token, "token.computedAddress");
  const prediction = record(input.factoryPrediction, [
    "chainId", "blockNumber", "blockHash", "address", "name", "symbol", "decimals", "creator", "graffiti", "token",
  ], "factoryPrediction");
  boundBlock(prediction, block, "factoryPrediction");
  equal(address(prediction.address, "factoryPrediction.address"), source.tokenFactory, "factoryPrediction.address");
  equal(prediction.name, name, "factoryPrediction.name");
  equal(prediction.symbol, symbol, "factoryPrediction.symbol");
  equal(prediction.decimals, 18, "factoryPrediction.decimals");
  equal(address(prediction.creator, "factoryPrediction.creator"), source.launcher, "factoryPrediction.creator");
  equal(hash(prediction.graffiti, "factoryPrediction.graffiti"), graffiti, "factoryPrediction.graffiti");
  equal(address(prediction.token, "factoryPrediction.token"), emitted.token, "factoryPrediction.token");

  const pool = record(input.pool, ["chainId", "blockNumber", "blockHash", "address", "poolId", "key", "sqrtPriceX96"], "pool");
  boundBlock(pool, block, "pool");
  equal(address(pool.address, "pool.address"), source.poolManager, "pool.address");
  equal(hash(pool.poolId, "pool.poolId"), emitted.poolId, "pool.poolId");
  const key = record(pool.key, ["currency0", "currency1", "fee", "tickSpacing", "hooks"], "pool.key");
  equal(address(key.currency0, "pool.key.currency0", true), ZERO_ADDRESS, "pool.key.currency0");
  equal(address(key.currency1, "pool.key.currency1"), emitted.token, "pool.key.currency1");
  equal(address(key.hooks, "pool.key.hooks"), source.hook, "pool.key.hooks");
  equal(key.fee, source.poolFee, "pool.key.fee");
  equal(key.tickSpacing, source.tickSpacing, "pool.key.tickSpacing");
  const computedPoolId = keccak256(encodeAbiParameters([
    { type: "address" }, { type: "address" }, { type: "uint24" }, { type: "int24" }, { type: "address" },
  ], [ZERO_ADDRESS, emitted.token, source.poolFee, source.tickSpacing, source.hook]));
  equal(computedPoolId, emitted.poolId, "pool.computedPoolId");
  if (BigInt(uint(pool.sqrtPriceX96, "pool.sqrtPriceX96", true)) >= 1n << 160n) fail("pool.sqrtPriceX96.range");

  const recipe = record(input.recipe, [
    "chainId", "blockNumber", "blockHash", "address", "poolId", "recipeHash", "registry",
    "registrar", "launchWallet", "baseBuyFeeBps", "baseSellFeeBps", "modules",
  ], "recipe");
  boundBlock(recipe, block, "recipe");
  equal(address(recipe.address, "recipe.address"), source.hook, "recipe.address");
  equal(hash(recipe.poolId, "recipe.poolId"), emitted.poolId, "recipe.poolId");
  equal(hash(recipe.recipeHash, "recipe.recipeHash"), emitted.recipeHash, "recipe.recipeHash");
  equal(address(recipe.registry, "recipe.registry"), source.registry, "recipe.registry");
  equal(address(recipe.registrar, "recipe.registrar"), source.launcher, "recipe.registrar");
  equal(address(recipe.launchWallet, "recipe.launchWallet"), emitted.launchWallet, "recipe.launchWallet");
  const baseBuyFeeBps = integer(recipe.baseBuyFeeBps, "recipe.baseBuyFeeBps", 1_000);
  const baseSellFeeBps = integer(recipe.baseSellFeeBps, "recipe.baseSellFeeBps", 1_000);
  if (baseBuyFeeBps % 100 !== 0 || baseSellFeeBps % 100 !== 0) fail("recipe.fee-step");
  const modules = normalizeModules(recipe.modules);
  const itemHashes = modules.map((module) => keccak256(encodeAbiParameters([
    { type: "bytes32" }, { type: "bytes32" }, { type: "address" },
    { type: "bytes32" }, { type: "uint8" }, { type: "bytes32" },
  ], [module.versionId, module.familyId, module.implementation, module.codeHash, module.kind, keccak256(module.config)])));
  const computedRecipeHash = keccak256(encodeAbiParameters([
    { type: "bytes32" }, { type: "uint256" }, { type: "address" }, { type: "address" },
    { type: "uint16" }, { type: "uint16" }, { type: "bytes32[]" },
  ], [keccak256(toHex("programmable.classic.recipe.v1")), BigInt(source.chainId), source.hook, source.registry,
    baseBuyFeeBps, baseSellFeeBps, itemHashes]));
  equal(computedRecipeHash, emitted.recipeHash, "recipe.computedRecipeHash");
  const registry = record(input.registry, ["chainId", "blockNumber", "blockHash", "address", "versions"], "registry");
  boundBlock(registry, block, "registry");
  equal(address(registry.address, "registry.address"), source.registry, "registry.address");
  if (!Array.isArray(registry.versions) || registry.versions.length !== modules.length) fail("registry.versions");
  const versionsSeen = new Set<string>();
  const versions = registry.versions.map((raw) => {
    const version = record(raw, [
      "versionId", "familyId", "version", "implementation", "codeHash", "manifestHash", "kind", "enabled", "author",
    ], "registry.version");
    const versionId = hash(version.versionId, "registry.version.versionId");
    if (versionsSeen.has(versionId)) fail("registry.duplicate-version");
    versionsSeen.add(versionId);
    const snapshot = modules.find((module) => module.versionId === versionId);
    if (!snapshot) fail("registry.unknown-version");
    const versionNumber = integer(version.version, "registry.version.version", 0xffff_ffff);
    if (versionNumber === 0) fail("registry.version.zero");
    equal(hash(version.familyId, "registry.version.familyId"), snapshot.familyId, "registry.version.familyId");
    equal(keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint32" }], [snapshot.familyId, versionNumber])),
      versionId, "registry.version.computedVersionId");
    equal(address(version.implementation, "registry.version.implementation"), snapshot.implementation, "registry.version.implementation");
    equal(hash(version.codeHash, "registry.version.codeHash"), snapshot.codeHash, "registry.version.codeHash");
    equal(version.kind, snapshot.kind, "registry.version.kind");
    // A reviewer may disable new use later in the same block. Historical recipes remain valid.
    if (typeof version.enabled !== "boolean") fail("registry.version.enabled");
    return Object.freeze({
      versionId,
      version: versionNumber,
      manifestHash: hash(version.manifestHash, "registry.version.manifestHash"),
      author: address(version.author, "registry.version.author"),
    });
  });
  const expectedRuntime = new Map<Address, Hex>([
    [source.launcher, source.launcherRuntimeCodeHash], [source.hook, source.hookRuntimeCodeHash],
    [source.registry, source.registryRuntimeCodeHash],
    [source.poolManager, source.poolManagerRuntimeCodeHash], [source.tokenFactory, source.tokenFactoryRuntimeCodeHash],
  ]);
  for (const snapshot of modules) {
    if (snapshot.implementation === emitted.token) fail("recipe.token-as-module");
    const existing = expectedRuntime.get(snapshot.implementation);
    if (existing && existing !== snapshot.codeHash) fail("recipe.runtime-conflict");
    expectedRuntime.set(snapshot.implementation, snapshot.codeHash);
  }
  if (!Array.isArray(input.runtimeReads) || input.runtimeReads.length !== expectedRuntime.size + 1) fail("runtimeReads.length");
  const seen = new Set<Address>();
  let tokenRuntimeCodeHash: Hex | null = null;
  for (const raw of input.runtimeReads) {
    const runtime = record(raw, ["chainId", "blockNumber", "blockHash", "address", "code"], "runtime");
    boundBlock(runtime, block, "runtime");
    const account = address(runtime.address, "runtime.address");
    if (seen.has(account) || (!expectedRuntime.has(account) && account !== emitted.token)) fail("runtime.address-set");
    seen.add(account);
    const code = bytes(runtime.code, "runtime.code");
    if (code === "0x") fail("runtime.empty");
    const runtimeHash = keccak256(code);
    // UERC20 runtime contains per-token immutables. Identity is authenticated through the released
    // factory + launcher creation path above; this observed hash is not an independent source match.
    if (account === emitted.token) tokenRuntimeCodeHash = runtimeHash;
    else equal(runtimeHash, expectedRuntime.get(account), "runtime.codehash");
  }
  if (tokenRuntimeCodeHash === null) fail("runtime.token-missing");
  return Object.freeze({
    schemaVersion: CLASSIC_MODULE_PROVENANCE_SCHEMA,
    id: `${source.chainId}:${emitted.token}`,
    poolIdentity: `${source.chainId}:${source.poolManager}:${emitted.poolId}`,
    launchIdentity: `${source.chainId}:${source.launcher}:${emitted.launchId}`,
    kind: "classic" as const,
    chainId: source.chainId,
    sourceVersion: source.sourceVersion,
    sourceAddress: source.launcher,
    sourceRuntimeCodeHash: source.launcherRuntimeCodeHash,
    sourceReleaseDigest: source.releaseDigest,
    poolManager: source.poolManager,
    registry: source.registry,
    tokenFactory: source.tokenFactory,
    tokenCreationCodeHash: source.tokenCreationCodeHash,
    tokenRuntimeCodeHash,
    tokenIdentity: Object.freeze({ name, symbol, decimals: 18, totalSupply: token.totalSupply as string, creator: source.launcher, graffiti, creatorSalt }),
    ...emitted,
    modules,
    versions: Object.freeze(modules.map((snapshot) => versions.find((version) => version.versionId === snapshot.versionId)!)),
    baseBuyFeeBps,
    baseSellFeeBps,
    blockNumber: block.blockNumber,
    blockHash: block.blockHash,
    transactionHash,
    logIndex,
    verification,
  });
}

export type ClassicModuleProvenance = ReturnType<typeof normalizeClassicModuleLaunch>;

/** Reject a partial or duplicate batch; callers commit this result and its checkpoint atomically. */
export function normalizeClassicModuleLaunches(evidence: readonly unknown[], profile: unknown): readonly ClassicModuleProvenance[] {
  if (!Array.isArray(evidence) || evidence.length > 1_000) fail("batch.length");
  bindActiveClassicModuleSource(profile);
  const tokens = new Set<string>();
  const pools = new Set<string>();
  const launches = new Set<string>();
  const slots = new Set<string>();
  const result = evidence.map((entry) => {
    const normalized = normalizeClassicModuleLaunch(entry, profile);
    const slot = `${normalized.chainId}:${normalized.transactionHash}:${normalized.logIndex}`;
    if (tokens.has(normalized.id) || pools.has(normalized.poolIdentity) || launches.has(normalized.launchIdentity) || slots.has(slot)) {
      fail("batch.duplicate-identity");
    }
    tokens.add(normalized.id);
    pools.add(normalized.poolIdentity);
    launches.add(normalized.launchIdentity);
    slots.add(slot);
    return normalized;
  });
  return Object.freeze(result);
}
