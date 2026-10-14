import { describe, expect, it } from "vitest";
import { attribute, channelReport, type LedgerEntry } from "../src/ledger/attribution";
import { applySpend, headroom, wouldExceedBudget, type BudgetState } from "../src/budget/guard";
import { MODEL_ROUTING, resolveModel } from "../src/models";
import { maxTier, tierWithin } from "../src/tiers";

describe("OUT-1 ledger attribution", () => {
  it("computes delta and cost per unit", () => {
    expect(attribute({ before: 10, after: 25, costUsd: 30 })).toEqual({ delta: 15, costPerUnit: 2 });
    expect(attribute({ before: 10, after: 10, costUsd: 30 })).toEqual({ delta: 0, costPerUnit: null });
  });

  it("reports working and not-working channels", () => {
    const e = (channel: string, before: number, after: number, cost: number): LedgerEntry => ({ taskId: "t", metricKey: "signups", before, after, costUsd: cost, channel, measuredAt: "2026-10-14T00:00:00Z" });
    const report = channelReport([e("meta_ads", 0, 5, 20), e("meta_ads", 5, 9, 20), e("cold_email", 9, 9, 5), e("cold_email", 9, 9, 5), e("seo", 9, 10, 0)]);
    expect(report.find((r) => r.channel === "meta_ads")).toMatchObject({ verdict: "working", totalDelta: 9, totalCostUsd: 40 });
    expect(report.find((r) => r.channel === "cold_email")?.verdict).toBe("not_working");
    expect(report.find((r) => r.channel === "seo")?.verdict).toBe("unknown");
  });
});

describe("budget guard", () => {
  const ads: BudgetState = { category: "ads", totalLimitUsd: 100, dailyLimitUsd: 10, spentTotalUsd: 95, spentTodayUsd: 4 };
  it("knows the headroom and whether a spend would exceed either cap", () => {
    expect(headroom(ads)).toEqual({ totalRemainingUsd: 5, dailyRemainingUsd: 6 });
    expect(wouldExceedBudget(ads, 5)).toBe(false);
    expect(wouldExceedBudget(ads, 5.01)).toBe(true);
    expect(wouldExceedBudget({ ...ads, spentTotalUsd: 0 }, 7)).toBe(true);
  });
  it("applies spend immutably", () => {
    const next = applySpend(ads, 3);
    expect(next.spentTodayUsd).toBe(7);
    expect(ads.spentTodayUsd).toBe(4);
  });
});

describe("model routing and tiers", () => {
  it("resolves aliases and rejects unknown ones", () => {
    expect(resolveModel("planner")).toBe(MODEL_ROUTING.planner);
    expect(() => resolveModel("gpt")).toThrow(/Unknown model alias/);
  });
  it("orders tiers", () => {
    expect(maxTier("K1", "K2")).toBe("K2");
    expect(tierWithin("K2", "K1")).toBe(false);
    expect(tierWithin("K1", "K1")).toBe(true);
  });
});
