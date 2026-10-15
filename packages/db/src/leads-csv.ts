import { z } from "zod";

/** The most rows one CSV upload (or `importLeads` call) may carry. */
export const MAX_LEADS_PER_IMPORT = 500;

/** The required header, in this order (case-insensitive, surrounding spaces ignored). */
export const LEADS_CSV_HEADER = ["name", "email", "company", "why"] as const;

/** One lead as uploaded or researched; the shape `importLeads` accepts (core's `LeadDraft` fits it). */
export const LeadInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.email().max(254).transform((e) => e.trim().toLowerCase()),
  company: z.string().trim().max(120).default(""),
  why: z.string().trim().max(500).default(""),
});
export type LeadInput = z.input<typeof LeadInputSchema>;
export type Lead = z.output<typeof LeadInputSchema>;

/** A CSV that cannot be imported; the message names the line. The file is refused as a whole. */
export class LeadsCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadsCsvError";
  }
}

/** Splits one RFC 4180 line into cells (quotes, doubled quotes, embedded commas). */
function splitCsvLine(line: string, lineNo: number): readonly string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new LeadsCsvError(`line ${lineNo}: unterminated quote`);
  cells.push(cell);
  return cells;
}

const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

function assertHeader(cells: readonly string[]): void {
  const names = cells.map((c) => c.trim().toLowerCase());
  const expected = LEADS_CSV_HEADER.join(",");
  if (names.join(",") !== expected) throw new LeadsCsvError(`line 1: the header must be "${expected}"`);
}

function toLead(cells: readonly string[], lineNo: number): Lead {
  if (cells.length < LEADS_CSV_HEADER.length) throw new LeadsCsvError(`line ${lineNo}: expected ${LEADS_CSV_HEADER.length} columns, got ${cells.length}`);
  const parsed = LeadInputSchema.safeParse({ name: cells[0], email: cells[1], company: cells[2], why: cells[3] });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new LeadsCsvError(`line ${lineNo}: ${issue?.path.join(".") ?? "row"} ${issue?.message ?? "is invalid"}`);
  }
  return Object.freeze(parsed.data);
}

/**
 * Parses a leads CSV (`name,email,company,why`; RFC 4180 quoting; LF or CRLF;
 * a BOM is tolerated; blank lines are skipped). Pure: no I/O. Refuses a wrong
 * header, an invalid row, an empty file and more than 500 rows, so nothing
 * half-valid reaches `importLeads`.
 */
export function parseLeadsCsv(text: string): readonly Lead[] {
  const lines = stripBom(z.string().parse(text)).split(/\r\n|\n|\r/);
  const numbered = lines.map((line, i) => [line, i + 1] as const).filter(([line]) => line.trim() !== "");
  const [header, ...rows] = numbered;
  if (!header) throw new LeadsCsvError("the file is empty");
  assertHeader(splitCsvLine(header[0], header[1]));
  if (rows.length === 0) throw new LeadsCsvError("no rows after the header");
  if (rows.length > MAX_LEADS_PER_IMPORT) throw new LeadsCsvError(`at most ${MAX_LEADS_PER_IMPORT} rows per import, got ${rows.length}`);
  return Object.freeze(rows.map(([line, lineNo]) => toLead(splitCsvLine(line, lineNo), lineNo)));
}
