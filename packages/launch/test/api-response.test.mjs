import assert from "node:assert/strict";
import test from "node:test";

import { getLaunchCapabilities, ProgrammableApiError, statusLaunch } from "../src/api-client.mjs";
import {
  MAX_API_CONTROL_RESPONSE_BYTES,
  MAX_API_ERROR_RESPONSE_BYTES,
  MAX_API_RESOURCE_RESPONSE_BYTES,
  MAX_API_RESPONSE_DEPTH,
  readApiResponse,
} from "../src/api-response.mjs";
import { formatCliError } from "../src/cli.mjs";
import { jsonResponse, validV4Capabilities, validV4Resource, V4_API_KEY, V4_LAUNCH_ID } from "./fixtures/v4.mjs";

function chunkedResponse(chunks, { status = 200, headers = {}, cleanup = () => {} } = {}) {
  let pulls = 0;
  let cancellations = 0;
  const response = new Response(new ReadableStream({
    pull(controller) {
      if (pulls === chunks.length) controller.close();
      else controller.enqueue(chunks[pulls++]);
    },
    cancel() { cancellations += 1; return cleanup(); },
  }, { highWaterMark: 0 }), { status, headers });
  response.arrayBuffer = () => assert.fail("response must be consumed incrementally");
  return { response, observed: () => ({ pulls, cancellations }) };
}

async function rejectCapabilities(response, code, status) {
  let calls = 0;
  await assert.rejects(getLaunchCapabilities({
    apiVersion: 4, chainId: "4663", maxAttempts: 3,
    fetchImpl: async () => { calls += 1; return response; },
    sleepImpl: async () => assert.fail("invalid response must never be retried"),
  }), error => {
    assert.ok(error instanceof ProgrammableApiError);
    assert.equal(error.details.code, code);
    assert.equal(error.details.httpStatus, status);
    assert.equal(JSON.stringify(error).includes(V4_API_KEY), false);
    return true;
  });
  assert.equal(calls, 1);
}

for (const status of [200, 429, 503]) {
  for (const contentLength of [null, "1"]) {
    test(`chunked HTTP ${status} cancels on actual overbound bytes with Content-Length ${contentLength}`, async () => {
      const limit = status >= 400 ? MAX_API_ERROR_RESPONSE_BYTES : MAX_API_CONTROL_RESPONSE_BYTES;
      const chunk = Buffer.alloc(64 * 1024, 0x20);
      const chunks = [...Array(limit / chunk.length).fill(chunk), Buffer.from("x"), Buffer.from("must not read")];
      const stream = chunkedResponse(chunks, { status,
        headers: contentLength === null ? {} : { "content-length": contentLength },
        // A slow source cleanup must not defer the bound or start another try.
        cleanup: () => new Promise(() => {}),
      });
      await rejectCapabilities(stream.response, "API_RESPONSE_TOO_LARGE", status);
      assert.deepEqual(stream.observed(), { pulls: chunks.length - 1, cancellations: 1 });
    });
  }
}

test("declared overbound body cancels before pulling but never replaces streamed accounting", async () => {
  const stream = chunkedResponse([Buffer.from("{}")], {
    headers: { "content-length": `${MAX_API_CONTROL_RESPONSE_BYTES + 1}` },
  });
  await rejectCapabilities(stream.response, "API_RESPONSE_TOO_LARGE", 200);
  assert.deepEqual(stream.observed(), { pulls: 0, cancellations: 1 });
});

