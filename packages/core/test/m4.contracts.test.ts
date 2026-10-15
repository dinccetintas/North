import { describe, expect, it } from "vitest";
import { ActionSpecSchema, BatchPayloadSchema, batchPayload, classify, gate, spendProfile, type ActionSpec, type PolicyContext } from "../src/authority/index";
import { capExceeded, effectiveDailyLimit, headroom, wouldExceedBudget, type BudgetState } from "../src/budget/guard";
import { capCardSpec } from "../src/decisions/cap-card";
import { planCards } from "../src/decisions/quota";
import { suggestAutoRule } from "../src/decisions/autorule";
import { AdDeliverySchema, CAMPAIGN_STATUSES, CHANNELS, METRIC_SCOPES, ProvenanceSchema, provenanceKey } from "../src/metrics";
import { AgentOutputSchema, ARTIFACT_KINDS, METRIC_KEYS, OUTCOME_METRIC_KEYS, CHANNEL_METRIC_KEYS, TASK_OWNER, TASK_TYPES, LeadDraftSchema, MAX_LEADS } from "../src/tasks/types";
import { GoalInputSchema } from "../src/onboarding";
import { windowDelta, type LedgerEntry } from "../src/ledger/attribution";
import { LEDGER_CSV_COLUMNS, ledgerCsv } from "../src/ledger/csv";
import { evidenceKindFor } from "../src/evidence";
import { EVIDENCE_KINDS, EvidenceSchema } from "../src/tasks/lifecycle";
import { providerForAction, CONNECTION_PROVIDERS } from "../src/connections";
import { ConnectionOauthCodeSchema, ConnectionRevokedSchema, EVENT, MetricCollectSchema, ProviderTokenSchema } from "../src/events";

const spec = (over: Partial<ActionSpec>): ActionSpec =>
  ActionSpecSchema.parse({ kind: "ads.start", companyId: "c1", agentRole: "growth", description: "Start a test campaign", ...over });

const budget = (over: Partial<BudgetState> = {}): BudgetState => ({
  category: "ads",
  totalLimitUsd: 100,
  dailyLimitUsd: 10,
  dailyExtraUsd: 0,
  spentTotalUsd: 0,
  spentTodayUsd: 0,
  ...over,
});

const ctx = (over: Partial<PolicyContext> = {}): PolicyContext => ({
  killSwitchActive: false,
  budgets: [budget()],
  autoRules: [],
  cardDueAt: "2026-10-16T09:00:00.000Z",
  ...over,
});

const card = (decision: ReturnType<typeof gate>) => {
  if (decision.kind !== "card") throw new Error(`expected card, got ${decision.kind}`);
  return decision.card;
};

