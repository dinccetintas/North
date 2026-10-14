import { cron } from "inngest";
import { CompanyEventSchema, DecisionAnsweredSchema, DecisionOpenedSchema, EVENT, TaskDispatchSchema } from "@north/core";
import { getKillSwitch, getTask, markTaskFailed } from "@north/db";
import { inngest } from "./client";
import { buildDeps } from "../deps";
import { createOnboardingTasks, seedAgents } from "../services/onboard";
import { executeTask } from "../services/execute-task";
import { completeAction, gateAction, performPending } from "../services/actions";
import { planWeek } from "../services/plan-week";
import { notifyByEmail, notifyByPush } from "../services/notify";
import { deferredTaskIds, pauseEverything, queuedTaskIds, unsettledAnsweredCards } from "../services/kill-switch";
import { applyOverdueDefaults, finishTaskIfIdle, settleDecision } from "../services/settle";
import { runBuildPipeline, type PipelineOutcome, type StepRunner } from "../services/build-pipeline";
import { attemptDecision, escalateTask } from "../services/escalate";

const cancelOnKillSwitch = [{ event: EVENT.companyKillSwitch, match: "data.companyId" }];
const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100";

/** Marks a running task failed with the pipeline's reason; a task already parked or finished is left alone. */
async function failTask(deps: Awaited<ReturnType<typeof buildDeps>>, taskId: string, reason: string): Promise<{ readonly failed: boolean }> {
  const task = await getTask(deps.db, taskId);
  if (!task || task.status !== "running") return { failed: false };
  await markTaskFailed(deps.db, taskId, reason);
  return { failed: true };
}

/**
 * task/dispatch → run the agent, then gate every requested action: K0 runs,
 * K1 runs and is reported, K2/K3 open a card and park the task. Performing an
 * action and recording its outcome are separate steps so a retry never repeats
 * an external call. Cards are settled by `settle-decision`, not here, so a
 * cancelled or restarted run can never strand an answer (DEC-1/2, AGT-1/2).
 */
export const runTask = inngest.createFunction(
  { id: "run-task", triggers: [{ event: EVENT.taskDispatch }], cancelOn: cancelOnKillSwitch, retries: 1, concurrency: [{ key: "event.data.companyId", limit: 2 }] },
  async ({ event, step }) => {
    const { companyId, taskId } = TaskDispatchSchema.parse(event.data);
    const deps = await buildDeps();
    const run = await step.run("execute", () => executeTask(deps, taskId));
    if (run.status === "blocked") return run;
    if (run.status === "failed") {
      // AGT-3: one more attempt with a different approach, then escalate.
      const decision = await step.run("attempt", () => attemptDecision(deps, taskId));
      if (decision.next === "retry") {
        await step.sendEvent("retry", { name: EVENT.taskDispatch, data: { companyId, taskId } });
        return { ...run, retry: decision.attempt };
      }
      if (decision.next === "escalate") {
        await step.run("escalate", () => escalateTask(deps, taskId, decision.reason));
        const taskType = (await getTask(deps.db, taskId))?.taskType ?? "market_report";
        await step.sendEvent("escalated", [
          { name: EVENT.taskEscalated, data: { companyId, taskId, taskType, reason: decision.reason } },
          { name: EVENT.taskFinished, data: { companyId, taskId, taskType, status: "failed" } },
        ]);
      }
      return run;
    }

    const opened: string[] = [];
    for (const [i, action] of run.pendingActions.entries()) {
      const gated = await step.run(`gate-${i}`, () => gateAction(deps, taskId, action));
      if (gated.kind === "card") opened.push(gated.cardId);
      if (gated.kind !== "execute") continue;
      const outcome = await step.run(`perform-${i}`, () => performPending(deps, gated.actionId));
      await step.run(`record-${i}`, () => completeAction(deps, { actionId: gated.actionId, tier: gated.tier, outcome }));
    }

    // Engineering: the platform pushes, previews and asks to go live on the agent's behalf (M3).
    let pipeline: PipelineOutcome | null = null;
    if (run.files.length > 0) {
      // Inngest types step results as Jsonify<T>; the pipeline's results are plain JSON, so the narrowing is sound.
      const runner: StepRunner = { run: (id, fn) => step.run(id, fn) as unknown as ReturnType<typeof fn> };
      pipeline = await runBuildPipeline(deps, runner, taskId, run.files);
      if (pipeline.cardId) opened.push(pipeline.cardId);
      if (pipeline.status === "failed") await step.run("pipeline-failed", () => failTask(deps, taskId, pipeline?.error ?? "build pipeline failed"));
    }
    if (opened.length > 0) {
      await step.sendEvent("opened", opened.map((cardId) => ({ name: EVENT.decisionOpened, data: { companyId, cardId, taskId } })));
    }

    const finished = await step.run("finish", () => finishTaskIfIdle(deps, taskId));
    if (finished.status === "failed") {
      const decision = await step.run("attempt-after-pipeline", () => attemptDecision(deps, taskId));
      if (decision.next === "retry") {
        await step.sendEvent("retry", { name: EVENT.taskDispatch, data: { companyId, taskId } });
        return { ...run, pipeline, retry: decision.attempt };
      }
      if (decision.next === "escalate") await step.run("escalate", () => escalateTask(deps, taskId, decision.reason));
    }
    if (finished.status === "done" || finished.status === "failed") {
      await step.sendEvent("finished", { name: EVENT.taskFinished, data: { companyId, taskId, taskType: (await getTask(deps.db, taskId))?.taskType ?? "market_report", status: finished.status } });
    }
    return { ...run, files: run.files.length, pipeline, finished: finished.status, cardsOpened: opened.length };
  },
);

