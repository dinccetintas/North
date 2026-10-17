/** STG-1, TST-5: the env-dependent rules the worker's /health line must satisfy, on their own (the check wires them in `production-check-env.test.ts`). */
import { describe, expect, it } from "vitest";
import { MODEL_PROFILES } from "@north/core";
import { failedHealthRules, healthFacts, healthRulesFor, isCheckEnv, type CheckEnv, type HealthLine } from "./production-check-rules";

const budget = { capUsd: 5, spentUsd: 0.4, unpriced: 0, exhausted: false };
const production: HealthLine = { mode: "sandbox", runtime: "mock", profile: "production", fence: false, gateway: "off", env: "production", unsubscribe: true, budget: null };
const staging: HealthLine = { mode: "live", runtime: "claude-agent-sdk", profile: "smoke", fence: true, gateway: "record", env: "staging", unsubscribe: true, budget };

const failures = (env: CheckEnv, patch: Record<string, unknown>, base: HealthLine = env === "production" ? production : staging): readonly string[] => failedHealthRules(env, { ...base, ...patch });
const without = (line: HealthLine, ...keys: string[]): HealthLine => Object.fromEntries(Object.entries(line).filter(([k]) => !keys.includes(k)));

describe("TST-5 production rules", () => {
  it("a production line holds: profile production, fence off, env production, no recorded or replayed gateway, a budget not spent", () => {
    expect(failures("production", {})).toEqual([]);
    expect(failures("production", { gateway: "live", budget })).toEqual([]);
    expect(failures("production", { mode: "live", runtime: "claude-agent-sdk", gateway: "live", budget })).toEqual([]);
  });

  it("a fence that is on fails, naming the fence and its value", () => {
    const [message, ...rest] = failures("production", { fence: true });
    expect(rest).toEqual([]);
    expect(message).toContain("fence");
    expect(message).toContain("true");
    expect(message).toContain("NORTH_TEST_FENCE");
  });

  it("any profile but production fails, naming the profile", () => {
    for (const profile of ["staging", "smoke", "nonsense", 7]) {
      const [message, ...rest] = failures("production", { profile });
      expect(rest).toEqual([]);
      expect(message).toContain("profile");
      expect(message).toContain(JSON.stringify(profile));
    }
  });

  it("a worker that says it is staging fails, naming env", () => {
    const [message] = failures("production", { env: "staging" });
    expect(message).toContain("env");
    expect(message).toContain('"staging"');
  });

  it("a gateway that records or replays fails; off and live pass", () => {
    for (const gateway of ["record", "replay", "nonsense", true]) expect(failures("production", { gateway })[0]).toContain(`gateway is ${JSON.stringify(gateway)}`);
    for (const gateway of ["off", "live"]) expect(failures("production", { gateway })).toEqual([]);
  });

  it("a spent day fails, naming the budget; no gateway (null) and an open day pass", () => {
    const [message] = failures("production", { gateway: "live", budget: { ...budget, exhausted: true } });
    expect(message).toContain("budget");
    expect(message).toContain("exhausted");
    expect(failures("production", { budget: null })).toEqual([]);
    expect(failures("production", { gateway: "live", budget: { ...budget, exhausted: "yes" } })).toHaveLength(1);
    expect(failures("production", { gateway: "live", budget: "none" })).toHaveLength(1);
  });

  it("collects every failure, not just the first", () => {
    const all = failures("production", { fence: true, env: "staging", profile: "smoke", gateway: "replay" });
    expect(all).toHaveLength(4);
    expect(all.join(" ")).toMatch(/fence[\s\S]*env|env[\s\S]*fence/);
  });
});

