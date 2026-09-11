import { decodeAbiParameters, encodeAbiParameters, keccak256, parseAbi, parseAbiParameters, type Address, type Hex } from "viem";
import { anyQuotePoolIdV1, requireAnyQuoteNativeUnlockRouteV1 } from "./route";
import { ANY_QUOTE_NATIVE, AnyQuoteErrorV1, anyQuoteSameAddressV1 as same, type AnyQuoteExternalRouteV1, type AnyQuotePoolKeyV1 } from "./types";

export const ANY_QUOTE_NATIVE_FEE_ROUTE_PARAMETERS = parseAbiParameters("((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,bool zeroForOne,bytes hookData)[] hops");
export const anyQuoteNativeFeeRouteAbi = parseAbi([
  "function NATIVE_FEE_MAX_LOSS_BPS() view returns (uint256)",
  "function nativeFeeRouteHash(bytes32 poolId) view returns (bytes32)",
  "function nativeFeeRoute(bytes32 poolId) view returns (((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) key,bool zeroForOne,bytes hookData)[])",
  "event NativeFeeRouteBound(bytes32 indexed poolId,bytes32 indexed launchId,bytes32 indexed routeHash)",
  "event NativeFeesConverted(bytes32 indexed poolId,bytes32 indexed launchId,bytes32 indexed routeHash,uint256 quoteAmount,uint256 ethAmount,uint256 platformEth,uint256 creatorEth)",
]);
export type AnyQuoteNativeFeeHop = { key: AnyQuotePoolKeyV1; zeroForOne: boolean; hookData: Hex };
export type AnyQuoteNativeFeeRoute = { launchData: Hex; routeHash: Hex; hops: readonly AnyQuoteNativeFeeHop[] };
type Pool = { quoteAsset: Address; token?: Address; sharedHook: Address };
function need(ok: unknown): asserts ok { if (!ok) throw new AnyQuoteErrorV1("NATIVE_FEE_ROUTE_INVALID"); }

/** Immutable fee conversion topology, selected at launch. Amounts are determined by the hook per swap. */
export function decodeAnyQuoteNativeFeeRoute(data: Hex, pool: Pool): AnyQuoteNativeFeeRoute {
  need(/^0x(?:[0-9a-f]{2})+$/i.test(data) && data.length <= 2 + 16_384 * 2);
  let hops: readonly AnyQuoteNativeFeeHop[];
  try { hops = decodeAbiParameters(ANY_QUOTE_NATIVE_FEE_ROUTE_PARAMETERS, data)[0]; } catch { throw new AnyQuoteErrorV1("NATIVE_FEE_ROUTE_INVALID"); }
  need(hops.length > 0 && hops.length <= 4);
  need(encodeAbiParameters(ANY_QUOTE_NATIVE_FEE_ROUTE_PARAMETERS, [hops]).toLowerCase() === data.toLowerCase());
  const seen = new Set([pool.quoteAsset.toLowerCase()]);
  let current = pool.quoteAsset;
  for (const hop of hops) {
    anyQuotePoolIdV1(hop.key); // Canonical currencies, fees and tick spacing.
    const input = hop.zeroForOne ? hop.key.currency0 : hop.key.currency1;
    const output = hop.zeroForOne ? hop.key.currency1 : hop.key.currency0;
    need(same(current, input) && !same(input, output) && (!pool.token || (!same(input, pool.token) && !same(output, pool.token)))
      && !same(hop.key.hooks, pool.sharedHook) && !seen.has(output.toLowerCase()) && /^0x(?:[0-9a-f]{2}){0,2048}$/i.test(hop.hookData));
    seen.add(output.toLowerCase()); current = output;
  }
  need(same(current, ANY_QUOTE_NATIVE));
  return { launchData: data.toLowerCase() as Hex, routeHash: keccak256(data), hops };
}
export function anyQuoteNativeFeeRouteFromExternal(route: AnyQuoteExternalRouteV1, pool: Pool): AnyQuoteNativeFeeRoute {
  const isSell = same(route.tokenIn, pool.quoteAsset);
  const source = requireAnyQuoteNativeUnlockRouteV1(route, isSell ? "sell" : "buy");
  need(same(isSell ? source[0].tokenIn : source[source.length - 1].tokenOut, pool.quoteAsset));
  // Reversal cannot repurpose direction-dependent hook data.
  if (!isSell) need(source.every(h => h.hookData === "0x"));
  const hops = (isSell ? source : [...source].reverse()).map(h => ({ key: h.key,
    zeroForOne: same(isSell ? h.tokenIn : h.tokenOut, h.key.currency0), hookData: h.hookData }));
  return decodeAnyQuoteNativeFeeRoute(encodeAbiParameters(ANY_QUOTE_NATIVE_FEE_ROUTE_PARAMETERS, [hops]), pool);
}
