import { describe, expect, it } from "vitest";
import { STOPPED_MESSAGE, answerRefusal } from "./kill-switch-guard";

/** M4 review H4: while the company's kill switch is on, no card may be answered (the worker would perform the approved action on resume). */
describe("answerRefusal", () => {
  it("refuses with one fixed message while the kill switch is active, and allows otherwise", () => {
    expect(answerRefusal({ killSwitchActive: true })).toBe(STOPPED_MESSAGE);
    expect(answerRefusal({ killSwitchActive: false })).toBeNull();
    expect(answerRefusal(null)).toBeNull();
    expect(STOPPED_MESSAGE).toBe("Agents are stopped; resume to answer");
  });
});
