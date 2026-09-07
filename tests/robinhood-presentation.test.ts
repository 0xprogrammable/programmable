import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RobinhoodLaunch } from "@/lib/robinhood-launches";

const storage = vi.hoisted(() => ({ list: vi.fn(), token: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: (callback: unknown) => callback }));
vi.mock("@/lib/server/robinhood-index/read", () => ({
  readRobinhoodLaunches: storage.list,
  readRobinhoodToken: storage.token,
}));

import { readRobinhoodMarkets, readRobinhoodPresentations } from "@/lib/server/robinhood-presentation";
import { GET } from "@/app/api/explore/robinhood/presentation/route";
// @ts-expect-error -- package fixtures are intentionally JavaScript.
import { validV4ProjectMetadata } from "../packages/launch/test/fixtures/v4.mjs";
// @ts-expect-error -- canonical metadata hashing is intentionally JavaScript.
import { hashProjectMetadata } from "../packages/launch/src/project-metadata.mjs";

const hash = (digit: string) => `0x${digit.repeat(64)}`;
const address = (digit: string) => `0x${digit.repeat(40)}`;
const TOKEN: RobinhoodLaunch = {
  routerAddress: address("1"), launchId: hash("1"), tokenAddress: address("2"),
  hookAddress: address("3"), creator: address("4"), poolManager: address("5"),
  poolId: hash("2"), stampHash: hash("3"), transactionHash: hash("4"),
  blockNumber: "50000", blockHash: hash("5"), logIndex: 7,
  launchedAt: "2026-09-04T12:00:00.000Z", name: "Robinhood V4 Test", symbol: "RHV4", decimals: 18,
};

function finalizedLaunch() {
  const projectMetadata = validV4ProjectMetadata();
  const commitment = hashProjectMetadata(projectMetadata, { requireComplete: true });
  return {
    schemaVersion: "programmable.finalized-custom-launch-metadata.v4", apiVersion: "v4",
    chainId: "4663", caip2: "eip155:4663", platformId: "programmable", category: "custom",
    chainDeploymentId: "robinhood-mainnet-custom-launch-v1",
    projectMetadata, commitments: { metadata: commitment },
    onchain: {
      schemaVersion: "programmable.custom-launch-onchain-evidence.v3", chainId: "4663", caip2: "eip155:4663",
      terminal: true, checkpointType: "ethereum_finalized", router: TOKEN.routerAddress,
      routerLaunchId: TOKEN.launchId, transactionHash: TOKEN.transactionHash, commitments: { metadata: commitment },
      l2Inclusion: {
        chainId: "4663", caip2: "eip155:4663", receiptStatus: "success",
        transactionHash: TOKEN.transactionHash, blockNumber: TOKEN.blockNumber,
        blockHash: TOKEN.blockHash, launchEventLogIndex: TOKEN.logIndex,
      },
    },
    sourceVerification: { status: "exact_match", components: [
      { address: TOKEN.tokenAddress, status: "exact_match" },
      { address: TOKEN.hookAddress, status: "exact_match" },
    ] },
  };
}

function feed(launches = [finalizedLaunch()]) {
  return {
    schemaVersion: "programmable.custom-launch-list.v4", apiVersion: "v4", chainId: "4663", caip2: "eip155:4663",
    generatedAt: new Date().toISOString(), quality: {
      status: "ready", sourceRowCount: launches.length, publishedRowCount: launches.length, quarantinedRowCount: 0,
    }, launches, nextCursor: null as string | null,
  };
}

function pair() {
  return {
    chainId: "robinhood", dexId: "uniswap", labels: ["v4"], pairAddress: TOKEN.poolId,
    baseToken: { address: TOKEN.tokenAddress }, priceUsd: "0.003", marketCap: 3_000_000,
    fdv: 8_000_000, liquidity: { usd: 250_000 }, volume: { h24: 0 }, priceChange: { h24: -2.5 },
    url: "https://wrong-provider-url.example/",
  };
}

