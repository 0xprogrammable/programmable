import { CommandType, RoutePlanner, UniversalRouterVersion } from "@uniswap/universal-router-sdk";
import { Actions, URVersion, V4Planner } from "@uniswap/v4-sdk";
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseAbiParameters, stringToHex, type Address, type Hex } from "viem";
import {
  ANY_QUOTE_CHAIN_ID, ANY_QUOTE_INFRASTRUCTURE, ANY_QUOTE_NATIVE, ANY_QUOTE_WETH,
  AnyQuoteErrorV1, anyQuoteAddressV1, anyQuoteSameAddressV1, anyQuoteUintV1,
  type AnyQuoteAmmHopV1, type AnyQuoteCheckpointV1, type AnyQuoteExternalRouteV1,
  type AnyQuoteModulePoolV1, type AnyQuotePoolKeyV1,
} from "./types";

const CONTRACT_BALANCE = (1n << 255n).toString();
const UINT128_MAX = (1n << 128n) - 1n;
const INT128_MAX = (1n << 127n) - 1n;
const ROUTER = "0x0000000000000000000000000000000000000002";
const executeAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
const keyParameters = parseAbiParameters("address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks");
const canonicalAsset = (value: Address) => anyQuoteSameAddressV1(value, ANY_QUOTE_NATIVE) ? ANY_QUOTE_WETH : value;
const equivalentAsset = (a: Address, b: Address) => anyQuoteSameAddressV1(canonicalAsset(a), canonicalAsset(b));
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new AnyQuoteErrorV1("ROUTE_RESPONSE_INVALID");
  return v as Record<string, unknown>;
};
function smallInteger(v: unknown, min: number, max: number) {
  if ((typeof v !== "number" && typeof v !== "string") || !/^-?[0-9]{1,9}$/.test(String(v))) throw new AnyQuoteErrorV1("ROUTE_RESPONSE_INVALID");
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new AnyQuoteErrorV1("ROUTE_RESPONSE_INVALID");
  return n;
}
export function anyQuoteEvidenceHashV1(value: unknown): Hex {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === "object" ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)])) : item;
  return keccak256(stringToHex(JSON.stringify(canonical(value))));
}
export function anyQuotePoolIdV1(key: AnyQuotePoolKeyV1): Hex {
  const normalized = validateKey(key);
  return keccak256(encodeAbiParameters(keyParameters, [normalized.currency0, normalized.currency1, normalized.fee, normalized.tickSpacing, normalized.hooks]));
}
function validateKey(key: AnyQuotePoolKeyV1): AnyQuotePoolKeyV1 {
  const currency0 = anyQuoteAddressV1(key.currency0, true), currency1 = anyQuoteAddressV1(key.currency1, true);
  if (BigInt(currency0) >= BigInt(currency1)) throw new AnyQuoteErrorV1("INVALID_POOL_KEY");
  const fee = smallInteger(key.fee, 0, 0x800000);
  if (fee > 1_000_000 && fee !== 0x800000) throw new AnyQuoteErrorV1("INVALID_POOL_FEE");
  return { currency0, currency1, fee, tickSpacing: smallInteger(key.tickSpacing, 1, 32_767), hooks: anyQuoteAddressV1(key.hooks, true) };
}
export function anyQuoteModulePoolKeyV1(pool: AnyQuoteModulePoolV1): AnyQuotePoolKeyV1 {
  const token = anyQuoteAddressV1(pool.token), quote = anyQuoteAddressV1(pool.quoteAsset), hooks = anyQuoteAddressV1(pool.sharedHook);
  const [currency0, currency1] = BigInt(token) < BigInt(quote) ? [token, quote] : [quote, token];
  const key = validateKey({ currency0, currency1, fee: 0, tickSpacing: 200, hooks });
  if (anyQuotePoolIdV1(key).toLowerCase() !== pool.poolId.toLowerCase()) throw new AnyQuoteErrorV1("MODULE_POOL_ID_MISMATCH");
  return key;
}

/** Official /v1/quote CLASSIC wire: route is an array of split branches, each containing pool hops.
 * We accept one branch and V2/V3/V4 hops, including native/WETH transitions. API calldata is never executed.
 * https://developers.uniswap.org/docs/api-reference/aggregator_quote
 */
