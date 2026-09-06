import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { MAINTENANCE_POLICY as policy, REQUIRED_LEGACY_CHECKS, assertLivePullRequest,
  assertMergeProtection, canonical, digest, executionBinding, snapshotJson, validateSubject,
} from "../ci/platform-maintenance-policy.mjs";
import { WORKER_SCHEMA, createEvidence, createPostMergeEvidence, evaluateSlither, slitherAnalysisHash,
  validateLegacyChecks, verifyEvidence } from "../ci/platform-maintenance-evidence.mjs";
import { consumeAuthenticatedEvidence as consumeWithReader, createGitHubClient, createPolicyReadAuthority,
  dispatchPostMergeVerification, policyReadConfiguration,
  revalidateMergedSubject, resolveProducer, selectSubject } from "../ci/platform-maintenance-github.mjs";
import { assertWorkerEnvironment, attestationArguments, summarizeFoundryReport } from "../ci/platform-maintenance-runner.mjs";

const sha = (character) => character.repeat(40);
const ROOT = `/repos/${policy.repository}`;
const NOW = 1788650000000;
const MERGED = sha("8");
const READER_CONFIGURATION = { appId: 41, installationId: 42, repository: policy.repository,
  repositoryId: policy.repositoryId, baseRef: policy.baseRef };
