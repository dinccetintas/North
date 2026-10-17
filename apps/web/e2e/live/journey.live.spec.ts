import { expect, request, test, type Page, type TestInfo } from "@playwright/test";
import { approveWizard, createCompany, fillWizard, signIn } from "../flows";
import { assertWithin, evidenceDir, pollReload, requireStagingEnv, stagingEnv, stepShot, waitForTasks, writeJourneyNotes, type JourneyNotes } from "./helpers";
import { describeRows, e2eAddress, evidenceDate, isFencedPreview, REQUIRED_DONE } from "./staging-env";

/**
 * TST-3, TST-4, DEC-2: the founder's journey on the deployed staging, driven
 * through the real UI only (no test answers a card or writes a row through a
 * back door). A fresh `e2e-<stamp>-<project>@<E2E_MAIL_DOMAIN>` signs in by a
 * magic link read from Resend's receiving API, creates a company, runs the
 * onboarding wizard, waits for the six onboarding tasks to settle on real
 * Claude (25 min), opens the research and product artifacts, waits for the
 * first weekly plan, checks the go-live card's preview when the plan builds a
 * site, checks the campaign draft card when one is open and presses the kill
 * switch (paused within 5 s). Each step leaves a screenshot per viewport in
 * `docs/evidence/M7/acceptance/<date>/`, plus `journey-<project>.json`.
 *
 * Two variants share every step: the nightly (`pnpm e2e:staging`,
 * `--grep-invert @live`) leaves the campaign card open; the acceptance
 * (`pnpm e2e:live`, `--grep @live`) answers it in the UI. Without staging
 * (`E2E_BASE_URL` unset) every test is skipped with the reason; costs are
 * read afterwards by `pnpm evidence:costs`, never through the UI.
 */

const TASKS_TIMEOUT_MS = 25 * 60_000;
const PLAN_TIMEOUT_MS = 10 * 60_000;
const GO_LIVE_TIMEOUT_MS = 10 * 60_000;
const KILL_SWITCH_MS = 5_000;
/** DEC-2: an answer shows on the card within two seconds of the tap. */
const ANSWER_LATENCY_MS = 2_000;
const GO_LIVE_KIND = "deploy.production";
const CAMPAIGN_KIND = "ads.start";
/** The acceptance proves the one-tap answer with the card's safe default: nothing starts delivering; approving is the founder's own call. */
const CAMPAIGN_ANSWER = { id: "decline", label: "Decline" } as const;

type Variant = JourneyNotes["variant"];

const cardOfKind = (page: Page, kind: string) => page.locator(`[data-testid="decision-card"][data-action-kind="${kind}"]`);

/** Sign-in by magic link, the company, the wizard and its approval; returns the slug. */
async function onboard(page: Page, dir: string, email: string, project: string, name: string): Promise<string> {
  await signIn(page, email);
  await stepShot(page, dir, "signed-in");
  const slug = await createCompany(page, name);
  await stepShot(page, dir, "company-created");
  await fillWizard(page, project);
  await stepShot(page, dir, "wizard-summary");
  await approveWizard(page, slug);
  await stepShot(page, dir, "home-approved");
  return slug;
}

/** The six onboarding tasks settle; market report, personas, competitor map and PRD are done. */
async function settleTasks(page: Page, dir: string, slug: string): Promise<void> {
  const rows = await waitForTasks(page, slug, { statuses: ["done", "failed"], timeoutMs: TASKS_TIMEOUT_MS });
  const notDone = REQUIRED_DONE.filter((type) => !rows.some((row) => row.taskType === type && row.status === "done"));
  expect(notDone, `onboarding tasks that must be done: ${describeRows(rows)}`).toEqual([]);
  await stepShot(page, dir, "tasks-settled");
}

/** Each required kind has an artifact whose page answers 200 to the signed-in founder; the market report renders. */
async function openArtifacts(page: Page, dir: string, slug: string): Promise<void> {
  await page.goto(`/c/${slug}/artifacts`);
  const hrefs: string[] = [];
  for (const kind of REQUIRED_DONE) {
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: kind.replace(/_/g, " "), exact: true }) });
    const link = section.getByTestId("artifact-link").first();
    await expect(link, `an artifact link for ${kind}`).toHaveAttribute("href", new RegExp(`^/c/${slug}/artifacts/`));
    const href = (await link.getAttribute("href")) ?? "";
    const res = await page.request.get(href);
    expect(res.status(), `${kind} artifact page`).toBe(200);
    hrefs.push(href);
  }
  await page.goto(hrefs[0] ?? `/c/${slug}/artifacts`);
  await expect(page.getByTestId("artifact-markdown")).toBeVisible();
  await stepShot(page, dir, "artifact");
}

/** The home shows "This week" and, once the Chief of Staff has written it, the first plan's tasks. */
async function weeklyPlan(page: Page, dir: string, slug: string): Promise<void> {
  await page.goto(`/c/${slug}`);
  await expect(page.getByRole("heading", { name: "This week" })).toBeVisible();
  await pollReload(page, async () => (await page.getByTestId("week-tasks").count()) > 0, { timeoutMs: PLAN_TIMEOUT_MS, label: "the first weekly plan" });
  await stepShot(page, dir, "weekly-plan");
}

/** What `url` answers to a request context of its own: the staging bypass header never travels to the test project. */
async function statusOutside(url: string): Promise<number> {
  const context = await request.newContext();
  try {
    return (await context.get(url, { maxRedirects: 5 })).status();
  } finally {
    await context.dispose();
  }
}

