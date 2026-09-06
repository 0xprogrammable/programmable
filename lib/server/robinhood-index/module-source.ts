import preview from "@/config/module-mode/robinhood.preview.json";
import { bindActiveModuleModeRelease, moduleHash, moduleRecord, moduleUint, type ModuleModeRelease } from "@/lib/module-mode/release";
import { normalizeModuleModeLaunches, type ModuleModeProvenance } from "@/lib/module-mode/provenance";
import type { RobinhoodModuleLaunch } from "@/lib/robinhood-launches";
import { IndexRangeTooWide, type ModuleModeIndexSource } from "./sync";
import type { Checkpoint } from "./model";
import { parseStrictJson } from "../projection-target/canonical-json";

const COLLECTOR_SCHEMA = "programmable.module-mode-index.v1";
const MAX_COLLECTOR_BYTES = 16 * 1024 * 1024;

/**
 * Trusted server implementation, not a public JSON submission API. Its implementation must independently
 * authenticate the release artifact, two independent L2 observations, complete bounded log discovery,
 * receipt/getter/code reads and NodeInterface batch membership posted to the pinned Ethereum SequencerInbox
 * before the common two-provider Ethereum finalized checkpoint. No flag or digest substitutes for that work.
 */
export interface ModuleModeFinalizedCollector {
  authenticateRelease(release: ModuleModeRelease): Promise<void>;
  finalizedBoundary(release: ModuleModeRelease): Promise<{
    chainId: 4663; sourceReleaseDigest: string; blockNumber: string; blockHash: string; verificationDigest: string;
  }>;
  canonicalBlock(release: ModuleModeRelease, number: bigint): Promise<{
    chainId: 4663; blockNumber: string; blockHash: string;
  }>;
  collectRange(release: ModuleModeRelease, from: bigint, to: bigint): Promise<{
    sourceReleaseDigest: string; fromBlock: string; toBlock: string; complete: true;
    launches: readonly { evidence: unknown; launchedAt: string | null }[];
  }>;
}

export function moduleModePublicLaunch(row: ModuleModeProvenance, launchedAt: string | null): RobinhoodModuleLaunch {
  if (launchedAt !== null && (typeof launchedAt !== "string" || !Number.isFinite(Date.parse(launchedAt)))) throw new Error("Module Mode launch timestamp is invalid");
  return Object.freeze({ sourceKind: "module-native-v1", sourceAddress: row.sourceAddress,
    sourceReleaseDigest: row.sourceReleaseDigest, routerAddress: null, stampHash: null,
    launchId: row.launchId, tokenAddress: row.token, hookAddress: row.hook, creator: row.launchWallet,
    poolManager: row.poolManager, poolId: row.poolId, recipeHash: row.recipeHash, runtime: row.runtime, launchKey: row.launchKey,
    verificationDigest: row.verification.verificationDigest,
    modulePackageIds: Object.freeze(row.revisions.map(revision => revision.packageId)),
    moduleFamilyIds: Object.freeze(row.revisions.map(revision => revision.familyId)),
    transactionHash: row.transactionHash, blockNumber: row.blockNumber, blockHash: row.blockHash, logIndex: row.logIndex,
    launchedAt, name: row.tokenIdentity.name, symbol: row.tokenIdentity.symbol, decimals: row.tokenIdentity.decimals });
}

