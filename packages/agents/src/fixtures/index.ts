import type { MockScript } from "../runtime/mock";
import { brandKitScript } from "./brand-kit";
import { businessPlanScript } from "./business-plan";
import { competitorMapScript } from "./competitor-map";
import { investorDeckScript } from "./investor-deck";
import { marketReportScript } from "./market-report";
import { personasScript } from "./personas";
import { planWeekScript } from "./plan-week";
import { prdScript } from "./prd";

/**
 * Fixture scripts for `MockRuntime`, keyed `"<role>:<taskType>"` (ADR 0004).
 * Every K0 task type in `TASK_OWNER` except `brief` has one; add a script
 * here whenever a task type is added.
 */
export const mockScripts: Readonly<Record<string, MockScript>> = Object.freeze({
  "research:market_report": marketReportScript,
  "research:personas": personasScript,
  "research:competitor_map": competitorMapScript,
  "strategy_product:prd": prdScript,
  "strategy_product:business_plan": businessPlanScript,
  "strategy_product:investor_deck": investorDeckScript,
  "design:brand_kit": brandKitScript,
  "chief_of_staff:plan_week": planWeekScript,
});

export { fixtureContext, succeeded, type FixtureContext } from "./shared";
