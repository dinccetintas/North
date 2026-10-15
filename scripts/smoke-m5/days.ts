/**
 * The seven simulated days of the M5 smoke, step for step as docs/plans/M5.md
 * "Acceptance test" lists them (D1 … D7/D8). Each day moves the worker's
 * clock, sends the tick events, polls the database and ends with the
 * checkpoint (append-only tables, max cards per day ≤ 3).
 */
import { fixBranchName, isoWeek } from "@north/core";
import {
  cardsOpenedToday,
  createTask,
  getSignal,
  getTask,
  headActionsForTask,
  importLeads,
  latestMetric,
  latestPlan,
  listArtifacts,
  listBriefs,
  listCampaigns,
  listLedgerEntries,
  listPendingCards,
  listRecentActions,
  listSignals,
  listTasks,
  listTasksByType,
  pendingActionsForCard,
  setSentryProject,
  signalByRef,
  writeMemoryItems,
  type PlanRecord,
  type SignalRecord,
  type TaskRecord,
} from "@north/db";
import { sandboxSignalRefs } from "../../packages/integrations/src/sandbox/signals";
import { answer, assert, briefNotifications, check, checkpoint, collect, db, deliver, dispatch, morning, postSentryWebhook, requestPlan, scan, sentryIssue, setClock, simAt, simDay, sleep, tick, until, type Ctx } from "./harness";

/** The competitor page the sandbox source "sees change" on D5; seeded into memory on D1 as the competitor map would record it. */
export const COMPETITOR_URL = "https://incumbent-a.example/pricing";
const FIRST_PLAN_K0 = ["competitor_map", "prd", "brand_kit", "business_plan"] as const;
const SENTRY_TITLE = "TypeError: Cannot read properties of undefined (reading 'map')";
const DAY_MS = 86_400_000;

