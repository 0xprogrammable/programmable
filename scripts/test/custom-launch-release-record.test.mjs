import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  computeDetachedRecordSha256,
  computeReleaseSubjectSha256,
  computeSessionAuthorityConfigurationEvidenceSha256,
  computeSessionAuthorityRuntimeConfigurationHash,
  computeWebsiteProjectionMigrationDigest,
  verifyReleaseRecord as verifyReleaseRecordCore,
} from "../verify-custom-launch-release-record.mjs";

const TEMPLATE_URL = new URL(
  "../../docs/operations/releases/custom-launch-v1/release-record.template.json",
  import.meta.url,
);
const SCHEMA_URL = new URL(
  "../../docs/operations/releases/custom-launch-v1/release-record.schema.json",
  import.meta.url,
);
const VERIFIER_PATH = fileURLToPath(new URL(
  "../verify-custom-launch-release-record.mjs",
  import.meta.url,
));

const commits = {
  website: "1".repeat(40),
  base: "2".repeat(40),
  other: "3".repeat(40),
  backendAttestation: "4".repeat(40),
  productionAuthority: "9".repeat(40),
};
const hashes = Object.freeze({
  a: `sha256:${"a".repeat(64)}`,
  b: `sha256:${"b".repeat(64)}`,
  c: `sha256:${"c".repeat(64)}`,
  d: `sha256:${"d".repeat(64)}`,
  e: `sha256:${"e".repeat(64)}`,
  f: `sha256:${"f".repeat(64)}`,
  zero: `sha256:${"0".repeat(64)}`,
});

async function readTemplate() {
  return JSON.parse(await readFile(TEMPLATE_URL, "utf8"));
}

function crossRepositoryAttestation(record) {
  return {
    schemaVersion: "programmable.website-observed-cross-repository-release-binding.v1",
    repository: "0xprogrammable/programmable-open-hook-v2-internal",
    attestationCommitSha:
      record.subject.crossRepositoryReleaseBinding.attestationCommitSha,
    parentCommitSha: "5".repeat(40),
    documentPath:
      "services/autonomous-approval-v1/release/cross-repository-release-binding-v1.json",
    documentBlobSha: "6".repeat(40),
    documentSha256: record.subject.crossRepositoryReleaseBinding.documentSha256,
    backendCandidateCommitSha: "5".repeat(40),
    backendPackageArtifactHash: record.subject.approvalService.packageArtifactHash,
    websiteCandidateCommitSha: record.subject.website.commitSha,
    builderCandidateCommitSha: "7".repeat(40),
    registryCandidateCommitSha: "8".repeat(40),
    productionAuthorityCandidateCommitSha: commits.productionAuthority,
    applicationV3CompatibilityEvidenceSha256: hashes.zero,
    commitSignatureVerified: true,
  };
}

function verifyReleaseRecord(record, options = {}) {
  return verifyReleaseRecordCore(record, {
    ...options,
    crossRepositoryAttestation: crossRepositoryAttestation(record),
  });
}

function decision(status, subjectHash, suffix, decidedAtOverride = null) {
  const decidedAt = decidedAtOverride ?? (suffix === "freeze"
    ? "2026-08-06T12:00:00Z"
    : suffix === "promotion"
      ? "2026-08-06T13:30:00Z"
      : "2026-08-06T16:00:00Z");
  return {
    authority: "command_center",
    status,
    decisionId: `cc-20260806-${suffix}`,
    immutableReference: `command-center://decision/cc-20260806-${suffix}`,
    decidedAt,
    statementSha256: hashes.f,
    releaseSubjectSha256: subjectHash,
  };
}

