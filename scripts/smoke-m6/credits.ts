/**
 * Phases 3–5 of the M6 smoke (docs/plans/M6.md "Acceptance test"): one
 * credit per agent run and the usage projection, the dispatch refusal at
 * zero credits and the pack that lifts it, the overdraft floor, the 40 %
 * usage alert and the owner's brief hour, and budgets on the owner-local day
 * with the cap card dated by the same day.
 */
import { briefMarkdown, EVENT, MODEL_ROUTING, usageAlertDue, usageRatio } from "@north/core";
import { localDay, localMonth } from "@north/core/time";
import {
  applyBudgetSpend,
  applyUsage,
  createAutoRule,
  createTask,
  creditBalance,
  CreditFloorError,
  getBrief,
  getEntitlement,
  getTask,
  getUsage,
  insertCreditEntries,
  listActionsByKind,
  listBriefs,
  listCampaigns,
  listPendingCards,
  recordAgentRun,
  type BriefRecord,
} from "@north/db";
import { answer, completeCheckout, creditsOf, doneTask, newTask, readySession, required, taskWhere, untilApplied, usageAlerts } from "./billing";
import { assert, check, checkpoint, countRows, db, outputsText, runsOf, send, setClock, simDay, sleep, softCheck, TIMEZONE, until, workerNow, workerPost, type Company, type Ctx } from "./harness";

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/* ---------- phase 3: credits and usage ---------- */

/** `build_site` → go-live card (card 1 of D1) → approve → live. */
async function goLive(company: Company): Promise<void> {
  const build = await createTask(db, { companyId: company.id, role: "engineering", taskType: "build_site", title: "Landing page v0", metricKey: "signups", expectedDelta: 10 });
  await send(EVENT.taskDispatch, { companyId: company.id, taskId: build.id });
  const card = await until("go-live card", async () => (await listPendingCards(db, company.id)).find((c) => c.actionKind === "deploy.production" && c.taskId === build.id), { found: () => listPendingCards(db, company.id) });
  check(card.tier === "K2" && card.day === simDay(1), "card 1", `K2 deploy.production on ${simDay(1)}`, { tier: card.tier, day: card.day });
  await answer(company.id, card.id, "approve");
  const done = await until("build_site done", taskWhere(build.id, "done"), { found: () => getTask(db, build.id) });
  check(done.evidence?.kind === "url" && done.evidence.verified && done.evidence.ref.includes("/live-"), "site live", "verified url evidence under /live-", done.evidence);
}

/**
 * Company 2's site under a standing `deploy.production` rule (the CEO's own
 * auto rule, as M4's second campaign ran under one): its repository exists
 * for the export README and no card is opened beyond the three the run counts.
 */
async function autoLive(company: Company): Promise<void> {
  await createAutoRule(db, { companyId: company.id, kind: "deploy.production" });
  const build = await createTask(db, { companyId: company.id, role: "engineering", taskType: "build_site", title: "Landing page v0", metricKey: "signups", expectedDelta: 10 });
  await send(EVENT.taskDispatch, { companyId: company.id, taskId: build.id });
  await until(`build_site done (${company.slug})`, taskWhere(build.id, "done"), { found: () => getTask(db, build.id) });
  const repo = (await listActionsByKind(db, company.id, "repo.create", 30)).find((a) => (a.status === "executed" || a.status === "notified") && a.externalRef?.startsWith("sandbox://repos/"));
  check(repo, `repo.create (${company.slug})`, "a sandbox://repos/ reference", await listActionsByKind(db, company.id, "repo.create", 30));
  check((await listPendingCards(db, company.id)).length === 0, `cards (${company.slug})`, "none (the go-live ran under the rule)", await listPendingCards(db, company.id));
}

async function runIds(ctx: Ctx): Promise<readonly string[]> {
  const ids = [ctx.c1.id, required(ctx.c2, "company 2").id];
  const { data, error } = await db.from("agent_runs").select("id").in("company_id", ids);
  assert(!error, `could not read agent_runs: ${error?.message}`);
  return (data ?? []).map((r) => r.id);
}

