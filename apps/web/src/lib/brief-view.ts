import { z } from "zod";
import { briefMarkdown, SIGNAL_STATUS_WORDS } from "@north/core/brief/compose";
import type { Brief } from "@north/core/brief/types";
import { BRIEF_HOUR } from "@north/core/time";
import { isHttpUrl } from "@north/core/url";

/**
 * BRF-1 view models for the home screen. Pure: the loader validates the
 * `briefs.content` row with core `BriefSchema`, these functions shape it, the
 * `BriefPanel` renders it. Every title, question and excerpt stays text.
 */

export interface BriefMetricRow {
  readonly key: string;
  readonly value: number;
  readonly previous: number | null;
  /** value − previous; null when there is no previous reading. */
  readonly delta: number | null;
}

export interface BriefSignalRow {
  readonly id: string;
  readonly title: string;
  readonly source: string;
  readonly score: number;
  readonly status: string;
  readonly statusWord: string;
}

export interface BriefView {
  readonly day: string;
  readonly companyName: string;
  readonly stopped: boolean;
  /** The first line of the markdown without its heading marker. */
  readonly headline: string;
  readonly wordCount: number;
  readonly yesterday: readonly string[];
  readonly metrics: readonly BriefMetricRow[];
  readonly goal: Brief["goal"];
  readonly decisions: Brief["decisions"];
  readonly today: Brief["today"];
  readonly spend: Brief["spend"];
  readonly signals: readonly BriefSignalRow[];
  readonly escalations: readonly string[];
}

const HEADING = /^#+\s*/;
const BULLET = /^-\s+/;

/** The bullet lines of one `## <title>` section of the brief's markdown, without their markers; [] when absent. */
export function markdownSection(markdown: string, title: string): readonly string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line === `## ${title}`);
  if (start < 0) return Object.freeze([]);
  const body = lines.slice(start + 1);
  const end = body.findIndex((line) => line.startsWith("## "));
  const section = (end < 0 ? body : body.slice(0, end)).filter((line) => line.trim().length > 0);
  return Object.freeze(section.map((line) => line.replace(BULLET, "")));
}

export function briefView(brief: Brief): BriefView {
  const markdown = briefMarkdown(brief);
  const headline = (markdown.split("\n")[0] ?? "").replace(HEADING, "");
  return Object.freeze({
    day: brief.day,
    companyName: brief.companyName,
    stopped: brief.stopped,
    headline,
    wordCount: brief.wordCount,
    yesterday: markdownSection(markdown, "Yesterday"),
    metrics: Object.freeze(brief.metrics.map((m) => Object.freeze({ key: m.key, value: m.value, previous: m.previous, delta: m.previous === null ? null : m.value - m.previous }))),
    goal: brief.goal,
    decisions: brief.decisions,
    today: brief.today,
    spend: brief.spend,
    signals: Object.freeze(brief.signals.map((s) => Object.freeze({ ...s, statusWord: SIGNAL_STATUS_WORDS[s.status] }))),
    escalations: Object.freeze(brief.escalations.map((e) => e.title)),
  });
}

/** "n words" for the panel's footer. */
export function wordsLabel(count: number): string {
  return `${count} ${count === 1 ? "word" : "words"}`;
}

/** The empty state: when the first brief lands, in the owner's zone. */
export function briefEmptyText(timezone: string): string {
  return `Your first brief arrives at ${String(BRIEF_HOUR).padStart(2, "0")}:00 ${timezone}`;
}

/** "+3" / "−2" / "0" for a metric's change since the previous reading. */
export function signedDelta(delta: number): string {
  if (delta > 0) return `+${delta}`;
  if (delta < 0) return `−${Math.abs(delta)}`;
  return "0";
}

/* ---------- signals (PRO-1) ---------- */

