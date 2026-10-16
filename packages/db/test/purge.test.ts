import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArtifact } from "../src/artifacts";
import { DbError } from "../src/errors";
import { EXPORTS_BUCKET, exportStoragePath, requestExport } from "../src/exports";
import { listUserStoragePaths, purgeOwner, PurgeRefusedError } from "../src/purge";
import { recordAction } from "../src/actions";
import { addSuppression } from "../src/suppressions";
import { createOwnerWithCompany, deleteTestUser, endEntitlement, raw, service, type OwnedCompany } from "./fixtures";

/** RET-1 (ADR 0016): the smoke-owner cleanup path the worker's purgeOwner and the harnesses follow: storage objects, the function, the auth user. */
describe("purge repository (the one delete path)", () => {
  let owned: OwnedCompany;
  let witness: OwnedCompany;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("purge");
    witness = await createOwnerWithCompany("purge-witness");
    await createArtifact(service, { companyId: owned.companyId, kind: "prd", title: "The PRD", markdown: "# PRD", createdByRole: "strategy_product" });
    const read = await recordAction(service, { companyId: owned.companyId, taskId: null, agentRole: "research", kind: "research", tier: "K0", description: "Read the market", status: "executed" });
    await addSuppression(service, { companyId: owned.companyId, email: "opted-out@example.test", reason: "opt_out", sourceActionId: read });
    await createArtifact(service, { companyId: witness.companyId, kind: "prd", title: "Witness PRD", markdown: "# Witness", createdByRole: "strategy_product" });
    await recordAction(service, { companyId: witness.companyId, taskId: null, agentRole: "research", kind: "research", tier: "K0", description: "Witness reads", status: "executed" });
  });

  afterAll(async () => {
    await deleteTestUser(witness.owner);
  });

  it("listUserStoragePaths names the owner's artifact and export objects only", async () => {
    const exported = await requestExport(owned.owner.client, { userId: owned.owner.id, companyId: null, kind: "full" });
    await raw.storage.from(EXPORTS_BUCKET).upload(exportStoragePath(owned.owner.id, exported.id), new Blob(["PK"]), { contentType: "application/zip" });
    const paths = await listUserStoragePaths(service, owned.owner.id);
    expect(paths).toEqual(
      expect.arrayContaining([
        { bucket: "artifacts", path: `companies/${owned.companyId}/prd/the-prd-v1.md` },
        { bucket: "exports", path: exportStoragePath(owned.owner.id, exported.id) },
      ]),
    );
    expect(paths).toHaveLength(2);
    expect(paths.some((p) => p.path.includes(witness.companyId))).toBe(false);
  });

  it("purgeOwner is refused before retention_until (PurgeRefusedError) and for a reason that is not a label", async () => {
    await expect(purgeOwner(service, owned.owner.id, "smoke")).rejects.toBeInstanceOf(PurgeRefusedError);
    await endEntitlement(owned.owner.id, { retentionPassed: true });
    await expect(purgeOwner(service, owned.owner.id, "Because I said so")).rejects.toThrow();
    await expect(purgeOwner(owned.owner.client, owned.owner.id, "smoke")).rejects.toBeInstanceOf(DbError);
  });

  it("storage first, then the function, then auth.admin.deleteUser: nothing of the owner is left and the witness is untouched", async () => {
    const paths = await listUserStoragePaths(service, owned.owner.id);
    for (const bucket of ["artifacts", "exports"] as const) {
      const names = paths.filter((p) => p.bucket === bucket).map((p) => p.path);
      expect((await raw.storage.from(bucket).remove(names)).error).toBeNull();
    }
    const counts = await purgeOwner(service, owned.owner.id, "smoke");
    expect(counts).toMatchObject({ companies: 1, artifacts: 1, actions: 1, theses: 1, credit_entries: 1, exports: 1, entitlements: 1, users: 1, suppressions: 1 });
    expect(Object.isFrozen(counts)).toBe(true);
    expect((await raw.auth.admin.deleteUser(owned.owner.id)).error).toBeNull();
    expect((await raw.from("companies").select("id").eq("id", owned.companyId)).data).toEqual([]);
    expect((await raw.storage.from("artifacts").download(`companies/${owned.companyId}/prd/the-prd-v1.md`)).data).toBeNull();
    expect((await raw.storage.from("artifacts").download(`companies/${witness.companyId}/prd/witness-prd-v1.md`)).data).not.toBeNull();
    expect((await raw.from("actions").update({ description: "x" }).eq("company_id", witness.companyId)).error?.message).toMatch(/append-only/);
    await expect(purgeOwner(service, owned.owner.id, "smoke")).rejects.toBeInstanceOf(PurgeRefusedError);
  });
});
