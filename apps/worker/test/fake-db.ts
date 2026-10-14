import { vi } from "vitest";
import type { ActionSpec } from "@north/core";
import type { WorkerDeps } from "../src/deps";
import { createSandboxIntegrations, type SandboxEvent } from "@north/integrations";

/**
 * In-memory stand-in for the `@north/db` repositories the action services use.
 * Tests install it with `vi.mock("@north/db", () => fakeDbModule(state))`; the
 * state object is shared so assertions can read what was written.
 */

export interface FakeTask {
  id: string;
  companyId: string;
  role: string;
  taskType: string;
  title: string;
  status: "queued" | "running" | "waiting_decision" | "done" | "failed";
  costUsd: number;
  metricKey: string | null;
  outputSummary: string | null;
  evidence: unknown;
  attempts: number;
}

export interface FakeAction {
  id: string;
  companyId: string;
  taskId: string | null;
  kind: string;
  tier: string;
  status: string;
  externalRef: string | null;
  decisionCardId: string | null;
  autoRuleId: string | null;
  payload: Record<string, unknown>;
  supersedes: string | null;
  createdAt: string;
}

export interface FakeCard {
  id: string;
  companyId: string;
  taskId: string | null;
  tier: "K2" | "K3";
  question: string;
  rationale: string;
  options: { id: string; label: string }[];
  defaultOptionId: string | null;
  dueAt: string;
  actionKind: string;
  answeredOptionId: string | null;
  answeredAt: string | null;
  answeredBy: string | null;
}

export interface FakeState {
  tasks: Map<string, FakeTask>;
  actions: FakeAction[];
  cards: Map<string, FakeCard>;
  killSwitch: Map<string, boolean>;
  budgets: Map<string, { category: string; totalLimitUsd: number; dailyLimitUsd: number; spentTotalUsd: number; spentTodayUsd: number }[]>;
  autoRules: Map<string, { id: string; kind: string; maxAmountUsd?: number; category?: string; active: boolean }[]>;
  quotaExhausted: boolean;
  metrics: { companyId: string; metricKey: string; value: number }[];
  ledger: unknown[];
  notifications: unknown[];
  pushSubscriptions: { endpoint: string; p256dh: string; auth: string }[];
  companies: Map<string, { id: string; slug: string; name: string; ownerId: string }>;
  profiles: Map<string, { id: string; email: string; timezone: string; dailyDecisionQuota: number; plan: string }>;
}

export function emptyState(): FakeState {
  return {
    tasks: new Map(),
    actions: [],
    cards: new Map(),
    killSwitch: new Map(),
    budgets: new Map(),
    autoRules: new Map(),
    quotaExhausted: false,
    metrics: [],
    ledger: [],
    notifications: [],
    pushSubscriptions: [],
    companies: new Map(),
    profiles: new Map(),
  };
}

let counter = 0;
export const nextId = (prefix: string): string => `${prefix}-${++counter}`;

/** Minimal PostgREST-like builder for the two raw queries the services make against `actions`. */
function fakeQuery(state: FakeState) {
  const filters: ((a: FakeAction) => boolean)[] = [];
  const api = {
    select: () => api,
    eq: (col: string, value: unknown) => {
      filters.push((a) => (col === "id" ? a.id === value : col === "task_id" ? a.taskId === value : col === "status" ? a.status === value : true));
      return api;
    },
    not: (col: string) => {
      if (col === "task_id") filters.push((a) => a.taskId !== null);
      return api;
    },
    order: () => api,
    limit: () => api,
    rows: () =>
      state.actions
        .filter((a) => filters.every((f) => f(a)))
        .map((a) => ({ id: a.id, payload: a.payload, supersedes: a.supersedes, company_id: a.companyId, task_id: a.taskId })),
    single: async () => ({ data: api.rows()[0] ?? null, error: null }),
    then: (resolve: (v: { data: unknown[]; error: null }) => unknown) => resolve({ data: api.rows(), error: null }),
  };
  return api;
}

