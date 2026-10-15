import { describe, expect, it } from "vitest";
import { BRIEF_HOUR, isoWeek, localDay, localHour, weekStartLocal } from "../src/time";
import { BRIEF_MAX_WORDS, BriefSchema, type BriefInput } from "../src/brief/types";
import { briefMarkdown, briefWordCount, composeBrief } from "../src/brief/compose";

describe("BRF-1 / DEC-3 local day: the day is the owner's, computed from a timestamp", () => {
  it("at 2026-10-19T10:30Z Kiritimati (UTC+14) is already the 20th and Pago Pago (UTC-11) still the 18th", () => {
    const now = new Date("2026-10-19T10:30:00.000Z");
    expect(localDay("UTC", now)).toBe("2026-10-19");
    expect(localDay("Pacific/Kiritimati", now)).toBe("2026-10-20");
    expect(localDay("Pacific/Pago_Pago", now)).toBe("2026-10-18");
    expect(localDay("Europe/Istanbul", new Date("2026-10-19T04:00:00.000Z"))).toBe("2026-10-19");
  });

  it("around midnight: one minute either side of the local day roll lands on different days", () => {
    // Istanbul is UTC+3 all year: local midnight is 21:00Z.
    expect(localDay("Europe/Istanbul", new Date("2026-10-19T20:59:00.000Z"))).toBe("2026-10-19");
    expect(localDay("Europe/Istanbul", new Date("2026-10-19T21:00:00.000Z"))).toBe("2026-10-20");
    expect(localDay("Pacific/Kiritimati", new Date("2026-10-19T09:59:59.000Z"))).toBe("2026-10-19");
    expect(localDay("Pacific/Kiritimati", new Date("2026-10-19T10:00:00.000Z"))).toBe("2026-10-20");
    expect(localDay("Pacific/Pago_Pago", new Date("2026-10-19T10:59:59.000Z"))).toBe("2026-10-18");
    expect(localDay("Pacific/Pago_Pago", new Date("2026-10-19T11:00:00.000Z"))).toBe("2026-10-19");
  });

  it("localHour follows the zone in 0..23; the brief hour is 07:00 local", () => {
    expect(BRIEF_HOUR).toBe(7);
    const now = new Date("2026-10-19T04:00:00.000Z");
    expect(localHour("Europe/Istanbul", now)).toBe(7);
    expect(localHour("UTC", now)).toBe(4);
    expect(localHour("Pacific/Kiritimati", now)).toBe(18);
    expect(localHour("UTC", new Date("2026-10-19T00:10:00.000Z"))).toBe(0);
    expect(localHour("UTC", new Date("2026-10-19T23:10:00.000Z"))).toBe(23);
  });

  it("an unknown zone falls back to UTC instead of throwing (the database trigger does the same)", () => {
    const now = new Date("2026-10-19T10:30:00.000Z");
    expect(localDay("Mars/Olympus", now)).toBe("2026-10-19");
    expect(localHour("Mars/Olympus", now)).toBe(10);
  });

  it("isoWeek crosses the year boundary the ISO way", () => {
    expect(isoWeek("2026-10-19")).toBe("2026-W43");
    expect(isoWeek("2026-10-25")).toBe("2026-W43");
    expect(isoWeek("2026-10-26")).toBe("2026-W44");
    expect(isoWeek("2027-01-01")).toBe("2026-W53");
    expect(isoWeek("2027-01-03")).toBe("2026-W53");
    expect(isoWeek("2027-01-04")).toBe("2027-W01");
    expect(isoWeek("2024-12-30")).toBe("2025-W01");
    expect(isoWeek("2021-01-03")).toBe("2020-W53");
    expect(() => isoWeek("yesterday")).toThrow();
  });

  it("weekStartLocal is the Monday of the owner's local week", () => {
    expect(weekStartLocal("Europe/Istanbul", new Date("2026-10-19T04:00:00.000Z"))).toBe("2026-10-19");
    expect(weekStartLocal("Europe/Istanbul", new Date("2026-10-25T04:00:00.000Z"))).toBe("2026-10-19");
    expect(weekStartLocal("Europe/Istanbul", new Date("2026-10-25T21:30:00.000Z"))).toBe("2026-10-26");
    // Sunday 23:30 UTC is already Monday in Kiritimati.
    expect(weekStartLocal("Pacific/Kiritimati", new Date("2026-10-18T23:30:00.000Z"))).toBe("2026-10-19");
    expect(weekStartLocal("UTC", new Date("2026-10-18T23:30:00.000Z"))).toBe("2026-10-12");
  });
});

