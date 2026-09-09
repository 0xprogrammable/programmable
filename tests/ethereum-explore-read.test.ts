import { describe, expect, it, vi } from "vitest";
import { canonicalTokenExploreEntryV1 } from "@/lib/explore-entry-v1";
import type { CanonicalTokenExploreEntry } from "@/lib/tokens";
import { parseEthereumExploreQuery } from "@/lib/ethereum-explore";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/market-data/envio-classic-v3-catalog.server", () => ({ readEnvioClassicV3CatalogV1: vi.fn() }));
vi.mock("@/lib/alchemy/router-custom-public.server", () => ({ readWebsiteRouterCustomIdentitySnapshotV1: vi.fn() }));
import { readEthereumLaunches } from "@/lib/server/ethereum-explore";
const hex = (n: number, size: number) => `0x${n.toString(16).padStart(size, "0")}` as `0x${string}`;
function entry(n: number): CanonicalTokenExploreEntry {
  return canonicalTokenExploreEntryV1({ id: `1:${hex(n,40)}`, name: `Coin ${n}`, symbol: `C${n}`, tokenAddress: hex(n,40),
    hookAddress: hex(100,40), poolId: hex(n,64), creatorAddress: hex(101,40), launchTransactionHash: hex(n,64),
    launchBlockNumber: String(n), launchLogIndex: n, launchedAt: "2026-09-08T01:00:00.000Z", tokenDecimals: 18,
    totalSwapFeeBps: 100, launchModel: "classic", liquidityPath: "meme" });
}
const source = (entries: CanonicalTokenExploreEntry[], status: "current" | "last-known-good" = "current") =>
  async () => ({ entries, status, generatedAt: "2026-09-09T02:00:00.000Z" });
const unavailable = async (): Promise<never> => { throw new Error("source unavailable"); };

describe("Ethereum verified Explore adapter", () => {
  it("searches and pages verified launch identities without inventing market values", async () => {
    const entries = Array.from({length:23},(_,i)=>entry(i+1));
    const dependencies = { classic: source(entries), custom: source([]) };
    const result = await readEthereumLaunches(2,"",{sort:"newest",mode:"all"},10,dependencies);
    expect(result.status).toBe("ready");
    expect(result.items.map(item=>item.name)).toEqual(entries.slice(3,13).toReversed().map(e=>e.name));
    expect(result.page).toEqual({number:2,size:10,totalItems:23,totalPages:3,hasMore:true});
    expect(result.presentations.every(item=>item.market===null)).toBe(true);
    const search = await readEthereumLaunches(1,"$C19",{sort:"newest"},10,dependencies);
    expect(search.items.map(item=>item.tokenAddress)).toEqual([entry(19).tokenAddress]);
  });
  it("retains available identities and explicitly reports a missing source", async () => {
    const result = await readEthereumLaunches(1,"",{sort:"newest"},10,{classic:source([entry(1)]),custom:unavailable});
    expect(result.status).toBe("partial"); expect(result.items).toHaveLength(1);
    expect(result.sources).toEqual({classic:"current",custom:"unavailable"});
  });
  it("never labels an unavailable or saved source as an empty ready index", async () => {
    const unavailableResult=await readEthereumLaunches(1,"",{sort:"newest"},10,{classic:unavailable,custom:unavailable});
    expect(unavailableResult.status).toBe("unavailable"); expect(unavailableResult.items).toEqual([]);
    const saved=await readEthereumLaunches(1,"",{sort:"newest"},10,{classic:source([entry(1)],"last-known-good"),custom:source([])});
    expect(saved.status).toBe("stale"); expect(saved.updatedAt).toBe("2026-09-09T02:00:00.000Z");
  });
  it("rejects cross-source duplicate identities instead of silently selecting a record", async () => {
    await expect(readEthereumLaunches(1,"",{sort:"newest"},10,{classic:source([entry(1)]),custom:source([entry(1)])})).rejects.toThrow("Conflicting Ethereum launch identities");
  });
  it("restricts Ethereum filters to supported data and rejects ambiguous parameters", () => {
    expect(parseEthereumExploreQuery(new URLSearchParams("mode=classic&sort=oldest&pageSize=10"))?.filters).toEqual({mode:"classic",sort:"oldest"});
    for(const query of ["sort=highest","mode=module","page=0","page=1&page=2","chain=4663","pageSize=5"]) {
      expect(parseEthereumExploreQuery(new URLSearchParams(query))).toBeNull();
    }
  });
});
