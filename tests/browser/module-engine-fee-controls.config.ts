import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "module-engine-fee-controls.spec.ts", workers: 1, retries: 0, reporter: "line",
  outputDir: "../../output/playwright/module-engine-fee-controls", use: { browserName: "chromium", channel: process.env.CI ? undefined : "chrome", headless: true, trace: "retain-on-failure" } });
