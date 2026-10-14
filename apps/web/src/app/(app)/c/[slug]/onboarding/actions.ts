"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createGoal,
  getCompanyBySlug,
  saveClarifications,
  setOnboardingStep,
  upsertBudgets,
  type CompanySummary,
  type DbClient,
} from "@north/db";
import { BudgetInputSchema, ClarificationAnswersSchema, GoalInputSchema, MAX_CLARIFYING_QUESTIONS } from "@north/core/onboarding";
import { BUDGET_CATEGORIES } from "@north/core/authority/action";
import { EVENT } from "@north/core/events";
import { createClient, currentUser } from "@/lib/supabase/server";
import { inngest } from "@/inngest/client";

const SlugSchema = z.string().trim().min(1).max(200);

interface ActionContext {
  readonly db: DbClient;
  readonly company: CompanySummary;
  readonly slug: string;
}

/** Resolves the company from the form's slug under RLS; never trusts a posted company id. */
async function loadContext(formData: FormData): Promise<ActionContext> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const slug = SlugSchema.safeParse(formData.get("slug"));
  if (!slug.success) redirect("/companies");
  const db = await createClient();
  const company = await getCompanyBySlug(db, slug.data);
  if (!company) redirect("/companies");
  return { db, company, slug: slug.data };
}

const wizardUrl = (slug: string, error?: string): string =>
  error ? `/c/${slug}/onboarding?error=${encodeURIComponent(error)}` : `/c/${slug}/onboarding`;

const errorMessage = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback);

/** Runs a DB write and returns an error string instead of throwing, so `redirect()` can run outside try/catch. */
async function attempt(work: () => Promise<void>, fallback: string): Promise<string | null> {
  try {
    await work();
    return null;
  } catch (error) {
    console.error("[onboarding]", fallback, error);
    return errorMessage(error, fallback);
  }
}

const numberField = (formData: FormData, name: string): number => Number(String(formData.get(name) ?? "").trim());

function readAnswers(formData: FormData): unknown[] {
  return Array.from({ length: MAX_CLARIFYING_QUESTIONS }, (_, i) => `q${i + 1}`)
    .filter((id) => formData.has(`${id}-question`))
    .map((id) => ({ id, question: String(formData.get(`${id}-question`) ?? ""), answer: String(formData.get(`answer-${id}`) ?? "") }));
}

/** Step 1: store the clarifying answers on the current thesis and move to the goal step. */
export async function answerQuestionsAction(formData: FormData): Promise<void> {
  const { db, company, slug } = await loadContext(formData);
  const parsed = ClarificationAnswersSchema.safeParse(readAnswers(formData));
  if (!parsed.success || parsed.data.length === 0) {
    redirect(wizardUrl(slug, "Each answer can be at most 1000 characters."));
  }
  const failure = await attempt(async () => {
    await saveClarifications(db, company.id, parsed.data);
    await setOnboardingStep(db, company.id, "goal");
  }, "Could not save your answers");
  redirect(wizardUrl(slug, failure ?? undefined));
}

/** Step 2: one measurable goal. */
export async function saveGoalAction(formData: FormData): Promise<void> {
  const { db, company, slug } = await loadContext(formData);
  const parsed = GoalInputSchema.safeParse({
    metricKey: formData.get("metricKey"),
    targetValue: numberField(formData, "targetValue"),
    dueDate: formData.get("dueDate"),
  });
  if (!parsed.success) {
    redirect(wizardUrl(slug, "Pick a metric, a target above zero and a due date."));
  }
  const failure = await attempt(async () => {
    await createGoal(db, company.id, parsed.data);
    await setOnboardingStep(db, company.id, "budget");
  }, "Could not save the goal");
  redirect(wizardUrl(slug, failure ?? undefined));
}

/** Step 3: total and daily caps per budget category. */
export async function saveBudgetAction(formData: FormData): Promise<void> {
  const { db, company, slug } = await loadContext(formData);
  const parsed = BudgetInputSchema.safeParse(
    BUDGET_CATEGORIES.map((category) => ({
      category,
      totalLimitUsd: numberField(formData, `${category}-total`),
      dailyLimitUsd: numberField(formData, `${category}-daily`),
    })),
  );
  if (!parsed.success) {
    redirect(wizardUrl(slug, "Budgets must be numbers of zero or more."));
  }
  const failure = await attempt(async () => {
    await upsertBudgets(db, company.id, parsed.data);
    await setOnboardingStep(db, company.id, "summary");
  }, "Could not save the budgets");
  redirect(wizardUrl(slug, failure ?? undefined));
}

/** Step 4: approve; the worker starts the first 24 hours of work. */
export async function approvePlanAction(formData: FormData): Promise<void> {
  const { db, company, slug } = await loadContext(formData);
  const failure = await attempt(async () => {
    await setOnboardingStep(db, company.id, "done");
    await inngest.send({ name: EVENT.companyOnboarded, data: { companyId: company.id } });
  }, "Could not start the company");
  if (failure) redirect(wizardUrl(slug, failure));
  revalidatePath(`/c/${slug}`, "layout");
  redirect(`/c/${slug}`);
}
