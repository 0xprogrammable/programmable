import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "module-author-profile.spec.ts", fullyParallel: false, workers: 1, retries: 0, reporter: "line",
  outputDir: "../../output/playwright/module-author-profile", use: { browserName: "chromium", channel: process.env.CI ? undefined : "chrome", headless: true, trace: "retain-on-failure" } });