/** When the plan builds a site: the go-live card (K2) opens and its preview is a fenced `e2e-` deployment answering 200. */
async function goLive(page: Page, dir: string, slug: string): Promise<string> {
  const planned = await page.locator('[data-testid="week-tasks"] [data-testid="task-row"][data-task-type="build_site"]').count();
  if (planned === 0) return "not planned";
  const cards = cardOfKind(page, GO_LIVE_KIND);
  await pollReload(page, async () => (await cards.count()) > 0, { timeoutMs: GO_LIVE_TIMEOUT_MS, label: "the go-live card" });
  await expect(cards.first()).toContainText("K2");
  await stepShot(page, dir, "go-live-card");
  const cardId = (await cards.first().getAttribute("data-card-id")) ?? "";
  await page.goto(`/c/${slug}/decisions/${cardId}`);
  const previewLink = page.getByTestId("decision-preview").getByRole("link");
  await expect(previewLink).toHaveAttribute("href", /^https:\/\//);
  const previewUrl = (await previewLink.getAttribute("href")) ?? "";
  expect(isFencedPreview(previewUrl), `the preview ${new URL(previewUrl).hostname} is an e2e- deployment`).toBe(true);
  expect(await statusOutside(previewUrl), `the preview ${previewUrl}`).toBe(200);
  return "planned: go-live card open, preview answered 200";
}

/** When a campaign draft card is open: it is K2 with a cost; the acceptance answers it with one tap (DEC-2). */
async function campaignCard(page: Page, dir: string, slug: string, variant: Variant): Promise<string> {
  await page.goto(`/c/${slug}`);
  const cards = cardOfKind(page, CAMPAIGN_KIND);
  if ((await cards.count()) === 0) return "absent";
  const cardId = (await cards.first().getAttribute("data-card-id")) ?? "";
  const card = page.locator(`[data-testid="decision-card"][data-card-id="${cardId}"]`);
  await expect(card).toContainText("K2");
  await expect(card, "the campaign card names a cost").toContainText(/\$\d/);
  await stepShot(page, dir, "campaign-card");
  if (variant === "nightly") return "present: not answered (nightly)";
  await card.getByTestId(`answer-${CAMPAIGN_ANSWER.id}`).click();
  await expect(card.getByTestId("card-answered")).toContainText(CAMPAIGN_ANSWER.label, { timeout: ANSWER_LATENCY_MS });
  await stepShot(page, dir, "campaign-answered");
  return `answered: ${CAMPAIGN_ANSWER.id}`;
}

/** The kill switch: "Resume agents" and the paused banner show within 5 s; returns how long it took. */
async function killSwitch(page: Page, dir: string, slug: string): Promise<number> {
  await page.goto(`/c/${slug}`);
  const button = page.getByTestId("kill-switch");
  await expect(button).toHaveText("Stop all agents");
  await button.click();
  const ms = await assertWithin(
    KILL_SWITCH_MS,
    async () => {
      await expect(button).toHaveText("Resume agents", { timeout: KILL_SWITCH_MS });
      await expect(page.locator('[role="status"][data-paused-reason]')).toContainText("All agents are stopped", { timeout: KILL_SWITCH_MS });
    },
    "the paused state",
  );
  await stepShot(page, dir, "kill-switch");
  return ms;
}

/** After a failed step: press the kill switch through the UI so the company spends nothing more (best effort). */
async function stopAgents(page: Page, slug: string): Promise<void> {
  await page.goto(`/c/${slug}`);
  const button = page.getByTestId("kill-switch");
  if ((await button.textContent({ timeout: 10_000 }))?.includes("Stop all agents")) await button.click();
}

/** Every step, in order; each is a `test.step`, so a failure names it. */
async function runJourney(page: Page, testInfo: TestInfo, variant: Variant): Promise<void> {
  const env = stagingEnv();
  const dir = evidenceDir(evidenceDate(process.env, new Date()));
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  const email = e2eAddress(stamp, project, env.mailDomain);
  const slug = await test.step("sign in by magic link, create the company, run the wizard", () => onboard(page, dir, email, project, `E2E Journey ${stamp} ${project}`));
  await writeJourneyNotes(dir, { variant, slug, outcome: "running" });
  try {
    await test.step("the six onboarding tasks settle within 25 min", () => settleTasks(page, dir, slug));
    await test.step("the research and PRD artifacts open", () => openArtifacts(page, dir, slug));
    await test.step("the first weekly plan", () => weeklyPlan(page, dir, slug));
    const build = await test.step("build: the go-live card and its preview", () => goLive(page, dir, slug));
    const campaign = await test.step("the campaign draft card", () => campaignCard(page, dir, slug, variant));
    const killSwitchMs = await test.step("the kill switch pauses within 5 s", () => killSwitch(page, dir, slug));
    await writeJourneyNotes(dir, { variant, slug, outcome: "passed", build, campaign, killSwitchMs });
  } catch (error) {
    await writeJourneyNotes(dir, { variant, slug, outcome: "failed" }).catch(() => undefined);
    await stopAgents(page, slug).catch(() => undefined);
    throw error;
  }
}

test.describe("live journey (nightly)", () => {
  requireStagingEnv();

  test("TST-3: sign-up to kill switch on staging", async ({ page }, testInfo) => {
    await runJourney(page, testInfo, "nightly");
  });
});

test.describe("live journey (acceptance)", { tag: "@live", annotation: { type: "variant", description: "acceptance: answers the campaign draft card in the UI (DEC-2)" } }, () => {
  requireStagingEnv();

  test("TST-4: sign-up to kill switch on staging, the campaign card answered (DEC-2)", async ({ page }, testInfo) => {
    await runJourney(page, testInfo, "acceptance");
  });
});
