#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { canonicalizeJson, parseStrictJson } from "../packages/launch/src/canonical-json.mjs";
import { decodeExactUtf8 } from "../packages/launch/src/io.mjs";
import { ROBINHOOD_PROFILE_V41 } from "../packages/launch/src/profile-v41.mjs";
import * as apiRelease from "./programmable-launch-v41-release-binding.mjs";

export const V4_RELEASE_BINDING_SCHEMA = "programmable.launch-cli-v4-client-release-binding.v1";
export const V4_RELEASE_BINDING_PATH = "docs/operations/releases/custom-launch-v4.1.1/cli-release-binding.json";
const PACKAGE = Object.freeze({ name: "@programmable/launch", version: "4.1.1",
  tag: "programmable-launch-v4.1.1", repository: "programmablehq/PROGRAMMABLE" });
const CLIENT_FILES = Object.freeze([
  "packages/launch/package.json",
  "packages/launch/npm-shrinkwrap.json",
  "packages/launch/src/constants.mjs",
  "packages/launch/src/cli.mjs",
  "packages/launch/src/index.mjs",
  "packages/launch/src/launch-coverage-v1.mjs",
  "packages/launch/schemas/robinhood-launch-coverage-v1.json",
]);
const COVERAGE_CONTRACTS = Object.freeze([
  ["openapi", "public/openapi/launch-coverage-v1.json", "https://programmable.market/openapi/launch-coverage-v1.json"],
  ["response", "public/schemas/custom-launch/coverage/v1.json", "https://programmable.market/schemas/custom-launch/coverage/v1.json"],
]);

/** Computes candidate source metadata only. This does not validate production evidence. */
export function createV411ClientReleaseBinding({ repositoryRoot }) {
  const root = realpathSync(path.resolve(repositoryRoot));
  const packageJson = json(bytes(root, CLIENT_FILES[0]));
  const shrinkwrap = json(bytes(root, CLIENT_FILES[1]));
  assert.equal(packageJson.name, PACKAGE.name, "client package name");
  assert.equal(packageJson.version, PACKAGE.version, "client package version");
  assert.equal(shrinkwrap.name, PACKAGE.name, "client shrinkwrap name");
  assert.equal(shrinkwrap.version, PACKAGE.version, "client shrinkwrap version");
  assert.equal(shrinkwrap.packages?.[""]?.version, PACKAGE.version, "client shrinkwrap root version");
  assert.equal(packageJson.packageManager, "npm@11.16.0", "client package manager");
  const constants = decodeExactUtf8(bytes(root, CLIENT_FILES[2]), "client constants");
  for (const line of [
    'export const PACKAGE_VERSION = "4.1.1";',
    'export const RELEASE_TAG = "programmable-launch-v4.1.1";',
    'export const RELEASE_TARBALL = "programmable-launch-4.1.1.tgz";',
  ]) assert.ok(constants.includes(line), `client constant missing: ${line}`);
  const apiBytes = bytes(root, apiRelease.V4_RELEASE_BINDING_PATH);
  const apiBinding = json(apiBytes);
  assert.equal(apiBinding.schemaVersion, apiRelease.V4_RELEASE_BINDING_SCHEMA, "existing API binding schema");
  assert.equal(apiBinding.releaseIdentity?.package?.version, "4.1.0", "existing API release identity");
  assert.equal(canonicalizeJson(apiBinding.releaseIdentity?.profile), canonicalizeJson(ROBINHOOD_PROFILE_V41),
    "client patch must retain the exact API profile");
  const packagedSchema = bytes(root, CLIENT_FILES.at(-1));
  const publicSchema = bytes(root, COVERAGE_CONTRACTS[1][1]);
  assert.deepEqual(packagedSchema, publicSchema, "packaged and public coverage response schemas");
  const responseSchema = json(publicSchema);
  assert.equal(responseSchema.properties?.schemaVersion?.const, "programmable.robinhood-launch-coverage.v1");
  assert.equal(responseSchema.properties?.requestAuthorization?.properties?.requestAuthorized?.const, false);
  assert.equal(responseSchema.properties?.structuralFormat?.properties?.roleAssignments?.properties?.tokenAndHookMayShareAddress?.const, false);
  const openapi = json(bytes(root, COVERAGE_CONTRACTS[0][1]));
  assert.deepEqual(openapi.security, []);
  assert.deepEqual(Object.keys(openapi.paths), ["/v4/chains/4663/launch-coverage"]);
  assert.deepEqual(Object.keys(openapi.paths["/v4/chains/4663/launch-coverage"]), ["get"]);
  assert.deepEqual(openapi.paths["/v4/chains/4663/launch-coverage"].get.security, []);
  const shape = Object.fromEntries(Object.entries(responseSchema)
    .filter(([key]) => !["$schema", "$id", "title", "description"].includes(key)));
  assert.equal(canonicalizeJson(openapi.components?.schemas?.RobinhoodLaunchCoverageV1), canonicalizeJson(shape));
  return {
    $schema: "./cli-release-binding.schema.json",
    schemaVersion: V4_RELEASE_BINDING_SCHEMA,
    package: { ...PACKAGE },
    apiProfile: { ...ROBINHOOD_PROFILE_V41 },
    existingApiReleaseBinding: {
      schemaVersion: apiRelease.V4_RELEASE_BINDING_SCHEMA,
      path: apiRelease.V4_RELEASE_BINDING_PATH,
      sha256: digest(apiBytes),
    },
    coverage: {
      path: "/v4/chains/4663/launch-coverage",
      schemaVersion: "programmable.robinhood-launch-coverage.v1",
      authentication: "none", requestAuthorization: false, activatesWriteProfile: false,
    },
    clientFiles: CLIENT_FILES.map(relative => ({ path: relative, sha256: digest(bytes(root, relative)) })),
    machineContracts: COVERAGE_CONTRACTS.map(([name, relative, url]) => ({
      name, path: relative, url, sha256: digest(bytes(root, relative)),
    })),
  };
}

