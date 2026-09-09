import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  customLaunchPersistedRecoveryProgressV2,
  customLaunchRecoveryBlocksNewSubmissionV2,
  customLaunchRecoveryDisplayV2,
  customLaunchSubmissionUnknownRecoveryV2,
  CustomLaunchRecoveryCopyV2,
  parsePersistedLaunchRecoveryV2,
  requirePersistLaunchRecoveryV2,
  type BroadcastLaunchRecoveryV2,
  type PreparedLaunchRecoveryV2,
} from "../components/custom-launch-experience";
import {
  acquireCurrentCustomLaunchWebsiteSessionV2,
  assertCurrentCustomLaunchPrincipalV2,
  customApplicationHasDurableApprovalV2,
  customApplicationHasCurrentLaunchEntitlementV2,
  customLaunchApplicantRecoveryV2,
  customLaunchApplicantStageRequiresExplicitSessionV2,
  customLaunchApplicantSessionBoundaryKeyV2,
  refreshCurrentCustomLaunchApplicantStageV2,
  runCustomLaunchApplicantReauthorizationV2,
  runCurrentCustomLaunchApplicantSequenceV2,
  CustomLaunchApplicantBoundaryGuardV2,
  CustomLaunchApplicantSingleFlightV2,
  CustomLaunchApplicantSessionErrorV2,
} from "../lib/custom-launch/applicant-session-v2";
import {
  createCustomLaunchWebsiteClientV2,
  CustomLaunchWebsiteRequestErrorV2,
} from "../lib/custom-launch/client-v2";
import { ApplicantRefreshUserUnavailableErrorV1 } from
  "../lib/custom-launch/applicant-refresh-user-gate-v1";
import type { PrincipalCustomLaunchApplicationSummaryV2 } from "../lib/custom-launch/contract-v2";

const digest = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const applicationHandle = `github-${"a".repeat(64)}` as const;
const walletAccount = `0x${"1".repeat(40)}`;
const otherWalletAccount = `0x${"2".repeat(40)}`;
const githubUserId = "123456789";
const githubLogin = "applicant";

function preparedRecovery(): PreparedLaunchRecoveryV2 {
  return {
    stage: "prepared",
    walletRequestAttempted: false,
    applicationHandle,
    githubPrincipalHash: digest("3"),
    grantId: "123e4567-e89b-42d3-a456-426614174002",
    grantBindingHash: digest("4"),
    sessionId: "123e4567-e89b-42d3-a456-426614174001",
    permitId: digest("5"),
    chainId: "1",
    executionReservationId: "123e4567-e89b-42d3-a456-426614174003",
    browserWalletActionHash: digest("6"),
    reportIdempotencyKey: "transaction-report-stable",
    expiresAt: "2099-08-10T12:00:00.000Z",
    reservedTransactionHash: `0x${"0".repeat(64)}`,
  };
}

function broadcastRecovery(): BroadcastLaunchRecoveryV2 {
  const prepared = preparedRecovery();
  return {
    stage: "broadcast",
    applicationHandle: prepared.applicationHandle,
    githubPrincipalHash: prepared.githubPrincipalHash,
    grantId: prepared.grantId,
    grantBindingHash: prepared.grantBindingHash,
    sessionId: prepared.sessionId,
    permitId: prepared.permitId,
    chainId: prepared.chainId,
    executionReservationId: prepared.executionReservationId,
    browserWalletActionHash: prepared.browserWalletActionHash,
    reportIdempotencyKey: prepared.reportIdempotencyKey,
    expiresAt: prepared.expiresAt,
    transactionHash: `0x${"7".repeat(64)}`,
  };
}

function refreshedApplicantSession(
  overrides: Partial<{
    accessToken: string;
    identityToken: string;
    privyUserId: string;
    githubUserId: string;
    githubLogin: string;
    launchWallet: `0x${string}`;
  }> = {},
) {
  return {
    accessToken: "access-current",
    identityToken: "identity-current",
    privyUserId: "did:privy:applicant",
    githubUserId,
    githubLogin,
    launchWallet: walletAccount as `0x${string}`,
    ...overrides,
  };
}

