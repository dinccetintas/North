import { z } from "zod";
import { ARTIFACT_KINDS, WorkspacePathSchema, type ArtifactKind } from "../tasks/types";

/**
 * EXP-1 / MEM-2 / RET-1 (ADR 0016): an export is a worker job to the private
 * `exports` bucket; the web only requests and links. K0: it reads the user's
 * own data and nothing leaves North, so it carries no action kind.
 */
export const EXPORT_KINDS = ["artifacts", "data", "full"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const EXPORT_STATUSES = ["requested", "running", "ready", "failed", "expired"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/** Artifact formats: the exact markdown always, a PDF for every kind, a PPTX for decks and plans. */
export const EXPORT_FORMATS = ["md", "pdf", "pptx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const PDF_KINDS: readonly ArtifactKind[] = ARTIFACT_KINDS;
export const PPTX_KINDS: readonly ArtifactKind[] = Object.freeze(["investor_deck", "plan"]);

/** The tables exported as CSV next to their JSON. */
export const EXPORT_CSV_TABLES = ["ledger", "actions", "decision_cards", "tasks", "metrics", "leads"] as const;
export type ExportCsvTable = (typeof EXPORT_CSV_TABLES)[number];

/** The zip is removed after this; the signed download URL lives one hour. */
export const EXPORT_TTL_DAYS = 7;

export const ExportRequestSchema = z.object({
  kind: z.enum(EXPORT_KINDS),
  /** One company, or null for every company of the owner. */
  companyId: z.uuid().nullable(),
  includeArchived: z.boolean().default(false),
});
export type ExportRequest = z.infer<typeof ExportRequestSchema>;

export const EXPORT_FILE_KINDS = ["md", "pdf", "pptx", "json", "csv", "readme"] as const;

export const ExportManifestSchema = z.object({
  files: z.array(z.object({ path: WorkspacePathSchema, bytes: z.number().int().nonnegative(), kind: z.enum(EXPORT_FILE_KINDS) })).max(10_000),
  /** The GitHub repository per company: the code is already theirs (EXP-1). */
  companies: z.array(z.object({ slug: z.string().min(1).max(100), repoUrl: z.string().max(2048).nullable() })).max(100),
  generatedAt: z.iso.datetime({ offset: true }),
});
export type ExportManifest = z.infer<typeof ExportManifestSchema>;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
const TABLE_RE = /^[a-z][a-z_]{0,63}$/;
const TITLE_MAX = 80;

const requireSlug = (slug: string): string => {
  if (!SLUG_RE.test(slug)) throw new Error(`export: not a company slug: ${JSON.stringify(slug)}`);
  return slug;
};

/** `a-z0-9-`, no leading or trailing dash, at most 80 characters; `untitled` when nothing survives. */
const titleSlug = (title: string): string => {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, TITLE_MAX)
    .replace(/-+$/g, "");
  return slug || "untitled";
};

/** `artifacts/<slug>/<kind>/<title>-v<n>.<format>`; every segment is rebuilt from a whitelist, so no input can traverse. */
export function exportPath(companySlug: string, kind: ArtifactKind, title: string, version: number, format: ExportFormat): string {
  const slug = requireSlug(companySlug);
  if (!(ARTIFACT_KINDS as readonly string[]).includes(kind)) throw new Error(`export: not an artifact kind: ${JSON.stringify(kind)}`);
  if (!Number.isInteger(version) || version < 1) throw new Error(`export: version must be a positive integer: ${String(version)}`);
  if (!(EXPORT_FORMATS as readonly string[]).includes(format)) throw new Error(`export: not an export format: ${JSON.stringify(format)}`);
  return WorkspacePathSchema.parse(`artifacts/${slug}/${kind}/${titleSlug(title)}-v${version}.${format}`);
}

/** `data/<slug>/<table>.<json|csv>` under the same rules. */
export function exportDataPath(companySlug: string, table: string, format: "json" | "csv"): string {
  const slug = requireSlug(companySlug);
  if (!TABLE_RE.test(table)) throw new Error(`export: not a table name: ${JSON.stringify(table)}`);
  if (format !== "json" && format !== "csv") throw new Error(`export: not a data format: ${JSON.stringify(format)}`);
  return WorkspacePathSchema.parse(`data/${slug}/${table}.${format}`);
}
