import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";

const boundary = vi.hoisted(() => ({
  store: vi.fn(), read: vi.fn(), write: vi.fn(), markets: vi.fn(), presentations: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (callback: unknown) => callback }));
vi.mock("@/lib/server/robinhood-index/store", () => ({ indexStore: boundary.store }));
vi.mock("@/lib/server/robinhood-presentation", () => ({
  readRobinhoodMarkets: boundary.markets,
  readRobinhoodPresentations: boundary.presentations,
}));

import { GET } from "@/app/api/profile/robinhood/route";
import { GET as GETPresentation } from "@/app/api/explore/robinhood/presentation/route";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";
import { profileLaunchList, type RobinhoodSnapshot } from "@/lib/server/robinhood-index/model";
import { readRobinhoodProfileLaunches } from "@/lib/server/robinhood-index/read";

const NOW = Date.parse("2026-09-05T12:00:00.000Z");
const OWNER = "0xa123456789012345678901234567890123456789";
const OTHER = "0xb123456789012345678901234567890123456789";
const MAIN_TOKEN = "0xc60ba256b44334a0cd2c7242e98b88f031abb006";
const CLEAN_ROOM = "0x15fca474b23cafe775120b1fafbcff0e7a827af2";
const address = (value: number) => `0x${value.toString(16).padStart(40, "0")}`;
const hash = (value: number) => `0x${value.toString(16).padStart(64, "0")}`;

function launch(id: number, overrides: Partial<RobinhoodLaunch> = {}): RobinhoodLaunch {
  return {
    routerAddress: address(1), launchId: hash(id), tokenAddress: address(1_000 + id),
    hookAddress: address(2_000 + id), creator: OWNER, poolManager: address(3),
    poolId: hash(3_000 + id), stampHash: hash(4_000 + id), transactionHash: hash(5_000 + id),
    blockNumber: String(100 + id), blockHash: hash(6_000 + id), logIndex: id,
    launchedAt: new Date(NOW - 60_000).toISOString(), name: `Token ${id}`, symbol: `T${id}`,
    decimals: 18, ...overrides,
  };
}

