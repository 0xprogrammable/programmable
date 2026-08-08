const DIGEST_V2 = /^sha256:[0-9a-f]{64}$/u;
const HEX_DATA_V2 = /^0x(?:[0-9a-f]{2})+$/u;
const ADDRESS_V2 = /^0x[0-9a-f]{40}$/u;
const UUID_V2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const POSITIVE_DECIMAL_V2 = /^[1-9][0-9]{0,77}$/u;
const GITHUB_USER_ID_V2 = /^[1-9][0-9]{0,19}$/u;
const UNSIGNED_DECIMAL_V2 = /^(?:0|[1-9][0-9]{0,77})$/u;
const GIT_OID_V2 = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const BASE64URL_V2 = /^[A-Za-z0-9_-]+$/u;
const LIST_CURSOR_V3 = /^[A-Za-z0-9_-]{16,512}$/u;
const APPLICATION_ID_V3 = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const APPLICATION_HANDLE_V3 = /^github-[0-9a-f]{64}$/u;
const FEE_ID_V1 = /^[a-z0-9][a-z0-9._:-]{0,127}$/u;
const SEMVER_V1 = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const EVM_ADDRESS_V1 = /^0x[0-9A-Fa-f]{40}$/u;
const ZERO_ADDRESS_V1 = "0x0000000000000000000000000000000000000000";
const PROGRAMMABLE_FEE_RECIPIENT_V1 =
  "0x4957f49620AFf3Adbbe8195a4f633E49cc93376c";

type JsonRecordV2 = Record<string, unknown>;
type ValidatorV2 = (value: unknown) => void;

export function parseCustomLaunchApiResponseV2<T>(
  value: unknown,
  schemaVersion: string,
): T {
  const validator = RESPONSE_VALIDATORS_V2[schemaVersion];
  if (validator === undefined) throw new Error("Unsupported custom launch response schema");
  validator(value);
  return value as T;
}

export function parseCustomLaunchApiErrorV2(value: unknown): Readonly<{
  schemaVersion: "programmable.custom-launch-website-error.v2";
  code: string;
  message: string;
}> {
  const record = exactRecord(value, ["schemaVersion", "code", "message"]);
  literal(record.schemaVersion, "programmable.custom-launch-website-error.v2");
  boundedString(record.code, 1, 128);
  boundedString(record.message, 1, 2_048);
  return record as ReturnType<typeof parseCustomLaunchApiErrorV2>;
}

const RESPONSE_VALIDATORS_V2: Readonly<Record<string, ValidatorV2>> = Object.freeze({
  "programmable.application-status-view.v2": validateApplicationStatusV2,
  "programmable.principal-custom-launch-application-list.v3": validateApplicationListV2,
  "programmable.launch-eligibility-view.v3": validateLaunchEligibilityV2,
  "programmable.principal-launch-authority-refresh.v1": validateLaunchAuthorityRefreshV1,
  "programmable.launch-route-discovery.v3": validateLaunchDescriptorV2,
  "programmable.principal-launch-presentation-response.v2": validatePresentationResponseV1,
  "programmable.launch-execution-status-view.v3": validateExecutionStatusV2,
  "programmable.launch-session-challenge-view.v2": validateChallengeV2,
  "programmable.launch-session-preparation-view.v2": validatePreparationV2,
  "programmable.authenticated-launch-session-view.v2": validateAuthenticatedSessionV2,
  "programmable.authorized-launch-permit-view.v2": validateAuthorizedPermitV2,
  "programmable.browser-wallet-launch-preparation.v2": validateBrowserPreparationV2,
  "programmable.browser-wallet-grant-reissue.v2": validateGrantReissueV1,
  "programmable.browser-wallet-launch-report-ack.v2": validateLaunchReportAckV2,
  "programmable.custom-launch-project-view.v2": validateProjectViewV2,
  "programmable.custom-launch-wallet-profile.v2": validateProfileViewV2,
});

function validateApplicationStatusV2(value: unknown): void {
  const record = exactRecord(value, [
    "schemaVersion", "applicationId", "applicationHandle", "revisionId", "state", "decision",
    "approvalClass", "launchAllowed", "reasonCodes", "actionCodes", "receiptDigest",
    "updatedAt",
  ]);
  literal(record.schemaVersion, "programmable.application-status-view.v2");
  applicationV3Id(record.applicationId);
  applicationHandle(record.applicationHandle);
  nullable(record.revisionId, identifier);
  enumValue(record.state, [
    "received", "queued", "analyzing", "action_required", "analysis_pending",
    "approved", "blocked_unsafe", "withdrawn", "revoked",
  ]);
  nullable(record.decision, (candidate) => enumValue(candidate, [
    "approved", "action_required", "analysis_pending", "blocked_unsafe",
  ]));
  nullable(record.approvalClass, (candidate) => enumValue(candidate, [
    "verified", "conditional", "disclosed",
  ]));
  literal(record.launchAllowed, false);
  stringArray(record.reasonCodes, 512, 128);
  stringArray(record.actionCodes, 512, 128);
  nullable(record.receiptDigest, boundedString);
  instant(record.updatedAt);
}

function validateApplicationListV2(value: unknown): void {
  const record = exactRecord(value, [
    "schemaVersion", "subject", "applications", "nextCursor",
  ]);
  literal(record.schemaVersion, "programmable.principal-custom-launch-application-list.v3");
  const subject = exactRecord(record.subject, [
    "provider", "githubUserId", "githubPrincipalHash",
  ]);
  literal(subject.provider, "github");
  regexString(subject.githubUserId, GITHUB_USER_ID_V2, 20);
  digest(subject.githubPrincipalHash);
  const applications = arrayOf(record.applications, validateApplicationSummaryV2, 1_000);
  const handles = applications.map((candidate) => (candidate as JsonRecordV2).applicationHandle);
  if (new Set(handles).size !== handles.length) mismatch();
  nullable(record.nextCursor, (candidate) => regexString(candidate, LIST_CURSOR_V3, 512));
}

function validateApplicationSummaryV2(value: unknown): void {
  const record = exactRecordWithOptional(value, [
    "applicationId", "applicationHandle", "revisionId", "repositoryId", "repositoryOwnerId",
    "repositoryFullName", "pullRequestNumber", "commitOid", "treeOid", "state", "reasonCodes", "actionCodes",
    "correctionCount", "correctionPreview", "receiptDigest",
    "launchEntitlementBindingHash", "updatedAt",
  ], [
    "intakeContract", "providerId", "controlRepositoryId", "controlRepositoryOwnerId",
    "grandfatheredAtReleaseBindingDigest",
  ]);
  applicationHandle(record.applicationHandle);
  identifier(record.revisionId);
  positiveDecimal(record.repositoryId);
  positiveDecimal(record.repositoryOwnerId);
  boundedString(record.repositoryFullName, 3, 256);
  safeInteger(record.pullRequestNumber, 1);
  regexString(record.commitOid, GIT_OID_V2, 64);
  regexString(record.treeOid, GIT_OID_V2, 64);
  enumValue(record.state, [
    "received", "in_review", "changes_required", "platform_pending",
    "ready_for_registration", "approved", "stale", "rejected", "superseded", "expired", "revoked",
    "launching", "launched",
  ]);
  stringArray(record.reasonCodes, 512, 128);
  stringArray(record.actionCodes, 512, 128);
  safeInteger(record.correctionCount, 0);
  const corrections = arrayOf(record.correctionPreview, (candidate) => {
    const correction = exactRecord(candidate, ["correctionId", "summary"]);
    identifier(correction.correctionId);
    boundedString(correction.summary, 1, 2_048);
  }, 100);
  if (corrections.length > Number(record.correctionCount)) mismatch();
  nullable(record.receiptDigest, digest);
  nullable(record.launchEntitlementBindingHash, digest);
  const hasCompatibilityField = record.controlRepositoryId !== undefined
    || record.controlRepositoryOwnerId !== undefined
    || record.providerId !== undefined
    || record.grandfatheredAtReleaseBindingDigest !== undefined;
  if (record.intakeContract === undefined) {
    legacyV2ApplicationId(record.applicationId);
    if (hasCompatibilityField) mismatch();
  } else if (record.intakeContract === "aeon-v1") {
    applicationV3Id(record.applicationId);
    if (record.providerId !== "aeon"
      || record.controlRepositoryId !== "1325324453"
      || record.controlRepositoryOwnerId !== "309941960"
      || (record.grandfatheredAtReleaseBindingDigest !== undefined
        && record.grandfatheredAtReleaseBindingDigest !== null)) mismatch();
  } else if (record.intakeContract === "registry-v3") {
    applicationV3Id(record.applicationId);
    if ((record.providerId !== undefined && record.providerId !== "programmable-registry")
      || record.controlRepositoryId !== "1320171831"
      || (record.controlRepositoryOwnerId !== undefined
        && record.controlRepositoryOwnerId !== "309941960")
      || (record.grandfatheredAtReleaseBindingDigest !== undefined
        && record.grandfatheredAtReleaseBindingDigest !== null)) mismatch();
  } else if (record.intakeContract === "legacy-v2") {
    legacyV2ApplicationId(record.applicationId);
    if (record.providerId !== undefined) mismatch();
    positiveDecimal(record.controlRepositoryId);
    if (record.controlRepositoryId === "1320171831") mismatch();
    if (record.controlRepositoryOwnerId !== undefined) {
      positiveDecimal(record.controlRepositoryOwnerId);
    }
    if (record.grandfatheredAtReleaseBindingDigest !== undefined) {
      nullable(record.grandfatheredAtReleaseBindingDigest, digest);
    }
  } else {
    mismatch();
  }
  instant(record.updatedAt);
}

