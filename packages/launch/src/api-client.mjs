import { assertRobinhoodInitialBuyReviewV1 } from "./initial-buy-review-v1.mjs";
import { assertRobinhoodFeeReviewV1 } from "./fee-review-v1.mjs";
import { isRobinhoodProfileV41 } from "./profile-v41.mjs";
import { normalizeRobinhoodFundingPlanV1, assertRobinhoodFundingPlanDeployableV1 } from "./funding-plan-v1.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  API_ORIGIN,
  CAPABILITIES_PATH_TEMPLATE_V4,
  CAPABILITIES_SCHEMA_V2,
  CAPABILITIES_PATH_V3,
  CREATE_PATH_V1,
  CREATE_PATH_V2,
  CREATE_PATH_V3,
  CREATE_PATH_TEMPLATE_V4,
  CREATE_REQUEST_SCHEMA_V3,
  CREATE_REQUEST_SCHEMA_V4,
  CUSTOM_LAUNCH_RESOURCE_SCHEMA_V4,
  DIRECT_NATIVE_PROFILE_ID,
  DIRECT_NATIVE_PROFILE_REVISION,
  DIRECT_NATIVE_PROFILE_VERSION,
  MAX_REQUEST_BYTES,
  MAX_REQUEST_BYTES_V4,
  PERMIT_REISSUE_CAPABILITY_SCHEMA_V1,
  PERMIT_REISSUE_DISPOSITION_SCHEMA_V1,
  PERMIT_REISSUE_PATH_TEMPLATE_V3,
  PERMIT_REISSUE_REQUEST_SCHEMA_V1,
  PREFLIGHT_PATH_V3,
  PREFLIGHT_PATH_TEMPLATE_V4,
  PREFLIGHT_SCHEMA_V1,
  PREFLIGHT_SCHEMA_V2,
  EXACT_WALLET_TRANSACTION_SCHEMA_V4,
  ONCHAIN_EVIDENCE_SCHEMA_V2,
  ONCHAIN_EVIDENCE_SCHEMA_V3,
  HOOK_PERMISSIONS,
  ROBINHOOD_CAIP2,
  ROBINHOOD_CHAIN_ID,
  TERMINAL_STATUSES,
  WALLET_HANDOFF_BASE_URL,
  WALLET_HANDOFF_STATUS,
  V4_IDEMPOTENCY_DOMAIN,
  V4_SUBMIT_JOURNAL_SCHEMA,
} from "./constants.mjs";
import {
  assertExactKeys,
  atomicCreate,
  atomicWrite,
  decodeExactUtf8,
  defaultStateDirectory,
  loadApiKey,
  readStrictJsonFile,
  sha256Digest,
  sha256Hex,
} from "./io.mjs";
import { canonicalizeJson, parseStrictJson } from "./canonical-json.mjs";
import {
  ApiResponseContractError,
  MAX_API_CONTROL_RESPONSE_BYTES,
  MAX_API_RESOURCE_RESPONSE_BYTES,
  readApiResponse,
} from "./api-response.mjs";
import { validateDirectNativePermitWindow } from "./profile-direct-native-v1.mjs";
import { validateLaunchFile } from "./validate.mjs";
import {
  assertV4DeploymentDescriptorDigest,
  customLaunchRequestHashV4,
  normalizeV4ChainDeployment,
  normalizeV4FundingIntent,
  normalizeV4LiquidityModel,
  normalizeV4ProfileRef,
} from "./v4-contract.mjs";
import { validateProjectMetadata } from "./project-metadata.mjs";
import { assertCanonicalWalletTransactionCalldataV4 } from "./wallet-transaction-v4.mjs";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_API_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const NONZERO_HEX32 = /^0x(?!0{64}$)[0-9a-f]{64}$/u;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/u;
const DECIMAL_UINT = /^(?:0|[1-9][0-9]*)$/u;
const POSITIVE_DECIMAL_UINT = /^[1-9][0-9]*$/u;
const MAX_LOG_INDEX = 2_147_483_647;
const ROBINHOOD_EXACT_SOURCE_BINDING_COVERED_EVIDENCE = Object.freeze([
  "protected-source-tree",
  "source-closure",
  "hosted-build-artifact",
  "standard-json-input",
  "compiler-binary",
  "compiler-settings",
  "finalized-creation-transaction",
  "creation-bytecode",
  "runtime-bytecode",
]);
const PROFILE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const PARTNER_API_KEY =
  /^pm_partner_(?:root_)?[A-Za-z0-9_-]{22}_[A-Za-z0-9_-]{43}$/u;
const MAX_SUBMISSION_JOURNAL_BYTES = 12_582_912;
const MAX_SUBMISSION_JOURNAL_BYTES_V4 = 33_554_432;
const PREFLIGHT_DISPOSITIONS = new Set([
  "supported",
  "supported_with_warnings",
  "needs_evidence",
  "unsupported",
  "system_blocked",
]);
const V4_EVIDENCE_TIERS = new Set([
  "launch_mechanics_verified",
  "standard_swap_compatible",
  "advanced_custom_accounting",
  "governed_external_trust",
]);
const V4_RESOURCE_STATUSES = new Set([
  "received",
  "validating",
  "action_required",
  "authorized",
  "awaiting_wallet_signature",
  "wallet_action_required",
  "submitted",
  "sequencer_soft_confirmed",
  "ethereum_posted",
  "finalized",
  "failed",
]);
const REMEDIATION_SCHEMA_V1 = "programmable.custom-launch-remediation.v1";

export class ProgrammableApiError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ProgrammableApiError";
    this.details = details;
  }
}

export async function getLaunchCapabilities(options = {}) {
  const apiOrigin = productionApiOrigin(options.apiOrigin);
  const apiVersion = normalizeApiVersion(options.apiVersion ?? 3);
  const chainId = apiVersion === 4
    ? normalizeV4ChainId(options.chainId)
    : undefined;
  const capabilitiesPath = apiVersion === 4
    ? v4Path(CAPABILITIES_PATH_TEMPLATE_V4, chainId)
    : CAPABILITIES_PATH_V3;
  const result = await requestWithRetry({
    method: "GET",
    url: `${apiOrigin}${capabilitiesPath}`,
    maximumResponseBytes: MAX_API_CONTROL_RESPONSE_BYTES,
    headers: { accept: "application/json" },
    maxAttempts: options.maxAttempts,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
    retryExplicit503Only: apiVersion === 4,
  });
  if (apiVersion === 4) {
    assertCapabilitiesResponseV4(result.body, { chainId });
  } else {
    assertCapabilitiesResponse(result.body);
  }
  return {
    httpStatus: result.status,
    retryAfter: result.retryAfter,
    resource: result.body,
  };
}

export async function validateLaunchRemote(options) {
  const launchPath = path.resolve(options.launchPath);
  const validation = await (options.validateLaunchFileImpl ?? validateLaunchFile)({
    launchPath,
    configPath: options.configPath,
  });
  const requestBytes = Buffer.from(await (options.readLaunchBytesImpl ?? readFile)(launchPath));
  const requestSha256 = sha256Digest(requestBytes);
  if (requestSha256 !== validation.requestSha256) {
    throw new TypeError(
      "REMOTE_VALIDATION_BYTES_CHANGED: launch.json changed after exact local validation",
    );
  }
  if (validation.schemaVersion !== CREATE_REQUEST_SCHEMA_V3
    && validation.schemaVersion !== CREATE_REQUEST_SCHEMA_V4) {
    throw new TypeError("remote preflight is available only for V3 or V4 Custom launch requests");
  }
  const isV4 = validation.schemaVersion === CREATE_REQUEST_SCHEMA_V4;
  const request = isV4
    ? parseV4RequestBytes(requestBytes)
    : null;
  const chainId = isV4 ? normalizeV4ChainId(request.chainId) : undefined;
  const serverRequestHash = isV4
    ? customLaunchRequestHashV4(request)
    : customLaunchRequestHashV3(requestBytes);

  const apiOrigin = productionApiOrigin(options.apiOrigin);
  const capabilities = await getLaunchCapabilities({
    apiOrigin,
    ...(isV4 ? { apiVersion: 4, chainId } : {}),
    maxAttempts: options.maxAttempts,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
  });
  if (isV4) assertV4RequestMatchesCapabilities(request, capabilities.resource);
  const apiKey = await (options.loadApiKeyImpl ?? loadApiKey)();
  const preflightPath = isV4
    ? v4Path(PREFLIGHT_PATH_TEMPLATE_V4, chainId)
    : PREFLIGHT_PATH_V3;
  const result = await requestWithRetry({
    method: "POST",
    url: `${apiOrigin}${preflightPath}`,
    maximumResponseBytes: MAX_API_CONTROL_RESPONSE_BYTES,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: requestBytes,
    maxAttempts: options.maxAttempts,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
    retryExplicit503Only: isV4,
  });
  if (isV4) {
    assertPreflightResponseV4(result.body, {
      requestHash: serverRequestHash,
      rawRequestSha256: validation.requestSha256,
      request,
    });
  } else {
    assertPreflightResponse(result.body, serverRequestHash);
  }
  const action = resourceActionSummary(result.body, {
    apiOrigin,
    walletHandoffBaseUrl: capabilities.resource.walletHandoffBaseUrl,
  });
  return {
    ...validation,
    remoteValidation: true,
    apiVersion: isV4 ? "v4" : "v3",
    capabilitiesHttpStatus: capabilities.httpStatus,
    preflightHttpStatus: result.status,
    capabilities: capabilities.resource,
    preflight: result.body,
    disposition: result.body.disposition,
    launchEligibility: result.body.launchEligibility,
    evidenceTier: result.body.evidenceTier,
    hardBlockFindingCodes: result.body.hardBlockFindingCodes,
    needsEvidenceFindingCodes: result.body.needsEvidenceFindingCodes,
    warningFindingCodes: result.body.warningFindingCodes,
    remediations: result.body.remediations,
    ...action,
  };
}

function customLaunchRequestHashV3(requestBytes) {
  const source = decodeExactUtf8(requestBytes, "V3 launch request");
  const request = parseStrictJson(source, { maximumBytes: MAX_REQUEST_BYTES });
  if (!isPlainObject(request) || request.schemaVersion !== CREATE_REQUEST_SCHEMA_V3) {
    throw new TypeError(`request schemaVersion must be ${CREATE_REQUEST_SCHEMA_V3}`);
  }
  return sha256Digest(Buffer.concat([
    Buffer.from(request.schemaVersion, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(request), "utf8"),
  ]));
}

export async function submitLaunch(options) {
  const launchPath = path.resolve(options.launchPath);
  if (typeof options.configPath !== "string" || options.configPath.length === 0) {
    throw new TypeError("submit requires --config so exact source and build artifacts are freshly repacked");
  }
  const validation = await (options.validateLaunchFileImpl ?? validateLaunchFile)({
    launchPath,
    configPath: options.configPath,
  });
  if (validation.schemaVersion !== CREATE_REQUEST_SCHEMA_V3
    && validation.schemaVersion !== CREATE_REQUEST_SCHEMA_V4) {
    throw new TypeError(
      `LEGACY_SUBMISSION_READ_ONLY: V1 and V2 launch creation are read-only; submit a ${CREATE_REQUEST_SCHEMA_V3} Ethereum request or ${CREATE_REQUEST_SCHEMA_V4} chain-bound request`,
    );
  }
  const requestBytes = Buffer.from(await (options.readLaunchBytesImpl ?? readFile)(launchPath));
  const requestSha256 = sha256Digest(requestBytes);
  if (requestSha256 !== validation.requestSha256) {
    throw new TypeError(
      "SUBMISSION_BYTES_CHANGED_AFTER_VALIDATION: launch.json changed after exact config validation",
    );
  }
  const isV4 = validation.schemaVersion === CREATE_REQUEST_SCHEMA_V4;
  const request = isV4 ? parseV4RequestBytes(requestBytes) : null;
  if (isV4 && isRobinhoodProfileV41(normalizeV4ProfileRef(request.profile))) {
    assertRobinhoodFundingPlanDeployableV1(request.fundingPlan, request.funding);
  }
  const localCommitments = isV4
    ? exactLocalV4Commitments(validation, request)
    : null;
  const localArtifactBindings = isV4
    ? exactLocalV4ArtifactBindings(validation, request, localCommitments)
    : null;
  const chainId = isV4 ? normalizeV4ChainId(request.chainId) : undefined;
  const requestPath = isV4
    ? v4Path(CREATE_PATH_TEMPLATE_V4, chainId)
    : CREATE_PATH_V3;
  const idempotencyKey = normalizeIdempotencyKey(
    options.idempotencyKey ?? (isV4
      ? `${V4_IDEMPOTENCY_DOMAIN}-${sha256Hex(requestBytes)}`
      : `programmable-${sha256Hex(requestBytes)}`),
  );
  const apiOrigin = productionApiOrigin(options.apiOrigin);
  const capabilities = await getLaunchCapabilities({
      apiOrigin,
      ...(isV4 ? { apiVersion: 4, chainId } : {}),
      maxAttempts: options.maxAttempts,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
      sleepImpl: options.sleepImpl,
    });

  const stateDirectory = path.resolve(options.stateDirectory ?? defaultStateDirectory());
  const journalPath = path.join(
    stateDirectory,
    "submissions",
    `${sha256Hex(Buffer.from(idempotencyKey, "utf8"))}.json`,
  );
  const binding = isV4 ? {
    schemaVersion: V4_SUBMIT_JOURNAL_SCHEMA,
    apiVersion: "v4",
    chainId,
    caip2: request.caip2,
    apiOrigin,
    requestPath,
    idempotencyKey,
    rawRequestSha256: requestSha256,
    exactRequestBytesBase64: requestBytes.toString("base64"),
    launchId: null,
    status: null,
    lastResponse: null,
  } : {
    schemaVersion: "programmable.launch-submit-journal.v1",
    apiOrigin,
    requestPath,
    idempotencyKey,
    requestSha256,
    requestBodyBase64: requestBytes.toString("base64"),
    lastResponse: null,
  };
  let requestCapabilities = capabilities.resource;
  if (isV4) {
    const oldProfile = normalizeV4ProfileRef(request.profile);
    if (!isRobinhoodProfileV41(oldProfile) && isRobinhoodProfileV41(capabilities.resource.profile)) {
      let existing;
      try { existing = (await readStrictJsonFile(journalPath, MAX_SUBMISSION_JOURNAL_BYTES_V4)).value; }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
      if (existing !== undefined) {
        assertJournalBinding(existing, binding);
        // Only byte-identical historical retries use their original profile. The server
        // still owns replay lookup and rejects fresh old-profile requests.
        requestCapabilities = { ...capabilities.resource, profile: oldProfile };
      }
    }
    assertV4RequestMatchesCapabilities(request, requestCapabilities);
  }
  const journal = await bindJournal(journalPath, binding);
  const apiKey = await (options.loadApiKeyImpl ?? loadApiKey)();
  const result = await requestWithRetry({
    method: "POST",
    url: `${apiOrigin}${requestPath}`,
    maximumResponseBytes: MAX_API_RESOURCE_RESPONSE_BYTES,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "idempotency-key": idempotencyKey,
    },
    body: Buffer.from(
      isV4 ? journal.exactRequestBytesBase64 : journal.requestBodyBase64,
      "base64",
    ),
    maxAttempts: options.maxAttempts,
    timeoutMs: options.timeoutMs,
    fetchImpl: options.fetchImpl,
    sleepImpl: options.sleepImpl,
    retryExplicit503Only: isV4,
  });
  if (isV4) {
    assertV4LaunchResource(result.body, {
      request,
      rawRequestSha256: requestSha256,
      capabilities: requestCapabilities,
      localCommitments,
      localArtifactBindings,
    });
  }
  await updateJournal(journalPath, journal, result, { isV4 });
  const action = resourceActionSummary(result.body, {
    walletHandoffBaseUrl: capabilities?.resource.walletHandoffBaseUrl,
  });
  return {
    idempotencyKey,
    requestSha256,
    ...(isV4 ? { apiVersion: "v4", chainId, caip2: request.caip2 } : {}),
    ...(isV4 && Object.hasOwn(result.body, "sourceVerification")
      ? { sourceVerification: result.body.sourceVerification }
      : {}),
    journalPath,
    ...(Array.isArray(validation.diagnostics) && validation.diagnostics.length !== 0
      ? { diagnostics: validation.diagnostics }
      : {}),
    httpStatus: result.status,
    retryAfter: result.retryAfter,
    resource: result.body,
    ...action,
  };
}

