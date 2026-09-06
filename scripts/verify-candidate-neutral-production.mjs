#!/usr/bin/env node

import { readdir, readFile, stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import process from "node:process";

const rootArgumentIndex = process.argv.indexOf("--root");
const includeBuild = process.argv.includes("--include-build");
const repositoryRoot = resolve(
  rootArgumentIndex === -1 ? process.cwd() : process.argv[rootArgumentIndex + 1],
);

const SOURCE_ROOTS = Object.freeze([
  ".github/workflows",
  "app",
  "components",
  "config",
  "contracts",
  "docs",
  "indexer",
  "lib",
  "ops",
  "public",
  "scripts",
  "supabase",
  "tests",
]);
const PACKAGE_FILES = Object.freeze([
  "package.json",
  "package-lock.json",
  "next.config.ts",
  "vercel.json",
  ".env.example",
  ".gitleaks.toml",
  "eslint.config.mjs",
]);
const BUILD_ROOTS = Object.freeze([".next/server", ".next/static"]);
const TEXT_EXTENSIONS = new Set([
  ".css",
  ".graphql",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mdx",
  ".mjs",
  ".map",
  ".mts",
  ".py",
  ".rs",
  ".sh",
  ".sol",
  ".sql",
  ".svg",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".xml",
  ".yaml",
  ".yml",
]);
const SELF_PATH = "scripts/verify-candidate-neutral-production.mjs";
const TEST_PATH = "scripts/test/verify-candidate-neutral-production.test.mjs";

const projectNames = Object.freeze([
  ["hook", "emon"].join(""),
  ["sh", "ards"].join(""),
  ["random", "holder", "rewards"].join("[-_ ]?"),
  ["jesse", "stahl"].join("[-_ ]?"),
]);
const projectNamePatterns = Object.freeze(
  projectNames.map((name) => new RegExp(name, "iu")),
);
const applicantIdentityPatterns = Object.freeze([
  new RegExp(`(?:^|[^A-Za-z0-9])${["a", "eon"].join("")}(?:$|[^A-Za-z0-9])|${["aeon", "framework"].join("")}`, "iu"),
  new RegExp(`(?:^|[^A-Za-z0-9])${["based", "bid"].join("")}(?:$|[^A-Za-z0-9])|\\b${["based", "bid", "x"].join("")}\\b`, "iu"),
]);
const applicantCardMarkers = Object.freeze([
  ["13253", "24453"].join(""),
  ["AEON", "PROVIDER", "ID"].join("_"),
  ["aeon", "-v1"].join(""),
  ["aeon", "-partner-custom"].join(""),
  ["aeon-launch", "-models"].join(""),
  ["custom-registry-v1", "primary-contract"].join("-"),
  ["included-in", "partner-total"].join("-"),
  ["0x6a57bf3e092626be760d417986e6103c2", "0fdbc3e"].join(""),
  ["0x17e18c88bda9bfb73924cdc989c07b070", "7e72671"].join(""),
  ["0xf8aef69201621ad20fa256da595426b7e", "6192dba"].join(""),
  ["0xcc916e5200d2626edfd918dc219bc4296", "629e997"].join(""),
  ["0x7a814ecb2d2b8be2debb29481f25f06e", "976559eec41fa7c8d92e030ec69fc9ff"].join(""),
]);
const applicantCardPatterns = Object.freeze(
  applicantCardMarkers.map((name) => new RegExp(name, "iu")),
);
const reviewedRegistryV1CompatibilityPatterns = new Set(
  applicantCardPatterns.slice(8, 11),
);
const forbiddenContent = Object.freeze([
  ...projectNamePatterns,
  ...applicantIdentityPatterns,
  ...applicantCardPatterns,
  new RegExp(["submit-launch", "pull", "13"].join("[/# ]+"), "iu"),
  /manual[-_ ]?router/iu,
  /manual[-_ ]?applicant/iu,
  /router[-_ ]?v2[-_ ]?shared[-_ ]?lifecycle/iu,
]);
const forbiddenPath = Object.freeze([
  ...projectNames.map((name) => new RegExp(name, "iu")),
  ...applicantIdentityPatterns,
  ...applicantCardMarkers.map((name) => new RegExp(name, "iu")),
  /manual[-_]?router/iu,
  /manual[-_]?applicant/iu,
  /router[-_]?v2[-_]?shared[-_]?lifecycle/iu,
]);

const reviewedRouterAdapterSourcePath =
  "lib/custom-launch/router-trade-adapters-v1.ts";
const reviewedRouterAdapterTestPath =
  "tests/router-trade-adapters-v1.test.ts";
const reviewedRouterAdapterProjectPattern = projectNamePatterns[1];
const reviewedRouterAdapterRuntimeMarkers = Object.freeze([
  ["router-custom-", "shards", "-v1-trade-v1"].join(""),
  "programmable.launch-stamp-provenance.v1",
  "0xe253f3bd22fcb3d6cb20b9d408287e30f0f1aeeb56426b779425c35fd6411de9",
  "0x55fbb83ac4599303b146cb4a2f7c1c906d8b3e9fe4fbbe5bf9cf44e905cc3ce0",
  "0xface73b63787960282f2d4682d3752beb25271ad",
  "0x07a16735325723fea4f4a52ed5e9da687766a0cc",
  "0xb2737fd93f2ff31e850e2be773e6e7a92a239b28091be1d4b122ff864cd7aae8",
  "0x168f82b0d458a35676522562489b2fec71929e4717c3d98b4893ef63e69e8da6",
  "0x0175cb3f34e2c37f757216a259adea4ab10baf3f9095c67d9481800222fd17f0",
  "0x4d4617e5d86bfb2b1ed32b5405748fb9e145301bc94f2d6c0fed75b6d7d1181b",
]);
const reviewedRouterAdapterSourceMarkers = Object.freeze([
  ...reviewedRouterAdapterRuntimeMarkers,
  "SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_V1",
  "SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH",
  "canonicalSha256(",
]);
const reviewedRouterAdapterTestMarkers = Object.freeze([
  "SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_V1",
  "SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH",
  "shardRouterTradeStamp",
  "canonicalSha256(",
  ".toEqual(shardRouterTradeStamp)",
]);
const reviewedRegistryV1IndexerPaths = new Set([
  "indexer/config.yaml",
  "indexer/live-production-92f6373.config.yaml",
  "indexer/src/lib/release-map.ts",
  "indexer/test/replay.test.ts",
]);
const reviewedRegistryV1IndexerMarkers = Object.freeze([
  "CustomAtomicRegistrarV1",
  "CustomPartnerFactoryRegistryV1",
  "CustomRegistryV1",
  applicantCardMarkers[8],
  applicantCardMarkers[9],
  applicantCardMarkers[10],
]);

function containsEvery(source, markers) {
  return markers.every((marker) => source.toLowerCase().includes(
    marker.toLowerCase(),
  ));
}

function allowsReviewedRouterAdapterProjectName(
  repositoryPath,
  source,
  pattern,
) {
  if (pattern !== reviewedRouterAdapterProjectPattern) return false;
  if (repositoryPath === reviewedRouterAdapterSourcePath) {
    return containsEvery(source, reviewedRouterAdapterSourceMarkers);
  }
  if (repositoryPath === reviewedRouterAdapterTestPath) {
    return containsEvery(source, reviewedRouterAdapterTestMarkers);
  }
  return repositoryPath.startsWith(".next/server/")
    && containsEvery(source, reviewedRouterAdapterRuntimeMarkers);
}

function allowsReviewedRegistryV1IndexerCompatibility(
  repositoryPath,
  source,
  pattern,
) {
  return (
    reviewedRegistryV1CompatibilityPatterns.has(pattern) &&
    reviewedRegistryV1IndexerPaths.has(repositoryPath) &&
    containsEvery(source, reviewedRegistryV1IndexerMarkers)
  );
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

async function collectFiles(path) {
  if (!(await exists(path))) return [];
  const entryStat = await stat(path);
  if (entryStat.isFile()) return [path];
  const entries = await readdir(path, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    if (entry.name === "node_modules" || entry.name === ".next") return [];
    return collectFiles(resolve(path, entry.name));
  }));
  return nested.flat();
}

