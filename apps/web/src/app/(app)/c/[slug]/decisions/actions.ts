"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AlreadyAnsweredError, answerCard, createAutoRule, getCard, getCompanyBySlug, listActiveAutoRules, listAnsweredCards, type CardRecord, type DbClient } from "@north/db";
import { ACTION_KINDS, BUDGET_CATEGORIES } from "@north/core/authority/action";
import { suggestAutoRule } from "@north/core/decisions/autorule";
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
  maxAmountUsd: z.number().nonnegative(),
  category: z.enum(BUDGET_CATEGORIES).optional(),
});
export type AutoRuleInput = z.input<typeof AutoRuleInputSchema>;

const GENERIC_ERROR = "Something went wrong; nothing was changed. Try again.";

/** The card under RLS, checked against the company the URL names; null when either is not the caller's. */
async function ownedCard(db: DbClient, slug: string, cardId: string): Promise<CardRecord | null> {
  const [company, card] = await Promise.all([getCompanyBySlug(db, slug), getCard(db, cardId)]);
  if (!company || !card || card.companyId !== company.id) return null;
  return card;
}

/** Tells the worker a card was answered. The answer already stands in the database; the event only wakes settlement. */
async function wakeWorker(companyId: string, cardId: string, optionId: string): Promise<boolean> {
  try {
    await inngest.send({ name: EVENT.decisionAnswered, data: { companyId, cardId, optionId, answeredBy: "user" } });
    return true;
  } catch (error) {
    console.error("[decisions] could not send decision/answered", cardId, error);
    return false;
  }
}

/**
 * DEC-2: one tap answers a card. The answer is written under RLS first, then the
 * worker is woken so settlement happens within two seconds. A second tap on an
 * already answered card re-sends the wake-up (harmless) and reports success,
 * so a double tap or a lost event never shows an error.
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

  let recorded = optionId;
  try {
    await answerCard(db, cardId, { optionId, answeredBy: "user" });
  } catch (error) {
    if (!(error instanceof AlreadyAnsweredError)) {
      console.error("[decisions] answerCard failed", cardId, error);
      return { ok: false, error: GENERIC_ERROR };
    }
    recorded = card.answeredOptionId ?? optionId;
  }
  const woke = await wakeWorker(card.companyId, cardId, recorded);
  revalidatePath(`/c/${slug}`, "layout");
  return woke ? { ok: true, value: { optionId: recorded } } : { ok: false, error: "Your answer is saved, but the agents could not be notified yet. It will be picked up within 15 minutes." };
}

/**
 * DEC-3: "Don't ask again" accepted by the CEO becomes a standing auto rule.
 * The server recomputes the suggestion from the answer history; the client's
 * parameters must match it (same kind and category, a ceiling no higher than
 * the repeated approvals) and the card itself must have been approved.
 */
export async function acceptAutoRuleAction(input: AutoRuleInput): Promise<ActionResult> {
  const user = await currentUser();
  if (!user) return { ok: false, error: "Not signed in" };
  const parsed = AutoRuleInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid input" };
  const { slug, cardId, kind, maxAmountUsd, category } = parsed.data;

  const db = await createClient();
  const card = await ownedCard(db, slug, cardId);
  if (!card) return { ok: false, error: "Card not found" };
  if (card.actionKind !== kind || card.answeredOptionId !== "approve") return { ok: false, error: "A rule can only follow an approved card for the same action" };

  const [history, rules] = await Promise.all([listAnsweredCards(db, card.companyId, kind), listActiveAutoRules(db, card.companyId)]);
  const suggestion = suggestAutoRule(history);
  const matches = suggestion && suggestion.kind === kind && (suggestion.category ?? undefined) === category && maxAmountUsd <= suggestion.maxAmountUsd;
  if (!matches) return { ok: false, error: "This decision has not been repeated enough times to become a rule" };
  if (rules.some((r) => r.kind === kind && (r.category ?? undefined) === category)) return { ok: false, error: "A rule for this action already exists" };

  try {
    await createAutoRule(db, { companyId: card.companyId, kind, createdFromCardId: cardId, maxAmountUsd, ...(category === undefined ? {} : { category }) });
  } catch (error) {
    console.error("[decisions] createAutoRule failed", cardId, error);
    return { ok: false, error: GENERIC_ERROR };
  }
  revalidatePath(`/c/${slug}`, "layout");
  revalidatePath("/settings");
  return { ok: true, value: undefined };
}
