import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import solc from "solc";
import { encodeAbiParameters, keccak256 } from "viem";

import {
  ProgrammableApiError,
  statusLaunch,
  submitLaunch,
} from "../src/api-client.mjs";
import { formatCliError } from "../src/cli.mjs";
import {
  CREATE_REQUEST_SCHEMA_V3,
  HOOK_PERMISSION_BITS,
  HOOK_PERMISSIONS,
} from "../src/constants.mjs";
import { buildLaunch, packLaunch } from "../src/pack.mjs";
import { hashLaunchProfile, resolveLaunchProfile } from "../src/profile-v2.mjs";
import { sha256Digest } from "../src/io.mjs";
import { validateLaunchFile, validateLaunchRequest } from "../src/validate.mjs";
import { jsonResponse, validCapabilities } from "./fixtures/capabilities.mjs";

test("pack derives byte-identical exact-source requests from real solc output", async () => {
  const fixture = await materializeCompiledFixture();
  const first = await packLaunch({
    configPath: fixture.configPath,
    outputPath: path.join(fixture.root, "first-launch.json"),
  });
  const second = await packLaunch({
    configPath: fixture.configPath,
    outputPath: path.join(fixture.root, "second-launch.json"),
  });
  assert.deepEqual(Object.keys(first), [
    "outputPath",
    "receiptPath",
    "requestSha256",
    "graphBundleHash",
    "verificationBundleHash",
    "predictions",
  ]);
  const built = await buildLaunch({ configPath: fixture.configPath });
  assert.deepEqual(Object.keys(built), [
    "configDirectory",
    "request",
    "requestBytes",
    "receipt",
    "receiptBytes",
    "requestSha256",
    "graphBundleHash",
    "verificationBundleHash",
    "predictions",
  ]);
  const firstBytes = await readFile(first.outputPath);
  const secondBytes = await readFile(second.outputPath);
  assert.deepEqual(firstBytes, secondBytes);
  assert.equal(first.requestSha256, second.requestSha256);
  assert.match(first.graphBundleHash, /^sha256:[0-9a-f]{64}$/);
  assert.match(first.verificationBundleHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.predictions.length, 2);

  const validated = await validateLaunchFile({
    launchPath: first.outputPath,
    configPath: fixture.configPath,
  });
  assert.equal(validated.exactSourceIncluded, true);
  assert.equal(validated.reproducedFromConfig, true);
  assert.equal(validated.requestSha256, first.requestSha256);
});

test("submit persists exact bytes and retries ambiguity with the same key", async () => {
  const fixture = await materializeCompiledFixture();
  const packed = await packLaunch({ configPath: fixture.configPath });
  const stateDirectory = path.join(fixture.root, "state");
  const calls = [];
  const sleeps = [];
  const fetchImpl = async (_url, options) => {
    if (options.method === "GET") return jsonResponse(validCapabilities());
    calls.push({
      body: Buffer.from(options.body),
      idempotencyKey: options.headers["idempotency-key"],
      authorization: options.headers.authorization,
    });
    if (calls.length === 1) throw new Error("socket closed after upload");
    return new Response(JSON.stringify({
      schemaVersion: "programmable.custom-launch.v3",
      launchId: "8d89c4e5-ec5f-4df7-8f52-10f134d25cab",
      requestId: "8d89c4e5-ec5f-4df7-8f52-10f134d25cab",
      status: "received",
    }), { status: 202, headers: { "content-type": "application/json" } });
  };
  const result = await submitLaunch({
    launchPath: packed.outputPath,
    configPath: fixture.configPath,
    idempotencyKey: "clean-room-retry-0001",
    apiOrigin: "https://api.programmable.market",
    stateDirectory,
    maxAttempts: 2,
    validateLaunchFileImpl: v3Validation(packed),
    fetchImpl,
    sleepImpl: async (milliseconds) => sleeps.push(milliseconds),
    loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].body, calls[1].body);
  assert.equal(calls[0].idempotencyKey, calls[1].idempotencyKey);
  assert.equal(sleeps.length, 1);
  assert.equal(result.httpStatus, 202);
  const journal = await readFile(result.journalPath, "utf8");
  assert.ok(journal.includes(packed.requestSha256));
  assert.ok(!journal.includes("pm_live_publictest_secretvalue"));
  assert.ok(!journal.toLowerCase().includes("authorization"));
});

test("submit refuses an idempotency key rebound to different request bytes", async () => {
  const fixture = await materializeCompiledFixture();
  const packed = await packLaunch({ configPath: fixture.configPath });
  const stateDirectory = path.join(fixture.root, "state-conflict");
  const fetchImpl = async (_url, options) => options.method === "GET"
    ? jsonResponse(validCapabilities())
    : new Response(JSON.stringify({
      requestId: "36dd2926-e4f0-445e-9503-46be9989c50f",
      launchId: "36dd2926-e4f0-445e-9503-46be9989c50f",
      status: "received",
    }), { status: 202, headers: { "content-type": "application/json" } });
  const common = {
    configPath: fixture.configPath,
    idempotencyKey: "binding-conflict-0001",
    apiOrigin: "https://api.programmable.market",
    stateDirectory,
    maxAttempts: 1,
    fetchImpl,
    loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
  };
  await submitLaunch({
    ...common,
    launchPath: packed.outputPath,
    validateLaunchFileImpl: v3Validation(packed),
  });
  const changedConfig = JSON.parse(await readFile(fixture.configPath, "utf8"));
  changedConfig.nonce = `0x${"45".repeat(32)}`;
  changedConfig.targets[1].applicantSalt = {
    mode: "deterministic-hook-permission-grind-v1",
    start: "0",
    maxAttempts: "262144",
  };
  await writeFile(fixture.configPath, `${JSON.stringify(changedConfig, null, 2)}\n`, "utf8");
  const alternate = path.join(fixture.root, "alternate-launch.json");
  const alternatePacked = await packLaunch({
    configPath: fixture.configPath,
    outputPath: alternate,
  });
  await assert.rejects(
    () => submitLaunch({
      ...common,
      launchPath: alternate,
      validateLaunchFileImpl: v3Validation(alternatePacked),
    }),
    /IDEMPOTENCY_BINDING_CONFLICT/,
  );
});

