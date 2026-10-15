import { latestMetric, listBriefsForDay, listGoals, listPendingCards, type CompanySummary, type DbClient } from "@north/db";
import { composePortfolioBrief, type PortfolioBrief, type PortfolioRow } from "@north/core/brief/portfolio";
import type { PausedReason } from "@north/core/companies";
import { localDay } from "@north/core/time";
import type { GoalSnapshot } from "./portfolio-view";

/**
 * MULTI-1: the portfolio reads today's `briefs` rows of the owner's companies
 * (one query under RLS), the open cards and the goal of each company, and
 * nothing else: no memory, no cross-company join, no worker step.
 *
 * Repositories used (packages/db): `listBriefsForDay(db, day)` (WP-A6, owner
 * client, every visible company) → `BriefRecord[]`; `listPendingCards`,
 * `listGoals`, `latestMetric` (M0–M2).
 */

export interface PortfolioData {
  readonly day: string;
  /** Null when no company has today's brief yet. */
  readonly brief: PortfolioBrief | null;
  readonly pending: ReadonlyMap<string, number>;
  readonly goals: ReadonlyMap<string, GoalSnapshot>;
}

type CompanyRowInput = Pick<CompanySummary, "id" | "slug" | "name" | "killSwitchActive"> & { readonly pausedReason?: PausedReason | null };

async function goalOf(db: DbClient, companyId: string): Promise<GoalSnapshot | null> {
  const goals = await listGoals(db, companyId);
  const goal = goals.find((g) => g.status === "active") ?? goals[0];
  if (!goal) return null;
  const metric = await latestMetric(db, companyId, goal.metricKey);
  return Object.freeze({ metricKey: goal.metricKey, target: goal.targetValue, current: metric?.value ?? null });
}

export async function loadPortfolio(db: DbClient, companies: readonly CompanyRowInput[], timezone: string, now: Date): Promise<PortfolioData> {
  const day = localDay(timezone, now);
  const [briefs, pendingCounts, goalList] = await Promise.all([
    listBriefsForDay(db, day),
    Promise.all(companies.map(async (c) => [c.id, (await listPendingCards(db, c.id)).length] as const)),
    Promise.all(companies.map(async (c) => [c.id, await goalOf(db, c.id)] as const)),
  ]);
  const byCompany = new Map(briefs.map((b) => [b.companyId, b.content] as const));
  const rows: PortfolioRow[] = companies.map((c) => ({
    company: { companyId: c.id, slug: c.slug, name: c.name, stopped: c.killSwitchActive, pausedReason: c.pausedReason ?? null },
    brief: byCompany.get(c.id) ?? null,
  }));
  const goals = new Map(goalList.flatMap(([id, goal]) => (goal ? [[id, goal] as const] : [])));
  return Object.freeze({
    day,
    brief: briefs.length === 0 ? null : composePortfolioBrief(rows, day),
    pending: new Map(pendingCounts),
    goals,
  });
}
