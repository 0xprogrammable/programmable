import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { readBoundedUtf8BodyV1 } from "../lib/server/custom-launch/bounded-utf8-body-v1";
import { readPreservedBackendPublicErrorV1 } from "../lib/server/custom-launch/backend-public-error-v1";

function stream(chunks: Uint8Array[], cancel = vi.fn()) {
  let index = 0;
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (index < chunks.length) controller.enqueue(chunks[index++]);
    else controller.close();
  });
  const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
  return { response: new Response(body), pull, cancel };
}

describe("bounded UTF-8 body reads", () => {
  it("accepts split multibyte characters at the exact raw-byte limit", async () => {
    const text = "ä🙂雪";
    const encoded = new TextEncoder().encode(text);
    const { response } = stream([...encoded].map((byte) => Uint8Array.of(byte)));
    await expect(readBoundedUtf8BodyV1(response, encoded.length)).resolves.toBe(text);
    expect(response.body?.locked).toBe(false);
  });

  it.each([undefined, "1"])("stops at the byte limit with content-length %s", async (declared) => {
    const { response, pull, cancel } = stream([
      new Uint8Array(8), new Uint8Array(1), new Uint8Array(8),
    ]);
    if (declared) response.headers.set("content-length", declared);
    await expect(readBoundedUtf8BodyV1(response, 8)).rejects.toMatchObject({ code: "too-large" });
    expect(pull).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(response.body?.locked).toBe(false);
  });

  it.each(["header", "stream"])("does not wait on stuck cancellation after a %s limit", async (mode) => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const { response, pull } = stream([new Uint8Array(9)], cancel);
    if (mode === "header") response.headers.set("content-length", "9");
    await expect(readBoundedUtf8BodyV1(response, 8)).rejects.toMatchObject({ code: "too-large" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(pull).toHaveBeenCalledTimes(mode === "header" ? 0 : 1);
    expect(response.body?.locked).toBe(false);
  }, 1_000);

  it.each([[0xff], [0xc3], [0xc0, 0x80], [0xed, 0xa0, 0x80]])("rejects invalid UTF-8 bytes %j", async (...bytes) => {
    await expect(readBoundedUtf8BodyV1(new Response(Uint8Array.from(bytes)), 16))
      .rejects.toMatchObject({ code: "invalid-utf8" });
  });

  it("copies bytes before a producer reuses its chunk buffer", async () => {
    const chunk = new Uint8Array(1);
    let index = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index === 3) { controller.close(); return; }
        chunk[0] = 65 + index++;
        controller.enqueue(chunk);
      },
    }, { highWaterMark: 0 });
    await expect(readBoundedUtf8BodyV1(new Response(body), 8)).resolves.toBe("ABC");
  });

  it("cancels an idle stream at its deadline without waiting for its producer", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }));
    await expect(readBoundedUtf8BodyV1(response, 16, { timeoutMs: 20 }))
      .rejects.toMatchObject({ code: "timeout" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  }, 1_000);

  it.each(["before", "during"])("honors an abort %s reading", async (when) => {
    const controller = new AbortController();
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({ cancel }));
    if (when === "before") controller.abort();
    const reading = readBoundedUtf8BodyV1(response, 16, { signal: controller.signal });
    if (when === "during") controller.abort();
    await expect(reading).rejects.toMatchObject({ code: "aborted" });
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it("lets the deadline fire when a producer keeps yielding empty chunks", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array(0)); },
      cancel,
    }, { highWaterMark: 0 }));
    await expect(readBoundedUtf8BodyV1(response, 16, { timeoutMs: 20 }))
      .rejects.toMatchObject({ code: "timeout" });
    expect(cancel).toHaveBeenCalledOnce();
  }, 1_000);

  it("releases the reader when the producer fails", async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      pull(controller) { controller.error(new Error("producer failed")); },
    }));
    await expect(readBoundedUtf8BodyV1(response, 16)).rejects.toThrow("producer failed");
    expect(response.body?.locked).toBe(false);
  });
});

describe("bounded preserved backend errors", () => {
  it("rejects invalid UTF-8 instead of publishing replacement characters", async () => {
    const bytes = Buffer.concat([
      Buffer.from('{"schemaVersion":"programmable.api-error.v1","error":{"code":"WALLET_ADMIN_UNAVAILABLE","message":"'),
      Buffer.from([0xff]), Buffer.from('"}}'),
    ]);
    await expect(readPreservedBackendPublicErrorV1(new Response(bytes, { status: 503 })))
      .resolves.toBeNull();
  });

  it("bounds error streams and their cancellation", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const { response, pull } = stream([new Uint8Array(16_384), new Uint8Array(1), new Uint8Array(1)], cancel);
    await expect(readPreservedBackendPublicErrorV1(new Response(response.body, { status: 503 })))
      .resolves.toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
    expect(pull).toHaveBeenCalledTimes(2);
  }, 1_000);

  it("cancels unread bodies for an unapproved status", async () => {
    const cancel = vi.fn();
    await expect(readPreservedBackendPublicErrorV1(new Response(
      new ReadableStream<Uint8Array>({ cancel }), { status: 500 },
    ))).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("enforces a deadline on error bodies too", async () => {
    const cancel = vi.fn();
    await expect(readPreservedBackendPublicErrorV1(new Response(
      new ReadableStream<Uint8Array>({ cancel }), { status: 503 },
    ), { timeoutMs: 20 })).resolves.toBeNull();
    expect(cancel).toHaveBeenCalledOnce();
  }, 1_000);
});
