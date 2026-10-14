import { describe, expect, it } from "vitest";
import { suggestAutoRule } from "../src/decisions/autorule";
import type { AnsweredCard } from "../src/decisions/types";

const answered = (i: number, over: Partial<AnsweredCard> = {}): AnsweredCard => ({
  actionKind: "ads.start",
  mergeKey: "ads.start:ads",
  answeredOptionId: "approve",
  answeredAt: `2026-10-1${i}T09:00:00.000Z`,
  costUsd: 10 * i,
  ...over,
});

describe("DEC-3 suggestAutoRule(): three identical answers in a row", () => {
  it("suggests a rule after three identical approvals with the max cost as ceiling", () => {
    const suggestion = suggestAutoRule([answered(1), answered(2), answered(3)]);
    expect(suggestion).toMatchObject({ kind: "ads.start", optionId: "approve", maxAmountUsd: 30, category: "ads" });
  });

  it("returns null with fewer than three answers or a mixed history", () => {
    expect(suggestAutoRule([answered(1), answered(2)])).toBeNull();
    expect(suggestAutoRule([answered(1), answered(2, { answeredOptionId: "decline" }), answered(3)])).toBeNull();
    expect(suggestAutoRule([answered(1), answered(2, { actionKind: "social.publish" }), answered(3)])).toBeNull();
  });

  it("never suggests auto-declining", () => {
    expect(suggestAutoRule([1, 2, 3].map((i) => answered(i, { answeredOptionId: "decline" })))).toBeNull();
  });

  it("only looks at the three most recent answers", () => {
    const history = [answered(1, { answeredOptionId: "decline" }), answered(2), answered(3), answered(4)];
    expect(suggestAutoRule(history)).not.toBeNull();
  });
});
