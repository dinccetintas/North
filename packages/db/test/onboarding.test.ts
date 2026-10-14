import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DbError } from "../src/errors";
import { getOnboardingStep, setOnboardingStep } from "../src/onboarding";
import { createOwnerWithCompany, createTestUser, deleteTestUser, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("onboarding repository (ONB-1/2)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("onboarding");
    stranger = await createTestUser("onboarding-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("a new company starts at the questions step", async () => {
    expect(await getOnboardingStep(owned.owner.client, owned.companyId)).toBe("questions");
  });

  it("setOnboardingStep advances the step for the owner", async () => {
    await setOnboardingStep(owned.owner.client, owned.companyId, "goal");
    expect(await getOnboardingStep(owned.owner.client, owned.companyId)).toBe("goal");
    expect(await getOnboardingStep(service, owned.companyId)).toBe("goal");
  });

  it("rejects an unknown step without touching the row", async () => {
    await expect(setOnboardingStep(owned.owner.client, owned.companyId, "launch" as never)).rejects.toThrow();
    expect(await getOnboardingStep(owned.owner.client, owned.companyId)).toBe("goal");
  });

  it("another owner can neither read nor change the step", async () => {
    await expect(getOnboardingStep(stranger.client, owned.companyId)).rejects.toBeInstanceOf(DbError);
    await expect(setOnboardingStep(stranger.client, owned.companyId, "done")).rejects.toBeInstanceOf(DbError);
    expect(await getOnboardingStep(service, owned.companyId)).toBe("goal");
  });
});
