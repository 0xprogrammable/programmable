import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const contracts = path.join(root, "contracts");
const receiptPath = path.join(contracts, "cache/ci-build-receipt.json");
export const CONTRACT_TEST_PARTITIONS = 2;
export const CONTRACT_CI_BUILD = Object.freeze([
  ["npm", "run", "contracts:bootstrap"],
  ["npm", "run", "contracts:variants"],
  ["npm", "run", "contracts:fmt"],
  ["forge", "lint", "src", "script"],
  ["forge", "build"],
]);
export const CONTRACT_CI_RELEASE = Object.freeze([
  ["npm", "run", "contracts:bootstrap"],
  // The downloaded contract artifact does not install solc on this worker.
  // Warm the starter's pinned compiler in its own output directory before its
  // offline test runner; leave the attested default contract outputs intact.
  ["forge", "build", "--root", "../packages/classic-modules/examples/native-program"],
  ["npm", "run", "modules:starter:test"],
  ["node", "--test",
    "contracts/scripts/module-mode/operator.test.mjs",
    "contracts/scripts/module-mode/source-readback.test.mjs",
    "contracts/scripts/module-mode/lifecycle-plan.test.mjs",
    "contracts/scripts/module-mode/operator-dispatch.test.mjs",
    "contracts/scripts/module-mode/publication-operator.test.mjs",
    "contracts/scripts/module-mode/verify-launch-source.test.mjs",
    "contracts/scripts/module-mode/launch-source-profiles.test.mjs",
    "contracts/scripts/module-native-v2/deployment.test.mjs",
    "contracts/scripts/module-engine/deployment.test.mjs",
    "contracts/scripts/module-engine/quote-deployment.test.mjs",
    "contracts/scripts/module-engine/any-quote-deployment.test.mjs",
    "scripts/test/any-quote-route-price.test.mjs",
    "scripts/test/any-quote-route-runtime.test.mjs"],
  ["npm", "run", "contracts:custom-registry-v2:test"],
  ["npm", "run", "contracts:custom-registry-v2:artifacts"],
  ["npm", "run", "contracts:test:forks"],
  ["npm", "run", "contracts:official-deployments"],
  ["npm", "run", "release:custom-launch:v4:backend-bridge:test"],
  ["npx", "vitest", "run", "tests/classic-v3-deployment-sequence.test.ts"],
  ["npx", "vitest", "run", "tests/deep-release-verifier.test.ts"],
  ["npx", "vitest", "run", "tests/deep-v2-release-verifier.test.ts"],
  ["npm", "run", "contracts:classic-v4:release:test"],
  ["npm", "run", "contracts:classic-v4:launcher-upgrade:test"],
  ["npm", "run", "contracts:robinhood:owner-envelope:test"],
  // All default-profile artifact consumers have finished before the via-IR
  // profile writes its own compiler outputs. This avoids switching back.
  ["forge-late", "lint", "src/late-migration"],
  ["forge-late", "build"],
  ["npm", "run", "contracts:late-migration:test"],
  ["npm", "run", "contracts:late-migration:deployment:test"],
]);
export const CONTRACT_CI_ANALYSIS = Object.freeze([
  ["npm", "run", "contracts:bootstrap"],
  ["npm", "run", "contracts:slither"],
]);

export function deterministicExclusion(scripts) {
  const command = scripts["contracts:test:deterministic"];
  const match = command?.match(/^cd contracts && forge test --no-match-path '([^']+)'$/u);
  if (!match) throw new Error("The complete deterministic test selector changed; review its CI partition.");
  return match[1];
}

export function partitionTestInventory(inventory) {
  if (!inventory || Array.isArray(inventory) || typeof inventory !== "object") {
    throw new Error("Forge test inventory is not an object.");
  }
  const files = Object.keys(inventory).sort();
  if (files.length < CONTRACT_TEST_PARTITIONS) throw new Error("Forge test inventory is incomplete.");
  const weighted = files.map((file) => {
    if (!/^test\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.t\.sol$/u.test(file)
      || file.startsWith("test/late-migration/")) throw new Error(`Unexpected default test path: ${file}`);
    const suites = inventory[file];
    if (!suites || Array.isArray(suites) || typeof suites !== "object"
      || Object.keys(suites).length === 0) throw new Error(`Invalid test suites: ${file}`);
    let weight = 0;
    for (const [suite, tests] of Object.entries(suites)) {
      if (!suite || !Array.isArray(tests) || tests.length === 0
        || tests.some((name) => typeof name !== "string" || !name)
        || new Set(tests).size !== tests.length) throw new Error(`Invalid tests: ${file}`);
      // Keep whole source files intact. Invariant/fuzz suites are costlier;
      // weighting them spreads their existing work without changing runs.
      weight += tests.reduce((sum, name) => sum + (name.startsWith("invariant") ? 100
        : /fuzz/iu.test(name) ? 10 : 1), 0);
    }
    return { file, weight };
  }).sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file, "en"));
  const partitions = Array.from({ length: CONTRACT_TEST_PARTITIONS }, () => ({ files: [], weight: 0 }));
  for (const item of weighted) {
    const shard = partitions.reduce((a, b) => a.weight <= b.weight ? a : b);
    shard.files.push(item.file);
    shard.weight += item.weight;
  }
  const result = partitions.map((shard) => shard.files.sort());
  assert.deepEqual(result.flat().sort(), files);
  if (result.some((shard) => shard.length === 0)) throw new Error("A deterministic shard is empty.");
  return result;
}

