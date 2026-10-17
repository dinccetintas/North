/**
 * TST-2: the verdict of the real-Claude smoke (`scripts/smoke-llm.ts`) over
 * everything a run left behind: the tasks' outcomes, the market report, the
 * preview, the company's `agent_runs` (the ledger) and, on the SDK runtime,
 * the gateway's priced spend during the run (the spend truth: a run can store
 * `cost_usd` 0 while the gateway spent money). Pure: it reads nothing and
 * changes nothing.
 */
import { assertMarkdownHeadings, MIN_REPORT_HEADINGS, usd, type SmokeRuntime, type SmokeSummary } from "./smoke-llm-helpers";

/** How a smoke task ended. */
export interface SmokeTaskOutcome {
  readonly taskType: string;
  readonly status: string;
  readonly evidence: { readonly kind: string; readonly verified: boolean } | null;
  readonly lastError: string | null;
}

/** Everything the verdict reads, gathered by the script after the tasks settle. */
export interface SmokeFacts {
  readonly runtime: SmokeRuntime;
  readonly maxCostUsd: number;
  readonly tasks: readonly SmokeTaskOutcome[];
  readonly summary: SmokeSummary;
  /** The artifact the market report task's evidence names; null when it names none. */
  readonly marketReport: { readonly kind: string; readonly markdown: string } | null;
  /** The build task's `deploy.preview` action (`pickPreview`) and what its URL answered. */
  readonly preview: { readonly status: string | null; readonly url: string | null; readonly httpStatus: number | null };
  /** The gateway's day spend (`/health` `budget.spentUsd`) at the gate and after the run; null on the mock runtime, which has no gateway. */
  readonly gateway: GatewaySpend | null;
}

/** The gateway's day spend before anything was created and after the run; null when `/health` did not report it. */
export interface GatewaySpend {
  readonly beforeUsd: number | null;
  readonly afterUsd: number | null;
}

/** What the gateway priced during the run (after minus before); null when either is unread or the UTC day rolled over in between. */
export function gatewayDeltaUsd(gateway: GatewaySpend | null): number | null {
  if (gateway === null || gateway.beforeUsd === null || gateway.afterUsd === null || gateway.afterUsd < gateway.beforeUsd) return null;
  return usd(gateway.afterUsd - gateway.beforeUsd);
}

/** K1 completes an executed action as `notified` (executed, the CEO told); K0 as `executed`. Either means it ran. */
const RAN = new Set(["executed", "notified"]);

function taskProblems(tasks: readonly SmokeTaskOutcome[]): string[] {
  return tasks.flatMap((t) => {
    if (t.status !== "done") return [`${t.taskType} is ${t.status}${t.lastError ? `: ${t.lastError}` : ""}`];
    return t.evidence?.verified ? [] : [`${t.taskType} is done without verified evidence`];
  });
}

function reportProblems(report: SmokeFacts["marketReport"]): string[] {
  if (!report) return ["no market report artifact: the market_report task's evidence names none"];
  if (report.kind !== "market_report") return [`the market report's evidence is an artifact of kind "${report.kind}"`];
  try {
    assertMarkdownHeadings(report.markdown, MIN_REPORT_HEADINGS);
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
}

function previewProblems(preview: SmokeFacts["preview"]): string[] {
  if (preview.status === null) return ["the build task has no deploy.preview action"];
  if (!RAN.has(preview.status)) return [`deploy.preview is ${preview.status}, not executed`];
  if (preview.url === null) return ["deploy.preview ran but recorded no URL"];
  return preview.httpStatus === 200 ? [] : [`the preview ${preview.url} answered ${preview.httpStatus ?? "nothing"}, not 200`];
}

function runProblems(facts: SmokeFacts): string[] {
  const { summary, runtime, maxCostUsd } = facts;
  const cost = summary.totalCostUsd > maxCostUsd ? [`agent runs cost $${summary.totalCostUsd.toFixed(4)}, over the $${maxCostUsd.toFixed(2)} cap`] : [];
  const others = summary.runtimes.filter((r) => r !== runtime);
  const foreign = others.length > 0 ? [`smoke tasks ran on runtime ${others.join(", ")}, not ${runtime}`] : [];
  const silent = runtime === "claude-agent-sdk" ? summary.tasks.filter((t) => t.inputTokens + t.outputTokens === 0).map((t) => `${t.taskType} recorded no tokens on the SDK runtime`) : [];
  return [...cost, ...foreign, ...silent];
}

const money = (value: number): string => `$${value.toFixed(4)}`;

/** Why the gateway's spend during the run cannot be read, or null when it can. */
function unreadGateway(gateway: GatewaySpend | null): string | null {
  if (gateway === null) return "no gateway spend was read: the SDK runtime must run through the worker's gateway";
  if (gateway.beforeUsd === null || gateway.afterUsd === null) return `could not read the gateway's spend ${gateway.beforeUsd === null ? "before" : "after"} the run (its /health budget)`;
  if (gateway.afterUsd < gateway.beforeUsd) return `the gateway's UTC day rolled over during the run (spent ${money(gateway.beforeUsd)} before, ${money(gateway.afterUsd)} after): the run's spend cannot be read; re-run`;
  return null;
}

/** SDK runtime: the gateway is the spend truth. It must have priced some spend, at most the cap, and a ledger of $0 next to used tokens is a lost cost. */
function gatewayProblems(facts: SmokeFacts): string[] {
  if (facts.runtime !== "claude-agent-sdk") return [];
  const { summary, maxCostUsd } = facts;
  const delta = gatewayDeltaUsd(facts.gateway);
  const unread = unreadGateway(facts.gateway);
  const spend = unread !== null ? [unread] : delta === null || delta <= 0 ? [`the gateway priced no spend for the run (${money(delta ?? 0)}): the tasks did not reach real Claude through the gateway`] : delta > maxCostUsd ? [`the gateway priced ${money(delta)} during the run, over the $${maxCostUsd.toFixed(2)} cap`] : [];
  const usedTokens = summary.tasks.some((t) => t.inputTokens + t.outputTokens > 0);
  const lost = summary.totalCostUsd === 0 && usedTokens ? [`agent_runs recorded $0 although the smoke tasks used tokens: the ledger lost the cost (the gateway priced ${delta === null ? "an unread amount" : money(delta)})`] : [];
  return [...spend, ...lost];
}

/**
 * Every problem with the run at once (empty when it passed): both tasks done
 * with verified evidence (a gateway 402 shows up as a failed task with its
 * reason), the market report a `market_report` artifact with at least three
 * `##` headings, the build's `deploy.preview` ran and answers 200, the
 * company's `agent_runs` cost at most the cap, and on the SDK runtime every
 * smoke task ran on it with real tokens, the gateway priced more than $0 and
 * at most the cap during the run, and the ledger did not lose that cost.
 */
export function smokeProblems(facts: SmokeFacts): readonly string[] {
  return Object.freeze([...taskProblems(facts.tasks), ...reportProblems(facts.marketReport), ...previewProblems(facts.preview), ...runProblems(facts), ...gatewayProblems(facts)]);
}