export async function moduleModeSource(profile: unknown, collector: ModuleModeFinalizedCollector): Promise<ModuleModeIndexSource> {
  const release = bindActiveModuleModeRelease(profile);
  if (!collector || ["authenticateRelease", "finalizedBoundary", "canonicalBlock", "collectRange"]
    .some(method => typeof collector[method as keyof ModuleModeFinalizedCollector] !== "function")) {
    throw new Error("Module Mode requires the authenticated rollup-finality collector");
  }
  await collector.authenticateRelease(release);
  const rawBoundary = moduleRecord(await collector.finalizedBoundary(release),
    ["chainId", "sourceReleaseDigest", "blockNumber", "blockHash", "verificationDigest"], "collector.boundary");
  if (rawBoundary.chainId !== release.chainId || moduleHash(rawBoundary.sourceReleaseDigest, "collector.release") !== release.releaseDigest) {
    throw new Error("Module Mode collector release binding differs");
  }
  moduleHash(rawBoundary.verificationDigest, "collector.boundary.verificationDigest");
  const finalized: Checkpoint = { number: moduleUint(rawBoundary.blockNumber, "collector.boundary.number", true), hash: moduleHash(rawBoundary.blockHash, "collector.boundary.hash") };
  if (BigInt(finalized.number) < BigInt(release.startBlock)) throw new Error("Module Mode finalized boundary precedes release");
  const block = async (number: bigint): Promise<Checkpoint> => {
    const value = moduleRecord(await collector.canonicalBlock(release, number), ["chainId", "blockNumber", "blockHash"], "collector.block");
    if (value.chainId !== release.chainId || moduleUint(value.blockNumber, "collector.block.number", true) !== number.toString()) {
      throw new Error("Module Mode collector returned another block");
    }
    return { number: number.toString(), hash: moduleHash(value.blockHash, "collector.block.hash") };
  };
  if ((await block(BigInt(finalized.number))).hash !== finalized.hash) throw new Error("Module Mode finalized boundary changed");
  return {
    sourceKind: "module-native-v1", sourceAddress: release.contracts.launcher.address,
    releaseDigest: release.releaseDigest, startBlock: BigInt(release.startBlock), finalized, block,
    async launches(from, to) {
      if (from < BigInt(release.startBlock) || to < from || to > BigInt(finalized.number)) throw new Error("Module Mode scan is outside verified bounds");
      if (to - from >= 10_000n) throw new IndexRangeTooWide("Module Mode range exceeds collector budget");
      const raw = moduleRecord(await collector.collectRange(release, from, to),
        ["sourceReleaseDigest", "fromBlock", "toBlock", "complete", "launches"], "collector.range");
      if (moduleHash(raw.sourceReleaseDigest, "collector.range.release") !== release.releaseDigest
        || raw.fromBlock !== from.toString() || raw.toBlock !== to.toString() || raw.complete !== true
        || !Array.isArray(raw.launches)) throw new Error("Module Mode collector range is incomplete or unbound");
      if (raw.launches.length > 1000) throw new IndexRangeTooWide("Module Mode launch range exceeds verification budget");
      const entries = raw.launches.map(value => moduleRecord(value, ["evidence", "launchedAt"], "collector.launch"));
      const rows = normalizeModuleModeLaunches(entries.map(entry => entry.evidence), release);
      const canonical = new Map<string, string>();
      for (const row of rows) {
        if (!canonical.has(row.blockNumber)) canonical.set(row.blockNumber, (await block(BigInt(row.blockNumber))).hash);
        if (canonical.get(row.blockNumber) !== row.blockHash) throw new Error("Module Mode launch block changed during collection");
      }
      return rows.map((row, index) => {
        if (BigInt(row.blockNumber) < from || BigInt(row.blockNumber) > to) throw new Error("Module Mode launch is outside scan range");
        const timestamp = entries[index].launchedAt;
        if (timestamp !== null && typeof timestamp !== "string") throw new Error("Module Mode launch timestamp is invalid");
        return moduleModePublicLaunch(row, timestamp);
      });
    },
  };
}

/**
 * The preview never activates from an environment toggle. A reviewed release and a real server collector
 * implementation must both be installed. Missing collector wiring is a release failure, not an empty feed.
 */
export async function configuredModuleModeSource(collector?: ModuleModeFinalizedCollector, signal?: AbortSignal): Promise<ModuleModeIndexSource | null> {
  if (!preview.enabled && preview.status === "preview") return null;
  return moduleModeSource(preview, collector ?? createModuleModeHttpCollector({
    backendBaseUrl: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_API_BASE_URL ?? "",
    websiteToken: process.env.PROGRAMMABLE_CUSTOM_LAUNCH_WEBSITE_TOKEN ?? "",
    fetchBackend: fetch, signal,
  }));
}

