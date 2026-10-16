import { WorkspacePathSchema, type ExportKind } from "@north/core";
import type { Cut } from "./budget";
import type { ManifestFile } from "./files";

/**
 * EXP-1: the export's `README.md`: what is inside, where each company's code
 * already lives (the repository reference the worker recorded), the export
 * date, and anything left out or cut (M6 review M4: the budgets, the row
 * limit, a free-text value cut in the select; M2: a refused artifact).
 */
export const README_PATH = WorkspacePathSchema.parse("README.md");

export interface ReadmeInput {
  readonly kind: ExportKind;
  readonly generatedAt: string;
  readonly companies: readonly { readonly slug: string; readonly name: string; readonly repoUrl: string | null }[];
  readonly files: readonly ManifestFile[];
  /** Artifact files not in the zip; `reason` reads after the path ("was not rendered: …"). */
  readonly skipped: readonly { readonly path: string; readonly reason: string }[];
  /** Data files cut or left out. */
  readonly cuts: readonly Cut[];
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

const KIND_WORDS: Readonly<Record<ExportKind, string>> = Object.freeze({ full: "everything", artifacts: "artifacts only", data: "data only" });

function inside(kind: ExportKind): readonly string[] {
  const artifacts = [
    "- `artifacts/<company>/<kind>/<title>-v<n>.md`: every version of every artifact, exactly as it was written.",
    "- `….pdf` next to each markdown file; `….pptx` for investor decks and plans (text and bullets; the markdown is the exact copy).",
  ];
  const data = [
    "- `data/<company>/<table>.json`: every table you can read in North, one file per table.",
    "- `data/<company>/{ledger,actions,decision_cards,tasks,metrics,leads}.csv`: the same rows as CSV.",
    "- `data/profile.json`: your profile, plan, credits, usage and connections (never their tokens).",
  ];
  return kind === "artifacts" ? artifacts : kind === "data" ? data : [...artifacts, ...data];
}

export function exportReadme(input: ReadmeInput): string {
  const bytes = input.files.reduce((sum, f) => sum + f.bytes, 0);
  const code = input.companies.length === 0 ? ["- No companies in this export."] : input.companies.map((c) => `- ${oneLine(c.name)} (\`${c.slug}\`): ${c.repoUrl ? oneLine(c.repoUrl) : "no repository yet (nothing has been built)"}`);
  const sentence = (text: string): string => `${oneLine(text).replace(/\.$/, "")}.`;
  const notes = [...input.skipped.map((s) => `- \`${s.path}\` ${sentence(s.reason)}`), ...input.cuts.map((c) => `- \`${c.path}\`: ${sentence(c.reason)}`)];
  return [
    "# Your North export",
    "",
    `Exported ${input.generatedAt} (UTC): ${KIND_WORDS[input.kind]}, ${input.files.length + 1} files, ${bytes} bytes before compression.`,
    "",
    "## What is inside",
    "",
    ...inside(input.kind),
    "",
    "## Your code",
    "",
    "Your code is already yours: it lives in your own GitHub repository, not in this file.",
    "",
    ...code,
    "",
    ...(notes.length > 0 ? ["## Notes", "", ...notes, ""] : []),
  ].join("\n");
}
