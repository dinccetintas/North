import type { SignalStatus } from "../signals/types";
import { firstWords, wordCount } from "../text";
import { BRIEF_LIST_MAX, BRIEF_MAX_WORDS, type Brief, type BriefInput, type BriefSignal } from "./types";

/** How a signal's status reads in the brief (the web uses the same words). */
export const SIGNAL_STATUS_WORDS: Readonly<Record<SignalStatus, string>> = Object.freeze({
  new: "new",
  scored: "scored",
  below_threshold: "below threshold",
  card_opened: "card open",
  deferred: "deferred",
  capped: "held for next week",
  approved: "approved",
  declined: "declined",
  converted: "fix opened",
});

/** Signals that need the CEO's eye come first when the list is trimmed. */
const SIGNAL_PRIORITY: Readonly<Record<SignalStatus, number>> = Object.freeze({
  card_opened: 0,
  capped: 1,
  deferred: 2,
  approved: 3,
  converted: 4,
  scored: 5,
  new: 6,
  below_threshold: 7,
  declined: 8,
});

const TITLE_WORDS = 6;
const QUESTION_WORDS = 6;

const usd = (value: number): string => `$${Math.round(value * 100) / 100}`;
const signed = (value: number): string => (value >= 0 ? `+${value}` : `${value}`);
const bullets = (lines: readonly string[], empty: string): readonly string[] => (lines.length === 0 ? [empty] : lines.map((line) => `- ${line}`));

interface OutcomeGroup {
  readonly metricKey: string;
  readonly channel: string | null;
  readonly delta: number;
  readonly costUsd: number;
  readonly what: string;
}

/** Outcomes grouped by metric and channel: "signups +3 ($12, meta_ads): Launch test" — the ledger's numbers, one line per source. */
function outcomeLines(outcomes: Brief["yesterday"]["outcomes"]): readonly string[] {
  const groups = outcomes.reduce<readonly OutcomeGroup[]>((acc, o) => {
    const index = acc.findIndex((g) => g.metricKey === o.metricKey && g.channel === o.channel);
    const existing = acc[index];
    if (!existing) return [...acc, { metricKey: o.metricKey, channel: o.channel, delta: o.delta, costUsd: o.costUsd, what: o.what }];
    return acc.with(index, { ...existing, delta: existing.delta + o.delta, costUsd: existing.costUsd + o.costUsd });
  }, []);
  return groups.map((g) => {
    const tags = [g.costUsd > 0 ? usd(g.costUsd) : null, g.channel].filter((t): t is string => t !== null);
    const detail = tags.length > 0 ? ` (${tags.join(", ")})` : "";
    return `${g.metricKey} ${signed(g.delta)}${detail}: ${firstWords(g.what, TITLE_WORDS)}`;
  });
}

/** Actions grouped by kind and status: "5 × email.send.first_contact executed"; a single one keeps its description. */
function actionLines(actions: Brief["yesterday"]["actions"]): readonly string[] {
  const keys = [...new Set(actions.map((a) => `${a.kind} ${a.status}`))];
  return keys.map((key) => {
    const group = actions.filter((a) => `${a.kind} ${a.status}` === key);
    const first = group[0];
    return group.length === 1 && first ? `${key}: ${firstWords(first.description, TITLE_WORDS)}` : `${group.length} × ${key}`;
  });
}

function metricLines(brief: BriefInput): readonly string[] {
  const rows = brief.metrics.map((m) => `${m.key} ${m.value}${m.previous === null ? "" : ` (was ${m.previous})`}`);
  const goal = brief.goal ? `Goal ${brief.goal.metricKey}: ${brief.goal.current} of ${brief.goal.target} by ${brief.goal.dueDate}` : "No goal set.";
  return [...bullets(rows, "No metrics yet."), goal];
}

function decisionLines(brief: BriefInput): readonly string[] {
  const rows = brief.decisions.pending.map((c) => `[${c.tier}] ${firstWords(c.question, QUESTION_WORDS)} due ${c.dueAt.slice(0, 10)}`);
  return [...bullets(rows, "No cards waiting."), `${brief.decisions.deferred} deferred, ${brief.decisions.answeredYesterday} answered yesterday.`];
}

const signalLine = (s: BriefSignal): string => `${s.source} ${s.score}, ${SIGNAL_STATUS_WORDS[s.status]}: ${firstWords(s.title, TITLE_WORDS)}`;

