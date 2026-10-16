import PptxGenJS from "pptxgenjs";
import { assertRenderable, markdownBlocks, type Block } from "./markdown-blocks";

/**
 * MEM-2 (D6-4): an investor deck or a plan as slides (`pptxgenjs`): a title
 * slide (the artifact's title and the opening paragraph) and one slide per H2
 * with its content as bullets. Text only; layouts and images are not promised
 * (ADR 0016). At most `PPTX_MAX_SLIDES` slides, `SLIDE_MAX_ITEMS` lines each.
 */
export const PPTX_MAX_SLIDES = 100;
const SLIDE_MAX_ITEMS = 14;
const ITEM_MAX_CHARS = 280;
const CODE_MAX_LINES = 8;

type TextItem = PptxGenJS.TextProps;

interface Section {
  readonly title: string;
  readonly blocks: readonly Block[];
}

const clip = (text: string): string => (text.length > ITEM_MAX_CHARS ? `${text.slice(0, ITEM_MAX_CHARS - 1)}…` : text);

/** One block as zero or more slide lines. */
function itemsOf(block: Block): readonly TextItem[] {
  switch (block.type) {
    case "heading":
      return [{ text: clip(block.text), options: { bold: true, breakLine: true } }];
    case "paragraph":
      return [{ text: clip(block.text), options: { breakLine: true } }];
    case "bullet":
      return [{ text: clip(block.text), options: { bullet: true, indentLevel: block.depth, breakLine: true } }];
    case "number":
      return [{ text: clip(block.text), options: { bullet: { type: "number" }, indentLevel: block.depth, breakLine: true } }];
    case "quote":
      return [{ text: clip(block.text), options: { italic: true, breakLine: true } }];
    case "code":
      return block.lines.slice(0, CODE_MAX_LINES).map((line) => ({ text: clip(line || " "), options: { fontFace: "Courier New", fontSize: 12, breakLine: true } }));
    case "table":
      return block.rows.map((cells) => ({ text: clip(cells.join("  |  ")), options: { fontFace: "Courier New", fontSize: 12, breakLine: true } }));
    case "rule":
      return [];
  }
}

/** The blocks before the first H2 (the title slide) and one section per H2. */
function sectionsOf(blocks: readonly Block[]): { readonly intro: readonly Block[]; readonly sections: readonly Section[] } {
  const intro: Block[] = [];
  const sections: { title: string; blocks: Block[] }[] = [];
  for (const block of blocks) {
    if (block.type === "heading" && block.level === 2) sections.push({ title: block.text, blocks: [] });
    else if (sections.length > 0) sections[sections.length - 1]?.blocks.push(block);
    else intro.push(block);
  }
  return { intro, sections };
}

function titleSlide(pptx: PptxGenJS, title: string, intro: readonly Block[]): void {
  const slide = pptx.addSlide();
  slide.addText(clip(title), { x: 0.7, y: 2.2, w: 11.9, h: 1.4, fontSize: 40, bold: true, color: "1A1A1F" });
  const opening = intro.find((b): b is Extract<Block, { type: "paragraph" }> => b.type === "paragraph");
  if (opening) slide.addText(clip(opening.text), { x: 0.7, y: 3.7, w: 11.9, h: 1.5, fontSize: 20, color: "55555F", valign: "top" });
}

function contentSlide(pptx: PptxGenJS, section: Section): void {
  const slide = pptx.addSlide();
  slide.addText(clip(section.title), { x: 0.6, y: 0.4, w: 12.1, h: 0.9, fontSize: 30, bold: true, color: "1A1A1F" });
  const items = section.blocks.flatMap(itemsOf);
  const shown = items.length > SLIDE_MAX_ITEMS ? [...items.slice(0, SLIDE_MAX_ITEMS - 1), { text: "…", options: { breakLine: true } }] : items;
  if (shown.length > 0) slide.addText(shown, { x: 0.6, y: 1.5, w: 12.1, h: 5.5, fontSize: 18, color: "1A1A1F", valign: "top", fit: "shrink" });
}

/** The markdown as PPTX bytes; refuses a markdown above 5 MB. */
export async function renderPptx(markdown: string, opts: { readonly title: string }): Promise<Uint8Array> {
  assertRenderable(markdown);
  const { intro, sections } = sectionsOf(markdownBlocks(markdown));
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = opts.title;
  pptx.author = "North";
  pptx.company = "North";
  titleSlide(pptx, opts.title, intro);
  for (const section of sections.slice(0, PPTX_MAX_SLIDES - 1)) contentSlide(pptx, section);
  const out = await pptx.write({ outputType: "uint8array", compression: true });
  if (!(out instanceof Uint8Array)) throw new Error("pptxgenjs returned no bytes");
  return out;
}
