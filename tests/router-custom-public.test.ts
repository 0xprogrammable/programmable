import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  blobGet: vi.fn(),
  blobPut: vi.fn(),
  readAlchemyExploreModel: vi.fn(),
  readAlchemyRouterCustomIdentitySourceV1: vi.fn(),
  enrichRouterCustomSnapshotWithFinalizedMetadataV1: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  get: mocks.blobGet,
  put: mocks.blobPut,
}));

vi.mock("../lib/alchemy/explore.server", () => ({
  readAlchemyExploreModel: mocks.readAlchemyExploreModel,
  readAlchemyRouterCustomIdentitySourceV1:
    mocks.readAlchemyRouterCustomIdentitySourceV1,
}));

vi.mock(
  "../lib/server/custom-launch/finalized-custom-launch-metadata-feed-v1",
  () => ({
    enrichRouterCustomSnapshotWithFinalizedMetadataV1:
      mocks.enrichRouterCustomSnapshotWithFinalizedMetadataV1,
  }),
);

import {
  assertBoundedRouterCustomSnapshotBlobSizeV1,
  createRouterCustomIdentitySnapshotReaderV1,
  mergeRouterCustomCreatorProfileV1,
  mergeRouterCustomExploreEntriesV1,
  normalizeRouterCustomSnapshotBlobEtagV1,
  persistRouterCustomIdentitySnapshotFromSourceV1,
  publicLaunchSourceV1,
  readFinalizedRouterCustomExploreEntriesV1,
  readSavedRouterCustomIdentitySnapshotV1,
  readWebsiteRouterCustomIdentitySnapshotV1,
  ROUTER_CUSTOM_SNAPSHOT_CACHE_TTL_MS,
  ROUTER_CUSTOM_SNAPSHOT_MAX_IDENTITIES,
  routerCustomSnapshotPreservesFinalizedIdentitiesV1,
  routerCustomEntriesAtOrBeforeBlockV1,
  routerCustomExploreEntriesFromModelV1,
  routerCustomIdentitySnapshotFromSourceV1,
} from "../lib/alchemy/router-custom-public.server";
import {
  LAUNCH_STAMP_ROUTER_BINDING,
} from "../lib/alchemy/launch-registry.server";
import type { CreatorProfile, ExploreReadModel } from "../lib/onchain/types";
import { mapCreatorProfileResponse } from "../lib/profile/onchain-profile";
import type {
  CustomProjectExploreEntry,
  ExploreEntry,
  LauncherToken,
} from "../lib/tokens";
import {
  customGraphExploreEntry,
  customGraphToken,
  launchStampProvenance,
  stampedClassicToken,
} from "./launch-stamp-surface-fixture";

function model(tokens = [customGraphToken, stampedClassicToken]) {
  return {
    status: "ready",
    tokens: [...tokens],
    snapshot: {
      chainId: 1,
      blockNumber: "25740000",
      blockHash: `0x${"ab".repeat(32)}`,
      confirmations: 64,
    },
    creatorClaims: [],
    launcherFeesAccruedWei: "0",
    launcherFeesAccruedEth: "0",
  } satisfies ExploreReadModel;
}

function source(
  tokens: readonly LauncherToken[] = [customGraphToken, stampedClassicToken],
  input: Readonly<{
    blockNumber?: string;
    blockHash?: `0x${string}`;
    generatedAt?: string;
  }> = {},
) {
  return {
    generatedAt: input.generatedAt ?? "2026-08-25T06:00:00.000Z",
    status: "current" as const,
    reorgDetected: false,
    slice: {
      schemaVersion: "programmable-launch-stamp-router-registry-v1" as const,
      binding: LAUNCH_STAMP_ROUTER_BINDING,
      cursor: {
        blockNumber: input.blockNumber ?? "25740001",
        blockHash: input.blockHash ?? `0x${"bc".repeat(32)}`,
      },
      tokens,
    },
  };
}

