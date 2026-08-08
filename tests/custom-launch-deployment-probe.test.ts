import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

// @ts-expect-error JavaScript deployment helper has no declaration file.
import { parseCustomLaunchDeploymentProbeArguments, probeCustomLaunchDeployment } from "../scripts/custom-launch-deployment-probe-core.mjs";

const NOW = new Date("2026-08-05T12:00:00.000Z");
const HASH = `sha256:${"1".repeat(64)}`;
const PACKAGE_ARTIFACT_HASH = `sha256:${"9".repeat(64)}`;
const SESSION_AUTHORITY_PUBLIC_KEY_HASH = `sha256:${"2".repeat(64)}`;
const SESSION_AUTHORITY_WORKLOAD_KEY_HASH = `sha256:${"3".repeat(64)}`;
const COMMIT_SHA = "a".repeat(40);
const DEPLOYMENT_HOST = "deployment.example";
const OWN_APPLICATION_ID = "application-owned";
const OWN_APPLICATION_HANDLE = `github-${"a".repeat(64)}`;
const FOREIGN_APPLICATION_HANDLE = `github-${"b".repeat(64)}`;
const TRUSTED_TIME_PATH = "/api/custom-launch/trusted-time?keyId=current"
  + `&signerEpoch=1&signerComponentBindingHash=${encodeURIComponent(HASH)}`
  + `&publicKeySpkiSha256=${encodeURIComponent(HASH)}`;

