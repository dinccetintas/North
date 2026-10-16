import { describe, expect, it } from "vitest";
import { BILLING_EVENT_TYPES, invoiceLinePlan, isCheckoutEvent, parseBillingEvent, planInvoiceLine, PLAN_BILLING_REASONS, type BillingEvent, type BillingInvoiceObject } from "../src/billing/events";
import { applyBillingEvent, endedEntitlement, ignoredBecause, stripeStatusEnds, trialEntitlement, type Entitlement } from "../src/billing/entitlements";
import { consumeEntry, creditGrantsFor, CreditEntryDraftSchema, periodPlanGrant, planGrantRef, releaseEntry } from "../src/billing/credits";
import { CHECKOUT_OPEN_MINUTES, UNKNOWN_BILLING_EVENT_DAYS, usdCents } from "../src/billing/plans";

/**
 * M6 security review, billing findings (H1, M1, M3, L13): what the pure
 * projection and the credit grants accept from a verified Stripe event.
 */

const userId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-11-20T09:00:00.000Z");
const unix = (iso: string): number => Math.floor(new Date(iso).getTime() / 1000);
const NOV_1 = unix("2026-11-01T00:00:00.000Z");
const NOV_15 = unix("2026-11-15T00:00:00.000Z");
const DEC_1 = unix("2026-12-01T00:00:00.000Z");
const JAN_1 = unix("2027-01-01T00:00:00.000Z");

const parse = (body: Record<string, unknown>): BillingEvent => {
  const parsed = parseBillingEvent(body);
  if ("ignored" in parsed) throw new Error(`fixture is a known type: ${parsed.ignored}`);
  return parsed;
};

type SubscriptionType = "customer.subscription.created" | "customer.subscription.updated" | "customer.subscription.deleted";
const subscription = (type: SubscriptionType, created: number, over: Record<string, unknown> = {}): BillingEvent =>
  parse({
    id: `evt_${type}_${created}_${String(over.id ?? "sub_1")}`,
    type,
    created,
    data: {
      object: {
        id: "sub_1",
        customer: "cus_1",
        status: type === "customer.subscription.deleted" ? "canceled" : "active",
        cancel_at_period_end: false,
        cancel_at: null,
        items: { data: [{ price: { lookup_key: "north_pro_monthly" }, current_period_start: NOV_1, current_period_end: DEC_1 }] },
        metadata: {},
        ...over,
      },
    },
  });

/** A 2025-03 ("basil") line that bills the subscription itself. */
const planLine = (start: number, end: number, over: Record<string, unknown> = {}) => ({ id: "il_plan", amount: 29_900, period: { start, end }, parent: { type: "subscription_item_details", subscription_item_details: { subscription: "sub_1", proration: false } }, ...over });
/** A basil proration line (a plan change mid-period). */
const prorationLine = (start: number, end: number, amount = 20_000) => ({ id: "il_pro", amount, period: { start, end }, parent: { type: "invoice_item_details", invoice_item_details: { invoice_item: "ii_1", proration: true } } });

const invoice = (type: "invoice.paid" | "invoice.payment_failed", created: number, over: Record<string, unknown> = {}): BillingEvent =>
  parse({
    id: `evt_${type}_${created}_${String(over.subscription ?? "sub_1")}`,
    type,
    created,
    data: { object: { id: `in_${created}`, customer: "cus_1", subscription: "sub_1", amount_paid: 29_900, billing_reason: "subscription_cycle", lines: { data: [planLine(DEC_1, JAN_1)] }, ...over } },
  });

type CheckoutType = "checkout.session.completed" | "checkout.session.async_payment_succeeded";
const checkout = (type: CheckoutType, over: Record<string, unknown> = {}, created = unix("2026-11-20T08:00:00.000Z")): BillingEvent =>
  parse({
    id: `evt_${type}_${created}`,
    type,
    created,
    data: { object: { id: "cs_pack_1", customer: "cus_1", client_reference_id: userId, mode: "payment", subscription: null, payment_status: "paid", amount_total: 2_900, currency: "usd", metadata: { north_user_id: userId, north_pack_id: "pack_100" }, ...over } },
  });

