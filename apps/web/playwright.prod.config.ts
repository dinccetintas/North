import { defineConfig, devices } from "@playwright/test";

/**
 * PWA-1 flows that only a production build can prove. The dev server's
 * client waits for its hot-reload socket before hydrating, so no dev page can
 * render offline; and Playwright's `setOffline` leaves the service worker's
 * own requests on the network unless service-worker routing is on, which the
 * specs then abort. Run with `pnpm e2e:prod` (builds, serves on :3200, needs
 * the worker and Inngest from `pnpm dev`).
 */
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = "1";

const baseURL = process.env.E2E_PROD_BASE_URL ?? "http://localhost:3200";
const executablePath = process.env.E2E_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  testMatch: /\.prod\.spec\.ts$/,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-prod" }]],
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
    command: "pnpm build && pnpm start -p 3200",
    url: `${baseURL}/api/health`,
    reuseExistingServer: true,
    timeout: 600_000,
  },
});
