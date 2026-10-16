// CMP-1: the company's suppression list: addresses and domains it must never write to again (migration 0019).
import { z } from "zod";
import type { DbClient } from "./client";
import { dbError } from "./errors";
import { UuidSchema } from "./json";
import { readAllPages } from "./paging";

export const SUPPRESSION_REASONS = ["opt_out", "bounce", "complaint", "manual", "legal_block"] as const;
export const SuppressionReasonSchema = z.enum(SUPPRESSION_REASONS);
export type SuppressionReason = z.infer<typeof SuppressionReasonSchema>;

/**
 * What a suppression row names: an address (`ada@example.com`) or a bare
 * domain (`blocked.io`, which blocks that exact domain and not its
 * subdomains), trimmed and lower-cased, 3 to 254 characters, no spaces. The
 * shape check is deliberately loose: a bounce notice may name an address a
 * strict parser refuses, and refusing to record it would let a later send go
 * out.
 */
export const SuppressionTargetSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .regex(/^(?:[^\s@]+@[^\s@]+|[^\s@]+\.[^\s@]+)$/, "an email address or a bare domain such as example.com");

export const AddSuppressionInputSchema = z.object({
  companyId: UuidSchema,
  email: SuppressionTargetSchema,
  reason: SuppressionReasonSchema,
  /** The action that caused it (the send that bounced, the unsubscribe), when there is one. */
  sourceActionId: UuidSchema.nullish(),
});
export type AddSuppressionInput = z.input<typeof AddSuppressionInputSchema>;

/** Addresses per query: with their domains the `in` list stays short enough for the request URL. */
const ADDRESSES_PER_QUERY = 50;
const RecipientsSchema = z.array(z.string().max(254));

const normalise = (address: string): string => address.trim().toLowerCase();
/** The part after the last `@`, or "" for a string without one. */
const domainOf = (address: string): string => {
  const at = address.lastIndexOf("@");
  return at < 0 ? "" : address.slice(at + 1);
};

/**
 * Worker (service role): records that the company must not write to this
 * address, or to this whole domain (an `email` without `@`). The row is
 * append-only history: a second row for the same address is fine and nothing
 * is ever lifted by editing. Returns the new row's id.
 */
export async function addSuppression(db: DbClient, raw: AddSuppressionInput): Promise<string> {
  const input = AddSuppressionInputSchema.parse(raw);
  const { data, error } = await db
    .from("suppressions")
    .insert({ company_id: input.companyId, email: input.email, reason: input.reason, source_action_id: input.sourceActionId ?? null })
    .select("id")
    .single();
  if (error || !data) throw dbError("Could not add suppression", error);
  return data.id;
}

/**
 * Which of these addresses the company must not write to: every input
 * (trimmed, lower-cased, in input order, without repeats) whose exact address
 * is suppressed or whose domain (after the last `@`) is suppressed as a bare
 * domain. A bare-domain row blocks that exact domain, not its subdomains.
 * Reads every matching row (pages past PostgREST's 1000 rows, so a long
 * history of repeats for one address cannot hide another address).
 */
export async function listSuppressed(db: DbClient, companyId: string, emails: readonly string[]): Promise<readonly string[]> {
  const id = UuidSchema.parse(companyId);
  const inputs = [...new Set(RecipientsSchema.parse(emails).map(normalise).filter((a) => a.length > 0))];
  const named = new Set<string>();
  for (let i = 0; i < inputs.length; i += ADDRESSES_PER_QUERY) {
    const chunk = inputs.slice(i, i + ADDRESSES_PER_QUERY);
    const keys = [...new Set(chunk.flatMap((a) => [a, domainOf(a)]).filter((k) => k.length > 0))];
    const rows = await readAllPages(
      (from, to) => db.from("suppressions").select("email").eq("company_id", id).in("email", keys).order("id").range(from, to),
      "Could not read suppressions",
    );
    for (const row of rows) named.add(row.email);
  }
  return Object.freeze(inputs.filter((a) => named.has(a) || named.has(domainOf(a))));
}

/** How many suppression rows the company has, repeats included (what the owner sees under RLS, what the worker sees in full). */
export async function countSuppressions(db: DbClient, companyId: string): Promise<number> {
  const id = UuidSchema.parse(companyId);
  const { count, error } = await db.from("suppressions").select("id", { count: "exact", head: true }).eq("company_id", id);
  if (error) throw dbError("Could not count suppressions", error);
  return count ?? 0;
}
