import { expect, test, type Locator, type Page } from "@playwright/test";
import { onboardedCompany, POLL_INTERVAL_MS, WORKER_TIMEOUT_MS } from "./flows";
import {
  campaignsFor,
  collectMetrics,
  companyIdBySlug,
  insertCampaignSpecTask,
  insertLeads,
  insertOutreachBatchTask,
  sendInngestEvent,
  sentMessageIds,
  setBudget,
  setSenderIdentity,
  simulateAdSpend,
  simulateReply,
} from "./stack";

/**
 * M4 acceptance (docs/plans/M4.md): a campaign card → an active campaign →
 * spend and sign-ups in the ledger with provenance → the 11th dollar pauses
 * the campaign and opens a cap card that defaults to decline (BUD-1/3,
 * OUT-1/2); five leads → one card → five sends → replies as a metric
 * (SLS-K2); Meta Ads and Gmail connect in sandbox (ONB-3). Needs the worker
 * (AGENT_RUNTIME=mock, INTEGRATIONS_MODE=sandbox) and the Inngest dev server.
 */

const ANSWER_LATENCY_MS = 2_000;
const EVIDENCE_DIR = "../../docs/evidence/M4";
/** CMP-1 is an M7 requirement: its screenshots go to the M7 folder. */
const M7_EVIDENCE_DIR = "../../docs/evidence/M7";

const shot = (page: Page, name: string, project: string, dir = EVIDENCE_DIR) => page.screenshot({ path: `${dir}/${name}-${project}.png`, fullPage: true });

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
const campaignRow = (page: Page, status: string) => page.locator(`[data-testid="campaign-row"][data-status="${status}"]`);
const ledgerEntries = (page: Page, channel: string) => page.locator(`[data-testid="ledger-entry"][data-channel="${channel}"]`);
const actionRows = (page: Page, kind: string, status: string) => page.locator(`[data-testid="action-row"][data-kind="${kind}"][data-status="${status}"]`);
const adsBudget = (page: Page) => page.locator('[data-testid="budget-row"][data-category="ads"]');

/** One delivery window plus a collection, then the ledger reloaded until `n` meta_ads entries show. */
async function deliverAndCollect(page: Page, slug: string, providerCampaignId: string, spendUsd: number, expectEntries: number): Promise<void> {
  await simulateAdSpend(providerCampaignId, { spendUsd, impressions: 800, clicks: 12, conversions: 1 });
  await collectMetrics(await companyIdBySlug(slug));
  await page.goto(`/c/${slug}/ledger`);
  await pollCount(page, ledgerEntries(page, "meta_ads"), expectEntries);
}

