import { createHash, generateKeyPairSync } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createCustomLaunchDeploymentReadinessHandlerV1,
} from "../lib/server/custom-launch/deployment-readiness";
import {
  attestGitHubSessionAuthorityConfigurationV1,
} from "../lib/server/custom-launch/github-session-authority-v1";
// @ts-expect-error JavaScript release helper has no declaration file.
import { computeSessionAuthorityRuntimeConfigurationHash } from "../scripts/verify-custom-launch-release-record.mjs";

const NOW = new Date("2026-08-05T12:00:00.000Z");
const PACKAGE_ARTIFACT_HASH = `sha256:${"9".repeat(64)}`;
const rawPermitPublicKey = Buffer.alloc(32, 7);
const permitSigner = {
  keyId: "launch-permit-primary",
  signerEpoch: "1",
  signerComponentBindingHash: `sha256:${"a".repeat(64)}`,
  publicKeyBase64Url: rawPermitPublicKey.toString("base64url"),
  publicKeySpkiSha256: `sha256:${createHash("sha256").update(Buffer.concat([
    Buffer.from("302a300506032b6570032100", "hex"),
    rawPermitPublicKey,
  ])).digest("hex")}`,
};
const sessionAuthorityKey = generateKeyPairSync("ed25519");
const sessionAuthorityWorkloadKey = generateKeyPairSync("ed25519");
const sessionAuthorityConfiguration = {
  PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_AUDIENCE:
    "programmable.github-session-authority.v1",
  PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_KEY_ID: "github-session-v1",
  PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_KEY_EPOCH: "1",
  PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_PRIVATE_KEY_PEM:
    sessionAuthorityKey.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_PUBLIC_KEY_SPKI_SHA256:
    `sha256:${createHash("sha256").update(sessionAuthorityKey.publicKey.export({
      format: "der",
      type: "spki",
    })).digest("hex")}`,
  PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_ISSUER:
    "programmable-authority-token-broker-v1",
  PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_SUBJECT: "approval-runtime-v1",
  PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_KEY_ID: "workload-access-v1",
  PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_PUBLIC_KEY_PEM:
    sessionAuthorityWorkloadKey.publicKey.export({ format: "pem", type: "spki" }).toString(),
  PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_PUBLIC_KEY_SPKI_SHA256:
    `sha256:${createHash("sha256").update(sessionAuthorityWorkloadKey.publicKey.export({
      format: "der",
      type: "spki",
    })).digest("hex")}`,
};
const configured = {
  PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED: "true",
  PROGRAMMABLE_APPROVAL_SERVICE_V2_ORIGIN: "https://approval.programmable.example",
  PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH: PACKAGE_ARTIFACT_HASH,
  PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE: "manual_review",
  NEXT_PUBLIC_PRIVY_APP_ID: "privy-app",
  PRIVY_APP_SECRET: "privy-secret",
  PROGRAMMABLE_LAUNCH_PERMIT_SIGNERS_V2_JSON: JSON.stringify([permitSigner]),
  ...sessionAuthorityConfiguration,
  PROGRAMMABLE_RELEASE_COMMIT_SHA: "1".repeat(40),
  VERCEL_URL: "programmable-immutable-abc.vercel.app",
};
const sessionAuthorityAttestation =
  attestGitHubSessionAuthorityConfigurationV1(configured);

function request(extra: RequestInit = {}): Request {
  return new Request("https://programmable.example/api/custom-launch/readiness", {
    headers: { accept: "application/json" },
    ...extra,
  });
}

