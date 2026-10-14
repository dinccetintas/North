import { CompanyEventSchema, EVENT, TaskDispatchSchema } from "@north/core";
import { getKillSwitch, getTask } from "@north/db";
import { inngest } from "./client";
import { buildDeps } from "../deps";
import { createOnboardingTasks, seedAgents } from "../services/onboard";
import { executeTask } from "../services/execute-task";
import { planWeek } from "../services/plan-week";

const cancelOnKillSwitch = [{ event: EVENT.companyKillSwitch, match: "data.companyId" }];

/** task/dispatch → run one task end to end (AGT-1/2/3). Retried by Inngest on infrastructure errors only. */
export const runTask = inngest.createFunction(
  { id: "run-task", triggers: [{ event: EVENT.taskDispatch }], cancelOn: cancelOnKillSwitch, retries: 1, concurrency: [{ key: "event.data.companyId", limit: 2 }] },
  async ({ event, step }) => {
    const { companyId, taskId } = TaskDispatchSchema.parse(event.data);
    const deps = await buildDeps();
    const result = await step.run("execute", () => executeTask(deps, taskId));
    if (result.status === "blocked") return result;
    await step.sendEvent("finished", {
      name: EVENT.taskFinished,
      data: { companyId, taskId, taskType: (await getTask(deps.db, taskId))?.taskType ?? "market_report", status: result.status },
    });
    return result;
  },
);

/** company/onboarded → research then strategy (K0), then ask the Chief of Staff for the first weekly plan. */
export const onboardCompany = inngest.createFunction(
  { id: "onboard-company", triggers: [{ event: EVENT.companyOnboarded }], cancelOn: cancelOnKillSwitch, retries: 1 },
  async ({ event, step }) => {
    const { companyId } = CompanyEventSchema.parse(event.data);
    const deps = await buildDeps();
    await step.run("seed-agents", () => seedAgents(deps, companyId));
    const tasks = await step.run("create-tasks", () => createOnboardingTasks(deps, companyId));
    const outcomes = [];
    for (const task of tasks) {
      outcomes.push(await step.invoke(`run-${task.taskType}`, { function: runTask, data: { companyId, taskId: task.id } }));
    }
    await step.sendEvent("request-plan", { name: EVENT.planRequested, data: { companyId } });
    return { companyId, tasks: outcomes.map((o) => ({ taskId: o.taskId, status: o.status })) };
  },
);

/** plan/requested → Chief of Staff writes the weekly plan and fans tasks out. */
export const planWeekFn = inngest.createFunction(
  { id: "plan-week", triggers: [{ event: EVENT.planRequested }], cancelOn: cancelOnKillSwitch, retries: 1 },
  async ({ event, step }) => {
    const { companyId } = CompanyEventSchema.parse(event.data);
    const deps = await buildDeps();
    const killed = await step.run("check-kill-switch", () => getKillSwitch(deps.db, companyId));
    if (killed) return { skipped: "kill_switch", companyId };
    const plan = await step.run("plan", () => planWeek(deps, companyId));
    await step.sendEvent("plan-created", { name: EVENT.planCreated, data: { companyId, planId: plan.planId } });
    await step.sendEvent(
      "dispatch-tasks",
      plan.taskIds.map((taskId) => ({ name: EVENT.taskDispatch, data: { companyId, taskId } })),
    );
    return plan;
  },
);

/** company/killswitch → acknowledge; running functions are cancelled via cancelOn. M2 adds campaign pauses. */
export const killSwitchAck = inngest.createFunction(
  { id: "kill-switch-ack", triggers: [{ event: EVENT.companyKillSwitch }] },
  async ({ event, step }) =>
    step.run("ack", async () => ({ companyId: CompanyEventSchema.parse(event.data).companyId, stoppedAt: new Date().toISOString() })),
);

export const ping = inngest.createFunction(
  { id: "ping", triggers: [{ event: "worker/ping" }] },
  async ({ step }) => step.run("pong", async () => ({ pong: true, at: new Date().toISOString() })),
);

export const functions = [runTask, onboardCompany, planWeekFn, killSwitchAck, ping];
