import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { artifactSlug, createArtifact, getArtifact, getArtifactMarkdown, listArtifacts } from "../src/artifacts";
import { createOwnerWithCompany, createTestUser, deleteTestUser, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("artifacts repository (ART)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;
  const markdownV1 = "# Market report\n\nClinics: 12,000 in TR. Ünïcödé ok.\n";
  const markdownV2 = "# Market report v2\n\nRevised numbers.\n";

  beforeAll(async () => {
    owned = await createOwnerWithCompany("artifacts");
    stranger = await createTestUser("artifacts-stranger");
  });

  afterAll(async () => {
    const paths = (await listArtifacts(service, owned.companyId)).map((a) => a.storagePath);
    if (paths.length > 0) await service.storage.from("artifacts").remove(paths);
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("createArtifact uploads markdown under companies/<id>/<kind>/<slug>-v1.md and records v1", async () => {
    const created = await createArtifact(service, { companyId: owned.companyId, kind: "market_report", title: "Market Report: Clinics", markdown: markdownV1, createdByRole: "research" });
    expect(created).toMatchObject({ companyId: owned.companyId, kind: "market_report", title: "Market Report: Clinics", version: 1, createdByRole: "research" });
    expect(created.storagePath).toBe(`companies/${owned.companyId}/market_report/market-report-clinics-v1.md`);
    expect(await getArtifact(owned.owner.client, created.id)).toEqual(created);
  });

  it("the same title again becomes v2 and both markdown bodies round-trip through Storage", async () => {
    const v2 = await createArtifact(service, { companyId: owned.companyId, kind: "market_report", title: "Market Report: Clinics", markdown: markdownV2, createdByRole: "research" });
    expect(v2.version).toBe(2);
    expect(v2.storagePath.endsWith("-v2.md")).toBe(true);
    const list = await listArtifacts(owned.owner.client, owned.companyId);
    expect(list.map((a) => a.version)).toEqual([2, 1]);
    expect(await getArtifactMarkdown(owned.owner.client, v2.id)).toBe(markdownV2);
    expect(await getArtifactMarkdown(owned.owner.client, list[1]!.id)).toBe(markdownV1);
  });

  it("the service client can read the markdown and a missing artifact yields null", async () => {
    const [newest] = await listArtifacts(service, owned.companyId);
    expect(await getArtifactMarkdown(service, newest!.id)).toBe(markdownV2);
    expect(await getArtifactMarkdown(service, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("another owner cannot list, read or upload into the company's folder", async () => {
    const [artifact] = await listArtifacts(service, owned.companyId);
    expect(await listArtifacts(stranger.client, owned.companyId)).toEqual([]);
    expect(await getArtifactMarkdown(stranger.client, artifact!.id)).toBeNull();
    const direct = await stranger.client.storage.from("artifacts").download(artifact!.storagePath);
    expect(direct.error).not.toBeNull();
    await expect(createArtifact(stranger.client, { companyId: owned.companyId, kind: "doc", title: "Forged", markdown: "x", createdByRole: "research" })).rejects.toThrow();
  });

  it("artifactSlug is file-safe and never empty", () => {
    expect(artifactSlug("  PRD — Çok güzel / v1 ")).toBe("prd-cok-guzel-v1");
    expect(artifactSlug("***")).toBe("artifact");
  });
});
