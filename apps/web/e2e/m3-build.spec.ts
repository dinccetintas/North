import { expect, test, type Page } from "@playwright/test";
import { onboardedCompany, POLL_INTERVAL_MS, WORKER_TIMEOUT_MS } from "./flows";
import { companyIdBySlug, insertBuildSiteTask, sendInngestEvent } from "./stack";

/**
 * M3 acceptance (docs/plans/M3.md): an engineering task builds the landing
 * page; repo, push and preview run as K1; the home screen shows the go-live
 * card with a working preview link; approve publishes and the task row links
 * "live" to a page that carries the company name; decline keeps the preview.
 * Connections (ONB-3): sandbox connect and disconnect from settings. Needs
 * the worker (AGENT_RUNTIME=mock, INTEGRATIONS_MODE=sandbox) and Inngest dev.
 */

const ANSWER_LATENCY_MS = 2_000;

async function openGoLiveCard(page: Page, slug: string, title: string): Promise<string> {
  const companyId = await companyIdBySlug(slug);
  const task = await insertBuildSiteTask(companyId, title);
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
  await expect(card).toContainText(/Publish|live/i);
  return (await card.getAttribute("data-card-id")) ?? "";
}

/** Waits for the seeded task's row to show a done status with an evidence link of the given label. */
async function expectEvidenceLink(page: Page, slug: string, label: "preview" | "live"): Promise<string> {
  await page.goto(`/c/${slug}`);
  const link = page.locator(`[data-testid="onboarding-tasks"] [data-testid="task-row"][data-status="done"] [data-testid="task-evidence"][data-evidence="${label}"]`);
  await expect
    .poll(
      async () => {
        await page.reload();
        return link.count();
      },
      { timeout: WORKER_TIMEOUT_MS, intervals: [POLL_INTERVAL_MS] },
    )
    .toBeGreaterThan(0);
  const href = await link.first().getAttribute("href");
  expect(href).toMatch(/^http/);
  return href ?? "";
}

test("M3: build → preview on the card → approve → live link opens the page with the company name", async ({ page, request }, testInfo) => {
  test.setTimeout(300_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  const name = `Build Co ${stamp} ${project}`;
  const slug = await onboardedCompany(page, project, `${stamp}b`, name);

  const cardId = await openGoLiveCard(page, slug, "Landing page v0");
  // The Website line already shows the verified preview while the card waits.
  await expect(page.getByTestId("website-status")).toHaveText("preview");
  const previewUrl = (await page.getByTestId("website-link").getAttribute("href")) ?? "";
  expect(previewUrl).toMatch(/\/sandbox\/sites\//);
  const previewResponse = await request.get(previewUrl);
  expect(previewResponse.status()).toBe(200);
  expect(await previewResponse.text()).toContain(name);
  await page.screenshot({ path: `../../docs/evidence/M3/home-golive-card-${project}.png`, fullPage: true });

  // Card detail shows the preview link next to the question.
  await page.goto(`/c/${slug}/decisions/${cardId}`);
  await expect(page.getByTestId("decision-preview")).toContainText(previewUrl);
  await page.screenshot({ path: `../../docs/evidence/M3/card-detail-preview-${project}.png`, fullPage: true });

  await page.getByTestId("answer-approve").click();
  await expect(page.getByTestId("card-answered")).toContainText("Approve", { timeout: ANSWER_LATENCY_MS });

  const liveUrl = await expectEvidenceLink(page, slug, "live");
  expect(liveUrl).toMatch(/\/live-/);
  await expect(page.getByTestId("website-status")).toHaveText("live");
  await expect(page.getByTestId("website-link")).toHaveAttribute("href", liveUrl);
  await page.screenshot({ path: `../../docs/evidence/M3/home-live-${project}.png`, fullPage: true });

  await page.goto(liveUrl);
  await expect(page.locator("h1")).toBeVisible();
  await expect(page.locator("body")).toContainText(name);
  await page.screenshot({ path: `../../docs/evidence/M3/live-site-${project}.png`, fullPage: true });

  // The team stream shows every step through the gate.
  await page.goto(`/c/${slug}/team`);
  for (const [kind, status] of [
    ["repo.create", "notified"],
    ["repo.push", "notified"],
    ["deploy.preview", "notified"],
    ["deploy.production", "executed"],
  ]) {
    await expect(page.locator(`[data-testid="action-row"][data-kind="${kind}"][data-status="${status}"]`).first()).toBeVisible();
  }
  await page.screenshot({ path: `../../docs/evidence/M3/team-stream-${project}.png`, fullPage: true });
});

test("M3: decline the go-live card; the task finishes with the preview as evidence and nothing goes live", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  const slug = await onboardedCompany(page, project, `${stamp}n`, `Decline Build ${stamp} ${project}`);

  const cardId = await openGoLiveCard(page, slug, "Landing page v0 (decline)");
  const card = page.locator(`[data-testid="decision-card"][data-card-id="${cardId}"]`);
  await card.getByTestId("answer-decline").click();
  await expect(card.getByTestId("card-answered")).toContainText("Decline", { timeout: ANSWER_LATENCY_MS });

  const previewUrl = await expectEvidenceLink(page, slug, "preview");
  expect(previewUrl).not.toMatch(/\/live-/);
  await expect(page.getByTestId("website-status")).toHaveText("preview");
  await page.goto(`/c/${slug}/team`);
  await expect(page.locator('[data-testid="action-row"][data-kind="deploy.production"][data-status="declined"]').first()).toBeVisible();
  await expect(page.locator('[data-testid="action-row"][data-kind="deploy.production"][data-status="executed"]')).toHaveCount(0);
});

test("ONB-3: connections page connects GitHub in sandbox and disconnects again", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  await onboardedCompany(page, project, `${stamp}c`, `Connect Co ${stamp} ${project}`);

  await page.getByTestId("nav-settings").click();
  await page.getByTestId("settings-connections").click();
  await expect(page).toHaveURL(/\/settings\/connections$/);
  const github = page.locator('[data-testid="connection-row"][data-provider="github"]');
  const vercel = page.locator('[data-testid="connection-row"][data-provider="vercel"]');
  await expect(github).toHaveAttribute("data-status", "none");
  await expect(vercel).toHaveAttribute("data-status", "none");
  await page.screenshot({ path: `../../docs/evidence/M3/connections-empty-${project}.png`, fullPage: true });

  await github.getByTestId("connection-connect").click();
  await expect(github).toHaveAttribute("data-status", "connected");
  await expect(github.getByTestId("connection-account")).toContainText("sandbox");
  await page.screenshot({ path: `../../docs/evidence/M3/connections-github-${project}.png`, fullPage: true });

  await github.getByTestId("connection-disconnect").click();
  await expect(github).toHaveAttribute("data-status", "revoked");
  await expect(github.getByTestId("connection-connect")).toBeVisible();

  // A forged callback without the state cookie is refused and changes nothing.
  await page.goto("/api/connections/github/callback?code=forged&state=forged");
  await expect(page).toHaveURL(/\/settings\/connections\?error=github-state$/);
  await expect(page.getByTestId("connections-error")).toBeVisible();
  await expect(github).toHaveAttribute("data-status", "revoked");
});
