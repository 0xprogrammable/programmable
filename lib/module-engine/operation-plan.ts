import { concatHex, encodeAbiParameters, getCreate2Address, keccak256, parseAbiParameters, toHex, type Address, type Hex } from "viem";
import { compileOpenConfig, type OpenConfigValue } from "@/packages/classic-modules/src/open-config.mjs";
import { evaluateOpenConstraints } from "@/packages/classic-modules/src/open-constraints.mjs";
import { validateTokenImage } from "@/lib/module-mode/builder";
import { moduleAddress, moduleBytes, moduleHash, moduleUint } from "@/lib/module-mode/release";
import { MODULE_DEFAULT_TOKEN_IMAGE, moduleTokenMetadata, type ModuleSocialLinks } from "@/lib/module-mode/token-metadata";
import { MAX_TOKEN_DESCRIPTION_BYTES, MAX_TOKEN_NAME_BYTES } from "@/lib/metadata-policy";
import { moduleEngineConstructorParameters, moduleEnginePlanParameters } from "./abi";
import { computeModuleEngineHostManifestHash, moduleEngineReleaseIdentity, moduleEngineOptionalHash, ENGINE_ZERO_ADDRESS as ZERO, ENGINE_ZERO_HASH as ZERO_HASH, type ModuleEngineHostManifest, type ModuleEngineReleaseIdentity } from "./catalog";
import { encodeModuleEngineConfiguration } from "./configuration";
import type { ModuleEngineOperation, ModuleEngineOperationIntent } from "./client";
import { isModuleEngineAnyQuoteRelease } from "./profile";
import { ANY_QUOTE_TOKEN_GRAFFITI_DOMAIN, assertAnyQuoteConfiguration, type AnyQuoteLaunchPreparation } from "./any-quote/integration";
import { ANY_QUOTE_NATIVE_BUY_OPERATION_ID } from "./any-quote/types";
function need(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(`Module engine: ${message}`); }
function same(actual: string, expected: string, label: string) { need(actual.toLowerCase() === expected.toLowerCase(), `${label} differs.`); }
function uint(value: unknown, label: string) { return BigInt(moduleUint(typeof value === "bigint" ? value.toString() : value, label)); }
function fee(value: unknown) { need(typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1000 && value % 100 === 0, "Creator fees must be whole percentages from 0% to 10%."); return value; }
export function moduleEngineOperation(intent: ModuleEngineOperationIntent, account: Address, expiresAt: bigint, nonce: bigint): ModuleEngineOperation {
  return { operationId: moduleHash(intent.operationId, "operationId"), actor: moduleAddress(account, "actor"), recipient: moduleAddress(intent.recipient, "recipient"), inputAsset: moduleAddress(intent.inputAsset, "inputAsset", true), inputAmount: uint(intent.inputAmount, "inputAmount"), outputAsset: moduleAddress(intent.outputAsset, "outputAsset", true), minimumOutput: uint(intent.minimumOutput, "minimumOutput"), deadline: uint(expiresAt, "deadline"), nonce: uint(nonce, "nonce"), data: moduleBytes(intent.data, "operation.data", 16_384) };
}
function emptyOperation(): ModuleEngineOperation { return { operationId: ZERO_HASH, actor: ZERO, recipient: ZERO, inputAsset: ZERO, inputAmount: 0n, outputAsset: ZERO, minimumOutput: 0n, deadline: 0n, nonce: 0n, data: "0x" }; }
export interface ModuleEngineLaunchInputs {
  account: Address; quoteAsset: Address; name: string; symbol: string; description: string; imageUri?: string; socialLinks?: ModuleSocialLinks;
  configuration: OpenConfigValue; anyQuotePreparation?: AnyQuoteLaunchPreparation; creatorSalt: Hex; engineSalt: Hex; launchData?: Hex;
  creatorWallets: readonly Address[]; creatorSharesBps: readonly number[]; buyCreatorFeeBps: number; sellCreatorFeeBps: number;
  initialOperation?: (identity: { token: Address; quoteAsset: Address }) => ModuleEngineOperationIntent;
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
/** Pure deterministic planning only. It grants no review, availability, RPC or wallet authority. */
export async function compileModuleEngineLaunch(input: ModuleEngineLaunchInputs, releaseValue: ModuleEngineReleaseIdentity, manifest: ModuleEngineHostManifest, quoteDecimals: number, expiresAt: bigint) {
  const release = moduleEngineReleaseIdentity(releaseValue), account = moduleAddress(input.account, "account"), quoteAsset = moduleAddress(input.quoteAsset, "quoteAsset");
  computeModuleEngineHostManifestHash(manifest);
  need(manifest.manifest.release.releaseDigest === release.releaseDigest, "Manifest release differs.");
  const m = manifest.manifest;
  if (m.revision.fixedQuoteAsset !== ZERO) same(quoteAsset, m.revision.fixedQuoteAsset, "Fixed quote asset");
  need(Number.isInteger(quoteDecimals) && quoteDecimals >= 0 && quoteDecimals <= (isModuleEngineAnyQuoteRelease(release) ? 36 : 18), "Quote decimals are unsupported.");
  const name = input.name.trim(), symbol = input.symbol.trim(); need(name.length > 0 && new TextEncoder().encode(name).length <= MAX_TOKEN_NAME_BYTES && /^[A-Za-z0-9]{1,11}$/.test(symbol), "Check the token name and symbol.");
  need(new TextEncoder().encode(input.description).length <= MAX_TOKEN_DESCRIPTION_BYTES, "Description is too long.");
  const imageUri = input.imageUri || MODULE_DEFAULT_TOKEN_IMAGE; need(!validateTokenImage({ kind: "uri", uri: imageUri, contentVerified: false }), "Use a public HTTPS token image.");
  let configuration: Hex;
  if (isModuleEngineAnyQuoteRelease(release)) {
    need(input.anyQuotePreparation, "Any Quote requires a bound price and route preparation.");
    configuration = input.anyQuotePreparation.configuration;
    assertAnyQuoteConfiguration({ configuration, release, quoteAsset, now: expiresAt - 180n, validUntil: expiresAt });
  } else {
    need(!input.anyQuotePreparation, "Shared-quote preparation cannot configure another profile.");
    const config = compileOpenConfig(m.catalogDefinition.schema, input.configuration, { roles: { launchWallet: account }, assets: { quote: { chainId: "4663", address: quoteAsset, decimals: quoteDecimals } } });
    const constraints = evaluateOpenConstraints(m.catalogDefinition.constraints, { self: { schema: m.catalogDefinition.schema, value: config.value } }); need(constraints.ok, constraints.violations[0]?.message ?? "Configuration constraints failed.");
    configuration = encodeModuleEngineConfiguration(m.catalogDefinition.configurationAbi, config, m.catalogDefinition.schema);
  }
  const configurationHash = keccak256(configuration); need(configuration.length <= 16_384 * 2 + 2, "Configuration is too large.");
  if (m.revision.fixedConfigurationHash !== ZERO_HASH) same(configurationHash, m.revision.fixedConfigurationHash, "Fixed configuration");
  const host = release.contracts.host.address, creatorSalt = moduleEngineOptionalHash(input.creatorSalt, "creatorSalt");
  const graffiti = keccak256(encodeAbiParameters(parseAbiParameters("string,address,bytes32"), [isModuleEngineAnyQuoteRelease(release) ? ANY_QUOTE_TOKEN_GRAFFITI_DOMAIN : "programmable.module-engine.token.v1", account, creatorSalt]));
  const predictedToken = getCreate2Address({ from: release.contracts.tokenFactory.address, salt: keccak256(encodeAbiParameters(parseAbiParameters("string,string,uint8,address,bytes32"), [name, symbol, 18, host, graffiti])), bytecodeHash: release.tokenCreationCodeHash }).toLowerCase() as Address;
  need(predictedToken !== quoteAsset, "Primary and quote assets must differ.");
  const launchId = keccak256(encodeAbiParameters(parseAbiParameters("uint256,address,address,bytes32,bytes32"), [4663n, host, predictedToken, m.revision.packageId, configurationHash]));
  const context = { host, launchId, token: predictedToken, creator: account, quoteAsset, feeCollector: isModuleEngineAnyQuoteRelease(release) ? release.contracts.ledger.address : host }, constructorArgs = encodeAbiParameters(moduleEngineConstructorParameters, [context, configuration]);
  const constructorHash = keccak256(constructorArgs), initCodeHash = keccak256(concatHex([m.source.engine.creationBytecode, constructorArgs]));
  need((m.source.engine.creationBytecode.length + constructorArgs.length - 4) / 2 <= 49_152, "Engine init code exceeds the chain limit.");
  const engineCodeHash = keccak256(materializeModuleEngineRuntime(m.source.engine.runtimeTemplate, constructorArgs, m.source.engine.immutableRuntimeOffsets, m.source.engine.immutableConstructorOffsets));
  const initialSalt = moduleEngineOptionalHash(input.engineSalt, "engineSalt"); const engineIdentity = m.catalogDefinition.interface === "quote-v1" ? await minedSalt(host, account, initialSalt, launchId, initCodeHash) : { salt: initialSalt, address: predictModuleEngineAddress(host, account, initialSalt, launchId, initCodeHash) };
  const initialOperation = input.initialOperation ? moduleEngineOperation(input.initialOperation({ token: predictedToken, quoteAsset }), account, expiresAt, 0n) : emptyOperation();
  if (isModuleEngineAnyQuoteRelease(release)) need(initialOperation.operationId === ZERO_HASH || initialOperation.operationId === ANY_QUOTE_NATIVE_BUY_OPERATION_ID, "Any Quote only supports an optional initial ETH buy.");
  else same(initialOperation.operationId, m.revision.initialOperationId, "Required initial operation");
  need(input.creatorWallets.length > 0 && input.creatorWallets.length <= (isModuleEngineAnyQuoteRelease(release) ? 10 : 16) && input.creatorWallets.length === input.creatorSharesBps.length && input.creatorSharesBps.every(value => Number.isInteger(value) && value > 0 && value <= 10_000) && input.creatorSharesBps.reduce((sum, value) => sum + value, 0) === 10_000, "Creator shares must total 100%.");
  const creatorWallets = input.creatorWallets.map(wallet => moduleAddress(wallet, "creatorWallet")); need(new Set(creatorWallets).size === creatorWallets.length, "Creator recipients must be unique.");
  const buyCreatorFeeBps = fee(input.buyCreatorFeeBps), sellCreatorFeeBps = fee(input.sellCreatorFeeBps);
  const parameters = { name, symbol, creatorSalt, revisionId: m.revision.packageId, quoteAsset, configuration, creationCode: m.source.engine.creationBytecode, runtimeTemplate: m.source.engine.runtimeTemplate, engineSalt: engineIdentity.salt, launchData: moduleBytes(input.launchData ?? "0x", "launchData", 16_384), metadata: moduleTokenMetadata(input.description, imageUri, input.socialLinks), creatorWallets, creatorSharesBps: [...input.creatorSharesBps], buyCreatorFeeBps, sellCreatorFeeBps, initialOperation };
  const planHash = keccak256(encodeAbiParameters(moduleEnginePlanParameters, [4663n, host, account, parameters]));
  return { parameters, graffiti, predictedToken, launchId, configurationHash, constructorArgs, constructorHash, initCodeHash, engineCodeHash,
    context, engine: engineIdentity.address, planHash, quoteAsset, quoteDecimals, expiresAt, initialOperation, buyCreatorFeeBps, sellCreatorFeeBps };
}