const trial = trialEntitlement(userId, new Date("2026-10-25T10:00:00.000Z"));
/** Pro, active on sub_1 since 1 November, last event at 08:00 that day. */
const proActive = (): Entitlement => applyBillingEvent(trial, subscription("customer.subscription.created", unix("2026-11-01T08:00:00.000Z")), now);

describe("BIL-2 H1: a credit pack is granted only for a paid checkout at the pack's price", () => {
  it("accepts checkout.session.async_payment_succeeded end to end; async_payment_failed is not handled (ignored, grants nothing)", () => {
    expect(BILLING_EVENT_TYPES).toContain("checkout.session.async_payment_succeeded");
    expect(BILLING_EVENT_TYPES).not.toContain("checkout.session.async_payment_failed");
    expect(parseBillingEvent({ id: "evt_f", type: "checkout.session.async_payment_failed", created: 1, data: { object: { id: "cs_pack_1" } } })).toEqual({ ignored: "checkout.session.async_payment_failed" });
    const parsed = checkout("checkout.session.async_payment_succeeded");
    expect(isCheckoutEvent(parsed)).toBe(true);
    expect(isCheckoutEvent(invoice("invoice.paid", 1))).toBe(false);
    expect(parsed.data.object).toMatchObject({ payment_status: "paid", amount_total: 2_900, currency: "usd" });
    expect(usdCents(29)).toBe(2_900);
    expect(usdCents(0.1 + 0.2)).toBe(30);
  });

  it("paid at 2 900 usd with pack_100 → +100 under pack:<session>; the async success of the same session has the same ref", () => {
    const active = proActive();
    const grant = [{ kind: "grant_pack", amount: 100, ref: "pack:cs_pack_1", note: "pack_100" }];
    expect(creditGrantsFor(checkout("checkout.session.completed"), active)).toEqual(grant);
    expect(creditGrantsFor(checkout("checkout.session.async_payment_succeeded"), active)).toEqual(grant);
  });

  it("an unpaid or no-payment completion, a wrong amount or currency, a missing or unknown pack id, a subscription checkout grant nothing", () => {
    const active = proActive();
    const refused: Record<string, unknown>[] = [
      { payment_status: "unpaid" },
      { payment_status: "no_payment_required" },
      { payment_status: undefined },
      { amount_total: 2_899 },
      { amount_total: 0 },
      { amount_total: null },
      { currency: "eur" },
      { currency: null },
      { metadata: { north_user_id: userId } },
      { metadata: {} },
      { metadata: { north_pack_id: "pack_999" } },
      { mode: "subscription", subscription: "sub_1" },
    ];
    for (const over of refused) expect(creditGrantsFor(checkout("checkout.session.completed", over), active), JSON.stringify(over)).toEqual([]);
  });

  it("ACH flow: completed unpaid grants nothing and stores the customer; the later async success grants once", () => {
    const unpaid = checkout("checkout.session.completed", { payment_status: "unpaid", customer: "cus_9" });
    const after = applyBillingEvent(trial, unpaid, now);
    expect(after).toMatchObject({ status: "trialing", stripeCustomerId: "cus_9", stripeSubscriptionId: null });
    expect(creditGrantsFor(unpaid, after)).toEqual([]);
    const paid = checkout("checkout.session.async_payment_succeeded", { customer: "cus_9" }, unix("2026-11-23T08:00:00.000Z"));
    expect(creditGrantsFor(paid, applyBillingEvent(after, paid, now)).map((g) => g.ref)).toEqual(["pack:cs_pack_1"]);
  });
});

