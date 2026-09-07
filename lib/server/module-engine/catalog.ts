import { keccak256, toHex, type Hex } from "viem";
import configuredCatalog from "@/config/module-engine/catalog.json";
import configuredRelease from "@/config/module-engine/robinhood.json";
import historicalReleases from "@/config/module-engine/historical-releases.json";
import { bindActiveModuleEngineRelease, MODULE_ENGINE_AVAILABILITY_SCHEMA, parseModuleEngineAvailability, type ModuleEngineAvailability, type ModuleEngineRelease } from "@/lib/module-engine/catalog";
import { nativeJson } from "@/lib/module-mode/native-catalog";
import { moduleHash, moduleRecord } from "@/lib/module-mode/release";
import { canonicalizeJson } from "../projection-target/canonical-json";
import { createModuleModeHttpCollector } from "../robinhood-index/module-source";
import { MODULE_MODE_AVAILABILITY_BUDGET_MS, MODULE_MODE_AVAILABILITY_TTL_MS, MODULE_MODE_PUBLICATION_TTL_MS, MODULE_MODE_UNAVAILABLE_TTL_MS, readPublication } from "../module-mode/catalog";
import { bindModuleEngineCatalogFile, verifyModuleEnginePublication } from "./publication";

export const MODULE_ENGINE_HISTORICAL_RELEASES_SCHEMA = "programmable.module-engine.historical-releases.v1" as const;
const PREPARING = "Engine modules are being prepared.";
const UNAVAILABLE = "Engine modules are temporarily unavailable. Please try again shortly.";
const UNKNOWN_RELEASE = "This Engine release is not available.";
export interface ModuleEngineAvailabilityDependencies {
  releaseProfile: unknown;
  catalogFile: unknown;
  collector: (signal: AbortSignal) => { authenticateRelease(release: ModuleEngineRelease): Promise<void> };
  fetchPublic: typeof fetch;
  now?: () => number;
  budgetMs?: number;
}
type SharedDependencies = Pick<ModuleEngineAvailabilityDependencies, "collector" | "fetchPublic" | "now" | "budgetMs">;
function unavailable(reason: string): ModuleEngineAvailability {
  return { schemaVersion: MODULE_ENGINE_AVAILABILITY_SCHEMA, release: null, templates: [], reason };
}

/** Reuses the native authority service and bounded public reader; never contacts a caller-selected URL. */
export function createModuleEngineAvailabilityReader(dependencies: ModuleEngineAvailabilityDependencies): () => Promise<ModuleEngineAvailability> {
  const now = dependencies.now ?? Date.now, verifiedPublications = new Map<string, number>();
  let cached: { until: number; value: ModuleEngineAvailability } | undefined;
  let pending: Promise<ModuleEngineAvailability> | undefined;
  const read = async (): Promise<ModuleEngineAvailability> => {
    if (dependencies.releaseProfile === null) return unavailable(PREPARING);
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => { timeout = setTimeout(() => {
      controller.abort(); reject(new Error("Engine availability request expired."));
    }, dependencies.budgetMs ?? MODULE_MODE_AVAILABILITY_BUDGET_MS); });
    try {
      return await Promise.race([(async () => {
        const release = bindActiveModuleEngineRelease(dependencies.releaseProfile);
        const catalog = bindModuleEngineCatalogFile(dependencies.catalogFile, release);
        // Re-authentication precedes every new availability sample, including publication-cache hits.
        await dependencies.collector(controller.signal).authenticateRelease(release);
        controller.signal.throwIfAborted();
        const budget = { bytes: 0 }; let next = 0;
        await Promise.all(Array.from({ length: Math.min(2, catalog.entries.length) }, async () => {
          for (;;) {
            controller.signal.throwIfAborted();
            const publication = catalog.entries[next++]; if (!publication) return;
            const key = keccak256(toHex(canonicalizeJson({ release, publication })));
            if ((verifiedPublications.get(key) ?? 0) > now()) continue;
            const request = { packageId: publication.template.manifest.manifest.revision.packageId,
              fetchPublic: dependencies.fetchPublic, signal: controller.signal, budget };
            const source = await readPublication({ ...request, kind: "source" });
            const [manifest, review] = await Promise.all([readPublication({ ...request, kind: "manifest" }), readPublication({ ...request, kind: "review" })]);
            controller.signal.throwIfAborted();
            verifyModuleEnginePublication({ release, publication, source, manifest, review });
            verifiedPublications.set(key, now() + MODULE_MODE_PUBLICATION_TTL_MS);
          }
        }));
        // Runtime revision.enabled is intentionally not sampled here: historical management stays bound
        // to its immutable publication. The existing transaction client revalidates current permissions.
        return parseModuleEngineAvailability({ schemaVersion: MODULE_ENGINE_AVAILABILITY_SCHEMA,
          release, templates: catalog.entries.map(publication => publication.template), reason: null });
      })(), expired]);
    } catch { return unavailable(UNAVAILABLE); }
    finally { if (timeout) clearTimeout(timeout); controller.abort(); }
  };
  return async () => {
    if (cached && cached.until > now()) return structuredClone(cached.value);
    pending ??= read().then(value => {
      cached = { value, until: now() + (value.release ? MODULE_MODE_AVAILABILITY_TTL_MS : MODULE_MODE_UNAVAILABLE_TTL_MS) };
      return value;
    }).finally(() => { pending = undefined; });
    return structuredClone(await pending);
  };
}

