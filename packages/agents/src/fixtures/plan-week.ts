import type { PlanOutput } from "@north/core";
import type { MockScript } from "../runtime/mock";
import { fixtureContext, succeeded } from "./shared";

/** chief_of_staff:plan_week fixture — four K0 tasks, each tied to a metric with an expected delta and cost. */
export const planWeekScript: MockScript = (input) => {
  const ctx = fixtureContext(input);
  const output: PlanOutput = {
    summary: `Week 1 for ${ctx.company}: confirm the competitive gap, write the version-0 PRD, lock the brand, and turn the numbers into a business plan. All work stays inside the workspace; nothing is published.`,
    rationale: `The thesis "${ctx.thesis}" needs evidence before engineering starts, so research runs first and the PRD follows the same week. Brand and business plan run in parallel because neither blocks the build. By Friday the CEO should see four artifacts and a clear go/no-go on scope. First signal the plan is wrong: the competitor map shows an incumbent already shipping review-before-live, in which case the PRD scope changes before anything is built.`,
    tasks: [
      {
        taskType: "competitor_map",
        title: `Map alternatives for ${ctx.customer} and find the gap ${ctx.company} can own`,
        input: "Compare direct, indirect and do-nothing alternatives: price, target customer, strengths, weaknesses, evidence links. End with positioning gaps and a price band.",
        metricKey: "artifacts",
        expectedDelta: 1,
        costEstimateUsd: 0.6,
      },
      {
        taskType: "prd",
        title: "Write the version-0 PRD with an ordered engineering task list",
        input: "Smallest launchable scope, explicit non-goals, user stories with acceptance criteria, success metric tied to paying customers, ordered task list for Engineering.",
        metricKey: "artifacts",
        expectedDelta: 1,
        costEstimateUsd: 1.2,
      },
      {
        taskType: "brand_kit",
        title: `Brand kit for ${ctx.company}: palette, type, voice`,
        input: "Name usage, palette with hex values, typography, voice and tone with do/don't examples, logo direction, accessibility notes.",
        metricKey: "artifacts",
        expectedDelta: 1,
        costEstimateUsd: 0.5,
      },
      {
        taskType: "business_plan",
        title: "Business plan with pricing, unit economics and 12-month milestones",
        input: "Pricing model, cost to serve, margin, first channel, first-10-customers plan, milestones tied to paying_customers and mrr_usd, stop conditions.",
        metricKey: "paying_customers",
        expectedDelta: 0,
        costEstimateUsd: 0.9,
      },
    ],
  };
  return succeeded(input, "plan_week", output);
};
