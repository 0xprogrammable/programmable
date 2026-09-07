import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";
import type { RobinhoodCoinMarket } from "@/lib/robinhood-presentation";
import type { RobinhoodSnapshot } from "@/lib/server/robinhood-index/model";

const mocks = vi.hoisted(() => ({ read: vi.fn(), markets: vi.fn(), presentations: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (callback: unknown) => callback }));
vi.mock("@/lib/server/robinhood-index/store", () => ({ indexStore: () => ({ read: mocks.read }) }));
vi.mock("@/lib/server/robinhood-presentation", () => ({ readRobinhoodMarkets: mocks.markets, readRobinhoodPresentations: mocks.presentations }));
import { readRobinhoodLaunches } from "@/lib/server/robinhood-index/read";

const hex = (value: number, length: number) => `0x${value.toString(16).padStart(length, "0")}`;
function token(id: number): RobinhoodLaunch & { poolId: string } {
  return { routerAddress: hex(1, 40), launchId: hex(id, 64), tokenAddress: hex(id, 40), hookAddress: hex(id + 100, 40),
    creator: hex(2, 40), poolManager: hex(3, 40), poolId: hex(id + 200, 64), stampHash: hex(id + 300, 64),
    transactionHash: hex(id + 400, 64), blockNumber: String(id), blockHash: hex(id + 500, 64), logIndex: 1,
    launchedAt: null, name: `Token ${id}`, symbol: `T${id}`, decimals: 18 };
}
function saved(items: RobinhoodLaunch[]): RobinhoodSnapshot {
  return { version: 1, chainId: 4663, routerAddress: hex(1, 40), binding: hex(1, 64), startBlock: "1",
    cursor: { number: "100", hash: hex(100, 64) }, checkpoints: [], finalizedBlock: "100", updatedAt: new Date().toISOString(), items };
}
function market(row: RobinhoodLaunch & { poolId: string }, value: number): RobinhoodCoinMarket {
  return { poolId: row.poolId, priceUsd: null, marketCapUsd: value, liquidityUsd: null, volume24hUsd: null,
    change24hPercent: null, observedAt: new Date().toISOString(), sourceUrl: "https://dexscreener.com/" };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.presentations.mockImplementation(async (rows: RobinhoodLaunch[], markets: Map<string, RobinhoodCoinMarket>) =>
    rows.map((row) => ({ tokenAddress: row.tokenAddress, imageUrl: null, description: null, links: [], market: markets.get(row.tokenAddress) ?? null })));
});

describe("Robinhood Explore read model", () => {
  it("ranks the full visible catalog and presents only the selected page using the same prices", async () => {
    const rows = Array.from({ length: 60 }, (_, index) => token(index + 1));
    const hidden = { ...token(61), tokenAddress: "0x15fca474b23cafe775120b1fafbcff0e7a827af2" };
    const observations = new Map(rows.map((row, index) => [row.tokenAddress, market(row, 60 - index)]));
    mocks.read.mockResolvedValue({ snapshot: saved([...rows, hidden]) });
    mocks.markets.mockResolvedValue(observations);
    const result = await readRobinhoodLaunches(2);
    expect(mocks.markets).toHaveBeenCalledWith(rows);
    expect(result.items).toEqual(rows.slice(50));
    expect(mocks.presentations).toHaveBeenCalledWith(rows.slice(50), observations);
    expect(result.presentations[0].market).toBe(observations.get(rows[50].tokenAddress));
    expect(result.page.totalItems).toBe(60);
  });

  it("keeps verified launches when the market provider is unavailable", async () => {
    const rows = [token(1), token(2)];
    mocks.read.mockResolvedValue({ snapshot: saved(rows) });
    mocks.markets.mockRejectedValue(new Error("provider unavailable"));
    const result = await readRobinhoodLaunches();
    expect(result.status).toBe("ready");
    expect(result.items).toEqual(rows.toReversed());
    expect(result.presentations.map((item) => item.market)).toEqual([null, null]);
  });

  it("presents the selected ten-card page while the legacy default remains fifty", async () => {
    const rows = Array.from({ length: 12 }, (_, index) => token(index + 1));
    mocks.read.mockResolvedValue({ snapshot: saved(rows) });
    mocks.markets.mockResolvedValue(new Map());
    const result = await readRobinhoodLaunches(2, "", { sort: "newest" }, 10);
    expect(result.items).toEqual(rows.slice(0, 2).toReversed());
    expect(result.page).toEqual({ number: 2, size: 10, totalItems: 12, totalPages: 2, hasMore: false });
    expect(mocks.presentations).toHaveBeenCalledWith(result.items, new Map());
  });

  it("keeps verified launches if optional image or social enrichment fails", async () => {
    const rows = [token(1), token(2)];
    mocks.read.mockResolvedValue({ snapshot: saved(rows) });
    mocks.markets.mockResolvedValue(new Map());
    mocks.presentations.mockRejectedValue(new Error("metadata unavailable"));
    const result = await readRobinhoodLaunches(1, "", { sort: "newest" }, 10);
    expect(result.status).toBe("ready");
    expect(result.items).toEqual(rows.toReversed());
    expect(result.presentations).toEqual([]);
  });
});
