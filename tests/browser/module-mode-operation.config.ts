import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "module-mode-operation.spec.ts", fullyParallel: false, workers: 1, retries: 0, reporter: "line",
  outputDir: "../../output/playwright/module-mode-operation",
  use: { browserName: "chromium", channel: process.env.CI ? undefined : "chrome", headless: true, trace: "retain-on-failure" },
});