function validateLaunchEligibilityV2(value: unknown): void {
  const record = exactRecord(value, [
    "schemaVersion", "applicationId", "applicationHandle", "grantId", "grantBindingHash",
    "state", "launchAllowed", "receiptDigest", "validFrom", "validUntil",
  ]);
  literal(record.schemaVersion, "programmable.launch-eligibility-view.v3");
  applicationV3Id(record.applicationId);
  applicationHandle(record.applicationHandle);
  uuid(record.grantId);
  digest(record.grantBindingHash);
  enumValue(record.state, ["pending", "active", "suspended", "revoked", "expired"]);
  booleanValue(record.launchAllowed);
  digest(record.receiptDigest);
  const validFrom = instant(record.validFrom);
  const validUntil = instant(record.validUntil);
  if (validFrom >= validUntil || (record.launchAllowed === true) !== (record.state === "active")) {
    mismatch();
  }
}

function validateLaunchAuthorityRefreshV1(value: unknown): void {
  const record = exactRecord(value, [
    "schemaVersion", "state", "requestId", "requestDigest", "applicationId",
    "applicationHandle", "grantId", "grantBindingHash", "requestedAt",
    "observationHash", "validUntil",
  ]);
  literal(record.schemaVersion, "programmable.principal-launch-authority-refresh.v1");
  enumValue(record.state, ["pending", "current", "failed"]);
  digest(record.requestId);
  digest(record.requestDigest);
  applicationV3Id(record.applicationId);
  applicationHandle(record.applicationHandle);
  uuid(record.grantId);
  digest(record.grantBindingHash);
  const requestedAt = instant(record.requestedAt);
  nullable(record.observationHash, digest);
  nullable(record.validUntil, instant);
  const isCurrent = record.state === "current";
  if (
    record.requestId !== record.requestDigest
    || (record.observationHash !== null) !== isCurrent
    || (record.validUntil !== null) !== isCurrent
    || (isCurrent && Date.parse(record.validUntil as string) <= requestedAt)
  ) mismatch();
}

function validateLaunchDescriptorV2(value: unknown): void {
  const record = exactRecord(value, [
    "schemaVersion", "applicationId", "applicationHandle", "grantId", "grantBindingHash", "descriptorHash",
    "validUntil", "configurationSchema", "routes", "defaultChoiceId",
  ]);
  literal(record.schemaVersion, "programmable.launch-route-discovery.v3");
  applicationV3Id(record.applicationId);
  applicationHandle(record.applicationHandle);
  identifier(record.grantId);
  digest(record.grantBindingHash);
  digest(record.descriptorHash);
  instant(record.validUntil);
  validateConfigurationSchemaV2(record.configurationSchema);
  const routes = arrayOf(record.routes, validateLaunchRouteV2, 128);
  boundedString(record.defaultChoiceId, 1, 256);
  const choices = routes.map((route) => (route as JsonRecordV2).choiceId);
  if (routes.length === 0 || new Set(choices).size !== choices.length
    || choices.filter((choice) => choice === record.defaultChoiceId).length !== 1) mismatch();
}

function validateConfigurationSchemaV2(value: unknown): void {
  const record = exactRecord(value, ["schemaVersion", "schemaHash", "fields"]);
  literal(record.schemaVersion, "programmable.launch-configuration-schema.v2");
  digest(record.schemaHash);
  const fields = arrayOf(record.fields, (candidate) => {
    const field = exactRecord(candidate, [
      "fieldId", "label", "kind", "required", "maxLength",
    ]);
    identifier(field.fieldId);
    boundedString(field.label, 1, 256);
    enumValue(field.kind, ["text", "long-text", "url", "image-url"]);
    booleanValue(field.required);
    safeInteger(field.maxLength, 1, 1_048_576);
  }, 256);
  const fieldIds = fields.map((field) => (field as JsonRecordV2).fieldId);
  if (new Set(fieldIds).size !== fieldIds.length) mismatch();
}

function validateLaunchRouteV2(value: unknown): void {
  const record = exactRecord(value, [
    "choiceId", "chainId", "chainProfileId", "launchRouteId",
    "launchRouteBindingHash", "routeAdapterId", "executionMode", "walletActionKind",
    "walletExecutionKind", "transactionValuePolicy", "feePolicy",
  ]);
  identifier(record.choiceId);
  positiveDecimal(record.chainId);
  identifier(record.chainProfileId);
  identifier(record.launchRouteId);
  digest(record.launchRouteBindingHash);
  identifier(record.routeAdapterId);
  identifier(record.executionMode);
  validateCustomLaunchFeePolicyV1(record.feePolicy, {
    chainId: record.chainId as string,
  });
  literal(record.walletActionKind, "eip1193-send-transaction");
  literal(record.walletExecutionKind, "eoa-direct");
  const policy = exactRecord(record.transactionValuePolicy, ["kind", "valueWei"]);
  literal(policy.kind, "exact");
  unsignedDecimal(policy.valueWei);
}

function validatePresentationResponseV1(value: unknown): void {
  const record = exactRecord(value, [
    "schemaVersion", "applicationId", "applicationHandle", "grantId", "grantBindingHash", "version",
    "outcome", "presentationBindingHash", "record", "committedAt",
  ]);
  literal(record.schemaVersion, "programmable.principal-launch-presentation-response.v2");
  applicationV3Id(record.applicationId);
  applicationHandle(record.applicationHandle);
  identifier(record.grantId);
  digest(record.grantBindingHash);
  safeInteger(record.version, 0);
  enumValue(record.outcome, ["committed", "unchanged", "conflict", "current"]);
  digest(record.presentationBindingHash);
  const nested = exactRecord(record.record, [
    "schemaVersion", "applicationId", "grantId", "grantBindingHash",
    "approvedModelIdentity", "approvedModelIdentityHash", "presentation", "provenance",
    "presentationBindingHash",
  ]);
  literal(nested.schemaVersion, "programmable.launch-presentation-record.v1");
  applicationV3Id(nested.applicationId);
  identifier(nested.grantId);
  digest(nested.grantBindingHash);
  const identity = exactRecord(nested.approvedModelIdentity, [
    "schemaVersion", "platformId", "category", "launchFamily", "modelId",
  ]);
  literal(identity.schemaVersion, "programmable.approved-launch-model-identity.v1");
  literal(identity.platformId, "programmable");
  literal(identity.category, "custom");
  literal(identity.launchFamily, "custom");
  identifier(identity.modelId);
  digest(nested.approvedModelIdentityHash);
  validatePresentationDraftV1(nested.presentation);
  const provenance = exactRecord(nested.provenance, [
    "kind", "source", "mutableFields", "protectedFields", "statement",
  ]);
  literal(provenance.kind, "presentation-only");
  literal(provenance.source, "current-grant-bound-builder-input");
  const mutable = arrayOf(provenance.mutableFields, boundedString, 3);
  if (JSON.stringify(mutable) !== JSON.stringify(["description", "image", "links"])) mismatch();
  stringArray(provenance.protectedFields, 256, 256);
  boundedString(provenance.statement, 1, 4_096);
  digest(nested.presentationBindingHash);
  instant(record.committedAt);
  if (
    nested.applicationId !== record.applicationId
    || nested.grantId !== record.grantId
    || nested.grantBindingHash !== record.grantBindingHash
    || nested.presentationBindingHash !== record.presentationBindingHash
  ) mismatch();
}

