import { cron } from "inngest";
import { BriefGenerateSchema, EVENT, SignalDetectedSchema, SignalScanSchema } from "@north/core";
import { listActiveCompanies } from "@north/db";
import { inngest } from "./client";
import { buildDeps } from "../deps";
import { briefTick, generateBrief } from "../services/brief";
import { openFixTask } from "../services/incidents";
import { planTick } from "../services/plan-tick";
import { scanCompanySignals } from "../services/signal-scan";
import type { StepRunner } from "../services/steps";

const cancelOnKillSwitch = [{ event: EVENT.companyKillSwitch, match: "data.companyId" }];
const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3100";

/** The harness runs the Monday tick now instead of waiting for it; the cron shares this body (docs/plans/M5.md "Scope decisions"). */
export const PLAN_TICK_EVENT = "plan/tick";

/**
 * BRF-1, hourly (and on `brief/tick`): every company whose owner-local hour
 * is the owner's brief hour (`users.brief_hour`, 07:00 by default) and whose
 * brief for the day does not exist gets `brief/generate`. A stopped company
 * is included, by the user or by billing: its brief says so.
 */
export const dailyBrief = inngest.createFunction(
  { id: "daily-brief", triggers: [cron("3 * * * *"), { event: EVENT.briefTick }], retries: 0 },
  async ({ step }) => {
    const deps = await buildDeps();
    const due = await step.run("tick", () => briefTick(deps));
    if (due.length > 0) await step.sendEvent("generate", due.map((d) => ({ name: EVENT.briefGenerate, data: { companyId: d.companyId, day: d.day } })));
    return { due: due.length, companies: due.map((d) => d.companyId) };
  },
);

/** brief/generate → gather → compose → store → push → email; one run per company at a time, never cancelled by the kill switch. */
export const generateBriefFn = inngest.createFunction(
  { id: "generate-brief", triggers: [{ event: EVENT.briefGenerate }], retries: 2, concurrency: [{ key: "event.data.companyId", limit: 1 }] },
  async ({ event, step }) => {
    const { companyId, day } = BriefGenerateSchema.parse(event.data);
    const deps = await buildDeps();
    // Inngest types step results as Jsonify<T>; the brief's results are plain JSON, so the narrowing is sound.
    const runner: StepRunner = { run: (id, fn) => step.run(id, fn) as unknown as ReturnType<typeof fn> };
    const result = await generateBrief(deps, runner, companyId, day, APP_URL());
    return { companyId, day, ...result };
  },
);

/** PRO-1, every six hours: `signal/scan { reason: "cron" }` for every active, onboarded, not-stopped company. */
export const scanSignals = inngest.createFunction(
  { id: "scan-signals", triggers: [cron("17 */6 * * *")], retries: 0 },
  async ({ step }) => {
    const deps = await buildDeps();
    const companyIds = await step.run("companies", async () => (await listActiveCompanies(deps.db)).filter((c) => !c.killSwitchActive).map((c) => c.companyId));
    if (companyIds.length > 0) await step.sendEvent("fan-out", companyIds.map((companyId) => ({ name: EVENT.signalScan, data: { companyId, reason: "cron" } })));
    return { companies: companyIds.length };
  },
);

/** signal/scan → one company's scan (context, sources, drops, scoring, at most one card), one at a time per company, cancelled by the kill switch. */
export const scanCompanySignalsFn = inngest.createFunction(
  { id: "scan-company-signals", triggers: [{ event: EVENT.signalScan }], cancelOn: cancelOnKillSwitch, retries: 1, concurrency: [{ key: "event.data.companyId", limit: 1 }] },
  async ({ event, step }) => {
    const { companyId, reason } = SignalScanSchema.parse(event.data);
    const deps = await buildDeps();
    const runner: StepRunner = { run: (id, fn) => step.run(id, fn) as unknown as ReturnType<typeof fn> };
    const result = await scanCompanySignals(deps, runner, companyId);
    if ("skipped" in result) return { companyId, reason, ...result };
    if (result.converted.cardsOpened.length > 0) {
      await step.sendEvent("cards-opened", result.converted.cardsOpened.map((cardId) => ({ name: EVENT.decisionOpened, data: { companyId, cardId, taskId: null } })));
    }
    return { companyId, reason, ...result };
  },
);

/** PRO-2: signal/detected with `kind: error` → incident report, learning, fix task (idempotent; fatal/error only, at most `FIX_TASKS_PER_DAY`) → task/dispatch. */
export const watchErrors = inngest.createFunction(
  { id: "watch-errors", triggers: [{ event: EVENT.signalDetected, if: 'event.data.kind == "error"' }], cancelOn: cancelOnKillSwitch, retries: 2, concurrency: [{ key: "event.data.signalId", limit: 1 }] },
  async ({ event, step }) => {
    const { companyId, signalId } = SignalDetectedSchema.parse(event.data);
    const deps = await buildDeps();
    const fix = await step.run("fix-task", () => openFixTask(deps, companyId, signalId));
    if (fix.outcome === "opened" && fix.taskId) await step.sendEvent("dispatch", { name: EVENT.taskDispatch, data: { companyId, taskId: fix.taskId } });
    return { companyId, signalId, ...fix };
  },
);

/** PLN-2, hourly (and on `plan/tick`): `plan/requested` for companies whose owner-local time is Monday 06:00 and whose latest plan is older than this week. */
export const planWeekCron = inngest.createFunction(
  { id: "plan-week-cron", triggers: [cron("11 * * * *"), { event: PLAN_TICK_EVENT }], retries: 0 },
  async ({ step }) => {
    const deps = await buildDeps();
    const due = await step.run("tick", () => planTick(deps));
    if (due.length > 0) await step.sendEvent("request", due.map((d) => ({ name: EVENT.planRequested, data: { companyId: d.companyId } })));
    return { due: due.length, companies: due.map((d) => d.companyId) };
  },
);
