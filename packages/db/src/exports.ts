import { EXPORT_KINDS, EXPORT_STATUSES, ExportManifestSchema, type ExportKind, type ExportManifest, type ExportStatus } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { toJson, UuidSchema } from "./json";
import type { TablesUpdate } from "./types";

/**
 * EXP-1 / MEM-2 / RET-1 (ADR 0016): the owner requests an export; the worker's
 * `build-export` writes the zip to the private `exports` bucket at
 * `users/<userId>/exports/<id>.zip` (the database pins that path) and records
 * it. Downloads are signed URLs the owner's own client creates; a stranger
 * gets neither the row nor the URL.
 */
export const EXPORTS_BUCKET = "exports";
/** The signed download link lives at most an hour. */
export const EXPORT_URL_TTL_SEC = 3600;

/** The one object path an export may have; the policy keys on segment 2 (the user id). */
export function exportStoragePath(userId: string, exportId: string): string {
  return `users/${UuidSchema.parse(userId)}/exports/${UuidSchema.parse(exportId)}.zip`;
}

export interface ExportRecord {
  readonly id: string;
  readonly userId: string;
  /** One company, or null for every company of the owner. */
  readonly companyId: string | null;
  readonly kind: ExportKind;
  readonly includeArchived: boolean;
  readonly status: ExportStatus;
  readonly storagePath: string | null;
  readonly bytes: number | null;
  readonly manifest: ExportManifest | null;
  readonly error: string | null;
  readonly expiresAt: string | null;
  readonly createdAt: string;
}

export const RequestExportInputSchema = z.object({
  userId: UuidSchema,
  companyId: UuidSchema.nullable(),
  kind: z.enum(EXPORT_KINDS),
  includeArchived: z.boolean().default(false),
});
export type RequestExportInput = z.input<typeof RequestExportInputSchema>;

const EXPORT_COLUMNS = "id, user_id, company_id, kind, include_archived, status, storage_path, bytes, manifest, error, expires_at, created_at";

const ExportRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  company_id: z.string().nullable(),
  kind: z.enum(EXPORT_KINDS),
  include_archived: z.boolean(),
  status: z.enum(EXPORT_STATUSES),
  storage_path: z.string().nullable(),
  bytes: z.coerce.number().nullable(),
  manifest: z.unknown(),
  error: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
});

/** The manifest the worker wrote through `setExportReady` (validated there); anything else reads as null, so one odd row never breaks a list. */
const manifestOf = (value: unknown): ExportManifest | null => {
  const parsed = ExportManifestSchema.safeParse(value);
  return parsed.success ? Object.freeze(parsed.data) : null;
};

const toExport = (row: unknown): ExportRecord => {
  const r = ExportRowSchema.parse(row);
  return Object.freeze({
    id: r.id,
    userId: r.user_id,
    companyId: r.company_id,
    kind: r.kind,
    includeArchived: r.include_archived,
    status: r.status,
    storagePath: r.storage_path,
    bytes: r.bytes,
    manifest: manifestOf(r.manifest),
    error: r.error,
    expiresAt: r.expires_at === null ? null : new Date(r.expires_at).toISOString(),
    createdAt: r.created_at,
  });
};

/** The owner's client: a `requested` export (the insert policy allows nothing else); the web then sends `export/requested`. */
export async function requestExport(db: DbClient, input: RequestExportInput): Promise<ExportRecord> {
  const e = RequestExportInputSchema.parse(input);
  const { data, error } = await db
    .from("exports")
    .insert({ user_id: e.userId, company_id: e.companyId, kind: e.kind, include_archived: e.includeArchived })
    .select(EXPORT_COLUMNS)
    .single();
  if (error || !data) throw dbError("Could not request an export", error);
  return toExport(data);
}

/** The user's exports, newest first. */
export async function listExports(db: DbClient, userId: string, limit = 20): Promise<readonly ExportRecord[]> {
  const id = UuidSchema.parse(userId);
  const max = z.number().int().positive().max(200).parse(limit);
  const { data, error } = await db.from("exports").select(EXPORT_COLUMNS).eq("user_id", id).order("created_at", { ascending: false }).limit(max);
  if (error) throw dbError("Could not list exports", error);
  return Object.freeze((data ?? []).map(toExport));
}

