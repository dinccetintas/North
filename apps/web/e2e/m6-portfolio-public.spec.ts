import { existsSync, readFileSync, statSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { approveWizard, createCompany, fillWizard, POLL_INTERVAL_MS, secondCompany, signIn, WORKER_TIMEOUT_MS } from "./flows";
import { companyIdBySlug, generateBrief, localDayFor } from "./stack";
import { grantPlan, userIdByEmail } from "./stack-m6";

/**
 * M6 acceptance, portfolio and public page (docs/plans/M6.md, MULTI-1,
 * PUB-1): one portfolio brief across two companies composed from today's
 * briefs only, and a public page that shows the owner's choice as text to a
 * stranger, `noindex` until listed, 404 when off. Needs the worker (mock
 * runtime) and the Inngest dev server for the briefs.
 */

const EVIDENCE_DIR = "../../docs/evidence/M6";
const PORTFOLIO_MAX_WORDS = 300;
const HEADLINE = "Bookkeeping that <b>closes</b> the month";
/** PostgREST's log of the local stack; it carries request lines when the stack runs it at info level. */
const POSTGREST_LOG = "../../.stack/logs/postgrest.log";

const shot = (page: Page, name: string, project: string) => page.screenshot({ path: `${EVIDENCE_DIR}/${name}-${project}.png`, fullPage: true });
const logSize = (): number => (existsSync(POSTGREST_LOG) ? statSync(POSTGREST_LOG).size : 0);
const logSince = (offset: number): string => (existsSync(POSTGREST_LOG) ? readFileSync(POSTGREST_LOG, "utf8").slice(offset) : "");

test("M6 portfolio and public page: one brief across companies, a text-only public page, noindex, 404 when off", async ({ page, browser }, testInfo) => {
  test.setTimeout(420_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  const email = `founder-${stamp}p-${project}@north.test`;

  // The trial allows one company: this spec needs two, so the owner is put on Pro first (service role).
  await signIn(page, email);
  await grantPlan(await userIdByEmail(email), "pro");
  await page.goto("/companies");
  const slug1 = await createCompany(page, `Ledger Co ${stamp} ${project}`);
  await fillWizard(page, project);
  await approveWizard(page, slug1);
  const slug2 = await secondCompany(page, project, `Ops Co ${stamp} ${project}`);

  // MULTI-1: today's brief for both companies, then one portfolio brief composed from those rows only.
  const day = localDayFor("UTC");
  for (const slug of [slug1, slug2]) await generateBrief(await companyIdBySlug(slug), day);
  const logOffset = logSize();
  await page.goto("/companies");
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByTestId("portfolio-company").count();
      },
      { timeout: WORKER_TIMEOUT_MS, intervals: [POLL_INTERVAL_MS] },
    )
    .toBe(2);
  const portfolio = page.getByTestId("portfolio-brief");
  await expect(portfolio.getByTestId("portfolio-day")).toHaveText(day);
  await expect(portfolio.getByTestId("portfolio-totals")).toContainText("across 2 companies");
  expect(Number(await portfolio.getByTestId("portfolio-words").getAttribute("data-words"))).toBeLessThanOrEqual(PORTFOLIO_MAX_WORDS);
  for (const id of await Promise.all([slug1, slug2].map(companyIdBySlug))) await expect(portfolio.locator(`[data-testid="portfolio-company"][data-company-id="${id}"]`)).toHaveCount(1);
  await expect(page.getByTestId("company-row")).toHaveCount(2);
  await shot(page, "portfolio", project);
  // No memory read on the way (MULTI-1); meaningful when the stack logs requests, and never a false pass otherwise.
  expect(logSince(logOffset)).not.toContain("memory_items");

  // PUB-1: the owner's form; the headline carries a literal <b> that must stay text.
  await page.goto(`/c/${slug1}/public`);
  await page.getByTestId("public-enabled").check();
  await page.getByTestId("public-headline-input").fill(HEADLINE);
  await page.getByTestId("public-blurb-input").fill("Monthly close for one-person firms, done by agents, decided by you.");
  await page.getByTestId("public-show-goal").check();
  await page.getByTestId("public-metric-signups").check();
  await expect(page.getByTestId("public-listed")).not.toBeChecked();
  await page.getByTestId("public-save").click();
  await expect(page.getByTestId("public-saved")).toBeVisible();
  await expect(page.getByTestId("public-state")).toHaveAttribute("data-public", "true");

  // A stranger with no session reads the page: text only, the chosen goal and metric, no link into the app, noindex.
  const stranger = await browser.newContext();
  const anon = await stranger.newPage();
  const response = await anon.goto(`/p/${slug1}`);
  expect(response?.status()).toBe(200);
  await expect(anon.getByTestId("public-headline")).toHaveText(HEADLINE);
  await expect(anon.getByTestId("public-headline").locator("b")).toHaveCount(0);
  await expect(anon.getByTestId("public-goal")).toBeVisible();
  const metricKeys = await anon.getByTestId("public-metric").evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-key")));
  expect(metricKeys.every((key) => key === "signups")).toBe(true);
  const hrefs = await anon.locator("a[href]").evaluateAll((links) => links.map((a) => a.getAttribute("href") ?? ""));
  for (const href of hrefs) expect(href.startsWith("/legal/") || href.startsWith("https://")).toBe(true);
  await expect(anon.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(anon.getByTestId("footer-terms")).toBeVisible();
  await shot(anon, "public-page", project);

  // Company 2 never turned its page on; turning company 1 off removes it now (the save revalidates the route).
  expect((await anon.goto(`/p/${slug2}`))?.status()).toBe(404);
  await page.goto(`/c/${slug1}/public`);
  await page.getByTestId("public-enabled").uncheck();
  await page.getByTestId("public-save").click();
  await expect(page.getByTestId("public-state")).toHaveAttribute("data-public", "false");
  expect((await anon.goto(`/p/${slug1}`))?.status()).toBe(404);
  await stranger.close();
});