describe("BIL-2 M3: plan credits only for the plan's own invoice, the period from the subscription line", () => {
  it("PLAN_BILLING_REASONS are create and cycle; planInvoiceLine finds the non-proration subscription line in both API shapes", () => {
    expect(PLAN_BILLING_REASONS).toEqual(["subscription_create", "subscription_cycle"]);
    const object = (event: BillingEvent): BillingInvoiceObject => {
      if (event.type !== "invoice.paid" && event.type !== "invoice.payment_failed") throw new Error("invoice");
      return event.data.object;
    };
    const basil = object(invoice("invoice.paid", 1, { lines: { data: [prorationLine(NOV_15, DEC_1), planLine(DEC_1, JAN_1)] } }));
    expect(planInvoiceLine(basil)?.period).toEqual({ start: DEC_1, end: JAN_1 });
    const legacy = object(
      invoice("invoice.paid", 1, {
        lines: {
          data: [
            { amount: 20_000, type: "invoiceitem", proration: true, period: { start: NOV_15, end: DEC_1 } },
            { amount: 29_900, type: "subscription", proration: true, period: { start: NOV_15, end: DEC_1 } },
            { amount: 29_900, type: "subscription", proration: false, price: { lookup_key: "north_pro_monthly" }, period: { start: DEC_1, end: JAN_1 } },
          ],
        },
      }),
    );
    expect(planInvoiceLine(legacy)?.period.start).toBe(DEC_1);
    const byLookupKey = object(invoice("invoice.paid", 1, { lines: { data: [{ amount: 29_900, price: { lookup_key: "north_pro_monthly" }, period: { start: DEC_1, end: JAN_1 } }] } }));
    expect(planInvoiceLine(byLookupKey)?.period.start).toBe(DEC_1);
    expect(planInvoiceLine(object(invoice("invoice.paid", 1, { lines: { data: [{ amount: 100, price: { lookup_key: "north_pack_100" }, period: { start: DEC_1, end: JAN_1 } }] } })))).toBeNull();
    expect(planInvoiceLine(object(invoice("invoice.paid", 1, { lines: { data: [prorationLine(NOV_15, DEC_1)] } })))).toBeNull();
    for (const reason of ["subscription_update", "manual", "subscription_threshold", null]) expect(planInvoiceLine(object(invoice("invoice.paid", 1, { billing_reason: reason }))), String(reason)).toBeNull();
    expect(planInvoiceLine(object(invoice("invoice.paid", 1, { billing_reason: "subscription_create" })))).not.toBeNull();
  });

  it("a proration invoice mid-period (Solo → Pro) grants nothing and does not move the period", () => {
    const active = proActive();
    const proration = invoice("invoice.paid", unix("2026-11-15T09:00:00.000Z"), { billing_reason: "subscription_update", amount_paid: 20_000, lines: { data: [prorationLine(NOV_15, DEC_1), planLine(NOV_15, DEC_1)] } });
    expect(creditGrantsFor(proration, active)).toEqual([]);
    const after = applyBillingEvent(active, proration, now);
    expect(after).toBe(active);
    expect(after.periodStart).toBe("2026-11-01T00:00:00.000Z");
    expect(ignoredBecause(active, proration)).toBe("not a plan invoice");
  });

  it("a cycle invoice that carries the change's proration lines grants once under the subscription line's period and moves the period there", () => {
    const active = proActive();
    const cycle = invoice("invoice.paid", unix("2026-12-01T01:00:00.000Z"), { lines: { data: [prorationLine(NOV_15, DEC_1), planLine(DEC_1, JAN_1)] } });
    expect(creditGrantsFor(cycle, active)).toEqual([{ kind: "grant_plan", amount: 1000, ref: "plan:sub_1:2026-12-01T00:00:00.000Z", note: "Pro credits for the period" }]);
    expect(applyBillingEvent(active, cycle, now)).toMatchObject({ periodStart: "2026-12-01T00:00:00.000Z", periodEnd: "2027-01-01T00:00:00.000Z", status: "active" });
  });

  it("decision: a $0 plan line (a Stripe trial, a free price) grants nothing; a zero amount_paid on a priced line (founder coupon, customer balance, proration credit) still grants", () => {
    const active = proActive();
    expect(creditGrantsFor(invoice("invoice.paid", 1, { billing_reason: "subscription_create", amount_paid: 0, lines: { data: [planLine(NOV_1, DEC_1, { amount: 0 })] } }), active)).toEqual([]);
    expect(creditGrantsFor(invoice("invoice.paid", 1, { amount_paid: 0, lines: { data: [planLine(DEC_1, JAN_1)] } }), active)).toHaveLength(1);
    expect(creditGrantsFor(invoice("invoice.paid", 1, { amount_paid: 0, lines: { data: [prorationLine(NOV_15, DEC_1, -30_000), planLine(DEC_1, JAN_1)] } }), active)).toHaveLength(1);
    expect(creditGrantsFor(invoice("invoice.paid", 1, { subscription: null }), active)).toEqual([]);
  });
});

