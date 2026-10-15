import { z } from "zod";
import { PAUSED_REASONS, type PausedReason } from "../companies";
import { METRIC_KEYS } from "../tasks/types";
import { firstWords, wordCount } from "../text";
import { DAY_SCHEMA, type Brief } from "./types";

/**
 * MULTI-1: the portfolio is one screen across an owner's companies, composed
 * deterministically from today's `briefs` rows under RLS and nothing else: no
 * memory, no cross-company join. It is stored nowhere and is not an email.
 */
export const PORTFOLIO_MAX_WORDS = 300;

const PortfolioPending = z.object({ id: z.string().min(1).max(64), question: z.string().min(1).max(200), dueAt: z.iso.datetime({ offset: true }) });
const PortfolioOutcome = z.object({ what: z.string().max(200), delta: z.number(), metricKey: z.string().max(40).refine((v) => (METRIC_KEYS as readonly string[]).includes(v), { message: "unknown metric key" }) });

const PortfolioCompany = z.object({
  companyId: z.uuid(),
  slug: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  stopped: z.boolean(),
  pausedReason: z.enum(PAUSED_REASONS).nullable(),
  /** One of `HEADLINES`: the company's state in a few words. */
  headline: z.string().min(1).max(80),
  pending: z.array(PortfolioPending).max(20),
  outcomes: z.array(PortfolioOutcome).max(50),
  /** Signals held for next week (`capped`). */
  held: z.number().int().nonnegative(),
});

export const PortfolioBriefSchema = z.object({
  day: DAY_SCHEMA,
  companies: z.array(PortfolioCompany).max(50),
  totals: z.object({ pending: z.number().int().nonnegative(), companies: z.number().int().nonnegative() }),
  /** Words of the rendered markdown; at most PORTFOLIO_MAX_WORDS unless pending cards alone exceed it. */
  wordCount: z.number().int().nonnegative(),
});
export type PortfolioBrief = z.infer<typeof PortfolioBriefSchema>;
export type PortfolioCompanySection = PortfolioBrief["companies"][number];

/** The company row as the repository hands it. */
export interface PortfolioCompanyInput {
  readonly companyId: string;
  readonly slug: string;
  readonly name: string;
  readonly stopped: boolean;
  readonly pausedReason: PausedReason | null;
}

/** The parts of a brief the portfolio reads. */
export type PortfolioBriefSource = Pick<Brief, "stopped" | "blocked" | "decisions" | "yesterday" | "signals">;

export interface PortfolioRow {
  readonly company: PortfolioCompanyInput;
  /** Today's brief, or null when `generate-brief` has not written one yet. */
  readonly brief: PortfolioBriefSource | null;
}

/** The headlines, in the order they are decided; the web's labels use the same words. */
export const HEADLINES = Object.freeze({
  subscriptionEnded: "paused: subscription ended",
  archived: "archived",
  noBrief: "no brief yet today",
  credits: "waiting for credits",
  stopped: "stopped (kill switch)",
  running: "running",
});

function headlineFor(company: PortfolioCompanyInput, brief: PortfolioBriefSource | null): string {
  if (company.pausedReason === "subscription_ended" || brief?.blocked?.reason === "subscription_ended") return HEADLINES.subscriptionEnded;
  if (company.pausedReason === "retention") return HEADLINES.archived;
  if (brief === null) return HEADLINES.noBrief;
  if (brief.blocked?.reason === "credits_exhausted") return HEADLINES.credits;
  if (brief.stopped || company.stopped) return HEADLINES.stopped;
  return HEADLINES.running;
}

function section({ company, brief }: PortfolioRow): PortfolioCompanySection {
  return {
    companyId: company.companyId,
    slug: company.slug,
    name: company.name,
    stopped: company.stopped,
    pausedReason: company.pausedReason,
    headline: headlineFor(company, brief),
    pending: brief ? brief.decisions.pending.map((c) => ({ id: c.id, question: c.question, dueAt: c.dueAt })) : [],
    outcomes: brief ? brief.yesterday.outcomes.map((o) => ({ what: o.what, delta: o.delta, metricKey: o.metricKey })) : [],
    held: brief ? brief.signals.filter((s) => s.status === "capped").length : 0,
  };
}

