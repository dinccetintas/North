import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ARTIFACTS_BUCKET, listArtifacts } from "../src/artifacts";
import { archiveCompany, setKillSwitch, unarchiveCompany } from "../src/companies";
import { DbError } from "../src/errors";
import { EXPORT_DAILY_CAP, ExportRefusedError, requestExport, setExportFailed } from "../src/exports";
import { beginPurge, listUserStoragePaths, listUserTaskIds, purgeOwner, PurgeRefusedError } from "../src/purge";
import { createOwnerWithCompany, createTestUser, deleteTestUser, endEntitlement, grantPlan, raw, service, type OwnedCompany, type RawClient, type TestUser } from "./fixtures";
import { maxRowsServiceClient, POSTGREST_MAX_ROWS } from "./max-rows";

/**
 * M6 security review M4 (the export rate limit), M5 (paging past PostgREST's
 * 1000 rows; the purge holds the entitlement `ended` while it runs) and L3
 * (no pause is lifted while the subscription has ended), in
 * 0015_m6_storage_hardening.sql and the repositories.
 */
const asRaw = (user: TestUser): RawClient => user.client as unknown as RawClient;
const HOUR = 3_600_000;

describe("M6 review M4: one open export and five a day per user (EXP-1)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("export-limit");
    stranger = await createTestUser("export-limit-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  const request = () => requestExport(owned.owner.client, { userId: owned.owner.id, companyId: null, kind: "full" });
  const refusal = async (): Promise<ExportRefusedError> => {
    const error = await request().then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ExportRefusedError);
    return error as ExportRefusedError;
  };
  const age = async (ids: readonly string[], ms: number) => expect((await raw.from("exports").update({ created_at: new Date(Date.now() - ms).toISOString() }).in("id", [...ids])).error).toBeNull();

  it("a second request while one is requested or running is refused with a clear message; a stale one (over an hour) does not block", async () => {
    const first = await request();
    const busy = await refusal();
    expect(busy.reason).toBe("in_progress");
    expect(busy.message).toMatch(/already being built/);
    await raw.from("exports").update({ status: "running" }).eq("id", first.id);
    expect((await refusal()).reason).toBe("in_progress");
    await age([first.id], 2 * HOUR);
    const second = await request();
    await setExportFailed(service, second.id, "The export could not be built. Request a new one.");
  });

  it("the sixth request inside 24 hours is refused; a day later the owner may export again", async () => {
    const made: string[] = (await raw.from("exports").select("id").eq("user_id", owned.owner.id)).data!.map((r) => r.id);
    while (made.length < EXPORT_DAILY_CAP) {
      const next = await request();
      made.push(next.id);
      await setExportFailed(service, next.id, "The export could not be built. Request a new one.");
    }
    const capped = await refusal();
    expect(capped.reason).toBe("daily_cap");
    expect(capped.message).toMatch(new RegExp(`at most ${EXPORT_DAILY_CAP} exports`, "i"));
    await age(made, 25 * HOUR);
    expect((await request()).status).toBe("requested");
  });

  it("another user's id is refused as a policy violation, never with that user's export state", async () => {
    const forged = await asRaw(owned.owner).from("exports").insert({ user_id: stranger.id, kind: "data" });
    expect(forged.error?.code).toBe("42501");
    expect(forged.error?.message).not.toMatch(/already being built|at most/);
  });
});

