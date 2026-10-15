import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NotConfiguredError } from "../src/errors";
import { CompetitorSites } from "../src/live/competitor-sites";
import type { FetchLike } from "../src/live/github";
import { GmailOutreach } from "../src/live/gmail";
import { GoogleAds } from "../src/live/google-ads";
import { GOOGLE_TRENDS_NOT_CONFIGURED, GoogleTrendsSignals } from "../src/live/google-trends";
import { MetaAds } from "../src/live/meta-ads";
import { PostHogAnalytics } from "../src/live/posthog";
import { PRODUCTHUNT_NOT_CONFIGURED, ProductHuntSignals } from "../src/live/producthunt";
import { RedditSignals } from "../src/live/reddit";
import { ResendMail } from "../src/live/resend";
import { StripeReadPayments } from "../src/live/stripe-read";
import { WebPush } from "../src/live/web-push";
import { SandboxAds } from "../src/sandbox/ads";
import { SandboxAnalytics } from "../src/sandbox/analytics";
import { createSandboxIntegrations } from "../src/sandbox/index";
import { SandboxMail } from "../src/sandbox/mail";
import { SandboxOutreach } from "../src/sandbox/outreach";
import { SandboxPayments } from "../src/sandbox/payments";
import { SandboxPush } from "../src/sandbox/push";
import { SandboxCompetitorSites, SandboxGoogleTrends, SandboxProductHunt, SandboxReddit } from "../src/sandbox/signals";
import { selectIntegrations } from "../src/select";
import type { SandboxEvent } from "../src/types";

