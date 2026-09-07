import type { RobinhoodModuleLaunch } from "@/lib/robinhood-launches";

export interface ModulePublicDetails {
  packageId: string;
  familyId: string;
  title: string;
  description: string;
  version: string;
  author: string;
  category: string;
  manifestHash: string;
}

export interface PublicModuleDetails {
  releaseDigest: string;
  items: ModulePublicDetails[];
}

const hash = (value: unknown): value is string => typeof value === "string" && /^0x(?!0{64}$)[\da-f]{64}$/i.test(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

export function isModulePublicDetails(value: unknown): value is ModulePublicDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return hash(item.packageId) && hash(item.familyId) && hash(item.manifestHash)
    && text(item.title, 4000) && typeof item.description === "string" && item.description.length <= 4000 && text(item.version, 4000)
    && typeof item.author === "string" && /^0x(?!0{40}$)[\da-f]{40}$/i.test(item.author)
    && typeof item.category === "string" && /^[a-z][a-z0-9-]{0,39}(\/[a-z][a-z0-9-]{0,39}){0,2}$/.test(item.category);
}

export function readPublicModuleDetailsResponse(value: unknown): PublicModuleDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if (!hash(response.releaseDigest) || !Array.isArray(response.items) || response.items.length > 16
    || !response.items.every(isModulePublicDetails)
    || new Set(response.items.map(item => item.packageId.toLowerCase())).size !== response.items.length) return null;
  return { releaseDigest: response.releaseDigest, items: response.items };
}

/** A current module with the same family name is never a substitute for the coin's exact revision. */
export function moduleDetailsForLaunch(launch: Pick<RobinhoodModuleLaunch, "sourceReleaseDigest" | "modulePackageIds" | "moduleFamilyIds">, details: PublicModuleDetails | null) {
  const matchingRelease = details?.releaseDigest.toLowerCase() === launch.sourceReleaseDigest.toLowerCase();
  return launch.modulePackageIds.map((packageId, index) => ({
    packageId,
    familyId: launch.moduleFamilyIds[index],
    details: matchingRelease ? details!.items.find(item => item.packageId.toLowerCase() === packageId.toLowerCase()
      && item.familyId.toLowerCase() === launch.moduleFamilyIds[index].toLowerCase()) ?? null : null,
  }));
}
