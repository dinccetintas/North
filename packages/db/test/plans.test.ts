import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoal } from "../src/goals";
import { createPlanWithTasks, latestPlan } from "../src/plans";
import { createCompanyFor, createOwnerWithCompany, createTestUser, deleteTestUser, grantPlan, service, type OwnedCompany, type TestUser } from "./fixtures";

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
    // 2 companies for one owner: over the Solo trial's limit (M6).
    await grantPlan(owned.owner.id, "pro");
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
    const { planId, taskIds } = await createPlanWithTasks(service, {
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
    const second = await createPlanWithTasks(service, { companyId: owned.companyId, goalId: null, weekStart: "2026-10-19", summary: "Week 2", rationale: "", tasks: [tasks[2]!] });
    const plan = await latestPlan(owned.owner.client, owned.companyId);
    expect(plan?.id).toBe(second.planId);
    expect(plan?.tasks.map((t) => t.id)).toEqual(second.taskIds);
  });

  it("PLN-2: revisions round-trip through createPlanWithTasks and latestPlan, default to [] and are validated", async () => {
    const companyId = await createCompanyFor(owned.owner, "plans-revisions");
    const bare = await createPlanWithTasks(service, { companyId, goalId: null, weekStart: "2026-10-19", summary: "Week 1", rationale: "", tasks: [tasks[0]!] });
    expect((await latestPlan(owned.owner.client, companyId))).toMatchObject({ id: bare.planId, revisions: [] });
    const revisions = [
      { taskType: "outreach_batch" as const, change: "dropped" as const, reason: "cold_email not working: 0 replies from 5 sends" },
      { taskType: "campaign_spec" as const, change: "added" as const, reason: "the site is live" },
    ];
    const revised = await createPlanWithTasks(service, { companyId, goalId: null, weekStart: "2026-10-26", summary: "Week 2", rationale: "", tasks: [tasks[2]!], revisions });
    const plan = await latestPlan(owned.owner.client, companyId);
    expect(plan?.id).toBe(revised.planId);
    expect(plan?.revisions).toEqual(revisions);
    expect(Object.isFrozen(plan?.revisions)).toBe(true);
    await expect(createPlanWithTasks(service, { companyId, goalId: null, weekStart: "2026-11-02", summary: "x", rationale: "", tasks, revisions: [{ taskType: "prd", change: "vanished" as never, reason: "r" }] })).rejects.toThrow();
    await expect(createPlanWithTasks(service, { companyId, goalId: null, weekStart: "2026-11-02", summary: "x", rationale: "", tasks, revisions: [{ taskType: "prd", change: "fewer", reason: "" }] })).rejects.toThrow();
    expect((await latestPlan(owned.owner.client, companyId))?.id).toBe(revised.planId);
  });

  it("rejects a malformed week start and an unknown task type before writing", async () => {
    await expect(createPlanWithTasks(service, { companyId: owned.companyId, goalId: null, weekStart: "next monday", summary: "x", rationale: "", tasks })).rejects.toThrow();
    await expect(createPlanWithTasks(service, { companyId: owned.companyId, goalId: null, weekStart: "2026-10-26", summary: "x", rationale: "", tasks: [{ ...tasks[0]!, taskType: "hack" as never }] })).rejects.toThrow();
  });

  it("another owner cannot plan for the company or see its plan", async () => {
    await expect(createPlanWithTasks(stranger.client, { companyId: owned.companyId, goalId: null, weekStart: "2026-11-02", summary: "x", rationale: "", tasks })).rejects.toThrow();
    expect(await latestPlan(stranger.client, owned.companyId)).toBeNull();
  });
});
