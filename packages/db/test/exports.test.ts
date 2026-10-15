import type { ExportManifest } from "@north/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DbError } from "../src/errors";
import {
  EXPORTS_BUCKET,
  exportStoragePath,
  getExport,
  listExpiredExports,
  listExports,
  requestExport,
  setExportExpired,
  setExportFailed,
  setExportReady,
  setExportRunning,
  signExportUrl,
} from "../src/exports";
import { createOwnerWithCompany, createTestUser, deleteTestUser, raw, service, type OwnedCompany, type TestUser } from "./fixtures";

const manifest = (slug: string): ExportManifest => ({ files: [{ path: `data/${slug}/ledger.csv`, bytes: 12, kind: "csv" }], companies: [{ slug, repoUrl: "sandbox://repos/acme/site" }], generatedAt: "2026-11-09T10:00:00.000Z" });

describe("exports repository (EXP-1, MEM-2, RET-1)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("exports");
    stranger = await createTestUser("exports-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("the owner requests an export of one company or all; the worker moves it requested → running → ready", async () => {
    const all = await requestExport(owned.owner.client, { userId: owned.owner.id, companyId: null, kind: "full" });
    expect(all).toMatchObject({ userId: owned.owner.id, companyId: null, kind: "full", includeArchived: false, status: "requested", storagePath: null, bytes: null, manifest: null, expiresAt: null });
    expect(Object.isFrozen(all)).toBe(true);
    const one = await requestExport(owned.owner.client, { userId: owned.owner.id, companyId: owned.companyId, kind: "artifacts" });
    await expect(requestExport(owned.owner.client, { userId: owned.owner.id, companyId: null, kind: "everything" as never })).rejects.toThrow();
    await expect(requestExport(stranger.client, { userId: stranger.id, companyId: owned.companyId, kind: "data" })).rejects.toBeInstanceOf(DbError);
    expect((await listExports(owned.owner.client, owned.owner.id)).map((e) => e.id)).toEqual([one.id, all.id]);
    expect(await listExports(stranger.client, owned.owner.id)).toEqual([]);
    expect(await getExport(stranger.client, all.id)).toBeNull();

    expect((await setExportRunning(service, all.id))?.status).toBe("running");
    expect(await setExportRunning(service, all.id)).toBeNull();
    await expect(setExportRunning(owned.owner.client, one.id)).rejects.toBeInstanceOf(DbError);
    const path = exportStoragePath(owned.owner.id, all.id);
    expect(path).toBe(`users/${owned.owner.id}/exports/${all.id}.zip`);
    await raw.storage.from(EXPORTS_BUCKET).upload(path, new Blob(["PK-full"], { type: "application/zip" }), { contentType: "application/zip" });
    const expiresAt = "2026-11-16T10:00:00.000Z";
    const ready = await setExportReady(service, all.id, { storagePath: path, bytes: 7, manifest: manifest("exports-co"), expiresAt });
    expect(ready).toMatchObject({ status: "ready", storagePath: path, bytes: 7, manifest: manifest("exports-co"), expiresAt });
    await expect(setExportReady(service, one.id, { storagePath: exportStoragePath(stranger.id, one.id), bytes: 1, manifest: manifest("x"), expiresAt })).rejects.toBeInstanceOf(DbError);
    await expect(setExportReady(service, one.id, { storagePath: path, bytes: 1, manifest: { files: [{ path: "../etc/passwd", bytes: 1, kind: "md" }], companies: [], generatedAt: expiresAt }, expiresAt })).rejects.toThrow();
    expect(await setExportFailed(service, one.id, "The export could not be built.")).toMatchObject({ status: "failed", error: "The export could not be built." });
  });

  it("signExportUrl gives the owner a one-hour download link and a stranger nothing", async () => {
    const ready = (await listExports(owned.owner.client, owned.owner.id)).find((e) => e.status === "ready")!;
    const url = await signExportUrl(owned.owner.client, ready, 3600);
    expect(url).toEqual(expect.any(String));
    const body = await fetch(url!);
    expect(await body.text()).toBe("PK-full");
    expect(await signExportUrl(stranger.client, ready, 3600)).toBeNull();
    const failed = (await listExports(owned.owner.client, owned.owner.id)).find((e) => e.status === "failed")!;
    expect(await signExportUrl(owned.owner.client, failed, 3600)).toBeNull();
    await expect(signExportUrl(owned.owner.client, ready, 7200)).rejects.toThrow();
  });

  it("listExpiredExports finds ready exports past their date; setExportExpired retires them", async () => {
    const ready = (await listExports(service, owned.owner.id)).find((e) => e.status === "ready")!;
    expect((await listExpiredExports(service, new Date("2026-11-16T09:59:00.000Z"))).some((e) => e.id === ready.id)).toBe(false);
    expect((await listExpiredExports(service, new Date("2026-11-16T10:00:00.000Z"))).some((e) => e.id === ready.id)).toBe(true);
    expect(await setExportExpired(service, ready.id)).toMatchObject({ status: "expired" });
    expect((await listExpiredExports(service, new Date("2027-01-01T00:00:00.000Z"))).some((e) => e.id === ready.id)).toBe(false);
    expect(await signExportUrl(owned.owner.client, (await getExport(owned.owner.client, ready.id))!, 3600)).toBeNull();
  });
});