/** One `consume` per `agent_runs` row (`run:<id>`), and the month's usage counts the same runs at $0 and 0 sandbox minutes. */
async function consumesMatchRuns(ctx: Ctx): Promise<number> {
  const period = localMonth(TIMEZONE, await workerNow());
  check(period === "2026-11", "usage period", "2026-11 (owner-local month)", period);
  const settled = await until("one consume per run and the usage row", async () => {
    const runs = await runIds(ctx);
    const consumed = new Set((await creditsOf(ctx.ownerId)).filter((e) => e.kind === "consume" && e.ref.startsWith("run:")).map((e) => e.ref));
    const usage = await getUsage(db, ctx.ownerId, period);
    return runs.length > 0 && consumed.size === runs.length && runs.every((id) => consumed.has(`run:${id}`)) && usage?.creditsUsed === runs.length ? { runs, usage } : null;
  }, { found: async () => ({ runs: (await runIds(ctx)).length, consumes: (await creditsOf(ctx.ownerId)).filter((e) => e.kind === "consume").length, usage: await getUsage(db, ctx.ownerId, period) }) });
  check(settled.usage.llmCostUsd === 0 && settled.usage.sandboxMinutes === 0, `usage ${period}`, `credits_used ${settled.runs.length}, llm_cost_usd 0, sandbox_minutes 0`, settled.usage);
  return settled.runs.length;
}

/** Service role drains the balance with an `adjust`; the next dispatch is `blocked: credits_exhausted`, the task stays queued, no run. */
async function blockedAtZero(ctx: Ctx): Promise<string> {
  const balance = await creditBalance(db, ctx.ownerId);
  await insertCreditEntries(db, ctx.ownerId, [{ kind: "adjust", amount: -balance, ref: `adjust:smoke-m6-drain:${Date.now()}`, note: "smoke M6: drain to zero" }]);
  check((await creditBalance(db, ctx.ownerId)) === 0, "balance after the drain", "0", await creditBalance(db, ctx.ownerId));
  const prd = await newTask(ctx.c1, "prd", false);
  const eventId = await send(EVENT.taskDispatch, { companyId: ctx.c1.id, taskId: prd.id });
  const text = outputsText(await runsOf("run-task at zero credits", eventId));
  check(text.includes("blocked") && text.includes("credits_exhausted"), "run-task at zero credits", "blocked: credits_exhausted", text);
  check((await getTask(db, prd.id))?.status === "queued", "the blocked task", "still queued", (await getTask(db, prd.id))?.status);
  check((await countRows("agent_runs", "task_id", prd.id)) === 0, "agent_runs of the blocked task", "none", await countRows("agent_runs", "task_id", prd.id));
  return prd.id;
}

/**
 * `usage/tick` at zero credits → one `usage_alert` by push and by email (the
 * scope decision's "one usage_alert notification per period" for
 * `credits_exhausted`); a second tick adds none. A missing alert is recorded
 * as unmet (the run still fails at the end) so the phases after it still run.
 */
async function alertedOnce(ctx: Ctx): Promise<Ctx> {
  const before = await usageAlerts(ctx.ownerId);
  await runsOf("usage/tick", await send(EVENT.usageTick, {}));
  const after = await until("usage_alert push + email", async () => {
    const n = await usageAlerts(ctx.ownerId);
    return n.push > before.push && n.email > before.email ? n : null;
  }, { timeoutMs: 15_000 }).catch(() => before);
  const next = softCheck(ctx, after.push === before.push + 1 && after.email === before.email + 1, "phase 3 usage_alert at zero credits", "one push + one email after usage/tick", { before, after });
  await runsOf("second usage/tick", await send(EVENT.usageTick, {}));
  await sleep(3000);
  const again = await usageAlerts(ctx.ownerId);
  check(again.push === after.push && again.email === after.email, "second usage/tick", "no new usage_alert", again);
  return next;
}

