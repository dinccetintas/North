import { expect, test, type Locator, type Page } from "@playwright/test";
import { onboardedCompany, POLL_INTERVAL_MS, WORKER_TIMEOUT_MS } from "./flows";
import { companyIdBySlug, generateBrief, insertBuildSiteTask, localDayFor, postSentryWebhook, scanSignals, sendInngestEvent, sentryIssue, setSentryProject } from "./stack";

/**
 * M5 acceptance (docs/plans/M5.md): the morning brief on the home screen and
 * a signal that becomes a card with evidence, approve opens research, the
 * second opportunity of the week is held (BRF-1, PRO-1, PRO-3-CAP); a Sentry
 * issue becomes a fix PR and a go-live card while forged and replayed webhooks
 * change nothing (PRO-2); the time zone drives the quota day and the cost
 * dashboard shows the mock runs at $0.00 (DEC-3, OBS-1). Needs the worker
 * (AGENT_RUNTIME=mock, INTEGRATIONS_MODE=sandbox, the sandbox Sentry secret)
 * and the Inngest dev server; the worker's clock is not moved here.
 */

const ANSWER_LATENCY_MS = 2_000;
const BRIEF_MAX_WORDS = 200;
const EVIDENCE_DIR = "../../docs/evidence/M5";

const shot = (page: Page, name: string, project: string) => page.screenshot({ path: `${EVIDENCE_DIR}/${name}-${project}.png`, fullPage: true });

/** Reloads the page until the locator has at least `min` matches (the worker runs in the background). */
async function pollCount(page: Page, locator: Locator, min = 1): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.reload();
        return locator.count();
      },
      { timeout: WORKER_TIMEOUT_MS, intervals: [POLL_INTERVAL_MS] },
    )
    .toBeGreaterThanOrEqual(min);
}

const cardOfKind = (page: Page, kind: string) => page.locator(`[data-testid="decision-card"][data-action-kind="${kind}"]`);
const signalRows = (page: Page, attrs: string) => page.locator(`[data-testid="signal-row"]${attrs}`);
const taskRows = (page: Page, attrs: string) => page.locator(`[data-testid="task-row"]${attrs}`);
const actionRows = (page: Page, kind: string, status: string) => page.locator(`[data-testid="action-row"][data-kind="${kind}"][data-status="${status}"]`);

/** M3 steps: a build task → go-live card → approve → the Website line reads "live". */
async function publishSite(page: Page, slug: string, companyId: string): Promise<void> {
  const task = await insertBuildSiteTask(companyId, "Landing page v0");
  await sendInngestEvent("task/dispatch", { companyId, taskId: task.id });
  await page.goto(`/c/${slug}`);
  await pollCount(page, cardOfKind(page, "deploy.production"));
  const card = cardOfKind(page, "deploy.production").first();
  await card.getByTestId("answer-approve").click();
  await expect(card.getByTestId("card-answered")).toContainText("Approve", { timeout: ANSWER_LATENCY_MS });
  await pollCount(page, page.locator('[data-testid="website-status"]:has-text("live")'));
}

test("M5 brief and signal: the brief on the home screen, a signal card with evidence, approve opens research, the second opportunity is held", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  const slug = await onboardedCompany(page, project, `${stamp}p`, `Signal Co ${stamp} ${project}`);
  const companyId = await companyIdBySlug(slug);

  // BRF-1: one brief row for the owner's day (the wizard's owner is on UTC), rendered first on the morning screen.
  const day = localDayFor("UTC");
  await generateBrief(companyId, day);
  await page.goto(`/c/${slug}`);
  await pollCount(page, page.getByTestId("brief"));
  const brief = page.getByTestId("brief");
  await expect(brief).toHaveAttribute("data-brief-date", day);
  await expect(brief.getByTestId("brief-headline")).toContainText("Morning brief");
  await expect(brief.getByTestId("brief-decisions")).toBeVisible();
  await expect(brief.getByTestId("brief-today")).toBeVisible();
  const words = Number.parseInt((await brief.getByTestId("brief-words").textContent()) ?? "NaN", 10);
  expect(words).toBeLessThanOrEqual(BRIEF_MAX_WORDS);
  await shot(page, "home-brief", project);

  // PRO-1: the scan inserts the sandbox reddit rows; the 0.85 one opens a K2 card through the gate with its evidence URL.
  await scanSignals(companyId);
  await pollCount(page, signalRows(page, ""), 2);
  await pollCount(page, cardOfKind(page, "signal.pursue"));
  const card = cardOfKind(page, "signal.pursue").first();
  await expect(card).toContainText("K2");
  await expect(card).toContainText("reddit");
  await expect(card).toContainText("0.85");
  await expect(signalRows(page, '[data-source="reddit"][data-status="card_opened"]').first()).toContainText("card open");
  await shot(page, "home-signal-card", project);
  const cardId = (await card.getAttribute("data-card-id")) ?? "";

  // The detail page shows the excerpt as text (the fixture carries a literal <b>) and only http(s) evidence links.
  await page.goto(`/c/${slug}/decisions/${cardId}`);
  await expect(page.getByTestId("decision-signal")).toBeVisible();
  const evidence = page.getByTestId("signal-evidence").locator("a");
  expect(await evidence.count()).toBeGreaterThanOrEqual(1);
  for (const href of await evidence.evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""))) {
    expect(href).toMatch(/^https:\/\//);
  }
  await expect(page.getByTestId("signal-excerpt")).toContainText("<b>");
  await expect(page.getByTestId("signal-excerpt").locator("b")).toHaveCount(0);
  await shot(page, "card-detail-signal", project);
  await page.getByTestId("answer-approve").click();
  await expect(page.getByTestId("card-answered")).toContainText("Approve", { timeout: ANSWER_LATENCY_MS });

  // Approve performs the action: the signal is approved and a research task runs to done with its report.
  await page.goto(`/c/${slug}`);
  await pollCount(page, signalRows(page, '[data-status="approved"]'));
  await pollCount(page, taskRows(page, '[data-task-type="signal_research"][data-status="done"]'));
  await shot(page, "home-signal-approved", project);

  // PRO-3-CAP: the next scan's 0.9 Product Hunt signal is held, the week already has its opportunity card.
  await scanSignals(companyId);
  await pollCount(page, signalRows(page, '[data-source="producthunt"][data-status="capped"]'));
  await expect(signalRows(page, '[data-source="producthunt"][data-status="capped"]').first().getByTestId("signal-status")).toHaveText("held for next week");
  await expect(page.getByTestId("decisions-counter")).toContainText("1 of 3");
  await shot(page, "home-signal-capped", project);
});

