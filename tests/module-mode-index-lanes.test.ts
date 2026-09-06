import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IndexStore } from "../lib/server/robinhood-index/store";
import { parseSnapshot, type RobinhoodSnapshot } from "../lib/server/robinhood-index/model";
import type { IndexSource, ModuleModeIndexSource } from "../lib/server/robinhood-index/sync";
import { a, h } from "./fixtures/module-mode-evidence";

const mocks = vi.hoisted(() => ({ store: vi.fn(), custom: vi.fn(), module: vi.fn() }));
vi.mock("../lib/server/robinhood-index/store", () => ({ indexStore: mocks.store }));
vi.mock("../lib/server/robinhood-index/source", () => ({ robinhoodSource: mocks.custom }));
vi.mock("../lib/server/robinhood-index/module-source", () => ({ configuredModuleModeSource: mocks.module }));
import { GET } from "../app/api/ops/robinhood-index/route";

const point = (n: number) => ({ number: String(n), hash: h(n) });
function fixture() {
  let saved: RobinhoodSnapshot | null = { version: 1, chainId: 4663, routerAddress: a(900), binding: h(901), startBlock: "50",
    cursor: point(99), checkpoints: [point(99)], finalizedBlock: "99", updatedAt: new Date().toISOString(), items: [] };
  let version = 0;
  const write = vi.fn<IndexStore["write"]>(async (value, etag) => {
    if (etag !== `v${version}`) throw new Error("Concurrent change");
    saved = parseSnapshot(structuredClone(value)); version++;
  });
  const store: IndexStore = { read: async () => saved ? { snapshot: structuredClone(saved), etag: `v${version}` } : null, write };
  const custom: IndexSource = { routerAddress: a(900), binding: h(901), startBlock: 50n, finalized: point(100), block: async n => point(Number(n)), launches: async () => [] };
  const nativeSource: ModuleModeIndexSource = { sourceKind: "module-native-v1", sourceAddress: a(800), releaseDigest: h(801), startBlock: 50n,
    finalized: point(100), block: async n => point(Number(n)), launches: async () => [] };
  mocks.store.mockReturnValue(store); mocks.custom.mockResolvedValue(custom); mocks.module.mockResolvedValue(nativeSource);
  return { read: () => saved, write, remove: () => { saved = null; } };
}
const request = () => new Request("https://programmable.market/api/ops/robinhood-index", { headers: { authorization: `Bearer ${"a".repeat(48)}` } });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("CRON_SECRET", "a".repeat(48)); });
afterEach(() => vi.unstubAllEnvs());

describe("Independent canonical Robinhood index lanes", () => {
  it("lets a genuinely configured Module lane advance while Custom is unavailable and returns 503", async () => {
    const f = fixture(); const original = structuredClone(f.read());
    mocks.custom.mockRejectedValue(new Error("Private Custom provider details"));
    const response = await GET(request()); const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ custom: { status: "unavailable" }, moduleMode: { status: "ready", indexedThrough: "100" } });
    expect(JSON.stringify(body)).not.toContain("Private");
    expect(f.read()?.cursor).toEqual(original?.cursor); expect(f.read()?.items).toEqual(original?.items);
    expect(f.read()?.moduleMode?.cursor).toEqual(point(100)); expect(f.write).toHaveBeenCalledTimes(1);
    // A Cron retry repeats verified overlap and merges idempotently under a new CAS version.
    expect((await GET(request())).status).toBe(503);
    expect(f.read()?.moduleMode?.items).toEqual([]); expect(f.read()?.moduleMode?.cursor).toEqual(point(100));
  });
  it("retains Custom progress when Module release authentication fails", async () => {
    const f = fixture(); mocks.module.mockRejectedValue(new Error("Private collector authentication failed"));
    const response = await GET(request()); const body = await response.json();
    expect(response.status).toBe(503); expect(body).toMatchObject({ custom: { status: "ready" }, moduleMode: { status: "unavailable" } });
    expect(f.read()?.cursor).toEqual(point(100)); expect(f.read()?.moduleMode).toBeUndefined();
  });
  it("never fabricates a missing Custom envelope just to initialize Module Mode", async () => {
    const f = fixture(); f.remove(); mocks.custom.mockRejectedValue(new Error("Custom unavailable"));
    expect((await GET(request())).status).toBe(503); expect(f.write).not.toHaveBeenCalled(); expect(f.read()).toBeNull();
  });
  it("reports the disabled Module lane and rejects unauthenticated or overridden jobs", async () => {
    fixture(); mocks.module.mockResolvedValue(null);
    const response = await GET(request()); expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ custom: { status: "ready" }, moduleMode: { status: "disabled" } });
    mocks.store.mockClear();
    expect((await GET(new Request("https://programmable.market/api/ops/robinhood-index"))).status).toBe(401);
    expect((await GET(new Request("https://programmable.market/api/ops/robinhood-index?source=module", request()))).status).toBe(400);
    expect(mocks.store).not.toHaveBeenCalled();
  });
});
