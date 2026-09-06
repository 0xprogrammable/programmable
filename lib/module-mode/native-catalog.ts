import { sha256, toHex, type Address, type Hex } from "viem";
import { assertOpenConfigSchema } from "@/packages/classic-modules/src/open-config.mjs";
import { assertOpenConstraints } from "@/packages/classic-modules/src/open-constraints.mjs";
import { NATIVE_ENGINE_PROFILE, type ModuleModeCatalogEntry } from "./builder";
import { bindActiveModuleModeRelease, moduleAddress, moduleHash, moduleInteger, moduleRecord, type ModuleModeRelease } from "./release";

export type { ModuleModeRelease } from "./release";
export const MODULE_MODE_AVAILABILITY_SCHEMA = "programmable.module-mode.availability.v1" as const;
export const MODULE_NATIVE_HOST_CAPABILITIES = [
  "programmable.module-native-runtime@1", "programmable.module-native-budget@1",
  "programmable.module-config-abi@1", "programmable.module-management@1",
] as const;
export interface ModuleModeNativeBinding {
  familyId: Hex; packageId: Hex; factory: Address; factoryCodeHash: Hex; moduleCodeHash: Hex;
  callbackGas: number; manifestHash: Hex; reviewDigest: Hex;
}
export type NativeModuleModeCatalogEntry = ModuleModeCatalogEntry & {
  status: "available"; nativeBinding: ModuleModeNativeBinding; management?: unknown; requiresHost?: string[];
};
export interface ModuleModeAvailability {
  schemaVersion: typeof MODULE_MODE_AVAILABILITY_SCHEMA;
  release: ModuleModeRelease | null;
  catalog: ModuleModeCatalogEntry[];
  reason: string | null;
}

