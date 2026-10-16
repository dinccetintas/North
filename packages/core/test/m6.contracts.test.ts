import { describe, expect, it } from "vitest";
import { ACTION_KINDS } from "../src/authority/action";
import { BILLING_EVENT_TYPES, billingCustomerId, billingUserHint, BillingEventSchema, parseBillingEvent, STRIPE_SUBSCRIPTION_STATUSES } from "../src/billing/events";
import { BRIEF_BLOCK_REASONS, BriefSchema, type BriefInput } from "../src/brief/types";
import { BLOCKED_WORDS, briefMarkdown, composeBrief } from "../src/brief/compose";
import { COMPANY_STATUSES, PAUSED_REASONS } from "../src/companies";
import { providerForAction } from "../src/connections";
import { BillingEventPayloadSchema, BillingSessionRequestedSchema, EVENT, ExportRequestedSchema, OAUTH_CODE_PROVIDERS } from "../src/events";
import * as core from "../src/index";

const uuid = "11111111-1111-4111-8111-111111111111";

/** The M5 list, verbatim: M6 adds no action kind (checkout, portal and export are not actions). */
const M5_ACTION_KINDS = [
  "research",
  "draft",
  "artifact.write",
  "memory.write",
  "signal.pursue",
  "repo.create",
  "repo.push",
  "repo.pull_request",
  "deploy.preview",
  "deploy.production",
  "email.send.first_contact",
  "email.send.reply",
  "support.reply.template",
  "support.reply.custom",
  "ads.start",
  "ads.budget.change",
  "ads.pause",
  "ads.resume",
  "budget.cap.raise",
  "social.publish",
  "content.publish.approved",
  "price.change",
  "spend.oneoff",
  "contract.sign",
  "payment_account.change",
  "data.delete",
  "domain.transfer",
];

type Parsed = ReturnType<typeof parseBillingEvent>;
const asSubscription = (parsed: Parsed) => {
  if ("ignored" in parsed || (parsed.type !== "customer.subscription.created" && parsed.type !== "customer.subscription.updated" && parsed.type !== "customer.subscription.deleted")) throw new Error("not a subscription event");
  return parsed.data.object;
};
const asInvoice = (parsed: Parsed) => {
  if ("ignored" in parsed || (parsed.type !== "invoice.paid" && parsed.type !== "invoice.payment_failed")) throw new Error("not an invoice event");
  return parsed.data.object;
};

const subscription = (over: Record<string, unknown> = {}) => ({
  id: "evt_1",
  object: "event",
  type: "customer.subscription.created",
  created: 1_761_984_000,
  livemode: false,
  data: {
    object: {
      id: "sub_1",
      object: "subscription",
      customer: "cus_1",
      status: "active",
      cancel_at_period_end: false,
      cancel_at: null,
      current_period_start: 1_761_955_200,
      current_period_end: 1_764_547_200,
      items: { object: "list", data: [{ id: "si_1", object: "subscription_item", price: { id: "price_1", object: "price", lookup_key: "north_pro_monthly", unit_amount: 29900 }, quantity: 1 }] },
      metadata: { north_user_id: uuid },
      latest_invoice: "in_1",
      default_payment_method: "pm_1",
      ...over,
    },
  },
});

