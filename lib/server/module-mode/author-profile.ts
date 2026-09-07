import { isModulePublicDetails, type PublicModuleDetails } from "@/lib/module-mode/public-details";
import { moduleHash } from "@/lib/module-mode/release";
import { MODULE_AUTHOR_PROFILE_MAX_RELEASES, MODULE_AUTHOR_PROFILE_MAX_SOURCE_RELEASES, MODULE_AUTHOR_PROFILE_PAGE_SIZE, MODULE_AUTHOR_PROFILE_SCHEMA, type ModuleAuthorProfile, type ModuleAuthorProfileItem } from "@/lib/profile/module-author-profile";
import { configuredModuleModeReleaseDigests } from "./catalog";
import { readPublicModuleDetails } from "./public-details";
import { configuredModuleEngineReleaseDigests } from "../module-engine/catalog";
import { readPublicModuleEngineDetails } from "../module-engine/public-details";

function validateRequest(account: string, page: number) {
  if (!/^0x[\da-f]{40}$/iu.test(account) || !Number.isSafeInteger(page) || page < 1) throw new Error("Invalid module profile request.");
}

/** Only the trusted publication reader may supply modules. The private submission queue is never read. */
export function moduleAuthorProfile(account: string, requestedPage: number, published: PublicModuleDetails | readonly PublicModuleDetails[] | null,
  unavailableReleaseDigests: readonly string[] = []): ModuleAuthorProfile {
  validateRequest(account, requestedPage);
  const wallet = account.toLowerCase();
  const sources: readonly PublicModuleDetails[] = published === null ? [] : Array.isArray(published) ? published : [published as PublicModuleDetails];
  const releaseDigests = [...new Set(sources.map(source => source.releaseDigest.toLowerCase()))];
  const unavailable = [...new Set(unavailableReleaseDigests.map(digest => digest.toLowerCase()))].sort();
  if (releaseDigests.length + unavailable.length > MODULE_AUTHOR_PROFILE_MAX_RELEASES || unavailable.some(digest => releaseDigests.includes(digest))) throw new Error("Invalid module profile release coverage.");
  const revisions = new Map<string, ModuleAuthorProfileItem>();
  // Authorship comes from accepted review.subject.author. Project only public fields and exact source bindings.
  for (const source of sources) for (const item of source.items) {
    if (item.author.toLowerCase() !== wallet || item.sourceKind !== source.sourceKind) continue;
    const key = `${item.sourceKind ?? "native"}:${item.packageId.toLowerCase()}:${item.manifestHash.toLowerCase()}`;
    const existing = revisions.get(key);
    if (existing) {
      if (!existing.sourceReleaseDigests.includes(source.releaseDigest.toLowerCase())) revisions.set(key, { ...existing,
        sourceReleaseDigests: [...existing.sourceReleaseDigests, source.releaseDigest.toLowerCase()].sort() });
      continue;
    }
    const base = { packageId: item.packageId, familyId: item.familyId, title: item.title, description: item.description,
      version: item.version, author: wallet, category: item.category, manifestHash: item.manifestHash, sourceReleaseDigests: [source.releaseDigest.toLowerCase()] };
    revisions.set(key, item.sourceKind === "module-engine-v1" ? { ...base, sourceKind: item.sourceKind, engine: { interface: item.engine.interface,
      operations: item.engine.operations.map(operation => ({ operationId: operation.operationId, authorization: operation.authorization, inputRoles: operation.inputRoles, outputRoles: operation.outputRoles })) } } : base);
  }
  const items = [...revisions.values()].sort((left, right) => left.title.localeCompare(right.title, "en")
    || left.packageId.toLowerCase().localeCompare(right.packageId.toLowerCase()) || left.manifestHash.toLowerCase().localeCompare(right.manifestHash.toLowerCase())
    || (left.sourceKind ?? "native").localeCompare(right.sourceKind ?? "native"));
  const totalPages = Math.max(1, Math.ceil(items.length / MODULE_AUTHOR_PROFILE_PAGE_SIZE));
  const number = Math.min(requestedPage, totalPages);
  return { schemaVersion: MODULE_AUTHOR_PROFILE_SCHEMA, chainId: 4663, account: wallet,
    status: releaseDigests.length === 0 ? "unavailable" : unavailable.length ? "partial" : "ready",
    releaseDigest: releaseDigests[0] ?? null, releaseDigests, unavailableReleaseDigests: unavailable,
    items: items.slice((number - 1) * MODULE_AUTHOR_PROFILE_PAGE_SIZE, number * MODULE_AUTHOR_PROFILE_PAGE_SIZE),
    page: { number, size: MODULE_AUTHOR_PROFILE_PAGE_SIZE, totalItems: items.length, totalPages } };
}

export async function readModuleAuthorProfile(account: string, page = 1): Promise<ModuleAuthorProfile> {
  validateRequest(account, page);
  const native = [...new Set(configuredModuleModeReleaseDigests().map(digest => moduleHash(digest, "moduleProfile.releaseDigest")))];
  const engine = [...new Set(configuredModuleEngineReleaseDigests().map(digest => moduleHash(digest, "moduleProfile.engineReleaseDigest")))];
  if (native.length > MODULE_AUTHOR_PROFILE_MAX_SOURCE_RELEASES || engine.length > MODULE_AUTHOR_PROFILE_MAX_SOURCE_RELEASES) throw new Error("Too many module profile releases.");
  const requests = [...native.map(digest => ({ digest, sourceKind: undefined })), ...engine.map(digest => ({ digest, sourceKind: "module-engine-v1" as const }))];
  // Fanout is capped per protocol by its authority registry (current + at most 32 historical releases).
  // Each reused reader already coalesces calls and enforces its own 8-second I/O budget.
  const results = await Promise.allSettled(requests.map(request => request.sourceKind === "module-engine-v1"
    ? readPublicModuleEngineDetails(request.digest) : readPublicModuleDetails(request.digest)));
  const sources: PublicModuleDetails[] = []; const unavailable: string[] = [];
  for (const [index, result] of results.entries()) {
    const source = result.status === "fulfilled" ? result.value : null;
    const request = requests[index];
    if (source && source.sourceKind === request.sourceKind && typeof source.releaseDigest === "string" && source.releaseDigest.toLowerCase() === request.digest
      && Array.isArray(source.items) && source.items.length <= 1000 && source.items.every(item => isModulePublicDetails(item) && item.sourceKind === request.sourceKind)) sources.push(source);
    else unavailable.push(request.digest);
  }
  return moduleAuthorProfile(account, page, sources, unavailable);
}
