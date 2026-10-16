import { beforeEach, describe, expect, it, vi } from "vitest";
import { TASK_OWNER, missingRevisionReasons, weekStartLocal, type PlanOutput, type PlanRevision } from "@north/core";
import { MockRuntime, mockScripts, type AgentRunInput, type AgentRuntime } from "@north/agents";
import type { SandboxEvent } from "@north/integrations";
import { SimClock } from "../src/services/clock";
import { emptyState, fakeDbModule, fakeDeps, seedCompany, type FakeState } from "./fake-db";

/**
 * D5-5 (PLN-2): a fixture output missing the reason for a shrunk type is
 * retried once with the type named, then fails the planning task; with a
 * `not_working` cold_email channel the stored plan has `outreach_batch` at 0
 * and a revision reason; the first plan is four tasks for an empty company;
 * the cron fires only on the owner's Monday 06:00 and only when the latest
 * plan is older than the week.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { planContext, planWeek } = await import("../src/services/plan-week");
const { planTick } = await import("../src/services/plan-tick");
const { ONBOARDING_TASKS } = await import("../src/services/onboard");

/** Monday 2026-10-19 09:00 Istanbul. */
const WEEK1 = "2026-10-19T06:00:00.000Z";
/** Monday 2026-10-26 06:00 Istanbul (03:00Z). */
const WEEK2_PLAN_HOUR = "2026-10-26T03:00:00.000Z";
let events: SandboxEvent[];
let clock: SimClock;
const fixtureRuntime = () => MockRuntime.fromRecord({ ...mockScripts });
const deps = (runtime: AgentRuntime = fixtureRuntime()) => ({ ...fakeDeps(state, events, 200, "sandbox", "/tmp/north-test-sandbox", clock), runtime });
const planTasks = (planId: string) => [...state.tasks.values()].filter((t) => t.planId === planId);

beforeEach(() => {
  Object.assign(state, emptyState());
  events = [];
  clock = new SimClock(WEEK1);
  seedCompany(state, { id: "company-1", slug: "lumen", name: "Lumen", timezone: "Europe/Istanbul" });
});

describe("weekStartLocal and ONBOARDING_TASKS", () => {
  it("the plan week is the owner's local Monday", () => {
    expect(weekStartLocal("Europe/Istanbul", new Date("2026-10-25T22:30:00Z"))).toBe("2026-10-26"); // already Monday in Istanbul
    expect(weekStartLocal("UTC", new Date("2026-10-25T22:30:00Z"))).toBe("2026-10-19");
  });

  it("runs research before strategy and only K0 roles", () => {
    const roles = ONBOARDING_TASKS.map((t) => TASK_OWNER[t.taskType]);
    expect(roles.slice(0, 3).every((r) => r === "research")).toBe(true);
    expect(roles.slice(3).every((r) => r === "strategy_product")).toBe(true);
    expect(ONBOARDING_TASKS).toHaveLength(6);
  });
});