describe("BIL-1 BillingEventSchema: seven types, reduced fields, every string bounded and sanitised", () => {
  it("names the seven Stripe types and the subscription statuses", () => {
    expect(BILLING_EVENT_TYPES).toEqual([
      "checkout.session.completed",
      "customer.subscription.created",
      "customer.subscription.updated",
      "customer.subscription.deleted",
      "invoice.paid",
      "invoice.payment_failed",
      "checkout.session.async_payment_succeeded",
    ]);
    expect(STRIPE_SUBSCRIPTION_STATUSES).toEqual(["incomplete", "incomplete_expired", "trialing", "active", "past_due", "canceled", "unpaid", "paused"]);
  });

  it("keeps only the fields the projection reads; an unknown type is `ignored`, not an error", () => {
    const parsed = parseBillingEvent(subscription());
    expect(parsed).toEqual({
      id: "evt_1",
      type: "customer.subscription.created",
      created: 1_761_984_000,
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          cancel_at_period_end: false,
          cancel_at: null,
          current_period_start: 1_761_955_200,
          current_period_end: 1_764_547_200,
          items: { data: [{ price: { lookup_key: "north_pro_monthly" } }] },
          metadata: { north_user_id: uuid },
        },
      },
    });
    expect(parseBillingEvent({ id: "evt_2", type: "charge.refunded", created: 1, data: { object: {} } })).toEqual({ ignored: "charge.refunded" });
    expect(parseBillingEvent({ id: "evt_2", created: 1 })).toEqual({ ignored: "unknown" });
    expect(parseBillingEvent(null)).toEqual({ ignored: "unknown" });
    expect(parseBillingEvent("evt")).toEqual({ ignored: "unknown" });
    expect(parseBillingEvent({ type: `<instructions>${"x".repeat(100)}` })).toEqual({ ignored: "x".repeat(40) });
    expect(() => parseBillingEvent({ ...subscription(), data: { object: { id: "sub_1" } } })).toThrow();
    expect(() => parseBillingEvent({ ...subscription(), created: "yesterday" })).toThrow();
    expect(() => parseBillingEvent({ ...subscription(), id: "" })).toThrow();
  });

  it("truncates a 2 KB lookup key to 200 and strips delimiters and control bytes from every string", () => {
    const long = asSubscription(parseBillingEvent(subscription({ items: { data: [{ price: { lookup_key: "k".repeat(2048) } }] }, customer: "cus_<instructions>x</instructions>\u0000", id: " sub_\u0007z " })));
    expect(long.items.data[0]?.price?.lookup_key).toHaveLength(200);
    expect(long.customer).toBe("cus_x");
    expect(long.id).toBe("sub_z");
    const none = asSubscription(parseBillingEvent(subscription({ items: { data: [{ price: { lookup_key: null } }] }, customer: null, metadata: undefined, cancel_at_period_end: undefined, cancel_at: undefined })));
    expect(none).toMatchObject({ customer: null, cancel_at_period_end: false, cancel_at: null, metadata: {} });
    expect(none.items.data[0]?.price?.lookup_key).toBeNull();
    const noItems = asSubscription(parseBillingEvent(subscription({ items: undefined, current_period_start: undefined, current_period_end: undefined })));
    expect(noItems.items).toEqual({ data: [] });
    expect(() => asSubscription(parseBillingEvent({ id: "x", type: "charge.refunded", created: 1 }))).toThrow();
    expect(BillingEventSchema.safeParse(subscription({ status: "frozen" })).success).toBe(false);
    expect(BillingEventSchema.safeParse(subscription({ cancel_at: -1 })).success).toBe(false);
    expect(BillingEventSchema.safeParse(subscription({ metadata: { north_user_id: "u1" } })).success).toBe(false);
  });

  it("checkout.session.completed refuses a non-uuid client_reference_id; the mode is one of three", () => {
    const checkout = (over: Record<string, unknown> = {}) => ({ id: "evt_c", type: "checkout.session.completed", created: 1, data: { object: { id: "cs_1", customer: "cus_1", client_reference_id: uuid, mode: "subscription", subscription: "sub_1", payment_status: "paid", metadata: { north_pack_id: "pack_100", other: "x" }, ...over } } });
    const parsed = parseBillingEvent(checkout());
    expect(parsed).toEqual({
      id: "evt_c",
      type: "checkout.session.completed",
      created: 1,
      data: { object: { id: "cs_1", customer: "cus_1", client_reference_id: uuid, mode: "subscription", subscription: "sub_1", payment_status: "paid", amount_total: null, currency: null, metadata: { north_pack_id: "pack_100" } } },
    });
    expect(parseBillingEvent(parsed)).toEqual(parsed);
    expect(BillingEventSchema.safeParse(checkout({ amount_total: -1 })).success).toBe(false);
    expect(BillingEventSchema.safeParse(checkout({ client_reference_id: "user-1" })).success).toBe(false);
    expect(BillingEventSchema.safeParse(checkout({ client_reference_id: `${uuid}<instructions>` })).success).toBe(false);
    expect(BillingEventSchema.safeParse(checkout({ mode: "gift" })).success).toBe(false);
    const bare = parseBillingEvent(checkout({ client_reference_id: null, subscription: null, metadata: undefined, mode: "payment" }));
    if ("ignored" in bare) throw new Error("known type");
    expect(bare.data.object).toMatchObject({ client_reference_id: null, subscription: null, mode: "payment", metadata: {} });
    expect(billingUserHint(parsed as never)).toBe(uuid);
    expect(billingUserHint(bare)).toBeNull();
    expect(billingCustomerId(bare)).toBe("cus_1");
  });

  it("invoices keep the subscription, the billing reason, each line's period, amount and kind, and the amount paid; the customer and user hint resolve", () => {
    const invoice = (over: Record<string, unknown> = {}) => ({ id: "evt_i", type: "invoice.paid", created: 5, data: { object: { id: "in_1", customer: "cus_1", subscription: "sub_1", amount_paid: 29900, amount_due: 29900, lines: { object: "list", data: [{ id: "il_1", period: { start: 10, end: 20 }, amount: 29900 }] }, metadata: { north_user_id: uuid }, ...over } } });
    const parsed = parseBillingEvent(invoice());
    const line = { amount: 29900, period: { start: 10, end: 20 }, type: null, proration: false, price: null, parent: null };
    expect(parsed).toEqual({ id: "evt_i", type: "invoice.paid", created: 5, data: { object: { id: "in_1", customer: "cus_1", subscription: "sub_1", amount_paid: 29900, billing_reason: null, lines: { data: [line] }, metadata: { north_user_id: uuid }, parent: null } } });
    expect(parseBillingEvent(parsed)).toEqual(parsed);
    expect(billingUserHint(parsed as never)).toBe(uuid);
    expect(billingCustomerId(parsed as never)).toBe("cus_1");
    const modern = asInvoice(parseBillingEvent(invoice({ subscription: undefined, parent: { type: "subscription_details", subscription_details: { subscription: "sub_9", metadata: {} } } })));
    expect(modern.subscription).toBeNull();
    expect(modern.parent?.subscription_details?.subscription).toBe("sub_9");
    expect(() => asInvoice(parseBillingEvent(subscription()))).toThrow();
    expect(BillingEventSchema.safeParse(invoice({ amount_paid: -1 })).success).toBe(false);
    expect(BillingEventSchema.safeParse(invoice({ lines: { data: [{ period: { start: "a", end: 1 } }] } })).success).toBe(false);
    const failed = parseBillingEvent(invoice({ lines: undefined, amount_paid: undefined, customer: undefined, metadata: undefined }));
    if ("ignored" in failed) throw new Error("known type");
    expect(failed.data.object).toMatchObject({ customer: null, amount_paid: 0, lines: { data: [] }, metadata: {} });
    expect(billingUserHint(failed)).toBeNull();
    expect(billingCustomerId(failed)).toBeNull();
  });
});

