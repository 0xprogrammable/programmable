import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  readCustomLaunchPublicFlag,
  resolveCustomLaunchStagingPolicy,
} from "../resolve-custom-launch-staging-policy.mjs";

const WORKFLOW_URL = new URL(
  "../../.github/workflows/deploy-production.yml",
  import.meta.url,
);
const POLICY_URL = new URL(
  "../resolve-custom-launch-staging-policy.mjs",
  import.meta.url,
);
const ACTIVATION_RUNBOOK_URL = new URL(
  "../../docs/operations/CUSTOM-LAUNCH-PRODUCTION-ACTIVATION-V1.md",
  import.meta.url,
);

function activationRunbookFailures(source) {
  const failures = [];
  const sessionConfigurationBinding =
    "PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_EXPECTED_CONFIGURATION_HASH=sha256:<exact-session-authority-configuration-hash>";
  if (source.split(sessionConfigurationBinding).length - 1 !== 4) {
    failures.push("session-authority-probe-bindings");
  }
  for (const forbidden of [
    "protected `verified=true` step output",
    "before it emits the promotion marker",
    "It repeats the check against the production domain after promotion",
  ]) {
    if (source.includes(forbidden)) failures.push(`false-automation:${forbidden}`);
  }
  for (const required of [
    "`verified_sha` output binds the checkout only; it is not a promotion authorization",
    "The workflow does not promote the candidate",
    "does not automate the post-promotion check",
  ]) {
    if (!source.includes(required)) failures.push(`stage-only:${required}`);
  }
  return failures;
}