describe("BUD-1 spend profile: per-day and total are checked separately", () => {
  it("reads per-day from the payload and total from amountUsd for ads; one-offs and cap raises are both", () => {
    expect(spendProfile(spec({ amountUsd: 50, payload: { dailyBudgetUsd: 10 } }))).toEqual({ perDayUsd: 10, totalUsd: 50 });
    expect(spendProfile(spec({ kind: "ads.budget.change", amountUsd: 20, payload: { dailyBudgetUsd: 5 } }))).toEqual({ perDayUsd: 5, totalUsd: 20 });
    expect(spendProfile(spec({ kind: "spend.oneoff", amountUsd: 30 }))).toEqual({ perDayUsd: 30, totalUsd: 30 });
    expect(spendProfile(spec({ kind: "budget.cap.raise", amountUsd: 10, category: "ads" }))).toEqual({ perDayUsd: 10, totalUsd: 10 });
    expect(spendProfile(spec({ kind: "research" }))).toEqual({ perDayUsd: 0, totalUsd: 0 });
  });

  it("without a daily figure the whole amount counts against today (conservative)", () => {
    expect(spendProfile(spec({ amountUsd: 25 }))).toEqual({ perDayUsd: 25, totalUsd: 25 });
    expect(gate(spec({ amountUsd: 25, category: "ads" }), ctx()).reasons).toContain("budget_cap");
  });

  it("a $10/day x 5 day campaign under a $10 daily / $100 total budget is K2 without budget_cap", () => {
    const decision = gate(spec({ amountUsd: 50, category: "ads", payload: { dailyBudgetUsd: 10, name: "Acme launch test" } }), ctx());
    expect(decision).toMatchObject({ kind: "card", tier: "K2" });
    expect(decision.reasons).not.toContain("budget_cap");
    expect(card(decision).rationale).not.toContain("budget cap");
    expect(card(decision).rationale).toContain("$10/day");
  });

  it("$11/day is budget_cap; $60 total under a $50 total cap is budget_cap", () => {
    expect(gate(spec({ amountUsd: 55, category: "ads", payload: { dailyBudgetUsd: 11 } }), ctx()).reasons).toContain("budget_cap");
    const total = gate(spec({ amountUsd: 60, category: "ads", payload: { dailyBudgetUsd: 10 } }), ctx({ budgets: [budget({ totalLimitUsd: 50 })] }));
    expect(total.reasons).toContain("budget_cap");
  });

  it("guard: profile vs remaining, today's extra raises the effective daily limit, capExceeded per cap", () => {
    const b = budget({ spentTodayUsd: 4, spentTotalUsd: 95 });
    expect(headroom(b)).toEqual({ totalRemainingUsd: 5, dailyRemainingUsd: 6 });
    expect(wouldExceedBudget(b, { perDayUsd: 5, totalUsd: 5 })).toBe(false);
    expect(wouldExceedBudget(b, { perDayUsd: 6.01, totalUsd: 5 })).toBe(true);
    expect(wouldExceedBudget(b, { perDayUsd: 1, totalUsd: 5.01 })).toBe(true);
    expect(effectiveDailyLimit(budget({ dailyExtraUsd: 10 }))).toBe(20);
    expect(headroom(budget({ dailyExtraUsd: 10, spentTodayUsd: 11 })).dailyRemainingUsd).toBe(9);
    expect(capExceeded(budget({ spentTodayUsd: 11 }))).toEqual({ daily: true, total: false });
    expect(capExceeded(budget({ spentTodayUsd: 11, dailyExtraUsd: 10 }))).toEqual({ daily: false, total: false });
    expect(capExceeded(budget({ spentTotalUsd: 100 }))).toEqual({ daily: false, total: true });
    expect(capExceeded(budget({ spentTodayUsd: 9.99 }))).toEqual({ daily: false, total: false });
  });
});

describe("DEC-1 new action kinds classify by the rule table", () => {
  it("ads.resume is external, reversible, no spend: K1 notify; budget.cap.raise spends money: K2", () => {
    expect(classify(spec({ kind: "ads.resume" }))).toEqual({ tier: "K1", reasons: ["reversible_no_spend"] });
    expect(gate(spec({ kind: "ads.resume" }), ctx())).toMatchObject({ kind: "notify", tier: "K1" });
    expect(classify(spec({ kind: "budget.cap.raise", amountUsd: 10, category: "ads" }))).toMatchObject({ tier: "K2", reasons: ["spends_money"] });
    expect(providerForAction("ads.resume")).toBe("meta_ads");
    expect(providerForAction("budget.cap.raise")).toBeNull();
  });

  it("budget.cap.raise requires a category; a raise over $500 is K3", () => {
    expect(ActionSpecSchema.safeParse({ kind: "budget.cap.raise", companyId: "c", agentRole: "growth", description: "d", amountUsd: 10 }).success).toBe(false);
    expect(classify(spec({ kind: "budget.cap.raise", amountUsd: 501, category: "ads" })).tier).toBe("K3");
  });
});

