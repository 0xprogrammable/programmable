import type { OpenConfigSchema } from "@/packages/classic-modules/src/open-config.mjs";
import { nativeCanonicalJson } from "@/lib/module-mode/native-catalog";
import type { ModuleEngineCatalogDefinition, ModuleEngineRevisionDefinition } from "./catalog";
import { isModuleEngineSharedQuoteRelease, MODULE_ENGINE_ANY_QUOTE_CONFIGURATION_SCHEMA_ID,
  type ModuleEngineSharedQuoteReleaseProfile } from "./profile";

export const ANY_QUOTE_CONFIGURATION_ABI = [
  { path: ["schemaId"], type: "bytes32" },
  { path: ["poolManager"], type: "address" },
  { path: ["poolManagerCodeHash"], type: "bytes32" },
  { path: ["sharedHook"], type: "address" },
  { path: ["quoteAsset"], type: "address" },
  { path: ["initialTick"], type: "int24" },
  { path: ["validUntil"], type: "uint64" },
  { path: ["priceEvidenceHash"], type: "bytes32" },
] as const;

/** Infrastructure is source-bound; the exact quote, tick and price evidence are chosen for each signed launch. */
export function createAnyQuoteConfigurationSchema(release: ModuleEngineSharedQuoteReleaseProfile): OpenConfigSchema {
  return { type: "record", fields: {
    schemaId: { type: "bytes", maxLength: 32, binding: { mode: "fixed", value: MODULE_ENGINE_ANY_QUOTE_CONFIGURATION_SCHEMA_ID } },
    poolManager: { type: "address", binding: { mode: "fixed", value: release.contracts.poolManager.address } },
    poolManagerCodeHash: { type: "bytes", maxLength: 32, binding: { mode: "fixed", value: release.contracts.poolManager.runtimeCodeHash } },
    sharedHook: { type: "address", binding: { mode: "fixed", value: release.contracts.sharedHook.address } },
    quoteAsset: { type: "address", binding: { mode: "input" } },
    initialTick: { type: "string", maxLength: 8, binding: { mode: "input" } },
    validUntil: { type: "uint", bits: 64, min: "1", binding: { mode: "input" } },
    priceEvidenceHash: { type: "bytes", maxLength: 32, binding: { mode: "input" } },
  }, required: ANY_QUOTE_CONFIGURATION_ABI.map(argument => argument.path[0]) };
}

export function validateAnyQuoteManifestProfile(release: unknown, definition: ModuleEngineCatalogDefinition, revision: ModuleEngineRevisionDefinition): void {
  const shared = isModuleEngineSharedQuoteRelease(release);
  if (shared !== (definition.interface === "quote-shared-v1")) throw new Error("Shared quote presentation requires its authenticated source profile.");
  if (!shared) return;
  const zeroAddress = `0x${"00".repeat(20)}`, zeroHash = `0x${"00".repeat(32)}`;
  if (revision.fixedQuoteAsset !== zeroAddress || revision.fixedConfigurationHash !== zeroHash)
    throw new Error("Any Quote must preserve per-launch quote and configuration selection.");
  if (nativeCanonicalJson(definition.configurationAbi) !== nativeCanonicalJson(ANY_QUOTE_CONFIGURATION_ABI)
    || nativeCanonicalJson(definition.schema) !== nativeCanonicalJson(createAnyQuoteConfigurationSchema(release)))
    throw new Error("Any Quote configuration schema or infrastructure differs from the reviewed source.");
}
