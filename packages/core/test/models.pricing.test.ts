import { describe, expect, it } from "vitest";
import { LONG_PROMPT_TOKENS, PRICE_USD_PER_MTOK, costAtHighestRate, costOfUsage, type ModelUsage } from "../src/models";
import { usageFromApi } from "../src/pricing/api-usage";

/**
 * TST-1: the rates are the official ones (pricing page, checked 2026-10-16,
 * USD per million tokens: input / 5-minute write / 1-hour write / read / output).
 * One million tokens of a single kind costs exactly its rate.
 */
const ZERO: Omit<ModelUsage, "model"> = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
const MTOK = 1_000_000;

const RATES = [
  ["claude-opus-5-5", 4, 5, 8, 0.2, 20],
  ["claude-sonnet-5-5", 2, 2.5, 4, 0.1, 10],
] as const;

describe("TST-1 costOfUsage prices all five token kinds", () => {
  for (const [model, input, write5m, write1h, read, output] of RATES) {
    it(`${model}: input ${input}, 5m write ${write5m}, 1h write ${write1h}, read ${read}, output ${output}`, () => {
      expect(costOfUsage({ model, ...ZERO, inputTokens: MTOK })).toBeCloseTo(input, 9);
      expect(costOfUsage({ model, ...ZERO, cacheWriteTokens: MTOK })).toBeCloseTo(write5m, 9);
      expect(costOfUsage({ model, ...ZERO, cacheWrite1hTokens: MTOK })).toBeCloseTo(write1h, 9);
      expect(costOfUsage({ model, ...ZERO, cacheReadTokens: MTOK })).toBeCloseTo(read, 9);
      expect(costOfUsage({ model, ...ZERO, outputTokens: MTOK })).toBeCloseTo(output, 9);
    });
  }

  it("claude-haiku-5-5 up to 100,000 prompt tokens: 0.10 / 0.125 / 0.20 / 0.01 / 0.50", () => {
    const model = "claude-haiku-5-5";
    const n = LONG_PROMPT_TOKENS; // exactly at the threshold is still the short tier
    expect(costOfUsage({ model, ...ZERO, inputTokens: n })).toBeCloseTo((n * 0.1) / MTOK, 12);
    expect(costOfUsage({ model, ...ZERO, cacheWriteTokens: n })).toBeCloseTo((n * 0.125) / MTOK, 12);
    expect(costOfUsage({ model, ...ZERO, cacheWrite1hTokens: n })).toBeCloseTo((n * 0.2) / MTOK, 12);
    expect(costOfUsage({ model, ...ZERO, cacheReadTokens: n })).toBeCloseTo((n * 0.01) / MTOK, 12);
    expect(costOfUsage({ model, ...ZERO, outputTokens: MTOK })).toBeCloseTo(0.5, 9);
  });

  it("claude-haiku-5-5 over 100,000 prompt tokens: 0.50 / 0.625 / 1 / 0.05 / 2.50", () => {
    const model = "claude-haiku-5-5";
    const n = LONG_PROMPT_TOKENS + 1;
    expect(costOfUsage({ model, ...ZERO, inputTokens: n })).toBeCloseTo((n * 0.5) / MTOK, 12);
    expect(costOfUsage({ model, ...ZERO, cacheWriteTokens: n })).toBeCloseTo((n * 0.625) / MTOK, 12);
    expect(costOfUsage({ model, ...ZERO, cacheWrite1hTokens: n })).toBeCloseTo((n * 1) / MTOK, 12);
    expect(costOfUsage({ model, ...ZERO, cacheReadTokens: n })).toBeCloseTo((n * 0.05) / MTOK, 12);
    expect(costOfUsage({ model, ...ZERO, inputTokens: n, outputTokens: MTOK })).toBeCloseTo((n * 0.5) / MTOK + 2.5, 9);
  });

  it("the Haiku tier switches at exactly 100,001 prompt tokens, summing input, reads and both write kinds", () => {
    const model = "claude-haiku-5-5";
    const short = costOfUsage({ model, ...ZERO, inputTokens: 100_000 });
    const long = costOfUsage({ model, ...ZERO, inputTokens: 100_001 });
    expect(short).toBeCloseTo(0.01, 12);
    expect(long).toBeCloseTo(0.0500005, 12);
    // The prompt is the sum of all four input-side kinds, priced per request.
    const mixed = { model, ...ZERO, inputTokens: 25_000, cacheReadTokens: 25_000, cacheWriteTokens: 25_000, cacheWrite1hTokens: 25_001 };
    expect(costOfUsage(mixed)).toBeCloseTo((25_000 * 0.5 + 25_000 * 0.05 + 25_000 * 0.625 + 25_001 * 1) / MTOK, 12);
    expect(costOfUsage({ ...mixed, cacheWrite1hTokens: 25_000 })).toBeCloseTo((25_000 * 0.1 + 25_000 * 0.01 + 25_000 * 0.125 + 25_000 * 0.2) / MTOK, 12);
  });

  it("the output tokens do not count toward the prompt length", () => {
    expect(costOfUsage({ model: "claude-haiku-5-5", ...ZERO, inputTokens: 100_000, outputTokens: 500_000 })).toBeCloseTo(0.01 + 0.25, 9);
  });

  it("opus and sonnet have one tier whatever the prompt length", () => {
    expect(costOfUsage({ model: "claude-sonnet-5-5", ...ZERO, inputTokens: 500_000 })).toBeCloseTo(1, 9);
    expect(PRICE_USD_PER_MTOK["claude-sonnet-5-5"]?.longPrompt).toBeUndefined();
    expect(PRICE_USD_PER_MTOK["claude-opus-5-5"]?.longPrompt).toBeUndefined();
  });

  it("cache write fields default to 0 when omitted", () => {
    expect(costOfUsage({ model: "claude-sonnet-5-5", ...ZERO, inputTokens: MTOK })).toBeCloseTo(2, 9);
  });

  it("returns NaN for an unknown model, never zero", () => {
    expect(costOfUsage({ model: "claude-unknown-9", ...ZERO, inputTokens: 1 })).toBeNaN();
    expect(costOfUsage({ model: "constructor", ...ZERO, inputTokens: 1 })).toBeNaN();
  });

  it("freezes every price, including the long-prompt tier", () => {
    const haiku = PRICE_USD_PER_MTOK["claude-haiku-5-5"];
    expect(Object.isFrozen(haiku)).toBe(true);
    expect(Object.isFrozen(haiku?.longPrompt)).toBe(true);
  });
});

