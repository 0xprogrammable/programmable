"use client";

/**
 * @deprecated Retired GitHub-intake interface retained for compatibility tests
 * only. Custom launches are API-first through /developers/api-keys and this
 * module must not be imported into a production or development route.
 */

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
  Wallet,
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
  acquireCurrentCustomLaunchWebsiteSessionV2,
  assertCurrentCustomLaunchPrincipalV2,
  customApplicationHasDurableApprovalV2,
  customApplicationHasCurrentLaunchEntitlementV2,
  customLaunchApplicantRecoveryV2,
  customLaunchApplicantSessionBoundaryKeyV2,
  refreshCurrentCustomLaunchApplicantStageV2,
  runCustomLaunchApplicantReauthorizationV2,
  runCurrentCustomLaunchApplicantSequenceV2,
  CustomLaunchApplicantBoundaryGuardV2,
  CustomLaunchApplicantSingleFlightV2,
  type CustomLaunchApplicantRecoveryV2,
} from "@/lib/custom-launch/applicant-session-v2";
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
  parseSignedTokenImageUploadReceiptV1,
  tokenImageUploadReceiptMatchesV1,
  type SignedTokenImageUploadReceiptV1,
} from "@/lib/custom-launch/token-image-upload-receipt-v1";
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
  readTokenImageUploadResponse,
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
export type LaunchProgress =
  | "idle"
  | "preparing"
  | "wallet-proof"
  | "permit"
  | "wallet-transaction"
  | "reconciling"
  | "ambiguous"
  | "confirmation"
  | "publishing"
  | "complete";

export type CustomLaunchStageV1 =
  | "github"
  | "repositories"
  | "approval"
  | "prepare"
  | "wallet"
  | "registry";

export const CUSTOM_LAUNCH_STAGES_V1 = Object.freeze([
  { id: "github", label: "GitHub", detail: "Owner session" },
  { id: "repositories", label: "Repositories", detail: "Allowed source" },
  { id: "approval", label: "Approval", detail: "Exact revision" },
  { id: "prepare", label: "Prepare", detail: "Bound launch" },
  { id: "wallet", label: "Wallet", detail: "Browser submit" },
  { id: "registry", label: "Registry", detail: "Final public record" },
] as const satisfies readonly Readonly<{
  id: CustomLaunchStageV1;
  label: string;
  detail: string;
}>[]);

export function resolveCustomLaunchStageV1(input: Readonly<{
  screen: CustomLaunchScreen;
  applicationCount: number;
  launchProgress: LaunchProgress;
  exactRevisionVerified?: boolean;
  launchPrepared?: boolean;
  walletSubmissionVerified?: boolean;
}>): CustomLaunchStageV1 {
  if (input.screen === "intro") return "github";
  if (input.screen === "applications") {
    return input.applicationCount > 0 ? "approval" : "repositories";
  }
  if (!input.exactRevisionVerified) return "approval";
  if (!input.launchPrepared) return "prepare";
  if (!input.walletSubmissionVerified) return "wallet";
  return "registry";
}

export type CustomLaunchVerifiedThroughV1 =
  | "approval"
  | "prepare"
  | "wallet"
  | "registry"
  | null;

export function resolveCustomLaunchVerifiedStagesV1(input: Readonly<{
  githubPrincipalVerified: boolean;
  repositoriesLoaded: boolean;
  verifiedThrough: CustomLaunchVerifiedThroughV1;
}>): readonly CustomLaunchStageV1[] {
  if (!input.githubPrincipalVerified) return [];
  const verified: CustomLaunchStageV1[] = ["github"];
  if (!input.repositoriesLoaded) return verified;
  verified.push("repositories");
  if (input.verifiedThrough === null) return verified;
  const verifiedThroughIndex = CUSTOM_LAUNCH_STAGES_V1.findIndex(
    ({ id }) => id === input.verifiedThrough,
  );
  for (let index = 2; index <= verifiedThroughIndex; index += 1) {
    verified.push(CUSTOM_LAUNCH_STAGES_V1[index].id);
  }
  return verified;
}

export function customLaunchRailInvalidationForRecoveryV1(
  recovery: Exclude<CustomLaunchApplicantRecoveryV2, "none">,
): Readonly<{
  clearGithubPrincipal: boolean;
  clearRepositoriesLoaded: boolean;
  verifiedThrough: null;
}> {
  return Object.freeze({
    clearGithubPrincipal: recovery === "reconnect-github",
    clearRepositoriesLoaded: recovery === "reconnect-github",
    verifiedThrough: null,
  });
}

