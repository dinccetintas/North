import { statSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { approveWizard, createCompany, fillWizard, POLL_INTERVAL_MS, secondCompany, signIn, WORKER_TIMEOUT_MS } from "./flows";
import { companyIdBySlug, insertBuildSiteTask, sendInngestEvent } from "./stack";
import { completeSandboxCheckout, creditLedger, entitlementFor, sandboxPortal, requestExport, userIdByEmail } from "./stack-m6";

/**
 * M6 acceptance, billing (docs/plans/M6.md, BIL-1, BIL-2, EXP-1, RET-1): the
 * 14-day Solo trial and its one-company limit, a sandbox Stripe checkout for
 * Pro that only the webhook confirms, a second company, the portal's "end"
 * pausing every company through the kill switch, and an export that still
 * downloads while ended. Needs the worker in sandbox + mock mode with the
 * sandbox billing routes and the Stripe webhook (WP-D6) and the Inngest dev
 * server; the web never holds a Stripe key.
 */

const EVIDENCE_DIR = "../../docs/evidence/M6";
const EXPORT_TIMEOUT_MS = 60_000;
const CONFIRM_TIMEOUT_MS = 30_000;
const MIN_ZIP_BYTES = 1024;

const shot = (page: Page, name: string, project: string) => page.screenshot({ path: `${EVIDENCE_DIR}/${name}-${project}.png`, fullPage: true });

async function pollReload(page: Page, read: () => Promise<unknown>, expected: unknown, timeout = WORKER_TIMEOUT_MS): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.reload();
        return read();
      },
      { timeout, intervals: [POLL_INTERVAL_MS] },
    )
    .toEqual(expected);
}

const text = async (locator: Locator): Promise<string> => ((await locator.textContent()) ?? "").trim();

/** A build per company: its first step creates the repository in the owner's (sandbox) GitHub, which the export page names. */
async function buildRepos(page: Page, slugs: readonly string[]): Promise<void> {
  for (const slug of slugs) {
    const companyId = await companyIdBySlug(slug);
    const task = await insertBuildSiteTask(companyId, "Landing page v0");
    await sendInngestEvent("task/dispatch", { companyId, taskId: task.id });
  }
  await page.goto("/settings/export");
  await pollReload(page, async () => (await page.getByTestId("export-repo").allTextContents()).filter((t) => t.includes("sandbox://repos/")).length, slugs.length);
}

