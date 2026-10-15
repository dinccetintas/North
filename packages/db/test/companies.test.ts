import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { archiveCompany, companyBySentryProject, getCompanyById, listActiveCompanies, listCompanies, listCompaniesByOwner, setKillSwitch, setSentryProject, unarchiveCompany } from "../src/companies";
import { DbError } from "../src/errors";
import { createCompanyFor, createOwnerWithCompany, createTestUser, deleteTestUser, grantPlan, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("companies repository (M5 additions)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("companies-m5");
    stranger = await createTestUser("companies-m5-stranger");
    // Three companies for one owner: over the Solo trial's limit (M6).
    await grantPlan(owned.owner.id, "pro");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("listActiveCompanies: onboarded, non-archived companies with their owner's zone, brief hour and pause reason; unfinished and archived ones are left out (M6: a paused company is listed, its brief says so)", async () => {
    expect((await listActiveCompanies(service)).some((c) => c.companyId === owned.companyId)).toBe(false);
    await service.from("companies").update({ onboarding_step: "done" }).eq("id", owned.companyId);
    await service.from("users").update({ timezone: "Europe/Istanbul", brief_hour: 9 }).eq("id", owned.owner.id);
    const active = await listActiveCompanies(service);
    const mine = active.find((c) => c.companyId === owned.companyId);
    expect(mine).toEqual({ companyId: owned.companyId, ownerId: owned.owner.id, timezone: "Europe/Istanbul", briefHour: 9, name: "companies-m5 Co", slug: mine?.slug, killSwitchActive: false, pausedReason: null });
    expect(Object.isFrozen(active)).toBe(true);
    expect(Object.isFrozen(mine)).toBe(true);
    const unfinished = await createCompanyFor(owned.owner, "companies-m5-unfinished");
    expect((await listActiveCompanies(service)).some((c) => c.companyId === unfinished)).toBe(false);
    await setKillSwitch(service, owned.companyId, true, "subscription_ended");
    expect((await listActiveCompanies(service)).find((c) => c.companyId === owned.companyId)).toMatchObject({ killSwitchActive: true, pausedReason: "subscription_ended" });
    await setKillSwitch(service, owned.companyId, false);
    expect((await listActiveCompanies(service)).find((c) => c.companyId === owned.companyId)).toMatchObject({ killSwitchActive: false, pausedReason: null });
    await archiveCompany(service, owned.companyId);
    expect((await listActiveCompanies(service)).some((c) => c.companyId === owned.companyId)).toBe(false);
    await unarchiveCompany(service, owned.companyId);
    expect((await listActiveCompanies(service)).find((c) => c.companyId === owned.companyId)?.killSwitchActive).toBe(false);
  });

  it("M6: the pause reason round-trips: the owner's switch reads 'user', billing's 'subscription_ended' cannot be lifted by the owner, the archive is 'retention'", async () => {
    await setKillSwitch(owned.owner.client, owned.companyId, true);
    expect(await getCompanyById(owned.owner.client, owned.companyId)).toMatchObject({ killSwitchActive: true, status: "paused", pausedReason: "user" });
    await setKillSwitch(owned.owner.client, owned.companyId, false);
    expect(await getCompanyById(owned.owner.client, owned.companyId)).toMatchObject({ killSwitchActive: false, status: "active", pausedReason: null });
    await setKillSwitch(service, owned.companyId, true, "subscription_ended");
    await expect(setKillSwitch(owned.owner.client, owned.companyId, false)).rejects.toBeInstanceOf(DbError);
    expect((await listCompanies(owned.owner.client)).find((c) => c.id === owned.companyId)).toMatchObject({ killSwitchActive: true, pausedReason: "subscription_ended" });
    await setKillSwitch(service, owned.companyId, false);
    await setKillSwitch(owned.owner.client, owned.companyId, true);
    await setKillSwitch(service, owned.companyId, true, "subscription_ended");
    expect((await getCompanyById(service, owned.companyId))?.pausedReason).toBe("user");
    await setKillSwitch(service, owned.companyId, false);
    const archived = await archiveCompany(service, owned.companyId);
    expect(archived).toMatchObject({ status: "archived", killSwitchActive: true, pausedReason: "retention" });
    await setKillSwitch(service, owned.companyId, false);
    expect((await getCompanyById(service, owned.companyId))?.status).toBe("archived");
    await expect(archiveCompany(owned.owner.client, owned.companyId)).rejects.toBeInstanceOf(DbError);
    expect(await unarchiveCompany(service, owned.companyId)).toMatchObject({ status: "active", killSwitchActive: false, pausedReason: null });
    await expect(setKillSwitch(service, owned.companyId, true, "nonsense" as never)).rejects.toThrow();
  });

  it("M6: listCompaniesByOwner (the worker's billing effects) lists every company of one owner, oldest first, archived included", async () => {
    const all = await listCompaniesByOwner(service, owned.owner.id);
    expect(all[0]?.id).toBe(owned.companyId);
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.every((c) => "pausedReason" in c)).toBe(true);
    expect(await listCompaniesByOwner(stranger.client, owned.owner.id)).toEqual([]);
  });

  it("setSentryProject (service role) links a Sentry project slug the webhook resolves with companyBySentryProject; slugs are unique; an owner or a stranger cannot set it (M5 review M4)", async () => {
    const slug = `acme-web-${Math.random().toString(36).slice(2, 8)}`;
    expect(await companyBySentryProject(service, slug)).toBeNull();
    await setSentryProject(service, owned.companyId, slug);
    expect((await companyBySentryProject(service, slug))?.id).toBe(owned.companyId);
    expect(await companyBySentryProject(stranger.client, slug)).toBeNull();
    const other = await createCompanyFor(owned.owner, "companies-m5-other");
    await expect(setSentryProject(service, other, slug)).rejects.toBeInstanceOf(DbError);
    await expect(setSentryProject(service, other, "Not A Slug")).rejects.toThrow();
    await expect(setSentryProject(owned.owner.client, other, "owner-claimed")).rejects.toBeInstanceOf(DbError);
    await expect(setSentryProject(stranger.client, owned.companyId, "stranger-slug")).rejects.toBeInstanceOf(DbError);
    expect((await companyBySentryProject(service, slug))?.id).toBe(owned.companyId);
    await setSentryProject(service, owned.companyId, null);
    expect(await companyBySentryProject(service, slug)).toBeNull();
  });

  it("M5 review L3: companyBySentryProject answers null, never throws, for a slug outside the strict form", async () => {
    expect(await companyBySentryProject(service, "Acme Web")).toBeNull();
    expect(await companyBySentryProject(service, "")).toBeNull();
    expect(await companyBySentryProject(service, "-leading")).toBeNull();
  });
});
