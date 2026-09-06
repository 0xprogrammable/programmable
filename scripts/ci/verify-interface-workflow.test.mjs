import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import yaml from "js-yaml";

const workflow = yaml.load(readFileSync(
  new URL("../../.github/workflows/verify.yml", import.meta.url),
  "utf8",
));
const scripts = JSON.parse(readFileSync(
  new URL("../../package.json", import.meta.url),
  "utf8",
)).scripts;
const jobs = workflow.jobs;
const quality = jobs["interface-quality"];
const browserBuild = jobs["interface-browser-build"];
const aggregate = jobs.interface;

function step(job, name) {
  const matches = job.steps.filter((entry) => entry.name === name);
  assert.equal(matches.length, 1, `${name} must run exactly once`);
  return matches[0];
}

function interfaceStages(scriptName) {
  return scripts[scriptName].split(" && ").flatMap((command) => {
    const match = command.match(/^npm run (verify:interface:[a-z:-]+)$/u);
    return match ? interfaceStages(match[1]) : [command];
  });
}

test("isolated Interface jobs retain every original command and a complete local entry point", () => {
  assert.deepEqual(interfaceStages("verify:interface:ci"), [
    "npm run test:ci-scope",
    "npm run lint",
    "npm run modules:sdk:test",
    "npm run modules:cli:check",
    "npm run modules:cli:test",
    "npm run test:interface:ci",
    "npm run test:browser:wallet-lock",
    "npm run test:browser:late-migration",
    "npm run build",
  ]);
  assert.equal(scripts["verify:interface:quality:ci"],
    "npm run test:ci-scope && npm run lint && npm run modules:sdk:test && npm run modules:cli:check && npm run modules:cli:test && npm run test:interface:ci");
  assert.equal(scripts["modules:sdk:test"], "node --test packages/classic-modules/test/*.test.mjs");
  assert.equal(scripts["verify:interface:browser-build:ci"],
    "npm run test:browser:wallet-lock && npm run test:browser:late-migration && npm run build");
  assert.equal(scripts["test:ci-scope"],
    "node --test scripts/ci/classify-verify-paths.test.mjs scripts/ci/verify-interface-workflow.test.mjs scripts/ci/interface-guidance-scope.test.mjs");
  assert.equal(scripts["test:interface:ci"],
    "npm run test:gitbook-openapi && npm run verify:candidate-neutrality && npm run verify:service-launch-permit-v2-golden && npm run test:retired-read-model-cutover && node --test scripts/test/verify-candidate-neutral-production.test.mjs scripts/test/verify-service-launch-permit-v2-golden.test.mjs scripts/test/verify-custom-launch-production-bundle.test.mjs scripts/test/smoke-explore-index-reset-public-apis.test.mjs && vitest run --exclude tests/classic-v3-deployment-sequence.test.ts --exclude tests/deep-release-verifier.test.ts --exclude tests/deep-v2-release-verifier.test.ts --exclude tests/website-projection-target.test.ts");
  assert.equal(scripts.build,
    "npm run docs:gitbook-openapi:check && npm run verify:candidate-neutrality && next build && npm run verify:candidate-neutrality:build && node scripts/verify-custom-launch-production-bundle.mjs");
});

test("quality and browser/build run independently in separate locked checkouts of the same source", () => {
  for (const job of [quality, browserBuild]) {
    assert.equal(job.needs, "scope");
    assert.equal(job.if, "needs.scope.outputs.interface == 'true'");
    assert.equal(job["runs-on"], "ubuntu-latest");
    assert.equal(job["continue-on-error"], undefined);
    assert.equal(job.environment, undefined);
    const checkout = step(job, "Check out repository");
    assert.equal(checkout.uses,
      "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09");
    assert.deepEqual(checkout.with, { "fetch-depth": 0 });
    assert.equal(checkout.if, undefined);
    const setupNode = step(job, "Set up Node.js");
    assert.equal(setupNode.uses,
      "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444");
    assert.deepEqual(setupNode.with, { "node-version": "24.14.0", cache: "npm" });
    assert.equal(step(job, "Install dependencies").run, "npm ci --no-audit --no-fund");
    assert.equal(step(job, "Install dependencies").if, undefined);
    assert.equal(job.steps.some((entry) => /artifact|actions\/cache/u.test(entry.uses ?? "")), false);
    for (const entry of job.steps) {
      assert.equal(entry["continue-on-error"], undefined, entry.name);
      assert.doesNotMatch(entry.run ?? "", /\|\| true/u);
    }
  }
  const qualityRun = step(quality, "Verify interface quality and tests");
  const browserRun = step(browserBuild, "Verify interface browser interactions and production build");
  assert.equal(qualityRun.run, "npm run verify:interface:quality:ci");
  assert.equal(browserRun.run, "npm run verify:interface:browser-build:ci");
  for (const verification of [qualityRun, browserRun]) {
    assert.equal(verification.if, "needs.scope.outputs.interface_guidance_only != 'true' || needs.scope.outputs.custom_v2 == 'true'");
    assert.deepEqual(verification.env, {
      PROGRAMMABLE_CI_BASE_SHA: "${{ github.event.pull_request.base.sha || github.event.before }}",
      PROGRAMMABLE_CI_HEAD_SHA: "${{ github.event.pull_request.head.sha || github.sha }}",
    });
  }
  assert.equal(quality.steps.some((entry) => /chromium|playwright/iu.test(entry.run ?? "")), false);
  assert.equal(step(browserBuild, "Install pinned Chromium for wallet interaction tests").run,
    "npx playwright install --with-deps chromium");
  const audit = step(quality, "Audit production dependencies");
  assert.equal(audit.if,
    "needs.scope.outputs.interface == 'true' && needs.scope.outputs.dependencies == 'true'");
  assert.equal(audit.run.trim(),
    "node --test scripts/ci/run-production-dependency-audit.test.mjs\nnpm run audit:prod");
});