describe("BIL-1 M1: the entitlement follows one subscription; its delete is terminal", () => {
  it("sequence A: S1 ended → S2 → S1's old invoice is paid → S2 cancelled: ends, the S1 invoice never re-pointed the entitlement", () => {
    const s1 = proActive();
    const ended1 = applyBillingEvent(s1, subscription("customer.subscription.deleted", unix("2026-11-05T08:00:00.000Z")), now);
    expect(ended1.status).toBe("ended");
    const s2 = applyBillingEvent(ended1, subscription("customer.subscription.created", unix("2026-11-06T08:00:00.000Z"), { id: "sub_2" }), now);
    expect(s2).toMatchObject({ status: "active", stripeSubscriptionId: "sub_2" });
    const oldInvoice = invoice("invoice.paid", unix("2026-11-07T08:00:00.000Z"), { subscription: "sub_1", lines: { data: [planLine(NOV_1, DEC_1)] } });
    expect(applyBillingEvent(s2, oldInvoice, now)).toBe(s2);
    expect(ignoredBecause(s2, oldInvoice)).toBe("another subscription");
    expect(applyBillingEvent(s2, invoice("invoice.payment_failed", unix("2026-11-07T09:00:00.000Z"), { subscription: "sub_1" }), now)).toBe(s2);
    const ended2 = applyBillingEvent(s2, subscription("customer.subscription.deleted", unix("2026-11-08T08:00:00.000Z"), { id: "sub_2" }), now);
    expect(ended2).toMatchObject({ status: "ended", stripeSubscriptionId: "sub_2" });
  });

  it("sequence B: payment_failed (t+101) then a late subscription.deleted (t+100) → ended; a later update of the same subscription does not revive it", () => {
    const t = unix("2026-11-10T08:00:00.000Z");
    const pastDue = applyBillingEvent(proActive(), invoice("invoice.payment_failed", t + 101), now);
    expect(pastDue).toMatchObject({ status: "past_due", lastEventCreated: t + 101 });
    const ended = applyBillingEvent(pastDue, subscription("customer.subscription.deleted", t + 100), now);
    expect(ended).toMatchObject({ status: "ended", endedAt: now.toISOString(), lastEventCreated: t + 101 });
    expect(applyBillingEvent(ended, subscription("customer.subscription.updated", t + 100, { status: "past_due" }), now).status).toBe("ended");
    expect(applyBillingEvent(ended, subscription("customer.subscription.updated", t + 101), now).status).toBe("ended");
    expect(applyBillingEvent(ended, subscription("customer.subscription.created", t + 101, { id: "sub_2" }), now)).toMatchObject({ status: "active", stripeSubscriptionId: "sub_2" });
  });

  it("a late subscription.created of an older subscription does not re-point; a newer one is adopted", () => {
    const s2 = applyBillingEvent(proActive(), subscription("customer.subscription.created", unix("2026-11-06T08:00:00.000Z"), { id: "sub_2" }), now);
    expect(s2.stripeSubscriptionId).toBe("sub_2");
    const late = subscription("customer.subscription.created", unix("2026-11-01T07:00:00.000Z"), { id: "sub_0" });
    expect(applyBillingEvent(s2, late, now)).toBe(s2);
    const lateCheckout = parse({ id: "evt_c_old", type: "checkout.session.completed", created: unix("2026-11-01T07:00:00.000Z"), data: { object: { id: "cs_old", customer: "cus_1", mode: "subscription", subscription: "sub_0", payment_status: "paid" } } });
    expect(applyBillingEvent(s2, lateCheckout, now)).toBe(s2);
    // Only `created` adopts: a checkout fills the subscription only when none is followed, so an ended entitlement is revived by the new subscription itself, even in the same second.
    const t = unix("2026-11-08T08:00:00.000Z");
    const ended = applyBillingEvent(s2, subscription("customer.subscription.deleted", t, { id: "sub_2" }), now);
    const resubscribe = parse({ id: "evt_c_new", type: "checkout.session.completed", created: t, data: { object: { id: "cs_new", customer: "cus_1", mode: "subscription", subscription: "sub_3", payment_status: "paid" } } });
    expect(applyBillingEvent(ended, resubscribe, now)).toBe(ended);
    expect(applyBillingEvent(ended, subscription("customer.subscription.created", t, { id: "sub_3" }), now)).toMatchObject({ status: "active", stripeSubscriptionId: "sub_3" });
    expect(applyBillingEvent(trial, resubscribe, now)).toMatchObject({ status: "trialing", stripeSubscriptionId: "sub_3" });
  });

  it("an invoice without a subscription changes nothing; a trial does not adopt a dead subscription or a failed payment", () => {
    const active = proActive();
    expect(applyBillingEvent(active, invoice("invoice.paid", unix("2026-12-01T01:00:00.000Z"), { subscription: null }), now)).toBe(active);
    expect(ignoredBecause(active, invoice("invoice.paid", 1, { subscription: null }))).toBe("no subscription");
    for (const event of [
      subscription("customer.subscription.updated", unix("2026-11-02T08:00:00.000Z"), { id: "sub_9", status: "incomplete_expired" }),
      subscription("customer.subscription.deleted", unix("2026-11-02T08:00:00.000Z"), { id: "sub_9" }),
      invoice("invoice.payment_failed", unix("2026-11-02T08:00:00.000Z"), { subscription: "sub_9" }),
    ]) {
      expect(applyBillingEvent(trial, event, now), event.type).toBe(trial);
      expect(ignoredBecause(trial, event)).toBe("not followed");
    }
  });

  it("stripeStatusEnds names the statuses that end; endedEntitlement ends with retention and keeps the event clock", () => {
    expect(["canceled", "unpaid", "incomplete_expired", "paused"].every((s) => stripeStatusEnds(s as never))).toBe(true);
    expect(["active", "trialing", "past_due", "incomplete"].some((s) => stripeStatusEnds(s as never))).toBe(false);
    const ended = endedEntitlement(proActive(), now);
    expect(ended).toMatchObject({ status: "ended", endedAt: now.toISOString(), retentionUntil: "2027-02-18T09:00:00.000Z", cancelAt: null, lastEventCreated: unix("2026-11-01T08:00:00.000Z") });
    expect(endedEntitlement(ended, new Date("2026-12-01T00:00:00.000Z"))).toBe(ended);
    expect(Object.isFrozen(ended)).toBe(true);
  });
});

