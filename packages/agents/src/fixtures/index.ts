import type { MockScript } from "../runtime/mock";
import { brandKitScript } from "./brand-kit";
import { businessPlanScript } from "./business-plan";
import { campaignSpecScript } from "./campaign-spec";
import { competitorMapScript } from "./competitor-map";
import { investorDeckScript } from "./investor-deck";
import { marketReportScript } from "./market-report";
import { outreachBatchScript } from "./outreach-batch";
import { personasScript } from "./personas";
import { planWeekScript } from "./plan-week";
import { prdScript } from "./prd";

/**
 * Fixture scripts for `MockRuntime`, keyed `"<role>:<taskType>"` (ADR 0004).
 * Every task type in `TASK_OWNER` except `brief` has one; add a script here
 * whenever a task type is added. The two K2 scripts (campaign_spec,
 * outreach_batch) request external actions so the decision layer can be
 * exercised end to end without a real model.
 */
export const mockScripts: Readonly<Record<string, MockScript>> = Object.freeze({
  "research:market_report": marketReportScript,
  "research:personas": personasScript,
  "research:competitor_map": competitorMapScript,
  "strategy_product:prd": prdScript,
  "strategy_product:business_plan": businessPlanScript,
  "strategy_product:investor_deck": investorDeckScript,
  "design:brand_kit": brandKitScript,
  "growth:campaign_spec": campaignSpecScript,
  "sales:outreach_batch": outreachBatchScript,
  "chief_of_staff:plan_week": planWeekScript,
});

export { fixtureContext, succeeded, type FixtureContext } from "./shared";
export { FIXTURE_CAMPAIGN_DAILY_USD, FIXTURE_CAMPAIGN_DAYS } from "./campaign-spec";
export { FIXTURE_PROSPECTS } from "./outreach-batch";
