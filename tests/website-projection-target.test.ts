import { readFile } from "node:fs/promises";
import { generateKeyPairSync, sign } from "node:crypto";
import { rootCertificates } from "node:tls";

import { PGlite } from "@electric-sql/pglite";
import { encodeAbiParameters, keccak256, type Address } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.setConfig({ testTimeout: 15_000 });

import { canonicalizeJson } from
  "../lib/server/projection-target/canonical-json";
import { runProjectionTargetConformanceSuiteV1 } from
  "../lib/server/projection-target/conformance";
import { createCustomLaunchProjectReadHandlersV2 } from
  "../lib/server/custom-launch/project-read-v2";
import { createRegistryCustomLaunchPublicReadHandlersV1 } from
  "../lib/server/custom-launch/registry-public-read-v1";
import {
  authenticateRegistryCustomLaunchProjectionV1,
  createRegistryCustomLaunchProjectionAuthenticatorV1,
  parseRegistryCustomLaunchPublicRecordV1,
  registryCustomLaunchSecurityBindingHashV1,
  type PostgresRegistryCustomLaunchPublicStoreV1,
} from
  "../lib/server/custom-launch/registry-public-store-v1";
import {
  createAuthenticatedWebsiteEntitlementReadHandlerV1,
  createPrivyGitHubPrincipalAuthenticatorFromBoundaryV1,
  type AuthenticatedGitHubPrincipalV1,
} from "../lib/server/projection-target/github-entitlement";
import {
  canonicalSha256,
  type Sha256Digest,
} from "../lib/server/projection-target/hashing";
import {
  parseAuthenticatedCustomLaunchProjectV2,
  type
  ProjectionTargetPostgresClientV1,
  ProjectionTargetPostgresPoolV1,
  ProjectionTargetPostgresQueryResultV1,
} from "../lib/server/projection-target/postgres-store";
import type {
  ProjectionTargetLaneConfigurationV1,
} from "../lib/server/projection-target/protocol";
import {
  createWebsiteProjectionTargetV1,
  assertProjectionTargetSecurityAttestationV1,
  assertProductionDatabaseLoginRoleV1,
  verifiedPostgresTlsConfigurationV1,
  type ProjectionTargetSecurityAttestationRowV1,
} from "../lib/server/projection-target/website-target";

const NOW = new Date("2026-08-05T12:00:00.000Z");
const GITHUB_USER_ID = "123456789";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const lanes = Object.freeze([
  lane("website.entitlement"),
  lane("website.custom-launched"),
] as const);

