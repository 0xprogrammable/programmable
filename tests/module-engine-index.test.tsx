import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import evidence from "./fixtures/module-engine-index.json";
import { normalizeModuleEngineLaunchV1 } from "@/lib/module-engine/index/provenance-v1";
import { bindActiveModuleEngineRelease } from "@/lib/module-engine/catalog";
import { isRobinhoodModuleLaunch, isRobinhoodEngineLaunch, robinhoodModuleManageHref } from "@/lib/robinhood-launches";
import { moduleModeCoinReleaseSelection } from "@/lib/module-mode/release-selection";
import { createModuleModeHttpCollector, moduleEnginePublicLaunch, moduleModeSource, configuredModuleModeSources, type ModuleModeReleaseCollector } from "@/lib/server/robinhood-index/module-source";
import { parseModuleModeSnapshot, parseSnapshot, snapshotLaunches, type ModuleModeSnapshot, type RobinhoodSnapshot } from "@/lib/server/robinhood-index/model";
import { syncModuleModeIndex } from "@/lib/server/robinhood-index/sync";
import { readRobinhoodProfileResponse } from "@/lib/profile/robinhood-profile";
import { RobinhoodTokenView } from "@/components/robinhood-token-view";
import { a, h } from "./fixtures/module-mode-evidence";

vi.mock("@/components/use-robinhood-presentation", () => ({ useRobinhoodPresentation: () => ({ items: [], loading: false }) }));
const fixture = (market = false) => evidence.cases[market ? 1 : 0];
function normalized(market = false) { const f = fixture(market); return normalizeModuleEngineLaunchV1(f.range.launches[0].evidence, bindActiveModuleEngineRelease(f.release)); }
function lane(market = false): ModuleModeSnapshot {
  const f = fixture(market), row = moduleEnginePublicLaunch(normalized(market), f.range.launches[0].launchedAt);
  return { version: 1, chainId: 4663, sourceKind: "module-engine-v1", sourceAddress: row.sourceAddress, releaseDigest: row.sourceReleaseDigest,
    startBlock: f.release.startBlock, finalizedBlock: "100", cursor: { number: "100", hash: row.blockHash }, checkpoints: [], updatedAt: f.range.launches[0].launchedAt, items: [row] };
}
function outer(): RobinhoodSnapshot { return { version: 1, chainId: 4663, routerAddress: a(1), binding: h(2), startBlock: "50", cursor: { number: "100", hash: h(3) }, checkpoints: [], finalizedBlock: "100", updatedAt: "2026-09-07T12:00:00Z", items: [] }; }