const READER_CREDENTIAL = { appId: 41, installationId: 42, token: "synthetic-policy-reader-token" };
const READER_SUBJECT = { repository: policy.repository, repositoryId: policy.repositoryId, baseRef: policy.baseRef };
function consumeAuthenticatedEvidence(client, proof, producer, now) {
  return consumeWithReader(client, proof, producer, now, policy, client.policyReader ?? null);
}
function checkTransitions(client, name) {
  return client.seen.filter((call) => call.method === "POST" && call.body.name === name)
    .map((call) => call.body.status === "in_progress" ? "in_progress" : call.body.conclusion);
}
function assertWithdrawn(client) {
  assert.equal(checkTransitions(client, policy.checkName).at(-1), "failure");
  assert.deepEqual(checkTransitions(client, policy.evidenceCheckName), ["success", "failure"]);
}
const clone = (value) => JSON.parse(JSON.stringify(value));
const blob = (text) => {
  const bytes = Buffer.from(text);
  return { sha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex"),
    size: bytes.length, encoding: "base64", content: bytes.toString("base64") };
};
const BASE_BLOB = blob("pragma solidity ^0.8.26; contract Example {}\n");
const HEAD_BLOB = blob("pragma solidity ^0.8.26; contract Example { uint256 public n; }\n");
function subject(customPolicy = policy) {
  return { schema: "programmable.platform-maintenance-subject.v1", repository: policy.repository,
    repositoryId: policy.repositoryId, pullRequest: 702, authorId: 7, baseSha: sha("1"), baseTree: sha("2"),
    headSha: sha("3"), headTree: sha("4"), mergeSha: sha("5"), mergeTree: sha("4"), controllerSha: sha("6"),
    policyHash: digest(customPolicy), files: [{ path: "src/Example.sol", status: "modified",
      baseBlob: BASE_BLOB.sha, headBlob: HEAD_BLOB.sha, baseMode: "100644", headMode: "100644" }] };
}
function pr(s = subject()) {
  const repo = { id: policy.repositoryId, full_name: policy.repository };
  return { number: s.pullRequest, state: "open", merged: false, draft: false, mergeable: true,
    mergeable_state: "clean", merge_commit_sha: s.mergeSha, changed_files: s.files.length,
    head: { sha: s.headSha, repo }, base: { sha: s.baseSha, ref: "main", repo }, user: { id: s.authorId, login: "maintainer" } };
}
const permission = { permission: "write", user: { id: 7 } };
function protection() {
  return { url: `https://api.github.com${ROOT}/branches/main/protection`,
    enforce_admins: { enabled: true }, required_linear_history: { enabled: true },
    allow_force_pushes: { enabled: false }, allow_deletions: { enabled: false },
    required_pull_request_reviews: { required_approving_review_count: 0, require_code_owner_reviews: false,
      require_last_push_approval: false },
    required_status_checks: { strict: true, checks: [...REQUIRED_LEGACY_CHECKS.map((check) => check.name), policy.checkName]
      .map((context) => ({ context, app_id: policy.githubActionsAppId })) } };
}
function observation(s = subject()) {
  const result = { checks: [], runs: [], jobs: [] };
  for (const [index, required] of REQUIRED_LEGACY_CHECKS.entries()) {
    const id = 100 + index, runId = 200 + index, jobId = 300 + index, suiteId = 400 + index;
    const details = `https://github.com/${policy.repository}/actions/runs/${runId}/job/${jobId}`;
    result.checks.push({ id, name: required.name, status: "completed", conclusion: "success", head_sha: s.headSha,
      app: { id: policy.githubActionsAppId, slug: "github-actions", owner: { login: "github" } },
      check_suite: { id: suiteId }, details_url: details });
    result.runs.push({ id: runId, path: required.path, repository: { id: policy.repositoryId },
      head_repository: { id: policy.repositoryId }, head_sha: s.headSha, status: "completed", conclusion: "success",
      event: required.name === "public-intake" ? "pull_request_target" : "pull_request", run_attempt: 1,
      check_suite_id: suiteId,
      pull_requests: [{ number: s.pullRequest, base: { sha: s.baseSha, repo: { id: policy.repositoryId } },
        head: { sha: s.headSha, repo: { id: policy.repositoryId } } }] });
    result.jobs.push({ id: jobId, run_id: runId, run_attempt: 1, head_sha: s.headSha,
      check_run_url: `https://api.github.com/repos/${policy.repository}/check-runs/${id}`, html_url: details,
      name: required.name, status: "completed", conclusion: "success" });
  }
  return result;
}
function workers(input = subject()) {
  const binding = executionBinding(input);
  const common = { schema: WORKER_SCHEMA, subjectHash: digest(binding.subject), sourceCommit: binding.sourceCommit,
    sourceTree: binding.sourceTree, foundryVersion: policy.foundryVersion, solcVersion: policy.solcVersion };
  return { foundry: { ...common, lane: "foundry", slitherVersion: null, testCount: 41,
    testReportHash: `sha256:${"a".repeat(64)}`, slitherReport: null },
  slither: { ...common, lane: "slither", slitherVersion: policy.slitherVersion, testCount: null,
    testReportHash: null, slitherReport: { success: true, error: null, results: { detectors: [] } } } };
}
function evidence(s = subject()) {
  return createEvidence({ subject: s, ...workers(s), legacyObservation: observation(s), runId: 901, runAttempt: 1, issuedAt: NOW });
}
function expected(s = subject()) {
  return { subject: s, runId: 901, runAttempt: 1, legacyObservation: observation(s), now: NOW + 1 };
}
function postSubject(s = subject()) {
  return { schema: "programmable.platform-maintenance-post-merge-subject.v1", original: s,
    originalEvidenceHash: digest(evidence(s)), mergeCommit: MERGED, mergeTree: s.mergeTree, parentCommit: s.baseSha };
}
function fixtureClient(s = subject(), alter = () => {}) {
  const seen = []; let merged = false;
  const observed = observation(s);
  const client = { seen, setMerged: () => { merged = true; },
    async get(route) {
      seen.push({ method: "GET", route });
      let value;
      if (route === `${ROOT}/pulls/${s.pullRequest}`) {
        value = pr(s);
        if (merged) Object.assign(value, { state: "closed", merged: true, merge_commit_sha: MERGED });
      } else if (route === `${ROOT}/git/ref/heads/main`) value = { object: { sha: merged ? MERGED : s.baseSha } };
      else if (route === `${ROOT}/git/ref/heads/production`) value = { object: { sha: s.controllerSha } };
      else if (route === `${ROOT}/git/commits/${s.baseSha}`) value = { sha: s.baseSha, tree: { sha: s.baseTree } };
      else if (route === `${ROOT}/git/commits/${s.headSha}`) value = { sha: s.headSha, tree: { sha: s.headTree } };
      else if (route === `${ROOT}/git/commits/${s.mergeSha}`) value = { sha: s.mergeSha, tree: { sha: s.mergeTree },
        parents: [{ sha: s.baseSha }, { sha: s.headSha }] };
      else if (route === `${ROOT}/git/commits/${MERGED}`) value = { sha: MERGED, tree: { sha: s.mergeTree }, parents: [{ sha: s.baseSha }] };
      else if (route.includes("/git/trees/")) {
        const base = route.includes(s.baseTree);
        value = { sha: base ? s.baseTree : s.headTree, truncated: false,
          tree: [{ path: "src/Example.sol", sha: base ? BASE_BLOB.sha : HEAD_BLOB.sha, mode: "100644", type: "blob" }] };
      } else if (route === `${ROOT}/git/blobs/${BASE_BLOB.sha}`) value = BASE_BLOB;
      else if (route === `${ROOT}/git/blobs/${HEAD_BLOB.sha}`) value = HEAD_BLOB;
      else if (route.endsWith("/collaborators/maintainer/permission")) value = permission;
      else if (route.includes(`/pulls/${s.pullRequest}/files?`)) value = [{ filename: "src/Example.sol", status: "modified" }];
      else if (route.includes("/check-runs?")) value = { check_runs: observed.checks };
      else if (route.includes("/actions/runs/")) value = observed.runs.find((run) => route.endsWith(`/${run.id}`));
      else if (route.includes("/actions/jobs/")) value = observed.jobs.find((job) => route.endsWith(`/${job.id}`));
      assert.notEqual(value, undefined, `Unexpected GET ${route}`);
      value = clone(value); await alter(route, value, seen); return value;
    },
    async post(route, body) {
      seen.push({ method: "POST", route, body: clone(body) });
      if (route.endsWith("/dispatches")) return null;
      assert.equal(route, `${ROOT}/check-runs`);
      return { ...clone(body), app: { id: policy.githubActionsAppId } };
    },
    async put(route, body) {
      seen.push({ method: "PUT", route, body: clone(body) });
      assert.equal(route, `${ROOT}/pulls/${s.pullRequest}/merge`);
      assert.deepEqual(body, { sha: s.headSha, merge_method: "squash" });
      merged = true; return { merged: true, sha: MERGED };
    } };
  client.policyReader = createPolicyReadAuthority(READER_CONFIGURATION, READER_CREDENTIAL, async (url, init) => {
    assert.equal(init.method, "GET");
    assert.equal(init.headers.authorization, `Bearer ${READER_CREDENTIAL.token}`);
    const route = url.replace("https://api.github.com", "");
    seen.push({ method: "GET", route, authority: "policy-reader" });
    if (route === "/installation/repositories?per_page=100&page=1") return Response.json({ total_count: 1,
      repositories: [{ id: policy.repositoryId, full_name: policy.repository }] });
    assert.equal(route, `${ROOT}/branches/main/protection`);
    const value = protection(); await alter(route, value, seen); return Response.json(value);
  });
  return client;
}

