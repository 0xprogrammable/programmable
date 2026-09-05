import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const verifier = join(
  process.cwd(),
  "scripts/verify-candidate-neutral-production.mjs",
);

async function fixture(files) {
  const root = await mkdtemp(join(tmpdir(), "programmable-neutral-source-"));
  for (const [path, source] of Object.entries(files)) {
    const target = join(root, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, source, "utf8");
  }
  return root;
}

function verify(root, ...args) {
  return spawnSync(process.execPath, [verifier, "--root", root, ...args], {
    encoding: "utf8",
  });
}

test("accepts a descriptor-driven production surface", async () => {
  const root = await fixture({
    "app/launch/page.tsx": "export default function Page() { return null; }\n",
    "lib/server/custom-launch/generic-launch-read-v1.ts":
      "export const descriptorDriven = true;\n",
    "package.json": JSON.stringify({ scripts: { build: "next build" } }),
  });
  const result = verify(root);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /CANDIDATE_NEUTRAL_PRODUCTION_SOURCE_VALID/u);
});

test("rejects candidate identities in production source", async () => {
  const projectName = ["Hook", "emon"].join("");
  const root = await fixture({
    "components/launch-console.tsx": `export const identity = "${projectName}";\n`,
  });
  const result = verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /components\/launch-console\.tsx/u);
});

test("allows only the exact reviewed Router adapter evidence path", async () => {
  const projectName = ["sh", "ards"].join("");
  const runtimeMarkers = [
    ["router-custom-", projectName, "-v1-trade-v1"].join(""),
    "programmable.launch-stamp-provenance.v1",
    "0xe253f3bd22fcb3d6cb20b9d408287e30f0f1aeeb56426b779425c35fd6411de9",
    "0x55fbb83ac4599303b146cb4a2f7c1c906d8b3e9fe4fbbe5bf9cf44e905cc3ce0",
    "0xface73b63787960282f2d4682d3752beb25271ad",
    "0x07a16735325723fea4f4a52ed5e9da687766a0cc",
    "0xb2737fd93f2ff31e850e2be773e6e7a92a239b28091be1d4b122ff864cd7aae8",
    "0x168f82b0d458a35676522562489b2fec71929e4717c3d98b4893ef63e69e8da6",
    "0x0175cb3f34e2c37f757216a259adea4ab10baf3f9095c67d9481800222fd17f0",
    "0x4d4617e5d86bfb2b1ed32b5405748fb9e145301bc94f2d6c0fed75b6d7d1181b",
  ];
  const sourceMarkers = [
    ...runtimeMarkers,
    "SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_V1",
    "SHARD_REVIEWED_LAUNCH_STAMP_EVIDENCE_HASH",
    "canonicalSha256(",
  ];
  const exactSource = `${sourceMarkers.join("\n")}\n`;
  const acceptedRoot = await fixture({
    "lib/custom-launch/router-trade-adapters-v1.ts": exactSource,
  });
  const accepted = verify(acceptedRoot);
  assert.equal(accepted.status, 0, accepted.stderr);

  const incompleteRoot = await fixture({
    "lib/custom-launch/router-trade-adapters-v1.ts":
      `${sourceMarkers.slice(0, -1).join("\n")}\n`,
  });
  const incomplete = verify(incompleteRoot);
  assert.equal(incomplete.status, 1);
  assert.match(incomplete.stderr, /router-trade-adapters-v1\.ts/u);

  const wrongPathRoot = await fixture({
    "lib/custom-launch/unreviewed-adapter.ts": exactSource,
  });
  const wrongPath = verify(wrongPathRoot);
  assert.equal(wrongPath.status, 1);
  assert.match(wrongPath.stderr, /unreviewed-adapter\.ts/u);
});

test("allows exact reviewed adapter evidence only in server output", async () => {
  const projectName = ["sh", "ards"].join("");
  const exactServerBundle = [
    ["router-custom-", projectName, "-v1-trade-v1"].join(""),
    "programmable.launch-stamp-provenance.v1",
    "0xe253f3bd22fcb3d6cb20b9d408287e30f0f1aeeb56426b779425c35fd6411de9",
    "0x55fbb83ac4599303b146cb4a2f7c1c906d8b3e9fe4fbbe5bf9cf44e905cc3ce0",
    "0xface73b63787960282f2d4682d3752beb25271ad",
    "0x07a16735325723fea4f4a52ed5e9da687766a0cc",
    "0xb2737fd93f2ff31e850e2be773e6e7a92a239b28091be1d4b122ff864cd7aae8",
    "0x168f82b0d458a35676522562489b2fec71929e4717c3d98b4893ef63e69e8da6",
    "0x0175cb3f34e2c37f757216a259adea4ab10baf3f9095c67d9481800222fd17f0",
    "0x4d4617e5d86bfb2b1ed32b5405748fb9e145301bc94f2d6c0fed75b6d7d1181b",
  ].join("\n");
  const serverRoot = await fixture({
    ".next/server/app/api/explore/token/route.js": exactServerBundle,
  });
  const serverResult = verify(serverRoot, "--include-build");
  assert.equal(serverResult.status, 0, serverResult.stderr);

  const clientRoot = await fixture({
    ".next/static/chunks/explore.js": exactServerBundle,
  });
  const clientResult = verify(clientRoot, "--include-build");
  assert.equal(clientResult.status, 1);
  assert.match(clientResult.stderr, /.next\/static\/chunks\/explore\.js/u);
});

