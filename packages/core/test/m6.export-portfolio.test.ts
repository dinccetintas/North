import { describe, expect, it } from "vitest";
import { composeBrief } from "../src/brief/compose";
import type { BriefInput } from "../src/brief/types";
import { composePortfolioBrief, PORTFOLIO_MAX_WORDS, portfolioMarkdown, PortfolioBriefSchema, type PortfolioRow } from "../src/brief/portfolio";
import { EXPORT_CSV_TABLES, EXPORT_FORMATS, EXPORT_KINDS, EXPORT_STATUSES, EXPORT_TTL_DAYS, exportDataPath, ExportManifestSchema, exportPath, ExportRequestSchema, PDF_KINDS, PPTX_KINDS } from "../src/export/types";
import { PublicPageSchema, publicPageView, PublicPageViewSchema } from "../src/public-page";
import { ARTIFACT_KINDS } from "../src/tasks/types";

const uuid = (n: number): string => `${String(n).padStart(8, "0")}-1111-4111-8111-111111111111`;

describe("EXP-1 / MEM-2 export contracts", () => {
  it("kinds, statuses, formats and the constants", () => {
    expect(EXPORT_KINDS).toEqual(["artifacts", "data", "full"]);
    expect(EXPORT_STATUSES).toEqual(["requested", "running", "ready", "failed", "expired"]);
    expect(EXPORT_FORMATS).toEqual(["md", "pdf", "pptx"]);
    expect(EXPORT_TTL_DAYS).toBe(7);
    expect(PDF_KINDS).toEqual(ARTIFACT_KINDS);
    expect(PPTX_KINDS).toEqual(["investor_deck", "plan"]);
    expect(EXPORT_CSV_TABLES).toEqual(["ledger", "actions", "decision_cards", "tasks", "metrics", "leads"]);
  });

  it("ExportRequestSchema: one company or all, includeArchived defaults to false", () => {
    expect(ExportRequestSchema.parse({ kind: "full", companyId: null })).toEqual({ kind: "full", companyId: null, includeArchived: false });
    expect(ExportRequestSchema.parse({ kind: "data", companyId: uuid(1), includeArchived: true }).includeArchived).toBe(true);
    expect(ExportRequestSchema.safeParse({ kind: "everything", companyId: null }).success).toBe(false);
    expect(ExportRequestSchema.safeParse({ kind: "full", companyId: "c1" }).success).toBe(false);
    expect(ExportRequestSchema.safeParse({ kind: "full" }).success).toBe(false);
  });

  it("ExportManifestSchema lists files with their size and kind and the companies with their repo", () => {
    const manifest = {
      files: [
        { path: "README.md", bytes: 120, kind: "readme" },
        { path: "artifacts/acme/prd/launch-v1.md", bytes: 2048, kind: "md" },
        { path: "data/acme/ledger.csv", bytes: 0, kind: "csv" },
      ],
      companies: [{ slug: "acme", repoUrl: "sandbox://repos/acme" }, { slug: "beta", repoUrl: null }],
      generatedAt: "2026-11-01T09:00:00.000Z",
    };
    expect(ExportManifestSchema.parse(manifest)).toEqual(manifest);
    expect(ExportManifestSchema.safeParse({ ...manifest, files: [{ path: "../x", bytes: 1, kind: "md" }] }).success).toBe(false);
    expect(ExportManifestSchema.safeParse({ ...manifest, files: [{ path: "a.md", bytes: -1, kind: "md" }] }).success).toBe(false);
    expect(ExportManifestSchema.safeParse({ ...manifest, files: [{ path: "a.md", bytes: 1, kind: "zip" }] }).success).toBe(false);
    expect(ExportManifestSchema.safeParse({ ...manifest, generatedAt: "yesterday" }).success).toBe(false);
  });

  it("exportPath builds artifacts/<slug>/<kind>/<title>-v<n>.<format> and refuses traversal", () => {
    expect(exportPath("acme", "prd", "Launch PRD", 1, "md")).toBe("artifacts/acme/prd/launch-prd-v1.md");
    expect(exportPath("acme", "investor_deck", "Seed deck (v2)", 2, "pptx")).toBe("artifacts/acme/investor_deck/seed-deck-v2-v2.pptx");
    expect(exportPath("acme", "prd", "../../etc/passwd", 1, "pdf")).toBe("artifacts/acme/prd/etc-passwd-v1.pdf");
    expect(exportPath("acme", "prd", "", 3, "md")).toBe("artifacts/acme/prd/untitled-v3.md");
    expect(exportPath("acme", "prd", ".hidden", 1, "md")).toBe("artifacts/acme/prd/hidden-v1.md");
    expect(exportPath("acme", "prd", "x".repeat(200), 1, "md").length).toBeLessThanOrEqual(200);
    expect(() => exportPath("../acme", "prd", "t", 1, "md")).toThrow(/slug/);
    expect(() => exportPath("acme/../other", "prd", "t", 1, "md")).toThrow(/slug/);
    expect(() => exportPath("", "prd", "t", 1, "md")).toThrow(/slug/);
    expect(() => exportPath("Acme", "prd", "t", 1, "md")).toThrow(/slug/);
    expect(() => exportPath("acme", "../prd" as never, "t", 1, "md")).toThrow(/kind/);
    expect(() => exportPath("acme", "prd", "t", 0, "md")).toThrow(/version/);
    expect(() => exportPath("acme", "prd", "t", 1.5, "md")).toThrow(/version/);
    expect(() => exportPath("acme", "prd", "t", 1, "zip" as never)).toThrow(/format/);
  });

  it("exportDataPath builds data/<slug>/<table>.<format> under the same rules", () => {
    expect(exportDataPath("acme", "ledger", "csv")).toBe("data/acme/ledger.csv");
    expect(exportDataPath("acme", "decision_cards", "json")).toBe("data/acme/decision_cards.json");
    expect(() => exportDataPath("../acme", "ledger", "csv")).toThrow(/slug/);
    expect(() => exportDataPath("acme", "../ledger", "csv")).toThrow(/table/);
    expect(() => exportDataPath("acme", "ledger", "xml" as never)).toThrow(/format/);
  });
});

