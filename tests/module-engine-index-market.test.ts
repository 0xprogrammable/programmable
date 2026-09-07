import { describe, expect, it, vi } from "vitest";
import evidence from "./fixtures/module-engine-index.json";
import { a, h } from "./fixtures/module-mode-evidence";
import type { RobinhoodEngineLaunch } from "@/lib/robinhood-launches";
import { bindActiveModuleEngineRelease } from "@/lib/module-engine/catalog";
import { normalizeModuleEngineLaunchV1 } from "@/lib/module-engine/index/provenance-v1";
import { moduleEnginePublicLaunch } from "@/lib/server/robinhood-index/module-source";
import { parseSnapshot, type RobinhoodSnapshot } from "@/lib/server/robinhood-index/model";
import { IndexBlockIncomplete, syncModuleModeIndex, type ModuleModeIndexSource } from "@/lib/server/robinhood-index/sync";

const fixture = evidence.cases[1];
const marketRow = moduleEnginePublicLaunch(normalizeModuleEngineLaunchV1(fixture.range.launches[0].evidence,
  bindActiveModuleEngineRelease(fixture.release)), fixture.range.launches[0].launchedAt);
const withoutMarket = (overrides: Partial<RobinhoodEngineLaunch> = {}): RobinhoodEngineLaunch => ({ ...marketRow,
  primaryMarket: null, poolId: null, poolManager: null, hookAddress: null, verificationDigest: h(900), ...overrides });
const point = (number: number) => ({ number: String(number), hash: number === 100 ? marketRow.blockHash : h(number) });
const options = { rangeSize: 100n, now: () => Date.parse("2026-09-07T12:00:00Z") };
function setup(items: RobinhoodEngineLaunch[] = [marketRow]) {
  let saved: RobinhoodSnapshot = parseSnapshot({ version: 1, chainId: 4663, routerAddress: a(1), binding: h(2),
    startBlock: "50", cursor: point(100), checkpoints: [], finalizedBlock: "100", updatedAt: "2026-09-07T12:00:00Z", items: [],
    moduleMode: { version: 1, chainId: 4663, sourceKind: "module-engine-v1", sourceAddress: marketRow.sourceAddress,
      releaseDigest: marketRow.sourceReleaseDigest, startBlock: "100", cursor: point(100), checkpoints: [point(100)],
      finalizedBlock: "100", updatedAt: "2026-09-07T12:00:00Z", items } });
  let version = 0;
  const write = vi.fn(async (next: RobinhoodSnapshot, etag: string | null) => {
    expect(etag).toBe(`v${version++}`); saved = parseSnapshot(structuredClone(next));
  });
  const source: ModuleModeIndexSource = { sourceKind: "module-engine-v1", sourceAddress: marketRow.sourceAddress,
    releaseDigest: marketRow.sourceReleaseDigest, startBlock: 100n, finalized: point(101), block: async n => point(Number(n)),
    launches: async () => [withoutMarket()] };
  return { source, write, store: { read: async () => ({ snapshot: structuredClone(saved), etag: `v${version}` }), write },
    saved: () => saved, replace: (next: RobinhoodSnapshot) => { saved = parseSnapshot(next); } };
}

describe("Engine market proof retention during canonical replay", () => {
  it("retains the complete proven row and its digest through optional read failure and later overlap expiry", async () => {
    const f = setup();
    expect((await syncModuleModeIndex(f.source, f.store, options)).status).toBe("ready");
    expect(f.saved().moduleMode?.items).toEqual([marketRow]);
    expect(f.saved().moduleMode?.cursor).toEqual(point(101));
    f.source.finalized = point(300);
    await syncModuleModeIndex(f.source, f.store, options);
    f.source.finalized = point(400); f.source.launches = async () => [];
    await syncModuleModeIndex(f.source, f.store, options);
    expect(f.saved().moduleMode?.items).toEqual([marketRow]);
    expect(f.saved().moduleMode?.cursor).toEqual(point(400));
  });
  it("accepts first membership without a market and enriches it after actual positive verification", async () => {
    const f = setup([]);
    await syncModuleModeIndex(f.source, f.store, options);
    expect(f.saved().moduleMode?.items).toEqual([withoutMarket()]);
    f.source.launches = async () => [marketRow];
    await syncModuleModeIndex(f.source, f.store, options);
    expect(f.saved().moduleMode?.items).toEqual([marketRow]);
  });
  it.each([
    ["transactionHash", h(901)], ["resourcesHash", h(902)], ["engineAddress", a(903)], ["tokenAddress", a(904)],
    ["quoteAsset", a(905)], ["quoteDecimals", 18], ["engineManifestHash", h(906)], ["configurationHash", h(907)],
    ["constructorHash", h(908)], ["initCodeHash", h(909)], ["planHash", h(910)],
    ["engineRuntimeCodeHash", h(911)], ["tokenRuntimeCodeHash", h(912)],
  ] as const)("does not transfer a market proof to a changed %s", async (key, value) => {
    const f = setup(), next = withoutMarket({ [key]: value });
    f.source.launches = async () => [next];
    await syncModuleModeIndex(f.source, f.store, options);
    expect(f.saved().moduleMode?.items).toEqual([next]);
  });
  it.each(["sourceAddress", "sourceReleaseDigest"] as const)("does not hide a changed %s behind retained evidence", async key => {
    const f = setup(); f.source.launches = async () => [withoutMarket({ [key]: key === "sourceAddress" ? a(914) : h(914) })];
    expect((await syncModuleModeIndex(f.source, f.store, options)).status).toBe("partial");
    expect(f.write).not.toHaveBeenCalled();
  });
  it("discards the old market on a canonical reorg before merging the replacement launch", async () => {
    const f = setup(), next = withoutMarket({ blockHash: h(915), transactionHash: h(916) });
    f.source.block = async n => n === 100n ? { number: "100", hash: next.blockHash } : point(Number(n));
    f.source.launches = async () => [next];
    expect((await syncModuleModeIndex(f.source, f.store, options)).rewound).toBe(true);
    expect(f.saved().moduleMode?.items).toEqual([next]);
  });
  it("retains a pending positive proof with its original digest through incomplete block retries", async () => {
    const f = setup([]), saved = f.saved();
    f.replace({ ...saved, moduleMode: { ...saved.moduleMode!, cursor: null, checkpoints: [], pending: { block: point(100), items: [marketRow] } } });
    f.source.launches = async () => { throw new IndexBlockIncomplete([withoutMarket()]); };
    await syncModuleModeIndex(f.source, f.store, { ...options, rangeSize: 1n });
    expect(f.saved().moduleMode?.pending?.items).toEqual([marketRow]);
    f.source.launches = async () => [withoutMarket()];
    await syncModuleModeIndex(f.source, f.store, { ...options, rangeSize: 1n, maxRanges: 1 });
    expect(f.saved().moduleMode?.items).toEqual([marketRow]);
  });
  it("fails closed on contradictory positive market proofs for the same canonical launch", async () => {
    const f = setup(), poolId = h(917);
    f.source.launches = async () => [{ ...marketRow, poolId, primaryMarket: { ...marketRow.primaryMarket!, poolId }, verificationDigest: h(918) }];
    expect((await syncModuleModeIndex(f.source, f.store, options)).status).toBe("partial");
    expect(f.write).not.toHaveBeenCalled(); expect(f.saved().moduleMode?.items).toEqual([marketRow]);
  });
});