test("rejects legacy applicant route paths even when their source is generic", async () => {
  const legacySegment = ["manual", "router"].join("-");
  const root = await fixture({
    [`lib/server/custom-launch/${legacySegment}-service.ts`]:
      "export const service = true;\n",
  });
  const result = verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /forbidden candidate or legacy route path/u);
});

test("rejects a candidate identity in the compiled production bundle", async () => {
  const projectName = ["Sh", "ards"].join("");
  const root = await fixture({
    ".next/server/app/launch/page.js": `export const identity = "${projectName}";\n`,
  });
  const result = verify(root, "--include-build");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /.next\/server\/app\/launch\/page\.js/u);
});

test("rejects applicant cards in source and emitted production bundles", async () => {
  const applicant = ["a", "eon"].join("");
  const secondApplicant = ["based", "bid"].join("");
  const sourceRoot = await fixture({
    "components/launch-console.tsx":
      `export const card = "launch-model-${applicant}";\n`,
  });
  const sourceResult = verify(sourceRoot);
  assert.equal(sourceResult.status, 1);
  assert.match(sourceResult.stderr, /components\/launch-console\.tsx/u);

  const buildRoot = await fixture({
    ".next/static/chunks/launch.js":
      `export const profile = "https://x.com/${secondApplicant}x";\n`,
  });
  const buildResult = verify(buildRoot, "--include-build");
  assert.equal(buildResult.status, 1);
  assert.match(buildResult.stderr, /.next\/static\/chunks\/launch\.js/u);
});

test("rejects retired applicant fee and Registry V1 bindings", async () => {
  const retiredMode = ["custom-registry-v1", "primary-contract"].join("-");
  const oldRegistry = [
    "0x17e18c88bda9bfb73924cdc989c07b070",
    "7e72671",
  ].join("");
  for (const [path, source] of [
    ["lib/custom-launch/route.ts", `export const mode = "${retiredMode}";\n`],
    ["config/release.json", JSON.stringify({ registry: oldRegistry })],
  ]) {
    const root = await fixture({ [path]: source });
    const result = verify(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(path.replaceAll("/", "\\/"), "u"));
  }
});

test("allows only the complete reviewed Registry V1 indexer compatibility surface", async () => {
  const registryMarkers = [
    "CustomAtomicRegistrarV1",
    "CustomPartnerFactoryRegistryV1",
    "CustomRegistryV1",
    ["0x17e18c88bda9bfb73924cdc989c07b070", "7e72671"].join(""),
    ["0xf8aef69201621ad20fa256da595426b7e", "6192dba"].join(""),
    ["0xcc916e5200d2626edfd918dc219bc4296", "629e997"].join(""),
  ];
  const exactSurface = `${registryMarkers.join("\n")}\n`;
  const acceptedRoot = await fixture({
    "indexer/config.yaml": exactSurface,
  });
  const accepted = verify(acceptedRoot);
  assert.equal(accepted.status, 0, accepted.stderr);

  const incompleteRoot = await fixture({
    "indexer/config.yaml": `${registryMarkers.slice(0, -1).join("\n")}\n`,
  });
  const incomplete = verify(incompleteRoot);
  assert.equal(incomplete.status, 1);
  assert.match(incomplete.stderr, /indexer\/config\.yaml/u);

  const wrongPathRoot = await fixture({
    "config/release.json": exactSurface,
  });
  const wrongPath = verify(wrongPathRoot);
  assert.equal(wrongPath.status, 1);
  assert.match(wrongPath.stderr, /config\/release\.json/u);

  const applicantToken = [
    "0x7a814ecb2d2b8be2debb29481f25f06e",
    "976559eec41fa7c8d92e030ec69fc9ff",
  ].join("");
  const contaminatedRoot = await fixture({
    "indexer/config.yaml": `${exactSurface}${applicantToken}\n`,
  });
  const contaminated = verify(contaminatedRoot);
  assert.equal(contaminated.status, 1);
  assert.match(contaminated.stderr, /indexer\/config\.yaml/u);
});

test("rejects the retired Solidity identity and intake markers", async () => {
  const providerIdentifier = ["AEON", "PROVIDER", "ID"].join("_");
  const intake = ["aeon", "-v1"].join("");
  for (const [path, source] of [
    ["contracts/src/FeePolicy.sol", `bytes32 constant ${providerIdentifier} = 0x00;\n`],
    [".next/server/app/launch.js", `export const intake = "${intake}";\n`],
    [".next/static/chunks/launch.js", `export const asset = "${["based", "bid", "_v1"].join("")}";\n`],
  ]) {
    const root = await fixture({ [path]: source });
    const result = verify(root, ...(path.startsWith(".next/") ? ["--include-build"] : []));
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(path.replaceAll("/", "\\/"), "u"));
  }
});

