import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  CANONICAL_SKILL_ROOT,
  CLAUDE_MARKETPLACE_PATH,
  CODEX_MARKETPLACE_PATH,
  MARKETPLACE_ROOT,
  METADATA_PATH,
  PLUGIN_ROOT,
  ROOT_CLAUDE_MANIFEST_PATH,
  ROOT_CODEX_MANIFEST_PATH,
  buildClaudeManifest,
  buildClaudeMarketplace,
  buildCodexManifest,
  buildCodexMarketplace,
  loadMetadata,
  materializeDistribution,
  serializeJson,
  treeDigest,
  verifyDistribution,
  walkFiles
} from "../scripts/generate-plugin.mjs";

const goldenHashes = {
  skillTree: "c2e02ea0979ddd8859f82f15e28519a29a83cacac9494625802836181a62714f",
  codexManifest: "9d6c0e147f61bc68f48d78c48f3363e03e59129272da3a5fe813abc87d0ca505",
  claudeManifest: "639e7b39b03d1ec17a3886a79e667768335a8cf392acea903a05fdf537ce2609",
  codexMarketplace: "f51e251087f6d26c75308aeff915485de9493b619c31b5a59baca072d725d0c0",
  claudeMarketplace: "214475551068f84d699cada5adf4518ab3bd2bfe750be6ac4688bcd6ed1ef9c7"
};
const productPolicyTerms = /\b(?:acceptance|accepted|approval|approved|audit|audited|candidate|deploy|deployed|deployment|fee|mainnet|permit|provider|routing|safe|submission|unruggable|verified|wallet)\b/i;

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function readJson(target) {
  return JSON.parse(fs.readFileSync(target, "utf8"));
}

function fileSnapshot(root) {
  return walkFiles(root).map((row) => ({
    relativePath: row.relativePath,
    mode: row.mode,
    sha256: sha256(row.bytes)
  }));
}

function collectStrings(value, output = []) {
  if (typeof value === "string") {
    output.push(value);
  } else if (Array.isArray(value)) {
    for (const child of value) collectStrings(child, output);
  } else if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) collectStrings(child, output);
  }
  return output;
}

function frontmatterKeys(skillPath) {
  const source = fs.readFileSync(skillPath, "utf8");
  const lines = source.split("\n");
  assert.equal(lines[0], "---", `${skillPath} must start with YAML frontmatter`);
  const close = lines.indexOf("---", 1);
  assert.ok(close > 1, `${skillPath} must close YAML frontmatter`);
  return lines
    .slice(1, close)
    .filter((line) => /^[A-Za-z][A-Za-z0-9_-]*:/.test(line))
    .map((line) => line.slice(0, line.indexOf(":")));
}

function makeTemporaryRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `programmable-${label}-`));
}

test("committed distribution matches generator output", () => {
  const result = verifyDistribution();
  assert.equal(result.skillFiles, walkFiles(CANONICAL_SKILL_ROOT).length);
});

