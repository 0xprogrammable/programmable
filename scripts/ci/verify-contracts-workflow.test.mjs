import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const workflow = yaml.load(readFileSync(new URL("../../.github/workflows/verify.yml", import.meta.url), "utf8"));
const jobs = workflow.jobs;
const workers = ["contracts-build", "contracts-tests-1", "contracts-tests-2", "contracts-release", "contracts-analysis"];
const step = (job, name) => {
  const matches = job.steps.filter((candidate) => candidate.name === name);
  assert.equal(matches.length, 1, name);
  return matches[0];
};

test("different verification intentions cannot cancel each other while newer changes still supersede older ones", () => {
  assert.equal(workflow.concurrency.group,
    "verify-${{ github.ref }}-${{ github.event_name == 'workflow_dispatch' && inputs.verification_mode || 'change' }}");
  assert.equal(workflow.concurrency["cancel-in-progress"], true);
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.verification_mode.options, ["custom-v2-release"]);
});

test("contract test partitions and integrations consume only the complete build from this run and exact source", () => {
  for (const id of workers) {
    const job = jobs[id];
    assert.equal(job.if, "needs.scope.outputs.contracts == 'true'");
    assert.equal(job["continue-on-error"], undefined);
    assert.equal(step(job, "Set up Foundry").with.version, "v1.7.1");
    assert.equal(step(job, "Install dependencies").run, "npm ci --no-audit --no-fund");
    assert.equal(step(job, "Check out repository").with?.ref, undefined);
    if (id === "contracts-build") continue;
    if (id === "contracts-analysis") {
      assert.deepEqual(job.needs, ["scope"]);
      assert.ok(job.steps.every((candidate) => !candidate.uses?.startsWith("actions/download-artifact@")));
      assert.ok(job.steps.every((candidate) => !candidate.run?.includes("verify-receipt")));
      assert.equal(step(job, "Install exact Slither").run, "pipx install slither-analyzer==0.11.5");
      assert.equal(step(job, "Run both unchanged Slither profiles in their isolated checkout").run,
        "node scripts/ci/contracts-ci.mjs analysis");
      continue;
    }
    assert.deepEqual(job.needs, ["scope", "contracts-build"]);
    const download = step(job, "Download only this run's contract build");
    assert.equal(download.uses, "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c");
    assert.deepEqual(download.with, {
      "artifact-ids": "${{ needs.contracts-build.outputs.artifact-id }}",
      path: "contracts", "digest-mismatch": "error",
    });
    const verify = step(job, "Verify exact contract build source and toolchain");
    assert.equal(verify.run, "node scripts/ci/contracts-ci.mjs verify-receipt");
    assert.equal(verify.if, undefined);
    assert.ok(job.steps.indexOf(download) < job.steps.indexOf(verify));
    assert.ok(job.steps.indexOf(verify) < job.steps.length - 1);
  }
  for (const shard of [1, 2]) {
    const job = jobs[`contracts-tests-${shard}`];
    assert.equal(job.strategy, undefined);
    assert.equal(job.name, `Contracts tests (${shard}/2)`);
    assert.equal(step(job, "Verify the complete deterministic test partition").run,
      `node scripts/ci/contracts-ci.mjs test ${shard}`);
    assert.deepEqual(step(job, "Verify the complete deterministic test partition").env, {
      ETHEREUM_RPC_URL: "https://ethereum-rpc.publicnode.com",
      ETHEREUM_ARCHIVE_RPC_URL: "https://eth.drpc.org",
    });
  }
  const upload = step(jobs["contracts-build"], "Preserve this run's complete compiler outputs");
  assert.equal(upload.with.name, "contracts-build-${{ github.run_id }}-${{ github.run_attempt }}");
  assert.equal(upload.with.path.trim(), "contracts/out\ncontracts/cache");
  assert.equal(upload.with["if-no-files-found"], "error");
  assert.equal(upload.with.overwrite, false);
  assert.match(step(jobs["contracts-build"], "Verify contract orchestration and complete test coverage").run,
    /node --test scripts\/ci\/contracts-ci.test.mjs scripts\/ci\/verify-contracts-workflow.test.mjs contracts\/scripts\/verify-fork-tests-ci.test.mjs/u);
});

test("the protected Contracts context retains exact attested evidence and requires every worker", () => {
  const job = jobs.contracts;
  assert.equal(job.name, "Contracts");
  assert.equal(job.if, "always()");
  assert.deepEqual(job.needs, ["scope", ...workers]);
  for (const name of ["Reject partial or mixed Robinhood Phase B backend evidence imports",
    "Reject partial or mixed Robinhood V4.1 Phase B backend evidence imports",
    "Verify exact fresh Robinhood Phase B backend evidence", "Verify exact fresh Robinhood V4.1 Phase B backend evidence"]) {
    assert.equal(step(job, name)["continue-on-error"], undefined);
  }
  for (const id of ["production-proof", "aggregate"]) assert.ok(jobs[id].needs.includes("contracts"));
});

test("actual Contracts aggregate cannot accept a missing, failed, cancelled, or inconsistently skipped worker", () => {
  const gate = step(jobs.contracts, "Require complete contract verification");
  const keys = ["BUILD_RESULT", "TESTS_1_RESULT", "TESTS_2_RESULT", "RELEASE_RESULT", "ANALYSIS_RESULT"];
  const run = (overrides) => {
    const result = spawnSync("bash", ["--noprofile", "--norc", "-c", gate.run], {
      env: { PATH: process.env.PATH, SCOPE_RESULT: "success", CONTRACTS_REQUIRED: "true",
        ...Object.fromEntries(keys.map((key) => [key, "success"])), ...overrides }, timeout: 2_000,
    });
    assert.equal(result.error, undefined);
    return result.status;
  };
  assert.equal(run({}), 0);
  assert.equal(run({ CONTRACTS_REQUIRED: "false", ...Object.fromEntries(keys.map((key) => [key, "skipped"])) }), 0);
  for (const key of keys) for (const value of ["failure", "cancelled", "skipped", "", undefined]) {
    assert.notEqual(run({ [key]: value }), 0, `${key}/${value}`);
  }
  for (const required of ["", "unknown", undefined]) assert.notEqual(run({ CONTRACTS_REQUIRED: required }), 0);
  for (const result of ["failure", "cancelled", "skipped", ""]) assert.notEqual(run({ SCOPE_RESULT: result }), 0);
  for (const key of keys) assert.notEqual(run({ CONTRACTS_REQUIRED: "false",
    ...Object.fromEntries(keys.map((name) => [name, "skipped"])), [key]: "success" }), 0);
});
