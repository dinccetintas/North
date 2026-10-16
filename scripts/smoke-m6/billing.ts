/**
 * The subscription phases of the M6 smoke (docs/plans/M6.md "Acceptance
 * test" 1, 2, 6 and 8) and the billing helpers the other phases share: a
 * billing session the owner's client requests and the worker fulfils, the
 * sandbox checkout and portal buttons, the stored events, the credit ledger
 * and the owner's notifications. Every entitlement change goes through the
 * worker's own `/webhooks/stripe`; the harness never writes one.
 */
import { EVENT, isActive, retentionUntil, TASK_OWNER, TRIAL_DAYS, type Entitlement, type SubscriptionPlanId, type TaskType } from "@north/core";
import { localDay } from "@north/core/time";
import {
  answerCard,
  createBillingSession,
  createCompany,
  createGoal,
  createTask,
  creditBalance,
  EntitlementError,
  getBillingSession,
  getEntitlement,
  getProfile,
  getTask,
  listCampaigns,
  listCompaniesByOwner,
  listPendingCards,
  setOnboardingStep,
  upsertBudgets,
  type BillingSessionRecord,
  type DbClient,
  type TaskRecord,
} from "@north/db";
import { SANDBOX_STRIPE_API_VERSION } from "../../packages/integrations/src/sandbox/billing-events";
import {
  assert,
  check,
  checkpoint,
  countRows,
  DAY_MS,
  db,
  eventsSince,
  observe,
  postStripeWebhook,
  pressSandboxButton,
  SANDBOX_BASE_URL,
  send,
  show,
  sleep,
  stripeSignature,
  TIMEZONE,
  until,
  withFacts,
  workerNow,
  type Company,
  type Ctx,
} from "./harness";

export const THESIS = "Bookkeeping for solo consultants that closes the month in one click.";
const SESSION_MAX_MS = 10_000;

/* ---------- shared helpers ---------- */

export const required = <T>(value: T | null | undefined, what: string): T => {
  assert(value !== null && value !== undefined, `${what} is missing`);
  return value;
};

/** A company created with the owner's own client (the trigger is the authority), then given a goal and budgets and marked onboarded. */
export async function onboard(owner: DbClient, ownerId: string, name: string, ads: { readonly total: number; readonly daily: number }): Promise<Company> {
  const company = await createCompany(owner, { ownerId, name, thesis: THESIS, targetCustomer: "solo consultants" });
  await createGoal(db, company.id, { metricKey: "signups", targetValue: 50, dueDate: "2026-12-31" });
  await upsertBudgets(db, company.id, [{ category: "ads", totalLimitUsd: ads.total, dailyLimitUsd: ads.daily }]);
  await setOnboardingStep(db, company.id, "done");
  return { id: company.id, slug: company.slug, name: company.name };
}

/** The CEO answers a card (the only user decision in the run). */
export async function answer(companyId: string, cardId: string, optionId: "approve" | "decline"): Promise<void> {
  await answerCard(db, cardId, { optionId, answeredBy: "user" });
  await send(EVENT.decisionAnswered, { companyId, cardId, optionId, answeredBy: "user" });
}

export const taskWhere = (taskId: string, status: TaskRecord["status"]) => async (): Promise<TaskRecord | null> => {
  const t = await getTask(db, taskId);
  return t?.status === status ? t : null;
};

/** A queued task of one type for its owning role; `dispatch: false` leaves it queued. */
export async function newTask(company: Company, taskType: TaskType, dispatch = true): Promise<TaskRecord> {
  const task = await createTask(db, { companyId: company.id, role: TASK_OWNER[taskType], taskType, title: `${taskType} for ${company.name}`, metricKey: "artifacts", expectedDelta: 1 });
  if (dispatch) await send(EVENT.taskDispatch, { companyId: company.id, taskId: task.id });
  return task;
}

/** A K0 task dispatched and finished with verified artifact evidence. */
export async function doneTask(company: Company, taskType: TaskType): Promise<TaskRecord> {
  const task = await newTask(company, taskType);
  const done = await until(`${taskType} done (${company.slug})`, taskWhere(task.id, "done"), { found: () => getTask(db, task.id) });
  check(done.evidence?.kind === "artifact_id" && done.evidence.verified, `${taskType} evidence`, "verified artifact_id", done.evidence);
  return done;
}

export type SessionAsk = { readonly kind: "checkout"; readonly planId: SubscriptionPlanId } | { readonly kind: "portal" } | { readonly kind: "credit_pack"; readonly packId: string };

