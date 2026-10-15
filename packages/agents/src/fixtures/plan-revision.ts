import { CHANNEL_METRIC_KEYS, taskTypeCounts, type ChannelReportRow, type PlanOutput, type PlanRevision, type PlannedTask, type TaskType } from "@north/core";
import type { MockScript } from "../runtime/mock";
import type { AgentRunInput } from "../runtime/types";
import { parseLeadsCountVar, parseLedgerReportVar, parsePreviousPlanVar, parseSiteUrlVar, type PreviousPlanVar } from "../runtime/vars";
import { plannedTask } from "./plan-tasks";
import { fixtureContext, succeeded, type FixtureContext } from "./shared";

/**
 * PLN-2 as the fixture does it: the Monday rewrite from the previous plan and
 * the channel report. Deterministic rules, honest about the ledger:
 * - a `done` one-off K0 type is dropped ("delivered; in memory");
 * - anything not done is carried over;
 * - a `not_working` channel sets the task type that feeds it to zero, with
 *   the channel's numbers in the reason; `working` keeps it;
 * - `build_site` is added when there is no site; `campaign_spec` with a live
 *   site and `outreach_batch` with leads are added when absent and not cut.
 * The `revisions` list is derived from the final counts against the previous
 * plan, so every type that fell carries a reason by construction.
 */
const CHANNEL_FEEDS: Readonly<Record<string, TaskType>> = Object.freeze({ cold_email: "outreach_batch", meta_ads: "campaign_spec", google_ads: "campaign_spec" });

/** Types planned again every week while their channel works; everything else is one-off and dropped once delivered. */
const RECURRING: ReadonlySet<TaskType> = new Set<TaskType>(["campaign_spec", "outreach_batch", "lead_research"]);

const OUTCOME_LABELS: Readonly<Record<string, string>> = Object.freeze({ email_replies: "replies", signups: "sign-ups", paying_customers: "paying customers", site_visitors: "visitors", demo_calls: "demo calls", waitlist: "waitlist sign-ups", mrr_usd: "USD MRR", revenue_usd: "USD revenue", artifacts: "artifacts" });
const ACTIVITY_LABELS: Readonly<Record<string, string>> = Object.freeze({ emails_sent: "sent", ad_clicks: "clicks", ad_impressions: "impressions" });

const usd = (value: number): string => `$${value.toFixed(2)}`;

/** "cold_email: 5 sent, 0 replies in the week of 2026-10-05 ($0.00 spent)": the channel's numbers from its report rows. */
export function channelReason(channel: string, rows: readonly ChannelReportRow[], weekStart: string | undefined): string {
  const mine = rows.filter((r) => r.channel === channel);
  const activity = mine.filter((r) => ACTIVITY_LABELS[r.metricKey]).map((r) => `${r.totalDelta} ${ACTIVITY_LABELS[r.metricKey]}`);
  const outcomes = mine.filter((r) => !(CHANNEL_METRIC_KEYS as readonly string[]).includes(r.metricKey)).map((r) => `${r.totalDelta} ${OUTCOME_LABELS[r.metricKey] ?? r.metricKey}`);
  const spend = mine.reduce((sum, r) => sum + r.totalCostUsd, 0);
  const window = weekStart ? `in the week of ${weekStart}` : "since the last plan";
  return `${channel}: ${[...activity, ...outcomes].join(", ") || "no outcome recorded"} ${window} (${usd(spend)} spent); the channel is not working, so its task is cut`;
}

interface Draft {
  readonly tasks: readonly PlannedTask[];
  /** Why a type has fewer tasks than before, by type; consulted when the counts are compared. */
  readonly reasons: Readonly<Record<string, string>>;
  /** Types a `not_working` verdict cut this week; never re-added below. */
  readonly cut: readonly TaskType[];
  readonly added: readonly PlanRevision[];
}

const DELIVERED = "delivered; in memory";

const carryOver = (previous: PreviousPlanVar, ctx: FixtureContext): Draft => {
  const tasks: PlannedTask[] = [];
  const reasons: Record<string, string> = {};
  for (const task of previous.tasks) {
    if (task.status === "done") {
      if (RECURRING.has(task.taskType)) tasks.push(plannedTask(task.taskType, ctx));
      else reasons[task.taskType] = DELIVERED;
    } else tasks.push(plannedTask(task.taskType, ctx, task.title));
  }
  return { tasks, reasons, cut: [], added: [] };
};

