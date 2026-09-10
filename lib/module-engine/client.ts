import { concatHex, decodeAbiParameters, decodeEventLog, decodeFunctionResult, encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, getCreate2Address, keccak256, parseAbi, parseAbiParameters, toHex, type Abi, type Address, type Hex, type PublicClient, type TransactionReceipt } from "viem";
import { compileOpenConfig, type OpenConfigValue } from "@/packages/classic-modules/src/open-config.mjs";
import { createModuleNativeClient, type ModuleNativeClient, type ModuleNativeWalletTransaction } from "@/lib/module-mode/native-client";
import { nativeCanonicalJson } from "@/lib/module-mode/native-catalog";
import { moduleAddress, moduleBytes, moduleHash, moduleRecord, moduleUint } from "@/lib/module-mode/release";
import type { ModuleSocialLinks } from "@/lib/module-mode/token-metadata";
import { ENGINE_CONTEXT, moduleEngineAnyQuoteHostAbi, moduleEngineAnyQuoteHookAbi, moduleEngineAnyQuoteLedgerAbi, moduleEnginePermit2Abi, moduleEngineAuthorWalletAbi, moduleEngineHostAbi, moduleEngineLaunchParameters, moduleEngineLedgerAbi, moduleEnginePlanParameters, moduleEngineReadAbi, moduleEngineTradeLimitsParameters } from "./abi";
import { bindActiveModuleEngineRelease, bindModuleEngineReleaseIdentity, bindModuleEngineTemplate, ENGINE_ZERO_ADDRESS as ZERO, ENGINE_ZERO_HASH as ZERO_HASH, moduleEngineOptionalHash, parseModuleEngineAvailability, type ModuleEngineAvailability, type ModuleEnginePermission, type ModuleEngineRelease, type ModuleEngineReleaseIdentity, type ModuleEngineTemplate } from "./catalog";
import { encodeModuleEngineConfiguration } from "./configuration";
import { isModuleEngineAnyQuoteRelease, moduleEngineContractRoles, moduleEngineSourceId, MODULE_ENGINE_ANY_QUOTE_PROFILE_ID } from "./profile";
import { ANY_QUOTE_INFRASTRUCTURE, ANY_QUOTE_NATIVE_BUY_OPERATION_ID } from "./any-quote/types";
import { assertAnyQuoteLaunchPreparation, anyQuoteMinimumOutput, type AnyQuoteTradeQuote, type AnyQuoteLaunchPreparation } from "./any-quote/integration";
import { anyQuoteEvidenceHashV1, anyQuoteModulePoolKeyV1, buildAnyQuoteSwapV1 } from "./any-quote/route";
import anyQuoteChainProfile from "@/contracts/spec/robinhood-custom-launch/chain-4663.v1.json";

import { compileModuleEngineLaunch, moduleEngineOperation as operationFor } from "./operation-plan";
export { materializeModuleEngineRuntime, predictModuleEngineAddress } from "./operation-plan";

export type ModuleEngineClient = ModuleNativeClient & Partial<Pick<PublicClient, "getLogs">>;
export const createModuleEngineClient = createModuleNativeClient;
export interface ModuleEngineOperation { operationId: Hex; actor: Address; recipient: Address; inputAsset: Address; inputAmount: bigint; outputAsset: Address; minimumOutput: bigint; deadline: bigint; nonce: bigint; data: Hex }
export type ModuleEngineOperationIntent = Omit<ModuleEngineOperation, "actor" | "nonce" | "deadline">;
export interface ModuleEngineLaunchRecord { launchId: Hex; revisionId: Hex; creator: Address; token: Address; quoteAsset: Address; engine: Address; engineCodeHash: Hex; constructorHash: Hex; initCodeHash: Hex; configurationHash: Hex; planHash: Hex; resourcesHash: Hex; buyCreatorFeeBps: number; sellCreatorFeeBps: number }
interface PreparedBase {
  readonly sourceKind: "module-engine-v1"; readonly account: Address; readonly releaseDigest: Hex; readonly blockNumber: bigint;
  readonly transaction: Readonly<ModuleNativeWalletTransaction>; readonly expiresAt: bigint; readonly gasEstimate: bigint;
}
export interface PreparedModuleEngineLaunch extends PreparedBase {
  readonly kind: "launch"; readonly predictedToken: Address; readonly engine: Address; readonly launchId: Hex; readonly revisionId: Hex; readonly planHash: Hex;
  readonly configurationHash: Hex; readonly engineCodeHash: Hex; readonly quoteAsset: Address; readonly quoteDecimals: number; readonly initialOperation: Readonly<ModuleEngineOperation>;
  readonly anyQuote?: { readonly initialBuyWei: bigint; readonly outputAmount: bigint; readonly minimumOutput: bigint; readonly actualFdvUsd: { numerator: string; denominator: string } };
  readonly platformFeeBps: 10 | 30; readonly buyCreatorFeeBps: number; readonly sellCreatorFeeBps: number;
}
export interface PreparedModuleEngineOperation extends PreparedBase {
  readonly kind: "execute"; readonly token: Address; readonly launchId: Hex; readonly revisionId: Hex; readonly planHash: Hex;
  readonly operation: Readonly<ModuleEngineOperation>; readonly result: Hex;
}
export interface PreparedModuleEngineApproval extends PreparedBase { readonly kind: "approve"; readonly token: Address; readonly spender: Address; readonly amount: bigint; readonly allowanceKind?: "erc20" | "permit2"; readonly permit2Spender?: Address; readonly expiration?: bigint }
export interface PreparedModuleEngineClaim extends PreparedBase { readonly kind: "claim"; readonly token: Address; readonly launchId: Hex; readonly revisionId: Hex; readonly planHash: Hex; readonly recipient: Address; readonly minimumAmount: bigint; readonly claimedBefore: bigint; readonly feeAsset?: Address; readonly feeDecimals?: number }
export type ModuleEngineFeeChange =
  | Readonly<{ kind: "rotate-platform"; previousWallet: Address; recipient: Address; authority: "treasury" | "reward-admin" }>
  | Readonly<{ kind: "rotate-creator"; index: number; previousWallet: Address; recipient: Address; shareBps: number }>
  | Readonly<{ kind: "replace-creators"; previousWallets: readonly Address[]; recipients: readonly Address[]; sharesBps: readonly number[]; expectedAdminRevision: bigint; deadline: bigint; authority: "treasury" | "reward-admin" }>
  | Readonly<{ kind: "rotate-author"; familyId: Hex; author: Address; previousWallet: Address; recipient: Address }>;
export type ModuleEngineFeeChangeIntent =
  | { kind: "rotate-platform"; recipient: Address }
  | { kind: "rotate-creator"; index: number; recipient: Address }
  | { kind: "replace-creators"; recipients: readonly Address[] }
  | { kind: "rotate-author"; familyId: Hex; recipient: Address };
