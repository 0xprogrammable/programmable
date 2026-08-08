"use client";

import Image from "next/image";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  CircleCheck,
  Clock3,
  ExternalLink,
  ImagePlus,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from "react";
import { formatEther, hexToBytes } from "viem";

import { GitHubBrandIcon } from "@/components/brand-icons";
import styles from "@/components/custom-launch-experience.module.css";
import launchExperience from "@/components/launch-experience.module.css";
import { useWallet } from "@/components/wallet-provider";
import {
  canonicalBrowserJsonV2,
  canonicalBrowserSha256V2,
  fileSha256V2,
} from "@/lib/custom-launch/browser-authority-v2";
import {
  createCustomLaunchWebsiteClientV2,
  CustomLaunchWebsiteRequestErrorV2,
} from "@/lib/custom-launch/client-v2";
import {
  assertFreshReissuedGrantV1,
  browserWalletGrantReissueIdentityV1,
  BrowserWalletGrantReissueBindingErrorV1,
  BrowserWalletGrantReissueCancelledV1,
  BrowserWalletGrantReissueSingleFlightV1,
  isLaunchPreparationReissueRequiredV1,
  pollBrowserWalletGrantReissueV1,
  type BrowserWalletGrantReissueIdentityV1,
} from "@/lib/custom-launch/grant-reissue-v1";
import {
  LaunchAuthorityRefreshBindingErrorV1,
  LaunchAuthorityRefreshCancelledErrorV1,
  LaunchAuthorityRefreshFailedErrorV1,
  LaunchAuthorityRefreshSingleFlightV1,
  launchAuthorityObservationMatchesSetupV1,
  launchAuthorityRefreshIdempotencyKeyV1,
  launchAuthorityRefreshRequiredV1,
  pollPrincipalLaunchAuthorityRefreshV1,
} from "@/lib/custom-launch/launch-authority-refresh-v1";
import { readAllPrincipalApplicationsV3 } from "@/lib/custom-launch/principal-application-pagination-v3";
import {
  customApplicationIntakeIsLaunchableV2,
  type ApplicationHandleV3,
  type AuthorizedLaunchPermitViewV2,
  type AuthorizeLaunchSessionRequestV2,
  type BrowserWalletActionV2,
  type BrowserWalletLaunchPreparationV2,
  type CustomLaunchApplicationStateV2,
  type CustomLaunchFeePolicyV1,
  type CustomLaunchWebsiteSessionV2,
  type LaunchDescriptorV2,
  type LaunchEligibilityViewV2,
  type LaunchExecutionStatusViewV2,
  type LaunchPresentationDraftV1,
  type PrincipalCustomLaunchApplicationSummaryV2,
  type PrincipalLaunchAuthorityRefreshViewV1,
  type PrincipalLaunchPresentationResponseV1,
  type TrustedLaunchPermitSignerV2,
  type UntrustedLaunchWalletSelectionV2,
} from "@/lib/custom-launch/contract-v2";
import {
  getTokenCardImageSource,
  isProgrammableTokenImageUrl,
  prepareTokenImage,
  TOKEN_IMAGE_OUTPUT_SIZE,
} from "@/lib/token-image";

const BUILDER_SKILL_URL =
  "https://github.com/0xprogrammable/programmable-v4-builder/tree/main/skills/programmable-v4-hook-builder";
const SUBMISSION_REQUIREMENTS_URL =
  "https://github.com/0xprogrammable/programmable-v4-builder/blob/main/docs/PUBLIC_GITHUB_PR_BETA.md";
export const CUSTOM_LAUNCH_PLATFORM_FEE_RECIPIENT =
  "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";
const STATUS_POLL_DELAY_MS = 3_000;
const STATUS_POLL_ATTEMPTS = 40;
const LAUNCH_PERMIT_AUTHORITY_KEYS_V2 = [
  "schemaVersion", "apiSchemaVersion", "grantId", "grantBindingHash",
  "authorizationOperation", "authorizationOperationBindingHash",
  "authorizationVerificationAuthorityHash", "authorizationRequestBodyHash",
  "authorizationSignedAssertionHash", "authorizationGitHubSessionBindingHash",
  "authorizationAuthenticatedAt", "authorizationExpiresAt", "githubUserId",
  "githubPrincipalHash", "challengeId", "challengeBindingHash", "sessionRecordId",
  "sessionId", "sessionBindingHash", "sessionNonce", "walletNonce",
  "serviceChallengeHash", "serviceSessionNonceHash", "serviceWalletNonceHash",
  "sessionExpiresAt", "publicSourceFreshnessObservationHash",
  "publicSourceFreshnessExpiresAt", "controllerAuthoritySetHash",
  "routeSelectionBindingHash", "routeSelectionAuthorityHash", "walletNamespace",
  "walletValue", "walletOwnershipBindingHash", "walletMessageHash",
  "walletOwnershipAssertionHash", "walletOwnershipVerificationAuthorityHash",
  "chainId", "chainProfileId", "chainProfileHash", "launchRouteId",
  "launchRouteBindingHash", "executionMode", "transactionValueWei",
  "templateBindingHash", "launchSpecificationHash", "preparationBindingHash",
  "launchArtifactCommitmentHash", "launchArtifactManifestHash",
  "launchArtifactOutputSetHash", "deploymentCalldataHash",
  "compilerAuthorityBindingHash", "create2RouteId", "routeNonce",
  "executionValidAfter", "executionValidUntil", "feeAssessmentHash", "feeObligationHash",
  "feeAssessmentObligationBindingHash", "grantControlGenerations",
  "grantControlGenerationsHash", "controlGenerationsHash",
  "permitIssuanceGeneration", "permitConsumptionGeneration", "permitRequestHash",
] as const;
const LAUNCH_PERMIT_RESERVATION_KEYS_V2 = [
  "schemaVersion", "permitReservationId", "authorityBundleHash",
  "executionRequestHash", "executionIdempotencyKeyHash", "nonce", "issuedAt",
  "validUntil", "signerKeyId", "signerEpoch", "signerComponentBindingHash",
  "finalityPolicy", "finalityPolicyHash",
] as const;
const LAUNCH_PERMIT_FINALITY_POLICY_KEYS_V2 = [
  "schemaVersion", "finalityRouteId", "finalityRouteBindingHash",
  "finalityVerificationAuthorityHash", "expectedTransactionSender",
  "expectedTransactionTarget", "launchIdentityNamespace", "launchIdentityLocator",
  "executionTraceRequirement", "dynamicTraceRequirementHash",
] as const;
const LAUNCH_PERMIT_TRACE_REQUIREMENT_KEYS_V2 = [
  "schemaVersion", "disposition", "executionGraphHash",
  "dynamicChildCapabilitySetHash", "staticAnalysisBindingHash",
  "traceAbsenceProofHash", "requirementReasonCodes", "requirementHash",
] as const;
const LAUNCH_PERMIT_GENERATION_KEYS_V2 = [
  "intakeAcceptance", "analysisDispatch", "decisionIssuance",
  "publicDecisionDisplay", "permitIssuance", "permitConsumption",
  "registryProjection", "websiteProjection",
] as const;
const LAUNCH_PERMIT_UNSIGNED_PAYLOAD_KEYS_V2 = [
  ...LAUNCH_PERMIT_AUTHORITY_KEYS_V2.filter((key) => key !== "schemaVersion"),
  "schemaVersion", "audience", "executionRequestHash",
  "executionIdempotencyKeyHash", "permitReservationId",
  "permitReservationBindingHash", "nonce", "issuedAt", "validUntil",
  "signerKeyId", "signerEpoch", "signerComponentBindingHash", "finalityPolicy",
  "finalityPolicyHash",
] as const;
const LAUNCH_PERMIT_LOCATOR_KEYS_V2 = [
  "schemaVersion", "kind", "logAddress", "topic0", "topicIndex",
  "dataWordIndex", "expectedLogIndex", "expectedEventHash",
] as const;

type CustomLaunchScreen = "intro" | "applications" | "setup";
type LaunchProgress =
  | "idle"
  | "preparing"
  | "wallet-proof"
  | "wallet-transaction"
  | "confirmation"
  | "publishing"
  | "complete";

type PreparedLaunchRecoveryV2 = Readonly<{
  stage: "prepared";
  applicationHandle: ApplicationHandleV3;
  githubPrincipalHash: `sha256:${string}`;
  grantId: string;
  grantBindingHash: `sha256:${string}`;
  sessionId: string;
  permitId: `sha256:${string}`;
  chainId: string;
  executionReservationId: string;
  browserWalletActionHash: `sha256:${string}`;
  reportIdempotencyKey: string;
  expiresAt: string;
  reservedTransactionHash: `0x${string}`;
}>;

type BroadcastLaunchRecoveryV2 = Readonly<{
  stage: "broadcast";
  applicationHandle: ApplicationHandleV3;
  githubPrincipalHash: `sha256:${string}`;
  grantId: string;
  grantBindingHash: `sha256:${string}`;
  sessionId: string;
  permitId: `sha256:${string}`;
  chainId: string;
  executionReservationId: string;
  browserWalletActionHash: `sha256:${string}`;
  reportIdempotencyKey: string;
  expiresAt: string;
  transactionHash: `0x${string}`;
}>;

export type PersistedLaunchRecoveryV2 =
  | PreparedLaunchRecoveryV2
  | BroadcastLaunchRecoveryV2;

type LaunchRecoveryReadV2 =
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "unreadable" }>
  | Readonly<{ kind: "valid"; recovery: PersistedLaunchRecoveryV2 }>;

type PendingGrantReissueV1 = Readonly<{
  oldDescriptor: LaunchDescriptorV2;
  idempotencyKey: string;
  expectedIdentity?: BrowserWalletGrantReissueIdentityV1;
}>;

class LaunchFlowCancelledError extends Error {}
export class LaunchExecutionUnavailableError extends Error {}
export class LaunchBindingMismatchError extends Error {}

export function shouldClearLaunchRecoveryV2(caught: unknown): boolean {
  return caught instanceof LaunchExecutionUnavailableError;
}

export type PresentationForm = {
  description: string;
  website: string;
  documentation: string;
  x: string;
  telegram: string;
  discord: string;
  github: string;
  other: string;
  preservedLinks: LaunchPresentationDraftV1["links"];
  image: LaunchPresentationDraftV1["image"];
  imagePreview: string;
};

const emptyPresentation: PresentationForm = {
  description: "",
  website: "",
  documentation: "",
  x: "",
  telegram: "",
  discord: "",
  github: "",
  other: "",
  preservedLinks: [],
  image: null,
  imagePreview: "",
};

export type CustomApplicationDisplayState = Readonly<{
  title: string;
  action: string;
  tone: "pending" | "warning" | "ready" | "complete" | "muted";
}>;

export type CustomApplicationSummaryCounts = Readonly<{
  readyToLaunch: number;
  changesRequested: number;
  analysisPending: number;
  changedSinceReview: number;
  launchPending: number;
  alreadyLaunched: number;
  unavailable: number;
}>;

export function customApplicationSummaryCounts(
  applications: readonly PrincipalCustomLaunchApplicationSummaryV2[],
): CustomApplicationSummaryCounts {
  const counts = {
    readyToLaunch: 0,
    changesRequested: 0,
    analysisPending: 0,
    changedSinceReview: 0,
    launchPending: 0,
    alreadyLaunched: 0,
    unavailable: 0,
  };
  for (const application of applications) {
    if (
      application.state === "ready_for_registration"
      && customApplicationOpensLaunchExperienceV2(application)
    ) {
      counts.readyToLaunch += 1;
    } else if (application.state === "changes_required") {
      counts.changesRequested += 1;
    } else if (
      application.state === "received"
      || application.state === "in_review"
      || application.state === "platform_pending"
      || application.state === "approved"
      || application.state === "ready_for_registration"
    ) {
      counts.analysisPending += 1;
    } else if (
      application.state === "stale"
      || application.state === "superseded"
    ) {
      counts.changedSinceReview += 1;
    } else if (application.state === "launching") {
      counts.launchPending += 1;
    } else if (application.state === "launched") {
      counts.alreadyLaunched += 1;
    } else {
      counts.unavailable += 1;
    }
  }
  return Object.freeze(counts);
}

export function customApplicationDisplayState(
  state: CustomLaunchApplicationStateV2,
): CustomApplicationDisplayState {
  const values: Record<CustomLaunchApplicationStateV2, CustomApplicationDisplayState> = {
    received: { title: "Submission received", action: "View on GitHub", tone: "pending" },
    in_review: { title: "Review in progress", action: "View review", tone: "pending" },
    changes_required: { title: "Changes needed", action: "Open requested changes", tone: "warning" },
    platform_pending: { title: "Verification still running", action: "View on GitHub", tone: "pending" },
    ready_for_registration: { title: "Ready to launch", action: "Set up launch", tone: "ready" },
    approved: { title: "Approval recorded", action: "View on GitHub", tone: "pending" },
    stale: { title: "Source changed", action: "View current source", tone: "warning" },
    rejected: { title: "Not approved", action: "View decision", tone: "warning" },
    superseded: { title: "New version submitted", action: "View current version", tone: "muted" },
    expired: { title: "Approval expired", action: "View on GitHub", tone: "warning" },
    revoked: { title: "Approval revoked", action: "View reason", tone: "warning" },
    launching: { title: "Launch submitted", action: "View launch status", tone: "pending" },
    launched: { title: "Launch complete", action: "View launch status", tone: "complete" },
  };
  return values[state];
}

export function customApplicationOpensLaunchExperience(
  state: CustomLaunchApplicationStateV2,
): boolean {
  return state === "ready_for_registration"
    || state === "launching"
    || state === "launched";
}

export function customApplicationOpensLaunchExperienceV2(
  application: PrincipalCustomLaunchApplicationSummaryV2,
): boolean {
  return customApplicationIntakeIsLaunchableV2(application)
    && customApplicationOpensLaunchExperience(application.state)
    && application.receiptDigest !== null
    && application.launchEntitlementBindingHash !== null;
}

export function customApplicationDisplayStateV2(
  application: PrincipalCustomLaunchApplicationSummaryV2,
): CustomApplicationDisplayState {
  if (application.intakeContract === "registry-v3") {
    return { title: "Catalog entry", action: "View on GitHub", tone: "muted" };
  }
  if (
    application.state === "ready_for_registration"
    && !customApplicationOpensLaunchExperienceV2(application)
  ) {
    return { title: "Launch authority pending", action: "View on GitHub", tone: "pending" };
  }
  return customApplicationDisplayState(application.state);
}

export type CustomLaunchFeeReviewV1 = Readonly<{
  summary: string;
  identity: string;
  marketPath: string;
  recipients: readonly Readonly<{ label: string; value: string }>[];
}>;

export function customLaunchFeeReviewV1(
  policy: CustomLaunchFeePolicyV1,
): CustomLaunchFeeReviewV1 {
  const identity = `${policy.providerId} · ${policy.modelId} / ${policy.templateId} · v${policy.semanticVersion}`;
  if (policy.feeMode === "no-qualifying-market") {
    return Object.freeze({
      summary: "0 bps because this approved plan has no qualifying market path",
      identity,
      marketPath: "No qualifying market path",
      recipients: Object.freeze([]),
    });
  }
  const recipients = Object.freeze(policy.legs.map(({ recipient, role }) => Object.freeze({
    label: role === "programmable" ? "Programmable" : policy.providerId === "aeon" ? "AEON" : policy.providerId,
    value: recipient.value,
  })));
  if (policy.feeMode === "aeon-partner-custom") {
    return Object.freeze({
      summary: "20 bps total: 15 bps AEON and 5 bps Programmable, with no additional 10 bps",
      identity,
      marketPath: policy.marketPathId,
      recipients,
    });
  }
  return Object.freeze({
    summary: "10 bps Programmable, added on top",
    identity,
    marketPath: policy.marketPathId,
    recipients,
  });
}

