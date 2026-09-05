import {
  createPublicClient, decodeEventLog, decodeFunctionResult, encodeAbiParameters, encodeEventTopics, encodeFunctionData,
  erc20Abi, getCreate2Address, http, keccak256, parseAbiParameters, sha256, toHex,
  type Abi, type AbiParameter, type Address, type Hex, type PublicClient, type TransactionReceipt,
} from "viem";
import { robinhoodChain } from "@/lib/chains";
import { MAX_TOKEN_DESCRIPTION_BYTES, MAX_TOKEN_NAME_BYTES } from "@/lib/metadata-policy";
import { compileOpenConfig, type OpenConfigValue } from "@/packages/classic-modules/src/open-config.mjs";
import { evaluateOpenConstraints } from "@/packages/classic-modules/src/open-constraints.mjs";
import { NATIVE_ENGINE_PROFILE, validateTokenImage, type ModuleModeDraft } from "./builder";
import { MODULE_MODE_DEPENDENCIES, bindActiveModuleModeRelease, moduleAddress, moduleBytes, moduleHash, moduleRecord, moduleUint, type ModuleModeRelease } from "./release";
import { bindNativeCatalogEntry, moduleNativeCatalogDigest, nativeCanonicalJson, nativeJson, parseModuleModeAvailability, type ModuleModeAvailability, type NativeModuleModeCatalogEntry } from "./native-catalog";
import { MODULE_NATIVE_METADATA_TYPE, MODULE_NATIVE_SELECTION_TYPE, moduleNativeApprovalAbi, moduleNativeLaunchAbi, moduleNativePoolParameters, moduleNativeReadAbi, moduleNativeRouterAbi } from "./native-abi";
import type { ModuleManagementBuildInput } from "./management";

export type ModuleNativeClient = Pick<PublicClient, "getChainId" | "getBlock" | "getCode" | "readContract" | "call" | "estimateGas" | "getTransaction" | "waitForTransactionReceipt">;
export function createModuleNativeClient(): ModuleNativeClient {
  return createPublicClient({ chain: robinhoodChain, transport: http(undefined, { timeout: 15_000, retryCount: 1 }), batch: { multicall: false } });
}
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const SUPPLY = 1_000_000_000n * 10n ** 18n;
const MAX_AMOUNT = (1n << 127n) - 1n;
type NativeSelection = { packageId: Hex; factory: Address; factoryCodeHash: Hex; moduleCodeHash: Hex; callbackGas: number; config: Hex };
export interface ModuleNativeLaunchRecord {
  launchId: Hex; launchWallet: Address; token: Address; poolId: Hex; recipeHash: Hex; hook: Address;
  positionRecipient: Address; positionTokenId: bigint; initialBuyNative: bigint; initialBuyTokens: bigint; runtime: Address; launchKey: Hex;
}
export interface ModuleNativeWalletTransaction {
  chainId: 4663; from: Address; to: Address; data: Hex; value: Hex; gas?: Hex;
  action: "launch" | "buy" | "sell" | "approve" | "manage"; description: string;
}
interface PreparedBase {
  readonly transaction: Readonly<ModuleNativeWalletTransaction>;
  readonly account: Address; readonly releaseDigest: Hex; readonly blockNumber: bigint;
  readonly expiresAt: bigint; readonly gasEstimate: bigint;
}
export interface PreparedModuleNativeLaunch extends PreparedBase {
  readonly kind: "launch"; readonly draftId: Hex; readonly predictedToken: Address; readonly poolId: Hex;
  readonly recipeHash: Hex; readonly launchKey: Hex; readonly quotedTokenOut: bigint; readonly minimumTokenOut: bigint;
}
export interface PreparedModuleNativeSwap extends PreparedBase {
  readonly kind: "swap"; readonly token: Address; readonly poolId: Hex; readonly isBuy: boolean;
  readonly amountSpecified: bigint; readonly limit: bigint; readonly recipient: Address;
  readonly nativeAmount: bigint; readonly tokenAmount: bigint;
  readonly feeComponents: { creatorBps: number; platformBps: number; poolProtocolPips: number; poolLpPips: number };
}
export interface PreparedModuleNativeApproval extends PreparedBase { readonly kind: "approve"; readonly token: Address; readonly amount: bigint }
export interface PreparedModuleNativeManagement extends PreparedBase { readonly kind: "manage"; readonly token: Address }
export type PreparedModuleNativeTransaction = PreparedModuleNativeLaunch | PreparedModuleNativeSwap | PreparedModuleNativeApproval | PreparedModuleNativeManagement;
export interface ModuleNativeApprovalRequired { kind: "approval-required"; token: Address; spender: Address; amount: bigint; currentAllowance: bigint }
export interface ModuleNativeImageBinding { uri: string; sourceSha256?: Hex }
type BoundBlock = { release: ModuleModeRelease; blockNumber: bigint; blockHash: Hex; timestamp: bigint };
type PrivateBinding = {
  client: ModuleNativeClient; release: ModuleModeRelease; refresh: () => Promise<bigint>;
  receipt: (receipt: TransactionReceipt) => Promise<ModuleNativeReceiptResult>;
};
const preparations = new WeakMap<PreparedModuleNativeTransaction, PrivateBinding>();
const submitted = new WeakSet<PreparedModuleNativeTransaction>();
const pending = new WeakSet<PreparedModuleNativeTransaction>();
export interface ModuleNativeReceiptResult {
  status: "mined"; finalized: false; indexed: false; transactionHash: Hex; blockNumber: bigint; blockHash: Hex;
  kind: PreparedModuleNativeTransaction["kind"]; token?: Address; launch?: ModuleNativeLaunchRecord;
}
export class ModuleNativeTransactionRevertedError extends Error {
  readonly code = "MODULE_NATIVE_TRANSACTION_REVERTED";
  constructor(readonly transactionHash: Hex, readonly blockNumber: bigint, readonly blockHash: Hex) {
    super("The bound Module Mode transaction reverted onchain."); this.name = "ModuleNativeTransactionRevertedError";
  }
}
function requireCondition(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`Module Mode: ${message}`); }
function same(a: unknown, b: unknown, label: string) { requireCondition(typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase(), `${label} changed or does not match.`); }
function uint(value: unknown, label: string, positive = false): bigint { return BigInt(moduleUint(typeof value === "bigint" ? value.toString() : value, label, positive)); }
function frozen<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) { for (const item of Object.values(value)) frozen(item); Object.freeze(value); }
  return value;
}
async function read(client: ModuleNativeClient, address: Address, functionName: string, args: readonly unknown[], blockNumber: bigint, abi: Abi = moduleNativeReadAbi): Promise<unknown> {
  return client.readContract({ address, abi, functionName, args, blockNumber });
}
async function assertCanonical(client: ModuleNativeClient, block: BoundBlock) {
  same((await client.getBlock({ blockNumber: block.blockNumber })).hash, block.blockHash, "RPC block");
}
async function assertCode(client: ModuleNativeClient, address: Address, expected: Hex, blockNumber: bigint) {
  const code = await client.getCode({ address, blockNumber });
  requireCondition(code && code !== "0x", `No deployed code at ${address}.`);
  same(keccak256(code), expected, `Runtime code at ${address}`);
}

