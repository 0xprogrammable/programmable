import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), source: vi.fn(), moduleSource: vi.fn(), store: vi.fn(), sync: vi.fn() }));
vi.mock("@/lib/server/robinhood-index/read", () => ({ readRobinhoodLaunches: mocks.read }));
vi.mock("@/lib/server/robinhood-index/source", () => ({ robinhoodSource: mocks.source }));
vi.mock("@/lib/server/robinhood-index/module-source", () => ({ configuredModuleModeSource: mocks.moduleSource }));
vi.mock("@/lib/server/robinhood-index/store", () => ({ indexStore: mocks.store }));
vi.mock("@/lib/server/robinhood-index/sync", () => ({ syncRobinhoodIndex: mocks.sync }));
import { GET as list } from "@/app/api/explore/robinhood/route";
import { GET as update } from "@/app/api/ops/robinhood-index/route";

beforeEach(() => { vi.clearAllMocks(); mocks.moduleSource.mockResolvedValue(null); vi.stubEnv("CRON_SECRET", "a".repeat(48)); });

describe("Robinhood website HTTP boundaries", () => {
  it.each(["chainId=1", "page=0", "page=1&page=2", "q=a&q=b", `q=${"x".repeat(129)}`, "age=0", "age=any", "age=7d&age=30d", "sort=market-cap", "sort=oldest&sort=newest"])("rejects invalid public query %s without reading storage", async (query) => {
    expect((await list(new Request(`https://website.invalid/api/explore/robinhood?${query}`))).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.moduleSource).not.toHaveBeenCalled();
  });
  it("reads only the saved list with bounded query values", async () => {
    mocks.read.mockResolvedValue({ chainId: 4663, status: "ready", items: [] });
    const response = await list(new Request("https://website.invalid/api/explore/robinhood?page=2&q=V4"));
    expect(response.status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith(2, "V4", { sort: "highest" });
    expect(mocks.source).not.toHaveBeenCalled();
  });
  it.each(["highest", "lowest", "newest", "oldest"])("passes %s order to the complete saved list", async (sort) => {
    mocks.read.mockResolvedValue({ chainId: 4663, status: "ready", items: [] });
    expect((await list(new Request(`https://website.invalid/api/explore/robinhood?page=2&q=V4&sort=${sort}`))).status).toBe(200);
    expect(mocks.read).toHaveBeenCalledWith(2, "V4", { sort });
    expect(mocks.source).not.toHaveBeenCalled();
  });
  it.each([undefined, "Bearer wrong", `Bearer ${"b".repeat(48)}`])("does not start background work with invalid authorization", async (authorization) => {
    const response = await update(new Request("https://website.invalid/api/ops/robinhood-index", {
      headers: authorization ? { authorization } : {},
    }));
    expect(response.status).toBe(401);
    expect(mocks.store).not.toHaveBeenCalled();
    expect(mocks.source).not.toHaveBeenCalled();
  });
  it("does not accept operator overrides in the URL", async () => {
    expect((await update(new Request("https://website.invalid/api/ops/robinhood-index?chain=1", {
      headers: { authorization: `Bearer ${"a".repeat(48)}` },
    }))).status).toBe(400);
    expect(mocks.source).not.toHaveBeenCalled();
  });
  it.each(["disabled", "unavailable"])("hides provider credentials when Module Mode is %s", async (moduleStatus) => {
    mocks.source.mockRejectedValue(new Error("https://rpc.invalid/private-key"));
    if (moduleStatus === "unavailable") mocks.moduleSource.mockRejectedValue(new Error("https://module-rpc.invalid/private-key"));
    const response = await update(new Request("https://website.invalid/api/ops/robinhood-index", {
      headers: { authorization: `Bearer ${"a".repeat(48)}` },
    }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "index_update_unavailable", custom: { status: "unavailable" }, moduleMode: { status: moduleStatus } });
  });
});
