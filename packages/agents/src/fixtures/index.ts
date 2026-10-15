import type { MockScript } from "../runtime/mock";
import { brandKitScript } from "./brand-kit";
import { buildSiteScript } from "./build-site";
import { businessPlanScript } from "./business-plan";
import { campaignSpecScript } from "./campaign-spec";
import { competitorMapScript } from "./competitor-map";
import { fixErrorScript } from "./fix-error";
import { investorDeckScript } from "./investor-deck";
import { leadResearchScript } from "./lead-research";
import { marketReportScript } from "./market-report";
import { outreachBatchScript } from "./outreach-batch";
import { personasScript } from "./personas";
import { planWeekScript } from "./plan-week";
import { prdScript } from "./prd";
import { screenDesignsScript } from "./screen-designs";
import { signalResearchScript } from "./signal-research";

/**
 * Fixture scripts for `MockRuntime`, keyed `"<role>:<taskType>"` (ADR 0004).
 * Every task type in `TASK_OWNER` except `brief` has one; add a script here
 * whenever a task type is added. The two K2 scripts (campaign_spec,
 * outreach_batch) request external actions so the decision layer can be
 * exercised end to end without a real model; lead_research (K0) feeds the
 * leads table the outreach batch reads. M5 adds signal_research (K0, from a
 * signal card) and fix_error (engineering, from a Sentry issue); plan_week
 * becomes the Monday rewrite when `vars["plan.previous"]` is present.
 */
export const mockScripts: Readonly<Record<string, MockScript>> = Object.freeze({
  "research:market_report": marketReportScript,
  "research:personas": personasScript,
  "research:competitor_map": competitorMapScript,
  "research:signal_research": signalResearchScript,
  "strategy_product:prd": prdScript,
  "strategy_product:business_plan": businessPlanScript,
  "strategy_product:investor_deck": investorDeckScript,
  "design:brand_kit": brandKitScript,
  "design:screen_designs": screenDesignsScript,
  "engineering:build_site": buildSiteScript,
  "engineering:fix_error": fixErrorScript,
  "growth:campaign_spec": campaignSpecScript,
  "sales:lead_research": leadResearchScript,
  "sales:outreach_batch": outreachBatchScript,
  "chief_of_staff:plan_week": planWeekScript,
});

export { fixtureContext, succeeded, type FixtureContext } from "./shared";
export { FIXTURE_CAMPAIGN_DAILY_USD, FIXTURE_CAMPAIGN_DAYS, FIXTURE_CAMPAIGN_STOP_RULE, FIXTURE_CAMPAIGN_TARGETING } from "./campaign-spec";
export { FIXTURE_LEADS } from "./lead-research";
export { FIXTURE_PROSPECTS, batchIdFor } from "./outreach-batch";
export { FAIL_ALWAYS_MARKER, FAIL_ONCE_MARKER, landingPageHtml, siteNameFor } from "./build-site";
export { FIRST_PLAN_TYPES, planWeekScript } from "./plan-week";
export { planRevisionScript, channelReason } from "./plan-revision";
export { TASK_TEMPLATES, plannedTask } from "./plan-tasks";
export { signalResearchScript, signalFactsFromInput, type SignalFactsFromInput } from "./signal-research";
export { fixErrorScript, fixMarker, fixedLandingPageHtml, issueFactsFromInput, type IssueFactsFromInput } from "./fix-error";
export { MOCK_LLM_RESPONSES, mockSignalScores, sandboxSignalScore } from "./llm-responses";
