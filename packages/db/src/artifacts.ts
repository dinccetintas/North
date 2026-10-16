import { ARTIFACT_KINDS, type ArtifactKind } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { UuidSchema } from "./json";
import { readAllPages } from "./paging";

export const ARTIFACTS_BUCKET = "artifacts";
const MARKDOWN_CONTENT_TYPE = "text/markdown";

export interface ArtifactRecord {
  readonly id: string;
  readonly companyId: string;
  readonly kind: ArtifactKind;
  readonly title: string;
  readonly version: number;
  readonly storagePath: string;
  readonly createdByRole: string;
  readonly createdAt: string;
}

export const CreateArtifactInputSchema = z.object({
  companyId: UuidSchema,
  kind: z.enum(ARTIFACT_KINDS),
  title: z.string().trim().min(1).max(120),
  markdown: z.string().min(1),
  createdByRole: z.string().trim().min(1).max(60),
});
export type CreateArtifactInput = z.input<typeof CreateArtifactInputSchema>;

const ARTIFACT_COLUMNS = "id, company_id, kind, title, version, storage_path, created_by_role, created_at";

const ArtifactRowSchema = z.object({
  id: z.string(),
  company_id: z.string(),
  kind: z.enum(ARTIFACT_KINDS),
  title: z.string(),
  version: z.number().int(),
  storage_path: z.string(),
  created_by_role: z.string(),
  created_at: z.string(),
});

const toRecord = (row: unknown): ArtifactRecord => {
  const r = ArtifactRowSchema.parse(row);
  return Object.freeze({
    id: r.id,
    companyId: r.company_id,
    kind: r.kind,
    title: r.title,
    version: r.version,
    storagePath: r.storage_path,
    createdByRole: r.created_by_role,
    createdAt: r.created_at,
  });
};

/** File-name-safe slug for an artifact title: a-z0-9 and hyphens, max 80 chars. */
export function artifactSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug.length > 0 ? slug : "artifact";
}

/** Storage object path: companies/<companyId>/<kind>/<slug>-v<version>.md (the policies key on segment 2). */
export function artifactStoragePath(companyId: string, kind: ArtifactKind, title: string, version: number): string {
  return `companies/${companyId}/${kind}/${artifactSlug(title)}-v${version}.md`;
}

const ARTIFACT_OBJECT = /^companies\/([0-9a-f-]{36})\/[a-z_]+\/[a-z0-9][a-z0-9-]{0,79}-v[0-9]+\.md$/;

/**
 * M6 review M2: the object a row names must sit in its own company's folder
 * (the shape `artifactStoragePath` writes; the database pins the same rule as
 * `artifacts_storage_path_pinned`). The worker reads and deletes these paths
 * with the service role, so a path into another company is never followed.
 */
export function artifactPathBelongs(companyId: string, path: string): boolean {
  const match = ARTIFACT_OBJECT.exec(path);
  return match !== null && match[1] === companyId;
}

/** A row whose storage path leaves its company's folder: refused, never downloaded or deleted. */
export class ArtifactPathError extends DbError {
  constructor(
    readonly artifactId: string,
    readonly storagePath: string,
  ) {
    super(`Artifact ${artifactId}: ${storagePath} is not in its company's folder; refused`);
    this.name = "ArtifactPathError";
  }
}

/** Next version for the same company + kind + title (1 when none exists). */
export async function nextArtifactVersion(db: DbClient, companyId: string, kind: ArtifactKind, title: string): Promise<number> {
  const { data, error } = await db
    .from("artifacts")
    .select("version")
    .eq("company_id", companyId)
    .eq("kind", kind)
    .eq("title", title)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw dbError("Could not determine artifact version", error);
  return (data?.version ?? 0) + 1;
}

/**
 * Uploads the markdown to the private `artifacts` bucket and records the row.
 * Versions are per company + kind + title; a failed insert removes the upload.
 */
export async function createArtifact(db: DbClient, input: CreateArtifactInput): Promise<ArtifactRecord> {
  const a = CreateArtifactInputSchema.parse(input);
  const version = await nextArtifactVersion(db, a.companyId, a.kind, a.title);
  const path = artifactStoragePath(a.companyId, a.kind, a.title, version);
  const bucket = db.storage.from(ARTIFACTS_BUCKET);
  const upload = await bucket.upload(path, new Blob([a.markdown], { type: MARKDOWN_CONTENT_TYPE }), {
    contentType: MARKDOWN_CONTENT_TYPE,
    upsert: false,
  });
  if (upload.error) throw dbError(`Could not upload artifact to ${path}`, upload.error);

  const { data, error } = await db
    .from("artifacts")
    .insert({ company_id: a.companyId, kind: a.kind, title: a.title, version, storage_path: path, created_by_role: a.createdByRole })
    .select(ARTIFACT_COLUMNS)
    .single();
  if (error || !data) {
    await bucket.remove([path]);
    throw dbError("Could not record artifact", error);
  }
  return toRecord(data);
}

/** Every artifact of the company, newest first, read in pages (M6 review M5: past PostgREST's 1000 rows). */
export async function listArtifacts(db: DbClient, companyId: string): Promise<readonly ArtifactRecord[]> {
  const id = UuidSchema.parse(companyId);
  const rows = await readAllPages(
    (from, to) =>
      db
        .from("artifacts")
        .select(ARTIFACT_COLUMNS)
        .eq("company_id", id)
        .order("created_at", { ascending: false })
        .order("version", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    "Could not list artifacts",
  );
  return Object.freeze(rows.map(toRecord));
}

/** One artifact row by id, or null when missing or not visible. */
export async function getArtifact(db: DbClient, artifactId: string): Promise<ArtifactRecord | null> {
  const id = UuidSchema.parse(artifactId);
  const { data, error } = await db.from("artifacts").select(ARTIFACT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbError("Could not load artifact", error);
  return data ? toRecord(data) : null;
}

/** Downloads the artifact's markdown from Storage; null when the row does not exist; `ArtifactPathError` when its path is not its company's. */
export async function getArtifactMarkdown(db: DbClient, artifactId: string): Promise<string | null> {
  const artifact = await getArtifact(db, artifactId);
  if (!artifact) return null;
  if (!artifactPathBelongs(artifact.companyId, artifact.storagePath)) throw new ArtifactPathError(artifact.id, artifact.storagePath);
  const { data, error } = await db.storage.from(ARTIFACTS_BUCKET).download(artifact.storagePath);
  if (error || !data) throw dbError(`Could not download artifact ${artifact.storagePath}`, error);
  return data.text();
}