test("M6 billing: trial → limit → checkout → entitlement → second company → cancel → paused → export downloads", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  const email = `founder-${stamp}b-${project}@north.test`;

  // BIL-1: a new user is on the Solo trial with Solo's 300 credits, before any company exists.
  await signIn(page, email);
  const userId = await userIdByEmail(email);
  await page.goto("/settings/billing");
  await expect(page.getByTestId("billing-plan")).toHaveText("Solo");
  await expect(page.getByTestId("billing-plan")).toHaveAttribute("data-status", "trialing");
  await expect(page.getByTestId("billing-period")).toContainText("days left");
  await expect(page.getByTestId("credits-balance")).toHaveText("300");
  await expect(page.getByTestId("usage-panel")).toBeVisible();
  await shot(page, "billing-trial", project);

  // The first company is created and onboarded; the second is refused with the plan's own words.
  await page.goto("/companies");
  const slug1 = await createCompany(page, `Billing Co ${stamp} ${project}`);
  await fillWizard(page, project);
  await approveWizard(page, slug1);
  await page.goto("/new");
  await expect(page.getByTestId("plan-limit")).toContainText("Solo includes 1 company. Upgrade to Pro for 3.");
  await expect(page.getByRole("button", { name: "Create company" })).toBeDisabled();
  await expect(page.getByTestId("nav-new")).toHaveAttribute("data-disabled", "true");

  // Checkout for Pro: the web inserts a requested session; the worker fills the sandbox URL; the redirect proves nothing.
  await page.goto("/settings/billing");
  await page.locator('[data-testid="plan-choose"][data-plan-id="pro"]').click();
  await page.waitForURL(/\/settings\/billing\/go\//);
  await completeSandboxCheckout(page);
  await expect(page.getByTestId("billing-confirmed")).toBeVisible({ timeout: CONFIRM_TIMEOUT_MS });
  await pollReload(page, () => text(page.getByTestId("billing-plan")), "Pro", CONFIRM_TIMEOUT_MS);
  await expect(page.getByTestId("billing-plan")).toHaveAttribute("data-status", "active");
  await expect(page.getByTestId("billing-companies")).toHaveText("1 of 3 companies");
  // 300 (trial) + 1 000 (Pro's period), minus one credit per onboarding run so far.
  await expect.poll(async () => (await creditLedger(userId)).granted, { timeout: CONFIRM_TIMEOUT_MS }).toBe(1300);
  await pollReload(page, async () => Number(await text(page.getByTestId("credits-balance"))) === (await creditLedger(userId)).balance, true, CONFIRM_TIMEOUT_MS);
  await expect(page.locator('[data-testid="credit-entry"][data-kind="grant_plan"]').first()).toContainText("+1000");
  const pro = await entitlementFor(userId);
  expect(pro).toMatchObject({ planId: "pro", status: "active", companyLimit: 3, monthlyCredits: 1000 });
  expect(pro.stripeCustomerId).not.toBeNull();
  await shot(page, "billing-pro", project);

  // Pro allows a second company; the portfolio lists both.
  const slug2 = await secondCompany(page, project, `Second Co ${stamp} ${project}`);
  await page.goto("/companies");
  await expect(page.getByTestId("company-row")).toHaveCount(2);
  await buildRepos(page, [slug1, slug2]);

  // The portal's "end": the webhook ends the entitlement and billing pauses every company (the kill switch, ADR 0014).
  await page.goto("/settings/billing");
  await page.getByTestId("billing-portal").click();
  await page.waitForURL(/\/settings\/billing\/go\//);
  await sandboxPortal(page, "end");
  await page.goto("/companies");
  await pollReload(page, () => page.locator('[data-testid="company-row"][data-paused-reason="subscription_ended"]').count(), 2, CONFIRM_TIMEOUT_MS);
  await page.goto(`/c/${slug1}`);
  await expect(page.getByTestId("kill-switch-subscription")).toBeVisible();
  await expect(page.getByTestId("kill-switch")).toHaveCount(0);
  await expect(page.getByTestId("kill-switch-billing")).toHaveAttribute("href", "/settings/billing");
  await shot(page, "home-paused-subscription", project);
  await page.goto("/settings/billing");
  await expect(page.getByTestId("billing-plan")).toHaveAttribute("data-status", "ended");
  await expect(page.getByTestId("billing-retention-until")).toHaveText(/^\d{4}-\d{2}-\d{2}$/);

  // EXP-1 / RET-1: the export still works while ended; the zip downloads through a one-hour signed URL.
  await requestExport(page, "full");
  await pollReload(page, () => page.locator('[data-testid="export-row"][data-status="ready"]').count(), 1, EXPORT_TIMEOUT_MS);
  const ready = page.locator('[data-testid="export-row"][data-status="ready"]').first();
  await expect(ready.getByTestId("export-bytes")).not.toHaveText("—");
  await expect(ready.getByTestId("export-expires")).toContainText("expires in");
  const [download] = await Promise.all([page.waitForEvent("download"), ready.getByTestId("export-download").click()]);
  expect(download.suggestedFilename()).toMatch(/\.zip$/);
  const saved = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(saved);
  expect(statSync(saved).size).toBeGreaterThan(MIN_ZIP_BYTES);
  await page.goto("/settings/export");
  const repos = page.getByTestId("export-repos");
  await expect(repos).toContainText("Your code is already in your GitHub");
  expect((await repos.getByTestId("export-repo").allTextContents()).filter((t) => t.includes("sandbox://repos/"))).toHaveLength(2);
  await expect(repos.locator('a[href^="sandbox:"]')).toHaveCount(0);
  await shot(page, "export-ready", project);
});
