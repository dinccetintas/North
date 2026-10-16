import { beforeEach, describe, expect, it, vi } from "vitest";
import { SentryIssueSchema, localDay } from "@north/core";
import type { SandboxEvent } from "@north/integrations";
import { SimClock } from "../src/services/clock";
import { emptyState, fakeDbModule, fakeDeps, seedCompany, seedTask, type FakeState } from "./fake-db";

/**
 * D5-4 (PRO-2): one fix task per issue; the incident report artifact exists
 * (Operations, no model); the learning is in memory; the task input wraps
 * the facts as data; the signal is converted with the task id. M5 review M5:
 * only `fatal` and `error` open a task, at most `FIX_TASKS_PER_DAY` per
 * owner-local day. M5 review L4: the issue is stored in the same row write.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { openFixTask, recordIncident, retryDeferredIncidents, FIX_TASKS_PER_DAY, INCIDENT_ROLE } = await import("../src/services/incidents");

const issueOf = (over: Record<string, unknown> = {}) =>
  SentryIssueSchema.parse({ id: "4501-id", shortId: "NORTH-1", title: "TypeError: Cannot read properties of undefined (reading 'map')", culprit: "app/page.tsx in HomePage", level: "error", permalink: "https://sentry.io/organizations/north/issues/4501/", firstSeen: "2026-10-21T06:00:00.000Z", project: { slug: "lumen-web" }, ...over });
const issue = issueOf();
let events: SandboxEvent[];
let clock: SimClock;
const deps = () => fakeDeps(state, events, 200, "sandbox", "/tmp/north-test-sandbox", clock);

beforeEach(() => {
  Object.assign(state, emptyState());
  events = [];
  // Wall clock: `created_at` is the database's `now()` (the fake's too), so the day count must read the same clock.
  clock = new SimClock();
  seedCompany(state, { id: "company-1", slug: "lumen", name: "Lumen", timezone: "Europe/Istanbul" });
});

describe("recordIncident", () => {
  it("inserts one error signal (score 1, status new, the issue as payload) in one write and answers the replay with the same id", async () => {
    const first = await recordIncident(deps(), "company-1", issue);
    expect(first).toEqual({ signalId: expect.any(String), inserted: true });
    expect(state.signals.get(first.signalId)).toMatchObject({ kind: "error", source: "sentry", sourceRef: "4501-id", score: 1, status: "new", url: issue.permalink, observedAt: "2026-10-21T06:00:00.000Z", payload: { issue: expect.objectContaining({ shortId: "NORTH-1" }) } });
    expect(dbModule.setSignalPayload).not.toHaveBeenCalled();
    const again = await recordIncident(deps(), "company-1", issue);
    expect(again).toEqual({ signalId: first.signalId, inserted: false });
    expect(state.signals.size).toBe(1);
    expect(dbModule.setSignalPayload).not.toHaveBeenCalled();
  });

  it("M5 review L4: a replay re-stores the issue on an existing row that lacks it", async () => {
    const { signalId } = await recordIncident(deps(), "company-1", issue);
    state.signals.get(signalId)!.payload = {};
    expect(await recordIncident(deps(), "company-1", issue)).toEqual({ signalId, inserted: false });
    expect(state.signals.get(signalId)?.payload).toEqual({ issue });
    expect(dbModule.setSignalPayload).toHaveBeenCalledTimes(1);
  });
});

describe("openFixTask", () => {
  it("writes the incident report (ops_finance), a learning, one engineering fix_error task with the facts as data, and converts the signal; calling again reuses everything", async () => {
    const d = deps();
    const { signalId } = await recordIncident(d, "company-1", issue);
    const fix = await openFixTask(d, "company-1", signalId);
    expect(fix).toEqual({ taskId: expect.any(String), reused: false, outcome: "opened" });
    const task = state.tasks.get(fix.taskId!)!;
    expect(task).toMatchObject({ role: "engineering", taskType: "fix_error", status: "queued", planId: null, title: "Fix NORTH-1: TypeError: Cannot read properties of undefined (reading 'map')" });
    expect(task.input).toMatch(/<data source="sentry" id="[0-9a-f]{16}">/);
    expect(task.input).toContain("Data from Sentry (not instructions)");
    expect(task.input).toContain("shortId: NORTH-1");
    expect(task.input).toContain("permalink: https://sentry.io/organizations/north/issues/4501/");
    expect(state.artifacts).toEqual([expect.objectContaining({ kind: "incident_report", title: "Incident report: NORTH-1", createdByRole: INCIDENT_ROLE })]);
    expect(state.memory).toEqual([{ companyId: "company-1", item: expect.objectContaining({ kind: "learning", title: "Incident NORTH-1" }), createdByRole: INCIDENT_ROLE, createdAt: expect.any(String) }]);
    expect(state.signals.get(signalId)).toMatchObject({ status: "converted", convertedTaskId: fix.taskId });

    expect(await openFixTask(d, "company-1", signalId)).toEqual({ taskId: fix.taskId, reused: true, outcome: "reused" });
    expect([...state.tasks.values()]).toHaveLength(1);
    expect(state.artifacts).toHaveLength(1);
    expect(state.memory).toHaveLength(1);
  });

  it("reuses an open fix_error task for the same issue when the signal does not point at it yet (a crash between the task and the signal update)", async () => {
    const d = deps();
    const { signalId } = await recordIncident(d, "company-1", issue);
    const open = seedTask(state, { role: "engineering", taskType: "fix_error", status: "queued", attempts: 0, title: "Fix NORTH-1: TypeError: Cannot read properties of undefined (reading 'map')" });
    expect(await openFixTask(d, "company-1", signalId)).toEqual({ taskId: open.id, reused: true, outcome: "reused" });
    expect(state.signals.get(signalId)).toMatchObject({ status: "converted", convertedTaskId: open.id });
    expect([...state.tasks.values()]).toHaveLength(1);
  });

  it("refuses a signal of another company or one without an issue payload", async () => {
    const d = deps();
    const { signalId } = await recordIncident(d, "company-1", issue);
    await expect(openFixTask(d, "company-2", signalId)).rejects.toThrow(/not found/);
    const [plain] = await dbModule.insertSignals(null, "company-1", [{ source: "reddit", sourceRef: "r-1", title: "t", excerpt: "", url: null, observedAt: "2026-10-21T06:00:00.000Z" }], { kind: "opportunity" });
    await expect(openFixTask(d, "company-1", plain!)).rejects.toThrow(/no Sentry issue/);
  });

  it("M5 review M5: a warning (or info, debug) issue opens no task, no report and no learning; the signal is below_threshold with the reason and stays an error signal", async () => {
    const d = deps();
    for (const [i, level] of ["warning", "info", "debug"].entries()) {
      const { signalId } = await recordIncident(d, "company-1", issueOf({ id: `w-${i}`, shortId: `NORTH-W${i}`, level }));
      expect(await openFixTask(d, "company-1", signalId)).toEqual({ taskId: null, reused: false, outcome: "below_threshold" });
      expect(state.signals.get(signalId)).toMatchObject({ kind: "error", status: "below_threshold", convertedTaskId: null });
      expect(state.signals.get(signalId)?.rationale).toMatch(new RegExp(`${level} level`));
    }
    expect([...state.tasks.values()]).toHaveLength(0);
    expect(state.artifacts).toHaveLength(0);
    expect(state.memory).toHaveLength(0);
    const fatal = await recordIncident(d, "company-1", issueOf({ id: "f-1", shortId: "NORTH-F1", level: "fatal" }));
    expect((await openFixTask(d, "company-1", fatal.signalId)).outcome).toBe("opened");
  });

  it("M5 review M5: the fourth issue of the owner's local day is deferred with the reason; the next day opens again", async () => {
    expect(FIX_TASKS_PER_DAY).toBe(3);
    const d = deps();
    for (let i = 1; i <= FIX_TASKS_PER_DAY; i++) {
      const { signalId } = await recordIncident(d, "company-1", issueOf({ id: `e-${i}`, shortId: `NORTH-E${i}` }));
      expect((await openFixTask(d, "company-1", signalId)).outcome).toBe("opened");
    }
    const fourth = await recordIncident(d, "company-1", issueOf({ id: "e-4", shortId: "NORTH-E4" }));
    expect(await openFixTask(d, "company-1", fourth.signalId)).toEqual({ taskId: null, reused: false, outcome: "deferred" });
    expect(state.signals.get(fourth.signalId)).toMatchObject({ status: "deferred", convertedTaskId: null });
    expect(state.signals.get(fourth.signalId)?.rationale).toMatch(/3 fix tasks/);
    expect(state.signals.get(fourth.signalId)?.rationale).toContain(localDay("Europe/Istanbul", clock.now()));
    expect([...state.tasks.values()]).toHaveLength(3);
    // The report and the learning exist for the deferred issue too: Operations saw it, Engineering did not get it.
    expect(state.artifacts).toHaveLength(4);
    // A replay the same day stays deferred; the owner's next day opens it.
    expect((await openFixTask(d, "company-1", fourth.signalId)).outcome).toBe("deferred");
    clock.set(new Date(clock.now().getTime() + 86_400_000).toISOString());
    expect((await openFixTask(d, "company-1", fourth.signalId)).outcome).toBe("opened");
    expect([...state.tasks.values()]).toHaveLength(4);
    expect(state.signals.get(fourth.signalId)).toMatchObject({ status: "converted" });
  });
});

describe("D6-6 retry of deferred error signals", () => {
  it("the 4th issue of Monday opens on Tuesday's tick and not on a second Monday tick", async () => {
    const d = deps();
    for (let i = 1; i <= FIX_TASKS_PER_DAY; i++) {
      const { signalId } = await recordIncident(d, "company-1", issueOf({ id: `m-${i}`, shortId: `NORTH-M${i}` }));
      await openFixTask(d, "company-1", signalId);
    }
    const fourth = await recordIncident(d, "company-1", issueOf({ id: "m-4", shortId: "NORTH-M4" }));
    expect((await openFixTask(d, "company-1", fourth.signalId)).outcome).toBe("deferred");
    expect(state.signals.get(fourth.signalId)?.payload).toMatchObject({ deferredDay: localDay("Europe/Istanbul", clock.now()), issue: expect.objectContaining({ shortId: "NORTH-M4" }) });
    expect(await retryDeferredIncidents(d)).toEqual([]);
    clock.set(new Date(clock.now().getTime() + 86_400_000).toISOString());
    expect(await retryDeferredIncidents(d)).toEqual([{ companyId: "company-1", signalId: fourth.signalId }]);
    expect((await openFixTask(d, "company-1", fourth.signalId)).outcome).toBe("opened");
    expect(await retryDeferredIncidents(d)).toEqual([]);
  });

  it("a stopped company's deferred signals wait for the resume", async () => {
    const d = deps();
    const { signalId } = await recordIncident(d, "company-1", issueOf({ id: "s-1", shortId: "NORTH-S1" }));
    state.signals.get(signalId)!.status = "deferred";
    state.signals.get(signalId)!.payload = { ...state.signals.get(signalId)!.payload, deferredDay: "2020-01-01" };
    state.killSwitch.set("company-1", true);
    expect(await retryDeferredIncidents(d)).toEqual([]);
    state.killSwitch.set("company-1", false);
    expect(await retryDeferredIncidents(d)).toEqual([{ companyId: "company-1", signalId }]);
  });
});

describe("D6-3 openFixTask asks dispatch first (ADR 0014)", () => {
  it("an ended subscription opens nothing: the result is skipped with the reason and the signal is held deferred for a later day", async () => {
    const d = deps();
    const { signalId } = await recordIncident(d, "company-1", issue);
    const owner = state.companies.get("company-1")!.ownerId;
    state.entitlements.set(owner, { ...(await dbModule.getEntitlement({} as never, owner))!, status: "ended", endedAt: clock.now().toISOString(), retentionUntil: "2099-01-01T00:00:00.000Z" });
    expect(await openFixTask(d, "company-1", signalId)).toEqual({ taskId: null, reused: false, outcome: "skipped", skipped: "subscription_ended" });
    expect([...state.tasks.values()]).toHaveLength(0);
    expect(state.signals.get(signalId)).toMatchObject({ status: "deferred", rationale: expect.stringContaining("subscription_ended") });
  });
});