describe("M6 review M5 and L3: the purge holds the entitlement, paging past 1000 rows, no pause lifted while ended (RET-1, BIL-1)", () => {
  let owned: OwnedCompany;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("purge-hold");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
  });

  it("L3: while the entitlement is ended nobody lifts any pause (the owner's own included); an active one lets it go", async () => {
    await setKillSwitch(owned.owner.client, owned.companyId, true);
    await endEntitlement(owned.owner.id);
    const lift = await asRaw(owned.owner).from("companies").update({ kill_switch_active: false, status: "active" }).eq("id", owned.companyId);
    expect(lift.error?.code).toBe("23514");
    expect(lift.error?.message).toMatch(/subscription has ended/);
    await expect(setKillSwitch(service, owned.companyId, false)).rejects.toBeInstanceOf(DbError);
    await archiveCompany(service, owned.companyId);
    await expect(unarchiveCompany(service, owned.companyId)).rejects.toBeInstanceOf(DbError);
    await grantPlan(owned.owner.id, "solo");
    expect(await unarchiveCompany(service, owned.companyId)).toMatchObject({ status: "active", killSwitchActive: false });
    await setKillSwitch(owned.owner.client, owned.companyId, true);
    await setKillSwitch(owned.owner.client, owned.companyId, false);
  });

  it("M5: listUserStoragePaths, listArtifacts and listUserTaskIds read every row past PostgREST's 1000 (1 001 artifacts)", async () => {
    const rows = Array.from({ length: POSTGREST_MAX_ROWS + 1 }, (_, i) => ({ company_id: owned.companyId, kind: "doc", title: `Note ${i}`, version: 1, storage_path: `companies/${owned.companyId}/doc/note-${i}-v1.md`, created_by_role: "research" }));
    expect((await raw.from("artifacts").insert(rows)).error).toBeNull();
    const tasks = Array.from({ length: POSTGREST_MAX_ROWS + 1 }, (_, i) => ({ company_id: owned.companyId, role: "research", task_type: "market_report", title: `Task ${i}` }));
    expect((await raw.from("tasks").insert(tasks)).error).toBeNull();
    const capped = maxRowsServiceClient();
    const paths = await listUserStoragePaths(capped.client, owned.owner.id);
    expect(paths.filter((p) => p.bucket === ARTIFACTS_BUCKET)).toHaveLength(POSTGREST_MAX_ROWS + 1);
    expect(new Set(paths.map((p) => p.path)).size).toBe(paths.length);
    expect(await listArtifacts(capped.client, owned.companyId)).toHaveLength(POSTGREST_MAX_ROWS + 1);
    expect(await listUserTaskIds(capped.client, owned.owner.id)).toHaveLength(POSTGREST_MAX_ROWS + 1);
    expect(capped.cut).toEqual([]);
    expect(Math.max(...capped.limits)).toBeLessThanOrEqual(POSTGREST_MAX_ROWS);
  });

  it("M5: purge_begin is refused before retention and to owners; once begun the entitlement stays ended until the purge deletes it", async () => {
    await endEntitlement(owned.owner.id);
    await expect(beginPurge(service, owned.owner.id)).rejects.toBeInstanceOf(PurgeRefusedError);
    expect((await asRaw(owned.owner).rpc("purge_begin", { p_user_id: owned.owner.id })).error).not.toBeNull();
    await endEntitlement(owned.owner.id, { retentionPassed: true });
    await archiveCompany(service, owned.companyId);
    const started = await beginPurge(service, owned.owner.id);
    expect(await beginPurge(service, owned.owner.id)).toBe(started);

    const entitlement = () => raw.from("entitlements").update({ status: "active", ended_at: null, retention_until: null }).eq("user_id", owned.owner.id);
    const reactivate = await entitlement();
    expect(reactivate.error?.code).toBe("23514");
    expect(reactivate.error?.message).toMatch(/purge is running/);
    expect((await raw.from("entitlements").update({ retention_until: new Date(Date.now() + 86_400_000).toISOString() }).eq("user_id", owned.owner.id)).error?.message).toMatch(/purge is running/);
    expect((await raw.from("entitlements").update({ purge_started_at: null }).eq("user_id", owned.owner.id)).error?.message).toMatch(/purge is running/);
    expect((await raw.from("entitlements").update({ purge_due: true }).eq("user_id", owned.owner.id)).error).toBeNull();
    await expect(grantPlan(owned.owner.id, "pro")).rejects.toThrow(/purge is running/);
    await expect(unarchiveCompany(service, owned.companyId)).rejects.toBeInstanceOf(DbError);

    const counts = await purgeOwner(service, owned.owner.id, "test");
    expect(counts).toMatchObject({ artifacts: POSTGREST_MAX_ROWS + 1, tasks: POSTGREST_MAX_ROWS + 1, entitlements: 1, users: 1 });
    expect((await raw.storage.from(ARTIFACTS_BUCKET).list(`companies/${owned.companyId}/doc`)).data ?? []).toEqual([]);
  });
});
