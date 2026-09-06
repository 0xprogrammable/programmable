import { keccak256, toHex, type Hex } from "viem";
import configuredCatalog from "@/config/module-mode/catalog.json";
import configuredRelease from "@/config/module-mode/robinhood.preview.json";
import { PREVIEW_MODULE_CATALOG, type ModuleModeCatalogEntry } from "@/lib/module-mode/builder";
import { bindModuleManagementManifest, unsupportedManagementCapabilities, type ModuleManagementManifestV1 } from "@/lib/module-mode/management-manifest";
import {
  bindNativeCatalogEntry, MODULE_MODE_AVAILABILITY_SCHEMA, moduleNativeCatalogDigest,
  nativeJson, parseModuleModeAvailability, type ModuleModeAvailability,
  type ModuleModeNativeBinding, type NativeModuleModeCatalogEntry,
} from "@/lib/module-mode/native-catalog";
import { bindActiveModuleModeRelease, computeModuleModeReleaseDigest, moduleAddress, moduleHash, moduleInteger, moduleRecord, type ModuleModeRelease } from "@/lib/module-mode/release";
import { validateModuleSubmissionRequest, MODULE_TRANSPORT_LIMITS, type ModuleSubmissionRequest } from "@/packages/classic-modules/src/open-transport.mjs";
import { validateOpenPackage, type OpenSourcePackage } from "@/packages/classic-modules/src/open-packages.mjs";
import { canonicalizeJson, parseStrictJson } from "../projection-target/canonical-json";
import { createModuleModeHttpCollector, type ModuleModeFinalizedCollector } from "../robinhood-index/module-source";
import { validateModuleReviewDecisionRecordV1, type ModuleReviewDecisionRecordV1 } from "./review-decision-wire-v1";

export const MODULE_MODE_CATALOG_SCHEMA = "programmable.module-mode.catalog.v1" as const;
export const MODULE_MODE_HOST_MANIFEST_DOMAIN = "programmable.module-mode.host-manifest.v1" as const;
export const MODULE_MODE_PUBLICATION_ORIGIN = "https://programmable.market";
export const MODULE_MODE_AVAILABILITY_BUDGET_MS = 8_000;
export const MODULE_MODE_AVAILABILITY_TTL_MS = 10_000;
export const MODULE_MODE_UNAVAILABLE_TTL_MS = 2_000;
export const MODULE_MODE_PUBLICATION_TTL_MS = 5 * 60_000;
const PUBLICATION_BATCH_BYTES = 64 * 1024 * 1024;
const PUBLICATION_MAXIMUM = { source: MODULE_TRANSPORT_LIMITS.requestBytes, manifest: 2 * 1024 * 1024, review: 64 * 1024 } as const;
const PREPARING = "Module Mode launches are being prepared. You can explore the module previews.";
const UNAVAILABLE = "Module Mode is temporarily unavailable. Please try again shortly.";

export type ModuleModeCatalogDefinition = Omit<NativeModuleModeCatalogEntry, "status" | "nativeBinding"> & { requiresHost: string[] };
export type ModuleModeHostReleaseIdentity = Pick<ModuleModeRelease, "schemaVersion" | "sourceVersion" | "chainId" | "sourceCommit" |
  "startBlock" | "minimumInitialBuyNative" | "tokenCreationCodeHash" | "finalityPolicy" | "contracts" | "releaseDigest">;