/** A pack: checkout in `payment` mode → `grant_pack +100` under `pack:<session>`; the blocked task then runs and ends done. */
async function packLifts(ctx: Ctx, prdId: string): Promise<void> {
  const pack = await readySession(ctx, { kind: "credit_pack", packId: "pack_100" });
  await completeCheckout(pack);
  await untilApplied(ctx.ownerId, 4, "credit pack");
  const grant = await until("grant_pack", async () => (await creditsOf(ctx.ownerId)).find((e) => e.kind === "grant_pack"), { found: () => creditsOf(ctx.ownerId) });
  check(grant.amount === 100 && grant.ref === `pack:${pack.providerRef ?? ""}`, "pack credits", `+100 with ref pack:${pack.providerRef}`, grant);
  check((await creditBalance(db, ctx.ownerId)) === 100, "balance after the pack", "100", await creditBalance(db, ctx.ownerId));
  await send(EVENT.taskDispatch, { companyId: ctx.c1.id, taskId: prdId });
  const done = await until("the blocked prd task done", taskWhere(prdId, "done"), { found: () => getTask(db, prdId) });
  check(done.evidence?.kind === "artifact_id" && done.evidence.verified, "prd evidence", "verified artifact_id", done.evidence);
}

/** The database floor: a `consume` to −6 is refused, to −5 is not; an `adjust` puts the balance back. */
async function overdraftFloor(ctx: Ctx): Promise<void> {
  const balance = await creditBalance(db, ctx.ownerId);
  const stamp = Date.now();
  const consume = (amount: number) => insertCreditEntries(db, ctx.ownerId, [{ kind: "consume", amount, ref: `smoke:floor:${stamp}:${amount}`, note: "smoke M6: overdraft floor" }]);
  const refused = await consume(-(balance + 6)).then(() => null, (e: unknown) => e);
  check(refused instanceof CreditFloorError, "consume to −6", "CreditFloorError", refused instanceof Error ? refused.message : refused);
  check((await creditBalance(db, ctx.ownerId)) === balance, "balance after the refusal", String(balance), await creditBalance(db, ctx.ownerId));
  await consume(-(balance + 5));
  check((await creditBalance(db, ctx.ownerId)) === -5, "consume to −5", "accepted (balance −5)", await creditBalance(db, ctx.ownerId));
  await insertCreditEntries(db, ctx.ownerId, [{ kind: "adjust", amount: balance + 5, ref: `adjust:smoke-m6-floor:${stamp}`, note: "smoke M6: revert the floor probe" }]);
  check((await creditBalance(db, ctx.ownerId)) === balance, "balance after the revert", String(balance), await creditBalance(db, ctx.ownerId));
}

export async function phase3(ctx: Ctx): Promise<Ctx> {
  const c2 = required(ctx.c2, "company 2");
  await goLive(ctx.c1);
  await autoLive(c2);
  await doneTask(ctx.c1, "investor_deck");
  const runs = await consumesMatchRuns(ctx);
  const prdId = await blockedAtZero(ctx);
  const alerted = await alertedOnce(ctx);
  await packLifts(alerted, prdId);
  await overdraftFloor(alerted);
  return checkpoint({ ...alerted, facts: { ...alerted.facts, runsBeforeDrain: runs } }, 3);
}

/* ---------- phase 4: usage alert at 40 % ---------- */

const briefsOn = async (companies: readonly Company[], day: string): Promise<readonly (BriefRecord | null)[]> => Promise.all(companies.map((c) => getBrief(db, c.id, day)));

