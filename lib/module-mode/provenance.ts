import { decodeEventLog, encodeAbiParameters, encodeEventTopics, getCreate2Address, keccak256,
  parseAbi, parseAbiParameters, toHex, type Address, type Hex } from "viem";
import { bindActiveModuleModeRelease, moduleAddress as address, moduleBytes as bytes, moduleEqual as equal,
  moduleHash as hash, moduleInteger as integer, moduleRecord as record, moduleUint as uint,
  rejectModuleEvidence as fail, type ModuleModeRelease } from "./release";

export const MODULE_MODE_EVIDENCE_SCHEMA = "programmable.module-mode-evidence.v1" as const;
export const MODULE_MODE_PROVENANCE_SCHEMA = "programmable.module-mode-provenance.v1" as const;
export const moduleModeLaunchAbi = parseAbi([
  "event ModuleNativeLaunched(bytes32 indexed launchId,address indexed launchWallet,address indexed token,bytes32 poolId,bytes32 recipeHash,address hook,address positionRecipient,uint256 positionTokenId,uint256 initialBuyNative,uint256 initialBuyTokens)",
  "event ModuleNativeProgramBound(bytes32 indexed launchId,bytes32 indexed launchKey,address indexed runtime,bytes32 fundingHash,uint256 totalFunding)",
  "event ModuleNativeConfigurationBound(bytes32 indexed launchId,bytes32 metadataHash,bytes32 creatorConfigurationHash,bytes32 economicsHash)",
  "event ModuleNativeTokenIdentityBound(bytes32 indexed launchId,bytes32 creatorSalt,bytes32 graffiti)",
  "function getLaunch(address token) view returns ((bytes32 launchId,address launchWallet,address token,bytes32 poolId,bytes32 recipeHash,address hook,address positionRecipient,uint256 positionTokenId,uint256 initialBuyNative,uint256 initialBuyTokens,address runtime,bytes32 launchKey))",
  "function launchIdentityVersion() pure returns (uint256)",
  "function getLaunchIdentity(address token) view returns ((bytes32 launchId,address launchWallet,address token,address poolManager,bytes32 poolId,address hook,bytes32 recipeHash))",
]);
const SELECTIONS = "(bytes32 packageId,address factory,bytes32 factoryCodeHash,bytes32 moduleCodeHash,uint32 callbackGas,bytes config)[]";
const BLOCK_KEYS = ["chainId", "blockNumber", "blockHash"];
const LAUNCH_KEYS = ["launchId", "launchWallet", "token", "poolId", "recipeHash", "hook", "positionRecipient",
  "positionTokenId", "initialBuyNative", "initialBuyTokens"];
type Block = Readonly<{ chainId: 4663; blockNumber: string; blockHash: Hex }>;