describe("planWeek (PLN-1, PLN-2)", () => {
  it("the first plan is four K0 tasks for an empty company, six with a live site and leads; the week is local", async () => {
    const first = await planWeek(deps(), "company-1");
    if (first.kind !== "created") throw new Error(first.kind);
    expect(planTasks(first.planId).map((t) => t.taskType)).toEqual(["competitor_map", "prd", "brand_kit", "business_plan"]);
    expect(state.plans[0]).toMatchObject({ weekStart: "2026-10-19", revisions: [] });
    const planning = [...state.tasks.values()].find((t) => t.taskType === "plan_week");
    expect(planning).toMatchObject({ status: "done", evidence: expect.objectContaining({ kind: "artifact_id", ref: `plan:${first.planId}` }) });

    Object.assign(state, emptyState());
    seedCompany(state, { id: "company-1", slug: "lumen", name: "Lumen", timezone: "Europe/Istanbul" });
    state.site = { live: "http://127.0.0.1:3101/sandbox/sites/live-lumen-site/", preview: null };
    await dbModule.importLeads(null, "company-1", [{ name: "A", email: "a@example.test" }], "upload");
    const context = await planContext(deps(), "company-1");
    expect(context.vars).toMatchObject({ "site.url": "http://127.0.0.1:3101/sandbox/sites/live-lumen-site/", "leads.count": "1", "ledger.report": "[]" });
    expect(context.vars["plan.previous"]).toBeUndefined();
    const second = await planWeek(deps(), "company-1");
    if (second.kind !== "created") throw new Error(second.kind);
    expect(planTasks(second.planId).map((t) => t.taskType)).toEqual(["competitor_map", "prd", "brand_kit", "business_plan", "campaign_spec", "outreach_batch"]);
  });

  it("the Monday rewrite drops outreach_batch to 0 with the ledger's numbers when cold_email is not working, keeps campaign_spec, and explains every delivered type", async () => {
    const first = await planWeek(deps(), "company-1");
    if (first.kind !== "created") throw new Error(first.kind);
    state.site = { live: "http://127.0.0.1:3101/sandbox/sites/live-lumen-site/", preview: null };
    await dbModule.importLeads(null, "company-1", [{ name: "A", email: "a@example.test" }], "upload");
    for (const task of planTasks(first.planId)) Object.assign(task, { status: "done" });
    const campaign = dbModule.createTask(null, { companyId: "company-1", planId: first.planId, role: "growth", taskType: "campaign_spec", title: "Launch test", metricKey: "signups" });
    const batch = dbModule.createTask(null, { companyId: "company-1", planId: first.planId, role: "sales", taskType: "outreach_batch", title: "Outreach batch 1", metricKey: "email_replies" });
    for (const t of [await campaign, await batch]) Object.assign(state.tasks.get(t.id)!, { status: "done" });
    // The ledger: one meta_ads window (+1 sign-up, $4); the five sends drew no reply, which the ledger does not record.
    state.ledger.push({ id: "l-1", companyId: "company-1", taskId: null, metricKey: "signups", before: 0, after: 1, costUsd: 4, channel: "meta_ads", note: "window", createdAt: new Date().toISOString() });
    for (let i = 0; i < 5; i += 1) state.actions.push({ id: `send-${i}`, companyId: "company-1", taskId: null, agentRole: "sales", kind: "email.send.first_contact", tier: "K2", description: "Hi", status: "executed", externalRef: `sandbox:msg:${i}`, decisionCardId: "card-b", autoRuleId: null, sandbox: true, payload: {}, supersedes: null, createdAt: new Date().toISOString() });
    state.metrics.push({ companyId: "company-1", metricKey: "email_replies", value: 0, source: "worker" });

    clock.set(WEEK2_PLAN_HOUR);
    const context = await planContext(deps(), "company-1");
    const previous = JSON.parse(context.vars["plan.previous"] ?? "{}") as { weekStart: string; tasks: { taskType: string; status: string }[] };
    expect(previous.weekStart).toBe("2026-10-19");
    expect(previous.tasks.map((t) => t.taskType)).toEqual(["competitor_map", "prd", "brand_kit", "business_plan", "campaign_spec", "outreach_batch"]);
    const report = JSON.parse(context.vars["ledger.report"] ?? "[]") as { channel: string; metricKey: string; totalDelta: number; verdict: string }[];
    expect(report).toEqual(expect.arrayContaining([expect.objectContaining({ channel: "cold_email", metricKey: "emails_sent", totalDelta: 5, verdict: "not_working" }), expect.objectContaining({ channel: "cold_email", metricKey: "email_replies", totalDelta: 0, verdict: "not_working" })]));
    expect(context.weekStart).toBe("2026-10-26");

    const second = await planWeek(deps(), "company-1");
    if (second.kind !== "created") throw new Error(second.kind);
    const plan2 = state.plans[1]!;
    const types = planTasks(second.planId).map((t) => t.taskType);
    expect(plan2.weekStart).toBe("2026-10-26");
    expect(types).toContain("campaign_spec");
    expect(types).not.toContain("outreach_batch");
    const revisions = plan2.revisions as PlanRevision[];
    const outreach = revisions.find((r) => r.taskType === "outreach_batch");
    expect(outreach?.change).toBe("dropped");
    expect(outreach?.reason).toContain("0 replies");
    expect(outreach?.reason).toContain("5");
    for (const type of ["competitor_map", "prd", "brand_kit", "business_plan"]) expect(revisions.find((r) => r.taskType === type)).toMatchObject({ change: "dropped", reason: "delivered; in memory" });
    expect(missingRevisionReasons({ tasks: planTasks(second.planId), revisions }, previous.tasks)).toEqual([]);
  });

  it("a plan that shrinks a type without a reason is retried once with the type named, then the planning task fails and nothing is stored", async () => {
    const first = await planWeek(deps(), "company-1");
    if (first.kind !== "created") throw new Error(first.kind);
    clock.set(WEEK2_PLAN_HOUR);
    const seen: string[] = [];
    const forgetful = {
      name: "mock" as const,
      run: async (input: AgentRunInput) => {
        seen.push(input.instructions);
        const output: PlanOutput = { summary: "Only the PRD this week.", rationale: "r", tasks: [{ taskType: "prd", title: "PRD v1", input: "", metricKey: "artifacts", expectedDelta: 1, costEstimateUsd: 0 }], revisions: [] };
        return { status: "succeeded" as const, output, actions: [], sessionId: "mock-plan", usage: { model: "mock", inputTokens: 1, outputTokens: 1, costUsd: 0, durationMs: 1 } };
      },
    };
    const result = await planWeek(deps(forgetful), "company-1");
    expect(result).toMatchObject({ kind: "rejected", missing: ["competitor_map", "brand_kit", "business_plan"] });
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toContain("Retry:");
    expect(seen[1]).toMatch(/^Retry: .*Missing reasons for: competitor_map, brand_kit, business_plan\./s);
    if (result.kind !== "rejected") throw new Error(result.kind);
    expect(state.tasks.get(result.taskId)).toMatchObject({ taskType: "plan_week", status: "failed", lastError: expect.stringContaining("PLN-2") });
    expect(state.plans).toHaveLength(1);
  });
});