/** The web's path: the owner inserts a `requested` row and sends `billing/session_requested`; the worker makes it `ready` within 10 s. */
export async function readySession(ctx: Ctx, ask: SessionAsk): Promise<BillingSessionRecord & { readonly url: string }> {
  const requested = await createBillingSession(ctx.owner, { userId: ctx.ownerId, ...ask });
  check(requested.status === "requested" && requested.url === null, `${ask.kind} session row`, "requested, no url (the owner may insert nothing else)", requested);
  const sentAt = Date.now();
  await send(EVENT.billingSessionRequested, { sessionId: requested.id, userId: ctx.ownerId });
  const settled = await until(`${ask.kind} session ready`, async () => {
    const s = await getBillingSession(db, requested.id);
    return s && s.status !== "requested" ? s : null;
  }, { timeoutMs: SESSION_MAX_MS * 3, intervalMs: 250 });
  const ms = Date.now() - sentAt;
  check(settled.status === "ready" && settled.url !== null && ms <= SESSION_MAX_MS, `${ask.kind} session`, `ready with a url within ${SESSION_MAX_MS} ms`, { status: settled.status, error: settled.error, ms });
  return { ...settled, url: settled.url ?? "" };
}

/** "Pay" on the sandbox checkout page; a redirect must lead back to `/settings/billing?checkout=<session>`. */
export async function completeCheckout(session: BillingSessionRecord & { readonly url: string }): Promise<void> {
  check(session.url.startsWith(`${SANDBOX_BASE_URL}/sandbox/billing/checkout/`), "checkout url", `under ${SANDBOX_BASE_URL}/sandbox/billing/checkout/`, session.url);
  const r = await pressSandboxButton(`${session.url}/complete`);
  if (r.status >= 300) check(r.location?.includes(`/settings/billing?checkout=${session.id}`), "checkout success redirect", `/settings/billing?checkout=${session.id}`, r.location);
}

export interface StoredEvent {
  readonly id: string;
  readonly eventId: string;
  readonly type: string;
  readonly appliedAt: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
}

export async function billingEventsOf(userId: string): Promise<readonly StoredEvent[]> {
  const { data, error } = await db.from("billing_events").select("id, event_id, type, applied_at, payload, received_at").eq("user_id", userId).order("received_at", { ascending: true });
  assert(!error, `could not read billing_events: ${error?.message}`);
  return Object.freeze((data ?? []).map((r) => ({ id: r.id, eventId: r.event_id, type: r.type, appliedAt: r.applied_at, payload: (r.payload ?? {}) as Record<string, unknown> })));
}

/** Waits for the owner's `total`-th stored event and every one applied; returns them oldest first. */
export async function untilApplied(userId: string, total: number, label: string): Promise<readonly StoredEvent[]> {
  const rows = await until(`${label}: ${total} billing_events, each applied`, async () => {
    const r = await billingEventsOf(userId);
    return r.length >= total && r.every((e) => e.appliedAt !== null) ? r : null;
  }, { intervalMs: 300, found: async () => (await billingEventsOf(userId)).map((e) => `${e.type}:${e.appliedAt ? "applied" : "pending"}`) });
  check(rows.length === total, `${label} billing_events`, `exactly ${total}`, rows.map((e) => e.type));
  return rows;
}

export const entitlementWhere = (userId: string, ok: (e: Entitlement) => boolean) => async (): Promise<Entitlement | null> => {
  const e = await getEntitlement(db, userId);
  return e && ok(e) ? e : null;
};

export interface Credit {
  readonly kind: string;
  readonly amount: number;
  readonly ref: string;
}

export async function creditsOf(userId: string): Promise<readonly Credit[]> {
  const { data, error } = await db.from("credit_entries").select("kind, amount, ref, created_at").eq("user_id", userId).order("created_at", { ascending: true });
  assert(!error, `could not read credit_entries: ${error?.message}`);
  return Object.freeze((data ?? []).map((r) => ({ kind: r.kind, amount: r.amount, ref: r.ref })));
}

/** `plan:<subscription>:<periodStart>` for the entitlement's subscription and period start (the instant, whatever its ISO form). */
export const isPlanRef = (ref: string, subscriptionId: string, periodStart: string): boolean =>
  ref.startsWith(`plan:${subscriptionId}:`) && Date.parse(ref.slice(`plan:${subscriptionId}:`.length)) === Date.parse(periodStart);

