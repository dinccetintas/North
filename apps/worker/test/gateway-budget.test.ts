import { describe, expect, it } from "vitest";
import { GatewayBudget } from "../src/gateway/budget";

/**
 * TST-1: the gateway's day cap is bookkeeping over `TestRunBudget`. The day
 * comes from the injected clock (UTC), never from the process.
 */

const at = (iso: string) => () => new Date(iso);

describe("TST-1 GatewayBudget", () => {
  it("starts empty on the clock's UTC day", () => {
    const budget = new GatewayBudget(5, at("2026-10-16T23:59:59.999Z"));
    expect(budget.state).toEqual({ capUsd: 5, spentUsd: 0, day: "2026-10-16" });
    expect(budget.stats()).toEqual({ capUsd: 5, spentUsd: 0, unpriced: 0, day: "2026-10-16" });
  });

  it("settle adds to the day's spend with a new frozen state each time", () => {
    const budget = new GatewayBudget(5, at("2026-10-16T10:00:00Z"));
    const first = budget.state;
    budget.settle(1.25);
    const second = budget.state;
    budget.settle(0.5);
    expect(first.spentUsd).toBe(0);
    expect(second.spentUsd).toBe(1.25);
    expect(budget.state.spentUsd).toBe(1.75);
    expect(first).not.toBe(second);
    expect(Object.isFrozen(budget.state)).toBe(true);
  });

  it("reserve says whether an estimate fits and never mutates", () => {
    const budget = new GatewayBudget(1, at("2026-10-16T10:00:00Z"));
    budget.settle(0.6);
    const before = budget.state;
    expect(budget.reserve(0.4)).toBe(true); // landing exactly on the cap is allowed
    expect(budget.reserve(0.41)).toBe(false);
    expect(budget.reserve(0)).toBe(true);
    expect(budget.state).toEqual(before);
    expect(budget.stats().spentUsd).toBe(0.6);
  });

  it("reserve(0) is false once the day's spend has reached the cap: nothing is left to spend", () => {
    const budget = new GatewayBudget(1, at("2026-10-16T10:00:00Z"));
    budget.settle(1);
    expect(budget.reserve(0)).toBe(false);
    expect(budget.reserve(0.01)).toBe(false);
    const over = new GatewayBudget(1, at("2026-10-16T10:00:00Z"));
    over.settle(1.7);
    expect(over.reserve(0)).toBe(false);
  });

  it("a cap of 0 means unlimited", () => {
    const budget = new GatewayBudget(0, at("2026-10-16T10:00:00Z"));
    budget.settle(1_000_000);
    expect(budget.reserve(0)).toBe(true);
    expect(budget.reserve(1e12)).toBe(true);
    expect(budget.stats().spentUsd).toBe(1_000_000);
  });

  it("settling NaN counts as unpriced and adds nothing; so does any spend that is not a cost", () => {
    const budget = new GatewayBudget(5, at("2026-10-16T10:00:00Z"));
    budget.settle(Number.NaN);
    budget.settle(-3);
    budget.settle(Number.POSITIVE_INFINITY);
    budget.settle(0.25);
    expect(budget.stats()).toEqual({ capUsd: 5, spentUsd: 0.25, unpriced: 3, day: "2026-10-16" });
  });

  it("an estimate that is not a non-negative number is refused", () => {
    const budget = new GatewayBudget(5, at("2026-10-16T10:00:00Z"));
    expect(budget.reserve(Number.NaN)).toBe(false);
    expect(budget.reserve(-1)).toBe(false);
    expect(budget.reserve(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it("rolls to a new day on every call, resetting the spend", () => {
    let now = new Date("2026-10-16T23:59:00Z");
    const budget = new GatewayBudget(1, () => now);
    budget.settle(1);
    expect(budget.reserve(0)).toBe(false);
    now = new Date("2026-10-17T00:00:00Z");
    expect(budget.reserve(0)).toBe(true);
    expect(budget.state).toEqual({ capUsd: 1, spentUsd: 0, day: "2026-10-17" });
    budget.settle(0.2);
    expect(budget.stats()).toMatchObject({ spentUsd: 0.2, day: "2026-10-17" });
  });

  it("settle on a new day lands in the new day", () => {
    let now = new Date("2026-10-16T23:59:59Z");
    const budget = new GatewayBudget(1, () => now);
    budget.settle(0.9);
    now = new Date("2026-10-17T00:00:01Z");
    budget.settle(0.3);
    expect(budget.state).toEqual({ capUsd: 1, spentUsd: 0.3, day: "2026-10-17" });
  });

  it("a clock that steps back keeps the spend instead of handing out a second allowance", () => {
    let now = new Date("2026-10-17T10:00:00Z");
    const budget = new GatewayBudget(1, () => now);
    budget.settle(1);
    now = new Date("2026-10-16T10:00:00Z");
    expect(budget.reserve(0)).toBe(false);
    expect(budget.state).toEqual({ capUsd: 1, spentUsd: 1, day: "2026-10-17" });
  });

  it("keeps the unpriced count across days", () => {
    let now = new Date("2026-10-16T10:00:00Z");
    const budget = new GatewayBudget(1, () => now);
    budget.settle(Number.NaN);
    now = new Date("2026-10-17T10:00:00Z");
    expect(budget.stats().unpriced).toBe(1);
  });

  it("defaults to the real clock", () => {
    const budget = new GatewayBudget(0);
    expect(budget.state.day).toBe(new Date().toISOString().slice(0, 10));
  });

  it("rejects a cap that is negative or not a number", () => {
    expect(() => new GatewayBudget(-1)).toThrow(/cap/i);
    expect(() => new GatewayBudget(Number.NaN)).toThrow(/cap/i);
    expect(() => new GatewayBudget(Number.POSITIVE_INFINITY)).toThrow(/cap/i);
  });

  it("settleUnpriced adds the estimate to the spend and counts it as unpriced", () => {
    const budget = new GatewayBudget(5, at("2026-10-16T10:00:00Z"));
    budget.settleUnpriced(0.75);
    budget.settleUnpriced(Number.NaN);
    budget.settleUnpriced(-1);
    expect(budget.stats()).toEqual({ capUsd: 5, spentUsd: 0.75, unpriced: 3, day: "2026-10-16" });
  });

  it("exhaust closes the day under a cap: the spend jumps to the cap, reserve(0) is false, and the reason is kept", () => {
    const budget = new GatewayBudget(5, at("2026-10-16T10:00:00Z"));
    budget.settle(1);
    expect(budget.exhaustion()).toBeNull();
    expect(budget.exhaust("no usage")).toBe(true);
    expect(budget.state).toEqual({ capUsd: 5, spentUsd: 5, day: "2026-10-16" });
    expect(budget.reserve(0)).toBe(false);
    expect(budget.exhaustion()).toBe("no usage");
    expect(budget.stats().unpriced).toBe(1);
    // A second call during the same day changes nothing and says it was already closed.
    expect(budget.exhaust("again")).toBe(false);
    expect(budget.exhaustion()).toBe("no usage");
    expect(budget.stats().unpriced).toBe(2);
  });

  it("exhaust never lowers a spend that is already over the cap", () => {
    const budget = new GatewayBudget(1, at("2026-10-16T10:00:00Z"));
    budget.settle(3);
    budget.exhaust("x");
    expect(budget.state.spentUsd).toBe(3);
  });

  it("exhaust ends with the UTC day", () => {
    let now = new Date("2026-10-16T23:59:00Z");
    const budget = new GatewayBudget(5, () => now);
    budget.exhaust("x");
    now = new Date("2026-10-17T00:00:00Z");
    expect(budget.exhaustion()).toBeNull();
    expect(budget.reserve(0)).toBe(true);
    expect(budget.state.spentUsd).toBe(0);
  });

  it("with no cap, exhaust only counts", () => {
    const budget = new GatewayBudget(0, at("2026-10-16T10:00:00Z"));
    expect(budget.exhaust("no usage")).toBe(false);
    expect(budget.exhaustion()).toBeNull();
    expect(budget.reserve(0)).toBe(true);
    expect(budget.stats()).toMatchObject({ spentUsd: 0, unpriced: 1 });
  });
});
