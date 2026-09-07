import configuredCatalog from "@/config/module-engine/catalog.json";
import configuredRelease from "@/config/module-engine/robinhood.json";
import historicalReleases from "@/config/module-engine/historical-releases.json";
import { bindActiveModuleEngineRelease, type ModuleEngineAvailability } from "@/lib/module-engine/catalog";
import { moduleEngineCategory, type ModuleEnginePublicDetails } from "@/lib/module-engine/public-details";
import { nativeCanonicalJson, nativeJson } from "@/lib/module-mode/native-catalog";
import { moduleAddress, moduleHash, moduleRecord } from "@/lib/module-mode/release";
import type { PublicModuleDetails } from "@/lib/module-mode/public-details";
import { MODULE_ENGINE_HISTORICAL_RELEASES_SCHEMA, readModuleEngineAvailability } from "./catalog";
import { bindModuleEngineCatalogFile } from "./publication";

/** Same protected catalogue snapshots as availability; selection does not itself grant authority. */
export function configuredPublicModuleEngineCatalog(releaseDigest: string): unknown {
  const digest = moduleHash(releaseDigest, "engineDetails.releaseDigest");
  if (configuredRelease !== null && bindActiveModuleEngineRelease(configuredRelease).releaseDigest === digest) return configuredCatalog;
  const file = moduleRecord(nativeJson(historicalReleases), ["schemaVersion", "releases"], "engineDetails.history");
  if (file.schemaVersion !== MODULE_ENGINE_HISTORICAL_RELEASES_SCHEMA || !Array.isArray(file.releases) || file.releases.length > 32) throw new Error("Invalid Engine history.");
  const matches = file.releases.flatMap(raw => {
    const entry = moduleRecord(raw, ["release", "catalog"], "engineDetails.history.entry");
    return bindActiveModuleEngineRelease(entry.release).releaseDigest === digest ? [entry.catalog] : [];
  });
  if (matches.length > 1) throw new Error("Duplicate Engine history.");
  return matches[0] ?? null;
}

/** Only exact templates already authenticated by availability receive accepted-review authorship. */
export function resolvePublicModuleEngineDetails(availability: ModuleEngineAvailability, catalogFile: unknown): PublicModuleDetails | null {
  if (!availability.release) return null;
  try {
    const publications = bindModuleEngineCatalogFile(catalogFile, availability.release).entries;
    const available = new Map(availability.templates.map(template => [template.manifest.manifest.revision.packageId, template]));
    const items: ModuleEnginePublicDetails[] = publications.flatMap(({ template, review }) => {
      const manifest = template.manifest.manifest, active = available.get(manifest.revision.packageId);
      if (!active || nativeCanonicalJson(active) !== nativeCanonicalJson(template)) return [];
      return [{ sourceKind: "module-engine-v1", packageId: manifest.revision.packageId, familyId: manifest.revision.familyId,
        title: manifest.catalogDefinition.title, description: manifest.catalogDefinition.detail.trim() || manifest.catalogDefinition.summary,
        version: manifest.catalogDefinition.version, author: moduleAddress(review.subject.author, "engine.author"),
        category: moduleEngineCategory(manifest.catalogDefinition.interface), manifestHash: template.manifestHash,
        engine: { interface: manifest.catalogDefinition.interface, operations: manifest.revision.operationPermissions.map(permission => ({
          operationId: permission.operationId, authorization: permission.authorization, inputRoles: permission.inputRoles, outputRoles: permission.outputRoles,
        })) } }];
    });
    return { sourceKind: "module-engine-v1", releaseDigest: availability.release.releaseDigest, items };
  } catch { return null; }
}
export async function readPublicModuleEngineDetails(releaseDigest: string): Promise<PublicModuleDetails | null> {
  try {
    const digest = moduleHash(releaseDigest, "engineDetails.releaseDigest"), availability = await readModuleEngineAvailability(digest);
    if (availability.release?.releaseDigest !== digest) return null;
    return resolvePublicModuleEngineDetails(availability, configuredPublicModuleEngineCatalog(digest));
  } catch { return null; }
}
