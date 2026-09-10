import { CommandType, RoutePlanner, UniversalRouterVersion } from "@uniswap/universal-router-sdk";
import { Actions, Pool, URVersion, V4Planner } from "@uniswap/v4-sdk";
import { Ether, Token } from "@uniswap/sdk-core";
import { encodeAbiParameters, encodeFunctionData, keccak256, parseAbi, parseAbiParameters, stringToHex, type Address, type Hex } from "viem";
import {
  ANY_QUOTE_CHAIN_ID, ANY_QUOTE_INFRASTRUCTURE, ANY_QUOTE_NATIVE, ANY_QUOTE_WETH,
  AnyQuoteErrorV1, anyQuoteAddressV1, anyQuoteSameAddressV1, anyQuoteUintV1,
  type AnyQuoteAmmHopV1, type AnyQuoteCheckpointV1, type AnyQuoteExternalRouteV1,
  type AnyQuoteModulePoolV1, type AnyQuotePoolKeyV1,
} from "./types";

const UINT128_MAX = (1n << 128n) - 1n;
const INT128_MAX = (1n << 127n) - 1n;
const executeAbi = parseAbi(["function execute(bytes commands,bytes[] inputs,uint256 deadline) payable"]);
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
  // Currency metadata is irrelevant to the PoolId. Native ETH remains the native SDK currency.
  const currency = (address: Address) => anyQuoteSameAddressV1(address, ANY_QUOTE_NATIVE)
    ? Ether.onChain(ANY_QUOTE_CHAIN_ID) : new Token(ANY_QUOTE_CHAIN_ID, address, 18);
  return Pool.getPoolId(currency(normalized.currency0), currency(normalized.currency1), normalized.fee, normalized.tickSpacing, normalized.hooks) as Hex;
}

/** Only a single V4 unlock can currently prove transaction-local intermediate amounts.
 * Native/WETH equivalence is useful for discovery, but it must not hide a wrap/unwrap during
 * execution: Universal Router's balance-based unwrap and mixed-protocol commands are not isolated.
 * This is a route-compiler coverage limit, not evidence that the ERC20 is incompatible. */
export function requireAnyQuoteNativeUnlockRouteV1(route: AnyQuoteExternalRouteV1, side: "buy" | "sell") {
  validateAnyQuoteExternalRouteV1(route);
  const hops = route.hops;
  if (hops.length === 0 || !hops.every((hop): hop is Extract<AnyQuoteAmmHopV1, { protocol: "V4" }> => hop.protocol === "V4")
    || !anyQuoteSameAddressV1(side === "buy" ? hops[0].tokenIn : hops[hops.length - 1].tokenOut, ANY_QUOTE_NATIVE)) {
    throw new AnyQuoteErrorV1("ROUTE_ISOLATION_UNAVAILABLE");
  }
  for (let i = 1; i < hops.length; i++) {
    if (!anyQuoteSameAddressV1(hops[i - 1].tokenOut, hops[i].tokenIn)) throw new AnyQuoteErrorV1("ROUTE_ISOLATION_UNAVAILABLE");
  }
  return hops;
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
  const hops = requireAnyQuoteNativeUnlockRouteV1(route, input.side);
  const path = hops.map(hop => [hop.tokenOut, hop.key.fee, hop.key.tickSpacing, hop.key.hooks, hop.hookData]);
  const moduleHop = [buy ? token : quote, key.fee, key.tickSpacing, key.hooks, "0x" as Hex];
  if (buy) path.push(moduleHop); else path.unshift(moduleHop);
  const currencyIn = buy ? ANY_QUOTE_NATIVE : token, currencyOut = buy ? token : ANY_QUOTE_NATIVE;
  const v4 = new V4Planner();
  // Every intermediate output becomes the next hop's exact input inside the same PoolManager
  // unlock. No intermediate ERC20 reaches the router. Explicit settlement also makes an external
  // partial fill revert with a remaining delta instead of spending less than the signed input.
  v4.addAction(Actions.SWAP_EXACT_IN, [[currencyIn, path, [], input.amountIn.toString(), input.minimumAmountOut.toString()]], URVersion.V2_1_1);
  v4.addAction(Actions.SETTLE, [currencyIn, input.amountIn.toString(), !buy], URVersion.V2_1_1);
  v4.addAction(Actions.TAKE, [currencyOut, recipient, "0"], URVersion.V2_1_1);
  const planner = new RoutePlanner();
  planner.addCommand(CommandType.V4_SWAP, [v4.finalize()], false, UniversalRouterVersion.V2_1_1);
  const assets = [...new Set([token, ANY_QUOTE_NATIVE, ...hops.flatMap(h => [h.tokenIn, h.tokenOut])].map(a => a.toLowerCase()))] as Address[];
  const commands = planner.commands as Hex, inputs = planner.inputs as Hex[];
  return {
    chainId: ANY_QUOTE_CHAIN_ID, routerVersion: "2.1.1" as const, commands, inputs,
    nativeBuyOperationData: buy ? encodeAbiParameters(parseAbiParameters("bytes,bytes[]"), [commands, inputs]) : null,
    transaction: { to: ANY_QUOTE_INFRASTRUCTURE.universalRouter, from: owner,
      data: encodeFunctionData({ abi: executeAbi, functionName: "execute", args: [commands, inputs, input.deadline] }),
      value: buy ? input.amountIn.toString() : "0" },
    recipient, finalMinimum: input.minimumAmountOut.toString(), deadline: input.deadline.toString(),
    balanceAccounting: { mode: "unlock-deltas" as const, assets,
      existingDonationsCountAsUserFunding: false as const, minimumMustHoldWithoutDonations: true as const },
    requiresExactTransactionSimulation: true as const,
    approval: buy ? null : { token, spender: ANY_QUOTE_INFRASTRUCTURE.permit2,
      permit2Spender: ANY_QUOTE_INFRASTRUCTURE.universalRouter, amount: input.amountIn.toString() },
  };
}

