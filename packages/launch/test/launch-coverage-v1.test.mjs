import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";

import { ProgrammableApiError } from "../src/api-client.mjs";
import { formatCliError, main } from "../src/cli.mjs";
import {
  assertRobinhoodLaunchCoverageV1,
  getRobinhoodLaunchCoverageV1,
  ROBINHOOD_LAUNCH_COVERAGE_URL_V1,
} from "../src/index.mjs";
import { normalizeV4ProfileRef } from "../src/v4-contract.mjs";

const readJson = async relative => JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));
const fixture = await readJson("./fixtures/launch-coverage-v1.json");
const schema = await readJson("../schemas/robinhood-launch-coverage-v1.json");
const ajv = new Ajv2020({ allErrors: true });
const validate = ajv.compile(schema);
const report = () => structuredClone(fixture);
const response = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const errorCode = code => error => error instanceof ProgrammableApiError && error.details.code === code;

test("backend-produced report has identical public, packaged and OpenAPI contracts", async () => {
  assert.deepEqual(await readJson("../../../public/schemas/custom-launch/coverage/v1.json"), schema);
  const { $schema, $id, title, description, ...shape } = schema;
  assert.equal($schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal($id, "https://programmable.market/schemas/custom-launch/coverage/v1.json");
  assert.ok(title);
  assert.match(description, /never authorizes a launch/u);
  const openapi = await readJson("../../../public/openapi/launch-coverage-v1.json");
  assert.deepEqual(openapi.components.schemas.RobinhoodLaunchCoverageV1, shape);
  assert.deepEqual(openapi.security, []);
  assert.deepEqual(openapi.paths["/v4/chains/4663/launch-coverage"].get.security, []);
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors));
  assert.equal(assertRobinhoodLaunchCoverageV1(fixture), fixture);
  for (const profile of schema.properties.profile.enum.filter(Boolean)) {
    assert.deepEqual(normalizeV4ProfileRef(profile), profile);
  }
});

test("coverage reads the fixed public route without credentials or a request body", async () => {
  let calls = 0;
  const result = await getRobinhoodLaunchCoverageV1({ chainId: "4663", fetchImpl: async (url, init) => {
    calls++;
    assert.equal(url, ROBINHOOD_LAUNCH_COVERAGE_URL_V1);
    assert.equal(new URL(url).search, "");
    assert.deepEqual(Object.keys(init).sort(), ["headers", "method", "redirect", "signal"]);
    assert.deepEqual(init.headers, { accept: "application/json" });
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    return response(report());
  } });
  assert.equal(calls, 1);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.resource.readiness.status, "ready");
  assert.equal(result.resource.structuralFormat.roleAssignments.tokenAndHookMayShareAddress, false);
  assert.equal(result.resource.requestAuthorization.requestAuthorized, false);
});

test("unavailable and historical profiles remain readable without claiming activated proofs", () => {
  for (const profile of [null, schema.properties.profile.enum.find(value => value?.profileVersion === "4.0.0")]) {
    const value = report();
    value.profile = profile;
    value.readiness = { status: "unavailable", reasonCodes: ["CHAIN_DEPLOYMENT_UNAVAILABLE"] };
    value.verifierCoverage.seedV1.status = "unavailable";
    assert.equal(validate(value), true, JSON.stringify(validate.errors));
    assert.equal(assertRobinhoodLaunchCoverageV1(value), value);
    value.verifierCoverage.seedV1.status = "proof-available";
    assert.throws(() => assertRobinhoodLaunchCoverageV1(value), /selected profile/u);
  }
});

test("candidate and server-activated module proof statuses never imply a public request surface", () => {
  for (const status of ["candidate", "proof-available"]) {
    const value = report();
    value.verifierCoverage.moduleSeedV2.status = status;
    assert.equal(assertRobinhoodLaunchCoverageV1(value), value);
    assert.equal(value.verifierCoverage.moduleSeedV2.publiclyLaunchable, false);
    assert.equal(value.verifierCoverage.moduleSeedV2.publicRequestSurface, "none-versioned-transport-required");
  }
});

test("unknown legitimate finding codes remain unclassified and uncleared", () => {
  const value = report();
  const unknown = { ...structuredClone(value.findingObligations[0]), code: "FUTURE_ARCHITECTURE_EVIDENCE_REQUIRED",
    recognized: false, category: "unclassified", retryable: false };
  value.findingObligations.push(unknown);
  assert.equal(validate(value), true, JSON.stringify(validate.errors));
  assert.deepEqual(assertRobinhoodLaunchCoverageV1(value).findingObligations.at(-1), unknown);
  assert.equal(unknown.findingCleared, false);
  assert.equal(unknown.callerSuppliedProofAccepted, false);
  for (const mutation of [entry => { entry.retryable = true; }, entry => { entry.category = "source-repair"; }]) {
    const changed = structuredClone(value);
    mutation(changed.findingObligations.at(-1));
    assert.throws(() => assertRobinhoodLaunchCoverageV1(changed), /unclassified/u);
  }
});