for (const [name, source, code] of [
  ["duplicate error code", '{"error":{"code":"FIRST","code":"SECOND","retryable":true}}', "API_RESPONSE_INVALID_JSON"],
  ["escaped duplicate code", '{"error":{"code":"FIRST","\\u0063ode":"SECOND","retryable":true}}', "API_RESPONSE_INVALID_JSON"],
  ["nested duplicate", '{"error":{"details":{"retryable":false,"retryable":true}}}', "API_RESPONSE_INVALID_JSON"],
  ["duplicate secret property", `{"${V4_API_KEY}":1,"${V4_API_KEY}":2}`, "API_RESPONSE_INVALID_JSON"],
  ["excessive depth", "[".repeat(MAX_API_RESPONSE_DEPTH + 1) + "0" + "]".repeat(MAX_API_RESPONSE_DEPTH + 1), "API_RESPONSE_INVALID_JSON"],
  ["lone surrogate", '"\\ud800"', "API_RESPONSE_INVALID_JSON"],
  ["nonfinite number", '{"value":1e999}', "API_RESPONSE_INVALID_JSON"],
  ["trailing bytes", '{}{}', "API_RESPONSE_INVALID_JSON"],
  ["gateway HTML", '<html>bad gateway</html>', "API_RESPONSE_INVALID_JSON"],
  ["invalid UTF8", Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x30, 0x7d]), "API_RESPONSE_INVALID_UTF8"],
  ["incomplete UTF8", Buffer.from([0x22, 0xe2, 0x82]), "API_RESPONSE_INVALID_UTF8"],
  ["UTF8 BOM", Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]), "API_RESPONSE_INVALID_UTF8"],
]) {
  for (const status of [200, 403, 429, 503]) {
    test(`${name} is a terminal response contract failure at HTTP ${status}`, async () => {
      await rejectCapabilities(new Response(source, { status }), code, status);
    });
  }
}

test("valid UTF8 split across one-byte chunks retains ordinary JSON return values and the exact depth boundary", async () => {
  const expected = { text: "Grüezi 🌈", nested: [{ code: "FIRST" }, { code: "SECOND" }], __prototypeValue: null };
  const bytes = Buffer.from(JSON.stringify(expected));
  const stream = chunkedResponse([...bytes].map(byte => Uint8Array.of(byte)));
  assert.deepEqual(await readApiResponse(stream.response), expected);
  assert.deepEqual(stream.observed(), { pulls: bytes.length, cancellations: 0 });
  const nested = "[".repeat(MAX_API_RESPONSE_DEPTH) + "0" + "]".repeat(MAX_API_RESPONSE_DEPTH);
  assert.deepEqual(await readApiResponse(new Response(nested)), JSON.parse(nested));
  const proto = await readApiResponse(new Response('{"__proto__":{"safe":"data"}}'));
  assert.equal(Object.getPrototypeOf(proto), Object.prototype);
  assert.equal(Object.hasOwn(proto, "__proto__"), true);
  assert.equal(Object.prototype.safe, undefined);
});

test("single-resource JSON uses the larger resource budget without weakening control/error limits", async () => {
  const large = { walletTransaction: { data: "x".repeat(MAX_API_CONTROL_RESPONSE_BYTES) } };
  const source = JSON.stringify(large);
  assert.ok(Buffer.byteLength(source) < MAX_API_RESOURCE_RESPONSE_BYTES);
  assert.deepEqual(await readApiResponse(new Response(source)), large);
  await assert.rejects(readApiResponse(new Response(source), {
    maximumBytes: MAX_API_CONTROL_RESPONSE_BYTES,
  }), { code: "API_RESPONSE_TOO_LARGE" });
  await assert.rejects(readApiResponse(new Response(source, { status: 503 })), { code: "API_RESPONSE_TOO_LARGE" });
});

test("exact byte limit accepts complete JSON while one additional byte cancels the resource stream", async () => {
  const source = Buffer.from('{"text":"é"}');
  assert.deepEqual(await readApiResponse(new Response(source), { maximumBytes: source.length }), { text: "é" });
  await assert.rejects(readApiResponse(new Response(source), { maximumBytes: source.length - 1 }), {
    code: "API_RESPONSE_TOO_LARGE",
  });
  const chunk = Buffer.alloc(1024 * 1024, 0x20);
  const stream = chunkedResponse([...Array(MAX_API_RESOURCE_RESPONSE_BYTES / chunk.length).fill(chunk),
    Buffer.from("x"), Buffer.from("never")]);
  await assert.rejects(readApiResponse(stream.response), { code: "API_RESPONSE_TOO_LARGE" });
  assert.deepEqual(stream.observed(), { pulls: 65, cancellations: 1 });
});

