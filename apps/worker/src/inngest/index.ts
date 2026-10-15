import { connectProvider, decisionDeadlines, killSwitch, notifyDecisionFn, onboardCompany, ping, planWeekFn, resumeCompany, retryDeferred, revokeProvider, runTask, settleDecisionFn, sweepSecrets } from "./functions";
import { collectCompanyMetricsFn, collectMetrics } from "./metrics-functions";
import { dailyBrief, generateBriefFn, planWeekCron, scanCompanySignalsFn, scanSignals, watchErrors } from "./proactive-functions";

/** Every function the worker serves at /api/inngest. */
export const functions = [
  runTask,
  settleDecisionFn,
  decisionDeadlines,
  notifyDecisionFn,
  onboardCompany,
  planWeekFn,
  killSwitch,
  resumeCompany,
  retryDeferred,
  connectProvider,
  revokeProvider,
  sweepSecrets,
  collectMetrics,
  collectCompanyMetricsFn,
  dailyBrief,
  generateBriefFn,
  scanSignals,
  scanCompanySignalsFn,
  watchErrors,
  planWeekCron,
  ping,
];