// Source-map mappings encode numeric deltas as Base64 VLQs. Their letters can
// coincidentally spell a candidate name. Keep scanning every semantic field,
// including dependency sources and names, while removing only valid mapping
// data from emitted Source Map v3 objects. Unknown/malformed maps fail closed.
function validMappingData(mappings) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  for (const line of mappings.split(";")) {
    if (line === "") continue;
    for (const segment of line.split(",")) {
      let fields = 0;
      let continuing = false;
      for (const character of segment) {
        const value = alphabet.indexOf(character);
        if (value === -1) return false;
        continuing = (value & 32) !== 0;
        if (!continuing) fields += 1;
      }
      if (continuing || ![1, 4, 5].includes(fields)) return false;
    }
  }
  return true;
}

function sourceMapScanProjection(map) {
  if (!map || Array.isArray(map) || typeof map !== "object" || map.version !== 3) {
    throw new Error("Invalid emitted Source Map v3 object");
  }
  if (Array.isArray(map.sections)) {
    // Turbopack emits an empty sources list on its indexed maps.
    if ("mappings" in map || "sourcesContent" in map || "names" in map
      || ("sources" in map && (!Array.isArray(map.sources) || map.sources.length !== 0))) {
      throw new Error("Mixed indexed and ordinary source map");
    }
    return { ...map, sections: map.sections.map((section) => {
      if (!section || typeof section !== "object" || Array.isArray(section)
        || !section.offset || !Number.isInteger(section.offset.line) || section.offset.line < 0
        || !Number.isInteger(section.offset.column) || section.offset.column < 0 || "url" in section) {
        throw new Error("Invalid emitted source map section");
      }
      return { ...section, map: sourceMapScanProjection(section.map) };
    }) };
  }
  if (!Array.isArray(map.sources) || map.sources.some((value) => typeof value !== "string")
    || !Array.isArray(map.names) || map.names.some((value) => typeof value !== "string")
    || typeof map.mappings !== "string" || !validMappingData(map.mappings)
    || ("sourcesContent" in map && (!Array.isArray(map.sourcesContent)
      || map.sourcesContent.length !== map.sources.length
      || map.sourcesContent.some((value) => value !== null && typeof value !== "string")))) {
    throw new Error("Invalid emitted source map fields or mapping data");
  }
  return { ...map, mappings: "" };
}

