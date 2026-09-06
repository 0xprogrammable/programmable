import assert from "node:assert/strict";
import childProcess from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  createDeterministicTestBatches,
  runDeterministicTestBatches
} from "../verify-skill-execution-core.mjs";
import { validateInstalledProvenance } from "../verify-skill-provenance-core.mjs";
import { markdownHeadingAnchors, parseCanonicalYamlMapping } from "../verify-skill-yaml-core.mjs";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(testDirectory, "..", "..");
const verifier = path.join(skillRoot, "scripts", "verify-skill.mjs");
const sourceSkillShape = {
  name: { type: "string", required: true },
  description: { type: "string", required: true },
  license: { type: "string" },
  metadata: {
    type: "mapping",
    fields: { "short-description": { type: "string" } }
  }
};
const installedSkillShape = {
  ...sourceSkillShape,
  metadata: {
    type: "mapping",
    fields: Object.fromEntries([
      "github-path",
      "github-pinned",
      "github-ref",
      "github-repo",
      "github-tree-sha",
      "local-path"
    ].map((key) => [key, { type: "provenance-string" }]))
  }
};
const interfaceShape = {
  interface: {
    type: "mapping",
    required: true,
    fields: Object.fromEntries([
      ["display_name", true],
      ["short_description", true],
      ["icon_small", false],
      ["icon_large", false],
      ["brand_color", false],
      ["default_prompt", true]
    ].map(([key, required]) => [key, { type: "quoted-string", required }]))
  }
};

test("Markdown anchors remove complete nested HTML-like tags without exposing a second tag", () => {
  assert.deepEqual(
    [...markdownHeadingAnchors("# Safe <scr<script>ipt> heading\n# Two <em>words</em>\n# Comparison 2 < 3")],
    ["safe-heading", "two-words", "comparison-2-3"]
  );
});

test("source verification partitions every portable test exactly once with bounded fanout", () => {
  const source = fs.readFileSync(path.join(skillRoot, "scripts", "verify-skill-execution-core.mjs"), "utf8");
  const testFiles = fs.readdirSync(path.join(skillRoot, "scripts", "test"))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort();
  const batches = createDeterministicTestBatches(testFiles);
  assert.equal(testFiles.length, 75);
  assert.deepEqual(batches.map((batch) => batch.length), [38, 37]);
  assert.deepEqual(batches[0], testFiles.filter((_, index) => index % 2 === 0));
  assert.deepEqual(batches[1], testFiles.filter((_, index) => index % 2 === 1));
  assert.deepEqual([...batches.flat()].sort(), testFiles);
  assert.equal(new Set(batches.flat()).size, testFiles.length);
  assert.match(source, /args: \["--test", "--test-concurrency=2", \.\.\.batch\]/u);
  assert.match(source, /const TEST_TIMEOUT_MS = 15 \* 60 \* 1000;/u);
  assert.match(source, /const TEST_OUTPUT_BYTES = 128 \* 1024 \* 1024;/u);
  assert.doesNotMatch(source, /--test-concurrency=[3-9]/u);
});

test("deterministic test shards run sequentially with one shared deadline and output budget", async () => {
  const testFiles = Array.from({ length: 75 }, (_, index) => `test-${String(index).padStart(2, "0")}.test.mjs`);
  const calls = [];
  let activeChildren = 0;
  let elapsedMs = 0;
  const result = await runDeterministicTestBatches({
    command: "/node",
    cwd: "/skill",
    env: { PATH: "/bin" },
    now: () => elapsedMs,
    runChildProcess: async (options) => {
      assert.equal(activeChildren, 0);
      activeChildren += 1;
      calls.push(options);
      elapsedMs += calls.length === 1 ? 250 : 500;
      activeChildren -= 1;
      return {
        outputExceeded: false,
        signal: null,
        status: 0,
        stderr: calls.length === 1 ? "de" : "",
        stdout: calls.length === 1 ? "abc" : "ok",
        timedOut: false
      };
    },
    testFiles
  });
  assert.equal(result.failure, null);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].args, ["--test", "--test-concurrency=2", ...result.batches[0]]);
  assert.deepEqual(calls[1].args, ["--test", "--test-concurrency=2", ...result.batches[1]]);
  assert.equal(calls[0].timeoutMs, 15 * 60 * 1000);
  assert.equal(calls[1].timeoutMs, 15 * 60 * 1000 - 250);
  assert.equal(calls[0].maximumOutputBytes, 128 * 1024 * 1024);
  assert.equal(calls[1].maximumOutputBytes, 128 * 1024 * 1024 - 5);
});