function validatePresentationDraftV1(value: unknown): void {
  const record = exactRecord(value, ["schemaVersion", "description", "image", "links"]);
  literal(record.schemaVersion, "programmable.launch-presentation-draft.v1");
  boundedString(record.description, 0, 100_000);
  nullable(record.image, (candidate) => {
    const image = exactRecord(candidate, [
      "uri", "contentSha256", "mediaType", "byteLength", "width", "height",
    ]);
    boundedString(image.uri, 1, 8_192);
    digest(image.contentSha256);
    enumValue(image.mediaType, ["image/png", "image/jpeg", "image/webp", "image/gif"]);
    safeInteger(image.byteLength, 1, 100_000_000);
    safeInteger(image.width, 1, 100_000);
    safeInteger(image.height, 1, 100_000);
  });
  arrayOf(record.links, (candidate) => {
    const link = exactRecord(candidate, ["kind", "uri"]);
    enumValue(link.kind, [
      "website", "documentation", "x", "telegram", "discord", "github", "other",
    ]);
    boundedString(link.uri, 1, 8_192);
  }, 100);
}

function validateExecutionStatusV2(value: unknown): void {
  const base = objectValue(value);
  const state = enumValue(base.state, [
    "not_started", "submission_pending", "execution_unavailable", "broadcast", "finalized",
  ]);
  const keys = [
    "schemaVersion", "applicationId", "applicationHandle", "grantId", "grantBindingHash", "state",
  ];
  if (state === "submission_pending" || state === "execution_unavailable") {
    keys.push("permitId", "executionReservationId", "reasonCode");
  } else if (state === "broadcast") {
    keys.push(
      "permitId", "executionReservationId", "executionSubmissionHash",
      "launchTransactionId", "reasonCode",
    );
  } else if (state === "finalized") {
    keys.push(
      "permitId", "executionReservationId", "executionSubmissionHash",
      "launchTransactionId", "finalizedLaunchExecutionHash", "finalizedLaunchFactHash",
      "chainId", "chainProfileId", "launchRouteId", "launchIdentityNamespace",
      "launchIdentityValue", "launchedAt", "finalizedAt",
    );
  }
  const record = exactRecord(value, keys);
  literal(record.schemaVersion, "programmable.launch-execution-status-view.v3");
  applicationV3Id(record.applicationId);
  applicationHandle(record.applicationHandle);
  identifier(record.grantId);
  digest(record.grantBindingHash);
  if (state !== "not_started") {
    digest(record.permitId);
    identifier(record.executionReservationId);
  }
  if (state === "submission_pending") enumValue(record.reasonCode, [
    "EXECUTION_RESERVED", "BROWSER_WALLET_ACTION_READY", "EXECUTION_ATTEMPT_IN_PROGRESS",
    "EXECUTION_READBACK_PENDING",
    "EXECUTION_TRANSPORT_INDETERMINATE",
  ]);
  if (state === "execution_unavailable") enumValue(record.reasonCode, [
    "EXECUTION_REVOKED", "BROWSER_WALLET_PREPARATION_REVOKED",
    "BROWSER_WALLET_ACTION_EXPIRED", "BROWSER_TRANSACTION_REORGED",
    "BROWSER_TRANSACTION_REVERTED", "BROWSER_TRANSACTION_VERIFICATION_EXHAUSTED",
  ]);
  if (state === "broadcast" || state === "finalized") {
    digest(record.executionSubmissionHash);
    boundedString(record.launchTransactionId, 1, 512);
  }
  if (state === "broadcast") literal(record.reasonCode, "FINALITY_PENDING");
  if (state === "finalized") {
    digest(record.finalizedLaunchExecutionHash);
    digest(record.finalizedLaunchFactHash);
    positiveDecimal(record.chainId);
    identifier(record.chainProfileId);
    identifier(record.launchRouteId);
    identifier(record.launchIdentityNamespace);
    boundedString(record.launchIdentityValue, 1, 512);
    const launchedAt = instant(record.launchedAt);
    const finalizedAt = instant(record.finalizedAt);
    if (launchedAt > finalizedAt) mismatch();
  }
}

function validateChallengeV2(value: unknown): void {
  const record = exactRecord(value, [
    "schemaVersion", "grantId", "challengeId", "challengeBindingHash", "sessionId",
    "state", "createdAt", "expiresAt",
  ]);
  literal(record.schemaVersion, "programmable.launch-session-challenge-view.v2");
  identifier(record.grantId);
  uuid(record.challengeId);
  digest(record.challengeBindingHash);
  uuid(record.sessionId);
  enumValue(record.state, ["pending_compilation", "ready_for_wallet"]);
  if (instant(record.createdAt) >= instant(record.expiresAt)) mismatch();
}

function validatePreparationV2(value: unknown): void {
  const record = exactRecord(value, [
    "schemaVersion", "grantId", "challengeId", "challengeBindingHash", "sessionId",
    "preparationBindingHash", "launchArtifactCommitmentHash", "launchArtifactManifestHash",
    "launchArtifactOutputSetHash", "deploymentCalldataHash", "walletMessage",
    "signingMessageBase64Url", "state", "expiresAt",
  ]);
  literal(record.schemaVersion, "programmable.launch-session-preparation-view.v2");
  identifier(record.grantId);
  uuid(record.challengeId);
  digest(record.challengeBindingHash);
  uuid(record.sessionId);
  for (const field of [
    "preparationBindingHash", "launchArtifactCommitmentHash", "launchArtifactManifestHash",
    "launchArtifactOutputSetHash", "deploymentCalldataHash",
  ]) digest(record[field]);
  validateWalletOwnershipMessageV2(record.walletMessage);
  regexString(record.signingMessageBase64Url, BASE64URL_V2, 1_398_102);
  literal(record.state, "ready_for_wallet");
  instant(record.expiresAt);
  const message = record.walletMessage as JsonRecordV2;
  if (
    message.grantId !== record.grantId
    || message.challengeId !== record.challengeId
    || message.challengeBindingHash !== record.challengeBindingHash
    || message.sessionId !== record.sessionId
    || message.preparationBindingHash !== record.preparationBindingHash
    || message.launchArtifactCommitmentHash !== record.launchArtifactCommitmentHash
    || message.launchArtifactManifestHash !== record.launchArtifactManifestHash
    || message.launchArtifactOutputSetHash !== record.launchArtifactOutputSetHash
    || message.deploymentCalldataHash !== record.deploymentCalldataHash
    || message.expiresAt !== record.expiresAt
  ) mismatch();
}

function validateWalletOwnershipMessageV2(value: unknown): void {
  const record = exactRecord(value, [
    "schemaVersion", "audience", "grantId", "grantBindingHash", "githubPrincipalHash",
    "challengeId", "challengeBindingHash", "sessionId", "sessionNonce", "walletNonce",
    "serviceChallengeHash", "walletNamespace", "walletValue", "chainId", "chainProfileId",
    "chainProfileHash", "routeId", "routeBindingHash", "executionMode", "transactionValueWei",
    "templateBindingHash", "launchSpecificationHash", "preparationBindingHash",
    "launchArtifactCommitmentHash", "launchArtifactManifestHash", "launchArtifactOutputSetHash",
    "deploymentCalldataHash", "feeAssessmentHash", "grantControlGenerationsHash",
    "permitIssuanceGeneration", "permitConsumptionGeneration", "expiresAt",
  ]);
  literal(record.schemaVersion, "programmable.launch-wallet-ownership-message.v2");
  literal(record.audience, "programmable.launch-wallet-ownership.v2");
  identifier(record.grantId);
  uuid(record.challengeId);
  uuid(record.sessionId);
  uuid(record.sessionNonce);
  uuid(record.walletNonce);
  for (const [key, candidate] of Object.entries(record)) {
    if (key.endsWith("Hash")) digest(candidate);
  }
  identifier(record.walletNamespace);
  boundedString(record.walletValue, 1, 512);
  positiveDecimal(record.chainId);
  identifier(record.chainProfileId);
  identifier(record.routeId);
  identifier(record.executionMode);
  unsignedDecimal(record.transactionValueWei);
  positiveDecimal(record.permitIssuanceGeneration);
  positiveDecimal(record.permitConsumptionGeneration);
  instant(record.expiresAt);
}

