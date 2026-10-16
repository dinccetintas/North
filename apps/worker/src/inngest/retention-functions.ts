import { cron } from "inngest";
import { EVENT } from "@north/core";
import { inngest } from "./client";
import { buildDeps } from "../deps";
import { retentionSweep as sweep } from "../services/retention";
import type { StepRunner } from "../services/steps";

/**
 * RET-1 (ADR 0016), daily at 04:07 UTC and on `retention/tick` (the harness
 * runs "today" on demand, the cron shares the body): expired export objects
 * removed, owners past `retention_until` archived and flagged `purge_due`,
 * purged only with `RETENTION_PURGE_ENABLED=1`. A company that was still
 * running when archived gets `company/killswitch`, so nothing of it keeps
 * working.
 */
export const retentionSweep = inngest.createFunction(
  { id: "retention-sweep", triggers: [cron("7 4 * * *"), { event: EVENT.retentionTick }], retries: 1, concurrency: [{ limit: 1 }] },
  async ({ step }) => {
    const deps = await buildDeps();
    const runner: StepRunner = { run: (id, fn) => step.run(id, fn) as unknown as ReturnType<typeof fn> };
    const result = await sweep(deps, runner);
    if (result.stopped.length > 0) await step.sendEvent("stopped", result.stopped.map((companyId) => ({ name: EVENT.companyKillSwitch, data: { companyId } })));
    return result;
  },
);
