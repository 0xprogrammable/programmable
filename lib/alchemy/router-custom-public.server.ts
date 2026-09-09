import "server-only";

import { canonicalTokenExploreEntryV1 } from "../explore-entry-v1";
import type {
  CanonicalTokenExploreEntry,
  ExploreEntry,
  LauncherToken,
} from "../tokens";
import type { CreatorProfile, ExploreReadModel } from "../onchain/types";
import { resolveDurableExploreBlobToken } from "../onchain/durable-model";
import {
  canonicalizeJson,
  parseStrictJson,
  type JsonValue,
} from "../server/projection-target/canonical-json";
import { canonicalSha256 } from "../server/projection-target/hashing";
import {
  readAlchemyRouterCustomIdentitySourceV1,
  type AlchemyRouterCustomIdentitySourceV1,
} from "./explore.server";
import {
  LAUNCH_STAMP_ROUTER_BINDING,
} from "./launch-registry.server";
import { LAUNCH_STAMP_FINALITY_CONFIRMATIONS } from "./launch-stamp.server";
import { suppressRouterBoundCustomProjectDuplicates } from
  "./router-custom-collision";
import { enrichRouterCustomSnapshotWithFeePolicyV2 } from
  "../server/custom-launch/platform-fee-policy-readback-v2";
import { enrichRouterCustomSnapshotWithFinalizedMetadataV1 } from
  "../server/custom-launch/finalized-custom-launch-metadata-feed-v1";

export const ROUTER_CUSTOM_LAUNCH_SOURCE =
  "canonical-launch-stamp-router" as const;
export const ROUTER_CUSTOM_FINALITY_CONFIRMATIONS = Number(
  LAUNCH_STAMP_FINALITY_CONFIRMATIONS,
);
export const ROUTER_CUSTOM_SNAPSHOT_SCHEMA_VERSION =
  "programmable.router-custom-identity-snapshot.v1" as const;
export const ROUTER_CUSTOM_SNAPSHOT_CACHE_TTL_MS = 15_000;
export const ROUTER_CUSTOM_SNAPSHOT_MAX_IDENTITIES = 10_000;
export const ROUTER_CUSTOM_SNAPSHOT_MAXIMUM_BYTES = 16 * 1_024 * 1_024;
export const ROUTER_CUSTOM_SNAPSHOT_CURRENT_READ_TIMEOUT_MS = 3_000;
const ROUTER_CUSTOM_SNAPSHOT_MAXIMUM_FUTURE_SKEW_MS = 60_000;
const ROUTER_CUSTOM_SNAPSHOT_DURABLE_READ_TIMEOUT_MS = 2_000;
const ROUTER_CUSTOM_SNAPSHOT_PERSIST_TIMEOUT_MS = 2_000;
const ROUTER_CUSTOM_SNAPSHOT_ENVELOPE_SCHEMA_VERSION =
  "programmable.router-custom-identity-snapshot-envelope.v1" as const;
const ROUTER_CUSTOM_SNAPSHOT_BLOB_PATH = [
  "indexes/mainnet-launch-stamp-router-v1",
  LAUNCH_STAMP_ROUTER_BINDING.routerAddress.toLowerCase(),
  LAUNCH_STAMP_ROUTER_BINDING.routerRuntimeCodeHash.toLowerCase(),
  "custom-identities.json",
].join("/");
const VERCEL_BLOB_STRONG_ETAG = /^"[0-9a-f]{32}"$/iu;

class RouterCustomSnapshotConflictError extends Error {
  override name = "RouterCustomSnapshotConflictError";
}

export type PublicLaunchSourceV1 =
  | "registry.custom-launched"
  | "canonical-launch-stamp-router"
  | "registry.custom-launched+canonical-launch-stamp-router"
  | "envio-classic-v3"
  | "envio-classic-v3+registry.custom-launched"
  | "envio-classic-v3+canonical-launch-stamp-router"
  | "envio-classic-v3+registry.custom-launched+canonical-launch-stamp-router";

export type RouterCustomIdentitySnapshotV1 = Readonly<{
  schemaVersion: typeof ROUTER_CUSTOM_SNAPSHOT_SCHEMA_VERSION;
  source: typeof ROUTER_CUSTOM_LAUNCH_SOURCE;
  status: "current" | "last-known-good";
  generatedAt: string;
  asOfBlock: string;
  asOfBlockHash: `0x${string}`;
  finalityConfirmations: number;
  identityCommitment: `sha256:${string}`;
  entries: readonly CanonicalTokenExploreEntry[];
}>;

