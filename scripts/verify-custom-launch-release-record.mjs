#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { verifyCrossRepositoryReleaseBindingFromGitHubV1 } from
  "./verify-custom-launch-cross-repository-attestation.mjs";

export const SCHEMA_VERSION = "programmable.custom-launch-release-record.v1";
export const REQUIRED_VALIDATION_GATES = Object.freeze([
  "website_release",
  "approval_service_release",
  "contracts",
  "database",
  "security",
  "authority_chain_e2e",
  "production_dependencies",
  "rollback_snapshot",
]);

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const UTC_SECONDS_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/;
const WEBSITE_PROJECTION_MIGRATIONS = Object.freeze([
  Object.freeze({
    ordinal: 1,
    path: "ops/website-projection-target/migrations/0001_projection_records_v1.sql",
  }),
  Object.freeze({
    ordinal: 2,
    path: "ops/website-projection-target/migrations/0002_custom_launch_wallet_profile_v2.sql",
  }),
  Object.freeze({
    ordinal: 3,
    path: "ops/website-projection-target/migrations/0003_registry_custom_public_read_v1.sql",
  }),
]);
const WEBSITE_PROJECTION_MIGRATION_INVENTORY_SCHEMA_VERSION =
  "programmable.website-projection-migration-inventory.v1";
const SESSION_AUTHORITY_CONFIGURATION_EVIDENCE_SCHEMA_VERSION =
  "programmable.github-session-authority-public-configuration-evidence.v1";
const SESSION_AUTHORITY_RUNTIME_CONFIGURATION_SCHEMA_VERSION =
  "programmable.github-session-authority-configuration-attestation.v1";
const RECORD_STATUSES = new Set([
  "draft",
  "freeze_cleared",
  "candidate_verified",
  "promotion_approved",
  "promoted",
  "live",
]);
const REVIEW_AUTHORITY_MODES = new Set(["manual_review", "autonomous_ai"]);
const REQUIRED_LEVELS = new Set([
  "template",
  "clearance",
  "dark_staging",
  "staging",
  "candidate",
  "promotion",
  "live",
]);
const FORBIDDEN_SECRET_KEY = /^(?:access[_-]?token|identity[_-]?token|private[_-]?key|password|secret|database[_-]?url|credential)(?:[_-]?value)?$/i;
const PLACEHOLDER_PATTERN = /(?:<[^>]+>|example\.invalid|replace[_ -]?me|todo|yyyy|nnn)/i;
const CROSS_REPOSITORY_BINDING_REPOSITORY =
  "0xprogrammable/programmable-open-hook-v2-internal";
const CROSS_REPOSITORY_BINDING_DOCUMENT_PATH =
  "services/autonomous-approval-v1/release/cross-repository-release-binding-v1.json";
const CROSS_REPOSITORY_OBSERVATION_SCHEMA_VERSION =
  "programmable.website-observed-cross-repository-release-binding.v1";
const RELEASE_RECORD_SCHEMA = JSON.parse(readFileSync(
  new URL(
    "../docs/operations/releases/custom-launch-v1/release-record.schema.json",
    import.meta.url,
  ),
  "utf8",
));
const validateReleaseRecordSchema = new Ajv2020({
  allErrors: true,
  strict: true,
}).compile(RELEASE_RECORD_SCHEMA);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function compareUtf8(left, right) {
  return Buffer.from(left).compare(Buffer.from(right));
}

export function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort(compareUtf8)
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function computeWebsiteProjectionMigrationDigest(projection) {
  return sha256(canonicalize({
    schemaVersion: WEBSITE_PROJECTION_MIGRATION_INVENTORY_SCHEMA_VERSION,
    migrations: projection.migrationInventory.map((migration) => ({
      ordinal: migration.ordinal,
      path: migration.path,
      fileSha256: migration.fileSha256,
    })),
  }));
}

export function computeSessionAuthorityConfigurationEvidenceSha256(
  dependencies,
  productionAuthorityCandidateCommitSha,
) {
  const authority = dependencies.sessionAuthority;
  return sha256(canonicalize({
    schemaVersion: SESSION_AUTHORITY_CONFIGURATION_EVIDENCE_SCHEMA_VERSION,
    productionAuthorityCandidateCommitSha,
    privyApplicationId: dependencies.identity.privyApplicationId,
    audience: authority.audience,
    keyId: authority.keyId,
    keyEpoch: authority.keyEpoch,
    authorityPublicKeySpkiSha256: authority.authorityPublicKeySpkiSha256,
    workloadIssuer: authority.workloadIssuer,
    workloadSubject: authority.workloadSubject,
    workloadKeyId: authority.workloadKeyId,
    workloadPublicKeySpkiSha256: authority.workloadPublicKeySpkiSha256,
  }));
}

export function computeSessionAuthorityRuntimeConfigurationHash(dependencies) {
  const authority = dependencies.sessionAuthority;
  const binding = {
    schemaVersion: SESSION_AUTHORITY_RUNTIME_CONFIGURATION_SCHEMA_VERSION,
    appId: dependencies.identity.privyApplicationId,
    audience: authority.audience,
    keyId: authority.keyId,
    keyEpoch: authority.keyEpoch,
    publicKeySpkiSha256: authority.authorityPublicKeySpkiSha256,
    workloadIssuer: authority.workloadIssuer,
    workloadSubject: authority.workloadSubject,
    workloadKeyId: authority.workloadKeyId,
    workloadPublicKeySpkiSha256: authority.workloadPublicKeySpkiSha256,
  };
  const hash = createHash("sha256");
  hash.update(SESSION_AUTHORITY_RUNTIME_CONFIGURATION_SCHEMA_VERSION, "utf8");
  hash.update(Uint8Array.of(0));
  hash.update(canonicalize(binding), "utf8");
  return `sha256:${hash.digest("hex")}`;
}

export function releaseSubject(record) {
  return {
    schemaVersion: record.schemaVersion,
    releaseIntent: record.releaseIntent,
    website: {
      repository: record.subject?.website?.repository,
      commitSha: record.subject?.website?.commitSha,
      reviewedDiffBaseSha: record.subject?.website?.reviewedDiffBaseSha,
      reviewedDiffHeadSha: record.subject?.website?.reviewedDiffHeadSha,
      reviewedDiffSha256: record.subject?.website?.reviewedDiffSha256,
    },
    approvalService: {
      packageArtifactHash: record.subject?.approvalService?.packageArtifactHash,
      detachedPackedArtifactFileSha256:
        record.subject?.approvalService?.detachedPackedArtifactFileSha256,
      productionContentManifestSha256:
        record.subject?.approvalService?.productionContentManifestSha256,
      reviewAuthorityMode: record.subject?.approvalService?.reviewAuthorityMode,
    },
    crossRepositoryReleaseBinding: {
      repository: record.subject?.crossRepositoryReleaseBinding?.repository,
      attestationCommitSha:
        record.subject?.crossRepositoryReleaseBinding?.attestationCommitSha,
      documentPath: record.subject?.crossRepositoryReleaseBinding?.documentPath,
      documentSha256:
        record.subject?.crossRepositoryReleaseBinding?.documentSha256,
    },
    productionDependencies: record.productionDependencies,
    rollback: record.deployment?.rollback,
  };
}

export function computeReleaseSubjectSha256(record) {
  return sha256(canonicalize(releaseSubject(record)));
}

export function computeDetachedRecordSha256(record) {
  return sha256(canonicalize(record));
}

