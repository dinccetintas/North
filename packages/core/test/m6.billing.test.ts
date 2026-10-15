import { describe, expect, it } from "vitest";
import { localMonth } from "../src/time";
import { BILLING_LOOKUP_KEYS, CREDIT_GRACE, CREDIT_PACKS, packById, planByLookupKey, RETENTION_DAYS, SANDBOX_USD_PER_MINUTE, SUBSCRIPTION_PLAN_IDS, SUBSCRIPTION_PLANS, TRIAL_DAYS, USAGE_ALERT_RATIO } from "../src/billing/plans";
import { parseBillingEvent, type BillingEvent } from "../src/billing/events";
import { applyBillingEvent, canCreateCompany, ENTITLEMENT_STATUSES, EntitlementSchema, entitlementTransition, isActive, retentionUntil, shouldEndTrial, trialEntitlement, type Entitlement } from "../src/billing/entitlements";
import { canDispatch, consumeEntry, CREDIT_ENTRY_KINDS, creditBalance, CreditEntryDraftSchema, CreditEntrySchema, creditGrantsFor, expireEntry, trialGrant } from "../src/billing/credits";
import { sandboxCostUsd, usageAlertDue, usageCostUsd, usageRatio, UsageSchema } from "../src/billing/usage";
import { DISPATCH_BLOCK_REASONS, dispatchDecision } from "../src/billing/dispatch";

const userId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-11-01T09:00:00.000Z");
const unix = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000);

const subscriptionEvent = (type: "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted", over: Record<string, unknown> = {}, created = unix("2026-11-01T08:00:00.000Z")): BillingEvent => {
  const parsed = parseBillingEvent({
    id: `evt_${type}_${created}`,
    type,
    created,
    data: {
      object: {
        id: "sub_1",
        object: "subscription",
        customer: "cus_1",
        status: "active",
        cancel_at_period_end: false,
        cancel_at: null,
        current_period_start: unix("2026-11-01T00:00:00.000Z"),
        current_period_end: unix("2026-12-01T00:00:00.000Z"),
        items: { object: "list", data: [{ id: "si_1", price: { id: "price_1", lookup_key: "north_pro_monthly" } }] },
        metadata: {},
        ...over,
      },
    },
  });
  if ("ignored" in parsed) throw new Error("fixture is a known type");
  return parsed;
};

const invoiceEvent = (type: "invoice.paid" | "invoice.payment_failed", over: Record<string, unknown> = {}, created = unix("2026-11-01T08:00:05.000Z")): BillingEvent => {
  const parsed = parseBillingEvent({
    id: `evt_${type}_${created}`,
    type,
    created,
    data: {
      object: {
        id: "in_1",
        object: "invoice",
        customer: "cus_1",
        subscription: "sub_1",
        amount_paid: 29900,
        lines: { object: "list", data: [{ id: "il_1", period: { start: unix("2026-11-01T00:00:00.000Z"), end: unix("2026-12-01T00:00:00.000Z") } }] },
        ...over,
      },
    },
  });
  if ("ignored" in parsed) throw new Error("fixture is a known type");
  return parsed;
};

const checkoutEvent = (mode: "subscription" | "payment", over: Record<string, unknown> = {}): BillingEvent => {
  const parsed = parseBillingEvent({
    id: `evt_checkout_${mode}`,
    type: "checkout.session.completed",
    created: unix("2026-11-01T07:59:00.000Z"),
    data: { object: { id: `cs_${mode}`, object: "checkout.session", customer: "cus_1", client_reference_id: userId, mode, subscription: mode === "subscription" ? "sub_1" : null, metadata: {}, ...over } },
  });
  if ("ignored" in parsed) throw new Error("fixture is a known type");
  return parsed;
};

