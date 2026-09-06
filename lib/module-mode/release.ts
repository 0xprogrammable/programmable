import { isAddress, keccak256, toHex, type Address, type Hex } from "viem";

export const MODULE_MODE_SOURCE_VERSION = "module-native-v1" as const;
export const MODULE_MODE_RELEASE_SCHEMA = "programmable.module-mode-source.v1" as const;
export const MODULE_MODE_FINALITY_POLICY = "robinhood-ethereum-finalized-v1" as const;
export const MODULE_MODE_DEPENDENCIES = [
  "launcher", "hook", "runtime", "registry", "poolManager", "tokenFactory", "swapRouter",
  "positionManager", "positionPlanner", "launchPolicy", "positionForwarderFactory", "rewardLedger",
  "runtimeFactory", "budgetVault", "swapRouterFactory",
] as const;
export type ModuleModeDependency = typeof MODULE_MODE_DEPENDENCIES[number];
export type ModuleModeContractPin = Readonly<{ address: Address; runtimeCodeHash: Hex }>;
export type ModuleModeRelease = Readonly<{
  schemaVersion: typeof MODULE_MODE_RELEASE_SCHEMA;
  sourceVersion: typeof MODULE_MODE_SOURCE_VERSION;
  chainId: 4663;
  enabled: true;
  status: "active";
  releaseDigest: Hex;
  sourceCommit: string;
  deploymentEvidenceDigest: Hex;
  sourceVerificationDigest: Hex;
  lifecycleEvidenceDigest: Hex;
  startBlock: string;
  minimumInitialBuyNative: string;
  tokenCreationCodeHash: Hex;
  finalityPolicy: typeof MODULE_MODE_FINALITY_POLICY;
  contracts: Readonly<Record<ModuleModeDependency, ModuleModeContractPin>>;
}>;

export class ModuleModeProvenanceError extends Error {
  constructor(readonly code: string) {
    super(`Module Mode provenance: ${code}`);
    this.name = "ModuleModeProvenanceError";
  }
}
export function rejectModuleEvidence(code: string): never { throw new ModuleModeProvenanceError(code); }