test("the built checkout retains full-history release, both activation, and read-model gates", () => {
  assert.deepEqual(browserBuild.permissions, {
    actions: "read",
    attestations: "read",
    contents: "read",
  });
  const requiredOrder = [
    "Verify interface browser interactions and production build",
    "Build the complete production interface for guide URL changes",
    "Require complete Git history for the V4 release audit",
    "Verify V4 clean-room no-broadcast release gate",
    "Verify V4 public API activation evidence",
    "Verify V4.1 public API activation evidence",
    "Verify affected read-model operations contract",
  ];
  const names = browserBuild.steps.map((entry) => entry.name);
  assert.deepEqual(names.slice(names.indexOf(requiredOrder[0])), requiredOrder);
  const history = step(browserBuild, requiredOrder[2]);
  assert.equal(history.if, "needs.scope.outputs.interface == 'true'");
  assert.match(history.run, /git fetch --unshallow --no-tags origin/u);
  assert.match(history.run, /test "\$\(git rev-parse --is-shallow-repository\)" = false/u);
  const cleanRoom = step(browserBuild, requiredOrder[3]);
  assert.equal(cleanRoom.if, "needs.scope.outputs.interface == 'true'");
  assert.equal(cleanRoom.run, "npm run release:custom-launch:v4:clean-room:test");
  for (const [version, name] of [["v4", requiredOrder[4]], ["v41", requiredOrder[5]]]) {
    const activation = step(browserBuild, name);
    assert.equal(activation.if, "needs.scope.outputs.interface == 'true'");
    assert.deepEqual(activation.env, { GH_TOKEN: "${{ github.token }}" });
    assert.equal(activation.run.trim(),
      `node --test scripts/test/programmable-${version}-api-activation.test.mjs\nnode scripts/programmable-${version}-api-activation.mjs audit --repository-root "$GITHUB_WORKSPACE"`);
  }
  const readModel = step(browserBuild, requiredOrder[6]);
  assert.equal(readModel.if, "needs.scope.outputs.read_model == 'true'");
  assert.equal(readModel.run, "npm run perf:read-model:ops-gate");
});

