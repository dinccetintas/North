import { expect, test, type Page } from "@playwright/test";
import { latestMagicLink } from "./mail";

/**
 * M1 acceptance: thesis → questions → goal → budget → summary → approve, then
 * the home shows the six onboarding tasks, at least one finishes and the first
 * artifact appears. Needs the worker (AGENT_RUNTIME=mock) and the Inngest dev
 * server next to the web app.
 */

const THESIS = "Done-for-you cold email for B2B agencies without an outbound arm, sold as a monthly retainer.";
const ONBOARDING_TASK_COUNT = 6;
const ROLE_COUNT = 8;
const WORKER_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 5_000;

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Link sent");
  await page.goto(await latestMagicLink(email));
  await expect(page).toHaveURL(/\/companies/);
}

async function createCompany(page: Page, name: string): Promise<string> {
  await page.getByRole("link", { name: "New company" }).click();
  await page.getByLabel("Company name").fill(name);
  await page.getByLabel("Thesis").fill(THESIS);
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/c\/[^/]+\/onboarding$/);
  const slug = new URL(page.url()).pathname.split("/")[2];
  if (!slug) throw new Error(`No slug in ${page.url()}`);
  return slug;
}

/** Counts rows in the "First 24 hours" list with the given status after a reload. */
const countOnboardingRows = (page: Page, status?: string) =>
  page.locator(`[data-testid="onboarding-tasks"] [data-testid="task-row"]${status ? `[data-status="${status}"]` : ""}`).count();

test("M1: onboarding wizard, approval, first tasks and the first artifact", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  const email = `founder-${stamp}-${project}@north.test`;

  await signIn(page, email);
  const slug = await createCompany(page, `Cold Hive ${stamp} ${project}`);
  const step = page.getByTestId("onboarding-step");

  // Step 1: questions (≤5, from the deterministic fallback in sandbox).
  await expect(step).toHaveAttribute("data-step", "questions");
  await expect(page.getByTestId("wizard-step-label")).toContainText("Step 1 of 4");
  const answers = page.locator('[data-testid^="answer-q"]');
  const questionCount = await answers.count();
  expect(questionCount).toBeGreaterThan(0);
  expect(questionCount).toBeLessThanOrEqual(5);
  for (let i = 0; i < questionCount; i += 1) {
    await answers.nth(i).fill(`Answer ${i + 1} for ${project}.`);
  }
  await page.getByTestId("questions-continue").click();

  // Step 2: goal.
  await expect(step).toHaveAttribute("data-step", "goal");
  await expect(page.getByTestId("wizard-step-label")).toContainText("Step 2 of 4");
  await page.getByTestId("goal-metric").selectOption("paying_customers");
  await page.getByTestId("goal-target").fill("10");
  await page.getByTestId("goal-due").fill("2026-12-31");
  await page.getByTestId("goal-continue").click();

  // Step 3: budget (defaults prefilled, override ads).
  await expect(step).toHaveAttribute("data-step", "budget");
  await expect(page.getByTestId("wizard-step-label")).toContainText("Step 3 of 4");
  await expect(page.getByTestId("budget-ads-total")).toHaveValue("300");
  await expect(page.getByTestId("budget-ads-daily")).toHaveValue("20");
  await page.getByTestId("budget-ads-total").fill("250");
  await page.getByTestId("budget-ads-daily").fill("15");
  await page.getByTestId("budget-continue").click();

  // Step 4: summary.
  await expect(step).toHaveAttribute("data-step", "summary");
  await expect(page.getByTestId("wizard-step-label")).toContainText("Step 4 of 4");
  await expect(page.getByTestId("summary-goal")).toContainText("Paying customers");
  await expect(page.getByTestId("summary-budgets")).toContainText("$250");
  await expect(page.getByRole("heading", { name: "First 24 hours" })).toBeVisible();
  await page.screenshot({ path: `../../docs/evidence/M1/onboarding-summary-${project}.png`, fullPage: true });

  await page.getByTestId("approve-start").click();
  await expect(page).toHaveURL(new RegExp(`/c/${slug}$`));
  await expect(page.getByTestId("kill-switch")).toHaveText("Stop all agents");
  await expect(page.getByText("Decisions today")).toBeVisible();
  await expect(page.getByRole("heading", { name: "First 24 hours" })).toBeVisible();

  // The worker creates the six onboarding tasks on company/onboarded.
  await expect
    .poll(
      async () => {
        await page.reload();
        return countOnboardingRows(page);
      },
      { timeout: WORKER_TIMEOUT_MS, intervals: [POLL_INTERVAL_MS] },
    )
    .toBe(ONBOARDING_TASK_COUNT);

  // At least one task finishes and the first artifact shows up on the strip.
  await expect
    .poll(
      async () => {
        await page.reload();
        return countOnboardingRows(page, "done");
      },
      { timeout: WORKER_TIMEOUT_MS, intervals: [POLL_INTERVAL_MS] },
    )
    .toBeGreaterThan(0);
  await expect(page.getByTestId("artifacts-strip").getByTestId("artifact-item").first()).toBeVisible();

  await page.screenshot({ path: `../../docs/evidence/M1/company-home-plan-${project}.png`, fullPage: true });

  // The artifact page renders markdown and offers the download.
  await page.getByTestId("artifacts-strip").getByTestId("artifact-item").first().getByRole("link").click();
  await expect(page.getByTestId("artifact-markdown")).toBeVisible();
  await expect(page.getByTestId("artifact-download")).toHaveAttribute("href", /\/api\/artifacts\//);
  await page.screenshot({ path: `../../docs/evidence/M1/artifact-${project}.png`, fullPage: true });

  // Team: eight role cards and the terminal action stream.
  await page.getByRole("link", { name: "Team" }).click();
  await expect(page).toHaveURL(new RegExp(`/c/${slug}/team$`));
  await expect(page.getByTestId("role-card")).toHaveCount(ROLE_COUNT);
  await expect(page.getByTestId("action-stream")).toBeVisible();
  await page.screenshot({ path: `../../docs/evidence/M1/team-${project}.png`, fullPage: true });
});
