import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import * as v4Binding from "./programmable-launch-v4-release-binding.mjs";
import * as v41Binding from "./programmable-launch-v41-release-binding.mjs";
import * as v411Binding from "./programmable-launch-v411-release-binding.mjs";

export function releaseBindingTools(version) {
  if (version === "4.0.0") return v4Binding;
  if (version === "4.1.0") return v41Binding;
  if (version === "4.1.1") return v411Binding;
  if (version.split(".")[0] === "4") throw new Error("Unsupported V4 release version");
  return null;
}

export const RELEASE_ASSET_SCHEMA =
  "programmable.launch-cli-release-assets.v1";
export const RELEASE_ASSET_SCHEMA_V2 =
  "programmable.launch-cli-release-assets.v2";
export const RELEASE_REPOSITORY = "programmablehq/programmable";
export const RELEASE_NODE_VERSION = "24.14.0";
export const RELEASE_NPM_VERSION = "11.16.0";

const COMMIT = /^[0-9a-f]{40}$/u;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

export function canonicalJson(value) {
  return `${JSON.stringify(sortJson(value), null, 2)}\n`;
}

export function normalizeCycloneDx(value) {
  const normalized = structuredClone(value);
  delete normalized.serialNumber;
  if (isObject(normalized.metadata)) {
    delete normalized.metadata.timestamp;
  }
  if (
    normalized.bomFormat !== "CycloneDX"
    || typeof normalized.specVersion !== "string"
    || !/^1\.[5-9]$/u.test(normalized.specVersion)
  ) {
    throw new Error("npm did not produce a supported CycloneDX document.");
  }
  return normalized;
}

export function releaseNames(version) {
  requirePattern(version, VERSION, "package version");
  return Object.freeze({
    tag: `programmable-launch-v${version}`,
    tarball: `programmable-launch-${version}.tgz`,
    checksum: `programmable-launch-${version}.tgz.sha256`,
    sbom: `programmable-launch-${version}.cdx.json`,
    manifest: `programmable-launch-${version}.release.json`,
  });
}

export function buildReleaseManifest(input) {
  requirePattern(input.commitSha, COMMIT, "source commit");
  requirePattern(input.treeSha, COMMIT, "source tree");
  if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/u.test(input.ref ?? "")) {
    throw new Error("Source ref is invalid.");
  }
  const names = releaseNames(input.version);
  if (!Array.isArray(input.assets) || input.assets.length !== 3) {
    throw new Error("Release manifest requires exactly three payload assets.");
  }
  const expectedNames = [names.tarball, names.checksum, names.sbom].sort();
  const assets = input.assets.map((asset) => {
    if (
      !expectedNames.includes(asset.name)
      || !Number.isSafeInteger(asset.bytes)
      || asset.bytes < 1
      || !SHA256.test(asset.sha256 ?? "")
      || typeof asset.mediaType !== "string"
      || asset.mediaType.length < 1
    ) {
      throw new Error("Release manifest asset is invalid.");
    }
    return Object.freeze({
      name: asset.name,
      mediaType: asset.mediaType,
      bytes: asset.bytes,
      sha256: asset.sha256,
    });
  }).sort((left, right) => left.name.localeCompare(right.name));
  if (assets.some((asset, index) => asset.name !== expectedNames[index])) {
    throw new Error("Release manifest asset names are not exact.");
  }
  const bindingTools = releaseBindingTools(input.version);
  const requiresV4Binding = bindingTools !== null;
  let machineContractBinding;
  if (requiresV4Binding) {
    const value = input.machineContractBinding;
    if (value?.schemaVersion !== bindingTools.V4_RELEASE_BINDING_SCHEMA
      || value?.path !== bindingTools.V4_RELEASE_BINDING_PATH
      || typeof value?.sha256 !== "string"
      || !/^sha256:[0-9a-f]{64}$/u.test(value.sha256)) {
      throw new Error("V4 release manifest requires the exact machine-contract binding.");
    }
    machineContractBinding = Object.freeze({
      schemaVersion: value.schemaVersion,
      path: value.path,
      sha256: value.sha256,
    });
  } else if (input.machineContractBinding !== undefined) {
    throw new Error("Pre-V4 release manifests must not change their immutable binding.");
  }
  return Object.freeze({
    schemaVersion: requiresV4Binding ? RELEASE_ASSET_SCHEMA_V2 : RELEASE_ASSET_SCHEMA,
    repository: RELEASE_REPOSITORY,
    source: Object.freeze({
      ref: input.ref,
      commitSha: input.commitSha,
      treeSha: input.treeSha,
    }),
    package: Object.freeze({
      name: "@programmable/launch",
      version: input.version,
      tag: names.tag,
    }),
    toolchain: Object.freeze({
      node: RELEASE_NODE_VERSION,
      npm: RELEASE_NPM_VERSION,
    }),
    ...(machineContractBinding === undefined ? {} : { machineContractBinding }),
    assets: Object.freeze(assets),
  });
}

