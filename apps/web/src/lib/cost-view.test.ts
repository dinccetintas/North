import { describe, expect, it } from "vitest";
import { COST_BAR_DAYS, costRow, formatCostUsd, formatTokens, lastDays } from "./cost-view";

const now = new Date("2026-10-20T12:00:00.000Z");
const company = { id: "c1", name: "Acme" };
const summary = {
  runs: 7,
  inputTokens: 1200,
  outputTokens: 300,
  costUsd: 0,
  byRole: [
    { role: "research", runs: 3, costUsd: 0 },
    { role: "engineering", runs: 4, costUsd: 0 },
  ],
  byDay: [
    { day: "2026-10-19", runs: 3, costUsd: 0 },
    { day: "2026-10-20", runs: 4, costUsd: 0 },
  ],
};

describe("OBS-1 cost view", () => {
  it("formats USD with two decimals and tokens in k/M", () => {
    expect(formatCostUsd(0)).toBe("$0.00");
    expect(formatCostUsd(1234.5)).toBe("$1,234.50");
    expect(formatCostUsd(0.004)).toBe("$0.00");
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1500)).toBe("1.5k");
    expect(formatTokens(2_400_000)).toBe("2.4M");
  });

  it("lists the last seven days ending today in the owner's zone, oldest first", () => {
    const days = lastDays(COST_BAR_DAYS, now);
    expect(days).toHaveLength(7);
    expect(days[0]).toBe("2026-10-14");
    expect(days[6]).toBe("2026-10-20");
    // 12:00 UTC is already the next day at UTC+14 and still the same day in Istanbul.
    expect(lastDays(COST_BAR_DAYS, now, "Pacific/Kiritimati")[6]).toBe("2026-10-21");
    expect(lastDays(COST_BAR_DAYS, now, "Europe/Istanbul")[6]).toBe("2026-10-20");
    expect(lastDays(COST_BAR_DAYS, new Date("2026-10-20T23:30:00.000Z"), "Pacific/Pago_Pago")[6]).toBe("2026-10-20");
  });

  it("aggregates runs, tokens and total; mock runs cost $0.00 and the bars fall back to runs", () => {
    const row = costRow(company, summary, now);
    expect(row).toMatchObject({ companyId: "c1", companyName: "Acme", runs: 7, tokens: 1500, tokensLabel: "1.5k", totalLabel: "$0.00" });
    expect(row.byRole.map((r) => [r.role, r.label, r.runs, r.costLabel])).toEqual([
      ["engineering", "Engineering", 4, "$0.00"],
      ["research", "Research", 3, "$0.00"],
    ]);
    expect(row.byDay).toHaveLength(7);
    expect(row.byDay.map((d) => d.runs)).toEqual([0, 0, 0, 0, 0, 3, 4]);
    expect(row.byDay[6]).toEqual({ day: "2026-10-20", runs: 4, costLabel: "$0.00", percent: 100 });
    expect(row.byDay[5]?.percent).toBe(75);
    expect(row.byDay[0]?.percent).toBe(0);
  });

  it("bars follow cost when something was paid, and roles sort by cost first", () => {
    const paid = { ...summary, costUsd: 1.5, byRole: [{ role: "research", runs: 1, costUsd: 0.5 }, { role: "growth", runs: 1, costUsd: 1 }], byDay: [{ day: "2026-10-20", runs: 1, costUsd: 1.5 }, { day: "2026-10-18", runs: 5, costUsd: 0.75 }] };
    const row = costRow(company, paid, now);
    expect(row.totalLabel).toBe("$1.50");
    expect(row.byRole.map((r) => r.role)).toEqual(["growth", "research"]);
    expect(row.byDay[6]?.percent).toBe(100);
    expect(row.byDay[4]?.percent).toBe(50);
    expect(row.byDay[4]?.costLabel).toBe("$0.75");
  });

  it("an empty summary renders zeros without a bar", () => {
    const row = costRow(company, { runs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, byRole: [], byDay: [] }, now);
    expect(row).toMatchObject({ runs: 0, tokens: 0, tokensLabel: "0", totalLabel: "$0.00", byRole: [] });
    expect(row.byDay.every((d) => d.percent === 0 && d.runs === 0)).toBe(true);
  });
});
