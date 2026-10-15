import { z } from "zod";
import { capExceeded, effectiveDailyLimit, type BudgetState } from "@north/core/budget/guard";
import { formatNumber, formatUsd } from "./labels";

/**
 * OUT-1 view models for the ledger page. Pure: the page loads records, these
 * functions shape them, the components render them. The input types are
 * structural so the db records (WP-A4) satisfy them without a dependency.
 */

export interface BudgetRowData {
  readonly category: string;
  readonly spentTodayUsd: number;
  /** Today's cap including a cap card's raise for the day (BUD-3). */
  readonly dailyCapUsd: number;
  readonly spentTotalUsd: number;
  readonly totalCapUsd: number;
  readonly state: "ok" | "cap_reached";
}

export function budgetRows(budgets: readonly BudgetState[]): readonly BudgetRowData[] {
  return Object.freeze(
    budgets.map((b) => {
      const cap = capExceeded(b);
      return Object.freeze({
        category: b.category,
        spentTodayUsd: b.spentTodayUsd,
        dailyCapUsd: effectiveDailyLimit(b),
        spentTotalUsd: b.spentTotalUsd,
        totalCapUsd: b.totalLimitUsd,
        state: cap.daily || cap.total ? ("cap_reached" as const) : ("ok" as const),
      });
    }),
  );
}

export interface CampaignLike {
  readonly id: string;
  readonly providerCampaignId: string;
  readonly name: string;
  readonly status: string;
  readonly dailyBudgetUsd: number;
  readonly spentTodayUsd: number;
  readonly spentTotalUsd: number;
  readonly impressions: number;
  readonly clicks: number;
  readonly conversions: number;
  readonly sandbox: boolean;
}

export interface TaskLike {
  readonly id: string;
  readonly title: string;
}

export interface LedgerEntryLike {
  readonly id: string;
  readonly taskId: string | null;
  readonly metricKey: string;
  readonly before: number;
  readonly after: number;
  readonly costUsd: number;
  readonly channel: string;
  readonly createdAt: string;
  readonly campaignId?: string | null;
  readonly provenance?: unknown;
}

/** Lenient read of the entry's provenance: the shape is core's `ProvenanceSchema`, but a chip never fails a page. */
const ProvenanceLikeSchema = z
  .object({
    campaignId: z.string().optional(),
    batchId: z.string().optional(),
    sandbox: z.boolean().optional(),
    raw: z.record(z.string(), z.unknown()).optional(),
  })
  .loose();

const readProvenance = (value: unknown) => {
  const parsed = ProvenanceLikeSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);
const plural = (n: number, word: string): string => `${formatNumber(n)} ${word}${n === 1 ? "" : "s"}`;

/** "$4.00 spend · 800 impressions · 12 clicks · 1 conversion · sandbox": the provider's figures behind one entry. */
export function provenanceChips(provenance: unknown): readonly string[] {
  const p = readProvenance(provenance);
  if (!p) return Object.freeze([]);
  const raw = p.raw ?? {};
  const spend = num(raw.spendUsd) ?? num(raw.spend);
  const chips = [
    spend !== null ? `${formatUsd(spend)} spend` : null,
    num(raw.impressions) !== null ? plural(num(raw.impressions) ?? 0, "impression") : null,
    num(raw.clicks) !== null ? plural(num(raw.clicks) ?? 0, "click") : null,
    num(raw.conversions) !== null ? plural(num(raw.conversions) ?? 0, "conversion") : null,
    num(raw.replies) !== null ? plural(num(raw.replies) ?? 0, "reply").replace("replys", "replies") : null,
    p.sandbox ? "sandbox" : null,
  ];
  return Object.freeze(chips.filter((c): c is string => c !== null));
}

/** The campaign row an entry belongs to, by the entry's `campaignId` or its provenance's provider id. */
export function campaignIdOf(entry: LedgerEntryLike, campaigns: readonly CampaignLike[]): string | null {
  const provenanceId = readProvenance(entry.provenance)?.campaignId ?? null;
  const found = campaigns.find((c) => c.id === entry.campaignId || (provenanceId !== null && (c.providerCampaignId === provenanceId || c.id === provenanceId)));
  return found?.id ?? null;
}