test("rejects a candidate identity in contract source", async () => {
  const projectName = ["Sh", "ards"].join("");
  const root = await fixture({
    "contracts/src/ApplicantRoute.sol":
      `contract ApplicantRoute { string constant PROJECT = "${projectName}"; }\n`,
  });
  const result = verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /contracts\/src\/ApplicantRoute\.sol/u);
});

test("rejects a stale candidate exception in root configuration", async () => {
  const projectName = ["Hook", "emon"].join("");
  const root = await fixture({
    ".gitleaks.toml": `description = "${projectName} exception"\n`,
  });
  const result = verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /.gitleaks\.toml/u);
});

test("rejects an external applicant owner identity in tests", async () => {
  const owner = ["jesse", "stahl"].join("-");
  const root = await fixture({
    "tests/wallet-state.test.ts": `export const owner = "${owner}";\n`,
  });
  const result = verify(root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tests\/wallet-state\.test\.ts/u);
});

function sourceMap(overrides = {}) {
  return { version: 3, sources: ["dependency.js"], sourcesContent: ["export const generic = true;"],
    names: [], mappings: ["AAAA", ["AE", "ON"].join(""), "CAAA"].join(","), ...overrides };
}

test("numeric VLQ coincidences in emitted source maps are not candidate identities", async () => {
  const map = sourceMap();
  const root = await fixture({
    ".next/server/chunks/node_modules_library.js.map": JSON.stringify(map),
    ".next/static/chunks/app.js.map": JSON.stringify({ version: 3, sources: [],
      sections: [{ offset: { line: 0, column: 0 }, map }] }),
    ".next/server/app/empty/route.js.map": JSON.stringify({ version: 3, sources: [], sections: [] }),
  });
  const result = verify(root, "--include-build");
  assert.equal(result.status, 0, result.stderr);
});

test("dependency and application source-map semantic fields remain candidate-checked", async () => {
  const identity = ["a", "eon"].join("");
  for (const override of [
    { sources: [`${identity}.js`] },
    { sourcesContent: [`export const applicant = '${identity}';`] },
    { names: [identity] },
    { file: `${identity}.js` },
    { sourceRoot: `https://${identity}.example/` },
    { x_application: { identity } },
  ]) {
    const map = sourceMap(override);
    const root = await fixture({
      ".next/server/chunks/node_modules_library.js.map": JSON.stringify(map),
      ".next/static/chunks/app.js.map": JSON.stringify({ version: 3,
        sections: [{ offset: { line: 0, column: 0 }, map }] }),
    });
    const result = verify(root, "--include-build");
    assert.equal(result.status, 1, JSON.stringify(override));
    assert.match(result.stderr, /node_modules_library\.js\.map: forbidden/u);
    assert.match(result.stderr, /app\.js\.map: forbidden/u);
  }
});

test("escaped source-map identities are decoded before checking", async () => {
  const map = JSON.stringify(sourceMap({ names: [["a", "eon"].join("")] }));
  const root = await fixture({ ".next/server/chunks/app.js.map": map.replace(
    ["a", "eon"].join(""), "\\u0061\\u0065\\u006f\\u006e") });
  const result = verify(root, "--include-build");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /app\.js\.map: forbidden/u);
});

test("malformed emitted source maps fail closed", async () => {
  for (const invalid of ["not JSON", "null", JSON.stringify(sourceMap({ version: 2 })),
    JSON.stringify(sourceMap({ mappings: "AAAA,?" })),
    JSON.stringify(sourceMap({ mappings: "AAAA,g" })),
    JSON.stringify(sourceMap({ mappings: "AA" })),
    JSON.stringify(sourceMap({ names: "ignored" })),
    JSON.stringify(sourceMap({ sourcesContent: [] })),
    JSON.stringify({ version: 3, sections: [{ offset: { line: 0, column: 0 }, url: "other.map" }] })]) {
    const root = await fixture({ ".next/server/chunks/app.js.map": invalid });
    const result = verify(root, "--include-build");
    assert.equal(result.status, 1, invalid);
    assert.match(result.stderr, /app\.js\.map: invalid emitted source map/u);
  }
});

test("mapping exception does not cover source files, paths or generated JavaScript", async () => {
  const identity = ["AE", "ON"].join("");
  const root = await fixture({
    "public/vendor.js.map": JSON.stringify(sourceMap()),
    [`.next/static/chunks/${identity}.js.map`]: JSON.stringify(sourceMap({ mappings: "AAAA" })),
    ".next/server/chunks/library.js": `export const identity = '${identity}';`,
  });
  const result = verify(root, "--include-build");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /public\/vendor\.js\.map: forbidden/u);
  assert.match(result.stderr, /forbidden candidate or legacy route path/u);
  assert.match(result.stderr, /library\.js: forbidden/u);
});
