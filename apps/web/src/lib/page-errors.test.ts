import { describe, expect, it } from "vitest";
import { errorText, GENERIC_ERROR, PAGE_ERRORS, withError, type ErrorPage } from "./page-errors";

/**
 * M6 review L8: `?error=` carries a code that each page maps to its own fixed
 * line; free text in the URL is never rendered, so a crafted link cannot put
 * its words in North's alert box.
 */

describe("page error codes (M6 review L8)", () => {
  it("maps each page's codes to fixed messages", () => {
    expect(errorText("billing", "start-failed")).toBe("Billing could not start. Try again in a minute.");
    expect(errorText("billing", "unknown-plan")).toBe("Unknown plan.");
    expect(errorText("billing", "unknown-pack")).toBe("Unknown credit pack.");
    expect(errorText("export", "choose-kind")).toBe("Choose what to export.");
    expect(errorText("export", "request-failed")).toBe("The export could not be requested. Try again in a minute.");
    expect(errorText("export", "unknown-export")).toBe("Unknown export.");
    expect(errorText("export", "unavailable")).toBe("This export is not available any more. Request a new one.");
    expect(errorText("login", "link-invalid")).toBe("That link is invalid or expired.");
    expect(errorText("onboarding", "goal-invalid")).toBe("Pick a metric, a target above zero and a due date.");
  });

  it("shows the generic line for free text, another page's code, an array or a prototype key; nothing without a code", () => {
    const phishing = "Your card was declined. Re-enter it at https://evil.example";
    expect(errorText("billing", phishing)).toBe(GENERIC_ERROR);
    expect(errorText("export", "start-failed")).toBe(GENERIC_ERROR);
    expect(errorText("billing", ["start-failed", "unknown-plan"])).toBe(GENERIC_ERROR);
    for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) expect(errorText("login", key)).toBe(GENERIC_ERROR);
    expect(errorText("billing", undefined)).toBeNull();
    expect(errorText("billing", "")).toBeNull();
    expect(GENERIC_ERROR).not.toContain("http");
  });

  it("every message is fixed text: no URL, no markup, under 200 characters; codes are short slugs", () => {
    for (const page of Object.keys(PAGE_ERRORS) as ErrorPage[]) {
      for (const [code, message] of Object.entries(PAGE_ERRORS[page])) {
        expect(code).toMatch(/^[a-z][a-z-]{1,40}$/);
        expect(message.length).toBeLessThan(200);
        expect(message).not.toMatch(/https?:|<|>/);
      }
    }
  });

  it("builds the redirect with the code only, keeping the path's own query", () => {
    expect(withError("/settings/billing", "billing", "start-failed")).toBe("/settings/billing?error=start-failed");
    expect(withError("/c/acme/public", "publicPage", "save-failed")).toBe("/c/acme/public?error=save-failed");
    expect(withError("/login?next=%2Fc%2Fa", "login", "link-failed")).toBe("/login?next=%2Fc%2Fa&error=link-failed");
  });
});