export function buildCustomLaunchSelection(input: Readonly<{
  descriptor: LaunchDescriptorV2;
  wallet: `0x${string}`;
  configuration: Readonly<Record<string, string>>;
  presentationBindingHash?: `sha256:${string}`;
}>): UntrustedLaunchWalletSelectionV2 {
  const route = defaultLaunchRoute(input.descriptor);
  const configuredValues = input.descriptor.configurationSchema.fields
    .map(({ fieldId }) => ({
      fieldId,
      value: (input.configuration[fieldId] ?? "").normalize("NFC"),
    }))
    .sort((left, right) =>
      left.fieldId < right.fieldId ? -1 : left.fieldId > right.fieldId ? 1 : 0,
    );
  return {
    schemaVersion: "programmable.untrusted-launch-wallet-selection.v2",
    launcherWallet: {
      namespace: `eip155:${route.chainId}`,
      value: input.wallet.toLowerCase(),
    },
    chainProfileId: route.chainProfileId,
    requestedExecutionMode: route.executionMode,
    requestedRouteAdapterId: route.routeAdapterId,
    transactionValueWei: route.transactionValuePolicy.valueWei,
    ...(input.presentationBindingHash
      ? { presentationBindingHash: input.presentationBindingHash }
      : {}),
    ...(configuredValues.length > 0
      ? {
          launchConfiguration: {
            schemaVersion: "programmable.launch-configuration.v2" as const,
            schemaHash: input.descriptor.configurationSchema.schemaHash,
            values: configuredValues,
          },
        }
      : {}),
  };
}

export function defaultLaunchRoute(descriptor: LaunchDescriptorV2) {
  const route = descriptor.routes.find(
    ({ choiceId }) => choiceId === descriptor.defaultChoiceId,
  );
  if (!route) throw new Error("The approved launch route is unavailable");
  return route;
}

export function assertLaunchSetupBindings(input: Readonly<{
  application: PrincipalCustomLaunchApplicationSummaryV2;
  eligibility: LaunchEligibilityViewV2;
  descriptor: LaunchDescriptorV2;
  presentation: PrincipalLaunchPresentationResponseV1 | null;
}>): void {
  const { application, descriptor, eligibility, presentation } = input;
  if (
    !customApplicationIntakeIsLaunchableV2(application)
    || application.state !== "ready_for_registration"
    || application.receiptDigest === null
    || application.launchEntitlementBindingHash === null
    || eligibility.applicationId !== application.applicationId
    || eligibility.applicationHandle !== application.applicationHandle
    || eligibility.grantId !== descriptor.grantId
    || eligibility.grantBindingHash !== descriptor.grantBindingHash
    || eligibility.grantBindingHash !== application.launchEntitlementBindingHash
    || descriptor.applicationId !== application.applicationId
    || descriptor.applicationHandle !== application.applicationHandle
    || eligibility.receiptDigest !== application.receiptDigest
  ) throw new Error("Approved launch response binding mismatch");
  if (presentation === null) return;
  assertLaunchPresentationBinding(
    application.applicationId,
    application.applicationHandle,
    descriptor,
    presentation,
  );
}

export function assertSamePrincipalApplicationRevisionV1(
  expected: PrincipalCustomLaunchApplicationSummaryV2,
  observed: PrincipalCustomLaunchApplicationSummaryV2,
): void {
  if (
    observed.applicationId !== expected.applicationId
    || observed.applicationHandle !== expected.applicationHandle
    || observed.revisionId !== expected.revisionId
    || observed.repositoryId !== expected.repositoryId
    || observed.repositoryOwnerId !== expected.repositoryOwnerId
    || observed.repositoryFullName !== expected.repositoryFullName
    || observed.pullRequestNumber !== expected.pullRequestNumber
    || observed.commitOid !== expected.commitOid
    || observed.treeOid !== expected.treeOid
    || observed.intakeContract !== expected.intakeContract
    || observed.providerId !== expected.providerId
    || observed.controlRepositoryId !== expected.controlRepositoryId
    || observed.controlRepositoryOwnerId !== expected.controlRepositoryOwnerId
    || observed.grandfatheredAtReleaseBindingDigest
      !== expected.grandfatheredAtReleaseBindingDigest
    || observed.receiptDigest !== expected.receiptDigest
    || observed.launchEntitlementBindingHash !== expected.launchEntitlementBindingHash
  ) throw new LaunchAuthorityRefreshBindingErrorV1(
    "Launch verification returned a different GitHub revision and was stopped",
  );
}

export function assertLaunchPresentationBinding(
  applicationId: string,
  applicationHandle: ApplicationHandleV3,
  descriptor: LaunchDescriptorV2,
  presentation: PrincipalLaunchPresentationResponseV1,
): void {
  if (
    presentation.applicationId !== applicationId
    || presentation.applicationHandle !== applicationHandle
    || descriptor.applicationHandle !== applicationHandle
    || presentation.grantId !== descriptor.grantId
    || presentation.grantBindingHash !== descriptor.grantBindingHash
    || presentation.record.applicationId !== applicationId
    || presentation.record.grantId !== descriptor.grantId
    || presentation.record.grantBindingHash !== descriptor.grantBindingHash
    || presentation.record.presentationBindingHash
      !== presentation.presentationBindingHash
  ) throw new Error("Approved launch presentation binding mismatch");
}

export function assertBrowserWalletExecutionBinding(input: Readonly<{
  descriptor: LaunchDescriptorV2;
  execution: BrowserWalletLaunchPreparationV2;
  deploymentCalldataHash: `sha256:${string}`;
  permit: AuthorizedLaunchPermitViewV2;
  permitRequestHash: `sha256:${string}`;
  selection: UntrustedLaunchWalletSelectionV2;
  wallet: `0x${string}`;
  now?: number;
}>): BrowserWalletActionV2 {
  const {
    deploymentCalldataHash,
    descriptor,
    execution,
    permit,
    permitRequestHash,
    selection,
    wallet,
  } = input;
  const route = defaultLaunchRoute(descriptor);
  const action = execution?.browserWalletAction;
  const transaction = Array.isArray(action?.params) ? action.params[0] : undefined;
  const digest = /^sha256:[0-9a-f]{64}$/u;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  const expiresAt = Date.parse(execution?.expiresAt ?? "");
  const actionNotBefore = Date.parse(execution?.actionNotBefore ?? "");
  if (
    execution?.schemaVersion !== "programmable.browser-wallet-launch-preparation.v2"
    || execution.transport !== "browser-wallet-self-submit"
    || execution.walletExecutionKind !== "eoa-direct"
    || execution.grantId !== descriptor.grantId
    || execution.chainId !== route.chainId
    || !uuid.test(execution.executionReservationId)
    || !digest.test(execution.browserWalletActionHash)
    || !digest.test(execution.senderBindingPolicyHash)
    || !digest.test(execution.authorityBindingHash)
    || !Number.isFinite(expiresAt)
    || !Number.isFinite(actionNotBefore)
    || actionNotBefore >= expiresAt
    || (input.now !== undefined && actionNotBefore > input.now)
    || (input.now !== undefined && expiresAt <= input.now)
    || selection.launcherWallet.namespace !== `eip155:${route.chainId}`
    || selection.launcherWallet.value.toLowerCase() !== wallet.toLowerCase()
    || selection.chainProfileId !== route.chainProfileId
    || selection.requestedExecutionMode !== route.executionMode
    || selection.requestedRouteAdapterId !== route.routeAdapterId
    || selection.transactionValueWei !== route.transactionValuePolicy.valueWei
    || action?.schemaVersion !== "programmable.browser-wallet-action.v2"
    || action.walletExecutionKind !== "eoa-direct"
    || action.method !== "eth_sendTransaction"
    || action.chainId !== route.chainId
    || !Array.isArray(action.params)
    || action.params.length !== 1
    || transaction === undefined
    || !/^0x[0-9a-f]{40}$/u.test(transaction.from)
    || transaction.from.toLowerCase() !== wallet.toLowerCase()
    || !/^0x[0-9a-f]{40}$/u.test(transaction.to)
    || !/^0x(?:[0-9a-f]{2})+$/u.test(transaction.data)
    || fileSha256V2(hexToBytes(transaction.data)) !== deploymentCalldataHash
    || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/u.test(transaction.value)
    || BigInt(transaction.value) !== BigInt(route.transactionValuePolicy.valueWei)
    || canonicalBrowserSha256V2(
      "programmable.browser-wallet-action.v2",
      action,
    ) !== execution.browserWalletActionHash
  ) throw new Error("Wallet transaction does not match the exact approved launch");
  assertActionPermitBindingV2({
    action,
    binding: execution.actionPermitBinding,
    deploymentCalldataHash,
    actionNotBefore: execution.actionNotBefore,
    expiresAt: execution.expiresAt,
    permit,
    permitRequestHash,
  });
  return action;
}

export async function verifyAuthorizedLaunchPermitSignatureV2(input: Readonly<{
  permit: AuthorizedLaunchPermitViewV2;
  trustedSigners: readonly TrustedLaunchPermitSignerV2[];
}>): Promise<TrustedLaunchPermitSignerV2> {
  const artifact = parseCanonicalSignedPermitV2(
    input.permit.canonicalSignedPermitBase64Url,
  );
  const payload = artifact.payload;
  const envelope = artifact.envelope;
  const digest = /^sha256:[0-9a-f]{64}$/u;
  exactObjectKeys(envelope, [
    "audience",
    "domain",
    "envelopeHash",
    "keyId",
    "payloadHash",
    "permitId",
    "schemaVersion",
    "signature",
    "signatureHash",
    "signatureScheme",
    "signerComponentBindingHash",
    "signerEpoch",
  ]);
  const signingEnvelope = {
    schemaVersion: envelope.schemaVersion,
    domain: envelope.domain,
    audience: envelope.audience,
    permitId: envelope.permitId,
    payloadHash: envelope.payloadHash,
    keyId: envelope.keyId,
    signerEpoch: envelope.signerEpoch,
    signerComponentBindingHash: envelope.signerComponentBindingHash,
    envelopeHash: envelope.envelopeHash,
  };
  const envelopePreimage = {
    schemaVersion: envelope.schemaVersion,
    domain: envelope.domain,
    audience: envelope.audience,
    permitId: envelope.permitId,
    payloadHash: envelope.payloadHash,
    keyId: envelope.keyId,
    signerEpoch: envelope.signerEpoch,
    signerComponentBindingHash: envelope.signerComponentBindingHash,
  };
  const signature = decodeCanonicalBase64Url(
    envelope.signature,
    64,
    "permit signature",
  );
  const signer = input.trustedSigners.find((candidate) =>
    candidate.keyId === envelope.keyId
    && candidate.signerEpoch === envelope.signerEpoch
    && candidate.signerComponentBindingHash
      === envelope.signerComponentBindingHash);
  if (
    input.permit.schemaVersion !== "programmable.authorized-launch-permit-view.v2"
    || input.permit.state !== "authorized"
    || !digest.test(input.permit.permitId)
    || !digest.test(input.permit.permitPayloadHash)
    || !digest.test(input.permit.signedPermitArtifactHash)
    || envelope.schemaVersion !== "programmable.launch-permit-envelope.v2"
    || envelope.domain !== "programmable.launch-permit-envelope.v2"
    || envelope.audience !== "programmable.launch-execution.v2"
    || envelope.signatureScheme !== "ed25519"
    || envelope.permitId !== payload.permitId
    || envelope.permitId !== input.permit.permitId
    || envelope.payloadHash !== input.permit.permitPayloadHash
    || envelope.payloadHash !== canonicalBrowserSha256V2(
      "programmable.launch-permit-payload.v2",
      payload,
    )
    || envelope.keyId !== payload.signerKeyId
    || envelope.signerEpoch !== payload.signerEpoch
    || envelope.signerComponentBindingHash
      !== payload.signerComponentBindingHash
    || envelope.signatureHash !== fileSha256V2(signature)
    || envelope.envelopeHash !== canonicalBrowserSha256V2(
      "programmable.launch-permit-envelope.v2",
      envelopePreimage,
    )
    || canonicalBrowserSha256V2(
      "programmable.signed-launch-permit.v2",
      artifact,
    ) !== input.permit.signedPermitArtifactHash
    || input.permit.grantId !== payload.grantId
    || input.permit.sessionId !== payload.sessionId
    || input.permit.sessionBindingHash !== payload.sessionBindingHash
    || input.permit.validUntil !== payload.validUntil
    || signer === undefined
  ) throw new Error("Launch permit signature authority is invalid");

  const publicKey = decodeCanonicalBase64Url(
    signer.publicKeyBase64Url,
    32,
    "permit signer public key",
  );
  const spkiPrefix = Uint8Array.from([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
    0x70, 0x03, 0x21, 0x00,
  ]);
  const spki = new Uint8Array(spkiPrefix.length + publicKey.length);
  spki.set(spkiPrefix);
  spki.set(publicKey, spkiPrefix.length);
  if (fileSha256V2(spki) !== signer.publicKeySpkiSha256) {
    throw new Error("Launch permit signer pin is invalid");
  }
  let key: CryptoKey;
  try {
    key = await globalThis.crypto.subtle.importKey(
      "raw",
      exactArrayBuffer(publicKey),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch {
    throw new Error("Ed25519 permit verification is unavailable");
  }
  const signingBytes = new TextEncoder().encode(
    canonicalBrowserJsonV2(signingEnvelope),
  );
  const verified = await globalThis.crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    exactArrayBuffer(signature),
    exactArrayBuffer(signingBytes),
  ).catch(() => false);
  if (!verified) throw new Error("Launch permit signature is invalid");
  return signer;
}

export function assertLaunchPermitFreshnessV2(input: Readonly<{
  permit: AuthorizedLaunchPermitViewV2;
  execution: BrowserWalletLaunchPreparationV2;
  trustedNow: string;
}>): void {
  const artifact = parseCanonicalSignedPermitV2(
    input.permit.canonicalSignedPermitBase64Url,
  );
  const issuedAt = exactInstantMilliseconds(artifact.payload.issuedAt);
  const validUntil = exactInstantMilliseconds(artifact.payload.validUntil);
  const actionNotBefore = exactInstantMilliseconds(input.execution.actionNotBefore);
  const preparationExpiresAt = exactInstantMilliseconds(input.execution.expiresAt);
  const trustedNow = exactInstantMilliseconds(input.trustedNow);
  if (
    input.permit.validUntil !== artifact.payload.validUntil
    || issuedAt > trustedNow
    || actionNotBefore > trustedNow
    || actionNotBefore >= preparationExpiresAt
    || validUntil - trustedNow < 5_000
    || preparationExpiresAt - trustedNow < 5_000
  ) throw new Error("Launch permit or wallet transaction has expired");
}

export async function fetchTrustedTimeV1(
  signer: TrustedLaunchPermitSignerV2,
  fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<string> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 5_000);
  try {
    const query = new URLSearchParams({
      keyId: signer.keyId,
      signerEpoch: signer.signerEpoch,
      signerComponentBindingHash: signer.signerComponentBindingHash,
      publicKeySpkiSha256: signer.publicKeySpkiSha256,
    });
    const response = await fetcher(`/api/custom-launch/trusted-time?${query.toString()}`, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      redirect: "error",
      signal: controller.signal,
    });
    if (
      !response.ok
      || response.redirected
      || response.headers.get("content-type")
        ?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json"
      || !response.headers.get("cache-control")?.toLowerCase().includes("no-store")
    ) throw new Error("Trusted launch time is unavailable");
    const body = await response.json() as unknown;
    const record = objectRecord(body);
    exactObjectKeys(record, ["now", "schemaVersion"]);
    if (record.schemaVersion !== "programmable.trusted-time.v1") {
      throw new Error("Trusted launch time is unavailable");
    }
    exactInstantMilliseconds(record.now);
    return record.now as string;
  } catch (caught) {
    if (caught instanceof Error && caught.message === "Trusted launch time is unavailable") {
      throw caught;
    }
    throw new Error("Trusted launch time is unavailable");
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function assertActionPermitBindingV2(input: Readonly<{
  action: BrowserWalletActionV2;
  binding: BrowserWalletLaunchPreparationV2["actionPermitBinding"];
  deploymentCalldataHash: `sha256:${string}`;
  actionNotBefore: string;
  expiresAt: string;
  permit: AuthorizedLaunchPermitViewV2;
  permitRequestHash: `sha256:${string}`;
}>): void {
  const {
    action,
    actionNotBefore,
    binding,
    deploymentCalldataHash,
    expiresAt,
    permit,
    permitRequestHash,
  } = input;
  const transaction = action.params[0];
  const artifact = parseCanonicalSignedPermitV2(permit.canonicalSignedPermitBase64Url);
  const payload = artifact.payload;
  const finalityPolicy = objectRecord(payload.finalityPolicy);
  const expectedSender = namespacedIdentity(finalityPolicy.expectedTransactionSender);
  const expectedTarget = namespacedIdentity(finalityPolicy.expectedTransactionTarget);
  const digest = /^sha256:[0-9a-f]{64}$/u;
  const actionNotBeforeMs = exactInstantMilliseconds(actionNotBefore);
  const expiresAtMs = exactInstantMilliseconds(expiresAt);
  const executionValidAfterMs = Number(BigInt(String(payload.executionValidAfter)) * 1_000n);
  const executionValidUntilMs = Number(BigInt(String(payload.executionValidUntil)) * 1_000n);
  const permitValidUntilMs = exactInstantMilliseconds(payload.validUntil);
  const preimage = {
    schemaVersion: binding?.schemaVersion,
    permitId: binding?.permitId,
    permitPayloadHash: binding?.permitPayloadHash,
    signedPermitArtifactHash: binding?.signedPermitArtifactHash,
    permitRequestHash: binding?.permitRequestHash,
    transactionSender: binding?.transactionSender,
    transactionTarget: binding?.transactionTarget,
    transactionValueWei: binding?.transactionValueWei,
    deploymentCalldataHash: binding?.deploymentCalldataHash,
    create2RouteId: binding?.create2RouteId,
    routeNonce: binding?.routeNonce,
    executionValidAfter: binding?.executionValidAfter,
    executionValidUntil: binding?.executionValidUntil,
    browserWalletActionHash: binding?.browserWalletActionHash,
  };
  if (
    binding?.schemaVersion !== "programmable.browser-wallet-action-permit-binding.v2"
    || !digest.test(binding.actionPermitBindingHash)
    || binding.permitId !== permit.permitId
    || binding.permitPayloadHash !== permit.permitPayloadHash
    || binding.signedPermitArtifactHash !== permit.signedPermitArtifactHash
    || binding.permitRequestHash !== permitRequestHash
    || binding.deploymentCalldataHash !== deploymentCalldataHash
    || binding.create2RouteId !== payload.create2RouteId
    || binding.routeNonce !== payload.routeNonce
    || binding.executionValidAfter !== payload.executionValidAfter
    || binding.executionValidUntil !== payload.executionValidUntil
    || !Number.isSafeInteger(executionValidAfterMs)
    || !Number.isSafeInteger(executionValidUntilMs)
    || actionNotBeforeMs < executionValidAfterMs
    || expiresAtMs > executionValidUntilMs
    || expiresAtMs > permitValidUntilMs
    || binding.browserWalletActionHash
      !== canonicalBrowserSha256V2("programmable.browser-wallet-action.v2", action)
    || binding.transactionValueWei !== BigInt(transaction.value).toString(10)
    || binding.transactionSender.namespace !== `eip155:${action.chainId}`
    || binding.transactionSender.value.toLowerCase() !== transaction.from.toLowerCase()
    || binding.transactionTarget.namespace !== `eip155:${action.chainId}`
    || binding.transactionTarget.value.toLowerCase() !== transaction.to.toLowerCase()
    || canonicalBrowserSha256V2(
      "programmable.browser-wallet-action-permit-binding.v2",
      preimage,
    ) !== binding.actionPermitBindingHash
    || canonicalBrowserSha256V2(
      "programmable.signed-launch-permit.v2",
      artifact,
    ) !== permit.signedPermitArtifactHash
    || canonicalBrowserSha256V2(
      "programmable.launch-permit-payload.v2",
      payload,
    ) !== permit.permitPayloadHash
    || payload.permitId !== permit.permitId
    || payload.permitRequestHash !== permitRequestHash
    || payload.deploymentCalldataHash !== deploymentCalldataHash
    || payload.transactionValueWei !== binding.transactionValueWei
    || payload.walletNamespace !== binding.transactionSender.namespace
    || String(payload.walletValue).toLowerCase()
      !== binding.transactionSender.value.toLowerCase()
    || expectedSender.namespace !== binding.transactionSender.namespace
    || expectedSender.value.toLowerCase()
      !== binding.transactionSender.value.toLowerCase()
    || expectedTarget.namespace !== binding.transactionTarget.namespace
    || expectedTarget.value.toLowerCase()
      !== binding.transactionTarget.value.toLowerCase()
  ) throw new Error("Wallet target is not bound to the signed launch permit");
}

function parseCanonicalSignedPermitV2(value: string): Readonly<{
  schemaVersion: string;
  payload: Record<string, unknown>;
  envelope: Record<string, unknown>;
}> {
  if (!/^[A-Za-z0-9_-]+$/u.test(value) || value.length > 1_398_102) {
    throw new Error("Signed launch permit is not canonical");
  }
  const standard = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = standard.padEnd(standard.length + ((4 - standard.length % 4) % 4), "=");
  let decoded: string;
  try {
    decoded = atob(padded);
  } catch {
    throw new Error("Signed launch permit is not canonical");
  }
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (bytes.byteLength < 2 || bytes.byteLength > 1_048_576) {
    throw new Error("Signed launch permit is not canonical");
  }
  const canonicalBase64Url = btoa(
    Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""),
  ).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
  if (canonicalBase64Url !== value) {
    throw new Error("Signed launch permit is not canonical");
  }
  let text: string;
  let parsed: unknown;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error("Signed launch permit is not canonical");
  }
  const record = objectRecord(parsed);
  assertJsonMaximumDepth(record, 0);
  exactObjectKeys(record, ["envelope", "payload", "schemaVersion"]);
  const payload = objectRecord(record.payload);
  const envelope = objectRecord(record.envelope);
  if (
    record.schemaVersion !== "programmable.signed-launch-permit.v2"
    || payload.schemaVersion !== "programmable.launch-permit-payload.v2"
    || canonicalBrowserJsonV2(record) !== text
  ) throw new Error("Signed launch permit is not canonical");
  validateLaunchPermitPayloadV2(payload);
  return {
    schemaVersion: record.schemaVersion,
    payload,
    envelope,
  };
}