export function parseAnyQuoteExternalRouteV1(response: unknown, expected: {
  tokenIn: Address; tokenOut: Address; amountIn: bigint; checkpoint: AnyQuoteCheckpointV1; validUntil: bigint;
}): AnyQuoteExternalRouteV1 {
  const root = object(response), quote = object(root.quote);
  if (root.routing !== "CLASSIC" || !Array.isArray(quote.route) || quote.route.length !== 1
    || !Array.isArray(quote.route[0]) || quote.route[0].length < 1 || quote.route[0].length > 4) throw new AnyQuoteErrorV1("ROUTE_SHAPE_UNSUPPORTED");
  if (quote.tradeType !== undefined && quote.tradeType !== "EXACT_INPUT") throw new AnyQuoteErrorV1("ROUTE_RESPONSE_INVALID");
  for (const key of ["portionBips", "portionAmount"] as const) {
    if (quote[key] !== undefined && quote[key] !== null && String(quote[key]) !== "0") throw new AnyQuoteErrorV1("EXTERNAL_API_FEE_UNSUPPORTED");
  }
  const input = object(quote.input), output = object(quote.output);
  if (!equivalentAsset(anyQuoteAddressV1(input.token, true), expected.tokenIn)
    || !equivalentAsset(anyQuoteAddressV1(output.token, true), expected.tokenOut)
    || anyQuoteUintV1(input.amount) !== expected.amountIn) throw new AnyQuoteErrorV1("ROUTE_RESPONSE_INVALID");
  const amountOut = anyQuoteUintV1(output.amount, UINT128_MAX);
  const hops: AnyQuoteAmmHopV1[] = quote.route[0].map((raw: unknown) => {
    const p = object(raw), a = object(p.tokenIn), b = object(p.tokenOut);
    if (smallInteger(a.chainId, 1, 100_000_000) !== 4663 || smallInteger(b.chainId, 1, 100_000_000) !== 4663) throw new AnyQuoteErrorV1("ROUTE_CHAIN_MISMATCH");
    const tokenIn = anyQuoteAddressV1(a.address, true), tokenOut = anyQuoteAddressV1(b.address, true);
    if (p.type === "v2-pool") return { protocol: "V2", tokenIn, tokenOut, pool: anyQuoteAddressV1(p.address) };
    if (p.type === "v3-pool") return { protocol: "V3", tokenIn, tokenOut, pool: anyQuoteAddressV1(p.address), fee: smallInteger(p.fee, 1, 999_999) };
    if (p.type !== "v4-pool") throw new AnyQuoteErrorV1("ROUTE_SHAPE_UNSUPPORTED");
    const [currency0, currency1] = BigInt(tokenIn) < BigInt(tokenOut) ? [tokenIn, tokenOut] : [tokenOut, tokenIn];
    const key = validateKey({ currency0, currency1, fee: smallInteger(p.fee, 0, 0x800000), tickSpacing: smallInteger(p.tickSpacing, 1, 32_767), hooks: anyQuoteAddressV1(p.hooks, true) });
    const poolId = anyQuotePoolIdV1(key);
    if (p.address !== undefined && (typeof p.address !== "string" || p.address.toLowerCase() !== poolId.toLowerCase())) throw new AnyQuoteErrorV1("ROUTE_POOL_ID_MISMATCH");
    const hookData = p.hookData ?? "0x";
    if (typeof hookData !== "string" || !/^0x(?:[0-9a-f]{2}){0,2048}$/i.test(hookData)) throw new AnyQuoteErrorV1("INVALID_HOOK_DATA");
    return { protocol: "V4", tokenIn, tokenOut, poolId, key, hookData: hookData as Hex };
  });
  const route: AnyQuoteExternalRouteV1 = {
    provider: "uniswap-trading-api", chainId: 4663, tokenIn: expected.tokenIn, tokenOut: expected.tokenOut,
    amountIn: expected.amountIn.toString(), amountOut: amountOut.toString(), hops,
    checkpoint: expected.checkpoint, validUntil: expected.validUntil.toString(), evidenceHash: "0x" as Hex,
  };
  validateAnyQuoteExternalRouteV1(route);
  return { ...route, evidenceHash: anyQuoteEvidenceHashV1({ ...route, evidenceHash: undefined }) };
}