/** The signal row as the db repository hands it (structural, so the record needs no cast). */
export interface SignalLike {
  readonly id: string;
  readonly kind: string;
  readonly source: string;
  readonly title: string;
  readonly url: string | null;
  readonly excerpt: string;
  readonly score: number;
  readonly status: string;
  readonly summary?: string | null;
  readonly rationale?: string | null;
  readonly convertedCardId?: string | null;
  readonly convertedTaskId?: string | null;
  readonly payload?: unknown;
}

export interface SignalRowData {
  readonly id: string;
  readonly kind: string;
  readonly source: string;
  readonly status: string;
  readonly title: string;
  readonly score: number;
  readonly cardId: string | null;
}

export function signalRows(signals: readonly SignalLike[]): readonly SignalRowData[] {
  return Object.freeze(
    signals.map((s) =>
      Object.freeze({ id: s.id, kind: s.kind, source: s.source, status: s.status, title: s.title, score: s.score, cardId: s.convertedCardId ?? null }),
    ),
  );
}

export interface SignalDetailData {
  readonly id: string;
  readonly source: string;
  readonly score: number;
  readonly title: string;
  /** Shown as text, never as HTML: the fixture carries a literal `<b>` to prove it. */
  readonly excerpt: string;
  readonly summary: string | null;
  /** http(s) URLs only; anything else is dropped before it can become a link. */
  readonly evidence: readonly string[];
}

export function signalDetail(signal: SignalLike): SignalDetailData {
  const text = (value: string | null | undefined): string | null => (value && value.trim().length > 0 ? value.trim() : null);
  return Object.freeze({
    id: signal.id,
    source: signal.source,
    score: signal.score,
    title: signal.title,
    excerpt: signal.excerpt,
    summary: text(signal.summary) ?? text(signal.rationale),
    evidence: Object.freeze([signal.url].filter((u): u is string => isHttpUrl(u))),
  });
}

/** Two decimals, no trailing zero noise: 0.85 → "0.85", 1 → "1.00". */
export function scoreLabel(score: number): string {
  return score.toFixed(2);
}

/* ---------- incidents (PRO-2) ---------- */

/** Lenient read of the facts the webhook stored next to the sanitised title; a missing field never fails the page. */
const IncidentPayloadSchema = z
  .object({
    shortId: z.string().max(64).optional(),
    level: z.string().max(20).optional(),
    culprit: z.string().max(200).optional(),
    permalink: z.string().max(2048).optional(),
  })
  .loose();

export interface IncidentData {
  readonly signalId: string;
  readonly title: string;
  readonly shortId: string | null;
  readonly level: string | null;
  readonly culprit: string | null;
  /** The Sentry issue page; https only, else null. */
  readonly permalink: string | null;
  readonly status: string;
}

const nonEmpty = (value: string | undefined): string | null => (value && value.trim().length > 0 ? value.trim() : null);

/** The webhook stores the issue under `payload.issue`; older or hand-written rows may carry the facts at the root. */
function incidentFacts(payload: unknown): z.infer<typeof IncidentPayloadSchema> {
  const nested = payload !== null && typeof payload === "object" && "issue" in payload ? (payload as { issue?: unknown }).issue : undefined;
  const parsed = IncidentPayloadSchema.safeParse(nested ?? payload ?? {});
  return parsed.success ? parsed.data : {};
}

/** The sanitised issue facts of an `error` signal (source `sentry`); the title is text, never HTML. */
export function incidentView(signal: SignalLike): IncidentData {
  const payload = incidentFacts(signal.payload);
  const permalink = [signal.url, payload.permalink].find((u): u is string => isHttpUrl(u) && u.startsWith("https://")) ?? null;
  return Object.freeze({
    signalId: signal.id,
    title: signal.title,
    shortId: nonEmpty(payload.shortId),
    level: nonEmpty(payload.level),
    culprit: nonEmpty(payload.culprit) ?? nonEmpty(signal.excerpt),
    permalink,
    status: signal.status,
  });
}
