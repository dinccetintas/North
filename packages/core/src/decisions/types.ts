import { z } from "zod";
import { TIERS } from "../tiers";
import { ACTION_KINDS } from "../authority/action";

export const CardOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(80),
});

/** A decision card draft (DEC-2 rules): one question, 2-3 options, a recommendation, a safe default, a deadline. */
export const CardDraftSchema = z.object({
  companyId: z.string().min(1),
  question: z.string().min(1).max(200),
  options: z.array(CardOptionSchema).min(2).max(3),
  recommendedOptionId: z.string().min(1),
  rationale: z.string().min(1).max(600),
  expectedImpact: z.string().max(200).nullable(),
  costUsd: z.number().nonnegative(),
  dueAt: z.string().min(1),
  /** null only for K3 (no default ever applies). */
  defaultOptionId: z.string().nullable(),
  tier: z.enum(TIERS),
  actionKind: z.enum(ACTION_KINDS),
  /** Cards sharing a mergeKey can be combined when the quota is tight. */
  mergeKey: z.string().min(1),
});
export type CardDraft = z.infer<typeof CardDraftSchema>;

export const DEFAULT_DAILY_QUOTA = 3;
export const MIN_DAILY_QUOTA = 1;
export const MAX_DAILY_QUOTA = 5;

export const QuotaSchema = z.number().int().min(MIN_DAILY_QUOTA).max(MAX_DAILY_QUOTA);

export interface AnsweredCard {
  readonly actionKind: CardDraft["actionKind"];
  readonly mergeKey: string;
  readonly answeredOptionId: string;
  readonly answeredAt: string;
  readonly costUsd: number;
}