function add(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function releaseRecordSchemaErrors() {
  return (validateReleaseRecordSchema.errors ?? []).map((error) => {
    const path = error.instancePath.length === 0 ? "$" : `$${error.instancePath}`;
    const detail = error.keyword === "additionalProperties"
      ? `unexpected field ${String(error.params.additionalProperty)}`
      : (error.message ?? `failed ${error.keyword}`);
    return `${path}: schema ${detail}`;
  });
}

function releaseRecordSchemaFailure(record) {
  if (validateReleaseRecordSchema(record)) return null;
  return {
    ok: false,
    errors: releaseRecordSchemaErrors(),
    releaseSubjectSha256: null,
    detachedRecordSha256: null,
  };
}

function requireObject(errors, value, path) {
  if (!isPlainObject(value)) {
    add(errors, path, "must be an object");
    return false;
  }
  return true;
}

function requireExactKeys(errors, value, path, expectedKeys) {
  if (!isPlainObject(value)) return;
  const expected = new Set(expectedKeys);
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) add(errors, path, `missing required field ${key}`);
  }
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) add(errors, path, `unexpected field ${key}`);
  }
}

function requireString(errors, value, path) {
  if (typeof value !== "string" || value.length === 0) {
    add(errors, path, "must be a non-empty string");
    return false;
  }
  return true;
}

function requirePattern(errors, value, path, pattern, label) {
  if (!requireString(errors, value, path)) return false;
  if (!pattern.test(value)) {
    add(errors, path, `must be ${label}`);
    return false;
  }
  return true;
}

function requireExact(errors, value, path, expected) {
  if (value !== expected) add(errors, path, `must equal ${JSON.stringify(expected)}`);
}

function validateTimestamp(errors, value, path, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (!requirePattern(errors, value, path, UTC_SECONDS_PATTERN, "an RFC 3339 UTC timestamp with second precision")) return;
  if (Number.isNaN(Date.parse(value))) add(errors, path, "must be a real timestamp");
}

function validateSha256(errors, value, path, { nullable = false } = {}) {
  if (nullable && value === null) return;
  requirePattern(errors, value, path, SHA256_PATTERN, "a lowercase sha256 digest");
}

function validateCommit(errors, value, path, { nullable = false } = {}) {
  if (nullable && value === null) return;
  requirePattern(errors, value, path, COMMIT_PATTERN, "a full lowercase Git commit SHA");
}

function walkForSecretsAndPlaceholders(value, path, errors, allowPlaceholders) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkForSecretsAndPlaceholders(entry, `${path}[${index}]`, errors, allowPlaceholders));
    return;
  }
  if (!isPlainObject(value)) {
    if (!allowPlaceholders && typeof value === "string" && PLACEHOLDER_PATTERN.test(value)) {
      add(errors, path, "contains a placeholder or reserved non-production value");
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const childPath = path ? `${path}.${key}` : key;
    if (FORBIDDEN_SECRET_KEY.test(key)) add(errors, childPath, "secret-bearing keys are forbidden in release records");
    walkForSecretsAndPlaceholders(child, childPath, errors, allowPlaceholders);
  }
}

function validateReference(errors, value, path, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (!requireString(errors, value, path)) return;
  if (!/^(?:https:\/\/|codex-task:\/\/|command-center:\/\/)/.test(value)) {
    add(errors, path, "must be an immutable https, codex-task, or command-center reference");
  }
}

function validateImmutableCandidateUrl(errors, value, path) {
  if (!requireString(errors, value, path)) return;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".vercel.app") ||
      url.username !== "" ||
      url.password !== "" ||
      (url.pathname !== "" && url.pathname !== "/") ||
      url.search !== "" ||
      url.hash !== ""
    ) add(errors, path, "must be a canonical immutable Vercel HTTPS origin");
  } catch {
    add(errors, path, "must be a valid immutable deployment URL");
  }
}

function validateChronology(errors, earlier, later, path) {
  if (typeof earlier !== "string" || typeof later !== "string") return;
  const earlierTime = Date.parse(earlier);
  const laterTime = Date.parse(later);
  if (!Number.isNaN(earlierTime) && !Number.isNaN(laterTime) && laterTime < earlierTime) {
    add(errors, path, `must not precede ${earlier}`);
  }
}

function validateCrossRepositoryObservation(
  errors,
  observation,
  record,
) {
  const path = "crossRepositoryAttestation";
  if (!requireObject(errors, observation, path)) return;
  requireExactKeys(errors, observation, path, [
    "schemaVersion",
    "repository",
    "attestationCommitSha",
    "parentCommitSha",
    "documentPath",
    "documentBlobSha",
    "documentSha256",
    "backendCandidateCommitSha",
    "backendPackageArtifactHash",
    "websiteCandidateCommitSha",
    "builderCandidateCommitSha",
    "registryCandidateCommitSha",
    "productionAuthorityCandidateCommitSha",
    "applicationV3CompatibilityEvidenceSha256",
    "commitSignatureVerified",
  ]);
  requireExact(errors, observation.schemaVersion, `${path}.schemaVersion`, CROSS_REPOSITORY_OBSERVATION_SCHEMA_VERSION);
  requireExact(errors, observation.repository, `${path}.repository`, CROSS_REPOSITORY_BINDING_REPOSITORY);
  validateCommit(errors, observation.attestationCommitSha, `${path}.attestationCommitSha`);
  validateCommit(errors, observation.parentCommitSha, `${path}.parentCommitSha`);
  requireExact(errors, observation.documentPath, `${path}.documentPath`, CROSS_REPOSITORY_BINDING_DOCUMENT_PATH);
  validateCommit(errors, observation.documentBlobSha, `${path}.documentBlobSha`);
  validateSha256(errors, observation.documentSha256, `${path}.documentSha256`);
  validateCommit(errors, observation.backendCandidateCommitSha, `${path}.backendCandidateCommitSha`);
  validateSha256(errors, observation.backendPackageArtifactHash, `${path}.backendPackageArtifactHash`);
  validateCommit(errors, observation.websiteCandidateCommitSha, `${path}.websiteCandidateCommitSha`);
  validateCommit(errors, observation.builderCandidateCommitSha, `${path}.builderCandidateCommitSha`);
  validateCommit(errors, observation.registryCandidateCommitSha, `${path}.registryCandidateCommitSha`);
  validateCommit(errors, observation.productionAuthorityCandidateCommitSha, `${path}.productionAuthorityCandidateCommitSha`);
  validateSha256(errors, observation.applicationV3CompatibilityEvidenceSha256, `${path}.applicationV3CompatibilityEvidenceSha256`);
  requireExact(errors, observation.commitSignatureVerified, `${path}.commitSignatureVerified`, true);

  const binding = record.subject?.crossRepositoryReleaseBinding;
  requireExact(errors, observation.attestationCommitSha, `${path}.attestationCommitSha`, binding?.attestationCommitSha);
  requireExact(errors, observation.documentSha256, `${path}.documentSha256`, binding?.documentSha256);
  requireExact(errors, observation.websiteCandidateCommitSha, `${path}.websiteCandidateCommitSha`, record.subject?.website?.commitSha);
  requireExact(errors, observation.backendPackageArtifactHash, `${path}.backendPackageArtifactHash`, record.subject?.approvalService?.packageArtifactHash);
  requireExact(errors, observation.parentCommitSha, `${path}.parentCommitSha`, observation.backendCandidateCommitSha);
}

