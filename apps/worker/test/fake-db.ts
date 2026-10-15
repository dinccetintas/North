import { vi } from "vitest";
import { transition, type ActionSpec, type TaskEvent } from "@north/core";
import { MOCK_LLM_RESPONSES, MockLlm } from "@north/agents";
import type { WorkerDeps } from "../src/deps";
import { SimClock } from "../src/services/clock";
import { createSandboxIntegrations, type SandboxEvent } from "@north/integrations";
import { emptyM4State, fakeDbM4, type M4State } from "./fake-db-m4";
import { emptyM5State, fakeDbM5, type M5State } from "./fake-db-m5";

export type { FakeBudget, FakeCampaign, FakeLead } from "./fake-db-m4";
export type { FakeSignal, FakeBrief, FakePlan, FakeArtifact } from "./fake-db-m5";

/**
 * In-memory stand-in for the `@north/db` repositories the services use.
 * Tests install it with `vi.mock("@north/db", () => fakeDbModule(state))`; the
 * state object is shared so assertions can read what was written. Task status
 * changes run the real core state machine, so illegal transitions surface here
 * exactly as they would against Postgres.
 */

export interface FakeTask {
  id: string;
  companyId: string;
  planId: string | null;
  role: string;
  taskType: string;
  title: string;
  input: string;
  status: "queued" | "running" | "waiting_decision" | "done" | "failed";
  costUsd: number;
  metricKey: string | null;
  outputSummary: string | null;
  evidence: unknown;
  attempts: number;
  lastError: string | null;
  result: { artifactIds: string[]; costUsd: number; summary: string };
  createdAt: string;
}

export interface FakeAction {
  id: string;
  companyId: string;
  taskId: string | null;
  agentRole: string;
  kind: string;
  tier: "K0" | "K1" | "K2" | "K3";
  description: string;
  status: string;
  externalRef: string | null;
  decisionCardId: string | null;
  autoRuleId: string | null;
  sandbox: boolean;
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
  /** The worker's clock at opening (M5); `day` is its UTC date here, the owner-local date in Postgres. */
  openedAt: string;
  day: string;
  actionKind: string;
  answeredOptionId: string | null;
  answeredAt: string | null;
  answeredBy: string | null;
}

export interface FakeConnection {
  id: string;
  status: string;
  scopes: string[];
  accountLabel: string;
}

export interface FakeState extends M4State, M5State {
  tasks: Map<string, FakeTask>;
  actions: FakeAction[];
  cards: Map<string, FakeCard>;
  killSwitch: Map<string, boolean>;
  autoRules: Map<string, { id: string; kind: string; maxAmountUsd?: number; category?: string; active: boolean }[]>;
  quotaExhausted: boolean;
  metrics: { companyId: string; metricKey: string; value: number; source?: string; scope?: string; measuredAt?: string }[];
  ledger: unknown[];
  notifications: unknown[];
  pushSubscriptions: { endpoint: string; p256dh: string; auth: string }[];
  companies: Map<string, { id: string; slug: string; name: string; ownerId: string }>;
  profiles: Map<string, { id: string; email: string; timezone: string; dailyDecisionQuota: number; plan: string }>;
  memory: { companyId: string; item: unknown; createdByRole?: string; createdAt?: string }[];
}

export function emptyState(): FakeState {
  return { ...emptyM4State(), ...emptyM5State(), tasks: new Map(), actions: [], cards: new Map(), killSwitch: new Map(), autoRules: new Map(), quotaExhausted: false, metrics: [], ledger: [], notifications: [], pushSubscriptions: [], companies: new Map(), profiles: new Map(), memory: [] };
}

let counter = 0;
export const nextId = (prefix: string): string => `${prefix}-${++counter}`;

const heads = (rows: readonly FakeAction[]): FakeAction[] => {
  const superseded = new Set(rows.flatMap((a) => (a.supersedes ? [a.supersedes] : [])));
  return rows.filter((a) => !superseded.has(a.id));
};

