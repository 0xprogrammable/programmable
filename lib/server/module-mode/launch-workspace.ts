import type { Hex } from "viem";
import { MODULE_ENGINE_AVAILABILITY_SCHEMA, type ModuleEngineAvailability } from "@/lib/module-engine/catalog";
import { MODULE_MODE_AVAILABILITY_SCHEMA, type ModuleModeAvailability } from "@/lib/module-mode/native-catalog";
import type { ModuleModeReleaseSelection } from "@/lib/module-mode/release-selection";
import type { ModuleLaunchWorkspaceRequests } from "@/lib/module-mode/launch-workspace";
import { readModuleEngineAvailability, readModuleEngineLaunchVersions } from "../module-engine/catalog";
import { readModuleModeAvailability } from "./catalog";
import { readModuleModeLaunchVersions } from "./launch-profiles";

type Readers = {
  native: typeof readModuleModeAvailability;
  engine: typeof readModuleEngineAvailability;
  nativeVersions: typeof readModuleModeLaunchVersions;
  engineVersions: typeof readModuleEngineLaunchVersions;
};

/** Start independent reads without putting historical discovery on the form's critical path. */
export function createModuleLaunchWorkspaceRequests(selection: ModuleModeReleaseSelection, reviewedAnyQuoteDigest: Hex,
  readers: Readers = { native: readModuleModeAvailability, engine: readModuleEngineAvailability,
    nativeVersions: readModuleModeLaunchVersions, engineVersions: readModuleEngineLaunchVersions }): ModuleLaunchWorkspaceRequests {
  const native = (digest?: string) => readers.native(digest).catch((): ModuleModeAvailability => ({
    schemaVersion: MODULE_MODE_AVAILABILITY_SCHEMA, release: null, catalog: [], reason: "Module Mode is temporarily unavailable. Please try again shortly.",
  }));
  const engine = (digest?: string) => readers.engine(digest).catch((): ModuleEngineAvailability => ({
    schemaVersion: MODULE_ENGINE_AVAILABILITY_SCHEMA, release: null, templates: [], reason: "This module is temporarily unavailable. Please try again shortly.",
  }));
  const nativeRequest = native();
  const anyQuoteRequest = engine(reviewedAnyQuoteDigest);
  return {
    native: nativeRequest,
    anyQuote: anyQuoteRequest,
    ...(selection.sourceKind === "module-engine-v1"
      ? { selectedEngine: selection.releaseDigest === reviewedAnyQuoteDigest ? anyQuoteRequest : engine(selection.releaseDigest) }
      : { selectedNative: selection.releaseDigest ? native(selection.releaseDigest) : nativeRequest }),
    versions: Promise.allSettled([readers.nativeVersions(), readers.engineVersions()])
      .then(results => results.flatMap(result => result.status === "fulfilled" ? result.value : [])),
  };
}
