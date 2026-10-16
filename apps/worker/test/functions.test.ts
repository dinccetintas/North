import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EVENT, SentryIssueSchema } from "@north/core";
import type { WorkerDeps } from "../src/deps";
import { SimClock } from "../src/services/clock";
import { emptyState, fakeDbModule, fakeDeps, seedCompany, seedTask, type FakeState } from "./fake-db";

/**
 * D6-8 (ADR 0014): the Inngest functions around billing. `resume-company`
 * with the reason `subscription_ended` returns `skipped` and sends nothing;
 * after a new subscription it redispatches the queue. `retry-deferred` also
 * re-emits deferred `error` signals of an earlier day (D6-6). The ticks and
 * `apply-billing-event` send the kill-switch events the services return.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

type Handler = (ctx: { event: { name: string; data: Record<string, unknown> }; step: unknown; attempt: number }) => Promise<unknown>;
const handlers = new Map<string, Handler>();
vi.mock("../src/inngest/client", () => ({ inngest: { createFunction: (opts: { id: string }, handler: Handler) => (handlers.set(opts.id, handler), { id: opts.id }) } }));
let current: WorkerDeps;
vi.mock("../src/deps", async (importOriginal) => ({ ...(await importOriginal<object>()), buildDeps: async () => current }));

await import("../src/inngest/functions");
await import("../src/inngest/billing-functions");
const { endSubscription, reactivate } = await import("../src/services/entitlements");
const { recordIncident, openFixTask, FIX_TASKS_PER_DAY } = await import("../src/services/incidents");

const OWNER = "7a1f0c4e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const C1 = "c1000000-0000-4000-8000-000000000001";
let clock: SimClock;
let sent: { id: string; events: unknown }[];

const step = () => ({
  run: async <T>(_id: string, fn: () => Promise<T>) => fn(),
  sendEvent: async (id: string, events: unknown) => void sent.push({ id, events }),
});
const run = (id: string, data: Record<string, unknown> = {}, name = "test") => handlers.get(id)!({ event: { name, data }, step: step(), attempt: 0 });
const endEntitlement = async () => {
  const trial = (await dbModule.getEntitlement({} as never, OWNER))!;
  state.entitlements.set(OWNER, { ...trial, status: "ended", endedAt: clock.now().toISOString(), retentionUntil: "2027-01-31T04:00:00.000Z" });
};

beforeEach(() => {
  Object.assign(state, emptyState());
  sent = [];
  clock = new SimClock();
  current = fakeDeps(state, [], 200, "sandbox", "/tmp/north-test-sandbox", clock);
  seedCompany(state, { id: C1, ownerId: OWNER, timezone: "Europe/Istanbul" });
});

describe("D6-8 resume-company", () => {
  it("with the reason subscription_ended returns skipped and sends nothing; the flag stays", async () => {
    seedTask(state, { companyId: C1, status: "queued" });
    await endSubscription(current, OWNER);
    await endEntitlement();
    expect(await run("resume-company", { companyId: C1 })).toEqual({ companyId: C1, skipped: "subscription_ended" });
    expect(sent).toEqual([]);
    expect([state.killSwitch.get(C1), state.pausedReasons.get(C1)]).toEqual([true, "subscription_ended"]);
  });

  it("after a new subscription lifted the pause it redispatches the queue", async () => {
    const task = seedTask(state, { companyId: C1, status: "queued" });
    await endSubscription(current, OWNER);
    await reactivate(current, OWNER);
    expect(await run("resume-company", { companyId: C1 })).toMatchObject({ companyId: C1, redispatched: 1 });
    expect(sent[0]).toEqual({ id: "redispatch", events: [{ name: EVENT.taskDispatch, data: { companyId: C1, taskId: task.id } }] });
  });
});

describe("D6-8 plan-week and run-task ask dispatch", () => {
  it("plan/requested for an ended owner plans nothing and sends nothing; task/dispatch with no credits returns blocked: credits_exhausted and the task stays queued", async () => {
    await endEntitlement();
    expect(await run("plan-week", { companyId: C1 })).toEqual({ kind: "skipped", skipped: "subscription_ended" });
    expect(sent).toEqual([]);
    state.entitlements.set(OWNER, { ...state.entitlements.get(OWNER)!, status: "active", endedAt: null, retentionUntil: null });
    state.credits.set(OWNER, []);
    const task = seedTask(state, { id: randomUUID(), companyId: C1, status: "queued" });
    expect(await run("run-task", { companyId: C1, taskId: task.id })).toMatchObject({ status: "blocked", reason: "credits_exhausted" });
    expect(state.tasks.get(task.id)?.status).toBe("queued");
    expect(sent).toEqual([]);
  });
});

describe("D6-6 retry-deferred", () => {
  it("re-emits signal/detected for an error signal deferred on an earlier local day, once", async () => {
    const issue = (n: number) => SentryIssueSchema.parse({ id: `i-${n}`, shortId: `NORTH-${n}`, title: "TypeError", culprit: "app.tsx", level: "error", permalink: `https://sentry.io/issues/${n}/`, firstSeen: "2026-10-21T06:00:00.000Z", project: { slug: "lumen-web" } });
    let deferred = "";
    for (let n = 1; n <= FIX_TASKS_PER_DAY + 1; n++) {
      const { signalId } = await recordIncident(current, C1, issue(n));
      if ((await openFixTask(current, C1, signalId)).outcome === "deferred") deferred = signalId;
    }
    await run("retry-deferred");
    expect(sent.filter((s) => s.id === "redetect")).toEqual([]);
    clock.set(new Date(clock.now().getTime() + 86_400_000).toISOString());
    await run("retry-deferred");
    expect(sent.find((s) => s.id === "redetect")?.events).toEqual([{ name: EVENT.signalDetected, data: { companyId: C1, signalId: deferred, kind: "error" } }]);
  });
});

describe("D6-3 billing ticks", () => {
  it("entitlements-tick ends an expired trial and sends company/killswitch per company", async () => {
    const trial = (await dbModule.getEntitlement({} as never, OWNER))!;
    state.entitlements.set(OWNER, { ...trial, periodEnd: new Date(clock.now().getTime() - 1000).toISOString() });
    expect(await run("entitlements-tick")).toEqual({ ended: 1, users: [OWNER], companies: 1 });
    expect(sent).toEqual([{ id: "kill-switch", events: [{ name: EVENT.companyKillSwitch, data: { companyId: C1 } }] }]);
    expect(state.pausedReasons.get(C1)).toBe("subscription_ended");
  });

  it("usage-tick with nothing due sends nothing", async () => {
    expect(await run("usage-tick")).toEqual({ alerts: 0, users: [] });
  });
});