function validateDecision(errors, decision, path, expectedStatus, subjectHash, candidate = null) {
  if (!requireObject(errors, decision, path)) return;
  const keys = ["authority", "status", "decisionId", "immutableReference", "decidedAt", "statementSha256", "releaseSubjectSha256"];
  if (candidate !== null) {
    keys.push(
      "candidateDeploymentId",
      "immutableDeploymentUrl",
      "websiteCommitSha",
      "approvalServicePackageArtifactHash",
      "crossRepositoryAttestationCommitSha",
      "crossRepositoryBindingDocumentSha256",
    );
  }
  requireExactKeys(errors, decision, path, keys);
  requireExact(errors, decision.authority, `${path}.authority`, "command_center");
  requireExact(errors, decision.status, `${path}.status`, expectedStatus);
  requirePattern(errors, decision.decisionId, `${path}.decisionId`, /^cc-\d{8}-[a-z0-9][a-z0-9-]{2,119}$/, "a canonical Command Center decision id");
  validateReference(errors, decision.immutableReference, `${path}.immutableReference`);
  if (typeof decision.decisionId === "string") {
    requireExact(errors, decision.immutableReference, `${path}.immutableReference`, `command-center://decision/${decision.decisionId}`);
  }
  validateTimestamp(errors, decision.decidedAt, `${path}.decidedAt`);
  validateSha256(errors, decision.statementSha256, `${path}.statementSha256`);
  requireExact(errors, decision.releaseSubjectSha256, `${path}.releaseSubjectSha256`, subjectHash);
  if (candidate !== null) {
    requireExact(errors, decision.candidateDeploymentId, `${path}.candidateDeploymentId`, candidate.deploymentId);
    requireExact(errors, decision.immutableDeploymentUrl, `${path}.immutableDeploymentUrl`, candidate.immutableDeploymentUrl);
    requireExact(errors, decision.websiteCommitSha, `${path}.websiteCommitSha`, candidate.websiteCommitSha);
    requireExact(errors, decision.approvalServicePackageArtifactHash, `${path}.approvalServicePackageArtifactHash`, candidate.approvalServicePackageArtifactHash);
    requireExact(errors, decision.crossRepositoryAttestationCommitSha, `${path}.crossRepositoryAttestationCommitSha`, candidate.crossRepositoryAttestationCommitSha);
    requireExact(errors, decision.crossRepositoryBindingDocumentSha256, `${path}.crossRepositoryBindingDocumentSha256`, candidate.crossRepositoryBindingDocumentSha256);
  }
}

function validateValidationGates(errors, gates, requirePassed) {
  if (!Array.isArray(gates)) {
    add(errors, "validation.gates", "must be an array");
    return;
  }
  const byId = new Map();
  for (const [index, gate] of gates.entries()) {
    const path = `validation.gates[${index}]`;
    if (!requireObject(errors, gate, path)) continue;
    requireExactKeys(errors, gate, path, ["id", "result", "evidenceSha256", "evidenceLocator", "completedAt"]);
    if (!requireString(errors, gate.id, `${path}.id`)) continue;
    if (byId.has(gate.id)) add(errors, `${path}.id`, "must be unique");
    byId.set(gate.id, gate);
    if (!new Set(["pending", "passed", "failed"]).has(gate.result)) {
      add(errors, `${path}.result`, "must be pending, passed, or failed");
    }
    if (gate.result === "passed") {
      validateSha256(errors, gate.evidenceSha256, `${path}.evidenceSha256`);
      validateReference(errors, gate.evidenceLocator, `${path}.evidenceLocator`);
      validateTimestamp(errors, gate.completedAt, `${path}.completedAt`);
    } else {
      if (gate.evidenceSha256 !== null) add(errors, `${path}.evidenceSha256`, "must be null unless passed");
      if (gate.evidenceLocator !== null) add(errors, `${path}.evidenceLocator`, "must be null unless passed");
      if (gate.completedAt !== null) add(errors, `${path}.completedAt`, "must be null unless passed");
    }
  }
  for (const id of REQUIRED_VALIDATION_GATES) {
    if (!byId.has(id)) add(errors, "validation.gates", `missing required gate ${id}`);
    else if (requirePassed && byId.get(id).result !== "passed") add(errors, `validation.gates.${id}`, "must be passed");
  }
  for (const id of byId.keys()) {
    if (!REQUIRED_VALIDATION_GATES.includes(id)) add(errors, "validation.gates", `unexpected gate ${id}`);
  }
}

