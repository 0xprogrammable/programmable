import { describe, expect, it, vi } from "vitest";
import evidence from "./fixtures/module-engine-any-quote-index.json";
import { normalizeModuleEngineLaunchV1 } from "@/lib/module-engine/index/provenance-v1";
import { bindActiveModuleEngineRelease } from "@/lib/module-engine/catalog";
import { moduleEnginePublicLaunch, moduleModeSource } from "@/lib/server/robinhood-index/module-source";
import { isRobinhoodEngineLaunch } from "@/lib/robinhood-launches";
import { parseModuleModeSnapshot } from "@/lib/server/robinhood-index/model";

const point = (f: typeof evidence.cases[number]) => ({ chainId: 4663 as const, blockNumber: f.normalized.blockNumber, blockHash: f.normalized.blockHash });
describe("Any Quote canonical engine lane", () => {
  it("agrees byte-for-byte with backend launch normalization and retains actual quote fees and shared pool", () => {
    for (const f of evidence.cases) {
      const launch = normalizeModuleEngineLaunchV1(f.range.launches[0].evidence, bindActiveModuleEngineRelease(f.release));
      expect(launch).toEqual(f.normalized);
      const row = moduleEnginePublicLaunch(launch, f.range.launches[0].launchedAt);
      expect(isRobinhoodEngineLaunch(row)).toBe(true);
      expect(row).toMatchObject({ sourceKind: "module-engine-v1", protocolFeeBps: 30, authorPoolFeeBps: 0, platformFeeBps: 30,
        feeAsset: launch.quoteAsset, feeLedgerAddress: f.release.contracts.ledger.address, feeEligibleFamilyIds: [],
        hookAddress: f.release.contracts.sharedHook.address, poolId: launch.primaryMarket!.poolId });
      expect(row.engineAddress).not.toBe(row.hookAddress);
      for (const changed of [{ ...row, protocolFeeBps: 10 }, { ...row, primaryMarket: null }, { ...row, feeAsset: row.tokenAddress },
        { ...row, hookAddress: row.engineAddress, primaryMarket: { ...row.primaryMarket, hook: row.engineAddress } },
        { ...row, feeEligibleFamilyIds: row.moduleFamilyIds }, { ...row, feeLedgerAddress: undefined }]) expect(isRobinhoodEngineLaunch(changed)).toBe(false);
    }
  });
  it("authenticates the new sourceVersion while preserving the existing source-kind envelope", async () => {
    const f = evidence.cases[0], release = bindActiveModuleEngineRelease(f.release);
    const source = await moduleModeSource(release, { authenticateRelease: vi.fn(async () => {}),
      finalizedBoundary: async () => ({ ...point(f), sourceReleaseDigest: release.releaseDigest, verificationDigest: f.normalized.verificationDigest }),
      canonicalBlock: async () => point(f), collectRange: async () => ({ ...f.range, complete: true }) });
    expect(source.sourceKind).toBe("module-engine-v1");
    const rows = await source.launches(100n, 100n, []);
    expect(parseModuleModeSnapshot({ version: 1, chainId: 4663, sourceKind: source.sourceKind, sourceAddress: source.sourceAddress,
      releaseDigest: source.releaseDigest, startBlock: release.startBlock, cursor: source.finalized, checkpoints: [], pending: null,
      finalizedBlock: source.finalized.number, updatedAt: f.range.launches[0].launchedAt, items: rows }).items).toEqual(rows);
  });
});
