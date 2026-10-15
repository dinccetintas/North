import { createHash } from "node:crypto";
import { SignalCandidateSchema, sanitizeText, type SignalCandidate } from "@north/core";
import { COMPETITOR_HASH_LENGTH, competitorSourceRef, knownHashesFor } from "../competitor-ref";
import { ScanInputSchema, type ScanInput, type SignalSource, type SignalWarn } from "../types";
import type { FetchLike } from "./github";

/**
 * PRO-1: the competitor pages the competitor map recorded, re-read under the
 * verifier's host policy (M3 security review): the policy is injected as
 * `allowUrl`, redirects are never followed, at most 256 KB is read and only
 * `text/html` counts. The page is data: title and visible text are hashed;
 * a new hash for a known URL is a `changed` candidate, an unknown URL is a
 * `baseline` the worker stores `below_threshold` without scoring.
 */
export type AllowUrl = (url: string) => Promise<boolean>;

export interface CompetitorSitesOptions {
  readonly fetchImpl: FetchLike;
  readonly allowUrl: AllowUrl;
  readonly warn?: SignalWarn;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  readonly clock?: () => Date;
}

export const COMPETITOR_MAX_BYTES = 256 * 1024;
export const COMPETITOR_EXCERPT_CHARS = 400;
export const COMPETITOR_USER_AGENT = "north-signals/1.0";
const DEFAULT_TIMEOUT_MS = 10_000;
const TITLE_MAX = 190;

const ENTITIES: Readonly<Record<string, string>> = Object.freeze({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " " });

const decodeEntities = (text: string): string => text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (entity) => ENTITIES[entity] ?? entity);

/** The text a reader sees: scripts, styles, comments and tags removed, common entities decoded, whitespace collapsed. */
export function visibleText(html: string): string {
  const stripped = html
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ");
  return sanitizeText(decodeEntities(stripped));
}

/** The `<title>` text, or null when the page has none. */
export function pageTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  const title = match?.[1] ? sanitizeText(decodeEntities(match[1])) : "";
  return title.length > 0 ? title : null;
}

/** sha256 of the title and the visible text, so a changed headline or body changes the ref. */
export function contentHash(title: string, text: string): string {
  return createHash("sha256").update(`${title}\n${text}`).digest("hex");
}

/** Reads at most `maxBytes` of the body and cancels the rest; an agent-chosen page never fills memory. */
export async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks).subarray(0, maxBytes));
}

const withoutFragment = (url: string): string => {
  const parsed = new URL(url);
  parsed.hash = "";
  return parsed.href;
};

export class CompetitorSites implements SignalSource {
  readonly id = "competitor_sites" as const;
  private readonly warn: SignalWarn;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly clock: () => Date;

  constructor(private readonly options: CompetitorSitesOptions) {
    this.warn = options.warn ?? ((line) => console.warn(line));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? COMPETITOR_MAX_BYTES;
    this.clock = options.clock ?? (() => new Date());
  }

  /** The HTML of one page, or null (already warned) when the policy, the status, the type or the network said no. */
  private async fetchHtml(url: string): Promise<string | null> {
    if (!(await this.options.allowUrl(url))) {
      this.warn(`[signals] competitor page ${url} skipped: not allowed by the host policy`);
      return null;
    }
    let response: Response;
    try {
      response = await this.options.fetchImpl(url, { method: "GET", redirect: "manual", headers: { "user-agent": COMPETITOR_USER_AGENT, accept: "text/html" }, signal: AbortSignal.timeout(this.timeoutMs) });
    } catch (error) {
      this.warn(`[signals] competitor page ${url} failed: ${error instanceof Error ? error.message : "request failed"}`);
      return null;
    }
    if (response.status >= 300 && response.status < 400) {
      this.warn(`[signals] competitor page ${url} answered ${response.status}: redirect not followed`);
      return null;
    }
    if (response.status !== 200) {
      this.warn(`[signals] competitor page ${url} answered ${response.status}`);
      return null;
    }
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!type.startsWith("text/html")) {
      this.warn(`[signals] competitor page ${url} is ${type || "untyped"}, not text/html`);
      return null;
    }
    return readCapped(response, this.maxBytes);
  }

  private async observe(rawUrl: string, knownRefs: readonly string[]): Promise<SignalCandidate | null> {
    const url = withoutFragment(rawUrl);
    const html = await this.fetchHtml(url);
    if (html === null) return null;
    const title = pageTitle(html) ?? new URL(url).hostname;
    const text = visibleText(html);
    const hash = contentHash(title, text);
    const known = knownHashesFor(url, knownRefs);
    if (known.includes(hash.slice(0, COMPETITOR_HASH_LENGTH))) return null;
    const changed = known.length > 0;
    const candidate = SignalCandidateSchema.safeParse({
      source: "competitor_sites",
      sourceRef: competitorSourceRef(url, hash),
      title: `${changed ? "Changed" : "Baseline"}: ${title.slice(0, TITLE_MAX)}`,
      excerpt: text.slice(0, COMPETITOR_EXCERPT_CHARS),
      url,
      observedAt: this.clock().toISOString(),
      baseline: !changed,
    });
    return candidate.success ? Object.freeze(candidate.data) : null;
  }

  async scan(raw: ScanInput): Promise<readonly SignalCandidate[]> {
    const input = ScanInputSchema.parse(raw);
    const out: SignalCandidate[] = [];
    for (const url of input.competitorUrls) {
      const candidate = await this.observe(url, input.knownRefs);
      if (candidate) out.push(candidate);
      if (out.length >= input.limit) break;
    }
    return Object.freeze(out);
  }
}
