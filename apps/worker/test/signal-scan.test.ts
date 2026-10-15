import { beforeEach, describe, expect, it, vi } from "vitest";
import { MockLlm } from "@north/agents";
import { NotConfiguredError, type SandboxEvent, type SignalSource } from "@north/integrations";
import { SimClock } from "../src/services/clock";
import { directSteps, emptyState, fakeDbModule, fakeDeps, seedCompany, type FakeState } from "./fake-db";

/**
 * D5-3 (PRO-1): on a fixed clock the sandbox sources insert two reddit rows
 * on day 0 and a rescan inserts none; a source that is not configured is
 * skipped; scores come from `MockLlm`; a foreign id is dropped; a metric
 * drop becomes a `metric_drop` row scored by rule.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { competitorUrlsFromMemory, communitiesFromMemory, detectDrops, scanContext, scanCompanySignals, scanSource, scoreNewSignals } = await import("../src/services/signal-scan");

const DAY0 = "2026-10-19T10:00:00.000Z";
let events: SandboxEvent[];
let clock: SimClock;
const deps = () => fakeDeps(state, events, 200, "sandbox", "/tmp/north-test-sandbox", clock);
const rows = () => [...state.signals.values()].map((s) => `${s.source}:${s.sourceRef}:${s.status}:${s.score}`);

beforeEach(() => {
  Object.assign(state, emptyState());
  events = [];
  clock = new SimClock(DAY0);
  seedCompany(state, { id: "company-1", timezone: "Europe/Istanbul" });
  state.memory.push({ companyId: "company-1", item: { kind: "learning", title: "Competitor: Incumbent A", content: "Pricing page: https://incumbent-a.example/pricing, see also https://incumbent-a.example/pricing" } });
  state.memory.push({ companyId: "company-1", item: { kind: "persona", title: "Primary persona", content: "Solo consultants who gather in r/freelance and r/smallbusiness." } });
});

describe("scanContext", () => {
  it("derives the queries from the thesis, the competitor URLs and communities from memory, the day from the owner's zone and the window from the clock", async () => {
    const context = await scanContext(deps(), "company-1");
    expect(context.queries[0]).toBe("solo");
    expect(context.competitorUrls).toEqual(["https://incumbent-a.example/pricing"]);
    expect(context.communities).toEqual(["r/freelance", "r/smallbusiness"]);
    expect(context.day).toBe("2026-10-19");
    expect(context.since.slice(0, 16)).toBe("2026-10-12T10:00");
    expect(context.knownRefs).toEqual([]);
    expect(competitorUrlsFromMemory([{ id: "m", kind: "doc", title: "Notes", content: "http://10.0.0.1/x and javascript:alert(1)", createdByRole: "research", createdAt: DAY0 }])).toEqual([]);
    expect(communitiesFromMemory([])).toEqual([]);
  });
});

describe("scanCompanySignals on the sandbox sources", () => {
  it("day 0 inserts the two reddit rows, scores them with MockLlm (0.85 → scored, 0.4 → below threshold) and opens one card; the same sources again insert nothing", async () => {
    const result = await scanCompanySignals(deps(), directSteps, "company-1");
    expect(result.sources.map((s) => [s.source, s.inserted, s.skipped])).toEqual([
      ["reddit", 2, null],
      ["producthunt", 0, null],
      ["google_trends", 0, null],
      ["competitor_sites", 0, null],
    ]);
    expect(result.scoring).toEqual({ scored: 1, belowThreshold: 1 });
    expect(rows()).toEqual(expect.arrayContaining(["reddit:r-solo-1:card_opened:0.85", "reddit:r-solo-2:below_threshold:0.4"]));
    expect(result.converted.cardsOpened).toHaveLength(1);
    const scored = [...state.signals.values()].find((s) => s.sourceRef === "r-solo-1")!;
    expect(scored.summary.length).toBeGreaterThan(0);
    expect(scored.rationale.length).toBeGreaterThan(0);
    expect(scored.observedAt.slice(0, 16)).toBe("2026-10-19T10:00");

    const context = await scanContext(deps(), "company-1");
    expect([...context.knownRefs].sort()).toEqual(["r-solo-1", "r-solo-2"]);
    const reddit = deps().integrations.signals.find((s) => s.id === "reddit")!;
    expect(await scanSource(deps(), "company-1", reddit, context)).toEqual({ source: "reddit", candidates: 0, inserted: 0, skipped: null });
    expect([...state.signals.values()].filter((s) => s.source === "reddit")).toHaveLength(2);
  });

  it("the next scan advances the progression by one step: Product Hunt once the reddit refs are known", async () => {
    await scanCompanySignals(deps(), directSteps, "company-1");
    const second = await scanCompanySignals(deps(), directSteps, "company-1");
    expect(second.sources.map((s) => [s.source, s.inserted])).toEqual([
      ["reddit", 0],
      ["producthunt", 1],
      ["google_trends", 0],
      ["competitor_sites", 0],
    ]);
    expect(rows()).toContain("producthunt:ph-solo-1:capped:0.9");
  });

  it("a source throwing NotConfiguredError is skipped with its reason and the scan goes on; a provider failure likewise", async () => {
    const stub: SignalSource = {
      id: "producthunt",
      scan: async () => {
        throw new NotConfiguredError("Product Hunt needs a developer token");
      },
    };
    const context = await scanContext(deps(), "company-1");
    expect(await scanSource(deps(), "company-1", stub, context)).toEqual({ source: "producthunt", candidates: 0, inserted: 0, skipped: "not configured: Product Hunt needs a developer token" });
    const broken: SignalSource = {
      id: "google_trends",
      scan: async () => {
        throw new Error("HTTP 503");
      },
    };
    expect((await scanSource(deps(), "company-1", broken, context)).skipped).toBe("provider error: HTTP 503");
    expect(state.signals.size).toBe(0);
  });

  it("a candidate that fails validation or claims another source is dropped, never the batch", async () => {
    const context = await scanContext(deps(), "company-1");
    const odd: SignalSource = {
      id: "reddit",
      scan: async () => [
        { source: "reddit", sourceRef: "ok-1", title: "Fine", excerpt: "", url: "https://www.reddit.com/r/x/1/", observedAt: DAY0, baseline: false },
        { source: "reddit", sourceRef: "bad-url", title: "Bad", excerpt: "", url: "javascript:alert(1)", observedAt: DAY0, baseline: false },
        { source: "sentry", sourceRef: "spoof", title: "Spoof", excerpt: "", url: null, observedAt: DAY0, baseline: false },
      ],
    };
    expect(await scanSource(deps(), "company-1", odd, context)).toEqual({ source: "reddit", candidates: 1, inserted: 1, skipped: null });
    expect(rows()).toEqual(["reddit:ok-1:new:0"]);
  });
});

describe("scoring", () => {
  it("drops a foreign id the model answers with and falls back to the heuristic for the batch", async () => {
    await dbModule.insertSignals(null, "company-1", [{ source: "reddit", sourceRef: "r-solo-1", title: "Anyone found a bookkeeping tool?", excerpt: "looking for a tool", url: "https://www.reddit.com/r/x/1/", observedAt: DAY0 }], { kind: "opportunity" });
    const foreign = { ...deps(), llm: MockLlm.fromRecord({ "signal:score": { scores: [{ id: "not-in-the-batch", score: 0.99, summary: "x", rationale: "y" }] } }) };
    const context = await scanContext(foreign, "company-1");
    const result = await scoreNewSignals(foreign, "company-1", context);
    expect(result.scored + result.belowThreshold).toBe(1);
    const row = [...state.signals.values()][0]!;
    expect(row.score).not.toBe(0.99);
    expect(["scored", "below_threshold"]).toContain(row.status);
    expect(row.scoredAt).not.toBeNull();
  });

  it("an LlmError (unscripted key) also falls back to the heuristic, so a scan never fails on the model", async () => {
    await dbModule.insertSignals(null, "company-1", [{ source: "reddit", sourceRef: "r-solo-1", title: "Anyone found a bookkeeping tool?", excerpt: "looking for a tool", url: "https://www.reddit.com/r/x/1/", observedAt: DAY0 }], { kind: "opportunity" });
    const silent = { ...deps(), llm: MockLlm.fromRecord({}) };
    const context = await scanContext(silent, "company-1");
    await expect(scoreNewSignals(silent, "company-1", context)).resolves.toBeTruthy();
    expect([...state.signals.values()][0]?.status).not.toBe("new");
  });
});

describe("detectDrops (metric_drop)", () => {
  it("100 → 60 in a week inserts one metric_drop row keyed by metric and day, scored 0.75 by rule; a second run inserts nothing", async () => {
    const latest = new Date(DAY0);
    const base = new Date(latest.getTime() - 8 * 86_400_000);
    state.metrics.push({ companyId: "company-1", metricKey: "site_visitors", value: 100, source: "analytics", measuredAt: base.toISOString() });
    state.metrics.push({ companyId: "company-1", metricKey: "site_visitors", value: 60, source: "analytics", measuredAt: latest.toISOString() });
    state.metrics.push({ companyId: "company-1", metricKey: "signups", value: 100, source: "analytics", measuredAt: base.toISOString() });
    state.metrics.push({ companyId: "company-1", metricKey: "signups", value: 80, source: "analytics", measuredAt: latest.toISOString() });
    expect(await detectDrops(deps(), "company-1", "2026-10-19")).toHaveLength(1);
    expect(rows()).toEqual(["metrics:metrics:site_visitors:2026-10-19:scored:0.75"]);
    expect([...state.signals.values()][0]?.title).toContain("100 → 60");
    expect(await detectDrops(deps(), "company-1", "2026-10-19")).toEqual([]);
  });
});