export type PreparedModuleEngineFeeChange = PreparedBase & Readonly<{ token: Address; launchId: Hex; revisionId: Hex; planHash: Hex }> & ModuleEngineFeeChange;
export interface PreparedModuleEngineSwap extends PreparedBase {
  readonly kind: "swap"; readonly token: Address; readonly quoteAsset: Address; readonly quoteDecimals: number;
  readonly launchId: Hex; readonly revisionId: Hex; readonly planHash: Hex; readonly buy: boolean; readonly recipient: Address;
  readonly inputAmount: bigint; readonly outputAmount: bigint; readonly minimumOutput: bigint; readonly externalRoute: AnyQuoteTradeQuote["externalRoute"];
}
export type PreparedModuleEngineTransaction = PreparedModuleEngineSwap | PreparedModuleEngineLaunch | PreparedModuleEngineOperation | PreparedModuleEngineApproval | PreparedModuleEngineClaim | PreparedModuleEngineFeeChange;
export function isModuleEngineFeeTransaction(prepared: PreparedModuleEngineTransaction): prepared is PreparedModuleEngineFeeChange { return ["rotate-platform", "rotate-creator", "replace-creators", "rotate-author"].includes(prepared.kind); }
export interface ModuleEngineApprovalRequired { kind: "approval-required"; token: Address; spender: Address; amount: bigint; currentAllowance: bigint; allowanceKind?: "erc20" | "permit2"; permit2Spender?: Address; expiration?: bigint; funding?: { balance: bigint; erc20Allowance: bigint; permit2Amount: bigint; permit2Expiration: number; permit2Nonce: number } }
export interface ModuleEngineReceiptResult {
  sourceKind: "module-engine-v1"; status: "mined"; finalized: false; indexed: false; kind: PreparedModuleEngineTransaction["kind"];
  transactionHash: Hex; blockNumber: bigint; blockHash: Hex; token?: Address; launch?: ModuleEngineLaunchRecord; outputAmount?: bigint;
  feeChange?: { changes: readonly { previousWallet: Address; recipient: Address; index?: number; familyId?: Hex }[]; previewChanged: boolean; subsequentlyChanged: boolean };
}
export class ModuleEngineTransactionRevertedError extends Error {
  readonly code = "MODULE_ENGINE_TRANSACTION_REVERTED";
  constructor(readonly transactionHash: Hex, readonly blockNumber: bigint, readonly blockHash: Hex) { super("The bound engine transaction reverted onchain."); this.name = "ModuleEngineTransactionRevertedError"; }
}
export const ENGINE_OPERATIONS = Object.freeze(Object.fromEntries([
  ["buy", "spot.buy.exact-input.v1"], ["sell", "spot.sell.exact-input.v1"], ["deposit", "escrow.deposit.v1"], ["withdraw", "escrow.withdraw.v1"],
  ["request", "settlement.request.v1"], ["fulfill", "settlement.fulfill.v1"], ["refund", "settlement.refund.v1"],
].map(([key, value]) => [key, keccak256(toHex(value))])) as Record<"buy" | "sell" | "deposit" | "withdraw" | "request" | "fulfill" | "refund", Hex>);
const SUPPLY = 1_000_000_000n * 10n ** 18n;
export type ModuleEngineIdentityBlockV1<R extends ModuleEngineReleaseIdentity = ModuleEngineReleaseIdentity> = { release: R; blockNumber: bigint; blockHash: Hex; timestamp: bigint };
type BoundBlock = ModuleEngineIdentityBlockV1;
export interface ModuleEngineSourcePreparationV1<T extends PreparedModuleEngineTransaction> {
  prepared: T;
  refresh: (current: BoundBlock) => Promise<void>;
  receipt: (receipt: TransactionReceipt, block: BoundBlock) => Promise<ModuleEngineReceiptResult>;
}
type Binding = { client: ModuleEngineClient; release: ModuleEngineRelease; refresh: () => Promise<void>; receipt: (receipt: TransactionReceipt) => Promise<ModuleEngineReceiptResult>; state: "ready" | "pending" | "submitted"; hash?: Hex };
const preparations = new WeakMap<PreparedModuleEngineTransaction, Binding>();
function need(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`Module engine: ${message}`); }
function same(actual: unknown, expected: unknown, label: string) { need(typeof actual === "string" && typeof expected === "string" && actual.toLowerCase() === expected.toLowerCase(), `${label} differs.`); }
function equal(actual: unknown, expected: unknown, label: string) { need(nativeCanonicalJson(actual) === nativeCanonicalJson(expected), `${label} differs.`); }
function uint(value: unknown, label: string, positive = false) { return BigInt(moduleUint(typeof value === "bigint" ? value.toString() : value, label, positive)); }
function fee(value: unknown) { need(typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1000 && value % 100 === 0, "Creator fees must be whole percentages from 0% to 10%."); return value; }
function freeze<T>(value: T): T { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function deadline(timestamp: bigint, seconds = 300) { need(Number.isInteger(seconds) && seconds >= 30 && seconds <= 900, "Use a 30–900 second deadline."); return timestamp + BigInt(seconds); }
async function read(client: ModuleEngineClient, address: Address, functionName: string, args: readonly unknown[], blockNumber: bigint, abi: Abi = moduleEngineReadAbi): Promise<unknown> { return client.readContract({ address, abi, functionName, args, blockNumber }); }
async function canonical(client: ModuleEngineClient, block: BoundBlock) { same((await client.getBlock({ blockNumber: block.blockNumber })).hash, block.blockHash, "Canonical RPC block"); }
async function code(client: ModuleEngineClient, address: Address, hash: Hex, blockNumber: bigint) { const bytes = await client.getCode({ address, blockNumber }); need(bytes && bytes !== "0x", `No contract at ${address}.`); same(keccak256(bytes), hash, "Runtime code"); }

/** The authenticated endpoint authorizes a release. This independently checks its exact chain and source pins. */
export async function assertModuleEngineRelease(input: { client: ModuleEngineClient; release: ModuleEngineRelease; blockNumber?: bigint }): Promise<ModuleEngineIdentityBlockV1<ModuleEngineRelease>> {
  return assertModuleEngineSource({ ...input, release: bindActiveModuleEngineRelease(input.release) });
}
/** Source identity is independently useful to the authenticated preactivation operator. It grants no public availability. */
export async function assertModuleEngineSourceIdentityV1(input: { client: ModuleEngineClient; identity: ModuleEngineReleaseIdentity; blockNumber?: bigint }): Promise<BoundBlock> {
  return assertModuleEngineSource({ client: input.client, release: freeze(bindModuleEngineReleaseIdentity(input.identity)), blockNumber: input.blockNumber });
}
async function assertModuleEngineSource<R extends ModuleEngineReleaseIdentity>(input: { client: ModuleEngineClient; release: R; blockNumber?: bigint }): Promise<ModuleEngineIdentityBlockV1<R>> {
  const { client, release } = input;
  need(await client.getChainId() === 4663, "RPC is on another chain.");
  const block = await client.getBlock(input.blockNumber === undefined ? { blockTag: "latest" } : { blockNumber: input.blockNumber });
  need(block.number !== null && block.hash !== null && block.number >= BigInt(release.startBlock), "Release block is unavailable.");
  if (input.blockNumber === undefined) need(Math.abs(Date.now() / 1000 - Number(block.timestamp)) <= 120, "RPC state is stale. Refresh before continuing.");
  const pins = release.contracts;
  await Promise.all(moduleEngineContractRoles(release).map(role => { const pin = (pins as Record<string, { address: Address; runtimeCodeHash: Hex }>)[role]; return code(client, pin.address, pin.runtimeCodeHash, block.number!); }));
  await Promise.all((["tokenFactory", "launchPolicy", "registry", "ledger"] as const).map(async role => same(await read(client, pins.host.address, role, [], block.number!, moduleEngineHostAbi), pins[role].address, `Host ${role}`)));
  if (isModuleEngineAnyQuoteRelease(release)) {
    const sharedHook = release.contracts.sharedHook;
    await Promise.all(([["hook", sharedHook.address], ["host", pins.host.address], ["poolManager", pins.poolManager.address]] as const).map(async ([getter, expected]) => same(await read(client, pins.ledger.address, getter, [], block.number!, moduleEngineAnyQuoteLedgerAbi), expected, `Quote ledger ${getter}`)));
    await Promise.all(([["host", pins.host.address], ["ledger", pins.ledger.address], ["poolManager", pins.poolManager.address]] as const).map(async ([getter, expected]) => same(await read(client, sharedHook.address, getter, [], block.number!, moduleEngineAnyQuoteHookAbi), expected, `Shared hook ${getter}`)));
    await Promise.all(([["sharedHook", sharedHook.address], ["nativeRouteGuard", release.contracts.nativeRouteGuard.address], ["NATIVE_ROUTE_GUARD_CODE_HASH", release.contracts.nativeRouteGuard.runtimeCodeHash], ["quoteFeeProfileId", MODULE_ENGINE_ANY_QUOTE_PROFILE_ID], ["quotePoolManager", pins.poolManager.address], ["quotePoolManagerCodeHash", pins.poolManager.runtimeCodeHash], ["UNIVERSAL_ROUTER", release.contracts.universalRouter.address], ["UNIVERSAL_ROUTER_CODE_HASH", release.contracts.universalRouter.runtimeCodeHash]] as const).map(async ([getter, expected]) => same(await read(client, pins.host.address, getter, [], block.number!, moduleEngineAnyQuoteHostAbi), expected, `Quote host ${getter}`)));
    same(release.contracts.universalRouter.address, ANY_QUOTE_INFRASTRUCTURE.universalRouter, "Pinned Universal Router");
    same(release.contracts.universalRouter.runtimeCodeHash, ANY_QUOTE_INFRASTRUCTURE.universalRouterCodeHash, "Universal Router runtime");
  } else {
    await Promise.all(([["hook", "host"], ["registry", "registry"], ["poolManager", "poolManager"]] as const).map(async ([getter, role]) => same(await read(client, pins.ledger.address, getter, [], block.number!), pins[role].address, `Ledger ${getter}`)));
    const [protocol, authors] = await Promise.all([read(client, pins.ledger.address, "PROTOCOL_FEE_BPS", [], block.number), read(client, pins.ledger.address, "AUTHOR_POOL_FEE_BPS", [], block.number)]);
    need(protocol === 10 && authors === 20, "Ledger fee constants differ.");
  }
  same(await read(client, pins.host.address, "SOURCE_VERSION", [], block.number, moduleEngineHostAbi), moduleEngineSourceId(release), "Host source version");
  same(await read(client, pins.ledger.address, "ECONOMICS_POLICY_ID", [], block.number), release.economicsPolicyId, "Ledger economics policy");
  moduleAddress(await read(client, pins.registry.address, "owner", [], block.number), "registry.owner");
  const result = { release, blockNumber: block.number, blockHash: block.hash, timestamp: block.timestamp }; await canonical(client, result); return result;
}
function launchRecord(value: unknown): ModuleEngineLaunchRecord {
  need(value && typeof value === "object", "Missing engine launch record."); const r = value as Record<string, unknown>;
  const result = {} as Record<string, unknown>;
  for (const key of ["launchId", "revisionId", "engineCodeHash", "constructorHash", "initCodeHash", "configurationHash", "planHash", "resourcesHash"]) result[key] = moduleHash(r[key], key);
  for (const key of ["creator", "token", "quoteAsset", "engine"]) result[key] = moduleAddress(r[key], key);
  result.buyCreatorFeeBps = fee(r.buyCreatorFeeBps); result.sellCreatorFeeBps = fee(r.sellCreatorFeeBps); return result as unknown as ModuleEngineLaunchRecord;
}
function ledgerAbi(release: ModuleEngineReleaseIdentity): Abi { return isModuleEngineAnyQuoteRelease(release) ? moduleEngineAnyQuoteLedgerAbi : moduleEngineLedgerAbi; }
function contextFor(release: ModuleEngineReleaseIdentity, r: Pick<ModuleEngineLaunchRecord, "launchId" | "token" | "creator" | "quoteAsset">) { return { host: release.contracts.host.address, launchId: r.launchId, token: r.token, creator: r.creator, quoteAsset: r.quoteAsset, feeCollector: isModuleEngineAnyQuoteRelease(release) ? release.contracts.ledger.address : release.contracts.host.address }; }
const quoteLedgerRegistrationAbi = parseAbi(["event QuoteLaunchRegistered(bytes32 indexed launchId,address indexed asset,bytes32 configurationHash,address[] creatorWallets,uint16[] creatorSharesBps)"]);
async function anyQuoteLedgerConfiguration(client: ModuleEngineClient, block: BoundBlock, launch: ModuleEngineLaunchRecord): Promise<Hex> {
  need(isModuleEngineAnyQuoteRelease(block.release), "Quote ledger source is unavailable.");
  need(typeof client.getLogs === "function", "Quote launch registration logs are unavailable on this client.");
  const pins = block.release.contracts, fromBlock = BigInt(block.release.startBlock);
  const logs = await client.getLogs({ address: pins.ledger.address, event: quoteLedgerRegistrationAbi[0],
    args: { launchId: launch.launchId, asset: launch.quoteAsset }, fromBlock, toBlock: block.blockNumber, strict: true });
  need(logs.length === 1, "Expected exactly one quote launch registration from the released ledger.");
  const log = logs[0];
  need(!log.removed && log.blockNumber !== null && log.blockHash !== null && log.transactionHash !== null && log.blockNumber >= fromBlock && log.blockNumber <= block.blockNumber, "Quote launch registration is outside the canonical checkpoint.");
  same(log.address, pins.ledger.address, "Quote launch registration ledger");
  same((await client.getBlock({ blockNumber: log.blockNumber })).hash, log.blockHash, "Quote launch registration block");
  const { args } = decodeEventLog({ abi: quoteLedgerRegistrationAbi, eventName: "QuoteLaunchRegistered", data: log.data, topics: log.topics, strict: true });
  same(args.launchId, launch.launchId, "Quote launch registration ID"); same(args.asset, launch.quoteAsset, "Quote launch registration asset");
  equal(encodeEventTopics({ abi: quoteLedgerRegistrationAbi, eventName: "QuoteLaunchRegistered", args }), log.topics, "Quote launch registration topics");
  same(encodeAbiParameters(parseAbiParameters("bytes32,address[],uint16[]"), [args.configurationHash, args.creatorWallets, args.creatorSharesBps]), log.data, "Quote launch registration payload");
  const wallets = args.creatorWallets.map(wallet => moduleAddress(wallet, "Original creator wallet")), shares = args.creatorSharesBps;
  need(wallets.length > 0 && wallets.length <= 10 && wallets.length === shares.length && shares.every(share => share > 0) && shares.reduce((sum, share) => sum + share, 0) === 10_000, "Original quote creator allocation differs.");
  // registerLaunch binds the original allocation. Recipient rotations never change this hash.
  const configuration = keccak256(encodeAbiParameters(parseAbiParameters("bytes32,uint256,address,address,address,address,bytes32,address,address[],uint16[]"),
    [block.release.economicsPolicyId, 4663n, pins.ledger.address, pins.poolManager.address, pins.sharedHook.address, pins.host.address, launch.launchId, launch.quoteAsset, wallets, shares]));
  same(args.configurationHash, configuration, "Quote launch registration configuration");
  return configuration;
}
async function boundLaunch(client: ModuleEngineClient, block: BoundBlock, tokenValue: Address): Promise<ModuleEngineLaunchRecord> {
  const token = moduleAddress(tokenValue, "engine.token"), host = block.release.contracts.host.address;
  const id = moduleHash(await read(client, host, "launchIdOf", [token], block.blockNumber, moduleEngineHostAbi), "launchId");
  const r = launchRecord(await read(client, host, "getLaunch", [id], block.blockNumber, moduleEngineHostAbi)); same(r.token, token, "Launch token"); same(r.launchId, id, "Launch ID");
  const expectedId = keccak256(encodeAbiParameters(parseAbiParameters("uint256,address,address,bytes32,bytes32"), [4663n, host, token, r.revisionId, r.configurationHash])); same(r.launchId, expectedId, "Derived launch ID");
  const [tokenCode] = await Promise.all([client.getCode({ address: token, blockNumber: block.blockNumber }), code(client, r.engine, r.engineCodeHash, block.blockNumber)]);
  need(tokenCode && tokenCode !== "0x", "Launch token has no deployed runtime.");
  const [engineId, creator, supply, decimals, contextHash, tokenName, tokenSymbol, tokenGraffiti] = await Promise.all([read(client, host, "engineLaunchId", [r.engine], block.blockNumber, moduleEngineHostAbi), read(client, token, "creator", [], block.blockNumber), read(client, token, "totalSupply", [], block.blockNumber), read(client, token, "decimals", [], block.blockNumber), read(client, r.engine, "contextHash", [], block.blockNumber), read(client, token, "name", [], block.blockNumber), read(client, token, "symbol", [], block.blockNumber), read(client, token, "graffiti", [], block.blockNumber)]);
  same(engineId, id, "Engine registration"); same(creator, host, "Token creator"); need(supply === SUPPLY && decimals === 18, "Token supply or decimals differ.");
  need(typeof tokenName === "string" && typeof tokenSymbol === "string", "Token metadata getters are unavailable.");
  const graffiti = moduleEngineOptionalHash(tokenGraffiti, "token graffiti");
  const factoryToken = await read(client, block.release.contracts.tokenFactory.address, "getUERC20Address", [tokenName, tokenSymbol, 18, host, graffiti], block.blockNumber);
  same(factoryToken, token, "Factory token address");
  const expectedToken = getCreate2Address({ from: block.release.contracts.tokenFactory.address, salt: keccak256(encodeAbiParameters(parseAbiParameters("string,string,uint8,address,bytes32"), [tokenName, tokenSymbol, 18, host, graffiti])), bytecodeHash: block.release.tokenCreationCodeHash });
  same(expectedToken, token, "Factory CREATE2 token identity");
  same(contextHash, keccak256(encodeAbiParameters(parseAbiParameters(ENGINE_CONTEXT), [contextFor(block.release, r)])), "Engine context");
  if (isModuleEngineAnyQuoteRelease(block.release)) {
    const [asset, configuration, poolId, enginePoolId, ledgerConfiguration] = await Promise.all([
      read(client, block.release.contracts.ledger.address, "quoteAsset", [id], block.blockNumber, moduleEngineAnyQuoteLedgerAbi),
      read(client, block.release.contracts.ledger.address, "configurationHash", [id], block.blockNumber, moduleEngineAnyQuoteLedgerAbi),
      read(client, host, "poolIdOf", [id], block.blockNumber, moduleEngineAnyQuoteHostAbi), read(client, r.engine, "poolId", [], block.blockNumber),
      anyQuoteLedgerConfiguration(client, block, r),
    ]);
    same(asset, r.quoteAsset, "Ledger quote asset"); same(configuration, ledgerConfiguration, "Ledger configuration"); same(poolId, enginePoolId, "Shared pool registration");
  }
  return r;
}
export async function readModuleEngineLaunch(input: { client: ModuleEngineClient; release: ModuleEngineRelease; token: Address; blockNumber?: bigint }): Promise<ModuleEngineLaunchRecord> {
  const block = await assertModuleEngineRelease(input), result = await boundLaunch(input.client, block, input.token); await canonical(input.client, block); return result;
}
export async function readModuleEngineSourceLaunchV1(input: { client: ModuleEngineClient; identity: ModuleEngineReleaseIdentity; token: Address; blockNumber?: bigint }): Promise<ModuleEngineLaunchRecord> {
  const block = await assertModuleEngineSourceIdentityV1(input), result = await boundLaunch(input.client, block, input.token); await canonical(input.client, block); return result;
}
export async function readModuleEngineSourceTemplateV1(input: { client: ModuleEngineClient; identity: ModuleEngineReleaseIdentity; template: ModuleEngineTemplate; newLaunch: boolean; blockNumber?: bigint }): Promise<ModuleEngineTemplate> {
  const block = await assertModuleEngineSourceIdentityV1(input), result = await assertTemplate(input.client, block, input.template, input.newLaunch); await canonical(input.client, block); return result;
}
async function assertTemplate(client: ModuleEngineClient, block: BoundBlock, value: ModuleEngineTemplate, newLaunch: boolean) {
  const template = bindModuleEngineTemplate(value, block.release), m = template.manifest.manifest, host = block.release.contracts.host.address;
  const result = await read(client, host, "getRevision", [m.revision.packageId], block.blockNumber, moduleEngineHostAbi) as readonly [Record<string, unknown>, readonly number[], readonly number[], readonly Hex[]];
  need(Array.isArray(result) && result.length === 4, "Invalid engine registry result."); const [revision, offsets, bindings, families] = result;
  if (newLaunch) need(revision.enabled === true, "This revision is unavailable for new launches.");
  for (const key of ["familyId", "fixedQuoteAsset", "fixedConfigurationHash", "initialOperationId"] as const) same(revision[key], m.revision[key], `Revision ${key}`);
  for (const key of ["executionGas", "moneyRights", "coinRights"] as const) need(revision[key] === m.revision[key], `Revision ${key} differs.`);
  same(revision.creationCodeHash, m.source.engine.creationCodeHash, "Revision creation code"); same(revision.runtimeTemplateHash, m.source.engine.runtimeTemplateHash, "Revision runtime template"); same(revision.manifestHash, template.manifestHash, "Registry reviewed manifest");
  equal(offsets, m.source.engine.immutableRuntimeOffsets, "Runtime immutable offsets"); equal(bindings, m.source.engine.immutableConstructorOffsets, "Constructor immutable offsets"); equal(families, m.revision.eligibleFamilies, "Fee family snapshot");
  await Promise.all(m.revision.operationPermissions.map(async permission => { equal(await read(client, host, "permission", [m.revision.packageId, permission.operationId], block.blockNumber, moduleEngineHostAbi), permission, "Registry operation permission"); }));
  return template;
}
export async function readModuleEnginePermission(input: { client: ModuleEngineClient; release: ModuleEngineRelease; token: Address; operationId: Hex; blockNumber?: bigint }) {
  const block = await assertModuleEngineRelease(input), launch = await boundLaunch(input.client, block, input.token);
  const permission = await read(input.client, block.release.contracts.host.address, "permission", [launch.revisionId, moduleHash(input.operationId, "operationId")], block.blockNumber, moduleEngineHostAbi) as ModuleEnginePermission;
  same(permission.operationId, input.operationId, "Operation permission"); await canonical(input.client, block); return { launch, permission, blockNumber: block.blockNumber, timestamp: block.timestamp };
}
function role(launch: Pick<ModuleEngineLaunchRecord, "token" | "quoteAsset">, asset: Address, amount: bigint) { if (asset === ZERO) return amount === 0n ? 0 : 4; if (asset.toLowerCase() === launch.token.toLowerCase()) return 1; if (asset.toLowerCase() === launch.quoteAsset.toLowerCase()) return 2; throw new Error("Module engine: Unsupported operation asset."); }
async function validateOperation(client: ModuleEngineClient, block: BoundBlock, launch: Pick<ModuleEngineLaunchRecord, "launchId" | "revisionId" | "creator" | "token" | "quoteAsset">, operation: ModuleEngineOperation, account: Address): Promise<ModuleEngineApprovalRequired | null> {
  same(operation.actor, account, "Operation actor"); moduleAddress(operation.recipient, "recipient"); need(operation.deadline >= block.timestamp, "Operation deadline expired.");
  const permission = await read(client, block.release.contracts.host.address, "permission", [launch.revisionId, operation.operationId], block.blockNumber, moduleEngineHostAbi) as ModuleEnginePermission;
  same(permission.operationId, operation.operationId, "Registered operation");
  need(permission.authorization === 0 || permission.authorization === 1, "Invalid operation authorization.");
  if (permission.authorization === 1) same(account, launch.creator, "Creator-only operation authority");
  const inputRole = role(launch, operation.inputAsset, operation.inputAmount), outputRole = role(launch, operation.outputAsset, operation.minimumOutput);
  need((permission.inputRoles & inputRole) === inputRole && (permission.outputRoles & outputRole) === outputRole, "Operation asset roles exceed registered rights.");
  const nonce = uint(await read(client, block.release.contracts.host.address, "nonces", [launch.launchId, account], block.blockNumber, moduleEngineHostAbi), "nonce"); need(nonce === operation.nonce, "Operation nonce changed. Prepare again.");
  if (inputRole === 1 || inputRole === 2) return approvalRequired(client, block, operation.inputAsset, account, operation.inputAmount);
  return null;
}
async function approvalRequired(client: ModuleEngineClient, block: BoundBlock, token: Address, account: Address, amount: bigint): Promise<ModuleEngineApprovalRequired | null> {
  if (amount === 0n) return null;
  const spender = block.release.contracts.host.address;
  const [balance, allowance] = await Promise.all([read(client, token, "balanceOf", [account], block.blockNumber), read(client, token, "allowance", [account, spender], block.blockNumber)]);
  need(uint(balance, "input balance") >= amount, "Insufficient balance in the exact input asset.");
  const currentAllowance = uint(allowance, "input allowance"); return currentAllowance < amount ? { kind: "approval-required", token, spender, amount, currentAllowance } : null;
}
async function simulate(client: ModuleEngineClient, block: BoundBlock, transaction: ModuleNativeWalletTransaction, returnsNothing = false) {
  const request = { account: transaction.from, to: transaction.to, data: transaction.data, value: BigInt(transaction.value), blockNumber: block.blockNumber };
  const [result, gasEstimate] = await Promise.all([client.call(request), client.estimateGas(request)]);
  need(returnsNothing ? !result.data || result.data === "0x" : result.data && result.data !== "0x", "Simulation returned an unexpected result.");
  need(gasEstimate > 0n && gasEstimate <= 30_000_000n, "Transaction gas is outside the supported limit."); await canonical(client, block); return { data: result.data ?? "0x", gasEstimate };
}
function tx(account: Address, to: Address, data: Hex, value: bigint, action: ModuleNativeWalletTransaction["action"], description: string): ModuleNativeWalletTransaction { return { chainId: 4663, from: account, to, data, value: toHex(value), action, description }; }
function bind<T extends PreparedModuleEngineTransaction>(prepared: T, binding: Omit<Binding, "state">) { freeze(prepared); preparations.set(prepared, { ...binding, state: "ready" }); return prepared; }
function bindPublicSourcePreparation<T extends PreparedModuleEngineTransaction>(source: ModuleEngineSourcePreparationV1<T>, client: ModuleEngineClient, release: ModuleEngineRelease): T {
  return bind(source.prepared, { client, release,
    refresh: async () => source.refresh(await assertModuleEngineRelease({ client, release })),
    receipt: async receipt => source.receipt(receipt, await receiptBlock(client, release, receipt)) });
}
function active(value: ModuleEngineAvailability) { const result = parseModuleEngineAvailability(value); need(result.release, "Engine launches are unavailable."); return { ...result, release: result.release }; }
export interface PrepareModuleEngineLaunchInput {
  client: ModuleEngineClient; availability: ModuleEngineAvailability; templateId: string; account: Address; quoteAsset: Address;
  name: string; symbol: string; description: string; imageUri?: string; socialLinks?: ModuleSocialLinks;
  configuration: OpenConfigValue; anyQuotePreparation?: AnyQuoteLaunchPreparation; creatorSalt: Hex; engineSalt: Hex; launchData?: Hex;
  creatorWallets: readonly Address[]; creatorSharesBps: readonly number[]; buyCreatorFeeBps: number; sellCreatorFeeBps: number;
  initialOperation?: (identity: { token: Address; quoteAsset: Address }) => ModuleEngineOperationIntent;
  deadlineSeconds?: number;
}
export async function prepareModuleEngineLaunch(input: PrepareModuleEngineLaunchInput): Promise<PreparedModuleEngineLaunch | ModuleEngineApprovalRequired> {
  const availability = active(input.availability), release = freeze(availability.release);
  const template = availability.templates.find(item => item.manifest.manifest.catalogDefinition.id === input.templateId); need(template, "Template is not in the current catalog.");
  const source = await prepareModuleEngineLaunchAt(input, await assertModuleEngineRelease({ client: input.client, release }), template);
  return "kind" in source ? source : bindPublicSourcePreparation(source, input.client, release);
}
export async function prepareModuleEngineSourceLaunchV1(input: Omit<PrepareModuleEngineLaunchInput, "availability"> & { identity: ModuleEngineReleaseIdentity; template: ModuleEngineTemplate; blockNumber?: bigint }): Promise<ModuleEngineSourcePreparationV1<PreparedModuleEngineLaunch> | ModuleEngineApprovalRequired> {
  return prepareModuleEngineLaunchAt(input, await assertModuleEngineSourceIdentityV1(input), input.template);
}
async function prepareModuleEngineLaunchAt(input: Omit<PrepareModuleEngineLaunchInput, "availability">, block: BoundBlock, rawTemplate: ModuleEngineTemplate): Promise<ModuleEngineSourcePreparationV1<PreparedModuleEngineLaunch> | ModuleEngineApprovalRequired> {
  const account = moduleAddress(input.account, "account"), release = block.release, template = await assertTemplate(input.client, block, rawTemplate, true), m = template.manifest.manifest;
  const quoteAsset = moduleAddress(input.quoteAsset, "quoteAsset"); if (m.revision.fixedQuoteAsset !== ZERO) same(quoteAsset, m.revision.fixedQuoteAsset, "Fixed quote asset");
  const quoteCode = await input.client.getCode({ address: quoteAsset, blockNumber: block.blockNumber }); need(quoteCode && quoteCode !== "0x", "Quote asset is not a deployed token.");
  const quoteDecimals = Number(await read(input.client, quoteAsset, "decimals", [], block.blockNumber)); need(Number.isInteger(quoteDecimals) && quoteDecimals >= 0 && quoteDecimals <= (isModuleEngineAnyQuoteRelease(release) ? 36 : 18), "Quote decimals are unsupported.");
  const expiresAt = input.anyQuotePreparation ? BigInt(input.anyQuotePreparation.validUntil) : deadline(block.timestamp, input.deadlineSeconds);
  if (isModuleEngineAnyQuoteRelease(release)) {
    need(input.anyQuotePreparation, "A current Any Quote preview is required.");
    need(quoteDecimals === input.anyQuotePreparation.readiness.token.decimals, "Quote decimals changed from the price preview.");
    assertAnyQuoteLaunchPreparation(input.anyQuotePreparation, { releaseDigest: release.releaseDigest, templateId: input.templateId, account, quoteAsset,
      name: input.name, symbol: input.symbol, creatorSalt: input.creatorSalt, engineSalt: input.engineSalt, buyCreatorFeeBps: input.buyCreatorFeeBps, sellCreatorFeeBps: input.sellCreatorFeeBps,
      creatorWallets: input.creatorWallets, creatorSharesBps: input.creatorSharesBps, initialBuyWei: input.anyQuotePreparation.intent.initialBuyWei, slippageBps: input.anyQuotePreparation.intent.slippageBps }, release, block.timestamp);
  }
  const compiled = await compileModuleEngineLaunch(input, release, template.manifest, quoteDecimals, expiresAt);
  const { parameters, graffiti, predictedToken, launchId, configurationHash, constructorHash, initCodeHash, engineCodeHash, initialOperation, buyCreatorFeeBps, sellCreatorFeeBps, planHash } = compiled;
  const host = release.contracts.host.address, engineIdentity = { address: compiled.engine };
  if (input.anyQuotePreparation) {
    const preview = input.anyQuotePreparation;
    if (preview.initialBuy) {
      const route = buildAnyQuoteSwapV1({ pool: preview.pool, owner: account, recipient: account, side: "buy", amountIn: BigInt(preview.intent.initialBuyWei), minimumAmountOut: BigInt(preview.initialBuy.minimumOutput), deadline: expiresAt, externalRoute: preview.initialBuy.externalRoute, now: block.timestamp });
      need(BigInt(preview.initialBuy.minimumOutput) === anyQuoteMinimumOutput(BigInt(preview.initialBuy.output), preview.intent.slippageBps), "Initial buy output limit differs.");
      equal(Object.fromEntries(Object.entries(initialOperation).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value])), Object.fromEntries(Object.entries({ operationId: ANY_QUOTE_NATIVE_BUY_OPERATION_ID, actor: account, recipient: account, inputAsset: ZERO, inputAmount: BigInt(preview.intent.initialBuyWei), outputAsset: predictedToken, minimumOutput: BigInt(preview.initialBuy.minimumOutput), deadline: expiresAt, nonce: 0n, data: route.nativeBuyOperationData }).map(([key, value]) => [key, typeof value === "bigint" ? value.toString() : value])), "Exact initial ETH buy");
      await assertAnyQuoteRouteAccounting(input.client, block, route.balanceAccounting, predictedToken);
    } else need(initialOperation.operationId === ZERO_HASH, "Initial buy was not requested.");
  }
  const predicted = await read(input.client, host, "predictTokenAddress", [parameters.name, parameters.symbol, account, parameters.creatorSalt], block.blockNumber, moduleEngineHostAbi) as readonly [Address, Hex];
  same(predicted[1], graffiti, "Token graffiti"); same(predicted[0], predictedToken, "Predicted token");
  if (initialOperation.operationId !== ZERO_HASH && !(isModuleEngineAnyQuoteRelease(release) && initialOperation.operationId === ANY_QUOTE_NATIVE_BUY_OPERATION_ID)) { const required = await validateOperation(input.client, block, { launchId, revisionId: m.revision.packageId, creator: account, token: predictedToken, quoteAsset }, initialOperation, account); if (required) return required; }
  const transaction = tx(account, host, encodeFunctionData({ abi: moduleEngineHostAbi, functionName: "launch", args: [parameters] }), initialOperation.inputAsset === ZERO ? initialOperation.inputAmount : 0n, "launch", `Launch ${parameters.symbol} with ${m.catalogDefinition.title}`);
  const simulated = await simulate(input.client, block, transaction), result = launchRecord(decodeFunctionResult({ abi: moduleEngineHostAbi, functionName: "launch", data: simulated.data }));
  for (const [key, expected] of Object.entries({ launchId, revisionId: m.revision.packageId, token: predictedToken, creator: account, quoteAsset, engine: engineIdentity.address, engineCodeHash, constructorHash, initCodeHash, configurationHash, planHash })) same(result[key as keyof ModuleEngineLaunchRecord], expected, `Simulated ${key}`);
  // Host V1 admits its immutable reviewed family list into Ledger V2. Its reused Registry V1
  // has no Native V2 familyFeeEligibility getter; the list itself selects the 10/30 bps policy.
  const platformFeeBps = isModuleEngineAnyQuoteRelease(release) || m.revision.eligibleFamilies.length > 0 ? 30 : 10;
  const prepared: PreparedModuleEngineLaunch = { sourceKind: "module-engine-v1", kind: "launch", account, releaseDigest: release.releaseDigest, blockNumber: block.blockNumber, expiresAt, gasEstimate: simulated.gasEstimate, transaction: { ...transaction, gas: toHex(simulated.gasEstimate * 12n / 10n) }, predictedToken, engine: engineIdentity.address, launchId, revisionId: m.revision.packageId, planHash, configurationHash, engineCodeHash, quoteAsset, quoteDecimals, initialOperation, platformFeeBps, buyCreatorFeeBps, sellCreatorFeeBps, ...(input.anyQuotePreparation ? { anyQuote: { initialBuyWei: BigInt(input.anyQuotePreparation.intent.initialBuyWei), outputAmount: BigInt(input.anyQuotePreparation.initialBuy?.output ?? "0"), minimumOutput: BigInt(input.anyQuotePreparation.initialBuy?.minimumOutput ?? "0"), actualFdvUsd: input.anyQuotePreparation.actualFdvUsd } } : {}) };
  return { prepared, refresh: async (current: BoundBlock) => {
    need(current.timestamp <= expiresAt, "Launch preview expired."); await assertTemplate(input.client, current, template, true);
    if (initialOperation.operationId !== ZERO_HASH && !(isModuleEngineAnyQuoteRelease(release) && initialOperation.operationId === ANY_QUOTE_NATIVE_BUY_OPERATION_ID)) need(!await validateOperation(input.client, current, { ...result }, initialOperation, account), "Initial funding approval changed.");
    if (input.anyQuotePreparation?.initialBuy) {
      const p = input.anyQuotePreparation;
      const route = buildAnyQuoteSwapV1({ pool: p.pool, owner: account, recipient: account, side: "buy", amountIn: BigInt(p.intent.initialBuyWei), minimumAmountOut: BigInt(p.initialBuy!.minimumOutput), deadline: expiresAt, externalRoute: p.initialBuy!.externalRoute, now: current.timestamp });
      await assertAnyQuoteRouteAccounting(input.client, current, route.balanceAccounting, predictedToken);
    }
    const fresh = await simulate(input.client, current, transaction); const currentLaunch = launchRecord(decodeFunctionResult({ abi: moduleEngineHostAbi, functionName: "launch", data: fresh.data }));
    for (const key of ["launchId", "planHash", "token", "engine", "engineCodeHash", "configurationHash"] as const) same(currentLaunch[key], result[key], `Current launch ${key}`);
  }, receipt: (receipt, current) => verifyModuleEngineLaunchReceiptAt({ client: input.client, release, expected: result, receipt }, current) };
}
export async function prepareModuleEngineOperation(input: { client: ModuleEngineClient; release: ModuleEngineRelease; template: ModuleEngineTemplate; account: Address; token: Address; intent: ModuleEngineOperationIntent; deadlineSeconds?: number }): Promise<PreparedModuleEngineOperation | ModuleEngineApprovalRequired> {
  const account = moduleAddress(input.account, "account"), release = freeze(bindActiveModuleEngineRelease(input.release)), block = await assertModuleEngineRelease({ client: input.client, release });
  const launch = await boundLaunch(input.client, block, input.token), template = await assertTemplate(input.client, block, input.template, false); same(launch.revisionId, template.manifest.manifest.revision.packageId, "Launch template revision");
  const nonce = uint(await read(input.client, release.contracts.host.address, "nonces", [launch.launchId, account], block.blockNumber, moduleEngineHostAbi), "nonce"), expiresAt = deadline(block.timestamp, input.deadlineSeconds), operation = operationFor(input.intent, account, expiresAt, nonce);
  const approval = await validateOperation(input.client, block, launch, operation, account); if (approval) return approval;
  const transaction = tx(account, release.contracts.host.address, encodeFunctionData({ abi: moduleEngineHostAbi, functionName: "execute", args: [launch.launchId, operation] }), operation.inputAsset === ZERO ? operation.inputAmount : 0n, "manage", `Execute ${template.manifest.manifest.catalogDefinition.title}`);
  const simulated = await simulate(input.client, block, transaction), result = moduleBytes(decodeFunctionResult({ abi: moduleEngineHostAbi, functionName: "execute", data: simulated.data }), "engine.result", 65_536);
  const prepared: PreparedModuleEngineOperation = { sourceKind: "module-engine-v1", kind: "execute", account, releaseDigest: release.releaseDigest, blockNumber: block.blockNumber, expiresAt, gasEstimate: simulated.gasEstimate, transaction: { ...transaction, gas: toHex(simulated.gasEstimate * 12n / 10n) }, token: launch.token, launchId: launch.launchId, revisionId: launch.revisionId, planHash: launch.planHash, operation, result };
  return bind(prepared, { client: input.client, release, refresh: async () => {
    const current = await assertModuleEngineRelease({ client: input.client, release }), live = await boundLaunch(input.client, current, launch.token); same(live.planHash, launch.planHash, "Launch plan"); await assertTemplate(input.client, current, template, false);
    need(!await validateOperation(input.client, current, live, operation, account), "Input allowance changed."); await simulate(input.client, current, transaction);
  }, receipt: receipt => verifyModuleEngineOperationReceipt({ client: input.client, release, launch, operation, receipt }) });
}
export async function prepareModuleEngineApproval(input: { client: ModuleEngineClient; release: ModuleEngineRelease; account: Address; token: Address; amount: bigint; spender?: Address; allowanceKind?: "erc20" | "permit2"; permit2Spender?: Address; expiration?: bigint }): Promise<PreparedModuleEngineApproval> {
  const release = freeze(bindActiveModuleEngineRelease(input.release));
  return bindPublicSourcePreparation(await prepareModuleEngineApprovalAt(input, await assertModuleEngineRelease({ client: input.client, release })), input.client, release);
}
export async function prepareModuleEngineSourceApprovalV1(input: Omit<Parameters<typeof prepareModuleEngineApproval>[0], "release"> & { identity: ModuleEngineReleaseIdentity; blockNumber?: bigint }): Promise<ModuleEngineSourcePreparationV1<PreparedModuleEngineApproval>> {
  return prepareModuleEngineApprovalAt(input, await assertModuleEngineSourceIdentityV1(input));
}
async function prepareModuleEngineApprovalAt(input: Omit<Parameters<typeof prepareModuleEngineApproval>[0], "release">, block: BoundBlock): Promise<ModuleEngineSourcePreparationV1<PreparedModuleEngineApproval>> {
  const account = moduleAddress(input.account, "account"), token = moduleAddress(input.token, "token"), amount = uint(input.amount, "approval amount"), release = block.release;
  const shared = isModuleEngineAnyQuoteRelease(release), allowanceKind = input.allowanceKind ?? "erc20";
  const spender = shared ? ANY_QUOTE_INFRASTRUCTURE.permit2 : release.contracts.host.address;
  if (input.spender) same(input.spender, spender, "Approval spender");
  need(shared || allowanceKind === "erc20", "Permit2 is only used by shared-quote routing.");
  if (shared) { await boundLaunch(input.client, block, token); await code(input.client, spender, anyQuoteChainProfile.contracts.uniswap.permit2.runtimeCodeHash as Hex, block.blockNumber); }
  const tokenCode = await input.client.getCode({ address: token, blockNumber: block.blockNumber }); need(tokenCode && tokenCode !== "0x", "Approval asset has no contract."); const tokenHash = keccak256(tokenCode);
  const balance = uint(await read(input.client, token, "balanceOf", [account], block.blockNumber), "balance"); need(amount === 0n || amount <= balance, "Approval exceeds the available input balance.");
  const expiresAt = deadline(block.timestamp), permit2Spender = shared ? release.contracts.universalRouter.address : undefined;
  const expiration = input.expiration ?? expiresAt;
  if (allowanceKind === "permit2") { need(shared && amount < 1n << 160n && expiration > block.timestamp && expiration <= block.timestamp + 900n, "Invalid bounded Permit2 allowance."); if (input.permit2Spender) same(input.permit2Spender, permit2Spender, "Permit2 router"); }
  const abi = allowanceKind === "permit2" ? moduleEnginePermit2Abi : erc20Abi;
  const transaction = tx(account, allowanceKind === "permit2" ? spender : token, encodeFunctionData({ abi, functionName: "approve", args: allowanceKind === "permit2" ? [token, permit2Spender!, amount, Number(expiration)] : [spender, amount] }), 0n, "approve", allowanceKind === "permit2" ? "Approve this exact sell amount for the Universal Router with a short expiry" : amount === 0n ? "Reset the funding allowance" : "Approve the exact input amount");
  const call = async (current: BoundBlock) => { const request = { account, to: transaction.to, data: transaction.data, value: 0n, blockNumber: current.blockNumber }; const [result, gasEstimate] = await Promise.all([input.client.call(request), input.client.estimateGas(request)]); need(result.data === undefined || result.data === "0x" || (allowanceKind === "erc20" && decodeFunctionResult({ abi: erc20Abi, functionName: "approve", data: result.data }) === true), "Token rejected the bounded approval."); need(gasEstimate > 0n && gasEstimate <= 1_000_000n, "Approval gas is outside the supported limit."); await canonical(input.client, current); return gasEstimate; };
  const gasEstimate = await call(block);
  const prepared: PreparedModuleEngineApproval = { sourceKind: "module-engine-v1", kind: "approve", account, releaseDigest: release.releaseDigest, blockNumber: block.blockNumber, expiresAt, gasEstimate, transaction: { ...transaction, gas: toHex(gasEstimate * 12n / 10n) }, token, spender, amount, ...(shared ? { allowanceKind, ...(allowanceKind === "permit2" ? { permit2Spender, expiration } : {}) } : {}) };
  return { prepared, refresh: async (current: BoundBlock) => { need(current.timestamp <= expiresAt && (allowanceKind !== "permit2" || current.timestamp < expiration), "Approval preview expired."); await code(input.client, token, tokenHash, current.blockNumber); await call(current); }, receipt: (receipt, current) => verifyModuleEngineApprovalReceiptAt({ client: input.client, release, account, token, amount, spender, allowanceKind, permit2Spender, expiration, receipt }, current) };
}
export async function revalidateModuleEngineTransaction(prepared: PreparedModuleEngineTransaction, account: Address): Promise<ModuleNativeWalletTransaction> {
  const binding = preparations.get(prepared); need(binding && binding.state === "ready", "This is not a fresh, verified engine preparation."); same(account, prepared.account, "Selected wallet"); binding.state = "pending";
  try { await binding.refresh(); return prepared.transaction; } catch (error) { binding.state = "ready"; throw error; }
}
export function noteModuleEngineSubmission(prepared: PreparedModuleEngineTransaction, hash: Hex) { const binding = preparations.get(prepared); need(binding && binding.state === "pending", "No pending verified engine request."); binding.hash = moduleHash(hash, "transactionHash"); binding.state = "submitted"; }
/** Only call after a definite preflight failure or explicit wallet rejection; an uncertain send stays blocked. */
export function releaseModuleEnginePreparation(prepared: PreparedModuleEngineTransaction) { const binding = preparations.get(prepared); if (binding?.state === "pending") binding.state = "ready"; }
function receiptResult(receipt: TransactionReceipt, kind: PreparedModuleEngineTransaction["kind"], extra: Partial<Pick<ModuleEngineReceiptResult, "token" | "launch" | "outputAmount" | "feeChange">> = {}): ModuleEngineReceiptResult { return { sourceKind: "module-engine-v1", status: "mined", finalized: false, indexed: false, kind, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, ...extra }; }
function events(receipt: TransactionReceipt, address: Address, eventName: string, abi: Abi): Record<string, unknown>[] {
  const matches: Record<string, unknown>[] = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== address.toLowerCase()) continue;
    let decoded; try { decoded = decodeEventLog({ abi, data: log.data, topics: log.topics, strict: true }); } catch { continue; }
    if (decoded.eventName !== eventName) continue;
    need(!log.removed && log.transactionHash === receipt.transactionHash && log.blockHash === receipt.blockHash && log.blockNumber === receipt.blockNumber, "Engine event has a different block/transaction.");
    const args = decoded.args as unknown as Record<string, unknown>, shape = abi.find(item => item.type === "event" && item.name === eventName); need(shape?.type === "event", "Unknown event ABI.");
    equal(encodeEventTopics({ abi, eventName, args } as never), log.topics, "Canonical event topics");
    const values = shape.inputs.filter(item => !item.indexed); same(encodeAbiParameters(values, values.map(item => args[item.name!])), log.data, "Canonical event payload"); matches.push(args);
  }
  return matches;
}
function event(receipt: TransactionReceipt, address: Address, eventName: string, abi: Abi = moduleEngineHostAbi): Record<string, unknown> {
  const matches = events(receipt, address, eventName, abi);
  need(matches.length === 1, `Expected exactly one ${eventName} event from the released contract.`); return matches[0];
}
async function receiptBlock(client: ModuleEngineClient, release: ModuleEngineRelease, receipt: TransactionReceipt) { need(receipt.status === "success", "Receipt was not successful."); const block = await assertModuleEngineRelease({ client, release, blockNumber: receipt.blockNumber }); same(block.blockHash, receipt.blockHash, "Receipt block"); return block; }
export async function assertModuleEngineSourceReceiptV1(input: { client: ModuleEngineClient; identity: ModuleEngineReleaseIdentity; prepared: PreparedModuleEngineTransaction; receipt: TransactionReceipt }): Promise<BoundBlock> {
  const { client, prepared, receipt } = input, block = await assertModuleEngineSourceIdentityV1({ client, identity: input.identity, blockNumber: receipt.blockNumber });
  const transaction = await client.getTransaction({ hash: receipt.transactionHash });
  same(transaction.hash, receipt.transactionHash, "Receipt transaction hash"); same(transaction.from, prepared.account, "Transaction sender"); same(transaction.to, prepared.transaction.to, "Transaction target"); same(transaction.input, prepared.transaction.data, "Transaction calldata");
  same(receipt.from, transaction.from, "Receipt sender"); same(receipt.to, transaction.to, "Receipt target"); same(transaction.blockHash, receipt.blockHash, "Transaction block"); same(block.blockHash, receipt.blockHash, "Canonical receipt block");
  need(transaction.value === BigInt(prepared.transaction.value) && transaction.chainId === 4663 && transaction.blockNumber === receipt.blockNumber && receipt.blockNumber > prepared.blockNumber, "Transaction value, chain or block differs.");
  if (receipt.status === "reverted") throw new ModuleEngineTransactionRevertedError(receipt.transactionHash, receipt.blockNumber, receipt.blockHash);
  need(receipt.status === "success", "Receipt was not successful."); return block;
}
export async function verifyModuleEngineLaunchReceipt(input: { client: ModuleEngineClient; release: ModuleEngineRelease; expected: ModuleEngineLaunchRecord; receipt: TransactionReceipt }): Promise<ModuleEngineReceiptResult> {
  return verifyModuleEngineLaunchReceiptAt(input, await receiptBlock(input.client, input.release, input.receipt));
}
async function verifyModuleEngineLaunchReceiptAt(input: Omit<Parameters<typeof verifyModuleEngineLaunchReceipt>[0], "release"> & { release: ModuleEngineReleaseIdentity }, block: BoundBlock): Promise<ModuleEngineReceiptResult> {
  const actual = await boundLaunch(input.client, block, input.expected.token);
  // Resource IDs may advance between simulation and mining (for example a PositionManager NFT ID).
  // The signed plan is exact; actual resources are read from the canonical launch event and host state.
  for (const key of Object.keys(actual).filter(key => key !== "resourcesHash") as (keyof ModuleEngineLaunchRecord)[]) equal(actual[key], input.expected[key], `Launch readback ${key}`);
  const args = event(input.receipt, block.release.contracts.host.address, "EngineLaunchBound");
  for (const key of ["launchId", "token", "engine", "creator", "quoteAsset", "revisionId", "constructorHash", "initCodeHash", "configurationHash", "resourcesHash", "planHash"] as const) same(args[key], actual[key], `Engine launch event ${key}`);
  const parametersEvent = event(input.receipt, block.release.contracts.host.address, "EngineLaunchParametersBound");
  same(parametersEvent.launchId, actual.launchId, "Parameters event launch");
  const encodedParameters = moduleBytes(parametersEvent.encodedParameters, "engine.encodedParameters", 113_984);
  const [parameters] = decodeAbiParameters(moduleEngineLaunchParameters, encodedParameters);
  same(encodeAbiParameters(moduleEngineLaunchParameters, [parameters]), encodedParameters, "Canonical launch parameters");
  same(keccak256(encodeAbiParameters(moduleEnginePlanParameters, [4663n, block.release.contracts.host.address, actual.creator, parameters])), actual.planHash, "Parameters event plan hash");
  same(args.runtimeCodeHash, actual.engineCodeHash, "Engine runtime event"); same(args.economicsPolicyId, block.release.economicsPolicyId, "Engine economics event"); await canonical(input.client, block);
  const initial = isModuleEngineAnyQuoteRelease(block.release) && parameters.initialOperation.operationId !== ZERO_HASH
    ? await verifyModuleEngineOperationReceiptAt({ client: input.client, release: block.release, launch: actual, operation: parameters.initialOperation, receipt: input.receipt }, block) : null;
  return receiptResult(input.receipt, "launch", { token: actual.token, launch: actual, ...(initial ? { outputAmount: initial.outputAmount } : {}) });
}
export async function verifyModuleEngineOperationReceipt(input: { client: ModuleEngineClient; release: ModuleEngineRelease; launch: ModuleEngineLaunchRecord; operation: ModuleEngineOperation; receipt: TransactionReceipt }): Promise<ModuleEngineReceiptResult> {
  return verifyModuleEngineOperationReceiptAt(input, await receiptBlock(input.client, input.release, input.receipt));
}
async function verifyModuleEngineOperationReceiptAt(input: Omit<Parameters<typeof verifyModuleEngineOperationReceipt>[0], "release"> & { release: ModuleEngineReleaseIdentity }, block: BoundBlock): Promise<ModuleEngineReceiptResult> {
  const launch = await boundLaunch(input.client, block, input.launch.token); same(launch.launchId, input.launch.launchId, "Operation launch"); same(launch.planHash, input.launch.planHash, "Operation launch plan");
  const args = event(input.receipt, block.release.contracts.host.address, "EngineOperationExecuted"); same(args.launchId, launch.launchId, "Operation event launch");
  for (const key of ["operationId", "actor", "recipient", "inputAsset", "outputAsset"] as const) same(args[key], input.operation[key], `Operation ${key}`);
  need(args.nonce === input.operation.nonce && args.inputAmount === input.operation.inputAmount, "Operation nonce or amount differs.");
  const outputAmount = uint(args.outputAmount, "outputAmount"); need(outputAmount >= input.operation.minimumOutput, "Actual operation output is below the reviewed minimum.");
  const nonce = uint(await read(input.client, block.release.contracts.host.address, "nonces", [launch.launchId, input.operation.actor], block.blockNumber, moduleEngineHostAbi), "nonce"); need(nonce > input.operation.nonce, "Operation nonce was not consumed."); await canonical(input.client, block);
  return receiptResult(input.receipt, "execute", { token: launch.token, launch, outputAmount });
}
export async function verifyModuleEngineApprovalReceipt(input: { client: ModuleEngineClient; release: ModuleEngineRelease; account: Address; token: Address; amount: bigint; spender?: Address; allowanceKind?: "erc20" | "permit2"; permit2Spender?: Address; expiration?: bigint; receipt: TransactionReceipt }): Promise<ModuleEngineReceiptResult> {
  return verifyModuleEngineApprovalReceiptAt(input, await receiptBlock(input.client, input.release, input.receipt));
}
async function verifyModuleEngineApprovalReceiptAt(input: Omit<Parameters<typeof verifyModuleEngineApprovalReceipt>[0], "release"> & { release: ModuleEngineReleaseIdentity }, block: BoundBlock): Promise<ModuleEngineReceiptResult> {
  const spender = input.spender ?? block.release.contracts.host.address;
  if (input.allowanceKind === "permit2") {
    const value = await read(input.client, spender, "allowance", [input.account, input.token, input.permit2Spender], block.blockNumber, moduleEnginePermit2Abi) as readonly [bigint, number, number];
    need(value[0] === input.amount && BigInt(value[1]) === input.expiration, "Bounded Permit2 allowance is not visible at the receipt block.");
  } else {
    const allowance = uint(await read(input.client, input.token, "allowance", [input.account, spender], block.blockNumber), "allowance");
    need(allowance === input.amount, "Exact bounded approval is not visible at the receipt block.");
  }
  await canonical(input.client, block); return receiptResult(input.receipt, "approve", { token: input.token });
}
export async function observeModuleEngineReceipt(prepared: PreparedModuleEngineTransaction, transactionHash: Hex): Promise<ModuleEngineReceiptResult> {
  const binding = preparations.get(prepared); need(binding && binding.state === "submitted", "Engine submission has no bound preparation."); same(transactionHash, binding.hash, "Submitted transaction hash");
  const { client } = binding; need(await client.getChainId() === 4663, "Receipt RPC is on another chain.");
  const receipt = await client.waitForTransactionReceipt({ hash: transactionHash, confirmations: 1, timeout: 60_000, retryCount: 1 });
  const [transaction, block] = await Promise.all([client.getTransaction({ hash: transactionHash }), client.getBlock({ blockNumber: receipt.blockNumber })]);
  same(transaction.hash, transactionHash, "Transaction hash"); same(receipt.transactionHash, transactionHash, "Receipt hash"); same(transaction.from, prepared.account, "Transaction sender"); same(transaction.to, prepared.transaction.to, "Transaction target"); same(transaction.input, prepared.transaction.data, "Transaction calldata");
  same(receipt.from, transaction.from, "Receipt sender"); same(receipt.to, transaction.to, "Receipt target"); same(transaction.blockHash, receipt.blockHash, "Transaction block"); same(block.hash, receipt.blockHash, "Canonical receipt block");
  need(transaction.value === BigInt(prepared.transaction.value) && transaction.chainId === 4663 && transaction.blockNumber === receipt.blockNumber && block.number === receipt.blockNumber && receipt.blockNumber > prepared.blockNumber, "Transaction value, chain or block differs.");
  if (receipt.status === "reverted") throw new ModuleEngineTransactionRevertedError(transactionHash, receipt.blockNumber, receipt.blockHash);
  const result = await binding.receipt(receipt); same((await client.getBlock({ blockNumber: receipt.blockNumber })).hash, receipt.blockHash, "Canonical receipt after readback"); return result;
}