function sourceFetch(metadata: unknown = feed(), market: unknown = { pairs: [pair()] }) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.startsWith("https://api.programmable.market/v4/chains/4663/finalized-custom-launches")) {
      if (metadata instanceof Error) throw metadata;
      return metadata instanceof Response ? metadata : Response.json(metadata);
    }
    if (url.startsWith("https://api.dexscreener.com/latest/dex/pairs/robinhood/")) {
      if (market instanceof Error) throw market;
      return market instanceof Response ? market : Response.json(market);
    }
    throw new Error("Unexpected source request");
  });
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("Robinhood optional coin presentation", () => {
  it("joins the committed artwork to the saved launch and keeps exact-pool MC separate from FDV", async () => {
    const fetcher = sourceFetch();
    vi.stubGlobal("fetch", fetcher);
    const [value] = await readRobinhoodPresentations([TOKEN]);
    expect(value).toMatchObject({ tokenAddress: TOKEN.tokenAddress, imageUrl: "https://example.com/token.png",
      links: [{ label: "Website", url: "https://example.com/" }, { label: "X", url: "https://x.com/programmable" }],
      market: { poolId: TOKEN.poolId, priceUsd: 0.003, marketCapUsd: 3_000_000, liquidityUsd: 250_000,
        volume24hUsd: 0, change24hPercent: -2.5, sourceUrl: `https://dexscreener.com/robinhood/${TOKEN.poolId}` },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual(expect.arrayContaining([
      `https://api.dexscreener.com/latest/dex/pairs/robinhood/${TOKEN.poolId}`,
      "https://api.programmable.market/v4/chains/4663/finalized-custom-launches?limit=25",
    ]));
  });

  it.each([
    ["chain", (value: ReturnType<typeof finalizedLaunch>) => { value.chainId = "1"; }],
    ["router", (value: ReturnType<typeof finalizedLaunch>) => { value.onchain.router = address("9"); }],
    ["launch", (value: ReturnType<typeof finalizedLaunch>) => { value.onchain.routerLaunchId = hash("9"); }],
    ["receipt", (value: ReturnType<typeof finalizedLaunch>) => { value.onchain.l2Inclusion.transactionHash = hash("9"); }],
    ["block", (value: ReturnType<typeof finalizedLaunch>) => { value.onchain.l2Inclusion.blockHash = hash("9"); }],
    ["log", (value: ReturnType<typeof finalizedLaunch>) => { value.onchain.l2Inclusion.launchEventLogIndex++; }],
    ["token", (value: ReturnType<typeof finalizedLaunch>) => { value.sourceVerification.components[0].address = address("9"); }],
    ["hook", (value: ReturnType<typeof finalizedLaunch>) => { value.sourceVerification.components[1].address = address("9"); }],
    ["metadata hash", (value: ReturnType<typeof finalizedLaunch>) => { value.projectMetadata.presentation.description = "Changed after commitment"; }],
    ["finality", (value: ReturnType<typeof finalizedLaunch>) => { value.onchain.terminal = false; }],
  ])("does not attach metadata with a different %s, but keeps the coin and market", async (_, mutate) => {
    const launch = finalizedLaunch();
    mutate(launch);
    vi.stubGlobal("fetch", sourceFetch(feed([launch])));
    const [value] = await readRobinhoodPresentations([TOKEN]);
    expect(value.tokenAddress).toBe(TOKEN.tokenAddress);
    expect(value.imageUrl).toBeNull();
    expect(value.description).toBeNull();
    expect(value.market?.marketCapUsd).toBe(3_000_000);
  });

  it.each([
    ["chain", { chainId: "ethereum" }], ["pool", { pairAddress: hash("9") }],
    ["token", { baseToken: { address: address("9") } }], ["DEX", { dexId: "other" }],
    ["generation", { labels: ["v3"] }],
  ])("rejects a market for another %s without removing the verified artwork", async (_, change) => {
    vi.stubGlobal("fetch", sourceFetch(feed(), { pairs: [{ ...pair(), ...change }] }));
    const [value] = await readRobinhoodPresentations([TOKEN]);
    expect(value.market).toBeNull();
    expect(value.imageUrl).toBe("https://example.com/token.png");
  });

  it("leaves missing market cap empty instead of relabelling FDV", async () => {
    const market: Record<string, unknown> = pair();
    delete market.marketCap;
    vi.stubGlobal("fetch", sourceFetch(feed(), { pairs: [market] }));
    expect((await readRobinhoodPresentations([TOKEN]))[0].market).toMatchObject({ marketCapUsd: null, priceUsd: 0.003 });
  });

  it("resolves committed IPFS artwork through the established public gateway", async () => {
    const launch = finalizedLaunch();
    const cid = "QmYwAPJzv5CZsnAzt8auVZRnGi1Wm4eQNf6gMss5QZb7S6";
    launch.projectMetadata.presentation.image.uri = `ipfs://${cid}`;
    const commitment = hashProjectMetadata(launch.projectMetadata, { requireComplete: true });
    launch.commitments.metadata = commitment;
    launch.onchain.commitments.metadata = commitment;
    vi.stubGlobal("fetch", sourceFetch(feed([launch])));
    expect((await readRobinhoodPresentations([TOKEN]))[0].imageUrl).toBe(`https://ipfs.io/ipfs/${cid}`);
  });

  it("rejects ambiguous duplicate pool matches", async () => {
    vi.stubGlobal("fetch", sourceFetch(feed(), { pairs: [pair(), pair()] }));
    expect((await readRobinhoodPresentations([TOKEN]))[0].market).toBeNull();
  });

  it("keeps successful artwork when the market provider fails", async () => {
    vi.stubGlobal("fetch", sourceFetch(feed(), new Error("offline")));
    const [value] = await readRobinhoodPresentations([TOKEN]);
    expect(value.market).toBeNull();
    expect(value.imageUrl).toBe("https://example.com/token.png");
  });

  it("keeps successful market data when the metadata provider fails", async () => {
    vi.stubGlobal("fetch", sourceFetch(new Error("offline")));
    const [value] = await readRobinhoodPresentations([TOKEN]);
    expect(value.imageUrl).toBeNull();
    expect(value.market?.marketCapUsd).toBe(3_000_000);
  });

  it("uses only the known main-token artwork when both providers are unavailable", async () => {
    vi.stubGlobal("fetch", sourceFetch(new Error("offline"), new Error("offline")));
    const main = { ...TOKEN, tokenAddress: "0xC60bA256B44334A0Cd2C7242E98B88f031abB006" };
    const values = await readRobinhoodPresentations([main, TOKEN]);
    expect(values[0].imageUrl).toBe("/brand/projects/programmable-main-token-v1.webp");
    expect(values[1].imageUrl).toBeNull();
    expect(values).toHaveLength(2);
  });

  it("rejects stale metadata and oversized responses without affecting token identity", async () => {
    const stale = feed();
    stale.generatedAt = "2020-01-01T00:00:00.000Z";
    const oversized = new Response("{}", { headers: { "content-type": "application/json", "content-length": "2000001" } });
    vi.stubGlobal("fetch", sourceFetch(stale, oversized));
    expect(await readRobinhoodPresentations([TOKEN])).toEqual([
      { tokenAddress: TOKEN.tokenAddress, imageUrl: null, description: null, links: [], market: null },
    ]);
  });

  it("does not send provider requests for no tokens or an excessive batch", async () => {
    const fetcher = sourceFetch();
    vi.stubGlobal("fetch", fetcher);
    expect(await readRobinhoodPresentations([])).toEqual([]);
    await expect(readRobinhoodPresentations(Array(51).fill(TOKEN))).rejects.toThrow("Invalid presentation request");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Robinhood catalog market observations", () => {
  it.each([new Error("offline"), { invalid: true }])("rejects failed refreshes so they cannot replace a cached observation", async (failure) => {
    vi.stubGlobal("fetch", sourceFetch(feed(), failure));
    await expect(readRobinhoodMarkets([TOKEN])).rejects.toThrow("Market observation unavailable");
  });

  it("accepts a successful response with no indexed pair as unknown market data", async () => {
    vi.stubGlobal("fetch", sourceFetch(feed(), { pairs: null }));
    expect(await readRobinhoodMarkets([TOKEN])).toEqual(new Map());
  });

  it("batches the full catalog beyond the visible page with bounded concurrency and exact pool joins", async () => {
    const tokens = Array.from({ length: 151 }, (_, index) => ({ ...TOKEN,
      tokenAddress: `0x${(index + 1).toString(16).padStart(40, "0")}`,
      poolId: `0x${(index + 1).toString(16).padStart(64, "0")}`,
    }));
    let active = 0;
    let peak = 0;
    const sizes: number[] = [];
    const fetcher = vi.fn(async (input: string) => {
      active++;
      peak = Math.max(peak, active);
      const pools = input.split("/").at(-1)!.split(",");
      sizes.push(pools.length);
      await Promise.resolve();
      active--;
      return Response.json({ pairs: pools.map((pool) => {
        const token = tokens.find((row) => row.poolId === pool)!;
        return { ...pair(), pairAddress: pool, baseToken: { address: token.tokenAddress } };
      }) });
    });
    vi.stubGlobal("fetch", fetcher);
    const result = await readRobinhoodMarkets(tokens.toReversed());
    expect(result.size).toBe(151);
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(Math.max(...sizes)).toBe(30);
    expect(peak).toBeLessThanOrEqual(4);
    expect(result.get(tokens[150].tokenAddress)?.poolId).toBe(tokens[150].poolId);
  });

  it("uses the supplied catalog observation for card values without fetching prices again", async () => {
    const fetcher = sourceFetch();
    vi.stubGlobal("fetch", fetcher);
    const market = { poolId: TOKEN.poolId, priceUsd: 2, marketCapUsd: 42, liquidityUsd: null,
      volume24hUsd: null, change24hPercent: null, observedAt: new Date().toISOString(), sourceUrl: "https://dexscreener.com/" };
    const result = await readRobinhoodPresentations([TOKEN], new Map([[TOKEN.tokenAddress, market]]));
    expect(result[0].market).toBe(market);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(String(fetcher.mock.calls[0][0])).toContain("finalized-custom-launches");
  });
});

describe("Robinhood presentation HTTP boundary", () => {
  const endpoint = "https://website.invalid/api/explore/robinhood/presentation";
  it.each([
    "chain=1", "page=0", "page=1000000", "page=1&page=2", "q=a&q=b", `q=${"x".repeat(129)}`,
    "age=invalid", "sort=market-cap", "age=7d&age=30d", `token=${TOKEN.tokenAddress}&age=7d`,
    "token=bad", `token=${TOKEN.tokenAddress}&page=1`, `token=${TOKEN.tokenAddress}&token=${TOKEN.tokenAddress}`,
  ])("rejects invalid query %s before storage or providers", async (query) => {
    const fetcher = sourceFetch();
    vi.stubGlobal("fetch", fetcher);
    expect((await GET(new Request(`${endpoint}?${query}`))).status).toBe(400);
    expect(storage.list).not.toHaveBeenCalled();
    expect(storage.token).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not look up unverified token addresses at a provider", async () => {
    const fetcher = sourceFetch();
    vi.stubGlobal("fetch", fetcher);
    storage.token.mockResolvedValue({ token: null, status: "ready" });
    const response = await GET(new Request(`${endpoint}?token=${TOKEN.tokenAddress}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reuses the selected page presentation without a second provider observation", async () => {
    vi.stubGlobal("fetch", sourceFetch());
    storage.list.mockResolvedValue({ items: [TOKEN], presentations: [{ tokenAddress: TOKEN.tokenAddress, market: null }] });
    const response = await GET(new Request(`${endpoint}?page=2&q=RHV4`));
    expect(storage.list).toHaveBeenCalledWith(2, "RHV4", { sort: "highest", mode: "all" }, 50);
    expect(storage.token).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("s-maxage=60");
    expect((await response.json()).items[0].tokenAddress).toBe(TOKEN.tokenAddress);
  });
  it("enriches the same filtered page as the launch list", async () => {
    vi.stubGlobal("fetch", sourceFetch());
    storage.list.mockResolvedValue({ items: [TOKEN], presentations: [{ tokenAddress: TOKEN.tokenAddress, market: null }] });
    const response = await GET(new Request(`${endpoint}?page=2&q=RHV4&sort=lowest`));
    expect(response.status).toBe(200);
    expect(storage.list).toHaveBeenCalledWith(2, "RHV4", { sort: "lowest", mode: "all" }, 50);
  });
});
