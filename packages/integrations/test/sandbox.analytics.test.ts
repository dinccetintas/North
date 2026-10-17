import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SandboxAds } from "../src/sandbox/ads";
import { SandboxAnalytics } from "../src/sandbox/analytics";
import { createSandboxIntegrations, isSandboxAds, isSandboxOutreach } from "../src/sandbox/index";
import { SandboxPayments } from "../src/sandbox/payments";
import type { SandboxEvent } from "../src/types";

const spec = (companyId: string, name: string) => ({ companyId, name, dailyBudgetUsd: 10 });
const root = () => mkdtemp(join(tmpdir(), "north-analytics-"));

describe("SandboxAnalytics (B4-3, OUT-2)", () => {
  it("reads signups = Σ conversions and siteVisitors = Σ clicks over the company's campaigns only", async () => {
    const dir = await root();
    const events: SandboxEvent[] = [];
    const sink = (e: SandboxEvent) => void events.push(e);
    const ads = new SandboxAds(sink, dir);
    const a1 = await ads.startCampaign(spec("c1", "A1"));
    const a2 = await ads.startCampaign(spec("c1", "A2"));
    const b1 = await ads.startCampaign(spec("c2", "B1"));
    await ads.deliver(a1.campaignId, { spendUsd: 4, impressions: 800, clicks: 12, conversions: 1 });
    await ads.deliver(a2.campaignId, { spendUsd: 2, impressions: 300, clicks: 5, conversions: 2 });
    await ads.deliver(b1.campaignId, { spendUsd: 9, impressions: 900, clicks: 90, conversions: 9 });

    const analytics = new SandboxAnalytics(sink, dir);
    expect(await analytics.read("c1")).toEqual({ signups: 3, siteVisitors: 17, sandbox: true });
    expect(await analytics.read("c2")).toEqual({ signups: 9, siteVisitors: 90, sandbox: true });
    expect(events.at(-1)).toMatchObject({ provider: "analytics", op: "read", companyId: "c2", payload: { signups: 9, siteVisitors: 90, campaigns: 1 } });
  });

  it("returns null (no data) for a company without campaigns and for an empty root", async () => {
    const dir = await root();
    expect(await new SandboxAnalytics(undefined, dir).read("nobody")).toBeNull();
    const ads = new SandboxAds(undefined, dir);
    await ads.startCampaign(spec("c1", "A1"));
    expect(await new SandboxAnalytics(undefined, dir).read("c1")).toEqual({ signups: 0, siteVisitors: 0, sandbox: true });
    expect(await new SandboxAnalytics(undefined, dir).read("c2")).toBeNull();
  });
});

describe("SandboxPayments", () => {
  it("is honest: no data, so null, and records the read", async () => {
    const events: SandboxEvent[] = [];
    const payments = new SandboxPayments((e) => void events.push(e));
    expect(await payments.read("c1")).toBeNull();
    expect(events[0]).toMatchObject({ provider: "payments", op: "read", companyId: "c1" });
  });
});

describe("createSandboxIntegrations (M4 wiring)", () => {
  it("hands out the same file-backed ads and outreach instances whatever the auth, with typed sandbox access", async () => {
    const dir = await root();
    const events: SandboxEvent[] = [];
    const integrations = createSandboxIntegrations((e) => void events.push(e), { root: dir, siteBaseUrl: "http://127.0.0.1:3101" });
    expect(integrations.mode).toBe("sandbox");
    expect(integrations.ads(null)).toBe(integrations.ads({ token: "ignored" }));
    expect(integrations.outreach(null)).toBe(integrations.outreach({ token: "ignored" }));
    expect(integrations.ads(null)).toBe(integrations.sandbox.ads);
    expect(integrations.outreach(null)).toBe(integrations.sandbox.outreach);
    expect(isSandboxAds(integrations.ads(null))).toBe(true);
    expect(isSandboxOutreach(integrations.outreach(null))).toBe(true);
    expect(isSandboxAds({ startCampaign: async () => ({ campaignId: "x", sandbox: false }) } as never)).toBe(false);

    const { campaignId } = await integrations.ads(null).startCampaign(spec("c1", "A1"));
    await integrations.sandbox.ads.deliver(campaignId, { spendUsd: 4, impressions: 800, clicks: 12, conversions: 1 });
    const sent = await integrations.outreach(null).send({ companyId: "c1", to: "a@example.test", subject: "s", text: "t", kind: "first_contact" });
    await integrations.sandbox.outreach.simulateReply(sent.messageId);
    expect(await integrations.analytics(null).read("c1")).toEqual({ signups: 1, siteVisitors: 12, sandbox: true });
    expect(await integrations.payments(null).read("c1")).toBeNull();
    expect(await integrations.outreach(null).replies({ companyId: "c1", messageIds: [sent.messageId] })).toEqual([{ messageId: sent.messageId, replies: 1, lastReplyAt: expect.any(String), bounced: false, optedOut: false }]);
    expect(events.map((e) => e.provider)).toEqual(["ads", "ads", "outreach", "outreach", "analytics", "payments"]);
  });
});
