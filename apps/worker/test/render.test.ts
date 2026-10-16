import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { markdownBlocks, inlineText } from "../src/services/export/markdown-blocks";
import { ExportRenderError, PDF_MAX_PAGES, RENDER_MAX_MARKDOWN_BYTES, renderPdf } from "../src/services/export/render-pdf";
import { renderPptx } from "../src/services/export/render-pptx";
import { pdfText, slideCount, unzip } from "./export-readers";

/** MEM-2 (D6-4): every artifact downloads as the exact markdown plus a pure-JS PDF, and decks and plans as a PPTX. */

const EVERYTHING = [
  "# Heading One",
  "",
  "A paragraph with **bold**, _emphasis_, `code` and a [link](https://example.com/docs).",
  "It continues on a second line.",
  "",
  "## Second Heading",
  "",
  "- first bullet",
  "- second bullet",
  "  - nested bullet",
  "1. numbered one",
  "2. numbered two",
  "",
  "> A quoted line",
  "",
  "### Third level",
  "",
  "```ts",
  "function main(): void {",
  '  console.log("hi");',
  "}",
  "```",
  "",
  "| Metric | Value |",
  "| --- | --- |",
  "| signups | 42 |",
  "",
  "---",
  "",
  "Şirket Ağı İstanbul ırmak, café — “quotes” ✓ 日本",
  "",
].join("\n");

describe("markdownBlocks", () => {
  it("splits headings, paragraphs, lists, quotes, code, tables and rules", () => {
    const blocks = markdownBlocks(EVERYTHING);
    expect(blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "heading", "bullet", "bullet", "bullet", "number", "number", "quote", "heading", "code", "table", "rule", "paragraph"]);
    expect(blocks[0]).toEqual({ type: "heading", level: 1, text: "Heading One" });
    expect(blocks[1]).toMatchObject({ type: "paragraph", text: "A paragraph with bold, emphasis, code and a link (https://example.com/docs). It continues on a second line." });
    expect(blocks[5]).toMatchObject({ type: "bullet", depth: 1, text: "nested bullet" });
    expect(blocks[10]).toMatchObject({ type: "code", lines: ["function main(): void {", '  console.log("hi");', "}"] });
    expect(Object.isFrozen(blocks)).toBe(true);
  });

  it("keeps an unclosed fence as code and strips inline markup only", () => {
    expect(markdownBlocks("```\nlet x = 1")).toEqual([{ type: "code", lines: ["let x = 1"] }]);
    expect(inlineText("![logo](x.png) **a** __b__ ~~c~~")).toBe("[image: logo] a b c");
  });
});

describe("renderPdf (pdf-lib)", () => {
  it("a markdown with every element renders a PDF whose text contains the headings", async () => {
    const bytes = await renderPdf(EVERYTHING, { title: "Lumen PRD" });
    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getTitle()).toBe("Lumen PRD");
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
    const text = pdfText(bytes);
    for (const expected of ["Heading One", "Second Heading", "Third level", "first bullet", "nested bullet", "numbered two", "A quoted line", "function main(): void {", "signups", "https://example.com/docs"]) {
      expect(text, expected).toContain(expected);
    }
    // The built-in fonts speak WinAnsi only: Turkish letters fold to ASCII, the rest becomes "?"; the markdown file stays exact.
    expect(text).toContain("Sirket Agi Istanbul irmak, café — “quotes” ? ??");
  });

  it("breaks pages and stops at 200 pages with a note", async () => {
    const long = Array.from({ length: 12_000 }, (_, i) => `Line ${i} of a very long report that goes on.`).join("\n\n");
    const bytes = await renderPdf(long, { title: "Long" });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(PDF_MAX_PAGES);
    expect(pdfText(bytes)).toMatch(/truncated at 200 pages/);
  });

  it("refuses a markdown above 5 MB", async () => {
    const huge = "a".repeat(RENDER_MAX_MARKDOWN_BYTES + 1);
    await expect(renderPdf(huge, { title: "Huge" })).rejects.toBeInstanceOf(ExportRenderError);
    await expect(renderPdf(huge, { title: "Huge" })).rejects.toThrow(/5 MB/);
  });

  it("renders an empty-looking markdown as one page", async () => {
    const doc = await PDFDocument.load(await renderPdf("   \n", { title: "Empty" }));
    expect(doc.getPageCount()).toBe(1);
  });
});

describe("renderPptx (pptxgenjs)", () => {
  const deck = ["# Seed deck", "", "Bookkeeping for solo consultants.", "", "## Problem", "- Month end takes 3 days", "- Receipts get lost", "", "## Solution", "One click close.", "", "### Detail", "- Bank feeds", "", "## Market", "- 4M consultants", "", "## Ask", "- $500k pre-seed"].join("\n");

  it("a deck renders a title slide and one slide per H2 (N+1)", async () => {
    const bytes = await renderPptx(deck, { title: "Seed deck" });
    expect(slideCount(bytes)).toBe(5);
    const slides = unzip(bytes);
    const first = slides.get("ppt/slides/slide1.xml")?.toString("utf8") ?? "";
    expect(first).toContain("Seed deck");
    expect(first).toContain("Bookkeeping for solo consultants.");
    const problem = slides.get("ppt/slides/slide2.xml")?.toString("utf8") ?? "";
    expect(problem).toContain("Problem");
    expect(problem).toContain("Month end takes 3 days");
    const solution = slides.get("ppt/slides/slide3.xml")?.toString("utf8") ?? "";
    expect(solution).toContain("Bank feeds");
  });

  it("a markdown without H2 is one title slide; the size limit applies too", async () => {
    expect(slideCount(await renderPptx("Just a paragraph.", { title: "Plan" }))).toBe(1);
    await expect(renderPptx("a".repeat(RENDER_MAX_MARKDOWN_BYTES + 1), { title: "Huge" })).rejects.toBeInstanceOf(ExportRenderError);
  });
});