function validateLaunchPermitPayloadV2(payload: Record<string, unknown>): void {
  exactObjectKeys(payload, [...LAUNCH_PERMIT_UNSIGNED_PAYLOAD_KEYS_V2, "permitId"]);
  const digest = /^sha256:[0-9a-f]{64}$/u;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
  const positive = /^[1-9][0-9]{0,19}$/u;
  const safeId = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u;
  const address = /^0x[0-9a-f]{40}$/u;
  const uint256 = /^(0|[1-9][0-9]{0,77})$/u;
  if (
    payload.schemaVersion !== "programmable.launch-permit-payload.v2"
    || payload.audience !== "programmable.launch-execution.v2"
    || payload.apiSchemaVersion !== "programmable.launch-session-api.v2"
    || payload.authorizationOperation !== "launch-session:launch:authorize"
    || typeof payload.grantId !== "string" || !uuid.test(payload.grantId)
    || typeof payload.challengeId !== "string" || !uuid.test(payload.challengeId)
    || typeof payload.sessionRecordId !== "string" || !uuid.test(payload.sessionRecordId)
    || typeof payload.sessionId !== "string" || !uuid.test(payload.sessionId)
    || typeof payload.sessionNonce !== "string" || !uuid.test(payload.sessionNonce)
    || typeof payload.walletNonce !== "string" || !uuid.test(payload.walletNonce)
    || typeof payload.permitReservationId !== "string"
    || !uuid.test(payload.permitReservationId)
    || typeof payload.githubUserId !== "string" || !positive.test(payload.githubUserId)
    || typeof payload.chainId !== "string" || !positive.test(payload.chainId)
    || typeof payload.walletNamespace !== "string"
    || payload.walletNamespace !== `eip155:${payload.chainId}`
    || typeof payload.walletValue !== "string" || !address.test(payload.walletValue)
    || typeof payload.transactionValueWei !== "string"
    || !uint256.test(payload.transactionValueWei)
    || typeof payload.chainProfileId !== "string" || !safeId.test(payload.chainProfileId)
    || typeof payload.launchRouteId !== "string" || !safeId.test(payload.launchRouteId)
    || typeof payload.executionMode !== "string" || !safeId.test(payload.executionMode)
    || typeof payload.nonce !== "string" || !safeId.test(payload.nonce)
    || payload.nonce.length < 16
    || typeof payload.signerKeyId !== "string" || !safeId.test(payload.signerKeyId)
    || typeof payload.signerEpoch !== "string" || !positive.test(payload.signerEpoch)
    || (payload.create2RouteId !== "programmable:create2-deployer:v2"
      && payload.create2RouteId !== "programmable:create2-graph-deployer:v2")
    || typeof payload.routeNonce !== "string"
    || !/^0x[0-9a-f]{64}$/u.test(payload.routeNonce)
    || typeof payload.executionValidAfter !== "string"
    || !uint256.test(payload.executionValidAfter)
    || typeof payload.executionValidUntil !== "string"
    || !uint256.test(payload.executionValidUntil)
  ) throw new Error("Signed launch permit payload is invalid");
  if (
    BigInt(payload.chainId) >= (1n << 256n)
    || BigInt(payload.transactionValueWei) >= (1n << 256n)
    || BigInt(payload.executionValidAfter) >= (1n << 64n)
    || BigInt(payload.executionValidUntil) >= (1n << 64n)
    || BigInt(payload.executionValidAfter) >= BigInt(payload.executionValidUntil)
  ) throw new Error("Signed launch permit payload is invalid");
  assertNamedDigestFields(payload, digest);

  const authorizationAuthenticatedAt = exactInstantMilliseconds(
    payload.authorizationAuthenticatedAt,
  );
  const authorizationExpiresAt = exactInstantMilliseconds(payload.authorizationExpiresAt);
  const sessionExpiresAt = exactInstantMilliseconds(payload.sessionExpiresAt);
  exactInstantMilliseconds(payload.publicSourceFreshnessExpiresAt);
  const issuedAt = exactInstantMilliseconds(payload.issuedAt);
  const validUntil = exactInstantMilliseconds(payload.validUntil);
  if (
    authorizationAuthenticatedAt >= authorizationExpiresAt
    || authorizationAuthenticatedAt >= sessionExpiresAt
    || issuedAt >= validUntil
    || validUntil - issuedAt > 15 * 60 * 1_000
  ) throw new Error("Signed launch permit payload is invalid");

  const generations = objectRecord(payload.grantControlGenerations);
  exactObjectKeys(generations, LAUNCH_PERMIT_GENERATION_KEYS_V2);
  if (
    Object.values(generations).some((value) =>
      typeof value !== "string" || !positive.test(value))
    || payload.grantControlGenerationsHash !== canonicalBrowserSha256V2(
      "programmable.approval-control-generations.v2",
      generations,
    )
    || payload.permitIssuanceGeneration !== generations.permitIssuance
    || payload.permitConsumptionGeneration !== generations.permitConsumption
  ) throw new Error("Signed launch permit payload is invalid");

  const finalityPolicy = validateLaunchFinalityPolicyV2(payload.finalityPolicy, digest, safeId);
  if (payload.finalityPolicyHash !== finalityPolicy.finalityPolicyHash) {
    throw new Error("Signed launch permit payload is invalid");
  }

  const authority = Object.fromEntries(LAUNCH_PERMIT_AUTHORITY_KEYS_V2.map((key) => [
    key,
    key === "schemaVersion"
      ? "programmable.launch-permit-authority-bundle.v2"
      : payload[key],
  ]));
  const authorityBundleHash = canonicalBrowserSha256V2(
    "programmable.launch-permit-authority-bundle.v2",
    authority,
  );
  const executionRequest = {
    schemaVersion: "programmable.launch-execution-request.v2",
    audience: payload.audience,
    grantId: payload.grantId,
    grantBindingHash: payload.grantBindingHash,
    sessionRecordId: payload.sessionRecordId,
    sessionBindingHash: payload.sessionBindingHash,
    walletNamespace: payload.walletNamespace,
    walletValue: payload.walletValue,
    chainId: payload.chainId,
    chainProfileId: payload.chainProfileId,
    chainProfileHash: payload.chainProfileHash,
    launchRouteId: payload.launchRouteId,
    launchRouteBindingHash: payload.launchRouteBindingHash,
    executionMode: payload.executionMode,
    transactionValueWei: payload.transactionValueWei,
    launchArtifactCommitmentHash: payload.launchArtifactCommitmentHash,
    deploymentCalldataHash: payload.deploymentCalldataHash,
    feeAssessmentHash: payload.feeAssessmentHash,
    feeObligationHash: payload.feeObligationHash,
    feeAssessmentObligationBindingHash: payload.feeAssessmentObligationBindingHash,
    permitRequestHash: payload.permitRequestHash,
    executionIdempotencyKeyHash: payload.executionIdempotencyKeyHash,
    finalityPolicyHash: payload.finalityPolicyHash,
  };
  const reservation = {
    schemaVersion: "programmable.launch-permit-reservation.v2",
    permitReservationId: payload.permitReservationId,
    authorityBundleHash,
    executionRequestHash: payload.executionRequestHash,
    executionIdempotencyKeyHash: payload.executionIdempotencyKeyHash,
    nonce: payload.nonce,
    issuedAt: payload.issuedAt,
    validUntil: payload.validUntil,
    signerKeyId: payload.signerKeyId,
    signerEpoch: payload.signerEpoch,
    signerComponentBindingHash: payload.signerComponentBindingHash,
    finalityPolicy,
    finalityPolicyHash: payload.finalityPolicyHash,
  };
  exactObjectKeys(reservation, LAUNCH_PERMIT_RESERVATION_KEYS_V2);
  const { permitId, ...unsignedPayload } = payload;
  if (
    payload.executionRequestHash !== canonicalBrowserSha256V2(
      "programmable.launch-execution-request.v2",
      executionRequest,
    )
    || payload.permitReservationBindingHash !== canonicalBrowserSha256V2(
      "programmable.launch-permit-reservation.v2",
      reservation,
    )
    || permitId !== canonicalBrowserSha256V2(
      "programmable.launch-permit-id.v2",
      unsignedPayload,
    )
  ) throw new Error("Signed launch permit payload is invalid");
}

function validateLaunchFinalityPolicyV2(
  value: unknown,
  digest: RegExp,
  safeId: RegExp,
): Record<string, unknown> {
  const policy = objectRecord(value);
  exactObjectKeys(policy, [...LAUNCH_PERMIT_FINALITY_POLICY_KEYS_V2, "finalityPolicyHash"]);
  if (
    policy.schemaVersion !== "programmable.launch-finality-policy.v2"
    || typeof policy.finalityRouteId !== "string" || !safeId.test(policy.finalityRouteId)
    || typeof policy.launchIdentityNamespace !== "string"
    || !safeId.test(policy.launchIdentityNamespace)
  ) throw new Error("Signed launch permit finality policy is invalid");
  assertNamedDigestFields(policy, digest);
  validateNullablePermitIdentity(policy.expectedTransactionSender, safeId);
  validateNullablePermitIdentity(policy.expectedTransactionTarget, safeId);
  validateLaunchIdentityLocatorV2(policy.launchIdentityLocator, digest);
  const trace = objectRecord(policy.executionTraceRequirement);
  exactObjectKeys(trace, LAUNCH_PERMIT_TRACE_REQUIREMENT_KEYS_V2);
  const reasons = trace.requirementReasonCodes;
  if (
    trace.schemaVersion !== "programmable.evm-execution-trace-requirement.v1"
    || (trace.disposition !== "required" && trace.disposition !== "not_applicable")
    || !Array.isArray(reasons) || reasons.length > 64
    || reasons.some((reason) => typeof reason !== "string" || !safeId.test(reason) || reason.length > 128)
    || new Set(reasons).size !== reasons.length
    || reasons.some((reason, index) => [...reasons].sort()[index] !== reason)
  ) throw new Error("Signed launch permit trace requirement is invalid");
  assertNamedDigestFields(trace, digest);
  if (
    (trace.disposition === "required"
      && (trace.traceAbsenceProofHash !== null || reasons.length === 0))
    || (trace.disposition === "not_applicable"
      && (typeof trace.traceAbsenceProofHash !== "string"
        || !digest.test(trace.traceAbsenceProofHash)
        || reasons.length !== 0))
  ) throw new Error("Signed launch permit trace requirement is invalid");
  const { requirementHash, ...tracePreimage } = trace;
  if (
    requirementHash !== canonicalBrowserSha256V2(
      "programmable.evm-execution-trace-requirement.v1",
      tracePreimage,
    )
    || policy.dynamicTraceRequirementHash !== requirementHash
  ) throw new Error("Signed launch permit trace requirement is invalid");
  const { finalityPolicyHash, ...policyPreimage } = policy;
  if (
    finalityPolicyHash !== canonicalBrowserSha256V2(
      "programmable.launch-finality-policy.v2",
      policyPreimage,
    )
  ) throw new Error("Signed launch permit finality policy is invalid");
  return policy;
}