function historicalEntries(value: unknown): Array<{ release: unknown; catalog: unknown }> {
  const file = moduleRecord(nativeJson(value), ["schemaVersion", "releases"], "engineHistory");
  if (file.schemaVersion !== MODULE_ENGINE_HISTORICAL_RELEASES_SCHEMA || !Array.isArray(file.releases) || file.releases.length > 32) throw new Error("Invalid historical Engine releases.");
  const seen = new Set<string>();
  return file.releases.map(raw => {
    const entry = moduleRecord(raw, ["release", "catalog"], "engineHistory.entry");
    const release = bindActiveModuleEngineRelease(entry.release);
    if (seen.has(release.releaseDigest)) throw new Error("Duplicate historical Engine release.");
    seen.add(release.releaseDigest);
    return { release, catalog: entry.catalog };
  });
}
/** Exact historical generations use the same activation, review and byte checks as the current source. */
export function createModuleEngineHistoricalAvailabilityReader(input: { historical: unknown; dependencies: SharedDependencies }): (digest: string) => Promise<ModuleEngineAvailability> {
  const readers = new Map(historicalEntries(input.historical).map(entry => {
    const release = bindActiveModuleEngineRelease(entry.release);
    return [release.releaseDigest, createModuleEngineAvailabilityReader({ ...input.dependencies, releaseProfile: release, catalogFile: entry.catalog })] as const;
  }));
  return async digest => readers.get(moduleHash(digest, "engineHistory.requestedDigest"))?.() ?? unavailable(UNKNOWN_RELEASE);
}

const sharedDependencies: SharedDependencies = {
  collector: signal => createModuleModeHttpCollector({ backendBaseUrl: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL ?? "",
    websiteToken: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_WEBSITE_TOKEN ?? "", fetchBackend: fetch, signal }),
  fetchPublic: (...args) => fetch(...args),
};
const currentReader = createModuleEngineAvailabilityReader({ ...sharedDependencies, releaseProfile: configuredRelease, catalogFile: configuredCatalog });
let historicalReader: ReturnType<typeof createModuleEngineHistoricalAvailabilityReader> | undefined;

/** Discovery only. Null is the committed disabled source; no fabricated release identity is needed. */
export function configuredModuleEngineReleaseDigests(): readonly Hex[] {
  const candidates = [...(configuredRelease === null ? [] : [bindActiveModuleEngineRelease(configuredRelease)]),
    ...historicalEntries(historicalReleases).map(entry => bindActiveModuleEngineRelease(entry.release))];
  return Object.freeze([...new Set(candidates.map(release => release.releaseDigest))]);
}
export async function readModuleEngineAvailability(releaseDigest?: string): Promise<ModuleEngineAvailability> {
  if (releaseDigest === undefined) return currentReader();
  try {
    const digest = moduleHash(releaseDigest, "engineAvailability.releaseDigest");
    if (configuredRelease !== null && bindActiveModuleEngineRelease(configuredRelease).releaseDigest === digest) return currentReader();
    historicalReader ??= createModuleEngineHistoricalAvailabilityReader({ historical: historicalReleases, dependencies: sharedDependencies });
    return historicalReader(digest);
  } catch { return unavailable(UNAVAILABLE); }
}

export interface ModuleEngineLaunchVersion { releaseDigest: Hex; label: string; sourceKind: "module-engine-v1" }
/** An unavailable historical source does not suppress a separately authenticated healthy generation. */
export async function readModuleEngineLaunchVersions(input: { digests: readonly string[]; read: (digest: string) => Promise<ModuleEngineAvailability> }
  = { digests: configuredModuleEngineReleaseDigests(), read: readModuleEngineAvailability }): Promise<ModuleEngineLaunchVersion[]> {
  const digests = [...new Set(input.digests.map(digest => moduleHash(digest, "engineLaunchVersions.digest")))];
  if (digests.length > 33) throw new Error("Invalid Engine launch version inventory.");
  const results = await Promise.allSettled(digests.map(digest => input.read(digest)));
  return results.flatMap((result, index) => {
    if (result.status !== "fulfilled") return [];
    try {
      const availability = parseModuleEngineAvailability(result.value), release = availability.release;
      return release?.releaseDigest === digests[index] ? [{ sourceKind: "module-engine-v1" as const,
        releaseDigest: release.releaseDigest, label: `Engine v1 · ${release.releaseDigest.slice(2, 10)}` }] : [];
    } catch { return []; }
  });
}
