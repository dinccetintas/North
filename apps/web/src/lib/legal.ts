import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * LEG-1: the legal placeholders are our own markdown under `content/legal/`,
 * rendered by the `Markdown` component. A document that still starts with
 * the draft line shows the draft banner; counsel removes the line, the
 * banner goes with it. Server only (reads the file system at build time).
 */
export const LEGAL_DOCS = ["terms", "privacy", "acceptable-use"] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

export const LEGAL_TITLES: Readonly<Record<LegalDoc, string>> = Object.freeze({
  terms: "Terms of service",
  privacy: "Privacy notice",
  "acceptable-use": "Acceptable use policy",
});

export const DRAFT_LINE = "> Draft: counsel review before launch.";

export function isLegalDoc(value: string): value is LegalDoc {
  return (LEGAL_DOCS as readonly string[]).includes(value);
}

export interface LegalDocument {
  readonly doc: LegalDoc;
  readonly title: string;
  readonly draft: boolean;
  /** The markdown without the draft line (the page renders the banner itself). */
  readonly body: string;
}

/** Splits the draft line off the markdown; pure so the rule is testable without the file system. */
export function parseLegal(doc: LegalDoc, markdown: string): LegalDocument {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const draft = normalized.startsWith(DRAFT_LINE);
  return Object.freeze({ doc, title: LEGAL_TITLES[doc], draft, body: draft ? normalized.slice(DRAFT_LINE.length).trimStart() : normalized });
}

export async function loadLegal(doc: LegalDoc): Promise<LegalDocument> {
  const markdown = await readFile(join(process.cwd(), "content", "legal", `${doc}.md`), "utf8");
  return parseLegal(doc, markdown);
}
