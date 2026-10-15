import { canCreateCompany, type Entitlement } from "@north/core/billing/entitlements";
import { HEADLINES, type PortfolioBrief } from "@north/core/brief/portfolio";
import { formatNumber, metricLabel } from "./labels";

/**
 * MULTI-1 view models for `/companies`: the portfolio brief composed by core
 * from today's `briefs` rows (nothing else is read), and one row per company.
 */

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;
const companiesWord = (n: number): string => (n === 1 ? "1 company" : `${n} companies`);

/** "4 decisions across 2 companies". */
export function totalsLabel(totals: PortfolioBrief["totals"]): string {
  if (totals.companies === 0) return "No companies yet";
  if (totals.pending === 0) return `No decisions waiting across ${companiesWord(totals.companies)}`;
  return `${plural(totals.pending, "decision")} across ${companiesWord(totals.companies)}`;
}

export interface PortfolioPendingView {
  readonly id: string;
  readonly question: string;
  readonly href: string;
  readonly due: string;
}

export interface PortfolioCompanyView {
  readonly companyId: string;
  readonly slug: string;
  readonly name: string;
  readonly paused: boolean;
  readonly pausedReason: string;
  readonly headline: string;
  readonly pending: readonly PortfolioPendingView[];
  readonly outcomes: readonly string[];
  /** "2 signals held"; null when none. */
  readonly held: string | null;
}

export interface PortfolioView {
  readonly day: string;
  readonly totals: string;
  readonly wordCount: number;
  readonly words: string;
  readonly companies: readonly PortfolioCompanyView[];
}

const signed = (n: number): string => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

function companyView(c: PortfolioBrief["companies"][number]): PortfolioCompanyView {
  return Object.freeze({
    companyId: c.companyId,
    slug: c.slug,
    name: c.name,
    paused: c.stopped || c.pausedReason !== null,
    pausedReason: c.pausedReason ?? (c.stopped ? "user" : ""),
    headline: c.headline,
    pending: Object.freeze(c.pending.map((p) => Object.freeze({ id: p.id, question: p.question, href: `/c/${c.slug}/decisions/${encodeURIComponent(p.id)}`, due: p.dueAt.slice(0, 10) }))),
    outcomes: Object.freeze(c.outcomes.map((o) => `${metricLabel(o.metricKey)} ${signed(o.delta)}: ${o.what}`)),
    held: c.held > 0 ? `${plural(c.held, "signal")} held` : null,
  });
}

export function portfolioView(brief: PortfolioBrief): PortfolioView {
  return Object.freeze({
    day: brief.day,
    totals: totalsLabel(brief.totals),
    wordCount: brief.wordCount,
    words: `${brief.wordCount} ${brief.wordCount === 1 ? "word" : "words"}`,
    companies: Object.freeze(brief.companies.map(companyView)),
  });
}

/** The company as `listCompanies` hands it (structural, so the record needs no cast). */
export interface CompanyLike {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: string;
  readonly killSwitchActive: boolean;
  readonly pausedReason?: string | null;
}

export interface GoalSnapshot {
  readonly metricKey: string;
  readonly target: number;
  readonly current: number | null;
}

export interface CompanyRowView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: string;
  readonly pausedReason: string;
  readonly stateWord: string;
  readonly pending: string;
  readonly goal: { readonly label: string; readonly percent: number } | null;
}

function stateWord(c: CompanyLike): string {
  if (c.status === "archived" || c.pausedReason === "retention") return HEADLINES.archived;
  if (c.pausedReason === "subscription_ended") return HEADLINES.subscriptionEnded;
  return c.killSwitchActive ? "stopped" : HEADLINES.running;
}

function goalView(goal: GoalSnapshot | undefined): CompanyRowView["goal"] {
  if (!goal) return null;
  const current = goal.current ?? 0;
  const percent = goal.target > 0 ? Math.max(0, Math.min(100, Math.round((current / goal.target) * 100))) : 0;
  return Object.freeze({ label: `${metricLabel(goal.metricKey)} ${goal.current === null ? "—" : formatNumber(current)} / ${formatNumber(goal.target)}`, percent });
}

export function companyRows(companies: readonly CompanyLike[], pending: ReadonlyMap<string, number>, goals: ReadonlyMap<string, GoalSnapshot>): readonly CompanyRowView[] {
  return Object.freeze(
    companies.map((c) => {
      const count = pending.get(c.id) ?? 0;
      return Object.freeze({
        id: c.id,
        slug: c.slug,
        name: c.name,
        status: c.status,
        pausedReason: c.pausedReason ?? "",
        stateWord: stateWord(c),
        pending: count === 0 ? "No decisions" : plural(count, "decision"),
        goal: goalView(goals.get(c.id)),
      });
    }),
  );
}

/** Companies that take a slot of the plan: every one not archived (the trigger counts the same). */
export function activeCompanyCount(companies: readonly Pick<CompanyLike, "status">[]): number {
  return companies.filter((c) => c.status !== "archived").length;
}

export interface NewCompanyGate {
  readonly allowed: boolean;
  readonly reason: string | null;
}

/** BIL-1: the web's message first; `companies_within_entitlement` is the authority and says the same. */
export function newCompanyGate(entitlement: Entitlement | null, activeCount: number): NewCompanyGate {
  if (entitlement === null) return Object.freeze({ allowed: false, reason: "Choose a plan to create a company." });
  const check = canCreateCompany(entitlement, activeCount);
  return Object.freeze(check.ok ? { allowed: true, reason: null } : { allowed: false, reason: check.reason });
}
