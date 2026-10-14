import { ClarificationAnswersSchema, type ClarificationAnswers } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { UuidSchema } from "./json";
import type { Json } from "./types";

export interface ThesisRecord {
  readonly id: string;
  readonly version: number;
  readonly text: string;
  readonly targetCustomer: string;
  readonly whyNow: string;
  readonly clarifications: ClarificationAnswers;
}

export const ThesisVersionInputSchema = z.object({
  text: z.string().trim().min(10).max(4000),
  targetCustomer: z.string().trim().max(500).default(""),
  whyNow: z.string().trim().max(500).default(""),
});
export type ThesisVersionInput = z.input<typeof ThesisVersionInputSchema>;

const THESIS_COLUMNS = "id, version, text, target_customer, why_now, clarifications";

type ThesisRow = {
  id: string;
  version: number;
  text: string;
  target_customer: string;
  why_now: string;
  clarifications: Json;
};

function toRecord(row: ThesisRow): ThesisRecord {
  const parsed = ClarificationAnswersSchema.safeParse(row.clarifications);
  if (!parsed.success) {
    throw new DbError(`Thesis ${row.id} has malformed clarifications`, parsed.error);
  }
  return Object.freeze({
    id: row.id,
    version: row.version,
    text: row.text,
    targetCustomer: row.target_customer,
    whyNow: row.why_now,
    clarifications: parsed.data,
  });
}

/** Highest thesis version of the company, or null when the company has none (or is not visible). */
export async function currentThesis(db: DbClient, companyId: string): Promise<ThesisRecord | null> {
  const id = UuidSchema.parse(companyId);
  const { data, error } = await db
    .from("theses")
    .select(THESIS_COLUMNS)
    .eq("company_id", id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw dbError("Could not load thesis", error);
  return data ? toRecord(data) : null;
}

/** ONB-1: stores the clarifying-question answers on the current thesis version. */
export async function saveClarifications(db: DbClient, companyId: string, answers: ClarificationAnswers): Promise<void> {
  const validated = ClarificationAnswersSchema.parse(answers);
  const current = await currentThesis(db, companyId);
  if (!current) throw new DbError(`Company ${companyId} has no thesis to attach clarifications to`);
  const { data, error } = await db
    .from("theses")
    .update({ clarifications: validated })
    .eq("id", current.id)
    .select("id");
  if (error) throw dbError("Could not save clarifications", error);
  if (!data || data.length === 0) throw new DbError(`Thesis ${current.id} was not updated`);
}

/**
 * Appends a new thesis version (current + 1). The previous version's
 * clarifications are carried forward so the refined thesis keeps its context.
 */
export async function addThesisVersion(
  db: DbClient,
  companyId: string,
  input: ThesisVersionInput,
): Promise<{ readonly id: string; readonly version: number }> {
  const id = UuidSchema.parse(companyId);
  const parsed = ThesisVersionInputSchema.parse(input);
  const current = await currentThesis(db, id);
  const version = (current?.version ?? 0) + 1;
  const { data, error } = await db
    .from("theses")
    .insert({
      company_id: id,
      version,
      text: parsed.text,
      target_customer: parsed.targetCustomer,
      why_now: parsed.whyNow,
      clarifications: current ? [...current.clarifications] : [],
    })
    .select("id, version")
    .single();
  if (error || !data) throw dbError("Could not add thesis version", error);
  return Object.freeze({ id: data.id, version: data.version });
}