async function completeRecord(level = "live") {
  const record = await readTemplate();
  record.createdAt = "2026-08-06T11:00:00Z";
  record.releaseIntent.releaseId = "custom-launch-v1-20260806-001";
  record.releaseIntent.targetMode = level === "dark_staging" ? "disabled" : "enabled";
  record.subject.website.commitSha = commits.website;
  record.subject.website.reviewedDiffBaseSha = commits.base;
  record.subject.website.reviewedDiffHeadSha = commits.website;
  record.subject.website.reviewedDiffSha256 = hashes.a;
  record.subject.approvalService.packageArtifactHash = hashes.b;
  record.subject.approvalService.detachedPackedArtifactFileSha256 = hashes.c;
  record.subject.approvalService.productionContentManifestSha256 = hashes.d;
  record.subject.crossRepositoryReleaseBinding.attestationCommitSha =
    commits.backendAttestation;
  record.subject.crossRepositoryReleaseBinding.documentSha256 = hashes.e;
  let subjectHash;
  if (level === "clearance") {
    subjectHash = computeReleaseSubjectSha256(record);
    record.subject.releaseSubjectSha256 = subjectHash;
    record.commandCenter.freezeClearance = decision("cleared", subjectHash, "freeze");
    record.recordStatus = "freeze_cleared";
    return record;
  }

  record.validation.gates = record.validation.gates.map((gate, index) => ({
    ...gate,
    result: "passed",
    evidenceSha256: [hashes.a, hashes.b, hashes.c, hashes.d, hashes.e, hashes.f, hashes.zero, hashes.a][index],
    evidenceLocator: `https://github.com/0xprogrammable/programmable/actions/runs/${1000 + index}`,
    completedAt: "2026-08-06T13:00:00Z",
  }));
  record.productionDependencies = {
    websiteProjection: {
      databaseIdentity: "supabase:mnnvlrqwhfoppogslsje",
      migrationInventory: [
        {
          ordinal: 1,
          path: "ops/website-projection-target/migrations/0001_projection_records_v1.sql",
          fileSha256: hashes.a,
        },
        {
          ordinal: 2,
          path: "ops/website-projection-target/migrations/0002_custom_launch_wallet_profile_v2.sql",
          fileSha256: hashes.b,
        },
        {
          ordinal: 3,
          path: "ops/website-projection-target/migrations/0003_registry_custom_public_read_v1.sql",
          fileSha256: hashes.c,
        },
      ],
      migrationDigest: null,
      runtimeRoleAttestationSha256: hashes.b,
      backupId: "backup-20260806-001",
      restoreDrillEvidenceSha256: hashes.c,
    },
    approvalService: {
      releaseIdentity: "programmable-approval-v1-20260806-001",
      migrationInventorySha256: hashes.d,
      signerKeyId: "manual-review-ed25519-20260806",
      signerEpoch: 1,
      signerComponentBindingSha256: hashes.e,
      controlAxisGenerationsSha256: hashes.f,
      readyzEvidenceSha256: hashes.zero,
    },
    identity: {
      privyApplicationId: "cm123publicappid",
      githubOauthEnabled: true,
      identityTokensEnabled: true,
    },
    sessionAuthority: {
      audience: "programmable-launcher",
      keyId: "github-session-authority-20260806",
      keyEpoch: "2026-08",
      authorityPublicKeySpkiSha256: hashes.e,
      workloadIssuer: "programmable-authority-token-broker-v1",
      workloadSubject: "approval-runtime-v1",
      workloadKeyId: "workload-access-v1",
      workloadPublicKeySpkiSha256: hashes.f,
      configurationEvidenceSha256: null,
    },
    ethereum: {
      chainId: "1",
      chainProfileSha256: hashes.a,
      finalizedRpcBindings: [
        { providerId: "alchemy", bindingSha256: hashes.b },
        { providerId: "quicknode", bindingSha256: hashes.c },
      ],
    },
    targets: {
      registryBindingSha256: hashes.d,
      websiteProjectionBindingSha256: hashes.e,
    },
  };
  record.productionDependencies.websiteProjection.migrationDigest =
    computeWebsiteProjectionMigrationDigest(
      record.productionDependencies.websiteProjection,
    );
  record.productionDependencies.sessionAuthority.configurationEvidenceSha256 =
    computeSessionAuthorityConfigurationEvidenceSha256(
      record.productionDependencies,
      commits.productionAuthority,
    );
  record.deployment.rollback = {
    deploymentId: "dpl_previous",
    immutableDeploymentUrl: "https://launcher-v4-previous.vercel.app",
    websiteCommitSha: commits.base,
    productionAlias: "https://programmable.market",
    configurationSnapshotSha256: hashes.f,
    capturedAt: "2026-08-06T13:10:00Z",
  };
  subjectHash = computeReleaseSubjectSha256(record);
  record.subject.releaseSubjectSha256 = subjectHash;
  record.commandCenter.freezeClearance = decision(
    "cleared",
    subjectHash,
    "freeze",
    "2026-08-06T13:15:00Z",
  );
  record.recordStatus = "freeze_cleared";
  if (level === "dark_staging" || level === "staging") return record;
  record.deployment.candidate = {
    deploymentId: "dpl_candidate",
    immutableDeploymentUrl: "https://launcher-v4-candidate.vercel.app",
    websiteCommitSha: commits.website,
    approvalServicePackageArtifactHash: hashes.b,
    crossRepositoryAttestationCommitSha: commits.backendAttestation,
    crossRepositoryBindingDocumentSha256: hashes.e,
    verified: true,
    verificationEvidenceSha256: hashes.zero,
    verifiedAt: "2026-08-06T13:20:00Z",
  };
  record.promotionGate.status = "candidate_verified";
  record.promotionGate.workflow = {
    repository: "0xprogrammable/programmable",
    workflowFile: ".github/workflows/deploy-production.yml",
    eventName: "workflow_dispatch",
    ref: "refs/heads/production",
    environment: "production",
    runId: 123456789,
    runAttempt: 1,
    runUrl: "https://github.com/0xprogrammable/programmable/actions/runs/123456789",
    commitSha: commits.website,
    verifiedCommitSha: commits.website,
    conclusion: "success",
    candidateDeploymentId: "dpl_candidate",
    immutableDeploymentUrl: "https://launcher-v4-candidate.vercel.app",
    approvalServicePackageArtifactHash: hashes.b,
    crossRepositoryAttestationCommitSha: commits.backendAttestation,
    crossRepositoryBindingDocumentSha256: hashes.e,
    candidateVerified: true,
    verificationEvidenceSha256: hashes.zero,
  };
  record.recordStatus = "candidate_verified";
  if (level === "candidate") return record;

  record.commandCenter.promotionApproval = {
    ...decision("approved", subjectHash, "promotion"),
    candidateDeploymentId: "dpl_candidate",
    immutableDeploymentUrl: "https://launcher-v4-candidate.vercel.app",
    websiteCommitSha: commits.website,
    approvalServicePackageArtifactHash: hashes.b,
    crossRepositoryAttestationCommitSha: commits.backendAttestation,
    crossRepositoryBindingDocumentSha256: hashes.e,
  };
  record.promotionGate.status = "promotion_authorized";
  record.recordStatus = "promotion_approved";
  if (level === "promotion") return record;

  record.deployment.promoted = {
    deploymentId: "dpl_candidate",
    immutableDeploymentUrl: "https://launcher-v4-candidate.vercel.app",
    productionAlias: "https://programmable.market",
    postPromotionEvidenceSha256: hashes.a,
    promotedAt: "2026-08-06T14:00:00Z",
  };
  record.promotionGate.status = "promoted";
  record.canary = {
    status: "passed",
    evidenceSha256: hashes.b,
    evidenceLocator: "https://github.com/0xprogrammable/programmable/actions/runs/123456789",
    completedAt: "2026-08-06T15:00:00Z",
  };
  record.commandCenter.liveDeclaration = {
    ...decision("declared_live", subjectHash, "live"),
    candidateDeploymentId: "dpl_candidate",
    immutableDeploymentUrl: "https://launcher-v4-candidate.vercel.app",
    websiteCommitSha: commits.website,
    approvalServicePackageArtifactHash: hashes.b,
    crossRepositoryAttestationCommitSha: commits.backendAttestation,
    crossRepositoryBindingDocumentSha256: hashes.e,
  };
  record.recordStatus = "live";
  return record;
}

