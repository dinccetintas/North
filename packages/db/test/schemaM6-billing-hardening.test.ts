import { createHash, randomUUID } from "node:crypto";
import { consumeEntry, endedEntitlement, UNKNOWN_BILLING_EVENT_DAYS } from "@north/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordAgentRun } from "../src/agentRuns";
import {
  createBillingSession,
  findBillingSessionByProviderRef,
  getBillingEvent,
  insertBillingEvent,
  listOpenCheckouts,
  markBillingEventApplied,
  markBillingSessionCompleted,
  setBillingSessionFailed,
  setBillingSessionReady,
  sweepUnknownBillingEvents,
} from "../src/billing";
import { creditBalance, insertCreditEntries, reserveCredit } from "../src/credits";
import { EntitlementConflictError, getEntitlement, listEntitlementsToHeal, listEntitlementsToReconcile, listRetentionDue, listTrialsToEnd, saveEntitlement, updateEntitlementIf } from "../src/entitlements";
import { maxRowsServiceClient, POSTGREST_MAX_ROWS } from "./max-rows";
import { DbError } from "../src/errors";
import { createOwnerWithCompany, createTestUser, deleteTestUser, raw, service, type OwnedCompany, type RawClient, type TestUser } from "./fixtures";

const rand = () => Math.random().toString(36).slice(2, 10);
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const DAY_MS = 86_400_000;
const asRaw = (user: TestUser): RawClient => user.client as unknown as RawClient;

