import { CREDIT_ENTRY_KINDS, CreditEntryDraftSchema, CreditEntrySchema, type CreditEntry, type CreditEntryDraft } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { UuidSchema } from "./json";

/**
 * BIL-2 (ADR 0014): credits are an append-only ledger; nothing decrements in
 * place. The worker inserts drafts from core (`trialGrant`, `creditGrantsFor`,
 * `releaseEntry`, `expireEntry`); a ref already present is ignored, so a
 * replayed event or step writes nothing twice. A run's consume is reserved at
 * dispatch (`reserveCredit`); the database refuses any other consume below the
 * grace floor (`credit_entries_no_overdraft`).
 */
export class CreditFloorError extends DbError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "CreditFloorError";
  }
}

const isFloorRefusal = (error: unknown): boolean => z.object({ code: z.literal("23514"), hint: z.literal("credit_floor") }).safeParse(error).success;

/** Worker only: inserts the drafts for one user and returns the refs actually inserted (a replayed ref is skipped). */
export async function insertCreditEntries(db: DbClient, userId: string, drafts: readonly CreditEntryDraft[]): Promise<readonly string[]> {
  const id = UuidSchema.parse(userId);
  const rows = z
    .array(CreditEntryDraftSchema)
    .max(100)
    .parse(drafts)
    .map((d) => ({ user_id: id, kind: d.kind, amount: d.amount, ref: d.ref, note: d.note }));
  if (rows.length === 0) return Object.freeze([]);
  const { data, error } = await db.from("credit_entries").upsert(rows, { onConflict: "user_id,ref", ignoreDuplicates: true }).select("ref");
  if (error) {
    if (isFloorRefusal(error)) throw new CreditFloorError(`Credit floor reached: ${error.message}`, error);
    throw dbError("Could not insert credit entries", error);
  }
  const inserted = new Set((data ?? []).map((r) => r.ref));
  return Object.freeze(rows.map((r) => r.ref).filter((ref) => inserted.has(ref)));
}

export const CREDIT_RESERVATIONS = ["reserved", "exists", "refused"] as const;
export type CreditReservation = (typeof CREDIT_RESERVATIONS)[number];

/**
 * Worker only (L9): the run's `consume` written at dispatch, before the run
 * starts (`credit_reserve`, under the per-user credits lock): `reserved`,
 * `exists` (the ref is already there, nothing written) or `refused` (the
 * balance is 0 or below, nothing written).
 */
export async function reserveCredit(db: DbClient, userId: string, ref: string): Promise<CreditReservation> {
  const id = UuidSchema.parse(userId);
  const r = z.string().min(1).max(200).parse(ref);
  const { data, error } = await db.rpc("credit_reserve", { p_user_id: id, p_ref: r });
  if (error) throw dbError("Could not reserve a credit", error);
  return z.enum(CREDIT_RESERVATIONS).parse(data);
}

/** The sum of the user's ledger (`credit_balance`); a stranger's client sums nothing and reads 0. */
export async function creditBalance(db: DbClient, userId: string): Promise<number> {
  const id = UuidSchema.parse(userId);
  const { data, error } = await db.rpc("credit_balance", { p_user_id: id });
  if (error) throw dbError("Could not read credit balance", error);
  return z.number().int().parse(data);
}

const CreditRowSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  kind: z.enum(CREDIT_ENTRY_KINDS),
  amount: z.number().int(),
  ref: z.string(),
  note: z.string(),
  created_at: z.string(),
});

const toCreditEntry = (row: unknown): CreditEntry => {
  const r = CreditRowSchema.parse(row);
  return Object.freeze(CreditEntrySchema.parse({ id: r.id, userId: r.user_id, kind: r.kind, amount: r.amount, ref: r.ref, note: r.note, createdAt: new Date(r.created_at).toISOString() }));
};

export interface ListCreditEntriesOptions {
  readonly limit?: number;
}

/** The user's entries, newest first (the settings page shows the last 20). */
export async function listCreditEntries(db: DbClient, userId: string, opts: ListCreditEntriesOptions = {}): Promise<readonly CreditEntry[]> {
  const id = UuidSchema.parse(userId);
  const limit = z.number().int().positive().max(1000).default(50).parse(opts.limit);
  const { data, error } = await db.from("credit_entries").select("id, user_id, kind, amount, ref, note, created_at").eq("user_id", id).order("created_at", { ascending: false }).order("id", { ascending: true }).limit(limit);
  if (error) throw dbError("Could not list credit entries", error);
  return Object.freeze((data ?? []).map(toCreditEntry));
}
