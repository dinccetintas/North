import { describe, expect, it } from "vitest";
import { fencePolicyFromEnv } from "@north/core";
import { fencePolicyFor, workerEnv } from "../src/env";
import { workerHealth, type HealthGateway } from "../src/health";
import { SimClock } from "../src/services/clock";

/**
 * STG-1 / TST-1 / TST-5: `/health` says which profile, fence, gateway mode and
 * environment the worker runs under, and how the day's model budget stands,
 * so the staging check can read them. Never a key, never a path.
 */

const KEY = "sk-ant-api03-the-real-key-never-shown";
const env = workerEnv({
  SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-xyz",
  AGENT_RUNTIME: "claude-agent-sdk",
  ANTHROPIC_API_KEY: KEY,
  NORTH_ENV: "staging",
  NORTH_MODEL_PROFILE: "smoke",
  NORTH_TEST_FENCE: "1",
  NORTH_CASSETTE_MODE: "replay",
  NORTH_CASSETTE_DIR: "/srv/north/cassettes",
  AGENT_CONFIG_ROOT: "/srv/north/agent-config",
} as NodeJS.ProcessEnv);

const clock = new SimClock();

const gateway = (exhausted: boolean): HealthGateway => ({
  mode: "replay",
  stats: () => ({ requests: 3, spentUsd: 0.12, misses: 1, unpriced: 1, capUsd: 0.5, exhausted }),
});

describe("STG-1 workerHealth: profile, fence, gateway, env and budget", () => {
  it("STG-1 reports the profile, whether the fence is on, the gateway mode and the environment", () => {
    const health = workerHealth(env, { clock: () => clock.now(), simClock: clock, tracing: false, fence: fencePolicyFor(env), gateway: gateway(false) });
    expect(health).toMatchObject({ ok: true, runtime: "claude-agent-sdk", profile: "smoke", fence: true, gateway: "replay", env: "staging" });
  });

  it("TST-1 reports the day's budget with exhausted as its own field, apart from spentUsd", () => {
    const open = workerHealth(env, { clock: () => clock.now(), simClock: clock, tracing: false, fence: fencePolicyFor(env), gateway: gateway(false) });
    expect(open.budget).toEqual({ capUsd: 0.5, spentUsd: 0.12, unpriced: 1, exhausted: false });
    // A closed day is the flag alone: the spend is passed through as priced, never raised to the cap.
    const closed = workerHealth(env, { clock: () => clock.now(), simClock: clock, tracing: false, fence: fencePolicyFor(env), gateway: gateway(true) });
    expect(closed.budget).toEqual({ capUsd: 0.5, spentUsd: 0.12, unpriced: 1, exhausted: true });
  });

  it("TST-5 without a gateway (mock runtime) the gateway is off and there is no budget; a fence that is off reads false", () => {
    const health = workerHealth({ ...env, NORTH_ENV: "production", NORTH_MODEL_PROFILE: "production" }, { clock: () => clock.now(), simClock: null, tracing: true, fence: fencePolicyFromEnv({}), gateway: null });
    expect(health).toMatchObject({ profile: "production", fence: false, gateway: "off", env: "production", budget: null, tracing: true });
  });

  it("SEC-1 never carries a key or a path", () => {
    const json = JSON.stringify(workerHealth(env, { clock: () => clock.now(), simClock: clock, tracing: false, fence: fencePolicyFor(env), gateway: gateway(true) }));
    expect(json).not.toContain("sk-ant");
    expect(json).not.toContain(KEY);
    expect(json).not.toContain("service-role-key-xyz");
    expect(json).not.toContain("/srv/north");
    expect(json).not.toContain("127.0.0.1");
  });
});