/** Companies with pending cards first, then by name; ties by id so the order is total. */
function compare(a: PortfolioCompanySection, b: PortfolioCompanySection): number {
  const pendingRank = Number(a.pending.length === 0) - Number(b.pending.length === 0);
  if (pendingRank !== 0) return pendingRank;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.companyId < b.companyId ? -1 : a.companyId > b.companyId ? 1 : 0;
}

const QUESTION_WORDS = 6;
const TITLE_WORDS = 6;
const signed = (value: number): string => (value >= 0 ? `+${value}` : `${value}`);
const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
const companiesWord = (n: number): string => (n === 1 ? "1 company" : `${n} companies`);

function companyLines(c: PortfolioCompanySection): readonly string[] {
  const lines = [
    ...c.pending.map((p) => `- Decide: ${firstWords(p.question, QUESTION_WORDS)} due ${p.dueAt.slice(0, 10)}`),
    ...c.outcomes.map((o) => `- Yesterday: ${o.metricKey} ${signed(o.delta)}: ${firstWords(o.what, TITLE_WORDS)}`),
    ...(c.held > 0 ? [`- ${plural(c.held, "signal")} held`] : []),
  ];
  return lines.length === 0 ? ["- Nothing."] : lines;
}

function totalsLine(brief: Pick<PortfolioBrief, "totals">): string {
  if (brief.totals.companies === 0) return "No companies yet.";
  if (brief.totals.pending === 0) return "No decisions waiting.";
  return `${plural(brief.totals.pending, "decision")} across ${companiesWord(brief.totals.companies)}.`;
}

/** The portfolio as text: one section per company in the fixed order; every question and title is plain text. */
export function portfolioMarkdown(brief: Omit<PortfolioBrief, "wordCount">): string {
  const header = [`# Portfolio brief: ${brief.day}`, totalsLine(brief)];
  return [...header, ...brief.companies.flatMap((c) => ["", `## ${c.name}: ${c.headline}`, ...companyLines(c)])].join("\n");
}

/** Treated as immutable: every step builds a new array (`with`, `slice`, `sort` on a copy). */
type Sections = PortfolioCompanySection[];

/** Drops the last outcome of the last company that still has one; then the held count of the last company that still shows one; null when nothing can give. */
function trimOnce(companies: Sections): Sections | null {
  const outcomeIndex = companies.findLastIndex((c) => c.outcomes.length > 0);
  if (outcomeIndex >= 0) {
    const c = companies[outcomeIndex]!;
    return companies.with(outcomeIndex, { ...c, outcomes: c.outcomes.slice(0, -1) });
  }
  const heldIndex = companies.findLastIndex((c) => c.held > 0);
  return heldIndex >= 0 ? companies.with(heldIndex, { ...companies[heldIndex]!, held: 0 }) : null;
}

const wordsOf = (day: string, companies: Sections, pending: number): number => wordCount(portfolioMarkdown({ day, companies, totals: { pending, companies: companies.length } }));

/**
 * Deterministic: the same rows give the same portfolio. Companies with pending
 * cards come first, then by name. Outcomes are trimmed from the end, then held
 * counts, until the rendered text is within PORTFOLIO_MAX_WORDS; pending cards
 * are never trimmed. The day must be `YYYY-MM-DD`.
 */
export function composePortfolioBrief(rows: readonly PortfolioRow[], day: string): PortfolioBrief {
  const safeDay = DAY_SCHEMA.parse(day);
  let companies: Sections = rows.map(section).sort(compare);
  const pending = companies.reduce((n, c) => n + c.pending.length, 0);
  while (wordsOf(safeDay, companies, pending) > PORTFOLIO_MAX_WORDS) {
    const next = trimOnce(companies);
    if (!next) break;
    companies = next;
  }
  return Object.freeze({ day: safeDay, companies: companies.map((c) => Object.freeze(c)), totals: Object.freeze({ pending, companies: companies.length }), wordCount: wordsOf(safeDay, companies, pending) });
}
