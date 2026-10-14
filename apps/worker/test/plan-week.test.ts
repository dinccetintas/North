import { describe, expect, it } from "vitest";
import { weekStartOf } from "../src/services/plan-week";
import { ONBOARDING_TASKS } from "../src/services/onboard";
import { TASK_OWNER } from "@north/core";

describe("weekStartOf", () => {
  it("returns the Monday of the week in UTC", () => {
    expect(weekStartOf(new Date("2026-10-14T18:00:00Z"))).toBe("2026-10-12"); // Wednesday → Monday
    expect(weekStartOf(new Date("2026-10-12T00:00:00Z"))).toBe("2026-10-12"); // Monday stays
    expect(weekStartOf(new Date("2026-10-18T23:59:59Z"))).toBe("2026-10-12"); // Sunday belongs to the week before
  });
});

describe("ONBOARDING_TASKS", () => {
  it("runs research before strategy and only K0 roles", () => {
    const roles = ONBOARDING_TASKS.map((t) => TASK_OWNER[t.taskType]);
    expect(roles.slice(0, 3).every((r) => r === "research")).toBe(true);
    expect(roles.slice(3).every((r) => r === "strategy_product")).toBe(true);
    expect(ONBOARDING_TASKS).toHaveLength(6);
  });
});