test("inert policy snapshots reject getters, cycles, sparse arrays and shared memory without invoking getters", () => {
  let calls = 0;
  const getter = { get headSha() { calls++; return sha("1"); } };
  const cycle = {}; cycle.self = cycle;
  for (const value of [getter, cycle, new Array(1), new SharedArrayBuffer(8), new Uint8Array(8)]) {
    assert.throws(() => snapshotJson(value));
  }
  assert.equal(calls, 0);
  const s = subject(); const frozen = validateSubject(s); s.files[0].path = "submissions/a/application.json";
  assert.equal(frozen.files[0].path, "src/Example.sol"); assert.ok(Object.isFrozen(frozen.files[0]));
});

test("ordinary source maintenance and the existing exact 702 CI pin are separate closed cases", () => {
  assert.equal(validateSubject(subject()).headSha, sha("3"));
  const pinned = subject(); pinned.headSha = policy.controlAuthorization.commit;
  pinned.headTree = policy.controlAuthorization.tree; pinned.files[0].path = ".github/workflows/verify.yml";
  assert.doesNotThrow(() => validateSubject(pinned));
  pinned.headTree = sha("7"); assert.throws(() => validateSubject(pinned), /CONTROL_AUTHORIZATION_REQUIRED/);
});

for (const [name, change] of [
  ["application", (s) => { s.files[0].path = "submissions/a/application.json"; }],
  ["self-changing policy", (s) => { s.files[0].path = "scripts/ci/platform-maintenance-policy.mjs"; }],
  ["symlink", (s) => { s.files[0].headMode = "120000"; }],
  ["renamed file", (s) => { s.files[0].status = "renamed"; }],
  ["deleted file", (s) => { s.files[0].status = "removed"; }],
  ["path traversal", (s) => { s.files[0].path = "src/../Example.sol"; }],
  ["policy substitution", (s) => { s.policyHash = `sha256:${"f".repeat(64)}`; }],
]) test(`policy rejects ${name}`, () => { const s = subject(); change(s); assert.throws(() => validateSubject(s)); });

for (const [name, change] of [
  ["fork", (p) => { p.head.repo = { id: 999, full_name: "attacker/repo" }; }],
  ["different head", (p) => { p.head.sha = sha("9"); }],
  ["different base", (p) => { p.base.sha = sha("9"); }],
  ["production target", (p) => { p.base.ref = "production"; }],
  ["draft", (p) => { p.draft = true; }],
  ["closed", (p) => { p.state = "closed"; }],
  ["incomplete file pagination", (p) => { p.changed_files = 2; }],
]) test(`live binding rejects ${name}`, () => {
  const p = pr(); change(p); assert.throws(() => assertLivePullRequest(p, subject(), permission));
});

const finding = { id: "d".repeat(64), check: "reentrancy-eth", impact: "High", confidence: "Medium",
  description: "Synthetic fixture finding, not a production disposition.", elements: [{
    source_mapping: { filename_relative: "src/Example.sol", start: 10, length: 20, lines: [2, 3] } }] };
const scan = (findings = []) => ({ success: true, error: null, results: { detectors: findings } });
test("Slither command success is insufficient: every undispositioned impact fails closed", () => {
  assert.equal(evaluateSlither(scan(), subject()).findingHashes.length, 0);
  for (const impact of ["High", "Medium", "Low", "Informational", "Optimization"]) {
    assert.throws(() => evaluateSlither(scan([{ ...finding, impact }]), subject()), /UNRESOLVED_FINDING/);
  }
  for (const report of [{ success: true, results: {} }, { success: false, error: "compile error", results: { detectors: [] } },
    { success: true, error: "partial analysis", results: { detectors: [] } }]) {
    assert.throws(() => evaluateSlither(report, subject()), /SLITHER_INCOMPLETE/);
  }
});

test("explicit synthetic disposition binds the complete finding, tool/source closure and review evidence", () => {
  const normalized = { id: finding.id, check: finding.check, impact: finding.impact, confidence: finding.confidence,
    description: finding.description, locations: [{ path: "src/Example.sol", start: 10, length: 20, lines: [2, 3] }] };
  const customPolicy = { ...policy, slitherDispositions: [{
    findingHash: digest({ domain: "programmable.platform-maintenance-slither-finding.v1", finding: normalized }),
    analysisHash: slitherAnalysisHash(subject()), disposition: "false-positive",
    rationale: "Synthetic test authority explicitly reviews this exact fixture only.",
    reviewedSourceCommit: sha("3"), evidencePath: "security/fixture-review.json", evidenceBlob: sha("b"),
  }] };
  assert.equal(evaluateSlither(scan([finding]), subject(customPolicy), customPolicy).findingHashes.length, 1);
  const changed = subject(customPolicy); changed.headTree = sha("f");
  assert.throws(() => evaluateSlither(scan([finding]), changed, customPolicy), /UNRESOLVED_FINDING/);
  assert.throws(() => evaluateSlither(scan([{ ...finding, description: "Substituted finding" }]), subject(customPolicy), customPolicy), /UNRESOLVED_FINDING/);
  assert.throws(() => evaluateSlither(scan(), subject(customPolicy), customPolicy), /STALE_DISPOSITION/);
  assert.throws(() => evaluateSlither(scan([finding, finding]), subject(customPolicy), customPolicy), /DUPLICATE_FINDING/);
  assert.deepEqual(policy.slitherDispositions, []);
});

