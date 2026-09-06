import {
  MAINTENANCE_POLICY, REQUIRED_LEGACY_CHECKS, canonical, digest, exactKeys, executionBinding, hash,
  oid, requireValue, safePath, snapshotJson, validateSubject,
} from "./platform-maintenance-policy.mjs";

export const EVIDENCE_SCHEMA = "programmable.platform-maintenance-evidence.v1";
export const WORKER_SCHEMA = "programmable.platform-maintenance-worker.v1";

export function slitherAnalysisHash(subject, policy = MAINTENANCE_POLICY) {
  const execution = executionBinding(subject, policy);
  return digest({ domain: "programmable.platform-maintenance-slither-input.v1",
    sourceTree: execution.sourceTree, slither: policy.slitherVersion, solc: policy.solcVersion,
    foundry: policy.foundryVersion });
}

export function evaluateSlither(raw, subjectValue, policy = MAINTENANCE_POLICY) {
  const { subject } = executionBinding(subjectValue, policy);
  const report = snapshotJson(raw);
  requireValue(report.success === true && (report.error === null || report.error === "")
    && report.results && Array.isArray(report.results.detectors), "MAINTENANCE_SLITHER_INCOMPLETE");
  requireValue(report.results.detectors.length <= 10000, "MAINTENANCE_SLITHER_TOO_LARGE");
  const findings = report.results.detectors.map((finding) => {
    requireValue(typeof finding.check === "string" && /^[a-z0-9-]{1,128}$/.test(finding.check)
      && ["High", "Medium", "Low", "Informational", "Optimization"].includes(finding.impact)
      && ["High", "Medium", "Low"].includes(finding.confidence)
      && typeof finding.description === "string" && finding.description.length > 0
      && /^[0-9a-f]{64}$/.test(finding.id)
      && Array.isArray(finding.elements) && finding.elements.length > 0,
    "MAINTENANCE_SLITHER_FINDING_INVALID");
    const locations = finding.elements.map((element) => {
      const source = element.source_mapping;
      requireValue(source && safePath(source.filename_relative)
        && Number.isSafeInteger(source.start) && source.start >= 0
        && Number.isSafeInteger(source.length) && source.length > 0
        && Array.isArray(source.lines) && source.lines.length > 0
        && source.lines.every((line) => Number.isSafeInteger(line) && line > 0),
      "MAINTENANCE_SLITHER_LOCATION_INVALID");
      return { path: source.filename_relative, start: source.start, length: source.length, lines: source.lines };
    });
    return { id: finding.id, check: finding.check, impact: finding.impact, confidence: finding.confidence,
      description: finding.description, locations };
  });
  const findingHashes = findings.map((finding) => digest({
    domain: "programmable.platform-maintenance-slither-finding.v1", finding,
  }));
  requireValue(new Set(findingHashes).size === findings.length
    && new Set(findings.map((finding) => finding.id)).size === findings.length,
  "MAINTENANCE_SLITHER_DUPLICATE_FINDING");
  const analysisHash = slitherAnalysisHash(subject, policy);
  const dispositions = snapshotJson(policy.slitherDispositions);
  const accepted = new Set();
  for (const disposition of dispositions) {
    exactKeys(disposition, ["findingHash", "analysisHash", "disposition", "rationale",
      "reviewedSourceCommit", "evidencePath", "evidenceBlob"]);
    requireValue(hash(disposition.findingHash) && hash(disposition.analysisHash)
      && ["false-positive", "accepted-risk"].includes(disposition.disposition)
      && typeof disposition.rationale === "string" && disposition.rationale.trim().length >= 40
      && oid(disposition.reviewedSourceCommit) && safePath(disposition.evidencePath)
      && oid(disposition.evidenceBlob), "MAINTENANCE_SLITHER_DISPOSITION_INVALID");
    // Dispositions for a different analysis source are not reusable exceptions.
    if (disposition.analysisHash !== analysisHash) continue;
    requireValue(!accepted.has(disposition.findingHash), "MAINTENANCE_SLITHER_DUPLICATE_DISPOSITION");
    accepted.add(disposition.findingHash);
  }
  const unresolved = findingHashes.filter((findingHash) => !accepted.has(findingHash));
  requireValue(unresolved.length === 0, "MAINTENANCE_SLITHER_UNRESOLVED_FINDING");
  requireValue([...accepted].every((findingHash) => findingHashes.includes(findingHash)),
    "MAINTENANCE_SLITHER_STALE_DISPOSITION");
  return snapshotJson({ analysisHash, findingHashes: [...findingHashes].sort(),
    dispositionHash: digest(dispositions), rawReportHash: digest(report) });
}

