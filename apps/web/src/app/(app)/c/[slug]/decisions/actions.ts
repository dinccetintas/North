"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AlreadyAnsweredError, answerCard, createAutoRule, getCard, getCompanyBySlug, type CardRecord, type DbClient } from "@north/db";
import { ACTION_KINDS, BUDGET_CATEGORIES } from "@north/core/authority/action";
import { EVENT } from "@north/core/events";
import { createClient, currentUser } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";

export type ActionResult<T = undefined> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

const AnswerInputSchema = z.object({ slug: z.string().trim().min(1).max(200), cardId: z.string().uuid(), optionId: z.string().min(1).max(80) });
export type AnswerInput = z.input<typeof AnswerInputSchema>;

const AutoRuleInputSchema = z.object({
  slug: z.string().trim().min(1).max(200),
  cardId: z.string().uuid(),
  kind: z.enum(ACTION_KINDS),
  maxAmountUsd: z.number().nonnegative().optional(),
  category: z.enum(BUDGET_CATEGORIES).optional(),
});
export type AutoRuleInput = z.input<typeof AutoRuleInputSchema>;

/** The card under RLS, checked against the company the URL names; null when either is not the caller's. */
async function ownedCard(db: DbClient, slug: string, cardId: string): Promise<CardRecord | null> {
  const [company, card] = await Promise.all([getCompanyBySlug(db, slug), getCard(db, cardId)]);
  if (!company || !card || card.companyId !== company.id) return null;
  return card;
}

const message = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback);

/**
 * DEC-2: one tap answers a card. The answer is written under RLS first, then the
 * worker is told so the waiting task resumes within two seconds. A second answer
 * is refused but reported as success so a double tap never shows an error.
 */
export async function answerCardAction(input: AnswerInput): Promise<ActionResult<{ readonly optionId: string }>> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = AnswerInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { slug, cardId, optionId } = parsed.data;

  const db = await createClient();
  const card = await ownedCard(db, slug, cardId);
  if (!card) return { ok: false, error: "Card not found" };

  try {
    await answerCard(db, cardId, { optionId, answeredBy: "user" });
  } catch (error) {
    if (!(error instanceof AlreadyAnsweredError)) return { ok: false, error: message(error, "Could not record the answer") };
    revalidatePath(`/c/${slug}`, "layout");
    return { ok: true, value: { optionId: card.answeredOptionId ?? optionId } };
  }
  await inngest.send({ name: EVENT.decisionAnswered, data: { companyId: card.companyId, cardId, optionId, answeredBy: "user" } });
  revalidatePath(`/c/${slug}`, "layout");
  return { ok: true, value: { optionId } };
}

/** DEC-3: "Don't ask again" accepted by the CEO on the card detail page becomes a standing auto rule. */
export async function acceptAutoRuleAction(input: AutoRuleInput): Promise<ActionResult> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = AutoRuleInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { slug, cardId, kind, maxAmountUsd, category } = parsed.data;

  const db = await createClient();
  const card = await ownedCard(db, slug, cardId);
  if (!card) return { ok: false, error: "Card not found" };
  if (card.actionKind !== kind) return { ok: false, error: "The rule must match the card's action" };

  try {
    await createAutoRule(db, {
      companyId: card.companyId,
      kind,
      createdFromCardId: cardId,
      ...(maxAmountUsd === undefined ? {} : { maxAmountUsd }),
      ...(category === undefined ? {} : { category }),
    });
  } catch (error) {
    return { ok: false, error: message(error, "Could not save the rule") };
  }
  revalidatePath(`/c/${slug}`, "layout");
  revalidatePath("/settings");
  return { ok: true, value: undefined };
}