export interface Alerts {
  readonly push: number;
  readonly email: number;
}

/** The owner's `usage_alert` notifications per channel. */
export async function usageAlerts(userId: string): Promise<Alerts> {
  const { data, error } = await db.from("notifications").select("channel").eq("user_id", userId).eq("kind", "usage_alert");
  assert(!error, `could not read notifications: ${error?.message}`);
  const rows = data ?? [];
  return { push: rows.filter((r) => r.channel === "push").length, email: rows.filter((r) => r.channel === "email").length };
}

/* ---------- phase 1: trial and the limit ---------- */

const errorText = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : show(e));

/** The trial the auth trigger granted: Solo, one company, 14 days from sign-up, 300 credits as `trial:<userId>`, `users.plan` solo. */
async function trialChecks(ownerId: string): Promise<void> {
  const e = required(await getEntitlement(db, ownerId), "the trial entitlement");
  check(e.status === "trialing" && e.planId === "solo" && e.companyLimit === 1, "trial entitlement", "trialing, solo, company_limit 1", e);
  const days = (Date.parse(e.periodEnd) - Date.parse(e.periodStart)) / DAY_MS;
  check(days === TRIAL_DAYS && Math.abs(Date.parse(e.periodStart) - Date.now()) < 10 * 60_000, "trial period", `period_end = sign-up + ${TRIAL_DAYS} d`, { periodStart: e.periodStart, periodEnd: e.periodEnd });
  const credits = await creditsOf(ownerId);
  check(credits.length === 1 && credits[0]?.ref === `trial:${ownerId}` && credits[0].amount === 300 && credits[0].kind === "grant_plan", "trial credits", `one grant_plan 300 with ref trial:${ownerId}`, credits);
  check((await creditBalance(db, ownerId)) === 300, "credit_balance", "300", await creditBalance(db, ownerId));
  check((await getProfile(db, ownerId))?.plan === "solo", "users.plan", "solo", (await getProfile(db, ownerId))?.plan);
}

export async function phase1(base: Omit<Ctx, "c1" | "c2" | "tally">): Promise<Ctx> {
  await trialChecks(base.ownerId);
  const c1 = await onboard(base.owner, base.ownerId, `Month Close Co ${Date.now().toString(36)}`, { total: 2000, daily: 205 });
  const second = (client: DbClient) => createCompany(client, { ownerId: base.ownerId, name: `Second Co ${Date.now().toString(36)}`, thesis: THESIS }).then(() => null, (e: unknown) => e);
  const byOwner = await second(base.owner);
  check(byOwner instanceof EntitlementError && byOwner.reason === "limit" && byOwner.message.includes("1 company"), "company 2 (owner's client)", 'EntitlementError naming "1 company"', errorText(byOwner));
  const byService = await second(db);
  check(byService instanceof EntitlementError && byService.reason === "limit", "company 2 (service role)", "EntitlementError: the trigger binds the service role too", errorText(byService));
  check((await listCompaniesByOwner(db, base.ownerId)).length === 1, "companies after the refusals", "1", (await listCompaniesByOwner(db, base.ownerId)).map((c) => c.slug));
  return checkpoint(observe({ ...base, c1, c2: null, tally: [] }, "trialing"), 1);
}

/* ---------- phase 2: subscribe (Pro) ---------- */

/** One byte of the event id changed: were the signature not checked, a new row would appear. */
function tamper(body: string, eventId: string): { readonly body: string; readonly eventId: string } {
  const last = eventId.slice(-1);
  const forged = `${eventId.slice(0, -1)}${last === "x" ? "y" : "x"}`;
  return { body: body.replace(`"${eventId}"`, `"${forged}"`), eventId: forged };
}

async function refundBody(customerId: string): Promise<{ readonly body: string; readonly eventId: string }> {
  const stamp = Date.now().toString(36);
  const eventId = `evt_smoke_m6_refund_${stamp}`;
  const created = Math.floor((await workerNow()).getTime() / 1000);
  const object = { id: `ch_smoke_m6_${stamp}`, object: "charge", customer: customerId, amount_refunded: 2900, currency: "usd" };
  return { eventId, body: JSON.stringify({ id: eventId, object: "event", api_version: SANDBOX_STRIPE_API_VERSION, created, livemode: false, type: "charge.refunded", data: { object } }) };
}