test("template and schema are valid JSON and the template is not clearance", async () => {
  const [template, schema] = await Promise.all([
    readTemplate(),
    readFile(SCHEMA_URL, "utf8").then(JSON.parse),
  ]);
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(verifyReleaseRecord(template, { require: "template" }).ok, true);
  const clearance = verifyReleaseRecord(template, { require: "clearance" });
  assert.equal(clearance.ok, false);
  assert.match(clearance.errors.join("\n"), /freezeClearance/);
});

test("release record accepts either configured review mode but requires exact equality", async () => {
  const autonomous = await readTemplate();
  assert.equal(autonomous.releaseIntent.reviewAuthorityMode, "autonomous_ai");
  assert.equal(verifyReleaseRecord(autonomous, { require: "template" }).ok, true);

  const manual = await readTemplate();
  manual.releaseIntent.reviewAuthorityMode = "manual_review";
  manual.subject.approvalService.reviewAuthorityMode = "manual_review";
  assert.equal(verifyReleaseRecord(manual, { require: "template" }).ok, true);

  manual.subject.approvalService.reviewAuthorityMode = "autonomous_ai";
  const mismatch = verifyReleaseRecord(manual, { require: "template" });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.errors.join("\n"), /reviewAuthorityMode/);
});

test("AJV 2020 rejects unknown nested fields before semantic verification", async () => {
  const mutations = [
    (record) => { record.unexpected = true; },
    (record) => { record.subject.website.unexpected = true; },
    (record) => { record.subject.crossRepositoryReleaseBinding.unexpected = true; },
    (record) => { record.commandCenter.freezeClearance.unexpected = true; },
    (record) => { record.validation.gates[0].unexpected = true; },
    (record) => { record.productionDependencies.approvalService.unexpected = true; },
    (record) => { record.productionDependencies.sessionAuthority.unexpected = true; },
    (record) => { record.productionDependencies.websiteProjection.migrationInventory[0].unexpected = true; },
    (record) => { record.deployment.candidate.unexpected = true; },
    (record) => { record.promotionGate.workflow.unexpected = true; },
    (record) => { record.canary.unexpected = true; },
  ];
  for (const mutate of mutations) {
    const record = await readTemplate();
    mutate(record);
    const result = verifyReleaseRecordCore(record, { require: "template" });
    assert.equal(result.ok, false);
    assert.equal(result.releaseSubjectSha256, null);
    assert.match(result.errors.join("\n"), /schema unexpected field unexpected/);
  }
});

