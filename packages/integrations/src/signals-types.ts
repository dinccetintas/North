import { z } from "zod";
import { isHttpUrl, type SignalCandidate } from "@north/core";

/**
 * PRO-1 signal sources (ADR 0012): the worker scans each source without a
 * model, validates every candidate with core's `SignalCandidateSchema` and
 * inserts it as a `signals` row; a signal becomes a card only through the gate.
 * `metrics` and `sentry` are not sources here: the worker produces those itself.
 */
export const SIGNAL_SOURCE_IDS = ["reddit", "producthunt", "google_trends", "competitor_sites"] as const;
export type SignalSourceId = (typeof SIGNAL_SOURCE_IDS)[number];

export const MAX_SCAN_QUERIES = 6;
export const MAX_SCAN_COMMUNITIES = 10;
export const MAX_SCAN_COMPETITOR_URLS = 10;
export const MAX_SCAN_KNOWN_REFS = 500;
export const MAX_SCAN_LIMIT = 25;

const httpUrl = z
  .string()
  .max(2048)
  .refine((value) => isHttpUrl(value), { message: "http(s) URL without credentials" });

/** What one scan receives: the thesis keywords, where the personas gather, the competitor pages and every reference already stored. */
export const ScanInputSchema = z.object({
  companyId: z.string().min(1),
  queries: z.array(z.string().trim().min(1).max(80)).max(MAX_SCAN_QUERIES).default([]),
  communities: z.array(z.string().trim().min(1).max(100)).max(MAX_SCAN_COMMUNITIES).default([]),
  competitorUrls: z.array(httpUrl).max(MAX_SCAN_COMPETITOR_URLS).default([]),
  /** `source_ref`s the company already has for this source; a source never returns them again. */
  knownRefs: z.array(z.string().min(1).max(200)).max(MAX_SCAN_KNOWN_REFS).default([]),
  /** Observations older than this are not candidates (the worker passes clock − 7 days). */
  since: z.iso.datetime({ offset: true }),
  limit: z.number().int().min(1).max(MAX_SCAN_LIMIT).default(MAX_SCAN_LIMIT),
});
export type ScanInput = z.input<typeof ScanInputSchema>;
export type ParsedScanInput = z.output<typeof ScanInputSchema>;

/**
 * One source the scan reads. `scan` returns candidates in the core shape;
 * it may throw `NotConfiguredError` (the worker logs it and moves on) and must
 * never throw on a provider refusal: that is "nothing this scan" with a warning.
 */
export interface SignalSource {
  readonly id: SignalSourceId;
  scan(input: ScanInput): Promise<readonly SignalCandidate[]>;
}

/** Where a source's warnings go (rate limits, skipped hosts); never thrown. */
export type SignalWarn = (line: string) => void;
