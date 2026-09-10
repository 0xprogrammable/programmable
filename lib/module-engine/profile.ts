import { keccak256, toHex, type Address, type Hex } from "viem";
import { MODULE_MODE_ECONOMICS_POLICY_V2 } from "../module-mode/release";

export const MODULE_ENGINE_RELEASE_SCHEMA = "programmable.module-engine.release.v1" as const;
export const MODULE_ENGINE_PROFILE = "programmable.module-engine-solidity@1" as const;
export const MODULE_ENGINE_SOURCE_VERSION = "module-engine-v1" as const;
export const MODULE_ENGINE_SOURCE_ID = keccak256(toHex("programmable.module-engine.evm.v1"));
export const MODULE_ENGINE_ANY_QUOTE_SOURCE_VERSION = "module-engine-any-quote-v1" as const;
// Matches ModuleEngineAnyQuoteHostV1.SOURCE_VERSION, not a presentation label.
export const MODULE_ENGINE_ANY_QUOTE_SOURCE_ID = keccak256(toHex("programmable.module-engine.any-quote.v1"));
export const MODULE_ENGINE_ANY_QUOTE_PROFILE = "robinhood-any-quote.shared-hook.v1" as const;
export const MODULE_ENGINE_ANY_QUOTE_PROFILE_ID = keccak256(toHex(MODULE_ENGINE_ANY_QUOTE_PROFILE));
export const MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID = keccak256(toHex("programmable.any-quote.base-30.creator-0-1000.v1"));
export const MODULE_ENGINE_ANY_QUOTE_CONFIGURATION_SCHEMA_ID = keccak256(toHex("programmable.any-quote.configuration.v1"));
export const MODULE_ENGINE_ANY_QUOTE_PLATFORM_RECIPIENT = "0xd88539d3c4c460136a733a3fd60cf6bf269079da" as Address;
export const MODULE_ENGINE_ANY_QUOTE_PLATFORM_BPS = 30 as const;
export const MODULE_ENGINE_CONTRACTS = ["host", "registry", "tokenFactory", "launchPolicy", "ledger", "poolManager"] as const;
export const MODULE_ENGINE_ANY_QUOTE_CONTRACTS = [...MODULE_ENGINE_CONTRACTS, "sharedHook", "universalRouter", "nativeRouteGuard"] as const;
export type ModuleEngineContractPin = Readonly<{ address: Address; runtimeCodeHash: Hex }>;

export interface ModuleEngineNativeReleaseProfile {
  schemaVersion: typeof MODULE_ENGINE_RELEASE_SCHEMA;
  sourceVersion: typeof MODULE_ENGINE_SOURCE_VERSION;
  engineProfile: typeof MODULE_ENGINE_PROFILE;
  economicsPolicyId: Hex;
  contracts: Record<typeof MODULE_ENGINE_CONTRACTS[number], ModuleEngineContractPin>;
}
export interface ModuleEngineAnyQuoteReleaseProfile {
  schemaVersion: typeof MODULE_ENGINE_RELEASE_SCHEMA;
  sourceVersion: typeof MODULE_ENGINE_ANY_QUOTE_SOURCE_VERSION;
  engineProfile: typeof MODULE_ENGINE_ANY_QUOTE_PROFILE;
  economicsPolicyId: Hex;
  contracts: Record<typeof MODULE_ENGINE_ANY_QUOTE_CONTRACTS[number], ModuleEngineContractPin>;
}
export type ModuleEngineReleaseProfile = ModuleEngineNativeReleaseProfile | ModuleEngineAnyQuoteReleaseProfile;

function matches(value: unknown, sourceVersion: string, engineProfile: string, economicsPolicyId: Hex): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const release = value as Record<string, unknown>;
  return release.schemaVersion === MODULE_ENGINE_RELEASE_SCHEMA && release.sourceVersion === sourceVersion
    && release.engineProfile === engineProfile && release.economicsPolicyId === economicsPolicyId;
}
/** Discriminator only. Release binding separately authenticates every pin, digest and evidence field. */
export function isModuleEngineAnyQuoteRelease(value: unknown): value is ModuleEngineAnyQuoteReleaseProfile {
  return matches(value, MODULE_ENGINE_ANY_QUOTE_SOURCE_VERSION, MODULE_ENGINE_ANY_QUOTE_PROFILE, MODULE_ENGINE_ANY_QUOTE_ECONOMICS_POLICY_ID);
}
export function moduleEngineSourceId(value: unknown): Hex {
  if (isModuleEngineAnyQuoteRelease(value)) return MODULE_ENGINE_ANY_QUOTE_SOURCE_ID;
  if (matches(value, MODULE_ENGINE_SOURCE_VERSION, MODULE_ENGINE_PROFILE, MODULE_MODE_ECONOMICS_POLICY_V2)) return MODULE_ENGINE_SOURCE_ID;
  throw new Error("Module engine: Unsupported source profile or economics policy.");
}
export function moduleEngineContractRoles(value: unknown) {
  moduleEngineSourceId(value);
  return isModuleEngineAnyQuoteRelease(value) ? MODULE_ENGINE_ANY_QUOTE_CONTRACTS : MODULE_ENGINE_CONTRACTS;
}
