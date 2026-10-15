import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SandboxAds, hourlyDelivery } from "../src/sandbox/ads";
import type { SandboxEvent } from "../src/types";

const spec = (companyId: string, name = "Launch test") => ({
  companyId,
  name,
  dailyBudgetUsd: 10,
  audience: "solo consultants",
  creativeMarkdown: "# Headline\nBody copy.",
  targeting: { countries: ["US", "GB"], ageMin: 25, ageMax: 55 },
  landingUrl: "http://127.0.0.1:3101/sandbox/sites/live-acme-site/",
});

const recorder = () => {
  const events: SandboxEvent[] = [];
  return { events, sink: (event: SandboxEvent) => void events.push(event) };
};

const root = () => mkdtemp(join(tmpdir(), "north-ads-"));

describe("SandboxAds (B4-2, OUT-2)", () => {
  it("starts a campaign as <root>/ads/<campaignId>.json, records the event and returns a sandbox-prefixed ref", async () => {
    const dir = await root();
    const { events, sink } = recorder();
    const ads = new SandboxAds(sink, dir);
    const result = await ads.startCampaign(spec("c1"));
    expect(result.sandbox).toBe(true);
    expect(result.campaignId).toMatch(/^sandbox:campaign:[0-9a-f-]{36}$/);
    const file = JSON.parse(await readFile(join(dir, "ads", `${result.campaignId}.json`), "utf8")) as Record<string, unknown>;
    expect(file).toMatchObject({ campaignId: result.campaignId, companyId: "c1", name: "Launch test", dailyBudgetUsd: 10, status: "active", targeting: { countries: ["US", "GB"], ageMin: 25, ageMax: 55 } });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ provider: "ads", op: "startCampaign", companyId: "c1", ref: result.campaignId });
    expect(events[0]?.payload).toMatchObject({ name: "Launch test", dailyBudgetUsd: 10, audience: "solo consultants", landingUrl: spec("c1").landingUrl });
    expect(await ads.status("c1", result.campaignId)).toBe("active");
  });

  it("a new instance over the same root sees the campaigns; another company or an unknown id is unknown", async () => {
    const dir = await root();
    const first = new SandboxAds(undefined, dir);
    const { campaignId } = await first.startCampaign(spec("c1"));
    const second = new SandboxAds(undefined, dir);
    expect(await second.status("c1", campaignId)).toBe("active");
    expect((await second.campaignsFor("c1")).map((x) => x.campaignId)).toEqual([campaignId]);
    expect(await second.status("c2", campaignId)).toBe("unknown");
    expect(await second.status("c1", "sandbox:campaign:missing")).toBe("unknown");
    expect(await second.status("c1", "../escape")).toBe("unknown");
  });

  it("works without a sink and awaits an async sink", async () => {
    const dir = await root();
    const seen: string[] = [];
    const ads = new SandboxAds(async (event) => {
      await Promise.resolve();
      seen.push(event.op);
    }, dir);
    await ads.startCampaign(spec("c1"));
    expect(seen).toEqual(["startCampaign"]);
    await expect(new SandboxAds(undefined, dir).startCampaign(spec("c1"))).resolves.toMatchObject({ sandbox: true });
  });

  it("deliver appends to <campaignId>.deliveries.jsonl and insights sums the deliveries", async () => {
    const dir = await root();
    const { events, sink } = recorder();
    const ads = new SandboxAds(sink, dir);
    const { campaignId } = await ads.startCampaign(spec("c1"));
    const empty = await ads.insights("c1", campaignId);
    expect(empty).toMatchObject({ spendUsd: 0, impressions: 0, clicks: 0, conversions: 0, sandbox: true });
    await ads.deliver(campaignId, { spendUsd: 4, impressions: 800, clicks: 12, conversions: 1 });
    await ads.deliver(campaignId, { spendUsd: 4, impressions: 700, clicks: 10, conversions: 1 });
    const lines = (await readFile(join(dir, "ads", `${campaignId}.deliveries.jsonl`), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ spendUsd: 4, impressions: 800, clicks: 12, conversions: 1, source: "manual" });
    const insights = await ads.insights("c1", campaignId);
    expect(insights).toMatchObject({ spendUsd: 8, impressions: 1500, clicks: 22, conversions: 2, sandbox: true });
    expect(insights.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(events.map((e) => e.op)).toEqual(["startCampaign", "deliver", "deliver"]);
    expect(events[1]).toMatchObject({ companyId: "c1", ref: campaignId, payload: { spendUsd: 4, clicks: 12 } });
  });

  it("deliver validates the delivery and refuses an unknown campaign; insights refuses another company's campaign", async () => {
    const dir = await root();
    const ads = new SandboxAds(undefined, dir);
    const { campaignId } = await ads.startCampaign(spec("c1"));
    await expect(ads.deliver(campaignId, { spendUsd: -1, impressions: 0, clicks: 0, conversions: 0 })).rejects.toThrow();
    await expect(ads.deliver("sandbox:campaign:missing", { spendUsd: 1, impressions: 0, clicks: 0, conversions: 0 })).rejects.toThrow(/unknown campaign/i);
    await expect(ads.insights("c2", campaignId)).rejects.toThrow(/unknown campaign/i);
  });

  it("pace appends one deterministic delivery per hour from the campaign id; paused campaigns do not pace", async () => {
    const dir = await root();
    const ads = new SandboxAds(undefined, dir);
    const { campaignId } = await ads.startCampaign(spec("c1"));
    const paced = await ads.pace(campaignId, 24);
    expect(paced).toHaveLength(24);
    const day = await ads.insights("c1", campaignId);
    expect(day.spendUsd).toBeCloseTo(10, 1);
    expect(day.clicks).toBeGreaterThan(15);
    expect(day.clicks).toBeLessThan(35);
    expect(day.conversions).toBeGreaterThanOrEqual(1);
    expect(day.impressions).toBeGreaterThan(day.clicks);
    expect(paced.every((d) => Number.isInteger(d.clicks) && Number.isInteger(d.impressions) && Number.isInteger(d.conversions))).toBe(true);
    // Deterministic: the same campaign id and hour index give the same delivery.
    expect(hourlyDelivery(campaignId, 10, 3)).toEqual(hourlyDelivery(campaignId, 10, 3));
    expect(hourlyDelivery(campaignId, 10, 3).spendUsd).toBeCloseTo(10 / 24, 4);
    const hours = Array.from({ length: 24 }, (_, h) => hourlyDelivery("sandbox:campaign:a", 100, h));
    expect(new Set(hours.map((d) => d.clicks)).size).toBeGreaterThan(1);
    expect(hours.map((d) => d.clicks)).toEqual(Array.from({ length: 24 }, (_, h) => hourlyDelivery("sandbox:campaign:a", 100, h).clicks));
    expect(hours.reduce((s, d) => s + d.conversions, 0)).toBe(Math.floor(24 * (100 / 24 / 0.4) * 0.05));
    await ads.pauseCampaign("c1", campaignId);
    expect(await ads.pace(campaignId, 2)).toEqual([]);
    expect((await ads.insights("c1", campaignId)).spendUsd).toBeCloseTo(day.spendUsd, 6);
    expect(await ads.pace("sandbox:campaign:missing", 1)).toEqual([]);
  });

  it("pauses and resumes one campaign, recording both, and refuses another company's campaign", async () => {
    const dir = await root();
    const { events, sink } = recorder();
    const ads = new SandboxAds(sink, dir);
    const { campaignId } = await ads.startCampaign(spec("c1"));
    await ads.pauseCampaign("c1", campaignId);
    expect(await ads.status("c1", campaignId)).toBe("paused");
    await ads.resumeCampaign("c1", campaignId);
    expect(await ads.status("c1", campaignId)).toBe("active");
    expect(events.map((e) => e.op)).toEqual(["startCampaign", "pauseCampaign", "resumeCampaign"]);
    await expect(ads.pauseCampaign("c2", campaignId)).rejects.toThrow(/unknown campaign/i);
    await expect(ads.resumeCampaign("c1", "sandbox:campaign:missing")).rejects.toThrow(/unknown campaign/i);
  });

  it("BUD-4: pauseMany pauses only the given ids of that company and reports what it could not", async () => {
    const dir = await root();
    const { events, sink } = recorder();
    const ads = new SandboxAds(sink, dir);
    const a1 = await ads.startCampaign(spec("c1", "A1"));
    const a2 = await ads.startCampaign(spec("c1", "A2"));
    const a3 = await ads.startCampaign(spec("c1", "A3"));
    const b1 = await ads.startCampaign(spec("c2", "B1"));
    await ads.pauseCampaign("c1", a2.campaignId);

    const result = await ads.pauseMany("c1", [a1.campaignId, a2.campaignId, b1.campaignId, "sandbox:campaign:missing"]);
    expect(result.paused).toEqual([a1.campaignId, a2.campaignId]);
    expect(result.failed.map((f) => f.campaignId)).toEqual([b1.campaignId, "sandbox:campaign:missing"]);
    expect(await ads.status("c1", a3.campaignId)).toBe("active");
    expect(await ads.status("c2", b1.campaignId)).toBe("active");
    expect(events.at(-1)).toMatchObject({ provider: "ads", op: "pauseMany", companyId: "c1", payload: { paused: result.paused } });
    await expect(ads.pauseMany("c1", [])).resolves.toEqual({ paused: [], failed: [] });
  });

  it("validates input at the boundary and never writes outside <root>/ads", async () => {
    const dir = await root();
    const ads = new SandboxAds(undefined, dir);
    await expect(ads.startCampaign({ ...spec("c1"), dailyBudgetUsd: -1 })).rejects.toThrow();
    await expect(ads.startCampaign({ ...spec("c1"), name: "" })).rejects.toThrow();
    await expect(ads.startCampaign({ ...spec("c1"), targeting: { countries: ["USA"] } })).rejects.toThrow();
    await expect(ads.deliver("../../etc/passwd", { spendUsd: 1, impressions: 0, clicks: 0, conversions: 0 })).rejects.toThrow(/unknown campaign/i);
    expect(await readdir(dir)).toEqual([]);
  });

  it("snapshots are frozen", async () => {
    const dir = await root();
    const ads = new SandboxAds(undefined, dir);
    await ads.startCampaign(spec("c1"));
    const snapshot = await ads.campaignsFor("c1");
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot[0])).toBe(true);
    expect(await ads.campaignsFor("nobody")).toEqual([]);
  });
});
