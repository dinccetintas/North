import { z } from "zod";
import { TASK_STATUSES, TASK_TYPES, isHttpUrl, type ChannelReportRow } from "@north/core";

/**
 * Structured hand-overs the worker encodes as strings in `AgentRunInput.vars`
 * (M5, PLN-2). Every parser is strict at the boundary and returns the empty
 * value for anything missing or malformed, so a fixture or a guide falls back
 * rather than planning on half-parsed data.
 */

/** `vars["plan.previous"]`: the previous plan's tasks (type, title, status) and its week, as JSON `PreviousPlanVar`. */
export const PLAN_PREVIOUS_VAR = "plan.previous";
/** `vars["ledger.report"]`: `channelReport` rows for the ledger entries since the previous plan, as JSON `ChannelReportRow[]`. */
export const LEDGER_REPORT_VAR = "ledger.report";
/** `vars["leads.count"]`: how many leads the company has (a non-negative integer as a string). */
export const LEADS_COUNT_VAR = "leads.count";
/** `vars["site.url"]`: the live site, else the latest preview, else empty. */
export const SITE_URL_VAR = "site.url";

export const MAX_PREVIOUS_TASKS = 50;
export const MAX_REPORT_ROWS = 100;

export const PreviousTaskVarSchema = z.object({
  taskType: z.enum(TASK_TYPES),
  title: z.string().max(200).default(""),
  status: z.enum(TASK_STATUSES),
});
export type PreviousTaskVar = z.infer<typeof PreviousTaskVarSchema>;

export const PreviousPlanVarSchema = z.object({
  /** Monday of the previous plan's week (`YYYY-MM-DD`); named in revision reasons when present. */
  weekStart: z.iso.date().optional(),
  tasks: z.array(PreviousTaskVarSchema).max(MAX_PREVIOUS_TASKS),
});
export interface PreviousPlanVar {
  readonly weekStart?: string | undefined;
  readonly tasks: readonly PreviousTaskVar[];
}

export const ChannelReportRowSchema = z.object({
  channel: z.string().min(1).max(40),
  metricKey: z.string().min(1).max(40),
  totalDelta: z.number(),
  totalCostUsd: z.number(),
  entries: z.number().int().nonnegative(),
  verdict: z.enum(["working", "not_working", "unknown"]),
});

const LedgerReportVarSchema = z.array(ChannelReportRowSchema).max(MAX_REPORT_ROWS);

type Vars = Readonly<Record<string, string>> | undefined;

function parseJsonVar<T>(vars: Vars, key: string, schema: z.ZodType<T>): T | null {
  const raw = vars?.[key];
  if (!raw) return null;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** The previous plan, or null when absent or malformed (the fixture then writes a first plan). */
export function parsePreviousPlanVar(vars: Vars): PreviousPlanVar | null {
  const plan = parseJsonVar(vars, PLAN_PREVIOUS_VAR, PreviousPlanVarSchema);
  return plan ? Object.freeze({ ...plan, tasks: Object.freeze(plan.tasks.map((t) => Object.freeze(t))) }) : null;
}

/** The channel report rows, or an empty list. */
export function parseLedgerReportVar(vars: Vars): readonly ChannelReportRow[] {
  const rows = parseJsonVar(vars, LEDGER_REPORT_VAR, LedgerReportVarSchema);
  return Object.freeze((rows ?? []).map((r) => Object.freeze(r)));
}

/** The lead count, or 0 for anything that is not a non-negative integer. */
export function parseLeadsCountVar(vars: Vars): number {
  const raw = vars?.[LEADS_COUNT_VAR];
  return raw !== undefined && /^\d{1,9}$/.test(raw.trim()) ? Number(raw.trim()) : 0;
}

/** The site URL when it is an http(s) URL, else null. */
export function parseSiteUrlVar(vars: Vars): string | null {
  const raw = vars?.[SITE_URL_VAR]?.trim();
  return raw && isHttpUrl(raw) ? raw : null;
}