function workflowFailures(source) {
  const failures = [];
  const requireText = (id, text) => {
    if (!source.includes(text)) failures.push(id);
  };
  const requireOrder = (id, earlier, later) => {
    const earlierIndex = source.indexOf(earlier);
    const laterIndex = source.indexOf(later);
    if (earlierIndex < 0 || laterIndex <= earlierIndex) failures.push(id);
  };

  requireText("dispatch-boolean", "custom_launch_public_enablement:");
  requireText("dispatch-boolean-type", "type: boolean");
  requireText("dispatch-default-off", "default: false");
  requireText("dispatch-stage-mode", "custom_launch_stage_mode:");
  requireText("dispatch-stage-mode-type", "type: choice");
  for (const mode of ["none", "dark", "enabled"]) {
    requireText(`dispatch-stage-mode-${mode}`, `          - ${mode}`);
  }
  requireText(
    "production-config-policy",
    "node scripts/resolve-custom-launch-staging-policy.mjs",
  );
  requireText(
    "production-config-input",
    "CUSTOM_LAUNCH_PUBLIC_ENABLEMENT_REQUESTED: ${{ inputs.custom_launch_public_enablement || false }}",
  );
  requireText("canonical-stage-name", "Stage programmable.market candidate");
  requireText(
    "canonical-rollback-target",
    '--target-url "https://programmable.market"',
  );
  requireText(
    "canonical-attestation-origin",
    '--production-origin "https://programmable.market"',
  );
  requireText(
    "canonical-summary-target",
    "Production target: https://programmable.market",
  );
  if (source.includes("programmable.family")) {
    failures.push("former-production-domain");
  }
  requireText(
    "protected-production-mode",
    "CUSTOM_LAUNCH_PRODUCTION_MODE: ${{ vars.CUSTOM_LAUNCH_PRODUCTION_MODE }}",
  );
  requireText(
    "protected-production-mode-input",
    '--production-mode "$CUSTOM_LAUNCH_PRODUCTION_MODE"',
  );
  requireText(
    "explicit-stage-mode",
    "CUSTOM_LAUNCH_STAGE_MODE: ${{ inputs.custom_launch_stage_mode || 'none' }}",
  );
  requireText(
    "explicit-stage-mode-input",
    '--stage-mode "$CUSTOM_LAUNCH_STAGE_MODE"',
  );
  const recordGateStart = source.indexOf(
    "      - name: Verify detached Custom Launch release record",
  );
  const recordGateEnd = source.indexOf(
    "      - name: Preserve detached Custom Launch release record",
  );
  const recordGateBlock =
    recordGateStart >= 0 && recordGateEnd > recordGateStart
      ? source.slice(recordGateStart, recordGateEnd)
      : "";
  if (
    !recordGateBlock.includes(
      "if: steps.custom-launch-policy.outputs.release_record_required == 'true'",
    )
  )
    failures.push("conditional-record-gate");
  requireText(
    "dedicated-record-ref",
    'record_ref="refs/remotes/origin/command-center-release-records"',
  );
  requireText(
    "dedicated-record-fetch",
    '"+refs/heads/command-center-release-records:$record_ref"',
  );
  requireText(
    "record-commit-format",
    '[[ ! "$RECORD_COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]]',
  );
  requireText(
    "record-detached-from-subject",
    '[[ "$RECORD_COMMIT_SHA" == "$GITHUB_SHA" ]]',
  );
  requireText(
    "record-reachability",
    'git merge-base --is-ancestor "$RECORD_COMMIT_SHA" "$record_ref"',
  );
  requireText(
    "record-github-provenance",
    "commit.commit?.verification?.verified !== true",
  );
  requireText(
    "record-programmable-author",
    'commit.author?.login !== "0xprogrammable"',
  );
  requireText(
    "record-programmable-committer",
    'commit.committer?.login !== "0xprogrammable"',
  );
  requireText(
    "record-fixed-path",
    'record_path="release-records/custom-launch-v1/release-record.json"',
  );
  requireText(
    "record-dynamic-level",
    "RECORD_REQUIREMENT: ${{ steps.custom-launch-policy.outputs.release_record_requirement }}",
  );
  requireText(
    "record-dynamic-level-input",
    '--require "$RECORD_REQUIREMENT"',
  );
  requireText(
    "record-required-deployment-state",
    "REQUIRED_DEPLOYMENT_STATE: ${{ steps.custom-launch-policy.outputs.required_deployment_state }}",
  );
  if (
    !recordGateBlock.includes(
      "record.releaseIntent?.targetMode !== requiredState",
    )
  ) {
    failures.push("record-stage-mode-binding");
  }
  requireText(
    "record-website-binding",
    '--expect-website-commit "$GITHUB_SHA"',
  );
  requireText(
    "record-backend-binding",
    '--expect-package-artifact-hash "$EXPECTED_PACKAGE_ARTIFACT_HASH"',
  );
  requireText(
    "record-protected-backend-identity",
    "EXPECTED_PACKAGE_ARTIFACT_HASH: ${{ secrets.PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH }}",
  );
  requireText(
    "record-cross-repository-attestation-binding",
    '--expect-cross-repository-attestation-commit "$EXPECTED_CROSS_REPOSITORY_ATTESTATION_COMMIT_SHA"',
  );
  requireText(
    "record-cross-repository-document-binding",
    '--expect-cross-repository-binding-document-sha256 "$EXPECTED_CROSS_REPOSITORY_BINDING_DOCUMENT_SHA256"',
  );
  requireText(
    "record-protected-cross-repository-attestation",
    "EXPECTED_CROSS_REPOSITORY_ATTESTATION_COMMIT_SHA: ${{ vars.PROGRAMMABLE_BACKEND_CROSS_REPOSITORY_ATTESTATION_COMMIT_SHA }}",
  );
  requireText(
    "record-protected-cross-repository-document",
    "EXPECTED_CROSS_REPOSITORY_BINDING_DOCUMENT_SHA256: ${{ vars.PROGRAMMABLE_BACKEND_CROSS_REPOSITORY_BINDING_DOCUMENT_SHA256 }}",
  );
  requireText(
    "record-protected-session-authority-evidence",
    "EXPECTED_SESSION_AUTHORITY_CONFIGURATION_EVIDENCE_SHA256: ${{ vars.PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_CONFIGURATION_EVIDENCE_SHA256 }}",
  );
  requireText(
    "record-session-authority-evidence-binding",
    '--expect-session-authority-configuration-evidence-sha256 "$EXPECTED_SESSION_AUTHORITY_CONFIGURATION_EVIDENCE_SHA256"',
  );
  requireText(
    "record-private-backend-read-token",
    "PROGRAMMABLE_BACKEND_RELEASE_READ_TOKEN: ${{ secrets.PROGRAMMABLE_BACKEND_RELEASE_READ_TOKEN }}",
  );
  requireText(
    "record-live-cross-repository-verification",
    "--verify-cross-repository-attestation",
  );
  requireText(
    "record-closed-attestation-summary",
    '--cross-repository-attestation-summary "$attestation_summary_file"',
  );
  requireText(
    "record-attestation-summary-retention",
    "${{ runner.temp }}/custom-launch-cross-repository-attestation.json",
  );
  requireText(
    "record-rollback-id-binding",
    '--expect-rollback-deployment-id "$ROLLBACK_DEPLOYMENT_ID"',
  );
  requireText(
    "record-rollback-url-binding",
    '--expect-rollback-deployment-url "$ROLLBACK_DEPLOYMENT_URL"',
  );
  requireText(
    "record-rollback-commit-binding",
    '--expect-rollback-website-commit "$ROLLBACK_WEBSITE_COMMIT_SHA"',
  );
  if (
    !recordGateBlock.includes(
      'if [[ "$RECORD_REQUIREMENT" == "dark_staging" || "$RECORD_REQUIREMENT" == "staging" ]]; then',
    )
  ) {
    failures.push("record-rollback-staging-only");
  }
  if (
    !recordGateBlock.includes(
      'Custom Launch record level must be dark_staging or staging',
    )
  ) {
    failures.push("record-level-fail-closed");
  }
  if (!recordGateBlock.includes(
    "Website projection migration bytes differ from the detached record",
  )) {
    failures.push("record-migration-byte-binding");
  }
  if (
    !recordGateBlock.includes(
      '"$record_file" "${record_arguments[@]}"',
    )
  ) {
    failures.push("record-argument-array-binding");
  }
  requireText(
    "record-digest-binding",
    '--expect-detached-record-sha256 "$EXPECTED_RECORD_SHA256"',
  );
  requireText(
    "record-artifact-retention",
    "custom-launch-release-record-${{ github.run_id }}-${{ github.run_attempt }}",
  );
  requireText(
    "record-no-promotion-claim",
    "No promotion is authorized by this staging gate.",
  );
  requireOrder(
    "policy-after-pulled-config",
    "Pull production configuration",
    "Resolve Custom Launch release-record policy",
  );
  requireText(
    "candidate-runtime-commit-binding",
    '--env PROGRAMMABLE_RELEASE_COMMIT_SHA="$GITHUB_SHA"',
  );
  requireOrder(
    "record-after-rollback-capture",
    "Capture current production rollback target",
    "Verify detached Custom Launch release record",
  );
  requireOrder(
    "record-before-build",
    "Verify detached Custom Launch release record",
    "Build production deployment",
  );
  requireOrder(
    "record-before-stage",
    "Verify detached Custom Launch release record",
    "Stage production build without assigning domains",
  );
  const darkGateStart = source.indexOf(
    "      - name: Gate exact dark Custom Launch readiness",
  );
  const darkGateEnd = source.indexOf(
    "      - name: Preserve redacted dark Custom Launch readiness evidence",
  );
  const darkGateBlock =
    darkGateStart >= 0 && darkGateEnd > darkGateStart
      ? source.slice(darkGateStart, darkGateEnd)
      : "";
  if (!darkGateBlock.includes("if: steps.custom-launch-policy.outputs.stage_mode == 'dark'")) {
    failures.push("dark-stage-conditional");
  }
  if (!darkGateBlock.includes("--require-disabled")) {
    failures.push("dark-stage-disabled-probe");
  }
  if (!darkGateBlock.includes(
    "PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_EXPECTED_CONFIGURATION_HASH: ${{ steps.custom-launch-record.outputs.session_authority_runtime_configuration_hash }}",
  )) {
    failures.push("dark-stage-session-authority-binding");
  }
  if (darkGateBlock.includes("PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_")) {
    failures.push("dark-stage-authenticated-secrets");
  }
  requireText(
    "dark-stage-evidence",
    "custom-launch-dark-readiness-evidence.json",
  );
  requireText(
    "dark-stage-artifact",
    "custom-launch-dark-readiness-${{ github.run_id }}-${{ github.run_attempt }}",
  );

  const enabledGateStart = source.indexOf(
    "      - name: Gate exact enabled Custom Launch candidate",
  );
  const enabledGateEnd = source.indexOf(
    "      - name: Preserve redacted enabled Custom Launch candidate evidence",
  );
  const enabledGateBlock =
    enabledGateStart >= 0 && enabledGateEnd > enabledGateStart
      ? source.slice(enabledGateStart, enabledGateEnd)
      : "";
  if (!enabledGateBlock.includes("if: steps.custom-launch-policy.outputs.stage_mode == 'enabled'")) {
    failures.push("enabled-stage-conditional");
  }
  requireText(
    "candidate-canary-immutable-target",
    "STAGED_TARGET_URL: ${{ steps.staged-deployment.outputs.target_url }}",
  );
  if (!darkGateBlock.includes('"--deployment-id=$STAGED_DEPLOYMENT_ID"')) {
    failures.push("dark-stage-deployment-binding");
  }
  if (!enabledGateBlock.includes('"--deployment-id=$STAGED_DEPLOYMENT_ID"')) {
    failures.push("enabled-stage-deployment-binding");
  }
  requireText(
    "candidate-canary-package-binding",
    "PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH: ${{ secrets.PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH }}",
  );
  for (const binding of [
    "PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_ACCESS_TOKEN",
    "PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_IDENTITY_TOKEN",
    "PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_EXPECTED_GITHUB_USER_ID",
    "PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_OWN_APPLICATION_HANDLE",
    "PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_FOREIGN_APPLICATION_HANDLE",
  ]) {
    if (!enabledGateBlock.includes(binding)) {
      failures.push(`candidate-canary-${binding.toLowerCase()}`);
    }
  }
  if (!enabledGateBlock.includes("--require-enabled")) {
    failures.push("candidate-canary-enabled");
  }
  if (!enabledGateBlock.includes("--authenticated-canary")) {
    failures.push("candidate-canary-authenticated");
  }
  if (!enabledGateBlock.includes(
    "PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_EXPECTED_CONFIGURATION_HASH: ${{ steps.custom-launch-record.outputs.session_authority_runtime_configuration_hash }}",
  )) {
    failures.push("enabled-stage-session-authority-binding");
  }
  requireText(
    "candidate-canary-redacted-evidence",
    "custom-launch-enabled-canary-evidence.json",
  );
  requireText(
    "candidate-canary-artifact",
    "custom-launch-enabled-canary-${{ github.run_id }}-${{ github.run_attempt }}",
  );
  requireOrder(
    "dark-stage-after-stage-resolution",
    "Resolve exact staged deployment",
    "Gate exact dark Custom Launch readiness",
  );
  requireOrder(
    "enabled-stage-after-dark-stage",
    "Gate exact dark Custom Launch readiness",
    "Gate exact enabled Custom Launch candidate",
  );
  if (/\bvercel\s+(?:promote|rollback)(?:\s|$)/mu.test(source)) {
    failures.push("stage-only");
  }
  return failures;
}

