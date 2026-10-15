import { describe, expect, it } from "vitest";
import { budgetRows, campaignIdOf, ledgerRows, outreachRows, provenanceChips } from "./ledger-view";

const budget = { category: "ads" as const, totalLimitUsd: 100, dailyLimitUsd: 10, dailyExtraUsd: 0, spentTotalUsd: 11, spentTodayUsd: 11 };
const campaign = {
  id: "c1",
  providerCampaignId: "sandbox:campaign:abc",
  name: "Acme launch test",
  status: "active",
  dailyBudgetUsd: 10,
  spentTodayUsd: 4,
  spentTotalUsd: 4,
  impressions: 800,
  clicks: 12,
  conversions: 1,
  sandbox: true,
};
const task = { id: "t1", title: "Launch test" };
const adsEntry = {
  id: "e1",
  taskId: "t1",
  metricKey: "signups",
  before: 0,
  after: 1,
  costUsd: 4,
  channel: "meta_ads",
  createdAt: "2026-10-15T10:00:00.000Z",
  campaignId: "c1",
  provenance: { channel: "meta_ads", campaignId: "sandbox:campaign:abc", windowEnd: "2026-10-15T10:00:00.000Z", sandbox: true, raw: { spendUsd: 4, impressions: 800, clicks: 12, conversions: 1 } },
};
const mailEntry = {
  id: "e2",
  taskId: "t2",
  metricKey: "email_replies",
  before: 0,
  after: 2,
  costUsd: 0,
  channel: "cold_email",
  createdAt: "2026-10-15T11:00:00.000Z",
  campaignId: null,
  provenance: { channel: "cold_email", batchId: "batch-1", messageIds: ["sandbox:msg:1", "sandbox:msg:2"], windowEnd: "2026-10-15T11:00:00.000Z", sandbox: true, raw: { replies: 2 } },
};

describe("OUT-1 ledger view models", () => {
  it("budget rows carry the effective daily cap and a cap_reached state once a cap is hit (BUD-1)", () => {
    const [row] = budgetRows([budget]);
    expect(row).toEqual({ category: "ads", spentTodayUsd: 11, dailyCapUsd: 10, spentTotalUsd: 11, totalCapUsd: 100, state: "cap_reached" });
    expect(budgetRows([{ ...budget, spentTodayUsd: 4, spentTotalUsd: 4, dailyExtraUsd: 10 }])[0]).toMatchObject({ dailyCapUsd: 20, state: "ok" });
  });

  it("provenance chips name spend, impressions, clicks, replies and sandbox; anything malformed yields no chips", () => {
    expect(provenanceChips(adsEntry.provenance)).toEqual(["$4.00 spend", "800 impressions", "12 clicks", "1 conversion", "sandbox"]);
    expect(provenanceChips(mailEntry.provenance)).toEqual(["2 replies", "sandbox"]);
    expect(provenanceChips(null)).toEqual([]);
    expect(provenanceChips("nonsense")).toEqual([]);
    expect(provenanceChips({ raw: { clicks: "12" } })).toEqual([]);
  });

  it("ledger rows name the campaign or batch and the task, and compute the delta", () => {
    const rows = ledgerRows([adsEntry, mailEntry], [campaign], [task]);
    expect(rows[0]).toMatchObject({ id: "e1", what: "Acme launch test", taskTitle: "Launch test", delta: 1, costUsd: 4, channel: "meta_ads", metricKey: "signups" });
    expect(rows[0].chips).toContain("12 clicks");
    expect(rows[1]).toMatchObject({ id: "e2", what: "Batch batch-1", taskTitle: null, delta: 2, costUsd: 0 });
  });

  it("a campaign is found by its row id or its provider id", () => {
    expect(campaignIdOf({ ...adsEntry, campaignId: null }, [campaign])).toBe("c1");
    expect(campaignIdOf({ ...adsEntry, campaignId: null, provenance: null }, [campaign])).toBeNull();
  });

  it("outreach rows group executed sends by batch and read cumulative replies from the latest cold_email entry", () => {
    const send = (i: number, status: "executed" | "pending", payload: Record<string, unknown> = { batchId: "batch-1", to: `p${i}@example.test` }) => ({
      id: `a${i}`,
      taskId: "t2",
      status,
      payload,
      externalRef: status === "executed" ? `sandbox:msg:${i}` : null,
      createdAt: `2026-10-15T09:0${i}:00.000Z`,
    });
    const actions = [send(1, "executed"), send(2, "executed"), send(3, "pending")];
    const rows = outreachRows(actions, [mailEntry], [{ id: "t2", title: "Outreach batch 1" }]);
    expect(rows).toEqual([{ batchId: "batch-1", taskTitle: "Outreach batch 1", sent: 2, replies: 2, lastSentAt: "2026-10-15T09:02:00.000Z" }]);
    // Transition rows lose the original payload: the task still groups the batch, and the entry's provenance names it.
    const bare = [send(1, "executed", {}), send(2, "executed", {})];
    expect(outreachRows(bare, [mailEntry], [])).toEqual([{ batchId: "batch-1", taskTitle: null, sent: 2, replies: 2, lastSentAt: "2026-10-15T09:02:00.000Z" }]);
    expect(outreachRows(bare, [], [])).toEqual([{ batchId: "t2", taskTitle: null, sent: 2, replies: 0, lastSentAt: "2026-10-15T09:02:00.000Z" }]);
    expect(outreachRows([], [], [])).toEqual([]);
  });
});