export function validateWorker(value, subjectValue, lane, policy = MAINTENANCE_POLICY) {
  const { subject, sourceCommit, sourceTree } = executionBinding(subjectValue, policy);
  const worker = snapshotJson(value);
  exactKeys(worker, ["schema", "lane", "subjectHash", "sourceCommit", "sourceTree", "foundryVersion",
    "solcVersion", "slitherVersion", "testCount", "testReportHash", "slitherReport"]);
  requireValue(worker.schema === WORKER_SCHEMA && worker.lane === lane
    && worker.subjectHash === digest(subject) && worker.sourceCommit === sourceCommit
    && worker.sourceTree === sourceTree && worker.foundryVersion === policy.foundryVersion
    && worker.solcVersion === policy.solcVersion, "MAINTENANCE_WORKER_BINDING_INVALID");
  if (lane === "foundry") {
    requireValue(Number.isSafeInteger(worker.testCount) && worker.testCount > 0 && hash(worker.testReportHash)
      && worker.slitherVersion === null && worker.slitherReport === null, "MAINTENANCE_TEST_EVIDENCE_INVALID");
  } else {
    requireValue(lane === "slither" && worker.slitherVersion === policy.slitherVersion
      && worker.testCount === null && worker.testReportHash === null, "MAINTENANCE_SCAN_EVIDENCE_INVALID");
    evaluateSlither(worker.slitherReport, subject, policy);
  }
  return worker;
}

export function createPostMergeEvidence({ subject: input, foundry, slither, runId, runAttempt, issuedAt },
  policy = MAINTENANCE_POLICY) {
  const { subject } = executionBinding(input, policy);
  requireValue(subject.schema === "programmable.platform-maintenance-post-merge-subject.v1"
    && Number.isSafeInteger(runId) && runId > 0 && Number.isSafeInteger(runAttempt) && runAttempt > 0
    && Number.isSafeInteger(issuedAt) && issuedAt > 0, "MAINTENANCE_POST_MERGE_PRODUCER_INVALID");
  return snapshotJson({ schema: "programmable.platform-maintenance-post-merge-evidence.v1", subject,
    producer: { workflow: policy.postMergeWorkflow, sourceCommit: subject.original.controllerSha, runId, runAttempt },
    issuedAt, authority: "protected-main-post-merge-local-verification-only",
    foundry: validateWorker(foundry, subject, "foundry", policy),
    slither: validateWorker(slither, subject, "slither", policy),
    websiteDeployment: false, applicationAuthority: false, onchainAuthority: false });
}

export function validateLegacyChecks(observationValue, subjectValue, policy = MAINTENANCE_POLICY) {
  const subject = validateSubject(subjectValue, policy);
  const observation = snapshotJson(observationValue);
  exactKeys(observation, ["checks", "runs", "jobs"]);
  requireValue([observation.checks, observation.runs, observation.jobs].every(Array.isArray),
    "MAINTENANCE_CHECK_OBSERVATION_INVALID");
  return REQUIRED_LEGACY_CHECKS.map((required) => {
    const checks = observation.checks.filter((check) => check.name === required.name)
      .sort((left, right) => right.id - left.id);
    const check = checks[0];
    requireValue(check && check.status === "completed" && check.conclusion === "success"
      && check.head_sha === subject.headSha && check.app?.id === policy.githubActionsAppId
      && check.app.slug === "github-actions" && check.app.owner?.login === "github",
    "MAINTENANCE_REQUIRED_CHECK_NOT_AUTHENTICATED");
    const details = new RegExp(`^https://github\\.com/${policy.repository}/actions/runs/([1-9][0-9]*)/job/([1-9][0-9]*)$`)
      .exec(check.details_url);
    requireValue(details && Number(details[2]) === check.id, "MAINTENANCE_CHECK_RUN_IDENTITY_INVALID");
    const runId = Number(details[1]);
    const run = observation.runs.find((item) => item.id === runId);
    const job = observation.jobs.find((item) => item.id === check.id);
    requireValue(run && job && run.path === required.path
      && run.repository?.id === policy.repositoryId && run.head_repository?.id === policy.repositoryId
      && run.head_sha === subject.headSha && run.status === "completed" && run.conclusion === "success"
      && run.event === (required.name === "public-intake" ? "pull_request_target" : "pull_request")
      && run.pull_requests?.some((pr) => pr.number === subject.pullRequest && pr.base?.sha === subject.baseSha
        && pr.head?.sha === subject.headSha && pr.head.repo?.id === policy.repositoryId
        && pr.base.repo?.id === policy.repositoryId)
      && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0
      && job.run_id === runId && job.run_attempt === run.run_attempt && job.head_sha === subject.headSha
      && job.status === "completed" && job.conclusion === "success" && job.name === required.name,
    "MAINTENANCE_CHECK_WORKFLOW_MISMATCH");
    return { name: required.name, workflow: required.path, appId: check.app.id,
      checkId: check.id, runId, runAttempt: run.run_attempt };
  });
}

