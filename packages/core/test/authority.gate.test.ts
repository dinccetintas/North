import { describe, expect, it } from "vitest";
import { gate, ActionSpecSchema, type ActionSpec, type PolicyContext } from "../src/authority/index";
import type { BudgetState } from "../src/budget/guard";

const spec = (over: Partial<ActionSpec>): ActionSpec =>
  ActionSpecSchema.parse({ kind: "research", companyId: "c1", agentRole: "growth", description: "Start a $10/day test campaign", ...over });

const ads: BudgetState = { category: "ads", totalLimitUsd: 300, dailyLimitUsd: 20, spentTotalUsd: 0, spentTodayUsd: 0 };

const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  killSwitchActive: false,
  budgets: [ads],
  autoRules: [],
  cardDueAt: "2026-10-15T09:00:00.000Z",
  ...over,
});

describe("DEC-1 gate(): the single chokepoint", () => {
  it("runs K0 actions directly", () => {
    expect(gate(spec({ kind: "research" }), ctx()).kind).toBe("run");
  });

  it("notifies for K1 actions", () => {
    const decision = gate(spec({ kind: "deploy.preview" }), ctx());
    expect(decision).toMatchObject({ kind: "notify", tier: "K1" });
  });

  it("opens a card for every K2 action, with a safe default of decline", () => {
    const decision = gate(spec({ kind: "ads.start", amountUsd: 10, category: "ads" }), ctx());
    expect(decision.kind).toBe("card");
    if (decision.kind !== "card") throw new Error("expected card");
    expect(decision.card.defaultOptionId).toBe("decline");
    expect(decision.card.options.length).toBeGreaterThanOrEqual(2);
    expect(decision.card.options.length).toBeLessThanOrEqual(3);
    expect(decision.card.dueAt).toBe("2026-10-15T09:00:00.000Z");
  });

  it("writes the card rationale in plain words, naming the role and the tier (DEC-2 readability)", () => {
    const decision = gate(spec({ kind: "ads.start", amountUsd: 50, category: "ads" }), ctx());
    if (decision.kind !== "card") throw new Error("expected card");
    expect(decision.card.rationale).toBe(
      "This action spends money, says something new in public and would exceed the budget cap. Growth asks for it; tier K2.",
    );
    const k3 = gate(spec({ kind: "contract.sign", agentRole: "ops_finance" }), ctx());
    if (k3.kind !== "card") throw new Error("expected card");
    expect(k3.card.rationale).toBe("This action cannot be undone and is legally binding. Operations and Finance asks for it; tier K3.");
    expect(k3.card.rationale.length).toBeLessThanOrEqual(600);
  });

  it("opens a card with no default for K3 actions", () => {
    const decision = gate(spec({ kind: "contract.sign" }), ctx());
    expect(decision.kind).toBe("card");
    if (decision.kind !== "card") throw new Error("expected card");
    expect(decision.card.defaultOptionId).toBeNull();
    expect(decision.tier).toBe("K3");
  });

  it("blocks everything while the kill switch is active, even K0", () => {
    expect(gate(spec({ kind: "research" }), ctx({ killSwitchActive: true })).kind).toBe("block");
    expect(gate(spec({ kind: "ads.start", amountUsd: 1 }), ctx({ killSwitchActive: true })).kind).toBe("block");
  });

  it("budget protections: exceeding the daily cap escalates to a card and ignores auto rules", () => {
    const rule = { id: "r1", kind: "ads.start" as const, maxAmountUsd: 50, category: "ads" as const, active: true };
    const within = gate(spec({ kind: "ads.start", amountUsd: 15, category: "ads" }), ctx({ autoRules: [rule] }));
    expect(within).toMatchObject({ kind: "run", autoRuleId: "r1" });
    const over = gate(spec({ kind: "ads.start", amountUsd: 25, category: "ads" }), ctx({ autoRules: [rule] }));
    expect(over.kind).toBe("card");
    expect(over.reasons).toContain("budget_cap");
  });

  it("a missing budget category is treated as a cap breach", () => {
    const decision = gate(spec({ kind: "spend.oneoff", amountUsd: 5, category: "tools" }), ctx());
    expect(decision).toMatchObject({ kind: "card", tier: "K2" });
    expect(decision.reasons).toContain("budget_cap");
  });

  it("auto rules apply only to K2 and only when the rule matches kind, category and amount", () => {
    const rule = { id: "r2", kind: "ads.start" as const, maxAmountUsd: 50, category: "ads" as const, active: true };
    expect(gate(spec({ kind: "ads.start", amountUsd: 10, category: "ads" }), ctx({ autoRules: [rule] })).kind).toBe("run");
    expect(gate(spec({ kind: "ads.start", amountUsd: 10, category: "tools" }), ctx({ autoRules: [rule], budgets: [{ ...ads, category: "tools" }] })).kind).toBe("card");
    expect(gate(spec({ kind: "ads.start", amountUsd: 10, category: "ads" }), ctx({ autoRules: [{ ...rule, active: false }] })).kind).toBe("card");
    expect(gate(spec({ kind: "contract.sign" }), ctx({ autoRules: [{ ...rule, kind: "contract.sign" }] })).kind).toBe("card");
  });
});
