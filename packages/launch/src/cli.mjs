import { OPENAPI_URL_V41, PACK_CONFIG_V41_CONTRACT_URL, PACK_CONFIG_V41_EXAMPLE_URL } from "./profile-v41.mjs";
import {
  GUIDE_URL,
  OPENAPI_URL_V1,
  OPENAPI_URL_V2,
  OPENAPI_URL_V3,
  OPENAPI_URL_V4,
  PACK_CONFIG_SCHEMA_V3,
  PACK_CONFIG_SCHEMA_V4,
  PACK_CONFIG_V3_CONTRACT_URL,
  PACK_CONFIG_V3_EXAMPLE_URL,
  PACK_CONFIG_V4_CONTRACT_URL,
  PACK_CONFIG_V4_EXAMPLE_URL,
  PACKAGE_VERSION,
  RELEASE_URL,
  RELEASE_URL_V1,
  RELEASE_URL_V3,
} from "./constants.mjs";
import { createCliDiagnosticError } from "./diagnostics.mjs";
import { packLaunch } from "./pack.mjs";
import { validateLaunchFile } from "./validate.mjs";
import { getRobinhoodLaunchCoverageV1 } from "./launch-coverage-v1.mjs";
import {
  ProgrammableApiError,
  statusLaunch,
  submitLaunch,
  validateLaunchRemote,
} from "./api-client.mjs";

const SAFE_API_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const SAFE_ERROR_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function formatCliError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!(error instanceof ProgrammableApiError)) return message;
  const details = error.details && typeof error.details === "object"
    ? error.details
    : {};
  const safeDetails = {};
  if (typeof details.code === "string" && SAFE_API_CODE.test(details.code)) {
    safeDetails.code = details.code;
  }
  if (Number.isInteger(details.httpStatus)
    && details.httpStatus >= 100
    && details.httpStatus <= 599) {
    safeDetails.httpStatus = details.httpStatus;
  }
  if (typeof details.requestId === "string"
    && SAFE_ERROR_REQUEST_ID.test(details.requestId)) {
    safeDetails.requestId = details.requestId;
  }
  if (typeof details.retryAfter === "string") {
    if (/^[0-9]{1,10}$/.test(details.retryAfter)) {
      safeDetails.retryAfter = details.retryAfter;
    } else {
      const retryAt = Date.parse(details.retryAfter);
      if (Number.isFinite(retryAt)) safeDetails.retryAfter = new Date(retryAt).toUTCString();
    }
  }
  const serverDetails = safeServerDetails(details.serverDetails);
  if (serverDetails !== null) safeDetails.serverDetails = serverDetails;
  const remediations = safeRemediations(details.remediations);
  if (remediations !== null) safeDetails.remediations = remediations;
  if (Object.hasOwn(details, "actionRequired")) {
    const actionRequired = safeActionRequired(details.actionRequired);
    if (actionRequired !== undefined) safeDetails.actionRequired = actionRequired;
  }
  if (typeof details.walletHandoffUrl === "string") {
    safeDetails.walletHandoffUrl = details.walletHandoffUrl;
  }
  if (typeof details.expiresAt === "string" && Number.isFinite(Date.parse(details.expiresAt))) {
    safeDetails.expiresAt = details.expiresAt;
  }
  if (Number.isSafeInteger(details.secondsRemaining) && details.secondsRemaining >= 0) {
    safeDetails.secondsRemaining = details.secondsRemaining;
  }
  return Object.keys(safeDetails).length === 0
    ? message
    : `${message}\nProgrammable API error details: ${JSON.stringify(safeDetails)}`;
}

