import { concatHex, decodeAbiParameters, decodeEventLog, decodeFunctionResult, encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, getCreate2Address, keccak256, parseAbi, parseAbiParameters, toHex, type Abi, type Address, type Hex, type TransactionReceipt } from "viem";
import { compileOpenConfig, type OpenConfigValue } from "@/packages/classic-modules/src/open-config.mjs";
import { evaluateOpenConstraints } from "@/packages/classic-modules/src/open-constraints.mjs";
import { validateTokenImage } from "@/lib/module-mode/builder";
import { createModuleNativeClient, type ModuleNativeClient, type ModuleNativeWalletTransaction } from "@/lib/module-mode/native-client";
import { nativeCanonicalJson } from "@/lib/module-mode/native-catalog";
import { moduleAddress, moduleBytes, moduleHash, moduleUint } from "@/lib/module-mode/release";
import { MODULE_DEFAULT_TOKEN_IMAGE, moduleTokenMetadata, type ModuleSocialLinks } from "@/lib/module-mode/token-metadata";
import { MAX_TOKEN_DESCRIPTION_BYTES, MAX_TOKEN_NAME_BYTES } from "@/lib/metadata-policy";
import { ENGINE_CONTEXT, moduleEngineConstructorParameters, moduleEngineHostAbi, moduleEngineLaunchParameters, moduleEngineLedgerAbi, moduleEnginePlanParameters, moduleEngineReadAbi, moduleEngineTradeLimitsParameters } from "./abi";
import { bindActiveModuleEngineRelease, bindModuleEngineTemplate, ENGINE_ZERO_ADDRESS as ZERO, ENGINE_ZERO_HASH as ZERO_HASH, MODULE_ENGINE_CONTRACTS, MODULE_ENGINE_SOURCE_ID, moduleEngineOptionalHash, parseModuleEngineAvailability, type ModuleEngineAvailability, type ModuleEnginePermission, type ModuleEngineRelease, type ModuleEngineTemplate } from "./catalog";
import { encodeModuleEngineConfiguration } from "./configuration";