test("M5 error-to-fix: a Sentry issue becomes a fix PR and a go-live card; forged and replayed webhooks change nothing", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  const slug = await onboardedCompany(page, project, `${stamp}e`, `Fix Co ${stamp} ${project}`);
  const companyId = await companyIdBySlug(slug);
  await publishSite(page, slug, companyId);

  const projectSlug = `north-${stamp}-${project}`;
  const shortId = `NORTH-${stamp.toUpperCase()}`;
  await setSentryProject(companyId, projectSlug);
  const issue = sentryIssue(projectSlug, shortId);

  // A forged signature is refused; the real one is accepted once.
  expect((await postSentryWebhook(issue, { secret: "wrong" })).status).toBe(401);
  const first = await postSentryWebhook(issue);
  expect(first.status).toBe(200);
  expect(first.duplicate).toBe(false);

  // PRO-2: no human from the error to the PR; going live is the one card.
  await page.goto(`/c/${slug}`);
  await pollCount(page, cardOfKind(page, "deploy.production"));
  await shot(page, "home-fix-card", project);
  const cardId = (await cardOfKind(page, "deploy.production").first().getAttribute("data-card-id")) ?? "";

  await page.goto(`/c/${slug}/decisions/${cardId}`);
  const incident = page.getByTestId("decision-incident");
  await expect(incident).toContainText("TypeError: Cannot read properties of undefined");
  await expect(incident).not.toContainText("<instructions>");
  // M5 review L2: a sandbox ref is never an anchor; the ref travels in data-ref.
  await expect(page.getByTestId("decision-pr")).toHaveAttribute("data-ref", /^sandbox:\/\/repos\/.+\/pull\/1$/);
  await expect(page.getByTestId("decision-pr")).toHaveAttribute("data-sandbox", "true");
  await expect(page.getByTestId("decision-pr")).not.toHaveAttribute("href", /.+/);
  await expect(page.getByTestId("decision-preview")).toBeVisible();
  await shot(page, "card-detail-fix", project);

  await page.goto(`/c/${slug}/team`);
  await expect(actionRows(page, "repo.pull_request", "notified").first()).toBeVisible();
  await expect(actionRows(page, "repo.push", "notified").first()).toBeVisible();
  await shot(page, "team-stream-fix", project);

  // A replay answers 200 and opens nothing new: still one fix task.
  const replay = await postSentryWebhook(issue);
  expect(replay.status).toBe(200);
  expect(replay.duplicate).toBe(true);
  await page.goto(`/c/${slug}`);
  await expect(taskRows(page, '[data-task-type="fix_error"]')).toHaveCount(1);

  await page.goto(`/c/${slug}/decisions/${cardId}`);
  await page.getByTestId("answer-approve").click();
  await expect(page.getByTestId("card-answered")).toContainText("Approve", { timeout: ANSWER_LATENCY_MS });

  // The fix is done with the live URL as verified evidence; the incident report is on the strip.
  await page.goto(`/c/${slug}`);
  const fixRow = taskRows(page, '[data-task-type="fix_error"][data-status="done"]');
  await pollCount(page, fixRow);
  await expect(fixRow.first().locator('[data-testid="task-evidence"][data-evidence="live"]')).toBeVisible();
  await expect(page.getByTestId("artifacts-strip")).toContainText("Incident report");
  await shot(page, "home-fix-live", project);
});

test("M5 settings: time zone and the cost dashboard", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  await onboardedCompany(page, project, `${stamp}z`, `Zone Co ${stamp} ${project}`);

  await page.getByTestId("nav-settings").click();
  await expect(page).toHaveURL(/\/settings$/);
  await page.getByTestId("settings-timezone").selectOption("Europe/Istanbul");
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings-saved")).toBeVisible();
  await expect(page.getByTestId("settings-timezone")).toHaveValue("Europe/Istanbul");
  await expect(page.getByText("The morning brief and the daily card quota follow this clock")).toBeVisible();

  // OBS-1: one row per company; the onboarding's mock runs are counted and cost nothing.
  await expect(page.getByTestId("cost-dashboard")).toBeVisible();
  await expect(page.getByTestId("cost-row")).toHaveCount(1);
  await expect
    .poll(
      async () => {
        await page.reload();
        return Number.parseInt((await page.getByTestId("cost-runs").first().textContent()) ?? "0", 10);
      },
      { timeout: WORKER_TIMEOUT_MS, intervals: [POLL_INTERVAL_MS] },
    )
    .toBeGreaterThanOrEqual(1);
  await expect(page.getByTestId("cost-total").first()).toHaveText("$0.00");
  await expect(page.getByTestId("cost-day")).toHaveCount(7);
  await shot(page, "settings-cost", project);
});
