import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSandboxIntegrations, type Integrations } from "@north/integrations";
import { SimClock, wallClock } from "../src/services/clock";
import { sandboxRoutes } from "../src/sandbox-routes";
import { sentrySecretFor, workerEnv } from "../src/env";
import { adsStart, emptyState, fakeDbModule, fakeDeps, seedTask, type FakeState } from "./fake-db";

/**
 * D5-1 (ADR 0011): the worker has one clock. In sandbox mode on a loopback
 * host the harness moves it through `POST /sandbox/clock`; elsewhere the
 * route does not exist. Cards carry `opened_at` and `dueAt` from the clock.
 */

const state: FakeState = emptyState();
vi.mock("@north/db", () => fakeDbModule(state));
const { gateAction } = await import("../src/services/actions");

const START = "2026-10-19T04:00:00.000Z";
const post = (app: ReturnType<typeof sandboxRoutes>, body?: string) => app.request("/sandbox/clock", { method: "POST", headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body }) });

beforeEach(() => {
  Object.assign(state, emptyState());
  state.budgets.set("company-1", [{ category: "ads", totalLimitUsd: 300, dailyLimitUsd: 20, spentTotalUsd: 0, spentTodayUsd: 0 }]);
});

describe("SimClock", () => {
  it("starts on the wall clock, moves to the instant it is set to, and keeps running at wall speed from there", async () => {
    const clock = new SimClock();
    expect(Math.abs(clock.now().getTime() - Date.now())).toBeLessThan(50);
    expect(clock.offsetMs).toBe(0);
    const set = clock.set(START);
    expect(set.toISOString().slice(0, 19)).toBe(START.slice(0, 19));
    expect(clock.offsetMs).toBeGreaterThan(0);
    await new Promise((r) => setTimeout(r, 20));
    expect(clock.now().getTime()).toBeGreaterThanOrEqual(Date.parse(START) + 15);
    expect(new SimClock(START).now().toISOString().slice(0, 16)).toBe("2026-10-19T04:00");
    expect(() => clock.set("not a date")).toThrow();
    expect(Math.abs(wallClock().getTime() - Date.now())).toBeLessThan(50);
  });
});

describe("POST /sandbox/clock", () => {
  let integrations: Integrations;
  beforeEach(async () => {
    integrations = createSandboxIntegrations(undefined, { root: await mkdtemp(join(tmpdir(), "north-clock-")) });
  });

  it("sets the clock on a loopback sandbox worker and reports it on GET; a bad body is 400", async () => {
    const clock = new SimClock();
    const app = sandboxRoutes(integrations, "127.0.0.1", clock);
    const ok = await post(app, JSON.stringify({ now: START }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, now: expect.stringMatching(/^2026-10-19T04:00/) });
    expect(clock.now().toISOString().slice(0, 16)).toBe("2026-10-19T04:00");
    const read = await app.request("/sandbox/clock");
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ now: expect.stringMatching(/^2026-10-19T04:00/) });
    expect((await post(app, JSON.stringify({ now: "yesterday" }))).status).toBe(400);
    expect((await post(app, "nope")).status).toBe(400);
    expect((await post(app)).status).toBe(400);
  });

  it("does not exist in live mode, off loopback, or without a simulated clock (404)", async () => {
    const clock = new SimClock();
    const live = { ...integrations, mode: "live" } as unknown as Integrations;
    expect((await post(sandboxRoutes(live, "127.0.0.1", clock), JSON.stringify({ now: START }))).status).toBe(404);
    for (const host of ["0.0.0.0", "10.0.0.5", "worker.internal"]) {
      expect((await post(sandboxRoutes(integrations, host, clock), JSON.stringify({ now: START }))).status).toBe(404);
    }
    expect((await post(sandboxRoutes(integrations, "127.0.0.1", null), JSON.stringify({ now: START }))).status).toBe(404);
    expect(clock.offsetMs).toBe(0);
  });
});

describe("gateFor stamps the card from the clock (DEC-3)", () => {
  it("opened_at is the worker's clock and dueAt is 24 h after it", async () => {
    const task = seedTask(state);
    const clock = new SimClock(START);
    const gated = await gateAction(fakeDeps(state, [], 200, "sandbox", "/tmp/north-test-sandbox", clock), task.id, adsStart());
    if (gated.kind !== "card") throw new Error(gated.kind);
    const card = state.cards.get(gated.cardId)!;
    expect(card.openedAt.slice(0, 16)).toBe("2026-10-19T04:00");
    expect(card.dueAt.slice(0, 16)).toBe("2026-10-20T04:00");
    expect(card.day).toBe("2026-10-19");
  });
});

describe("env (D5-1)", () => {
  const base = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_SERVICE_ROLE_KEY: "service-role-key-xyz" };

  it("defaults the Sentry secret in sandbox mode only and refuses a clock start in live mode", () => {
    expect(sentrySecretFor({ INTEGRATIONS_MODE: "sandbox", SENTRY_CLIENT_SECRET: undefined, WORKER_HOST: "127.0.0.1" })).toBe("sandbox-sentry-secret");
    expect(sentrySecretFor({ INTEGRATIONS_MODE: "live", SENTRY_CLIENT_SECRET: undefined, WORKER_HOST: "127.0.0.1" })).toBeNull();
    expect(sentrySecretFor({ INTEGRATIONS_MODE: "live", SENTRY_CLIENT_SECRET: "real-secret-123", WORKER_HOST: "127.0.0.1" })).toBe("real-secret-123");
    expect(workerEnv({ ...base, NORTH_CLOCK_START: START } as NodeJS.ProcessEnv).NORTH_CLOCK_START).toBe(START);
    expect(() => workerEnv({ ...base, INTEGRATIONS_MODE: "live", CONNECTIONS_ENCRYPTION_KEY: "k".repeat(64), NORTH_CLOCK_START: START } as NodeJS.ProcessEnv)).toThrow(/NORTH_CLOCK_START/);
    expect(() => workerEnv({ ...base, SENTRY_DSN: "not a url" } as NodeJS.ProcessEnv)).toThrow(/SENTRY_DSN/);
  });
});