test("complete exact-head evidence round-trips under its separate schema", () => {
  const proof = evidence(); assert.equal(verifyEvidence(proof, expected()).evidenceHash, digest(proof));
  for (const schema of ["programmable.autonomous-admission-decision.v1", "programmable.production-verify-proof.v1"]) {
    assert.throws(() => verifyEvidence({ ...proof, schema }, expected()), /SCHEMA_INVALID/);
  }
  assert.throws(() => verifyEvidence(proof, { ...expected(), now: NOW + policy.maxAgeMs }), /EXPIRED/);
  assert.throws(() => verifyEvidence(proof, { ...expected(), now: NOW - 1 }), /EXPIRED/);
  assert.throws(() => verifyEvidence(proof, { ...expected(), runAttempt: 2 }), /SUBJECT_DRIFT/);
});

for (const [name, change] of [
  ["spoofed app", (o) => { o.checks[0].app.id = 9; }],
  ["unrelated workflow", (o) => { o.runs[0].path = ".github/workflows/spoof.yml"; }],
  ["another head", (o) => { o.runs[0].head_sha = sha("7"); }],
  ["fork run", (o) => { o.runs[0].head_repository.id = 9; }],
  ["stale base", (o) => { o.runs[0].pull_requests[0].base.sha = sha("7"); }],
  ["stale attempt", (o) => { o.runs[0].run_attempt = 2; }],
  ["another check suite", (o) => { o.runs[0].check_suite_id = 999; }],
  ["job linked to another check", (o) => { o.jobs[0].check_run_url = `https://api.github.com/repos/${policy.repository}/check-runs/999`; }],
  ["job linked to another run URL", (o) => { o.jobs[0].html_url = `https://github.com/${policy.repository}/actions/runs/999/job/300`; }],
  ["skipped gate", (o) => { o.checks[0].conclusion = "skipped"; }],
  ["newer failure", (o) => { o.checks.push({ ...o.checks[0], id: 999, conclusion: "failure" }); }],
  ["missing gate", (o) => { o.checks.pop(); }],
]) test(`check authentication rejects ${name}`, () => {
  const observed = observation(); change(observed); assert.throws(() => validateLegacyChecks(observed, subject()));
});

test("subject selection binds full GitHub identity, paginated files, canonical merge parents and inert blobs", async () => {
  const client = fixtureClient(); assert.equal(canonical(await selectSubject(client, 702, sha("6"))), canonical(subject()));
  assert.equal(client.seen.filter((call) => call.method !== "GET").length, 0);
  for (const change of [
    (route, value) => { if (route.includes("/git/trees/")) value.truncated = true; },
    (route, value) => { if (route.endsWith(`/git/commits/${sha("5")}`)) value.parents.reverse(); },
    (route, value) => { if (route.endsWith("/permission")) value.permission = "read"; },
  ]) await assert.rejects(selectSubject(fixtureClient(subject(), change), 702, sha("6")));
});

test("consumer uses standard head-conditioned merge and verifies actual protected squash parent/tree", async () => {
  const client = fixtureClient(); const proof = evidence();
  const result = await consumeAuthenticatedEvidence(client, proof, { run: { id: 901, run_attempt: 1 } }, () => NOW + 1);
  assert.equal(result.mergeCommit, MERGED); assert.equal(result.websiteDeployment, false);
  assert.equal(client.seen.filter((call) => call.method === "PUT").length, 1);
  assert.deepEqual(checkTransitions(client, policy.checkName), ["in_progress", "success"]);
  assert.deepEqual(checkTransitions(client, policy.evidenceCheckName), ["success"]);
  assert.ok(client.seen.findIndex((call) => call.route.endsWith("/protection"))
    < client.seen.findIndex((call) => call.method === "POST" && call.body.name === policy.checkName
      && call.body.conclusion === "success"));
  assert.ok(client.seen.some((call) => call.route.endsWith(`/git/commits/${MERGED}`)));
  assert.equal(client.seen.filter((call) => call.route.endsWith("/branches/main/protection")
    && call.authority === "policy-reader").length, 2);
});

test("bootstrap protection holds preserve genuine technical evidence but never request merge", async () => {
  for (const change of [
    (p) => { p.required_pull_request_reviews.required_approving_review_count = 1; },
    (p) => { p.required_pull_request_reviews.require_code_owner_reviews = true; },
    (p) => { p.required_status_checks.checks.pop(); },
    (p) => { p.required_status_checks.checks[0].app_id = null; },
    (p) => { p.required_status_checks.strict = false; },
    (p) => { p.enforce_admins.enabled = false; },
  ]) {
    const p = protection(); change(p); assert.throws(() => assertMergeProtection(p));
    const client = fixtureClient(subject(), (route, value) => { if (route.endsWith("/protection")) change(value); });
    await assert.rejects(consumeAuthenticatedEvidence(client, evidence(), { run: { id: 901, run_attempt: 1 } }, () => NOW + 1));
    const writes = client.seen.filter((call) => call.method !== "GET");
    assert.equal(writes.length, 3); assert.equal(writes.every((call) => call.route === `${ROOT}/check-runs`), true);
    assert.deepEqual(checkTransitions(client, policy.checkName), ["in_progress", "failure"]);
    assert.deepEqual(checkTransitions(client, policy.evidenceCheckName), ["success"]);
  }
});