async function assertAnyQuoteRouteAccounting(client: ModuleEngineClient, block: BoundBlock, accounting: { mode: string }, unbornToken?: Address) {
  need(isModuleEngineAnyQuoteRelease(block.release), "Shared quote release required.");
  need(accounting.mode === "unlock-deltas", "This route cannot isolate the funded swap from existing router balances. Try another route.");
  if (unbornToken) {
    const deployed = await client.getCode({ address: unbornToken, blockNumber: block.blockNumber });
    need(!deployed || deployed === "0x", "This token was already launched. Open its existing coin.");
  }
}

/** The server chooses the route; the browser independently reconstructs every executable byte. */
export async function prepareModuleEngineAnyQuoteSwap(input: { client: ModuleEngineClient; release: ModuleEngineRelease; template: ModuleEngineTemplate; account: Address; quote: AnyQuoteTradeQuote }): Promise<PreparedModuleEngineSwap | ModuleEngineApprovalRequired> {
  const release = freeze(bindActiveModuleEngineRelease(input.release)), source = await prepareModuleEngineAnyQuoteSwapAt(input, await assertModuleEngineRelease({ client: input.client, release }));
  return "kind" in source ? source : bindPublicSourcePreparation(source, input.client, release);
}
export async function prepareModuleEngineSourceAnyQuoteSwapV1(input: Omit<Parameters<typeof prepareModuleEngineAnyQuoteSwap>[0], "release"> & { identity: ModuleEngineReleaseIdentity; blockNumber?: bigint }): Promise<ModuleEngineSourcePreparationV1<PreparedModuleEngineSwap> | ModuleEngineApprovalRequired> {
  return prepareModuleEngineAnyQuoteSwapAt(input, await assertModuleEngineSourceIdentityV1(input));
}
async function prepareModuleEngineAnyQuoteSwapAt(input: Omit<Parameters<typeof prepareModuleEngineAnyQuoteSwap>[0], "release">, block: BoundBlock): Promise<ModuleEngineSourcePreparationV1<PreparedModuleEngineSwap> | ModuleEngineApprovalRequired> {
  const release = block.release; need(isModuleEngineAnyQuoteRelease(release), "Shared quote release required.");
  const quote = freeze(structuredClone(input.quote)), account = moduleAddress(input.account, "account");
  const launch = await boundLaunch(input.client, block, quote.token), template = await assertTemplate(input.client, block, input.template, false);
  same(quote.releaseDigest, release.releaseDigest, "Trade release"); same(quote.account, account, "Trade wallet"); same(quote.quoteAsset, launch.quoteAsset, "Trade quote asset"); same(quote.token, launch.token, "Trade token");
  same(launch.revisionId, template.manifest.manifest.revision.packageId, "Trade revision");
  need(quote.schemaVersion === "programmable.any-quote.trade-quote.v1" && quote.templateId === template.manifest.manifest.catalogDefinition.id
    && typeof quote.buy === "boolean" && quote.evidenceHash === anyQuoteEvidenceHashV1({ ...quote, evidenceHash: undefined }), "Trade preview differs.");
  const inputAmount = uint(quote.inputAmount, "trade input", true), outputAmount = uint(quote.output, "trade output", true), minimumOutput = uint(quote.minimumOutput, "minimum output", true), expiresAt = uint(quote.validUntil, "trade expiry", true);
  need(minimumOutput === anyQuoteMinimumOutput(outputAmount, quote.slippageBps), "Trade minimum differs from the reviewed slippage.");
  same(quote.pool.token, launch.token, "Pool token"); same(quote.pool.quoteAsset, launch.quoteAsset, "Pool quote"); same(quote.pool.sharedHook, release.contracts.sharedHook.address, "Pool shared hook");
  const poolKey = anyQuoteModulePoolKeyV1(quote.pool);
  same(await read(input.client, release.contracts.host.address, "poolIdOf", [launch.launchId], block.blockNumber, moduleEngineAnyQuoteHostAbi), quote.pool.poolId, "Registered shared pool");
  const registeredKey = await read(input.client, release.contracts.sharedHook.address, "poolKey", [quote.pool.poolId], block.blockNumber, moduleEngineAnyQuoteHookAbi);
  equal(registeredKey, poolKey, "Shared hook pool key");
  const compiled = buildAnyQuoteSwapV1({ pool: quote.pool, owner: account, recipient: quote.recipient, side: quote.buy ? "buy" : "sell", amountIn: inputAmount, minimumAmountOut: minimumOutput, deadline: expiresAt, externalRoute: quote.externalRoute, now: block.timestamp });
  const approval = async (current: BoundBlock): Promise<ModuleEngineApprovalRequired | null> => {
    if (quote.buy) return null;
    const spender = ANY_QUOTE_INFRASTRUCTURE.permit2;
    await code(input.client, spender, anyQuoteChainProfile.contracts.uniswap.permit2.runtimeCodeHash as Hex, current.blockNumber);
    const [balance, tokenAllowance, allowance] = await Promise.all([read(input.client, launch.token, "balanceOf", [account], current.blockNumber), read(input.client, launch.token, "allowance", [account, spender], current.blockNumber), read(input.client, spender, "allowance", [account, launch.token, release.contracts.universalRouter.address], current.blockNumber, moduleEnginePermit2Abi)]);
    need(uint(balance, "sell balance") >= inputAmount, "Insufficient token balance for this sell.");
    const erc20Allowance = uint(tokenAllowance, "token allowance"), permitted = allowance as readonly [bigint, number, number];
    const funding = { balance: uint(balance, "sell balance"), erc20Allowance, permit2Amount: permitted[0], permit2Expiration: permitted[1], permit2Nonce: permitted[2] };
    if (erc20Allowance < inputAmount) return { kind: "approval-required", token: launch.token, spender, amount: inputAmount, currentAllowance: erc20Allowance, allowanceKind: "erc20", funding };
    if (permitted[0] < inputAmount || BigInt(permitted[1]) < expiresAt) return { kind: "approval-required", token: launch.token, spender, permit2Spender: release.contracts.universalRouter.address, amount: inputAmount, currentAllowance: permitted[0], allowanceKind: "permit2", expiration: current.timestamp + 300n, funding };
    return null;
  };
  const required = await approval(block); if (required) return required;
  await assertAnyQuoteRouteAccounting(input.client, block, compiled.balanceAccounting);
  const transaction = tx(account, compiled.transaction.to, compiled.transaction.data, BigInt(compiled.transaction.value), quote.buy ? "buy" : "sell", quote.buy ? "Buy with ETH through the pool quote asset" : "Sell to ETH through the pool quote asset");
  const simulation = await simulate(input.client, block, transaction, true), quoteDecimals = Number(await read(input.client, launch.quoteAsset, "decimals", [], block.blockNumber));
  const prepared: PreparedModuleEngineSwap = { sourceKind: "module-engine-v1", kind: "swap", account, releaseDigest: release.releaseDigest, blockNumber: block.blockNumber, expiresAt, gasEstimate: simulation.gasEstimate,
    transaction: { ...transaction, gas: toHex(simulation.gasEstimate * 12n / 10n) }, token: launch.token, quoteAsset: launch.quoteAsset, quoteDecimals, launchId: launch.launchId, revisionId: launch.revisionId, planHash: launch.planHash,
    buy: quote.buy, recipient: quote.recipient, inputAmount, outputAmount, minimumOutput, externalRoute: quote.externalRoute };
  return { prepared, refresh: async (current: BoundBlock) => {
    need(current.timestamp < expiresAt, "Trade quote expired. Get a new quote.");
    const live = await boundLaunch(input.client, current, launch.token); same(live.planHash, launch.planHash, "Trade launch plan");
    need(!await approval(current), "Sell allowance changed. Review the approval again.");
    await assertAnyQuoteRouteAccounting(input.client, current, compiled.balanceAccounting); await simulate(input.client, current, transaction, true);
  }, receipt: (receipt, current) => verifyModuleEngineAnyQuoteSwapReceiptAt({ client: input.client, release, launch, quote, minimumOutput, receipt }, current) };
}
export async function verifyModuleEngineAnyQuoteSwapReceipt(input: { client: ModuleEngineClient; release: ModuleEngineRelease; launch: ModuleEngineLaunchRecord; quote: Pick<AnyQuoteTradeQuote, "pool" | "buy" | "recipient">; minimumOutput: bigint; receipt: TransactionReceipt }): Promise<ModuleEngineReceiptResult> {
  return verifyModuleEngineAnyQuoteSwapReceiptAt(input, await receiptBlock(input.client, input.release, input.receipt));
}
async function verifyModuleEngineAnyQuoteSwapReceiptAt(input: Omit<Parameters<typeof verifyModuleEngineAnyQuoteSwapReceipt>[0], "release"> & { release: ModuleEngineReleaseIdentity }, block: BoundBlock): Promise<ModuleEngineReceiptResult> {
  const { release, launch, quote, minimumOutput, receipt } = input;
  need(isModuleEngineAnyQuoteRelease(release), "Shared quote receipt source differs.");
  const current = block, live = await boundLaunch(input.client, current, launch.token); same(live.planHash, launch.planHash, "Trade launch plan");
  const swaps = events(receipt, release.contracts.sharedHook.address, "QuotePoolSwap", moduleEngineAnyQuoteHookAbi).filter(e => e.poolId === quote.pool.poolId);
  need(swaps.length === 1, "Expected one swap in the selected module pool."); const swap = swaps[0]; same(swap.launchId, launch.launchId, "Swap launch"); same(swap.swapSender, release.contracts.universalRouter.address, "Swap router"); need(swap.buy === quote.buy && swap.exactInput === true, "Swap direction differs.");
  // Receipt success and reconstructed final router minimum prove ETH settlement. Do not invent an ETH output from token Core deltas.
  let output: bigint | undefined;
  if (quote.buy) { output = events(receipt, launch.token, "Transfer", erc20Abi).filter(e => String(e.from).toLowerCase() === release.contracts.poolManager.address.toLowerCase() && String(e.to).toLowerCase() === quote.recipient.toLowerCase()).reduce((sum, e) => sum + uint(e.value, "received tokens"), 0n); need(output >= minimumOutput, "Final token transfer is below the signed minimum."); }
  await canonical(input.client, current); return receiptResult(receipt, "swap", { token: launch.token, launch: live, ...(output === undefined ? {} : { outputAmount: output }) });
}