/** Accept inert, bounded JSON only. This is a DTO boundary, not a sandbox for arbitrary JS proxies. */
export function nativeJson(value: unknown, depth = 0, budget = { nodes: 0 }): unknown {
  if (++budget.nodes > 100_000 || depth > 40) throw new Error("Module data exceeds the JSON limit.");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 262_144) throw new Error("Module text exceeds the JSON limit.");
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  if (!value || typeof value !== "object" || ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Module data must be plain JSON.");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).some(key => typeof key !== "string") || Object.keys(descriptors).some(key => !("value" in descriptors[key]) || (!descriptors[key].enumerable && key !== "length"))) throw new Error("Module data must not contain accessors.");
  if (Array.isArray(value)) {
    if (value.length > 2048 || Object.keys(value).length !== value.length || Reflect.ownKeys(value).length !== value.length + 1
      || Array.from({ length: value.length }, (_, index) => descriptors[String(index)]).some(item => !item || !("value" in item))) throw new Error("Invalid module array.");
    return value.map(item => nativeJson(item, depth + 1, budget));
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, nativeJson(item, depth + 1, budget)]));
}
export function nativeCanonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(nativeCanonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${nativeCanonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function moduleNativeCatalogDigest<T extends ModuleModeCatalogEntry>(entry: T): Hex {
  return sha256(toHex(nativeCanonicalJson(nativeJson(entry))));
}
function validateCatalogBase(entry: ModuleModeCatalogEntry) {
  if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !/^[a-z][a-z0-9_.-]{1,127}$/.test(entry.id)
    || !entry.engine || typeof entry.engine.id !== "string" || !Number.isSafeInteger(entry.engine.version) || entry.engine.version < 1
    || typeof entry.engine.label !== "string" || !Object.hasOwn(entry, "defaults")
    || [entry.title, entry.summary, entry.detail, entry.version].some(text => typeof text !== "string" || text.length > 4000)
    || !entry.title || !entry.version || !entry.source || typeof entry.source.path !== "string" || !entry.source.path
    || typeof entry.source.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.source.sha256)) throw new Error("Invalid module catalog entry.");
  assertOpenConfigSchema(entry.schema); assertOpenConstraints(entry.constraints ?? []);
  if (entry.fields) {
    if (typeof entry.fields !== "object" || Array.isArray(entry.fields)) throw new Error("Invalid module display fields.");
    for (const field of Object.values(entry.fields)) {
      if (!field || typeof field !== "object" || Array.isArray(field)
        || (field.decimals !== undefined && (!Number.isSafeInteger(field.decimals) || field.decimals < 0 || field.decimals > 77))
        || (field.input !== undefined && field.input !== "duration" && field.input !== "datetime-utc")
        || [field.suffix, field.placeholder, field.multiplier].some(value => value !== undefined && typeof value !== "string")) throw new Error("Invalid module display field.");
    }
  }
}
export function bindNativeCatalogEntry(value: unknown): NativeModuleModeCatalogEntry {
  const entry = nativeJson(value) as NativeModuleModeCatalogEntry;
  validateCatalogBase(entry);
  if (entry.requiresHost && (!Array.isArray(entry.requiresHost) || entry.requiresHost.length > 64
    || entry.requiresHost.some(capability => !(MODULE_NATIVE_HOST_CAPABILITIES as readonly string[]).includes(capability)))) throw new Error("This module requires an unsupported host capability.");
  if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || !/^[a-z][a-z0-9_.-]{1,127}$/.test(entry.id)
    || entry.status !== "available" || entry.engine?.id !== NATIVE_ENGINE_PROFILE.id || entry.engine?.version !== 1
    || typeof entry.version !== "string" || !entry.version || typeof entry.title !== "string" || !entry.title
    || !entry.source || typeof entry.source.path !== "string" || !entry.source.path || !/^[a-f0-9]{64}$/.test(entry.source.sha256)) throw new Error("This module has no verified native catalog binding.");
  assertOpenConfigSchema(entry.schema);
  assertOpenConstraints(entry.constraints ?? []);
  if (entry.legacyUint256Order) throw new Error("A native module cannot use a legacy configuration codec.");
  if (entry.programAbi && (!Array.isArray(entry.programAbi) || entry.programAbi.length > 128 || entry.programAbi.some(arg => !Array.isArray(arg.path) || arg.path.length > 16 || arg.path.some(key => typeof key !== "string") || typeof arg.type !== "string" || arg.type.length > 128))) throw new Error("Invalid native program ABI.");
  const raw = moduleRecord(entry.nativeBinding, ["familyId", "packageId", "factory", "factoryCodeHash", "moduleCodeHash", "callbackGas", "manifestHash", "reviewDigest"], "nativeBinding");
  const nativeBinding: ModuleModeNativeBinding = {
    familyId: moduleHash(raw.familyId, "nativeBinding.familyId"), packageId: moduleHash(raw.packageId, "nativeBinding.packageId"),
    factory: moduleAddress(raw.factory, "nativeBinding.factory"), factoryCodeHash: moduleHash(raw.factoryCodeHash, "nativeBinding.factoryCodeHash"),
    moduleCodeHash: moduleHash(raw.moduleCodeHash, "nativeBinding.moduleCodeHash"), callbackGas: moduleInteger(raw.callbackGas, "nativeBinding.callbackGas", 500_000),
    manifestHash: moduleHash(raw.manifestHash, "nativeBinding.manifestHash"), reviewDigest: moduleHash(raw.reviewDigest, "nativeBinding.reviewDigest"),
  };
  if (nativeBinding.callbackGas < 25_000) throw new Error("Invalid native callback gas budget.");
  // Preserve original JSON bytes/casing for the already published whole-entry digest.
  return entry;
}
export function parseModuleModeAvailability(value: unknown): ModuleModeAvailability {
  const raw = moduleRecord(nativeJson(value), ["schemaVersion", "release", "catalog", "reason"], "availability");
  if (raw.schemaVersion !== MODULE_MODE_AVAILABILITY_SCHEMA || !Array.isArray(raw.catalog) || raw.catalog.length > 1000
    || (raw.reason !== null && (typeof raw.reason !== "string" || raw.reason.length > 2000))) throw new Error("Invalid Module Mode availability.");
  const release = raw.release === null ? null : bindActiveModuleModeRelease(raw.release);
  const catalog = raw.catalog.map(entry => {
    if ((entry as ModuleModeCatalogEntry)?.status === "available") {
      if (!release) throw new Error("An available module requires an active release.");
      return bindNativeCatalogEntry(entry);
    }
    if ((entry as ModuleModeCatalogEntry)?.status !== "preview") throw new Error("Invalid module catalog state.");
    validateCatalogBase(entry as ModuleModeCatalogEntry);
    return entry as ModuleModeCatalogEntry;
  });
  if (new Set(catalog.map(entry => entry.id)).size !== catalog.length) throw new Error("Duplicate module catalog IDs.");
  return { schemaVersion: MODULE_MODE_AVAILABILITY_SCHEMA, release, catalog, reason: raw.reason as string | null };
}
