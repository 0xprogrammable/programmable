import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import test, { after } from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { canonicalizeJson, parseStrictJson } from "../../packages/launch/src/canonical-json.mjs";
import { decodeExactUtf8 } from "../../packages/launch/src/io.mjs";
import * as client from "../programmable-launch-v411-release-binding.mjs";
import * as api from "../programmable-launch-v41-release-binding.mjs";
import * as legacy from "../programmable-launch-v4-release-binding.mjs";
import { releaseBindingTools, buildReleaseManifest, releaseNames, RELEASE_ASSET_SCHEMA_V2 } from "../programmable-launch-release-assets.mjs";

const checkoutRoot = fileURLToPath(new URL("../../", import.meta.url));
const FROZEN_V411_REVISION = "20355da476f126f07e106a4821b565df64475665";
const SNAPSHOT_SHA256 = "65dd45167e213906d7a5ee7274f7c3ae3262922685e7284d0a4dff2ffb7d9295";
const MAXIMUM_SNAPSHOT_BYTES = 256 * 1024;
const snapshotPath = new URL("./fixtures/programmable-launch-v411-source.json.gz", import.meta.url);
const snapshotStat = lstatSync(snapshotPath);
assert.ok(snapshotStat.isFile() && snapshotStat.size <= MAXIMUM_SNAPSHOT_BYTES, "bounded snapshot file");
const snapshotBytes = readFileSync(snapshotPath);
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function readFrozenSnapshot(compressed) {
  assert.ok(compressed.length > 0 && compressed.length <= MAXIMUM_SNAPSHOT_BYTES, "bounded snapshot bytes");
  assert.equal(digest(compressed), SNAPSHOT_SHA256, "exact frozen source snapshot digest");
  const decoded = gunzipSync(compressed, { maxOutputLength: 1024 * 1024 });
  const snapshot = parseStrictJson(decodeExactUtf8(decoded, "historical client snapshot"), {
    maximumBytes: 1024 * 1024, maximumDepth: 8,
  });
  assert.equal(snapshot.schemaVersion, "programmable.launch-cli-v411-test-source.v1");
  assert.equal(snapshot.sourceCommit, FROZEN_V411_REVISION);
  assert.equal(snapshot.files.length, 14);
  const files = new Map();
  for (const entry of snapshot.files) {
    assert.equal(files.has(entry.path), false, "unique snapshot paths");
    const value = Buffer.from(entry.bytesBase64, "base64");
    assert.equal(value.toString("base64"), entry.bytesBase64, "exact snapshot byte encoding");
    assert.equal(`sha256:${digest(value)}`, entry.sha256, "snapshot file digest");
    files.set(entry.path, value);
  }
  return files;
}
// These are exact Git blob bytes captured from 20355, read only as test data.
// The pinned local snapshot makes shallow/squashed checkouts independent of history.
const frozenFiles = readFrozenSnapshot(snapshotBytes);
function frozenBytes(relative) {
  assert.ok(frozenFiles.has(relative), `missing frozen snapshot path: ${relative}`);
  return frozenFiles.get(relative);
}
const repositoryRoot = mkdtempSync(path.join(os.tmpdir(), "programmable-v411-frozen-"));
after(() => rmSync(repositoryRoot, { recursive: true, force: true }));
const sourceBinding = parseStrictJson(decodeExactUtf8(frozenBytes(client.V4_RELEASE_BINDING_PATH), "historical binding"));
for (const file of [...sourceBinding.clientFiles, ...sourceBinding.machineContracts, sourceBinding.existingApiReleaseBinding]) {
  assert.equal(`sha256:${digest(frozenBytes(file.path))}`, file.sha256, "frozen binding file digest");
}
for (const relative of [
  ...sourceBinding.clientFiles.map(value => value.path),
  ...sourceBinding.machineContracts.map(value => value.path),
  api.V4_RELEASE_BINDING_PATH,
  client.V4_RELEASE_BINDING_PATH,
  "docs/operations/releases/custom-launch-v4.1.1/cli-release-binding.schema.json",
]) write(repositoryRoot, relative, frozenBytes(relative));
function write(root, relative, value) {
  const destination = path.join(root, relative);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, value);
}
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "programmable-v411-client-"));
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
  const binding = client.createV411ClientReleaseBinding({ repositoryRoot: root });
  write(root, client.V4_RELEASE_BINDING_PATH, JSON.stringify(binding));
  return { root, binding, apiBinding, audit: value => client.auditV411ClientSource({
    repositoryRoot: root, bindingBytes: Buffer.from(JSON.stringify(value)),
  }) };
}

test("4.1.1 release record, schema, helper and runbook retain their frozen bytes", () => {
  for (const relative of [
    client.V4_RELEASE_BINDING_PATH,
    "docs/operations/releases/custom-launch-v4.1.1/cli-release-binding.schema.json",
    "docs/operations/releases/custom-launch-v4.1.1/README.md",
    "scripts/programmable-launch-v411-release-binding.mjs",
  ]) assert.deepEqual(readFileSync(path.join(checkoutRoot, relative)), frozenBytes(relative), relative);
});

