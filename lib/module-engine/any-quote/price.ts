import { TickMath } from "@uniswap/v3-sdk";
import { encodeAbiParameters, keccak256, parseAbiParameters, type Address, type Hex } from "viem";
import {
  ANY_QUOTE_INFRASTRUCTURE, ANY_QUOTE_SCHEMA_ID, ANY_QUOTE_START_FDV_USD,
  ANY_QUOTE_TICK_SPACING, ANY_QUOTE_TOKEN_SUPPLY, AnyQuoteErrorV1,
  anyQuoteAddressV1, anyQuoteSameAddressV1, type AnyQuoteRationalV1,
} from "./types";

const Q192 = 1n << 192n;
const MIN_GRID_TICK = -887_200;
const MAX_GRID_TICK = 887_200;
const abs = (n: bigint) => n < 0n ? -n : n;
function gcd(a: bigint, b: bigint): bigint { while (b) [a, b] = [b, a % b]; return a; }
export function anyQuoteRationalV1(numerator: bigint, denominator: bigint): AnyQuoteRationalV1 {
  if (numerator <= 0n || denominator <= 0n) throw new AnyQuoteErrorV1("PRICE_UNAVAILABLE");
  const divisor = gcd(numerator, denominator);
  return { numerator: (numerator / divisor).toString(), denominator: (denominator / divisor).toString() };
}
function rationalParts(value: AnyQuoteRationalV1): [bigint, bigint] {
  if (!/^[1-9][0-9]{0,255}$/.test(value.numerator) || !/^[1-9][0-9]{0,255}$/.test(value.denominator)) throw new AnyQuoteErrorV1("INVALID_PRICE");
  return [BigInt(value.numerator), BigInt(value.denominator)];
}
/** Decimal strings remain exact, including assets worth less than 1e-18 USD. */
export function parseAnyQuoteDecimalV1(value: string): AnyQuoteRationalV1 {
  if (!/^(0|[1-9][0-9]{0,95})(\.[0-9]{1,96})?$/.test(value)) throw new AnyQuoteErrorV1("INVALID_PRICE");
  const [whole, fraction = ""] = value.split(".");
  return anyQuoteRationalV1(BigInt(whole + fraction), 10n ** BigInt(fraction.length));
}
export function multiplyAnyQuoteRationalsV1(a: AnyQuoteRationalV1, b: AnyQuoteRationalV1): AnyQuoteRationalV1 {
  const [an, ad] = rationalParts(a), [bn, bd] = rationalParts(b);
  return anyQuoteRationalV1(an * bn, ad * bd);
}
export function anyQuoteSqrtPriceAtTickV1(tick: number): bigint {
  return BigInt(TickMath.getSqrtRatioAtTick(tick).toString());
}

/** The actual FDV uses the encoded sqrt price, not a floating point approximation of 1.0001^tick. */
export function anyQuoteFdvAtTickV1(input: {
  tick: number; tokenIsCurrency0: boolean; quoteDecimals: number; quoteUsd: AnyQuoteRationalV1;
}): AnyQuoteRationalV1 {
  assertDecimals(input.quoteDecimals);
  const sqrt = anyQuoteSqrtPriceAtTickV1(input.tick), square = sqrt * sqrt;
  const [usdN, usdD] = rationalParts(input.quoteUsd);
  const [rawN, rawD] = input.tokenIsCurrency0 ? [square, Q192] : [Q192, square];
  return anyQuoteRationalV1(rawN * ANY_QUOTE_TOKEN_SUPPLY * usdN, rawD * 10n ** BigInt(input.quoteDecimals) * usdD);
}
function assertDecimals(decimals: number) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new AnyQuoteErrorV1("UNSUPPORTED_TOKEN_DECIMALS", "incompatible");
}