function validateLaunchIdentityLocatorV2(value: unknown, digest: RegExp): void {
  const locator = objectRecord(value);
  exactObjectKeys(locator, LAUNCH_PERMIT_LOCATOR_KEYS_V2);
  const kind = locator.kind;
  if (
    locator.schemaVersion !== "programmable.launch-identity-receipt-locator.v2"
    || ![
      "receipt-contract-address",
      "receipt-log-address",
      "receipt-log-topic",
      "receipt-log-data-word",
    ].includes(String(kind))
    || (locator.expectedEventHash !== null
      && (typeof locator.expectedEventHash !== "string"
        || !digest.test(locator.expectedEventHash)))
    || (locator.expectedLogIndex !== null
      && !isPermitUint256(locator.expectedLogIndex))
  ) throw new Error("Signed launch permit identity locator is invalid");
  const logFields = [
    locator.logAddress,
    locator.topic0,
    locator.topicIndex,
    locator.dataWordIndex,
    locator.expectedLogIndex,
    locator.expectedEventHash,
  ];
  if (kind === "receipt-contract-address" && logFields.some((field) => field !== null)) {
    throw new Error("Signed launch permit identity locator is invalid");
  }
  if (kind !== "receipt-contract-address") {
    if (
      typeof locator.topic0 !== "string" || !/^0x[0-9a-f]{64}$/u.test(locator.topic0)
      || (locator.logAddress !== null
        && (typeof locator.logAddress !== "string"
          || !/^0x[0-9a-f]{40}$/u.test(locator.logAddress)))
    ) throw new Error("Signed launch permit identity locator is invalid");
    if (kind === "receipt-log-address"
      && (locator.topicIndex !== null || locator.dataWordIndex !== null)) {
      throw new Error("Signed launch permit identity locator is invalid");
    }
    if (kind === "receipt-log-topic" && (
      locator.logAddress === null
      || typeof locator.topicIndex !== "string"
      || !/^[1-3]$/u.test(locator.topicIndex)
      || locator.dataWordIndex !== null
    )) throw new Error("Signed launch permit identity locator is invalid");
    if (kind === "receipt-log-data-word" && (
      locator.logAddress === null
      || locator.topicIndex !== null
      || !isPermitUint256(locator.dataWordIndex)
    )) throw new Error("Signed launch permit identity locator is invalid");
  }
}

function validateNullablePermitIdentity(value: unknown, safeId: RegExp): void {
  if (value === null) return;
  const identity = objectRecord(value);
  exactObjectKeys(identity, ["namespace", "value"]);
  if (
    typeof identity.namespace !== "string" || !safeId.test(identity.namespace)
    || typeof identity.value !== "string" || identity.value.length < 1
    || identity.value.length > 512
  ) throw new Error("Signed launch permit identity is invalid");
}

function isPermitUint256(value: unknown): value is string {
  return typeof value === "string"
    && /^(0|[1-9][0-9]{0,77})$/u.test(value)
    && BigInt(value) < (1n << 256n);
}

function assertNamedDigestFields(value: Record<string, unknown>, digest: RegExp): void {
  for (const [key, candidate] of Object.entries(value)) {
    if (key.endsWith("Hash") && candidate !== null && (
      typeof candidate !== "string" || !digest.test(candidate)
    )) throw new Error("Signed launch permit digest is invalid");
  }
}

function assertJsonMaximumDepth(value: unknown, depth: number): void {
  if (depth > 64) throw new Error("Signed launch permit is too deeply nested");
  if (value === null || typeof value !== "object") return;
  for (const nested of Array.isArray(value) ? value : Object.values(value)) {
    assertJsonMaximumDepth(nested, depth + 1);
  }
}

function exactObjectKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): void {
  const actual = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  if (
    actual.length !== canonicalExpected.length
    || actual.some((key, index) => key !== canonicalExpected[index])
  ) throw new Error("Signed launch permit is not canonical");
}

function decodeCanonicalBase64Url(
  value: unknown,
  expectedLength: number,
  label: string,
): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  const standard = value.replace(/-/gu, "+").replace(/_/gu, "/");
  const padded = standard.padEnd(
    standard.length + ((4 - standard.length % 4) % 4),
    "=",
  );
  let decoded: string;
  try {
    decoded = atob(padded);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  const canonical = btoa(
    Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""),
  ).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/gu, "");
  if (bytes.byteLength !== expectedLength || canonical !== value) {
    throw new Error(`${label} is invalid`);
  }
  return bytes;
}

function exactInstantMilliseconds(value: unknown): number {
  if (typeof value !== "string") {
    throw new Error("Launch permit time is invalid");
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new Error("Launch permit time is invalid");
  }
  return milliseconds;
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copied = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copied).set(bytes);
  return copied;
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Signed launch permit is not canonical");
  }
  return value as Record<string, unknown>;
}

function namespacedIdentity(value: unknown): Readonly<{ namespace: string; value: string }> {
  const record = objectRecord(value);
  if (typeof record.namespace !== "string" || typeof record.value !== "string") {
    throw new Error("Signed launch permit identity is invalid");
  }
  return { namespace: record.namespace, value: record.value };
}