export async function statusLaunch(options) {
  if (typeof options.requestId !== "string" || !REQUEST_ID.test(options.requestId)) {
    throw new TypeError("status requires the Custom launch request UUID");
  }
  const apiOrigin = productionApiOrigin(options.apiOrigin);
  const apiVersion = normalizeApiVersion(options.apiVersion ?? 3);
  const chainId = apiVersion === 4 ? normalizeV4ChainId(options.chainId) : undefined;
  const requestPath = createPathForApiVersion(apiVersion, chainId);
  const capabilities = apiVersion === 4
    ? await getLaunchCapabilities({
        apiOrigin,
        apiVersion,
        chainId,
        maxAttempts: options.maxAttempts,
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl,
        sleepImpl: options.sleepImpl,
      })
    : null;
  const apiKey = await (options.loadApiKeyImpl ?? loadApiKey)();
  const until = options.until ?? WALLET_HANDOFF_STATUS;
  if (until !== WALLET_HANDOFF_STATUS && until !== "finalized") {
    throw new TypeError("--until must be authorized or finalized");
  }
  const pollIntervalMs = options.pollIntervalMs ?? 5_000;
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 250) {
    throw new TypeError("poll interval must be at least 250 milliseconds");
  }
  while (true) {
    const result = await requestWithRetry({
      method: "GET",
      url: `${apiOrigin}${requestPath}/${encodeURIComponent(options.requestId)}`,
      maximumResponseBytes: MAX_API_RESOURCE_RESPONSE_BYTES,
      headers: { authorization: `Bearer ${apiKey}` },
      maxAttempts: options.maxAttempts,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
      sleepImpl: options.sleepImpl,
      retryExplicit503Only: apiVersion === 4,
    });
    const resource = result.body;
    if (apiVersion === 4) {
      assertV4LaunchResource(resource, {
        chainId,
        capabilities: capabilities.resource,
      });
    }
    const status = resource?.status;
    if (typeof status !== "string") {
      throw new ProgrammableApiError("Custom Launch API returned a resource without status", {
        httpStatus: result.status,
        requestId: errorRequestId(resource),
      });
    }
    const walletHandoffReady = status === WALLET_HANDOFF_STATUS
      || (apiVersion === 4 && new Set([
        "wallet_action_required",
        "awaiting_wallet_signature",
      ]).has(status))
      || (requestPath === CREATE_PATH_V3 && status === "awaiting_funding_authorization");
    const reviewPending = (requestPath === CREATE_PATH_V3 || apiVersion === 4)
      && status === "pending_review";
    const reviewActionRequired = (requestPath === CREATE_PATH_V3 || apiVersion === 4)
      && status === "action_required";
    const stopped = TERMINAL_STATUSES.has(status)
      || reviewActionRequired
      || (until === WALLET_HANDOFF_STATUS && walletHandoffReady)
      || (until === "finalized" && status === "finalized");
    if (!options.watch || stopped) {
      const action = resourceActionSummary(resource);
      const permitRecovery = apiVersion === 3
        ? permitRecoverySummary(resource, {
            permitReissueInspectionAvailable: !PARTNER_API_KEY.test(apiKey),
          })
        : null;
      return {
        ...(apiVersion === 4
          ? { apiVersion: "v4", chainId, caip2: ROBINHOOD_CAIP2 }
          : {}),
        ...(apiVersion === 4 && Object.hasOwn(resource, "sourceVerification")
          ? { sourceVerification: resource.sourceVerification }
          : {}),
        httpStatus: result.status,
        stopped,
        terminal: TERMINAL_STATUSES.has(status),
        reviewPending,
        reviewActionRequired,
        walletHandoffReady,
        walletHandoffStage: status === "awaiting_funding_authorization"
          ? "funding-signature-required"
          : walletHandoffReady
            ? "router-transaction-required"
            : null,
        resource,
        ...(permitRecovery === null ? {} : { permitRecovery }),
        ...action,
      };
    }
    await (options.sleepImpl ?? sleep)(pollIntervalMs);
  }
}

/**
 * Requests the deployed-contract permit-reissue disposition. Router V1 has no
 * successful reissue path, so a conforming current server answers with a typed
 * 409 that remains available on ProgrammableApiError.details.serverDetails.
 */
export async function requestPermitReissueDisposition(options) {
  if (typeof options?.launchId !== "string" || !REQUEST_ID.test(options.launchId)) {
    throw new TypeError("permit reissue disposition requires the Custom launch UUID");
  }
  if (typeof options.expectedRequestHash !== "string"
    || !SHA256.test(options.expectedRequestHash)) {
    throw new TypeError("expectedRequestHash must be a lowercase sha256 digest");
  }
  if (typeof options.expectedLaunchIntentHash !== "string"
    || !SHA256.test(options.expectedLaunchIntentHash)) {
    throw new TypeError("expectedLaunchIntentHash must be a lowercase sha256 digest");
  }
  if (typeof options.replacementNonce !== "string"
    || !NONZERO_HEX32.test(options.replacementNonce)) {
    throw new TypeError("replacementNonce must be a nonzero lowercase 0x-prefixed 32-byte value");
  }
  const replacementPermitWindow = validateDirectNativePermitWindow(
    options.replacementPermitWindow,
  );
  const idempotencyKey = normalizeIdempotencyKey(options.idempotencyKey);
  const request = {
    schemaVersion: PERMIT_REISSUE_REQUEST_SCHEMA_V1,
    expectedRequestHash: options.expectedRequestHash,
    expectedLaunchIntentHash: options.expectedLaunchIntentHash,
    replacementNonce: options.replacementNonce,
    replacementPermitWindow,
  };
  const apiOrigin = productionApiOrigin(options.apiOrigin);
  const apiKey = await (options.loadApiKeyImpl ?? loadApiKey)();
  if (PARTNER_API_KEY.test(apiKey)) {
    throw new ProgrammableApiError(
      "Router V1 permit-reissue disposition is available only to wallet API keys; partner launches recover by packing and submitting a new request",
      {
        code: "PERMIT_REISSUE_WALLET_KEY_REQUIRED",
        expectedCredentialKind: "wallet",
      },
    );
  }
  const requestPath = PERMIT_REISSUE_PATH_TEMPLATE_V3.replace(
    "{launchId}",
    encodeURIComponent(options.launchId),
  );
  try {
    const result = await requestWithRetry({
      method: "POST",
      url: `${apiOrigin}${requestPath}`,
      maximumResponseBytes: MAX_API_CONTROL_RESPONSE_BYTES,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        "idempotency-key": idempotencyKey,
      },
      body: Buffer.from(canonicalizeJson(request), "utf8"),
      maxAttempts: options.maxAttempts,
      timeoutMs: options.timeoutMs,
      fetchImpl: options.fetchImpl,
      sleepImpl: options.sleepImpl,
    });
    throw new ProgrammableApiError(
      "Custom Launch API returned a success response for an unsupported Router V1 permit reissue",
      {
        code: "PERMIT_REISSUE_CONTRACT_INVALID",
        httpStatus: result.status,
        serverDetails: { expectedHttpStatus: 409 },
      },
    );
  } catch (error) {
    if (!(error instanceof ProgrammableApiError) || error.details?.httpStatus !== 409) throw error;
    const allowedCodes = new Set([
      "PERMIT_REISSUE_UNSUPPORTED",
      "PERMIT_REISSUE_NOT_APPLICABLE",
      "PERMIT_REISSUE_RESOURCE_BINDING_MISMATCH",
    ]);
    if (!allowedCodes.has(error.details.code)
      || error.details.serverDetails?.schemaVersion
        !== PERMIT_REISSUE_DISPOSITION_SCHEMA_V1) {
      throw new ProgrammableApiError(
        "Custom Launch API returned an invalid permit-reissue disposition",
        {
          code: "PERMIT_REISSUE_CONTRACT_INVALID",
          httpStatus: 409,
          serverDetails: { observedCode: error.details.code ?? null },
        },
      );
    }
    throw error;
  }
}

async function bindJournal(journalPath, binding) {
  try {
    await atomicCreate(
      journalPath,
      Buffer.from(`${canonicalizeJson(binding)}\n`, "utf8"),
      0o600,
    );
    return binding;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  const existing = (await readStrictJsonFile(
    journalPath,
    binding.schemaVersion === V4_SUBMIT_JOURNAL_SCHEMA
      ? MAX_SUBMISSION_JOURNAL_BYTES_V4
      : MAX_SUBMISSION_JOURNAL_BYTES,
  )).value;
  assertJournalBinding(existing, binding);
  return existing;
}

function assertJournalBinding(existing, binding) {
  const bindingKeys = binding.schemaVersion === V4_SUBMIT_JOURNAL_SCHEMA
    ? [
        "schemaVersion",
        "apiVersion",
        "chainId",
        "caip2",
        "apiOrigin",
        "requestPath",
        "idempotencyKey",
        "rawRequestSha256",
        "exactRequestBytesBase64",
      ]
    : [
        "schemaVersion",
        "apiOrigin",
        "requestPath",
        "idempotencyKey",
        "requestSha256",
        "requestBodyBase64",
      ];
  for (const key of bindingKeys) {
    if (existing[key] !== binding[key]) {
      throw new TypeError(
        `IDEMPOTENCY_BINDING_CONFLICT: ${binding.idempotencyKey} is already bound to different request bytes, route, chain, API version, or origin`,
      );
    }
  }
}

async function updateJournal(journalPath, journal, result, { isV4 = false } = {}) {
  const publicResponse = {
    httpStatus: result.status,
    retryAfter: result.retryAfter,
    requestId: result.body?.requestId ?? result.body?.launchId ?? errorRequestId(result.body),
    status: result.body?.status ?? null,
  };
  const updated = isV4 ? {
    ...journal,
    launchId: result.body?.launchId ?? result.body?.requestId ?? null,
    status: result.body?.status ?? null,
    lastResponse: publicResponse,
  } : { ...journal, lastResponse: publicResponse };
  await atomicWrite(
    journalPath,
    Buffer.from(`${canonicalizeJson(updated)}\n`, "utf8"),
    0o600,
  );
}

async function requestWithRetry(options) {
  const maxAttempts = options.maxAttempts ?? 5;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    throw new TypeError("maxAttempts must be between 1 and 20");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 300_000) {
    throw new TypeError("timeoutMs must be between 250 and 300000 milliseconds");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleepImpl = options.sleepImpl ?? sleep;
  let timedOut = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("request timed out")), timeoutMs);
    let response;
    let retryAfter = null;
    let body;
    try {
      response = await fetchImpl(options.url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
        redirect: "error",
        signal: controller.signal,
      });
      retryAfter = response.headers.get("retry-after");
      body = await readApiResponse(response, {
        maximumBytes: options.maximumResponseBytes,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof ApiResponseContractError) {
        throw new ProgrammableApiError("Custom Launch API returned an invalid response body", {
          code: error.code,
          httpStatus: response.status,
          retryAfter: safeRetryAfter(retryAfter),
        });
      }
      timedOut = controller.signal.aborted;
      if (attempt === maxAttempts) break;
      await sleepImpl(retryDelayMs(retryAfter, attempt));
      continue;
    } finally {
      clearTimeout(timeout);
    }
    const retryable503 = response.status === 503
      && (!options.retryExplicit503Only || explicitlyRetryable503(body));
    if (response.status === 503 && options.retryExplicit503Only && !retryable503) {
      throw apiError(response.status, body, retryAfter);
    }
    if (response.status === 429 || retryable503) {
      if (attempt === maxAttempts) {
        throw apiError(response.status, body, retryAfter);
      }
      await sleepImpl(retryDelayMs(retryAfter, attempt));
      continue;
    }
    if (!response.ok) throw apiError(response.status, body, retryAfter);
    return { status: response.status, retryAfter, body };
  }
  throw new ProgrammableApiError("Custom Launch API request remained ambiguous after identical retries", {
    code: "AMBIGUOUS_TRANSPORT_RESULT",
    cause: timedOut ? "REQUEST_TIMEOUT" : "TRANSPORT_FAILURE",
  });
}