export function validateAnyQuoteExternalRouteV1(route: AnyQuoteExternalRouteV1) {
  if (route.chainId !== 4663 || route.hops.length > 4) throw new AnyQuoteErrorV1("ROUTE_SHAPE_UNSUPPORTED");
  anyQuoteUintV1(route.amountIn, UINT128_MAX); anyQuoteUintV1(route.amountOut, UINT128_MAX);
  anyQuoteUintV1(route.validUntil, (1n << 64n) - 1n);
  let current = anyQuoteAddressV1(route.tokenIn);
  const final = anyQuoteAddressV1(route.tokenOut);
  if (route.hops.length === 0) {
    if (route.provider !== "weth-identity" || !anyQuoteSameAddressV1(current, ANY_QUOTE_WETH) || !anyQuoteSameAddressV1(final, ANY_QUOTE_WETH)
      || route.amountIn !== route.amountOut) throw new AnyQuoteErrorV1("INVALID_IDENTITY_ROUTE");
    return;
  }
  const seen = new Set([canonicalAsset(current).toLowerCase()]);
  for (const hop of route.hops) {
    const tokenIn = anyQuoteAddressV1(hop.tokenIn, hop.protocol === "V4"), tokenOut = anyQuoteAddressV1(hop.tokenOut, hop.protocol === "V4");
    if (!equivalentAsset(current, tokenIn) || equivalentAsset(tokenIn, tokenOut)) throw new AnyQuoteErrorV1("DISCONNECTED_ROUTE");
    const normalizedOut = canonicalAsset(tokenOut).toLowerCase();
    if (seen.has(normalizedOut)) throw new AnyQuoteErrorV1("CYCLIC_ROUTE_UNSUPPORTED");
    seen.add(normalizedOut);
    if (hop.protocol === "V4") {
      const key = validateKey(hop.key);
      if (!((anyQuoteSameAddressV1(tokenIn, key.currency0) && anyQuoteSameAddressV1(tokenOut, key.currency1))
        || (anyQuoteSameAddressV1(tokenIn, key.currency1) && anyQuoteSameAddressV1(tokenOut, key.currency0)))
        || anyQuotePoolIdV1(key).toLowerCase() !== hop.poolId.toLowerCase()
        || !/^0x(?:[0-9a-f]{2}){0,2048}$/i.test(hop.hookData)) throw new AnyQuoteErrorV1("INVALID_V4_HOP");
    } else {
      anyQuoteAddressV1(hop.pool);
      if (hop.protocol === "V3") smallInteger(hop.fee, 1, 999_999);
      else if (hop.protocol !== "V2") throw new AnyQuoteErrorV1("ROUTE_SHAPE_UNSUPPORTED");
    }
    current = tokenOut;
  }
  if (!equivalentAsset(current, final)) throw new AnyQuoteErrorV1("DISCONNECTED_ROUTE");
}

