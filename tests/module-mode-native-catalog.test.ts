import { describe, expect, it } from "vitest";
import { PREVIEW_MODULE_CATALOG } from "../lib/module-mode/builder";
import { bindNativeCatalogEntry, moduleNativeCatalogDigest, parseModuleModeAvailability } from "../lib/module-mode/native-catalog";
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
});
