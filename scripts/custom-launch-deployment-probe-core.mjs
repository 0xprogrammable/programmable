import { createHash } from "node:crypto";

const READINESS_PATH = "/api/custom-launch/readiness";
const AUTHENTICATED_CANARY_PATH = "/api/custom-launch/v3/applications?limit=100";
const READINESS_SCHEMA = "programmable.custom-launch-deployment-readiness.v1";
const TRUSTED_TIME_SCHEMA = "programmable.trusted-time.v1";
const APPLICATION_LIST_SCHEMA =
  "programmable.principal-custom-launch-application-list.v3";
const JSON_CONTENT_TYPE = "application/json";
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/u;
const REVIEW_AUTHORITY_MODES = new Set(["manual_review", "autonomous_ai"]);
const GIT_COMMIT_OID = /^[0-9a-f]{40}$/u;
const DEPLOYMENT_HOST = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const APPLICATION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const APPLICATION_HANDLE = /^github-[0-9a-f]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UINT256 = /^(?:0|[1-9][0-9]{0,77})$/u;
const RFC3339_UTC_MILLISECONDS =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{3}Z$/u;
const CURSOR = /^[A-Za-z0-9_-]{16,512}$/u;
const SIGNER_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SIGNER_EPOCH = /^(?:0|[1-9][0-9]{0,19})$/u;
const TRUSTED_TIME_QUERY_KEYS = Object.freeze([
  "keyId",
  "publicKeySpkiSha256",
  "signerComponentBindingHash",
  "signerEpoch",
]);
const APPLICATION_STATES = new Set([
  "received",
  "in_review",
  "changes_required",
  "platform_pending",
  "ready_for_registration",
  "approved",
  "stale",
  "rejected",
  "superseded",
  "expired",
  "revoked",
  "launching",
  "launched",
]);

export const CUSTOM_LAUNCH_DEPLOYMENT_PROBE_DEFAULTS = Object.freeze({
  attempts: 12,
  maximumResponseBytes: 1_048_576,
  maximumTimeSkewMs: 300_000,
  retryDelayMs: 5_000,
  timeoutMs: 10_000,
});

export async function probeCustomLaunchDeployment(input) {
  if (input === null || typeof input !== "object") {
    throw new TypeError("Custom launch deployment probe input is invalid");
  }
  const baseUrl = exactBaseUrl(input.baseUrl, input.allowHttpLocalhost === true);
  const fetchImplementation = input.fetch ?? globalThis.fetch?.bind(globalThis);
  if (typeof fetchImplementation !== "function") {
    throw new TypeError("Fetch is unavailable");
  }
  const now = input.now ?? (() => new Date());
  if (typeof now !== "function") throw new TypeError("Probe clock is invalid");
  const settings = exactSettings(input);
  const automationBypassSecret = input.automationBypassSecret === undefined
    ? undefined
    : exactSecret(input.automationBypassSecret, "automation bypass secret");
  const commonHeaders = Object.freeze({
    accept: JSON_CONTENT_TYPE,
    ...(automationBypassSecret === undefined ? {} : {
      "x-vercel-protection-bypass": automationBypassSecret,
    }),
  });

  const readinessUrl = new URL(READINESS_PATH, baseUrl);
  const readiness = await requestJsonWithRetries(readinessUrl, {
    fetchImplementation,
    headers: commonHeaders,
    settings,
    sleep: input.sleep,
  });
  const readinessStatus = validateReadiness(readiness, now, settings.maximumTimeSkewMs);
  validateExpectedRelease(readiness.release, input);
  validateExpectedApprovalServiceRelease(readiness.approvalServiceRelease, input);
  validateExpectedSessionAuthorityConfiguration(
    readinessStatus.sessionAuthorityConfigurationHash,
    input,
  );

  if (readinessStatus.status === "disabled") {
    if (input.requireEnabled === true) {
      throw new Error("Custom launch is disabled");
    }
    if (input.authenticatedCanary === true) {
      throw new Error("Authenticated canary requires an enabled custom launch deployment");
    }
    return Object.freeze({
      baseUrl: baseUrl.origin,
      status: "disabled",
      authenticatedCanary: "not_requested",
      sessionAuthorityConfigurationHash:
        readinessStatus.sessionAuthorityConfigurationHash,
    });
  }
  if (input.requireDisabled === true) {
    throw new Error("Custom launch is enabled while disabled mode is required");
  }

  const trustedTimeUrl = exactTrustedTimeUrl(readiness.trustedTimePath, baseUrl);
  const trustedTime = await requestJsonWithRetries(trustedTimeUrl, {
    fetchImplementation,
    headers: commonHeaders,
    settings,
    sleep: input.sleep,
  });
  validateTrustedTime(trustedTime, now, settings.maximumTimeSkewMs);

  let authenticatedCanary = "not_requested";
  if (input.authenticatedCanary === true) {
    const accessToken = exactSecret(input.accessToken, "access token");
    const identityToken = exactSecret(input.identityToken, "identity token");
    const expectedGithubUserId = exactGithubUserId(input.expectedGithubUserId);
    const ownApplicationHandle = exactApplicationHandle(
      input.ownApplicationHandle,
      "own application handle",
    );
    const foreignApplicationHandle = exactApplicationHandle(
      input.foreignApplicationHandle,
      "foreign application handle",
    );
    if (ownApplicationHandle === foreignApplicationHandle) {
      throw new TypeError("Canary own and foreign application handles must differ");
    }
    const applications = await requestJsonWithRetries(
      new URL(AUTHENTICATED_CANARY_PATH, baseUrl),
      {
        fetchImplementation,
        headers: {
          ...commonHeaders,
          authorization: `Bearer ${accessToken}`,
          "x-privy-identity-token": identityToken,
        },
        settings,
        sleep: input.sleep,
      },
    );
    const ownApplication = validatePrincipalApplicationList(
      applications,
      expectedGithubUserId,
      ownApplicationHandle,
    );
    const applicationPath = `/api/custom-launch/v3/applications/${ownApplicationHandle}`;
    const eligibility = await requestJsonWithRetries(
      new URL(`${applicationPath}/launch-eligibility`, baseUrl),
      {
        fetchImplementation,
        headers: {
          ...commonHeaders,
          authorization: `Bearer ${accessToken}`,
          "x-privy-identity-token": identityToken,
        },
        settings,
        sleep: input.sleep,
      },
    );
    validateLaunchEligibility(eligibility, ownApplication, now);
    const descriptor = await requestJsonWithRetries(
      new URL(`${applicationPath}/launch-descriptor`, baseUrl),
      {
        fetchImplementation,
        headers: {
          ...commonHeaders,
          authorization: `Bearer ${accessToken}`,
          "x-privy-identity-token": identityToken,
        },
        settings,
        sleep: input.sleep,
      },
    );
    validateLaunchDescriptor(descriptor, ownApplication, eligibility, now);
    const foreignRead = await requestJsonWithRetries(
      new URL(
        `/api/custom-launch/v3/applications/${foreignApplicationHandle}`,
        baseUrl,
      ),
      {
        fetchImplementation,
        headers: {
          ...commonHeaders,
          authorization: `Bearer ${accessToken}`,
          "x-privy-identity-token": identityToken,
        },
        expectedStatus: 404,
        settings,
        sleep: input.sleep,
      },
    );
    validateForeignApplicationDenial(foreignRead);
    authenticatedCanary = "passed";
  }

  return Object.freeze({
    baseUrl: baseUrl.origin,
    status: "ready",
    authenticatedCanary,
    sessionAuthorityConfigurationHash:
      readinessStatus.sessionAuthorityConfigurationHash,
  });
}

