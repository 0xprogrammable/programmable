import { Actions, URVersion, V4Planner } from "@uniswap/v4-sdk";
import { CommandType, RoutePlanner, UniversalRouterVersion } from "@uniswap/universal-router-sdk";
import { encodeFunctionData, getAddress, parseAbi, type Address, type Hex } from "viem";
import chainProfile from "@/contracts/spec/robinhood-custom-launch/chain-4663.v1.json";
import type { LaunchProjectionV1 } from "./launch-plan-v1";
import { parseLaunchProjectionV1, projectionObject, resolveProjectionAddress } from "./launch-projection-v1";
import { canonicalBrowserJsonV2, canonicalBrowserSha256V2 } from "./browser-authority-v2";

export const ROUTED_TRADE_REQUEST_V1 = "programmable.launch-plan-trade-request.v1" as const;
export const ROUTED_TRADE_RESPONSE_V1 = "programmable.launch-plan-trade-preparation.v1" as const;
export const ROUTED_FEE_POLICY_V1 = "programmable.routed-swap-fee.v1" as const;
export const ROUTED_FEE_RECIPIENT_V1 = getAddress("0xD88539d3c4C460136a733A3Fd60cf6BF269079da");
export const ROUTED_TRADE_CONTRACTS_V1 = chainProfile.contracts.uniswap;
export const ROUTED_TRADE_ROUTER_ABI_V1 = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
export const ROUTED_TRADE_TOKEN_ABI_V1 = parseAbi(["function balanceOf(address) view returns(uint256)", "function allowance(address,address) view returns(uint256)", "function approve(address,uint256) returns(bool)", "function decimals() view returns(uint8)"]);
export const ROUTED_TRADE_PERMIT2_ABI_V1 = parseAbi(["function allowance(address,address,address) view returns(uint160,uint48,uint48)", "function approve(address,address,uint160,uint48)"]);
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const SENDER = "0x0000000000000000000000000000000000000001" as Address;
const UINT128_MAX = (1n << 128n) - 1n;

export type LaunchPlanTradeRequestV1 = Readonly<{ schemaVersion: typeof ROUTED_TRADE_REQUEST_V1; chainId: "4663";
  launchId: string; planHash: `sha256:${string}`; marketId: string; owner: Address; zeroForOne: boolean;
  amountIn: string; slippageBps: number; deadline: string; hookData: Hex }>;
export type LaunchPlanFeeBindingV1 = Readonly<{ mode: "programmable_routed" | "pool_enforced"; obligationId: string;
  policyVersion: typeof ROUTED_FEE_POLICY_V1; scope: "fee_on_programmable_routed_trades" | "fee_on_proven_pool_paths";
  rateBps: 20; routedRateBps: 20 | 0; recipient: Address; base: "gross_output_credit" | "not_applicable"; rounding: "floor" | "not_applicable"; currency: Address;
  poolEnforcementWitness: unknown | null }>;
export type LaunchPlanTradeTransactionV1 = Readonly<{ kind: "swap" | "token_approval" | "permit2_approval";
  chainId: "4663"; from: Address; to: Address; data: Hex; value: string; gasLimit: string }>;
export type LaunchPlanTradePreparationV1 = Readonly<{ schemaVersion: typeof ROUTED_TRADE_RESPONSE_V1;
  status: "ready" | "approval_required"; request: LaunchPlanTradeRequestV1; projectionDigest: `sha256:${string}`;
  fee: LaunchPlanFeeBindingV1; quote: Readonly<{ grossAmountOut: string; platformFeeAmount: string; amountOut: string;
    amountOutMinimum: string; grossAmountOutMinimum: string; blockNumber: string; blockHash: Hex; blockTimestamp: string;
    validUntil: string; inputDecimals: number | null; outputDecimals: number | null }>;
  transaction: LaunchPlanTradeTransactionV1; evidence: Readonly<{ kind: "independent_rpc_simulation";
    providerDomains: readonly ["drpc.org", "alchemy.com"]; runtimeBindings: readonly Readonly<{ address: Address; runtimeCodeHash: Hex }>[];
    feeTransfer: unknown | null; traceDigest: `sha256:${string}` | null; actualWalletAuthorizationVerified: false }>;
  preparationDigest: `sha256:${string}` }>;

