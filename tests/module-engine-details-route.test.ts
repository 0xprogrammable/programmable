import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../app/api/module-mode/details/route";
const mocks = vi.hoisted(() => ({ native: vi.fn(), engine: vi.fn() }));
vi.mock("@/lib/server/module-mode/public-details", () => ({ readPublicModuleDetails: mocks.native }));
vi.mock("@/lib/server/module-engine/public-details", () => ({ readPublicModuleEngineDetails: mocks.engine }));
const hash = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const request = (query: string) => new NextRequest(`https://programmable.market/api/module-mode/details?${query}`);
const query = `release=${hash(1)}&packages=${hash(2)}`;
beforeEach(() => { vi.resetAllMocks(); });
describe("exact public source dispatch", () => {
  it("preserves the Native route and requires the Engine discriminator", async () => {
    mocks.native.mockResolvedValue({ releaseDigest: hash(1), items: [] }); mocks.engine.mockResolvedValue({ sourceKind: "module-engine-v1", releaseDigest: hash(1), items: [] });
    expect((await GET(request(query))).status).toBe(200); expect(mocks.native).toHaveBeenCalledExactlyOnceWith(hash(1)); expect(mocks.engine).not.toHaveBeenCalled();
    const response = await GET(request(`${query}&sourceKind=module-engine-v1`));
    expect(await response.json()).toEqual({ sourceKind: "module-engine-v1", releaseDigest: hash(1), items: [] }); expect(mocks.engine).toHaveBeenCalledExactlyOnceWith(hash(1));
  });
  it.each(["sourceKind=unknown", "sourceKind=module-native-v1", "sourceKind=module-engine-v1&sourceKind=module-engine-v1", "url=https://untrusted.invalid", `release=${hash(3)}`])("rejects ambiguous or unsupported query %s", async extra => {
    expect((await GET(request(`${query}&${extra}`))).status).toBe(400); expect(mocks.native).not.toHaveBeenCalled(); expect(mocks.engine).not.toHaveBeenCalled();
  });
  it("returns unavailable without falling back from Engine to Native", async () => {
    mocks.engine.mockResolvedValue(null);
    expect((await GET(request(`${query}&sourceKind=module-engine-v1`))).status).toBe(503); expect(mocks.native).not.toHaveBeenCalled();
  });
});