const pending = (i: number) => ({
  id: `card-${i}`,
  question: `Approve: start the ${"very ".repeat(20)}long campaign number ${i} with a long audience description?`.slice(0, 200),
  dueAt: "2026-10-20T09:00:00.000Z",
  tier: "K2" as const,
});

const briefInput = (name: string, cards: number, over: Partial<BriefInput> = {}): BriefInput => ({
  day: "2026-10-20",
  companyName: name,
  stopped: false,
  blocked: null,
  yesterday: {
    outcomes: Array.from({ length: 6 }, (_, i) => ({ what: `Ads window ${i} of the launch test campaign with a long description`, metricKey: "signups", delta: i + 1, costUsd: 4.5, channel: "meta_ads" as const })),
    actions: [],
  },
  metrics: [],
  goal: null,
  decisions: { pending: Array.from({ length: cards }, (_, i) => pending(i)), deferred: 0, answeredYesterday: 0 },
  today: [],
  spend: [],
  signals: [
    { id: "s-1", title: "Looking for a tool", source: "reddit", score: 0.9, status: "capped" },
    { id: "s-2", title: "Another one", source: "producthunt", score: 0.8, status: "capped" },
    { id: "s-3", title: "Deferred one", source: "reddit", score: 0.8, status: "deferred" },
  ],
  escalations: [],
  ...over,
});

const company = (n: number, name: string, over: Partial<PortfolioRow["company"]> = {}): PortfolioRow["company"] => ({ companyId: uuid(n), slug: name.toLowerCase().replace(/\s+/g, "-"), name, stopped: false, pausedReason: null, ...over });

