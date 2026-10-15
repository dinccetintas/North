import { describe, expect, it } from "vitest";
import { trialEntitlement, type Entitlement } from "@north/core/billing/entitlements";
import { billingSummary, checkoutConfirmed, companiesLabel, creditEntryRows, daysLeft, packCards, planCards, queuedBlockReason, safeRedirectUrl } from "./billing-view";

const USER = "00000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-15T10:00:00.000Z");

const trial = trialEntitlement(USER, new Date("2026-10-13T10:00:00.000Z"));
const pro: Entitlement = {
  ...trial,
  planId: "pro",
  status: "active",
  companyLimit: 3,
  monthlyCredits: 1000,
  priceUsd: 299,
  periodStart: "2026-10-15T09:00:00.000Z",
  periodEnd: "2026-11-15T09:00:00.000Z",
  stripeCustomerId: "cus_sandbox_1",
  stripeSubscriptionId: "sub_sandbox_1",
};
const ended: Entitlement = { ...pro, status: "ended", endedAt: "2026-10-14T00:00:00.000Z", retentionUntil: "2027-01-12T00:00:00.000Z" };

describe("BIL-1 billing view: plan, period and companies", () => {
  it("counts whole days left, never below zero", () => {
    expect(daysLeft("2026-10-27T10:00:00.000Z", NOW)).toBe(12);
    expect(daysLeft("2026-10-15T11:00:00.000Z", NOW)).toBe(1);
    expect(daysLeft("2026-10-01T00:00:00.000Z", NOW)).toBe(0);
    expect(daysLeft("not a date", NOW)).toBe(0);
  });

  it("says how many companies of the limit are in use", () => {
    expect(companiesLabel(1, 3)).toBe("1 of 3 companies");
    expect(companiesLabel(1, 1)).toBe("1 of 1 company");
    expect(companiesLabel(0, 10)).toBe("0 of 10 companies");
  });

  it("summarises a trial with the days left and no retention notice", () => {
    const s = billingSummary(trial, 1, NOW);
    expect(s.planName).toBe("Solo");
    expect(s.status).toBe("trialing");
    expect(s.statusLabel).toBe("Trial");
    expect(s.period).toBe("Trial · 12 days left");
    expect(s.companies).toBe("1 of 1 company");
    expect(s.endedNotice).toBeNull();
    expect(s.retentionUntil).toBeNull();
  });

  it("summarises an active, a canceled and a past-due subscription", () => {
    expect(billingSummary(pro, 1, NOW).period).toBe("Renews on 2026-11-15");
    expect(billingSummary(pro, 1, NOW).companies).toBe("1 of 3 companies");
    expect(billingSummary({ ...pro, status: "canceled", cancelAt: "2026-11-15T09:00:00.000Z" }, 2, NOW).period).toBe("Ends on 2026-11-15");
    expect(billingSummary({ ...pro, status: "past_due" }, 2, NOW).period).toBe("Payment failed · update your card in Manage billing");
  });

  it("tells an ended user their agents are paused and until when the data is kept", () => {
    const s = billingSummary(ended, 2, NOW);
    expect(s.statusLabel).toBe("Ended");
    expect(s.period).toBe("Ended on 2026-10-14");
    expect(s.endedNotice).toBe("Your agents are paused. Subscribe to resume; your data is kept until 2027-01-12.");
    expect(s.retentionUntil).toBe("2027-01-12");
  });
});

describe("BIL-1 plan grid", () => {
  it("offers a checkout for every plan during a trial, none of them current", () => {
    const cards = planCards(trial);
    expect(cards.map((c) => c.id)).toEqual(["solo", "pro", "scale"]);
    expect(cards.map((c) => c.action)).toEqual(["checkout", "checkout", "checkout"]);
    expect(cards.map((c) => c.actionLabel)).toEqual(["Choose Solo", "Choose Pro", "Choose Scale"]);
    expect(cards[1]).toMatchObject({ name: "Pro", priceLabel: "$299 / month", companiesLabel: "3 companies", creditsLabel: "1,000 runs a month" });
    expect(cards[0]?.companiesLabel).toBe("1 company");
  });

  it("marks the subscribed plan Current and sends a switch to the billing portal, never a second checkout", () => {
    const cards = planCards(pro);
    expect(cards.find((c) => c.id === "pro")).toMatchObject({ current: true, action: "current", actionLabel: "Current" });
    expect(cards.find((c) => c.id === "scale")).toMatchObject({ current: false, action: "portal", actionLabel: "Switch in billing" });
  });

  it("offers a new checkout after the subscription ended", () => {
    expect(planCards(ended).map((c) => c.action)).toEqual(["checkout", "checkout", "checkout"]);
    expect(planCards(null).map((c) => c.action)).toEqual(["checkout", "checkout", "checkout"]);
  });

  it("lists the credit packs from the plans file", () => {
    expect(packCards()).toEqual([{ id: "pack_100", label: "100 credits", priceLabel: "$29" }]);
  });
});