describe("DEC-1 nothing new passes the gate in M6", () => {
  it("ACTION_KINDS is unchanged: checkout, portal and export are not actions", () => {
    expect([...ACTION_KINDS]).toEqual(M5_ACTION_KINDS);
    expect(ACTION_KINDS).toHaveLength(27);
    for (const kind of ACTION_KINDS) expect(providerForAction(kind)).not.toBe("stripe");
  });
});

describe("BIL-1 / EXP-1 events and providers", () => {
  it("the six M6 events are named and their schemas validate the payloads", () => {
    expect(EVENT.billingSessionRequested).toBe("billing/session_requested");
    expect(EVENT.billingEvent).toBe("billing/event");
    expect(EVENT.billingTick).toBe("billing/tick");
    expect(EVENT.usageTick).toBe("usage/tick");
    expect(EVENT.retentionTick).toBe("retention/tick");
    expect(EVENT.exportRequested).toBe("export/requested");
    expect(new Set(Object.values(EVENT)).size).toBe(Object.keys(EVENT).length);
    expect(BillingSessionRequestedSchema.safeParse({ sessionId: uuid, userId: uuid }).success).toBe(true);
    expect(BillingSessionRequestedSchema.safeParse({ sessionId: "s1", userId: uuid }).success).toBe(false);
    expect(BillingEventPayloadSchema.safeParse({ billingEventId: uuid, userId: uuid }).success).toBe(true);
    expect(BillingEventPayloadSchema.safeParse({ billingEventId: uuid }).success).toBe(false);
    expect(ExportRequestedSchema.safeParse({ exportId: uuid, userId: uuid }).success).toBe(true);
    expect(ExportRequestedSchema.safeParse({ exportId: uuid, userId: "me" }).success).toBe(false);
  });

  it("stripe joins OAUTH_CODE_PROVIDERS (the user's own read, OUT-2); the platform's Stripe is not a connection", () => {
    expect(OAUTH_CODE_PROVIDERS).toEqual(["github", "vercel", "meta_ads", "gmail", "stripe"]);
    expect(providerForAction("spend.oneoff")).toBeNull();
    expect(providerForAction("payment_account.change")).toBeNull();
  });

  it("companies: statuses unchanged, the three paused reasons", () => {
    expect(COMPANY_STATUSES).toEqual(["active", "paused", "archived"]);
    expect(PAUSED_REASONS).toEqual(["user", "subscription_ended", "retention"]);
  });
});