describe("TST-1 fast mode and the highest rate", () => {
  const usage: ModelUsage = { model: "claude-sonnet-5-5", inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 };

  it("fast speed doubles the cost of the whole request; standard and absent do not", () => {
    expect(costOfUsage({ ...usage, speed: "fast" })).toBeCloseTo(4, 9);
    expect(costOfUsage({ ...usage, speed: "standard" })).toBeCloseTo(2, 9);
    expect(costOfUsage(usage)).toBeCloseTo(2, 9);
    expect(costOfUsage({ ...usage, model: "claude-haiku-5-5", inputTokens: 100_001, speed: "fast" })).toBeCloseTo(2 * ((100_001 * 0.5) / MTOK), 12);
    expect(costOfUsage({ ...usage, model: "claude-unknown-9", speed: "fast" })).toBeNaN();
  });

  it("costAtHighestRate prices a usage at the dearest model in the table, whatever its own model says", () => {
    const mixed: ModelUsage = { model: "claude-mystery-9", inputTokens: 1000, outputTokens: 200, cacheReadTokens: 50, cacheWriteTokens: 30, cacheWrite1hTokens: 20 };
    const opus = costOfUsage({ ...mixed, model: "claude-opus-5-5" });
    expect(costAtHighestRate(mixed)).toBeCloseTo((1000 * 4 + 200 * 20 + 50 * 0.2 + 30 * 5 + 20 * 8) / MTOK, 12);
    expect(costAtHighestRate(mixed)).toBeCloseTo(opus, 12);
    for (const model of Object.keys(PRICE_USD_PER_MTOK)) expect(costAtHighestRate(mixed)).toBeGreaterThanOrEqual(costOfUsage({ ...mixed, model }));
    expect(costAtHighestRate({ ...mixed, model: "claude-opus-5-5" })).toBeCloseTo(opus, 12);
  });

  it("costAtHighestRate keeps the fast multiplier, is finite, and is 0 for no tokens", () => {
    const fast: ModelUsage = { model: "x", inputTokens: 10, outputTokens: 10, cacheReadTokens: 0, speed: "fast" };
    expect(costAtHighestRate(fast)).toBeCloseTo(2 * ((10 * 4 + 10 * 20) / MTOK), 12);
    expect(Number.isFinite(costAtHighestRate(fast))).toBe(true);
    expect(costAtHighestRate({ model: "x", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 })).toBe(0);
  });
});