test("bootstrap can publish genuine authenticated technical evidence without invoking merge or changing protection", async () => {
  const client = fixtureClient(subject(), (route, value) => {
    if (route.endsWith("/protection")) value.required_pull_request_reviews.required_approving_review_count = 1;
  });
  await assert.rejects(consumeAuthenticatedEvidence(client, evidence(), { run: { id: 901, run_attempt: 1 } },
    () => NOW + 1), /HUMAN_RULE_STILL_ACTIVE/);
  const writes = client.seen.filter((call) => call.method !== "GET");
  assert.equal(writes.length, 3); assert.equal(writes.every((call) => call.route === `${ROOT}/check-runs`), true);
  assert.deepEqual(checkTransitions(client, policy.evidenceCheckName), ["success"]);
  assert.deepEqual(checkTransitions(client, policy.checkName), ["in_progress", "failure"]);
  const invalid = clone(evidence()); invalid.slither.sourceCommit = sha("9");
  const untouched = fixtureClient();
  await assert.rejects(consumeAuthenticatedEvidence(untouched, invalid, { run: { id: 901, run_attempt: 1 } }, () => NOW + 1));
  assert.equal(untouched.seen.some((call) => call.method !== "GET"), false);
});

test("head change after check publication is revalidated before the merge endpoint", async () => {
  const client = fixtureClient(subject(), (route, value, seen) => {
    if (route.endsWith("/pulls/702") && seen.some((call) => call.method === "POST")) value.head.sha = sha("9");
  });
  await assert.rejects(consumeAuthenticatedEvidence(client, evidence(), { run: { id: 901, run_attempt: 1 } }, () => NOW + 1), /BINDING_DRIFT/);
  assert.equal(client.seen.some((call) => call.method === "PUT"), false);
  assert.equal(client.seen.filter((call) => call.method === "POST").at(-1).body.conclusion, "failure");
});

test("the CLI consumer entry withdraws early base and technical drifts after bootstrap publication", async () => {
  for (const change of [
    (route, value) => { if (route.endsWith("/heads/main")) value.object.sha = sha("9"); },
    (route, value) => { if (route.endsWith("/heads/production")) value.object.sha = sha("9"); },
    (route, value) => { if (route.includes("/check-runs?")) value.check_runs[0].conclusion = "failure"; },
  ]) {
    const client = fixtureClient(subject(), (route, value, seen) => {
      if (seen.some((call) => call.method === "POST")) change(route, value);
    });
    await assert.rejects(consumeAuthenticatedEvidence(client, evidence(), { run: { id: 901, run_attempt: 1 } }, () => NOW + 1));
    const writes = client.seen.filter((call) => call.method !== "GET");
    assertWithdrawn(client);
    assert.deepEqual(checkTransitions(client, policy.checkName), ["in_progress", "failure"]);
    assert.equal(writes.every((call) => call.route === `${ROOT}/check-runs`), true);
    assert.equal(client.seen.some((call) => call.route.endsWith("/protection")), false);
  }
});

test("evidence expiring immediately after publication is withdrawn before protection inspection", async () => {
  let reads = 0; const client = fixtureClient();
  await assert.rejects(consumeAuthenticatedEvidence(client, evidence(), { run: { id: 901, run_attempt: 1 } },
    () => ++reads === 1 ? NOW + 1 : NOW + policy.maxAgeMs), /EVIDENCE_EXPIRED/);
  assertWithdrawn(client);
  assert.equal(client.seen.some((call) => call.method === "PUT" || call.route.endsWith("/protection")), false);
});

test("a bootstrap hold cannot preserve success when the subject drifts during protection inspection", async () => {
  const client = fixtureClient(subject(), (route, value, seen) => {
    if (route.endsWith("/protection")) value.required_pull_request_reviews.required_approving_review_count = 1;
    if (route.endsWith("/pulls/702") && seen.some((call) => call.route.endsWith("/protection"))) value.head.sha = sha("9");
  });
  await assert.rejects(consumeAuthenticatedEvidence(client, evidence(), { run: { id: 901, run_attempt: 1 } },
    () => NOW + 1), /BINDING_DRIFT/);
  assertWithdrawn(client);
  assert.equal(client.seen.some((call) => call.method === "PUT"), false);
});

test("missing policy-read authority preserves only refreshed technical evidence and keeps merging closed", async () => {
  const client = fixtureClient(); client.policyReader = null;
  await assert.rejects(consumeAuthenticatedEvidence(client, evidence(), { run: { id: 901, run_attempt: 1 } },
    () => NOW + 1), /POLICY_READ_AUTHORITY_UNCONFIGURED/);
  const writes = client.seen.filter((call) => call.method !== "GET");
  assert.equal(writes.length, 3);
  assert.deepEqual(checkTransitions(client, policy.checkName), ["in_progress", "failure"]);
  assert.deepEqual(checkTransitions(client, policy.evidenceCheckName), ["success"]);
});

test("an old release success is replaced before a new bootstrap-only attempt can return", async () => {
  const client = fixtureClient(subject(), (route, value) => {
    if (route.includes("/check-runs?")) value.check_runs.push({ name: policy.checkName,
      id: 9999, head_sha: subject().headSha, status: "completed", conclusion: "success" });
  });
  client.policyReader = null;
  await assert.rejects(consumeAuthenticatedEvidence(client, evidence(), { run: { id: 901, run_attempt: 1 } },
    () => NOW + 1), /AUTHORITY_UNCONFIGURED/);
  const writes = client.seen.filter((call) => call.method === "POST");
  assert.equal(writes[0].body.name, policy.checkName); assert.equal(writes[0].body.status, "in_progress");
  assert.deepEqual(checkTransitions(client, policy.checkName), ["in_progress", "failure"]);
  assert.deepEqual(checkTransitions(client, policy.evidenceCheckName), ["success"]);
});

