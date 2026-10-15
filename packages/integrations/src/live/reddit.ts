import { z } from "zod";
import { SignalCandidateSchema, sanitizeText, type SignalCandidate } from "@north/core";
import { ScanInputSchema, type ScanInput, type SignalSource, type SignalWarn } from "../types";
import type { FetchLike } from "./github";

/**
 * PRO-1: Reddit's public search, keyless. One `search.json` request per query
 * (newest first, this week), a fixed User-Agent and a 10 s timeout. A refusal
 * (403/429, common from datacenter addresses) or any provider error is
 * "nothing this scan" with a warning, never a crash. Every post is data: the
 * title and text are sanitised and bounded before they become a candidate.
 */
export const REDDIT_SEARCH_URL = "https://www.reddit.com/search.json";
export const REDDIT_USER_AGENT = "north-signals/1.0";
export const REDDIT_PAGE_SIZE = 25;
const REDDIT_ORIGIN = "https://www.reddit.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const TITLE_MAX = 200;
const EXCERPT_MAX = 600;

const RedditPostSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().default(""),
  selftext: z.string().default(""),
  permalink: z.string().min(1).max(1024),
  created_utc: z.number(),
});

const RedditListingSchema = z.object({
  data: z.object({ children: z.array(z.object({ data: z.unknown() })) }),
});

export interface RedditOptions {
  readonly fetchImpl?: FetchLike;
  readonly warn?: SignalWarn;
  readonly timeoutMs?: number;
}

/** One listing entry → a candidate, or null when the post has no usable id, title or permalink or is older than `since`. */
export function redditCandidate(data: unknown, since: string): SignalCandidate | null {
  const post = RedditPostSchema.safeParse(data);
  if (!post.success || !post.data.permalink.startsWith("/")) return null;
  const title = sanitizeText(post.data.title).slice(0, TITLE_MAX);
  if (title.length === 0) return null;
  const observedAt = new Date(post.data.created_utc * 1000);
  if (Number.isNaN(observedAt.getTime()) || observedAt.toISOString() < since) return null;
  const text = sanitizeText(post.data.selftext);
  const candidate = SignalCandidateSchema.safeParse({
    source: "reddit",
    sourceRef: `t3_${post.data.id}`,
    title,
    excerpt: (text.length > 0 ? text : title).slice(0, EXCERPT_MAX),
    url: `${REDDIT_ORIGIN}${post.data.permalink}`,
    observedAt: observedAt.toISOString(),
    baseline: false,
  });
  return candidate.success ? Object.freeze(candidate.data) : null;
}

export class RedditSignals implements SignalSource {
  readonly id = "reddit" as const;
  private readonly fetchImpl: FetchLike;
  private readonly warn: SignalWarn;
  private readonly timeoutMs: number;

  constructor(options: RedditOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.warn = options.warn ?? ((line) => console.warn(line));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** The listing entries for one query, or null when Reddit refused or answered with something else (already warned). */
  private async search(query: string): Promise<readonly unknown[] | null> {
    const url = `${REDDIT_SEARCH_URL}?q=${encodeURIComponent(query)}&sort=new&t=week&limit=${REDDIT_PAGE_SIZE}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: "GET", headers: { "user-agent": REDDIT_USER_AGENT, accept: "application/json" }, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      this.warn(`[signals] reddit search "${query}" failed: ${error instanceof Error ? error.message : "request failed"}; nothing this scan`);
      return null;
    }
    if (response.status !== 200) {
      this.warn(`[signals] reddit refused search "${query}" with ${response.status}; nothing this scan`);
      return null;
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      this.warn(`[signals] reddit answered search "${query}" with non-JSON; nothing this scan`);
      return null;
    }
    const listing = RedditListingSchema.safeParse(json);
    if (!listing.success) {
      this.warn(`[signals] reddit answered search "${query}" with an unexpected shape; nothing this scan`);
      return null;
    }
    return listing.data.data.children.map((child) => child.data);
  }

  async scan(raw: ScanInput): Promise<readonly SignalCandidate[]> {
    const input = ScanInputSchema.parse(raw);
    const seen = new Set(input.knownRefs);
    const out: SignalCandidate[] = [];
    for (const query of input.queries) {
      const posts = await this.search(query);
      if (posts === null) return Object.freeze([]);
      for (const post of posts) {
        const candidate = redditCandidate(post, input.since);
        if (!candidate || seen.has(candidate.sourceRef)) continue;
        seen.add(candidate.sourceRef);
        out.push(candidate);
        if (out.length >= input.limit) return Object.freeze(out);
      }
    }
    return Object.freeze(out);
  }
}
