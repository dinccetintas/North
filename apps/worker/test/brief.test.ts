import { beforeEach, describe, expect, it, vi } from "vitest";
import { BRIEF_MAX_WORDS, briefMarkdown, type Brief } from "@north/core";
import type { SandboxEvent } from "@north/integrations";
import { SimClock } from "../src/services/clock";
import { directSteps, emptyState, fakeDbModule, fakeDeps, seedCompany, seedTask, type FakeState } from "./fake-db";

/**
 * D5-2 (BRF-1): the tick picks only companies at local 07:00 without today's
 * brief; a stopped company still gets one that says so; the brief lists
 * pending cards, yesterday's ledger entries and a capped signal within 200
 * words; the row is one per company-day; push and email carry `kind: brief`.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { briefTick, generateBrief } = await import("../src/services/brief");
const { briefSubject } = await import("../src/services/notify");

/** 07:30 in Istanbul (UTC+3) on Monday 2026-10-19. */
const ISTANBUL_MORNING = "2026-10-19T04:30:00.000Z";
let events: SandboxEvent[];
let clock: SimClock;
const deps = () => fakeDeps(state, events, 200, "sandbox", "/tmp/north-test-sandbox", clock);

beforeEach(() => {
  Object.assign(state, emptyState());
  events = [];
  clock = new SimClock(ISTANBUL_MORNING);
  seedCompany(state, { id: "company-1", slug: "lumen", name: "Lumen Ledger", ownerId: "user-1", timezone: "Europe/Istanbul" });
  state.pushSubscriptions = [{ endpoint: "https://push.example.test/a", p256dh: "p", auth: "a" }];
});

describe("briefTick", () => {
  it("picks companies whose owner-local hour is 07:00 and skips those with today's brief or at another hour", async () => {
    seedCompany(state, { id: "company-2", slug: "ny", name: "New York Co", ownerId: "user-2", timezone: "America/New_York" });
    expect(await briefTick(deps())).toEqual([{ companyId: "company-1", day: "2026-10-19" }]);
    await generateBrief(deps(), directSteps, "company-1", "2026-10-19", "http://localhost:3100");
    expect(await briefTick(deps())).toEqual([]);
    clock.set("2026-10-19T11:30:00.000Z"); // 07:30 in New York
    expect(await briefTick(deps())).toEqual([{ companyId: "company-2", day: "2026-10-19" }]);
  });

  it("a stopped company still gets its brief, which says so", async () => {
    state.killSwitch.set("company-1", true);
    expect(await briefTick(deps())).toEqual([{ companyId: "company-1", day: "2026-10-19" }]);
    const result = await generateBrief(deps(), directSteps, "company-1", "2026-10-19", "http://localhost:3100");
    const brief = state.briefs[0]?.content as Brief;
    expect(result.created).toBe(true);
    expect(brief.stopped).toBe(true);
    expect(briefMarkdown(brief)).toContain("All agents are stopped (kill switch).");
  });
});