function validateAuthenticatedSessionV2(value: unknown): void {
  const record = exactRecord(value, [
    "schemaVersion", "grantId", "challengeId", "challengeBindingHash", "sessionId",
    "sessionBindingHash", "walletOwnershipBindingHash", "permitRequestHash", "state",
    "expiresAt",
  ]);
  literal(record.schemaVersion, "programmable.authenticated-launch-session-view.v2");
  identifier(record.grantId);
  uuid(record.challengeId);
  digest(record.challengeBindingHash);
  uuid(record.sessionId);
  digest(record.sessionBindingHash);
  digest(record.walletOwnershipBindingHash);
  digest(record.permitRequestHash);
  literal(record.state, "active");
  instant(record.expiresAt);
}

function validateAuthorizedPermitV2(value: unknown): void {
  const record = exactRecord(value, [
    "schemaVersion", "grantId", "sessionId", "sessionBindingHash", "permitId",
    "permitPayloadHash", "signedPermitArtifactHash", "canonicalSignedPermitBase64Url",
    "state", "validUntil",
  ]);
  literal(record.schemaVersion, "programmable.authorized-launch-permit-view.v2");
  identifier(record.grantId);
  uuid(record.sessionId);
  digest(record.sessionBindingHash);
  digest(record.permitId);
  digest(record.permitPayloadHash);
  digest(record.signedPermitArtifactHash);
  regexString(record.canonicalSignedPermitBase64Url, BASE64URL_V2, 1_398_102);
  literal(record.state, "authorized");
  instant(record.validUntil);
}

function validateBrowserPreparationV2(value: unknown): void {
  const record = exactRecord(value, [
    "schemaVersion", "transport", "walletExecutionKind", "executionReservationId",
    "grantId", "chainId", "browserWalletAction", "browserWalletActionHash",
    "actionPermitBinding", "senderBindingPolicyHash", "actionNotBefore", "expiresAt",
    "authorityBindingHash",
  ]);
  literal(record.schemaVersion, "programmable.browser-wallet-launch-preparation.v2");
  literal(record.transport, "browser-wallet-self-submit");
  literal(record.walletExecutionKind, "eoa-direct");
  uuid(record.executionReservationId);
  identifier(record.grantId);
  positiveDecimal(record.chainId);
  validateBrowserWalletActionV2(record.browserWalletAction);
  digest(record.browserWalletActionHash);
  validateActionPermitBindingV2(record.actionPermitBinding);
  digest(record.senderBindingPolicyHash);
  const actionNotBefore = instant(record.actionNotBefore);
  const expiresAt = instant(record.expiresAt);
  digest(record.authorityBindingHash);
  const action = record.browserWalletAction as JsonRecordV2;
  const binding = record.actionPermitBinding as JsonRecordV2;
  const executionValidAfterMs = Number(
    BigInt(binding.executionValidAfter as string) * 1_000n,
  );
  const executionValidUntilMs = Number(
    BigInt(binding.executionValidUntil as string) * 1_000n,
  );
  if (
    actionNotBefore >= expiresAt
    || action.chainId !== record.chainId
    || binding.browserWalletActionHash !== record.browserWalletActionHash
    || !Number.isSafeInteger(executionValidAfterMs)
    || !Number.isSafeInteger(executionValidUntilMs)
    || actionNotBefore < executionValidAfterMs
    || expiresAt > executionValidUntilMs
  ) mismatch();
}

function validateBrowserWalletActionV2(value: unknown): void {
  const record = exactRecord(value, [
    "schemaVersion", "walletExecutionKind", "method", "chainId", "params",
  ]);
  literal(record.schemaVersion, "programmable.browser-wallet-action.v2");
  literal(record.walletExecutionKind, "eoa-direct");
  literal(record.method, "eth_sendTransaction");
  positiveDecimal(record.chainId);
  const params = arrayOf(record.params, (candidate) => {
    const transaction = exactRecord(candidate, ["from", "to", "data", "value"]);
    regexString(transaction.from, ADDRESS_V2, 42);
    regexString(transaction.to, ADDRESS_V2, 42);
    regexString(transaction.data, HEX_DATA_V2, 1_048_576);
    regexString(transaction.value, /^0x(?:0|[1-9a-f][0-9a-f]*)$/u, 66);
  }, 1);
  if (params.length !== 1) mismatch();
}

function validateActionPermitBindingV2(value: unknown): void {
  const record = exactRecord(value, [
    "schemaVersion", "permitId", "permitPayloadHash", "signedPermitArtifactHash",
    "permitRequestHash", "transactionSender", "transactionTarget", "transactionValueWei",
    "deploymentCalldataHash", "create2RouteId", "routeNonce", "executionValidAfter",
    "executionValidUntil", "browserWalletActionHash", "actionPermitBindingHash",
  ]);
  literal(record.schemaVersion, "programmable.browser-wallet-action-permit-binding.v2");
  for (const [key, candidate] of Object.entries(record)) {
    if (key.endsWith("Hash") || key === "permitId") digest(candidate);
  }
  namespacedIdentity(record.transactionSender);
  namespacedIdentity(record.transactionTarget);
  unsignedDecimal(record.transactionValueWei);
  enumValue(record.create2RouteId, [
    "programmable:create2-deployer:v2", "programmable:create2-graph-deployer:v2",
  ]);
  regexString(record.routeNonce, /^0x[0-9a-f]{64}$/u, 66);
  unsignedDecimal(record.executionValidAfter);
  unsignedDecimal(record.executionValidUntil);
  if (
    BigInt(record.executionValidAfter as string) >= (1n << 64n)
    || BigInt(record.executionValidUntil as string) >= (1n << 64n)
    || BigInt(record.executionValidAfter as string)
      >= BigInt(record.executionValidUntil as string)
  ) mismatch();
}

function validateGrantReissueV1(value: unknown): void {
  const record = exactRecord(value, [
    "schemaVersion", "state", "requestId", "requestDigest", "analysisTaskId",
    "applicationId", "applicationHandle", "oldGrantId", "newGrantId", "newGrantBindingHash", "requestedAt",
  ]);
  literal(record.schemaVersion, "programmable.browser-wallet-grant-reissue.v2");
  enumValue(record.state, ["pending", "ready", "failed"]);
  identifier(record.requestId);
  digest(record.requestDigest);
  identifier(record.analysisTaskId);
  applicationV3Id(record.applicationId);
  applicationHandle(record.applicationHandle);
  identifier(record.oldGrantId);
  nullable(record.newGrantId, identifier);
  nullable(record.newGrantBindingHash, digest);
  instant(record.requestedAt);
  if (record.state === "ready"
    ? record.newGrantId === null || record.newGrantBindingHash === null
    : record.newGrantId !== null || record.newGrantBindingHash !== null) mismatch();
}

function validateLaunchReportAckV2(value: unknown): void {
  const record = exactRecord(value, [
    "schemaVersion", "state", "disposition", "reportId", "reportSequence",
    "executionReservationId", "transactionHash", "reportBindingHash", "reportedAt",
  ]);
  literal(record.schemaVersion, "programmable.browser-wallet-launch-report-ack.v2");
  literal(record.state, "verification_pending");
  enumValue(record.disposition, ["reported", "idempotent", "canonical_existing"]);
  identifier(record.reportId);
  positiveDecimal(record.reportSequence);
  identifier(record.executionReservationId);
  regexString(record.transactionHash, /^0x[0-9a-f]{64}$/u, 66);
  digest(record.reportBindingHash);
  instant(record.reportedAt);
}

function validateProjectViewV2(value: unknown): void {
  const record = exactRecord(value, ["schemaVersion", "project"]);
  literal(record.schemaVersion, "programmable.custom-launch-project-view.v2");
  validateProjectV2(record.project);
}

function validateProfileViewV2(value: unknown): void {
  const record = exactRecord(value, ["schemaVersion", "subject", "projects"]);
  literal(record.schemaVersion, "programmable.custom-launch-wallet-profile.v2");
  const subject = exactRecord(record.subject, ["namespace", "value"]);
  namespacedIdentity(subject);
  const projects = arrayOf(record.projects, validateProjectV2, 10_000);
  if (projects.some((project) =>
    ((project as JsonRecordV2).launchingWallet as JsonRecordV2).namespace
      !== subject.namespace
    || ((project as JsonRecordV2).launchingWallet as JsonRecordV2).value
      !== subject.value)) mismatch();
}

