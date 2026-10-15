import { describe, expect, it } from "vitest";
import { AgentOutputSchema, LeadDraftSchema, batchPayload, classify, gate, spendProfile, wouldExceedBudget, type BudgetState, type PolicyContext } from "@north/core";
import { CampaignSpecSchema } from "@north/integrations";
import { FIXTURE_CAMPAIGN_DAILY_USD, FIXTURE_CAMPAIGN_DAYS, FIXTURE_LEADS, FIXTURE_PROSPECTS, mockScripts } from "../src/fixtures/index";
import { ARTIFACT_KIND_FOR_TASK, TASK_GUIDES } from "../src/prompts/task-guides";
import { LEADS_VAR, parseLeadsVar } from "../src/runtime/types";
import { loadTestRoles, makeInput, requireRole } from "./helpers";

/** The default ads budget a new company gets (apps/web labels): $20/day, $300 total. */
const DEFAULT_ADS_BUDGET: BudgetState = { category: "ads", totalLimitUsd: 300, dailyLimitUsd: 20, dailyExtraUsd: 0, spentTotalUsd: 0, spentTodayUsd: 0 };
const ctx: PolicyContext = { killSwitchActive: false, budgets: [DEFAULT_ADS_BUDGET], autoRules: [], cardDueAt: "2026-10-16T09:00:00.000Z" };

const run = (key: string, overrides: Parameters<typeof makeInput>[0] = {}) => {
  const [role, taskType] = key.split(":") as [string, string];
  const result = mockScripts[key]!(makeInput({ role, taskType, ...overrides }));
  if (result.status !== "succeeded") throw new Error(`fixture ${key} did not succeed`);
  return result;
};

describe("SLS-K2 sales:outreach_batch — one batch, one card", () => {
  it("emits five first-contact actions that share one batchId and carry the recipient list (core BatchPayloadSchema)", () => {
    const result = run("sales:outreach_batch");
    expect(result.actions).toHaveLength(5);
    const batches = result.actions.map((a) => batchPayload(a.payload));
    expect(batches.every((b) => b !== null)).toBe(true);
    expect(new Set(batches.map((b) => b?.batchId))).toEqual(new Set([batches[0]?.batchId]));
    expect(batches[0]?.batchId).toMatch(/^batch-/);
    expect(batches[0]?.batchId.length).toBeLessThanOrEqual(64);
    for (const action of result.actions) {
      expect(action).toMatchObject({ kind: "email.send.first_contact", agentRole: "sales", companyId: "company-1" });
      expect(action.payload).toMatchObject({ to: expect.stringMatching(/@example\.test$/), subject: expect.any(String), text: expect.any(String) });
      expect(batchPayload(action.payload)?.recipients).toEqual(FIXTURE_PROSPECTS.map((p) => p.email));
    }
    expect(new Set(result.actions.map((a) => a.payload?.to)).size).toBe(5);
  });

  it("every action classifies K2 and the gate opens one mergeable card asking for 5 emails", () => {
    const result = run("sales:outreach_batch");
    const decisions = result.actions.map((a) => gate(a, ctx));
    for (const action of result.actions) expect(classify(action).tier).toBe("K2");
    expect(decisions.every((d) => d.kind === "card" && d.tier === "K2")).toBe(true);
    const cards = decisions.flatMap((d) => (d.kind === "card" ? [d.card] : []));
    expect(new Set(cards.map((c) => c.mergeKey)).size).toBe(1);
    expect(cards[0]?.question).toBe("Send 5 first-contact emails?");
    expect(cards[0]?.costUsd).toBe(0);
  });

  it("uses vars.leads (JSON) when present: one action per lead with its leadId, else the built-in five", () => {
    const leads = [
      { id: "lead-1", name: "Ada Byron", email: "ada@example.test", company: "Byron Analytics", why: "Hiring a bookkeeper" },
      { id: "lead-2", name: "Kai Moreno", email: "kai@example.test", company: "", why: "Closing the month late" },
    ];
    const result = run("sales:outreach_batch", { vars: { [LEADS_VAR]: JSON.stringify(leads) } });
    expect(result.actions).toHaveLength(2);
    expect(result.actions.map((a) => a.payload?.to)).toEqual(["ada@example.test", "kai@example.test"]);
    expect(result.actions.map((a) => a.payload?.leadId)).toEqual(["lead-1", "lead-2"]);
    expect(batchPayload(result.actions[0]?.payload)?.recipients).toEqual(["ada@example.test", "kai@example.test"]);
    expect(String(result.actions[0]?.payload?.text)).toContain("Ada");
    expect(JSON.stringify(result.output)).toContain("Byron Analytics");
    expect(AgentOutputSchema.safeParse(result.output).success).toBe(true);

    expect(run("sales:outreach_batch", { vars: { [LEADS_VAR]: "not json" } }).actions).toHaveLength(5);
    expect(run("sales:outreach_batch", { vars: { [LEADS_VAR]: "[]" } }).actions).toHaveLength(5);
    expect(run("sales:outreach_batch", { vars: { [LEADS_VAR]: JSON.stringify([{ name: "x", email: "nope" }]) } }).actions).toHaveLength(5);
  });

  it("parseLeadsVar is strict at the boundary: bad JSON, bad rows and more than 50 rows give nothing", () => {
    expect(parseLeadsVar(undefined)).toEqual([]);
    expect(parseLeadsVar({})).toEqual([]);
    expect(parseLeadsVar({ leads: "{" })).toEqual([]);
    expect(parseLeadsVar({ leads: JSON.stringify([{ name: "A", email: "a@example.test" }]) })).toEqual([{ name: "A", email: "a@example.test", company: "", why: "" }]);
    expect(parseLeadsVar({ leads: JSON.stringify(Array.from({ length: 51 }, (_, i) => ({ name: "A", email: `a${i}@example.test` }))) })).toEqual([]);
    expect(Object.isFrozen(parseLeadsVar({ leads: "[]" }))).toBe(true);
  });
});

