import "server-only";

import { setImmediate as yieldToEventLoop } from "node:timers/promises";

type BodySourceV1 = Pick<Response, "headers" | "body">;

export type BodyReadOptionsV1 = Readonly<{
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

export class BoundedBodyErrorV1 extends Error {
  constructor(readonly code: "too-large" | "invalid-utf8" | "timeout" | "aborted") {
    super(code);
    this.name = "BoundedBodyErrorV1";
  }
}

export function discardBodyV1(source: Pick<Response, "body">) {
  // Cancellation is cleanup; an unresponsive producer must not delay rejection.
  void source.body?.cancel().catch(() => undefined);
}

export async function readBoundedUtf8BodyV1(
  source: BodySourceV1,
  maximumBytes: number,
  options: BodyReadOptionsV1 = {},
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("Body limits are invalid");
  }
  if (Number(source.headers.get("content-length") ?? "0") > maximumBytes) {
    discardBodyV1(source);
    throw new BoundedBodyErrorV1("too-large");
  }
  if (options.signal?.aborted) {
    discardBodyV1(source);
    throw new BoundedBodyErrorV1("aborted");
  }
  if (source.body === null) return "";

  const reader = source.body.getReader();
  let stopped: BoundedBodyErrorV1 | undefined;
  let rejectPending: ((error: Error) => void) | undefined;
  const stop = (code: "timeout" | "aborted") => {
    stopped ??= new BoundedBodyErrorV1(code);
    rejectPending?.(stopped);
  };
  const onAbort = () => stop("aborted");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => stop("timeout"), timeoutMs);
  let complete = false;
  let totalBytes = 0;
  let reads = 0;
  let bytes = new Uint8Array(Math.min(4_096, maximumBytes));

  try {
    while (true) {
      if (stopped) throw stopped;
      // Keep one abort listener and only the current read's rejection callback.
      // Racing every chunk against one shared promise would retain callbacks.
      const chunk = await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
        rejectPending = reject;
        reader.read().then(resolve, reject);
      });
      rejectPending = undefined;
      if (stopped) throw stopped;
      if (chunk.done) {
        complete = true;
        break;
      }
      const nextLength = totalBytes + chunk.value.byteLength;
      if (nextLength > maximumBytes) throw new BoundedBodyErrorV1("too-large");
      if (nextLength > bytes.length) {
        const grown = new Uint8Array(Math.min(maximumBytes, Math.max(nextLength, bytes.length * 2)));
        grown.set(bytes.subarray(0, totalBytes));
        bytes = grown;
      }
      bytes.set(chunk.value, totalBytes);
      totalBytes = nextLength;
      // Empty or immediately ready chunks must still let deadlines fire.
      if (++reads % 256 === 0) await yieldToEventLoop();
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, totalBytes));
    } catch {
      throw new BoundedBodyErrorV1("invalid-utf8");
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    rejectPending = undefined;
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