export function moduleEngineTradeIntent(input: { buy: boolean; token: Address; quoteAsset: Address; recipient: Address; inputAmount: bigint; minimumOutput: bigint; minimumEthFees: bigint; sqrtPriceLimitX96?: bigint; conversionRoute: Hex }): ModuleEngineOperationIntent {
  need(input.inputAmount > 0n && input.minimumOutput > 0n && input.minimumEthFees > 0n, "Set positive trade input, output and ETH fee conversion limits.");
  const sqrtPriceLimitX96 = input.sqrtPriceLimitX96 ?? 0n; need(sqrtPriceLimitX96 >= 0n && sqrtPriceLimitX96 < 1n << 160n, "Invalid pool price limit.");
  return { operationId: input.buy ? ENGINE_OPERATIONS.buy : ENGINE_OPERATIONS.sell, recipient: input.recipient, inputAsset: input.buy ? input.quoteAsset : input.token, inputAmount: input.inputAmount, outputAsset: input.buy ? input.token : input.quoteAsset, minimumOutput: input.minimumOutput, data: encodeAbiParameters(moduleEngineTradeLimitsParameters, [{ minimumEthFees: input.minimumEthFees, sqrtPriceLimitX96, conversionRoute: moduleBytes(input.conversionRoute, "conversion route", 1024) }]) };
}
/** Uses actual Host.execute eth_call output and actual converted ETH, after exact funding approval. No external price is assumed. */
export async function quoteModuleEngineTrade(input: Parameters<typeof prepareModuleEngineOperation>[0] & { slippageBps?: number }) {
  const slippage = input.slippageBps ?? 100; need(Number.isInteger(slippage) && slippage >= 0 && slippage <= 1000, "Use 0–10% slippage.");
  need(input.template.manifest.manifest.catalogDefinition.interface === "quote-v1" && [ENGINE_OPERATIONS.buy, ENGINE_OPERATIONS.sell].includes(input.intent.operationId), "Template does not describe a spot trade.");
  const prepared = await prepareModuleEngineOperation(input); if (prepared.kind === "approval-required") return prepared;
  const [output, grossQuote, tokenAmount, platformEth, creatorEth] = decodeAbiParameters(parseAbiParameters("uint256,uint256,uint256,uint256,uint256"), prepared.result);
  const minimumOutput = output * BigInt(10_000 - slippage) / 10_000n, minimumEthFees = (platformEth + creatorEth) * BigInt(10_000 - slippage) / 10_000n;
  need(minimumOutput > 0n && minimumEthFees > 0n, "Quoted output or ETH fee amount is too small.");
  const [limits] = decodeAbiParameters(moduleEngineTradeLimitsParameters, input.intent.data);
  const intent = { ...input.intent, minimumOutput, data: encodeAbiParameters(moduleEngineTradeLimitsParameters, [{ ...limits, minimumEthFees }]) };
  const bounded = await prepareModuleEngineOperation({ ...input, intent });
  return { kind: "trade-quote" as const, output, grossQuote, tokenAmount, platformEth, creatorEth, minimumOutput, minimumEthFees, prepared: bounded };
}