export class LaunchPlanTradeErrorV1 extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 409 | 503 = 409) { super(message); this.name = "LaunchPlanTradeErrorV1"; }
}
const bad = (code: string, message: string, status: 400 | 409 | 503 = 409): never => { throw new LaunchPlanTradeErrorV1(code, message, status); };
function uint(value: unknown, maximum = UINT128_MAX): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) > maximum) return bad("INVALID_AMOUNT", "The trade amount is invalid.", 400);
  return BigInt(value);
}
export function parseLaunchPlanTradeRequestV1(value: unknown): LaunchPlanTradeRequestV1 {
  const keys = ["schemaVersion", "chainId", "launchId", "planHash", "marketId", "owner", "zeroForOne", "amountIn", "slippageBps", "deadline", "hookData"];
  if (!projectionObject(value) || Object.keys(value).sort().join() !== keys.sort().join()
    || value.schemaVersion !== ROUTED_TRADE_REQUEST_V1 || value.chainId !== "4663"
    || typeof value.launchId !== "string" || value.launchId.length < 1 || value.launchId.length > 256
    || typeof value.marketId !== "string" || value.marketId.length < 1 || value.marketId.length > 256
    || typeof value.planHash !== "string" || !/^sha256:[0-9a-f]{64}$/.test(value.planHash)
    || typeof value.owner !== "string" || !/^0x(?!0{40}$)[0-9a-f]{40}$/i.test(value.owner)
    || typeof value.zeroForOne !== "boolean" || !Number.isInteger(value.slippageBps) || Number(value.slippageBps) < 1 || Number(value.slippageBps) > 5000
    || typeof value.hookData !== "string" || !/^0x(?:[0-9a-f]{2}){0,4096}$/i.test(value.hookData)
    || uint(value.amountIn) === 0n || uint(value.deadline, (1n << 48n) - 1n) === 0n) return bad("INVALID_REQUEST", "The trade request is invalid.", 400);
  return Object.freeze({ ...value, owner: getAddress(value.owner), hookData: value.hookData.toLowerCase() }) as LaunchPlanTradeRequestV1;
}

