import { describe, expect, it } from "vitest";
import { AgentOutputSchema, MEMORY_KINDS, MemoryDraftSchema, PlanOutputSchema, TASK_OWNER, TASK_TYPES, outputJsonSchema } from "../src/tasks/types";
import { ClarifyingQuestionsSchema, fallbackQuestions, GoalInputSchema, nextOnboardingStep, BudgetInputSchema } from "../src/onboarding";

describe("task types and output contracts", () => {
  it("every task type has an owner role", () => {
    for (const t of TASK_TYPES) expect(TASK_OWNER[t]).toBeTruthy();
  });

  it("agent output requires a summary and bounded artifact/memory lists", () => {
    const ok = AgentOutputSchema.parse({ summary: "done", artifacts: [{ kind: "market_report", title: "Market", markdown: "# M" }], memory: [] });
    expect(ok.actions).toEqual([]);
    expect(ok.confidence).toBe("medium");
    expect(() => AgentOutputSchema.parse({ summary: "", artifacts: [], memory: [] })).toThrow();
  });

  it("plan output needs at least one task with a metric", () => {
    expect(() => PlanOutputSchema.parse({ summary: "s", rationale: "r", tasks: [] })).toThrow();
    const plan = PlanOutputSchema.parse({ summary: "s", rationale: "r", tasks: [{ taskType: "market_report", title: "t", metricKey: "artifacts", expectedDelta: 1, costEstimateUsd: 0.5 }] });
    expect(plan.tasks[0]?.input).toBe("");
  });

  it("LRN-7 preference is a memory kind: the founder's standing preferences are stored and validated like any other memory", () => {
    expect(MEMORY_KINDS).toContain("preference");
    expect(MemoryDraftSchema.parse({ kind: "preference", title: "Tone", content: "Plain words." }).kind).toBe("preference");
    expect(() => MemoryDraftSchema.parse({ kind: "rumour", title: "Tone", content: "Plain words." })).toThrow();
    const out = AgentOutputSchema.parse({ summary: "s", artifacts: [], memory: [{ kind: "preference", title: "Tone", content: "Plain words." }] });
    expect(out.memory[0]?.kind).toBe("preference");
  });

  it("produces a JSON schema per task type", () => {
    expect(outputJsonSchema("plan_week")).toHaveProperty("properties.tasks");
    expect(outputJsonSchema("prd")).toHaveProperty("properties.artifacts");
  });
});

describe("ONB-1/ONB-2 onboarding contracts", () => {
  it("fallback questions are at most five and valid", () => {
    const q = ClarifyingQuestionsSchema.parse(fallbackQuestions("A queue app for clinics"));
    expect(q.questions.length).toBeLessThanOrEqual(5);
  });

  it("validates goals and budgets", () => {
    expect(GoalInputSchema.safeParse({ metricKey: "paying_customers", targetValue: 10, dueDate: "2026-12-31" }).success).toBe(true);
    expect(GoalInputSchema.safeParse({ metricKey: "nope", targetValue: 10, dueDate: "2026-12-31" }).success).toBe(false);
    expect(BudgetInputSchema.safeParse([{ category: "ads", totalLimitUsd: 300, dailyLimitUsd: 20 }]).success).toBe(true);
    expect(BudgetInputSchema.safeParse([]).success).toBe(false);
  });

  it("steps advance and stop at done", () => {
    expect(nextOnboardingStep("thesis")).toBe("questions");
    expect(nextOnboardingStep("summary")).toBe("done");
    expect(nextOnboardingStep("done")).toBe("done");
  });
});
