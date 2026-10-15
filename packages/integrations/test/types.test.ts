import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_PROVIDER_STATUSES,
  CampaignInsightsSchema,
  CampaignSpecSchema,
  MESSAGE_STATUSES,
  OpenPullRequestInputSchema,
  PROVIDERS,
  PushTreeInputSchema,
  RepliesInputSchema,
  SIGNAL_SOURCE_IDS,
  ScanInputSchema,
  TargetingSchema,
  scopeValue,
  type AdsProvider,
  type AnalyticsProvider,
  type CodeHostProvider,
  type Integrations,
  type OutreachMailProvider,
  type PaymentsProvider,
  type ProviderAuth,
  type SignalSource,
} from "../src/types";

const base = { companyId: "c1", name: "Launch test", dailyBudgetUsd: 10 };

describe("B4-1 CampaignSpecSchema (GRW-K2)", () => {
  it("defaults targeting, audience and creative; landingUrl and pageId are optional", () => {
    const spec = CampaignSpecSchema.parse(base);
    expect(spec.targeting).toEqual({ countries: ["US"], ageMin: 18, ageMax: 65 });
    expect(spec.audience).toBe("");
    expect(spec.creativeMarkdown).toBe("");
    expect(spec.landingUrl).toBeUndefined();
    expect(spec.pageId).toBeUndefined();
  });

  it("accepts explicit targeting, an https landing URL and a page id", () => {
    const spec = CampaignSpecSchema.parse({ ...base, targeting: { countries: ["gb", "DE"], ageMin: 25, ageMax: 55 }, landingUrl: "https://acme.example/launch", pageId: "123" });
    expect(spec.targeting).toEqual({ countries: ["GB", "DE"], ageMin: 25, ageMax: 55 });
    expect(spec.landingUrl).toBe("https://acme.example/launch");
    expect(spec.pageId).toBe("123");
  });

  it("refuses bad targeting and non-http landing URLs", () => {
    expect(TargetingSchema.safeParse({ countries: [] }).success).toBe(false);
    expect(TargetingSchema.safeParse({ countries: ["USA"] }).success).toBe(false);
    expect(TargetingSchema.safeParse({ countries: ["US"], ageMin: 12 }).success).toBe(false);
    expect(TargetingSchema.safeParse({ countries: ["US"], ageMin: 40, ageMax: 30 }).success).toBe(false);
    expect(CampaignSpecSchema.safeParse({ ...base, landingUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(CampaignSpecSchema.safeParse({ ...base, landingUrl: "not a url" }).success).toBe(false);
    expect(CampaignSpecSchema.safeParse({ ...base, dailyBudgetUsd: -1 }).success).toBe(false);
  });
});

describe("B4-1 insights, statuses and reply input (OUT-2)", () => {
  it("CampaignInsights carries the four figures, asOf and the sandbox flag", () => {
    const parsed = CampaignInsightsSchema.parse({ spendUsd: 4, impressions: 800, clicks: 12, conversions: 1, asOf: "2026-10-15T10:00:00.000Z", sandbox: true });
    expect(parsed).toEqual({ spendUsd: 4, impressions: 800, clicks: 12, conversions: 1, asOf: "2026-10-15T10:00:00.000Z", sandbox: true });
    expect(CampaignInsightsSchema.safeParse({ spendUsd: 4, impressions: 1.5, clicks: 0, conversions: 0, asOf: "x", sandbox: false }).success).toBe(false);
  });

  it("lists the provider campaign and message statuses the worker switches on", () => {
    expect(CAMPAIGN_PROVIDER_STATUSES).toEqual(["active", "paused", "ended", "unknown"]);
    expect(MESSAGE_STATUSES).toEqual(["sent", "unknown"]);
    expect(PROVIDERS).toEqual(["ads", "mail", "outreach", "analytics", "payments", "push", "code", "deploy", "images", "signals"]);
  });

  it("replies input needs a company and 1-500 message ids", () => {
    expect(RepliesInputSchema.safeParse({ companyId: "c1", messageIds: ["m1"] }).success).toBe(true);
    expect(RepliesInputSchema.safeParse({ companyId: "c1", messageIds: [] }).success).toBe(false);
    expect(RepliesInputSchema.safeParse({ companyId: "", messageIds: ["m1"] }).success).toBe(false);
  });
});

describe("B4-1 ProviderAuth scopes (BUD-2: user connections, never platform keys)", () => {
  it("scopeValue reads a prefixed entry from scopes, then from the single scope, else undefined", () => {
    const auth: ProviderAuth = { token: "t", scopes: ["act:123", "page:456"] };
    expect(scopeValue(auth, "act")).toBe("123");
    expect(scopeValue(auth, "page")).toBe("456");
    expect(scopeValue(auth, "team")).toBeUndefined();
    expect(scopeValue({ token: "t", scope: "act:9" }, "act")).toBe("9");
    expect(scopeValue({ token: "t", scope: "team_1" }, "act")).toBeUndefined();
    expect(scopeValue(null, "act")).toBeUndefined();
  });

  it("the Integrations contract exposes ads, outreach, analytics and payments as factories", () => {
    const ads: AdsProvider = {
      startCampaign: async () => ({ campaignId: "x", sandbox: true }),
      insights: async () => ({ spendUsd: 0, impressions: 0, clicks: 0, conversions: 0, asOf: "now", sandbox: true }),
      pauseCampaign: async () => undefined,
      resumeCampaign: async () => undefined,
      pauseMany: async () => ({ paused: [], failed: [] }),
      status: async () => "unknown",
    };
    const outreach: OutreachMailProvider = { send: async () => ({ messageId: "m", sandbox: true }), replies: async () => [], status: async () => "unknown" };
    const analytics: AnalyticsProvider = { read: async () => null };
    const payments: PaymentsProvider = { read: async () => null };
    const integrations: Pick<Integrations, "ads" | "outreach" | "analytics" | "payments"> = { ads: () => ads, outreach: () => outreach, analytics: () => analytics, payments: () => payments };
    expect(integrations.ads(null)).toBe(ads);
    expect(integrations.outreach({ token: "t" })).toBe(outreach);
  });
});

describe("B5-1 signal sources (PRO-1)", () => {
  const scan = { companyId: "c1", since: "2026-10-08T00:00:00.000Z" };

  it("lists the four scannable sources (metrics and sentry are the worker's own)", () => {
    expect(SIGNAL_SOURCE_IDS).toEqual(["reddit", "producthunt", "google_trends", "competitor_sites"]);
  });

  it("ScanInputSchema defaults the lists and the limit and bounds every list", () => {
    const parsed = ScanInputSchema.parse(scan);
    expect(parsed).toEqual({ ...scan, queries: [], communities: [], competitorUrls: [], knownRefs: [], limit: 25 });
    expect(ScanInputSchema.safeParse({ ...scan, queries: Array.from({ length: 7 }, (_, i) => `q${i}`) }).success).toBe(false);
    expect(ScanInputSchema.safeParse({ ...scan, communities: Array.from({ length: 11 }, (_, i) => `r/c${i}`) }).success).toBe(false);
    expect(ScanInputSchema.safeParse({ ...scan, competitorUrls: Array.from({ length: 11 }, (_, i) => `https://c${i}.example/`) }).success).toBe(false);
    expect(ScanInputSchema.safeParse({ ...scan, competitorUrls: ["javascript:alert(1)"] }).success).toBe(false);
    expect(ScanInputSchema.safeParse({ ...scan, knownRefs: Array.from({ length: 501 }, (_, i) => `ref-${i}`) }).success).toBe(false);
    expect(ScanInputSchema.safeParse({ ...scan, limit: 26 }).success).toBe(false);
    expect(ScanInputSchema.safeParse({ ...scan, limit: 0 }).success).toBe(false);
    expect(ScanInputSchema.safeParse({ ...scan, since: "yesterday" }).success).toBe(false);
    expect(ScanInputSchema.safeParse({ companyId: "", since: scan.since }).success).toBe(false);
  });

  it("a SignalSource has an id from the list and a scan that returns core candidates; Integrations.signals is a list of them", () => {
    const source: SignalSource = {
      id: "reddit",
      scan: async () => [{ source: "reddit", sourceRef: "t3_1", title: "t", excerpt: "", url: null, observedAt: scan.since, baseline: false }],
    };
    const integrations: Pick<Integrations, "signals"> = { signals: [source] };
    expect(integrations.signals.map((s) => s.id)).toEqual(["reddit"]);
  });
});

describe("B5-1 pull requests and branches (PRO-2, EXP-1)", () => {
  it("OpenPullRequestInputSchema defaults base to main and an empty body, bounds the title", () => {
    const parsed = OpenPullRequestInputSchema.parse({ companyId: "c1", fullName: "mara/site", head: "fix/web-12", title: "Fix WEB-12" });
    expect(parsed).toEqual({ companyId: "c1", fullName: "mara/site", head: "fix/web-12", base: "main", title: "Fix WEB-12", body: "" });
    expect(OpenPullRequestInputSchema.safeParse({ companyId: "c1", fullName: "mara/site", head: "fix/web-12", title: "" }).success).toBe(false);
    expect(OpenPullRequestInputSchema.safeParse({ companyId: "c1", fullName: "mara/site", head: "../x", title: "t" }).success).toBe(false);
    expect(OpenPullRequestInputSchema.safeParse({ companyId: "c1", fullName: "mara/site", head: "fix/a b", title: "t" }).success).toBe(false);
  });

  it("PushTreeInput.branch defaults to main and refuses traversal or spaces", () => {
    const files = [{ path: "index.html", content: "x" }];
    expect(PushTreeInputSchema.parse({ companyId: "c1", fullName: "sandbox/site", message: "m", files }).branch).toBe("main");
    expect(PushTreeInputSchema.parse({ companyId: "c1", fullName: "sandbox/site", branch: "fix/web-12", message: "m", files }).branch).toBe("fix/web-12");
    expect(PushTreeInputSchema.safeParse({ companyId: "c1", fullName: "sandbox/site", branch: "../main", message: "m", files }).success).toBe(false);
    expect(PushTreeInputSchema.safeParse({ companyId: "c1", fullName: "sandbox/site", branch: "fix web", message: "m", files }).success).toBe(false);
  });

  it("CodeHostProvider has openPullRequest next to ensureRepo and pushTree", async () => {
    const code: CodeHostProvider = {
      ensureRepo: async () => ({ repoId: "r", fullName: "sandbox/site", url: "sandbox://repos/sandbox/site", created: true, sandbox: true }),
      pushTree: async () => ({ commitSha: "a", url: "u", sandbox: true }),
      openPullRequest: async () => ({ url: "sandbox://repos/sandbox/site/pull/1", number: 1, sandbox: true }),
    };
    await expect(code.openPullRequest({ companyId: "c1", fullName: "sandbox/site", head: "fix/x", title: "t" })).resolves.toMatchObject({ number: 1 });
  });
});