export type ModuleModeHostRuntimeBinding = Omit<ModuleModeNativeBinding, "manifestHash" | "reviewDigest"> & {
  sourceReleaseDigest: Hex;
  registry: ModuleModeRelease["contracts"]["registry"];
  engine: Pick<ModuleModeCatalogEntry["engine"], "id" | "version">;
};
export interface ModuleModeHostManifest {
  domain: typeof MODULE_MODE_HOST_MANIFEST_DOMAIN;
  manifest: {
    sourcePackageId: Hex;
    configuration: { schema: ModuleModeCatalogEntry["schema"]; abiMapping: NonNullable<ModuleModeCatalogEntry["programAbi"]> };
    management: ModuleManagementManifestV1;
    requiresHost: string[];
    runtimeBinding: ModuleModeHostRuntimeBinding;
    catalogDefinition: ModuleModeCatalogDefinition;
  };
}
export interface ModuleModeCatalogPublication {
  entry: NativeModuleModeCatalogEntry;
  requestDigest: Hex;
  /** Exact historical private DB decision, copied by the authorized publication operator. */
  review: unknown;
}
export interface ModuleModeCatalogFile {
  schemaVersion: typeof MODULE_MODE_CATALOG_SCHEMA;
  sourceReleaseDigest: Hex | null;
  entries: ModuleModeCatalogPublication[];
}
type PublicationKind = keyof typeof PUBLICATION_MAXIMUM;
type ReleaseAuthenticator = Pick<ModuleModeFinalizedCollector, "authenticateRelease">;

function same(actual: unknown, expected: unknown, label: string): void {
  if (canonicalizeJson(actual) !== canonicalizeJson(expected)) throw new Error(`Module publication ${label} differs.`);
}
function reviewRecord(value: unknown): ModuleReviewDecisionRecordV1 {
  const inert = nativeJson(value);
  if (!validateModuleReviewDecisionRecordV1(inert)) throw new Error("Module review decision is invalid.");
  return inert;
}
function definitionOf(entry: NativeModuleModeCatalogEntry): ModuleModeCatalogDefinition {
  return Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "status" && key !== "nativeBinding")) as ModuleModeCatalogDefinition;
}

/**
 * This is the sole host-manifest identity formula. Hash the UTF-8 canonical JSON of the whole envelope:
 * keccak256({domain:"programmable.module-mode.host-manifest.v1",manifest:{...}}).
 * No manifestHash or reviewDigest is included in runtimeBinding, avoiding self-referential review hashes.
 * All UI interpretation data remains in catalogDefinition and is therefore reviewed with the runtime.
 */
export function computeModuleModeHostManifestHash(value: ModuleModeHostManifest): Hex {
  const envelope = moduleRecord(nativeJson(value), ["domain", "manifest"], "hostManifest");
  if (envelope.domain !== MODULE_MODE_HOST_MANIFEST_DOMAIN) throw new Error("Unsupported module host manifest.");
  moduleRecord(envelope.manifest, ["sourcePackageId", "configuration", "management", "requiresHost", "runtimeBinding", "catalogDefinition"], "hostManifest.manifest");
  return keccak256(toHex(canonicalizeJson(envelope)));
}