test("non-byte chunks and non-stream adapters fail closed without an unbounded fallback", async () => {
  const stream = chunkedResponse(["not bytes"]);
  await rejectCapabilities(stream.response, "API_RESPONSE_INVALID_STREAM", 200);
  assert.equal(stream.observed().cancellations, 1);
  await rejectCapabilities({ status: 200, headers: new Headers(),
    arrayBuffer: () => assert.fail("unbounded adapter fallback"),
  }, "API_RESPONSE_INVALID_STREAM", 200);
});

test("unchanged V4 capabilities/resource contracts pass strict streaming decoding", async () => {
  const resource = validV4Resource();
  const result = await statusLaunch({ apiVersion: 4, chainId: "4663", requestId: V4_LAUNCH_ID,
    maxAttempts: 1, loadApiKeyImpl: async () => V4_API_KEY,
    fetchImpl: async url => url.endsWith("/capabilities")
      ? jsonResponse(validV4Capabilities()) : chunkedResponse([Buffer.from(JSON.stringify(resource))]).response,
  });
  assert.deepEqual(result.resource, resource);
});

for (const [status, code] of [[401, "API_KEY_INVALID"], [403, "API_KEY_SCOPE_MISSING"],
  [409, "CUSTOM_LAUNCH_PROFILE_MISMATCH"], [422, "SOURCE_TARGET_ANALYSIS_INCOMPLETE"], [503, "POLICY_UNAVAILABLE"]]) {
  test(`valid HTTP ${status} ${code} remains discriminated without unsafe public message echoes`, async () => {
    const requestId = "70000000-0000-4000-8000-000000000008";
    let calls = 0;
    await assert.rejects(getLaunchCapabilities({ apiVersion: 4, chainId: "4663", maxAttempts: 3,
      fetchImpl: async () => { calls += 1; return jsonResponse({ error: {
        code, requestId, message: `secret ${V4_API_KEY} candidate-bytes`, retryable: false,
      } }, { status }); },
      sleepImpl: async () => assert.fail("terminal HTTP disposition must not retry"),
    }), error => {
      assert.equal(error.details.code, code);
      assert.equal(error.details.httpStatus, status);
      assert.equal(error.details.requestId, requestId);
      assert.equal(formatCliError(error).includes(V4_API_KEY), false);
      assert.equal(formatCliError(error).includes("candidate-bytes"), false);
      return true;
    });
    assert.equal(calls, 1);
  });
}

test("transport ambiguity redacts exception echoes and retains the existing terminal code", async () => {
  let calls = 0;
  await assert.rejects(getLaunchCapabilities({ apiVersion: 4, chainId: "4663", maxAttempts: 2,
    fetchImpl: async () => { calls += 1; throw new Error(`Bearer ${V4_API_KEY} candidate-bytes`); },
    sleepImpl: async () => {},
  }), error => {
    assert.equal(error.details.code, "AMBIGUOUS_TRANSPORT_RESULT");
    assert.equal(error.details.cause, "TRANSPORT_FAILURE");
    assert.equal(JSON.stringify(error).includes(V4_API_KEY), false);
    assert.equal(formatCliError(error).includes("candidate-bytes"), false);
    return true;
  });
  assert.equal(calls, 2);
});

for (const chunk of [new Uint8Array(0), Uint8Array.of(0x20)]) {
  test(`synchronously refilled ${chunk.length}-byte chunks cannot starve the request deadline`, async () => {
    let pulls = 0;
    let cancellations = 0;
    const startedAt = performance.now();
    const response = new Response(new ReadableStream({
      pull(controller) {
        pulls += 1;
        // Finite even for a regressed decoder: do not hang the test runner when
        // its own timers are starved by the same microtask-only read loop.
        if (performance.now() - startedAt >= 1000) controller.close();
        else controller.enqueue(chunk);
      },
      cancel() { cancellations += 1; },
    }, { highWaterMark: 0 }));
    await assert.rejects(getLaunchCapabilities({ apiVersion: 4, chainId: "4663",
      timeoutMs: 250, maxAttempts: 1, fetchImpl: async () => response,
      sleepImpl: async () => assert.fail("last timeout must stop"),
    }), error => {
      assert.equal(error.details.code, "AMBIGUOUS_TRANSPORT_RESULT");
      assert.equal(error.details.cause, "REQUEST_TIMEOUT");
      return true;
    });
    assert.ok(pulls >= 256);
    assert.equal(cancellations, 1);
  });
}
