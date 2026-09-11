import "server-only";
import { createPublicClient, custom, encodeAbiParameters, decodeFunctionData, decodeFunctionResult, encodeFunctionData, erc20Abi, keccak256, parseAbi, toHex, type Address, type Hex } from "viem";
import { robinhoodChain } from "@/lib/chains";
import { moduleAddress } from "@/lib/module-mode/release";
import { assertModuleEngineSourceIdentityV1, readModuleEngineSourceLaunchV1, readModuleEngineSourceTemplateV1, type ModuleEngineClient } from "@/lib/module-engine/client";
import { isModuleEngineSharedQuoteRelease, isModuleEngineAnyQuoteEthRelease } from "@/lib/module-engine/profile";
import { compileModuleEngineLaunch, type ModuleEngineLaunchInputs } from "@/lib/module-engine/operation-plan";
import { moduleEngineAnyQuoteHostAbi, moduleEngineHostAbi } from "@/lib/module-engine/abi";
import { anyQuoteLaunchIntent, anyQuoteMinimumOutput, anyQuotePoolFor, anyQuoteSlippageBps, predictAnyQuoteToken,
  type AnyQuoteCompatibleReadiness, type AnyQuoteLaunchIntent, type AnyQuoteLaunchPreparation, type AnyQuoteTradeQuote } from "@/lib/module-engine/any-quote/integration";
import { encodeAnyQuoteConfigurationV1, planAnyQuoteInitialPriceV1 } from "@/lib/module-engine/any-quote/price";
import { anyQuoteEvidenceHashV1, anyQuoteModulePoolKeyV1, anyQuoteSwapPathV1, buildAnyQuoteSwapV1 } from "@/lib/module-engine/any-quote/route";
import { assessAnyQuoteAssetV1, requoteAnyQuoteExternalRouteV1, type AnyQuoteReadinessOptionsV1 } from "@/lib/module-engine/any-quote/readiness.server";
import { ANY_QUOTE_INFRASTRUCTURE, ANY_QUOTE_NATIVE_BUY_OPERATION_ID, ANY_QUOTE_NATIVE, AnyQuoteErrorV1,
  anyQuoteSameAddressV1, anyQuoteUintV1, type AnyQuoteCheckpointV1 } from "@/lib/module-engine/any-quote/types";
import { agreedTradeRpcV1, productionTradeRpcsV1, successfulTradeFramesV1, tradeTraceV1, type TradeRpcV1 } from "../custom-launch/routed-trade-rpc-v1";
import { bindModuleEngineReleaseIdentity, bindModuleEngineTemplate, type ModuleEngineReleaseIdentity, type ModuleEngineTemplate } from "@/lib/module-engine/catalog";
import { anyQuoteNativeFeeRouteAbi, anyQuoteNativeFeeRouteFromExternal, decodeAnyQuoteNativeFeeRoute, ANY_QUOTE_NATIVE_FEE_ROUTE_PARAMETERS } from "@/lib/module-engine/any-quote/native-fee-route";
import { verifyAnyQuoteLaunchSettlementV1 } from "./any-quote-settlement";

