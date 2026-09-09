import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deploy = readFileSync(".github/workflows/deploy-production.yml", "utf8");
const standaloneReconcile = readFileSync(
  ".github/workflows/reconcile-generic-signer-probes.yml",
  "utf8",
);
const verify = readFileSync(".github/workflows/verify.yml", "utf8");
const proof = readFileSync("scripts/production-verify-proof.mjs", "utf8");
const stageGate = readFileSync("scripts/custom-v2-stage-gate.mjs", "utf8");
const signerProbeGate = readFileSync(
  "scripts/custom-v2-signer-probe-gate.mjs",
  "utf8",
);
const reconciler = readFileSync(
  "scripts/reconcile-generic-signer-probe-deployments.mjs",
  "utf8",
);
const boundedReader = readFileSync("scripts/read-bounded-response.mjs", "utf8");
function stepBlock(source, name) {
  const start = source.indexOf(`      - name: ${name}`);
  assert.notEqual(start, -1, `missing step ${name}`);
  const end = source.indexOf("\n      - name:", start + 1);
  return source.slice(start, end === -1 ? source.length : end);
}

test("Custom V2 production proof is a dedicated versioned protected lane", () => {
  assert.match(proof, /programmable\.production-verify-proof\.v4/u);
  assert.match(proof, /"custom_v2"/u);
  assert.match(
    proof,
    /id: "custom-v2", name: "Custom V2", scopeKey: "custom_v2"/u,
  );
  assert.match(verify, /^  custom-v2:$/mu);
  assert.match(
    verify,
    /name: Verify exact Custom V2 surface[\s\S]*npm run verify:custom-v2:ci/u,
  );
  const projectionDatabaseOperator = stepBlock(
    verify,
    "Verify exact Website projection database operator",
  );
  assert.match(projectionDatabaseOperator, /node --test/u);
  assert.match(
    projectionDatabaseOperator,
    /scripts\/website-projection-db-operator\.test\.mjs/u,
  );
  assert.match(
    projectionDatabaseOperator,
    /scripts\/website-projection-db-credential-rotation\.test\.mjs/u,
  );
  assert.match(
    verify,
    /name: Verify exact Generic V2 read-model contract derivation[\s\S]*node --test scripts\/test\/custom-v2-read-model-contract-v2\.test\.mjs/u,
  );
  assert.match(verify, /PRODUCTION_VERIFY_SCOPE_CUSTOM_V2:/u);
  assert.match(verify, /PRODUCTION_VERIFY_CUSTOM_V2_RESULT:/u);
  assert.match(verify, /verified Custom V2|CUSTOM_V2_RESULT/u);
});

test("manual Generic release verification runs the complete current Custom V2 tree", () => {
  assert.match(
    verify,
    /^  workflow_dispatch:[\s\S]*verification_mode:[\s\S]*custom-v2-release/mu,
  );
  const scope = stepBlock(verify, "Classify changed paths");
  assert.match(scope, /VERIFICATION_MODE:/u);
  assert.match(scope, /test "\$GITHUB_EVENT_NAME" = workflow_dispatch/u);
  assert.match(scope, /test "\$GITHUB_REF" = refs\/heads\/production/u);
  assert.match(scope, /classify-verify-paths\.mjs --custom-v2-release/u);
  assert.match(
    verify,
    /name: Bind production Verify proof[\s\S]*github\.event_name == 'workflow_dispatch'[\s\S]*inputs\.verification_mode == 'custom-v2-release'/u,
  );
  assert.match(proof, /verificationMode/u);
  assert.match(proof, /workflow_dispatch/u);
  assert.match(proof, /validateVerificationModeScope/u);
  assert.match(
    deploy,
    /PRODUCTION_VERIFY_MODE:[\s\S]*custom-v2-release[\s\S]*--verification-mode "\$PRODUCTION_VERIFY_MODE"/u,
  );
  assert.match(deploy, /--verification-mode "\$VERIFY_MODE"/u);
  assert.match(
    deploy,
    /--verification-mode "\$\{\{ needs\.release-gate\.outputs\.verification_mode \}\}"/u,
  );
});