// This boundary accepts serialized evidence, never arbitrary JavaScript objects with accessors.
export function moduleRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) rejectModuleEvidence(`${label}.object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== keys.length || Object.keys(descriptors).some((key) =>
    !keys.includes(key) || !descriptors[key]!.enumerable || !("value" in descriptors[key]!))) rejectModuleEvidence(`${label}.keys`);
  return value as Record<string, unknown>;
}
export function moduleBytes(value: unknown, label: string, maximum = 24_576): Hex {
  if (typeof value !== "string" || value.length > maximum * 2 + 2
    || !/^0x(?:[a-fA-F0-9]{2})*$/u.test(value)) rejectModuleEvidence(`${label}.bytes`);
  return value.toLowerCase() as Hex;
}
export function moduleHash(value: unknown, label: string): Hex {
  const result = moduleBytes(value, label, 32);
  if (result.length !== 66 || BigInt(result) === 0n) rejectModuleEvidence(`${label}.hash`);
  return result;
}
export function moduleAddress(value: unknown, label: string, zero = false): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: false })
    || (!zero && BigInt(value) === 0n)) rejectModuleEvidence(`${label}.address`);
  return value.toLowerCase() as Address;
}
export function moduleUint(value: unknown, label: string, positive = false): string {
  if (typeof value !== "string" || value.length > 78 || !/^(?:0|[1-9][0-9]*)$/u.test(value)
    || BigInt(value) >= 1n << 256n || (positive && value === "0")) rejectModuleEvidence(`${label}.uint`);
  return value;
}
export function moduleInteger(value: unknown, label: string, maximum = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) rejectModuleEvidence(`${label}.integer`);
  return value;
}
export function moduleEqual(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) rejectModuleEvidence(`${label}.mismatch`);
}

function contractPins(value: unknown) {
  const rawPins = moduleRecord(value, MODULE_MODE_DEPENDENCIES, "release.contracts");
  const seen = new Set<string>();
  return Object.freeze(Object.fromEntries(MODULE_MODE_DEPENDENCIES.map((role) => {
    const raw = moduleRecord(rawPins[role], ["address", "runtimeCodeHash"], `release.contracts.${role}`);
    const address = moduleAddress(raw.address, `release.contracts.${role}.address`);
    if (seen.has(address)) rejectModuleEvidence("release.duplicate-address");
    seen.add(address);
    return [role, Object.freeze({ address, runtimeCodeHash: moduleHash(raw.runtimeCodeHash, `release.contracts.${role}.runtimeCodeHash`) })];
  })) as Record<ModuleModeDependency, ModuleModeContractPin>);
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
}

/** Immutable identity only. Activation and lifecycle evidence remain separate, avoiding a proof/hash cycle. */
export function computeModuleModeReleaseDigest(value: unknown): Hex {
  if (!value || typeof value !== "object" || Array.isArray(value)) rejectModuleEvidence("releaseIdentity.object");
  const r = moduleRecord(value, Object.keys(value), "releaseIdentity");
  moduleEqual(r.schemaVersion, MODULE_MODE_RELEASE_SCHEMA, "releaseIdentity.schemaVersion");
  moduleEqual(r.sourceVersion, MODULE_MODE_SOURCE_VERSION, "releaseIdentity.sourceVersion");
  moduleEqual(r.chainId, 4663, "releaseIdentity.chainId");
  moduleEqual(r.finalityPolicy, MODULE_MODE_FINALITY_POLICY, "releaseIdentity.finalityPolicy");
  if (typeof r.sourceCommit !== "string" || !/^[0-9a-f]{40}$/u.test(r.sourceCommit)) rejectModuleEvidence("releaseIdentity.sourceCommit");
  const profile = { schemaVersion: MODULE_MODE_RELEASE_SCHEMA, sourceVersion: MODULE_MODE_SOURCE_VERSION,
    chainId: 4663, sourceCommit: r.sourceCommit, startBlock: moduleUint(r.startBlock, "releaseIdentity.startBlock", true),
    minimumInitialBuyNative: moduleUint(r.minimumInitialBuyNative, "releaseIdentity.minimumInitialBuyNative", true),
    tokenCreationCodeHash: moduleHash(r.tokenCreationCodeHash, "releaseIdentity.tokenCreationCodeHash"),
    finalityPolicy: MODULE_MODE_FINALITY_POLICY, contracts: contractPins(r.contracts) };
  return keccak256(toHex(canonicalJson({ domain: "programmable.module-mode-release-identity.v1", profile })));
}

/** Configuration is not release authorization. The caller must authenticate the approved release artifact. */
export function bindActiveModuleModeRelease(value: unknown): ModuleModeRelease {
  const r = moduleRecord(value, ["schemaVersion", "sourceVersion", "chainId", "enabled", "status",
    "releaseDigest", "sourceCommit", "deploymentEvidenceDigest", "sourceVerificationDigest", "lifecycleEvidenceDigest",
    "startBlock", "minimumInitialBuyNative", "tokenCreationCodeHash", "finalityPolicy", "contracts"], "release");
  moduleEqual(r.schemaVersion, MODULE_MODE_RELEASE_SCHEMA, "release.schemaVersion");
  moduleEqual(r.sourceVersion, MODULE_MODE_SOURCE_VERSION, "release.sourceVersion");
  moduleEqual(r.chainId, 4663, "release.chainId");
  moduleEqual(r.enabled, true, "release.enabled");
  moduleEqual(r.status, "active", "release.status");
  moduleEqual(r.finalityPolicy, MODULE_MODE_FINALITY_POLICY, "release.finalityPolicy");
  if (typeof r.sourceCommit !== "string" || !/^[0-9a-f]{40}$/u.test(r.sourceCommit)) rejectModuleEvidence("release.sourceCommit");
  const contracts = contractPins(r.contracts);
  const releaseDigest = moduleHash(r.releaseDigest, "release.releaseDigest");
  moduleEqual(releaseDigest, computeModuleModeReleaseDigest(r), "release.computedDigest");
  return Object.freeze({ schemaVersion: MODULE_MODE_RELEASE_SCHEMA, sourceVersion: MODULE_MODE_SOURCE_VERSION,
    chainId: 4663, enabled: true, status: "active", finalityPolicy: MODULE_MODE_FINALITY_POLICY,
    releaseDigest, sourceCommit: r.sourceCommit,
    deploymentEvidenceDigest: moduleHash(r.deploymentEvidenceDigest, "release.deploymentEvidenceDigest"),
    sourceVerificationDigest: moduleHash(r.sourceVerificationDigest, "release.sourceVerificationDigest"),
    lifecycleEvidenceDigest: moduleHash(r.lifecycleEvidenceDigest, "release.lifecycleEvidenceDigest"),
    startBlock: moduleUint(r.startBlock, "release.startBlock", true),
    minimumInitialBuyNative: moduleUint(r.minimumInitialBuyNative, "release.minimumInitialBuyNative", true),
    tokenCreationCodeHash: moduleHash(r.tokenCreationCodeHash, "release.tokenCreationCodeHash"),
    contracts: Object.freeze(contracts),
  });
}