describe("BIL-2 credit ledger rows", () => {
  it("signs amounts, names the kind and keeps the order it was given", () => {
    const rows = creditEntryRows([
      { id: "e2", kind: "consume", amount: -1, ref: "run:r1", note: "", createdAt: "2026-10-15T09:30:00.000Z" },
      { id: "e1", kind: "grant_plan", amount: 300, ref: `trial:${USER}`, note: "Solo trial", createdAt: "2026-10-13T10:00:00.000Z" },
    ]);
    expect(rows).toEqual([
      { id: "e2", kind: "consume", kindLabel: "Agent run", amountLabel: "−1", note: "", day: "2026-10-15" },
      { id: "e1", kind: "grant_plan", kindLabel: "Plan credits", amountLabel: "+300", note: "Solo trial", day: "2026-10-13" },
    ]);
  });
});

describe("BIL-1 checkout confirmation: only the webhook's entitlement proves it", () => {
  const session = { kind: "checkout" as const, planId: "pro", providerRef: "cs_sandbox_1" };

  it("is unconfirmed while the entitlement is still the trial, confirmed once the plan is live", () => {
    expect(checkoutConfirmed(session, trial, [])).toBe(false);
    expect(checkoutConfirmed(session, pro, [])).toBe(true);
    expect(checkoutConfirmed(session, ended, [])).toBe(false);
    expect(checkoutConfirmed(session, null, [])).toBe(false);
  });

  it("confirms a credit pack by its ledger ref, not by the redirect", () => {
    const pack = { kind: "credit_pack" as const, planId: null, providerRef: "cs_sandbox_2" };
    expect(checkoutConfirmed(pack, pro, ["run:1"])).toBe(false);
    expect(checkoutConfirmed(pack, pro, ["pack:cs_sandbox_2"])).toBe(true);
    expect(checkoutConfirmed({ ...pack, providerRef: null }, pro, ["pack:null"])).toBe(false);
  });

  it("without a known session falls back to a live subscription", () => {
    expect(checkoutConfirmed(null, trial, [])).toBe(false);
    expect(checkoutConfirmed(null, pro, [])).toBe(true);
  });
});

describe("BIL-1 billing redirect URLs", () => {
  it("follows https and the sandbox's loopback http only", () => {
    expect(safeRedirectUrl("https://checkout.stripe.com/c/pay/cs_test_1")).toBe("https://checkout.stripe.com/c/pay/cs_test_1");
    expect(safeRedirectUrl("http://127.0.0.1:3101/sandbox/billing/checkout/abc")).toBe("http://127.0.0.1:3101/sandbox/billing/checkout/abc");
    expect(safeRedirectUrl("http://localhost:3101/sandbox/billing/portal/cus_1")).toBe("http://localhost:3101/sandbox/billing/portal/cus_1");
    expect(safeRedirectUrl("http://evil.example/checkout")).toBeNull();
    expect(safeRedirectUrl("javascript:alert(1)")).toBeNull();
    expect(safeRedirectUrl("https://user:pw@checkout.stripe.com/")).toBeNull();
    expect(safeRedirectUrl(null)).toBeNull();
  });
});

describe("BIL-2 queued task block reason", () => {
  it("shows the dispatch refusal on queued tasks only; the kill switch has its own bar", () => {
    expect(queuedBlockReason("queued", "credits_exhausted")).toBe("credits_exhausted");
    expect(queuedBlockReason("queued", "subscription_ended")).toBe("subscription_ended");
    expect(queuedBlockReason("running", "credits_exhausted")).toBeNull();
    expect(queuedBlockReason("queued", "kill_switch")).toBeNull();
    expect(queuedBlockReason("queued", null)).toBeNull();
  });
});
