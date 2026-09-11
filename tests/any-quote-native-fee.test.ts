import { describe, expect, it } from "vitest";
import { encodeAbiParameters, keccak256, zeroAddress, type Hex } from "viem";
import { ANY_QUOTE_NATIVE_FEE_ROUTE_PARAMETERS, anyQuoteNativeFeeRouteFromExternal, decodeAnyQuoteNativeFeeRoute, type AnyQuoteNativeFeeHop } from "@/lib/module-engine/any-quote/native-fee-route";
import { assertAnyQuoteNativeBacking, assertAnyQuoteNativeFeeSettlement } from "@/lib/module-engine/any-quote/native-fee-evidence";
import { anyQuotePoolIdV1, anyQuoteSwapPathV1 } from "@/lib/module-engine/any-quote/route";
import { anyQuotePoolFor } from "@/lib/module-engine/any-quote/integration";
import { ANY_QUOTE_WETH, type AnyQuoteExternalRouteV1 } from "@/lib/module-engine/any-quote/types";
import { bindModuleEngineReleaseIdentity, computeModuleEngineReleaseDigest, moduleEngineReleaseIdentity } from "@/lib/module-engine/catalog";
import { isModuleEngineAnyQuoteEthRelease, isModuleEngineAnyQuoteRelease, isModuleEngineSharedQuoteRelease, moduleEngineSourceId, MODULE_ENGINE_ANY_QUOTE_SOURCE_ID, MODULE_ENGINE_ANY_QUOTE_ETH_SOURCE_ID, MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID, MODULE_ENGINE_ANY_QUOTE_ETH_ECONOMICS_POLICY_ID } from "@/lib/module-engine/profile";
import { moduleEngineAnyQuoteEthLedgerAbi, moduleEngineAnyQuoteLedgerAbi } from "@/lib/module-engine/abi";
import { anyQuoteUiFixture } from "./module-engine-any-quote-ui-fixture";
import { QUOTE, TOKEN, addr, hash } from "./module-engine-fixture";

const key = { currency0: zeroAddress, currency1: QUOTE, fee: 3000, tickSpacing: 60, hooks: zeroAddress };
const pool = anyQuotePoolFor(TOKEN, QUOTE, addr(901));
const hop: AnyQuoteNativeFeeHop = { key, zeroForOne: false, hookData: "0x" };
const bytes = (hops: readonly AnyQuoteNativeFeeHop[]) => encodeAbiParameters(ANY_QUOTE_NATIVE_FEE_ROUTE_PARAMETERS, [hops]);
function external(buy = false): AnyQuoteExternalRouteV1 { return {
  chainId: 4663, provider: "uniswap-trading-api", tokenIn: buy ? ANY_QUOTE_WETH : QUOTE, tokenOut: buy ? QUOTE : ANY_QUOTE_WETH,
  amountIn: "1000", amountOut: "3000", validUntil: "1800000120", checkpoint: { number: "100", hash: hash(100), timestamp: "1800000000" }, evidenceHash: hash(101),
  hops: [{ protocol: "V4", key, poolId: anyQuotePoolIdV1(key), tokenIn: buy ? zeroAddress : QUOTE, tokenOut: buy ? QUOTE : zeroAddress, hookData: "0x" }],
}; }

describe("Any Quote native ETH profile and immutable fee route", () => {
  it("keeps historical quote identities and claim ABIs separate", () => {
    const old = moduleEngineReleaseIdentity(anyQuoteUiFixture().release), native = moduleEngineReleaseIdentity(anyQuoteUiFixture(true).release);
    expect(bindModuleEngineReleaseIdentity(native)).toEqual(native);
    expect(moduleEngineSourceId(old)).toBe(MODULE_ENGINE_ANY_QUOTE_SOURCE_ID);
    expect(moduleEngineSourceId(native)).toBe(MODULE_ENGINE_ANY_QUOTE_ETH_SOURCE_ID);
    expect(isModuleEngineAnyQuoteRelease(native)).toBe(false); expect(isModuleEngineAnyQuoteEthRelease(old)).toBe(false);
    expect([old, native].every(isModuleEngineSharedQuoteRelease)).toBe(true);
    expect(() => computeModuleEngineReleaseDigest({ ...native, economicsPolicyId: MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID })).toThrow();
    expect(() => computeModuleEngineReleaseDigest({ ...old, economicsPolicyId: MODULE_ENGINE_ANY_QUOTE_ETH_ECONOMICS_POLICY_ID })).toThrow();
    expect(moduleEngineAnyQuoteEthLedgerAbi.some(item => item.name === "claimQuoteTo")).toBe(false);
    expect(moduleEngineAnyQuoteLedgerAbi.some(item => String(item.name) === "claimEthTo")).toBe(false);
  });
  it("binds exact canonical quote-to-native bytes and reverses only direction-independent buy hops", () => {
    const expected = decodeAnyQuoteNativeFeeRoute(bytes([hop]), pool);
    expect(expected.routeHash).toBe(keccak256(expected.launchData));
    expect(anyQuoteNativeFeeRouteFromExternal(external(), pool)).toEqual(expected);
    expect(anyQuoteNativeFeeRouteFromExternal(external(true), pool)).toEqual(expected);
    const directional = external(true); directional.hops = [{ ...directional.hops[0], hookData: "0x01" } as typeof directional.hops[number]];
    expect(() => anyQuoteNativeFeeRouteFromExternal(directional, pool)).toThrow();
    expect(() => decodeAnyQuoteNativeFeeRoute(`${expected.launchData}00`, pool)).toThrow();
    expect(() => decodeAnyQuoteNativeFeeRoute(bytes([]), pool)).toThrow();
  });
  it("rejects wrong direction, nonnative endpoint, primary token, shared hook, cycles and oversized paths", () => {
    const intermediate = addr(20), first = { key: { currency0: intermediate, currency1: QUOTE, fee: 3000, tickSpacing: 60, hooks: zeroAddress }, zeroForOne: false, hookData: "0x" as Hex };
    for (const route of [
      [{ ...hop, zeroForOne: true }], [first], [{ ...hop, key: { ...key, hooks: pool.sharedHook } }],
      [first, { ...first, zeroForOne: true }, hop], Array(5).fill(hop), [{ ...hop, hookData: `0x${"01".repeat(2049)}` as Hex }],
    ]) expect(() => decodeAnyQuoteNativeFeeRoute(bytes(route), pool)).toThrow();
    expect(() => decodeAnyQuoteNativeFeeRoute(bytes([hop]), { ...pool, token: QUOTE })).toThrow();
  });
  it("uses one complete native path for both trade directions and rejects a disconnected quote", () => {
    expect(anyQuoteSwapPathV1(pool, "buy", external(true)).map(h => h.intermediateCurrency)).toEqual([QUOTE, TOKEN]);
    expect(anyQuoteSwapPathV1(pool, "sell", external()).map(h => h.intermediateCurrency)).toEqual([QUOTE, zeroAddress]);
    const otherPool = anyQuotePoolFor(TOKEN, addr(999), pool.sharedHook);
    expect(() => anyQuoteSwapPathV1(otherPool, "buy", external(true))).toThrow("EXTERNAL_ROUTE_MISMATCH");
  });
});