/** The caller must obtain release authorization from the authenticated availability endpoint. Pins alone are not approval. */
export async function assertModuleNativeRelease(input: { client: ModuleNativeClient; release: ModuleModeRelease; blockNumber?: bigint }): Promise<BoundBlock> {
  const { client } = input;
  const release = bindActiveModuleModeRelease(input.release);
  requireCondition(await client.getChainId() === 4663, "RPC is on a different chain.");
  const block = await client.getBlock(input.blockNumber === undefined ? { blockTag: "latest" } : { blockNumber: input.blockNumber });
  requireCondition(block.number !== null && block.hash !== null && block.number >= BigInt(release.startBlock), "Release block is unavailable.");
  if (input.blockNumber === undefined) requireCondition(Math.abs(Date.now() / 1000 - Number(block.timestamp)) <= 120, "RPC state is stale. Refresh before continuing.");
  await Promise.all(MODULE_MODE_DEPENDENCIES.map(role => assertCode(client, release.contracts[role].address, release.contracts[role].runtimeCodeHash, block.number!)));
  const pins = release.contracts;
  const bindings: [keyof typeof pins, string, keyof typeof pins][] = [
    ["launcher", "poolManager", "poolManager"], ["launcher", "positionManager", "positionManager"], ["launcher", "tokenFactory", "tokenFactory"],
    ["launcher", "feeHook", "hook"], ["launcher", "swapRouter", "swapRouter"], ["launcher", "swapRouterFactory", "swapRouterFactory"],
    ["launcher", "positionPlanner", "positionPlanner"], ["launcher", "launchPolicy", "launchPolicy"], ["launcher", "positionForwarderFactory", "positionForwarderFactory"],
    ["hook", "poolManager", "poolManager"], ["hook", "registry", "registry"], ["hook", "runtime", "runtime"], ["hook", "runtimeFactory", "runtimeFactory"], ["hook", "ledger", "rewardLedger"],
    ["runtime", "engine", "hook"], ["runtime", "vault", "budgetVault"], ["budgetVault", "runtime", "runtime"],
    ["swapRouter", "source", "launcher"], ["swapRouter", "hook", "hook"], ["swapRouter", "poolManager", "poolManager"],
    ["rewardLedger", "hook", "hook"], ["rewardLedger", "registry", "registry"], ["rewardLedger", "poolManager", "poolManager"],
    ["positionManager", "poolManager", "poolManager"], ["positionForwarderFactory", "positionManager", "positionManager"],
  ];
  await Promise.all(bindings.map(async ([role, fn, target]) => same(await read(client, pins[role].address, fn, [], block.number!), pins[target].address, `${role}.${fn}`)));
  const [minimum, engineHash, runtime, router] = await Promise.all([
    read(client, pins.launcher.address, "minInitialBuyNative", [], block.number),
    read(client, pins.runtime.address, "engineCodeHash", [], block.number),
    read(client, pins.runtimeFactory.address, "runtimeOf", [pins.hook.address], block.number),
    read(client, pins.swapRouterFactory.address, "routerOf", [pins.launcher.address], block.number),
  ]);
  requireCondition(uint(minimum, "minimum", true) === BigInt(release.minimumInitialBuyNative), "Minimum initial buy differs from the release.");
  same(engineHash, pins.hook.runtimeCodeHash, "Runtime engine code"); same(runtime, pins.runtime.address, "Factory runtime"); same(router, pins.swapRouter.address, "Factory router");
  const result = { release, blockNumber: block.number, blockHash: block.hash, timestamp: block.timestamp };
  await assertCanonical(client, result);
  return result;
}

function poolIdFor(token: Address, hook: Address): Hex { return keccak256(encodeAbiParameters(moduleNativePoolParameters, [ZERO, token, 0, 200, hook])); }
function launchRecord(value: unknown): ModuleNativeLaunchRecord {
  const r = value as Record<string, unknown>;
  requireCondition(r && typeof r === "object", "Launch record is unavailable.");
  return { launchId: moduleHash(r.launchId, "launchId"), launchWallet: moduleAddress(r.launchWallet, "launchWallet"), token: moduleAddress(r.token, "token"),
    poolId: moduleHash(r.poolId, "poolId"), recipeHash: moduleHash(r.recipeHash, "recipeHash"), hook: moduleAddress(r.hook, "hook"),
    positionRecipient: moduleAddress(r.positionRecipient, "positionRecipient"), positionTokenId: uint(r.positionTokenId, "positionTokenId", true),
    initialBuyNative: uint(r.initialBuyNative, "initialBuyNative", true), initialBuyTokens: uint(r.initialBuyTokens, "initialBuyTokens", true),
    runtime: moduleAddress(r.runtime, "runtime"), launchKey: moduleHash(r.launchKey, "launchKey") };
}
async function boundLaunch(client: ModuleNativeClient, block: BoundBlock, rawToken: Address): Promise<ModuleNativeLaunchRecord> {
  const { release, blockNumber } = block; const pins = release.contracts; const token = moduleAddress(rawToken, "token");
  const [raw, identity, creator, supply, decimals] = await Promise.all([
    read(client, pins.launcher.address, "getLaunch", [token], blockNumber, moduleNativeLaunchAbi),
    read(client, pins.launcher.address, "getLaunchIdentity", [token], blockNumber, moduleNativeLaunchAbi),
    read(client, token, "creator", [], blockNumber), read(client, token, "totalSupply", [], blockNumber), read(client, token, "decimals", [], blockNumber),
  ]);
  const result = launchRecord(raw); const id = identity as Record<string, unknown>;
  same(result.token, token, "Launch token"); same(result.hook, pins.hook.address, "Launch hook"); same(result.runtime, pins.runtime.address, "Launch runtime");
  same(result.poolId, poolIdFor(token, pins.hook.address), "Launch pool"); same(creator, pins.launcher.address, "Token creator");
  requireCondition(uint(supply, "supply") === SUPPLY && Number(decimals) === 18, "Token supply or decimals differ.");
  for (const field of ["launchId", "launchWallet", "token", "poolId", "hook", "recipeHash"] as const) same(id?.[field], result[field], `Launch identity ${field}`);
  same(id?.poolManager, pins.poolManager.address, "Identity PoolManager");
  const config = await read(client, pins.hook.address, "poolConfig", [result.poolId], blockNumber) as readonly unknown[];
  same(config[0], pins.launcher.address, "Pool registrar"); same(config[1], result.launchWallet, "Pool launch wallet"); same(config[2], pins.swapRouter.address, "Pool router");
  same(config[3], pins.swapRouter.runtimeCodeHash, "Pool router code"); same(config[6], result.recipeHash, "Pool recipe"); same(config[7], result.launchKey, "Pool launch key");
  return result;
}
export async function readModuleNativeLaunch(input: { client: ModuleNativeClient; release: ModuleModeRelease; token: Address; blockNumber?: bigint }): Promise<ModuleNativeLaunchRecord> {
  const block = await assertModuleNativeRelease(input);
  const result = await boundLaunch(input.client, block, input.token); await assertCanonical(input.client, block); return result;
}

