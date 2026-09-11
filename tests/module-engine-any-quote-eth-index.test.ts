import { describe, expect, it } from "vitest";
import { encodeFunctionResult, zeroAddress } from "viem";
import evidence from "./fixtures/module-engine-any-quote-eth-index.json";
import { normalizeModuleEngineLaunchV1 } from "@/lib/module-engine/index/provenance-v1";
import { bindActiveModuleEngineRelease } from "@/lib/module-engine/catalog";
import { anyQuoteNativeFeeRouteAbi } from "@/lib/module-engine/any-quote/native-fee-route";
import { moduleEnginePublicLaunch } from "@/lib/server/robinhood-index/module-source";
import { isRobinhoodEngineLaunch } from "@/lib/robinhood-launches";
import { hash } from "./module-engine-fixture";

describe("Native ETH Any Quote index source", () => {
  it("matches backend canonical normalization and retains native denomination through public serialization", () => {
    for (const f of evidence.cases) {
      const launch = normalizeModuleEngineLaunchV1(f.range.launches[0].evidence, bindActiveModuleEngineRelease(f.release));
      expect(launch).toEqual(f.normalized);
      const row = moduleEnginePublicLaunch(launch, f.range.launches[0].launchedAt);
      expect(isRobinhoodEngineLaunch(row)).toBe(true);
      expect(row).toMatchObject({ feeAsset: zeroAddress, feeDecimals: 18, nativeFeeRouteHash: f.normalized.nativeFeeRouteHash,
        primaryMarket: { nativeFeeRouteHash: f.normalized.nativeFeeRouteHash }, platformFeeBps: 30, authorPoolFeeBps: 0 });
      for (const changed of [{ ...row, feeAsset: row.quoteAsset }, { ...row, feeDecimals: row.quoteDecimals },
        { ...row, nativeFeeRouteHash: hash(909) }, { ...row, primaryMarket: { ...row.primaryMarket, nativeFeeRouteHash: undefined } }]) expect(isRobinhoodEngineLaunch(changed)).toBe(false);
    }
  });
  it("rejects changed fee-route getter bytes even when all pool configuration remains unchanged", () => {
    const f = structuredClone(evidence.cases[0]);
    const raw = f.range.launches[0].evidence;
    const read = raw.market.reads.find(row => row.functionName === "nativeFeeRouteHash");
    if (!read) throw Error("Fixture route getter missing");
    read.result = encodeFunctionResult({ abi: anyQuoteNativeFeeRouteAbi, functionName: "nativeFeeRouteHash", result: hash(909) });
    expect(() => normalizeModuleEngineLaunchV1(raw, bindActiveModuleEngineRelease(f.release))).toThrow();
  });
  it("rejects missing route binding and incorrect source profile rather than publishing a marketless native coin", () => {
    const f = structuredClone(evidence.cases[0]);
    const raw = f.range.launches[0].evidence;
    const routeEvent = anyQuoteNativeFeeRouteAbi.find(e => e.type === "event" && e.name === "NativeFeeRouteBound");
    expect(routeEvent).toBeDefined();
    // Removing any hook registration log leaves the original discovery event intact.
    raw.receipt.logs = raw.receipt.logs.filter(log => log.address !== f.release.contracts.sharedHook.address);
    expect(() => normalizeModuleEngineLaunchV1(raw, bindActiveModuleEngineRelease(f.release))).toThrow();
    expect(() => bindActiveModuleEngineRelease({ ...f.release, sourceVersion: "module-engine-any-quote-v1" })).toThrow();
  });
});