test("CLI rejects an invalid schema before reading private GitHub evidence", async () => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "programmable-release-record-"));
  try {
    const record = await readTemplate();
    record.subject.website.unexpected = true;
    const recordPath = join(temporaryDirectory, "invalid-record.json");
    await writeFile(recordPath, `${JSON.stringify(record)}\n`, "utf8");

    const execution = spawnSync(process.execPath, [
      VERIFIER_PATH,
      recordPath,
      "--require",
      "clearance",
      "--verify-cross-repository-attestation",
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        PROGRAMMABLE_BACKEND_RELEASE_READ_TOKEN: "",
      },
    });

    assert.equal(execution.status, 1);
    assert.match(execution.stderr, /schema unexpected field unexpected/u);
    assert.doesNotMatch(execution.stderr, /credential is unavailable/u);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("clearance requires the observed GitHub attestation content", async () => {
  const record = await completeRecord("clearance");
  const missing = verifyReleaseRecordCore(record, { require: "clearance" });
  assert.equal(missing.ok, false);
  assert.match(missing.errors.join("\n"), /crossRepositoryAttestation/);

  const substituted = crossRepositoryAttestation(record);
  substituted.websiteCandidateCommitSha = commits.other;
  const mismatch = verifyReleaseRecordCore(record, {
    require: "clearance",
    crossRepositoryAttestation: substituted,
  });
  assert.equal(mismatch.ok, false);
  assert.match(mismatch.errors.join("\n"), /websiteCandidateCommitSha/);
});