function validateProjectV2(value: unknown): void {
  const record = exactRecord(value, [
    "schemaVersion", "platformId", "origin", "category", "launchFamily", "modelId",
    "sourceKind", "sourceRecordBindingHash", "finalizedLaunchBindingHash", "status",
    "action", "projectId", "launchId", "githubPrincipalHash", "chainId", "chainProfileId",
    "chainProfileHash", "launchIdentity", "launchingWallet",
    "postLaunchAuthorityInventory", "postLaunchAuthorityInventoryHash",
    "launchTransactionId", "launchRouteId",
    "executionMode", "advertisesToken", "discoverableAssets", "assetIdentitySetHash",
    "discoverableMarkets", "marketSetHash", "feeAssessmentHash", "feeObligationHash",
    "feeAssessmentObligationBindingHash", "feeObligation", "registryPublicationBindingHash",
    "registryAdapterBindingHash", "projectionRuntimeBindingHash", "registryObservationDigest",
    "registryTargetBindingHash", "presentationVersion", "presentationBindingHash",
    "presentation", "websiteProjectionGeneration", "launchedAt", "finalizedAt",
  ]);
  literal(record.schemaVersion, "programmable.custom-launch-website-record.v2");
  literal(record.platformId, "programmable");
  literal(record.origin, "programmable");
  literal(record.category, "custom");
  literal(record.launchFamily, "custom");
  identifier(record.modelId);
  enumValue(record.sourceKind, ["browser-wallet-report", "legacy-executor"]);
  literal(record.status, "launched");
  literal(record.action, "view_live_launch");
  for (const [key, candidate] of Object.entries(record)) {
    if (key.endsWith("Hash") || key.endsWith("Digest") || key === "projectId" || key === "launchId") {
      if (candidate !== null) digest(candidate);
    }
  }
  positiveDecimal(record.chainId);
  identifier(record.chainProfileId);
  namespacedIdentity(record.launchIdentity);
  namespacedIdentity(record.launchingWallet);
  validatePostLaunchAuthorityInventoryV1(record.postLaunchAuthorityInventory);
  digest(record.postLaunchAuthorityInventoryHash);
  if ((record.postLaunchAuthorityInventory as JsonRecordV2)
    .postLaunchAuthorityInventoryHash !== record.postLaunchAuthorityInventoryHash
    || ((record.postLaunchAuthorityInventory as JsonRecordV2)
      .launchingWallet as JsonRecordV2).namespace
      !== (record.launchingWallet as JsonRecordV2).namespace
    || ((record.postLaunchAuthorityInventory as JsonRecordV2)
      .launchingWallet as JsonRecordV2).value
      !== (record.launchingWallet as JsonRecordV2).value) mismatch();
  boundedString(record.launchTransactionId, 1, 512);
  identifier(record.launchRouteId);
  identifier(record.executionMode);
  booleanValue(record.advertisesToken);
  arrayOf(record.discoverableAssets, validateDiscoverableAssetV2, 10_000);
  const discoverableMarkets = arrayOf(record.discoverableMarkets, (candidate) => validateDiscoverableMarketV2(
    candidate,
    {
      chainId: record.chainId as string,
      chainProfileId: record.chainProfileId as string,
      chainProfileHash: record.chainProfileHash as string,
    },
  ), 10_000);
  validateFeeObligationV3(record.feeObligation, {
    chainId: record.chainId as string,
    launchRouteId: record.launchRouteId as string,
    modelId: record.modelId as string,
    marketPathIds: new Set(discoverableMarkets.map(
      (market) => (market as JsonRecordV2).marketId as string,
    )),
  });
  nullable(record.presentationVersion, positiveDecimal);
  nullable(record.presentationBindingHash, digest);
  nullable(record.presentation, validatePresentationDraftV1);
  positiveDecimal(record.websiteProjectionGeneration);
  const launchedAt = instant(record.launchedAt);
  const finalizedAt = instant(record.finalizedAt);
  if (launchedAt > finalizedAt
    || ((record.presentation === null) !== (record.presentationBindingHash === null))
    || (record.feeObligation as JsonRecordV2).feeAssessmentHash !== record.feeAssessmentHash
    || (record.feeObligation as JsonRecordV2).feeObligationHash !== record.feeObligationHash
    || (record.feeObligation as JsonRecordV2).feeAssessmentObligationBindingHash
      !== record.feeAssessmentObligationBindingHash) mismatch();
}

function validatePostLaunchAuthorityInventoryV1(value: unknown): void {
  const record = exactRecord(value, [
    "schemaVersion", "launchingWallet", "addressBindings",
    "declaredIdentityBindings", "postLaunchAuthorities", "confirmation",
    "postLaunchActionPolicy", "githubAuthority",
    "postLaunchAuthorityInventoryHash",
  ]);
  literal(record.schemaVersion, "programmable.post-launch-authority-inventory.v1");
  namespacedIdentity(record.launchingWallet);
  arrayOf(record.addressBindings, () => undefined, 4_096);
  arrayOf(record.declaredIdentityBindings, () => undefined, 4_096);
  arrayOf(record.postLaunchAuthorities, (candidate) => {
    const authority = exactRecord(candidate, [
      "authorityId", "role", "authorityKind", "identity", "source",
      "postLaunchActions", "feeRole", "disclosure", "authorization",
    ]);
    identifier(authority.authorityId);
    identifier(authority.role);
    enumValue(authority.authorityKind, ["eoa", "multisig", "contract"]);
    namespacedIdentity(authority.identity);
    const source = objectValue(authority.source);
    enumValue(source.kind, [
      "launching-wallet", "declared-identity", "launch-produced-contract",
      "reviewed-external-contract",
    ]);
    stringArray(authority.postLaunchActions, 1_024, 256);
    enumValue(authority.feeRole, ["none", "creator", "project"]);
    const disclosure = exactRecord(authority.disclosure, ["label", "description"]);
    boundedString(disclosure.label, 1, 96);
    boundedString(disclosure.description, 1, 512);
    literal(authority.authorization, "declared-onchain-authority-only");
  }, 1_024);
  const confirmation = exactRecord(record.confirmation, [
    "mode", "confirmingIdentity", "userVisibleDisclosureRequired",
  ]);
  literal(confirmation.mode, "artifact-bound-launching-wallet-intent");
  namespacedIdentity(confirmation.confirmingIdentity);
  literal(confirmation.userVisibleDisclosureRequired, true);
  literal(record.postLaunchActionPolicy, "declared-onchain-authority-only");
  literal(record.githubAuthority, "provenance-only-never-post-launch-authority");
  digest(record.postLaunchAuthorityInventoryHash);
}

function validateDiscoverableAssetV2(value: unknown): void {
  const record = exactRecord(value, [
    "assetId", "role", "identity", "provenance", "identityEvidenceHash",
    "onchainMetadata", "onchainMetadataHash",
  ]);
  identifier(record.assetId);
  enumValue(record.role, [
    "root", "primary-token", "secondary-token", "pool", "hook", "controller",
  ]);
  namespacedIdentity(record.identity);
  validateAssetProvenanceV2(record.provenance);
  digest(record.identityEvidenceHash);
  nullable(record.onchainMetadata, validateTokenMetadataV2);
  nullable(record.onchainMetadataHash, digest);
  if ((record.onchainMetadata === null) !== (record.onchainMetadataHash === null)) mismatch();
}

function validateAssetProvenanceV2(value: unknown): void {
  const base = objectValue(value);
  const kind = enumValue(base.kind, ["launch-produced", "protocol-external", "adopted-external"]);
  if (kind === "launch-produced") {
    exactRecord(value, ["kind"]);
    return;
  }
  if (kind === "protocol-external") {
    const record = exactRecord(value, ["kind", "relationship"]);
    boundedString(record.relationship, 1, 512);
    return;
  }
  const record = exactRecord(value, [
    "kind", "relationship", "dependencyId", "capabilityId", "reviewedRole",
    "chainProfileId", "identity", "expectedRuntimeCodeKeccak256",
    "expectedRuntimeCodeSha256", "reviewEvidenceBindingHash",
    "interfaceEvidenceBindingHash", "stateObservationIds",
  ]);
  for (const field of [
    "relationship", "dependencyId", "capabilityId", "reviewedRole", "chainProfileId",
  ]) identifier(record[field]);
  namespacedIdentity(record.identity);
  regexString(record.expectedRuntimeCodeKeccak256, /^0x[0-9a-f]{64}$/u, 66);
  digest(record.expectedRuntimeCodeSha256);
  digest(record.reviewEvidenceBindingHash);
  digest(record.interfaceEvidenceBindingHash);
  stringArray(record.stateObservationIds, 10_000, 512);
}

