import assert from "node:assert/strict";
import test from "node:test";

import { statusLaunch, submitLaunch } from "../src/api-client.mjs";
import { main } from "../src/cli.mjs";
import {
  AGENT_ATTESTATION_SCHEMA,
  AGENT_ATTESTATION_SCHEMA_V2,
  CREATE_PATH,
  CREATE_PATH_V1,
  CREATE_PATH_V2,
  CREATE_PATH_V3,
  CREATE_REQUEST_SCHEMA,
  CREATE_REQUEST_SCHEMA_V3,
  OPENAPI_URL,
  OPENAPI_URL_V3,
  PACK_CONFIG_SCHEMA,
  PACK_CONFIG_SCHEMA_V3,
  PACKAGE_VERSION,
  DIRECT_NATIVE_PROFILE_REVISION,
  DIRECT_NATIVE_PROFILE_REVISION_V2,
  DIRECT_NATIVE_PROFILE_REVISION_V3,
  DIRECT_NATIVE_PROFILE_VERSION,
  DIRECT_NATIVE_PROFILE_VERSION_V2,
  DIRECT_NATIVE_PROFILE_VERSION_V3,
  DIRECT_NATIVE_PROFILE_VERSION_V3_COMPLETE_METADATA_LEGACY,
  DIRECT_NATIVE_PROFILE_VERSION_V3_LEGACY,
  DIRECT_NATIVE_PROFILE_VERSION_V3_METADATA_LEGACY,
  DIRECT_NATIVE_PROFILE_VERSION_V3_PRE_METADATA,
} from "../src/constants.mjs";

const REQUEST_ID = "60000000-0000-4000-8000-000000000006";

test("package 4 retains generic V3 aliases for unchanged default behavior", () => {
  assert.equal(PACK_CONFIG_SCHEMA, PACK_CONFIG_SCHEMA_V3);
  assert.equal(CREATE_REQUEST_SCHEMA, CREATE_REQUEST_SCHEMA_V3);
  assert.equal(AGENT_ATTESTATION_SCHEMA, AGENT_ATTESTATION_SCHEMA_V2);
  assert.equal(CREATE_PATH, CREATE_PATH_V3);
  assert.equal(OPENAPI_URL, OPENAPI_URL_V3);
  assert.equal(PACKAGE_VERSION, "4.1.1");
  assert.equal(DIRECT_NATIVE_PROFILE_REVISION, DIRECT_NATIVE_PROFILE_REVISION_V3);
  assert.equal(DIRECT_NATIVE_PROFILE_REVISION, 3);
  assert.equal(
    DIRECT_NATIVE_PROFILE_VERSION,
    DIRECT_NATIVE_PROFILE_VERSION_V3_COMPLETE_METADATA_LEGACY,
  );
  assert.equal(DIRECT_NATIVE_PROFILE_VERSION, "3.3.0");
  assert.equal(DIRECT_NATIVE_PROFILE_VERSION_V3, "3.4.0");
  assert.equal(DIRECT_NATIVE_PROFILE_VERSION_V3_COMPLETE_METADATA_LEGACY, "3.3.0");
  assert.equal(DIRECT_NATIVE_PROFILE_VERSION_V3_METADATA_LEGACY, "3.2.0");
  assert.equal(DIRECT_NATIVE_PROFILE_VERSION_V3_PRE_METADATA, "3.1.0");
  assert.equal(DIRECT_NATIVE_PROFILE_VERSION_V3_LEGACY, "3.0.0");
  assert.equal(DIRECT_NATIVE_PROFILE_REVISION_V2, 2);
  assert.equal(DIRECT_NATIVE_PROFILE_VERSION_V2, "2.0.0");
});

test("status defaults to V3 while explicit V1 and V2 reads remain available", async () => {
  const urls = [];
  const read = async (apiVersion) => statusLaunch({
    requestId: REQUEST_ID,
    ...(apiVersion === undefined ? {} : { apiVersion }),
    apiOrigin: "https://api.programmable.market",
    maxAttempts: 1,
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({
        requestId: REQUEST_ID,
        status: "received",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
    loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
  });

  await read(undefined);
  await read("1");
  await read("v2");

  assert.deepEqual(urls, [
    `https://api.programmable.market${CREATE_PATH_V3}/${REQUEST_ID}`,
    `https://api.programmable.market${CREATE_PATH_V1}/${REQUEST_ID}`,
    `https://api.programmable.market${CREATE_PATH_V2}/${REQUEST_ID}`,
  ]);
});

for (const schemaVersion of [
  "programmable.custom-launch-create-request.v1",
  "programmable.custom-launch-create-request.v2",
]) {
  test(`submit rejects ${schemaVersion} locally before secrets, state, or network`, async () => {
    let apiKeyReads = 0;
    let networkCalls = 0;
    let requestByteReads = 0;
    await assert.rejects(
      () => submitLaunch({
        launchPath: "/nonexistent/legacy-launch.json",
        configPath: "/nonexistent/legacy-config.json",
        validateLaunchFileImpl: async () => ({
          schemaVersion,
          requestSha256: `sha256:${"00".repeat(32)}`,
        }),
        readLaunchBytesImpl: async () => {
          requestByteReads += 1;
          return Buffer.from("{}");
        },
        loadApiKeyImpl: async () => {
          apiKeyReads += 1;
          return "must-not-be-read";
        },
        fetchImpl: async () => {
          networkCalls += 1;
          throw new Error("must not make a request");
        },
      }),
      /LEGACY_SUBMISSION_READ_ONLY.*V1 and V2 launch creation are read-only/u,
    );
    assert.equal(requestByteReads, 0);
    assert.equal(apiKeyReads, 0);
    assert.equal(networkCalls, 0);
  });
}

test("CLI help identifies V3 as the default and current public release", async () => {
  let output = "";
  const originalWrite = process.stdout.write;
  process.stdout.write = (chunk) => {
    output += String(chunk);
    return true;
  };
  try {
    await main(["status", "--help"]);
  } finally {
    process.stdout.write = originalWrite;
  }
  assert.match(output, /V3 is the default/u);
  assert.match(output, /Public V3 release/u);
  assert.match(output, /OpenAPI V2 \(read compatibility; create fenced\)/u);
  assert.doesNotMatch(output, /V2 remains the default/u);
  assert.doesNotMatch(output, /V2 \(public create\)/u);
});