function apiError(status, body, retryAfter) {
  const error = body?.error ?? body;
  const serverDetails = isJsonValue(error?.details) ? error.details : undefined;
  const remediations = typedRemediations(
    error?.remediations
      ?? (isPlainObject(serverDetails) ? serverDetails.remediations : undefined)
      ?? body?.remediations,
  );
  const action = resourceActionSummary(error);
  return new ProgrammableApiError(
    `Custom Launch API returned HTTP ${status}`,
    {
      httpStatus: status,
      code: safeApiCode(error?.code),
      requestId: safeErrorRequestId(error?.requestId),
      retryAfter: safeRetryAfter(retryAfter),
      ...(serverDetails === undefined ? {} : { serverDetails }),
      ...(remediations === null ? {} : { remediations }),
      ...action,
    },
  );
}

function assertPreflightResponse(value, requestHash) {
  assertResponseObject(value, "preflight");
  assertPreflightField(value.schemaVersion === PREFLIGHT_SCHEMA_V1, "schemaVersion");
  assertPreflightField(value.requestHash === requestHash, "requestHash");
  assertPreflightField(
    value.profileRevision === DIRECT_NATIVE_PROFILE_REVISION,
    "profileRevision",
  );
  assertPreflightField(
    typeof value.serverTime === "string" && Number.isFinite(Date.parse(value.serverTime)),
    "serverTime",
  );
  assertPreflightField(PREFLIGHT_DISPOSITIONS.has(value.disposition), "disposition");
  assertPreflightField(isPlainObject(value.launchEligibility), "launchEligibility");
  for (const field of ["deployable", "routable", "featured"]) {
    assertPreflightField(typeof value.launchEligibility[field] === "boolean", `launchEligibility.${field}`);
  }
  assertPreflightField(
    typeof value.evidenceTier === "string" && value.evidenceTier.length > 0,
    "evidenceTier",
  );
  for (const field of [
    "hardBlockFindingCodes",
    "needsEvidenceFindingCodes",
    "warningFindingCodes",
  ]) {
    assertPreflightField(isCodeArray(value[field]), field);
  }
  assertPreflightField(
    value.staticBaseline === null || isPlainObject(value.staticBaseline),
    "staticBaseline",
  );
  assertPreflightField(typedRemediations(value.remediations) !== null, "remediations");
  for (const [field, expected] of [
    ["quotaConsumed", false],
    ["nonceAllocated", false],
    ["persisted", false],
    ["walletSignatureRequiredLater", true],
    ["walletBroadcastByService", false],
  ]) {
    assertPreflightField(value[field] === expected, field);
  }
}

function assertPreflightResponseV4(value, {
  requestHash,
  rawRequestSha256,
  request,
}) {
  assertResponseObject(value, "V4 preflight");
  assertV4ExactKeys(value, [
    "schemaVersion",
    "apiVersion",
    "chainId",
    "caip2",
    "requestHash",
    "rawRequestSha256",
    "chainDeploymentId",
    "chainDeploymentDescriptorDigest",
    "profile",
    "serverTime",
    "disposition",
    "launchEligibility",
    "evidenceTier",
    "hardBlockFindingCodes",
    "needsEvidenceFindingCodes",
    "warningFindingCodes",
    "remediations",
    "gates",
    "quotaConsumed",
    "nonceAllocated",
    "persisted",
    "walletSignatureRequiredLater",
    "walletBroadcastByService",
  ], "preflight");
  const expected = {
    schemaVersion: PREFLIGHT_SCHEMA_V2,
    apiVersion: "v4",
    chainId: request.chainId,
    caip2: request.caip2,
    requestHash,
    rawRequestSha256,
    chainDeploymentId: request.chainDeployment.chainDeploymentId,
    chainDeploymentDescriptorDigest: request.chainDeploymentDescriptorDigest,
  };
  for (const [field, fieldValue] of Object.entries(expected)) {
    assertPreflightV4Field(value[field] === fieldValue, field);
  }
  assertPreflightV4Field(
    canonicalizeJson(normalizeV4ProfileRef(value.profile))
      === canonicalizeJson(normalizeV4ProfileRef(request.profile)),
    "profile",
  );
  assertPreflightV4Field(
    typeof value.serverTime === "string" && Number.isFinite(Date.parse(value.serverTime)),
    "serverTime",
  );
  assertPreflightV4Field(PREFLIGHT_DISPOSITIONS.has(value.disposition), "disposition");
  assertPreflightV4Field(isPlainObject(value.launchEligibility), "launchEligibility");
  assertV4ExactKeys(
    value.launchEligibility,
    ["deployable", "routable", "featured"],
    "preflight.launchEligibility",
  );
  assertPreflightV4Field(
    typeof value.launchEligibility.deployable === "boolean"
      && typeof value.launchEligibility.routable === "boolean"
      && value.launchEligibility.featured === false,
    "launchEligibility",
  );
  assertPreflightV4Field(V4_EVIDENCE_TIERS.has(value.evidenceTier), "evidenceTier");
  for (const field of [
    "hardBlockFindingCodes",
    "needsEvidenceFindingCodes",
    "warningFindingCodes",
  ]) {
    assertPreflightV4Field(isCodeArray(value[field]), field);
  }
  assertPreflightV4Field(Array.isArray(value.remediations), "remediations");
  for (const [index, remediation] of value.remediations.entries()) {
    assertV4ExactKeys(
      remediation,
      ["code", "requiredChange", "retryable"],
      `preflight.remediations[${index}]`,
    );
    assertPreflightV4Field(
      nonemptyString(remediation.code)
        && nonemptyString(remediation.requiredChange)
        && typeof remediation.retryable === "boolean",
      `remediations[${index}]`,
    );
  }
  assertV4ExactKeys(value.gates, [
    "chainBinding",
    "trustRoots",
    "sourceBuild",
    "graph",
    "metadata",
    "fundingSettlement",
    "deterministicValidation",
    "chainSimulation",
  ], "preflight.gates");
  assertPreflightV4Field(
    Object.values(value.gates).every((gate) => gate === "passed" || gate === "failed"),
    "gates",
  );
  for (const [field, fieldValue] of Object.entries({
    quotaConsumed: false,
    nonceAllocated: false,
    persisted: false,
    walletSignatureRequiredLater: true,
    walletBroadcastByService: false,
  })) {
    assertPreflightV4Field(value[field] === fieldValue, field);
  }
}

function assertCapabilitiesResponseV4(value, { chainId }) {
  assertCapabilitiesV4Field(isPlainObject(value), "$", value);
  assertV4ExactKeys(value, [
    "schemaVersion",
    "apiVersion",
    "serverTime",
    "readinessUrl",
    "chain",
    "chainDeployment",
    "chainDeploymentDescriptorDigest",
    "profile",
    "routes",
    "authentication",
    "graph",
    "funding",
    "metadataImage",
    "toolchains",
    "readiness",
    "safety",
    "walletHandoff",
  ], "capabilities");
  for (const [field, expected] of Object.entries({
    schemaVersion: CAPABILITIES_SCHEMA_V2,
    apiVersion: "v4",
  })) {
    assertCapabilitiesV4Field(value[field] === expected, field);
  }
  assertCapabilitiesV4Field(
    typeof value.serverTime === "string" && Number.isFinite(Date.parse(value.serverTime)),
    "serverTime",
  );
  assertCapabilitiesV4Field(value.readinessUrl === "/readyz", "readinessUrl");
  assertCapabilitiesV4Field(isPlainObject(value.chain), "chain");
  assertV4ExactKeys(value.chain, ["id", "caip2", "name"], "capabilities.chain");
  for (const [field, expected] of Object.entries({
    id: chainId,
    caip2: ROBINHOOD_CAIP2,
    name: "Robinhood Chain Mainnet",
  })) {
    assertCapabilitiesV4Field(value.chain?.[field] === expected, `chain.${field}`);
  }
  const rootsUnavailable = value.chainDeployment === null
    && value.chainDeploymentDescriptorDigest === null
    && value.profile === null;
  const rootsReady = value.chainDeployment !== null
    && value.chainDeploymentDescriptorDigest !== null
    && value.profile !== null;
  assertCapabilitiesV4Field(rootsUnavailable || rootsReady, "chainDeployment");
  if (rootsReady) {
    const deployment = normalizeV4ChainDeployment(value.chainDeployment);
    assertCapabilitiesV4Field(
      value.chainDeploymentDescriptorDigest === assertV4DeploymentDescriptorDigest(
        value.chainDeploymentDescriptorDigest,
        deployment,
      ),
      "chainDeploymentDescriptorDigest",
    );
    normalizeV4ProfileRef(value.profile);
  }
  const successorProfile = rootsReady && isRobinhoodProfileV41(value.profile);
  const base = v4Path(CREATE_PATH_TEMPLATE_V4, chainId);
  assertCapabilitiesV4Field(isPlainObject(value.routes), "routes");
  assertV4ExactKeys(value.routes, [
    "capabilities",
    "create",
    "preflight",
    "list",
    "status",
    "finalizedMetadata",
    ...(successorProfile ? ["initialBuyQuote"] : []),
  ], "capabilities.routes");
  for (const [field, expected] of Object.entries({
    capabilities: v4Path(CAPABILITIES_PATH_TEMPLATE_V4, chainId),
    create: base,
    preflight: v4Path(PREFLIGHT_PATH_TEMPLATE_V4, chainId),
    list: base,
    status: `${base}/{launchId}`,
    finalizedMetadata: `/v4/chains/${chainId}/finalized-custom-launches`,
    ...(successorProfile ? { initialBuyQuote: `/v4/chains/${chainId}/initial-buy-quote` } : {}),
  })) {
    assertCapabilitiesV4Field(value.routes?.[field] === expected, `routes.${field}`);
  }
  assertCapabilitiesV4Field(isPlainObject(value.authentication), "authentication");
  assertV4ExactKeys(value.authentication, [
    "create",
    "preflight",
    "status",
    "finalizedMetadata",
    "capabilities",
    ...(successorProfile ? ["initialBuyQuote"] : []),
    "requiredScopes",
    "apiKeyIsWallet",
  ], "capabilities.authentication");
  for (const [field, expected] of Object.entries({
    create: "bearer-api-key",
    preflight: "bearer-api-key",
    status: "bearer-api-key",
    finalizedMetadata: "none",
    capabilities: "none",
    apiKeyIsWallet: false,
  })) {
    assertCapabilitiesV4Field(
      value.authentication?.[field] === expected,
      `authentication.${field}`,
    );
  }
  if (successorProfile) assertCapabilitiesV4Field(value.authentication.initialBuyQuote === "none", "authentication.initialBuyQuote");
  assertCapabilitiesV4Field(
    canonicalizeJson(value.authentication?.requiredScopes)
      === canonicalizeJson(["custom-launch:create", "custom-launch:read"]),
    "authentication.requiredScopes",
  );
  assertCapabilitiesV4Field(isPlainObject(value.graph), "graph");
  assertV4ExactKeys(
    value.graph,
    ["minimumTargets", "maximumTargets", "hookPermissionBits"],
    "capabilities.graph",
  );
  assertCapabilitiesV4Field(value.graph?.minimumTargets === 3, "graph.minimumTargets");
  assertCapabilitiesV4Field(value.graph?.maximumTargets === 16, "graph.maximumTargets");
  assertCapabilitiesV4Field(
    canonicalizeJson(value.graph?.hookPermissionBits) === canonicalizeJson(HOOK_PERMISSIONS),
    "graph.hookPermissionBits",
  );
  assertV4ExactKeys(value.funding, ["modes"], "capabilities.funding");
  assertCapabilitiesV4Field(
    canonicalizeJson(value.funding?.modes)
      === canonicalizeJson(successorProfile ? ["wallet-transaction-value"] : ["none", "wallet-transaction-value"]),
    "funding.modes",
  );
  assertV4ExactKeys(value.metadataImage, [
    "schemaVersion",
    "mediaTypes",
    "maximumBytes",
    "maximumDimension",
    "maximumPixels",
    "gifFrames",
  ], "capabilities.metadataImage");
  assertCapabilitiesV4Field(
    value.metadataImage.schemaVersion === "programmable.project-metadata-image-capability.v1"
      && canonicalizeJson(value.metadataImage.mediaTypes)
        === canonicalizeJson(["image/png", "image/gif"])
      && value.metadataImage.maximumBytes === 5_242_880
      && value.metadataImage.maximumDimension === 8_192
      && value.metadataImage.maximumPixels === 4_194_304
      && value.metadataImage.gifFrames === 1,
    "metadataImage",
  );
  assertCapabilitiesV4Field(
    Array.isArray(value.toolchains),
    "toolchains",
  );
  for (const [index, toolchain] of value.toolchains.entries()) {
    assertCapabilitiesV4Field(isPlainObject(toolchain), `toolchains[${index}]`);
    assertV4ExactKeys(
      toolchain,
      ["compiler", "version", "digest"],
      `capabilities.toolchains[${index}]`,
    );
    assertCapabilitiesV4Field(nonemptyString(toolchain.compiler), `toolchains[${index}].compiler`);
    assertCapabilitiesV4Field(nonemptyString(toolchain.version), `toolchains[${index}].version`);
    assertCapabilitiesV4Field(
      typeof toolchain.digest === "string" && SHA256.test(toolchain.digest),
      `toolchains[${index}].digest`,
    );
  }
  assertV4ExactKeys(value.readiness, ["status", "reasonCodes"], "capabilities.readiness");
  assertCapabilitiesV4Field(
    new Set(["ready", "unavailable"]).has(value.readiness.status)
      && isCodeArray(value.readiness.reasonCodes)
      && (value.readiness.status === "ready"
        ? rootsReady && value.readiness.reasonCodes.length === 0 && value.toolchains.length > 0
        : value.readiness.reasonCodes.length > 0),
    "readiness",
  );
  assertCapabilitiesV4Field(isPlainObject(value.safety), "safety");
  assertV4ExactKeys(value.safety, [
    "serverAuthoritative",
    "clientBypassAccepted",
    "walletSignatureProduced",
    "transactionBroadcast",
    "feeBehaviorClaim",
    "universalFeeBehaviorClaim",
    "genericClaimingLive",
  ], "capabilities.safety");
  for (const [field, expected] of Object.entries({
    serverAuthoritative: true,
    clientBypassAccepted: false,
    walletSignatureProduced: false,
    transactionBroadcast: false,
    feeBehaviorClaim: false,
    universalFeeBehaviorClaim: false,
    genericClaimingLive: false,
  })) {
    assertCapabilitiesV4Field(value.safety?.[field] === expected, `safety.${field}`);
  }
  assertV4ExactKeys(
    value.walletHandoff,
    ["schemaVersion", "separateWalletSignatureRequired", "walletHandoffBaseUrl"],
    "capabilities.walletHandoff",
  );
  assertCapabilitiesV4Field(
    value.walletHandoff?.schemaVersion === EXACT_WALLET_TRANSACTION_SCHEMA_V4,
    "walletHandoff.schemaVersion",
  );
  assertCapabilitiesV4Field(
    value.walletHandoff?.separateWalletSignatureRequired === true,
    "walletHandoff.separateWalletSignatureRequired",
  );
  assertCapabilitiesV4Field(
    value.walletHandoff?.walletHandoffBaseUrl === WALLET_HANDOFF_BASE_URL,
    "walletHandoff.walletHandoffBaseUrl",
  );
}

