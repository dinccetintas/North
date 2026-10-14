import { describe, expect, it } from "vitest";
import { AgentOutputSchema, classify, METRIC_KEYS, PlanOutputSchema, TASK_OWNER, TASK_TYPES } from "@north/core";
import { FIXTURE_CAMPAIGN_DAILY_USD, FIXTURE_CAMPAIGN_DAYS, FIXTURE_PROSPECTS, fixtureContext, mockScripts } from "../src/fixtures/index";
import { ARTIFACT_KIND_FOR_TASK } from "../src/prompts/task-guides";
import { MockRuntime } from "../src/runtime/mock";
import { makeInput } from "./helpers";

/** K0 fixtures: artifacts and memory only, no action requests. */
const K0_KEYS = [
  "research:market_report",
  "research:personas",
  "research:competitor_map",
  "strategy_product:prd",
  "strategy_product:business_plan",
  "strategy_product:investor_deck",
  "design:brand_kit",
  "chief_of_staff:plan_week",
];

/** K2 fixtures (M2): the same shape plus external action requests the decision layer gates. */
const K2_KEYS = ["growth:campaign_spec", "sales:outreach_batch"];

const EXPECTED_KEYS = [...K0_KEYS, ...K2_KEYS];

const runKey = (key: string) => {
  const [role, taskType] = key.split(":") as [string, string];
  return mockScripts[key]!(makeInput({ role, taskType }));
};

describe("mock fixtures", () => {
  it("has a script for every expected role:taskType key and nothing unexpected", () => {
    expect(Object.keys(mockScripts).sort()).toEqual([...EXPECTED_KEYS].sort());
    for (const key of EXPECTED_KEYS) {
      const [role, taskType] = key.split(":") as [string, string];
      expect(TASK_OWNER[taskType as keyof typeof TASK_OWNER]).toBe(role);
    }
  });

  it.each(EXPECTED_KEYS.filter((k) => !k.endsWith("plan_week")))("%s validates with AgentOutputSchema and uses the right artifact kind", (key) => {
    const result = runKey(key);
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    const parsed = AgentOutputSchema.safeParse(result.output);
    expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    if (!parsed.success) return;
    const taskType = key.split(":")[1] as keyof typeof ARTIFACT_KIND_FOR_TASK;
    expect(parsed.data.artifacts.length).toBeGreaterThanOrEqual(1);
    expect(parsed.data.artifacts.length).toBeLessThanOrEqual(2);
    expect(parsed.data.artifacts[0]?.kind).toBe(ARTIFACT_KIND_FOR_TASK[taskType]);
    expect(parsed.data.artifacts[0]?.markdown.split("\n## ").length).toBeGreaterThanOrEqual(4);
    expect(parsed.data.memory.length).toBeGreaterThanOrEqual(2);
    expect(parsed.data.memory.length).toBeLessThanOrEqual(4);
    expect(result.actions).toEqual(parsed.data.actions);
    expect(result.sessionId).toBe(`mock-${taskType}`);
  });

  it.each(K0_KEYS)("%s requests no external action", (key) => {
    const result = runKey(key);
    expect(result.status === "succeeded" ? result.actions : null).toEqual([]);
  });

  it("DEC-1: growth:campaign_spec requests exactly one K2 ads.start inside the ads budget", () => {
    const result = runKey("growth:campaign_spec");
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.actions).toHaveLength(1);
    const [action] = result.actions;
    expect(action).toMatchObject({ kind: "ads.start", companyId: "company-1", agentRole: "growth", category: "ads", amountUsd: FIXTURE_CAMPAIGN_DAILY_USD * FIXTURE_CAMPAIGN_DAYS });
    expect(action?.payload).toMatchObject({ dailyBudgetUsd: FIXTURE_CAMPAIGN_DAILY_USD, audience: expect.any(String), creativeMarkdown: expect.any(String) });
    expect(classify(action!).tier).toBe("K2");
  });

  it("DEC-1: sales:outreach_batch requests one K2 first-contact email per prospect, all on the reserved .test domain", () => {
    const result = runKey("sales:outreach_batch");
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    expect(result.actions).toHaveLength(FIXTURE_PROSPECTS.length);
    for (const action of result.actions) {
      expect(action).toMatchObject({ kind: "email.send.first_contact", agentRole: "sales", companyId: "company-1" });
      expect(String(action.payload?.to)).toMatch(/@example\.test$/);
      expect(action.payload).toMatchObject({ subject: expect.any(String), text: expect.any(String) });
      expect(classify(action).tier).toBe("K2");
    }
  });

  it("plan_week validates with PlanOutputSchema and only uses known task types and metrics", () => {
    const result = runKey("chief_of_staff:plan_week");
    expect(result.status).toBe("succeeded");
    if (result.status !== "succeeded") return;
    const parsed = PlanOutputSchema.safeParse(result.output);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.tasks.length).toBeGreaterThanOrEqual(3);
    expect(parsed.data.tasks.length).toBeLessThanOrEqual(4);
    for (const task of parsed.data.tasks) {
      expect(TASK_TYPES).toContain(task.taskType);
      expect(METRIC_KEYS).toContain(task.metricKey);
      expect(task.costEstimateUsd).toBeGreaterThan(0);
    }
  });

  it("weaves the company and customer from the memory digest into every fixture", () => {
    for (const key of EXPECTED_KEYS) {
      const result = runKey(key);
      const text = JSON.stringify(result.status === "succeeded" ? result.output : result);
      expect(text, key).toContain("Lumen Ledger");
    }
  });

  it("falls back to neutral wording when the digest has no company line", () => {
    const ctx = fixtureContext(makeInput({ memoryDigest: "", instructions: "Just do it." }));
    expect(ctx.company).toBe("the company");
    expect(ctx.thesis).toBe("Just do it.");
    const result = mockScripts["research:personas"]!(makeInput({ role: "research", taskType: "personas", memoryDigest: "" }));
    expect(AgentOutputSchema.safeParse(result.status === "succeeded" ? result.output : null).success).toBe(true);
  });

  it("runs through MockRuntime with realistic token counts and zero cost", async () => {
    const runtime = MockRuntime.fromRecord(mockScripts);
    const result = await runtime.run(makeInput({ role: "strategy_product", taskType: "prd" }));
    expect(result.status).toBe("succeeded");
    expect(result.usage.costUsd).toBe(0);
    expect(result.usage.outputTokens).toBeGreaterThan(300);
  });
});
