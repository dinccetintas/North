import { describe, expect, it } from "vitest";
import { AgentOutputSchema, METRIC_KEYS, PlanOutputSchema, TASK_OWNER, TASK_TYPES } from "@north/core";
import { fixtureContext, mockScripts } from "../src/fixtures/index";
import { ARTIFACT_KIND_FOR_TASK } from "../src/prompts/task-guides";
import { MockRuntime } from "../src/runtime/mock";
import { makeInput } from "./helpers";

const EXPECTED_KEYS = [
  "research:market_report",
  "research:personas",
  "research:competitor_map",
  "strategy_product:prd",
  "strategy_product:business_plan",
  "strategy_product:investor_deck",
  "design:brand_kit",
  "chief_of_staff:plan_week",
];

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
    expect(result.actions).toEqual([]);
    expect(result.sessionId).toBe(`mock-${taskType}`);
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
