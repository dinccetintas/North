import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { approveWizard, createCompany, fillWizard } from "../flows";
import {
  assertWithin,
  evidenceDir,
  openOnStaging,
  pollReload,
  requireStagingEnv,
  scopeBypassToStaging,
  signInLive,
  stagingEnv,
  statusOutside,
  stepShot,
  waitForTasks,
  writeJourneyNotes,
  type JourneyNotes,
} from "./helpers";
import { describeRows, e2eAddress, evidenceDate, isFencedPreview, REQUIRED_DONE, STEP_BUDGET_MS } from "./staging-env";

/**
 * TST-3, TST-4, DEC-2: the founder's journey on the deployed staging, driven
 * through the real UI only (no test answers a card or writes a row through a
 * back door). A fresh `e2e-<stamp>-<project>@<E2E_MAIL_DOMAIN>` signs in by a
 * magic link read from Resend's receiving API (its origin checked against the
 * Supabase project), creates a company, runs the onboarding wizard, waits for
 * the six onboarding tasks to settle on real Claude, opens the research and
 * product artifacts, waits for the first weekly plan, checks the go-live
 * card's preview when the plan builds a site, waits for the campaign draft
 * card when the plan holds a `campaign_spec` and presses the kill switch
 * (paused within 5 s). Each step leaves a screenshot per viewport in
 * `docs/evidence/M7/acceptance/<date>/`, plus `journey-<project>.json`.
 *
 * Two variants share every step: the nightly (`pnpm e2e:staging`,
 * `--grep-invert @live`) leaves the campaign card open; the acceptance
 * (`pnpm e2e:live`, `--grep @live`) answers it in the UI and fails when a
 * planned campaign never opens its card. Without staging (`E2E_BASE_URL`
 * unset) every journey is skipped with the reason; costs are read afterwards
 * by `pnpm evidence:costs`, never through the UI. The Vercel bypass header
 * goes to the staging origin only (`scopeBypassToStaging`, below).
 */

const KILL_SWITCH_MS = 5_000;
/** DEC-2: an answer shows on the card within two seconds of the tap. */
const ANSWER_LATENCY_MS = 2_000;
const GO_LIVE_KIND = "deploy.production";
const CAMPAIGN_KIND = "ads.start";
/** The acceptance proves the one-tap answer with the card's safe default: nothing starts delivering; approving is the founder's own call. */
const CAMPAIGN_ANSWER = { id: "decline", label: "Decline" } as const;
const minutes = (ms: number): number => Math.round(ms / 60_000);

type Variant = JourneyNotes["variant"];

const cardOfKind = (page: Page, kind: string) => page.locator(`[data-testid="decision-card"][data-action-kind="${kind}"]`);
const plannedTask = (page: Page, taskType: string) => page.locator(`[data-testid="week-tasks"] [data-testid="task-row"][data-task-type="${taskType}"]`);
const remaining = (deadline: number): number => Math.max(0, deadline - Date.now());

/** Sign-in by magic link, the company, the wizard and its approval; returns the slug. */
async function onboard(page: Page, dir: string, email: string, project: string, name: string): Promise<string> {
  await signInLive(page, email);
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
  const rows = await waitForTasks(page, slug, { statuses: ["done", "failed"], timeoutMs: STEP_BUDGET_MS.tasks });
  const notDone = REQUIRED_DONE.filter((type) => !rows.some((row) => row.taskType === type && row.status === "done"));
  expect(notDone, `onboarding tasks that must be done: ${describeRows(rows)}`).toEqual([]);
  await stepShot(page, dir, "tasks-settled");
}

/** Each required kind has an artifact whose page opens in the browser with 200 and stays there (a login bounce is not an artifact). */
async function openArtifacts(page: Page, dir: string, slug: string, baseUrl: string): Promise<void> {
  await page.goto(`/c/${slug}/artifacts`);
  const hrefs: string[] = [];
  for (const kind of REQUIRED_DONE) {
    const section = page.locator("section").filter({ has: page.getByRole("heading", { name: kind.replace(/_/g, " "), exact: true }) });
    const link = section.getByTestId("artifact-link").first();
    await expect(link, `an artifact link for ${kind}`).toHaveAttribute("href", new RegExp(`^/c/${slug}/artifacts/`));
    hrefs.push((await link.getAttribute("href")) ?? "");
  }
  for (const [i, href] of hrefs.entries()) {
    const answer = await openOnStaging(page, href);
    expect(answer.status, `${REQUIRED_DONE[i]} artifact page`).toBe(200);
    expect(new URL(answer.url).origin, `${REQUIRED_DONE[i]} stayed on staging`).toBe(new URL(baseUrl).origin);
    expect(new URL(answer.url).pathname, `${REQUIRED_DONE[i]} stayed on its page`).toBe(href);
    await expect(page.getByTestId("artifact-markdown")).toBeVisible();
    if (i === 0) await stepShot(page, dir, "artifact");
  }
}

/** The home shows the first plan's tasks once the Chief of Staff has written it. */
async function weeklyPlan(page: Page, dir: string, slug: string): Promise<void> {
  await page.goto(`/c/${slug}`);
  await pollReload(page, async () => (await page.getByTestId("week-tasks").count()) > 0, { timeoutMs: STEP_BUDGET_MS.plan, label: "the first weekly plan" });
  await stepShot(page, dir, "weekly-plan");
}

