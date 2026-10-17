import { describe, expect, it } from "vitest";
import { BILLING_LOOKUP_KEYS, CREDIT_PACKS, SUBSCRIPTION_PLANS } from "@north/core";
import { BillingProviderError } from "../src/errors";
import {
  BILLING_CHECKOUT_MODES,
  CheckoutSessionInputSchema,
  CreditPackSessionInputSchema,
  EnsureCustomerInputSchema,
  PortalSessionInputSchema,
  isAllowedBillingUrl,
  packForLookupKey,
  type BillingProvider,
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
    expect(PROVIDERS).toEqual(["ads", "mail", "outreach", "analytics", "payments", "push", "code", "deploy", "images", "signals", "billing"]);
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

  it("TST-5 a fullName that could move the API path is refused by both schemas; a real owner/repo passes", () => {
    const files = [{ path: "index.html", content: "x" }];
    for (const fullName of ["allowed/../victim/repo", "allowed/%2e%2e/victim/repo", "allowed/..", "owner/repo/extra", "own.er/repo"]) {
      expect(PushTreeInputSchema.safeParse({ companyId: "c1", fullName, message: "m", files }).success, fullName).toBe(false);
      expect(OpenPullRequestInputSchema.safeParse({ companyId: "c1", fullName, head: "fix/x", title: "t" }).success, fullName).toBe(false);
    }
    expect(PushTreeInputSchema.parse({ companyId: "c1", fullName: "Owner/repo.name-1", message: "m", files }).fullName).toBe("Owner/repo.name-1");
    expect(OpenPullRequestInputSchema.parse({ companyId: "c1", fullName: "Owner/repo.name-1", head: "fix/x", title: "t" }).fullName).toBe("Owner/repo.name-1");
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

describe("B6-1 billing contracts (BIL-1, BIL-2: the platform is the merchant)", () => {
  const userId = "8f14e45f-ceea-467f-a0e6-0e1a2b3c4d5e";
  const checkout = {
    customerId: "cus_sandbox_1",
    lookupKey: SUBSCRIPTION_PLANS.pro.lookupKey,
    clientReferenceId: userId,
    successUrl: "https://app.north.example/settings/billing?checkout=s1",
    cancelUrl: "https://app.north.example/settings/billing",
    idempotencyKey: "2b1f5a8e-4c1d-4e8a-9f3b-7d6c5e4a3b21",
  };

  it("checkout input takes a plan lookup key from the core config, defaults to subscription mode and refuses any other key", () => {
    expect(CheckoutSessionInputSchema.parse(checkout)).toEqual({ ...checkout, mode: "subscription" });
    expect(BILLING_CHECKOUT_MODES).toEqual(["subscription", "payment"]);
    expect(CheckoutSessionInputSchema.safeParse({ ...checkout, lookupKey: "north_free_forever" }).success).toBe(false);
    expect(CheckoutSessionInputSchema.safeParse({ ...checkout, lookupKey: "price_1Pxyz" }).success).toBe(false);
    expect(CheckoutSessionInputSchema.safeParse({ ...checkout, lookupKey: CREDIT_PACKS[0]!.lookupKey }).success).toBe(false);
    expect(CheckoutSessionInputSchema.safeParse({ ...checkout, mode: "payment" }).success).toBe(false);
    expect(CheckoutSessionInputSchema.safeParse({ ...checkout, mode: "payment", lookupKey: CREDIT_PACKS[0]!.lookupKey }).success).toBe(true);
    expect(CheckoutSessionInputSchema.safeParse({ ...checkout, mode: "setup" }).success).toBe(false);
    for (const key of BILLING_LOOKUP_KEYS) expect(typeof key).toBe("string");
  });

  it("checkout input needs a uuid user reference, a Stripe-shaped customer id and a safe idempotency key", () => {
    expect(CheckoutSessionInputSchema.safeParse({ ...checkout, clientReferenceId: "user-1" }).success).toBe(false);
    expect(CheckoutSessionInputSchema.safeParse({ ...checkout, customerId: "../../etc/passwd" }).success).toBe(false);
    expect(CheckoutSessionInputSchema.safeParse({ ...checkout, customerId: "acct_1" }).success).toBe(false);
    expect(CheckoutSessionInputSchema.safeParse({ ...checkout, idempotencyKey: "" }).success).toBe(false);
    expect(CheckoutSessionInputSchema.safeParse({ ...checkout, idempotencyKey: "a/b" }).success).toBe(false);
  });

  it("return URLs are https, or http on a loopback origin (the app in development); nothing else", () => {
    expect(isAllowedBillingUrl("https://app.north.example/settings/billing")).toBe(true);
    expect(isAllowedBillingUrl("http://localhost:3100/settings/billing")).toBe(true);
    expect(isAllowedBillingUrl("http://127.0.0.1:3000/settings/billing?checkout={CHECKOUT_SESSION_ID}")).toBe(true);
    expect(isAllowedBillingUrl("http://evil.example/settings/billing")).toBe(false);
    expect(isAllowedBillingUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedBillingUrl("https://user:pass@app.north.example/")).toBe(false);
    expect(isAllowedBillingUrl("not a url")).toBe(false);
    expect(CheckoutSessionInputSchema.safeParse({ ...checkout, successUrl: "http://evil.example/ok" }).success).toBe(false);
    expect(CheckoutSessionInputSchema.safeParse({ ...checkout, cancelUrl: `https://a.example/${"x".repeat(2100)}` }).success).toBe(false);
    expect(PortalSessionInputSchema.safeParse({ customerId: "cus_1", returnUrl: "http://localhost:3100/settings/billing" }).success).toBe(true);
    expect(PortalSessionInputSchema.safeParse({ customerId: "cus_1", returnUrl: "ftp://files.example/" }).success).toBe(false);
  });

  it("a credit pack session names a pack from the core config; packForLookupKey maps a key back to its pack", () => {
    const pack = { customerId: "cus_1", packId: "pack_100", clientReferenceId: userId, successUrl: checkout.successUrl, cancelUrl: checkout.cancelUrl, idempotencyKey: "k-1" };
    expect(CreditPackSessionInputSchema.parse(pack)).toEqual(pack);
    expect(CreditPackSessionInputSchema.safeParse({ ...pack, packId: "pack_999" }).success).toBe(false);
    expect(packForLookupKey("north_pack_100")?.id).toBe("pack_100");
    expect(packForLookupKey(SUBSCRIPTION_PLANS.solo.lookupKey)).toBeNull();
  });

  it("ensureCustomer input is a uuid user and an email", () => {
    expect(EnsureCustomerInputSchema.parse({ userId, email: "mara@example.test" })).toEqual({ userId, email: "mara@example.test" });
    expect(EnsureCustomerInputSchema.safeParse({ userId: "u1", email: "mara@example.test" }).success).toBe(false);
    expect(EnsureCustomerInputSchema.safeParse({ userId, email: "nope" }).success).toBe(false);
  });

  it("BillingProviderError carries the provider's code and status only", () => {
    const error = new BillingProviderError("card_declined", 402, "POST /v1/checkout/sessions");
    expect(error.code).toBe("card_declined");
    expect(error.status).toBe(402);
    expect(error.message).toBe("stripe: POST /v1/checkout/sessions → 402 card_declined");
    expect(new BillingProviderError("resource_missing").message).toBe("stripe: resource_missing");
    expect(new BillingProviderError("Bad code with <html>").code).toBe("unknown");
  });

  it("Integrations.billing is one platform-configured BillingProvider, not a factory", async () => {
    const billing: BillingProvider = {
      ensureCustomer: async () => ({ customerId: "cus_1", sandbox: true }),
      createCheckoutSession: async () => ({ url: "https://checkout.example/c", providerRef: "cs_1", sandbox: true }),
      createCreditPackSession: async () => ({ url: "https://checkout.example/p", providerRef: "cs_2", sandbox: true }),
      createPortalSession: async () => ({ url: "https://portal.example/p", providerRef: "bps_1", sandbox: true }),
      subscription: async () => null,
    };
    const integrations: Pick<Integrations, "billing"> = { billing };
    await expect(integrations.billing.subscription("cus_1")).resolves.toBeNull();
  });
});