export type ModuleEngineClient = ModuleNativeClient;
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
  readonly platformFeeBps: 10 | 30; readonly buyCreatorFeeBps: number; readonly sellCreatorFeeBps: number;
}
export interface PreparedModuleEngineOperation extends PreparedBase {
  readonly kind: "execute"; readonly token: Address; readonly launchId: Hex; readonly revisionId: Hex; readonly planHash: Hex;
  readonly operation: Readonly<ModuleEngineOperation>; readonly result: Hex;
}
export interface PreparedModuleEngineApproval extends PreparedBase { readonly kind: "approve"; readonly token: Address; readonly spender: Address; readonly amount: bigint }
export interface PreparedModuleEngineClaim extends PreparedBase { readonly kind: "claim"; readonly token: Address; readonly launchId: Hex; readonly revisionId: Hex; readonly planHash: Hex; readonly recipient: Address; readonly minimumAmount: bigint; readonly claimedBefore: bigint }
export type PreparedModuleEngineTransaction = PreparedModuleEngineLaunch | PreparedModuleEngineOperation | PreparedModuleEngineApproval | PreparedModuleEngineClaim;
export interface ModuleEngineApprovalRequired { kind: "approval-required"; token: Address; spender: Address; amount: bigint; currentAllowance: bigint }
export interface ModuleEngineReceiptResult {
  sourceKind: "module-engine-v1"; status: "mined"; finalized: false; indexed: false; kind: PreparedModuleEngineTransaction["kind"];
  transactionHash: Hex; blockNumber: bigint; blockHash: Hex; token?: Address; launch?: ModuleEngineLaunchRecord; outputAmount?: bigint;
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
type BoundBlock = { release: ModuleEngineRelease; blockNumber: bigint; blockHash: Hex; timestamp: bigint };
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
export async function assertModuleEngineRelease(input: { client: ModuleEngineClient; release: ModuleEngineRelease; blockNumber?: bigint }): Promise<BoundBlock> {
  const { client } = input, release = bindActiveModuleEngineRelease(input.release);
  need(await client.getChainId() === 4663, "RPC is on another chain.");
  const block = await client.getBlock(input.blockNumber === undefined ? { blockTag: "latest" } : { blockNumber: input.blockNumber });
  need(block.number !== null && block.hash !== null && block.number >= BigInt(release.startBlock), "Release block is unavailable.");
  if (input.blockNumber === undefined) need(Math.abs(Date.now() / 1000 - Number(block.timestamp)) <= 120, "RPC state is stale. Refresh before continuing.");
  const pins = release.contracts;
  await Promise.all(MODULE_ENGINE_CONTRACTS.map(role => code(client, pins[role].address, pins[role].runtimeCodeHash, block.number!)));
  await Promise.all((["tokenFactory", "launchPolicy", "registry", "ledger"] as const).map(async role => same(await read(client, pins.host.address, role, [], block.number!, moduleEngineHostAbi), pins[role].address, `Host ${role}`)));
  await Promise.all(([["hook", "host"], ["registry", "registry"], ["poolManager", "poolManager"]] as const).map(async ([getter, role]) => same(await read(client, pins.ledger.address, getter, [], block.number!), pins[role].address, `Ledger ${getter}`)));
  same(await read(client, pins.host.address, "SOURCE_VERSION", [], block.number, moduleEngineHostAbi), MODULE_ENGINE_SOURCE_ID, "Host source version");
  same(await read(client, pins.ledger.address, "ECONOMICS_POLICY_ID", [], block.number), release.economicsPolicyId, "Ledger economics policy");
  const [protocol, authors, owner] = await Promise.all([read(client, pins.ledger.address, "PROTOCOL_FEE_BPS", [], block.number), read(client, pins.ledger.address, "AUTHOR_POOL_FEE_BPS", [], block.number), read(client, pins.registry.address, "owner", [], block.number)]);
  need(protocol === 10 && authors === 20, "Ledger fee constants differ."); moduleAddress(owner, "registry.owner");
  const result = { release, blockNumber: block.number, blockHash: block.hash, timestamp: block.timestamp }; await canonical(client, result); return result;
}
function launchRecord(value: unknown): ModuleEngineLaunchRecord {
  need(value && typeof value === "object", "Missing engine launch record."); const r = value as Record<string, unknown>;
  const result = {} as Record<string, unknown>;
  for (const key of ["launchId", "revisionId", "engineCodeHash", "constructorHash", "initCodeHash", "configurationHash", "planHash", "resourcesHash"]) result[key] = moduleHash(r[key], key);
  for (const key of ["creator", "token", "quoteAsset", "engine"]) result[key] = moduleAddress(r[key], key);
  result.buyCreatorFeeBps = fee(r.buyCreatorFeeBps); result.sellCreatorFeeBps = fee(r.sellCreatorFeeBps); return result as unknown as ModuleEngineLaunchRecord;
}
function contextFor(release: ModuleEngineRelease, r: Pick<ModuleEngineLaunchRecord, "launchId" | "token" | "creator" | "quoteAsset">) { return { host: release.contracts.host.address, launchId: r.launchId, token: r.token, creator: r.creator, quoteAsset: r.quoteAsset, feeCollector: release.contracts.host.address }; }
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
  same(contextHash, keccak256(encodeAbiParameters(parseAbiParameters(ENGINE_CONTEXT), [contextFor(block.release, r)])), "Engine context"); return r;
}
export async function readModuleEngineLaunch(input: { client: ModuleEngineClient; release: ModuleEngineRelease; token: Address; blockNumber?: bigint }): Promise<ModuleEngineLaunchRecord> {
  const block = await assertModuleEngineRelease(input), result = await boundLaunch(input.client, block, input.token); await canonical(input.client, block); return result;
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
function operationFor(intent: ModuleEngineOperationIntent, account: Address, expiresAt: bigint, nonce: bigint): ModuleEngineOperation {
  return { operationId: moduleHash(intent.operationId, "operationId"), actor: account, recipient: moduleAddress(intent.recipient, "recipient"), inputAsset: moduleAddress(intent.inputAsset, "inputAsset", true), inputAmount: uint(intent.inputAmount, "inputAmount"), outputAsset: moduleAddress(intent.outputAsset, "outputAsset", true), minimumOutput: uint(intent.minimumOutput, "minimumOutput"), deadline: expiresAt, nonce, data: moduleBytes(intent.data, "operation.data", 16_384) };
}
function emptyOperation(): ModuleEngineOperation { return { operationId: ZERO_HASH, actor: ZERO, recipient: ZERO, inputAsset: ZERO, inputAmount: 0n, outputAsset: ZERO, minimumOutput: 0n, deadline: 0n, nonce: 0n, data: "0x" }; }
async function simulate(client: ModuleEngineClient, block: BoundBlock, transaction: ModuleNativeWalletTransaction) {
  const request = { account: transaction.from, to: transaction.to, data: transaction.data, value: BigInt(transaction.value), blockNumber: block.blockNumber };
  const [result, gasEstimate] = await Promise.all([client.call(request), client.estimateGas(request)]); need(result.data && result.data !== "0x", "Simulation returned no result.");
  need(gasEstimate > 0n && gasEstimate <= 30_000_000n, "Transaction gas is outside the supported limit."); await canonical(client, block); return { data: result.data, gasEstimate };
}
function tx(account: Address, to: Address, data: Hex, value: bigint, action: ModuleNativeWalletTransaction["action"], description: string): ModuleNativeWalletTransaction { return { chainId: 4663, from: account, to, data, value: toHex(value), action, description }; }
function bind<T extends PreparedModuleEngineTransaction>(prepared: T, binding: Omit<Binding, "state">) { freeze(prepared); preparations.set(prepared, { ...binding, state: "ready" }); return prepared; }
function active(value: ModuleEngineAvailability) { const result = parseModuleEngineAvailability(value); need(result.release, "Engine launches are unavailable."); return { ...result, release: result.release }; }
export interface PrepareModuleEngineLaunchInput {
  client: ModuleEngineClient; availability: ModuleEngineAvailability; templateId: string; account: Address; quoteAsset: Address;
  name: string; symbol: string; description: string; imageUri?: string; socialLinks?: ModuleSocialLinks;
  configuration: OpenConfigValue; creatorSalt: Hex; engineSalt: Hex; launchData?: Hex;
  creatorWallets: readonly Address[]; creatorSharesBps: readonly number[]; buyCreatorFeeBps: number; sellCreatorFeeBps: number;
  initialOperation?: (identity: { token: Address; quoteAsset: Address }) => ModuleEngineOperationIntent;
  deadlineSeconds?: number;
}
export function materializeModuleEngineRuntime(template: Hex, constructorArgs: Hex, runtimeOffsets: readonly number[], constructorOffsets: readonly number[]): Hex {
  need(runtimeOffsets.length === constructorOffsets.length, "Immutable map lengths differ."); let runtime = template; let previous = -32;
  runtimeOffsets.forEach((offset, i) => { const binding = constructorOffsets[i]; need(Number.isInteger(offset) && offset >= previous + 32 && offset * 2 + 66 <= runtime.length && Number.isInteger(binding) && binding >= 0 && binding % 32 === 0 && binding * 2 + 66 <= constructorArgs.length, "Immutable mapping is out of bounds.");
    const start = offset * 2 + 2; need(runtime.slice(start, start + 64) === "0".repeat(64), "Immutable slot is not zero."); runtime = `${runtime.slice(0, start)}${constructorArgs.slice(2 + binding * 2, 66 + binding * 2)}${runtime.slice(start + 64)}` as Hex; previous = offset; }); return runtime;
}
export function predictModuleEngineAddress(host: Address, creator: Address, engineSalt: Hex, launchId: Hex, initCodeHash: Hex) { return getCreate2Address({ from: host, salt: keccak256(encodeAbiParameters(parseAbiParameters("address,bytes32,bytes32"), [creator, engineSalt, launchId])), bytecodeHash: initCodeHash }).toLowerCase() as Address; }
async function minedSalt(host: Address, creator: Address, base: Hex, launchId: Hex, initCodeHash: Hex) {
  for (let i = 0n; i < 262_144n; i++) {
    const salt = toHex((BigInt(base) + i) % (1n << 256n), { size: 32 }), address = predictModuleEngineAddress(host, creator, salt, launchId, initCodeHash);
    if ((BigInt(address) & 0x3fffn) === 0x2080n) return { salt, address };
    if (i % 2048n === 2047n) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  throw new Error("Module engine: No valid hook address found. Change the engine salt and prepare again.");
}
export async function prepareModuleEngineLaunch(input: PrepareModuleEngineLaunchInput): Promise<PreparedModuleEngineLaunch | ModuleEngineApprovalRequired> {
  const availability = active(input.availability), account = moduleAddress(input.account, "account"), release = freeze(availability.release);
  const rawTemplate = availability.templates.find(item => item.manifest.manifest.catalogDefinition.id === input.templateId); need(rawTemplate, "Template is not in the current catalog.");
  const block = await assertModuleEngineRelease({ client: input.client, release }), template = await assertTemplate(input.client, block, rawTemplate, true), m = template.manifest.manifest;
  const quoteAsset = moduleAddress(input.quoteAsset, "quoteAsset"); if (m.revision.fixedQuoteAsset !== ZERO) same(quoteAsset, m.revision.fixedQuoteAsset, "Fixed quote asset");
  const quoteCode = await input.client.getCode({ address: quoteAsset, blockNumber: block.blockNumber }); need(quoteCode && quoteCode !== "0x", "Quote asset is not a deployed token.");
  const quoteDecimals = Number(await read(input.client, quoteAsset, "decimals", [], block.blockNumber)); need(Number.isInteger(quoteDecimals) && quoteDecimals >= 0 && quoteDecimals <= 18, "Quote decimals are unsupported.");
  const name = input.name.trim(), symbol = input.symbol.trim(); need(name.length > 0 && new TextEncoder().encode(name).length <= MAX_TOKEN_NAME_BYTES && /^[A-Za-z0-9]{1,11}$/.test(symbol), "Check the token name and symbol.");
  need(new TextEncoder().encode(input.description).length <= MAX_TOKEN_DESCRIPTION_BYTES, "Description is too long.");
  const imageUri = input.imageUri || MODULE_DEFAULT_TOKEN_IMAGE; need(!validateTokenImage({ kind: "uri", uri: imageUri, contentVerified: false }), "Use a public HTTPS token image.");
  const config = compileOpenConfig(m.catalogDefinition.schema, input.configuration, { roles: { launchWallet: account }, assets: { quote: { chainId: "4663", address: quoteAsset, decimals: quoteDecimals } } });
  const constraints = evaluateOpenConstraints(m.catalogDefinition.constraints, { self: { schema: m.catalogDefinition.schema, value: config.value } }); need(constraints.ok, constraints.violations[0]?.message ?? "Configuration constraints failed.");
  const configuration = encodeModuleEngineConfiguration(m.catalogDefinition.configurationAbi, config, m.catalogDefinition.schema), configurationHash = keccak256(configuration); need(configuration.length <= 16_384 * 2 + 2, "Configuration is too large.");
  if (m.revision.fixedConfigurationHash !== ZERO_HASH) same(configurationHash, m.revision.fixedConfigurationHash, "Fixed configuration");
  const host = release.contracts.host.address, creatorSalt = moduleEngineOptionalHash(input.creatorSalt, "creatorSalt");
  const predicted = await read(input.client, host, "predictTokenAddress", [name, symbol, account, creatorSalt], block.blockNumber, moduleEngineHostAbi) as readonly [Address, Hex];
  const graffiti = keccak256(encodeAbiParameters(parseAbiParameters("string,address,bytes32"), ["programmable.module-engine.token.v1", account, creatorSalt])); same(predicted[1], graffiti, "Token graffiti");
  const predictedToken = getCreate2Address({ from: release.contracts.tokenFactory.address, salt: keccak256(encodeAbiParameters(parseAbiParameters("string,string,uint8,address,bytes32"), [name, symbol, 18, host, graffiti])), bytecodeHash: release.tokenCreationCodeHash }).toLowerCase() as Address;
  same(predicted[0], predictedToken, "Predicted token"); need(predictedToken !== quoteAsset, "Primary and quote assets must differ.");
  const launchId = keccak256(encodeAbiParameters(parseAbiParameters("uint256,address,address,bytes32,bytes32"), [4663n, host, predictedToken, m.revision.packageId, configurationHash]));
  const context = contextFor(release, { launchId, token: predictedToken, creator: account, quoteAsset }), constructorArgs = encodeAbiParameters(moduleEngineConstructorParameters, [context, configuration]);
  const constructorHash = keccak256(constructorArgs), initCodeHash = keccak256(concatHex([m.source.engine.creationBytecode, constructorArgs]));
  need((m.source.engine.creationBytecode.length + constructorArgs.length - 4) / 2 <= 49_152, "Engine init code exceeds the chain limit.");
  const engineCodeHash = keccak256(materializeModuleEngineRuntime(m.source.engine.runtimeTemplate, constructorArgs, m.source.engine.immutableRuntimeOffsets, m.source.engine.immutableConstructorOffsets));
  const initialSalt = moduleEngineOptionalHash(input.engineSalt, "engineSalt"); const engineIdentity = m.catalogDefinition.interface === "quote-v1" ? await minedSalt(host, account, initialSalt, launchId, initCodeHash) : { salt: initialSalt, address: predictModuleEngineAddress(host, account, initialSalt, launchId, initCodeHash) };
  const expiresAt = deadline(block.timestamp, input.deadlineSeconds), initialOperation = input.initialOperation ? operationFor(input.initialOperation({ token: predictedToken, quoteAsset }), account, expiresAt, 0n) : emptyOperation();
  same(initialOperation.operationId, m.revision.initialOperationId, "Required initial operation");
  if (initialOperation.operationId !== ZERO_HASH) { const required = await validateOperation(input.client, block, { launchId, revisionId: m.revision.packageId, creator: account, token: predictedToken, quoteAsset }, initialOperation, account); if (required) return required; }
  need(input.creatorWallets.length > 0 && input.creatorWallets.length <= 16 && input.creatorWallets.length === input.creatorSharesBps.length && input.creatorSharesBps.every(value => Number.isInteger(value) && value > 0 && value <= 10_000) && input.creatorSharesBps.reduce((sum, value) => sum + value, 0) === 10_000, "Creator shares must total 100%.");
  const creatorWallets = input.creatorWallets.map(wallet => moduleAddress(wallet, "creatorWallet")); need(new Set(creatorWallets).size === creatorWallets.length, "Creator recipients must be unique.");
  const buyCreatorFeeBps = fee(input.buyCreatorFeeBps), sellCreatorFeeBps = fee(input.sellCreatorFeeBps);
  const parameters = { name, symbol, creatorSalt, revisionId: m.revision.packageId, quoteAsset, configuration, creationCode: m.source.engine.creationBytecode, runtimeTemplate: m.source.engine.runtimeTemplate, engineSalt: engineIdentity.salt, launchData: moduleBytes(input.launchData ?? "0x", "launchData", 16_384), metadata: moduleTokenMetadata(input.description, imageUri, input.socialLinks), creatorWallets, creatorSharesBps: [...input.creatorSharesBps], buyCreatorFeeBps, sellCreatorFeeBps, initialOperation };
  const planHash = keccak256(encodeAbiParameters(moduleEnginePlanParameters, [4663n, host, account, parameters]));
  const transaction = tx(account, host, encodeFunctionData({ abi: moduleEngineHostAbi, functionName: "launch", args: [parameters] }), initialOperation.inputAsset === ZERO ? initialOperation.inputAmount : 0n, "launch", `Launch ${symbol} with ${m.catalogDefinition.title}`);
  const simulated = await simulate(input.client, block, transaction), result = launchRecord(decodeFunctionResult({ abi: moduleEngineHostAbi, functionName: "launch", data: simulated.data }));
  for (const [key, expected] of Object.entries({ launchId, revisionId: m.revision.packageId, token: predictedToken, creator: account, quoteAsset, engine: engineIdentity.address, engineCodeHash, constructorHash, initCodeHash, configurationHash, planHash })) same(result[key as keyof ModuleEngineLaunchRecord], expected, `Simulated ${key}`);
  const snapshots = await Promise.all(m.revision.eligibleFamilies.map(family => read(input.client, release.contracts.registry.address, "familyFeeEligibility", [family], block.blockNumber)));
  const platformFeeBps = snapshots.some(snapshot => Array.isArray(snapshot) && snapshot[0] === true) ? 30 : 10;
  const prepared: PreparedModuleEngineLaunch = { sourceKind: "module-engine-v1", kind: "launch", account, releaseDigest: release.releaseDigest, blockNumber: block.blockNumber, expiresAt, gasEstimate: simulated.gasEstimate, transaction: { ...transaction, gas: toHex(simulated.gasEstimate * 12n / 10n) }, predictedToken, engine: engineIdentity.address, launchId, revisionId: m.revision.packageId, planHash, configurationHash, engineCodeHash, quoteAsset, quoteDecimals, initialOperation, platformFeeBps, buyCreatorFeeBps, sellCreatorFeeBps };
  return bind(prepared, { client: input.client, release, refresh: async () => {
    const current = await assertModuleEngineRelease({ client: input.client, release }); need(current.timestamp <= expiresAt, "Launch preview expired."); await assertTemplate(input.client, current, template, true);
    const currentSnapshots = await Promise.all(m.revision.eligibleFamilies.map(family => read(input.client, release.contracts.registry.address, "familyFeeEligibility", [family], current.blockNumber))); equal(currentSnapshots, snapshots, "Fee eligibility review snapshot");
    if (initialOperation.operationId !== ZERO_HASH) need(!await validateOperation(input.client, current, { ...result }, initialOperation, account), "Initial funding approval changed.");
    const fresh = await simulate(input.client, current, transaction); const currentLaunch = launchRecord(decodeFunctionResult({ abi: moduleEngineHostAbi, functionName: "launch", data: fresh.data }));
    for (const key of ["launchId", "planHash", "token", "engine", "engineCodeHash", "configurationHash"] as const) same(currentLaunch[key], result[key], `Current launch ${key}`);
  }, receipt: receipt => verifyModuleEngineLaunchReceipt({ client: input.client, release, expected: result, receipt }) });
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
export async function prepareModuleEngineApproval(input: { client: ModuleEngineClient; release: ModuleEngineRelease; account: Address; token: Address; amount: bigint }): Promise<PreparedModuleEngineApproval> {
  const account = moduleAddress(input.account, "account"), token = moduleAddress(input.token, "token"), amount = uint(input.amount, "approval amount"), release = freeze(bindActiveModuleEngineRelease(input.release)), block = await assertModuleEngineRelease({ client: input.client, release });
  const tokenCode = await input.client.getCode({ address: token, blockNumber: block.blockNumber }); need(tokenCode && tokenCode !== "0x", "Approval asset has no contract."); const tokenHash = keccak256(tokenCode), spender = release.contracts.host.address;
  const balance = uint(await read(input.client, token, "balanceOf", [account], block.blockNumber), "balance"); need(amount === 0n || amount <= balance, "Approval exceeds the available input balance.");
  const transaction = tx(account, token, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, amount] }), 0n, "approve", amount === 0n ? "Reset the engine funding allowance" : "Approve the exact engine input amount");
  const call = async (current: BoundBlock) => { const request = { account, to: token, data: transaction.data, value: 0n, blockNumber: current.blockNumber }; const [result, gasEstimate] = await Promise.all([input.client.call(request), input.client.estimateGas(request)]); need(result.data === undefined || result.data === "0x" || decodeFunctionResult({ abi: erc20Abi, functionName: "approve", data: result.data }) === true, "Token rejected the bounded approval."); need(gasEstimate > 0n && gasEstimate <= 1_000_000n, "Approval gas is outside the supported limit."); await canonical(input.client, current); return gasEstimate; };
  const gasEstimate = await call(block), expiresAt = deadline(block.timestamp);
  const prepared: PreparedModuleEngineApproval = { sourceKind: "module-engine-v1", kind: "approve", account, releaseDigest: release.releaseDigest, blockNumber: block.blockNumber, expiresAt, gasEstimate, transaction: { ...transaction, gas: toHex(gasEstimate * 12n / 10n) }, token, spender, amount };
  return bind(prepared, { client: input.client, release, refresh: async () => { const current = await assertModuleEngineRelease({ client: input.client, release }); need(current.timestamp <= expiresAt, "Approval preview expired."); await code(input.client, token, tokenHash, current.blockNumber); await call(current); }, receipt: receipt => verifyModuleEngineApprovalReceipt({ client: input.client, release, account, token, amount, receipt }) });
}
export async function revalidateModuleEngineTransaction(prepared: PreparedModuleEngineTransaction, account: Address): Promise<ModuleNativeWalletTransaction> {
  const binding = preparations.get(prepared); need(binding && binding.state === "ready", "This is not a fresh, verified engine preparation."); same(account, prepared.account, "Selected wallet"); binding.state = "pending";
  try { await binding.refresh(); return prepared.transaction; } catch (error) { binding.state = "ready"; throw error; }
}
export function noteModuleEngineSubmission(prepared: PreparedModuleEngineTransaction, hash: Hex) { const binding = preparations.get(prepared); need(binding && binding.state === "pending", "No pending verified engine request."); binding.hash = moduleHash(hash, "transactionHash"); binding.state = "submitted"; }
/** Only call after a definite preflight failure or explicit wallet rejection; an uncertain send stays blocked. */
export function releaseModuleEnginePreparation(prepared: PreparedModuleEngineTransaction) { const binding = preparations.get(prepared); if (binding?.state === "pending") binding.state = "ready"; }
function receiptResult(receipt: TransactionReceipt, kind: PreparedModuleEngineTransaction["kind"], extra: Partial<Pick<ModuleEngineReceiptResult, "token" | "launch" | "outputAmount">> = {}): ModuleEngineReceiptResult { return { sourceKind: "module-engine-v1", status: "mined", finalized: false, indexed: false, kind, transactionHash: receipt.transactionHash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, ...extra }; }
function event(receipt: TransactionReceipt, address: Address, eventName: string, abi: Abi = moduleEngineHostAbi): Record<string, unknown> {
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
  need(matches.length === 1, `Expected exactly one ${eventName} event from the released host.`); return matches[0];
}
async function receiptBlock(client: ModuleEngineClient, release: ModuleEngineRelease, receipt: TransactionReceipt) { need(receipt.status === "success", "Receipt was not successful."); const block = await assertModuleEngineRelease({ client, release, blockNumber: receipt.blockNumber }); same(block.blockHash, receipt.blockHash, "Receipt block"); return block; }
export async function verifyModuleEngineLaunchReceipt(input: { client: ModuleEngineClient; release: ModuleEngineRelease; expected: ModuleEngineLaunchRecord; receipt: TransactionReceipt }): Promise<ModuleEngineReceiptResult> {
  const block = await receiptBlock(input.client, input.release, input.receipt), actual = await boundLaunch(input.client, block, input.expected.token);
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
  return receiptResult(input.receipt, "launch", { token: actual.token, launch: actual });
}
export async function verifyModuleEngineOperationReceipt(input: { client: ModuleEngineClient; release: ModuleEngineRelease; launch: ModuleEngineLaunchRecord; operation: ModuleEngineOperation; receipt: TransactionReceipt }): Promise<ModuleEngineReceiptResult> {
  const block = await receiptBlock(input.client, input.release, input.receipt), launch = await boundLaunch(input.client, block, input.launch.token); same(launch.launchId, input.launch.launchId, "Operation launch"); same(launch.planHash, input.launch.planHash, "Operation launch plan");
  const args = event(input.receipt, block.release.contracts.host.address, "EngineOperationExecuted"); same(args.launchId, launch.launchId, "Operation event launch");
  for (const key of ["operationId", "actor", "recipient", "inputAsset", "outputAsset"] as const) same(args[key], input.operation[key], `Operation ${key}`);
  need(args.nonce === input.operation.nonce && args.inputAmount === input.operation.inputAmount, "Operation nonce or amount differs.");
  const outputAmount = uint(args.outputAmount, "outputAmount"); need(outputAmount >= input.operation.minimumOutput, "Actual operation output is below the reviewed minimum.");
  const nonce = uint(await read(input.client, block.release.contracts.host.address, "nonces", [launch.launchId, input.operation.actor], block.blockNumber, moduleEngineHostAbi), "nonce"); need(nonce > input.operation.nonce, "Operation nonce was not consumed."); await canonical(input.client, block);
  return receiptResult(input.receipt, "execute", { token: launch.token, launch, outputAmount });
}
export async function verifyModuleEngineApprovalReceipt(input: { client: ModuleEngineClient; release: ModuleEngineRelease; account: Address; token: Address; amount: bigint; receipt: TransactionReceipt }): Promise<ModuleEngineReceiptResult> {
  const block = await receiptBlock(input.client, input.release, input.receipt), allowance = uint(await read(input.client, input.token, "allowance", [input.account, block.release.contracts.host.address], block.blockNumber), "allowance");
  need(allowance === input.amount, "Exact bounded approval is not visible at the receipt block."); await canonical(input.client, block); return receiptResult(input.receipt, "approve", { token: input.token });
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
  fees: { claimable: bigint; claimed: bigint; contributionByLaunch: bigint; treasury: Address; administrator: Address; creatorWallets: Address[]; creatorSharesBps: number[]; adminRevision: bigint; buyPlatformBps: number; sellPlatformBps: number; buyCreatorBps: number; sellCreatorBps: number };
}
/** The displayed admin powers come from the bound contract and actor; catalog labels grant no powers. */
export async function readModuleEngineAdministration(input: { client: ModuleEngineClient; release: ModuleEngineRelease; template: ModuleEngineTemplate; token: Address; account: Address; requestId?: Hex }): Promise<ModuleEngineAdministration> {
  const block = await assertModuleEngineRelease(input), launch = await boundLaunch(input.client, block, input.token), template = await assertTemplate(input.client, block, input.template, false), actor = moduleAddress(input.account, "account");
  same(launch.revisionId, template.manifest.manifest.revision.packageId, "Administration template");
  const ledger = block.release.contracts.ledger.address, ledgerRead = (fn: string, args: readonly unknown[]) => read(input.client, ledger, fn, args, block.blockNumber, moduleEngineLedgerAbi);
  const [claimable, claimed, contributed, treasury, administrator, recipients, quoteDecimals, buy, sell] = await Promise.all([
    ledgerRead("claimable", [actor]), ledgerRead("claimedBy", [actor]), ledgerRead("contributionByPool", [launch.launchId, actor]), ledgerRead("treasury", []), ledgerRead("rewardAdmin", []), ledgerRead("creatorRecipients", [launch.launchId]), read(input.client, launch.quoteAsset, "decimals", [], block.blockNumber),
    read(input.client, block.release.contracts.host.address, "feeTerms", [launch.launchId, true], block.blockNumber, moduleEngineHostAbi), read(input.client, block.release.contracts.host.address, "feeTerms", [launch.launchId, false], block.blockNumber, moduleEngineHostAbi),
  ]);
  const [wallets, shares, adminRevision] = recipients as [Address[], number[], bigint], buyFees = buy as [number, number], sellFees = sell as [number, number];
  need([10, 30].includes(buyFees[0]) && buyFees[0] === sellFees[0] && buyFees[1] === launch.buyCreatorFeeBps && sellFees[1] === launch.sellCreatorFeeBps, "Stored fee terms differ.");
  const result: ModuleEngineAdministration = { launch, blockNumber: block.blockNumber, timestamp: block.timestamp, quoteDecimals: Number(quoteDecimals), actor, permissions: template.manifest.manifest.revision.operationPermissions,
    fees: { claimable: uint(claimable, "claimable"), claimed: uint(claimed, "claimed"), contributionByLaunch: uint(contributed, "contribution"), treasury: moduleAddress(treasury, "treasury"), administrator: moduleAddress(administrator, "administrator"), creatorWallets: wallets.map(wallet => moduleAddress(wallet, "creator recipient")), creatorSharesBps: shares, adminRevision: uint(adminRevision, "admin revision"), buyPlatformBps: buyFees[0], sellPlatformBps: sellFees[0], buyCreatorBps: buyFees[1], sellCreatorBps: sellFees[1] } };
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
export function moduleEngineWithdrawalIntent(quoteAsset: Address, recipient: Address, amount: bigint): ModuleEngineOperationIntent { need(amount > 0n, "Enter a positive withdrawal."); return { operationId: ENGINE_OPERATIONS.withdraw, recipient, inputAsset: ZERO, inputAmount: 0n, outputAsset: quoteAsset, minimumOutput: amount, data: encodeAbiParameters(parseAbiParameters("uint256"), [amount]) }; }
export function moduleEngineSettlementRequestIntent(input: { quoteAsset: Address; actor: Address; beneficiary: Address; amount: bigint; refundAfter: bigint; obligationHash: Hex }): ModuleEngineOperationIntent {
  need(input.amount > 0n, "Enter a positive funded amount."); return { operationId: ENGINE_OPERATIONS.request, recipient: input.actor, inputAsset: input.quoteAsset, inputAmount: input.amount, outputAsset: ZERO, minimumOutput: 0n, data: encodeAbiParameters(parseAbiParameters("address,uint256,bytes32"), [moduleAddress(input.beneficiary, "beneficiary"), input.refundAfter, moduleHash(input.obligationHash, "obligationHash")]) };
}
export function moduleEngineSettlementPaymentIntent(input: { quoteAsset: Address; request: ModuleEngineSettlementRequest; kind: "fulfill" | "refund"; evidenceHash?: Hex }): ModuleEngineOperationIntent {
  need(input.request.status === 1, "This request is already closed."); return { operationId: ENGINE_OPERATIONS[input.kind], recipient: input.kind === "fulfill" ? input.request.beneficiary : input.request.payer, inputAsset: ZERO, inputAmount: 0n, outputAsset: input.quoteAsset, minimumOutput: input.request.amount,
    data: input.kind === "fulfill" ? encodeAbiParameters(parseAbiParameters("bytes32,bytes32"), [input.request.requestId, moduleHash(input.evidenceHash, "evidenceHash")]) : encodeAbiParameters(parseAbiParameters("bytes32"), [input.request.requestId]) };
}
export async function prepareModuleEngineClaim(input: { client: ModuleEngineClient; release: ModuleEngineRelease; token: Address; account: Address; recipient: Address }): Promise<PreparedModuleEngineClaim> {
  const release = freeze(bindActiveModuleEngineRelease(input.release)), block = await assertModuleEngineRelease({ client: input.client, release }), launch = await boundLaunch(input.client, block, input.token), account = moduleAddress(input.account, "account"), recipient = moduleAddress(input.recipient, "claim recipient"), ledger = release.contracts.ledger.address;
  need(recipient !== ledger, "Choose an external claim recipient.");
  const [claimable, alreadyClaimed] = await Promise.all([read(input.client, ledger, "claimable", [account], block.blockNumber, moduleEngineLedgerAbi), read(input.client, ledger, "claimedBy", [account], block.blockNumber, moduleEngineLedgerAbi)]);
  const minimumAmount = uint(claimable, "claimable ETH", true), claimedBefore = uint(alreadyClaimed, "claimed ETH"), expiresAt = deadline(block.timestamp);
  const transaction = tx(account, ledger, encodeFunctionData({ abi: moduleEngineLedgerAbi, functionName: "claimTo", args: [recipient] }), 0n, "manage", "Claim your accrued engine fees in ETH");
  const simulated = await simulate(input.client, block, transaction); need(decodeFunctionResult({ abi: moduleEngineLedgerAbi, functionName: "claimTo", data: simulated.data }) === minimumAmount, "Claim simulation differs from the ledger balance.");
  const prepared: PreparedModuleEngineClaim = { sourceKind: "module-engine-v1", kind: "claim", account, releaseDigest: release.releaseDigest, blockNumber: block.blockNumber, expiresAt, gasEstimate: simulated.gasEstimate, transaction: { ...transaction, gas: toHex(simulated.gasEstimate * 12n / 10n) }, token: launch.token, launchId: launch.launchId, revisionId: launch.revisionId, planHash: launch.planHash, recipient, minimumAmount, claimedBefore };
  return bind(prepared, { client: input.client, release, refresh: async () => { const current = await assertModuleEngineRelease({ client: input.client, release }); need(current.timestamp <= expiresAt, "Claim preview expired."); const live = await boundLaunch(input.client, current, launch.token); same(live.planHash, launch.planHash, "Claim launch plan"); const currentClaimable = uint(await read(input.client, ledger, "claimable", [account], current.blockNumber, moduleEngineLedgerAbi), "claimable ETH"); need(currentClaimable >= minimumAmount, "Fee balance changed. Review the claim again."); await simulate(input.client, current, transaction); }, receipt: receipt => verifyModuleEngineClaimReceipt({ client: input.client, release, launch, account, recipient, minimumAmount, claimedBefore, receipt }) });
}
export async function verifyModuleEngineClaimReceipt(input: { client: ModuleEngineClient; release: ModuleEngineRelease; launch: ModuleEngineLaunchRecord; account: Address; recipient: Address; minimumAmount: bigint; claimedBefore: bigint; receipt: TransactionReceipt }): Promise<ModuleEngineReceiptResult> {
  const block = await receiptBlock(input.client, input.release, input.receipt), launch = await boundLaunch(input.client, block, input.launch.token); same(launch.planHash, input.launch.planHash, "Claim launch plan");
  const args = event(input.receipt, block.release.contracts.ledger.address, "FeesClaimed", moduleEngineLedgerAbi); same(args.beneficiary, input.account, "Claim beneficiary"); same(args.caller, input.account, "Claim caller"); same(args.recipient, input.recipient, "Claim recipient"); const outputAmount = uint(args.amount, "claimed amount", true); need(outputAmount >= input.minimumAmount, "Claim is below the reviewed balance.");
  const claimed = uint(await read(input.client, block.release.contracts.ledger.address, "claimedBy", [input.account], block.blockNumber, moduleEngineLedgerAbi), "claimed total"); need(claimed >= input.claimedBefore + outputAmount, "Claimed ledger total was not updated."); await canonical(input.client, block); return receiptResult(input.receipt, "claim", { token: launch.token, launch, outputAmount });
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