const databases: PGlite[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("Website projection target", () => {
  it("passes the vendored target-kit conformance suite with durable PostgreSQL storage", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const entitlement = entitlementWrite("conformance-entitlement");
    const launched = customLaunchWrite("conformance-launch");
    const report = await runProjectionTargetConformanceSuiteV1({
      subject: Object.freeze({
        request: (path: string, init: RequestInit) => {
          const headers = new Headers(init.headers);
          if (init.method === "GET" || init.method === "PUT") {
            const currentAuthorization = headers.get("authorization");
            if (!currentAuthorization?.includes("invalid-projection-target")) {
              headers.set("authorization", `Bearer ${tokenForConformanceRequest(
                path,
                init,
              )}`);
            }
          }
          return target.handler.handle(new Request(
            `https://website.invalid${path}`,
            { ...init, headers },
          ));
        },
      }),
      lanes,
      authorization: `Bearer ${"placeholder".repeat(4)}`,
      fixtures: [
        Object.freeze({
          lane: "website.entitlement" as const,
          canonicalWrite: canonicalizeJson(entitlement),
        }),
        Object.freeze({
          lane: "website.custom-launched" as const,
          canonicalWrite: canonicalizeJson(launched),
        }),
      ],
    });

    expect(report.passed).toBe(true);
    expect(report.checkedLanes).toEqual([
      "website.entitlement",
      "website.custom-launched",
    ]);
    expect(report.assertionCount).toBeGreaterThanOrEqual(24);
  });

  it("survives store recreation and returns the original byte-exact readback", async () => {
    const pool = await pglitePool();
    const firstTarget = targetFor(pool);
    const write = entitlementWrite("durable-restart");
    const token = workloadTokenForWrite(write, "durable-restart-put");
    const readToken = workloadTokenForRead(
      "website.entitlement",
      write.projectionKey,
      "durable-restart-get",
    );
    const path = route(write.projectionKey, "website.entitlement");
    const created = await firstTarget.handler.handle(new Request(
      `https://website.invalid${path}`,
      {
        method: "PUT",
        headers: writeHeaders(
          "website.entitlement",
          write.idempotencyKey,
          token,
        ),
        body: canonicalizeJson(write),
      },
    ));
    expect(created.status).toBe(201);
    const acknowledgement = await created.text();

    const recreatedTarget = targetFor(pool);
    const replay = await recreatedTarget.handler.handle(new Request(
      `https://website.invalid${path}`,
      {
        method: "PUT",
        headers: writeHeaders(
          "website.entitlement",
          write.idempotencyKey,
          token,
        ),
        body: canonicalizeJson(write),
      },
    ));
    expect(replay.status).toBe(200);
    await expect(replay.text()).resolves.toBe(acknowledgement);

    const readback = await recreatedTarget.handler.handle(new Request(
      `https://website.invalid${path}`,
      { headers: readHeaders("website.entitlement", readToken) },
    ));
    expect(readback.status).toBe(200);
    const value = JSON.parse(await readback.text()) as {
      projection: unknown;
    };
    expect(value.projection).toEqual(write.projection);
  });

  it("creates, replays, and reads with only the documented runtime grants", async () => {
    const pool = await pglitePool();
    const role = await pool.query<{ current_user: string }>(
      "SELECT current_user::text AS current_user",
    );
    expect(role.rows[0]?.current_user)
      .toBe("programmable_website_projection_runtime");

    const target = targetFor(pool);
    const write = entitlementWrite("least-privilege-runtime");
    const token = workloadTokenForWrite(write, "least-privilege-put");
    const readToken = workloadTokenForRead(
      write.topic,
      write.projectionKey,
      "least-privilege-get",
    );
    const url = `https://website.invalid${route(write.projectionKey, write.topic)}`;
    const request = () => new Request(url, {
      method: "PUT",
      headers: writeHeaders(write.topic, write.idempotencyKey, token),
      body: canonicalizeJson(write),
    });

    expect((await target.handler.handle(request())).status).toBe(201);
    expect((await target.handler.handle(request())).status).toBe(200);
    expect((await target.handler.handle(new Request(url, {
      headers: readHeaders(write.topic, readToken),
    }))).status).toBe(200);
    await expect(pool.query(`
      UPDATE programmable_website_projection_v1.projection_records
         SET audience = 'forbidden'
    `)).rejects.toThrow();
  });

  it("rejects forged workload credentials before persistence", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const write = entitlementWrite("forged-credential");
    const forged = workloadTokenForWrite(
      write,
      "forged-credential-put",
      "attacker-service",
    );
    const response = await target.handler.handle(new Request(
      `https://website.invalid${route(write.projectionKey, write.topic)}`,
      {
        method: "PUT",
        headers: writeHeaders(write.topic, write.idempotencyKey, forged),
        body: canonicalizeJson(write),
      },
    ));
    expect(response.status).toBe(401);

    const count = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
        FROM programmable_website_projection_v1.projection_records
    `);
    expect(count.rows[0]?.count).toBe("0");
  });

  it("rejects an invalid PUT credential before touching the request body", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const write = entitlementWrite("preflight-before-body");
    const request = new Request(
      `https://website.invalid${route(write.projectionKey, write.topic)}`,
      {
        method: "PUT",
        headers: writeHeaders(
          write.topic,
          write.idempotencyKey,
          "invalid-workload-credential",
        ),
        body: canonicalizeJson(write),
      },
    );
    const originalBody = request.body;
    let bodyAccesses = 0;
    Object.defineProperty(request, "body", {
      configurable: true,
      get() {
        bodyAccesses += 1;
        return originalBody;
      },
    });

    const response = await target.handler.handle(request);

    expect(response.status).toBe(401);
    expect(bodyAccesses).toBe(0);
    const counts = await pool.query<{ projections: string; credentials: string }>(`
      SELECT
        (SELECT count(*)::text
           FROM programmable_website_projection_v1.projection_records)
          AS projections,
        (SELECT count(*)::text
           FROM programmable_website_projection_v1.credential_uses)
          AS credentials
    `);
    expect(counts.rows[0]).toEqual({ projections: "0", credentials: "0" });
  });

  it("returns only the authenticated GitHub principal's active entitlement", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const write = entitlementWrite("authenticated-read");
    const token = workloadTokenForWrite(write, "authenticated-read-put");
    const writeResponse = await target.handler.handle(new Request(
      `https://website.invalid${route(write.projectionKey, write.topic)}`,
      {
        method: "PUT",
        headers: writeHeaders(write.topic, write.idempotencyKey, token),
        body: canonicalizeJson(write),
      },
    ));
    expect(writeResponse.status).toBe(201);

    const principal = githubPrincipal(GITHUB_USER_ID);
    const read = createAuthenticatedWebsiteEntitlementReadHandlerV1({
      authenticator: Object.freeze({
        async authenticate() { return principal; },
      }),
      store: target.store,
      now: () => NOW,
    });
    const response = await read(new Request(
      "https://website.invalid/api/custom-launch/entitlements",
      { headers: { accept: "application/json" } },
    ));
    expect(response.status).toBe(200);
    const payload = JSON.parse(await response.text()) as {
      launchAuthority: boolean;
      nextAction: string;
      subject: { githubUserId: string };
      entitlements: Array<{
        applicationId: string;
        status: string;
        action: string;
      }>;
    };
    expect(payload.launchAuthority).toBe(false);
    expect(payload.nextAction).toBe("request_launch_permit");
    expect(payload.subject.githubUserId).toBe(GITHUB_USER_ID);
    expect(payload.entitlements).toEqual([
      expect.objectContaining({
        applicationId: "application-authenticated-read",
        status: "launch_eligible",
        action: "request_launch_permit",
      }),
    ]);

    const otherPrincipal = githubPrincipal("987654321");
    const otherRead = createAuthenticatedWebsiteEntitlementReadHandlerV1({
      authenticator: Object.freeze({
        async authenticate() { return otherPrincipal; },
      }),
      store: target.store,
      now: () => NOW,
    });
    const other = await otherRead(new Request(
      "https://website.invalid/api/custom-launch/entitlements",
      { headers: { accept: "application/json" } },
    ));
    const otherPayload = JSON.parse(await other.text()) as {
      entitlements: unknown[];
      nextAction: string;
    };
    expect(otherPayload.entitlements).toEqual([]);
    expect(otherPayload.nextAction).toBe("wait_for_approved_submission");
  });

  it("rejects complete entitlement semantic failures before any durable write", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const invalidMutations = [
      (projection: Record<string, unknown>) => ({
        ...projection,
        launchCapabilityIds: [],
      }),
      (projection: Record<string, unknown>) => ({
        ...projection,
        launchCapabilityIds: Array.from({ length: 257 }, (_, index) => `cap-${index}`),
      }),
      (projection: Record<string, unknown>) => ({
        ...projection,
        launcherWallet: { namespace: "eip155:1", value: "" },
      }),
      (projection: Record<string, unknown>) => ({
        ...projection,
        decisionReceiptHash: "sha256:not-a-digest",
      }),
      (projection: Record<string, unknown>) => ({
        ...projection,
        revision: {
          ...(projection.revision as Record<string, unknown>),
          provider: "gitlab",
        },
      }),
      (projection: Record<string, unknown>) => ({
        ...projection,
        validUntil: projection.validFrom,
      }),
    ] as const;

    for (const [index, mutate] of invalidMutations.entries()) {
      const valid = entitlementWrite(`semantic-${index}`);
      const invalid = rebuildEntitlementWrite(valid, mutate);
      const response = await target.handler.handle(writeRequest(
        invalid,
        workloadTokenForWrite(invalid, `semantic-invalid-${index}`),
      ));
      expect(response.status).toBe(400);
    }
    const counts = await pool.query<{ projections: string; credentials: string }>(`
      SELECT
        (SELECT count(*)::text FROM programmable_website_projection_v1.projection_records)
          AS projections,
        (SELECT count(*)::text FROM programmable_website_projection_v1.credential_uses)
          AS credentials
    `);
    expect(counts.rows[0]).toEqual({ projections: "0", credentials: "0" });

    const corrected = entitlementWrite("semantic-corrected-retry");
    const invalid = rebuildEntitlementWrite(corrected, (projection) => ({
      ...projection,
      launchCapabilityIds: [],
    }));
    expect((await target.handler.handle(writeRequest(
      invalid,
      workloadTokenForWrite(invalid, "semantic-corrected-invalid"),
    ))).status).toBe(400);
    expect((await target.handler.handle(writeRequest(
      corrected,
      workloadTokenForWrite(corrected, "semantic-corrected-valid"),
    ))).status).toBe(201);
  });

  it("does not let an invalid entitlement poison an existing user read", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const valid = entitlementWrite("poison-existing-valid");
    expect((await target.handler.handle(writeRequest(
      valid,
      workloadTokenForWrite(valid, "poison-existing-valid"),
    ))).status).toBe(201);
    const poisonBase = entitlementWrite("poison-invalid");
    const poison = rebuildEntitlementWrite(poisonBase, (projection) => ({
      ...projection,
      launcherWallet: { namespace: "eip155:1", value: "" },
    }));
    expect((await target.handler.handle(writeRequest(
      poison,
      workloadTokenForWrite(poison, "poison-invalid"),
    ))).status).toBe(400);

    const read = createAuthenticatedWebsiteEntitlementReadHandlerV1({
      authenticator: Object.freeze({
        async authenticate() { return githubPrincipal(GITHUB_USER_ID); },
      }),
      store: target.store,
      now: () => NOW,
    });
    const response = await read(new Request(
      "https://website.invalid/api/custom-launch/entitlements",
      { headers: { accept: "application/json" } },
    ));
    expect(response.status).toBe(200);
    const body = JSON.parse(await response.text()) as { entitlements: unknown[] };
    expect(body.entitlements).toHaveLength(1);
  });

  it("rejects forged or ambiguous discoverable asset sets before persistence", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const mismatchedBase = customLaunchWrite("asset-hash-mismatch");
    const mismatched = rebuildCustomLaunchWrite(mismatchedBase, (record) => ({
      ...record,
      assetIdentitySetHash: digest("asset-hash-forged"),
    }));
    expect((await target.handler.handle(writeRequest(
      mismatched,
      workloadTokenForWrite(mismatched, "asset-hash-mismatch"),
    ))).status).toBe(400);

    const marketHashBase = customLaunchWrite("market-hash-mismatch");
    const marketHashMismatch = rebuildCustomLaunchWrite(marketHashBase, (record) => ({
      ...record,
      marketSetHash: digest("market-hash-forged"),
    }));
    expect((await target.handler.handle(writeRequest(
      marketHashMismatch,
      workloadTokenForWrite(marketHashMismatch, "market-hash-mismatch"),
    ))).status).toBe(400);

    const metadataBase = customLaunchWrite("metadata-hash-mismatch");
    const metadataMismatch = rebuildCustomLaunchWrite(metadataBase, (record) => {
      const original = (record.discoverableAssets as Array<Record<string, unknown>>)[0]!;
      const metadata = original.onchainMetadata as Record<string, unknown>;
      const discoverableAssets = [{
        ...original,
        onchainMetadata: { ...metadata, symbol: "FAKE" },
      }];
      return {
        ...record,
        discoverableAssets,
        assetIdentitySetHash: canonicalSha256(
          "programmable.discoverable-launch-asset-set-hash.v2",
          {
            schemaVersion: "programmable.discoverable-launch-asset-set.v2",
            advertisesToken: true,
            assets: discoverableAssets,
          },
        ),
      };
    });
    expect((await target.handler.handle(writeRequest(
      metadataMismatch,
      workloadTokenForWrite(metadataMismatch, "metadata-hash-mismatch"),
    ))).status).toBe(400);

    const duplicateBase = customLaunchWrite("asset-identity-duplicate");
    const duplicate = rebuildCustomLaunchWrite(duplicateBase, (record) => {
      const primary = (record.discoverableAssets as Array<Record<string, unknown>>)[0]!;
      const discoverableAssets = [
        primary,
        {
          ...primary,
          assetId: "root",
          role: "root",
          onchainMetadata: null,
          onchainMetadataHash: null,
        },
      ];
      return {
        ...record,
        discoverableAssets,
        assetIdentitySetHash: canonicalSha256(
          "programmable.discoverable-launch-asset-set-hash.v2",
          {
            schemaVersion: "programmable.discoverable-launch-asset-set.v2",
            advertisesToken: true,
            assets: discoverableAssets,
          },
        ),
      };
    });
    expect((await target.handler.handle(writeRequest(
      duplicate,
      workloadTokenForWrite(duplicate, "asset-identity-duplicate"),
    ))).status).toBe(400);

    const counts = await pool.query<{ projections: string; credentials: string }>(`
      SELECT
        (SELECT count(*)::text
           FROM programmable_website_projection_v1.projection_records)
          AS projections,
        (SELECT count(*)::text
           FROM programmable_website_projection_v1.credential_uses)
          AS credentials
    `);
    expect(counts.rows[0]).toEqual({ projections: "0", credentials: "0" });
  });

  it("accepts both authenticated finality sources but rejects forged Programmable labels", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const browser = customLaunchWrite("source-browser");
    const legacyBase = customLaunchWrite("source-legacy");
    const legacy = rebuildCustomLaunchWrite(legacyBase, (record) => ({
      ...record,
      sourceKind: "legacy-executor",
    }));
    expect((await target.handler.handle(writeRequest(
      browser,
      workloadTokenForWrite(browser, "source-browser"),
    ))).status).toBe(201);
    expect((await target.handler.handle(writeRequest(
      legacy,
      workloadTokenForWrite(legacy, "source-legacy"),
    ))).status).toBe(201);

    const mutations = [
      { platformId: "forged" },
      { origin: "forged" },
      { category: "classic" },
      { launchFamily: "classic" },
      { modelId: "not allowed whitespace" },
      { sourceKind: "browser-claim" },
      { registryPublicationBindingHash: digest("forged-registry-publication") },
    ] as const;
    for (const [index, mutation] of mutations.entries()) {
      const base = customLaunchWrite(`forged-label-${index}`);
      const forged = rebuildCustomLaunchWrite(base, (record) => ({
        ...record,
        ...mutation,
      }));
      expect((await target.handler.handle(writeRequest(
        forged,
        workloadTokenForWrite(forged, `forged-label-${index}`),
      ))).status).toBe(400);
    }

    const projects = await target.store.findFinalizedCustomLaunchesByWallet({
      namespace: browser.record.launchingWallet.namespace,
      value: browser.record.launchingWallet.value,
      signal: new AbortController().signal,
    });
    expect(projects).toHaveLength(2);
    expect(projects.map(({ sourceKind }) => sourceKind).sort()).toEqual([
      "browser-wallet-report",
      "legacy-executor",
    ]);
    expect(projects.every((project) => project.platformId === "programmable"
      && project.origin === "programmable"
      && project.category === "custom"
      && project.launchFamily === "custom")).toBe(true);
  });

  it("preserves only an exact optional presentation triple", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const populatedBase = customLaunchWrite("presentation-populated");
    const populated = rebuildCustomLaunchWrite(populatedBase, (record) => ({
      ...record,
      presentationVersion: "1",
      presentationBindingHash: digest("presentation-binding"),
      presentation: {
        schemaVersion: "programmable.launch-presentation-draft.v1",
        description: "A finalized programmable launch.",
        image: {
          uri: "ipfs://QmYwAPJzv5CZsnAzt8auVZRnG9n4FJSj3cKX5Q9zVqvJf8",
          contentSha256: digest("presentation-image"),
          mediaType: "image/png",
          byteLength: 1024,
          width: 512,
          height: 512,
        },
        links: [{ kind: "website", uri: "https://example.com/launch" }],
      },
    }));
    expect((await target.handler.handle(writeRequest(
      populated,
      workloadTokenForWrite(populated, "presentation-populated"),
    ))).status).toBe(201);
    const stored = await target.store.findFinalizedCustomLaunchByProjectId({
      projectId: populated.projectId,
      signal: new AbortController().signal,
    });
    expect(stored).toMatchObject({
      presentationVersion: "1",
      presentationBindingHash: digest("presentation-binding"),
      presentation: {
        schemaVersion: "programmable.launch-presentation-draft.v1",
        description: "A finalized programmable launch.",
      },
    });

    const invalidMutations = [
      {
        presentationVersion: "1",
        presentationBindingHash: null,
        presentation: null,
      },
      {
        presentationVersion: "2",
        presentationBindingHash: digest("presentation-secret"),
        presentation: {
          schemaVersion: "programmable.launch-presentation-draft.v1",
          description: "api_key=super-secret-value",
          image: null,
          links: [],
        },
      },
      {
        presentationVersion: "3",
        presentationBindingHash: digest("presentation-private-url"),
        presentation: {
          schemaVersion: "programmable.launch-presentation-draft.v1",
          description: "Safe description",
          image: null,
          links: [{ kind: "website", uri: "https://127.0.0.1/private" }],
        },
      },
    ] as const;
    for (const [index, mutation] of invalidMutations.entries()) {
      const base = customLaunchWrite(`presentation-invalid-${index}`);
      const invalid = rebuildCustomLaunchWrite(base, (record) => ({
        ...record,
        ...mutation,
      }));
      expect((await target.handler.handle(writeRequest(
        invalid,
        workloadTokenForWrite(invalid, `presentation-invalid-${index}`),
      ))).status).toBe(400);
    }
  });

  it("serves only finalized custom projects and scopes the profile to the canonical launch wallet", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const launched = customLaunchWrite("final-project-read");
    expect((await target.handler.handle(writeRequest(
      launched,
      workloadTokenForWrite(launched, "final-project-read"),
    ))).status).toBe(201);
    const handlers = createCustomLaunchProjectReadHandlersV2({
      store: target.registryCustomPublicStore,
    });
    expect((await handlers.project(new Request(
      `https://website.invalid/api/custom-launch/v2/projects/${encodeURIComponent(launched.projectId)}`,
      { headers: { accept: "application/json" } },
    ), launched.projectId)).status).toBe(404);
    await materializeRegistryCustom(
      target.registryCustomPublicStore,
      registryCustomMaterialization(launched, "finalized", "1"),
    );
    const project = await handlers.project(new Request(
      `https://website.invalid/api/custom-launch/v2/projects/${encodeURIComponent(launched.projectId)}`,
      { headers: { accept: "application/json" } },
    ), launched.projectId);
    expect(project.status).toBe(200);
    await expect(project.json()).resolves.toMatchObject({
      schemaVersion: "programmable.custom-launch-project-view.v2",
      project: {
        projectId: launched.projectId,
        launchId: launched.launchId,
        launchFamily: "custom",
        status: "launched",
        advertisesToken: true,
        discoverableAssets: [{ role: "primary-token" }],
        discoverableMarkets: [],
        feeObligation: {
          policy: {
            feeMode: "no-qualifying-market",
            totalRateBps: 0,
            marketPathId: null,
            legs: [],
          },
          claimSemantics: "not-applicable",
        },
      },
    });

    const profile = await handlers.profile(new Request(
      `https://website.invalid/api/custom-launch/v2/profile?namespace=eip155%3A1&wallet=${launched.record.launchingWallet.value}`,
      { headers: { accept: "application/json" } },
    ));
    expect(profile.status).toBe(200);
    const profileBody = await profile.json() as { projects: unknown[] };
    expect(profileBody.projects).toHaveLength(1);

    const otherProfile = await handlers.profile(new Request(
      "https://website.invalid/api/custom-launch/v2/profile?namespace=eip155%3A1&wallet=0x9999999999999999999999999999999999999999",
      { headers: { accept: "application/json" } },
    ));
    const otherBody = await otherProfile.json() as { projects: unknown[] };
    expect(otherBody.projects).toEqual([]);

    const invalid = await handlers.profile(new Request(
      "https://website.invalid/api/custom-launch/v2/profile?unexpected=1",
      { headers: { accept: "application/json" } },
    ));
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      schemaVersion: "programmable.custom-launch-website-error.v2",
      code: "invalid_profile_request",
      message: "invalid_profile_request",
    });
  });

  it("publishes Custom only from the current finalized Registry materialization", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const launched = customLaunchWrite("registry-public-lifecycle");
    expect((await target.handler.handle(writeRequest(
      launched,
      workloadTokenForWrite(launched, "registry-public-lifecycle-website"),
    ))).status).toBe(201);

    const legacyHandlers = createCustomLaunchProjectReadHandlersV2({
      store: target.registryCustomPublicStore,
    });
    const projectRequest = () => new Request(
      `https://website.invalid/api/custom-launch/v2/projects/${encodeURIComponent(
        launched.projectId,
      )}`,
      { headers: { accept: "application/json" } },
    );
    expect((await legacyHandlers.project(
      projectRequest(),
      launched.projectId,
    )).status).toBe(404);
    expect(() => createCustomLaunchProjectReadHandlersV2({
      store: target.store as never,
    })).toThrow("custom launch project read dependencies are invalid");
    await expect(authenticateRegistryCustomLaunchProjectionV1({
      materialization: launched,
      signal: new AbortController().signal,
      authenticator: registryProjectionAuthenticator(async () => true),
    })).rejects.toThrow("registry custom launch materialization");
    await expect(authenticateRegistryCustomLaunchProjectionV1({
      materialization: registryCustomMaterialization(launched, "pending", "1"),
      signal: new AbortController().signal,
      authenticator: registryProjectionAuthenticator(async () => false),
    })).rejects.toThrow("projection authentication failed");

    expect((await materializeRegistryCustom(
      target.registryCustomPublicStore,
      registryCustomMaterialization(launched, "pending", "1"),
    )).kind).toBe("created");
    expect((await legacyHandlers.project(
      projectRequest(),
      launched.projectId,
    )).status).toBe(404);

    expect((await materializeRegistryCustom(
      target.registryCustomPublicStore,
      registryCustomMaterialization(launched, "finalized", "2"),
    )).kind).toBe("updated");
    const visible = await legacyHandlers.project(projectRequest(), launched.projectId);
    expect(visible.status).toBe(200);
    await expect(visible.json()).resolves.toMatchObject({
      schemaVersion: "programmable.custom-launch-project-view.v2",
      project: { projectId: launched.projectId, launchId: launched.launchId },
    });

    const registryHandlers = createRegistryCustomLaunchPublicReadHandlersV1({
      store: target.registryCustomPublicStore,
    });
    const feed = await registryHandlers.feed(new Request(
      "https://website.invalid/api/custom-launch/registry/v1/projects",
      { headers: { accept: "application/json" } },
    ));
    expect(feed.status).toBe(200);
    await expect(feed.json()).resolves.toMatchObject({
      schemaVersion: "programmable.registry-custom-launch-public-feed.v1",
      records: [{
        sourceLane: "registry.custom-launched",
        lifecycle: { generation: "2", state: "finalized" },
        record: {
          registry: {
            chainId: "1",
            registryAddress: "0x1111111111111111111111111111111111111111",
            startBlock: "100",
          },
          event: {
            transactionHash: launched.record.launchTransactionId,
            blockNumber: "112",
            transactionIndex: 0,
            logIndex: 7,
          },
          configurationHash: `0x${"4".repeat(64)}`,
          provider: {
            providerId: "programmable-approval-service",
            modelId: launched.record.modelId,
            modelVersion: "2.0.0",
            marketPath: null,
          },
          github: {
            repositoryOwner: "example-owner",
            repositoryId: "654321",
            commitObjectId: "a".repeat(40),
            treeObjectId: "b".repeat(40),
          },
          approval: {
            approvalId: "approval-registry-public-lifecycle",
            launchPlanPath: "launch/plan.json",
          },
          project: { projectId: launched.projectId },
        },
      }],
    });
    expect(feed.headers.get("cache-control")).toBe("no-store");
    const detail = await registryHandlers.detail(new Request(
      `https://website.invalid/api/custom-launch/registry/v1/projects/${encodeURIComponent(
        launched.projectId,
      )}`,
      { headers: { accept: "application/json" } },
    ), launched.projectId);
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      schemaVersion: "programmable.registry-custom-launch-public-view.v1",
      record: {
        sourceLane: "registry.custom-launched",
        record: { projectId: launched.projectId, launchId: launched.launchId },
      },
    });
    const profileRequest = () => new Request(
      `https://website.invalid/api/custom-launch/v2/profile?namespace=eip155%3A1&wallet=${launched.record.launchingWallet.value}`,
      { headers: { accept: "application/json" } },
    );
    const visibleProfile = await legacyHandlers.profile(profileRequest());
    await expect(visibleProfile.json()).resolves.toMatchObject({
      projects: [{ projectId: launched.projectId }],
    });

    expect((await materializeRegistryCustom(
      target.registryCustomPublicStore,
      registryCustomMaterialization(launched, "corrected", "3"),
    )).kind).toBe("updated");
    expect((await legacyHandlers.project(
      projectRequest(),
      launched.projectId,
    )).status).toBe(404);
    await expect((await legacyHandlers.profile(profileRequest())).json())
      .resolves.toMatchObject({ projects: [] });
    expect((await materializeRegistryCustom(
      target.registryCustomPublicStore,
      registryCustomMaterialization(launched, "finalized", "2"),
    )).kind).toBe("stale");
    expect((await legacyHandlers.project(
      projectRequest(),
      launched.projectId,
    )).status).toBe(404);

    expect((await materializeRegistryCustom(
      target.registryCustomPublicStore,
      registryCustomMaterialization(launched, "finalized", "4"),
    )).kind).toBe("updated");
    expect((await legacyHandlers.project(
      projectRequest(),
      launched.projectId,
    )).status).toBe(200);
    expect((await materializeRegistryCustom(
      target.registryCustomPublicStore,
      registryCustomMaterialization(launched, "reorged", "5"),
    )).kind).toBe("updated");
    expect((await legacyHandlers.project(
      projectRequest(),
      launched.projectId,
    )).status).toBe(404);

    expect((await materializeRegistryCustom(
      target.registryCustomPublicStore,
      registryCustomMaterialization(launched, "finalized", "6"),
    )).kind).toBe("updated");
    expect((await legacyHandlers.project(
      projectRequest(),
      launched.projectId,
    )).status).toBe(200);
    expect((await materializeRegistryCustom(
      target.registryCustomPublicStore,
      registryCustomMaterialization(launched, "revoked", "7"),
    )).kind).toBe("updated");
    expect((await materializeRegistryCustom(
      target.registryCustomPublicStore,
      registryCustomMaterialization(launched, "finalized", "8"),
    )).kind).toBe("conflict");
    expect((await legacyHandlers.project(
      projectRequest(),
      launched.projectId,
    )).status).toBe(404);
  });

  it("rejects incomplete finality and substituted Registry fee or role facts", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const launched = customLaunchWrite("registry-public-negative");
    const finalized = registryCustomMaterialization(launched, "finalized", "1");

    await expect(materializeRegistryCustom(
      target.registryCustomPublicStore,
      { ...finalized, record: null },
    )).rejects.toThrow("public lifecycle is invalid");
    await expect(materializeRegistryCustom(
      target.registryCustomPublicStore,
      {
        ...finalized,
        record: {
          ...finalized.record,
          configurationHash: "0x1234",
        },
      },
    )).rejects.toThrow("configuration hash is invalid");
    await expect(materializeRegistryCustom(
      target.registryCustomPublicStore,
      {
        ...finalized,
        record: {
          ...finalized.record,
          finality: {
            ...finalized.record!.finality,
            requiredConfirmations: 13,
          },
        },
      },
    )).rejects.toThrow("public bindings are inconsistent");
    await expect(materializeRegistryCustom(
      target.registryCustomPublicStore,
      {
        ...finalized,
        record: {
          ...finalized.record,
          fee: {
            ...finalized.record!.fee,
            feeObligationHash: digest("substituted-fee"),
          },
        },
      },
    )).rejects.toThrow("public bindings are inconsistent");
    expect(await target.registryCustomPublicStore
      .findVerifiedRegistryCustomLaunchesPublic({
        signal: new AbortController().signal,
      })).toEqual([]);

    expect((await materializeRegistryCustom(
      target.registryCustomPublicStore,
      finalized,
    )).kind).toBe("created");
    const substitutedRecord = {
      ...finalized.record!,
      github: {
        ...finalized.record!.github,
        repositoryOwner: "different-owner",
      },
    } as const;
    const substituted = {
      ...registryCustomMaterialization(launched, "finalized", "2"),
      record: substitutedRecord,
      launchSecurityBindingHash:
        registryCustomLaunchSecurityBindingHashV1(substitutedRecord),
    } as const;
    expect((await materializeRegistryCustom(
      target.registryCustomPublicStore,
      substituted,
    )).kind).toBe("conflict");
  });

  it("preserves one evidence-bound Uniswap v4 market without inventing a pair", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const launched = customLaunchWriteWithV4Market("verified-v4-market");
    expect((await target.handler.handle(writeRequest(
      launched,
      workloadTokenForWrite(launched, "verified-v4-market"),
    ))).status).toBe(201);
    const handlers = createCustomLaunchProjectReadHandlersV2({
      store: target.registryCustomPublicStore,
    });
    await materializeRegistryCustom(
      target.registryCustomPublicStore,
      registryCustomMaterialization(launched, "finalized", "1"),
    );
    const response = await handlers.project(new Request(
      `https://website.invalid/api/custom-launch/v2/projects/${encodeURIComponent(
        launched.projectId,
      )}`,
      { headers: { accept: "application/json" } },
    ), launched.projectId);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      project: {
        advertisesToken: true,
        discoverableMarkets: [{
          marketId: "uniswap-v4-primary-secondary",
          kind: "uniswap-v4-pool",
          status: "active",
          uniswapV4: {
            poolId: uniswapV4PoolId(
              "0x1111111111111111111111111111111111111111",
              "0x2222222222222222222222222222222222222222",
              "3000",
              "60",
              null,
            ),
            feeRaw: "3000",
            dynamicFee: false,
          },
        }],
      },
    });
  });

  it("binds the standard Custom 10 bps fee to one provider, model, version, and market path", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const launched = customLaunchWriteWithV4Market("standard-market-fee");
    expect((await target.handler.handle(writeRequest(
      launched,
      workloadTokenForWrite(launched, "standard-market-fee"),
    ))).status).toBe(201);
    const stored = await target.store.findFinalizedCustomLaunchByProjectId({
      projectId: launched.projectId,
      signal: new AbortController().signal,
    });
    expect(stored?.feeObligation.policy).toEqual({
      schemaVersion: "programmable.custom-launch-fee-policy.v1",
      providerId: "programmable",
      modelId: "custom-contract-graph-v2",
      templateId: "standard-custom",
      semanticVersion: "1.0.0",
      feeMode: "standard-programmable-custom",
      marketPathId: "uniswap-v4-primary-secondary",
      totalRatePpm: 1000,
      totalRateBps: 10,
      chargeMode: "added-on-top",
      normalProgrammableTenBpsApplied: true,
      legs: [{
        role: "programmable",
        ratePpm: 1000,
        rateBps: 10,
        recipient: {
          namespace: "eip155:1",
          value: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
        },
      }],
    });
  });

  it("accepts only AEON 20 bps total with an approved-plan recipient and no extra 10 bps", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const launched = customLaunchWriteWithV4Market("aeon-market-fee", "aeon");
    expect((await target.handler.handle(writeRequest(
      launched,
      workloadTokenForWrite(launched, "aeon-market-fee"),
    ))).status).toBe(201);
    const stored = await target.store.findFinalizedCustomLaunchByProjectId({
      projectId: launched.projectId,
      signal: new AbortController().signal,
    });
    expect(stored?.feeObligation.policy).toMatchObject({
      providerId: "aeon",
      modelId: "aeon-agent-launch",
      templateId: "aeon-approved-model",
      semanticVersion: "1.0.0",
      feeMode: "aeon-partner-custom",
      marketPathId: "uniswap-v4-primary-secondary",
      totalRateBps: 20,
      normalProgrammableTenBpsApplied: false,
      legs: [
        { role: "provider", rateBps: 15 },
        {
          role: "programmable",
          rateBps: 5,
          recipient: {
            value: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
          },
        },
      ],
    });

    const invalidPolicies = [
      (policy: Record<string, unknown>) => ({
        ...policy,
        normalProgrammableTenBpsApplied: true,
      }),
      (policy: Record<string, unknown>) => ({
        ...policy,
        legs: [
          {
            ...(policy.legs as Array<Record<string, unknown>>)[0],
            ratePpm: 1400,
            rateBps: 14,
          },
          {
            ...(policy.legs as Array<Record<string, unknown>>)[1],
            ratePpm: 600,
            rateBps: 6,
          },
        ],
      }),
      (policy: Record<string, unknown>) => ({ ...policy, providerId: "aeon-alt" }),
      (policy: Record<string, unknown>) => ({ ...policy, semanticVersion: "1" }),
      (policy: Record<string, unknown>) => ({ ...policy, marketPathId: "unknown-market" }),
    ];
    for (const [index, mutation] of invalidPolicies.entries()) {
      const label = `aeon-invalid-fee-${index}`;
      const invalid = rebuildCustomLaunchFeePolicy(
        customLaunchWriteWithV4Market(label, "aeon"),
        mutation,
      );
      expect((await target.handler.handle(writeRequest(
        invalid,
        workloadTokenForWrite(invalid, label),
      ))).status).toBe(400);
    }
  });

  it("rejects an arbitrary stored PoolId even when every transport hash is rebuilt", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const base = customLaunchWriteWithV4Market("forged-derived-pool-id");
    const forgedPoolId = `0x${"f".repeat(64)}`;
    const forged = rebuildCustomLaunchWrite(base, (record) => {
      const assets = (record.discoverableAssets as Array<Record<string, unknown>>)
        .map((asset) => asset.assetId === "pool"
          ? {
              ...asset,
              identity: {
                ...(asset.identity as Record<string, unknown>),
                value: forgedPoolId,
              },
            }
          : asset);
      const markets = (record.discoverableMarkets as Array<Record<string, unknown>>)
        .map((market) => ({
          ...market,
          uniswapV4: {
            ...(market.uniswapV4 as Record<string, unknown>),
            poolId: forgedPoolId,
          },
        }));
      return withDiscoverableSetHashes(record, assets, markets);
    });

    expect((await target.handler.handle(writeRequest(
      forged,
      workloadTokenForWrite(forged, "forged-derived-pool-id"),
    ))).status).toBe(400);
    await expectProjectionTargetCounts(pool, { projections: "0", credentials: "0" });
  });

  it("persists no part of a multi-market record when one PoolId is invalid", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const base = customLaunchWriteWithV4Market("multi-market-atomic");
    const forgedPoolId = `0x${"e".repeat(64)}`;
    const partial = rebuildCustomLaunchWrite(base, (record) => {
      const [firstPool, ...remainingAssets] =
        record.discoverableAssets as Array<Record<string, unknown>>;
      const secondPool = {
        ...firstPool,
        assetId: "pool-z",
        identity: {
          ...(firstPool!.identity as Record<string, unknown>),
          value: forgedPoolId,
        },
        identityEvidenceHash: digest("multi-market-atomic:second-pool-evidence"),
      };
      const assets = [firstPool!, secondPool, ...remainingAssets];
      const firstMarket = (
        record.discoverableMarkets as Array<Record<string, unknown>>
      )[0]!;
      const secondMarket = {
        ...firstMarket,
        marketId: "uniswap-v4-primary-secondary-z",
        marketAssetId: "pool-z",
        marketEvidenceHash: digest("multi-market-atomic:second-market-evidence"),
        verification: {
          ...(firstMarket.verification as Record<string, unknown>),
          verifierBindingHash: digest("multi-market-atomic:second-verifier"),
        },
        uniswapV4: {
          ...(firstMarket.uniswapV4 as Record<string, unknown>),
          poolId: forgedPoolId,
          feeRaw: "500",
          tickSpacing: "10",
          poolKeyEvidenceHash: digest("multi-market-atomic:second-pool-key"),
        },
      };
      return withDiscoverableSetHashes(
        record,
        assets,
        [firstMarket, secondMarket],
      );
    });

    expect((await target.handler.handle(writeRequest(
      partial,
      workloadTokenForWrite(partial, "multi-market-atomic"),
    ))).status).toBe(400);
    await expectProjectionTargetCounts(pool, { projections: "0", credentials: "0" });
  });

  it("enforces official v4 fee, dynamic-hook and tick-spacing semantics", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const mutations = [
      { feeRaw: "1000001", dynamicFee: false, tickSpacing: "60" },
      { feeRaw: "8388608", dynamicFee: false, tickSpacing: "60" },
      { feeRaw: "8388608", dynamicFee: true, tickSpacing: "60" },
      { feeRaw: "3000", dynamicFee: false, tickSpacing: "0" },
      { feeRaw: "3000", dynamicFee: false, tickSpacing: "32768" },
    ] as const;
    for (const [index, mutation] of mutations.entries()) {
      const base = customLaunchWriteWithV4Market(`v4-official-bounds-${index}`);
      const invalid = rebuildCustomLaunchWrite(base, (record) => {
        const markets = (
          record.discoverableMarkets as Array<Record<string, unknown>>
        ).map((market) => ({
          ...market,
          uniswapV4: {
            ...(market.uniswapV4 as Record<string, unknown>),
            ...mutation,
          },
        }));
        return withDiscoverableSetHashes(
          record,
          record.discoverableAssets as Array<Record<string, unknown>>,
          markets,
        );
      });
      expect((await target.handler.handle(writeRequest(
        invalid,
        workloadTokenForWrite(invalid, `v4-official-bounds-${index}`),
      ))).status).toBe(400);
    }
    await expectProjectionTargetCounts(pool, { projections: "0", credentials: "0" });
  });

  it("binds each durable workload JTI to one exact request across restarts", async () => {
    const pool = await pglitePool();
    const target = targetFor(pool);
    const first = entitlementWrite("credential-binding-first");
    const second = entitlementWrite("credential-binding-second");
    const firstToken = workloadTokenForWrite(first, "credential-binding-shared");

    expect((await target.handler.handle(writeRequest(first, firstToken))).status)
      .toBe(201);
    expect((await targetFor(pool).handler.handle(writeRequest(first, firstToken))).status)
      .toBe(200);
    expect((await target.handler.handle(writeRequest(second, firstToken))).status)
      .toBe(401);

    const changedBody = rebuildEntitlementWrite(first, (projection) => ({
      ...projection,
      chainProfileId: "eip155:8453",
    }));
    expect((await target.handler.handle(writeRequest(changedBody, firstToken))).status)
      .toBe(401);
    expect((await target.handler.handle(new Request(
      `https://website.invalid${route(first.projectionKey, first.topic)}`,
      { headers: readHeaders(first.topic, firstToken) },
    ))).status).toBe(401);

    const custom = customLaunchWrite("credential-binding-lane");
    expect((await target.handler.handle(writeRequest(custom, firstToken))).status)
      .toBe(401);
    const reusedJti = workloadTokenForWrite(second, "credential-binding-shared");
    expect((await targetFor(pool).handler.handle(writeRequest(second, reusedJti))).status)
      .toBe(401);

    const credentialRows = await pool.query<{ count: string }>(`
      SELECT count(*)::text AS count
        FROM programmable_website_projection_v1.credential_uses
       WHERE credential_id = 'credential-binding-shared'
    `);
    expect(credentialRows.rows[0]?.count).toBe("1");
  });

  it("uses matching Privy sessions and the current server-side GitHub link", async () => {
    const current = {
      githubUserId: GITHUB_USER_ID,
      duplicate: false,
    };
    const boundary = Object.freeze({
      async verifyAccessToken() {
        return { appId: "privy-app", userId: "did:privy:user", sessionId: "session-1" };
      },
      async verifyIdentityToken() {
        return { userId: "did:privy:user", sessionId: "session-1" };
      },
      async getCurrentUser() {
        return {
          id: "did:privy:user",
          linkedAccounts: current.githubUserId === ""
            ? []
            : [{
              type: "github_oauth",
              subject: current.githubUserId,
              username: "current-user",
            }, ...(current.duplicate ? [{
              type: "github_oauth",
              subject: current.githubUserId,
              username: "current-user-renamed",
            }] : [])],
        };
      },
    });
    const authenticator = createPrivyGitHubPrincipalAuthenticatorFromBoundaryV1({
      appId: "privy-app",
      boundary,
    });
    const request = privyRequest();
    await expect(authenticator.authenticate(request)).resolves.toMatchObject({
      githubUserId: GITHUB_USER_ID,
      githubUsername: "current-user",
    });

    current.githubUserId = "987654321";
    await expect(authenticator.authenticate(privyRequest())).resolves.toMatchObject({
      githubUserId: "987654321",
    });
    current.githubUserId = "9".repeat(20);
    await expect(authenticator.authenticate(privyRequest())).resolves.toMatchObject({
      githubUserId: "9".repeat(20),
    });
    current.githubUserId = "9".repeat(21);
    await expect(authenticator.authenticate(privyRequest())).rejects.toThrow(
      "github_identity_invalid",
    );
    current.githubUserId = GITHUB_USER_ID;
    current.duplicate = true;
    await expect(authenticator.authenticate(privyRequest())).rejects.toThrow(
      "github_identity_ambiguous",
    );
    current.duplicate = false;
    current.githubUserId = "";
    await expect(authenticator.authenticate(privyRequest())).rejects.toThrow(
      "github_account_required",
    );

    const mismatched = createPrivyGitHubPrincipalAuthenticatorFromBoundaryV1({
      appId: "privy-app",
      boundary: {
        ...boundary,
        async verifyIdentityToken() {
          return { userId: "did:privy:user", sessionId: "session-2" };
        },
      },
    });
    await expect(mismatched.authenticate(privyRequest())).rejects.toThrow(
      "privy_session_rejected",
    );
  });

  it("requires separate verified TLS configuration and rejects URL SSL overrides", () => {
    const ca = rootCertificates[0]!;
    const secure = verifiedPostgresTlsConfigurationV1(
      "postgresql://runtime:secret@db.example.com:5432/postgres",
      ca,
    );
    expect(secure).toMatchObject({
      servername: "db.example.com",
      rejectUnauthorized: true,
      ca,
    });
    for (const mode of [
      "disable", "allow", "prefer", "require", "verify-ca", "verify-full",
    ]) {
      expect(() => verifiedPostgresTlsConfigurationV1(
        `postgresql://runtime:secret@db.example.com/postgres?sslmode=${mode}`,
        ca,
      )).toThrow("database URL is invalid");
    }
    expect(() => verifiedPostgresTlsConfigurationV1(
      "postgresql://runtime:secret@db.example.com/postgres",
      "not-a-certificate",
    )).toThrow("database CA is invalid");
  });

  it("accepts only the exact runtime role or its verified Supabase pooler routing identity", () => {
    expect(() => assertProductionDatabaseLoginRoleV1(
      "postgresql://programmable_website_projection_runtime:secret@db.example.com:5432/postgres",
      "programmable_website_projection_runtime",
    )).not.toThrow();
    expect(() => assertProductionDatabaseLoginRoleV1(
      "postgresql://programmable_website_projection_runtime.mnnvlrqwhfoppogslsje:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
      "programmable_website_projection_runtime",
    )).not.toThrow();
    for (const connectionString of [
      "postgresql://unexpected_runtime:secret@db.example.com:5432/postgres",
      "postgresql://programmable_website_projection_runtime.mnnvlrqwhfoppogslsje:secret@db.example.com:6543/postgres",
      "postgresql://programmable_website_projection_runtime.invalid:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
      "postgresql://programmable_website_projection_runtime.mnnvlrqwhfoppogslsje:secret@aws-0-eu-central-1.pooler.supabase.com:9999/postgres",
    ]) {
      expect(() => assertProductionDatabaseLoginRoleV1(
        connectionString,
        "programmable_website_projection_runtime",
      )).toThrow("database login role is invalid");
    }
  });

  it("fails the production attestation for every weakened TLS, RLS, or role axis", () => {
    const secure = securityAttestationFixture();
    expect(() => assertProjectionTargetSecurityAttestationV1(
      secure,
      "programmable_website_projection_runtime",
    )).not.toThrow();
    for (const mutation of [
      { runtime_role: "unexpected_runtime_role" },
      { session_role: "unexpected_session_role" },
      { ssl: false },
      { ssl_bits: 0 },
      { projections_force_rls: false },
      { credentials_rls: false },
      { provider_roles_excluded: false },
      { expected_policies: false },
      { projections_mutate: true },
      { registry_custom_update: false },
      { registry_custom_forbidden_mutate: true },
      { registry_custom_force_rls: false },
      { rolbypassrls: true },
      { schema_create: true },
    ] satisfies Array<Partial<ProjectionTargetSecurityAttestationRowV1>>) {
      expect(() => assertProjectionTargetSecurityAttestationV1(
        { ...secure, ...mutation },
        "programmable_website_projection_runtime",
      )).toThrow("database attestation failed");
    }
  });

  it("forces RLS, excludes provider roles, and enforces lane-specific metadata", async () => {
    const pool = await pglitePool();
    const state = await pool.query<{
      projection_rls: boolean;
      projection_force: boolean;
      credential_rls: boolean;
      credential_force: boolean;
      registry_custom_rls: boolean;
      registry_custom_force: boolean;
      providers_excluded: boolean;
    }>(`
      SELECT projections.relrowsecurity AS projection_rls,
             projections.relforcerowsecurity AS projection_force,
             credentials.relrowsecurity AS credential_rls,
             credentials.relforcerowsecurity AS credential_force,
             registry_custom.relrowsecurity AS registry_custom_rls,
             registry_custom.relforcerowsecurity AS registry_custom_force,
             NOT EXISTS (
               SELECT 1 FROM pg_roles AS role
                WHERE role.rolname IN ('anon', 'authenticated', 'service_role')
                  AND (
                    has_schema_privilege(role.rolname,
                      'programmable_website_projection_v1', 'USAGE,CREATE')
                    OR has_table_privilege(role.rolname,
                      'programmable_website_projection_v1.projection_records',
                      'SELECT,INSERT,UPDATE,DELETE')
                    OR has_table_privilege(role.rolname,
                      'programmable_website_projection_v1.registry_custom_launch_records',
                      'SELECT,INSERT,UPDATE,DELETE')
                  )
             ) AS providers_excluded
        FROM pg_class AS projections
        JOIN pg_namespace AS schema ON schema.oid = projections.relnamespace
        JOIN pg_class AS credentials ON credentials.relnamespace = schema.oid
        JOIN pg_class AS registry_custom
          ON registry_custom.relnamespace = schema.oid
       WHERE schema.nspname = 'programmable_website_projection_v1'
         AND projections.relname = 'projection_records'
         AND credentials.relname = 'credential_uses'
         AND registry_custom.relname = 'registry_custom_launch_records'
    `);
    expect(state.rows[0]).toEqual({
      projection_rls: true,
      projection_force: true,
      credential_rls: true,
      credential_force: true,
      registry_custom_rls: true,
      registry_custom_force: true,
      providers_excluded: true,
    });
    await expect(pool.query(`
      INSERT INTO programmable_website_projection_v1.projection_records
        (lane, target_binding_hash, audience, projection_key, idempotency_key,
         request_digest, canonical_write, canonical_acknowledgement,
         canonical_readback, record_binding_hash)
      VALUES
        ('website.entitlement', '${digest("sql-target")}', 'audience',
         '${digest("sql-key")}', '${digest("sql-idempotency")}',
         '${digest("sql-request")}', '{}', '{}', '{}', '${digest("sql-record")}')
    `)).rejects.toThrow();
    await expect(pool.query(`
      UPDATE programmable_website_projection_v1.registry_custom_launch_records
         SET project_id = project_id
    `)).rejects.toThrow();
    await expect(pool.query(`
      DELETE FROM programmable_website_projection_v1.registry_custom_launch_records
    `)).rejects.toThrow();
  });
});

