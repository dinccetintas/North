import { connectProvider, decisionDeadlines, killSwitch, notifyDecisionFn, onboardCompany, ping, planWeekFn, resumeCompany, retryDeferred, revokeProvider, runTask, settleDecisionFn, sweepSecrets } from "./functions";
import { collectCompanyMetricsFn, collectMetrics } from "./metrics-functions";

/** Every function the worker serves at /api/inngest. */
export const functions = [runTask, settleDecisionFn, decisionDeadlines, notifyDecisionFn, onboardCompany, planWeekFn, killSwitch, resumeCompany, retryDeferred, connectProvider, revokeProvider, sweepSecrets, collectMetrics, collectCompanyMetricsFn, ping];
