import "server-only";
import { createPublicClient, custom, decodeFunctionData, decodeFunctionResult, encodeFunctionData, erc20Abi, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { robinhoodChain } from "@/lib/chains";
import { moduleAddress, moduleHash } from "@/lib/module-mode/release";
import { assertModuleEngineRelease, readModuleEngineLaunch, type ModuleEngineClient } from "@/lib/module-engine/client";
import { isModuleEngineAnyQuoteRelease } from "@/lib/module-engine/profile";
import { compileModuleEngineLaunch, type ModuleEngineLaunchInputs } from "@/lib/module-engine/operation-plan";
import { moduleEngineAnyQuoteHostAbi, moduleEngineHostAbi } from "@/lib/module-engine/abi";
import { anyQuoteLaunchIntent, anyQuoteMinimumOutput, anyQuotePoolFor, anyQuoteSlippageBps, predictAnyQuoteToken,
  type AnyQuoteCompatibleReadiness, type AnyQuoteLaunchIntent, type AnyQuoteLaunchPreparation, type AnyQuoteTradeQuote } from "@/lib/module-engine/any-quote/integration";
import { encodeAnyQuoteConfigurationV1, planAnyQuoteInitialPriceV1 } from "@/lib/module-engine/any-quote/price";
import { anyQuoteEvidenceHashV1, anyQuoteModulePoolKeyV1, buildAnyQuoteSwapV1 } from "@/lib/module-engine/any-quote/route";
import { assessAnyQuoteAssetV1, requoteAnyQuoteExternalRouteV1, type AnyQuoteReadinessOptionsV1 } from "@/lib/module-engine/any-quote/readiness.server";
import { ANY_QUOTE_INFRASTRUCTURE, ANY_QUOTE_NATIVE_BUY_OPERATION_ID, ANY_QUOTE_NATIVE, AnyQuoteErrorV1,
  anyQuoteSameAddressV1, anyQuoteUintV1, type AnyQuoteCheckpointV1 } from "@/lib/module-engine/any-quote/types";
import { agreedTradeRpcV1, productionTradeRpcsV1, successfulTradeFramesV1, tradeTraceV1, type TradeRpcV1 } from "../custom-launch/routed-trade-rpc-v1";
import { readModuleEngineAvailability } from "./catalog";

type Selection = { releaseDigest: Hex; templateId: string };
export interface AnyQuoteIntegrationDependencies {
  availability?: typeof readModuleEngineAvailability; client?: ModuleEngineClient;
  readiness?: typeof assessAnyQuoteAssetV1; requote?: typeof requoteAnyQuoteExternalRouteV1;
  options?: AnyQuoteReadinessOptionsV1;
}
function options(deps: AnyQuoteIntegrationDependencies): AnyQuoteReadinessOptionsV1 {
  return deps.options ?? { apiKey: process.env.UNISWAP_TRADING_API_KEY ?? process.env.UNISWAP_API_KEY };
}
function rpcs(deps: AnyQuoteIntegrationDependencies): readonly [TradeRpcV1, TradeRpcV1] { return deps.options?.rpcs ?? productionTradeRpcsV1(); }
function clientFor(deps: AnyQuoteIntegrationDependencies): ModuleEngineClient {
  if (deps.client) return deps.client;
  const primary = rpcs(deps)[0];
  return createPublicClient({ chain: robinhoodChain, transport: custom({ request: ({ method, params }) => primary(method, (params ?? []) as readonly unknown[]) }), batch: { multicall: false } });
}
async function selection(input: Selection, deps: AnyQuoteIntegrationDependencies) {
  const digest = moduleHash(input.releaseDigest, "releaseDigest"), availability = await (deps.availability ?? readModuleEngineAvailability)(digest);
  const release = availability.release;
  if (!release || release.releaseDigest !== digest || !isModuleEngineAnyQuoteRelease(release)) throw new AnyQuoteErrorV1("MODULE_UNAVAILABLE");
  const template = availability.templates.find(t => t.manifest.manifest.catalogDefinition.id === input.templateId);
  if (!template || template.manifest.manifest.catalogDefinition.interface !== "quote-shared-v1") throw new AnyQuoteErrorV1("MODULE_UNAVAILABLE");
  return { availability, release, template };
}
export async function readAnyQuoteReadiness(input: Selection & { quoteAsset: string }, deps: AnyQuoteIntegrationDependencies = {}) {
  await selection(input, deps);
  return (deps.readiness ?? assessAnyQuoteAssetV1)({ quoteAsset: input.quoteAsset }, options(deps));
}
async function compatible(input: { quoteAsset: string; probeEthAmount?: bigint }, deps: AnyQuoteIntegrationDependencies): Promise<AnyQuoteCompatibleReadiness> {
  const result = await (deps.readiness ?? assessAnyQuoteAssetV1)(input, options(deps));
  if (result.status !== "compatible") throw new AnyQuoteErrorV1(result.code, result.status);
  return result;
}
const min = (...v: bigint[]) => v.reduce((a, b) => a < b ? a : b);
const quoterAbi = parseAbi(["function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)"]);
async function quoteModule(pool: AnyQuoteTradeQuote["pool"], buy: boolean, amountIn: bigint, checkpoint: AnyQuoteCheckpointV1, deps: AnyQuoteIntegrationDependencies): Promise<bigint> {
  const key = anyQuoteModulePoolKeyV1(pool), rpc = agreedTradeRpcV1(rpcs(deps)), ref = { blockHash: checkpoint.hash, requireCanonical: true };
  const runtime = await rpc("eth_getCode", [ANY_QUOTE_INFRASTRUCTURE.v4Quoter, ref], value => String(value) as Hex);
  if (keccak256(runtime) !== ANY_QUOTE_INFRASTRUCTURE.v4QuoterCodeHash) throw new AnyQuoteErrorV1("QUOTER_RUNTIME_MISMATCH");
  const data = encodeFunctionData({ abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne: anyQuoteSameAddressV1(buy ? pool.quoteAsset : pool.token, key.currency0), exactAmount: amountIn, hookData: "0x" }] });
  return rpc("eth_call", [{ to: ANY_QUOTE_INFRASTRUCTURE.v4Quoter, data }, ref], value => {
    const result = decodeFunctionResult({ abi: quoterAbi, functionName: "quoteExactInputSingle", data: String(value) as Hex });
    return anyQuoteUintV1(result[0].toString(), (1n << 128n) - 1n);
  });
}
/** Complete trade quote uses current onchain module fees and external AMM execution, never an indicative USD price. */
export async function readAnyQuoteTradeQuote(input: Selection & { account: Address; token: Address; recipient: Address; buy: boolean; inputAmount: string; slippageBps?: number }, deps: AnyQuoteIntegrationDependencies = {}): Promise<AnyQuoteTradeQuote> {
  const { release, template } = await selection(input, deps), client = clientFor(deps);
  const account = moduleAddress(input.account, "account"), recipient = moduleAddress(input.recipient, "recipient"), token = moduleAddress(input.token, "token"), amount = anyQuoteUintV1(input.inputAmount, (1n << 128n) - 1n), slippageBps = anyQuoteSlippageBps(input.slippageBps);
  if (typeof input.buy !== "boolean") throw new AnyQuoteErrorV1("INVALID_TRADE_SIDE");
  const launch = await readModuleEngineLaunch({ client, release, token });
  if (launch.revisionId !== template.manifest.manifest.revision.packageId) throw new AnyQuoteErrorV1("REVISION_MISMATCH");
  const pool = anyQuotePoolFor(token, launch.quoteAsset, release.contracts.sharedHook.address), readiness = await compatible({ quoteAsset: launch.quoteAsset, ...(input.buy ? { probeEthAmount: amount } : {}) }, deps);
  const actualPool = await client.readContract({ address: release.contracts.host.address, abi: moduleEngineAnyQuoteHostAbi, functionName: "poolIdOf", args: [launch.launchId], blockNumber: BigInt(readiness.checkpoint.number) });
  if (actualPool !== pool.poolId) throw new AnyQuoteErrorV1("POOL_ID_MISMATCH");
  let externalRoute = readiness.routes.buy, output: bigint;
  if (input.buy) output = await quoteModule(pool, true, BigInt(externalRoute.amountOut), externalRoute.checkpoint, deps);
  else {
    const quoteOut = await quoteModule(pool, false, amount, readiness.checkpoint, deps);
    externalRoute = await (deps.requote ?? requoteAnyQuoteExternalRouteV1)(readiness.routes.sell, quoteOut, options(deps));
    // A new external quote can use a later checkpoint. Requote the module at that same block, then reuse the validated topology at the corrected amount.
    const sameBlockOut = await quoteModule(pool, false, amount, externalRoute.checkpoint, deps);
    if (sameBlockOut !== quoteOut) throw new AnyQuoteErrorV1("QUOTE_STATE_CHANGED");
    output = BigInt(externalRoute.amountOut);
  }
  const validUntil = min(BigInt(readiness.validUntil), BigInt(externalRoute.validUntil)).toString();
  const quote: AnyQuoteTradeQuote = { schemaVersion: "programmable.any-quote.trade-quote.v1", releaseDigest: release.releaseDigest, templateId: input.templateId,
    account, token, quoteAsset: launch.quoteAsset, recipient, buy: input.buy, inputAmount: amount.toString(), output: output.toString(), minimumOutput: anyQuoteMinimumOutput(output, slippageBps).toString(), slippageBps,
    validUntil, checkpoint: externalRoute.checkpoint, pool, externalRoute, evidenceHash: "0x" };
  return { ...quote, evidenceHash: anyQuoteEvidenceHashV1({ ...quote, evidenceHash: undefined }) };
}