export async function main(argv) {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (argv[0] === "--version" || argv[0] === "-v") {
    process.stdout.write(`${PACKAGE_VERSION}\n`);
    return;
  }
  const command = argv[0];
  const parsed = parseArguments(argv.slice(1));
  if (parsed.help) {
    process.stdout.write(`${usage(command)}\n`);
    return;
  }
  let result;
  if (command === "coverage") {
    rejectPositionals(parsed, 0, "coverage");
    if (parsed.booleans.size > 0 || Object.keys(parsed.flags).some(flag => !["chain-id", "timeout-ms"].includes(flag))) {
      throw new TypeError("coverage accepts only --chain-id and --timeout-ms; it reads public information without credentials");
    }
    result = await getRobinhoodLaunchCoverageV1({
      chainId: parsed.flags["chain-id"],
      timeoutMs: integerFlag(parsed, "timeout-ms"),
    });
  } else if (command === "pack") {
    rejectPositionals(parsed, 0, "pack");
    result = await packLaunch({
      configPath: requiredV3ConfigFlag(parsed),
      outputPath: parsed.flags.output,
      receiptPath: parsed.flags.receipt,
    });
  } else if (command === "validate") {
    rejectPositionals(parsed, 1, "validate");
    const validateOptions = {
      launchPath: parsed.positionals[0],
      configPath: parsed.flags.config,
      maxAttempts: integerFlag(parsed, "max-attempts"),
      timeoutMs: integerFlag(parsed, "timeout-ms"),
    };
    result = parsed.booleans.has("remote")
      ? await validateLaunchRemote(validateOptions)
      : await validateLaunchFile(validateOptions);
  } else if (command === "submit") {
    rejectPositionals(parsed, 1, "submit");
    result = await submitLaunch({
      launchPath: parsed.positionals[0],
      configPath: requiredV3ConfigFlag(parsed),
      idempotencyKey: parsed.flags["idempotency-key"],
      stateDirectory: parsed.flags["state-dir"],
      maxAttempts: integerFlag(parsed, "max-attempts"),
      timeoutMs: integerFlag(parsed, "timeout-ms"),
    });
  } else if (command === "status") {
    rejectPositionals(parsed, 1, "status");
    result = await statusLaunch({
      requestId: parsed.positionals[0],
      apiVersion: parsed.flags["api-version"],
      watch: parsed.booleans.has("watch"),
      until: parsed.flags.until,
      maxAttempts: integerFlag(parsed, "max-attempts"),
      timeoutMs: integerFlag(parsed, "timeout-ms"),
      pollIntervalMs: integerFlag(parsed, "poll-ms"),
      chainId: parsed.flags["chain-id"],
    });
  } else {
    throw new TypeError(`Unknown command ${command}. Expected coverage, pack, validate, submit, or status.`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseArguments(argv) {
  const flags = {};
  const booleans = new Set();
  const positionals = [];
  const booleanFlags = new Set(["help", "remote", "watch"]);
  const valueFlags = new Set([
    "config",
    "output",
    "receipt",
    "idempotency-key",
    "state-dir",
    "max-attempts",
    "timeout-ms",
    "poll-ms",
    "until",
    "api-version",
    "chain-id",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    const name = argument.slice(2);
    if (booleanFlags.has(name)) {
      booleans.add(name);
      continue;
    }
    if (!valueFlags.has(name)) throw new TypeError(`Unknown option --${name}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new TypeError(`--${name} requires a value`);
    if (Object.hasOwn(flags, name)) throw new TypeError(`--${name} may be provided only once`);
    flags[name] = value;
    index += 1;
  }
  return { flags, booleans, positionals, help: booleans.has("help") };
}

function rejectPositionals(parsed, expected, command) {
  if (parsed.positionals.length !== expected) {
    throw new TypeError(`${command} expects ${expected === 0 ? "no positional arguments" : "one positional argument"}`);
  }
}

function requiredV3ConfigFlag(parsed) {
  const value = parsed.flags.config;
  if (value !== undefined) return value;
  throw createCliDiagnosticError({
    code: "PACK_CONFIG_V3_MISSING",
    stage: "pack-config",
    summary: "This command requires the exact V3 pack config and build artifacts.",
    expected: {
      flag: "--config programmable-launch.config.json",
      schemaVersion: PACK_CONFIG_SCHEMA_V3,
      configContract: PACK_CONFIG_V3_CONTRACT_URL,
      executableExample: PACK_CONFIG_V3_EXAMPLE_URL,
      chainAwareAlternative: {
        schemaVersion: PACK_CONFIG_SCHEMA_V4,
        configContract: PACK_CONFIG_V41_CONTRACT_URL,
        executableExample: PACK_CONFIG_V41_EXAMPLE_URL,
        profileSelection: "Use the complete current capabilities.profile tuple. Historical 4.0 keeps its frozen contract.",
      },
    },
    observed: { flag: null },
  });
}

function integerFlag(parsed, name) {
  const value = parsed.flags[name];
  if (value === undefined) return undefined;
  if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new TypeError(`--${name} must be a non-negative safe integer`);
  }
  return Number(value);
}

function usage(command) {
  const header = [
    `programmable-launch ${PACKAGE_VERSION}`,
    "",
    "Commands:",
    "  coverage   Read public launch architecture and verifier coverage",
    "  pack       Derive launch.json and its receipt from exact source/build artifacts",
    "  validate   Recompute and validate a launch request",
    "  submit     Persistently bind and submit exact request bytes",
    "  status     Read or poll one Custom launch request",
  ];
  const details = {
    coverage: [
      "Usage: programmable-launch coverage --chain-id 4663 [--timeout-ms 15000]",
      "Reads public launch coverage with no API key. A ready service does not mean every architecture is supported.",
      "The report does not authorize a request, clear findings, issue a permit, sign, or broadcast.",
      "A missing endpoint means coverage discovery is unavailable; do not replace credentials or assume support.",
      "CLI 4.1.1 adds this command while the API profile remains 4.1.0. Verify the separate immutable CLI release before installing.",
    ],
    pack: [
      "Usage: programmable-launch pack --config <programmable-launch.config.json> [--output launch.json] [--receipt receipt.json]",
    ],
    validate: [
      "Usage: programmable-launch validate <launch.json> [--config programmable-launch.config.json] [--remote]",
      "--remote fetches public unauthenticated chain capabilities before reading the API key, then runs authenticated side-effect-free preflight.",
      "Preflight requires an API key with custom-launch:create, read only from the environment or OS secret store.",
      "V3 retains its quota-free V3 preflight contract; V4 uses the chain-scoped V4 preflight contract.",
      "V3 and V4 validation require --config so launch.json remains bound to fresh source and build artifacts.",
      "Remote validation never allocates a nonce, persists a launch, signs, or broadcasts.",
    ],
    submit: [
      "Usage: programmable-launch submit <launch.json> --config <programmable-launch.config.json> [--idempotency-key key]",
      "The API key is read only from PROGRAMMABLE_API_KEY or the OS secret store.",
      "V3 Ethereum and V4 Robinhood requests can be submitted. V1 and V2 remain readable but their create routes are closed.",
    ],
    status: [
      "Usage: programmable-launch status <request-id> [--api-version 1|2|3|4] [--chain-id 4663] [--watch] [--until authorized|finalized]",
      "V3 is the default with unchanged Ethereum behavior. V4 requires explicit --api-version 4 --chain-id 4663.",
      "This command never signs or broadcasts a wallet transaction.",
    ],
  };
  return [
    ...(command && details[command] ? details[command] : header),
    "",
    `Guide: ${GUIDE_URL}`,
    `OpenAPI V1 (read compatibility; create fenced): ${OPENAPI_URL_V1}`,
    `OpenAPI V2 (read compatibility; create fenced): ${OPENAPI_URL_V2}`,
    `OpenAPI V3 general hook profile: ${OPENAPI_URL_V3}`,
    `OpenAPI V4 profile 4.1: ${OPENAPI_URL_V41}`,
    `Historical profile 4.0: ${OPENAPI_URL_V4}`,
    `Stable V1 release: ${RELEASE_URL_V1}`,
    `Public V3 release (immutable): ${RELEASE_URL_V3}`,
    `CLI ${PACKAGE_VERSION} release (verify publication): ${RELEASE_URL}`,
  ].join("\n");
}

function safeServerDetails(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const result = {};
  for (const field of [
    "field",
    "path",
    "stage",
    "scope",
    "requiredScope",
    "requiredChange",
    "resumeAt",
  ]) {
    if (typeof value[field] === "string" && value[field].length <= 2_048) {
      result[field] = value[field];
    }
  }
  for (const field of ["retryable", "requiresNewRequest"]) {
    if (typeof value[field] === "boolean") result[field] = value[field];
  }
  const remediations = safeRemediations(value.remediations);
  if (remediations !== null) result.remediations = remediations;
  return Object.keys(result).length === 0 ? null : result;
}

function safeRemediations(value) {
  if (!Array.isArray(value)) return null;
  const result = [];
  for (const remediation of value) {
    if (typeof remediation !== "object" || remediation === null || Array.isArray(remediation)
      || remediation.schemaVersion !== "programmable.custom-launch-remediation.v1"
      || typeof remediation.remediationId !== "string"
      || typeof remediation.code !== "string"
      || typeof remediation.stage !== "string"
      || typeof remediation.requiredChange !== "string"
      || typeof remediation.catalogUrl !== "string"
      || typeof remediation.guideUrl !== "string"
      || typeof remediation.retryable !== "boolean"
      || typeof remediation.requiresNewRequest !== "boolean"
      || typeof remediation.resumeAt !== "string") {
      return null;
    }
    const safe = {
      schemaVersion: remediation.schemaVersion,
      remediationId: remediation.remediationId,
      code: remediation.code,
      stage: remediation.stage,
      targetId: safeNullableString(remediation.targetId),
      targetRole: safeNullableString(remediation.targetRole),
      sourcePath: safeNullableString(remediation.sourcePath),
      expected: boundedDiagnosticValue(remediation.expected),
      observed: boundedDiagnosticValue(remediation.observed),
      requiredChange: remediation.requiredChange,
      catalogUrl: remediation.catalogUrl,
      guideUrl: remediation.guideUrl,
      retryable: remediation.retryable,
      requiresNewRequest: remediation.requiresNewRequest,
      resumeAt: remediation.resumeAt,
    };
    if (Object.values(safe).includes(undefined)) return null;
    result.push(safe);
  }
  return result;
}

function safeNullableString(value) {
  return value === null || (typeof value === "string" && value.length <= 2_048)
    ? value
    : undefined;
}

function boundedDiagnosticValue(value, depth = 0) {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length <= 2_048 ? value : undefined;
  if (depth >= 4) return undefined;
  if (Array.isArray(value)) {
    if (value.length > 64) return undefined;
    const entries = value.map((entry) => boundedDiagnosticValue(entry, depth + 1));
    return entries.includes(undefined) ? undefined : entries;
  }
  if (typeof value !== "object" || value === null) return undefined;
  const entries = Object.entries(value);
  if (entries.length > 64) return undefined;
  const result = {};
  for (const [key, entry] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/.test(key)
      || /(?:api.?key|authorization|private|request.?body|secret|signature|source)/iu.test(key)) {
      return undefined;
    }
    const safe = boundedDiagnosticValue(entry, depth + 1);
    if (safe === undefined) return undefined;
    result[key] = safe;
  }
  return result;
}

function safeActionRequired(value) {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string" && value.length <= 2_048) return value;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const result = {};
  for (const field of ["kind", "message", "reportSha256"]) {
    if (typeof value[field] === "string" && value[field].length <= 2_048) {
      result[field] = value[field];
    }
  }
  if (Array.isArray(value.findingCodes)
    && value.findingCodes.every((code) => typeof code === "string" && SAFE_API_CODE.test(code))) {
    result.findingCodes = value.findingCodes;
  }
  const remediations = safeRemediations(value.remediations);
  if (remediations !== null) result.remediations = remediations;
  return Object.keys(result).length === 0 ? undefined : result;
}