export function createEvidence({ subject: inputSubject, foundry, slither, legacyObservation,
  runId, runAttempt, issuedAt }, policy = MAINTENANCE_POLICY) {
  const subject = validateSubject(inputSubject, policy);
  requireValue(Number.isSafeInteger(runId) && runId > 0 && Number.isSafeInteger(runAttempt)
    && runAttempt > 0 && Number.isSafeInteger(issuedAt) && issuedAt > 0, "MAINTENANCE_PRODUCER_INVALID");
  const foundryWorker = validateWorker(foundry, subject, "foundry", policy);
  const slitherWorker = validateWorker(slither, subject, "slither", policy);
  const checks = validateLegacyChecks(legacyObservation, subject, policy);
  return snapshotJson({ schema: EVIDENCE_SCHEMA, subject,
    producer: { workflow: policy.producerWorkflow, sourceCommit: subject.controllerSha, runId, runAttempt },
    issuedAt, expiresAt: issuedAt + policy.maxAgeMs,
    authority: "internal-platform-source-consistency-only", foundry: foundryWorker, slither: slitherWorker,
    checks, decision: "eligible-for-protected-maintenance-merge" });
}

// A valid JSON object is not a signature. The production consumer first
// authenticates the exact immutable artifact with GitHub/Sigstore, then calls
// this verifier with independently resolved run, checkout and current PR data.
export function verifyEvidence(value, expected, policy = MAINTENANCE_POLICY) {
  const evidence = snapshotJson(value);
  const bound = snapshotJson(expected);
  exactKeys(evidence, ["schema", "subject", "producer", "issuedAt", "expiresAt", "authority",
    "foundry", "slither", "checks", "decision"]);
  exactKeys(evidence.producer, ["workflow", "sourceCommit", "runId", "runAttempt"]);
  requireValue(evidence.schema === EVIDENCE_SCHEMA && evidence.authority === "internal-platform-source-consistency-only"
    && evidence.decision === "eligible-for-protected-maintenance-merge", "MAINTENANCE_EVIDENCE_SCHEMA_INVALID");
  const subject = validateSubject(evidence.subject, policy);
  requireValue(canonical(subject) === canonical(validateSubject(bound.subject, policy))
    && evidence.producer.workflow === policy.producerWorkflow
    && evidence.producer.sourceCommit === subject.controllerSha
    && evidence.producer.runId === bound.runId && evidence.producer.runAttempt === bound.runAttempt,
  "MAINTENANCE_EVIDENCE_SUBJECT_DRIFT");
  requireValue(Number.isSafeInteger(bound.now) && Number.isSafeInteger(evidence.issuedAt)
    && evidence.issuedAt <= bound.now && evidence.expiresAt === evidence.issuedAt + policy.maxAgeMs
    && evidence.expiresAt > bound.now, "MAINTENANCE_EVIDENCE_EXPIRED");
  validateWorker(evidence.foundry, subject, "foundry", policy);
  validateWorker(evidence.slither, subject, "slither", policy);
  requireValue(canonical(evidence.checks) === canonical(validateLegacyChecks(bound.legacyObservation, subject, policy)),
    "MAINTENANCE_TECHNICAL_EVIDENCE_DRIFT");
  return snapshotJson({ subject, evidenceHash: digest(evidence), expiresAt: evidence.expiresAt });
}