test("protection drift after release success is withdrawn before the merge endpoint", async () => {
  const client = fixtureClient(subject(), (route, value, seen) => {
    if (route.endsWith("/protection") && seen.some((call) => call.method === "POST"
      && call.body.name === policy.checkName && call.body.conclusion === "success")) {
      value.required_pull_request_reviews.require_last_push_approval = true;
    }
  });
  await assert.rejects(consumeAuthenticatedEvidence(client, evidence(), { run: { id: 901, run_attempt: 1 } },
    () => NOW + 1), /HUMAN_RULE_STILL_ACTIVE/);
  assertWithdrawn(client);
  assert.deepEqual(checkTransitions(client, policy.checkName), ["in_progress", "success", "failure"]);
  assert.equal(client.seen.some((call) => call.method === "PUT"), false);
});

test("post-merge tree mismatch withdraws success and emits no merged-state receipt", async () => {
  const client = fixtureClient(subject(), (route, value) => {
    if (route.endsWith(`/git/commits/${MERGED}`)) value.tree.sha = sha("9");
  });
  await assert.rejects(consumeAuthenticatedEvidence(client, evidence(), { run: { id: 901, run_attempt: 1 } },
    () => NOW + 1), /POST_MERGE_REF_DRIFT/);
  assert.equal(client.seen.filter((call) => call.method === "PUT").length, 1);
  assertWithdrawn(client);
  assert.deepEqual(checkTransitions(client, policy.checkName), ["in_progress", "success", "failure"]);
});

test("an unsuccessful withdrawal reports uncertain merge state without exposing transport details", async () => {
  const client = fixtureClient(subject(), (route, value, seen) => {
    if (route.endsWith("/pulls/702") && seen.some((call) => call.method === "POST")) value.head.sha = sha("9");
  });
  const post = client.post;
  client.post = async (route, body) => {
    if (body.conclusion === "failure") throw new Error("synthetic transport detail");
    return post(route, body);
  };
  await assert.rejects(consumeAuthenticatedEvidence(client, evidence(), { run: { id: 901, run_attempt: 1 } },
    () => NOW + 1), /^Error: MAINTENANCE_MERGE_STATE_UNCERTAIN$/);
});

test("caller mutation after await cannot substitute nested merge subject or evidence", async () => {
  const mutable = clone(evidence()); const producer = { run: { id: 901, run_attempt: 1 } };
  const client = fixtureClient();
  const promise = consumeAuthenticatedEvidence(client, mutable, producer, () => NOW + 1);
  mutable.subject.headSha = sha("9"); mutable.checks[0].workflow = ".github/workflows/spoof.yml";
  producer.run.id = 999;
  const result = await promise; assert.equal(result.evidenceHash, digest(evidence()));
  assert.equal(client.seen.find((call) => call.method === "PUT").body.sha, subject().headSha);
});

test("post-merge dispatch is independently bound and remains distinct from completion evidence", async () => {
  const client = fixtureClient(); client.setMerged(); const post = postSubject();
  const receipt = await dispatchPostMergeVerification(client, post, 901);
  assert.equal(receipt.dispatchAccepted, true); assert.equal(receipt.verificationCompleted, false);
  const dispatched = client.seen.find((call) => call.method === "POST");
  assert.equal(dispatched.route, `${ROOT}/actions/workflows/platform-maintenance-post-merge.yml/dispatches`);
  assert.deepEqual(dispatched.body, { ref: "production", inputs: { pull_request: "702", merge_sha: MERGED,
    producer_run: "901", controller_sha: subject().controllerSha } });
  const proof = createPostMergeEvidence({ subject: post, ...workers(post), runId: 902, runAttempt: 1, issuedAt: NOW });
  assert.equal(proof.schema, "programmable.platform-maintenance-post-merge-evidence.v1");
  assert.throws(() => verifyEvidence(proof, expected()));
  assert.throws(() => createPostMergeEvidence({ subject: post, ...workers(), runId: 902, runAttempt: 1, issuedAt: NOW }), /WORKER_BINDING_INVALID/);
});

test("post-merge base, tree, controller and current main drift cannot dispatch", async () => {
  for (const change of [
    (route, value) => { if (route.endsWith("/heads/main")) value.object.sha = sha("a"); },
    (route, value) => { if (route.endsWith("/heads/production")) value.object.sha = sha("a"); },
    (route, value) => { if (route.endsWith(`/git/commits/${MERGED}`)) value.tree.sha = sha("a"); },
    (route, value) => { if (route.endsWith(`/git/commits/${MERGED}`)) value.parents[0].sha = sha("a"); },
  ]) {
    const client = fixtureClient(subject(), change); client.setMerged();
    await assert.rejects(dispatchPostMergeVerification(client, postSubject(), 901), /POST_MERGE_REF_DRIFT/);
    assert.equal(client.seen.some((call) => call.method !== "GET"), false);
  }
});

