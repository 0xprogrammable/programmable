import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { canonicalizeJson } from "../../packages/launch/src/canonical-json.mjs";
import * as client from "../programmable-launch-v412-release-binding.mjs";
import * as previousClient from "../programmable-launch-v411-release-binding.mjs";
import * as api from "../programmable-launch-v41-release-binding.mjs";
import * as legacy from "../programmable-launch-v4-release-binding.mjs";
import { releaseBindingTools, buildReleaseManifest, releaseNames, RELEASE_ASSET_SCHEMA_V2 } from "../programmable-launch-release-assets.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const sourceBinding = client.createV412ClientReleaseBinding({ repositoryRoot });
function write(root, relative, value) {
  const destination = path.join(root, relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, value);
}
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "programmable-v412-client-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const { path: relative } of [...sourceBinding.clientFiles, ...sourceBinding.machineContracts]) {
    write(root, relative, readFileSync(path.join(repositoryRoot, relative)));
  }
  for (const relative of ["public/openapi/custom-launch-v4.1.json", ...[
    "pack-config", "create-request", "custom-launch", "source-verification-status",
    "capabilities", "preflight", "onchain-evidence", "exact-wallet-transaction",
  ].map(name => `public/schemas/custom-launch/v4.1/${name}.json`)]) {
    write(root, relative, JSON.stringify({ fixtureOnly: relative }));
  }
  const apiBinding = api.createV4ReleaseCandidate({ repositoryRoot: root });
  write(root, api.V4_RELEASE_BINDING_PATH, JSON.stringify(apiBinding));
  const binding = client.createV412ClientReleaseBinding({ repositoryRoot: root });
  write(root, client.V4_RELEASE_BINDING_PATH, JSON.stringify(binding));
  return { root, binding, apiBinding, audit: value => client.auditV412ClientSource({
    repositoryRoot: root, bindingBytes: Buffer.from(JSON.stringify(value)),
  }) };
}

test("client source record binds 4.1.2 separately from the unchanged 4.1.0 API identity", () => {
  const result = client.auditV412ClientSource({ repositoryRoot });
  assert.equal(result.productionEvidenceVerified, false);
  assert.equal(Object.hasOwn(result, "releaseReady"), false);
  assert.equal(Object.hasOwn(result.binding, "releaseReady"), false);
  assert.equal(result.binding.package.version, "4.1.2");
  assert.deepEqual(result.binding.clientFiles.map(value => value.path), [
    "packages/launch/package.json",
    "packages/launch/npm-shrinkwrap.json",
    "packages/launch/src/constants.mjs",
    "packages/launch/src/cli.mjs",
    "packages/launch/src/index.mjs",
    "packages/launch/src/api-client.mjs",
    "packages/launch/src/api-response.mjs",
    "packages/launch/src/canonical-json.mjs",
    "packages/launch/src/io.mjs",
    "packages/launch/src/launch-coverage-v1.mjs",
    "packages/launch/schemas/robinhood-launch-coverage-v1.json",
  ]);
  assert.equal(result.binding.apiProfile.profileVersion, "4.1.0");
  assert.equal(result.binding.apiProfile.profileRevision, 2);
  assert.equal(result.binding.existingApiReleaseBinding.path, api.V4_RELEASE_BINDING_PATH);
  assert.equal(result.binding.existingApiReleaseBinding.schemaVersion, api.V4_RELEASE_BINDING_SCHEMA);
  assert.equal(result.binding.coverage.authentication, "none");
  assert.equal(result.binding.coverage.requestAuthorization, false);
  assert.equal(result.binding.coverage.activatesWriteProfile, false);
  const validate = new Ajv2020({ strict: false }).compile(JSON.parse(readFileSync(new URL(
    "../../docs/operations/releases/custom-launch-v4.1.2/cli-release-binding.schema.json", import.meta.url))));
  assert.equal(validate(result.binding), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...result.binding, releaseReady: true }), false);
});

test("client patch cannot turn an inactive API candidate into release authority", t => {
  const { root, binding } = fixture(t);
  const result = client.auditV4ReleaseBinding({ repositoryRoot: root });
  assert.equal(result.releaseReady, false);
  assert.equal(result.productionEvidenceVerified, false);
  assert.equal(result.blockers.length, 6);
  assert.equal(canonicalizeJson(result.binding), canonicalizeJson(binding));
  let productionCalls = 0;
  let backendCalls = 0;
  assert.throws(() => client.requireV4ReleaseReady({ repositoryRoot: root,
    verifyProductionProof: () => { productionCalls += 1; return {}; },
    verifyBackendAuthorization: () => { backendCalls += 1; return {}; },
  }), /V4 release binding is blocked/);
  assert.equal(productionCalls, 0);
  assert.equal(backendCalls, 0);
});

