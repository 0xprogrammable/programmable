import { decodeAbiParameters, getCreate2Address, encodeAbiParameters, keccak256, parseAbiParameters, type Address, type Hex } from "viem";
import type { ModuleEngineReleaseIdentity } from "../catalog";
import { isModuleEngineAnyQuoteRelease } from "../profile";
import { anyQuoteEvidenceHashV1, anyQuotePoolIdV1 } from "./route";
import { encodeAnyQuoteConfigurationV1, planAnyQuoteInitialPriceV1 } from "./price";
import { ANY_QUOTE_INFRASTRUCTURE, ANY_QUOTE_SCHEMA_ID, AnyQuoteErrorV1, anyQuoteAddressV1, anyQuoteSameAddressV1,
  type AnyQuoteCheckpointV1, type AnyQuoteExternalRouteV1, type AnyQuoteModulePoolV1, type AnyQuoteReadinessV1 } from "./types";

export type AnyQuoteCompatibleReadiness = Extract<AnyQuoteReadinessV1, { status: "compatible" }>;
export interface AnyQuoteLaunchIntent {
  releaseDigest: Hex; templateId: string; account: Address; quoteAsset: Address; name: string; symbol: string;
  creatorSalt: Hex; engineSalt: Hex; buyCreatorFeeBps: number; sellCreatorFeeBps: number;
  creatorWallets: readonly Address[]; creatorSharesBps: readonly number[]; initialBuyWei: string; slippageBps: number;
}
export interface AnyQuoteLaunchPreparation {
  schemaVersion: "programmable.any-quote.launch-preview.v1"; intent: AnyQuoteLaunchIntent;
  readiness: AnyQuoteCompatibleReadiness; predictedToken: Address; pool: AnyQuoteModulePoolV1;
  configuration: Hex; configurationHash: Hex; initialTick: number; validUntil: string;
  actualFdvUsd: { numerator: string; denominator: string }; evidenceHash: Hex;
  initialBuy: null | { output: string; minimumOutput: string; externalRoute: AnyQuoteExternalRouteV1 };
}
export interface AnyQuoteTradeQuote {
  schemaVersion: "programmable.any-quote.trade-quote.v1"; releaseDigest: Hex; templateId: string;
  account: Address; token: Address; quoteAsset: Address; recipient: Address; buy: boolean; inputAmount: string;
  output: string; minimumOutput: string; slippageBps: number; validUntil: string; checkpoint: AnyQuoteCheckpointV1;
  pool: AnyQuoteModulePoolV1; externalRoute: AnyQuoteExternalRouteV1; evidenceHash: Hex;
}
export const ANY_QUOTE_CONFIGURATION_PARAMETERS = parseAbiParameters("bytes32,address,bytes32,address,address,int24,uint64,bytes32");
export function anyQuoteSlippageBps(value = 100): number {
  if (!Number.isInteger(value) || value < 0 || value > 1_000) throw new AnyQuoteErrorV1("INVALID_SLIPPAGE");
  return value;
}
export function anyQuoteMinimumOutput(output: bigint, slippageBps: number): bigint {
  const minimum = output * BigInt(10_000 - anyQuoteSlippageBps(slippageBps)) / 10_000n;
  if (minimum <= 0n) throw new AnyQuoteErrorV1("OUTPUT_TOO_SMALL");
  return minimum;
}
export function predictAnyQuoteToken(input: Pick<AnyQuoteLaunchIntent, "account" | "creatorSalt" | "name" | "symbol">, release: ModuleEngineReleaseIdentity): Address {
  const graffiti = keccak256(encodeAbiParameters(parseAbiParameters("string,address,bytes32"), ["programmable.module-engine.token.v1", input.account, input.creatorSalt]));
  return getCreate2Address({ from: release.contracts.tokenFactory.address,
    salt: keccak256(encodeAbiParameters(parseAbiParameters("string,string,uint8,address,bytes32"), [input.name.trim(), input.symbol.trim(), 18, release.contracts.host.address, graffiti])),
    bytecodeHash: release.tokenCreationCodeHash }).toLowerCase() as Address;
}
export function anyQuoteLaunchIntent(input: AnyQuoteLaunchIntent): AnyQuoteLaunchIntent {
  const fee = (n: number) => { if (!Number.isInteger(n) || n < 0 || n > 1000 || n % 100) throw new AnyQuoteErrorV1("INVALID_CREATOR_FEE"); return n; };
  const hash = (v: Hex) => { if (!/^0x[0-9a-f]{64}$/i.test(v)) throw new AnyQuoteErrorV1("INVALID_HASH"); return v.toLowerCase() as Hex; };
  if (!/^(0|[1-9][0-9]{0,38})$/.test(input.initialBuyWei) || BigInt(input.initialBuyWei) >= 1n << 128n) throw new AnyQuoteErrorV1("INVALID_AMOUNT");
  if (!input.templateId || input.templateId.length > 128 || !input.name.trim() || !/^[A-Za-z0-9]{1,11}$/.test(input.symbol.trim())) throw new AnyQuoteErrorV1("INVALID_LAUNCH_INTENT");
  if (!Array.isArray(input.creatorWallets) || input.creatorWallets.length < 1 || input.creatorWallets.length > 16 || input.creatorWallets.length !== input.creatorSharesBps.length
    || input.creatorSharesBps.some(n => !Number.isInteger(n) || n <= 0 || n > 10_000) || input.creatorSharesBps.reduce((a, b) => a + b, 0) !== 10_000) throw new AnyQuoteErrorV1("INVALID_CREATOR_SHARES");
  const creatorWallets = input.creatorWallets.map(a => anyQuoteAddressV1(a).toLowerCase() as Address);
  if (new Set(creatorWallets).size !== creatorWallets.length) throw new AnyQuoteErrorV1("INVALID_CREATOR_SHARES");
  return { releaseDigest: hash(input.releaseDigest), templateId: input.templateId, account: anyQuoteAddressV1(input.account).toLowerCase() as Address,
    quoteAsset: anyQuoteAddressV1(input.quoteAsset).toLowerCase() as Address, name: input.name.trim(), symbol: input.symbol.trim(),
    creatorSalt: hash(input.creatorSalt), engineSalt: hash(input.engineSalt), buyCreatorFeeBps: fee(input.buyCreatorFeeBps), sellCreatorFeeBps: fee(input.sellCreatorFeeBps),
    creatorWallets, creatorSharesBps: [...input.creatorSharesBps], initialBuyWei: input.initialBuyWei, slippageBps: anyQuoteSlippageBps(input.slippageBps) };
}
export function anyQuotePoolFor(token: Address, quoteAsset: Address, sharedHook: Address): AnyQuoteModulePoolV1 {
  const [currency0, currency1] = BigInt(token) < BigInt(quoteAsset) ? [token, quoteAsset] : [quoteAsset, token];
  return { token, quoteAsset, sharedHook, poolId: anyQuotePoolIdV1({ currency0, currency1, fee: 0, tickSpacing: 200, hooks: sharedHook }) };
}
export function assertAnyQuoteConfiguration(input: { configuration: Hex; release: ModuleEngineReleaseIdentity; quoteAsset: Address; now: bigint; validUntil: bigint }) {
  if (!isModuleEngineAnyQuoteRelease(input.release) || !/^0x[0-9a-f]{512}$/i.test(input.configuration)) throw new AnyQuoteErrorV1("INVALID_CONFIGURATION");
  const [schema, manager, managerHash, hook, quote, tick, expiry, evidence] = decodeAbiParameters(ANY_QUOTE_CONFIGURATION_PARAMETERS, input.configuration);
  if (schema !== ANY_QUOTE_SCHEMA_ID || !anyQuoteSameAddressV1(manager, input.release.contracts.poolManager.address)
    || managerHash !== input.release.contracts.poolManager.runtimeCodeHash || !anyQuoteSameAddressV1(hook, input.release.contracts.sharedHook.address)
    || !anyQuoteSameAddressV1(quote, input.quoteAsset) || tick % 200 !== 0 || tick <= -887200 || tick >= 887200
    || expiry !== input.validUntil || expiry <= input.now || expiry > input.now + 180n || BigInt(evidence) === 0n) throw new AnyQuoteErrorV1("INVALID_CONFIGURATION");
  if (!anyQuoteSameAddressV1(manager, ANY_QUOTE_INFRASTRUCTURE.poolManager) || managerHash !== ANY_QUOTE_INFRASTRUCTURE.poolManagerCodeHash) throw new AnyQuoteErrorV1("INFRASTRUCTURE_MISMATCH");
  return { initialTick: tick, validUntil: expiry, priceEvidenceHash: evidence };
}
/** A preview commits to the exact actor and economics; its hash is provenance, not a new signing authority. */
export function assertAnyQuoteLaunchPreparation(preview: AnyQuoteLaunchPreparation, expected: AnyQuoteLaunchIntent, release: ModuleEngineReleaseIdentity, now: bigint) {
  const intent = anyQuoteLaunchIntent(expected);
  if (!isModuleEngineAnyQuoteRelease(release) || preview.schemaVersion !== "programmable.any-quote.launch-preview.v1"
    || anyQuoteEvidenceHashV1(preview.intent) !== anyQuoteEvidenceHashV1(intent) || preview.evidenceHash !== anyQuoteEvidenceHashV1({ ...preview, evidenceHash: undefined })
    || !anyQuoteSameAddressV1(preview.predictedToken, predictAnyQuoteToken(intent, release)) || preview.readiness.status !== "compatible"
    || !anyQuoteSameAddressV1(preview.readiness.quoteAsset, intent.quoteAsset) || BigInt(preview.validUntil) > BigInt(preview.readiness.validUntil)) throw new AnyQuoteErrorV1("LAUNCH_PREVIEW_MISMATCH");
  const price = planAnyQuoteInitialPriceV1({ token: preview.predictedToken, quoteAsset: intent.quoteAsset, quoteDecimals: preview.readiness.token.decimals, quoteUsd: preview.readiness.price.usd });
  const evidenceHash = anyQuoteEvidenceHashV1({ domain: "programmable.any-quote.price-intent.v1", intent, readinessEvidenceHash: preview.readiness.evidenceHash, price, validUntil: preview.validUntil });
  const encoded = encodeAnyQuoteConfigurationV1({ sharedHook: release.contracts.sharedHook.address, quoteAsset: intent.quoteAsset, initialTick: price.initialTick, validUntil: BigInt(preview.validUntil), priceEvidenceHash: evidenceHash });
  if (encoded.configuration !== preview.configuration || encoded.configurationHash !== preview.configurationHash || price.initialTick !== preview.initialTick
    || anyQuoteEvidenceHashV1(price.actualFdvUsd) !== anyQuoteEvidenceHashV1(preview.actualFdvUsd)
    || anyQuoteEvidenceHashV1(anyQuotePoolFor(preview.predictedToken, intent.quoteAsset, release.contracts.sharedHook.address)) !== anyQuoteEvidenceHashV1(preview.pool)
    || (BigInt(intent.initialBuyWei) === 0n) !== (preview.initialBuy === null)) throw new AnyQuoteErrorV1("LAUNCH_PREVIEW_MISMATCH");
  assertAnyQuoteConfiguration({ configuration: preview.configuration, release, quoteAsset: intent.quoteAsset, now, validUntil: BigInt(preview.validUntil) });
  return preview;
}
