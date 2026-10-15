import { localDay } from "@north/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertBudgets } from "../src/budgets";
import { adsBudgetAndAction, createOwnerWithCompany, deleteTestUser, raw, sampleCampaignInput, type OwnedCompany } from "./fixtures";

const ISTANBUL = "Europe/Istanbul";
const budgetRow = async (companyId: string) => (await raw.from("budgets").select("spent_today_usd, spent_today_date, spent_total_usd, daily_extra_date").eq("company_id", companyId).eq("category", "ads").single()).data;
const spend = (companyId: string, amount: number, day: string | null) => raw.rpc("apply_budget_spend", { p_company_id: companyId, p_category: "ads", p_amount: amount, p_day: day });
/** A zone whose date differs from UTC right now: UTC+14 and UTC-11 are 25 hours apart, so one of them always does. */
const zoneOffUtc = (now: Date) => ["Pacific/Kiritimati", "Pacific/Pago_Pago"].find((tz) => localDay(tz, now) !== localDay("UTC", now))!;

/** 0014_m6_budget_day.sql, A6-6 (ADR 0011 follow-up): budgets run on the owner-local day. */
describe("M6 schema: budgets on the owner-local day", () => {
  let istanbul: OwnedCompany;
  let utc: OwnedCompany;

  beforeAll(async () => {
    istanbul = await createOwnerWithCompany("schema-m6-istanbul");
    utc = await createOwnerWithCompany("schema-m6-utc");
    await raw.from("users").update({ timezone: ISTANBUL }).eq("id", istanbul.owner.id);
    for (const owned of [istanbul, utc]) await upsertBudgets(owned.owner.client, owned.companyId, [{ category: "ads", totalLimitUsd: 500, dailyLimitUsd: 50 }]);
  });

  afterAll(async () => {
    await deleteTestUser(istanbul.owner);
    await deleteTestUser(utc.owner);
  });

  it("owner_local_date is the owner's date now, UTC for an unknown company; a fresh budget line starts on it", async () => {
    const now = new Date();
    const zone = zoneOffUtc(now);
    await raw.from("users").update({ timezone: zone }).eq("id", utc.owner.id);
    expect((await raw.rpc("owner_local_date", { p_company_id: utc.companyId })).data).toBe(localDay(zone, now));
    expect((await utc.owner.client.rpc("owner_local_date", { p_company_id: utc.companyId })).data).toBe(localDay(zone, now));
    expect((await raw.rpc("owner_local_date", { p_company_id: "00000000-0000-0000-0000-000000000000" })).data).toBe(localDay("UTC", now));
    await upsertBudgets(utc.owner.client, utc.companyId, [{ category: "tools", totalLimitUsd: 10, dailyLimitUsd: 1 }]);
    const tools = (await raw.from("budgets").select("spent_today_date, daily_extra_date").eq("company_id", utc.companyId).eq("category", "tools").single()).data;
    expect(tools).toEqual({ spent_today_date: localDay(zone, now), daily_extra_date: localDay(zone, now) });
    await raw.from("budgets").update({ spent_today_date: "2000-01-01" }).eq("company_id", utc.companyId).eq("category", "ads");
    const defaulted = await spend(utc.companyId, 0, null);
    expect(defaulted.error).toBeNull();
    expect((await budgetRow(utc.companyId))?.spent_today_date).toBe(localDay(zone, now));
    await raw.from("users").update({ timezone: "UTC" }).eq("id", utc.owner.id);
  });

  it("an Istanbul owner at 23:30 local (20:30 UTC) spends on that Istanbul date; at 00:30 local (21:30 UTC, same UTC date) the next spend starts a new day; a UTC owner is unchanged", async () => {
    const late = new Date("2026-11-03T20:30:00Z");
    const afterMidnight = new Date("2026-11-03T21:30:00Z");
    expect(localDay(ISTANBUL, late)).toBe("2026-11-03");
    expect(localDay(ISTANBUL, afterMidnight)).toBe("2026-11-04");
    expect((await spend(istanbul.companyId, 10, localDay(ISTANBUL, late))).data).toMatchObject({ spent_today: 10, applied: true });
    expect(await budgetRow(istanbul.companyId)).toMatchObject({ spent_today_usd: 10, spent_today_date: "2026-11-03" });
    expect((await spend(istanbul.companyId, 10, localDay(ISTANBUL, afterMidnight))).data).toMatchObject({ spent_today: 10, spent_total: 20, applied: true });
    expect(await budgetRow(istanbul.companyId)).toMatchObject({ spent_today_usd: 10, spent_today_date: "2026-11-04", daily_extra_date: "2026-11-04" });
    await spend(utc.companyId, 10, localDay("UTC", late));
    expect((await spend(utc.companyId, 10, localDay("UTC", afterMidnight))).data).toMatchObject({ spent_today: 20, spent_total: 20 });
    expect(await budgetRow(utc.companyId)).toMatchObject({ spent_today_usd: 20, spent_today_date: "2026-11-03" });
  });

  it("campaigns_within_budget reads today's spend on the owner's date, not the UTC date", async () => {
    const now = new Date();
    const zone = zoneOffUtc(now);
    const owned = await createOwnerWithCompany("schema-m6-campaign-day");
    await raw.from("users").update({ timezone: zone }).eq("id", owned.owner.id);
    const actionId = await adsBudgetAndAction(owned.companyId, { daily: 10, total: 100 });
    const campaign = (id: string) => {
      const c = sampleCampaignInput(owned.companyId, id);
      return { company_id: owned.companyId, action_id: id, provider: c.provider, provider_campaign_id: c.providerCampaignId, name: c.name, channel: "meta_ads", metric_key: c.metricKey, daily_budget_usd: 10, total_budget_usd: 50 };
    };
    await raw.from("budgets").update({ spent_today_usd: 10, spent_today_date: localDay("UTC", now) }).eq("company_id", owned.companyId).eq("category", "ads");
    expect((await raw.from("campaigns").insert(campaign(actionId))).error).toBeNull();
    const second = (await raw.from("actions").insert({ company_id: owned.companyId, agent_role: "growth", kind: "ads.start", tier: "K2", description: "Again", status: "blocked" }).select("id").single()).data!.id;
    await raw.from("budgets").update({ spent_today_usd: 10, spent_today_date: localDay(zone, now) }).eq("company_id", owned.companyId).eq("category", "ads");
    const refused = await raw.from("campaigns").insert(campaign(second));
    expect(refused.error?.message).toMatch(/budget_cap/);
    await deleteTestUser(owned.owner);
  });
});