test("deterministic test shards fail first and never double shared resource budgets", async () => {
  let calls = 0;
  const firstFailure = await runDeterministicTestBatches({
    command: "/node",
    cwd: "/skill",
    env: {},
    runChildProcess: async () => {
      calls += 1;
      return { outputExceeded: false, signal: "SIGTERM", status: null, stderr: "failed", stdout: "", timedOut: false };
    },
    testFiles: ["a.test.mjs", "b.test.mjs"]
  });
  assert.equal(calls, 1);
  assert.deepEqual(
    { batchIndex: firstFailure.failure.batchIndex, kind: firstFailure.failure.kind, signal: firstFailure.failure.signal },
    { batchIndex: 0, kind: "status", signal: "SIGTERM" }
  );

  calls = 0;
  let elapsedMs = 0;
  const timeout = await runDeterministicTestBatches({
    command: "/node",
    cwd: "/skill",
    env: {},
    now: () => elapsedMs,
    runChildProcess: async () => {
      calls += 1;
      elapsedMs = 11;
      return { outputExceeded: false, signal: null, status: 0, stderr: "", stdout: "", timedOut: false };
    },
    testFiles: ["a.test.mjs", "b.test.mjs"],
    timeoutMs: 10
  });
  assert.equal(calls, 1);
  assert.deepEqual(timeout.failure, { batchIndex: 1, kind: "timeout", signal: null, status: null });

  calls = 0;
  const output = await runDeterministicTestBatches({
    command: "/node",
    cwd: "/skill",
    env: {},
    maximumOutputBytes: 5,
    runChildProcess: async () => {
      calls += 1;
      return { outputExceeded: false, signal: null, status: 0, stderr: "de", stdout: "abc", timedOut: false };
    },
    testFiles: ["a.test.mjs", "b.test.mjs"]
  });
  assert.equal(calls, 1);
  assert.deepEqual(output.failure, { batchIndex: 1, kind: "output", signal: null, status: null });
});

test("installed-mode portable execution keeps its single CLI test in one nonempty shard", async () => {
  const batches = createDeterministicTestBatches(["scripts/test/cli.test.mjs"]);
  assert.deepEqual(batches, [["scripts/test/cli.test.mjs"]]);
  let calls = 0;
  const result = await runDeterministicTestBatches({
    command: "/node",
    cwd: "/skill",
    env: {},
    runChildProcess: async () => {
      calls += 1;
      return { outputExceeded: false, signal: null, status: 0, stderr: "", stdout: "ok", timedOut: false };
    },
    testFiles: batches[0]
  });
  assert.equal(calls, 1);
  assert.equal(result.failure, null);
});

test("verifier awaits all three terminal error gates", () => {
  const source = fs.readFileSync(verifier, "utf8");
  const calls = [...source.matchAll(/^.*\bfailWithErrors\(errors\);.*$/gmu)];
  assert.equal(calls.length, 3);
  for (const [call] of calls) assert.match(call, /\bawait failWithErrors\(errors\);/u);
});

test("verifier flushes complete large error output before exiting without continuing", () => {
  const source = fs.readFileSync(verifier, "utf8");
  const declaration = source.match(/(?:async )?function failWithErrors\(messages\) \{[\s\S]*\}\s*$/u);
  assert.ok(declaration, "exercise the exact verifier error function from source");

  for (const payloadBytes of [128 * 1024, 2 * 1024 * 1024]) {
    const result = childProcess.spawnSync(process.execPath, ["--input-type=module", "-e", `
      ${declaration[0]}
      const repeatedError = "x".repeat(${payloadBytes});
      await failWithErrors(["z-complete-end-marker", repeatedError, "a-first", repeatedError]);
      console.log("unexpected-success-after-error");
    `], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "", "the caller must not continue after the error gate");
    const expected = `- a-first\n- ${"x".repeat(payloadBytes)}\n- z-complete-end-marker\n`;
    assert.equal(Buffer.byteLength(result.stderr), Buffer.byteLength(expected), "stderr must be fully flushed");
    assert.equal(result.stderr, expected, "retain sorted, deduplicated errors and the final marker");
  }
});

function readDeclaredRequiredInventories() {
  const source = fs.readFileSync(verifier, "utf8");
  const testDeclaration = source.match(/const REQUIRED_PORTABLE_TESTS = Object\.freeze\(`([\s\S]*?)`\.trim\(\)\.split/u);
  assert.ok(testDeclaration, "portable verifier must declare its complete test inventory");
  const portableTestPaths = testDeclaration[1]
    .trim()
    .split(/\s+/u)
    .map((stem) => `scripts/test/${stem}.test.mjs`);
  const requiredDeclaration = source.match(/const required = \[\n([\s\S]*?)\n\];\n\nfor \(const relativePath of required\) \{/u);
  assert.ok(requiredDeclaration, "portable verifier must declare one static required-file inventory");

  const requiredPaths = [];
  let testInventorySpreads = 0;
  for (const rawLine of requiredDeclaration[1].split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const literal = line.match(/^"([^"\\\r\n]+)",?$/u);
    if (literal) {
      requiredPaths.push(literal[1]);
    } else if (line === "...REQUIRED_PORTABLE_TESTS,") {
      requiredPaths.push(...portableTestPaths);
      testInventorySpreads += 1;
    } else {
      assert.fail(`required-file inventory must remain statically enumerable: ${line}`);
    }
  }

  assert.equal(testInventorySpreads, 1, "required-file inventory must include the test inventory exactly once");
  assert.match(
    source,
    /for \(const relativePath of required\) \{\n  const entry = packageEntriesByPath\.get\(relativePath\);\n  if \(!entry\?\.stat\.isFile\(\)\) errors\.push\(`missing \$\{relativePath\}`\);\n\}/u,
    "every declared path must use the generic missing-file guard"
  );
  return { portableTestPaths, requiredPaths };
}

function insertAfterFrontmatterDescription(source, fragment) {
  return source.replace(
    /^description:.*$/m,
    (description) => `${description}\n${fragment}`
  );
}

function parseSourceSkillYaml(source) {
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/u);
  assert.ok(frontmatter, "canonical skill fixture must have frontmatter");
  return parseCanonicalYamlMapping(frontmatter[1], "SKILL.md frontmatter", sourceSkillShape);
}