function settlement() {
  const launchId = hash(10), routeHash = keccak256(bytes([hop])), ledger = addr(22), hookAddress = pool.sharedHook;
  return { poolId: pool.poolId, launchId, quoteAsset: QUOTE, routeHash, ledger, hook: hookAddress,
    swap: { poolId: pool.poolId, launchId, platformQuote: 3n, creatorQuote: 10n },
    conversions: [{ poolId: pool.poolId, launchId, routeHash, quoteAmount: 13n, ethAmount: 100n, platformEth: 23n, creatorEth: 77n }],
    accruals: [{ launchId, quoteAsset: QUOTE, platformEth: 23n, creatorEth: 77n, creditedEth: 100n }],
    credits: [{ launchId, quoteAsset: QUOTE, beneficiary: addr(23), amount: 23n }, { launchId, quoteAsset: QUOTE, beneficiary: addr(24), amount: 77n }],
    mints: [{ caller: hookAddress, from: zeroAddress, to: ledger, id: 0n, amount: 100n }],
  };
}
describe("Native fee receipt accounting", () => {
  it("requires actual ETH conversion, ledger accrual, recipient credit and Core currency-0 mint", () => {
    expect(assertAnyQuoteNativeFeeSettlement(settlement())).toBe(100n);
    for (const corrupt of [
      (s: ReturnType<typeof settlement>) => { s.conversions[0].routeHash = hash(900); },
      (s: ReturnType<typeof settlement>) => { s.conversions[0].quoteAmount = 12n; },
      (s: ReturnType<typeof settlement>) => { s.conversions[0].ethAmount = 0n; },
      (s: ReturnType<typeof settlement>) => { s.conversions[0].creatorEth = 78n; },
      (s: ReturnType<typeof settlement>) => { s.mints[0].id = BigInt(QUOTE); },
      (s: ReturnType<typeof settlement>) => { s.mints[0].caller = addr(99); },
      (s: ReturnType<typeof settlement>) => { s.mints[0].amount = 99n; },
      (s: ReturnType<typeof settlement>) => { s.credits[1].amount = 76n; },
    ]) { const s = settlement(); corrupt(s); expect(() => assertAnyQuoteNativeFeeSettlement(s)).toThrow(); }
  });
  it("allows bounded rounding dust and zero current fees without inventing ETH output", () => {
    const s = settlement(); s.accruals[0].creditedEth = 101n; s.credits[1].amount = 78n;
    expect(assertAnyQuoteNativeFeeSettlement(s)).toBe(100n);
    expect(() => assertAnyQuoteNativeBacking(1001n, 1001n, 0n, 1001n)).not.toThrow();
    const zero = { ...settlement(), swap: { ...settlement().swap, platformQuote: 0n, creatorQuote: 0n }, conversions: [], accruals: [], credits: [], mints: [] };
    expect(assertAnyQuoteNativeFeeSettlement(zero)).toBe(0n);
    expect(() => assertAnyQuoteNativeFeeSettlement({ ...zero, mints: settlement().mints })).toThrow();
    expect(() => assertAnyQuoteNativeBacking(1000n, 1001n, 0n, 1001n)).toThrow();
    expect(() => assertAnyQuoteNativeBacking(1000n, 999n, 10n, 989n)).toThrow();
  });
});
