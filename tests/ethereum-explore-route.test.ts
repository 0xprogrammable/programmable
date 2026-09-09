import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/server/ethereum-explore", () => ({ readEthereumLaunches: mocks.read }));
import { GET } from "@/app/api/explore/ethereum/route";
beforeEach(() => vi.resetAllMocks());
describe("Ethereum Explore HTTP boundary", () => {
  it("rejects unsupported input before reading any source", async () => {
    const response = await GET(new Request("https://website.invalid/api/explore/ethereum?chain=4663"));
    expect(response.status).toBe(400); expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each(["partial", "stale", "unavailable"])("exposes %s without caching it as a ready catalog", async status => {
    const result = { chainId: 1, status, items: [] };
    mocks.read.mockResolvedValue(result);
    const response = await GET(new Request("https://website.invalid/api/explore/ethereum"));
    expect(response.status).toBe(status === "unavailable" ? 503 : 200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-programmable-indexing-status")).toBe(status);
    expect(await response.json()).toEqual(result);
  });
  it("keeps source exceptions private while returning an explicit failure", async () => {
    mocks.read.mockRejectedValue(new Error("https://provider.invalid/secret"));
    const response = await GET(new Request("https://website.invalid/api/explore/ethereum"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({error:"Launches are temporarily unavailable",status:"unavailable"});
  });
});