function readyServiceResponse(body: unknown = {
  schemaVersion: "2.0.0",
  requestId: "deployment-probe",
  data: {
    status: "ready",
    release: { packageArtifactHash: PACKAGE_ARTIFACT_HASH },
    reviewAuthorityMode: "manual_review",
  },
}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

describe("Custom launch deployment readiness", () => {
  it("matches the release record's cross-language runtime configuration hash", () => {
    expect(computeSessionAuthorityRuntimeConfigurationHash({
      identity: {
        privyApplicationId: configured.NEXT_PUBLIC_PRIVY_APP_ID,
      },
      sessionAuthority: {
        audience:
          configured.PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_AUDIENCE,
        keyId: configured.PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_KEY_ID,
        keyEpoch:
          configured.PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_KEY_EPOCH,
        authorityPublicKeySpkiSha256:
          configured.PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_PUBLIC_KEY_SPKI_SHA256,
        workloadIssuer:
          configured.PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_ISSUER,
        workloadSubject:
          configured.PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_SUBJECT,
        workloadKeyId:
          configured.PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_KEY_ID,
        workloadPublicKeySpkiSha256:
          configured.PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_PUBLIC_KEY_SPKI_SHA256,
      },
    })).toBe(sessionAuthorityAttestation.configurationHash);
  });

  it("reports disabled only after the complete dark deployment is ready", async () => {
    const serviceFetch = vi.fn<typeof fetch>().mockResolvedValue(readyServiceResponse());
    const database = vi.fn<() => Promise<void>>().mockResolvedValue();
    const handler = createCustomLaunchDeploymentReadinessHandlerV1({
      environment: { ...configured, PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED: "false" },
      serviceFetch,
      assertWebsiteProjectionDatabaseReadiness: database,
      now: () => NOW,
    });
    const response = await handler(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      schemaVersion: "programmable.custom-launch-deployment-readiness.v1",
      status: "disabled",
      chainId: "1",
      components: {
        approvalService: "ready",
        githubSessionAuthority: "ready",
        permitSignerKeyring: "ready",
        publicConfiguration: "ready",
        websiteProjectionDatabase: "ready",
      },
      approvalServiceRelease: {
        packageArtifactHash: PACKAGE_ARTIFACT_HASH,
        reviewAuthorityMode: "manual_review",
      },
      sessionAuthority: sessionAuthorityAttestation,
      release: {
        commitSha: "1".repeat(40),
        deploymentHost: "programmable-immutable-abc.vercel.app",
      },
      checkedAt: NOW.toISOString(),
    });
    expect(serviceFetch).toHaveBeenCalledOnce();
    expect(database).toHaveBeenCalledOnce();
  });

  it("does not accept an off switch as dark readiness when dependencies are missing", async () => {
    const handler = createCustomLaunchDeploymentReadinessHandlerV1({
      environment: {
        PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED: "false",
        PROGRAMMABLE_RELEASE_COMMIT_SHA: "1".repeat(40),
        VERCEL_URL: "programmable-immutable-abc.vercel.app",
      },
      serviceFetch: vi.fn<typeof fetch>(),
      assertWebsiteProjectionDatabaseReadiness: vi.fn<() => Promise<void>>(),
      now: () => NOW,
    });
    const response = await handler(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "unready" });
  });

  it("reports ready only after database, service and signer bindings pass", async () => {
    const serviceFetch = vi.fn<typeof fetch>().mockResolvedValue(readyServiceResponse());
    const database = vi.fn<() => Promise<void>>().mockResolvedValue();
    const handler = createCustomLaunchDeploymentReadinessHandlerV1({
      environment: configured,
      serviceFetch,
      assertWebsiteProjectionDatabaseReadiness: database,
      now: () => NOW,
    });
    const response = await handler(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      schemaVersion: "programmable.custom-launch-deployment-readiness.v1",
      status: "ready",
      chainId: "1",
      components: {
        approvalService: "ready",
        githubSessionAuthority: "ready",
        permitSignerKeyring: "ready",
        publicConfiguration: "ready",
        websiteProjectionDatabase: "ready",
      },
      approvalServiceRelease: {
        packageArtifactHash: PACKAGE_ARTIFACT_HASH,
        reviewAuthorityMode: "manual_review",
      },
      sessionAuthority: sessionAuthorityAttestation,
      release: {
        commitSha: "1".repeat(40),
        deploymentHost: "programmable-immutable-abc.vercel.app",
      },
      checkedAt: NOW.toISOString(),
    });
    expect(body.trustedTimePath).toBe(
      `/api/custom-launch/trusted-time?${new URLSearchParams({
        keyId: permitSigner.keyId,
        signerEpoch: permitSigner.signerEpoch,
        signerComponentBindingHash: permitSigner.signerComponentBindingHash,
        publicKeySpkiSha256: permitSigner.publicKeySpkiSha256,
      }).toString()}`,
    );
    expect(database).toHaveBeenCalledOnce();
    expect(serviceFetch).toHaveBeenCalledWith(
      new URL("https://approval.programmable.example/readyz"),
      expect.objectContaining({ method: "GET", redirect: "error" }),
    );
  });

  it("fails closed when an enabled configuration is incomplete", async () => {
    const handler = createCustomLaunchDeploymentReadinessHandlerV1({
      environment: { ...configured, PRIVY_APP_SECRET: "" },
      serviceFetch: vi.fn<typeof fetch>(),
      assertWebsiteProjectionDatabaseReadiness: vi.fn<() => Promise<void>>(),
      now: () => NOW,
    });
    const response = await handler(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "unready",
      code: "custom_launch_not_ready",
      chainId: "1",
    });
  });

  it("fails closed when the GitHub session authority is missing or key-substituted", async () => {
    for (const environment of [
      {
        ...configured,
        PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_AUDIENCE: undefined,
      },
      {
        ...configured,
        PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_PUBLIC_KEY_SPKI_SHA256:
          `sha256:${"f".repeat(64)}`,
      },
      {
        ...configured,
        PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_WORKLOAD_PUBLIC_KEY_SPKI_SHA256:
          `sha256:${"e".repeat(64)}`,
      },
    ]) {
      const handler = createCustomLaunchDeploymentReadinessHandlerV1({
        environment,
        serviceFetch: vi.fn<typeof fetch>(),
        assertWebsiteProjectionDatabaseReadiness: vi.fn<() => Promise<void>>(),
        now: () => NOW,
      });
      expect((await handler(request())).status).toBe(503);
    }
  });

  it("does not mistake an absent or misspelled switch for an intentional disable", async () => {
    for (const value of [undefined, "TRUE", " false"]) {
      const handler = createCustomLaunchDeploymentReadinessHandlerV1({
        environment: {
          ...configured,
          PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED: value,
        },
        serviceFetch: vi.fn<typeof fetch>(),
        assertWebsiteProjectionDatabaseReadiness: vi.fn<() => Promise<void>>(),
        now: () => NOW,
      });
      expect((await handler(request())).status).toBe(503);
    }
  });

  it("fails closed when the immutable release identity is missing or malformed", async () => {
    for (const environment of [
      { ...configured, PROGRAMMABLE_RELEASE_COMMIT_SHA: undefined },
      { ...configured, PROGRAMMABLE_RELEASE_COMMIT_SHA: "A".repeat(40) },
      { ...configured, VERCEL_URL: "https://programmable.example" },
    ]) {
      const handler = createCustomLaunchDeploymentReadinessHandlerV1({
        environment,
        serviceFetch: vi.fn<typeof fetch>().mockResolvedValue(readyServiceResponse()),
        assertWebsiteProjectionDatabaseReadiness: vi.fn<() => Promise<void>>().mockResolvedValue(),
        now: () => NOW,
      });
      expect((await handler(request())).status).toBe(503);
    }
  });

  it("fails closed when the expected backend release identity is missing or malformed", async () => {
    for (const environment of [
      { ...configured, PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH: undefined },
      { ...configured, PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH: `sha256:${"A".repeat(64)}` },
      { ...configured, PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE: undefined },
      { ...configured, PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE: "unconfigured" },
    ]) {
      const serviceFetch = vi.fn<typeof fetch>().mockResolvedValue(readyServiceResponse());
      const handler = createCustomLaunchDeploymentReadinessHandlerV1({
        environment,
        serviceFetch,
        assertWebsiteProjectionDatabaseReadiness: vi.fn<() => Promise<void>>().mockResolvedValue(),
        now: () => NOW,
      });
      expect((await handler(request())).status).toBe(503);
      expect(serviceFetch).not.toHaveBeenCalled();
    }
  });

  it("accepts autonomous AI only when expected and runtime modes match exactly", async () => {
    const environment = {
      ...configured,
      PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE: "autonomous_ai",
    };
    const handler = createCustomLaunchDeploymentReadinessHandlerV1({
      environment,
      serviceFetch: vi.fn<typeof fetch>().mockResolvedValue(readyServiceResponse({
        schemaVersion: "2.0.0",
        requestId: "deployment-probe",
        data: {
          status: "ready",
          release: { packageArtifactHash: PACKAGE_ARTIFACT_HASH },
          reviewAuthorityMode: "autonomous_ai",
        },
      })),
      assertWebsiteProjectionDatabaseReadiness: vi.fn<() => Promise<void>>().mockResolvedValue(),
      now: () => NOW,
    });
    await expect((await handler(request())).json()).resolves.toMatchObject({
      status: "ready",
      approvalServiceRelease: { reviewAuthorityMode: "autonomous_ai" },
    });
  });

  it("rejects a ready backend with a missing, wrong or substituted release identity", async () => {
    const serviceBodies = [
      {
        schemaVersion: "2.0.0",
        requestId: "deployment-probe",
        data: { status: "ready" },
      },
      {
        schemaVersion: "2.0.0",
        requestId: "deployment-probe",
        data: {
          status: "ready",
          release: { packageArtifactHash: `sha256:${"8".repeat(64)}` },
          reviewAuthorityMode: "manual_review",
        },
      },
      {
        schemaVersion: "2.0.0",
        requestId: "deployment-probe",
        data: {
          status: "ready",
          release: { packageArtifactHash: PACKAGE_ARTIFACT_HASH },
          reviewAuthorityMode: "autonomous_ai",
        },
      },
      {
        schemaVersion: "2.0.0",
        requestId: "deployment-probe",
        data: {
          status: "ready",
          release: { packageArtifactHash: PACKAGE_ARTIFACT_HASH, unexpected: true },
          reviewAuthorityMode: "manual_review",
        },
      },
    ];
    for (const body of serviceBodies) {
      const handler = createCustomLaunchDeploymentReadinessHandlerV1({
        environment: configured,
        serviceFetch: vi.fn<typeof fetch>().mockResolvedValue(readyServiceResponse(body)),
        assertWebsiteProjectionDatabaseReadiness: vi.fn<() => Promise<void>>().mockResolvedValue(),
        now: () => NOW,
      });
      expect((await handler(request())).status).toBe(503);
    }
  });

  it.each([
    ["database", async () => { throw new Error("unavailable"); }, async () => readyServiceResponse()],
    ["service status", async () => {}, async () => new Response("{}", {
      status: 503,
      headers: { "content-type": "application/json" },
    })],
    ["service redirect", async () => {}, async () => new Response(null, {
      status: 302,
      headers: { location: "https://old-approval.programmable.example/readyz" },
    })],
    ["service schema", async () => {}, async () => readyServiceResponse({
      schemaVersion: "2.0.0",
      requestId: "deployment-probe",
      data: {
        status: "ok",
        release: { packageArtifactHash: PACKAGE_ARTIFACT_HASH },
        reviewAuthorityMode: "manual_review",
      },
    })],
  ])("fails closed on %s failure", async (_name, database, serviceFetch) => {
    const handler = createCustomLaunchDeploymentReadinessHandlerV1({
      environment: configured,
      serviceFetch: serviceFetch as typeof fetch,
      assertWebsiteProjectionDatabaseReadiness: database,
      now: () => NOW,
    });
    const response = await handler(request());
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ status: "unready" });
  });

  it("rejects query strings, request bodies and missing JSON accept headers", async () => {
    const handler = createCustomLaunchDeploymentReadinessHandlerV1({
      environment: configured,
      serviceFetch: vi.fn<typeof fetch>(),
      assertWebsiteProjectionDatabaseReadiness: vi.fn<() => Promise<void>>(),
      now: () => NOW,
    });
    for (const invalid of [
      new Request("https://programmable.example/api/custom-launch/readiness?verbose=1", {
        headers: { accept: "application/json" },
      }),
      new Request("https://programmable.example/api/custom-launch/readiness"),
      request({ method: "POST", body: "{}", headers: {
        accept: "application/json",
        "content-type": "application/json",
      } }),
    ]) {
      expect((await handler(invalid)).status).toBe(400);
    }
  });
});