describe("Engine source and canonical website projection", () => {
  it("matches the backend normalizer exactly for a pool and a non-market engine", () => {
    for (const market of [false, true]) expect(normalized(market)).toEqual(fixture(market).normalized);
  });
  it("stores non-market engines without fabricating Native/Router/pool identity", () => {
    const source = parseModuleModeSnapshot(lane());
    const saved = parseSnapshot({ ...outer(), moduleMode: source });
    const row = snapshotLaunches(saved)[0];
    expect(isRobinhoodEngineLaunch(row)).toBe(true); expect(isRobinhoodModuleLaunch(row)).toBe(true);
    expect(row).toMatchObject({ routerAddress: null, stampHash: null, poolId: null, poolManager: null, hookAddress: null, primaryMarket: null });
    for (const key of ["recipeHash", "runtime", "launchKey"]) expect(row).not.toHaveProperty(key);
    const href = robinhoodModuleManageHref(row)!;
    expect(href).toContain("sourceKind=module-engine-v1"); expect(href).toContain(`releaseDigest=${source.releaseDigest}`);
    expect(moduleModeCoinReleaseSelection({}, row)).toEqual({ sourceKind: "module-engine-v1", releaseDigest: source.releaseDigest });
    const html = renderToStaticMarkup(<RobinhoodTokenView address={row.tokenAddress} token={row} status="ready" />);
    expect(html).toContain("Manage coin"); expect(html).toContain("No trading market is verified"); expect(html).not.toContain("<iframe");
    expect(readRobinhoodProfileResponse({ chainId: 4663, status: "ready", updatedAt: saved.updatedAt, account: row.creator,
      items: [row], page: { number: 1, size: 50, totalItems: 1, totalPages: 1, hasMore: false } }, row.creator).items).toEqual([row]);
  });
  it("binds real pool data and rejects pool, generation, fee and receipt substitutions", () => {
    const source = lane(true), row = source.items[0];
    expect(parseModuleModeSnapshot(source).items[0].poolId).toEqual(fixture(true).normalized.primaryMarket?.poolId);
    for (const changed of [{ ...row, poolId: h(71) }, { ...row, primaryMarket: null }, { ...row, recipeHash: h(72) },
      { ...row, sourceKind: "module-native-v2" }, { ...row, economicsPolicyId: h(73) }, { ...row, platformFeeBps: 20 },
      { ...row, engineRevisionId: h(74) }, { ...row, feeEligibleFamilyIds: [h(1), h(1)] }, { ...row, sourceReleaseDigest: h(75) }]) {
      expect(() => parseModuleModeSnapshot({ ...source, items: [changed] })).toThrow();
    }
    const duplicate = { ...row, launchId: h(79), tokenAddress: a(79) };
    expect(() => parseModuleModeSnapshot({ ...source, items: [row, duplicate] })).toThrow();
    const broken = structuredClone(fixture().range.launches[0].evidence);
    broken.receipt.blockHash = h(84);
    expect(() => normalizeModuleEngineLaunchV1(broken, bindActiveModuleEngineRelease(fixture().release))).toThrow();
  });
  it("uses the existing authenticated source transport for engine releases", async () => {
    const release = bindActiveModuleEngineRelease(fixture().release), fetchBackend = vi.fn<typeof fetch>();
    fetchBackend.mockResolvedValueOnce(Response.json({ schemaVersion: "programmable.module-mode-index.v1", result: release }));
    const collector = createModuleModeHttpCollector({ backendBaseUrl: "https://backend.example", websiteToken: "fixture-service-credential-never-a-real-secret", fetchBackend });
    await collector.authenticateRelease(release);
    expect(fetchBackend).toHaveBeenCalledWith(new URL("https://backend.example/internal/module-mode-index/v1/release"), expect.objectContaining({ method: "POST", body: JSON.stringify({ sourceReleaseDigest: release.releaseDigest }), redirect: "error" }));
    fetchBackend.mockResolvedValueOnce(Response.json({ schemaVersion: "programmable.module-mode-index.v1", result: { ...release, lifecycleEvidenceDigest: h(85) } }));
    await expect(collector.authenticateRelease(release)).rejects.toThrow();
  });
  it("advances an engine lane through the existing shared CAS and observes no pool for settlement", async () => {
    const f = fixture(), release = bindActiveModuleEngineRelease(f.release), point = { chainId: 4663 as const, blockNumber: "100", blockHash: f.normalized.blockHash };
    const collector: ModuleModeReleaseCollector = { authenticateRelease: vi.fn(async () => {}),
      finalizedBoundary: async () => ({ ...point, sourceReleaseDigest: release.releaseDigest, verificationDigest: h(88) }),
      canonicalBlock: async () => point, collectRange: async () => ({ ...f.range, complete: true }), listAuthorizedSources: async () => ({ releases: [release], unavailableSources: [] }) };
    const source = await moduleModeSource(release, collector);
    expect(source.sourceAddress).toBe(release.contracts.host.address);
    let saved = outer(); saved.startBlock = "100";
    const write = vi.fn(async (next: RobinhoodSnapshot, etag: string | null) => { expect(etag).toBe("original"); saved = next; });
    await syncModuleModeIndex({ ...source, startBlock: 100n }, { read: async () => ({ snapshot: saved, etag: "original" }), write }, { rangeSize: 1n, now: () => Date.parse(saved.updatedAt) });
    expect(write).toHaveBeenCalledOnce(); expect(saved.moduleMode?.items[0]).toMatchObject({ sourceKind: "module-engine-v1", primaryMarket: null });
    expect((await configuredModuleModeSources(collector, undefined, { enabled: false, status: "preview" })).lanes[0].releaseDigest).toBe(release.releaseDigest);
  });
});