describe("BUD-3 cap card spec: pause, then one K2 card with a safe default of decline", () => {
  const campaign = { id: "cmp-1", companyId: "c1", name: "Acme launch test", dailyBudgetUsd: 10, totalBudgetUsd: 50, spentTotalUsd: 11 };

  it("daily cap: raise = the campaign's daily budget, payload carries the facts, card defaults and recommends decline", () => {
    const b = budget({ spentTodayUsd: 11, spentTotalUsd: 11 });
    const s = capCardSpec({ campaign, budget: b, cap: "daily", day: "2026-10-15" });
    expect(s).toMatchObject({ kind: "budget.cap.raise", companyId: "c1", agentRole: "growth", amountUsd: 10, category: "ads" });
    expect(s.payload).toEqual({ campaignId: "cmp-1", campaignName: "Acme launch test", resumeCampaignId: "cmp-1", cap: "daily", day: "2026-10-15", spentUsd: 11, capUsd: 10 });
    const decision = gate(s, ctx({ budgets: [b] }));
    expect(decision).toMatchObject({ kind: "card", tier: "K2" });
    const c = card(decision);
    expect(c.defaultOptionId).toBe("decline");
    expect(c.recommendedOptionId).toBe("decline");
    expect(c.costUsd).toBe(10);
    expect(c.question).toBe("Today's ads cap ($10) is spent on Acme launch test ($11 so far). Raise today's cap by $10 and resume?");
    expect(c.rationale).toContain("spent $11 of $10 today");
    expect(c.rationale).toContain("campaign: Acme launch test");
    expect(c.mergeKey).toBe("budget.cap.raise:ads");
  });

  it("total cap: raise = the campaign's remaining total; the extra of the day is shown in the cap", () => {
    const b = budget({ totalLimitUsd: 50, spentTotalUsd: 50, spentTodayUsd: 12, dailyExtraUsd: 5 });
    const s = capCardSpec({ campaign, budget: b, cap: "total", day: "2026-10-15" });
    expect(s.amountUsd).toBe(39);
    expect(s.payload).toMatchObject({ cap: "total", spentUsd: 50, capUsd: 50 });
    const c = card(gate(s, ctx({ budgets: [b] })));
    expect(c.question).toBe("The ads total cap ($50) is spent on Acme launch test ($50 so far). Raise the total cap by $39 and resume?");
    expect(c.rationale).toContain("spent $50 of $50 in total");
    const daily = capCardSpec({ campaign, budget: b, cap: "daily", day: "2026-10-15" });
    expect(daily.payload).toMatchObject({ spentUsd: 12, capUsd: 15 });
    const spent = capCardSpec({ campaign: { ...campaign, spentTotalUsd: 60 }, budget: b, cap: "total", day: "2026-10-15" });
    expect(spent.amountUsd).toBe(0);
  });

  it("a raise over $500 is K3 with no default", () => {
    const big = { ...campaign, dailyBudgetUsd: 600 };
    const b = budget({ dailyLimitUsd: 600, spentTodayUsd: 601 });
    const decision = gate(capCardSpec({ campaign: big, budget: b, cap: "daily", day: "2026-10-15" }), ctx({ budgets: [b] }));
    expect(decision.tier).toBe("K3");
    expect(card(decision).defaultOptionId).toBeNull();
  });
});

