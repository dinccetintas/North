import { randomUUID } from "node:crypto";
import { vi } from "vitest";
import { provenanceKey, type Provenance } from "@north/core";

/**
 * M4 additions to the in-memory `@north/db` stand-in: campaigns (with the
 * `campaigns_within_budget` trigger semantics), budget spend and cap raises,
 * `record_attribution` (dedupe by window, samples, ledger, spend, cap flags),
 * channel samples, leads and the by-kind action listing. Mixed into
 * `fakeDbModule` by `fake-db.ts`.
 */

export interface FakeBudget {
  category: string;
  totalLimitUsd: number;
  dailyLimitUsd: number;
  dailyExtraUsd?: number;
  /** The day the extra belongs to; a raise for an earlier day is not applied (migration 0009). */
  dailyExtraDate?: string;
  spentTotalUsd: number;
  spentTodayUsd: number;
}

export interface FakeCampaign {
  id: string;
  companyId: string;
  taskId: string | null;
  actionId: string;
  provider: "meta_ads" | "google_ads";
  providerCampaignId: string;
  name: string;
  channel: "meta_ads" | "google_ads";
  metricKey: string;
  dailyBudgetUsd: number;
  totalBudgetUsd: number;
  landingUrl: string;
  status: string;
  pausedDay: string | null;
  spentTodayUsd: number;
  spentTotalUsd: number;
  impressions: number;
  clicks: number;
  conversions: number;
  lastCollectedAt: string | null;
  lastError: string | null;
  sandbox: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FakeLead {
  id: string;
  companyId: string;
  name: string;
  email: string;
  companyName: string;
  why: string;
  source: string;
  status: string;
  batchId: string | null;
  messageId: string | null;
  /** 0018: the first-contact action that claimed the lead; null while `new`. */
  contactActionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FakeChannelSample {
  companyId: string;
  metricKey: string;
  value: number;
  provenanceKey: string;
  windowEnd: string;
  provenance: Provenance;
}

export interface M4State {
  budgets: Map<string, FakeBudget[]>;
  campaigns: Map<string, FakeCampaign>;
  leads: Map<string, FakeLead>;
  channelSamples: FakeChannelSample[];
  secrets: Map<string, string>;
  site: { live: string | null; preview: string | null };
}

export const emptyM4State = (): M4State => ({ budgets: new Map(), campaigns: new Map(), leads: new Map(), channelSamples: [], secrets: new Map(), site: { live: null, preview: null } });

export interface FakeActionLike {
  id: string;
  companyId: string;
  taskId: string | null;
  kind: string;
  status: string;
  decisionCardId: string | null;
  supersedes: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface M4Helpers<A extends FakeActionLike> {
  readonly DbError: new (message: string) => Error;
  readonly nextId: (prefix: string) => string;
  readonly actions: () => A[];
  readonly heads: (rows: readonly A[]) => A[];
  readonly toRecord: (a: A) => unknown;
  readonly ledger: () => unknown[];
  /** The base fake's card insert (throws the quota refusal) and action insert, composed by `openFirstContactCard`. */
  readonly openCard: (draft: Record<string, unknown>) => { readonly id: string };
  readonly recordAction: (input: Record<string, unknown>) => string;
}

interface LeadQuery {
  readonly status?: readonly string[];
  readonly emails?: readonly string[];
  readonly limit?: number;
  readonly offset?: number;
}

const effective = (b: FakeBudget) => b.dailyLimitUsd + (b.dailyExtraUsd ?? 0);
const capsOf = (b: FakeBudget) => ({ capDaily: b.spentTodayUsd >= effective(b), capTotal: b.spentTotalUsd >= b.totalLimitUsd });
const spendResult = (b: FakeBudget, applied = true) => ({ spentTodayUsd: b.spentTodayUsd, spentTotalUsd: b.spentTotalUsd, dailyExtraUsd: b.dailyExtraUsd ?? 0, dailyLimitEffectiveUsd: effective(b), totalLimitUsd: b.totalLimitUsd, ...capsOf(b), applied });

export function fakeDbM4<A extends FakeActionLike>(state: M4State, h: M4Helpers<A>) {
  class BudgetCapError extends h.DbError {}
  const budgetOf = (companyId: string, category: string): FakeBudget => {
    const row = (state.budgets.get(companyId) ?? []).find((b) => b.category === category);
    if (!row) throw new h.DbError(`no ${category} budget for ${companyId}`);
    return row;
  };
  const campaign = (id: string): FakeCampaign => {
    const row = state.campaigns.get(id);
    if (!row) throw new h.DbError(`Campaign ${id} not found`);
    return row;
  };
  /** `campaigns_within_budget`: an activation must fit today's effective ads cap and neither cap may be reached. */
  const assertWithinBudget = (row: FakeCampaign) => {
    const b = (state.budgets.get(row.companyId) ?? []).find((x) => x.category === "ads");
    if (!b) throw new BudgetCapError("budget_cap: no ads budget");
    if (row.dailyBudgetUsd > effective(b)) throw new BudgetCapError(`budget_cap: daily budget ${row.dailyBudgetUsd} exceeds ${effective(b)}`);
    const caps = capsOf(b);
    if (caps.capDaily) throw new BudgetCapError(`budget_cap: today's ads cap ${effective(b)} is spent (${b.spentTodayUsd})`);
    if (caps.capTotal) throw new BudgetCapError(`budget_cap: the ads total cap ${b.totalLimitUsd} is spent (${b.spentTotalUsd})`);
  };
  const frozenCampaign = (row: FakeCampaign) => ({ ...row });
  /** 0017 `first_contact_addresses`: `to` and `recipients` of a payload, trimmed and lowercased. */
  const addressesOf = (payload: Record<string, unknown>): string[] =>
    [payload.to, ...(Array.isArray(payload.recipients) ? payload.recipients : [])].filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim().toLowerCase());
  /** 0017 `held_outreach_addresses`: the addresses of every first-contact chain head still `pending`. */
  const heldBy = (companyId: string): Set<string> =>
    new Set(
      h
        .heads(h.actions().filter((a) => a.companyId === companyId && a.kind === "email.send.first_contact"))
        .filter((a) => a.status === "pending")
        .flatMap((a) => addressesOf(a.payload)),
    );
  /** `listLeads` as the repository runs it: oldest first, 500 by default, `offset`, exact `emails` (an empty list matches none). */
  const leadsOf = (companyId: string, q: LeadQuery = {}) =>
    [...state.leads.values()]
      .filter((l) => l.companyId === companyId && (!q.status || q.status.length === 0 || q.status.includes(l.status)) && (!q.emails || q.emails.includes(l.email)))
      .slice(q.offset ?? 0, (q.offset ?? 0) + (q.limit ?? 500))
      .map((l) => ({ ...l }));

  return {
    BudgetCapError,
    getBudget: vi.fn(async (_db: unknown, companyId: string, category: string) => {
      const row = (state.budgets.get(companyId) ?? []).find((b) => b.category === category);
      return row ? { dailyExtraUsd: 0, ...row } : null;
    }),
    applyBudgetSpend: vi.fn(async (_db: unknown, input: { companyId: string; category: string; amountUsd: number }) => {
      const b = budgetOf(input.companyId, input.category);
      b.spentTodayUsd += input.amountUsd;
      b.spentTotalUsd += input.amountUsd;
      return spendResult(b);
    }),
    raiseDailyCap: vi.fn(async (_db: unknown, input: { companyId: string; category: string; amountUsd: number; day?: string }) => {
      const b = budgetOf(input.companyId, input.category);
      if (b.dailyExtraDate && input.day && input.day < b.dailyExtraDate) return spendResult(b, false);
      b.dailyExtraUsd = (b.dailyExtraUsd ?? 0) + input.amountUsd;
      return spendResult(b);
    }),
    raiseTotalCap: vi.fn(async (_db: unknown, input: { companyId: string; category: string; amountUsd: number }) => {
      const b = budgetOf(input.companyId, input.category);
      b.totalLimitUsd += input.amountUsd;
      return spendResult(b);
    }),
    registerCampaign: vi.fn(async (_db: unknown, input: Record<string, unknown>) => {
      const existing = [...state.campaigns.values()].find((c) => c.actionId === input.actionId);
      if (existing) return frozenCampaign(existing);
      const now = new Date().toISOString();
      const row: FakeCampaign = {
        id: randomUUID(),
        companyId: String(input.companyId),
        taskId: (input.taskId as string | null | undefined) ?? null,
        actionId: String(input.actionId),
        provider: input.provider as "meta_ads",
        providerCampaignId: String(input.providerCampaignId),
        name: String(input.name),
        channel: input.provider as "meta_ads",
        metricKey: String(input.metricKey),
        dailyBudgetUsd: Number(input.dailyBudgetUsd),
        totalBudgetUsd: Number(input.totalBudgetUsd),
        landingUrl: String(input.landingUrl ?? ""),
        status: String(input.status ?? "active"),
        pausedDay: null,
        spentTodayUsd: 0,
        spentTotalUsd: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        lastCollectedAt: null,
        lastError: null,
        sandbox: (input.sandbox as boolean | undefined) ?? true,
        createdAt: now,
        updatedAt: now,
      };
      if (row.status === "active") assertWithinBudget(row);
      state.campaigns.set(row.id, row);
      return frozenCampaign(row);
    }),
    getCampaign: vi.fn(async (_db: unknown, companyId: string, id: string) => {
      const row = state.campaigns.get(id);
      return row && row.companyId === companyId ? frozenCampaign(row) : null;
    }),
    getCampaignByProviderId: vi.fn(async (_db: unknown, companyId: string, providerCampaignId: string) => {
      const row = [...state.campaigns.values()].find((c) => c.companyId === companyId && c.providerCampaignId === providerCampaignId);
      return row ? frozenCampaign(row) : null;
    }),
    listCampaigns: vi.fn(async (_db: unknown, companyId: string, opts: { status?: readonly string[] } = {}) =>
      [...state.campaigns.values()].filter((c) => c.companyId === companyId && (!opts.status || opts.status.includes(c.status))).map(frozenCampaign),
    ),
    setCampaignStatus: vi.fn(async (_db: unknown, id: string, status: string, opts: { pausedDay?: string | null; lastError?: string | null } = {}) => {
      const row = campaign(id);
      if (status === "active" && row.status !== "active") assertWithinBudget(row);
      Object.assign(row, { status, updatedAt: new Date().toISOString(), ...(opts.pausedDay === undefined ? {} : { pausedDay: opts.pausedDay }), ...(opts.lastError === undefined ? {} : { lastError: opts.lastError }) });
      return frozenCampaign(row);
    }),
    updateCampaignTotals: vi.fn(async (_db: unknown, id: string, totals: Partial<FakeCampaign>) => {
      const row = campaign(id);
      Object.assign(row, Object.fromEntries(Object.entries(totals).filter(([, v]) => v !== undefined)), { updatedAt: new Date().toISOString() });
      return frozenCampaign(row);
    }),
    listCompaniesWithCollectables: vi.fn(async () => [...new Set([...state.campaigns.values()].filter((c) => c.status === "active" || c.status === "paused_cap").map((c) => c.companyId))]),
    recordAttributionWindow: vi.fn(async (_db: unknown, input: { companyId: string; taskId?: string | null; campaignId?: string | null; actionId?: string | null; metricKey: string; provenance: Provenance; samples?: { metricKey: string; value: number }[]; before: number; after: number; costUsd: number; category?: string | null; note?: string }) => {
      const key = provenanceKey(input.provenance);
      const category = input.category === undefined ? (input.provenance.channel === "cold_email" ? null : "ads") : input.category;
      const windowEnd = input.provenance.windowEnd;
      const caps = () => (category ? capsOf(budgetOf(input.companyId, category)) : { capDaily: false, capTotal: false });
      if (state.channelSamples.some((s) => s.companyId === input.companyId && s.metricKey === input.metricKey && s.provenanceKey === key && s.windowEnd === windowEnd)) {
        return { duplicate: true, entryId: null, ...caps() };
      }
      for (const s of [...(input.samples ?? []), { metricKey: input.metricKey, value: input.after }]) {
        if (!state.channelSamples.some((x) => x.companyId === input.companyId && x.metricKey === s.metricKey && x.provenanceKey === key && x.windowEnd === windowEnd)) {
          state.channelSamples.push({ companyId: input.companyId, metricKey: s.metricKey, value: s.value, provenanceKey: key, windowEnd, provenance: input.provenance });
        }
      }
      const entryId = h.nextId("ledger");
      h.ledger().push({ id: entryId, companyId: input.companyId, taskId: input.taskId ?? null, campaignId: input.campaignId ?? null, actionId: input.actionId ?? null, metricKey: input.metricKey, before: input.before, after: input.after, costUsd: input.costUsd, channel: input.provenance.channel, provenance: input.provenance, note: input.note ?? "" });
      if (category) {
        const b = budgetOf(input.companyId, category);
        b.spentTodayUsd += input.costUsd;
        b.spentTotalUsd += input.costUsd;
      }
      return { duplicate: false, entryId, ...caps() };
    }),
    latestChannelSample: vi.fn(async (_db: unknown, companyId: string, metricKey: string, key: string) => {
      const hits = state.channelSamples.filter((s) => s.companyId === companyId && s.metricKey === metricKey && s.provenanceKey === key).sort((a, b) => b.windowEnd.localeCompare(a.windowEnd));
      const hit = hits[0];
      return hit ? { metricKey: hit.metricKey, value: hit.value, measuredAt: hit.windowEnd, windowEnd: hit.windowEnd, provenanceKey: hit.provenanceKey, provenance: hit.provenance } : null;
    }),
    listChannelSamples: vi.fn(async (_db: unknown, companyId: string, key: string) => state.channelSamples.filter((s) => s.companyId === companyId && s.provenanceKey === key)),
    importLeads: vi.fn(async (_db: unknown, companyId: string, rows: { name: string; email: string; company?: string; why?: string }[], source: string) => {
      let imported = 0;
      for (const r of rows) {
        if ([...state.leads.values()].some((l) => l.companyId === companyId && l.email === r.email)) continue;
        const now = new Date().toISOString();
        const id = randomUUID();
        state.leads.set(id, { id, companyId, name: r.name, email: r.email, companyName: r.company ?? "", why: r.why ?? "", source, status: "new", batchId: null, messageId: null, contactActionId: null, createdAt: now, updatedAt: now });
        imported += 1;
      }
      return { imported, skipped: rows.length - imported };
    }),
    nextUnsentLeads: vi.fn(async (_db: unknown, companyId: string, limit = 5) => [...state.leads.values()].filter((l) => l.companyId === companyId && l.status === "new").slice(0, limit).map((l) => ({ ...l }))),
    heldOutreachRecipients: vi.fn(async (_db: unknown, companyId: string): Promise<ReadonlySet<string>> => heldBy(companyId)),
    leadsFreeForOutreach: vi.fn(async (_db: unknown, companyId: string, limit = 5) => {
      const held = heldBy(companyId);
      return leadsOf(companyId, { status: ["new"], limit: Number.MAX_SAFE_INTEGER }).filter((l) => !held.has(l.email.toLowerCase())).slice(0, limit);
    }),
    countLeadsFreeForOutreach: vi.fn(async (_db: unknown, companyId: string) => {
      const held = heldBy(companyId);
      return leadsOf(companyId, { status: ["new"], limit: Number.MAX_SAFE_INTEGER }).filter((l) => !held.has(l.email.toLowerCase())).length;
    }),
    /** 0017 `open_first_contact_card`: held → nothing written; else the card (quota trigger) and its pending row together. */
    openFirstContactCard: vi.fn(async (_db: unknown, input: { card: Record<string, unknown>; action: Record<string, unknown> }) => {
      const held = heldBy(String(input.card.companyId));
      const taken = addressesOf((input.action.payload as Record<string, unknown> | undefined) ?? {}).sort().find((a) => held.has(a));
      if (taken) return { kind: "held" as const, email: taken };
      const card = h.openCard(input.card);
      const actionId = h.recordAction({ ...input.action, status: "pending", decisionCardId: card.id });
      return { kind: "opened" as const, card, actionId };
    }),
    listLeads: vi.fn(async (_db: unknown, companyId: string, opts: LeadQuery = {}) => leadsOf(companyId, opts)),
    /** 0018: one conditional write; only one action wins, the same one may claim again until its message is recorded. */
    claimLeadForContact: vi.fn(async (_db: unknown, companyId: string, id: string, actionId: string) => {
      const lead = state.leads.get(id);
      const free = lead && lead.companyId === companyId && (lead.status === "new" || (lead.status === "contacted" && lead.contactActionId === actionId && lead.messageId === null));
      if (!lead || !free) return null;
      Object.assign(lead, { status: "contacted", contactActionId: actionId });
      return { ...lead };
    }),
    releaseLeadContact: vi.fn(async (_db: unknown, companyId: string, id: string, actionId: string) => {
      const lead = state.leads.get(id);
      if (!lead || lead.companyId !== companyId || lead.status !== "contacted" || lead.contactActionId !== actionId || lead.messageId !== null) return false;
      Object.assign(lead, { status: "new", contactActionId: null });
      return true;
    }),
    /** 0017 `record_auto_first_contact`: the send's own recipient held → nothing written; else its pending row with the auto rule. */
    recordAutoFirstContact: vi.fn(async (_db: unknown, input: Record<string, unknown>) => {
      const to = addressesOf({ to: (input.payload as Record<string, unknown> | undefined)?.to })[0] ?? "";
      if (heldBy(String(input.companyId)).has(to)) return { kind: "held" as const, email: to };
      return { kind: "recorded" as const, actionId: h.recordAction({ ...input, status: "pending" }) };
    }),
    getLead: vi.fn(async (_db: unknown, companyId: string, id: string) => {
      const lead = state.leads.get(id);
      return lead && lead.companyId === companyId ? { ...lead } : null;
    }),
    markLeads: vi.fn(async (_db: unknown, companyId: string, ids: readonly string[], status: string, opts: { batchId?: string; messageId?: string } = {}) => {
      let n = 0;
      for (const id of ids) {
        const lead = state.leads.get(id);
        if (!lead || lead.companyId !== companyId) continue;
        Object.assign(lead, { status, ...(opts.batchId ? { batchId: opts.batchId } : {}), ...(opts.messageId ? { messageId: opts.messageId } : {}) });
        n += 1;
      }
      return n;
    }),
    countLeads: vi.fn(async (_db: unknown, companyId: string) => [...state.leads.values()].filter((l) => l.companyId === companyId).length),
    pendingActionsForCard: vi.fn(async (_db: unknown, cardId: string) => h.heads(h.actions().filter((a) => a.decisionCardId === cardId)).filter((a) => a.status === "pending").map(h.toRecord)),
    listActionsByKind: vi.fn(async (_db: unknown, companyId: string, kind: string) =>
      h
        .heads(h.actions().filter((a) => a.companyId === companyId && a.kind === kind))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(h.toRecord),
    ),
    siteUrls: vi.fn(async () => ({ ...state.site })),
    storeConnectionSecret: vi.fn(async (_db: unknown, connectionId: string, plaintext: string) => {
      state.secrets.set(connectionId, plaintext);
    }),
    upsertConnection: vi.fn(async (_db: unknown, input: { userId: string; provider: string; scopes?: string[]; accountLabel?: string; status?: string }) => ({ id: `conn-${input.provider}`, userId: input.userId, provider: input.provider, status: input.status ?? "connected", scopes: input.scopes ?? [], accountLabel: input.accountLabel ?? "", createdAt: "", updatedAt: "" })),
    dropConnectionSecret: vi.fn(async (_db: unknown, connectionId: string) => {
      state.secrets.delete(connectionId);
    }),
  };
}