function snapshot(items: RobinhoodLaunch[] = [], overrides: Partial<RobinhoodSnapshot> = {}): RobinhoodSnapshot {
  return {
    version: 1, chainId: 4663, routerAddress: address(1), binding: hash(1), startBlock: "100",
    cursor: { number: "999", hash: hash(999) }, checkpoints: [], finalizedBlock: "999",
    updatedAt: new Date(NOW).toISOString(), items, ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  boundary.store.mockReturnValue({ read: boundary.read, write: boundary.write });
  boundary.read.mockResolvedValue(null);
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Unexpected provider request"))));
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Robinhood creator launch history", () => {
  it("matches only the exact canonical launch wallet, case-insensitively", () => {
    const owned = launch(1, { creator: getAddress(OWNER) });
    const unrelated = launch(2, { creator: OTHER, name: OWNER, symbol: OWNER, hookAddress: OWNER });
    const main = launch(3, { creator: OTHER, tokenAddress: MAIN_TOKEN });
    const result = profileLaunchList(snapshot([unrelated, main, owned]), getAddress(OWNER));
    expect(result).toMatchObject({ chainId: 4663, account: OWNER, status: "ready", items: [owned] });
    expect(result.page.totalItems).toBe(1);
  });

  it.each([CLEAN_ROOM, "0xb36271399c031ce270e0d1eed5f26dcd08367119"])("preserves the hidden %s creator history and does not pin the main token in a profile", (tokenAddress) => {
    const main = launch(1, { tokenAddress: MAIN_TOKEN });
    const cleanRoom = launch(2, { tokenAddress, name: null, symbol: null });
    const recent = launch(3);
    const saved = snapshot([main, cleanRoom, recent]);
    expect(profileLaunchList(saved, OWNER).items).toEqual([recent, cleanRoom, main]);
    expect(saved.items).toEqual([main, cleanRoom, recent]);
    expect(profileLaunchList(saved, OTHER).items).toEqual([]);
  });

  it("filters the full catalog before five-row pagination without losing any launch", () => {
    const owned = Array.from({ length: 11 }, (_, index) => launch(index + 1));
    const others = Array.from({ length: 80 }, (_, index) => launch(index + 100, { creator: OTHER }));
    const saved = snapshot([...owned, ...others]);
    const first = profileLaunchList(saved, OWNER, 1, NOW, 5);
    const second = profileLaunchList(saved, OWNER, 2, NOW, 5);
    const third = profileLaunchList(saved, OWNER, 3, NOW, 5);
    expect(first.page).toEqual({ number: 1, size: 5, totalItems: 11, totalPages: 3, hasMore: true });
    expect(second.page).toEqual({ number: 2, size: 5, totalItems: 11, totalPages: 3, hasMore: true });
    expect(third.page).toEqual({ number: 3, size: 5, totalItems: 11, totalPages: 3, hasMore: false });
    expect(first.items).toEqual(owned.slice(6).toReversed());
    expect(second.items).toEqual(owned.slice(1, 6).toReversed());
    expect(third.items).toEqual([owned[0]]);
    expect([...first.items, ...second.items, ...third.items]).toEqual(owned.toReversed());
    expect(profileLaunchList(saved, OWNER, 999_999, NOW, 5)).toEqual(third);
  });

  it("keeps the legacy default at 50 rows across pages", () => {
    const owned = Array.from({ length: 55 }, (_, index) => launch(index + 1));
    const saved = snapshot([...owned, launch(90, { creator: OTHER })]);
    const first = profileLaunchList(saved, OWNER);
    const second = profileLaunchList(saved, OWNER, 2);
    expect(first.page).toEqual({ number: 1, size: 50, totalItems: 55, totalPages: 2, hasMore: true });
    expect(second.page).toEqual({ number: 2, size: 50, totalItems: 55, totalPages: 2, hasMore: false });
    expect(first.items).toEqual(owned.slice(5).toReversed());
    expect(second.items).toEqual(owned.slice(0, 5).toReversed());
  });

  it("orders by exact block and log position with a deterministic address tie-break", () => {
    const earlier = launch(1, { blockNumber: "9007199254740992", logIndex: 99 });
    const firstLog = launch(2, { blockNumber: "9007199254740993", logIndex: 1 });
    const sameLogB = launch(4, { blockNumber: "9007199254740993", logIndex: 2 });
    const sameLogA = launch(3, { blockNumber: "9007199254740993", logIndex: 2 });
    expect(profileLaunchList(snapshot([earlier, sameLogB, firstLog, sameLogA]), OWNER).items)
      .toEqual([sameLogA, sameLogB, firstLog, earlier]);
  });

  it("distinguishes an empty ready profile from an unavailable index", () => {
    const ready = profileLaunchList(snapshot([launch(1, { creator: OTHER })]), OWNER, 9);
    expect(ready).toMatchObject({ status: "ready", items: [], updatedAt: new Date(NOW).toISOString() });
    expect(ready.page).toEqual({ number: 1, size: 50, totalItems: 0, totalPages: 0, hasMore: false });
    expect(profileLaunchList(null, OWNER)).toMatchObject({
      chainId: 4663, account: OWNER, status: "unavailable", updatedAt: null, items: [],
    });
  });

  it("retains owner rows when stale or syncing and excludes pending verification", () => {
    const owned = launch(1);
    const pending = launch(2);
    expect(profileLaunchList(snapshot([owned], {
      updatedAt: new Date(NOW - 300_001).toISOString(),
    }), OWNER)).toMatchObject({ status: "stale", items: [owned] });
    expect(profileLaunchList(snapshot([owned], { finalizedBlock: "1000" }), OWNER))
      .toMatchObject({ status: "syncing", items: [owned] });
    expect(profileLaunchList(snapshot([owned], {
      pending: { block: { number: pending.blockNumber, hash: pending.blockHash }, items: [pending] },
    }), OWNER)).toMatchObject({ status: "syncing", items: [owned] });
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("normalizes invalid internal page %s to page one", (page) => {
    expect(profileLaunchList(snapshot([launch(1)]), OWNER, page).page.number).toBe(1);
  });

  it.each(["", "0x123", `${OWNER}0`, ` ${OWNER}`, "not-an-address"])("rejects invalid internal account %s", (account) => {
    expect(() => profileLaunchList(null, account)).toThrow("Invalid Robinhood profile account");
  });
});

describe("Robinhood profile snapshot reader", () => {
  it("reads the saved snapshot without querying market providers or writing storage", async () => {
    const owned = launch(1);
    boundary.read.mockResolvedValue({ snapshot: snapshot([owned, launch(2, { creator: OTHER })]), etag: "saved" });
    expect(await readRobinhoodProfileLaunches(getAddress(OWNER))).toMatchObject({
      account: OWNER, chainId: 4663, status: "ready", items: [owned],
    });
    expect(boundary.read).toHaveBeenCalledOnce();
    expect(boundary.markets).not.toHaveBeenCalled();
    expect(boundary.presentations).not.toHaveBeenCalled();
    expect(boundary.write).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([5, 50] as const)("preserves requested size %s in an account-scoped unavailable result", async (pageSize) => {
    boundary.read.mockRejectedValue(new Error("private provider credentials"));
    const result = await readRobinhoodProfileLaunches(getAddress(OWNER), 8, pageSize);
    expect(result).toMatchObject({ account: OWNER, status: "unavailable", updatedAt: null, items: [] });
    expect(result.page.number).toBe(1);
    expect(result.page.size).toBe(pageSize);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(boundary.markets).not.toHaveBeenCalled();
    expect(boundary.write).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an invalid account before storage access", async () => {
    await expect(readRobinhoodProfileLaunches("invalid")).rejects.toThrow("Invalid Robinhood profile account");
    expect(boundary.store).not.toHaveBeenCalled();
  });
});

describe("Robinhood public profile HTTP boundary", () => {
  const request = (query: string) => new Request(`https://website.invalid/api/profile/robinhood?${query}`);

  it("serves a normalized public wallet profile without an auth credential", async () => {
    const owned = launch(1);
    boundary.read.mockResolvedValue({ snapshot: snapshot([owned]), etag: "saved" });
    const response = await GET(request(`account=${getAddress(OWNER)}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ chainId: 4663, account: OWNER, status: "ready", items: [owned], page: { size: 50 } });
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=15, stale-while-revalidate=30");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(boundary.write).not.toHaveBeenCalled();
  });

  it("serves the requested creator page with no cross-account rows", async () => {
    const owned = Array.from({ length: 6 }, (_, index) => launch(index + 1));
    boundary.read.mockResolvedValue({ snapshot: snapshot([...owned, launch(90, { creator: OTHER })]), etag: "saved" });
    const response = await GET(request(`account=${OWNER}&page=2&pageSize=5`));
    expect(await response.json()).toMatchObject({
      items: [owned[0]], page: { number: 2, size: 5, totalItems: 6, totalPages: 2, hasMore: false },
    });
  });

  it.each([undefined, 50, 5] as const)("aligns page-two presentation with profile rows for pageSize=%s", async (pageSize) => {
    const owned = Array.from({ length: 51 }, (_, index) => launch(index + 1));
    boundary.read.mockResolvedValue({ snapshot: snapshot([...owned, launch(90, { creator: OTHER })]), etag: "saved" });
    boundary.presentations.mockImplementation(async (items: RobinhoodLaunch[]) => items.map(row => ({ tokenAddress: row.tokenAddress })));
    const query = `account=${OWNER}&page=2${pageSize === undefined ? "" : `&pageSize=${pageSize}`}`;
    const size = pageSize ?? 50;
    const profile = await (await GET(request(query))).json();
    const expected = owned.toReversed().slice(size, size * 2);
    expect(profile.items).toEqual(expected);
    expect(profile.page.size).toBe(size);
    const presentation = await GETPresentation(new Request(`https://website.invalid/api/explore/robinhood/presentation?${query}`));
    expect(presentation.status).toBe(200);
    expect(boundary.presentations).toHaveBeenCalledExactlyOnceWith(expected);
    expect((await presentation.json()).items).toEqual(expected.map(row => ({ tokenAddress: row.tokenAddress })));
    expect(boundary.write).not.toHaveBeenCalled();
  });

  it.each([
    "", "page=1", "account=", "account=invalid", "account=0x123", `account=%20${OWNER}`,
    `account=${OWNER}&account=${OWNER}`, `account=${OWNER}&page=1&page=2`,
    `account=${OWNER}&chainId=1`, `account=${OWNER}&chainId=4663`, `account=${OWNER}&sort=newest`,
    `account=${OWNER}&page=`, `account=${OWNER}&page=0`, `account=${OWNER}&page=-1`,
    `account=${OWNER}&page=1.5`, `account=${OWNER}&page=01`, `account=${OWNER}&page=1000000`,
    ...["", "0", "1", "10", "51", "05", "5.0", "-5", "5e0", "invalid"].map(size => `account=${OWNER}&pageSize=${size}`),
    `account=${OWNER}&pageSize=5&pageSize=5`, `account=${OWNER}&pageSize=5&pageSize=50`,
  ])("rejects invalid query %s before any index read", async (query) => {
    const response = await GET(request(query));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_query" });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(boundary.store).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not accept write methods", async () => {
    const response = await GET(new Request(`https://website.invalid/api/profile/robinhood?account=${OWNER}`, {
      method: "POST", body: "{}",
    }));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(boundary.store).not.toHaveBeenCalled();
  });

  it("returns the unavailable contract when the saved index is missing", async () => {
    const response = await GET(request(`account=${OWNER}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ account: OWNER, chainId: 4663, status: "unavailable", items: [] });
  });
});
