import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROFILE,
  EFFORT_BY_ALIAS,
  MODEL_ALIASES,
  MODEL_PROFILES,
  MODEL_ROUTING,
  PRICE_USD_PER_MTOK,
  costOfUsage,
  isModelProfile,
  resolveEffort,
  resolveModel,
  type ModelProfile,
} from "../src/models";

describe("TST-1 model profiles", () => {
  it("production is the default and keeps today's routing", () => {
    expect(DEFAULT_PROFILE).toBe("production");
    expect(resolveModel("coder")).toBe(MODEL_ROUTING.coder);
    expect(resolveEffort("coder")).toBe("xhigh");
    for (const alias of MODEL_ALIASES) {
      expect(resolveModel(alias, "production")).toBe(MODEL_ROUTING[alias]);
      expect(resolveEffort(alias, "production")).toBe(EFFORT_BY_ALIAS[alias]);
    }
  });

  it("smoke routes every alias to the haiku tier at low effort", () => {
    for (const alias of MODEL_ALIASES) {
      expect(resolveModel(alias, "smoke")).toBe("claude-haiku-5-5");
      expect(resolveEffort(alias, "smoke")).toBe("low");
    }
  });

  it("staging routes planner and coder to sonnet at medium", () => {
    expect(resolveModel("planner", "staging")).toBe("claude-sonnet-5-5");
    expect(resolveEffort("coder", "staging")).toBe("medium");
  });

  it("staging routes drafter to sonnet at low and classifier to haiku", () => {
    expect(resolveModel("coder", "staging")).toBe("claude-sonnet-5-5");
    expect(resolveEffort("planner", "staging")).toBe("medium");
    expect(resolveModel("drafter", "staging")).toBe("claude-sonnet-5-5");
    expect(resolveEffort("drafter", "staging")).toBe("low");
    expect(resolveModel("classifier", "staging")).toBe("claude-haiku-5-5");
  });

  it("rejects an unknown profile and an unknown alias", () => {
    expect(() => resolveModel("coder", "prod" as ModelProfile)).toThrow(/profile/);
    expect(() => resolveEffort("coder", "prod" as ModelProfile)).toThrow(/profile/);
    expect(() => resolveModel("gpt", "smoke")).toThrow(/Unknown model alias/);
    expect(() => resolveEffort("gpt", "smoke")).toThrow(/Unknown model alias/);
    expect(isModelProfile("smoke")).toBe(true);
    expect(isModelProfile("prod")).toBe(false);
    expect(MODEL_PROFILES).toEqual(["production", "staging", "smoke"]);
  });

  it("keeps the production tables frozen and unchanged", () => {
    expect(MODEL_ROUTING.planner).toBe("claude-opus-5-5");
    expect(Object.isFrozen(MODEL_ROUTING)).toBe(true);
    expect(Object.isFrozen(EFFORT_BY_ALIAS)).toBe(true);
    expect(Object.isFrozen(PRICE_USD_PER_MTOK)).toBe(true);
    expect(Object.isFrozen(PRICE_USD_PER_MTOK["claude-haiku-5-5"])).toBe(true);
  });

  it("costOfUsage prices by model id with cache reads", () => {
    // 100,000 prompt tokens is still the short Haiku tier (0.10 per million): 0.01 USD.
    expect(costOfUsage({ model: "claude-haiku-5-5", inputTokens: 100_000, outputTokens: 0, cacheReadTokens: 0 })).toBeCloseTo(0.01, 9);
    expect(costOfUsage({ model: "unknown-model", inputTokens: 1, outputTokens: 1, cacheReadTokens: 1 })).toBeNaN();
  });

  it("costOfUsage sums input, output and cache-read at each model's rates", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 1_000_000 };
    expect(costOfUsage({ model: "claude-opus-5-5", ...usage })).toBeCloseTo(4 + 20 + 0.2, 6);
    expect(costOfUsage({ model: "claude-sonnet-5-5", ...usage })).toBeCloseTo(2 + 10 + 0.1, 6);
    // A prompt of 2M tokens is over 100,000, so Haiku bills the long-prompt tier: 0.50 + 2.50 + 0.05.
    expect(costOfUsage({ model: "claude-haiku-5-5", ...usage })).toBeCloseTo(0.5 + 2.5 + 0.05, 6);
    expect(costOfUsage({ model: "claude-haiku-5-5", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 })).toBe(0);
  });
});
