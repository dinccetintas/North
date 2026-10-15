import { randomUUID } from "node:crypto";
import { vi } from "vitest";

/**
 * M5 additions to the in-memory `@north/db` stand-in: signals (dedupe on
 * `(company, source, source_ref)`, the weekly opportunity-cap index as
 * `SignalCapError`), briefs (one per company-day), active companies with the
 * owner's zone, Sentry project slugs, metric series, ledger listing, pending
 * cards, plans with revisions, tasks by type, memory and artifact listing.
 * Mixed into `fakeDbModule` by `fake-db.ts`.
 */

export interface FakeSignal {
  id: string;
  companyId: string;
  kind: string;
  source: string;
  sourceRef: string;
  title: string;
  url: string | null;
  excerpt: string;
  summary: string;
  rationale: string;
  score: number;
  status: string;
  payload: Record<string, unknown>;
  cardWeek: string | null;
  convertedCardId: string | null;
  convertedTaskId: string | null;
  observedAt: string;
  scoredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FakeBrief {
  id: string;
  companyId: string;
  day: string;
  content: unknown;
  wordCount: number;
  createdAt: string;
}

export interface FakePlan {
  id: string;
  companyId: string;
  goalId: string | null;
  weekStart: string;
  summary: string;
  rationale: string;
  status: string;
  revisions: unknown[];
  createdAt: string;
}

export interface FakeArtifact {
  id: string;
  companyId: string;
  kind: string;
  title: string;
  version: number;
  createdByRole: string;
  createdAt: string;
}

export interface FakeLedgerEntry {
  id: string;
  companyId: string;
  taskId: string | null;
  metricKey: string;
  before: number;
  after: number;
  costUsd: number;
  channel: string;
  note: string;
  createdAt: string;
}

export interface M5State {
  signals: Map<string, FakeSignal>;
  briefs: FakeBrief[];
  plans: FakePlan[];
  artifacts: FakeArtifact[];
  /** Sentry project slug → company id (`companies.sentry_project_slug`). */
  sentryProjects: Map<string, string>;
  /** Companies the proactive crons serve, with the owner's zone (`listActiveCompanies`). */
  activeCompanies: { companyId: string; ownerId: string; timezone: string; name: string; slug: string; killSwitchActive: boolean }[];
}

export const emptyM5State = (): M5State => ({ signals: new Map(), briefs: [], plans: [], artifacts: [], sentryProjects: new Map(), activeCompanies: [] });

export interface TaskLike {
  id: string;
  companyId: string;
  planId?: string | null;
  role: string;
  taskType: string;
  title: string;
  input?: string;
  status: string;
  metricKey: string | null;
  createdAt?: string;
}

export interface MemoryLike {
  companyId: string;
  item: unknown;
  id?: string;
  createdByRole?: string;
  createdAt?: string;
}

export interface M5Helpers<T extends TaskLike> {
  readonly DbError: new (message: string) => Error;
  readonly nextId: (prefix: string) => string;
  readonly tasks: () => Map<string, T>;
  readonly makeTask: (input: Record<string, unknown>) => T;
  readonly cards: () => { id: string; companyId: string; answeredAt: string | null; dueAt: string; question: string; tier: string; seq?: number }[];
  readonly companies: () => Map<string, { id: string; slug: string; name: string; ownerId: string }>;
  readonly killSwitch: () => Map<string, boolean>;
  readonly memory: () => MemoryLike[];
  readonly metrics: () => { companyId: string; metricKey: string; value: number; source?: string; scope?: string; measuredAt?: string }[];
  readonly ledger: () => unknown[];
}

const isoNow = (): string => new Date().toISOString();

export function fakeDbM5<T extends TaskLike>(state: M5State, h: M5Helpers<T>) {
  class SignalCapError extends h.DbError {}
  const signal = (companyId: string, id: string): FakeSignal => {
    const row = state.signals.get(id);
    if (!row || row.companyId !== companyId) throw new h.DbError(`Signal ${id} not found in company ${companyId}`);
    return row;
  };
  const frozen = (s: FakeSignal) => ({ ...s, payload: { ...s.payload } });
  /** The partial unique index: one `opportunity` row per `(company, card_week)` where `card_week` is set. */
  const capViolated = (row: FakeSignal, week: string | null | undefined): boolean =>
    row.kind === "opportunity" && typeof week === "string" && [...state.signals.values()].some((s) => s.id !== row.id && s.companyId === row.companyId && s.kind === "opportunity" && s.cardWeek === week);

  return {
    SignalCapError,
    insertSignals: vi.fn(async (_db: unknown, companyId: string, candidates: { source: string; sourceRef: string; title: string; excerpt?: string; url: string | null; observedAt: string; baseline?: boolean }[], options: { kind: string; score?: number; status?: string }) => {
      const ids: string[] = [];
      for (const c of candidates) {
        if ([...state.signals.values()].some((s) => s.companyId === companyId && s.source === c.source && s.sourceRef === c.sourceRef)) continue;
        const id = randomUUID();
        const now = isoNow();
        state.signals.set(id, { id, companyId, kind: options.kind, source: c.source, sourceRef: c.sourceRef, title: c.title, url: c.url, excerpt: c.excerpt ?? "", summary: "", rationale: "", score: options.score ?? 0, status: c.baseline ? "below_threshold" : (options.status ?? "new"), payload: {}, cardWeek: null, convertedCardId: null, convertedTaskId: null, observedAt: c.observedAt, scoredAt: null, createdAt: now, updatedAt: now });
        ids.push(id);
      }
      return ids;
    }),
    listSignals: vi.fn(async (_db: unknown, companyId: string, opts: { status?: readonly string[]; kind?: readonly string[]; cardWeek?: string; limit?: number } = {}) =>
      [...state.signals.values()]
        .filter((s) => s.companyId === companyId && (!opts.status || opts.status.includes(s.status)) && (!opts.kind || opts.kind.includes(s.kind)) && (opts.cardWeek === undefined || s.cardWeek === opts.cardWeek))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, opts.limit ?? 50)
        .map(frozen),
    ),
    getSignal: vi.fn(async (_db: unknown, companyId: string, id: string) => {
      const row = state.signals.get(id);
      return row && row.companyId === companyId ? frozen(row) : null;
    }),
    signalByRef: vi.fn(async (_db: unknown, companyId: string, source: string, ref: string) => {
      const row = [...state.signals.values()].find((s) => s.companyId === companyId && s.source === source && s.sourceRef === ref);
      return row ? frozen(row) : null;
    }),
    knownSourceRefs: vi.fn(async (_db: unknown, companyId: string, source: string) => [...state.signals.values()].filter((s) => s.companyId === companyId && s.source === source).map((s) => s.sourceRef)),
    updateSignal: vi.fn(async (_db: unknown, companyId: string, id: string, patch: { status?: string; score?: number; summary?: string; rationale?: string; convertedCardId?: string | null; convertedTaskId?: string | null; cardWeek?: string | null }) => {
      const row = signal(companyId, id);
      if (capViolated(row, patch.cardWeek)) throw new SignalCapError(`The week ${patch.cardWeek} already has its opportunity card (signals_opportunity_week_idx)`);
      const now = isoNow();
      Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)), { updatedAt: now, ...(patch.score === undefined ? {} : { scoredAt: now }) });
      return frozen(row);
    }),
    setSignalPayload: vi.fn(async (_db: unknown, companyId: string, id: string, payload: Record<string, unknown>) => {
      signal(companyId, id).payload = { ...payload };
    }),
    createBrief: vi.fn(async (_db: unknown, input: { companyId: string; day: string; content: unknown; wordCount: number }) => {
      const existing = state.briefs.find((b) => b.companyId === input.companyId && b.day === input.day);
      if (existing) return { ...existing };
      const row: FakeBrief = { id: randomUUID(), companyId: input.companyId, day: input.day, content: input.content, wordCount: input.wordCount, createdAt: isoNow() };
      state.briefs.push(row);
      return { ...row };
    }),
    getBrief: vi.fn(async (_db: unknown, companyId: string, day: string) => {
      const row = state.briefs.find((b) => b.companyId === companyId && b.day === day);
      return row ? { ...row } : null;
    }),
    latestBrief: vi.fn(async (_db: unknown, companyId: string) => {
      const rows = state.briefs.filter((b) => b.companyId === companyId).sort((a, b) => b.day.localeCompare(a.day));
      return rows[0] ? { ...rows[0] } : null;
    }),
    listBriefs: vi.fn(async (_db: unknown, companyId: string, limit = 30) =>
      state.briefs
        .filter((b) => b.companyId === companyId)
        .sort((a, b) => b.day.localeCompare(a.day))
        .slice(0, limit)
        .map((b) => ({ ...b })),
    ),
    listActiveCompanies: vi.fn(async () => state.activeCompanies.map((c) => ({ ...c, killSwitchActive: h.killSwitch().get(c.companyId) ?? c.killSwitchActive }))),
    companyBySentryProject: vi.fn(async (_db: unknown, slug: string) => {
      const companyId = state.sentryProjects.get(slug);
      const company = companyId ? h.companies().get(companyId) : undefined;
      return company ? { id: company.id, name: company.name, slug: company.slug, status: "active", killSwitchActive: h.killSwitch().get(company.id) ?? false } : null;
    }),
    setSentryProject: vi.fn(async (_db: unknown, companyId: string, slug: string | null) => {
      for (const [k, v] of state.sentryProjects) if (v === companyId) state.sentryProjects.delete(k);
      if (slug) state.sentryProjects.set(slug, companyId);
    }),
    metricSeries: vi.fn(async (_db: unknown, companyId: string, key: string) =>
      h
        .metrics()
        .filter((m) => m.companyId === companyId && m.metricKey === key && (m.scope ?? "company") === "company")
        .map((m) => ({ value: m.value, measuredAt: m.measuredAt ?? isoNow() }))
        .sort((a, b) => a.measuredAt.localeCompare(b.measuredAt)),
    ),
    listLedgerEntries: vi.fn(async (_db: unknown, companyId: string, opts: { sinceIso?: string; limit?: number } = {}) =>
      (h.ledger() as Partial<FakeLedgerEntry>[])
        .filter((e) => e.companyId === companyId && (opts.sinceIso === undefined || (e.createdAt ?? isoNow()) >= opts.sinceIso))
        .map((e) => ({ id: e.id ?? "ledger", taskId: e.taskId ?? null, metricKey: e.metricKey ?? "artifacts", before: e.before ?? 0, after: e.after ?? 0, costUsd: e.costUsd ?? 0, channel: e.channel ?? "organic", note: e.note ?? "", provenance: null, campaignId: null, actionId: null, createdAt: e.createdAt ?? isoNow() }))
        .reverse()
        .slice(0, opts.limit ?? 500),
    ),
    listPendingCards: vi.fn(async (_db: unknown, companyId: string) => h.cards().filter((c) => c.companyId === companyId && !c.answeredAt).map((c) => ({ ...c }))),
    createTask: vi.fn(async (_db: unknown, input: Record<string, unknown>) => {
      const task = h.makeTask({ status: "queued", attempts: 0, planId: null, input: "", createdAt: isoNow(), ...input });
      h.tasks().set(task.id, task);
      return { ...task };
    }),
    listTasksByType: vi.fn(async (_db: unknown, companyId: string, taskType: string, opts: { status?: readonly string[] } = {}) =>
      [...h.tasks().values()].filter((t) => t.companyId === companyId && t.taskType === taskType && (!opts.status || opts.status.includes(t.status))).map((t) => ({ ...t })),
    ),
    createPlanWithTasks: vi.fn(async (_db: unknown, input: { companyId: string; goalId: string | null; weekStart: string; summary: string; rationale?: string; tasks: { taskType: string; title: string; input?: string; metricKey: string; expectedDelta: number }[]; revisions?: unknown[] }) => {
      const plan: FakePlan = { id: randomUUID(), companyId: input.companyId, goalId: input.goalId, weekStart: input.weekStart, summary: input.summary, rationale: input.rationale ?? "", status: "active", revisions: [...(input.revisions ?? [])], createdAt: isoNow() };
      state.plans.push(plan);
      const taskIds: string[] = [];
      for (const t of input.tasks) {
        const task = h.makeTask({ companyId: input.companyId, planId: plan.id, taskType: t.taskType, title: t.title, input: t.input ?? "", metricKey: t.metricKey, status: "queued", attempts: 0, createdAt: isoNow() });
        h.tasks().set(task.id, task);
        taskIds.push(task.id);
      }
      return { planId: plan.id, taskIds };
    }),
    latestPlan: vi.fn(async (_db: unknown, companyId: string) => {
      const plan = state.plans.filter((p) => p.companyId === companyId).at(-1);
      if (!plan) return null;
      const tasks = [...h.tasks().values()].filter((t) => t.planId === plan.id).map((t) => ({ ...t }));
      return { ...plan, revisions: [...plan.revisions], tasks };
    }),
    listMemoryItems: vi.fn(async (_db: unknown, companyId: string) =>
      h
        .memory()
        .filter((m) => m.companyId === companyId)
        .map((m, i) => ({ id: m.id ?? `mem-${i}`, createdByRole: m.createdByRole ?? "research", createdAt: m.createdAt ?? isoNow(), ...(m.item as { kind: string; title: string; content: string }) }))
        .reverse(),
    ),
    listArtifacts: vi.fn(async (_db: unknown, companyId: string) => state.artifacts.filter((a) => a.companyId === companyId).map((a) => ({ ...a }))),
    recordArtifact: (companyId: string, kind: string, title: string, createdByRole: string): FakeArtifact => {
      const row: FakeArtifact = { id: h.nextId("art"), companyId, kind, title, version: 1, createdByRole, createdAt: isoNow() };
      state.artifacts.push(row);
      return row;
    },
  };
}