function validateTokenMetadataV2(value: unknown): void {
  const base = objectValue(value);
  const status = enumValue(base.status, ["available", "unavailable"]);
  const record = status === "available"
    ? exactRecord(value, ["schemaVersion", "status", "source", "name", "symbol", "decimals", "evidenceHash"])
    : exactRecord(value, ["schemaVersion", "status", "source", "reason", "evidenceHash"]);
  literal(record.schemaVersion, "programmable.discoverable-launch-token-metadata.v2");
  literal(record.source, "finality-resolved-onchain");
  digest(record.evidenceHash);
  if (status === "available") {
    boundedString(record.name, 0, 1_024);
    boundedString(record.symbol, 0, 1_024);
    safeInteger(record.decimals, 0, 255);
  } else {
    enumValue(record.reason, [
      "onchain-read-unavailable", "non-standard-metadata", "invalid-metadata",
    ]);
  }
}

function validateDiscoverableMarketV2(
  value: unknown,
  project: Readonly<{
    chainId: string;
    chainProfileId: string;
    chainProfileHash: string;
  }>,
): void {
  const base = objectValue(value);
  const keys = [
    "marketId", "kind", "status", "marketAssetId", "baseAssetId", "quoteAssetId",
    "marketEvidenceHash", "verification", "uniswapV4",
  ];
  if (Object.hasOwn(base, "tradeCapability")) keys.push("tradeCapability");
  const record = exactRecord(value, keys);
  for (const field of ["marketId", "kind", "marketAssetId", "baseAssetId", "quoteAssetId"] ) {
    identifier(record[field]);
  }
  enumValue(record.status, ["active", "paused", "closed", "verification_pending"]);
  digest(record.marketEvidenceHash);
  validateMarketVerificationV2(record.verification);
  nullable(record.uniswapV4, validateUniswapV4PoolV2);
  if (Object.hasOwn(record, "tradeCapability")) {
    validateDiscoverableMarketTradeCapabilityV1(record.tradeCapability, {
      ...project,
      marketId: record.marketId as string,
      baseAssetId: record.baseAssetId as string,
      quoteAssetId: record.quoteAssetId as string,
      marketStatus: record.status as string,
      verification: record.verification as JsonRecordV2,
      uniswapV4: record.uniswapV4 as JsonRecordV2 | null,
    });
  }
}

function validateTradeIdentityV1(value: unknown, chainId: string): JsonRecordV2 {
  const identity = exactRecord(value, ["namespace", "value"]);
  literal(identity.namespace, `eip155:${chainId}`);
  regexString(identity.value, /^0x[0-9a-f]{40}$/u, 42);
  return identity;
}

function validateDiscoverableMarketTradeCapabilityV1(
  value: unknown,
  binding: Readonly<{
    chainId: string;
    chainProfileId: string;
    chainProfileHash: string;
    marketId: string;
    baseAssetId: string;
    quoteAssetId: string;
    marketStatus: string;
    verification: JsonRecordV2;
    uniswapV4: JsonRecordV2 | null;
  }>,
): void {
  const record = exactRecord(value, [
    "actionPolicy", "adapterId", "approvalPolicy", "baseAssetId", "capabilityId",
    "chainId", "chainProfileHash", "chainProfileId", "deadlinePolicy",
    "dependencies", "exactness", "hookAssetIdentityEvidenceHash", "hookDataPolicy",
    "marketId", "marketVerificationBindingHash", "planBindingHash", "poolKey",
    "poolKeyEvidenceHash", "quoteAssetId", "quotePolicy", "recipientPolicy",
    "routerGeneration", "schemaVersion", "sideBindings", "slippagePolicy", "status",
    "supportedSides", "tradeCapabilityBindingHash",
  ]);
  literal(record.schemaVersion, "programmable.discoverable-market-trade-capability.v1");
  literal(record.adapterId, "uniswap-v4-universal-router-exact-input:v1");
  literal(record.exactness, "exact-input");
  literal(record.recipientPolicy, "connected-wallet-only");
  literal(record.status, "verified");
  identifier(record.capabilityId);
  identifier(record.routerGeneration);
  for (const field of [
    "chainProfileHash", "planBindingHash", "poolKeyEvidenceHash",
    "marketVerificationBindingHash", "tradeCapabilityBindingHash",
  ]) digest(record[field]);
  nullable(record.hookAssetIdentityEvidenceHash, digest);
  if (binding.marketStatus !== "active"
    || binding.verification.status !== "verified"
    || binding.uniswapV4 === null
    || record.chainId !== binding.chainId
    || record.chainProfileId !== binding.chainProfileId
    || record.chainProfileHash !== binding.chainProfileHash
    || record.marketId !== binding.marketId
    || record.baseAssetId !== binding.baseAssetId
    || record.quoteAssetId !== binding.quoteAssetId
    || record.poolKeyEvidenceHash !== binding.uniswapV4.poolKeyEvidenceHash
    || record.marketVerificationBindingHash !== binding.verification.verifierBindingHash) mismatch();

  const poolKey = exactRecord(record.poolKey, [
    "currency0", "currency0AssetId", "currency1", "currency1AssetId", "feeRaw",
    "hooks", "hooksAssetId", "poolId", "tickSpacing",
  ]);
  regexString(poolKey.poolId, /^0x[0-9a-f]{64}$/u, 66);
  identifier(poolKey.currency0AssetId);
  identifier(poolKey.currency1AssetId);
  nullable(poolKey.hooksAssetId, identifier);
  validateTradeIdentityV1(poolKey.currency0, binding.chainId);
  validateTradeIdentityV1(poolKey.currency1, binding.chainId);
  validateTradeIdentityV1(poolKey.hooks, binding.chainId);
  unsignedDecimal(poolKey.feeRaw);
  regexString(poolKey.tickSpacing, /^-?(?:0|[1-9][0-9]{0,76})$/u, 78);
  if (poolKey.poolId !== binding.uniswapV4.poolId
    || poolKey.currency0AssetId !== binding.uniswapV4.currency0AssetId
    || poolKey.currency1AssetId !== binding.uniswapV4.currency1AssetId
    || poolKey.feeRaw !== binding.uniswapV4.feeRaw
    || poolKey.tickSpacing !== binding.uniswapV4.tickSpacing
    || poolKey.hooksAssetId !== binding.uniswapV4.hooksAssetId) mismatch();

  const roles = [
    "uniswap-permit2", "uniswap-v4-quoter", "uniswap-v4-state-view",
    "uniswap-v4-universal-router",
  ] as const;
  const expectedDependencyCapabilities = [
    "capability:uniswap-permit2:v1",
    "capability:uniswap-v4-quoter:v1",
    "capability:uniswap-v4-state-view:v1",
    `capability:uniswap-v4-${record.routerGeneration as string}`,
  ];
  const dependencies = arrayOf(record.dependencies, (candidate) => {
    const dependency = exactRecord(candidate, [
      "capabilityId", "chainProfileId", "dependencyId", "identity",
      "interfaceEvidenceBindingHash", "reviewEvidenceBindingHash", "role",
      "runtimeCodeKeccak256", "runtimeCodeSha256",
    ]);
    enumValue(dependency.role, roles);
    identifier(dependency.dependencyId);
    identifier(dependency.capabilityId);
    literal(dependency.chainProfileId, binding.chainProfileId);
    validateTradeIdentityV1(dependency.identity, binding.chainId);
    regexString(dependency.runtimeCodeKeccak256, /^0x[0-9a-f]{64}$/u, 66);
    digest(dependency.runtimeCodeSha256);
    digest(dependency.reviewEvidenceBindingHash);
    digest(dependency.interfaceEvidenceBindingHash);
    return dependency;
  }, 4) as JsonRecordV2[];
  if (dependencies.length !== 4
    || dependencies.some((dependency, index) => dependency.role !== roles[index]
      || dependency.capabilityId !== expectedDependencyCapabilities[index])
    || new Set(dependencies.map(({ dependencyId }) => dependencyId)).size !== 4
    || new Set(dependencies.map(({ identity }) =>
      (identity as JsonRecordV2).value)).size !== 4) mismatch();

  const sides = arrayOf(record.supportedSides, (candidate) =>
    enumValue(candidate, ["base-to-quote", "quote-to-base"]), 2);
  if (sides.length < 1 || new Set(sides).size !== sides.length
    || [...sides].sort().some((side, index) => side !== sides[index])) mismatch();
  const sideBindings = arrayOf(record.sideBindings, (candidate) => {
    const sideBinding = exactRecord(candidate, [
      "inputAssetId", "inputCurrencyKind", "outputAssetId", "settlementAction",
      "side", "takeAction", "zeroForOne",
    ]);
    enumValue(sideBinding.side, ["base-to-quote", "quote-to-base"]);
    identifier(sideBinding.inputAssetId);
    identifier(sideBinding.outputAssetId);
    booleanValue(sideBinding.zeroForOne);
    enumValue(sideBinding.inputCurrencyKind, ["native", "erc20"]);
    literal(sideBinding.settlementAction, "SETTLE_ALL");
    literal(sideBinding.takeAction, "TAKE_ALL");
    return sideBinding;
  }, 2) as JsonRecordV2[];
  const baseIsCurrency0 = poolKey.currency0AssetId === binding.baseAssetId;
  if (sideBindings.length !== sides.length
    || sideBindings.some((candidate, index) => {
      const side = sides[index];
      const inputAssetId = side === "base-to-quote"
        ? binding.baseAssetId : binding.quoteAssetId;
      const outputAssetId = side === "base-to-quote"
        ? binding.quoteAssetId : binding.baseAssetId;
      const zeroForOne = side === "base-to-quote" ? baseIsCurrency0 : !baseIsCurrency0;
      const inputIdentity = zeroForOne
        ? poolKey.currency0 as JsonRecordV2
        : poolKey.currency1 as JsonRecordV2;
      return candidate.side !== side
        || candidate.inputAssetId !== inputAssetId
        || candidate.outputAssetId !== outputAssetId
        || candidate.zeroForOne !== zeroForOne
        || candidate.inputCurrencyKind
          !== (inputIdentity.value === "0x0000000000000000000000000000000000000000"
            ? "native" : "erc20");
    })) mismatch();

  const hookData = exactRecord(record.hookDataPolicy, ["data", "hookDataHash", "kind"]);
  enumValue(hookData.kind, ["empty", "fixed"]);
  regexString(hookData.data, /^0x(?:[0-9a-f]{2}){0,2048}$/u, 4_098);
  digest(hookData.hookDataHash);
  if ((hookData.kind === "empty") !== (hookData.data === "0x")
    || (poolKey.hooksAssetId === null && hookData.data !== "0x")
    || (poolKey.hooksAssetId === null)
      !== (record.hookAssetIdentityEvidenceHash === null)) mismatch();
  const action = exactRecord(record.actionPolicy, [
    "exactOutput", "multiHop", "settleAction", "swapAction", "takeAction",
  ]);
  literal(action.swapAction, "SWAP_EXACT_IN_SINGLE");
  literal(action.settleAction, "SETTLE_ALL");
  literal(action.takeAction, "TAKE_ALL");
  literal(action.multiHop, false);
  literal(action.exactOutput, false);
  const quote = exactRecord(record.quotePolicy, [
    "adapterId", "currentStateRequired", "executionMode", "maximumQuoteAgeSeconds",
  ]);
  literal(quote.adapterId, "uniswap-v4-quoter-exact-input:v1");
  literal(quote.executionMode, "offchain-static-call-only");
  literal(quote.currentStateRequired, true);
  safeInteger(quote.maximumQuoteAgeSeconds, 1, 300);
  const slippage = exactRecord(record.slippagePolicy, [
    "amountOutMinimumRequired", "kind", "maximumSlippageBps",
  ]);
  literal(slippage.kind, "user-bounded-minimum-output");
  literal(slippage.amountOutMinimumRequired, true);
  safeInteger(slippage.maximumSlippageBps, 1, 5_000);
  const deadline = exactRecord(record.deadlinePolicy, [
    "deadlineRequired", "kind", "maximumHorizonSeconds",
  ]);
  literal(deadline.kind, "bounded-user-deadline");
  literal(deadline.deadlineRequired, true);
  safeInteger(deadline.maximumHorizonSeconds, 1, 3_600);
  const approval = exactRecord(record.approvalPolicy, ["erc20Input", "nativeInput"]);
  literal(approval.erc20Input, "erc20-approve-permit2-then-permit2-approve-router");
  literal(approval.nativeInput, "transaction-value");
}