function bound(value: unknown, keys: readonly string[], block: Block, label: string) {
  const result = record(value, [...BLOCK_KEYS, ...keys], label);
  equal(result.chainId, block.chainId, `${label}.chainId`);
  equal(uint(result.blockNumber, `${label}.blockNumber`, true), block.blockNumber, `${label}.blockNumber`);
  equal(hash(result.blockHash, `${label}.blockHash`), block.blockHash, `${label}.blockHash`);
  return result;
}
function list(value: unknown, label: string, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length > maximum || Object.keys(value).length !== value.length
    || Reflect.ownKeys(value).length !== value.length + 1) fail(`${label}.array`);
  for (let i = 0; i < value.length; i++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
    if (!descriptor || !("value" in descriptor)) fail(`${label}.array`);
  }
  return value;
}
function text(value: unknown, label: string, maxBytes: number): string {
  if (typeof value !== "string" || !value || new TextEncoder().encode(value).length > maxBytes) fail(`${label}.text`);
  return value;
}
function launchRecord(value: unknown) {
  const item = record(value, [...LAUNCH_KEYS, "runtime", "launchKey"], "getLaunch.record");
  return Object.freeze({ launchId: hash(item.launchId, "launchId"), launchWallet: address(item.launchWallet, "launchWallet"),
    token: address(item.token, "token"), poolId: hash(item.poolId, "poolId"), recipeHash: hash(item.recipeHash, "recipeHash"),
    hook: address(item.hook, "hook"), positionRecipient: address(item.positionRecipient, "positionRecipient"),
    positionTokenId: uint(item.positionTokenId, "positionTokenId", true), initialBuyNative: uint(item.initialBuyNative, "initialBuyNative", true),
    initialBuyTokens: uint(item.initialBuyTokens, "initialBuyTokens", true), runtime: address(item.runtime, "runtime"),
    launchKey: hash(item.launchKey, "launchKey") });
}
function event(value: unknown, block: Block, tx: Hex, source: Address, name: "ModuleNativeLaunched" | "ModuleNativeProgramBound" | "ModuleNativeConfigurationBound" | "ModuleNativeTokenIdentityBound") {
  const item = bound(value, ["transactionHash", "logIndex", "address", "topics", "data", "removed"], block, name);
  equal(item.removed, false, `${name}.removed`);
  equal(address(item.address, `${name}.address`), source, `${name}.address`);
  equal(hash(item.transactionHash, `${name}.transactionHash`), tx, `${name}.transactionHash`);
  const topics = list(item.topics, `${name}.topics`, 4).map((topic) => hash(topic, `${name}.topic`)) as [Hex, ...Hex[]];
  if (topics.length !== (name === "ModuleNativeLaunched" || name === "ModuleNativeProgramBound" ? 4 : 2)) fail(`${name}.topics`);
  const data = bytes(item.data, `${name}.data`, 224);
  const words = name === "ModuleNativeLaunched" ? 7 : name === "ModuleNativeConfigurationBound" ? 3 : 2;
  if (data.length !== 2 + words * 64) fail(`${name}.data-length`);
  try {
    const decoded = decodeEventLog({ abi: moduleModeLaunchAbi, eventName: name, topics, data, strict: true });
    // Canonical ABI roundtrip rejects address padding, extra topics and alternate encodings.
    const expectedTopics = encodeEventTopics({ abi: moduleModeLaunchAbi, eventName: name, args: decoded.args });
    for (let i = 0; i < topics.length; i++) {
      const expected = expectedTopics[i];
      equal(topics[i], typeof expected === "string" ? expected.toLowerCase() : null, `${name}.canonical-topics`);
    }
    const abi = moduleModeLaunchAbi.find((entry) => entry.type === "event" && entry.name === name)!;
    if (abi.type !== "event") fail("event.abi");
    const inputs = abi.inputs.filter((input) => !("indexed" in input && input.indexed));
    const args = decoded.args as Record<string, unknown>;
    equal(data, encodeAbiParameters(inputs, inputs.map((input) => args[input.name])).toLowerCase(), `${name}.canonical-data`);
    return { args, logIndex: integer(item.logIndex, `${name}.logIndex`) };
  } catch { fail(`${name}.decode`); }
}

