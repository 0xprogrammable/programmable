import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const workflow = fs.readFileSync(
  path.resolve(".github/workflows/verify-hook-builder.yml"),
  "utf8"
);

test("default-branch public-intake remains an always-run trusted main PR context", () => {
  const trigger = section(workflow, "  pull_request_target:", "permissions:");
  assert.match(trigger, /branches:\n\s+- main/u);
  for (const eventType of ["opened", "reopened", "synchronize", "edited"]) {
    assert.match(trigger, new RegExp(`- ${eventType}\\b`, "u"), eventType);
  }
  assert.doesNotMatch(trigger, /paths:/u);
  assert.match(workflow, /jobs:\n\s+public-intake:/u);
});

test("CI control guard executes only exact default-branch code over inert candidate Git data", () => {
  const publicIntake = section(workflow, "  public-intake:");
  assert.match(publicIntake, /ref: \$\{\{ github\.workflow_sha \}\}/u);
  assert.match(publicIntake, /ref: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
  assert.match(publicIntake, /persist-credentials: false/u);
  assert.match(publicIntake, /Fetch exact candidate merge as blobless data/u);
  assert.match(publicIntake, /trusted\/scripts\/verify-main-ci-control-change\.mjs/u);
  assert.match(publicIntake, /--candidate-root "\$GITHUB_WORKSPACE\/candidate\.git"/u);
  assert.match(publicIntake, /EXPECTED_BASE_COMMIT: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
  assert.match(publicIntake, /EXPECTED_CANDIDATE_COMMIT: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
  assert.doesNotMatch(publicIntake, /checkout[^\n]*head/iu);

  const guardIndex = publicIntake.indexOf("Enforce trusted main CI control-plane guard");
  const classifyIndex = publicIntake.indexOf("Classify candidate data with trusted default-branch code");
  const credentialRemovalIndex = publicIntake.indexOf("Remove candidate fetch credential");
  assert.ok(guardIndex > 0 && guardIndex < classifyIndex);
  assert.ok(credentialRemovalIndex > guardIndex);
  assert.match(publicIntake.slice(credentialRemovalIndex), /if: always\(\)/u);
});

test("trusted guard is bound to the exact audited main candidate commit and tree", () => {
  assert.match(workflow, /APPROVED_MAIN_CI_CONTROL_COMMIT: e15bb397604a19d6622af5a5ee9622a8edac9d18/u);
  assert.match(workflow, /APPROVED_MAIN_CI_CONTROL_TREE: 92eecc16da2c59b87295fcb4012e57fe4f1feae7/u);
  assert.match(workflow, /--approved-commit "\$APPROVED_MAIN_CI_CONTROL_COMMIT"/u);
  assert.match(workflow, /--approved-tree "\$APPROVED_MAIN_CI_CONTROL_TREE"/u);
});

test("only the exact approved control-plane candidate bypasses the generic changed-file classifier", () => {
  const publicIntake = section(workflow, "  public-intake:");
  assert.match(publicIntake, /id: ci_control/u);
  assert.match(publicIntake, /guard_report="\$\(timeout --signal=KILL 30s node "\$guard"/u);
  assert.match(
    publicIntake,
    /report\.result === "approved-exact-main-ci-control-change" \? "true" : "false"/u
  );
  assert.match(
    publicIntake,
    /if \[\[ "\$\{\{ steps\.ci_control\.outputs\.approved_exact_candidate \}\}" == "true" \]\]; then\s+# [^\n]+\n(?:\s+# [^\n]+\n){3}\s+mode="builder-maintenance"\s+else\s+mode="\$\(timeout --signal=KILL 30s node "\$validator" --classify/u
  );
  assert.doesNotMatch(publicIntake, /maximum-changed-files|maximumChangedFiles/u);
});

test("trusted production intake uses the exact current Node 24 LTS runtime", () => {
  const publicIntake = section(workflow, "  public-intake:");
  assert.match(
    publicIntake,
    /actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7\.0\.0/u
  );
  assert.match(publicIntake, /node-version: 24\.19\.0/u);
  assert.doesNotMatch(publicIntake, /node-version: (?:20|22)(?:\D|$)/u);
});

function section(source, start, end = null) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section ${start}`);
  if (end === null) return source.slice(startIndex);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section ${end}`);
  return source.slice(startIndex, endIndex);
}