function sessionInput(
  overrides: Partial<Parameters<typeof acquireCurrentCustomLaunchWebsiteSessionV2>[0]> = {},
): Parameters<typeof acquireCurrentCustomLaunchWebsiteSessionV2>[0] {
  return {
    expectedGithubUserId: githubUserId,
    expectedGithubLogin: githubLogin,
    expectedWalletAccount: walletAccount,
    refreshApplicantSession: async () => refreshedApplicantSession(),
    isCurrent: () => true,
    ...overrides,
  };
}

function dangerousSequenceEffects() {
  return {
    createChallenge: vi.fn(async () => "challenge"),
    bindPreparation: vi.fn(async () => "preparation"),
    signLaunchMessage: vi.fn(async () => "wallet-proof"),
    authenticateWallet: vi.fn(async () => "authentication"),
    authorizeLaunch: vi.fn(async () => "authorization"),
    createExecutionPreparation: vi.fn(async () => "execution"),
    sendBrowserWalletAction: vi.fn(async () => "send"),
  };
}

function approvedApplication(): PrincipalCustomLaunchApplicationSummaryV2 {
  return {
    applicationId: "application-1",
    applicationHandle,
    revisionId: "revision-1",
    repositoryId: "123",
    repositoryOwnerId: "309941960",
    repositoryFullName: "builder/project",
    pullRequestNumber: 7,
    commitOid: "a".repeat(40),
    treeOid: "b".repeat(40),
    state: "approved",
    reasonCodes: [],
    actionCodes: [],
    correctionCount: 0,
    correctionPreview: [],
    receiptDigest: digest("1"),
    launchEntitlementBindingHash: digest("2"),
    updatedAt: "2026-08-10T12:00:00.000Z",
  };
}

function applicationList(githubPrincipalHash = digest("3")) {
  return {
    schemaVersion: "programmable.principal-custom-launch-application-list.v3",
    subject: {
      provider: "github",
      githubUserId: "123456789",
      githubPrincipalHash,
    },
    applications: [approvedApplication()],
    nextCursor: null,
  };
}