test("Custom V2 shares only identical same-run Interface work and retains its complete standalone release path", () => {
  const custom = jobs["custom-v2"];
  const shared = step(custom, "Verify Custom V2 checks using this run's Interface coverage");
  assert.equal(shared.if, "needs.scope.outputs.custom_v2 == 'true' && needs.scope.outputs.interface == 'true' && needs.scope.outputs.interface_guidance_only != 'true'");
  assert.equal(shared.run, "npm run verify:custom-v2:checks:ci");
  assert.equal(step(custom, "Verify exact Custom V2 surface").if,
    "needs.scope.outputs.custom_v2 == 'true' && (needs.scope.outputs.interface != 'true' || needs.scope.outputs.interface_guidance_only == 'true')");
  assert.equal(step(custom, "Verify exact Custom V2 surface").run, "npm run verify:custom-v2:ci");
  assert.equal(scripts["verify:custom-v2:ci"],
    "npm run lint && npm run verify:custom-v2:checks:ci && npm run verify:custom-v2:tests:ci && npm run perf:read-model:ops-gate && npm run build");
  assert.match(scripts["verify:custom-v2:checks:ci"], /^npm run typecheck && node --test /u);
  const files = scripts["verify:custom-v2:tests:ci"].replace(/^vitest run /u, "").split(" ");
  assert.equal(files.length, 12);
  const excluded = [...scripts["test:interface:ci"].matchAll(/--exclude ([^ ]+)/gu)].map((match) => match[1]);
  for (const file of files) {
    assert.match(file, /^tests\/.*\.test\.ts$/u);
    assert.equal(excluded.includes(file), false, `${file} must be covered by the full Interface batch`);
    assert.ok(readFileSync(new URL(`../../${file}`, import.meta.url)).length > 0);
  }
  for (const id of ["aggregate", "production-proof"]) {
    assert.ok(jobs[id].needs.includes("interface"));
    assert.ok(jobs[id].needs.includes("custom-v2"));
  }
  assert.equal(step(custom, "Verify Custom V2 operations when Interface does not select them").if,
    "needs.scope.outputs.custom_v2 == 'true' && needs.scope.outputs.interface == 'true' && needs.scope.outputs.interface_guidance_only != 'true' && needs.scope.outputs.read_model != 'true'");
  assert.equal(step(custom, "Verify Custom V2 operations when Interface does not select them").run,
    "npm run perf:read-model:ops-gate");
});

test("the stable Interface result remains an always-run dependency of release proof and aggregate", () => {
  assert.equal(aggregate.name, "Interface");
  assert.deepEqual(aggregate.needs, ["scope", "interface-quality", "interface-browser-build"]);
  assert.equal(aggregate.if, "always()");
  assert.equal(aggregate["continue-on-error"], undefined);
  assert.equal(step(aggregate, "Require successful change classification").if,
    "needs.scope.result != 'success'");
  assert.equal(step(aggregate, "Require successful change classification").run, "exit 1");
  const completion = step(aggregate, "Require complete interface verification");
  assert.equal(completion.if, undefined);
  assert.equal(completion["continue-on-error"], undefined);
  assert.equal(completion.shell, "bash");
  assert.deepEqual(completion.env, {
    SCOPE_RESULT: "${{ needs.scope.result }}",
    INTERFACE_REQUIRED: "${{ needs.scope.outputs.interface }}",
    READ_MODEL_REQUIRED: "${{ needs.scope.outputs.read_model }}",
    GUIDANCE_ONLY: "${{ needs.scope.outputs.interface_guidance_only }}",
    FUNCTIONAL_SCOPES: "${{ needs.scope.outputs.contracts }},${{ needs.scope.outputs.custom_v2 }},${{ needs.scope.outputs.database }},${{ needs.scope.outputs.dependencies }},${{ needs.scope.outputs.indexer }},${{ needs.scope.outputs.read_model }}",
    QUALITY_RESULT: "${{ needs.interface-quality.result }}",
    BROWSER_BUILD_RESULT: "${{ needs.interface-browser-build.result }}",
  });
  for (const id of ["production-proof", "aggregate"]) {
    assert.ok(jobs[id].needs.includes("interface"));
  }
  assert.equal(step(jobs["production-proof"], "Create exact production Verify proof")
    .env.PRODUCTION_VERIFY_INTERFACE_RESULT,
  "${{ needs.scope.outputs.interface == 'true' && needs.interface.result || 'skipped' }}");
  assert.equal(step(jobs.aggregate, "Require every protected verification lane to complete")
    .env.INTERFACE_RESULT, "${{ needs.interface.result }}");
});

