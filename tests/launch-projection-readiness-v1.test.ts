import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ setup: vi.fn(), read: vi.fn(), source: vi.fn() }));
vi.mock("@/lib/server/custom-launch/launch-contract-setup-v1", () => ({ readLaunchContractSetupV1: mocks.setup }));
vi.mock("@/lib/server/robinhood-index/launch-projection-source", () => ({ launchProjectionSourceV1: mocks.source }));
vi.mock("@/lib/server/robinhood-index/store", () => ({ indexStore: () => ({ read: mocks.read }) }));
import { GET } from "@/app/api/launch-projection-readiness/route";
import { LAUNCH_PROJECTION_FEED_V1 } from "@/lib/custom-launch/launch-projection-v1";
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe("installed website projection consumer evidence", () => {
  it("binds only installed consumer state to deployment, digest and existing saved lane", async () => {
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40)); vi.stubEnv("VERCEL_URL", "consumer-test.vercel.app");
    mocks.setup.mockResolvedValue({ manifestDigest: `sha256:${"b".repeat(64)}` });
    mocks.read.mockResolvedValue({ snapshot: { launchProjections: { sourceUrl: LAUNCH_PROJECTION_FEED_V1, updatedAt: "2026-09-09T11:00:00.000Z", nextCursor: null, items: [] } } });
    const response = await GET(new Request("https://programmable.market/api/launch-projection-readiness"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ consumerState: "installed", commit: "a".repeat(40), deploymentUrl: "https://consumer-test.vercel.app",
      recognizedSources: ["router_v1", "multi_role_v2", "custom_launch_plan_v1"], adapter: { readState: "ready", indexedLaunches: 0, storage: "existing_robinhood_index" } });
  });
  it("cannot assert installed without deployment identity or canonical source evidence", async () => {
    mocks.setup.mockRejectedValue(new Error("provider secret must stay private"));
    const response = await GET(new Request("https://programmable.market/api/launch-projection-readiness"));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("provider secret");
  });
  it("rejects operator overrides before reading sources", async () => {
    expect((await GET(new Request("https://programmable.market/api/launch-projection-readiness?manifestDigest=override"))).status).toBe(400);
    expect(mocks.setup).not.toHaveBeenCalled(); expect(mocks.source).not.toHaveBeenCalled();
  });
});