/** When the plan builds a site: the go-live card (K2) opens by `deadline` and its preview is a fenced `e2e-` deployment answering 200 itself. */
async function goLive(page: Page, dir: string, slug: string, deadline: number): Promise<string> {
  await page.goto(`/c/${slug}`);
  if ((await plannedTask(page, "build_site").count()) === 0) return "not planned";
  const cards = cardOfKind(page, GO_LIVE_KIND);
  await pollReload(page, async () => (await cards.count()) > 0, { timeoutMs: remaining(deadline), label: "the go-live card" });
  await expect(cards.first()).toContainText("K2");
  await stepShot(page, dir, "go-live-card");
  const cardId = (await cards.first().getAttribute("data-card-id")) ?? "";
  await page.goto(`/c/${slug}/decisions/${cardId}`);
  const previewLink = page.getByTestId("decision-preview").getByRole("link");
  await expect(previewLink).toHaveAttribute("href", /^https:\/\//);
  const previewUrl = (await previewLink.getAttribute("href")) ?? "";
  const host = new URL(previewUrl).host;
  expect(isFencedPreview(previewUrl), `the preview ${host} is an e2e- deployment`).toBe(true);
  const answer = await statusOutside(previewUrl);
  expect(answer.status, `the preview ${host} (no redirect followed)`).toBe(200);
  expect(new URL(answer.url).host, "the preview answered on its own host").toBe(host);
  return "planned: go-live card open, preview answered 200";
}

/** Waits for the campaign card when `campaign_spec` is planned; `absent` only when it is not; a planned card that never opens fails the acceptance. */
async function awaitCampaignCard(page: Page, slug: string, variant: Variant, deadline: number): Promise<string | null> {
  await page.goto(`/c/${slug}`);
  const cards = cardOfKind(page, CAMPAIGN_KIND);
  if ((await plannedTask(page, "campaign_spec").count()) === 0) return (await cards.count()) === 0 ? "absent: campaign_spec not planned" : null;
  const opened = await pollReload(page, async () => (await cards.count()) > 0, { timeoutMs: remaining(deadline), label: "the campaign draft card (campaign_spec is planned)" }).then(
    () => true,
    (error: unknown) => {
      if (variant === "acceptance") throw error;
      return false;
    },
  );
  return opened ? null : "planned: no card by the deadline (nightly)";
}

/** When a campaign draft card is open: it is K2 with a cost; the acceptance answers it with one tap (DEC-2). */
async function campaignCard(page: Page, dir: string, slug: string, variant: Variant, deadline: number): Promise<string> {
  const note = await awaitCampaignCard(page, slug, variant, deadline);
  if (note !== null) return note;
  const cardId = (await cardOfKind(page, CAMPAIGN_KIND).first().getAttribute("data-card-id")) ?? "";
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

/** The kill switch: from the click, "Resume agents" and the paused banner show within 5 s; returns how long it took. */
async function killSwitch(page: Page, dir: string, slug: string): Promise<number> {
  await page.goto(`/c/${slug}`);
  const button = page.getByTestId("kill-switch");
  await expect(button).toHaveText("Stop all agents");
  const ms = await assertWithin(
    KILL_SWITCH_MS,
    async () => {
      await button.click({ timeout: KILL_SWITCH_MS });
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

/** Every step, in order; each is a `test.step`, so a failure names it, and each wait ends before the test timeout. */
async function runJourney(page: Page, testInfo: TestInfo, variant: Variant): Promise<void> {
  const env = stagingEnv();
  const dir = evidenceDir(evidenceDate(process.env, new Date()));
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  const email = e2eAddress(stamp, project, env.mailDomain);
  const slug = await test.step("sign in by magic link, create the company, run the wizard", () => onboard(page, dir, email, project, `E2E Journey ${stamp} ${project}`));
  await writeJourneyNotes(dir, { variant, slug, outcome: "running" });
  try {
    await test.step(`the six onboarding tasks settle within ${minutes(STEP_BUDGET_MS.tasks)} min`, () => settleTasks(page, dir, slug));
    await test.step("the research and PRD artifacts open", () => openArtifacts(page, dir, slug, env.baseUrl));
    await test.step(`the first weekly plan within ${minutes(STEP_BUDGET_MS.plan)} min`, () => weeklyPlan(page, dir, slug));
    const cardsDeadline = Date.now() + STEP_BUDGET_MS.plannedCards;
    const build = await test.step("build: the go-live card and its preview", () => goLive(page, dir, slug, cardsDeadline));
    const campaign = await test.step("the campaign draft card", () => campaignCard(page, dir, slug, variant, cardsDeadline));
    const killSwitchMs = await test.step("the kill switch pauses within 5 s", () => killSwitch(page, dir, slug));
    await writeJourneyNotes(dir, { variant, slug, outcome: "passed", build, campaign, killSwitchMs });
  } catch (error) {
    await writeJourneyNotes(dir, { variant, slug, outcome: "failed" }).catch(() => undefined);
    await stopAgents(page, slug).catch(() => undefined);
    throw error;
  }
}

/** Both variants: the bypass header on the staging origin only (never a context option, never to Supabase, Sentry or a preview). */
test.beforeEach(async ({ context }) => {
  await scopeBypassToStaging(context);
});

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
