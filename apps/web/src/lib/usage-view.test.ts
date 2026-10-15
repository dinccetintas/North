import { describe, expect, it } from "vitest";
import { USAGE_ALERT_RATIO } from "@north/core/billing/plans";
import { percentLabel, usageView } from "./usage-view";

const USER = "00000000-0000-4000-8000-000000000001";
const usage = (llmCostUsd: number, sandboxMinutes = 0) => ({ userId: USER, period: "2026-10", creditsUsed: 12, llmCostUsd, sandboxMinutes, alertedAt: null });

describe("BIL-2 usage panel: cost against the plan price with the 40 % line", () => {
  it("adds inference and sandbox cost and divides by the price", () => {
    const view = usageView(usage(100, 600), 299);
    expect(view.inference).toBe("$100.00");
    expect(view.sandbox).toBe("$6.00");
    expect(view.total).toBe("$106.00");
    expect(view.price).toBe("$299.00");
    expect(view.ratio).toBeCloseTo(0.355, 3);
    expect(view.ratioLabel).toBe("35 %");
    expect(view.alert).toBe(false);
    expect(view.alertCopy).toBeNull();
    expect(view.runs).toBe(12);
  });

  it("raises the alert at the line: $120 on $299 is 40 % and names the share", () => {
    const view = usageView(usage(120), 299);
    expect(view.ratio).toBe(0.401);
    expect(view.alert).toBe(true);
    expect(view.alertCopy).toBe("Agents used 40 % of your plan price this month");
    expect(view.markPercent).toBe(USAGE_ALERT_RATIO * 100);
  });

  it("caps the bar at 100 % while the label keeps the real share", () => {
    const view = usageView(usage(450), 299);
    expect(view.barPercent).toBe(100);
    expect(view.ratioLabel).toBe("150 %");
  });

  it("reads zero for a trial without a price and for a month without runs", () => {
    const trial = usageView(usage(5), 0);
    expect(trial.ratio).toBe(0);
    expect(trial.alert).toBe(false);
    expect(trial.price).toBe("$0.00");
    expect(trial.noPrice).toBe(true);
    const empty = usageView(null, 99);
    expect(empty.total).toBe("$0.00");
    expect(empty.runs).toBe(0);
    expect(empty.barPercent).toBe(0);
  });

  it("formats a share as whole percent with a thin space", () => {
    expect(percentLabel(0.42)).toBe("42 %");
    expect(percentLabel(0)).toBe("0 %");
    expect(percentLabel(0.4049)).toBe("40 %");
  });
});
