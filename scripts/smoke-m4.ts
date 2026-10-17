/**
 * M4 smoke loop (docs/plans/M4.md "Acceptance test"): a campaign card →
 * an active campaign → spend, clicks and sign-ups in the outcome ledger with
 * provenance → the 11th dollar pauses the campaign and opens a cap card →
 * approve raises today's cap and resumes, decline keeps it paused; five leads
 * → one card → five sends → replies as a metric; the kill switch pauses both
 * campaigns within 5 s and resume asks once; the CSV export carries every
 * entry; nothing in `actions` or `ledger_entries` ever disappears.
 *
 * Usage: pnpm smoke:m4   (requires the stack and `pnpm dev`; worker in sandbox mode with the mock runtime)
 */
import { Inngest } from "inngest";
import { createClient } from "@supabase/supabase-js";
import { EVENT, ledgerCsv, localDay } from "@north/core";
import {
  answerCard,
  cardsOpenedToday,
  createAutoRule,
  createCompany,
  createGoal,
  createTask,
  getBudget,
  getTask,
  headActionsForTask,
  importLeads,
  latestChannelSample,
  latestMetric,
  ledgerEntriesForReport,
  listCampaigns,
  listLeads,
  listLedgerEntries,
  listPendingCards,
  listRecentActions,
  pendingActionsForCard,
  setKillSwitch,
  setOnboardingStep,
  setSenderIdentity,
  updateProfile,
  upsertBudgets,
  type Database,
} from "@north/db";
import { localSupabaseEnv } from "../packages/db/test/env";

const INNGEST_BASE_URL = process.env.INNGEST_BASE_URL ?? "http://localhost:8288";
const WORKER_URL = process.env.WORKER_URL ?? "http://localhost:3101";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 120_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** DEC-3 (M5): the quota day is the owner's local day; this owner keeps the profile default (UTC), so "today" is the UTC date. */
const today = (): string => localDay("UTC", new Date());

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`smoke M4: ${message}`);
}

async function until<T>(label: string, probe: () => Promise<T | null | undefined | false>, timeoutMs = TIMEOUT_MS): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await probe();
    if (value) return value;
    await sleep(1500);
  }
  throw new Error(`smoke M4: timed out waiting for ${label}`);
}

