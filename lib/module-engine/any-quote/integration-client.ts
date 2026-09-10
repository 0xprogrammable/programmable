"use client";
import type { Address, Hex } from "viem";
import type { ModuleEngineRelease, ModuleEngineTemplate } from "../catalog";
import { prepareModuleEngineAnyQuoteSwap, prepareModuleEngineLaunch, type ModuleEngineClient, type PrepareModuleEngineLaunchInput } from "../client";
import { ANY_QUOTE_NATIVE, ANY_QUOTE_NATIVE_BUY_OPERATION_ID, AnyQuoteErrorV1, anyQuoteSameAddressV1, type AnyQuoteReadinessV1 } from "./types";
import { assertAnyQuoteLaunchPreparation, anyQuoteLaunchIntent, type AnyQuoteLaunchPreparation, type AnyQuoteTradeQuote } from "./integration";
import { buildAnyQuoteSwapV1 } from "./route";

async function request<T>(endpoint: "readiness" | "launch-preview" | "trade-quote", body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/module-mode/any-quote/${endpoint}`, { method: "POST", cache: "no-store", credentials: "same-origin", signal,
    headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body) });
  if (Number(response.headers.get("content-length") ?? 0) > 131_072) throw new AnyQuoteErrorV1("PROVIDER_RESPONSE_INVALID");
  const value = await response.json();
  if (!response.ok && !(endpoint === "readiness" && (value?.status === "incompatible" || value?.status === "inconclusive"))) throw new AnyQuoteErrorV1(typeof value?.code === "string" ? value.code : "PROVIDER_UNAVAILABLE", value?.status === "incompatible" ? "incompatible" : "inconclusive");
  return value as T;
}
export async function fetchAnyQuoteReadiness(input: { releaseDigest: Hex; templateId: string; quoteAsset: Address | string; signal?: AbortSignal }): Promise<AnyQuoteReadinessV1> {
  const { signal, ...body } = input, result = await request<AnyQuoteReadinessV1>("readiness", body, signal);
  if (!["compatible", "incompatible", "inconclusive"].includes(result.status) || result.chainId !== 4663
    || (result.quoteAsset !== null && !anyQuoteSameAddressV1(result.quoteAsset, input.quoteAsset))) throw new AnyQuoteErrorV1("READINESS_RESPONSE_MISMATCH");
  return result;
}
export type PrepareModuleEngineAnyQuoteLaunchInput = Omit<PrepareModuleEngineLaunchInput, "configuration" | "initialOperation" | "anyQuotePreparation"> & { initialBuyWei: bigint; readiness?: AnyQuoteReadinessV1; slippageBps?: number };
export async function prepareModuleEngineAnyQuoteLaunch(input: PrepareModuleEngineAnyQuoteLaunchInput) {
  const release = input.availability.release; if (!release) throw new AnyQuoteErrorV1("MODULE_UNAVAILABLE");
  const intent = anyQuoteLaunchIntent({ ...input, releaseDigest: release.releaseDigest, initialBuyWei: input.initialBuyWei.toString(), slippageBps: input.slippageBps ?? 100 });
  const preview = await request<AnyQuoteLaunchPreparation>("launch-preview", { ...intent, description: input.description, imageUri: input.imageUri, socialLinks: input.socialLinks });
  assertAnyQuoteLaunchPreparation(preview, intent, release, BigInt(Math.floor(Date.now() / 1000)));
  const initialOperation = preview.initialBuy ? () => {
    const route = buildAnyQuoteSwapV1({ pool: preview.pool, owner: input.account, recipient: input.account, side: "buy", amountIn: input.initialBuyWei,
      minimumAmountOut: BigInt(preview.initialBuy!.minimumOutput), deadline: BigInt(preview.validUntil), externalRoute: preview.initialBuy!.externalRoute });
    return { operationId: ANY_QUOTE_NATIVE_BUY_OPERATION_ID, recipient: input.account, inputAsset: ANY_QUOTE_NATIVE, inputAmount: input.initialBuyWei,
      outputAsset: preview.predictedToken, minimumOutput: BigInt(preview.initialBuy!.minimumOutput), data: route.nativeBuyOperationData! };
  } : undefined;
  return prepareModuleEngineLaunch({ ...input, configuration: {}, anyQuotePreparation: preview, initialOperation });
}
export async function quoteModuleEngineAnyQuoteTrade(input: { client: ModuleEngineClient; release: ModuleEngineRelease; template: ModuleEngineTemplate; account: Address; token: Address; buy: boolean; inputAmount: bigint; recipient: Address; slippageBps?: number }) {
  const quote = await request<AnyQuoteTradeQuote>("trade-quote", { releaseDigest: input.release.releaseDigest, templateId: input.template.manifest.manifest.catalogDefinition.id,
    account: input.account, token: input.token, buy: input.buy, inputAmount: input.inputAmount.toString(), recipient: input.recipient, slippageBps: input.slippageBps ?? 100 });
  if (quote.buy !== input.buy || quote.inputAmount !== input.inputAmount.toString() || !anyQuoteSameAddressV1(quote.token, input.token)
    || !anyQuoteSameAddressV1(quote.recipient, input.recipient) || quote.slippageBps !== (input.slippageBps ?? 100)) throw new AnyQuoteErrorV1("TRADE_PREVIEW_MISMATCH");
  const prepared = await prepareModuleEngineAnyQuoteSwap({ ...input, quote });
  if (prepared.kind === "approval-required") return prepared;
  return { kind: "trade-quote" as const, output: BigInt(quote.output), minimumOutput: BigInt(quote.minimumOutput), prepared };
}