/** Server-held service credentials only. Contributor keys and client-supplied profiles never enter this route. */
export function createModuleModeHttpCollector(input: {
  backendBaseUrl: string; websiteToken: string; fetchBackend: typeof fetch; signal?: AbortSignal;
}): ModuleModeFinalizedCollector {
  let base: URL;
  try { base = new URL(input.backendBaseUrl); } catch { throw new Error("Module Mode collector origin is not configured"); }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash
    || base.pathname !== "/" || !base.hostname || base.port) throw new Error("Module Mode collector origin is invalid");
  if (typeof input.websiteToken !== "string" || input.websiteToken.length < 32 || input.websiteToken.length > 1024
    || /[\s\u0000-\u001f\u007f]/u.test(input.websiteToken)) throw new Error("Module Mode service credential is not configured");
  const request = async (operation: "release" | "boundary" | "block" | "range", body: Record<string, string>): Promise<unknown> => {
    let response: Response;
    try {
      response = await input.fetchBackend(new URL(`/internal/module-mode-index/v1/${operation}`, base), {
        method: "POST", headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${input.websiteToken}` },
        body: JSON.stringify(body), cache: "no-store", redirect: "error",
        signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(operation === "range" ? 90_000 : 15_000)])
          : AbortSignal.timeout(operation === "range" ? 90_000 : 15_000),
      });
    } catch { throw new Error("Module Mode collector request is unavailable"); }
    const maximum = response.ok ? MAX_COLLECTOR_BYTES : 16_384;
    if (!response.body || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get("content-type") ?? "")) {
      await response.body?.cancel(); throw new Error("Module Mode collector response is invalid");
    }
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^(0|[1-9][0-9]*)$/u.test(declared) || Number(declared) > maximum)) {
      await response.body.cancel(); throw new Error("Module Mode collector response exceeds its budget");
    }
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > maximum) throw new Error("Module Mode collector response exceeds its budget");
        chunks.push(value);
      }
    } catch { await reader.cancel(); throw new Error("Module Mode collector response is unavailable"); }
    finally { reader.releaseLock(); }
    if (declared !== null && Number(declared) !== size) throw new Error("Module Mode collector response length differs");
    let parsed: unknown;
    try { parsed = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)), { maximumDepth: 32, maximumBytes: maximum }); }
    catch { throw new Error("Module Mode collector response is invalid"); }
    if (!response.ok) {
      const problem = moduleRecord(parsed, ["schemaVersion", "error"], "collector.problem");
      const error = moduleRecord(problem.error, ["code"], "collector.problem.error");
      if (operation === "range" && response.status === 413 && problem.schemaVersion === COLLECTOR_SCHEMA && error.code === "MODULE_INDEX_RANGE_TOO_WIDE") {
        throw new IndexRangeTooWide("Module Mode collector range must be split");
      }
      throw new Error("Module Mode collector has not verified this request");
    }
    const envelope = moduleRecord(parsed, ["schemaVersion", "result"], "collector.response");
    if (envelope.schemaVersion !== COLLECTOR_SCHEMA) throw new Error("Module Mode collector schema differs");
    return envelope.result;
  };
  return {
    async authenticateRelease(release) {
      const actual = bindActiveModuleModeRelease(await request("release", { sourceReleaseDigest: release.releaseDigest }));
      if (JSON.stringify(actual) !== JSON.stringify(release)) throw new Error("Module Mode collector active release differs");
    },
    async finalizedBoundary(release) {
      return await request("boundary", { sourceReleaseDigest: release.releaseDigest }) as Awaited<ReturnType<ModuleModeFinalizedCollector["finalizedBoundary"]>>;
    },
    async canonicalBlock(release, number) {
      return await request("block", { sourceReleaseDigest: release.releaseDigest, blockNumber: number.toString() }) as Awaited<ReturnType<ModuleModeFinalizedCollector["canonicalBlock"]>>;
    },
    async collectRange(release, from, to) {
      return await request("range", { sourceReleaseDigest: release.releaseDigest, fromBlock: from.toString(), toBlock: to.toString() }) as Awaited<ReturnType<ModuleModeFinalizedCollector["collectRange"]>>;
    },
  };
}
