import { describe, expect, it, vi } from "vitest";

import {
  LaunchAuthorityRefreshBindingErrorV1,
  LaunchAuthorityRefreshDependencyUnavailableErrorV1,
  LaunchAuthorityRefreshFailedErrorV1,
  LaunchAuthorityRefreshSingleFlightV1,
  LaunchAuthorityRefreshTimeoutErrorV1,
  LAUNCH_AUTHORITY_REFRESH_IDEMPOTENCY_KEY_DOMAIN_V1,
  launchAuthorityNeedsRefreshV1,
  launchAuthorityObservationMatchesSetupV1,
  launchAuthorityRefreshIdempotencyKeyV1,
  launchAuthorityRefreshRequiredV1,
  pollPrincipalLaunchAuthorityRefreshV1,
} from "../lib/custom-launch/launch-authority-refresh-v1";
import { canonicalBrowserSha256V2 } from "../lib/custom-launch/browser-authority-v2";
import { CustomLaunchWebsiteRequestErrorV2 } from "../lib/custom-launch/client-v2";
import type {
  LaunchDescriptorV2,
  LaunchEligibilityViewV2,
  PrincipalCustomLaunchApplicationSummaryV2,
  PrincipalLaunchAuthorityRefreshViewV1,
} from "../lib/custom-launch/contract-v2";

const digest = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const APPLICATION_HANDLE = `github-${"a".repeat(64)}` as const;
const GRANT_ID = "123e4567-e89b-42d3-a456-426614174002";

function application(
  overrides: Partial<PrincipalCustomLaunchApplicationSummaryV2> = {},
): PrincipalCustomLaunchApplicationSummaryV2 {
  return {
    applicationId: "application-1",
    applicationHandle: APPLICATION_HANDLE,
    revisionId: "revision-1",
    repositoryId: "123",
    repositoryOwnerId: "309941960",
    repositoryFullName: "builder/project",
    pullRequestNumber: 7,
    commitOid: "a".repeat(40),
    treeOid: "b".repeat(40),
    state: "ready_for_registration",
    reasonCodes: [],
    actionCodes: [],
    correctionCount: 0,
    correctionPreview: [],
    receiptDigest: digest("5"),
    launchEntitlementBindingHash: digest("1"),
    updatedAt: "2026-08-05T12:00:00.000Z",
    ...overrides,
  } as PrincipalCustomLaunchApplicationSummaryV2;
}

function refresh(
  state: "pending" | "current" | "failed",
  overrides: Partial<PrincipalLaunchAuthorityRefreshViewV1> = {},
): PrincipalLaunchAuthorityRefreshViewV1 {
  return {
    schemaVersion: "programmable.principal-launch-authority-refresh.v1",
    state,
    requestId: digest("2"),
    requestDigest: digest("2"),
    applicationId: "application-1",
    applicationHandle: APPLICATION_HANDLE,
    grantId: GRANT_ID,
    grantBindingHash: digest("1"),
    requestedAt: "2026-08-05T12:00:00.000Z",
    observationHash: state === "current" ? digest("3") : null,
    validUntil: state === "current" ? "2099-08-05T12:10:00.000Z" : null,
    ...overrides,
  };
}