function validateMarketVerificationV2(value: unknown): void {
  const record = exactRecord(value, ["status", "verifierAdapterId", "verifierBindingHash"]);
  const status = enumValue(record.status, ["verified", "pending"]);
  if (status === "verified") {
    identifier(record.verifierAdapterId);
    digest(record.verifierBindingHash);
  } else if (record.verifierAdapterId !== null || record.verifierBindingHash !== null) mismatch();
}

function validateUniswapV4PoolV2(value: unknown): void {
  const record = exactRecord(value, [
    "poolId", "poolManager", "poolManagerReviewEvidenceBindingHash",
    "poolManagerInterfaceEvidenceBindingHash", "poolManagerRuntimeCodeKeccak256",
    "poolManagerRuntimeCodeSha256", "currency0AssetId", "currency1AssetId", "feeRaw",
    "dynamicFee", "tickSpacing", "hooksAssetId", "poolKeyEvidenceHash",
  ]);
  regexString(record.poolId, /^0x[0-9a-f]{64}$/u, 66);
  namespacedIdentity(record.poolManager);
  digest(record.poolManagerReviewEvidenceBindingHash);
  digest(record.poolManagerInterfaceEvidenceBindingHash);
  regexString(record.poolManagerRuntimeCodeKeccak256, /^0x[0-9a-f]{64}$/u, 66);
  digest(record.poolManagerRuntimeCodeSha256);
  identifier(record.currency0AssetId);
  identifier(record.currency1AssetId);
  unsignedDecimal(record.feeRaw);
  booleanValue(record.dynamicFee);
  regexString(record.tickSpacing, /^-?(?:0|[1-9][0-9]{0,76})$/u, 78);
  nullable(record.hooksAssetId, identifier);
  digest(record.poolKeyEvidenceHash);
}

function validateFeeObligationV3(
  value: unknown,
  context: Readonly<{
    chainId: string;
    launchRouteId: string;
    modelId: string;
    marketPathIds: ReadonlySet<string>;
  }>,
): void {
  const record = exactRecord(value, [
    "schemaVersion", "feeAssessmentHash", "chainId", "chainProfileId", "chainProfileHash",
    "policy", "qualifyingFlowBasis",
    "qualifyingFlowBasisBindingHash", "feeBasis", "enforcementRouteId",
    "enforcementRouteBindingHash", "enforcementModuleId", "enforcementModuleBindingHash",
    "claimSemantics", "feeObligationHash", "feeAssessmentObligationBindingHash",
  ]);
  literal(record.schemaVersion, "programmable.launch-fee-obligation.v3");
  digest(record.feeAssessmentHash);
  positiveDecimal(record.chainId);
  identifier(record.chainProfileId);
  digest(record.chainProfileHash);
  if (record.chainId !== context.chainId) mismatch();
  const feeMode = validateCustomLaunchFeePolicyV1(record.policy, {
    chainId: context.chainId,
    modelId: context.modelId,
    marketPathIds: context.marketPathIds,
  });
  if (feeMode === "no-qualifying-market") {
    if (
      record.qualifyingFlowBasis !== null
      || record.qualifyingFlowBasisBindingHash !== null
      || record.feeBasis !== null
      || record.enforcementRouteId !== null
      || record.enforcementRouteBindingHash !== null
      || record.enforcementModuleId !== null
      || record.enforcementModuleBindingHash !== null
      || record.claimSemantics !== "not-applicable"
    ) mismatch();
  } else {
    boundedString(record.qualifyingFlowBasis, 1, 4_096);
    digest(record.qualifyingFlowBasisBindingHash);
    literal(record.feeBasis, "gross-qualifying-flow-volume");
    identifier(record.enforcementRouteId);
    digest(record.enforcementRouteBindingHash);
    identifier(record.enforcementModuleId);
    digest(record.enforcementModuleBindingHash);
    literal(record.claimSemantics, "leg-recipient-claimable-accruals");
    if (record.enforcementRouteId !== context.launchRouteId) mismatch();
  }
  digest(record.feeObligationHash);
  digest(record.feeAssessmentObligationBindingHash);
}