test("each release level is independently fail closed", async () => {
  const clearance = await completeRecord("clearance");
  assert.equal(verifyReleaseRecord(clearance, { require: "clearance" }).ok, true);
  assert.equal(verifyReleaseRecord(clearance, { require: "dark_staging" }).ok, false);
  assert.equal(verifyReleaseRecord(clearance, { require: "staging" }).ok, false);

  const darkStaging = await completeRecord("dark_staging");
  assert.equal(verifyReleaseRecord(darkStaging, { require: "dark_staging" }).ok, true);
  assert.equal(verifyReleaseRecord(darkStaging, { require: "staging" }).ok, false);
  assert.equal(verifyReleaseRecord(darkStaging, { require: "candidate" }).ok, false);

  const staging = await completeRecord("staging");
  assert.equal(verifyReleaseRecord(staging, { require: "staging" }).ok, true);
  assert.equal(verifyReleaseRecord(staging, { require: "dark_staging" }).ok, false);
  assert.equal(verifyReleaseRecord(staging, { require: "candidate" }).ok, false);

  const candidate = await completeRecord("candidate");
  assert.equal(verifyReleaseRecord(candidate, { require: "candidate" }).ok, true);
  assert.equal(verifyReleaseRecord(candidate, { require: "promotion" }).ok, false);

  const promotion = await completeRecord("promotion");
  assert.equal(verifyReleaseRecord(promotion, { require: "promotion" }).ok, true);
  assert.equal(verifyReleaseRecord(promotion, { require: "live" }).ok, false);

  const live = await completeRecord("live");
  assert.equal(verifyReleaseRecord(live, { require: "live" }).ok, true);
});

test("dark staging binds clearance, production dependencies, rollback, and an empty promotion surface", async () => {
  const record = await completeRecord("dark_staging");
  assert.equal(record.releaseIntent.targetMode, "disabled");
  assert.equal(record.commandCenter.freezeClearance.status, "cleared");
  assert.equal(record.commandCenter.promotionApproval.status, "pending");
  assert.equal(record.commandCenter.liveDeclaration.status, "pending");
  assert.equal(record.deployment.candidate.deploymentId, null);
  assert.equal(record.deployment.promoted.deploymentId, null);
  assert.equal(verifyReleaseRecord(record, { require: "dark_staging" }).ok, true);

  record.deployment.candidate.deploymentId = "dpl_unbound_candidate";
  const candidateSubstitution = verifyReleaseRecord(record, {
    require: "dark_staging",
  });
  assert.equal(candidateSubstitution.ok, false);
  assert.match(candidateSubstitution.errors.join("\n"), /must remain null before candidate staging/u);

  const rollbackSubstitution = await completeRecord("dark_staging");
  rollbackSubstitution.deployment.rollback.configurationSnapshotSha256 = hashes.a;
  const rollbackResult = verifyReleaseRecord(rollbackSubstitution, {
    require: "dark_staging",
  });
  assert.equal(rollbackResult.ok, false);
  assert.match(rollbackResult.errors.join("\n"), /releaseSubjectSha256/u);
});

