import { expect, test, type Page } from "@playwright/test";
import { onboardedCompany, POLL_INTERVAL_MS, WORKER_TIMEOUT_MS } from "./flows";
import { companyIdBySlug, insertCampaignSpecTask, sendInngestEvent } from "./stack";

/**
 * M2 acceptance (DEC-1/2): a growth task requests a K2 `ads.start`; the card
 * appears on the home screen; one tap answers it; within two seconds the card
 * shows the answer, and the team stream shows the action executed (sandbox) or
 * declined. Needs the worker (AGENT_RUNTIME=mock, INTEGRATIONS_MODE=sandbox)
 * and the Inngest dev server next to the web app.
 */

const ANSWER_LATENCY_MS = 2_000;

async function openCardOnHome(page: Page, slug: string, title: string): Promise<string> {
  const companyId = await companyIdBySlug(slug);
  const task = await insertCampaignSpecTask(companyId, title);
  await sendInngestEvent("task/dispatch", { companyId, taskId: task.id });

  await page.goto(`/c/${slug}`);
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByTestId("decision-card").count();
      },
      { timeout: WORKER_TIMEOUT_MS, intervals: [POLL_INTERVAL_MS] },
    )
    .toBeGreaterThan(0);
  const card = page.getByTestId("decision-card").first();
  await expect(card).toContainText("K2");
  await expect(page.getByTestId("decisions-counter")).toContainText(/Decisions today · [1-5] of [1-5]/);
  return (await card.getAttribute("data-card-id")) ?? "";
}

async function expectActionRow(page: Page, slug: string, status: string): Promise<void> {
  await page.goto(`/c/${slug}/team`);
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.locator(`[data-testid="action-row"][data-kind="ads.start"][data-status="${status}"]`).count();
      },
      { timeout: WORKER_TIMEOUT_MS, intervals: [POLL_INTERVAL_MS] },
    )
    .toBeGreaterThan(0);
}

test("M2: approve a K2 card on the home screen; the action executes in the sandbox", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  const slug = await onboardedCompany(page, project, `${stamp}a`, `Decision Co ${stamp} ${project}`);

  const cardId = await openCardOnHome(page, slug, "Launch test (approve)");
  await page.screenshot({ path: `../../docs/evidence/M2/home-card-${project}.png`, fullPage: true });

  const card = page.locator(`[data-testid="decision-card"][data-card-id="${cardId}"]`);
  await card.getByTestId("answer-approve").click();
  await expect(card.getByTestId("card-answered")).toContainText("Approve", { timeout: ANSWER_LATENCY_MS });
  await page.screenshot({ path: `../../docs/evidence/M2/home-answered-${project}.png`, fullPage: true });

  await expectActionRow(page, slug, "executed");
  const row = page.locator('[data-testid="action-row"][data-kind="ads.start"][data-status="executed"]').first();
  await expect(row).toContainText("executed (sandbox)");
  await page.screenshot({ path: `../../docs/evidence/M2/team-executed-${project}.png`, fullPage: true });

  // The card detail page shows the answer and the evidence block.
  await page.goto(`/c/${slug}/decisions/${cardId}`);
  await expect(page.getByTestId("decision-question")).toBeVisible();
  await expect(page.getByTestId("card-answered")).toContainText("Approve");
  await expect(page.getByTestId("decision-rationale")).toBeVisible();
  await page.screenshot({ path: `../../docs/evidence/M2/card-detail-${project}.png`, fullPage: true });
});

test("M2: decline a K2 card; the action is recorded as declined and nothing runs", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  const slug = await onboardedCompany(page, project, `${stamp}d`, `Decline Co ${stamp} ${project}`);

  const cardId = await openCardOnHome(page, slug, "Launch test (decline)");
  const card = page.locator(`[data-testid="decision-card"][data-card-id="${cardId}"]`);
  await card.getByTestId("answer-decline").click();
  await expect(card.getByTestId("card-answered")).toContainText("Decline", { timeout: ANSWER_LATENCY_MS });

  await expectActionRow(page, slug, "declined");
  await expect(page.locator('[data-testid="action-row"][data-kind="ads.start"][data-status="executed"]')).toHaveCount(0);
});

test("M2: settings show the quota, time zone and standing rules", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  await onboardedCompany(page, project, `${stamp}s`, `Settings Co ${stamp} ${project}`);

  await page.getByTestId("nav-settings").click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByTestId("settings-quota")).toHaveValue("3");
  await page.getByTestId("settings-quota").selectOption("2");
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings-saved")).toBeVisible();
  await expect(page.getByTestId("settings-quota")).toHaveValue("2");
  await expect(page.getByTestId("auto-rules-empty")).toBeVisible();
  await page.screenshot({ path: `../../docs/evidence/M2/settings-${project}.png`, fullPage: true });
});
