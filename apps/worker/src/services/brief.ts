import { BRIEF_HOUR, composeBrief, localDay, localHour, type Brief } from "@north/core";
import { createBrief, getBrief, listActiveCompanies } from "@north/db";
import type { WorkerDeps } from "../deps";
import { gatherBriefInput } from "./brief-input";
import { notifyBriefEmail, notifyBriefPush } from "./notify";
import type { StepRunner } from "./steps";

export interface BriefDue {
  readonly companyId: string;
  readonly day: string;
}

/**
 * BRF-1, the hourly tick: every active, onboarded company whose owner-local
 * hour is `BRIEF_HOUR` and whose brief for the local day does not exist yet.
 * The kill switch does not exclude: a stopped company still gets its brief,
 * which says so. Idempotent: one row per company-day, so a second tick in
 * the same hour finds the row and emits nothing.
 */
export async function briefTick(deps: WorkerDeps): Promise<readonly BriefDue[]> {
  const now = deps.clock();
  const due: BriefDue[] = [];
  for (const company of await listActiveCompanies(deps.db)) {
    if (localHour(company.timezone, now) !== BRIEF_HOUR) continue;
    const day = localDay(company.timezone, now);
    if (await getBrief(deps.db, company.companyId, day)) continue;
    due.push({ companyId: company.companyId, day });
  }
  return Object.freeze(due);
}

export interface GeneratedBrief {
  readonly briefId: string;
  /** False when the row already existed (a replayed event or a parallel tick). */
  readonly created: boolean;
  readonly wordCount: number;
  /** Milliseconds from the call to the stored row (the harness measures `< 60 s` from the event). */
  readonly ms: number;
}

interface StoredBrief {
  readonly briefId: string;
  readonly created: boolean;
  readonly brief: Brief;
}

/** `createBrief` is idempotent on `(company_id, brief_date)`; the row that exists wins and nothing is overwritten. */
async function storeBrief(deps: WorkerDeps, companyId: string, brief: Brief): Promise<StoredBrief> {
  const existing = await getBrief(deps.db, companyId, brief.day);
  if (existing) return { briefId: existing.id, created: false, brief: existing.content };
  const row = await createBrief(deps.db, { companyId, day: brief.day, content: brief, wordCount: brief.wordCount });
  return { briefId: row.id, created: true, brief: row.content };
}

/**
 * BRF-1: gather → compose (pure) → store → notify-push → notify-email, each
 * its own durable step. The brief is K0 (it reads) and is delivered through
 * the notification channel, never through the gate, like decision cards.
 */
export async function generateBrief(deps: WorkerDeps, step: StepRunner, companyId: string, day: string, appUrl: string): Promise<GeneratedBrief> {
  const startedAt = Date.now();
  const input = await step.run("gather", () => gatherBriefInput(deps, companyId, day));
  const brief = composeBrief(input);
  const stored = await step.run("store", () => storeBrief(deps, companyId, brief));
  const ms = Date.now() - startedAt;
  if (stored.created) {
    await step.run("notify-push", () => notifyBriefPush(deps, companyId, stored.brief, appUrl));
    await step.run("notify-email", () => notifyBriefEmail(deps, companyId, stored.brief, appUrl));
  }
  return Object.freeze({ briefId: stored.briefId, created: stored.created, wordCount: stored.brief.wordCount, ms });
}
