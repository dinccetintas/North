import { describe, expect, it } from "vitest";
import { composeBrief } from "@north/core/brief/compose";
import { briefView } from "./brief-view";
import { BRIEF_USER_KEY, briefCacheKey, briefsForUser, CachedBriefSchema, pickBrief, slugFromPath, type CachedBrief } from "./offline-brief";

const U1 = "7a1f0c4e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const U2 = "8b2f1d5f-3c4e-4f60-9bac-1d2e3f4a5b6c";

const view = (companyName: string, day: string) =>
  briefView(
    composeBrief({
      day,
      companyName,
      stopped: false,
      blocked: null,
      yesterday: { outcomes: [], actions: [] },
      metrics: [],
      goal: null,
      decisions: { pending: [], deferred: 0, answeredYesterday: 0 },
      today: [],
      spend: [],
      signals: [],
      escalations: [],
    }),
  );

const entry = (slug: string, day: string, cachedAt: string, userId = U1): CachedBrief => ({ userId, slug, brief: view(slug, day), cachedAt });

describe("PWA-1 offline brief", () => {
  it("reads the company slug of a company path only", () => {
    expect(slugFromPath("/c/acme")).toBe("acme");
    expect(slugFromPath("/c/acme/decisions/123")).toBe("acme");
    expect(slugFromPath("/companies")).toBeNull();
    expect(slugFromPath("/c/../etc")).toBeNull();
  });

  it("shows the company navigated to, else the newest brief", () => {
    const entries = [entry("acme", "2026-10-14", "2026-10-14T07:00:00.000Z"), entry("beta", "2026-10-15", "2026-10-15T07:00:00.000Z")];
    expect(pickBrief(entries, "acme")?.slug).toBe("acme");
    expect(pickBrief(entries, "gamma")?.slug).toBe("beta");
    expect(pickBrief(entries, null)?.slug).toBe("beta");
    expect(pickBrief([], null)).toBeNull();
  });

  it("validates what the cache holds: a rendered brief view, never arbitrary JSON", () => {
    const good = entry("acme", "2026-10-15", "2026-10-15T07:00:00.000Z");
    expect(CachedBriefSchema.safeParse(JSON.parse(JSON.stringify(good))).success).toBe(true);
    expect(CachedBriefSchema.safeParse({ ...good, slug: "../x" }).success).toBe(false);
    expect(CachedBriefSchema.safeParse({ ...good, brief: { headline: "<script>" } }).success).toBe(false);
    const { userId: _userId, ...withoutUser } = good;
    void _userId;
    expect(CachedBriefSchema.safeParse(withoutUser).success).toBe(false);
    expect(CachedBriefSchema.safeParse({ ...good, userId: "../x" }).success).toBe(false);
    expect(CachedBriefSchema.safeParse({ ...good, userId: U1.toUpperCase() }).success).toBe(false);
  });

  it("M6 review L14: keys a brief by user and company, and shows only the briefs of the user the worker last saw", () => {
    expect(briefCacheKey(U1, "acme")).toBe(`/brief/${U1}/acme`);
    expect(BRIEF_USER_KEY).toBe("/brief/last-user");
    const entries = [entry("acme", "2026-10-15", "2026-10-15T07:00:00.000Z", U1), entry("beta", "2026-10-16", "2026-10-16T07:00:00.000Z", U2)];
    expect(briefsForUser(entries, U1).map((e) => e.slug)).toEqual(["acme"]);
    expect(briefsForUser(entries, U2).map((e) => e.slug)).toEqual(["beta"]);
    expect(briefsForUser(entries, null)).toEqual([]);
    expect(pickBrief(briefsForUser(entries, U1), "beta")?.slug).toBe("acme");
  });
});
