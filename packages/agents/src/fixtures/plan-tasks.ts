import type { PlannedTask, TaskType } from "@north/core";
import type { FixtureContext } from "./shared";

/**
 * The task the Chief of Staff fixtures plan for each type: title, input,
 * metric, expected delta and cost. One table so the first plan and the
 * Monday rewrite describe the same work the same way.
 */
interface TaskTemplate {
  readonly title: (ctx: FixtureContext) => string;
  readonly input: string;
  readonly metricKey: PlannedTask["metricKey"];
  readonly expectedDelta: number;
  readonly costEstimateUsd: number;
}

const artifact = (title: (ctx: FixtureContext) => string, input: string, costEstimateUsd: number): TaskTemplate => ({ title, input, metricKey: "artifacts", expectedDelta: 1, costEstimateUsd });

export const TASK_TEMPLATES: Readonly<Record<TaskType, TaskTemplate>> = Object.freeze({
  market_report: artifact((ctx) => `Re-check demand for ${ctx.company}: what changed since the first report`, "Market definition, bottom-up size, demand evidence with links, trends and why-now, risks, a proceed/narrow/stop line.", 0.8),
  personas: artifact((ctx) => `Personas for ${ctx.customer}: who buys first and where they gather`, "Two or three segments with jobs, alternatives, buying process, objections, channels; one primary persona with the reason.", 0.6),
  competitor_map: artifact((ctx) => `Map alternatives for ${ctx.customer} and find the gap ${ctx.company} can own`, "Compare direct, indirect and do-nothing alternatives: price, target customer, strengths, weaknesses, evidence links. End with positioning gaps and a price band.", 0.6),
  prd: artifact(() => "Write the version-0 PRD with an ordered engineering task list", "Smallest launchable scope, explicit non-goals, user stories with acceptance criteria, success metric tied to paying customers, ordered task list for Engineering.", 1.2),
  business_plan: { title: () => "Business plan with pricing, unit economics and 12-month milestones", input: "Pricing model, cost to serve, margin, first channel, first-10-customers plan, milestones tied to paying_customers and mrr_usd, stop conditions.", metricKey: "paying_customers", expectedDelta: 0, costEstimateUsd: 0.9 },
  investor_deck: artifact((ctx) => `Investor deck for ${ctx.company}`, "Ten to twelve slides as markdown sections: problem, solution, why-now, market, product, plan, model, competition, team, ask.", 1),
  brand_kit: artifact((ctx) => `Brand kit for ${ctx.company}: palette, type, voice`, "Name usage, palette with hex values, typography, voice and tone with do/don't examples, logo direction, accessibility notes.", 0.5),
  screen_designs: artifact((ctx) => `Screen designs for ${ctx.company}'s first scope`, "Three to five screens from the PRD, mobile first, full copy, states, accessibility notes, one-paragraph rationale per screen.", 0.8),
  build_site: { title: (ctx) => `Build and preview the ${ctx.company} landing page`, input: "Static landing page from the PRD and brand kit: promise, who it is for, one waitlist call to action, how it works, proof, pricing, FAQ. The platform pushes, previews and opens the go-live card.", metricKey: "site_visitors", expectedDelta: 0, costEstimateUsd: 4 },
  campaign_spec: { title: (ctx) => `First paid test for ${ctx.company}: a small launch campaign`, input: "One objective tied to sign-ups, precise audience and targeting, plain creative, $10/day for five days inside the ads cap, a stop rule. The start is a decision card.", metricKey: "signups", expectedDelta: 10, costEstimateUsd: 0.7 },
  lead_research: { title: (ctx) => `Find five ${ctx.customer} with a why-now`, input: "Public research only; five leads with name, email, company and the reason they fit now. Nothing is contacted here.", metricKey: "artifacts", expectedDelta: 1, costEstimateUsd: 0.6 },
  outreach_batch: { title: (ctx) => `First-contact batch to five ${ctx.customer}`, input: "One short email per lead from the lead list: what we noticed, what we do, one ask. The whole batch is one decision card.", metricKey: "email_replies", expectedDelta: 2, costEstimateUsd: 0.5 },
  plan_week: artifact(() => "Weekly plan", "Plan the week from the goal and the ledger.", 0.3),
  brief: artifact(() => "Morning brief", "What happened, what is blocked, today's plan, spend.", 0.1),
  signal_research: artifact((ctx) => `Research a signal for ${ctx.company}`, "Research the signal's facts (data) and write a signal report.", 0.5),
  fix_error: { title: (ctx) => `Fix a reported error on the ${ctx.company} site`, input: "Reproduce, fix the cause, keep the page working; the platform pushes a fix branch, opens the PR and previews it.", metricKey: "site_visitors", expectedDelta: 0, costEstimateUsd: 3 },
});

/** The planned task for a type, with the template's title unless the previous plan's title is carried over. */
export function plannedTask(taskType: TaskType, ctx: FixtureContext, title?: string): PlannedTask {
  const template = TASK_TEMPLATES[taskType];
  return Object.freeze({
    taskType,
    title: (title && title.trim().length > 0 ? title : template.title(ctx)).slice(0, 200),
    input: template.input,
    metricKey: template.metricKey,
    expectedDelta: template.expectedDelta,
    costEstimateUsd: template.costEstimateUsd,
  });
}