function targetFor(pool: ProjectionTargetPostgresPoolV1) {
  return createWebsiteProjectionTargetV1({
    pool,
    lanes,
    workloadJwt: {
      issuer: "programmable-workload-issuer",
      subject: "programmable-approval-service",
      audience: lanes[0].audience,
      keyId: "workload-key-2026-08",
      publicKeyPem,
    },
    now: () => NOW,
  });
}

async function pglitePool(): Promise<ProjectionTargetPostgresPoolV1> {
  const database = new PGlite();
  databases.push(database);
  await database.exec(`
    CREATE ROLE programmable_website_projection_runtime NOLOGIN;
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
  `);
  const migrationV1 = await readFile(new URL(
    "../ops/website-projection-target/migrations/0001_projection_records_v1.sql",
    import.meta.url,
  ), "utf8");
  const migrationV2 = await readFile(new URL(
    "../ops/website-projection-target/migrations/0002_custom_launch_wallet_profile_v2.sql",
    import.meta.url,
  ), "utf8");
  const migrationV3 = await readFile(new URL(
    "../ops/website-projection-target/migrations/0003_registry_custom_public_read_v1.sql",
    import.meta.url,
  ), "utf8");
  await database.exec(migrationV1);
  await database.exec(migrationV2);
  await database.exec(migrationV3);
  await database.exec(`
    GRANT USAGE ON SCHEMA programmable_website_projection_v1
      TO programmable_website_projection_runtime;
    GRANT SELECT, INSERT
      ON programmable_website_projection_v1.projection_records,
         programmable_website_projection_v1.credential_uses
      TO programmable_website_projection_runtime;
    GRANT SELECT, INSERT
      ON programmable_website_projection_v1.registry_custom_launch_records
      TO programmable_website_projection_runtime;
    GRANT UPDATE (
      lifecycle_generation, lifecycle_state, lifecycle_binding_hash,
      observed_at, canonical_materialization, canonical_public_record,
      record_binding_hash, launch_security_binding_hash,
      launching_wallet_namespace, launching_wallet_value, updated_at
    ) ON programmable_website_projection_v1.registry_custom_launch_records
      TO programmable_website_projection_runtime;
    SET ROLE programmable_website_projection_runtime;
  `);
  return new PGliteProjectionPool(database);
}