test("M4 growth: card → campaign → spend in the ledger → the 11th dollar pauses and asks", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  const slug = await onboardedCompany(page, project, `${stamp}g`, `Growth Co ${stamp} ${project}`);
  const companyId = await companyIdBySlug(slug);
  await setBudget(companyId, "ads", { daily: 10, total: 100 });

  // A $10/day campaign under a $10 daily cap is K2 for spending, not for the cap (BUD-1 profile fix).
  const task = await insertCampaignSpecTask(companyId, "Launch test campaign");
  await sendInngestEvent("task/dispatch", { companyId, taskId: task.id });
  await page.goto(`/c/${slug}`);
  await pollCount(page, cardOfKind(page, "ads.start"));
  const card = cardOfKind(page, "ads.start").first();
  await expect(card).toContainText("K2");
  await expect(card).toContainText("$10/day");
  await shot(page, "home-campaign-card", project);
  const cardId = (await card.getAttribute("data-card-id")) ?? "";

  await page.goto(`/c/${slug}/decisions/${cardId}`);
  await expect(page.getByTestId("decision-rationale")).not.toContainText("budget cap");
  await page.getByTestId("answer-approve").click();
  await expect(page.getByTestId("card-answered")).toContainText("Approve", { timeout: ANSWER_LATENCY_MS });

  await page.getByTestId("nav-ledger").click();
  await expect(page).toHaveURL(new RegExp(`/c/${slug}/ledger$`));
  await pollCount(page, campaignRow(page, "active"));
  await expect(page.getByTestId("ledger-export")).toHaveAttribute("href", `/api/companies/${companyId}/ledger.csv`);
  await shot(page, "ledger-campaign-active", project);
  const [campaign] = await campaignsFor(companyId);
  expect(campaign?.providerCampaignId).toMatch(/^sandbox:campaign:/);
  const providerCampaignId = campaign?.providerCampaignId ?? "";

  // $4 → one entry: signups 0 → 1 at a cost of $4, with the window's clicks as provenance.
  await deliverAndCollect(page, slug, providerCampaignId, 4, 1);
  const entry = ledgerEntries(page, "meta_ads").first();
  await expect(entry.getByTestId("entry-cost")).toContainText("$4");
  await expect(entry.getByTestId("entry-delta")).toContainText("+1");
  await expect(entry.getByTestId("entry-provenance")).toContainText("12 clicks");
  await expect(adsBudget(page).getByTestId("budget-spent-today")).toContainText("$4");

  // $4 more → two entries, $8 today, and the channel verdict turns to "working".
  await deliverAndCollect(page, slug, providerCampaignId, 4, 2);
  await expect(adsBudget(page).getByTestId("budget-spent-today")).toContainText("$8");
  await expect(adsBudget(page).getByTestId("budget-state")).toHaveText("ok");
  const channel = page.locator('[data-testid="channel-row"][data-channel="meta_ads"]');
  await expect(channel).toHaveAttribute("data-verdict", "working");
  await expect(channel).toContainText("working");
  await shot(page, "ledger-attribution", project);

  // $3 more → $11 > $10: the campaign is paused for the cap and the cap card opens.
  await deliverAndCollect(page, slug, providerCampaignId, 3, 2);
  await pollCount(page, campaignRow(page, "paused_cap"));
  await expect(adsBudget(page).getByTestId("budget-state")).toHaveText("cap_reached");
  await expect(adsBudget(page).getByTestId("budget-spent-today")).toContainText("$11");
  await shot(page, "ledger-paused", project);

  await page.goto(`/c/${slug}`);
  await pollCount(page, cardOfKind(page, "budget.cap.raise"));
  const capCard = cardOfKind(page, "budget.cap.raise").first();
  await expect(capCard).toContainText("K2");
  await expect(capCard).toContainText("$11 of $10");
  await expect(capCard).toContainText("No answer by the deadline → Decline");
  await shot(page, "home-cap-card", project);
  const capCardId = (await capCard.getAttribute("data-card-id")) ?? "";

  await page.goto(`/c/${slug}/decisions/${capCardId}`);
  expect(campaign?.name).toBeTruthy();
  await expect(page.getByTestId("decision-campaign")).toContainText(campaign?.name ?? "");
  await page.getByTestId("answer-decline").click();
  await expect(page.getByTestId("card-answered")).toContainText("Decline", { timeout: ANSWER_LATENCY_MS });

  // Declined: the campaign stays paused; the stream shows start, pause and the declined raise.
  await page.goto(`/c/${slug}/ledger`);
  await expect(campaignRow(page, "paused_cap")).toHaveCount(1);
  await page.goto(`/c/${slug}/team`);
  await pollCount(page, actionRows(page, "budget.cap.raise", "declined"));
  await expect(actionRows(page, "ads.start", "executed").first()).toBeVisible();
  await expect(actionRows(page, "ads.pause", "notified").first()).toBeVisible();

  // The export carries the same entries: header + one line per entry, as text/csv, with the page's cookies.
  await page.goto(`/c/${slug}/ledger`);
  const href = (await page.getByTestId("ledger-export").getAttribute("href")) ?? "";
  const csv = await page.request.get(href);
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  const lines = (await csv.text()).split(/\r?\n/).filter((line) => line.length > 0);
  expect(lines[0]).toBe("measured_at,channel,metric_key,before,after,delta,cost_usd,task_id");
  expect(lines.length).toBeGreaterThanOrEqual(3);
  expect(lines.slice(1).filter((line) => line.includes(",meta_ads,")).length).toBeGreaterThanOrEqual(2);
});

