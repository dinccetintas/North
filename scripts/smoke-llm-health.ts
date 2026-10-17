/**
 * TST-2: the health gate of the real-Claude smoke. Before it creates anything,
 * `smoke-llm.ts` reads the worker's `GET /health` and runs only against a
 * worker that is not production (`env` staging), runs sandbox integrations,
 * resolves models on the `smoke` profile, runs the runtime asked for and, on
 * the SDK runtime, has the gateway's day cap on at most $0.50 with money left
 * today. It keeps the gateway's day spend at the gate, so the run's spend is
 * measured from there. The body is untrusted JSON: Zod reads it, every
 * problem is listed at once, and each one names what it found and what to set.
 */
import { z } from "zod";
import { SMOKE_RUNTIMES, type SmokePlan, type SmokeRuntime } from "./smoke-llm-helpers";

/** What the gate decided: the runtime under test (the flag, else the worker's), the worker's profile, the gateway's day spend so far (null without a gateway), and every problem. */
export interface HealthVerdict {
  readonly ok: boolean;
  readonly runtime: SmokeRuntime | null;
  readonly profile: string | null;
  /** `budget.spentUsd` at the gate, before anything is created: the run's spend is measured from here. */
  readonly spentUsd: number | null;
  readonly problems: readonly string[];
}

const BudgetSchema = z.object({ capUsd: z.number(), spentUsd: z.number(), unpriced: z.number(), exhausted: z.boolean() });
const HealthSchema = z.object({
  mode: z.string(),
  runtime: z.string(),
  profile: z.string(),
  env: z.string(),
  gateway: z.string(),
  budget: BudgetSchema.nullable(),
});
type Health = z.infer<typeof HealthSchema>;

const isRuntime = (value: string): value is SmokeRuntime => (SMOKE_RUNTIMES as readonly string[]).includes(value);
const isWorkerLine = (body: unknown): boolean => body !== null && typeof body === "object" && !Array.isArray(body) && (body as Record<string, unknown>).app === "north-worker";

const verdict = (runtime: SmokeRuntime | null, profile: string | null, spentUsd: number | null, problems: readonly string[]): HealthVerdict =>
  Object.freeze({ ok: problems.length === 0, runtime, profile, spentUsd, problems: Object.freeze([...problems]) });

function deploymentProblems(h: Health): string[] {
  return [
    ...(h.env === "staging" ? [] : [`worker env is "${h.env}": the LLM smoke never runs against production (set NORTH_ENV=staging on the worker)`]),
    ...(h.mode === "sandbox" ? [] : [`worker mode is "${h.mode}": the smoke runs on sandbox integrations only (INTEGRATIONS_MODE=sandbox)`]),
    ...(h.profile === "smoke" ? [] : [`worker profile is "${h.profile}": start the worker with NORTH_MODEL_PROFILE=smoke`]),
  ];
}

function runtimeProblems(h: Health, asked: SmokeRuntime | null): string[] {
  if (!isRuntime(h.runtime)) return [`worker runtime is "${h.runtime}": expected mock or claude-agent-sdk`];
  return asked !== null && asked !== h.runtime ? [`worker runtime is "${h.runtime}" but --runtime ${asked} was asked`] : [];
}

/** The SDK runtime spends money: the gateway's day cap must be on, at most the smoke's cap, and not already used up. */
function budgetProblems(h: Health, maxCostUsd: number): string[] {
  if (h.runtime !== "claude-agent-sdk") return [];
  const budget = h.budget;
  if (budget === null || budget.capUsd <= 0) return ["the gateway reports no day cap: start the worker with NORTH_DAILY_CAP_USD=0.50 (the run's hard stop)"];
  if (budget.capUsd > maxCostUsd) return [`the gateway's budget.capUsd is ${budget.capUsd}, above the smoke's ${maxCostUsd}: set NORTH_DAILY_CAP_USD=0.50`];
  if (budget.exhausted) return ["the gateway closed today's budget (a reply it could not price): wait for the next UTC day or restart the worker"];
  if (budget.spentUsd >= budget.capUsd) return [`the gateway already spent $${budget.spentUsd} of today's $${budget.capUsd} cap: wait for the next UTC day or restart the worker`];
  return [];
}

/** Runs the gate over the worker's `/health` body for this plan's `--runtime` and cost cap. */
export function checkHealth(body: unknown, plan: Pick<SmokePlan, "runtime" | "maxCostUsd">): HealthVerdict {
  if (!isWorkerLine(body)) return verdict(plan.runtime, null, null, ["the body is not the worker's health line (no app \"north-worker\"): is NORTH_WORKER_URL the worker?"]);
  const parsed = HealthSchema.safeParse(body);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "body")))].join(", ");
    return verdict(plan.runtime, null, null, [`the worker is older than this smoke or its health line is malformed (${fields} missing or invalid): run the worker from this commit`]);
  }
  const h = parsed.data;
  const runtime = plan.runtime ?? (isRuntime(h.runtime) ? h.runtime : null);
  return verdict(runtime, h.profile, h.budget?.spentUsd ?? null, [...deploymentProblems(h), ...runtimeProblems(h, plan.runtime), ...budgetProblems(h, plan.maxCostUsd)]);
}

const SpendSchema = z.object({ budget: BudgetSchema.nullable() });

/** The gateway's day spend (`budget.spentUsd`) from a `/health` body read with Zod; null without a gateway or a well-formed budget. */
export function spentUsdOf(body: unknown): number | null {
  const parsed = SpendSchema.safeParse(body);
  return parsed.success ? (parsed.data.budget?.spentUsd ?? null) : null;
}