class PGliteProjectionPool implements ProjectionTargetPostgresPoolV1 {
  readonly #database: PGlite;

  constructor(database: PGlite) {
    this.#database = database;
  }

  async connect(): Promise<ProjectionTargetPostgresClientV1> {
    return Object.freeze({
      query: <Row extends Record<string, unknown>>(
        text: string,
        values: readonly unknown[] = [],
      ) => this.query<Row>(text, values),
      release() {},
    });
  }

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<ProjectionTargetPostgresQueryResultV1<Row>> {
    const result = await this.#database.query<Row>(text, [...values]);
    return {
      rows: result.rows,
      rowCount: result.affectedRows ?? result.rows.length,
    };
  }
}

function lane(
  laneValue: "website.entitlement" | "website.custom-launched",
): ProjectionTargetLaneConfigurationV1 {
  return Object.freeze({
    lane: laneValue,
    targetBindingHash: digest(`${laneValue}:target`),
    audience: "programmable-website-projections",
  });
}

function entitlementWrite(label: string) {
  const configuration = lanes[0];
  const subject = Object.freeze({
    applicationId: `application-${label}`,
    applicationRevision: "1",
    githubUserId: GITHUB_USER_ID,
    githubRepositoryId: "654321",
  });
  const revision = Object.freeze({
    provider: "github" as const,
    sourceVisibility: "public" as const,
    repositoryId: subject.githubRepositoryId,
    repositoryOwnerId: GITHUB_USER_ID,
    repositoryFullName: "example/project",
    objectFormat: "sha1" as const,
    commitOid: "a".repeat(40),
    treeOid: "b".repeat(40),
    sourceSnapshotHash: digest(`${label}:source-snapshot`),
    submissionManifestHash: digest(`${label}:submission-manifest`),
    sourceClosureHash: digest(`${label}:source-closure`),
    dependencyClosureHash: digest(`${label}:dependency-closure`),
  });
  const decisionReceiptHash = digest(`${label}:decision-receipt`);
  const authority = Object.freeze({
    decisionReceiptHash,
    signedReceiptArtifactHash: digest(`${label}:signed-receipt`),
    approvedLaunchCapabilityIds: ["custom:launch"],
    approvedChainProfiles: [{
      profileId: "eip155:1",
      profileHash: digest(`${label}:chain-profile`),
    }],
    approvedChainProfileSetHash: digest(`${label}:chain-profile-set`),
    chainProfileRegistrySnapshotHash: digest(`${label}:chain-registry`),
    selectedChainProfileBindingHash: digest(`${label}:selected-chain`),
    chainProfileId: "eip155:1",
    chainProfileHash: digest(`${label}:chain-profile`),
    launchCapabilityIds: ["custom:launch"],
    launchCapabilityBindingHash: digest(`${label}:launch-capability-binding`),
    launchArtifactCommitmentHash: digest(`${label}:launch-artifact-commitment`),
    launchArtifactManifestHash: digest(`${label}:launch-artifact-manifest`),
    publicSourceAuthorityHash: digest(`${label}:public-source-authority`),
    exactSourceRevisionBindingHash: digest(`${label}:source-revision-binding`),
    runnerEvidenceDigest: digest(`${label}:runner-evidence`),
    runnerAuthenticationEvidenceDigest: digest(`${label}:runner-authentication`),
    launcherWallet: {
      namespace: "eip155:1",
      value: "0x1111111111111111111111111111111111111111",
    },
    launcherExecutionMode: "direct",
    launcherAuthorizationCommitmentHash: digest(`${label}:launcher-authorization`),
    launcherAuthorizationRouteHash: digest(`${label}:launcher-route`),
    executionBindingHash: digest(`${label}:execution-binding`),
    executionAuthorizationPolicyHash: digest(`${label}:execution-policy`),
    feeEnforcementCoverageHash: digest(`${label}:fee-coverage`),
    permitIssuanceGeneration: "1",
    websiteProjectionGeneration: "1",
    validFrom: "2026-08-05T11:00:00.000Z",
    validUntil: "2026-08-05T13:00:00.000Z",
  });
  const projectionKey = canonicalSha256(
    "programmable.website-launch-entitlement-authority.v1",
    authority,
  );
  const deduplicationKey = canonicalSha256(
    "programmable.website-launch-entitlement-deduplication.v1",
    {
      decisionReceiptHash,
      launchArtifactCommitmentHash: authority.launchArtifactCommitmentHash,
      launchEntitlementBindingHash: projectionKey,
      permitIssuanceGeneration: authority.permitIssuanceGeneration,
      websiteProjectionGeneration: authority.websiteProjectionGeneration,
    },
  );
  const withoutOutboxId = Object.freeze({
    schemaVersion: "1.0.0" as const,
    eventType: "programmable.website-launch-entitlement.requested.v1" as const,
    subject,
    revision,
    ...authority,
    launchEntitlementBindingHash: projectionKey,
    entitlement: "custom-launch" as const,
    action: "grant" as const,
    precondition:
      "current-signed-approval-authenticated-artifact-and-active-axes" as const,
    deduplicationKey,
  });
  const projection = Object.freeze({
    ...withoutOutboxId,
    outboxId: canonicalSha256(
      "programmable.website-launch-entitlement-outbox.v1",
      withoutOutboxId,
    ),
  });
  const withoutRequestDigest = {
    schemaVersion: "programmable.registry-website-projection-write.v1",
    targetBindingHash: configuration.targetBindingHash,
    messageId: `message-${label}`,
    topic: "website.entitlement",
    projectionKind: "launch_eligible",
    projectionKey,
    idempotencyKey: digest(`${label}:idempotency`),
    payloadDigest: digest(`${label}:payload`),
    projectionDigest: canonicalSha256(
      "programmable.registry-website-projection-record.v1",
      projection,
    ),
    projection,
  } as const;
  return Object.freeze({
    ...withoutRequestDigest,
    requestDigest: canonicalSha256(
      "programmable.registry-website-projection-write.v1",
      withoutRequestDigest,
    ),
  });
}

