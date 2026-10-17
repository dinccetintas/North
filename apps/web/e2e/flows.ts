import { expect, type Page } from "@playwright/test";
import { latestMagicLink } from "./mail";

/** Shared browser flows: magic-link sign-in, company creation and the M1 onboarding wizard. */

export const THESIS = "Done-for-you cold email for B2B agencies without an outbound arm, sold as a monthly retainer.";
export const ONBOARDING_TASK_COUNT = 6;
export const WORKER_TIMEOUT_MS = 120_000;
export const POLL_INTERVAL_MS = 5_000;

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await expect(page.getByRole("status")).toContainText("Link sent");
  await page.goto(await latestMagicLink(email));
  await expect(page).toHaveURL(/\/companies/);
}

export async function createCompany(page: Page, name: string): Promise<string> {
  await page.getByRole("link", { name: "New company" }).click();
  await page.getByLabel("Company name").fill(name);
  await page.getByLabel("Thesis").fill(THESIS);
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/c\/[^/]+\/onboarding$/);
  const slug = new URL(page.url()).pathname.split("/")[2];
  if (!slug) throw new Error(`No slug in ${page.url()}`);
  return slug;
}

/** Fills the four wizard steps with deterministic answers and stops on the summary (before approval). */
export async function fillWizard(page: Page, project: string): Promise<void> {
  const step = page.getByTestId("onboarding-step");

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

  await expect(step).toHaveAttribute("data-step", "goal");
  await expect(page.getByTestId("wizard-step-label")).toContainText("Step 2 of 4");
  await page.getByTestId("goal-metric").selectOption("paying_customers");
  await page.getByTestId("goal-target").fill("10");
  await page.getByTestId("goal-due").fill("2026-12-31");
  await page.getByTestId("goal-continue").click();

  await expect(step).toHaveAttribute("data-step", "budget");
  await expect(page.getByTestId("wizard-step-label")).toContainText("Step 3 of 4");
  await expect(page.getByTestId("budget-ads-total")).toHaveValue("300");
  await expect(page.getByTestId("budget-ads-daily")).toHaveValue("20");
  await page.getByTestId("budget-ads-total").fill("250");
  await page.getByTestId("budget-ads-daily").fill("15");
  await page.getByTestId("budget-continue").click();

  await expect(step).toHaveAttribute("data-step", "summary");
  await expect(page.getByTestId("wizard-step-label")).toContainText("Step 4 of 4");
  await expect(page.getByTestId("summary-goal")).toContainText("Paying customers");
  await expect(page.getByTestId("summary-budgets")).toContainText("$250");
}

/** Approves the summary and waits for the company home. */
export async function approveWizard(page: Page, slug: string): Promise<void> {
  await page.getByTestId("approve-start").click();
  await expect(page).toHaveURL(new RegExp(`/c/${slug}$`));
  await expect(page.getByTestId("kill-switch")).toHaveText("Stop all agents");
}

/** The rows of the home's "First 24 hours" list, optionally only those with the given status. */
export const onboardingRows = (page: Page, status?: string) => page.locator(`[data-testid="onboarding-tasks"] [data-testid="task-row"]${status ? `[data-status="${status}"]` : ""}`);

/** Counts rows in the "First 24 hours" list with the given status after a reload. */
export const countOnboardingRows = (page: Page, status?: string) => onboardingRows(page, status).count();

/**
 * M6: a second company for the signed-in owner, onboarded to its home. The
 * owner's plan must allow it first (the trial is Solo, one company): call
 * `grantPlan(userId, "pro")` or complete a sandbox checkout before this.
 */
export async function secondCompany(page: Page, project: string, name: string): Promise<string> {
  await page.goto("/new");
  await expect(page.getByTestId("plan-limit")).toHaveCount(0);
  await page.getByLabel("Company name").fill(name);
  await page.getByLabel("Thesis").fill(THESIS);
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page).toHaveURL(/\/c\/[^/]+\/onboarding$/);
  const slug = new URL(page.url()).pathname.split("/")[2];
  if (!slug) throw new Error(`No slug in ${page.url()}`);
  await fillWizard(page, `${project}-2`);
  await approveWizard(page, slug);
  return slug;
}

/** Sign in, create a company and run the wizard to the home screen. Returns the slug. */
export async function onboardedCompany(page: Page, project: string, stamp: string, name: string): Promise<string> {
  await signIn(page, `founder-${stamp}-${project}@north.test`);
  const slug = await createCompany(page, name);
  await fillWizard(page, project);
  await approveWizard(page, slug);
  return slug;
}
