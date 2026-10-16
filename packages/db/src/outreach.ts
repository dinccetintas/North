import { MAX_BATCH_SIZE } from "@north/core";
import { z } from "zod";
import { actionInsertRow, type ActionStatus, type RecordActionInput } from "./actions";
import type { DbClient } from "./client";
import { cardInsertRow, isQuotaError, QuotaExceededError, toCardRecord, type CardRecord, type OpenCardInput } from "./decisions";
import { dbError } from "./errors";
import { UuidSchema } from "./json";
import { countLeads, listLeads, MAX_EMAIL_FILTER, type LeadRecord } from "./leads";
import { PAGE_ROWS } from "./paging";

/**
 * SLS-K2 / DEC-3: a lead is in at most one open first-contact batch. An open
 * `email.send.first_contact` holds every address its batch names (`to` and
 * the whole `recipients` list, so the leads of a card whose later sends are
 * not attached yet are held too); the next batch receives only the oldest
 * `new` leads nobody holds, and a first contact's card opens only through
 * `open_first_contact_card` (0017), atomically under the company's lock. A
 * second card for the same people would spend a decision of the owner's
 * quota and fail when approved.
 */

/**
 * Chain-head statuses that keep a first contact open: `pending` is the only
 * one (its card waits for an answer, or the approved send waits to be
 * performed; the kill switch holds it there). `executed`, `declined`,
 * `failed` and `blocked` (a quota-deferred send has no card yet) are settled.
 * `held_outreach_addresses` in 0017 is the definition; this documents it.
 */
export const OPEN_FIRST_CONTACT_STATUSES: readonly ActionStatus[] = Object.freeze(["pending"]);

const AddressesSchema = z.array(z.string());

/** The lowercased addresses every open first contact of the company names (0017 `held_outreach_addresses`; under RLS for an owner). */
export async function heldOutreachRecipients(db: DbClient, companyId: string): Promise<ReadonlySet<string>> {
  const id = UuidSchema.parse(companyId);
  const { data, error } = await db.rpc("held_outreach_addresses", { p_company: id });
  if (error) throw dbError("Could not list held outreach addresses", error);
  return new Set(AddressesSchema.parse(data ?? []));
}

/**
 * What an outreach batch receives: the oldest `new` leads (≤ `limit`, at most
 * a batch's fifty) that no open first contact of the company holds. Empty
 * when every new lead is held, exactly as for a company with no new lead.
 */
export async function leadsFreeForOutreach(db: DbClient, companyId: string, limit = 5): Promise<readonly LeadRecord[]> {
  const id = UuidSchema.parse(companyId);
  const want = z.number().int().positive().max(MAX_BATCH_SIZE).parse(limit);
  const held = await heldOutreachRecipients(db, id);
  // At most `held.size` leads of a page are skipped, so one page of this size usually suffices.
  const size = Math.min(PAGE_ROWS, want + held.size);
  const free: LeadRecord[] = [];
  for (let offset = 0; free.length < want; ) {
    const page = await listLeads(db, id, { status: ["new"], limit: size, offset });
    if (page.length === 0) break;
    free.push(...page.filter((l) => !held.has(l.email.toLowerCase())));
    offset += page.length;
  }
  return Object.freeze(free.slice(0, want));
}

/** How many `new` leads no open first contact holds: what plan_week passes as `leads.count` (0 means no outreach run this week). */
export async function countLeadsFreeForOutreach(db: DbClient, companyId: string): Promise<number> {
  const id = UuidSchema.parse(companyId);
  const [total, held] = await Promise.all([countLeads(db, id, { status: ["new"] }), heldOutreachRecipients(db, id)]);
  const addresses = [...held];
  let heldNew = 0;
  for (let i = 0; i < addresses.length; i += MAX_EMAIL_FILTER) {
    heldNew += await countLeads(db, id, { status: ["new"], emails: addresses.slice(i, i + MAX_EMAIL_FILTER) });
  }
  return Math.max(0, total - heldNew);
}

export interface FirstContactOpenInput {
  readonly card: OpenCardInput;
  /** The pending first contact the card decides on; its status and card are set by the database. */
  readonly action: Omit<RecordActionInput, "status" | "decisionCardId" | "autoRuleId">;
}

export type FirstContactOpen =
  | { readonly kind: "opened"; readonly card: CardRecord; readonly actionId: string }
  /** An address of the send is held by another open first contact; nothing was written. */
  | { readonly kind: "held"; readonly email: string };

const OpenResultSchema = z.union([z.object({ held: z.string() }), z.object({ card: z.unknown(), action_id: z.string() })]);
const AutoResultSchema = z.union([z.object({ held: z.string() }), z.object({ action_id: z.string() })]);

export type AutoFirstContactRecord =
  | { readonly kind: "recorded"; readonly actionId: string }
  /** The send's recipient is held by another open first contact; nothing was written. */
  | { readonly kind: "held"; readonly email: string };

/**
 * Worker only (service role): records an auto-approved first contact's
 * pending row (its auto rule instead of a card) under the company's outreach
 * lock (0017), or reports its recipient held and writes nothing. Each send of
 * an auto-approved batch is checked on its own recipient.
 */
export async function recordAutoFirstContact(db: DbClient, input: Omit<RecordActionInput, "status" | "decisionCardId">): Promise<AutoFirstContactRecord> {
  const action = actionInsertRow({ ...input, status: "pending" });
  if (action.kind !== "email.send.first_contact" || action.auto_rule_id === null) throw new Error("recordAutoFirstContact: an auto-approved email.send.first_contact is required");
  const { data, error } = await db.rpc("record_auto_first_contact", { p_action: action });
  if (error) throw dbError("Could not record the auto-approved first contact", error);
  const result = AutoResultSchema.parse(data);
  return Object.freeze("held" in result ? { kind: "held", email: result.held } : { kind: "recorded", actionId: result.action_id });
}

/**
 * Worker only (service role): opens a first contact's card and records its
 * pending action in one transaction under the company's outreach lock (0017),
 * or reports the first held address and writes nothing. A spent quota writes
 * nothing either and throws `QuotaExceededError` (DEC-3: defer, not drop).
 */
export async function openFirstContactCard(db: DbClient, input: FirstContactOpenInput): Promise<FirstContactOpen> {
  const card = cardInsertRow(input.card);
  const action = actionInsertRow({ ...input.action, status: "pending" });
  if (card.action_kind !== "email.send.first_contact" || action.kind !== "email.send.first_contact") throw new Error("openFirstContactCard: only email.send.first_contact");
  if (card.company_id !== action.company_id) throw new Error("openFirstContactCard: the card and the action must name the same company");
  const { data, error } = await db.rpc("open_first_contact_card", { p_card: card, p_action: action });
  if (isQuotaError(error)) throw new QuotaExceededError(`Daily decision quota reached for company ${card.company_id}`, error);
  if (error) throw dbError("Could not open the first contact's card", error);
  const result = OpenResultSchema.parse(data);
  if ("held" in result) return Object.freeze({ kind: "held", email: result.held });
  return Object.freeze({ kind: "opened", card: toCardRecord(result.card), actionId: result.action_id });
}