export function launchPlanTradeBindingV1(projectionInput: LaunchProjectionV1, request: LaunchPlanTradeRequestV1) {
  const projection = parseLaunchProjectionV1(projectionInput);
  if (projection.sourceVersion !== "custom_launch_plan_v1" || projection.chainId !== request.chainId || projection.finality.status !== "final"
    || projection.launchId !== request.launchId || projection.planHash !== request.planHash) return bad("LAUNCH_BINDING_CHANGED", "Refresh the finalized launch before trading.");
  const market = projection.markets.find(item => item.marketId === request.marketId);
  if (!market) return bad("NO_QUALIFYING_SWAP_FLOW", "This launch has no matching trading market.");
  const poolKey = { currency0: getAddress(resolveProjectionAddress(projection, market.currency0)), currency1: getAddress(resolveProjectionAddress(projection, market.currency1)),
    fee: market.fee, tickSpacing: market.tickSpacing, hooks: getAddress(resolveProjectionAddress(projection, market.hooks)) };
  if (market.poolManager.toLowerCase() !== ROUTED_TRADE_CONTRACTS_V1.poolManager.address.toLowerCase()
    || BigInt(poolKey.currency0) >= BigInt(poolKey.currency1) || poolKey.tickSpacing < 1
    || (poolKey.fee > 1_000_000 && poolKey.fee !== 0x800000)) return bad("MARKET_BINDING_CHANGED", "The exact V4 market binding is unavailable.");
  const matches = projection.assuranceClaims.filter(claim => ["fee_on_programmable_routed_trades", "fee_on_proven_pool_paths"].includes(claim.claimType)
    && projectionObject(claim.observedValue) && Array.isArray(claim.observedValue.marketIds) && claim.observedValue.marketIds.includes(market.marketId));
  if (matches.length !== 1) return bad("FEE_POLICY_PENDING", "The market fee policy requires verification.");
  const claim = matches[0]!, obligation = claim.observedValue as Record<string, unknown>;
  const poolClaim = claim.claimType === "fee_on_proven_pool_paths";
  if (obligation.policyVersion !== "programmable.custom-launch-fee.v1" || obligation.rateBps !== 20
    || obligation.mode !== (poolClaim ? "pool_enforced" : "programmable_routed")
    || obligation.scope !== (poolClaim ? "proven_pool_paths" : "programmable_built_or_routed_qualifying_swaps")
    || typeof obligation.recipient !== "string" || obligation.recipient.toLowerCase() !== ROUTED_FEE_RECIPIENT_V1.toLowerCase()
    || typeof obligation.obligationId !== "string" || claim.subject !== obligation.obligationId
    || (poolClaim ? claim.status !== "verified" : !["verified", "disclosed"].includes(claim.status))) {
    return bad("FEE_POLICY_PENDING", "The market fee policy requires verification.");
  }
  // No immutable pool-fee proof adapter is installed in the current runtime.
  // Neither a getter nor a published label is sufficient to suppress the route
  // fee. In particular, never add a duck-typed success/certificate escape hatch.
  const inputCurrency = request.zeroForOne ? poolKey.currency0 : poolKey.currency1;
  const outputCurrency = request.zeroForOne ? poolKey.currency1 : poolKey.currency0;
  const fee: LaunchPlanFeeBindingV1 = { mode: "programmable_routed", obligationId: obligation.obligationId,
    policyVersion: ROUTED_FEE_POLICY_V1, scope: "fee_on_programmable_routed_trades",
    rateBps: 20, routedRateBps: 20, recipient: ROUTED_FEE_RECIPIENT_V1,
    base: "gross_output_credit", rounding: "floor", currency: outputCurrency, poolEnforcementWitness: null };
  return { projection, poolKey, inputCurrency, outputCurrency, fee,
    projectionDigest: canonicalBrowserSha256V2("programmable.launch-plan-trade-projection.v1", projection) };
}

/** The exact fee primitive is Uniswap V4Router TAKE_PORTION, charged on its
 * output credit in the same unlock. It floors once in the output currency.
 * No caller-selected fee recipient, percentage, command, or external route.
 * https://github.com/Uniswap/v4-periphery/blob/main/src/V4Router.sol */
