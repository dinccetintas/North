import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactPathError, PurgeRefusedError } from "@north/db";
import { purgeOwner } from "../src/services/purge";
import { emptyStore, fakeSupabase, rowsOf, type FakeStore, type Row } from "./fake-postgrest";

/**
 * M6 security review M5 (RET-1, ADR 0016), on the in-memory fake: the purge
 * marks itself (`purge_begin`) before anything is removed, reads every row
 * past PostgREST's cap, removes the owner's task workspaces and export
 * scratch directories under WORKSPACE_ROOT, and never follows (or deletes) an
 * artifact path into another company (M2).
 */
const DAY = 86_400_000;

interface World {
  readonly store: FakeStore;
  readonly owner: string;
  readonly company: string;
  readonly witnessCompany: string;
  readonly root: string;
}

function world(artifacts = 2): World {
  const store = emptyStore();
  const owner = randomUUID();
  const witness = randomUUID();
  const root = mkdtempSync(join(tmpdir(), "north-purge-"));
  const ended = new Date(Date.now() - 100 * DAY);
  rowsOf(store, "users").push({ id: owner, email: "ended@north.test" });
  rowsOf(store, "entitlements").push({ user_id: owner, plan_id: "solo", status: "ended", company_limit: 1, monthly_credits: 300, price_usd: 99, period_start: new Date(ended.getTime() - 30 * DAY).toISOString(), period_end: ended.toISOString(), cancel_at: null, stripe_customer_id: null, stripe_subscription_id: null, ended_at: ended.toISOString(), retention_until: new Date(ended.getTime() + 90 * DAY).toISOString(), purge_due: true, last_event_created: null });
  const [company, witnessCompany] = [owner, witness].map((ownerId) => {
    const id = randomUUID();
    rowsOf(store, "companies").push({ id, owner_id: ownerId, name: "Co", slug: `co-${id.slice(0, 6)}` });
    return id;
  }) as [string, string];
  for (let i = 0; i < artifacts; i += 1) {
    const path = `companies/${company}/doc/note-${i}-v1.md`;
    rowsOf(store, "artifacts").push({ id: randomUUID(), company_id: company, storage_path: path });
    store.objects.set(`artifacts/${path}`, new Uint8Array([35]));
  }
  store.objects.set(`artifacts/companies/${witnessCompany}/prd/witness-v1.md`, new Uint8Array([35]));
  rowsOf(store, "artifacts").push({ id: randomUUID(), company_id: witnessCompany, storage_path: `companies/${witnessCompany}/prd/witness-v1.md` });
  store.rpc.set("purge_begin", () => ({ data: new Date().toISOString(), error: null }));
  store.rpc.set("purge_owner", (args: Row) => {
    const owned = new Set(rowsOf(store, "companies").filter((c) => c.owner_id === args.p_user_id).map((c) => c.id));
    const counts: Record<string, number> = {};
    for (const [table, rows] of store.tables) {
      const keep = rows.filter((r) => !(owned.has(r.company_id) || r.owner_id === args.p_user_id || r.user_id === args.p_user_id || r.id === args.p_user_id));
      counts[table] = rows.length - keep.length;
      store.tables.set(table, keep);
    }
    return { data: counts, error: null };
  });
  return { store, owner, company, witnessCompany, root };
}

const deps = (w: World) => ({ db: fakeSupabase(w.store), env: { WORKSPACE_ROOT: w.root } });
const ownerObjects = (w: World): string[] => [...w.store.objects.keys()].filter((k) => k.includes(w.company));

describe("purgeOwner, the worker's one delete path (M6 review M5)", () => {
  it("marks the purge first: purge_begin, then storage, then purge_owner, then the auth user", async () => {
    const w = world();
    const result = await purgeOwner(deps(w), w.owner, "retention");
    expect(w.store.log).toEqual(["rpc:purge_begin", "storage.remove:artifacts", "rpc:purge_owner", "auth.deleteUser"]);
    expect(result).toMatchObject({ objectsRemoved: 2, authUserDeleted: true, alreadyPurged: false });
    expect(ownerObjects(w)).toEqual([]);
    expect(w.store.objects.has(`artifacts/companies/${w.witnessCompany}/prd/witness-v1.md`)).toBe(true);
  });

  it("a refused purge_begin (the database's clock says not yet) removes nothing", async () => {
    const w = world();
    w.store.rpc.set("purge_begin", () => ({ data: null, error: { code: "23514", hint: "retention_not_passed", message: "purge_owner: refused before retention" } }));
    await expect(purgeOwner(deps(w), w.owner, "retention")).rejects.toBeInstanceOf(PurgeRefusedError);
    expect(w.store.log).toEqual(["rpc:purge_begin"]);
    expect(ownerObjects(w)).toHaveLength(2);
  });

  it("reads every artifact past PostgREST's cap (here 10 rows a request; 11 artifacts) and removes every object", async () => {
    const w = world(11);
    w.store.maxRows = 10;
    const result = await purgeOwner(deps(w), w.owner, "retention");
    expect(result.objectsRemoved).toBe(11);
    expect(ownerObjects(w)).toEqual([]);
  });

  it("removes the owner's task workspaces and export scratch directories under WORKSPACE_ROOT; another owner's stay", async () => {
    const w = world();
    const [mine, theirs, exportId] = [randomUUID(), randomUUID(), randomUUID()];
    rowsOf(w.store, "tasks").push({ id: mine, company_id: w.company }, { id: theirs, company_id: w.witnessCompany });
    rowsOf(w.store, "exports").push({ id: exportId, user_id: w.owner });
    for (const dir of [join(w.root, mine), join(w.root, theirs), join(w.root, "exports", exportId)]) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "notes.md"), "# private");
    }
    const result = await purgeOwner(deps(w), w.owner, "retention");
    expect(result.workspacesRemoved).toBe(2);
    expect(existsSync(join(w.root, mine))).toBe(false);
    expect(existsSync(join(w.root, "exports", exportId))).toBe(false);
    expect(existsSync(join(w.root, theirs))).toBe(true);
  });

  it("M2: an artifact row naming another company's object stops the purge before anything is removed", async () => {
    const w = world();
    rowsOf(w.store, "artifacts").push({ id: randomUUID(), company_id: w.company, storage_path: `companies/${w.witnessCompany}/prd/witness-v1.md` });
    await expect(purgeOwner(deps(w), w.owner, "retention")).rejects.toBeInstanceOf(ArtifactPathError);
    expect(w.store.log).toEqual(["rpc:purge_begin"]);
    expect(w.store.objects.has(`artifacts/companies/${w.witnessCompany}/prd/witness-v1.md`)).toBe(true);
    expect(ownerObjects(w)).toHaveLength(2);
  });
});
