import { applyBillingEvent, trialEntitlement, type BillingEvent, type Entitlement } from "@north/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createCompany } from "../src/companies";
import {
  EntitlementError,
  getEntitlement,
  getEntitlementForCompany,
  listRetentionDue,
  listTrialsToEnd,
  setPurgeDue,
  setStripeCustomer,
  upsertEntitlement,
} from "../src/entitlements";
import { DbError } from "../src/errors";
import { createOwnerWithCompany, createTestUser, deleteTestUser, raw, service, type OwnedCompany, type TestUser } from "./fixtures";

const NOW = new Date("2026-11-02T04:00:00.000Z");
const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);
const subscriptionCreated = (customer: string, subscription: string): BillingEvent => ({
  id: `evt_${subscription}`,
  type: "customer.subscription.created",
  created: unix("2026-11-02T04:00:10.000Z"),
  data: {
    object: {
      id: subscription,
      customer,
      status: "active",
      cancel_at_period_end: false,
      cancel_at: null,
      current_period_start: unix("2026-11-02T04:00:00.000Z"),
      current_period_end: unix("2026-12-02T04:00:00.000Z"),
      items: { data: [{ price: { lookup_key: "north_pro_monthly" } }] },
      metadata: {},
    },
  },
});

describe("entitlements repository (BIL-1)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("entitlements");
    stranger = await createTestUser("entitlements-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("getEntitlement returns the trial as the core Entitlement to its owner and the worker; a stranger reads null", async () => {
    const mine = await getEntitlement(owned.owner.client, owned.owner.id);
    expect(mine).toMatchObject({ userId: owned.owner.id, planId: "solo", status: "trialing", companyLimit: 1, monthlyCredits: 300, priceUsd: 0, purgeDue: false, lastEventCreated: null });
    expect(Object.isFrozen(mine)).toBe(true);
    expect(await getEntitlement(service, owned.owner.id)).toEqual(mine);
    expect(await getEntitlement(stranger.client, owned.owner.id)).toBeNull();
    expect(await getEntitlementForCompany(service, owned.companyId)).toEqual(mine);
    expect(await getEntitlementForCompany(stranger.client, owned.companyId)).toBeNull();
    expect(await getEntitlementForCompany(service, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("upsertEntitlement persists the pure projection (service role only) and the plan mirror follows", async () => {
    const before = (await getEntitlement(service, owned.owner.id))!;
    const customer = await setStripeCustomer(service, owned.owner.id, `cus_${owned.owner.id.slice(0, 8)}`);
    expect(customer.stripeCustomerId).toBe(`cus_${owned.owner.id.slice(0, 8)}`);
    expect(await setStripeCustomer(service, owned.owner.id, `cus_${owned.owner.id.slice(0, 8)}`)).toEqual(customer);
    await expect(setStripeCustomer(service, owned.owner.id, "cus_other")).rejects.toBeInstanceOf(DbError);
    const after = applyBillingEvent({ ...before, stripeCustomerId: customer.stripeCustomerId }, subscriptionCreated(customer.stripeCustomerId!, `sub_${owned.owner.id.slice(0, 8)}`), NOW);
    const saved = await upsertEntitlement(service, after);
    expect(saved).toEqual(after);
    expect(saved).toMatchObject({ planId: "pro", status: "active", companyLimit: 3, monthlyCredits: 1000, priceUsd: 299, periodEnd: "2026-12-02T04:00:00.000Z" });
    expect((await raw.from("users").select("plan").eq("id", owned.owner.id).single()).data?.plan).toBe("pro");
    await expect(upsertEntitlement(owned.owner.client, { ...after, companyLimit: 10 })).rejects.toBeInstanceOf(DbError);
    await expect(upsertEntitlement(service, { ...after, companyLimit: 0 } as Entitlement)).rejects.toThrow();
    expect((await getEntitlement(service, owned.owner.id))?.companyLimit).toBe(3);
  });

  it("createCompany maps the trigger's refusal to EntitlementError naming the limit, or the end of the subscription", async () => {
    const user = await createTestUser("entitlements-limit");
    await createCompany(user.client, { ownerId: user.id, name: "First Co", thesis: "The first company is always within the trial." });
    const limit = await createCompany(user.client, { ownerId: user.id, name: "Second Co", thesis: "A second company is over the Solo limit." }).catch((e: unknown) => e);
    expect(limit).toBeInstanceOf(EntitlementError);
    expect(limit).toMatchObject({ reason: "limit", limit: 1 });
    expect((limit as Error).message).toMatch(/Solo includes 1 company/);
    const ended = { ...(await getEntitlement(service, user.id))!, status: "ended" as const, endedAt: NOW.toISOString(), retentionUntil: "2027-01-31T04:00:00.000Z" };
    await upsertEntitlement(service, ended);
    const refused = await createCompany(service, { ownerId: user.id, name: "Third Co", thesis: "Nothing is created after the end." }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ reason: "ended", limit: null });
    await deleteTestUser(user);
  });

  it("listTrialsToEnd and listRetentionDue find what the ticks act on; setPurgeDue marks it", async () => {
    const trial = await createTestUser("entitlements-trial-ends");
    const past = trialEntitlement(trial.id, new Date("2026-10-01T00:00:00.000Z"));
    await upsertEntitlement(service, past);
    const trials = await listTrialsToEnd(service, NOW);
    expect(trials.some((e) => e.userId === trial.id)).toBe(true);
    expect(trials.some((e) => e.userId === owned.owner.id)).toBe(false);
    expect((await listTrialsToEnd(service, new Date("2026-10-14T23:59:00.000Z"))).some((e) => e.userId === trial.id)).toBe(false);

    const ended = { ...past, status: "ended" as const, endedAt: "2026-07-01T00:00:00.000Z", retentionUntil: "2026-09-29T00:00:00.000Z" };
    await upsertEntitlement(service, ended);
    expect((await listRetentionDue(service, NOW)).some((e) => e.userId === trial.id)).toBe(true);
    expect((await listRetentionDue(service, new Date("2026-09-28T00:00:00.000Z"))).some((e) => e.userId === trial.id)).toBe(false);
    await setPurgeDue(service, trial.id);
    expect((await getEntitlement(service, trial.id))?.purgeDue).toBe(true);
    await expect(setPurgeDue(trial.client, trial.id, false)).rejects.toBeInstanceOf(DbError);
    await deleteTestUser(trial);
  });
});
