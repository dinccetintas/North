import { OUTCOME_METRIC_KEYS, SIGNAL_SCORE_BATCH, SIGNAL_THRESHOLD, SignalCandidateSchema, detectMetricDrops, isHttpUrl, localDay, metricDropCandidate, signalQueries, type DispatchBlockReason, type SignalCandidate } from "@north/core";
import { scoreSignals } from "@north/agents";
import { companyOwnerId, currentThesis, getProfile, insertSignals, knownSourceRefs, listMemoryItems, listSignals, metricSeries, updateSignal, type MemoryItemRecord } from "@north/db";
import { NotConfiguredError, SIGNAL_SOURCE_IDS, type SignalSource } from "@north/integrations";
import type { WorkerDeps } from "../deps";
import { dispatchAllowed } from "./entitlements";
import { convertSignals, type ConvertResult } from "./signal-cards";
import type { StepRunner } from "./steps";

/** The window a scan looks back over; the sandbox sources ignore it, the live ones filter on it. */
const SCAN_WINDOW_DAYS = 7;
/** How far back the metric drop detector reads company-scope samples. */
const DROP_WINDOW_DAYS = 14;
const METRIC_DROP_SCORE = 0.75;
const MAX_COMPETITOR_URLS = 10;
const MAX_COMMUNITIES = 10;
const COMPETITOR_RE = /competitor/i;
const URL_RE = /https?:\/\/[^\s)>"']+/g;
const SUBREDDIT_RE = /\br\/[A-Za-z0-9_]{2,30}\b/g;

export interface ScanContext {
  readonly thesis: string;
  readonly queries: readonly string[];
  readonly communities: readonly string[];
  readonly competitorUrls: readonly string[];
  /** Every source reference the company already has, read once before the sources run: a scan advances the sandbox progression by one step, and a rescan re-inserts nothing. */
  readonly knownRefs: readonly string[];
  readonly timezone: string;
  /** The owner-local day of the scan: the metric-drop reference and the card week key. */
  readonly day: string;
  readonly since: string;
}

const MAX_KNOWN_REFS = 500;

/** Competitor pages the research memory recorded: http(s) URLs in items that mention competitors, deduped, bounded. */
export function competitorUrlsFromMemory(items: readonly MemoryItemRecord[]): readonly string[] {
  const urls = items
    .filter((m) => COMPETITOR_RE.test(m.title) || COMPETITOR_RE.test(m.content))
    .flatMap((m) => `${m.title}\n${m.content}`.match(URL_RE) ?? [])
    .map((u) => u.replace(/[.,;]+$/, ""))
    .filter((u) => isHttpUrl(u));
  return Object.freeze([...new Set(urls)].slice(0, MAX_COMPETITOR_URLS));
}

/** Where the personas gather, as the persona memory names them (`r/<name>` tokens); the sandbox sources ignore this. */
export function communitiesFromMemory(items: readonly MemoryItemRecord[]): readonly string[] {
  const names = items.filter((m) => m.kind === "persona").flatMap((m) => m.content.match(SUBREDDIT_RE) ?? []);
  return Object.freeze([...new Set(names)].slice(0, MAX_COMMUNITIES));
}

/** Step 1: thesis, personas and competitor URLs from memory → the queries and the scan window. */
export async function scanContext(deps: WorkerDeps, companyId: string): Promise<ScanContext> {
  const { db } = deps;
  const now = deps.clock();
  const [thesis, items, ownerId] = await Promise.all([currentThesis(db, companyId), listMemoryItems(db, companyId, 200), companyOwnerId(db, companyId)]);
  const timezone = (await getProfile(db, ownerId))?.timezone ?? "UTC";
  const personas = items.filter((m) => m.kind === "persona").map((m) => `${m.title} ${m.content}`);
  const text = [thesis?.text ?? "", thesis?.targetCustomer ?? ""].join(" ");
  const known = new Set<string>();
  for (const source of SIGNAL_SOURCE_IDS) for (const ref of await knownSourceRefs(db, companyId, source)) known.add(ref);
  return Object.freeze({
    thesis: thesis?.text ?? "",
    queries: signalQueries(text, personas),
    communities: communitiesFromMemory(items),
    competitorUrls: competitorUrlsFromMemory(items),
    knownRefs: Object.freeze([...known].slice(0, MAX_KNOWN_REFS)),
    timezone,
    day: localDay(timezone, now),
    since: new Date(now.getTime() - SCAN_WINDOW_DAYS * 86_400_000).toISOString(),
  });
}

export interface SourceScan {
  readonly source: SignalSource["id"];
  readonly candidates: number;
  readonly inserted: number;
  /** Why the source gave nothing: `NotConfiguredError`'s reason or a provider failure; null when it ran. */
  readonly skipped: string | null;
}

const explain = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause)).slice(0, 300);

