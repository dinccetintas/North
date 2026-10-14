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
