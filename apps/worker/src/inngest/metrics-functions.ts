import { cron } from "inngest";
import { EVENT, MetricCollectSchema } from "@north/core";
import { listCompaniesWithCollectables } from "@north/db";
import { inngest } from "./client";
import { buildDeps } from "../deps";
import { collectCompanyMetrics } from "../services/collect-metrics";
import type { StepRunner } from "../services/steps";

const cancelOnKillSwitch = [{ event: EVENT.companyKillSwitch, match: "data.companyId" }];

/** How far back a first-contact send keeps a company in the hourly collection (replies arrive late). */
export const COLLECT_SINCE_DAYS = 30;

/** Hourly (OUT-2): every company with a running or cap-paused campaign, or a recent outreach batch, whose kill switch is off, gets a `metric/collect`. */
export const collectMetrics = inngest.createFunction(
  { id: "collect-metrics", triggers: [cron("7 * * * *")], retries: 0 },
  async ({ step }) => {
    const deps = await buildDeps();
    const companyIds = await step.run("companies", () => listCompaniesWithCollectables(deps.db, COLLECT_SINCE_DAYS));
    if (companyIds.length > 0) {
      await step.sendEvent("fan-out", companyIds.map((companyId) => ({ name: EVENT.metricCollect, data: { companyId, reason: "cron" } })));
    }
    return { companies: companyIds.length };
  },
);

/**
 * metric/collect → one company's collection, one run at a time per company,
 * cancelled by the kill switch. Every provider read and every write is its
 * own step; a cap pause and a cap card run through the gate like any action.
 */
export const collectCompanyMetricsFn = inngest.createFunction(
  { id: "collect-company-metrics", triggers: [{ event: EVENT.metricCollect }], cancelOn: cancelOnKillSwitch, retries: 1, concurrency: [{ key: "event.data.companyId", limit: 1 }] },
  async ({ event, step }) => {
    const { companyId, reason } = MetricCollectSchema.parse(event.data);
    const deps = await buildDeps();
    // Inngest types step results as Jsonify<T>; the collector's results are plain JSON, so the narrowing is sound.
    const runner: StepRunner = { run: (id, fn) => step.run(id, fn) as unknown as ReturnType<typeof fn> };
    const result = await collectCompanyMetrics(deps, runner, companyId, reason);
    if (result.cardsOpened.length > 0) {
      await step.sendEvent("cards-opened", result.cardsOpened.map((cardId) => ({ name: EVENT.decisionOpened, data: { companyId, cardId, taskId: null } })));
    }
    return { companyId, reason, ...result };
  },
);
