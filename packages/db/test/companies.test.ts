import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyBySentryProject, listActiveCompanies, setKillSwitch, setSentryProject } from "../src/companies";
import { DbError } from "../src/errors";
import { createCompanyFor, createOwnerWithCompany, createTestUser, deleteTestUser, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("companies repository (M5 additions)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("companies-m5");
    stranger = await createTestUser("companies-m5-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("listActiveCompanies: active, onboarded companies with their owner's zone; paused or unfinished ones are left out", async () => {
    expect((await listActiveCompanies(service)).some((c) => c.companyId === owned.companyId)).toBe(false);
    await service.from("companies").update({ onboarding_step: "done" }).eq("id", owned.companyId);
    await service.from("users").update({ timezone: "Europe/Istanbul" }).eq("id", owned.owner.id);
    const active = await listActiveCompanies(service);
    const mine = active.find((c) => c.companyId === owned.companyId);
    expect(mine).toEqual({ companyId: owned.companyId, ownerId: owned.owner.id, timezone: "Europe/Istanbul", name: "companies-m5 Co", slug: mine?.slug, killSwitchActive: false });
    expect(Object.isFrozen(active)).toBe(true);
    expect(Object.isFrozen(mine)).toBe(true);
    const unfinished = await createCompanyFor(owned.owner, "companies-m5-unfinished");
    expect((await listActiveCompanies(service)).some((c) => c.companyId === unfinished)).toBe(false);
    await setKillSwitch(service, owned.companyId, true);
    expect((await listActiveCompanies(service)).some((c) => c.companyId === owned.companyId)).toBe(false);
    await setKillSwitch(service, owned.companyId, false);
    expect((await listActiveCompanies(service)).find((c) => c.companyId === owned.companyId)?.killSwitchActive).toBe(false);
    await service.from("companies").update({ kill_switch_active: true }).eq("id", owned.companyId);
    expect((await listActiveCompanies(service)).find((c) => c.companyId === owned.companyId)?.killSwitchActive).toBe(true);
    await service.from("companies").update({ kill_switch_active: false }).eq("id", owned.companyId);
  });

  it("setSentryProject links a Sentry project slug the webhook resolves with companyBySentryProject; slugs are unique", async () => {
    const slug = `acme-web-${Math.random().toString(36).slice(2, 8)}`;
    expect(await companyBySentryProject(service, slug)).toBeNull();
    await setSentryProject(owned.owner.client, owned.companyId, slug);
    expect((await companyBySentryProject(service, slug))?.id).toBe(owned.companyId);
    expect(await companyBySentryProject(stranger.client, slug)).toBeNull();
    const other = await createCompanyFor(owned.owner, "companies-m5-other");
    await expect(setSentryProject(owned.owner.client, other, slug)).rejects.toBeInstanceOf(DbError);
    await expect(setSentryProject(owned.owner.client, other, "Not A Slug")).rejects.toThrow();
    await expect(setSentryProject(stranger.client, owned.companyId, "stranger-slug")).rejects.toBeInstanceOf(DbError);
    expect((await companyBySentryProject(service, slug))?.id).toBe(owned.companyId);
    await setSentryProject(owned.owner.client, owned.companyId, null);
    expect(await companyBySentryProject(service, slug)).toBeNull();
  });
});