test("M4 sales: five leads → one card → five sends → replies in the ledger", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  const slug = await onboardedCompany(page, project, `${stamp}s`, `Sales Co ${stamp} ${project}`);
  const companyId = await companyIdBySlug(slug);
  // CMP-1 (M7): first contacts go out only under the company's legal name and postal address.
  await setSenderIdentity(companyId);

  await insertLeads(
    companyId,
    [1, 2, 3, 4, 5].map((i) => ({ name: `Prospect ${i}`, email: `prospect-${i}-${stamp}@example.test`, company: `Agency ${i}`, why: "Runs outbound without a team." })),
  );
  await page.goto(`/c/${slug}/team`);
  await expect(page.getByTestId("leads-section")).toBeVisible();
  await expect(page.getByTestId("leads-count")).toHaveText("5");
  await shot(page, "team-leads", project);

  // One outreach batch → exactly one card for five emails (SLS-K2, DEC-3).
  const task = await insertOutreachBatchTask(companyId, "Outreach batch 1");
  await sendInngestEvent("task/dispatch", { companyId, taskId: task.id });
  await page.goto(`/c/${slug}`);
  await pollCount(page, cardOfKind(page, "email.send.first_contact"));
  await expect(page.getByTestId("decision-card")).toHaveCount(1);
  const card = cardOfKind(page, "email.send.first_contact").first();
  await expect(card).toContainText("5");
  const cardId = (await card.getAttribute("data-card-id")) ?? "";

  await page.goto(`/c/${slug}/decisions/${cardId}`);
  await expect(page.getByTestId("decision-recipients").getByTestId("decision-recipient")).toHaveCount(5);
  await shot(page, "card-detail-batch", project);
  await page.getByTestId("answer-approve").click();
  await expect(page.getByTestId("card-answered")).toContainText("Approve", { timeout: ANSWER_LATENCY_MS });

  // Five sends, each its own action with its own sandbox message id.
  await page.goto(`/c/${slug}/team`);
  await pollCount(page, actionRows(page, "email.send.first_contact", "executed"), 5);
  await expect(actionRows(page, "email.send.first_contact", "executed").first()).toContainText("(sandbox)");

  await page.goto(`/c/${slug}/ledger`);
  await pollCount(page, page.getByTestId("outreach-row"));
  const outreach = page.getByTestId("outreach-row").first();
  await expect(outreach.getByTestId("outreach-sent")).toHaveText("5");
  await expect(outreach.getByTestId("outreach-replies")).toHaveText("0");

  // Two replies → one cold_email entry 0 → 2 at no cost.
  const messageIds = await sentMessageIds(companyId);
  expect(messageIds).toHaveLength(5);
  expect(messageIds[0]).toMatch(/^sandbox:msg:/);
  await simulateReply(messageIds[0] ?? "");
  await simulateReply(messageIds[1] ?? "");
  await collectMetrics(companyId);
  await pollCount(page, ledgerEntries(page, "cold_email"));
  const entry = ledgerEntries(page, "cold_email").first();
  await expect(entry.getByTestId("entry-delta")).toContainText("+2");
  await expect(entry.getByTestId("entry-cost")).toContainText("$0");
  await expect(page.getByTestId("outreach-row").first().getByTestId("outreach-replies")).toHaveText("2");
  await expect(page.locator('[data-testid="channel-row"][data-channel="cold_email"]')).toBeVisible();
  await shot(page, "ledger-replies", project);
});