/**
 * decision/answered → settle the card's pending action from the answer stored
 * on the card (never from the event), perform it when approved, then finish
 * the task if nothing else is pending. One run per card at a time.
 */
export const settleDecisionFn = inngest.createFunction(
  { id: "settle-decision", triggers: [{ event: EVENT.decisionAnswered }], retries: 2, concurrency: [{ key: "event.data.cardId", limit: 1 }] },
  async ({ event, step }) => {
    const { companyId, cardId } = DecisionAnsweredSchema.parse(event.data);
    const deps = await buildDeps();
    const settlement = await step.run("decide", () => settleDecision(deps, cardId));
    if (settlement.kind === "perform") {
      const outcome = await step.run("perform", () => performPending(deps, settlement.actionId));
      await step.run("record", () => completeAction(deps, { actionId: settlement.actionId, tier: settlement.tier, outcome }));
    }
    if (settlement.kind !== "perform" && settlement.kind !== "declined") return { cardId, settlement: settlement.kind };
    if (!settlement.taskId) return { cardId, settlement: settlement.kind };
    const taskId = settlement.taskId;
    const finished = await step.run("finish", () => finishTaskIfIdle(deps, taskId));
    if (finished.status === "done" || finished.status === "failed") {
      await step.sendEvent("finished", { name: EVENT.taskFinished, data: { companyId, taskId, taskType: (await getTask(deps.db, taskId))?.taskType ?? "market_report", status: finished.status } });
    }
    return { cardId, settlement: settlement.kind, finished: finished.status };
  },
);

/** Every 15 minutes: K2 cards past their deadline get the safe default and are settled like any answer (DEC-2). */
export const decisionDeadlines = inngest.createFunction(
  { id: "decision-deadlines", triggers: [cron("*/15 * * * *")], retries: 0 },
  async ({ step }) => {
    const deps = await buildDeps();
    const defaulted = await step.run("apply-defaults", () => applyOverdueDefaults(deps));
    if (defaulted.length > 0) {
      await step.sendEvent("answered", defaulted.map((d) => ({ name: EVENT.decisionAnswered, data: { companyId: d.companyId, cardId: d.cardId, optionId: d.optionId, answeredBy: "default" } })));
    }
    return { defaulted: defaulted.length };
  },
);

/** decision/opened → push and email to the owner, each its own step (DEC-2). */
export const notifyDecisionFn = inngest.createFunction(
  { id: "notify-decision", triggers: [{ event: EVENT.decisionOpened }], retries: 2 },
  async ({ event, step }) => {
    const { companyId, cardId } = DecisionOpenedSchema.parse(event.data);
    const deps = await buildDeps();
    const push = await step.run("push", () => notifyByPush(deps, companyId, cardId, APP_URL()));
    const email = await step.run("email", () => notifyByEmail(deps, companyId, cardId, APP_URL()));
    return { push, email };
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

/** company/resume → queued tasks are dispatched again and answered-but-unsettled cards are settled. */
export const resumeCompany = inngest.createFunction(
  { id: "resume-company", triggers: [{ event: EVENT.companyResume }], retries: 1 },
  async ({ event, step }) => {
    const { companyId } = CompanyEventSchema.parse(event.data);
    const deps = await buildDeps();
    const taskIds = await step.run("queued", () => queuedTaskIds(deps, companyId));
    if (taskIds.length > 0) {
      await step.sendEvent("redispatch", taskIds.map((taskId) => ({ name: EVENT.taskDispatch, data: { companyId, taskId } })));
    }
    const cards = await step.run("unsettled", () => unsettledAnsweredCards(deps, companyId));
    if (cards.length > 0) {
      await step.sendEvent("resettle", cards.map((c) => ({ name: EVENT.decisionAnswered, data: { companyId, cardId: c.cardId, optionId: c.optionId, answeredBy: c.answeredBy } })));
    }
    return { companyId, redispatched: taskIds.length, resettled: cards.length };
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

export const functions = [runTask, settleDecisionFn, decisionDeadlines, notifyDecisionFn, onboardCompany, planWeekFn, killSwitch, resumeCompany, retryDeferred, ping];
