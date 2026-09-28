import { defineConfig } from "@playwright/test";

const previewUrl = process.env.CACHALOT_URL || "http://127.0.0.1:1420/";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  // The real-paper suite deliberately shares a versioned analysis cache.
  workers: 1,
  fullyParallel: false,
  timeout: 300_000,
  expect: { timeout: 10_000 },
  reporter: "list",
  outputDir: "test-results/playwright",
  use: { baseURL: previewUrl, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: process.env.CACHALOT_URL
    ? undefined
    : {
        command: "npm run dev -- --host 127.0.0.1 --port 1420 --strictPort",
        url: previewUrl,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
