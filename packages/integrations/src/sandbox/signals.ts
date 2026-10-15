import { SignalCandidateSchema, type SignalCandidate } from "@north/core";
import { competitorSourceRef } from "../competitor-ref";
import { ScanInputSchema, type ParsedScanInput, type ScanInput, type SignalSource } from "../types";

/**
 * Deterministic signal sources for the sandbox (PRO-1). The sequence is keyed
 * on the first query and on which refs the company already knows, so one scan
 * per simulated day and two scans in a row on the wall clock see the same
 * progression: reddit (two posts) → Product Hunt → Google Trends → a competitor
 * page change → nothing. Refs are stable: a rescan is a duplicate the worker
 * ignores. The clock only sets `observedAt`.
 */
export type Clock = () => Date;

const keyword = (queries: readonly string[]): string | null => queries[0]?.trim().toLowerCase() || null;

const slug = (value: string): string =>
  value
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "signal";

const capitalise = (value: string): string => value.charAt(0).toUpperCase() + value.slice(1);

/** The refs the progression produces for these inputs, in order; the smoke harness and tests compare against it. */
export function sandboxSignalRefs(queries: readonly string[], competitorUrls: readonly string[]): readonly string[] {
  const q = keyword(queries);
  if (!q) return Object.freeze([]);
  const s = slug(q);
  const competitor = competitorUrls[0];
  return Object.freeze([`r-${s}-1`, `r-${s}-2`, `ph-${s}-1`, `gt-${s}`, ...(competitor ? [competitorSourceRef(competitor, SANDBOX_CHANGE_HASH)] : [])]);
}

/** The "content hash" of the simulated competitor change; constant so the ref is stable. */
export const SANDBOX_CHANGE_HASH = "sandbox-changed-0001";

const build = (candidate: SignalCandidate): SignalCandidate => Object.freeze(SignalCandidateSchema.parse(candidate));

abstract class SandboxSource implements SignalSource {
  abstract readonly id: SignalSource["id"];

  constructor(protected readonly clock: Clock) {}

  protected abstract candidates(input: ParsedScanInput, q: string, s: string): readonly SignalCandidate[];

  async scan(raw: ScanInput): Promise<readonly SignalCandidate[]> {
    const input = ScanInputSchema.parse(raw);
    const q = keyword(input.queries);
    if (!q) return Object.freeze([]);
    const known = new Set(input.knownRefs);
    return Object.freeze(this.candidates(input, q, slug(q)).filter((c) => !known.has(c.sourceRef)).slice(0, input.limit));
  }
}

/** Two posts while neither is known: one that asks for exactly what the thesis sells, one that is noise. */
export class SandboxReddit extends SandboxSource {
  readonly id = "reddit" as const;

  protected candidates(_input: ParsedScanInput, q: string, s: string): readonly SignalCandidate[] {
    const observedAt = this.clock().toISOString();
    return [
      build({
        source: "reddit",
        sourceRef: `r-${s}-1`,
        title: `Anyone found a ${q} tool that does not need a bookkeeper to check it?`,
        excerpt: `Solo consultant here. The ${q} close eats two evenings a month and I am looking for a tool that does the ${q} without me babysitting it. Tried <b>spreadsheets</b> and two apps; both still need someone to review the result before it goes out. Would pay for review-before-send.`,
        url: `https://www.reddit.com/r/freelance/comments/${s}1/anyone_found_a_${s}_tool/`,
        observedAt,
        baseline: false,
      }),
      build({
        source: "reddit",
        sourceRef: `r-${s}-2`,
        title: `Weekly thread: share your ${q} memes`,
        excerpt: `Meme Monday. Post your best ${q} jokes below. No vendor posts, no links, mods will remove them.`,
        url: `https://www.reddit.com/r/freelance/comments/${s}2/weekly_thread_${s}_memes/`,
        observedAt,
        baseline: false,
      }),
    ];
  }
}

/** One launch, once the reddit posts are known. */
export class SandboxProductHunt extends SandboxSource {
  readonly id = "producthunt" as const;

  protected candidates(input: ParsedScanInput, q: string, s: string): readonly SignalCandidate[] {
    if (!input.knownRefs.includes(`r-${s}-1`)) return [];
    return [
      build({
        source: "producthunt",
        sourceRef: `ph-${s}-1`,
        title: `${capitalise(q)} Autopilot: ${q} that runs itself and asks before anything is sent`,
        excerpt: `Launched today. ${capitalise(q)} Autopilot does the routine ${q} for solo operators and holds every outgoing step for a one-tap review. 312 upvotes in the first six hours; top comment asks for an accountant hand-off.`,
        url: `https://www.producthunt.com/posts/${s}-autopilot`,
        observedAt: this.clock().toISOString(),
        baseline: false,
      }),
    ];
  }
}

/** A flat interest line, once the launch is known; scores low. */
export class SandboxGoogleTrends extends SandboxSource {
  readonly id = "google_trends" as const;

  protected candidates(input: ParsedScanInput, q: string, s: string): readonly SignalCandidate[] {
    if (!input.knownRefs.includes(`ph-${s}-1`)) return [];
    return [
      build({
        source: "google_trends",
        sourceRef: `gt-${s}`,
        title: `Google Trends: "${q}" interest flat this week`,
        excerpt: `Interest over time for "${q}": flat at 42 of 100 over the past 90 days, no breakout queries, no rising related topics.`,
        url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(q)}`,
        observedAt: this.clock().toISOString(),
        baseline: false,
      }),
    ];
  }
}

/** The first competitor page "changed", once the trends line is known. */
export class SandboxCompetitorSites extends SandboxSource {
  readonly id = "competitor_sites" as const;

  protected candidates(input: ParsedScanInput, q: string, s: string): readonly SignalCandidate[] {
    const url = input.competitorUrls[0];
    if (!url || !input.knownRefs.includes(`gt-${s}`)) return [];
    const host = new URL(url).hostname;
    return [
      build({
        source: "competitor_sites",
        sourceRef: competitorSourceRef(url, SANDBOX_CHANGE_HASH),
        title: `${host}: page changed`,
        excerpt: `Title: Pricing, ${host}. A new "Team" plan at $149/month appeared and the "review before anything goes live" line moved above the fold, next to ${q}. (Sandbox: simulated change.)`,
        url,
        observedAt: this.clock().toISOString(),
        baseline: false,
      }),
    ];
  }
}

/** The four sandbox sources in scan order, sharing the bundle's clock. */
export function createSandboxSignals(clock: Clock = () => new Date()): readonly SignalSource[] {
  return Object.freeze([new SandboxReddit(clock), new SandboxProductHunt(clock), new SandboxGoogleTrends(clock), new SandboxCompetitorSites(clock)]);
}