export function launchPlanTradeAmountsV1(gross: bigint, rateBps: 20 | 0, slippageBps: number) {
  if (gross <= 0n || gross > UINT128_MAX || ![0, 20].includes(rateBps) || !Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > 5000) return bad("INVALID_QUOTE", "The current quote is invalid.");
  const fee = gross * BigInt(rateBps) / 10_000n, net = gross - fee;
  const netMinimum = net * BigInt(10_000 - slippageBps) / 10_000n;
  const grossMinimum = gross * BigInt(10_000 - slippageBps) / 10_000n;
  if (netMinimum <= 0n) return bad("QUOTE_ROUNDS_TO_ZERO", "Use a larger amount to keep a positive minimum received.", 400);
  return { grossAmountOut: gross.toString(), platformFeeAmount: fee.toString(), amountOut: net.toString(),
    amountOutMinimum: netMinimum.toString(), grossAmountOutMinimum: grossMinimum.toString() };
}
export function buildLaunchPlanRoutedSwapV1(projection: LaunchProjectionV1, request: LaunchPlanTradeRequestV1, grossAmountOut: bigint): LaunchPlanTradeTransactionV1 {
  const binding = launchPlanTradeBindingV1(projection, request), amounts = launchPlanTradeAmountsV1(grossAmountOut, binding.fee.routedRateBps, request.slippageBps);
  const planner = new V4Planner();
  planner.addAction(Actions.SWAP_EXACT_IN_SINGLE, [{ poolKey: binding.poolKey, zeroForOne: request.zeroForOne, amountIn: request.amountIn,
    amountOutMinimum: amounts.grossAmountOutMinimum, hookData: request.hookData }], URVersion.V2_0);
  planner.addAction(Actions.SETTLE_ALL, [binding.inputCurrency, request.amountIn], URVersion.V2_0);
  if (binding.fee.routedRateBps) planner.addAction(Actions.TAKE_PORTION, [binding.outputCurrency, ROUTED_FEE_RECIPIENT_V1, 20], URVersion.V2_0);
  planner.addAction(Actions.TAKE_ALL, [binding.outputCurrency, amounts.amountOutMinimum], URVersion.V2_0);
  const route = new RoutePlanner(); route.addCommand(CommandType.V4_SWAP, [planner.finalize()], false, UniversalRouterVersion.V2_0);
  // Partial input fills must not leave native funds in the Universal Router.
  if (binding.inputCurrency === ZERO) route.addCommand(CommandType.SWEEP, [ZERO, SENDER, 0], false, UniversalRouterVersion.V2_0);
  return { kind: "swap", chainId: "4663", from: request.owner, to: getAddress(ROUTED_TRADE_CONTRACTS_V1.universalRouter.address),
    data: encodeFunctionData({ abi: ROUTED_TRADE_ROUTER_ABI_V1, functionName: "execute", args: [route.commands as Hex, route.inputs as Hex[], BigInt(request.deadline)] }),
    value: binding.inputCurrency === ZERO ? request.amountIn : "0", gasLimit: "1" };
}
export function buildLaunchPlanTradeApprovalV1(request: LaunchPlanTradeRequestV1, token: Address, kind: "token_approval" | "permit2_approval"): LaunchPlanTradeTransactionV1 {
  uint(request.deadline, (1n << 48n) - 1n);
  return { kind, chainId: "4663", from: request.owner, value: "0", gasLimit: "1",
    to: kind === "token_approval" ? token : getAddress(ROUTED_TRADE_CONTRACTS_V1.permit2.address),
    data: kind === "token_approval" ? encodeFunctionData({ abi: ROUTED_TRADE_TOKEN_ABI_V1, functionName: "approve",
      args: [getAddress(ROUTED_TRADE_CONTRACTS_V1.permit2.address), BigInt(request.amountIn)] })
      : encodeFunctionData({ abi: ROUTED_TRADE_PERMIT2_ABI_V1, functionName: "approve", args: [token,
        getAddress(ROUTED_TRADE_CONTRACTS_V1.universalRouter.address), BigInt(request.amountIn), Number(BigInt(request.deadline))] }) };
}

