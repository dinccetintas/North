import type { ActionSpec } from "@north/core";
import { z } from "zod";

/** `vars` key carrying the leads an `outreach_batch` run should contact (JSON array string, see `parseLeadsVar`). */
export const LEADS_VAR = "leads";

/** The most leads one outreach run receives (the worker passes the next unsent five). */
export const MAX_LEADS_VAR = 50;

/** One lead as the worker hands it over: the `leads` row id (so a send can mark it), the person and the reason. */
export const LeadVarSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  name: z.string().trim().min(1).max(120),
  email: z.email().max(254),
  company: z.string().max(120).default(""),
  why: z.string().max(500).default(""),
});
export type LeadVar = z.infer<typeof LeadVarSchema>;

const LeadsVarSchema = z.array(LeadVarSchema).max(MAX_LEADS_VAR);

/**
 * Reads `vars.leads`: a JSON array of `LeadVar`. Anything else (missing,
 * malformed, invalid rows, too many) yields an empty list so a fixture or
 * guide falls back rather than contacting a half-parsed address.
 */
export function parseLeadsVar(vars: Readonly<Record<string, string>> | undefined): readonly LeadVar[] {
  const raw = vars?.[LEADS_VAR];
  if (!raw) return Object.freeze([]);
  try {
    const parsed = LeadsVarSchema.safeParse(JSON.parse(raw));
    return Object.freeze(parsed.success ? parsed.data.map((l) => Object.freeze(l)) : []);
  } catch {
    return Object.freeze([]);
  }
}

/** One task for one role. The runtime never sees credentials. */
export interface AgentRunInput {
  readonly companyId: string;
  readonly taskId: string;
  readonly role: string;
  readonly taskType: string;
  readonly instructions: string;
  readonly memoryDigest: string;
  readonly workspaceDir: string;
  /** JSON schema the result must satisfy (Agent SDK outputFormat). */
  readonly outputSchema: Record<string, unknown>;
  /** Answer to a decision card when resuming a waiting task. */
  readonly resume?: { readonly sessionId: string; readonly cardId: string; readonly optionId: string };
  /** OBS-1: the worker tracer's trace for this run; echoed on the result and on every `onToolCall` event. */
  readonly traceId?: string;
  /**
   * Values for the role prompt placeholders ({{company.name}}, {{thesis}},
   * {{goals}}, {{budgets}}, {{quota}}) plus structured hand-overs encoded as
   * strings (parsers in `runtime/vars.ts`):
   * - `leads`: JSON `LeadVar[]`, the next unsent leads for `outreach_batch`
   *   (`parseLeadsVar`).
   * - `plan.previous`: JSON `PreviousPlanVar` ({ weekStart?, tasks: [{ taskType,
   *   title, status }] }), the latest plan for a `plan_week` rewrite
   *   (`parsePreviousPlanVar`); absent for a company's first plan.
   * - `ledger.report`: JSON `ChannelReportRow[]` (core `channelReport`) for the
   *   ledger entries since that plan (`parseLedgerReportVar`).
   * - `leads.count`: the company's free leads (not held by an open first-contact batch) as a string (`parseLeadsCountVar`).
   * - `site.url`: the live site, else the latest preview, else empty
   *   (`parseSiteUrlVar`).
   */
  readonly vars?: Readonly<Record<string, string>>;
}

export interface AgentRunUsage {
  readonly model: string;
  /** All input tokens of the run; the SDK runtime counts cache reads and writes in here too. */
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Tokens served from the prompt cache (priced at the cache-read rate). Optional at the type level only, so hand-built results stay valid: read with `?? 0`. The SDK runtime and the mock always set it. */
  readonly cacheReadTokens?: number;
  /** Tokens written to the prompt cache. Optional like `cacheReadTokens`. */
  readonly cacheWriteTokens?: number;
  readonly costUsd: number;
  readonly durationMs: number;
}

/**
 * Per-run facts both runtimes report next to the outcome (M6). Optional at the
 * type level only so results built by hand in tests stay valid: the mock and
 * the SDK runtime always set `sandboxMinutes`, and set `traceId` whenever the
 * input carried one. Read the minutes with `sandboxMinutesOf`.
 */
export interface AgentRunMeta {
  /** OBS-1: `AgentRunInput.traceId`, for the record-run step to store on `agent_runs.trace_id`. */
  readonly traceId?: string;
  /** BIL-2: wall-clock minutes of the agent subprocess (SDK runtime); 0 for the mock. Feeds `usage.sandbox_minutes`. */
  readonly sandboxMinutes?: number;
}

export type AgentRunResult = (
  | { readonly status: "succeeded"; readonly output: unknown; readonly actions: readonly ActionSpec[]; readonly sessionId: string; readonly usage: AgentRunUsage }
  | { readonly status: "waiting_decision"; readonly cardId: string; readonly sessionId: string; readonly usage: AgentRunUsage }
  | { readonly status: "failed"; readonly error: string; readonly sessionId: string | null; readonly usage: AgentRunUsage }
) &
  AgentRunMeta;

export interface AgentRuntime {
  readonly name: "claude-agent-sdk" | "mock";
  run(input: AgentRunInput): Promise<AgentRunResult>;
}
