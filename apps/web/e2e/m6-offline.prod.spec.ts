import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { onboardedCompany, POLL_INTERVAL_MS, WORKER_TIMEOUT_MS } from "./flows";
import { companyIdBySlug, generateBrief, localDayFor } from "./stack";
import { userIdByEmail } from "./stack-m6";

/**
 * M6 acceptance, the offline brief (docs/plans/M6.md, PWA-1), against a
 * production build (`playwright.prod.config.ts`): the home hands today's
 * brief to the service worker; with the network gone for the page and for
 * the worker itself, a company path and a card path both show the offline
 * page with that brief, and never a card. The copy is the signed-in user's
 * (`/brief/<userId>/<slug>`) and goes when the session does (M6 review L14):
 * a navigation to /login clears it, and so does signing out.
 */

const EVIDENCE_DIR = "../../docs/evidence/M6";
const SW_TIMEOUT_MS = 30_000;

const shot = (page: Page, name: string, project: string) => page.screenshot({ path: `${EVIDENCE_DIR}/${name}-${project}.png`, fullPage: true });

const cached = (page: Page, cacheName: string, key: string) =>
  page.evaluate(async ([name, k]) => Boolean(await (await caches.open(name)).match(k)), [cacheName, key] as const);

/** Every key of the brief cache, as paths. */
const briefKeys = (page: Page) => page.evaluate(async () => (await (await caches.open("north-brief-v1")).keys()).map((r) => new URL(r.url).pathname).sort());

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
  const userId = await userIdByEmail(`founder-${stamp}o-${project}@north.test`);

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
  await expect.poll(() => cached(page, "north-brief-v1", `/brief/${userId}/${slug}`), { timeout: SW_TIMEOUT_MS }).toBe(true);
  expect(await briefKeys(page)).toEqual([`/brief/${userId}/${slug}`, "/brief/last-user"].sort());
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

  // M6 review L14: a navigation to /login means no session here; the worker deletes the copy (a signed-in visitor is sent on to /companies).
  await page.goto("/login");
  await expect(page).toHaveURL(/\/companies/);
  await expect.poll(() => briefKeys(page), { timeout: SW_TIMEOUT_MS }).toEqual([]);

  // The home keeps it again; signing out deletes it, and /offline (public) shows nothing of the account.
  await page.goto(`/c/${slug}`);
  await expect(page.getByTestId("brief")).toBeVisible();
  await expect.poll(() => cached(page, "north-brief-v1", `/brief/${userId}/${slug}`), { timeout: SW_TIMEOUT_MS }).toBe(true);
  await page.getByTestId("sign-out").click();
  await expect(page).not.toHaveURL(/\/c\//);
  await expect.poll(() => briefKeys(page), { timeout: SW_TIMEOUT_MS }).toEqual([]);
  await page.goto("/offline");
  await expect(page.getByTestId("offline-brief-empty")).toBeVisible();
  await expect(page.getByTestId("offline-brief")).toHaveCount(0);
});