/** Publication tooling supplies the final package and deployment pins; this function grants no approval. */
export function createModuleModeHostManifest(input: {
  release: ModuleModeHostReleaseIdentity; definition: ModuleModeCatalogDefinition;
  nativeBinding: Omit<ModuleModeNativeBinding, "manifestHash" | "reviewDigest">; descriptor: OpenSourcePackage;
}): ModuleModeHostManifest {
  // Construction precedes review and activation; it must never need invented review/evidence digests.
  const release = input.release;
  if (moduleHash(release.releaseDigest, "host.releaseDigest") !== computeModuleModeReleaseDigest(release)) throw new Error("Host release identity differs.");
  const entry = nativeJson(input.definition) as ModuleModeCatalogDefinition;
  if (Object.hasOwn(entry, "status") || Object.hasOwn(entry, "nativeBinding")) throw new Error("Host definition includes cyclic publication fields.");
  const checked = validateOpenPackage(input.descriptor);
  if (!checked.ok) throw new Error("Module source descriptor is invalid.");
  const binding = moduleRecord(input.nativeBinding, ["familyId", "packageId", "factory", "factoryCodeHash", "moduleCodeHash", "callbackGas"], "host.nativeBinding");
  if (checked.packageId !== moduleHash(binding.packageId, "catalog.packageId")
    || checked.familyId !== moduleHash(binding.familyId, "catalog.familyId")) throw new Error("Module source identity differs.");
  if (entry.version !== checked.descriptor.version || !entry.programAbi || !entry.engine) throw new Error("Module configuration ABI or version is missing.");
  const callbackGas = moduleInteger(binding.callbackGas, "host.callbackGas", 500_000);
  if (callbackGas < 25_000) throw new Error("Module callback budget is invalid.");
  if (!checked.descriptor.source.files.some(file => file.path === entry.source.path && file.sha256 === entry.source.sha256)
    || !checked.descriptor.components.some(component => component.sourcePath === entry.source.path)) throw new Error("Module source entry is not in its package.");
  same(entry.schema, checked.descriptor.configuration, "configuration");
  same(entry.constraints ?? [], checked.descriptor.constraints, "constraints");
  same(entry.requiresHost, checked.descriptor.requiresHost, "host requirements");
  const management = bindModuleManagementManifest(entry.management);
  same(entry.management, management, "management");
  return {
    domain: MODULE_MODE_HOST_MANIFEST_DOMAIN,
    manifest: {
      sourcePackageId: checked.packageId,
      configuration: { schema: entry.schema, abiMapping: entry.programAbi },
      management, requiresHost: checked.descriptor.requiresHost,
      runtimeBinding: {
        sourceReleaseDigest: release.releaseDigest, registry: release.contracts.registry,
        engine: { id: entry.engine.id, version: entry.engine.version },
        familyId: moduleHash(binding.familyId, "catalog.familyId"), packageId: moduleHash(binding.packageId, "catalog.packageId"),
        factory: moduleAddress(binding.factory, "catalog.factory"), factoryCodeHash: moduleHash(binding.factoryCodeHash, "catalog.factoryCodeHash"),
        moduleCodeHash: moduleHash(binding.moduleCodeHash, "catalog.moduleCodeHash"), callbackGas,
      },
      catalogDefinition: entry,
    },
  };
}

export function moduleModePublicationUrl(packageId: Hex, kind: PublicationKind): string {
  const id = moduleHash(packageId, "publication.packageId");
  if (!Object.hasOwn(PUBLICATION_MAXIMUM, kind)) throw new Error("Unknown module publication file.");
  return `${MODULE_MODE_PUBLICATION_ORIGIN}/developers/modules/${id}/${kind}.json`;
}

/** The checked-in catalogue is the publication allowlist; private submissions are never discovered here. */
export function bindModuleModeCatalogFile(value: unknown, release: Pick<ModuleModeRelease, "releaseDigest">): ModuleModeCatalogFile {
  const raw = moduleRecord(nativeJson(value), ["schemaVersion", "sourceReleaseDigest", "entries"], "catalog");
  if (raw.schemaVersion !== MODULE_MODE_CATALOG_SCHEMA || !Array.isArray(raw.entries) || raw.entries.length > 1000) throw new Error("Invalid module catalogue.");
  // A verified engine can launch a plain coin before the first reviewed module exists.
  const sourceReleaseDigest = raw.sourceReleaseDigest === null ? null : moduleHash(raw.sourceReleaseDigest, "catalog.release");
  if ((sourceReleaseDigest !== null && sourceReleaseDigest !== release.releaseDigest) || (raw.entries.length > 0 && sourceReleaseDigest === null)) throw new Error("Module catalogue belongs to another release.");
  const ids = new Set<string>(); const packages = new Set<string>();
  const entries = raw.entries.map(value => {
    const rawEntry = moduleRecord(value, ["entry", "requestDigest", "review"], "catalog.publication");
    const entry = bindNativeCatalogEntry(rawEntry.entry);
    const packageId = moduleHash(entry.nativeBinding.packageId, "catalog.packageId");
    if (ids.has(entry.id) || packages.has(packageId)) throw new Error("Duplicate module catalogue identity.");
    ids.add(entry.id); packages.add(packageId);
    const requestDigest = moduleHash(rawEntry.requestDigest, "catalog.requestDigest");
    const review = reviewRecord(rawEntry.review);
    if (review.command.outcome !== "accept" || review.subject.requestDigest !== requestDigest
      || review.command.hostManifestHash !== moduleHash(entry.nativeBinding.manifestHash, "catalog.manifestHash")
      || review.decisionDigest !== moduleHash(entry.nativeBinding.reviewDigest, "catalog.reviewDigest")) throw new Error("Module acceptance does not bind the published version.");
    return { entry, requestDigest, review };
  });
  return { schemaVersion: MODULE_MODE_CATALOG_SCHEMA, sourceReleaseDigest, entries };
}

