import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const GIT_COMMIT_OID = /^[0-9a-f]{40}$/u;
const APPLICATION_HANDLE = /^github-[0-9a-f]{64}$/u;
const VERCEL_DEPLOYMENT_ID = /^dpl_[A-Za-z0-9]{8,128}$/u;
const REVIEW_AUTHORITY_MODES = new Set(["manual_review", "autonomous_ai"]);

export function createCustomLaunchCanaryEvidence(input) {
  if (input === null || typeof input !== "object") {
    throw new TypeError("Custom Launch canary evidence input is invalid");
  }
  const targetUrl = exactHttpsOrigin(input.targetUrl);
  if (input.probeResult?.baseUrl !== targetUrl) {
    throw new TypeError("Custom Launch canary result is not release-ready");
  }
  if (
    typeof input.deploymentId !== "string"
    || !VERCEL_DEPLOYMENT_ID.test(input.deploymentId)
  ) throw new TypeError("Custom Launch candidate deployment id is invalid");
  if (
    typeof input.websiteCommitSha !== "string"
    || !GIT_COMMIT_OID.test(input.websiteCommitSha)
  ) throw new TypeError("Custom Launch candidate commit is invalid");
  if (
    typeof input.approvalServicePackageArtifactHash !== "string"
    || !SHA256_DIGEST.test(input.approvalServicePackageArtifactHash)
  ) throw new TypeError("Custom Launch approval package identity is invalid");
  if (!REVIEW_AUTHORITY_MODES.has(input.reviewAuthorityMode)) {
    throw new TypeError("Custom Launch review authority mode is invalid");
  }
  const sessionAuthorityConfigurationHash = exactSha256(
    input.probeResult?.sessionAuthorityConfigurationHash,
    "session authority configuration",
  );
  const commonEvidence = {
    result: "passed",
    candidate: Object.freeze({
      deploymentId: input.deploymentId,
      targetUrl,
      websiteCommitSha: input.websiteCommitSha,
    }),
    approvalService: Object.freeze({
      packageArtifactHash: input.approvalServicePackageArtifactHash,
      reviewAuthorityMode: input.reviewAuthorityMode,
    }),
    sessionAuthority: Object.freeze({
      configurationHash: sessionAuthorityConfigurationHash,
    }),
  };

  if (
    input.probeResult.status === "disabled"
    && input.probeResult.authenticatedCanary === "not_requested"
  ) {
    return Object.freeze({
      schemaVersion: "programmable.custom-launch-dark-readiness-evidence.v1",
      ...commonEvidence,
      readiness: Object.freeze({
        status: "disabled",
        authenticatedCanary: false,
      }),
    });
  }
  if (
    input.probeResult.status !== "ready"
    || input.probeResult.authenticatedCanary !== "passed"
  ) throw new TypeError("Custom Launch canary result is not release-ready");
  const ownApplicationHandle = exactApplicationHandle(
    input.ownApplicationHandle,
    "own application handle",
  );
  const foreignApplicationHandle = exactApplicationHandle(
    input.foreignApplicationHandle,
    "foreign application handle",
  );
  if (ownApplicationHandle === foreignApplicationHandle) {
    throw new TypeError("Custom Launch canary application handles must differ");
  }

  return Object.freeze({
    schemaVersion: "programmable.custom-launch-candidate-canary-evidence.v1",
    ...commonEvidence,
    canary: Object.freeze({
      authenticated: true,
      ownApplicationHandleSha256: digest(ownApplicationHandle),
      foreignApplicationHandleSha256: digest(foreignApplicationHandle),
      principalVerified: true,
      launchEligibilityVerified: true,
      launchDescriptorVerified: true,
      foreignApplicationDenied: true,
    }),
  });
}

export async function writeCustomLaunchCanaryEvidence(path, evidence) {
  if (
    typeof path !== "string"
    || path.trim() !== path
    || path.length === 0
    || path.length > 4_096
    || /[\r\n\0]/u.test(path)
  ) throw new TypeError("Custom Launch canary evidence path is invalid");
  const canonicalJson = `${JSON.stringify(evidence)}\n`;
  await writeFile(path, canonicalJson, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function exactHttpsOrigin(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new TypeError("Custom Launch candidate URL is invalid");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
  ) throw new TypeError("Custom Launch candidate URL must be an HTTPS origin");
  return url.origin;
}

function exactApplicationHandle(value, name) {
  if (typeof value !== "string" || !APPLICATION_HANDLE.test(value)) {
    throw new TypeError(`Custom Launch canary ${name} is invalid`);
  }
  return value;
}

function digest(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function exactSha256(value, name) {
  if (typeof value !== "string" || !SHA256_DIGEST.test(value)) {
    throw new TypeError(`Custom Launch ${name} is invalid`);
  }
  return value;
}