export interface ModuleEngineSettlementRequest { requestId: Hex; payer: Address; beneficiary: Address; amount: bigint; refundAfter: bigint; obligationHash: Hex; status: 1 | 2 | 3 }
export interface ModuleEngineAdministration {
  launch: ModuleEngineLaunchRecord; blockNumber: bigint; timestamp: bigint; quoteDecimals: number; actor: Address;
  permissions: readonly ModuleEnginePermission[];
  escrow?: { credit: bigint; unlockTime: bigint; totalLiability: bigint };
  settlement?: { minimumWindow: bigint; maximumWindow: bigint; totalLiability: bigint; request: ModuleEngineSettlementRequest | null; canFulfill: boolean; canRefund: boolean };
  fees: { feeAsset?: Address; feeDecimals?: number; claimable: bigint; claimed: bigint; contributionByLaunch: bigint; treasury: Address; administrator: Address; creatorWallets: Address[]; creatorSharesBps: number[]; adminRevision: bigint; buyPlatformBps: number; sellPlatformBps: number; buyCreatorBps: number; sellCreatorBps: number };
}
/** The displayed admin powers come from the bound contract and actor; catalog labels grant no powers. */
export async function readModuleEngineAdministration(input: { client: ModuleEngineClient; release: ModuleEngineRelease; template: ModuleEngineTemplate; token: Address; account: Address; requestId?: Hex }): Promise<ModuleEngineAdministration> {
  const block = await assertModuleEngineRelease(input), launch = await boundLaunch(input.client, block, input.token), template = await assertTemplate(input.client, block, input.template, false), actor = moduleAddress(input.account, "account");
  same(launch.revisionId, template.manifest.manifest.revision.packageId, "Administration template");
  const quoteFees = isModuleEngineAnyQuoteRelease(block.release), ledger = block.release.contracts.ledger.address, ledgerRead = (fn: string, args: readonly unknown[]) => read(input.client, ledger, fn, args, block.blockNumber, ledgerAbi(block.release));
  const platform = quoteFees ? ledgerRead("platformFeeBps", [launch.launchId]) : null;
  const [claimable, claimed, contributed, treasury, administrator, recipients, quoteDecimals, buy, sell] = await Promise.all([
    ledgerRead(quoteFees ? "claimableQuote" : "claimable", quoteFees ? [launch.quoteAsset, actor] : [actor]), ledgerRead("claimedBy", quoteFees ? [launch.quoteAsset, actor] : [actor]), ledgerRead(quoteFees ? "contributionByLaunch" : "contributionByPool", [launch.launchId, actor]), ledgerRead("treasury", []), ledgerRead("rewardAdmin", []), ledgerRead("creatorRecipients", [launch.launchId]), read(input.client, launch.quoteAsset, "decimals", [], block.blockNumber),
    platform ? platform.then(bps => [bps, launch.buyCreatorFeeBps]) : read(input.client, block.release.contracts.host.address, "feeTerms", [launch.launchId, true], block.blockNumber, moduleEngineHostAbi), platform ? platform.then(bps => [bps, launch.sellCreatorFeeBps]) : read(input.client, block.release.contracts.host.address, "feeTerms", [launch.launchId, false], block.blockNumber, moduleEngineHostAbi),
  ]);
  const [wallets, shares, adminRevision] = recipients as [Address[], number[], bigint], buyFees = buy as [number, number], sellFees = sell as [number, number];
  need((quoteFees ? buyFees[0] === 30 : [10, 30].includes(buyFees[0])) && buyFees[0] === sellFees[0] && buyFees[1] === launch.buyCreatorFeeBps && sellFees[1] === launch.sellCreatorFeeBps, "Stored fee terms differ.");
  const result: ModuleEngineAdministration = { launch, blockNumber: block.blockNumber, timestamp: block.timestamp, quoteDecimals: Number(quoteDecimals), actor, permissions: template.manifest.manifest.revision.operationPermissions,
    fees: { ...(quoteFees ? { feeAsset: launch.quoteAsset, feeDecimals: Number(quoteDecimals) } : {}), claimable: uint(claimable, "claimable"), claimed: uint(claimed, "claimed"), contributionByLaunch: uint(contributed, "contribution"), treasury: moduleAddress(treasury, "treasury"), administrator: moduleAddress(administrator, "administrator"), creatorWallets: wallets.map(wallet => moduleAddress(wallet, "creator recipient")), creatorSharesBps: shares, adminRevision: uint(adminRevision, "admin revision"), buyPlatformBps: buyFees[0], sellPlatformBps: sellFees[0], buyCreatorBps: buyFees[1], sellCreatorBps: sellFees[1] } };
  const engineRead = (fn: string, args: readonly unknown[] = []) => read(input.client, launch.engine, fn, args, block.blockNumber);
  const profile = template.manifest.manifest.catalogDefinition.interface;
  if (profile === "escrow-v1") {
    const [credit, unlockTime, totalLiability] = await Promise.all([engineRead("credit", [actor]), engineRead("unlockTime"), engineRead("totalLiability")]);
    result.escrow = { credit: uint(credit, "credit"), unlockTime: uint(unlockTime, "unlock time"), totalLiability: uint(totalLiability, "total liability") };
  }
  if (profile === "settlement-v1") {
    const [minimumWindow, maximumWindow, totalLiability, requestValue] = await Promise.all([engineRead("minimumWindow"), engineRead("maximumWindow"), engineRead("totalLiability"), input.requestId ? engineRead("requests", [moduleHash(input.requestId, "requestId")]) : null]);
    let request: ModuleEngineSettlementRequest | null = null;
    if (requestValue) { const [payer, beneficiary, amount, refundAfter, obligationHash, status] = requestValue as [Address, Address, bigint, bigint, Hex, number]; need([1, 2, 3].includes(status), "This request does not exist in the bound engine."); request = { requestId: input.requestId!, payer: moduleAddress(payer, "payer"), beneficiary: moduleAddress(beneficiary, "beneficiary"), amount: uint(amount, "request amount", true), refundAfter: uint(refundAfter, "refund time", true), obligationHash: moduleHash(obligationHash, "obligation hash"), status: status as 1 | 2 | 3 }; }
    const allowed = (operationId: Hex) => result.permissions.some(p => p.operationId === operationId && (p.authorization === 0 || actor === launch.creator));
    result.settlement = { minimumWindow: uint(minimumWindow, "minimum window", true), maximumWindow: uint(maximumWindow, "maximum window", true), totalLiability: uint(totalLiability, "total liability"), request,
      canFulfill: Boolean(request && request.status === 1 && actor === launch.creator && block.timestamp < request.refundAfter && allowed(ENGINE_OPERATIONS.fulfill)),
      canRefund: Boolean(request && request.status === 1 && actor === request.payer && block.timestamp >= request.refundAfter && allowed(ENGINE_OPERATIONS.refund)) };
  }
  await canonical(input.client, block); return result;
}
export function moduleEngineDepositIntent(quoteAsset: Address, actor: Address, amount: bigint): ModuleEngineOperationIntent { need(amount > 0n, "Enter a positive deposit."); return { operationId: ENGINE_OPERATIONS.deposit, recipient: actor, inputAsset: quoteAsset, inputAmount: amount, outputAsset: ZERO, minimumOutput: 0n, data: "0x" }; }
export interface ModuleEngineFeeControlsSnapshot {
  releaseDigest: Hex; launch: ModuleEngineLaunchRecord; actor: Address; blockNumber: bigint;
  creatorWallets: readonly Address[]; creatorSharesBps: readonly number[]; adminRevision: bigint;
  treasury: Address; administrator: Address; quoteFees?: boolean;
  authors: readonly { familyId: Hex; author: Address; wallet: Address }[];
}
function creatorRecipients(value: unknown) {
  need(Array.isArray(value) && value.length === 3, "Invalid creator recipients.");
  const [wallets, shares, revision] = value;
  need(Array.isArray(wallets) && wallets.length >= 1 && wallets.length <= 10 && Array.isArray(shares) && shares.length === wallets.length, "Invalid creator recipient count.");
  need(shares.every(share => Number.isInteger(share) && share > 0 && share <= 10_000) && shares.reduce((sum, share) => sum + share, 0) === 10_000, "Invalid fixed creator shares.");
  return { creatorWallets: wallets.map(wallet => moduleAddress(wallet, "creator wallet")), creatorSharesBps: shares as number[], adminRevision: uint(revision, "admin revision") };
}
async function feeFamilies(client: ModuleEngineClient, block: BoundBlock, launch: ModuleEngineLaunchRecord): Promise<Hex[]> {
  const value = await read(client, block.release.contracts.host.address, "getRevision", [launch.revisionId], block.blockNumber, moduleEngineHostAbi);
  need(Array.isArray(value) && value.length === 4 && Array.isArray(value[3]) && value[3].length <= 8, "Invalid fee family binding.");
  return [...new Set([moduleHash(value[0]?.familyId, "revision family"), ...value[3].map(family => moduleHash(family, "eligible family"))])];
}
async function feeControlsAt(input: { client: ModuleEngineClient; template: ModuleEngineTemplate; token: Address; account: Address }, block: BoundBlock): Promise<ModuleEngineFeeControlsSnapshot> {
  const launch = await boundLaunch(input.client, block, input.token), template = await assertTemplate(input.client, block, input.template, false);
  same(launch.revisionId, template.manifest.manifest.revision.packageId, "Fee controls revision");
  const families = isModuleEngineAnyQuoteRelease(block.release) ? [] : await feeFamilies(input.client, block, launch), ledger = block.release.contracts.ledger.address;
  const [recipients, treasury, administrator, authors] = await Promise.all([
    read(input.client, ledger, "creatorRecipients", [launch.launchId], block.blockNumber, ledgerAbi(block.release)),
    read(input.client, ledger, "treasury", [], block.blockNumber, ledgerAbi(block.release)),
    read(input.client, ledger, "rewardAdmin", [], block.blockNumber, ledgerAbi(block.release)),
    Promise.all(families.map(async familyId => {
      const value = await read(input.client, block.release.contracts.registry.address, "families", [familyId], block.blockNumber, moduleEngineAuthorWalletAbi);
      need(Array.isArray(value) && value.length === 2, "Invalid registered author.");
      return { familyId, author: moduleAddress(value[0], "registered author"), wallet: moduleAddress(value[1], "author fee wallet") };
    })),
  ]);
  return { releaseDigest: block.release.releaseDigest, launch, actor: moduleAddress(input.account, "account"), blockNumber: block.blockNumber,
    ...creatorRecipients(recipients), quoteFees: isModuleEngineAnyQuoteRelease(block.release), treasury: moduleAddress(treasury, "treasury"), administrator: moduleAddress(administrator, "administrator"), authors };
}
export async function readModuleEngineFeeControls(input: { client: ModuleEngineClient; release: ModuleEngineRelease; template: ModuleEngineTemplate; token: Address; account: Address }): Promise<ModuleEngineFeeControlsSnapshot> {
  const block = await assertModuleEngineRelease(input), result = await feeControlsAt(input, block);
  await canonical(input.client, block); return freeze(result);
}
function feeChangeFromIntent(intent: ModuleEngineFeeChangeIntent, snapshot: ModuleEngineFeeControlsSnapshot, expiresAt: bigint): ModuleEngineFeeChange {
  if (intent.kind === "rotate-platform") {
    moduleRecord(intent, ["kind", "recipient"], "platform fee change"); need(snapshot.quoteFees, "Platform rotation requires the quote-fee profile.");
    const authority = snapshot.actor === snapshot.treasury ? "treasury" : "reward-admin";
    same(snapshot.actor, authority === "treasury" ? snapshot.treasury : snapshot.administrator, "Platform recipient authority");
    const recipient = moduleAddress(intent.recipient, "new platform wallet"); need(recipient !== snapshot.treasury, "Choose a different fee wallet.");
    return { kind: intent.kind, previousWallet: snapshot.treasury, recipient, authority };
  }
  if (intent.kind === "rotate-creator") {
    moduleRecord(intent, ["kind", "index", "recipient"], "fee change");
    need(Number.isInteger(intent.index) && intent.index >= 0 && intent.index < snapshot.creatorWallets.length, "Invalid creator slot.");
    const previousWallet = snapshot.creatorWallets[intent.index], recipient = moduleAddress(intent.recipient, "new creator wallet");
    same(previousWallet, snapshot.actor, "Current creator recipient authority"); need(recipient !== previousWallet, "Choose a different fee wallet.");
    return { kind: intent.kind, index: intent.index, previousWallet, recipient, shareBps: snapshot.creatorSharesBps[intent.index] };
  }
  if (intent.kind === "replace-creators") {
    moduleRecord(intent, ["kind", "recipients"], "fee change");
    const authority = snapshot.actor === snapshot.treasury ? "treasury" : "reward-admin";
    same(snapshot.actor, authority === "treasury" ? snapshot.treasury : snapshot.administrator, "Creator recipient administrator");
    need(Array.isArray(intent.recipients) && intent.recipients.length === snapshot.creatorWallets.length, "Preserve every fixed creator share.");
    return { kind: intent.kind, previousWallets: [...snapshot.creatorWallets], recipients: intent.recipients.map(wallet => moduleAddress(wallet, "new creator wallet")), sharesBps: [...snapshot.creatorSharesBps], expectedAdminRevision: snapshot.adminRevision, deadline: expiresAt, authority };
  }
  need(intent.kind === "rotate-author", "Unsupported fee change.");
  moduleRecord(intent, ["kind", "familyId", "recipient"], "fee change");
  const familyId = moduleHash(intent.familyId, "family"), author = snapshot.authors.find(item => item.familyId === familyId);
  need(author, "This family does not belong to the bound coin revision."); same(author.author, snapshot.actor, "Registered author authority");
  const recipient = moduleAddress(intent.recipient, "new author fee wallet"); need(recipient !== author.wallet, "Choose a different fee wallet.");
  return { kind: intent.kind, familyId, author: author.author, previousWallet: author.wallet, recipient };
}
/** Each recipient change uses the same private preparation and wallet lifecycle as launch and claims. */
export async function prepareModuleEngineFeeChange(input: { client: ModuleEngineClient; release: ModuleEngineRelease; template: ModuleEngineTemplate; token: Address; account: Address; intent: ModuleEngineFeeChangeIntent }): Promise<PreparedModuleEngineFeeChange> {
  const release = freeze(bindActiveModuleEngineRelease(input.release)), template = freeze(bindModuleEngineTemplate(input.template, release));
  const account = moduleAddress(input.account, "account"), token = moduleAddress(input.token, "token"), block = await assertModuleEngineRelease({ client: input.client, release });
  const snapshot = await feeControlsAt({ client: input.client, template, token, account }, block), expiresAt = deadline(block.timestamp);
  const change = feeChangeFromIntent(input.intent, snapshot, expiresAt), launch = snapshot.launch;
  const target = change.kind === "rotate-author" ? release.contracts.registry.address : release.contracts.ledger.address;
  let data: Hex;
  if (change.kind === "rotate-platform") data = encodeFunctionData({ abi: moduleEngineAnyQuoteLedgerAbi, functionName: "changePlatformWallet", args: [change.recipient] });
  else if (change.kind === "rotate-creator") data = encodeFunctionData({ abi: ledgerAbi(block.release), functionName: "changeCreatorWallet", args: [launch.launchId, BigInt(change.index), change.recipient] });
  else if (change.kind === "replace-creators") data = encodeFunctionData({ abi: ledgerAbi(block.release), functionName: "replaceCreatorWallets", args: [launch.launchId, [...change.recipients], change.expectedAdminRevision, change.deadline] });
  else data = encodeFunctionData({ abi: moduleEngineAuthorWalletAbi, functionName: "changeAuthorWallet", args: [change.familyId, change.recipient] });
  const transaction = tx(account, target, data, 0n, "manage", change.kind === "rotate-platform" ? "Change the future 0.3% platform fee recipient; accrued quote claims stay with their current wallets" : change.kind === "rotate-author" ? "Change your family's future author fee wallet; accrued claims stay with their current wallets" : "Change future creator fee recipients; fixed shares and accrued claims stay unchanged");
  const simulation = await simulate(input.client, block, transaction, true);
  const prepared: PreparedModuleEngineFeeChange = { ...change, sourceKind: "module-engine-v1", account, releaseDigest: release.releaseDigest, blockNumber: block.blockNumber,
    expiresAt, gasEstimate: simulation.gasEstimate, transaction: { ...transaction, gas: toHex(simulation.gasEstimate * 12n / 10n) }, token: launch.token, launchId: launch.launchId, revisionId: launch.revisionId, planHash: launch.planHash };
  // Snapshot-derived intent is immutable; UI edits can never change the pending request.
  const intent: ModuleEngineFeeChangeIntent = change.kind === "rotate-platform" ? { kind: change.kind, recipient: change.recipient } : change.kind === "rotate-creator" ? { kind: change.kind, index: change.index, recipient: change.recipient }
    : change.kind === "replace-creators" ? { kind: change.kind, recipients: [...change.recipients] }
    : { kind: change.kind, familyId: change.familyId, recipient: change.recipient };
  return bind(prepared, { client: input.client, release, refresh: async () => {
    const current = await assertModuleEngineRelease({ client: input.client, release }); need(current.timestamp <= expiresAt, "Fee change preview expired. Review again.");
    const live = await feeControlsAt({ client: input.client, template, token, account }, current);
    same(live.launch.planHash, launch.planHash, "Fee change launch plan"); same(live.launch.launchId, launch.launchId, "Fee change launch");
    const refreshed = feeChangeFromIntent(intent, live, expiresAt);
    const serializable = (value: ModuleEngineFeeChange) => value.kind === "replace-creators" ? { ...value, expectedAdminRevision: value.expectedAdminRevision.toString(), deadline: value.deadline.toString() } : value;
    equal(serializable(refreshed), serializable(change), "Recipients, fixed shares or authority changed. Review again");
    await simulate(input.client, current, transaction, true);
  }, receipt: receipt => verifyModuleEngineFeeChangeReceipt({ client: input.client, release, launch, account, change, receipt }) });
}
function normalizedCreatorEvent(args: Record<string, unknown>, release: ModuleEngineRelease): Record<string, unknown> {
  return isModuleEngineAnyQuoteRelease(release) ? { ...args, poolId: args.launchId, previousWallet: args.previous, newWallet: args.current,
    adminRevision: args.revision, effectiveCreatorFeesReceived: args.effectiveCreatorReceived } : args;
}
/** Receipt events prove this transaction; later same-block rotations are reported without inventing a failed send. */
export async function verifyModuleEngineFeeChangeReceipt(input: { client: ModuleEngineClient; release: ModuleEngineRelease; launch: ModuleEngineLaunchRecord; account: Address; change: ModuleEngineFeeChange; receipt: TransactionReceipt }): Promise<ModuleEngineReceiptResult> {
  const block = await receiptBlock(input.client, input.release, input.receipt), launch = await boundLaunch(input.client, block, input.launch.token);
  same(launch.launchId, input.launch.launchId, "Fee change launch"); same(launch.revisionId, input.launch.revisionId, "Fee change revision"); same(launch.planHash, input.launch.planHash, "Fee change plan");
  const change = input.change, account = moduleAddress(input.account, "account"), ledger = block.release.contracts.ledger.address;
  const result: NonNullable<ModuleEngineReceiptResult["feeChange"]> = { changes: [], previewChanged: false, subsequentlyChanged: false };
  if (change.kind === "rotate-platform") {
    need(isModuleEngineAnyQuoteRelease(block.release), "Platform rotation source differs.");
    same(input.receipt.to, ledger, "Platform ledger"); same(input.receipt.from, account, "Platform transaction wallet");
    const args = event(input.receipt, ledger, "PlatformWalletChanged", moduleEngineAnyQuoteLedgerAbi);
    same(args.administrator, account, "Platform rotation authority"); same(args.previous, change.previousWallet, "Previous platform wallet"); same(args.current, change.recipient, "New platform wallet");
    const current = moduleAddress(await read(input.client, ledger, "treasury", [], block.blockNumber, moduleEngineAnyQuoteLedgerAbi), "current platform wallet");
    result.changes = [{ previousWallet: change.previousWallet, recipient: change.recipient }]; result.subsequentlyChanged = current !== change.recipient;
  } else if (change.kind === "rotate-author") {
    const registry = block.release.contracts.registry.address; same(input.receipt.to, registry, "Author registry"); same(input.receipt.from, account, "Author transaction wallet");
    need((await feeFamilies(input.client, block, launch)).includes(change.familyId), "Author family differs from the bound launch revision.");
    const args = event(input.receipt, registry, "AuthorWalletChanged", moduleEngineAuthorWalletAbi);
    same(args.familyId, change.familyId, "Author family"); same(args.wallet, change.recipient, "New author fee wallet");
    const value = await read(input.client, registry, "families", [change.familyId], block.blockNumber, moduleEngineAuthorWalletAbi);
    need(Array.isArray(value) && value.length === 2, "Invalid author readback"); same(value[0], account, "Registered author"); same(value[0], change.author, "Reviewed author");
    const previousWallet = moduleAddress(args.previousWallet, "Previous author fee wallet"), currentWallet = moduleAddress(value[1], "Current author fee wallet");
    result.changes = [{ familyId: change.familyId, previousWallet, recipient: change.recipient }]; result.previewChanged = previousWallet !== change.previousWallet; result.subsequentlyChanged = currentWallet !== change.recipient;
  } else {
    same(input.receipt.to, ledger, "Creator ledger"); same(input.receipt.from, account, "Creator transaction wallet");
    const current = creatorRecipients(await read(input.client, ledger, "creatorRecipients", [launch.launchId], block.blockNumber, ledgerAbi(block.release)));
    if (change.kind === "rotate-creator") {
      const args = normalizedCreatorEvent(event(input.receipt, ledger, "CreatorWalletChanged", ledgerAbi(block.release)), block.release);
      same(args.poolId, launch.launchId, "Creator launch"); need(args.index === BigInt(change.index), "Creator slot differs."); same(args.previousWallet, account, "Creator self rotation"); same(args.previousWallet, change.previousWallet, "Old creator wallet"); same(args.newWallet, change.recipient, "New creator wallet");
      need(current.creatorSharesBps[change.index] === change.shareBps, "Fixed creator share changed.");
      result.changes = [{ index: change.index, previousWallet: change.previousWallet, recipient: change.recipient }]; result.subsequentlyChanged = current.creatorWallets[change.index] !== change.recipient;
    } else {
      const args = normalizedCreatorEvent(event(input.receipt, ledger, "CreatorRecipientsReplaced", ledgerAbi(block.release)), block.release);
      same(args.poolId, launch.launchId, "Creator launch"); same(args.administrator, account, "Creator administrator");
      need(args.adminRevision === change.expectedAdminRevision + 1n && current.adminRevision >= change.expectedAdminRevision + 1n, "Administrative revision was not advanced.");
      need(Array.isArray(args.wallets), "Invalid confirmed creator recipients.");
      equal(args.wallets.map(wallet => moduleAddress(wallet, "confirmed creator wallet")), change.recipients, "Confirmed creator recipients"); equal(current.creatorSharesBps, change.sharesBps, "Fixed creator shares");
      const authority = await read(input.client, ledger, change.authority === "treasury" ? "treasury" : "rewardAdmin", [], block.blockNumber, ledgerAbi(block.release)); same(authority, account, "Administrative authority");
      const changes = events(input.receipt, ledger, "CreatorWalletChanged", ledgerAbi(block.release)).map(item => normalizedCreatorEvent(item, block.release)), previous = [...change.recipients], seen = new Set<number>();
      for (const item of changes) {
        same(item.poolId, launch.launchId, "Changed creator launch"); const index = Number(uint(item.index, "creator index"));
        need(Number.isSafeInteger(index) && index < previous.length && !seen.has(index), "Duplicate or invalid creator change event."); seen.add(index);
        same(item.newWallet, change.recipients[index], "Confirmed creator slot"); need(item.effectiveCreatorFeesReceived === args.effectiveCreatorFeesReceived, "Creator accrual boundary differs.");
        previous[index] = moduleAddress(item.previousWallet, "Previous creator wallet"); need(previous[index] !== change.recipients[index], "Invalid unchanged creator event.");
      }
      result.changes = previous.map((previousWallet, index) => ({ index, previousWallet, recipient: change.recipients[index] }));
      result.previewChanged = previous.some((wallet, index) => wallet !== change.previousWallets[index]);
      result.subsequentlyChanged = current.creatorWallets.some((wallet, index) => wallet !== change.recipients[index]);
    }
  }
  await canonical(input.client, block); return receiptResult(input.receipt, change.kind, { token: launch.token, launch, feeChange: result });
}
export function moduleEngineWithdrawalIntent(quoteAsset: Address, recipient: Address, amount: bigint): ModuleEngineOperationIntent { need(amount > 0n, "Enter a positive withdrawal."); return { operationId: ENGINE_OPERATIONS.withdraw, recipient, inputAsset: ZERO, inputAmount: 0n, outputAsset: quoteAsset, minimumOutput: amount, data: encodeAbiParameters(parseAbiParameters("uint256"), [amount]) }; }
export function moduleEngineSettlementRequestIntent(input: { quoteAsset: Address; actor: Address; beneficiary: Address; amount: bigint; refundAfter: bigint; obligationHash: Hex }): ModuleEngineOperationIntent {
  need(input.amount > 0n, "Enter a positive funded amount."); return { operationId: ENGINE_OPERATIONS.request, recipient: input.actor, inputAsset: input.quoteAsset, inputAmount: input.amount, outputAsset: ZERO, minimumOutput: 0n, data: encodeAbiParameters(parseAbiParameters("address,uint256,bytes32"), [moduleAddress(input.beneficiary, "beneficiary"), input.refundAfter, moduleHash(input.obligationHash, "obligationHash")]) };
}
export function moduleEngineSettlementPaymentIntent(input: { quoteAsset: Address; request: ModuleEngineSettlementRequest; kind: "fulfill" | "refund"; evidenceHash?: Hex }): ModuleEngineOperationIntent {
  need(input.request.status === 1, "This request is already closed."); return { operationId: ENGINE_OPERATIONS[input.kind], recipient: input.kind === "fulfill" ? input.request.beneficiary : input.request.payer, inputAsset: ZERO, inputAmount: 0n, outputAsset: input.quoteAsset, minimumOutput: input.request.amount,
    data: input.kind === "fulfill" ? encodeAbiParameters(parseAbiParameters("bytes32,bytes32"), [input.request.requestId, moduleHash(input.evidenceHash, "evidenceHash")]) : encodeAbiParameters(parseAbiParameters("bytes32"), [input.request.requestId]) };
}
export async function prepareModuleEngineClaim(input: { client: ModuleEngineClient; release: ModuleEngineRelease; token: Address; account: Address; recipient: Address }): Promise<PreparedModuleEngineClaim> {
  const release = freeze(bindActiveModuleEngineRelease(input.release));
  return bindPublicSourcePreparation(await prepareModuleEngineClaimAt(input, await assertModuleEngineRelease({ client: input.client, release })), input.client, release);
}
export async function prepareModuleEngineSourceClaimV1(input: Omit<Parameters<typeof prepareModuleEngineClaim>[0], "release"> & { identity: ModuleEngineReleaseIdentity; blockNumber?: bigint }): Promise<ModuleEngineSourcePreparationV1<PreparedModuleEngineClaim>> {
  return prepareModuleEngineClaimAt(input, await assertModuleEngineSourceIdentityV1(input));
}
async function prepareModuleEngineClaimAt(input: Omit<Parameters<typeof prepareModuleEngineClaim>[0], "release">, block: BoundBlock): Promise<ModuleEngineSourcePreparationV1<PreparedModuleEngineClaim>> {
  const release = block.release, launch = await boundLaunch(input.client, block, input.token), account = moduleAddress(input.account, "account"), recipient = moduleAddress(input.recipient, "claim recipient"), ledger = release.contracts.ledger.address;
  const quoteFees = isModuleEngineAnyQuoteRelease(release), abi = ledgerAbi(release), claimFunction = quoteFees ? "claimQuoteTo" : "claimTo", balanceFunction = quoteFees ? "claimableQuote" : "claimable";
  const balanceArgs = quoteFees ? [launch.quoteAsset, account] : [account];
  need(recipient !== ledger, "Choose an external claim recipient.");
  const [claimable, alreadyClaimed, decimals] = await Promise.all([read(input.client, ledger, balanceFunction, balanceArgs, block.blockNumber, abi), read(input.client, ledger, "claimedBy", balanceArgs, block.blockNumber, abi), quoteFees ? read(input.client, launch.quoteAsset, "decimals", [], block.blockNumber) : 18]);
  const minimumAmount = uint(claimable, "claimable fees", true), claimedBefore = uint(alreadyClaimed, "claimed fees"), expiresAt = deadline(block.timestamp);
  const transaction = tx(account, ledger, encodeFunctionData({ abi, functionName: claimFunction, args: quoteFees ? [launch.quoteAsset, recipient] : [recipient] }), 0n, "manage", quoteFees ? "Claim your accrued fees in the pool quote asset" : "Claim your accrued engine fees in ETH");
  const simulated = await simulate(input.client, block, transaction); need(decodeFunctionResult({ abi, functionName: claimFunction, data: simulated.data }) === minimumAmount, "Claim simulation differs from the ledger balance.");
  const prepared: PreparedModuleEngineClaim = { sourceKind: "module-engine-v1", kind: "claim", account, releaseDigest: release.releaseDigest, blockNumber: block.blockNumber, expiresAt, gasEstimate: simulated.gasEstimate, transaction: { ...transaction, gas: toHex(simulated.gasEstimate * 12n / 10n) }, token: launch.token, launchId: launch.launchId, revisionId: launch.revisionId, planHash: launch.planHash, recipient, minimumAmount, claimedBefore, ...(quoteFees ? { feeAsset: launch.quoteAsset, feeDecimals: Number(decimals) } : {}) };
  return { prepared, refresh: async (current: BoundBlock) => { need(current.timestamp <= expiresAt, "Claim preview expired."); const live = await boundLaunch(input.client, current, launch.token); same(live.planHash, launch.planHash, "Claim launch plan"); const currentClaimable = uint(await read(input.client, ledger, balanceFunction, balanceArgs, current.blockNumber, abi), "claimable fees"); need(currentClaimable >= minimumAmount, "Fee balance changed. Review the claim again."); await simulate(input.client, current, transaction); }, receipt: (receipt, current) => verifyModuleEngineClaimReceiptAt({ client: input.client, release, launch, account, recipient, minimumAmount, claimedBefore, receipt }, current) };
}
export async function verifyModuleEngineClaimReceipt(input: { client: ModuleEngineClient; release: ModuleEngineRelease; launch: ModuleEngineLaunchRecord; account: Address; recipient: Address; minimumAmount: bigint; claimedBefore: bigint; receipt: TransactionReceipt }): Promise<ModuleEngineReceiptResult> {
  return verifyModuleEngineClaimReceiptAt(input, await receiptBlock(input.client, input.release, input.receipt));
}
async function verifyModuleEngineClaimReceiptAt(input: Omit<Parameters<typeof verifyModuleEngineClaimReceipt>[0], "release"> & { release: ModuleEngineReleaseIdentity }, block: BoundBlock): Promise<ModuleEngineReceiptResult> {
  const launch = await boundLaunch(input.client, block, input.launch.token); same(launch.planHash, input.launch.planHash, "Claim launch plan");
  const quoteFees = isModuleEngineAnyQuoteRelease(block.release), abi = ledgerAbi(block.release);
  const args = event(input.receipt, block.release.contracts.ledger.address, quoteFees ? "QuoteFeesClaimed" : "FeesClaimed", abi); same(args.beneficiary, input.account, "Claim beneficiary");
  if (quoteFees) same(args.asset, launch.quoteAsset, "Claim quote asset"); else same(args.caller, input.account, "Claim caller");
  same(args.recipient, input.recipient, "Claim recipient"); const outputAmount = uint(args.amount, "claimed amount", true); need(outputAmount >= input.minimumAmount, "Claim is below the reviewed balance.");
  if (quoteFees) {
    const transfers = events(input.receipt, launch.quoteAsset, "Transfer", erc20Abi);
    need(transfers.length === 1, "Expected one exact quote claim transfer.");
    same(transfers[0].from, block.release.contracts.poolManager.address, "Claim transfer source"); same(transfers[0].to, input.recipient, "Claim transfer recipient");
    need(uint(transfers[0].value, "quote claim transfer", true) === outputAmount, "Claim transfer differs from the ledger amount.");
  }
  const claimed = uint(await read(input.client, block.release.contracts.ledger.address, "claimedBy", quoteFees ? [launch.quoteAsset, input.account] : [input.account], block.blockNumber, abi), "claimed total"); need(claimed >= input.claimedBefore + outputAmount, "Claimed ledger total was not updated."); await canonical(input.client, block); return receiptResult(input.receipt, "claim", { token: launch.token, launch, outputAmount });
}

