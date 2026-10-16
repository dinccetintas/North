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
import { withError, type ErrorCode } from "@/lib/page-errors";

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

type WizardError = ErrorCode<"onboarding">;

/** M6 review L8: an error is a code the page maps to its fixed line; the database's message goes to the server log only. */
const wizardUrl = (slug: string, error?: WizardError): string => (error ? withError(`/c/${slug}/onboarding`, "onboarding", error) : `/c/${slug}/onboarding`);

/** Runs a DB write and returns the step's error code instead of throwing, so `redirect()` can run outside try/catch. */
async function attempt(work: () => Promise<void>, failure: WizardError): Promise<WizardError | null> {
  try {
    await work();
    return null;
  } catch (error) {
    console.error("[onboarding]", failure, error);
    return failure;
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
    redirect(wizardUrl(slug, "answers-invalid"));
  }
  const failure = await attempt(async () => {
    await saveClarifications(db, company.id, parsed.data);
    await setOnboardingStep(db, company.id, "goal");
  }, "answers-failed");
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
    redirect(wizardUrl(slug, "goal-invalid"));
  }
  const failure = await attempt(async () => {
    await createGoal(db, company.id, parsed.data);
    await setOnboardingStep(db, company.id, "budget");
  }, "goal-failed");
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
    redirect(wizardUrl(slug, "budget-invalid"));
  }
  const failure = await attempt(async () => {
    await upsertBudgets(db, company.id, parsed.data);
    await setOnboardingStep(db, company.id, "summary");
  }, "budget-failed");
  redirect(wizardUrl(slug, failure ?? undefined));
}

/** Step 4: approve; the worker starts the first 24 hours of work. */
export async function approvePlanAction(formData: FormData): Promise<void> {
  const { db, company, slug } = await loadContext(formData);
  const failure = await attempt(async () => {
    await setOnboardingStep(db, company.id, "done");
    await inngest.send({ name: EVENT.companyOnboarded, data: { companyId: company.id } });
  }, "start-failed");
  if (failure) redirect(wizardUrl(slug, failure));
  revalidatePath(`/c/${slug}`, "layout");
  redirect(`/c/${slug}`);
}