test("session-authority public configuration and cross-repository authority commit reject substitution", async () => {
  const baseline = await completeRecord("dark_staging");
  const expectedEvidence =
    baseline.productionDependencies.sessionAuthority.configurationEvidenceSha256;
  assert.equal(verifyReleaseRecord(baseline, {
    require: "dark_staging",
    expected: {
      sessionAuthorityConfigurationEvidenceSha256: expectedEvidence,
    },
  }).ok, true);

  const fieldMutations = [
    ["audience", "programmable-launcher-substituted"],
    ["keyId", "github-session-authority-substituted"],
    ["keyEpoch", "2026-09"],
    ["authorityPublicKeySpkiSha256", hashes.a],
    ["workloadIssuer", "substituted-workload-issuer"],
    ["workloadSubject", "substituted-workload-subject"],
    ["workloadKeyId", "substituted-workload-key"],
    ["workloadPublicKeySpkiSha256", hashes.a],
    ["configurationEvidenceSha256", hashes.a],
  ];
  for (const [field, value] of fieldMutations) {
    const substituted = structuredClone(baseline);
    substituted.productionDependencies.sessionAuthority[field] = value;
    const result = verifyReleaseRecord(substituted, { require: "dark_staging" });
    assert.equal(result.ok, false, `${field} substitution must fail closed`);
    assert.match(
      result.errors.join("\n"),
      /configurationEvidenceSha256|releaseSubjectSha256/u,
    );
  }

  const substitutedObservation = crossRepositoryAttestation(baseline);
  substitutedObservation.productionAuthorityCandidateCommitSha = commits.other;
  const crossRepositoryResult = verifyReleaseRecordCore(baseline, {
    require: "dark_staging",
    crossRepositoryAttestation: substitutedObservation,
  });
  assert.equal(crossRepositoryResult.ok, false);
  assert.match(
    crossRepositoryResult.errors.join("\n"),
    /productionDependencies\.sessionAuthority\.configurationEvidenceSha256/u,
  );

  const externalExpectation = verifyReleaseRecord(baseline, {
    require: "dark_staging",
    expected: {
      sessionAuthorityConfigurationEvidenceSha256: hashes.zero,
    },
  });
  assert.equal(externalExpectation.ok, false);
  assert.match(
    externalExpectation.errors.join("\n"),
    /productionDependencies\.sessionAuthority\.configurationEvidenceSha256/u,
  );
});