export function buildAnyQuoteSwapV1(input: {
  pool: AnyQuoteModulePoolV1; owner: Address; recipient: Address; side: "buy" | "sell";
  amountIn: bigint; minimumAmountOut: bigint; deadline: bigint; externalRoute: AnyQuoteExternalRouteV1; now?: bigint;
}) {
  const owner = anyQuoteAddressV1(input.owner), recipient = anyQuoteAddressV1(input.recipient);
  const now = input.now ?? BigInt(Math.floor(Date.now() / 1000));
  if (input.side !== "buy" && input.side !== "sell") throw new AnyQuoteErrorV1("INVALID_TRADE_SIDE");
  if (input.amountIn <= 0n || input.amountIn > INT128_MAX || input.minimumAmountOut <= 0n || input.minimumAmountOut > INT128_MAX
    || input.deadline <= now || input.deadline > now + 300n || input.deadline > BigInt(input.externalRoute.validUntil)) throw new AnyQuoteErrorV1("TRADE_BOUNDS_INVALID");
  const key = anyQuoteModulePoolKeyV1(input.pool), route = input.externalRoute;
  validateAnyQuoteExternalRouteV1(route);
  if (BigInt(input.side === "buy" ? route.amountOut : route.amountIn) > INT128_MAX) throw new AnyQuoteErrorV1("MODULE_QUOTE_AMOUNT_OUTSIDE_RANGE");
  const buy = input.side === "buy", quote = anyQuoteAddressV1(input.pool.quoteAsset), token = anyQuoteAddressV1(input.pool.token);
  if (!anyQuoteSameAddressV1(route.tokenIn, buy ? ANY_QUOTE_WETH : quote)
    || !anyQuoteSameAddressV1(route.tokenOut, buy ? quote : ANY_QUOTE_WETH)
    || (buy && BigInt(route.amountIn) !== input.amountIn)) throw new AnyQuoteErrorV1("EXTERNAL_ROUTE_MISMATCH");
  for (const hop of route.hops) {
    if (anyQuoteSameAddressV1(hop.tokenIn, token) || anyQuoteSameAddressV1(hop.tokenOut, token)
      || (hop.protocol === "V4" && hop.poolId.toLowerCase() === input.pool.poolId.toLowerCase())) throw new AnyQuoteErrorV1("EXTERNAL_ROUTE_REUSES_MODULE_POOL");
  }
  const planner = new RoutePlanner();
  const add = (command: CommandType, args: unknown[]) => planner.addCommand(command, args, false, UniversalRouterVersion.V2_1_1);
  const v4Hop = (poolKey: AnyQuotePoolKeyV1, currencyIn: Address, currencyOut: Address, hookData: Hex, min: bigint, userAmount?: bigint, final = false) => {
    const v4 = new V4Planner();
    const action = (id: Actions, args: unknown[]) => v4.addAction(id, args, URVersion.V2_1_1);
    if (userAmount === undefined) action(Actions.SETTLE, [currencyIn, CONTRACT_BALANCE, false]);
    action(Actions.SWAP_EXACT_IN_SINGLE, [[[poolKey.currency0, poolKey.currency1, poolKey.fee, poolKey.tickSpacing, poolKey.hooks],
      anyQuoteSameAddressV1(currencyIn, poolKey.currency0), (userAmount ?? 0n).toString(), min.toString(), "0", hookData]]);
    if (userAmount !== undefined) action(Actions.SETTLE_ALL, [currencyIn, userAmount.toString()]);
    action(Actions.TAKE, [currencyOut, final ? recipient : ROUTER, "0"]);
    if (userAmount === undefined) action(Actions.TAKE, [currencyIn, ROUTER, "0"]);
    add(CommandType.V4_SWAP, [v4.finalize()]);
  };
  const transition = (from: Address, to: Address) => {
    if (anyQuoteSameAddressV1(from, to)) return;
    if (!equivalentAsset(from, to)) throw new AnyQuoteErrorV1("DISCONNECTED_ROUTE");
    if (anyQuoteSameAddressV1(from, ANY_QUOTE_NATIVE)) add(CommandType.WRAP_ETH, [ROUTER, CONTRACT_BALANCE]);
    else add(CommandType.UNWRAP_WETH, [ROUTER, "0"]);
  };
  const external = () => {
    let current = route.tokenIn;
    for (const hop of route.hops) {
      transition(current, hop.tokenIn);
      if (hop.protocol === "V4") v4Hop(hop.key, hop.tokenIn, hop.tokenOut, hop.hookData, 0n);
      else if (hop.protocol === "V3") {
        const path = `${hop.tokenIn}${hop.fee.toString(16).padStart(6, "0")}${hop.tokenOut.slice(2)}`;
        add(CommandType.V3_SWAP_EXACT_IN, [ROUTER, CONTRACT_BALANCE, "0", path, false, []]);
      } else add(CommandType.V2_SWAP_EXACT_IN, [ROUTER, CONTRACT_BALANCE, "0", [hop.tokenIn, hop.tokenOut], false, []]);
      current = hop.tokenOut;
    }
    transition(current, route.tokenOut);
  };
  if (buy) {
    add(CommandType.WRAP_ETH, [ROUTER, input.amountIn.toString()]);
    external();
    v4Hop(key, quote, token, "0x", input.minimumAmountOut, undefined, true);
  } else {
    v4Hop(key, token, quote, "0x", 0n, input.amountIn);
    external();
    add(CommandType.UNWRAP_WETH, [recipient, input.minimumAmountOut.toString()]);
  }
  const dustAssets = [...new Set([quote, ANY_QUOTE_WETH, ...route.hops.flatMap(h => [h.tokenIn, h.tokenOut])].map(a => a.toLowerCase()))]
    .filter(a => !anyQuoteSameAddressV1(a, ANY_QUOTE_NATIVE));
  for (const asset of dustAssets) add(CommandType.SWEEP, [asset, recipient, "0"]);
  add(CommandType.SWEEP, [ANY_QUOTE_NATIVE, recipient, "0"]);
  const commands = planner.commands as Hex, inputs = planner.inputs as Hex[];
  return {
    chainId: ANY_QUOTE_CHAIN_ID, routerVersion: "2.1.1" as const, commands, inputs,
    nativeBuyOperationData: buy ? encodeAbiParameters(parseAbiParameters("bytes,bytes[]"), [commands, inputs]) : null,
    transaction: { to: ANY_QUOTE_INFRASTRUCTURE.universalRouter, from: owner,
      data: encodeFunctionData({ abi: executeAbi, functionName: "execute", args: [commands, inputs, input.deadline] }),
      value: buy ? input.amountIn.toString() : "0" },
    recipient, finalMinimum: input.minimumAmountOut.toString(), deadline: input.deadline.toString(),
    /** Record starting balances and verify funding/output deltas. Existing donations must never
     * count toward the user's funded input or minimum-output proof, and must not block execution. */
    balanceAccounting: { mode: "input-output-deltas" as const, assets: [...dustAssets, token, ANY_QUOTE_NATIVE] as Address[],
      existingDonationsCountAsUserFunding: false as const, minimumMustHoldWithoutDonations: true as const },
    requiresExactTransactionSimulation: true as const,
    approval: buy ? null : { token, spender: ANY_QUOTE_INFRASTRUCTURE.permit2,
      permit2Spender: ANY_QUOTE_INFRASTRUCTURE.universalRouter, amount: input.amountIn.toString() },
  };
}
