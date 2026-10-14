import { ACTION_KINDS, BUDGET_CATEGORIES, type AutoRule } from "@north/core";
import { z } from "zod";
import type { DbClient } from "./client";
import { DbError, dbError } from "./errors";
import { UuidSchema } from "./json";

export const CreateAutoRuleInputSchema = z.object({
  companyId: UuidSchema,
  kind: z.enum(ACTION_KINDS),
  maxAmountUsd: z.number().nonnegative().optional(),
  category: z.enum(BUDGET_CATEGORIES).optional(),
  createdFromCardId: UuidSchema.optional(),
});
export type CreateAutoRuleInput = z.input<typeof CreateAutoRuleInputSchema>;

const RULE_COLUMNS = "id, kind, max_amount_usd, category, active";

const RuleRowSchema = z.object({
  id: z.string(),
  kind: z.enum(ACTION_KINDS),
  max_amount_usd: z.coerce.number().nullable(),
  category: z.enum(BUDGET_CATEGORIES).nullable(),
  active: z.boolean(),
});

/** Maps a row to the core `AutoRule`, leaving optional fields out instead of setting them to undefined. */
export function toAutoRule(row: unknown): AutoRule {
  const r = RuleRowSchema.parse(row);
  return Object.freeze({
    id: r.id,
    kind: r.kind,
    ...(r.max_amount_usd === null ? {} : { maxAmountUsd: r.max_amount_usd }),
    ...(r.category === null ? {} : { category: r.category }),
    active: r.active,
  });
}

/** DEC-3: a standing answer the CEO accepted ("don't ask again for ads under $50"). */
export async function createAutoRule(db: DbClient, input: CreateAutoRuleInput): Promise<AutoRule> {
  const rule = CreateAutoRuleInputSchema.parse(input);
  const { data, error } = await db
    .from("auto_rules")
    .insert({
      company_id: rule.companyId,
      kind: rule.kind,
      max_amount_usd: rule.maxAmountUsd ?? null,
      category: rule.category ?? null,
      created_from_card_id: rule.createdFromCardId ?? null,
    })
    .select(RULE_COLUMNS)
    .single();
  if (error || !data) throw dbError("Could not create auto rule", error);
  return toAutoRule(data);
}

/** Active rules in the shape the authority gate consumes. */
export async function listActiveAutoRules(db: DbClient, companyId: string): Promise<readonly AutoRule[]> {
  const id = UuidSchema.parse(companyId);
  const { data, error } = await db.from("auto_rules").select(RULE_COLUMNS).eq("company_id", id).eq("active", true).order("created_at", { ascending: true });
  if (error) throw dbError("Could not list auto rules", error);
  return Object.freeze((data ?? []).map(toAutoRule));
}

/** Turns a rule off. Rules are never deleted so the audit trail can explain past auto-approvals. */
export async function deactivateAutoRule(db: DbClient, companyId: string, ruleId: string): Promise<void> {
  const company = UuidSchema.parse(companyId);
  const id = UuidSchema.parse(ruleId);
  const { data, error } = await db.from("auto_rules").update({ active: false }).eq("id", id).eq("company_id", company).select("id").maybeSingle();
  if (error) throw dbError("Could not deactivate auto rule", error);
  if (!data) throw new DbError(`Auto rule ${id} not found for company ${company}`);
}