function build(options) {
  const context = repositoryContext(options);
  requireExact(process.version, `v${RELEASE_NODE_VERSION}`, "Node.js version");
  requireExact(
    exec("npm", ["--version"], context.packageRoot),
    RELEASE_NPM_VERSION,
    "npm version",
  );
  const status = exec("git", ["status", "--porcelain", "--untracked-files=all"], context.root);
  if (status !== "") {
    throw new Error("Release assets require a clean exact-source checkout.");
  }

  mkdirSync(context.output, { recursive: false, mode: 0o700 });
  const packed = JSON.parse(exec("npm", [
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    context.output,
  ], context.packageRoot));
  if (!Array.isArray(packed) || packed.length !== 1) {
    throw new Error("npm pack did not return one exact package.");
  }
  const producedName = basename(packed[0]?.filename ?? "");
  requireExact(producedName, context.names.tarball, "npm tarball name");
  const tarballPath = join(context.output, context.names.tarball);
  const tarball = readFileSync(tarballPath);
  const tarballSha256 = sha256(tarball);
  writeFileSync(
    join(context.output, context.names.checksum),
    `${tarballSha256}  ${context.names.tarball}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );

  const rawSbom = JSON.parse(exec("npm", [
    "sbom",
    "--sbom-format=cyclonedx",
    "--sbom-type=application",
    "--omit=dev",
  ], context.packageRoot));
  writeFileSync(
    join(context.output, context.names.sbom),
    canonicalJson(normalizeCycloneDx(rawSbom)),
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );

  const payloads = [
    [context.names.tarball, "application/gzip"],
    [context.names.checksum, "text/plain"],
    [context.names.sbom, "application/vnd.cyclonedx+json"],
  ].map(([name, mediaType]) => {
    const bytes = readFileSync(join(context.output, name));
    return { name, mediaType, bytes: bytes.length, sha256: sha256(bytes) };
  });
  const manifest = buildReleaseManifest({
    version: context.version,
    ref: options.sourceRef,
    commitSha: context.commitSha,
    treeSha: context.treeSha,
    assets: payloads,
    ...(context.machineContractBinding === null
      ? {}
      : { machineContractBinding: context.machineContractBinding }),
  });
  writeFileSync(
    join(context.output, context.names.manifest),
    canonicalJson(manifest),
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  verify(options);
}

function verify(options) {
  const context = repositoryContext(options);
  const paths = Object.fromEntries(
    ["tarball", "checksum", "sbom", "manifest"].map((key) => [
      key,
      join(context.output, context.names[key]),
    ]),
  );
  const checksum = readFileSync(paths.checksum, "utf8");
  const tarball = readFileSync(paths.tarball);
  requireExact(
    checksum,
    `${sha256(tarball)}  ${context.names.tarball}\n`,
    "tarball checksum file",
  );

  const sbomBytes = readFileSync(paths.sbom);
  const sbom = JSON.parse(sbomBytes);
  if (Object.hasOwn(sbom, "serialNumber") || Object.hasOwn(sbom.metadata ?? {}, "timestamp")) {
    throw new Error("Normalized SBOM contains nondeterministic identity fields.");
  }
  requireExact(canonicalJson(sbom), sbomBytes.toString("utf8"), "canonical SBOM bytes");
  normalizeCycloneDx(sbom);

  const manifestBytes = readFileSync(paths.manifest);
  const manifest = JSON.parse(manifestBytes);
  requireExact(canonicalJson(manifest), manifestBytes.toString("utf8"), "canonical manifest bytes");
  const rebuilt = buildReleaseManifest({
    version: context.version,
    ref: options.sourceRef,
    commitSha: context.commitSha,
    treeSha: context.treeSha,
    assets: [
      [context.names.tarball, "application/gzip", tarball],
      [context.names.checksum, "text/plain", readFileSync(paths.checksum)],
      [context.names.sbom, "application/vnd.cyclonedx+json", sbomBytes],
    ].map(([name, mediaType, bytes]) => ({
      name,
      mediaType,
      bytes: bytes.length,
      sha256: sha256(bytes),
    })),
    ...(context.machineContractBinding === null
      ? {}
      : { machineContractBinding: context.machineContractBinding }),
  });
  requireExact(canonicalJson(manifest), canonicalJson(rebuilt), "release manifest");

  const packageJson = JSON.parse(exec(
    "tar",
    ["-xOzf", paths.tarball, "package/package.json"],
    context.root,
  ));
  requireExact(packageJson.name, "@programmable/launch", "packed package name");
  requireExact(packageJson.version, context.version, "packed package version");
  const entries = exec("tar", ["-tzf", paths.tarball], context.root).split("\n");
  if (
    entries.length < 1
    || entries.some((entry) => !entry.startsWith("package/") || entry.includes("../"))
  ) {
    throw new Error("Tarball contains an invalid entry path.");
  }
}

function repositoryContext(options) {
  const root = realpathSync(resolve(options.repositoryRoot));
  const packageRoot = join(root, "packages", "launch");
  const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  requireExact(packageJson.name, "@programmable/launch", "package name");
  requireExact(
    packageJson.packageManager,
    `npm@${RELEASE_NPM_VERSION}`,
    "package manager",
  );
  requirePattern(packageJson.version, VERSION, "package version");
  if (options.expectedVersion !== undefined) {
    requireExact(packageJson.version, options.expectedVersion, "requested version");
  }
  const commitSha = exec("git", ["rev-parse", "HEAD"], root);
  const treeSha = exec("git", ["rev-parse", "HEAD^{tree}"], root);
  requirePattern(commitSha, COMMIT, "source commit");
  requirePattern(treeSha, COMMIT, "source tree");
  if (!/^refs\/heads\/[A-Za-z0-9._/-]+$/u.test(options.sourceRef ?? "")) {
    throw new Error("Source ref is invalid.");
  }
  const bindingTools = releaseBindingTools(packageJson.version);
  const machineContractBinding = bindingTools !== null
    ? (() => {
        const result = bindingTools.requireV4ReleaseReady({ repositoryRoot: root });
        return Object.freeze({
          schemaVersion: bindingTools.V4_RELEASE_BINDING_SCHEMA,
          path: bindingTools.V4_RELEASE_BINDING_PATH,
          sha256: result.bindingSha256,
        });
      })()
    : null;
  return Object.freeze({
    root,
    packageRoot,
    output: resolve(options.outputDir),
    version: packageJson.version,
    names: releaseNames(packageJson.version),
    commitSha,
    treeSha,
    machineContractBinding,
  });
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  if (!new Set(["build", "verify"]).has(command)) {
    throw new Error("Usage: programmable-launch-release-assets.mjs <build|verify> --repository-root PATH --output-dir PATH --source-ref REF [--expected-version VERSION]");
  }
  if (rest.length % 2 !== 0) throw new Error("Release asset arguments are invalid.");
  const values = new Map();
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!/^--[a-z][a-z-]*$/u.test(flag ?? "") || value === undefined || values.has(flag)) {
      throw new Error("Release asset arguments are invalid.");
    }
    values.set(flag, value);
  }
  const allowed = new Set([
    "--repository-root",
    "--output-dir",
    "--source-ref",
    "--expected-version",
  ]);
  if ([...values.keys()].some((key) => !allowed.has(key))) {
    throw new Error("Release asset argument is not supported.");
  }
  for (const required of ["--repository-root", "--output-dir", "--source-ref"]) {
    if (!values.has(required)) throw new Error(`Missing ${required}.`);
  }
  return {
    command,
    repositoryRoot: values.get("--repository-root"),
    outputDir: values.get("--output-dir"),
    sourceRef: values.get("--source-ref"),
    expectedVersion: values.get("--expected-version"),
  };
}

function exec(file, arguments_, cwd) {
  return execFileSync(file, arguments_, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortJson(value[key])]),
  );
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requirePattern(value, pattern, name) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${name} is invalid.`);
  }
}

function requireExact(actual, expected, name) {
  if (actual !== expected) {
    throw new Error(`${name} does not match the closed release binding.`);
  }
}

const directInvocation = process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (directInvocation) {
  const options = parseCli(process.argv.slice(2));
  if (options.command === "build") build(options);
  else verify(options);
}