export function CustomLaunchExperience({
  onBack,
  trustedLaunchPermitSigners,
}: {
  onBack: () => void;
  trustedLaunchPermitSigners: readonly TrustedLaunchPermitSignerV2[];
}) {
  const {
    authenticated,
    connectGithub,
    getAccessToken,
    getIdentityToken,
    githubConnected,
    githubUserId,
    githubUsername,
    openWallet,
    sendBrowserWalletAction,
    signLaunchMessage,
    wallet,
  } = useWallet();
  const [screen, setScreen] = useState<CustomLaunchScreen>("intro");
  const [applications, setApplications] = useState<
    readonly PrincipalCustomLaunchApplicationSummaryV2[]
  >([]);
  const [applicationsLoading, setApplicationsLoading] = useState(false);
  const [applicationsLoaded, setApplicationsLoaded] = useState(false);
  const [selected, setSelected] = useState<PrincipalCustomLaunchApplicationSummaryV2 | null>(null);
  const [descriptor, setDescriptor] = useState<LaunchDescriptorV2 | null>(null);
  const [configuration, setConfiguration] = useState<Record<string, string>>({});
  const [presentation, setPresentation] = useState<PresentationForm>(emptyPresentation);
  const [presentationVersion, setPresentationVersion] = useState(0);
  const [setupLoading, setSetupLoading] = useState(false);
  const [launchProgress, setLaunchProgress] = useState<LaunchProgress>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [transactionChainId, setTransactionChainId] = useState("");
  const [githubPrincipalHash, setGithubPrincipalHash] = useState<`sha256:${string}` | null>(null);
  const [pendingGrantReissue, setPendingGrantReissue] = useState<PendingGrantReissueV1 | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const flowGenerationRef = useRef(0);
  const applicationsRequestGenerationRef = useRef(0);
  const applicationsAbortControllerRef = useRef<AbortController | null>(null);
  const flowAbortControllerRef = useRef<AbortController | null>(null);
  const launchInFlightRef = useRef(false);
  const grantReissueSingleFlightRef = useRef(new BrowserWalletGrantReissueSingleFlightV1());
  const launchAuthorityRefreshSingleFlightRef = useRef(
    new LaunchAuthorityRefreshSingleFlightV1(),
  );
  const launchAuthorityRefreshAttemptRef = useRef(new Map<string, number>());
  const githubIdentityRef = useRef(githubUserId);
  const walletAccountRef = useRef(wallet?.account ?? null);

  useEffect(() => {
    walletAccountRef.current = wallet?.account ?? null;
  }, [wallet?.account]);

  const beginFlow = useCallback(() => {
    flowAbortControllerRef.current?.abort();
    const controller = new AbortController();
    flowAbortControllerRef.current = controller;
    return {
      generation: ++flowGenerationRef.current,
      signal: controller.signal,
    };
  }, []);

  const resetApplicationScopedState = useCallback(() => {
    setDescriptor(null);
    setConfiguration({});
    setPresentation(emptyPresentation);
    setPresentationVersion(0);
    setSetupLoading(false);
    setLaunchProgress("idle");
    setStatusMessage("");
    setError("");
    setTransactionHash("");
    setTransactionChainId("");
    setPendingGrantReissue(null);
  }, []);

  const markApplicationFinalized = useCallback((applicationHandle: ApplicationHandleV3, finalizedAt: string) => {
    setApplications((current) => current.map((application) =>
      application.applicationHandle === applicationHandle
        ? { ...application, state: "launched" as const, updatedAt: finalizedAt }
        : application));
  }, []);

  const getSession = useCallback(async (): Promise<CustomLaunchWebsiteSessionV2> => {
    const [accessToken, identityToken] = await Promise.all([
      getAccessToken(),
      getIdentityToken(),
    ]);
    if (!accessToken || !identityToken) {
      throw new Error("Sign in with GitHub and try again");
    }
    return { accessToken, identityToken };
  }, [getAccessToken, getIdentityToken]);

  const loadApplications = useCallback(async () => {
    if (!githubConnected) return;
    applicationsAbortControllerRef.current?.abort();
    const controller = new AbortController();
    applicationsAbortControllerRef.current = controller;
    const requestGeneration = ++applicationsRequestGenerationRef.current;
    setApplicationsLoading(true);
    setError("");
    try {
      const client = createCustomLaunchWebsiteClientV2({ session: await getSession() });
      const page = await readAllPrincipalApplicationsV3(client, {
        signal: controller.signal,
      });
      if (requestGeneration !== applicationsRequestGenerationRef.current) return;
      setApplications(page.applications);
      setGithubPrincipalHash(page.githubPrincipalHash);
      setApplicationsLoaded(true);
      setScreen("applications");
    } catch (caught) {
      if (requestGeneration !== applicationsRequestGenerationRef.current) return;
      setError(customLaunchErrorMessage(caught));
    } finally {
      if (applicationsAbortControllerRef.current === controller) {
        applicationsAbortControllerRef.current = null;
      }
      if (requestGeneration === applicationsRequestGenerationRef.current) {
        setApplicationsLoading(false);
      }
    }
  }, [getSession, githubConnected]);

  useEffect(() => {
    if (screen !== "intro" || !githubConnected || applicationsLoaded) return;
    const timeout = window.setTimeout(() => void loadApplications(), 0);
    return () => window.clearTimeout(timeout);
  }, [applicationsLoaded, githubConnected, loadApplications, screen]);

  useEffect(() => {
    const identityChanged = githubIdentityRef.current !== githubUserId;
    githubIdentityRef.current = githubUserId;
    if (githubConnected && !identityChanged) return;
    applicationsAbortControllerRef.current?.abort();
    applicationsAbortControllerRef.current = null;
    flowAbortControllerRef.current?.abort();
    flowAbortControllerRef.current = null;
    applicationsRequestGenerationRef.current += 1;
    flowGenerationRef.current += 1;
    setApplications([]);
    setApplicationsLoading(false);
    setApplicationsLoaded(false);
    setGithubPrincipalHash(null);
    setSelected(null);
    resetApplicationScopedState();
    setScreen("intro");
  }, [githubConnected, githubUserId, resetApplicationScopedState]);

  useEffect(() => () => {
    flowGenerationRef.current += 1;
    applicationsAbortControllerRef.current?.abort();
    flowAbortControllerRef.current?.abort();
  }, []);

  const loadVerifiedLaunchSetup = useCallback(async (input: Readonly<{
    client: ReturnType<typeof createCustomLaunchWebsiteClientV2>;
    application: PrincipalCustomLaunchApplicationSummaryV2;
    generation: number;
    signal: AbortSignal;
    forceFreshObservation?: boolean;
  }>) => {
    if (githubPrincipalHash === null) {
      throw new Error("Sign in again with the GitHub account that opened this submission");
    }
    const isActive = () => !input.signal.aborted
      && input.generation === flowGenerationRef.current;
    let currentApplication = input.application;
    let refreshCompleted = false;
    let refreshAuthority: PrincipalLaunchAuthorityRefreshViewV1 | null = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!isActive()) throw new LaunchAuthorityRefreshCancelledErrorV1();
      if (currentApplication.state === "ready_for_registration" && !refreshCompleted) {
        setStatusMessage("Running final source verification");
        const idempotencyKey = launchAuthorityRefreshIdempotencyKeyV1({
          application: currentApplication,
          attempt: launchAuthorityRefreshAttemptRef.current.get(
            currentApplication.launchEntitlementBindingHash!,
          ) ?? 0,
        });
        refreshAuthority = await launchAuthorityRefreshSingleFlightRef.current.run(
          `${currentApplication.applicationHandle}:${idempotencyKey}`,
          () => pollPrincipalLaunchAuthorityRefreshV1({
            client: input.client,
            application: currentApplication,
            idempotencyKey,
            isActive,
            onTransientRetry: () => {
              if (isActive()) {
                setStatusMessage("Verification service temporarily unavailable. Retrying automatically");
              }
            },
          }),
        );
        refreshCompleted = true;
        setStatusMessage("Final source verification complete");
      }

      const principalApplications = await readAllPrincipalApplicationsV3(input.client, {
        signal: input.signal,
      });
      if (!isActive()) throw new LaunchAuthorityRefreshCancelledErrorV1();
      if (principalApplications.githubPrincipalHash !== githubPrincipalHash) {
        throw new LaunchAuthorityRefreshBindingErrorV1(
          "The signed-in GitHub account changed during launch verification",
        );
      }
      const freshApplication = principalApplications.applications.find(
        ({ applicationHandle }) =>
          applicationHandle === input.application.applicationHandle,
      );
      if (freshApplication === undefined) {
        throw new LaunchAuthorityRefreshBindingErrorV1(
          "This exact GitHub submission is no longer current",
        );
      }
      assertSamePrincipalApplicationRevisionV1(input.application, freshApplication);
      currentApplication = freshApplication;
      if (currentApplication.state === "approved") {
        await delay(750);
        continue;
      }
      if (currentApplication.state !== "ready_for_registration") {
        throw new LaunchAuthorityRefreshBindingErrorV1(
          "This exact GitHub version is no longer approved to launch",
        );
      }

      const [eligibility, launchDescriptor, currentPresentation] = await Promise.all([
        input.client.launchEligibility(currentApplication.applicationHandle),
        input.client.launchDescriptor(currentApplication.applicationHandle),
        input.client.launchPresentation(currentApplication.applicationHandle).catch((caught) => {
          if (caught instanceof CustomLaunchWebsiteRequestErrorV2 && caught.status === 404) {
            return null;
          }
          throw caught;
        }),
      ]);
      if (!isActive()) throw new LaunchAuthorityRefreshCancelledErrorV1();
      assertLaunchSetupBindings({
        application: currentApplication,
        eligibility,
        descriptor: launchDescriptor,
        presentation: currentPresentation,
      });
      if (refreshAuthority !== null && !launchAuthorityObservationMatchesSetupV1({
        refresh: refreshAuthority,
        descriptor: launchDescriptor,
        eligibility,
      })) {
        await delay(250);
        continue;
      }
      if (!eligibility.launchAllowed || eligibility.state !== "active") {
        throw new LaunchAuthorityRefreshBindingErrorV1(
          "This exact GitHub version is not currently approved to launch",
        );
      }
      defaultLaunchRoute(launchDescriptor);
      if (launchAuthorityRefreshRequiredV1({
        descriptor: launchDescriptor,
        eligibility,
        forceFreshObservation: input.forceFreshObservation === true,
        refreshCompleted,
      })) {
        setStatusMessage("Renewing final source verification");
        const currentValidUntil = Date.parse(launchDescriptor.validUntil)
          <= Date.parse(eligibility.validUntil)
          ? launchDescriptor.validUntil
          : eligibility.validUntil;
        const idempotencyKey = launchAuthorityRefreshIdempotencyKeyV1({
          application: currentApplication,
          currentValidUntil,
          attempt: launchAuthorityRefreshAttemptRef.current.get(
            currentApplication.launchEntitlementBindingHash!,
          ) ?? 0,
        });
        refreshAuthority = await launchAuthorityRefreshSingleFlightRef.current.run(
          `${currentApplication.applicationHandle}:${idempotencyKey}`,
          () => pollPrincipalLaunchAuthorityRefreshV1({
            client: input.client,
            application: currentApplication,
            idempotencyKey,
            isActive,
            onTransientRetry: () => {
              if (isActive()) {
                setStatusMessage("Verification service temporarily unavailable. Retrying automatically");
              }
            },
          }),
        );
        refreshCompleted = true;
        continue;
      }
      return {
        principalApplications,
        application: currentApplication,
        eligibility,
        descriptor: launchDescriptor,
        presentation: currentPresentation,
      };
    }
    throw new Error("Final source verification is still being published. Try again shortly");
  }, [githubPrincipalHash]);

  const openApplication = useCallback(async (
    application: PrincipalCustomLaunchApplicationSummaryV2,
  ) => {
    if (!customApplicationOpensLaunchExperienceV2(application)) return;
    const { generation, signal } = beginFlow();
    resetApplicationScopedState();
    setSelected(application);
    setSetupLoading(true);
    setScreen("setup");
    try {
      if (githubPrincipalHash === null) {
        throw new Error("Sign in again with the GitHub account that opened this submission");
      }
      const client = createCustomLaunchWebsiteClientV2({ session: await getSession() });
      if (generation !== flowGenerationRef.current) return;
      if (application.state === "launched") {
        clearLaunchSession(githubPrincipalHash, application.applicationHandle);
        setLaunchProgress("complete");
        setStatusMessage("Launch complete. Project publishing is confirmed by the custom registry.");
        return;
      }
      const recoveryRead = readLaunchSession(
        githubPrincipalHash,
        application.applicationHandle,
      );
      if (recoveryRead.kind === "unreadable") {
        throw new Error("Launch recovery is unavailable in this browser. No new transaction can be submitted safely");
      }
      const recovery = recoveryRead.kind === "valid" ? recoveryRead.recovery : null;
      if (application.state === "launching" || recovery !== null) {
        setLaunchProgress("confirmation");
        setStatusMessage("Checking launch confirmation");
        setSetupLoading(false);
        if (!recovery) {
          setStatusMessage("Launch verification is still in progress");
          return;
        }
        if (recovery.stage === "broadcast") {
          setTransactionHash(recovery.transactionHash);
          setTransactionChainId(recovery.chainId);
          await reportPersistedLaunchTransactionV2(client, recovery);
          if (generation !== flowGenerationRef.current) return;
        }
        const finalized = await pollLaunchStatus(client, {
          applicationHandle: application.applicationHandle,
          applicationId: application.applicationId,
          grantId: recovery.grantId,
          grantBindingHash: recovery.grantBindingHash,
          sessionId: recovery.sessionId,
          permitId: recovery.permitId,
          executionReservationId: recovery.executionReservationId,
          chainId: recovery.chainId,
          ...(recovery.stage === "broadcast"
            ? { launchTransactionId: recovery.transactionHash }
            : {}),
          isActive: () => generation === flowGenerationRef.current,
          onPublishing: () => {
            if (generation !== flowGenerationRef.current) return;
            setLaunchProgress("publishing");
            setStatusMessage("Publishing project");
          },
        });
        if (generation !== flowGenerationRef.current) return;
        clearLaunchSession(githubPrincipalHash, application.applicationHandle);
        markApplicationFinalized(application.applicationHandle, finalized.finalizedAt);
        setLaunchProgress("complete");
        setStatusMessage("Launch complete");
        return;
      }
      const setup = await loadVerifiedLaunchSetup({
        client,
        application,
        generation,
        signal,
      });
      if (generation !== flowGenerationRef.current) return;
      setApplications(setup.principalApplications.applications);
      setSelected(setup.application);
      setDescriptor(setup.descriptor);
      setConfiguration(Object.fromEntries(
        setup.descriptor.configurationSchema.fields.map(({ fieldId }) => [fieldId, ""]),
      ));
      setPresentation(presentationFormFromResponse(setup.presentation));
      setPresentationVersion(setup.presentation?.version ?? 0);
    } catch (caught) {
      if (generation !== flowGenerationRef.current || caught instanceof LaunchFlowCancelledError) return;
      if (
        caught instanceof LaunchAuthorityRefreshFailedErrorV1
        && application.launchEntitlementBindingHash !== null
      ) {
        const binding = application.launchEntitlementBindingHash;
        launchAuthorityRefreshAttemptRef.current.set(
          binding,
          (launchAuthorityRefreshAttemptRef.current.get(binding) ?? 0) + 1,
        );
      }
      if (shouldClearLaunchRecoveryV2(caught)) {
        if (githubPrincipalHash !== null) {
          clearLaunchSession(githubPrincipalHash, application.applicationHandle);
        }
      }
      setError(customLaunchErrorMessage(caught));
    } finally {
      if (generation === flowGenerationRef.current) setSetupLoading(false);
    }
  }, [
    beginFlow,
    getSession,
    githubPrincipalHash,
    loadVerifiedLaunchSetup,
    markApplicationFinalized,
    resetApplicationScopedState,
  ]);

  async function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selected) return;
    const generation = flowGenerationRef.current;
    const applicationHandle = selected.applicationHandle;
    const isCurrent = () => generation === flowGenerationRef.current
      && selected.applicationHandle === applicationHandle;
    setError("");
    setStatusMessage("Preparing image");
    try {
      const image = await prepareTokenImage(file);
      if (!isCurrent()) return;
      const session = await getSession();
      if (!isCurrent()) return;
      const form = new FormData();
      form.append("file", new File([image], "custom-launch.webp", { type: "image/webp" }));
      const response = await fetch("/api/token-image", {
        method: "POST",
        headers: { authorization: `Bearer ${session.accessToken}` },
        body: form,
      });
      const body = await response.json() as { url?: string; error?: string };
      if (!isCurrent()) return;
      if (!response.ok || !body.url) throw new Error(body.error ?? "Unable to upload image");
      const contentSha256 = await fileSha256V2(
        new Uint8Array(await image.arrayBuffer()),
      );
      if (!isCurrent()) return;
      setPresentation((current) => ({
        ...current,
        imagePreview: body.url!,
        image: {
          uri: body.url!,
          contentSha256,
          mediaType: "image/webp",
          byteLength: image.size,
          width: TOKEN_IMAGE_OUTPUT_SIZE,
          height: TOKEN_IMAGE_OUTPUT_SIZE,
        },
      }));
      setStatusMessage("Image ready");
    } catch (caught) {
      if (!isCurrent()) return;
      setError(customLaunchErrorMessage(caught));
      setStatusMessage("");
    }
  }

  const refreshExpiredGrant = useCallback(async (input: Readonly<{
    application: PrincipalCustomLaunchApplicationSummaryV2;
    context: PendingGrantReissueV1;
    generation: number;
    signal: AbortSignal;
    client: ReturnType<typeof createCustomLaunchWebsiteClientV2>;
  }>) => {
    const isActive = () => !input.signal.aborted
      && input.generation === flowGenerationRef.current;
    if (githubPrincipalHash === null) {
      throw new Error("Sign in again with the GitHub account that opened this submission");
    }
    setPendingGrantReissue(input.context);
    setLaunchProgress("preparing");
    setError("");
    setStatusMessage("Preparing a new launch approval");
    const result = await grantReissueSingleFlightRef.current.run(
      `${input.application.applicationHandle}:${input.context.oldDescriptor.grantId}`,
      () =>
      pollBrowserWalletGrantReissueV1({
        client: input.client,
        oldGrantId: input.context.oldDescriptor.grantId,
        applicationId: input.application.applicationId,
        applicationHandle: input.application.applicationHandle,
        idempotencyKey: input.context.idempotencyKey,
        ...(input.context.expectedIdentity === undefined
          ? {}
          : { expectedIdentity: input.context.expectedIdentity }),
        isActive,
      }),
    );
    if (!isActive()) throw new BrowserWalletGrantReissueCancelledV1();
    if (result.kind === "pending") {
      setPendingGrantReissue({
        ...input.context,
        expectedIdentity: browserWalletGrantReissueIdentityV1(result.snapshot),
      });
      setLaunchProgress("idle");
      setStatusMessage("A new launch approval is still being prepared. Check again shortly");
      return;
    }
    if (result.kind === "failed") {
      setPendingGrantReissue(null);
      setDescriptor(null);
      setLaunchProgress("idle");
      throw new Error("We couldn't prepare a new launch approval. Check the GitHub review before trying again");
    }
    setStatusMessage("Checking the new launch approval");
    const [principalApplications, eligibility, freshDescriptor, currentPresentation] =
      await Promise.all([
        readAllPrincipalApplicationsV3(input.client, { signal: input.signal }),
        input.client.launchEligibility(input.application.applicationHandle),
        input.client.launchDescriptor(input.application.applicationHandle),
        input.client.launchPresentation(input.application.applicationHandle).catch((caught) => {
          if (caught instanceof CustomLaunchWebsiteRequestErrorV2 && caught.status === 404) {
            return null;
          }
          throw caught;
        }),
      ]);
    if (!isActive()) throw new BrowserWalletGrantReissueCancelledV1();
    if (principalApplications.githubPrincipalHash !== githubPrincipalHash) {
      throw new BrowserWalletGrantReissueBindingErrorV1(
        "The signed-in GitHub account changed while approval was refreshing",
      );
    }
    const freshApplication = principalApplications.applications.find(
      ({ applicationHandle }) =>
        applicationHandle === input.application.applicationHandle,
    );
    if (freshApplication === undefined) {
      throw new BrowserWalletGrantReissueBindingErrorV1(
        "This exact GitHub submission is no longer current",
      );
    }
    assertFreshReissuedGrantV1({
      oldDescriptor: input.context.oldDescriptor,
      freshDescriptor,
      reissue: result.snapshot,
      originalApplication: input.application,
      freshApplication,
    });
    assertLaunchSetupBindings({
      application: freshApplication,
      eligibility,
      descriptor: freshDescriptor,
      presentation: currentPresentation,
    });
    if (!eligibility.launchAllowed || eligibility.state !== "active") {
      throw new BrowserWalletGrantReissueBindingErrorV1(
        "This exact GitHub version is no longer approved to launch",
      );
    }
    defaultLaunchRoute(freshDescriptor);
    setApplications(principalApplications.applications);
    setSelected(freshApplication);
    setDescriptor(freshDescriptor);
    setConfiguration((current) => Object.fromEntries(
      freshDescriptor.configurationSchema.fields.map(({ fieldId }) => [
        fieldId,
        current[fieldId] ?? "",
      ]),
    ));
    if (currentPresentation !== null) {
      setPresentation(presentationFormFromResponse(currentPresentation));
    }
    setPresentationVersion(currentPresentation?.version ?? 0);
    setPendingGrantReissue(null);
    setLaunchProgress("idle");
    setStatusMessage("New approval ready. Review the launch and confirm again");
  }, [githubPrincipalHash]);

  async function resumeGrantReissue() {
    if (!selected || !pendingGrantReissue || launchInFlightRef.current) return;
    launchInFlightRef.current = true;
    const { generation, signal } = beginFlow();
    try {
      const client = createCustomLaunchWebsiteClientV2({ session: await getSession() });
      if (generation !== flowGenerationRef.current) return;
      await refreshExpiredGrant({
        application: selected,
        context: pendingGrantReissue,
        generation,
        signal,
        client,
      });
    } catch (caught) {
      if (
        generation !== flowGenerationRef.current
        || caught instanceof BrowserWalletGrantReissueCancelledV1
      ) return;
      if (isPermanentGrantReissueFailure(caught)) {
        setPendingGrantReissue(null);
        setDescriptor(null);
      }
      setLaunchProgress("idle");
      setError(customLaunchErrorMessage(caught));
    } finally {
      launchInFlightRef.current = false;
    }
  }

  async function launch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !descriptor || pendingGrantReissue !== null) return;
    if (githubPrincipalHash === null) {
      setError("Sign in again with the GitHub account that opened this submission");
      return;
    }
    if (launchInFlightRef.current) return;
    setError("");
    if (!wallet) {
      openWallet();
      return;
    }
    const launchWalletAccount = wallet.account;
    const assertLaunchWalletCurrent = () => {
      if (walletAccountRef.current?.toLowerCase()
        !== launchWalletAccount.toLowerCase()) {
        throw new Error("The active wallet changed. Review the launch and confirm again");
      }
    };
    const configurationError = validateLaunchConfigurationV2(descriptor, configuration);
    if (configurationError) {
      setError(configurationError);
      return;
    }
    const presentationResult = buildPresentationDraftFromForm(presentation);
    if ("error" in presentationResult) {
      setError(presentationResult.error);
      return;
    }
    const presentationDraft = presentationResult.draft;
    if (new TextEncoder().encode(presentationDraft.description).byteLength > 4_096) {
      setError("Shorten the project description to 4,096 bytes or fewer");
      return;
    }
    const recoveryRead = readLaunchSession(
      githubPrincipalHash,
      selected.applicationHandle,
    );
    if (recoveryRead.kind !== "absent") {
      setError("An existing launch attempt must be resolved before another transaction can be submitted");
      return;
    }

    launchInFlightRef.current = true;
    const { generation, signal } = beginFlow();
    const applicationId = selected.applicationId;
    const applicationHandle = selected.applicationHandle;
    const launchGithubPrincipalHash = githubPrincipalHash;
    const isActive = () => !signal.aborted
      && generation === flowGenerationRef.current;
    setLaunchProgress("preparing");
    setStatusMessage("Preparing approved launch");
    let activeDescriptor = descriptor;
    try {
      const client = createCustomLaunchWebsiteClientV2({ session: await getSession() });
      if (!isActive()) return;
      const initialSetup = await loadVerifiedLaunchSetup({
        client,
        application: selected,
        generation,
        signal,
      });
      if (!isActive()) return;
      activeDescriptor = initialSetup.descriptor;
      setApplications(initialSetup.principalApplications.applications);
      setSelected(initialSetup.application);
      setDescriptor(activeDescriptor);
      const currentConfigurationError = validateLaunchConfigurationV2(
        activeDescriptor,
        configuration,
      );
      if (currentConfigurationError) throw new Error(currentConfigurationError);
      const presentationResponse = await client.commitLaunchPresentation(
        applicationHandle,
        {
          schemaVersion: "programmable.principal-launch-presentation-commit-request.v1",
          applicationId,
          grantId: activeDescriptor.grantId,
          grantBindingHash: activeDescriptor.grantBindingHash,
          expectedVersion: presentationVersion,
          presentation: presentationDraft,
        },
        idempotencyKey("presentation"),
      );
      if (!isActive()) return;
      assertLaunchPresentationBinding(
        selected.applicationId,
        applicationHandle,
        activeDescriptor,
        presentationResponse,
      );
      if (presentationResponse.outcome === "conflict") {
        setPresentation(presentationFormFromResponse(presentationResponse));
        setPresentationVersion(presentationResponse.version);
        throw new Error("Project details changed in another window. Review the latest version and try again");
      }
      setPresentationVersion(presentationResponse.version);

      setStatusMessage("Checking final launch authority");
      const challengeSetup = await loadVerifiedLaunchSetup({
        client,
        application: initialSetup.application,
        generation,
        signal,
        forceFreshObservation: true,
      });
      if (!isActive()) return;
      if (
        challengeSetup.presentation === null
        || challengeSetup.presentation.presentationBindingHash
          !== presentationResponse.presentationBindingHash
        || challengeSetup.presentation.version !== presentationResponse.version
      ) throw new LaunchAuthorityRefreshBindingErrorV1(
        "Project details or launch authority changed in another window. Review and try again",
      );
      activeDescriptor = challengeSetup.descriptor;
      assertLaunchPresentationBinding(
        challengeSetup.application.applicationId,
        applicationHandle,
        activeDescriptor,
        challengeSetup.presentation,
      );
      setApplications(challengeSetup.principalApplications.applications);
      setSelected(challengeSetup.application);
      setDescriptor(activeDescriptor);

      assertLaunchWalletCurrent();

      const selection = buildCustomLaunchSelection({
        descriptor: activeDescriptor,
        wallet: launchWalletAccount,
        configuration,
        presentationBindingHash: presentationResponse.presentationBindingHash,
      });
      const challengeRequest = {
        schemaVersion: "programmable.launch-session-challenge-create-request.v2" as const,
        audience: "programmable.launch-session.v2" as const,
        idempotencyKey: idempotencyKey("challenge"),
        grantId: activeDescriptor.grantId,
        grantBindingHash: activeDescriptor.grantBindingHash,
        selection,
      };
      const challenge = await client.createChallenge(challengeRequest);
      if (!isActive()) return;
      if (
        challenge.grantId !== activeDescriptor.grantId
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(challenge.challengeId)
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(challenge.sessionId)
        || !/^sha256:[0-9a-f]{64}$/u.test(challenge.challengeBindingHash)
        || !Number.isFinite(Date.parse(challenge.expiresAt))
      ) throw new Error("Launch challenge does not match the exact approved launch");
      setStatusMessage("Building the exact approved transaction");
      const preparation = await retryPreparation(client, {
        schemaVersion: "programmable.launch-session-preparation-bind-request.v2",
        audience: "programmable.launch-session.v2",
        idempotencyKey: idempotencyKey("preparation"),
        grantId: activeDescriptor.grantId,
        grantBindingHash: activeDescriptor.grantBindingHash,
        selection,
        challengeId: challenge.challengeId,
        challengeBindingHash: challenge.challengeBindingHash,
      }, isActive);
      if (!isActive()) return;
      const route = defaultLaunchRoute(activeDescriptor);
      const walletMessage = preparation.walletMessage;
      if (
        preparation.grantId !== activeDescriptor.grantId
        || preparation.challengeId !== challenge.challengeId
        || preparation.challengeBindingHash !== challenge.challengeBindingHash
        || preparation.sessionId !== challenge.sessionId
        || walletMessage.grantId !== activeDescriptor.grantId
        || walletMessage.grantBindingHash !== activeDescriptor.grantBindingHash
        || walletMessage.challengeId !== challenge.challengeId
        || walletMessage.challengeBindingHash !== challenge.challengeBindingHash
        || walletMessage.sessionId !== challenge.sessionId
        || walletMessage.preparationBindingHash !== preparation.preparationBindingHash
        || walletMessage.launchArtifactCommitmentHash !== preparation.launchArtifactCommitmentHash
        || walletMessage.launchArtifactManifestHash !== preparation.launchArtifactManifestHash
        || walletMessage.launchArtifactOutputSetHash !== preparation.launchArtifactOutputSetHash
        || walletMessage.deploymentCalldataHash !== preparation.deploymentCalldataHash
        || walletMessage.walletNamespace !== selection.launcherWallet.namespace
        || walletMessage.walletValue.toLowerCase() !== launchWalletAccount.toLowerCase()
        || walletMessage.chainId !== route.chainId
        || walletMessage.chainProfileId !== route.chainProfileId
        || walletMessage.routeId !== route.launchRouteId
        || walletMessage.routeBindingHash !== route.launchRouteBindingHash
        || walletMessage.executionMode !== route.executionMode
        || walletMessage.transactionValueWei !== route.transactionValuePolicy.valueWei
      ) throw new Error("Wallet proof does not match the exact approved launch");

      setLaunchProgress("wallet-proof");
      setStatusMessage("Confirm in your wallet");
      assertLaunchWalletCurrent();
      const signatureBase64Url = await signLaunchMessage(
        preparation.signingMessageBase64Url,
      );
      if (!isActive()) return;
      assertLaunchWalletCurrent();
      const walletProof = {
        schemaVersion: "programmable.launch-wallet-proof-transport.v2" as const,
        signatureScheme: "eip191:personal-sign" as const,
        signatureBase64Url,
      };
      const walletAuthenticationRequest = {
        schemaVersion: "programmable.launch-session-wallet-authenticate-request.v2" as const,
        audience: "programmable.launch-session.v2" as const,
        idempotencyKey: idempotencyKey("wallet-proof"),
        grantId: activeDescriptor.grantId,
        grantBindingHash: activeDescriptor.grantBindingHash,
        selection,
        challengeId: challenge.challengeId,
        challengeBindingHash: challenge.challengeBindingHash,
        preparationBindingHash: preparation.preparationBindingHash,
        launchArtifactCommitmentHash: preparation.launchArtifactCommitmentHash,
        launchArtifactManifestHash: preparation.launchArtifactManifestHash,
        launchArtifactOutputSetHash: preparation.launchArtifactOutputSetHash,
        deploymentCalldataHash: preparation.deploymentCalldataHash,
        walletMessageHash: canonicalBrowserSha256V2(
          "programmable.launch-wallet-ownership-message.v2",
          preparation.walletMessage,
        ),
        walletProofHash: canonicalBrowserSha256V2(
          "programmable.launch-wallet-proof-transport.v2",
          walletProof,
        ),
      };
      const authenticatedSession = await client.authenticateWallet({
        schemaVersion: "programmable.launch-session-wallet-authenticate-http-request.v2",
        request: walletAuthenticationRequest,
        walletProof,
      });
      if (!isActive()) return;
      if (
        authenticatedSession.grantId !== activeDescriptor.grantId
        || authenticatedSession.challengeId !== challenge.challengeId
        || authenticatedSession.challengeBindingHash !== challenge.challengeBindingHash
        || authenticatedSession.sessionId !== challenge.sessionId
      ) throw new Error("Wallet authentication does not match the exact approved launch");
      const authorizeRequest: AuthorizeLaunchSessionRequestV2 = {
        schemaVersion: "programmable.launch-session-launch-authorize-request.v2",
        audience: "programmable.launch-session.v2",
        idempotencyKey: idempotencyKey("authorization"),
        grantId: activeDescriptor.grantId,
        grantBindingHash: activeDescriptor.grantBindingHash,
        selection,
        challengeId: challenge.challengeId,
        challengeBindingHash: challenge.challengeBindingHash,
        sessionId: authenticatedSession.sessionId,
        sessionBindingHash: authenticatedSession.sessionBindingHash,
        preparationBindingHash: preparation.preparationBindingHash,
        launchArtifactCommitmentHash: preparation.launchArtifactCommitmentHash,
        launchArtifactManifestHash: preparation.launchArtifactManifestHash,
        launchArtifactOutputSetHash: preparation.launchArtifactOutputSetHash,
        deploymentCalldataHash: preparation.deploymentCalldataHash,
        permitRequestHash: authenticatedSession.permitRequestHash,
      };
      const permit = await client.authorizeLaunch(authorizeRequest);
      if (!isActive()) return;
      if (
        permit.grantId !== activeDescriptor.grantId
        || permit.sessionId !== authenticatedSession.sessionId
        || permit.sessionBindingHash !== authenticatedSession.sessionBindingHash
      ) throw new Error("Launch permit does not match the exact approved launch");
      const verifiedPermitSigner = await verifyAuthorizedLaunchPermitSignatureV2({
        permit,
        trustedSigners: trustedLaunchPermitSigners,
      });
      if (!isActive()) return;
      const execution = await client.createExecutionPreparation({
        schemaVersion: "programmable.browser-wallet-launch-preparation-request.v2",
        request: authorizeRequest,
        authorizationArtifactBase64Url: permit.canonicalSignedPermitBase64Url,
      });
      if (!isActive()) return;
      const trustedNow = await fetchTrustedTimeV1(verifiedPermitSigner);
      if (!isActive()) return;
      assertLaunchPermitFreshnessV2({
        permit,
        execution,
        trustedNow,
      });

      const action = assertBrowserWalletExecutionBinding({
        descriptor: activeDescriptor,
        execution,
        deploymentCalldataHash: preparation.deploymentCalldataHash,
        permit,
        permitRequestHash: authenticatedSession.permitRequestHash,
        selection,
        wallet: launchWalletAccount,
        now: Date.parse(trustedNow),
      });
      const reportIdempotencyKey = idempotencyKey("transaction-report");
      const preparedRecovery: PreparedLaunchRecoveryV2 = {
        stage: "prepared",
        applicationHandle,
        githubPrincipalHash: launchGithubPrincipalHash,
        grantId: activeDescriptor.grantId,
        grantBindingHash: activeDescriptor.grantBindingHash,
        sessionId: authenticatedSession.sessionId,
        permitId: permit.permitId,
        chainId: action.chainId,
        executionReservationId: execution.executionReservationId,
        browserWalletActionHash: execution.browserWalletActionHash,
        reportIdempotencyKey,
        expiresAt: execution.expiresAt,
        reservedTransactionHash: `0x${"0".repeat(64)}`,
      };
      requirePersistLaunchSession(
        launchGithubPrincipalHash,
        applicationHandle,
        preparedRecovery,
      );
      setLaunchProgress("wallet-transaction");
      setStatusMessage("Submit launch in your wallet");
      assertLaunchWalletCurrent();
      const transaction = action.params[0];
      const hash = await sendBrowserWalletAction({
        chainId: action.chainId,
        from: transaction.from,
        to: transaction.to,
        data: transaction.data,
        value: transaction.value,
      });
      const reportRecovery: PersistedLaunchRecoveryV2 = {
        stage: "broadcast",
        applicationHandle,
        githubPrincipalHash: launchGithubPrincipalHash,
        grantId: activeDescriptor.grantId,
        grantBindingHash: activeDescriptor.grantBindingHash,
        sessionId: authenticatedSession.sessionId,
        permitId: permit.permitId,
        chainId: action.chainId,
        executionReservationId: execution.executionReservationId,
        browserWalletActionHash: execution.browserWalletActionHash,
        reportIdempotencyKey,
        expiresAt: execution.expiresAt,
        transactionHash: hash,
      };
      try {
        requirePersistLaunchSession(
          launchGithubPrincipalHash,
          applicationHandle,
          reportRecovery,
        );
      } catch {
        // The durable prepared lock remains. Report immediately so the server
        // can recover the broadcast without permitting a second launch.
      }
      if (isActive()) {
        setTransactionHash(hash);
        setTransactionChainId(action.chainId);
        setLaunchProgress("confirmation");
        setStatusMessage("Waiting for confirmation");
      }
      await reportPersistedLaunchTransactionV2(client, reportRecovery);
      if (!isActive()) return;
      const finalized = await pollLaunchStatus(client, {
        applicationHandle,
        applicationId,
        grantId: activeDescriptor.grantId,
        grantBindingHash: activeDescriptor.grantBindingHash,
        sessionId: authenticatedSession.sessionId,
        permitId: permit.permitId,
        executionReservationId: execution.executionReservationId,
        chainId: action.chainId,
        launchRouteId: route.launchRouteId,
        launchTransactionId: hash,
        isActive,
        onPublishing: () => {
          if (!isActive()) return;
          setLaunchProgress("publishing");
          setStatusMessage("Publishing project");
        },
      });
      if (!isActive()) return;
      clearLaunchSession(launchGithubPrincipalHash, applicationHandle);
      markApplicationFinalized(applicationHandle, finalized.finalizedAt);
      setLaunchProgress("complete");
      setStatusMessage("Launch complete");
    } catch (caught) {
      if (!isActive() || caught instanceof LaunchFlowCancelledError) return;
      if (
        caught instanceof LaunchAuthorityRefreshFailedErrorV1
        && selected.launchEntitlementBindingHash !== null
      ) {
        const binding = selected.launchEntitlementBindingHash;
        launchAuthorityRefreshAttemptRef.current.set(
          binding,
          (launchAuthorityRefreshAttemptRef.current.get(binding) ?? 0) + 1,
        );
      }
      let failure = caught;
      if (isLaunchPreparationReissueRequiredV1(caught)) {
        try {
          await refreshExpiredGrant({
            application: selected,
            context: {
              oldDescriptor: activeDescriptor,
              idempotencyKey: idempotencyKey("grant-reissue"),
            },
            generation,
            signal,
            client: createCustomLaunchWebsiteClientV2({ session: await getSession() }),
          });
          return;
        } catch (reissueFailure) {
          if (
            !isActive()
            || reissueFailure instanceof BrowserWalletGrantReissueCancelledV1
          ) return;
          failure = reissueFailure;
          if (isPermanentGrantReissueFailure(reissueFailure)) {
            setPendingGrantReissue(null);
            setDescriptor(null);
          }
        }
      }
      if (shouldClearLaunchRecoveryV2(failure)) {
        clearLaunchSession(launchGithubPrincipalHash, applicationHandle);
      }
      setError(customLaunchErrorMessage(failure));
      setLaunchProgress((current) =>
        current === "confirmation" || current === "publishing" ? current : "idle",
      );
    } finally {
      launchInFlightRef.current = false;
    }
  }

  const returnToApplications = () => {
    flowAbortControllerRef.current?.abort();
    flowAbortControllerRef.current = null;
    flowGenerationRef.current += 1;
    setSelected(null);
    resetApplicationScopedState();
    setScreen("applications");
  };

  const approvedRoute = descriptor ? defaultLaunchRoute(descriptor) : null;
  const feeReview = approvedRoute
    ? customLaunchFeeReviewV1(approvedRoute.feePolicy)
    : null;
  const applicationSummary = customApplicationSummaryCounts(applications);

  if (screen === "intro") {
    return (
      <CustomLaunchFrame onBack={onBack} title="Build a custom launch">
        <div className={styles.introGrid}>
          <section className={styles.introPrimary}>
            <span className={styles.kicker}>Open builder</span>
            <h2>Start with an idea.</h2>
            <p>
              Describe what you want to build to an agent, or submit the reviewed files
              yourself. Your exact GitHub version must be approved before it can launch.
            </p>
            <div className={styles.actions}>
              <a className="primary-button" href={BUILDER_SKILL_URL} target="_blank" rel="noreferrer">
                Build with an agent <ExternalLink aria-hidden="true" size={16} />
              </a>
              <a className={styles.secondaryButton} href={SUBMISSION_REQUIREMENTS_URL} target="_blank" rel="noreferrer">
                Read GitHub application guide
              </a>
            </div>
          </section>
          <section className={styles.statusEntry}>
            <span className={styles.githubMark} aria-hidden="true">
              <GitHubBrandIcon />
            </span>
            <h2>{githubConnected ? "Check your submissions" : "Already submitted?"}</h2>
            <p>
              Sign in with the GitHub account that opened the submission. We check
              the exact reviewed revision. Connect a wallet only after choosing a
              launch-ready submission.
            </p>
            <div className={styles.githubGate}>
              {githubConnected ? (
                <div>
                  <span>GitHub account</span>
                  <code>{githubUsername ? `@${githubUsername}` : "Connected"}</code>
                </div>
              ) : null}
              <button
                className={styles.githubButton}
                type="button"
                disabled={applicationsLoading}
                onClick={githubConnected ? () => void loadApplications() : connectGithub}
              >
                {applicationsLoading ? <LoaderCircle aria-hidden="true" className={styles.spin} size={17} /> : <span className={styles.githubButtonMark} aria-hidden="true"><GitHubBrandIcon /></span>}
                {githubConnected ? "Check submission status" : authenticated ? "Link GitHub account" : "Continue with GitHub"}
              </button>
            </div>
          </section>
        </div>
        <LiveMessage message={error || statusMessage} error={Boolean(error)} />
      </CustomLaunchFrame>
    );
  }

  if (screen === "applications") {
    return (
      <CustomLaunchFrame onBack={onBack} title="Custom launches" eyebrow={githubUsername ? `@${githubUsername}` : "GitHub submissions"}>
        <div className={styles.listToolbar}>
          <p>Every status is tied to one exact GitHub commit.</p>
          <button className={styles.iconButton} type="button" aria-label="Refresh submissions" disabled={applicationsLoading} onClick={() => void loadApplications()}>
            <RefreshCw aria-hidden="true" className={applicationsLoading ? styles.spin : undefined} size={17} />
          </button>
        </div>
        {applications.length > 0 ? (
          <dl className={styles.applicationSummary} aria-label="Submission overview" aria-live="polite">
            <SummaryCount label="Ready to launch" value={applicationSummary.readyToLaunch} tone="ready" />
            <SummaryCount label="Changes requested" value={applicationSummary.changesRequested} tone="warning" />
            <SummaryCount label="Analysis pending" value={applicationSummary.analysisPending} tone="pending" />
            <SummaryCount label="Changed since review" value={applicationSummary.changedSinceReview} tone="warning" />
            <SummaryCount label="Launch pending" value={applicationSummary.launchPending} tone="pending" />
            <SummaryCount label="Already launched" value={applicationSummary.alreadyLaunched} tone="complete" />
            <SummaryCount label="Unavailable" value={applicationSummary.unavailable} tone="muted" />
          </dl>
        ) : null}
        {applications.length === 0 ? (
          <section className={styles.emptyState}>
            <h2>No custom submissions yet</h2>
            <p>Build with an agent or submit the required files on GitHub.</p>
            <div className={styles.actions}>
              <a className="primary-button" href={BUILDER_SKILL_URL} target="_blank" rel="noreferrer">Build with an agent</a>
              <a className={styles.secondaryButton} href={SUBMISSION_REQUIREMENTS_URL} target="_blank" rel="noreferrer">Read GitHub application guide</a>
            </div>
          </section>
        ) : (
          <div className={styles.applicationList}>
            {applications.map((application) => (
              <ApplicationRow key={`${application.applicationHandle}:${application.revisionId}`} application={application} onOpen={() => void openApplication(application)} />
            ))}
          </div>
        )}
        <LiveMessage message={error} error />
      </CustomLaunchFrame>
    );
  }

  return (
    <CustomLaunchFrame onBack={returnToApplications} title={launchProgress === "complete" ? "Launch complete" : setupLoading && selected?.state === "ready_for_registration" ? "Final verification" : launchProgress === "idle" ? "Set up launch" : "Launch status"} eyebrow={selected?.repositoryFullName ?? "Approved project"}>
      {setupLoading || !selected ? (
        <div className={styles.loadingPanel} role="status"><LoaderCircle aria-hidden="true" className={styles.spin} size={20} /> {selected?.state === "ready_for_registration" ? "Completing final source verification" : "Loading approved launch"}</div>
      ) : !descriptor && launchProgress === "idle" ? (
        <section className={styles.loadingPanel}>
          <CircleAlert aria-hidden="true" size={20} />
          <div className={styles.recoveryCopy}>
            <h2>Launch setup could not load</h2>
            <p>{error || "The approved launch details are temporarily unavailable. Nothing was submitted."}</p>
            <button className={styles.secondaryButton} type="button" onClick={() => void openApplication(selected)}>Try again</button>
          </div>
        </section>
      ) : !descriptor ? (
        <section className={styles.loadingPanel} aria-live="polite">
          {launchProgress === "complete" ? <CircleCheck aria-hidden="true" size={20} /> : <LoaderCircle aria-hidden="true" className={styles.spin} size={20} />}
          <div className={styles.recoveryCopy}>
            <h2>{launchProgress === "complete" ? "Launch complete" : "Launch submitted"}</h2>
            <p>{statusMessage || "The approved transaction is being verified."}</p>
            {transactionHash ? <TransactionEvidence chainId={transactionChainId} transactionHash={transactionHash} /> : null}
            {launchProgress === "complete" ? <Link className={styles.secondaryButton} href="/explore?model=custom">View in Explore</Link> : <button className={styles.secondaryButton} type="button" onClick={returnToApplications}>View submissions</button>}
          </div>
          <LiveMessage message={error} error />
        </section>
      ) : (
        <form className={styles.setupSheet} aria-busy={launchProgress !== "idle"} aria-describedby={error ? "custom-launch-form-error" : undefined} onSubmit={launch}>
          <fieldset disabled={launchProgress !== "idle" || pendingGrantReissue !== null}>
            <section className={styles.formSection}>
              <div className={styles.sectionHeading}><span>01</span><div><h2>Project details</h2><p>These details describe the project. They cannot change the approved code.</p></div></div>
              <div className={styles.identityGrid}>
                <div className={styles.imageField}>
                  <span>Project image</span>
                  <button className={styles.imageButton} type="button" aria-label={presentation.image ? "Change project image" : "Choose project image"} onClick={() => imageInputRef.current?.click()}>
                    {isProgrammableTokenImageUrl(presentation.imagePreview) ? <Image src={getTokenCardImageSource(presentation.imagePreview)} alt="Project preview" width={150} height={150} unoptimized /> : <><ImagePlus aria-hidden="true" size={22} /><span>Choose image</span></>}
                  </button>
                  {presentation.image ? <button className={styles.removeImageButton} type="button" onClick={() => setPresentation((current) => ({ ...current, image: null, imagePreview: "" }))}>Remove image</button> : null}
                  <input ref={imageInputRef} className={styles.visuallyHidden} type="file" tabIndex={-1} aria-label="Choose project image" accept="image/png,image/jpeg,image/webp" onChange={(event) => void selectImage(event)} />
                </div>
                <div className={styles.fieldStack}>
                  <label><span>Short description</span><textarea value={presentation.description} maxLength={4096} onChange={(event) => setPresentation((current) => ({ ...current, description: event.target.value }))} placeholder="What does this project make possible?" /></label>
                  <div className={styles.linkGrid}>
                    <UrlField label="Website" value={presentation.website} onChange={(website) => setPresentation((current) => ({ ...current, website }))} placeholder="https://project.example" />
                    <UrlField label="Project docs" value={presentation.documentation} onChange={(documentation) => setPresentation((current) => ({ ...current, documentation }))} placeholder="https://docs.project.example" />
                    <UrlField label="X profile" value={presentation.x} onChange={(x) => setPresentation((current) => ({ ...current, x }))} placeholder="https://x.com/project" />
                  </div>
                  <details className={styles.moreLinks}>
                    <summary>More links</summary>
                    <div className={styles.linkGrid}>
                      <UrlField label="Telegram" value={presentation.telegram} onChange={(telegram) => setPresentation((current) => ({ ...current, telegram }))} placeholder="https://t.me/project" />
                      <UrlField label="Discord" value={presentation.discord} onChange={(discord) => setPresentation((current) => ({ ...current, discord }))} placeholder="https://discord.gg/project" />
                      <UrlField label="GitHub" value={presentation.github} onChange={(github) => setPresentation((current) => ({ ...current, github }))} placeholder="https://github.com/org/project" />
                      <UrlField label="Other" value={presentation.other} onChange={(other) => setPresentation((current) => ({ ...current, other }))} placeholder="https://project.example/community" />
                    </div>
                  </details>
                </div>
              </div>
            </section>

            {descriptor.configurationSchema.fields.length > 0 ? (
              <section className={styles.formSection}>
                <div className={styles.sectionHeading}><span>02</span><div><h2>Approved launch parameters</h2><p>Only fields allowed by the reviewed specification appear here.</p></div></div>
                <div className={styles.parameterGrid}>
                  {descriptor.configurationSchema.fields.map((field) => (
                    <ConfigurationField key={field.fieldId} field={field} value={configuration[field.fieldId] ?? ""} onChange={(value) => setConfiguration((current) => ({ ...current, [field.fieldId]: value }))} />
                  ))}
                </div>
              </section>
            ) : null}

            <section className={styles.formSection}>
              <div className={styles.sectionHeading}><span>{descriptor.configurationSchema.fields.length > 0 ? "03" : "02"}</span><div><h2>Review</h2><p>The wallet receives one transaction built from this exact approved version.</p></div></div>
              <dl className={styles.reviewList}>
                <div><dt>Source</dt><dd>{selected.repositoryFullName} · {selected.commitOid.slice(0, 9)}</dd></div>
                <div><dt>Network</dt><dd>{chainLabel(approvedRoute?.chainId)}</dd></div>
                <div><dt>Approved route</dt><dd>{approvedRoute?.launchRouteId}</dd></div>
                <div><dt>Native value</dt><dd>{formatNativeValue(approvedRoute?.chainId, approvedRoute?.transactionValuePolicy.valueWei)}</dd></div>
                <div><dt>Approval valid until</dt><dd>{formatDateTime(descriptor.validUntil)}</dd></div>
                <div><dt>Fee plan</dt><dd>{feeReview?.summary}</dd></div>
                <div><dt>Fee identity</dt><dd>{feeReview?.identity}</dd></div>
                <div><dt>Market path</dt><dd>{feeReview?.marketPath}</dd></div>
                <div>
                  <dt>Fee recipients</dt>
                  <dd>
                    {feeReview && feeReview.recipients.length > 0
                      ? feeReview.recipients.map(({ label, value }) => (
                          <span key={label}>{label}: <code title={value}>{value}</code><br /></span>
                        ))
                      : "None"}
                  </dd>
                </div>
                <div><dt>GitHub source identity</dt><dd>{githubUsername ? `@${githubUsername}` : "Verified GitHub account"}</dd></div>
                <div><dt>Wallet</dt><dd className={styles.reviewWallet}>{wallet ? <><span>{shortAddress(wallet.account)}</span><button type="button" onClick={openWallet}>Change wallet</button></> : "Connect an Ethereum wallet"}</dd></div>
              </dl>
            </section>
          </fieldset>

          <div className={styles.launchFooter}>
            <div className={styles.progressCopy} aria-live="polite">
              {launchProgress === "complete" ? <CircleCheck aria-hidden="true" size={18} /> : launchProgress !== "idle" ? <LoaderCircle aria-hidden="true" className={styles.spin} size={18} /> : <Check aria-hidden="true" size={18} />}
              <span>{statusMessage || "Exact approved commit ready"}</span>
            </div>
            {launchProgress === "complete" ? (
              <Link className="primary-button" href="/explore?model=custom">View in Explore <ArrowRight aria-hidden="true" size={16} /></Link>
            ) : pendingGrantReissue !== null ? (
              <button
                className="primary-button"
                type="button"
                disabled={launchProgress !== "idle"}
                onClick={() => void resumeGrantReissue()}
              >
                Check approval status
              </button>
            ) : (
              <button className="primary-button" type="submit" disabled={launchProgress !== "idle"}>
                {launchProgress !== "idle"
                  ? "Preparing launch"
                  : !wallet
                    ? "Connect wallet"
                    : "Confirm with wallet"}
              </button>
            )}
          </div>
          {transactionHash ? <TransactionEvidence chainId={transactionChainId || approvedRoute?.chainId || ""} transactionHash={transactionHash} /> : null}
          <LiveMessage id="custom-launch-form-error" message={error} error />
        </form>
      )}
    </CustomLaunchFrame>
  );
}