test("historical source snapshot rejects changed and excessive bytes without Git or network", () => {
  const changed = Buffer.from(snapshotBytes);
  changed[changed.length - 1] ^= 1;
  assert.throws(() => readFrozenSnapshot(changed), /snapshot digest/);
  assert.throws(() => readFrozenSnapshot(Buffer.alloc(MAXIMUM_SNAPSHOT_BYTES + 1)), /bounded snapshot bytes/);
});

test("client source record binds 4.1.1 separately from the unchanged 4.1.0 API identity", () => {
  const result = client.auditV411ClientSource({ repositoryRoot });
  assert.equal(result.productionEvidenceVerified, false);
  assert.equal(Object.hasOwn(result, "releaseReady"), false);
  assert.equal(Object.hasOwn(result.binding, "releaseReady"), false);
  assert.equal(result.binding.package.version, "4.1.1");
  assert.equal(result.binding.apiProfile.profileVersion, "4.1.0");
  assert.equal(result.binding.apiProfile.profileRevision, 2);
  assert.equal(result.binding.existingApiReleaseBinding.path, api.V4_RELEASE_BINDING_PATH);
  assert.equal(result.binding.existingApiReleaseBinding.schemaVersion, api.V4_RELEASE_BINDING_SCHEMA);
  assert.equal(result.binding.coverage.authentication, "none");
  assert.equal(result.binding.coverage.requestAuthorization, false);
  assert.equal(result.binding.coverage.activatesWriteProfile, false);
  const validate = new Ajv2020({ strict: false }).compile(JSON.parse(readFileSync(path.join(repositoryRoot,
    "docs/operations/releases/custom-launch-v4.1.1/cli-release-binding.schema.json"))));
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
    value => { value.apiProfile.profileVersion = "4.1.1"; },
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

test("client source validation preserves API identity and public report non-authorization", t => {
  const { root, apiBinding } = fixture(t);
  apiBinding.releaseIdentity.package.version = "4.1.1";
  write(root, api.V4_RELEASE_BINDING_PATH, JSON.stringify(apiBinding));
  assert.throws(() => client.createV411ClientReleaseBinding({ repositoryRoot: root }), /existing API release identity/);
  apiBinding.releaseIdentity.package.version = "4.1.0";
  write(root, api.V4_RELEASE_BINDING_PATH, JSON.stringify(apiBinding));
  const schema = JSON.parse(readFileSync(path.join(root, "public/schemas/custom-launch/coverage/v1.json")));
  schema.properties.requestAuthorization.properties.requestAuthorized.const = true;
  for (const relative of ["public/schemas/custom-launch/coverage/v1.json", "packages/launch/schemas/robinhood-launch-coverage-v1.json"]) {
    write(root, relative, JSON.stringify(schema));
  }
  assert.throws(() => client.createV411ClientReleaseBinding({ repositoryRoot: root }), /true !== false/);
});

test("client source parser rejects duplicate keys and linked source files", t => {
  const { root, binding } = fixture(t);
  const duplicate = JSON.stringify(binding).replace('"schemaVersion":', '"package":{},"schemaVersion":');
  assert.throws(() => client.auditV411ClientSource({ repositoryRoot: root, bindingBytes: Buffer.from(duplicate) }), /duplicate/i);
  const relative = binding.clientFiles[0].path;
  rmSync(path.join(root, relative));
  symlinkSync(path.join(repositoryRoot, relative), path.join(root, relative));
  assert.throws(() => client.createV411ClientReleaseBinding({ repositoryRoot: root }), /must be a regular file/);
});

test("4.1.1 asset manifest requires its own exact client record and no future release is inferred", () => {
  assert.equal(releaseBindingTools("4.1.1"), client);
  assert.equal(releaseBindingTools("4.1.0"), api);
  assert.equal(releaseBindingTools("4.0.0"), legacy);
  for (const version of ["4.1.3", "4.2.0", "4.1.1-preview"]) {
    assert.throws(() => releaseBindingTools(version), /Unsupported/);
  }
  const names = releaseNames("4.1.1");
  const input = { version: "4.1.1", ref: "refs/heads/production", commitSha: "1".repeat(40), treeSha: "2".repeat(40),
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
  assert.equal(manifest.package.version, "4.1.1");
  assert.equal(manifest.package.tag, names.tag);
  assert.deepEqual(manifest.machineContractBinding, input.machineContractBinding);
  assert.throws(() => buildReleaseManifest({ ...input,
    machineContractBinding: { ...input.machineContractBinding,
      schemaVersion: api.V4_RELEASE_BINDING_SCHEMA, path: api.V4_RELEASE_BINDING_PATH },
  }), /exact machine-contract binding/);
});