function rebuildEntitlementWrite(
  write: ReturnType<typeof entitlementWrite>,
  mutate: (projection: Record<string, unknown>) => Record<string, unknown>,
) {
  const projection = mutate({ ...write.projection });
  const { requestDigest: _ignored, ...withoutRequestDigest } = write;
  void _ignored;
  const rebuilt = Object.freeze({
    ...withoutRequestDigest,
    projection,
    projectionDigest: canonicalSha256(
      "programmable.registry-website-projection-record.v1",
      projection as never,
    ),
  });
  return Object.freeze({
    ...rebuilt,
    requestDigest: canonicalSha256(
      "programmable.registry-website-projection-write.v1",
      rebuilt as never,
    ),
  });
}

function rebuildCustomLaunchWrite(
  write: Readonly<{
    schemaVersion: string;
    targetBindingHash: Sha256Digest;
    projectionKind: string;
    projectionKey: string;
    projectId: Sha256Digest;
    launchId: Sha256Digest;
    idempotencyKey: Sha256Digest;
    sourceAuthorityHash: Sha256Digest;
    record: Record<string, unknown>;
  }>,
  mutate: (record: Record<string, unknown>) => Record<string, unknown>,
) {
  const record = mutate({ ...write.record });
  const rebuilt = Object.freeze({
    schemaVersion: write.schemaVersion,
    targetBindingHash: write.targetBindingHash,
    projectionKind: write.projectionKind,
    projectionKey: write.projectionKey,
    projectId: write.projectId,
    launchId: write.launchId,
    idempotencyKey: write.idempotencyKey,
    sourceAuthorityHash: write.sourceAuthorityHash,
    recordDigest: canonicalSha256(
      "programmable.custom-launch-website-record.v2",
      record as never,
    ),
    record,
  });
  return Object.freeze({
    ...rebuilt,
    requestDigest: canonicalSha256(
      "programmable.custom-launch-projection-write.v2",
      rebuilt as never,
    ),
  });
}