/** 0016_m6_billing_hardening.sql: the M6 security review's billing findings (H1, L1, L2, L9, L10, M1). */
describe("M6 schema: billing hardening", () => {
  let owner: TestUser;
  let stranger: TestUser;
  let owned: OwnedCompany;

  beforeAll(async () => {
    owner = await createTestUser("billing-hardening");
    stranger = await createTestUser("billing-hardening-stranger");
    owned = await createOwnerWithCompany("billing-hardening-runs");
  });

  afterAll(async () => {
    await deleteTestUser(owner);
    await deleteTestUser(stranger);
    await deleteTestUser(owned.owner);
  });

  it("H1: billing_events accepts checkout.session.async_payment_succeeded; async_payment_failed is still refused by the type check", async () => {
    const eventId = `evt_${rand()}`;
    const stored = await insertBillingEvent(service, { eventId, type: "checkout.session.async_payment_succeeded", userId: owner.id, payload: { id: eventId }, payloadSha256: sha(eventId) });
    expect((await getBillingEvent(service, stored.id))?.type).toBe("checkout.session.async_payment_succeeded");
    const failed = await raw.from("billing_events").insert({ event_id: `evt_${rand()}`, type: "checkout.session.async_payment_failed", payload: {} });
    expect(failed.error?.code).toBe("23514");
  });

  it("L2: the sha256 of the raw body is stored with the reduced payload, checked for shape and never updated", async () => {
    const body = `{"id":"evt_raw_${rand()}","customer_email":"mara@example.test"}`;
    const eventId = `evt_${rand()}`;
    const stored = await insertBillingEvent(service, { eventId, type: "invoice.paid", userId: owner.id, payload: { id: eventId, type: "invoice.paid" }, payloadSha256: sha(body) });
    expect(await getBillingEvent(service, stored.id)).toMatchObject({ payloadSha256: sha(body), payload: { id: eventId, type: "invoice.paid" } });
    await expect(insertBillingEvent(service, { eventId: `evt_${rand()}`, type: "invoice.paid", userId: owner.id, payload: {}, payloadSha256: "not-a-hash" })).rejects.toThrow();
    expect((await raw.from("billing_events").insert({ event_id: `evt_${rand()}`, type: "invoice.paid", payload: {}, payload_sha256: "Z".repeat(64) })).error?.code).toBe("23514");
    expect((await raw.from("billing_events").update({ payload_sha256: sha("forged") }).eq("id", stored.id)).error).not.toBeNull();
    expect(await markBillingEventApplied(service, stored.id)).toBe(true);
    expect((await getBillingEvent(service, stored.id))?.payloadSha256).toBe(sha(body));
  });

  it(`L2: sweepUnknownBillingEvents removes unapplied rows no user owns after ${UNKNOWN_BILLING_EVENT_DAYS} days, on the database's clock; nothing else, and no one else can`, async () => {
    const at = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();
    const row = async (days: number, userId: string | null, applied = false) => {
      const eventId = `evt_sweep_${rand()}`;
      const { data, error } = await raw.from("billing_events").insert({ event_id: eventId, type: "customer.subscription.created", user_id: userId, payload: {}, received_at: at(days), applied_at: applied ? at(days) : null }).select("id").single();
      if (error) throw new Error(error.message);
      return data.id as string;
    };
    const old = await row(31, null);
    const young = await row(29, null);
    const owned = await row(31, owner.id);
    const applied = await row(31, null, true);
    expect((await raw.from("billing_events").delete().eq("id", old)).error).not.toBeNull();
    expect(await sweepUnknownBillingEvents(service, new Date(Date.now() + 365 * DAY_MS))).toBeGreaterThanOrEqual(1);
    const left = (await raw.from("billing_events").select("id").in("id", [old, young, owned, applied])).data?.map((r: { id: string }) => r.id);
    expect(new Set(left)).toEqual(new Set([young, owned, applied]));
    for (const user of [owner, stranger]) expect((await asRaw(user).rpc("billing_events_sweep_unknown", { p_before: new Date().toISOString() })).error).not.toBeNull();
  });

  it("L1 / L10: a session is found by its provider ref; completed once by the worker; open checkouts are the recent ready ones not completed", async () => {
    const checkout = await createBillingSession(owner.client, { userId: owner.id, kind: "checkout", planId: "pro" });
    const ref = `cs_${rand()}`;
    await setBillingSessionReady(service, checkout.id, { url: "http://127.0.0.1:3101/sandbox/billing/checkout/x", providerRef: ref });
    expect(await findBillingSessionByProviderRef(service, ref)).toMatchObject({ id: checkout.id, userId: owner.id, kind: "checkout", completedAt: null });
    expect(await findBillingSessionByProviderRef(service, `cs_${rand()}`)).toBeNull();
    expect(await findBillingSessionByProviderRef(stranger.client, ref)).toBeNull();
    const since = new Date(Date.now() - 35 * 60_000);
    expect((await listOpenCheckouts(service, owner.id, since)).map((s) => s.id)).toEqual([checkout.id]);
    const failed = await createBillingSession(owner.client, { userId: owner.id, kind: "checkout", planId: "solo" });
    await setBillingSessionFailed(service, failed.id, "The payment provider refused the request.");
    const portal = await createBillingSession(owner.client, { userId: owner.id, kind: "portal" });
    await setBillingSessionReady(service, portal.id, { url: "http://127.0.0.1:3101/sandbox/billing/portal/cus_x", providerRef: `bps_${rand()}` });
    expect((await listOpenCheckouts(service, owner.id, since)).map((s) => s.id)).toEqual([checkout.id]);
    expect(await listOpenCheckouts(service, owner.id, new Date(Date.now() + 60_000))).toEqual([]);
    await expect(markBillingSessionCompleted(owner.client, ref)).rejects.toBeInstanceOf(DbError);
    expect(await markBillingSessionCompleted(service, ref)).toBe(true);
    expect(await markBillingSessionCompleted(service, ref)).toBe(false);
    expect((await findBillingSessionByProviderRef(service, ref))?.completedAt).toEqual(expect.any(String));
    expect(await listOpenCheckouts(service, owner.id, since)).toEqual([]);
    const forged = await asRaw(owner).from("billing_sessions").insert({ user_id: owner.id, kind: "portal", completed_at: new Date().toISOString() });
    expect(forged.error).not.toBeNull();
    expect(await markBillingSessionCompleted(service, "x".repeat(300))).toBe(false);
  });

  it("L9: credit_reserve takes one credit only while the balance is above zero, once per ref, under the per-user lock; workers only", async () => {
    const user = await createTestUser("billing-hardening-reserve");
    expect(await reserveCredit(service, user.id, consumeEntry("44444444-4444-4444-8444-444444444441").ref)).toBe("reserved");
    expect(await reserveCredit(service, user.id, consumeEntry("44444444-4444-4444-8444-444444444441").ref)).toBe("exists");
    expect(await creditBalance(service, user.id)).toBe(299);
    await insertCreditEntries(service, user.id, [{ kind: "adjust", amount: -298, ref: "adjust:to-one", note: "test" }]);
    const refs = Array.from({ length: 20 }, () => `run:${randomUUID()}`);
    const outcomes = await Promise.all(refs.map((ref) => reserveCredit(service, user.id, ref)));
    expect(outcomes.filter((o) => o === "reserved")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "refused")).toHaveLength(19);
    expect(await creditBalance(service, user.id)).toBe(0);
    expect(await reserveCredit(service, user.id, `run:${randomUUID()}`)).toBe("refused");
    await expect(reserveCredit(user.client, user.id, `run:${randomUUID()}`)).rejects.toBeInstanceOf(DbError);
    await expect(reserveCredit(service, user.id, "")).rejects.toThrow();
    expect(await creditBalance(service, user.id)).toBe(0);
    await deleteTestUser(user);
  });

  it("L9: an agent run is recorded under the id its credit was reserved with", async () => {
    const id = randomUUID();
    const recorded = await recordAgentRun(service, { id, companyId: owned.companyId, role: "research", model: "mock", runtime: "mock", inputTokens: 1, outputTokens: 1, costUsd: 0, durationMs: 1, status: "succeeded" });
    expect(recorded).toBe(id);
  });

  it("L10: updateEntitlementIf writes only while the row is as expected; saveEntitlement refuses a row changed since it was read", async () => {
    const user = await createTestUser("billing-hardening-cas");
    try {
      const stale = (await getEntitlement(service, user.id))!;
      const sub = `sub_cas_${rand()}`;
      expect((await raw.from("entitlements").update({ status: "active", stripe_subscription_id: sub, last_event_created: 100 }).eq("user_id", user.id)).error).toBeNull();
      expect(await updateEntitlementIf(service, endedEntitlement(stale, new Date()), { status: "trialing", stripeSubscriptionId: null })).toBeNull();
      expect((await getEntitlement(service, user.id))?.status).toBe("active");
      await expect(saveEntitlement(service, stale, { ...stale, planId: "pro" })).rejects.toBeInstanceOf(EntitlementConflictError);
      const fresh = (await getEntitlement(service, user.id))!;
      const saved = await saveEntitlement(service, fresh, { ...fresh, planId: "pro", companyLimit: 3, lastEventCreated: 101 });
      expect(saved).toMatchObject({ planId: "pro", companyLimit: 3, lastEventCreated: 101, status: "active", stripeSubscriptionId: sub });
      expect((await raw.from("entitlements").update({ status: "trialing", stripe_subscription_id: null }).eq("user_id", user.id)).error).toBeNull();
      const ended = await updateEntitlementIf(service, endedEntitlement((await getEntitlement(service, user.id))!, new Date()), { status: "trialing", stripeSubscriptionId: null });
      expect(ended?.status).toBe("ended");
    } finally {
      await deleteTestUser(user);
    }
  });

  it("M1: listEntitlementsToReconcile finds live subscriptions whose cancel_at, else period_end, passed the cutoff; never a card-less trial or an ended row", async () => {
    const users = await Promise.all(["stale-active", "stale-canceled", "fresh", "trial", "ended"].map((l) => createTestUser(`reconcile-${l}`)));
    try {
      const [staleActive, staleCanceled, fresh, trial, ended] = users.map((u) => u.id) as [string, string, string, string, string];
      const at = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();
      const period = (endDays: number) => ({ period_start: at(endDays + 30), period_end: at(endDays) });
      const set = async (userId: string, patch: Record<string, unknown>) => expect((await raw.from("entitlements").update(patch).eq("user_id", userId)).error).toBeNull();
      await set(staleActive, { status: "active", stripe_subscription_id: `sub_${rand()}`, ...period(4) });
      await set(staleCanceled, { status: "canceled", stripe_subscription_id: `sub_${rand()}`, ...period(-20), cancel_at: at(5) });
      await set(fresh, { status: "past_due", stripe_subscription_id: `sub_${rand()}`, ...period(1) });
      await set(trial, period(10));
      await set(ended, { status: "ended", stripe_subscription_id: `sub_${rand()}`, ...period(10), ended_at: at(9), retention_until: at(-81) });
      const found = new Set((await listEntitlementsToReconcile(service, new Date(Date.now() - 3 * DAY_MS))).map((e) => e.userId));
      expect([staleActive, staleCanceled].map((id) => found.has(id))).toEqual([true, true]);
      expect([fresh, trial, ended].map((id) => found.has(id))).toEqual([false, false, false]);
    } finally {
      for (const user of users) await deleteTestUser(user);
    }
  });

  it("heal: listEntitlementsToHeal finds active, priced, subscribed rows whose period started before the cutoff; never past_due, a trial, $0 or a recent period", async () => {
    const users = await Promise.all(["heal-due", "heal-recent", "heal-past-due", "heal-trial", "heal-free"].map((l) => createTestUser(l)));
    try {
      const [due, recent, pastDue, trial, free] = users.map((u) => u.id) as [string, string, string, string, string];
      const at = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
      const set = async (userId: string, patch: Record<string, unknown>) => expect((await raw.from("entitlements").update(patch).eq("user_id", userId)).error).toBeNull();
      const paid = (startHours: number) => ({ status: "active", plan_id: "pro", price_usd: 299, monthly_credits: 1000, stripe_subscription_id: `sub_${rand()}`, period_start: at(startHours), period_end: at(startHours - 30 * 24) });
      await set(due, paid(25));
      await set(recent, paid(23));
      await set(pastDue, { ...paid(48), status: "past_due" });
      await set(trial, { period_start: at(48) });
      await set(free, { ...paid(48), price_usd: 0 });
      const found = new Set((await listEntitlementsToHeal(service, new Date(Date.now() - 24 * 3_600_000), new Date())).map((e) => e.userId));
      expect([due, recent, pastDue, trial, free].map((id) => found.has(id))).toEqual([true, false, false, false, false]);
    } finally {
      for (const user of users) await deleteTestUser(user);
    }
  });

  it("heal: a cancel-at-period-end row (canceled, period_end ahead) is listed; a canceled row whose period_end passed is not", async () => {
    const users = await Promise.all(["heal-canceled-running", "heal-canceled-over"].map((l) => createTestUser(l)));
    try {
      const [running, over] = users.map((u) => u.id) as [string, string];
      const at = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
      const set = async (userId: string, patch: Record<string, unknown>) => expect((await raw.from("entitlements").update(patch).eq("user_id", userId)).error).toBeNull();
      const paid = { status: "canceled", plan_id: "pro", price_usd: 299, monthly_credits: 1000 };
      await set(running, { ...paid, stripe_subscription_id: `sub_${rand()}`, period_start: at(48), period_end: at(-24 * 20), cancel_at: at(-24 * 20) });
      await set(over, { ...paid, stripe_subscription_id: `sub_${rand()}`, period_start: at(24 * 32), period_end: at(48), cancel_at: at(48) });
      const found = new Set((await listEntitlementsToHeal(service, new Date(Date.now() - 24 * 3_600_000), new Date())).map((e) => e.userId));
      expect([running, over].map((id) => found.has(id))).toEqual([true, false]);
    } finally {
      for (const user of users) await deleteTestUser(user);
    }
  });

  it(`the tick's lists read every row in pages under PostgREST's cap of ${POSTGREST_MAX_ROWS} (each asks again until a page is empty)`, async () => {
    const users = await Promise.all(["pages-trial", "pages-reconcile", "pages-heal", "pages-retention"].map((l) => createTestUser(l)));
    try {
      const at = (days: number) => new Date(Date.now() - days * DAY_MS).toISOString();
      const set = async (userId: string, patch: Record<string, unknown>) => expect((await raw.from("entitlements").update(patch).eq("user_id", userId)).error).toBeNull();
      await set(users[0]!.id, { period_start: at(20), period_end: at(6) });
      await set(users[1]!.id, { status: "active", price_usd: 299, stripe_subscription_id: `sub_${rand()}`, period_start: at(40), period_end: at(10) });
      await set(users[2]!.id, { status: "active", price_usd: 299, stripe_subscription_id: `sub_${rand()}`, period_start: at(2), period_end: at(-28) });
      await set(users[3]!.id, { status: "ended", period_start: at(200), period_end: at(170), ended_at: at(100), retention_until: at(10) });
      const capped = maxRowsServiceClient();
      const now = new Date();
      for (const list of [() => listTrialsToEnd(capped.client, now), () => listEntitlementsToReconcile(capped.client, now), () => listEntitlementsToHeal(capped.client, now, now), () => listRetentionDue(capped.client, now)]) {
        const before = capped.limits.length;
        expect((await list()).length).toBeGreaterThan(0);
        expect(capped.limits.length - before).toBeGreaterThanOrEqual(2);
      }
      expect(capped.limits.every((limit) => limit <= POSTGREST_MAX_ROWS)).toBe(true);
      expect(capped.cut).toEqual([]);
    } finally {
      for (const user of users) await deleteTestUser(user);
    }
  });
});
