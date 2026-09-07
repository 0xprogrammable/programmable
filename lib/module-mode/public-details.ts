import { isModuleEnginePublicCapabilities, type ModuleEnginePublicDetails } from "../module-engine/public-details";

export interface ModulePublicDetailsBase {
  packageId: string;
  familyId: string;
  title: string;
  description: string;
  version: string;
  author: string;
  category: string;
  manifestHash: string;
}
export type ModulePublicDetails = (ModulePublicDetailsBase & { sourceKind?: never; engine?: never }) | ModuleEnginePublicDetails;

export interface PublicModuleDetails {
  sourceKind?: "module-engine-v1";
  releaseDigest: string;
  items: ModulePublicDetails[];
}

const hash = (value: unknown): value is string => typeof value === "string" && /^0x(?!0{64}$)[\da-f]{64}$/i.test(value);
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;

export function isModulePublicDetails(value: unknown): value is ModulePublicDetails {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (item.sourceKind === undefined ? item.engine === undefined : item.sourceKind === "module-engine-v1" && isModuleEnginePublicCapabilities(item.engine))
    && hash(item.packageId) && hash(item.familyId) && hash(item.manifestHash)
    && text(item.title, 4000) && typeof item.description === "string" && item.description.length <= 4000 && text(item.version, 4000)
    && typeof item.author === "string" && /^0x(?!0{40}$)[\da-f]{40}$/i.test(item.author)
    && typeof item.category === "string" && /^[a-z][a-z0-9-]{0,39}(\/[a-z][a-z0-9-]{0,39}){0,2}$/.test(item.category);
}

export function readPublicModuleDetailsResponse(value: unknown): PublicModuleDetails | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const response = value as Record<string, unknown>;
  if ((response.sourceKind !== undefined && response.sourceKind !== "module-engine-v1")
    || !hash(response.releaseDigest) || !Array.isArray(response.items) || response.items.length > 16
    || !response.items.every(isModulePublicDetails)
    || response.items.some(item => item.sourceKind !== response.sourceKind)
    || new Set(response.items.map(item => item.packageId.toLowerCase())).size !== response.items.length) return null;
  return { ...(response.sourceKind === "module-engine-v1" ? { sourceKind: response.sourceKind } : {}), releaseDigest: response.releaseDigest, items: response.items };
}

export interface ModuleLaunchDetailsBinding {
  sourceKind?: "module-native-v1" | "module-native-v2" | "module-engine-v1";
  sourceReleaseDigest: string;
  modulePackageIds: readonly string[];
  moduleFamilyIds: readonly string[];
}

/** A current module with the same family name is never a substitute for the coin's exact revision. */
export function moduleDetailsForLaunch(launch: ModuleLaunchDetailsBinding, details: PublicModuleDetails | null) {
  const sourceKind = launch.sourceKind === "module-engine-v1" ? "module-engine-v1" : undefined;
  const matchingRelease = [undefined, "module-native-v1", "module-native-v2", "module-engine-v1"].includes(launch.sourceKind)
    && details?.sourceKind === sourceKind && details?.releaseDigest.toLowerCase() === launch.sourceReleaseDigest.toLowerCase();
  return launch.modulePackageIds.map((packageId, index) => ({
    packageId,
    familyId: launch.moduleFamilyIds[index],
    details: matchingRelease ? details!.items.find(item => item.sourceKind === sourceKind && item.packageId.toLowerCase() === packageId.toLowerCase()
      && item.familyId.toLowerCase() === launch.moduleFamilyIds[index]?.toLowerCase()) ?? null : null,
  }));
}
