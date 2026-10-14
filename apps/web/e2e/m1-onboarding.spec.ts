import { expect, test } from "@playwright/test";
import { approveWizard, countOnboardingRows, createCompany, fillWizard, ONBOARDING_TASK_COUNT, POLL_INTERVAL_MS, signIn, WORKER_TIMEOUT_MS } from "./flows";

/**
 * M1 acceptance: thesis → questions → goal → budget → summary → approve, then
 * the home shows the six onboarding tasks, at least one finishes and the first
 * artifact appears. Needs the worker (AGENT_RUNTIME=mock) and the Inngest dev
 * server next to the web app.
 */

const ROLE_COUNT = 8;

test("M1: onboarding wizard, approval, first tasks and the first artifact", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  const email = `founder-${stamp}-${project}@north.test`;

  await signIn(page, email);
  const slug = await createCompany(page, `Cold Hive ${stamp} ${project}`);
  await fillWizard(page, project);
  await expect(page.getByRole("heading", { name: "First 24 hours" })).toBeVisible();
  await page.screenshot({ path: `../../docs/evidence/M1/onboarding-summary-${project}.png`, fullPage: true });

  await approveWizard(page, slug);
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