function assertV4RequestMatchesCapabilities(request, capabilities) {
  if (capabilities.readiness?.status !== "ready"
    || capabilities.chainDeployment === null
    || capabilities.chainDeploymentDescriptorDigest === null
    || capabilities.profile === null) {
    throw new ProgrammableApiError("Robinhood V4 production capabilities are unavailable", {
      code: "CUSTOM_LAUNCH_V4_UNAVAILABLE",
      serverDetails: { reasonCodes: capabilities.readiness?.reasonCodes ?? [] },
    });
  }
  if (request.chainId !== capabilities.chain.id || request.caip2 !== capabilities.chain.caip2) {
    throw new ProgrammableApiError("V4 request chain does not match public capabilities", {
      code: "CUSTOM_LAUNCH_CHAIN_MISMATCH",
    });
  }
  if (request.chainDeploymentDescriptorDigest
      !== capabilities.chainDeploymentDescriptorDigest
    || canonicalizeJson(request.chainDeployment)
      !== canonicalizeJson(capabilities.chainDeployment)) {
    throw new ProgrammableApiError("V4 request trust roots do not match public capabilities", {
      code: "CUSTOM_LAUNCH_DEPLOYMENT_MISMATCH",
    });
  }
  if (canonicalizeJson(request.profile) !== canonicalizeJson(capabilities.profile)) {
    throw new ProgrammableApiError("V4 request profile does not match public capabilities", {
      code: "CUSTOM_LAUNCH_PROFILE_MISMATCH",
    });
  }
}

function assertV4LaunchResource(value, {
  request,
  rawRequestSha256,
  chainId,
  capabilities,
  localCommitments,
  localArtifactBindings,
}) {
  assertResponseObject(value, "V4 launch resource");
  const resourceProfile = normalizeV4ProfileRef(value.profile);
  // History remains bound to its original supported profile, not the currently advertised one.
  if (request == null) capabilities = { ...capabilities, profile: resourceProfile };
  const optionalFields = [
    ...(isRobinhoodProfileV41(resourceProfile) ? ["feeReview"] : []),
    "actionRequired",
    "walletHandoffUrl",
    "expiresAt",
    "secondsRemaining",
    "partnerAttribution",
    "sourceVerification",
  ].filter((field) => Object.hasOwn(value, field));
  assertV4ExactKeys(value, [
    "schemaVersion",
    "apiVersion",
    "launchId",
    "requestId",
    "routeId",
    "chainId",
    "caip2",
    "chainDeploymentId",
    "chainDeploymentDescriptorDigest",
    "chainDeployment",
    "profile",
    "controller",
    "status",
    "requestHash",
    "rawRequestSha256",
    "sourceBuildCommitment",
    "graphCommitment",
    "metadataCommitment",
    "walletTransactionPreimageHash",
    "commitments",
    "projectMetadata",
    "funding",
    ...(isRobinhoodProfileV41(resourceProfile) ? ["fundingPlan", "initialBuyReview"] : []),
    "liquidityModel",
    "walletTransaction",
    "preparedArtifact",
    "admissionReceipt",
    "simulationReceipt",
    "externalContractEvidenceReceipt",
    ...optionalFields,
    "onchain",
    "failure",
    "createdAt",
    "updatedAt",
  ], "resource");
  const expectedChainId = request?.chainId ?? chainId;
  for (const [field, expected] of Object.entries({
    schemaVersion: CUSTOM_LAUNCH_RESOURCE_SCHEMA_V4,
    apiVersion: "v4",
    routeId: "custom-launch:create:v4",
    chainId: expectedChainId,
    caip2: ROBINHOOD_CAIP2,
    chainDeploymentId: capabilities.chainDeployment.chainDeploymentId,
    chainDeploymentDescriptorDigest: capabilities.chainDeploymentDescriptorDigest,
  })) {
    if (value[field] !== expected) {
      throw new ProgrammableApiError("Custom Launch API returned an invalid V4 resource", {
        code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
        serverDetails: { field },
      });
    }
  }
  if (canonicalizeJson(normalizeV4ChainDeployment(value.chainDeployment))
      !== canonicalizeJson(normalizeV4ChainDeployment(capabilities.chainDeployment))) {
    throw new ProgrammableApiError("Custom Launch API returned a resource for another deployment", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "chainDeployment" },
    });
  }
  if (canonicalizeJson(normalizeV4ProfileRef(value.profile))
      !== canonicalizeJson(normalizeV4ProfileRef(capabilities.profile))) {
    throw new ProgrammableApiError("Custom Launch API returned a resource for another profile", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "profile" },
    });
  }
  if (!SHA256.test(value.requestHash ?? "")
    || !SHA256.test(value.rawRequestSha256 ?? "")
    || !SHA256.test(value.sourceBuildCommitment ?? "")
    || !SHA256.test(value.graphCommitment ?? "")
    || !SHA256.test(value.metadataCommitment ?? "")
    || (value.walletTransactionPreimageHash !== null
      && !SHA256.test(value.walletTransactionPreimageHash ?? ""))) {
    throw new ProgrammableApiError("Custom Launch API returned an unbound V4 resource", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "commitments" },
    });
  }
  if (request !== undefined && value.requestHash !== customLaunchRequestHashV4(request)) {
    throw new ProgrammableApiError("Custom Launch API resource requestHash does not match request", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "requestHash" },
    });
  }
  if (rawRequestSha256 !== undefined && value.rawRequestSha256 !== rawRequestSha256) {
    throw new ProgrammableApiError("Custom Launch API resource rawRequestSha256 does not match bytes", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "rawRequestSha256" },
    });
  }
  if (!V4_RESOURCE_STATUSES.has(value.status)) {
    throw new ProgrammableApiError("Custom Launch API returned a V4 resource without status", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "status" },
    });
  }
  if (typeof value.launchId !== "string" || !REQUEST_ID.test(value.launchId)
    || typeof value.requestId !== "string" || !REQUEST_ID.test(value.requestId)) {
    throw new ProgrammableApiError("Custom Launch API returned a V4 resource without launchId", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "launchId" },
    });
  }
  assertV4ExactKeys(value.controller, ["namespace", "address"], "resource.controller");
  if (value.controller.namespace !== ROBINHOOD_CAIP2
    || !/^0x[0-9a-fA-F]{40}$/u.test(value.controller.address)
    || (request?.launchWallet !== undefined
      && value.controller.address.toLowerCase() !== request.launchWallet.toLowerCase())) {
    throw new ProgrammableApiError("Custom Launch API returned a resource for another controller", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "controller" },
    });
  }
  assertV4Commitments(value.commitments, "resource.commitments");
  if (localCommitments !== undefined) {
    assertV4Commitments(localCommitments, "localValidation.commitments");
  }
  const requestVerificationCommitment = request?.verificationBundle === undefined
    ? undefined
    : framedV4Commitment(request.verificationBundle.schemaVersion, request.verificationBundle);
  const requestFundingPermitCommitment = request?.funding === undefined
      || request?.nonce === undefined
      || request?.permitWindow === undefined
    ? undefined
    : framedV4Commitment("programmable.custom-launch-funding-permit.v4", {
      funding: request.funding,
      nonce: request.nonce,
      permitWindow: request.permitWindow,
    });
  if (value.sourceBuildCommitment !== value.commitments.sourceBuild
    || value.graphCommitment !== value.commitments.graph
    || value.metadataCommitment !== value.commitments.metadata
    || (localCommitments !== undefined
      && canonicalizeJson(value.commitments) !== canonicalizeJson(localCommitments))
    || (requestVerificationCommitment !== undefined
      && value.commitments.verification !== requestVerificationCommitment)
    || (requestFundingPermitCommitment !== undefined
      && value.commitments.fundingPermit !== requestFundingPermitCommitment)
    || (request?.launchIntentHash !== undefined
      && value.commitments.launchIntent !== request.launchIntentHash)) {
    throw new ProgrammableApiError("Custom Launch API resource commitments drifted", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "commitments" },
    });
  }
  const metadata = validateProjectMetadata(value.projectMetadata, { requireComplete: true });
  if (!new Set(["image/png", "image/gif"]).has(metadata.presentation.image?.mediaType)) {
    throw new ProgrammableApiError("Custom Launch API resource metadata image is not V4-admitted", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "projectMetadata.presentation.image" },
    });
  }
  normalizeV4FundingIntent(value.funding);
  if (isRobinhoodProfileV41(resourceProfile)) {
    const plan = normalizeRobinhoodFundingPlanV1(value.fundingPlan, value.funding);
    if (request != null && canonicalizeJson(plan) !== canonicalizeJson(request.fundingPlan)) {
      throw new ProgrammableApiError("Custom Launch API resource funding plan drifted", {
        code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID", serverDetails: { field: "fundingPlan" },
      });
    }
  }
  normalizeV4LiquidityModel(value.liquidityModel);
  if (request?.projectMetadata !== undefined
    && canonicalizeJson(metadata)
      !== canonicalizeJson(validateProjectMetadata(request.projectMetadata, {
        requireComplete: true,
      }))) {
    throw new ProgrammableApiError("Custom Launch API resource metadata drifted", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "projectMetadata" },
    });
  }
  if (request?.funding !== undefined
    && canonicalizeJson(value.funding) !== canonicalizeJson(request.funding)) {
    throw new ProgrammableApiError("Custom Launch API resource funding drifted", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "funding" },
    });
  }
  if (!Number.isFinite(Date.parse(value.createdAt))
    || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new ProgrammableApiError("Custom Launch API resource timestamps are invalid", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "timestamps" },
    });
  }
  if (value.sourceVerification !== undefined
    && value.sourceVerification !== null) {
    if (value.status !== "finalized") {
      throw invalidV4SourceVerification("status");
    }
    assertV4SourceVerificationStatus(value.sourceVerification);
  }
  if (value.failure !== null) {
    assertV4ExactKeys(value.failure, ["code", "message", "retryable"], "resource.failure");
    if (!nonemptyString(value.failure.code)
      || !nonemptyString(value.failure.message)
      || typeof value.failure.retryable !== "boolean") {
      throw new ProgrammableApiError("Custom Launch API resource failure is invalid", {
        code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
        serverDetails: { field: "failure" },
      });
    }
  }
  if (value.actionRequired !== undefined && value.actionRequired !== null) {
    assertV4ExactKeys(
      value.actionRequired,
      ["kind", "walletHandoffUrl", "expiresAt"],
      "resource.actionRequired",
    );
    if (value.actionRequired.kind !== "send-router-transaction"
      || !nonemptyString(value.actionRequired.walletHandoffUrl)
      || !Number.isFinite(Date.parse(value.actionRequired.expiresAt))) {
      throw new ProgrammableApiError("Custom Launch API resource wallet action is invalid", {
        code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
        serverDetails: { field: "actionRequired" },
      });
    }
  }
  if (value.walletHandoffUrl !== undefined
    && value.walletHandoffUrl !== null
    && !nonemptyString(value.walletHandoffUrl)) {
    throw new ProgrammableApiError("Custom Launch API resource wallet URL is invalid", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "walletHandoffUrl" },
    });
  }
  if (value.expiresAt !== undefined
    && value.expiresAt !== null
    && !Number.isFinite(Date.parse(value.expiresAt))) {
    throw new ProgrammableApiError("Custom Launch API resource expiry is invalid", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "expiresAt" },
    });
  }
  if (value.secondsRemaining !== undefined
    && value.secondsRemaining !== null
    && (!Number.isSafeInteger(value.secondsRemaining) || value.secondsRemaining < 0)) {
    throw new ProgrammableApiError("Custom Launch API resource countdown is invalid", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "secondsRemaining" },
    });
  }
  const walletState = new Set([
    WALLET_HANDOFF_STATUS,
    "wallet_action_required",
    "awaiting_wallet_signature",
  ]).has(value.status);
  if (walletState && value.walletTransaction === null) {
    throw new ProgrammableApiError("Custom Launch API wallet state omitted its transaction", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "walletTransaction" },
    });
  }
  assertV4ReceiptPhase(value, { request, capabilities });
  if (isRobinhoodProfileV41(resourceProfile) && value.initialBuyReview !== null) {
    assertRobinhoodInitialBuyReviewV1(value.initialBuyReview, value);
  }
  if (isRobinhoodProfileV41(resourceProfile) && value.feeReview !== undefined) {
    assertRobinhoodFeeReviewV1(value.feeReview, value);
  }
  if ((value.walletTransaction === null) !== (value.preparedArtifact === null)) {
    throw new ProgrammableApiError("Custom Launch API split its wallet transaction and artifact", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "preparedArtifact" },
    });
  }
  if (value.preparedArtifact !== null
    && canonicalizeJson(value.preparedArtifact.projectMetadata)
      !== canonicalizeJson(metadata)) {
    throw new ProgrammableApiError("Custom Launch API artifact metadata drifted", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "preparedArtifact.projectMetadata" },
    });
  }
  if (value.walletTransaction !== null) {
    assertExactWalletTransactionV4(value.walletTransaction, capabilities, {
      request,
      resource: value,
      localArtifactBindings,
    });
  }
  if (value.onchain !== null) {
    assertV4OnchainEvidence(value.onchain, capabilities, value);
  }
}

