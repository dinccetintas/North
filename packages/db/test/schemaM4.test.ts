import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordAction } from "../src/actions";
import { upsertBudgets } from "../src/budgets";
import { createTask } from "../src/tasks";
import { createOwnerWithCompany, deleteTestUser, raw, service, type OwnedCompany } from "./fixtures";

/** Database-level guarantees added by 0008_m4.sql (BUD-1, OUT-1, OUT-2). */
describe("M4 schema", () => {
  let owned: OwnedCompany;
  let actionId: string;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("schema-m4");
    await upsertBudgets(owned.owner.client, owned.companyId, [{ category: "ads", totalLimitUsd: 100, dailyLimitUsd: 10 }]);
    actionId = await recordAction(service, { companyId: owned.companyId, taskId: null, agentRole: "growth", kind: "ads.start", tier: "K2", description: "start", status: "blocked" });
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
  });

  const campaignRow = (overrides: Record<string, unknown> = {}) => ({
    company_id: owned.companyId,
    action_id: actionId,
    provider: "meta_ads",
    provider_campaign_id: `sandbox:campaign:${Math.random().toString(36).slice(2)}`,
    name: "Acme launch test",
    channel: "meta_ads",
    metric_key: "signups",
    daily_budget_usd: 10,
    total_budget_usd: 50,
    ...overrides,
  });

  it("tasks accept lead_research and artifacts accept lead_list; unknown kinds are refused", async () => {
    const task = await createTask(service, { companyId: owned.companyId, role: "sales", taskType: "lead_research", title: "Find leads" });
    expect(task.taskType).toBe("lead_research");
    const ok = await service.from("artifacts").insert({ company_id: owned.companyId, kind: "lead_list", title: "Leads", storage_path: `companies/${owned.companyId}/lead_list/leads-v1.md`, created_by_role: "sales" });
    expect(ok.error).toBeNull();
    const bad = await service.from("artifacts").insert({ company_id: owned.companyId, kind: "mixtape", title: "x", storage_path: "companies/x/mixtape/x-v1.md", created_by_role: "sales" });
    expect(bad.error?.message).toMatch(/artifacts_kind_check/);
  });

  it("OUT-2: owners cannot insert campaigns, metrics or ledger rows; the worker can", async () => {
    const campaign = await owned.owner.client.from("campaigns").insert(campaignRow());
    expect(campaign.error?.code).toBe("42501");
    const metric = await owned.owner.client.from("metrics").insert({ company_id: owned.companyId, metric_key: "signups", value: 1, source: "forged" });
    expect(metric.error?.code).toBe("42501");
    const ledger = await owned.owner.client.from("ledger_entries").insert({ company_id: owned.companyId, metric_key: "signups", before_value: 0, after_value: 1, channel: "forged" });
    expect(ledger.error?.code).toBe("42501");
    const real = await service.from("campaigns").insert(campaignRow()).select("id, status, spent_today_usd, sandbox").single();
    expect(real.data).toMatchObject({ status: "active", spent_today_usd: 0, sandbox: true });
    const visible = await owned.owner.client.from("campaigns").select("id").eq("company_id", owned.companyId);
    expect(visible.data?.map((r) => r.id)).toEqual([real.data!.id]);
  });

  it("campaigns are unique per action and per provider campaign id", async () => {
    const sameAction = await service.from("campaigns").insert(campaignRow());
    expect(sameAction.error?.code).toBe("23505");
  });

  it("BUD-1: owners cannot update spent_* or daily_extra_*, only the two limits; the upsert keeps working", async () => {
    const spent = await owned.owner.client.from("budgets").update({ spent_today_usd: 0 }).eq("company_id", owned.companyId).eq("category", "ads");
    expect(spent.error?.code).toBe("42501");
    const extra = await owned.owner.client.from("budgets").update({ daily_extra_usd: 500 }).eq("company_id", owned.companyId).eq("category", "ads");
    expect(extra.error?.code).toBe("42501");
    await upsertBudgets(owned.owner.client, owned.companyId, [
      { category: "ads", totalLimitUsd: 100, dailyLimitUsd: 10 },
      { category: "tools", totalLimitUsd: 20, dailyLimitUsd: 5 },
    ]);
    const rows = await service.from("budgets").select("category, daily_limit_usd, daily_extra_usd").eq("company_id", owned.companyId).order("category");
    expect(rows.data).toEqual([
      { category: "ads", daily_limit_usd: 10, daily_extra_usd: 0 },
      { category: "tools", daily_limit_usd: 5, daily_extra_usd: 0 },
    ]);
  });

  it("BUD-1: campaigns_within_budget refuses an activation whose daily budget exceeds the effective daily cap", async () => {
    const other = await recordAction(service, { companyId: owned.companyId, taskId: null, agentRole: "growth", kind: "ads.start", tier: "K2", description: "big", status: "blocked" });
    const over = await service.from("campaigns").insert(campaignRow({ action_id: other, daily_budget_usd: 11 }));
    expect(over.error?.code).toBe("23514");
    expect(over.error?.message).toMatch(/budget_cap/);
    const paused = await service.from("campaigns").insert(campaignRow({ action_id: other, daily_budget_usd: 11, status: "paused_user" })).select("id").single();
    expect(paused.error).toBeNull();
    const resume = await service.from("campaigns").update({ status: "active" }).eq("id", paused.data!.id);
    expect(resume.error?.message).toMatch(/budget_cap/);
  });

  it("apply_budget_spend adds, rolls the day and reports the caps; negative amounts are refused; owners cannot call it", async () => {
    await service.from("budgets").update({ spent_today_usd: 7, spent_today_date: "2000-01-01", daily_extra_usd: 3, daily_extra_date: "2000-01-01", spent_total_usd: 7 }).eq("company_id", owned.companyId).eq("category", "ads");
    const first = await service.rpc("apply_budget_spend", { p_company_id: owned.companyId, p_category: "ads", p_amount: 4 });
    expect(first.data).toMatchObject({ spent_today: 4, spent_total: 11, daily_extra: 0, daily_limit_effective: 10, cap_daily: false, cap_total: false });
    const second = await service.rpc("apply_budget_spend", { p_company_id: owned.companyId, p_category: "ads", p_amount: 7 });
    expect(second.data).toMatchObject({ spent_today: 11, spent_total: 18, cap_daily: true, cap_total: false });
    const negative = await service.rpc("apply_budget_spend", { p_company_id: owned.companyId, p_category: "ads", p_amount: -1 });
    expect(negative.error?.code).toBe("23514");
    const forged = await owned.owner.client.rpc("apply_budget_spend", { p_company_id: owned.companyId, p_category: "ads", p_amount: 1 });
    expect(forged.error?.code).toBe("42501");
  });

  it("raise_daily_cap adds today's extra only and the next day resets it", async () => {
    const raised = await service.rpc("raise_daily_cap", { p_company_id: owned.companyId, p_category: "ads", p_amount: 10 });
    expect(raised.data).toMatchObject({ daily_extra: 10, daily_limit_effective: 20, cap_daily: false });
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const rolled = await service.rpc("apply_budget_spend", { p_company_id: owned.companyId, p_category: "ads", p_amount: 0, p_day: tomorrow });
    expect(rolled.data).toMatchObject({ spent_today: 0, daily_extra: 0, daily_limit_effective: 10, spent_total: 18 });
    await service.from("budgets").update({ spent_today_usd: 0, spent_today_date: "2000-01-01", daily_extra_usd: 0, daily_extra_date: "2000-01-01", spent_total_usd: 0 }).eq("company_id", owned.companyId).eq("category", "ads");
  });

  it("OUT-1: record_attribution writes samples, the entry and the spend once; a replayed window is a duplicate", async () => {
    const windowEnd = new Date().toISOString();
    const payload = {
      company_id: owned.companyId,
      metric_key: "signups",
      channel: "meta_ads",
      provenance_key: "meta_ads:sandbox:campaign:x",
      provenance: { channel: "meta_ads", campaignId: "sandbox:campaign:x", windowEnd, sandbox: true },
      window_end: windowEnd,
      source: "sandbox_ads",
      samples: [
        { metric_key: "ad_spend_usd", value: 4 },
        { metric_key: "ad_clicks", value: 12 },
        { metric_key: "signups", value: 1 },
      ],
      before: 0,
      after: 1,
      cost_usd: 4,
      category: "ads",
      note: "window 1",
    };
    const first = await service.rpc("record_attribution", { payload });
    expect(first.error).toBeNull();
    expect(first.data).toMatchObject({ duplicate: false, cap_daily: false, cap_total: false });
    expect(typeof (first.data as { entry_id: string }).entry_id).toBe("string");
    const replay = await service.rpc("record_attribution", { payload });
    expect(replay.data).toMatchObject({ duplicate: true, entry_id: null, cap_daily: false, cap_total: false });
    const budget = await service.from("budgets").select("spent_today_usd, spent_total_usd").eq("company_id", owned.companyId).eq("category", "ads").single();
    expect(budget.data).toEqual({ spent_today_usd: 4, spent_total_usd: 4 });
    const samples = await service.from("metrics").select("metric_key, scope, provenance_key").eq("company_id", owned.companyId).eq("provenance_key", "meta_ads:sandbox:campaign:x").order("metric_key");
    expect(samples.data).toEqual([
      { metric_key: "ad_clicks", scope: "channel", provenance_key: "meta_ads:sandbox:campaign:x" },
      { metric_key: "ad_spend_usd", scope: "channel", provenance_key: "meta_ads:sandbox:campaign:x" },
      { metric_key: "signups", scope: "channel", provenance_key: "meta_ads:sandbox:campaign:x" },
    ]);
    const entries = await raw.from("ledger_entries").select("channel, cost_usd, provenance, campaign_id").eq("company_id", owned.companyId);
    expect(entries.data).toEqual([{ channel: "meta_ads", cost_usd: 4, provenance: payload.provenance, campaign_id: null }]);
    const forged = await owned.owner.client.rpc("record_attribution", { payload });
    expect(forged.error?.code).toBe("42501");
  });

  it("channel samples need provenance; a company sample never carries one", async () => {
    const bare = await service.from("metrics").insert({ company_id: owned.companyId, metric_key: "ad_clicks", value: 1, source: "x", scope: "channel" });
    expect(bare.error?.message).toMatch(/metrics_channel_has_provenance/);
    const company = await service.from("metrics").insert({ company_id: owned.companyId, metric_key: "signups", value: 1, source: "x" }).select("scope, provenance_key").single();
    expect(company.data).toEqual({ scope: "company", provenance_key: null });
  });

  it("leads: owners insert upload rows and read them; they cannot update or delete; emails are unique per company", async () => {
    const insert = await owned.owner.client.from("leads").insert({ company_id: owned.companyId, name: "Ada", email: "ada@example.test", source: "upload" }).select("id, status").single();
    expect(insert.data?.status).toBe("new");
    const dupe = await owned.owner.client.from("leads").insert({ company_id: owned.companyId, name: "Ada again", email: "ada@example.test", source: "upload" });
    expect(dupe.error?.code).toBe("23505");
    const forgedResearch = await owned.owner.client.from("leads").insert({ company_id: owned.companyId, name: "Bot", email: "bot@example.test", source: "research" });
    expect(forgedResearch.error?.code).toBe("42501");
    const update = await owned.owner.client.from("leads").update({ status: "replied" }).eq("id", insert.data!.id);
    expect(update.error?.code).toBe("42501");
    const del = await owned.owner.client.from("leads").delete().eq("id", insert.data!.id);
    expect(del.error?.code).toBe("42501");
    const badStatus = await service.from("leads").update({ status: "won" }).eq("id", insert.data!.id);
    expect(badStatus.error?.message).toMatch(/leads_status_check/);
  });
});
