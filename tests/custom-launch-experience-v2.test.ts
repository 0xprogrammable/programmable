import {
  generateKeyPairSync,
  sign as signEd25519,
  type KeyObject,
} from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  assertBrowserWalletExecutionBinding,
  assertLaunchExecutionStatusBinding,
  assertLaunchSetupBindings,
  assertSamePrincipalApplicationRevisionV1,
  buildPresentationDraftFromForm,
  buildCustomLaunchSelection,
  configurationControlForKind,
  customApplicationDisplayState,
  customApplicationDisplayStateV2,
  customApplicationOpensLaunchExperience,
  customApplicationOpensLaunchExperienceV2,
  customApplicationSummaryCounts,
  customLaunchFeeReviewV1,
  defaultLaunchRoute,
  assertLaunchPermitFreshnessV2,
  fetchTrustedTimeV1,
  LaunchExecutionUnavailableError,
  parsePersistedLaunchRecoveryV2,
  presentationFormFromResponse,
  requirePersistLaunchRecoveryV2,
  reportPersistedLaunchTransactionV2,
  shouldClearLaunchRecoveryV2,
  validateLaunchConfigurationV2,
  verifyAuthorizedLaunchPermitSignatureV2,
} from "../components/custom-launch-experience";
import {
  canonicalBrowserJsonV2,
  canonicalBrowserSha256V2,
  fileSha256V2,
} from "../lib/custom-launch/browser-authority-v2";
import type {
  BrowserWalletLaunchPreparationV2,
  LaunchDescriptorV2,
  PrincipalCustomLaunchApplicationSummaryV2,
  PrincipalLaunchPresentationResponseV1,
  TrustedLaunchPermitSignerV2,
} from "../lib/custom-launch/contract-v2";
import { CustomLaunchWebsiteRequestErrorV2 } from "../lib/custom-launch/client-v2";
import { canonicalSha256 } from "../lib/server/projection-target/hashing";
import serviceGoldenPermit from "./fixtures/service-launch-permit-v2-golden.json";

const digest = (digit: string) => `sha256:${digit.repeat(64)}` as const;
const APPLICATION_HANDLE = `github-${"a".repeat(64)}` as const;
const GITHUB_PRINCIPAL_HASH = digest("f");
const APPROVED_PLAN_PROVIDER_RECIPIENT_FIXTURE =
  "0x1111111111111111111111111111111111111111";

function createPermitSignerFixture(keyId: string): Readonly<{
  privateKey: KeyObject;
  trustedSigner: TrustedLaunchPermitSignerV2;
}> {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" });
  const rawPublicKey = spki.subarray(spki.byteLength - 32);
  return {
    privateKey,
    trustedSigner: {
      keyId,
      signerEpoch: "1",
      signerComponentBindingHash: digest("a"),
      publicKeyBase64Url: rawPublicKey.toString("base64url"),
      publicKeySpkiSha256: fileSha256V2(spki),
    },
  };
}

const primaryPermitSigner = createPermitSignerFixture("launch-permit-primary");
const foreignPermitSigner = createPermitSignerFixture("launch-permit-foreign");