test("trusted-base classification bootstraps Custom V2 without narrowing legacy lanes", () => {
  const block = stepBlock(verify, "Classify changed paths");
  assert.match(
    block,
    /git show "\$BASE_SHA:scripts\/ci\/classify-verify-paths\.mjs"/u,
  );
  assert.match(block, /if ! grep -Eq '\^custom_v2=\(true\|false\)\$'/u);
  assert.match(block, /echo 'custom_v2=true'/u);
  assert.match(block, /changing or narrowing any trusted-base legacy result/u);
});

test("Custom V2 stage expectations are explicit, observational, and default disabled", () => {
  for (const input of [
    "custom_v2_registry_live",
    "custom_v2_generic_public_read_enabled",
  ]) {
    assert.match(
      deploy,
      new RegExp(
        `${input}:[\\s\\S]{0,240}default: false[\\s\\S]{0,80}type: boolean`,
        "u",
      ),
    );
  }
  assert.match(deploy, /this does not change configuration/u);
  assert.match(deploy, /this does not activate them/u);
  assert.match(
    deploy,
    /verified_custom_v2: \$\{\{ steps\.verify-proof\.outputs\.verified_custom_v2 \}\}/u,
  );
  const gate = stepBlock(
    deploy,
    "Gate exact unaliased Custom V2 staged candidate",
  );
  assert.match(
    gate,
    /if: needs\.release-gate\.outputs\.verified_custom_v2 == 'true'/u,
  );
  assert.match(
    gate,
    /STAGED_DEPLOYMENT_ID: \$\{\{ steps\.staged-deployment\.outputs\.deployment_id \}\}/u,
  );
  assert.match(
    gate,
    /STAGED_TARGET_URL: \$\{\{ steps\.staged-deployment\.outputs\.target_url \}\}/u,
  );
  assert.match(gate, /EXPECTED_GIT_HEAD: \$\{\{ github\.sha \}\}/u);
  assert.match(
    gate,
    /vercel env run -e production --token="\$VERCEL_TOKEN" --/u,
  );
  assert.doesNotMatch(gate, /vercel env run --environment=production/u);
  assert.match(gate, /npm run probe:custom-v2:stage/u);
  assert.match(gate, /--registry-mode/u);
  assert.match(gate, /--generic-mode/u);
  assert.match(gate, /--authenticated-ingress-evidence-sha256/u);
  assert.doesNotMatch(gate, /echo .*AUTHENTICATED_INGRESS|set -x/u);
});

test("Custom V2 evidence is immutable while the workflow remains stage-only", () => {
  assert.match(
    deploy,
    /name: custom-v2-stage-evidence-\$\{\{ github\.run_id \}\}-\$\{\{ github\.run_attempt \}\}/u,
  );
  assert.match(deploy, /retention-days: 90/u);
  const sourceBuild = stepBlock(
    deploy,
    "Stage production source build without assigning domains",
  );
  assert.match(
    sourceBuild,
    /vercel deploy --prod --skip-domain --archive=tgz/u,
  );
  assert.doesNotMatch(
    sourceBuild,
    /PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE|PROGRAMMABLE_REQUIRE_GMGN_MARKET/u,
  );
  assert.doesNotMatch(deploy, /vercel build --prod|--prebuilt/u);
  assert.doesNotMatch(
    deploy,
    /vercel (?:promote|rollback)|--scope-production-alias/u,
  );
  assert.match(deploy, /Stage-only: no production promotion was attempted\./u);
  assert.ok(
    deploy.indexOf("Resolve exact staged deployment") <
      deploy.indexOf("Gate exact unaliased Custom V2 staged candidate"),
  );
  assert.ok(
    deploy.indexOf("Gate exact unaliased Custom V2 staged candidate") <
      deploy.indexOf("Reverify staged candidate binding"),
  );
  const stablePreview = stepBlock(
    deploy,
    "Bind exact candidate to stable protected preview",
  );
  assert.match(
    stablePreview,
    /STABLE_PREVIEW_HOST: launcher-v4-aficialais-projects\.vercel\.app/u,
  );
  assert.match(stablePreview, /VERCEL_SCOPE: aficialais-projects/u);
  assert.match(stablePreview, /test "\$VERCEL_SCOPE" = aficialais-projects/u);
  assert.match(
    stablePreview,
    /vercel alias set "\$EXPECTED_DEPLOYMENT_ID" "\$STABLE_PREVIEW_HOST" \\\n+            --scope="\$VERCEL_SCOPE"/u,
  );
  assert.match(
    stablePreview,
    /vercel inspect "\$STABLE_PREVIEW_HOST" --format=json \\\n+            --scope="\$VERCEL_SCOPE"/u,
  );
  assert.match(
    stablePreview,
    /inspected\.id !== process\.env\.EXPECTED_DEPLOYMENT_ID/u,
  );
  assert.match(stablePreview, /inspected\.url !== expectedTarget\.hostname/u);
  assert.doesNotMatch(stablePreview, /inspected\.aliases/u);
  assert.match(
    stablePreview,
    /test "\$STABLE_PREVIEW_HOST" != programmable\.market/u,
  );
  assert.doesNotMatch(stablePreview, /\*\.vercel\.app/u);
  assert.equal(deploy.match(/vercel alias set/gu)?.length, 1);
  assert.doesNotMatch(deploy.replace(stablePreview, ""), /vercel alias/u);
  assert.ok(
    deploy.indexOf("Reverify staged candidate binding") <
      deploy.indexOf("Bind exact candidate to stable protected preview"),
  );
});