function finality(value: unknown, source: ModuleModeRelease, block: Block, transactionHash: Hex) {
  const proof = record(value, ["status", "policy", "verificationDigest", "sourceReleaseDigest", "l2", "l1Posting", "l1Finalized", "providers"], "verification");
  equal(proof.status, "verified", "verification.status");
  equal(proof.policy, source.finalityPolicy, "verification.policy");
  equal(hash(proof.sourceReleaseDigest, "verification.sourceReleaseDigest"), source.releaseDigest, "verification.sourceReleaseDigest");
  const l2 = bound(proof.l2, ["transactionHash"], block, "verification.l2");
  equal(hash(l2.transactionHash, "verification.l2.transactionHash"), transactionHash, "verification.l2.transactionHash");
  const posting = record(proof.l1Posting, ["chainId", "blockNumber", "blockHash", "transactionHash", "batchNumber"], "verification.l1Posting");
  equal(posting.chainId, 1, "verification.l1Posting.chainId");
  const postingNumber = uint(posting.blockNumber, "verification.l1Posting.blockNumber", true);
  const postingHash = hash(posting.blockHash, "verification.l1Posting.blockHash");
  const l1 = record(proof.l1Finalized, ["chainId", "blockNumber", "blockHash", "tag"], "verification.l1Finalized");
  equal(l1.chainId, 1, "verification.l1Finalized.chainId");
  equal(l1.tag, "finalized", "verification.l1Finalized.tag");
  const number = uint(l1.blockNumber, "verification.l1Finalized.blockNumber", true);
  const blockHash = hash(l1.blockHash, "verification.l1Finalized.blockHash");
  if (BigInt(postingNumber) > BigInt(number) || (postingNumber === number && postingHash !== blockHash)) fail("verification.posting-after-finality");
  const providers = list(proof.providers, "verification.providers", 4).map((raw) => {
    const p = record(raw, ["id", "trustDomain", "chainId", "blockNumber", "blockHash"], "verification.provider");
    const id = text(p.id, "verification.provider.id", 128);
    const trustDomain = text(p.trustDomain, "verification.provider.trustDomain", 128).toLowerCase();
    if (!/^[a-z0-9][a-z0-9.-]*$/u.test(trustDomain)) fail("verification.provider.trustDomain");
    if (p.chainId !== 1 && p.chainId !== 4663) fail("verification.provider.chainId");
    const expected = p.chainId === 1 ? { number, blockHash } : { number: block.blockNumber, blockHash: block.blockHash };
    equal(uint(p.blockNumber, "verification.provider.blockNumber", true), expected.number, "verification.provider.blockNumber");
    equal(hash(p.blockHash, "verification.provider.blockHash"), expected.blockHash, "verification.provider.blockHash");
    return Object.freeze({ id, trustDomain, chainId: p.chainId, blockNumber: expected.number, blockHash: expected.blockHash });
  });
  for (const chain of [1, 4663]) {
    const pair = providers.filter((p) => p.chainId === chain);
    if (pair.length !== 2 || pair[0]!.id === pair[1]!.id || pair[0]!.trustDomain === pair[1]!.trustDomain) fail("verification.provider-quorum");
  }
  return Object.freeze({ verificationDigest: hash(proof.verificationDigest, "verification.verificationDigest"),
    ethereumBlockNumber: number, ethereumBlockHash: blockHash, batchNumber: uint(posting.batchNumber, "verification.batchNumber"),
    postingTransactionHash: hash(posting.transactionHash, "verification.postingTransactionHash"), providers: Object.freeze(providers) });
}

/**
 * Internal consistency only. All RPC bytes, receipt inclusion, release authority and rollup batch/finality
 * observations must already be authenticated by the collector. Never accept a public JSON "verified" claim.
 */
