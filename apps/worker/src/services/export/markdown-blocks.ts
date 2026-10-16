/**
 * MEM-2 (D6-4): the small markdown model both renderers draw from. Line-based,
 * no HTML, no images: headings, paragraphs, lists, quotes, fenced code,
 * tables and rules. Inline markup is reduced to its text (a link keeps its
 * URL in parentheses). The `.md` in the export is always the exact markdown;
 * this only decides what the PDF and the slides show.
 */

export type Block =
  | { readonly type: "heading"; readonly level: 1 | 2 | 3 | 4 | 5 | 6; readonly text: string }
  | { readonly type: "paragraph"; readonly text: string }
  | { readonly type: "bullet"; readonly depth: number; readonly text: string }
  | { readonly type: "number"; readonly depth: number; readonly n: number; readonly text: string }
  | { readonly type: "quote"; readonly text: string }
  | { readonly type: "code"; readonly lines: readonly string[] }
  | { readonly type: "table"; readonly rows: readonly (readonly string[])[] }
  | { readonly type: "rule" };

/** Both renderers refuse a markdown above this (the PDF would be hundreds of pages; the zip keeps the exact `.md`). */
export const RENDER_MAX_MARKDOWN_BYTES = 5 * 1024 * 1024;

/** A renderer refused its input; the export goes on without that file and the README says so. */
export class ExportRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExportRenderError";
  }
}

export function assertRenderable(markdown: string): void {
  const bytes = Buffer.byteLength(markdown, "utf8");
  if (bytes > RENDER_MAX_MARKDOWN_BYTES) throw new ExportRenderError(`markdown is ${bytes} bytes; the renderers refuse anything above 5 MB`);
}

// eslint-disable-next-line no-control-regex -- stripping control characters is the point (they break the PDF text and the slide XML)
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** One line of inline markdown as plain text. */
export function inlineText(text: string): string {
  return text
    .replace(CONTROL, "")
    .replace(/\t/g, "    ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "[image: $1]")
    .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, "$1 ($2)")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?![\w*])/g, "$1$2")
    .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, "$1$2")
    .replace(/<\/?[A-Za-z][^>]*>/g, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1")
    .trim();
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE = /^\s*(```|~~~)/;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;
const NUMBER = /^(\s*)(\d{1,9})[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const TABLE_ROW = /^\s*\|/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

const depthOf = (indent: string): number => Math.min(Math.floor(indent.replace(/\t/g, "  ").length / 2), 4);
const startsBlock = (line: string): boolean => HEADING.test(line) || FENCE.test(line) || BULLET.test(line) || NUMBER.test(line) || QUOTE.test(line) || RULE.test(line) || TABLE_ROW.test(line);
const cells = (row: string): readonly string[] => Object.freeze(row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => inlineText(c)));

/** Consumes lines from `i` while `take` says so; returns the taken lines and the next index. */
function takeWhile(lines: readonly string[], i: number, take: (line: string) => boolean): { readonly taken: readonly string[]; readonly next: number } {
  let j = i;
  while (j < lines.length && take(lines[j] ?? "")) j += 1;
  return { taken: lines.slice(i, j), next: j };
}

/** A fenced code block starting at `i` (the fence line); an unclosed fence runs to the end. */
function codeBlock(lines: readonly string[], i: number): { readonly block: Block; readonly next: number } {
  const fence = FENCE.exec(lines[i] ?? "")?.[1] ?? "```";
  const body = takeWhile(lines, i + 1, (line) => !line.trimStart().startsWith(fence));
  const code = body.taken.map((l) => l.replace(CONTROL, "").replace(/\t/g, "    "));
  return { block: { type: "code", lines: Object.freeze(code) }, next: Math.min(body.next + 1, lines.length) };
}

/** One block starting at line `i` (not blank). */
function blockAt(lines: readonly string[], i: number): { readonly block: Block; readonly next: number } {
  const line = lines[i] ?? "";
  if (FENCE.test(line)) return codeBlock(lines, i);
  const heading = HEADING.exec(line);
  if (heading) return { block: { type: "heading", level: (heading[1]?.length ?? 1) as 1 | 2 | 3 | 4 | 5 | 6, text: inlineText(heading[2] ?? "") }, next: i + 1 };
  if (RULE.test(line)) return { block: { type: "rule" }, next: i + 1 };
  const bullet = BULLET.exec(line);
  if (bullet) return { block: { type: "bullet", depth: depthOf(bullet[1] ?? ""), text: inlineText(bullet[2] ?? "") }, next: i + 1 };
  const numbered = NUMBER.exec(line);
  if (numbered) return { block: { type: "number", depth: depthOf(numbered[1] ?? ""), n: Number(numbered[2]), text: inlineText(numbered[3] ?? "") }, next: i + 1 };
  if (QUOTE.test(line)) {
    const quote = takeWhile(lines, i, (l) => QUOTE.test(l));
    return { block: { type: "quote", text: inlineText(quote.taken.map((l) => QUOTE.exec(l)?.[1] ?? "").join(" ")) }, next: quote.next };
  }
  if (TABLE_ROW.test(line)) {
    const table = takeWhile(lines, i, (l) => TABLE_ROW.test(l));
    return { block: { type: "table", rows: Object.freeze(table.taken.filter((l) => !TABLE_SEPARATOR.test(l)).map(cells)) }, next: table.next };
  }
  const para = takeWhile(lines, i + 1, (l) => l.trim() !== "" && !startsBlock(l));
  return { block: { type: "paragraph", text: inlineText([line, ...para.taken].map((l) => l.trim()).join(" ")) }, next: para.next };
}

/** The markdown as blocks, in order; frozen. */
export function markdownBlocks(markdown: string): readonly Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    if ((lines[i] ?? "").trim() === "") {
      i += 1;
      continue;
    }
    const { block, next } = blockAt(lines, i);
    blocks.push(Object.freeze(block));
    i = next;
  }
  return Object.freeze(blocks);
}