/** The same signed `invoice.paid` again → 200 duplicate; one byte tampered → 401; a `charge.refunded` → 200 ignored; nothing new stored. */
async function webhookEdges(ctx: Ctx, customerId: string): Promise<void> {
  const paid = required((await billingEventsOf(ctx.ownerId)).find((e) => e.type === "invoice.paid"), "the stored invoice.paid");
  const body = JSON.stringify(paid.payload);
  const signature = await stripeSignature(body);
  const replay = await postStripeWebhook(body, signature);
  check(replay.status === 200 && replay.json.duplicate === true, "invoice.paid replay", "200 { duplicate: true }", replay);
  const forged = tamper(body, paid.eventId);
  const refused = await postStripeWebhook(forged.body, signature);
  check(refused.status === 401, "tampered body", "401", refused);
  const refund = await refundBody(customerId);
  const ignored = await postStripeWebhook(refund.body, await stripeSignature(refund.body));
  check(ignored.status === 200 && "ignored" in ignored.json, "charge.refunded", "200 { ignored }", ignored);
  const after = await billingEventsOf(ctx.ownerId);
  check(after.length === 3 && !after.some((e) => e.eventId === forged.eventId || e.eventId === refund.eventId), "billing_events after the edges", "still the three rows", after.map((e) => e.eventId));
  check((await creditBalance(db, ctx.ownerId)) === 1300, "balance after the replay", "1300 (nothing granted twice)", await creditBalance(db, ctx.ownerId));
}

export async function phase2(ctx: Ctx): Promise<Ctx> {
  const session = await readySession(ctx, { kind: "checkout", planId: "pro" });
  await completeCheckout(session);
  const events = await untilApplied(ctx.ownerId, 3, "Pro checkout");
  check(events.map((e) => e.type).sort().join(",") === "checkout.session.completed,customer.subscription.created,invoice.paid", "Pro checkout events", "checkout.session.completed, customer.subscription.created, invoice.paid", events.map((e) => e.type));
  const pro = await until("entitlement Pro active", entitlementWhere(ctx.ownerId, (e) => e.status === "active" && e.planId === "pro"), { found: () => getEntitlement(db, ctx.ownerId) });
  check(pro.companyLimit === 3 && pro.monthlyCredits === 1000 && pro.stripeCustomerId !== null && pro.stripeSubscriptionId !== null, "Pro entitlement", "company_limit 3, monthly_credits 1000, Stripe ids set", pro);
  const sub = required(pro.stripeSubscriptionId, "the subscription id");
  const grants = (await creditsOf(ctx.ownerId)).filter((e) => e.kind === "grant_plan" && e.ref.startsWith("plan:"));
  check(grants.length === 1 && grants[0]?.amount === 1000 && isPlanRef(grants[0].ref, sub, pro.periodStart), "Pro credits", `+1000 grant_plan with ref plan:${sub}:${pro.periodStart}`, grants);
  check((await creditBalance(db, ctx.ownerId)) === 1300, "balance", "1300", await creditBalance(db, ctx.ownerId));
  check((await getProfile(db, ctx.ownerId))?.plan === "pro", "users.plan", "pro (the mirror trigger)", (await getProfile(db, ctx.ownerId))?.plan);
  await webhookEdges(ctx, required(pro.stripeCustomerId, "the customer id"));
  const c2 = await onboard(ctx.owner, ctx.ownerId, `Second Ledger Co ${Date.now().toString(36)}`, { total: 300, daily: 20 });
  return checkpoint(withFacts(observe({ ...ctx, c2 }, "active"), { proSubscription: sub }), 2);
}

/* ---------- phase 6: cancel, period end, agents paused ---------- */

/** Portal "End now": within 5 s the entitlement is ended, both companies carry the billing pause and company 1's campaign is paused_kill. */
async function endWithinSla(ctx: Ctx, portalUrl: string): Promise<{ readonly ms: number; readonly ended: Entitlement; readonly startedAt: number }> {
  const startedAt = Date.now();
  await pressSandboxButton(`${portalUrl}/end`);
  const ended = await until("ended entitlement, both companies paused for the subscription, campaigns paused_kill", async () => {
    const e = await getEntitlement(db, ctx.ownerId);
    const companies = await listCompaniesByOwner(db, ctx.ownerId);
    const campaigns = await listCampaigns(db, ctx.c1.id);
    const paused = companies.length === 2 && companies.every((c) => c.killSwitchActive && c.pausedReason === "subscription_ended");
    return e?.status === "ended" && paused && campaigns.length > 0 && campaigns.every((c) => c.status === "paused_kill") ? e : null;
  }, { timeoutMs: 20_000, intervalMs: 100, found: async () => ({ entitlement: (await getEntitlement(db, ctx.ownerId))?.status, companies: await listCompaniesByOwner(db, ctx.ownerId), campaigns: (await listCampaigns(db, ctx.c1.id)).map((c) => c.status) }) });
  return { ms: Date.now() - startedAt, ended, startedAt };
}