export function parseCustomLaunchDeploymentProbeArguments(
  argv,
  environment = process.env,
) {
  if (!Array.isArray(argv) || environment === null || typeof environment !== "object") {
    throw new TypeError("Probe arguments are invalid");
  }
  let baseUrl;
  let requireEnabled = false;
  let requireDisabled = false;
  let authenticatedCanary = false;
  let allowHttpLocalhost = false;
  for (const argument of argv) {
    if (argument === "--require-enabled") requireEnabled = true;
    else if (argument === "--require-disabled") requireDisabled = true;
    else if (argument === "--authenticated-canary") authenticatedCanary = true;
    else if (argument === "--allow-http-localhost") allowHttpLocalhost = true;
    else if (
      typeof argument === "string"
      && argument.startsWith("--base-url=")
      && baseUrl === undefined
    ) {
      baseUrl = argument.slice("--base-url=".length);
    } else {
      throw new TypeError(`Unknown or duplicate argument: ${String(argument)}`);
    }
  }
  if (baseUrl === undefined) throw new TypeError("Deployment URL is required");
  if (requireEnabled && requireDisabled) {
    throw new TypeError("Enabled and disabled modes cannot both be required");
  }
  return Object.freeze({
    baseUrl,
    requireEnabled,
    requireDisabled,
    authenticatedCanary,
    allowHttpLocalhost,
    ...(authenticatedCanary ? {
      accessToken: environment.PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_ACCESS_TOKEN,
      identityToken: environment.PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_IDENTITY_TOKEN,
      expectedGithubUserId:
        environment.PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_EXPECTED_GITHUB_USER_ID,
      ownApplicationHandle:
        environment.PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_OWN_APPLICATION_HANDLE,
      foreignApplicationHandle:
        environment.PROGRAMMABLE_CUSTOM_LAUNCH_CANARY_FOREIGN_APPLICATION_HANDLE,
    } : {}),
    expectedCommitSha: environment.PROGRAMMABLE_RELEASE_EXPECTED_COMMIT_SHA,
    expectedDeploymentHost: environment.PROGRAMMABLE_RELEASE_EXPECTED_DEPLOYMENT_HOST,
    expectedApprovalServicePackageArtifactHash:
      environment.PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_PACKAGE_ARTIFACT_HASH,
    expectedApprovalServiceReviewAuthorityMode:
      environment.PROGRAMMABLE_APPROVAL_SERVICE_EXPECTED_REVIEW_AUTHORITY_MODE,
    expectedSessionAuthorityConfigurationHash:
      environment.PROGRAMMABLE_GITHUB_SESSION_AUTHORITY_EXPECTED_CONFIGURATION_HASH,
    ...(environment.VERCEL_AUTOMATION_BYPASS_SECRET === undefined ? {} : {
      automationBypassSecret: environment.VERCEL_AUTOMATION_BYPASS_SECRET,
    }),
  });
}

