import { defineConfig } from "@playwright/test";

const shouldStartWebServer = process.env.PLAYWRIGHT_WITH_SERVER === "1";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: shouldStartWebServer
    ? {
        command: "pnpm dev",
        env: {
          SKIP_ENV_VALIDATION: "1",
        },
        url: "http://127.0.0.1:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