export function normalizeModuleModeLaunch(evidence: unknown, profile: unknown) {
  const release = bindActiveModuleModeRelease(profile);
  const pins = release.contracts;
  const input = record(evidence, ["schemaVersion", "header", "receipt", "event", "programEvent", "configurationEvent",
    "tokenIdentityEvent", "getLaunch", "identity", "token", "pool", "program", "registry", "runtimeReads", "verification"], "evidence");
  equal(input.schemaVersion, MODULE_MODE_EVIDENCE_SCHEMA, "evidence.schemaVersion");
  const header = record(input.header, BLOCK_KEYS, "header");
  equal(header.chainId, 4663, "header.chainId");
  const block: Block = { chainId: 4663, blockNumber: uint(header.blockNumber, "header.blockNumber", true), blockHash: hash(header.blockHash, "header.blockHash") };
  if (BigInt(block.blockNumber) < BigInt(release.startBlock)) fail("header.before-deployment");
  const receipt = bound(input.receipt, ["transactionHash", "status"], block, "receipt");
  equal(receipt.status, "success", "receipt.status");
  const tx = hash(receipt.transactionHash, "receipt.transactionHash");
  const verification = finality(input.verification, release, block, tx);
  const rawLaunch = bound(input.getLaunch, ["address", "token", "tokenFactory", "record"], block, "getLaunch");
  equal(address(rawLaunch.address, "getLaunch.address"), pins.launcher.address, "getLaunch.address");
  equal(address(rawLaunch.tokenFactory, "getLaunch.tokenFactory"), pins.tokenFactory.address, "getLaunch.tokenFactory");
  const launch = launchRecord(rawLaunch.record);
  equal(address(rawLaunch.token, "getLaunch.token"), launch.token, "getLaunch.token");
  equal(launch.hook, pins.hook.address, "launch.hook");
  equal(launch.runtime, pins.runtime.address, "launch.runtime");
  if (BigInt(launch.initialBuyNative) < BigInt(release.minimumInitialBuyNative)) fail("launch.minimumInitialBuy");
  const emitted = event(input.event, block, tx, pins.launcher.address, "ModuleNativeLaunched");
  for (const key of LAUNCH_KEYS) {
    const value = emitted.args[key];
    equal(typeof value === "bigint" ? value.toString() : String(value).toLowerCase(), launch[key as keyof typeof launch], `launch.event.${key}`);
  }
  const programEvent = event(input.programEvent, block, tx, pins.launcher.address, "ModuleNativeProgramBound");
  const configuration = event(input.configurationEvent, block, tx, pins.launcher.address, "ModuleNativeConfigurationBound");
  const tokenIdentityEvent = event(input.tokenIdentityEvent, block, tx, pins.launcher.address, "ModuleNativeTokenIdentityBound");
  if (new Set([emitted.logIndex, programEvent.logIndex, configuration.logIndex, tokenIdentityEvent.logIndex]).size !== 4) fail("event.duplicate-log-index");
  equal(hash(tokenIdentityEvent.args.launchId, "tokenIdentityEvent.launchId"), launch.launchId, "tokenIdentityEvent.launchId");
  equal(hash(programEvent.args.launchId, "programEvent.launchId"), launch.launchId, "programEvent.launchId");
  equal(hash(programEvent.args.launchKey, "programEvent.launchKey"), launch.launchKey, "programEvent.launchKey");
  equal(address(programEvent.args.runtime, "programEvent.runtime"), launch.runtime, "programEvent.runtime");
  equal(hash(configuration.args.launchId, "configuration.launchId"), launch.launchId, "configuration.launchId");
  const metadataHash = hash(configuration.args.metadataHash, "configuration.metadataHash");
  const creatorConfigurationHash = hash(configuration.args.creatorConfigurationHash, "configuration.creatorConfigurationHash");
  const economicsHash = hash(configuration.args.economicsHash, "configuration.economicsHash");
  equal(keccak256(encodeAbiParameters(parseAbiParameters("string,uint256,address,address,address,address,bytes32,bytes32,bytes32,bytes32"),
    ["programmable.module-mode.native-launch.v1", 4663n, pins.launcher.address, launch.launchWallet, launch.token, pins.poolManager.address,
      launch.poolId, launch.recipeHash, metadataHash, economicsHash])), launch.launchId, "launch.computedId");
  const identity = bound(input.identity, ["address", "version", "record"], block, "identity");
  equal(address(identity.address, "identity.address"), pins.launcher.address, "identity.address");
  equal(identity.version, 1, "identity.version");
  const identityRecord = record(identity.record, ["launchId", "launchWallet", "token", "poolManager", "poolId", "hook", "recipeHash"], "identity.record");
  for (const [key, value] of Object.entries(identityRecord)) equal(String(value).toLowerCase(), key === "poolManager" ? pins.poolManager.address : launch[key as keyof typeof launch], `identity.${key}`);

  const token = bound(input.token, ["address", "name", "symbol", "decimals", "totalSupply", "creator", "graffiti", "creatorSalt", "factoryPrediction"], block, "token");
  equal(address(token.address, "token.address"), launch.token, "token.address");
  equal(token.decimals, 18, "token.decimals");
  equal(token.totalSupply, "1000000000000000000000000000", "token.totalSupply");
  equal(address(token.creator, "token.creator"), pins.launcher.address, "token.creator");
  const name = text(token.name, "token.name", 64);
  const symbol = text(token.symbol, "token.symbol", 16);
  const creatorSalt = bytes(token.creatorSalt, "token.creatorSalt", 32);
  if (creatorSalt.length !== 66) fail("token.creatorSalt");
  equal(bytes(tokenIdentityEvent.args.creatorSalt, "tokenIdentityEvent.creatorSalt", 32), creatorSalt, "tokenIdentityEvent.creatorSalt");
  const graffiti = keccak256(encodeAbiParameters(parseAbiParameters("string,uint256,address,address,bytes32"),
    ["programmable.module-mode.native-token.v1", 4663n, pins.launcher.address, launch.launchWallet, creatorSalt]));
  equal(hash(token.graffiti, "token.graffiti"), graffiti, "token.graffiti");
  equal(hash(tokenIdentityEvent.args.graffiti, "tokenIdentityEvent.graffiti"), graffiti, "tokenIdentityEvent.graffiti");
  const salt = keccak256(encodeAbiParameters(parseAbiParameters("string,string,uint8,address,bytes32"), [name, symbol, 18, pins.launcher.address, graffiti]));
  equal(getCreate2Address({ from: pins.tokenFactory.address, salt, bytecodeHash: release.tokenCreationCodeHash }).toLowerCase(), launch.token, "token.create2");
  equal(address(token.factoryPrediction, "token.factoryPrediction"), launch.token, "token.factoryPrediction");
  const pool = bound(input.pool, ["address", "poolId", "key", "sqrtPriceX96"], block, "pool");
  equal(address(pool.address, "pool.address"), pins.poolManager.address, "pool.address");
  equal(hash(pool.poolId, "pool.poolId"), launch.poolId, "pool.poolId");
  const key = record(pool.key, ["currency0", "currency1", "fee", "tickSpacing", "hooks"], "pool.key");
  equal(address(key.currency0, "pool.currency0", true), "0x0000000000000000000000000000000000000000", "pool.currency0");
  equal(address(key.currency1, "pool.currency1"), launch.token, "pool.currency1");
  equal(key.fee, 0, "pool.fee"); equal(key.tickSpacing, 200, "pool.tickSpacing");
  equal(address(key.hooks, "pool.hooks"), pins.hook.address, "pool.hooks");
  equal(keccak256(encodeAbiParameters(parseAbiParameters("address,address,uint24,int24,address"),
    [address(key.currency0, "currency0", true), launch.token, 0, 200, pins.hook.address])), launch.poolId, "pool.computedId");
  if (BigInt(uint(pool.sqrtPriceX96, "pool.sqrtPriceX96", true)) >= 1n << 160n) fail("pool.sqrtPriceX96.range");

  const program = bound(input.program, ["address", "engine", "engineCodeHash", "vault", "source", "launchWallet", "token", "poolManager", "poolId",
    "recipeHash", "programHash", "launchKey", "router", "routerCodeHash", "buyCreatorFeeBps", "sellCreatorFeeBps", "selections", "families", "instances", "funding"], block, "program");
  for (const [field, expected] of Object.entries({ address: pins.runtime.address, engine: pins.hook.address, vault: pins.budgetVault.address,
    source: pins.launcher.address, launchWallet: launch.launchWallet, token: launch.token, poolManager: pins.poolManager.address, router: pins.swapRouter.address })) {
    equal(address(program[field], `program.${field}`), expected, `program.${field}`);
  }
  for (const [field, expected] of Object.entries({ engineCodeHash: pins.hook.runtimeCodeHash, routerCodeHash: pins.swapRouter.runtimeCodeHash,
    poolId: launch.poolId, recipeHash: launch.recipeHash, launchKey: launch.launchKey })) equal(hash(program[field], `program.${field}`), expected, `program.${field}`);
  const buyCreatorFeeBps = integer(program.buyCreatorFeeBps, "program.buyCreatorFeeBps", 1000);
  const sellCreatorFeeBps = integer(program.sellCreatorFeeBps, "program.sellCreatorFeeBps", 1000);
  if (buyCreatorFeeBps % 100 || sellCreatorFeeBps % 100) fail("program.fee-step");
  let configBytes = 0; let callbackGas = 0;
  const selections = list(program.selections, "program.selections", 8).map((raw) => {
    const s = record(raw, ["packageId", "factory", "factoryCodeHash", "moduleCodeHash", "callbackGas", "config"], "selection");
    const config = bytes(s.config, "selection.config", 16_384);
    const gas = integer(s.callbackGas, "selection.callbackGas", 500_000);
    configBytes += (config.length - 2) / 2; callbackGas += gas;
    if (gas < 25_000 || callbackGas > 2_000_000 || configBytes > 32_768) fail("program.resource-budget");
    return Object.freeze({ packageId: hash(s.packageId, "selection.packageId"), factory: address(s.factory, "selection.factory"),
      factoryCodeHash: hash(s.factoryCodeHash, "selection.factoryCodeHash"), moduleCodeHash: hash(s.moduleCodeHash, "selection.moduleCodeHash"), callbackGas: gas, config });
  });
  const families = list(program.families, "program.families", 16).map((family) => hash(family, "program.familyId"));
  if (families.length !== selections.length || families.some((family, index) => index > 0 && family <= families[index - 1]!)
    || new Set(selections.map((s) => s.packageId)).size !== selections.length) fail("program.family-order");
  const programHash = keccak256(encodeAbiParameters(parseAbiParameters(`bytes32,${SELECTIONS}`), [keccak256(toHex("programmable.module-mode.native-program.v1")), selections]));
  equal(hash(program.programHash, "program.programHash"), programHash, "program.programHash");
  equal(keccak256(encodeAbiParameters(parseAbiParameters(`string,uint256,address,address,uint16,uint16,bytes32[],${SELECTIONS}`),
    ["programmable.module-mode.native-recipe.v1", 4663n, pins.hook.address, pins.registry.address, buyCreatorFeeBps, sellCreatorFeeBps, families, selections])), launch.recipeHash, "program.computedRecipeHash");
  const binding = { source: pins.launcher.address, launchWallet: launch.launchWallet, token: launch.token, poolManager: pins.poolManager.address, poolId: launch.poolId, recipeHash: launch.recipeHash, programHash };
  equal(keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,address,(address source,address launchWallet,address token,address poolManager,bytes32 poolId,bytes32 recipeHash,bytes32 programHash)"),
    [keccak256(toHex("programmable.module-mode.native-binding.v1")), 4663n, pins.runtime.address, pins.hook.address, binding])), launch.launchKey, "program.computedLaunchKey");
  const funding = list(program.funding, "program.funding", 16).map((value) => uint(value, "program.funding.amount"));
  if (funding.length !== selections.length) fail("program.funding-length");
  equal(keccak256(encodeAbiParameters(parseAbiParameters("uint256[]"), [funding.map(BigInt)])), hash(programEvent.args.fundingHash, "programEvent.fundingHash"), "program.fundingHash");
  equal(funding.reduce((sum, value) => sum + BigInt(value), 0n), programEvent.args.totalFunding, "program.totalFunding");
  const registry = bound(input.registry, ["address", "revisions"], block, "registry");
  equal(address(registry.address, "registry.address"), pins.registry.address, "registry.address");
  const rawRevisions = list(registry.revisions, "registry.revisions", 16);
  if (rawRevisions.length !== selections.length) fail("registry.revisions.length");
  const revisions = rawRevisions.map((raw, index) => {
    const r = record(raw, ["packageId", "familyId", "factory", "factoryCodeHash", "moduleCodeHash", "manifestHash", "callbackGas", "enabled", "author"], "revision");
    for (const field of ["packageId", "factoryCodeHash", "moduleCodeHash"] as const) equal(hash(r[field], `revision.${field}`), selections[index]![field], `revision.${field}`);
    equal(hash(r.familyId, "revision.familyId"), families[index], "revision.familyId");
    equal(address(r.factory, "revision.factory"), selections[index]!.factory, "revision.factory");
    equal(r.callbackGas, selections[index]!.callbackGas, "revision.callbackGas");
    // Availability can change after a successful launch, even in the same finalized block.
    if (typeof r.enabled !== "boolean") fail("revision.enabled");
    return Object.freeze({ packageId: selections[index]!.packageId, familyId: families[index],
      manifestHash: hash(r.manifestHash, "revision.manifestHash"), author: address(r.author, "revision.author") });
  });
  const rawInstances = list(program.instances, "program.instances", 16);
  if (rawInstances.length !== selections.length) fail("program.instances.length");
  const instances = rawInstances.map((raw, index) => {
    const item = record(raw, ["instanceId", "packageId", "configHash", "factory", "factoryCodeHash", "module", "moduleCodeHash", "callbackGas", "bindingHash"], "instance");
    const selected = selections[index]!;
    const instanceId = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256"), [launch.launchKey, BigInt(index)]));
    const configHash = keccak256(selected.config);
    equal(hash(item.instanceId, "instance.instanceId"), instanceId, "instance.instanceId");
    equal(hash(item.configHash, "instance.configHash"), configHash, "instance.configHash");
    for (const field of ["packageId", "factoryCodeHash", "moduleCodeHash"] as const) equal(hash(item[field], `instance.${field}`), selected[field], `instance.${field}`);
    equal(address(item.factory, "instance.factory"), selected.factory, "instance.factory");
    equal(item.callbackGas, selected.callbackGas, "instance.callbackGas");
    equal(hash(item.bindingHash, "instance.bindingHash"), keccak256(encodeAbiParameters(parseAbiParameters("(address runtime,bytes32 launchKey,bytes32 instanceId,bytes32 packageId,bytes32 configHash)"),
      [{ runtime: pins.runtime.address, launchKey: launch.launchKey, instanceId, packageId: selected.packageId, configHash }])), "instance.bindingHash");
    return Object.freeze({ instanceId, module: address(item.module, "instance.module"), packageId: selected.packageId, configHash });
  });
  if (new Set(instances.map((instance) => instance.module)).size !== instances.length) fail("instance.duplicate-module");
  const expectedCode = new Map<Address, Hex>(Object.values(pins).map((pin) => [pin.address, pin.runtimeCodeHash]));
  selections.forEach((selection, index) => {
    for (const [account, codeHash] of [[selection.factory, selection.factoryCodeHash], [instances[index]!.module, selection.moduleCodeHash]] as const) {
      if (expectedCode.has(account) && expectedCode.get(account) !== codeHash) fail("runtime.conflicting-pin");
      if (account === launch.token) fail("runtime.token-as-module");
      expectedCode.set(account, codeHash);
    }
  });
  const codes = list(input.runtimeReads, "runtimeReads", 48);
  if (codes.length !== expectedCode.size + 1) fail("runtimeReads.length");
  const readAddresses = new Set<string>(); let tokenRuntimeCodeHash: Hex | null = null;
  for (const raw of codes) {
    const read = bound(raw, ["address", "code"], block, "runtimeRead");
    const account = address(read.address, "runtimeRead.address");
    if (readAddresses.has(account) || (!expectedCode.has(account) && account !== launch.token)) fail("runtimeRead.address-set");
    readAddresses.add(account);
    const code = bytes(read.code, "runtimeRead.code");
    if (code === "0x") fail("runtimeRead.empty-code");
    const codeHash = keccak256(code);
    if (account === launch.token) tokenRuntimeCodeHash = codeHash;
    else equal(codeHash, expectedCode.get(account), "runtimeRead.codeHash");
  }
  if (tokenRuntimeCodeHash === null) fail("runtimeRead.token-missing");
  return Object.freeze({ schemaVersion: MODULE_MODE_PROVENANCE_SCHEMA, kind: "module-mode" as const,
    chainId: 4663 as const, sourceVersion: release.sourceVersion, sourceAddress: pins.launcher.address,
    sourceRuntimeCodeHash: pins.launcher.runtimeCodeHash, sourceReleaseDigest: release.releaseDigest,
    id: `4663:${launch.token}`, launchIdentity: `4663:${pins.launcher.address}:${launch.launchId}`,
    poolIdentity: `4663:${pins.poolManager.address}:${launch.poolId}`, poolManager: pins.poolManager.address,
    tokenFactory: pins.tokenFactory.address, tokenCreationCodeHash: release.tokenCreationCodeHash, tokenRuntimeCodeHash,
    ...launch, tokenIdentity: Object.freeze({ name, symbol, decimals: 18 as const, totalSupply: token.totalSupply as string, creatorSalt, graffiti }),
    metadataHash, creatorConfigurationHash, economicsHash, programHash, buyCreatorFeeBps, sellCreatorFeeBps,
    selections: Object.freeze(selections), families: Object.freeze(families), revisions: Object.freeze(revisions), instances: Object.freeze(instances),
    funding: Object.freeze(funding), blockNumber: block.blockNumber, blockHash: block.blockHash,
    transactionHash: tx, logIndex: emitted.logIndex, verification });
}
export type ModuleModeProvenance = ReturnType<typeof normalizeModuleModeLaunch>;

export function normalizeModuleModeLaunches(evidence: readonly unknown[], profile: unknown): readonly ModuleModeProvenance[] {
  bindActiveModuleModeRelease(profile);
  const seen = [new Set<string>(), new Set<string>(), new Set<string>(), new Set<string>()];
  return Object.freeze(list(evidence, "batch", 1000).map((input) => {
    const row = normalizeModuleModeLaunch(input, profile);
    const keys = [row.id, row.launchIdentity, row.poolIdentity, `${row.transactionHash}:${row.logIndex}`];
    keys.forEach((key, index) => { if (seen[index]!.has(key)) fail("batch.duplicate-identity"); seen[index]!.add(key); });
    return row;
  }));
}
