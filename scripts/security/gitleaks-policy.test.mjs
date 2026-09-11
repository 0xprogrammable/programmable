import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";

const binary = process.env.PROGRAMMABLE_GITLEAKS_BINARY;
const config = fileURLToPath(new URL("../../.gitleaks.toml", import.meta.url));
const creationHash = "0x445809d9f7a34e959de4a96dec1e1beddfb265755bf28c57c42744adea1128ef";
const reviewAsset = "0xe7f1725e7734ce288f8367e1bb143e90bb3f0512";
const material = createHash("sha256").update("gitleaks negative control only").digest("hex");
const catalog = "config/module-engine/catalog.json";
const anyQuoteIndexFixtures = [
  "tests/fixtures/module-engine-any-quote-index.json",
  "tests/fixtures/module-engine-any-quote-eth-index.json",
];
const anyQuoteEthBasis = "contracts/scripts/module-engine/any-quote-eth-basis.mjs";
const visibilityTest = "tests/robinhood-website-index.test.ts";
const anyQuoteCanary = "0xb36271399c031ce270e0d1eed5f26dcd08367119";
// Public synthetic index evidence includes both sides of the final salt-domain correction.
const anyQuoteAddresses = [
  "0xd803cd624d58e1f31d1043f630953e6dbdf6a128",
  "0x38665576617c205e3cac17a3eefa8bd6475dcc34",
];
const [creation, runtime] = [
  "0xd2ee78b8bc95f6a8df6f94c6e4c0a49d77639f5b7697eaf06b0c6b6b38134766",
  "0x21f0bf03dc072ce066e4a72c64fee2b8178bcabc2a69853977b29c45240460c2",
];
const anyQuotePublicFields = [
  ...anyQuoteAddresses.flatMap((value) => [{ token: value }, { primaryToken: value }]),
  { tokenCreationCodeHash: creation },
  { tokenRuntimeCodeHash: runtime },
];
const hashPaths = [
  "config/module-engine/robinhood.json",
  catalog,
  "public/developers/modules/0x81185e910dec1032df4bd027f8139f524606f628c0a63dbae62c69bb86e470da/manifest.json",
  "public/developers/modules/0x616f4584f5ec576a88bac5b6d5ee1ae841713f02129ab71a9b47e7e900312b2f/manifest.json",
  "public/developers/modules/0xeec9f1128106907da53b9a729206a0ad78e1e6c0379fde31636a2986f9b03c08/manifest.json",
];

before(() => {
  assert.ok(binary, "Pass the checksum-verified CI binary as PROGRAMMABLE_GITLEAKS_BINARY");
  const version = spawnSync(binary, ["version"], { encoding: "utf8" });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), "8.30.1");
});