test("closed shape rejects unsupported version, profile, roles and fabricated approval", () => {
  for (const mutate of [
    value => { value.schemaVersion = "programmable.robinhood-launch-coverage.v2"; },
    value => { value.profile.profileVersion = "4.2.0"; },
    value => { value.profile.profileDigest = `sha256:${"0".repeat(64)}`; },
    value => { delete value.structuralFormat; },
    value => { value.authorized = true; },
    value => { value.structuralFormat.roleAssignments.tokenAndHookMayShareAddress = true; },
    value => { value.structuralFormat.poolTopology.noPoolRepresentable = true; },
    value => { value.requestAuthorization.requestAuthorized = true; },
    value => { value.requestAuthorization.permitIssued = true; },
    value => { value.verifierCoverage.moduleSeedV2.publiclyLaunchable = true; },
    value => { value.findingObligations[0].findingCleared = true; },
    value => { value.findingObligations[0].callerSuppliedProofAccepted = true; },
    value => { value.findingObligations[0].actions[0].path = "https://external.invalid/submit"; },
    value => { value.findingObligations[0].actions[0].instruction = "unsafe\u001b[2J"; },
  ]) {
    const value = report();
    mutate(value);
    assert.equal(validate(value), false);
    assert.throws(() => assertRobinhoodLaunchCoverageV1(value));
  }
});

test("duplicate findings and mismatched action routes cannot be presented as valid guidance", () => {
  const duplicate = report();
  duplicate.findingObligations.push(duplicate.findingObligations[0]);
  assert.throws(() => assertRobinhoodLaunchCoverageV1(duplicate), /duplicate finding/u);
  const swapped = report();
  swapped.findingObligations[0].actions[0].method = "GET";
  assert.throws(() => assertRobinhoodLaunchCoverageV1(swapped), /documented method/u);
});

test("old deployment and unexpected auth errors cannot be mistaken for a bad API key", async () => {
  for (const status of [401, 403, 404, 405, 501, 503]) {
    await assert.rejects(getRobinhoodLaunchCoverageV1({ chainId: "4663", fetchImpl: async () => new Response(
      "untrusted response says rotate secret example-secret-must-not-appear", { status, headers: { "retry-after": "2" } },
    ) }), error => {
      assert.equal(error.details.code, "LAUNCH_COVERAGE_UNAVAILABLE");
      assert.equal(error.details.httpStatus, status);
      assert.match(error.message, status === 401 || status === 403 ? /requires no API key/u : /do not.*replace your API key/u);
      assert.doesNotMatch(formatCliError(error), /example-secret-must-not-appear/u);
      return true;
    });
  }
});

test("network errors, including fetch TypeError, report unavailable coverage", async () => {
  await assert.rejects(getRobinhoodLaunchCoverageV1({ chainId: "4663", fetchImpl: async () => {
    throw new TypeError("fetch failed");
  } }), errorCode("LAUNCH_COVERAGE_UNAVAILABLE"));
});

test("timeout aborts the public read without falling back to an authenticated request", async () => {
  let calls = 0;
  await assert.rejects(getRobinhoodLaunchCoverageV1({ chainId: "4663", timeoutMs: 250,
    fetchImpl: async (_url, { signal }) => {
      calls++;
      return await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    },
  }), errorCode("LAUNCH_COVERAGE_UNAVAILABLE"));
  assert.equal(calls, 1);
});

test("successful responses reject duplicate keys, invalid UTF-8, oversized bodies and wrong shape", async () => {
  for (const bytes of [
    '{"schemaVersion":"a","schemaVersion":"b"}',
    Buffer.from([0xc0, 0xaf]),
    " ".repeat(131_073),
    JSON.stringify({ ...report(), requestAuthorization: { requestAuthorized: true } }),
  ]) {
    await assert.rejects(getRobinhoodLaunchCoverageV1({ chainId: "4663", fetchImpl: async () => new Response(bytes) }),
      errorCode("LAUNCH_COVERAGE_INVALID_RESPONSE"));
  }
});

test("the response byte limit cancels an oversized stream immediately", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(131_073)); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(getRobinhoodLaunchCoverageV1({ chainId: "4663", fetchImpl: async () => new Response(body) }),
    errorCode("LAUNCH_COVERAGE_INVALID_RESPONSE"));
  assert.equal(cancelled, true);
});

test("chain selection and timeout fail before any network call", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return response(report()); };
  for (const chainId of [undefined, "1", 4663, "4663?key=example", "4663/custom-launches"]) {
    await assert.rejects(getRobinhoodLaunchCoverageV1({ chainId, fetchImpl }), /explicit --chain-id 4663/u);
  }
  for (const timeoutMs of [0, 249, 300_001, Infinity, "15000"]) {
    await assert.rejects(getRobinhoodLaunchCoverageV1({ chainId: "4663", timeoutMs, fetchImpl }), /timeoutMs/u);
  }
  assert.equal(calls, 0);
});

test("coverage CLI reads public report, explains its boundary and rejects unrelated options", async () => {
  const originalFetch = globalThis.fetch;
  const originalWrite = process.stdout.write;
  let output = "";
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, ROBINHOOD_LAUNCH_COVERAGE_URL_V1);
    assert.deepEqual(init.headers, { accept: "application/json" });
    return response(report());
  };
  process.stdout.write = chunk => { output += String(chunk); return true; };
  try {
    await main(["coverage", "--chain-id", "4663"]);
    assert.equal(JSON.parse(output).resource.requestAuthorization.requestAuthorized, false);
    output = "";
    await main(["coverage", "--help"]);
    assert.match(output, /no API key/u);
    assert.match(output, /does not authorize/u);
    for (const args of [["--api-version", "4"], ["--config", "x.json"], ["--watch"], ["--remote"],
      ["--api-key", "example"], ["--api-origin", "https://external.invalid"], ["launch.json"]]) {
      await assert.rejects(main(["coverage", "--chain-id", "4663", ...args]));
    }
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; process.stdout.write = originalWrite; }
});