const expectedPolicy = (stageMode, configuredEnablement) => ({
  stageMode,
  releaseRecordRequired: stageMode !== "none",
  releaseRecordRequirement:
    stageMode === "dark" ? "dark_staging" : stageMode === "enabled" ? "staging" : "none",
  customLaunchProbeRequired: stageMode !== "none",
  authenticatedCanaryRequired: stageMode === "enabled",
  requiredDeploymentState:
    stageMode === "dark" ? "disabled" : stageMode === "enabled" ? "enabled" : "none",
  configuredEnablement,
});

test("none staging remains record- and Custom Launch evidence-free", () => {
  assert.deepEqual(
    resolveCustomLaunchStagingPolicy({
      requested: "false",
      productionEnvSource: "OTHER_FLAG=true\n",
      productionMode: "disabled",
      stageMode: "none",
    }),
    expectedPolicy("none", false),
  );
  assert.deepEqual(
    resolveCustomLaunchStagingPolicy({
      requested: false,
      productionEnvSource: `${"PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED"}=\"false\"\n`,
      productionMode: "disabled",
      stageMode: "none",
    }),
    expectedPolicy("none", false),
  );
});

test("policy resolution never labels itself as Custom Launch evidence", async () => {
  const source = await readFile(POLICY_URL, "utf8");
  assert.match(source, /status: "policy_resolved"/u);
  assert.doesNotMatch(source, /status: "verified"/u);
});