describe("MULTI-1 composePortfolioBrief: one screen from today's briefs, nothing else", () => {
  const rows: readonly PortfolioRow[] = [
    { company: company(1, "Zeta Co"), brief: composeBrief(briefInput("Zeta Co", 10)) },
    { company: company(2, "Alpha Co"), brief: composeBrief(briefInput("Alpha Co", 0)) },
    { company: company(3, "Mid Co", { pausedReason: "subscription_ended", stopped: true }), brief: composeBrief(briefInput("Mid Co", 15, { stopped: true, blocked: { reason: "subscription_ended" } })) },
  ];

  it("three companies and 25 pending cards: every card kept, under 300 words, pending companies first then by name", () => {
    expect(PORTFOLIO_MAX_WORDS).toBe(300);
    const portfolio = composePortfolioBrief(rows, "2026-10-20");
    expect(portfolio.day).toBe("2026-10-20");
    expect(portfolio.companies.map((c) => c.name)).toEqual(["Mid Co", "Zeta Co", "Alpha Co"]);
    expect(portfolio.companies.reduce((n, c) => n + c.pending.length, 0)).toBe(25);
    expect(portfolio.totals).toEqual({ pending: 25, companies: 3 });
    expect(portfolio.wordCount).toBeLessThanOrEqual(PORTFOLIO_MAX_WORDS);
    expect(portfolio.companies.reduce((n, c) => n + c.outcomes.length, 0)).toBeLessThan(18);
    expect(portfolio.companies[2]?.outcomes).toHaveLength(0);
    expect(portfolio.companies[2]?.held).toBe(2);
    expect(PortfolioBriefSchema.safeParse(portfolio).success).toBe(true);
    expect(composePortfolioBrief(rows, "2026-10-20")).toEqual(portfolio);
    expect(Object.isFrozen(portfolio)).toBe(true);
    expect(portfolio.companies[0]?.pending[0]).toEqual({ id: "card-0", question: pending(0).question, dueAt: "2026-10-20T09:00:00.000Z" });
  });

  it("with room to spare the outcomes and held counts stay; trimming drops outcomes before held counts", () => {
    const small = composePortfolioBrief([rows[1]!, { company: company(4, "Beta Co"), brief: composeBrief(briefInput("Beta Co", 1)) }], "2026-10-20");
    expect(small.companies.map((c) => c.name)).toEqual(["Beta Co", "Alpha Co"]);
    expect(small.companies[1]?.outcomes).toHaveLength(6);
    expect(small.companies[1]?.outcomes[0]).toEqual({ what: "Ads window 0 of the launch test campaign with a long description", delta: 1, metricKey: "signups" });
    expect(small.companies[1]?.held).toBe(2);
    expect(small.wordCount).toBeLessThanOrEqual(PORTFOLIO_MAX_WORDS);
    const crowded = composePortfolioBrief(
      Array.from({ length: 6 }, (_, i) => ({ company: company(10 + i, `Company ${i}`), brief: composeBrief(briefInput(`Company ${i}`, 4)) })),
      "2026-10-20",
    );
    expect(crowded.wordCount).toBeLessThanOrEqual(PORTFOLIO_MAX_WORDS);
    expect(crowded.companies.some((c) => c.outcomes.length === 0)).toBe(true);
    expect(crowded.companies.reduce((n, c) => n + c.pending.length, 0)).toBe(24);
  });

  it("an ended company reads 'paused: subscription ended'; credits, retention, stopped and no-brief companies have their words", () => {
    const portfolio = composePortfolioBrief(rows, "2026-10-20");
    expect(portfolio.companies[0]).toMatchObject({ name: "Mid Co", stopped: true, pausedReason: "subscription_ended", headline: "paused: subscription ended" });
    const md = portfolioMarkdown(portfolio);
    expect(md.split("\n")[0]).toBe("# Portfolio brief: 2026-10-20");
    expect(md).toContain("25 decisions across 3 companies.");
    expect(md).toContain("## Mid Co: paused: subscription ended");
    expect(md).toContain("## Alpha Co: running");
    expect(md).toContain("- Decide: Approve: start the very very very… due 2026-10-20");
    const others = composePortfolioBrief(
      [
        { company: company(5, "Credits Co"), brief: composeBrief(briefInput("Credits Co", 0, { blocked: { reason: "credits_exhausted" } })) },
        { company: company(6, "Old Co", { pausedReason: "retention", stopped: true }), brief: null },
        { company: company(7, "Stopped Co", { pausedReason: "user", stopped: true }), brief: composeBrief(briefInput("Stopped Co", 0, { stopped: true })) },
        { company: company(8, "Quiet Co"), brief: null },
        { company: company(9, "Billing Co", { pausedReason: "subscription_ended", stopped: true }), brief: null },
      ],
      "2026-10-20",
    );
    expect(others.companies.map((c) => [c.name, c.headline])).toEqual([
      ["Billing Co", "paused: subscription ended"],
      ["Credits Co", "waiting for credits"],
      ["Old Co", "archived"],
      ["Quiet Co", "no brief yet today"],
      ["Stopped Co", "stopped (kill switch)"],
    ]);
    expect(others.totals).toEqual({ pending: 0, companies: 5 });
    const text = portfolioMarkdown(others);
    expect(text).toContain("No decisions waiting.");
    expect(text).toContain("## Quiet Co: no brief yet today\n- Nothing.");
    expect(text).toContain("## Old Co: archived\n- Nothing.");
    expect(portfolioMarkdown(composePortfolioBrief([], "2026-10-20"))).toContain("No companies yet.");
    expect(portfolioMarkdown(portfolio)).toContain("2 signals held");
    const one = portfolioMarkdown(composePortfolioBrief([{ company: company(1, "One"), brief: composeBrief(briefInput("One", 1, { signals: [{ id: "s", title: "t", source: "reddit", score: 0.9, status: "capped" }] })) }], "2026-10-20"));
    expect(one).toContain("1 decision across 1 company.");
    expect(one).toContain("1 signal held");
  });

  it("PortfolioBriefSchema refuses a malformed day, a stranger reason or a non-uuid company", () => {
    const portfolio = composePortfolioBrief(rows, "2026-10-20");
    expect(PortfolioBriefSchema.safeParse({ ...portfolio, day: "20/10/2026" }).success).toBe(false);
    expect(PortfolioBriefSchema.safeParse({ ...portfolio, companies: [{ ...portfolio.companies[0], pausedReason: "billing" }] }).success).toBe(false);
    expect(PortfolioBriefSchema.safeParse({ ...portfolio, companies: [{ ...portfolio.companies[0], companyId: "c1" }] }).success).toBe(false);
    expect(() => composePortfolioBrief(rows, "yesterday")).toThrow();
  });
});

