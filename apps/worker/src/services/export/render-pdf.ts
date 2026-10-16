import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { assertRenderable, markdownBlocks, type Block } from "./markdown-blocks";

export { ExportRenderError, RENDER_MAX_MARKDOWN_BYTES } from "./markdown-blocks";

/**
 * MEM-2 (D6-4): an artifact's markdown as a PDF, pure JS (`pdf-lib`, the
 * built-in Helvetica and Courier; no browser in the worker image): headings,
 * paragraphs, lists, quotes, code, tables and rules, wrapped and broken into
 * A4 pages, at most `PDF_MAX_PAGES`. The built-in fonts speak WinAnsi only:
 * letters outside it fold to ASCII where they can (ş → s) and become "?"
 * otherwise; the exact text is always the `.md` next to the PDF.
 */
export const PDF_MAX_PAGES = 200;

const A4 = { width: 595.28, height: 841.89 } as const;
const MARGIN = 56;
const BODY = 11;
const CODE = 9;
const HEADING_SIZES = [20, 16, 13.5, 12, 11.5, 11] as const;
const LEADING = 1.4;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.4, 0.4, 0.45);
const CODE_BG = rgb(0.95, 0.95, 0.96);

interface Fonts {
  readonly regular: PDFFont;
  readonly bold: PDFFont;
  readonly italic: PDFFont;
  readonly mono: PDFFont;
}

/** Letters WinAnsi lacks that NFKD does not fold. */
const FOLD: Readonly<Record<string, string>> = Object.freeze({ ı: "i", ł: "l", Ł: "L", đ: "d", Đ: "D", "→": "->", "←": "<-", "≤": "<=", "≥": ">=", "≠": "!=", " ": " ", " ": " " });

/** Maps text onto what the standard fonts can encode, one code point at a time (cached per render). */
function winAnsi(font: PDFFont): (text: string) => string {
  const cache = new Map<string, string>();
  const encodes = (ch: string): boolean => {
    try {
      font.encodeText(ch);
      return true;
    } catch {
      return false;
    }
  };
  const one = (ch: string): string => {
    const hit = cache.get(ch);
    if (hit !== undefined) return hit;
    const folded = FOLD[ch] ?? ch.normalize("NFKD").replace(/\p{M}/gu, "");
    const out = encodes(ch) ? ch : folded !== "" && encodes(folded) ? folded : "?";
    cache.set(ch, out);
    return out;
  };
  return (text) => Array.from(text, one).join("");
}

