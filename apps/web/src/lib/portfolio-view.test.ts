import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composePortfolioBrief, PORTFOLIO_MAX_WORDS, type PortfolioRow } from "@north/core/brief/portfolio";
import { trialEntitlement } from "@north/core/billing/entitlements";
import { activeCompanyCount, companyRows, newCompanyGate, portfolioView, totalsLabel } from "./portfolio-view";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const USER = "00000000-0000-4000-8000-000000000001";
const DAY = "2026-10-15";

const brief = (pending: number, outcomes = 1) => ({
  stopped: false,
  blocked: null,
  decisions: {
    pending: Array.from({ length: pending }, (_, i) => ({ id: `card-${i}`, question: `Approve step ${i}?`, dueAt: "2026-10-16T07:00:00.000Z", tier: "K2" as const })),
    deferred: 0,
    answeredYesterday: 0,
  },
  yesterday: { outcomes: Array.from({ length: outcomes }, (_, i) => ({ what: `Outcome ${i}`, metricKey: "signups", delta: 2, costUsd: 0, channel: null })), actions: [] },
  signals: [{ id: "s1", title: "Held one", source: "reddit" as const, score: 0.9, status: "capped" as const }],
});

const rows: PortfolioRow[] = [
  { company: { companyId: A, slug: "acme", name: "Acme", stopped: false, pausedReason: null }, brief: brief(0) },
  { company: { companyId: B, slug: "beta", name: "Beta", stopped: true, pausedReason: "subscription_ended" }, brief: brief(3) },
];

describe("MULTI-1 portfolio brief view", () => {
  const view = portfolioView(composePortfolioBrief(rows, DAY));

  it("keeps the core order: companies with pending cards first", () => {
    expect(view.day).toBe(DAY);
    expect(view.companies.map((c) => c.slug)).toEqual(["beta", "acme"]);
    expect(view.totals).toBe("3 decisions across 2 companies");
    expect(view.wordCount).toBeLessThanOrEqual(PORTFOLIO_MAX_WORDS);
    expect(view.words).toBe(`${view.wordCount} words`);
  });

  it("links every pending card to its detail page and says why a company is paused", () => {
    const beta = view.companies[0]!;
    expect(beta.paused).toBe(true);
    expect(beta.pausedReason).toBe("subscription_ended");
    expect(beta.headline).toBe("paused: subscription ended");
    expect(beta.pending.map((p) => p.href)).toEqual(["/c/beta/decisions/card-0", "/c/beta/decisions/card-1", "/c/beta/decisions/card-2"]);
    expect(beta.pending[0]?.due).toBe("2026-10-16");
    expect(beta.held).toBe("1 signal held");
    const acme = view.companies[1]!;
    expect(acme.paused).toBe(false);
    expect(acme.outcomes).toEqual(["Sign-ups +2: Outcome 0"]);
  });

  it("names the totals in words", () => {
    expect(totalsLabel({ pending: 1, companies: 1 })).toBe("1 decision across 1 company");
    expect(totalsLabel({ pending: 0, companies: 2 })).toBe("No decisions waiting across 2 companies");
    expect(totalsLabel({ pending: 0, companies: 0 })).toBe("No companies yet");
  });
});

describe("MULTI-1 company rows", () => {
  const companies = [
    { id: A, slug: "acme", name: "Acme", status: "active", killSwitchActive: false, pausedReason: null },
    { id: B, slug: "beta", name: "Beta", status: "paused", killSwitchActive: true, pausedReason: "subscription_ended" },
    { id: "c", slug: "gamma", name: "Gamma", status: "paused", killSwitchActive: true, pausedReason: "user" },
    { id: "d", slug: "delta", name: "Delta", status: "archived", killSwitchActive: true, pausedReason: "retention" },
  ];

  it("gives each row its state word, pending count and goal progress", () => {
    const view = companyRows(companies, new Map([[A, 2]]), new Map([[A, { metricKey: "paying_customers", target: 10, current: 3 }]]));
    expect(view.map((r) => [r.slug, r.stateWord, r.pausedReason])).toEqual([
      ["acme", "running", ""],
      ["beta", "paused: subscription ended", "subscription_ended"],
      ["gamma", "stopped", "user"],
      ["delta", "archived", "retention"],
    ]);
    expect(view[0]?.pending).toBe("2 decisions");
    expect(view[1]?.pending).toBe("No decisions");
    expect(view[0]?.goal).toEqual({ label: "Paying customers 3 / 10", percent: 30 });
    expect(view[1]?.goal).toBeNull();
  });

  it("counts the companies that take a slot of the plan (archived ones do not)", () => {
    expect(activeCompanyCount(companies)).toBe(3);
  });
});

describe("MULTI-1 the portfolio loader reads briefs, cards and goals only", () => {
  it("imports nothing from the data layer that could read memory or join companies", () => {
    const source = readFileSync(new URL("./portfolio-data.ts", import.meta.url), "utf8");
    const dbImport = /import\s*\{([^}]*)\}\s*from\s*"@north\/db"/.exec(source)?.[1] ?? "";
    const names = dbImport
      .split(",")
      .map((n) => n.replace(/\btype\b/, "").trim())
      .filter(Boolean)
      .sort();
    expect(names).toEqual(["CompanySummary", "DbClient", "latestMetric", "listBriefsForDay", "listGoals", "listPendingCards"]);
    expect(source).not.toMatch(/memory_items|\w+Memor(?:y|ies)\s*\(/);
  });
});

describe("BIL-1 new company gate", () => {
  const trial = trialEntitlement(USER, new Date("2026-10-13T00:00:00.000Z"));

  it("allows the first company on Solo and refuses the second with the plan's message", () => {
    expect(newCompanyGate(trial, 0)).toEqual({ allowed: true, reason: null });
    expect(newCompanyGate(trial, 1)).toEqual({ allowed: false, reason: "Solo includes 1 company. Upgrade to Pro for 3." });
    expect(newCompanyGate({ ...trial, planId: "pro", companyLimit: 3, status: "active" }, 1)).toEqual({ allowed: true, reason: null });
  });

  it("refuses without an entitlement: the database trigger would", () => {
    expect(newCompanyGate(null, 0).allowed).toBe(false);
  });
});