function CustomLaunchFrame({ children, eyebrow = "Custom Hook", onBack, title }: { children: ReactNode; eyebrow?: string; onBack: () => void; title: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <div className={`launch-page page-width ${launchExperience.formPage} ${styles.page}`} data-launch-model="custom">
      <header className="launch-page-heading">
        <button className="launch-model-back" type="button" onClick={onBack}><ArrowLeft aria-hidden="true" size={15} />Back</button>
        <div className={`launch-page-title ${launchExperience.formPageTitle}`}><span className={launchExperience.formModelName}>{eyebrow}</span><h1 ref={headingRef} tabIndex={-1}>{title}</h1></div>
      </header>
      {children}
    </div>
  );
}

function SummaryCount({
  label,
  tone,
  value,
}: {
  label: string;
  tone: CustomApplicationDisplayState["tone"];
  value: number;
}) {
  return (
    <div data-tone={tone}>
      <dd>{value}</dd>
      <dt>{label}</dt>
    </div>
  );
}

function ApplicationRow({ application, onOpen }: { application: PrincipalCustomLaunchApplicationSummaryV2; onOpen: () => void }) {
  const display = customApplicationDisplayStateV2(application);
  const githubUrl = `https://github.com/${application.repositoryFullName}/pull/${application.pullRequestNumber}`;
  const opensSetup = customApplicationOpensLaunchExperienceV2(application);
  const guidance = applicationGuidance(application);
  return (
    <article className={styles.applicationRow}>
      <div className={styles.applicationIdentity}><strong>{application.repositoryFullName.split("/").at(-1)}</strong><span>{application.repositoryFullName} · PR #{application.pullRequestNumber} · {application.commitOid.slice(0, 9)}</span></div>
      <div className={styles.applicationStatus} data-tone={display.tone}>{display.tone === "complete" || display.tone === "ready" ? <CircleCheck aria-hidden="true" size={17} /> : display.tone === "warning" ? <CircleAlert aria-hidden="true" size={17} /> : <Clock3 aria-hidden="true" size={17} />}<span><strong>{display.title}</strong><small>{formatObservedTime(application.updatedAt)}</small></span></div>
      {application.correctionPreview.length > 0 ? <ul className={styles.corrections}>{application.correctionPreview.slice(0, 3).map(({ correctionId, summary }) => <li key={correctionId}>{summary}</li>)}</ul> : null}
      {application.correctionPreview.length === 0 && guidance ? <p className={styles.guidance}>{guidance}</p> : null}
      {application.state === "launched" ? <Link className={styles.rowAction} href="/explore?model=custom">View in Explore<ArrowRight aria-hidden="true" size={15} /></Link> : opensSetup ? <button className={styles.rowAction} type="button" onClick={onOpen}>{display.action}<ArrowRight aria-hidden="true" size={15} /></button> : <a className={styles.rowAction} href={githubUrl} target="_blank" rel="noreferrer">{display.action}<ExternalLink aria-hidden="true" size={14} /></a>}
      <details className={styles.revisionDetails}>
        <summary>Exact submission revision</summary>
        <dl>
          <div><dt>Commit</dt><dd><code>{application.commitOid}</code></dd></div>
          <div><dt>Tree</dt><dd><code>{application.treeOid}</code></dd></div>
          <div><dt>Review receipt</dt><dd><code>{application.receiptDigest ?? "Not issued"}</code></dd></div>
          <div><dt>Launch entitlement</dt><dd><code>{application.launchEntitlementBindingHash ?? "Not issued"}</code></dd></div>
        </dl>
      </details>
    </article>
  );
}