function descriptor(): LaunchDescriptorV2 {
  return {
    schemaVersion: "programmable.launch-route-discovery.v3",
    applicationId: "application-1",
    applicationHandle: APPLICATION_HANDLE,
    grantId: "123e4567-e89b-42d3-a456-426614174002",
    grantBindingHash: digest("1"),
    descriptorHash: digest("2"),
    validUntil: "2026-08-05T12:05:00.000Z",
    configurationSchema: {
      schemaVersion: "programmable.launch-configuration-schema.v2",
      schemaHash: digest("3"),
      fields: [
        { fieldId: "tokenSymbol", label: "Ticker", kind: "text", required: true, maxLength: 12 },
        { fieldId: "tokenName", label: "Name", kind: "text", required: true, maxLength: 64 },
      ],
    },
    routes: [{
      choiceId: "canonical",
      chainId: "1",
      chainProfileId: "ethereum-mainnet-v1",
      launchRouteId: "canonical-create2-graph-v1",
      launchRouteBindingHash: digest("4"),
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
    defaultChoiceId: "canonical",
  };
}

function application(): PrincipalCustomLaunchApplicationSummaryV2 {
  return {
    applicationId: "application-1",
    applicationHandle: APPLICATION_HANDLE,
    revisionId: "revision-1",
    repositoryId: "123",
    repositoryOwnerId: "309941960",
    repositoryFullName: "builder/wild-game",
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
  };
}

function presentationResponse(): PrincipalLaunchPresentationResponseV1 {
  return {
    schemaVersion: "programmable.principal-launch-presentation-response.v2",
    applicationId: "application-1",
    applicationHandle: APPLICATION_HANDLE,
    grantId: "123e4567-e89b-42d3-a456-426614174002",
    grantBindingHash: digest("1"),
    version: 1,
    outcome: "current",
    presentationBindingHash: digest("2"),
    record: {
      schemaVersion: "programmable.launch-presentation-record.v1",
      applicationId: "application-1",
      grantId: "123e4567-e89b-42d3-a456-426614174002",
      grantBindingHash: digest("1"),
      approvedModelIdentity: {
        schemaVersion: "programmable.approved-launch-model-identity.v1",
        platformId: "programmable",
        category: "custom",
        launchFamily: "custom",
        modelId: "wild-game",
      },
      approvedModelIdentityHash: digest("3"),
      presentation: {
        schemaVersion: "programmable.launch-presentation-draft.v1",
        description: "Wild game",
        image: null,
        links: [],
      },
      provenance: {
        kind: "presentation-only",
        source: "current-grant-bound-builder-input",
        mutableFields: ["description", "image", "links"],
        protectedFields: [],
        statement: "Presentation cannot change code.",
      },
      presentationBindingHash: digest("2"),
    },
    committedAt: "2026-08-05T12:00:00.000Z",
  };
}

function walletExecution(
  actionOverrides: Partial<BrowserWalletLaunchPreparationV2["browserWalletAction"]> = {},
  executionOverrides: Partial<BrowserWalletLaunchPreparationV2> = {},
): BrowserWalletLaunchPreparationV2 {
  const baseAction: BrowserWalletLaunchPreparationV2["browserWalletAction"] = {
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
  };
  const action = { ...baseAction, ...actionOverrides };
  const trusted = actionPermitFixture(baseAction);
  return {
    schemaVersion: "programmable.browser-wallet-launch-preparation.v2",
    transport: "browser-wallet-self-submit",
    walletExecutionKind: "eoa-direct",
    executionReservationId: "123e4567-e89b-42d3-a456-426614174003",
    grantId: "123e4567-e89b-42d3-a456-426614174002",
    chainId: "1",
    browserWalletAction: action,
    browserWalletActionHash: canonicalBrowserSha256V2(
      "programmable.browser-wallet-action.v2",
      action,
    ),
    actionPermitBinding: trusted.binding,
    senderBindingPolicyHash: digest("7"),
    actionNotBefore: "2026-08-05T12:00:00.000Z",
    expiresAt: "2026-08-05T12:10:00.000Z",
    authorityBindingHash: digest("8"),
    ...executionOverrides,
  };
}

function actionPermitFixture(
  action: BrowserWalletLaunchPreparationV2["browserWalletAction"],
  options: Readonly<{
    signer?: typeof primaryPermitSigner;
    issuedAt?: string;
    validUntil?: string;
  }> = {},
) {
  const signer = options.signer ?? primaryPermitSigner;
  const issuedAt = options.issuedAt ?? "2026-08-05T12:00:00.000Z";
  const validUntil = options.validUntil ?? "2026-08-05T12:10:00.000Z";
  const permitRequestHash = digest("9");
  const deploymentCalldataHash = fileSha256V2(Uint8Array.from([0x12, 0x34]));
  const transaction = action.params[0];
  const grantControlGenerations = {
    intakeAcceptance: "1",
    analysisDispatch: "1",
    decisionIssuance: "1",
    publicDecisionDisplay: "1",
    permitIssuance: "1",
    permitConsumption: "1",
    registryProjection: "1",
    websiteProjection: "1",
  };
  const tracePreimage = {
    schemaVersion: "programmable.evm-execution-trace-requirement.v1",
    disposition: "required",
    executionGraphHash: digest("1"),
    dynamicChildCapabilitySetHash: digest("2"),
    staticAnalysisBindingHash: digest("3"),
    traceAbsenceProofHash: null,
    requirementReasonCodes: ["dynamic_child_creation"],
  };
  const executionTraceRequirement = {
    ...tracePreimage,
    requirementHash: canonicalBrowserSha256V2(
      "programmable.evm-execution-trace-requirement.v1",
      tracePreimage,
    ),
  };
  const finalityPolicyPreimage = {
    schemaVersion: "programmable.launch-finality-policy.v2",
    finalityRouteId: "dual-provider-evm-v2",
    finalityRouteBindingHash: digest("4"),
    finalityVerificationAuthorityHash: digest("5"),
    expectedTransactionSender: {
      namespace: `eip155:${action.chainId}`,
      value: transaction.from,
    },
    expectedTransactionTarget: {
      namespace: `eip155:${action.chainId}`,
      value: transaction.to,
    },
    launchIdentityNamespace: `eip155:${action.chainId}/erc20`,
    launchIdentityLocator: {
      schemaVersion: "programmable.launch-identity-receipt-locator.v2",
      kind: "receipt-log-data-word",
      logAddress: transaction.to,
      topic0: `0x${"ab".repeat(32)}`,
      topicIndex: null,
      dataWordIndex: "0",
      expectedLogIndex: "0",
      expectedEventHash: digest("6"),
    },
    executionTraceRequirement,
    dynamicTraceRequirementHash: executionTraceRequirement.requirementHash,
  };
  const finalityPolicy = {
    ...finalityPolicyPreimage,
    finalityPolicyHash: canonicalBrowserSha256V2(
      "programmable.launch-finality-policy.v2",
      finalityPolicyPreimage,
    ),
  };
  const authority = {
    schemaVersion: "programmable.launch-permit-authority-bundle.v2",
    apiSchemaVersion: "programmable.launch-session-api.v2",
    grantId: "123e4567-e89b-42d3-a456-426614174002",
    grantBindingHash: digest("1"),
    authorizationOperation: "launch-session:launch:authorize",
    authorizationOperationBindingHash: digest("2"),
    authorizationVerificationAuthorityHash: digest("3"),
    authorizationRequestBodyHash: digest("4"),
    authorizationSignedAssertionHash: digest("5"),
    authorizationGitHubSessionBindingHash: digest("6"),
    authorizationAuthenticatedAt: "2026-08-05T11:59:00.000Z",
    authorizationExpiresAt: "2026-08-05T12:15:00.000Z",
    githubUserId: "123456789",
    githubPrincipalHash: digest("7"),
    challengeId: "123e4567-e89b-42d3-a456-426614174004",
    challengeBindingHash: digest("8"),
    sessionRecordId: "123e4567-e89b-42d3-a456-426614174005",
    sessionId: "123e4567-e89b-42d3-a456-426614174001",
    sessionBindingHash: digest("3"),
    sessionNonce: "123e4567-e89b-42d3-a456-426614174006",
    walletNonce: "123e4567-e89b-42d3-a456-426614174007",
    serviceChallengeHash: digest("1"),
    serviceSessionNonceHash: digest("2"),
    serviceWalletNonceHash: digest("3"),
    sessionExpiresAt: "2026-08-05T12:20:00.000Z",
    publicSourceFreshnessObservationHash: digest("4"),
    publicSourceFreshnessExpiresAt: "2026-08-05T12:20:00.000Z",
    controllerAuthoritySetHash: digest("5"),
    routeSelectionBindingHash: digest("6"),
    routeSelectionAuthorityHash: digest("7"),
    walletNamespace: `eip155:${action.chainId}`,
    walletValue: transaction.from,
    walletOwnershipBindingHash: digest("8"),
    walletMessageHash: digest("9"),
    walletOwnershipAssertionHash: digest("1"),
    walletOwnershipVerificationAuthorityHash: digest("2"),
    chainId: action.chainId,
    chainProfileId: "ethereum-mainnet-v1",
    chainProfileHash: digest("3"),
    launchRouteId: "canonical-create2-graph-v1",
    launchRouteBindingHash: digest("4"),
    executionMode: "browser-wallet-self-submit",
    transactionValueWei: BigInt(transaction.value).toString(10),
    templateBindingHash: digest("5"),
    launchSpecificationHash: digest("6"),
    preparationBindingHash: digest("7"),
    launchArtifactCommitmentHash: digest("8"),
    launchArtifactManifestHash: digest("9"),
    launchArtifactOutputSetHash: digest("1"),
    deploymentCalldataHash,
    compilerAuthorityBindingHash: digest("2"),
    create2RouteId: "programmable:create2-graph-deployer:v2" as const,
    routeNonce: `0x${"ab".repeat(32)}` as const,
    executionValidAfter: "1785931200",
    executionValidUntil: "1785931800",
    feeAssessmentHash: digest("3"),
    feeObligationHash: digest("4"),
    feeAssessmentObligationBindingHash: digest("5"),
    grantControlGenerations,
    grantControlGenerationsHash: canonicalBrowserSha256V2(
      "programmable.approval-control-generations.v2",
      grantControlGenerations,
    ),
    controlGenerationsHash: digest("6"),
    permitIssuanceGeneration: "1",
    permitConsumptionGeneration: "1",
    permitRequestHash,
  };
  const authorityBundleHash = canonicalBrowserSha256V2(
    "programmable.launch-permit-authority-bundle.v2",
    authority,
  );
  const executionIdempotencyKeyHash = digest("8");
  const executionRequest = {
    schemaVersion: "programmable.launch-execution-request.v2",
    audience: "programmable.launch-execution.v2",
    grantId: authority.grantId,
    grantBindingHash: authority.grantBindingHash,
    sessionRecordId: authority.sessionRecordId,
    sessionBindingHash: authority.sessionBindingHash,
    walletNamespace: authority.walletNamespace,
    walletValue: authority.walletValue,
    chainId: authority.chainId,
    chainProfileId: authority.chainProfileId,
    chainProfileHash: authority.chainProfileHash,
    launchRouteId: authority.launchRouteId,
    launchRouteBindingHash: authority.launchRouteBindingHash,
    executionMode: authority.executionMode,
    transactionValueWei: authority.transactionValueWei,
    launchArtifactCommitmentHash: authority.launchArtifactCommitmentHash,
    deploymentCalldataHash: authority.deploymentCalldataHash,
    feeAssessmentHash: authority.feeAssessmentHash,
    feeObligationHash: authority.feeObligationHash,
    feeAssessmentObligationBindingHash: authority.feeAssessmentObligationBindingHash,
    permitRequestHash: authority.permitRequestHash,
    executionIdempotencyKeyHash,
    finalityPolicyHash: finalityPolicy.finalityPolicyHash,
  };
  const executionRequestHash = canonicalBrowserSha256V2(
    "programmable.launch-execution-request.v2",
    executionRequest,
  );
  const reservation = {
    schemaVersion: "programmable.launch-permit-reservation.v2",
    permitReservationId: "123e4567-e89b-42d3-a456-426614174008",
    authorityBundleHash,
    executionRequestHash,
    executionIdempotencyKeyHash,
    nonce: "permit-reservation-nonce-0001",
    issuedAt,
    validUntil,
    signerKeyId: signer.trustedSigner.keyId,
    signerEpoch: signer.trustedSigner.signerEpoch,
    signerComponentBindingHash: signer.trustedSigner.signerComponentBindingHash,
    finalityPolicy,
    finalityPolicyHash: finalityPolicy.finalityPolicyHash,
  };
  const authorityPayload = Object.fromEntries(
    Object.entries(authority).filter(([key]) => key !== "schemaVersion"),
  );
  const unsignedPayload = {
    ...authorityPayload,
    schemaVersion: "programmable.launch-permit-payload.v2",
    audience: "programmable.launch-execution.v2",
    executionRequestHash,
    executionIdempotencyKeyHash,
    permitReservationId: reservation.permitReservationId,
    permitReservationBindingHash: canonicalBrowserSha256V2(
      "programmable.launch-permit-reservation.v2",
      reservation,
    ),
    nonce: reservation.nonce,
    issuedAt,
    validUntil,
    signerKeyId: signer.trustedSigner.keyId,
    signerEpoch: signer.trustedSigner.signerEpoch,
    signerComponentBindingHash: signer.trustedSigner.signerComponentBindingHash,
    finalityPolicy,
    finalityPolicyHash: finalityPolicy.finalityPolicyHash,
  };
  const permitId = canonicalBrowserSha256V2(
    "programmable.launch-permit-id.v2",
    unsignedPayload,
  );
  const payload = {
    ...unsignedPayload,
    permitId,
  };
  const permitPayloadHash = canonicalBrowserSha256V2(
    "programmable.launch-permit-payload.v2",
    payload,
  );
  const envelopePreimage = {
    schemaVersion: "programmable.launch-permit-envelope.v2" as const,
    domain: "programmable.launch-permit-envelope.v2" as const,
    audience: "programmable.launch-execution.v2" as const,
    permitId,
    payloadHash: permitPayloadHash,
    keyId: signer.trustedSigner.keyId,
    signerEpoch: signer.trustedSigner.signerEpoch,
    signerComponentBindingHash: signer.trustedSigner.signerComponentBindingHash,
  };
  const signingEnvelope = {
    ...envelopePreimage,
    envelopeHash: canonicalBrowserSha256V2(
      "programmable.launch-permit-envelope.v2",
      envelopePreimage,
    ),
  };
  const signatureBytes = signEd25519(
    null,
    Buffer.from(canonicalBrowserJsonV2(signingEnvelope), "utf8"),
    signer.privateKey,
  );
  const artifact = {
    schemaVersion: "programmable.signed-launch-permit.v2",
    payload,
    envelope: {
      ...signingEnvelope,
      signatureScheme: "ed25519",
      signature: signatureBytes.toString("base64url"),
      signatureHash: fileSha256V2(signatureBytes),
    },
  };
  const canonicalSignedPermitBase64Url = Buffer.from(
    canonicalBrowserJsonV2(artifact),
    "utf8",
  ).toString("base64url");
  const signedPermitArtifactHash = canonicalBrowserSha256V2(
    "programmable.signed-launch-permit.v2",
    artifact,
  );
  const browserWalletActionHash = canonicalBrowserSha256V2(
    "programmable.browser-wallet-action.v2",
    action,
  );
  const preimage = {
    schemaVersion: "programmable.browser-wallet-action-permit-binding.v2" as const,
    permitId,
    permitPayloadHash,
    signedPermitArtifactHash,
    permitRequestHash,
    transactionSender: {
      namespace: `eip155:${action.chainId}`,
      value: transaction.from,
    },
    transactionTarget: {
      namespace: `eip155:${action.chainId}`,
      value: transaction.to,
    },
    transactionValueWei: BigInt(transaction.value).toString(10),
    deploymentCalldataHash,
    create2RouteId: authority.create2RouteId,
    routeNonce: authority.routeNonce,
    executionValidAfter: authority.executionValidAfter,
    executionValidUntil: authority.executionValidUntil,
    browserWalletActionHash,
  };
  return {
    permitRequestHash,
    deploymentCalldataHash,
    permit: {
      schemaVersion: "programmable.authorized-launch-permit-view.v2" as const,
      grantId: "123e4567-e89b-42d3-a456-426614174002",
      sessionId: "123e4567-e89b-42d3-a456-426614174001",
      sessionBindingHash: digest("3"),
      permitId,
      permitPayloadHash,
      signedPermitArtifactHash,
      canonicalSignedPermitBase64Url,
      state: "authorized" as const,
      validUntil,
    },
    binding: {
      ...preimage,
      actionPermitBindingHash: canonicalBrowserSha256V2(
        "programmable.browser-wallet-action-permit-binding.v2",
        preimage,
      ),
    },
  };
}

function replacePermitArtifact(
  permit: ReturnType<typeof actionPermitFixture>["permit"],
  artifact: Record<string, unknown>,
) {
  return {
    ...permit,
    canonicalSignedPermitBase64Url: Buffer.from(
      canonicalBrowserJsonV2(artifact),
      "utf8",
    ).toString("base64url"),
    signedPermitArtifactHash: canonicalBrowserSha256V2(
      "programmable.signed-launch-permit.v2",
      artifact,
    ),
  };
}

describe("custom launch browser authority", () => {
  it("matches the server canonical hash exactly", () => {
    const value = {
      signatureScheme: "eip191:personal-sign",
      signatureBase64Url: "c2lnbmF0dXJl",
      schemaVersion: "programmable.launch-wallet-proof-transport.v2",
      nested: [true, null, { z: "last", a: "first" }],
    };

    expect(canonicalBrowserJsonV2(value)).toBe(
      '{"nested":[true,null,{"a":"first","z":"last"}],"schemaVersion":"programmable.launch-wallet-proof-transport.v2","signatureBase64Url":"c2lnbmF0dXJl","signatureScheme":"eip191:personal-sign"}',
    );
    expect(canonicalBrowserSha256V2(
      "programmable.launch-wallet-proof-transport.v2",
      value,
    )).toBe(canonicalSha256(
      "programmable.launch-wallet-proof-transport.v2",
      value,
    ));
  });

  it("rejects sparse arrays instead of hashing a different payload than the server", () => {
    const sparse: unknown[] = [];
    sparse.length = 2;
    sparse[1] = "value";
    expect(() => canonicalBrowserJsonV2(sparse)).toThrow("sparse arrays");
  });

  it("builds only the descriptor-approved route and fields", () => {
    const selection = buildCustomLaunchSelection({
      descriptor: descriptor(),
      wallet: "0x1111111111111111111111111111111111111111",
      configuration: {
        tokenSymbol: "WILD",
        tokenName: "Wild Game",
        hiddenAdmin: "must-not-cross",
      },
      presentationBindingHash: digest("9"),
    });

    expect(selection).toEqual({
      schemaVersion: "programmable.untrusted-launch-wallet-selection.v2",
      launcherWallet: {
        namespace: "eip155:1",
        value: "0x1111111111111111111111111111111111111111",
      },
      chainProfileId: "ethereum-mainnet-v1",
      requestedExecutionMode: "browser-wallet-self-submit",
      requestedRouteAdapterId: "canonical-create2-graph-v1",
      transactionValueWei: "0",
      presentationBindingHash: digest("9"),
      launchConfiguration: {
        schemaVersion: "programmable.launch-configuration.v2",
        schemaHash: digest("3"),
        values: [
          { fieldId: "tokenName", value: "Wild Game" },
          { fieldId: "tokenSymbol", value: "WILD" },
        ],
      },
    });
  });

  it("uses the exact default route even when it is not the first route", () => {
    const current = descriptor();
    const selected = current.routes[0]!;
    const other = {
      ...selected,
      choiceId: "other",
      chainId: "8453",
      chainProfileId: "base-mainnet-v1",
      launchRouteId: "base-route",
      routeAdapterId: "base-adapter",
    };
    const reordered: LaunchDescriptorV2 = {
      ...current,
      routes: [other, selected],
      defaultChoiceId: selected.choiceId,
    };

    expect(defaultLaunchRoute(reordered)).toMatchObject({
      chainId: "1",
      launchRouteId: "canonical-create2-graph-v1",
    });
    expect(buildCustomLaunchSelection({
      descriptor: reordered,
      wallet: "0x1111111111111111111111111111111111111111",
      configuration: { tokenName: "Wild Game", tokenSymbol: "WILD" },
    })).toMatchObject({
      launcherWallet: { namespace: "eip155:1" },
      chainProfileId: "ethereum-mainnet-v1",
      requestedRouteAdapterId: "canonical-create2-graph-v1",
    });
  });

  it("rejects substituted setup responses before showing an approved launch", () => {
    const eligibility = {
      schemaVersion: "programmable.launch-eligibility-view.v3" as const,
      applicationId: "application-1",
      applicationHandle: APPLICATION_HANDLE,
      grantId: "123e4567-e89b-42d3-a456-426614174002",
      grantBindingHash: digest("1"),
      state: "active" as const,
      launchAllowed: true,
      receiptDigest: digest("5"),
      validFrom: "2026-08-05T12:00:00.000Z",
      validUntil: "2099-08-05T12:05:00.000Z",
    };
    expect(() => assertLaunchSetupBindings({
      application: application(),
      eligibility,
      descriptor: descriptor(),
      presentation: presentationResponse(),
    })).not.toThrow();
    expect(() => assertLaunchSetupBindings({
      application: application(),
      eligibility: { ...eligibility, applicationId: "application-2" },
      descriptor: descriptor(),
      presentation: presentationResponse(),
    })).toThrow("binding mismatch");
    expect(() => assertLaunchSetupBindings({
      application: application(),
      eligibility: {
        ...eligibility,
        applicationHandle: `github-${"b".repeat(64)}`,
      },
      descriptor: descriptor(),
      presentation: presentationResponse(),
    })).toThrow("binding mismatch");
    expect(() => assertLaunchSetupBindings({
      application: application(),
      eligibility,
      descriptor: { ...descriptor(), applicationId: "application-2" },
      presentation: presentationResponse(),
    })).toThrow("binding mismatch");
    expect(() => assertLaunchSetupBindings({
      application: application(),
      eligibility: { ...eligibility, grantId: "123e4567-e89b-42d3-a456-426614174099" },
      descriptor: descriptor(),
      presentation: presentationResponse(),
    })).toThrow("binding mismatch");
    expect(() => assertLaunchSetupBindings({
      application: application(),
      eligibility: { ...eligibility, grantBindingHash: digest("9") },
      descriptor: descriptor(),
      presentation: presentationResponse(),
    })).toThrow("binding mismatch");
    expect(() => assertLaunchSetupBindings({
      application: application(),
      eligibility,
      descriptor: {
        ...descriptor(),
        applicationHandle: `github-${"b".repeat(64)}`,
      },
      presentation: presentationResponse(),
    })).toThrow("binding mismatch");
    expect(() => assertLaunchSetupBindings({
      application: application(),
      eligibility,
      descriptor: descriptor(),
      presentation: {
        ...presentationResponse(),
        grantBindingHash: digest("9"),
      },
    })).toThrow("presentation binding mismatch");
    expect(() => assertLaunchSetupBindings({
      application: application(),
      eligibility,
      descriptor: descriptor(),
      presentation: {
        ...presentationResponse(),
        applicationHandle: `github-${"b".repeat(64)}`,
      },
    })).toThrow("presentation binding mismatch");
    expect(() => assertLaunchSetupBindings({
      application: { ...application(), state: "changes_required" },
      eligibility,
      descriptor: descriptor(),
      presentation: presentationResponse(),
    })).toThrow("binding mismatch");
    expect(() => assertLaunchSetupBindings({
      application: { ...application(), state: "approved" },
      eligibility,
      descriptor: descriptor(),
      presentation: presentationResponse(),
    })).toThrow("binding mismatch");
    expect(() => assertLaunchSetupBindings({
      application: { ...application(), receiptDigest: null },
      eligibility,
      descriptor: descriptor(),
      presentation: presentationResponse(),
    })).toThrow("binding mismatch");
    expect(() => assertLaunchSetupBindings({
      application: { ...application(), launchEntitlementBindingHash: null },
      eligibility,
      descriptor: descriptor(),
      presentation: presentationResponse(),
    })).toThrow("binding mismatch");
    expect(() => assertLaunchSetupBindings({
      application: {
        ...application(),
        intakeContract: "registry-v3",
        providerId: "programmable-registry",
        controlRepositoryId: "1320171831",
        controlRepositoryOwnerId: "309941960",
        grandfatheredAtReleaseBindingDigest: null,
      },
      eligibility,
      descriptor: descriptor(),
      presentation: presentationResponse(),
    })).toThrow("binding mismatch");
  });

  it("accepts only the same exact GitHub revision across refresh and refetch", () => {
    expect(() => assertSamePrincipalApplicationRevisionV1(
      { ...application(), state: "ready_for_registration" },
      application(),
    )).not.toThrow();
    expect(() => assertSamePrincipalApplicationRevisionV1(
      application(),
      { ...application(), commitOid: "b".repeat(40) },
    )).toThrow("different GitHub revision");
    expect(() => assertSamePrincipalApplicationRevisionV1(
      application(),
      { ...application(), repositoryOwnerId: "1" },
    )).toThrow("different GitHub revision");
    expect(() => assertSamePrincipalApplicationRevisionV1(
      application(),
      { ...application(), treeOid: "c".repeat(40) },
    )).toThrow("different GitHub revision");
    expect(() => assertSamePrincipalApplicationRevisionV1(
      application(),
      { ...application(), launchEntitlementBindingHash: digest("9") },
    )).toThrow("different GitHub revision");
  });

  it("rejects self-consistent wallet actions substituted across grant, chain, value, or sender", () => {
    const currentDescriptor = descriptor();
    const selection = buildCustomLaunchSelection({
      descriptor: currentDescriptor,
      wallet: `0x${"1".repeat(40)}`,
      configuration: { tokenName: "Wild Game", tokenSymbol: "WILD" },
    });
    const trustedExecution = walletExecution();
    const trusted = actionPermitFixture(trustedExecution.browserWalletAction);
    const input = {
      descriptor: currentDescriptor,
      deploymentCalldataHash: trusted.deploymentCalldataHash,
      permit: trusted.permit,
      permitRequestHash: trusted.permitRequestHash,
      selection,
      wallet: `0x${"1".repeat(40)}` as `0x${string}`,
      now: Date.parse("2026-08-05T12:00:00.000Z"),
    };
    expect(() => assertBrowserWalletExecutionBinding({
      ...input,
      execution: trustedExecution,
    })).not.toThrow();
    expect(() => assertBrowserWalletExecutionBinding({
      ...input,
      execution: walletExecution({}, {
        grantId: "123e4567-e89b-42d3-a456-426614174099",
      }),
    })).toThrow("exact approved launch");
    expect(() => assertBrowserWalletExecutionBinding({
      ...input,
      execution: walletExecution({ chainId: "8453" }, { chainId: "8453" }),
    })).toThrow("exact approved launch");
    expect(() => assertBrowserWalletExecutionBinding({
      ...input,
      execution: walletExecution({
        params: [{
          from: `0x${"1".repeat(40)}`,
          to: `0x${"2".repeat(40)}`,
          data: "0x1234",
          value: "0x1",
        }],
      }),
    })).toThrow("exact approved launch");
    expect(() => assertBrowserWalletExecutionBinding({
      ...input,
      execution: walletExecution({
        params: [{
          from: `0x${"3".repeat(40)}`,
          to: `0x${"2".repeat(40)}`,
          data: "0x1234",
          value: "0x0",
        }],
      }),
    })).toThrow("exact approved launch");
    expect(() => assertBrowserWalletExecutionBinding({
      ...input,
      execution: walletExecution({
        params: [{
          from: `0x${"1".repeat(40)}`,
          to: `0x${"3".repeat(40)}`,
          data: "0x1234",
          value: "0x0",
        }],
      }),
    })).toThrow("signed launch permit");
    expect(() => assertBrowserWalletExecutionBinding({
      ...input,
      execution: walletExecution({
        params: [{
          from: `0x${"1".repeat(40)}`,
          to: `0x${"2".repeat(40)}`,
          data: "0x5678",
          value: "0x0",
        }],
      }),
    })).toThrow("exact approved launch");
  });

  it("verifies a permit only against the exact pinned Ed25519 signer identity", async () => {
    const fixture = actionPermitFixture(walletExecution().browserWalletAction);
    await expect(verifyAuthorizedLaunchPermitSignatureV2({
      permit: fixture.permit,
      trustedSigners: [primaryPermitSigner.trustedSigner],
    })).resolves.toEqual(primaryPermitSigner.trustedSigner);
    await expect(verifyAuthorizedLaunchPermitSignatureV2({
      permit: fixture.permit,
      trustedSigners: [],
    })).rejects.toThrow("signature authority");

    const foreign = actionPermitFixture(walletExecution().browserWalletAction, {
      signer: foreignPermitSigner,
    });
    await expect(verifyAuthorizedLaunchPermitSignatureV2({
      permit: foreign.permit,
      trustedSigners: [primaryPermitSigner.trustedSigner],
    })).rejects.toThrow("signature authority");
    await expect(verifyAuthorizedLaunchPermitSignatureV2({
      permit: fixture.permit,
      trustedSigners: [{
        ...primaryPermitSigner.trustedSigner,
        signerEpoch: "2",
      }],
    })).rejects.toThrow("signature authority");
    await expect(verifyAuthorizedLaunchPermitSignatureV2({
      permit: fixture.permit,
      trustedSigners: [{
        ...primaryPermitSigner.trustedSigner,
        signerComponentBindingHash: digest("b"),
      }],
    })).rejects.toThrow("signature authority");
    await expect(verifyAuthorizedLaunchPermitSignatureV2({
      permit: fixture.permit,
      trustedSigners: [{
        ...foreignPermitSigner.trustedSigner,
        keyId: primaryPermitSigner.trustedSigner.keyId,
        signerEpoch: primaryPermitSigner.trustedSigner.signerEpoch,
        signerComponentBindingHash:
          primaryPermitSigner.trustedSigner.signerComponentBindingHash,
      }],
    })).rejects.toThrow("signature is invalid");
  });

  it("rejects outer permit fields substituted away from the authenticated signed payload", async () => {
    const fixture = actionPermitFixture(walletExecution().browserWalletAction);
    for (const permit of [
      { ...fixture.permit, grantId: "123e4567-e89b-42d3-a456-426614174099" },
      { ...fixture.permit, sessionId: "123e4567-e89b-42d3-a456-426614174099" },
      { ...fixture.permit, sessionBindingHash: digest("f") },
    ]) {
      await expect(verifyAuthorizedLaunchPermitSignatureV2({
        permit,
        trustedSigners: [primaryPermitSigner.trustedSigner],
      })).rejects.toThrow("signature authority");
    }
  });

  it("accepts a real service-issued permit and rejects service-parser drift", async () => {
    const serviceArtifact = JSON.parse(Buffer.from(
      serviceGoldenPermit.canonicalSignedPermitBase64Url,
      "base64url",
    ).toString("utf8")) as {
      payload: {
        grantId: string;
        sessionId: string;
        sessionBindingHash: `sha256:${string}`;
      };
    } & Record<string, unknown>;
    const permit = {
      schemaVersion: "programmable.authorized-launch-permit-view.v2" as const,
      grantId: serviceArtifact.payload.grantId,
      sessionId: serviceArtifact.payload.sessionId,
      sessionBindingHash: serviceArtifact.payload.sessionBindingHash,
      permitId: serviceGoldenPermit.permitId as `sha256:${string}`,
      permitPayloadHash: serviceGoldenPermit.permitPayloadHash as `sha256:${string}`,
      signedPermitArtifactHash:
        serviceGoldenPermit.signedPermitArtifactHash as `sha256:${string}`,
      canonicalSignedPermitBase64Url:
        serviceGoldenPermit.canonicalSignedPermitBase64Url,
      state: "authorized" as const,
      validUntil: serviceGoldenPermit.validUntil,
    };
    const trustedSigner = serviceGoldenPermit.trustedSigner as TrustedLaunchPermitSignerV2;
    await expect(verifyAuthorizedLaunchPermitSignatureV2({
      permit,
      trustedSigners: [trustedSigner],
    })).resolves.toEqual(trustedSigner);

    const decoded = serviceArtifact as {
      payload: Record<string, unknown>;
    } & Record<string, unknown>;
    const extraPayloadField = structuredClone(decoded);
    extraPayloadField.payload.unknownAuthority = digest("f");
    await expect(verifyAuthorizedLaunchPermitSignatureV2({
      permit: replacePermitArtifact(permit, extraPayloadField),
      trustedSigners: [trustedSigner],
    })).rejects.toThrow("canonical");
    const substitutedPermitId = structuredClone(decoded);
    substitutedPermitId.payload.permitId = digest("f");
    await expect(verifyAuthorizedLaunchPermitSignatureV2({
      permit: replacePermitArtifact(permit, substitutedPermitId),
      trustedSigners: [trustedSigner],
    })).rejects.toThrow("payload is invalid");
    const tooDeep = structuredClone(decoded);
    let nested: Record<string, unknown> = {};
    tooDeep.payload.unknownDepth = nested;
    for (let depth = 0; depth < 70; depth += 1) {
      const next: Record<string, unknown> = {};
      nested.next = next;
      nested = next;
    }
    await expect(verifyAuthorizedLaunchPermitSignatureV2({
      permit: replacePermitArtifact(permit, tooDeep),
      trustedSigners: [trustedSigner],
    })).rejects.toThrow("deeply nested");
  });

  it("rejects forged signatures and permissive signed-permit envelopes", async () => {
    const fixture = actionPermitFixture(walletExecution().browserWalletAction);
    const decoded = JSON.parse(Buffer.from(
      fixture.permit.canonicalSignedPermitBase64Url,
      "base64url",
    ).toString("utf8")) as Record<string, unknown>;
    const forged = structuredClone(decoded) as {
      envelope: Record<string, unknown>;
    } & Record<string, unknown>;
    const forgedSignature = Buffer.from(String(forged.envelope.signature), "base64url");
    forgedSignature[0] = forgedSignature[0]! ^ 1;
    forged.envelope.signature = forgedSignature.toString("base64url");
    forged.envelope.signatureHash = fileSha256V2(forgedSignature);
    await expect(verifyAuthorizedLaunchPermitSignatureV2({
      permit: replacePermitArtifact(fixture.permit, forged),
      trustedSigners: [primaryPermitSigner.trustedSigner],
    })).rejects.toThrow("signature is invalid");

    for (const envelope of [
      {},
      { ...(decoded.envelope as Record<string, unknown>), unknown: "field" },
    ]) {
      await expect(verifyAuthorizedLaunchPermitSignatureV2({
        permit: replacePermitArtifact(fixture.permit, { ...decoded, envelope }),
        trustedSigners: [primaryPermitSigner.trustedSigner],
      })).rejects.toThrow("canonical");
    }
    await expect(verifyAuthorizedLaunchPermitSignatureV2({
      permit: replacePermitArtifact(fixture.permit, { ...decoded, unknown: "field" }),
      trustedSigners: [primaryPermitSigner.trustedSigner],
    })).rejects.toThrow("canonical");
  });

  it("requires fresh signed permits and preparations against trusted server time", () => {
    const action = walletExecution().browserWalletAction;
    const fresh = actionPermitFixture(action, {
      issuedAt: "2026-08-05T12:00:00.000Z",
      validUntil: "2026-08-05T12:10:00.000Z",
    });
    const execution = walletExecution({}, {
      expiresAt: "2026-08-05T12:10:00.000Z",
    });
    expect(() => assertLaunchPermitFreshnessV2({
      permit: fresh.permit,
      execution,
      trustedNow: "2026-08-05T12:05:00.000Z",
    })).not.toThrow();
    expect(() => assertLaunchPermitFreshnessV2({
      permit: fresh.permit,
      execution,
      trustedNow: "2026-08-05T11:59:59.999Z",
    })).toThrow("expired");
    expect(() => assertLaunchPermitFreshnessV2({
      permit: fresh.permit,
      execution,
      trustedNow: "2026-08-05T12:09:55.001Z",
    })).toThrow("expired");
    expect(() => assertLaunchPermitFreshnessV2({
      permit: fresh.permit,
      execution: { ...execution, expiresAt: "2026-08-05T12:05:04.999Z" },
      trustedNow: "2026-08-05T12:05:00.000Z",
    })).toThrow("expired");
  });

  it("accepts only an exact no-store trusted-time response", async () => {
    const now = "2026-08-05T12:05:00.000Z";
    const good = vi.fn(async () => Response.json({
      schemaVersion: "programmable.trusted-time.v1",
      now,
    }, { headers: { "cache-control": "no-store, max-age=0" } })) as typeof fetch;
    await expect(fetchTrustedTimeV1(primaryPermitSigner.trustedSigner, good)).resolves.toBe(now);
    const expectedQuery = new URLSearchParams({
      keyId: primaryPermitSigner.trustedSigner.keyId,
      signerEpoch: primaryPermitSigner.trustedSigner.signerEpoch,
      signerComponentBindingHash:
        primaryPermitSigner.trustedSigner.signerComponentBindingHash,
      publicKeySpkiSha256: primaryPermitSigner.trustedSigner.publicKeySpkiSha256,
    });
    expect(good).toHaveBeenCalledWith(
      `/api/custom-launch/trusted-time?${expectedQuery.toString()}`,
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
      }),
    );

    for (const response of [
      Response.json({ schemaVersion: "programmable.trusted-time.v1", now }),
      Response.json({ schemaVersion: "programmable.trusted-time.v1", now, extra: true }, {
        headers: { "cache-control": "no-store" },
      }),
      Response.json({ schemaVersion: "programmable.trusted-time.v0", now }, {
        headers: { "cache-control": "no-store" },
      }),
      Response.json({ schemaVersion: "programmable.trusted-time.v1", now: "not-time" }, {
        headers: { "cache-control": "no-store" },
      }),
      new Response("not-json", {
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain",
        },
      }),
    ]) {
      const fetcher = vi.fn(async () => response) as typeof fetch;
      await expect(fetchTrustedTimeV1(primaryPermitSigner.trustedSigner, fetcher)).rejects.toThrow(
        "Trusted launch time is unavailable",
      );
    }
  });

  it("rejects finality or progress returned for a different application or grant", () => {
    const status = {
      schemaVersion: "programmable.launch-execution-status-view.v3" as const,
      applicationId: "application-1",
      applicationHandle: APPLICATION_HANDLE,
      grantId: "123e4567-e89b-42d3-a456-426614174002",
      grantBindingHash: digest("1"),
      state: "not_started" as const,
    };
    const expected = {
      applicationHandle: APPLICATION_HANDLE,
      applicationId: "application-1",
      grantId: "123e4567-e89b-42d3-a456-426614174002",
      grantBindingHash: digest("1"),
      permitId: digest("2"),
      executionReservationId: "123e4567-e89b-42d3-a456-426614174003",
      chainId: "1",
      launchRouteId: "canonical-create2-graph-v1",
      launchTransactionId: `0x${"4".repeat(64)}`,
    };
    expect(() => assertLaunchExecutionStatusBinding(status, expected)).not.toThrow();
    let mismatch: unknown;
    try {
      assertLaunchExecutionStatusBinding({
        ...status,
        applicationId: "application-2",
      }, expected);
    } catch (caught) {
      mismatch = caught;
    }
    expect(mismatch).toBeInstanceOf(Error);
    expect(shouldClearLaunchRecoveryV2(mismatch)).toBe(false);
    expect(() => assertLaunchExecutionStatusBinding({
      ...status,
      grantBindingHash: digest("9"),
    }, expected)).toThrow("different approved identity");
    expect(() => assertLaunchExecutionStatusBinding({
      ...status,
      applicationHandle: `github-${"b".repeat(64)}`,
    }, expected)).toThrow("different approved identity");
    expect(() => assertLaunchExecutionStatusBinding({
      ...status,
      state: "submission_pending",
      permitId: digest("2"),
      executionReservationId: "123e4567-e89b-42d3-a456-426614174099",
      reasonCode: "BROWSER_WALLET_ACTION_READY",
    }, expected)).toThrow("different approved identity");
    const finalized = {
      ...status,
      state: "finalized" as const,
      permitId: digest("2"),
      executionReservationId: expected.executionReservationId,
      executionSubmissionHash: digest("3"),
      launchTransactionId: expected.launchTransactionId,
      finalizedLaunchExecutionHash: digest("4"),
      finalizedLaunchFactHash: digest("5"),
      chainId: expected.chainId,
      chainProfileId: "ethereum-mainnet-v1",
      launchRouteId: expected.launchRouteId,
      launchIdentityNamespace: "eip155:1:erc20",
      launchIdentityValue: `0x${"6".repeat(40)}`,
      launchedAt: "2026-08-05T12:00:00.000Z",
      finalizedAt: "2026-08-05T12:01:00.000Z",
    };
    expect(() => assertLaunchExecutionStatusBinding(finalized, expected)).not.toThrow();
    expect(() => assertLaunchExecutionStatusBinding({
      ...finalized,
      permitId: digest("8"),
    }, expected)).toThrow("different approved identity");
    expect(() => assertLaunchExecutionStatusBinding({
      ...finalized,
      chainId: "8453",
    }, expected)).toThrow("different approved identity");
    expect(() => assertLaunchExecutionStatusBinding({
      ...finalized,
      launchTransactionId: `0x${"7".repeat(64)}`,
    }, expected)).toThrow("different approved identity");
    expect(shouldClearLaunchRecoveryV2(
      new LaunchExecutionUnavailableError("authoritatively unavailable"),
    )).toBe(true);
  });

  it("enforces the backend UTF-8 byte limit for approved configuration", () => {
    const current = descriptor();
    const byteBound: LaunchDescriptorV2 = {
      ...current,
      configurationSchema: {
        ...current.configurationSchema,
        fields: [{
          fieldId: "name",
          label: "Name",
          kind: "text",
          required: true,
          maxLength: 4,
        }],
      },
    };
    expect(validateLaunchConfigurationV2(byteBound, { name: "test" })).toBe("");
    expect(validateLaunchConfigurationV2(byteBound, { name: "ééé" })).toBe(
      "Shorten name to 4 bytes or fewer",
    );
  });

  it("renders arbitrary approved field IDs with controls derived from their kinds", () => {
    expect(configurationControlForKind("text")).toBe("text");
    expect(configurationControlForKind("long-text")).toBe("textarea");
    expect(configurationControlForKind("url")).toBe("url");
    expect(configurationControlForKind("image-url")).toBe("url");
  });

  it("accepts approved launch plans without a universal ticker field", () => {
    const current = descriptor();
    const noConfiguration: LaunchDescriptorV2 = {
      ...current,
      configurationSchema: {
        ...current.configurationSchema,
        fields: [],
      },
    };
    const gameConfiguration: LaunchDescriptorV2 = {
      ...current,
      configurationSchema: {
        ...current.configurationSchema,
        fields: [{
          fieldId: "gameMode",
          label: "Game mode",
          kind: "text",
          required: true,
          maxLength: 64,
        }],
      },
    };
    expect(validateLaunchConfigurationV2(noConfiguration, {})).toBe("");
    expect(validateLaunchConfigurationV2(gameConfiguration, { gameMode: "Arena" })).toBe("");
    expect(buildCustomLaunchSelection({
      descriptor: noConfiguration,
      wallet: `0x${"1".repeat(40)}`,
      configuration: {},
    })).not.toHaveProperty("launchConfiguration");
  });

  it("has a truthful action for every backend application state", () => {
    const states = [
      "received",
      "in_review",
      "changes_required",
      "platform_pending",
      "ready_for_registration",
      "approved",
      "stale",
      "rejected",
      "superseded",
      "expired",
      "revoked",
      "launching",
      "launched",
    ] as const;

    expect(states.map((state) => customApplicationDisplayState(state))).toHaveLength(13);
    expect(customApplicationDisplayState("approved")).toMatchObject({
      title: "Approval recorded",
      tone: "pending",
    });
    expect(customApplicationDisplayState("changes_required")).toMatchObject({
      title: "Changes needed",
      action: "Open requested changes",
      tone: "warning",
    });
    expect(customApplicationDisplayState("received")).toEqual({
      title: "Submission received",
      action: "View on GitHub",
      tone: "pending",
    });
    expect(customApplicationDisplayState("in_review")).toEqual({
      title: "Review in progress",
      action: "View review",
      tone: "pending",
    });
    expect(customApplicationDisplayState("platform_pending")).toEqual({
      title: "Verification still running",
      action: "View on GitHub",
      tone: "pending",
    });
    expect(customApplicationDisplayState("revoked")).toEqual({
      title: "Approval revoked",
      action: "View reason",
      tone: "warning",
    });
    expect(customApplicationDisplayState("ready_for_registration")).toEqual({
      title: "Ready to launch",
      action: "Set up launch",
      tone: "ready",
    });
    expect(states.filter(customApplicationOpensLaunchExperience)).toEqual([
      "ready_for_registration",
      "launching",
      "launched",
    ]);
    expect(customApplicationOpensLaunchExperienceV2({
      ...application(),
      intakeContract: "registry-v3",
      providerId: "programmable-registry",
      controlRepositoryId: "1320171831",
      controlRepositoryOwnerId: "309941960",
      grandfatheredAtReleaseBindingDigest: null,
    })).toBe(false);
    expect(customApplicationOpensLaunchExperienceV2({
      ...application(),
      receiptDigest: null,
      launchEntitlementBindingHash: null,
    })).toBe(false);
    expect(customApplicationDisplayStateV2({
      ...application(),
      receiptDigest: null,
      launchEntitlementBindingHash: null,
    })).toEqual({
      title: "Launch authority pending",
      action: "View on GitHub",
      tone: "pending",
    });
  });

  it("summarizes exact-revision states without treating pending as unsafe", () => {
    const applications = [
      { ...application(), state: "ready_for_registration" as const },
      {
        ...application(),
        applicationId: "application-1b",
        applicationHandle: `github-${"b".repeat(64)}` as const,
        revisionId: "revision-1b",
        state: "ready_for_registration" as const,
      },
      { ...application(), applicationId: "application-2", state: "changes_required" as const },
      { ...application(), applicationId: "application-3", state: "in_review" as const },
      { ...application(), applicationId: "application-4", state: "approved" as const, receiptDigest: null, launchEntitlementBindingHash: null },
      { ...application(), applicationId: "application-5", state: "stale" as const },
      { ...application(), applicationId: "application-6", state: "launching" as const },
      { ...application(), applicationId: "application-7", state: "launched" as const },
      { ...application(), applicationId: "application-8", state: "revoked" as const },
      {
        ...application(),
        applicationId: "application-9",
        state: "ready_for_registration" as const,
        receiptDigest: null,
        launchEntitlementBindingHash: null,
      },
    ];

    expect(customApplicationSummaryCounts(applications)).toEqual({
      readyToLaunch: 2,
      changesRequested: 1,
      analysisPending: 3,
      changedSinceReview: 1,
      launchPending: 1,
      alreadyLaunched: 1,
      unavailable: 1,
    });
  });

  it("renders route-specific standard, AEON, and no-market fee summaries", () => {
    const standard = descriptor().routes[0]!.feePolicy;
    expect(customLaunchFeeReviewV1(standard)).toEqual({
      summary: "10 bps Programmable, added on top",
      identity: "programmable · custom-contract-graph / standard-custom · v1.0.0",
      marketPath: "official-market-path-v1",
      recipients: [{
        label: "Programmable",
        value: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
      }],
    });

    const aeon = {
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
    } as const;
    expect(customLaunchFeeReviewV1(aeon)).toMatchObject({
      summary: "20 bps total: 15 bps AEON and 5 bps Programmable, with no additional 10 bps",
      identity: "aeon · aeon-agent-launch / aeon-approved-model · v1.2.3",
      marketPath: "aeon-hook-market-v1",
      recipients: [
        { label: "AEON", value: APPROVED_PLAN_PROVIDER_RECIPIENT_FIXTURE },
        {
          label: "Programmable",
          value: "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c",
        },
      ],
    });

    expect(customLaunchFeeReviewV1({
      ...aeon,
      feeMode: "no-qualifying-market",
      marketPathId: null,
      totalRatePpm: 0,
      totalRateBps: 0,
      chargeMode: "none",
      normalProgrammableTenBpsApplied: false,
      legs: [],
    })).toMatchObject({
      summary: "0 bps because this approved plan has no qualifying market path",
      marketPath: "No qualifying market path",
      recipients: [],
    });
  });

  it("turns malformed or non-HTTPS project links into a recoverable form error", () => {
    const base = {
      description: "Wild game",
      documentation: "",
      x: "",
      telegram: "",
      discord: "",
      github: "",
      other: "",
      preservedLinks: [],
      image: null,
      imagePreview: "",
    } as const;

    expect(buildPresentationDraftFromForm({
      ...base,
      website: "not a URL",
    })).toEqual({ error: "Invalid URL" });
    expect(buildPresentationDraftFromForm({
      ...base,
      website: "http://project.example",
    })).toEqual({ error: "Use complete HTTPS links without credentials" });
    expect(buildPresentationDraftFromForm({
      ...base,
      website: "https://project.example",
    })).toMatchObject({
      draft: {
        description: "Wild game",
        links: [{ kind: "website", uri: "https://project.example/" }],
      },
    });
  });

  it("preserves every signed presentation link kind and supports removing an image", () => {
    const response = {
      schemaVersion: "programmable.principal-launch-presentation-response.v2",
      applicationId: "application-1",
      applicationHandle: APPLICATION_HANDLE,
      grantId: "123e4567-e89b-42d3-a456-426614174002",
      grantBindingHash: digest("1"),
      version: 1,
      outcome: "current",
      presentationBindingHash: digest("2"),
      record: {
        schemaVersion: "programmable.launch-presentation-record.v1",
        applicationId: "application-1",
        grantId: "123e4567-e89b-42d3-a456-426614174002",
        grantBindingHash: digest("1"),
        approvedModelIdentity: {
          schemaVersion: "programmable.approved-launch-model-identity.v1",
          platformId: "programmable",
          category: "custom",
          launchFamily: "custom",
          modelId: "wild-game",
        },
        approvedModelIdentityHash: digest("3"),
        presentation: {
          schemaVersion: "programmable.launch-presentation-draft.v1",
          description: "Wild game",
          image: null,
          links: [
            { kind: "telegram", uri: "https://t.me/wild" },
            { kind: "discord", uri: "https://discord.gg/wild" },
            { kind: "github", uri: "https://github.com/builder/wild" },
            { kind: "other", uri: "https://wild.example/community" },
            { kind: "other", uri: "https://wild.example/game" },
          ],
        },
        provenance: {
          kind: "presentation-only",
          source: "current-grant-bound-builder-input",
          mutableFields: ["description", "image", "links"],
          protectedFields: [],
          statement: "Presentation cannot change code.",
        },
        presentationBindingHash: digest("2"),
      },
      committedAt: "2026-08-05T12:00:00.000Z",
    } as const;
    const form = presentationFormFromResponse(response);
    expect(form).toMatchObject({
      telegram: "https://t.me/wild",
      discord: "https://discord.gg/wild",
      github: "https://github.com/builder/wild",
      other: "https://wild.example/community",
      preservedLinks: [{ kind: "other", uri: "https://wild.example/game" }],
      image: null,
    });
    expect(buildPresentationDraftFromForm(form)).toMatchObject({
      draft: {
        image: null,
        links: expect.arrayContaining([
          { kind: "telegram", uri: "https://t.me/wild" },
          { kind: "discord", uri: "https://discord.gg/wild" },
          { kind: "github", uri: "https://github.com/builder/wild" },
          { kind: "other", uri: "https://wild.example/community" },
          { kind: "other", uri: "https://wild.example/game" },
        ]),
      },
    });
  });

  it("round-trips report recovery and retries the same transaction report idempotently", async () => {
    vi.useFakeTimers();
    const recovery = parsePersistedLaunchRecoveryV2(JSON.stringify({
      stage: "broadcast",
      applicationHandle: APPLICATION_HANDLE,
      githubPrincipalHash: GITHUB_PRINCIPAL_HASH,
      grantId: "123e4567-e89b-42d3-a456-426614174002",
      grantBindingHash: digest("1"),
      sessionId: "123e4567-e89b-42d3-a456-426614174001",
      permitId: digest("2"),
      chainId: "1",
      executionReservationId: "123e4567-e89b-42d3-a456-426614174003",
      browserWalletActionHash: digest("6"),
      reportIdempotencyKey: "transaction-report-stable",
      expiresAt: "2099-08-05T12:05:00.000Z",
      transactionHash: `0x${"4".repeat(64)}`,
    }));
    expect(recovery).toMatchObject({
      stage: "broadcast",
      applicationHandle: APPLICATION_HANDLE,
      githubPrincipalHash: GITHUB_PRINCIPAL_HASH,
      permitId: digest("2"),
      chainId: "1",
      reportIdempotencyKey: "transaction-report-stable",
    });
    if (!recovery || recovery.stage !== "broadcast") {
      throw new Error("expected a persisted broadcast recovery");
    }
    const acknowledgement = {
      executionReservationId: recovery.executionReservationId,
      transactionHash: recovery.transactionHash,
    };
    const reportLaunchTransaction = vi.fn()
      .mockRejectedValueOnce(new CustomLaunchWebsiteRequestErrorV2(503, "temporary"))
      .mockResolvedValueOnce(acknowledgement);
    const pending = reportPersistedLaunchTransactionV2({ reportLaunchTransaction }, recovery);
    await vi.runAllTimersAsync();
    await pending;
    expect(reportLaunchTransaction).toHaveBeenCalledTimes(2);
    expect(reportLaunchTransaction.mock.calls[0]?.[0]).toEqual(reportLaunchTransaction.mock.calls[1]?.[0]);
    await expect(reportPersistedLaunchTransactionV2({
      reportLaunchTransaction: vi.fn().mockResolvedValue({
        ...acknowledgement,
        transactionHash: `0x${"5".repeat(64)}`,
      }),
    }, recovery)).rejects.toThrow("different transaction identity");
    vi.useRealTimers();
  });

  it("fails closed when durable recovery cannot be written or read back exactly", () => {
    const recovery = parsePersistedLaunchRecoveryV2(JSON.stringify({
      stage: "prepared",
      applicationHandle: APPLICATION_HANDLE,
      githubPrincipalHash: GITHUB_PRINCIPAL_HASH,
      grantId: "123e4567-e89b-42d3-a456-426614174002",
      grantBindingHash: digest("1"),
      sessionId: "123e4567-e89b-42d3-a456-426614174001",
      permitId: digest("2"),
      chainId: "1",
      executionReservationId: "123e4567-e89b-42d3-a456-426614174003",
      browserWalletActionHash: digest("6"),
      reportIdempotencyKey: "transaction-report-stable",
      expiresAt: "2099-08-05T12:05:00.000Z",
      reservedTransactionHash: `0x${"0".repeat(64)}`,
    }))!;
    expect(recovery.stage).toBe("prepared");
    expect(() => requirePersistLaunchRecoveryV2({
      setItem() { throw new Error("storage denied"); },
      getItem() { return null; },
    }, "launch-key", recovery)).toThrow("storage denied");
    expect(() => requirePersistLaunchRecoveryV2({
      setItem() {},
      getItem() { return "corrupt"; },
    }, "launch-key", recovery)).toThrow("could not be verified");
  });

  it("rejects legacy, substituted, or extended browser recovery identities", () => {
    const base = {
      stage: "prepared",
      applicationHandle: APPLICATION_HANDLE,
      githubPrincipalHash: GITHUB_PRINCIPAL_HASH,
      grantId: "123e4567-e89b-42d3-a456-426614174002",
      grantBindingHash: digest("1"),
      sessionId: "123e4567-e89b-42d3-a456-426614174001",
      permitId: digest("2"),
      chainId: "1",
      executionReservationId: "123e4567-e89b-42d3-a456-426614174003",
      browserWalletActionHash: digest("6"),
      reportIdempotencyKey: "transaction-report-stable",
      expiresAt: "2099-08-05T12:05:00.000Z",
      reservedTransactionHash: `0x${"0".repeat(64)}`,
    };
    expect(parsePersistedLaunchRecoveryV2(JSON.stringify(base))).not.toBeNull();
    expect(parsePersistedLaunchRecoveryV2(JSON.stringify({
      ...base,
      applicationHandle: "application-1",
    }))).toBeNull();
    expect(parsePersistedLaunchRecoveryV2(JSON.stringify({
      ...base,
      githubPrincipalHash: digest("e"),
      extraAuthority: true,
    }))).toBeNull();
    const recoveryWithoutPermit = { ...base } as Record<string, unknown>;
    delete recoveryWithoutPermit.permitId;
    expect(parsePersistedLaunchRecoveryV2(JSON.stringify(recoveryWithoutPermit))).toBeNull();
    const legacy = { ...base } as Record<string, unknown>;
    delete legacy.applicationHandle;
    delete legacy.githubPrincipalHash;
    expect(parsePersistedLaunchRecoveryV2(JSON.stringify(legacy))).toBeNull();
  });
});