/** One export, or null when unknown or not the caller's. */
export async function getExport(db: DbClient, exportId: string): Promise<ExportRecord | null> {
  const id = UuidSchema.parse(exportId);
  const { data, error } = await db.from("exports").select(EXPORT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw dbError("Could not load export", error);
  return data ? toExport(data) : null;
}

async function updateExport(db: DbClient, exportId: string, patch: TablesUpdate<"exports">, from: readonly ExportStatus[]): Promise<ExportRecord | null> {
  const id = UuidSchema.parse(exportId);
  const { data, error } = await db
    .from("exports")
    .update(patch)
    .eq("id", id)
    .in("status", [...from])
    .select(EXPORT_COLUMNS)
    .maybeSingle();
  if (error) throw dbError("Could not update export", error);
  return data ? toExport(data) : null;
}

const required = (record: ExportRecord | null, id: string, what: string): ExportRecord => {
  if (!record) throw new DbError(`Export ${id} cannot become ${what} from its current status`);
  return record;
};

/** Worker only: claims a `requested` export; null when it is not `requested` any more (a replayed event). */
export function setExportRunning(db: DbClient, exportId: string): Promise<ExportRecord | null> {
  return updateExport(db, exportId, { status: "running" }, ["requested"]);
}

const StoragePathSchema = z.string().regex(/^users\/[0-9a-f-]{36}\/exports\/[0-9a-f-]{36}\.zip$/, "users/<userId>/exports/<id>.zip");

export const ExportReadySchema = z.object({
  storagePath: StoragePathSchema,
  bytes: z.number().int().nonnegative(),
  manifest: ExportManifestSchema,
  expiresAt: z.iso.datetime({ offset: true }),
});
export type ExportReady = z.input<typeof ExportReadySchema>;

/** Worker only: the zip is in the bucket; the database checks the path is this user's and this export's. */
export async function setExportReady(db: DbClient, exportId: string, ready: ExportReady): Promise<ExportRecord> {
  const r = ExportReadySchema.parse(ready);
  const patch: TablesUpdate<"exports"> = { status: "ready", storage_path: r.storagePath, bytes: r.bytes, manifest: toJson(r.manifest), expires_at: r.expiresAt, error: null };
  return required(await updateExport(db, exportId, patch, ["requested", "running"]), exportId, "ready");
}

/** Worker only: a fixed, user-readable failure. */
export async function setExportFailed(db: DbClient, exportId: string, message: string): Promise<ExportRecord> {
  const m = z.string().trim().min(1).max(300).parse(message);
  return required(await updateExport(db, exportId, { status: "failed", error: m }, ["requested", "running"]), exportId, "failed");
}

/** Worker only (`retention-sweep`): the object was removed; the row stays as `expired`. */
export async function setExportExpired(db: DbClient, exportId: string): Promise<ExportRecord> {
  return required(await updateExport(db, exportId, { status: "expired" }, ["ready"]), exportId, "expired");
}

/** `retention-sweep` (service role): ready exports whose `expires_at` has passed, oldest first. */
export async function listExpiredExports(db: DbClient, now: Date): Promise<readonly ExportRecord[]> {
  const { data, error } = await db.from("exports").select(EXPORT_COLUMNS).eq("status", "ready").lte("expires_at", now.toISOString()).order("expires_at", { ascending: true }).limit(1000);
  if (error) throw dbError("Could not list expired exports", error);
  return Object.freeze((data ?? []).map(toExport));
}

/**
 * A signed download URL for a ready export, created with the caller's own
 * client under the bucket's owner policy: null for anything not ready, and for
 * a stranger (the storage API refuses to sign another user's object).
 */
export async function signExportUrl(db: DbClient, record: ExportRecord, ttlSec: number = EXPORT_URL_TTL_SEC): Promise<string | null> {
  const ttl = z.number().int().positive().max(EXPORT_URL_TTL_SEC).parse(ttlSec);
  if (record.status !== "ready" || record.storagePath === null) return null;
  const path = StoragePathSchema.parse(record.storagePath);
  const { data, error } = await db.storage.from(EXPORTS_BUCKET).createSignedUrl(path, ttl);
  return error || !data ? null : data.signedUrl;
}
