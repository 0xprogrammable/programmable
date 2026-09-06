import { createHash } from "node:crypto";
import {
  MAINTENANCE_POLICY, REQUIRED_LEGACY_CHECKS, assertLivePullRequest, assertMergeProtection,
  canonical, digest, exactKeys, executionBinding, oid, requireValue, snapshotJson, validateSubject,
} from "./platform-maintenance-policy.mjs";
import { verifyEvidence } from "./platform-maintenance-evidence.mjs";

const API_ROOT = "https://api.github.com";
const ROOT = `/repos/${MAINTENANCE_POLICY.repository}`;

async function requestGitHubJson(token, transport, method, route, body) {
  let response;
  try {
    response = await transport(`${API_ROOT}${route}`, {
      method, redirect: "error", signal: AbortSignal.timeout(30000),
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10", ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: canonical(body) }),
    });
  } catch { throw new Error("MAINTENANCE_GITHUB_TRANSPORT_FAILED"); }
  if (!response.ok && response.status === 403
    && route === `${ROOT}/branches/${MAINTENANCE_POLICY.baseRef}/protection`) {
    throw new Error("MAINTENANCE_PROTECTION_READ_AUTHORITY_REQUIRED");
  }
  requireValue(response.ok, "MAINTENANCE_GITHUB_REQUEST_FAILED");
  if (response.status === 204 && method === "POST"
    && route === `${ROOT}/actions/workflows/platform-maintenance-post-merge.yml/dispatches`) return null;
  requireValue(response.body, "MAINTENANCE_GITHUB_REQUEST_FAILED");
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    requireValue(size <= MAINTENANCE_POLICY.maxEvidenceBytes, "MAINTENANCE_GITHUB_RESPONSE_TOO_LARGE");
    chunks.push(chunk);
  }
  try { return snapshotJson(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
  catch { throw new Error("MAINTENANCE_GITHUB_RESPONSE_INVALID"); }
}

export function createGitHubClient(token, transport = fetch) {
  requireValue(typeof token === "string" && token.length > 0, "MAINTENANCE_GITHUB_AUTH_REQUIRED");
  async function request(method, route, body) {
    requireValue(["GET", "POST", "PUT"].includes(method) && route.startsWith(`${ROOT}/`)
      && !route.includes("..") && !/[\\\r\n#]/.test(route), "MAINTENANCE_GITHUB_ROUTE_INVALID");
    requireValue(!route.includes("/protection"), "MAINTENANCE_SEPARATE_POLICY_READER_REQUIRED");
    return requestGitHubJson(token, transport, method, route, body);
  }
  return Object.freeze({
    get: (route) => request("GET", route),
    post: (route, body) => request("POST", route, body),
    put: (route, body) => request("PUT", route, body),
  });
}

export function policyReadConfiguration(policy = MAINTENANCE_POLICY) {
  if (policy.policyReadAuthority === null) return null;
  const pins = snapshotJson(policy.policyReadAuthority);
  exactKeys(pins, ["appId", "installationId"], "MAINTENANCE_POLICY_READER_CONFIGURATION_INVALID");
  requireValue(Number.isSafeInteger(pins.appId) && pins.appId > 0
    && Number.isSafeInteger(pins.installationId) && pins.installationId > 0,
  "MAINTENANCE_POLICY_READER_CONFIGURATION_INVALID");
  return snapshotJson({ ...pins, repository: policy.repository, repositoryId: policy.repositoryId,
    baseRef: policy.baseRef });
}

const policyReaders = new WeakSet();

// Configuration is trusted constructor policy, never PR or artifact input.
// The protected workflow supplies credentials exclusively from the pinned App
// token action. This reader cannot send writes or use the ordinary merge token.
export function createPolicyReadAuthority(configurationValue, credentialValue, transport = fetch) {
  requireValue(configurationValue !== null, "MAINTENANCE_POLICY_READ_AUTHORITY_UNCONFIGURED");
  const configuration = snapshotJson(configurationValue);
  const credential = snapshotJson(credentialValue);
  exactKeys(configuration, ["appId", "installationId", "repository", "repositoryId", "baseRef"]);
  exactKeys(credential, ["appId", "installationId", "token"]);
  requireValue(configuration.repository === MAINTENANCE_POLICY.repository
    && configuration.repositoryId === MAINTENANCE_POLICY.repositoryId
    && configuration.baseRef === MAINTENANCE_POLICY.baseRef
    && Number.isSafeInteger(configuration.appId) && configuration.appId > 0
    && Number.isSafeInteger(configuration.installationId) && configuration.installationId > 0,
  "MAINTENANCE_POLICY_READER_CONFIGURATION_INVALID");
  requireValue(credential.appId === configuration.appId
    && credential.installationId === configuration.installationId
    && typeof credential.token === "string" && credential.token.length > 0,
  "MAINTENANCE_POLICY_READER_CREDENTIAL_BINDING_INVALID");
  const reader = Object.freeze({
    async readProtection(subjectValue) {
      const selected = snapshotJson(subjectValue);
      exactKeys(selected, ["repository", "repositoryId", "baseRef"]);
      requireValue(selected.repository === configuration.repository
        && selected.repositoryId === configuration.repositoryId && selected.baseRef === configuration.baseRef,
      "MAINTENANCE_POLICY_READER_SUBJECT_MISMATCH");
      const scope = await requestGitHubJson(credential.token, transport, "GET",
        "/installation/repositories?per_page=100&page=1");
      requireValue(scope.total_count === 1 && Array.isArray(scope.repositories) && scope.repositories.length === 1
        && scope.repositories[0].id === configuration.repositoryId
        && scope.repositories[0].full_name === configuration.repository,
      "MAINTENANCE_POLICY_READER_REPOSITORY_SCOPE_MISMATCH");
      const route = `${ROOT}/branches/${configuration.baseRef}/protection`;
      const protection = await requestGitHubJson(credential.token, transport, "GET", route);
      requireValue(protection.url === `${API_ROOT}${route}`, "MAINTENANCE_POLICY_READER_RESPONSE_SUBJECT_MISMATCH");
      return protection;
    },
  });
  policyReaders.add(reader);
  return reader;
}

async function readMergeProtection(reader, subject, policy) {
  requireValue(reader !== null, "MAINTENANCE_POLICY_READ_AUTHORITY_UNCONFIGURED");
  requireValue(policyReaders.has(reader), "MAINTENANCE_POLICY_READER_UNAUTHENTICATED");
  return reader.readProtection({ repository: subject.repository, repositoryId: subject.repositoryId, baseRef: policy.baseRef });
}

async function paginate(client, route, field, limit) {
  const values = [];
  for (let page = 1; page <= Math.ceil(limit / 100) + 1; page++) {
    const response = await client.get(`${route}${route.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
    const items = field === null ? response : response[field];
    requireValue(Array.isArray(items) && items.length <= 100, "MAINTENANCE_GITHUB_PAGE_INVALID");
    values.push(...items);
    requireValue(values.length <= limit, "MAINTENANCE_GITHUB_PAGINATION_LIMIT");
    if (items.length < 100) return values;
  }
  throw new Error("MAINTENANCE_GITHUB_PAGINATION_INCOMPLETE");
}

function treeEntries(value, expected) {
  requireValue(value.sha === expected && value.truncated === false && Array.isArray(value.tree)
    && value.tree.length <= 50000, "MAINTENANCE_GIT_TREE_INCOMPLETE");
  const entries = new Map();
  for (const entry of value.tree) {
    requireValue(!entries.has(entry.path), "MAINTENANCE_GIT_TREE_DUPLICATE");
    entries.set(entry.path, entry);
  }
  return entries;
}

async function assertNoSuppressionChange(client, file) {
  if (!file.path.endsWith(".sol") || file.headBlob === file.baseBlob) return;
  for (const objectId of [file.baseBlob, file.headBlob].filter(Boolean)) {
    const blob = await client.get(`${ROOT}/git/blobs/${objectId}`);
    requireValue(blob.sha === objectId && blob.encoding === "base64" && typeof blob.content === "string"
      && Number.isSafeInteger(blob.size) && blob.size >= 0 && blob.size <= 2 * 1024 * 1024,
    "MAINTENANCE_SOURCE_BLOB_INVALID");
    const bytes = Buffer.from(blob.content, "base64");
    const computed = createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
    requireValue(bytes.length === blob.size && computed === objectId, "MAINTENANCE_SOURCE_BLOB_MISMATCH");
    // Changing a file containing analyzer suppression requires a separately
    // reviewed policy path. A source comment cannot silently weaken the scan.
    requireValue(!/slither\s*[-_]\s*(disable|enable)/i.test(bytes.toString("utf8")),
      "MAINTENANCE_SUPPRESSION_REVIEW_REQUIRED");
  }
}

export async function selectSubject(client, pullRequest, controllerSha, policy = MAINTENANCE_POLICY) {
  requireValue(Number.isSafeInteger(pullRequest) && pullRequest > 0 && oid(controllerSha),
    "MAINTENANCE_SELECTION_INVALID");
  const pr = snapshotJson(await client.get(`${ROOT}/pulls/${pullRequest}`));
  requireValue(pr.number === pullRequest && oid(pr.head?.sha) && oid(pr.base?.sha)
    && oid(pr.merge_commit_sha) && /^[A-Za-z0-9-]{1,39}$/.test(pr.user?.login ?? "")
    && pr.base.repo?.id === policy.repositoryId && pr.head.repo?.id === policy.repositoryId,
  "MAINTENANCE_FIRST_PARTY_REQUIRED");
  const [baseRef, controllerRef, base, head, merge, permission, files] = await Promise.all([
    client.get(`${ROOT}/git/ref/heads/${policy.baseRef}`),
    client.get(`${ROOT}/git/ref/heads/${policy.controllerRef}`),
    client.get(`${ROOT}/git/commits/${pr.base.sha}`),
    client.get(`${ROOT}/git/commits/${pr.head.sha}`),
    client.get(`${ROOT}/git/commits/${pr.merge_commit_sha}`),
    client.get(`${ROOT}/collaborators/${pr.user.login}/permission`),
    paginate(client, `${ROOT}/pulls/${pullRequest}/files`, null, policy.maxChangedFiles),
  ]);
  requireValue(baseRef.object?.sha === pr.base.sha && controllerRef.object?.sha === controllerSha,
    "MAINTENANCE_TRUSTED_REF_DRIFT");
  requireValue(base.sha === pr.base.sha && head.sha === pr.head.sha && merge.sha === pr.merge_commit_sha
    && [base.tree?.sha, head.tree?.sha, merge.tree?.sha].every(oid)
    && merge.parents?.length === 2 && merge.parents[0].sha === base.sha && merge.parents[1].sha === head.sha,
  "MAINTENANCE_GIT_MERGE_MISMATCH");
  const [baseTree, headTree] = await Promise.all([
    client.get(`${ROOT}/git/trees/${base.tree.sha}?recursive=1`),
    client.get(`${ROOT}/git/trees/${head.tree.sha}?recursive=1`),
  ]);
  const oldEntries = treeEntries(baseTree, base.tree.sha);
  const newEntries = treeEntries(headTree, head.tree.sha);
  const subject = validateSubject({ schema: "programmable.platform-maintenance-subject.v1",
    repository: policy.repository, repositoryId: policy.repositoryId, pullRequest, authorId: pr.user.id,
    baseSha: base.sha, baseTree: base.tree.sha, headSha: head.sha, headTree: head.tree.sha,
    mergeSha: merge.sha, mergeTree: merge.tree.sha, controllerSha, policyHash: digest(policy),
    files: files.map((file) => ({ path: file.filename, status: file.status,
      baseBlob: oldEntries.get(file.filename)?.sha ?? null, baseMode: oldEntries.get(file.filename)?.mode ?? null,
      headBlob: newEntries.get(file.filename)?.sha ?? null, headMode: newEntries.get(file.filename)?.mode ?? null,
    })).sort((left, right) => left.path.localeCompare(right.path, "en")),
  }, policy);
  assertLivePullRequest(pr, subject, permission, policy);
  for (const file of subject.files) await assertNoSuppressionChange(client, file);
  await revalidateSubject(client, subject, policy);
  return subject;
}

export async function revalidateSubject(client, value, policy = MAINTENANCE_POLICY) {
  const subject = validateSubject(value, policy);
  const [pr, baseRef, controllerRef, head, merge] = await Promise.all([
    client.get(`${ROOT}/pulls/${subject.pullRequest}`), client.get(`${ROOT}/git/ref/heads/${policy.baseRef}`),
    client.get(`${ROOT}/git/ref/heads/${policy.controllerRef}`), client.get(`${ROOT}/git/commits/${subject.headSha}`),
    client.get(`${ROOT}/git/commits/${subject.mergeSha}`),
  ]);
  requireValue(/^[A-Za-z0-9-]{1,39}$/.test(pr.user?.login ?? ""), "MAINTENANCE_AUTHOR_INVALID");
  const permission = await client.get(`${ROOT}/collaborators/${pr.user.login}/permission`);
  assertLivePullRequest(pr, subject, permission, policy);
  requireValue(baseRef.object?.sha === subject.baseSha && controllerRef.object?.sha === subject.controllerSha
    && head.sha === subject.headSha && head.tree?.sha === subject.headTree
    && merge.sha === subject.mergeSha && merge.tree?.sha === subject.mergeTree
    && merge.parents?.length === 2 && merge.parents[0].sha === subject.baseSha
    && merge.parents[1].sha === subject.headSha, "MAINTENANCE_LIVE_REF_DRIFT");
  return pr;
}

export async function observeLegacyChecks(client, subject) {
  const checks = await paginate(client, `${ROOT}/commits/${subject.headSha}/check-runs`, "check_runs", 1000);
  const runs = new Map(); const jobs = [];
  for (const required of REQUIRED_LEGACY_CHECKS) {
    const check = checks.filter((item) => item.name === required.name).sort((a, b) => b.id - a.id)[0];
    const match = new RegExp(`^https://github\\.com/${MAINTENANCE_POLICY.repository}/actions/runs/([1-9][0-9]*)/job/([1-9][0-9]*)$`)
      .exec(check?.details_url ?? "");
    requireValue(match && Number.isSafeInteger(check.id) && check.id > 0, "MAINTENANCE_CHECK_RUN_MISSING");
    const runId = Number(match[1]);
    if (!runs.has(runId)) runs.set(runId, await client.get(`${ROOT}/actions/runs/${runId}`));
    jobs.push(await client.get(`${ROOT}/actions/jobs/${Number(match[2])}`));
  }
  return snapshotJson({ checks, runs: [...runs.values()], jobs });
}

export async function resolveProducer(client, runId, policy = MAINTENANCE_POLICY) {
  requireValue(Number.isSafeInteger(runId) && runId > 0, "MAINTENANCE_PRODUCER_ID_INVALID");
  const run = await client.get(`${ROOT}/actions/runs/${runId}`);
  requireValue(run.id === runId && run.repository?.id === policy.repositoryId
    && run.head_repository?.id === policy.repositoryId && run.path === policy.producerWorkflow
    && run.name === policy.producerName && ["pull_request_target", "workflow_dispatch", "workflow_run"].includes(run.event)
    && run.status === "completed" && run.conclusion === "success"
    && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0, "MAINTENANCE_PRODUCER_NOT_AUTHENTICATED");
  const jobs = await paginate(client, `${ROOT}/actions/runs/${runId}/attempts/${run.run_attempt}/jobs`, "jobs", 100);
  const names = ["Select maintenance subject", "Exact head foundry", "Exact head slither", "Attest maintenance evidence"];
  requireValue(jobs.length === names.length && names.every((name) => {
    const matches = jobs.filter((job) => job.name === name);
    return matches.length === 1 && matches[0].conclusion === "success" && matches[0].status === "completed"
      && matches[0].run_attempt === run.run_attempt && matches[0].run_id === runId
      && Number.isSafeInteger(matches[0].id) && matches[0].id > 0;
  }), "MAINTENANCE_PRODUCER_JOBS_INVALID");
  const artifacts = await paginate(client, `${ROOT}/actions/runs/${runId}/artifacts`, "artifacts", 100);
  const matches = artifacts.filter((artifact) => artifact.name === `platform-maintenance-evidence-${runId}-${run.run_attempt}`);
  requireValue(matches.length === 1 && matches[0].expired === false
    && Number.isSafeInteger(matches[0].id) && matches[0].id > 0
    && /^sha256:[a-f0-9]{64}$/.test(matches[0].digest) && matches[0].workflow_run?.id === runId
    && matches[0].workflow_run.repository_id === policy.repositoryId
    && matches[0].workflow_run.head_repository_id === policy.repositoryId
    && matches[0].workflow_run.head_sha === run.head_sha
    && matches[0].workflow_run.head_branch === run.head_branch
    && Number.isSafeInteger(matches[0].size_in_bytes) && matches[0].size_in_bytes > 0
    && matches[0].size_in_bytes <= policy.maxEvidenceBytes,
  "MAINTENANCE_ARTIFACT_INVALID");
  return snapshotJson({ run, artifact: matches[0] });
}

async function publishMaintenanceCheck(client, subject, verified, policy, name, conclusion) {
  const technical = name === policy.evidenceCheckName;
  const status = conclusion === null ? "in_progress" : "completed";
  const check = await client.post(`${ROOT}/check-runs`, {
    name, head_sha: subject.headSha, status, ...(conclusion === null ? {} : { conclusion }),
    external_id: verified.evidenceHash,
    output: conclusion === null ? { title: "Current maintenance release policy is being verified",
      summary: "No release authorization has been established for this verification attempt." }
      : conclusion === "success" ? { title: technical ? "Exact platform maintenance evidence verified"
        : "Current protected maintenance release verified",
      summary: `Source ${subject.headSha}; policy ${subject.policyHash}; evidence ${verified.evidenceHash}. ${technical
        ? "Technical evidence only; this context never grants merge permission."
        : "Current authenticated protection and technical evidence verified for the conditional merge."} No application, deployment or onchain authority.` }
      : { title: "Maintenance release state changed or could not be confirmed",
        summary: "A subsequent subject, technical-evidence or conditional-merge check failed. Fresh evidence and state reconciliation are required." },
  });
  requireValue(check.name === name && check.head_sha === subject.headSha
    && check.app?.id === policy.githubActionsAppId && check.external_id === verified.evidenceHash
    && check.status === status && (conclusion === null ? check.conclusion == null : check.conclusion === conclusion),
  "MAINTENANCE_CHECK_PUBLICATION_INVALID");
}

async function currentEvidence(client, evidence, producer, now, policy) {
  const subject = evidence.subject;
  const pr = await revalidateSubject(client, subject, policy);
  const verified = verifyEvidence(evidence, { subject, runId: producer.run.id, runAttempt: producer.run.run_attempt,
    legacyObservation: await observeLegacyChecks(client, subject), now: now() }, policy);
  return { pr, verified };
}

// Only the trusted CLI calls this after gh attestation verify has succeeded.
// No input JSON, PR label, check name or caller-supplied 'approved' flag can
// substitute for that provenance step. The SHA condition is sent to GitHub's
// ordinary merge endpoint; protected strict status checks remain authoritative.
export async function consumeAuthenticatedEvidence(client, evidenceValue, producerValue,
  now = Date.now, policy = MAINTENANCE_POLICY, policyReader = null) {
  const evidence = snapshotJson(evidenceValue);
  const producer = snapshotJson(producerValue);
  const subject = validateSubject(evidence.subject, policy);
  const { verified } = await currentEvidence(client, evidence, producer, now, policy);
  let bootstrapProtectionHold = false;
  try {
    // Reset any prior release context. Genuine technical bootstrap evidence
    // uses a different name and cannot later become a required merge success.
    // Every operation after this pending publication is in the failure scope.
    await publishMaintenanceCheck(client, subject, verified, policy, policy.checkName, null);
    await publishMaintenanceCheck(client, subject, verified, policy, policy.evidenceCheckName, "success");
    await currentEvidence(client, evidence, producer, now, policy);
    try {
      const protection = await readMergeProtection(policyReader, subject, policy);
      assertMergeProtection(protection, policy);
    } catch (error) {
      const protectionHold = ["MAINTENANCE_BRANCH_PROTECTION_INCOMPLETE",
        "MAINTENANCE_HUMAN_RULE_STILL_ACTIVE", "MAINTENANCE_REQUIRED_CHECK_MISSING",
        "MAINTENANCE_PROTECTION_READ_AUTHORITY_REQUIRED",
        "MAINTENANCE_POLICY_READ_AUTHORITY_UNCONFIGURED"].includes(error?.message);
      if (!protectionHold) throw error;
      // Retain real bootstrap evidence only after another fresh subject,
      // technical-run and expiry check. A policy-read limitation never merges.
      await currentEvidence(client, evidence, producer, now, policy);
      bootstrapProtectionHold = true;
      throw error;
    }
    await currentEvidence(client, evidence, producer, now, policy);
    await publishMaintenanceCheck(client, subject, verified, policy, policy.checkName, "success");
    // Re-observe after the release context, including fresh policy authority,
    // before GitHub enforces its ordinary conditional protected merge.
    assertMergeProtection(await readMergeProtection(policyReader, subject, policy), policy);
    const { pr } = await currentEvidence(client, evidence, producer, now, policy);
    requireValue(pr.mergeable_state === "clean", "MAINTENANCE_MERGE_NOT_READY");
    requireValue(now() < verified.expiresAt, "MAINTENANCE_EVIDENCE_EXPIRED");
    const result = await client.put(`${ROOT}/pulls/${subject.pullRequest}/merge`, {
      sha: subject.headSha, merge_method: "squash",
    });
    requireValue(result.merged === true && oid(result.sha), "MAINTENANCE_MERGE_FAILED");
    const postSubject = { schema: "programmable.platform-maintenance-post-merge-subject.v1", original: subject,
      originalEvidenceHash: verified.evidenceHash, mergeCommit: result.sha,
      mergeTree: subject.mergeTree, parentCommit: subject.baseSha };
    await revalidateMergedSubject(client, postSubject, policy);
    return snapshotJson({ schema: "programmable.platform-maintenance-merge-observation.v1",
      subjectHash: digest(subject), evidenceHash: verified.evidenceHash, mergeCommit: result.sha,
      mergeTree: subject.mergeTree, parentCommit: subject.baseSha, producerRunId: producer.run.id,
      websiteDeployment: false, applicationAuthority: false });
  } catch (error) {
    try {
      await publishMaintenanceCheck(client, subject, verified, policy, policy.checkName, "failure");
      if (!bootstrapProtectionHold) {
        await publishMaintenanceCheck(client, subject, verified, policy, policy.evidenceCheckName, "failure");
      }
    } catch { throw new Error("MAINTENANCE_MERGE_STATE_UNCERTAIN"); }
    throw error;
  }
}

export async function revalidateMergedSubject(client, value, policy = MAINTENANCE_POLICY) {
  const binding = executionBinding(value, policy);
  const subject = binding.subject; const original = binding.original;
  requireValue(subject.schema === "programmable.platform-maintenance-post-merge-subject.v1",
    "MAINTENANCE_POST_MERGE_SUBJECT_REQUIRED");
  const [pr, commit, baseRef, controllerRef] = await Promise.all([
    client.get(`${ROOT}/pulls/${original.pullRequest}`), client.get(`${ROOT}/git/commits/${subject.mergeCommit}`),
    client.get(`${ROOT}/git/ref/heads/${policy.baseRef}`), client.get(`${ROOT}/git/ref/heads/${policy.controllerRef}`),
  ]);
  requireValue(pr.number === original.pullRequest && pr.state === "closed" && pr.merged === true
    && pr.merge_commit_sha === subject.mergeCommit && pr.head?.sha === original.headSha
    && pr.head.repo?.id === policy.repositoryId && pr.base?.repo?.id === policy.repositoryId
    && pr.base.ref === policy.baseRef && pr.user?.id === original.authorId,
  "MAINTENANCE_MERGED_PR_MISMATCH");
  requireValue(baseRef.object?.sha === subject.mergeCommit && controllerRef.object?.sha === original.controllerSha
    && commit.sha === subject.mergeCommit && commit.tree?.sha === subject.mergeTree
    && commit.parents?.length === 1 && commit.parents[0].sha === subject.parentCommit,
  "MAINTENANCE_POST_MERGE_REF_DRIFT");
  return subject;
}

export async function dispatchPostMergeVerification(client, postSubject, producerRunId, policy = MAINTENANCE_POLICY) {
  const subject = executionBinding(postSubject, policy).subject;
  requireValue(Number.isSafeInteger(producerRunId) && producerRunId > 0, "MAINTENANCE_PRODUCER_ID_INVALID");
  await revalidateMergedSubject(client, subject, policy);
  await client.post(`${ROOT}/actions/workflows/platform-maintenance-post-merge.yml/dispatches`, {
    ref: policy.controllerRef,
    inputs: { pull_request: String(subject.original.pullRequest), merge_sha: subject.mergeCommit,
      producer_run: String(producerRunId), controller_sha: subject.original.controllerSha },
  });
  await revalidateMergedSubject(client, subject, policy);
  return snapshotJson({ schema: "programmable.platform-maintenance-post-merge-dispatch.v1",
    subjectHash: digest(subject), mergeCommit: subject.mergeCommit, dispatchAccepted: true,
    verificationCompleted: false, deploymentCompleted: false });
}
