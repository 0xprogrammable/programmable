import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createDeveloperApiKeyBridgeV1,
  CUSTOM_LAUNCH_API_SCHEMA_V1,
  CUSTOM_LAUNCH_API_SCHEMA_V2,
} from "../lib/server/custom-launch/api-key-bridge-v1";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const CREDENTIAL_ID = "018f3e2a-7b4c-7d5e-8f90-123456789abc";
const IDEMPOTENCY_KEY = "streamed-key-operation-20260906";
const KEY_PREFIX = ["pm", "live", "A".repeat(22)].join("_");

function setup() {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  const authenticate = vi.fn().mockResolvedValue({
    privyUserId: "did:privy:stream-test", privySessionId: "stream-test", wallets: [WALLET],
  });
  const fetchBackend = vi.fn();
  const bridge = createDeveloperApiKeyBridgeV1({
    authenticator: { authenticate }, fetchBackend,
    backendBaseUrl: "https://api.example/", websiteToken: "w".repeat(43),
    bffAssertionKeyV2: "b".repeat(43), backendTimeoutMs: 250,
  });
  return { bridge, authenticate, fetchBackend };
}

function summary(label = "Launch agent") {
  return {
    id: CREDENTIAL_ID, label, keyPrefix: KEY_PREFIX,
    scopes: ["custom-launch:create", "custom-launch:read"],
    createdAt: "2026-09-06T08:00:00.000Z", expiresAt: null, lastUsedAt: null, revokedAt: null,
  };
}

function jsonBytes(schemaVersion: string, label = "Launch agent") {
  return Buffer.from(JSON.stringify({ schemaVersion, walletAddress: WALLET, label,
    ...(schemaVersion === CUSTOM_LAUNCH_API_SCHEMA_V2 ? { scopes: ["custom-launch:read"] } : {}),
  }));
}

function post(body: BodyInit, signal?: AbortSignal, contentLength?: string) {
  const init: RequestInit & { duplex: "half" } = {
    method: "POST", duplex: "half", body, signal,
    headers: { "content-type": "application/json", "idempotency-key": IDEMPOTENCY_KEY,
      ...(contentLength === undefined ? {} : { "content-length": contentLength }),
    },
  };
  return new Request("https://programmable.market/api/developer/api-keys", init);
}

function get(signal?: AbortSignal) {
  return new Request(`https://programmable.market/api/developer/api-keys?walletAddress=${WALLET}`, { signal });
}

function overflowStream(limit: number) {
  const cancel = vi.fn();
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    controller.enqueue(new Uint8Array(pull.mock.calls.length === 1 ? limit : 1).fill(32));
  });
  return { body: new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 }), cancel, pull };
}

afterEach(() => vi.restoreAllMocks());

