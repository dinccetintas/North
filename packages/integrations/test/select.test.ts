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
import { StripeBilling } from "../src/live/stripe-billing";
import { StripeReadPayments } from "../src/live/stripe-read";
import { WebPush } from "../src/live/web-push";
import { SandboxAds } from "../src/sandbox/ads";
import { SandboxAnalytics } from "../src/sandbox/analytics";
import { SandboxBilling } from "../src/sandbox/billing";
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
const STRIPE = { STRIPE_SECRET_KEY: "fake-platform-key", STRIPE_WEBHOOK_SECRET: "fake-webhook-secret" };

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
      expect(integrations.billing).toBeInstanceOf(SandboxBilling);
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
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live", ...RESEND, ...VAPID, ...STRIPE }, undefined, warn, { allowUrl: async () => true });
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

  it("live analytics is an honest stub; live payments is the user's Stripe read, which refuses without a connection", async () => {
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live" }, undefined, () => undefined);
    expect(integrations.analytics({ token: "t" })).toBeInstanceOf(PostHogAnalytics);
    expect(integrations.payments({ token: "t", scope: "acct_1A" })).toBeInstanceOf(StripeReadPayments);
    await expect(integrations.analytics(null).read("c1")).rejects.toThrow(/tracker/);
    await expect(integrations.payments(null).read("c1")).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(integrations.payments(null).read("c1")).rejects.toThrow(/not connected/);
    const google = new GoogleAds();
    await expect(google.startCampaign({ companyId: "c1", name: "n", dailyBudgetUsd: 1 })).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(google.pauseMany("c1", ["x"])).rejects.toThrow(/developer-token/);
    await expect(google.status("c1", "x")).rejects.toThrow(/Meta first/);
  });

  it("in live mode without platform keys mail, push and billing fall back to sandbox and warn once each; ads never does", () => {
    const { lines, warn } = warnings();
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live" }, undefined, warn);
    expect(integrations.mail).toBeInstanceOf(SandboxMail);
    expect(integrations.push).toBeInstanceOf(SandboxPush);
    expect(integrations.billing).toBeInstanceOf(SandboxBilling);
    expect(integrations.ads(null)).toBeInstanceOf(MetaAds);
    expect(lines.filter((l) => !/competitor/.test(l))).toHaveLength(3);
    expect(lines.join("\n")).toMatch(/mail/);
    expect(lines.join("\n")).toMatch(/push/);
    expect(lines.join("\n")).toMatch(/the billing keys are missing; using the billing sandbox adapter/);
    expect(lines.join("\n")).not.toMatch(/ads/);
  });

  it("the platform Meta keys are gone: they select nothing", () => {
    const { lines, warn } = warnings();
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live", META_ACCESS_TOKEN: "tok", META_AD_ACCOUNT_ID: "act_1", ...RESEND, ...VAPID, ...STRIPE }, undefined, warn);
    expect(integrations.ads(null)).toBeInstanceOf(MetaAds);
    expect(lines.filter((l) => !/competitor/.test(l))).toEqual([]);
  });

  it("treats a half-configured provider as missing", () => {
    const { lines, warn } = warnings();
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live", RESEND_API_KEY: "re_x", VAPID_PUBLIC_KEY: "pub", STRIPE_SECRET_KEY: "fake-x" }, undefined, warn);
    expect(integrations.mail).toBeInstanceOf(SandboxMail);
    expect(integrations.push).toBeInstanceOf(SandboxPush);
    expect(integrations.billing).toBeInstanceOf(SandboxBilling);
    expect(lines.filter((l) => !/competitor/.test(l))).toHaveLength(3);
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
    const denied = selectIntegrations({ INTEGRATIONS_MODE: "live", ...RESEND, ...VAPID, ...STRIPE }, undefined, warn, { fetchImpl });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/allowUrl/);
    expect(await denied.signals[1]!.scan(scan)).toEqual([]);
    expect(calls).toEqual([]);

    const allowed = selectIntegrations({ INTEGRATIONS_MODE: "live", ...RESEND, ...VAPID }, undefined, () => undefined, { fetchImpl, allowUrl: async () => true });
    expect(await allowed.signals[1]!.scan(scan)).toHaveLength(1);
    expect(calls).toEqual(["https://incumbent-a.example/pricing"]);
  });
});