function scan(t, files, { raw = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "programmable-gitleaks-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, value] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    if (raw) assert.equal(typeof value, "string");
    writeFileSync(target, `${raw ? value : JSON.stringify(value)}\n`, { mode: 0o600 });
  }
  for (const args of [["init", "--quiet"], ["add", "--force", "--", ...Object.keys(files)]]) {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const report = join(root, "findings.json");
  writeFileSync(report, "", { mode: 0o600 });
  const result = spawnSync(binary, [
    "git", root, "--pre-commit", "--staged", "--config", config,
    "--redact=100", "--no-banner", "--report-format", "json", "--report-path", report,
  ], { cwd: root, encoding: "utf8" });
  assert.ok(result.status === 0 || result.status === 1, result.stderr);
  const findings = JSON.parse(readFileSync(report, "utf8"))
    .map(({ File, RuleID }) => ({ File, RuleID }));
  assert.equal(result.status, findings.length === 0 ? 0 : 1);
  assert.ok(findings.every(({ RuleID }) => RuleID === "generic-api-key"));
  return findings;
}

function publicFields(path) {
  return {
    tokenCreationCodeHash: creationHash,
    ...(path === catalog ? { token: reviewAsset } : {}),
  };
}

function assertFiles(findings, paths, count = paths.length) {
  assert.equal(findings.length, count);
  assert.deepEqual([...new Set(findings.map(({ File }) => File))].sort(), [...paths].sort());
}

test("accepts exact Engine V1 public hash fields and the reviewed fixture address", (t) => {
  assert.deepEqual(scan(t, Object.fromEntries(hashPaths.map((path) => [path, publicFields(path)]))), []);
});

test("detects a generic credential beside allowed fields on the same JSON line", (t) => {
  const files = Object.fromEntries(hashPaths.map((path) => [path, {
    ...publicFields(path), apiKey: material,
  }]));
  assertFiles(scan(t, files), hashPaths);
});

test("keeps the exact public values detectable under neighbouring credential fields", (t) => {
  const files = Object.fromEntries(hashPaths.map((path) => [path, {
    ...publicFields(path), apiKey: path === catalog ? reviewAsset : creationHash,
  }]));
  assertFiles(scan(t, files), hashPaths);
});

test("detects replacement values under the allowed field names", (t) => {
  const files = Object.fromEntries(hashPaths.map((path) => [path, {
    tokenCreationCodeHash: `0x${material}`,
    ...(path === catalog ? { token: `0x${material.slice(0, 40)}` } : {}),
  }]));
  assertFiles(scan(t, files), hashPaths, hashPaths.length + 1);
});

test("keeps public values detectable in adjacent or unlisted paths", (t) => {
  const files = {
    "config/module-engine/robinhood-next.json": { tokenCreationCodeHash: creationHash },
    "config/module-engine/catalog-next.json": { token: reviewAsset },
    "public/developers/modules/unreviewed/manifest.json": { tokenCreationCodeHash: creationHash },
    [`public/developers/modules/0x${"1".repeat(64)}/manifest.json`]: { tokenCreationCodeHash: creationHash },
    [`${hashPaths[2]}.backup`]: { tokenCreationCodeHash: creationHash },
  };
  assertFiles(scan(t, files), Object.keys(files));
});

test("accepts exact current and historical public Any Quote index fixture fields", (t) => {
  assert.deepEqual(scan(t, Object.fromEntries(anyQuoteIndexFixtures.map((path) => [path, anyQuotePublicFields]))), []);
});

test("detects a credential beside all allowed Any Quote fields on the same JSON line", (t) => {
  assertFiles(scan(t, Object.fromEntries(anyQuoteIndexFixtures.map((path) => [path, {
    evidence: anyQuotePublicFields, apiKey: material,
  }]))), anyQuoteIndexFixtures);
});

test("keeps each exact Any Quote public value detectable under a credential field", (t) => {
  for (const fields of anyQuotePublicFields) {
    const value = Object.values(fields)[0];
    assertFiles(scan(t, Object.fromEntries(anyQuoteIndexFixtures.map((path) => [path, {
      ...fields, apiKey: value,
    }]))), anyQuoteIndexFixtures);
  }
});

test("detects replacement values under each allowed Any Quote field name", (t) => {
  for (const fields of anyQuotePublicFields) {
    const [field, value] = Object.entries(fields)[0];
    const replacement = `0x${material.slice(0, value.length - 2)}`;
    assertFiles(scan(t, Object.fromEntries(anyQuoteIndexFixtures.map((path) => [path, {
      [field]: replacement,
    }]))), anyQuoteIndexFixtures);
  }
});

test("keeps every Any Quote public fixture field detectable in adjacent and unlisted paths", (t) => {
  for (const fields of anyQuotePublicFields) {
    const files = {
      ...Object.fromEntries(anyQuoteIndexFixtures.flatMap((path) => [
        [path.replace(".json", "-next.json"), fields],
        [`${path}.backup`, fields],
      ])),
      "config/module-engine/any-quote-index.json": fields,
    };
    assertFiles(scan(t, files), Object.keys(files));
  }
});

test("accepts only the exact public creation commitment line in the native deployment basis", (t) => {
  assert.deepEqual(scan(t, {
    [anyQuoteEthBasis]: `  "tokenCreationCodeHash": "${creationHash}",`,
  }, { raw: true }), []);
});

test("detects a credential beside the native deployment basis commitment", (t) => {
  assertFiles(scan(t, {
    [anyQuoteEthBasis]: `  "tokenCreationCodeHash": "${creationHash}", "apiKey": "${material}"`,
  }, { raw: true }), [anyQuoteEthBasis], 2);
});

test("keeps the exact basis commitment detectable under a credential field", (t) => {
  assertFiles(scan(t, {
    [anyQuoteEthBasis]: `  "apiKey": "${creationHash}",`,
  }, { raw: true }), [anyQuoteEthBasis]);
});

test("detects a replacement creation commitment in the native deployment basis", (t) => {
  assertFiles(scan(t, {
    [anyQuoteEthBasis]: `  "tokenCreationCodeHash": "0x${material}",`,
  }, { raw: true }), [anyQuoteEthBasis]);
});

test("keeps the basis commitment detectable in adjacent and unlisted paths", (t) => {
  const files = Object.fromEntries([
    anyQuoteEthBasis.replace(".mjs", "-next.mjs"),
    `${anyQuoteEthBasis}.backup`,
    "contracts/scripts/module-engine/unreviewed-basis.mjs",
  ].map((path) => [path, `  "tokenCreationCodeHash": "${creationHash}",`]));
  assertFiles(scan(t, files, { raw: true }), Object.keys(files));
});

test("accepts the exact public Any Quote canary tokenAddress field in its visibility test", (t) => {
  assert.deepEqual(scan(t, {
    [visibilityTest]: `const launch = { tokenAddress: "${anyQuoteCanary}", name: "Any Quote LP Internal Test", symbol: "AQLPTEST" };`,
  }, { raw: true }), []);
});

test("keeps the public Any Quote canary detectable under a neighbouring credential field", (t) => {
  assertFiles(scan(t, {
    [visibilityTest]: `const launch = { tokenAddress: "${anyQuoteCanary}", apiKey: "${anyQuoteCanary}" };`,
  }, { raw: true }), [visibilityTest]);
});

test("detects a changed tokenAddress value in the canary visibility test", (t) => {
  assertFiles(scan(t, {
    [visibilityTest]: `const launch = { tokenAddress: "0x${material.slice(0, 40)}" };`,
  }, { raw: true }), [visibilityTest]);
});

test("keeps the exact canary field detectable in neighbouring and prefixed test paths", (t) => {
  const paths = ["tests/robinhood-website-index-next.test.ts", `${visibilityTest}.backup`, `fixtures/${visibilityTest}`];
  assertFiles(scan(t, Object.fromEntries(paths.map(path => [path,
    `const launch = { tokenAddress: "${anyQuoteCanary}" };`,
  ])), { raw: true }), paths);
});

test("detects another credential before or after the allowed canary field on the same line", (t) => {
  const publicField = `tokenAddress: "${anyQuoteCanary}"`, credential = `apiKey: "${material}"`;
  for (const fields of [`${publicField}, ${credential}`, `${credential}, ${publicField}`]) {
    assertFiles(scan(t, { [visibilityTest]: `const launch = { ${fields} };` }, { raw: true }), [visibilityTest]);
  }
});