function rebuildCustomLaunchFeePolicy(
  write: ReturnType<typeof customLaunchWriteWithV4Market>,
  mutatePolicy: (policy: Record<string, unknown>) => Record<string, unknown>,
) {
  return rebuildCustomLaunchWrite(write, (record) => {
    const obligation = structuredClone(
      record.feeObligation as Record<string, unknown>,
    );
    const policy = mutatePolicy(
      structuredClone(obligation.policy as Record<string, unknown>),
    );
    const {
      feeObligationHash: _feeObligationHash,
      feeAssessmentObligationBindingHash: _bindingHash,
      ...obligationWithoutHashes
    } = obligation;
    void _feeObligationHash;
    void _bindingHash;
    const feePreimage = { ...obligationWithoutHashes, policy };
    const feeObligationHash = canonicalSha256(
      "programmable.launch-fee-obligation.v3",
      feePreimage as never,
    );
    const feeAssessmentObligationBindingHash = canonicalSha256(
      "programmable.launch-fee-assessment-obligation-binding.v3",
      {
        schemaVersion: "programmable.launch-fee-assessment-obligation-binding.v3",
        feeAssessmentHash: record.feeAssessmentHash as Sha256Digest,
        feeObligationHash,
      },
    );
    return {
      ...record,
      feeObligationHash,
      feeAssessmentObligationBindingHash,
      feeObligation: {
        ...feePreimage,
        feeObligationHash,
        feeAssessmentObligationBindingHash,
      },
    };
  });
}

function writeRequest(
  write: Readonly<{
    topic?: string;
    projectionKind?: string;
    projectionKey: string;
    idempotencyKey: Sha256Digest;
  }>,
  token: string,
): Request {
  const laneValue = write.topic ?? write.projectionKind;
  if (laneValue !== "website.entitlement"
    && laneValue !== "website.custom-launched") {
    throw new TypeError("test write lane is invalid");
  }
  return new Request(`https://website.invalid${route(
    write.projectionKey,
    laneValue,
  )}`, {
    method: "PUT",
    headers: writeHeaders(laneValue, write.idempotencyKey, token),
    body: canonicalizeJson(write as never),
  });
}

function privyRequest(): Request {
  return new Request("https://website.invalid/api/custom-launch/entitlements", {
    headers: {
      authorization: `Bearer ${"access-token".repeat(3)}`,
      "x-privy-identity-token": "identity-token".repeat(3),
    },
  });
}

function securityAttestationFixture(): ProjectionTargetSecurityAttestationRowV1 {
  return {
    runtime_role: "programmable_website_projection_runtime",
    session_role: "programmable_website_projection_runtime",
    rolsuper: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolreplication: false,
    rolbypassrls: false,
    schema_usage: true,
    schema_create: false,
    projections_select: true,
    projections_insert: true,
    projections_mutate: false,
    credentials_select: true,
    credentials_insert: true,
    credentials_mutate: false,
    registry_custom_select: true,
    registry_custom_insert: true,
    registry_custom_update: true,
    registry_custom_forbidden_mutate: false,
    projections_rls: true,
    projections_force_rls: true,
    credentials_rls: true,
    credentials_force_rls: true,
    registry_custom_rls: true,
    registry_custom_force_rls: true,
    expected_policies: true,
    provider_roles_excluded: true,
    ssl: true,
    ssl_version: "TLSv1.3",
    ssl_cipher: "TLS_AES_256_GCM_SHA384",
    ssl_bits: 256,
  };
}

type CustomLaunchFeeFixtureMode = "no-qualifying-market" | "standard" | "aeon";

const AEON_APPROVED_PLAN_RECIPIENT_FIXTURE =
  "0x4444444444444444444444444444444444444444";

function customLaunchFeeFixture(
  label: string,
  mode: CustomLaunchFeeFixtureMode,
  marketPathId: string | null,
) {
  const modelId = mode === "aeon" ? "aeon-agent-launch" : "custom-contract-graph-v2";
  const feeAssessmentHash = digest(`${label}:fee-assessment`);
  const commonPolicy = {
    schemaVersion: "programmable.custom-launch-fee-policy.v1",
    providerId: mode === "aeon" ? "aeon" : "programmable",
    modelId,
    templateId: mode === "aeon" ? "aeon-approved-model" : "standard-custom",
    semanticVersion: "1.0.0",
  } as const;
  const programmableRecipient = {
    namespace: "eip155:1",
    value: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
  } as const;
  const policy = mode === "no-qualifying-market"
    ? {
        ...commonPolicy,
        feeMode: "no-qualifying-market" as const,
        marketPathId: null,
        totalRatePpm: 0 as const,
        totalRateBps: 0 as const,
        chargeMode: "none" as const,
        normalProgrammableTenBpsApplied: false as const,
        legs: [] as const,
      }
    : mode === "aeon"
      ? {
          ...commonPolicy,
          providerId: "aeon" as const,
          feeMode: "aeon-partner-custom" as const,
          marketPathId: marketPathId!,
          totalRatePpm: 2000 as const,
          totalRateBps: 20 as const,
          chargeMode: "included-in-partner-total" as const,
          normalProgrammableTenBpsApplied: false as const,
          legs: [{
            role: "provider" as const,
            ratePpm: 1500 as const,
            rateBps: 15 as const,
            recipient: {
              namespace: "eip155:1",
              value: AEON_APPROVED_PLAN_RECIPIENT_FIXTURE,
            },
          }, {
            role: "programmable" as const,
            ratePpm: 500 as const,
            rateBps: 5 as const,
            recipient: programmableRecipient,
          }] as const,
        }
      : {
          ...commonPolicy,
          feeMode: "standard-programmable-custom" as const,
          marketPathId: marketPathId!,
          totalRatePpm: 1000 as const,
          totalRateBps: 10 as const,
          chargeMode: "added-on-top" as const,
          normalProgrammableTenBpsApplied: true as const,
          legs: [{
            role: "programmable" as const,
            ratePpm: 1000 as const,
            rateBps: 10 as const,
            recipient: programmableRecipient,
          }] as const,
        };
  const hasQualifyingMarket = mode !== "no-qualifying-market";
  const feePreimage = {
    schemaVersion: "programmable.launch-fee-obligation.v3",
    feeAssessmentHash,
    chainId: "1",
    chainProfileId: "ethereum-mainnet",
    chainProfileHash: digest(`${label}:custom-chain-profile`),
    policy,
    qualifyingFlowBasis: hasQualifyingMarket ? "qualifying swap volume" : null,
    qualifyingFlowBasisBindingHash: hasQualifyingMarket
      ? digest(`${label}:qualifying-flow`)
      : null,
    feeBasis: hasQualifyingMarket ? "gross-qualifying-flow-volume" as const : null,
    enforcementRouteId: hasQualifyingMarket ? "route-1" : null,
    enforcementRouteBindingHash: hasQualifyingMarket ? digest(`${label}:fee-route`) : null,
    enforcementModuleId: hasQualifyingMarket ? "fee-module-1" : null,
    enforcementModuleBindingHash: hasQualifyingMarket ? digest(`${label}:fee-module`) : null,
    claimSemantics: hasQualifyingMarket
      ? "leg-recipient-claimable-accruals" as const
      : "not-applicable" as const,
  } as const;
  const feeObligationHash = canonicalSha256(
    "programmable.launch-fee-obligation.v3",
    feePreimage,
  );
  const feeAssessmentObligationBindingHash = canonicalSha256(
    "programmable.launch-fee-assessment-obligation-binding.v3",
    {
      schemaVersion: "programmable.launch-fee-assessment-obligation-binding.v3",
      feeAssessmentHash,
      feeObligationHash,
    },
  );
  return {
    modelId,
    feeAssessmentHash,
    feeObligationHash,
    feeAssessmentObligationBindingHash,
    feeObligation: {
      ...feePreimage,
      feeObligationHash,
      feeAssessmentObligationBindingHash,
    },
  } as const;
}