/**
 * Step 2, one per source: the adapter's candidates (validated one by one;
 * an invalid one is dropped, never the batch) inserted `new`, duplicates
 * ignored by `(company, source, source_ref)`. A source that is not
 * configured or that fails is logged and yields nothing; the scan goes on.
 */
export async function scanSource(deps: WorkerDeps, companyId: string, source: SignalSource, context: ScanContext): Promise<SourceScan> {
  let raw: readonly SignalCandidate[];
  try {
    raw = await source.scan({ companyId, queries: [...context.queries], communities: [...context.communities], competitorUrls: [...context.competitorUrls], knownRefs: [...context.knownRefs], since: context.since });
  } catch (cause) {
    const reason = cause instanceof NotConfiguredError ? `not configured: ${explain(cause)}` : `provider error: ${explain(cause)}`;
    console.warn(`[signals] ${source.id} for ${companyId}: ${reason}`);
    return { source: source.id, candidates: 0, inserted: 0, skipped: reason };
  }
  const candidates = raw.flatMap((c) => {
    const parsed = SignalCandidateSchema.safeParse(c);
    return parsed.success && parsed.data.source === source.id ? [parsed.data] : [];
  });
  const inserted = candidates.length > 0 ? await insertSignals(deps.db, companyId, candidates, { kind: "opportunity" }) : [];
  return { source: source.id, candidates: candidates.length, inserted: inserted.length, skipped: null };
}

/** Step 3: `detectMetricDrops` over the last 14 days of company-scope samples → `metric_drop` rows, scored by rule, one per key and day. */
export async function detectDrops(deps: WorkerDeps, companyId: string, day: string): Promise<readonly string[]> {
  const series = [];
  for (const key of OUTCOME_METRIC_KEYS) series.push({ key, points: await metricSeries(deps.db, companyId, key, DROP_WINDOW_DAYS) });
  const drops = detectMetricDrops(series);
  if (drops.length === 0) return Object.freeze([]);
  return insertSignals(deps.db, companyId, drops.map((d) => metricDropCandidate(d, day)), { kind: "metric_drop", score: METRIC_DROP_SCORE, status: "scored" });
}

export interface ScoreResult {
  readonly scored: number;
  readonly belowThreshold: number;
}

/** Step 4: the `new` opportunity rows (≤ 20, oldest first) in one `scoreSignals` call; at or above the threshold → `scored`, below → `below_threshold`. */
export async function scoreNewSignals(deps: WorkerDeps, companyId: string, context: ScanContext): Promise<ScoreResult> {
  const rows = [...(await listSignals(deps.db, companyId, { status: ["new"], kind: ["opportunity"], limit: SIGNAL_SCORE_BATCH }))].reverse();
  if (rows.length === 0) return { scored: 0, belowThreshold: 0 };
  const candidates = rows.map((r) => ({ id: r.id, source: r.source, sourceRef: r.sourceRef, title: r.title, excerpt: r.excerpt, url: r.url, observedAt: r.observedAt }));
  const scores = await scoreSignals(candidates, { thesis: context.thesis, keywords: context.queries, now: deps.clock() }, deps.llm);
  let scored = 0;
  for (const s of scores) {
    const above = s.score >= SIGNAL_THRESHOLD;
    await updateSignal(deps.db, companyId, s.id, { status: above ? "scored" : "below_threshold", score: s.score, summary: s.summary, rationale: s.rationale });
    if (above) scored += 1;
  }
  return { scored, belowThreshold: scores.length - scored };
}

export interface ScanResult {
  readonly queries: readonly string[];
  readonly sources: readonly SourceScan[];
  readonly drops: number;
  readonly scoring: ScoreResult;
  readonly converted: ConvertResult;
}

/** ADR 0014: the scan did not run (kill switch, ended subscription, no credits) and inserted nothing. */
export interface ScanSkipped {
  readonly skipped: DispatchBlockReason;
}

/** PRO-1, one company's scan: dispatch check → context → every source its own step → drops → score → convert (at most one card). */
export async function scanCompanySignals(deps: WorkerDeps, step: StepRunner, companyId: string): Promise<ScanResult | ScanSkipped> {
  const allowed = await step.run("dispatch-allowed", () => dispatchAllowed(deps, companyId));
  if (!allowed.ok) return Object.freeze({ skipped: allowed.reason });
  const context = await step.run("context", () => scanContext(deps, companyId));
  const sources: SourceScan[] = [];
  for (const source of deps.integrations.signals) sources.push(await step.run(`scan-${source.id}`, () => scanSource(deps, companyId, source, context)));
  const drops = await step.run("detect-drops", () => detectDrops(deps, companyId, context.day));
  const scoring = await step.run("score", () => scoreNewSignals(deps, companyId, context));
  const converted = await step.run("convert", () => convertSignals(deps, companyId, context.day));
  return Object.freeze({ queries: context.queries, sources, drops: drops.length, scoring, converted });
}
