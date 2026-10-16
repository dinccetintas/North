// CMP-1: the sender's name, postal address and a way out, at the foot of every outreach email.
import { describe, expect, it } from "vitest";
import { FOOTER_MARKER, complianceFooter, hasComplianceFooter } from "../src/outreach/footer";
import type { SenderIdentity } from "../src/outreach/policy";

const IDENTITY: SenderIdentity = { legalName: "North Studio Ltd", postalAddress: "1 Example Street, Springfield 12345" };
const URL = "https://north.example/u/abc123";

describe("CMP-1 compliance footer", () => {
  it("states the legal name, the postal address, the unsubscribe word and the URL", () => {
    const footer = complianceFooter(IDENTITY, URL);
    expect(footer).toContain("North Studio Ltd");
    expect(footer).toContain("1 Example Street, Springfield 12345");
    expect(footer).toContain("unsubscribe");
    expect(footer).toContain(URL);
  });

  it("has the exact two-line shape", () => {
    expect(complianceFooter(IDENTITY, URL)).toBe(
      `North Studio Ltd, 1 Example Street, Springfield 12345\nReply "no" and I won't write again, or unsubscribe: ${URL}`,
    );
  });

  it("is separated from the body by the signature marker", () => {
    expect(FOOTER_MARKER).toBe("\n\n-- \n");
  });

  it("hasComplianceFooter is true for text ending in the footer", () => {
    const footer = complianceFooter(IDENTITY, URL);
    expect(hasComplianceFooter(`Hi Ada, a quick question.${FOOTER_MARKER}${footer}`)).toBe(true);
    expect(hasComplianceFooter(`${footer}\n`)).toBe(true);
    expect(hasComplianceFooter(`Hi${FOOTER_MARKER}${footer}\n\n`)).toBe(true);
  });

  it("hasComplianceFooter is false for text without it", () => {
    const footer = complianceFooter(IDENTITY, URL);
    expect(hasComplianceFooter("")).toBe(false);
    expect(hasComplianceFooter("Hi Ada, a quick question.")).toBe(false);
    expect(hasComplianceFooter(`Hi${FOOTER_MARKER}North Studio Ltd, 1 Example Street, Springfield 12345`)).toBe(false);
    expect(hasComplianceFooter(`Hi${FOOTER_MARKER}Reply "no" and I won't write again, or unsubscribe: ${URL}`)).toBe(false);
    expect(hasComplianceFooter(`Hi${FOOTER_MARKER}${footer}\nP.S. call me`)).toBe(false);
  });

  it("hasComplianceFooter only looks at what follows the last marker", () => {
    const footer = complianceFooter(IDENTITY, URL);
    expect(hasComplianceFooter(`Body${FOOTER_MARKER}${footer}${FOOTER_MARKER}Sent from my phone`)).toBe(false);
    expect(hasComplianceFooter(`Body${FOOTER_MARKER}ps${FOOTER_MARKER}${footer}`)).toBe(true);
  });

  it("an address on several lines still counts", () => {
    const multi = complianceFooter({ legalName: "North Ltd", postalAddress: "1 Example Street\nSpringfield 12345" }, URL);
    expect(hasComplianceFooter(`Hi${FOOTER_MARKER}${multi}`)).toBe(true);
  });
});