describe("BIL-1 L13: an incomplete subscription changes nothing", () => {
  it("subscription.created with status incomplete for Scale leaves the trial's limits and adopts no id; updated incomplete likewise", () => {
    const incomplete = subscription("customer.subscription.created", unix("2026-11-02T08:00:00.000Z"), { status: "incomplete", items: { data: [{ price: { lookup_key: "north_scale_monthly" } }] } });
    expect(applyBillingEvent(trial, incomplete, now)).toBe(trial);
    expect(ignoredBecause(trial, incomplete)).toBe("incomplete");
    expect(trial).toMatchObject({ companyLimit: 1, stripeSubscriptionId: null, lastEventCreated: null });
    const active = proActive();
    expect(applyBillingEvent(active, subscription("customer.subscription.updated", unix("2026-11-03T08:00:00.000Z"), { status: "incomplete" }), now)).toBe(active);
    expect(ignoredBecause(active, subscription("customer.subscription.updated", 1))).toBeNull();
  });

  it("a trial adopts a checkout's subscription only once it is paid, so that subscription expiring incomplete cannot end the trial", () => {
    const at = unix("2026-11-02T08:00:00.000Z");
    const checkoutOf = (paymentStatus: string) => parse({ id: `evt_c_${paymentStatus}`, type: "checkout.session.completed", created: at, data: { object: { id: "cs_sub", customer: "cus_1", mode: "subscription", subscription: "sub_5", payment_status: paymentStatus } } });
    const unpaid = applyBillingEvent(trial, checkoutOf("unpaid"), now);
    expect(unpaid).toMatchObject({ status: "trialing", stripeCustomerId: "cus_1", stripeSubscriptionId: null });
    const expired = subscription("customer.subscription.updated", at + 86_400, { id: "sub_5", status: "incomplete_expired" });
    expect(applyBillingEvent(unpaid, expired, now)).toBe(unpaid);
    expect(applyBillingEvent(trial, checkoutOf("paid"), now).stripeSubscriptionId).toBe("sub_5");
    expect(applyBillingEvent(trial, checkoutOf("no_payment_required"), now).stripeSubscriptionId).toBe("sub_5");
  });
});

