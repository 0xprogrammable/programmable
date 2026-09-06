import "server-only";

import { parseStrictJson } from "../projection-target/canonical-json";

const MAXIMUM_ERROR_BODY_BYTES = 16_384;
const PRESERVED_STATUSES = new Set([400, 403, 404, 409, 422, 429, 503]);
const PRESERVED_FORBIDDEN_CODES = new Set([
  "PARTNER_ADMIN_FORBIDDEN",
]);
const PRESERVED_NOT_FOUND_CODES = new Set([
  "LAUNCH_NOT_FOUND",
]);
const PRESERVED_UNPROCESSABLE_CODES = new Set([
  "FUNDING_SIGNATURE_OWNER_MISMATCH",
  "SIMULATION_REVERTED",
]);
const PRESERVED_UNAVAILABLE_CODES = new Set([
  "API_KEY_CAPABILITY_UNAVAILABLE",
  "CUSTOM_LAUNCH_V2_UNAVAILABLE",
  "CUSTOM_LAUNCH_V3_INTEGRATION_PENDING",
  "CUSTOM_LAUNCH_V3_UNAVAILABLE",
  "CLASSIC_LAUNCH_AUTHORIZATION_UNAVAILABLE",
  "LAUNCH_UNAVAILABLE",
  "SIMULATION_UNAVAILABLE",
  "WALLET_ADMIN_UNAVAILABLE",
]);
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:@+-]{0,127}$/u;
const ERROR_CODE = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/u;
const RETRY_AFTER_SECONDS = /^[1-9][0-9]{0,4}$/u;

export class PreservedBackendPublicErrorV1 extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly publicMessage: string,
    readonly requestId: string | null,
    readonly retryAfter: string | null,
  ) {
    super(code);
    this.name = "PreservedBackendPublicErrorV1";
  }
}

export async function readPreservedBackendPublicErrorV1(
  response: Response,
): Promise<PreservedBackendPublicErrorV1 | null> {
  if (!PRESERVED_STATUSES.has(response.status)) return null;

  try {
    const text = await readBoundedText(response, MAXIMUM_ERROR_BODY_BYTES);
    if (text === null) return null;
    const value = parseStrictJson(text, {
      maximumBytes: MAXIMUM_ERROR_BODY_BYTES,
      maximumDepth: 8,
    });
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      return null;
    }
    if (
      value.schemaVersion !== "programmable.api-error.v1"
      && value.schemaVersion !== "programmable.custom-launch-api.v1"
      && value.schemaVersion !== "programmable.custom-launch-list.v1"
      && value.schemaVersion !== "programmable.custom-launch-list.v2"
      && value.schemaVersion !== "programmable.custom-launch.v2"
      && value.schemaVersion !== "programmable.custom-launch-list.v3"
      && value.schemaVersion !== "programmable.custom-launch.v3"
    ) return null;
    const error = value.error;
    if (error === null || Array.isArray(error) || typeof error !== "object") {
      return null;
    }
    if (
      typeof error.code !== "string"
      || !ERROR_CODE.test(error.code)
      || typeof error.message !== "string"
      || error.message.length < 1
      || error.message.length > 512
      || /[\u0000-\u001f\u007f]/u.test(error.message)
    ) return null;
    if (
      response.status === 403
      && !PRESERVED_FORBIDDEN_CODES.has(error.code)
    ) return null;
    if (
      response.status === 404
      && !PRESERVED_NOT_FOUND_CODES.has(error.code)
    ) return null;
    if (
      response.status === 422
      && !PRESERVED_UNPROCESSABLE_CODES.has(error.code)
    ) return null;
    if (
      response.status === 503
      && !PRESERVED_UNAVAILABLE_CODES.has(error.code)
    ) return null;

    const bodyRequestId = error.requestId;
    const headerRequestId = response.headers.get("x-request-id");
    const requestId = typeof bodyRequestId === "string"
      ? bodyRequestId
      : headerRequestId;
    if (requestId !== null && !REQUEST_ID.test(requestId)) return null;

    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfter = (response.status === 429 || response.status === 503)
      && retryAfterHeader !== null
      && RETRY_AFTER_SECONDS.test(retryAfterHeader)
      && Number(retryAfterHeader) <= 86_400
      ? retryAfterHeader
      : null;

    return new PreservedBackendPublicErrorV1(
      response.status,
      error.code,
      error.message,
      requestId,
      retryAfter,
    );
  } catch {
    return null;
  }
}

async function readBoundedText(response: Response, maximumBytes: number) {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (response.body === null) return null;
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    reader.releaseLock();
  }
  if (totalBytes === 0) return null;
  return Buffer.concat(chunks, totalBytes).toString("utf8");
}