const discovered = (
  await Promise.all([
    ...SOURCE_ROOTS.map((path) => collectFiles(resolve(repositoryRoot, path))),
    ...(includeBuild
      ? BUILD_ROOTS.map((path) => collectFiles(resolve(repositoryRoot, path)))
      : []),
    ...PACKAGE_FILES.map((path) => collectFiles(resolve(repositoryRoot, path))),
  ])
).flat();
const failures = [];

for (const absolutePath of discovered) {
  const repositoryPath = relative(repositoryRoot, absolutePath).replaceAll("\\", "/");
  if (repositoryPath === SELF_PATH || repositoryPath === TEST_PATH) continue;
  if (forbiddenPath.some((pattern) => pattern.test(repositoryPath))) {
    failures.push(`${repositoryPath}: forbidden candidate or legacy route path`);
    continue;
  }
  if (!TEXT_EXTENSIONS.has(extname(repositoryPath)) && !PACKAGE_FILES.includes(repositoryPath)) {
    continue;
  }
  let source = await readFile(absolutePath, "utf8");
  if (extname(repositoryPath) === ".map"
    && BUILD_ROOTS.some((path) => repositoryPath.startsWith(`${path}/`))) {
    try {
      source = JSON.stringify(sourceMapScanProjection(JSON.parse(source)));
    } catch {
      failures.push(`${repositoryPath}: invalid emitted source map`);
      continue;
    }
  }
  const disallowedPattern = forbiddenContent
    .filter((pattern) => pattern.test(source))
    .find((pattern) =>
      !allowsReviewedRouterAdapterProjectName(
        repositoryPath,
        source,
        pattern,
      ) &&
      !allowsReviewedRegistryV1IndexerCompatibility(
        repositoryPath,
        source,
        pattern,
      ));
  if (disallowedPattern) {
    failures.push(`${repositoryPath}: forbidden candidate or legacy route content`);
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.sort().join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("CANDIDATE_NEUTRAL_PRODUCTION_SOURCE_VALID\n");
}