describe("BIL-1 plans are configuration", () => {
  it("Solo $99 / 1 / 300, Pro $299 / 3 / 1 000, Scale $999 / 10 / 4 000, one pack; lookup keys resolve", () => {
    expect(SUBSCRIPTION_PLAN_IDS).toEqual(["solo", "pro", "scale"]);
    expect(SUBSCRIPTION_PLANS.solo).toMatchObject({ id: "solo", name: "Solo", priceUsd: 99, companyLimit: 1, monthlyCredits: 300, lookupKey: "north_solo_monthly" });
    expect(SUBSCRIPTION_PLANS.pro).toMatchObject({ priceUsd: 299, companyLimit: 3, monthlyCredits: 1000, lookupKey: "north_pro_monthly" });
    expect(SUBSCRIPTION_PLANS.scale).toMatchObject({ priceUsd: 999, companyLimit: 10, monthlyCredits: 4000, lookupKey: "north_scale_monthly" });
    expect(CREDIT_PACKS).toEqual([{ id: "pack_100", credits: 100, priceUsd: 29, lookupKey: "north_pack_100" }]);
    expect([TRIAL_DAYS, RETENTION_DAYS, CREDIT_GRACE, USAGE_ALERT_RATIO, SANDBOX_USD_PER_MINUTE]).toEqual([14, 90, 5, 0.4, 0.01]);
    expect(planByLookupKey("north_pro_monthly")?.id).toBe("pro");
    expect(planByLookupKey("north_pack_100")).toBeNull();
    expect(planByLookupKey("")).toBeNull();
    expect(packById("pack_100")?.credits).toBe(100);
    expect(packById("pack_999")).toBeNull();
    expect(BILLING_LOOKUP_KEYS).toEqual(["north_solo_monthly", "north_pro_monthly", "north_scale_monthly", "north_pack_100"]);
    expect(Object.isFrozen(SUBSCRIPTION_PLANS)).toBe(true);
  });
});