const VAPID = { VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv", VAPID_SUBJECT: "mailto:ceo@example.test" };
const RESEND = { RESEND_API_KEY: "re_test", RESEND_FROM: "North <north@example.test>" };

const warnings = () => {
  const lines: string[] = [];
  return { lines, warn: (line: string) => void lines.push(line) };
};

const scan = { companyId: "c1", queries: ["bookkeeping"], competitorUrls: ["https://incumbent-a.example/pricing"], since: "2026-10-12T07:00:00.000Z" };

describe("createSandboxIntegrations", () => {
  it("wires every sandbox provider to one sink", async () => {
    const root = await mkdtemp(join(tmpdir(), "north-select-"));
    const events: SandboxEvent[] = [];
    const integrations = createSandboxIntegrations((e) => void events.push(e), { root });
    expect(integrations.mode).toBe("sandbox");
    await integrations.mail.send({ companyId: "c1", to: "a@example.test", subject: "s", text: "t", kind: "notification" });
    await integrations.ads(null).startCampaign({ companyId: "c1", name: "n", dailyBudgetUsd: 1, audience: "a", creativeMarkdown: "# c" });
    await integrations.outreach(null).send({ companyId: "c1", to: "a@example.test", subject: "s", text: "t", kind: "first_contact" });
    await integrations.push.send({ endpoint: "https://p.example.test/1", p256dh: "k", auth: "a" }, { title: "t", body: "b", url: "/" });
    expect(events.map((e) => e.provider)).toEqual(["mail", "ads", "outreach", "push"]);
  });
});

describe("selectIntegrations", () => {
  it("returns sandbox by default and for any non-live mode value", () => {
    const { lines, warn } = warnings();
    for (const env of [{}, { INTEGRATIONS_MODE: "sandbox" }, { INTEGRATIONS_MODE: "production" }]) {
      const integrations = selectIntegrations(env, undefined, warn);
      expect(integrations.mode).toBe("sandbox");
      expect(integrations.ads(null)).toBeInstanceOf(SandboxAds);
      expect(integrations.outreach(null)).toBeInstanceOf(SandboxOutreach);
      expect(integrations.analytics(null)).toBeInstanceOf(SandboxAnalytics);
      expect(integrations.payments(null)).toBeInstanceOf(SandboxPayments);
      expect(integrations.mail).toBeInstanceOf(SandboxMail);
      expect(integrations.push).toBeInstanceOf(SandboxPush);
    }
    expect(lines).toEqual([]);
  });

  it("passes SANDBOX_ROOT through so every process sees the same campaigns and mail", async () => {
    const root = await mkdtemp(join(tmpdir(), "north-select-root-"));
    const a = selectIntegrations({ SANDBOX_ROOT: root }, undefined, () => undefined);
    const b = selectIntegrations({ SANDBOX_ROOT: root }, undefined, () => undefined);
    const { campaignId } = await a.ads(null).startCampaign({ companyId: "c1", name: "n", dailyBudgetUsd: 1 });
    expect(await b.ads(null).status("c1", campaignId)).toBe("active");
  });

  it("BUD-2: in live mode ads and outreach are always the user-connection adapters, which refuse without auth", async () => {
    const { lines, warn } = warnings();
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live", ...RESEND, ...VAPID }, undefined, warn, { allowUrl: async () => true });
    expect(integrations.mode).toBe("live");
    expect(integrations.ads({ token: "t", scopes: ["act:1"] })).toBeInstanceOf(MetaAds);
    expect(integrations.outreach({ token: "t" })).toBeInstanceOf(GmailOutreach);
    await expect(integrations.ads(null).status("c1", "x")).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(integrations.outreach(null).status("gmail:m:t")).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(integrations.outreach(null).send({ companyId: "c1", to: "a@example.test", subject: "s", text: "t", kind: "first_contact" })).rejects.toBeInstanceOf(NotConfiguredError);
    expect(integrations.mail).toBeInstanceOf(ResendMail);
    expect(integrations.push).toBeInstanceOf(WebPush);
    expect(lines).toEqual([]);
  });

  it("live analytics and payments are honest stubs that say why they are not configured", async () => {
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live" }, undefined, () => undefined);
    expect(integrations.analytics({ token: "t" })).toBeInstanceOf(PostHogAnalytics);
    expect(integrations.payments({ token: "t" })).toBeInstanceOf(StripeReadPayments);
    await expect(integrations.analytics(null).read("c1")).rejects.toThrow(/tracker/);
    await expect(integrations.payments(null).read("c1")).rejects.toThrow(/M6/);
    const google = new GoogleAds();
    await expect(google.startCampaign({ companyId: "c1", name: "n", dailyBudgetUsd: 1 })).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(google.pauseMany("c1", ["x"])).rejects.toThrow(/developer-token/);
    await expect(google.status("c1", "x")).rejects.toThrow(/Meta first/);
  });

  it("in live mode without platform keys mail and push fall back to sandbox and warn once each; ads never does", () => {
    const { lines, warn } = warnings();
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live" }, undefined, warn);
    expect(integrations.mail).toBeInstanceOf(SandboxMail);
    expect(integrations.push).toBeInstanceOf(SandboxPush);
    expect(integrations.ads(null)).toBeInstanceOf(MetaAds);
    expect(lines.filter((l) => !/competitor/.test(l))).toHaveLength(2);
    expect(lines.join("\n")).toMatch(/mail/);
    expect(lines.join("\n")).toMatch(/push/);
    expect(lines.join("\n")).not.toMatch(/ads/);
  });

  it("the platform Meta keys are gone: they select nothing", () => {
    const { lines, warn } = warnings();
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live", META_ACCESS_TOKEN: "tok", META_AD_ACCOUNT_ID: "act_1", ...RESEND, ...VAPID }, undefined, warn);
    expect(integrations.ads(null)).toBeInstanceOf(MetaAds);
    expect(lines.filter((l) => !/competitor/.test(l))).toEqual([]);
  });

  it("treats a half-configured provider as missing", () => {
    const { lines, warn } = warnings();
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live", RESEND_API_KEY: "re_x", VAPID_PUBLIC_KEY: "pub" }, undefined, warn);
    expect(integrations.mail).toBeInstanceOf(SandboxMail);
    expect(integrations.push).toBeInstanceOf(SandboxPush);
    expect(lines.filter((l) => !/competitor/.test(l))).toHaveLength(2);
  });

  it("passes the sink to the sandbox fallbacks in live mode", async () => {
    const events: SandboxEvent[] = [];
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live" }, (e) => void events.push(e), () => undefined);
    await integrations.mail.send({ companyId: "c1", to: "a@example.test", subject: "s", text: "t", kind: "reply" });
    expect(events).toHaveLength(1);
  });
});

describe("B5-3 selectIntegrations: signal sources (PRO-1)", () => {
  it("sandbox mode hands out the four sandbox sources in scan order", () => {
    const integrations = selectIntegrations({}, undefined, () => undefined);
    expect(integrations.signals.map((s) => s.id)).toEqual(["reddit", "producthunt", "google_trends", "competitor_sites"]);
    expect(integrations.signals[0]).toBeInstanceOf(SandboxReddit);
    expect(integrations.signals[1]).toBeInstanceOf(SandboxProductHunt);
    expect(integrations.signals[2]).toBeInstanceOf(SandboxGoogleTrends);
    expect(integrations.signals[3]).toBeInstanceOf(SandboxCompetitorSites);
  });

  it("live mode: reddit and competitor sites read the public web; Product Hunt and Google Trends are stubs that say why", async () => {
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live", ...RESEND, ...VAPID }, undefined, () => undefined);
    expect(integrations.signals.map((s) => s.id)).toEqual(["reddit", "competitor_sites", "producthunt", "google_trends"]);
    expect(integrations.signals[0]).toBeInstanceOf(RedditSignals);
    expect(integrations.signals[1]).toBeInstanceOf(CompetitorSites);
    expect(integrations.signals[2]).toBeInstanceOf(ProductHuntSignals);
    expect(integrations.signals[3]).toBeInstanceOf(GoogleTrendsSignals);
    await expect(integrations.signals[2]!.scan(scan)).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(integrations.signals[2]!.scan(scan)).rejects.toThrow(/developer token/);
    await expect(integrations.signals[3]!.scan(scan)).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(integrations.signals[3]!.scan(scan)).rejects.toThrow(/terms/);
    expect(PRODUCTHUNT_NOT_CONFIGURED).toMatch(/GraphQL/);
    expect(GOOGLE_TRENDS_NOT_CONFIGURED).toMatch(/no official API/);
  });

  it("live competitor sites need an injected host policy: without one every URL is skipped and a warning says so at selection", async () => {
    const { lines, warn } = warnings();
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      calls.push(url);
      return new Response("<title>T</title>", { status: 200, headers: { "content-type": "text/html" } });
    };
    const denied = selectIntegrations({ INTEGRATIONS_MODE: "live", ...RESEND, ...VAPID }, undefined, warn, { fetchImpl });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/allowUrl/);
    expect(await denied.signals[1]!.scan(scan)).toEqual([]);
    expect(calls).toEqual([]);

    const allowed = selectIntegrations({ INTEGRATIONS_MODE: "live", ...RESEND, ...VAPID }, undefined, () => undefined, { fetchImpl, allowUrl: async () => true });
    expect(await allowed.signals[1]!.scan(scan)).toHaveLength(1);
    expect(calls).toEqual(["https://incumbent-a.example/pricing"]);
  });
});
