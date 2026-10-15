import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyBudgetSpend, getBudget, listBudgets, raiseDailyCap, raiseTotalCap, toBudgetState, upsertBudgets } from "../src/budgets";
import { DbError } from "../src/errors";
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
      { category: "ads", totalLimitUsd: 500, dailyLimitUsd: 50, dailyExtraUsd: 0, spentTotalUsd: 0, spentTodayUsd: 0 },
      { category: "tools", totalLimitUsd: 100, dailyLimitUsd: 10, dailyExtraUsd: 0, spentTotalUsd: 0, spentTodayUsd: 0 },
    ]);
  });

  it("re-upserting changes the limits but keeps the spent amounts", async () => {
    await service.from("budgets").update({ spent_total_usd: 42, spent_today_usd: 7 }).eq("company_id", owned.companyId).eq("category", "ads");
    await upsertBudgets(owned.owner.client, owned.companyId, [{ category: "ads", totalLimitUsd: 800, dailyLimitUsd: 80 }]);
    const ads = (await listBudgets(service, owned.companyId)).find((b) => b.category === "ads");
    expect(ads).toEqual({ category: "ads", totalLimitUsd: 800, dailyLimitUsd: 80, dailyExtraUsd: 0, spentTotalUsd: 42, spentTodayUsd: 7 });
  });

  it("reports 0 spent today when spent_today_date is stale", async () => {
    await service.from("budgets").update({ spent_today_usd: 9, spent_today_date: "2000-01-01" }).eq("company_id", owned.companyId).eq("category", "tools");
    const tools = (await listBudgets(owned.owner.client, owned.companyId)).find((b) => b.category === "tools");
    expect(tools?.spentTodayUsd).toBe(0);
    expect(tools?.spentTotalUsd).toBe(0);
  });

  it("toBudgetState is pure: same row, different reference day; the extra counts for its day only (BUD-1)", () => {
    const row = { category: "ads", total_limit_usd: 1, daily_limit_usd: 1, spent_total_usd: 1, spent_today_usd: 1, spent_today_date: "2026-10-14", daily_extra_usd: 5, daily_extra_date: "2026-10-14" };
    expect(toBudgetState(row, "2026-10-14")).toMatchObject({ spentTodayUsd: 1, dailyExtraUsd: 5 });
    expect(toBudgetState(row, "2026-10-15")).toMatchObject({ spentTodayUsd: 0, dailyExtraUsd: 0 });
    expect(Object.isFrozen(toBudgetState(row))).toBe(true);
  });

  it("rejects an empty line list and negative limits", async () => {
    await expect(upsertBudgets(owned.owner.client, owned.companyId, [])).rejects.toThrow();
    await expect(upsertBudgets(owned.owner.client, owned.companyId, [{ category: "ads", totalLimitUsd: -1, dailyLimitUsd: 0 }])).rejects.toThrow();
  });

  it("BUD-1: applyBudgetSpend adds to today and the total and reports the effective daily limit and caps", async () => {
    await upsertBudgets(service, owned.companyId, [{ category: "ads", totalLimitUsd: 100, dailyLimitUsd: 10 }]);
    await service.from("budgets").update({ spent_total_usd: 0, spent_today_usd: 0, daily_extra_usd: 0 }).eq("company_id", owned.companyId).eq("category", "ads");
    const first = await applyBudgetSpend(service, { companyId: owned.companyId, category: "ads", amountUsd: 4 });
    expect(first).toEqual({ spentTodayUsd: 4, spentTotalUsd: 4, dailyExtraUsd: 0, dailyLimitEffectiveUsd: 10, totalLimitUsd: 100, capDaily: false, capTotal: false });
    expect(Object.isFrozen(first)).toBe(true);
    const second = await applyBudgetSpend(service, { companyId: owned.companyId, category: "ads", amountUsd: 7 });
    expect(second).toMatchObject({ spentTodayUsd: 11, spentTotalUsd: 11, capDaily: true, capTotal: false });
    expect(await getBudget(owned.owner.client, owned.companyId, "ads")).toMatchObject({ spentTodayUsd: 11, dailyExtraUsd: 0 });
    await expect(applyBudgetSpend(service, { companyId: owned.companyId, category: "ads", amountUsd: -1 })).rejects.toThrow();
    await expect(applyBudgetSpend(service, { companyId: owned.companyId, category: "domain", amountUsd: 1 })).rejects.toBeInstanceOf(DbError);
    await expect(applyBudgetSpend(owned.owner.client, { companyId: owned.companyId, category: "ads", amountUsd: 1 })).rejects.toBeInstanceOf(DbError);
  });

  it("BUD-3: raiseDailyCap raises today's effective limit; raiseTotalCap raises the total; the day roll resets the extra", async () => {
    const raised = await raiseDailyCap(service, { companyId: owned.companyId, category: "ads", amountUsd: 10 });
    expect(raised).toMatchObject({ dailyExtraUsd: 10, dailyLimitEffectiveUsd: 20, capDaily: false });
    expect(await getBudget(owned.owner.client, owned.companyId, "ads")).toMatchObject({ dailyExtraUsd: 10, dailyLimitUsd: 10, spentTodayUsd: 11 });
    const total = await raiseTotalCap(service, { companyId: owned.companyId, category: "ads", amountUsd: 50 });
    expect(total).toMatchObject({ totalLimitUsd: 150, dailyExtraUsd: 10 });
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const rolled = await applyBudgetSpend(service, { companyId: owned.companyId, category: "ads", amountUsd: 2, day: tomorrow });
    expect(rolled).toMatchObject({ spentTodayUsd: 2, spentTotalUsd: 13, dailyExtraUsd: 0, dailyLimitEffectiveUsd: 10 });
    await expect(raiseDailyCap(owned.owner.client, { companyId: owned.companyId, category: "ads", amountUsd: 1 })).rejects.toBeInstanceOf(DbError);
    expect(await getBudget(owned.owner.client, owned.companyId, "other")).toBeNull();
  });
});