/** Only actual converter/factory pools are offered. Multihop routes can also be supplied to the bounded trade API. */
export async function readModuleEngineQuoteAsset(input: { client: ModuleEngineClient; release: ModuleEngineRelease; template: ModuleEngineTemplate; quoteAsset: Address; account: Address; existingToken?: Address }) {
  const block = await assertModuleEngineRelease(input), template = await assertTemplate(input.client, block, input.template, !input.existingToken), quoteAsset = moduleAddress(input.quoteAsset, "quoteAsset");
  if (input.existingToken) { const launch = await boundLaunch(input.client, block, input.existingToken); same(launch.quoteAsset, quoteAsset, "Launch quote asset"); same(launch.revisionId, template.manifest.manifest.revision.packageId, "Launch quote template"); }
  const { catalogDefinition: definition, revision } = template.manifest.manifest;
  if (revision.fixedQuoteAsset !== ZERO) same(quoteAsset, revision.fixedQuoteAsset, "Fixed quote asset");
  const [quoteCode, rawDecimals, rawBalance] = await Promise.all([input.client.getCode({ address: quoteAsset, blockNumber: block.blockNumber }), read(input.client, quoteAsset, "decimals", [], block.blockNumber), read(input.client, quoteAsset, "balanceOf", [input.account], block.blockNumber)]);
  need(quoteCode && quoteCode !== "0x", "Quote token is not deployed."); const decimals = Number(rawDecimals); need(Number.isInteger(decimals) && decimals >= 0 && decimals <= 18, "Quote decimals are unsupported.");
  const routes: { label: string; data: Hex }[] = [];
  if (definition.interface === "quote-v1") {
    const config = compileOpenConfig(definition.schema, definition.defaults, { roles: { launchWallet: input.account }, assets: { quote: { chainId: "4663", address: quoteAsset, decimals } } });
    const bytes = encodeModuleEngineConfiguration(definition.configurationAbi, config, definition.schema); same(keccak256(bytes), revision.fixedConfigurationHash, "Fixed quote configuration");
    const [configuration] = decodeAbiParameters(parseAbiParameters("(address poolManager,address positionManager,address positionPlanner,address positionForwarderFactory,address converter,bytes32 converterCodeHash,uint256 initialQuotePerTokenX18,address fixedQuoteAsset,bytes feeConversionRouteSuffix)"), bytes);
    same(configuration.poolManager, block.release.contracts.poolManager.address, "Quote PoolManager"); await code(input.client, configuration.converter, configuration.converterCodeHash, block.blockNumber);
    const converterAbi = parseAbi(["function weth() view returns (address)", "function feeConversionRoute() view returns (bytes)"]);
    const weth = moduleAddress(await read(input.client, configuration.converter, "weth", [], block.blockNumber, converterAbi), "converter WETH");
    if (quoteAsset === weth) routes.push({ label: "Unwrap WETH to ETH", data: "0x" });
    else { const route = concatHex([quoteAsset, configuration.feeConversionRouteSuffix]); need(route.length === 88 && route.slice(-40).toLowerCase() === weth.slice(2).toLowerCase(), "The reviewed fee route must be a direct pool ending at WETH."); routes.push({ label: "Fixed reviewed route to ETH", data: route }); }
    if (input.existingToken) {
      const launch = await boundLaunch(input.client, block, input.existingToken);
      same(await read(input.client, block.release.contracts.host.address, "fixedConfigurationHash", [launch.launchId], block.blockNumber, moduleEngineHostAbi), revision.fixedConfigurationHash, "Host fixed configuration admission");
      same(await read(input.client, launch.engine, "feeConversionRoute", [], block.blockNumber, converterAbi), routes[0].data, "Engine fixed fee route");
    }
  }
  await canonical(input.client, block); return { address: quoteAsset, decimals, balance: uint(rawBalance, "quote balance"), blockNumber: block.blockNumber, routes };
}
