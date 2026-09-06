#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAINTENANCE_POLICY as policy, canonical, digest, executionBinding, oid, requireValue, safePath, validateSubject,
} from "./platform-maintenance-policy.mjs";
import { WORKER_SCHEMA, createEvidence, createPostMergeEvidence, evaluateSlither,
  validateLegacyChecks, verifyEvidence } from "./platform-maintenance-evidence.mjs";
import { consumeAuthenticatedEvidence, createGitHubClient, dispatchPostMergeVerification,
  observeLegacyChecks, publishAuthenticatedEvidenceCheck, revalidateMergedSubject, revalidateSubject,
  resolveProducer, selectSubject } from "./platform-maintenance-github.mjs";

const controllerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MAX_TOOL_BYTES = 64 * 1024 * 1024;
function run(command, arguments_, cwd = controllerRoot, env = process.env) {
  try {
    return execFileSync(command, arguments_, { cwd, env, encoding: "utf8", maxBuffer: MAX_TOOL_BYTES,
      timeout: 40 * 60 * 1000, stdio: ["ignore", "pipe", "pipe"] });
  } catch { throw new Error("MAINTENANCE_TOOL_EXECUTION_FAILED"); }
}
function git(arguments_, cwd = controllerRoot) {
  return run("git", ["--no-pager", "--no-replace-objects", ...arguments_], cwd).trim();
}
function readJson(file, canonicalRequired = true) {
  const stat = lstatSync(file);
  requireValue(stat.isFile() && !stat.isSymbolicLink() && stat.size > 0
    && stat.size <= policy.maxEvidenceBytes, "MAINTENANCE_FILE_INVALID");
  const bytes = readFileSync(file);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const value = JSON.parse(text);
  requireValue(!canonicalRequired || `${canonical(value)}\n` === text, "MAINTENANCE_ARTIFACT_NOT_CANONICAL");
  return value;
}
function writeJson(file, value) {
  const bytes = `${canonical(value)}\n`;
  requireValue(Buffer.byteLength(bytes) <= policy.maxEvidenceBytes, "MAINTENANCE_ARTIFACT_TOO_LARGE");
  writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
}
function output(values) {
  requireValue(typeof process.env.GITHUB_OUTPUT === "string", "MAINTENANCE_OUTPUT_UNAVAILABLE");
  for (const [key, value] of Object.entries(values)) {
    requireValue(/^[a-z_]+$/.test(key) && /^[A-Za-z0-9:_./-]+$/.test(String(value)), "MAINTENANCE_OUTPUT_INVALID");
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}
function assertController(workflow) {
  const sha = process.env.GITHUB_WORKFLOW_SHA;
  requireValue(oid(sha) && process.env.GITHUB_SHA === sha
    && process.env.GITHUB_REPOSITORY === policy.repository
    && process.env.GITHUB_REPOSITORY_ID === String(policy.repositoryId)
    && process.env.GITHUB_REF === `refs/heads/${policy.controllerRef}`
    && process.env.GITHUB_REF_PROTECTED === "true"
    && process.env.GITHUB_WORKFLOW_REF === `${policy.repository}/${workflow}@refs/heads/${policy.controllerRef}`,
  "MAINTENANCE_CONTROLLER_NOT_PROTECTED_SOURCE");
  requireValue(git(["rev-parse", "HEAD"]) === sha && git(["status", "--porcelain"]) === ""
    && git(["remote", "get-url", "origin"]) === `https://github.com/${policy.repository}`,
  "MAINTENANCE_CONTROLLER_CHECKOUT_INVALID");
  for (const disposition of policy.slitherDispositions) {
    requireValue(safePath(disposition.evidencePath)
      && git(["rev-parse", `${sha}:${disposition.evidencePath}`]) === disposition.evidenceBlob,
    "MAINTENANCE_DISPOSITION_SOURCE_MISSING");
  }
  return sha;
}

export function assertWorkerEnvironment(env) {
  requireValue(!env.GH_TOKEN && !env.GITHUB_TOKEN && !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN
    && !env.ACTIONS_ID_TOKEN_REQUEST_URL, "MAINTENANCE_WORKER_CREDENTIAL_PRESENT");
}
export function summarizeFoundryReport(report) {
  requireValue(report && typeof report === "object" && !Array.isArray(report), "MAINTENANCE_FORGE_REPORT_INVALID");
  let testCount = 0;
  for (const suite of Object.values(report)) {
    requireValue(suite && suite.test_results && typeof suite.test_results === "object"
      && !Array.isArray(suite.test_results), "MAINTENANCE_FORGE_SUITE_INVALID");
    for (const test of Object.values(suite.test_results)) {
      requireValue(test.status === "Success", "MAINTENANCE_FORGE_TEST_NOT_SUCCESSFUL");
      testCount++;
    }
  }
  requireValue(testCount > 0, "MAINTENANCE_FORGE_TESTS_MISSING");
  return { testCount, testReportHash: digest(report) };
}
export function attestationArguments(file, sourceCommit) {
  requireValue(oid(sourceCommit), "MAINTENANCE_ATTESTATION_SOURCE_INVALID");
  return ["attestation", "verify", file, "--repo", policy.repository,
    "--signer-workflow", `${policy.repository}/${policy.producerWorkflow}`,
    "--source-ref", `refs/heads/${policy.controllerRef}`, "--source-digest", sourceCommit,
    "--signer-digest", sourceCommit, "--deny-self-hosted-runners", "--format", "json"];
}

function worker(subjectPath, candidateRoot, lane, destination) {
  assertWorkerEnvironment(process.env);
  requireValue(["foundry", "slither"].includes(lane), "MAINTENANCE_WORKER_LANE_INVALID");
  const { subject, original, sourceCommit, sourceTree } = executionBinding(readJson(subjectPath));
  requireValue(git(["rev-parse", "HEAD"], candidateRoot) === sourceCommit
    && git(["rev-parse", "HEAD^{tree}"], candidateRoot) === sourceTree
    && git(["status", "--porcelain"], candidateRoot) === "", "MAINTENANCE_CANDIDATE_CHECKOUT_INVALID");
  // Only the unchanged base bootstrap may execute on this unprivileged runner.
  const bootstrap = "scripts/bootstrap-deps.sh";
  requireValue(git(["rev-parse", `${original.baseSha}:${bootstrap}`], candidateRoot)
    === git(["rev-parse", `${sourceCommit}:${bootstrap}`], candidateRoot),
  "MAINTENANCE_BOOTSTRAP_CHANGED");
  const env = { ...process.env, FOUNDRY_FFI: "false", FOUNDRY_PROFILE: "ci" };
  run("bash", [bootstrap], candidateRoot, env);
  const forgeVersion = run("forge", ["--version"], candidateRoot, env);
  requireValue(/\b1\.7\.1(?:[-+\s]|$)/.test(forgeVersion), "MAINTENANCE_FOUNDRY_VERSION_INVALID");
  const config = JSON.parse(run("forge", ["config", "--json"], candidateRoot, env));
  requireValue(config.ffi === false && config.solc === policy.solcVersion
    && config.evm_version === "cancun" && Array.isArray(config.fs_permissions)
    && config.fs_permissions.every((permission) => permission.access === "read"
      && safePath(permission.path.replace(/^\.\//, ""))), "MAINTENANCE_FOUNDRY_CONFIG_INVALID");
  const report = { schema: WORKER_SCHEMA, lane, subjectHash: digest(subject), sourceCommit,
    sourceTree, foundryVersion: policy.foundryVersion, solcVersion: policy.solcVersion,
    slitherVersion: null, testCount: null, testReportHash: null, slitherReport: null };
  if (lane === "foundry") {
    run("forge", ["fmt", "--check"], candidateRoot, env);
    run("forge", ["build", "--sizes"], candidateRoot, env);
    Object.assign(report, summarizeFoundryReport(JSON.parse(run("forge", ["test", "--json",
      "--no-match-contract", "ClassicV3MainnetForkTest"], candidateRoot, env))));
  } else {
    requireValue(run("slither", ["--version"], candidateRoot, env).trim() === policy.slitherVersion,
      "MAINTENANCE_SLITHER_VERSION_INVALID");
    const rawPath = path.join(destination, "slither.raw.json");
    const configPath = path.join(destination, "slither.config.json");
    writeJson(configPath, { filter_paths: "(^|/)(lib|test)/" });
    // Slither's finding exit code is reporting data, never merge approval.
    // The trusted evaluator below and the separate issuer both parse every
    // detector and require an explicit, exact-source disposition.
    const scan = spawnSync("slither", [".", "--config-file", configPath, "--json", rawPath], {
      cwd: candidateRoot, env, encoding: "utf8", timeout: 40 * 60 * 1000, maxBuffer: MAX_TOOL_BYTES,
    });
    requireValue(!scan.error && scan.signal === null && [0, 255].includes(scan.status)
      && !/ERROR:|Error in|Unable to|failed to|not supported|WARNING:/i.test(`${scan.stdout}\n${scan.stderr}`),
    "MAINTENANCE_SLITHER_EXECUTION_INCOMPLETE");
    report.slitherVersion = policy.slitherVersion;
    report.slitherReport = readJson(rawPath, false);
    evaluateSlither(report.slitherReport, subject);
  }
  requireValue(git(["rev-parse", "HEAD"], candidateRoot) === sourceCommit
    && git(["diff", "--name-only", "HEAD", "--"], candidateRoot) === "",
  "MAINTENANCE_SOURCE_CHANGED_DURING_EXECUTION");
  writeJson(path.join(destination, `${lane}.json`), report);
}

async function authenticatedInput(client, sha) {
  const producer = readJson(process.env.MAINTENANCE_PRODUCER);
  const fresh = await resolveProducer(client, producer.run.id);
  requireValue(canonical(fresh) === canonical(producer), "MAINTENANCE_PRODUCER_ARTIFACT_DRIFT");
  const file = process.env.MAINTENANCE_EVIDENCE;
  const evidence = readJson(file);
  requireValue(evidence.subject?.controllerSha === sha, "MAINTENANCE_CONTROLLER_DRIFT");
  const attestation = JSON.parse(run("gh", attestationArguments(file, sha)));
  requireValue(Array.isArray(attestation) && attestation.length > 0, "MAINTENANCE_ATTESTATION_MISSING");
  verifyEvidence(evidence, { subject: evidence.subject, runId: fresh.run.id, runAttempt: fresh.run.run_attempt,
    legacyObservation: await observeLegacyChecks(client, evidence.subject), now: Date.now() });
  return { evidence, producer: fresh };
}

async function main() {
  const operation = process.argv[2];
  requireValue(process.argv.length === 3, "MAINTENANCE_ARGUMENTS_INVALID");
  const sha = assertController(operation?.startsWith("post-") ? policy.postMergeWorkflow
    : ["resolve", "consume", "dispatch"].includes(operation) ? policy.consumerWorkflow : policy.producerWorkflow);
  const destination = path.resolve(process.env.MAINTENANCE_OUTPUT ?? "");
  requireValue(destination.startsWith(`${process.env.RUNNER_TEMP}/`), "MAINTENANCE_OUTPUT_PATH_INVALID");
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  if (operation === "worker" || operation === "post-worker") {
    worker(process.env.MAINTENANCE_SUBJECT, process.env.MAINTENANCE_CANDIDATE,
      process.env.MAINTENANCE_LANE, destination);
    return;
  }
  const client = createGitHubClient(process.env.GH_TOKEN);
  if (operation === "select") {
    const subject = await selectSubject(client, Number(process.env.MAINTENANCE_PR), sha);
    validateLegacyChecks(await observeLegacyChecks(client, subject), subject);
    writeJson(path.join(destination, "subject.json"), subject);
    output({ head_sha: subject.headSha, subject_hash: digest(subject), pull_request: subject.pullRequest });
  } else if (operation === "attest") {
    const subject = validateSubject(readJson(process.env.MAINTENANCE_SUBJECT));
    requireValue(subject.controllerSha === sha, "MAINTENANCE_CONTROLLER_DRIFT");
    await revalidateSubject(client, subject);
    const evidence = createEvidence({ subject, foundry: readJson(process.env.MAINTENANCE_FOUNDRY),
      slither: readJson(process.env.MAINTENANCE_SLITHER), legacyObservation: await observeLegacyChecks(client, subject),
      runId: Number(process.env.GITHUB_RUN_ID), runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT), issuedAt: Date.now() });
    writeJson(path.join(destination, "evidence.json"), evidence);
  } else if (operation === "resolve" || operation === "post-resolve") {
    const producer = await resolveProducer(client, Number(process.env.MAINTENANCE_PRODUCER_RUN));
    writeJson(path.join(destination, "producer.json"), producer);
    output({ artifact_id: producer.artifact.id, run_id: producer.run.id, run_attempt: producer.run.run_attempt });
  } else if (operation === "consume") {
    const { evidence, producer } = await authenticatedInput(client, sha);
    await publishAuthenticatedEvidenceCheck(client, evidence, producer);
    const result = await consumeAuthenticatedEvidence(client, evidence, producer);
    writeJson(path.join(destination, "merge-observation.json"), result);
    output({ merge_sha: result.mergeCommit, producer_run: producer.run.id });
  } else if (operation === "dispatch" || operation === "post-select") {
    const { evidence, producer } = await authenticatedInput(client, sha);
    const merge = operation === "dispatch" ? readJson(process.env.MAINTENANCE_MERGE_OBSERVATION) : null;
    if (merge !== null) requireValue(merge.schema === "programmable.platform-maintenance-merge-observation.v1"
      && merge.subjectHash === digest(evidence.subject) && merge.evidenceHash === digest(evidence)
      && merge.producerRunId === producer.run.id, "MAINTENANCE_MERGE_OBSERVATION_INVALID");
    else requireValue(Number(process.env.MAINTENANCE_PR) === evidence.subject.pullRequest
      && process.env.MAINTENANCE_CONTROLLER_SHA === sha, "MAINTENANCE_POST_MERGE_SELECTOR_INVALID");
    const subject = { schema: "programmable.platform-maintenance-post-merge-subject.v1",
      original: evidence.subject, originalEvidenceHash: digest(evidence),
      mergeCommit: merge?.mergeCommit ?? process.env.MAINTENANCE_MERGED_SHA,
      mergeTree: evidence.subject.mergeTree, parentCommit: evidence.subject.baseSha };
    await revalidateMergedSubject(client, subject);
    if (operation === "dispatch") {
      const result = await dispatchPostMergeVerification(client, subject, producer.run.id);
      writeJson(path.join(destination, "post-merge-dispatch.json"), result);
    } else {
      writeJson(path.join(destination, "subject.json"), subject);
      output({ merge_sha: subject.mergeCommit });
    }
  } else if (operation === "post-attest") {
    const subject = executionBinding(readJson(process.env.MAINTENANCE_SUBJECT)).subject;
    requireValue(subject.original?.controllerSha === sha, "MAINTENANCE_CONTROLLER_DRIFT");
    await revalidateMergedSubject(client, subject);
    const evidence = createPostMergeEvidence({ subject, foundry: readJson(process.env.MAINTENANCE_FOUNDRY),
      slither: readJson(process.env.MAINTENANCE_SLITHER), runId: Number(process.env.GITHUB_RUN_ID),
      runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT), issuedAt: Date.now() });
    writeJson(path.join(destination, "post-merge-evidence.json"), evidence);
  } else throw new Error("MAINTENANCE_OPERATION_INVALID");
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Deliberately omit provider response bodies, credentials and argv.
    process.stderr.write(`${/^MAINTENANCE_[A-Z_]+$/.test(error?.message ?? "")
      ? error.message : "MAINTENANCE_EXECUTION_FAILED"}\n`);
    process.exitCode = 1;
  });
}
