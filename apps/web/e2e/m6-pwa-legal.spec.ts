import { expect, test, type Page } from "@playwright/test";
import { onboardedCompany, POLL_INTERVAL_MS, WORKER_TIMEOUT_MS } from "./flows";
import { companyIdBySlug, generateBrief, localDayFor } from "./stack";
import { enablePublicPage, manifestOf } from "./stack-m6";

/**
 * M6 acceptance, PWA, settings and legal (docs/plans/M6.md, PWA-1, BRF-1,
 * LEG-1): the manifest validates and the service worker controls the page;
 * offline, a company path shows the offline page with the latest brief and
 * never a card; the install bar can be dismissed for good; the brief hour
 * saves; the three legal drafts render with their banner and the footer is
 * on the login and the public page. Needs the worker for the brief.
 */

const EVIDENCE_DIR = "../../docs/evidence/M6";
const SW_TIMEOUT_MS = 30_000;

const shot = (page: Page, name: string, project: string) => page.screenshot({ path: `${EVIDENCE_DIR}/${name}-${project}.png`, fullPage: true });

const cached = (page: Page, cacheName: string, key: string) =>
  page.evaluate(async ([name, k]) => Boolean(await (await caches.open(name)).match(k)), [cacheName, key] as const);

/** What Chromium fires when the app is installable; the test stands in for the browser. */
const dispatchInstallPrompt = (page: Page) =>
  page.evaluate(() => {
    const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
      prompt: async () => undefined,
      userChoice: Promise.resolve({ outcome: "dismissed" as const }),
    });
    window.dispatchEvent(event);
  });

test("M6 PWA, settings and legal: manifest, service worker, offline brief, install bar, brief hour, legal drafts", async ({ page, browser, context }, testInfo) => {
  test.setTimeout(300_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  const slug = await onboardedCompany(page, project, `${stamp}w`, `Offline Co ${stamp} ${project}`);
  const companyId = await companyIdBySlug(slug);

  // PWA-1: the manifest is installable and the worker controls the page after a reload.
  const manifest = await manifestOf(page);
  expect(manifest).toMatchObject({ name: "North", start_url: "/companies", display: "standalone" });
  const sizes = manifest.icons.map((i) => `${i.sizes}:${i.purpose ?? "any"}`);
  expect(sizes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
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

  // Offline: a company path is the offline page with the latest brief; a card path too, never a stale card.
  await context.setOffline(true);
  await page.goto(`/c/${slug}`);
  await expect(page.getByTestId("offline-page")).toBeVisible();
  await expect(page.getByTestId("offline-brief")).toHaveAttribute("data-brief-date", day);
  await expect(page.getByTestId("offline-brief").getByTestId("brief-headline")).toHaveText(headline);
  await shot(page, "offline-brief", project);
  await page.goto(`/c/${slug}/decisions/00000000-0000-4000-8000-000000000000`);
  await expect(page.getByTestId("offline-page")).toBeVisible();
  await expect(page.getByTestId("decision-card")).toHaveCount(0);
  await context.setOffline(false);

  // The install bar shows when the browser says the app is installable, and stays dismissed.
  await page.goto("/companies");
  await dispatchInstallPrompt(page);
  await expect(page.getByTestId("install-prompt")).toBeVisible();
  await expect(page.getByTestId("install-accept")).toBeVisible();
  await shot(page, "install-prompt", project);
  await page.getByTestId("install-dismiss").click();
  await expect(page.getByTestId("install-prompt")).toHaveCount(0);
  await page.reload();
  await dispatchInstallPrompt(page);
  await expect(page.getByTestId("install-prompt")).toHaveCount(0);

  // BRF-1: the brief hour is the owner's.
  await page.goto("/settings");
  await expect(page.getByText("Your brief arrives at this hour in your time zone")).toBeVisible();
  await page.getByTestId("settings-brief-hour").selectOption("9");
  await page.getByTestId("settings-save").click();
  await expect(page.getByTestId("settings-saved")).toBeVisible();
  await expect(page.getByTestId("settings-brief-hour")).toHaveValue("9");

  // LEG-1: three drafts with the banner; the footer on the login and on the public page (both without a session).
  for (const doc of ["terms", "privacy", "acceptable-use"]) {
    await page.goto(`/legal/${doc}`);
    await expect(page.getByTestId("legal-doc")).toHaveAttribute("data-doc", doc);
    await expect(page.getByTestId("legal-draft-banner")).toBeVisible();
  }
  await shot(page, "legal-acceptable-use", project);
  expect((await page.goto("/legal/unknown"))?.status()).toBe(404);

  await enablePublicPage(companyId, { headline: "A public line", blurb: "", showGoal: false, metricKeys: [], showSiteLink: false, listed: false });
  const stranger = await browser.newContext();
  const anon = await stranger.newPage();
  await anon.goto("/login");
  for (const id of ["footer-terms", "footer-privacy", "footer-acceptable-use"]) await expect(anon.getByTestId(id)).toBeVisible();
  await anon.goto(`/p/${slug}`);
  await expect(anon.getByTestId("public-headline")).toHaveText("A public line");
  await expect(anon.getByTestId("footer-terms")).toHaveAttribute("href", "/legal/terms");
  await stranger.close();
});
