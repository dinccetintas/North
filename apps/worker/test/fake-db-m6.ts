import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { CREDIT_GRACE, trialEntitlement, trialGrant, type CreditEntryDraft, type Entitlement, type PausedReason, type Usage } from "@north/core";
import { NO_TRACER } from "../src/observability";

/**
 * M6 additions to the in-memory `@north/db` stand-in (BIL-1, BIL-2): one
 * entitlement per user (seeded lazily as the auth trigger does: a Solo trial
 * and its 300 credits), the credit ledger with the `-CREDIT_GRACE` floor,
 * billing sessions and events (unique by Stripe event id), usage months,
 * paused reasons and archives on companies, the owner's brief hour. Mixed
 * into `fakeDbModule` last, so its company readers win.
 */

export interface FakeBillingSession {
  id: string;
  userId: string;
  kind: "checkout" | "portal" | "credit_pack";
  planId: "solo" | "pro" | "scale" | null;
  packId: string | null;
  status: "requested" | "ready" | "failed";
  url: string | null;
  providerRef: string | null;
  error: string | null;
}

export interface FakeBillingEvent {
  id: string;
  eventId: string;
  type: string;
  userId: string | null;
  payload: Record<string, unknown>;
  receivedAt: string;
  appliedAt: string | null;
}

export interface M6State {
  entitlements: Map<string, Entitlement>;
  credits: Map<string, CreditEntryDraft[]>;
  billingSessions: Map<string, FakeBillingSession>;
  billingEvents: Map<string, FakeBillingEvent>;
  usage: Map<string, Usage>;
  pausedReasons: Map<string, PausedReason>;
  archived: Set<string>;
  /** Owner id → `users.brief_hour` (default 7). */
  briefHours: Map<string, number>;
}

export const emptyM6State = (): M6State => ({ entitlements: new Map(), credits: new Map(), billingSessions: new Map(), billingEvents: new Map(), usage: new Map(), pausedReasons: new Map(), archived: new Set(), briefHours: new Map() });

export interface M6Helpers {
  readonly DbError: new (message: string) => Error;
  readonly companies: () => Map<string, { id: string; slug: string; name: string; ownerId: string }>;
  readonly killSwitch: () => Map<string, boolean>;
  readonly activeCompanies: () => { companyId: string; ownerId: string; timezone: string; name: string; slug: string; killSwitchActive: boolean }[];
  /** Users that exist (a profile row): only they get the auth trigger's trial. */
  readonly hasUser: (userId: string) => boolean;
  readonly notifications: () => unknown[];
}

export { NO_TRACER };

const sum = (entries: readonly CreditEntryDraft[]): number => entries.reduce((s, e) => s + e.amount, 0);

/** `select user_id from entitlements where stripe_customer_id = …` as the raw worker lookup reads it. */
export function fakeEntitlementsQuery(state: M6State) {
  let customer: string | null = null;
  const api = {
    select: () => api,
    eq: (_col: string, value: unknown) => {
      customer = String(value);
      return api;
    },
    maybeSingle: async () => {
      const hit = [...state.entitlements.values()].find((e) => e.stripeCustomerId === customer);
      return { data: hit ? { user_id: hit.userId } : null, error: null };
    },
  };
  return api;
}

