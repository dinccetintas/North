import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { companyOwnerId } from "../src/companies";
import { openCard, QuotaExceededError } from "../src/decisions";
import { DbError } from "../src/errors";
import { getProfile, updateProfile } from "../src/users";
import { createCompanyFor, createOwnerWithCompany, createTestUser, deleteTestUser, grantPlan, sampleCardDraft, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("users repository (settings: timezone and decision quota)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("users");
    stranger = await createTestUser("users-stranger");
    // A second company for the quota test: over the Solo trial's limit (M6).
    await grantPlan(owned.owner.id, "pro");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("getProfile returns the auto-created profile with its defaults (the plan mirrors the entitlement, the brief hour is 7), or null when unknown", async () => {
    const profile = await getProfile(owned.owner.client, owned.owner.id);
    expect(profile).toEqual({ id: owned.owner.id, email: owned.owner.email, timezone: "UTC", dailyDecisionQuota: 3, briefHour: 7, plan: "pro" });
    expect(Object.isFrozen(profile)).toBe(true);
    expect(await getProfile(service, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("updateProfile changes the quota within 1..5 and the timezone, returning the new profile", async () => {
    const quota = await updateProfile(owned.owner.client, owned.owner.id, { dailyDecisionQuota: 5 });
    expect(quota).toMatchObject({ dailyDecisionQuota: 5, timezone: "UTC" });
    const tz = await updateProfile(owned.owner.client, owned.owner.id, { timezone: "Europe/Istanbul" });
    expect(tz).toMatchObject({ dailyDecisionQuota: 5, timezone: "Europe/Istanbul" });
    expect(await getProfile(service, owned.owner.id)).toEqual(tz);
  });

  it("BRF-1: updateProfile sets the brief hour within 0..23; 24, -1 and 7.5 are refused before any write", async () => {
    expect(await updateProfile(owned.owner.client, owned.owner.id, { briefHour: 9 })).toMatchObject({ briefHour: 9, timezone: "Europe/Istanbul" });
    expect(await updateProfile(owned.owner.client, owned.owner.id, { briefHour: 0 })).toMatchObject({ briefHour: 0 });
    await expect(updateProfile(owned.owner.client, owned.owner.id, { briefHour: 24 })).rejects.toThrow();
    await expect(updateProfile(owned.owner.client, owned.owner.id, { briefHour: -1 })).rejects.toThrow();
    await expect(updateProfile(owned.owner.client, owned.owner.id, { briefHour: 7.5 })).rejects.toThrow();
    const direct = await owned.owner.client.from("users").update({ brief_hour: 24 }).eq("id", owned.owner.id);
    expect(direct.error?.code).toBe("23514");
    expect((await updateProfile(owned.owner.client, owned.owner.id, { briefHour: 9 })).briefHour).toBe(9);
  });

  it("rejects quotas outside 1..5, unknown timezones and empty patches without writing", async () => {
    await expect(updateProfile(owned.owner.client, owned.owner.id, { dailyDecisionQuota: 0 })).rejects.toThrow();
    await expect(updateProfile(owned.owner.client, owned.owner.id, { dailyDecisionQuota: 6 })).rejects.toThrow();
    await expect(updateProfile(owned.owner.client, owned.owner.id, { dailyDecisionQuota: 2.5 })).rejects.toThrow();
    await expect(updateProfile(owned.owner.client, owned.owner.id, { timezone: "Mars/Olympus" })).rejects.toThrow();
    await expect(updateProfile(owned.owner.client, owned.owner.id, {})).rejects.toThrow();
    expect(await getProfile(service, owned.owner.id)).toMatchObject({ dailyDecisionQuota: 5, timezone: "Europe/Istanbul", briefHour: 9 });
  });

  it("profiles are private: another user reads null and cannot update", async () => {
    expect(await getProfile(stranger.client, owned.owner.id)).toBeNull();
    await expect(updateProfile(stranger.client, owned.owner.id, { dailyDecisionQuota: 1 })).rejects.toBeInstanceOf(DbError);
    expect((await getProfile(service, owned.owner.id))?.dailyDecisionQuota).toBe(5);
  });

  it("DEC-3: the database quota follows the profile (quota 1 admits one card; raising it admits more)", async () => {
    const companyId = await createCompanyFor(owned.owner, "quota-follow");
    await updateProfile(owned.owner.client, owned.owner.id, { dailyDecisionQuota: 1 });
    await openCard(service, { ...sampleCardDraft(companyId), taskId: null });
    await expect(openCard(service, { ...sampleCardDraft(companyId), taskId: null })).rejects.toBeInstanceOf(QuotaExceededError);
    await updateProfile(owned.owner.client, owned.owner.id, { dailyDecisionQuota: 2 });
    expect((await openCard(service, { ...sampleCardDraft(companyId), taskId: null })).seq).toBe(2);
  });

  it("companyOwnerId returns the owner for the worker and throws for unknown companies", async () => {
    expect(await companyOwnerId(service, owned.companyId)).toBe(owned.owner.id);
    expect(await companyOwnerId(owned.owner.client, owned.companyId)).toBe(owned.owner.id);
    await expect(companyOwnerId(stranger.client, owned.companyId)).rejects.toBeInstanceOf(DbError);
    await expect(companyOwnerId(service, "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(DbError);
  });
});
