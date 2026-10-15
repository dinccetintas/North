import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DRAFT_LINE, isLegalDoc, LEGAL_DOCS, parseLegal } from "./legal";

const source = (doc: string): string => readFileSync(new URL(`../../content/legal/${doc}.md`, import.meta.url), "utf8");

describe("LEG-1 legal placeholders", () => {
  it("splits the draft line off and keeps the body", () => {
    const parsed = parseLegal("terms", `${DRAFT_LINE}\n\n# Terms\n\nText.`);
    expect(parsed).toEqual({ doc: "terms", title: "Terms of service", draft: true, body: "# Terms\n\nText." });
    expect(parseLegal("privacy", "# Privacy\n").draft).toBe(false);
  });

  it("knows the three documents and nothing else", () => {
    expect(LEGAL_DOCS).toEqual(["terms", "privacy", "acceptable-use"]);
    expect(isLegalDoc("terms")).toBe(true);
    expect(isLegalDoc("../secrets")).toBe(false);
  });

  it("every document is a draft with the three placeholders", () => {
    for (const doc of LEGAL_DOCS) {
      const text = source(doc);
      expect(parseLegal(doc, text).draft).toBe(true);
      for (const placeholder of ["[operating entity]", "[jurisdiction]", "[contact address]"]) expect(text).toContain(placeholder);
    }
  });

  it("the acceptable-use policy names the platform rules", () => {
    const text = source("acceptable-use").toLowerCase();
    for (const rule of ["no spam", "no fake accounts", "no posting on the user's behalf", "ads and email under platform policies"]) expect(text).toContain(rule);
  });
});