function validateCustomLaunchFeePolicyV1(
  value: unknown,
  context: Readonly<{
    chainId: string;
    modelId?: string;
    marketPathIds?: ReadonlySet<string>;
  }>,
): "standard-programmable-custom" | "aeon-partner-custom" | "no-qualifying-market" {
  const policy = exactRecord(value, [
    "schemaVersion", "providerId", "modelId", "templateId", "semanticVersion",
    "feeMode", "marketPathId", "totalRatePpm", "totalRateBps", "chargeMode",
    "normalProgrammableTenBpsApplied", "legs",
  ]);
  literal(policy.schemaVersion, "programmable.custom-launch-fee-policy.v1");
  regexString(policy.providerId, FEE_ID_V1, 128);
  regexString(policy.modelId, FEE_ID_V1, 128);
  regexString(policy.templateId, FEE_ID_V1, 128);
  regexString(policy.semanticVersion, SEMVER_V1, 128);
  const feeMode = enumValue(policy.feeMode, [
    "standard-programmable-custom", "aeon-partner-custom", "no-qualifying-market",
  ]);
  enumValue(policy.chargeMode, ["added-on-top", "included-in-partner-total", "none"]);
  safeInteger(policy.totalRatePpm, 0, 2000);
  safeInteger(policy.totalRateBps, 0, 20);
  booleanValue(policy.normalProgrammableTenBpsApplied);
  if (policy.marketPathId !== null) regexString(policy.marketPathId, FEE_ID_V1, 128);
  if (context.modelId !== undefined && policy.modelId !== context.modelId) mismatch();
  if (policy.marketPathId !== null && context.marketPathIds !== undefined
    && !context.marketPathIds.has(policy.marketPathId as string)) mismatch();

  const legs = arrayOf(policy.legs, (candidate) => {
    const leg = exactRecord(candidate, ["role", "ratePpm", "rateBps", "recipient"]);
    enumValue(leg.role, ["provider", "programmable"]);
    safeInteger(leg.ratePpm, 1, 2000);
    safeInteger(leg.rateBps, 1, 20);
    if ((leg.ratePpm as number) !== (leg.rateBps as number) * 100) mismatch();
    const recipient = exactRecord(leg.recipient, ["namespace", "value"]);
    literal(recipient.namespace, `eip155:${context.chainId}`);
    regexString(recipient.value, EVM_ADDRESS_V1, 42);
    if ((recipient.value as string).toLowerCase() === ZERO_ADDRESS_V1) mismatch();
  }, 2) as JsonRecordV2[];
  const totalRatePpm = legs.reduce((sum, leg) => sum + Number(leg.ratePpm), 0);
  const totalRateBps = legs.reduce((sum, leg) => sum + Number(leg.rateBps), 0);
  if (totalRatePpm !== policy.totalRatePpm || totalRateBps !== policy.totalRateBps) mismatch();

  const programmableLeg = legs.find(({ role }) => role === "programmable");
  const providerLeg = legs.find(({ role }) => role === "provider");
  const programmableRecipient = programmableLeg === undefined
    ? null
    : (programmableLeg.recipient as JsonRecordV2).value;
  if (programmableLeg !== undefined
    && programmableRecipient !== PROGRAMMABLE_FEE_RECIPIENT_V1) mismatch();

  if (feeMode === "standard-programmable-custom") {
    if (
      policy.providerId === "aeon"
      || policy.marketPathId === null
      || policy.totalRatePpm !== 1000
      || policy.totalRateBps !== 10
      || policy.chargeMode !== "added-on-top"
      || policy.normalProgrammableTenBpsApplied !== true
      || legs.length !== 1
      || programmableLeg?.ratePpm !== 1000
      || programmableLeg?.rateBps !== 10
      || providerLeg !== undefined
    ) mismatch();
  } else if (feeMode === "aeon-partner-custom") {
    const providerRecipient = providerLeg === undefined
      ? null
      : (providerLeg.recipient as JsonRecordV2).value;
    if (
      policy.providerId !== "aeon"
      || policy.marketPathId === null
      || policy.totalRatePpm !== 2000
      || policy.totalRateBps !== 20
      || policy.chargeMode !== "included-in-partner-total"
      || policy.normalProgrammableTenBpsApplied !== false
      || legs.length !== 2
      || legs[0]?.role !== "provider"
      || legs[1]?.role !== "programmable"
      || providerLeg?.ratePpm !== 1500
      || providerLeg?.rateBps !== 15
      || programmableLeg?.ratePpm !== 500
      || programmableLeg?.rateBps !== 5
      || providerRecipient === null
      || (providerRecipient as string).toLowerCase()
        === PROGRAMMABLE_FEE_RECIPIENT_V1.toLowerCase()
    ) mismatch();
  } else if (
    policy.marketPathId !== null
    || policy.totalRatePpm !== 0
    || policy.totalRateBps !== 0
    || policy.chargeMode !== "none"
    || policy.normalProgrammableTenBpsApplied !== false
    || legs.length !== 0
  ) mismatch();
  return feeMode;
}

function exactRecord(value: unknown, expectedKeys: readonly string[]): JsonRecordV2 {
  const record = objectValue(value);
  const actual = Object.keys(record).sort();
  const expected = [...expectedKeys].sort();
  if (actual.length !== expected.length
    || actual.some((key, index) => key !== expected[index])) mismatch();
  return record;
}

function exactRecordWithOptional(
  value: unknown,
  expectedKeys: readonly string[],
  optionalKeys: readonly string[],
): JsonRecordV2 {
  const record = objectValue(value);
  const allowed = new Set([...expectedKeys, ...optionalKeys]);
  if (expectedKeys.some((key) => !(key in record))
    || Object.keys(record).some((key) => !allowed.has(key))) mismatch();
  return record;
}

function objectValue(value: unknown): JsonRecordV2 {
  if (value === null || typeof value !== "object" || Array.isArray(value)) mismatch();
  return value as JsonRecordV2;
}

function arrayOf(
  value: unknown,
  validator: ValidatorV2,
  maxLength: number,
): unknown[] {
  if (!Array.isArray(value) || value.length > maxLength) mismatch();
  value.forEach(validator);
  return value;
}

function nullable(value: unknown, validator: ValidatorV2): void {
  if (value !== null) validator(value);
}

function literal(value: unknown, expected: string | number | boolean): void {
  if (value !== expected) mismatch();
}

function enumValue<const T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== "string" || !values.includes(value as T)) mismatch();
  return value as T;
}

function boundedString(value: unknown, minimum = 0, maximum = 4_096): void {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum) mismatch();
}

function identifier(value: unknown): void {
  boundedString(value, 1, 512);
}

function applicationV3Id(value: unknown): void {
  regexString(value, APPLICATION_ID_V3, 120);
}

function legacyV2ApplicationId(value: unknown): void {
  regexString(value, APPLICATION_ID_V3, 80);
}

function applicationHandle(value: unknown): void {
  regexString(value, APPLICATION_HANDLE_V3, 71);
}

function regexString(value: unknown, pattern: RegExp, maximum: number): void {
  if (typeof value !== "string" || value.length > maximum || !pattern.test(value)) mismatch();
}

function digest(value: unknown): void {
  regexString(value, DIGEST_V2, 71);
}

function uuid(value: unknown): void {
  regexString(value, UUID_V2, 36);
}

function positiveDecimal(value: unknown): void {
  regexString(value, POSITIVE_DECIMAL_V2, 78);
}

function unsignedDecimal(value: unknown): void {
  regexString(value, UNSIGNED_DECIMAL_V2, 78);
}

function safeInteger(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    mismatch();
  }
}

function booleanValue(value: unknown): void {
  if (typeof value !== "boolean") mismatch();
}

function stringArray(value: unknown, maxLength: number, maxStringLength: number): void {
  arrayOf(value, (candidate) => boundedString(candidate, 1, maxStringLength), maxLength);
}

function namespacedIdentity(value: unknown): void {
  const record = exactRecord(value, ["namespace", "value"]);
  identifier(record.namespace);
  boundedString(record.value, 1, 512);
}

function instant(value: unknown): number {
  if (typeof value !== "string") mismatch();
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) mismatch();
  return milliseconds;
}

function mismatch(): never {
  throw new Error("Custom launch response contract mismatch");
}