function customLaunchWrite(label: string) {
  const configuration = lanes[1];
  const projectId = digest(`${label}:project`);
  const launchId = digest(`${label}:launch`);
  const fee = customLaunchFeeFixture(label, "no-qualifying-market", null);
  const {
    feeAssessmentHash,
    feeObligationHash,
    feeAssessmentObligationBindingHash,
  } = fee;
  const chainProfileHash = digest(`${label}:custom-chain-profile`);
  const primaryTokenMetadata = {
    schemaVersion: "programmable.discoverable-launch-token-metadata.v2",
    status: "available",
    source: "finality-resolved-onchain",
    name: "Programmable Test Token",
    symbol: "PTT",
    decimals: 18,
    evidenceHash: digest(`${label}:primary-token-metadata-evidence`),
  } as const;
  const primaryTokenMetadataHash = canonicalSha256(
    "programmable.discoverable-launch-token-metadata-hash.v2",
    primaryTokenMetadata,
  );
  const discoverableAssets = [{
    assetId: "primary-token",
    role: "primary-token",
    identity: {
      namespace: "eip155:1:erc20",
      value: "0x2222222222222222222222222222222222222222",
    },
    provenance: { kind: "launch-produced" },
    identityEvidenceHash: digest(`${label}:primary-token-identity-evidence`),
    onchainMetadata: primaryTokenMetadata,
    onchainMetadataHash: primaryTokenMetadataHash,
  }] as const;
  const assetIdentitySetHash = canonicalSha256(
    "programmable.discoverable-launch-asset-set-hash.v2",
    {
      schemaVersion: "programmable.discoverable-launch-asset-set.v2",
      advertisesToken: true,
      assets: discoverableAssets,
    },
  );
  const discoverableMarkets = [] as const;
  const marketSetHash = canonicalSha256(
    "programmable.discoverable-launch-market-set-hash.v2",
    {
      schemaVersion: "programmable.discoverable-launch-market-set.v2",
      assetIdentitySetHash,
      markets: discoverableMarkets,
    },
  );
  const registryPublicationBindingHash = digest(`${label}:registry-publication`);
  const launchingWallet = {
    namespace: "eip155:1",
    value: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  } as const;
  const postLaunchAuthorityInventoryPreimage = {
    schemaVersion: "programmable.post-launch-authority-inventory.v1",
    launchingWallet,
    addressBindings: [{
      bindingId: "launch-wallet-owner",
      targetId: "primary-token",
      phase: "constructor",
      byteOffset: 0,
      semanticRole: "launch-owner",
      classification: "post-launch-authority",
      authorityId: "launch-wallet-owner",
      rationale: "The reviewed constructor binds the launch wallet as owner.",
      locator: {
        kind: "launch-session-wallet",
        byteOffset: 0,
        encoding: "abi-address-word",
      },
      resolvedIdentity: launchingWallet,
    }],
    declaredIdentityBindings: [],
    postLaunchAuthorities: [{
      authorityId: "launch-wallet-owner",
      role: "launch-owner",
      authorityKind: "eoa",
      identity: launchingWallet,
      source: { kind: "launching-wallet" },
      postLaunchActions: ["update-project-settings"],
      feeRole: "creator",
      disclosure: {
        label: "Launch owner",
        description: "Can update the project settings declared by the reviewed contract.",
      },
      authorization: "declared-onchain-authority-only",
    }],
    confirmation: {
      mode: "artifact-bound-launching-wallet-intent",
      confirmingIdentity: launchingWallet,
      userVisibleDisclosureRequired: true,
    },
    postLaunchActionPolicy: "declared-onchain-authority-only",
    githubAuthority: "provenance-only-never-post-launch-authority",
  } as const;
  const postLaunchAuthorityInventoryHash = canonicalSha256(
    "programmable.post-launch-authority-inventory.v1",
    postLaunchAuthorityInventoryPreimage,
  );
  const postLaunchAuthorityInventory = {
    ...postLaunchAuthorityInventoryPreimage,
    postLaunchAuthorityInventoryHash,
  } as const;
  const record = {
    schemaVersion: "programmable.custom-launch-website-record.v2",
    platformId: "programmable",
    origin: "programmable",
    category: "custom",
    launchFamily: "custom",
    modelId: fee.modelId,
    sourceKind: "browser-wallet-report",
    sourceRecordBindingHash: digest(`${label}:source-record`),
    finalizedLaunchBindingHash: digest(`${label}:finalized-launch`),
    status: "launched",
    action: "view_live_launch",
    projectId,
    launchId,
    githubPrincipalHash: canonicalSha256(
      "programmable.github-submitter-principal.v1",
      { githubUserId: GITHUB_USER_ID },
    ),
    chainId: "1",
    chainProfileId: "ethereum-mainnet",
    chainProfileHash,
    launchIdentity: {
      namespace: "eip155:1:erc20",
      value: "0x2222222222222222222222222222222222222222",
    },
    launchingWallet,
    postLaunchAuthorityInventory,
    postLaunchAuthorityInventoryHash,
    launchTransactionId: `0x${"3".repeat(64)}`,
    launchRouteId: "route-1",
    executionMode: "direct",
    advertisesToken: true,
    discoverableAssets,
    assetIdentitySetHash,
    discoverableMarkets,
    marketSetHash,
    feeAssessmentHash,
    feeObligationHash,
    feeAssessmentObligationBindingHash,
    feeObligation: fee.feeObligation,
    registryPublicationBindingHash,
    registryAdapterBindingHash: digest(`${label}:registry-adapter`),
    projectionRuntimeBindingHash: digest(`${label}:projection-runtime`),
    registryObservationDigest: digest(`${label}:registry-observation`),
    registryTargetBindingHash: digest(`${label}:registry-target`),
    presentationVersion: null,
    presentationBindingHash: null,
    presentation: null,
    websiteProjectionGeneration: "1",
    launchedAt: "2026-08-05T11:30:00.000Z",
    finalizedAt: "2026-08-05T11:31:00.000Z",
  } as const;
  const withoutRequestDigest = {
    schemaVersion: "programmable.custom-launch-projection-write.v2",
    targetBindingHash: configuration.targetBindingHash,
    projectionKind: "website.custom-launched",
    projectionKey: `custom:${launchId}`,
    projectId,
    launchId,
    idempotencyKey: digest(`${label}:idempotency`),
    sourceAuthorityHash: registryPublicationBindingHash,
    recordDigest: canonicalSha256(
      "programmable.custom-launch-website-record.v2",
      record,
    ),
    record,
  } as const;
  return Object.freeze({
    ...withoutRequestDigest,
    requestDigest: canonicalSha256(
      "programmable.custom-launch-projection-write.v2",
      withoutRequestDigest,
    ),
  });
}

function registryCustomMaterialization(
  launched: Readonly<{
    projectId: Sha256Digest;
    launchId: Sha256Digest;
    record: unknown;
  }>,
  state: "pending" | "finalized" | "corrected" | "revoked" | "reorged",
  generation: string,
) {
  const project = parseAuthenticatedCustomLaunchProjectV2(launched.record);
  const publicRecord = parseRegistryCustomLaunchPublicRecordV1({
    schemaVersion: "programmable.registry-custom-launch-public-record.v1",
    projectId: launched.projectId,
    launchId: launched.launchId,
    registry: {
      chainId: project.chainId,
      registryAddress: "0x1111111111111111111111111111111111111111",
      startBlock: "100",
    },
    event: {
      transactionHash: project.launchTransactionId,
      blockHash: `0x${"5".repeat(64)}`,
      blockNumber: "112",
      transactionIndex: 0,
      logIndex: 7,
    },
    finality: {
      observedHeadBlockNumber: "123",
      observedHeadBlockHash: `0x${"6".repeat(64)}`,
      requiredConfirmations: 12,
      policyBindingHash: digest("registry-finality-policy"),
      evidenceBindingHash: digest("registry-finality-evidence"),
    },
    configurationHash: `0x${"4".repeat(64)}`,
    provider: {
      providerId: "programmable-approval-service",
      modelId: project.modelId,
      modelVersion: "2.0.0",
      marketPath: project.discoverableMarkets.length === 0
        ? null
        : "markets/primary.json",
    },
    github: {
      repositoryOwner: "example-owner",
      repositoryId: "654321",
      commitObjectId: "a".repeat(40),
      treeObjectId: "b".repeat(40),
    },
    approval: {
      approvalId: "approval-registry-public-lifecycle",
      approvalBindingHash: digest("registry-approval"),
      launchPlanPath: "launch/plan.json",
      launchPlanBindingHash: digest("registry-launch-plan"),
    },
    runtime: {
      launchRouteId: project.launchRouteId,
      executionMode: project.executionMode,
      registryAdapterBindingHash: project.registryAdapterBindingHash,
      projectionRuntimeBindingHash: project.projectionRuntimeBindingHash,
      registryTargetBindingHash: project.registryTargetBindingHash,
    },
    fee: {
      feeAssessmentHash: project.feeAssessmentHash,
      feeObligationHash: project.feeObligationHash,
      feeAssessmentObligationBindingHash:
        project.feeAssessmentObligationBindingHash,
      obligation: project.feeObligation,
    },
    roles: {
      launchingWallet: project.launchingWallet,
      postLaunchAuthorityInventoryHash:
        project.postLaunchAuthorityInventoryHash,
      postLaunchAuthorityInventory: project.postLaunchAuthorityInventory,
    },
    project,
  });
  const record = state === "finalized" ? publicRecord : null;
  return Object.freeze({
    schemaVersion: "programmable.registry-custom-launch-materialization.v1",
    sourceLane: "registry.custom-launched",
    generation,
    observedAt: `2026-08-05T11:${String(Number(generation) + 31).padStart(2, "0")}:00.000Z`,
    projectId: launched.projectId,
    launchId: launched.launchId,
    state,
    lifecycleBindingHash: digest(`registry-lifecycle-${generation}-${state}`),
    launchSecurityBindingHash:
      registryCustomLaunchSecurityBindingHashV1(publicRecord),
    record,
  });
}

async function materializeRegistryCustom(
  store: PostgresRegistryCustomLaunchPublicStoreV1,
  materialization: unknown,
) {
  const signal = new AbortController().signal;
  const projection = await authenticateRegistryCustomLaunchProjectionV1({
    materialization,
    signal,
    authenticator: registryProjectionAuthenticator(async (evidence) =>
      evidence.sourceLane === "registry.custom-launched"
      && evidence.lifecycleBindingHash.startsWith("sha256:")
      && evidence.canonicalMaterialization.includes(
        '"sourceLane":"registry.custom-launched"',
      ),
    ),
  });
  return store.materializeAuthenticated({ projection, signal });
}

function registryProjectionAuthenticator(
  verifyCanonicalMaterialization: Parameters<
    typeof createRegistryCustomLaunchProjectionAuthenticatorV1
  >[0]["verifyCanonicalMaterialization"],
) {
  return createRegistryCustomLaunchProjectionAuthenticatorV1({
    verifierBindingHash: digest("registry-projection-authenticator"),
    verifyCanonicalMaterialization,
  });
}