describe("custom launch applicant session currentness", () => {
  it("adds explicit refresh only at local wallet effect boundaries", () => {
    const stages: Parameters<typeof customLaunchApplicantStageRequiresExplicitSessionV2>[0][] = [
      "challenge",
      "preparation",
      "wallet-signature",
      "wallet-authentication",
      "authorization",
      "execution",
      "wallet-send",
    ];
    expect(stages.filter(customLaunchApplicantStageRequiresExplicitSessionV2))
      .toEqual(["wallet-signature", "wallet-send"]);
  });

  it("does not read tokens for an already superseded wallet stage", async () => {
    const refreshSession = vi.fn();
    await expect(refreshCurrentCustomLaunchApplicantStageV2({
      stage: "wallet-send",
      refreshSession,
      assertCurrent: () => {
        throw new CustomLaunchApplicantSessionErrorV2(
          "superseded",
          "Your account or wallet changed",
        );
      },
    })).rejects.toMatchObject({ reason: "superseded" });
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("runs the production dangerous stages only in the fixed boundary-gated order", async () => {
    const effects = dangerousSequenceEffects();
    const stages: string[] = [];
    for (const [name, effect] of Object.entries(effects)) {
      effect.mockImplementation(async () => {
        stages.push(name);
        return name;
      });
    }

    await runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async (stage) => {
        stages.push(`refresh:${stage}`);
      },
      assertBoundary: () => {
        stages.push("assert");
      },
      ...effects,
    });

    expect(stages.filter((stage) => stage.startsWith("refresh:"))).toEqual([
      "refresh:challenge",
      "refresh:preparation",
      "refresh:wallet-signature",
      "refresh:wallet-authentication",
      "refresh:authorization",
      "refresh:execution",
      "refresh:wallet-send",
    ]);
    expect(stages.filter((stage) => !stage.startsWith("refresh:") && stage !== "assert"))
      .toEqual([
        "createChallenge",
        "bindPreparation",
        "signLaunchMessage",
        "authenticateWallet",
        "authorizeLaunch",
        "createExecutionPreparation",
        "sendBrowserWalletAction",
      ]);
  });

  it("returns a broadcast for durable recovery when the boundary changes during send", async () => {
    const effects = dangerousSequenceEffects();
    const persistBroadcast = vi.fn();
    let current = true;
    effects.sendBrowserWalletAction.mockImplementation(async () => {
      current = false;
      persistBroadcast("0xtransaction");
      return "0xtransaction";
    });

    await expect(runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async () => undefined,
      assertBoundary: () => {
        if (!current) throw new Error("superseded boundary");
      },
      ...effects,
    })).resolves.toMatchObject({ send: "0xtransaction" });
    expect(persistBroadcast).toHaveBeenCalledWith("0xtransaction");
    expect(effects.sendBrowserWalletAction).toHaveBeenCalledOnce();
  });

  it("keeps a prepared recovery unsubmitted when the final session refresh fails", async () => {
    const effects = dangerousSequenceEffects();
    let persistedRecovery: PreparedLaunchRecoveryV2 | null = null;
    effects.createExecutionPreparation.mockImplementation(async () => {
      persistedRecovery = preparedRecovery();
      return "execution";
    });
    const getSession = vi.fn(async (stage: string) => {
      if (stage === "wallet-send") {
        throw new CustomLaunchApplicantSessionErrorV2(
          "authentication",
          "Reconnect GitHub to continue",
        );
      }
    });

    await expect(runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async (stage) => {
        await refreshCurrentCustomLaunchApplicantStageV2({
          stage,
          assertCurrent: () => undefined,
          refreshSession: () => getSession(stage),
        });
      },
      assertBoundary: () => undefined,
      ...effects,
    })).rejects.toMatchObject({ reason: "authentication" });

    expect(getSession).toHaveBeenLastCalledWith("wallet-send");
    expect(effects.createExecutionPreparation).toHaveBeenCalledOnce();
    expect(effects.sendBrowserWalletAction).not.toHaveBeenCalled();
    if (persistedRecovery === null) throw new Error("expected prepared recovery");
    expect(persistedRecovery).toMatchObject({
      stage: "prepared",
      walletRequestAttempted: false,
    });
    const progress = customLaunchPersistedRecoveryProgressV2(persistedRecovery);
    const display = customLaunchRecoveryDisplayV2(progress);
    const html = renderToStaticMarkup(createElement(CustomLaunchRecoveryCopyV2, {
      launchProgress: progress,
    }));
    expect(display).toMatchObject({
      title: "Launch not submitted",
      submitted: false,
    });
    expect(html).toContain("Launch not submitted");
    expect(html).toContain("Checking the reserved launch");
    expect(html).not.toContain("Launch submitted");
  });

  it("labels only broadcast recovery as submitted", () => {
    const recovery = broadcastRecovery();
    const progress = customLaunchPersistedRecoveryProgressV2(recovery);
    const display = customLaunchRecoveryDisplayV2(progress);
    const html = renderToStaticMarkup(createElement(CustomLaunchRecoveryCopyV2, {
      launchProgress: progress,
    }));
    expect(progress).toBe("confirmation");
    expect(recovery.transactionHash).toMatch(/^0x[0-9a-f]{64}$/u);
    expect(display).toMatchObject({
      title: "Launch submitted",
      submitted: true,
    });
    expect(html).toContain("Launch submitted");
    expect(html).not.toContain("Launch not submitted");
  });

  it("keeps a lost wallet response ambiguous across reload without a resend", async () => {
    const effects = dangerousSequenceEffects();
    const walletSideEffect = vi.fn();
    let storedRecovery: string | null = null;
    const storage = {
      getItem: () => storedRecovery,
      setItem: (_key: string, value: string) => {
        storedRecovery = value;
      },
    };
    effects.createExecutionPreparation.mockImplementation(async () => {
      requirePersistLaunchRecoveryV2(
        storage,
        "launch-recovery",
        preparedRecovery(),
      );
      return "execution";
    });
    effects.sendBrowserWalletAction.mockImplementation(async () => {
      const persistedRecovery = parsePersistedLaunchRecoveryV2(storedRecovery);
      if (persistedRecovery === null) {
        throw new Error("expected durable recovery before wallet request");
      }
      if (persistedRecovery.stage !== "prepared") {
        throw new Error("expected prepared recovery before wallet request");
      }
      requirePersistLaunchRecoveryV2(
        storage,
        "launch-recovery",
        customLaunchSubmissionUnknownRecoveryV2(persistedRecovery),
      );
      walletSideEffect();
      throw new Error("wallet response lost after request");
    });

    await expect(runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async () => undefined,
      assertBoundary: () => undefined,
      ...effects,
    })).rejects.toThrow("wallet response lost");

    expect(walletSideEffect).toHaveBeenCalledOnce();
    expect(effects.sendBrowserWalletAction).toHaveBeenCalledOnce();
    const reloadedRecovery = parsePersistedLaunchRecoveryV2(storedRecovery);
    expect(reloadedRecovery?.stage).toBe("submission-unknown");
    if (reloadedRecovery === null) throw new Error("expected reload recovery");
    expect(customLaunchRecoveryBlocksNewSubmissionV2({
      kind: "valid",
      recovery: reloadedRecovery,
    })).toBe(true);
    expect(customLaunchRecoveryBlocksNewSubmissionV2({ kind: "absent" }))
      .toBe(false);
    const progress = customLaunchPersistedRecoveryProgressV2(reloadedRecovery);
    const display = customLaunchRecoveryDisplayV2(progress);
    const html = renderToStaticMarkup(createElement(CustomLaunchRecoveryCopyV2, {
      launchProgress: progress,
    }));
    expect(display).toMatchObject({
      title: "Submission status unknown",
      submitted: null,
    });
    expect(html).toContain("Submission status unknown");
    expect(html).not.toContain("Launch not submitted");
    expect(html).not.toContain("Launch submitted");
  });

  it("acquires one canonical refreshed session for the exact principal and wallet", async () => {
    const refreshApplicantSession = vi.fn(async () => refreshedApplicantSession());

    await expect(acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
      refreshApplicantSession,
    }))).resolves.toEqual({
      accessToken: "access-current",
      identityToken: "identity-current",
    });
    expect(refreshApplicantSession).toHaveBeenCalledWith({
      githubUserId,
      githubLogin,
      launchWallet: walletAccount,
    });
  });

  it("fails closed when identity is visible but canonical refresh returns null", async () => {
    const refreshApplicantSession = vi.fn(async () => null);
    const downstream = vi.fn();

    await expect(acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
      refreshApplicantSession,
    })).then(downstream)).rejects.toMatchObject({
      reason: "authentication",
      message: "Reconnect GitHub to continue",
    });
    expect(refreshApplicantSession).toHaveBeenCalledOnce();
    expect(downstream).not.toHaveBeenCalled();
  });

  it("preserves refresh rate limits as retryable service capacity", async () => {
    const request = acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
      refreshApplicantSession: async () => {
        throw new ApplicantRefreshUserUnavailableErrorV1();
      },
    }));

    await expect(request).rejects.toMatchObject({
      code: "applicant_session_rate_limited",
      status: 429,
    });
    await request.catch((error: unknown) => {
      expect(customLaunchApplicantRecoveryV2(error)).toBe("retry");
    });
  });

  it("keeps the production dangerous sequence at zero effects for refresh-null", async () => {
    const effects = dangerousSequenceEffects();
    await expect(runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async () => {
        await acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
          refreshApplicantSession: async () => null,
        }));
      },
      assertBoundary: () => undefined,
      ...effects,
    })).rejects.toMatchObject({ reason: "authentication" });
    for (const effect of Object.values(effects)) {
      expect(effect).not.toHaveBeenCalled();
    }
  });

  it("sanitizes canonical refresh failure and never starts the Website request", async () => {
    const fetchV2 = vi.fn();
    const client = createCustomLaunchWebsiteClientV2({
      getSession: () => acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
        refreshApplicantSession: async () => {
          throw new Error("provider detail must not cross");
        },
      })),
      fetch: fetchV2 as typeof fetch,
    });

    await expect(client.applications()).rejects.toEqual(
      new CustomLaunchApplicantSessionErrorV2(
        "authentication",
        "Reconnect GitHub to continue",
      ),
    );
    expect(fetchV2).not.toHaveBeenCalled();
  });

  it("keeps refresh failure before challenge, permit and send", async () => {
    const effects = dangerousSequenceEffects();
    await expect(runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async () => {
        await acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
          refreshApplicantSession: async () => {
            throw new Error("provider detail must not cross");
          },
        }));
      },
      assertBoundary: () => undefined,
      ...effects,
    })).rejects.toMatchObject({ reason: "authentication" });
    for (const effect of Object.values(effects)) {
      expect(effect).not.toHaveBeenCalled();
    }
  });

  it("keeps approval retained and wallet effects closed across reauthorization failure", async () => {
    const retainedApproval = approvedApplication();
    const reauthorizeGithub = vi.fn(async () => {
      throw new Error("provider grant refresh failed");
    });
    const refreshCurrent = vi.fn(async () => refreshedApplicantSession());
    const effects = dangerousSequenceEffects();

    await expect(runCustomLaunchApplicantReauthorizationV2({
      reauthorizeGithub,
      refreshCurrent,
    })).rejects.toThrow("provider grant refresh failed");
    expect(retainedApproval.state).toBe("approved");
    expect(customApplicationHasCurrentLaunchEntitlementV2(retainedApproval)).toBe(true);
    expect(customApplicationHasDurableApprovalV2(retainedApproval, null)).toBe(false);
    expect(refreshCurrent).not.toHaveBeenCalled();
    for (const effect of Object.values(effects)) {
      expect(effect).not.toHaveBeenCalled();
    }
  });

  it("requires canonical refresh after successful reauthorization before recovery", async () => {
    const events: string[] = [];
    const reauthorizeGithub = vi.fn(async () => {
      events.push("reauthorize");
    });
    const refreshCurrent = vi.fn(async () => {
      events.push("canonical-refresh");
      throw new CustomLaunchApplicantSessionErrorV2(
        "authentication",
        "Reconnect GitHub to continue",
      );
    });
    const effects = dangerousSequenceEffects();

    await expect(runCustomLaunchApplicantReauthorizationV2({
      reauthorizeGithub,
      refreshCurrent,
    })).rejects.toMatchObject({ reason: "authentication" });
    expect(events).toEqual(["reauthorize", "canonical-refresh"]);
    for (const effect of Object.values(effects)) {
      expect(effect).not.toHaveBeenCalled();
    }
  });

  it("aborts a refreshed session when the account or wallet generation changes", async () => {
    let current = true;
    await expect(acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
      refreshApplicantSession: async () => {
        current = false;
        return refreshedApplicantSession();
      },
      isCurrent: () => current,
    }))).rejects.toMatchObject({ reason: "superseded" });
  });

  it("rejects refreshed wrong GitHub, login, or wallet metadata before effects", async () => {
    for (const refreshed of [
      refreshedApplicantSession({ githubUserId: "987654321" }),
      refreshedApplicantSession({ githubLogin: "wrong-account" }),
      refreshedApplicantSession({ launchWallet: otherWalletAccount as `0x${string}` }),
    ]) {
      const effects = dangerousSequenceEffects();
      const refreshApplicantSession = vi.fn(async () => refreshed);
      await expect(runCurrentCustomLaunchApplicantSequenceV2({
        refreshBoundary: async () => {
          await acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
            refreshApplicantSession,
          }));
        },
        assertBoundary: () => undefined,
        ...effects,
      })).rejects.toMatchObject({ reason: "superseded" });
      expect(refreshApplicantSession).toHaveBeenCalledOnce();
      for (const effect of Object.values(effects)) {
        expect(effect).not.toHaveBeenCalled();
      }
    }
  });

  it("stops before signature, permit, execution and send when the local refresh is stale", async () => {
    const effects = dangerousSequenceEffects();
    await expect(runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async (stage) => {
        await refreshCurrentCustomLaunchApplicantStageV2({
          stage,
          assertCurrent: () => undefined,
          refreshSession: () => acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
            refreshApplicantSession: async () =>
              stage === "wallet-signature" ? null : refreshedApplicantSession(),
          })),
        });
      },
      assertBoundary: () => undefined,
      ...effects,
    })).rejects.toMatchObject({ reason: "authentication" });
    expect(effects.createChallenge).toHaveBeenCalledOnce();
    expect(effects.bindPreparation).toHaveBeenCalledOnce();
    expect(effects.signLaunchMessage).not.toHaveBeenCalled();
    expect(effects.authenticateWallet).not.toHaveBeenCalled();
    expect(effects.authorizeLaunch).not.toHaveBeenCalled();
    expect(effects.createExecutionPreparation).not.toHaveBeenCalled();
    expect(effects.sendBrowserWalletAction).not.toHaveBeenCalled();
  });

  it("invalidates a deferred flow at the commit boundary before any dangerous stage", async () => {
    let resolveRefresh!: (value: ReturnType<typeof refreshedApplicantSession>) => void;
    const refreshed = new Promise<ReturnType<typeof refreshedApplicantSession>>((resolve) => {
      resolveRefresh = resolve;
    });
    const oldBoundary = customLaunchApplicantSessionBoundaryKeyV2({
      authReady: true,
      authenticated: true,
      githubConnected: true,
      githubUserId,
      walletAccount,
    });
    const newBoundary = customLaunchApplicantSessionBoundaryKeyV2({
      authReady: true,
      authenticated: true,
      githubConnected: true,
      githubUserId: "987654321",
      walletAccount: otherWalletAccount,
    });
    const guard = new CustomLaunchApplicantBoundaryGuardV2(oldBoundary);
    const snapshot = guard.snapshot(oldBoundary);
    const effects = dangerousSequenceEffects();
    const flow = runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async () => {
        await acquireCurrentCustomLaunchWebsiteSessionV2(sessionInput({
          refreshApplicantSession: async () => refreshed,
          isCurrent: () => guard.isCurrent(snapshot),
        }));
      },
      assertBoundary: () => {
        if (!guard.isCurrent(snapshot)) {
          throw new CustomLaunchApplicantSessionErrorV2(
            "superseded",
            "Your account or wallet changed",
          );
        }
      },
      ...effects,
    });

    // CustomLaunchExperience commits this guard from its root callback ref,
    // before a superseded render can yield to passive effects or interaction.
    expect(guard.commit(newBoundary)).toBe(true);
    resolveRefresh(refreshedApplicantSession());

    await expect(flow).rejects.toMatchObject({ reason: "superseded" });
    for (const effect of Object.values(effects)) {
      expect(effect).not.toHaveBeenCalled();
    }
  });

  it("does not let a stale finally release a newer single-flight owner", async () => {
    const lock = new CustomLaunchApplicantSingleFlightV2();
    const staleOwner = lock.acquire();
    expect(staleOwner).not.toBeNull();
    expect(lock.acquire()).toBeNull();

    lock.release(staleOwner!);
    const currentOwner = lock.acquire();
    expect(currentOwner).not.toBeNull();

    let resolveChallenge!: () => void;
    const challenge = new Promise<void>((resolve) => {
      resolveChallenge = resolve;
    });
    const createChallenge = vi.fn(async () => challenge);
    const authorizeLaunch = vi.fn();
    const sendBrowserWalletAction = vi.fn();
    const currentFlow = (async () => {
      await createChallenge();
      await authorizeLaunch();
      await sendBrowserWalletAction();
    })();

    // The old flow settles after the current owner has acquired the lock.
    lock.release(staleOwner!);
    expect(lock.active).toBe(true);
    expect(lock.acquire()).toBeNull();
    expect(createChallenge).toHaveBeenCalledOnce();
    expect(authorizeLaunch).not.toHaveBeenCalled();
    expect(sendBrowserWalletAction).not.toHaveBeenCalled();
    resolveChallenge();
    await currentFlow;
    lock.release(currentOwner!);
  });

  it("does not cache a session across reload or resume requests", async () => {
    let generation = 0;
    const headers: string[] = [];
    const getSession = vi.fn(async () => {
      generation += 1;
      return {
        accessToken: `access-${generation}`,
        identityToken: `identity-${generation}`,
      };
    });
    const client = createCustomLaunchWebsiteClientV2({
      getSession,
      fetch: vi.fn(async (_path, init) => {
        const requestHeaders = new Headers(init?.headers);
        headers.push(
          `${requestHeaders.get("authorization")}/${requestHeaders.get("x-privy-identity-token")}`,
        );
        return new Response(JSON.stringify(applicationList()), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as typeof fetch,
    });

    const effects = dangerousSequenceEffects();
    effects.createChallenge.mockImplementation(async () => {
      await client.applications();
      return "challenge";
    });
    const run = () => runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async () => undefined,
      assertBoundary: () => undefined,
      ...effects,
    });

    await run();
    await run();

    expect(getSession).toHaveBeenCalledTimes(2);
    expect(headers).toEqual([
      "Bearer access-1/identity-1",
      "Bearer access-2/identity-2",
    ]);
  });

  it("stops before permit or send when the server rejects a stale session", async () => {
    const client = createCustomLaunchWebsiteClientV2({
      getSession: async () => ({
        accessToken: "access-current",
        identityToken: "identity-stale",
      }),
      fetch: vi.fn(async () => new Response(JSON.stringify({
        schemaVersion: "programmable.custom-launch-website-error.v2",
        code: "applicant_authentication_required",
        message: "Authentication required",
      }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as typeof fetch,
    });

    const effects = dangerousSequenceEffects();
    effects.createChallenge.mockImplementation(async () => {
      await client.applications();
      return "challenge";
    });
    await expect(runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async () => undefined,
      assertBoundary: () => undefined,
      ...effects,
    })).rejects.toMatchObject({
      status: 401,
      code: "applicant_authentication_required",
    });
    expect(effects.createChallenge).toHaveBeenCalledOnce();
    expect(effects.bindPreparation).not.toHaveBeenCalled();
    expect(effects.authorizeLaunch).not.toHaveBeenCalled();
    expect(effects.sendBrowserWalletAction).not.toHaveBeenCalled();
  });

  it("rejects a wrong GitHub principal before downstream launch work", async () => {
    const effects = dangerousSequenceEffects();
    await expect(runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async () => {
        assertCurrentCustomLaunchPrincipalV2(digest("3"), digest("4"));
      },
      assertBoundary: () => undefined,
      ...effects,
    })).rejects.toThrow("Reconnect the GitHub account that opened this submission");
    for (const effect of Object.values(effects)) {
      expect(effect).not.toHaveBeenCalled();
    }
  });

  it("keeps durable approval separate from transient recovery state", () => {
    const approved = approvedApplication();
    expect(customApplicationHasCurrentLaunchEntitlementV2(approved)).toBe(true);
    expect(customApplicationHasDurableApprovalV2(approved)).toBe(false);
    expect(customApplicationHasDurableApprovalV2(approved, "ACTIVE")).toBe(true);
    expect(customApplicationHasCurrentLaunchEntitlementV2({
      ...approved,
      receiptDigest: null,
    })).toBe(false);
    expect(customApplicationHasCurrentLaunchEntitlementV2({
      ...approved,
      launchEntitlementBindingHash: null,
    })).toBe(false);
    expect(customLaunchApplicantRecoveryV2(
      new CustomLaunchWebsiteRequestErrorV2(503, "provider_unavailable"),
    )).toBe("retry");
    expect(customLaunchApplicantRecoveryV2(
      new CustomLaunchWebsiteRequestErrorV2(401, "applicant_authentication_required"),
    )).toBe("reconnect-github");
    expect(customLaunchApplicantRecoveryV2(
      new CustomLaunchWebsiteRequestErrorV2(401, "github_app_authorization_required"),
    )).toBe("authorize-github-app");
  });

  it("recovers with a fresh session after a temporary provider failure", async () => {
    let unavailable = true;
    let sessionGeneration = 0;
    const client = createCustomLaunchWebsiteClientV2({
      getSession: async () => {
        sessionGeneration += 1;
        return {
          accessToken: `access-${sessionGeneration}`,
          identityToken: `identity-${sessionGeneration}`,
        };
      },
      fetch: vi.fn(async () => unavailable
        ? new Response(JSON.stringify({
            schemaVersion: "programmable.custom-launch-website-error.v2",
            code: "provider_unavailable",
            message: "Temporarily unavailable",
          }), {
            status: 503,
            headers: { "content-type": "application/json" },
          })
        : new Response(JSON.stringify(applicationList()), {
            status: 200,
            headers: { "content-type": "application/json" },
          })) as typeof fetch,
    });
    const effects = dangerousSequenceEffects();
    effects.createChallenge.mockImplementation(async () => {
      await client.applications();
      return "challenge";
    });
    const run = () => runCurrentCustomLaunchApplicantSequenceV2({
      refreshBoundary: async () => undefined,
      assertBoundary: () => undefined,
      ...effects,
    });

    await expect(run()).rejects.toMatchObject({ status: 503 });
    expect(effects.bindPreparation).not.toHaveBeenCalled();
    expect(effects.authorizeLaunch).not.toHaveBeenCalled();
    expect(effects.sendBrowserWalletAction).not.toHaveBeenCalled();
    expect(customApplicationHasCurrentLaunchEntitlementV2(approvedApplication())).toBe(true);
    expect(customApplicationHasDurableApprovalV2(approvedApplication())).toBe(false);
    unavailable = false;
    await expect(run()).resolves.toMatchObject({
      challenge: "challenge",
      send: "send",
    });
    expect(effects.authorizeLaunch).toHaveBeenCalledOnce();
    expect(effects.sendBrowserWalletAction).toHaveBeenCalledOnce();
    expect(sessionGeneration).toBe(2);
  });

  it("keeps transport and grant expiry out of Applicant-facing approval copy", () => {
    const componentSource = readFileSync(join(
      process.cwd(),
      "components/custom-launch-experience.tsx",
    ), "utf8");
    const clientSource = readFileSync(join(
      process.cwd(),
      "lib/custom-launch/client-v2.ts",
    ), "utf8");
    const walletSource = readFileSync(join(
      process.cwd(),
      "components/wallet-provider.tsx",
    ), "utf8");

    expect(componentSource).not.toContain("Approval valid until");
    expect(componentSource).not.toContain("Ready to launch");
    expect(componentSource).toContain("Approved for launch");
    expect(componentSource).toContain("Launch access expired");
    expect(componentSource).toContain("ref={boundaryRef}");
    expect(componentSource).toContain("const commitSessionBoundary =");
    expect(componentSource).toContain("sessionBoundaryGuardRef.current.commit(sessionBoundaryKey)");
    expect(componentSource).toContain("createCustomLaunchWebsiteClientV2({ getSession })");
    expect(componentSource).toContain("const sequence = await runCurrentCustomLaunchApplicantSequenceV2({");
    expect(componentSource).toContain("if (customLaunchRecoveryBlocksNewSubmissionV2(recoveryRead))");
    expect(componentSource).toContain("An existing launch attempt must be resolved before another transaction can be submitted");
    const unknownPersistence = componentSource.indexOf(
      "const submissionUnknownRecovery = customLaunchSubmissionUnknownRecoveryV2(",
    );
    const walletRequest = componentSource.indexOf(
      "const hash = await sendBrowserWalletAction({",
      unknownPersistence,
    );
    expect(unknownPersistence).toBeGreaterThan(-1);
    expect(walletRequest).toBeGreaterThan(unknownPersistence);
    expect(componentSource.indexOf(
      "requirePersistLaunchSession(",
      unknownPersistence,
    )).toBeLessThan(walletRequest);
    expect(componentSource).toContain("if (isActive()) {\n        setTransactionHash(hash);");
    expect(componentSource).toContain("refreshApplicantSession,");
    expect(componentSource).not.toContain("getIdentityToken,");
    expect(componentSource).not.toContain("getAccessToken,");
    expect(componentSource).toContain("runCustomLaunchApplicantReauthorizationV2({");
    const removedComponent = ["manual", "applicant", "launch"].join("-");
    expect(componentSource).not.toContain(`from "@/components/${removedComponent}"`);
    expect(clientSource).toContain("getSession: () => Promise<CustomLaunchWebsiteSessionV2>");
    expect(clientSource).not.toContain("session: CustomLaunchWebsiteSessionV2");
    expect(walletSource).toContain("const { refreshUser } = useUser();");
    expect(walletSource).toContain("refreshApplicantSession,");
    expect(walletSource).toContain("loadIdentityToken: getPrivyIdentityToken");
  });
});
