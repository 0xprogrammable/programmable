import { describe, expect, it } from "vitest";
import type { RobinhoodLaunch, RobinhoodModuleLaunch } from "@/lib/robinhood-launches";
import { parseRobinhoodExploreQuery } from "@/lib/robinhood-explore-filters";
import { PINNED_ROBINHOOD_TOKEN } from "@/lib/robinhood-explore-policy";
import { launchList, parseSnapshot, profileLaunchList, type RobinhoodSnapshot } from "@/lib/server/robinhood-index/model";

const now = Date.parse("2026-09-07T00:00:00Z");
const hex = (value: number, length = 64) => `0x${value.toString(16).padStart(length, "0")}`;
const address = (value: number) => hex(value, 40);

function custom(id: number): RobinhoodLaunch {
  return { routerAddress: address(1), launchId: hex(id), tokenAddress: address(1_000 + id), hookAddress: address(2),
    creator: address(3), poolManager: address(4), poolId: hex(1_000 + id), stampHash: hex(2_000 + id),
    transactionHash: hex(3_000 + id), blockNumber: String(100 + id), blockHash: hex(4_000 + id), logIndex: id,
    launchedAt: new Date(now).toISOString(), name: `Module ${id}`, symbol: "MODULE", decimals: 18 };
}

function native(id: number): RobinhoodModuleLaunch {
  return { ...custom(id), sourceKind: "module-native-v1", routerAddress: null, stampHash: null,
    sourceAddress: address(20), sourceReleaseDigest: hex(21), recipeHash: hex(id + 5_000), runtime: address(22),
    launchKey: hex(id + 6_000), verificationDigest: hex(id + 7_000), modulePackageIds: [], moduleFamilyIds: [], name: `Coin ${id}` };
}

function catalog() {
  const pinned = { ...custom(99), tokenAddress: PINNED_ROBINHOOD_TOKEN, name: "Programmable" };
  const customs = Array.from({ length: 20 }, (_, index) => custom(index + 1));
  const modules = Array.from({ length: 20 }, (_, index) => native(index + 31));
  const saved: RobinhoodSnapshot = { version: 1, chainId: 4663, routerAddress: address(1), binding: hex(9), startBlock: "1",
    cursor: { number: "999", hash: hex(999) }, checkpoints: [], finalizedBlock: "999", updatedAt: new Date(now).toISOString(),
    items: [pinned, ...customs], moduleMode: { version: 1, sourceKind: "module-native-v1", chainId: 4663,
      sourceAddress: address(20), releaseDigest: hex(21), startBlock: "1", cursor: { number: "999", hash: hex(999) },
      checkpoints: [], finalizedBlock: "999", updatedAt: new Date(now).toISOString(), items: modules } };
  return { saved: parseSnapshot(saved), pinned, customs, modules };
}

describe("Explore source filters and card pagination", () => {
  it.each(["all", "module", "custom"] as const)("paginates all %s matches with the main token on every page", mode => {
    const { saved, pinned, customs, modules } = catalog();
    const expected = (mode === "module" ? modules : mode === "custom" ? customs : [...customs, ...modules]).toReversed();
    const first = launchList(saved, 1, "", now, { sort: "newest", mode }, undefined, 10);
    const collected: RobinhoodLaunch[] = [];
    for (let page = 1; page <= first.page.totalPages; page++) {
      const result = launchList(saved, page, "", now, { sort: "newest", mode }, undefined, 10);
      expect(result.items[0]).toEqual(pinned);
      expect(result.items.length).toBeLessThanOrEqual(10);
      expect(result.page).toMatchObject({ number: page, size: 10, totalItems: expected.length + 1,
        totalPages: Math.ceil(expected.length / 9), hasMore: page < first.page.totalPages });
      collected.push(...result.items.slice(1));
    }
    expect(collected).toEqual(expected);
    expect(new Set(collected.map(row => row.tokenAddress)).size).toBe(expected.length);
    expect(saved.items).toEqual([pinned, ...customs]);
    expect(saved.moduleMode?.items).toEqual(modules);
  });

  it("uses canonical source identity even for plain coins and misleading names", () => {
    const { saved, customs, modules } = catalog();
    const selected = launchList(saved, 1, "", now, { sort: "newest", mode: "module" });
    expect(selected.items.slice(1)).toEqual(modules.toReversed());
    expect(selected.items.every(row => !customs.includes(row))).toBe(true);
    expect(selected.items.slice(1).every(row => row.modulePackageIds?.length === 0)).toBe(true);
    const emptySearch = launchList(saved, 1, "missing", now, { sort: "newest", mode: "module" }, undefined, 10);
    expect(emptySearch.items.map(row => row.tokenAddress)).toEqual([PINNED_ROBINHOOD_TOKEN]);
    expect(emptySearch.page).toMatchObject({ totalItems: 1, totalPages: 1, hasMore: false });
  });

  it("keeps the main token in an empty source and preserves existing API and profile page sizes", () => {
    const { saved, pinned } = catalog();
    expect(launchList(saved).page.size).toBe(50);
    expect(profileLaunchList(saved, address(3)).page.size).toBe(50);
    saved.moduleMode!.items = [];
    const result = launchList(saved, 9, "", now, { sort: "newest", mode: "module" }, undefined, 10);
    expect(result.items).toEqual([pinned]);
    expect(result.page).toEqual({ number: 1, size: 10, totalItems: 1, totalPages: 1, hasMore: false });
  });

  it("keeps direct search, page bounds and saved pending records separate", () => {
    const { saved, pinned, modules } = catalog();
    const filters = { sort: "newest" as const, mode: "module" as const };
    expect(launchList(saved, 99, modules[0].tokenAddress, now, filters, undefined, 10).items).toEqual([pinned, modules[0]]);
    expect(launchList(saved, NaN, "", now, filters, undefined, 10).page.number).toBe(1);
    const pending = native(51);
    saved.moduleMode!.pending = { block: { number: pending.blockNumber, hash: pending.blockHash }, items: [pending] };
    expect(launchList(saved, 1, pending.tokenAddress, now, filters, undefined, 10).items).toEqual([pinned]);
  });
});

describe("Explore query compatibility", () => {
  it("defaults existing API requests to fifty and lets the website request ten", () => {
    expect(parseRobinhoodExploreQuery(new URLSearchParams())).toEqual({ page: 1, pageSize: 50, q: "", filters: { sort: "highest", mode: "all" } });
    expect(parseRobinhoodExploreQuery(new URLSearchParams("page=2&pageSize=10&mode=module&sort=newest&q=coin")))
      .toEqual({ page: 2, pageSize: 10, q: "coin", filters: { sort: "newest", mode: "module" } });
  });

  it.each(["pageSize=0", "pageSize=9", "pageSize=100", "pageSize=010", "pageSize=10&pageSize=50", "pageSize=10&pageSize=10",
    "mode=unknown", "mode=Module", "mode=module&mode=custom", "mode=module&mode=module"])("rejects invalid or ambiguous values: %s", query => {
    expect(parseRobinhoodExploreQuery(new URLSearchParams(query))).toBeNull();
  });
});