test("manifests and marketplace have stable golden bytes", () => {
  assert.equal(treeDigest(walkFiles(CANONICAL_SKILL_ROOT)), goldenHashes.skillTree);
  assert.equal(
    sha256(fs.readFileSync(path.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json"))),
    goldenHashes.codexManifest
  );
  assert.equal(
    sha256(fs.readFileSync(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"))),
    goldenHashes.claudeManifest
  );
  assert.equal(
    sha256(fs.readFileSync(ROOT_CODEX_MANIFEST_PATH)),
    goldenHashes.codexManifest
  );
  assert.equal(
    sha256(fs.readFileSync(ROOT_CLAUDE_MANIFEST_PATH)),
    goldenHashes.claudeManifest
  );
  assert.equal(
    sha256(fs.readFileSync(CODEX_MARKETPLACE_PATH)),
    goldenHashes.codexMarketplace
  );
  assert.equal(
    sha256(fs.readFileSync(CLAUDE_MARKETPLACE_PATH)),
    goldenHashes.claudeMarketplace
  );
});

test("two clean generations are byte-for-byte deterministic", () => {
  const firstRoot = makeTemporaryRoot("determinism-a");
  const secondRoot = makeTemporaryRoot("determinism-b");
  try {
    const firstPlugin = path.join(firstRoot, "plugins", "programmable");
    const secondPlugin = path.join(secondRoot, "plugins", "programmable");
    const firstCodexMarketplace = path.join(firstRoot, ".agents", "plugins", "marketplace.json");
    const secondCodexMarketplace = path.join(secondRoot, ".agents", "plugins", "marketplace.json");
    const firstClaudeMarketplace = path.join(firstRoot, ".claude-plugin", "marketplace.json");
    const secondClaudeMarketplace = path.join(secondRoot, ".claude-plugin", "marketplace.json");
    const firstRootCodexManifest = path.join(firstRoot, ".codex-plugin", "plugin.json");
    const secondRootCodexManifest = path.join(secondRoot, ".codex-plugin", "plugin.json");
    const firstRootClaudeManifest = path.join(firstRoot, ".claude-plugin", "plugin.json");
    const secondRootClaudeManifest = path.join(secondRoot, ".claude-plugin", "plugin.json");
    const first = materializeDistribution({
      pluginRoot: firstPlugin,
      rootCodexManifestPath: firstRootCodexManifest,
      rootClaudeManifestPath: firstRootClaudeManifest,
      codexMarketplacePath: firstCodexMarketplace,
      claudeMarketplacePath: firstClaudeMarketplace
    });
    const second = materializeDistribution({
      pluginRoot: secondPlugin,
      rootCodexManifestPath: secondRootCodexManifest,
      rootClaudeManifestPath: secondRootClaudeManifest,
      codexMarketplacePath: secondCodexMarketplace,
      claudeMarketplacePath: secondClaudeMarketplace
    });

    assert.deepEqual(fileSnapshot(firstPlugin), fileSnapshot(secondPlugin));
    assert.deepEqual(
      fs.readFileSync(firstCodexMarketplace),
      fs.readFileSync(secondCodexMarketplace)
    );
    assert.deepEqual(
      fs.readFileSync(firstClaudeMarketplace),
      fs.readFileSync(secondClaudeMarketplace)
    );
    assert.deepEqual(
      fs.readFileSync(firstRootCodexManifest),
      fs.readFileSync(secondRootCodexManifest)
    );
    assert.deepEqual(
      fs.readFileSync(firstRootClaudeManifest),
      fs.readFileSync(secondRootClaudeManifest)
    );
    assert.equal(first.skillTreeDigest, second.skillTreeDigest);
    assert.deepEqual(first, {
      ...second,
      pluginRoot: firstPlugin,
      rootCodexManifestPath: firstRootCodexManifest,
      rootClaudeManifestPath: firstRootClaudeManifest,
      codexMarketplacePath: firstCodexMarketplace,
      claudeMarketplacePath: firstClaudeMarketplace
    });
  } finally {
    fs.rmSync(firstRoot, { recursive: true, force: true });
    fs.rmSync(secondRoot, { recursive: true, force: true });
  }
});

test("distributed skill is an exact byte and mode copy", () => {
  const canonicalRows = walkFiles(CANONICAL_SKILL_ROOT);
  const copiedRoot = path.join(
    PLUGIN_ROOT,
    "skills",
    path.basename(CANONICAL_SKILL_ROOT)
  );
  const copiedRows = walkFiles(copiedRoot);

  assert.deepEqual(
    copiedRows.map(({ relativePath, mode }) => ({ relativePath, mode })),
    canonicalRows.map(({ relativePath, mode }) => ({ relativePath, mode }))
  );
  assert.equal(treeDigest(copiedRows), treeDigest(canonicalRows));
  for (let index = 0; index < canonicalRows.length; index += 1) {
    assert.deepEqual(copiedRows[index].bytes, canonicalRows[index].bytes);
  }
});

test("canonical and distributed skills use the portable licensed frontmatter contract", () => {
  const copiedSkillRoot = path.join(
    PLUGIN_ROOT,
    "skills",
    path.basename(CANONICAL_SKILL_ROOT)
  );
  for (const skillRoot of [CANONICAL_SKILL_ROOT, copiedSkillRoot]) {
    assert.deepEqual(frontmatterKeys(path.join(skillRoot, "SKILL.md")), ["name", "description", "license"]);
    assert.ok(fs.statSync(path.join(skillRoot, "LICENSE.txt")).isFile());
  }
});

test("adapter metadata stays neutral and has no connector or backend placeholders", () => {
  const metadata = loadMetadata();
  const codex = readJson(path.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json"));
  const claude = readJson(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"));
  const codexMarketplace = readJson(CODEX_MARKETPLACE_PATH);
  const claudeMarketplace = readJson(CLAUDE_MARKETPLACE_PATH);

  for (const value of collectStrings([
    metadata,
    codex,
    claude,
    codexMarketplace,
    claudeMarketplace
  ])) {
    assert.doesNotMatch(value, productPolicyTerms);
  }
  for (const manifest of [codex, claude]) {
    for (const forbidden of ["apps", "appId", "connectors", "hooks", "mcpServers"]) {
      assert.equal(Object.hasOwn(manifest, forbidden), false);
    }
  }
  assert.equal(
    walkFiles(PLUGIN_ROOT).some((row) => /(?:^|\/)(?:\.app|\.mcp)\.json$/.test(row.relativePath)),
    false
  );
});

test("Codex and Claude manifests are separate minimal structures", () => {
  const metadata = loadMetadata();
  const codex = readJson(path.join(PLUGIN_ROOT, ".codex-plugin", "plugin.json"));
  const claude = readJson(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"));

  assert.equal(serializeJson(codex), serializeJson(buildCodexManifest(metadata)));
  assert.equal(serializeJson(claude), serializeJson(buildClaudeManifest(metadata)));
  assert.deepEqual(Object.keys(codex), [
    "name",
    "version",
    "description",
    "author",
    "license",
    "keywords",
    "skills",
    "interface"
  ]);
  assert.deepEqual(Object.keys(claude), [
    "name",
    "displayName",
    "version",
    "description",
    "author",
    "license",
    "keywords",
    "skills"
  ]);
  assert.equal(codex.name, path.basename(PLUGIN_ROOT));
  assert.equal(claude.name, path.basename(PLUGIN_ROOT));
  assert.equal(codex.skills, "./skills/");
  assert.equal(claude.skills, "./skills/");
  assert.ok(fs.statSync(path.resolve(PLUGIN_ROOT, codex.skills)).isDirectory());
});

test("both repo marketplaces point only to the generated local plugin", () => {
  const metadata = loadMetadata();
  const codexMarketplace = readJson(CODEX_MARKETPLACE_PATH);
  const claudeMarketplace = readJson(CLAUDE_MARKETPLACE_PATH);
  assert.equal(
    serializeJson(codexMarketplace),
    serializeJson(buildCodexMarketplace(metadata))
  );
  assert.equal(
    serializeJson(claudeMarketplace),
    serializeJson(buildClaudeMarketplace(metadata))
  );
  assert.equal(codexMarketplace.plugins.length, 1);
  assert.equal(claudeMarketplace.plugins.length, 1);
  assert.deepEqual(Object.keys(claudeMarketplace), [
    "name",
    "owner",
    "description",
    "plugins"
  ]);
  assert.deepEqual(Object.keys(claudeMarketplace.owner), ["name"]);
  assert.deepEqual(Object.keys(claudeMarketplace.plugins[0]), ["name", "source"]);
  assert.deepEqual(codexMarketplace.plugins[0].source, {
    source: "local",
    path: "./plugins/programmable"
  });
  assert.equal(
    path.resolve(MARKETPLACE_ROOT, codexMarketplace.plugins[0].source.path),
    path.resolve(PLUGIN_ROOT)
  );
  assert.equal(claudeMarketplace.plugins[0].source, "./plugins/programmable");
  assert.equal(
    path.resolve(MARKETPLACE_ROOT, claudeMarketplace.plugins[0].source),
    path.resolve(PLUGIN_ROOT)
  );
});

test("relocated plugin verifies from a clean workspace without npm install", () => {
  const temporaryRoot = makeTemporaryRoot("relocation");
  try {
    const relocatedPlugin = path.join(temporaryRoot, "bundle", "plugins", "programmable");
    const relocatedCodexMarketplace = path.join(
      temporaryRoot,
      "bundle",
      ".agents",
      "plugins",
      "marketplace.json"
    );
    const relocatedClaudeMarketplace = path.join(
      temporaryRoot,
      "bundle",
      ".claude-plugin",
      "marketplace.json"
    );
    const relocatedRootCodexManifest = path.join(
      temporaryRoot,
      "bundle",
      ".codex-plugin",
      "plugin.json"
    );
    const relocatedRootClaudeManifest = path.join(
      temporaryRoot,
      "bundle",
      ".claude-plugin",
      "plugin.json"
    );
    const cleanWorkspace = path.join(temporaryRoot, "workspace");
    const emptyCache = path.join(temporaryRoot, "empty-cache");
    fs.mkdirSync(cleanWorkspace, { recursive: true });
    fs.mkdirSync(emptyCache, { recursive: true });
    materializeDistribution({
      pluginRoot: relocatedPlugin,
      rootCodexManifestPath: relocatedRootCodexManifest,
      rootClaudeManifestPath: relocatedRootClaudeManifest,
      codexMarketplacePath: relocatedCodexMarketplace,
      claudeMarketplacePath: relocatedClaudeMarketplace
    });

    assert.equal(fs.existsSync(path.join(relocatedPlugin, "node_modules")), false);
    const verifier = path.join(
      relocatedPlugin,
      "skills",
      path.basename(CANONICAL_SKILL_ROOT),
      "scripts",
      "verify-skill.mjs"
    );
    const result = spawnSync(process.execPath, [verifier, "--installed"], {
      cwd: cleanWorkspace,
      env: { ...process.env, PROGRAMMABLE_PLUGIN_TEST_CACHE: emptyCache },
      encoding: "utf8"
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Validated portable skill structure/);
    assert.equal(fs.readdirSync(emptyCache).length, 0);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("generator check is side-effect free", () => {
  const before = fileSnapshot(MARKETPLACE_ROOT);
  const result = spawnSync(
    process.execPath,
    [path.join(MARKETPLACE_ROOT, "scripts", "generate-plugin.mjs"), "--check"],
    { encoding: "utf8" }
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(fileSnapshot(MARKETPLACE_ROOT), before);
});