/** Under the billing pause: `company/killswitch` per company, dispatch refused (tasks stay queued, no new run), resume refused. */
async function pausedChecks(ctx: Ctx, startedAt: number): Promise<readonly string[]> {
  const c2 = required(ctx.c2, "company 2");
  const ours = new Set([ctx.c1.id, c2.id]);
  const kills = await until("two company/killswitch events", async () => {
    const ev = (await eventsSince(EVENT.companyKillSwitch, startedAt - 2000)).filter((e) => ours.has(String(e.data.companyId)));
    return new Set(ev.map((e) => e.data.companyId)).size === 2 ? ev : null;
  }, { timeoutMs: 15_000, intervalMs: 500 });
  check(kills.length === 2, "company/killswitch events", "one per company (2)", kills.map((e) => e.data.companyId));
  const runsAtEnd = await countRows("agent_runs", "company_id", [...ours]);
  const queued = [await newTask(ctx.c1, "market_report"), await newTask(c2, "market_report")];
  await sleep(6000);
  const states = await Promise.all(queued.map((t) => getTask(db, t.id)));
  check(states.every((t) => t?.status === "queued"), "dispatch while ended", "both tasks stay queued", states.map((t) => t?.status));
  check((await countRows("agent_runs", "company_id", [...ours])) === runsAtEnd, "agent_runs after the end", `still ${runsAtEnd} (no new run)`, await countRows("agent_runs", "company_id", [...ours]));
  return queued.map((t) => t.id);
}

export async function phase6Billing(ctx: Ctx): Promise<{ readonly ctx: Ctx; readonly queued: readonly string[] }> {
  const portal = await readySession(ctx, { kind: "portal" });
  const customer = required((await getEntitlement(db, ctx.ownerId))?.stripeCustomerId, "the customer id");
  check(portal.url === `${SANDBOX_BASE_URL}/sandbox/billing/portal/${customer}`, "portal url", `${SANDBOX_BASE_URL}/sandbox/billing/portal/${customer}`, portal.url);
  await pressSandboxButton(`${portal.url}/cancel`);
  await untilApplied(ctx.ownerId, 5, "portal cancel");
  const canceled = await until("entitlement canceled", entitlementWhere(ctx.ownerId, (e) => e.status === "canceled"), { found: () => getEntitlement(db, ctx.ownerId) });
  check(canceled.cancelAt !== null && Date.parse(canceled.cancelAt) === Date.parse(canceled.periodEnd) && isActive(canceled), "canceled entitlement", "cancel_at = period_end, still isActive", canceled);
  await doneTask(required(ctx.c2, "company 2"), "personas");
  const { ms, ended, startedAt } = await endWithinSla(ctx, portal.url);
  check(ms <= 5000, "kill switch on subscription end", "≤ 5000 ms from the portal's end", `${ms} ms`);
  await untilApplied(ctx.ownerId, 6, "portal end");
  const endedAt = required(ended.endedAt, "ended_at");
  check(ended.retentionUntil !== null && Date.parse(ended.retentionUntil) === Date.parse(retentionUntil(endedAt)), "retention_until", `ended_at + 90 d (${retentionUntil(endedAt)})`, ended.retentionUntil);
  const queued = await pausedChecks(ctx, startedAt);
  const next = withFacts(observe(observe(ctx, "canceled"), "ended"), { killSwitchMs: ms, portalUrl: portal.url, endedAt });
  return { ctx: next, queued };
}

/* ---------- phase 8: re-subscribe ---------- */

