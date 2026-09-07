import configuredCatalog from "@/config/module-mode/catalog.json";
import { moduleDiscovery } from "@/lib/module-mode/library";
import { bindNativeCatalogEntry, moduleNativeCatalogDigest, type ModuleModeAvailability } from "@/lib/module-mode/native-catalog";
import { moduleAddress } from "@/lib/module-mode/release";
import type { PublicModuleDetails } from "@/lib/module-mode/public-details";
import { bindModuleModeCatalogFile, readModuleModeAvailability } from "./catalog";
import type { ModuleReviewDecisionRecordV1 } from "./review-decision-wire-v1";

/** Only authenticated publications are described. Payout wallets never determine authorship. */
export function resolvePublicModuleDetails(availability: ModuleModeAvailability, catalogFile: unknown): PublicModuleDetails | null {
  if (!availability.release) return null;
  try {
    const publications = bindModuleModeCatalogFile(catalogFile, availability.release).entries;
    const availableByPackage = new Map(availability.catalog.filter(entry => entry.status === "available").map(bindNativeCatalogEntry)
      .map(entry => [entry.nativeBinding.packageId.toLowerCase(), entry]));
    const items = publications.flatMap(({ entry, review }) => {
      const active = availableByPackage.get(entry.nativeBinding.packageId.toLowerCase());
      if (!active || moduleNativeCatalogDigest(active) !== moduleNativeCatalogDigest(entry)) return [];
      const accepted = review as ModuleReviewDecisionRecordV1;
      return [{
        packageId: entry.nativeBinding.packageId,
        familyId: entry.nativeBinding.familyId,
        title: entry.title,
        description: entry.detail.trim() || entry.summary,
        version: entry.version,
        author: moduleAddress(accepted.subject.author, "module.author"),
        category: moduleDiscovery(entry).category,
        manifestHash: entry.nativeBinding.manifestHash,
      }];
    });
    return { releaseDigest: availability.release.releaseDigest, items };
  } catch { return null; }
}

export async function readPublicModuleDetails(): Promise<PublicModuleDetails | null> {
  return resolvePublicModuleDetails(await readModuleModeAvailability(), configuredCatalog);
}