export function fakeDbModule(state: FakeState) {
  class DbError extends Error {}
  class QuotaExceededError extends DbError {}
  class AlreadyAnsweredError extends DbError {}
  const must = <T>(value: T | undefined, what: string): T => {
    if (value === undefined) throw new DbError(`${what} not found`);
    return value;
  };
  const setStatus = (taskId: string, status: FakeTask["status"]) => {
    const task = must(state.tasks.get(taskId), "task");
    task.status = status;
    return { ...task };
  };
  return {
    DbError,
    QuotaExceededError,
    AlreadyAnsweredError,
    getTask: vi.fn(async (_db: unknown, id: string) => state.tasks.get(id) ?? null),
    listBudgets: vi.fn(async (_db: unknown, companyId: string) => state.budgets.get(companyId) ?? []),
    listActiveAutoRules: vi.fn(async (_db: unknown, companyId: string) => state.autoRules.get(companyId) ?? []),
    getKillSwitch: vi.fn(async (_db: unknown, companyId: string) => state.killSwitch.get(companyId) ?? false),
    recordAction: vi.fn(async (_db: unknown, input: Record<string, unknown>) => {
      const id = nextId("action");
      state.actions.push({
        id,
        companyId: String(input.companyId),
        taskId: (input.taskId as string | null) ?? null,
        kind: String(input.kind),
        tier: String(input.tier),
        status: String(input.status),
        externalRef: (input.externalRef as string | undefined) ?? null,
        decisionCardId: (input.decisionCardId as string | undefined) ?? null,
        autoRuleId: (input.autoRuleId as string | undefined) ?? null,
        payload: (input.payload as Record<string, unknown>) ?? {},
        supersedes: null,
        createdAt: new Date().toISOString(),
      });
      return id;
    }),
    recordActionTransition: vi.fn(async (_db: unknown, input: { actionId: string; status: string; externalRef?: string; note?: string }) => {
      const prev = must(state.actions.find((a) => a.id === input.actionId), "action");
      const id = nextId("action");
      state.actions.push({ ...prev, id, status: input.status, externalRef: input.externalRef ?? prev.externalRef, payload: { supersedes: prev.id, note: input.note }, supersedes: prev.id, createdAt: new Date().toISOString() });
      return id;
    }),
    openCard: vi.fn(async (_db: unknown, draft: Record<string, unknown>) => {
      if (state.quotaExhausted) throw new QuotaExceededError("quota");
      const id = nextId("card");
      const card: FakeCard = {
        id,
        companyId: String(draft.companyId),
        taskId: (draft.taskId as string | null) ?? null,
        tier: draft.tier as "K2" | "K3",
        question: String(draft.question),
        rationale: String(draft.rationale),
        options: draft.options as { id: string; label: string }[],
        defaultOptionId: (draft.defaultOptionId as string | null) ?? null,
        dueAt: String(draft.dueAt),
        actionKind: String(draft.actionKind),
        answeredOptionId: null,
        answeredAt: null,
        answeredBy: null,
      };
      state.cards.set(id, card);
      return { ...card, seq: state.cards.size };
    }),
    getCard: vi.fn(async (_db: unknown, id: string) => state.cards.get(id) ?? null),
    answerCard: vi.fn(async (_db: unknown, id: string, answer: { optionId: string; answeredBy: string }) => {
      const card = must(state.cards.get(id), "card");
      if (card.answeredAt) throw new AlreadyAnsweredError("answered");
      Object.assign(card, { answeredOptionId: answer.optionId, answeredAt: new Date().toISOString(), answeredBy: answer.answeredBy });
      return { ...card };
    }),
    markTaskWaiting: vi.fn(async (_db: unknown, id: string) => setStatus(id, "waiting_decision")),
    markTaskRunning: vi.fn(async (_db: unknown, id: string) => setStatus(id, "running")),
    markTaskFailed: vi.fn(async (_db: unknown, id: string) => setStatus(id, "failed")),
    markTaskDone: vi.fn(async (_db: unknown, id: string, input: { evidence: unknown; costUsd: number; outputSummary: string }) => {
      const task = must(state.tasks.get(id), "task");
      if (task.status !== "running") throw new DbError(`cannot complete from ${task.status}`);
      Object.assign(task, { status: "done", evidence: input.evidence, costUsd: input.costUsd, outputSummary: input.outputSummary });
      return { ...task };
    }),
    latestMetric: vi.fn(async (_db: unknown, companyId: string, key: string) => {
      const hit = [...state.metrics].reverse().find((m) => m.companyId === companyId && m.metricKey === key);
      return hit ? { value: hit.value } : null;
    }),
    recordMetric: vi.fn(async (_db: unknown, input: { companyId: string; metricKey: string; value: number }) => {
      state.metrics.push(input);
      return nextId("metric");
    }),
    recordLedgerEntry: vi.fn(async (_db: unknown, input: unknown) => {
      state.ledger.push(input);
      return nextId("ledger");
    }),
    companyOwnerId: vi.fn(async (_db: unknown, companyId: string) => must(state.companies.get(companyId), "company").ownerId),
    getCompanyById: vi.fn(async (_db: unknown, companyId: string) => state.companies.get(companyId) ?? null),
    getProfile: vi.fn(async (_db: unknown, userId: string) => state.profiles.get(userId) ?? null),
    listPushSubscriptions: vi.fn(async () => state.pushSubscriptions),
    recordNotification: vi.fn(async (_db: unknown, input: unknown) => {
      state.notifications.push(input);
      return nextId("notification");
    }),
    listTasks: vi.fn(async (_db: unknown, companyId: string, opts: { status?: string[] }) =>
      [...state.tasks.values()].filter((t) => t.companyId === companyId && (!opts.status || opts.status.includes(t.status))),
    ),
  };
}

/** Worker deps around the fake db and real sandbox integrations; sandbox events are collected. */
export function fakeDeps(state: FakeState, events: SandboxEvent[] = []): WorkerDeps {
  const db = { from: (_table: string) => fakeQuery(state) } as unknown as WorkerDeps["db"];
  return {
    env: { WORKSPACE_ROOT: "/tmp/north-test", INTEGRATIONS_MODE: "sandbox" } as WorkerDeps["env"],
    db,
    roles: new Map(),
    runtime: { name: "mock", run: async () => ({ status: "failed", error: "not used", sessionId: null, usage: { model: "mock", inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 } }) },
    integrations: createSandboxIntegrations((e) => void events.push(e)),
  };
}

export function seedTask(state: FakeState, overrides: Partial<FakeTask> = {}): FakeTask {
  const task: FakeTask = {
    id: nextId("task"),
    companyId: "company-1",
    role: "growth",
    taskType: "campaign_spec",
    title: "Launch test",
    status: "running",
    costUsd: 0,
    metricKey: "signups",
    outputSummary: null,
    evidence: null,
    attempts: 1,
    ...overrides,
  };
  state.tasks.set(task.id, task);
  return task;
}

export const adsStart = (overrides: Partial<ActionSpec> = {}): ActionSpec => ({
  kind: "ads.start",
  companyId: "company-1",
  agentRole: "growth",
  description: "Start the $10/day launch test",
  amountUsd: 50,
  category: "ads",
  payload: { name: "Launch test", dailyBudgetUsd: 10, audience: "solo consultants", creativeMarkdown: "# Hi" },
  ...overrides,
});
