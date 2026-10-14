import { describe, expect, it } from "vitest";
import { planCards, priorityScore } from "../src/decisions/quota.js";
import { CardDraftSchema, DEFAULT_DAILY_QUOTA, QuotaSchema, type CardDraft } from "../src/decisions/types.js";

const card = (over: Partial<CardDraft>): CardDraft =>
  CardDraftSchema.parse({
    companyId: "c1",
    question: "Approve?",
    options: [{ id: "approve", label: "Approve" }, { id: "decline", label: "Decline" }],
    recommendedOptionId: "approve",
    rationale: "because",
    expectedImpact: null,
    costUsd: 10,
    dueAt: "2026-10-15T09:00:00.000Z",
    defaultOptionId: "decline",
    tier: "K2",
    actionKind: "ads.start",
    mergeKey: "ads.start:ads",
    ...over,
  });

describe("DEC-3 planCards(): the daily quota is never exceeded and no card is lost", () => {
  it("opens at most the free slots and defers the rest", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => card({ mergeKey: `k${i}`, costUsd: i }));
    const plan = planCards(candidates, { quota: DEFAULT_DAILY_QUOTA, openedToday: 0 });
    expect(plan.open).toHaveLength(3);
    expect(plan.deferred).toHaveLength(7);
    expect(plan.open.length + plan.merged.length + plan.deferred.length).toBe(10);
  });

  it("respects cards already opened today", () => {
    const candidates = [card({ mergeKey: "a" }), card({ mergeKey: "b" })];
    expect(planCards(candidates, { quota: 3, openedToday: 3 }).open).toHaveLength(0);
    expect(planCards(candidates, { quota: 3, openedToday: 2 }).open).toHaveLength(1);
  });

  it("merges low-priority siblings with the same mergeKey instead of spending a slot", () => {
    const candidates = [card({ costUsd: 50 }), card({ costUsd: 5 }), card({ mergeKey: "other", costUsd: 1 })];
    const plan = planCards(candidates, { quota: 2, openedToday: 0 });
    expect(plan.open.map((c) => c.costUsd)).toEqual([50, 1]);
    expect(plan.merged.map((c) => c.costUsd)).toEqual([5]);
  });

  it("never merges K3 cards", () => {
    const candidates = [card({ tier: "K3", defaultOptionId: null, actionKind: "contract.sign", mergeKey: "k3" }), card({ tier: "K3", defaultOptionId: null, actionKind: "contract.sign", mergeKey: "k3" })];
    const plan = planCards(candidates, { quota: 1, openedToday: 0 });
    expect(plan.open).toHaveLength(1);
    expect(plan.merged).toHaveLength(0);
    expect(plan.deferred).toHaveLength(1);
  });

  it("orders by tier, then cost", () => {
    const k2 = card({ mergeKey: "a", costUsd: 100 });
    const k3 = card({ mergeKey: "b", tier: "K3", defaultOptionId: null, actionKind: "data.delete", costUsd: 0 });
    expect(priorityScore(k3)).toBeGreaterThan(priorityScore(k2));
  });

  it("quota is configurable between 1 and 5", () => {
    expect(QuotaSchema.safeParse(0).success).toBe(false);
    expect(QuotaSchema.safeParse(5).success).toBe(true);
    expect(QuotaSchema.safeParse(6).success).toBe(false);
  });
});