function parseInterfaceYaml(source) {
  return parseCanonicalYamlMapping(source, "agents/openai.yaml", interfaceShape);
}

function createInstalledFrontmatter(metadataLines) {
  const source = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  const frontmatter = source.match(/^---\n([\s\S]*?)\n---\n/u);
  assert.ok(frontmatter, "canonical skill fixture must have frontmatter");
  const lines = frontmatter[1].split("\n");
  const rootLine = (key) => {
    const line = lines.find((candidate) => candidate.startsWith(`${key}:`));
    assert.ok(line, `canonical skill fixture must declare ${key}`);
    return line;
  };
  return {
    body: source.slice(frontmatter[0].length).replace(/^(?:\r?\n)+/u, ""),
    source: [
      rootLine("description"),
      rootLine("license"),
      "metadata:",
      ...metadataLines.map((line) => `    ${line}`),
      rootLine("name")
    ].join("\n")
  };
}

function validateInstalledMetadataLines(metadataLines) {
  const parsed = parseCanonicalYamlMapping(
    createInstalledFrontmatter(metadataLines).source,
    "SKILL.md frontmatter",
    installedSkillShape,
    { childIndentation: 4 }
  );
  const errors = [...parsed.errors];
  if (errors.length === 0) {
    errors.push(...validateInstalledProvenance(parsed.value.metadata, parsed.value.name));
  }
  return errors;
}