const pending = (i: number) => ({
  id: `card-${i}`,
  question: `Approve: start a ${"very ".repeat(30)}long campaign number ${i} with a long audience description and a long name?`.slice(0, 200),
  dueAt: "2026-10-20T09:00:00.000Z",
  tier: "K2" as const,
});

const worstCase = (): BriefInput => ({
  day: "2026-10-20",
  companyName: "Ledger Co",
  stopped: true,
  blocked: null,
  yesterday: {
    outcomes: Array.from({ length: 12 }, (_, i) => ({ what: `Ads window ${i} of the launch test campaign with a long description`, metricKey: "signups", delta: i, costUsd: 4.5, channel: "meta_ads" })),
    actions: Array.from({ length: 20 }, (_, i) => ({ kind: "email.send.first_contact", status: "executed", description: `First-contact email to lead number ${i} at a long company name` })),
  },
  metrics: ["paying_customers", "signups", "waitlist", "demo_calls", "mrr_usd", "revenue_usd", "site_visitors", "email_replies", "artifacts"].map((key) => ({ key, value: 1234.5, previous: 1200, measuredAt: "2026-10-19T10:00:00.000Z" })),
  goal: { metricKey: "paying_customers", target: 10, current: 2, dueDate: "2026-12-31" },
  decisions: { pending: [pending(1), pending(2), pending(3), pending(4), pending(5)], deferred: 2, answeredYesterday: 3 },
  today: Array.from({ length: 12 }, (_, i) => ({ taskId: `t-${i}`, title: `Task ${i} with a long title about something the agent will do`, role: "growth", status: "queued" as const })),
  spend: ["ads", "tools", "domain", "other"].map((category) => ({ category, spentTodayUsd: 4, dailyCapUsd: 10, spentTotalUsd: 44, totalCapUsd: 100 })),
  signals: Array.from({ length: 10 }, (_, i) => ({ id: `s-${i}`, title: `Looking for a tool that does the routine <b>${i}</b> for agencies`, source: "reddit", score: 0.85, status: i === 0 ? ("capped" as const) : ("deferred" as const) })),
  escalations: Array.from({ length: 6 }, (_, i) => ({ title: `Escalated: build_site attempt ${i} failed twice with a long reason` })),
});

const small = (): BriefInput => ({
  ...worstCase(),
  stopped: false,
  yesterday: { outcomes: [{ what: "Launch test", metricKey: "signups", delta: 1, costUsd: 4, channel: "meta_ads" }], actions: [{ kind: "deploy.production", status: "executed", description: "Deploy the landing page" }] },
  decisions: { pending: [pending(1)], deferred: 0, answeredYesterday: 3 },
  today: [{ taskId: "t-1", title: "Campaign spec", role: "growth", status: "queued" }],
  signals: [{ id: "s-1", title: "Looking for a tool <b>now</b>", source: "reddit", score: 0.85, status: "deferred" }],
  escalations: [],
});

