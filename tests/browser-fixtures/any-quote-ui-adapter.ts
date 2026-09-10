/** Local UI responses only. Deliberately ignores abort to test stale-response protection. */
import { keccak256, toHex, type Address, type Hex } from "viem";
import type { AnyQuoteReadinessV1 } from "@/lib/module-engine/any-quote/types";
import type { PrepareModuleEngineLaunchInput, PreparedModuleEngineLaunch } from "@/lib/module-engine/client";
import { ACCOUNT, TOKEN, addr, hash } from "../module-engine-fixture";

export const uiEvents = { checks: [] as string[], launches: [] as { quoteAsset: Address; initialBuyWei: bigint; buyCreatorFeeBps: number; sellCreatorFeeBps: number }[], submissions: [] as string[] };
const native = addr(0), zeroHash = hash(0);
export async function fetchAnyQuoteReadiness({ quoteAsset }: { quoteAsset: string }): Promise<AnyQuoteReadinessV1> {
  const address = quoteAsset.toLowerCase() as Address;
  uiEvents.checks.push(address);
  await new Promise(resolve => setTimeout(resolve, address.endsWith("0401") ? 1_300 : 60));
  if (address.endsWith("0402")) return { status: "incompatible", chainId: 4663, quoteAsset: address, code: "NON_ERC20", retryable: false };
  if (address.endsWith("0403") && uiEvents.checks.filter(value => value === address).length === 1) throw new Error("Local provider failure");
  const now = Math.floor(Date.now() / 1_000), validUntil = String(now + 120), checkpoint = { number: "100", hash: hash(100), timestamp: String(now) };
  const route = { provider: "weth-identity" as const, chainId: 4663 as const, tokenIn: address, tokenOut: address, amountIn: "1", amountOut: "1", hops: [], checkpoint, validUntil, evidenceHash: hash(20) };
  return { status: "compatible", chainId: 4663, quoteAsset: address, token: { name: address.endsWith("0401") ? "Slow previous token" : "Programmable", symbol: address.endsWith("0401") ? "OLD" : "PROGRAMMABLE", decimals: 18 }, checkpoint,
    price: { usd: { numerator: "1", denominator: "100" }, source: "qualified-amm", observedAt: String(now), validUntil, evidenceHash: hash(21), heartbeatSeconds: 60 },
    routes: { buy: route, sell: route }, validUntil, evidenceHash: hash(22), checks: { codeAndMetadata: "verified", routePools: "verified-at-checkpoint", externalQuotes: "same-block-bidirectional", fullExecution: "required-before-signing" } };
}
export async function prepareModuleEngineAnyQuoteLaunch(input: Omit<PrepareModuleEngineLaunchInput, "configuration" | "initialOperation"> & { initialBuyWei: bigint }): Promise<PreparedModuleEngineLaunch> {
  uiEvents.launches.push({ quoteAsset: input.quoteAsset, initialBuyWei: input.initialBuyWei, buyCreatorFeeBps: input.buyCreatorFeeBps, sellCreatorFeeBps: input.sellCreatorFeeBps });
  const release = input.availability.release!;
  const expiresAt = BigInt(Math.floor(Date.now() / 1_000) + 120);
  const outputAmount = input.initialBuyWei * 1_000n, minimumOutput = outputAmount * 99n / 100n;
  return { sourceKind: "module-engine-v1", kind: "launch", account: input.account, releaseDigest: release.releaseDigest, blockNumber: 100n, expiresAt, gasEstimate: 400_000n,
    transaction: { chainId: 4663, action: "launch", description: "Local Any Quote UI test", from: input.account, to: release.contracts.host.address, value: toHex(input.initialBuyWei), data: "0x" }, predictedToken: TOKEN, engine: addr(900), launchId: hash(10), revisionId: hash(11), planHash: hash(12), configurationHash: hash(13), engineCodeHash: hash(14), quoteAsset: input.quoteAsset, quoteDecimals: 18,
    initialOperation: { operationId: input.initialBuyWei > 0n ? keccak256(toHex("spot.buy.native-exact-input.v1")) : zeroHash, actor: ACCOUNT, recipient: ACCOUNT, inputAsset: native, inputAmount: input.initialBuyWei, outputAsset: TOKEN, minimumOutput, deadline: expiresAt, nonce: 0n, data: "0x" as Hex },
    platformFeeBps: 30, buyCreatorFeeBps: input.buyCreatorFeeBps, sellCreatorFeeBps: input.sellCreatorFeeBps,
    anyQuote: { initialBuyWei: input.initialBuyWei, outputAmount, minimumOutput, actualFdvUsd: { numerator: "499925", denominator: "100" } } };
}
export function quoteModuleEngineAnyQuoteTrade() { throw new Error("Use the integrated trade fixture for trade execution."); }
