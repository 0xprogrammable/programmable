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

function scan(t, files) {
  const root = mkdtempSync(join(tmpdir(), "programmable-gitleaks-policy-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, value] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(value)}\n`, { mode: 0o600 });
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
