import { describe, expect, it } from "vitest";

// @ts-expect-error JavaScript release helper has no declaration file.
import { createCustomLaunchCanaryEvidence } from "../scripts/custom-launch-canary-evidence.mjs";

const OWN_APPLICATION_HANDLE = `github-${"a".repeat(64)}`;
const FOREIGN_APPLICATION_HANDLE = `github-${"b".repeat(64)}`;
const SESSION_AUTHORITY_CONFIGURATION_HASH = `sha256:${"7".repeat(64)}`;

function evidence(overrides: Record<string, unknown> = {}) {
  return createCustomLaunchCanaryEvidence({
    probeResult: {
      baseUrl: "https://programmable-candidate.vercel.app",
      status: "ready",
      authenticatedCanary: "passed",
      sessionAuthorityConfigurationHash:
        SESSION_AUTHORITY_CONFIGURATION_HASH,
    },
    targetUrl: "https://programmable-candidate.vercel.app/",
    deploymentId: "dpl_12345678AbCd",
    websiteCommitSha: "a".repeat(40),
    approvalServicePackageArtifactHash: `sha256:${"9".repeat(64)}`,
    reviewAuthorityMode: "manual_review",
    ownApplicationHandle: OWN_APPLICATION_HANDLE,
    foreignApplicationHandle: FOREIGN_APPLICATION_HANDLE,
    ...overrides,
  });
}

describe("Custom Launch candidate canary evidence", () => {
  it("binds the exact candidate and backend while redacting canary handles", () => {
    const result = evidence();
    expect(result).toMatchObject({
      schemaVersion: "programmable.custom-launch-candidate-canary-evidence.v1",
      result: "passed",
      candidate: {
        deploymentId: "dpl_12345678AbCd",
        targetUrl: "https://programmable-candidate.vercel.app",
        websiteCommitSha: "a".repeat(40),
      },
      approvalService: {
        packageArtifactHash: `sha256:${"9".repeat(64)}`,
        reviewAuthorityMode: "manual_review",
      },
      sessionAuthority: {
        configurationHash: SESSION_AUTHORITY_CONFIGURATION_HASH,
      },
      canary: {
        authenticated: true,
        principalVerified: true,
        launchEligibilityVerified: true,
        launchDescriptorVerified: true,
        foreignApplicationDenied: true,
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(OWN_APPLICATION_HANDLE);
    expect(serialized).not.toContain(FOREIGN_APPLICATION_HANDLE);
    expect(result.canary.ownApplicationHandleSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(result.canary.foreignApplicationHandleSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
  });

  it("records a disabled dark-stage probe without claiming an authenticated canary", () => {
    const result = evidence({
      probeResult: {
        baseUrl: "https://programmable-candidate.vercel.app",
        status: "disabled",
        authenticatedCanary: "not_requested",
        sessionAuthorityConfigurationHash:
          SESSION_AUTHORITY_CONFIGURATION_HASH,
      },
    });
    expect(result).toEqual({
      schemaVersion: "programmable.custom-launch-dark-readiness-evidence.v1",
      result: "passed",
      candidate: {
        deploymentId: "dpl_12345678AbCd",
        targetUrl: "https://programmable-candidate.vercel.app",
        websiteCommitSha: "a".repeat(40),
      },
      approvalService: {
        packageArtifactHash: `sha256:${"9".repeat(64)}`,
        reviewAuthorityMode: "manual_review",
      },
      sessionAuthority: {
        configurationHash: SESSION_AUTHORITY_CONFIGURATION_HASH,
      },
      readiness: {
        status: "disabled",
        authenticatedCanary: false,
      },
    });
  });

  it("rejects a failed, unauthenticated or differently bound probe result", () => {
    expect(() => evidence({
      probeResult: {
        baseUrl: "https://programmable-candidate.vercel.app",
        status: "disabled",
        authenticatedCanary: "passed",
        sessionAuthorityConfigurationHash:
          SESSION_AUTHORITY_CONFIGURATION_HASH,
      },
    })).toThrow("not release-ready");
    expect(() => evidence({
      probeResult: {
        baseUrl: "https://other-candidate.vercel.app",
        status: "ready",
        authenticatedCanary: "passed",
        sessionAuthorityConfigurationHash:
          SESSION_AUTHORITY_CONFIGURATION_HASH,
      },
    })).toThrow("not release-ready");
    expect(() => evidence({ foreignApplicationHandle: OWN_APPLICATION_HANDLE }))
      .toThrow("must differ");
    expect(() => evidence({ reviewAuthorityMode: "unconfigured" }))
      .toThrow("review authority mode");
    expect(() => evidence({
      probeResult: {
        baseUrl: "https://programmable-candidate.vercel.app",
        status: "ready",
        authenticatedCanary: "passed",
        sessionAuthorityConfigurationHash: `sha256:${"A".repeat(64)}`,
      },
    })).toThrow("session authority configuration");
  });
});