function validateDependencies(errors, dependencies, crossRepositoryAttestation) {
  if (!requireObject(errors, dependencies, "productionDependencies")) return;
  requireExactKeys(errors, dependencies, "productionDependencies", [
    "websiteProjection",
    "approvalService",
    "identity",
    "sessionAuthority",
    "ethereum",
    "targets",
  ]);
  const projection = dependencies.websiteProjection;
  if (requireObject(errors, projection, "productionDependencies.websiteProjection")) {
    requireExactKeys(errors, projection, "productionDependencies.websiteProjection", ["databaseIdentity", "migrationInventory", "migrationDigest", "runtimeRoleAttestationSha256", "backupId", "restoreDrillEvidenceSha256"]);
    requireString(errors, projection.databaseIdentity, "productionDependencies.websiteProjection.databaseIdentity");
    if (!Array.isArray(projection.migrationInventory)
      || projection.migrationInventory.length !== WEBSITE_PROJECTION_MIGRATIONS.length) {
      add(
        errors,
        "productionDependencies.websiteProjection.migrationInventory",
        "must contain the complete ordered 0001, 0002, and 0003 inventory",
      );
    } else {
      for (const [index, expected] of WEBSITE_PROJECTION_MIGRATIONS.entries()) {
        const migration = projection.migrationInventory[index];
        const path = `productionDependencies.websiteProjection.migrationInventory[${index}]`;
        if (!requireObject(errors, migration, path)) continue;
        requireExactKeys(errors, migration, path, ["ordinal", "path", "fileSha256"]);
        requireExact(errors, migration.ordinal, `${path}.ordinal`, expected.ordinal);
        requireExact(errors, migration.path, `${path}.path`, expected.path);
        validateSha256(errors, migration.fileSha256, `${path}.fileSha256`);
      }
      requireExact(
        errors,
        projection.migrationDigest,
        "productionDependencies.websiteProjection.migrationDigest",
        computeWebsiteProjectionMigrationDigest(projection),
      );
    }
    validateSha256(errors, projection.migrationDigest, "productionDependencies.websiteProjection.migrationDigest");
    validateSha256(errors, projection.runtimeRoleAttestationSha256, "productionDependencies.websiteProjection.runtimeRoleAttestationSha256");
    requireString(errors, projection.backupId, "productionDependencies.websiteProjection.backupId");
    validateSha256(errors, projection.restoreDrillEvidenceSha256, "productionDependencies.websiteProjection.restoreDrillEvidenceSha256");
  }
  const service = dependencies.approvalService;
  if (requireObject(errors, service, "productionDependencies.approvalService")) {
    requireExactKeys(errors, service, "productionDependencies.approvalService", ["releaseIdentity", "migrationInventorySha256", "signerKeyId", "signerEpoch", "signerComponentBindingSha256", "controlAxisGenerationsSha256", "readyzEvidenceSha256"]);
    requireString(errors, service.releaseIdentity, "productionDependencies.approvalService.releaseIdentity");
    validateSha256(errors, service.migrationInventorySha256, "productionDependencies.approvalService.migrationInventorySha256");
    requireString(errors, service.signerKeyId, "productionDependencies.approvalService.signerKeyId");
    if (!Number.isSafeInteger(service.signerEpoch) || service.signerEpoch <= 0) add(errors, "productionDependencies.approvalService.signerEpoch", "must be a positive safe integer");
    validateSha256(errors, service.signerComponentBindingSha256, "productionDependencies.approvalService.signerComponentBindingSha256");
    validateSha256(errors, service.controlAxisGenerationsSha256, "productionDependencies.approvalService.controlAxisGenerationsSha256");
    validateSha256(errors, service.readyzEvidenceSha256, "productionDependencies.approvalService.readyzEvidenceSha256");
  }
  const identity = dependencies.identity;
  if (requireObject(errors, identity, "productionDependencies.identity")) {
    requireExactKeys(errors, identity, "productionDependencies.identity", ["privyApplicationId", "githubOauthEnabled", "identityTokensEnabled"]);
    requirePattern(errors, identity.privyApplicationId, "productionDependencies.identity.privyApplicationId", SAFE_ID_PATTERN, "a bounded public Privy application id");
    requireExact(errors, identity.githubOauthEnabled, "productionDependencies.identity.githubOauthEnabled", true);
    requireExact(errors, identity.identityTokensEnabled, "productionDependencies.identity.identityTokensEnabled", true);
  }
  const sessionAuthority = dependencies.sessionAuthority;
  if (requireObject(errors, sessionAuthority, "productionDependencies.sessionAuthority")) {
    requireExactKeys(errors, sessionAuthority, "productionDependencies.sessionAuthority", [
      "audience",
      "keyId",
      "keyEpoch",
      "authorityPublicKeySpkiSha256",
      "workloadIssuer",
      "workloadSubject",
      "workloadKeyId",
      "workloadPublicKeySpkiSha256",
      "configurationEvidenceSha256",
    ]);
    for (const [field, label] of [
      ["audience", "authority audience"],
      ["keyId", "authority key id"],
      ["keyEpoch", "authority key epoch"],
      ["workloadIssuer", "workload issuer"],
      ["workloadSubject", "workload subject"],
      ["workloadKeyId", "workload key id"],
    ]) {
      requirePattern(
        errors,
        sessionAuthority[field],
        `productionDependencies.sessionAuthority.${field}`,
        SAFE_ID_PATTERN,
        `a bounded ${label}`,
      );
    }
    validateSha256(
      errors,
      sessionAuthority.authorityPublicKeySpkiSha256,
      "productionDependencies.sessionAuthority.authorityPublicKeySpkiSha256",
    );
    validateSha256(
      errors,
      sessionAuthority.workloadPublicKeySpkiSha256,
      "productionDependencies.sessionAuthority.workloadPublicKeySpkiSha256",
    );
    validateSha256(
      errors,
      sessionAuthority.configurationEvidenceSha256,
      "productionDependencies.sessionAuthority.configurationEvidenceSha256",
    );
    requireExact(
      errors,
      sessionAuthority.configurationEvidenceSha256,
      "productionDependencies.sessionAuthority.configurationEvidenceSha256",
      computeSessionAuthorityConfigurationEvidenceSha256(
        dependencies,
        crossRepositoryAttestation?.productionAuthorityCandidateCommitSha,
      ),
    );
  }
  const ethereum = dependencies.ethereum;
  if (requireObject(errors, ethereum, "productionDependencies.ethereum")) {
    requireExactKeys(errors, ethereum, "productionDependencies.ethereum", ["chainId", "chainProfileSha256", "finalizedRpcBindings"]);
    requireExact(errors, ethereum.chainId, "productionDependencies.ethereum.chainId", "1");
    validateSha256(errors, ethereum.chainProfileSha256, "productionDependencies.ethereum.chainProfileSha256");
    if (!Array.isArray(ethereum.finalizedRpcBindings) || ethereum.finalizedRpcBindings.length !== 2) {
      add(errors, "productionDependencies.ethereum.finalizedRpcBindings", "must contain exactly two independent bindings");
    } else {
      const providers = new Set();
      for (const [index, binding] of ethereum.finalizedRpcBindings.entries()) {
        const path = `productionDependencies.ethereum.finalizedRpcBindings[${index}]`;
        if (!requireObject(errors, binding, path)) continue;
        requireExactKeys(errors, binding, path, ["providerId", "bindingSha256"]);
        requireString(errors, binding.providerId, `${path}.providerId`);
        validateSha256(errors, binding.bindingSha256, `${path}.bindingSha256`);
        providers.add(binding.providerId);
      }
      if (providers.size !== 2) add(errors, "productionDependencies.ethereum.finalizedRpcBindings", "provider ids must be distinct");
    }
  }
  const targets = dependencies.targets;
  if (requireObject(errors, targets, "productionDependencies.targets")) {
    requireExactKeys(errors, targets, "productionDependencies.targets", ["registryBindingSha256", "websiteProjectionBindingSha256"]);
    validateSha256(errors, targets.registryBindingSha256, "productionDependencies.targets.registryBindingSha256");
    validateSha256(errors, targets.websiteProjectionBindingSha256, "productionDependencies.targets.websiteProjectionBindingSha256");
  }
}

function validateRollback(errors, rollback) {
  if (!requireObject(errors, rollback, "deployment.rollback")) return;
  requireExactKeys(errors, rollback, "deployment.rollback", ["deploymentId", "immutableDeploymentUrl", "websiteCommitSha", "productionAlias", "configurationSnapshotSha256", "capturedAt"]);
  requireString(errors, rollback.deploymentId, "deployment.rollback.deploymentId");
  validateImmutableCandidateUrl(errors, rollback.immutableDeploymentUrl, "deployment.rollback.immutableDeploymentUrl");
  validateCommit(errors, rollback.websiteCommitSha, "deployment.rollback.websiteCommitSha");
  requireExact(
    errors,
    rollback.productionAlias,
    "deployment.rollback.productionAlias",
    "https://programmable.market",
  );
  validateSha256(errors, rollback.configurationSnapshotSha256, "deployment.rollback.configurationSnapshotSha256");
  validateTimestamp(errors, rollback.capturedAt, "deployment.rollback.capturedAt");
}

function validateCandidate(
  errors,
  candidate,
  websiteCommitSha,
  packageArtifactHash,
  crossRepositoryBinding,
) {
  if (!requireObject(errors, candidate, "deployment.candidate")) return;
  requireExactKeys(errors, candidate, "deployment.candidate", ["deploymentId", "immutableDeploymentUrl", "websiteCommitSha", "approvalServicePackageArtifactHash", "crossRepositoryAttestationCommitSha", "crossRepositoryBindingDocumentSha256", "verified", "verificationEvidenceSha256", "verifiedAt"]);
  requireString(errors, candidate.deploymentId, "deployment.candidate.deploymentId");
  validateImmutableCandidateUrl(errors, candidate.immutableDeploymentUrl, "deployment.candidate.immutableDeploymentUrl");
  if (candidate.immutableDeploymentUrl === "https://programmable.market") {
    add(errors, "deployment.candidate.immutableDeploymentUrl", "must be an immutable candidate URL, not the production alias");
  }
  requireExact(errors, candidate.websiteCommitSha, "deployment.candidate.websiteCommitSha", websiteCommitSha);
  requireExact(errors, candidate.approvalServicePackageArtifactHash, "deployment.candidate.approvalServicePackageArtifactHash", packageArtifactHash);
  requireExact(errors, candidate.crossRepositoryAttestationCommitSha, "deployment.candidate.crossRepositoryAttestationCommitSha", crossRepositoryBinding?.attestationCommitSha);
  requireExact(errors, candidate.crossRepositoryBindingDocumentSha256, "deployment.candidate.crossRepositoryBindingDocumentSha256", crossRepositoryBinding?.documentSha256);
  requireExact(errors, candidate.verified, "deployment.candidate.verified", true);
  validateSha256(errors, candidate.verificationEvidenceSha256, "deployment.candidate.verificationEvidenceSha256");
  validateTimestamp(errors, candidate.verifiedAt, "deployment.candidate.verifiedAt");
}