describe("BIL-1 entitlement projection: pure, ordered, never regressing", () => {
  const trial = trialEntitlement(userId, new Date("2026-10-20T10:00:00.000Z"));

  it("a new user gets a 14-day Solo trial without a card; the schema validates it", () => {
    expect(ENTITLEMENT_STATUSES).toEqual(["trialing", "active", "past_due", "canceled", "ended"]);
    expect(trial).toMatchObject({ userId, planId: "solo", status: "trialing", companyLimit: 1, monthlyCredits: 300, priceUsd: 0, cancelAt: null, stripeCustomerId: null, stripeSubscriptionId: null, endedAt: null, retentionUntil: null, purgeDue: false, lastEventCreated: null });
    expect(trial.periodStart).toBe("2026-10-20T10:00:00.000Z");
    expect(trial.periodEnd).toBe("2026-11-03T10:00:00.000Z");
    expect(EntitlementSchema.safeParse(trial).success).toBe(true);
    expect(EntitlementSchema.safeParse({ ...trial, status: "paused" }).success).toBe(false);
    expect(EntitlementSchema.safeParse({ ...trial, companyLimit: 0 }).success).toBe(false);
    expect(Object.isFrozen(trial)).toBe(true);
    expect(isActive(trial)).toBe(true);
  });

  it("trial → checkout → subscription.created Pro → active with limit 3 and 1 000 credits, ids stored, input untouched", () => {
    const afterCheckout = applyBillingEvent(trial, checkoutEvent("subscription"), now);
    expect(afterCheckout).toMatchObject({ status: "trialing", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1" });
    const active = applyBillingEvent(afterCheckout, subscriptionEvent("customer.subscription.created"), now);
    expect(active).toMatchObject({ planId: "pro", status: "active", companyLimit: 3, monthlyCredits: 1000, priceUsd: 299, stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", cancelAt: null });
    expect(active.periodStart).toBe("2026-11-01T00:00:00.000Z");
    expect(active.periodEnd).toBe("2026-12-01T00:00:00.000Z");
    expect(active.lastEventCreated).toBe(unix("2026-11-01T08:00:00.000Z"));
    expect(trial.status).toBe("trialing");
    expect(entitlementTransition(trial, active)).toBeNull();
    expect(Object.isFrozen(active)).toBe(true);
  });

  it("a payment-mode checkout stores the customer and changes nothing else", () => {
    const after = applyBillingEvent(trial, checkoutEvent("payment", { customer: "cus_9" }), now);
    expect(after).toMatchObject({ status: "trialing", stripeCustomerId: "cus_9", stripeSubscriptionId: null });
  });

  it("subscription.updated with cancel_at_period_end → canceled, cancel_at = period end, still isActive", () => {
    const active = applyBillingEvent(trial, subscriptionEvent("customer.subscription.created"), now);
    const canceled = applyBillingEvent(active, subscriptionEvent("customer.subscription.updated", { cancel_at_period_end: true }, unix("2026-11-05T08:00:00.000Z")), now);
    expect(canceled.status).toBe("canceled");
    expect(canceled.cancelAt).toBe("2026-12-01T00:00:00.000Z");
    expect(isActive(canceled)).toBe(true);
    expect(entitlementTransition(active, canceled)).toBeNull();
    const explicit = applyBillingEvent(active, subscriptionEvent("customer.subscription.updated", { cancel_at_period_end: true, cancel_at: unix("2026-11-20T00:00:00.000Z") }, unix("2026-11-05T08:00:00.000Z")), now);
    expect(explicit.cancelAt).toBe("2026-11-20T00:00:00.000Z");
    const resumed = applyBillingEvent(canceled, subscriptionEvent("customer.subscription.updated", {}, unix("2026-11-06T08:00:00.000Z")), now);
    expect(resumed).toMatchObject({ status: "active", cancelAt: null });
  });

  it("subscription.deleted → ended with ended_at = now and retention_until + 90 d; the transition is 'ended'", () => {
    const active = applyBillingEvent(trial, subscriptionEvent("customer.subscription.created"), now);
    const endedAt = new Date("2026-11-10T12:00:00.000Z");
    const ended = applyBillingEvent(active, subscriptionEvent("customer.subscription.deleted", { status: "canceled" }, unix("2026-11-10T11:59:00.000Z")), endedAt);
    expect(ended).toMatchObject({ status: "ended", endedAt: "2026-11-10T12:00:00.000Z", retentionUntil: "2027-02-08T12:00:00.000Z", cancelAt: null });
    expect(isActive(ended)).toBe(false);
    expect(entitlementTransition(active, ended)).toBe("ended");
    expect(retentionUntil("2026-11-10T12:00:00.000Z")).toBe("2027-02-08T12:00:00.000Z");
    expect(retentionUntil(endedAt)).toBe("2027-02-08T12:00:00.000Z");
    const back = applyBillingEvent(ended, subscriptionEvent("customer.subscription.created", { id: "sub_2" }, unix("2026-11-12T08:00:00.000Z")), now);
    expect(back).toMatchObject({ status: "active", stripeSubscriptionId: "sub_2", endedAt: null, retentionUntil: null, purgeDue: false });
    expect(entitlementTransition(ended, back)).toBe("reactivated");
  });

  it("a Stripe status of unpaid, incomplete_expired or paused ends the entitlement; incomplete changes nothing", () => {
    const active = applyBillingEvent(trial, subscriptionEvent("customer.subscription.created"), now);
    for (const status of ["unpaid", "incomplete_expired", "paused"]) {
      expect(applyBillingEvent(active, subscriptionEvent("customer.subscription.updated", { status }, unix("2026-11-10T08:00:00.000Z")), now).status, status).toBe("ended");
    }
    expect(applyBillingEvent(active, subscriptionEvent("customer.subscription.updated", { status: "incomplete" }, unix("2026-11-10T08:00:00.000Z")), now).status).toBe("active");
    expect(applyBillingEvent(active, subscriptionEvent("customer.subscription.updated", { status: "trialing" }, unix("2026-11-10T08:00:00.000Z")), now).status).toBe("trialing");
  });

  it("an event older than the applied one does not regress the status, period or end dates; an equal timestamp applies", () => {
    const active = applyBillingEvent(trial, subscriptionEvent("customer.subscription.created"), now);
    const ended = applyBillingEvent(active, subscriptionEvent("customer.subscription.deleted", { status: "canceled" }, unix("2026-11-10T11:59:00.000Z")), now);
    const stale = applyBillingEvent(ended, subscriptionEvent("customer.subscription.updated", { cancel_at_period_end: true, current_period_start: unix("2026-12-01T00:00:00.000Z"), current_period_end: unix("2027-01-01T00:00:00.000Z") }, unix("2026-11-09T08:00:00.000Z")), now);
    expect(stale).toEqual(ended);
    const same = applyBillingEvent(ended, subscriptionEvent("customer.subscription.updated", {}, unix("2026-11-10T11:59:00.000Z")), now);
    expect(same.status).toBe("active");
    // Stripe does not order subscription.created and invoice.paid: the older one still fills the plan and the ids.
    const paidFirst = applyBillingEvent(trial, invoiceEvent("invoice.paid", {}, unix("2026-11-01T08:00:05.000Z")), now);
    const thenCreated = applyBillingEvent(paidFirst, subscriptionEvent("customer.subscription.created", {}, unix("2026-11-01T08:00:04.000Z")), now);
    expect(thenCreated).toMatchObject({ planId: "pro", companyLimit: 3, monthlyCredits: 1000, status: "active", stripeSubscriptionId: "sub_1", lastEventCreated: unix("2026-11-01T08:00:05.000Z") });
    const staleFailure = applyBillingEvent(active, invoiceEvent("invoice.payment_failed", {}, unix("2026-10-01T08:00:00.000Z")), now);
    expect(staleFailure.status).toBe("active");
  });

  it("invoice.paid moves the period and resolves past_due; payment_failed → past_due; nothing resurrects ended", () => {
    const active = applyBillingEvent(trial, subscriptionEvent("customer.subscription.created"), now);
    const pastDue = applyBillingEvent(active, invoiceEvent("invoice.payment_failed", {}, unix("2026-12-01T08:00:00.000Z")), now);
    expect(pastDue.status).toBe("past_due");
    expect(entitlementTransition(active, pastDue)).toBe("past_due");
    expect(isActive(pastDue)).toBe(true);
    const paid = applyBillingEvent(
      pastDue,
      invoiceEvent("invoice.paid", { lines: { data: [{ period: { start: unix("2026-12-01T00:00:00.000Z"), end: unix("2027-01-01T00:00:00.000Z") } }] } }, unix("2026-12-02T08:00:00.000Z")),
      now,
    );
    expect(paid).toMatchObject({ status: "active", periodStart: "2026-12-01T00:00:00.000Z", periodEnd: "2027-01-01T00:00:00.000Z" });
    expect(entitlementTransition(pastDue, paid)).toBeNull();
    const trialPaid = applyBillingEvent(trial, invoiceEvent("invoice.paid"), now);
    expect(trialPaid).toMatchObject({ status: "active", stripeSubscriptionId: "sub_1", stripeCustomerId: "cus_1" });
    const noLines = applyBillingEvent(active, invoiceEvent("invoice.paid", { lines: { data: [] } }, unix("2026-11-02T08:00:00.000Z")), now);
    expect(noLines.periodStart).toBe(active.periodStart);
    const ended = applyBillingEvent(active, subscriptionEvent("customer.subscription.deleted", { status: "canceled" }, unix("2026-11-10T11:59:00.000Z")), now);
    expect(applyBillingEvent(ended, invoiceEvent("invoice.paid", {}, unix("2026-11-11T08:00:00.000Z")), now).status).toBe("ended");
    expect(applyBillingEvent(ended, invoiceEvent("invoice.payment_failed", {}, unix("2026-11-11T08:00:00.000Z")), now).status).toBe("ended");
  });

  it("an unknown lookup key keeps the current plan; the period falls back to the subscription item", () => {
    const unknown = applyBillingEvent(trial, subscriptionEvent("customer.subscription.created", { items: { data: [{ price: { lookup_key: "north_gold_monthly" } }] } }), now);
    expect(unknown).toMatchObject({ planId: "solo", status: "active", companyLimit: 1, monthlyCredits: 300, priceUsd: 0 });
    const itemPeriod = applyBillingEvent(
      trial,
      subscriptionEvent("customer.subscription.created", {
        current_period_start: undefined,
        current_period_end: undefined,
        items: { data: [{ price: { lookup_key: "north_pro_monthly" }, current_period_start: unix("2026-11-03T00:00:00.000Z"), current_period_end: unix("2026-12-03T00:00:00.000Z") }] },
      }),
      now,
    );
    expect(itemPeriod).toMatchObject({ planId: "pro", periodStart: "2026-11-03T00:00:00.000Z", periodEnd: "2026-12-03T00:00:00.000Z" });
    const noPeriod = applyBillingEvent(trial, subscriptionEvent("customer.subscription.created", { current_period_start: undefined, current_period_end: undefined, items: { data: [] } }), now);
    expect(noPeriod.periodStart).toBe(trial.periodStart);
  });

  it("canCreateCompany on Solo with one company refuses and names the plan; Pro allows a third; ended refuses everything", () => {
    expect(canCreateCompany(trial, 0)).toEqual({ ok: true });
    const refused = canCreateCompany(trial, 1);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.reason).toBe("Solo includes 1 company. Upgrade to Pro for 3.");
    const pro: Entitlement = { ...trial, planId: "pro", companyLimit: 3, status: "active" };
    expect(canCreateCompany(pro, 2)).toEqual({ ok: true });
    expect(canCreateCompany(pro, 3)).toEqual({ ok: false, reason: "Pro includes 3 companies. Upgrade to Scale for 10." });
    expect(canCreateCompany({ ...pro, planId: "scale", companyLimit: 10 }, 10)).toEqual({ ok: false, reason: "Scale includes 10 companies." });
    expect(canCreateCompany({ ...trial, status: "ended" }, 0)).toEqual({ ok: false, reason: "Your subscription has ended. Subscribe to create a company." });
    expect(canCreateCompany({ ...trial, status: "canceled" }, 0)).toEqual({ ok: true });
  });

  it("shouldEndTrial: a trial past its period end with no subscription, and nothing else", () => {
    expect(shouldEndTrial(trial, new Date("2026-11-03T09:59:00.000Z"))).toBe(false);
    expect(shouldEndTrial(trial, new Date("2026-11-03T10:00:00.000Z"))).toBe(true);
    expect(shouldEndTrial({ ...trial, stripeSubscriptionId: "sub_1" }, new Date("2026-12-01T00:00:00.000Z"))).toBe(false);
    expect(shouldEndTrial({ ...trial, status: "active" }, new Date("2026-12-01T00:00:00.000Z"))).toBe(false);
  });
});

describe("BIL-2 credits are a ledger", () => {
  const draft = (kind: string, amount: number, ref = `${kind}:x`) => ({ kind, amount, ref });

  it("the draft schema checks the sign per kind and bounds the ref and note", () => {
    expect(CREDIT_ENTRY_KINDS).toEqual(["grant_plan", "grant_pack", "consume", "expire", "adjust"]);
    expect(CreditEntryDraftSchema.safeParse(draft("grant_plan", 300)).success).toBe(true);
    expect(CreditEntryDraftSchema.safeParse(draft("grant_plan", -300)).success).toBe(false);
    expect(CreditEntryDraftSchema.safeParse(draft("grant_pack", 0)).success).toBe(false);
    expect(CreditEntryDraftSchema.safeParse(draft("consume", -1)).success).toBe(true);
    expect(CreditEntryDraftSchema.safeParse(draft("consume", 1)).success).toBe(false);
    expect(CreditEntryDraftSchema.safeParse(draft("expire", -40)).success).toBe(true);
    expect(CreditEntryDraftSchema.safeParse(draft("expire", 40)).success).toBe(false);
    expect(CreditEntryDraftSchema.safeParse(draft("adjust", -7)).success).toBe(true);
    expect(CreditEntryDraftSchema.safeParse(draft("adjust", 7)).success).toBe(true);
    expect(CreditEntryDraftSchema.safeParse(draft("adjust", 0)).success).toBe(false);
    expect(CreditEntryDraftSchema.safeParse(draft("adjust", 1.5)).success).toBe(false);
    expect(CreditEntryDraftSchema.safeParse({ ...draft("adjust", 1), ref: "" }).success).toBe(false);
    expect(CreditEntryDraftSchema.parse(draft("adjust", 1)).note).toBe("");
    expect(CreditEntryDraftSchema.safeParse({ ...draft("adjust", 1), note: "x".repeat(501) }).success).toBe(false);
    const row = { id: userId, userId, createdAt: "2026-11-01T00:00:00.000Z", ...draft("consume", -1), note: "" };
    expect(CreditEntrySchema.safeParse(row).success).toBe(true);
    expect(CreditEntrySchema.safeParse({ ...row, amount: 1 }).success).toBe(false);
  });

  it("creditBalance sums grants, consumes and an expire; canDispatch at ≤ 0 is false", () => {
    const entries = [draft("grant_plan", 300, "trial:u"), draft("grant_pack", 100, "pack:cs"), ...Array.from({ length: 7 }, (_, i) => draft("consume", -1, `run:${i}`)), draft("expire", -293, "expire:p"), draft("adjust", 2, "adjust:1")];
    expect(creditBalance(entries)).toBe(102);
    expect(creditBalance([])).toBe(0);
    expect(canDispatch(102)).toBe(true);
    expect(canDispatch(1)).toBe(true);
    expect(canDispatch(0)).toBe(false);
    expect(canDispatch(-3)).toBe(false);
  });

  it("trialGrant, consumeEntry and expireEntry carry the agreed refs; expire is null when nothing is unused", () => {
    expect(trialGrant(userId)).toEqual({ kind: "grant_plan", amount: 300, ref: `trial:${userId}`, note: "Solo trial" });
    expect(consumeEntry("run-1")).toEqual({ kind: "consume", amount: -1, ref: "run:run-1", note: "" });
    expect(expireEntry({ periodStart: "2026-11-01T00:00:00.000Z", balance: 350, planGrant: 300 })).toEqual({ kind: "expire", amount: -300, ref: "expire:2026-11-01T00:00:00.000Z", note: "unused plan credits of the period" });
    expect(expireEntry({ periodStart: "2026-11-01T00:00:00.000Z", balance: 40, planGrant: 300 })?.amount).toBe(-40);
    expect(expireEntry({ periodStart: "2026-11-01T00:00:00.000Z", balance: 0, planGrant: 300 })).toBeNull();
    expect(expireEntry({ periodStart: "2026-11-01T00:00:00.000Z", balance: -3, planGrant: 300 })).toBeNull();
    expect(Object.isFrozen(consumeEntry("r"))).toBe(true);
  });

  it("creditGrantsFor: invoice.paid grants the plan once per period ref, a replay returns the same ref; a payment checkout grants the pack", () => {
    const trial = trialEntitlement(userId, now);
    const active = applyBillingEvent(trial, subscriptionEvent("customer.subscription.created"), now);
    const invoice = invoiceEvent("invoice.paid");
    const first = creditGrantsFor(invoice, active);
    expect(first).toEqual([{ kind: "grant_plan", amount: 1000, ref: "plan:sub_1:2026-11-01T00:00:00.000Z", note: "Pro credits for the period" }]);
    expect(creditGrantsFor(invoice, applyBillingEvent(active, invoice, now))).toEqual(first);
    const later = { ...active, periodStart: "2026-12-01T00:00:00.000Z", periodEnd: "2027-01-01T00:00:00.000Z" };
    expect(creditGrantsFor(invoice, later)[0]?.ref).toBe("plan:sub_1:2026-11-01T00:00:00.000Z");
    expect(creditGrantsFor(invoiceEvent("invoice.paid", { lines: { data: [] } }), later)[0]?.ref).toBe("plan:sub_1:2026-12-01T00:00:00.000Z");
    expect(creditGrantsFor(invoiceEvent("invoice.paid", { subscription: null }), { ...active, stripeSubscriptionId: null })).toEqual([]);
    expect(creditGrantsFor(invoiceEvent("invoice.paid", { subscription: null, parent: { subscription_details: { subscription: "sub_7" } } }), active)[0]?.ref).toBe("plan:sub_7:2026-11-01T00:00:00.000Z");
    expect(creditGrantsFor(checkoutEvent("payment"), active)).toEqual([{ kind: "grant_pack", amount: 100, ref: "pack:cs_payment", note: "pack_100" }]);
    expect(creditGrantsFor(checkoutEvent("payment", { metadata: { north_pack_id: "pack_100" } }), active)[0]?.amount).toBe(100);
    expect(creditGrantsFor(checkoutEvent("payment", { metadata: { north_pack_id: "pack_999" } }), active)).toEqual([]);
    expect(creditGrantsFor(checkoutEvent("subscription"), active)).toEqual([]);
    expect(creditGrantsFor(invoiceEvent("invoice.payment_failed"), active)).toEqual([]);
    expect(creditGrantsFor(subscriptionEvent("customer.subscription.created"), active)).toEqual([]);
  });
});

describe("BIL-2 usage is a projection; the 40 % line", () => {
  const usage = { userId, period: "2026-11", creditsUsed: 40, llmCostUsd: 120, sandboxMinutes: 0, alertedAt: null };

  it("UsageSchema bounds the period and the numbers", () => {
    expect(UsageSchema.safeParse(usage).success).toBe(true);
    expect(UsageSchema.safeParse({ ...usage, period: "2026-11-01" }).success).toBe(false);
    expect(UsageSchema.safeParse({ ...usage, creditsUsed: -1 }).success).toBe(false);
    expect(UsageSchema.safeParse({ ...usage, alertedAt: "2026-11-02T00:00:00.000Z" }).success).toBe(true);
  });

  it("usageRatio $120 on $299 = 0.401; usageAlertDue true once, never at 0 price", () => {
    expect(usageRatio(usage, 299)).toBe(0.401);
    expect(usageRatio(usage, 0)).toBe(0);
    expect(usageRatio({ ...usage, llmCostUsd: 100 }, 299)).toBe(0.334);
    expect(usageAlertDue(usage, 299, null)).toBe(true);
    expect(usageAlertDue(usage, 299, "2026-11-02T00:00:00.000Z")).toBe(false);
    expect(usageAlertDue({ ...usage, llmCostUsd: 100 }, 299, null)).toBe(false);
    expect(usageAlertDue(usage, 0, null)).toBe(false);
  });

  it("sandbox minutes cost SANDBOX_USD_PER_MINUTE and count in the ratio", () => {
    expect(sandboxCostUsd(0)).toBe(0);
    expect(sandboxCostUsd(150)).toBe(1.5);
    expect(sandboxCostUsd(1.234)).toBe(0.01);
    expect(usageCostUsd({ ...usage, llmCostUsd: 10, sandboxMinutes: 100 })).toBe(11);
    expect(usageRatio({ ...usage, llmCostUsd: 0, sandboxMinutes: 4000 }, 99)).toBe(0.404);
  });

  it("localMonth is the owner's month: 00:30 on the 1st in Kiritimati is already the new month", () => {
    const instant = new Date("2026-10-31T10:30:00.000Z");
    expect(localMonth("Pacific/Kiritimati", instant)).toBe("2026-11");
    expect(localMonth("UTC", instant)).toBe("2026-10");
    expect(localMonth("Europe/Istanbul", new Date("2026-12-31T21:30:00.000Z"))).toBe("2027-01");
    expect(localMonth("Mars/Olympus", instant)).toBe("2026-10");
  });
});

describe("BIL-1 dispatch decision: kill switch, then entitlement, then credits", () => {
  const trial = trialEntitlement(userId, now);

  it("the reasons are the four agreed ones and the order holds", () => {
    expect(DISPATCH_BLOCK_REASONS).toEqual(["kill_switch", "subscription_ended", "retention", "credits_exhausted"]);
    expect(dispatchDecision({ killSwitchActive: false, entitlement: trial, balance: 5 })).toEqual({ ok: true });
    expect(dispatchDecision({ killSwitchActive: true, entitlement: trial, balance: 0 })).toEqual({ ok: false, reason: "kill_switch" });
    expect(dispatchDecision({ killSwitchActive: true, pausedReason: "user", entitlement: trial, balance: 0 })).toEqual({ ok: false, reason: "kill_switch" });
    expect(dispatchDecision({ killSwitchActive: true, pausedReason: "subscription_ended", entitlement: { ...trial, status: "ended" }, balance: 0 })).toEqual({ ok: false, reason: "subscription_ended" });
    expect(dispatchDecision({ killSwitchActive: true, pausedReason: "retention", entitlement: { ...trial, status: "ended" }, balance: 9 })).toEqual({ ok: false, reason: "retention" });
    expect(dispatchDecision({ killSwitchActive: false, entitlement: { ...trial, status: "ended" }, balance: 9 })).toEqual({ ok: false, reason: "subscription_ended" });
    expect(dispatchDecision({ killSwitchActive: false, entitlement: { ...trial, status: "ended", purgeDue: true }, balance: 9 })).toEqual({ ok: false, reason: "retention" });
    expect(dispatchDecision({ killSwitchActive: false, entitlement: { ...trial, status: "ended", retentionUntil: "2026-10-01T00:00:00.000Z" }, balance: 9, now })).toEqual({ ok: false, reason: "retention" });
    expect(dispatchDecision({ killSwitchActive: false, entitlement: { ...trial, status: "ended", retentionUntil: "2027-10-01T00:00:00.000Z" }, balance: 9, now })).toEqual({ ok: false, reason: "subscription_ended" });
    expect(dispatchDecision({ killSwitchActive: false, entitlement: null, balance: 9 })).toEqual({ ok: false, reason: "subscription_ended" });
    expect(dispatchDecision({ killSwitchActive: false, entitlement: trial, balance: 0 })).toEqual({ ok: false, reason: "credits_exhausted" });
    expect(dispatchDecision({ killSwitchActive: false, entitlement: { ...trial, status: "canceled" }, balance: 1 })).toEqual({ ok: true });
    expect(dispatchDecision({ killSwitchActive: false, entitlement: { ...trial, status: "past_due" }, balance: 1 })).toEqual({ ok: true });
  });
});