test("CMP-1 sales: without a sender identity the first contact is blocked; saving it on the Team page unblocks the next batch", async ({ page }, testInfo) => {
  test.setTimeout(300_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  const slug = await onboardedCompany(page, project, `${stamp}c`, `Compliance Co ${stamp} ${project}`);
  const companyId = await companyIdBySlug(slug);
  await insertLeads(
    companyId,
    [1, 2].map((i) => ({ name: `Prospect ${i}`, email: `cmp-${i}-${stamp}@example.test`, company: `Agency ${i}`, why: "Runs outbound without a team." })),
  );

  // No sender identity yet: the gate blocks the first contact, and the Team page's stream says why.
  const first = await insertOutreachBatchTask(companyId, "Outreach batch 1");
  await sendInngestEvent("task/dispatch", { companyId, taskId: first.id });
  await page.goto(`/c/${slug}/team`);
  const blocked = actionRows(page, "email.send.first_contact", "blocked").filter({ has: page.getByTestId("action-blocked-reason").filter({ hasText: "no sender identity" }) });
  await pollCount(page, blocked);
  await shot(page, "cmp1-team-blocked", project, M7_EVIDENCE_DIR);

  // A refused save (an empty legal name fails SenderIdentitySchema) shows the inline error and saves nothing.
  const form = page.getByTestId("sender-identity-form");
  await form.getByTestId("legal-name").fill("");
  await form.getByTestId("postal-address").fill("1 Example Street, Springfield 12345");
  await form.getByTestId("sender-identity-save").click();
  await expect(page.getByTestId("sender-identity-error")).toBeVisible();
  await expect(page.getByTestId("sender-identity-saved")).toHaveCount(0);

  await form.getByTestId("legal-name").fill("Compliance Co Ltd");
  await form.getByTestId("sender-identity-save").click();
  const saved = page.getByTestId("sender-identity-saved");
  await expect(saved).toContainText("Compliance Co Ltd");
  await expect(saved).toContainText("1 Example Street, Springfield 12345");
  await expect(saved).toContainText("Every first-contact email carries this, as the law requires.");
  await page.reload();
  await expect(page.getByTestId("sender-identity-saved")).toContainText("Compliance Co Ltd");
  await shot(page, "cmp1-team-sender-identity", project, M7_EVIDENCE_DIR);

  // The same flow with the identity saved: the next batch opens the first-contact card.
  const second = await insertOutreachBatchTask(companyId, "Outreach batch 2");
  await sendInngestEvent("task/dispatch", { companyId, taskId: second.id });
  await page.goto(`/c/${slug}`);
  await pollCount(page, cardOfKind(page, "email.send.first_contact"));
  const card = cardOfKind(page, "email.send.first_contact").first();
  await expect(card).toContainText(`cmp-1-${stamp}@example.test`);
  await expect(card).toContainText(`cmp-2-${stamp}@example.test`);
  await shot(page, "cmp1-home-first-contact", project, M7_EVIDENCE_DIR);
});

test("M4 connections: Meta Ads and Gmail connect in sandbox and disconnect; a forged Gmail callback is refused", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const project = testInfo.project.name;
  const stamp = Date.now().toString(36);
  await onboardedCompany(page, project, `${stamp}k`, `Connect Co ${stamp} ${project}`);

  await page.getByTestId("nav-settings").click();
  await page.getByTestId("settings-connections").click();
  await expect(page).toHaveURL(/\/settings\/connections$/);
  const meta = page.locator('[data-testid="connection-row"][data-provider="meta_ads"]');
  const gmail = page.locator('[data-testid="connection-row"][data-provider="gmail"]');
  await expect(meta).toHaveAttribute("data-status", "none");
  await expect(gmail).toHaveAttribute("data-status", "none");

  for (const row of [meta, gmail]) {
    await row.getByTestId("connection-connect").click();
    await expect(row).toHaveAttribute("data-status", "connected");
    await expect(row.getByTestId("connection-account")).toContainText("sandbox");
  }
  await shot(page, "connections-m4", project);

  for (const row of [meta, gmail]) {
    await row.getByTestId("connection-disconnect").click();
    await expect(row).toHaveAttribute("data-status", "revoked");
    await expect(row.getByTestId("connection-connect")).toBeVisible();
  }

  // A forged callback without the state cookie is refused and changes nothing.
  await page.goto("/api/connections/gmail/callback?code=forged&state=forged");
  await expect(page).toHaveURL(/\/settings\/connections\?error=gmail-state$/);
  await expect(page.getByTestId("connections-error")).toBeVisible();
  await expect(gmail).toHaveAttribute("data-status", "revoked");
});
