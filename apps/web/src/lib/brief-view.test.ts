import { describe, expect, it } from "vitest";
import { composeBrief } from "@north/core/brief/compose";
import { BRIEF_MAX_WORDS, type BriefInput } from "@north/core/brief/types";
import { briefEmptyText, briefView, incidentView, markdownSection, scoreLabel, signalDetail, signalRows, signedDelta, wordsLabel } from "./brief-view";

const input: BriefInput = {
  day: "2026-10-20",
  companyName: "Acme",
  stopped: false,
  blocked: null,
  yesterday: {
    outcomes: [{ what: "Launch test", metricKey: "signups", delta: 1, costUsd: 4, channel: "meta_ads" }],
    actions: [
      { kind: "deploy.production", status: "executed", description: "Publish the landing page" },
      { kind: "email.send.first_contact", status: "executed", description: "Email p1" },
      { kind: "email.send.first_contact", status: "executed", description: "Email p2" },
    ],
  },
  metrics: [
    { key: "signups", value: 3, previous: 2, measuredAt: "2026-10-19T10:00:00.000Z" },
    { key: "site_visitors", value: 60, previous: null, measuredAt: "2026-10-19T10:00:00.000Z" },
  ],
  goal: { metricKey: "paying_customers", target: 10, current: 0, dueDate: "2026-12-31" },
  decisions: {
    pending: [{ id: "card-1", question: 'Look into "Agencies want outbound"? (reddit, score 0.85)', dueAt: "2026-10-21T07:00:00.000Z", tier: "K2" }],
    deferred: 1,
    answeredYesterday: 3,
  },
  today: [{ taskId: "task-1", title: "Campaign spec", role: "growth", status: "queued" }],
  spend: [{ category: "ads", spentTodayUsd: 4, dailyCapUsd: 10, spentTotalUsd: 8, totalCapUsd: 100 }],
  signals: [
    { id: "s-1", title: "Agencies want outbound", source: "reddit", score: 0.85, status: "card_opened" },
    { id: "s-2", title: "A launch on Product Hunt", source: "producthunt", score: 0.9, status: "capped" },
  ],
  escalations: [{ title: "Escalated: build failed twice" }],
};

describe("BRF-1 brief view", () => {
  const brief = composeBrief(input);
  const view = briefView(brief);

  it("takes the headline from the first markdown line and keeps the day, company and word count", () => {
    expect(view.headline).toBe("Morning brief: Acme, 2026-10-20");
    expect(view.day).toBe("2026-10-20");
    expect(view.companyName).toBe("Acme");
    expect(view.stopped).toBe(false);
    expect(view.blocked).toBeNull();
    expect(view.wordCount).toBe(brief.wordCount);
    expect(view.wordCount).toBeLessThanOrEqual(BRIEF_MAX_WORDS);
  });

  it("BIL-1/BIL-2: carries the blocked line with the brief's own words", () => {
    const ended = briefView(composeBrief({ ...input, blocked: { reason: "subscription_ended" } }));
    expect(ended.blocked).toEqual({ reason: "subscription_ended", text: "Agents paused: subscription ended. Subscribe to resume." });
    const credits = briefView(composeBrief({ ...input, blocked: { reason: "credits_exhausted" } }));
    expect(credits.blocked?.reason).toBe("credits_exhausted");
    expect(credits.headline).toBe("Morning brief: Acme, 2026-10-20");
  });

  it("renders the sections in the brief's fixed order with the ledger's numbers", () => {
    expect(view.yesterday).toEqual(["signups +1 ($4, meta_ads): Launch test", "deploy.production executed: Publish the landing page", "2 × email.send.first_contact executed"]);
    expect(view.metrics).toEqual([
      { key: "signups", value: 3, previous: 2, delta: 1 },
      { key: "site_visitors", value: 60, previous: null, delta: null },
    ]);
    expect(view.goal).toEqual(input.goal);
    expect(view.decisions.pending.map((c) => c.id)).toEqual(["card-1"]);
    expect(view.decisions.deferred).toBe(1);
    expect(view.decisions.answeredYesterday).toBe(3);
    expect(view.today.map((t) => t.taskId)).toEqual(["task-1"]);
    expect(view.spend[0]?.category).toBe("ads");
    expect(view.signals.map((s) => [s.id, s.statusWord])).toEqual([
      ["s-1", "card open"],
      ["s-2", "held for next week"],
    ]);
    expect(view.escalations).toEqual(["Escalated: build failed twice"]);
  });

  it("reads a markdown section by title and ignores unknown titles", () => {
    const markdown = "# Morning brief: Acme, 2026-10-20\n\n## Yesterday\n- a\n- b\n\n## Metrics\nNo metrics yet.\nNo goal set.";
    expect(markdownSection(markdown, "Yesterday")).toEqual(["a", "b"]);
    expect(markdownSection(markdown, "Metrics")).toEqual(["No metrics yet.", "No goal set."]);
    expect(markdownSection(markdown, "Signals")).toEqual([]);
  });

  it("counts words, names the first brief's hour in the owner's zone and signs deltas", () => {
    expect(wordsLabel(142)).toBe("142 words");
    expect(wordsLabel(1)).toBe("1 word");
    expect(briefEmptyText("Europe/Istanbul")).toBe("Your first brief arrives at 07:00 Europe/Istanbul");
    expect(briefEmptyText("Europe/Istanbul", 9)).toBe("Your first brief arrives at 09:00 Europe/Istanbul");
    expect(briefEmptyText("UTC", 24)).toBe("Your first brief arrives at 07:00 UTC");
    expect(signedDelta(3)).toBe("+3");
    expect(signedDelta(-2)).toBe("−2");
    expect(signedDelta(0)).toBe("0");
  });

  it("an empty brief still has every section, with nothing in it", () => {
    const empty = composeBrief({ ...input, yesterday: { outcomes: [], actions: [] }, metrics: [], goal: null, decisions: { pending: [], deferred: 0, answeredYesterday: 0 }, today: [], spend: [], signals: [], escalations: [] });
    const v = briefView(empty);
    expect(v.yesterday).toEqual(["Nothing."]);
    expect(v.metrics).toEqual([]);
    expect(v.decisions.pending).toEqual([]);
    expect(v.today).toEqual([]);
    expect(v.signals).toEqual([]);
    expect(v.escalations).toEqual([]);
  });
});