function assertV4SourceVerificationStatus(value) {
  assertResponseObject(value, "resource.sourceVerification");
  assertV4ExactKeys(value, [
    "schemaVersion",
    "chainId",
    "caip2",
    "chainDeploymentId",
    "status",
    "components",
    "updatedAt",
  ], "resource.sourceVerification");
  const statuses = new Set(["queued", "retrying", "exact_match", "needs_attention"]);
  if (value.schemaVersion !== "programmable.source-verification-status.v4"
    || value.chainId !== ROBINHOOD_CHAIN_ID
    || value.caip2 !== ROBINHOOD_CAIP2
    || value.chainDeploymentId !== "robinhood-mainnet-custom-launch-v1"
    || !statuses.has(value.status)
    || !Array.isArray(value.components)
    || value.components.length < 1
    || value.components.length > 16
    || !canonicalMillisecondTimestampV4(value.updatedAt)) {
    throw invalidV4SourceVerification("root");
  }
  let previousTargetId = null;
  const componentTimestamps = [];
  for (const [index, component] of value.components.entries()) {
    const label = `resource.sourceVerification.components[${index}]`;
    assertResponseObject(component, label);
    const active = component.status === "queued" || component.status === "retrying";
    assertV4ExactKeys(component, [
      "targetId",
      "address",
      "status",
      "providerObservation",
      "exactSourceAuthority",
      "exactSourceBinding",
      "updatedAt",
      ...(active ? ["nextAttemptAt"] : []),
    ], label);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:@/+\-]{0,255}$/u.test(component.targetId ?? "")
      || !/^0x[0-9a-f]{40}$/u.test(component.address ?? "")
      || !statuses.has(component.status)
      || !canonicalMillisecondTimestampV4(component.updatedAt)
      || (previousTargetId !== null
        && Buffer.compare(
          Buffer.from(previousTargetId, "utf8"),
          Buffer.from(component.targetId, "utf8"),
        ) >= 0)) {
      throw invalidV4SourceVerification(`components[${index}]`);
    }
    if (component.status === "exact_match") {
      assertResponseObject(component.providerObservation, `${label}.providerObservation`);
      assertV4ExactKeys(component.providerObservation, [
        "provider",
        "classification",
        "match",
        "creationMatch",
        "runtimeMatch",
        "releaseAuthority",
        "evidenceDigest",
      ], `${label}.providerObservation`);
      if (component.providerObservation.provider !== "sourcify-v2"
        || component.providerObservation.classification !== "PARTIAL_NO_CBOR_EXACT_BYTES"
        || component.providerObservation.match !== "match"
        || component.providerObservation.creationMatch !== "match"
        || component.providerObservation.runtimeMatch !== "match"
        || component.providerObservation.releaseAuthority !== false
        || !SHA256.test(component.providerObservation.evidenceDigest ?? "")) {
        throw invalidV4SourceVerification(`components[${index}].providerObservation`);
      }
      assertResponseObject(component.exactSourceBinding, `${label}.exactSourceBinding`);
      assertV4ExactKeys(component.exactSourceBinding, [
        "schemaVersion",
        "authority",
        "coveredEvidence",
        "bindingDigest",
      ], `${label}.exactSourceBinding`);
      if (component.exactSourceAuthority
          !== "protected-hosted-build-finalized-transaction-bytecode"
        || component.exactSourceBinding.schemaVersion
          !== "programmable.robinhood-custom-launch.exact-byte-source-build-transaction-binding.v1"
        || component.exactSourceBinding.authority
          !== "protected-hosted-build-finalized-transaction-bytecode"
        || canonicalizeJson(component.exactSourceBinding.coveredEvidence)
          !== canonicalizeJson(ROBINHOOD_EXACT_SOURCE_BINDING_COVERED_EVIDENCE)
        || !SHA256.test(component.exactSourceBinding.bindingDigest ?? "")) {
        throw invalidV4SourceVerification(`components[${index}].exactSourceBinding`);
      }
    } else if (component.providerObservation !== null
      || component.exactSourceAuthority !== null
      || component.exactSourceBinding !== null) {
      throw invalidV4SourceVerification(`components[${index}].exactSourceBinding`);
    }
    if (active && !canonicalMillisecondTimestampV4(component.nextAttemptAt)) {
      throw invalidV4SourceVerification(`components[${index}].nextAttemptAt`);
    }
    previousTargetId = component.targetId;
    componentTimestamps.push(component.updatedAt);
  }
  const expectedStatus = value.components.every(({ status }) => status === "exact_match")
    ? "exact_match"
    : value.components.some(({ status }) => status === "needs_attention")
      ? "needs_attention"
      : value.components.some(({ status }) => status === "retrying")
        ? "retrying"
        : "queued";
  const expectedUpdatedAt = componentTimestamps.reduce((latest, current) =>
    current > latest ? current : latest);
  if (value.status !== expectedStatus || value.updatedAt !== expectedUpdatedAt) {
    throw invalidV4SourceVerification(
      value.status !== expectedStatus ? "status" : "updatedAt",
    );
  }
}

function canonicalMillisecondTimestampV4(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
    && Number.isFinite(Date.parse(value))
    && new Date(Date.parse(value)).toISOString() === value;
}

function invalidV4SourceVerification(field) {
  return new ProgrammableApiError(
    "Custom Launch API returned invalid V4 source-verification state",
    {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: `sourceVerification.${field}` },
    },
  );
}

function assertExactWalletTransactionV4(
  value,
  capabilities,
  { request, resource, localArtifactBindings } = {},
) {
  assertExactKeys(value, [
    "schemaVersion",
    "chainId",
    "caip2",
    "apiVersion",
    "chainDeploymentId",
    "chainDeploymentDescriptorDigest",
    "chainDeployment",
    "profile",
    "finalityPolicy",
    "from",
    "to",
    "valueWei",
    "calldata",
    "selector",
    "transactionPreimageHash",
    "routerRuntimeCodeHash",
    "expiresAt",
    "commitments",
    "launchSummary",
  ], "walletTransaction");
  const router = capabilities.chainDeployment.contracts.programmableLaunchStampRouter;
  const requestFundingValue = request?.funding?.mode === "wallet-transaction-value"
    ? request.funding.valueWei
    : request?.funding?.mode === "none"
      ? "0"
      : undefined;
  const expiryMilliseconds = typeof value?.expiresAt === "string"
    ? Date.parse(value.expiresAt)
    : Number.NaN;
  const afterPermitDeadline = request?.permitWindow?.deadline !== undefined
    && /^(?:0|[1-9][0-9]*)$/u.test(request.permitWindow.deadline)
    && Number.isFinite(expiryMilliseconds)
    && BigInt(Math.floor(expiryMilliseconds / 1_000)) > BigInt(request.permitWindow.deadline);
  if (value.schemaVersion !== EXACT_WALLET_TRANSACTION_SCHEMA_V4
    || value.chainId !== ROBINHOOD_CHAIN_ID
    || value.caip2 !== ROBINHOOD_CAIP2
    || value.apiVersion !== "v4"
    || value.chainDeploymentId !== capabilities.chainDeployment.chainDeploymentId
    || value.chainDeploymentDescriptorDigest !== capabilities.chainDeploymentDescriptorDigest
    || canonicalizeJson(normalizeV4ChainDeployment(value.chainDeployment))
      !== canonicalizeJson(normalizeV4ChainDeployment(capabilities.chainDeployment))
    || canonicalizeJson(normalizeV4ProfileRef(value.profile))
      !== canonicalizeJson(normalizeV4ProfileRef(capabilities.profile))
    || canonicalizeJson(value.finalityPolicy)
      !== canonicalizeJson(capabilities.chainDeployment.finality)
    || typeof value.from !== "string"
    || !/^0x[0-9a-fA-F]{40}$/u.test(value.from)
    || (typeof request?.launchWallet === "string"
      && value.from.toLowerCase() !== request.launchWallet.toLowerCase())
    || value.to !== router.address
    || value.routerRuntimeCodeHash !== router.runtimeCodeHash
    || typeof value.valueWei !== "string"
    || !/^(?:0|[1-9][0-9]*)$/u.test(value.valueWei)
    || (requestFundingValue !== undefined && value.valueWei !== requestFundingValue)
    || value.selector !== "0xe5f6b8cd"
    || typeof value.calldata !== "string"
    || !/^0x(?:[0-9a-f]{2}){4,}$/u.test(value.calldata)
    || !value.calldata.startsWith(value.selector)
    || !SHA256.test(value.transactionPreimageHash ?? "")
    || typeof value.expiresAt !== "string"
    || !Number.isFinite(expiryMilliseconds)
    || afterPermitDeadline
    || !isPlainObject(value.commitments)
    || !validV4Commitments(value.commitments)
    || !validV4LaunchSummary(value.launchSummary, value, { request, resource })) {
    throw new ProgrammableApiError("Custom Launch API returned an unsafe V4 wallet transaction", {
      code: "EXACT_WALLET_TRANSACTION_INVALID",
    });
  }
  const { transactionPreimageHash: _ignored, ...preimage } = value;
  const expectedPreimageHash = sha256Digest(Buffer.concat([
    Buffer.from("programmable.exact-wallet-transaction-preimage.v4", "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(preimage), "utf8"),
  ]));
  if (value.transactionPreimageHash !== expectedPreimageHash) {
    throw new ProgrammableApiError("Custom Launch API wallet preimage hash is not canonical", {
      code: "EXACT_WALLET_TRANSACTION_INVALID",
    });
  }
  if ((resource?.walletTransactionPreimageHash !== null
      && resource?.walletTransactionPreimageHash !== value.transactionPreimageHash)
    || (resource?.commitments !== undefined
      && canonicalizeJson(resource.commitments) !== canonicalizeJson(value.commitments))
    || (resource?.sourceBuildCommitment !== undefined
      && resource.sourceBuildCommitment !== value.commitments.sourceBuild)
    || (resource?.graphCommitment !== undefined
      && resource.graphCommitment !== value.commitments.graph)
    || (resource?.metadataCommitment !== undefined
      && resource.metadataCommitment !== value.commitments.metadata)
    || (request?.launchIntentHash !== undefined
      && request.launchIntentHash !== value.commitments.launchIntent)) {
    throw new ProgrammableApiError("Custom Launch API wallet transaction commitments drifted", {
      code: "EXACT_WALLET_TRANSACTION_INVALID",
    });
  }
  try {
    assertCanonicalWalletTransactionCalldataV4({
      calldata: value.calldata,
      chainId: ROBINHOOD_CHAIN_ID,
      router: router.address,
      graphFactory: capabilities.chainDeployment.contracts.graphFactory.address,
      launchWallet: value.from,
      ...(request?.nonce === undefined ? {} : { nonce: request.nonce }),
      ...(request?.permitWindow === undefined ? {} : { permitWindow: request.permitWindow }),
      valueWei: value.valueWei,
      preparedArtifact: resource?.preparedArtifact,
      commitments: value.commitments,
      localArtifactBindings,
    });
  } catch (cause) {
    throw new ProgrammableApiError("Custom Launch API wallet calldata or artifact is not canonical", {
      code: "EXACT_WALLET_TRANSACTION_INVALID",
      cause,
    });
  }
}

function framedV4Commitment(domain, value) {
  if (typeof domain !== "string" || domain.length === 0) return undefined;
  return sha256Digest(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(value), "utf8"),
  ]));
}

function exactLocalV4Commitments(validation, request) {
  const commitments = {
    sourceBuild: validation.sourceBuildCommitment,
    graph: validation.graphBundleHash,
    metadata: validation.projectMetadataHash,
    verification: validation.verificationBundleHash,
    fundingPermit: framedV4Commitment("programmable.custom-launch-funding-permit.v4", {
      funding: request.funding,
      nonce: request.nonce,
      permitWindow: request.permitWindow,
    }),
    launchIntent: validation.launchIntentHash,
  };
  if (!validV4Commitments(commitments)
    || commitments.launchIntent !== request.launchIntentHash
    || (request.projectMetadataHash !== undefined
      && commitments.metadata !== request.projectMetadataHash)) {
    throw new TypeError(
      "V4_LOCAL_VALIDATION_COMMITMENTS_INVALID: exact local pack/validate commitments are absent or drifted",
    );
  }
  return Object.freeze(commitments);
}

function exactLocalV4ArtifactBindings(validation, request, commitments) {
  const graphTargets = request?.graphBundle?.targets;
  const predictions = validation?.predictions;
  if (!Array.isArray(graphTargets)
    || !Array.isArray(predictions)
    || graphTargets.length < 3
    || graphTargets.length !== predictions.length
    || typeof request?.graphBundle?.sourceBundleSha256 !== "string"
    || !SHA256.test(request.graphBundle.sourceBundleSha256)
    || typeof validation?.unboundGraphBundleHash !== "string"
    || !SHA256.test(validation.unboundGraphBundleHash)) {
    throw new TypeError(
      "V4_LOCAL_ARTIFACT_BINDINGS_INVALID: exact local graph materialization is absent",
    );
  }
  const targets = graphTargets.map((target, index) => {
    const prediction = predictions[index];
    if (prediction?.targetId !== target?.targetId
      || typeof target?.creationBytecode !== "string"
      || !/^0x(?:[0-9a-f]{2})+$/u.test(target.creationBytecode)
      || typeof prediction?.resolvedConstructorArguments !== "string"
      || !/^0x(?:[0-9a-f]{2})*$/u.test(prediction.resolvedConstructorArguments)
      || typeof prediction?.resolvedInitializerCalldata !== "string"
      || !/^0x(?:[0-9a-f]{2})*$/u.test(prediction.resolvedInitializerCalldata)) {
      throw new TypeError(
        "V4_LOCAL_ARTIFACT_BINDINGS_INVALID: local graph predictions drifted",
      );
    }
    return Object.freeze({
      targetId: target.targetId,
      targetIdHash: prediction.targetIdHash,
      applicantSalt: prediction.applicantSalt,
      deploymentValueWei: target.deploymentValueWei,
      initializerValueWei: target.initializerValueWei,
      initCode: `${target.creationBytecode}${prediction.resolvedConstructorArguments.slice(2)}`,
      initializerCalldata: prediction.resolvedInitializerCalldata,
      predictedAddress: prediction.predictedAddress,
      expectedRuntimeCodeHash: target.expectedRuntimeCodeHash,
    });
  });
  return Object.freeze({
    sourceBundleSha256: request.graphBundle.sourceBundleSha256,
    unboundGraphBundleHash: validation.unboundGraphBundleHash,
    projectMetadata: request.projectMetadata,
    projectMetadataHash: commitments.metadata,
    graphBundleHash: commitments.graph,
    verificationBundleHash: commitments.verification,
    targets: Object.freeze(targets),
  });
}

