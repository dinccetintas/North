import { describe, expect, it } from "vitest";
import { SandboxAds } from "../src/sandbox/ads";
import type { SandboxEvent } from "../src/types";

const spec = (companyId: string, name = "Launch test") => ({
  companyId,
  name,
  dailyBudgetUsd: 10,
  audience: "solo consultants",
  creativeMarkdown: "# Headline\nBody copy.",
});

const recorder = () => {
  const events: SandboxEvent[] = [];
  return { events, sink: (event: SandboxEvent) => void events.push(event) };
};

describe("SandboxAds", () => {
  it("starts a campaign, records the event and returns a sandbox-prefixed ref", async () => {
    const { events, sink } = recorder();
    const ads = new SandboxAds(sink);
    const result = await ads.startCampaign(spec("c1"));
    expect(result.sandbox).toBe(true);
    expect(result.campaignId).toMatch(/^sandbox:campaign:[0-9a-f-]{36}$/);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ provider: "ads", op: "startCampaign", companyId: "c1", ref: result.campaignId });
    expect(events[0]?.payload).toMatchObject({ name: "Launch test", dailyBudgetUsd: 10, audience: "solo consultants" });
  });

  it("works without a sink and awaits an async sink", async () => {
    const seen: string[] = [];
    const ads = new SandboxAds(async (event) => {
      await Promise.resolve();
      seen.push(event.op);
    });
    await ads.startCampaign(spec("c1"));
    expect(seen).toEqual(["startCampaign"]);
    await expect(new SandboxAds().startCampaign(spec("c1"))).resolves.toMatchObject({ sandbox: true });
  });

  it("pauses one campaign and records it", async () => {
    const { events, sink } = recorder();
    const ads = new SandboxAds(sink);
    const { campaignId } = await ads.startCampaign(spec("c1"));
    await ads.pauseCampaign("c1", campaignId);
    expect(events.map((e) => e.op)).toEqual(["startCampaign", "pauseCampaign"]);
    expect(ads.campaignsFor("c1").map((c) => c.status)).toEqual(["paused"]);
  });

  it("pauseAll pauses only that company's active campaigns and reports them", async () => {
    const { sink } = recorder();
    const ads = new SandboxAds(sink);
    const a1 = await ads.startCampaign(spec("c1", "A1"));
    const a2 = await ads.startCampaign(spec("c1", "A2"));
    const b1 = await ads.startCampaign(spec("c2", "B1"));
    await ads.pauseCampaign("c1", a2.campaignId);

    const result = await ads.pauseAll("c1");
    expect(result.paused).toEqual([a1.campaignId]);
    expect(ads.campaignsFor("c1").every((c) => c.status === "paused")).toBe(true);
    expect(ads.campaignsFor("c2").find((c) => c.campaignId === b1.campaignId)?.status).toBe("active");
  });

  it("pauseAll on an unknown company records an empty pause and returns no ids", async () => {
    const { events, sink } = recorder();
    const ads = new SandboxAds(sink);
    await expect(ads.pauseAll("nobody")).resolves.toEqual({ paused: [] });
    expect(events[0]).toMatchObject({ provider: "ads", op: "pauseAll", companyId: "nobody", payload: { paused: [] } });
  });

  it("rejects an unknown campaign or one owned by another company", async () => {
    const ads = new SandboxAds();
    const { campaignId } = await ads.startCampaign(spec("c1"));
    await expect(ads.pauseCampaign("c1", "sandbox:campaign:missing")).rejects.toThrow(/unknown campaign/i);
    await expect(ads.pauseCampaign("c2", campaignId)).rejects.toThrow(/unknown campaign/i);
  });

  it("validates input at the boundary", async () => {
    const ads = new SandboxAds();
    await expect(ads.startCampaign({ ...spec("c1"), dailyBudgetUsd: -1 })).rejects.toThrow();
    await expect(ads.startCampaign({ ...spec("c1"), name: "" })).rejects.toThrow();
  });

  it("never exposes its internal state for mutation", async () => {
    const ads = new SandboxAds();
    await ads.startCampaign(spec("c1"));
    const snapshot = ads.campaignsFor("c1");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
  });
});