/** Both companies running again (company 2 over the Solo limit is not archived), two `company/resume`, one resume card approved. */
async function reactivated(ctx: Ctx, startedAt: number, queued: readonly string[]): Promise<void> {
  const c2 = required(ctx.c2, "company 2");
  const ours = new Set([ctx.c1.id, c2.id]);
  await until("both companies running again", async () => {
    const companies = await listCompaniesByOwner(db, ctx.ownerId);
    return companies.length === 2 && companies.every((c) => !c.killSwitchActive && c.pausedReason === null && c.status === "active");
  }, { found: () => listCompaniesByOwner(db, ctx.ownerId) });
  const resumes = await until("two company/resume events", async () => {
    const ev = (await eventsSince(EVENT.companyResume, startedAt)).filter((e) => ours.has(String(e.data.companyId)));
    return new Set(ev.map((e) => e.data.companyId)).size === 2 ? ev : null;
  }, { timeoutMs: 20_000, intervalMs: 500 });
  check(resumes.length === 2, "company/resume events", "one per company (2)", resumes.map((e) => e.data.companyId));
  const card = await until("the M4 resume card", async () => (await listPendingCards(db, ctx.c1.id)).find((c) => c.actionKind === "ads.resume"), { found: () => listPendingCards(db, ctx.c1.id) });
  const today = localDay(TIMEZONE, await workerNow());
  check(card.tier === "K2" && card.day === today, "resume card", `K2 ads.resume on ${today}`, { tier: card.tier, day: card.day });
  await answer(ctx.c1.id, card.id, "approve");
  await until("company 1's campaign active again", async () => (await listCampaigns(db, ctx.c1.id)).every((c) => c.status === "active"), { found: async () => (await listCampaigns(db, ctx.c1.id)).map((c) => c.status) });
  for (const taskId of queued) await until(`queued task ${taskId} dispatched again and done`, taskWhere(taskId, "done"), { found: () => getTask(db, taskId) });
}

/** Portal "advance": `invoice.paid` for the next period → +300 under the new period's ref, an `expire` for the old period, the old grant untouched. */
async function periodRoll(ctx: Ctx, sub: string, firstRef: string): Promise<void> {
  const expiresBefore = (await creditsOf(ctx.ownerId)).filter((e) => e.kind === "expire").length;
  const subGrants = async (): Promise<readonly Credit[]> => (await creditsOf(ctx.ownerId)).filter((e) => e.kind === "grant_plan" && e.ref.startsWith(`plan:${sub}:`));
  await pressSandboxButton(`${String(ctx.facts.portalUrl)}/advance`);
  await untilApplied(ctx.ownerId, 10, "period advance");
  const grants = await until("the next period's grant", async () => {
    const g = await subGrants();
    return g.length >= 2 ? g : null;
  }, { found: subGrants });
  const rolled = required(await getEntitlement(db, ctx.ownerId), "the entitlement");
  check(grants.length === 2 && grants.every((g) => g.amount === 300) && grants.some((g) => isPlanRef(g.ref, sub, rolled.periodStart)) && grants.some((g) => g.ref === firstRef), "period roll grants", `+300 under plan:${sub}:${rolled.periodStart}, ${firstRef} unchanged`, grants);
  const credits = await creditsOf(ctx.ownerId);
  const expires = credits.filter((e) => e.kind === "expire");
  check(expires.length === expiresBefore + 1 && (expires[expires.length - 1]?.amount ?? 0) < 0 && (expires[expires.length - 1]?.ref ?? "").startsWith("expire:"), "period roll expiry", "one new expire entry (negative, ref expire:<periodStart>)", expires);
}

export async function phase8(ctx: Ctx, queued: readonly string[]): Promise<Ctx> {
  const startedAt = Date.now();
  const session = await readySession(ctx, { kind: "checkout", planId: "solo" });
  await completeCheckout(session);
  await untilApplied(ctx.ownerId, 9, "Solo checkout");
  const solo = await until("entitlement Solo active", entitlementWhere(ctx.ownerId, (e) => e.status === "active" && e.planId === "solo"), { found: () => getEntitlement(db, ctx.ownerId) });
  const sub = required(solo.stripeSubscriptionId, "the new subscription id");
  check(solo.companyLimit === 1 && sub !== ctx.facts.proSubscription && solo.endedAt === null && solo.retentionUntil === null, "Solo entitlement", "company_limit 1, a new subscription, end and retention cleared", solo);
  const firstGrant = (await creditsOf(ctx.ownerId)).find((e) => e.kind === "grant_plan" && isPlanRef(e.ref, sub, solo.periodStart));
  check(firstGrant?.amount === 300, "Solo credits", `+300 under plan:${sub}:${solo.periodStart}`, firstGrant);
  await reactivated(ctx, startedAt, queued);
  await periodRoll(ctx, sub, required(firstGrant, "the Solo grant").ref);
  return checkpoint(observe(ctx, "active"), 8);
}
