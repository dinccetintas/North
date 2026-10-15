import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DbError } from "../src/errors";
import { latestChannelSample, latestMetric, listChannelSamples, metricSeries, recordMetric } from "../src/metrics";
import { createCompanyFor, createOwnerWithCompany, createTestUser, deleteTestUser, grantPlan, service, type OwnedCompany, type TestUser } from "./fixtures";

describe("metrics repository (OUT-2)", () => {
  let owned: OwnedCompany;
  let stranger: TestUser;

  beforeAll(async () => {
    owned = await createOwnerWithCompany("metrics");
    // 2 companies for one owner: over the Solo trial's limit (M6).
    await grantPlan(owned.owner.id, "pro");
    stranger = await createTestUser("metrics-stranger");
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
    await deleteTestUser(stranger);
  });

  it("latestMetric is null before any measurement", async () => {
    expect(await latestMetric(owned.owner.client, owned.companyId, "signups")).toBeNull();
  });

  it("recordMetric appends (worker) and latestMetric returns the newest point per key (owner reads)", async () => {
    await recordMetric(service, { companyId: owned.companyId, metricKey: "signups", value: 3, source: "landing_page" });
    await recordMetric(service, { companyId: owned.companyId, metricKey: "signups", value: 5, source: "landing_page" });
    await recordMetric(service, { companyId: owned.companyId, metricKey: "mrr_usd", value: 49, source: "stripe" });
    const signups = await latestMetric(owned.owner.client, owned.companyId, "signups");
    expect(signups?.value).toBe(5);
    expect(typeof signups?.measuredAt).toBe("string");
    expect((await latestMetric(owned.owner.client, owned.companyId, "mrr_usd"))?.value).toBe(49);
  });

  it("owners read but never write samples; unknown keys and other owners are rejected", async () => {
    await expect(recordMetric(owned.owner.client, { companyId: owned.companyId, metricKey: "signups", value: 9, source: "forged" })).rejects.toBeInstanceOf(DbError);
    await expect(recordMetric(service, { companyId: owned.companyId, metricKey: "likes" as never, value: 1, source: "x" })).rejects.toThrow();
    await expect(recordMetric(stranger.client, { companyId: owned.companyId, metricKey: "signups", value: 1, source: "x" })).rejects.toThrow();
    expect(await latestMetric(stranger.client, owned.companyId, "signups")).toBeNull();
    expect((await latestMetric(owned.owner.client, owned.companyId, "signups"))?.value).toBe(5);
  });

  it("OUT-2: a channel sample carries provenance and never becomes the latest company value", async () => {
    const windowEnd = new Date(Date.now() + 60_000).toISOString();
    const provenance = { channel: "meta_ads" as const, campaignId: "sandbox:campaign:abc", windowEnd, sandbox: true };
    await recordMetric(service, { companyId: owned.companyId, metricKey: "signups", value: 40, source: "sandbox_ads", scope: "channel", provenance });
    await recordMetric(service, { companyId: owned.companyId, metricKey: "ad_clicks", value: 12, source: "sandbox_ads", scope: "channel", provenance });
    expect((await latestMetric(owned.owner.client, owned.companyId, "signups"))?.value).toBe(5);
    const sample = await latestChannelSample(owned.owner.client, owned.companyId, "signups", "meta_ads:sandbox:campaign:abc");
    expect(sample).toMatchObject({ metricKey: "signups", value: 40, provenanceKey: "meta_ads:sandbox:campaign:abc", provenance: { channel: "meta_ads", campaignId: "sandbox:campaign:abc", windowEnd, sandbox: true } });
    expect(new Date(sample!.windowEnd).toISOString()).toBe(windowEnd);
    expect(Object.isFrozen(sample)).toBe(true);
    expect(await latestChannelSample(owned.owner.client, owned.companyId, "signups", "meta_ads:other")).toBeNull();
    const series = await listChannelSamples(owned.owner.client, owned.companyId, "meta_ads:sandbox:campaign:abc");
    expect(series.map((s) => [s.metricKey, s.value]).sort()).toEqual([
      ["ad_clicks", 12],
      ["signups", 40],
    ]);
    expect(await listChannelSamples(stranger.client, owned.companyId, "meta_ads:sandbox:campaign:abc")).toEqual([]);
  });

  it("a channel sample without provenance, or a duplicate window, is refused", async () => {
    await expect(recordMetric(service, { companyId: owned.companyId, metricKey: "ad_clicks", value: 1, source: "x", scope: "channel" })).rejects.toThrow();
    const windowEnd = new Date(Date.now() + 120_000).toISOString();
    const provenance = { channel: "cold_email" as const, batchId: "batch-1", windowEnd };
    await recordMetric(service, { companyId: owned.companyId, metricKey: "email_replies", value: 2, source: "sandbox_mail", scope: "channel", provenance });
    await expect(recordMetric(service, { companyId: owned.companyId, metricKey: "email_replies", value: 3, source: "sandbox_mail", scope: "channel", provenance })).rejects.toBeInstanceOf(DbError);
    expect((await latestChannelSample(service, owned.companyId, "email_replies", "cold_email:batch-1"))?.value).toBe(2);
  });

  it("metricSeries: company-scope points of one key, oldest first, inside the window; channel samples never appear", async () => {
    const companyId = await createCompanyFor(owned.owner, "metrics-series");
    expect(await metricSeries(owned.owner.client, companyId, "site_visitors", 14)).toEqual([]);
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    await service.from("metrics").insert({ company_id: companyId, metric_key: "site_visitors", value: 1, source: "x", measured_at: old });
    await recordMetric(service, { companyId, metricKey: "site_visitors", value: 100, source: "sandbox_site" });
    await recordMetric(service, { companyId, metricKey: "site_visitors", value: 60, source: "sandbox_site" });
    await recordMetric(service, { companyId, metricKey: "signups", value: 3, source: "sandbox_site" });
    const windowEnd = new Date(Date.now() + 60_000).toISOString();
    await recordMetric(service, { companyId, metricKey: "site_visitors", value: 999, source: "sandbox_ads", scope: "channel", provenance: { channel: "meta_ads", campaignId: "sandbox:campaign:s", windowEnd, sandbox: true } });
    const series = await metricSeries(owned.owner.client, companyId, "site_visitors", 14);
    expect(series.map((p) => p.value)).toEqual([100, 60]);
    expect(series.every((p) => typeof p.measuredAt === "string")).toBe(true);
    expect(Object.isFrozen(series)).toBe(true);
    expect((await metricSeries(service, companyId, "site_visitors", 30)).map((p) => p.value)).toEqual([1, 100, 60]);
    expect(await metricSeries(stranger.client, companyId, "site_visitors", 14)).toEqual([]);
    await expect(metricSeries(service, companyId, "likes" as never, 14)).rejects.toThrow();
    await expect(metricSeries(service, companyId, "site_visitors", 0)).rejects.toThrow();
  });
});