function canonicalSha256(domain: string, value: Record<string, string>) {
  const canonical = `{${Object.keys(value)
    .sort((left, right) => Buffer.from(left).compare(Buffer.from(right)))
    .map((key) => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`)
    .join(",")}}`;
  return `sha256:${createHash("sha256")
    .update(domain, "utf8")
    .update(Uint8Array.of(0))
    .update(canonical, "utf8")
    .digest("hex")}`;
}

const SESSION_AUTHORITY_BINDING = Object.freeze({
  schemaVersion:
    "programmable.github-session-authority-configuration-attestation.v1",
  appId: "privy-app",
  audience: "programmable.launch-session.v2",
  keyId: "website-session-authority-v3",
  keyEpoch: "3",
  publicKeySpkiSha256: SESSION_AUTHORITY_PUBLIC_KEY_HASH,
  workloadIssuer: "programmable-approval-service",
  workloadSubject: "programmable-session-authority",
  workloadKeyId: "approval-service-workload-v3",
  workloadPublicKeySpkiSha256: SESSION_AUTHORITY_WORKLOAD_KEY_HASH,
});
const SESSION_AUTHORITY_CONFIGURATION_HASH = canonicalSha256(
  "programmable.github-session-authority-configuration-attestation.v1",
  SESSION_AUTHORITY_BINDING,
);

function sessionAuthority() {
  return {
    ...SESSION_AUTHORITY_BINDING,
    configurationHash: SESSION_AUTHORITY_CONFIGURATION_HASH,
  };
}

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function ready() {
  return {
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
    release: {
      commitSha: COMMIT_SHA,
      deploymentHost: DEPLOYMENT_HOST,
    },
    sessionAuthority: sessionAuthority(),
    trustedTimePath: TRUSTED_TIME_PATH,
    checkedAt: NOW.toISOString(),
  };
}

function disabled() {
  const value = ready();
  return {
    schemaVersion: value.schemaVersion,
    status: "disabled",
    chainId: value.chainId,
    components: value.components,
    approvalServiceRelease: value.approvalServiceRelease,
    release: value.release,
    sessionAuthority: value.sessionAuthority,
    checkedAt: value.checkedAt,
  };
}

function principalList() {
  return {
    schemaVersion: "programmable.principal-custom-launch-application-list.v3",
    subject: {
      provider: "github",
      githubUserId: "123456789",
      githubPrincipalHash: HASH,
    },
    applications: [{
      applicationId: OWN_APPLICATION_ID,
      applicationHandle: OWN_APPLICATION_HANDLE,
      revisionId: "revision-owned",
      repositoryId: "123",
      repositoryOwnerId: "309941960",
      repositoryFullName: "programmable/canary",
      pullRequestNumber: 1,
      commitOid: "b".repeat(40),
      treeOid: "c".repeat(40),
      state: "ready_for_registration",
      reasonCodes: [],
      actionCodes: [],
      correctionCount: 0,
      correctionPreview: [],
      receiptDigest: HASH,
      launchEntitlementBindingHash: HASH,
      updatedAt: NOW.toISOString(),
    }],
    nextCursor: null,
  };
}

function launchEligibility() {
  return {
    schemaVersion: "programmable.launch-eligibility-view.v3",
    applicationId: OWN_APPLICATION_ID,
    applicationHandle: OWN_APPLICATION_HANDLE,
    grantId: "123e4567-e89b-42d3-a456-426614174002",
    grantBindingHash: HASH,
    state: "active",
    launchAllowed: true,
    receiptDigest: HASH,
    validFrom: "2026-08-05T11:55:00.000Z",
    validUntil: "2026-08-05T12:05:00.000Z",
  };
}

function launchDescriptor() {
  return {
    schemaVersion: "programmable.launch-route-discovery.v3",
    applicationId: OWN_APPLICATION_ID,
    applicationHandle: OWN_APPLICATION_HANDLE,
    grantId: "123e4567-e89b-42d3-a456-426614174002",
    grantBindingHash: HASH,
    descriptorHash: HASH,
    validUntil: "2026-08-05T12:05:00.000Z",
    configurationSchema: {
      schemaVersion: "programmable.launch-configuration-schema.v2",
      schemaHash: HASH,
      fields: [
        {
          fieldId: "tokenName",
          label: "Token name",
          kind: "text",
          required: true,
          maxLength: 64,
        },
      ],
    },
    routes: [{
      choiceId: "canonical",
      chainId: "1",
      chainProfileId: "ethereum-mainnet-v1",
      launchRouteId: "canonical-create2-graph-v1",
      launchRouteBindingHash: HASH,
      routeAdapterId: "canonical-create2-graph-v1",
      executionMode: "browser-wallet-self-submit",
      walletActionKind: "eip1193-send-transaction",
      walletExecutionKind: "eoa-direct",
      transactionValuePolicy: { kind: "exact", valueWei: "0" },
    }],
    defaultChoiceId: "canonical",
  };
}

function probe(input: Record<string, unknown>) {
  return probeCustomLaunchDeployment({
    expectedCommitSha: COMMIT_SHA,
    expectedDeploymentHost: DEPLOYMENT_HOST,
    expectedApprovalServicePackageArtifactHash: PACKAGE_ARTIFACT_HASH,
    expectedApprovalServiceReviewAuthorityMode: "manual_review",
    expectedSessionAuthorityConfigurationHash:
      SESSION_AUTHORITY_CONFIGURATION_HASH,
    ...input,
  });
}

describe("custom launch deployment probe", () => {
  it("checks readiness and follows only its same-origin trusted time path", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(init).toMatchObject({ method: "GET", redirect: "error" });
      if (url.pathname === "/api/custom-launch/readiness") return json(ready());
      if (url.pathname === "/api/custom-launch/trusted-time") {
        expect(url.origin).toBe("https://deployment.example");
        return json({
          schemaVersion: "programmable.trusted-time.v1",
          now: NOW.toISOString(),
        });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    await expect(probe({
      baseUrl: "https://deployment.example/",
      requireEnabled: true,
      fetch: fetchMock,
      now: () => NOW,
      attempts: 1,
    })).resolves.toEqual({
      baseUrl: "https://deployment.example",
      status: "ready",
      authenticatedCanary: "not_requested",
      sessionAuthorityConfigurationHash:
        SESSION_AUTHORITY_CONFIGURATION_HASH,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.some(([input]) => new URL(String(input)).pathname === "/")).toBe(false);
  });

  it("fails closed for disabled, unready, stale, redirected and oversized responses", async () => {
    const disabledResponse = json(disabled());
    await expect(probe({
      baseUrl: "https://deployment.example/",
      requireEnabled: true,
      fetch: vi.fn(async () => disabledResponse),
      now: () => NOW,
      attempts: 1,
    })).rejects.toThrow("disabled");

    for (const response of [
      json({ ...ready(), status: "unready" }),
      json({ ...ready(), checkedAt: "2026-08-05T11:00:00.000Z" }),
      new Response(null, { status: 302, headers: { location: "https://evil.example" } }),
      json(ready(), { headers: { "content-length": "1048577" } }),
    ]) {
      await expect(probe({
        baseUrl: "https://deployment.example/",
        fetch: vi.fn(async () => response),
        now: () => NOW,
        attempts: 1,
      })).rejects.toThrow();
    }
  });

  it("rejects cross-origin trusted time and never requests it", async () => {
    const fetchMock = vi.fn(async () => json({
      ...ready(),
      trustedTimePath: "https://evil.example/api/custom-launch/trusted-time?keyId=current",
    }));
    await expect(probe({
      baseUrl: "https://deployment.example/",
      fetch: fetchMock,
      now: () => NOW,
      attempts: 1,
    })).rejects.toThrow("Trusted time path");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("binds the probe to the exact reviewed commit, immutable host and requested mode", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      return url.pathname === "/api/custom-launch/readiness"
        ? json(ready())
        : json({ schemaVersion: "programmable.trusted-time.v1", now: NOW.toISOString() });
    });
    await expect(probeCustomLaunchDeployment({
      baseUrl: "https://deployment.example/",
      expectedCommitSha: "c".repeat(40),
      expectedDeploymentHost: DEPLOYMENT_HOST,
      fetch: fetchMock,
      now: () => NOW,
      attempts: 1,
    })).rejects.toThrow("commit");
    await expect(probeCustomLaunchDeployment({
      baseUrl: "https://deployment.example/",
      expectedCommitSha: COMMIT_SHA,
      expectedDeploymentHost: "other-deployment.example",
      fetch: fetchMock,
      now: () => NOW,
      attempts: 1,
    })).rejects.toThrow("deployment host");
    await expect(probe({
      baseUrl: "https://deployment.example/",
      requireDisabled: true,
      fetch: fetchMock,
      now: () => NOW,
      attempts: 1,
    })).rejects.toThrow("enabled while disabled");
  });

  it("binds the probe to the exact configured backend release identity", async () => {
    const run = (readiness: object, overrides: Record<string, unknown> = {}) => {
      const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
        const url = new URL(String(input));
        return url.pathname === "/api/custom-launch/readiness"
          ? json(readiness)
          : json({ schemaVersion: "programmable.trusted-time.v1", now: NOW.toISOString() });
      });
      return {
        fetchMock,
        result: probe({
          baseUrl: "https://deployment.example/",
          fetch: fetchMock,
          now: () => NOW,
          attempts: 1,
          ...overrides,
        }),
      };
    };

    const missing = ready();
    delete (missing as { approvalServiceRelease?: unknown }).approvalServiceRelease;
    await expect(run(missing).result).rejects.toThrow();

    const wrongPackage = run({
      ...ready(),
      approvalServiceRelease: {
        packageArtifactHash: `sha256:${"8".repeat(64)}`,
        reviewAuthorityMode: "manual_review",
      },
    });
    await expect(wrongPackage.result).rejects.toThrow("package artifact");
    expect(wrongPackage.fetchMock).toHaveBeenCalledOnce();

    const wrongMode = run({
      ...ready(),
      approvalServiceRelease: {
        packageArtifactHash: PACKAGE_ARTIFACT_HASH,
        reviewAuthorityMode: "autonomous_ai",
      },
    });
    await expect(wrongMode.result).rejects.toThrow("configured release");
    expect(wrongMode.fetchMock).toHaveBeenCalledOnce();

    await expect(run(ready(), {
      expectedApprovalServicePackageArtifactHash: undefined,
    }).result).rejects.toThrow("package artifact");
    await expect(run(ready(), {
      expectedApprovalServiceReviewAuthorityMode: "autonomous_ai",
    }).result).rejects.toThrow("configured release");
  });

  it("runs the authenticated canary only with both secrets and validates its principal schema", async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/custom-launch/readiness") return json(ready());
      if (url.pathname === "/api/custom-launch/trusted-time") {
        return json({ schemaVersion: "programmable.trusted-time.v1", now: NOW.toISOString() });
      }
      if (url.pathname.endsWith("/launch-eligibility")) {
        return json(launchEligibility());
      }
      if (url.pathname.endsWith("/launch-descriptor")) {
        return json(launchDescriptor());
      }
      if (url.pathname.includes(FOREIGN_APPLICATION_HANDLE)) {
        return json({
          schemaVersion: "programmable.custom-launch-website-error.v2",
          code: "RESOURCE_NOT_FOUND",
          message: "Resource was not found",
        }, { status: 404 });
      }
      expect(url.pathname + url.search).toBe(
        "/api/custom-launch/v3/applications?limit=100",
      );
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe("Bearer access-token");
      expect(headers.get("x-privy-identity-token")).toBe("identity-token");
      expect(headers.get("x-vercel-protection-bypass")).toBe("automation-bypass");
      return json(principalList());
    });
    await expect(probe({
      baseUrl: "https://deployment.example/",
      requireEnabled: true,
      authenticatedCanary: true,
      accessToken: "access-token",
      identityToken: "identity-token",
      expectedGithubUserId: "123456789",
      ownApplicationHandle: OWN_APPLICATION_HANDLE,
      foreignApplicationHandle: FOREIGN_APPLICATION_HANDLE,
      automationBypassSecret: "automation-bypass",
      fetch: fetchMock,
      now: () => NOW,
      attempts: 1,
    })).resolves.toMatchObject({ authenticatedCanary: "passed" });
    expect(fetchMock).toHaveBeenCalledTimes(6);

    await expect(probe({
      baseUrl: "https://deployment.example/",
      authenticatedCanary: true,
      accessToken: "access-token",
      fetch: fetchMock,
      now: () => NOW,
      attempts: 1,
    })).rejects.toThrow("identity token");

    const invalidPrincipalFetch = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/custom-launch/readiness") return json(ready());
      if (url.pathname === "/api/custom-launch/trusted-time") {
        return json({ schemaVersion: "programmable.trusted-time.v1", now: NOW.toISOString() });
      }
      return json({ ...principalList(), unexpected: true });
    });
    await expect(probe({
      baseUrl: "https://deployment.example/",
      authenticatedCanary: true,
      accessToken: "access-token",
      identityToken: "identity-token",
      expectedGithubUserId: "123456789",
      ownApplicationHandle: OWN_APPLICATION_HANDLE,
      foreignApplicationHandle: FOREIGN_APPLICATION_HANDLE,
      fetch: invalidPrincipalFetch,
      now: () => NOW,
      attempts: 1,
    })).rejects.toThrow("unexpected shape");
  });

  it("requires the canary's exact commit to be approved and launchable", async () => {
    const run = (applications: object, eligibility = launchEligibility(), descriptor = launchDescriptor()) =>
      probe({
        baseUrl: "https://deployment.example/",
        requireEnabled: true,
        authenticatedCanary: true,
        accessToken: "access-token",
        identityToken: "identity-token",
        expectedGithubUserId: "123456789",
        ownApplicationHandle: OWN_APPLICATION_HANDLE,
        foreignApplicationHandle: FOREIGN_APPLICATION_HANDLE,
        fetch: vi.fn(async (input: URL | RequestInfo) => {
          const url = new URL(String(input));
          if (url.pathname === "/api/custom-launch/readiness") return json(ready());
          if (url.pathname === "/api/custom-launch/trusted-time") {
            return json({ schemaVersion: "programmable.trusted-time.v1", now: NOW.toISOString() });
          }
          if (url.pathname.endsWith("/launch-eligibility")) return json(eligibility);
          if (url.pathname.endsWith("/launch-descriptor")) return json(descriptor);
          if (url.pathname.includes(FOREIGN_APPLICATION_HANDLE)) {
            return json({
              schemaVersion: "programmable.custom-launch-website-error.v2",
              code: "RESOURCE_NOT_FOUND",
              message: "Resource was not found",
            }, { status: 404 });
          }
          return json(applications);
        }),
        now: () => NOW,
        attempts: 1,
      });

    await expect(run(principalList())).resolves.toMatchObject({
      authenticatedCanary: "passed",
    });

    await expect(run({
      ...principalList(),
      applications: principalList().applications.map((application) => ({
        ...application,
        intakeContract: "aeon-v1",
        providerId: "aeon",
        controlRepositoryId: "1325324453",
        controlRepositoryOwnerId: "309941960",
      })),
    })).resolves.toMatchObject({ authenticatedCanary: "passed" });

    await expect(run({
      ...principalList(),
      applications: principalList().applications.map((application) => ({
        ...application,
        intakeContract: "registry-v3",
        providerId: "programmable-registry",
        controlRepositoryId: "1320171831",
        controlRepositoryOwnerId: "309941960",
        grandfatheredAtReleaseBindingDigest: null,
      })),
    })).rejects.toThrow("not launch-ready");

    await expect(run({
      ...principalList(),
      applications: principalList().applications.map((application) => ({
        ...application,
        state: "changes_required",
        receiptDigest: null,
        launchEntitlementBindingHash: null,
      })),
    })).rejects.toThrow("not launch-ready");

    await expect(run({
      ...principalList(),
      applications: principalList().applications.map((application) => ({
        ...application,
        state: "approved",
        receiptDigest: null,
        launchEntitlementBindingHash: null,
      })),
    })).rejects.toThrow("not launch-ready");

    await expect(run(principalList(), {
      ...launchEligibility(),
      launchAllowed: false,
      state: "suspended",
    })).rejects.toThrow("launch eligibility is invalid");

    await expect(run(principalList(), launchEligibility(), {
      ...launchDescriptor(),
      applicationId: "application-substituted",
    })).rejects.toThrow("launch descriptor is invalid");

    await expect(run(principalList(), launchEligibility(), {
      ...launchDescriptor(),
      applicationHandle: `github-${"c".repeat(64)}`,
    })).rejects.toThrow("launch descriptor is invalid");

    await expect(run(principalList(), launchEligibility(), {
      ...launchDescriptor(),
      routes: launchDescriptor().routes.map((route) => ({ ...route, chainId: "8453" })),
    })).rejects.toThrow("launch route is invalid");
  });

  it("retries bounded transient failures but not a permanent client failure", async () => {
    const transient = vi.fn()
      .mockResolvedValueOnce(json({ error: "warming" }, { status: 503 }))
      .mockResolvedValueOnce(json(ready()))
      .mockResolvedValueOnce(json({
        schemaVersion: "programmable.trusted-time.v1",
        now: NOW.toISOString(),
      }));
    const sleep = vi.fn(async () => undefined);
    await probe({
      baseUrl: "https://deployment.example/",
      fetch: transient,
      sleep,
      now: () => NOW,
      attempts: 2,
    });
    expect(sleep).toHaveBeenCalledOnce();

    const permanent = vi.fn(async () => json({ error: "missing" }, { status: 404 }));
    await expect(probe({
      baseUrl: "https://deployment.example/",
      fetch: permanent,
      sleep,
      now: () => NOW,
      attempts: 4,
    })).rejects.toThrow("HTTP 404");
    expect(permanent).toHaveBeenCalledOnce();
  });

  it("allows plain HTTP only for explicitly enabled localhost", async () => {
    const disabledFetch = vi.fn(async () => json(disabled()));
    await expect(probe({
      baseUrl: "http://localhost:3000/",
      fetch: disabledFetch,
      now: () => NOW,
      attempts: 1,
    })).rejects.toThrow("HTTPS origin");
    await expect(probe({
      baseUrl: "http://localhost:3000/",
      allowHttpLocalhost: true,
      fetch: disabledFetch,
      now: () => NOW,
      attempts: 1,
    })).resolves.toMatchObject({ status: "disabled" });
    await expect(probe({
      baseUrl: "http://example.com/",
      allowHttpLocalhost: true,
      fetch: disabledFetch,
      now: () => NOW,
      attempts: 1,
    })).rejects.toThrow("HTTPS origin");
  });

  it("parses explicit CLI gates without reading canary secrets unless requested", () => {
    expect(parseCustomLaunchDeploymentProbeArguments([
      "--base-url=https://deployment.example/",
      "--require-enabled",
    ], {
      PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_ACCESS_TOKEN: "do-not-read",
      PROGRAMMABLE_RELEASE_EXPECTED_COMMIT_SHA: COMMIT_SHA,
      PROGRAMMABLE_RELEASE_EXPECTED_DEPLOYMENT_HOST: DEPLOYMENT_HOST,
      PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH: PACKAGE_ARTIFACT_HASH,
      PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE: "manual_review",
      PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_EXPECTED_CONFIGURATION_HASH:
        SESSION_AUTHORITY_CONFIGURATION_HASH,
    })).toEqual({
      baseUrl: "https://deployment.example/",
      requireEnabled: true,
      requireDisabled: false,
      authenticatedCanary: false,
      allowHttpLocalhost: false,
      expectedCommitSha: COMMIT_SHA,
      expectedDeploymentHost: DEPLOYMENT_HOST,
      expectedApprovalServicePackageArtifactHash: PACKAGE_ARTIFACT_HASH,
      expectedApprovalServiceReviewAuthorityMode: "manual_review",
      expectedSessionAuthorityConfigurationHash:
        SESSION_AUTHORITY_CONFIGURATION_HASH,
    });
    expect(parseCustomLaunchDeploymentProbeArguments([
      "--base-url=https://deployment.example/",
      "--authenticated-canary",
    ], {
      PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_ACCESS_TOKEN: "access",
      PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_IDENTITY_TOKEN: "identity",
      PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_EXPECTED_GITHUB_USER_ID: "123456789",
      PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_OWN_APPLICATION_HANDLE: OWN_APPLICATION_HANDLE,
      PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_FOREIGN_APPLICATION_HANDLE: FOREIGN_APPLICATION_HANDLE,
      PROGRAMMABLE_RELEASE_EXPECTED_COMMIT_SHA: COMMIT_SHA,
      PROGRAMMABLE_RELEASE_EXPECTED_DEPLOYMENT_HOST: DEPLOYMENT_HOST,
      PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH: PACKAGE_ARTIFACT_HASH,
      PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE: "manual_review",
      PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_EXPECTED_CONFIGURATION_HASH:
        SESSION_AUTHORITY_CONFIGURATION_HASH,
      VERCEL_AUTOMATION_BYPASS_SECRET: "automation-bypass",
    })).toMatchObject({
      accessToken: "access",
      identityToken: "identity",
      expectedGithubUserId: "123456789",
      ownApplicationHandle: OWN_APPLICATION_HANDLE,
      foreignApplicationHandle: FOREIGN_APPLICATION_HANDLE,
      automationBypassSecret: "automation-bypass",
    });
    expect(() => parseCustomLaunchDeploymentProbeArguments([
      "https://deployment.example/",
    ])).toThrow("Unknown or duplicate argument");
  });
});