function validateWorkflow(errors, workflow, websiteCommitSha, candidate) {
  if (!requireObject(errors, workflow, "promotionGate.workflow")) return;
  requireExactKeys(errors, workflow, "promotionGate.workflow", ["repository", "workflowFile", "eventName", "ref", "environment", "runId", "runAttempt", "runUrl", "commitSha", "verifiedCommitSha", "conclusion", "candidateDeploymentId", "immutableDeploymentUrl", "approvalServicePackageArtifactHash", "crossRepositoryAttestationCommitSha", "crossRepositoryBindingDocumentSha256", "candidateVerified", "verificationEvidenceSha256"]);
  requireExact(errors, workflow.repository, "promotionGate.workflow.repository", "0xprogrammable/programmable");
  requireExact(errors, workflow.workflowFile, "promotionGate.workflow.workflowFile", ".github/workflows/deploy-production.yml");
  requireExact(errors, workflow.eventName, "promotionGate.workflow.eventName", "workflow_dispatch");
  requireExact(errors, workflow.ref, "promotionGate.workflow.ref", "refs/heads/production");
  requireExact(errors, workflow.environment, "promotionGate.workflow.environment", "production");
  if (!Number.isSafeInteger(workflow.runId) || workflow.runId <= 0) add(errors, "promotionGate.workflow.runId", "must be a positive safe integer");
  if (!Number.isSafeInteger(workflow.runAttempt) || workflow.runAttempt <= 0) add(errors, "promotionGate.workflow.runAttempt", "must be a positive safe integer");
  validateReference(errors, workflow.runUrl, "promotionGate.workflow.runUrl");
  if (Number.isSafeInteger(workflow.runId)) {
    requireExact(errors, workflow.runUrl, "promotionGate.workflow.runUrl", `https://github.com/0xprogrammable/programmable/actions/runs/${workflow.runId}`);
  }
  requireExact(errors, workflow.commitSha, "promotionGate.workflow.commitSha", websiteCommitSha);
  requireExact(errors, workflow.verifiedCommitSha, "promotionGate.workflow.verifiedCommitSha", websiteCommitSha);
  requireExact(errors, workflow.conclusion, "promotionGate.workflow.conclusion", "success");
  requireExact(errors, workflow.candidateDeploymentId, "promotionGate.workflow.candidateDeploymentId", candidate.deploymentId);
  requireExact(errors, workflow.immutableDeploymentUrl, "promotionGate.workflow.immutableDeploymentUrl", candidate.immutableDeploymentUrl);
  requireExact(errors, workflow.approvalServicePackageArtifactHash, "promotionGate.workflow.approvalServicePackageArtifactHash", candidate.approvalServicePackageArtifactHash);
  requireExact(errors, workflow.crossRepositoryAttestationCommitSha, "promotionGate.workflow.crossRepositoryAttestationCommitSha", candidate.crossRepositoryAttestationCommitSha);
  requireExact(errors, workflow.crossRepositoryBindingDocumentSha256, "promotionGate.workflow.crossRepositoryBindingDocumentSha256", candidate.crossRepositoryBindingDocumentSha256);
  requireExact(errors, workflow.candidateVerified, "promotionGate.workflow.candidateVerified", true);
  validateSha256(errors, workflow.verificationEvidenceSha256, "promotionGate.workflow.verificationEvidenceSha256");
}

