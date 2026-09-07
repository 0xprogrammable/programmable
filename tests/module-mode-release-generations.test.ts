import { describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";
import { bindActiveModuleModeRelease, computeModuleModeReleaseDigest, MODULE_MODE_ECONOMICS_POLICY_V2 } from "../lib/module-mode/release";
import { h, moduleEvidenceFixture } from "./fixtures/module-mode-evidence";

describe("Native Module Mode release generations", () => {
  it("retains the exact V1 release digest and pins V2 economics in a distinct identity domain", () => {
    const v1 = moduleEvidenceFixture().release;
    expect(bindActiveModuleModeRelease(v1).releaseDigest).toBe(v1.releaseDigest);
    const v2 = { ...v1, sourceVersion: "module-native-v2", schemaVersion: "programmable.module-mode-source.v2",
      economicsPolicyId: MODULE_MODE_ECONOMICS_POLICY_V2 };
    v2.releaseDigest = computeModuleModeReleaseDigest(v2);
    expect(v2.releaseDigest).not.toBe(v1.releaseDigest);
    expect(bindActiveModuleModeRelease(v2)).toEqual(v2);
    expect(MODULE_MODE_ECONOMICS_POLICY_V2).toBe(keccak256(toHex("programmable.module-mode.native-economics.v2")));
    expect(() => bindActiveModuleModeRelease({ ...v2, economicsPolicyId: h(91) })).toThrow();
    const missingPolicy: Partial<typeof v2> = { ...v2 };
    delete missingPolicy.economicsPolicyId;
    expect(() => bindActiveModuleModeRelease(missingPolicy)).toThrow();
    expect(() => bindActiveModuleModeRelease({ ...v1, economicsPolicyId: MODULE_MODE_ECONOMICS_POLICY_V2 })).toThrow();
    expect(() => bindActiveModuleModeRelease({ ...v2, releaseDigest: v1.releaseDigest })).toThrow();
    expect(() => bindActiveModuleModeRelease({ ...v1, sourceVersion: "module-native-v2" })).toThrow();
  });
  it("rejects unimplemented engines and accessors before reading their fields", () => {
    const v1 = moduleEvidenceFixture().release;
    expect(() => computeModuleModeReleaseDigest({ ...v1, sourceVersion: "unknown-engine-v1" })).toThrow();
    let invoked = false;
    const withGetter = { ...v1, get sourceVersion() { invoked = true; return "module-native-v2"; } };
    expect(() => bindActiveModuleModeRelease(withGetter)).toThrow();
    expect(invoked).toBe(false);
  });
});