test("worker guards require zero privileged credential exposure and actual successful tests", () => {
  assert.doesNotThrow(() => assertWorkerEnvironment({}));
  for (const key of ["GH_TOKEN", "GITHUB_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "MAINTENANCE_POLICY_READ_TOKEN"]) {
    assert.throws(() => assertWorkerEnvironment({ [key]: "fixture-only" }), /CREDENTIAL_PRESENT/);
  }
  assert.equal(summarizeFoundryReport({ Example: { test_results: { example: { status: "Success" } } } }).testCount, 1);
  for (const report of [{}, { Example: { test_results: {} } }, { Example: { test_results: { example: { status: "Skipped" } } } }]) {
    assert.throws(() => summarizeFoundryReport(report));
  }
  const args = attestationArguments("/tmp/evidence.json", sha("6"));
  assert.ok(args.includes("--deny-self-hosted-runners"));
  assert.equal(args[args.indexOf("--source-digest") + 1], sha("6"));
  assert.equal(args[args.indexOf("--signer-digest") + 1], sha("6"));
});

test("bounded GitHub transport stays on the fixed repository and does not expose server error text", async () => {
  const seen = [];
  const client = createGitHubClient("synthetic-unit-token", async (url, init) => {
    seen.push({ url, init }); return new Response(JSON.stringify({ answer: 1 }));
  });
  assert.equal((await client.get(`${ROOT}/pulls/702`)).answer, 1);
  assert.equal(seen[0].init.redirect, "error");
  await assert.rejects(client.get("/repos/attacker/other/pulls/702"), /ROUTE_INVALID/);
  assert.equal(seen.length, 1);
  const failing = createGitHubClient("synthetic-unit-token", async () => new Response("secret-like-fixture", { status: 403 }));
  await assert.rejects(failing.get(`${ROOT}/pulls/702`), /^Error: MAINTENANCE_GITHUB_REQUEST_FAILED$/);
  await assert.rejects(failing.get(`${ROOT}/branches/main/protection`), /^Error: MAINTENANCE_SEPARATE_POLICY_READER_REQUIRED$/);
  const dispatch = createGitHubClient("synthetic-unit-token", async () => new Response(null, { status: 204 }));
  assert.equal(await dispatch.post(`${ROOT}/actions/workflows/platform-maintenance-post-merge.yml/dispatches`, {}), null);
});

test("policy-reader installation pins require a separate reviewed configuration", () => {
  assert.equal(policyReadConfiguration({ ...policy, policyReadAuthority: null }), null);
  assert.throws(() => createPolicyReadAuthority(null, READER_CREDENTIAL), /AUTHORITY_UNCONFIGURED/);
  for (const pins of [{ appId: 41 }, { appId: 0, installationId: 42 },
    { appId: 41, installationId: 42, repository: "attacker/other" }]) {
    assert.throws(() => policyReadConfiguration({ ...policy, policyReadAuthority: pins }));
  }
  assert.equal(canonical(policyReadConfiguration({ ...policy, policyReadAuthority: { appId: 41, installationId: 42 } })),
    canonical(READER_CONFIGURATION));
});

test("policy reader binds App installation and immutable subject before the first request", async () => {
  let calls = 0;
  const transport = async () => { calls++; return Response.json({}); };
  for (const credential of [{ ...READER_CREDENTIAL, appId: 99 }, { ...READER_CREDENTIAL, installationId: 99 },
    { ...READER_CREDENTIAL, token: "" }]) {
    assert.throws(() => createPolicyReadAuthority(READER_CONFIGURATION, credential, transport), /CREDENTIAL_BINDING_INVALID/);
  }
  for (const configuration of [{ ...READER_CONFIGURATION, repositoryId: 99 },
    { ...READER_CONFIGURATION, baseRef: "production" }]) {
    assert.throws(() => createPolicyReadAuthority(configuration, READER_CREDENTIAL, transport), /CONFIGURATION_INVALID/);
  }
  const reader = createPolicyReadAuthority(READER_CONFIGURATION, READER_CREDENTIAL, transport);
  assert.deepEqual(Object.keys(reader), ["readProtection"]);
  await assert.rejects(reader.readProtection({ ...READER_SUBJECT, baseRef: "production" }), /SUBJECT_MISMATCH/);
  assert.equal(calls, 0);
});

test("policy reader uses only its separate token and refetches exact repository scope for every read", async () => {
  const seen = []; const mutableConfig = clone(READER_CONFIGURATION); const mutableCredential = clone(READER_CREDENTIAL);
  const reader = createPolicyReadAuthority(mutableConfig, mutableCredential, async (url, init) => {
    seen.push(url); assert.equal(init.method, "GET"); assert.equal(init.redirect, "error");
    assert.equal(init.headers.authorization, `Bearer ${READER_CREDENTIAL.token}`);
    if (url.includes("/installation/repositories?")) return Response.json({ total_count: 1,
      repositories: [{ id: policy.repositoryId, full_name: policy.repository }] });
    assert.equal(url, `https://api.github.com${ROOT}/branches/main/protection`);
    return Response.json(protection());
  });
  const mutableSubject = clone(READER_SUBJECT); const pending = reader.readProtection(mutableSubject);
  mutableConfig.baseRef = "production"; mutableCredential.token = "unrelated-token"; mutableSubject.baseRef = "production";
  assert.equal((await pending).url, protection().url);
  await reader.readProtection(READER_SUBJECT);
  assert.equal(seen.length, 4); assert.equal(seen.filter((url) => url.includes("/installation/repositories?")).length, 2);
});

test("wrong or broad policy-token scope and wrong-branch policy responses fail closed", async () => {
  for (const scope of [{ total_count: 2, repositories: [{ id: policy.repositoryId, full_name: policy.repository }] },
    { total_count: 1, repositories: [{ id: 99, full_name: policy.repository }] },
    { total_count: 1, repositories: [{ id: policy.repositoryId, full_name: "attacker/other" }] }]) {
    let calls = 0;
    const reader = createPolicyReadAuthority(READER_CONFIGURATION, READER_CREDENTIAL, async () => {
      calls++; return Response.json(scope);
    });
    await assert.rejects(reader.readProtection(READER_SUBJECT), /REPOSITORY_SCOPE_MISMATCH/);
    assert.equal(calls, 1);
  }
  const reader = createPolicyReadAuthority(READER_CONFIGURATION, READER_CREDENTIAL, async (url) =>
    url.includes("/installation/repositories?") ? Response.json({ total_count: 1,
      repositories: [{ id: policy.repositoryId, full_name: policy.repository }] })
      : Response.json({ ...protection(), url: `https://api.github.com${ROOT}/branches/production/protection` }));
  await assert.rejects(reader.readProtection(READER_SUBJECT), /RESPONSE_SUBJECT_MISMATCH/);
});

test("unavailable policy administration permission is explicit and is never borrowed from GITHUB_TOKEN", async () => {
  const reader = createPolicyReadAuthority(READER_CONFIGURATION, READER_CREDENTIAL, async (url) =>
    url.includes("/installation/repositories?") ? Response.json({ total_count: 1,
      repositories: [{ id: policy.repositoryId, full_name: policy.repository }] })
      : new Response("sensitive provider detail", { status: 403 }));
  await assert.rejects(reader.readProtection(READER_SUBJECT), /^Error: MAINTENANCE_PROTECTION_READ_AUTHORITY_REQUIRED$/);
  let calls = 0;
  const client = createGitHubClient("synthetic-workflow-token", async () => { calls++; return Response.json(protection()); });
  await assert.rejects(client.get(`${ROOT}/branches/main/protection`), /SEPARATE_POLICY_READER_REQUIRED/);
  assert.equal(calls, 0);
  const consumer = fixtureClient(); let invoked = false;
  consumer.policyReader = { readProtection() { invoked = true; return protection(); } };
  await assert.rejects(consumeAuthenticatedEvidence(consumer, evidence(), { run: { id: 901, run_attempt: 1 } },
    () => NOW + 1), /POLICY_READER_UNAUTHENTICATED/);
  assert.equal(invoked, false);
  assert.equal(consumer.seen.filter((call) => call.method === "POST").at(-1).body.conclusion, "failure");
});

function producerFixture(alter = () => {}) {
  const run = { id: 901, repository: { id: policy.repositoryId }, head_repository: { id: policy.repositoryId },
    path: policy.producerWorkflow, name: policy.producerName, event: "pull_request_target",
    status: "completed", conclusion: "success", run_attempt: 1, head_sha: sha("3"), head_branch: "codex/fixture" };
  const jobs = ["Select maintenance subject", "Exact head foundry", "Exact head slither", "Attest maintenance evidence"]
    .map((name, index) => ({ name, id: 9000 + index, run_id: 901, run_attempt: 1, status: "completed", conclusion: "success" }));
  const artifact = { id: 1000, name: "platform-maintenance-evidence-901-1", expired: false,
    digest: `sha256:${"a".repeat(64)}`, size_in_bytes: 5000,
    workflow_run: { id: 901, repository_id: policy.repositoryId, head_repository_id: policy.repositoryId,
      head_sha: run.head_sha, head_branch: run.head_branch } };
  const state = { run, jobs, artifacts: [artifact] }; alter(state);
  return { async get(route) {
    if (route === `${ROOT}/actions/runs/901`) return clone(state.run);
    if (route.includes("/jobs?")) return { jobs: clone(state.jobs) };
    if (route.includes("/artifacts?")) return { artifacts: clone(state.artifacts) };
    assert.fail(`Unexpected producer route ${route}`);
  } };
}

test("producer resolution requires one complete independent job set and one exact immutable artifact", async () => {
  const selected = await resolveProducer(producerFixture(), 901);
  assert.equal(selected.artifact.id, 1000); assert.equal(selected.run.run_attempt, 1);
  for (const change of [
    (state) => { state.run.path = ".github/workflows/spoof.yml"; },
    (state) => { state.run.repository.id = 42; },
    (state) => { state.jobs[1].conclusion = "skipped"; },
    (state) => { state.jobs[2].run_id = 42; },
    (state) => { state.jobs[3].run_attempt = 2; },
    (state) => { state.jobs.pop(); },
    (state) => { state.artifacts[0].id = 0; },
    (state) => { state.artifacts[0].expired = true; },
    (state) => { state.artifacts[0].digest = "unbound"; },
    (state) => { state.artifacts[0].workflow_run.head_repository_id = 42; },
    (state) => { state.artifacts[0].workflow_run.head_sha = sha("f"); },
    (state) => { state.artifacts[0].name = "platform-maintenance-evidence-901-2"; },
    (state) => { state.artifacts.push(clone(state.artifacts[0])); },
  ]) await assert.rejects(resolveProducer(producerFixture(change), 901));
});

test("malformed worker bindings and scan locations cannot enter a signed evidence subject", () => {
  const original = { subject: subject(), ...workers(), legacyObservation: observation(), runId: 901, runAttempt: 1, issuedAt: NOW };
  for (const change of [
    (input) => { input.foundry.sourceCommit = sha("9"); },
    (input) => { input.slither.sourceTree = sha("9"); },
    (input) => { input.foundry.solcVersion = "0.8.25"; },
    (input) => { input.foundry.testCount = 0; },
    (input) => { input.slither.slitherReport.success = false; },
  ]) { const input = clone(original); change(input); assert.throws(() => createEvidence(input)); }
  const invalid = clone(finding); invalid.elements[0].source_mapping.filename_relative = "../private/file.sol";
  assert.throws(() => evaluateSlither(scan([invalid]), subject()), /LOCATION_INVALID/);
});
