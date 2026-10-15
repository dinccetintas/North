import { describe, expect, it } from "vitest";
import { campaignNameOf, splitRationale } from "./card-facts";

describe("card facts (DEC-2: the load-bearing facts of a card come from the gate's rationale tail)", () => {
  it("splits the gate's 'Details:' tail from the sentence", () => {
    const rationale = "This action spends money and says something new in public. Growth asks for it; tier K2. Details: $10/day, audience: founders, campaign: Acme launch test.";
    expect(splitRationale(rationale)).toEqual({
      summary: "This action spends money and says something new in public. Growth asks for it; tier K2.",
      facts: "$10/day, audience: founders, campaign: Acme launch test",
    });
  });

  it("keeps the cap card's facts verbatim ('spent $11 of $10 today')", () => {
    const rationale = "This action spends money. Growth asks for it; tier K2. Details: spent $11 of $10 today, campaign: Acme launch test.";
    expect(splitRationale(rationale).facts).toBe("spent $11 of $10 today, campaign: Acme launch test");
  });

  it("keeps a batch's recipient list including its commas", () => {
    const rationale = "This action contacts someone for the first time. Sales asks for it; tier K2. Details: 5 emails: a@example.test, b@example.test, +3.";
    expect(splitRationale(rationale).facts).toBe("5 emails: a@example.test, b@example.test, +3");
  });

  it("returns null facts when there is no tail, and survives a truncated rationale", () => {
    expect(splitRationale("This action goes live to customers. Engineering asks for it; tier K2.")).toEqual({
      summary: "This action goes live to customers. Engineering asks for it; tier K2.",
      facts: null,
    });
    expect(splitRationale("Short. Details: $5/day, audience: every…").facts).toBe("$5/day, audience: every…");
    expect(splitRationale("")).toEqual({ summary: "", facts: null });
  });

  it("reads the campaign name out of the facts (BUD-3 cap cards name their campaign)", () => {
    expect(campaignNameOf("spent $11 of $10 today, campaign: Acme launch test")).toBe("Acme launch test");
    expect(campaignNameOf("$10/day, audience: founders, campaign: Acme, with comma")).toBe("Acme, with comma");
    expect(campaignNameOf("$10/day, audience: founders")).toBeNull();
    expect(campaignNameOf(null)).toBeNull();
  });
});
