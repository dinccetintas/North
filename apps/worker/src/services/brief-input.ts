import { ACTION_KINDS, AGENT_ROLES, BRIEF_LIST_MAX, CHANNELS, OUTCOME_METRIC_KEYS, canDispatch, isActive, type ActionKind, type AgentRole, type BriefInput, type Channel, type OutcomeMetricKey } from "@north/core";
import { creditBalance, getCompanyById, getEntitlementForCompany, latestPlan, listBriefs, listBudgets, listCards, listGoals, listLedgerEntries, listMemoryItems, listPendingCards, listRecentActions, listSignals, metricSeries, type CompanySummary, type DbClient } from "@north/db";
import type { WorkerDeps } from "../deps";
import { listDeferredRows } from "./deferred";

/** Without a previous brief the window is the last 24 h of database time. */
const FIRST_WINDOW_MS = 24 * 3600 * 1000;
const METRIC_WINDOW_DAYS = 30;
const TODAY_STATUSES: ReadonlySet<string> = new Set(["queued", "running", "waiting_decision"]);
const ESCALATION_PREFIX = "Escalated:";

const isChannel = (value: string): value is Channel => (CHANNELS as readonly string[]).includes(value);
const isActionKind = (value: string): value is ActionKind => (ACTION_KINDS as readonly string[]).includes(value);
const isRole = (value: string): value is AgentRole => (AGENT_ROLES as readonly string[]).includes(value);
const hoursBetween = (sinceIso: string, now: number): number => Math.max(1, Math.ceil((now - Date.parse(sinceIso)) / 3_600_000));

/** The instant the previous brief was stored (the window's start), else 24 h ago. Database timestamps on both sides. */
export async function briefWindowStart(db: DbClient, companyId: string, day: string): Promise<string> {
  const previous = (await listBriefs(db, companyId, 2)).find((b) => b.day < day);
  return previous?.createdAt ?? new Date(Date.now() - FIRST_WINDOW_MS).toISOString();
}

async function yesterdaySection(db: DbClient, companyId: string, since: string): Promise<BriefInput["yesterday"]> {
  const entries = await listLedgerEntries(db, companyId, { sinceIso: since, limit: BRIEF_LIST_MAX.outcomes });
  const outcomes = entries.map((e) => ({ what: e.note.slice(0, 200), metricKey: e.metricKey, delta: e.after - e.before, costUsd: Math.max(0, e.costUsd), channel: isChannel(e.channel) ? e.channel : null }));
  const recent = await listRecentActions(db, companyId, hoursBetween(since, Date.now()));
  const actions = recent
    .filter((a) => (a.status === "executed" || a.status === "notified") && a.createdAt >= since && a.externalRef !== "internal" && isActionKind(a.kind))
    .map((a) => ({ kind: a.kind as ActionKind, status: a.status, description: a.description.slice(0, 500) }))
    .slice(0, BRIEF_LIST_MAX.actions);
  return { outcomes, actions };
}

/** The latest company-scope value and the previous one per outcome metric; keys without a sample are absent. */
async function metricsSection(db: DbClient, companyId: string): Promise<BriefInput["metrics"]> {
  const out: BriefInput["metrics"][number][] = [];
  for (const key of OUTCOME_METRIC_KEYS) {
    const points = await metricSeries(db, companyId, key, METRIC_WINDOW_DAYS);
    const latest = points[points.length - 1];
    if (!latest) continue;
    const previous = points[points.length - 2];
    out.push({ key, value: latest.value, previous: previous?.value ?? null, measuredAt: latest.measuredAt });
  }
  return out;
}

async function goalSection(db: DbClient, companyId: string, metrics: BriefInput["metrics"]): Promise<BriefInput["goal"]> {
  const goal = (await listGoals(db, companyId)).find((g) => g.status === "active");
  if (!goal) return null;
  const current = metrics.find((m) => m.key === goal.metricKey)?.value ?? 0;
  return { metricKey: goal.metricKey as OutcomeMetricKey, target: goal.targetValue, current, dueDate: goal.dueDate };
}