/** Read-only settlement probe. These bytes must never become a launch operation or wallet request.
 * Balance checks bracket the external conversion so the server can read actual transfer effects
 * from callTracer without token storage guesses, logs, donated balances or state overrides. */
export function buildAnyQuoteSettlementProbeV1(input: {
  owner: Address; recipient: Address; externalRoute: AnyQuoteExternalRouteV1; deadline: bigint; now: bigint;
}) {
  const owner = anyQuoteAddressV1(input.owner), recipient = anyQuoteAddressV1(input.recipient), route = input.externalRoute;
  const hops = requireAnyQuoteNativeUnlockRouteV1(route, "buy"), asset = anyQuoteAddressV1(route.tokenOut);
  const amountIn = anyQuoteUintV1(route.amountIn, INT128_MAX), amountOut = anyQuoteUintV1(route.amountOut, INT128_MAX);
  if (!anyQuoteSameAddressV1(route.tokenIn, ANY_QUOTE_WETH) || input.deadline <= input.now
    || input.deadline > input.now + 300n || input.deadline > BigInt(route.validUntil)
    || anyQuoteSameAddressV1(recipient, ANY_QUOTE_INFRASTRUCTURE.poolManager)
    || anyQuoteSameAddressV1(recipient, ANY_QUOTE_INFRASTRUCTURE.universalRouter)) throw new AnyQuoteErrorV1("SETTLEMENT_PROBE_BOUNDS_INVALID");
  const v4 = new V4Planner();
  v4.addAction(Actions.SWAP_EXACT_IN, [[ANY_QUOTE_NATIVE, hops.map(h => [h.tokenOut, h.key.fee, h.key.tickSpacing, h.key.hooks, h.hookData]), [], amountIn.toString(), amountOut.toString()]], URVersion.V2_1_1);
  v4.addAction(Actions.SETTLE, [ANY_QUOTE_NATIVE, amountIn.toString(), false], URVersion.V2_1_1);
  v4.addAction(Actions.TAKE, [asset, recipient, "0"], URVersion.V2_1_1);
  const planner = new RoutePlanner();
  const check = (owner: Address) => planner.addCommand(CommandType.BALANCE_CHECK_ERC20, [owner, asset, "0"], false, UniversalRouterVersion.V2_1_1);
  check(recipient); check(ANY_QUOTE_INFRASTRUCTURE.poolManager);
  planner.addCommand(CommandType.V4_SWAP, [v4.finalize()], false, UniversalRouterVersion.V2_1_1);
  check(recipient); check(ANY_QUOTE_INFRASTRUCTURE.poolManager);
  const commands = planner.commands as Hex, inputs = planner.inputs as Hex[];
  return { simulationOnly: true as const, asset, recipient, amountIn, amountOut, unlockData: inputs[2],
    transaction: { from: owner, to: ANY_QUOTE_INFRASTRUCTURE.universalRouter,
      data: encodeFunctionData({ abi: executeAbi, functionName: "execute", args: [commands, inputs, input.deadline] }), value: amountIn.toString() } };
}
