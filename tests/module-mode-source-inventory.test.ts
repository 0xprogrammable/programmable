import { describe, expect, it, vi } from "vitest";
import { bindActiveModuleModeRelease } from "../lib/module-mode/release";
import { configuredModuleModeSources, createModuleModeHttpCollector } from "../lib/server/robinhood-index/module-source";
import { h, moduleEvidenceFixture } from "./fixtures/module-mode-evidence";

function fixture(unavailableSources: unknown[] = []) {
  const release = bindActiveModuleModeRelease(moduleEvidenceFixture().release);
  const request = vi.fn<typeof fetch>(async (url) => {
    const result = String(url).endsWith("/sources") ? { releases: [release], unavailableSources }
      : String(url).endsWith("/release") ? release
      : String(url).endsWith("/boundary") ? { chainId: 4663, sourceReleaseDigest: release.releaseDigest, blockNumber: "100", blockHash: h(400), verificationDigest: h(700) }
      : { chainId: 4663, blockNumber: "100", blockHash: h(400) };
    return Response.json({ schemaVersion: "programmable.module-mode-index.v1", result });
  });
  const collector = createModuleModeHttpCollector({ backendBaseUrl: "https://api.programmable.market",
    websiteToken: "synthetic-service-test-credential-0123456789", fetchBackend: request });
  return { release, request, collector };
}

describe("Installed Module Mode source discovery", () => {
  it("continues exact historical collection when the current launch profile is a disabled preview", async () => {
    const f = fixture();
    const inventory = await configuredModuleModeSources(f.collector, undefined, { enabled: false, status: "preview" });
    expect(inventory.unavailableSources).toEqual([]);
    expect(inventory.lanes).toHaveLength(1);
    expect(await inventory.lanes[0].source()).toMatchObject({ releaseDigest: f.release.releaseDigest, sourceAddress: f.release.contracts.launcher.address });
    expect(f.request.mock.calls[0][1]?.body).toBe("{}");
  });
  it("isolates a malformed current profile and reports it while preserving a healthy historical lane", async () => {
    const f = fixture();
    const inventory = await configuredModuleModeSources(f.collector, undefined, { enabled: true, status: "active" });
    expect(inventory.unavailableSources).toEqual([{ releaseId: "module-mode-current", reasonCode: "MODULE_MODE_RELEASE_UNAVAILABLE" }]);
    expect(await inventory.lanes[0].source()).toMatchObject({ releaseDigest: f.release.releaseDigest });
  });
  it("retains unavailable installation identities even before those generations produced snapshots", async () => {
    const problem = { releaseId: "module-mode-native-v2", reasonCode: "MODULE_MODE_RELEASE_UNAVAILABLE" };
    const f = fixture([problem]);
    const inventory = await configuredModuleModeSources(f.collector, undefined, f.release);
    expect(inventory.lanes.map(lane => lane.releaseDigest)).toEqual([f.release.releaseDigest]);
    expect(inventory.unavailableSources).toEqual([problem]);
  });
  it.each([
    [{ releaseId: "../private/config", reasonCode: "MODULE_MODE_RELEASE_UNAVAILABLE" }],
    [{ releaseId: "module-mode-native-v2", reasonCode: "private provider exception" }],
    [{ releaseId: "module-mode-sources", reasonCode: "MODULE_MODE_RELEASE_UNAVAILABLE" }],
    [{ releaseId: "module-mode-native-v2", reasonCode: "MODULE_MODE_RELEASE_UNAVAILABLE", path: "/private" }],
    [{ releaseId: "module-mode-native-v2", reasonCode: "MODULE_MODE_RELEASE_UNAVAILABLE" }, { releaseId: "module-mode-native-v2", reasonCode: "MODULE_MODE_RELEASE_DISABLED" }],
  ])("rejects malformed or duplicate installation diagnostics", async (...entries) => {
    await expect(fixture(entries).collector.listAuthorizedSources()).rejects.toThrow();
  });
  it("does not accept an empty inventory as proof of complete source coverage", async () => {
    const f = fixture();
    f.request.mockResolvedValue(Response.json({ schemaVersion: "programmable.module-mode-index.v1", result: { releases: [], unavailableSources: [] } }));
    await expect(f.collector.listAuthorizedSources()).rejects.toThrow("inventory is unavailable");
  });
});
