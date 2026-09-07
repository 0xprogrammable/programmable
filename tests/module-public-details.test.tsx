import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ModuleDetailDialog } from "@/components/module-detail-dialog";
import { bindActiveModuleModeRelease } from "@/lib/module-mode/release";
import { bindNativeCatalogEntry, MODULE_MODE_AVAILABILITY_SCHEMA, type ModuleModeAvailability } from "@/lib/module-mode/native-catalog";
import { moduleDetailsForLaunch, readPublicModuleDetailsResponse } from "@/lib/module-mode/public-details";
import { resolvePublicModuleDetails } from "@/lib/server/module-mode/public-details";
import configuredRelease from "@/config/module-mode/robinhood.preview.json";
import configuredCatalog from "@/config/module-mode/catalog.json";

// Exercises the pure join with published fixture bytes; no RPC authentication is claimed by this test.
function availability(): ModuleModeAvailability {
  return { schemaVersion: MODULE_MODE_AVAILABILITY_SCHEMA, release: bindActiveModuleModeRelease(configuredRelease),
    catalog: structuredClone(configuredCatalog.entries.map(publication => bindNativeCatalogEntry(publication.entry))), reason: null };
}

describe("public module details", () => {
  it("takes authorship from the accepted review and retains exact revision identity", () => {
    const result = resolvePublicModuleDetails(availability(), configuredCatalog)!;
    expect(result.items).toHaveLength(configuredCatalog.entries.length);
    for (const item of result.items) {
      const publication = configuredCatalog.entries.find(entry => entry.entry.nativeBinding.packageId === item.packageId)!;
      expect(item.author.toLowerCase()).toBe(publication.review.subject.author.toLowerCase());
      expect(item.manifestHash).toBe(publication.entry.nativeBinding.manifestHash);
      expect(item.version).toBe(publication.entry.version);
      expect(item).not.toHaveProperty("review");
      expect(item).not.toHaveProperty("requestDigest");
    }
    expect(readPublicModuleDetailsResponse(result)).toEqual(result);
  });

  it("does not describe unauthenticated or changed catalogue entries", () => {
    expect(resolvePublicModuleDetails({ ...availability(), release: null }, configuredCatalog)).toBeNull();
    const changed = availability();
    changed.catalog[0].title += " changed";
    const result = resolvePublicModuleDetails(changed, configuredCatalog)!;
    expect(result.items).toHaveLength(configuredCatalog.entries.length - 1);
    expect(result.items.some(item => item.title.endsWith("changed"))).toBe(false);
    expect(resolvePublicModuleDetails(availability(), { ...configuredCatalog, sourceReleaseDigest: `0x${"01".repeat(32)}` })).toBeNull();
  });

  it("keeps missing historical revisions visible without using another family version", () => {
    const result = resolvePublicModuleDetails(availability(), configuredCatalog)!;
    const details = result.items[0];
    const launch = { sourceReleaseDigest: result.releaseDigest, modulePackageIds: [details.packageId], moduleFamilyIds: [details.familyId] };
    expect(moduleDetailsForLaunch(launch, result)[0].details).toEqual(details);
    for (const change of [{ modulePackageIds: [`0x${"02".repeat(32)}`] }, { moduleFamilyIds: [`0x${"03".repeat(32)}`] }, { sourceReleaseDigest: `0x${"04".repeat(32)}` }]) {
      const modules = moduleDetailsForLaunch({ ...launch, ...change }, result);
      expect(modules).toHaveLength(1); expect(modules[0].details).toBeNull();
    }
    expect(moduleDetailsForLaunch({ ...launch, modulePackageIds: [], moduleFamilyIds: [] }, null)).toEqual([]);
  });

  it("renders a compact author/version dialog and a truthful unresolved fallback", () => {
    const details = resolvePublicModuleDetails(availability(), configuredCatalog)!.items[0];
    const known = renderToStaticMarkup(<ModuleDetailDialog module={details} onClose={() => {}} />);
    expect(known).toContain(`account=${details.author}&amp;chain=4663`);
    expect(known).toContain("Close module details"); expect(known).toContain(details.version); expect(known).toContain(details.packageId);
    const unknown = renderToStaticMarkup(<ModuleDetailDialog module={null} packageId={details.packageId} title="Module 1" onClose={() => {}} />);
    expect(unknown).toContain("Details for this module version are unavailable"); expect(unknown).not.toContain("No modules");
    expect(unknown).not.toContain("<dt>Author</dt>");
  });
});