type RouterCustomReadOptionsV1 = Readonly<{
  deadlineMs?: number;
  signal?: AbortSignal;
}>;

export type RouterCustomIdentitySnapshotDependenciesV1 = Readonly<{
  now?: () => number;
  currentReadTimeoutMs?: number;
  readCurrentSource?: () => Promise<AlchemyRouterCustomIdentitySourceV1>;
  readDurableSnapshot?: () => Promise<RouterCustomIdentitySnapshotV1>;
  persistDurableSnapshot?: (
    snapshot: RouterCustomIdentitySnapshotV1,
    options?: Readonly<{ replaceAfterReorg?: boolean }>,
  ) => Promise<void>;
}>;

function abortError() {
  return new DOMException("Router Custom read aborted", "AbortError");
}

async function withinReadBoundary<T>(
  operation: () => Promise<T>,
  options: RouterCustomReadOptionsV1,
): Promise<T> {
  const signals = [options.signal].filter(
    (signal): signal is AbortSignal => signal !== undefined,
  );
  if (options.deadlineMs !== undefined) {
    const remaining = Math.max(0, options.deadlineMs - Date.now());
    signals.push(AbortSignal.timeout(remaining));
  }
  if (signals.length === 0) return operation();

  const signal = signals.length === 1 ? signals[0]! : AbortSignal.any(signals);
  if (signal.aborted) throw abortError();

  return await new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    operation().then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export function routerCustomExploreEntriesFromModelV1(
  model: ExploreReadModel,
): readonly CanonicalTokenExploreEntry[] {
  if (model.status !== "ready") {
    throw new Error("Router Custom launch model is not ready");
  }

  return Object.freeze(
    model.tokens
      .filter(
        (token) => token.launchStampProvenance?.kind === "custom-graph",
      )
      .map(canonicalTokenExploreEntryV1),
  );
}

function canonicalRouterEntriesV1(
  entries: readonly CanonicalTokenExploreEntry[],
) {
  if (entries.length > ROUTER_CUSTOM_SNAPSHOT_MAX_IDENTITIES) {
    throw new Error("Router Custom identity snapshot exceeds its bound");
  }
  const ids = new Set<string>();
  const tokens = new Set<string>();
  const validated = entries.map((entry) => {
    requireRouterCustomEntryV1(entry);
    return entry;
  });
  return Object.freeze(validated.sort((left, right) => {
    const leftStamp = left.launchStampProvenance!;
    const rightStamp = right.launchStampProvenance!;
    const blockOrder = BigInt(leftStamp.blockNumber) -
      BigInt(rightStamp.blockNumber);
    if (blockOrder !== 0n) return blockOrder < 0n ? -1 : 1;
    if (leftStamp.transactionIndex !== rightStamp.transactionIndex) {
      return leftStamp.transactionIndex - rightStamp.transactionIndex;
    }
    if (leftStamp.launchLogIndex !== rightStamp.launchLogIndex) {
      return leftStamp.launchLogIndex - rightStamp.launchLogIndex;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  }).map((entry) => {
    const token = entry.tokenAddress.toLowerCase();
    if (ids.has(entry.id) || tokens.has(token)) {
      throw new Error("Router Custom identity snapshot contains duplicates");
    }
    ids.add(entry.id);
    tokens.add(token);
    return entry;
  }));
}

function buildRouterCustomIdentitySnapshotV1(input: Readonly<{
  status: RouterCustomIdentitySnapshotV1["status"];
  generatedAt: string;
  asOfBlock: string;
  asOfBlockHash: `0x${string}`;
  entries: readonly CanonicalTokenExploreEntry[];
}>): RouterCustomIdentitySnapshotV1 {
  if (
    !/^(?:0|[1-9][0-9]*)$/u.test(input.asOfBlock) ||
    !/^0x[0-9a-f]{64}$/iu.test(input.asOfBlockHash) ||
    !Number.isFinite(Date.parse(input.generatedAt))
  ) {
    throw new Error("Router Custom identity snapshot boundary is invalid");
  }
  const entries = canonicalRouterEntriesV1(input.entries);
  const boundary = BigInt(input.asOfBlock);
  for (const entry of entries) {
    // The Router cursor is the highest launch-event block for which a separate
    // 64-confirmation observation has already been recorded in the provenance.
    // `finalizedAtBlockNumber` is that later observation head, so comparing it
    // to the scan cursor would impose the finality depth a second time.
    if (BigInt(entry.launchStampProvenance!.blockNumber) > boundary) {
      throw new Error("Router Custom identity launch is newer than its snapshot");
    }
  }
  const identityCore = {
    chainId: 1,
    source: ROUTER_CUSTOM_LAUNCH_SOURCE,
    asOfBlock: input.asOfBlock,
    asOfBlockHash: input.asOfBlockHash.toLowerCase(),
    finalityConfirmations: ROUTER_CUSTOM_FINALITY_CONFIRMATIONS,
    entries,
  };
  return Object.freeze({
    schemaVersion: ROUTER_CUSTOM_SNAPSHOT_SCHEMA_VERSION,
    source: ROUTER_CUSTOM_LAUNCH_SOURCE,
    status: input.status,
    generatedAt: new Date(input.generatedAt).toISOString(),
    asOfBlock: input.asOfBlock,
    asOfBlockHash: input.asOfBlockHash,
    finalityConfirmations: ROUTER_CUSTOM_FINALITY_CONFIRMATIONS,
    identityCommitment: canonicalSha256(
      ROUTER_CUSTOM_SNAPSHOT_SCHEMA_VERSION,
      identityCore,
    ),
    entries,
  });
}

export function routerCustomIdentitySnapshotFromSourceV1(
  source: AlchemyRouterCustomIdentitySourceV1,
): RouterCustomIdentitySnapshotV1 {
  return buildRouterCustomIdentitySnapshotV1({
    status: source.status,
    generatedAt: source.generatedAt,
    asOfBlock: source.slice.cursor.blockNumber,
    asOfBlockHash: source.slice.cursor.blockHash,
    entries: source.slice.tokens
      .filter((token) => token.launchStampProvenance?.kind === "custom-graph")
      .map(canonicalTokenExploreEntryV1),
  });
}

function lastKnownGoodRouterCustomSnapshotV1(
  snapshot: RouterCustomIdentitySnapshotV1,
) {
  return snapshot.status === "last-known-good"
    ? snapshot
    : Object.freeze({ ...snapshot, status: "last-known-good" as const });
}

function immutableRouterCustomIdentityV1(entry: CanonicalTokenExploreEntry) {
  requireRouterCustomEntryV1(entry);
  const {
    finalizedAtBlockNumber: _finalizedAtBlockNumber,
    finalizedAtBlockHash: _finalizedAtBlockHash,
    ...immutableLaunchStampProvenance
  } = entry.launchStampProvenance!;
  void _finalizedAtBlockNumber;
  void _finalizedAtBlockHash;
  return {
    id: entry.id,
    name: entry.name,
    symbol: entry.symbol ?? null,
    tokenAddress: entry.tokenAddress.toLowerCase(),
    tokenDecimals: entry.tokenDecimals ?? null,
    hookAddress: entry.hookAddress.toLowerCase(),
    poolId: entry.poolId.toLowerCase(),
    creatorAddress: entry.creatorAddress?.toLowerCase() ?? null,
    launchBlockNumber: entry.launchBlockNumber ?? null,
    launchTransactionHash:
      entry.launchTransactionHash?.toLowerCase() ?? null,
    launchTransactionIndex: entry.launchTransactionIndex ?? null,
    launchLogIndex: entry.launchLogIndex ?? null,
    launchedAt: entry.launchedAt,
    launchModel: entry.launchModel ?? null,
    launchModelVersion: entry.launchModelVersion ?? null,
    launchCategoryProvenance: entry.launchCategoryProvenance,
    // These two fields record when finality was observed, not launch identity.
    // A reorg-safe rebuild may legitimately rehydrate them at a later block.
    launchStampProvenance: immutableLaunchStampProvenance,
  };
}

export function routerCustomSnapshotPreservesFinalizedIdentitiesV1(
  previous: RouterCustomIdentitySnapshotV1,
  next: RouterCustomIdentitySnapshotV1,
) {
  try {
    const nextByLaunchId = new Map<string, CanonicalTokenExploreEntry>();
    for (const entry of next.entries) {
      const launchId = entry.launchStampProvenance?.launchId.toLowerCase();
      if (!launchId || nextByLaunchId.has(launchId)) return false;
      nextByLaunchId.set(launchId, entry);
    }
    const previousLaunchIds = new Set<string>();
    for (const entry of previous.entries) {
      const launchId = entry.launchStampProvenance?.launchId.toLowerCase();
      if (!launchId || previousLaunchIds.has(launchId)) return false;
      previousLaunchIds.add(launchId);
      const candidate = nextByLaunchId.get(launchId);
      if (
        !candidate ||
        candidate.tokenAddress.toLowerCase() !==
          entry.tokenAddress.toLowerCase() ||
        canonicalizeJson(immutableRouterCustomIdentityV1(candidate)) !==
          canonicalizeJson(immutableRouterCustomIdentityV1(entry))
      ) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function routerCustomSnapshotsShareFinalizedIdentityBoundaryV1(
  left: RouterCustomIdentitySnapshotV1,
  right: RouterCustomIdentitySnapshotV1,
) {
  return left.asOfBlock === right.asOfBlock &&
    left.asOfBlockHash.toLowerCase() === right.asOfBlockHash.toLowerCase() &&
    routerCustomSnapshotPreservesFinalizedIdentitiesV1(left, right) &&
    routerCustomSnapshotPreservesFinalizedIdentitiesV1(right, left);
}

function jsonRecord(
  value: JsonValue | undefined,
): Readonly<Record<string, JsonValue>> {
  if (
    value === null
    || value === undefined
    || Array.isArray(value)
    || typeof value !== "object"
  ) throw new Error("Router Custom durable snapshot is invalid");
  return value;
}

function parseDurableRouterCustomIdentitySnapshotV1(
  value: JsonValue,
): RouterCustomIdentitySnapshotV1 {
  const envelope = jsonRecord(value);
  const binding = jsonRecord(envelope.binding);
  const stored = jsonRecord(envelope.snapshot);
  if (
    envelope.schemaVersion !== ROUTER_CUSTOM_SNAPSHOT_ENVELOPE_SCHEMA_VERSION
    || canonicalizeJson(binding) !== canonicalizeJson(
      LAUNCH_STAMP_ROUTER_BINDING,
    )
    || stored.schemaVersion !== ROUTER_CUSTOM_SNAPSHOT_SCHEMA_VERSION
    || stored.source !== ROUTER_CUSTOM_LAUNCH_SOURCE
    || stored.finalityConfirmations !== ROUTER_CUSTOM_FINALITY_CONFIRMATIONS
    || typeof stored.generatedAt !== "string"
    || typeof stored.asOfBlock !== "string"
    || typeof stored.asOfBlockHash !== "string"
    || !Array.isArray(stored.entries)
    || typeof stored.identityCommitment !== "string"
  ) throw new Error("Router Custom durable snapshot is invalid");
  const snapshot = buildRouterCustomIdentitySnapshotV1({
    status: "last-known-good",
    generatedAt: stored.generatedAt,
    asOfBlock: stored.asOfBlock,
    asOfBlockHash: stored.asOfBlockHash as `0x${string}`,
    entries: stored.entries.map((entry) =>
      canonicalTokenExploreEntryV1(entry as unknown as LauncherToken)
    ),
  });
  if (snapshot.identityCommitment !== stored.identityCommitment) {
    throw new Error("Router Custom durable snapshot commitment is invalid");
  }
  return snapshot;
}

export function normalizeRouterCustomSnapshotBlobEtagV1(value: string) {
  const normalized = value.trim().replace(/^W\//u, "");
  if (!VERCEL_BLOB_STRONG_ETAG.test(normalized)) {
    throw new Error("Router Custom durable snapshot ETag is invalid");
  }
  return normalized;
}

export function assertBoundedRouterCustomSnapshotBlobSizeV1(
  declaredLength: number,
  actualLength: number,
) {
  // Private Vercel Blob reads currently report `blob.size = 0` while still
  // returning the complete stream. Treat zero as an unknown declared size and
  // enforce the bound against the bytes that were actually read below.
  if (
    !Number.isSafeInteger(declaredLength)
    || declaredLength < 0
    || declaredLength > ROUTER_CUSTOM_SNAPSHOT_MAXIMUM_BYTES
    || !Number.isSafeInteger(actualLength)
    || actualLength < 1
    || actualLength > ROUTER_CUSTOM_SNAPSHOT_MAXIMUM_BYTES
  ) throw new Error("Router Custom durable snapshot size is invalid");
}

async function readDurableRouterCustomIdentitySnapshotRecordV1() {
  const token = resolveDurableExploreBlobToken();
  if (!token) throw new Error(
    "Router Custom durable snapshot storage is not configured",
  );
  const { get } = await import("@vercel/blob");
  const result = await get(ROUTER_CUSTOM_SNAPSHOT_BLOB_PATH, {
    access: "private",
    token,
    useCache: false,
  });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error("Router Custom durable snapshot is unavailable");
  }
  const declaredLength = Number(result.blob.size);
  if (
    !Number.isSafeInteger(declaredLength)
    || declaredLength < 0
    || declaredLength > ROUTER_CUSTOM_SNAPSHOT_MAXIMUM_BYTES
  ) throw new Error("Router Custom durable snapshot size is invalid");
  const source = await new Response(result.stream).text();
  assertBoundedRouterCustomSnapshotBlobSizeV1(
    declaredLength,
    Buffer.byteLength(source, "utf8"),
  );
  return Object.freeze({
    snapshot: parseDurableRouterCustomIdentitySnapshotV1(
      parseStrictJson(source, {
        maximumBytes: ROUTER_CUSTOM_SNAPSHOT_MAXIMUM_BYTES,
        maximumDepth: 32,
      }),
    ),
    etag: normalizeRouterCustomSnapshotBlobEtagV1(result.blob.etag),
  });
}

async function readDurableRouterCustomIdentitySnapshotV1() {
  return (await readDurableRouterCustomIdentitySnapshotRecordV1()).snapshot;
}

/** Public reads consume the verified saved identities without running the updater. */
export async function readSavedRouterCustomIdentitySnapshotV1() {
  const snapshot = await withinDuration(
    readDurableRouterCustomIdentitySnapshotV1,
    ROUTER_CUSTOM_SNAPSHOT_DURABLE_READ_TIMEOUT_MS,
  );
  const age = Date.now() - Date.parse(snapshot.generatedAt);
  if (!Number.isFinite(age) || age < -ROUTER_CUSTOM_SNAPSHOT_MAXIMUM_FUTURE_SKEW_MS) {
    throw new Error("Router Custom durable snapshot timestamp is invalid");
  }
  return snapshot;
}

async function persistDurableRouterCustomIdentitySnapshotV1(
  snapshot: RouterCustomIdentitySnapshotV1,
  options: Readonly<{ replaceAfterReorg?: boolean }> = {},
) {
  const token = resolveDurableExploreBlobToken();
  if (!token) throw new Error(
    "Router Custom durable snapshot storage is not configured",
  );
  let existing: Awaited<
    ReturnType<typeof readDurableRouterCustomIdentitySnapshotRecordV1>
  > | null = null;
  try {
    existing = await readDurableRouterCustomIdentitySnapshotRecordV1();
  } catch {
    existing = null;
  }
  if (existing) {
    const previousBlock = BigInt(existing.snapshot.asOfBlock);
    const nextBlock = BigInt(snapshot.asOfBlock);
    if (previousBlock > nextBlock) {
      if (options.replaceAfterReorg) {
        throw new RouterCustomSnapshotConflictError(
          "Router Custom durable snapshot cannot delete finalized identities after a reorg",
        );
      }
      return;
    }
    if (previousBlock === nextBlock) {
      if (
        existing.snapshot.identityCommitment !== snapshot.identityCommitment &&
        !routerCustomSnapshotsShareFinalizedIdentityBoundaryV1(
          existing.snapshot,
          snapshot,
        )
      ) {
        throw new RouterCustomSnapshotConflictError(
          "Router Custom durable snapshot conflicts at one block",
        );
      }
      return;
    }
    if (
      !routerCustomSnapshotPreservesFinalizedIdentitiesV1(
        existing.snapshot,
        snapshot,
      )
    ) {
      throw new RouterCustomSnapshotConflictError(
        "Router Custom durable snapshot cannot rewrite finalized identities",
      );
    }
  }
  const { put } = await import("@vercel/blob");
  await put(
    ROUTER_CUSTOM_SNAPSHOT_BLOB_PATH,
    canonicalizeJson({
      schemaVersion: ROUTER_CUSTOM_SNAPSHOT_ENVELOPE_SCHEMA_VERSION,
      binding: LAUNCH_STAMP_ROUTER_BINDING,
      snapshot,
    }),
    {
      access: "private",
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: existing !== null,
      cacheControlMaxAge: 60,
      ...(existing ? { ifMatch: existing.etag } : {}),
      token,
    },
  );
}

export async function persistRouterCustomIdentitySnapshotFromSourceV1(
  source: AlchemyRouterCustomIdentitySourceV1,
) {
  const snapshot = routerCustomIdentitySnapshotFromSourceV1(source);
  await persistDurableRouterCustomIdentitySnapshotV1(snapshot, {
    replaceAfterReorg: source.reorgDetected,
  });
  return snapshot;
}

export function createRouterCustomIdentitySnapshotReaderV1(
  dependencies: RouterCustomIdentitySnapshotDependenciesV1 = {},
) {
  const now = dependencies.now ?? Date.now;
  const readCurrentSource = dependencies.readCurrentSource ??
    readAlchemyRouterCustomIdentitySourceV1;
  const readDurableSnapshot = dependencies.readDurableSnapshot ??
    readDurableRouterCustomIdentitySnapshotV1;
  const persistDurableSnapshot = dependencies.persistDurableSnapshot ??
    persistDurableRouterCustomIdentitySnapshotV1;
  const currentReadTimeoutMs = dependencies.currentReadTimeoutMs ??
    ROUTER_CUSTOM_SNAPSHOT_CURRENT_READ_TIMEOUT_MS;
  if (
    !Number.isInteger(currentReadTimeoutMs)
    || currentReadTimeoutMs < 10
    || currentReadTimeoutMs > 5_000
  ) throw new TypeError("Router Custom current read timeout is invalid");
  let cached: Readonly<{
    expiresAt: number;
    snapshot: RouterCustomIdentitySnapshotV1;
  }> | null = null;
  let inFlight: Promise<RouterCustomIdentitySnapshotV1> | null = null;

  const cacheSnapshot = (snapshot: RouterCustomIdentitySnapshotV1) => {
    cached = Object.freeze({
      expiresAt: now() + ROUTER_CUSTOM_SNAPSHOT_CACHE_TTL_MS,
      snapshot,
    });
    return snapshot;
  };

  const refresh = async () => {
    try {
      let previous = cached
        ? lastKnownGoodRouterCustomSnapshotV1(cached.snapshot)
        : null;
      const source = await withinDuration(
        readCurrentSource,
        currentReadTimeoutMs,
      );
      const snapshot = routerCustomIdentitySnapshotFromSourceV1(source);
      try {
        const durable = lastKnownGoodRouterCustomSnapshotV1(
          await withinDuration(
            readDurableSnapshot,
            ROUTER_CUSTOM_SNAPSHOT_DURABLE_READ_TIMEOUT_MS,
          ),
        );
        const generatedAtMs = Date.parse(durable.generatedAt);
        const ageMs = now() - generatedAtMs;
        if (
          !Number.isFinite(generatedAtMs) ||
          ageMs < -ROUTER_CUSTOM_SNAPSHOT_MAXIMUM_FUTURE_SKEW_MS
        ) {
          throw new Error(
            "Router Custom durable snapshot timestamp is invalid",
          );
        }
        if (previous) {
          const previousBlock = BigInt(previous.asOfBlock);
          const durableBlock = BigInt(durable.asOfBlock);
          if (
            previousBlock === durableBlock &&
            (previous.asOfBlockHash.toLowerCase() !==
                durable.asOfBlockHash.toLowerCase() ||
              previous.identityCommitment !== durable.identityCommitment)
          ) {
            if (!routerCustomSnapshotsShareFinalizedIdentityBoundaryV1(
              previous,
              durable,
            )) {
              throw new RouterCustomSnapshotConflictError(
                "Router Custom cached and durable snapshots conflict",
              );
            }
            // Observation-only finality fields can be rehydrated at a later
            // head without changing launch identity. Prefer the shared durable
            // bytes so cold serverless instances publish one stable boundary.
            previous = durable;
          }
          if (
            durableBlock > previousBlock &&
            routerCustomSnapshotPreservesFinalizedIdentitiesV1(
              previous,
              durable,
            )
          ) previous = durable;
        } else {
          previous = durable;
        }
      } catch (error) {
        if (error instanceof RouterCustomSnapshotConflictError) throw error;
        console.warn("Router Custom durable snapshot comparison unavailable", {
          name: error instanceof Error
            ? error.name
            : "RouterCustomSnapshotCompareError",
        });
      }
      if (previous) {
        const previousBlock = BigInt(previous.asOfBlock);
        const currentBlock = BigInt(snapshot.asOfBlock);
        if (previousBlock > currentBlock) {
          return cacheSnapshot(previous);
        }
        if (
          previousBlock === currentBlock &&
          (previous.asOfBlockHash.toLowerCase() !==
              snapshot.asOfBlockHash.toLowerCase() ||
            previous.identityCommitment !== snapshot.identityCommitment)
        ) {
          if (!routerCustomSnapshotsShareFinalizedIdentityBoundaryV1(
            previous,
            snapshot,
          )) {
            throw new RouterCustomSnapshotConflictError(
              "Router Custom snapshots conflict at one boundary",
            );
          }
          return cacheSnapshot(
            lastKnownGoodRouterCustomSnapshotV1(previous),
          );
        }
        if (
          currentBlock > previousBlock &&
          !routerCustomSnapshotPreservesFinalizedIdentitiesV1(
            previous,
            snapshot,
          )
        ) {
          return cacheSnapshot(previous);
        }
      }
      cacheSnapshot(snapshot);
      try {
        await withinDuration(
          () => persistDurableSnapshot(snapshot, {
            replaceAfterReorg: source.reorgDetected,
          }),
          ROUTER_CUSTOM_SNAPSHOT_PERSIST_TIMEOUT_MS,
        );
      } catch (error) {
        if (error instanceof RouterCustomSnapshotConflictError) {
          cached = null;
          throw error;
        }
        console.warn("Router Custom durable snapshot persistence unavailable", {
          name: error instanceof Error
            ? error.name
            : "RouterCustomSnapshotPersistError",
        });
      }
      return snapshot;
    } catch (currentError) {
      if (currentError instanceof RouterCustomSnapshotConflictError) {
        throw currentError;
      }
      if (cached) {
        return cacheSnapshot(
          lastKnownGoodRouterCustomSnapshotV1(cached.snapshot),
        );
      }
      try {
        const durable = lastKnownGoodRouterCustomSnapshotV1(
          await withinDuration(
            readDurableSnapshot,
            ROUTER_CUSTOM_SNAPSHOT_DURABLE_READ_TIMEOUT_MS,
          ),
        );
        const generatedAtMs = Date.parse(durable.generatedAt);
        const ageMs = now() - generatedAtMs;
        if (
          !Number.isFinite(generatedAtMs) ||
          ageMs < -ROUTER_CUSTOM_SNAPSHOT_MAXIMUM_FUTURE_SKEW_MS
        ) {
          throw new Error("Router Custom durable snapshot timestamp is invalid");
        }
        return cacheSnapshot(durable);
      } catch {
        throw currentError;
      }
    }
  };

  return async function readFinalizedRouterCustomIdentitySnapshotV1(
    options: RouterCustomReadOptionsV1 = {},
  ) {
    if (cached && cached.expiresAt > now()) return cached.snapshot;
    const flight = inFlight ?? refresh().finally(() => {
      inFlight = null;
    });
    inFlight = flight;
    try {
      return await withinReadBoundary(() => flight, options);
    } catch (error) {
      if (error instanceof RouterCustomSnapshotConflictError) throw error;
      if (cached) {
        return lastKnownGoodRouterCustomSnapshotV1(cached.snapshot);
      }
      throw error;
    }
  };
}

async function withinDuration<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new DOMException("Router Custom read timed out", "TimeoutError"));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

const readProductionRouterCustomIdentitySnapshotV1 =
  createRouterCustomIdentitySnapshotReaderV1();

export async function readFinalizedRouterCustomIdentitySnapshotCoreV1(
  options: RouterCustomReadOptionsV1 = {},
) {
  return await readProductionRouterCustomIdentitySnapshotV1(options);
}

/** The core owns freshness, its shared cache, and the saved-identity fallback. */
export async function readWebsiteRouterCustomIdentitySnapshotV1(
  dependencies: Readonly<{
    refresh?: () => Promise<RouterCustomIdentitySnapshotV1>;
  }> = {},
) {
  const refresh = dependencies.refresh ?? readFinalizedRouterCustomIdentitySnapshotCoreV1;
  // Saved bytes are deliberately parsed as last-known-good, even when recently
  // written. Reading them first would bypass a successful current observation.
  return refresh();
}

export async function readFinalizedRouterCustomIdentitySnapshotV1(
  options: RouterCustomReadOptionsV1 = {},
) {
  const snapshot = await readFinalizedRouterCustomIdentitySnapshotCoreV1(
    options,
  );
  const metadataEnriched =
    await enrichRouterCustomSnapshotWithFinalizedMetadataV1(snapshot);
  // Fee policy evidence is deliberately derived after the durable identity
  // commitment. A fee-provider failure can therefore remove only the optional
  // evidence block; it can never hide a finalized Router identity.
  return await enrichRouterCustomSnapshotWithFeePolicyV2(metadataEnriched);
}

export async function readFinalizedRouterCustomExploreEntriesV1(
  options: RouterCustomReadOptionsV1 = {},
) {
  return (await readFinalizedRouterCustomIdentitySnapshotV1(options)).entries;
}

export function routerCustomEntriesAtOrBeforeBlockV1(
  entries: readonly CanonicalTokenExploreEntry[],
  blockNumber: string,
) {
  const boundary = BigInt(blockNumber);
  return Object.freeze(
    entries.filter((entry) => {
      requireRouterCustomEntryV1(entry);
      return BigInt(entry.launchStampProvenance!.blockNumber) <= boundary;
    }),
  );
}

function requireRouterCustomEntryV1(entry: CanonicalTokenExploreEntry) {
  if (
    entry.exploreKind !== "token" ||
    entry.launchModel !== "custom-graph" ||
    entry.launchCategoryProvenance.category !== "custom" ||
    entry.launchCategoryProvenance.source !== ROUTER_CUSTOM_LAUNCH_SOURCE ||
    entry.launchStampProvenance?.kind !== "custom-graph"
  ) {
    throw new Error("Router Custom public entry has invalid provenance");
  }
}

export function mergeRouterCustomExploreEntriesV1(
  existing: readonly ExploreEntry[],
  routerEntries: readonly CanonicalTokenExploreEntry[],
) {
  const projects = existing.filter(
    (entry) => entry.exploreKind === "custom-project",
  );
  const retainedProjects = new Set(
    suppressRouterBoundCustomProjectDuplicates(routerEntries, projects)
      .map((project) => project.id),
  );
  const retainedExisting = existing.filter(
    (entry) => entry.exploreKind !== "custom-project" ||
      retainedProjects.has(entry.id),
  );
  const ids = new Set(retainedExisting.map((entry) => entry.id));
  const tokenAddresses = new Set(
    retainedExisting.flatMap((entry) =>
      entry.tokenAddress ? [entry.tokenAddress.toLowerCase()] : [],
    ),
  );
  const additions: CanonicalTokenExploreEntry[] = [];

  for (const entry of routerEntries) {
    requireRouterCustomEntryV1(entry);
    const tokenAddress = entry.tokenAddress.toLowerCase();
    if (ids.has(entry.id) || tokenAddresses.has(tokenAddress)) continue;
    ids.add(entry.id);
    tokenAddresses.add(tokenAddress);
    additions.push(entry);
  }

  return Object.freeze([...retainedExisting, ...additions]);
}

export function publicLaunchSourceV1(input: Readonly<{
  envioAvailable?: boolean;
  registryCustomCurrent: boolean;
  routerCustomCurrent: boolean;
}>): PublicLaunchSourceV1 {
  if (input.envioAvailable === false) {
    if (input.registryCustomCurrent && input.routerCustomCurrent) {
      return "registry.custom-launched+canonical-launch-stamp-router";
    }
    if (input.registryCustomCurrent) return "registry.custom-launched";
    if (input.routerCustomCurrent) return "canonical-launch-stamp-router";
  }
  if (input.registryCustomCurrent && input.routerCustomCurrent) {
    return "envio-classic-v3+registry.custom-launched+canonical-launch-stamp-router";
  }
  if (input.registryCustomCurrent) {
    return "envio-classic-v3+registry.custom-launched";
  }
  if (input.routerCustomCurrent) {
    return "envio-classic-v3+canonical-launch-stamp-router";
  }
  return "envio-classic-v3";
}

export function mergeRouterCustomCreatorProfileV1(
  profile: CreatorProfile,
  account: `0x${string}`,
  routerEntries: readonly CanonicalTokenExploreEntry[],
  routerSnapshot?: RouterCustomIdentitySnapshotV1,
): CreatorProfile {
  if (profile.status !== "ready" || profile.snapshot?.chainId !== 1) {
    return profile;
  }

  const profileBlock = BigInt(profile.snapshot.blockNumber);
  const snapshotBlock = BigInt(
    routerSnapshot?.asOfBlock ?? profile.snapshot.blockNumber,
  );
  const tokenAddresses = new Set(
    profile.tokens.map((token) => token.tokenAddress.toLowerCase()),
  );
  const additions = routerEntries.filter((entry) => {
    requireRouterCustomEntryV1(entry);
    const stamp = entry.launchStampProvenance!;
    const tokenAddress = entry.tokenAddress.toLowerCase();
    if (
      entry.creatorAddress?.toLowerCase() !== account.toLowerCase() ||
      BigInt(stamp.blockNumber) > snapshotBlock ||
      tokenAddresses.has(tokenAddress)
    ) {
      return false;
    }
    tokenAddresses.add(tokenAddress);
    return true;
  });

  if (additions.length === 0) return profile;
  const snapshot = routerSnapshot !== undefined && snapshotBlock > profileBlock
    ? {
        chainId: 1,
        blockNumber: routerSnapshot.asOfBlock,
        blockHash: routerSnapshot.asOfBlockHash,
        confirmations: routerSnapshot.finalityConfirmations,
      }
    : profile.snapshot;
  return {
    ...profile,
    tokens: [...profile.tokens, ...additions],
    snapshot,
  };
}
