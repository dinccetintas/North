import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoal } from "../src/goals";
import { createPlanWithTasks, latestPlan } from "../src/plans";
import { createOwnerWithCompany, createTestUser, deleteTestUser, type OwnedCompany, type TestUser } from "./fixtures";

describe("plans repository (PLN-1)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;
  const tasks = [
    { taskType: "market_report" as const, title: "Market report", input: "Size the market", metricKey: "signups" as const, expectedDelta: 10, costEstimateUsd: 1 },
    { taskType: "personas" as const, title: "Personas", input: "", metricKey: "signups" as const, expectedDelta: 5, costEstimateUsd: 1 },
    { taskType: "prd" as const, title: "PRD", input: "Write the PRD", metricKey: "paying_customers" as const, expectedDelta: 2, costEstimateUsd: 2 },
  ];

  beforeAll(async () => {
    owned = await createOwnerWithCompany("plans");
    stranger = await createTestUser("plans-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("latestPlan is null before any plan exists", async () => {
    expect(await latestPlan(owned.owner.client, owned.companyId)).toBeNull();
  });

  it("createPlanWithTasks queues one task per planned item, owned by TASK_OWNER, in plan order", async () => {
    const goal = await createGoal(owned.owner.client, owned.companyId, { metricKey: "signups", targetValue: 50, dueDate: "2026-12-31" });
    const { planId, taskIds } = await createPlanWithTasks(owned.owner.client, {
      companyId: owned.companyId,
      goalId: goal.id,
      weekStart: "2026-10-12",
      summary: "Week 1: research then PRD",
      rationale: "Research first so the PRD is grounded.",
      tasks,
    });
    expect(taskIds.length).toBe(3);
    const plan = await latestPlan(owned.owner.client, owned.companyId);
    expect(plan).toMatchObject({ id: planId, goalId: goal.id, weekStart: "2026-10-12", summary: "Week 1: research then PRD", status: "active" });
    expect(plan?.tasks.map((t) => t.id)).toEqual(taskIds);
    expect(plan?.tasks.map((t) => [t.taskType, t.role, t.status, t.planId])).toEqual([
      ["market_report", "research", "queued", planId],
      ["personas", "research", "queued", planId],
      ["prd", "strategy_product", "queued", planId],
    ]);
    expect(plan?.tasks[0]?.input).toBe("Size the market");
  });

  it("latestPlan returns the newest plan with only its own tasks", async () => {
    const second = await createPlanWithTasks(owned.owner.client, { companyId: owned.companyId, goalId: null, weekStart: "2026-10-19", summary: "Week 2", rationale: "", tasks: [tasks[2]!] });
    const plan = await latestPlan(owned.owner.client, owned.companyId);
    expect(plan?.id).toBe(second.planId);
    expect(plan?.tasks.map((t) => t.id)).toEqual(second.taskIds);
  });

  it("rejects a malformed week start and an unknown task type before writing", async () => {
    await expect(createPlanWithTasks(owned.owner.client, { companyId: owned.companyId, goalId: null, weekStart: "next monday", summary: "x", rationale: "", tasks })).rejects.toThrow();
    await expect(createPlanWithTasks(owned.owner.client, { companyId: owned.companyId, goalId: null, weekStart: "2026-10-26", summary: "x", rationale: "", tasks: [{ ...tasks[0]!, taskType: "hack" as never }] })).rejects.toThrow();
  });

  it("another owner cannot plan for the company or see its plan", async () => {
    await expect(createPlanWithTasks(stranger.client, { companyId: owned.companyId, goalId: null, weekStart: "2026-11-02", summary: "x", rationale: "", tasks })).rejects.toThrow();
    expect(await latestPlan(stranger.client, owned.companyId)).toBeNull();
  });
});
