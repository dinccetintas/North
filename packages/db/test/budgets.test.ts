import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listBudgets, toBudgetState, upsertBudgets } from "../src/budgets";
import { createOwnerWithCompany, deleteTestUser, service, type OwnedCompany } from "./fixtures";

describe("budgets repository (ONB-2, BUD)", () => {
  let owned: OwnedCompany;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("budgets");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
  });

  it("upsertBudgets creates one row per category and listBudgets returns core BudgetState", async () => {
    await upsertBudgets(owned.owner.client, owned.companyId, [
      { category: "ads", totalLimitUsd: 500, dailyLimitUsd: 50 },
      { category: "tools", totalLimitUsd: 100, dailyLimitUsd: 10 },
    ]);
    expect(await listBudgets(owned.owner.client, owned.companyId)).toEqual([
      { category: "ads", totalLimitUsd: 500, dailyLimitUsd: 50, spentTotalUsd: 0, spentTodayUsd: 0 },
      { category: "tools", totalLimitUsd: 100, dailyLimitUsd: 10, spentTotalUsd: 0, spentTodayUsd: 0 },
    ]);
  });

  it("re-upserting changes the limits but keeps the spent amounts", async () => {
    await service.from("budgets").update({ spent_total_usd: 42, spent_today_usd: 7 }).eq("company_id", owned.companyId).eq("category", "ads");
    await upsertBudgets(owned.owner.client, owned.companyId, [{ category: "ads", totalLimitUsd: 800, dailyLimitUsd: 80 }]);
    const ads = (await listBudgets(service, owned.companyId)).find((b) => b.category === "ads");
    expect(ads).toEqual({ category: "ads", totalLimitUsd: 800, dailyLimitUsd: 80, spentTotalUsd: 42, spentTodayUsd: 7 });
  });

  it("reports 0 spent today when spent_today_date is stale", async () => {
    await service.from("budgets").update({ spent_today_usd: 9, spent_today_date: "2000-01-01" }).eq("company_id", owned.companyId).eq("category", "tools");
    const tools = (await listBudgets(owned.owner.client, owned.companyId)).find((b) => b.category === "tools");
    expect(tools?.spentTodayUsd).toBe(0);
    expect(tools?.spentTotalUsd).toBe(0);
  });

  it("toBudgetState is pure: same row, different reference day", () => {
    const row = { category: "ads", total_limit_usd: 1, daily_limit_usd: 1, spent_total_usd: 1, spent_today_usd: 1, spent_today_date: "2026-10-14" };
    expect(toBudgetState(row, "2026-10-14").spentTodayUsd).toBe(1);
    expect(toBudgetState(row, "2026-10-15").spentTodayUsd).toBe(0);
  });

  it("rejects an empty line list and negative limits", async () => {
    await expect(upsertBudgets(owned.owner.client, owned.companyId, [])).rejects.toThrow();
    await expect(upsertBudgets(owned.owner.client, owned.companyId, [{ category: "ads", totalLimitUsd: -1, dailyLimitUsd: 0 }])).rejects.toThrow();
  });
});