describe("API key bridge streaming boundaries", () => {
  it.each(["v1", "v2"])("stops oversized %s request bodies before authentication", async (version) => {
    const { bridge, authenticate, fetchBackend } = setup();
    const { body, cancel, pull } = overflowStream(4_096);
    const request = post(body, undefined, "1");
    const response = await (version === "v1" ? bridge.create(request) : bridge.createV2(request));
    expect(response.status).toBe(413);
    expect((await response.json()).error.code).toBe("request_too_large");
    expect(pull).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(authenticate).not.toHaveBeenCalled();
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("rejects invalid UTF-8 in a browser label before creating a key", async () => {
    const { bridge, authenticate, fetchBackend } = setup();
    const bytes = jsonBytes(CUSTOM_LAUNCH_API_SCHEMA_V1, "X");
    bytes[bytes.indexOf('"X"') + 1] = 0xff;
    const response = await bridge.create(post(bytes));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("request_schema_invalid");
    expect(authenticate).not.toHaveBeenCalled();
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it("accepts a valid multibyte request padded to exactly 4096 bytes", async () => {
    const { bridge, fetchBackend } = setup();
    fetchBackend.mockResolvedValue(new Response(JSON.stringify({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1, apiKey: summary("ä🙂"), secretState: "already-delivered",
    })));
    const bytes = jsonBytes(CUSTOM_LAUNCH_API_SCHEMA_V1, "ä🙂");
    const response = await bridge.create(post(Buffer.concat([bytes, Buffer.alloc(4_096 - bytes.length, 32)])));
    expect(response.status).toBe(200);
    expect((await response.json()).apiKey.label).toBe("ä🙂");
    expect(JSON.parse(String(fetchBackend.mock.calls[0][1].body)).label).toBe("ä🙂");
  });

  it("aborts a browser body before any authenticated mutation", async () => {
    const { bridge, authenticate, fetchBackend } = setup();
    const controller = new AbortController();
    const cancel = vi.fn();
    const pending = bridge.create(post(new ReadableStream<Uint8Array>({ cancel }), controller.signal));
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("request_aborted");
    expect(cancel).toHaveBeenCalledOnce();
    expect(authenticate).not.toHaveBeenCalled();
    expect(fetchBackend).not.toHaveBeenCalled();
  });

  it.each(["v1", "v2"])("bounds %s backend metadata even without content-length", async (version) => {
    const { bridge, fetchBackend } = setup();
    const { body, cancel, pull } = overflowStream(65_536);
    fetchBackend.mockResolvedValue(new Response(body));
    const response = await (version === "v1" ? bridge.list(get()) : bridge.listV2(get()));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("api_key_service_unavailable");
    expect(cancel).toHaveBeenCalledOnce();
    expect(pull).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid UTF-8 metadata rather than silently changing it", async () => {
    const { bridge, fetchBackend } = setup();
    const bytes = Buffer.from(JSON.stringify({ schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1, apiKeys: [summary("X")] }));
    bytes[bytes.indexOf('"X"') + 1] = 0xff;
    fetchBackend.mockResolvedValue(new Response(bytes));
    expect((await bridge.list(get())).status).toBe(503);
  });

  it.each([200, 503])("keeps the original total deadline after HTTP %i headers", async (status) => {
    const { bridge, fetchBackend } = setup();
    let finishTimer: ReturnType<typeof setTimeout> | undefined;
    const cancel = vi.fn(() => clearTimeout(finishTimer));
    let releaseHeaders!: () => void;
    const headersReady = new Promise<void>((resolve) => { releaseHeaders = resolve; });
    fetchBackend.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      releaseHeaders();
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          // A reader that started a fresh 250ms deadline at headers would accept this.
          finishTimer = setTimeout(() => {
            controller.enqueue(Buffer.from(status === 200
              ? JSON.stringify({ schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1, apiKeys: [] })
              : JSON.stringify({ schemaVersion: "programmable.api-error.v1", error: {
                code: "WALLET_ADMIN_UNAVAILABLE", message: "Service is unavailable.",
              } })));
            controller.close();
          }, 175);
        }, cancel,
      }), { status });
    });
    const pending = bridge.list(get());
    await headersReady;
    const response = await pending;
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("api_key_service_unavailable");
    expect(cancel).toHaveBeenCalledOnce();
  }, 1_000);

  it("cancels the backend body when the browser disconnects", async () => {
    const { bridge, fetchBackend } = setup();
    const controller = new AbortController();
    const cancel = vi.fn();
    fetchBackend.mockImplementation(async () => {
      controller.abort();
      return new Response(new ReadableStream<Uint8Array>({ cancel }));
    });
    expect((await bridge.list(get(controller.signal))).status).toBe(503);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("discards unread not-found bodies without waiting for cancellation", async () => {
    const { bridge, fetchBackend } = setup();
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    fetchBackend.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 404 }));
    expect((await bridge.revoke(get(), CREDENTIAL_ID)).status).toBe(405);
    const request = new Request(get(), { method: "DELETE" });
    expect((await bridge.revoke(request, CREDENTIAL_ID)).status).toBe(404);
    expect(cancel).toHaveBeenCalledOnce();
  }, 1_000);

  it("preserves the exact mutation on retry after a truncated committed response", async () => {
    const { bridge, fetchBackend } = setup();
    fetchBackend.mockResolvedValueOnce(new Response('{"schemaVersion":', { status: 201 }));
    fetchBackend.mockResolvedValueOnce(new Response(JSON.stringify({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1, apiKey: summary(), secretState: "already-delivered",
    })));
    const body = jsonBytes(CUSTOM_LAUNCH_API_SCHEMA_V1);
    expect((await bridge.create(post(body))).status).toBe(503);
    const replay = await bridge.create(post(body));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({
      schemaVersion: CUSTOM_LAUNCH_API_SCHEMA_V1, apiKey: summary(), secretState: "already-delivered",
    });
    const attempts = fetchBackend.mock.calls.map(([, init]) => ({
      body: String(init.body), idempotencyKey: new Headers(init.headers).get("idempotency-key"),
    }));
    expect(attempts[0]).toEqual(attempts[1]);
    expect(attempts[0].idempotencyKey).toBe(IDEMPOTENCY_KEY);
  });
});