describe("TST-1 usageFromApi maps a Messages API body to ModelUsage", () => {
  it("reads usage.speed: fast is fast, anything else (or none) is standard", () => {
    const withSpeed = (speed: unknown) => usageFromApi({ model: "m", usage: { input_tokens: 1, output_tokens: 1, speed } });
    expect(withSpeed("fast")?.speed).toBe("fast");
    expect(withSpeed("standard")?.speed).toBe("standard");
    expect(withSpeed(null)?.speed).toBe("standard");
    expect(withSpeed(undefined)?.speed).toBe("standard");
    expect(withSpeed("turbo")?.speed).toBe("standard");
    expect(usageFromApi({ model: "m", usage: { input_tokens: 1, output_tokens: 1, speed: 7 } })).toBeNull();
  });

  it("reads the five token kinds from the cache_creation breakdown when present", () => {
    expect(
      usageFromApi({
        model: "claude-sonnet-5-5",
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 70,
          cache_creation: { ephemeral_5m_input_tokens: 40, ephemeral_1h_input_tokens: 30 },
        },
      }),
    ).toEqual({ model: "claude-sonnet-5-5", inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheWriteTokens: 40, cacheWrite1hTokens: 30, speed: "standard" });
  });

  it("falls back to cache_creation_input_tokens as 5-minute writes when there is no breakdown", () => {
    expect(
      usageFromApi({ model: "claude-haiku-5-5", usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 50, cache_read_input_tokens: 3 } }),
    ).toEqual({ model: "claude-haiku-5-5", inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 50, cacheWrite1hTokens: 0, speed: "standard" });
  });

  it("treats null and absent cache counts as 0", () => {
    expect(
      usageFromApi({ model: "m", usage: { input_tokens: 5, output_tokens: 6, cache_creation_input_tokens: null, cache_read_input_tokens: null, cache_creation: null } }),
    ).toEqual({ model: "m", inputTokens: 5, outputTokens: 6, cacheReadTokens: 0, cacheWriteTokens: 0, cacheWrite1hTokens: 0, speed: "standard" });
    expect(usageFromApi({ model: "m", usage: { input_tokens: 5, output_tokens: 6 } })).toMatchObject({ cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  it("never prices fewer writes than the total reported: a short breakdown leaves the rest as 5-minute writes", () => {
    expect(
      usageFromApi({
        model: "m",
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 100, cache_creation: { ephemeral_5m_input_tokens: 10, ephemeral_1h_input_tokens: 20 } },
      }),
    ).toMatchObject({ cacheWriteTokens: 80, cacheWrite1hTokens: 20 });
  });

  it("returns null for a body it cannot trust: no model, no usage, missing or negative counts, non-objects", () => {
    expect(usageFromApi({ usage: { input_tokens: 1, output_tokens: 1 } })).toBeNull();
    expect(usageFromApi({ model: "", usage: { input_tokens: 1, output_tokens: 1 } })).toBeNull();
    expect(usageFromApi({ model: "m" })).toBeNull();
    expect(usageFromApi({ model: "m", usage: { input_tokens: 1 } })).toBeNull();
    expect(usageFromApi({ model: "m", usage: { input_tokens: -1, output_tokens: 1 } })).toBeNull();
    expect(usageFromApi({ model: "m", usage: { input_tokens: "1", output_tokens: 1 } })).toBeNull();
    expect(usageFromApi({ model: "m", usage: { input_tokens: 1.5, output_tokens: 1 } })).toBeNull();
    expect(usageFromApi(null)).toBeNull();
    expect(usageFromApi("usage")).toBeNull();
    expect(usageFromApi(undefined)).toBeNull();
  });

  it("feeds costOfUsage: an unknown model maps fine and prices as NaN", () => {
    const usage = usageFromApi({ model: "claude-unknown-9", usage: { input_tokens: 1, output_tokens: 1 } });
    expect(usage).not.toBeNull();
    expect(costOfUsage(usage!)).toBeNaN();
  });
});