function assertV4ReceiptPhase(resource, { request, capabilities }) {
  const admission = resource.admissionReceipt;
  const simulation = resource.simulationReceipt;
  const externalEvidence = resource.externalContractEvidenceReceipt;
  if ((admission === null) !== (simulation === null)
    || (admission === null) !== (externalEvidence === null)) {
    throw new ProgrammableApiError("Custom Launch API returned an incomplete receipt pair", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "admissionReceipt" },
    });
  }
  if (admission !== null) {
    assertV4AdmissionReceipt(admission, resource, capabilities);
    assertV4SimulationReceipt(simulation, resource, capabilities);
    assertV4ExternalContractEvidenceReceipt(
      externalEvidence,
      resource,
      capabilities,
      admission,
    );
  }
  const unevaluated = new Set(["received", "validating"]);
  const walletPrepared = new Set([
    "wallet_action_required", "awaiting_wallet_signature", "authorized", "submitted",
    "sequencer_soft_confirmed", "ethereum_posted", "finalized",
  ]);
  if ((unevaluated.has(resource.status) && admission !== null)
    || (!unevaluated.has(resource.status) && admission === null)
    || (walletPrepared.has(resource.status)
      && (resource.walletTransaction === null || resource.preparedArtifact === null
        || simulation.kind !== "exact_wallet_transaction" || simulation.passed !== true))
    || (!walletPrepared.has(resource.status)
      && (resource.walletTransaction !== null || resource.preparedArtifact !== null))) {
    throw new ProgrammableApiError("Custom Launch API receipt phase does not match resource status", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "status" },
    });
  }
  if (request !== undefined && admission !== null
    && admission.requestHash !== customLaunchRequestHashV4(request)) {
    throw new ProgrammableApiError("Custom Launch API receipt request binding drifted", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "admissionReceipt.requestHash" },
    });
  }
}

function assertV4ExternalContractEvidenceReceipt(
  value,
  resource,
  capabilities,
  admission,
) {
  assertResponseObject(value, "resource.externalContractEvidenceReceipt");
  if (value.schemaVersion !== "programmable.custom-launch-external-contract-evidence.v4"
    || value.requestHash !== resource.requestHash
    || value.chainDeploymentDescriptorDigest !== capabilities.chainDeploymentDescriptorDigest
    || value.profileDigest !== capabilities.profile.profileDigest
    || value.verified !== true
    || !Array.isArray(value.references)
    || !Array.isArray(value.providers)
    || !SHA256.test(value.evidenceDigest ?? "")
    || value.evidenceDigest !== admission.externalContractEvidenceDigest) {
    throw new ProgrammableApiError(
      "Custom Launch API external-contract evidence receipt is not request-bound",
      {
        code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
        serverDetails: { field: "externalContractEvidenceReceipt" },
      },
    );
  }
}

function assertV4AdmissionReceipt(value, resource, capabilities) {
  assertV4ExactKeys(value, [
    "schemaVersion", "apiVersion", "chainId", "requestHash", "rawRequestSha256",
    "chainDeploymentDescriptorDigest", "profileDigest", "commitments",
    "staticAnalysisDigest", "externalContractEvidenceDigest", "disposition",
    ...(isRobinhoodProfileV41(resource.profile) ? ["feeReviewDigest", "initialBuyReviewDigest"] : []),
    "evidenceTier", "hardBlockFindingCodes", "needsEvidenceFindingCodes",
    "warningFindingCodes", "issuedAt", "receiptDigest",
  ], "resource.admissionReceipt");
  const { receiptDigest, ...preimage } = value;
  const feeReviewValid = !isRobinhoodProfileV41(resource.profile) || (value.feeReviewDigest === null
    ? ["unsupported", "needs_evidence"].includes(value.disposition) && resource.feeReview === undefined
    : SHA256.test(value.feeReviewDigest ?? "") && resource.feeReview?.evidenceDigest === value.feeReviewDigest);
  const initialBuyReviewValid = !isRobinhoodProfileV41(resource.profile) || (value.initialBuyReviewDigest === null
    ? ["unsupported", "needs_evidence"].includes(value.disposition) && resource.initialBuyReview === null
    : SHA256.test(value.initialBuyReviewDigest ?? "") && resource.initialBuyReview?.evidenceDigest === value.initialBuyReviewDigest);
  if (!feeReviewValid || !initialBuyReviewValid || value.schemaVersion !== "programmable.custom-launch-admission-receipt.v4"
    || value.apiVersion !== "v4" || value.chainId !== ROBINHOOD_CHAIN_ID
    || value.requestHash !== resource.requestHash
    || value.rawRequestSha256 !== resource.rawRequestSha256
    || value.chainDeploymentDescriptorDigest !== capabilities.chainDeploymentDescriptorDigest
    || value.profileDigest !== capabilities.profile.profileDigest
    || canonicalizeJson(value.commitments) !== canonicalizeJson(resource.commitments)
    || !SHA256.test(value.staticAnalysisDigest ?? "")
    || !SHA256.test(value.externalContractEvidenceDigest ?? "")
    || !new Set(["supported", "supported_with_warnings", "needs_evidence", "unsupported"])
      .has(value.disposition)
    || !V4_EVIDENCE_TIERS.has(value.evidenceTier)
    || !isCodeArray(value.hardBlockFindingCodes)
    || !isCodeArray(value.needsEvidenceFindingCodes)
    || !isCodeArray(value.warningFindingCodes)
    || !canonicalTimestampV4(value.issuedAt)
    || receiptDigest !== framedSha256JsonV4(value.schemaVersion, preimage)) {
    throw new ProgrammableApiError("Custom Launch API admission receipt is invalid", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "admissionReceipt" },
    });
  }
}

function assertV4SimulationReceipt(value, resource, capabilities) {
  assertV4ExactKeys(value, [
    "schemaVersion", "apiVersion", "kind", "chainId", "requestHash",
    "transactionPreimageHash", "chainDeploymentDescriptorDigest", "profileDigest",
    "providerEvidenceDigest", "passed", "reasonCode", "observedBlockNumber",
    "observedBlockHash", "issuedAt", "receiptDigest",
  ], "resource.simulationReceipt");
  const { receiptDigest, ...preimage } = value;
  const observedNull = value.observedBlockNumber === null && value.observedBlockHash === null;
  const observedPresent = typeof value.observedBlockNumber === "string"
    && /^(?:0|[1-9][0-9]*)$/u.test(value.observedBlockNumber)
    && NONZERO_HEX32.test(value.observedBlockHash ?? "");
  if (value.schemaVersion !== "programmable.custom-launch-simulation-receipt.v4"
    || value.apiVersion !== "v4"
    || !new Set(["request_preflight", "exact_wallet_transaction"]).has(value.kind)
    || value.chainId !== ROBINHOOD_CHAIN_ID
    || value.requestHash !== resource.requestHash
    || (value.kind === "request_preflight"
      ? value.transactionPreimageHash !== null
      : value.transactionPreimageHash !== resource.walletTransactionPreimageHash)
    || value.chainDeploymentDescriptorDigest !== capabilities.chainDeploymentDescriptorDigest
    || value.profileDigest !== capabilities.profile.profileDigest
    || !SHA256.test(value.providerEvidenceDigest ?? "")
    || typeof value.passed !== "boolean"
    || (value.passed ? value.reasonCode !== null : !nonemptyString(value.reasonCode))
    || (!observedNull && !observedPresent)
    || !canonicalTimestampV4(value.issuedAt)
    || receiptDigest !== framedSha256JsonV4(value.schemaVersion, preimage)) {
    throw new ProgrammableApiError("Custom Launch API simulation receipt is invalid", {
      code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
      serverDetails: { field: "simulationReceipt" },
    });
  }
}

function framedSha256JsonV4(domain, value) {
  return sha256Digest(Buffer.concat([
    Buffer.from(domain, "utf8"),
    Buffer.from([0]),
    Buffer.from(canonicalizeJson(value), "utf8"),
  ]));
}

function canonicalTimestampV4(value) {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function assertV4OnchainEvidence(value, capabilities, resource) {
  if (value?.schemaVersion === ONCHAIN_EVIDENCE_SCHEMA_V2) {
    assertV4OnchainEvidenceV2(value, capabilities, resource);
    return;
  }
  if (value?.schemaVersion === ONCHAIN_EVIDENCE_SCHEMA_V3) {
    assertV4OnchainEvidenceV3(value, capabilities, resource);
    return;
  }
  throw invalidV4OnchainEvidence("schemaVersion");
}

function assertV4OnchainEvidenceV2(value, capabilities, resource) {
  assertV4ExactKeys(value, [
    "schemaVersion",
    "apiVersion",
    "chainId",
    "caip2",
    "chainDeploymentId",
    "chainDeploymentDescriptorDigest",
    "chainDeployment",
    "profile",
    "router",
    "routerRuntimeCodeHash",
    "routerLaunchId",
    "transactionHash",
    "blockNumber",
    "blockHash",
    "logIndex",
    "checkpointType",
    "finalityPolicy",
    "commitments",
    "walletTransactionPreimageHash",
    "evidenceDigest",
    "terminal",
    "observedAt",
  ], "resource.onchain");
  assertV4OnchainEvidenceCommon(value, capabilities, resource);
  if (typeof value.blockNumber !== "string"
    || !DECIMAL_UINT.test(value.blockNumber)
    || !NONZERO_HEX32.test(value.blockHash ?? "")
    || !validHistoricalV2LogIndex(value.logIndex)
    || !new Set([
      "sequencer_soft_confirmation",
      "ethereum_posted",
      "ethereum_finalized",
    ]).has(value.checkpointType)) {
    throw invalidV4OnchainEvidence("legacyCheckpoint");
  }
}

function assertV4OnchainEvidenceV3(value, capabilities, resource) {
  assertV4ExactKeys(value, [
    "schemaVersion",
    "apiVersion",
    "chainId",
    "caip2",
    "chainDeploymentId",
    "chainDeploymentDescriptorDigest",
    "chainDeployment",
    "profile",
    "router",
    "routerRuntimeCodeHash",
    "routerLaunchId",
    "transactionHash",
    "blockNumber",
    "blockHash",
    "logIndex",
    "checkpointType",
    "l2Inclusion",
    "l1Posting",
    "l1FinalizedCheckpoint",
    "finalityPolicy",
    "commitments",
    "walletTransactionPreimageHash",
    "evidenceDigest",
    "terminal",
    "observedAt",
  ], "resource.onchain");
  const deployment = assertV4OnchainEvidenceCommon(value, capabilities, resource);
  assertV4L2Inclusion(value.l2Inclusion);
  if (value.transactionHash !== value.l2Inclusion.transactionHash) {
    throw invalidV4OnchainEvidence("transactionHash");
  }

  const ethereumFinality = deployment.permitAuthoritySourceProvenance
    ?.configurationEvidence?.ethereumFinalityEvidence;
  const hasPosting = value.checkpointType === "ethereum_posted"
    || value.checkpointType === "ethereum_finalized";
  const hasFinalizedCheckpoint = value.checkpointType === "ethereum_finalized";
  if (hasPosting) {
    assertV4L1Posting(value.l1Posting, ethereumFinality);
  } else if (value.l1Posting !== null) {
    throw invalidV4OnchainEvidence("l1Posting");
  }
  if (hasFinalizedCheckpoint) {
    assertV4L1FinalizedCheckpoint(value.l1FinalizedCheckpoint, ethereumFinality);
  } else if (value.l1FinalizedCheckpoint !== null) {
    throw invalidV4OnchainEvidence("l1FinalizedCheckpoint");
  }

  if (value.terminal !== hasFinalizedCheckpoint) {
    throw invalidV4OnchainEvidence("terminal");
  }

  let projectedBlockNumber = value.l2Inclusion.blockNumber;
  let projectedBlockHash = value.l2Inclusion.blockHash;
  let projectedLogIndex = value.l2Inclusion.launchEventLogIndex;
  if (value.checkpointType === "ethereum_posted") {
    projectedBlockNumber = value.l1Posting.blockNumber;
    projectedBlockHash = value.l1Posting.blockHash;
    projectedLogIndex = value.l1Posting.logIndex;
  } else if (value.checkpointType === "ethereum_finalized") {
    projectedBlockNumber = value.l1FinalizedCheckpoint.blockNumber;
    projectedBlockHash = value.l1FinalizedCheckpoint.blockHash;
    projectedLogIndex = value.l1Posting.logIndex;
    if (BigInt(value.l1FinalizedCheckpoint.blockNumber)
      < BigInt(value.l1Posting.blockNumber)) {
      throw invalidV4OnchainEvidence("l1FinalizedCheckpoint.blockNumber");
    }
  } else if (value.checkpointType !== "sequencer_soft_confirmation") {
    throw invalidV4OnchainEvidence("checkpointType");
  }
  if (value.blockNumber !== projectedBlockNumber
    || value.blockHash !== projectedBlockHash
    || value.logIndex !== projectedLogIndex) {
    throw invalidV4OnchainEvidence("legacyCheckpoint");
  }

  const preimage = { ...value };
  delete preimage.evidenceDigest;
  if (value.evidenceDigest !== framedSha256JsonV4(value.schemaVersion, preimage)) {
    throw invalidV4OnchainEvidence("evidenceDigest");
  }
}

function assertV4OnchainEvidenceCommon(value, capabilities, resource) {
  const deployment = normalizeV4ChainDeployment(value.chainDeployment);
  const router = capabilities.chainDeployment.contracts.programmableLaunchStampRouter;
  if (value.apiVersion !== "v4"
    || value.chainId !== ROBINHOOD_CHAIN_ID
    || value.caip2 !== ROBINHOOD_CAIP2
    || value.chainDeploymentId !== capabilities.chainDeployment.chainDeploymentId
    || value.chainDeploymentDescriptorDigest !== capabilities.chainDeploymentDescriptorDigest
    || canonicalizeJson(deployment)
      !== canonicalizeJson(normalizeV4ChainDeployment(capabilities.chainDeployment))
    || canonicalizeJson(normalizeV4ProfileRef(value.profile))
      !== canonicalizeJson(normalizeV4ProfileRef(capabilities.profile))
    || value.router !== router.address
    || value.routerRuntimeCodeHash !== router.runtimeCodeHash
    || !NONZERO_HEX32.test(value.routerLaunchId ?? "")
    || !NONZERO_HEX32.test(value.transactionHash ?? "")
    || canonicalizeJson(value.finalityPolicy)
      !== canonicalizeJson(capabilities.chainDeployment.finality)
    || !validV4Commitments(value.commitments)
    || canonicalizeJson(value.commitments) !== canonicalizeJson(resource.commitments)
    || value.walletTransactionPreimageHash !== resource.walletTransactionPreimageHash
    || !SHA256.test(value.walletTransactionPreimageHash ?? "")
    || !SHA256.test(value.evidenceDigest ?? "")
    || typeof value.terminal !== "boolean"
    || !Number.isFinite(Date.parse(value.observedAt))) {
    throw invalidV4OnchainEvidence("onchain");
  }
  return deployment;
}

function assertV4L2Inclusion(value) {
  assertV4ExactKeys(value, [
    "schemaVersion", "chainId", "caip2", "transactionHash", "blockNumber", "blockHash",
    "blockTimestamp", "receiptStatus", "launchEventLogIndex", "routeEventLogIndex",
  ], "resource.onchain.l2Inclusion");
  if (value.schemaVersion !== "programmable.custom-launch-l2-inclusion.v1"
    || value.chainId !== ROBINHOOD_CHAIN_ID
    || value.caip2 !== ROBINHOOD_CAIP2
    || !NONZERO_HEX32.test(value.transactionHash ?? "")
    || !POSITIVE_DECIMAL_UINT.test(value.blockNumber ?? "")
    || !NONZERO_HEX32.test(value.blockHash ?? "")
    || !POSITIVE_DECIMAL_UINT.test(value.blockTimestamp ?? "")
    || value.receiptStatus !== "success"
    || !validV4LogIndex(value.launchEventLogIndex)
    || !validV4LogIndex(value.routeEventLogIndex)
    || value.routeEventLogIndex >= value.launchEventLogIndex) {
    throw invalidV4OnchainEvidence("l2Inclusion");
  }
}

function assertV4L1Posting(value, ethereumFinality) {
  assertV4ExactKeys(value, [
    "schemaVersion", "chainId", "caip2", "rollup", "sequencerInbox", "batchNumber",
    "transactionHash", "blockNumber", "blockHash", "logIndex",
  ], "resource.onchain.l1Posting");
  if (value.schemaVersion !== "programmable.custom-launch-l1-posting.v1"
    || value.chainId !== "1"
    || value.caip2 !== "eip155:1"
    || !EVM_ADDRESS.test(value.rollup ?? "")
    || !EVM_ADDRESS.test(value.sequencerInbox ?? "")
    || value.rollup !== ethereumFinality?.rollup
    || value.sequencerInbox !== ethereumFinality?.sequencerInbox
    || !DECIMAL_UINT.test(value.batchNumber ?? "")
    || !NONZERO_HEX32.test(value.transactionHash ?? "")
    || !POSITIVE_DECIMAL_UINT.test(value.blockNumber ?? "")
    || !NONZERO_HEX32.test(value.blockHash ?? "")
    || !validV4LogIndex(value.logIndex)) {
    throw invalidV4OnchainEvidence("l1Posting");
  }
}

function assertV4L1FinalizedCheckpoint(value, ethereumFinality) {
  assertV4ExactKeys(value, [
    "schemaVersion", "chainId", "caip2", "consensusCheckpointTag", "blockNumber",
    "blockHash", "providerReadbacks",
  ], "resource.onchain.l1FinalizedCheckpoint");
  const providers = ethereumFinality?.ethereumProviders;
  if (value.schemaVersion
      !== "programmable.custom-launch-l1-finalized-checkpoint.v1"
    || value.chainId !== "1"
    || value.caip2 !== "eip155:1"
    || value.consensusCheckpointTag !== "finalized"
    || !POSITIVE_DECIMAL_UINT.test(value.blockNumber ?? "")
    || !NONZERO_HEX32.test(value.blockHash ?? "")
    || !Array.isArray(value.providerReadbacks)
    || value.providerReadbacks.length !== 2
    || !Array.isArray(providers)
    || providers.length !== 2) {
    throw invalidV4OnchainEvidence("l1FinalizedCheckpoint");
  }
  for (const [index, readback] of value.providerReadbacks.entries()) {
    const label = `resource.onchain.l1FinalizedCheckpoint.providerReadbacks[${index}]`;
    assertV4ExactKeys(
      readback,
      ["providerId", "trustDomain", "blockNumber", "blockHash"],
      label,
    );
    if (!nonemptyString(readback.providerId)
      || !nonemptyString(readback.trustDomain)
      || readback.providerId !== providers[index].providerId
      || readback.trustDomain !== providers[index].trustDomain
      || readback.blockNumber !== value.blockNumber
      || readback.blockHash !== value.blockHash) {
      throw invalidV4OnchainEvidence(`l1FinalizedCheckpoint.providerReadbacks[${index}]`);
    }
  }
}

function validV4LogIndex(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_LOG_INDEX;
}

function validHistoricalV2LogIndex(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function invalidV4OnchainEvidence(field) {
  return new ProgrammableApiError("Custom Launch API returned invalid V4 onchain evidence", {
    code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
    serverDetails: { field: `onchain.${field}` },
  });
}

function validV4Commitments(value) {
  if (!isPlainObject(value)) return false;
  const expected = [
    "sourceBuild",
    "graph",
    "metadata",
    "verification",
    "fundingPermit",
    "launchIntent",
  ];
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index])
    && Object.values(value).every((digest) => typeof digest === "string" && SHA256.test(digest));
}