const near = (value: number, target: number): boolean => Math.abs(value - target) < 0.005;
const signalSummary = async (companyId: string): Promise<readonly string[]> => (await listSignals(db, companyId, { limit: 100 })).map((s) => `${s.source}:${s.sourceRef}:${s.status}:${s.score}`);
export const taskSummary = async (companyId: string, planId?: string): Promise<readonly string[]> => (await listTasks(db, companyId, planId ? { planId } : {})).map((t) => `${t.taskType}:${t.status}`);
const doneTask = (taskId: string) => async (): Promise<TaskRecord | null> => {
  const t = await getTask(db, taskId);
  return t?.status === "done" ? t : null;
};
const signalWhere = (companyId: string, source: SignalRecord["source"], ref: string, status: SignalRecord["status"]) => async (): Promise<SignalRecord | null> => {
  const s = await signalByRef(db, companyId, source, ref);
  return s?.status === status ? s : null;
};
export const planWhere = (companyId: string, ok: (p: PlanRecord) => boolean) => async (): Promise<PlanRecord | null> => {
  const p = await latestPlan(db, companyId);
  return p && ok(p) ? p : null;
};
/** The gated spec's payload of a task's action: it sits on the chain's first row (`payload.spec.payload`); transition rows carry only `supersedes` and a note. */
async function specPayload(taskId: string, kind: string): Promise<Readonly<Record<string, unknown>>> {
  const { data } = await db.from("actions").select("payload").eq("task_id", taskId).eq("kind", kind).is("supersedes", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const spec = (data?.payload as { spec?: { payload?: Record<string, unknown> } } | null)?.spec;
  return Object.freeze({ ...(spec?.payload ?? {}) });
}

export interface Day1 {
  readonly ctx: Ctx;
  readonly campaignRef: string;
  readonly plan1: PlanRecord;
  /** The sandbox progression of source refs for this company (reddit ×2, producthunt, google_trends, competitor). */
  readonly refs: readonly string[];
}

/** A second `brief/tick` on the same day creates no second row and no further notification. */
async function secondTickIsIdle(ctx: Ctx, day: number): Promise<void> {
  await tick();
  await sleep(5000);
  const rows = (await listBriefs(db, ctx.companyId, 30)).filter((b) => b.day === simDay(day));
  check(rows.length === 1, `D${day} second brief/tick`, "still one briefs row", rows.length);
  check((await briefNotifications(ctx.companyId)) === day * 2, `D${day} second brief/tick notifications`, `${day * 2}`, await briefNotifications(ctx.companyId));
}

/** `build_site` → go-live card (card 1 of D1) → approve → the site is live. */
async function goLive(ctx: Ctx): Promise<void> {
  const { companyId } = ctx;
  const build = await createTask(db, { companyId, role: "engineering", taskType: "build_site", title: "Landing page v0", metricKey: "signups", expectedDelta: 10 });
  await dispatch(companyId, build.id);
  const card = await until("go-live card", async () => (await listPendingCards(db, companyId)).find((c) => c.actionKind === "deploy.production" && c.taskId === build.id), { found: () => listPendingCards(db, companyId) });
  check(card.tier === "K2" && card.day === simDay(1), "card 1", `K2, day ${simDay(1)}`, { tier: card.tier, day: card.day, openedAt: card.openedAt });
  await answer(companyId, card.id, "approve");
  const done = await until("build_site done", doneTask(build.id), { found: () => getTask(db, build.id) });
  check(done.evidence?.kind === "url" && done.evidence.verified && done.evidence.ref.includes("/live-"), "site live", "verified url evidence under /live-", done.evidence);
}

/** `plan/requested` → plan 1 with six tasks; the two K2 ones open cards 2 and 3, both approved. */
async function firstPlan(ctx: Ctx): Promise<{ readonly plan1: PlanRecord; readonly campaignRef: string }> {
  const { companyId } = ctx;
  await requestPlan(companyId);
  const plan1 = await until("plan 1 with six tasks", planWhere(companyId, (p) => p.tasks.length >= 6), { found: async () => (await latestPlan(db, companyId))?.tasks.map((t) => t.taskType) ?? "no plan" });
  const types = plan1.tasks.map((t) => t.taskType);
  check(types.length === 6 && FIRST_PLAN_K0.every((t) => types.includes(t)) && types.includes("campaign_spec") && types.includes("outreach_batch"), "plan 1 tasks", "four K0 + campaign_spec + outreach_batch", types);
  const ads = await until("campaign card", async () => (await listPendingCards(db, companyId)).find((c) => c.actionKind === "ads.start"), { found: () => listPendingCards(db, companyId) });
  check(ads.tier === "K2" && ads.day === simDay(1), "card 2", `K2 ads.start on ${simDay(1)}`, { tier: ads.tier, day: ads.day });
  await answer(companyId, ads.id, "approve");
  const batch = await until("batch card", async () => (await listPendingCards(db, companyId)).find((c) => c.actionKind === "email.send.first_contact"), { found: () => listPendingCards(db, companyId) });
  check(batch.day === simDay(1) && (await pendingActionsForCard(db, batch.id)).length === 5, "card 3", `one batch card on ${simDay(1)} with five pending sends`, { day: batch.day, pending: (await pendingActionsForCard(db, batch.id)).length });
  await answer(companyId, batch.id, "approve");
  await until("plan 1 tasks done", async () => (await listTasks(db, companyId, { planId: plan1.id })).every((t) => t.status === "done"), { found: () => taskSummary(companyId, plan1.id) });
  const campaign = (await listCampaigns(db, companyId))[0];
  check(campaign?.status === "active" && campaign.providerCampaignId.startsWith("sandbox:campaign:"), "campaign", "one active sandbox campaign", campaign);
  const sends = (await listRecentActions(db, companyId, 48)).filter((a) => a.kind === "email.send.first_contact" && a.status === "executed");
  check(sends.length === 5, "sends", "five executed first-contact sends", sends.length);
  check((await cardsOpenedToday(db, companyId, simDay(1))) === 3, "D1 cards", "3", await cardsOpenedToday(db, companyId, simDay(1)));
  return { plan1, campaignRef: campaign.providerCampaignId };
}

/** 13:00: the first scan finds two reddit posts; the good one is deferred (quota spent), the noise is below threshold. */
async function firstScan(ctx: Ctx): Promise<readonly string[]> {
  const { companyId } = ctx;
  await setClock(1, "13:00");
  await scan(companyId);
  const [r1, r2] = await until(
    "two scored reddit signals (deferred + below_threshold)",
    async () => {
      const rows = await listSignals(db, companyId, { limit: 100 });
      const a = rows.find((s) => s.source === "reddit" && /^r-.+-1$/.test(s.sourceRef) && s.status === "deferred");
      const b = rows.find((s) => s.source === "reddit" && /^r-.+-2$/.test(s.sourceRef) && s.status === "below_threshold");
      return a && b ? ([a, b] as const) : null;
    },
    { found: () => signalSummary(companyId) },
  );
  const refs = sandboxSignalRefs([r1.sourceRef.slice(2, -2)], [COMPETITOR_URL]);
  check(near(r1.score, 0.85) && r1.kind === "opportunity" && r1.url?.startsWith("https://www.reddit.com/"), "r-*-1", "opportunity, score 0.85, reddit URL", { score: r1.score, kind: r1.kind, url: r1.url });
  check(near(r2.score, 0.4) && r2.sourceRef === refs[1], "r-*-2", `score 0.4, ref ${refs[1]}`, { score: r2.score, ref: r2.sourceRef });
  check((await signalSummary(companyId)).length === 2, "D1 signals", "exactly two rows", await signalSummary(companyId));
  const today = await cardsOpenedToday(db, companyId, simDay(1));
  check(today === 3 && (await listPendingCards(db, companyId)).length === 0, "D1 quota", "3 cards opened, none pending (the signal deferred, nothing refused)", { today, pending: (await listPendingCards(db, companyId)).length });
  return refs;
}

/** D1 Mon: brief → idle second tick → leads, site, plan 1, three cards → 13:00 scan. */
export async function day1(ctx0: Ctx): Promise<Day1> {
  const { ctx, brief } = await morning(ctx0, 1);
  check(brief.content.decisions.pending.length === 0, "D1 brief", "no pending cards", brief.content.decisions.pending);
  await secondTickIsIdle(ctx, 1);
  await writeMemoryItems(db, ctx.companyId, [{ kind: "learning", title: "Competitor: Incumbent A", content: `Incumbent A sells the same outcome to mid-market teams; pricing page: ${COMPETITOR_URL}` }], "research");
  const imported = await importLeads(db, ctx.companyId, [1, 2, 3, 4, 5].map((i) => ({ name: `Prospect ${i}`, email: `prospect-${i}@example.test`, company: `Agency ${i}`, why: "Closes the month by hand." })), "upload");
  check(imported.imported === 5, "leads", "five imported", imported);
  await goLive(ctx);
  const { plan1, campaignRef } = await firstPlan(ctx);
  const refs = await firstScan(ctx);
  return { ctx: await checkpoint(ctx, 1), campaignRef, plan1, refs };
}

/** D2 Tue: brief with yesterday's work → the deferred signal opens card 1 of D2, Product Hunt is capped → approve → research done → ad delivery in the ledger. */
export async function day2(ctx0: Ctx, d1: Day1): Promise<Ctx> {
  const { ctx, brief } = await morning(ctx0, 2);
  const { companyId } = ctx;
  const kinds = brief.content.yesterday.actions.map((a) => a.kind);
  check(kinds.includes("deploy.production") && kinds.includes("ads.start") && kinds.filter((k) => k === "email.send.first_contact").length === 5, "D2 brief yesterday.actions", "deploy.production, ads.start, 5 × email.send.first_contact", kinds);
  check(brief.content.decisions.answeredYesterday === 3, "D2 brief answeredYesterday", "3", brief.content.decisions.answeredYesterday);
  check(brief.content.signals.some((s) => s.source === "reddit" && s.status === "deferred"), "D2 brief signals", "the deferred reddit signal", brief.content.signals);
  await scan(companyId);
  const card = await until("signal card", async () => (await listPendingCards(db, companyId)).find((c) => c.actionKind === "signal.pursue"), { found: () => signalSummary(companyId) });
  check(card.tier === "K2" && card.defaultOptionId === "decline" && card.day === simDay(2), "signal card", `K2, default decline, day ${simDay(2)}`, { tier: card.tier, defaultOptionId: card.defaultOptionId, day: card.day });
  check(["source: reddit", "score 0.85", "https://www.reddit.com/"].every((f) => card.rationale.includes(f)), "signal card facts", "source: reddit, score 0.85 and the reddit evidence URL", card.rationale);
  const r1 = await until("signal card_opened", signalWhere(companyId, "reddit", d1.refs[0] ?? "", "card_opened"), { found: () => signalSummary(companyId) });
  check(r1.cardWeek === isoWeek(simDay(2)) && r1.convertedCardId === card.id, "signal row", `card_week ${isoWeek(simDay(2))}, converted_card_id ${card.id}`, { cardWeek: r1.cardWeek, convertedCardId: r1.convertedCardId });
  const ph = await until("producthunt capped", signalWhere(companyId, "producthunt", d1.refs[2] ?? "", "capped"), { found: () => signalSummary(companyId) });
  check(near(ph.score, 0.9), "ph-*-1 score", "0.9", ph.score);
  const answeredAt = await answer(companyId, card.id, "approve");
  const executed = await until("signal.pursue executed", async () => (await listRecentActions(db, companyId, 48)).find((a) => a.kind === "signal.pursue" && a.status === "executed" && a.externalRef?.startsWith("task:")), { intervalMs: 200, timeoutMs: 20_000, found: () => listRecentActions(db, companyId, 48) });
  const settleMs = Date.now() - answeredAt;
  check(settleMs <= 2000, "approve → executed", "≤ 2000 ms", `${settleMs} ms`);
  const taskId = (executed.externalRef ?? "").slice("task:".length);
  const research = await until("signal_research done", doneTask(taskId), { found: () => getTask(db, taskId) });
  check(research.taskType === "signal_research" && research.evidence?.kind === "artifact_id" && research.evidence.verified, "research task", "signal_research done with verified artifact evidence", { taskType: research.taskType, evidence: research.evidence });
  check((await listArtifacts(db, companyId)).some((a) => a.kind === "signal_report"), "signal_report artifact", "one exists", (await listArtifacts(db, companyId)).map((a) => a.kind));
  const approved = await getSignal(db, companyId, r1.id);
  check(approved?.status === "approved" && approved.convertedTaskId === taskId, "signal approved", `approved with converted_task_id ${taskId}`, { status: approved?.status, convertedTaskId: approved?.convertedTaskId });
  await deliver(d1.campaignRef, 4);
  await collect(companyId);
  const entry = (await listLedgerEntries(db, companyId)).find((e) => e.channel === "meta_ads");
  check(entry && entry.metricKey === "signups" && entry.before === 0 && entry.after === 1 && entry.costUsd === 4, "meta_ads ledger entry", "signups 0 → 1 at $4", entry);
  return checkpoint(ctx, 2);
}

export interface Day3 {
  readonly ctx: Ctx;
  readonly fixTaskId: string;
  readonly cardId: string;
  readonly prUrl: string;
  readonly shortId: string;
}

/** 401 with the wrong secret, 200 signed, 200 duplicate on replay; exactly one `sentry` signal, converted. */
async function sentryTriple(ctx: Ctx): Promise<{ readonly shortId: string; readonly signal: SignalRecord }> {
  const { companyId } = ctx;
  const tag = Date.now().toString(36);
  const slug = `smoke-m5-${tag}`;
  const shortId = `NORTH-${tag.toUpperCase()}`;
  await setSentryProject(db, companyId, slug);
  const issue = sentryIssue(slug, shortId);
  const sentrySignals = async (): Promise<readonly SignalRecord[]> => (await listSignals(db, companyId, { limit: 100 })).filter((s) => s.source === "sentry");
  const bad = await postSentryWebhook(issue, "wrong-secret-for-the-smoke");
  check(bad.status === 401, "Sentry wrong secret", "401", { status: bad.status, body: bad.body });
  check((await sentrySignals()).length === 0, "Sentry wrong secret writes nothing", "0 sentry signals", (await sentrySignals()).length);
  const first = await postSentryWebhook(issue);
  check(first.status === 200 && first.duplicate === false, "Sentry signed", "200 { duplicate: false }", first);
  const again = await postSentryWebhook(issue);
  check(again.status === 200 && again.duplicate === true, "Sentry replay", "200 { duplicate: true }", again);
  const signal = await until(
    "one sentry signal, converted",
    async () => {
      const rows = await sentrySignals();
      return rows.length === 1 && rows[0]?.status === "converted" ? rows[0] : null;
    },
    { found: sentrySignals },
  );
  check(signal.kind === "error" && signal.score === 1 && signal.sourceRef === issue.data.issue.id, "sentry signal", `kind error, score 1, source_ref ${issue.data.issue.id}`, { kind: signal.kind, score: signal.score, sourceRef: signal.sourceRef });
  check(signal.title.includes(SENTRY_TITLE) && !signal.title.includes("<instructions>"), "sentry signal title", "the error title without the <instructions> delimiter", signal.title);
  return { shortId, signal };
}

/** The fix pipeline: one `fix_error` task, one incident report, push on `fix/<shortId>`, PR, preview (200), one pending go-live card. */
async function fixPipeline(ctx: Ctx, shortId: string, signalId: string): Promise<Omit<Day3, "ctx" | "shortId">> {
  const { companyId } = ctx;
  const fix = await until(
    "one fix_error task",
    async () => {
      const tasks = await listTasksByType(db, companyId, "fix_error");
      return tasks.length === 1 ? tasks[0] : null;
    },
    { found: () => listTasksByType(db, companyId, "fix_error") },
  );
  const signal = await getSignal(db, companyId, signalId);
  check(signal?.convertedTaskId === fix.id, "sentry signal → task", `converted_task_id ${fix.id}`, signal?.convertedTaskId);
  const incidents = (await listArtifacts(db, companyId)).filter((a) => a.kind === "incident_report");
  check(incidents.length === 1, "incident_report", "exactly one artifact", incidents.length);
  const input = fix.input;
  const open = input.indexOf('<data source="sentry">');
  const title = input.indexOf(`title: ${SENTRY_TITLE}`);
  const close = input.indexOf("</data>");
  check(open >= 0 && title > open && close > title && !input.includes("<instructions>"), "fix task input", "the issue title inside the <data source=\"sentry\"> block, no <instructions>", input);
  const card = await until("fix go-live card", async () => (await listPendingCards(db, companyId)).find((c) => c.actionKind === "deploy.production" && c.taskId === fix.id), { found: () => headActionsForTask(db, fix.id) });
  check(card.tier === "K2" && card.day === simDay(3), "card 1 of D3", `K2 deploy.production on ${simDay(3)}`, { tier: card.tier, day: card.day });
  const actions = await headActionsForTask(db, fix.id);
  const push = actions.find((a) => a.kind === "repo.push");
  const branch = (await specPayload(fix.id, "repo.push")).branch;
  check(push?.status === "notified" && branch === fixBranchName(shortId), "repo.push", `notified on branch ${fixBranchName(shortId)}`, { status: push?.status, branch, description: push?.description });
  const pr = actions.find((a) => a.kind === "repo.pull_request");
  check(pr?.status === "notified" && /^sandbox:\/\/repos\/[^/]+\/[^/]+\/pull\/1$/.test(pr.externalRef ?? ""), "repo.pull_request", "notified with ref sandbox://repos/<owner>/<name>/pull/1", { status: pr?.status, ref: pr?.externalRef });
  const preview = actions.find((a) => a.kind === "deploy.preview");
  check(preview?.status === "notified" && preview.externalRef?.startsWith("http"), "deploy.preview", "notified with an http URL", { status: preview?.status, ref: preview?.externalRef });
  const page = await fetch(preview.externalRef ?? "");
  check(page.status === 200, "preview GET", "200", page.status);
  return { fixTaskId: fix.id, cardId: card.id, prUrl: pr.externalRef ?? "" };
}

/** D3 Wed: brief names the research, the ads and the held signal → google_trends scan + idle rescan → 09:00 Sentry triple → fix pipeline. */
export async function day3(ctx0: Ctx, refs: readonly string[]): Promise<Day3> {
  const { ctx, brief } = await morning(ctx0, 3);
  const { companyId } = ctx;
  const outcomes = brief.content.yesterday.outcomes;
  check(outcomes.some((o) => o.metricKey === "artifacts"), "D3 brief research", "an artifacts outcome (the signal report)", outcomes);
  check(outcomes.some((o) => o.channel === "meta_ads"), "D3 brief ads", "a meta_ads outcome", outcomes);
  check(brief.content.signals.some((s) => s.source === "producthunt" && s.status === "capped"), "D3 brief held signal", "producthunt capped", brief.content.signals);
  await scan(companyId);
  const gt = await until("google_trends below threshold", signalWhere(companyId, "google_trends", refs[3] ?? "", "below_threshold"), { found: () => signalSummary(companyId) });
  check(near(gt.score, 0.3), "gt-* score", "0.3", gt.score);
  // The sandbox progression advances one step per scan (not per day), so the idle-rescan proof lives on D5, once the sources are exhausted.
  await setClock(3, "09:00");
  const { shortId, signal } = await sentryTriple(ctx);
  const pipeline = await fixPipeline(ctx, shortId, signal.id);
  check((await listTasksByType(db, companyId, "fix_error")).length === 1, "fix_error tasks after replay", "1", (await listTasksByType(db, companyId, "fix_error")).length);
  return { ctx: await checkpoint(ctx, 3), shortId, ...pipeline };
}

/** D4 Thu: the brief lists the go-live card → approve → the fix is live with `Fixed:` on the page. */
export async function day4(ctx0: Ctx, d3: Day3): Promise<Ctx> {
  const { ctx, brief } = await morning(ctx0, 4);
  const { companyId } = ctx;
  check(brief.content.decisions.pending.some((p) => p.id === d3.cardId), "D4 brief pending", `the go-live card ${d3.cardId}`, brief.content.decisions.pending);
  await answer(companyId, d3.cardId, "approve");
  const fix = await until("fix task done", doneTask(d3.fixTaskId), { found: () => getTask(db, d3.fixTaskId) });
  check(fix.evidence?.kind === "url" && fix.evidence.verified === true && fix.evidence.ref.includes("/live-"), "fix evidence", "verified live url", fix.evidence);
  const page = await fetch(fix.evidence.ref);
  const html = await page.text();
  check(page.status === 200 && html.includes("Fixed:"), "live page", "200 containing `Fixed:`", { status: page.status, hasFixed: html.includes("Fixed:") });
  const production = (await headActionsForTask(db, fix.id)).find((a) => a.kind === "deploy.production");
  check(production?.status === "executed", "deploy.production", "executed", production?.status);
  return checkpoint(ctx, 4);
}

/** D5 Fri: the competitor change is below threshold and the sources are exhausted; a collection writes no reply entry. */
export async function day5(ctx0: Ctx, refs: readonly string[]): Promise<Ctx> {
  const { ctx } = await morning(ctx0, 5);
  const { companyId } = ctx;
  await scan(companyId);
  const competitor = await until("competitor signal below threshold", async () => (await listSignals(db, companyId, { limit: 100 })).find((s) => s.source === "competitor_sites" && s.status === "below_threshold"), { found: () => signalSummary(companyId) });
  check(near(competitor.score, 0.6) && competitor.sourceRef === refs[4], "competitor signal", `score 0.6, ref ${refs[4]}`, { score: competitor.score, ref: competitor.sourceRef });
  const sourced = (await listSignals(db, companyId, { limit: 100 })).filter((s) => s.source !== "sentry" && s.source !== "metrics");
  check(sourced.length === 5 && refs.every((r) => sourced.some((s) => s.sourceRef === r)), "D5 source signals", `exactly ${refs.join(", ")}`, sourced.map((s) => s.sourceRef));
  const before = (await signalSummary(companyId)).length;
  await scan(companyId);
  await sleep(6000);
  check((await signalSummary(companyId)).length === before, "D5 rescan", `${before} rows (the sources have nothing further; nothing re-inserted)`, await signalSummary(companyId));
  await collect(companyId);
  const cold = (await listLedgerEntries(db, companyId)).filter((e) => e.channel === "cold_email");
  check(cold.length === 0, "D5 outreach replies", "no cold_email ledger entry (0 replies)", cold);
  check(((await latestMetric(db, companyId, "email_replies"))?.value ?? 0) === 0, "email_replies", "0", await latestMetric(db, companyId, "email_replies"));
  return checkpoint(ctx, 5);
}

/** D6 Sat: two `site_visitors` samples (100 a week before, 60 now) → one metric_drop signal → card 1 of D6 → decline → declined, no task. */
export async function day6(ctx0: Ctx): Promise<Ctx> {
  const { ctx } = await morning(ctx0, 6);
  const { companyId } = ctx;
  const latestAt = simAt(6, "07:00");
  // The base sits seven days (and an hour) before the latest sample: `detectMetricDrops` takes the last point at or before latest − 7 d, and the sandbox analytics has been writing wall-clock `site_visitors` samples since D2.
  const baseAt = new Date(latestAt.getTime() - 7 * DAY_MS - 3_600_000);
  const sample = (value: number, at: Date) => ({ company_id: companyId, metric_key: "site_visitors", value, source: "smoke_m5", scope: "company", measured_at: at.toISOString() });
  const { error } = await db.from("metrics").insert([sample(100, baseAt), sample(60, latestAt)]);
  assert(!error, `could not write site_visitors samples: ${error?.message}`);
  const researchBefore = (await listTasksByType(db, companyId, "signal_research")).length;
  await scan(companyId);
  const drop = await until("metric_drop signal", async () => (await listSignals(db, companyId, { limit: 100 })).find((s) => s.source === "metrics" && s.kind === "metric_drop"), { found: () => signalSummary(companyId) });
  check(drop.sourceRef === `metrics:site_visitors:${simDay(6)}` && near(drop.score, 0.75) && drop.title.includes("100 → 60"), "metric_drop", `ref metrics:site_visitors:${simDay(6)}, score 0.75, title with 100 → 60`, { ref: drop.sourceRef, score: drop.score, title: drop.title });
  const card = await until("metric drop card", async () => (await listPendingCards(db, companyId)).find((c) => c.actionKind === "signal.pursue"), { found: () => signalSummary(companyId) });
  check(card.tier === "K2" && card.day === simDay(6) && (await cardsOpenedToday(db, companyId, simDay(6))) === 1, "card 1 of D6", `K2 on ${simDay(6)}, the day's first`, { tier: card.tier, day: card.day });
  await answer(companyId, card.id, "decline");
  const declined = await until("metric_drop declined", async () => {
    const s = await getSignal(db, companyId, drop.id);
    return s?.status === "declined" ? s : null;
  }, { found: () => getSignal(db, companyId, drop.id) });
  check(declined.convertedTaskId === null, "declined signal", "no converted_task_id", declined.convertedTaskId);
  await sleep(3000);
  check((await listTasksByType(db, companyId, "signal_research")).length === researchBefore, "no task after decline", `${researchBefore} signal_research tasks`, await taskSummary(companyId));
  return checkpoint(ctx, 6);
}

/** D7 Sun: seven briefs, every one ≤ 200 words and under 60 s from its tick, 14 brief notifications. */
export async function day7(ctx0: Ctx): Promise<Ctx> {
  const { ctx } = await morning(ctx0, 7);
  const briefs = await listBriefs(db, ctx.companyId, 30);
  const days = [...briefs.map((b) => b.day)].sort();
  const expected = [1, 2, 3, 4, 5, 6, 7].map(simDay);
  check(days.join(",") === expected.join(","), "D7 briefs", expected.join(", "), days);
  check(briefs.every((b) => b.wordCount <= 200), "D7 brief words", "every brief ≤ 200 words", briefs.map((b) => `${b.day}:${b.wordCount}`));
  check(ctx.briefMs.length === 7 && ctx.briefMs.every((ms) => ms < 60_000), "D7 brief latencies", "seven, each < 60000 ms", ctx.briefMs);
  check((await briefNotifications(ctx.companyId)) === 14, "D7 brief notifications", "14", await briefNotifications(ctx.companyId));
  return checkpoint(ctx, 7);
}
