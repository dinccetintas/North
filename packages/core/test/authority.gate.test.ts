import { describe, expect, it } from "vitest";
import { classify, gate, ActionSpecSchema, FencePolicySchema, type ActionSpec, type FencePolicy, type FenceTarget, type PolicyContext } from "../src/authority/index";
import type { BudgetState } from "../src/budget/guard";
import type { OutreachContext, SenderIdentity } from "../src/outreach/policy";

const spec = (over: Partial<ActionSpec>): ActionSpec =>
  ActionSpecSchema.parse({ kind: "research", companyId: "c1", agentRole: "growth", description: "Start a $10/day test campaign", ...over });

const ads: BudgetState = { category: "ads", totalLimitUsd: 300, dailyLimitUsd: 20, dailyExtraUsd: 0, spentTotalUsd: 0, spentTodayUsd: 0 };

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
    // BUD-1: a $50 five-day campaign is $10 against the $20 daily cap, so no "budget cap" here (M4 profile fix).
    const decision = gate(spec({ kind: "ads.start", amountUsd: 50, category: "ads", payload: { dailyBudgetUsd: 10 } }), ctx());
    if (decision.kind !== "card") throw new Error("expected card");
    expect(decision.card.rationale).toBe("This action spends money and says something new in public. Growth asks for it; tier K2. Details: $10/day.");
    const capped = gate(spec({ kind: "ads.start", amountUsd: 50, category: "ads", payload: { dailyBudgetUsd: 25 } }), ctx());
    if (capped.kind !== "card") throw new Error("expected card");
    expect(capped.card.rationale).toBe(
      "This action spends money, says something new in public and would exceed the budget cap. Growth asks for it; tier K2. Details: $25/day.",
    );
    const k3 = gate(spec({ kind: "contract.sign", agentRole: "ops_finance" }), ctx());
    if (k3.kind !== "card") throw new Error("expected card");
    expect(k3.card.rationale).toBe("This action cannot be undone and is legally binding. Operations and Finance asks for it; tier K3.");
    expect(k3.card.rationale.length).toBeLessThanOrEqual(600);
  });

  it("shows the payload facts the adapter will act on, so approval is never blind", () => {
    const ads = gate(spec({ kind: "ads.start", amountUsd: 50, category: "ads", payload: { dailyBudgetUsd: 10, audience: "solo consultants", name: "Launch" } }), ctx());
    if (ads.kind !== "card") throw new Error("expected card");
    expect(ads.card.rationale).toContain("Details: $10/day, audience: solo consultants, campaign: Launch.");
    const mail = gate(spec({ kind: "email.send.first_contact", agentRole: "sales", payload: { to: "mara@example.test", subject: "Hello <b>", text: "secret body" } }), ctx());
    if (mail.kind !== "card") throw new Error("expected card");
    expect(mail.card.rationale).toContain("to mara@example.test, subject: Hello <b>");
    expect(mail.card.rationale).not.toContain("secret body");
    const long = gate(spec({ kind: "email.send.first_contact", agentRole: "sales", payload: { to: "x@example.test", subject: "s".repeat(1000) } }), ctx());
    if (long.kind !== "card") throw new Error("expected card");
    expect(long.card.rationale.length).toBeLessThanOrEqual(600);
  });

  it("refuses a payload that would spend more than the gated amount", () => {
    expect(ActionSpecSchema.safeParse({ kind: "ads.start", companyId: "c", agentRole: "growth", description: "d", amountUsd: 10, payload: { dailyBudgetUsd: 1000 } }).success).toBe(false);
    expect(ActionSpecSchema.safeParse({ kind: "ads.start", companyId: "c", agentRole: "growth", description: "d", payload: { dailyBudgetUsd: 10 } }).success).toBe(false);
    expect(ActionSpecSchema.safeParse({ kind: "ads.start", companyId: "c", agentRole: "growth", description: "d", amountUsd: 50, payload: { dailyBudgetUsd: 10 } }).success).toBe(true);
    expect(ActionSpecSchema.safeParse({ kind: "research", companyId: "c", agentRole: "research", description: "d", payload: { dailyBudgetUsd: 1000 } }).success).toBe(true);
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

const fencePolicy = (over: Partial<FencePolicy> = {}): FencePolicy => FencePolicySchema.parse({ enabled: true, metaAdAccounts: ["act_1"], ...over });
const fenced = (targets: readonly FenceTarget[], policy: FencePolicy = fencePolicy()): Pick<PolicyContext, "fence"> => ({ fence: { policy, targets } });
const adAccount = (id: string): FenceTarget => ({ kind: "meta_ad_account", id });

const identity: SenderIdentity = { legalName: "Acme Ltd", postalAddress: "1 Main Street, Springfield" };
const outreach = (over: Partial<OutreachContext> = {}): Pick<PolicyContext, "outreach"> => ({ outreach: { suppressed: [], senderIdentity: identity, ...over } });
const mail = (to: string, over: Partial<ActionSpec> = {}): ActionSpec =>
  spec({ kind: "email.send.first_contact", agentRole: "sales", payload: { to, subject: "Hello" }, ...over });
const adsStart = (over: Partial<ActionSpec> = {}): ActionSpec => spec({ kind: "ads.start", amountUsd: 10, category: "ads", ...over });

describe("TST-5 gate(): the test-account fence", () => {
  it("TST-5 blocks an action aimed outside the fence, with the classified tier and the test_fence reason last", () => {
    const action = adsStart();
    const decision = gate(action, ctx(fenced([adAccount("act_9")])));
    expect(decision).toMatchObject({ kind: "block", tier: "K2" });
    expect(decision.reasons).toEqual([...classify(action).reasons, "test_fence"]);
  });

  it("TST-5 lets the same action through to its card when every target is inside the fence", () => {
    const inside = gate(adsStart(), ctx(fenced([adAccount("act_1")])));
    expect(inside.kind).toBe("card");
    expect(inside).toEqual(gate(adsStart(), ctx()));
  });

  it("TST-5 one target outside is enough: every target must be on the allow-list", () => {
    expect(gate(adsStart(), ctx(fenced([adAccount("act_1"), adAccount("act_9")]))).reasons).toContain("test_fence");
  });

  it("TST-5 a disabled fence and an absent fence are both no-ops", () => {
    const outside = [adAccount("act_9")];
    expect(gate(adsStart(), ctx(fenced(outside, fencePolicy({ enabled: false })))).kind).toBe("card");
    expect(gate(adsStart(), ctx()).kind).toBe("card");
  });

  it("TST-5 blocks a recipient outside the allowed domains, and a Vercel project without the prefix", () => {
    const policy = fencePolicy({ recipientDomains: ["example.test"] });
    const real = gate(mail("mara@real-customer.com"), ctx(fenced([{ kind: "recipient", email: "mara@real-customer.com" }], policy)));
    expect(real).toMatchObject({ kind: "block" });
    expect(real.reasons).toContain("test_fence");
    const own = gate(mail("mara@example.test"), ctx(fenced([{ kind: "recipient", email: "mara@example.test" }], policy)));
    expect(own.kind).toBe("card");
    const project = gate(spec({ kind: "deploy.preview" }), ctx(fenced([{ kind: "vercel_project", name: "prod-site" }])));
    expect(project).toMatchObject({ kind: "block", tier: "K1" });
  });

  it("TST-5 blocks even a K0 action aimed outside the fence", () => {
    expect(gate(spec({ kind: "research" }), ctx(fenced([adAccount("act_9")])))).toMatchObject({ kind: "block", tier: "K0" });
  });

  it("TST-5 a fence block keeps the K3 tier of what it stopped", () => {
    expect(gate(spec({ kind: "contract.sign" }), ctx(fenced([adAccount("act_9")])))).toMatchObject({ kind: "block", tier: "K3" });
  });

  it("TST-5 an auto rule never rescues a fenced action", () => {
    const rule = { id: "r1", kind: "ads.start" as const, maxAmountUsd: 50, category: "ads" as const, active: true };
    const open = gate(adsStart(), ctx({ autoRules: [rule] }));
    expect(open).toMatchObject({ kind: "run", autoRuleId: "r1" });
    const shut = gate(adsStart(), ctx({ autoRules: [rule], ...fenced([adAccount("act_9")]) }));
    expect(shut.kind).toBe("block");
    expect(shut.reasons).not.toContain("auto_rule");
    expect("autoRuleId" in shut).toBe(false);
  });

  it("TST-5 the fence answers before the budget cap, and the kill switch answers before the fence", () => {
    const overCap = adsStart({ amountUsd: 25 });
    const fencedOverCap = gate(overCap, ctx(fenced([adAccount("act_9")])));
    expect(fencedOverCap.reasons).toContain("test_fence");
    expect(fencedOverCap.reasons).not.toContain("budget_cap");
    const stopped = gate(adsStart(), ctx({ killSwitchActive: true, ...fenced([adAccount("act_9")]) }));
    expect(stopped.reasons).toContain("kill_switch");
    expect(stopped.reasons).not.toContain("test_fence");
  });

  it("TST-5 returns frozen decisions and leaves its inputs as they were", () => {
    const action = adsStart();
    const context = ctx(fenced([adAccount("act_9")]));
    const before = JSON.stringify({ action, context });
    const decision = gate(action, context);
    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.reasons)).toBe(true);
    expect(JSON.stringify({ action, context })).toBe(before);
  });
});