export function verifyReleaseRecord(
  record,
  { require = "template", expected = {}, crossRepositoryAttestation = null } = {},
) {
  if (!REQUIRED_LEVELS.has(require)) throw new Error(`unsupported verification level: ${require}`);
  const schemaFailure = releaseRecordSchemaFailure(record);
  if (schemaFailure !== null) return schemaFailure;
  const errors = [];
  const levels = ["template", "clearance", "staging", "candidate", "promotion", "live"];
  const requiredIndex = require === "dark_staging" ? 2 : levels.indexOf(require);
  requireExactKeys(errors, record, "$", ["schemaVersion", "recordStatus", "createdAt", "releaseIntent", "subject", "commandCenter", "validation", "productionDependencies", "deployment", "promotionGate", "canary"]);
  const allowPlaceholders = require === "template";
  walkForSecretsAndPlaceholders(record, "", errors, allowPlaceholders);
  requireExact(errors, record.schemaVersion, "schemaVersion", SCHEMA_VERSION);
  if (!RECORD_STATUSES.has(record.recordStatus)) add(errors, "recordStatus", "is not a supported state");
  validateTimestamp(errors, record.createdAt, "createdAt", { nullable: allowPlaceholders });

  const intent = record.releaseIntent;
  if (requireObject(errors, intent, "releaseIntent")) {
    requireExactKeys(errors, intent, "releaseIntent", ["releaseId", "product", "chainId", "reviewAuthorityMode", "targetMode"]);
    requireString(errors, intent.releaseId, "releaseIntent.releaseId");
    requireExact(errors, intent.product, "releaseIntent.product", "custom_launch");
    requireExact(errors, intent.chainId, "releaseIntent.chainId", "1");
    if (!REVIEW_AUTHORITY_MODES.has(intent.reviewAuthorityMode)) {
      add(errors, "releaseIntent.reviewAuthorityMode", "must be manual_review or autonomous_ai");
    }
    if (!new Set(["disabled", "enabled"]).has(intent.targetMode)) add(errors, "releaseIntent.targetMode", "must be disabled or enabled");
  }

  const website = record.subject?.website;
  const service = record.subject?.approvalService;
  const crossRepositoryBinding = record.subject?.crossRepositoryReleaseBinding;
  if (requireObject(errors, record.subject, "subject")) {
    requireExactKeys(errors, record.subject, "subject", ["website", "approvalService", "crossRepositoryReleaseBinding", "releaseSubjectSha256"]);
    if (requireObject(errors, website, "subject.website")) {
      requireExactKeys(errors, website, "subject.website", ["repository", "commitSha", "reviewedDiffBaseSha", "reviewedDiffHeadSha", "reviewedDiffSha256"]);
      requireExact(errors, website.repository, "subject.website.repository", "0xprogrammable/programmable");
      validateCommit(errors, website.commitSha, "subject.website.commitSha", { nullable: allowPlaceholders });
      validateCommit(errors, website.reviewedDiffBaseSha, "subject.website.reviewedDiffBaseSha", { nullable: allowPlaceholders });
      validateCommit(errors, website.reviewedDiffHeadSha, "subject.website.reviewedDiffHeadSha", { nullable: allowPlaceholders });
      validateSha256(errors, website.reviewedDiffSha256, "subject.website.reviewedDiffSha256", { nullable: allowPlaceholders });
      if (!allowPlaceholders && website.reviewedDiffHeadSha !== website.commitSha) add(errors, "subject.website.reviewedDiffHeadSha", "must equal the released Website commit");
    }
    if (requireObject(errors, service, "subject.approvalService")) {
      requireExactKeys(errors, service, "subject.approvalService", ["packageArtifactHash", "detachedPackedArtifactFileSha256", "productionContentManifestSha256", "reviewAuthorityMode"]);
      validateSha256(errors, service.packageArtifactHash, "subject.approvalService.packageArtifactHash", { nullable: allowPlaceholders });
      validateSha256(errors, service.detachedPackedArtifactFileSha256, "subject.approvalService.detachedPackedArtifactFileSha256", { nullable: allowPlaceholders });
      validateSha256(errors, service.productionContentManifestSha256, "subject.approvalService.productionContentManifestSha256", { nullable: allowPlaceholders });
      if (!REVIEW_AUTHORITY_MODES.has(service.reviewAuthorityMode)) {
        add(errors, "subject.approvalService.reviewAuthorityMode", "must be manual_review or autonomous_ai");
      }
      requireExact(
        errors,
        service.reviewAuthorityMode,
        "subject.approvalService.reviewAuthorityMode",
        intent?.reviewAuthorityMode,
      );
    }
    if (requireObject(errors, crossRepositoryBinding, "subject.crossRepositoryReleaseBinding")) {
      requireExactKeys(errors, crossRepositoryBinding, "subject.crossRepositoryReleaseBinding", ["repository", "attestationCommitSha", "documentPath", "documentSha256"]);
      requireExact(errors, crossRepositoryBinding.repository, "subject.crossRepositoryReleaseBinding.repository", CROSS_REPOSITORY_BINDING_REPOSITORY);
      validateCommit(errors, crossRepositoryBinding.attestationCommitSha, "subject.crossRepositoryReleaseBinding.attestationCommitSha", { nullable: allowPlaceholders });
      requireExact(errors, crossRepositoryBinding.documentPath, "subject.crossRepositoryReleaseBinding.documentPath", CROSS_REPOSITORY_BINDING_DOCUMENT_PATH);
      validateSha256(errors, crossRepositoryBinding.documentSha256, "subject.crossRepositoryReleaseBinding.documentSha256", { nullable: allowPlaceholders });
    }
  }

  const subjectHash = computeReleaseSubjectSha256(record);
  if (!allowPlaceholders) requireExact(errors, record.subject?.releaseSubjectSha256, "subject.releaseSubjectSha256", subjectHash);
  else if (record.subject?.releaseSubjectSha256 !== null) validateSha256(errors, record.subject.releaseSubjectSha256, "subject.releaseSubjectSha256");

  validateValidationGates(errors, record.validation?.gates, require !== "template" && require !== "clearance");
  if (requireObject(errors, record.commandCenter, "commandCenter")) requireExactKeys(errors, record.commandCenter, "commandCenter", ["freezeClearance", "promotionApproval", "liveDeclaration"]);
  if (requireObject(errors, record.validation, "validation")) requireExactKeys(errors, record.validation, "validation", ["gates"]);
  if (requireObject(errors, record.deployment, "deployment")) requireExactKeys(errors, record.deployment, "deployment", ["rollback", "candidate", "promoted"]);
  if (requireObject(errors, record.promotionGate, "promotionGate")) requireExactKeys(errors, record.promotionGate, "promotionGate", ["status", "workflow"]);
  if (requireObject(errors, record.canary, "canary")) requireExactKeys(errors, record.canary, "canary", ["status", "evidenceSha256", "evidenceLocator", "completedAt"]);

  if (requiredIndex >= 1) {
    validateCrossRepositoryObservation(errors, crossRepositoryAttestation, record);
    validateDecision(errors, record.commandCenter?.freezeClearance, "commandCenter.freezeClearance", "cleared", subjectHash);
    validateChronology(errors, record.createdAt, record.commandCenter?.freezeClearance?.decidedAt, "commandCenter.freezeClearance.decidedAt");
    if (!["freeze_cleared", "candidate_verified", "promotion_approved", "promoted", "live"].includes(record.recordStatus)) {
      add(errors, "recordStatus", "must reflect freeze clearance");
    }
  }
  if (requiredIndex >= 2) {
    validateDependencies(
      errors,
      record.productionDependencies,
      crossRepositoryAttestation,
    );
    validateRollback(errors, record.deployment?.rollback);
    requireExact(
      errors,
      record.releaseIntent?.targetMode,
      "releaseIntent.targetMode",
      require === "dark_staging" ? "disabled" : "enabled",
    );
    validateChronology(
      errors,
      record.deployment?.rollback?.capturedAt,
      record.commandCenter?.freezeClearance?.decidedAt,
      "commandCenter.freezeClearance.decidedAt",
    );
    for (const gate of record.validation?.gates ?? []) {
      validateChronology(
        errors,
        gate.completedAt,
        record.commandCenter?.freezeClearance?.decidedAt,
        "commandCenter.freezeClearance.decidedAt",
      );
    }
  }
  if (requiredIndex === 2) {
    requireExact(errors, record.recordStatus, "recordStatus", "freeze_cleared");
    requireExact(errors, record.promotionGate?.status, "promotionGate.status", "blocked");
    requireExact(errors, record.commandCenter?.promotionApproval?.status, "commandCenter.promotionApproval.status", "pending");
    requireExact(errors, record.commandCenter?.liveDeclaration?.status, "commandCenter.liveDeclaration.status", "pending");
    for (const [path, value] of [
      ["deployment.candidate.deploymentId", record.deployment?.candidate?.deploymentId],
      ["deployment.candidate.immutableDeploymentUrl", record.deployment?.candidate?.immutableDeploymentUrl],
      ["deployment.candidate.websiteCommitSha", record.deployment?.candidate?.websiteCommitSha],
      ["deployment.candidate.approvalServicePackageArtifactHash", record.deployment?.candidate?.approvalServicePackageArtifactHash],
      ["deployment.candidate.crossRepositoryAttestationCommitSha", record.deployment?.candidate?.crossRepositoryAttestationCommitSha],
      ["deployment.candidate.crossRepositoryBindingDocumentSha256", record.deployment?.candidate?.crossRepositoryBindingDocumentSha256],
      ["deployment.candidate.verified", record.deployment?.candidate?.verified],
      ["deployment.candidate.verificationEvidenceSha256", record.deployment?.candidate?.verificationEvidenceSha256],
      ["deployment.candidate.verifiedAt", record.deployment?.candidate?.verifiedAt],
      ["promotionGate.workflow.runId", record.promotionGate?.workflow?.runId],
      ["promotionGate.workflow.runAttempt", record.promotionGate?.workflow?.runAttempt],
      ["promotionGate.workflow.runUrl", record.promotionGate?.workflow?.runUrl],
      ["promotionGate.workflow.commitSha", record.promotionGate?.workflow?.commitSha],
      ["promotionGate.workflow.verifiedCommitSha", record.promotionGate?.workflow?.verifiedCommitSha],
      ["promotionGate.workflow.conclusion", record.promotionGate?.workflow?.conclusion],
      ["promotionGate.workflow.candidateDeploymentId", record.promotionGate?.workflow?.candidateDeploymentId],
      ["promotionGate.workflow.immutableDeploymentUrl", record.promotionGate?.workflow?.immutableDeploymentUrl],
      ["promotionGate.workflow.approvalServicePackageArtifactHash", record.promotionGate?.workflow?.approvalServicePackageArtifactHash],
      ["promotionGate.workflow.crossRepositoryAttestationCommitSha", record.promotionGate?.workflow?.crossRepositoryAttestationCommitSha],
      ["promotionGate.workflow.crossRepositoryBindingDocumentSha256", record.promotionGate?.workflow?.crossRepositoryBindingDocumentSha256],
      ["promotionGate.workflow.candidateVerified", record.promotionGate?.workflow?.candidateVerified],
      ["promotionGate.workflow.verificationEvidenceSha256", record.promotionGate?.workflow?.verificationEvidenceSha256],
      ["commandCenter.promotionApproval.decisionId", record.commandCenter?.promotionApproval?.decisionId],
      ["commandCenter.promotionApproval.immutableReference", record.commandCenter?.promotionApproval?.immutableReference],
      ["commandCenter.promotionApproval.decidedAt", record.commandCenter?.promotionApproval?.decidedAt],
      ["commandCenter.promotionApproval.statementSha256", record.commandCenter?.promotionApproval?.statementSha256],
      ["commandCenter.promotionApproval.releaseSubjectSha256", record.commandCenter?.promotionApproval?.releaseSubjectSha256],
      ["commandCenter.promotionApproval.candidateDeploymentId", record.commandCenter?.promotionApproval?.candidateDeploymentId],
      ["commandCenter.promotionApproval.immutableDeploymentUrl", record.commandCenter?.promotionApproval?.immutableDeploymentUrl],
      ["commandCenter.promotionApproval.websiteCommitSha", record.commandCenter?.promotionApproval?.websiteCommitSha],
      ["commandCenter.promotionApproval.approvalServicePackageArtifactHash", record.commandCenter?.promotionApproval?.approvalServicePackageArtifactHash],
      ["commandCenter.promotionApproval.crossRepositoryAttestationCommitSha", record.commandCenter?.promotionApproval?.crossRepositoryAttestationCommitSha],
      ["commandCenter.promotionApproval.crossRepositoryBindingDocumentSha256", record.commandCenter?.promotionApproval?.crossRepositoryBindingDocumentSha256],
      ["commandCenter.liveDeclaration.decisionId", record.commandCenter?.liveDeclaration?.decisionId],
      ["commandCenter.liveDeclaration.immutableReference", record.commandCenter?.liveDeclaration?.immutableReference],
      ["commandCenter.liveDeclaration.decidedAt", record.commandCenter?.liveDeclaration?.decidedAt],
      ["commandCenter.liveDeclaration.statementSha256", record.commandCenter?.liveDeclaration?.statementSha256],
      ["commandCenter.liveDeclaration.releaseSubjectSha256", record.commandCenter?.liveDeclaration?.releaseSubjectSha256],
      ["commandCenter.liveDeclaration.candidateDeploymentId", record.commandCenter?.liveDeclaration?.candidateDeploymentId],
      ["commandCenter.liveDeclaration.immutableDeploymentUrl", record.commandCenter?.liveDeclaration?.immutableDeploymentUrl],
      ["commandCenter.liveDeclaration.websiteCommitSha", record.commandCenter?.liveDeclaration?.websiteCommitSha],
      ["commandCenter.liveDeclaration.approvalServicePackageArtifactHash", record.commandCenter?.liveDeclaration?.approvalServicePackageArtifactHash],
      ["commandCenter.liveDeclaration.crossRepositoryAttestationCommitSha", record.commandCenter?.liveDeclaration?.crossRepositoryAttestationCommitSha],
      ["commandCenter.liveDeclaration.crossRepositoryBindingDocumentSha256", record.commandCenter?.liveDeclaration?.crossRepositoryBindingDocumentSha256],
      ["deployment.promoted.deploymentId", record.deployment?.promoted?.deploymentId],
      ["deployment.promoted.immutableDeploymentUrl", record.deployment?.promoted?.immutableDeploymentUrl],
      ["deployment.promoted.productionAlias", record.deployment?.promoted?.productionAlias],
      ["deployment.promoted.postPromotionEvidenceSha256", record.deployment?.promoted?.postPromotionEvidenceSha256],
      ["deployment.promoted.promotedAt", record.deployment?.promoted?.promotedAt],
      ["canary.evidenceSha256", record.canary?.evidenceSha256],
      ["canary.evidenceLocator", record.canary?.evidenceLocator],
      ["canary.completedAt", record.canary?.completedAt],
    ]) {
      if (value !== null) add(errors, path, "must remain null before candidate staging");
    }
    requireExact(errors, record.canary?.status, "canary.status", "pending");
  }
  if (requiredIndex >= 3) {
    requireExact(errors, record.releaseIntent?.targetMode, "releaseIntent.targetMode", "enabled");
    validateCandidate(
      errors,
      record.deployment?.candidate,
      website?.commitSha,
      service?.packageArtifactHash,
      crossRepositoryBinding,
    );
    validateWorkflow(errors, record.promotionGate?.workflow, website?.commitSha, record.deployment?.candidate ?? {});
    validateChronology(errors, record.commandCenter?.freezeClearance?.decidedAt, record.deployment?.candidate?.verifiedAt, "deployment.candidate.verifiedAt");
    if (requiredIndex === 3) {
      requireExact(errors, record.promotionGate?.status, "promotionGate.status", "candidate_verified");
    } else if (!["promotion_authorized", "promoted"].includes(record.promotionGate?.status)) {
      add(errors, "promotionGate.status", "must preserve or advance the verified candidate gate");
    }
    if (!["candidate_verified", "promotion_approved", "promoted", "live"].includes(record.recordStatus)) {
      add(errors, "recordStatus", "must reflect candidate verification");
    }
  }
  if (requiredIndex >= 4) {
    validateDecision(
      errors,
      record.commandCenter?.promotionApproval,
      "commandCenter.promotionApproval",
      "approved",
      subjectHash,
      record.deployment?.candidate,
    );
    validateChronology(errors, record.deployment?.candidate?.verifiedAt, record.commandCenter?.promotionApproval?.decidedAt, "commandCenter.promotionApproval.decidedAt");
    if (requiredIndex === 4) {
      requireExact(errors, record.promotionGate?.status, "promotionGate.status", "promotion_authorized");
    } else if (record.promotionGate?.status !== "promoted") {
      add(errors, "promotionGate.status", "must preserve the promotion authorization in promoted state");
    }
    if (!["promotion_approved", "promoted", "live"].includes(record.recordStatus)) add(errors, "recordStatus", "must reflect promotion approval");
  }
  if (requiredIndex >= 5) {
    const promoted = record.deployment?.promoted;
    if (requireObject(errors, promoted, "deployment.promoted")) {
      requireExactKeys(errors, promoted, "deployment.promoted", ["deploymentId", "immutableDeploymentUrl", "productionAlias", "postPromotionEvidenceSha256", "promotedAt"]);
      requireExact(errors, promoted.deploymentId, "deployment.promoted.deploymentId", record.deployment?.candidate?.deploymentId);
      requireExact(errors, promoted.immutableDeploymentUrl, "deployment.promoted.immutableDeploymentUrl", record.deployment?.candidate?.immutableDeploymentUrl);
      validateImmutableCandidateUrl(errors, promoted.immutableDeploymentUrl, "deployment.promoted.immutableDeploymentUrl");
      requireExact(
        errors,
        promoted.productionAlias,
        "deployment.promoted.productionAlias",
        "https://programmable.market",
      );
      validateSha256(errors, promoted.postPromotionEvidenceSha256, "deployment.promoted.postPromotionEvidenceSha256");
      validateTimestamp(errors, promoted.promotedAt, "deployment.promoted.promotedAt");
      validateChronology(errors, record.commandCenter?.promotionApproval?.decidedAt, promoted.promotedAt, "deployment.promoted.promotedAt");
    }
    requireExact(errors, record.promotionGate?.status, "promotionGate.status", "promoted");
    const canary = record.canary;
    if (requireObject(errors, canary, "canary")) {
      requireExact(errors, canary.status, "canary.status", "passed");
      validateSha256(errors, canary.evidenceSha256, "canary.evidenceSha256");
      validateReference(errors, canary.evidenceLocator, "canary.evidenceLocator");
      validateTimestamp(errors, canary.completedAt, "canary.completedAt");
      validateChronology(errors, record.deployment?.promoted?.promotedAt, canary.completedAt, "canary.completedAt");
    }
    validateDecision(errors, record.commandCenter?.liveDeclaration, "commandCenter.liveDeclaration", "declared_live", subjectHash, record.deployment?.candidate);
    validateChronology(errors, record.canary?.completedAt, record.commandCenter?.liveDeclaration?.decidedAt, "commandCenter.liveDeclaration.decidedAt");
    requireExact(errors, record.releaseIntent?.targetMode, "releaseIntent.targetMode", "enabled");
    requireExact(errors, record.recordStatus, "recordStatus", "live");
  }

  if (require === "template") {
    requireExact(errors, record.recordStatus, "recordStatus", "draft");
    requireExact(errors, record.promotionGate?.status, "promotionGate.status", "blocked");
    requireExact(errors, record.commandCenter?.freezeClearance?.status, "commandCenter.freezeClearance.status", "pending");
    requireExact(errors, record.commandCenter?.promotionApproval?.status, "commandCenter.promotionApproval.status", "pending");
    requireExact(errors, record.commandCenter?.liveDeclaration?.status, "commandCenter.liveDeclaration.status", "pending");
  }

  if (expected.websiteCommitSha !== undefined) {
    requireExact(errors, website?.commitSha, "subject.website.commitSha", expected.websiteCommitSha);
  }
  if (expected.packageArtifactHash !== undefined) {
    requireExact(errors, service?.packageArtifactHash, "subject.approvalService.packageArtifactHash", expected.packageArtifactHash);
  }
  if (expected.crossRepositoryAttestationCommitSha !== undefined) {
    requireExact(errors, crossRepositoryBinding?.attestationCommitSha, "subject.crossRepositoryReleaseBinding.attestationCommitSha", expected.crossRepositoryAttestationCommitSha);
  }
  if (expected.crossRepositoryBindingDocumentSha256 !== undefined) {
    requireExact(errors, crossRepositoryBinding?.documentSha256, "subject.crossRepositoryReleaseBinding.documentSha256", expected.crossRepositoryBindingDocumentSha256);
  }
  if (expected.rollbackDeploymentId !== undefined) {
    requireExact(errors, record.deployment?.rollback?.deploymentId, "deployment.rollback.deploymentId", expected.rollbackDeploymentId);
  }
  if (expected.rollbackDeploymentUrl !== undefined) {
    requireExact(errors, record.deployment?.rollback?.immutableDeploymentUrl, "deployment.rollback.immutableDeploymentUrl", expected.rollbackDeploymentUrl);
  }
  if (expected.rollbackWebsiteCommitSha !== undefined) {
    requireExact(errors, record.deployment?.rollback?.websiteCommitSha, "deployment.rollback.websiteCommitSha", expected.rollbackWebsiteCommitSha);
  }
  if (expected.sessionAuthorityConfigurationEvidenceSha256 !== undefined) {
    requireExact(
      errors,
      record.productionDependencies?.sessionAuthority?.configurationEvidenceSha256,
      "productionDependencies.sessionAuthority.configurationEvidenceSha256",
      expected.sessionAuthorityConfigurationEvidenceSha256,
    );
  }

  const detachedRecordSha256 = computeDetachedRecordSha256(record);
  if (expected.detachedRecordSha256 !== undefined) {
    requireExact(errors, detachedRecordSha256, "detachedRecordSha256", expected.detachedRecordSha256);
  }

  return {
    ok: errors.length === 0,
    errors,
    releaseSubjectSha256: subjectHash,
    detachedRecordSha256,
  };
}