/** Source-only parity check, deliberately separate from release-ready authority. */
export function auditV411ClientSource({ repositoryRoot, bindingBytes = null }) {
  const root = realpathSync(path.resolve(repositoryRoot));
  const bindingSource = bindingBytes === null ? bytes(root, V4_RELEASE_BINDING_PATH) : Buffer.from(bindingBytes);
  const binding = json(bindingSource);
  const expected = createV411ClientReleaseBinding({ repositoryRoot: root });
  assert.equal(canonicalizeJson(binding), canonicalizeJson(expected), "exact client source binding");
  return Object.freeze({ binding, bindingPath: V4_RELEASE_BINDING_PATH,
    bindingSha256: digest(bindingSource), productionEvidenceVerified: false });
}

export function auditV4ReleaseBinding(options) {
  const client = auditV411ClientSource(options);
  // The historical identity remains 4.1.0. Never substitute the 4.1.1 package
  // into its signed backend, profile, source or deployment evidence.
  const api = apiRelease.auditV4ReleaseBinding(apiOptions(options));
  assert.equal(api.bindingSha256, client.binding.existingApiReleaseBinding.sha256, "existing API binding digest");
  return Object.freeze({ ...client, releaseReady: api.releaseReady, blockers: api.blockers });
}

export function requireV4ReleaseReady(options) {
  const client = auditV411ClientSource(options);
  const api = apiRelease.requireV4ReleaseReady(apiOptions(options));
  assert.equal(api.bindingSha256, client.binding.existingApiReleaseBinding.sha256, "existing API binding digest");
  return Object.freeze({ ...client, releaseReady: api.releaseReady, blockers: api.blockers,
    productionEvidenceVerified: true, productionProof: api.productionProof,
    backendAuthorization: api.backendAuthorization });
}

function apiOptions(options) {
  return { ...options, bindingPath: apiRelease.V4_RELEASE_BINDING_PATH, bindingBytes: null };
}

function bytes(root, relative) {
  const file = path.join(root, relative);
  assert.ok(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), `${relative} must be a regular file`);
  assert.ok(realpathSync(file).startsWith(`${root}${path.sep}`), "source file must remain inside repository");
  const value = readFileSync(file);
  assert.ok(value.length > 0 && value.length <= 16 * 1024 * 1024, "source bytes must be bounded");
  return value;
}
function json(value) {
  return parseStrictJson(decodeExactUtf8(value, "client release binding"), { maximumBytes: 16 * 1024 * 1024, maximumDepth: 96 });
}
function digest(value) { return `sha256:${createHash("sha256").update(value).digest("hex")}`; }

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, flag, repositoryRoot, ...extra] = process.argv.slice(2);
  if (!["create-client-binding", "audit-source", "audit", "verify-release-ready"].includes(command)
    || flag !== "--repository-root" || !repositoryRoot || extra.length !== 0) {
    throw new Error("Usage: programmable-launch-v411-release-binding.mjs <create-client-binding|audit-source|audit|verify-release-ready> --repository-root PATH");
  }
  if (command === "create-client-binding") {
    process.stdout.write(`${JSON.stringify(createV411ClientReleaseBinding({ repositoryRoot }), null, 2)}\n`);
  } else {
    const result = command === "audit-source" ? auditV411ClientSource({ repositoryRoot })
      : command === "audit" ? auditV4ReleaseBinding({ repositoryRoot }) : requireV4ReleaseReady({ repositoryRoot });
    process.stdout.write(`${JSON.stringify({ schemaVersion: V4_RELEASE_BINDING_SCHEMA,
      bindingSha256: result.bindingSha256, productionEvidenceVerified: result.productionEvidenceVerified,
      ...(result.releaseReady === undefined ? {} : { releaseReady: result.releaseReady, blockers: result.blockers }),
    })}\n`);
  }
}
