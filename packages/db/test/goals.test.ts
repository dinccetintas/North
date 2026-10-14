import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createGoal, listGoals } from "../src/goals";
import { createOwnerWithCompany, createTestUser, deleteTestUser, type OwnedCompany, type TestUser } from "./fixtures";

describe("goals repository (ONB-2)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("goals");
    stranger = await createTestUser("goals-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("createGoal + listGoals round-trip a measurable goal", async () => {
    const { id } = await createGoal(owned.owner.client, owned.companyId, { metricKey: "paying_customers", targetValue: 10, dueDate: "2026-12-31" });
    const goals = await listGoals(owned.owner.client, owned.companyId);
    expect(goals).toEqual([{ id, metricKey: "paying_customers", targetValue: 10, dueDate: "2026-12-31", status: "active" }]);
  });

  it("rejects an unknown metric key and a non-positive target", async () => {
    await expect(createGoal(owned.owner.client, owned.companyId, { metricKey: "likes" as never, targetValue: 1, dueDate: "2026-12-31" })).rejects.toThrow();
    await expect(createGoal(owned.owner.client, owned.companyId, { metricKey: "signups", targetValue: 0, dueDate: "2026-12-31" })).rejects.toThrow();
  });

  it("another owner cannot create or list goals for the company", async () => {
    await expect(createGoal(stranger.client, owned.companyId, { metricKey: "signups", targetValue: 5, dueDate: "2026-12-31" })).rejects.toThrow();
    expect(await listGoals(stranger.client, owned.companyId)).toEqual([]);
  });
});