function parseArguments(argv) {
  let file = null;
  let require = "template";
  let json = false;
  let githubOutput = null;
  let verifyCrossRepositoryAttestation = false;
  let crossRepositoryAttestationSummary = null;
  const expected = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--require") require = argv[++index];
    else if (argument === "--json") json = true;
    else if (argument === "--github-output") githubOutput = argv[++index];
    else if (argument === "--verify-cross-repository-attestation") verifyCrossRepositoryAttestation = true;
    else if (argument === "--cross-repository-attestation-summary") crossRepositoryAttestationSummary = argv[++index];
    else if (argument === "--expect-website-commit") expected.websiteCommitSha = argv[++index];
    else if (argument === "--expect-package-artifact-hash") expected.packageArtifactHash = argv[++index];
    else if (argument === "--expect-cross-repository-attestation-commit") expected.crossRepositoryAttestationCommitSha = argv[++index];
    else if (argument === "--expect-cross-repository-binding-document-sha256") expected.crossRepositoryBindingDocumentSha256 = argv[++index];
    else if (argument === "--expect-rollback-deployment-id") expected.rollbackDeploymentId = argv[++index];
    else if (argument === "--expect-rollback-deployment-url") expected.rollbackDeploymentUrl = argv[++index];
    else if (argument === "--expect-rollback-website-commit") expected.rollbackWebsiteCommitSha = argv[++index];
    else if (argument === "--expect-session-authority-configuration-evidence-sha256") expected.sessionAuthorityConfigurationEvidenceSha256 = argv[++index];
    else if (argument === "--expect-detached-record-sha256") expected.detachedRecordSha256 = argv[++index];
    else if (argument.startsWith("-")) throw new Error(`unknown argument: ${argument}`);
    else if (file === null) file = argument;
    else throw new Error(`unexpected argument: ${argument}`);
  }
  if (file === null) throw new Error("usage: verify-custom-launch-release-record.mjs <record.json> [--require template|clearance|dark_staging|staging|candidate|promotion|live] [--verify-cross-repository-attestation] [--cross-repository-attestation-summary path] [--json] [--github-output path] [expectation flags]");
  if (crossRepositoryAttestationSummary !== null && !verifyCrossRepositoryAttestation) {
    throw new Error("cross-repository attestation summary output requires live attestation verification");
  }
  return {
    file,
    require,
    json,
    githubOutput,
    verifyCrossRepositoryAttestation,
    crossRepositoryAttestationSummary,
    expected,
  };
}

