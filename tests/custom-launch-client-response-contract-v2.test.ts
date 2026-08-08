import { describe, expect, it, vi } from "vitest";

import {
  createCustomLaunchWebsiteClientV2,
  CustomLaunchWebsiteRequestErrorV2,
} from "../lib/custom-launch/client-v2";

const DIGEST = (digit: string) => `sha256:${digit.repeat(64)}`;
const SESSION_ID = "123e4567-e89b-42d3-a456-426614174001";
const GRANT_ID = "123e4567-e89b-42d3-a456-426614174002";
const APPLICATION_HANDLE = `github-${"a".repeat(64)}` as const;
const APPROVED_PLAN_PROVIDER_RECIPIENT_FIXTURE =
  "0x1111111111111111111111111111111111111111";

function clientFor(value: unknown, status = 200) {
  return createCustomLaunchWebsiteClientV2({
    session: {
      accessToken: "access-token-value",
      identityToken: "identity-token-value",
    },
    fetch: vi.fn(async () => new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof fetch,
  });
}

function applicationList() {
  return {
    schemaVersion: "programmable.principal-custom-launch-application-list.v3",
    subject: {
      provider: "github",
      githubUserId: "123456789",
      githubPrincipalHash: DIGEST("1"),
    },
    applications: [{
      applicationId: "application-1",
      applicationHandle: APPLICATION_HANDLE,
      revisionId: "revision-1",
      repositoryId: "123456",
      repositoryOwnerId: "309941960",
      repositoryFullName: "builder/wild-game",
      pullRequestNumber: 7,
      commitOid: "a".repeat(40),
      treeOid: "b".repeat(40),
      state: "changes_required",
      reasonCodes: ["CORRECTION_REQUIRED"],
      actionCodes: ["UPDATE_SOURCE"],
      correctionCount: 1,
      correctionPreview: [{
        correctionId: "sender-binding",
        summary: "Bind the deployment to the authenticated sender",
      }],
      receiptDigest: null,
      launchEntitlementBindingHash: null,
      updatedAt: "2026-08-05T12:00:00.000Z",
    }],
    nextCursor: null,
  };
}

function launchDescriptor() {
  return {
    schemaVersion: "programmable.launch-route-discovery.v3",
    applicationId: "application-1",
    applicationHandle: APPLICATION_HANDLE,
    grantId: GRANT_ID,
    grantBindingHash: DIGEST("1"),
    descriptorHash: DIGEST("2"),
    validUntil: "2026-08-05T12:10:00.000Z",
    configurationSchema: {
      schemaVersion: "programmable.launch-configuration-schema.v2",
      schemaHash: DIGEST("3"),
      fields: [{
        fieldId: "tokenName",
        label: "Token name",
        kind: "text",
        required: true,
        maxLength: 64,
      }],
    },
    routes: [{
      choiceId: "ethereum",
      chainId: "1",
      chainProfileId: "ethereum-mainnet-v1",
      launchRouteId: "canonical-create2-graph-v1",
      launchRouteBindingHash: DIGEST("4"),
      routeAdapterId: "canonical-create2-graph-v1",
      executionMode: "browser-wallet-self-submit",
      walletActionKind: "eip1193-send-transaction",
      walletExecutionKind: "eoa-direct",
      transactionValuePolicy: { kind: "exact", valueWei: "0" },
      feePolicy: {
        schemaVersion: "programmable.custom-launch-fee-policy.v1",
        providerId: "programmable",
        modelId: "custom-contract-graph",
        templateId: "standard-custom",
        semanticVersion: "1.0.0",
        feeMode: "standard-programmable-custom",
        marketPathId: "official-market-path-v1",
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
      },
    }],
    defaultChoiceId: "ethereum",
  };
}

function launchEligibility() {
  return {
    schemaVersion: "programmable.launch-eligibility-view.v3",
    applicationId: "application-1",
    applicationHandle: APPLICATION_HANDLE,
    grantId: GRANT_ID,
    grantBindingHash: DIGEST("1"),
    state: "active",
    launchAllowed: true,
    receiptDigest: DIGEST("5"),
    validFrom: "2026-08-05T12:00:00.000Z",
    validUntil: "2026-08-05T12:10:00.000Z",
  };
}

function launchAuthorityRefresh(state: "pending" | "current" | "failed") {
  return {
    schemaVersion: "programmable.principal-launch-authority-refresh.v1",
    state,
    requestId: DIGEST("2"),
    requestDigest: DIGEST("2"),
    applicationId: "application-1",
    applicationHandle: APPLICATION_HANDLE,
    grantId: GRANT_ID,
    grantBindingHash: DIGEST("1"),
    requestedAt: "2026-08-05T12:00:00.000Z",
    observationHash: state === "current" ? DIGEST("3") : null,
    validUntil: state === "current" ? "2026-08-05T12:10:00.000Z" : null,
  };
}

function browserPreparation() {
  return {
    schemaVersion: "programmable.browser-wallet-launch-preparation.v2",
    transport: "browser-wallet-self-submit",
    walletExecutionKind: "eoa-direct",
    executionReservationId: "123e4567-e89b-42d3-a456-426614174003",
    grantId: GRANT_ID,
    chainId: "1",
    browserWalletAction: {
      schemaVersion: "programmable.browser-wallet-action.v2",
      walletExecutionKind: "eoa-direct",
      method: "eth_sendTransaction",
      chainId: "1",
      params: [{
        from: `0x${"1".repeat(40)}`,
        to: `0x${"2".repeat(40)}`,
        data: "0x1234",
        value: "0x0",
      }],
    },
    browserWalletActionHash: DIGEST("5"),
    actionPermitBinding: {
      schemaVersion: "programmable.browser-wallet-action-permit-binding.v2",
      permitId: DIGEST("6"),
      permitPayloadHash: DIGEST("7"),
      signedPermitArtifactHash: DIGEST("8"),
      permitRequestHash: DIGEST("9"),
      transactionSender: { namespace: "eip155:1", value: `0x${"1".repeat(40)}` },
      transactionTarget: { namespace: "eip155:1", value: `0x${"2".repeat(40)}` },
      transactionValueWei: "0",
      deploymentCalldataHash: DIGEST("a"),
      create2RouteId: "programmable:create2-graph-deployer:v2",
      routeNonce: `0x${"ab".repeat(32)}`,
      executionValidAfter: "1785931200",
      executionValidUntil: "1785931800",
      browserWalletActionHash: DIGEST("5"),
      actionPermitBindingHash: DIGEST("b"),
    },
    senderBindingPolicyHash: DIGEST("c"),
    actionNotBefore: "2026-08-05T12:00:00.000Z",
    expiresAt: "2026-08-05T12:10:00.000Z",
    authorityBindingHash: DIGEST("d"),
  };
}

async function expectContractMismatch(promise: Promise<unknown>) {
  await expect(promise).rejects.toMatchObject({
    status: 502,
    code: "response_contract_mismatch",
  } satisfies Partial<CustomLaunchWebsiteRequestErrorV2>);
}

describe("custom launch client response contracts", () => {
  it("accepts the complete application response contract", async () => {
    await expect(clientFor(applicationList()).applications()).resolves.toMatchObject({
      hasMore: false,
      applications: [{ applicationId: "application-1" }],
    });
  });

  it("uses the same bounded numeric GitHub identity contract as session authority", async () => {
    const maximum = applicationList();
    maximum.subject.githubUserId = "9".repeat(20);
    await expect(clientFor(maximum).applications()).resolves.toMatchObject({
      subject: { githubUserId: "9".repeat(20) },
    });

    const tooLong = applicationList();
    tooLong.subject.githubUserId = "9".repeat(21);
    await expectContractMismatch(clientFor(tooLong).applications());
  });

  it("uses the same bounded base64url pagination cursor contract as session authority", async () => {
    for (const cursor of ["a".repeat(16), "A".repeat(512)]) {
      const value = applicationList();
      Object.assign(value, { nextCursor: cursor });
      await expect(clientFor(value).applications()).resolves.toMatchObject({
        nextCursor: cursor,
      });
    }

    for (const cursor of ["a".repeat(15), "a".repeat(513), `${"a".repeat(16)}.`]) {
      const value = applicationList();
      Object.assign(value, { nextCursor: cursor });
      await expectContractMismatch(clientFor(value).applications());
    }
  });

  it("accepts only the explicit AEON, registry-v3, and legacy compatibility shapes", async () => {
    const legacyOmitted = applicationList();
    await expect(clientFor(legacyOmitted).applications()).resolves.toMatchObject({
      applications: [{ applicationId: "application-1" }],
    });

    const registryV3 = applicationList();
    Object.assign(registryV3.applications[0]!, {
      intakeContract: "registry-v3",
      controlRepositoryId: "1320171831",
      grandfatheredAtReleaseBindingDigest: null,
    });
    await expect(clientFor(registryV3).applications()).resolves.toMatchObject({
      applications: [{
        intakeContract: "registry-v3",
        controlRepositoryId: "1320171831",
      }],
    });

    const aeonV1 = applicationList();
    Object.assign(aeonV1.applications[0]!, {
      intakeContract: "aeon-v1",
      providerId: "aeon",
      controlRepositoryId: "1325324453",
      controlRepositoryOwnerId: "309941960",
    });
    await expect(clientFor(aeonV1).applications()).resolves.toMatchObject({
      applications: [{ intakeContract: "aeon-v1", providerId: "aeon" }],
    });

    const legacyV2 = applicationList();
    Object.assign(legacyV2.applications[0]!, {
      intakeContract: "legacy-v2",
      controlRepositoryId: "123456",
      grandfatheredAtReleaseBindingDigest: DIGEST("d"),
    });
    await expect(clientFor(legacyV2).applications()).resolves.toMatchObject({
      applications: [{ intakeContract: "legacy-v2" }],
    });
  });

  it("keeps legacy ids at 80 characters while Application V3 accepts 120", async () => {
    const registryMaximum = applicationList();
    registryMaximum.applications[0]!.applicationId = "a".repeat(120);
    Object.assign(registryMaximum.applications[0]!, {
      intakeContract: "registry-v3",
      providerId: "programmable-registry",
      controlRepositoryId: "1320171831",
      controlRepositoryOwnerId: "309941960",
      grandfatheredAtReleaseBindingDigest: null,
    });
    await expect(clientFor(registryMaximum).applications()).resolves.toMatchObject({
      applications: [{ applicationId: "a".repeat(120) }],
    });

    const registryTooLong = structuredClone(registryMaximum);
    registryTooLong.applications[0]!.applicationId = "a".repeat(121);
    await expectContractMismatch(clientFor(registryTooLong).applications());

    for (const tagged of [false, true]) {
      const legacyMaximum = applicationList();
      legacyMaximum.applications[0]!.applicationId = "b".repeat(80);
      if (tagged) {
        Object.assign(legacyMaximum.applications[0]!, {
          intakeContract: "legacy-v2",
          controlRepositoryId: "123456",
        });
      }
      await expect(clientFor(legacyMaximum).applications()).resolves.toMatchObject({
        applications: [{ applicationId: "b".repeat(80) }],
      });

      const legacyTooLong = structuredClone(legacyMaximum);
      legacyTooLong.applications[0]!.applicationId = "b".repeat(81);
      await expectContractMismatch(clientFor(legacyTooLong).applications());
    }

    const downstreamV3Maximum = launchDescriptor();
    downstreamV3Maximum.applicationId = "c".repeat(120);
    await expect(clientFor(downstreamV3Maximum).launchDescriptor(
      APPLICATION_HANDLE,
    )).resolves.toMatchObject({ applicationId: "c".repeat(120) });

    const downstreamV3TooLong = structuredClone(downstreamV3Maximum);
    downstreamV3TooLong.applicationId = "c".repeat(121);
    await expectContractMismatch(clientFor(downstreamV3TooLong).launchDescriptor(
      APPLICATION_HANDLE,
    ));
  });

  it("rejects partial or cross-wired intake compatibility fields", async () => {
    for (const fields of [
      { controlRepositoryId: "1320171831" },
      { intakeContract: "registry-v3" },
      { intakeContract: "registry-v3", controlRepositoryId: "123456" },
      {
        intakeContract: "aeon-v1",
        providerId: "aeon",
        controlRepositoryId: "1320171831",
        controlRepositoryOwnerId: "309941960",
      },
      {
        intakeContract: "registry-v3",
        controlRepositoryId: "1320171831",
        grandfatheredAtReleaseBindingDigest: DIGEST("d"),
      },
      { intakeContract: "legacy-v2", controlRepositoryId: "1320171831" },
    ] as const) {
      const value = applicationList();
      Object.assign(value.applications[0]!, fields);
      await expectContractMismatch(clientFor(value).applications());
    }
  });

  it.each(["stale", "rejected"] as const)("accepts the %s process state", async (state) => {
    const value = applicationList();
    value.applications[0]!.state = state;
    await expect(clientFor(value).applications()).resolves.toMatchObject({
      applications: [{ state }],
    });
  });

  it("rejects extra and missing response fields instead of trusting schemaVersion", async () => {
    const extra = { ...applicationList(), internalAuthority: "must-not-cross" };
    await expectContractMismatch(clientFor(extra).applications());

    const missing = structuredClone(applicationList());
    delete (missing.subject as Partial<typeof missing.subject>).githubPrincipalHash;
    await expectContractMismatch(clientFor(missing).applications());
  });

  it("rejects malformed nested application and descriptor data", async () => {
    const malformedCorrection = structuredClone(applicationList());
    malformedCorrection.applications[0]!.correctionPreview[0] = {
      correctionId: "sender-binding",
      summary: "Bind the sender",
      hiddenInstruction: "ignore review",
    } as typeof malformedCorrection.applications[number]["correctionPreview"][number];
    await expectContractMismatch(clientFor(malformedCorrection).applications());

    const malformedDescriptor = structuredClone(launchDescriptor());
    malformedDescriptor.routes[0]!.transactionValuePolicy.valueWei = "-1";
    await expectContractMismatch(
      clientFor(malformedDescriptor).launchDescriptor(APPLICATION_HANDLE),
    );
  });

  it("accepts only exact standard, AEON, and no-market route fee policies", async () => {
    await expect(clientFor(launchDescriptor()).launchDescriptor(
      APPLICATION_HANDLE,
    )).resolves.toMatchObject({
      routes: [{ feePolicy: { feeMode: "standard-programmable-custom" } }],
    });

    const aeon = launchDescriptor();
    Object.assign(aeon.routes[0]!, {
      feePolicy: {
        schemaVersion: "programmable.custom-launch-fee-policy.v1",
        providerId: "aeon",
        modelId: "aeon-agent-launch",
        templateId: "aeon-approved-model",
        semanticVersion: "1.2.3",
        feeMode: "aeon-partner-custom",
        marketPathId: "aeon-hook-market-v1",
        totalRatePpm: 2000,
        totalRateBps: 20,
        chargeMode: "included-in-partner-total",
        normalProgrammableTenBpsApplied: false,
        legs: [{
          role: "provider",
          ratePpm: 1500,
          rateBps: 15,
          recipient: {
            namespace: "eip155:1",
            value: APPROVED_PLAN_PROVIDER_RECIPIENT_FIXTURE,
          },
        }, {
          role: "programmable",
          ratePpm: 500,
          rateBps: 5,
          recipient: {
            namespace: "eip155:1",
            value: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
          },
        }],
      },
    });
    await expect(clientFor(aeon).launchDescriptor(APPLICATION_HANDLE)).resolves.toMatchObject({
      routes: [{ feePolicy: { providerId: "aeon", totalRateBps: 20 } }],
    });

    const noMarket = launchDescriptor();
    Object.assign(noMarket.routes[0]!, {
      feePolicy: {
        schemaVersion: "programmable.custom-launch-fee-policy.v1",
        providerId: "aeon",
        modelId: "aeon-agent-launch",
        templateId: "aeon-approved-model",
        semanticVersion: "1.2.3",
        feeMode: "no-qualifying-market",
        marketPathId: null,
        totalRatePpm: 0,
        totalRateBps: 0,
        chargeMode: "none",
        normalProgrammableTenBpsApplied: false,
        legs: [],
      },
    });
    await expect(clientFor(noMarket).launchDescriptor(APPLICATION_HANDLE)).resolves.toMatchObject({
      routes: [{ feePolicy: { feeMode: "no-qualifying-market", totalRateBps: 0 } }],
    });

    const invalidMutations = [
      { normalProgrammableTenBpsApplied: true },
      { providerId: "other-provider" },
      { semanticVersion: "1" },
      { totalRatePpm: 3000, totalRateBps: 30 },
    ];
    for (const mutation of invalidMutations) {
      const invalid = structuredClone(aeon);
      Object.assign(invalid.routes[0]!.feePolicy, mutation);
      await expectContractMismatch(clientFor(invalid).launchDescriptor(APPLICATION_HANDLE));
    }
  });

  it("requires grant-native launch eligibility identity", async () => {
    await expect(clientFor(launchEligibility()).launchEligibility(
      APPLICATION_HANDLE,
    )).resolves.toMatchObject({ grantId: GRANT_ID, grantBindingHash: DIGEST("1") });
    const missing = launchEligibility();
    delete (missing as Partial<typeof missing>).grantBindingHash;
    await expectContractMismatch(clientFor(missing).launchEligibility(APPLICATION_HANDLE));

    const malformedGrant = { ...launchEligibility(), grantId: "grant-1" };
    await expectContractMismatch(
      clientFor(malformedGrant).launchEligibility(APPLICATION_HANDLE),
    );
  });

  it("accepts duplicate public ids only when opaque application handles differ", async () => {
    const value = applicationList();
    value.applications.push({
      ...structuredClone(value.applications[0]!),
      applicationHandle: `github-${"b".repeat(64)}`,
      repositoryId: "654321",
      repositoryFullName: "builder/other-game",
      pullRequestNumber: 8,
    });
    await expect(clientFor(value).applications()).resolves.toMatchObject({
      applications: [
        { applicationId: "application-1", applicationHandle: APPLICATION_HANDLE },
        { applicationId: "application-1", applicationHandle: `github-${"b".repeat(64)}` },
      ],
    });

    value.applications[1]!.applicationHandle = APPLICATION_HANDLE;
    await expectContractMismatch(clientFor(value).applications());
  });

  it("rejects missing, extra, and malformed application handles", async () => {
    const missing = applicationList();
    delete (missing.applications[0] as Partial<typeof missing.applications[number]>).applicationHandle;
    await expectContractMismatch(clientFor(missing).applications());

    const malformed = applicationList();
    malformed.applications[0]!.applicationHandle = "application-1" as typeof APPLICATION_HANDLE;
    await expectContractMismatch(clientFor(malformed).applications());

    const extra = applicationList();
    (extra.applications[0] as typeof extra.applications[number] & { legacyId: string }).legacyId = "legacy";
    await expectContractMismatch(clientFor(extra).applications());
  });

  it("rejects malformed nested wallet actions before they reach browser execution", async () => {
    const valid = browserPreparation();
    await expect(clientFor(valid).createExecutionPreparation({
      schemaVersion: "programmable.browser-wallet-launch-preparation-request.v2",
      request: {} as never,
      authorizationArtifactBase64Url: "YXV0aG9yaXphdGlvbg",
    })).resolves.toMatchObject({ chainId: "1" });

    const substituted = structuredClone(valid);
    substituted.browserWalletAction.params[0]!.to = "https://evil.invalid";
    await expectContractMismatch(clientFor(substituted).createExecutionPreparation({
      schemaVersion: "programmable.browser-wallet-launch-preparation-request.v2",
      request: { sessionId: SESSION_ID, idempotencyKey: "request-1" } as never,
      authorizationArtifactBase64Url: "YXV0aG9yaXphdGlvbg",
    }));
  });

  it("enforces the launch authority refresh body and HTTP state contract", async () => {
    await expect(clientFor(
      launchAuthorityRefresh("pending"),
      202,
    ).launchAuthorityRefresh(
      APPLICATION_HANDLE,
      { schemaVersion: "programmable.principal-launch-authority-refresh-request.v1" },
      "launch-authority-refresh-request-1",
    )).resolves.toMatchObject({ state: "pending" });

    await expectContractMismatch(clientFor(
      launchAuthorityRefresh("pending"),
      200,
    ).launchAuthorityRefresh(
      APPLICATION_HANDLE,
      { schemaVersion: "programmable.principal-launch-authority-refresh-request.v1" },
      "launch-authority-refresh-request-1",
    ));

    const malformed = {
      ...launchAuthorityRefresh("current"),
      observationHash: null,
    };
    await expectContractMismatch(clientFor(malformed).launchAuthorityRefresh(
      APPLICATION_HANDLE,
      { schemaVersion: "programmable.principal-launch-authority-refresh-request.v1" },
      "launch-authority-refresh-request-1",
    ));

    const malformedGrant = {
      ...launchAuthorityRefresh("current"),
      grantId: "grant-1",
    };
    await expectContractMismatch(clientFor(malformedGrant).launchAuthorityRefresh(
      APPLICATION_HANDLE,
      { schemaVersion: "programmable.principal-launch-authority-refresh-request.v1" },
      "launch-authority-refresh-request-1",
    ));

    const uuidRequestId = {
      ...launchAuthorityRefresh("current"),
      requestId: "123e4567-e89b-42d3-a456-426614174099",
    };
    await expectContractMismatch(clientFor(uuidRequestId).launchAuthorityRefresh(
      APPLICATION_HANDLE,
      { schemaVersion: "programmable.principal-launch-authority-refresh-request.v1" },
      "launch-authority-refresh-request-1",
    ));

    const mismatchedRequestDigest = {
      ...launchAuthorityRefresh("current"),
      requestDigest: DIGEST("9"),
    };
    await expectContractMismatch(clientFor(mismatchedRequestDigest).launchAuthorityRefresh(
      APPLICATION_HANDLE,
      { schemaVersion: "programmable.principal-launch-authority-refresh-request.v1" },
      "launch-authority-refresh-request-1",
    ));

    const nonCanonicalApplicationId = {
      ...launchAuthorityRefresh("current"),
      applicationId: "Application-1",
    };
    await expectContractMismatch(clientFor(nonCanonicalApplicationId).launchAuthorityRefresh(
      APPLICATION_HANDLE,
      { schemaVersion: "programmable.principal-launch-authority-refresh-request.v1" },
      "launch-authority-refresh-request-1",
    ));
  });

  it("forwards refresh cancellation to the exact request fetch", async () => {
    const controller = new AbortController();
    const fetchV2 = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return new Response(JSON.stringify(launchAuthorityRefresh("pending")), {
        status: 202,
        headers: { "content-type": "application/json" },
      });
    });
    const client = createCustomLaunchWebsiteClientV2({
      session: {
        accessToken: "access-token-value",
        identityToken: "identity-token-value",
      },
      fetch: fetchV2 as typeof fetch,
    });
    await expect(client.launchAuthorityRefresh(
      APPLICATION_HANDLE,
      { schemaVersion: "programmable.principal-launch-authority-refresh-request.v1" },
      "launch-authority-refresh-request-1",
      { signal: controller.signal },
    )).resolves.toMatchObject({ state: "pending" });
    expect(fetchV2).toHaveBeenCalledOnce();
  });

  it("rejects malformed public error envelopes", async () => {
    await expectContractMismatch(clientFor({
      schemaVersion: "programmable.custom-launch-website-error.v2",
      code: "RESOURCE_NOT_FOUND",
      message: "Not found",
      privateDetail: "must-not-cross",
    }, 404).profile({
      namespace: "eip155:1",
      value: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }));
  });

  it("treats malformed success and error bodies as upstream contract failures", async () => {
    for (const response of [
      new Response("not json", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
      new Response("{", {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    ]) {
      const client = createCustomLaunchWebsiteClientV2({
        session: {
          accessToken: "access-token-value",
          identityToken: "identity-token-value",
        },
        fetch: vi.fn(async () => response) as typeof fetch,
      });
      await expectContractMismatch(client.profile({
        namespace: "eip155:1",
        value: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }));
    }
  });
});