describe("BIL-2 L9: the run's credit is reserved at dispatch; a run that never started is released", () => {
  it("releaseEntry gives the reserved credit back under release:<agentRunId>, a valid adjust of +1", () => {
    expect(consumeEntry("run-1")).toEqual({ kind: "consume", amount: -1, ref: "run:run-1", note: "" });
    expect(releaseEntry("run-1")).toEqual({ kind: "adjust", amount: 1, ref: "release:run-1", note: "the run did not start; its reserved credit is released" });
    expect(CreditEntryDraftSchema.safeParse(releaseEntry("run-1")).success).toBe(true);
    expect(Object.isFrozen(releaseEntry("run-1"))).toBe(true);
  });
});

describe("BIL-1 L10 / L2: the checkout window and the unknown-event retention are configuration", () => {
  it("a subscription checkout stays open 35 minutes (Stripe's minimum is 30); an event no user owns is kept 30 days (Stripe's own event retention)", () => {
    expect(CHECKOUT_OPEN_MINUTES).toBe(35);
    expect(UNKNOWN_BILLING_EVENT_DAYS).toBe(30);
  });
});

describe("BIL-2 a plan grant is never a guess; the heal writes the very ref the invoice would", () => {
  const object = (event: BillingEvent): BillingInvoiceObject => {
    if (event.type !== "invoice.paid") throw new Error("invoice.paid");
    return event.data.object;
  };

  it("invoiceLinePlan names the plan from the subscription line's price lookup key, else null (2025-03 lines carry only a price id)", () => {
    const legacy = invoice("invoice.paid", 1, { lines: { data: [{ amount: 29_900, type: "subscription", price: { lookup_key: "north_pro_monthly" }, period: { start: DEC_1, end: JAN_1 } }] } });
    expect(invoiceLinePlan(object(legacy))?.id).toBe("pro");
    expect(invoiceLinePlan(object(invoice("invoice.paid", 1)))).toBeNull();
    expect(invoiceLinePlan(object(invoice("invoice.paid", 1, { lines: { data: [planLine(DEC_1, JAN_1, { price: { lookup_key: "north_gold_monthly" } })] } })))).toBeNull();
    expect(invoiceLinePlan(object(invoice("invoice.paid", 1, { billing_reason: "subscription_update", lines: { data: [planLine(DEC_1, JAN_1, { price: { lookup_key: "north_pro_monthly" } })] } })))).toBeNull();
  });

  it("planGrantRef is the one ref format; periodPlanGrant drafts the entitlement's credits under it, null without a paid subscription", () => {
    const active = proActive();
    expect(planGrantRef("sub_1", "2026-11-01T00:00:00.000Z")).toBe("plan:sub_1:2026-11-01T00:00:00.000Z");
    expect(periodPlanGrant(active)).toEqual({ kind: "grant_plan", amount: 1000, ref: `plan:sub_1:${active.periodStart}`, note: "Pro credits for the period" });
    expect(creditGrantsFor(invoice("invoice.paid", 1, { lines: { data: [planLine(NOV_1, DEC_1)] } }), active)[0]?.ref).toBe(periodPlanGrant(active)?.ref);
    expect(periodPlanGrant(trial)).toBeNull();
    expect(periodPlanGrant({ ...active, priceUsd: 0 })).toBeNull();
  });
});