describe("SLS-K2 one card per outreach batch", () => {
  const recipients = ["a@example.test", "b@example.test", "c@example.test", "d@example.test", "e@example.test"];
  const mail = (to: string, batchId = "batch-1"): ActionSpec =>
    spec({ kind: "email.send.first_contact", agentRole: "sales", description: `First-contact email to ${to}`, payload: { batchId, to, subject: "Hi", text: "secret body", recipients } });

  it("BatchPayloadSchema: batchId 1-64 chars, recipients optional and bounded; ActionSpecSchema enforces it", () => {
    expect(BatchPayloadSchema.safeParse({ batchId: "b" }).success).toBe(true);
    expect(BatchPayloadSchema.safeParse({ batchId: "" }).success).toBe(false);
    expect(BatchPayloadSchema.safeParse({ batchId: "x".repeat(65) }).success).toBe(false);
    expect(BatchPayloadSchema.safeParse({ batchId: "b", recipients: [] }).success).toBe(false);
    expect(BatchPayloadSchema.safeParse({ batchId: "b", recipients: ["not an email"] }).success).toBe(false);
    expect(ActionSpecSchema.safeParse({ kind: "email.send.first_contact", companyId: "c", agentRole: "sales", description: "d", payload: { batchId: "", to: "a@example.test" } }).success).toBe(false);
    expect(ActionSpecSchema.safeParse({ kind: "research", companyId: "c", agentRole: "sales", description: "d", payload: { batchId: "" } }).success).toBe(true);
    expect(batchPayload({ to: "a@example.test" })).toBeNull();
    expect(batchPayload(undefined)).toBeNull();
    expect(batchPayload({ batchId: "b1" })).toEqual({ batchId: "b1" });
  });

  it("every send in the batch opens the same card: mergeKey batch:<id>, question counts the emails, facts list the recipients", () => {
    const cards = recipients.map((to) => card(gate(mail(to), ctx())));
    expect(new Set(cards.map((c) => c.mergeKey))).toEqual(new Set(["batch:batch-1"]));
    expect(cards[0]?.question).toBe("Send 5 first-contact emails?");
    expect(cards[0]?.rationale).toContain("5 emails: a@example.test, b@example.test, +3");
    expect(cards[0]?.rationale).not.toContain("secret body");
    expect(cards[0]?.costUsd).toBe(0);
    expect(cards[0]?.tier).toBe("K2");
    const plan = planCards(cards, { quota: 3, openedToday: 0 });
    expect(plan.open).toHaveLength(1);
    expect(plan.merged).toHaveLength(4);
  });

  it("without a batch the card keeps the kind mergeKey and the single recipient facts", () => {
    const single = card(gate(spec({ kind: "email.send.first_contact", agentRole: "sales", payload: { to: "a@example.test", subject: "Hi" } }), ctx()));
    expect(single.mergeKey).toBe("email.send.first_contact:none");
    expect(single.question).toBe("Approve: Start a test campaign?");
    expect(single.rationale).toContain("to a@example.test, subject: Hi");
    const two = card(gate(spec({ kind: "email.send.first_contact", agentRole: "sales", payload: { batchId: "b2", to: "a@example.test", recipients: ["a@example.test", "b@example.test"] } }), ctx()));
    expect(two.rationale).toContain("2 emails: a@example.test, b@example.test.");
    const noList = card(gate(spec({ kind: "email.send.first_contact", agentRole: "sales", payload: { batchId: "b3", to: "a@example.test", subject: "Hi" } }), ctx()));
    expect(noList.mergeKey).toBe("batch:b3");
    expect(noList.rationale).toContain("to a@example.test");
  });

  it("DEC-3: three approved batch cards suggest a rule without inventing a budget category from the batch id", () => {
    const answered = (i: number) => ({ actionKind: "email.send.first_contact" as const, mergeKey: "batch:b9", answeredOptionId: "approve", answeredAt: `2026-10-1${i}T00:00:00Z`, costUsd: 0 });
    const suggestion = suggestAutoRule([answered(1), answered(2), answered(3)]);
    expect(suggestion).toMatchObject({ kind: "email.send.first_contact", optionId: "approve" });
    expect(suggestion?.category).toBeUndefined();
  });
});

