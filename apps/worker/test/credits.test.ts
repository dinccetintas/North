import { beforeEach, describe, expect, it, vi } from "vitest";
import { CREDIT_GRACE } from "@north/core";
import { SimClock } from "../src/services/clock";
import { emptyState, fakeDbModule, fakeDeps, seedCompany, type FakeState } from "./fake-db";

/**
 * D6-3 (BIL-2): one `consume` per `agent_runs` row (`run:<id>`), written in
 * the step that records the run, idempotent when the step runs again; the
 * usage month is the owner's local month; the credit floor refusal is logged
 * and never fails the run.
 */

const state: FakeState = emptyState();
const dbModule = fakeDbModule(state);
vi.mock("@north/db", () => dbModule);

const { chargeRun, consumeForRun, recordUsageForRun, releaseRun, reserveRun } = await import("../src/services/credits");

const OWNER = "7a1f0c4e-2b3d-4e5f-8a9b-0c1d2e3f4a5b";
const COMPANY = "c1000000-0000-4000-8000-000000000001";
let clock: SimClock;
const deps = () => fakeDeps(state, [], 200, "sandbox", "/tmp/north-test-sandbox", clock);
const refs = () => (state.credits.get(OWNER) ?? []).map((e) => e.ref);

beforeEach(() => {
  Object.assign(state, emptyState());
  // 21:30 UTC on 31 October is 00:30 on 1 November in Istanbul: the usage month is the owner's.
  clock = new SimClock("2026-10-31T21:30:00.000Z");
  seedCompany(state, { id: COMPANY, ownerId: OWNER, timezone: "Europe/Istanbul" });
});

describe("D6-3 credits per run", () => {
  it("one consume per agent run and the usage on the owner's local month; the same step again writes nothing twice", async () => {
    const run = { usage: { costUsd: 0.37 }, sandboxMinutes: 2 };
    expect(await chargeRun(deps(), COMPANY, "run-1", run)).toEqual({ userId: OWNER, consumed: true, period: "2026-11" });
    expect(await chargeRun(deps(), COMPANY, "run-1", run)).toEqual({ userId: OWNER, consumed: false, period: "2026-11" });
    await chargeRun(deps(), COMPANY, "run-2", { usage: { costUsd: 0 } });
    expect(refs()).toEqual([`trial:${OWNER}`, "run:run-1", "run:run-2"]);
    expect(await dbModule.creditBalance({} as never, OWNER)).toBe(298);
    expect(state.usage.get(`${OWNER}:2026-11`)).toMatchObject({ creditsUsed: 2, llmCostUsd: 0.37, sandboxMinutes: 2 });
    expect(state.usage.has(`${OWNER}:2026-10`)).toBe(false);
    expect(dbModule.applyUsage).toHaveBeenCalledWith(expect.anything(), { userId: OWNER, period: "2026-11", credits: 1, costUsd: 0.37, sandboxMinutes: 2 });
  });

  it("consumeForRun and recordUsageForRun are the two halves", async () => {
    expect(await consumeForRun(deps(), OWNER, "run-9")).toBe(true);
    expect(await consumeForRun(deps(), OWNER, "run-9")).toBe(false);
    expect(await recordUsageForRun(deps(), { userId: OWNER, timezone: "UTC", run: { costUsd: 1.5, sandboxMinutes: 0 } })).toMatchObject({ period: "2026-10", creditsUsed: 1, llmCostUsd: 1.5 });
  });

  it(`a consume past the -${CREDIT_GRACE} floor is refused by the database: logged, the run's cost still in usage (no credit), the run is not failed`, async () => {
    state.credits.set(OWNER, [{ kind: "adjust", amount: -CREDIT_GRACE, ref: "adjust:floor", note: "" }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await chargeRun(deps(), COMPANY, "run-3", { usage: { costUsd: 0.1 }, sandboxMinutes: 3 })).toEqual({ userId: OWNER, consumed: false, period: "2026-11" });
    expect(refs()).toEqual(["adjust:floor"]);
    expect(state.usage.get(`${OWNER}:2026-11`)).toMatchObject({ creditsUsed: 0, llmCostUsd: 0.1, sandboxMinutes: 3 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("credit floor"));
    warn.mockRestore();
  });
});

describe("M6 review L9: the credit is reserved at dispatch", () => {
  it("reserveRun takes the run's credit before it starts (run:<id>), once; refused at a balance of 0", async () => {
    state.credits.set(OWNER, [{ kind: "grant_plan", amount: 1, ref: "trial:one", note: "" }]);
    expect(await reserveRun(deps(), COMPANY, "run-a")).toEqual({ ok: true, userId: OWNER, reserved: true });
    expect(await reserveRun(deps(), COMPANY, "run-a")).toEqual({ ok: true, userId: OWNER, reserved: false });
    expect(await reserveRun(deps(), COMPANY, "run-b")).toEqual({ ok: false, userId: OWNER, reason: "credits_exhausted" });
    expect(refs()).toEqual(["trial:one", "run:run-a"]);
  });

  it("chargeRun on a reserved run writes no second consume and adds the run to usage once", async () => {
    const reservation = await reserveRun(deps(), COMPANY, "run-r");
    expect(await chargeRun(deps(), COMPANY, "run-r", { usage: { costUsd: 0.25 }, sandboxMinutes: 1 }, reservation)).toEqual({ userId: OWNER, consumed: true, period: "2026-11" });
    expect(refs().filter((r) => r === "run:run-r")).toHaveLength(1);
    expect(state.usage.get(`${OWNER}:2026-11`)).toMatchObject({ creditsUsed: 1, llmCostUsd: 0.25, sandboxMinutes: 1 });
    expect(await dbModule.creditBalance({} as never, OWNER)).toBe(299);
  });

  it("releaseRun gives a reserved credit back once (release:<id>); an unreserved run releases nothing", async () => {
    const reservation = await reserveRun(deps(), COMPANY, "run-x");
    await releaseRun(deps(), "run-x", reservation);
    await releaseRun(deps(), "run-x", reservation);
    await releaseRun(deps(), "run-y", { ok: true, userId: OWNER, reserved: false });
    expect(refs()).toEqual([`trial:${OWNER}`, "run:run-x", "release:run-x"]);
    expect(await dbModule.creditBalance({} as never, OWNER)).toBe(300);
  });
});