describe("PRO-1 signal views", () => {
  const signal = {
    id: "s-1",
    kind: "opportunity",
    source: "reddit",
    title: "Agencies want outbound",
    url: "https://www.reddit.com/r/agencies/comments/abc/",
    excerpt: "Looking for a tool <b>without a team</b>",
    score: 0.85,
    status: "card_opened",
    summary: "",
    rationale: "Matches the thesis keywords.",
    convertedCardId: "card-1",
    convertedTaskId: null,
  };

  it("rows carry the kind, source, status, score and the card link when converted", () => {
    expect(signalRows([signal, { ...signal, id: "s-2", convertedCardId: null }])).toEqual([
      { id: "s-1", kind: "opportunity", source: "reddit", status: "card_opened", title: "Agencies want outbound", score: 0.85, cardId: "card-1" },
      { id: "s-2", kind: "opportunity", source: "reddit", status: "card_opened", title: "Agencies want outbound", score: 0.85, cardId: null },
    ]);
  });

  it("the detail keeps the excerpt as text and only http(s) evidence links", () => {
    const detail = signalDetail(signal);
    expect(detail.excerpt).toBe("Looking for a tool <b>without a team</b>");
    expect(detail.evidence).toEqual(["https://www.reddit.com/r/agencies/comments/abc/"]);
    expect(detail.summary).toBe("Matches the thesis keywords.");
    expect(signalDetail({ ...signal, url: "javascript:alert(1)" }).evidence).toEqual([]);
    expect(signalDetail({ ...signal, url: "sandbox://repos/x/pull/1" }).evidence).toEqual([]);
    expect(signalDetail({ ...signal, url: null }).evidence).toEqual([]);
    expect(scoreLabel(0.85)).toBe("0.85");
    expect(scoreLabel(1)).toBe("1.00");
  });
});

describe("PRO-2 incident view", () => {
  const error = {
    id: "s-9",
    kind: "error",
    source: "sentry",
    title: "TypeError: Cannot read properties of undefined (reading 'map')",
    url: "https://sentry.io/organizations/north/issues/123/",
    excerpt: "app/page.tsx in HomePage",
    score: 1,
    status: "converted",
    convertedCardId: null,
    convertedTaskId: "task-9",
    payload: { shortId: "NORTH-1", level: "error", culprit: "app/page.tsx in HomePage", permalink: "https://sentry.io/organizations/north/issues/123/", extra: 1 },
  };

  it("reads the sanitised facts from the payload and the https permalink", () => {
    expect(incidentView(error)).toEqual({
      signalId: "s-9",
      title: "TypeError: Cannot read properties of undefined (reading 'map')",
      shortId: "NORTH-1",
      level: "error",
      culprit: "app/page.tsx in HomePage",
      permalink: "https://sentry.io/organizations/north/issues/123/",
      status: "converted",
    });
  });

  it("reads the facts the worker stores under payload.issue (the webhook's shape) before the root", () => {
    const nested = { ...error, url: null, payload: { issue: { shortId: "NORTH-7", level: "fatal", culprit: "lib/db.ts in query", permalink: "https://sentry.io/organizations/north/issues/7/" } } };
    expect(incidentView(nested)).toMatchObject({ shortId: "NORTH-7", level: "fatal", culprit: "lib/db.ts in query", permalink: "https://sentry.io/organizations/north/issues/7/" });
    expect(incidentView({ ...error, payload: { issue: "garbage" } })).toMatchObject({ shortId: null, level: null });
  });

  it("survives a missing or malformed payload and refuses a non-https permalink", () => {
    expect(incidentView({ ...error, payload: undefined, url: "http://sentry.example/x" })).toMatchObject({ shortId: null, level: null, culprit: "app/page.tsx in HomePage", permalink: null });
    expect(incidentView({ ...error, payload: "garbage", url: null, excerpt: "" })).toMatchObject({ culprit: null, permalink: null });
    expect(incidentView({ ...error, url: null, payload: { permalink: "javascript:alert(1)" } }).permalink).toBeNull();
  });
});
