import { TASK_OWNER, type TaskType } from "@north/core";
import { createTask, ensureAgentsForCompany, type TaskRecord } from "@north/db";
import type { WorkerDeps } from "../deps";

/** The first 24 hours: research first, then strategy, all K0. Order matters (later tasks read earlier memory). */
export const ONBOARDING_TASKS: ReadonlyArray<{ readonly taskType: TaskType; readonly title: string }> = Object.freeze([
  { taskType: "market_report", title: "Market report: demand, size, alternatives and a plain verdict on demand" },
  { taskType: "personas", title: "Three buyer personas with jobs, pains and where they gather" },
  { taskType: "competitor_map", title: "Competitor map: positioning, pricing, gaps we can own" },
  { taskType: "prd", title: "PRD for the smallest launchable scope, with an ordered build list" },
  { taskType: "business_plan", title: "Business plan: model, pricing, unit economics, 90-day roadmap" },
  { taskType: "investor_deck", title: "Investor deck draft (12 slides) as markdown" },
]);

/** Seeds the eight agents for a company from the role definitions. */
export async function seedAgents(deps: WorkerDeps, companyId: string): Promise<void> {
  const roles = [...deps.roles.values()].map((r) => ({ role: r.role, configRef: `agents/${r.role.replace(/_/g, "-")}.yaml`, maxActionTier: r.max_action_tier }));
  await ensureAgentsForCompany(deps.db, companyId, roles);
}

/** Creates the onboarding tasks (queued) and returns them in execution order. */
export async function createOnboardingTasks(deps: WorkerDeps, companyId: string): Promise<readonly TaskRecord[]> {
  const tasks: TaskRecord[] = [];
  for (const spec of ONBOARDING_TASKS) {
    tasks.push(
      await createTask(deps.db, {
        companyId,
        role: TASK_OWNER[spec.taskType],
        taskType: spec.taskType,
        title: spec.title,
        metricKey: "artifacts",
        expectedDelta: 1,
      }),
    );
  }
  return Object.freeze(tasks);
}
