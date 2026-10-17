import { defineConfig, devices } from "@playwright/test";
import { stagingEnvVerdict } from "./e2e/live/staging-env";

/**
 * TST-3, TST-4: the live founder journey against the deployed staging
 * (`e2e/live/*.live.spec.ts`; docs/runbooks/staging.md §15). No web server:
 * `E2E_BASE_URL` is the staging web (`https://staging.<web>`), the magic link
 * comes from Resend (`E2E_MAIL_PROVIDER=resend`, `E2E_RESEND_KEY`,
 * `E2E_MAIL_DOMAIN`) and Vercel's Deployment Protection is passed with
 * `VERCEL_AUTOMATION_BYPASS_SECRET` (sent as a header, never printed).
 *
 * Without `E2E_BASE_URL` this is a dry run: the config loads and every test
 * is skipped with the reason (never passed). With `E2E_BASE_URL` set and a
 * variable missing or malformed it throws, naming the variable.
 *
 * `pnpm e2e:staging` runs the nightly variant (`--grep-invert @live`),
 * `pnpm e2e:live` the acceptance (`--grep @live`).
 */
const verdict = stagingEnvVerdict(process.env);
if (verdict.kind === "fail") throw new Error(`playwright.staging.config.ts: ${verdict.message}`);
/** The main process prints the reason once; worker processes load this file too. */
if (verdict.kind === "skip" && process.env.TEST_WORKER_INDEX === undefined) console.log(`live journey: SKIP (${verdict.message})`);

const baseURL = verdict.kind === "ok" ? verdict.env.baseUrl : undefined;
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
/** A pre-installed Chromium (cloud sessions ship one) instead of the pinned download. */
const executablePath = process.env.E2E_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e/live",
  /** Only the journeys: the unit tests next to them (`*.test.ts`) run under Vitest. */
  testMatch: /\.live\.spec\.ts$/,
  /** One journey waits up to 25 min for real-Claude onboarding tasks. */
  timeout: 30 * 60_000,
  globalTimeout: 60 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-staging" }], ["json", { outputFile: "playwright-report-staging/summary.json" }]],
  use: {
    baseURL,
    trace: "on",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    ...(bypassSecret ? { extraHTTPHeaders: { "x-vercel-protection-bypass": bypassSecret } } : {}),
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: "mobile", use: { ...devices["iPhone 14"], browserName: "chromium", viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
});