export type AnyQuoteLaunchPreviewInput = AnyQuoteLaunchIntent & Pick<ModuleEngineLaunchInputs, "description" | "imageUri" | "socialLinks">;
/** Predictable source-bound launch, with no output estimate until a real execution proves an optional first buy. */
export async function readAnyQuoteLaunchPreview(input: AnyQuoteLaunchPreviewInput, deps: AnyQuoteIntegrationDependencies = {}): Promise<AnyQuoteLaunchPreparation> {
  const intent = anyQuoteLaunchIntent(input), { release, template } = await selection(intent, deps), client = clientFor(deps);
  const [block, readiness] = await Promise.all([assertModuleEngineRelease({ client, release }), compatible({ quoteAsset: intent.quoteAsset, ...(BigInt(intent.initialBuyWei) > 0n ? { probeEthAmount: BigInt(intent.initialBuyWei) } : {}) }, deps)]);
  const predictedToken = predictAnyQuoteToken(intent, release), price = planAnyQuoteInitialPriceV1({ token: predictedToken, quoteAsset: intent.quoteAsset, quoteDecimals: readiness.token.decimals, quoteUsd: readiness.price.usd });
  const validUntil = min(block.timestamp + 180n, BigInt(readiness.validUntil)).toString();
  if (BigInt(validUntil) <= block.timestamp) throw new AnyQuoteErrorV1("READINESS_EXPIRED");
  const priceEvidenceHash = anyQuoteEvidenceHashV1({ domain: "programmable.any-quote.price-intent.v1", intent, readinessEvidenceHash: readiness.evidenceHash, price, validUntil });
  const encoded = encodeAnyQuoteConfigurationV1({ sharedHook: release.contracts.sharedHook.address, quoteAsset: intent.quoteAsset, initialTick: price.initialTick, validUntil: BigInt(validUntil), priceEvidenceHash });
  const preview: AnyQuoteLaunchPreparation = { schemaVersion: "programmable.any-quote.launch-preview.v1", intent, readiness, predictedToken,
    pool: anyQuotePoolFor(predictedToken, intent.quoteAsset, release.contracts.sharedHook.address), ...encoded, initialTick: price.initialTick, validUntil, actualFdvUsd: price.actualFdvUsd, initialBuy: null, evidenceHash: "0x" };
  if (BigInt(intent.initialBuyWei) > 0n) {
    const compiledRoute = buildAnyQuoteSwapV1({ pool: preview.pool, owner: intent.account, recipient: intent.account, side: "buy", amountIn: BigInt(intent.initialBuyWei), minimumAmountOut: 1n, deadline: BigInt(validUntil), externalRoute: readiness.routes.buy, now: block.timestamp });
    const compiled = await compileModuleEngineLaunch({ ...input, ...intent, configuration: {}, anyQuotePreparation: preview,
      initialOperation: () => ({ operationId: ANY_QUOTE_NATIVE_BUY_OPERATION_ID, recipient: intent.account, inputAsset: ANY_QUOTE_NATIVE, inputAmount: BigInt(intent.initialBuyWei), outputAsset: predictedToken, minimumOutput: 1n, data: compiledRoute.nativeBuyOperationData! }) }, release, template.manifest, readiness.token.decimals, BigInt(validUntil));
    const transaction = { from: intent.account, to: release.contracts.host.address, data: encodeFunctionData({ abi: moduleEngineHostAbi, functionName: "launch", args: [compiled.parameters] }), value: toHex(BigInt(intent.initialBuyWei)) };
    const rpc = agreedTradeRpcV1(rpcs(deps)), ref = { blockHash: readiness.checkpoint.hash, requireCanonical: true };
    // CONTRACT_BALANCE must never spend old router holdings, including in this preview.
    await Promise.all(compiledRoute.balanceAccounting.assets.filter(asset => !anyQuoteSameAddressV1(asset, predictedToken)).map(async asset => {
      const balance = anyQuoteSameAddressV1(asset, ANY_QUOTE_NATIVE)
        ? await rpc("eth_getBalance", [compiledRoute.transaction.to, ref], value => BigInt(String(value)))
        : await rpc("eth_call", [{ to: asset, data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [compiledRoute.transaction.to] }) }, ref], value => decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data: String(value) as Hex }));
      if (balance !== 0n) throw new AnyQuoteErrorV1("ROUTER_INTERMEDIATE_BALANCE");
    }));
    const trace = await rpc("debug_traceCall", [transaction, toHex(BigInt(readiness.checkpoint.number)), { tracer: "callTracer", timeout: "10s" }], tradeTraceV1);
    if (trace.failed || trace.type !== "CALL" || !anyQuoteSameAddressV1(trace.from, intent.account) || !trace.to || !anyQuoteSameAddressV1(trace.to, transaction.to)
      || trace.input !== transaction.data.toLowerCase() || BigInt(trace.value) !== BigInt(intent.initialBuyWei)) throw new AnyQuoteErrorV1("INITIAL_BUY_EXECUTION_INCONCLUSIVE");
    const output = successfulTradeFramesV1(trace).filter(frame => frame.to && anyQuoteSameAddressV1(frame.to, predictedToken) && anyQuoteSameAddressV1(frame.from, release.contracts.poolManager.address)).reduce((sum, frame) => {
      try { const decoded = decodeFunctionData({ abi: erc20Abi, data: frame.input }); return decoded.functionName === "transfer" && anyQuoteSameAddressV1(decoded.args[0], intent.account) && (frame.output === "0x" || decodeFunctionResult({ abi: erc20Abi, functionName: "transfer", data: frame.output }) === true) ? sum + decoded.args[1] : sum; } catch { return sum; }
    }, 0n);
    preview.initialBuy = { output: output.toString(), minimumOutput: anyQuoteMinimumOutput(output, intent.slippageBps).toString(), externalRoute: readiness.routes.buy };
  }
  return { ...preview, evidenceHash: anyQuoteEvidenceHashV1({ ...preview, evidenceHash: undefined }) };
}