export type AnyQuoteIdentitySelectionV1 = { identity: ModuleEngineReleaseIdentity; template: ModuleEngineTemplate };
type Selection = { releaseDigest: Hex; templateId: string };
export interface AnyQuoteIdentityPreparationDependenciesV1 {
  client?: ModuleEngineClient;
  readiness?: typeof assessAnyQuoteAssetV1; requote?: typeof requoteAnyQuoteExternalRouteV1;
  options?: AnyQuoteReadinessOptionsV1;
}
export function anyQuotePreparationOptionsV1(deps: AnyQuoteIdentityPreparationDependenciesV1): AnyQuoteReadinessOptionsV1 {
  return deps.options ?? { apiKey: process.env.UNISWAP_TRADING_API_KEY ?? process.env.UNISWAP_API_KEY };
}
function rpcs(deps: AnyQuoteIdentityPreparationDependenciesV1): readonly [TradeRpcV1, TradeRpcV1] { return deps.options?.rpcs ?? productionTradeRpcsV1(); }
export function anyQuotePreparationClientV1(deps: AnyQuoteIdentityPreparationDependenciesV1): ModuleEngineClient {
  if (deps.client) return deps.client;
  const primary = rpcs(deps)[0];
  return createPublicClient({ chain: robinhoodChain, transport: custom({ request: ({ method, params }) => primary(method, (params ?? []) as readonly unknown[]) }), batch: { multicall: false } });
}
function identitySelection(input: Selection & AnyQuoteIdentitySelectionV1) {
  const release = bindModuleEngineReleaseIdentity(input.identity);
  if (!isModuleEngineSharedQuoteRelease(release) || input.releaseDigest !== release.releaseDigest) throw new AnyQuoteErrorV1("SOURCE_IDENTITY_MISMATCH");
  const template = bindModuleEngineTemplate(input.template, release);
  if (template.manifest.manifest.catalogDefinition.interface !== "quote-shared-v1" || template.manifest.manifest.catalogDefinition.id !== input.templateId) throw new AnyQuoteErrorV1("REVISION_MISMATCH");
  return { release, template };
}
async function compatible(input: { quoteAsset: string; probeEthAmount?: bigint }, deps: AnyQuoteIdentityPreparationDependenciesV1): Promise<AnyQuoteCompatibleReadiness> {
  const result = await (deps.readiness ?? assessAnyQuoteAssetV1)(input, anyQuotePreparationOptionsV1(deps));
  if (result.status !== "compatible") throw new AnyQuoteErrorV1(result.code, result.status);
  return result;
}
const min = (...v: bigint[]) => v.reduce((a, b) => a < b ? a : b);
const quoterAbi = parseAbi(["function quoteExactInputSingle(((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 exactAmount,bytes hookData) params) returns (uint256 amountOut,uint256 gasEstimate)"]);
async function quoteModule(pool: AnyQuoteTradeQuote["pool"], buy: boolean, amountIn: bigint, checkpoint: AnyQuoteCheckpointV1, deps: AnyQuoteIdentityPreparationDependenciesV1): Promise<bigint> {
  const key = anyQuoteModulePoolKeyV1(pool), rpc = agreedTradeRpcV1(rpcs(deps)), ref = { blockHash: checkpoint.hash, requireCanonical: true };
  const runtime = await rpc("eth_getCode", [ANY_QUOTE_INFRASTRUCTURE.v4Quoter, ref], value => String(value) as Hex);
  if (keccak256(runtime) !== ANY_QUOTE_INFRASTRUCTURE.v4QuoterCodeHash) throw new AnyQuoteErrorV1("QUOTER_RUNTIME_MISMATCH");
  const data = encodeFunctionData({ abi: quoterAbi, functionName: "quoteExactInputSingle", args: [{ poolKey: key, zeroForOne: anyQuoteSameAddressV1(buy ? pool.quoteAsset : pool.token, key.currency0), exactAmount: amountIn, hookData: "0x" }] });
  const output = await rpc("eth_call", [{ to: ANY_QUOTE_INFRASTRUCTURE.v4Quoter, data }, ref], value => {
    const result = decodeFunctionResult({ abi: quoterAbi, functionName: "quoteExactInputSingle", data: String(value) as Hex });
    // Provider agreement compares canonical JSON; retain exact raw units as a decimal string there.
    return anyQuoteUintV1(result[0].toString(), (1n << 128n) - 1n).toString();
  });
  return BigInt(output);
}
const fullQuoterAbi = parseAbi(["function quoteExactInput((address exactCurrency,(address intermediateCurrency,uint24 fee,int24 tickSpacing,address hooks,bytes hookData)[] path,uint128 exactAmount) params) returns (uint256 amountOut,uint256 gasEstimate)"]);
async function quoteCombinedNativeTrade(pool: AnyQuoteTradeQuote["pool"], buy: boolean, amountIn: bigint, route: AnyQuoteTradeQuote["externalRoute"], deps: AnyQuoteIdentityPreparationDependenciesV1) {
  const rpc = agreedTradeRpcV1(rpcs(deps)), ref = { blockHash: route.checkpoint.hash, requireCanonical: true };
  const runtime = await rpc("eth_getCode", [ANY_QUOTE_INFRASTRUCTURE.v4Quoter, ref], value => String(value) as Hex);
  if (keccak256(runtime) !== ANY_QUOTE_INFRASTRUCTURE.v4QuoterCodeHash) throw new AnyQuoteErrorV1("QUOTER_RUNTIME_MISMATCH");
  const path = anyQuoteSwapPathV1(pool, buy ? "buy" : "sell", route);
  const data = encodeFunctionData({ abi: fullQuoterAbi, functionName: "quoteExactInput", args: [{ exactCurrency: buy ? ANY_QUOTE_NATIVE : pool.token, path, exactAmount: amountIn }] });
  const result = await rpc("eth_call", [{ to: ANY_QUOTE_INFRASTRUCTURE.v4Quoter, data }, ref], value => {
    const [amount] = decodeFunctionResult({ abi: fullQuoterAbi, functionName: "quoteExactInput", data: String(value) as Hex });
    return anyQuoteUintV1(amount.toString(), (1n << 127n) - 1n).toString();
  });
  return BigInt(result);
}

