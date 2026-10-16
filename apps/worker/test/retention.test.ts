import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { WorkerDeps } from "../src/deps";
import { purgeAllowed, PURGE_CLOCK_MARGIN_MS } from "../src/services/purge";
import { retentionSweep } from "../src/services/retention";
import type { StepRunner } from "../src/services/steps";
import { emptyStore, fakeSupabase, rowsOf, type FakeStore, type Row } from "./fake-postgrest";

/** RET-1 (D6-7, ADR 0016): the sweep archives and flags, purges only with the flag, and expires export objects. */

const DAY = 86_400_000;
const ENDED = new Date(Date.now() - 100 * DAY);
const retentionUntil = new Date(ENDED.getTime() + 90 * DAY);

interface World {
  readonly store: FakeStore;
  readonly owner: string;
  readonly companies: readonly string[];
  readonly deps: (clock: Date, purge?: "0" | "1") => Pick<WorkerDeps, "db" | "env" | "clock">;
}

function world(opts: { retentionUntil?: Date } = {}): World {
  const store = emptyStore();
  const owner = randomUUID();
  rowsOf(store, "users").push({ id: owner, email: "ended@north.test", timezone: "UTC", daily_decision_quota: 3, brief_hour: 7, plan: "solo" });
  rowsOf(store, "entitlements").push({
    user_id: owner,
    plan_id: "solo",
    status: "ended",
    company_limit: 1,
    monthly_credits: 300,
    price_usd: 99,
    period_start: new Date(ENDED.getTime() - 30 * DAY).toISOString(),
    period_end: ENDED.toISOString(),
    cancel_at: null,
    stripe_customer_id: "cus_sandbox_1",
    stripe_subscription_id: null,
    ended_at: ENDED.toISOString(),
    retention_until: (opts.retentionUntil ?? retentionUntil).toISOString(),
    purge_due: false,
    last_event_created: null,
  });
  const companies = [true, false].map((killed, i) => {
    const id = randomUUID();
    rowsOf(store, "companies").push({ id, owner_id: owner, name: `Co ${i}`, slug: `co-${i}`, status: killed ? "paused" : "active", kill_switch_active: killed, paused_reason: killed ? "subscription_ended" : null, created_at: new Date(ENDED.getTime() - (10 - i) * DAY).toISOString() });
    rowsOf(store, "actions").push({ id: randomUUID(), company_id: id, kind: "research", status: "executed" });
    rowsOf(store, "artifacts").push({ id: randomUUID(), company_id: id, storage_path: `companies/${id}/prd/p-v1.md` });
    store.objects.set(`artifacts/companies/${id}/prd/p-v1.md`, new Uint8Array([35]));
    return id;
  });
  store.rpc.set("purge_begin", () => ({ data: new Date().toISOString(), error: null }));
  // 0016's billing_events_sweep_unknown: unapplied rows no user owns, older than p_before (the database clamps it to 30 days on its own clock).
  store.rpc.set("billing_events_sweep_unknown", (args: Row) => {
    const before = Math.min(Date.parse(String(args.p_before)), Date.now() - 30 * DAY);
    const rows = rowsOf(store, "billing_events");
    const keep = rows.filter((r) => !(r.user_id === null && r.applied_at === null && Date.parse(String(r.received_at)) < before));
    store.tables.set("billing_events", keep);
    return { data: rows.length - keep.length, error: null };
  });
  store.rpc.set("purge_owner", (args: Row) => {
    const userId = String(args.p_user_id);
    const owned = new Set(rowsOf(store, "companies").filter((c) => c.owner_id === userId).map((c) => c.id));
    const counts: Record<string, number> = {};
    for (const [table, rows] of store.tables) {
      const keep = rows.filter((r) => !(owned.has(r.company_id) || r.owner_id === userId || r.user_id === userId || r.id === userId));
      counts[table] = rows.length - keep.length;
      store.tables.set(table, keep);
    }
    return { data: counts, error: null };
  });
  const deps = (clock: Date, purge: "0" | "1" = "0") => ({ db: fakeSupabase(store), env: { RETENTION_PURGE_ENABLED: purge } as WorkerDeps["env"], clock: () => clock });
  return { store, owner, companies, deps };
}

const companyRows = (w: World): Row[] => rowsOf(w.store, "companies").filter((c) => c.owner_id === w.owner);
const entitlementOf = (w: World): Row | undefined => rowsOf(w.store, "entitlements").find((e) => e.user_id === w.owner);