function assertV4Commitments(value, label) {
  if (validV4Commitments(value)) return;
  throw new ProgrammableApiError("Custom Launch API returned invalid V4 commitments", {
    code: "CUSTOM_LAUNCH_V4_RESOURCE_INVALID",
    serverDetails: { field: label },
  });
}

function validV4LaunchSummary(value, transaction, { request, resource } = {}) {
  if (!isPlainObject(value)) return false;
  const keys = ["chainName", "controller", "name", "symbol", "fundingMode", "valueWei"];
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  const expectedMetadata = request?.projectMetadata ?? resource?.projectMetadata;
  const expectedFunding = request?.funding ?? resource?.funding;
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index])
    && value.chainName === "Robinhood Chain Mainnet"
    && typeof value.controller === "string"
    && value.controller.toLowerCase() === transaction.from.toLowerCase()
    && nonemptyString(value.name)
    && nonemptyString(value.symbol)
    && new Set(["none", "wallet-transaction-value"]).has(value.fundingMode)
    && value.valueWei === transaction.valueWei
    && ((value.fundingMode === "none") === (value.valueWei === "0"))
    && (expectedMetadata === undefined
      || (value.name === expectedMetadata.token?.name
        && value.symbol === expectedMetadata.token?.symbol))
    && (expectedFunding === undefined
      || (value.fundingMode === expectedFunding.mode
        && value.valueWei === expectedFunding.valueWei));
}

function assertV4ExactKeys(value, keys, label) {
  try {
    assertExactKeys(value, keys, label);
  } catch (cause) {
    throw new ProgrammableApiError("Custom Launch API returned a noncanonical V4 object", {
      code: "CUSTOM_LAUNCH_V4_CONTRACT_INVALID",
      serverDetails: { field: label },
      cause,
    });
  }
}

function assertCapabilitiesV4Field(condition, field, value) {
  if (condition) return;
  throw new ProgrammableApiError(
    "Custom Launch API capabilities do not match the production V4 machine contract",
    {
      code: "CAPABILITIES_CONTRACT_INVALID",
      serverDetails: { field },
      ...(field === "$" && value !== undefined ? { cause: "response-is-not-an-object" } : {}),
    },
  );
}

function assertPreflightV4Field(condition, field) {
  if (condition) return;
  throw new ProgrammableApiError(
    `Custom Launch API returned an invalid ${PREFLIGHT_SCHEMA_V2} response`,
    {
      code: "PREFLIGHT_CONTRACT_INVALID",
      serverDetails: { field },
    },
  );
}

function assertCapabilitiesResponse(value) {
  assertCapabilitiesField(isPlainObject(value), "$", value);
  assertCapabilitiesField(
    value.schemaVersion === "programmable.custom-launch-capabilities.v1",
    "schemaVersion",
  );
  assertCapabilitiesField(value.apiVersion === "v3", "apiVersion");
  assertCapabilitiesField(
    typeof value.serverTime === "string" && Number.isFinite(Date.parse(value.serverTime)),
    "serverTime",
  );
  assertCapabilitiesField(value.readinessUrl === `${API_ORIGIN}/readyz`, "readinessUrl");
  assertCapabilitiesField(isPlainObject(value.chain), "chain");
  assertCapabilitiesField(value.chain?.id === "1", "chain.id");
  assertCapabilitiesField(value.chain?.name === "Ethereum Mainnet", "chain.name");
  assertCapabilitiesField(isPlainObject(value.profile), "profile");
  assertCapabilitiesField(value.profile?.profileId === DIRECT_NATIVE_PROFILE_ID, "profile.profileId");
  assertCapabilitiesField(
    value.profile?.profileRevision === DIRECT_NATIVE_PROFILE_REVISION,
    "profile.profileRevision",
  );
  assertCapabilitiesField(
    value.profile?.profileVersion === DIRECT_NATIVE_PROFILE_VERSION,
    "profile.profileVersion",
  );
  assertCapabilitiesField(
    value.profile?.productionLaunchAuthorized === true,
    "profile.productionLaunchAuthorized",
  );
  assertCapabilitiesField(isPlainObject(value.routes), "routes");
  for (const [field, expected] of Object.entries({
    create: CREATE_PATH_V3,
    preflight: PREFLIGHT_PATH_V3,
    status: `${CREATE_PATH_V3}/{launchId}`,
    list: CREATE_PATH_V3,
    finalizedMetadata: "/v3/finalized-custom-launches",
    capabilities: CAPABILITIES_PATH_V3,
    permitReissue: PERMIT_REISSUE_PATH_TEMPLATE_V3,
  })) {
    assertCapabilitiesField(value.routes?.[field] === expected, `routes.${field}`);
  }
  assertCapabilitiesField(isPlainObject(value.authentication), "authentication");
  for (const [field, expected] of Object.entries({
    create: "bearer-api-key",
    preflight: "bearer-api-key",
    status: "bearer-api-key",
    finalizedMetadata: "none",
    capabilities: "none",
    permitReissue: "bearer-api-key",
  })) {
    assertCapabilitiesField(
      value.authentication?.[field] === expected,
      `authentication.${field}`,
    );
  }
  assertCapabilitiesField(
    Array.isArray(value.authentication?.requiredScopes)
      && value.authentication.requiredScopes.length === 2
      && value.authentication.requiredScopes[0] === "custom-launch:create"
      && value.authentication.requiredScopes[1] === "custom-launch:read",
    "authentication.requiredScopes",
  );
  assertCapabilitiesField(
    value.authentication?.apiKeyIsWallet === false,
    "authentication.apiKeyIsWallet",
  );
  assertCapabilitiesField(isPlainObject(value.preflight), "preflight");
  for (const [field, expected] of Object.entries({
    quotaConsumed: false,
    nonceAllocated: false,
    persisted: false,
    walletSignatureProduced: false,
    transactionBroadcast: false,
    exactProductionAdmissionEngine: true,
  })) {
    assertCapabilitiesField(value.preflight?.[field] === expected, `preflight.${field}`);
  }
  assertCapabilitiesField(isPlainObject(value.projectMetadata), "projectMetadata");
  for (const [field, expected] of Object.entries({
    schemaVersion: "programmable.project-metadata.v1",
    inputSchemaVersion: "programmable.project-metadata-input.v1",
    requiredForProfileVersion: DIRECT_NATIVE_PROFILE_VERSION,
    strictNewPackPolicyProfileVersion: DIRECT_NATIVE_PROFILE_VERSION,
    imageMayBeNull: false,
    maximumLinks: 32,
    exactlyOneRequiredLinkPerKind: true,
    websiteUriPolicy: "canonical-public-credential-free-https",
    xUriPattern: "^https://x\\.com/[A-Za-z0-9_]{1,64}$",
    projectMetadataHashDomain: "programmable.project-metadata.v1",
    graphBundleHashBindingDomain: "programmable.custom-graph-project-metadata.v1",
    postDeploymentTokenReadbackRequired: true,
  })) {
    assertCapabilitiesField(
      value.projectMetadata?.[field] === expected,
      `projectMetadata.${field}`,
    );
  }
  assertCapabilitiesField(
    canonicalizeJson(value.projectMetadata?.requiredFields) === canonicalizeJson([
      "token.name",
      "token.symbol",
      "presentation.description",
      "presentation.image",
      "presentation.links",
    ]),
    "projectMetadata.requiredFields",
  );
  const requiredForProfileVersions = capabilitiesProfileVersions(
    value.projectMetadata?.requiredForProfileVersions,
    "projectMetadata.requiredForProfileVersions",
  );
  const strictMetadataProfileVersions = capabilitiesProfileVersions(
    value.projectMetadata?.strictMetadataProfileVersions,
    "projectMetadata.strictMetadataProfileVersions",
  );
  const legacyMetadataProfileVersions = capabilitiesProfileVersions(
    value.projectMetadata?.legacyMetadataProfileVersions,
    "projectMetadata.legacyMetadataProfileVersions",
  );
  assertCapabilitiesField(
    requiredForProfileVersions.includes("3.2.0")
      && requiredForProfileVersions.includes("3.3.0")
      && requiredForProfileVersions.every(
        (profileVersion) => compareProfileVersions(profileVersion, "3.2.0") >= 0,
      ),
    "projectMetadata.requiredForProfileVersions",
  );
  assertCapabilitiesField(
    strictMetadataProfileVersions.includes("3.3.0")
      && strictMetadataProfileVersions.every((profileVersion) =>
        requiredForProfileVersions.includes(profileVersion))
      && strictMetadataProfileVersions.every(
        (profileVersion) => compareProfileVersions(profileVersion, "3.3.0") >= 0,
      ),
    "projectMetadata.strictMetadataProfileVersions",
  );
  assertCapabilitiesField(
    legacyMetadataProfileVersions.includes("3.2.0")
      && legacyMetadataProfileVersions.every((profileVersion) =>
        requiredForProfileVersions.includes(profileVersion))
      && legacyMetadataProfileVersions.every(
        (profileVersion) => compareProfileVersions(profileVersion, "3.3.0") < 0,
      )
      && legacyMetadataProfileVersions.every((profileVersion) =>
        !strictMetadataProfileVersions.includes(profileVersion)),
    "projectMetadata.legacyMetadataProfileVersions",
  );
  assertCapabilitiesField(
    canonicalizeJson(value.projectMetadata?.legacyWithoutMetadataProfileVersions)
      === canonicalizeJson(["2.0.0", "3.0.0", "3.1.0"]),
    "projectMetadata.legacyWithoutMetadataProfileVersions",
  );
  assertCapabilitiesField(
    canonicalizeJson(value.projectMetadata?.requiredLinkKinds) === canonicalizeJson([
      "website",
      "x",
    ]),
    "projectMetadata.requiredLinkKinds",
  );
  assertCapabilitiesField(
    canonicalizeJson(value.projectMetadata?.legacyImageMayBeNullProfileVersions)
      === canonicalizeJson(["3.2.0"]),
    "projectMetadata.legacyImageMayBeNullProfileVersions",
  );
  assertCapabilitiesField(
    canonicalizeJson(value.projectMetadata?.profilePolicy) === canonicalizeJson({
      schemaVersion: "programmable.project-metadata-policy.v1",
      descriptionMinimumUtf8Bytes: 20,
      descriptionMaximumUtf8Bytes: 4_096,
      descriptionMinimumUnicodeLettersOrNumbers: 8,
      imageRequired: true,
      imageReceiptSourceManifestBindingRequired: true,
      imageMediaTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
      linksMaximumCount: 32,
      requiredLinkKinds: ["website", "x"],
      exactlyOneRequiredLinkPerKind: true,
      websiteUriPolicy: "canonical-public-credential-free-https",
      xUriPattern: "^https://x\\.com/[A-Za-z0-9_]{1,64}$",
    }),
    "projectMetadata.profilePolicy",
  );
  assertCapabilitiesField(
    canonicalizeJson(value.projectMetadata?.enforcement) === canonicalizeJson({
      routes: ["POST /v3/custom-launches/preflight", "POST /v3/custom-launches"],
      serverSide: true,
      clientBypassAccepted: false,
      failureCode: "PROJECT_METADATA_POLICY_INVALID",
      legacyProfilesNotRetrofitted: true,
    }),
    "projectMetadata.enforcement",
  );
  assertCapabilitiesField(isPlainObject(value.permitReissue), "permitReissue");
  for (const [field, expected] of Object.entries({
    schemaVersion: PERMIT_REISSUE_CAPABILITY_SCHEMA_V1,
    endpoint: PERMIT_REISSUE_PATH_TEMPLATE_V3,
    requestSchemaVersion: PERMIT_REISSUE_REQUEST_SCHEMA_V1,
    dispositionSchemaVersion: PERMIT_REISSUE_DISPOSITION_SCHEMA_V1,
    disposition: "unsupported",
    httpStatus: 409,
    reasonCode: "ROUTER_V1_PERMIT_NONCE_IS_CREATE2_ROUTE_NONCE",
    authenticationScope: "custom-launch:create",
    idempotencyKeyRequired: true,
    noReplacementNonceReserved: true,
    noReplacementPermitIssued: true,
    oldPermitStateRequired: "expired-and-unconsumed",
    oldPermitInvalidation: "original-signature-expired-by-signed-deadline",
    currentReleaseRecovery: "repack-and-submit-new-launch-request",
  })) {
    assertCapabilitiesField(
      value.permitReissue?.[field] === expected,
      `permitReissue.${field}`,
    );
  }
  assertCapabilitiesField(
    canonicalizeJson(value.permitReissue?.resourceBindingRequired)
      === canonicalizeJson(["launchId", "expectedRequestHash", "expectedLaunchIntentHash"]),
    "permitReissue.resourceBindingRequired",
  );
  assertCapabilitiesField(
    Array.isArray(value.permitReissue?.futureContractRequirements)
      && value.permitReissue.futureContractRequirements.length > 0
      && value.permitReissue.futureContractRequirements.every(nonemptyString),
    "permitReissue.futureContractRequirements",
  );
  assertCapabilitiesField(
    safeWalletHandoffBase(value.walletHandoffBaseUrl) !== null,
    "walletHandoffBaseUrl",
  );
}

