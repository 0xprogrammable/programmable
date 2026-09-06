import { createHash } from "node:crypto";

export const MAINTENANCE_POLICY = Object.freeze({
  schema: "programmable.platform-maintenance-policy.v1",
  repository: "programmablehq/PROGRAMMABLE",
  repositoryId: 1314365508,
  baseRef: "main",
  controllerRef: "production",
  producerWorkflow: ".github/workflows/platform-maintenance-verify.yml",
  producerName: "Verify platform maintenance",
  consumerWorkflow: ".github/workflows/platform-maintenance-release.yml",
  postMergeWorkflow: ".github/workflows/platform-maintenance-post-merge.yml",
  checkName: "platform-maintenance-release",
  githubActionsAppId: 15368,
  maxChangedFiles: 256,
  maxEvidenceBytes: 16 * 1024 * 1024,
  maxAgeMs: 60 * 60 * 1000,
  foundryVersion: "1.7.1",
  slitherVersion: "0.11.5",
  solcVersion: "0.8.26",
  // This is the existing production CI-control authorization, not permission
  // to alter this policy or to manufacture an application-admission receipt.
  controlAuthorization: Object.freeze({
    commit: "e15bb397604a19d6622af5a5ee9622a8edac9d18",
    tree: "92eecc16da2c59b87295fcb4012e57fe4f1feae7",
    controlPaths: Object.freeze([
      ".github/workflows/verify.yml",
      "config/multi-role-router-v2/foundry.toml",
      "plugins/marketplace/plugins/programmable/skills/programmable-v4-hook-builder/scripts/test/verify-skill-static.test.mjs",
      "plugins/marketplace/plugins/programmable/skills/programmable-v4-hook-builder/scripts/verify-skill.mjs",
      "plugins/marketplace/test/plugin-packaging.test.mjs",
      "skills/programmable-v4-hook-builder/scripts/test/verify-skill-static.test.mjs",
      "skills/programmable-v4-hook-builder/scripts/verify-skill.mjs",
    ]),
  }),
  // No commit-bound main-branch dispositions were found. Existing reporting-
  // only Slither success must never silently become an accepted baseline.
  slitherDispositions: Object.freeze([]),
});

export const REQUIRED_LEGACY_CHECKS = Object.freeze([
  Object.freeze({ name: "foundry", path: ".github/workflows/verify.yml" }),
  Object.freeze({ name: "hook-builder-maintenance", path: ".github/workflows/verify.yml" }),
  Object.freeze({ name: "security", path: ".github/workflows/security.yml" }),
  Object.freeze({ name: "public-intake", path: ".github/workflows/verify-hook-builder.yml" }),
]);

export function requireValue(condition, code) {
  if (!condition) throw new Error(code);
}

// Helpers accept inert JSON only. Never read accessors while producing an
// authorization snapshot that will survive asynchronous GitHub operations.
export function snapshotJson(value, budget = { nodes: 200000 }, seen = new Set()) {
  requireValue(--budget.nodes >= 0, "MAINTENANCE_INPUT_TOO_LARGE");
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") {
    requireValue(Number.isSafeInteger(value), "MAINTENANCE_NUMBER_INVALID");
    return value;
  }
  requireValue(typeof value === "object" && !seen.has(value), "MAINTENANCE_INPUT_NOT_INERT");
  requireValue(Object.getPrototypeOf(value) === Object.prototype
    || Object.getPrototypeOf(value) === null || Array.isArray(value), "MAINTENANCE_INPUT_NOT_INERT");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireValue(Reflect.ownKeys(value).every((key) => typeof key === "string"), "MAINTENANCE_INPUT_NOT_INERT");
  seen.add(value);
  let result;
  if (Array.isArray(value)) {
    requireValue(Object.getPrototypeOf(value) === Array.prototype, "MAINTENANCE_INPUT_NOT_INERT");
    requireValue(Object.keys(descriptors).length === value.length + 1, "MAINTENANCE_ARRAY_INVALID");
    result = Array.from({ length: value.length }, (_, index) => {
      const property = descriptors[String(index)];
      requireValue(property && "value" in property, "MAINTENANCE_INPUT_NOT_INERT");
      return snapshotJson(property.value, budget, seen);
    });
  } else {
    result = Object.create(null);
    for (const key of Object.keys(descriptors).sort()) {
      const property = descriptors[key];
      requireValue("value" in property && property.enumerable, "MAINTENANCE_INPUT_NOT_INERT");
      result[key] = snapshotJson(property.value, budget, seen);
    }
  }
  seen.delete(value);
  return Object.freeze(result);
}

