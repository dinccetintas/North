import { cron } from "inngest";
import { CompanyEventSchema, DecisionAnsweredSchema, DecisionOpenedSchema, EVENT, TaskDispatchSchema } from "@north/core";
import { getKillSwitch, getTask } from "@north/db";
import { inngest } from "./client";
import { buildDeps } from "../deps";
import { createOnboardingTasks, seedAgents } from "../services/onboard";
import { executeTask } from "../services/execute-task";
import { finishTask, gateAction, settleCard } from "../services/actions";
import { planWeek } from "../services/plan-week";
import { notifyDecision } from "../services/notify";
import { deferredTaskIds, pauseEverything, queuedTaskIds } from "../services/kill-switch";

const cancelOnKillSwitch = [{ event: EVENT.companyKillSwitch, match: "data.companyId" }];

/** Minutes until an ISO timestamp, at least one; Inngest timeouts are duration strings. */
function timeoutUntil(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  return `${Math.max(1, Math.ceil(ms / 60_000))}m`;
}

/**
 * task/dispatch → run the agent, then gate every requested action: K0 runs, K1
 * notifies, K2/K3 open a card and wait for `decision/answered` (or the safe
 * default at the deadline), then the task finishes with evidence (AGT-1/2, DEC-1/2).
 */
export const runTask = inngest.createFunction(
  { id: "run-task", triggers: [{ event: EVENT.taskDispatch }], cancelOn: cancelOnKillSwitch, retries: 1, concurrency: [{ key: "event.data.companyId", limit: 2 }] },
  async ({ event, step }) => {
    const { companyId, taskId } = TaskDispatchSchema.parse(event.data);
    const deps = await buildDeps();
    const run = await step.run("execute", () => executeTask(deps, taskId));
    if (run.status !== "ran") return run;

    const executedRefs: string[] = [];
    let unsettled = 0;
    for (const [i, action] of run.pendingActions.entries()) {
      const gated = await step.run(`gate-${i}`, () => gateAction(deps, taskId, action));
      if (gated.kind === "executed" && gated.externalRef) executedRefs.push(gated.externalRef);
      if (gated.kind === "deferred") unsettled += 1;
      if (gated.kind !== "card") continue;

      await step.sendEvent(`opened-${i}`, { name: EVENT.decisionOpened, data: { companyId, cardId: gated.cardId, taskId } });
      const answer = await step.waitForEvent(`decision-${i}`, {
        event: EVENT.decisionAnswered,
        if: `async.data.cardId == "${gated.cardId}"`,
        timeout: timeoutUntil(gated.dueAt),
      });
      const optionId = answer ? DecisionAnsweredSchema.parse(answer.data).optionId : null;
      const settled = await step.run(`settle-${i}`, () => settleCard(deps, { taskId, actionId: gated.actionId, cardId: gated.cardId, optionId }));
      if (!settled.settled) unsettled += 1;
      else if (settled.externalRef) executedRefs.push(settled.externalRef);
    }

    const finished = await step.run("finish", () =>
      finishTask(deps, { taskId, artifactIds: run.artifactIds, costUsd: run.costUsd, summary: run.summary, executedRefs, unsettled }),
    );
    if (finished.status !== "waiting_decision") {
      await step.sendEvent("finished", {
        name: EVENT.taskFinished,
        data: { companyId, taskId, taskType: (await getTask(deps.db, taskId))?.taskType ?? "market_report", status: finished.status },
      });
    }
    return { ...run, finished: finished.status, executedRefs };
  },
);

/** decision/opened → push + email to the owner (DEC-2). */
export const notifyDecisionFn = inngest.createFunction(
  { id: "notify-decision", triggers: [{ event: EVENT.decisionOpened }], retries: 2 },
  async ({ event, step }) => {
    const { companyId, cardId } = DecisionOpenedSchema.parse(event.data);
    const deps = await buildDeps();
    return step.run("notify", () => notifyDecision(deps, companyId, cardId, process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100"));
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

/** company/killswitch → in-flight runs are cancelled (cancelOn); campaigns are paused through the adapter. */
export const killSwitch = inngest.createFunction(
  { id: "kill-switch", triggers: [{ event: EVENT.companyKillSwitch }], retries: 2 },
  async ({ event, step }) => {
    const { companyId } = CompanyEventSchema.parse(event.data);
    const deps = await buildDeps();
    const paused = await step.run("pause-campaigns", () => pauseEverything(deps, companyId));
    return { companyId, stoppedAt: new Date().toISOString(), ...paused };
  },
);

/** company/resume → queued tasks are dispatched again. */
export const resumeCompany = inngest.createFunction(
  { id: "resume-company", triggers: [{ event: EVENT.companyResume }], retries: 1 },
  async ({ event, step }) => {
    const { companyId } = CompanyEventSchema.parse(event.data);
    const deps = await buildDeps();
    const taskIds = await step.run("queued", () => queuedTaskIds(deps, companyId));
    if (taskIds.length > 0) {
      await step.sendEvent("redispatch", taskIds.map((taskId) => ({ name: EVENT.taskDispatch, data: { companyId, taskId } })));
    }
    return { companyId, redispatched: taskIds.length };
  },
);

/** Hourly: tasks whose decisions were deferred by the quota get another chance (next day's quota). */
export const retryDeferred = inngest.createFunction(
  { id: "retry-deferred", triggers: [cron("5 * * * *")], retries: 0 },
  async ({ step }) => {
    const deps = await buildDeps();
    const deferred = await step.run("deferred", () => deferredTaskIds(deps));
    if (deferred.length > 0) {
      await step.sendEvent("redispatch", deferred.map((d) => ({ name: EVENT.taskDispatch, data: { companyId: d.companyId, taskId: d.taskId } })));
    }
    return { redispatched: deferred.length };
  },
);

export const ping = inngest.createFunction(
  { id: "ping", triggers: [{ event: "worker/ping" }] },
  async ({ step }) => step.run("pong", async () => ({ pong: true, at: new Date().toISOString() })),
);

export const functions = [runTask, notifyDecisionFn, onboardCompany, planWeekFn, killSwitch, resumeCompany, retryDeferred, ping];