export function fakeDbM6(state: M6State, h: M6Helpers) {
  class CreditFloorError extends h.DbError {}
  const ensureUser = (userId: string): Entitlement | null => {
    const known = state.entitlements.get(userId);
    if (known) return known;
    if (!h.hasUser(userId)) return null;
    const trial = trialEntitlement(userId, new Date());
    state.entitlements.set(userId, trial);
    if (!state.credits.has(userId)) state.credits.set(userId, [trialGrant(userId)]);
    return trial;
  };
  const ownerOf = (companyId: string): string | null => h.companies().get(companyId)?.ownerId ?? null;
  const statusOf = (companyId: string): string => (state.archived.has(companyId) ? "archived" : h.killSwitch().get(companyId) ? "paused" : "active");
  const summary = (c: { id: string; slug: string; name: string; ownerId: string }) => ({ id: c.id, name: c.name, slug: c.slug, ownerId: c.ownerId, status: statusOf(c.id), killSwitchActive: h.killSwitch().get(c.id) ?? false, pausedReason: state.pausedReasons.get(c.id) ?? null });
  const session = (id: string): FakeBillingSession => {
    const row = state.billingSessions.get(id);
    if (!row) throw new h.DbError(`Billing session ${id} not found`);
    return row;
  };
  const settle = (id: string, patch: Partial<FakeBillingSession>, accept: FakeBillingSession["status"]) => {
    const row = session(id);
    if (row.status === "requested") Object.assign(row, patch);
    else if (row.status !== accept) throw new h.DbError(`Billing session ${id} is not requested (status ${row.status})`);
    return { ...row };
  };
  const usageKey = (userId: string, period: string): string => `${userId}:${period}`;
  const copy = (e: Entitlement | null): Entitlement | null => (e ? { ...e } : null);

  return {
    CreditFloorError,
    getEntitlement: vi.fn(async (_db: unknown, userId: string) => copy(ensureUser(userId))),
    getEntitlementForCompany: vi.fn(async (_db: unknown, companyId: string) => {
      const owner = ownerOf(companyId);
      return owner ? copy(ensureUser(owner)) : null;
    }),
    upsertEntitlement: vi.fn(async (_db: unknown, entitlement: Entitlement) => {
      state.entitlements.set(entitlement.userId, { ...entitlement });
      return { ...entitlement };
    }),
    listTrialsToEnd: vi.fn(async (_db: unknown, now: Date) => [...state.entitlements.values()].filter((e) => e.status === "trialing" && e.stripeSubscriptionId === null && Date.parse(e.periodEnd) <= now.getTime()).map((e) => ({ ...e }))),
    setStripeCustomer: vi.fn(async (_db: unknown, userId: string, customerId: string) => {
      const current = ensureUser(userId);
      if (!current) throw new h.DbError(`Entitlement of ${userId} not found`);
      if (current.stripeCustomerId !== null && current.stripeCustomerId !== customerId) throw new h.DbError(`User ${userId} already has Stripe customer ${current.stripeCustomerId}`);
      const next = { ...current, stripeCustomerId: customerId };
      state.entitlements.set(userId, next);
      return { ...next };
    }),
    getBillingSession: vi.fn(async (_db: unknown, id: string) => (state.billingSessions.has(id) ? { ...session(id) } : null)),
    setBillingSessionReady: vi.fn(async (_db: unknown, id: string, ready: { url: string; providerRef: string | null }) => settle(id, { status: "ready", url: ready.url, providerRef: ready.providerRef }, "ready")),
    setBillingSessionFailed: vi.fn(async (_db: unknown, id: string, message: string) => settle(id, { status: "failed", error: message }, "failed")),
    insertBillingEvent: vi.fn(async (_db: unknown, input: { eventId: string; type: string; userId: string | null; payload: Record<string, unknown> }) => {
      const existing = [...state.billingEvents.values()].find((e) => e.eventId === input.eventId);
      if (existing) return { id: existing.id, duplicate: true };
      const id = randomUUID();
      state.billingEvents.set(id, { id, eventId: input.eventId, type: input.type, userId: input.userId, payload: structuredClone(input.payload), receivedAt: new Date().toISOString(), appliedAt: null });
      return { id, duplicate: false };
    }),
    markBillingEventApplied: vi.fn(async (_db: unknown, id: string) => {
      const row = state.billingEvents.get(id);
      if (!row || row.appliedAt !== null) return false;
      row.appliedAt = new Date().toISOString();
      return true;
    }),
    getBillingEvent: vi.fn(async (_db: unknown, id: string) => {
      const row = state.billingEvents.get(id);
      return row ? { ...row, payload: structuredClone(row.payload) } : null;
    }),
    insertCreditEntries: vi.fn(async (_db: unknown, userId: string, drafts: readonly CreditEntryDraft[]) => {
      ensureUser(userId);
      const entries = state.credits.get(userId) ?? [];
      const inserted: string[] = [];
      for (const draft of drafts) {
        if (entries.some((e) => e.ref === draft.ref)) continue;
        if (draft.kind === "consume" && sum(entries) + draft.amount < -CREDIT_GRACE) throw new CreditFloorError(`Credit floor reached: ${draft.ref}`);
        entries.push({ ...draft });
        inserted.push(draft.ref);
      }
      state.credits.set(userId, entries);
      return inserted;
    }),
    creditBalance: vi.fn(async (_db: unknown, userId: string) => {
      ensureUser(userId);
      return sum(state.credits.get(userId) ?? []);
    }),
    applyUsage: vi.fn(async (_db: unknown, input: { userId: string; period: string; credits: number; costUsd: number; sandboxMinutes: number }) => {
      const key = usageKey(input.userId, input.period);
      const prev = state.usage.get(key) ?? { userId: input.userId, period: input.period, creditsUsed: 0, llmCostUsd: 0, sandboxMinutes: 0, alertedAt: null };
      const next = { ...prev, creditsUsed: prev.creditsUsed + input.credits, llmCostUsd: prev.llmCostUsd + input.costUsd, sandboxMinutes: prev.sandboxMinutes + input.sandboxMinutes };
      state.usage.set(key, next);
      return { ...next };
    }),
    getUsage: vi.fn(async (_db: unknown, userId: string, period: string) => {
      const row = state.usage.get(usageKey(userId, period));
      return row ? { ...row } : null;
    }),
    listUsageToAlert: vi.fn(async (_db: unknown, periods: readonly string[]) => [...state.usage.values()].filter((u) => periods.includes(u.period) && u.alertedAt === null).map((u) => ({ ...u }))),
    markUsageAlerted: vi.fn(async (_db: unknown, userId: string, period: string, at: Date) => {
      const row = state.usage.get(usageKey(userId, period));
      if (!row || row.alertedAt !== null) return false;
      state.usage.set(usageKey(userId, period), { ...row, alertedAt: at.toISOString() });
      return true;
    }),
    setKillSwitch: vi.fn(async (_db: unknown, companyId: string, active: boolean, reason?: PausedReason) => {
      if (state.archived.has(companyId)) return;
      const on = h.killSwitch().get(companyId) ?? false;
      if (active && reason === "subscription_ended" && on) return;
      h.killSwitch().set(companyId, active);
      if (active) state.pausedReasons.set(companyId, reason ?? state.pausedReasons.get(companyId) ?? "user");
      else state.pausedReasons.delete(companyId);
    }),
    listCompaniesByOwner: vi.fn(async (_db: unknown, ownerId: string) => [...h.companies().values()].filter((c) => c.ownerId === ownerId).map(summary)),
    unarchiveCompany: vi.fn(async (_db: unknown, companyId: string) => {
      state.archived.delete(companyId);
      state.pausedReasons.delete(companyId);
      h.killSwitch().set(companyId, false);
      return summary(h.companies().get(companyId) ?? { id: companyId, slug: companyId, name: companyId, ownerId: "" });
    }),
    getCompanyById: vi.fn(async (_db: unknown, companyId: string) => {
      const company = h.companies().get(companyId);
      return company ? summary(company) : null;
    }),
    listNotifications: vi.fn(async (_db: unknown, companyId: string, limit = 50) =>
      (h.notifications() as { companyId: string; payload?: Record<string, unknown> }[])
        .filter((n) => n.companyId === companyId)
        .reverse()
        .slice(0, limit)
        .map((n) => ({ ...n, payload: { ...(n.payload ?? {}) } })),
    ),
    listActiveCompanies: vi.fn(async () =>
      h
        .activeCompanies()
        .filter((c) => !state.archived.has(c.companyId))
        .map((c) => ({ ...c, briefHour: state.briefHours.get(c.ownerId) ?? 7, killSwitchActive: h.killSwitch().get(c.companyId) ?? c.killSwitchActive, pausedReason: state.pausedReasons.get(c.companyId) ?? null })),
    ),
  };
}
