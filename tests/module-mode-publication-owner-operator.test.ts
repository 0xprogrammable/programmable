import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

// Keep the native node:test operator regressions inside the hosted interface test gate.
it("checks publication wallet requests and native lifecycle preparation", async () => {
  const result = await promisify(execFile)(process.execPath, ["--test",
    "contracts/scripts/module-mode/publication-operator.test.mjs",
    "contracts/scripts/module-mode/lifecycle-plan.test.mjs",
  ], { cwd: fileURLToPath(new URL("..", import.meta.url)), timeout: 60_000, maxBuffer: 2 * 1024 * 1024 });
  expect(result.stderr).toBe("");
}, 65_000);
