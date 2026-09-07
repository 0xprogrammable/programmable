import { describe, expect, it } from "vitest";
import { PREVIEW_MODULE_CATALOG } from "../lib/module-mode/builder";
import { bindNativeCatalogEntry, bindNativeFeeEligibility, moduleNativeCatalogDigest, parseModuleModeAvailability } from "../lib/module-mode/native-catalog";
import { computeModuleModeReleaseDigest, MODULE_MODE_ECONOMICS_POLICY_V2 } from "../lib/module-mode/release";
import { moduleEvidenceFixture, a, h } from "./fixtures/module-mode-evidence";

const binding = { familyId: h(101), packageId: h(202), factory: a(303), factoryCodeHash: h(404), moduleCodeHash: h(505), callbackGas: 25000, manifestHash: h(606), reviewDigest: h(707) };
const entry = () => ({ ...PREVIEW_MODULE_CATALOG[0], status: "available" as const, nativeBinding: { ...binding } });
describe("native Module Mode catalogue boundary", () => {
  it("keeps the pending lane closed and requires complete independent registry identifiers", () => {
    expect(parseModuleModeAvailability({ schemaVersion: "programmable.module-mode.availability.v1", release: null, catalog: [], reason: "Pending" }).release).toBeNull();
    expect(() => bindNativeCatalogEntry(PREVIEW_MODULE_CATALOG[0])).toThrow();
    expect(() => bindNativeCatalogEntry({ ...entry(), nativeBinding: { ...binding, packageId: "opening-buy-cap-v1" } })).toThrow();
    expect(() => parseModuleModeAvailability({ schemaVersion: "programmable.module-mode.availability.v1", release: null, catalog: [entry()], reason: null })).toThrow();
  });
  it("binds schema, configuration ABI, management and native admission in the whole-entry digest", () => {
    const original = entry();
    expect(bindNativeCatalogEntry(original)).toEqual(original);
    const digest = moduleNativeCatalogDigest(original);
    expect(moduleNativeCatalogDigest({ ...original, nativeBinding: { ...binding, packageId: h(203) } })).not.toBe(digest);
    expect(moduleNativeCatalogDigest({ ...original, management: { schemaVersion: "example.v1" } })).not.toBe(digest);
    const result = parseModuleModeAvailability({ schemaVersion: "programmable.module-mode.availability.v1", release: moduleEvidenceFixture().release, catalog: [original], reason: null });
    expect(result.catalog).toEqual([original]);
  });
  it("rejects accessors without invoking them, unsafe gas budgets and duplicate catalog entries", () => {
    let called = false;
    expect(() => bindNativeCatalogEntry({ ...entry(), get management() { called = true; return {}; } })).toThrow();
    expect(called).toBe(false);
    expect(() => bindNativeCatalogEntry({ ...entry(), nativeBinding: { ...binding, callbackGas: 1 } })).toThrow();
    expect(() => bindNativeCatalogEntry({ ...entry(), requiresHost: ["unknown.engine@99"] })).toThrow("unsupported host");
    expect(() => parseModuleModeAvailability({ schemaVersion: "programmable.module-mode.availability.v1", release: moduleEvidenceFixture().release, catalog: [entry(), entry()], reason: null })).toThrow();
    expect(() => parseModuleModeAvailability({ schemaVersion: "programmable.module-mode.availability.v1", release: null, catalog: [{ id: "bad-preview", status: "preview" }], reason: "Pending" })).toThrow();
  });
  it("requires complete V2 eligibility snapshots, permits false/zero, and preserves V1 catalog bytes", () => {
    const v1 = moduleEvidenceFixture().release;
    const next = { ...v1, schemaVersion: "programmable.module-mode-source.v2", sourceVersion: "module-native-v2", economicsPolicyId: MODULE_MODE_ECONOMICS_POLICY_V2 };
    const release = { ...next, releaseDigest: computeModuleModeReleaseDigest(next) };
    const wrap = (catalog: unknown[], bound = release) => ({ schemaVersion: "programmable.module-mode.availability.v1", release: bound, catalog, reason: null });
    expect(() => parseModuleModeAvailability(wrap([entry()]))).toThrow("source generation");
    const v2Entry = { ...entry(), nativeBinding: { ...binding, feeEligibility: { eligible: false, reviewDigest: h(0) } } };
    expect(parseModuleModeAvailability(wrap([v2Entry])).catalog).toEqual([v2Entry]);
    expect(bindNativeCatalogEntry(v2Entry)).toEqual(v2Entry);
    expect(moduleNativeCatalogDigest(v2Entry)).not.toBe(moduleNativeCatalogDigest(entry()));
    expect(() => parseModuleModeAvailability({ ...wrap([v2Entry]), release: v1 })).toThrow("source generation");
    expect(() => bindNativeFeeEligibility({ eligible: true, reviewDigest: h(0) })).toThrow("eligibility review");
    expect(() => bindNativeFeeEligibility({ eligible: false, reviewDigest: h(0), reviewer: a(900) })).toThrow("keys");
    const conflicting = { ...v2Entry, id: "other-revision", nativeBinding: { ...v2Entry.nativeBinding, packageId: h(303), feeEligibility: { eligible: true, reviewDigest: h(1) } } };
    expect(() => parseModuleModeAvailability(wrap([v2Entry, conflicting]))).toThrow("Conflicting fee eligibility");
  });
});
