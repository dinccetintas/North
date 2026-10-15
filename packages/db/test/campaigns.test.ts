import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordAction } from "../src/actions";
import { BudgetCapError, getCampaign, getCampaignByProviderId, listCampaigns, listCompaniesWithCollectables, registerCampaign, setCampaignStatus, updateCampaignTotals } from "../src/campaigns";
import { setKillSwitch } from "../src/companies";
import { DbError } from "../src/errors";
import { adsBudgetAndAction, createCompanyFor, createOwnerWithCompany, createTestUser, deleteTestUser, sampleCampaignInput, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("campaigns repository (OUT-2, BUD-1, BUD-4)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;
  let actionId: string;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("campaigns");
    stranger = await createTestUser("campaigns-stranger");
    actionId = await adsBudgetAndAction(owned.companyId, { daily: 10, total: 100 });
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("registerCampaign is idempotent by action id and the owner reads the row; a stranger sees nothing", async () => {
    const input = sampleCampaignInput(owned.companyId, actionId, { providerCampaignId: "sandbox:campaign:one", landingUrl: "https://acme.example" });
    const created = await registerCampaign(service, input);
    expect(created).toMatchObject({ companyId: owned.companyId, actionId, provider: "meta_ads", channel: "meta_ads", providerCampaignId: "sandbox:campaign:one", name: "Acme launch test", metricKey: "signups", dailyBudgetUsd: 10, totalBudgetUsd: 50, landingUrl: "https://acme.example", status: "active", pausedDay: null, spentTodayUsd: 0, spentTotalUsd: 0, impressions: 0, clicks: 0, conversions: 0, lastCollectedAt: null, lastError: null, sandbox: true, taskId: null });
    expect(Object.isFrozen(created)).toBe(true);
    const again = await registerCampaign(service, { ...input, providerCampaignId: "sandbox:campaign:ignored" });
    expect(again.id).toBe(created.id);
    expect(again.providerCampaignId).toBe("sandbox:campaign:one");
    expect(await getCampaign(owned.owner.client, owned.companyId, created.id)).toEqual(created);
    expect(await getCampaignByProviderId(owned.owner.client, owned.companyId, "sandbox:campaign:one")).toEqual(created);
    expect((await listCampaigns(owned.owner.client, owned.companyId)).map((c) => c.id)).toEqual([created.id]);
    expect(await getCampaign(stranger.client, owned.companyId, created.id)).toBeNull();
    expect(await listCampaigns(stranger.client, owned.companyId)).toEqual([]);
  });

  it("owners cannot write campaigns", async () => {
    const other = await recordAction(service, { companyId: owned.companyId, taskId: null, agentRole: "growth", kind: "ads.start", tier: "K2", description: "x", status: "blocked" });
    await expect(registerCampaign(owned.owner.client, sampleCampaignInput(owned.companyId, other))).rejects.toBeInstanceOf(DbError);
    const [campaign] = await listCampaigns(service, owned.companyId);
    await expect(setCampaignStatus(owned.owner.client, campaign!.id, "paused_user")).rejects.toBeInstanceOf(DbError);
    await expect(updateCampaignTotals(owned.owner.client, campaign!.id, { spentTotalUsd: 1 })).rejects.toBeInstanceOf(DbError);
    expect((await getCampaign(service, owned.companyId, campaign!.id))?.status).toBe("active");
  });

  it("setCampaignStatus records the pause day and updateCampaignTotals the collected figures; listCampaigns filters by status", async () => {
    const [campaign] = await listCampaigns(service, owned.companyId);
    const paused = await setCampaignStatus(service, campaign!.id, "paused_cap", { pausedDay: "2026-10-15" });
    expect(paused).toMatchObject({ status: "paused_cap", pausedDay: "2026-10-15" });
    const totals = await updateCampaignTotals(service, campaign!.id, { spentTodayUsd: 4, spentTotalUsd: 4, impressions: 800, clicks: 12, conversions: 1, lastCollectedAt: "2026-10-15T10:00:00.000Z" });
    expect(totals).toMatchObject({ spentTodayUsd: 4, spentTotalUsd: 4, impressions: 800, clicks: 12, conversions: 1, lastCollectedAt: "2026-10-15T10:00:00+00:00" });
    expect((await listCampaigns(owned.owner.client, owned.companyId, { status: ["active"] })).length).toBe(0);
    expect((await listCampaigns(owned.owner.client, owned.companyId, { status: ["paused_cap", "paused_kill"] })).map((c) => c.id)).toEqual([campaign!.id]);
    await expect(updateCampaignTotals(service, campaign!.id, { clicks: -1 })).rejects.toThrow();
    const resumed = await setCampaignStatus(service, campaign!.id, "active", { pausedDay: null, lastError: null });
    expect(resumed).toMatchObject({ status: "active", pausedDay: null });
  });

  it("BUD-1: an activation over the ads cap throws BudgetCapError (the database trigger), and the row stays as it was", async () => {
    const big = await recordAction(service, { companyId: owned.companyId, taskId: null, agentRole: "growth", kind: "ads.start", tier: "K2", description: "big", status: "blocked" });
    await expect(registerCampaign(service, sampleCampaignInput(owned.companyId, big, { dailyBudgetUsd: 11 }))).rejects.toBeInstanceOf(BudgetCapError);
    const parked = await registerCampaign(service, sampleCampaignInput(owned.companyId, big, { dailyBudgetUsd: 11, status: "paused_user" }));
    await expect(setCampaignStatus(service, parked.id, "active")).rejects.toBeInstanceOf(BudgetCapError);
    expect((await getCampaign(service, owned.companyId, parked.id))?.status).toBe("paused_user");
  });

  it("M4 review M3: getCampaign is company-scoped; a foreign company id (even with the service role) finds nothing", async () => {
    const [campaign] = await listCampaigns(service, owned.companyId);
    const foreign = await createCompanyFor(owned.owner, "campaigns-foreign");
    expect(await getCampaign(service, foreign, campaign!.id)).toBeNull();
    expect(await getCampaignByProviderId(service, foreign, campaign!.providerCampaignId)).toBeNull();
    expect((await getCampaign(service, owned.companyId, campaign!.id))?.id).toBe(campaign!.id);
  });

  it("listCompaniesWithCollectables: campaigns active/paused_cap or recent first-contact sends, kill switch off", async () => {
    expect(await listCompaniesWithCollectables(service)).toContain(owned.companyId);
    const sales = await createOwnerWithCompany("campaigns-sales");
    expect(await listCompaniesWithCollectables(service)).not.toContain(sales.companyId);
    await recordAction(service, { companyId: sales.companyId, taskId: null, agentRole: "sales", kind: "email.send.first_contact", tier: "K2", description: "hello", status: "blocked" });
    expect(await listCompaniesWithCollectables(service)).not.toContain(sales.companyId);
    await service.from("actions").insert({ company_id: sales.companyId, agent_role: "sales", kind: "email.send.first_contact", tier: "K1", description: "sent", status: "executed", external_ref: "sandbox:msg:1" });
    expect(await listCompaniesWithCollectables(service)).toContain(sales.companyId);
    await setKillSwitch(service, sales.companyId, true);
    expect(await listCompaniesWithCollectables(service)).not.toContain(sales.companyId);
    await deleteTestUser(sales.owner);
  });
});