/** `companies` rows the pipeline reads for the site name. */
function fakeCompanyQuery(state: FakeState) {
  let id: string | null = null;
  const api = {
    select: () => api,
    eq: (_col: string, value: unknown) => {
      id = String(value);
      return api;
    },
    single: async () => {
      const company = id ? state.companies.get(id) : undefined;
      return company ? { data: { name: company.name, slug: company.slug }, error: null } : { data: null, error: { message: "no rows" } };
    },
  };
  return api;
}

/** Minimal PostgREST-like builder for the raw `actions` queries the services make. */
function fakeQuery(state: FakeState) {
  const filters: ((a: FakeAction) => boolean)[] = [];
  const api = {
    select: () => api,
    eq: (col: string, value: unknown) => {
      filters.push((a) => (col === "id" ? a.id === value : col === "task_id" ? a.taskId === value : col === "status" ? a.status === value : col === "decision_card_id" ? a.decisionCardId === value : true));
      return api;
    },
    in: (col: string, values: unknown[]) => {
      filters.push((a) => (col === "supersedes" ? values.includes(a.supersedes) : col === "id" ? values.includes(a.id) : true));
      return api;
    },
    contains: (_col: string, value: Record<string, unknown>) => {
      filters.push((a) => Object.entries(value).every(([k, v]) => a.payload[k] === v));
      return api;
    },
    not: (col: string) => {
      if (col === "task_id") filters.push((a) => a.taskId !== null);
      return api;
    },
    order: () => api,
    limit: () => api,
    rows: () => state.actions.filter((a) => filters.every((f) => f(a))).map((a) => ({ id: a.id, payload: a.payload, status: a.status, kind: a.kind, supersedes: a.supersedes, company_id: a.companyId, task_id: a.taskId, decision_card_id: a.decisionCardId })),
    single: async () => {
      const row = api.rows()[0];
      return row ? { data: row, error: null } : { data: null, error: { message: "no rows" } };
    },
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
  const apply = (taskId: string, event: TaskEvent) => {
    const task = must(state.tasks.get(taskId), "task");
    const next = transition({ status: task.status, attempts: task.attempts, evidence: task.evidence as never }, event);
    Object.assign(task, { status: next.status, attempts: next.attempts, evidence: next.evidence });
    return { ...task };
  };
  const toRecord = (a: FakeAction) => ({ ...a, payload: { ...a.payload } });
  const makeTask = (input: Record<string, unknown>): FakeTask => ({ ...seedTaskRow(), ...input } as FakeTask);
  const m5 = fakeDbM5(state, { DbError, nextId, tasks: () => state.tasks, makeTask, cards: () => [...state.cards.values()], companies: () => state.companies, killSwitch: () => state.killSwitch, memory: () => state.memory, metrics: () => state.metrics, ledger: () => state.ledger });
  return {
    ...fakeDbM4(state, { DbError, nextId, actions: () => state.actions, heads, toRecord, ledger: () => state.ledger }),
    ...m5,
    DbError,
    QuotaExceededError,
    AlreadyAnsweredError,
    getTask: vi.fn(async (_db: unknown, id: string) => {
      const task = state.tasks.get(id);
      return task ? { ...task, result: { ...task.result, artifactIds: [...task.result.artifactIds] } } : null;
    }),
    saveTaskResult: vi.fn(async (_db: unknown, id: string, result: FakeTask["result"]) => {
      const task = must(state.tasks.get(id), "task");
      task.result = { artifactIds: [...result.artifactIds], costUsd: result.costUsd, summary: result.summary };
      task.outputSummary = result.summary;
    }),
    listBudgets: vi.fn(async (_db: unknown, companyId: string) => (state.budgets.get(companyId) ?? []).map((b) => ({ dailyExtraUsd: 0, ...b }))),
    listActiveAutoRules: vi.fn(async (_db: unknown, companyId: string) => state.autoRules.get(companyId) ?? []),
    getKillSwitch: vi.fn(async (_db: unknown, companyId: string) => state.killSwitch.get(companyId) ?? false),
    recordAction: vi.fn(async (_db: unknown, input: Record<string, unknown>) => {
      const tier = String(input.tier) as FakeAction["tier"];
      const status = String(input.status);
      const authority = Boolean(input.decisionCardId) || Boolean(input.autoRuleId);
      if (((tier === "K2" && !authority) || (tier === "K3" && !input.decisionCardId)) && status !== "blocked") throw new DbError("actions_tier_requires_authority");
      const id = nextId("action");
      state.actions.push({
        id,
        companyId: String(input.companyId),
        taskId: (input.taskId as string | null) ?? null,
        agentRole: String(input.agentRole),
        kind: String(input.kind),
        tier,
        description: String(input.description),
        status,
        externalRef: (input.externalRef as string | undefined) ?? null,
        decisionCardId: (input.decisionCardId as string | undefined) ?? null,
        autoRuleId: (input.autoRuleId as string | undefined) ?? null,
        sandbox: (input.sandbox as boolean | undefined) ?? true,
        payload: (input.payload as Record<string, unknown>) ?? {},
        supersedes: null,
        createdAt: new Date().toISOString(),
      });
      return id;
    }),
    recordActionTransition: vi.fn(async (_db: unknown, input: { actionId: string; status: string; externalRef?: string; note?: string }) => {
      const prev = must(state.actions.find((a) => a.id === input.actionId), "action");
      if (state.actions.some((a) => a.supersedes === prev.id)) throw new DbError("actions_supersedes_idx");
      const authority = Boolean(prev.decisionCardId) || Boolean(prev.autoRuleId);
      if (((prev.tier === "K2" && !authority) || (prev.tier === "K3" && !prev.decisionCardId)) && input.status !== "blocked") throw new DbError("actions_tier_requires_authority");
      const id = nextId("action");
      state.actions.push({ ...prev, id, status: input.status, externalRef: input.externalRef ?? prev.externalRef, payload: { supersedes: prev.id, note: input.note }, supersedes: prev.id, createdAt: new Date().toISOString() });
      return id;
    }),
    headActionsForTask: vi.fn(async (_db: unknown, taskId: string) => heads(state.actions.filter((a) => a.taskId === taskId)).map(toRecord)),
    listRecentActions: vi.fn(async (_db: unknown, companyId: string) =>
      heads(state.actions.filter((a) => a.companyId === companyId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(toRecord),
    ),
    pendingActionForCard: vi.fn(async (_db: unknown, cardId: string) => {
      const head = heads(state.actions.filter((a) => a.decisionCardId === cardId)).find((a) => a.status === "pending");
      return head ? toRecord(head) : null;
    }),
    openCard: vi.fn(async (_db: unknown, draft: Record<string, unknown>) => {
      if (state.quotaExhausted) throw new QuotaExceededError("quota");
      const id = nextId("card");
      const openedAt = typeof draft.openedAt === "string" ? draft.openedAt : new Date().toISOString();
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
        openedAt,
        day: openedAt.slice(0, 10),
        actionKind: String(draft.actionKind),
        answeredOptionId: null,
        answeredAt: null,
        answeredBy: null,
      };
      state.cards.set(id, card);
      return { ...card, seq: state.cards.size };
    }),
    getCard: vi.fn(async (_db: unknown, id: string) => (state.cards.get(id) ? { ...state.cards.get(id) } : null)),
    listPendingCardsForTask: vi.fn(async (_db: unknown, taskId: string) => [...state.cards.values()].filter((c) => c.taskId === taskId && !c.answeredAt).map((c) => ({ ...c }))),
    listCards: vi.fn(async (_db: unknown, companyId: string) => [...state.cards.values()].filter((c) => c.companyId === companyId).map((c) => ({ ...c }))),
    listOverdueCards: vi.fn(async (_db: unknown, now: Date = new Date()) => [...state.cards.values()].filter((c) => !c.answeredAt && Date.parse(c.dueAt) < now.getTime()).map((c) => ({ ...c }))),
    answerCard: vi.fn(async (_db: unknown, id: string, answer: { optionId: string; answeredBy: string }) => {
      const card = must(state.cards.get(id), "card");
      if (card.answeredAt) throw new AlreadyAnsweredError("answered");
      if (answer.answeredBy === "default" && (card.tier === "K3" || card.defaultOptionId !== answer.optionId)) throw new DbError("default must be the safe default");
      Object.assign(card, { answeredOptionId: answer.optionId, answeredAt: new Date().toISOString(), answeredBy: answer.answeredBy });
      return { ...card };
    }),
    markTaskWaiting: vi.fn(async (_db: unknown, id: string) => apply(id, { type: "wait_decision" })),
    markTaskRunning: vi.fn(async (_db: unknown, id: string) => apply(id, must(state.tasks.get(id), "task").status === "waiting_decision" ? { type: "resume" } : { type: "start" })),
    markTaskFailed: vi.fn(async (_db: unknown, id: string, reason: string) => {
      const task = apply(id, { type: "fail", reason });
      Object.assign(must(state.tasks.get(id), "task"), { lastError: reason });
      return { ...task, lastError: reason };
    }),
    markTaskDone: vi.fn(async (_db: unknown, id: string, input: { evidence: never; costUsd: number; outputSummary: string }) => {
      const task = apply(id, { type: "complete", evidence: input.evidence });
      Object.assign(must(state.tasks.get(id), "task"), { costUsd: input.costUsd, outputSummary: input.outputSummary });
      return task;
    }),
    latestMetric: vi.fn(async (_db: unknown, companyId: string, key: string) => {
      const hit = [...state.metrics].reverse().find((m) => m.companyId === companyId && m.metricKey === key);
      return hit ? { value: hit.value } : null;
    }),
    recordMetric: vi.fn(async (_db: unknown, input: { companyId: string; metricKey: string; value: number; source: string }) => {
      state.metrics.push({ ...input, measuredAt: new Date().toISOString() });
    }),
    recordLedgerEntry: vi.fn(async (_db: unknown, input: Record<string, unknown>) => {
      const id = nextId("ledger");
      state.ledger.push({ id, createdAt: new Date().toISOString(), ...input });
      return id;
    }),
    companyOwnerId: vi.fn(async (_db: unknown, companyId: string) => must(state.companies.get(companyId), "company").ownerId),
    getCompanyById: vi.fn(async (_db: unknown, companyId: string) => {
      const company = state.companies.get(companyId);
      return company ? { ...company, status: "active", killSwitchActive: state.killSwitch.get(companyId) ?? false } : null;
    }),
    getProfile: vi.fn(async (_db: unknown, userId: string) => state.profiles.get(userId) ?? null),
    getConnection: vi.fn(async (_db: unknown, _userId: string, _provider: string): Promise<FakeConnection | null> => null),
    readConnectionSecret: vi.fn(async (_db: unknown, _connectionId: string): Promise<string> => "token"),
    setConnectionStatus: vi.fn(async () => undefined),
    SANDBOX_SCOPE: "sandbox",
    listPushSubscriptions: vi.fn(async () => state.pushSubscriptions),
    recordNotification: vi.fn(async (_db: unknown, input: unknown) => {
      state.notifications.push(input);
      return nextId("notification");
    }),
    writeMemoryItems: vi.fn(async (_db: unknown, companyId: string, items: unknown[], createdByRole = "research") => {
      state.memory.push(...items.map((item) => ({ companyId, item, createdByRole, createdAt: new Date().toISOString() })));
    }),
    getArtifact: vi.fn(async (_db: unknown, id: string) => (id.startsWith("art-") ? { id, title: "Artifact", version: 1 } : null)),
    createArtifact: vi.fn(async (_db: unknown, input: { companyId: string; kind: string; title: string; createdByRole: string }) => ({ ...m5.recordArtifact(input.companyId, input.kind, input.title, input.createdByRole) })),
    recordAgentRun: vi.fn(async () => undefined),
    currentThesis: vi.fn(async () => ({ text: "Bookkeeping for solo consultants.", targetCustomer: "solo consultants", whyNow: "now" })),
    listGoals: vi.fn(async () => []),
    memoryDigest: vi.fn(async () => "Thesis: Bookkeeping for solo consultants."),
    listTasks: vi.fn(async (_db: unknown, companyId: string, opts: { status?: string[] }) => [...state.tasks.values()].filter((t) => t.companyId === companyId && (!opts.status || opts.status.includes(t.status)))),
  };
}

/**
 * Worker deps around the fake db and real sandbox integrations; sandbox events
 * are collected; URL checks answer 200 unless told otherwise. `mode: "live"`
 * keeps the sandbox adapters but makes the services look up the owner's
 * connections (ONB-3 connect cards).
 */
export function fakeDeps(state: FakeState, events: SandboxEvent[] = [], verifyStatus = 200, mode: "sandbox" | "live" = "sandbox", root = "/tmp/north-test-sandbox", clock: SimClock = new SimClock()): WorkerDeps {
  const db = { from: (table: string) => (table === "companies" ? fakeCompanyQuery(state) : fakeQuery(state)) } as unknown as WorkerDeps["db"];
  const sandbox = createSandboxIntegrations((e) => void events.push(e), { root, siteBaseUrl: "http://127.0.0.1:3101", clock: () => clock.now() });
  return {
    env: { WORKSPACE_ROOT: "/tmp/north-test", INTEGRATIONS_MODE: mode } as WorkerDeps["env"],
    db,
    roles: new Map(),
    runtime: { name: "mock", run: async () => ({ status: "failed", error: "not used", sessionId: null, usage: { model: "mock", inputTokens: 0, outputTokens: 0, costUsd: 0, durationMs: 0 } }) },
    integrations: mode === "sandbox" ? sandbox : { ...sandbox, mode },
    verifier: { fetchImpl: async () => new Response("ok", { status: verifyStatus }), timeoutMs: 1000, allowedOrigins: ["http://127.0.0.1:3101"], allowPrivate: true },
    clock: () => clock.now(),
    simClock: clock,
    llm: MockLlm.fromRecord({ ...MOCK_LLM_RESPONSES }),
  };
}

export { directSteps } from "../src/services/steps";

const seedTaskRow = (): FakeTask => ({
  id: nextId("task"),
  companyId: "company-1",
  planId: null,
  role: "growth",
  taskType: "campaign_spec",
  title: "Launch test",
  input: "",
  status: "running",
  costUsd: 0,
  metricKey: "signups",
  outputSummary: null,
  evidence: null,
  attempts: 1,
  lastError: null,
  result: { artifactIds: [], costUsd: 0, summary: "" },
  createdAt: new Date().toISOString(),
});

export function seedTask(state: FakeState, overrides: Partial<FakeTask> = {}): FakeTask {
  const task: FakeTask = { ...seedTaskRow(), ...overrides };
  state.tasks.set(task.id, task);
  return task;
}

/** A company with its owner's profile and zone, listed for the proactive crons. */
export function seedCompany(state: FakeState, overrides: { id?: string; slug?: string; name?: string; ownerId?: string; timezone?: string; email?: string } = {}): string {
  const id = overrides.id ?? "company-1";
  const ownerId = overrides.ownerId ?? "user-1";
  const slug = overrides.slug ?? "lumen";
  const name = overrides.name ?? "Lumen";
  state.companies.set(id, { id, slug, name, ownerId });
  state.profiles.set(ownerId, { id: ownerId, email: overrides.email ?? "ceo@example.test", timezone: overrides.timezone ?? "UTC", dailyDecisionQuota: 3, plan: "free" });
  state.activeCompanies.push({ companyId: id, ownerId, timezone: overrides.timezone ?? "UTC", name, slug, killSwitchActive: false });
  return id;
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
