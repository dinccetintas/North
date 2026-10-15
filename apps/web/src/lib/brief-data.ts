import { latestBrief, listSignals, type DbClient } from "@north/db";
import { BriefSchema } from "@north/core/brief/types";
import { briefView, incidentView, signalDetail, signalRows, type BriefView, type IncidentData, type SignalDetailData, type SignalRowData } from "@/lib/brief-view";

/**
 * Every M5 read the web app makes against the WP-A5 repositories lives here,
 * under RLS (the owner's client; the worker alone writes `briefs` and
 * `signals`). Pages get view models, never rows.
 *
 * Repositories used (packages/db, WP-A5): `latestBrief(db, companyId)` →
 * `{ id, companyId, day, content, wordCount, createdAt } | null`;
 * `listSignals(db, companyId, { status?, kind?, sinceDays?, cardWeek?, limit? })`
 * → records with `convertedCardId` / `convertedTaskId`.
 */

export const SIGNALS_WINDOW_DAYS = 7;
export const SIGNALS_HOME_LIMIT = 10;
/** How far back the detail pages look for the signal behind a card or a task. */
const SIGNAL_LOOKUP_DAYS = 90;
const SIGNAL_LOOKUP_LIMIT = 200;

/** The newest brief as the panel shows it; null before the first one (BRF-1). The content is re-validated: a malformed row is no brief. */
export async function loadLatestBrief(db: DbClient, companyId: string): Promise<BriefView | null> {
  const record = await latestBrief(db, companyId);
  if (!record) return null;
  const parsed = BriefSchema.safeParse(record.content);
  return parsed.success ? briefView(parsed.data) : null;
}

/** The last seven days of signals for the home screen, newest first, at most ten (PRO-1). */
export async function loadRecentSignals(db: DbClient, companyId: string): Promise<readonly SignalRowData[]> {
  const rows = await listSignals(db, companyId, { sinceDays: SIGNALS_WINDOW_DAYS, limit: SIGNALS_HOME_LIMIT });
  return signalRows(rows);
}

/** The signal a `signal.pursue` card decides on, by the card id the worker wrote on the row; null when unknown. */
export async function signalForCard(db: DbClient, companyId: string, cardId: string): Promise<SignalDetailData | null> {
  const rows = await listSignals(db, companyId, { sinceDays: SIGNAL_LOOKUP_DAYS, limit: SIGNAL_LOOKUP_LIMIT });
  const signal = rows.find((s) => s.convertedCardId === cardId) ?? null;
  return signal ? signalDetail(signal) : null;
}

/** The Sentry issue behind a `fix_error` task (PRO-2): the `error` signal the task was opened from; null when unknown. */
export async function incidentForTask(db: DbClient, companyId: string, taskId: string): Promise<IncidentData | null> {
  const rows = await listSignals(db, companyId, { kind: ["error"], sinceDays: SIGNAL_LOOKUP_DAYS, limit: SIGNAL_LOOKUP_LIMIT });
  const signal = rows.find((s) => s.convertedTaskId === taskId) ?? null;
  return signal ? incidentView(signal) : null;
}