test("staging retains the provider-free legacy API reset policy", () => {
  const policy = stepBlock(deploy, "Validate staged legacy Explore API reset policy");
  assert.match(policy, /id: read-model-policy/u);
  assert.match(policy, /npm run perf:read-model:deploy-policy --/u);
  assert.match(policy, /--env-file \.vercel\/\.env\.production\.local/u);
  assert.match(
    policy,
    /--sensitive-env-metadata "\$RUNNER_TEMP\/vercel-production-env-metadata\.json"/u,
  );
  assert.doesNotMatch(policy, /continue-on-error/u);
  assert.doesNotMatch(
    deploy,
    /Verify staged QuickNode wake authentication|perf:read-model:wake-canary|wake_canary_required/u,
  );
});

test("every staged source build proves the token image runtime without a write", () => {
  const probe = stepBlock(
    deploy,
    "Probe staged token image runtime without writes",
  );
  assert.match(
    probe,
    /STAGED_TARGET_URL: \$\{\{ steps\.staged-deployment\.outputs\.target_url \}\}/u,
  );
  assert.match(probe, /"\/api\/token-image"/u);
  assert.match(probe, /method: "POST"/u);
  assert.match(probe, /contentType !== "application\/json"/u);
  assert.match(probe, /readBoundedResponseText\(response/u);
  assert.match(probe, /response\.status !== 401/u);
  assert.match(probe, /body\.error !== "Connect your wallet and try again"/u);
  assert.doesNotMatch(
    probe,
    /(?:^|[{,\n])\s*["']?(?:authorization|cookie|x-privy-identity-token)["']?\s*:/iu,
  );
  assert.doesNotMatch(probe, /\n\s+"?body"?\s*:|new\s+(?:FormData|File)\b/iu);
  assert.ok(
    deploy.indexOf("Resolve exact staged deployment") <
      deploy.indexOf("Probe staged token image runtime without writes"),
  );
});

test("Generic signer OIDC proof is one-shot, two-Machine and cleanup-attested", () => {
  for (const input of [
    "custom_v2_generic_signer_probe_expected_json",
    "custom_v2_generic_signer_probe_expected_sha256",
  ])
    assert.match(deploy, new RegExp(`${input}:`, "u"));
  const prepare = stepBlock(
    deploy,
    "Prepare one-shot Generic signer probe authority",
  );
  assert.match(prepare, /randomBytes\(32\)\.toString\("hex"\)/u);
  assert.match(prepare, /::add-mask::/u);
  assert.match(prepare, /generic-launch-read-stage-probe-operation\.v1/u);
  assert.match(prepare, /recoveryId/u);
  assert.doesNotMatch(prepare, /secret=.*GITHUB_OUTPUT/u);
  const preflight = stepBlock(
    deploy,
    "Reconcile all residual Generic signer probes before new authority",
  );
  assert.match(preflight, /--scope all-project-probes/u);
  assert.match(preflight, /reconcile-generic-signer-probe-deployments\.mjs/u);
  const operationRecord = stepBlock(
    deploy,
    "Preserve pre-mutation Generic signer probe operation record",
  );
  assert.match(operationRecord, /actions\/upload-artifact@043fb46/u);
  const probeDeploy = stepBlock(
    deploy,
    "Deploy one-shot unaliased Generic signer probe candidate",
  );
  assert.match(
    probeDeploy,
    /vercel deploy --prod --skip-domain --archive=tgz/u,
  );
  assert.match(probeDeploy, /PROGRAMMABLE_GENERIC_LAUNCH_SIGNER_PROBE_TOKEN/u);
  assert.match(
    probeDeploy,
    /PROGRAMMABLE_GENERIC_LAUNCH_SIGNER_PROBE_EXPECTED_V1_JSON/u,
  );
  assert.match(probeDeploy, /programmableGenericSignerProbeRecoveryId/u);
  assert.match(probeDeploy, /programmableGenericSignerProbe=one-shot-v1/u);
  assert.match(probeDeploy, /programmableRepositoryId=1314365508/u);
  const prove = stepBlock(
    deploy,
    "Prove both exact Generic signer Machines from Vercel OIDC",
  );
  assert.match(prove, /npm run probe:custom-v2:signer-stage/u);
  const reconciliation = stepBlock(
    deploy,
    "Reconcile every secret-bearing Generic signer probe deployment",
  );
  assert.match(reconciliation, /always\(\)/u);
  assert.match(
    reconciliation,
    /generic-signer-probe-authority\.outcome == 'success'/u,
  );
  assert.doesNotMatch(
    reconciliation,
    /generic-signer-probe-deploy\.outcome == 'success'/u,
  );
  assert.match(
    reconciliation,
    /reconcile-generic-signer-probe-deployments\.mjs/u,
  );
  const localCleanup = stepBlock(
    deploy,
    "Remove local Generic signer probe credential",
  );
  assert.match(localCleanup, /always\(\)/u);
  assert.match(localCleanup, /unlinkSync\(target\)/u);
  const clean = stepBlock(
    deploy,
    "Prove clean candidate carries no Generic signer probe authority",
  );
  assert.match(clean, /response\.status !== 503/u);
  assert.match(clean, /probe_unavailable/u);
  assert.match(clean, /readBoundedResponseText/u);
  assert.doesNotMatch(clean, /response\.(?:json|text)\(\)/u);
  const attest = stepBlock(
    deploy,
    "Attest canonical Generic signer probe cleanup bundle",
  );
  assert.match(
    attest,
    /actions\/attest@59d89421af93a897026c735860bf21b6eb4f7b26/u,
  );
  assert.match(attest, /create-storage-record: false/u);
  assert.match(
    deploy,
    /steps\.attest-generic-signer-probe-bundle\.outputs\.bundle-path/u,
  );
  assert.match(deploy, /attestations: write/u);
  assert.match(deploy, /id-token: write/u);
  assert.ok(
    deploy.indexOf(
      "Reconcile every secret-bearing Generic signer probe deployment",
    ) <
      deploy.indexOf("Stage production source build without assigning domains"),
  );
  assert.ok(
    deploy.indexOf(
      "Reconcile all residual Generic signer probes before new authority",
    ) < deploy.indexOf("Prepare one-shot Generic signer probe authority"),
  );
  assert.ok(
    deploy.indexOf(
      "Preserve pre-mutation Generic signer probe operation record",
    ) <
      deploy.indexOf(
        "Deploy one-shot unaliased Generic signer probe candidate",
      ),
  );
  assert.match(deploy, /^  generic-signer-probe-reconcile:$/mu);
  assert.match(
    deploy,
    /generic-signer-probe-reconcile:[\s\S]*needs: \[release-gate, deploy\][\s\S]*always\(\)[\s\S]*Delete every residual exact probe deployment and prove absence[\s\S]*reconcile-generic-signer-probe-deployments\.mjs/u,
  );
  assert.match(
    standaloneReconcile,
    /^name: Reconcile Generic Signer Probes$/mu,
  );
  assert.match(standaloneReconcile, /^  workflow_dispatch:$/mu);
  assert.match(standaloneReconcile, /github\.repository_id == 1314365508/u);
  assert.match(standaloneReconcile, /group: programmable-production/u);
  assert.match(standaloneReconcile, /cancel-in-progress: false/u);
  assert.match(standaloneReconcile, /environment:[\s\S]*name: production/u);
  assert.match(standaloneReconcile, /--scope all-project-probes/u);
  assert.match(
    standaloneReconcile,
    /reconcile-generic-signer-probe-deployments\.mjs/u,
  );
  assert.match(standaloneReconcile, /actions\/attest@59d89421/u);
  assert.doesNotMatch(
    standaloneReconcile,
    /PROGRAMMABLE_GENERIC_LAUNCH_SIGNER_PROBE_TOKEN/u,
  );
  assert.doesNotMatch(deploy, /vercel promote/u);
});

test("new stage and cleanup HTTP consumers share the bounded streaming reader", () => {
  assert.match(boundedReader, /headers\?\.get\?\.\("content-length"\)/u);
  assert.match(boundedReader, /body\?\.getReader\?\.\(\)/u);
  assert.match(boundedReader, /reader\.cancel/u);
  assert.match(boundedReader, /reader\.releaseLock\(\)/u);
  assert.match(boundedReader, /length > maximumBytes/u);
  assert.match(boundedReader, /Buffer\.alloc\(maximumBytes\)/u);
  assert.match(boundedReader, /bytes\.set\(value/u);
  assert.match(boundedReader, /chunkCount > MAXIMUM_CHUNKS/u);
  assert.doesNotMatch(boundedReader, /chunks\.push|Buffer\.concat/u);
  for (const source of [stageGate, signerProbeGate, reconciler]) {
    assert.match(source, /from "\.\/read-bounded-response\.mjs"/u);
    assert.match(source, /readBoundedResponseText/u);
  }
  const stagedJsonHelper = stageGate.slice(
    stageGate.indexOf("const requestJson ="),
    stageGate.indexOf("const manifestResult ="),
  );
  assert.doesNotMatch(stagedJsonHelper, /response\.(?:json|text)\(\)/u);
  assert.doesNotMatch(signerProbeGate, /response\.(?:json|text)\(\)/u);
  assert.doesNotMatch(reconciler, /response\.(?:json|text)\(\)/u);
});

test("every staged candidate proves the exact Explore index reset", () => {
  const metadataBinding = stepBlock(
    deploy,
    "Bind staged production environment metadata",
  );
  assert.notEqual(deploy.indexOf("Pull production configuration"), -1);
  assert.ok(
    deploy.indexOf("Pull production configuration") <
      deploy.indexOf("Bind staged production environment metadata"),
  );
  assert.ok(
    deploy.indexOf("Bind staged production environment metadata") <
      deploy.indexOf("Validate staged legacy Explore API reset policy"),
  );
  assert.match(
    deploy,
    /VERCEL_ORG_ID: \$\{\{ secrets\.VERCEL_ORG_ID \}\}[\s\S]*VERCEL_PROJECT_ID: \$\{\{ secrets\.VERCEL_PROJECT_ID \}\}/u,
  );
  assert.doesNotMatch(deploy, /\bprj_[A-Za-z0-9]{8,128}\b/u);
  assert.match(
    metadataBinding,
    /vercel env ls production --format json --token="\$VERCEL_TOKEN" \|\n\s+node scripts\/bind-vercel-sensitive-production-metadata\.mjs \\\n\s+--metadata-file "\$metadata_file" \\\n\s+--vercel-project-id "\$VERCEL_PROJECT_ID"/u,
  );
  assert.doesNotMatch(
    metadataBinding,
    /\.vercel\/\.env\.production\.local|set -x|console\.log/u,
  );
  assert.doesNotMatch(metadataBinding, /vercel env ls production[^\n]*>[^|]/u);
  assert.match(metadataBinding, /set -euo pipefail/u);
  assert.doesNotMatch(metadataBinding, /continue-on-error:/u);

  const smoke = stepBlock(
    deploy,
    "Smoke exact staged legacy Explore API reset",
  );
  assert.match(smoke, /id: index-reset-smoke/u);
  assert.match(
    smoke,
    /STAGED_TARGET_URL: \$\{\{ steps\.staged-deployment\.outputs\.target_url \}\}/u,
  );
  assert.match(
    smoke,
    /VERCEL_AUTOMATION_BYPASS_SECRET: \$\{\{ secrets\.VERCEL_AUTOMATION_BYPASS_SECRET \}\}/u,
  );
  assert.match(
    smoke,
    /node scripts\/smoke-explore-index-reset-public-apis\.mjs/u,
  );
  assert.doesNotMatch(smoke, /\n        if:|continue-on-error:/u);
  assert.equal(
    deploy.match(/smoke-explore-index-reset-public-apis\.mjs/gu)?.length,
    1,
  );
  assert.ok(
    deploy.indexOf("Resolve exact staged deployment") <
      deploy.indexOf("Smoke exact staged legacy Explore API reset"),
  );
  assert.ok(
    deploy.indexOf("Smoke exact staged legacy Explore API reset") <
      deploy.indexOf("Reverify staged candidate binding"),
  );

  for (const output of [
    "indexing_status",
    "public_routes_checked",
    "retired_operations_checked",
    "provider_calls_expected",
  ]) {
    assert.match(
      deploy,
      new RegExp(
        `${output}: \\\$\\{\\{ steps\\.index-reset-smoke\\.outputs\\.${output} \\}\\}`,
        "u",
      ),
    );
  }

  const handoff = stepBlock(deploy, "Record staged candidate handoff");
  assert.match(
    handoff,
    /READ_MODEL_POLICY_MODE: \$\{\{ steps\.read-model-policy\.outputs\.mode \}\}/u,
  );
  assert.match(
    handoff,
    /PROVIDER_CREDENTIALS_REQUIRED: \$\{\{ steps\.read-model-policy\.outputs\.provider_credentials_required \}\}/u,
  );
  assert.match(
    handoff,
    /INDEXING_STATUS: \$\{\{ steps\.index-reset-smoke\.outputs\.indexing_status \}\}/u,
  );
  assert.match(handoff, /Legacy Explore API indexing status:/u);
  assert.match(handoff, /Public reset routes checked:/u);
  assert.match(handoff, /Retired operations checked:/u);
  assert.match(handoff, /Expected external indexing calls from legacy reset probes:/u);

  assert.doesNotMatch(
    deploy,
    /Probe exact staged Envio Classic V3 catalog|smoke-static-dexscreener-public-apis|public-provider-smoke|wake-canary|wake_canary_required|PROGRAMMABLE_REAL_BLOCK_SLA_FORCE_PROVIDER_RETRY_ONCE/iu,
  );
  assert.doesNotMatch(
    deploy,
    /GMGN|DexScreener|Bitquery|Envio Classic V3|market-cap ranking|Visible market provider/iu,
  );

  for (const retired of [
    "Resolve read-model release policy",
    "Attest exact staged release policy",
    "Preserve staged release attestation",
    "Record staged release attestation",
    "Refresh and prove exact staged durable read model",
    "Smoke staged public market APIs",
    "Gate exact staged operational health",
  ]) {
    assert.equal(deploy.includes("      - name: " + retired), false);
  }
});

test("the staged reset smoke is separate, bounded, and provider-free", () => {
  const source = readFileSync(
    "scripts/smoke-explore-index-reset-public-apis.mjs",
    "utf8",
  );
  assert.match(source, /readBoundedResponseText/u);
  assert.match(source, /MAXIMUM_RESPONSE_BYTES = 64 \* 1024/u);
  assert.match(source, /REQUEST_TIMEOUT_MS = 15_000/u);
  assert.match(source, /redirect: "error"/u);
  assert.match(source, /cache: "no-store"/u);
  assert.match(source, /requestUrl\.origin !== input\.target\.origin/u);
  assert.match(source, /PUBLIC_PROBES\.map/u);
  assert.match(source, /RETIRED_OPERATION_PROBES\.map/u);
  assert.match(source, /PAUSED_TRIGGER_PROBES\.map/u);
  assert.match(source, /await Promise\.all/u);
  assert.match(
    source,
    /export function runStagedExploreIndexResetSmokeV1/u,
  );
  assert.match(
    source,
    /export function runProductionExploreIndexResetSmokeV1/u,
  );
  for (const output of [
    "indexing_status=index-reset",
    "public_routes_checked=",
    "retired_operations_checked=",
    "provider_calls_expected=0",
  ]) {
    assert.match(source, new RegExp(output, "u"));
  }
  assert.doesNotMatch(
    source,
    /smoke-static-dexscreener|PROGRAMMABLE_REQUIRE_GMGN_MARKET|BITQUERY_API_KEY|runtimeProductionProviderEndpoints|readPrimaryRpc|readBitquery|fetchBitquery/iu,
  );
  assert.doesNotMatch(
    source,
    /\/api\/explore\/profile\/claim|\/api\/trade\/prepare/u,
  );
});
