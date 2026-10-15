import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordAttributionWindow } from "../src/attribution";
import { getBudget } from "../src/budgets";
import { registerCampaign } from "../src/campaigns";
import { DbError } from "../src/errors";
import { listLedgerEntries } from "../src/ledger";
import { latestChannelSample, latestMetric } from "../src/metrics";
import { adsBudgetAndAction, createOwnerWithCompany, deleteTestUser, sampleCampaignInput, service, type OwnedCompany } from "./fixtures";

describe("attribution (OUT-1, OUT-2, BUD-1): one collection window = one RPC", () => {
  let owned: OwnedCompany;
  let campaignId: string;
  const provenanceFor = (windowEnd: string) => ({ channel: "meta_ads" as const, campaignId: "sandbox:campaign:att", windowEnd, sandbox: true, raw: { spend: "4.00" } });

  beforeAll(async () => {
    owned = await createOwnerWithCompany("attribution");
    const actionId = await adsBudgetAndAction(owned.companyId, { daily: 10, total: 100 });
    campaignId = (await registerCampaign(service, sampleCampaignInput(owned.companyId, actionId, { providerCampaignId: "sandbox:campaign:att" }))).id;
  });

  afterAll(async () => {
    await deleteTestUser(owned.owner);
  });

  it("two windows → two entries with cumulative before/after, samples per metric and the spend applied once each", async () => {
    const w1 = new Date(Date.now() - 7_200_000).toISOString();
    const first = await recordAttributionWindow(service, {
      companyId: owned.companyId,
      campaignId,
      metricKey: "signups",
      provenance: provenanceFor(w1),
      samples: [
        { metricKey: "ad_spend_usd", value: 4 },
        { metricKey: "ad_impressions", value: 800 },
        { metricKey: "ad_clicks", value: 12 },
      ],
      before: 0,
      after: 1,
      costUsd: 4,
      note: "window 1",
    });
    expect(first).toEqual({ duplicate: false, entryId: expect.any(String), capDaily: false, capTotal: false });
    expect(Object.isFrozen(first)).toBe(true);
    const w2 = new Date(Date.now() - 3_600_000).toISOString();
    const second = await recordAttributionWindow(service, {
      companyId: owned.companyId,
      campaignId,
      metricKey: "signups",
      provenance: provenanceFor(w2),
      samples: [
        { metricKey: "ad_spend_usd", value: 8 },
        { metricKey: "ad_clicks", value: 25 },
      ],
      before: 1,
      after: 2,
      costUsd: 4,
    });
    expect(second).toMatchObject({ duplicate: false, capDaily: false, capTotal: false });
    const entries = await listLedgerEntries(owned.owner.client, owned.companyId);
    expect(entries.map((e) => [e.before, e.after, e.costUsd, e.channel, e.campaignId])).toEqual([
      [1, 2, 4, "meta_ads", campaignId],
      [0, 1, 4, "meta_ads", campaignId],
    ]);
    expect(entries[1]?.provenance).toMatchObject({ channel: "meta_ads", campaignId: "sandbox:campaign:att", raw: { spend: "4.00" } });
    expect((await latestChannelSample(owned.owner.client, owned.companyId, "ad_spend_usd", "meta_ads:sandbox:campaign:att"))?.value).toBe(8);
    expect((await latestChannelSample(owned.owner.client, owned.companyId, "signups", "meta_ads:sandbox:campaign:att"))?.value).toBe(2);
    expect(await latestMetric(owned.owner.client, owned.companyId, "signups")).toBeNull();
    expect(await getBudget(owned.owner.client, owned.companyId, "ads")).toMatchObject({ spentTodayUsd: 8, spentTotalUsd: 8 });
  });

  it("a replayed window is a duplicate: no entry, no spend, current cap flags", async () => {
    const w2 = (await listLedgerEntries(service, owned.companyId, { limit: 1 }))[0]!.provenance!.windowEnd;
    const replay = await recordAttributionWindow(service, {
      companyId: owned.companyId,
      campaignId,
      metricKey: "signups",
      provenance: provenanceFor(w2),
      samples: [{ metricKey: "ad_spend_usd", value: 8 }],
      before: 1,
      after: 2,
      costUsd: 4,
    });
    expect(replay).toEqual({ duplicate: true, entryId: null, capDaily: false, capTotal: false });
    expect((await listLedgerEntries(service, owned.companyId)).length).toBe(2);
    expect(await getBudget(service, owned.companyId, "ads")).toMatchObject({ spentTodayUsd: 8, spentTotalUsd: 8 });
  });

  it("BUD-1: the window that passes the daily cap reports capDaily; a cold_email window costs nothing and touches no budget", async () => {
    const w3 = new Date().toISOString();
    const capped = await recordAttributionWindow(service, {
      companyId: owned.companyId,
      campaignId,
      metricKey: "signups",
      provenance: provenanceFor(w3),
      samples: [{ metricKey: "ad_spend_usd", value: 11 }],
      before: 2,
      after: 2,
      costUsd: 3,
    });
    expect(capped).toMatchObject({ duplicate: false, capDaily: true, capTotal: false });
    expect(await getBudget(service, owned.companyId, "ads")).toMatchObject({ spentTodayUsd: 11, spentTotalUsd: 11 });
    const replies = await recordAttributionWindow(service, {
      companyId: owned.companyId,
      metricKey: "email_replies",
      provenance: { channel: "cold_email", batchId: "batch-7", messageIds: ["sandbox:msg:1", "sandbox:msg:2"], windowEnd: w3, sandbox: true },
      samples: [{ metricKey: "emails_sent", value: 5 }],
      before: 0,
      after: 2,
      costUsd: 0,
    });
    expect(replies).toEqual({ duplicate: false, entryId: expect.any(String), capDaily: false, capTotal: false });
    const [entry] = await listLedgerEntries(service, owned.companyId, { limit: 1 });
    expect(entry).toMatchObject({ channel: "cold_email", costUsd: 0, campaignId: null, provenance: { batchId: "batch-7" } });
    expect(await getBudget(service, owned.companyId, "ads")).toMatchObject({ spentTotalUsd: 11 });
  });

  it("validates the input and refuses owners", async () => {
    const windowEnd = new Date().toISOString();
    await expect(recordAttributionWindow(service, { companyId: owned.companyId, metricKey: "signups", provenance: provenanceFor(windowEnd), before: 0, after: 1, costUsd: -1 })).rejects.toThrow();
    await expect(recordAttributionWindow(service, { companyId: owned.companyId, metricKey: "likes" as never, provenance: provenanceFor(windowEnd), before: 0, after: 1, costUsd: 0 })).rejects.toThrow();
    await expect(recordAttributionWindow(owned.owner.client, { companyId: owned.companyId, metricKey: "signups", provenance: provenanceFor(windowEnd), before: 0, after: 1, costUsd: 1 })).rejects.toBeInstanceOf(DbError);
  });
});
