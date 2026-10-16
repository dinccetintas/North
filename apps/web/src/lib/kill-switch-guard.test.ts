import { describe, expect, it } from "vitest";
import { ARCHIVED_MESSAGE, STOPPED_MESSAGE, SUBSCRIPTION_MESSAGE, answerRefusal, resumeRefusal } from "./kill-switch-guard";

/** M4 review H4: while the company's kill switch is on, no card may be answered (the worker would perform the approved action on resume). */
describe("answerRefusal", () => {
  it("refuses with one fixed message while the kill switch is active, and allows otherwise", () => {
    expect(answerRefusal({ killSwitchActive: true })).toBe(STOPPED_MESSAGE);
    expect(answerRefusal({ killSwitchActive: false })).toBeNull();
    expect(answerRefusal(null)).toBeNull();
    expect(STOPPED_MESSAGE).toBe("Agents are stopped; resume to answer");
  });

  it("M6: a billing pause names the way out instead of a resume the owner cannot press", () => {
    expect(answerRefusal({ killSwitchActive: true, pausedReason: "user" })).toBe(STOPPED_MESSAGE);
    expect(answerRefusal({ killSwitchActive: true, pausedReason: "subscription_ended" })).toBe(SUBSCRIPTION_MESSAGE);
    expect(answerRefusal({ killSwitchActive: true, pausedReason: "retention" })).toBe(ARCHIVED_MESSAGE);
  });
});

/** ADR 0014: only the owner's own pause is lifted by the owner; billing lifts its own when a subscription is active again. */
describe("resumeRefusal", () => {
  it("lets the owner lift their own pause and nothing else", () => {
    expect(resumeRefusal({ killSwitchActive: true, pausedReason: "user" })).toBeNull();
    expect(resumeRefusal({ killSwitchActive: true, pausedReason: null })).toBeNull();
    expect(resumeRefusal({ killSwitchActive: true, pausedReason: "subscription_ended" })).toBe(SUBSCRIPTION_MESSAGE);
    expect(resumeRefusal({ killSwitchActive: true, pausedReason: "retention" })).toBe(ARCHIVED_MESSAGE);
    expect(resumeRefusal(null)).toBeNull();
  });

  it("M6 review L3: refuses any resume, the owner's own pause included, while the owner's entitlement is ended (the database refuses it too)", () => {
    const ended = { status: "ended" as const };
    expect(resumeRefusal({ killSwitchActive: true, pausedReason: "user" }, ended)).toBe(SUBSCRIPTION_MESSAGE);
    expect(resumeRefusal({ killSwitchActive: true, pausedReason: null }, ended)).toBe(SUBSCRIPTION_MESSAGE);
    expect(resumeRefusal({ killSwitchActive: true, pausedReason: "retention" }, ended)).toBe(ARCHIVED_MESSAGE);
    for (const status of ["trialing", "active", "canceled", "past_due"] as const) expect(resumeRefusal({ killSwitchActive: true, pausedReason: "user" }, { status })).toBeNull();
    expect(resumeRefusal({ killSwitchActive: true, pausedReason: "user" }, null)).toBeNull();
    expect(SUBSCRIPTION_MESSAGE).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});