describe("retention-sweep (D6-7)", () => {
  it("does nothing before the 90 days have passed", async () => {
    const w = world({ retentionUntil: new Date(Date.now() + DAY) });
    const result = await retentionSweep(w.deps(new Date()));
    expect(result).toEqual({ exportsRemoved: [], billingEventsSwept: 0, archived: [], stopped: [], purgeDue: [], purged: [], purgeSkipped: [] });
    expect(companyRows(w).map((c) => c.status)).toEqual(["paused", "active"]);
    expect(entitlementOf(w)?.purge_due).toBe(false);
  });

  it("archives every company and flags purge_due after them, once; a company still running is stopped too", async () => {
    const w = world();
    const result = await retentionSweep(w.deps(new Date()));
    expect(result.archived).toEqual(w.companies);
    expect(result.stopped).toEqual([w.companies[1]]);
    expect(result.purgeDue).toEqual([w.owner]);
    expect(companyRows(w).map((c) => [c.status, c.kill_switch_active, c.paused_reason])).toEqual([
      ["archived", true, "retention"],
      ["archived", true, "retention"],
    ]);
    expect(entitlementOf(w)?.purge_due).toBe(true);
    // Without RETENTION_PURGE_ENABLED nothing else happened (the billing-events sweep always runs).
    expect(w.store.log).toEqual(["rpc:billing_events_sweep_unknown"]);
    expect(rowsOf(w.store, "actions")).toHaveLength(2);
    expect(w.store.objects.size).toBe(2);
    const again = await retentionSweep(w.deps(new Date()));
    expect(again).toMatchObject({ archived: [], stopped: [], purgeDue: [], purged: [] });
  });

  it("uses the worker clock for the sweep: a simulated +91 days archives an owner whose date is still ahead in wall time", async () => {
    const w = world({ retentionUntil: new Date(Date.now() + 30 * DAY) });
    const result = await retentionSweep(w.deps(new Date(Date.now() + 31 * DAY), "1"));
    expect(result.archived).toHaveLength(2);
    // The purge decides on the database's clock: refused, and nothing was removed first.
    expect(result.purged).toEqual([]);
    expect(result.purgeSkipped).toEqual([{ userId: w.owner, skipped: expect.stringMatching(/refused/) }]);
    expect(w.store.log).toEqual(["rpc:billing_events_sweep_unknown"]);
    expect(w.store.objects.size).toBe(2);
  });

  it("purges only with RETENTION_PURGE_ENABLED=1: the purge mark, storage, then purge_owner, then the auth user", async () => {
    const w = world();
    const result = await retentionSweep(w.deps(new Date(), "1"));
    expect(result.purged).toEqual([{ userId: w.owner, counts: expect.objectContaining({ companies: 2, actions: 2, users: 1, entitlements: 1 }) }]);
    expect(w.store.log).toEqual(["rpc:billing_events_sweep_unknown", "rpc:purge_begin", "storage.remove:artifacts", "rpc:purge_owner", "auth.deleteUser"]);
    expect(w.store.deletedAuthUsers).toEqual([w.owner]);
    expect(w.store.objects.size).toBe(0);
    expect(companyRows(w)).toEqual([]);
  });

  it("an expired export's object is removed and the row expired; a live one is kept", async () => {
    const w = world({ retentionUntil: new Date(Date.now() + DAY) });
    const now = new Date();
    const exportRow = (expiresAt: Date): string => {
      const id = randomUUID();
      const path = `users/${w.owner}/exports/${id}.zip`;
      rowsOf(w.store, "exports").push({ id, user_id: w.owner, company_id: null, kind: "full", include_archived: false, status: "ready", storage_path: path, bytes: 10, manifest: { files: [], companies: [], generatedAt: now.toISOString() }, error: null, expires_at: expiresAt.toISOString(), created_at: now.toISOString() });
      w.store.objects.set(`exports/${path}`, new Uint8Array([80, 75]));
      return id;
    };
    const expired = exportRow(new Date(now.getTime() - 1000));
    const live = exportRow(new Date(now.getTime() + DAY));
    const result = await retentionSweep(w.deps(now));
    expect(result.exportsRemoved).toEqual([expired]);
    const statuses = Object.fromEntries(rowsOf(w.store, "exports").map((e) => [e.id, e.status]));
    expect(statuses).toEqual({ [expired]: "expired", [live]: "ready" });
    expect(w.store.objects.has(`exports/users/${w.owner}/exports/${expired}.zip`)).toBe(false);
    expect(w.store.objects.has(`exports/users/${w.owner}/exports/${live}.zip`)).toBe(true);
  });

  it("M6 review L2: unapplied billing events no user owns are swept after 30 days in their own step; younger or owned ones stay", async () => {
    const w = world({ retentionUntil: new Date(Date.now() + DAY) });
    const event = (userId: string | null, ageDays: number, applied = false): string => {
      const id = randomUUID();
      rowsOf(w.store, "billing_events").push({ id, event_id: `evt_${id}`, type: "invoice.paid", user_id: userId, payload: {}, received_at: new Date(Date.now() - ageDays * DAY).toISOString(), applied_at: applied ? new Date().toISOString() : null });
      return id;
    };
    const [old, young, owned, applied] = [event(null, 31), event(null, 29), event(w.owner, 31), event(null, 31, true)];
    const steps: string[] = [];
    const recording: StepRunner = { run: (id, fn) => (steps.push(id), fn()) };
    // The simulated worker clock may run ahead; the database's own clock decides (29 days stays).
    const result = await retentionSweep(w.deps(new Date(Date.now() + 10 * DAY)), recording);
    expect(result.billingEventsSwept).toBe(1);
    expect(steps).toContain("billing-events");
    expect(rowsOf(w.store, "billing_events").map((e) => e.id).sort()).toEqual([young, owned, applied].sort());
    expect(rowsOf(w.store, "billing_events").some((e) => e.id === old)).toBe(false);
  });

  it("purgeAllowed mirrors purge_owner: ended and past retention_until on the wall clock, with a minute's margin", () => {
    const now = new Date();
    const at = (ms: number) => new Date(now.getTime() + ms).toISOString();
    expect(purgeAllowed({ status: "ended", retentionUntil: at(-PURGE_CLOCK_MARGIN_MS - 1) }, now)).toBe(true);
    expect(purgeAllowed({ status: "ended", retentionUntil: at(-1000) }, now)).toBe(false);
    expect(purgeAllowed({ status: "active", retentionUntil: at(-DAY) }, now)).toBe(false);
    expect(purgeAllowed({ status: "ended", retentionUntil: null }, now)).toBe(false);
  });
});