export function launchPlanTradePreparationDigestV1(value: Omit<LaunchPlanTradePreparationV1, "preparationDigest">) {
  return canonicalBrowserSha256V2("programmable.launch-plan-trade-preparation.v1", value);
}
export function validateLaunchPlanTradePreparationV1(value: unknown, projection: LaunchProjectionV1, request: LaunchPlanTradeRequestV1, now = BigInt(Math.floor(Date.now() / 1000))): LaunchPlanTradePreparationV1 {
  if (!projectionObject(value) || value.schemaVersion !== ROUTED_TRADE_RESPONSE_V1 || !projectionObject(value.quote)
    || !projectionObject(value.transaction) || !projectionObject(value.evidence)) return bad("INVALID_PREPARATION", "The prepared trade is invalid.");
  const typed = value as unknown as LaunchPlanTradePreparationV1;
  const binding = launchPlanTradeBindingV1(projection, request), quote = typed.quote;
  if (canonicalBrowserJsonV2(typed.request) !== canonicalBrowserJsonV2(request) || typed.projectionDigest !== binding.projectionDigest
    || canonicalBrowserJsonV2(typed.fee) !== canonicalBrowserJsonV2(binding.fee)
    || uint(quote.validUntil, (1n << 64n) - 1n) < now || uint(quote.validUntil, (1n << 64n) - 1n) > now + 30n
    || uint(quote.blockTimestamp, (1n << 64n) - 1n) > now || uint(request.deadline, (1n << 64n) - 1n) <= now
    || !/^0x[0-9a-f]{64}$/.test(quote.blockHash) || uint(quote.blockNumber) === 0n
    || typed.evidence.actualWalletAuthorizationVerified !== false || typed.evidence.kind !== "independent_rpc_simulation"
    || canonicalBrowserJsonV2(typed.evidence.providerDomains) !== canonicalBrowserJsonV2(["drpc.org", "alchemy.com"])) return bad("STALE_PREPARATION", "Refresh the exact trade quote before signing.");
  const amounts = launchPlanTradeAmountsV1(uint(quote.grossAmountOut), binding.fee.routedRateBps, request.slippageBps);
  if (Object.entries(amounts).some(([key, amount]) => quote[key as keyof typeof amounts] !== amount)) return bad("FEE_QUOTE_MISMATCH", "The fee and received amount changed.");
  const proof = typed.evidence.feeTransfer;
  if (typeof typed.evidence.traceDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(typed.evidence.traceDigest)
    || !Array.isArray(typed.evidence.runtimeBindings) || typed.evidence.runtimeBindings.length === 0
    || (typed.transaction.kind === "swap" ? !projectionObject(proof)
      || proof.policyVersion !== binding.fee.policyVersion || proof.scope !== binding.fee.scope
      || proof.currency !== binding.outputCurrency || proof.recipient !== binding.fee.recipient || proof.rateBps !== binding.fee.routedRateBps
      || proof.base !== binding.fee.base || proof.rounding !== binding.fee.rounding || proof.grossOutputCredit !== quote.grossAmountOut
      || proof.routedFeeAmount !== quote.platformFeeAmount || proof.traderOutputCredit !== quote.amountOut
      || uint(proof.recipientBalanceIncrease) < uint(quote.platformFeeAmount) || uint(proof.traderBalanceIncrease) < uint(quote.amountOutMinimum)
      || typeof proof.transferTraceDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(proof.transferTraceDigest)
      || typeof proof.postStateDigest !== "string" || !/^sha256:[0-9a-f]{64}$/.test(proof.postStateDigest)
      : proof !== null)) return bad("FEE_EFFECT_PROOF_MISSING", "The actual route fee and output transfer require fresh verification.");
  const expected = typed.transaction.kind === "swap" ? buildLaunchPlanRoutedSwapV1(projection, request, BigInt(quote.grossAmountOut))
    : ["token_approval", "permit2_approval"].includes(typed.transaction.kind) ? buildLaunchPlanTradeApprovalV1(request, binding.inputCurrency, typed.transaction.kind) : null;
  if (!expected || (typed.transaction.kind === "swap" ? typed.status !== "ready" : typed.status !== "approval_required" || binding.inputCurrency === ZERO)
    || Object.entries(expected).some(([key, item]) => key !== "gasLimit" && typed.transaction[key as keyof LaunchPlanTradeTransactionV1] !== item)
    || uint(typed.transaction.gasLimit, 30_000_000n) === 0n) return bad("NONCANONICAL_TRANSACTION", "The wallet transaction differs from the reviewed trade.");
  const { preparationDigest, ...body } = typed;
  if (launchPlanTradePreparationDigestV1(body) !== preparationDigest) return bad("PREPARATION_DIGEST_MISMATCH", "The trade evidence changed.");
  return typed;
}