export function validateBuildReceipt(receipt, expected) {
  assert.deepEqual(receipt, expected, "Contract build artifact is not from this exact source/run/toolchain.");
  return true;
}

function execute([command, ...args], { capture = false } = {}) {
  const isForge = command === "forge" || command === "forge-late";
  return execFileSync(command === "forge-late" ? "forge" : command, args, {
    cwd: isForge ? contracts : root,
    env: { ...process.env, ...(isForge ? { FOUNDRY_PROFILE: command === "forge-late" ? "late-migration" : "default" } : {}) },
    encoding: capture ? "utf8" : undefined,
    maxBuffer: 32 * 1024 * 1024,
    stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
}

function expectedBuildReceipt() {
  const git = (revision) => execFileSync("git", ["rev-parse", revision], { cwd: root, encoding: "utf8" }).trim();
  if (execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: root, encoding: "utf8" }).trim()) {
    throw new Error("Contract build receipt requires a clean source checkout.");
  }
  for (const name of ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"]) {
    if (!/^[1-9][0-9]*$/u.test(process.env[name] ?? "")) throw new Error(`${name} is missing.`);
  }
  const commit = git("HEAD");
  if (commit !== process.env.GITHUB_SHA) throw new Error("Checkout does not match this workflow commit.");
  const version = execute(["forge", "--version"], { capture: true }).trim();
  if (!version.startsWith("forge Version: 1.7.1\n")) throw new Error("Contract CI requires pinned Foundry 1.7.1.");
  return {
    schemaVersion: "programmable.contracts-ci-build.v1",
    commit,
    tree: git("HEAD^{tree}"),
    workflowSha256: createHash("sha256").update(readFileSync(path.join(root, ".github/workflows/verify.yml"))).digest("hex"),
    runId: process.env.GITHUB_RUN_ID,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    forgeVersion: version,
    profile: "default",
  };
}

export function runContractCi(command, shard) {
  if (process.env.FOUNDRY_PROFILE && process.env.FOUNDRY_PROFILE !== "default") {
    throw new Error("This CI entry point requires the unchanged default test profile.");
  }
  if (command === "receipt") {
    writeFileSync(receiptPath, `${JSON.stringify(expectedBuildReceipt())}\n`, { flag: "wx" });
    return;
  }
  if (command === "verify-receipt") {
    validateBuildReceipt(JSON.parse(readFileSync(receiptPath, "utf8")), expectedBuildReceipt());
    return;
  }
  if (command === "build" || command === "release" || command === "analysis") {
    for (const stage of { build: CONTRACT_CI_BUILD, release: CONTRACT_CI_RELEASE, analysis: CONTRACT_CI_ANALYSIS }[command]) execute(stage);
    return;
  }
  if (command === "test") {
    if (!Number.isInteger(shard) || shard < 1 || shard > CONTRACT_TEST_PARTITIONS) throw new Error("Contract shard must be 1 or 2.");
    execute(["npm", "run", "contracts:bootstrap"]);
    const scripts = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).scripts;
    const exclusion = deterministicExclusion(scripts);
    const inventory = JSON.parse(execute(["forge", "test", "--list", "--json", "--no-match-path", exclusion], { capture: true }));
    const partitions = partitionTestInventory(inventory);
    const selected = partitions[shard - 1];
    console.log(JSON.stringify({ schemaVersion: "programmable.contracts-ci-partition.v1", shard,
      partitions: CONTRACT_TEST_PARTITIONS, totalFiles: Object.keys(inventory).length, selectedFiles: selected }));
    const selector = selected.length === 1 ? selected[0] : `{${selected.join(",")}}`;
    execute(["forge", "test", "--no-match-path", exclusion, "--match-path", selector]);
    return;
  }
  throw new Error("Expected build, receipt, verify-receipt, test <1|2>, release, or analysis.");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== (process.argv[2] === "test" ? 4 : 3)) throw new Error("Unexpected contract CI arguments.");
  runContractCi(process.argv[2], process.argv[3] === undefined ? undefined : Number(process.argv[3]));
}
