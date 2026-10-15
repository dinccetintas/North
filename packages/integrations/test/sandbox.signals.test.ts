import { describe, expect, it } from "vitest";
import { SignalCandidateSchema, type SignalCandidate } from "@north/core";
import { competitorRefParts } from "../src/competitor-ref";
import { createSandboxIntegrations } from "../src/sandbox/index";
import { SandboxCompetitorSites, SandboxGoogleTrends, SandboxProductHunt, SandboxReddit, createSandboxSignals, sandboxSignalRefs } from "../src/sandbox/signals";
import type { SignalSource } from "../src/types";

const DAY0 = new Date("2026-10-19T07:00:00.000Z");
const DAY4 = new Date("2026-10-23T07:00:00.000Z");
const at = (date: Date) => () => date;

const input = {
  companyId: "c1",
  queries: ["bookkeeping", "consultants", "month close"],
  communities: ["r/freelance"],
  competitorUrls: ["https://incumbent-a.example/pricing", "https://incumbent-b.example/"],
  since: "2026-10-12T07:00:00.000Z",
};

/** Runs every source with the given known refs and returns the candidates by source id. */
async function scanAll(sources: readonly SignalSource[], knownRefs: readonly string[]): Promise<Record<string, readonly SignalCandidate[]>> {
  const out: Record<string, readonly SignalCandidate[]> = {};
  for (const source of sources) out[source.id] = await source.scan({ ...input, knownRefs: [...knownRefs] });
  return out;
}

describe("B5-2 sandbox signal sources (PRO-1): a deterministic progression keyed on the queries and the known refs", () => {
  it("day 0: reddit yields a score-worthy post and a noise post; the other sources wait", async () => {
    const sources = createSandboxSignals(at(DAY0));
    expect(sources.map((s) => s.id)).toEqual(["reddit", "producthunt", "google_trends", "competitor_sites"]);
    const first = await scanAll(sources, []);
    const again = await scanAll(sources, []);
    expect(again).toEqual(first);

    expect(first.reddit?.map((c) => c.sourceRef)).toEqual(["r-bookkeeping-1", "r-bookkeeping-2"]);
    expect(first.producthunt).toEqual([]);
    expect(first.google_trends).toEqual([]);
    expect(first.competitor_sites).toEqual([]);

    const worthy = first.reddit?.[0];
    expect(worthy?.excerpt).toContain("bookkeeping");
    expect(worthy?.excerpt.toLowerCase()).toContain("looking for a tool");
    expect(worthy?.excerpt).toContain("<b>");
    expect(worthy?.url).toMatch(/^https:\/\/www\.reddit\.com\/r\/[A-Za-z0-9_]+\/comments\//);
    expect(worthy?.observedAt).toBe(DAY0.toISOString());
    expect(first.reddit?.[1]?.url).toMatch(/^https:\/\/www\.reddit\.com\//);
    for (const candidate of Object.values(first).flat()) expect(SignalCandidateSchema.safeParse(candidate).success).toBe(true);
  });

  it("the progression: known reddit refs unlock Product Hunt, then Google Trends, then a competitor change, then nothing (day 4)", async () => {
    const known: string[] = [];
    const sources = createSandboxSignals(at(DAY0));
    const day0 = await scanAll(sources, known);
    known.push(...(day0.reddit ?? []).map((c) => c.sourceRef));

    const day1 = await scanAll(sources, known);
    expect(day1.reddit).toEqual([]);
    expect(day1.producthunt?.map((c) => c.sourceRef)).toEqual(["ph-bookkeeping-1"]);
    expect(day1.producthunt?.[0]?.url).toMatch(/^https:\/\/www\.producthunt\.com\/posts\//);
    expect(day1.google_trends).toEqual([]);
    known.push(...(day1.producthunt ?? []).map((c) => c.sourceRef));

    const day2 = await scanAll(sources, known);
    expect(day2.producthunt).toEqual([]);
    expect(day2.google_trends?.map((c) => c.sourceRef)).toEqual(["gt-bookkeeping"]);
    expect(day2.google_trends?.[0]?.excerpt).toMatch(/flat/i);
    expect(day2.competitor_sites).toEqual([]);
    known.push(...(day2.google_trends ?? []).map((c) => c.sourceRef));

    const day3 = await scanAll(sources, known);
    expect(day3.google_trends).toEqual([]);
    const changed = day3.competitor_sites?.[0];
    expect(day3.competitor_sites).toHaveLength(1);
    expect(changed?.url).toBe("https://incumbent-a.example/pricing");
    expect(changed?.baseline).toBe(false);
    expect(changed?.title).toMatch(/changed/i);
    expect(competitorRefParts(changed?.sourceRef ?? "")?.url).toBe("https://incumbent-a.example/pricing");
    known.push(...(day3.competitor_sites ?? []).map((c) => c.sourceRef));

    const day4 = await scanAll(createSandboxSignals(at(DAY4)), known);
    expect(Object.values(day4).flat()).toEqual([]);
    expect(known).toEqual(sandboxSignalRefs(input.queries, input.competitorUrls));
  });

  it("the refs are stable, so a rescan is a duplicate; a different clock only moves observedAt", async () => {
    const early = await new SandboxReddit(at(DAY0)).scan(input);
    const late = await new SandboxReddit(at(DAY4)).scan(input);
    expect(late.map((c) => c.sourceRef)).toEqual(early.map((c) => c.sourceRef));
    expect(late.map((c) => c.title)).toEqual(early.map((c) => c.title));
    expect(late[0]?.observedAt).toBe(DAY4.toISOString());
  });

  it("no queries means nothing to scan; no competitor URL means no competitor change; partial known refs still progress", async () => {
    const reddit = new SandboxReddit(at(DAY0));
    expect(await reddit.scan({ ...input, queries: [] })).toEqual([]);
    expect(await reddit.scan({ ...input, knownRefs: ["r-bookkeeping-1"] })).toHaveLength(1);
    expect(await new SandboxProductHunt(at(DAY0)).scan({ ...input, queries: [] })).toEqual([]);
    expect(await new SandboxGoogleTrends(at(DAY0)).scan({ ...input, queries: [], knownRefs: ["ph-bookkeeping-1"] })).toEqual([]);
    const competitor = new SandboxCompetitorSites(at(DAY0));
    expect(await competitor.scan({ ...input, competitorUrls: [], knownRefs: ["gt-bookkeeping"] })).toEqual([]);
    expect(await competitor.scan({ ...input, queries: [], knownRefs: ["gt-bookkeeping"] })).toEqual([]);
    await expect(reddit.scan({ ...input, since: "not a date" })).rejects.toThrow();
  });

  it("the sandbox bundle exposes the four sources on `signals` and shares the clock", async () => {
    const integrations = createSandboxIntegrations(undefined, { root: "/tmp/north-unused", clock: at(DAY4) });
    expect(integrations.signals.map((s) => s.id)).toEqual(["reddit", "producthunt", "google_trends", "competitor_sites"]);
    const [reddit] = integrations.signals;
    const candidates = await reddit!.scan(input);
    expect(candidates[0]?.observedAt).toBe(DAY4.toISOString());
  });
});