/**
 * The brief as text: the email body and the panel's headline. Sections in the
 * fixed order; every title, question and excerpt is plain text (never HTML).
 */
export function briefMarkdown(brief: BriefInput): string {
  const header = [`# Morning brief: ${brief.companyName}, ${brief.day}`, ...(brief.stopped ? ["All agents are stopped (kill switch)."] : [])];
  const sections: readonly (readonly [string, readonly string[]])[] = [
    ["Yesterday", bullets([...outcomeLines(brief.yesterday.outcomes), ...actionLines(brief.yesterday.actions)], "Nothing.")],
    ["Metrics", metricLines(brief)],
    ["Decisions", decisionLines(brief)],
    ["Today", bullets(brief.today.map((t) => `${firstWords(t.title, TITLE_WORDS)} (${t.role}, ${t.status})`), "Nothing.")],
    ["Spend", bullets(brief.spend.map((s) => `${s.category} ${usd(s.spentTodayUsd)} of ${usd(s.dailyCapUsd)} today (${usd(s.spentTotalUsd)}/${usd(s.totalCapUsd)} total)`), "No budgets set.")],
    ["Signals", bullets(brief.signals.map(signalLine), "Nothing.")],
    ["Escalations", bullets(brief.escalations.map((e) => firstWords(e.title, TITLE_WORDS)), "Nothing.")],
  ];
  return [...header, ...sections.flatMap(([title, lines]) => ["", `## ${title}`, ...lines])].join("\n");
}

/** Words of the rendered brief (list markers and punctuation do not count). */
export function briefWordCount(brief: BriefInput): number {
  return wordCount(briefMarkdown(brief));
}

type TrimmableList = "today" | "signals" | "actions" | "escalations";
/** Trim order: today first (the home screen shows it anyway), escalations last. */
const TRIM_ORDER: readonly TrimmableList[] = ["today", "signals", "actions", "escalations"];

const listOf = (brief: BriefInput, list: TrimmableList): readonly unknown[] => (list === "actions" ? brief.yesterday.actions : brief[list]);

function withList(brief: BriefInput, list: TrimmableList, size: number): BriefInput {
  if (list === "actions") return { ...brief, yesterday: { ...brief.yesterday, actions: brief.yesterday.actions.slice(0, size) } };
  return { ...brief, [list]: brief[list].slice(0, size) };
}

/** Drops one item from the first list in `order` that still has more than `floor`; null when none can give. */
function trimOnce(brief: BriefInput, floor: number): BriefInput | null {
  const list = TRIM_ORDER.find((name) => listOf(brief, name).length > floor);
  return list ? withList(brief, list, listOf(brief, list).length - 1) : null;
}

function trimToBudget(brief: BriefInput, floor: number): BriefInput {
  let current = brief;
  while (briefWordCount(current) > BRIEF_MAX_WORDS) {
    const next = trimOnce(current, floor);
    if (!next) return current;
    current = next;
  }
  return current;
}

const clamped = (input: BriefInput): BriefInput => ({
  ...input,
  yesterday: { outcomes: input.yesterday.outcomes.slice(0, BRIEF_LIST_MAX.outcomes), actions: input.yesterday.actions.slice(0, BRIEF_LIST_MAX.actions) },
  metrics: input.metrics.slice(0, BRIEF_LIST_MAX.metrics),
  decisions: { ...input.decisions, pending: input.decisions.pending.slice(0, BRIEF_LIST_MAX.pending) },
  today: input.today.slice(0, BRIEF_LIST_MAX.today),
  spend: input.spend.slice(0, BRIEF_LIST_MAX.spend),
  signals: [...input.signals.slice(0, BRIEF_LIST_MAX.signals)].sort((a, b) => SIGNAL_PRIORITY[a.status] - SIGNAL_PRIORITY[b.status]),
  escalations: input.escalations.slice(0, BRIEF_LIST_MAX.escalations),
});

/**
 * Deterministic: the same input gives the same brief. Lists are trimmed from
 * the end, `today` → `signals` → `yesterday.actions` → `escalations`, first
 * down to one item each and only then to nothing, until the rendered text is
 * within BRIEF_MAX_WORDS. Pending cards, outcomes, metrics and spend are never
 * trimmed: they are what the CEO must see.
 */
export function composeBrief(input: BriefInput): Brief {
  const trimmed = trimToBudget(trimToBudget(clamped(input), 1), 0);
  return Object.freeze({ ...trimmed, wordCount: briefWordCount(trimmed) });
}
