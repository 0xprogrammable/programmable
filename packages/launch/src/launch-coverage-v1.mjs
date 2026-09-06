import schema from "../schemas/robinhood-launch-coverage-v1.json" with { type: "json" };
import { ProgrammableApiError } from "./api-client.mjs";
import { canonicalizeJson, parseStrictJson } from "./canonical-json.mjs";
import { assertExactKeys, decodeExactUtf8 } from "./io.mjs";

export const ROBINHOOD_LAUNCH_COVERAGE_URL_V1 = "https://api.programmable.market/v4/chains/4663/launch-coverage";
export const ROBINHOOD_LAUNCH_COVERAGE_SCHEMA_V1 = "programmable.robinhood-launch-coverage.v1";
const MAX_RESPONSE_BYTES = 131_072;
const PREFLIGHT = "/v4/chains/4663/custom-launches/preflight";
const ACTION_ROUTES = Object.freeze({
  "rebuild-and-preflight": ["POST", PREFLIGHT],
  "retry-preflight": ["POST", PREFLIGHT],
  "read-current-quote": ["GET", "/v4/chains/4663/initial-buy-quote"],
  "platform-verifier-extension": [null, null],
  "submit-exact-request": ["POST", "/v4/chains/4663/custom-launches"],
});

/** Informational only. This never accepts evidence or decides request admission. */
export function assertRobinhoodLaunchCoverageV1(report) {
  assertShape(report, schema, "launchCoverage");
  const coverage = report.verifierCoverage;
  if (report.profile?.profileVersion !== "4.1.0"
    && (coverage.seedV1.status === "proof-available"
      || coverage.moduleSeedV2.status === "proof-available")) {
    throw new TypeError("launchCoverage proof availability does not match its selected profile");
  }
  const codes = new Set();
  for (const finding of report.findingObligations) {
    if (codes.has(finding.code)) throw new TypeError("launchCoverage contains a duplicate finding code");
    codes.add(finding.code);
    if (!finding.recognized && (finding.category !== "unclassified" || finding.retryable)) {
      throw new TypeError("launchCoverage must preserve unknown findings as unclassified");
    }
    for (const action of finding.actions) {
      const [method, actionPath] = ACTION_ROUTES[action.kind];
      if (action.method !== method || action.path !== actionPath) {
        throw new TypeError("launchCoverage action does not match its documented method and path");
      }
    }
  }
  return report;
}

/** One bounded, unauthenticated read. No credential, request file or journal is read. */
export async function getRobinhoodLaunchCoverageV1({ chainId, timeoutMs = 15_000, fetchImpl = fetch } = {}) {
  if (chainId !== "4663") throw new TypeError("coverage requires explicit --chain-id 4663");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 300_000) {
    throw new TypeError("timeoutMs must be between 250 and 300000 milliseconds");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let invalidResponse = false;
  try {
    const response = await fetchImpl(ROBINHOOD_LAUNCH_COVERAGE_URL_V1, {
      method: "GET", headers: { accept: "application/json" },
      redirect: "error", signal: controller.signal,
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      const authenticationMismatch = response.status === 401 || response.status === 403;
      throw new ProgrammableApiError(authenticationMismatch
        ? `Public launch coverage unexpectedly returned HTTP ${response.status}. This endpoint requires no API key; no credential was read or sent.`
        : `Launch coverage is unavailable from this API deployment (HTTP ${response.status}). Retry the public read later; do not infer architecture support or replace your API key.`, {
        code: "LAUNCH_COVERAGE_UNAVAILABLE", httpStatus: response.status,
        retryAfter: response.headers.get("retry-after"),
      });
    }
    const reader = response.body?.getReader();
    invalidResponse = !reader;
    if (!reader) throw new TypeError("launchCoverage response body is missing");
    const chunks = [];
    let byteLength = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        byteLength += value.byteLength;
        if (byteLength > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          invalidResponse = true;
          throw new TypeError("launchCoverage response exceeds its byte limit");
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    invalidResponse = true;
    const bytes = Buffer.concat(chunks, byteLength);
    const report = parseStrictJson(decodeExactUtf8(bytes, "launchCoverage"), {
      maximumBytes: MAX_RESPONSE_BYTES, maximumDepth: 24,
    });
    assertRobinhoodLaunchCoverageV1(report);
    return { httpStatus: response.status, resource: report };
  } catch (error) {
    if (error instanceof ProgrammableApiError) throw error;
    const unavailable = controller.signal.aborted || !invalidResponse;
    throw new ProgrammableApiError(unavailable
      ? "Public launch coverage could not be read. Retry later; no credential was read or sent and no request was authorized."
      : "Public launch coverage did not match its exact response contract. Do not infer architecture support or replace your API key.", {
      code: unavailable ? "LAUNCH_COVERAGE_UNAVAILABLE" : "LAUNCH_COVERAGE_INVALID_RESPONSE",
    });
  } finally { clearTimeout(timeout); }
}

// This reader implements only the closed subset used by its bundled schema.
// New schema constructs must be implemented explicitly; they never pass silently.
function assertShape(value, shape, label) {
  if (Object.hasOwn(shape, "const")) {
    if (canonicalizeJson(value) !== canonicalizeJson(shape.const)) throw new TypeError(`${label} differs`);
  } else if (shape.enum) {
    if (!shape.enum.some(entry => canonicalizeJson(value) === canonicalizeJson(entry))) {
      throw new TypeError(`${label} is unsupported`);
    }
  } else if (shape.type === "object") {
    assertExactKeys(value, shape.required, label);
    for (const [key, child] of Object.entries(shape.properties)) assertShape(value[key], child, `${label}.${key}`);
  } else if (shape.type === "array") {
    if (!Array.isArray(value) || value.length < shape.minItems || value.length > shape.maxItems) {
      throw new TypeError(`${label} is not a bounded array`);
    }
    for (const entry of value) assertShape(entry, shape.items, `${label}[]`);
  } else if (shape.type === "string") {
    if (typeof value !== "string" || value.length < shape.minLength || value.length > shape.maxLength
      || !new RegExp(shape.pattern, "u").test(value)) throw new TypeError(`${label} is invalid`);
  } else if (shape.type === "boolean") {
    if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  } else {
    throw new TypeError("launchCoverage reader does not implement this schema construct");
  }
}