function registryProject(poolId = customGraphExploreEntry.poolId) {
  return {
    exploreKind: "custom-project",
    id: `custom:sha256:${"91".repeat(32)}`,
    chainId: "1",
    tokenAddress: customGraphExploreEntry.tokenAddress,
    markets: [{ poolId }],
  } as unknown as CustomProjectExploreEntry;
}

function profile(blockNumber = "25740000"): CreatorProfile {
  return {
    status: "ready",
    account: customGraphExploreEntry.creatorAddress!,
    tokens: [],
    pools: [],
    claims: [],
    totals: {
      claimableWei: "0",
      claimableEth: "0",
      generatedWei: "0",
      generatedEth: "0",
      claimedWei: "0",
      claimedEth: "0",
    },
    snapshot: {
      chainId: 1,
      blockNumber,
      blockHash: `0x${"ac".repeat(32)}`,
      confirmations: 12,
    },
  };
}

describe("finalized Router Custom public projection", () => {
  it("reads saved identities without invoking the updater or writing storage", async () => {
    const snapshot = routerCustomIdentitySnapshotFromSourceV1(source());
    const body = JSON.stringify({ schemaVersion: "programmable.router-custom-identity-snapshot-envelope.v1",
      binding: LAUNCH_STAMP_ROUTER_BINDING, snapshot });
    mocks.blobGet.mockResolvedValue({ statusCode: 200, stream: new Response(body).body,
      blob: { size: Buffer.byteLength(body), etag: `"${"ab".repeat(16)}"` } });
    vi.stubEnv("OPS_BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
    const result = await readSavedRouterCustomIdentitySnapshotV1();
    expect(result.entries).toEqual(snapshot.entries);
    expect(result.status).toBe("last-known-good");
    expect(mocks.readAlchemyRouterCustomIdentitySourceV1).not.toHaveBeenCalled();
    expect(mocks.blobPut).not.toHaveBeenCalled();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    mocks.readAlchemyExploreModel.mockResolvedValue(model());
    mocks.readAlchemyRouterCustomIdentitySourceV1.mockResolvedValue(source());
    mocks.enrichRouterCustomSnapshotWithFinalizedMetadataV1
      .mockImplementation(async (snapshot) => snapshot);
  });

  it("does not downgrade a current website observation because saved bytes were recently written", async () => {
    const current = source(undefined, { generatedAt: new Date().toISOString() });
    const snapshot = routerCustomIdentitySnapshotFromSourceV1(current);
    const body = JSON.stringify({ schemaVersion: "programmable.router-custom-identity-snapshot-envelope.v1",
      binding: LAUNCH_STAMP_ROUTER_BINDING, snapshot });
    mocks.blobGet.mockResolvedValue({ statusCode: 200, stream: new Response(body).body,
      blob: { size: Buffer.byteLength(body), etag: `"${"ab".repeat(16)}"` } });
    vi.stubEnv("OPS_BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
    const readCurrentSource = vi.fn().mockResolvedValue(current);
    const refresh = createRouterCustomIdentitySnapshotReaderV1({
      readCurrentSource,
      readDurableSnapshot: vi.fn().mockResolvedValue({ ...snapshot, status: "last-known-good" }),
      persistDurableSnapshot: vi.fn().mockResolvedValue(undefined),
    });

    await expect(readWebsiteRouterCustomIdentitySnapshotV1({ refresh })).resolves.toMatchObject({
      status: "current", identityCommitment: snapshot.identityCommitment,
    });
    await expect(readWebsiteRouterCustomIdentitySnapshotV1({ refresh })).resolves.toMatchObject({ status: "current" });
    expect(readCurrentSource).toHaveBeenCalledOnce();
  });

  it("keeps saved website identities marked last-known-good when the current provider fails", async () => {
    const snapshot = routerCustomIdentitySnapshotFromSourceV1(source(undefined, {
      generatedAt: new Date().toISOString(),
    }));
    const refresh = createRouterCustomIdentitySnapshotReaderV1({
      readCurrentSource: vi.fn().mockRejectedValue(new Error("provider unavailable")),
      readDurableSnapshot: vi.fn().mockResolvedValue(snapshot),
      persistDurableSnapshot: vi.fn().mockResolvedValue(undefined),
    });
    await expect(readWebsiteRouterCustomIdentitySnapshotV1({ refresh })).resolves.toMatchObject({
      status: "last-known-good", identityCommitment: snapshot.identityCommitment,
    });
  });

  it("does not swallow website refresh conflicts", async () => {
    const refresh = vi.fn().mockRejectedValue(new Error("snapshot identity conflict"));
    await expect(readWebsiteRouterCustomIdentitySnapshotV1({ refresh })).rejects.toThrow("snapshot identity conflict");
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("projects only fully verified Custom Graph stamps", async () => {
    expect(routerCustomExploreEntriesFromModelV1(model())).toEqual([
      customGraphExploreEntry,
    ]);
    await expect(readFinalizedRouterCustomExploreEntriesV1()).resolves.toEqual([
      customGraphExploreEntry,
    ]);
    expect(
      mocks.enrichRouterCustomSnapshotWithFinalizedMetadataV1,
    ).toHaveBeenCalledOnce();
  });

  it("owns the exact Router cursor independently of the Classic snapshot", () => {
    const snapshot = routerCustomIdentitySnapshotFromSourceV1(source());

    expect(snapshot).toMatchObject({
      status: "current",
      asOfBlock: "25740001",
      asOfBlockHash: `0x${"bc".repeat(32)}`,
      entries: [customGraphExploreEntry],
    });
    expect(snapshot.identityCommitment).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("publishes an identity as soon as its launch enters the 64-confirmation cursor", () => {
    const snapshot = routerCustomIdentitySnapshotFromSourceV1(source(
      [customGraphToken],
      {
        blockNumber: launchStampProvenance.blockNumber,
        blockHash: launchStampProvenance.blockHash,
      },
    ));

    expect(BigInt(launchStampProvenance.finalizedAtBlockNumber)).toBe(
      BigInt(launchStampProvenance.blockNumber) + 64n,
    );
    expect(snapshot).toMatchObject({
      asOfBlock: launchStampProvenance.blockNumber,
      entries: [customGraphExploreEntry],
    });
  });

  it("preserves the Blob API strong ETag contract for conditional writes", () => {
    expect(normalizeRouterCustomSnapshotBlobEtagV1(
      'W/"8e8ed5b7c65cfe481ae32dc684e98710"',
    )).toBe('"8e8ed5b7c65cfe481ae32dc684e98710"');
    expect(() => normalizeRouterCustomSnapshotBlobEtagV1(
      "8e8ed5b7c65cfe481ae32dc684e98710",
    )).toThrow("ETag is invalid");
  });

  it("bounds private Blob streams when the provider omits their declared size", () => {
    expect(() => assertBoundedRouterCustomSnapshotBlobSizeV1(
      0,
      11_499,
    )).not.toThrow();
    expect(() => assertBoundedRouterCustomSnapshotBlobSizeV1(
      11_499,
      11_499,
    )).not.toThrow();
    expect(() => assertBoundedRouterCustomSnapshotBlobSizeV1(
      0,
      0,
    )).toThrow("snapshot size is invalid");
    expect(() => assertBoundedRouterCustomSnapshotBlobSizeV1(
      -1,
      11_499,
    )).toThrow("snapshot size is invalid");
  });

  it("keeps finalized identities as last-known-good across a long outage", async () => {
    const startedAt = Date.parse("2026-08-25T06:00:00.000Z");
    let now = startedAt;
    const currentFailure = new Error("Router provider unavailable");
    const readCurrentSource = vi.fn()
      .mockResolvedValueOnce(source())
      .mockRejectedValue(currentFailure);
    const reader = createRouterCustomIdentitySnapshotReaderV1({
      now: () => now,
      readCurrentSource,
      readDurableSnapshot: vi.fn().mockRejectedValue(
        new Error("Durable snapshot unavailable"),
      ),
      persistDurableSnapshot: vi.fn().mockResolvedValue(undefined),
    });

    await expect(reader()).resolves.toMatchObject({ status: "current" });
    now = startedAt + ROUTER_CUSTOM_SNAPSHOT_CACHE_TTL_MS + 1;
    await expect(reader()).resolves.toMatchObject({
      status: "last-known-good",
      entries: [customGraphExploreEntry],
    });
    now = startedAt + 30 * 24 * 60 * 60_000;
    await expect(reader()).resolves.toMatchObject({
      status: "last-known-good",
      entries: [customGraphExploreEntry],
    });
  });

  it("uses an older durable Router snapshot on a cold provider failure", async () => {
    const now = Date.parse("2026-08-25T06:00:00.000Z");
    const durable = routerCustomIdentitySnapshotFromSourceV1(source(
      undefined,
      { generatedAt: "2026-07-01T05:59:59.000Z" },
    ));
    const reader = createRouterCustomIdentitySnapshotReaderV1({
      now: () => now,
      readCurrentSource: vi.fn().mockRejectedValue(
        new Error("Router provider unavailable"),
      ),
      readDurableSnapshot: vi.fn().mockResolvedValue(durable),
      persistDurableSnapshot: vi.fn().mockResolvedValue(undefined),
    });

    await expect(reader()).resolves.toMatchObject({
      status: "last-known-good",
      generatedAt: "2026-07-01T05:59:59.000Z",
      entries: [customGraphExploreEntry],
    });
  });

  it("keeps a newer durable snapshot during cross-commit catch-up", async () => {
    const durable = routerCustomIdentitySnapshotFromSourceV1(source());
    const behind = {
      ...source([], {
        blockNumber: "25718016",
        blockHash: `0x${"ad".repeat(32)}`,
      }),
      status: "last-known-good" as const,
    };
    const persistDurableSnapshot = vi.fn().mockResolvedValue(undefined);
    const reader = createRouterCustomIdentitySnapshotReaderV1({
      now: () => Date.parse("2026-08-25T06:01:00.000Z"),
      readCurrentSource: vi.fn().mockResolvedValue(behind),
      readDurableSnapshot: vi.fn().mockResolvedValue(durable),
      persistDurableSnapshot,
    });

    await expect(reader()).resolves.toMatchObject({
      status: "last-known-good",
      asOfBlock: "25740001",
      entries: [customGraphExploreEntry],
    });
    expect(persistDurableSnapshot).not.toHaveBeenCalled();
  });

  it("does not regress to a lagging provider that reports itself current", async () => {
    const durable = routerCustomIdentitySnapshotFromSourceV1(source());
    const lagging = source([], {
      blockNumber: "25718016",
      blockHash: `0x${"ad".repeat(32)}`,
    });
    const persistDurableSnapshot = vi.fn().mockResolvedValue(undefined);
    const reader = createRouterCustomIdentitySnapshotReaderV1({
      now: () => Date.parse("2026-08-25T06:01:00.000Z"),
      readCurrentSource: vi.fn().mockResolvedValue(lagging),
      readDurableSnapshot: vi.fn().mockResolvedValue(durable),
      persistDurableSnapshot,
    });

    await expect(reader()).resolves.toMatchObject({
      status: "last-known-good",
      asOfBlock: "25740001",
      entries: [customGraphExploreEntry],
    });
    expect(persistDurableSnapshot).not.toHaveBeenCalled();
  });

  it("keeps current status when the durable snapshot matches exactly", async () => {
    const current = source();
    const durable = routerCustomIdentitySnapshotFromSourceV1(current);
    const reader = createRouterCustomIdentitySnapshotReaderV1({
      now: () => Date.parse("2026-08-25T06:01:00.000Z"),
      readCurrentSource: vi.fn().mockResolvedValue(current),
      readDurableSnapshot: vi.fn().mockResolvedValue(durable),
      persistDurableSnapshot: vi.fn().mockResolvedValue(undefined),
    });

    await expect(reader()).resolves.toMatchObject({
      status: "current",
      asOfBlock: "25740001",
      entries: [customGraphExploreEntry],
    });
  });

  it("keeps one durable boundary when only finality observation fields drift", async () => {
    const durable = routerCustomIdentitySnapshotFromSourceV1(source());
    const reobservedSource = source([
      {
        ...customGraphToken,
        launchStampProvenance: {
          ...customGraphToken.launchStampProvenance!,
          finalizedAtBlockNumber: "25740123",
          finalizedAtBlockHash: `0x${"df".repeat(32)}` as `0x${string}`,
        },
      },
      stampedClassicToken,
    ]);
    const reobserved = routerCustomIdentitySnapshotFromSourceV1(
      reobservedSource,
    );
    const persistDurableSnapshot = vi.fn().mockResolvedValue(undefined);
    const reader = createRouterCustomIdentitySnapshotReaderV1({
      now: () => Date.parse("2026-08-25T06:01:00.000Z"),
      readCurrentSource: vi.fn().mockResolvedValue(reobservedSource),
      readDurableSnapshot: vi.fn().mockResolvedValue(durable),
      persistDurableSnapshot,
    });

    expect(reobserved.identityCommitment).not.toBe(durable.identityCommitment);
    expect(routerCustomSnapshotPreservesFinalizedIdentitiesV1(
      durable,
      reobserved,
    )).toBe(true);
    expect(routerCustomSnapshotPreservesFinalizedIdentitiesV1(
      reobserved,
      durable,
    )).toBe(true);
    await expect(reader()).resolves.toMatchObject({
      status: "last-known-good",
      identityCommitment: durable.identityCommitment,
      entries: [customGraphExploreEntry],
    });
    expect(persistDurableSnapshot).not.toHaveBeenCalled();
  });

  it("does not overwrite the durable Blob for observation-only same-block drift", async () => {
    const durable = routerCustomIdentitySnapshotFromSourceV1(source());
    const reobservedSource = source([
      {
        ...customGraphToken,
        launchStampProvenance: {
          ...customGraphToken.launchStampProvenance!,
          finalizedAtBlockNumber: "25740123",
          finalizedAtBlockHash: `0x${"df".repeat(32)}` as `0x${string}`,
        },
      },
      stampedClassicToken,
    ]);
    const body = JSON.stringify({
      schemaVersion:
        "programmable.router-custom-identity-snapshot-envelope.v1",
      binding: LAUNCH_STAMP_ROUTER_BINDING,
      snapshot: durable,
    });
    mocks.blobGet.mockResolvedValue({
      statusCode: 200,
      stream: new Response(body).body,
      blob: {
        size: Buffer.byteLength(body, "utf8"),
        etag: `W/"${"ab".repeat(16)}"`,
      },
    });
    vi.stubEnv("OPS_BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");

    await expect(
      persistRouterCustomIdentitySnapshotFromSourceV1(reobservedSource),
    ).resolves.toMatchObject({
      asOfBlock: durable.asOfBlock,
    });
    expect(mocks.blobGet).toHaveBeenCalledOnce();
    expect(mocks.blobPut).not.toHaveBeenCalled();
  });

  it("accepts a newer boundary only when every finalized identity is unchanged", () => {
    const durable = routerCustomIdentitySnapshotFromSourceV1(source());
    const next = routerCustomIdentitySnapshotFromSourceV1(source(undefined, {
      blockNumber: "25740100",
      blockHash: `0x${"bd".repeat(32)}`,
      generatedAt: "2026-08-25T06:01:00.000Z",
    }));
    const rewritten = {
      ...next,
      entries: [{
        ...next.entries[0],
        launchStampProvenance: {
          ...next.entries[0]!.launchStampProvenance!,
          routePayloadHash: `0x${"de".repeat(32)}` as `0x${string}`,
        },
      }],
    };
    const rehydrated = routerCustomIdentitySnapshotFromSourceV1(source([
      {
        ...customGraphToken,
        launchStampProvenance: {
          ...customGraphToken.launchStampProvenance!,
          finalizedAtBlockNumber: "25740099",
          finalizedAtBlockHash: `0x${"df".repeat(32)}` as `0x${string}`,
        },
      },
      stampedClassicToken,
    ], {
      blockNumber: "25740100",
      blockHash: `0x${"bd".repeat(32)}`,
      generatedAt: "2026-08-25T06:01:00.000Z",
    }));

    expect(routerCustomSnapshotPreservesFinalizedIdentitiesV1(
      durable,
      next,
    )).toBe(true);
    expect(routerCustomSnapshotPreservesFinalizedIdentitiesV1(
      durable,
      { ...next, entries: [] },
    )).toBe(false);
    expect(routerCustomSnapshotPreservesFinalizedIdentitiesV1(
      durable,
      rewritten,
    )).toBe(false);
    expect(routerCustomSnapshotPreservesFinalizedIdentitiesV1(
      durable,
      rehydrated,
    )).toBe(true);
  });

  it("serves the durable LKG instead of accepting a newer shrinking snapshot", async () => {
    const durable = routerCustomIdentitySnapshotFromSourceV1(source());
    const shrinking = source([], {
      blockNumber: "25740100",
      blockHash: `0x${"bd".repeat(32)}`,
      generatedAt: "2026-08-25T06:01:00.000Z",
    });
    const persistDurableSnapshot = vi.fn().mockResolvedValue(undefined);
    const reader = createRouterCustomIdentitySnapshotReaderV1({
      now: () => Date.parse("2026-08-25T06:02:00.000Z"),
      readCurrentSource: vi.fn().mockResolvedValue(shrinking),
      readDurableSnapshot: vi.fn().mockResolvedValue(durable),
      persistDurableSnapshot,
    });

    await expect(reader()).resolves.toMatchObject({
      status: "last-known-good",
      asOfBlock: "25740001",
      entries: [customGraphExploreEntry],
    });
    expect(persistDurableSnapshot).not.toHaveBeenCalled();
  });

  it("does not replace a warm finalized identity with a newer shrinking durable snapshot", async () => {
    const startedAt = Date.parse("2026-08-25T06:01:00.000Z");
    let now = startedAt;
    const current = source();
    const shrinkingDurable = routerCustomIdentitySnapshotFromSourceV1(source(
      [],
      {
        blockNumber: "25740100",
        blockHash: `0x${"bd".repeat(32)}`,
        generatedAt: "2026-08-25T06:01:30.000Z",
      },
    ));
    const advancedCurrent = source(undefined, {
      blockNumber: "25740200",
      blockHash: `0x${"be".repeat(32)}`,
      generatedAt: "2026-08-25T06:02:00.000Z",
    });
    const reader = createRouterCustomIdentitySnapshotReaderV1({
      now: () => now,
      readCurrentSource: vi.fn()
        .mockResolvedValueOnce(current)
        .mockResolvedValueOnce(advancedCurrent),
      readDurableSnapshot: vi.fn()
        .mockRejectedValueOnce(new Error("missing"))
        .mockResolvedValueOnce(shrinkingDurable),
      persistDurableSnapshot: vi.fn().mockResolvedValue(undefined),
    });

    await expect(reader()).resolves.toMatchObject({
      status: "current",
      entries: [customGraphExploreEntry],
    });
    now += ROUTER_CUSTOM_SNAPSHOT_CACHE_TTL_MS + 1;
    await expect(reader()).resolves.toMatchObject({
      status: "current",
      asOfBlock: "25740200",
      entries: [customGraphExploreEntry],
    });
  });

  it("fails closed on a warm-cache same-boundary conflict", async () => {
    const startedAt = Date.parse("2026-08-25T06:01:00.000Z");
    let now = startedAt;
    const first = source();
    const durable = routerCustomIdentitySnapshotFromSourceV1(first);
    const conflicting = source([], {
      blockNumber: "25740001",
      blockHash: `0x${"bc".repeat(32)}`,
    });
    const reader = createRouterCustomIdentitySnapshotReaderV1({
      now: () => now,
      readCurrentSource: vi.fn()
        .mockResolvedValueOnce(first)
        .mockResolvedValueOnce(conflicting),
      readDurableSnapshot: vi.fn()
        .mockRejectedValueOnce(new Error("missing"))
        .mockResolvedValueOnce(durable),
      persistDurableSnapshot: vi.fn().mockResolvedValue(undefined),
    });

    await expect(reader()).resolves.toMatchObject({ status: "current" });
    now += ROUTER_CUSTOM_SNAPSHOT_CACHE_TTL_MS + 1;
    await expect(reader()).rejects.toThrow(
      "snapshots conflict at one boundary",
    );
  });

  it("does not delete finalized durable identities after an explicit Router reorg", async () => {
    const durable = routerCustomIdentitySnapshotFromSourceV1(source());
    const rebuilt = {
      ...source([], {
        blockNumber: "25718016",
        blockHash: `0x${"ad".repeat(32)}`,
      }),
      status: "last-known-good" as const,
      reorgDetected: true,
    };
    const persistDurableSnapshot = vi.fn().mockResolvedValue(undefined);
    const reader = createRouterCustomIdentitySnapshotReaderV1({
      now: () => Date.parse("2026-08-25T06:01:00.000Z"),
      readCurrentSource: vi.fn().mockResolvedValue(rebuilt),
      readDurableSnapshot: vi.fn().mockResolvedValue(durable),
      persistDurableSnapshot,
    });

    await expect(reader()).resolves.toMatchObject({
      status: "last-known-good",
      asOfBlock: "25740001",
      entries: [customGraphExploreEntry],
    });
    expect(persistDurableSnapshot).not.toHaveBeenCalled();
  });

  it("falls back durably when the cold current read never settles", async () => {
    const durable = routerCustomIdentitySnapshotFromSourceV1(source());
    const reader = createRouterCustomIdentitySnapshotReaderV1({
      now: () => Date.parse("2026-08-25T06:01:00.000Z"),
      currentReadTimeoutMs: 10,
      readCurrentSource: vi.fn(() => new Promise<never>(() => undefined)),
      readDurableSnapshot: vi.fn().mockResolvedValue(durable),
      persistDurableSnapshot: vi.fn().mockResolvedValue(undefined),
    });

    await expect(reader()).resolves.toMatchObject({
      status: "last-known-good",
      entries: [customGraphExploreEntry],
    });
  });

  it("does not substitute a Classic cursor for an empty Router cursor", () => {
    const snapshot = routerCustomIdentitySnapshotFromSourceV1(source([], {
      blockNumber: "25718016",
      blockHash: `0x${"ad".repeat(32)}`,
    }));

    expect(snapshot).toMatchObject({
      asOfBlock: "25718016",
      asOfBlockHash: `0x${"ad".repeat(32)}`,
      entries: [],
    });
  });

  it("bounds the durable Router identity set", () => {
    expect(() => routerCustomIdentitySnapshotFromSourceV1(source(
      Array.from(
        { length: ROUTER_CUSTOM_SNAPSHOT_MAX_IDENTITIES + 1 },
        () => customGraphToken,
      ),
    ))).toThrow("exceeds its bound");
  });

  it("rejects a non-ready Router model", () => {
    expect(() => routerCustomExploreEntriesFromModelV1({
      status: "not-deployed",
      tokens: [],
      snapshot: null,
      creatorClaims: [],
      launcherFeesAccruedWei: "0",
      launcherFeesAccruedEth: "0",
    })).toThrow("not ready");
  });

  it("projects only Router launches at or before the consumer snapshot", () => {
    expect(routerCustomEntriesAtOrBeforeBlockV1(
      [customGraphExploreEntry],
      "25717952",
    )).toEqual([]);
    expect(routerCustomEntriesAtOrBeforeBlockV1(
      [customGraphExploreEntry],
      "25717953",
    )).toEqual([customGraphExploreEntry]);
  });

  it("replaces an exact Registry token-and-pool duplicate with Router provenance", () => {
    expect(mergeRouterCustomExploreEntriesV1(
      [registryProject()],
      [customGraphExploreEntry],
    )).toEqual([customGraphExploreEntry]);
  });

  it("fails closed when Registry and Router disagree on the token pool", () => {
    expect(() => mergeRouterCustomExploreEntriesV1(
      [registryProject(`0x${"92".repeat(32)}`)],
      [customGraphExploreEntry],
    )).toThrow("disagree on token pool binding");
  });

  it("does not replace an existing Envio token identity", () => {
    const envioEntry = {
      ...customGraphExploreEntry,
      id: "1:envio-existing",
      launchModel: "classic",
      launchModelVersion: "classic-v3",
      totalSwapFeeBps: 100,
      liquidityPath: "meme",
      launchStampProvenance: undefined,
      launchCategoryProvenance: {
        schemaVersion: "programmable.explore-launch-category-provenance.v1",
        category: "classic",
        source: "canonical-launch-read-model",
        recordId: "1:envio-existing",
        modelId: "classic",
        modelVersion: "classic-v3",
      },
    } as unknown as ExploreEntry;

    expect(mergeRouterCustomExploreEntriesV1(
      [envioEntry],
      [customGraphExploreEntry],
    )).toEqual([envioEntry]);
  });

  it("adds only wallet-owned, snapshot-safe tokens to Profile", () => {
    const merged = mergeRouterCustomCreatorProfileV1(
      profile(),
      customGraphExploreEntry.creatorAddress!,
      [customGraphExploreEntry],
    );
    expect(merged.tokens).toEqual([customGraphExploreEntry]);
    expect(merged.pools).toEqual([]);
    expect(merged.claims).toEqual([]);
    expect(mapCreatorProfileResponse(
      merged,
      customGraphExploreEntry.creatorAddress!,
    ).tokens).toEqual([
      expect.objectContaining({
        address: customGraphExploreEntry.tokenAddress,
        launchModel: "custom-graph",
        launchProvenance: "canonical-router",
      }),
    ]);
    expect(mergeRouterCustomCreatorProfileV1(
      profile("25717952"),
      customGraphExploreEntry.creatorAddress!,
      [customGraphExploreEntry],
    ).tokens).toEqual([]);
    expect(mergeRouterCustomCreatorProfileV1(
      profile("25717953"),
      customGraphExploreEntry.creatorAddress!,
      [customGraphExploreEntry],
    ).tokens).toEqual([customGraphExploreEntry]);
  });

  it("reports the exact set of healthy public identity lanes", () => {
    expect(publicLaunchSourceV1({
      envioAvailable: false,
      registryCustomCurrent: false,
      routerCustomCurrent: true,
    })).toBe("canonical-launch-stamp-router");
    expect(publicLaunchSourceV1({
      registryCustomCurrent: false,
      routerCustomCurrent: false,
    })).toBe("envio-classic-v3");
    expect(publicLaunchSourceV1({
      registryCustomCurrent: true,
      routerCustomCurrent: false,
    })).toBe("envio-classic-v3+registry.custom-launched");
    expect(publicLaunchSourceV1({
      registryCustomCurrent: false,
      routerCustomCurrent: true,
    })).toBe("envio-classic-v3+canonical-launch-stamp-router");
    expect(publicLaunchSourceV1({
      registryCustomCurrent: true,
      routerCustomCurrent: true,
    })).toBe(
      "envio-classic-v3+registry.custom-launched+canonical-launch-stamp-router",
    );
  });
});