async function main(argv) {
  const options = parseArguments(argv);
  const record = JSON.parse(await readFile(options.file, "utf8"));
  const schemaFailure = releaseRecordSchemaFailure(record);
  if (schemaFailure !== null) {
    writeResult(schemaFailure, options);
    process.exitCode = 1;
    return;
  }
  const crossRepositoryAttestation = options.verifyCrossRepositoryAttestation
    ? await verifyCrossRepositoryReleaseBindingFromGitHubV1({
      attestationCommitSha:
        record.subject?.crossRepositoryReleaseBinding?.attestationCommitSha,
      expectedDocumentSha256:
        record.subject?.crossRepositoryReleaseBinding?.documentSha256,
      expectedWebsiteCommitSha:
        options.expected.websiteCommitSha ?? record.subject?.website?.commitSha,
      expectedBackendPackageArtifactHash:
        options.expected.packageArtifactHash
          ?? record.subject?.approvalService?.packageArtifactHash,
      githubToken: process.env.PROGRAMMABLE_BACKEND_RELEASE_READ_TOKEN,
    })
    : null;
  const result = verifyReleaseRecord(record, {
    require: options.require,
    expected: options.expected,
    crossRepositoryAttestation,
  });
  writeResult(result, options);
  if (result.ok && options.githubOutput !== null) {
    await appendFile(
      options.githubOutput,
      [
        `release_subject_sha256=${result.releaseSubjectSha256}`,
        `detached_record_sha256=${result.detachedRecordSha256}`,
        `cross_repository_attestation_commit_sha=${record.subject.crossRepositoryReleaseBinding.attestationCommitSha}`,
        `cross_repository_binding_document_sha256=${record.subject.crossRepositoryReleaseBinding.documentSha256}`,
        `review_authority_mode=${record.releaseIntent.reviewAuthorityMode}`,
        `website_projection_migration_digest=${record.productionDependencies.websiteProjection.migrationDigest}`,
        `session_authority_configuration_evidence_sha256=${record.productionDependencies.sessionAuthority.configurationEvidenceSha256}`,
        `session_authority_runtime_configuration_hash=${computeSessionAuthorityRuntimeConfigurationHash(record.productionDependencies)}`,
        "",
      ].join("\n"),
      { encoding: "utf8", mode: 0o600 },
    );
  }
  if (result.ok && options.crossRepositoryAttestationSummary !== null) {
    await writeFile(
      options.crossRepositoryAttestationSummary,
      `${JSON.stringify(crossRepositoryAttestation, null, 2)}\n`,
      { encoding: "utf8", flag: "wx", mode: 0o600 },
    );
  }
  if (!result.ok) process.exitCode = 1;
}

function writeResult(result, options) {
  if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else {
    process.stdout.write(`release subject: ${result.releaseSubjectSha256}\n`);
    process.stdout.write(`detached record: ${result.detachedRecordSha256}\n`);
    process.stdout.write(`required level: ${options.require}\n`);
    process.stdout.write(`result: ${result.ok ? "passed" : "blocked"}\n`);
    for (const error of result.errors) process.stderr.write(`- ${error}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
