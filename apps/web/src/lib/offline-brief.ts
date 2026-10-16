import { z } from "zod";
import type { BriefView } from "./brief-view";

/**
 * PWA-1: the latest brief per company lives in Cache Storage
 * (`north-brief-v1`, key `/brief/<slug>`), written by `public/sw.js` when a
 * page posts it and read here by `/offline`. Cache contents are re-validated
 * like any other boundary; a malformed entry is no brief. Never a card.
 */
export const BRIEF_CACHE = "north-brief-v1";
export const briefCacheKey = (slug: string): string => `/brief/${slug}`;

const Text = (max: number) => z.string().max(max);

const BriefViewSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  companyName: Text(200),
  stopped: z.boolean(),
  blocked: z.object({ reason: z.enum(["subscription_ended", "credits_exhausted"]), text: Text(200) }).nullable(),
  headline: Text(300),
  wordCount: z.number().int().nonnegative(),
  yesterday: z.array(Text(500)).max(100),
  metrics: z.array(z.object({ key: Text(40), value: z.number(), previous: z.number().nullable(), delta: z.number().nullable() })).max(20),
  goal: z.object({ metricKey: Text(40), target: z.number(), current: z.number(), dueDate: Text(10) }).nullable(),
  decisions: z.object({
    pending: z.array(z.object({ id: Text(64), question: Text(200), dueAt: Text(40), tier: z.enum(["K0", "K1", "K2", "K3"]) })).max(20),
    deferred: z.number().int().nonnegative(),
    answeredYesterday: z.number().int().nonnegative(),
  }),
  today: z.array(z.object({ taskId: Text(64), title: Text(200), role: Text(40), status: Text(40) })).max(20),
  spend: z.array(z.object({ category: Text(40), spentTodayUsd: z.number(), dailyCapUsd: z.number(), spentTotalUsd: z.number(), totalCapUsd: z.number() })).max(10),
  /** Absent in briefs cached before the usage line existed. */
  usage: Text(200).nullable().default(null),
  signals: z.array(z.object({ id: Text(64), title: Text(200), source: Text(40), score: z.number(), status: Text(40), statusWord: Text(60) })).max(20),
  escalations: z.array(Text(200)).max(20),
});

export const CachedBriefSchema = z.object({
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  brief: BriefViewSchema,
  cachedAt: z.iso.datetime({ offset: true }),
});
export type CachedBrief = { readonly slug: string; readonly brief: BriefView; readonly cachedAt: string };

const COMPANY_PATH = /^\/c\/([a-z0-9][a-z0-9-]{0,99})(?:\/|$)/;

/** The company slug of a `/c/<slug>/…` path; null for any other path. */
export function slugFromPath(pathname: string): string | null {
  return COMPANY_PATH.exec(pathname)?.[1] ?? null;
}

/** The entry to show: the company the user navigated to when it is cached, else the newest by day and cache time. */
export function pickBrief(entries: readonly CachedBrief[], slug: string | null): CachedBrief | null {
  const own = slug ? entries.find((e) => e.slug === slug) : undefined;
  if (own) return own;
  const newest = [...entries].sort((a, b) => b.brief.day.localeCompare(a.brief.day) || b.cachedAt.localeCompare(a.cachedAt));
  return newest[0] ?? null;
}

async function readEntry(cache: Cache, request: Request): Promise<CachedBrief | null> {
  try {
    const response = await cache.match(request);
    const parsed = CachedBriefSchema.safeParse(response ? await response.json() : null);
    return parsed.success ? (parsed.data as CachedBrief) : null;
  } catch {
    return null;
  }
}

/** Every cached brief (browser only); empty when Cache Storage is unavailable. */
export async function readCachedBriefs(): Promise<readonly CachedBrief[]> {
  if (typeof caches === "undefined") return [];
  const cache = await caches.open(BRIEF_CACHE);
  const entries = await Promise.all((await cache.keys()).map((request) => readEntry(cache, request)));
  return entries.filter((e): e is CachedBrief => e !== null);
}

/** Sign-out clears the cached briefs so the next person on this device reads nothing. */
export async function clearCachedBriefs(): Promise<void> {
  if (typeof caches !== "undefined") await caches.delete(BRIEF_CACHE);
}
