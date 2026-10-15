import { channelReport, type ChannelReportRow } from "@north/core";
import { latestMetric, listActionsByKind, listLedgerEntries, type DbClient } from "@north/db";

/** How far back the channel report reads when the previous plan is older than that. */
export const REPORT_DAYS = 30;
const COLD_EMAIL = "cold_email";
const FIRST_CONTACT = "email.send.first_contact";

/**
 * PLN-2: the channel report the Chief of Staff plans from, `channelReport`
 * over the ledger entries since the previous plan. The reply collector
 * writes a ledger entry only when a window moved, so a batch that drew no
 * reply leaves the ledger silent; the report says it anyway from the action
 * log (executed first-contact sends) and the `email_replies` metric, so a
 * channel that did nothing is `not_working`, not unknown.
 */
export async function ledgerReport(db: DbClient, companyId: string, since: string | null): Promise<readonly ChannelReportRow[]> {
  const entries = await listLedgerEntries(db, companyId, { sinceDays: REPORT_DAYS, ...(since ? { sinceIso: since } : {}) });
  const rows = channelReport(entries.map((e) => ({ taskId: e.taskId ?? "", metricKey: e.metricKey, before: e.before, after: e.after, costUsd: e.costUsd, channel: e.channel, measuredAt: e.createdAt })));
  if (rows.some((r) => r.channel === COLD_EMAIL && r.metricKey === "email_replies")) return rows;
  const sends = (await listActionsByKind(db, companyId, FIRST_CONTACT, REPORT_DAYS)).filter((a) => a.status === "executed" && (since === null || a.createdAt >= since)).length;
  if (sends === 0) return rows;
  const replies = (await latestMetric(db, companyId, "email_replies"))?.value ?? 0;
  const verdict: ChannelReportRow["verdict"] = sends < 2 ? "unknown" : replies > 0 ? "working" : "not_working";
  return Object.freeze([
    ...rows,
    Object.freeze({ channel: COLD_EMAIL, metricKey: "emails_sent", totalDelta: sends, totalCostUsd: 0, entries: sends, verdict }),
    Object.freeze({ channel: COLD_EMAIL, metricKey: "email_replies", totalDelta: replies, totalCostUsd: 0, entries: sends, verdict }),
  ]);
}
