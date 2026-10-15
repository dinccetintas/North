import { describe, expect, it } from "vitest";
import { composeBrief } from "@north/core/brief/compose";
import { briefView } from "./brief-view";
import { CachedBriefSchema, pickBrief, slugFromPath, type CachedBrief } from "./offline-brief";

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

const entry = (slug: string, day: string, cachedAt: string): CachedBrief => ({ slug, brief: view(slug, day), cachedAt });

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
  });
});