/** Complete trade quote uses current onchain module fees and external AMM execution, never an indicative USD price. */
export type AnyQuoteTradeQuoteInputV1 = Selection & { account: Address; token: Address; recipient: Address; buy: boolean; inputAmount: string; slippageBps?: number };
export async function readAnyQuoteIdentityTradeQuoteV1(input: AnyQuoteTradeQuoteInputV1 & AnyQuoteIdentitySelectionV1, deps: AnyQuoteIdentityPreparationDependenciesV1 = {}): Promise<AnyQuoteTradeQuote> {
  const { release, template } = identitySelection(input), client = anyQuotePreparationClientV1(deps);
  const account = moduleAddress(input.account, "account"), recipient = moduleAddress(input.recipient, "recipient"), token = moduleAddress(input.token, "token"), amount = anyQuoteUintV1(input.inputAmount, (1n << 128n) - 1n), slippageBps = anyQuoteSlippageBps(input.slippageBps);
  if (typeof input.buy !== "boolean") throw new AnyQuoteErrorV1("INVALID_TRADE_SIDE");
  const [launch] = await Promise.all([readModuleEngineSourceLaunchV1({ client, identity: release, token }), readModuleEngineSourceTemplateV1({ client, identity: release, template, newLaunch: false })]);
  if (launch.revisionId !== template.manifest.manifest.revision.packageId) throw new AnyQuoteErrorV1("REVISION_MISMATCH");
  const pool = anyQuotePoolFor(token, launch.quoteAsset, release.contracts.sharedHook.address), readiness = await compatible({ quoteAsset: launch.quoteAsset, ...(input.buy ? { probeEthAmount: amount } : {}) }, deps);
  const actualPool = await client.readContract({ address: release.contracts.host.address, abi: moduleEngineAnyQuoteHostAbi, functionName: "poolIdOf", args: [launch.launchId], blockNumber: BigInt(readiness.checkpoint.number) });
  if (actualPool !== pool.poolId) throw new AnyQuoteErrorV1("POOL_ID_MISMATCH");
  let externalRoute = readiness.routes.buy, output: bigint;
  let nativeFeeRouteHash: Hex | undefined;
  if (isModuleEngineAnyQuoteEthRelease(release)) {
    externalRoute = input.buy ? readiness.routes.buy : readiness.routes.sell;
    const hops = await client.readContract({ address: release.contracts.sharedHook.address, abi: anyQuoteNativeFeeRouteAbi, functionName: "nativeFeeRoute", args: [pool.poolId], blockNumber: BigInt(externalRoute.checkpoint.number) });
    const route = decodeAnyQuoteNativeFeeRoute(encodeAbiParameters(ANY_QUOTE_NATIVE_FEE_ROUTE_PARAMETERS, [hops]), pool);
    nativeFeeRouteHash = await client.readContract({ address: release.contracts.sharedHook.address, abi: anyQuoteNativeFeeRouteAbi, functionName: "nativeFeeRouteHash", args: [pool.poolId], blockNumber: BigInt(externalRoute.checkpoint.number) });
    if (route.routeHash !== nativeFeeRouteHash) throw new AnyQuoteErrorV1("NATIVE_FEE_ROUTE_MISMATCH");
    // Actual full-path Core execution includes the nested fee conversion and shared external-pool state.
    // Quoter reverts its simulation, so no allowance or invented user funding is needed for a quote.
    output = await quoteCombinedNativeTrade(pool, input.buy, amount, externalRoute, deps);
  } else if (input.buy) output = await quoteModule(pool, true, BigInt(externalRoute.amountOut), externalRoute.checkpoint, deps);
  else {
    const quoteOut = await quoteModule(pool, false, amount, readiness.checkpoint, deps);
    externalRoute = await (deps.requote ?? requoteAnyQuoteExternalRouteV1)(readiness.routes.sell, quoteOut, anyQuotePreparationOptionsV1(deps));
    // A new external quote can use a later checkpoint. Requote the module at that same block, then reuse the validated topology at the corrected amount.
    const sameBlockOut = await quoteModule(pool, false, amount, externalRoute.checkpoint, deps);
    if (sameBlockOut !== quoteOut) throw new AnyQuoteErrorV1("QUOTE_STATE_CHANGED");
    output = BigInt(externalRoute.amountOut);
  }
  const validUntil = min(BigInt(readiness.validUntil), BigInt(externalRoute.validUntil)).toString();
  const quote: AnyQuoteTradeQuote = { schemaVersion: "programmable.any-quote.trade-quote.v1", releaseDigest: release.releaseDigest, templateId: input.templateId,
    account, token, quoteAsset: launch.quoteAsset, recipient, buy: input.buy, inputAmount: amount.toString(), output: output.toString(), minimumOutput: anyQuoteMinimumOutput(output, slippageBps).toString(), slippageBps,
    validUntil, checkpoint: externalRoute.checkpoint, pool, externalRoute, ...(nativeFeeRouteHash ? { nativeFeeRouteHash } : {}), evidenceHash: "0x" };
  return { ...quote, evidenceHash: anyQuoteEvidenceHashV1({ ...quote, evidenceHash: undefined }) };
}

