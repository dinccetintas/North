import { notFound, redirect } from "next/navigation";
import { getOnboardingStep } from "@north/db";
import type { OnboardingStep } from "@north/core/onboarding";
import { companyBySlug } from "@/lib/company";
import { createClient } from "@/lib/supabase/server";
import { errorText } from "@/lib/page-errors";
import { QuestionsStep } from "./steps/questions-step";
import { GoalStep } from "./steps/goal-step";
import { BudgetStep } from "./steps/budget-step";
import { SummaryStep } from "./steps/summary-step";

export const metadata = { title: "Onboarding" };

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<{ error?: string }>;

type WizardStep = Exclude<OnboardingStep, "thesis" | "done">;

/** The DB is the source of truth for the step; `thesis` only exists before the company row, so it renders as questions. */
const toWizardStep = (step: OnboardingStep): WizardStep | "done" => (step === "thesis" ? "questions" : step);

export default async function OnboardingPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ slug }, { error: errorCode }] = await Promise.all([params, searchParams]);
  const error = errorText("onboarding", errorCode);
  const company = await companyBySlug(slug);
  if (!company) notFound();

  const db = await createClient();
  const step = toWizardStep(await getOnboardingStep(db, company.id));
  if (step === "done") redirect(`/c/${slug}`);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6" data-testid="onboarding-step" data-step={step}>
      {error ? (
        <p className="mono-label mb-6 border border-error bg-error-bg px-3 py-3 text-error" role="alert">
          {error}
        </p>
      ) : null}
      {step === "questions" ? <QuestionsStep slug={slug} companyId={company.id} /> : null}
      {step === "goal" ? <GoalStep slug={slug} /> : null}
      {step === "budget" ? <BudgetStep slug={slug} /> : null}
      {step === "summary" ? <SummaryStep slug={slug} companyId={company.id} /> : null}
    </main>
  );
}