describe("STG-1 staging rules", () => {
  it("a staging line holds, with any of the three profiles and a gateway that is off, live or recording", () => {
    expect(failures("staging", {})).toEqual([]);
    for (const profile of MODEL_PROFILES) expect(failures("staging", { profile })).toEqual([]);
    for (const gateway of ["off", "live", "record"]) expect(failures("staging", { gateway, runtime: "mock", budget: null })).toEqual([]);
  });

  it("a fence that is off fails, naming the fence and its value", () => {
    const [message, ...rest] = failures("staging", { fence: false });
    expect(rest).toEqual([]);
    expect(message).toContain("fence");
    expect(message).toContain("false");
    expect(message).toContain("NORTH_TEST_FENCE=1");
  });

  it("a worker that says it is production fails, naming env", () => {
    const [message] = failures("staging", { env: "production" });
    expect(message).toContain("env");
    expect(message).toContain('"production"');
    expect(message).toContain("NORTH_ENV=staging");
  });

  it("a replaying gateway fails (the tape answers, nothing real is tested); record is fine", () => {
    expect(failures("staging", { gateway: "replay" })[0]).toContain('gateway is "replay"');
    expect(failures("staging", { gateway: "record" })).toEqual([]);
    expect(failures("staging", { gateway: "nonsense" })).toHaveLength(1);
  });

  it("a profile outside the three fails, naming it", () => {
    const [message] = failures("staging", { profile: "nonsense" });
    expect(message).toContain("profile");
    expect(message).toContain('"nonsense"');
  });

  it("the SDK runtime needs the gateway's budget on the line; the mock runtime may have none", () => {
    const [message] = failures("staging", { budget: null });
    expect(message).toContain("budget");
    expect(message).toContain("claude-agent-sdk");
    expect(failures("staging", { runtime: "mock", gateway: "off", budget: null })).toEqual([]);
    expect(failures("staging", { budget: { ...budget, exhausted: true } })).toEqual([]);
  });
});

describe("TST-5 rules in both envs", () => {
  it("a gateway that replays fails in production and in staging", () => {
    expect(failures("production", { gateway: "replay" })).toHaveLength(1);
    expect(failures("staging", { gateway: "replay" })).toHaveLength(1);
  });

  it("a live worker that cannot verify unsubscribe links fails in both; a sandbox worker may not", () => {
    for (const env of ["production", "staging"] as const) {
      const [message, ...rest] = failures(env, { mode: "live", unsubscribe: false });
      expect(rest).toEqual([]);
      expect(message).toContain("unsubscribe");
      expect(message).toContain("false");
      expect(message).toContain("UNSUBSCRIBE_SECRET");
      expect(failures(env, { mode: "sandbox", unsubscribe: false })).toEqual([]);
      expect(failures(env, { mode: "live", unsubscribe: true })).toEqual([]);
    }
  });

  it("a field the worker does not report fails with the worker named as older than this check", () => {
    for (const [env, line] of [["production", production], ["staging", staging]] as const) {
      for (const field of ["profile", "fence", "env", "gateway", "budget"]) {
        const [message, ...rest] = failedHealthRules(env, without(line, field));
        expect(rest).toEqual([]);
        expect(message).toContain(`${field} is missing`);
        expect(message).toContain("older than this check");
      }
      const [message, ...rest] = failedHealthRules(env, without({ ...line, mode: "live" }, "unsubscribe"));
      expect(rest).toEqual([]);
      expect(message).toContain("unsubscribe is missing");
      expect(message).toContain("older than this check");
    }
  });
});

describe("STG-1 healthRulesFor", () => {
  it("is one frozen list per env, each rule named after the field it reads", () => {
    for (const env of ["production", "staging"] as const) {
      const rules = healthRulesFor(env);
      expect(Object.isFrozen(rules)).toBe(true);
      expect(rules.map((r) => r.name)).toEqual(expect.arrayContaining(["profile", "fence", "env", "gateway", "unsubscribe", "budget"]));
      for (const rule of rules) expect(typeof rule.holds(env === "production" ? production : staging)).toBe("boolean");
    }
    expect(healthRulesFor("production")).not.toBe(healthRulesFor("staging"));
  });

  it("does not change the line it reads", () => {
    const line = { ...staging, budget: { ...budget } };
    const before = JSON.stringify(line);
    failedHealthRules("staging", line);
    failedHealthRules("production", line);
    expect(JSON.stringify(line)).toBe(before);
  });

  it("knows exactly two envs", () => {
    expect(isCheckEnv("production")).toBe(true);
    expect(isCheckEnv("staging")).toBe(true);
    for (const other of ["", "Staging", "prod", "acceptance", "nonsense"]) expect(isCheckEnv(other)).toBe(false);
  });

  it("summarises what the line says, a missing field as ?", () => {
    expect(healthFacts(production)).toBe("profile production, fence off, gateway off, env production");
    expect(healthFacts(staging)).toBe("profile smoke, fence on, gateway record, env staging");
    expect(healthFacts({})).toBe("profile ?, fence ?, gateway ?, env ?");
    expect(healthFacts({ ...production, profile: "smoke\nPASS worker-health", gateway: "x".repeat(200), env: 7 })).toBe("profile ?, fence off, gateway ?, env ?");
  });
});
