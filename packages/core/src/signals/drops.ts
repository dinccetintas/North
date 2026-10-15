import type { SignalCandidate } from "./types";

/**
 * PRO-1 `metric_drop`: the latest company-scope value of an outcome metric
 * against its value seven days earlier. No model, no new table.
 */
export interface DropOptions {
  readonly windowDays: number;
  /** The drop, as a share of the base, that fires: 0.3 = 30 %. */
  readonly minDrop: number;
  /** A base below this never fires (10 → 7 is noise). */
  readonly minBase: number;
}

export const DEFAULT_DROP_OPTIONS: DropOptions = Object.freeze({ windowDays: 7, minDrop: 0.3, minBase: 10 });

export interface MetricPoint {
  readonly measuredAt: string;
  readonly value: number;
}

export interface MetricSeries {
  readonly key: string;
  readonly points: readonly MetricPoint[];
}

export interface MetricDrop {
  readonly key: string;
  readonly base: number;
  readonly latest: number;
  readonly dropRatio: number;
  readonly baseAt: string;
  readonly latestAt: string;
}

const DAY_MS = 86_400_000;
const EPSILON = 1e-9;

const byTime = (a: MetricPoint, b: MetricPoint): number => Date.parse(a.measuredAt) - Date.parse(b.measuredAt);

/** The latest point at or before the window boundary, else the oldest point of the series. */
function basePoint(sorted: readonly MetricPoint[], latest: MetricPoint, windowDays: number): MetricPoint | undefined {
  const boundary = Date.parse(latest.measuredAt) - windowDays * DAY_MS;
  const within = sorted.filter((p) => Date.parse(p.measuredAt) <= boundary);
  return within[within.length - 1] ?? sorted[0];
}

function dropOf(series: MetricSeries, options: DropOptions): MetricDrop | null {
  const sorted = [...series.points].sort(byTime);
  const latest = sorted[sorted.length - 1];
  const base = latest ? basePoint(sorted, latest, options.windowDays) : undefined;
  if (!latest || !base || base === latest || base.value < options.minBase) return null;
  const dropRatio = (base.value - latest.value) / base.value;
  if (dropRatio + EPSILON < options.minDrop) return null;
  return Object.freeze({ key: series.key, base: base.value, latest: latest.value, dropRatio, baseAt: base.measuredAt, latestAt: latest.measuredAt });
}

/** The series that fell by at least `minDrop` from a base of at least `minBase`; points may arrive in any order. */
export function detectMetricDrops(series: readonly MetricSeries[], options: DropOptions = DEFAULT_DROP_OPTIONS): readonly MetricDrop[] {
  return Object.freeze(series.map((s) => dropOf(s, options)).filter((d): d is MetricDrop => d !== null));
}

const daysBetween = (fromIso: string, toIso: string): number => Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS);

/** "site_visitors fell 40% in a week (100 → 60)": the candidate a drop inserts, keyed `metrics:<key>:<day>` so one day fires once. */
export function metricDropCandidate(drop: MetricDrop, day: string): SignalCandidate {
  const days = daysBetween(drop.baseAt, drop.latestAt);
  const span = days === 7 ? "in a week" : days === 1 ? "in a day" : `in ${days} days`;
  return Object.freeze({
    source: "metrics",
    sourceRef: `metrics:${drop.key}:${day}`,
    title: `${drop.key} fell ${Math.round(drop.dropRatio * 100)}% ${span} (${drop.base} → ${drop.latest})`,
    excerpt: `Company-scope ${drop.key}: ${drop.base} at ${drop.baseAt}, ${drop.latest} at ${drop.latestAt}.`,
    url: null,
    observedAt: drop.latestAt,
    baseline: false,
  });
}
