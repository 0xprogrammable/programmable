import { setImmediate as yieldToEventLoop } from "node:timers/promises";

import { parseStrictJson } from "./canonical-json.mjs";
import { decodeExactUtf8 } from "./io.mjs";

// Control documents do not carry source or wallet calldata. Resource responses
// may repeat the 16 MiB V4 request's artifact/transaction evidence: allow four
// times that envelope, independently of the much smaller error-body budget.
export const MAX_API_CONTROL_RESPONSE_BYTES = 4 * 1024 * 1024;
export const MAX_API_RESOURCE_RESPONSE_BYTES = 64 * 1024 * 1024;
export const MAX_API_ERROR_RESPONSE_BYTES = 1024 * 1024;
export const MAX_API_RESPONSE_DEPTH = 128;

export class ApiResponseContractError extends Error {
  constructor(code) {
    super("Custom Launch API returned an invalid response body");
    this.name = "ApiResponseContractError";
    this.code = code;
  }
}

/** Counts actual decoded HTTP-body bytes; Content-Length is only an early veto. */
export async function readApiResponse(response, {
  maximumBytes = MAX_API_RESOURCE_RESPONSE_BYTES,
  signal,
} = {}) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1
    || maximumBytes > MAX_API_RESOURCE_RESPONSE_BYTES) {
    throw new TypeError("API response byte limit is invalid");
  }
  const limit = response.status >= 400
    ? Math.min(maximumBytes, MAX_API_ERROR_RESPONSE_BYTES) : maximumBytes;
  const length = response.headers.get("content-length");
  if (length !== null && /^[0-9]+$/u.test(length) && Number(length) > limit) {
    cancel(response.body);
    throw new ApiResponseContractError("API_RESPONSE_TOO_LARGE");
  }
  // Empty HTTP bodies historically decode to null. The route validator still
  // decides whether null is a valid response for that operation.
  if (response.body === null) return null;
  if (typeof response.body?.getReader !== "function") {
    throw new ApiResponseContractError("API_RESPONSE_INVALID_STREAM");
  }
  let reader;
  try { reader = response.body.getReader(); } catch {
    throw new ApiResponseContractError("API_RESPONSE_INVALID_STREAM");
  }
  const onAbort = () => cancel(reader);
  signal?.addEventListener("abort", onAbort, { once: true });
  let bytes = Buffer.alloc(0);
  let byteLength = 0;
  let readsWithoutYield = 0;
  try {
    if (signal?.aborted) onAbort();
    signal?.throwIfAborted();
    for (;;) {
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      if (!(value instanceof Uint8Array)) {
        cancel(reader);
        throw new ApiResponseContractError("API_RESPONSE_INVALID_STREAM");
      }
      if (value.byteLength > limit - byteLength) {
        cancel(reader);
        throw new ApiResponseContractError("API_RESPONSE_TOO_LARGE");
      }
      const nextLength = byteLength + value.byteLength;
      if (nextLength > bytes.byteLength) {
        const next = Buffer.allocUnsafe(Math.min(limit,
          Math.max(nextLength, bytes.byteLength * 2, 16_384)));
        bytes.copy(next, 0, 0, byteLength);
        bytes = next;
      }
      // Copy now: a producer may reuse its chunk's backing buffer. Geometric
      // growth also bounds memory when the HTTP body arrives one byte at a time.
      bytes.set(value, byteLength);
      byteLength = nextLength;
      // Already-buffered tiny/empty chunks can otherwise keep resolving only
      // microtasks, preventing the request's abort timer from ever running.
      if (++readsWithoutYield === 256) {
        readsWithoutYield = 0;
        await yieldToEventLoop();
        signal?.throwIfAborted();
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
  if (byteLength === 0) return null;
  let source;
  try {
    source = decodeExactUtf8(bytes.subarray(0, byteLength), "API response");
  } catch {
    throw new ApiResponseContractError("API_RESPONSE_INVALID_UTF8");
  }
  try {
    parseStrictJson(source, { maximumBytes: limit, maximumDepth: MAX_API_RESPONSE_DEPTH });
    // Preserve the public client's ordinary-object return shape only after
    // validating this exact immutable string (including duplicate keys).
    return JSON.parse(source);
  } catch {
    // Parser diagnostics can contain attacker-controlled property names. Keep
    // response bytes, secrets and arbitrary server messages out of this error.
    throw new ApiResponseContractError("API_RESPONSE_INVALID_JSON");
  }
}

function cancel(stream) {
  // Cancellation must not extend the request deadline when an underlying
  // source stalls or rejects its cleanup promise.
  try { void stream?.cancel().catch(() => {}); } catch { /* Best effort cleanup. */ }
}
