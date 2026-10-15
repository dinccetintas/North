/** OUT-1: what did we do, what changed, what did it cost. Entries are append-only. */
export interface LedgerEntry {
  readonly taskId: string;
  readonly metricKey: string;
  readonly before: number;
  readonly after: number;
  readonly costUsd: number;
  readonly channel: string;
  readonly measuredAt: string;
}

export interface Attribution {
  readonly delta: number;
  /** Cost per unit of metric change; null when nothing changed. */
  readonly costPerUnit: number | null;
}

export function attribute(entry: Pick<LedgerEntry, "before" | "after" | "costUsd">): Attribution {
  const delta = entry.after - entry.before;
  return Object.freeze({ delta, costPerUnit: delta === 0 ? null : entry.costUsd / Math.abs(delta) });
}

/** A cumulative channel sample: the attributed metric and the spend so far for one campaign or batch. */
export interface CumulativeSample {
  readonly value: number;
  readonly spendUsd: number;
}

export interface WindowDelta {
  readonly before: number;
  readonly after: number;
  readonly costUsd: number;
}

/**
 * The ledger entry for one collection window from two cumulative samples:
 * `before`/`after` are the previous and current attributed values (0 before the
 * first window), `costUsd` the spend of the window (never negative: a provider
 * revising spend downwards costs nothing more).
 */
export function windowDelta(previous: CumulativeSample | null, current: CumulativeSample): WindowDelta {
  return Object.freeze({
    before: previous?.value ?? 0,
    after: current.value,
    costUsd: Math.max(0, current.spendUsd - (previous?.spendUsd ?? 0)),
  });
}

export interface ChannelReportRow {
  readonly channel: string;
  readonly metricKey: string;
  readonly totalDelta: number;
  readonly totalCostUsd: number;
  readonly entries: number;
  readonly verdict: "working" | "not_working" | "unknown";
}

/** PLN-2 input: which channels moved their metric per dollar, and which did not. */
export function channelReport(entries: readonly LedgerEntry[]): readonly ChannelReportRow[] {
  const groups = new Map<string, { channel: string; metricKey: string; delta: number; cost: number; n: number }>();
  for (const e of entries) {
    const key = `${e.channel}|${e.metricKey}`;
    const current = groups.get(key) ?? { channel: e.channel, metricKey: e.metricKey, delta: 0, cost: 0, n: 0 };
    groups.set(key, { ...current, delta: current.delta + (e.after - e.before), cost: current.cost + e.costUsd, n: current.n + 1 });
  }
  return Object.freeze(
    [...groups.values()].map((g) =>
      Object.freeze({
        channel: g.channel,
        metricKey: g.metricKey,
        totalDelta: g.delta,
        totalCostUsd: g.cost,
        entries: g.n,
        verdict: g.n < 2 ? "unknown" : g.delta > 0 ? "working" : "not_working",
      }),
    ),
  );
}