describe("CMP-1 gate(): the outreach policy", () => {
  it("CMP-1 blocks a send to a suppressed address, with the classified tier and the suppressed reason last", () => {
    const action = mail("mara@example.test");
    const decision = gate(action, ctx(outreach({ suppressed: ["mara@example.test"] })));
    expect(decision).toMatchObject({ kind: "block", tier: "K2" });
    expect(decision.reasons).toEqual([...classify(action).reasons, "suppressed"]);
  });

  it("CMP-1 blocks a suppressed domain and a reply to a suppressed address", () => {
    const domain = gate(mail("mara@example.test"), ctx(outreach({ suppressed: ["Example.TEST"] })));
    expect(domain.reasons).toContain("suppressed");
    const reply = gate(spec({ kind: "email.send.reply", agentRole: "sales", payload: { to: "mara@example.test", subject: "Re: Hello" } }), ctx(outreach({ suppressed: ["mara@example.test"] })));
    expect(reply).toMatchObject({ kind: "block" });
    expect(reply.reasons).toContain("suppressed");
  });

  it("CMP-1 blocks a batch when any one recipient is suppressed", () => {
    const batch = mail("a@example.test", { payload: { recipients: ["a@example.test", "b@example.test"], batchId: "batch-1", subject: "Hello" } });
    expect(gate(batch, ctx(outreach({ suppressed: ["b@example.test"] }))).reasons).toContain("suppressed");
  });

  it("CMP-1 blocks a send when the company has no sender identity", () => {
    const decision = gate(mail("mara@example.test"), ctx(outreach({ senderIdentity: null })));
    expect(decision).toMatchObject({ kind: "block", tier: "K2" });
    expect(decision.reasons).toContain("no_sender_identity");
    expect(decision.reasons).not.toContain("suppressed");
  });

  it("CMP-1 refuses a recipient it cannot read as one address", () => {
    expect(gate(mail("not an address"), ctx(outreach())).reasons).toContain("suppressed");
  });

  it("CMP-1 lets a clean send with an identity go on to its card, and an absent context is a no-op", () => {
    const clean = gate(mail("mara@example.test"), ctx(outreach({ suppressed: ["other@example.test"] })));
    expect(clean.kind).toBe("card");
    expect(clean).toEqual(gate(mail("mara@example.test"), ctx()));
  });

  it("CMP-1 leaves kinds that do not write to a person alone", () => {
    const strict = ctx(outreach({ suppressed: ["example.test"], senderIdentity: null }));
    expect(gate(spec({ kind: "deploy.preview" }), strict).kind).toBe("notify");
    expect(gate(spec({ kind: "research" }), strict).kind).toBe("run");
  });

  it("CMP-1 an auto rule never rescues a suppressed send", () => {
    const rule = { id: "r3", kind: "email.send.first_contact" as const, active: true };
    expect(gate(mail("mara@example.test"), ctx({ autoRules: [rule] })).kind).toBe("run");
    const shut = gate(mail("mara@example.test"), ctx({ autoRules: [rule], ...outreach({ suppressed: ["mara@example.test"] }) }));
    expect(shut.kind).toBe("block");
    expect(shut.reasons).not.toContain("auto_rule");
  });

  it("CMP-1 the fence answers before the outreach policy", () => {
    const both = gate(mail("mara@example.test"), ctx({ ...fenced([adAccount("act_9")]), ...outreach({ suppressed: ["mara@example.test"] }) }));
    expect(both.reasons).toContain("test_fence");
    expect(both.reasons).not.toContain("suppressed");
  });

  it("CMP-1 the outreach policy answers before the budget cap, and the kill switch answers before it", () => {
    const stopped = gate(mail("mara@example.test"), ctx({ killSwitchActive: true, ...outreach({ senderIdentity: null }) }));
    expect(stopped.reasons).toContain("kill_switch");
    expect(stopped.reasons).not.toContain("no_sender_identity");
  });
});