export function planAnyQuoteInitialPriceV1(input: {
  token: Address; quoteAsset: Address; quoteDecimals: number; quoteUsd: AnyQuoteRationalV1;
}) {
  const token = anyQuoteAddressV1(input.token), quote = anyQuoteAddressV1(input.quoteAsset);
  if (anyQuoteSameAddressV1(token, quote)) throw new AnyQuoteErrorV1("IDENTICAL_POOL_ASSETS", "incompatible");
  assertDecimals(input.quoteDecimals);
  const tokenIsCurrency0 = BigInt(token) < BigInt(quote);
  const [usdN, usdD] = rationalParts(input.quoteUsd);
  let ratioN = ANY_QUOTE_START_FDV_USD * usdD * 10n ** BigInt(input.quoteDecimals);
  let ratioD = ANY_QUOTE_TOKEN_SUPPLY * usdN;
  if (!tokenIsCurrency0) [ratioN, ratioD] = [ratioD, ratioN];
  const compare = (tick: number) => anyQuoteSqrtPriceAtTickV1(tick) ** 2n * ratioD - ratioN * Q192;
  // One-sided token liquidity needs a nonempty range in the token's direction.
  const min = MIN_GRID_TICK + ANY_QUOTE_TICK_SPACING;
  const max = MAX_GRID_TICK - ANY_QUOTE_TICK_SPACING;
  if (compare(min) > 0n || compare(max) < 0n) throw new AnyQuoteErrorV1("INITIAL_PRICE_OUTSIDE_POOL_RANGE", "incompatible");
  let lo = min, hi = max;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (compare(mid) <= 0n) lo = mid; else hi = mid - 1;
  }
  const lower = Math.floor(lo / ANY_QUOTE_TICK_SPACING) * ANY_QUOTE_TICK_SPACING;
  const ticks = [...new Set([Math.max(min, lower), Math.min(max, lower + ANY_QUOTE_TICK_SPACING)])];
  const candidates = ticks.map(tick => {
    const fdv = anyQuoteFdvAtTickV1({ ...input, tick, tokenIsCurrency0 });
    return { tick, fdv, error: abs(BigInt(fdv.numerator) - ANY_QUOTE_START_FDV_USD * BigInt(fdv.denominator)) };
  });
  candidates.sort((a, b) => {
    const difference = a.error * BigInt(b.fdv.denominator) - b.error * BigInt(a.fdv.denominator);
    return difference < 0n ? -1 : difference > 0n ? 1 : a.tick - b.tick;
  });
  const selected = candidates[0]!;
  const initialSqrt = anyQuoteSqrtPriceAtTickV1(selected.tick);
  const lowerSqrt = tokenIsCurrency0 ? initialSqrt : anyQuoteSqrtPriceAtTickV1(MIN_GRID_TICK);
  const upperSqrt = tokenIsCurrency0 ? anyQuoteSqrtPriceAtTickV1(MAX_GRID_TICK) : initialSqrt;
  const liquidity = tokenIsCurrency0
    ? ANY_QUOTE_TOKEN_SUPPLY * (lowerSqrt * upperSqrt / (1n << 96n)) / (upperSqrt - lowerSqrt)
    : ANY_QUOTE_TOKEN_SUPPLY * (1n << 96n) / (upperSqrt - lowerSqrt);
  // Core floors the negative compressed MIN_TICK, including the partially usable final interval.
  const compressedTicks = Math.floor(887_272 / 200) - Math.floor(-887_272 / 200) + 1;
  const maxLiquidityPerTick = ((1n << 128n) - 1n) / BigInt(compressedTicks);
  if (liquidity === 0n || liquidity > maxLiquidityPerTick) throw new AnyQuoteErrorV1("INITIAL_LIQUIDITY_OUTSIDE_POOL_RANGE", "incompatible");
  return {
    initialTick: selected.tick, sqrtPriceX96: anyQuoteSqrtPriceAtTickV1(selected.tick).toString(),
    tokenIsCurrency0, targetFdvUsd: ANY_QUOTE_START_FDV_USD.toString(), actualFdvUsd: selected.fdv,
    quoteUsd: anyQuoteRationalV1(usdN, usdD), quoteDecimals: input.quoteDecimals, lockedLiquidity: liquidity.toString(),
  };
}

export function encodeAnyQuoteConfigurationV1(input: {
  sharedHook: Address; quoteAsset: Address; initialTick: number; validUntil: bigint; priceEvidenceHash: Hex;
}) {
  if (!Number.isInteger(input.initialTick) || input.initialTick % 200 !== 0 || Math.abs(input.initialTick) >= MAX_GRID_TICK
    || input.validUntil <= 0n || input.validUntil >= 1n << 64n || !/^0x[0-9a-fA-F]{64}$/.test(input.priceEvidenceHash)
    || BigInt(input.priceEvidenceHash) === 0n) throw new AnyQuoteErrorV1("INVALID_CONFIGURATION");
  const configuration = encodeAbiParameters(parseAbiParameters("bytes32,address,bytes32,address,address,int24,uint64,bytes32"), [
    ANY_QUOTE_SCHEMA_ID, ANY_QUOTE_INFRASTRUCTURE.poolManager, ANY_QUOTE_INFRASTRUCTURE.poolManagerCodeHash,
    anyQuoteAddressV1(input.sharedHook), anyQuoteAddressV1(input.quoteAsset), input.initialTick,
    input.validUntil, input.priceEvidenceHash,
  ]);
  return { configuration, configurationHash: keccak256(configuration) };
}