describe("OUT-1 metric keys, provenance and campaigns", () => {
  it("OUTCOME_METRIC_KEYS are the original nine; channel keys extend METRIC_KEYS; goals use outcomes only", () => {
    expect(OUTCOME_METRIC_KEYS).toEqual(["paying_customers", "signups", "waitlist", "demo_calls", "mrr_usd", "revenue_usd", "site_visitors", "email_replies", "artifacts"]);
    expect(CHANNEL_METRIC_KEYS).toEqual(["ad_spend_usd", "ad_impressions", "ad_clicks", "emails_sent"]);
    expect(METRIC_KEYS).toEqual([...OUTCOME_METRIC_KEYS, ...CHANNEL_METRIC_KEYS]);
    expect(GoalInputSchema.safeParse({ metricKey: "ad_clicks", targetValue: 10, dueDate: "2026-12-31" }).success).toBe(false);
    expect(GoalInputSchema.safeParse({ metricKey: "signups", targetValue: 10, dueDate: "2026-12-31" }).success).toBe(true);
  });

  it("scopes, channels and campaign statuses are the plan's lists", () => {
    expect(METRIC_SCOPES).toEqual(["company", "channel"]);
    expect(CHANNELS).toEqual(["meta_ads", "google_ads", "cold_email", "organic"]);
    expect(CAMPAIGN_STATUSES).toEqual(["active", "paused_cap", "paused_kill", "paused_user", "ended"]);
  });

  it("provenance keys: meta_ads:<campaignId> and cold_email:<batchId>; the schema refuses the wrong id", () => {
    const ads = ProvenanceSchema.parse({ channel: "meta_ads", campaignId: "sandbox:campaign:1", windowEnd: "2026-10-15T10:00:00.000Z", sandbox: true });
    expect(provenanceKey(ads)).toBe("meta_ads:sandbox:campaign:1");
    const mail = ProvenanceSchema.parse({ channel: "cold_email", batchId: "batch-1", messageIds: ["m1", "m2"], windowEnd: "2026-10-15T10:00:00.000Z" });
    expect(provenanceKey(mail)).toBe("cold_email:batch-1");
    expect(mail.sandbox).toBe(false);
    expect(provenanceKey(ProvenanceSchema.parse({ channel: "google_ads", campaignId: "g1", windowEnd: "2026-10-15T10:00:00Z" }))).toBe("google_ads:g1");
    expect(ProvenanceSchema.safeParse({ channel: "cold_email", campaignId: "x", windowEnd: "2026-10-15T10:00:00Z" }).success).toBe(false);
    expect(ProvenanceSchema.safeParse({ channel: "organic", windowEnd: "2026-10-15T10:00:00Z" }).success).toBe(false);
    expect(ProvenanceSchema.safeParse({ channel: "meta_ads", campaignId: "x", windowEnd: "yesterday" }).success).toBe(false);
  });

  it("AdDelivery is non-negative; counts are integers", () => {
    expect(AdDeliverySchema.parse({ spendUsd: 4, impressions: 800, clicks: 12, conversions: 1 })).toEqual({ spendUsd: 4, impressions: 800, clicks: 12, conversions: 1 });
    expect(AdDeliverySchema.safeParse({ spendUsd: -1, impressions: 0, clicks: 0, conversions: 0 }).success).toBe(false);
    expect(AdDeliverySchema.safeParse({ spendUsd: 1, impressions: 1.5, clicks: 0, conversions: 0 }).success).toBe(false);
  });

  it("windowDelta turns two cumulative samples into before/after and the window's spend", () => {
    expect(windowDelta(null, { value: 1, spendUsd: 4 })).toEqual({ before: 0, after: 1, costUsd: 4 });
    expect(windowDelta({ value: 1, spendUsd: 4 }, { value: 3, spendUsd: 8 })).toEqual({ before: 1, after: 3, costUsd: 4 });
    expect(windowDelta({ value: 2, spendUsd: 8 }, { value: 2, spendUsd: 5 })).toEqual({ before: 2, after: 2, costUsd: 0 });
  });

  it("lead_research belongs to sales, lead_list is an artifact, leads are bounded and validated", () => {
    expect(TASK_TYPES).toContain("lead_research");
    expect(TASK_OWNER.lead_research).toBe("sales");
    expect(ARTIFACT_KINDS).toContain("lead_list");
    expect(MAX_LEADS).toBe(50);
    const lead = { name: "Mara", email: "mara@example.test", company: "Northwind", why: "Hiring for the routine we replace" };
    expect(LeadDraftSchema.safeParse({ ...lead, email: "nope" }).success).toBe(false);
    const out = AgentOutputSchema.parse({ summary: "s", artifacts: [], memory: [], leads: [lead] });
    expect(out.leads).toHaveLength(1);
    expect(AgentOutputSchema.parse({ summary: "s", artifacts: [], memory: [] }).leads).toBeUndefined();
    expect(AgentOutputSchema.safeParse({ summary: "s", artifacts: [], memory: [], leads: Array.from({ length: 51 }, () => lead) }).success).toBe(false);
  });
});