/** Splits text into lines no wider than `width`; a word longer than a line is broken by characters. */
function wrap(text: string, font: PDFFont, size: number, width: number): readonly string[] {
  const fits = (s: string): boolean => font.widthOfTextAtSize(s, size) <= width;
  const lines: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = "";
    let rest = word;
    while (!fits(rest)) {
      let cut = rest.length - 1;
      while (cut > 1 && !fits(rest.slice(0, cut))) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    current = rest;
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/** Monospace lines are cut, never re-flowed: Courier is 0.6 em wide. */
const chop = (line: string, size: number, width: number): readonly string[] => {
  const per = Math.max(1, Math.floor(width / (0.6 * size)));
  const out: string[] = [];
  for (let i = 0; i < Math.max(line.length, 1); i += per) out.push(line.slice(i, i + per));
  return out;
};

/** The page cursor: draws top to bottom, opens a page when one is full, stops at the cap. */
class PdfLayout {
  private page: PDFPage;
  private y: number;
  truncated = false;

  constructor(
    private readonly doc: PDFDocument,
    readonly fonts: Fonts,
    readonly encode: (text: string) => string,
  ) {
    this.page = doc.addPage([A4.width, A4.height]);
    this.y = A4.height - MARGIN;
  }

  readonly width = A4.width - 2 * MARGIN;

  /** Room for `height` points on this page, or a new page; false (and the note) when the cap is reached. */
  private room(height: number): boolean {
    if (this.truncated) return false;
    if (this.y - height >= MARGIN) return true;
    if (this.doc.getPageCount() >= PDF_MAX_PAGES) {
      this.truncated = true;
      this.page.drawText(this.encode(`... truncated at ${PDF_MAX_PAGES} pages; the markdown file in this export is complete.`), { x: MARGIN, y: MARGIN - 18, size: 9, font: this.fonts.italic, color: MUTED });
      return false;
    }
    this.page = this.doc.addPage([A4.width, A4.height]);
    this.y = A4.height - MARGIN;
    return true;
  }

  line(text: string, font: PDFFont, size: number, indent = 0, color: RGB = INK, background: RGB | null = null): void {
    const height = size * LEADING;
    if (!this.room(height)) return;
    this.y -= height;
    if (background) this.page.drawRectangle({ x: MARGIN + indent - 4, y: this.y - size * 0.3, width: this.width - indent + 8, height, color: background });
    this.page.drawText(this.encode(text), { x: MARGIN + indent, y: this.y, size, font, color });
  }

  /** A marker (bullet, number) in the gutter, then the wrapped text. */
  item(marker: string, text: string, indent: number): void {
    const lines = wrap(this.encode(text), this.fonts.regular, BODY, this.width - indent);
    lines.forEach((l, i) => {
      if (i === 0 && this.room(BODY * LEADING)) this.page.drawText(this.encode(marker), { x: MARGIN + indent - 12, y: this.y - BODY * LEADING, size: BODY, font: this.fonts.regular, color: INK });
      this.line(l, this.fonts.regular, BODY, indent);
    });
  }

  gap(points: number): void {
    if (!this.truncated) this.y -= points;
  }

  rule(): void {
    if (!this.room(12)) return;
    this.y -= 6;
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: A4.width - MARGIN, y: this.y }, thickness: 0.5, color: MUTED });
    this.y -= 6;
  }
}

function drawBlock(layout: PdfLayout, block: Block): void {
  const { fonts } = layout;
  switch (block.type) {
    case "heading": {
      const size = HEADING_SIZES[block.level - 1] ?? BODY;
      layout.gap(size * 0.6);
      for (const l of wrap(layout.encode(block.text), fonts.bold, size, layout.width)) layout.line(l, fonts.bold, size);
      return layout.gap(4);
    }
    case "paragraph":
      for (const l of wrap(layout.encode(block.text), fonts.regular, BODY, layout.width)) layout.line(l, fonts.regular, BODY);
      return layout.gap(6);
    case "bullet":
      return layout.item("•", block.text, 16 + block.depth * 14);
    case "number":
      return layout.item(`${block.n}.`, block.text, 18 + block.depth * 14);
    case "quote":
      for (const l of wrap(layout.encode(block.text), fonts.italic, BODY, layout.width - 16)) layout.line(l, fonts.italic, BODY, 16, MUTED);
      return layout.gap(6);
    case "code":
    case "table": {
      const rows = block.type === "code" ? block.lines : block.rows.map((cells) => cells.join(" | "));
      layout.gap(2);
      for (const row of rows) for (const l of chop(row, CODE, layout.width)) layout.line(l, fonts.mono, CODE, 0, INK, CODE_BG);
      return layout.gap(8);
    }
    case "rule":
      return layout.rule();
  }
}

/** The markdown as PDF bytes; refuses a markdown above 5 MB, stops at 200 pages with a note on the last one. */
export async function renderPdf(markdown: string, opts: { readonly title: string }): Promise<Uint8Array> {
  assertRenderable(markdown);
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    mono: await doc.embedFont(StandardFonts.Courier),
  };
  doc.setTitle(opts.title);
  doc.setAuthor("North");
  doc.setCreator("North");
  doc.setProducer("North export (pdf-lib)");
  const layout = new PdfLayout(doc, fonts, winAnsi(fonts.regular));
  for (const block of markdownBlocks(markdown)) {
    drawBlock(layout, block);
    if (layout.truncated) break;
  }
  return doc.save();
}
