import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  testMatch: ["wallet-request-lock.spec.ts", "site-header.spec.ts", "wallet-session.spec.ts", "module-mode-operation.spec.ts", "module-engine-host.spec.ts", "module-engine-fee-controls.spec.ts", "module-engine-discovery.spec.ts", "module-author-profile.spec.ts", "module-native-author-wallet.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "line",
  use: {
    browserName: "chromium",
    channel: process.env.CI ? undefined : "chrome",
    headless: true,
    trace: "retain-on-failure",
  },
});