export function canonical(value) { return JSON.stringify(snapshotJson(value)); }
export function digest(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}
export function byteDigest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
export const oid = (value) => typeof value === "string" && /^[0-9a-f]{40}$/.test(value);
export const hash = (value) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
export function exactKeys(value, keys, code = "MAINTENANCE_SCHEMA_INVALID") {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"), code);
}
export function safePath(value) {
  return typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= 4096
    && !/[\\\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(value)
    && value.split("/").every((part) => part && part !== "." && part !== ".." && part !== ".git");
}

export function validateSubject(value, policy = MAINTENANCE_POLICY) {
  const subject = snapshotJson(value);
  exactKeys(subject, ["schema", "repository", "repositoryId", "pullRequest", "authorId", "baseSha", "baseTree",
    "headSha", "headTree", "mergeSha", "mergeTree", "controllerSha", "policyHash", "files"]);
  requireValue(subject.schema === "programmable.platform-maintenance-subject.v1"
    && subject.repository === policy.repository && subject.repositoryId === policy.repositoryId
    && Number.isSafeInteger(subject.pullRequest) && subject.pullRequest > 0
    && Number.isSafeInteger(subject.authorId) && subject.authorId > 0, "MAINTENANCE_SUBJECT_INVALID");
  requireValue(["baseSha", "baseTree", "headSha", "headTree", "mergeSha", "mergeTree", "controllerSha"]
    .every((key) => oid(subject[key])) && subject.baseSha !== subject.headSha, "MAINTENANCE_REVISION_INVALID");
  requireValue(subject.policyHash === digest(policy), "MAINTENANCE_POLICY_DRIFT");
  requireValue(Array.isArray(subject.files) && subject.files.length > 0
    && subject.files.length <= policy.maxChangedFiles, "MAINTENANCE_FILES_INVALID");
  const paths = new Set();
  const ownerPinned = subject.headSha === policy.controlAuthorization.commit
    && subject.headTree === policy.controlAuthorization.tree;
  for (const file of subject.files) {
    exactKeys(file, ["path", "status", "baseBlob", "headBlob", "baseMode", "headMode"]);
    requireValue(safePath(file.path) && !paths.has(file.path), "MAINTENANCE_PATH_INVALID");
    paths.add(file.path);
    requireValue(!file.path.startsWith("submissions/"), "MAINTENANCE_APPLICATION_NOT_AUTHORIZED");
    requireValue(["added", "modified"].includes(file.status), "MAINTENANCE_CHANGE_UNSUPPORTED");
    requireValue(oid(file.headBlob) && file.headMode === "100644"
      && (file.status === "added" ? file.baseBlob === null && file.baseMode === null
        : oid(file.baseBlob) && file.baseMode === "100644"), "MAINTENANCE_BLOB_INVALID");
    const sourcePath = /^(src|test)\/[A-Za-z0-9_./-]+\.sol$/.test(file.path)
      || /^docs\/[A-Za-z0-9_./-]+\.md$/.test(file.path)
      || file.path === ".gas-snapshot";
    requireValue(sourcePath || ownerPinned && policy.controlAuthorization.controlPaths.includes(file.path),
      "MAINTENANCE_CONTROL_AUTHORIZATION_REQUIRED");
  }
  return subject;
}

export function assertLivePullRequest(value, subject, permission, policy = MAINTENANCE_POLICY) {
  const pr = snapshotJson(value);
  requireValue(pr.number === subject.pullRequest && pr.state === "open" && pr.draft === false
    && pr.merged === false && pr.mergeable === true, "MAINTENANCE_PR_NOT_CURRENT");
  requireValue(pr.base?.repo?.id === policy.repositoryId && pr.head?.repo?.id === policy.repositoryId
    && pr.base.repo.full_name === policy.repository && pr.head.repo.full_name === policy.repository
    && pr.base.ref === policy.baseRef && pr.base.sha === subject.baseSha
    && pr.head.sha === subject.headSha && pr.merge_commit_sha === subject.mergeSha
    && pr.user?.id === subject.authorId, "MAINTENANCE_PR_BINDING_DRIFT");
  requireValue(pr.changed_files === subject.files.length, "MAINTENANCE_FILE_LIST_INCOMPLETE");
  requireValue(permission.user?.id === subject.authorId
    && ["admin", "write", "maintain"].includes(permission.permission), "MAINTENANCE_FIRST_PARTY_REQUIRED");
}

export function executionBinding(value, policy = MAINTENANCE_POLICY) {
  const input = snapshotJson(value);
  if (input.schema === "programmable.platform-maintenance-post-merge-subject.v1") {
    exactKeys(input, ["schema", "original", "originalEvidenceHash", "mergeCommit", "mergeTree", "parentCommit"]);
    const original = validateSubject(input.original, policy);
    requireValue(hash(input.originalEvidenceHash) && oid(input.mergeCommit)
      && input.mergeCommit !== original.headSha && input.mergeTree === original.mergeTree
      && input.parentCommit === original.baseSha, "MAINTENANCE_POST_MERGE_SUBJECT_INVALID");
    return Object.freeze({ subject: input, original, sourceCommit: input.mergeCommit, sourceTree: input.mergeTree });
  }
  const subject = validateSubject(input, policy);
  return Object.freeze({ subject, original: subject, sourceCommit: subject.headSha, sourceTree: subject.headTree });
}

export function assertMergeProtection(value, policy = MAINTENANCE_POLICY) {
  const protection = snapshotJson(value);
  const required = protection.required_status_checks;
  requireValue(required?.strict === true && protection.enforce_admins?.enabled === true
    && protection.required_linear_history?.enabled === true
    && protection.allow_force_pushes?.enabled === false && protection.allow_deletions?.enabled === false,
  "MAINTENANCE_BRANCH_PROTECTION_INCOMPLETE");
  const review = protection.required_pull_request_reviews;
  requireValue(review?.required_approving_review_count === 0 && review.require_code_owner_reviews === false
    && review.require_last_push_approval === false, "MAINTENANCE_HUMAN_RULE_STILL_ACTIVE");
  for (const name of [...REQUIRED_LEGACY_CHECKS.map((check) => check.name), policy.checkName]) {
    requireValue(required.checks?.some((check) => check.context === name
      && check.app_id === policy.githubActionsAppId), "MAINTENANCE_REQUIRED_CHECK_MISSING");
  }
}
