import type { PlanOutput, PlanRevision, PlannedTask } from "@north/core";
import type { MockScript } from "../runtime/mock";
import { parseLeadsCountVar, parsePreviousPlanVar, parseSiteUrlVar } from "../runtime/vars";
import { planRevisionScript } from "./plan-revision";
import { plannedTask } from "./plan-tasks";
import { fixtureContext, succeeded, type FixtureContext } from "./shared";

/** The four K0 tasks every company's first week starts with (M1-M4 acceptance tests depend on exactly these). */
export const FIRST_PLAN_TYPES = ["competitor_map", "prd", "brand_kit", "business_plan"] as const;

const firstPlan = (ctx: FixtureContext, siteUrl: string | null, leads: number): { readonly tasks: readonly PlannedTask[]; readonly revisions: readonly PlanRevision[]; readonly extras: readonly string[] } => {
  const tasks: PlannedTask[] = FIRST_PLAN_TYPES.map((type) => plannedTask(type, ctx));
  const revisions: PlanRevision[] = [];
  const extras: string[] = [];
  if (siteUrl) {
    tasks.push(plannedTask("campaign_spec", ctx));
    revisions.push({ taskType: "campaign_spec", change: "added", reason: `the site is up at ${siteUrl}; a small paid test tells us whether the promise converts` });
    extras.push("a first paid test, since the site is live");
  }
  if (leads > 0) {
    tasks.push(plannedTask("outreach_batch", ctx));
    revisions.push({ taskType: "outreach_batch", change: "added", reason: `${leads} leads are waiting in the lead list; the first batch asks the CEO before any email goes out` });
    extras.push(`a first-contact batch, since ${leads} leads are waiting`);
  }
  return { tasks, revisions, extras };
};

/**
 * chief_of_staff:plan_week fixture. With `vars["plan.previous"]` it is the
 * Monday rewrite (`planRevisionScript`, PLN-2). Otherwise the first plan:
 * four K0 tasks, unchanged for a company with no site and no leads (M1-M4
 * stay green), plus `campaign_spec` when `vars["site.url"]` is set and
 * `outreach_batch` when `vars["leads.count"]` is positive.
 */
export const planWeekScript: MockScript = (input) => {
  if (parsePreviousPlanVar(input.vars)) return planRevisionScript(input);
  const ctx = fixtureContext(input);
  const { tasks, revisions, extras } = firstPlan(ctx, parseSiteUrlVar(input.vars), parseLeadsCountVar(input.vars));
  const extraLine = extras.length > 0 ? ` Added: ${extras.join("; ")}.` : "";
  const output: PlanOutput = {
    summary: `Week 1 for ${ctx.company}: confirm the competitive gap, write the version-0 PRD, lock the brand, and turn the numbers into a business plan. All work stays inside the workspace; nothing is published.${extraLine}`,
    rationale: `The thesis "${ctx.thesis}" needs evidence before engineering starts, so research runs first and the PRD follows the same week. Brand and business plan run in parallel because neither blocks the build. By Friday the CEO should see four artifacts and a clear go/no-go on scope. First signal the plan is wrong: the competitor map shows an incumbent already shipping review-before-live, in which case the PRD scope changes before anything is built.`,
    tasks: [...tasks],
    revisions: [...revisions],
  };
  return succeeded(input, "plan_week", output);
};
