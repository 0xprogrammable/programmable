import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  CONTRACT_CI_BUILD, CONTRACT_CI_RELEASE, CONTRACT_CI_ANALYSIS,
  deterministicExclusion, partitionTestInventory, validateBuildReceipt,
} from "./contracts-ci.mjs";

const scripts = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url))).scripts;

test("build, release, and analysis retain all existing contract checks without alternating compiler profiles", () => {
  assert.deepEqual(CONTRACT_CI_BUILD, [
    ["npm", "run", "contracts:bootstrap"], ["npm", "run", "contracts:variants"],
    ["npm", "run", "contracts:fmt"], ["forge", "lint", "src", "script"], ["forge", "build"],
  ]);
  assert.deepEqual(CONTRACT_CI_ANALYSIS, [
    ["npm", "run", "contracts:bootstrap"], ["npm", "run", "contracts:slither"],
  ]);
  const commands = CONTRACT_CI_RELEASE.map((command) => command.join(" "));
  assert.ok(commands.includes("npm run modules:starter:test"));
  assert.ok(commands.includes([
    "node --test",
    "contracts/scripts/module-mode/operator.test.mjs",
    "contracts/scripts/module-mode/source-readback.test.mjs",
    "contracts/scripts/module-mode/lifecycle-plan.test.mjs",
    "contracts/scripts/module-mode/operator-dispatch.test.mjs",
    "contracts/scripts/module-mode/publication-operator.test.mjs",
    "contracts/scripts/module-mode/verify-launch-source.test.mjs",
    "contracts/scripts/module-native-v2/deployment.test.mjs",
    "contracts/scripts/module-engine/deployment.test.mjs",
  ].join(" ")));
  const starterBuild = "forge build --root ../packages/classic-modules/examples/native-program";
  assert.equal(commands.filter((command) => command === starterBuild).length, 1);
  assert.ok(commands.indexOf(starterBuild) < commands.indexOf("npm run modules:starter:test"));
  assert.match(readFileSync(new URL("../../contracts/test/module-mode/starter/run-tests.sh", import.meta.url), "utf8"),
    /forge test --offline/u);
  assert.deepEqual(scripts["modules:starter:test"].split(" && "), [
    "bash contracts/test/module-mode/starter/run-tests.sh -vv",
    "node --test packages/classic-modules/examples/native-program/tools/package.test.mjs",
    "node packages/classic-modules/examples/native-program/tools/check-sdk.mjs",
    "forge test --root packages/classic-modules/examples/engine-program --offline -vv",
    "node packages/classic-modules/examples/engine-program/tools/check-build.mjs",
    "node --test packages/classic-modules/examples/engine-program/tools/package.test.mjs",
    "node packages/classic-modules/examples/engine-program/tools/prepare.mjs --fixture",
    "node packages/classic-modules/examples/engine-program/tools/check-sdk.mjs",
  ]);
  assert.ok(commands.includes("npm run contracts:custom-registry-v2:test"));
  assert.ok(commands.includes("npm run contracts:custom-registry-v2:artifacts"));
  assert.ok(commands.includes("npm run contracts:test:forks"));
  assert.ok(commands.includes("npm run contracts:official-deployments"));
  for (const command of scripts["test:contract-release:ci"].split(" && ")) {
    assert.equal(commands.filter((item) => item === (command.startsWith("vitest ") ? `npx ${command}` : command)).length, 1, command);
  }
  assert.deepEqual(commands.slice(-4), [
    "forge-late lint src/late-migration", "forge-late build",
    "npm run contracts:late-migration:test", "npm run contracts:late-migration:deployment:test",
  ]);
  assert.equal(commands.filter((command) => command.includes("forge-late")).length, 2);
  assert.equal(scripts["contracts:late-migration:test"],
    "cd contracts && FOUNDRY_PROFILE=late-migration forge test -vv");
});

test("both partitions retain the exact existing deterministic exclusion and reject changed CLI semantics", () => {
  assert.equal(`cd contracts && forge test --no-match-path '${deterministicExclusion(scripts)}'`,
    scripts["contracts:test:deterministic"]);
  for (const command of ["forge test", scripts["contracts:test:deterministic"] + " --fuzz-runs 1", ""]) {
    assert.throws(() => deterministicExclusion({ "contracts:test:deterministic": command }));
  }
});

test("every actual Forge inventory file is assigned exactly once, independent of object order", () => {
  const inventory = {
    "test/A.t.sol": { A: ["testOne", "testTwo"] },
    "test/B.t.sol": { B: ["testFuzzValues"] },
    "test/invariant/C.t.sol": { C: ["invariantAssets"] },
    "test/invariant/D.t.sol": { D: ["invariantClaims"] },
    "test/new/Added.t.sol": { Added: ["testNewlyAdded"] },
  };
  const partitions = partitionTestInventory(inventory);
  assert.equal(partitions.length, 2);
  assert.deepEqual(partitions.flat().sort(), Object.keys(inventory).sort());
  assert.equal(new Set(partitions.flat()).size, Object.keys(inventory).length);
  assert.notEqual(partitions.findIndex((files) => files.includes("test/invariant/C.t.sol")),
    partitions.findIndex((files) => files.includes("test/invariant/D.t.sol")));
  assert.deepEqual(partitionTestInventory(Object.fromEntries(Object.entries(inventory).reverse())), partitions);
  inventory["test/new/Another.t.sol"] = { Another: ["testAddedLater"] };
  assert.deepEqual(partitionTestInventory(inventory).flat().sort(), Object.keys(inventory).sort());
});

test("malformed or incomplete test inventories cannot silently reduce coverage", () => {
  const good = { "test/A.t.sol": { A: ["testOne"] }, "test/B.t.sol": { B: ["testTwo"] } };
  for (const bad of [null, [], {}, { "test/A.t.sol": { A: ["testOne"] } },
    { ...good, "../other.t.sol": { Other: ["testEscape"] } },
    { ...good, "test/late-migration/Late.t.sol": { Late: ["testLate"] } },
    { ...good, "test/Glob*.t.sol": { Glob: ["testGlob"] } },
    { ...good, "test/A.t.sol": { A: [] } },
    { ...good, "test/A.t.sol": { A: ["testOne", "testOne"] } },
    { ...good, "test/A.t.sol": [] }]) assert.throws(() => partitionTestInventory(bad));
});

test("build receipt rejects another source, run, attempt, workflow, profile, toolchain, and extra fields", () => {
  const expected = { schemaVersion: "programmable.contracts-ci-build.v1", commit: "a".repeat(40),
    tree: "b".repeat(40), workflowSha256: "c".repeat(64), runId: "12", runAttempt: "1",
    forgeVersion: "forge Version: 1.7.1\nexact build", profile: "default" };
  assert.equal(validateBuildReceipt({ ...expected }, expected), true);
  for (const key of Object.keys(expected)) {
    assert.throws(() => validateBuildReceipt({ ...expected, [key]: `${expected[key]}x` }, expected));
    const missing = { ...expected }; delete missing[key];
    assert.throws(() => validateBuildReceipt(missing, expected));
  }
  assert.throws(() => validateBuildReceipt({ ...expected, extra: true }, expected));
});