describe("principal launch authority refresh", () => {
  it("rejects an approved outcome that has no current grant", async () => {
    await expect(pollPrincipalLaunchAuthorityRefreshV1({
      client: { launchAuthorityRefresh: async () => refresh("current") },
      application: application({
        state: "approved",
        launchEntitlementBindingHash: null,
      }),
      idempotencyKey: "launch-authority-refresh-approved-without-grant",
      isActive: () => true,
    })).rejects.toBeInstanceOf(LaunchAuthorityRefreshBindingErrorV1);
  });

  it("uses one deterministic key per generation and a fresh key for explicit retry", () => {
    const first = launchAuthorityRefreshIdempotencyKeyV1({ application: application() });
    const same = launchAuthorityRefreshIdempotencyKeyV1({ application: application() });
    const retry = launchAuthorityRefreshIdempotencyKeyV1({
      application: application(),
      attempt: 1,
    });
    const ttlGeneration = launchAuthorityRefreshIdempotencyKeyV1({
      application: application(),
      currentValidUntil: "2026-08-05T12:10:00.000Z",
    });
    const sameTtlGeneration = launchAuthorityRefreshIdempotencyKeyV1({
      application: application(),
      currentValidUntil: "2026-08-05T12:10:00.000Z",
    });
    expect(first).toBe(same);
    expect(retry).not.toBe(first);
    expect(ttlGeneration).toBe(sameTtlGeneration);
    expect(first.length).toBeGreaterThanOrEqual(16);
    expect(first.length).toBeLessThanOrEqual(128);
    expect(ttlGeneration.length).toBeLessThanOrEqual(128);
    expect(first).toBe(
      `launch-authority-refresh:v1:${canonicalBrowserSha256V2(
        LAUNCH_AUTHORITY_REFRESH_IDEMPOTENCY_KEY_DOMAIN_V1,
        {
          applicationHandle: APPLICATION_HANDLE,
          attempt: 0,
          generation: "initial:2026-08-05T12:00:00.000Z",
          launchEntitlementBindingHash: digest("1"),
        },
      ).slice("sha256:".length)}`,
    );
    expect(first).not.toContain(APPLICATION_HANDLE);
    expect(first).not.toContain(digest("1"));
  });

  it("domain-separates every refresh authority generation input", () => {
    const baseline = launchAuthorityRefreshIdempotencyKeyV1({ application: application() });
    const inputs = [
      launchAuthorityRefreshIdempotencyKeyV1({
        application: application({
          applicationHandle: `github-${"b".repeat(64)}`,
        }),
      }),
      launchAuthorityRefreshIdempotencyKeyV1({
        application: application({ launchEntitlementBindingHash: digest("2") }),
      }),
      launchAuthorityRefreshIdempotencyKeyV1({
        application: application({ updatedAt: "2026-08-05T12:00:00.001Z" }),
      }),
      launchAuthorityRefreshIdempotencyKeyV1({
        application: application(),
        currentValidUntil: "2026-08-05T12:10:00.000Z",
      }),
      launchAuthorityRefreshIdempotencyKeyV1({
        application: application(),
        attempt: 1,
      }),
    ];
    expect(new Set([baseline, ...inputs]).size).toBe(inputs.length + 1);
    expect(inputs.every((key) => key.length <= 128)).toBe(true);
    const samePayloadDifferentDomain = canonicalBrowserSha256V2(
      "programmable.launch-authority-refresh-idempotency-key-test.v1",
      {
        applicationHandle: APPLICATION_HANDLE,
        attempt: 0,
        generation: "initial:2026-08-05T12:00:00.000Z",
        launchEntitlementBindingHash: digest("1"),
      },
    );
    expect(baseline.endsWith(samePayloadDifferentDomain.slice("sha256:".length))).toBe(false);
  });

  it("polls the same immutable request until its exact bound observation is current", async () => {
    const snapshots = [refresh("pending"), refresh("current")];
    const launchAuthorityRefresh = vi.fn(async (...input: [
      typeof APPLICATION_HANDLE,
      Readonly<{
        schemaVersion: "programmable.principal-launch-authority-refresh-request.v1";
      }>,
      string,
    ]) => {
      expect(input[0]).toBe(APPLICATION_HANDLE);
      return snapshots.shift()!;
    });
    await expect(pollPrincipalLaunchAuthorityRefreshV1({
      client: { launchAuthorityRefresh },
      application: application(),
      idempotencyKey: "launch-authority-refresh-request-1",
      isActive: () => true,
      delay: async () => {},
      now: () => Date.parse("2026-08-05T12:01:00.000Z"),
    })).resolves.toMatchObject({ state: "current", observationHash: digest("3") });
    expect(launchAuthorityRefresh).toHaveBeenCalledTimes(2);
    expect(launchAuthorityRefresh.mock.calls.map((call) => call[2])).toEqual([
      "launch-authority-refresh-request-1",
      "launch-authority-refresh-request-1",
    ]);
  });

  it("retries temporary dependency failures with bounded backoff and one generation", async () => {
    const outcomes: Array<PrincipalLaunchAuthorityRefreshViewV1 | Error> = [
      new CustomLaunchWebsiteRequestErrorV2(503, "DEPENDENCY_UNAVAILABLE"),
      new CustomLaunchWebsiteRequestErrorV2(504, "UPSTREAM_TIMEOUT"),
      refresh("current"),
    ];
    const keys: string[] = [];
    const delays: number[] = [];
    const notices: Array<Readonly<{ delayMs: number; code: string }>> = [];
    const launchAuthorityRefresh = vi.fn(async (
      _applicationHandle: typeof APPLICATION_HANDLE,
      _request: Readonly<{
        schemaVersion: "programmable.principal-launch-authority-refresh-request.v1";
      }>,
      idempotencyKey: string,
      options?: Readonly<{ signal?: AbortSignal }>,
    ) => {
      expect(options?.signal).toBeInstanceOf(AbortSignal);
      keys.push(idempotencyKey);
      const outcome = outcomes.shift()!;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    });
    await expect(pollPrincipalLaunchAuthorityRefreshV1({
      client: { launchAuthorityRefresh },
      application: application(),
      idempotencyKey: "launch-authority-refresh-transient-1",
      isActive: () => true,
      attempts: 3,
      requestTimeoutMs: 100,
      overallTimeoutMs: 1_000,
      transientBaseDelayMs: 100,
      transientMaxDelayMs: 150,
      delay: async (milliseconds) => { delays.push(milliseconds); },
      monotonicNow: () => 0,
      onTransientRetry: ({ delayMs: retryDelay, code }) => {
        notices.push({ delayMs: retryDelay, code });
      },
    })).resolves.toMatchObject({ state: "current" });
    expect(keys).toEqual([
      "launch-authority-refresh-transient-1",
      "launch-authority-refresh-transient-1",
      "launch-authority-refresh-transient-1",
    ]);
    expect(delays).toEqual([100, 150]);
    expect(notices).toEqual([
      { delayMs: 100, code: "DEPENDENCY_UNAVAILABLE" },
      { delayMs: 150, code: "UPSTREAM_TIMEOUT" },
    ]);
  });

  it("keeps an unavailable dependency retry on the same non-terminal generation", async () => {
    const idempotencyKey = launchAuthorityRefreshIdempotencyKeyV1({
      application: application(),
    });
    const keys: string[] = [];
    const unavailable = await pollPrincipalLaunchAuthorityRefreshV1({
      client: {
        launchAuthorityRefresh: async (_handle, _request, key) => {
          keys.push(key);
          throw new CustomLaunchWebsiteRequestErrorV2(
            502,
            "DEPENDENCY_UNAVAILABLE",
          );
        },
      },
      application: application(),
      idempotencyKey,
      isActive: () => true,
      attempts: 2,
      requestTimeoutMs: 100,
      overallTimeoutMs: 1_000,
      transientBaseDelayMs: 0,
      transientMaxDelayMs: 0,
      delay: async () => {},
      monotonicNow: () => 0,
    }).catch((caught: unknown) => caught);
    expect(unavailable).toBeInstanceOf(
      LaunchAuthorityRefreshDependencyUnavailableErrorV1,
    );
    expect(unavailable).not.toBeInstanceOf(LaunchAuthorityRefreshFailedErrorV1);
    expect(keys).toEqual([idempotencyKey, idempotencyKey]);
    expect(launchAuthorityRefreshIdempotencyKeyV1({
      application: application(),
    })).toBe(idempotencyKey);
  });

  it("aborts a hung refresh request at its exact request timeout", async () => {
    let observedSignal: AbortSignal | undefined;
    const unavailable = await pollPrincipalLaunchAuthorityRefreshV1({
      client: {
        launchAuthorityRefresh: async (_handle, _request, _key, options) => {
          observedSignal = options?.signal;
          return await new Promise<PrincipalLaunchAuthorityRefreshViewV1>(
            (_resolve, reject) => {
              options?.signal?.addEventListener("abort", () => {
                reject(options.signal?.reason);
              }, { once: true });
            },
          );
        },
      },
      application: application(),
      idempotencyKey: "launch-authority-refresh-hung-1",
      isActive: () => true,
      attempts: 1,
      requestTimeoutMs: 5,
      overallTimeoutMs: 50,
      transientBaseDelayMs: 0,
      transientMaxDelayMs: 0,
      delay: async () => {},
    }).catch((caught: unknown) => caught);
    expect(observedSignal?.aborted).toBe(true);
    expect(unavailable).toBeInstanceOf(
      LaunchAuthorityRefreshDependencyUnavailableErrorV1,
    );
  });

  it("deduplicates a same-tab generation and fails closed on identity mutation", async () => {
    const gate = Promise.withResolvers<PrincipalLaunchAuthorityRefreshViewV1>();
    const singleFlight = new LaunchAuthorityRefreshSingleFlightV1();
    const operation = vi.fn(() => gate.promise);
    const left = singleFlight.run("same-generation", operation);
    const right = singleFlight.run("same-generation", operation);
    expect(operation).toHaveBeenCalledOnce();
    gate.resolve(refresh("current"));
    await expect(Promise.all([left, right])).resolves.toHaveLength(2);

    const snapshots = [
      refresh("pending"),
      refresh("current", { grantBindingHash: digest("9") }),
    ];
    await expect(pollPrincipalLaunchAuthorityRefreshV1({
      client: { launchAuthorityRefresh: async () => snapshots.shift()! },
      application: application(),
      idempotencyKey: "launch-authority-refresh-request-2",
      isActive: () => true,
      delay: async () => {},
    })).rejects.toBeInstanceOf(LaunchAuthorityRefreshBindingErrorV1);
  });

  it("treats failed and expired current observations as terminal for that key", async () => {
    const terminalFailure = vi.fn(async () => refresh("failed"));
    const onTransientRetry = vi.fn();
    await expect(pollPrincipalLaunchAuthorityRefreshV1({
      client: { launchAuthorityRefresh: terminalFailure },
      application: application(),
      idempotencyKey: "launch-authority-refresh-request-3",
      isActive: () => true,
      delay: async () => {},
      onTransientRetry,
    })).rejects.toBeInstanceOf(LaunchAuthorityRefreshFailedErrorV1);
    expect(terminalFailure).toHaveBeenCalledOnce();
    expect(onTransientRetry).not.toHaveBeenCalled();

    await expect(pollPrincipalLaunchAuthorityRefreshV1({
      client: {
        launchAuthorityRefresh: async () => refresh("current", {
          validUntil: "2026-08-05T12:00:30.000Z",
        }),
      },
      application: application(),
      idempotencyKey: "launch-authority-refresh-request-4",
      isActive: () => true,
      delay: async () => {},
      now: () => Date.parse("2026-08-05T12:01:00.000Z"),
    })).rejects.toBeInstanceOf(LaunchAuthorityRefreshBindingErrorV1);
  });

  it("marks a bounded pending timeout as a retryable generation failure", async () => {
    const timeout = await pollPrincipalLaunchAuthorityRefreshV1({
      client: { launchAuthorityRefresh: async () => refresh("pending") },
      application: application(),
      idempotencyKey: "launch-authority-refresh-request-5",
      isActive: () => true,
      attempts: 2,
      delay: async () => {},
    }).catch((caught: unknown) => caught);
    expect(timeout).toBeInstanceOf(LaunchAuthorityRefreshTimeoutErrorV1);
    expect(timeout).toBeInstanceOf(LaunchAuthorityRefreshFailedErrorV1);

    const currentAttempt = 0;
    const first = launchAuthorityRefreshIdempotencyKeyV1({
      application: application(),
      attempt: currentAttempt,
    });
    const retry = launchAuthorityRefreshIdempotencyKeyV1({
      application: application(),
      attempt: currentAttempt + 1,
    });
    expect(retry).not.toBe(first);
  });

  it("requires renewal before a challenge when either authority view is near expiry", () => {
    const descriptor = {
      validUntil: "2026-08-05T12:00:29.000Z",
    } as LaunchDescriptorV2;
    const eligibility = {
      validUntil: "2026-08-05T12:10:00.000Z",
    } as LaunchEligibilityViewV2;
    expect(launchAuthorityNeedsRefreshV1({
      descriptor,
      eligibility,
      now: Date.parse("2026-08-05T12:00:00.000Z"),
    })).toBe(true);
    expect(launchAuthorityNeedsRefreshV1({
      descriptor: { ...descriptor, validUntil: "2026-08-05T12:00:31.000Z" },
      eligibility,
      now: Date.parse("2026-08-05T12:00:00.000Z"),
    })).toBe(false);
    expect(launchAuthorityRefreshRequiredV1({
      descriptor: { ...descriptor, validUntil: "2026-08-05T12:09:00.000Z" },
      eligibility,
      forceFreshObservation: true,
      refreshCompleted: false,
      now: Date.parse("2026-08-05T12:00:00.000Z"),
    })).toBe(true);
    expect(launchAuthorityRefreshRequiredV1({
      descriptor: { ...descriptor, validUntil: "2026-08-05T12:09:00.000Z" },
      eligibility,
      forceFreshObservation: true,
      refreshCompleted: true,
      now: Date.parse("2026-08-05T12:00:00.000Z"),
    })).toBe(false);
  });

  it("does not accept a stale descriptor after a new observation completes", () => {
    const current = refresh("current");
    const descriptor = {
      grantId: GRANT_ID,
      grantBindingHash: digest("1"),
      validUntil: current.validUntil,
    } as LaunchDescriptorV2;
    const eligibility = {
      grantId: GRANT_ID,
      grantBindingHash: digest("1"),
      validUntil: current.validUntil,
    } as LaunchEligibilityViewV2;
    expect(launchAuthorityObservationMatchesSetupV1({
      refresh: current,
      descriptor,
      eligibility,
    })).toBe(true);
    expect(launchAuthorityObservationMatchesSetupV1({
      refresh: current,
      descriptor: { ...descriptor, validUntil: "2026-08-05T12:05:00.000Z" },
      eligibility,
    })).toBe(false);
  });
});