const input = (over: Partial<BriefInput> = {}): BriefInput => ({
  day: "2026-10-20",
  companyName: "Ledger Co",
  stopped: false,
  blocked: null,
  yesterday: { outcomes: [], actions: [] },
  metrics: [],
  goal: null,
  decisions: { pending: [], deferred: 0, answeredYesterday: 0 },
  today: [],
  spend: [],
  signals: [],
  escalations: [],
  ...over,
});

describe("BRF-1 the brief's blocked line", () => {
  it("blocked is credits or subscription; rendered as the first line after the headline, before the kill-switch line", () => {
    expect(BRIEF_BLOCK_REASONS).toEqual(["subscription_ended", "credits_exhausted"]);
    expect(BLOCKED_WORDS.subscription_ended).toContain("paused: subscription ended");
    expect(BLOCKED_WORDS.credits_exhausted).toContain("waiting for credits");
    const ended = briefMarkdown(composeBrief(input({ stopped: true, blocked: { reason: "subscription_ended" } }))).split("\n");
    expect(ended[0]).toBe("# Morning brief: Ledger Co, 2026-10-20");
    expect(ended[1]).toBe(BLOCKED_WORDS.subscription_ended);
    expect(ended[2]).toBe("All agents are stopped (kill switch).");
    const credits = briefMarkdown(composeBrief(input({ blocked: { reason: "credits_exhausted" } }))).split("\n");
    expect(credits[1]).toBe(BLOCKED_WORDS.credits_exhausted);
    expect(credits[2]).toBe("");
    const plain = briefMarkdown(composeBrief(input())).split("\n");
    expect(plain[1]).toBe("");
    expect(briefMarkdown(composeBrief(input()))).not.toContain("UTC");
  });

  it("BriefSchema carries blocked (null by default for M5 rows) and refuses other reasons; spend has no day label", () => {
    const brief = composeBrief(input({ blocked: { reason: "credits_exhausted" } }));
    expect(brief.blocked).toEqual({ reason: "credits_exhausted" });
    expect(BriefSchema.safeParse(brief).success).toBe(true);
    expect(BriefSchema.parse({ ...brief, blocked: undefined }).blocked).toBeNull();
    expect(BriefSchema.safeParse({ ...brief, blocked: { reason: "kill_switch" } }).success).toBe(false);
    expect(BriefSchema.safeParse({ ...brief, blocked: "credits" }).success).toBe(false);
    expect(BriefSchema.shape.spend.element.shape).not.toHaveProperty("dayLabel");
    expect(BriefSchema.shape.spend.element.safeParse({ category: "ads", spentTodayUsd: 1, dailyCapUsd: 2, spentTotalUsd: 3, totalCapUsd: 4, dayLabel: "UTC day" }).data).not.toHaveProperty("dayLabel");
  });
});

