import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { ARTIFACTS_BUCKET, createArtifact, createCompany, EXPORTS_BUCKET, exportStoragePath, purgeOwner as purgeOwnerRows, PurgeRefusedError, recordAction, requestExport, type Database, type DbClient } from "@north/db";
import { purgeOwner } from "../src/services/purge";

/**
 * RET-1 (D6-7, ADR 0016), integration against the local stack
 * (`source .stack/env`): the worker's one delete path refuses before
 * `retention_until` without touching storage; after it the owner's objects,
 * rows and auth user are gone, `purge_log` has the counts, the append-only
 * triggers are back on. Skipped when the stack is not reachable, unless
 * `REQUIRE_INTEGRATION=1` (then it fails), the `validate.sh` convention.
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function reachable(): Promise<boolean> {
  if (!url || !key) return false;
  try {
    return (await fetch(`${url}/rest/v1/`, { headers: { apikey: key }, signal: AbortSignal.timeout(3000) })).ok;
  } catch {
    return false;
  }
}

const available = await reachable();
if (!available && process.env.REQUIRE_INTEGRATION === "1") throw new Error("purge.test.ts needs the local stack: source .stack/env (scripts/stack/up.sh or pnpm db:start)");

interface Call {
  readonly method: string;
  readonly url: string;
  readonly status: number;
}
const calls: Call[] = [];
const recordingFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init);
  calls.push({ method: init?.method ?? "GET", url: input instanceof Request ? input.url : String(input), status: response.status });
  return response;
};

const DAY = 86_400_000;

describe.skipIf(!available)("purgeOwner against the stack (D6-7)", () => {
  const db = (available ? createClient<Database>(url as string, key as string, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: recordingFetch } }) : null) as DbClient;
  let owner = "";
  let witness = "";
  let companyId = "";
  let witnessCompany = "";
  let exportPath = "";

  const createOwner = async (label: string): Promise<{ userId: string; companyId: string }> => {
    const created = await db.auth.admin.createUser({ email: `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@north.test`, password: `pw-${Date.now()}-Aa1!`, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.message}`);
    const userId = created.data.user.id;
    const company = await createCompany(db, { ownerId: userId, name: `${label} Co ${Date.now().toString(36)}`, thesis: "A company whose thesis is long enough to pass validation." });
    await createArtifact(db, { companyId: company.id, kind: "prd", title: `${label} PRD`, markdown: `# ${label} PRD`, createdByRole: "strategy_product" });
    await recordAction(db, { companyId: company.id, taskId: null, agentRole: "research", kind: "research", tier: "K0", description: "Read the market", status: "executed" });
    return { userId, companyId: company.id };
  };

  const endEntitlement = async (userId: string, endedAgoDays: number): Promise<void> => {
    const endedAt = Date.now() - endedAgoDays * DAY;
    const { error } = await db.from("entitlements").update({ status: "ended", ended_at: new Date(endedAt).toISOString(), retention_until: new Date(endedAt + 90 * DAY).toISOString() }).eq("user_id", userId);
    if (error) throw new Error(`endEntitlement failed: ${error.message}`);
  };

  const rowCount = async (table: "companies" | "users" | "entitlements" | "credit_entries" | "exports" | "actions" | "artifacts", column: string, value: string): Promise<number> => {
    const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).eq(column as never, value as never);
    if (error) throw new Error(`count ${table} failed: ${error.message}`);
    return count ?? 0;
  };

  beforeAll(async () => {
    ({ userId: owner, companyId } = await createOwner("purge-worker"));
    ({ userId: witness, companyId: witnessCompany } = await createOwner("purge-witness"));
    const exported = await requestExport(db, { userId: owner, companyId: null, kind: "full" });
    exportPath = exportStoragePath(owner, exported.id);
    const upload = await db.storage.from(EXPORTS_BUCKET).upload(exportPath, new Blob(["PK"]), { contentType: "application/zip" });
    if (upload.error) throw new Error(`upload failed: ${upload.error.message}`);
  });

  afterAll(async () => {
    if (!witness) return;
    await endEntitlement(witness, 91);
    await purgeOwner({ db }, witness, "test");
  });

  it("is refused before retention_until, and nothing is removed first; the function itself refuses too", async () => {
    await expect(purgeOwner({ db }, owner, "smoke")).rejects.toBeInstanceOf(PurgeRefusedError);
    await endEntitlement(owner, 0);
    await expect(purgeOwner({ db }, owner, "smoke")).rejects.toBeInstanceOf(PurgeRefusedError);
    await expect(purgeOwnerRows(db, owner, "smoke")).rejects.toBeInstanceOf(PurgeRefusedError);
    expect((await db.storage.from(EXPORTS_BUCKET).download(exportPath)).error).toBeNull();
    expect(await rowCount("companies", "owner_id", owner)).toBe(1);
    expect(await rowCount("actions", "company_id", companyId)).toBe(1);
  });

  it("after the date: storage, then purge_owner, then auth.admin.deleteUser (200); purge_log has the counts and nothing of the owner is left", async () => {
    await endEntitlement(owner, 91);
    calls.length = 0;
    const result = await purgeOwner({ db }, owner, "smoke");
    expect(result).toMatchObject({ userId: owner, objectsRemoved: 2, authUserDeleted: true, alreadyPurged: false });
    expect(result.counts).toMatchObject({ companies: 1, artifacts: 1, actions: 1, theses: 1, exports: 1, credit_entries: 1, entitlements: 1, users: 1 });

    const order = calls.map((c) => (c.url.includes("/storage/v1/object/") ? "storage" : c.url.includes("/rpc/purge_owner") ? "rpc" : c.url.includes("/auth/v1/admin/users/") ? "auth" : "read"));
    const effects = order.filter((o) => o !== "read");
    expect(effects).toEqual(["storage", "storage", "rpc", "auth"]);
    expect(calls.find((c) => c.method === "DELETE" && c.url.endsWith(`/auth/v1/admin/users/${owner}`))?.status).toBe(200);

    const hash = createHash("sha256").update(owner).digest("hex");
    const log = await db.from("purge_log").select("reason, counts").eq("user_hash", hash);
    expect(log.error).toBeNull();
    expect(log.data).toEqual([{ reason: "smoke", counts: result.counts }]);

    for (const [table, column, value] of [
      ["companies", "owner_id", owner],
      ["users", "id", owner],
      ["entitlements", "user_id", owner],
      ["credit_entries", "user_id", owner],
      ["exports", "user_id", owner],
      ["actions", "company_id", companyId],
      ["artifacts", "company_id", companyId],
    ] as const) {
      expect(await rowCount(table, column, value), table).toBe(0);
    }
    expect((await db.storage.from(EXPORTS_BUCKET).download(exportPath)).data).toBeNull();
    expect((await db.storage.from(ARTIFACTS_BUCKET).list(`companies/${companyId}/prd`)).data ?? []).toEqual([]);
    expect((await db.auth.admin.getUserById(owner)).data.user).toBeNull();
  });

  it("leaves the witness untouched and the append-only triggers on; a second run only finds the auth user gone", async () => {
    expect(await rowCount("companies", "owner_id", witness)).toBe(1);
    expect(((await db.storage.from(ARTIFACTS_BUCKET).list(`companies/${witnessCompany}/prd`)).data ?? []).length).toBe(1);
    const update = await db.from("actions").update({ description: "rewritten" }).eq("company_id", witnessCompany);
    expect(update.error?.message).toMatch(/append-only/);
    expect(await purgeOwner({ db }, owner, "smoke")).toMatchObject({ alreadyPurged: true, authUserDeleted: false, objectsRemoved: 0 });
  });
});