test("client binding rejects identity substitutions, forged approval fields, hash and source drift", t => {
  const { root, binding, audit } = fixture(t);
  for (const mutate of [
    value => { value.package.version = "4.1.0"; },
    value => { value.package.tag = "programmable-launch-v4.1.0"; },
    value => { value.apiProfile.profileVersion = "4.1.2"; },
    value => { value.existingApiReleaseBinding.sha256 = `sha256:${"f".repeat(64)}`; },
    value => { value.clientFiles[0].sha256 = `sha256:${"f".repeat(64)}`; },
    value => { value.machineContracts[0].path = "public/openapi/custom-launch-v4.1.json"; },
    value => { value.releaseReady = true; },
    value => { value.coverage.requestAuthorization = true; },
    value => { value.coverage.activatesWriteProfile = true; },
  ]) {
    const changed = structuredClone(binding); mutate(changed);
    assert.throws(() => audit(changed), /exact client source binding/);
  }
  const cli = "packages/launch/src/cli.mjs";
  write(root, cli, `${readFileSync(path.join(root, cli), "utf8")}\n// Changed source\n`);
  assert.throws(() => audit(binding), /exact client source binding/);
});

test("client response decoding and UTF-8 source drift invalidates the exact client binding", t => {
  for (const name of ["api-client", "api-response", "canonical-json", "io"]) {
    const { root, binding, audit } = fixture(t);
    const relative = `packages/launch/src/${name}.mjs`;
    write(root, relative, `${readFileSync(path.join(root, relative), "utf8")}\n// Changed response contract\n`);
    assert.throws(() => audit(binding), /exact client source binding/, relative);
  }
});

test("client source validation preserves API identity and public report non-authorization", t => {
  const { root, apiBinding } = fixture(t);
  apiBinding.releaseIdentity.package.version = "4.1.2";
  write(root, api.V4_RELEASE_BINDING_PATH, JSON.stringify(apiBinding));
  assert.throws(() => client.createV412ClientReleaseBinding({ repositoryRoot: root }), /existing API release identity/);
  apiBinding.releaseIdentity.package.version = "4.1.0";
  write(root, api.V4_RELEASE_BINDING_PATH, JSON.stringify(apiBinding));
  const schema = JSON.parse(readFileSync(path.join(root, "public/schemas/custom-launch/coverage/v1.json")));
  schema.properties.requestAuthorization.properties.requestAuthorized.const = true;
  for (const relative of ["public/schemas/custom-launch/coverage/v1.json", "packages/launch/schemas/robinhood-launch-coverage-v1.json"]) {
    write(root, relative, JSON.stringify(schema));
  }
  assert.throws(() => client.createV412ClientReleaseBinding({ repositoryRoot: root }), /true !== false/);
});

test("client source parser rejects duplicate keys and linked source files", t => {
  const { root, binding } = fixture(t);
  const duplicate = JSON.stringify(binding).replace('"schemaVersion":', '"package":{},"schemaVersion":');
  assert.throws(() => client.auditV412ClientSource({ repositoryRoot: root, bindingBytes: Buffer.from(duplicate) }), /duplicate/i);
  const relative = binding.clientFiles[0].path;
  rmSync(path.join(root, relative));
  symlinkSync(path.join(repositoryRoot, relative), path.join(root, relative));
  assert.throws(() => client.createV412ClientReleaseBinding({ repositoryRoot: root }), /must be a regular file/);
});

test("4.1.2 asset manifest requires its own exact client record and no future release is inferred", () => {
  assert.equal(releaseBindingTools("4.1.2"), client);
  assert.equal(releaseBindingTools("4.1.1"), previousClient);
  assert.equal(releaseBindingTools("4.1.0"), api);
  assert.equal(releaseBindingTools("4.0.0"), legacy);
  for (const version of ["4.1.3", "4.2.0", "4.1.2-preview"]) {
    assert.throws(() => releaseBindingTools(version), /Unsupported/);
  }
  const names = releaseNames("4.1.2");
  const input = { version: "4.1.2", ref: "refs/heads/production", commitSha: "1".repeat(40), treeSha: "2".repeat(40),
    assets: [
      { name: names.tarball, mediaType: "application/gzip", bytes: 10, sha256: "a".repeat(64) },
      { name: names.checksum, mediaType: "text/plain", bytes: 20, sha256: "b".repeat(64) },
      { name: names.sbom, mediaType: "application/vnd.cyclonedx+json", bytes: 30, sha256: "c".repeat(64) },
    ],
    machineContractBinding: { schemaVersion: client.V4_RELEASE_BINDING_SCHEMA,
      path: client.V4_RELEASE_BINDING_PATH, sha256: `sha256:${"d".repeat(64)}` },
  };
  const manifest = buildReleaseManifest(input);
  assert.equal(manifest.schemaVersion, RELEASE_ASSET_SCHEMA_V2);
  assert.equal(manifest.package.version, "4.1.2");
  assert.equal(manifest.package.tag, names.tag);
  assert.deepEqual(manifest.machineContractBinding, input.machineContractBinding);
  for (const historical of [previousClient, api]) {
    assert.throws(() => buildReleaseManifest({ ...input,
      machineContractBinding: { ...input.machineContractBinding,
        schemaVersion: historical.V4_RELEASE_BINDING_SCHEMA, path: historical.V4_RELEASE_BINDING_PATH },
    }), /exact machine-contract binding/);
  }
});