function capabilitiesProfileVersions(value, field) {
  assertCapabilitiesField(Array.isArray(value) && value.length > 0, field, value);
  const versions = [];
  for (const entry of value) {
    assertCapabilitiesField(typeof entry === "string" && PROFILE_VERSION.test(entry), field, value);
    versions.push(entry);
  }
  assertCapabilitiesField(new Set(versions).size === versions.length, field, value);
  assertCapabilitiesField(
    versions.every((entry, index) =>
      index === 0 || compareProfileVersions(versions[index - 1], entry) < 0),
    field,
    value,
  );
  return versions;
}

function compareProfileVersions(left, right) {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < leftParts.length; index += 1) {
    const delta = leftParts[index] - rightParts[index];
    if (delta !== 0) return delta;
  }
  return 0;
}

function assertCapabilitiesField(condition, field, value) {
  if (condition) return;
  throw new ProgrammableApiError(
    "Custom Launch API capabilities do not match the production V3 machine contract",
    {
      code: "CAPABILITIES_CONTRACT_INVALID",
      serverDetails: { field },
      ...(field === "$" && value !== undefined ? { cause: "response-is-not-an-object" } : {}),
    },
  );
}

function assertPreflightField(condition, field) {
  if (condition) return;
  throw new ProgrammableApiError(
    `Custom Launch API returned an invalid ${PREFLIGHT_SCHEMA_V1} response`,
    {
      code: "PREFLIGHT_CONTRACT_INVALID",
      serverDetails: { field },
    },
  );
}

function assertResponseObject(value, label) {
  if (!isPlainObject(value)) {
    throw new ProgrammableApiError(`Custom Launch API returned invalid ${label} JSON`, {
      code: `${label.toUpperCase()}_CONTRACT_INVALID`,
    });
  }
}

function typedRemediations(value) {
  if (!Array.isArray(value)) return null;
  return value.every(isTypedRemediation) ? value : null;
}

function isTypedRemediation(value) {
  if (!isPlainObject(value)
    || value.schemaVersion !== REMEDIATION_SCHEMA_V1
    || !nonemptyString(value.remediationId)
    || !nonemptyString(value.code)
    || !nonemptyString(value.stage)
    || !nonemptyString(value.requiredChange)
    || !nonemptyString(value.catalogUrl)
    || !nonemptyString(value.guideUrl)
    || !nonemptyString(value.resumeAt)
    || typeof value.retryable !== "boolean"
    || typeof value.requiresNewRequest !== "boolean") {
    return false;
  }
  for (const field of ["targetId", "targetRole", "sourcePath"]) {
    if (value[field] !== null && !nonemptyString(value[field])) return false;
  }
  return Object.hasOwn(value, "expected") && Object.hasOwn(value, "observed");
}

function resourceActionSummary(resource, { walletHandoffBaseUrl } = {}) {
  if (!isPlainObject(resource)) return {};
  const output = isPlainObject(resource.output) ? resource.output : null;
  const outputAction = isPlainObject(output?.actionRequired) ? output.actionRequired : null;
  const resourceAction = isPlainObject(resource.actionRequired) ? resource.actionRequired : null;
  const summary = {};
  if (Object.hasOwn(resource, "actionRequired")) {
    summary.actionRequired = resource.actionRequired;
  } else if (output !== null && Object.hasOwn(output, "actionRequired")) {
    summary.actionRequired = output.actionRequired;
  }

  const handoffUrl = firstDefined(
    resource.walletHandoffUrl,
    output?.walletHandoffUrl,
    resourceAction?.walletHandoffUrl,
    outputAction?.walletHandoffUrl,
  );
  const safeHandoffUrl = safeWalletHandoffUrl(
    handoffUrl,
    walletHandoffBaseUrl,
  );
  if (safeHandoffUrl !== null) summary.walletHandoffUrl = safeHandoffUrl;

  const expiresAt = safeExpiresAt(firstDefined(
    resource.expiresAt,
    output?.expiresAt,
    resourceAction?.expiresAt,
    outputAction?.expiresAt,
  ));
  if (expiresAt !== null) summary.expiresAt = expiresAt;

  const secondsRemaining = firstDefined(
    resource.secondsRemaining,
    output?.secondsRemaining,
    resourceAction?.secondsRemaining,
    outputAction?.secondsRemaining,
  );
  if (Number.isSafeInteger(secondsRemaining) && secondsRemaining >= 0) {
    summary.secondsRemaining = secondsRemaining;
  }

  const remediations = typedRemediations(firstDefined(
    resource.remediations,
    output?.remediations,
    resourceAction?.remediations,
    outputAction?.remediations,
  ));
  if (remediations !== null) summary.remediations = remediations;
  return summary;
}

function permitRecoverySummary(
  resource,
  { permitReissueInspectionAvailable = true } = {},
) {
  if (resource?.status !== "failed"
    || resource?.failure?.code !== "PERMIT_EXPIRED"
    || resource?.onchainLaunchId !== null) {
    return null;
  }
  const launchId = typeof resource.launchId === "string"
    ? resource.launchId
    : typeof resource.requestId === "string"
      ? resource.requestId
      : null;
  return {
    action: "repack-and-submit-new-launch-request",
    requiresFreshNonce: true,
    requiresNewIdempotencyKey: true,
    predictedAddressesMayChange: true,
    automaticReissue: false,
    permitReissueEndpoint: permitReissueInspectionAvailable
      ? launchId === null
        ? PERMIT_REISSUE_PATH_TEMPLATE_V3
        : PERMIT_REISSUE_PATH_TEMPLATE_V3.replace(
            "{launchId}",
            encodeURIComponent(launchId),
          )
      : null,
  };
}

function safeWalletHandoffUrl(value, advertisedBaseUrl) {
  if (typeof value !== "string") return null;
  let candidate;
  try {
    candidate = new URL(value);
  } catch {
    return null;
  }
  if (candidate.username || candidate.password) return null;
  const bases = [
    safeWalletHandoffBase(advertisedBaseUrl),
    safeWalletHandoffBase(WALLET_HANDOFF_BASE_URL),
  ].filter((entry) => entry !== null);
  if (candidate.origin !== new URL(WALLET_HANDOFF_BASE_URL).origin) return null;
  return bases.some((base) => pathIsWithin(candidate.pathname, new URL(base).pathname))
    ? candidate.href
    : null;
}

function safeWalletHandoffBase(value) {
  if (typeof value !== "string") return null;
  let base;
  try {
    base = new URL(value);
  } catch {
    return null;
  }
  if (base.username || base.password || base.search || base.hash) return null;
  const productionBase = new URL(WALLET_HANDOFF_BASE_URL);
  const normalizedPath = base.pathname === "/" ? "/" : base.pathname.replace(/\/$/u, "");
  return base.protocol === "https:"
    && base.origin === productionBase.origin
    && normalizedPath === productionBase.pathname
    ? `${base.origin}${base.pathname.endsWith("/") ? base.pathname : `${base.pathname}/`}`
    : null;
}

function pathIsWithin(candidatePath, basePath) {
  const normalizedBase = basePath === "/" ? "/" : basePath.replace(/\/$/u, "");
  return normalizedBase === "/"
    || candidatePath === normalizedBase
    || candidatePath.startsWith(`${normalizedBase}/`);
}

function safeExpiresAt(value) {
  return typeof value === "string" && value.length <= 64 && Number.isFinite(Date.parse(value))
    ? value
    : null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function isCodeArray(value) {
  return Array.isArray(value)
    && value.every((entry) => typeof entry === "string" && SAFE_API_CODE.test(entry));
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value, depth = 0) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (depth >= 32) return false;
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry, depth + 1));
  return isPlainObject(value)
    && Object.values(value).every((entry) => isJsonValue(entry, depth + 1));
}

function nonemptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function safeApiCode(value) {
  return typeof value === "string" && SAFE_API_CODE.test(value) ? value : null;
}

function safeErrorRequestId(value) {
  return typeof value === "string" && REQUEST_ID.test(value) ? value : null;
}

function safeRetryAfter(value) {
  if (typeof value !== "string") return null;
  if (/^[0-9]{1,10}$/.test(value)) return value;
  const when = Date.parse(value);
  return Number.isFinite(when) ? new Date(when).toUTCString() : null;
}

function retryDelayMs(retryAfter, attempt) {
  if (retryAfter !== null && retryAfter !== undefined) {
    if (/^[0-9]+$/.test(retryAfter)) return Math.min(Number(retryAfter) * 1_000, 3_600_000);
    const when = Date.parse(retryAfter);
    if (Number.isFinite(when)) return Math.min(Math.max(0, when - Date.now()), 3_600_000);
  }
  return Math.min(1_000 * 2 ** (attempt - 1), 30_000);
}

function explicitlyRetryable503(body) {
  const error = body?.error ?? body;
  return error?.retryable === true
    || error?.details?.retryable === true;
}

function normalizeIdempotencyKey(value) {
  if (typeof value !== "string" || !IDEMPOTENCY_KEY.test(value)) {
    throw new TypeError("Idempotency-Key must be 16 to 128 characters from [A-Za-z0-9._:-]");
  }
  return value;
}

function productionApiOrigin(value) {
  if (value === undefined || value === API_ORIGIN) return API_ORIGIN;
  throw new TypeError(
    `API origin is fixed to ${API_ORIGIN}; test network behavior through an injected fetch implementation`,
  );
}

function normalizeApiVersion(value) {
  if (value === 1 || value === "1" || value === "v1") return 1;
  if (value === 2 || value === "2" || value === "v2") return 2;
  if (value === 3 || value === "3" || value === "v3") return 3;
  if (value === 4 || value === "4" || value === "v4") return 4;
  throw new TypeError("apiVersion must be 1, 2, 3, or 4");
}

function createPathForApiVersion(value, chainId) {
  const apiVersion = normalizeApiVersion(value);
  if (apiVersion === 1) return CREATE_PATH_V1;
  if (apiVersion === 2) return CREATE_PATH_V2;
  if (apiVersion === 3) return CREATE_PATH_V3;
  return v4Path(CREATE_PATH_TEMPLATE_V4, normalizeV4ChainId(chainId));
}

function normalizeV4ChainId(value) {
  if (value !== ROBINHOOD_CHAIN_ID) {
    throw new TypeError(
      `V4 chain selection is explicit and must be --chain-id ${ROBINHOOD_CHAIN_ID}`,
    );
  }
  return value;
}

function v4Path(template, chainId) {
  return template.replace("{chainId}", encodeURIComponent(normalizeV4ChainId(chainId)));
}

function parseV4RequestBytes(requestBytes) {
  const source = decodeExactUtf8(requestBytes, "V4 launch request");
  const request = parseStrictJson(source, { maximumBytes: MAX_REQUEST_BYTES_V4 });
  if (!isPlainObject(request) || request.schemaVersion !== CREATE_REQUEST_SCHEMA_V4) {
    throw new TypeError(`request schemaVersion must be ${CREATE_REQUEST_SCHEMA_V4}`);
  }
  return request;
}

function errorRequestId(body) {
  return typeof body?.error?.requestId === "string" ? body.error.requestId : null;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
