import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { onboardedCompany, POLL_INTERVAL_MS, WORKER_TIMEOUT_MS } from "./flows";
import { companyIdBySlug, generateBrief, localDayFor } from "./stack";

/**
 * M6 acceptance, the offline brief (docs/plans/M6.md, PWA-1), against a
 * production build (`playwright.prod.config.ts`): the home hands today's
 * brief to the service worker; with the network gone for the page and for
 * the worker itself, a company path and a card path both show the offline
 * page with that brief, and never a card.
 */

const EVIDENCE_DIR = "../../docs/evidence/M6";
const SW_TIMEOUT_MS = 30_000;

const shot = (page: Page, name: string, project: string) => page.screenshot({ path: `${EVIDENCE_DIR}/${name}-${project}.png`, fullPage: true });

const cached = (page: Page, cacheName: string, key: string) =>
  page.evaluate(async ([name, k]) => Boolean(await (await caches.open(name)).match(k)), [cacheName, key] as const);

/** Offline for the page and for the service worker's own fetches (the config turns service-worker routing on). */
async function goOffline(context: BrowserContext): Promise<void> {
  await context.setOffline(true);
  await context.route("**/*", (route) => route.abort("internetdisconnected"));
}

async function goOnline(context: BrowserContext): Promise<void> {
  await context.unrouteAll({ behavior: "ignoreErrors" });
  await context.setOffline(false);
}

test("M6 offline brief: a company path and a card path show the latest brief, never a card", async ({ page, context }, testInfo) => {
  test.setTimeout(300_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  const slug = await onboardedCompany(page, project, `${stamp}o`, `Offline Co ${stamp} ${project}`);
  const companyId = await companyIdBySlug(slug);

  // The worker controls the page after a reload.
  expect(await page.evaluate(async () => Boolean((await navigator.serviceWorker.ready).active))).toBe(true);
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null), { timeout: SW_TIMEOUT_MS }).toBe(true);

  // The home shows today's brief; the page hands it to the worker, which keeps it for offline reading.
  const day = localDayFor("UTC");
  await generateBrief(companyId, day);
  await page.goto(`/c/${slug}`);
  await expect
    .poll(
      async () => {
        await page.reload();
        return page.getByTestId("brief").count();
      },
      { timeout: WORKER_TIMEOUT_MS, intervals: [POLL_INTERVAL_MS] },
    )
    .toBe(1);
  const headline = (await page.getByTestId("brief").getByTestId("brief-headline").textContent()) ?? "";
  await expect.poll(() => cached(page, "north-brief-v1", `/brief/${slug}`), { timeout: SW_TIMEOUT_MS }).toBe(true);
  await expect.poll(() => cached(page, "north-static-v1", "/offline"), { timeout: SW_TIMEOUT_MS }).toBe(true);

  await goOffline(context);
  await page.goto(`/c/${slug}`);
  await expect(page.getByTestId("offline-page")).toBeVisible();
  await expect(page.getByTestId("offline-brief")).toHaveAttribute("data-brief-date", day);
  await expect(page.getByTestId("offline-brief").getByTestId("brief-headline")).toHaveText(headline);
  await shot(page, "offline-brief", project);
  await page.goto(`/c/${slug}/decisions/00000000-0000-4000-8000-000000000000`);
  await expect(page.getByTestId("offline-page")).toBeVisible();
  await expect(page.getByTestId("decision-card")).toHaveCount(0);
  await goOnline(context);

  // Back online, the company path is the live page again.
  await page.goto(`/c/${slug}`);
  await expect(page.getByTestId("offline-page")).toHaveCount(0);
  await expect(page.getByTestId("brief")).toBeVisible();
});