describe("BRF-1 composeBrief: deterministic, under 200 words, every pending card kept", () => {
  it("a worst-case input stays within BRIEF_MAX_WORDS and keeps every pending card; the result validates", () => {
    expect(BRIEF_MAX_WORDS).toBe(200);
    const brief = composeBrief(worstCase());
    expect(brief.wordCount).toBeLessThanOrEqual(BRIEF_MAX_WORDS);
    expect(briefWordCount(brief)).toBe(brief.wordCount);
    expect(brief.decisions.pending).toHaveLength(5);
    expect(brief.decisions).toMatchObject({ deferred: 2, answeredYesterday: 3 });
    expect(BriefSchema.safeParse(brief).success).toBe(true);
    expect(composeBrief(worstCase())).toEqual(brief);
    expect(Object.isFrozen(brief)).toBe(true);
  });

  it("trims today, then signals, then yesterday's actions, then escalations; outcomes, metrics and spend stay", () => {
    const brief = composeBrief(worstCase());
    expect(brief.today.length).toBeLessThan(12);
    expect(brief.signals.length).toBeLessThan(10);
    expect(brief.yesterday.outcomes.length).toBeGreaterThan(0);
    expect(brief.metrics).toHaveLength(9);
    expect(brief.spend).toHaveLength(4);
    const kept = composeBrief(small());
    expect(kept.today).toHaveLength(1);
    expect(kept.signals).toHaveLength(1);
    expect(kept.yesterday.actions).toHaveLength(1);
    expect(kept.wordCount).toBeLessThanOrEqual(BRIEF_MAX_WORDS);
  });

  it("the signal held for the week keeps its place ahead of the deferred ones when the list is trimmed", () => {
    const brief = composeBrief(worstCase());
    expect(brief.signals[0]).toMatchObject({ id: "s-0", status: "capped" });
  });

  it("markdown renders the sections in the fixed order with signal titles as text", () => {
    const md = briefMarkdown(composeBrief(small()));
    const headings = md.split("\n").filter((line) => line.startsWith("## "));
    expect(headings).toEqual(["## Yesterday", "## Metrics", "## Decisions", "## Today", "## Spend", "## Signals", "## Escalations"]);
    expect(md.split("\n")[0]).toBe("# Morning brief: Ledger Co, 2026-10-20");
    expect(md).toContain("Looking for a tool <b>now</b>");
    expect(md).toContain("deferred");
    expect(md).toContain("Approve: start a");
    expect(md).toContain("$4 of $10 today");
    expect(md).toContain("signups 1234.5 (was 1200)");
    expect(md).toContain("paying_customers: 2 of 10 by 2026-12-31");
    expect(md).toContain("Nothing.");
    expect(md).not.toContain("stopped");
  });

  it("a stopped company's brief says so; capped signals read 'held for next week'", () => {
    const md = briefMarkdown(composeBrief(worstCase()));
    expect(md).toContain("All agents are stopped (kill switch)");
    expect(md).toContain("held for next week");
    expect(md).toContain("2 deferred");
    expect(md).toContain("3 answered yesterday");
  });

  it("briefWordCount counts words of the rendered text, not punctuation or list markers", () => {
    const brief = composeBrief({ ...small(), goal: null, decisions: { pending: [], deferred: 0, answeredYesterday: 0 }, yesterday: { outcomes: [], actions: [] }, metrics: [], today: [], spend: [], signals: [], escalations: [] });
    const md = briefMarkdown(brief);
    expect(md).toContain("No cards waiting.");
    expect(md).toContain("No goal set.");
    const words = md.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    expect(briefWordCount(brief)).toBe(words);
    expect(brief.wordCount).toBe(words);
  });

  it("renders a negative delta, a metric without a previous value, and a single action with its description", () => {
    const md = briefMarkdown(
      composeBrief({
        ...small(),
        yesterday: { outcomes: [{ what: "Refund window", metricKey: "mrr_usd", delta: -30, costUsd: 0, channel: null }], actions: [{ kind: "ads.pause", status: "executed", description: "Pause the launch test campaign for the cap" }] },
        metrics: [{ key: "mrr_usd", value: 70, previous: null, measuredAt: "2026-10-19T10:00:00.000Z" }],
      }),
    );
    expect(md).toContain("- mrr_usd -30: Refund window");
    expect(md).toContain("- mrr_usd 70\n");
    expect(md).toContain("- ads.pause executed: Pause the launch test campaign for…");
  });

  it("when nothing trimmable is left the brief keeps the pending cards even above the budget (the panel still shows them)", () => {
    const input = { ...small(), today: [], signals: [], escalations: [], yesterday: { outcomes: [], actions: [] }, decisions: { pending: Array.from({ length: 20 }, (_, i) => pending(i)), deferred: 0, answeredYesterday: 0 } };
    const brief = composeBrief(input);
    expect(brief.decisions.pending).toHaveLength(20);
    expect(brief.wordCount).toBeGreaterThan(BRIEF_MAX_WORDS);
    expect(BriefSchema.safeParse(brief).success).toBe(true);
  });

  it("BriefSchema bounds the lists and refuses a malformed day", () => {
    const ok = composeBrief(small());
    expect(BriefSchema.safeParse({ ...ok, day: "20/10/2026" }).success).toBe(false);
    expect(BriefSchema.safeParse({ ...ok, signals: [{ id: "s", title: "t", source: "nope", score: 0.5, status: "deferred" }] }).success).toBe(false);
    expect(BriefSchema.safeParse({ ...ok, wordCount: -1 }).success).toBe(false);
  });
});