export type AnyQuoteLaunchPreviewInput = AnyQuoteLaunchIntent & Pick<ModuleEngineLaunchInputs, "description" | "imageUri" | "socialLinks">;
/** Predictable source-bound launch, with no output estimate until a real execution proves an optional first buy. */
export async function readAnyQuoteIdentityLaunchPreviewV1(input: AnyQuoteLaunchPreviewInput & AnyQuoteIdentitySelectionV1, deps: AnyQuoteIdentityPreparationDependenciesV1 = {}): Promise<AnyQuoteLaunchPreparation> {
  const intent = anyQuoteLaunchIntent(input), { release, template } = identitySelection({ ...input, ...intent }), client = anyQuotePreparationClientV1(deps);
  const [block, readiness] = await Promise.all([assertModuleEngineSourceIdentityV1({ client, identity: release }), compatible({ quoteAsset: intent.quoteAsset, ...(BigInt(intent.initialBuyWei) > 0n ? { probeEthAmount: BigInt(intent.initialBuyWei) } : {}) }, deps)]);
  await readModuleEngineSourceTemplateV1({ client, identity: release, template, newLaunch: true, blockNumber: block.blockNumber });
  const predictedToken = predictAnyQuoteToken(intent, release), price = planAnyQuoteInitialPriceV1({ token: predictedToken, quoteAsset: intent.quoteAsset, quoteDecimals: readiness.token.decimals, quoteUsd: readiness.price.usd });
  const validUntil = min(block.timestamp + 180n, BigInt(readiness.validUntil)).toString();
  if (BigInt(validUntil) <= block.timestamp) throw new AnyQuoteErrorV1("READINESS_EXPIRED");
  if (!isModuleEngineAnyQuoteEthRelease(release)) await verifyAnyQuoteLaunchSettlementV1({ account: intent.account, ledger: release.contracts.ledger.address,
    creatorWallets: intent.creatorWallets, buyCreatorFeeBps: intent.buyCreatorFeeBps, sellCreatorFeeBps: intent.sellCreatorFeeBps,
    externalRoute: readiness.routes.buy, deadline: BigInt(validUntil), now: block.timestamp, rpcs: rpcs(deps) });
  const priceEvidenceHash = anyQuoteEvidenceHashV1({ domain: "programmable.any-quote.price-intent.v1", intent, readinessEvidenceHash: readiness.evidenceHash, price, validUntil });
  const encoded = encodeAnyQuoteConfigurationV1({ sharedHook: release.contracts.sharedHook.address, quoteAsset: intent.quoteAsset, initialTick: price.initialTick, validUntil: BigInt(validUntil), priceEvidenceHash });
  const preview: AnyQuoteLaunchPreparation = { schemaVersion: "programmable.any-quote.launch-preview.v1", intent, readiness, predictedToken,
    pool: anyQuotePoolFor(predictedToken, intent.quoteAsset, release.contracts.sharedHook.address), ...encoded, initialTick: price.initialTick, validUntil, actualFdvUsd: price.actualFdvUsd, initialBuy: null, evidenceHash: "0x" };
  if (isModuleEngineAnyQuoteEthRelease(release)) preview.nativeFeeRoute = anyQuoteNativeFeeRouteFromExternal(readiness.routes.sell, preview.pool);
  if (BigInt(intent.initialBuyWei) > 0n) {
    const compiledRoute = buildAnyQuoteSwapV1({ pool: preview.pool, owner: intent.account, recipient: intent.account, side: "buy", amountIn: BigInt(intent.initialBuyWei), minimumAmountOut: 1n, deadline: BigInt(validUntil), externalRoute: readiness.routes.buy, now: block.timestamp });
    const compiled = await compileModuleEngineLaunch({ ...input, ...intent, configuration: {}, anyQuotePreparation: preview,
      initialOperation: () => ({ operationId: ANY_QUOTE_NATIVE_BUY_OPERATION_ID, recipient: intent.account, inputAsset: ANY_QUOTE_NATIVE, inputAmount: BigInt(intent.initialBuyWei), outputAsset: predictedToken, minimumOutput: 1n, data: compiledRoute.nativeBuyOperationData! }) }, release, template.manifest, readiness.token.decimals, BigInt(validUntil));
    const transaction = { from: intent.account, to: release.contracts.host.address, data: encodeFunctionData({ abi: moduleEngineHostAbi, functionName: "launch", args: [compiled.parameters] }), value: toHex(BigInt(intent.initialBuyWei)) };
    const rpc = agreedTradeRpcV1(rpcs(deps));
    if (String(compiledRoute.balanceAccounting.mode) !== "unlock-deltas") throw new AnyQuoteErrorV1("ROUTE_ACCOUNTING_UNSUPPORTED");
    const trace = await rpc("debug_traceCall", [transaction, { blockHash: readiness.checkpoint.hash, requireCanonical: true }, { tracer: "callTracer", timeout: "10s" }], tradeTraceV1);
    if (trace.failed || trace.type !== "CALL" || !anyQuoteSameAddressV1(trace.from, intent.account) || !trace.to || !anyQuoteSameAddressV1(trace.to, transaction.to)
      || trace.input !== transaction.data.toLowerCase() || BigInt(trace.value) !== BigInt(intent.initialBuyWei)) throw new AnyQuoteErrorV1("INITIAL_BUY_EXECUTION_INCONCLUSIVE");
    const output = successfulTradeFramesV1(trace).filter(frame => frame.to && anyQuoteSameAddressV1(frame.to, predictedToken) && anyQuoteSameAddressV1(frame.from, release.contracts.poolManager.address)).reduce((sum, frame) => {
      try { const decoded = decodeFunctionData({ abi: erc20Abi, data: frame.input }); return decoded.functionName === "transfer" && anyQuoteSameAddressV1(decoded.args[0], intent.account) && (frame.output === "0x" || decodeFunctionResult({ abi: erc20Abi, functionName: "transfer", data: frame.output }) === true) ? sum + decoded.args[1] : sum; } catch { return sum; }
    }, 0n);
    preview.initialBuy = { output: output.toString(), minimumOutput: anyQuoteMinimumOutput(output, intent.slippageBps).toString(), externalRoute: readiness.routes.buy };
  }
  return { ...preview, evidenceHash: anyQuoteEvidenceHashV1({ ...preview, evidenceHash: undefined }) };
}