/** `brief/tick` at 07:00 writes nothing (the owner's hour is 9); at 09:00 one row per company. */
async function briefAtNine(ctx: Ctx): Promise<readonly BriefRecord[]> {
  const companies = [ctx.c1, required(ctx.c2, "company 2")];
  await setClock(2, "07:00");
  await runsOf("brief/tick at 07:00", await send(EVENT.briefTick, {}));
  await sleep(3000);
  check((await briefsOn(companies, simDay(2))).every((b) => b === null), "brief/tick at 07:00", `no ${simDay(2)} brief (brief_hour 9)`, await briefsOn(companies, simDay(2)));
  await setClock(2, "09:00");
  await send(EVENT.briefTick, {});
  const briefs = await until(`both ${simDay(2)} briefs at 09:00`, async () => {
    const rows = await briefsOn(companies, simDay(2));
    return rows.every((b) => b !== null) ? (rows as BriefRecord[]) : null;
  }, { timeoutMs: 60_000 });
  for (const c of companies) {
    const rows = (await listBriefs(db, c.id, 30)).filter((b) => b.day === simDay(2));
    check(rows.length === 1, `briefs of ${c.slug} on ${simDay(2)}`, "exactly one", rows.length);
  }
  return briefs;
}

export async function phase4(ctx: Ctx): Promise<Ctx> {
  const c2 = required(ctx.c2, "company 2");
  const period = localMonth(TIMEZONE, await workerNow());
  const before = await usageAlerts(ctx.ownerId);
  await recordAgentRun(db, { companyId: c2.id, taskId: null, role: "growth", model: MODEL_ROUTING.drafter, runtime: "mock", inputTokens: 0, outputTokens: 0, costUsd: 120, durationMs: 1000, status: "succeeded" });
  await applyUsage(db, { userId: ctx.ownerId, period, credits: 0, costUsd: 120, sandboxMinutes: 0 });
  const price = required(await getEntitlement(db, ctx.ownerId), "the entitlement").priceUsd;
  await runsOf("usage/tick at 40 %", await send(EVENT.usageTick, {}));
  const usage = await until("usage.alerted_at", async () => {
    const u = await getUsage(db, ctx.ownerId, period);
    return u?.alertedAt ? u : null;
  }, { timeoutMs: 30_000, found: () => getUsage(db, ctx.ownerId, period) });
  const ratio = usageRatio(usage, price);
  check(ratio === 0.401 && usageAlertDue(usage, price, null), "usage ratio", `0.401 of $${price} (over the 0.4 line)`, { ratio, usage });
  const after = await usageAlerts(ctx.ownerId);
  check(after.push === before.push + 1 && after.email === before.email + 1, "the 40 % usage_alert", "one more push + email for the period", { before, after });
  const briefs = await briefAtNine(ctx);
  const named = briefs.every((b) => /0\.401|40(\.1)?\s?%/.test(`${JSON.stringify(b.content)} ${briefMarkdown(b.content)}`));
  const next = softCheck(ctx, named, "phase 4 brief names the usage ratio", "0.401 / 40 % in the 09:00 brief", "no usage line (core BriefSchema has no usage field)");
  return checkpoint(next, 4);
}

/* ---------- phase 5: budgets on the owner's day ---------- */

type BudgetRow = { readonly spent_today_usd: number; readonly spent_today_date: string; readonly daily_extra_usd: number; readonly daily_extra_date: string };

async function adsBudget(companyId: string): Promise<BudgetRow> {
  const { data, error } = await db.from("budgets").select("spent_today_usd, spent_today_date, daily_extra_usd, daily_extra_date").eq("company_id", companyId).eq("category", "ads").maybeSingle();
  assert(!error && data, `could not read the ads budget: ${error?.message}`);
  return { spent_today_usd: Number(data.spent_today_usd), spent_today_date: data.spent_today_date, daily_extra_usd: Number(data.daily_extra_usd), daily_extra_date: data.daily_extra_date };
}

/** Company 1's $10/day campaign under a standing `ads.start` rule ($50 total), so it starts without a card. */
async function startCampaign(company: Company): Promise<string> {
  await createAutoRule(db, { companyId: company.id, kind: "ads.start", maxAmountUsd: 50, category: "ads" });
  const task = await createTask(db, { companyId: company.id, role: "growth", taskType: "campaign_spec", title: "Launch test campaign", metricKey: "signups", expectedDelta: 10 });
  await send(EVENT.taskDispatch, { companyId: company.id, taskId: task.id });
  const done = await until("campaign_spec done", taskWhere(task.id, "done"), { found: () => getTask(db, task.id) });
  check(done.evidence?.kind === "campaign_id" && done.evidence.verified, "campaign evidence", "verified campaign_id", done.evidence);
  const campaign = (await listCampaigns(db, company.id))[0];
  check(campaign?.status === "active", "campaign", "one active campaign", await listCampaigns(db, company.id));
  return campaign.providerCampaignId;
}

