// TST-1: the pure daily cap on test-run spend (staging worker per day, CI per run).
import { describe, expect, it } from "vitest";
import { TestRunBudgetSchema, applyTestSpend, remainingTestUsd, rollDay, wouldExceedTestCap, type TestRunBudget } from "../src/budget/test-run";

const budget = (overrides: Partial<TestRunBudget> = {}): TestRunBudget => ({ capUsd: 0.5, spentUsd: 0.45, day: "2026-10-16", ...overrides });

describe("TST-1 test-run budget", () => {
  it("TST-1 exceeding is strict: reaching the cap exactly is allowed, one cent over is not", () => {
    expect(wouldExceedTestCap(budget(), 0.06)).toBe(true);
    expect(wouldExceedTestCap(budget(), 0.05)).toBe(false);
    expect(wouldExceedTestCap(budget(), 0)).toBe(false);
  });

  it("TST-1 float noise does not turn an exact fit into an excess", () => {
    // 0.1 + 0.2 is 0.30000000000000004 in binary floating point.
    expect(wouldExceedTestCap(budget({ capUsd: 0.3, spentUsd: 0.1 }), 0.2)).toBe(false);
    expect(wouldExceedTestCap(budget({ capUsd: 0.3, spentUsd: 0.1 }), 0.2001)).toBe(true);
  });

  it("TST-1 a cap of 0 means no cap and never exceeds", () => {
    expect(wouldExceedTestCap(budget({ capUsd: 0, spentUsd: 0 }), 1_000_000)).toBe(false);
    expect(wouldExceedTestCap(budget({ capUsd: 0, spentUsd: 99 }), 99)).toBe(false);
  });

  it("TST-1 applyTestSpend returns a new frozen object and leaves the input unchanged", () => {
    const before = Object.freeze(budget());
    const after = applyTestSpend(before, 0.02);
    expect(after).not.toBe(before);
    expect(after).toMatchObject({ capUsd: 0.5, day: "2026-10-16" });
    expect(after.spentUsd).toBeCloseTo(0.47, 10);
    expect(Object.isFrozen(after)).toBe(true);
    expect(before).toEqual({ capUsd: 0.5, spentUsd: 0.45, day: "2026-10-16" });
  });

  it("TST-1 rollDay keeps the spend on the same day and resets it on a later day", () => {
    const same = rollDay(budget(), "2026-10-16");
    expect(same).toEqual(budget());
    expect(Object.isFrozen(same)).toBe(true);
    const later = rollDay(budget(), "2026-10-17");
    expect(later).toEqual({ capUsd: 0.5, spentUsd: 0, day: "2026-10-17" });
    expect(Object.isFrozen(later)).toBe(true);
  });

  it("TST-1 rollDay never rolls backwards: an earlier day (clock skew) is not a free reset", () => {
    expect(rollDay(budget(), "2026-10-15")).toEqual(budget());
  });

  it("TST-1 rollDay leaves its input unchanged", () => {
    const before = Object.freeze(budget());
    rollDay(before, "2026-10-17");
    expect(before).toEqual(budget());
  });

  it("TST-1 remainingTestUsd is what is left and never negative", () => {
    expect(remainingTestUsd(budget())).toBeCloseTo(0.05, 10);
    expect(remainingTestUsd(budget({ spentUsd: 0.5 }))).toBe(0);
    expect(remainingTestUsd(budget({ spentUsd: 0.9 }))).toBe(0);
  });

  it("TST-1 remainingTestUsd is unbounded when there is no cap", () => {
    expect(remainingTestUsd(budget({ capUsd: 0, spentUsd: 12 }))).toBe(Number.POSITIVE_INFINITY);
  });

  it("TST-1 TestRunBudgetSchema accepts a valid budget and rejects negatives and malformed days", () => {
    expect(TestRunBudgetSchema.safeParse(budget()).success).toBe(true);
    expect(TestRunBudgetSchema.safeParse(budget({ capUsd: 0, spentUsd: 0 })).success).toBe(true);
    expect(TestRunBudgetSchema.safeParse(budget({ capUsd: -1 })).success).toBe(false);
    expect(TestRunBudgetSchema.safeParse(budget({ spentUsd: -0.01 })).success).toBe(false);
    expect(TestRunBudgetSchema.safeParse(budget({ day: "16/10/2026" })).success).toBe(false);
    expect(TestRunBudgetSchema.safeParse(budget({ day: "2026-10-16T00:00:00Z" })).success).toBe(false);
    expect(TestRunBudgetSchema.safeParse(budget({ spentUsd: Number.NaN })).success).toBe(false);
  });
});