/** Byte/digest consistency only. The protected repository and private review workflow supply authority. */
export function verifyModuleModePublication(input: {
  release: ModuleModeHostReleaseIdentity; publication: ModuleModeCatalogPublication;
  source: unknown; manifest: unknown; review: unknown;
}): NativeModuleModeCatalogEntry {
  const catalog = bindModuleModeCatalogFile({ schemaVersion: MODULE_MODE_CATALOG_SCHEMA,
    sourceReleaseDigest: input.release.releaseDigest, entries: [input.publication] }, input.release);
  const publication = catalog.entries[0]!;
  const source = validateModuleSubmissionRequest(input.source);
  if (!source.ok || source.requestDigest !== publication.requestDigest) throw new Error("Published source bytes differ from the reviewed submission.");
  const nativeBinding = Object.fromEntries(Object.entries(publication.entry.nativeBinding)
    .filter(([key]) => key !== "manifestHash" && key !== "reviewDigest")) as Omit<ModuleModeNativeBinding, "manifestHash" | "reviewDigest">;
  const expectedManifest = createModuleModeHostManifest({ release: input.release, definition: definitionOf(publication.entry),
    nativeBinding, descriptor: source.request.descriptor });
  if (unsupportedManagementCapabilities(expectedManifest.manifest.management).length) throw new Error("Module management requires an unavailable host capability.");
  same(input.manifest, expectedManifest, "host manifest");
  if (computeModuleModeHostManifestHash(expectedManifest) !== moduleHash(publication.entry.nativeBinding.manifestHash, "publication.manifestHash")) throw new Error("Published module manifest digest differs.");
  const review = reviewRecord(input.review);
  same(review, publication.review, "review decision");
  if (moduleAddress(review.subject.author, "review.author") !== moduleAddress(source.request.descriptor.author, "source.author")) throw new Error("Module review author differs from its package.");
  return publication.entry;
}

async function readPublication(input: { packageId: Hex; kind: PublicationKind; fetchPublic: typeof fetch; signal: AbortSignal; budget: { bytes: number } }): Promise<unknown> {
  const response = await input.fetchPublic(moduleModePublicationUrl(input.packageId, input.kind), {
    method: "GET", headers: { accept: "application/json" }, redirect: "error", cache: "no-store", signal: input.signal,
  });
  const maximum = PUBLICATION_MAXIMUM[input.kind];
  const declared = response.headers.get("content-length");
  if (!response.ok || !response.body || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")
    || (declared !== null && (!/^(0|[1-9][0-9]*)$/u.test(declared) || Number(declared) > maximum))) {
    await response.body?.cancel(); throw new Error("Module publication is unavailable.");
  }
  const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      input.signal.throwIfAborted(); size += value.byteLength; input.budget.bytes += value.byteLength;
      if (size > maximum || input.budget.bytes > PUBLICATION_BATCH_BYTES) throw new Error("Module publication exceeds its byte budget.");
      chunks.push(value);
    }
  } catch (error) { await reader.cancel(); throw error; }
  finally { reader.releaseLock(); }
  if (declared !== null && Number(declared) !== size) throw new Error("Module publication length differs.");
  return parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)), { maximumBytes: maximum, maximumDepth: 40 });
}

export interface ModuleModeAvailabilityDependencies {
  releaseProfile: unknown;
  catalogFile: unknown;
  collector: (signal: AbortSignal) => ReleaseAuthenticator;
  fetchPublic: typeof fetch;
  now?: () => number;
  budgetMs?: number;
}