test("concurrent first submit atomically binds one body to an idempotency key", async () => {
  const [firstFixture, secondFixture] = await Promise.all([
    materializeCompiledFixture(),
    materializeCompiledFixture(),
  ]);
  const secondConfig = JSON.parse(await readFile(secondFixture.configPath, "utf8"));
  secondConfig.nonce = `0x${"46".repeat(32)}`;
  secondConfig.targets[1].applicantSalt = {
    mode: "deterministic-hook-permission-grind-v1",
    start: "0",
    maxAttempts: "262144",
  };
  await writeFile(
    secondFixture.configPath,
    `${JSON.stringify(secondConfig, null, 2)}\n`,
    "utf8",
  );
  const [first, second] = await Promise.all([
    packLaunch({ configPath: firstFixture.configPath }),
    packLaunch({ configPath: secondFixture.configPath }),
  ]);
  const stateDirectory = path.join(firstFixture.root, "state-first-bind-race");
  const networkBodies = [];
  const common = {
    idempotencyKey: "atomic-first-binding-0001",
    apiOrigin: "https://api.programmable.market",
    stateDirectory,
    maxAttempts: 1,
    fetchImpl: async (_url, options) => {
      if (options.method === "GET") return jsonResponse(validCapabilities());
      networkBodies.push(Buffer.from(options.body));
      return new Response(JSON.stringify({
        requestId: "4af272f8-9f25-4bad-92fa-d2ab6579a9e2",
        launchId: "4af272f8-9f25-4bad-92fa-d2ab6579a9e2",
        status: "received",
      }), { status: 202, headers: { "content-type": "application/json" } });
    },
    loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
  };
  const settled = await Promise.allSettled([
    submitLaunch({
      ...common,
      launchPath: first.outputPath,
      configPath: firstFixture.configPath,
      validateLaunchFileImpl: v3Validation(first),
    }),
    submitLaunch({
      ...common,
      launchPath: second.outputPath,
      configPath: secondFixture.configPath,
      validateLaunchFileImpl: v3Validation(second),
    }),
  ]);
  assert.equal(settled.filter(({ status }) => status === "fulfilled").length, 1);
  const rejected = settled.find(({ status }) => status === "rejected");
  assert.match(rejected.reason.message, /IDEMPOTENCY_BINDING_CONFLICT/);
  assert.equal(networkBodies.length, 1);
  const fulfilled = settled.find(({ status }) => status === "fulfilled");
  const journal = JSON.parse(await readFile(fulfilled.value.journalPath, "utf8"));
  assert.deepEqual(Buffer.from(journal.requestBodyBase64, "base64"), networkBodies[0]);
  assert.equal(journal.requestSha256, fulfilled.value.requestSha256);
});

test("submit refuses network access without an artifact-bound config", async () => {
  const fixture = await materializeCompiledFixture();
  const packed = await packLaunch({ configPath: fixture.configPath });
  let networkCalls = 0;
  await assert.rejects(
    () => submitLaunch({
      launchPath: packed.outputPath,
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("unreachable");
      },
      loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
    }),
    /submit requires --config/,
  );
  assert.equal(networkCalls, 0);
});

test("submit refuses bytes changed after exact validation", async () => {
  const fixture = await materializeCompiledFixture();
  const packed = await packLaunch({ configPath: fixture.configPath });
  const exactBytes = await readFile(packed.outputPath);
  let networkCalls = 0;
  await assert.rejects(
    () => submitLaunch({
      launchPath: packed.outputPath,
      configPath: fixture.configPath,
      validateLaunchFileImpl: v3Validation(packed),
      readLaunchBytesImpl: async () => Buffer.concat([exactBytes, Buffer.from(" ")]),
      fetchImpl: async () => {
        networkCalls += 1;
        throw new Error("unreachable");
      },
      loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
    }),
    /SUBMISSION_BYTES_CHANGED_AFTER_VALIDATION/,
  );
  assert.equal(networkCalls, 0);
});

test("submit treats a V3 policy 409 as non-retryable", async () => {
  const fixture = await materializeCompiledFixture();
  const packed = await packLaunch({ configPath: fixture.configPath });
  let networkCalls = 0;
  await assert.rejects(() => submitLaunch({
    launchPath: packed.outputPath,
    configPath: fixture.configPath,
    idempotencyKey: "v3-policy-no-retry-0001",
    apiOrigin: "https://api.programmable.market",
    stateDirectory: path.join(fixture.root, "v3-policy-state"),
    maxAttempts: 5,
    validateLaunchFileImpl: v3Validation(packed),
    fetchImpl: async (_url, options) => {
      if (options.method === "GET") return jsonResponse(validCapabilities());
      networkCalls += 1;
      return new Response(JSON.stringify({
        error: {
          code: "PROFILE_INVALID",
          message: "The current V3.3 profile is required",
          requestId: "9be43bed-a5f2-4c15-b0d0-2f0f0ae942f0",
        },
      }), { status: 409, headers: { "content-type": "application/json" } });
    },
    sleepImpl: async () => assert.fail("409 responses must not be retried"),
    loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
  }), (error) => {
    assert.equal(error.details.httpStatus, 409);
    assert.equal(error.details.code, "PROFILE_INVALID");
    assert.equal(error.details.requestId, "9be43bed-a5f2-4c15-b0d0-2f0f0ae942f0");
    return true;
  });
  assert.equal(networkCalls, 1);
});

