import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3100";
/** A pre-installed Chromium (cloud sessions ship one at /opt/pw-browsers/chromium) instead of the pinned download. */
const executablePath = process.env.E2E_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  /** Production-build flows (the offline brief) run with playwright.prod.config.ts: `pnpm e2e:prod`. */
  testIgnore: /\.prod\.spec\.ts$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  /**
   * One spec at a time: the specs assert a single user's latency (an answer
   * shows within 2 s, DEC-2), and two browsers driving agents on the same
   * dev server, worker and database measure the machine, not the product.
   */
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: "mobile", use: { ...devices["iPhone 14"], browserName: "chromium", viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: "pnpm dev",
    url: `${baseURL}/api/health`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