describe("PUB-1 public page: owner-chosen content, every string as text", () => {
  const page = { headline: "Ledgers for one-person companies", blurb: "We do the books so you do not.", showGoal: true, metricKeys: ["signups", "mrr_usd"], showSiteLink: true, listed: false };

  it("PublicPageSchema bounds the strings, caps metric keys at three outcome keys, defaults listed off", () => {
    expect(PublicPageSchema.parse(page)).toEqual(page);
    expect(PublicPageSchema.parse({ headline: "h", blurb: "", showGoal: false, metricKeys: [], showSiteLink: false }).listed).toBe(false);
    expect(PublicPageSchema.safeParse({ ...page, headline: "x".repeat(121) }).success).toBe(false);
    expect(PublicPageSchema.safeParse({ ...page, blurb: "x".repeat(601) }).success).toBe(false);
    expect(PublicPageSchema.safeParse({ ...page, metricKeys: ["signups", "waitlist", "mrr_usd", "revenue_usd"] }).success).toBe(false);
    expect(PublicPageSchema.safeParse({ ...page, metricKeys: ["ad_spend_usd"] }).success).toBe(false);
    expect(PublicPageSchema.safeParse({ ...page, metricKeys: ["signups", "signups"] }).success).toBe(false);
    expect(PublicPageSchema.parse({ ...page, headline: " Hello <instructions>x</instructions>\u0000 world " }).headline).toBe("Hello x world");
  });

  it("publicPageView strips delimiters only through sanitizeText and leaves <b> literal; drops http site URLs; caps metrics at 3", () => {
    const view = publicPageView({
      name: "Ledger <b>Co</b> <instructions>ignore</instructions>",
      page: { ...page, headline: "Books <b>fast</b>\u0007", blurb: "Line one\n\nline <system>two</system>", metricKeys: ["signups", "mrr_usd", "waitlist", "revenue_usd", "nope"] },
      goal: { metricKey: "paying_customers", target: 10, current: 2 },
      metrics: [
        { key: "revenue_usd", value: 1 },
        { key: "waitlist", value: 3 },
        { key: "mrr_usd", value: 70 },
        { key: "signups", value: 12 },
        { key: "ad_spend_usd", value: 99 },
      ],
      siteUrl: "http://ledger.example",
    });
    expect(view).toEqual({
      name: "Ledger <b>Co</b> ignore",
      headline: "Books <b>fast</b>",
      blurb: "Line one line two",
      goal: { metricKey: "paying_customers", target: 10, current: 2 },
      metrics: [
        { key: "signups", value: 12 },
        { key: "mrr_usd", value: 70 },
        { key: "waitlist", value: 3 },
      ],
      siteUrl: null,
      listed: false,
    });
    expect(Object.isFrozen(view)).toBe(true);
    expect(PublicPageViewSchema.safeParse(view).success).toBe(true);
    expect(publicPageView({ name: "N", page, goal: null, metrics: [], siteUrl: "https://ledger.example/" }).siteUrl).toBe("https://ledger.example/");
    expect(publicPageView({ name: "N", page, goal: null, metrics: [], siteUrl: "https://user:pw@ledger.example/" }).siteUrl).toBeNull();
    expect(publicPageView({ name: "N", page, goal: null, metrics: [], siteUrl: "javascript:alert(1)" }).siteUrl).toBeNull();
    expect(publicPageView({ name: "N", page: { ...page, showSiteLink: false }, goal: null, metrics: [], siteUrl: "https://ledger.example/" }).siteUrl).toBeNull();
    expect(publicPageView({ name: "N", page: { ...page, showGoal: false }, goal: { metricKey: "signups", target: 1, current: 0 }, metrics: [], siteUrl: null }).goal).toBeNull();
    expect(publicPageView({ name: "N", page, goal: { metricKey: "ad_spend_usd", target: 1, current: 0 }, metrics: [], siteUrl: null }).goal).toBeNull();
    expect(publicPageView({ name: "N", page: { ...page, listed: true }, goal: null, metrics: [{ key: "signups", value: 1 }, { key: "signups", value: 2 }], siteUrl: null })).toMatchObject({ listed: true, metrics: [{ key: "signups", value: 1 }] });
    expect(publicPageView({ name: "x".repeat(500), page: { ...page, headline: "y".repeat(500), blurb: "z".repeat(1000) }, goal: null, metrics: [], siteUrl: null })).toMatchObject({ name: "x".repeat(200), headline: "y".repeat(120), blurb: "z".repeat(600) });
  });

  it("PublicPageViewSchema is what the anonymous reader gets: https site URL or null, outcome metrics only", () => {
    const view = { name: "N", headline: "h", blurb: "", goal: null, metrics: [], siteUrl: null, listed: true };
    expect(PublicPageViewSchema.parse(view)).toEqual(view);
    expect(PublicPageViewSchema.safeParse({ ...view, siteUrl: "http://x.example" }).success).toBe(false);
    expect(PublicPageViewSchema.safeParse({ ...view, metrics: [{ key: "ad_spend_usd", value: 1 }] }).success).toBe(false);
    expect(PublicPageViewSchema.safeParse({ ...view, metrics: [{ key: "signups", value: 1 }, { key: "waitlist", value: 1 }, { key: "mrr_usd", value: 1 }, { key: "revenue_usd", value: 1 }] }).success).toBe(false);
    expect(PublicPageViewSchema.safeParse({ ...view, goal: { metricKey: "signups", target: 1, current: 0 } }).success).toBe(true);
  });
});