export interface LedgerRowData {
  readonly id: string;
  readonly createdAt: string;
  readonly channel: string;
  readonly metricKey: string;
  /** The campaign or batch the entry came from. */
  readonly what: string;
  readonly taskTitle: string | null;
  readonly before: number;
  readonly after: number;
  readonly delta: number;
  readonly costUsd: number;
  readonly chips: readonly string[];
}

const batchIdOf = (entry: LedgerEntryLike): string | null => readProvenance(entry.provenance)?.batchId ?? null;

export function ledgerRows(entries: readonly LedgerEntryLike[], campaigns: readonly CampaignLike[], tasks: readonly TaskLike[]): readonly LedgerRowData[] {
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  return Object.freeze(
    entries.map((e) => {
      const campaignId = campaignIdOf(e, campaigns);
      const campaignName = campaignId ? (campaigns.find((c) => c.id === campaignId)?.name ?? null) : null;
      const batchId = batchIdOf(e);
      return Object.freeze({
        id: e.id,
        createdAt: e.createdAt,
        channel: e.channel,
        metricKey: e.metricKey,
        what: campaignName ?? (batchId ? `Batch ${batchId}` : e.channel.replace(/_/g, " ")),
        taskTitle: e.taskId ? (titles.get(e.taskId) ?? null) : null,
        before: e.before,
        after: e.after,
        delta: e.after - e.before,
        costUsd: e.costUsd,
        chips: provenanceChips(e.provenance),
      });
    }),
  );
}

export interface ActionLike {
  readonly id: string;
  readonly taskId: string | null;
  readonly status: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly externalRef: string | null;
  readonly createdAt: string;
}

export interface OutreachRowData {
  readonly batchId: string;
  readonly taskTitle: string | null;
  readonly sent: number;
  /** Cumulative replies, from the batch's latest `cold_email` ledger entry. */
  readonly replies: number;
  readonly lastSentAt: string | null;
}

interface BatchGroup {
  readonly key: string;
  readonly taskId: string | null;
  readonly batchId: string | null;
  readonly sends: readonly ActionLike[];
}

/** A send's batch is its `payload.batchId`; a transition row (which carries no payload) still groups by its task. */
function groupSends(actions: readonly ActionLike[]): readonly BatchGroup[] {
  const groups = new Map<string, BatchGroup>();
  for (const a of actions) {
    const batchId = typeof a.payload.batchId === "string" && a.payload.batchId.length > 0 ? a.payload.batchId : null;
    const key = batchId ?? `task:${a.taskId ?? a.id}`;
    const current = groups.get(key) ?? { key, taskId: a.taskId, batchId, sends: [] };
    groups.set(key, { ...current, batchId: current.batchId ?? batchId, sends: [...current.sends, a] });
  }
  return [...groups.values()];
}

const latestFirst = (a: { createdAt: string }, b: { createdAt: string }): number => b.createdAt.localeCompare(a.createdAt);

export function outreachRows(actions: readonly ActionLike[], entries: readonly LedgerEntryLike[], tasks: readonly TaskLike[]): readonly OutreachRowData[] {
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  const mailEntries = [...entries].filter((e) => e.channel === "cold_email").sort(latestFirst);
  return Object.freeze(
    groupSends(actions).map((g) => {
      const entry = mailEntries.find((e) => (g.batchId !== null && batchIdOf(e) === g.batchId) || (g.taskId !== null && e.taskId === g.taskId)) ?? null;
      const executed = g.sends.filter((a) => a.status === "executed");
      const last = [...executed].sort(latestFirst)[0] ?? null;
      return Object.freeze({
        batchId: g.batchId ?? (entry ? batchIdOf(entry) : null) ?? g.taskId ?? g.key,
        taskTitle: g.taskId ? (titles.get(g.taskId) ?? null) : null,
        sent: executed.length,
        replies: entry?.after ?? 0,
        lastSentAt: last?.createdAt ?? null,
      });
    }),
  );
}