function UrlField({ label, onChange, placeholder, value }: { label: string; onChange: (value: string) => void; placeholder: string; value: string }) {
  return <label><span>{label}</span><input type="url" inputMode="url" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

export function configurationControlForKind(
  kind: LaunchDescriptorV2["configurationSchema"]["fields"][number]["kind"],
): "text" | "textarea" | "url" {
  if (kind === "long-text") return "textarea";
  if (kind === "url" || kind === "image-url") return "url";
  return "text";
}

function ConfigurationField({
  field,
  onChange,
  value,
}: {
  field: LaunchDescriptorV2["configurationSchema"]["fields"][number];
  onChange: (value: string) => void;
  value: string;
}) {
  const control = configurationControlForKind(field.kind);
  return (
    <label>
      <span>{field.label}</span>
      {control === "textarea" ? (
        <textarea required={field.required} maxLength={field.maxLength} value={value} onChange={(event) => onChange(event.target.value)} />
      ) : (
        <input type={control} inputMode={control === "url" ? "url" : "text"} required={field.required} maxLength={field.maxLength} value={value} onChange={(event) => onChange(event.target.value)} />
      )}
    </label>
  );
}

function TransactionEvidence({ chainId, transactionHash }: { chainId: string; transactionHash: string }) {
  const explorer = transactionExplorerUrl(chainId, transactionHash);
  return (
    <p className={styles.transactionNote}>
      Transaction <code>{transactionHash}</code>{explorer ? <> · <a href={explorer} target="_blank" rel="noreferrer">View on explorer <ExternalLink aria-hidden="true" size={12} /></a></> : null}
    </p>
  );
}

function LiveMessage({ error = false, id, message }: { error?: boolean; id?: string; message: string }) {
  return <div id={id} className={styles.liveMessage} data-error={error ? "true" : "false"} role={error ? "alert" : "status"}>{message}</div>;
}

export function presentationFormFromResponse(response: PrincipalLaunchPresentationResponseV1 | null): PresentationForm {
  if (!response) return emptyPresentation;
  const draft = response.record.presentation;
  const consumed = new Set<number>();
  const link = (kind: LaunchPresentationDraftV1["links"][number]["kind"]) => {
    const index = draft.links.findIndex((entry, candidate) =>
      !consumed.has(candidate) && entry.kind === kind);
    if (index < 0) return "";
    consumed.add(index);
    return draft.links[index]!.uri;
  };
  return {
    description: draft.description,
    image: draft.image,
    imagePreview: draft.image?.uri ?? "",
    website: link("website"),
    documentation: link("documentation"),
    x: link("x"),
    telegram: link("telegram"),
    discord: link("discord"),
    github: link("github"),
    other: link("other"),
    preservedLinks: draft.links.filter((_, index) => !consumed.has(index)),
  };
}

export function buildPresentationDraftFromForm(
  form: PresentationForm,
): Readonly<{ draft: LaunchPresentationDraftV1 }> | Readonly<{ error: string }> {
  try {
    const links = [
      { kind: "website" as const, uri: normalizedUrl(form.website) },
      { kind: "documentation" as const, uri: normalizedUrl(form.documentation) },
      { kind: "x" as const, uri: normalizedUrl(form.x) },
      { kind: "telegram" as const, uri: normalizedUrl(form.telegram) },
      { kind: "discord" as const, uri: normalizedUrl(form.discord) },
      { kind: "github" as const, uri: normalizedUrl(form.github) },
      { kind: "other" as const, uri: normalizedUrl(form.other) },
      ...form.preservedLinks.map((link) => ({
        kind: link.kind,
        uri: normalizedUrl(link.uri),
      })),
    ].filter((link) => link.uri !== "");
    return {
      draft: {
        schemaVersion: "programmable.launch-presentation-draft.v1",
        description: form.description.normalize("NFC").trim(),
        image: form.image,
        links,
      },
    };
  } catch (caught) {
    return {
      error: caught instanceof Error
        ? caught.message
        : "Check the project links and try again",
    };
  }
}

function normalizedUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw new Error("Use complete HTTPS links without credentials");
  }
  return parsed.toString();
}

