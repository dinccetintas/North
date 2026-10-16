import { z } from "zod";
import type { BriefView } from "./brief-view";

/**
 * PWA-1: the latest brief per company of one user lives in Cache Storage
 * (`north-brief-v1`, key `/brief/<userId>/<slug>`), written by `public/sw.js`
 * when a page posts it and read here by `/offline`, which shows only the user
 * the worker last saw (`/brief/last-user`). Cache contents are re-validated
 * like any other boundary; a malformed entry is no brief. Never a card.
 * Sign-out and the sign-in page clear it (M6 review L14).
 */
export const BRIEF_CACHE = "north-brief-v1";
/** The user whose briefs the cache holds (the service worker empties the cache when another user's brief arrives). */
export const BRIEF_USER_KEY = "/brief/last-user";
export const briefCacheKey = (userId: string, slug: string): string => `/brief/${userId}/${slug}`;

/** Lower-case UUIDs, as Supabase Auth issues them and as `public/sw.js` accepts them. */
const UserIdSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
const UserMarkerSchema = z.object({ userId: UserIdSchema });

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
  userId: UserIdSchema,
  slug: z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/),
  brief: BriefViewSchema,
  cachedAt: z.iso.datetime({ offset: true }),
});
export type CachedBrief = { readonly userId: string; readonly slug: string; readonly brief: BriefView; readonly cachedAt: string };

const COMPANY_PATH = /^\/c\/([a-z0-9][a-z0-9-]{0,99})(?:\/|$)/;

/** The company slug of a `/c/<slug>/…` path; null for any other path. */
export function slugFromPath(pathname: string): string | null {
  return COMPANY_PATH.exec(pathname)?.[1] ?? null;
}

/** Only the briefs of `userId` (the user the worker last saw); none without one. */
export function briefsForUser(entries: readonly CachedBrief[], userId: string | null): readonly CachedBrief[] {
  return userId === null ? [] : entries.filter((e) => e.userId === userId);
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

async function readUser(cache: Cache): Promise<string | null> {
  try {
    const marker = await cache.match(BRIEF_USER_KEY);
    const parsed = UserMarkerSchema.safeParse(marker ? await marker.json() : null);
    return parsed.success ? parsed.data.userId : null;
  } catch {
    return null;
  }
}

/** The cached briefs of the user the worker last saw (browser only); empty when Cache Storage is unavailable or no user is named. */
export async function readCachedBriefs(): Promise<readonly CachedBrief[]> {
  if (typeof caches === "undefined") return [];
  const cache = await caches.open(BRIEF_CACHE);
  const userId = await readUser(cache);
  if (userId === null) return [];
  const requests = (await cache.keys()).filter((request) => new URL(request.url).pathname !== BRIEF_USER_KEY);
  const entries = await Promise.all(requests.map((request) => readEntry(cache, request)));
  return briefsForUser(
    entries.filter((e): e is CachedBrief => e !== null),
    userId,
  );
}

/**
 * Sign-out and the sign-in page clear the cached briefs so the next person on
 * this device reads nothing: the service worker is told (it finishes the
 * delete even when this page is already navigating away), and the page
 * deletes the cache itself as well.
 */
export async function clearCachedBriefs(): Promise<void> {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) navigator.serviceWorker.controller?.postMessage({ type: "sign-out" });
  if (typeof caches !== "undefined") await caches.delete(BRIEF_CACHE);
}