export type PreparedLaunchRecoveryV2 = Readonly<{
  stage: "prepared";
  walletRequestAttempted: false;
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

export type SubmissionUnknownLaunchRecoveryV2 = Readonly<{
  stage: "submission-unknown";
  walletRequestAttempted: true;
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

export type BroadcastLaunchRecoveryV2 = Readonly<{
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
  | SubmissionUnknownLaunchRecoveryV2
  | BroadcastLaunchRecoveryV2;

export function customLaunchSubmissionUnknownRecoveryV2(
  recovery: PreparedLaunchRecoveryV2,
): SubmissionUnknownLaunchRecoveryV2 {
  return Object.freeze({
    ...recovery,
    stage: "submission-unknown" as const,
    walletRequestAttempted: true as const,
  });
}

export function customLaunchPersistedRecoveryProgressV2(
  recovery: Pick<PersistedLaunchRecoveryV2, "stage">,
): Extract<LaunchProgress, "reconciling" | "ambiguous" | "confirmation"> {
  if (recovery.stage === "prepared") return "reconciling";
  return recovery.stage === "submission-unknown" ? "ambiguous" : "confirmation";
}

export function customLaunchRecoveryDisplayV2(
  launchProgress: LaunchProgress,
  statusMessage = "",
): Readonly<{ title: string; message: string; submitted: boolean | null }> {
  if (launchProgress === "complete") {
    return {
      title: "Launch complete",
      message: statusMessage || "The launched project is published.",
      submitted: true,
    };
  }
  if (launchProgress === "confirmation" || launchProgress === "publishing") {
    return {
      title: "Launch submitted",
      message: statusMessage || "The approved transaction is being verified.",
      submitted: true,
    };
  }
  if (launchProgress === "ambiguous" || launchProgress === "wallet-transaction") {
    return {
      title: "Submission status unknown",
      message: statusMessage
        || "Checking the reserved launch before another wallet action can start.",
      submitted: null,
    };
  }
  return {
    title: "Launch not submitted",
    message: statusMessage
      || "Checking the reserved launch before another wallet action can start.",
    submitted: false,
  };
}

export function customLaunchPendingActionLabelV1(
  launchProgress: LaunchProgress,
): string {
  const labels: Readonly<Record<LaunchProgress, string>> = {
    idle: "Confirm with wallet",
    preparing: "Preparing launch",
    "wallet-proof": "Confirm ownership in wallet",
    permit: "Verifying launch permit",
    "wallet-transaction": "Submit launch in wallet",
    reconciling: "Checking reserved launch",
    ambiguous: "Resolving submission status",
    confirmation: "Waiting for confirmation",
    publishing: "Publishing public record",
    complete: "Launch complete",
  };
  return labels[launchProgress];
}

export function customLaunchWalletMatchesChainV1(
  walletChainId: string | undefined,
  approvedChainId: string | undefined,
): boolean {
  if (
    !walletChainId
    || !approvedChainId
    || !/^[1-9][0-9]*$/u.test(approvedChainId)
  ) return false;
  const walletValue = walletChainId.startsWith("eip155:")
    ? walletChainId.slice("eip155:".length)
    : walletChainId;
  if (!/^(?:0x[0-9a-f]+|[1-9][0-9]*)$/iu.test(walletValue)) return false;
  try {
    return BigInt(walletValue) === BigInt(approvedChainId);
  } catch {
    return false;
  }
}

export function CustomLaunchRecoveryCopyV2({
  launchProgress,
  statusMessage,
}: Readonly<{
  launchProgress: LaunchProgress;
  statusMessage?: string;
}>) {
  const display = customLaunchRecoveryDisplayV2(
    launchProgress,
    statusMessage,
  );
  return (
    <>
      <h2>{display.title}</h2>
      <p>{display.message}</p>
    </>
  );
}

export type LaunchRecoveryReadV2 =
  | Readonly<{ kind: "absent" }>
  | Readonly<{ kind: "unreadable" }>
  | Readonly<{ kind: "valid"; recovery: PersistedLaunchRecoveryV2 }>;

export function customLaunchRecoveryBlocksNewSubmissionV2(
  recoveryRead: LaunchRecoveryReadV2,
): boolean {
  return recoveryRead.kind !== "absent";
}

type PendingGrantReissueV1 = Readonly<{
  oldDescriptor: LaunchDescriptorV2;
  idempotencyKey: string;
  expectedIdentity?: BrowserWalletGrantReissueIdentityV1;
}>;

class LaunchFlowCancelledError extends Error {}
export class LaunchExecutionUnavailableError extends Error {}
export class LaunchBindingMismatchError extends Error {}
export const LAUNCH_PREPARATION_REFRESH_REQUIRED_V1 =
  "launch_preparation_refresh_required" as const;

export class LaunchPreparationRefreshRequiredErrorV1 extends Error {
  readonly code = LAUNCH_PREPARATION_REFRESH_REQUIRED_V1;

  constructor() {
    super("Launch setup needs to be refreshed. Try again");
    this.name = "LaunchPreparationRefreshRequiredErrorV1";
  }
}

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
  imageUploadReceipt: SignedTokenImageUploadReceiptV1 | null;
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
  imageUploadReceipt: null,
};

export type CustomApplicationDisplayState = Readonly<{
  title: string;
  action: string;
  tone: "pending" | "warning" | "ready" | "complete" | "muted";
}>;

export function customApplicationDisplayState(
  state: CustomLaunchApplicationStateV2,
): CustomApplicationDisplayState {
  const values: Record<CustomLaunchApplicationStateV2, CustomApplicationDisplayState> = {
    received: { title: "Submission received", action: "View on GitHub", tone: "pending" },
    in_review: { title: "Review in progress", action: "View review", tone: "pending" },
    changes_required: { title: "Changes needed", action: "Open requested changes", tone: "warning" },
    platform_pending: { title: "Verification still running", action: "View on GitHub", tone: "pending" },
    ready_for_registration: { title: "Ready for final verification", action: "Finish verification", tone: "pending" },
    approved: { title: "Approved", action: "Set up launch", tone: "ready" },
    stale: { title: "Source changed", action: "View current source", tone: "warning" },
    rejected: { title: "Not approved", action: "View decision", tone: "warning" },
    superseded: { title: "New version submitted", action: "View current version", tone: "muted" },
    expired: { title: "Launch access expired", action: "View current status", tone: "warning" },
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
    || state === "approved"
    || state === "launching"
    || state === "launched";
}

export function customApplicationOpensLaunchExperienceV2(
  application: PrincipalCustomLaunchApplicationSummaryV2,
): boolean {
  if (!customApplicationIntakeIsLaunchableV2(application)) return false;
  if (application.state === "approved") {
    return customApplicationHasCurrentLaunchEntitlementV2(application);
  }
  return customApplicationOpensLaunchExperience(application.state);
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
    label: role === "programmable" ? "Programmable" : policy.providerId,
    value: recipient.value,
  })));
  return Object.freeze({
    summary: "Configured market path: 10 bps Programmable, additive",
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

export function customLaunchFixedTokenIdentityCopyV1(
  descriptor: LaunchDescriptorV2,
): string | null {
  const fieldIds = new Set(
    descriptor.configurationSchema.fields.map(({ fieldId }) => fieldId),
  );
  const tokenNameIsEditable = fieldIds.has("tokenName");
  const tokenSymbolIsEditable = fieldIds.has("tokenSymbol");
  if (tokenNameIsEditable && tokenSymbolIsEditable) return null;
  if (!tokenNameIsEditable && !tokenSymbolIsEditable) {
    return "Token identity is fixed by the approved source";
  }
  return tokenNameIsEditable
    ? "Token ticker is fixed by the approved source"
    : "Token name is fixed by the approved source";
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
    || application.state !== "approved"
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
  ) throw new LaunchPreparationRefreshRequiredErrorV1();
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

export function CustomLaunchExperience(runtimeProps: {
  onBack: () => void;
  trustedLaunchPermitSigners: readonly TrustedLaunchPermitSignerV2[];
}) {
  return <CustomLaunchRuntime {...runtimeProps} />;
}

function CustomLaunchRuntime({
  onBack,
  trustedLaunchPermitSigners,
}: {
  onBack: () => void;
  trustedLaunchPermitSigners: readonly TrustedLaunchPermitSignerV2[];
}) {
  const {
    authReady,
    authenticated,
    authorizeGithubLaunchApp,
    connectGithub,
    githubConnected,
    githubUserId,
    githubUsername,
    openWallet,
    refreshApplicantSession,
    reauthorizeGithub,
    sendBrowserWalletAction,
    signLaunchMessage,
    switchingNetwork,
    switchNetwork,
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
  const [imageUploading, setImageUploading] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [launchProgress, setLaunchProgress] = useState<LaunchProgress>("idle");
  const [verifiedThrough, setVerifiedThrough] =
    useState<CustomLaunchVerifiedThroughV1>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [transactionChainId, setTransactionChainId] = useState("");
  const [githubPrincipalHash, setGithubPrincipalHash] = useState<`sha256:${string}` | null>(null);
  const [pendingGrantReissue, setPendingGrantReissue] = useState<PendingGrantReissueV1 | null>(null);
  const [applicantRecovery, setApplicantRecovery] =
    useState<CustomLaunchApplicantRecoveryV2>("none");
  const [applicantReauthorizing, setApplicantReauthorizing] = useState(false);
  // Keep non-Hook derivation after all state Hooks so the React compiler can
  // continue recognizing every stable state setter in this large component.
  const sessionBoundaryKey = customLaunchApplicantSessionBoundaryKeyV2({
    authReady,
    authenticated,
    githubConnected,
    githubUserId,
    walletAccount: wallet?.account ?? null,
  });
  const imageSelectionGenerationRef = useRef(0);
  const imageUploadAbortControllerRef = useRef<AbortController | null>(null);
  const flowGenerationRef = useRef(0);
  const applicationsRequestGenerationRef = useRef(0);
  const applicationsAbortControllerRef = useRef<AbortController | null>(null);
  const flowAbortControllerRef = useRef<AbortController | null>(null);
  const launchSingleFlightRef = useRef(new CustomLaunchApplicantSingleFlightV2());
  const grantReissueSingleFlightRef = useRef(new BrowserWalletGrantReissueSingleFlightV1());
  const launchAuthorityRefreshSingleFlightRef = useRef(
    new LaunchAuthorityRefreshSingleFlightV1(),
  );
  const launchAuthorityRefreshAttemptRef = useRef(new Map<string, number>());
  const walletAccountRef = useRef(wallet?.account ?? null);
  const sessionBoundaryGuardRef = useRef(
    new CustomLaunchApplicantBoundaryGuardV2(sessionBoundaryKey),
  );
  const handledSessionBoundaryKeyRef = useRef(sessionBoundaryKey);

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
    imageSelectionGenerationRef.current += 1;
    imageUploadAbortControllerRef.current?.abort();
    imageUploadAbortControllerRef.current = null;
    setDescriptor(null);
    setConfiguration({});
    setPresentation(emptyPresentation);
    setPresentationVersion(0);
    setImageUploading(false);
    setSetupLoading(false);
    setLaunchProgress("idle");
    setVerifiedThrough(null);
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
    const requestBoundary = sessionBoundaryGuardRef.current.snapshot(sessionBoundaryKey);
    return acquireCurrentCustomLaunchWebsiteSessionV2({
      expectedGithubUserId: githubUserId,
      expectedGithubLogin: githubUsername,
      expectedWalletAccount: wallet?.account ?? "",
      refreshApplicantSession,
      isCurrent: () => sessionBoundaryGuardRef.current.isCurrent(requestBoundary),
    });
  }, [
    githubUserId,
    githubUsername,
    refreshApplicantSession,
    sessionBoundaryKey,
    wallet?.account,
  ]);

  const setApplicantFailure = useCallback((caught: unknown) => {
    setApplicantRecovery(customLaunchApplicantRecoveryForErrorV2(caught));
    setError(customLaunchErrorMessage(caught));
  }, []);

  const loadApplications = useCallback(async () => {
    if (!wallet || !githubConnected) return;
    applicationsAbortControllerRef.current?.abort();
    const controller = new AbortController();
    applicationsAbortControllerRef.current = controller;
    const requestGeneration = ++applicationsRequestGenerationRef.current;
    setApplicationsLoading(true);
    setApplicantRecovery("none");
    setError("");
    try {
      const client = createCustomLaunchWebsiteClientV2({ getSession });
      const page = await readAllPrincipalApplicationsV3(client, {
        signal: controller.signal,
      });
      if (requestGeneration !== applicationsRequestGenerationRef.current) return;
      setApplications(page.applications);
      setGithubPrincipalHash(page.githubPrincipalHash);
      setApplicationsLoaded(true);
      setApplicantRecovery("none");
      setScreen("applications");
    } catch (caught) {
      if (requestGeneration !== applicationsRequestGenerationRef.current) return;
      setApplicantFailure(caught);
    } finally {
      if (applicationsAbortControllerRef.current === controller) {
        applicationsAbortControllerRef.current = null;
      }
      if (requestGeneration === applicationsRequestGenerationRef.current) {
        setApplicationsLoading(false);
      }
    }
  }, [getSession, githubConnected, setApplicantFailure, wallet]);

  useEffect(() => {
    if (screen !== "intro" || !wallet || !githubConnected || applicationsLoaded) return;
    const timeout = window.setTimeout(() => void loadApplications(), 0);
    return () => window.clearTimeout(timeout);
  }, [applicationsLoaded, githubConnected, loadApplications, screen, wallet]);

  const commitSessionBoundary = (node: HTMLDivElement | null) => {
    if (node === null) return;
    if (!sessionBoundaryGuardRef.current.commit(sessionBoundaryKey)) return;
    walletAccountRef.current = wallet?.account ?? null;
    applicationsAbortControllerRef.current?.abort();
    applicationsAbortControllerRef.current = null;
    flowAbortControllerRef.current?.abort();
    flowAbortControllerRef.current = null;
    applicationsRequestGenerationRef.current += 1;
    flowGenerationRef.current += 1;
  };

  useEffect(() => {
    if (handledSessionBoundaryKeyRef.current === sessionBoundaryKey) return;
    handledSessionBoundaryKeyRef.current = sessionBoundaryKey;
    const recovery = wallet === null
      ? "connect-wallet"
      : !authenticated || !githubConnected
        ? "reconnect-github"
        : "none";
    const timeout = window.setTimeout(() => {
      setApplicationsLoading(false);
      setSetupLoading(false);
      setLaunchProgress((current) =>
        current === "reconciling"
          || current === "ambiguous"
          || current === "confirmation"
          || current === "publishing"
          ? current
          : "idle",
      );
      setApplicantRecovery(recovery);
      if (recovery !== "none") {
        const railInvalidation = customLaunchRailInvalidationForRecoveryV1(recovery);
        setVerifiedThrough(railInvalidation.verifiedThrough);
        if (railInvalidation.clearGithubPrincipal) {
          setGithubPrincipalHash(null);
        }
        if (railInvalidation.clearRepositoriesLoaded) {
          setApplicationsLoaded(false);
        }
        setError(recovery === "connect-wallet"
          ? "Connect your launch wallet to continue. Your last known approval stays visible"
          : "Reconnect GitHub to continue. Your last known approval stays visible");
        return;
      }

      setApplications([]);
      setApplicationsLoaded(false);
      setGithubPrincipalHash(null);
      setSelected(null);
      resetApplicationScopedState();
      setScreen("intro");
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [
    authenticated,
    githubConnected,
    resetApplicationScopedState,
    sessionBoundaryKey,
    wallet,
  ]);

  useEffect(() => () => {
    flowGenerationRef.current += 1;
    imageSelectionGenerationRef.current += 1;
    imageUploadAbortControllerRef.current?.abort();
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
      assertCurrentCustomLaunchPrincipalV2(
        githubPrincipalHash,
        principalApplications.githubPrincipalHash,
      );
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
      if (currentApplication.state === "ready_for_registration") {
        await delay(750);
        continue;
      }
      if (currentApplication.state !== "approved") {
        throw new LaunchAuthorityRefreshBindingErrorV1(
          "This exact GitHub version is no longer approved to launch",
        );
      }

      const [eligibility, launchDescriptor, currentPresentation] = await Promise.all([
        input.client.launchEligibility(currentApplication.applicationHandle, {
          signal: input.signal,
        }),
        input.client.launchDescriptor(currentApplication.applicationHandle, {
          signal: input.signal,
        }),
        input.client.launchPresentation(currentApplication.applicationHandle, {
          signal: input.signal,
        }).catch((caught) => {
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
    setApplicantRecovery("none");
    setScreen("setup");
    try {
      if (githubPrincipalHash === null) {
        throw new Error("Sign in again with the GitHub account that opened this submission");
      }
      const client = createCustomLaunchWebsiteClientV2({ getSession });
      if (generation !== flowGenerationRef.current) return;
      if (application.state === "launched") {
        clearLaunchSession(githubPrincipalHash, application.applicationHandle);
        setVerifiedThrough("registry");
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
        const recoveryProgress = recovery === null
          ? "confirmation"
          : customLaunchPersistedRecoveryProgressV2(recovery);
        setLaunchProgress(recoveryProgress);
        setVerifiedThrough(
          recovery?.stage === "broadcast"
            ? "wallet"
            : recovery?.stage === "submission-unknown"
              ? "prepare"
              : "approval",
        );
        setStatusMessage(
          recoveryProgress === "reconciling"
            ? "Launch not submitted. Checking the reserved launch before retrying"
            : recoveryProgress === "ambiguous"
              ? "Submission status unknown. Checking the reserved launch"
              : "Checking launch confirmation",
        );
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
          submissionWasAttempted: recovery.stage === "submission-unknown",
          ...(recovery.stage === "broadcast"
            ? { launchTransactionId: recovery.transactionHash }
            : {}),
          signal,
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
        setVerifiedThrough("registry");
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
      setVerifiedThrough("approval");
      setConfiguration(Object.fromEntries(
        setup.descriptor.configurationSchema.fields.map(({ fieldId }) => [fieldId, ""]),
      ));
      setPresentation(presentationFormFromResponse(setup.presentation));
      setPresentationVersion(setup.presentation?.version ?? 0);
      setApplicantRecovery("none");
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
      setApplicantFailure(caught);
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
    setApplicantFailure,
  ]);

  async function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selected || !descriptor) return;
    imageUploadAbortControllerRef.current?.abort();
    const imageController = new AbortController();
    imageUploadAbortControllerRef.current = imageController;
    const imageSelectionGeneration = ++imageSelectionGenerationRef.current;
    const generation = flowGenerationRef.current;
    const applicationHandle = selected.applicationHandle;
    const isCurrent = () => !imageController.signal.aborted
      && imageSelectionGeneration === imageSelectionGenerationRef.current
      && generation === flowGenerationRef.current
      && selected.applicationHandle === applicationHandle;
    setImageUploading(true);
    setApplicantRecovery("none");
    setError("");
    setStatusMessage("Preparing image");
    try {
      const image = await prepareTokenImage(file);
      if (!isCurrent()) return;
      const session = await getSession();
      if (!isCurrent()) return;
      const form = new FormData();
      form.append("file", new File([image], "custom-launch.webp", { type: "image/webp" }));
      form.append("receiptScope", canonicalBrowserJsonV2({
        applicationId: selected.applicationId,
        applicationHandle: selected.applicationHandle,
        grantId: descriptor.grantId,
        grantBindingHash: descriptor.grantBindingHash,
      }));
      const response = await fetch("/api/token-image", {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          "x-privy-identity-token": session.identityToken,
        },
        body: form,
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal: imageController.signal,
      });
      const body = await readTokenImageUploadResponse(response);
      if (body === null) throw new Error("Unable to upload image. Try again.");
      if (!isCurrent()) return;
      if (!response.ok) {
        throw new Error(typeof body.error === "string"
          ? body.error
          : "Unable to upload image");
      }
      if (typeof body.url !== "string" || !isProgrammableTokenImageUrl(body.url)) {
        throw new Error("Unable to verify the uploaded image");
      }
      const imageUrl = body.url;
      const contentSha256 = await fileSha256V2(
        new Uint8Array(await image.arrayBuffer()),
      );
      if (!isCurrent()) return;
      const imageUploadReceipt = parseSignedTokenImageUploadReceiptV1(body.receipt);
      if (!tokenImageUploadReceiptMatchesV1(imageUploadReceipt, {
        launchScope: {
          applicationId: selected.applicationId,
          applicationHandle: selected.applicationHandle,
          grantId: descriptor.grantId,
          grantBindingHash: descriptor.grantBindingHash,
        },
        uri: imageUrl,
        contentSha256,
        byteLength: image.size,
        width: TOKEN_IMAGE_OUTPUT_SIZE,
        height: TOKEN_IMAGE_OUTPUT_SIZE,
      })) throw new Error("Unable to verify the uploaded image");
      setPresentation((current) => ({
        ...current,
        imagePreview: imageUrl,
        imageUploadReceipt,
        image: {
          uri: imageUrl,
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
      setApplicantFailure(caught);
      setStatusMessage("");
    } finally {
      if (isCurrent()) {
        imageUploadAbortControllerRef.current = null;
        setImageUploading(false);
      }
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
    setStatusMessage("Refreshing launch preparation");
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
      setStatusMessage("Launch preparation is still refreshing. Check again shortly");
      return;
    }
    if (result.kind === "failed") {
      setPendingGrantReissue(null);
      setDescriptor(null);
      setVerifiedThrough(null);
      setLaunchProgress("idle");
      throw new Error("Launch preparation could not be refreshed. Check the GitHub review before trying again");
    }
    setStatusMessage("Checking the refreshed launch preparation");
    const [principalApplications, eligibility, freshDescriptor, currentPresentation] =
      await Promise.all([
        readAllPrincipalApplicationsV3(input.client, { signal: input.signal }),
        input.client.launchEligibility(input.application.applicationHandle, {
          signal: input.signal,
        }),
        input.client.launchDescriptor(input.application.applicationHandle, {
          signal: input.signal,
        }),
        input.client.launchPresentation(input.application.applicationHandle, {
          signal: input.signal,
        }).catch((caught) => {
          if (caught instanceof CustomLaunchWebsiteRequestErrorV2 && caught.status === 404) {
            return null;
          }
          throw caught;
        }),
      ]);
    if (!isActive()) throw new BrowserWalletGrantReissueCancelledV1();
    assertCurrentCustomLaunchPrincipalV2(
      githubPrincipalHash,
      principalApplications.githubPrincipalHash,
    );
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
    setVerifiedThrough("approval");
    setConfiguration((current) => Object.fromEntries(
      freshDescriptor.configurationSchema.fields.map(({ fieldId }) => [
        fieldId,
        current[fieldId] ?? "",
      ]),
    ));
    if (currentPresentation !== null) {
      setPresentation(presentationFormFromResponse(currentPresentation));
    } else {
      setPresentation((current) => ({
        ...current,
        image: null,
        imagePreview: "",
        imageUploadReceipt: null,
      }));
    }
    setPresentationVersion(currentPresentation?.version ?? 0);
    setPendingGrantReissue(null);
    setLaunchProgress("idle");
    setApplicantRecovery("none");
    setStatusMessage("Launch preparation refreshed. Review and confirm again");
  }, [githubPrincipalHash]);

  async function resumeGrantReissue() {
    if (!selected || !pendingGrantReissue || launchSingleFlightRef.current.active) return;
    const flowOwner = launchSingleFlightRef.current.acquire();
    if (flowOwner === null) return;
    const { generation, signal } = beginFlow();
    setApplicantRecovery("none");
    try {
      const client = createCustomLaunchWebsiteClientV2({ getSession });
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
        setVerifiedThrough(null);
      }
      setLaunchProgress("idle");
      setApplicantFailure(caught);
    } finally {
      launchSingleFlightRef.current.release(flowOwner);
    }
  }

  async function launch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !descriptor || pendingGrantReissue !== null) return;
    if (imageUploadAbortControllerRef.current !== null) {
      setError("Wait for the project image to finish preparing");
      return;
    }
    if (githubPrincipalHash === null) {
      setError("Sign in again with the GitHub account that opened this submission");
      return;
    }
    if (launchSingleFlightRef.current.active) return;
    setApplicantRecovery("none");
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
    if (customLaunchRecoveryBlocksNewSubmissionV2(recoveryRead)) {
      setError("An existing launch attempt must be resolved before another transaction can be submitted");
      return;
    }

    const flowOwner = launchSingleFlightRef.current.acquire();
    if (flowOwner === null) return;
    const { generation, signal } = beginFlow();
    const applicationId = selected.applicationId;
    const applicationHandle = selected.applicationHandle;
    const launchGithubPrincipalHash = githubPrincipalHash;
    const isActive = () => !signal.aborted
      && generation === flowGenerationRef.current;
    setLaunchProgress("preparing");
    setStatusMessage("Preparing approved launch");
    let activeDescriptor = descriptor;
    let broadcastRecovery: BroadcastLaunchRecoveryV2 | null = null;
    try {
      const client = createCustomLaunchWebsiteClientV2({ getSession });
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
          imageUploadReceipt: presentation.imageUploadReceipt,
        },
        idempotencyKey("presentation"),
        { signal },
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
      const route = defaultLaunchRoute(activeDescriptor);
      const sequence = await runCurrentCustomLaunchApplicantSequenceV2({
        refreshBoundary: async (stage) => {
          // Server calls refresh through the dynamic client. Only local wallet
          // effects need a second current-session proof at their exact edge.
          await refreshCurrentCustomLaunchApplicantStageV2({
            stage,
            refreshSession: getSession,
            assertCurrent: () => {
              if (!isActive()) throw new LaunchFlowCancelledError();
              assertLaunchWalletCurrent();
            },
          });
        },
        assertBoundary: () => {
          if (!isActive()) throw new LaunchFlowCancelledError();
          assertLaunchWalletCurrent();
        },
        createChallenge: async () => {
          const challenge = await client.createChallenge({
            schemaVersion: "programmable.launch-session-challenge-create-request.v2",
            audience: "programmable.launch-session.v2",
            idempotencyKey: idempotencyKey("challenge"),
            grantId: activeDescriptor.grantId,
            grantBindingHash: activeDescriptor.grantBindingHash,
            selection,
          }, { signal });
          if (
            challenge.grantId !== activeDescriptor.grantId
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(challenge.challengeId)
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(challenge.sessionId)
            || !/^sha256:[0-9a-f]{64}$/u.test(challenge.challengeBindingHash)
            || !Number.isFinite(Date.parse(challenge.expiresAt))
          ) throw new Error("Launch challenge does not match the exact approved launch");
          return challenge;
        },
        bindPreparation: async (challenge) => {
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
          }, isActive, signal);
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
          return preparation;
        },
        signLaunchMessage: async ({ preparation }) => {
          setLaunchProgress("wallet-proof");
          setStatusMessage("Confirm in your wallet");
          const signatureBase64Url = await signLaunchMessage(
            preparation.signingMessageBase64Url,
          );
          return {
            schemaVersion: "programmable.launch-wallet-proof-transport.v2" as const,
            signatureScheme: "eip191:personal-sign" as const,
            signatureBase64Url,
          };
        },
        authenticateWallet: async ({ challenge, preparation, walletProof }) => {
          const authenticatedSession = await client.authenticateWallet({
            schemaVersion: "programmable.launch-session-wallet-authenticate-http-request.v2",
            request: {
              schemaVersion: "programmable.launch-session-wallet-authenticate-request.v2",
              audience: "programmable.launch-session.v2",
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
            },
            walletProof,
          }, { signal });
          if (
            authenticatedSession.grantId !== activeDescriptor.grantId
            || authenticatedSession.challengeId !== challenge.challengeId
            || authenticatedSession.challengeBindingHash !== challenge.challengeBindingHash
            || authenticatedSession.sessionId !== challenge.sessionId
          ) throw new Error("Wallet authentication does not match the exact approved launch");
          return authenticatedSession;
        },
        authorizeLaunch: async ({ challenge, preparation, authentication }) => {
          setLaunchProgress("permit");
          setStatusMessage("Verifying launch permit");
          const authorizeRequest: AuthorizeLaunchSessionRequestV2 = {
            schemaVersion: "programmable.launch-session-launch-authorize-request.v2",
            audience: "programmable.launch-session.v2",
            idempotencyKey: idempotencyKey("authorization"),
            grantId: activeDescriptor.grantId,
            grantBindingHash: activeDescriptor.grantBindingHash,
            selection,
            challengeId: challenge.challengeId,
            challengeBindingHash: challenge.challengeBindingHash,
            sessionId: authentication.sessionId,
            sessionBindingHash: authentication.sessionBindingHash,
            preparationBindingHash: preparation.preparationBindingHash,
            launchArtifactCommitmentHash: preparation.launchArtifactCommitmentHash,
            launchArtifactManifestHash: preparation.launchArtifactManifestHash,
            launchArtifactOutputSetHash: preparation.launchArtifactOutputSetHash,
            deploymentCalldataHash: preparation.deploymentCalldataHash,
            permitRequestHash: authentication.permitRequestHash,
          };
          const permit = await client.authorizeLaunch(authorizeRequest, { signal });
          if (
            permit.grantId !== activeDescriptor.grantId
            || permit.sessionId !== authentication.sessionId
            || permit.sessionBindingHash !== authentication.sessionBindingHash
          ) throw new Error("Launch permit does not match the exact approved launch");
          const verifiedPermitSigner = await verifyAuthorizedLaunchPermitSignatureV2({
            permit,
            trustedSigners: trustedLaunchPermitSigners,
          });
          return { authorizeRequest, permit, verifiedPermitSigner };
        },
        createExecutionPreparation: async ({ preparation, authentication, authorization }) => {
          setStatusMessage("Preparing exact wallet transaction");
          const execution = await client.createExecutionPreparation({
            schemaVersion: "programmable.browser-wallet-launch-preparation-request.v2",
            request: authorization.authorizeRequest,
            authorizationArtifactBase64Url: authorization.permit.canonicalSignedPermitBase64Url,
          }, { signal });
          const trustedNow = await fetchTrustedTimeV1(
            authorization.verifiedPermitSigner,
          );
          assertLaunchPermitFreshnessV2({
            permit: authorization.permit,
            execution,
            trustedNow,
          });
          const action = assertBrowserWalletExecutionBinding({
            descriptor: activeDescriptor,
            execution,
            deploymentCalldataHash: preparation.deploymentCalldataHash,
            permit: authorization.permit,
            permitRequestHash: authentication.permitRequestHash,
            selection,
            wallet: launchWalletAccount,
            now: Date.parse(trustedNow),
          });
          const reportIdempotencyKey = idempotencyKey("transaction-report");
          const preparedRecovery: PreparedLaunchRecoveryV2 = {
            stage: "prepared",
            walletRequestAttempted: false,
            applicationHandle,
            githubPrincipalHash: launchGithubPrincipalHash,
            grantId: activeDescriptor.grantId,
            grantBindingHash: activeDescriptor.grantBindingHash,
            sessionId: authentication.sessionId,
            permitId: authorization.permit.permitId,
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
          setVerifiedThrough("prepare");
          return { execution, action, reportIdempotencyKey, preparedRecovery };
        },
        sendBrowserWalletAction: async ({ authentication, authorization, execution }) => {
          setLaunchProgress("wallet-transaction");
          setStatusMessage("Submit launch in your wallet");
          const transaction = execution.action.params[0];
          const submissionUnknownRecovery = customLaunchSubmissionUnknownRecoveryV2(
            execution.preparedRecovery,
          );
          // Persist ambiguity before invoking the wallet. If the provider loses
          // the response after a side effect, reload must never enable a resend.
          requirePersistLaunchSession(
            launchGithubPrincipalHash,
            applicationHandle,
            submissionUnknownRecovery,
          );
          const hash = await sendBrowserWalletAction({
            chainId: execution.action.chainId,
            from: transaction.from,
            to: transaction.to,
            data: transaction.data,
            value: transaction.value,
          });
          return {
            hash,
            reportRecovery: {
              stage: "broadcast" as const,
              applicationHandle,
              githubPrincipalHash: launchGithubPrincipalHash,
              grantId: activeDescriptor.grantId,
              grantBindingHash: activeDescriptor.grantBindingHash,
              sessionId: authentication.sessionId,
              permitId: authorization.permit.permitId,
              chainId: execution.action.chainId,
              executionReservationId: execution.execution.executionReservationId,
              browserWalletActionHash: execution.execution.browserWalletActionHash,
              reportIdempotencyKey: execution.reportIdempotencyKey,
              expiresAt: execution.execution.expiresAt,
              transactionHash: hash,
            } satisfies PersistedLaunchRecoveryV2,
          };
        },
      });
      const { authentication: authenticatedSession } = sequence;
      const { permit } = sequence.authorization;
      const { action, execution } = sequence.execution;
      const { hash, reportRecovery } = sequence.send;
      broadcastRecovery = reportRecovery;
      try {
        requirePersistLaunchSession(
          launchGithubPrincipalHash,
          applicationHandle,
          reportRecovery,
        );
      } catch {
        // The durable submission-unknown lock remains. Report immediately so
        // the server can recover the broadcast without permitting a resend.
      }
      if (isActive()) {
        setTransactionHash(hash);
        setTransactionChainId(action.chainId);
        setVerifiedThrough("wallet");
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
        signal,
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
      setVerifiedThrough("registry");
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
            client: createCustomLaunchWebsiteClientV2({ getSession }),
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
            setVerifiedThrough(null);
          }
        }
      }
      if (shouldClearLaunchRecoveryV2(failure)) {
        clearLaunchSession(launchGithubPrincipalHash, applicationHandle);
      }
      setApplicantFailure(failure);
      const recoveryReadAfterFailure = readLaunchSession(
        launchGithubPrincipalHash,
        applicationHandle,
      );
      if (broadcastRecovery !== null) {
        setTransactionHash(broadcastRecovery.transactionHash);
        setTransactionChainId(broadcastRecovery.chainId);
        setVerifiedThrough("wallet");
        setLaunchProgress("confirmation");
        setStatusMessage("Launch submitted. Check confirmation status");
      } else if (recoveryReadAfterFailure.kind === "valid") {
        const recoveryProgress = customLaunchPersistedRecoveryProgressV2(
          recoveryReadAfterFailure.recovery,
        );
        setLaunchProgress(recoveryProgress);
        setVerifiedThrough(
          recoveryReadAfterFailure.recovery.stage === "broadcast"
            ? "wallet"
            : recoveryReadAfterFailure.recovery.stage === "submission-unknown"
              ? "prepare"
              : "approval",
        );
        setStatusMessage(
          recoveryProgress === "reconciling"
            ? "Launch not submitted. Check the reserved launch before retrying"
            : recoveryProgress === "ambiguous"
              ? "Submission status unknown. Check the reserved launch before retrying"
              : "Launch submitted. Check confirmation status",
        );
      } else {
        setLaunchProgress((current) =>
          current === "confirmation" || current === "publishing" ? current : "idle",
        );
      }
    } finally {
      launchSingleFlightRef.current.release(flowOwner);
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

  const recoverApplicantAccess = async () => {
    if (applicantReauthorizing) return;
    if (applicantRecovery === "connect-wallet") {
      openWallet();
      return;
    }
    if (applicantRecovery === "authorize-github-app") {
      setError("");
      setApplicantReauthorizing(true);
      setStatusMessage("Reconnect GitHub to prove the current session");
      try {
        await authorizeGithubLaunchApp();
      } catch {
        setError("Unable to reconnect GitHub. Your last known approval stays visible");
        setStatusMessage("Wallet actions remain unavailable until GitHub reconnects");
        setApplicantRecovery("authorize-github-app");
      } finally {
        setApplicantReauthorizing(false);
      }
      return;
    }
    if (applicantRecovery === "reconnect-github") {
      setError("");
      if (!githubConnected) {
        setStatusMessage("Connect GitHub, then try again");
        connectGithub();
        return;
      }
      setApplicantReauthorizing(true);
      setStatusMessage("Reconnect GitHub to prove the current session");
      setApplicantRecovery("retry");
      try {
        await runCustomLaunchApplicantReauthorizationV2({
          reauthorizeGithub,
          refreshCurrent: async () => {
            setStatusMessage("GitHub reconnected. Refreshing your approved launch");
            if (screen === "setup" && selected !== null) {
              await openApplication(selected);
            } else {
              await loadApplications();
            }
          },
        });
      } catch {
        setError("Unable to reconnect GitHub. Your last known approval stays visible");
        setStatusMessage("Wallet actions remain unavailable until GitHub reconnects");
        setApplicantRecovery("reconnect-github");
      } finally {
        setApplicantReauthorizing(false);
      }
      return;
    }
    if (screen === "setup" && selected !== null) {
      void openApplication(selected);
      return;
    }
    void loadApplications();
  };

  const applicantRecoveryAction = applicantRecovery === "connect-wallet"
    ? "Connect wallet"
    : applicantRecovery === "reconnect-github"
      || applicantRecovery === "authorize-github-app"
      ? "Reconnect GitHub"
      : "Try again";

  const approvedRoute = descriptor ? defaultLaunchRoute(descriptor) : null;
  const fixedTokenIdentityCopy = descriptor
    ? customLaunchFixedTokenIdentityCopyV1(descriptor)
    : null;
  const feeReview = approvedRoute
    ? customLaunchFeeReviewV1(approvedRoute.feePolicy)
    : null;
  const durableApproval = selected !== null
    && customApplicationHasDurableApprovalV2(selected, null);
  const walletOnApprovedNetwork = wallet !== null
    && customLaunchWalletMatchesChainV1(
      wallet.chainId,
      approvedRoute?.chainId,
    );
  const switchApprovedNetwork = async () => {
    if (!approvedRoute || switchingNetwork) return;
    const requestBoundary = sessionBoundaryGuardRef.current.snapshot(sessionBoundaryKey);
    const requestGeneration = flowGenerationRef.current;
    setError("");
    setStatusMessage(`Switching to ${chainLabel(approvedRoute?.chainId)}`);
    const switched = await switchNetwork(approvedRoute?.chainId);
    if (!sessionBoundaryGuardRef.current.isCurrent(requestBoundary)
      || requestGeneration !== flowGenerationRef.current) return;
    if (switched) {
      setStatusMessage(`${chainLabel(approvedRoute?.chainId)} connected`);
      return;
    }
    setStatusMessage("");
    setError(`Unable to switch to ${chainLabel(approvedRoute?.chainId)}. Try again`);
  };
  const verifiedStages = resolveCustomLaunchVerifiedStagesV1({
    githubPrincipalVerified: githubPrincipalHash !== null,
    repositoriesLoaded: applicationsLoaded,
    verifiedThrough,
  });
  const currentStage = resolveCustomLaunchStageV1({
    screen,
    applicationCount: applications.length,
    launchProgress,
    exactRevisionVerified: verifiedStages.includes("approval"),
    launchPrepared: verifiedStages.includes("prepare"),
    walletSubmissionVerified: verifiedStages.includes("wallet"),
  });

  if (screen === "intro") {
    return (
      <CustomLaunchFrame
        boundaryRef={commitSessionBoundary}
        onBack={onBack}
        title="Launch an approved project"
        eyebrow="GitHub launch"
        stage={currentStage}
        verifiedStages={verifiedStages}
      >
        <div className={styles.introGrid}>
          <section className={styles.introPrimary}>
            <h2>Bring your project onchain.</h2>
            <p className={styles.introCopy}>
              Launch an approved version of your project. Connect GitHub and your wallet to find your submission and prepare the wallet steps.
            </p>
            <div className={styles.actions}>
              <a className={styles.secondaryButton} href={SUBMISSION_REQUIREMENTS_URL} target="_blank" rel="noreferrer">
                Read the application guide <ExternalLink aria-hidden="true" size={15} />
              </a>
              <a className={styles.textLink} href={BUILDER_SKILL_URL} target="_blank" rel="noreferrer">
                Prepare a project with your builder
              </a>
            </div>
          </section>
          <section className={styles.statusEntry}>
            <div className={styles.statusHeading}>
              <span className={styles.githubMark} aria-hidden="true">
                <GitHubBrandIcon />
              </span>
              <div>
                <span className={styles.instrumentLabel}>Owner access</span>
                <h2>{githubConnected ? "GitHub verified" : "Connect GitHub"}</h2>
              </div>
            </div>
            <div className={styles.identityStack}>
              <div className={styles.identityStatus} data-complete={githubConnected ? "true" : "false"}>
                <span>GitHub</span>
                <strong>{githubConnected ? `@${githubUsername}` : "Not connected"}</strong>
              </div>
              <div className={styles.identityStatus} data-complete={wallet ? "true" : "false"}>
                <span>Browser wallet</span>
                <strong>{wallet ? shortAddress(wallet.account) : "Not connected"}</strong>
              </div>
            </div>
            {githubConnected && wallet ? (
              <div className={styles.walletGate}>
                <div>
                  <span>Session bound to</span>
                  <code>{shortAddress(wallet.account)}</code>
                  <button type="button" onClick={openWallet}>Manage wallet</button>
                </div>
                <button
                  className={styles.githubButton}
                  type="button"
                  disabled={applicationsLoading || applicantReauthorizing}
                  onClick={applicantRecovery !== "none"
                    ? () => void recoverApplicantAccess()
                    : githubConnected
                      ? () => void loadApplications()
                      : connectGithub}
                >
                  {applicationsLoading ? <LoaderCircle aria-hidden="true" className={styles.spin} size={17} /> : <ArrowRight aria-hidden="true" size={17} />}
                  {applicantRecovery !== "none"
                    ? applicantRecoveryAction
                    : "Load allowed repositories"}
                </button>
              </div>
            ) : githubConnected ? (
              <button className={styles.githubButton} type="button" onClick={openWallet}>
                <Wallet aria-hidden="true" size={17} />
                Connect browser wallet
              </button>
            ) : (
              <button className={styles.githubButton} type="button" onClick={connectGithub}>
                <span className={styles.githubButtonMark} aria-hidden="true"><GitHubBrandIcon /></span>
                {authenticated ? "Link GitHub account" : "Continue with GitHub"}
              </button>
            )}
          </section>
        </div>
        <LiveMessage message={error || statusMessage} error={Boolean(error)} />
      </CustomLaunchFrame>
    );
  }

  if (screen === "applications") {
    return (
      <CustomLaunchFrame
        boundaryRef={commitSessionBoundary}
        onBack={onBack}
        title="Allowed repositories"
        eyebrow={githubUsername ? `GitHub · @${githubUsername}` : "GitHub"}
        stage={currentStage}
        verifiedStages={verifiedStages}
      >
        <div className={styles.listToolbar}>
          <p>Only revisions bound to your current GitHub identity appear here.</p>
          {applicantRecovery !== "none" ? (
            <button className={styles.secondaryButton} type="button" disabled={applicantReauthorizing} onClick={() => void recoverApplicantAccess()}>
              {applicantRecoveryAction}
            </button>
          ) : (
            <button className={styles.iconButton} type="button" aria-label="Refresh submissions" disabled={applicationsLoading} onClick={() => void loadApplications()}>
              <RefreshCw aria-hidden="true" className={applicationsLoading ? styles.spin : undefined} size={17} />
            </button>
          )}
        </div>
        {applications.length === 0 ? (
          <section className={styles.emptyState}>
            <span className={styles.instrumentLabel}>No allowed source yet</span>
            <h2>No approved repository is bound to this account.</h2>
            <p>Open a GitHub application, then return when an exact revision has been approved.</p>
            <div className={styles.actions}>
              <a className="primary-button" href={SUBMISSION_REQUIREMENTS_URL} target="_blank" rel="noreferrer">Open the application guide</a>
              <a className={styles.textLink} href={BUILDER_SKILL_URL} target="_blank" rel="noreferrer">Prepare a project with the builder</a>
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
    <CustomLaunchFrame
      boundaryRef={commitSessionBoundary}
      onBack={returnToApplications}
      title={launchProgress === "complete" ? "Public record confirmed" : setupLoading && selected?.state === "ready_for_registration" ? "Verify exact approval" : launchProgress === "idle" ? "Prepare launch" : "Verify launch"}
      eyebrow={selected?.repositoryFullName ?? "Approved project"}
      stage={currentStage}
      verifiedStages={verifiedStages}
      application={selected}
    >
      {setupLoading || !selected ? (
        <div className={styles.loadingPanel} role="status"><LoaderCircle aria-hidden="true" className={styles.spin} size={20} /> {selected?.state === "ready_for_registration" ? "Completing final source verification" : "Loading approved launch"}</div>
      ) : !descriptor && launchProgress === "idle" ? (
        <section className={styles.loadingPanel}>
          <CircleAlert aria-hidden="true" size={20} />
          <div className={styles.recoveryCopy}>
            <h2>{durableApproval ? "Approved for launch" : "Launch setup could not load"}</h2>
            <p>{error || "The approved launch details are temporarily unavailable. Nothing was submitted."}</p>
            <button className={styles.secondaryButton} type="button" disabled={applicantReauthorizing} onClick={() => void recoverApplicantAccess()}>{applicantRecoveryAction}</button>
          </div>
        </section>
      ) : !descriptor ? (
        <section className={styles.loadingPanel} aria-live="polite">
          {launchProgress === "complete" ? <CircleCheck aria-hidden="true" size={20} /> : launchProgress === "reconciling" || launchProgress === "ambiguous" ? <Clock3 aria-hidden="true" size={20} /> : <LoaderCircle aria-hidden="true" className={styles.spin} size={20} />}
          <div className={styles.recoveryCopy}>
            <CustomLaunchRecoveryCopyV2
              launchProgress={launchProgress}
              statusMessage={statusMessage}
            />
            {transactionHash ? <TransactionEvidence chainId={transactionChainId} transactionHash={transactionHash} /> : null}
            {launchProgress === "complete" ? (
              <Link className={styles.secondaryButton} href="/explore?model=custom">Open public record</Link>
            ) : applicantRecovery !== "none" ? (
              <button className={styles.secondaryButton} type="button" disabled={applicantReauthorizing} onClick={() => void recoverApplicantAccess()}>{applicantRecoveryAction}</button>
            ) : (launchProgress === "reconciling" || launchProgress === "ambiguous") && selected !== null ? (
              <button className={styles.secondaryButton} type="button" onClick={() => void openApplication(selected)}>Check reserved launch</button>
            ) : (
              <button className={styles.secondaryButton} type="button" onClick={returnToApplications}>View submissions</button>
            )}
          </div>
          <LiveMessage message={error} error />
        </section>
      ) : (
        <form className={styles.setupSheet} aria-busy={launchProgress !== "idle"} aria-describedby={error ? "custom-launch-form-error" : undefined} onSubmit={launch}>
          <fieldset aria-busy={imageUploading} disabled={launchProgress !== "idle" || imageUploading || pendingGrantReissue !== null || applicantRecovery !== "none"}>
            <section className={styles.formSection}>
              <div className={styles.sectionHeading}><span aria-hidden="true">01</span><div><h2>Project details</h2></div></div>
              <div className={styles.identityGrid}>
                <div className={styles.imageField}>
                  <span>Project image</span>
                  <label className={styles.imageButton} aria-busy={imageUploading}>
                    {imageUploading ? <><LoaderCircle aria-hidden="true" className={styles.spin} size={22} /><span>Preparing image</span></> : isProgrammableTokenImageUrl(presentation.imagePreview) ? <Image src={getTokenCardImageSource(presentation.imagePreview)} alt="Project image preview" width={150} height={150} unoptimized /> : <><ImagePlus aria-hidden="true" size={22} /><span>Choose image</span></>}
                    <input className={styles.visuallyHidden} type="file" aria-label={presentation.image ? "Change project image" : "Choose project image"} accept="image/png,image/jpeg,image/webp" onChange={(event) => void selectImage(event)} />
                  </label>
                  {presentation.image ? <button className={styles.removeImageButton} type="button" onClick={() => setPresentation((current) => ({ ...current, image: null, imagePreview: "", imageUploadReceipt: null }))}>Remove image</button> : null}
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

            <section className={styles.formSection}>
              <div className={styles.sectionHeading}><span aria-hidden="true">02</span><div><h2>Approved launch parameters</h2></div></div>
              {fixedTokenIdentityCopy ? (
                <dl className={styles.fixedParameterList}>
                  <div>
                    <dt>Token identity</dt>
                    <dd>{fixedTokenIdentityCopy}</dd>
                  </div>
                </dl>
              ) : null}
              {descriptor.configurationSchema.fields.length > 0 ? (
                <div className={styles.parameterGrid}>
                  {descriptor.configurationSchema.fields.map((field) => (
                    <ConfigurationField key={field.fieldId} field={field} value={configuration[field.fieldId] ?? ""} onChange={(value) => setConfiguration((current) => ({ ...current, [field.fieldId]: value }))} />
                  ))}
                </div>
              ) : null}
            </section>

            <section className={styles.formSection}>
              <div className={styles.sectionHeading}><span aria-hidden="true">03</span><div><h2>Review</h2></div></div>
              <dl className={styles.reviewList}>
                <div><dt>Source</dt><dd>{selected.repositoryFullName} · PR #{selected.pullRequestNumber}<br /><code translate="no">commit {selected.commitOid.slice(0, 12)} · tree {selected.treeOid.slice(0, 12)}</code></dd></div>
                <div><dt>Network</dt><dd>{chainLabel(approvedRoute?.chainId)}</dd></div>
                <div><dt>Approved route</dt><dd>{approvedRoute?.launchRouteId}</dd></div>
                <div><dt>Native value</dt><dd>{formatNativeValue(approvedRoute?.chainId, approvedRoute?.transactionValuePolicy.valueWei)}</dd></div>
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
                <div><dt>Wallet</dt><dd className={styles.reviewWallet}>{wallet ? <><span>{shortAddress(wallet.account)}</span><button type="button" onClick={openWallet}>Change wallet</button></> : "Connect an Ethereum wallet"}</dd></div>
              </dl>
            </section>
          </fieldset>

          <div className={styles.launchFooter}>
            <div className={styles.progressCopy} aria-live="polite">
              {launchProgress === "complete" ? <CircleCheck aria-hidden="true" size={18} /> : launchProgress !== "idle" ? <LoaderCircle aria-hidden="true" className={styles.spin} size={18} /> : <Check aria-hidden="true" size={18} />}
              <span>{statusMessage || (durableApproval ? "Approved for launch" : "Launch details verified")}</span>
            </div>
            {launchProgress === "complete" ? (
              <div className={styles.completionActions}>
                <Link className={styles.secondaryButton} href="/profile">View profile</Link>
                <Link className="primary-button" href="/explore?model=custom">Open public record <ArrowRight aria-hidden="true" size={16} /></Link>
              </div>
            ) : applicantRecovery !== "none" ? (
              <button className="primary-button" type="button" disabled={applicantReauthorizing} onClick={() => void recoverApplicantAccess()}>
                {applicantRecoveryAction}
              </button>
            ) : pendingGrantReissue !== null ? (
              <button
                className="primary-button"
                type="button"
                disabled={launchProgress !== "idle"}
                onClick={() => void resumeGrantReissue()}
              >
                Refresh launch setup
              </button>
            ) : launchProgress !== "idle" ? (
              <button className="primary-button" type="button" disabled>
                <LoaderCircle aria-hidden="true" className={styles.spin} size={17} />
                {customLaunchPendingActionLabelV1(launchProgress)}
              </button>
            ) : !wallet ? (
              <button className="primary-button" type="button" onClick={openWallet}>
                <Wallet aria-hidden="true" size={17} />
                Connect wallet
              </button>
            ) : !walletOnApprovedNetwork ? (
              <button
                className="primary-button"
                type="button"
                disabled={switchingNetwork}
                onClick={() => void switchApprovedNetwork()}
              >
                {switchingNetwork ? (
                  <LoaderCircle aria-hidden="true" className={styles.spin} size={17} />
                ) : null}
                {switchingNetwork
                  ? `Switching to ${chainLabel(approvedRoute?.chainId)}`
                  : `Switch to ${chainLabel(approvedRoute?.chainId)}`}
              </button>
            ) : (
              <button className="primary-button" type="submit" disabled={launchProgress !== "idle"}>
                Confirm with wallet
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

function LaunchFlowRail({
  stage,
  verifiedStages,
}: {
  stage: CustomLaunchStageV1;
  verifiedStages: readonly CustomLaunchStageV1[];
}) {
  return (
    <aside className={styles.flowRail} aria-labelledby="custom-launch-path-title">
      <div className={styles.flowRailHeading}>
        <h2 id="custom-launch-path-title">Launch steps</h2>
      </div>
      <ol className={styles.flowSteps}>
        {CUSTOM_LAUNCH_STAGES_V1.map((item, index) => {
          const verified = verifiedStages.includes(item.id);
          const current = item.id === stage;
          const state = verified ? "complete" : current ? "current" : "waiting";
          return (
            <li
              key={item.id}
              className={styles.flowStep}
              data-state={state}
              aria-current={current ? "step" : undefined}
            >
              <span className={styles.flowNode} aria-hidden="true">
                {verified ? "✓" : String(index + 1).padStart(2, "0")}
              </span>
              <span className={styles.flowStepCopy}>
                <strong>{item.label}</strong>
                <small>{item.detail}</small>
              </span>
              <span className={styles.flowState}>
                {verified ? "Verified" : current ? "Checking" : "Waiting"}
              </span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function ApprovalRevisionCard({
  application,
  local = false,
}: {
  application: PrincipalCustomLaunchApplicationSummaryV2;
  local?: boolean;
}) {
  const approved = application.state === "approved"
    || application.state === "launching"
    || application.state === "launched";
  return (
    <section className={styles.approvalAnchor} aria-label="Exact approved revision">
      <div className={styles.approvalAnchorLead}>
        <span className={styles.instrumentLabel}>{local ? "Local sample revision" : "Exact approved revision"}</span>
        <h2>{application.repositoryFullName}</h2>
        <p>GitHub PR #{application.pullRequestNumber}</p>
      </div>
      <dl className={styles.revisionFacts}>
        <div>
          <dt>Commit</dt>
          <dd><code translate="no">{application.commitOid}</code></dd>
        </div>
        <div>
          <dt>Tree</dt>
          <dd><code translate="no">{application.treeOid}</code></dd>
        </div>
      </dl>
      <span className={styles.approvalBadge} data-approved={approved ? "true" : "false"}>
        {approved ? "Approval bound" : "Approval pending"}
      </span>
    </section>
  );
}

export function CustomLaunchFrame({
  application = null,
  applicationIsLocal = false,
  boundaryRef,
  children,
  eyebrow = "Custom launch",
  onBack,
  stage,
  title,
  verifiedStages,
}: {
  application?: PrincipalCustomLaunchApplicationSummaryV2 | null;
  applicationIsLocal?: boolean;
  boundaryRef: (node: HTMLDivElement | null) => void;
  children: ReactNode;
  eyebrow?: string;
  onBack: () => void;
  stage: CustomLaunchStageV1;
  title: string;
  verifiedStages: readonly CustomLaunchStageV1[];
}) {
  return (
    <div ref={boundaryRef} className={`launch-page page-width ${launchExperience.formPage} ${styles.page}`} data-launch-model="custom" data-launch-stage={stage}>
      <header className="launch-page-heading">
        <button className="launch-model-back" type="button" onClick={onBack}><ArrowLeft aria-hidden="true" size={15} />Back</button>
        <div className={`launch-page-title ${launchExperience.formPageTitle}`}><span className={launchExperience.formModelName}>{eyebrow}</span><h1>{title}</h1></div>
      </header>
      <div className={styles.instrumentGrid}>
        <LaunchFlowRail stage={stage} verifiedStages={verifiedStages} />
        <div className={styles.instrumentWorkspace}>
          {application ? (
            <ApprovalRevisionCard
              application={application}
              local={applicationIsLocal}
            />
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}

function ApplicationRow({ application, onOpen }: { application: PrincipalCustomLaunchApplicationSummaryV2; onOpen: () => void }) {
  const display = application.intakeContract === "registry-v3"
    ? { title: "Catalog entry", action: "View on GitHub", tone: "muted" as const }
    : customApplicationHasDurableApprovalV2(application, null)
      ? { title: "Approved for launch", action: "Set up launch", tone: "ready" as const }
    : customApplicationDisplayState(application.state);
  const githubUrl = `https://github.com/${application.repositoryFullName}/pull/${application.pullRequestNumber}`;
  const opensSetup = customApplicationOpensLaunchExperienceV2(application);
  const guidance = applicationGuidance(application);
  return (
    <article className={styles.applicationRow}>
      <div className={styles.applicationIdentity}>
        <strong>{application.repositoryFullName.split("/").at(-1)}</strong>
        <span>{application.repositoryFullName} · PR #{application.pullRequestNumber}</span>
        <code translate="no">commit {application.commitOid.slice(0, 10)} · tree {application.treeOid.slice(0, 10)}</code>
      </div>
      <div className={styles.applicationStatus} data-tone={display.tone}>{display.tone === "complete" || display.tone === "ready" ? <CircleCheck aria-hidden="true" size={17} /> : display.tone === "warning" ? <CircleAlert aria-hidden="true" size={17} /> : <Clock3 aria-hidden="true" size={17} />}<span><strong>{display.title}</strong><small>{formatObservedTime(application.updatedAt)}</small></span></div>
      {application.correctionPreview.length > 0 ? <ul className={styles.corrections}>{application.correctionPreview.slice(0, 3).map(({ correctionId, summary }) => <li key={correctionId}>{summary}</li>)}</ul> : null}
      {application.correctionPreview.length === 0 && guidance ? <p className={styles.guidance}>{guidance}</p> : null}
      {application.state === "launched" ? <Link className={styles.rowAction} href="/explore?model=custom">View in Explore<ArrowRight aria-hidden="true" size={15} /></Link> : opensSetup ? <button className={styles.rowAction} type="button" onClick={onOpen}>{display.action}<ArrowRight aria-hidden="true" size={15} /></button> : <a className={styles.rowAction} href={githubUrl} target="_blank" rel="noreferrer">{display.action}<ExternalLink aria-hidden="true" size={14} /></a>}
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
    imageUploadReceipt: null,
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
  signal: AbortSignal,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!isActive()) throw new LaunchFlowCancelledError();
    try {
      const preparation = await client.bindPreparation(request, { signal });
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
    submissionWasAttempted?: boolean;
    signal?: AbortSignal;
    isActive: () => boolean;
    onPublishing: () => void;
  }>,
): Promise<Extract<LaunchExecutionStatusViewV2, { state: "finalized" }>> {
  let observedBroadcast = input.launchTransactionId !== undefined;
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
    if (status.state === "broadcast") {
      observedBroadcast = true;
      input.onPublishing();
    }
    await delay(STATUS_POLL_DELAY_MS);
  }
  throw new Error(observedBroadcast
    ? "The transaction was submitted and is still being verified. Return to this launch to check its status"
    : input.submissionWasAttempted
      ? "Submission status remains unknown. The reserved launch must be checked before another wallet action can start"
      : "Launch was not submitted. The reserved launch must be checked before another wallet action can start");
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

export function customLaunchErrorMessage(caught: unknown): string {
  if (caught instanceof LaunchExecutionUnavailableError) return caught.message;
  if (caught instanceof LaunchPreparationRefreshRequiredErrorV1) {
    return "Launch setup needs to be refreshed. Try again";
  }
  if (isInternalLaunchSetupVerificationErrorV1(caught)) {
    return "Launch setup could not be verified. Refresh and try again";
  }
  if (caught instanceof CustomLaunchWebsiteRequestErrorV2) {
    if (
      caught.code === "LAUNCH_PREPARATION_REISSUE_REQUIRED"
      || caught.code === LAUNCH_PREPARATION_REFRESH_REQUIRED_V1
    ) return "Launch setup needs to be refreshed. Try again";
    if (caught.code === "github_account_required") return "Reconnect the GitHub account that opened the submission";
    if (caught.code === "LAUNCH_PRESENTATION_VERSION_CONFLICT") return "Project details changed in another window. Reload and try again";
    if (caught.status === 401) return "Reconnect GitHub to continue. Your last known approval stays visible";
    if (caught.status === 403) {
      return containsInternalLaunchSetupVerificationTermsV1(caught)
        ? "This launch is not currently available"
        : caught.publicMessage || "This launch is not currently available";
    }
    if (caught.status === 404) return "Reconnect the GitHub account that opened this submission";
    if ([408, 425, 429].includes(caught.status) || caught.status >= 500) return "Launch services are temporarily unavailable. Your last known approval stays visible";
    if (containsInternalLaunchSetupVerificationTermsV1(caught)) {
      return "Launch setup could not be verified. Refresh and try again";
    }
    return caught.publicMessage || "Unable to continue this launch";
  }
  return caught instanceof Error ? caught.message : "Unable to continue this launch";
}

export function customLaunchApplicantRecoveryForErrorV2(
  caught: unknown,
): CustomLaunchApplicantRecoveryV2 {
  if (
    caught instanceof LaunchPreparationRefreshRequiredErrorV1
    || isInternalLaunchSetupVerificationErrorV1(caught)
  ) return "retry";
  return customLaunchApplicantRecoveryV2(caught);
}

function isInternalLaunchSetupVerificationErrorV1(caught: unknown): boolean {
  return caught instanceof Error
    && !(caught instanceof CustomLaunchWebsiteRequestErrorV2)
    && containsInternalLaunchSetupVerificationTermsV1(caught);
}

function containsInternalLaunchSetupVerificationTermsV1(caught: Error): boolean {
  return /(?:\blaunch permit\b|\bsigned launch permit\b|\bpermit signature\b|\bpermit signer\b|\bed25519 permit\b)/iu
    .test(caught.message);
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
  if (application.state === "ready_for_registration") return "The review passed and final registry checks are still completing.";
  if (application.state === "expired") return "This launch access is no longer current. Check the GitHub review for the latest status.";
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
    const walletRequestAttempted = record.walletRequestAttempted;
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
    const legacyPrepared = stage === "prepared"
      && walletRequestAttempted === undefined;
    const expectedKeys = stage === "prepared" || stage === "submission-unknown"
      ? [
          ...commonKeys,
          "reservedTransactionHash",
          ...(legacyPrepared ? [] : ["walletRequestAttempted"]),
        ]
      : stage === "broadcast"
        ? [...commonKeys, "transactionHash"]
        : [];
    const actualKeys = Object.keys(record).sort();
    expectedKeys.sort();
    if (
      (stage !== "prepared" && stage !== "submission-unknown" && stage !== "broadcast")
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
      || (stage === "prepared" && !legacyPrepared && walletRequestAttempted !== false)
      || (stage === "submission-unknown" && walletRequestAttempted !== true)
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
    if (stage === "prepared" || stage === "submission-unknown") {
      if (
        typeof reservedTransactionHash !== "string"
        || !/^0x0{64}$/u.test(reservedTransactionHash)
      ) return null;
      if (stage === "submission-unknown" || legacyPrepared) {
        return {
          stage: "submission-unknown",
          walletRequestAttempted: true,
          ...common,
          reservedTransactionHash: reservedTransactionHash as `0x${string}`,
        };
      }
      return {
        stage: "prepared",
        walletRequestAttempted: false,
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