test("CLI renders only safe API error details", async () => {
  const apiKey = "pm_live_must_never_be_rendered";
  const requestBytes = '{"sourceDescriptor":"must-never-be-rendered"}';
  let caught;
  try {
    await statusLaunch({
      requestId: "836b6989-bac4-4f39-98ab-828c7231fbf1",
      maxAttempts: 1,
      apiOrigin: "https://api.programmable.market",
      fetchImpl: async () => new Response(JSON.stringify({
        error: {
          code: "RATE_LIMITED",
          message: `unsafe echo ${apiKey} ${requestBytes}`,
          requestId: "af9c0ec0-ff27-4a48-9ff5-8d99bc11e667",
          authorization: apiKey,
          requestBody: requestBytes,
        },
      }), {
        status: 429,
        headers: { "retry-after": "17", "content-type": "application/json" },
      }),
      loadApiKeyImpl: async () => apiKey,
    });
  } catch (error) {
    caught = error;
  }
  const rendered = formatCliError(caught);
  assert.equal(
    rendered,
    'Custom Launch API returned HTTP 429\nProgrammable API error details: {"code":"RATE_LIMITED","httpStatus":429,"requestId":"af9c0ec0-ff27-4a48-9ff5-8d99bc11e667","retryAfter":"17"}',
  );
  assert.ok(!rendered.includes(apiKey));
  assert.ok(!rendered.includes(requestBytes));
  assert.ok(!rendered.includes("authorization"));
  assert.ok(!rendered.includes("requestBody"));

  const rejectedDetails = formatCliError(new ProgrammableApiError(
    "Custom Launch API request failed",
    {
      code: apiKey,
      httpStatus: 999,
      requestId: apiKey,
      retryAfter: requestBytes,
      requestBody: requestBytes,
    },
  ));
  assert.equal(rejectedDetails, "Custom Launch API request failed");
});