describe("planTick (plan-week-cron)", () => {
  it("fires only at the owner's Monday 06:00 and only when the latest plan is older than the week; a stopped company is skipped", async () => {
    clock.set(WEEK2_PLAN_HOUR);
    expect(await planTick(deps())).toEqual([{ companyId: "company-1", weekStart: "2026-10-26" }]);
    clock.set("2026-10-26T04:00:00.000Z"); // 07:00 Istanbul
    expect(await planTick(deps())).toEqual([]);
    clock.set("2026-10-27T03:00:00.000Z"); // Tuesday 06:00
    expect(await planTick(deps())).toEqual([]);
    clock.set(WEEK1);
    const first = await planWeek(deps(), "company-1");
    if (first.kind !== "created") throw new Error(first.kind);
    clock.set("2026-10-19T03:00:00.000Z"); // Monday 06:00 of the plan's own week
    expect(await planTick(deps())).toEqual([]);
    clock.set(WEEK2_PLAN_HOUR);
    expect(await planTick(deps())).toEqual([{ companyId: "company-1", weekStart: "2026-10-26" }]);
    state.killSwitch.set("company-1", true);
    expect(await planTick(deps())).toEqual([]);
  });
});

describe("M6 review L9: the planning run's credit is reserved before anything is planned", () => {
  /** The fixture runtime, noting the owner's consumes as the run starts. */
  const watching = (owner: string, seen: string[][]): AgentRuntime => {
    const inner = fixtureRuntime();
    return {
      name: inner.name,
      run: async (input: AgentRunInput) => {
        seen.push((state.credits.get(owner) ?? []).filter((e) => e.kind === "consume").map((e) => e.ref));
        await new Promise((resolve) => setTimeout(resolve, 5));
        return inner.run(input);
      },
    };
  };

  it("the run's consume exists before the run starts and is the recorded run's; two concurrent plans at a balance of 1 start one planning run", async () => {
    const owner = state.companies.get("company-1")!.ownerId;
    state.credits.set(owner, [{ kind: "grant_plan", amount: 5, ref: `trial:${owner}`, note: "" }]);
    const seen: string[][] = [];
    expect((await planWeek(deps(watching(owner, seen)), "company-1")).kind).toBe("created");
    const consumes = (state.credits.get(owner) ?? []).filter((e) => e.kind === "consume").map((e) => e.ref);
    const recorded = await (dbModule.recordAgentRun as unknown as { mock: { results: { value: Promise<string> }[] } }).mock.results.at(-1)!.value;
    expect(seen).toEqual([[`run:${recorded}`]]);
    expect(consumes).toEqual([`run:${recorded}`]);

    Object.assign(state, emptyState());
    seedCompany(state, { id: "company-1", slug: "lumen", name: "Lumen", timezone: "Europe/Istanbul" });
    state.credits.set(owner, [{ kind: "grant_plan", amount: 1, ref: `trial:${owner}`, note: "" }]);
    const again: string[][] = [];
    const results = await Promise.all([planWeek(deps(watching(owner, again)), "company-1"), planWeek(deps(watching(owner, again)), "company-1")]);
    expect(again).toHaveLength(1);
    expect(results.map((r) => r.kind).sort()).toEqual(["created", "skipped"]);
    expect(results.find((r) => r.kind === "skipped")).toEqual({ kind: "skipped", skipped: "credits_exhausted" });
  });
});
