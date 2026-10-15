import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SandboxEvent } from "@north/integrations";
import { SimClock } from "../src/services/clock";
import { directSteps, emptyState, fakeDbModule, fakeDeps, seedCompany, type FakeState } from "./fake-db";

/**
 * D5-3 (PRO-1, PRO-3-CAP, ADR 0012): a 0.85 signal opens one K2 card with
 * the URL in its facts and `card_week` set; a 0.9 the same week is capped; a
 * spent quota defers it and the next scan opens it without a second row; a
 * metric_drop is not under the weekly cap; decline → declined; approve → a
 * signal_research task exists and the follow-up asks for its dispatch.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { convertSignals } = await import("../src/services/signal-cards");
const { completeAction, performPending } = await import("../src/services/actions");
const { followUp, settleDecision } = await import("../src/services/settle");

const TUESDAY = "2026-10-20";
const WEEK = "2026-W43";
let events: SandboxEvent[];
let clock: SimClock;
const deps = () => fakeDeps(state, events, 200, "sandbox", "/tmp/north-test-sandbox", clock);
const answer = (cardId: string, optionId: string) => Object.assign(state.cards.get(cardId)!, { answeredOptionId: optionId, answeredAt: new Date().toISOString(), answeredBy: "user" });

async function seedSignal(ref: string, score: number, kind = "opportunity", source = "reddit"): Promise<string> {
  const url = source === "metrics" ? null : `https://www.${source}.com/posts/${ref}/`;
  const [id] = await dbModule.insertSignals(null, "company-1", [{ source, sourceRef: ref, title: `Post ${ref}`, excerpt: "x", url, observedAt: clock.now().toISOString() }], { kind, score, status: "scored" });
  await dbModule.updateSignal(null, "company-1", id!, { score, summary: "s", rationale: "r" });
  return id!;
}

beforeEach(() => {
  Object.assign(state, emptyState());
  events = [];
  clock = new SimClock("2026-10-20T07:00:00.000Z");
  seedCompany(state, { id: "company-1", timezone: "Europe/Istanbul" });
});

describe("convertSignals", () => {
  it("0.85 opens one K2 signal.pursue card with the evidence URL in the facts; the row is card_opened with card_week and the card id", async () => {
    const id = await seedSignal("r-1", 0.85);
    const result = await convertSignals(deps(), "company-1", TUESDAY);
    expect(result.cardsOpened).toHaveLength(1);
    expect(result.signals).toEqual([{ signalId: id, status: "card_opened", cardId: result.cardsOpened[0] }]);
    const card = state.cards.get(result.cardsOpened[0]!)!;
    expect(card).toMatchObject({ tier: "K2", actionKind: "signal.pursue", taskId: null, defaultOptionId: "decline", question: 'Look into "Post r-1"? (reddit, score 0.85)', day: TUESDAY });
    expect(card.rationale).toContain("source: reddit");
    expect(card.rationale).toContain("score 0.85");
    expect(card.rationale).toContain("evidence: https://www.reddit.com/posts/r-1/");
    expect(state.signals.get(id)).toMatchObject({ status: "card_opened", cardWeek: WEEK, convertedCardId: card.id });
    expect(state.actions.map((a) => [a.kind, a.tier, a.status, a.taskId])).toEqual([["signal.pursue", "K2", "pending", null]]);
    expect(events).toEqual([]);
  });

  it("a 0.9 opportunity the same week is capped (and never opens a second card); a metric_drop is not under the weekly cap", async () => {
    await seedSignal("r-1", 0.85);
    const first = await convertSignals(deps(), "company-1", TUESDAY);
    expect(first.cardsOpened).toHaveLength(1);
    const ph = await seedSignal("ph-1", 0.9, "opportunity", "producthunt");
    const second = await convertSignals(deps(), "company-1", "2026-10-21");
    expect(second).toEqual({ cardsOpened: [], signals: [{ signalId: ph, status: "capped", cardId: null }] });
    expect(state.signals.get(ph)).toMatchObject({ status: "capped", cardWeek: null });
    const drop = await seedSignal("metrics:site_visitors:2026-10-24", 0.75, "metric_drop", "metrics");
    const third = await convertSignals(deps(), "company-1", "2026-10-24");
    expect(third.cardsOpened).toHaveLength(1);
    expect(state.signals.get(drop)).toMatchObject({ status: "card_opened", cardWeek: WEEK });
    expect(state.cards.size).toBe(2);
  });

  it("the database's cap index wins even when the code path is bypassed: SignalCapError → capped", async () => {
    const r1 = await seedSignal("r-1", 0.85);
    await dbModule.updateSignal(null, "company-1", r1, { status: "card_opened", cardWeek: WEEK, convertedCardId: "card-x" });
    const ph = await seedSignal("ph-1", 0.9, "opportunity", "producthunt");
    // Pretend the week was free so convertOne reserves it and the index refuses.
    dbModule.listSignals.mockImplementationOnce(async () => [{ ...state.signals.get(ph)! }]);
    dbModule.listSignals.mockImplementationOnce(async () => []);
    dbModule.listSignals.mockImplementationOnce(async () => []);
    const result = await convertSignals(deps(), "company-1", TUESDAY);
    expect(result).toEqual({ cardsOpened: [], signals: [{ signalId: ph, status: "capped", cardId: null }] });
    expect(state.cards.size).toBe(0);
  });

  it("at most one card per scan: the second eligible row waits for the next scan (DEC-3)", async () => {
    const drop1 = await seedSignal("metrics:signups:2026-10-20", 0.75, "metric_drop", "metrics");
    const drop2 = await seedSignal("metrics:site_visitors:2026-10-20", 0.75, "metric_drop", "metrics");
    const result = await convertSignals(deps(), "company-1", TUESDAY);
    expect(result.cardsOpened).toHaveLength(1);
    expect([state.signals.get(drop1)?.status, state.signals.get(drop2)?.status].sort()).toEqual(["card_opened", "scored"]);
  });

  it("a spent quota defers the signal; the next scan opens it without a second signal row, deferred rows first", async () => {
    const id = await seedSignal("r-1", 0.85);
    state.quotaExhausted = true;
    expect(await convertSignals(deps(), "company-1", TUESDAY)).toEqual({ cardsOpened: [], signals: [{ signalId: id, status: "deferred", cardId: null }] });
    expect(state.signals.get(id)).toMatchObject({ status: "deferred", cardWeek: null });
    expect(state.actions).toEqual([expect.objectContaining({ kind: "signal.pursue", status: "blocked", payload: expect.objectContaining({ quota_deferred: true }) })]);
    expect(state.cards.size).toBe(0);
    state.quotaExhausted = false;
    await seedSignal("r-9", 0.95);
    const next = await convertSignals(deps(), "company-1", "2026-10-21");
    expect(next.signals[0]).toMatchObject({ signalId: id, status: "card_opened" });
    expect(state.signals.size).toBe(2);
    expect(state.cards.size).toBe(1);
    expect(state.signals.get(id)).toMatchObject({ status: "card_opened", cardWeek: WEEK });
  });

  it("the kill switch blocks the gate and the signal is declined, nothing retried", async () => {
    const id = await seedSignal("r-1", 0.85);
    state.killSwitch.set("company-1", true);
    expect(await convertSignals(deps(), "company-1", TUESDAY)).toEqual({ cardsOpened: [], signals: [{ signalId: id, status: "declined", cardId: null }] });
    expect(state.cards.size).toBe(0);
  });
});

describe("settlement of a signal card", () => {
  it("decline marks the signal declined and creates no task", async () => {
    const id = await seedSignal("r-1", 0.85);
    const { cardsOpened } = await convertSignals(deps(), "company-1", TUESDAY);
    answer(cardsOpened[0]!, "decline");
    expect((await settleDecision(deps(), cardsOpened[0]!)).kind).toBe("declined");
    expect(state.signals.get(id)).toMatchObject({ status: "declined", convertedTaskId: null });
    expect([...state.tasks.values()]).toHaveLength(0);
  });

  it("approve creates the signal_research task (ref task:<id>), marks the signal approved with the task id, and the follow-up asks to dispatch it", async () => {
    const id = await seedSignal("r-1", 0.85);
    const { cardsOpened } = await convertSignals(deps(), "company-1", TUESDAY);
    answer(cardsOpened[0]!, "approve");
    const d = deps();
    const settlement = await settleDecision(d, cardsOpened[0]!);
    if (settlement.kind !== "perform") throw new Error(settlement.kind);
    const outcome = await performPending(d, settlement.actionIds[0]!);
    const done = await completeAction(d, { actionId: settlement.actionIds[0]!, tier: settlement.tier, outcome });
    expect(done).toMatchObject({ status: "executed", externalRef: expect.stringMatching(/^task:/) });
    const task = [...state.tasks.values()][0]!;
    expect(task).toMatchObject({ role: "research", taskType: "signal_research", status: "queued", metricKey: "artifacts", planId: null });
    expect(task.input).toContain('<data source="reddit">');
    expect(task.input).toContain("title: Post r-1");
    expect(done.externalRef).toBe(`task:${task.id}`);
    expect(state.signals.get(id)).toMatchObject({ status: "approved", convertedTaskId: task.id });
    expect(await followUp(d, directSteps, settlement.actionIds[0]!, 0)).toEqual({ kind: "dispatch", companyId: "company-1", taskId: task.id });
    expect(events).toEqual([]);
    // Performing the same approved row again (a retried step) reuses the task instead of creating a second one.
    expect(await performPending(d, settlement.actionIds[0]!)).toMatchObject({ ok: true, externalRef: `task:${task.id}` });
    expect([...state.tasks.values()]).toHaveLength(1);
  });
});