describe("sales:lead_research (K0) — leads the worker persists, nothing contacted", () => {
  it("returns five deterministic leads with a why that validate LeadDraftSchema, a lead_list artifact and no actions", () => {
    const result = run("sales:lead_research");
    const output = AgentOutputSchema.parse(result.output);
    expect(result.actions).toEqual([]);
    expect(output.leads).toHaveLength(5);
    for (const lead of output.leads ?? []) {
      expect(LeadDraftSchema.safeParse(lead).success).toBe(true);
      expect(lead.email).toMatch(/@example\.test$/);
      expect(lead.why.length).toBeGreaterThan(10);
    }
    expect(new Set(output.leads?.map((l) => l.email)).size).toBe(5);
    expect(output.leads).toEqual(FIXTURE_LEADS.map((l) => ({ ...l })));
    expect(output.artifacts[0]?.kind).toBe("lead_list");
    expect(ARTIFACT_KIND_FOR_TASK.lead_research).toBe("lead_list");
    expect(output.artifacts[0]?.markdown).toContain("Lumen Ledger");
    expect(run("sales:lead_research").output).toEqual(result.output);
  });
});

describe("GRW-K2 / BUD-1 growth:campaign_spec — targeting, stop rule, fits the default budget", () => {
  it("requests one ads.start whose spend profile fits $20/day and $300 total, with targeting the ads contract accepts", () => {
    const result = run("growth:campaign_spec");
    expect(result.actions).toHaveLength(1);
    const [action] = result.actions;
    expect(classify(action!).tier).toBe("K2");
    const profile = spendProfile(action!);
    expect(profile).toEqual({ perDayUsd: FIXTURE_CAMPAIGN_DAILY_USD, totalUsd: FIXTURE_CAMPAIGN_DAILY_USD * FIXTURE_CAMPAIGN_DAYS });
    expect(wouldExceedBudget(DEFAULT_ADS_BUDGET, profile)).toBe(false);
    const decision = gate(action!, ctx);
    expect(decision).toMatchObject({ kind: "card", tier: "K2" });
    expect(decision.reasons).not.toContain("budget_cap");
    expect(action?.payload).toMatchObject({ targeting: { countries: ["US", "GB"], ageMin: 25, ageMax: 55 }, stopRule: expect.stringMatching(/0\.6%/) });
    const parsed = CampaignSpecSchema.safeParse({ companyId: action!.companyId, ...action!.payload });
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    const markdown = AgentOutputSchema.parse(result.output).artifacts[0]?.markdown ?? "";
    expect(markdown).toMatch(/Stop rule/);
    expect(markdown).toMatch(/Targeting/);
    expect(markdown).toMatch(/landing/i);
  });
});

describe("M4 guides and roles", () => {
  it("has a lead_research guide, batch rules for outreach and targeting + landing URL for the campaign", () => {
    expect(TASK_GUIDES.lead_research).toMatch(/leads/);
    expect(TASK_GUIDES.lead_research).toMatch(/why/);
    expect(TASK_GUIDES.lead_research).toMatch(/no .*action/i);
    expect(TASK_GUIDES.outreach_batch).toMatch(/batchId/);
    expect(TASK_GUIDES.outreach_batch).toMatch(/recipients/);
    expect(TASK_GUIDES.outreach_batch).toMatch(/leadId/);
    expect(TASK_GUIDES.campaign_spec).toMatch(/targeting/);
    expect(TASK_GUIDES.campaign_spec).toMatch(/landing/i);
    expect(TASK_GUIDES.campaign_spec).toMatch(/stop rule/i);
  });

  it("sales may write leads; growth may resume ads (K1)", async () => {
    const roles = await loadTestRoles();
    expect(requireRole(roles, "sales").tools).toContain("leads.write");
    expect(requireRole(roles, "growth").tools).toContain("ads.resume");
    expect(requireRole(roles, "sales").max_action_tier).toBe("K2");
    expect(requireRole(roles, "growth").max_action_tier).toBe("K2");
  });
});
