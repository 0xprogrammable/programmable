import type { Hex } from "viem";
import { parseModuleEngineAvailability, type ModuleEngineAvailability } from "@/lib/module-engine/catalog";
import { anyQuoteLibraryEntry } from "@/lib/module-engine/library-entry";
import { isModuleEngineSharedQuoteRelease } from "@/lib/module-engine/profile";
import type { ModuleModeAvailability } from "./native-catalog";
import { moduleModeReleaseQuery, type ModuleModeLaunchVersion, type ModuleModeReleaseSelection } from "./release-selection";

/** Display data only. Every transaction still refreshes its exact source authority. */
export interface ModuleLaunchWorkspaceRequests {
  native: Promise<ModuleModeAvailability>;
  anyQuote: Promise<ModuleEngineAvailability>;
  selectedNative?: Promise<ModuleModeAvailability>;
  selectedEngine?: Promise<ModuleEngineAvailability>;
  versions: Promise<readonly ModuleModeLaunchVersion[]>;
}

/** React Flight supplies thenables whose then() is not a chainable native Promise. */
export function moduleLaunchRequestPromise<T>(request: PromiseLike<T>): Promise<T> {
  return Promise.resolve(request);
}

export function moduleLaunchSelectionKey(selection: ModuleModeReleaseSelection): string {
  return `${selection.sourceKind ?? "native"}:${selection.releaseDigest ?? "current"}`;
}

export function moduleLaunchSelectionPath(selection: ModuleModeReleaseSelection): string {
  return `/launch/modules${moduleModeReleaseQuery(selection)}`;
}

/** A reviewed identity selects a reader; it cannot create an available library entry. */
export function availableAnyQuoteLibraryEntry(value: unknown, reviewedReleaseDigest: Hex) {
  try {
    const { release, templates } = parseModuleEngineAvailability(value);
    const template = templates.find(candidate => candidate.manifest.manifest.catalogDefinition.interface === "quote-shared-v1");
    if (release && isModuleEngineSharedQuoteRelease(release) && release.releaseDigest === reviewedReleaseDigest && template) {
      return { releaseDigest: release.releaseDigest, entry: anyQuoteLibraryEntry(template.manifest.manifest.catalogDefinition) };
    }
  } catch { /* Unavailable or unbound sources never create a launch entry. */ }
  return null;
}
