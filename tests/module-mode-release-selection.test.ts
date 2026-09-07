import { describe, expect, it } from "vitest";
import { moduleModeCoinReleaseSelection, moduleModeReleaseQuery, parseModuleModePageSelection, parseModuleModeReleaseSelection } from "@/lib/module-mode/release-selection";
import { bindActiveModuleModeRelease, computeModuleModeReleaseDigest, MODULE_MODE_ECONOMICS_POLICY_V2 } from "@/lib/module-mode/release";
import { normalizeModuleModeLaunches } from "@/lib/module-mode/provenance";
import { moduleModePublicLaunch } from "@/lib/server/robinhood-index/module-source";
import { readModuleModeLaunchVersions } from "@/lib/server/module-mode/launch-profiles";
import { h, moduleEvidenceFixture } from "./fixtures/module-mode-evidence";

describe("exact Module Mode version selection", () => {
  it("roundtrips current, historical and engine selectors without turning undefined into a value", () => {
    expect(moduleModeReleaseQuery({ releaseDigest: undefined })).toBe("");
    for (const selection of [{}, { releaseDigest: h(12) }, { sourceKind: "module-engine-v1" as const, releaseDigest: h(13) }]) {
      expect(parseModuleModeReleaseSelection(new URLSearchParams(moduleModeReleaseQuery(selection)))).toEqual(selection);
    }
    expect(parseModuleModePageSelection({ releaseDigest: h(12), sourceKind: undefined })).toEqual({ releaseDigest: h(12) });
  });
  it("rejects duplicate, substituted and malformed selectors before choosing a reader", () => {
    for (const query of [`releaseDigest=${h(1)}&releaseDigest=${h(1)}`, `releaseDigest=${h(0)}`, "releaseDigest=latest",
      "sourceKind=module-native-v3", "sourceKind=module-engine-v1&sourceKind=module-engine-v1", "sourceUrl=https://example.com"]) {
      expect(() => parseModuleModeReleaseSelection(new URLSearchParams(query))).toThrow();
    }
    expect(() => parseModuleModePageSelection({ releaseDigest: [h(1), h(2)] })).toThrow();
  });
  it("derives old coin management from the canonical saved identity and rejects conflicting URL hints", () => {
    const fixture = moduleEvidenceFixture();
    const release = bindActiveModuleModeRelease(fixture.release);
    const row = moduleModePublicLaunch(normalizeModuleModeLaunches([fixture.evidence], release)[0], "2026-09-07T12:00:00Z");
    expect(moduleModeCoinReleaseSelection({}, row)).toEqual({ releaseDigest: release.releaseDigest });
    expect(moduleModeCoinReleaseSelection({ releaseDigest: release.releaseDigest }, row)).toEqual({ releaseDigest: release.releaseDigest });
    expect(() => moduleModeCoinReleaseSelection({ releaseDigest: h(12) }, row)).toThrow();
    expect(() => moduleModeCoinReleaseSelection({ sourceKind: "module-engine-v1" }, row)).toThrow();
    expect(() => moduleModeCoinReleaseSelection({}, { ...row, sourceKind: undefined })).toThrow();
    expect(moduleModeCoinReleaseSelection({ releaseDigest: h(12) }, null)).toEqual({ releaseDigest: h(12) });
  });
  it("offers both authenticated generations while isolating missing or substituted releases", async () => {
    const v1 = bindActiveModuleModeRelease(moduleEvidenceFixture().release);
    const identity = { ...v1, schemaVersion: "programmable.module-mode-source.v2", sourceVersion: "module-native-v2", economicsPolicyId: MODULE_MODE_ECONOMICS_POLICY_V2 };
    const v2 = bindActiveModuleModeRelease({ ...identity, releaseDigest: computeModuleModeReleaseDigest(identity) });
    const read = async (digest: string) => ({ schemaVersion: "programmable.module-mode.availability.v1" as const,
      release: digest === v1.releaseDigest ? v1 : v2, catalog: [], reason: null });
    const versions = await readModuleModeLaunchVersions({ digests: [v2.releaseDigest, v1.releaseDigest, h(10), v1.releaseDigest], read });
    expect(versions.map(version => version.releaseDigest)).toEqual([v2.releaseDigest, v1.releaseDigest]);
    expect(versions[0].label).toContain("v2"); expect(versions[1].label).toContain("v1");
    const preserved = await readModuleModeLaunchVersions({ digests: [v2.releaseDigest, v1.releaseDigest], read: digest => {
      if (digest === v2.releaseDigest) throw new Error("Current source unavailable");
      return read(digest);
    } });
    expect(preserved.map(version => version.releaseDigest)).toEqual([v1.releaseDigest]);
  });
});