async function requestJsonWithRetries(url, input) {
  let lastError;
  for (let attempt = 1; attempt <= input.settings.attempts; attempt += 1) {
    try {
      return await requestJson(url, input);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === input.settings.attempts) throw error;
      await exactSleep(input.sleep)(input.settings.retryDelayMs);
    }
  }
  throw lastError;
}

async function requestJson(url, input) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.settings.timeoutMs);
  try {
    let response;
    try {
      response = await input.fetchImplementation(url, {
        method: "GET",
        headers: input.headers,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      throw new RetryableProbeError("Deployment request failed", { cause: error });
    }

    if (!(response instanceof Response)) {
      throw new TypeError("Deployment response is invalid");
    }
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      await response.body?.cancel();
      throw new TypeError("Deployment response redirected");
    }
    const expectedStatus = input.expectedStatus ?? 200;
    if (response.status !== expectedStatus) {
      await response.body?.cancel();
      const ErrorType = isRetryableStatus(response.status)
        ? RetryableProbeError
        : TypeError;
      throw new ErrorType(
        `Deployment endpoint returned HTTP ${response.status}; expected ${expectedStatus}`,
      );
    }
    const contentType = response.headers.get("content-type")
      ?.split(";", 1)[0]?.trim().toLowerCase();
    const declaredLength = response.headers.get("content-length");
    if (
      contentType !== JSON_CONTENT_TYPE
      || (declaredLength !== null && (
        !/^\d+$/u.test(declaredLength)
        || Number(declaredLength) > input.settings.maximumResponseBytes
      ))
    ) {
      await response.body?.cancel();
      throw new TypeError("Deployment response metadata is invalid");
    }
    let bytes;
    try {
      bytes = await readBoundedBody(response, input.settings.maximumResponseBytes);
    } catch (error) {
      if (controller.signal.aborted) {
        throw new RetryableProbeError("Deployment response timed out", { cause: error });
      }
      throw error;
    }
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
      throw new TypeError("Deployment response is not valid UTF-8", { cause: error });
    }
    try {
      const parsed = JSON.parse(text);
      if (JSON.stringify(parsed) !== text) {
        throw new TypeError("Deployment response is not canonical JSON");
      }
      return parsed;
    } catch (error) {
      throw new TypeError("Deployment response is not valid JSON", { cause: error });
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedBody(response, maximumBytes) {
  if (response.body === null) throw new TypeError("Deployment response body is missing");
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > maximumBytes) {
        await reader.cancel();
        throw new TypeError("Deployment response body is too large");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (length === 0) throw new TypeError("Deployment response body is missing");
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function validateReadiness(value, now, maximumTimeSkewMs) {
  assertRecord(value, "Custom launch readiness response");
  if (value.schemaVersion !== READINESS_SCHEMA || value.chainId !== "1") {
    throw new TypeError("Custom launch readiness identity is invalid");
  }
  assertFreshTimestamp(value.checkedAt, now, maximumTimeSkewMs, "readiness time");
  if (value.status === "disabled") {
    assertExactKeys(value, [
      "approvalServiceRelease", "chainId", "checkedAt", "components", "release",
      "schemaVersion", "sessionAuthority", "status",
    ]);
    validateReadyComponents(value.components);
    validateReleaseIdentity(value.release);
    validateApprovalServiceReleaseIdentity(value.approvalServiceRelease);
    return Object.freeze({
      status: "disabled",
      sessionAuthorityConfigurationHash:
        validateSessionAuthorityConfiguration(value.sessionAuthority),
    });
  }
  if (value.status !== "ready") throw new TypeError("Custom launch is not ready");
  assertExactKeys(value, [
    "approvalServiceRelease",
    "chainId",
    "checkedAt",
    "components",
    "release",
    "schemaVersion",
    "sessionAuthority",
    "status",
    "trustedTimePath",
  ]);
  validateReadyComponents(value.components);
  validateReleaseIdentity(value.release);
  validateApprovalServiceReleaseIdentity(value.approvalServiceRelease);
  return Object.freeze({
    status: "ready",
    sessionAuthorityConfigurationHash:
      validateSessionAuthorityConfiguration(value.sessionAuthority),
  });
}

function validateReadyComponents(components) {
  assertRecord(components, "Custom launch readiness components");
  assertExactKeys(components, [
    "approvalService",
    "githubSessionAuthority",
    "permitSignerKeyring",
    "publicConfiguration",
    "websiteProjectionDatabase",
  ]);
  if (Object.values(components).some((component) => component !== "ready")) {
    throw new TypeError("A custom launch component is not ready");
  }
}

function validateReleaseIdentity(value) {
  assertRecord(value, "Custom launch release identity");
  assertExactKeys(value, ["commitSha", "deploymentHost"]);
  if (
    typeof value.commitSha !== "string"
    || !GIT_COMMIT_OID.test(value.commitSha)
    || typeof value.deploymentHost !== "string"
    || value.deploymentHost !== value.deploymentHost.toLowerCase()
    || !DEPLOYMENT_HOST.test(value.deploymentHost)
  ) throw new TypeError("Custom launch release identity is invalid");
}

function validateExpectedRelease(value, input) {
  validateReleaseIdentity(value);
  const expectedCommitSha = input.expectedCommitSha;
  const expectedDeploymentHost = input.expectedDeploymentHost;
  if (
    typeof expectedCommitSha !== "string"
    || !GIT_COMMIT_OID.test(expectedCommitSha)
    || value.commitSha !== expectedCommitSha
  ) throw new TypeError("Custom launch release commit does not match the reviewed candidate");
  if (
    typeof expectedDeploymentHost !== "string"
    || expectedDeploymentHost !== expectedDeploymentHost.toLowerCase()
    || !DEPLOYMENT_HOST.test(expectedDeploymentHost)
    || value.deploymentHost !== expectedDeploymentHost
  ) throw new TypeError("Custom launch deployment host does not match the reviewed candidate");
}

function validateApprovalServiceReleaseIdentity(value) {
  assertRecord(value, "Approval service release identity");
  assertExactKeys(value, ["packageArtifactHash", "reviewAuthorityMode"]);
  if (
    typeof value.packageArtifactHash !== "string"
    || !SHA256_DIGEST.test(value.packageArtifactHash)
    || !REVIEW_AUTHORITY_MODES.has(value.reviewAuthorityMode)
  ) throw new TypeError("Approval service release identity is invalid");
}

function validateExpectedApprovalServiceRelease(value, input) {
  validateApprovalServiceReleaseIdentity(value);
  const expectedPackageArtifactHash = input.expectedApprovalServicePackageArtifactHash;
  const expectedReviewAuthorityMode = input.expectedApprovalServiceReviewAuthorityMode;
  if (
    typeof expectedPackageArtifactHash !== "string"
    || !SHA256_DIGEST.test(expectedPackageArtifactHash)
    || value.packageArtifactHash !== expectedPackageArtifactHash
  ) {
    throw new TypeError(
      "Approval service package artifact does not match the reviewed backend release",
    );
  }
  if (
    !REVIEW_AUTHORITY_MODES.has(expectedReviewAuthorityMode)
    || value.reviewAuthorityMode !== expectedReviewAuthorityMode
  ) {
    throw new TypeError(
      "Approval service review authority does not match the configured release",
    );
  }
}

function validateSessionAuthorityConfiguration(value) {
  assertRecord(value, "GitHub session authority configuration");
  assertExactKeys(value, [
    "appId",
    "audience",
    "configurationHash",
    "keyEpoch",
    "keyId",
    "publicKeySpkiSha256",
    "schemaVersion",
    "workloadIssuer",
    "workloadKeyId",
    "workloadPublicKeySpkiSha256",
    "workloadSubject",
  ]);
  const binding = {
    schemaVersion:
      "programmable.github-session-authority-configuration-attestation.v1",
    appId: value.appId,
    audience: value.audience,
    keyId: value.keyId,
    keyEpoch: value.keyEpoch,
    publicKeySpkiSha256: value.publicKeySpkiSha256,
    workloadIssuer: value.workloadIssuer,
    workloadSubject: value.workloadSubject,
    workloadKeyId: value.workloadKeyId,
    workloadPublicKeySpkiSha256: value.workloadPublicKeySpkiSha256,
  };
  for (const field of [
    "appId",
    "audience",
    "keyId",
    "keyEpoch",
    "workloadIssuer",
    "workloadSubject",
    "workloadKeyId",
  ]) {
    if (typeof binding[field] !== "string" || !SAFE_ID.test(binding[field])) {
      throw new TypeError("GitHub session authority configuration is invalid");
    }
  }
  if (
    value.schemaVersion !== binding.schemaVersion
    || !SHA256_DIGEST.test(binding.publicKeySpkiSha256 ?? "")
    || !SHA256_DIGEST.test(binding.workloadPublicKeySpkiSha256 ?? "")
    || !SHA256_DIGEST.test(value.configurationHash ?? "")
    || value.configurationHash !== canonicalSha256(
      "programmable.github-session-authority-configuration-attestation.v1",
      binding,
    )
  ) throw new TypeError("GitHub session authority configuration is invalid");
  return value.configurationHash;
}

function validateExpectedSessionAuthorityConfiguration(value, input) {
  const expected = input.expectedSessionAuthorityConfigurationHash;
  if (
    typeof expected !== "string"
    || !SHA256_DIGEST.test(expected)
    || value !== expected
  ) {
    throw new TypeError(
      "GitHub session authority configuration does not match the reviewed release",
    );
  }
}

function canonicalSha256(domain, value) {
  const canonical = `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${JSON.stringify(value[key])}`).join(",")}}`;
  const hash = createHash("sha256");
  hash.update(domain, "utf8");
  hash.update(Uint8Array.of(0));
  hash.update(canonical, "utf8");
  return `sha256:${hash.digest("hex")}`;
}

function validateTrustedTime(value, now, maximumTimeSkewMs) {
  assertRecord(value, "Trusted time response");
  assertExactKeys(value, ["now", "schemaVersion"]);
  if (value.schemaVersion !== TRUSTED_TIME_SCHEMA) {
    throw new TypeError("Trusted time response identity is invalid");
  }
  assertFreshTimestamp(value.now, now, maximumTimeSkewMs, "trusted time");
}

function validatePrincipalApplicationList(value, expectedGithubUserId, ownApplicationHandle) {
  assertRecord(value, "Authenticated canary response");
  assertExactKeys(value, ["applications", "nextCursor", "schemaVersion", "subject"]);
  if (value.schemaVersion !== APPLICATION_LIST_SCHEMA) {
    throw new TypeError("Authenticated canary response identity is invalid");
  }
  assertRecord(value.subject, "Authenticated canary subject");
  assertExactKeys(value.subject, ["githubPrincipalHash", "githubUserId", "provider"]);
  if (
    value.subject.provider !== "github"
    || !isBoundedString(value.subject.githubUserId, 1, 64)
    || value.subject.githubUserId !== expectedGithubUserId
    || !SHA256_DIGEST.test(value.subject.githubPrincipalHash)
  ) throw new TypeError("Authenticated canary principal is invalid");
  if (!Array.isArray(value.applications) || value.applications.length > 100) {
    throw new TypeError("Authenticated canary application list is invalid");
  }
  const applicationHandles = new Set();
  for (const application of value.applications) {
    validateApplication(application);
    if (applicationHandles.has(application.applicationHandle)) {
      throw new TypeError("Authenticated canary application handles are not unique");
    }
    applicationHandles.add(application.applicationHandle);
  }
  const ownApplication = value.applications.find(
    (application) => application.applicationHandle === ownApplicationHandle,
  );
  if (ownApplication === undefined) {
    throw new TypeError("Authenticated canary own application is unavailable");
  }
  if (
    ownApplication.state !== "ready_for_registration"
    || ownApplication.intakeContract === "registry-v3"
    || !SHA256_DIGEST.test(ownApplication.receiptDigest ?? "")
    || !SHA256_DIGEST.test(ownApplication.launchEntitlementBindingHash ?? "")
  ) {
    throw new TypeError("Authenticated canary own application is not launch-ready");
  }
  if (value.nextCursor !== null && (
    typeof value.nextCursor !== "string" || !CURSOR.test(value.nextCursor)
  )) throw new TypeError("Authenticated canary cursor is invalid");
  return ownApplication;
}

function validateLaunchEligibility(value, application, now) {
  assertRecord(value, "Authenticated canary launch eligibility");
  assertExactKeys(value, [
    "applicationId",
    "applicationHandle",
    "grantBindingHash",
    "grantId",
    "launchAllowed",
    "receiptDigest",
    "schemaVersion",
    "state",
    "validFrom",
    "validUntil",
  ]);
  if (
    value.schemaVersion !== "programmable.launch-eligibility-view.v3"
    || value.applicationId !== application.applicationId
    || value.applicationHandle !== application.applicationHandle
    || value.grantBindingHash !== application.launchEntitlementBindingHash
    || typeof value.grantId !== "string"
    || !UUID.test(value.grantId)
    || value.state !== "active"
    || value.launchAllowed !== true
    || value.receiptDigest !== application.receiptDigest
  ) throw new TypeError("Authenticated canary launch eligibility is invalid");
  const validFrom = assertTimestamp(value.validFrom, "launch eligibility start");
  const validUntil = assertTimestamp(value.validUntil, "launch eligibility expiry");
  const current = now();
  if (
    !(current instanceof Date)
    || !Number.isFinite(current.getTime())
    || validFrom > current.getTime()
    || validUntil <= current.getTime()
    || validFrom >= validUntil
  ) throw new TypeError("Authenticated canary launch eligibility is not current");
}

function validateLaunchDescriptor(value, application, eligibility, now) {
  assertRecord(value, "Authenticated canary launch descriptor");
  assertExactKeys(value, [
    "applicationId",
    "applicationHandle",
    "configurationSchema",
    "defaultChoiceId",
    "descriptorHash",
    "grantBindingHash",
    "grantId",
    "routes",
    "schemaVersion",
    "validUntil",
  ]);
  if (
    value.schemaVersion !== "programmable.launch-route-discovery.v3"
    || value.applicationId !== application.applicationId
    || value.applicationHandle !== application.applicationHandle
    || value.grantId !== eligibility.grantId
    || value.grantBindingHash !== eligibility.grantBindingHash
    || value.grantBindingHash !== application.launchEntitlementBindingHash
    || typeof value.grantId !== "string"
    || !UUID.test(value.grantId)
    || typeof value.grantBindingHash !== "string"
    || !SHA256_DIGEST.test(value.grantBindingHash)
    || typeof value.descriptorHash !== "string"
    || !SHA256_DIGEST.test(value.descriptorHash)
    || typeof value.defaultChoiceId !== "string"
    || !SAFE_ID.test(value.defaultChoiceId)
    || !Array.isArray(value.routes)
    || value.routes.length < 1
    || value.routes.length > 64
  ) throw new TypeError("Authenticated canary launch descriptor is invalid");
  const validUntil = assertTimestamp(value.validUntil, "launch descriptor expiry");
  const current = now();
  if (
    !(current instanceof Date)
    || !Number.isFinite(current.getTime())
    || validUntil <= current.getTime()
  ) throw new TypeError("Authenticated canary launch descriptor is expired");
  validateConfigurationSchema(value.configurationSchema);
  for (const route of value.routes) validateLaunchRoute(route);
  if (!value.routes.some((route) => route.choiceId === value.defaultChoiceId)) {
    throw new TypeError("Authenticated canary default launch route is unavailable");
  }
}

function validateConfigurationSchema(value) {
  assertRecord(value, "Authenticated canary launch configuration schema");
  assertExactKeys(value, ["fields", "schemaHash", "schemaVersion"]);
  if (
    value.schemaVersion !== "programmable.launch-configuration-schema.v2"
    || typeof value.schemaHash !== "string"
    || !SHA256_DIGEST.test(value.schemaHash)
    || !Array.isArray(value.fields)
    || value.fields.length > 256
  ) throw new TypeError("Authenticated canary launch configuration schema is invalid");
  const fieldIds = new Set();
  for (const field of value.fields) {
    assertRecord(field, "Authenticated canary launch configuration field");
    assertExactKeys(field, ["fieldId", "kind", "label", "maxLength", "required"]);
    if (
      typeof field.fieldId !== "string"
      || !SAFE_ID.test(field.fieldId)
      || fieldIds.has(field.fieldId)
      || !isBoundedString(field.label, 1, 256)
      || !["text", "long-text", "url", "image-url"].includes(field.kind)
      || typeof field.required !== "boolean"
      || !Number.isSafeInteger(field.maxLength)
      || field.maxLength < 1
      || field.maxLength > 1_048_576
    ) throw new TypeError("Authenticated canary launch configuration field is invalid");
    fieldIds.add(field.fieldId);
  }
}

function validateLaunchRoute(value) {
  assertRecord(value, "Authenticated canary launch route");
  assertExactKeys(value, [
    "chainId",
    "chainProfileId",
    "choiceId",
    "executionMode",
    "launchRouteBindingHash",
    "launchRouteId",
    "routeAdapterId",
    "transactionValuePolicy",
    "walletActionKind",
    "walletExecutionKind",
  ]);
  if (
    typeof value.choiceId !== "string" || !SAFE_ID.test(value.choiceId)
    || value.chainId !== "1"
    || typeof value.chainProfileId !== "string" || !SAFE_ID.test(value.chainProfileId)
    || typeof value.launchRouteId !== "string" || !SAFE_ID.test(value.launchRouteId)
    || typeof value.launchRouteBindingHash !== "string"
    || !SHA256_DIGEST.test(value.launchRouteBindingHash)
    || typeof value.routeAdapterId !== "string" || !SAFE_ID.test(value.routeAdapterId)
    || value.executionMode !== "browser-wallet-self-submit"
    || value.walletActionKind !== "eip1193-send-transaction"
    || value.walletExecutionKind !== "eoa-direct"
  ) throw new TypeError("Authenticated canary launch route is invalid");
  assertRecord(value.transactionValuePolicy, "Authenticated canary transaction value policy");
  assertExactKeys(value.transactionValuePolicy, ["kind", "valueWei"]);
  if (
    value.transactionValuePolicy.kind !== "exact"
    || typeof value.transactionValuePolicy.valueWei !== "string"
    || !UINT256.test(value.transactionValuePolicy.valueWei)
    || BigInt(value.transactionValuePolicy.valueWei) >= (1n << 256n)
  ) throw new TypeError("Authenticated canary transaction value policy is invalid");
}

function validateForeignApplicationDenial(value) {
  assertRecord(value, "Authenticated foreign application denial");
  assertExactKeys(value, ["code", "message", "schemaVersion"]);
  if (
    value.schemaVersion !== "programmable.custom-launch-website-error.v2"
    || !isBoundedString(value.code, 1, 256)
    || !isBoundedString(value.message, 1, 2_048)
  ) throw new TypeError("Authenticated foreign application denial is invalid");
}

function validateApplication(value) {
  assertRecord(value, "Authenticated canary application");
  assertExactKeysWithOptional(value, [
    "actionCodes",
    "applicationHandle",
    "applicationId",
    "commitOid",
    "correctionCount",
    "correctionPreview",
    "launchEntitlementBindingHash",
    "pullRequestNumber",
    "reasonCodes",
    "receiptDigest",
    "repositoryFullName",
    "repositoryId",
    "repositoryOwnerId",
    "revisionId",
    "state",
    "treeOid",
    "updatedAt",
  ], [
    "controlRepositoryId",
    "controlRepositoryOwnerId",
    "grandfatheredAtReleaseBindingDigest",
    "intakeContract",
    "providerId",
  ]);
  if (
    typeof value.applicationId !== "string"
    || value.applicationId.length > 80
    || !APPLICATION_ID.test(value.applicationId)
    || typeof value.applicationHandle !== "string"
    || !APPLICATION_HANDLE.test(value.applicationHandle)
    || !isBoundedString(value.revisionId, 1, 256)
    || !isBoundedString(value.repositoryId, 1, 64)
    || !isBoundedString(value.repositoryOwnerId, 1, 64)
    || !isBoundedString(value.repositoryFullName, 3, 256)
    || !Number.isSafeInteger(value.pullRequestNumber)
    || value.pullRequestNumber < 1
    || typeof value.commitOid !== "string"
    || !GIT_COMMIT_OID.test(value.commitOid)
    || typeof value.treeOid !== "string"
    || !GIT_COMMIT_OID.test(value.treeOid)
    || !APPLICATION_STATES.has(value.state)
    || !stringArray(value.reasonCodes)
    || !stringArray(value.actionCodes)
    || !Number.isSafeInteger(value.correctionCount)
    || value.correctionCount < 0
    || !Array.isArray(value.correctionPreview)
    || value.correctionPreview.length > value.correctionCount
    || (value.receiptDigest !== null && (
      typeof value.receiptDigest !== "string" || !SHA256_DIGEST.test(value.receiptDigest)
    ))
    || (value.launchEntitlementBindingHash !== null && (
      typeof value.launchEntitlementBindingHash !== "string"
      || !SHA256_DIGEST.test(value.launchEntitlementBindingHash)
    ))
  ) throw new TypeError("Authenticated canary application is invalid");
  if (value.intakeContract === undefined) {
    if (
      value.providerId !== undefined
      || value.controlRepositoryId !== undefined
      || value.controlRepositoryOwnerId !== undefined
      || value.grandfatheredAtReleaseBindingDigest !== undefined
    ) throw new TypeError("Authenticated canary intake identity is invalid");
  } else if (value.intakeContract === "aeon-v1") {
    if (
      value.providerId !== "aeon"
      || value.controlRepositoryId !== "1325324453"
      || value.controlRepositoryOwnerId !== "309941960"
      || (value.grandfatheredAtReleaseBindingDigest !== undefined
        && value.grandfatheredAtReleaseBindingDigest !== null)
    ) throw new TypeError("Authenticated canary intake identity is invalid");
  } else if (value.intakeContract === "registry-v3") {
    if (
      (value.providerId !== undefined && value.providerId !== "programmable-registry")
      || value.controlRepositoryId !== "1320171831"
      || (value.controlRepositoryOwnerId !== undefined
        && value.controlRepositoryOwnerId !== "309941960")
      || (value.grandfatheredAtReleaseBindingDigest !== undefined
        && value.grandfatheredAtReleaseBindingDigest !== null)
    ) throw new TypeError("Authenticated canary intake identity is invalid");
  } else if (value.intakeContract === "legacy-v2") {
    if (
      value.providerId !== undefined
      || !isBoundedString(value.controlRepositoryId, 1, 64)
      || value.controlRepositoryId === "1320171831"
      || (value.controlRepositoryOwnerId !== undefined
        && !isBoundedString(value.controlRepositoryOwnerId, 1, 64))
      || (value.grandfatheredAtReleaseBindingDigest !== undefined
        && value.grandfatheredAtReleaseBindingDigest !== null
        && !SHA256_DIGEST.test(value.grandfatheredAtReleaseBindingDigest))
    ) throw new TypeError("Authenticated canary intake identity is invalid");
  } else {
    throw new TypeError("Authenticated canary intake identity is invalid");
  }
  assertTimestamp(value.updatedAt, "authenticated canary application time");
  for (const correction of value.correctionPreview) {
    assertRecord(correction, "Authenticated canary correction");
    assertExactKeys(correction, ["correctionId", "summary"]);
    if (
      !isBoundedString(correction.correctionId, 1, 256)
      || !isBoundedString(correction.summary, 1, 2_048)
    ) throw new TypeError("Authenticated canary correction is invalid");
  }
}

function exactBaseUrl(value, allowHttpLocalhost) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    throw new TypeError("Deployment URL is invalid");
  }
  const url = new URL(value);
  const localHttp = url.protocol === "http:"
    && allowHttpLocalhost
    && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !localHttp)
    || url.username !== ""
    || url.password !== ""
    || url.pathname !== "/"
    || url.search !== ""
    || url.hash !== ""
  ) throw new TypeError("Deployment URL must be an HTTPS origin");
  return new URL(url.origin);
}

function exactTrustedTimeUrl(value, baseUrl) {
  if (typeof value !== "string" || !value.startsWith("/api/custom-launch/trusted-time?")) {
    throw new TypeError("Trusted time path is invalid");
  }
  const url = new URL(value, baseUrl);
  if (
    url.origin !== baseUrl.origin
    || url.pathname !== "/api/custom-launch/trusted-time"
    || url.search === ""
    || url.username !== ""
    || url.password !== ""
    || url.hash !== ""
  ) throw new TypeError("Trusted time path is not same-origin");
  if (
    [...url.searchParams.keys()].sort().join("\0")
      !== [...TRUSTED_TIME_QUERY_KEYS].sort().join("\0")
    || TRUSTED_TIME_QUERY_KEYS.some((key) => url.searchParams.getAll(key).length !== 1)
    || !SIGNER_KEY_ID.test(url.searchParams.get("keyId") ?? "")
    || !SIGNER_EPOCH.test(url.searchParams.get("signerEpoch") ?? "")
    || !SHA256_DIGEST.test(url.searchParams.get("signerComponentBindingHash") ?? "")
    || !SHA256_DIGEST.test(url.searchParams.get("publicKeySpkiSha256") ?? "")
  ) throw new TypeError("Trusted time signer binding is invalid");
  return url;
}

function exactSecret(value, name) {
  if (
    typeof value !== "string"
    || value.trim() !== value
    || value.length === 0
    || value.length > 32_768
    || /[\r\n]/u.test(value)
  ) throw new TypeError(`Custom launch canary ${name} is unavailable`);
  return value;
}

function exactGithubUserId(value) {
  if (typeof value !== "string" || !/^[1-9][0-9]{0,19}$/u.test(value)) {
    throw new TypeError("Custom launch canary expected GitHub user id is unavailable");
  }
  return value;
}

function exactApplicationHandle(value, name) {
  if (typeof value !== "string" || !APPLICATION_HANDLE.test(value)) {
    throw new TypeError(`Custom launch canary ${name} is unavailable`);
  }
  return value;
}

function exactSettings(input) {
  const settings = {
    attempts: input.attempts ?? CUSTOM_LAUNCH_DEPLOYMENT_PROBE_DEFAULTS.attempts,
    maximumResponseBytes:
      input.maximumResponseBytes
      ?? CUSTOM_LAUNCH_DEPLOYMENT_PROBE_DEFAULTS.maximumResponseBytes,
    maximumTimeSkewMs:
      input.maximumTimeSkewMs
      ?? CUSTOM_LAUNCH_DEPLOYMENT_PROBE_DEFAULTS.maximumTimeSkewMs,
    retryDelayMs:
      input.retryDelayMs ?? CUSTOM_LAUNCH_DEPLOYMENT_PROBE_DEFAULTS.retryDelayMs,
    timeoutMs: input.timeoutMs ?? CUSTOM_LAUNCH_DEPLOYMENT_PROBE_DEFAULTS.timeoutMs,
  };
  for (const [name, value] of Object.entries(settings)) {
    if (!Number.isSafeInteger(value) || value < (name === "retryDelayMs" ? 0 : 1)) {
      throw new TypeError(`Probe ${name} is invalid`);
    }
  }
  if (settings.attempts > 20 || settings.maximumResponseBytes > 4_194_304
    || settings.maximumTimeSkewMs > 900_000 || settings.retryDelayMs > 30_000
    || settings.timeoutMs > 60_000) {
    throw new TypeError("Probe settings exceed their bounds");
  }
  return Object.freeze(settings);
}

function exactSleep(sleep) {
  if (sleep === undefined) {
    return (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
  if (typeof sleep !== "function") throw new TypeError("Probe sleep dependency is invalid");
  return sleep;
}

function assertFreshTimestamp(value, now, maximumTimeSkewMs, name) {
  const timestamp = assertTimestamp(value, name);
  const current = now();
  if (!(current instanceof Date) || !Number.isFinite(current.getTime())) {
    throw new TypeError("Probe clock returned an invalid date");
  }
  if (Math.abs(current.getTime() - timestamp) > maximumTimeSkewMs) {
    throw new TypeError(`${name} is stale`);
  }
}

function assertTimestamp(value, name) {
  if (typeof value !== "string" || !RFC3339_UTC_MILLISECONDS.test(value)) {
    throw new TypeError(`${name} is not canonical RFC3339`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== value) {
    throw new TypeError(`${name} is invalid`);
  }
  return milliseconds;
}

function assertRecord(value, name) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} is invalid`);
  }
}

function assertExactKeys(value, keys) {
  if (Object.keys(value).sort().join("\0") !== [...keys].sort().join("\0")) {
    throw new TypeError("Deployment response has an unexpected shape");
  }
}

function assertExactKeysWithOptional(value, requiredKeys, optionalKeys) {
  const actual = Object.keys(value);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (
    requiredKeys.some((key) => !Object.hasOwn(value, key))
    || actual.some((key) => !allowed.has(key))
  ) throw new TypeError("Deployment response has an unexpected shape");
}

function isBoundedString(value, minimum, maximum) {
  return typeof value === "string"
    && value.length >= minimum
    && value.length <= maximum
    && value.trim() === value;
}

function stringArray(value) {
  return Array.isArray(value)
    && value.length <= 256
    && value.every((entry) => isBoundedString(entry, 1, 256));
}

function isRetryableStatus(status) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isRetryable(error) {
  return error instanceof RetryableProbeError;
}

class RetryableProbeError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = "RetryableProbeError";
  }
}