async function decisionsSection(db: DbClient, companyId: string, since: string): Promise<BriefInput["decisions"]> {
  const pending = (await listPendingCards(db, companyId)).slice(0, BRIEF_LIST_MAX.pending).map((c) => ({ id: c.id, question: c.question.slice(0, 200), dueAt: c.dueAt, tier: c.tier }));
  const answeredYesterday = (await listCards(db, companyId, { limit: 200 })).filter((c) => c.answeredAt !== null && c.answeredAt >= since).length;
  const deferredActions = (await listDeferredRows(db)).filter((r) => r.companyId === companyId).length;
  const deferredSignals = (await listSignals(db, companyId, { status: ["deferred"], limit: 50 })).length;
  return { pending, deferred: deferredActions + deferredSignals, answeredYesterday };
}

async function todaySection(db: DbClient, companyId: string): Promise<BriefInput["today"]> {
  const plan = await latestPlan(db, companyId);
  if (!plan) return [];
  return plan.tasks
    .filter((t) => TODAY_STATUSES.has(t.status) && isRole(t.role))
    .slice(0, BRIEF_LIST_MAX.today)
    .map((t) => ({ taskId: t.id, title: t.title.slice(0, 200), role: t.role as AgentRole, status: t.status }));
}

/** Today's spend per category on the owner's local day (ADR 0011 follow-up: the brief's day and the budget's day are one). */
async function spendSection(db: DbClient, companyId: string, day: string): Promise<BriefInput["spend"]> {
  return (await listBudgets(db, companyId, day)).slice(0, BRIEF_LIST_MAX.spend).map((b) => ({ category: b.category, spentTodayUsd: b.spentTodayUsd, dailyCapUsd: b.dailyLimitUsd + b.dailyExtraUsd, spentTotalUsd: b.spentTotalUsd, totalCapUsd: b.totalLimitUsd }));
}

/**
 * BIL-1 / BIL-2 (D6-5): the line after the headline when billing keeps the
 * agents from running although the user did not stop them: the subscription
 * ended (or the company is archived for retention), or the credits are spent.
 * A user's own kill switch has the stopped line instead.
 */
async function blockedLine(db: DbClient, company: CompanySummary): Promise<BriefInput["blocked"]> {
  if (company.pausedReason === "subscription_ended" || company.pausedReason === "retention") return { reason: "subscription_ended" };
  const entitlement = await getEntitlementForCompany(db, company.id);
  if (!entitlement || !isActive(entitlement)) return { reason: "subscription_ended" };
  if (company.killSwitchActive) return null;
  return canDispatch(await creditBalance(db, entitlement.userId)) ? null : { reason: "credits_exhausted" };
}

async function signalsSection(db: DbClient, companyId: string, since: string): Promise<BriefInput["signals"]> {
  const rows = await listSignals(db, companyId, { sinceDays: 14, limit: 100 });
  return rows
    .filter((s) => s.createdAt >= since || s.updatedAt >= since)
    .slice(0, BRIEF_LIST_MAX.signals)
    .map((s) => ({ id: s.id, title: s.title.slice(0, 200), source: s.source, score: Math.min(1, Math.max(0, s.score)), status: s.status }));
}

async function escalationsSection(db: DbClient, companyId: string, since: string): Promise<BriefInput["escalations"]> {
  const items = await listMemoryItems(db, companyId, 100);
  return items
    .filter((m) => m.kind === "learning" && m.title.startsWith(ESCALATION_PREFIX) && m.createdAt >= since)
    .slice(0, BRIEF_LIST_MAX.escalations)
    .map((m) => ({ title: m.title.slice(0, 200) }));
}

/**
 * BRF-1: everything the brief of one company and owner-local day says, read
 * from the repositories, nothing invented: the ledger and the actions since
 * the previous brief, the metrics, the goal, the cards, today's plan tasks,
 * the budgets, the signals and the escalations. `composeBrief` trims it.
 */
export async function gatherBriefInput(deps: WorkerDeps, companyId: string, day: string): Promise<BriefInput> {
  const { db } = deps;
  const company = await getCompanyById(db, companyId);
  if (!company) throw new Error(`company ${companyId} not found`);
  const since = await briefWindowStart(db, companyId, day);
  const metrics = await metricsSection(db, companyId);
  return Object.freeze({
    day,
    companyName: company.name.slice(0, 200),
    stopped: company.killSwitchActive,
    blocked: await blockedLine(db, company),
    yesterday: await yesterdaySection(db, companyId, since),
    metrics,
    goal: await goalSection(db, companyId, metrics),
    decisions: await decisionsSection(db, companyId, since),
    today: await todaySection(db, companyId),
    spend: await spendSection(db, companyId, day),
    signals: await signalsSection(db, companyId, since),
    escalations: await escalationsSection(db, companyId, since),
  });
}