test("session-authority runtime hash matches the deployed public attestation binding", async () => {
  const baseline = await completeRecord("dark_staging");
  const baselineHash = computeSessionAuthorityRuntimeConfigurationHash(
    baseline.productionDependencies,
  );
  assert.match(baselineHash, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(
    baselineHash,
    baseline.productionDependencies.sessionAuthority.configurationEvidenceSha256,
  );

  for (const [field, value] of [
    ["audience", "programmable-launcher-substituted"],
    ["keyId", "github-session-authority-substituted"],
    ["keyEpoch", "2026-09"],
    ["authorityPublicKeySpkiSha256", hashes.a],
    ["workloadIssuer", "substituted-workload-issuer"],
    ["workloadSubject", "substituted-workload-subject"],
    ["workloadKeyId", "substituted-workload-key"],
    ["workloadPublicKeySpkiSha256", hashes.a],
  ]) {
    const substituted = structuredClone(baseline);
    substituted.productionDependencies.sessionAuthority[field] = value;
    assert.notEqual(
      computeSessionAuthorityRuntimeConfigurationHash(
        substituted.productionDependencies,
      ),
      baselineHash,
      `${field} substitution must change the runtime configuration hash`,
    );
  }
  const substitutedApp = structuredClone(baseline);
  substitutedApp.productionDependencies.identity.privyApplicationId =
    "cm123substitutedappid";
  assert.notEqual(
    computeSessionAuthorityRuntimeConfigurationHash(
      substitutedApp.productionDependencies,
    ),
    baselineHash,
  );
});

test("Website projection migration digest binds the complete ordered 0001 through 0003 inventory", async () => {
  const baseline = await completeRecord("dark_staging");
  const projection = baseline.productionDependencies.websiteProjection;
  assert.deepEqual(
    projection.migrationInventory.map(({ ordinal, path }) => ({ ordinal, path })),
    [
      {
        ordinal: 1,
        path: "ops/website-projection-target/migrations/0001_projection_records_v1.sql",
      },
      {
        ordinal: 2,
        path: "ops/website-projection-target/migrations/0002_custom_launch_wallet_profile_v2.sql",
      },
      {
        ordinal: 3,
        path: "ops/website-projection-target/migrations/0003_registry_custom_public_read_v1.sql",
      },
    ],
  );
  assert.equal(
    projection.migrationDigest,
    computeWebsiteProjectionMigrationDigest(projection),
  );

  const reordered = structuredClone(baseline);
  [
    reordered.productionDependencies.websiteProjection.migrationInventory[0],
    reordered.productionDependencies.websiteProjection.migrationInventory[1],
  ] = [
    reordered.productionDependencies.websiteProjection.migrationInventory[1],
    reordered.productionDependencies.websiteProjection.migrationInventory[0],
  ];
  const reorderedResult = verifyReleaseRecord(reordered, {
    require: "dark_staging",
  });
  assert.equal(reorderedResult.ok, false);
  assert.match(reorderedResult.errors.join("\n"), /migrationInventory/u);

  const truncated = structuredClone(baseline);
  truncated.productionDependencies.websiteProjection.migrationInventory.pop();
  const truncatedResult = verifyReleaseRecord(truncated, {
    require: "dark_staging",
  });
  assert.equal(truncatedResult.ok, false);
  assert.match(truncatedResult.errors.join("\n"), /migrationInventory/u);

  const substitutedHash = structuredClone(baseline);
  substitutedHash.productionDependencies.websiteProjection
    .migrationInventory[2].fileSha256 = hashes.f;
  const substitutedHashResult = verifyReleaseRecord(substitutedHash, {
    require: "dark_staging",
  });
  assert.equal(substitutedHashResult.ok, false);
  assert.match(
    substitutedHashResult.errors.join("\n"),
    /migrationDigest|releaseSubjectSha256/u,
  );
});

test("release records reject the former production alias", async () => {
  const staging = await completeRecord("staging");
  staging.deployment.rollback.productionAlias =
    "https://programmable.family";
  const stagingResult = verifyReleaseRecord(staging, { require: "staging" });
  assert.equal(stagingResult.ok, false);
  assert.match(stagingResult.errors.join("\n"), /productionAlias/u);

  const live = await completeRecord("live");
  live.deployment.promoted.productionAlias = "https://programmable.family";
  const liveResult = verifyReleaseRecord(live, { require: "live" });
  assert.equal(liveResult.ok, false);
  assert.match(liveResult.errors.join("\n"), /productionAlias/u);
});

test("staging expectations bind the exact external workflow observations", async () => {
  const record = await completeRecord("staging");
  const expected = {
    websiteCommitSha: commits.website,
    packageArtifactHash: hashes.b,
    crossRepositoryAttestationCommitSha: commits.backendAttestation,
    crossRepositoryBindingDocumentSha256: hashes.e,
    rollbackDeploymentId: "dpl_previous",
    rollbackDeploymentUrl: "https://launcher-v4-previous.vercel.app",
    rollbackWebsiteCommitSha: commits.base,
    sessionAuthorityConfigurationEvidenceSha256:
      record.productionDependencies.sessionAuthority.configurationEvidenceSha256,
    detachedRecordSha256: computeDetachedRecordSha256(record),
  };
  assert.equal(verifyReleaseRecord(record, { require: "staging", expected }).ok, true);
  const substituted = verifyReleaseRecord(record, {
    require: "staging",
    expected: { ...expected, websiteCommitSha: commits.other },
  });
  assert.equal(substituted.ok, false);
  assert.match(substituted.errors.join("\n"), /subject\.website\.commitSha/);
});

test("candidate workflow cannot substitute the Website commit", async () => {
  const record = await completeRecord("candidate");
  record.promotionGate.workflow.commitSha = commits.other;
  const result = verifyReleaseRecord(record, { require: "candidate" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /promotionGate\.workflow\.commitSha/);
});

test("candidate cannot substitute the approval-service package", async () => {
  const record = await completeRecord("candidate");
  record.deployment.candidate.approvalServicePackageArtifactHash = hashes.c;
  const result = verifyReleaseRecord(record, { require: "candidate" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /approvalServicePackageArtifactHash/);
});

test("clearance is bound to the exact five-component backend release attestation", async () => {
  const record = await completeRecord("clearance");
  record.subject.crossRepositoryReleaseBinding.attestationCommitSha = commits.other;
  const result = verifyReleaseRecord(record, { require: "clearance" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /subject\.releaseSubjectSha256/);
});

test("candidate and workflow cannot substitute the cross-repository binding", async () => {
  const candidate = await completeRecord("candidate");
  candidate.deployment.candidate.crossRepositoryBindingDocumentSha256 = hashes.f;
  let result = verifyReleaseRecord(candidate, { require: "candidate" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /deployment\.candidate\.crossRepositoryBindingDocumentSha256/);

  const workflow = await completeRecord("candidate");
  workflow.promotionGate.workflow.crossRepositoryAttestationCommitSha = commits.other;
  result = verifyReleaseRecord(workflow, { require: "candidate" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /promotionGate\.workflow\.crossRepositoryAttestationCommitSha/);
});

test("promotion approval must repeat the exact cross-repository binding", async () => {
  const record = await completeRecord("promotion");
  record.commandCenter.promotionApproval.crossRepositoryAttestationCommitSha =
    commits.other;
  const result = verifyReleaseRecord(record, { require: "promotion" });
  assert.equal(result.ok, false);
  assert.match(
    result.errors.join("\n"),
    /commandCenter\.promotionApproval\.crossRepositoryAttestationCommitSha/,
  );
});

test("staging expectations reject a substituted cross-repository attestation", async () => {
  const record = await completeRecord("staging");
  const result = verifyReleaseRecord(record, {
    require: "staging",
    expected: {
      crossRepositoryAttestationCommitSha: commits.other,
      crossRepositoryBindingDocumentSha256: hashes.f,
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /subject\.crossRepositoryReleaseBinding/);
});

test("tampering with a bound subject invalidates Command Center clearance", async () => {
  const record = await completeRecord("clearance");
  record.subject.website.reviewedDiffSha256 = hashes.e;
  const result = verifyReleaseRecord(record, { require: "clearance" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /releaseSubjectSha256/);
});

test("freeze clearance never substitutes for candidate-specific promotion approval", async () => {
  const record = await completeRecord("candidate");
  record.recordStatus = "promotion_approved";
  record.promotionGate.status = "promotion_authorized";
  const result = verifyReleaseRecord(record, { require: "promotion" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /promotionApproval/);
});

test("a general user-message URL cannot masquerade as Command Center clearance", async () => {
  const record = await completeRecord("clearance");
  record.commandCenter.freezeClearance.immutableReference =
    "https://github.com/0xprogrammable/programmable/issues/1";
  const result = verifyReleaseRecord(record, { require: "clearance" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /command-center:\/\/decision/);
});

test("secret-bearing fields are rejected even when all gates otherwise pass", async () => {
  const record = await completeRecord("live");
  record.productionDependencies.identity.access_token = "must-not-be-recorded";
  const result = verifyReleaseRecord(record, { require: "live" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /schema unexpected field access_token/);
});

test("an unfilled release id placeholder is rejected after template stage", async () => {
  const record = await completeRecord("clearance");
  record.releaseIntent.releaseId = "custom-launch-v1-YYYYMMDD-NNN";
  const result = verifyReleaseRecord(record, { require: "clearance" });
  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /contains a placeholder/);
});

test("detached record digest is stable and changes under mutation", async () => {
  const record = await completeRecord("live");
  const first = computeDetachedRecordSha256(record);
  const second = computeDetachedRecordSha256(structuredClone(record));
  assert.equal(first, second);
  record.canary.completedAt = "2026-08-06T15:00:01Z";
  assert.notEqual(computeDetachedRecordSha256(record), first);
});
