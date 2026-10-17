import { defineConfig, devices } from "@playwright/test";
import { storageStatePath } from "./e2e/live/bypass-cookie";
import { JOURNEY_TIMEOUT_MS, stagingEnvVerdict } from "./e2e/live/staging-env";

/**
 * TST-3, TST-4: the live founder journey against the deployed staging
 * (`e2e/live/*.live.spec.ts`; docs/runbooks/staging.md §15). No web server:
 * `E2E_BASE_URL` is the staging web (`https://staging.<web>`), the magic link
 * comes from Resend (`E2E_MAIL_PROVIDER=resend`, `E2E_RESEND_KEY`,
 * `E2E_MAIL_DOMAIN`) and must point at `E2E_SUPABASE_URL`, and Vercel's
 * Deployment Protection is passed with `VERCEL_AUTOMATION_BYPASS_SECRET`.
 *
 * The bypass secret is used once, in Node: `e2e/global-setup.ts` sends it to
 * `E2E_BASE_URL` and keeps the `_vercel_jwt` cookie Vercel answers with; both
 * projects start from that storage state, so the browser holds only a cookie
 * scoped to the staging host and no header, route or context option carries
 * the secret (staging-config.test.ts). `e2e/global-teardown.ts` removes the
 * file. Traces are kept on failure only, and the root scripts run
 * `scripts/evidence-guard.sh` after Playwright.
 *
 * Without `E2E_BASE_URL` this is a dry run: the config loads and every test
 * is skipped with the reason (never passed). With `E2E_BASE_URL` set and a
 * variable missing or malformed it throws, naming the variable.
 *
 * `pnpm e2e:staging` runs the nightly variant (`--grep-invert @live`) and
 * the harness self-check, `pnpm e2e:live` the acceptance (`--grep @live`).
 */
const verdict = stagingEnvVerdict(process.env);
if (verdict.kind === "fail") throw new Error(`playwright.staging.config.ts: ${verdict.message}`);
/** The main process prints the reason once; worker processes load this file too. */
if (verdict.kind === "skip" && process.env.TEST_WORKER_INDEX === undefined) console.log(`live journey: SKIP (${verdict.message})`);

const baseURL = verdict.kind === "ok" ? verdict.env.baseUrl : undefined;
/**
 * An https staging run starts from the primed cookie. Set by the run's kind,
 * not by the file's existence: this file is evaluated before the global setup
 * writes it, and that setup either writes it or fails the run. A dry run has
 * none (its journeys skip before any browser starts).
 */
const storageState = baseURL?.startsWith("https:") ? storageStatePath(__dirname) : undefined;
/** A pre-installed Chromium (cloud sessions ship one) instead of the pinned download. */
const executablePath = process.env.E2E_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e/live",
  /** Only the journeys and the harness check: the unit tests next to them (`*.test.ts`) run under Vitest. */
  testMatch: /\.live\.spec\.ts$/,
  /** Primes the bypass cookie outside the browser (and keeps the replay gate of the local suites); the teardown removes it. */
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  /** One journey; its step budgets (`STEP_BUDGET_MS`) end before this, so a slow step fails with its own name. */
  timeout: JOURNEY_TIMEOUT_MS,
  globalTimeout: 60 * 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report-staging" }], ["json", { outputFile: "playwright-report-staging/summary.json" }]],
  use: {
    baseURL,
    ...(storageState ? { storageState } : {}),
    /** Kept only when a test fails: the evidence is the screenshots; a trace is for debugging. */
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    /** The journey tests the app, not its offline cache (that is `pnpm e2e:prod`); no service worker answers in place of staging. */
    serviceWorkers: "block",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: "mobile", use: { ...devices["iPhone 14"], browserName: "chromium", viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
});
