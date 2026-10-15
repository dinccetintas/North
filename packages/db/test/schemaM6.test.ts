import { trialEntitlement, trialGrant } from "@north/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createOwnerWithCompany, createTestUser, deleteTestUser, endEntitlement, grantPlan, raw, type OwnedCompany, type RawClient, type TestUser } from "./fixtures";

const slug = (label: string) => `${label}-${Math.random().toString(36).slice(2, 8)}`;
const asRaw = (user: TestUser): RawClient => user.client as unknown as RawClient;
const insertCompany = (client: RawClient, ownerId: string, label: string) => client.from("companies").insert({ owner_id: ownerId, name: `${label} Co`, slug: slug(label) }).select("id").single();

/** Database-level guarantees added by 0012_m6.sql (BIL-1, BIL-2, BRF-1, RET-1) and the trace id of 0013 (OBS-1). */
describe("M6 schema: entitlements, billing, credits, usage, companies", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("schema-m6");
    stranger = await createTestUser("schema-m6-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("BIL-1: a new auth user has a trialing Solo entitlement equal to core trialEntitlement, 300 credits (trial:<userId>) and users.plan 'solo'", async () => {
    const user = await createTestUser("schema-m6-trial");
    const { data: row } = await raw.from("entitlements").select("*").eq("user_id", user.id).single();
    const trial = trialEntitlement(user.id, new Date(row.period_start));
    expect({ planId: row.plan_id, status: row.status, companyLimit: row.company_limit, monthlyCredits: row.monthly_credits, priceUsd: Number(row.price_usd) }).toEqual({
      planId: trial.planId,
      status: trial.status,
      companyLimit: trial.companyLimit,
      monthlyCredits: trial.monthlyCredits,
      priceUsd: trial.priceUsd,
    });
    expect(new Date(row.period_end).toISOString()).toBe(trial.periodEnd);
    expect(row).toMatchObject({ cancel_at: null, stripe_customer_id: null, stripe_subscription_id: null, ended_at: null, retention_until: null, purge_due: false, last_event_created: null });
    const { data: entries } = await asRaw(user).from("credit_entries").select("kind, amount, ref, note").eq("user_id", user.id);
    const grant = trialGrant(user.id);
    expect(entries).toEqual([{ kind: grant.kind, amount: grant.amount, ref: grant.ref, note: grant.note }]);
    expect((await user.client.rpc("credit_balance", { p_user_id: user.id })).data).toBe(300);
    expect((await raw.from("users").select("plan").eq("id", user.id).single()).data?.plan).toBe("solo");
    await deleteTestUser(user);
  });

  it("BIL-1: the owner's second company is refused naming the limit, the service role is bound too, Pro allows three and archived companies do not count", async () => {
    const owner = await createOwnerWithCompany("schema-m6-limit");
    const second = await insertCompany(asRaw(owner.owner), owner.owner.id, "limit-2");
    expect(second.error?.code).toBe("23514");
    expect(second.error?.message).toMatch(/Solo includes 1 company/);
    expect((await insertCompany(raw, owner.owner.id, "limit-2-service")).error?.code).toBe("23514");
    await grantPlan(owner.owner.id, "pro");
    expect((await raw.from("users").select("plan").eq("id", owner.owner.id).single()).data?.plan).toBe("pro");
    expect((await insertCompany(asRaw(owner.owner), owner.owner.id, "limit-2")).error).toBeNull();
    const third = await insertCompany(asRaw(owner.owner), owner.owner.id, "limit-3");
    expect(third.error).toBeNull();
    const fourth = await insertCompany(asRaw(owner.owner), owner.owner.id, "limit-4");
    expect(fourth.error?.message).toMatch(/Pro includes 3 companies/);
    expect((await raw.from("companies").update({ status: "archived", kill_switch_active: true, paused_reason: "retention" }).eq("id", third.data!.id)).error).toBeNull();
    expect((await insertCompany(asRaw(owner.owner), owner.owner.id, "limit-4")).error).toBeNull();
    await deleteTestUser(owner.owner);
  });

  it("BIL-1: an ended owner cannot create any company; owners insert only their name, slug and owner", async () => {
    const user = await createTestUser("schema-m6-ended");
    const archivedInsert = await asRaw(user).from("companies").insert({ owner_id: user.id, name: "Sneaky Co", slug: slug("sneaky"), status: "archived" });
    expect(archivedInsert.error?.code).toBe("42501");
    await endEntitlement(user.id);
    const refused = await insertCompany(asRaw(user), user.id, "ended");
    expect(refused.error?.code).toBe("23514");
    expect(refused.error?.message).toMatch(/subscription has ended/);
    expect((await insertCompany(raw, user.id, "ended-service")).error?.code).toBe("23514");
    await deleteTestUser(user);
  });

  it("owners read their entitlement only and cannot insert or update entitlements, credit_entries or billing_events; billing_events and purge_log read nothing", async () => {
    const mine = asRaw(owned.owner);
    expect((await mine.from("entitlements").select("user_id")).data).toEqual([{ user_id: owned.owner.id }]);
    expect((await asRaw(stranger).from("entitlements").select("user_id").eq("user_id", owned.owner.id)).data).toEqual([]);
    expect((await mine.from("entitlements").update({ company_limit: 10, plan_id: "scale" }).eq("user_id", owned.owner.id).select("user_id")).error?.code).toBe("42501");
    expect((await mine.from("entitlements").insert({ user_id: stranger.id, plan_id: "scale", status: "active", company_limit: 10, monthly_credits: 1, period_start: new Date().toISOString(), period_end: new Date().toISOString() })).error).not.toBeNull();
    expect((await mine.from("credit_entries").insert({ user_id: owned.owner.id, kind: "grant_pack", amount: 1000, ref: "pack:forged" })).error?.code).toBe("42501");
    expect((await mine.from("billing_events").insert({ event_id: "evt_forged", type: "invoice.paid", payload: {} })).error?.code).toBe("42501");
    expect((await mine.from("billing_events").select("id")).data ?? []).toEqual([]);
    expect((await mine.from("purge_log").select("id")).data ?? []).toEqual([]);
    expect((await mine.from("users").update({ plan: "scale" }).eq("id", owned.owner.id)).error?.code).toBe("42501");
    expect((await raw.from("entitlements").select("company_limit").eq("user_id", owned.owner.id).single()).data?.company_limit).toBe(1);
  });

  it("billing_events: event_id is unique; append-only except applied_at, which is set once", async () => {
    const eventId = `evt_${slug("m6")}`;
    const row = await raw.from("billing_events").insert({ event_id: eventId, type: "invoice.paid", user_id: owned.owner.id, payload: { id: eventId } }).select("id").single();
    expect(row.error).toBeNull();
    expect((await raw.from("billing_events").insert({ event_id: eventId, type: "invoice.paid", payload: { id: eventId } })).error?.code).toBe("23505");
    expect((await raw.from("billing_events").insert({ event_id: `${eventId}-x`, type: "charge.refunded", payload: {} })).error?.code).toBe("23514");
    expect((await raw.from("billing_events").update({ applied_at: new Date().toISOString() }).eq("id", row.data!.id)).error).toBeNull();
    expect((await raw.from("billing_events").update({ applied_at: new Date().toISOString() }).eq("id", row.data!.id)).error?.message).toMatch(/append-only/);
    expect((await raw.from("billing_events").update({ payload: { forged: true } }).eq("id", row.data!.id)).error?.message).toMatch(/append-only/);
    expect((await raw.from("billing_events").delete().eq("id", row.data!.id)).error?.message).toMatch(/append-only/);
  });

  it("billing_sessions: the owner inserts only a requested row for themselves and never updates it", async () => {
    const mine = asRaw(owned.owner);
    const ok = await mine.from("billing_sessions").insert({ user_id: owned.owner.id, kind: "checkout", plan_id: "pro" }).select("id, status, url").single();
    expect(ok.data).toMatchObject({ status: "requested", url: null });
    expect((await mine.from("billing_sessions").insert({ user_id: owned.owner.id, kind: "checkout", plan_id: "pro", status: "ready", url: "https://evil.example" })).error).not.toBeNull();
    expect((await mine.from("billing_sessions").insert({ user_id: stranger.id, kind: "portal" })).error).not.toBeNull();
    expect((await mine.from("billing_sessions").insert({ user_id: owned.owner.id, kind: "checkout" })).error?.code).toBe("23514");
    expect((await mine.from("billing_sessions").update({ url: "https://evil.example" }).eq("id", ok.data!.id)).error?.code).toBe("42501");
    expect((await asRaw(stranger).from("billing_sessions").select("id").eq("id", ok.data!.id)).data).toEqual([]);
    expect((await raw.from("billing_sessions").update({ status: "ready" }).eq("id", ok.data!.id)).error?.code).toBe("23514");
  });

  it("BIL-2: credit refs are unique per user, entries are append-only, credit_balance sums and is owner-scoped; a consume below -5 is refused and -5 is not", async () => {
    const user = await createTestUser("schema-m6-credits");
    const insert = (kind: string, amount: number, ref: string) => raw.from("credit_entries").insert({ user_id: user.id, kind, amount, ref });
    const balance = async () => (await raw.rpc("credit_balance", { p_user_id: user.id })).data;
    expect((await insert("adjust", -300, "adjust:zero")).error).toBeNull();
    expect(await balance()).toBe(0);
    expect((await insert("consume", -6, "run:too-much")).error?.code).toBe("23514");
    expect((await insert("consume", -4, "run:a")).error).toBeNull();
    expect((await insert("consume", -1, "run:b")).error).toBeNull();
    expect(await balance()).toBe(-5);
    const floor = await insert("consume", -1, "run:c");
    expect(floor.error?.code).toBe("23514");
    expect(floor.error?.message).toMatch(/below -5/);
    expect((await insert("consume", -1, "run:b")).error?.code).toBe("23505");
    expect((await insert("grant_pack", -1, "pack:negative")).error?.code).toBe("23514");
    expect((await insert("adjust", 5, "adjust:back")).error).toBeNull();
    expect(await balance()).toBe(0);
    expect((await raw.from("credit_entries").update({ amount: 100 }).eq("user_id", user.id).eq("ref", "run:a")).error?.message).toMatch(/append-only/);
    expect((await raw.from("credit_entries").delete().eq("user_id", user.id)).error?.message).toMatch(/append-only/);
    expect((await stranger.client.rpc("credit_balance", { p_user_id: user.id })).data).toBe(0);
    expect((await user.client.rpc("credit_balance", { p_user_id: user.id })).data).toBe(0);
    await deleteTestUser(user);
  });

  it("BIL-2: usage_apply is an additive upsert per user and period, refused to authenticated, and owners only read their own rows", async () => {
    const args = { p_user_id: owned.owner.id, p_period: "2026-11", p_credits: 1, p_cost_usd: 0.5, p_sandbox_minutes: 2 };
    expect((await raw.rpc("usage_apply", args)).error).toBeNull();
    const second = await raw.rpc("usage_apply", { ...args, p_cost_usd: 0.25 });
    expect(second.data).toMatchObject({ user_id: owned.owner.id, period: "2026-11", credits_used: 2, llm_cost_usd: 0.75, sandbox_minutes: 4, alerted_at: null });
    expect((await owned.owner.client.rpc("usage_apply", args)).error).not.toBeNull();
    expect((await raw.rpc("usage_apply", { ...args, p_credits: -1 })).error?.code).toBe("23514");
    expect((await raw.rpc("usage_apply", { ...args, p_period: "2026-13" })).error?.code).toBe("22023");
    expect((await asRaw(owned.owner).from("usage").select("credits_used").eq("period", "2026-11")).data).toEqual([{ credits_used: 2 }]);
    expect((await asRaw(stranger).from("usage").select("id").eq("user_id", owned.owner.id)).data).toEqual([]);
    expect((await asRaw(owned.owner).from("usage").update({ credits_used: 0 }).eq("user_id", owned.owner.id)).error?.code).toBe("42501");
  });

  it("companies: the owner's kill switch reads 'user'; a billing pause or the archive is the worker's to lift; archived_at follows the status", async () => {
    const mine = asRaw(owned.owner);
    const reason = async () => (await raw.from("companies").select("kill_switch_active, paused_reason, status, archived_at").eq("id", owned.companyId).single()).data;
    expect((await mine.from("companies").update({ kill_switch_active: true, status: "paused" }).eq("id", owned.companyId)).error).toBeNull();
    expect(await reason()).toMatchObject({ kill_switch_active: true, paused_reason: "user" });
    expect((await mine.from("companies").update({ kill_switch_active: false, status: "active" }).eq("id", owned.companyId)).error).toBeNull();
    expect(await reason()).toMatchObject({ kill_switch_active: false, paused_reason: null });
    expect((await mine.from("companies").update({ paused_reason: "user" }).eq("id", owned.companyId)).error?.code).toBe("42501");
    expect((await raw.from("companies").update({ kill_switch_active: true, status: "paused", paused_reason: "subscription_ended" }).eq("id", owned.companyId)).error).toBeNull();
    const lift = await mine.from("companies").update({ kill_switch_active: false, status: "active" }).eq("id", owned.companyId);
    expect(lift.error?.code).toBe("23514");
    expect(lift.error?.message).toMatch(/subscribe to resume/);
    expect((await mine.from("companies").update({ name: "Renamed while paused" }).eq("id", owned.companyId)).error).toBeNull();
    expect((await mine.from("companies").update({ status: "archived" }).eq("id", owned.companyId)).error?.code).toBe("23514");
    expect((await raw.from("companies").update({ status: "archived", paused_reason: "retention" }).eq("id", owned.companyId)).error).toBeNull();
    expect(await reason()).toMatchObject({ status: "archived", paused_reason: "retention", archived_at: expect.any(String) });
    expect((await raw.from("companies").update({ status: "active", kill_switch_active: false }).eq("id", owned.companyId)).error).toBeNull();
    expect(await reason()).toMatchObject({ status: "active", kill_switch_active: false, paused_reason: null, archived_at: null });
  });

  it("BRF-1 and OBS-1: users.brief_hour defaults to 7 within 0..23; agent_runs carry a trace id", async () => {
    const mine = asRaw(owned.owner);
    expect((await mine.from("users").select("brief_hour").eq("id", owned.owner.id).single()).data?.brief_hour).toBe(7);
    expect((await mine.from("users").update({ brief_hour: 9 }).eq("id", owned.owner.id)).error).toBeNull();
    expect((await mine.from("users").update({ brief_hour: 24 }).eq("id", owned.owner.id)).error?.code).toBe("23514");
    const run = await raw.from("agent_runs").insert({ company_id: owned.companyId, role: "research", model: "m", runtime: "mock", status: "succeeded", trace_id: "trace-123" }).select("trace_id").single();
    expect(run.data?.trace_id).toBe("trace-123");
  });
});