test("trusted verifier validates a candidate skill as data without executing its tests", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    fs.writeFileSync(
      path.join(candidateRoot, "scripts", "test", "trade-capability-manifest.test.mjs"),
      'throw new Error("candidate test code executed");\n'
    );
    const result = childProcess.spawnSync(
      process.execPath,
      [verifier, "--skill-root", candidateRoot, "--untrusted-data"],
      { encoding: "utf8", shell: false }
    );

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /without executing candidate scripts or tests/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier accepts a real skill root below a harmless ..x container", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "..x-programmable-static-skill-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    const result = runUntrustedVerifier(candidateRoot);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Validated candidate skill structure/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier rejects a nested duplicate key in any packaged JSON without executing candidate code", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-json-duplicate-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");
  const executionMarker = path.join(fixtureRoot, "candidate-code-executed");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    fs.writeFileSync(
      path.join(candidateRoot, "references", "programmable-trade-execution-v1.schema.json"),
      '{"outer":{"same":1,"same":2}}\n'
    );
    fs.writeFileSync(
      path.join(candidateRoot, "scripts", "test", "trade-capability-manifest.test.mjs"),
      `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(executionMarker)}, "executed\\n");\n`
    );

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /references\/programmable-trade-execution-v1\.schema\.json: must be bounded duplicate-free UTF-8 JSON/u);
    assert.equal(fs.existsSync(executionMarker), false);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("non-canonical skill roots fail closed before candidate tests can execute", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-fail-closed-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");
  const markerPath = path.join(fixtureRoot, "candidate-test-executed");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    fs.writeFileSync(
      path.join(candidateRoot, "scripts", "test", "marker.test.mjs"),
      `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(markerPath)}, "executed\\n");\n`
    );

    const result = childProcess.spawnSync(
      process.execPath,
      [verifier, "--skill-root", candidateRoot],
      { encoding: "utf8", shell: false }
    );

    assert.equal(result.status, 2, result.stdout);
    assert.match(result.stderr, /non-canonical --skill-root requires --untrusted-data/);
    assert.equal(fs.existsSync(markerPath), false);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("portable verifier declares every direct test exactly once", () => {
  const { portableTestPaths } = readDeclaredRequiredInventories();
  const discovered = fs.readdirSync(testDirectory)
    .filter((name) => name.endsWith(".test.mjs"))
    .sort()
    .map((name) => `scripts/test/${name}`);

  assert.equal(portableTestPaths.length, 75);
  assert.equal(new Set(portableTestPaths).size, portableTestPaths.length);
  assert.deepEqual([...portableTestPaths].sort(), discovered);
});

test("portable verifier deletion-guards its exact required inventory in one bounded probe", () => {
  const { requiredPaths } = readDeclaredRequiredInventories();
  const inventorySha256 = crypto
    .createHash("sha256")
    .update(`${requiredPaths.join("\n")}\n`)
    .digest("hex");

  assert.equal(requiredPaths.length, 388);
  assert.equal(new Set(requiredPaths).size, requiredPaths.length);
  assert.equal(inventorySha256, "213603c758ec264cc2373cea9f57c1292c72e66f0cca89b41f06fea153b5dc38");
  for (const requiredPath of requiredPaths) {
    const entry = fs.lstatSync(path.join(skillRoot, requiredPath));
    assert.ok(entry.isFile(), `${requiredPath} must be a regular file`);
  }

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-required-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    for (const requiredPath of requiredPaths) {
      fs.rmSync(path.join(candidateRoot, requiredPath));
    }

    const result = runUntrustedVerifier(candidateRoot);

    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0, result.stdout);
    for (const requiredPath of requiredPaths) {
      assert.match(
        result.stderr,
        new RegExp(`(?:^|\\n)- missing ${escapeRegExp(requiredPath)}(?:\\n|$)`, "u")
      );
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("portable verifier rejects discovered-versus-declared test inventory drift", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-test-inventory-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    fs.renameSync(
      path.join(candidateRoot, "scripts", "test", "strict-json-core.test.mjs"),
      path.join(candidateRoot, "scripts", "test", "undeclared-portable.test.mjs")
    );

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /portable test inventory must exactly match declared required tests/);
    assert.match(result.stderr, /missing files: scripts\/test\/strict-json-core\.test\.mjs/);
    assert.match(result.stderr, /undeclared tests: scripts\/test\/undeclared-portable\.test\.mjs/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier rejects transient build directories at any depth", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-transient-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    const transientRoot = path.join(candidateRoot, "assets", "nested", "node_modules");
    fs.mkdirSync(transientRoot, { recursive: true });
    fs.writeFileSync(path.join(transientRoot, "ignored.js"), "throw new Error('must not execute');\n");

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /transient build or staging directory is not portable: assets\/nested\/node_modules/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier rejects an adverse or escaping knowledge-routing profile as data", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-knowledge-routing-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");
  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    const routingPath = path.join(candidateRoot, "references", "knowledge-routing.json");
    const routing = JSON.parse(fs.readFileSync(routingPath, "utf8"));
    routing.policy.automaticAdverseDecision = true;
    routing.modes.explore.initial.push("../outside.md");
    fs.writeFileSync(routingPath, `${JSON.stringify(routing, null, 2)}\n`);

    const result = runUntrustedVerifier(candidateRoot);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /knowledge-routing\.json: identity or non-adverse offline policy is invalid/);
    assert.match(result.stderr, /knowledge-routing\.json: unsafe reference \.\.\/outside\.md/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier binds every starter catalog member to the catalog digest", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-catalog-digest-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    const memberPath = path.join(candidateRoot, "assets", "starter-catalog", "starters", "blank-custom.json");
    const member = JSON.parse(fs.readFileSync(memberPath, "utf8"));
    member.summary = `${member.summary} tampered`;
    fs.writeFileSync(memberPath, `${JSON.stringify(member, null, 2)}\n`);

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /digest mismatch for assets\/starter-catalog\/starters\/blank-custom\.json/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier rejects unlisted starter catalog members", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-catalog-unlisted-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    fs.renameSync(
      path.join(candidateRoot, "assets", "starter-catalog", "packs", "v4-swap-client.json"),
      path.join(candidateRoot, "assets", "starter-catalog", "packs", "undeclared.json")
    );

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /unlisted catalog member assets\/starter-catalog\/packs\/undeclared\.json/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier rejects a symlinked skill root without resolving it", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-root-link-"));
  const realParent = path.join(fixtureRoot, "real");
  const linkParent = path.join(fixtureRoot, "link");
  const realRoot = path.join(realParent, "programmable-v4-hook-builder");
  const candidateRoot = path.join(linkParent, "programmable-v4-hook-builder");

  try {
    fs.mkdirSync(realParent, { recursive: true });
    fs.mkdirSync(linkParent, { recursive: true });
    fs.cpSync(skillRoot, realRoot, { recursive: true });
    fs.symlinkSync(realRoot, candidateRoot, "dir");

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /skill root may not be a symbolic link/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier rejects a symlinked parent between the candidate checkout and skill root", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-parent-link-"));
  const candidateCheckout = path.join(fixtureRoot, "candidate");
  const externalSkills = path.join(fixtureRoot, "external-skills");
  const candidateRoot = path.join(candidateCheckout, "skills", "programmable-v4-hook-builder");

  try {
    fs.mkdirSync(candidateCheckout, { recursive: true });
    fs.mkdirSync(externalSkills, { recursive: true });
    fs.cpSync(skillRoot, path.join(externalSkills, "programmable-v4-hook-builder"), { recursive: true });
    fs.symlinkSync(externalSkills, path.join(candidateCheckout, "skills"), "dir");

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /skill root path contains a symbolic link: skills/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier stops at a package symlink before reading its target", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-file-link-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");
  const externalSkill = path.join(fixtureRoot, "external-skill.md");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    const localPath = ["", "Users", "private", ""].join("/");
    fs.writeFileSync(externalSkill, `This file has no frontmatter and mentions ${localPath}.\n`);
    fs.rmSync(path.join(candidateRoot, "SKILL.md"));
    fs.symlinkSync(externalSkill, path.join(candidateRoot, "SKILL.md"));

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /symbolic links are not allowed: SKILL\.md/);
    assert.doesNotMatch(result.stderr, /frontmatter|local filesystem path/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier stops at an intermediate directory symlink before parsing files below it", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-directory-link-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");
  const externalReferences = path.join(fixtureRoot, "external-references");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    fs.renameSync(path.join(candidateRoot, "references"), externalReferences);
    fs.writeFileSync(path.join(externalReferences, "submission.schema.json"), "not JSON\n");
    fs.symlinkSync(externalReferences, path.join(candidateRoot, "references"), "dir");

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /symbolic links are not allowed: references/);
    assert.doesNotMatch(result.stderr, /schema or template JSON/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier rejects an oversized SKILL file before reading it", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-oversized-skill-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    fs.writeFileSync(path.join(candidateRoot, "SKILL.md"), `No frontmatter\n${"x".repeat(1_000_000)}`);

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /SKILL\.md exceeds the 1000000-byte per-file limit/);
    assert.doesNotMatch(result.stderr, /frontmatter/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier rejects an oversized interface file before parsing it", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-oversized-interface-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    fs.writeFileSync(path.join(candidateRoot, "agents", "openai.yaml"), `not an interface\n${"x".repeat(1_000_000)}`);

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /agents\/openai\.yaml exceeds the 1000000-byte per-file limit/);
    assert.doesNotMatch(result.stderr, /missing display_name|missing short_description|missing default_prompt/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier rejects an oversized package before scanning its text", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-oversized-package-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");
  const localPath = ["", "Users", "private", ""].join("/");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    for (let index = 0; index < 14; index += 1) {
      const prefix = index === 0 ? `${localPath}\n` : "";
      fs.writeFileSync(
        path.join(candidateRoot, "assets", `large-${index}.txt`),
        `${prefix}${"x".repeat(900_000 - prefix.length)}`
      );
    }

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /portable package is \d+ bytes; keep it at or below 12000000/);
    assert.doesNotMatch(result.stderr, /local filesystem path/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier rejects excessive file count before checking candidate script syntax", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-file-count-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    for (let index = 0; index < 400; index += 1) {
      fs.writeFileSync(path.join(candidateRoot, "assets", `count-${index}.txt`), "\n");
    }
    fs.writeFileSync(path.join(candidateRoot, "scripts", "invalid-syntax.mjs"), "export const = ;\n");

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /portable package has \d+ files; keep it at or below 640/);
    assert.doesNotMatch(result.stderr, /invalid-syntax|SyntaxError/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("candidate schema references cannot weaken trusted example validation", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-schema-ref-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    fs.writeFileSync(
      path.join(candidateRoot, "references", "submission.schema.json"),
      `${JSON.stringify({
        $ref: "#/$defs/permissive",
        $defs: { permissive: { type: "object" } }
      }, null, 2)}\n`
    );
    const examplePath = path.join(candidateRoot, "assets", "templates", "submission.example.json");
    const example = JSON.parse(fs.readFileSync(examplePath, "utf8"));
    example.model.id = "NOT A VALID MODEL ID";
    fs.writeFileSync(examplePath, `${JSON.stringify(example, null, 2)}\n`);

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /template \$\.model\.id: Text does not match the required format/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("candidate schema regex is parsed as data and never executed", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-skill-schema-regex-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    const schemaPath = path.join(candidateRoot, "references", "submission.schema.json");
    const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
    schema.properties.model.properties.id.pattern = "(";
    fs.writeFileSync(schemaPath, `${JSON.stringify(schema, null, 2)}\n`);

    const result = runUntrustedVerifier(candidateRoot);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.doesNotMatch(result.stderr, /Invalid regular expression/);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("canonical YAML parser rejects the exact SKILL.md mutation matrix as data", () => {
  const source = fs.readFileSync(path.join(skillRoot, "SKILL.md"), "utf8");
  for (const [label, mutate, expected] of [
    [
      "an inline host policy hidden below metadata",
      (candidate) => insertAfterFrontmatterDescription(
        candidate,
        'metadata: {"allowed-tools": "shell"}'
      ),
      /requires metadata to be a block mapping/u
    ],
    [
      "a quoted host-policy key",
      (candidate) => insertAfterFrontmatterDescription(
        candidate,
        '"allowed\\u002dtools": "shell"'
      ),
      /outside the supported YAML mapping subset/u
    ],
    [
      "an inherited root key",
      (candidate) => insertAfterFrontmatterDescription(candidate, "constructor: bypass"),
      /unsupported key constructor/u
    ],
    [
      "an inherited root setter key",
      (candidate) => insertAfterFrontmatterDescription(candidate, "__proto__: bypass"),
      /unsupported key __proto__/u
    ],
    [
      "an inherited nested key",
      (candidate) => insertAfterFrontmatterDescription(
        candidate,
        "metadata:\n  constructor: bypass"
      ),
      /unsupported key constructor/u
    ],
    [
      "an inherited nested setter key",
      (candidate) => insertAfterFrontmatterDescription(
        candidate,
        "metadata:\n  __proto__: bypass"
      ),
      /unsupported key __proto__/u
    ],
    [
      "a custom YAML tag",
      (candidate) => candidate.replace(
        /^description: /m,
        "description: !host-policy "
      ),
      /non-canonical plain string/u
    ],
    [
      "an anchor",
      (candidate) => candidate.replace(
        "name: programmable-v4-hook-builder",
        "name: &shared programmable-v4-hook-builder"
      ),
      /non-canonical plain string/u
    ],
    [
      "a duplicate key",
      (candidate) => candidate.replace(
        /^description:/m,
        "name: programmable-v4-hook-builder\ndescription:"
      ),
      /duplicates key name/u
    ],
    [
      "a non-string description",
      (candidate) => candidate.replace(
        /^description:.*$/m,
        "description: true"
      ),
      /non-canonical plain string/u
    ],
    [
      "an unterminated quoted scalar",
      (candidate) => candidate.replace(
        "name: programmable-v4-hook-builder",
        'name: "programmable-v4-hook-builder'
      ),
      /invalid double-quoted string/u
    ]
  ]) {
    const parsed = parseSourceSkillYaml(mutate(source));
    assert.notEqual(parsed.errors.length, 0, label);
    assert.match(parsed.errors.join("\n"), expected, label);
  }
});

test("canonical YAML parser rejects the exact agents/openai.yaml mutation matrix as data", () => {
  const source = fs.readFileSync(path.join(skillRoot, "agents", "openai.yaml"), "utf8");
  for (const [label, mutate, expected] of [
    [
      "an inline dependency policy",
      (candidate) => `${candidate}dependencies: {tools: [{type: "mcp", value: "wallet"}]}\n`,
      /unsupported key dependencies/u
    ],
    [
      "a quoted dependency key",
      (candidate) => `${candidate}"depend\\u0065ncies": {"tools": []}\n`,
      /outside the supported YAML mapping subset/u
    ],
    [
      "an inherited nested key",
      (candidate) => candidate.replace(
        /^(  short_description: .+)$/m,
        '  constructor: "bypass"\n$1'
      ),
      /unsupported key constructor/u
    ],
    [
      "a custom YAML tag",
      (candidate) => candidate.replace(
        'display_name: "Programmable v4 Builder"',
        'display_name: !host-policy "Programmable v4 Builder"'
      ),
      /requires a double-quoted string value/u
    ],
    [
      "an anchor",
      (candidate) => candidate.replace(
        'display_name: "Programmable v4 Builder"',
        'display_name: &shared "Programmable v4 Builder"'
      ),
      /requires a double-quoted string value/u
    ],
    [
      "a merge key",
      (candidate) => candidate.replace(
        '  display_name: "Programmable v4 Builder"',
        "  <<: *shared\n  display_name: \"Programmable v4 Builder\""
      ),
      /outside the supported YAML mapping subset/u
    ],
    [
      "a duplicate key",
      (candidate) => candidate.replace(
        /^(  short_description: .+)$/m,
        '  display_name: "Duplicate"\n$1'
      ),
      /duplicates key display_name/u
    ],
    [
      "a non-string interface value",
      (candidate) => candidate.replace(
        'display_name: "Programmable v4 Builder"',
        "display_name: true"
      ),
      /requires a double-quoted string value/u
    ],
    [
      "an unsupported nested key",
      (candidate) => candidate.replace(
        /^(  short_description: .+)$/m,
        '  custom_policy: "allow"\n$1'
      ),
      /unsupported key custom_policy/u
    ],
    [
      "an unterminated quoted scalar",
      (candidate) => candidate.replace(
        'display_name: "Programmable v4 Builder"',
        'display_name: "Programmable v4 Builder'
      ),
      /invalid double-quoted string/u
    ]
  ]) {
    const parsed = parseInterfaceYaml(mutate(source));
    assert.notEqual(parsed.errors.length, 0, label);
    assert.match(parsed.errors.join("\n"), expected, label);
  }
});

test("trusted verifier integrates both canonical YAML guards without executing candidate code", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-yaml-integration-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");
  const executionMarker = path.join(fixtureRoot, "candidate-code-executed");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    const skillPath = path.join(candidateRoot, "SKILL.md");
    fs.writeFileSync(
      skillPath,
      insertAfterFrontmatterDescription(
        fs.readFileSync(skillPath, "utf8"),
        'metadata: {"allowed-tools": "shell"}'
      )
    );
    const interfacePath = path.join(candidateRoot, "agents", "openai.yaml");
    fs.appendFileSync(interfacePath, 'dependencies: {tools: [{type: "mcp", value: "wallet"}]}\n');
    fs.writeFileSync(
      path.join(candidateRoot, "scripts", "test", "trade-capability-manifest.test.mjs"),
      `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(executionMarker)}, "executed\\n");\n`
    );

    const result = runUntrustedVerifier(candidateRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /SKILL\.md frontmatter:.*requires metadata to be a block mapping/u);
    assert.match(result.stderr, /agents\/openai\.yaml:.*unsupported key dependencies/u);
    assert.equal(fs.existsSync(executionMarker), false);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("trusted verifier accepts supported optional metadata fields as strings", () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-static-canonical-yaml-"));
  const candidateRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");

  try {
    fs.cpSync(skillRoot, candidateRoot, { recursive: true });
    const skillPath = path.join(candidateRoot, "SKILL.md");
    fs.writeFileSync(
      skillPath,
      insertAfterFrontmatterDescription(
        fs.readFileSync(skillPath, "utf8"),
        "metadata:\n  short-description: Build and review v4 launch models"
      )
    );
    const interfacePath = path.join(candidateRoot, "agents", "openai.yaml");
    fs.writeFileSync(
      interfacePath,
      fs.readFileSync(interfacePath, "utf8").replace(
        '  default_prompt: "',
        '  brand_color: "#E76BAA"\n  default_prompt: "'
      )
    );

    const result = runUntrustedVerifier(candidateRoot);

    assert.equal(result.status, 0, result.stderr || result.stdout);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("installed verifier accepts current pinned gh skill GitHub provenance", () => {
  const fixture = materializeInstalledSkill([
    "github-path: skills/programmable-v4-hook-builder",
    "github-pinned: 3cd1378ae17542e3a1ab73771da272af567fbe15",
    "github-ref: 3cd1378ae17542e3a1ab73771da272af567fbe15",
    "github-repo: https://github.com/0xprogrammable/programmable",
    "github-tree-sha: cd0a64bc1a575a6e49ca594181088ecce3d4a643"
  ]);

  try {
    const result = runInstalledVerifier(fixture.skillRoot);

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Validated portable skill structure/);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test("portable verifier rejects runtimes below Node 24 before scanning package bytes", () => {
  const bootstrap = [
    'Object.defineProperty(process.versions, "node", { value: "22.23.1" });',
    `process.argv = [process.execPath, ${JSON.stringify(verifier)}, "--installed"];`,
    `await import(${JSON.stringify(pathToFileURL(verifier).href)});`
  ].join("\n");
  const result = childProcess.spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", bootstrap],
    { cwd: skillRoot, encoding: "utf8", shell: false }
  );
  assert.equal(result.status, 1, result.stdout || result.stderr);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /NODE_24_OR_NEWER_REQUIRED/u);
});

test("installed metadata parser accepts exact unpinned GitHub and quoted local profiles", () => {
  const localPath = macAbsolutePath(
    "example",
    "Builder's Projects",
    "programmable-v4-hook-builder"
  );
  for (const [label, metadataLines] of [
    [
      "unpinned GitHub provenance",
      [
        "github-path: products/hooks/skills/programmable-v4-hook-builder",
        "github-ref: v1.0.0",
        "github-repo: https://github.com/0xprogrammable/programmable",
        "github-tree-sha: 89abcdef0123456789abcdef0123456789abcdef"
      ]
    ],
    [
      "single-quoted local provenance",
      [`local-path: '${localPath.replaceAll("'", "''")}'`]
    ]
  ]) {
    assert.deepEqual(validateInstalledMetadataLines(metadataLines), [], label);
  }
});

test("trusted untrusted-data verifier does not accept installer provenance as source policy", () => {
  const fixture = materializeInstalledSkill([
    "github-path: skills/programmable-v4-hook-builder",
    "github-ref: main",
    "github-repo: https://github.com/0xprogrammable/programmable",
    "github-tree-sha: 89abcdef0123456789abcdef0123456789abcdef"
  ]);

  try {
    const result = runUntrustedVerifier(fixture.skillRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /SKILL\.md frontmatter:/);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test("installed verifier accepts gh skill local provenance but still scans all other bytes", () => {
  const fixture = materializeInstalledSkill([
    `local-path: ${macAbsolutePath("example", "projects", "programmable", "skills", "programmable-v4-hook-builder")}`
  ]);

  try {
    const accepted = runInstalledVerifier(fixture.skillRoot);
    assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);

    fs.appendFileSync(
      path.join(fixture.skillRoot, "SKILL.md"),
      `\nThe installed package must not disclose ${macAbsolutePath("example", "private", "source")} outside provenance.\n`
    );
    const rejected = runInstalledVerifier(fixture.skillRoot);

    assert.notEqual(rejected.status, 0, rejected.stdout);
    assert.match(rejected.stderr, /SKILL\.md: portable package contains a local filesystem path/);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

test("installed metadata parser rejects the exact provenance mutation matrix", () => {
  for (const [label, metadataLines, expected] of [
    [
      "a policy key",
      [
        "github-path: skills/programmable-v4-hook-builder",
        "github-ref: main",
        "github-repo: https://github.com/0xprogrammable/programmable",
        "github-tree-sha: 0123456789abcdef0123456789abcdef01234567",
        "allowed-tools: shell"
      ],
      /unsupported key allowed-tools/u
    ],
    [
      "a custom YAML tag",
      [
        "github-path: skills/programmable-v4-hook-builder",
        "github-ref: !host-policy main",
        "github-repo: https://github.com/0xprogrammable/programmable",
        "github-tree-sha: 0123456789abcdef0123456789abcdef01234567"
      ],
      /non-canonical plain string/u
    ],
    [
      "a YAML anchor",
      [
        "github-path: skills/programmable-v4-hook-builder",
        "github-ref: &shared main",
        "github-repo: https://github.com/0xprogrammable/programmable",
        "github-tree-sha: 0123456789abcdef0123456789abcdef01234567"
      ],
      /non-canonical plain string/u
    ],
    [
      "a duplicate provenance key",
      [
        "github-path: skills/programmable-v4-hook-builder",
        "github-ref: main",
        "github-ref: release",
        "github-repo: https://github.com/0xprogrammable/programmable",
        "github-tree-sha: 0123456789abcdef0123456789abcdef01234567"
      ],
      /duplicates key github-ref/u
    ],
    [
      "mixed local and remote provenance",
      [
        "github-path: skills/programmable-v4-hook-builder",
        "github-ref: main",
        "github-repo: https://github.com/0xprogrammable/programmable",
        "github-tree-sha: 0123456789abcdef0123456789abcdef01234567",
        `local-path: ${macAbsolutePath("example", "projects", "programmable-v4-hook-builder")}`
      ],
      /installed metadata must be exactly local-path or the GitHub repository/u
    ],
    [
      "a repository URL with credentials",
      [
        "github-path: skills/programmable-v4-hook-builder",
        "github-ref: main",
        "github-repo: https://user@github.com/0xprogrammable/programmable",
        "github-tree-sha: 0123456789abcdef0123456789abcdef01234567"
      ],
      /github-repo must be a canonical HTTPS GitHub repository URL/u
    ],
    [
      "a traversing GitHub path",
      [
        "github-path: skills/../programmable-v4-hook-builder",
        "github-ref: main",
        "github-repo: https://github.com/0xprogrammable/programmable",
        "github-tree-sha: 0123456789abcdef0123456789abcdef01234567"
      ],
      /github-path must be a normalized relative path/u
    ],
    [
      "a relative local provenance path",
      ["local-path: projects/programmable-v4-hook-builder"],
      /local-path must be an absolute filesystem path/u
    ],
    [
      "oversized local provenance",
      [`local-path: ${macAbsolutePath("example", "a".repeat(4096))}`],
      /exceeds the 4096-byte provenance limit/u
    ]
  ]) {
    const errors = validateInstalledMetadataLines(metadataLines);
    assert.notEqual(errors.length, 0, label);
    assert.match(errors.join("\n"), expected, label);
  }
});

test("installed verifier integrates the provenance-profile rejection", () => {
  const fixture = materializeInstalledSkill([
    "github-path: skills/programmable-v4-hook-builder",
    "github-ref: main",
    "github-repo: https://github.com/0xprogrammable/programmable",
    "github-tree-sha: 0123456789abcdef0123456789abcdef01234567",
    `local-path: ${macAbsolutePath("example", "projects", "programmable-v4-hook-builder")}`
  ]);

  try {
    const result = runInstalledVerifier(fixture.skillRoot);

    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /installed metadata must be exactly local-path or the GitHub repository/u);
  } finally {
    fs.rmSync(fixture.fixtureRoot, { recursive: true, force: true });
  }
});

function materializeInstalledSkill(metadataLines) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "programmable-installed-skill-"));
  const installedSkillRoot = path.join(fixtureRoot, "programmable-v4-hook-builder");
  fs.cpSync(skillRoot, installedSkillRoot, { recursive: true });

  const skillPath = path.join(installedSkillRoot, "SKILL.md");
  const installed = createInstalledFrontmatter(metadataLines);
  fs.writeFileSync(skillPath, `---\n${installed.source}\n---\n${installed.body}`);

  return { fixtureRoot, skillRoot: installedSkillRoot };
}

function runInstalledVerifier(installedSkillRoot) {
  return childProcess.spawnSync(
    process.execPath,
    [path.join(installedSkillRoot, "scripts", "verify-skill.mjs"), "--installed"],
    { cwd: installedSkillRoot, encoding: "utf8", shell: false }
  );
}

function macAbsolutePath(...segments) {
  return ["", "Users", ...segments].join("/");
}

function runUntrustedVerifier(candidateRoot) {
  return childProcess.spawnSync(
    process.execPath,
    [verifier, "--skill-root", candidateRoot, "--untrusted-data"],
    { encoding: "utf8", shell: false }
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