export function validateLaunchConfigurationV2(
  descriptor: LaunchDescriptorV2,
  values: Readonly<Record<string, string>>,
): string {
  for (const field of descriptor.configurationSchema.fields) {
    const value = (values[field.fieldId] ?? "").normalize("NFC");
    if (field.required && !value) return `Enter ${field.label.toLowerCase()}`;
    if ([...value].length > field.maxLength) return `Shorten ${field.label.toLowerCase()} to ${field.maxLength} characters or fewer`;
    if (new TextEncoder().encode(value).byteLength > field.maxLength) return `Shorten ${field.label.toLowerCase()} to ${field.maxLength} bytes or fewer`;
  }
  return "";
}

async function retryPreparation(
  client: ReturnType<typeof createCustomLaunchWebsiteClientV2>,
  request: Parameters<ReturnType<typeof createCustomLaunchWebsiteClientV2>["bindPreparation"]>[0],
  isActive: () => boolean,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isActive()) throw new LaunchFlowCancelledError();
    try {
      const preparation = await client.bindPreparation(request);
      if (!isActive()) throw new LaunchFlowCancelledError();
      return preparation;
    } catch (caught) {
      if (caught instanceof LaunchFlowCancelledError) throw caught;
      if (!(caught instanceof CustomLaunchWebsiteRequestErrorV2) || ![409, 425, 503].includes(caught.status)) throw caught;
      await delay(Math.min(1_000 + attempt * 250, 3_000));
    }
  }
  throw new Error("The approved launch is still preparing. Try again shortly");
}

async function pollLaunchStatus(
  client: ReturnType<typeof createCustomLaunchWebsiteClientV2>,
  input: Readonly<{
    applicationHandle: ApplicationHandleV3;
    applicationId: string;
    grantId: string;
    grantBindingHash: `sha256:${string}`;
    sessionId: string;
    permitId: `sha256:${string}`;
    executionReservationId: string;
    chainId?: string;
    launchRouteId?: string;
    launchTransactionId?: string;
    isActive: () => boolean;
    onPublishing: () => void;
  }>,
): Promise<Extract<LaunchExecutionStatusViewV2, { state: "finalized" }>> {
  for (let attempt = 0; attempt < STATUS_POLL_ATTEMPTS; attempt += 1) {
    if (!input.isActive()) throw new LaunchFlowCancelledError();
    let status: LaunchExecutionStatusViewV2;
    try {
      status = await client.launchExecutionStatus(input);
    } catch (caught) {
      if (
        caught instanceof CustomLaunchWebsiteRequestErrorV2
        && (caught.status === 429 || caught.status >= 500)
      ) {
        await delay(Math.min(STATUS_POLL_DELAY_MS + attempt * 250, 6_000));
        continue;
      }
      throw caught;
    }
    if (!input.isActive()) throw new LaunchFlowCancelledError();
    assertLaunchExecutionStatusBinding(status, input);
    if (status.state === "finalized") return status;
    if (status.state === "execution_unavailable") {
      throw new LaunchExecutionUnavailableError("This launch authorization is no longer available. Return to your submissions and verify the current version");
    }
    if (status.state === "broadcast") input.onPublishing();
    await delay(STATUS_POLL_DELAY_MS);
  }
  throw new Error("The transaction was submitted and is still being verified. Return to this launch to check its status");
}

export function assertLaunchExecutionStatusBinding(
  status: LaunchExecutionStatusViewV2,
  expected: Readonly<{
    applicationHandle: ApplicationHandleV3;
    applicationId: string;
    grantId: string;
    grantBindingHash: `sha256:${string}`;
    permitId: `sha256:${string}`;
    executionReservationId?: string;
    chainId?: string;
    launchRouteId?: string;
    launchTransactionId?: string;
  }>,
): void {
  if (
    status.applicationHandle !== expected.applicationHandle
    || status.applicationId !== expected.applicationId
    || status.grantId !== expected.grantId
    || status.grantBindingHash !== expected.grantBindingHash
    || (status.state !== "not_started" && status.permitId !== expected.permitId)
    || (status.state !== "not_started"
      && expected.executionReservationId !== undefined
      && status.executionReservationId !== expected.executionReservationId)
    || (status.state === "finalized"
      && expected.chainId !== undefined
      && status.chainId !== expected.chainId)
    || (status.state === "finalized"
      && expected.launchRouteId !== undefined
      && status.launchRouteId !== expected.launchRouteId)
    || (status.state === "finalized"
      && expected.launchTransactionId !== undefined
      && status.launchTransactionId.toLowerCase()
        !== expected.launchTransactionId.toLowerCase())
  ) {
    throw new LaunchBindingMismatchError("Launch verification returned a different approved identity and was stopped");
  }
}

function customLaunchErrorMessage(caught: unknown): string {
  if (caught instanceof LaunchExecutionUnavailableError) return caught.message;
  if (caught instanceof CustomLaunchWebsiteRequestErrorV2) {
    if (caught.code === "github_account_required") return "Link the GitHub account that opened the submission";
    if (caught.code === "LAUNCH_PRESENTATION_VERSION_CONFLICT") return "Project details changed in another window. Reload and try again";
    if (caught.status === 401) return "Your sign-in expired. Sign in with GitHub again";
    if (caught.status === 404) return "This exact submission is no longer available to this GitHub account";
    if (caught.status >= 500) return "Launch services are temporarily unavailable. Your approval has not been changed";
    return caught.publicMessage || "Unable to continue this launch";
  }
  return caught instanceof Error ? caught.message : "Unable to continue this launch";
}

function isPermanentGrantReissueFailure(caught: unknown): boolean {
  if (caught instanceof BrowserWalletGrantReissueBindingErrorV1) return true;
  return caught instanceof CustomLaunchWebsiteRequestErrorV2
    && caught.status >= 400
    && caught.status < 500
    && caught.status !== 408
    && caught.status !== 425
    && caught.status !== 429;
}

function idempotencyKey(scope: string): string {
  return `${scope}-${crypto.randomUUID()}`;
}

function formatObservedTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Status time unavailable";
  return `Updated ${new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date)}`;
}

function chainLabel(chainId?: string): string {
  if (chainId === "1") return "Ethereum";
  if (chainId === "11155111") return "Sepolia";
  return chainId ? `Chain ${chainId}` : "Approved chain";
}

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(date)
    : "Unavailable";
}

function formatNativeValue(chainId?: string, valueWei?: string): string {
  if (!valueWei || !/^\d+$/u.test(valueWei)) return "Unavailable";
  if (chainId === "1" || chainId === "11155111") {
    return `${formatEther(BigInt(valueWei))} ETH`;
  }
  return `${valueWei} wei`;
}

function transactionExplorerUrl(chainId: string, transactionHash: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(transactionHash)) return "";
  const origins: Record<string, string> = {
    "1": "https://etherscan.io",
    "56": "https://bscscan.com",
    "8453": "https://basescan.org",
    "42161": "https://arbiscan.io",
    "11155111": "https://sepolia.etherscan.io",
  };
  const origin = origins[chainId];
  return origin ? `${origin}/tx/${transactionHash}` : "";
}

function applicationGuidance(application: PrincipalCustomLaunchApplicationSummaryV2): string {
  if (application.intakeContract === "registry-v3") return "This legacy registry intake is catalog-only and cannot open a launch session.";
  if (application.state === "platform_pending") return "Platform verification is still running. Refresh this list shortly.";
  if (application.state === "approved") return "The review passed. Exact launch authority is still being issued.";
  if (application.state === "ready_for_registration" && !customApplicationOpensLaunchExperienceV2(application)) return "Exact launch authority is still being published. Refresh this list shortly.";
  if (application.state === "expired") return "This exact approval window ended. Follow the GitHub thread to renew or resubmit it.";
  if (application.state === "revoked") return "This exact version can no longer launch. The GitHub thread contains the recovery path.";
  if (application.state === "stale") return "The reviewed source tree changed. Submit or select the current exact revision.";
  if (application.state === "rejected") return "This exact revision was not approved. The GitHub decision contains the reason.";
  if (application.actionCodes.length > 0) return "The GitHub review contains the next required action.";
  if (application.reasonCodes.length > 0) return "The GitHub review contains more detail about this status.";
  return "";
}

function launchRecoveryStorageKey(
  githubPrincipalHash: `sha256:${string}`,
  applicationHandle: ApplicationHandleV3,
): string {
  return `programmable.custom-launch-session.v3:${githubPrincipalHash}:${applicationHandle}`;
}

export function requirePersistLaunchRecoveryV2(
  storage: Pick<Storage, "getItem" | "setItem">,
  key: string,
  recovery: PersistedLaunchRecoveryV2,
): void {
  const serialized = JSON.stringify(recovery);
  storage.setItem(key, serialized);
  const readBack = storage.getItem(key);
  if (readBack !== serialized || parsePersistedLaunchRecoveryV2(readBack) === null) {
    throw new Error("Launch recovery could not be verified");
  }
}

function requirePersistLaunchSession(
  githubPrincipalHash: `sha256:${string}`,
  applicationHandle: ApplicationHandleV3,
  recovery: PersistedLaunchRecoveryV2,
): void {
  if (
    recovery.githubPrincipalHash !== githubPrincipalHash
    || recovery.applicationHandle !== applicationHandle
  ) throw new LaunchBindingMismatchError("Launch recovery identity does not match");
  try {
    requirePersistLaunchRecoveryV2(
      window.localStorage,
      launchRecoveryStorageKey(githubPrincipalHash, applicationHandle),
      recovery,
    );
  } catch {
    throw new Error("Secure launch recovery is unavailable in this browser. No transaction was submitted");
  }
}

function readLaunchSession(
  githubPrincipalHash: `sha256:${string}`,
  applicationHandle: ApplicationHandleV3,
): LaunchRecoveryReadV2 {
  try {
    const value = window.localStorage.getItem(
      launchRecoveryStorageKey(githubPrincipalHash, applicationHandle),
    );
    if (value === null) return { kind: "absent" };
    const recovery = parsePersistedLaunchRecoveryV2(value);
    return recovery === null
      || recovery.githubPrincipalHash !== githubPrincipalHash
      || recovery.applicationHandle !== applicationHandle
      ? { kind: "unreadable" }
      : { kind: "valid", recovery };
  } catch {
    return { kind: "unreadable" };
  }
}

export function parsePersistedLaunchRecoveryV2(value: string | null): PersistedLaunchRecoveryV2 | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const stage = record.stage;
    const applicationHandle = record.applicationHandle;
    const githubPrincipalHash = record.githubPrincipalHash;
    const grantId = record.grantId;
    const grantBindingHash = record.grantBindingHash;
    const sessionId = record.sessionId;
    const permitId = record.permitId;
    const chainId = record.chainId;
    const executionReservationId = record.executionReservationId;
    const browserWalletActionHash = record.browserWalletActionHash;
    const reportIdempotencyKey = record.reportIdempotencyKey;
    const expiresAt = record.expiresAt;
    const reservedTransactionHash = record.reservedTransactionHash;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
    const commonKeys = [
      "stage", "applicationHandle", "githubPrincipalHash", "grantId",
      "grantBindingHash", "sessionId", "permitId", "chainId", "executionReservationId",
      "browserWalletActionHash", "reportIdempotencyKey", "expiresAt",
    ];
    const expectedKeys = stage === "prepared"
      ? [...commonKeys, "reservedTransactionHash"]
      : stage === "broadcast"
        ? [...commonKeys, "transactionHash"]
        : [];
    const actualKeys = Object.keys(record).sort();
    expectedKeys.sort();
    if (
      (stage !== "prepared" && stage !== "broadcast")
      || actualKeys.length !== expectedKeys.length
      || actualKeys.some((key, index) => key !== expectedKeys[index])
      || typeof applicationHandle !== "string"
      || !/^github-[0-9a-f]{64}$/u.test(applicationHandle)
      || typeof githubPrincipalHash !== "string"
      || !/^sha256:[0-9a-f]{64}$/u.test(githubPrincipalHash)
      || typeof grantId !== "string" || !uuid.test(grantId)
      || typeof grantBindingHash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(grantBindingHash)
      || typeof sessionId !== "string" || !uuid.test(sessionId)
      || typeof permitId !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(permitId)
      || typeof chainId !== "string" || !/^[1-9][0-9]{0,19}$/u.test(chainId)
      || typeof executionReservationId !== "string" || !uuid.test(executionReservationId)
      || typeof browserWalletActionHash !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(browserWalletActionHash)
      || typeof reportIdempotencyKey !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,255}$/u.test(reportIdempotencyKey)
      || typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt))
    ) return null;
    const common = {
      applicationHandle: applicationHandle as ApplicationHandleV3,
      githubPrincipalHash: githubPrincipalHash as `sha256:${string}`,
      grantId,
      grantBindingHash: grantBindingHash as `sha256:${string}`,
      sessionId,
      permitId: permitId as `sha256:${string}`,
      chainId,
      executionReservationId,
      browserWalletActionHash: browserWalletActionHash as `sha256:${string}`,
      reportIdempotencyKey,
      expiresAt,
    };
    if (stage === "prepared") {
      if (
        typeof reservedTransactionHash !== "string"
        || !/^0x0{64}$/u.test(reservedTransactionHash)
      ) return null;
      return {
        stage,
        ...common,
        reservedTransactionHash: reservedTransactionHash as `0x${string}`,
      };
    }
    const transactionHash = record.transactionHash;
    if (typeof transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/u.test(transactionHash)) return null;
    return {
      stage,
      ...common,
      transactionHash: transactionHash as `0x${string}`,
    };
  } catch {
    return null;
  }
}

export async function reportPersistedLaunchTransactionV2(
  client: Pick<ReturnType<typeof createCustomLaunchWebsiteClientV2>, "reportLaunchTransaction">,
  recovery: PersistedLaunchRecoveryV2,
): Promise<void> {
  if (recovery.stage !== "broadcast") return;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const acknowledgement = await client.reportLaunchTransaction({
        executionReservationId: recovery.executionReservationId,
        idempotencyKey: recovery.reportIdempotencyKey,
        request: {
          schemaVersion: "programmable.browser-wallet-launch-report-request.v2",
          transactionHash: recovery.transactionHash,
        },
      });
      if (
        acknowledgement.executionReservationId !== recovery.executionReservationId
        || acknowledgement.transactionHash.toLowerCase()
          !== recovery.transactionHash.toLowerCase()
      ) {
        throw new LaunchBindingMismatchError(
          "Launch report returned a different transaction identity and was stopped",
        );
      }
      return;
    } catch (caught) {
      if (
        attempt === 2
        || !(caught instanceof CustomLaunchWebsiteRequestErrorV2)
        || (caught.status !== 429 && caught.status < 500)
      ) throw caught;
      await delay(500 * (attempt + 1));
    }
  }
}

function clearLaunchSession(
  githubPrincipalHash: `sha256:${string}`,
  applicationHandle: ApplicationHandleV3,
) {
  try {
    window.localStorage.removeItem(
      launchRecoveryStorageKey(githubPrincipalHash, applicationHandle),
    );
  } catch {
    // No server authority depends on browser storage.
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds));
}