const env = localSupabaseEnv();
const db = createClient<Database>(env.url, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const inngest = new Inngest({ id: "north-smoke-m4", isDev: true, baseUrl: INNGEST_BASE_URL });

async function workerPost(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${WORKER_URL}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  assert(response.ok, `worker POST ${path} → ${response.status} ${await response.text()}`);
}

const deliver = (providerCampaignId: string, spendUsd: number) => workerPost(`/sandbox/ads/${encodeURIComponent(providerCampaignId)}/deliver`, { spendUsd, impressions: 800, clicks: 12, conversions: 1 });

/** Every company-scope `signups` sample so far: the collector writes one per run (sandbox analytics), so a new one means the run is over. */
async function signupSamples(companyId: string): Promise<number> {
  const { count } = await db.from("metrics").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("metric_key", "signups").eq("scope", "company");
  return count ?? 0;
}

/** `metric/collect { reason: "manual" }` and wait for that collection to finish. */
async function collect(companyId: string): Promise<void> {
  const before = await signupSamples(companyId);
  await inngest.send({ name: EVENT.metricCollect, data: { companyId, reason: "manual" } });
  await until("collection to finish", async () => (await signupSamples(companyId)) > before);
}

async function approve(companyId: string, cardId: string, optionId: "approve" | "decline" = "approve"): Promise<void> {
  await answerCard(db, cardId, { optionId, answeredBy: "user" });
  await inngest.send({ name: EVENT.decisionAnswered, data: { companyId, cardId, optionId, answeredBy: "user" } });
}

const counts = async (companyId: string) => {
  const [a, l] = await Promise.all([db.from("actions").select("id", { count: "exact", head: true }).eq("company_id", companyId), db.from("ledger_entries").select("id", { count: "exact", head: true }).eq("company_id", companyId)]);
  return { actions: a.count ?? 0, ledger: l.count ?? 0 };
};

async function startCampaign(companyId: string, title: string, viaCard: boolean): Promise<string> {
  const task = await createTask(db, { companyId, role: "growth", taskType: "campaign_spec", title, metricKey: "signups", expectedDelta: 10 });
  await inngest.send({ name: EVENT.taskDispatch, data: { companyId, taskId: task.id } });
  if (viaCard) {
    const card = await until("campaign card", async () => (await listPendingCards(db, companyId)).find((c) => c.taskId === task.id));
    assert(card.tier === "K2" && card.actionKind === "ads.start", `unexpected card ${card.tier} ${card.actionKind}`);
    assert(!card.rationale.includes("budget cap") && card.rationale.includes("$10/day"), `BUD-1 profile: unexpected rationale "${card.rationale}"`);
    await approve(companyId, card.id);
  }
  const done = await until(`task ${title} done`, async () => {
    const t = await getTask(db, task.id);
    return t?.status === "done" ? t : null;
  });
  assert(done.evidence?.kind === "campaign_id" && done.evidence.verified && done.evidence.ref.startsWith("sandbox:campaign:"), `expected campaign_id evidence, got ${JSON.stringify(done.evidence)}`);
  return task.id;
}

interface Ctx {
  readonly companyId: string;
  readonly ownerId: string;
  readonly campaign: Awaited<ReturnType<typeof listCampaigns>>[number];
  readonly tally: { actions: number; ledger: number }[];
}

/** `actions` and `ledger_entries` never shrink (append-only); every step ends here. */
async function checkpoint(ctx: Ctx): Promise<void> {
  const now = await counts(ctx.companyId);
  const last = ctx.tally[ctx.tally.length - 1]!;
  assert(now.actions >= last.actions && now.ledger >= last.ledger, `append-only broken: ${JSON.stringify(last)} → ${JSON.stringify(now)}`);
  ctx.tally.push(now);
}

/** 1) Company with a $10/day / $100 ads budget; campaign card → approve → active campaign row with the campaign id as evidence. */
async function step1(): Promise<Ctx> {
  const user = await db.auth.admin.createUser({ email: `smoke-m4-${Date.now()}@north.test`, password: `pw-${Date.now()}-Aa1!`, email_confirm: true });
  assert(user.data.user, `createUser failed: ${user.error?.message}`);
  const ownerId = user.data.user.id;
  await updateProfile(db, ownerId, { dailyDecisionQuota: 5 });
  const company = await createCompany(db, { ownerId, name: `Ledger Co ${Date.now().toString(36)}`, thesis: "Bookkeeping for solo consultants that closes the month in one click." });
  const companyId = company.id;
  // CMP-1 (M7): no first contact leaves without the company's legal name and postal address; the gate blocks it otherwise.
  await setSenderIdentity(db, companyId, { legalName: "Ledger Co Ltd", postalAddress: "1 Example Street, Springfield 12345" });
  await createGoal(db, companyId, { metricKey: "signups", targetValue: 50, dueDate: "2026-12-31" });
  await upsertBudgets(db, companyId, [{ category: "ads", totalLimitUsd: 100, dailyLimitUsd: 10 }]);
  await setOnboardingStep(db, companyId, "done");
  const tally = [await counts(companyId)];
  const taskId = await startCampaign(companyId, "Launch test campaign", true);
  const campaign = (await listCampaigns(db, companyId))[0];
  assert(campaign?.status === "active" && campaign.taskId === taskId && campaign.providerCampaignId.startsWith("sandbox:campaign:"), `expected an active sandbox campaign row, got ${JSON.stringify(campaign)}`);
  const ctx = { companyId, ownerId, campaign, tally };
  await checkpoint(ctx);
  return ctx;
}

/** 2) $4 → one ledger entry with provenance, channel samples, budget spend, company signups; $4 more → two entries, $8, no card. */
async function step2({ companyId, campaign }: Ctx): Promise<void> {
  await deliver(campaign.providerCampaignId, 4);
  await collect(companyId);
  const entries1 = await listLedgerEntries(db, companyId);
  const e1 = entries1.find((e) => e.channel === "meta_ads");
  assert(e1 && e1.metricKey === "signups" && e1.before === 0 && e1.after === 1 && e1.costUsd === 4, `expected signups 0 → 1 at $4, got ${JSON.stringify(entries1)}`);
  assert(e1.campaignId === campaign.id && (e1.provenance?.raw as { clicks?: number } | undefined)?.clicks === 12, `expected provenance clicks 12, got ${JSON.stringify(e1.provenance)}`);
  const key = `meta_ads:${campaign.providerCampaignId}`;
  assert((await latestChannelSample(db, companyId, "ad_spend_usd", key))?.value === 4 && (await latestChannelSample(db, companyId, "ad_clicks", key))?.value === 12, "channel samples ad_spend_usd 4 / ad_clicks 12");
  assert((await getBudget(db, companyId, "ads"))?.spentTodayUsd === 4, "budget spent_today_usd 4");
  assert((await latestMetric(db, companyId, "signups"))?.value === 1, "company signups = 1 from sandbox analytics");
  await deliver(campaign.providerCampaignId, 4);
  await collect(companyId);
  assert((await listLedgerEntries(db, companyId)).filter((e) => e.channel === "meta_ads").length === 2, "second window → second entry");
  assert((await getBudget(db, companyId, "ads"))?.spentTodayUsd === 8, "spent 8");
  assert((await listPendingCards(db, companyId)).length === 0, "no card under the cap");
}

/** 3) $3 more → paused for the cap, ads.pause notified, one K2 cap card (default decline); no second card; approve → +$10 and resume; breach again → decline keeps it paused. */
async function step3({ companyId, campaign }: Ctx): Promise<void> {
  await deliver(campaign.providerCampaignId, 3);
  await collect(companyId);
  assert((await listCampaigns(db, companyId))[0]?.status === "paused_cap", "campaign paused_cap at $11");
  assert((await listRecentActions(db, companyId, 1)).some((a) => a.kind === "ads.pause" && a.status === "notified"), "an ads.pause row notified");
  const capCard = (await listPendingCards(db, companyId)).find((c) => c.actionKind === "budget.cap.raise");
  assert(capCard && capCard.tier === "K2" && capCard.defaultOptionId === "decline" && capCard.rationale.includes("spent $11 of $10"), `unexpected cap card ${JSON.stringify(capCard)}`);
  await collect(companyId);
  assert((await cardsOpenedToday(db, companyId, today())) === 2 && (await listPendingCards(db, companyId)).length === 1, "a second collection opens no second cap card");
  await approve(companyId, capCard.id);
  await until("cap raised and campaign resumed", async () => (await getBudget(db, companyId, "ads"))?.dailyExtraUsd === 10 && (await listCampaigns(db, companyId))[0]?.status === "active");
  assert((await listRecentActions(db, companyId, 1)).some((a) => a.kind === "ads.resume" && a.status === "notified"), "ads.resume notified after the raise");
  await deliver(campaign.providerCampaignId, 10);
  await collect(companyId);
  assert((await listCampaigns(db, companyId))[0]?.status === "paused_cap", "paused again at $21 > $20");
  const capCard2 = (await listPendingCards(db, companyId)).find((c) => c.actionKind === "budget.cap.raise");
  assert(capCard2 && capCard2.id !== capCard.id && capCard2.rationale.includes("spent $21 of $20"), "third card for the raised cap");
  await approve(companyId, capCard2.id, "decline");
  await until("cap raise declined", async () => (await listRecentActions(db, companyId, 1)).some((a) => a.kind === "budget.cap.raise" && a.status === "declined"));
  await collect(companyId);
  assert((await listCampaigns(db, companyId))[0]?.status === "paused_cap" && (await listPendingCards(db, companyId)).length === 0 && (await cardsOpenedToday(db, companyId, today())) === 3, "declined: stays paused, no new card for the same cap and day");
}

/** 4) Sales: five leads → one card with five pending sends → approve → five executed sends, message id evidence, leads contacted; two replies → one cold_email entry 0 → 2. */
async function step4({ companyId }: Ctx): Promise<void> {
  const imported = await importLeads(db, companyId, [1, 2, 3, 4, 5].map((i) => ({ name: `Prospect ${i}`, email: `prospect-${i}@example.test`, company: `Agency ${i}`, why: "Runs outbound without a team." })), "upload");
  assert(imported.imported === 5, "five leads imported");
  const outreach = await createTask(db, { companyId, role: "sales", taskType: "outreach_batch", title: "Outreach batch 1", metricKey: "email_replies", expectedDelta: 2 });
  await inngest.send({ name: EVENT.taskDispatch, data: { companyId, taskId: outreach.id } });
  const batchCard = await until("batch card", async () => (await listPendingCards(db, companyId)).find((c) => c.actionKind === "email.send.first_contact"));
  assert((await listPendingCards(db, companyId)).length === 1 && (await pendingActionsForCard(db, batchCard.id)).length === 5, "exactly one card with five pending sends");
  await approve(companyId, batchCard.id);
  const outreachDone = await until("outreach task done", async () => {
    const t = await getTask(db, outreach.id);
    return t?.status === "done" ? t : null;
  });
  assert(outreachDone.evidence?.kind === "message_id" && outreachDone.evidence.ref.startsWith("sandbox:msg:"), `expected message_id evidence, got ${JSON.stringify(outreachDone.evidence)}`);
  const sends = (await headActionsForTask(db, outreach.id)).filter((a) => a.kind === "email.send.first_contact" && a.status === "executed");
  const messageIds = sends.map((a) => a.externalRef ?? "");
  assert(sends.length === 5 && new Set(messageIds).size === 5 && messageIds.every((m) => m.startsWith("sandbox:msg:")), "five executed sends with distinct sandbox refs");
  assert((await listLeads(db, companyId, { status: ["contacted"] })).length === 5, "five leads contacted");
  await workerPost(`/sandbox/mail/${encodeURIComponent(messageIds[0]!)}/reply`, {});
  await workerPost(`/sandbox/mail/${encodeURIComponent(messageIds[1]!)}/reply`, {});
  await collect(companyId);
  const replyEntry = (await listLedgerEntries(db, companyId)).find((e) => e.channel === "cold_email");
  assert(replyEntry && replyEntry.metricKey === "email_replies" && replyEntry.before === 0 && replyEntry.after === 2 && replyEntry.costUsd === 0 && replyEntry.taskId === outreach.id, `expected cold_email 0 → 2 at $0, got ${JSON.stringify(replyEntry)}`);
  assert((await latestMetric(db, companyId, "email_replies"))?.value === 2, "company email_replies = 2");
  assert((await listLeads(db, companyId, { status: ["replied"] })).length === 2, "two leads replied");
  await collect(companyId);
  assert((await listLedgerEntries(db, companyId)).filter((e) => e.channel === "cold_email").length === 1, "no duplicate reply entry");
}

/**
 * 5) Kill switch over two active campaigns. The first resumes with the day
 * roll (its pause day is backdated; the CEO raised the daily cap in
 * settings), the second starts under an auto rule so the day's fifth and last
 * card stays for the resume (DEC-3, quota 5).
 */
async function step5({ companyId, campaign }: Ctx): Promise<number> {
  await upsertBudgets(db, companyId, [{ category: "ads", totalLimitUsd: 100, dailyLimitUsd: 60 }]);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  await db.from("campaigns").update({ paused_day: yesterday }).eq("id", campaign.id);
  await collect(companyId);
  assert((await listCampaigns(db, companyId))[0]?.status === "active", "day roll resumed the daily-cap pause (K1)");
  await createAutoRule(db, { companyId, kind: "ads.start", maxAmountUsd: 50, category: "ads" });
  await startCampaign(companyId, "Second campaign", false);
  const active = await listCampaigns(db, companyId, { status: ["active"] });
  assert(active.length === 2, `expected two active campaigns, got ${active.map((c) => c.status).join(",")}`);
  const killedAt = Date.now();
  await setKillSwitch(db, companyId, true);
  await inngest.send({ name: EVENT.companyKillSwitch, data: { companyId } });
  const refused = await createTask(db, { companyId, role: "growth", taskType: "campaign_spec", title: "Should not run", metricKey: "signups", expectedDelta: 1 });
  await inngest.send({ name: EVENT.taskDispatch, data: { companyId, taskId: refused.id } });
  await until("both campaigns paused_kill", async () => (await listCampaigns(db, companyId, { status: ["paused_kill"] })).length === 2, 15_000);
  const killLatency = Date.now() - killedAt;
  const killRow = (await listRecentActions(db, companyId, 1)).find((a) => a.kind === "ads.pause" && a.description.startsWith("Kill switch"));
  assert((killRow?.payload.campaignIds as string[] | undefined)?.length === 2 && killRow?.status === "notified", "one ads.pause row with two ids");
  assert(killLatency <= 5000, `kill switch took ${killLatency} ms (limit 5000)`);
  await sleep(4000);
  assert((await getTask(db, refused.id))?.status === "queued", "dispatch refused under the kill switch");
  await setKillSwitch(db, companyId, false);
  await inngest.send({ name: EVENT.companyResume, data: { companyId } });
  const resumeCard = await until("resume card", async () => (await listPendingCards(db, companyId)).find((c) => c.actionKind === "ads.resume"));
  assert(resumeCard.tier === "K2" && resumeCard.defaultOptionId === "decline" && (await cardsOpenedToday(db, companyId, today())) === 5, "one K2 ads.resume card, the fifth of the day");
  await approve(companyId, resumeCard.id);
  const killedIds = active.map((c) => c.id);
  await until("both campaigns active again", async () => {
    const rows = await listCampaigns(db, companyId);
    return killedIds.every((id) => rows.find((c) => c.id === id)?.status === "active") && rows.every((c) => c.status !== "paused_kill");
  });
  assert((await listRecentActions(db, companyId, 1)).some((a) => a.kind === "ads.resume" && a.tier === "K2" && a.status === "executed"), "the K2 ads.resume executed");
  return killLatency;
}

/** 6) CSV export: a header and one line per entry. */
async function step6({ companyId }: Ctx): Promise<{ readonly entries: number; readonly rows: number }> {
  const report = await ledgerEntriesForReport(db, companyId, 30);
  const lines = ledgerCsv(report).split("\r\n").filter((l) => l.length > 0);
  assert(lines[0] === "measured_at,channel,metric_key,before,after,delta,cost_usd,task_id" && lines.length === report.length + 1, `csv has ${lines.length} lines for ${report.length} entries`);
  return { entries: report.length, rows: lines.length - 1 };
}

async function main() {
  const ctx = await step1();
  await step2(ctx);
  await checkpoint(ctx);
  await step3(ctx);
  await checkpoint(ctx);
  await step4(ctx);
  await checkpoint(ctx);
  const killLatency = await step5(ctx);
  await checkpoint(ctx);
  const csv = await step6(ctx);
  const final = ctx.tally[ctx.tally.length - 1]!;
  console.log(
    `smoke M4 OK: campaign ${ctx.campaign.providerCampaignId} active→paused_cap→active→paused_cap→paused_kill→active, ${csv.entries} ledger entries (meta_ads + cold_email), cap cards 2 (approve, decline), batch of 5 sent with 2 replies, kill switch ${killLatency} ms, cards today ${await cardsOpenedToday(db, ctx.companyId, today())}, actions ${final.actions}, csv ${csv.rows} rows`,
  );
  await db.auth.admin.deleteUser(ctx.ownerId);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
