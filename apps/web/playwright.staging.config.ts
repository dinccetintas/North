import { defineConfig, devices } from "@playwright/test";
import { JOURNEY_TIMEOUT_MS, stagingEnvVerdict } from "./e2e/live/staging-env";

/**
 * TST-3, TST-4: the live founder journey against the deployed staging
 * (`e2e/live/*.live.spec.ts`; docs/runbooks/staging.md §15). No web server:
 * `E2E_BASE_URL` is the staging web (`https://staging.<web>`), the magic link
 * comes from Resend (`E2E_MAIL_PROVIDER=resend`, `E2E_RESEND_KEY`,
 * `E2E_MAIL_DOMAIN`) and must point at `E2E_SUPABASE_URL`, and Vercel's
 * Deployment Protection is passed with `VERCEL_AUTOMATION_BYPASS_SECRET`.
 *
 * The bypass secret is never a context option: `journey.live.spec.ts` adds
 * the header in a route on the staging origin only (`scopeBypassToStaging`),
 * so Supabase, Sentry or an agent-built preview never receive it and no
 * trace's context options hold it. Service workers are blocked so every page
 * request passes that route. Traces are kept on failure only, and the root
 * scripts run `scripts/evidence-guard.sh` after Playwright.
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
/** A pre-installed Chromium (cloud sessions ship one) instead of the pinned download. */
const executablePath = process.env.E2E_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e/live",
  /** Only the journeys: the unit tests next to them (`*.test.ts`) run under Vitest. */
  testMatch: /\.live\.spec\.ts$/,
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
    /** Kept only when a test fails: the evidence is the screenshots; a trace is for debugging. */
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    /** A service worker's own requests would bypass `context.route`, so the staging route could not add the header to them. */
    serviceWorkers: "block",
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    { name: "mobile", use: { ...devices["iPhone 14"], browserName: "chromium", viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
  ],
});