describe("OUT-1 ledger CSV export", () => {
  const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({ taskId: "t1", metricKey: "signups", before: 0, after: 1, costUsd: 4, channel: "meta_ads", measuredAt: "2026-10-15T10:00:00.000Z", ...over });

  it("has fixed columns, CRLF lines and one row per entry", () => {
    expect(LEDGER_CSV_COLUMNS).toEqual(["measured_at", "channel", "metric_key", "before", "after", "delta", "cost_usd", "task_id"]);
    expect(ledgerCsv([])).toBe("measured_at,channel,metric_key,before,after,delta,cost_usd,task_id\r\n");
    const csv = ledgerCsv([entry(), entry({ before: 1, after: 3, costUsd: 4.5, channel: "cold_email" })]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toBe("2026-10-15T10:00:00.000Z,meta_ads,signups,0,1,1,4,t1");
    expect(lines[2]).toBe("2026-10-15T10:00:00.000Z,cold_email,signups,1,3,2,4.5,t1");
  });

  it("quotes per RFC 4180 and neutralises formulas", () => {
    const csv = ledgerCsv([entry({ taskId: 'a,b"c\nd', channel: "=cmd()|' /C calc'!A0", metricKey: "+1", measuredAt: "-2026", before: -3 })]);
    const row = csv.split("\r\n")[1];
    expect(row).toBe(`"'-2026","'=cmd()|' /C calc'!A0","'+1",-3,1,4,4,"a,b""c\nd"`);
    expect(ledgerCsv([entry({ channel: "@sum" })]).split("\r\n")[1]).toContain(`"'@sum"`);
  });
});

describe("AGT-2 evidence and ONB-3 connections for growth and sales", () => {
  it("ads.start yields a campaign id; the evidence schema accepts it", () => {
    expect(evidenceKindFor("ads.start")).toBe("campaign_id");
    expect(evidenceKindFor("ads.resume")).toBeNull();
    expect(EVIDENCE_KINDS).toContain("campaign_id");
    expect(EvidenceSchema.safeParse({ kind: "campaign_id", ref: "sandbox:campaign:1", verified: true }).success).toBe(true);
  });

  it("events: metric/collect carries a reason; OAuth codes for meta_ads and gmail; revoked covers every provider", () => {
    const companyId = "11111111-1111-4111-8111-111111111111";
    expect(EVENT.metricCollect).toBe("metric/collect");
    expect(MetricCollectSchema.safeParse({ companyId, reason: "cron" }).success).toBe(true);
    expect(MetricCollectSchema.safeParse({ companyId, reason: "manual" }).success).toBe(true);
    expect(MetricCollectSchema.safeParse({ companyId, reason: "nope" }).success).toBe(false);
    for (const provider of ["github", "vercel", "meta_ads", "gmail"]) expect(ConnectionOauthCodeSchema.safeParse({ userId: companyId, provider, code: "abc", redirectUri: "http://x/cb" }).success, provider).toBe(true);
    // M6: stripe joined the OAuth-code providers (OUT-2, the user's own Stripe read); an unknown provider is still refused.
    expect(ConnectionOauthCodeSchema.safeParse({ userId: companyId, provider: "stripe", code: "abc", redirectUri: "http://x/cb" }).success).toBe(true);
    expect(ConnectionOauthCodeSchema.safeParse({ userId: companyId, provider: "slack", code: "abc", redirectUri: "http://x/cb" }).success).toBe(false);
    for (const provider of CONNECTION_PROVIDERS) expect(ConnectionRevokedSchema.safeParse({ userId: companyId, provider }).success).toBe(true);
  });

  it("provider tokens are a plain string or an access/refresh pair with an expiry", () => {
    expect(ProviderTokenSchema.safeParse("ghp_abc").success).toBe(true);
    expect(ProviderTokenSchema.safeParse("").success).toBe(false);
    expect(ProviderTokenSchema.safeParse({ accessToken: "ya29", refreshToken: "1//r", expiresAt: "2026-10-15T11:00:00.000Z" }).success).toBe(true);
    expect(ProviderTokenSchema.safeParse({ accessToken: "ya29" }).success).toBe(true);
    expect(ProviderTokenSchema.safeParse({ accessToken: "ya29", expiresAt: "soon" }).success).toBe(false);
    expect(ProviderTokenSchema.safeParse({ refreshToken: "1//r" }).success).toBe(false);
  });
});