/** `$10` at D2 23:30 Istanbul (20:30 UTC) lands on D2; `$10` at D3 00:30 (still D2 in UTC) starts D3. */
async function ownerDaySpend(company: Company): Promise<void> {
  const late = await setClock(2, "23:30");
  await applyBudgetSpend(db, { companyId: company.id, category: "ads", amountUsd: 10, day: localDay(TIMEZONE, late) });
  const d2 = await adsBudget(company.id);
  check(d2.spent_today_date === simDay(2) && d2.spent_today_usd === 10 && isoDay(late) === simDay(2) && late.toISOString().slice(11, 16) === "20:30", "D2 23:30 spend", `$10 on ${simDay(2)} at 20:30 UTC`, { ...d2, utc: late.toISOString() });
  const early = await setClock(3, "00:30");
  await applyBudgetSpend(db, { companyId: company.id, category: "ads", amountUsd: 10, day: localDay(TIMEZONE, early) });
  const d3 = await adsBudget(company.id);
  check(d3.spent_today_date === simDay(3) && d3.spent_today_usd === 10 && isoDay(early) === simDay(2), "D3 00:30 spend", `a new day: $10 on ${simDay(3)} while UTC is still ${simDay(2)}`, { ...d3, utc: early.toISOString() });
}

/** Company-scope `signups` samples so far: the sandbox analytics writes one per collection, so a new one means the run is over (M4, M5). */
async function signupSamples(companyId: string): Promise<number> {
  const { count, error } = await db.from("metrics").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("metric_key", "signups").eq("scope", "company");
  assert(!error, `could not count signups samples: ${error?.message}`);
  return count ?? 0;
}

async function collect(companyId: string): Promise<void> {
  const before = await signupSamples(companyId);
  await send(EVENT.metricCollect, { companyId, reason: "manual" });
  await until("collection to finish", async () => (await signupSamples(companyId)) > before);
}

/** A $200 delivery tips D3 over the $205 cap: paused, one cap card dated D3 (the day a card opened now gets); approve raises D3 by $10 and resumes. */
async function capCardOnD3(company: Company, providerCampaignId: string): Promise<void> {
  await workerPost(`/sandbox/ads/${encodeURIComponent(providerCampaignId)}/deliver`, { spendUsd: 200, impressions: 8000, clicks: 120, conversions: 4 });
  await collect(company.id);
  const card = await until("cap card", async () => (await listPendingCards(db, company.id)).find((c) => c.actionKind === "budget.cap.raise"), { found: () => listPendingCards(db, company.id) });
  const today = localDay(TIMEZONE, await workerNow());
  check(card.tier === "K2" && card.day === simDay(3) && card.day === today, "cap card day", `${simDay(3)} (= the day a card opened now gets, ${today})`, { tier: card.tier, day: card.day });
  check((await listCampaigns(db, company.id))[0]?.status === "paused_cap", "campaign at the cap", "paused_cap", (await listCampaigns(db, company.id)).map((c) => c.status));
  await answer(company.id, card.id, "approve");
  await until("cap raised for D3 and the campaign resumed", async () => {
    const b = await adsBudget(company.id);
    return b.daily_extra_usd === 10 && b.daily_extra_date === simDay(3) && (await listCampaigns(db, company.id))[0]?.status === "active";
  }, { found: async () => ({ budget: await adsBudget(company.id), campaigns: (await listCampaigns(db, company.id)).map((c) => c.status) }) });
}

export async function phase5(ctx: Ctx): Promise<Ctx> {
  const providerCampaignId = await startCampaign(ctx.c1);
  await ownerDaySpend(ctx.c1);
  await capCardOnD3(ctx.c1, providerCampaignId);
  return checkpoint(ctx, 5);
}