const applyVerdicts = (draft: Draft, report: readonly ChannelReportRow[], weekStart: string | undefined): Draft => {
  const cut = new Map<TaskType, string>();
  for (const row of report) {
    const fed = CHANNEL_FEEDS[row.channel];
    if (row.verdict === "not_working" && fed && !cut.has(fed)) cut.set(fed, channelReason(row.channel, report, weekStart));
  }
  return { ...draft, tasks: draft.tasks.filter((t) => !cut.has(t.taskType)), reasons: { ...draft.reasons, ...Object.fromEntries(cut) }, cut: [...cut.keys()] };
};

const addMissing = (draft: Draft, ctx: FixtureContext, siteUrl: string | null, leads: number): Draft => {
  const has = (type: TaskType): boolean => draft.tasks.some((t) => t.taskType === type);
  const tasks = [...draft.tasks];
  const added: PlanRevision[] = [...draft.added];
  const push = (type: TaskType, reason: string): void => {
    tasks.push(plannedTask(type, ctx));
    added.push({ taskType: type, change: "added", reason });
  };
  if (!siteUrl && !has("build_site")) push("build_site", "there is no site yet; nothing can be measured until the page is up");
  if (siteUrl && !has("campaign_spec") && !draft.cut.includes("campaign_spec")) push("campaign_spec", `the site is up at ${siteUrl}; a small paid test tells us whether the promise converts`);
  if (leads > 0 && !has("outreach_batch") && !draft.cut.includes("outreach_batch")) push("outreach_batch", `${leads} leads are waiting in the lead list`);
  if (tasks.length === 0) push("market_report", "every planned type was delivered or cut; re-checking demand is the cheapest next step");
  return { ...draft, tasks, added };
};

/** `fewer`/`dropped` for every type whose count fell, with the draft's reason, then the additions. */
const revisionsFor = (previous: PreviousPlanVar, draft: Draft): readonly PlanRevision[] => {
  const before = taskTypeCounts(previous.tasks);
  const after = taskTypeCounts(draft.tasks);
  const shrunk = Object.keys(before)
    .filter((type) => (after[type] ?? 0) < (before[type] ?? 0))
    .map((type): PlanRevision => ({
      taskType: type as TaskType,
      change: (after[type] ?? 0) === 0 ? "dropped" : "fewer",
      reason: draft.reasons[type] ?? "not carried over: no outcome was recorded for it last week",
    }));
  return [...shrunk, ...draft.added];
};

const failed = (error: string) => Object.freeze({ status: "failed" as const, error, sessionId: null, usage: { model: "mock", inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 1 } });

/** The Monday rewrite (PLN-2); `planWeekScript` delegates here when `vars["plan.previous"]` is present. */
export const planRevisionScript: MockScript = (input: AgentRunInput) => {
  const ctx = fixtureContext(input);
  const previous = parsePreviousPlanVar(input.vars);
  if (!previous) return failed('plan revision needs vars["plan.previous"]');
  const verdicts = applyVerdicts(carryOver(previous, ctx), parseLedgerReportVar(input.vars), previous.weekStart);
  const draft = addMissing(verdicts, ctx, parseSiteUrlVar(input.vars), parseLeadsCountVar(input.vars));
  const revisions = revisionsFor(previous, draft);
  const cuts = revisions.filter((r) => r.change !== "added");
  const delivered = Object.entries(draft.reasons).filter(([, reason]) => reason === DELIVERED).map(([type]) => type);
  const notWorking = draft.cut.map((type) => draft.reasons[type]).filter((r): r is string => r !== undefined);
  const output: PlanOutput = {
    summary: `Rewrite for ${ctx.company}${previous.weekStart ? ` after the week of ${previous.weekStart}` : ""}: ${draft.tasks.length} task${draft.tasks.length === 1 ? "" : "s"}, ${cuts.length} type${cuts.length === 1 ? "" : "s"} cut or reduced, ${draft.added.length} added; every cut names its reason from the ledger.`,
    rationale: [
      `The ledger, not activity, decides what continues: ${notWorking.length > 0 ? notWorking.join("; ") : "no channel was judged not working"}.`,
      `Delivered one-off work (${delivered.join(", ") || "none"}) is in memory and is not planned again.`,
      `First signal this plan is wrong: a working channel's replies or sign-ups stop moving within the week.`,
    ].join(" "),
    tasks: [...draft.tasks],
    revisions: [...revisions],
  };
  return succeeded(input, "plan_week", output);
};
