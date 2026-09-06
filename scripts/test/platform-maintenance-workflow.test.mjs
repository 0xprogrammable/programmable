import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (name) => readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), "utf8");
const producer = read("platform-maintenance-verify");
const consumer = read("platform-maintenance-release");
const postMerge = read("platform-maintenance-post-merge");
function job(source, id) {
  const expression = new RegExp(`^  ${id}:\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:\\n|$(?![\\s\\S]))`, "m");
  const match = expression.exec(source);
  assert.ok(match, `missing job ${id}`);
  return match[1];
}

test("both independent execution lanes use exact source checkouts and no privileged credentials", () => {
  for (const workflow of [producer, postMerge]) {
    for (const lane of ["foundry", "slither"]) {
      const worker = job(workflow, lane);
      assert.match(worker, /permissions:\n      contents: read\n/);
      assert.doesNotMatch(worker, /(?:id-token|attestations|checks|actions|pull-requests): write|GH_TOKEN:|GITHUB_TOKEN:|secrets\./);
      assert.match(worker, /ref: \$\{\{ github\.workflow_sha \}\}/);
      assert.match(worker, /ref: \$\{\{ needs\.select\.outputs\.(head_sha|merge_sha) \}\}/);
      assert.match(worker, /run: node trusted\/scripts\/ci\/platform-maintenance-runner\.mjs (post-)?worker/);
      assert.equal((worker.match(/uses: actions\/checkout@/g) ?? []).length, 2);
      assert.equal((worker.match(/persist-credentials: false/g) ?? []).length, 2);
      assert.doesNotMatch(worker, /continue-on-error|\|\| true|--fail-none/);
    }
  }
});

test("attestation is a separate trusted job requiring both successful lanes and immutable artifacts", () => {
  for (const workflow of [producer, postMerge]) {
    const issuer = job(workflow, "attest");
    assert.match(issuer, /needs: \[select, foundry, slither\]/);
    assert.match(issuer, /needs\.select\.result == 'success'/);
    assert.match(issuer, /needs\.foundry\.result == 'success'/);
    assert.match(issuer, /needs\.slither\.result == 'success'/);
    assert.match(issuer, /id-token: write/);
    assert.match(issuer, /attestations: write/);
    assert.doesNotMatch(issuer, /path: candidate|contents: write|checks: write|secrets\./);
    assert.equal((issuer.match(/uses: actions\/download-artifact@/g) ?? []).length, 3);
    assert.equal((issuer.match(/digest-mismatch: error/g) ?? []).length, 3);
    assert.equal((issuer.match(/artifact-ids:/g) ?? []).length, 3);
    assert.match(issuer, /uses: actions\/attest@[a-f0-9]{40}/);
  }
});

test("privileged consumer never checks out or executes candidate code and cannot submit a review", () => {
  const merge = job(consumer, "consume");
  assert.match(merge, /checks: write/);
  assert.match(merge, /contents: write/);
  assert.match(merge, /pull-requests: read/);
  assert.doesNotMatch(merge, /path: candidate|needs\.select\.outputs|id-token: write/);
  assert.match(merge, /artifact-ids: \$\{\{ steps\.producer\.outputs\.artifact_id \}\}/);
  assert.match(merge, /run-id: \$\{\{ steps\.producer\.outputs\.run_id \}\}/);
  assert.match(merge, /digest-mismatch: error/);
  const source = readFileSync(new URL("../ci/platform-maintenance-github.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\/reviews|merge_action|admin_bypass|gh pr merge/);
  const runner = readFileSync(new URL("../ci/platform-maintenance-runner.mjs", import.meta.url), "utf8");
  assert.equal((runner.match(/await consumeAuthenticatedEvidence\(/g) ?? []).length, 1);
  assert.doesNotMatch(runner, /publishAuthenticatedEvidenceCheck/);
});

test("only the trusted consumer mints a separately scoped policy-read token from source-pinned App identity", () => {
  const merge = job(consumer, "consume");
  assert.match(merge, /environment: platform-maintenance-policy/);
  assert.match(merge, /runner\.mjs policy-config/);
  assert.match(merge, /if: steps\.policy\.outputs\.configured == 'true'/);
  assert.match(merge, /uses: actions\/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1/);
  assert.match(merge, /app-id: \$\{\{ steps\.policy\.outputs\.app_id \}\}/);
  assert.match(merge, /owner: programmablehq\n          repositories: PROGRAMMABLE/);
  assert.match(merge, /permission-administration: read\n          permission-metadata: read/);
  assert.match(merge, /skip-token-revoke: false/);
  assert.match(merge, /MAINTENANCE_POLICY_INSTALLATION_ID: \$\{\{ steps\.policy_token\.outputs\.installation-id \}\}/);
  assert.match(merge, /MAINTENANCE_POLICY_READ_TOKEN: \$\{\{ steps\.policy_token\.outputs\.token \}\}/);
  assert.deepEqual(merge.match(/secrets\.[A-Z_]+/g), ["secrets.PLATFORM_MAINTENANCE_POLICY_APP_PRIVATE_KEY"]);
  for (const source of [producer, postMerge, job(consumer, "dispatch")]) {
    assert.doesNotMatch(source, /POLICY_READ_TOKEN|POLICY_APP_PRIVATE_KEY|create-github-app-token/);
  }
});

test("post-merge dispatch has its own Actions-only write authority and exact returned merge input", () => {
  const dispatch = job(consumer, "dispatch");
  assert.match(dispatch, /needs: consume/);
  assert.match(dispatch, /actions: write/);
  assert.match(dispatch, /contents: read/);
  assert.doesNotMatch(dispatch, /contents: write|checks: write|pull-requests: write|id-token: write|secrets\./);
  assert.match(dispatch, /artifact-ids: \$\{\{ needs\.consume\.outputs\.merge_artifact \}\}/);
  assert.match(dispatch, /runner\.mjs dispatch/);
  assert.match(postMerge, /workflow_dispatch:/);
  assert.match(postMerge, /merge_sha:/);
  assert.match(postMerge, /controller_sha:/);
  assert.match(postMerge, /runner\.mjs post-select/);
  assert.match(postMerge, /post-merge-evidence\.json/);
  assert.doesNotMatch(postMerge, /contents: write|checks: write|vercel|flyctl|broadcast|secrets\./);
});

test("existing technical-completion events retry selection automatically without executing candidate workflow code", () => {
  assert.match(producer, /workflow_run:\n    workflows: \[Verify, Security, Verify hook builder intake feedback\]/);
  assert.match(producer, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(producer, /github\.event\.workflow_run\.pull_requests\[0\]\.base\.ref == 'main'/);
  assert.match(consumer, /workflows: \[Verify platform maintenance\]/);
  for (const workflow of [producer, consumer, postMerge]) {
    for (const line of workflow.split("\n").filter((line) => line.includes("uses:"))) {
      assert.match(line, /@[0-9a-f]{40}(?:\s|$)/);
    }
    for (const line of workflow.split("\n").filter((line) => /^\s+(?:-\s+)?run:/.test(line))) {
      assert.doesNotMatch(line, /\$\{\{/);
    }
  }
});

test("the current source-bound 702 control authorization stays unchanged", () => {
  const intake = read("verify-hook-builder");
  assert.match(intake, /APPROVED_MAIN_CI_CONTROL_COMMIT: e15bb397604a19d6622af5a5ee9622a8edac9d18/);
  assert.match(intake, /APPROVED_MAIN_CI_CONTROL_TREE: 92eecc16da2c59b87295fcb4012e57fe4f1feae7/);
  assert.match(intake, /feedback-only/);
});