describe("B6-4 selectIntegrations: billing and the user's Stripe (BIL-1, OUT-2)", () => {
  const USER = "8f14e45f-ceea-467f-a0e6-0e1a2b3c4d5e";

  it("sandbox: billing is the SandboxBilling of the simulation surface, on SANDBOX_ROOT and SANDBOX_SITE_BASE_URL, keys ignored", async () => {
    const root = await mkdtemp(join(tmpdir(), "north-select-billing-"));
    const { lines, warn } = warnings();
    const integrations = selectIntegrations({ SANDBOX_ROOT: root, SANDBOX_SITE_BASE_URL: "http://127.0.0.1:4101", ...STRIPE }, undefined, warn);
    expect(integrations.billing).toBeInstanceOf(SandboxBilling);
    expect(integrations.billing).toBe((integrations as ReturnType<typeof createSandboxIntegrations>).sandbox.billing);
    const { customerId } = await integrations.billing.ensureCustomer({ userId: USER, email: "mara@example.test" });
    const session = await integrations.billing.createPortalSession({ customerId, returnUrl: "http://localhost:3100/settings/billing" });
    expect(session.url).toBe(`http://127.0.0.1:4101/sandbox/billing/portal/${customerId}`);
    expect(lines).toEqual([]);
  });

  it("live with both Stripe keys: the StripeBilling adapter over the injected fetch, no billing warning", async () => {
    const { lines, warn } = warnings();
    const urls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
      urls.push(url);
      return new Response(JSON.stringify({ object: "search_result", data: [{ id: "cus_live1" }], has_more: false }), { status: 200 });
    };
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live", ...RESEND, ...VAPID, ...STRIPE }, undefined, warn, { fetchImpl, allowUrl: async () => true });
    expect(integrations.billing).toBeInstanceOf(StripeBilling);
    await expect(integrations.billing.ensureCustomer({ userId: USER, email: "mara@example.test" })).resolves.toEqual({ customerId: "cus_live1", sandbox: false });
    expect(urls[0]?.startsWith("https://api.stripe.com/v1/customers/search?")).toBe(true);
    expect(lines).toEqual([]);
  });

  it("TST-5 live under the test fence: a live Stripe key is refused and billing stays sandbox; a test key is the real adapter", () => {
    const { lines, warn } = warnings();
    const fenced = selectIntegrations({ INTEGRATIONS_MODE: "live", ...RESEND, ...VAPID, STRIPE_SECRET_KEY: "sk_live_x", STRIPE_WEBHOOK_SECRET: "w" }, undefined, warn, { allowUrl: async () => true, requireStripeTestKey: true });
    expect(fenced.billing).toBeInstanceOf(SandboxBilling);
    expect(lines.filter((line) => /billing/.test(line))).toEqual([expect.stringContaining("billing: live key refused by the test fence")]);
    expect(lines.join("\n")).not.toMatch(/billing keys are missing/);
    expect(lines.join("\n")).not.toContain("sk_live_x");
    const test = selectIntegrations({ INTEGRATIONS_MODE: "live", ...RESEND, ...VAPID, STRIPE_SECRET_KEY: "sk_test_x", STRIPE_WEBHOOK_SECRET: "w" }, undefined, () => undefined, { allowUrl: async () => true, requireStripeTestKey: true });
    expect(test.billing).toBeInstanceOf(StripeBilling);
  });

  it("live: the user's Stripe read uses the injected fetch and the connection's account", async () => {
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      seen.push(`${new URL(url).pathname} ${(init?.headers as Record<string, string>)["stripe-account"]}`);
      return new Response(JSON.stringify({ object: "list", data: [], has_more: false }), { status: 200 });
    };
    const integrations = selectIntegrations({ INTEGRATIONS_MODE: "live", ...RESEND, ...VAPID, ...STRIPE }, undefined, () => undefined, { fetchImpl, allowUrl: async () => true });
    await expect(integrations.payments({ token: "tok_user", scope: "acct_1User" }).read("c1")).resolves.toEqual({ payingCustomers: 0, mrrUsd: 0, revenueUsd: 0, sandbox: false });
    expect(seen).toEqual(["/v1/subscriptions acct_1User", "/v1/charges acct_1User"]);
  });
});