function customLaunchWriteWithV4Market(
  label: string,
  feeMode: "standard" | "aeon" = "standard",
) {
  const base = customLaunchWrite(label);
  return rebuildCustomLaunchWrite(base, (record) => {
    const currency0 = "0x1111111111111111111111111111111111111111";
    const currency1 = "0x2222222222222222222222222222222222222222";
    const poolId = uniswapV4PoolId(currency0, currency1, "3000", "60", null);
    const primaryTokenMetadata = {
      schemaVersion: "programmable.discoverable-launch-token-metadata.v2",
      status: "available",
      source: "finality-resolved-onchain",
      name: "Programmable Test Token",
      symbol: "PTT",
      decimals: 18,
      evidenceHash: digest(`${label}:primary-token-metadata-evidence`),
    } as const;
    const primaryTokenMetadataHash = canonicalSha256(
      "programmable.discoverable-launch-token-metadata-hash.v2",
      primaryTokenMetadata,
    );
    const discoverableAssets = [
      {
        assetId: "pool",
        role: "pool",
        identity: {
          namespace: "eip155:1:uniswap-v4-pool-id",
          value: poolId,
        },
        provenance: { kind: "launch-produced" },
        identityEvidenceHash: digest(`${label}:pool-identity-evidence`),
        onchainMetadata: null,
        onchainMetadataHash: null,
      },
      {
        assetId: "primary-token",
        role: "primary-token",
        identity: {
          namespace: "eip155:1",
          value: currency1,
        },
        provenance: { kind: "launch-produced" },
        identityEvidenceHash: digest(`${label}:primary-token-identity-evidence`),
        onchainMetadata: primaryTokenMetadata,
        onchainMetadataHash: primaryTokenMetadataHash,
      },
      {
        assetId: "secondary-token",
        role: "secondary-token",
        identity: {
          namespace: "eip155:1",
          value: currency0,
        },
        provenance: {
          kind: "protocol-external",
          relationship: "quote currency",
        },
        identityEvidenceHash: digest(`${label}:secondary-token-identity-evidence`),
        onchainMetadata: null,
        onchainMetadataHash: null,
      },
    ] as const;
    const assetIdentitySetHash = canonicalSha256(
      "programmable.discoverable-launch-asset-set-hash.v2",
      {
        schemaVersion: "programmable.discoverable-launch-asset-set.v2",
        advertisesToken: true,
        assets: discoverableAssets,
      },
    );
    const discoverableMarkets = [{
      marketId: "uniswap-v4-primary-secondary",
      kind: "uniswap-v4-pool",
      status: "active",
      marketAssetId: "pool",
      baseAssetId: "primary-token",
      quoteAssetId: "secondary-token",
      marketEvidenceHash: digest(`${label}:market-evidence`),
      verification: {
        status: "verified",
        verifierAdapterId: "uniswap-v4-pool-finality:v2",
        verifierBindingHash: digest(`${label}:market-verifier`),
      },
      uniswapV4: {
        poolId,
        poolManager: {
          namespace: "eip155:1",
          value: "0x5555555555555555555555555555555555555555",
        },
        poolManagerReviewEvidenceBindingHash:
          digest(`${label}:pool-manager-review`),
        poolManagerInterfaceEvidenceBindingHash:
          digest(`${label}:pool-manager-interface`),
        poolManagerRuntimeCodeKeccak256: `0x${"6".repeat(64)}`,
        poolManagerRuntimeCodeSha256: digest(`${label}:pool-manager-runtime`),
        currency0AssetId: "secondary-token",
        currency1AssetId: "primary-token",
        feeRaw: "3000",
        dynamicFee: false,
        tickSpacing: "60",
        hooksAssetId: null,
        poolKeyEvidenceHash: digest(`${label}:pool-key-evidence`),
      },
    }] as const;
    const marketSetHash = canonicalSha256(
      "programmable.discoverable-launch-market-set-hash.v2",
      {
        schemaVersion: "programmable.discoverable-launch-market-set.v2",
        assetIdentitySetHash,
        markets: discoverableMarkets,
      },
    );
    const fee = customLaunchFeeFixture(
      label,
      feeMode,
      "uniswap-v4-primary-secondary",
    );
    return {
      ...record,
      modelId: fee.modelId,
      advertisesToken: true,
      discoverableAssets,
      assetIdentitySetHash,
      discoverableMarkets,
      marketSetHash,
      feeAssessmentHash: fee.feeAssessmentHash,
      feeObligationHash: fee.feeObligationHash,
      feeAssessmentObligationBindingHash:
        fee.feeAssessmentObligationBindingHash,
      feeObligation: fee.feeObligation,
    };
  });
}

function uniswapV4PoolId(
  currency0: string,
  currency1: string,
  feeRaw: string,
  tickSpacing: string,
  hooks: string | null,
): `0x${string}` {
  return keccak256(encodeAbiParameters(
    [
      { type: "address" },
      { type: "address" },
      { type: "uint24" },
      { type: "int24" },
      { type: "address" },
    ],
    [
      currency0 as Address,
      currency1 as Address,
      Number(feeRaw),
      Number(tickSpacing),
      (hooks ?? "0x0000000000000000000000000000000000000000") as Address,
    ],
  ));
}

function withDiscoverableSetHashes(
  record: Record<string, unknown>,
  discoverableAssets: Array<Record<string, unknown>>,
  discoverableMarkets: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const assetIdentitySetHash = canonicalSha256(
    "programmable.discoverable-launch-asset-set-hash.v2",
    {
      schemaVersion: "programmable.discoverable-launch-asset-set.v2",
      advertisesToken: record.advertisesToken as boolean,
      assets: discoverableAssets,
    } as never,
  );
  const marketSetHash = canonicalSha256(
    "programmable.discoverable-launch-market-set-hash.v2",
    {
      schemaVersion: "programmable.discoverable-launch-market-set.v2",
      assetIdentitySetHash,
      markets: discoverableMarkets,
    } as never,
  );
  return {
    ...record,
    discoverableAssets,
    assetIdentitySetHash,
    discoverableMarkets,
    marketSetHash,
  };
}

async function expectProjectionTargetCounts(
  pool: ProjectionTargetPostgresPoolV1,
  expected: Readonly<{ projections: string; credentials: string }>,
): Promise<void> {
  const counts = await pool.query<{ projections: string; credentials: string }>(`
    SELECT
      (SELECT count(*)::text
         FROM programmable_website_projection_v1.projection_records)
        AS projections,
      (SELECT count(*)::text
         FROM programmable_website_projection_v1.credential_uses)
        AS credentials
  `);
  expect(counts.rows[0]).toEqual(expected);
}

type WebsiteProjectionLane =
  | "website.entitlement"
  | "website.custom-launched";

function workloadToken(input: Readonly<{
  method: "GET" | "PUT";
  lane: WebsiteProjectionLane;
  projectionKey: string;
  idempotencyKey?: Sha256Digest;
  requestDigest?: Sha256Digest;
  jti: string;
  subject?: string;
}>): string {
  const configuration = lanes.find(({ lane: value }) => value === input.lane)!;
  const header = canonicalizeJson({
    alg: "EdDSA",
    kid: "workload-key-2026-08",
    typ: "JWT",
  });
  const payload = canonicalizeJson({
    schemaVersion: "programmable.projection-workload-access-token.v2",
    iss: "programmable-workload-issuer",
    sub: input.subject ?? "programmable-approval-service",
    aud: lanes[0].audience,
    iat: Math.floor(NOW.getTime() / 1_000) - 30,
    exp: Math.floor(NOW.getTime() / 1_000) + 300,
    jti: input.jti,
    method: input.method,
    lane: input.lane,
    targetBindingHash: configuration.targetBindingHash,
    projectionKey: input.projectionKey,
    ...(input.method === "PUT"
      ? {
        idempotencyKey: input.idempotencyKey!,
        requestDigest: input.requestDigest!,
      }
      : {}),
  });
  const encodedHeader = Buffer.from(header).toString("base64url");
  const encodedPayload = Buffer.from(payload).toString("base64url");
  const signature = sign(
    null,
    Buffer.from(`${encodedHeader}.${encodedPayload}`, "ascii"),
    privateKey,
  ).toString("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function workloadTokenForWrite(
  write: Readonly<{
    topic?: string;
    projectionKind?: string;
    projectionKey: string;
    idempotencyKey: Sha256Digest;
    requestDigest: Sha256Digest;
  }>,
  jti: string,
  subject?: string,
): string {
  const laneValue = write.topic ?? write.projectionKind;
  if (laneValue !== "website.entitlement"
    && laneValue !== "website.custom-launched") {
    throw new TypeError("test workload lane is invalid");
  }
  return workloadToken({
    method: "PUT",
    lane: laneValue,
    projectionKey: write.projectionKey,
    idempotencyKey: write.idempotencyKey,
    requestDigest: write.requestDigest,
    jti,
    subject,
  });
}

function workloadTokenForRead(
  laneValue: WebsiteProjectionLane,
  projectionKey: string,
  jti: string,
): string {
  return workloadToken({
    method: "GET",
    lane: laneValue,
    projectionKey,
    jti,
  });
}

function tokenForConformanceRequest(path: string, init: RequestInit): string {
  const method = init.method;
  if (method !== "GET" && method !== "PUT") {
    throw new TypeError("conformance workload method is invalid");
  }
  const laneValue: WebsiteProjectionLane = path.includes("website-entitlements")
    ? "website.entitlement"
    : "website.custom-launched";
  const projectionKey = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1));
  const body = method === "PUT"
    ? JSON.parse(String(init.body)) as { requestDigest: Sha256Digest }
    : null;
  const headers = new Headers(init.headers);
  const idempotencyKey = method === "PUT"
    ? headers.get("idempotency-key") as Sha256Digest
    : undefined;
  const jti = canonicalSha256(
    "programmable.website-conformance-credential.v2",
    {
      method,
      lane: laneValue,
      projectionKey,
      idempotencyKey: idempotencyKey ?? null,
      requestDigest: body?.requestDigest ?? null,
    },
  ).replace("sha256:", "conformance-");
  return workloadToken({
    method,
    lane: laneValue,
    projectionKey,
    ...(method === "PUT"
      ? { idempotencyKey, requestDigest: body!.requestDigest }
      : {}),
    jti,
  });
}

function readHeaders(
  laneValue: "website.entitlement" | "website.custom-launched",
  token: string,
): Record<string, string> {
  const configuration = lanes.find(({ lane: current }) => current === laneValue)!;
  return {
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "x-programmable-audience": configuration.audience,
    "x-programmable-target-binding": configuration.targetBindingHash,
    ...(laneValue === "website.custom-launched"
      ? { "x-programmable-projection-kind": laneValue }
      : {}),
  };
}

function writeHeaders(
  laneValue: "website.entitlement" | "website.custom-launched",
  idempotencyKey: Sha256Digest,
  token: string,
): Record<string, string> {
  return {
    ...readHeaders(laneValue, token),
    "content-type": "application/json; charset=utf-8",
    "idempotency-key": idempotencyKey,
  };
}

function route(
  projectionKey: string,
  laneValue: "website.entitlement" | "website.custom-launched",
): string {
  const encoded = encodeURIComponent(projectionKey);
  return laneValue === "website.entitlement"
    ? `/v1/internal/projections/website-entitlements/${encoded}`
    : `/v2/internal/projections/custom-launches/${encoded}`;
}

function githubPrincipal(githubUserId: string): AuthenticatedGitHubPrincipalV1 {
  return Object.freeze({
    privyUserId: `did:privy:${githubUserId}`,
    githubUserId,
    githubUsername: `user-${githubUserId}`,
    githubPrincipalHash: canonicalSha256(
      "programmable.github-submitter-principal.v1",
      { githubUserId },
    ),
  });
}

function digest(label: string): Sha256Digest {
  return canonicalSha256(
    "programmable.website-projection-target-test.v1",
    { label },
  );
}