describe("generateBrief", () => {
  it("lists pending cards, yesterday's ledger entries and a capped signal, stays within 200 words, stores one row and notifies by push and email with kind brief", async () => {
    const task = seedTask(state, { title: "Launch test", status: "waiting_decision" });
    state.cards.set("card-1", { id: "card-1", companyId: "company-1", taskId: task.id, tier: "K2", question: "Approve: Start the $10/day launch test?", rationale: "r", options: [{ id: "approve", label: "Approve" }, { id: "decline", label: "Decline" }], defaultOptionId: "decline", dueAt: "2026-10-20T04:00:00.000Z", openedAt: ISTANBUL_MORNING, day: "2026-10-19", actionKind: "ads.start", answeredOptionId: null, answeredAt: null, answeredBy: null });
    state.ledger.push({ id: "l-1", companyId: "company-1", taskId: task.id, metricKey: "signups", before: 0, after: 3, costUsd: 12, channel: "meta_ads", note: "Launch test: $12 spent, 40 clicks, 3 conversions in the window", createdAt: new Date().toISOString() });
    state.ledger.push({ id: "l-2", companyId: "company-1", taskId: task.id, metricKey: "artifacts", before: 0, after: 1, costUsd: 0, channel: "research", note: "market_report: 1 artifact(s)", createdAt: new Date().toISOString() });
    const [signalId] = await dbModule.insertSignals(null, "company-1", [{ source: "producthunt", sourceRef: "ph-bookkeeping-1", title: "Bookkeeping Autopilot launched", excerpt: "x", url: "https://www.producthunt.com/posts/x", observedAt: new Date().toISOString() }], { kind: "opportunity" });
    await dbModule.updateSignal(null, "company-1", signalId!, { status: "capped", score: 0.9 });
    state.actions.push({ id: "a-1", companyId: "company-1", taskId: task.id, agentRole: "engineering", kind: "deploy.production", tier: "K2", description: "Publish lumen-site to production", status: "executed", externalRef: "http://127.0.0.1:3101/sandbox/sites/live-lumen-site/", decisionCardId: "card-0", autoRuleId: null, sandbox: true, payload: {}, supersedes: null, createdAt: new Date().toISOString() });

    const result = await generateBrief(deps(), directSteps, "company-1", "2026-10-19", "http://localhost:3100");
    expect(result).toMatchObject({ created: true, briefId: expect.any(String) });
    expect(result.wordCount).toBeLessThanOrEqual(BRIEF_MAX_WORDS);
    const brief = state.briefs[0]?.content as Brief;
    expect(brief.day).toBe("2026-10-19");
    expect(brief.companyName).toBe("Lumen Ledger");
    expect(brief.decisions.pending).toEqual([{ id: "card-1", question: "Approve: Start the $10/day launch test?", dueAt: "2026-10-20T04:00:00.000Z", tier: "K2" }]);
    expect(brief.yesterday.outcomes).toEqual(expect.arrayContaining([expect.objectContaining({ metricKey: "signups", delta: 3, costUsd: 12, channel: "meta_ads" }), expect.objectContaining({ metricKey: "artifacts", delta: 1, channel: null })]));
    expect(brief.yesterday.actions).toEqual([{ kind: "deploy.production", status: "executed", description: "Publish lumen-site to production" }]);
    expect(brief.signals).toEqual([expect.objectContaining({ id: signalId, source: "producthunt", score: 0.9, status: "capped" })]);
    expect(briefMarkdown(brief)).toContain("held for next week");
    expect(state.briefs).toHaveLength(1);
    expect(state.briefs[0]?.wordCount).toBe(brief.wordCount);

    const notifications = state.notifications as { channel: string; kind: string; status: string; payload: Record<string, unknown> }[];
    expect(notifications.map((n) => [n.channel, n.kind, n.status])).toEqual([
      ["push", "brief", "sandbox"],
      ["email", "brief", "sandbox"],
    ]);
    const mail = events.find((e) => e.provider === "mail");
    expect(mail?.payload).toMatchObject({ subject: briefSubject(brief) });
    expect(briefSubject(brief)).toBe("North: Lumen Ledger morning brief 2026-10-19");
    expect(String(mail?.payload.text ?? "")).not.toContain("<b>");

    // Idempotent: a second generation for the same day creates no row and sends nothing more.
    const again = await generateBrief(deps(), directSteps, "company-1", "2026-10-19", "http://localhost:3100");
    expect(again).toMatchObject({ created: false, briefId: result.briefId });
    expect(state.briefs).toHaveLength(1);
    expect(state.notifications).toHaveLength(2);
  });

  it("the window starts at the previous brief: the second day counts only what happened since", async () => {
    await generateBrief(deps(), directSteps, "company-1", "2026-10-19", "http://localhost:3100");
    await new Promise((r) => setTimeout(r, 5));
    state.cards.set("card-1", { id: "card-1", companyId: "company-1", taskId: null, tier: "K2", question: "q", rationale: "r", options: [], defaultOptionId: "decline", dueAt: "2026-10-20T04:00:00.000Z", openedAt: ISTANBUL_MORNING, day: "2026-10-19", actionKind: "ads.start", answeredOptionId: "approve", answeredAt: new Date().toISOString(), answeredBy: "user" });
    clock.set("2026-10-20T04:30:00.000Z");
    await generateBrief(deps(), directSteps, "company-1", "2026-10-20", "http://localhost:3100");
    const second = state.briefs.find((b) => b.day === "2026-10-20")?.content as Brief;
    expect(second.decisions.answeredYesterday).toBe(1);
    expect(second.decisions.pending).toEqual([]);
    expect(state.briefs.map((b) => b.day)).toEqual(["2026-10-19", "2026-10-20"]);
  });
});

describe("D6-5 brief hour and the blocked line (BRF-1, BIL-1, BIL-2)", () => {
  it("an owner with brief_hour 9 gets nothing at 07:00 and a brief at 09:00 local", async () => {
    state.briefHours.set("user-1", 9);
    clock.set("2026-10-19T04:10:00.000Z"); // 07:10 Istanbul
    expect(await briefTick(deps())).toEqual([]);
    clock.set("2026-10-19T06:10:00.000Z"); // 09:10 Istanbul
    expect(await briefTick(deps())).toEqual([{ companyId: "company-1", day: "2026-10-19" }]);
  });

  it("an ended owner's brief still comes and says paused: subscription ended, first after the headline", async () => {
    const ended = (await dbModule.getEntitlement({} as never, "user-1"))!;
    state.entitlements.set("user-1", { ...ended, status: "ended", endedAt: ISTANBUL_MORNING, retentionUntil: "2027-01-17T04:30:00.000Z" });
    state.killSwitch.set("company-1", true);
    state.pausedReasons.set("company-1", "subscription_ended");
    expect(await briefTick(deps())).toEqual([{ companyId: "company-1", day: "2026-10-19" }]);
    await generateBrief(deps(), directSteps, "company-1", "2026-10-19", "http://localhost:3100");
    const brief = state.briefs[0]?.content as Brief;
    expect(brief.blocked).toEqual({ reason: "subscription_ended" });
    expect(briefMarkdown(brief).split("\n")[1]).toMatch(/paused: subscription ended/);
  });

  it("zero credits → waiting for credits; a user's own kill switch shows the stopped line, not a billing one", async () => {
    state.credits.set("user-1", [{ kind: "grant_plan", amount: 300, ref: "trial:user-1", note: "" }, { kind: "adjust", amount: -300, ref: "adjust:drain", note: "" }]);
    await generateBrief(deps(), directSteps, "company-1", "2026-10-19", "http://localhost:3100");
    const brief = state.briefs[0]?.content as Brief;
    expect(brief.blocked).toEqual({ reason: "credits_exhausted" });
    expect(briefMarkdown(brief)).toContain("waiting for credits");
    state.briefs = [];
    state.killSwitch.set("company-1", true);
    state.pausedReasons.set("company-1", "user");
    await generateBrief(deps(), directSteps, "company-1", "2026-10-19", "http://localhost:3100");
    expect((state.briefs[0]?.content as Brief).blocked).toBeNull();
  });
});