test("dark staging requires a dark-staging record and disabled readiness probe", () => {
  assert.deepEqual(
    resolveCustomLaunchStagingPolicy({
      requested: "false",
      productionEnvSource: "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=false\n",
      productionMode: "disabled",
      stageMode: "dark",
    }),
    expectedPolicy("dark", false),
  );
});

test("enabled staging requires a staging record and authenticated canary", () => {
  assert.deepEqual(
    resolveCustomLaunchStagingPolicy({
      requested: "true",
      productionEnvSource: "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED='true'\n",
      productionMode: "enabled",
      stageMode: "enabled",
    }),
    expectedPolicy("enabled", true),
  );
  assert.throws(
    () =>
      resolveCustomLaunchStagingPolicy({
        requested: "true",
        productionEnvSource: "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=true\n",
        productionMode: "enabled",
        stageMode: "dark",
      }),
    /stage mode.*disagree/u,
  );
  assert.throws(
    () =>
      resolveCustomLaunchStagingPolicy({
        requested: "false",
        productionEnvSource:
          "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=false\n",
        productionMode: "disabled",
        stageMode: "enabled",
      }),
    /stage mode.*disagree/u,
  );
});

test("protected production mode rejects drift and invalid values", () => {
  assert.throws(
    () =>
      resolveCustomLaunchStagingPolicy({
        requested: "true",
        productionEnvSource: "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=true\n",
        productionMode: "disabled",
        stageMode: "enabled",
      }),
    /production mode.*disagree/u,
  );
  for (const productionMode of [undefined, "", "true", "Enabled", " enabled"]) {
    assert.throws(() =>
      resolveCustomLaunchStagingPolicy({
        requested: "false",
        productionEnvSource:
          "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=false\n",
        productionMode,
        stageMode: "none",
      }),
    );
  }
  for (const stageMode of [undefined, "", "Disabled", " enabled", "canary"]) {
    assert.throws(() =>
      resolveCustomLaunchStagingPolicy({
        requested: "false",
        productionEnvSource:
          "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=false\n",
        productionMode: "disabled",
        stageMode,
      }),
    );
  }
});

