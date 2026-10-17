import { describe, expect, it } from "vitest";
import { assertWorkerReplays, replayHealthProblem } from "./replay-health";

/**
 * TST-2: a replay run must have replayed. `e2e/global-setup.ts` asks the worker
 * for its health line; these tests are the pure part of that answer.
 */

const replaying = { ok: true, app: "north-worker", mode: "sandbox", runtime: "claude-agent-sdk", profile: "smoke", env: "staging", gateway: "replay", budget: { capUsd: 0, spentUsd: 0, unpriced: 0, exhausted: false } };
const mock = { ...replaying, runtime: "mock", gateway: "off", budget: null };

describe("TST-2 replayHealthProblem", () => {
  it("a worker on the SDK runtime with a replaying gateway is fine", () => {
    expect(replayHealthProblem(replaying)).toBeNull();
  });

  it("a worker on the mock runtime is a readable error that says how to start it", () => {
    const problem = replayHealthProblem(mock) ?? "";
    expect(problem).toMatch(/runtime is "mock", not claude-agent-sdk/);
    expect(problem).toMatch(/gateway is "off", not replay/);
    expect(problem).toContain("NORTH_CASSETTE_MODE=replay AGENT_RUNTIME=claude-agent-sdk NORTH_ENV=staging NORTH_MODEL_PROFILE=smoke pnpm dev");
  });

  it("a gateway that records or forwards is not replaying", () => {
    expect(replayHealthProblem({ ...replaying, gateway: "record" })).toMatch(/gateway is "record", not replay/);
    expect(replayHealthProblem({ ...replaying, gateway: "live" })).toMatch(/gateway is "live", not replay/);
    expect(replayHealthProblem({ ...replaying, gateway: "record" })).not.toMatch(/runtime is/);
  });

  it("a body that is not the worker's health line, or an older one without the fields, is a readable error", () => {
    expect(replayHealthProblem({ ok: true, app: "north-web" })).toMatch(/not the worker's health line/);
    expect(replayHealthProblem(null)).toMatch(/not the worker's health line/);
    expect(replayHealthProblem("<html>")).toMatch(/not the worker's health line/);
    expect(replayHealthProblem({ ok: true, app: "north-worker", mode: "sandbox" })).toMatch(/older than this check/);
  });
});

describe("TST-2 assertWorkerReplays", () => {
  const noWait = { attempts: 3, delayMs: 0, sleep: async () => undefined };

  it("returns when the worker replays, reading the health line once", async () => {
    let reads = 0;
    await assertWorkerReplays(async () => (reads += 1, replaying), noWait);
    expect(reads).toBe(1);
  });

  it("throws the readable error at once for a worker that answers with the wrong setup (restart it; waiting changes nothing)", async () => {
    let reads = 0;
    await expect(assertWorkerReplays(async () => (reads += 1, mock), noWait)).rejects.toThrow(/runtime is "mock", not claude-agent-sdk/);
    expect(reads).toBe(1);
  });

  it("waits for a worker that is still starting, then passes", async () => {
    let reads = 0;
    await assertWorkerReplays(async () => {
      reads += 1;
      if (reads < 3) throw new Error("ECONNREFUSED");
      return replaying;
    }, noWait);
    expect(reads).toBe(3);
  });

  it("gives up on a worker that never answers, saying where it looked and what was wrong", async () => {
    await expect(
      assertWorkerReplays(
        async () => {
          throw new Error("ECONNREFUSED");
        },
        { ...noWait, label: "http://localhost:3101/health" },
      ),
    ).rejects.toThrow(/does not answer at http:\/\/localhost:3101\/health.*ECONNREFUSED.*3 tries/);
  });
});