function aggregateResult(overrides = {}) {
  const result = spawnSync("bash", ["--noprofile", "--norc", "-c",
    step(aggregate, "Require complete interface verification").run], {
    env: {
      PATH: process.env.PATH,
      SCOPE_RESULT: "success",
      INTERFACE_REQUIRED: "true",
      READ_MODEL_REQUIRED: "false",
      GUIDANCE_ONLY: "false",
      FUNCTIONAL_SCOPES: "false,false,false,false,false,false",
      QUALITY_RESULT: "success",
      BROWSER_BUILD_RESULT: "success",
      ...overrides,
    },
    encoding: "utf8",
    timeout: 2_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result.status;
}

test("the real aggregate shell rejects every incomplete, failed, cancelled, or unexpected lane result", () => {
  const results = ["success", "failure", "cancelled", "skipped", "unknown", ""];
  for (const required of ["true", "false"]) {
    for (const qualityResult of results) {
      for (const browserResult of results) {
        const expected = required === "true" ? "success" : "skipped";
        const status = aggregateResult({
          INTERFACE_REQUIRED: required,
          QUALITY_RESULT: qualityResult,
          BROWSER_BUILD_RESULT: browserResult,
        });
        assert.equal(status === 0,
          qualityResult === expected && browserResult === expected,
          JSON.stringify({ required, qualityResult, browserResult }));
      }
    }
  }
});

test("the real aggregate shell rejects missing or failed classification and missing inputs", () => {
  for (const result of ["failure", "cancelled", "skipped", "unknown", ""]) {
    assert.notEqual(aggregateResult({ SCOPE_RESULT: result }), 0, result);
    assert.notEqual(aggregateResult({ SCOPE_RESULT: result, INTERFACE_REQUIRED: "false",
      QUALITY_RESULT: "skipped", BROWSER_BUILD_RESULT: "skipped" }), 0, result);
  }
  for (const required of ["", "unknown", "TRUE", "1"]) {
    assert.notEqual(aggregateResult({ INTERFACE_REQUIRED: required }), 0, required);
  }
  assert.equal(aggregateResult({ READ_MODEL_REQUIRED: "true" }), 0);
  assert.notEqual(aggregateResult({ READ_MODEL_REQUIRED: "true", INTERFACE_REQUIRED: "false",
    QUALITY_RESULT: "skipped", BROWSER_BUILD_RESULT: "skipped" }), 0);
  for (const name of ["SCOPE_RESULT", "INTERFACE_REQUIRED", "READ_MODEL_REQUIRED", "GUIDANCE_ONLY", "QUALITY_RESULT", "BROWSER_BUILD_RESULT"]) {
    assert.notEqual(aggregateResult({ [name]: undefined }), 0, name);
  }
});

test("guidance coverage keeps the full build and rejects every functional mixed scope", () => {
  const guidance = step(quality, "Verify exact guide URL changes and their direct consumers");
  const build = step(browserBuild, "Build the complete production interface for guide URL changes");
  const narrowCondition = "needs.scope.outputs.interface_guidance_only == 'true' && needs.scope.outputs.custom_v2 != 'true'";
  assert.equal(guidance.if, narrowCondition);
  assert.equal(build.if, narrowCondition);
  assert.equal(guidance.run, "npm run verify:interface:guidance:ci");
  assert.equal(build.run, "npm run build");
  assert.equal(step(browserBuild, "Install pinned Chromium for wallet interaction tests").if,
    "needs.scope.outputs.interface_guidance_only != 'true' || needs.scope.outputs.custom_v2 == 'true'");
  assert.equal(scripts["verify:interface:guidance:ci"],
    "npm run test:ci-scope && eslint lib/custom-launch/v4-public-contract-discovery.ts tests/public-robinhood-v41-agent-docs.test.ts && npm run test:interface:guidance:ci");
  assert.equal(scripts["test:interface:guidance:ci"].split(" && vitest run ")[0],
    scripts["test:interface:ci"].split(" && vitest run ")[0]);
  assert.deepEqual(scripts["test:interface:guidance:ci"].split(" && vitest run ")[1].split(" "), [
    "tests/agent-readiness.test.ts",
    "tests/custom-launch-agent-intake.test.ts",
    "tests/custom-launch-agent-remediation-contract.test.ts",
    "tests/custom-launch-cli-public-surface.test.ts",
    "tests/custom-launch-docs.test.ts",
    "tests/custom-launch-robinhood-v4-discovery.test.ts",
    "tests/developer-api-keys-ui.test.ts",
    "tests/developer-docs-contract-parity.test.ts",
    "tests/developer-docs-experience.test.ts",
    "tests/docs-information-architecture.test.ts",
    "tests/launch-stamp-docs.test.ts",
    "tests/partner-discovery-contract.test.ts",
    "tests/public-robinhood-v41-agent-docs.test.ts",
    "tests/public-robinhood-v41-discovery.test.ts",
    "tests/public-robinhood-v41-well-known.test.ts",
  ]);
  assert.equal(aggregateResult({ GUIDANCE_ONLY: "true" }), 0);
  for (let index = 0; index < 6; index++) {
    const scopes = Array(6).fill("false");
    scopes[index] = "true";
    assert.notEqual(aggregateResult({ GUIDANCE_ONLY: "true", FUNCTIONAL_SCOPES: scopes.join(",") }), 0);
  }
  for (const value of [undefined, "", "true", "unknown"]) {
    assert.notEqual(aggregateResult({ GUIDANCE_ONLY: "true", FUNCTIONAL_SCOPES: value }), 0);
  }
  assert.notEqual(aggregateResult({ GUIDANCE_ONLY: "true", INTERFACE_REQUIRED: "false",
    QUALITY_RESULT: "skipped", BROWSER_BUILD_RESULT: "skipped" }), 0);
});