test("production flag parsing rejects duplicates, expansion, casing and whitespace drift", () => {
  for (const source of [
    "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=true\nPROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=true\n",
    "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=${ENABLE_CUSTOM}\n",
    "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED=True\n",
    "PROGRAMMABLE_CUSTOM_LAUNCH_PUBLIC_ENABLED= true\n",
  ]) {
    assert.throws(() => readCustomLaunchPublicFlag(source));
  }
});

test("the production workflow enforces the complete conditional detached-record contract", async () => {
  const source = await readFile(WORKFLOW_URL, "utf8");
  assert.deepEqual(workflowFailures(source), []);
});

test("the activation runbook binds every probe and keeps promotion manual", async () => {
  const source = await readFile(ACTIVATION_RUNBOOK_URL, "utf8");
  assert.deepEqual(activationRunbookFailures(source), []);
  assert.notDeepEqual(
    activationRunbookFailures(source.replace(
      "PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_EXPECTED_CONFIGURATION_HASH=sha256:<exact-session-authority-configuration-hash> \\\n",
      "",
    )),
    [],
  );
  assert.notDeepEqual(
    activationRunbookFailures(`${source}\nOnly a protected \`verified=true\` step output may promote.\n`),
    [],
  );
});

test("workflow contract detects weakened record and stage-only gates", async () => {
  const source = await readFile(WORKFLOW_URL, "utf8");
  const mutations = [
    source.replace(
      "if: steps.custom-launch-policy.outputs.release_record_required == 'true'",
      "if: always()",
    ),
    source.replace('--require "$RECORD_REQUIREMENT"', "--require staging"),
    source.replace(
      '--expect-package-artifact-hash "$EXPECTED_PACKAGE_ARTIFACT_HASH"',
      "",
    ),
    source.replace(
      '--expect-cross-repository-attestation-commit "$EXPECTED_CROSS_REPOSITORY_ATTESTATION_COMMIT_SHA"',
      "",
    ),
    source.replace(
      '--expect-cross-repository-binding-document-sha256 "$EXPECTED_CROSS_REPOSITORY_BINDING_DOCUMENT_SHA256"',
      "",
    ),
    source.replace(
      '--expect-session-authority-configuration-evidence-sha256 "$EXPECTED_SESSION_AUTHORITY_CONFIGURATION_EVIDENCE_SHA256"',
      "",
    ),
    source.replace(
      "EXPECTED_SESSION_AUTHORITY_CONFIGURATION_EVIDENCE_SHA256: ${{ vars.PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_CONFIGURATION_EVIDENCE_SHA256 }}",
      "EXPECTED_SESSION_AUTHORITY_CONFIGURATION_EVIDENCE_SHA256: missing",
    ),
    source.replace("--verify-cross-repository-attestation", ""),
    source.replace(
      "PROGRAMMABLE_BACKEND_RELEASE_READ_TOKEN: ${{ secrets.PROGRAMMABLE_BACKEND_RELEASE_READ_TOKEN }}",
      "PROGRAMMABLE_BACKEND_RELEASE_READ_TOKEN: missing",
    ),
    source.replace(
      'git merge-base --is-ancestor "$RECORD_COMMIT_SHA" "$record_ref"',
      "",
    ),
    source.replace("commit.commit?.verification?.verified !== true", "false"),
    source.replace(
      '--expect-detached-record-sha256 "$EXPECTED_RECORD_SHA256"',
      "",
    ),
    source.replace(
      "CUSTOM_LAUNCH_PRODUCTION_MODE: ${{ vars.CUSTOM_LAUNCH_PRODUCTION_MODE }}",
      "CUSTOM_LAUNCH_PRODUCTION_MODE: enabled",
    ),
    source.replace('--production-mode "$CUSTOM_LAUNCH_PRODUCTION_MODE"', ""),
    source.replace('--stage-mode "$CUSTOM_LAUNCH_STAGE_MODE"', ""),
    source.replace(
      "record.releaseIntent?.targetMode !== requiredState",
      "false",
    ),
    source.replace(
      'if [[ "$RECORD_REQUIREMENT" == "dark_staging" || "$RECORD_REQUIREMENT" == "staging" ]]; then',
      'if [[ -n "$RECORD_REQUIREMENT" ]]; then',
    ),
    source.replace(
      'echo "Custom Launch record level must be dark_staging or staging" >&2',
      '',
    ),
    source.replace(
      "Website projection migration bytes differ from the detached record",
      "migration mismatch ignored",
    ),
    source.replace('--env PROGRAMMABLE_RELEASE_COMMIT_SHA="$GITHUB_SHA"', ""),
    source.replace("--authenticated-canary", ""),
    source.replace("--require-disabled", ""),
    source.replace(
      "PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_EXPECTED_CONFIGURATION_HASH: ${{ steps.custom-launch-record.outputs.session_authority_runtime_configuration_hash }}",
      "PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_EXPECTED_CONFIGURATION_HASH: unbound",
    ),
    source.replace(
      "if: steps.custom-launch-policy.outputs.stage_mode == 'dark'",
      "if: always()",
    ),
    source.replace(
      "if: steps.custom-launch-policy.outputs.stage_mode == 'enabled'",
      "if: always()",
    ),
    source.replace(
      "custom-launch-enabled-canary-${{ github.run_id }}-${{ github.run_attempt }}",
      "missing-candidate-artifact",
    ),
    source.replace(
      "https://programmable.market",
      "https://programmable.family",
    ),
    `${source}\n      - run: vercel promote "$DEPLOYMENT_URL"\n`,
  ];
  for (const mutation of mutations) {
    assert.notDeepEqual(workflowFailures(mutation), []);
  }
});