function unavailable(reason: string): ModuleModeAvailability {
  return { schemaVersion: MODULE_MODE_AVAILABILITY_SCHEMA, release: null, catalog: [], reason };
}

/**
 * One bounded server reader per immutable configuration. Successful publication-cache keys include
 * the complete release activation, whole-entry digest, source request digest and exact review record.
 * Every new availability sample re-authenticates the release; cached publication bytes never override it.
 */
export function createModuleModeAvailabilityReader(dependencies: ModuleModeAvailabilityDependencies): () => Promise<ModuleModeAvailability> {
  const now = dependencies.now ?? Date.now;
  const verifiedPublications = new Map<string, number>();
  let cached: { until: number; value: ModuleModeAvailability } | undefined;
  let pending: Promise<ModuleModeAvailability> | undefined;
  const read = async (): Promise<ModuleModeAvailability> => {
    // Only the committed disabled preview may display local proposal entries. No environment activation.
    const profile = dependencies.releaseProfile as { enabled?: unknown; status?: unknown } | null;
    if (profile?.enabled === false && profile.status === "preview") return parseModuleModeAvailability({
      schemaVersion: MODULE_MODE_AVAILABILITY_SCHEMA, release: null,
      catalog: PREVIEW_MODULE_CATALOG, reason: PREPARING,
    });
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<never>((_, reject) => { timeout = setTimeout(() => {
      controller.abort(); reject(new Error("Module availability request expired."));
    }, dependencies.budgetMs ?? MODULE_MODE_AVAILABILITY_BUDGET_MS); });
    try {
      return await Promise.race([(async () => {
        const release = bindActiveModuleModeRelease(dependencies.releaseProfile);
        const catalog = bindModuleModeCatalogFile(dependencies.catalogFile, release);
        await dependencies.collector(controller.signal).authenticateRelease(release);
        controller.signal.throwIfAborted();
        const budget = { bytes: 0 }; let next = 0;
        // Two maximum-size packages fit the aggregate budget, allowing cold verification to make progress.
        await Promise.all(Array.from({ length: Math.min(2, catalog.entries.length) }, async () => {
          for (;;) {
            controller.signal.throwIfAborted();
            const publication = catalog.entries[next++]; if (!publication) return;
            const key = canonicalizeJson({ release, entryDigest: moduleNativeCatalogDigest(publication.entry),
              requestDigest: publication.requestDigest, review: publication.review });
            if ((verifiedPublications.get(key) ?? 0) > now()) continue;
            const request = { packageId: publication.entry.nativeBinding.packageId, fetchPublic: dependencies.fetchPublic, signal: controller.signal, budget };
            const source = await readPublication({ ...request, kind: "source" });
            const [manifest, review] = await Promise.all([readPublication({ ...request, kind: "manifest" }), readPublication({ ...request, kind: "review" })]);
            controller.signal.throwIfAborted();
            verifyModuleModePublication({ release, publication, source, manifest, review });
            verifiedPublications.set(key, now() + MODULE_MODE_PUBLICATION_TTL_MS);
          }
        }));
        return parseModuleModeAvailability({ schemaVersion: MODULE_MODE_AVAILABILITY_SCHEMA, release,
          catalog: catalog.entries.map(publication => publication.entry), reason: null });
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

const configuredReader = createModuleModeAvailabilityReader({ releaseProfile: configuredRelease, catalogFile: configuredCatalog,
  collector: signal => createModuleModeHttpCollector({
    backendBaseUrl: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL ?? "",
    websiteToken: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_WEBSITE_TOKEN ?? "", fetchBackend: fetch, signal,
  }), fetchPublic: (...args) => fetch(...args),
});
export const readModuleModeAvailability = (): Promise<ModuleModeAvailability> => configuredReader();

/** Public source publication format; never includes API keys, private queue metadata or a wallet signature. */
export type ModuleModePublishedSource = ModuleSubmissionRequest;