async function assertRevisions(client: ModuleNativeClient, block: BoundBlock, entries: readonly NativeModuleModeCatalogEntry[]) {
  await Promise.all(entries.map(async entry => {
    const pin = entry.nativeBinding;
    const revision = await read(client, block.release.contracts.registry.address, "getRevision", [pin.packageId], block.blockNumber) as Record<string, unknown>;
    requireCondition(revision?.enabled === true, `${entry.title} is no longer available for a new launch.`);
    for (const field of ["familyId", "factory", "factoryCodeHash", "moduleCodeHash", "manifestHash"] as const) same(revision[field], pin[field], `${entry.title} ${field}`);
    requireCondition(Number(revision.callbackGas) === pin.callbackGas, "Module callback budget differs from the reviewed revision.");
    await assertCode(client, pin.factory, pin.factoryCodeHash, block.blockNumber);
  }));
}
function slippage(raw = 100) { requireCondition(Number.isSafeInteger(raw) && raw >= 0 && raw <= 1000, "Use slippage between 0 and 1,000 basis points."); return BigInt(raw); }
function expiry(timestamp: bigint, seconds = 300) { requireCondition(Number.isSafeInteger(seconds) && seconds >= 30 && seconds <= 900, "Deadline must be between 30 and 900 seconds."); return timestamp + BigInt(seconds); }
function checkedAmount(value: bigint, label: string) { requireCondition(typeof value === "bigint" && value > 0n && value <= MAX_AMOUNT, `Invalid ${label}.`); return value; }
function baseConstraints() { return { type: "record", required: ["buyCreatorFeeBps", "sellCreatorFeeBps"], fields: {
  buyCreatorFeeBps: { type: "uint", unit: "bps" }, sellCreatorFeeBps: { type: "uint", unit: "bps" },
} } as const; }
function configValue(config: ReturnType<typeof compileOpenConfig>, path: string[], address = false): unknown {
  let value: unknown = config.value;
  for (const key of path) value = (value as Record<string, unknown>)?.[key];
  if (!address || typeof value === "string") return value;
  if (value && typeof value === "object" && "address" in value) return value.address;
  const pointer = path.map(key => `/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
  const binding = config.bindings.find(item => item.path === pointer);
  requireCondition(binding, "A configured role has no current wallet binding.");
  return binding.kind === "asset" ? binding.resolved.address : binding.resolved;
}
function validateDraft(raw: ModuleModeDraft, availability: ModuleModeAvailability, account: Address, image: ModuleNativeImageBinding, timestamp: bigint) {
  const draft = nativeJson(raw) as ModuleModeDraft;
  const root = moduleRecord(draft, ["format", "status", "launchable", "onchainApproved", "walletAuthorizationVerified", "chainId", "quoteAsset", "engine", "token", "initialBuyWei", "totalProgramFundingWei", "totalNativeValueWei", "fees", "modules", "draftId"], "draft");
  const { draftId, ...body } = root;
  same(sha256(toHex(nativeCanonicalJson(body))), draftId, "Draft digest");
  moduleRecord(draft.engine, ["id", "version", "label"], "draft.engine");
  moduleRecord(draft.token, ["name", "symbol", "description", "image"], "draft.token");
  moduleRecord(draft.fees, ["creatorBuyBps", "creatorSellBps", "programmableBps", "asset"], "draft.fees");
  requireCondition(draft.format === "programmable.module-mode.draft.v0.1" && draft.status === "preview" && draft.launchable === false && draft.onchainApproved === false && draft.walletAuthorizationVerified === false && draft.chainId === 4663 && draft.quoteAsset === "native-ETH" && draft.engine.id === NATIVE_ENGINE_PROFILE.id && draft.engine.version === 1, "Unsupported draft or engine.");
  requireCondition(typeof draft.token.name === "string" && draft.token.name.trim() === draft.token.name && draft.token.name.length > 0 && new TextEncoder().encode(draft.token.name).length <= MAX_TOKEN_NAME_BYTES
    && /^[a-zA-Z0-9]{1,12}$/.test(draft.token.symbol) && typeof draft.token.description === "string" && new TextEncoder().encode(draft.token.description).length <= MAX_TOKEN_DESCRIPTION_BYTES, "Invalid token metadata.");
  requireCondition(validateTokenImage(draft.token.image) === null && validateTokenImage({ kind: "uri", uri: image.uri, contentVerified: false }) === null, "Invalid token image binding.");
  if (draft.token.image.kind === "uri") {
    moduleRecord(draft.token.image, ["kind", "uri", "contentVerified"], "draft.image");
    requireCondition(draft.token.image.contentVerified === false && image.uri === draft.token.image.uri, "Reviewed image URI or verification state changed.");
  } else {
    moduleRecord(draft.token.image, ["kind", "sha256", "mimeType", "bytes"], "draft.image");
    same(image.sourceSha256, draft.token.image.sha256, "Uploaded image source digest");
  }
  for (const fee of [draft.fees.creatorBuyBps, draft.fees.creatorSellBps]) requireCondition(Number.isSafeInteger(fee) && fee >= 0 && fee <= 1000 && fee % 100 === 0, "Creator fees must be 0–10% in whole percentages.");
  requireCondition(draft.fees.programmableBps === 20 && draft.fees.asset === "native-ETH", "The additional protocol fee must be 20 bps in ETH.");
  const initialBuy = checkedAmount(uint(draft.initialBuyWei, "initialBuy", true), "initial buy");
  requireCondition(initialBuy >= BigInt(availability.release!.minimumInitialBuyNative), "Initial buy is below the released minimum.");
  requireCondition(Array.isArray(draft.modules) && draft.modules.length <= 8 && new Set(draft.modules.map(item => item.id)).size === draft.modules.length, "Invalid module count or duplicate selection.");
  const paired = draft.modules.map(selected => {
    moduleRecord(selected, ["id", "version", "catalogDigest", "source", "configuration", "configurationBytes", "programConfigurationBytes", "fundingWei", "bindings"], "draft.module");
    const entry = bindNativeCatalogEntry(availability.catalog.find(candidate => candidate.id === selected.id));
    same(selected.catalogDigest, moduleNativeCatalogDigest(entry), "Module catalog digest");
    requireCondition(selected.version === entry.version && nativeCanonicalJson(selected.source) === nativeCanonicalJson(entry.source), "Reviewed module source differs.");
    const compiled = compileOpenConfig(entry.schema, selected.configuration, { roles: { creator: account, launchWallet: account } });
    requireCondition(nativeCanonicalJson(compiled.value) === nativeCanonicalJson(selected.configuration) && nativeCanonicalJson(compiled.bindings) === nativeCanonicalJson(selected.bindings), "Module configuration or account bindings changed.");
    same(compiled.encoded, selected.configurationBytes, "Schema configuration bytes");
    const values = entry.programAbi?.map(arg => { const value = configValue(compiled, arg.path, arg.type === "address"); return /^uint(?:\d+)?$/.test(arg.type) ? BigInt(String(value)) : value; });
    const config = entry.programAbi ? encodeAbiParameters(entry.programAbi.map(arg => ({ type: arg.type } as AbiParameter)), values!) : compiled.encoded;
    same(config, selected.programConfigurationBytes, "Native program configuration");
    requireCondition((config.length - 2) / 2 <= 16_384, "Module configuration is too large.");
    const constraints = evaluateOpenConstraints(entry.constraints ?? [], { $self: { schema: entry.schema, value: compiled.value }, base: { schema: baseConstraints(), value: { buyCreatorFeeBps: String(draft.fees.creatorBuyBps), sellCreatorFeeBps: String(draft.fees.creatorSellBps) } } });
    requireCondition(constraints.ok, "Module configuration violates its reviewed constraints.");
    const record = compiled.value as Record<string, OpenConfigValue>;
    for (const field of entry.futureTimestampFields ?? []) requireCondition(BigInt(String(record[field])) > timestamp, "A module end time has already expired.");
    for (const field of entry.nonzeroAccountFields ?? []) moduleAddress(configValue(compiled, [field], true), `configuration.${field}`);
    if (entry.initialBuyLimitField && (!entry.initialBuyLimitEnabledField || record[entry.initialBuyLimitEnabledField] === true)) {
      const limit = BigInt(String(record[entry.initialBuyLimitField])); requireCondition(limit === 0n || initialBuy <= limit, "Initial buy exceeds a module limit.");
    }
    const funding = uint(selected.fundingWei, "moduleFunding"); requireCondition(entry.funding || funding === 0n, "This module does not declare launch funding.");
    return { entry, funding, selection: { packageId: entry.nativeBinding.packageId, factory: entry.nativeBinding.factory, factoryCodeHash: entry.nativeBinding.factoryCodeHash, moduleCodeHash: entry.nativeBinding.moduleCodeHash, callbackGas: entry.nativeBinding.callbackGas, config } satisfies NativeSelection };
  }).sort((a, b) => BigInt(a.entry.nativeBinding.familyId) < BigInt(b.entry.nativeBinding.familyId) ? -1 : 1);
  requireCondition(new Set(paired.map(item => item.entry.nativeBinding.familyId.toLowerCase())).size === paired.length, "A functional family may appear only once.");
  requireCondition(paired.reduce((sum, item) => sum + item.selection.callbackGas, 0) <= 2_000_000 && paired.reduce((sum, item) => sum + (item.selection.config.length - 2) / 2, 0) <= 32_768, "Combined module resource limit exceeded.");
  const funding = paired.map(item => item.funding); const totalFunding = funding.reduce((sum, amount) => sum + amount, 0n);
  requireCondition(totalFunding === uint(draft.totalProgramFundingWei, "totalFunding") && initialBuy + totalFunding === uint(draft.totalNativeValueWei, "totalValue"), "Launch value does not match initial buy plus module budgets.");
  return { draft, entries: paired.map(item => item.entry), selections: paired.map(item => item.selection), families: paired.map(item => item.entry.nativeBinding.familyId), funding, initialBuy, totalFunding, value: initialBuy + totalFunding };
}

function active(value: ModuleModeAvailability): ModuleModeAvailability & { release: ModuleModeRelease } {
  const availability = parseModuleModeAvailability(value);
  requireCondition(availability.release, availability.reason ?? "Module Mode launch is not available.");
  return availability as ModuleModeAvailability & { release: ModuleModeRelease };
}
function transaction(account: Address, to: Address, data: Hex, value: bigint, action: ModuleNativeWalletTransaction["action"], description: string): ModuleNativeWalletTransaction {
  return { chainId: 4663, from: account, to, data, value: toHex(value), action, description };
}
function gasReserve(estimate: bigint): bigint { return (uint(estimate, "gasEstimate", true) * 120n + 99n) / 100n; }
async function simulate(client: ModuleNativeClient, tx: ModuleNativeWalletTransaction, blockNumber: bigint) {
  const request = { account: tx.from, to: tx.to, data: tx.data, value: BigInt(tx.value), blockNumber };
  const [call, gas] = await Promise.all([client.call(request), client.estimateGas(request)]);
  requireCondition(call.data && call.data !== "0x", "Simulation returned no result.");
  return { data: call.data, gasEstimate: gasReserve(gas) };
}
function seal<T extends PreparedModuleNativeTransaction>(prepared: T, binding: PrivateBinding): T {
  frozen(prepared); preparations.set(prepared, binding); return prepared;
}
function encodeLaunch(parameters: Parameters<typeof encodeFunctionData<typeof moduleNativeLaunchAbi, "launch">>[0]["args"]) {
  return encodeFunctionData({ abi: moduleNativeLaunchAbi, functionName: "launch", args: parameters });
}
export interface PrepareModuleNativeLaunchInput {
  client: ModuleNativeClient; availability: ModuleModeAvailability; draft: ModuleModeDraft; account: Address;
  image: ModuleNativeImageBinding; creatorSalt: Hex; slippageBps?: number; deadlineSeconds?: number;
  creators?: readonly { wallet: Address; shareBps: number }[];
}
export async function prepareModuleNativeLaunch(input: PrepareModuleNativeLaunchInput): Promise<PreparedModuleNativeLaunch> {
  const { client } = input; const account = moduleAddress(input.account, "account"); const availability = frozen(active(input.availability));
  const image = frozen({ ...input.image }); const creatorSalt = moduleHash(input.creatorSalt, "creatorSalt");
  const block = await assertModuleNativeRelease({ client, release: availability.release });
  const checked = validateDraft(input.draft, availability, account, image, block.timestamp); frozen(checked.draft);
  const deadline = expiry(block.timestamp, input.deadlineSeconds); const slip = slippage(input.slippageBps);
  const creators = input.creators?.map(item => ({ wallet: moduleAddress(item.wallet, "creator.wallet"), shareBps: item.shareBps })) ?? [{ wallet: account, shareBps: 10_000 }];
  requireCondition(creators.length > 0 && creators.length <= 10 && creators.every(item => Number.isSafeInteger(item.shareBps) && item.shareBps > 0 && item.shareBps <= 10_000) && creators.reduce((sum, item) => sum + item.shareBps, 0) === 10_000, "Creator shares must total 10,000 bps across 1–10 recipients.");
  await assertRevisions(client, block, checked.entries);
  const pins = block.release.contracts;
  const graffiti = keccak256(encodeAbiParameters(parseAbiParameters("string,uint256,address,address,bytes32"), ["programmable.module-mode.native-token.v1", 4663n, pins.launcher.address, account, creatorSalt]));
  const salt = keccak256(encodeAbiParameters(parseAbiParameters("string,string,uint8,address,bytes32"), [checked.draft.token.name, checked.draft.token.symbol, 18, pins.launcher.address, graffiti]));
  const predictedToken = getCreate2Address({ from: pins.tokenFactory.address, salt, bytecodeHash: block.release.tokenCreationCodeHash });
  const prediction = await read(client, pins.launcher.address, "predictTokenAddress", [checked.draft.token.name, checked.draft.token.symbol, account, creatorSalt], block.blockNumber, moduleNativeLaunchAbi) as readonly unknown[];
  same(prediction[0], predictedToken, "Token prediction"); same(prediction[1], graffiti, "Token graffiti");
  const existingCode = await client.getCode({ address: predictedToken, blockNumber: block.blockNumber });
  requireCondition(!existingCode || existingCode === "0x", "This launch token already exists. Prepare a new launch salt.");
  const poolId = poolIdFor(predictedToken, pins.hook.address);
  const recipeHash = keccak256(encodeAbiParameters(parseAbiParameters(`string,uint256,address,address,uint16,uint16,bytes32[],${MODULE_NATIVE_SELECTION_TYPE}`), ["programmable.module-mode.native-recipe.v1", 4663n, pins.hook.address, pins.registry.address, checked.draft.fees.creatorBuyBps, checked.draft.fees.creatorSellBps, checked.families, checked.selections]));
  const programHash = keccak256(encodeAbiParameters(parseAbiParameters(`bytes32,${MODULE_NATIVE_SELECTION_TYPE}`), [keccak256(toHex("programmable.module-mode.native-program.v1")), checked.selections]));
  const launchKey = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,address,(address source,address launchWallet,address token,address poolManager,bytes32 poolId,bytes32 recipeHash,bytes32 programHash)"),
    [keccak256(toHex("programmable.module-mode.native-binding.v1")), 4663n, pins.runtime.address, pins.hook.address, { source: pins.launcher.address, launchWallet: account, token: predictedToken, poolManager: pins.poolManager.address, poolId, recipeHash, programHash }]));
  const metadata = { description: checked.draft.token.description, website: "", image: image.uri, extraData: "0x" as Hex };
  const parameters = { name: checked.draft.token.name, symbol: checked.draft.token.symbol, buyCreatorFeeBps: checked.draft.fees.creatorBuyBps, sellCreatorFeeBps: checked.draft.fees.creatorSellBps, creatorSalt, metadata,
    creatorWallets: creators.map(item => item.wallet), creatorSharesBps: creators.map(item => item.shareBps), modules: checked.selections, moduleFunding: checked.funding, initialBuyNative: checked.initialBuy, minimumInitialTokenOut: 1n, deadline };
  const previewTx = transaction(account, pins.launcher.address, encodeLaunch([parameters]), checked.value, "launch", `Launch ${parameters.name} on Robinhood Chain`);
  const quote = await client.call({ account, to: previewTx.to, data: previewTx.data, value: checked.value, blockNumber: block.blockNumber });
  requireCondition(quote.data, "Launch simulation returned no result.");
  const quoted = launchRecord(decodeFunctionResult({ abi: moduleNativeLaunchAbi, functionName: "launch", data: quote.data }));
  for (const [actual, expected, label] of [[quoted.token, predictedToken, "token"], [quoted.launchWallet, account, "wallet"], [quoted.poolId, poolId, "pool"], [quoted.recipeHash, recipeHash, "recipe"], [quoted.launchKey, launchKey, "program"], [quoted.hook, pins.hook.address, "hook"], [quoted.runtime, pins.runtime.address, "runtime"]]) same(actual, expected, `Simulated ${label}`);
  requireCondition(quoted.initialBuyNative === checked.initialBuy, "Simulated initial buy differs.");
  parameters.minimumInitialTokenOut = quoted.initialBuyTokens * (10_000n - slip) / 10_000n;
  requireCondition(parameters.minimumInitialTokenOut > 0n, "Quoted output is too small for the selected slippage.");
  const tx = { ...previewTx, data: encodeLaunch([parameters]) }; const simulation = await simulate(client, tx, block.blockNumber);
  const confirmed = launchRecord(decodeFunctionResult({ abi: moduleNativeLaunchAbi, functionName: "launch", data: simulation.data }));
  requireCondition(confirmed.initialBuyTokens >= parameters.minimumInitialTokenOut, "Launch does not meet the reviewed minimum output.");
  await assertCanonical(client, block);
  const prepared: PreparedModuleNativeLaunch = { kind: "launch", transaction: tx, account, releaseDigest: block.release.releaseDigest, blockNumber: block.blockNumber, expiresAt: deadline, gasEstimate: simulation.gasEstimate,
    draftId: checked.draft.draftId, predictedToken, poolId, recipeHash, launchKey, quotedTokenOut: quoted.initialBuyTokens, minimumTokenOut: parameters.minimumInitialTokenOut };
  const metadataHash = keccak256(encodeAbiParameters(parseAbiParameters(`string,string,${MODULE_NATIVE_METADATA_TYPE}`), [parameters.name, parameters.symbol, metadata]));
  return seal(prepared, { client, release: block.release,
    refresh: async () => {
      const current = await assertModuleNativeRelease({ client, release: block.release }); requireCondition(current.timestamp <= deadline, "Launch review expired. Prepare again.");
      validateDraft(checked.draft, availability, account, image, current.timestamp); await assertRevisions(client, current, checked.entries);
      const next = await simulate(client, tx, current.blockNumber);
      const result = launchRecord(decodeFunctionResult({ abi: moduleNativeLaunchAbi, functionName: "launch", data: next.data }));
      same(result.token, predictedToken, "Current launch token"); same(result.recipeHash, recipeHash, "Current launch recipe"); same(result.launchKey, launchKey, "Current launch key");
      requireCondition(result.initialBuyTokens >= prepared.minimumTokenOut, "Current launch output is below the reviewed minimum."); await assertCanonical(client, current);
      return next.gasEstimate;
    },
    receipt: async receipt => {
      const current = await assertModuleNativeRelease({ client, release: block.release, blockNumber: receipt.blockNumber });
      const record = await boundLaunch(client, current, predictedToken);
      const event = oneEvent(receipt, pins.launcher.address, moduleNativeLaunchAbi, "ModuleNativeLaunched");
      for (const field of ["launchId", "launchWallet", "token", "poolId", "recipeHash", "hook", "positionRecipient"] as const) same(event[field], record[field], `Receipt ${field}`);
      for (const field of ["positionTokenId", "initialBuyNative", "initialBuyTokens"] as const) requireCondition(event[field] === record[field], `Receipt ${field} mismatch.`);
      same(record.launchWallet, account, "Receipt launch wallet"); same(record.recipeHash, recipeHash, "Receipt recipe"); same(record.launchKey, launchKey, "Receipt launch key");
      requireCondition(record.initialBuyNative === checked.initialBuy && record.initialBuyTokens >= prepared.minimumTokenOut, "Receipt initial buy differs from the reviewed request.");
      const program = oneEvent(receipt, pins.launcher.address, moduleNativeLaunchAbi, "ModuleNativeProgramBound");
      same(program.launchId, record.launchId, "Program launch"); same(program.launchKey, launchKey, "Program key"); same(program.runtime, pins.runtime.address, "Program runtime");
      same(program.fundingHash, keccak256(encodeAbiParameters([{ type: "uint256[]" }], [checked.funding])), "Program funding"); requireCondition(program.totalFunding === checked.totalFunding, "Program funding total mismatch.");
      const config = oneEvent(receipt, pins.launcher.address, moduleNativeLaunchAbi, "ModuleNativeConfigurationBound");
      same(config.launchId, record.launchId, "Configuration launch"); same(config.metadataHash, metadataHash, "Image and metadata commitment");
      same(config.creatorConfigurationHash, keccak256(encodeAbiParameters(parseAbiParameters("address[],uint16[]"), [parameters.creatorWallets, parameters.creatorSharesBps])), "Creator configuration");
      const identity = oneEvent(receipt, pins.launcher.address, moduleNativeLaunchAbi, "ModuleNativeTokenIdentityBound");
      same(identity.launchId, record.launchId, "Token identity launch"); same(identity.creatorSalt, creatorSalt, "Creator salt"); same(identity.graffiti, graffiti, "Token graffiti");
      await assertCanonical(client, current); return receiptResult(receipt, "launch", { token: record.token, launch: record });
    },
  });
}

export interface PrepareModuleNativeSwapInput { client: ModuleNativeClient; availability: ModuleModeAvailability; account: Address; token: Address; isBuy: boolean; amountSpecified: bigint; limit?: bigint; recipient: Address; slippageBps?: number; deadlineSeconds?: number }
export async function prepareModuleNativeSwap(input: PrepareModuleNativeSwapInput): Promise<PreparedModuleNativeSwap | ModuleNativeApprovalRequired> {
  input = Object.freeze({ ...input });
  const { client } = input; const availability = active(input.availability); const account = moduleAddress(input.account, "account"); const token = moduleAddress(input.token, "token");
  const recipient = moduleAddress(input.recipient, "recipient"); const block = await assertModuleNativeRelease({ client, release: availability.release });
  const record = await boundLaunch(client, block, token); const router = block.release.contracts.swapRouter.address;
  requireCondition(typeof input.isBuy === "boolean", "Invalid trade side.");
  requireCondition(recipient !== router && recipient !== block.release.contracts.poolManager.address, "Invalid swap recipient.");
  const specified = checkedAmount(input.amountSpecified < 0n ? -input.amountSpecified : input.amountSpecified, "swap amount");
  const exactInput = input.amountSpecified < 0n; const slip = slippage(input.slippageBps); const deadline = expiry(block.timestamp, input.deadlineSeconds);
  let limit = exactInput ? (input.limit === undefined ? 1n : checkedAmount(input.limit, "minimum output")) : checkedAmount(input.limit!, "maximum input");
  const funding = input.isBuy ? (exactInput ? specified : limit) : 0n;
  if (!input.isBuy) {
    const required = exactInput ? specified : limit;
    const allowance = uint(await read(client, token, "allowance", [account, router], block.blockNumber), "allowance");
    if (allowance < required) return { kind: "approval-required", token, spender: router, amount: required, currentAllowance: allowance };
  }
  const encode = (bound: bigint) => encodeFunctionData({ abi: moduleNativeRouterAbi, functionName: "swap", args: [token, input.isBuy, input.amountSpecified, bound, recipient, deadline] });
  const previewTx = transaction(account, router, encode(limit), funding, input.isBuy ? "buy" : "sell", `${input.isBuy ? "Buy" : "Sell"} a Module Mode token on Robinhood Chain`);
  const quote = await client.call({ account, to: router, data: previewTx.data, value: funding, blockNumber: block.blockNumber });
  requireCondition(quote.data, "Swap simulation returned no result.");
  const [nativeAmount, tokenAmount] = decodeFunctionResult({ abi: moduleNativeRouterAbi, functionName: "swap", data: quote.data });
  const output = input.isBuy ? tokenAmount : nativeAmount;
  if (exactInput && input.limit === undefined) limit = output * (10_000n - slip) / 10_000n;
  requireCondition(limit > 0n, "Quoted output is too small for the selected slippage.");
  const tx = { ...previewTx, data: encode(limit) }; const simulation = await simulate(client, tx, block.blockNumber);
  const [checkedNative, checkedTokens] = decodeFunctionResult({ abi: moduleNativeRouterAbi, functionName: "swap", data: simulation.data });
  const verify = (native: bigint, tokens: bigint) => {
    const paid = input.isBuy ? native : tokens; const received = input.isBuy ? tokens : native;
    requireCondition(native > 0n && tokens > 0n && (exactInput ? paid === specified && received >= limit : received === specified && paid <= limit), "Simulated swap violates the reviewed amounts.");
  };
  verify(checkedNative, checkedTokens);
  const fees = await read(client, block.release.contracts.hook.address, "feeComponents", [record.poolId, input.isBuy], block.blockNumber) as readonly number[];
  requireCondition(fees[1] === 20 && fees[0] >= 0 && fees[0] <= 1000 && fees[3] === 0, "Pool fee policy mismatch.");
  const prepared: PreparedModuleNativeSwap = { kind: "swap", transaction: tx, account, releaseDigest: block.release.releaseDigest, blockNumber: block.blockNumber, expiresAt: deadline, gasEstimate: simulation.gasEstimate,
    token, poolId: record.poolId, isBuy: input.isBuy, amountSpecified: input.amountSpecified, limit, recipient, nativeAmount, tokenAmount,
    feeComponents: { creatorBps: fees[0], platformBps: fees[1], poolProtocolPips: fees[2], poolLpPips: fees[3] } };
  await assertCanonical(client, block);
  return seal(prepared, { client, release: block.release, refresh: async () => {
    const current = await assertModuleNativeRelease({ client, release: block.release }); requireCondition(current.timestamp <= deadline, "Swap review expired. Prepare again.");
    await boundLaunch(client, current, token); const result = await simulate(client, tx, current.blockNumber);
    const [native, tokens] = decodeFunctionResult({ abi: moduleNativeRouterAbi, functionName: "swap", data: result.data }); verify(native, tokens); await assertCanonical(client, current);
    return result.gasEstimate;
  }, receipt: async receipt => {
    const event = oneEvent(receipt, router, moduleNativeRouterAbi, "NativeTradeCompleted");
    same(event.poolId, record.poolId, "Swap pool"); same(event.actor, account, "Swap actor"); same(event.recipient, recipient, "Swap recipient");
    requireCondition(event.isBuy === input.isBuy && event.amountSpecified === input.amountSpecified, "Receipt swap direction or exact amount mismatch.");
    verify(uint(event.nativeAmount, "swap.native"), uint(event.tokenAmount, "swap.token")); return receiptResult(receipt, "swap", { token });
  } });
}

export async function prepareModuleNativeApproval(input: { client: ModuleNativeClient; availability: ModuleModeAvailability; account: Address; token: Address; amount: bigint; deadlineSeconds?: number }): Promise<PreparedModuleNativeApproval> {
  const { client } = input; const availability = active(input.availability); const account = moduleAddress(input.account, "account"); const token = moduleAddress(input.token, "token");
  const amount = checkedAmount(input.amount, "approval amount"); requireCondition(amount <= SUPPLY, "Approval cannot exceed the fixed token supply.");
  const block = await assertModuleNativeRelease({ client, release: availability.release }); await boundLaunch(client, block, token);
  const deadline = expiry(block.timestamp, input.deadlineSeconds); const router = block.release.contracts.swapRouter.address;
  const tx = transaction(account, token, encodeFunctionData({ abi: moduleNativeApprovalAbi, functionName: "approve", args: [router, amount] }), 0n, "approve", "Approve this token amount for the Module Mode router");
  const result = await simulate(client, tx, block.blockNumber);
  requireCondition(decodeFunctionResult({ abi: moduleNativeApprovalAbi, functionName: "approve", data: result.data }) === true, "Token approval simulation failed.");
  const prepared: PreparedModuleNativeApproval = { kind: "approve", transaction: tx, account, releaseDigest: block.release.releaseDigest, blockNumber: block.blockNumber, expiresAt: deadline, gasEstimate: result.gasEstimate, token, amount };
  await assertCanonical(client, block);
  return seal(prepared, { client, release: block.release, refresh: async () => {
    const current = await assertModuleNativeRelease({ client, release: block.release }); requireCondition(current.timestamp <= deadline, "Approval review expired. Prepare again.");
    await boundLaunch(client, current, token); const next = await simulate(client, tx, current.blockNumber);
    requireCondition(decodeFunctionResult({ abi: moduleNativeApprovalAbi, functionName: "approve", data: next.data }) === true, "Current approval simulation failed."); await assertCanonical(client, current);
    return next.gasEstimate;
  }, receipt: async receipt => {
    const event = oneEvent(receipt, token, erc20Abi, "Approval"); same(event.owner, account, "Approval owner"); same(event.spender, router, "Approval spender");
    requireCondition(event.value === amount, "Approval amount mismatch.");
    const allowance = uint(await read(client, token, "allowance", [account, router], receipt.blockNumber), "allowance");
    requireCondition(allowance >= amount, "Approval is not available at the receipt block. Prepare the trade again."); return receiptResult(receipt, "approve", { token });
  } });
}

/** Reconstruct an allowed management intent; callers cannot supply transaction bytes to the branding boundary. */
export async function prepareModuleNativeManagementTransaction(input: ModuleManagementBuildInput): Promise<PreparedModuleNativeManagement> {
  const { client } = input;
  const release = frozen(bindActiveModuleModeRelease(input.release));
  const account = moduleAddress(input.actor, "management.actor"); const token = moduleAddress(input.token, "management.token");
  requireCondition(typeof input.deadline === "bigint" && input.deadline > 0n, "Invalid management deadline.");
  const catalog = frozen(nativeJson(input.catalog)) as ModuleManagementBuildInput["catalog"];
  requireCondition(Array.isArray(catalog) && catalog.length <= 1000, "Invalid management catalog.");
  const intent = frozen(nativeJson(input.intent)) as ModuleManagementBuildInput["intent"];
  const context: ModuleManagementBuildInput = Object.freeze({ client, release, catalog, token, actor: account, intent, deadline: input.deadline });
  // Dynamic import avoids a runtime cycle: management reads use this module's authenticated release and launch helpers.
  const { buildModuleManagementTransaction } = await import("./management");
  const reconstruct = async () => {
    const candidate = await buildModuleManagementTransaction(context);
    const target = intent.kind === "program" ? release.contracts.runtime.address
      : intent.kind === "fund" || intent.kind === "claim" ? release.contracts.budgetVault.address : release.contracts.rewardLedger.address;
    requireCondition(candidate.transaction.chainId === 4663 && candidate.expiresAt === context.deadline, "Management chain or deadline changed.");
    same(candidate.transaction.from, account, "Management actor"); same(candidate.transaction.to, target, "Management target");
    const value = uint(BigInt(candidate.transaction.value), "management.value");
    requireCondition(value === (intent.kind === "fund" ? uint(intent.amountWei, "management.funding", true) : 0n), "Management value changed.");
    const data = moduleBytes(candidate.transaction.data, "management.calldata", 65_536);
    requireCondition(data.length >= 10 && typeof candidate.description === "string" && candidate.description.length > 0 && candidate.description.length <= 65_536, "Invalid management transaction description or calldata.");
    requireCondition(typeof candidate.blockNumber === "bigint" && candidate.blockNumber >= BigInt(release.startBlock), "Management snapshot block is unavailable.");
    const hash = moduleHash(candidate.blockHash, "management.blockHash");
    const canonical = await client.getBlock({ blockNumber: candidate.blockNumber });
    requireCondition(canonical.number === candidate.blockNumber, "Management snapshot block number changed."); same(canonical.hash, hash, "Management snapshot block");
    requireCondition(canonical.timestamp < context.deadline && Math.abs(Date.now() / 1000 - Number(canonical.timestamp)) <= 120, "Management review expired or RPC state is stale. Prepare again.");
    return { transaction: transaction(account, target, data, value, "manage", candidate.description), blockNumber: candidate.blockNumber, gasEstimate: gasReserve(candidate.gasEstimate) };
  };
  const candidate = await reconstruct();
  const prepared: PreparedModuleNativeManagement = { kind: "manage", token, transaction: candidate.transaction, account, releaseDigest: release.releaseDigest,
    blockNumber: candidate.blockNumber, expiresAt: context.deadline, gasEstimate: candidate.gasEstimate };
  return seal(prepared, { client, release,
    refresh: async () => {
      const current = await reconstruct();
      for (const field of ["from", "to", "data", "value"] as const) same(current.transaction[field], prepared.transaction[field], `Reviewed management ${field}`);
      requireCondition(current.transaction.description === prepared.transaction.description, "Management effects changed. Prepare again.");
      return current.gasEstimate;
    },
    receipt: async receipt => {
      const block = await assertModuleNativeRelease({ client, release, blockNumber: receipt.blockNumber });
      await boundLaunch(client, block, token); await assertCanonical(client, block);
      return receiptResult(receipt, "manage", { token });
    },
  });
}

/** Only in-memory preparations made by this module can cross the wallet boundary. A signing attempt consumes the review. */
export async function revalidateModuleNativeTransaction(prepared: PreparedModuleNativeTransaction, expectedAccount: Address): Promise<ModuleNativeWalletTransaction> {
  const binding = preparations.get(prepared);
  requireCondition(binding && Object.isFrozen(prepared) && Object.isFrozen(prepared.transaction), "Unknown or replaced transaction preparation.");
  same(moduleAddress(expectedAccount, "expectedAccount"), prepared.account, "Connected account");
  requireCondition(!pending.has(prepared) && !submitted.has(prepared), "This review has already been used. Prepare again before signing.");
  pending.add(prepared);
  try {
    const currentGasEstimate = await binding.refresh();
    requireCondition(currentGasEstimate <= prepared.gasEstimate, "The gas estimate increased. Prepare again before signing.");
    requireCondition(await binding.client.getChainId() === 4663, "RPC chain changed during preparation.");
    submitted.add(prepared);
    return { ...prepared.transaction, gas: toHex(currentGasEstimate) };
  } finally { pending.delete(prepared); }
}
function oneEvent(receipt: TransactionReceipt, address: Address, abi: Abi, eventName: string): Record<string, unknown> {
  const events: Record<string, unknown>[] = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== address.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({ abi, topics: log.topics, data: log.data, strict: true });
      if (decoded.eventName !== eventName) continue;
      requireCondition(!log.removed && log.transactionHash === receipt.transactionHash && log.blockHash === receipt.blockHash && log.blockNumber === receipt.blockNumber, "Receipt event block or transaction mismatch.");
      requireCondition(decoded.args && !Array.isArray(decoded.args), "Malformed named receipt event.");
      const args = decoded.args as unknown as Record<string, unknown>;
      const eventAbi = abi.find(item => item.type === "event" && item.name === eventName);
      requireCondition(eventAbi?.type === "event", "Receipt event ABI mismatch.");
      const topics = encodeEventTopics({ abi, eventName, args } as never);
      requireCondition(topics.length === log.topics.length && topics.every((topic, i) => topic === log.topics[i]), "Noncanonical receipt event topics.");
      const fields = eventAbi.inputs.filter(field => !field.indexed);
      same(encodeAbiParameters(fields, fields.map(field => args[field.name!])), log.data, "Canonical receipt event data");
      events.push(args);
    } catch (error) { if (error instanceof Error && error.message.startsWith("Module Mode:")) throw error; }
  }
  requireCondition(events.length === 1, `Expected exactly one ${eventName} event from the bound contract.`); return events[0];
}
function receiptResult(receipt: TransactionReceipt, kind: PreparedModuleNativeTransaction["kind"], rest: { token?: Address; launch?: ModuleNativeLaunchRecord } = {}): ModuleNativeReceiptResult {
  return { status: "mined", finalized: false, indexed: false, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, kind, ...rest };
}
export async function waitForModuleNativeReceipt(input: { client: ModuleNativeClient; prepared: PreparedModuleNativeTransaction; transactionHash: Hex }): Promise<ModuleNativeReceiptResult> {
  const binding = preparations.get(input.prepared); requireCondition(binding && binding.client === input.client, "Receipt client or preparation mismatch.");
  const transactionHash = moduleHash(input.transactionHash, "transactionHash");
  requireCondition(await input.client.getChainId() === 4663, "Receipt RPC chain mismatch.");
  const receipt = await input.client.waitForTransactionReceipt({ hash: transactionHash, confirmations: 1, timeout: 60_000, retryCount: 1 });
  same(receipt.transactionHash, transactionHash, "Receipt transaction");
  const [tx, block] = await Promise.all([input.client.getTransaction({ hash: transactionHash }), input.client.getBlock({ blockNumber: receipt.blockNumber })]);
  same(tx.hash, transactionHash, "Transaction hash"); same(tx.from, input.prepared.account, "Transaction sender"); same(tx.to, input.prepared.transaction.to, "Transaction target");
  same(tx.input, input.prepared.transaction.data, "Transaction calldata"); requireCondition(tx.value === BigInt(input.prepared.transaction.value) && tx.chainId === 4663, "Transaction value or chain mismatch.");
  same(receipt.from, tx.from, "Receipt sender"); same(receipt.to, tx.to, "Receipt target"); same(tx.blockHash, receipt.blockHash, "Transaction block"); same(block.hash, receipt.blockHash, "Canonical receipt block");
  requireCondition(tx.blockNumber === receipt.blockNumber && block.number === receipt.blockNumber && receipt.blockNumber >= BigInt(binding.release.startBlock), "Receipt block number mismatch.");
  requireCondition(receipt.blockNumber > input.prepared.blockNumber, "Receipt predates this preparation. An earlier transaction cannot confirm a new request.");
  if (receipt.status === "reverted") throw new ModuleNativeTransactionRevertedError(transactionHash, receipt.blockNumber, receipt.blockHash);
  requireCondition(receipt.status === "success", "Receipt status is unavailable.");
  const result = await binding.receipt(receipt);
  const canonical = await input.client.getBlock({ blockNumber: receipt.blockNumber });
  requireCondition(canonical.number === receipt.blockNumber, "Canonical receipt block number changed.");
  same(canonical.hash, receipt.blockHash, "Canonical receipt block after verification");
  return result;
}