test("status honors Retry-After and stops at the wallet handoff", async () => {
  const httpDate = new Date(Date.now() + 60_000).toUTCString();
  const responses = [
    new Response(JSON.stringify({ error: { code: "RATE_LIMIT", requestId: "support-1" } }), {
      status: 429,
      headers: { "retry-after": "2", "content-type": "application/json" },
    }),
    new Response(JSON.stringify({ error: { code: "TEMPORARY", requestId: "support-2" } }), {
      status: 503,
      headers: { "retry-after": httpDate, "content-type": "application/json" },
    }),
    new Response(JSON.stringify({
      requestId: "836b6989-bac4-4f39-98ab-828c7231fbf1",
      launchId: "836b6989-bac4-4f39-98ab-828c7231fbf1",
      status: "authorized",
      output: {
        walletTransaction: {
          chainId: "1",
          from: "0x1111111111111111111111111111111111111111",
          to: "0x8622DD5bAb44185f2A458ac90384Ac99248f8d56",
          valueWei: "0",
          data: "0xe5f6b8cd",
        },
      },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  ];
  const sleeps = [];
  const result = await statusLaunch({
    requestId: "836b6989-bac4-4f39-98ab-828c7231fbf1",
    watch: true,
    until: "authorized",
    apiOrigin: "https://api.programmable.market",
    maxAttempts: 3,
    fetchImpl: async () => responses.shift(),
    sleepImpl: async (milliseconds) => sleeps.push(milliseconds),
    loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
  });
  assert.equal(result.walletHandoffReady, true);
  assert.equal(result.stopped, true);
  assert.equal(sleeps[0], 2_000);
  assert.ok(sleeps[1] >= 58_000 && sleeps[1] <= 60_000);
});

test("API retry covers stalled stream bodies and valid transient gateway responses", async () => {
  const sleeps = [];
  let calls = 0;
  const result = await statusLaunch({
    requestId: "836b6989-bac4-4f39-98ab-828c7231fbf1",
    maxAttempts: 3,
    timeoutMs: 250,
    apiOrigin: "https://api.programmable.market",
    fetchImpl: async (_url, options) => {
      calls += 1;
      if (calls === 1) {
        return new Response(new ReadableStream({
          pull() { return new Promise(() => {}); },
        }));
      }
      if (calls === 2) {
        return new Response(JSON.stringify({ error: { code: "UPSTREAM_BUSY" } }), {
          status: 503,
          headers: { "retry-after": "0", "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        requestId: "836b6989-bac4-4f39-98ab-828c7231fbf1",
        launchId: "836b6989-bac4-4f39-98ab-828c7231fbf1",
        status: "authorized",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
    sleepImpl: async (milliseconds) => sleeps.push(milliseconds),
    loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
  });
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [1_000, 0]);
  assert.equal(result.walletHandoffReady, true);

  await assert.rejects(() => statusLaunch({
    requestId: "836b6989-bac4-4f39-98ab-828c7231fbf1",
    maxAttempts: 1,
    apiOrigin: "https://api.programmable.market",
    fetchImpl: async () => new Response("bad gateway", {
      status: 503,
      headers: { "retry-after": "7", "content-type": "text/plain" },
    }),
    loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
  }), (error) => {
    assert.equal(error.details.httpStatus, 503);
    assert.equal(error.details.code, "API_RESPONSE_INVALID_JSON");
    assert.equal(error.details.retryAfter, "7");
    return true;
  });
});

test("the bundled no-broadcast example derives a real graph and deterministic hook salt", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-no-broadcast-"));
  const projectDirectory = path.join(root, "project");
  const exampleRoot = new URL("../examples/no-broadcast/", import.meta.url);
  await cp(new URL("project/", exampleRoot), projectDirectory, { recursive: true });
  const revision = "f6eb3e95dd7728c590c2a3bb115b6dd29c8c5607";
  execFileSync(process.execPath, [new URL("prepare-config.mjs", exampleRoot).pathname, projectDirectory], {
    env: {
      ...process.env,
      PROGRAMMABLE_LAUNCH_WALLET: "0x1111111111111111111111111111111111111111",
      PROGRAMMABLE_LAUNCH_NONCE: `0x${"91".repeat(32)}`,
      PROGRAMMABLE_SOURCE_REVISION: revision,
      PROGRAMMABLE_CHECKED_AT: "2026-08-25T12:00:00.000Z",
    },
    encoding: "utf8",
  });
  const rehearsalEvidence = JSON.parse(await readFile(
    path.join(projectDirectory, "evidence", "rehearsal.json"),
    "utf8",
  ));
  assert.deepEqual(rehearsalEvidence.scope, {
    pack: false,
    validate: false,
    submit: false,
    status: false,
    stopAt: "pre-submit",
    walletBroadcast: false,
  });
  const configPath = path.join(projectDirectory, "programmable-launch.config.json");
  const first = await packLaunch({
    configPath,
    outputPath: path.join(projectDirectory, "first.json"),
  });
  const second = await packLaunch({
    configPath,
    outputPath: path.join(projectDirectory, "second.json"),
  });
  assert.equal(
    first.requestSha256,
    "sha256:b44f9dc43b51bc69ca52ec6769b9e3d64cd9472387e2f5a3b83cf73078a029aa",
    "V1 request golden bytes must remain deterministic in @programmable/launch 2.0.0",
  );
  assert.deepEqual(await readFile(first.outputPath), await readFile(second.outputPath));
  const request = JSON.parse(await readFile(first.outputPath, "utf8"));
  const hook = request.graphBundle.targets.find(({ targetId }) => targetId === "hook");
  assert.match(hook.applicantSalt, /^0x[0-9a-f]{64}$/);
  const prediction = first.predictions.find(({ targetId }) => targetId === "hook");
  assert.equal(
    Number(BigInt(prediction.predictedAddress) & 0x3fffn),
    1 << HOOK_PERMISSION_BITS.afterInitialize,
  );
  assert.equal(request.verificationBundle.components.length, 2);
});

test("V2 binds a closed fee profile, launch intent, and compiler immutables", async () => {
  const fixture = await materializeV2CompiledFixture();
  const first = await packLaunch({
    configPath: fixture.configPath,
    outputPath: path.join(fixture.root, "v2-first.json"),
  });
  const second = await packLaunch({
    configPath: fixture.configPath,
    outputPath: path.join(fixture.root, "v2-second.json"),
  });
  assert.deepEqual(await readFile(first.outputPath), await readFile(second.outputPath));
  const request = JSON.parse(await readFile(first.outputPath, "utf8"));
  assert.equal(request.schemaVersion, "programmable.custom-launch-create-request.v2");
  assert.equal(
    request.launchProfile.profileId,
    "programmable.fee-enforced-isolated-after-swap.zero-delta.v1",
  );
  assert.equal(request.launchProfile.profileRevision, 3);
  assert.equal(request.launchProfile.productionLaunchAuthorized, true);
  assert.equal(request.launchProfile.contractBuildBindings.activationStatus, "production");
  assert.equal(
    request.launchProfile.feePolicy.policyId,
    "0xb7ff874d418bc714d0ec6c36a2df03ea6251bc8b6eb125adc4f5b6b4899d2517",
  );
  assert.equal(
    request.launchProfile.feePolicy.profileId,
    "0x4609b37c12248e1e8c98997685cc2e399a287344dea932b6ed703e4a99c532c2",
  );
  assert.equal(request.launchProfile.requiredHookPermissionMask, "0x2044");
  assert.equal(
    request.launchProfileSelection.profileParameters.customDeltaAccount,
    "0x0000000000000000000000000000000000000000",
  );
  assert.equal(
    request.launchProfileSelection.profileParameters.customModuleRuntimeCodeHash,
    request.graphBundle.targets.find(({ targetId }) => targetId === "custom-module")
      .expectedRuntimeCodeHash,
  );
  assert.match(request.launchProfileSelection.profileParameters.poolId, /^0x[0-9a-f]{64}$/);
  assert.match(
    request.launchProfileSelection.profileParameters.deploymentProfileHash,
    /^0x[0-9a-f]{64}$/,
  );
  assert.match(
    request.launchProfileSelection.profileParameters.compositionHash,
    /^0x[0-9a-f]{64}$/,
  );
  assert.equal(request.launchProfile.customHookPolicy.maximumCustomDeltaAbsolute, "0");
  assert.equal(request.agentAttestation.subjectLaunchIntentHash, request.launchIntentHash);
  assert.equal(
    request.verificationBundle.schemaVersion,
    "programmable.exact-source-verification-bundle.v2",
  );
  assert.equal(request.launchProfileHash, first.launchProfileHash);
  assert.equal(request.launchIntentHash, first.launchIntentHash);

  const predicted = new Map(first.predictions.map((entry) => [entry.targetId, entry.predictedAddress]));
  const runtimeAssignments = {
    token: {},
    "custom-module": {
      [fixture.immutableIds.customModule.controller]: ["address", fixture.launchWallet],
    },
    "fee-vault": {
      2534: ["address", "0x000000000004444c5dc75cB358380D2e3dE08A90"],
      2536: ["address", "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887"],
    },
    "fee-hook": {},
    "pool-initializer": {},
  };
  for (const target of request.graphBundle.targets) {
    assert.equal(
      target.expectedRuntimeCodeHash,
      independentlyMaterializedRuntimeHash(
        fixture.artifacts[target.targetId],
        runtimeAssignments[target.targetId],
      ),
    );
  }
  const validated = validateLaunchRequest(request);
  assert.equal(validated.launchProfileHash, request.launchProfileHash);
  assert.equal(validated.launchIntentHash, request.launchIntentHash);
  assert.equal(validated.exactSourceIncluded, true);
});

test("V2 embedded profile matches every distributed fixed-build asset digest", async () => {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const manifest = JSON.parse(
    await readFile(path.join(packageRoot, "contracts/profile-v2/manifest.json"), "utf8"),
  );
  const profile = resolveLaunchProfile({
    schemaVersion: "programmable.fee-enforced-launch-profile-selection.v1",
    profileId: manifest.profileId,
    profileRevision: manifest.profileRevision,
    targetRoles: {
      tokenTargetId: "token",
      customModuleTargetId: "custom-module",
      feeVaultTargetId: "fee-vault",
      feeHookTargetId: "fee-hook",
      poolInitializerTargetId: "pool-initializer",
    },
  });
  assert.equal(profile.contractBuildBindings.activationStatus, manifest.activationStatus);
  assert.equal(
    hashLaunchProfile(profile),
    "sha256:fd2d738117c4c69304efb49c75d402d2e8b8968832fd2e27548c3d9814c5c9ee",
  );
  const distributedOnly = new Set([
    "standardJsonAssetPath",
    "artifactAssetPath",
    "artifactContentSha256",
  ]);
  assert.deepEqual(
    manifest.components.map((component) => Object.fromEntries(
      Object.entries(component).filter(([key]) => !distributedOnly.has(key)),
    )),
    profile.contractBuildBindings.requiredComponents,
  );
  for (const source of manifest.sources) {
    assert.equal(
      sha256Digest(await readFile(path.join(packageRoot, source.assetPath))),
      source.contentSha256,
    );
  }
  for (const component of manifest.components) {
    assert.equal(
      sha256Digest(await readFile(path.join(packageRoot, component.standardJsonAssetPath))),
      component.standardJsonInputSha256,
    );
    assert.equal(
      sha256Digest(await readFile(path.join(packageRoot, component.artifactAssetPath))),
      component.artifactContentSha256,
    );
  }
});

test("V2 rejects profile, intent, attestation, verification, and graph mutations", async () => {
  const fixture = await materializeV2CompiledFixture();
  const built = await buildLaunch({ configPath: fixture.configPath });
  const mutate = (callback) => {
    const request = structuredClone(built.request);
    callback(request);
    return request;
  };
  assert.throws(
    () => validateLaunchRequest(mutate((request) => {
      request.launchProfile.feePolicy.ratePpm = "999";
    })),
    /closed embedded profile manifest/,
  );
  assert.throws(
    () => validateLaunchRequest(mutate((request) => {
      request.launchProfileHash = `sha256:${"00".repeat(32)}`;
    })),
    /launchProfileHash/,
  );
  assert.throws(
    () => validateLaunchRequest(mutate((request) => {
      request.launchIntentHash = `sha256:${"00".repeat(32)}`;
    })),
    /launchIntentHash/,
  );
  assert.throws(
    () => validateLaunchRequest(mutate((request) => {
      request.agentAttestation.subjectLaunchIntentHash = `sha256:${"00".repeat(32)}`;
    })),
    /not bound to the normalized launch intent/,
  );
  assert.throws(
    () => validateLaunchRequest(mutate((request) => {
      request.launchProfileSelection.profileParameters.customDeltaAccount =
        "0x2222222222222222222222222222222222222222";
    })),
    /launchProfileSelection/,
  );
  assert.throws(
    () => validateLaunchRequest(mutate((request) => {
      request.launchProfileSelection.profileParameters.compositionHash = `0x${"22".repeat(32)}`;
    })),
    /launchProfileSelection/,
  );
  assert.throws(
    () => validateLaunchRequest(mutate((request) => {
      request.graphBundle.targets.reverse();
    })),
    /exact canonical target order/,
  );
  assert.throws(
    () => validateLaunchRequest(mutate((request) => {
      request.verificationBundle.components[0]
        .runtimeMaterialization.deployedRuntimeCodeBase64 = Buffer.from("00", "hex").toString("base64");
    })),
    /runtime hash/,
  );
  assert.throws(
    () => validateLaunchRequest(mutate((request) => {
      const component = request.verificationBundle.components.find(
        ({ runtimeMaterialization }) => runtimeMaterialization.runtimeImmutables.some(
          (entry) => entry.abiType === "address" && Object.hasOwn(entry, "literal"),
        ),
      );
      const immutable = component.runtimeMaterialization.runtimeImmutables.find(
        (entry) => entry.abiType === "address" && Object.hasOwn(entry, "literal"),
      );
      immutable.literal = "0x2222222222222222222222222222222222222222";
    })),
    /immutable values do not reproduce the submitted runtime/,
  );
  assert.throws(
    () => validateLaunchRequest(mutate((request) => {
      delete request.verificationBundle;
    })),
    /verificationBundle/,
  );
  assert.throws(
    () => validateLaunchRequest(mutate((request) => {
      request.graphBundle.targets[0].expectedRuntimeCodeHash = `0x${"11".repeat(32)}`;
    })),
    /runtime hash|launchProfile|launchIntentHash/,
  );
  assert.throws(
    () => validateLaunchRequest(mutate((request) => {
      request.verificationBundle.components.find(({ targetId }) => targetId === "fee-hook")
        .contractName = "ProgrammableAdditiveFeeHookV2";
    })),
    /PROFILE_BUILD_MISMATCH: feeHook compiler identity differs/,
  );
});

test("V2 pack rejects constructor, initializer, and LP-fee policy mutations", async () => {
  const fixture = await materializeV2CompiledFixture();
  const cases = [
    {
      name: "token-controller",
      mutate(config) {
        config.targets.find(({ targetId }) => targetId === "token")
          .constructorArguments[3] = "0x2222222222222222222222222222222222222222";
      },
      error: /launch token constructor/,
    },
    {
      name: "hook-constructor-role-swap",
      mutate(config) {
        const hook = config.targets.find(({ targetId }) => targetId === "fee-hook");
        hook.constructorArguments = [
          { target: "custom-module" },
          { target: "fee-vault" },
        ];
      },
      error: /fee hook constructor target locators/,
    },
    {
      name: "vault-initializer-target",
      mutate(config) {
        const vault = config.targets.find(({ targetId }) => targetId === "fee-vault");
        vault.initializer.arguments = [{ target: "pool-initializer" }];
      },
      error: /fee vault initializer target locators/,
    },
    {
      name: "hook-pool-fee",
      mutate(config) {
        const hook = config.targets.find(({ targetId }) => targetId === "fee-hook");
        hook.initializer.arguments[0][2] = "3001";
      },
      error: /fee hook initializer must exactly bind/,
    },
    {
      name: "hook-pool-initializer-target",
      mutate(config) {
        const hook = config.targets.find(({ targetId }) => targetId === "fee-hook");
        hook.initializer.arguments[1] = { target: "fee-vault" };
      },
      error: /fee hook initializer target locators/,
    },
    {
      name: "pool-initializer-constructor-order",
      mutate(config) {
        const initializer = config.targets.find(
          ({ targetId }) => targetId === "pool-initializer",
        );
        [initializer.constructorArguments[0], initializer.constructorArguments[1]] = [
          initializer.constructorArguments[1],
          initializer.constructorArguments[0],
        ];
      },
      error: /pool initializer constructor target locators/,
    },
    {
      name: "dynamic-lp-fee",
      mutate(config) {
        config.pool.fee = 0x800bb8;
      },
      error: /pool fee is outside Uniswap v4 bounds|only disclosed static LP fees/,
    },
    {
      name: "excessive-static-lp-fee",
      mutate(config) {
        config.pool.fee = 100_001;
      },
      error: /only disclosed static LP fees/,
    },
  ];
  for (const scenario of cases) {
    const config = JSON.parse(await readFile(fixture.configPath, "utf8"));
    scenario.mutate(config);
    const configPath = path.join(fixture.root, `${scenario.name}.json`);
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    await assert.rejects(
      () => buildLaunch({ configPath }),
      scenario.error,
      scenario.name,
    );
  }
});

test("V2 submit is locally fenced while historical status keeps the V2 path", async () => {
  const fixture = await materializeV2CompiledFixture();
  const packed = await packLaunch({ configPath: fixture.configPath });
  const urls = [];
  let submitApiKeyReads = 0;
  await assert.rejects(() => submitLaunch({
    launchPath: packed.outputPath,
    configPath: fixture.configPath,
    idempotencyKey: "fee-enforced-v2-route-0001",
    apiOrigin: "https://api.programmable.market",
    stateDirectory: path.join(fixture.root, "v2-state"),
    maxAttempts: 1,
    fetchImpl: async (url) => {
      urls.push(url);
      throw new Error("V2 submit must not reach the network");
    },
    loadApiKeyImpl: async () => {
      submitApiKeyReads += 1;
      return "must-not-be-read";
    },
  }), /LEGACY_SUBMISSION_READ_ONLY/);
  assert.equal(submitApiKeyReads, 0);
  assert.deepEqual(urls, []);

  const statusResult = await statusLaunch({
    requestId: "515a4b20-a7bd-40e1-8cfa-f6da5457036b",
    apiVersion: 2,
    apiOrigin: "https://api.programmable.market",
    maxAttempts: 1,
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({
        requestId: "515a4b20-a7bd-40e1-8cfa-f6da5457036b",
        launchId: "515a4b20-a7bd-40e1-8cfa-f6da5457036b",
        status: "received",
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
    loadApiKeyImpl: async () => "pm_live_publictest_secretvalue",
  });
  assert.equal(
    urls[0],
    "https://api.programmable.market/v2/custom-launches/515a4b20-a7bd-40e1-8cfa-f6da5457036b",
  );
  assert.equal(statusResult.resource.status, "received");
});

test("V2 pack rejects executable custom-module delegation opcodes", async () => {
  const fixture = await materializeV2CompiledFixture({ dangerousCustomModule: true });
  await assert.rejects(
    () => buildLaunch({ configPath: fixture.configPath }),
    /CUSTOM_MODULE_FORBIDDEN_OPCODE:.*DELEGATECALL/,
  );
});

function v3Validation(packed) {
  return async () => ({
    schemaVersion: CREATE_REQUEST_SCHEMA_V3,
    requestSha256: packed.requestSha256,
  });
}

async function materializeV2CompiledFixture({ dangerousCustomModule = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-launch-v2-cli-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "out"), { recursive: true });
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await cp(
    path.join(packageRoot, "contracts", "profile-v2"),
    path.join(root, "profile-v2"),
    { recursive: true },
  );
  const launchWallet = "0x1111111111111111111111111111111111111111";
  const initialSqrtPriceX96 = "79228162514264337593543950336";
  const sources = {
    "src/CustomModule.sol": {
      content: dangerousCustomModule
        ? "// SPDX-License-Identifier: UNLICENSED\npragma solidity 0.8.26; contract CustomModule { address public immutable controller; constructor(address controller_) { controller = controller_; } function afterSwap(address target) external returns (int128 result) { assembly { let ok := delegatecall(gas(), target, 0, 0, 0, 0) if iszero(ok) { revert(0, 0) } } return 0; } }\n"
        : "// SPDX-License-Identifier: UNLICENSED\npragma solidity 0.8.26; contract CustomModule { address public immutable controller; constructor(address controller_) { controller = controller_; } function afterSwap(bytes calldata) external returns (int128) { require(msg.sender != address(0)); return 0; } }\n",
    },
  };
  for (const [sourcePath, { content }] of Object.entries(sources)) {
    await writeFile(path.join(root, sourcePath), content, "utf8");
  }
  const standardJson = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      metadata: { bytecodeHash: "ipfs", appendCBOR: true, useLiteralContent: true },
      libraries: {},
      remappings: [],
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"],
          "": ["ast"],
        },
      },
    },
  };
  await writeFile(
    path.join(root, "standard-json-input.json"),
    `${JSON.stringify(standardJson)}\n`,
    "utf8",
  );
  const output = JSON.parse(solc.compile(JSON.stringify(standardJson)));
  const errors = (output.errors ?? []).filter(({ severity }) => severity === "error");
  assert.deepEqual(errors, []);
  const customContract = output.contracts["src/CustomModule.sol"].CustomModule;
  const customArtifact = {
    abi: customContract.abi,
    bytecode: customContract.evm.bytecode,
    deployedBytecode: customContract.evm.deployedBytecode,
    metadata: customContract.metadata,
  };
  await writeFile(
    path.join(root, "out", "CustomModule.json"),
    `${JSON.stringify(customArtifact)}\n`,
    "utf8",
  );
  const artifacts = {
    token: JSON.parse(await readFile(path.join(root, "profile-v2/artifacts/token.json"), "utf8")),
    "custom-module": customArtifact,
    "fee-vault": JSON.parse(
      await readFile(path.join(root, "profile-v2/artifacts/vault.json"), "utf8"),
    ),
    "fee-hook": JSON.parse(
      await readFile(path.join(root, "profile-v2/artifacts/isolated-hook.json"), "utf8"),
    ),
    "pool-initializer": JSON.parse(
      await readFile(path.join(root, "profile-v2/artifacts/initializer.json"), "utf8"),
    ),
  };
  const immutableIds = {
    customModule: immutableIdsByName(output.sources["src/CustomModule.sol"].ast),
  };
  await writeFile(path.join(root, "compiler-evidence.json"), `${JSON.stringify({
    compilerVersion: solc.version(),
    errorCount: errors.length,
  })}\n`, "utf8");
  const repositoryRoot = path.resolve(process.cwd(), "../..");
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  const config = {
    schemaVersion: "programmable.launch-pack-config.v2",
    launchWallet,
    chainId: "1",
    nonce: `0x${"62".repeat(32)}`,
    source: {
      root: ".",
      paths: ["src", "profile-v2/sources"],
      sourceLineageNonce: "2",
      publicOrigin: {
        url: "https://github.com/0xprogrammable/PROGRAMMABLE",
        revision,
      },
    },
    compilationUnits: [
      { compilationUnitId: "custom-module-solc", standardJson: "standard-json-input.json" },
      { compilationUnitId: "profile-token", standardJson: "profile-v2/standard-json/token.json" },
      { compilationUnitId: "profile-vault", standardJson: "profile-v2/standard-json/vault.json" },
      { compilationUnitId: "profile-hook", standardJson: "profile-v2/standard-json/hook.json" },
      {
        compilationUnitId: "profile-initializer",
        standardJson: "profile-v2/standard-json/initializer.json",
      },
    ],
    targets: [
      {
        targetId: "token",
        compilationUnitId: "profile-token",
        artifact: "profile-v2/artifacts/token.json",
        applicantSalt: `0x${"00".repeat(32)}`,
        constructorArguments: [
          "Synthetic Token",
          "SYN",
          "1000000000000000000000000",
          launchWallet,
        ],
        initializer: null,
        deploymentValueWei: "0",
        initializerValueWei: "0",
        componentKind: "token",
        declaredHookPermissions: null,
        runtimeImmutables: [],
      },
      {
        targetId: "custom-module",
        compilationUnitId: "custom-module-solc",
        artifact: "out/CustomModule.json",
        applicantSalt: `0x${"02".repeat(32)}`,
        constructorArguments: [launchWallet],
        initializer: null,
        deploymentValueWei: "0",
        initializerValueWei: "0",
        componentKind: "other",
        declaredHookPermissions: null,
        runtimeImmutables: [{
          immutableId: immutableIds.customModule.controller,
          abiType: "address",
          literal: launchWallet,
        }],
      },
      {
        targetId: "fee-vault",
        compilationUnitId: "profile-vault",
        artifact: "profile-v2/artifacts/vault.json",
        applicantSalt: `0x${"01".repeat(32)}`,
        constructorArguments: [],
        initializer: { function: "bindAdapter", arguments: [{ target: "fee-hook" }] },
        deploymentValueWei: "0",
        initializerValueWei: "0",
        componentKind: "other",
        declaredHookPermissions: null,
        runtimeImmutables: [
          {
            immutableId: "2534",
            abiType: "address",
            literal: "0x000000000004444c5dc75cB358380D2e3dE08A90",
          },
          {
            immutableId: "2536",
            abiType: "address",
            literal: "0xB012e4A8F2c5FC4E8E4faCA9D5Ad6FfF13FBA887",
          },
        ],
      },
      {
        targetId: "fee-hook",
        compilationUnitId: "profile-hook",
        artifact: "profile-v2/artifacts/isolated-hook.json",
        applicantSalt: {
          mode: "deterministic-hook-permission-grind-v1",
          start: "0",
          maxAttempts: "262144",
        },
        constructorArguments: [
          { target: "fee-vault" },
          { target: "custom-module" },
        ],
        initializer: {
          function: "bindPool",
          arguments: [[
            "0x0000000000000000000000000000000000000000",
            { target: "token" },
            "3000",
            "60",
            { target: "fee-hook" },
          ], { target: "pool-initializer" }, initialSqrtPriceX96],
        },
        deploymentValueWei: "0",
        initializerValueWei: "0",
        componentKind: "hook",
        declaredHookPermissions: ["beforeInitialize", "afterSwap", "afterSwapReturnDelta"],
        runtimeImmutables: [],
      },
      {
        targetId: "pool-initializer",
        compilationUnitId: "profile-initializer",
        artifact: "profile-v2/artifacts/initializer.json",
        applicantSalt: `0x${"03".repeat(32)}`,
        constructorArguments: [
          { target: "fee-vault" },
          { target: "fee-hook" },
          { target: "token" },
          "3000",
          "60",
          initialSqrtPriceX96,
        ],
        initializer: { function: "initializePool", arguments: [] },
        deploymentValueWei: "0",
        initializerValueWei: "0",
        componentKind: "other",
        declaredHookPermissions: null,
        runtimeImmutables: [],
      },
    ],
    pool: {
      tokenTargetId: "token",
      hookTargetId: "fee-hook",
      fee: 3000,
      tickSpacing: 60,
    },
    launchProfile: {
      schemaVersion: "programmable.fee-enforced-launch-profile-selection.v1",
      profileId: "programmable.fee-enforced-isolated-after-swap.zero-delta.v1",
      profileRevision: 3,
      targetRoles: {
        tokenTargetId: "token",
        customModuleTargetId: "custom-module",
        feeVaultTargetId: "fee-vault",
        feeHookTargetId: "fee-hook",
        poolInitializerTargetId: "pool-initializer",
      },
    },
    agentAttestation: {
      agentId: "programmable-v2-synthetic-test",
      checkedAt: "2026-08-25T12:00:00.000Z",
      checks: [{ checkId: "exact-solc-compilation", evidence: "compiler-evidence.json" }],
    },
  };
  const configPath = path.join(root, "programmable-launch.config.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { root, configPath, launchWallet, artifacts, immutableIds };
}

function immutableIdsByName(ast) {
  const result = {};
  const visit = (node) => {
    if (node?.nodeType === "VariableDeclaration" && node.stateVariable === true
      && node.mutability === "immutable") {
      result[node.name] = String(node.id);
    }
    if (typeof node !== "object" || node === null) return;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (typeof value === "object" && value !== null) visit(value);
    }
  };
  visit(ast);
  return result;
}

function independentlyMaterializedRuntimeHash(artifact, assignments) {
  const runtime = artifact.deployedBytecode.object.startsWith("0x")
    ? artifact.deployedBytecode.object
    : `0x${artifact.deployedBytecode.object}`;
  const bytes = Buffer.from(runtime.slice(2), "hex");
  for (const [immutableId, ranges] of Object.entries(artifact.deployedBytecode.immutableReferences)) {
    const [abiType, rawValue] = assignments[immutableId];
    const encoded = encodeAbiParameters([{ type: abiType }], [rawValue]);
    const word = Buffer.from(encoded.slice(2), "hex");
    assert.equal(word.byteLength, 32);
    for (const range of ranges) word.copy(bytes, range.start);
  }
  return keccak256(`0x${bytes.toString("hex")}`);
}

async function materializeCompiledFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "programmable-launch-cli-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "out"), { recursive: true });
  const sources = {
    "src/Token.sol": {
      content: "// SPDX-License-Identifier: UNLICENSED\npragma solidity 0.8.26; contract Token { function marker() external pure returns (uint256) { return 1; } }\n",
    },
    "src/Hook.sol": {
      content: "// SPDX-License-Identifier: UNLICENSED\npragma solidity 0.8.26; contract Hook { constructor(address token, string memory label, uint256 amount) { require(token != address(0)); require(bytes(label).length > 0); require(amount > 0); } function marker() external pure returns (uint256) { return 2; } }\n",
    },
  };
  for (const [sourcePath, { content }] of Object.entries(sources)) {
    await writeFile(path.join(root, sourcePath), content, "utf8");
  }
  const standardJson = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      metadata: { bytecodeHash: "ipfs", appendCBOR: true, useLiteralContent: true },
      libraries: {},
      remappings: [],
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode", "evm.deployedBytecode", "metadata"] },
      },
    },
  };
  const standardJsonPath = path.join(root, "standard-json-input.json");
  await writeFile(standardJsonPath, `${JSON.stringify(standardJson)}\n`, "utf8");
  const output = JSON.parse(solc.compile(JSON.stringify(standardJson)));
  const errors = (output.errors ?? []).filter(({ severity }) => severity === "error");
  assert.deepEqual(errors, []);
  for (const [sourcePath, contractName] of [
    ["src/Token.sol", "Token"],
    ["src/Hook.sol", "Hook"],
  ]) {
    const contract = output.contracts[sourcePath][contractName];
    const artifact = {
      abi: contract.abi,
      bytecode: contract.evm.bytecode,
      deployedBytecode: contract.evm.deployedBytecode,
      metadata: contract.metadata,
    };
    await writeFile(
      path.join(root, "out", `${contractName}.json`),
      `${JSON.stringify(artifact)}\n`,
      "utf8",
    );
  }
  await writeFile(path.join(root, "compiler-evidence.json"), `${JSON.stringify({
    compilerVersion: solc.version(),
    errorCount: errors.length,
  })}\n`, "utf8");
  const repositoryRoot = path.resolve(process.cwd(), "../..");
  const revision = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim();
  const configPath = path.join(root, "programmable-launch.config.json");
  const config = {
    schemaVersion: "programmable.launch-pack-config.v1",
    launchWallet: "0x1111111111111111111111111111111111111111",
    chainId: "1",
    nonce: `0x${"44".repeat(32)}`,
    source: {
      root: ".",
      paths: ["src"],
      sourceLineageNonce: "1",
      publicOrigin: {
        url: "https://github.com/0xprogrammable/PROGRAMMABLE",
        revision,
      },
    },
    compilationUnits: [{
      compilationUnitId: "fixture-solc",
      standardJson: "standard-json-input.json",
    }],
    targets: [
      {
        targetId: "token",
        compilationUnitId: "fixture-solc",
        artifact: "out/Token.json",
        applicantSalt: `0x${"00".repeat(32)}`,
        constructorArguments: [],
        initializer: null,
        deploymentValueWei: "0",
        initializerValueWei: "0",
        componentKind: "token",
        declaredHookPermissions: null,
      },
      {
        targetId: "hook",
        compilationUnitId: "fixture-solc",
        artifact: "out/Hook.json",
        applicantSalt: `0x${"01".repeat(32)}`,
        constructorArguments: [{ target: "token" }, "123", "123"],
        initializer: null,
        deploymentValueWei: "0",
        initializerValueWei: "0",
        componentKind: "hook",
        declaredHookPermissions: [],
      },
    ],
    pool: { tokenTargetId: "token", hookTargetId: "hook", fee: 3_000, tickSpacing: 60 },
    agentAttestation: {
      agentId: "public-cli-test",
      checkedAt: "2026-08-25T12:00:00.000Z",
      checks: [{ checkId: "exact-solc-compilation", evidence: "compiler-evidence.json" }],
    },
  };
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  try {
    await buildLaunch({ configPath });
  } catch (error) {
    const match = /HOOK_PERMISSION_ADDRESS_MISMATCH:.*mask ([0-9]+), declared/.exec(error.message);
    if (!match) throw error;
    const mask = Number(match[1]);
    config.targets[1].declaredHookPermissions = HOOK_PERMISSIONS.filter(
      (permission) => (mask & (1 << HOOK_PERMISSION_BITS[permission])) !== 0,
    );
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
  await buildLaunch({ configPath });
  return { root, configPath };
}