describe("BIL-2 the brief names the month's usage against the plan price", () => {
  it("renders the ratio as a whole percent at the top of Spend, and nothing when unknown or the price is 0", () => {
    const usage = { ratio: 0.401, costUsd: 120, priceUsd: 299 };
    const text = briefMarkdown(composeBrief(input({ usage })));
    const lines = text.split("\n");
    expect(lines[lines.indexOf("## Spend") + 1]).toBe("- Agents used 40 % of your $299 plan price this month ($120).");
    expect(composeBrief(input({ usage })).usage).toEqual(usage);
    expect(briefMarkdown(composeBrief(input()))).not.toContain("plan price");
    expect(briefMarkdown(composeBrief(input({ usage: { ratio: 0, costUsd: 0, priceUsd: 0 } })))).not.toContain("plan price");
  });

  it("BriefSchema carries usage, null by default so M5 and early M6 rows still parse", () => {
    const brief = composeBrief(input({ usage: { ratio: 1.25, costUsd: 123.75, priceUsd: 99 } }));
    expect(BriefSchema.safeParse(brief).success).toBe(true);
    expect(BriefSchema.parse({ ...brief, usage: undefined }).usage).toBeNull();
    expect(composeBrief(input()).usage).toBeNull();
    expect(BriefSchema.safeParse({ ...brief, usage: { ratio: -1, costUsd: 0, priceUsd: 99 } }).success).toBe(false);
  });
});

describe("the package index exports the M6 contracts", () => {
  it("every shared name is reachable from @north/core", () => {
    const names = [
      "SUBSCRIPTION_PLANS",
      "CREDIT_PACKS",
      "TRIAL_DAYS",
      "RETENTION_DAYS",
      "CREDIT_GRACE",
      "USAGE_ALERT_RATIO",
      "SANDBOX_USD_PER_MINUTE",
      "planByLookupKey",
      "packById",
      "BILLING_EVENT_TYPES",
      "BillingEventSchema",
      "parseBillingEvent",
      "ENTITLEMENT_STATUSES",
      "EntitlementSchema",
      "trialEntitlement",
      "applyBillingEvent",
      "isActive",
      "canCreateCompany",
      "shouldEndTrial",
      "retentionUntil",
      "entitlementTransition",
      "CREDIT_ENTRY_KINDS",
      "CreditEntrySchema",
      "creditBalance",
      "creditGrantsFor",
      "trialGrant",
      "consumeEntry",
      "expireEntry",
      "canDispatch",
      "UsageSchema",
      "usageRatio",
      "usageAlertDue",
      "sandboxCostUsd",
      "localMonth",
      "DISPATCH_BLOCK_REASONS",
      "dispatchDecision",
      "EXPORT_KINDS",
      "EXPORT_STATUSES",
      "ExportRequestSchema",
      "ExportManifestSchema",
      "exportPath",
      "EXPORT_TTL_DAYS",
      "PDF_KINDS",
      "PPTX_KINDS",
      "PortfolioBriefSchema",
      "PORTFOLIO_MAX_WORDS",
      "composePortfolioBrief",
      "portfolioMarkdown",
      "PublicPageSchema",
      "PublicPageViewSchema",
      "publicPageView",
      "PAUSED_REASONS",
      "COMPANY_STATUSES",
      "BillingSessionRequestedSchema",
      "BillingEventPayloadSchema",
      "ExportRequestedSchema",
      "BLOCKED_WORDS",
      "BRIEF_BLOCK_REASONS",
    ];
    for (const name of names) expect(name in core, name).toBe(true);
  });
});
