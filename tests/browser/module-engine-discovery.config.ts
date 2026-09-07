import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "module-engine-discovery.spec.ts", workers: 1, retries: 0, reporter: "line",
  outputDir: "../../output/playwright/module-engine-discovery", use: { browserName: "chromium", channel: process.env.CI ? undefined : "chrome", headless: true, trace: "retain-on-failure" } });
