import { z } from "zod";
import { BUDGET_CATEGORIES } from "./authority/action";
import { OUTCOME_METRIC_KEYS } from "./tasks/types";

/** ONB-1: at most five clarifying questions after the idea text. */
export const MAX_CLARIFYING_QUESTIONS = 5;

export const ClarifyingQuestionSchema = z.object({
  id: z.string().regex(/^q[1-5]$/),
  question: z.string().min(5).max(200),
  why: z.string().min(1).max(200),
  placeholder: z.string().max(120).default(""),
});
export const ClarifyingQuestionsSchema = z.object({
  questions: z.array(ClarifyingQuestionSchema).min(1).max(MAX_CLARIFYING_QUESTIONS),
});
export type ClarifyingQuestion = z.infer<typeof ClarifyingQuestionSchema>;
export type ClarifyingQuestions = z.infer<typeof ClarifyingQuestionsSchema>;

export const ClarificationAnswersSchema = z.array(
  z.object({ id: z.string().regex(/^q[1-5]$/), question: z.string().min(1), answer: z.string().trim().max(1000) }),
);
export type ClarificationAnswers = z.infer<typeof ClarificationAnswersSchema>;

/** ONB-2: one measurable goal. Goals point at outcomes only, never at channel metrics such as clicks. */
export const GoalInputSchema = z.object({
  metricKey: z.enum(OUTCOME_METRIC_KEYS),
  targetValue: z.number().positive(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type GoalInput = z.infer<typeof GoalInputSchema>;

/** ONB-2: budget per category with daily caps. */
export const BudgetLineSchema = z.object({
  category: z.enum(BUDGET_CATEGORIES),
  totalLimitUsd: z.number().nonnegative().max(1_000_000),
  dailyLimitUsd: z.number().nonnegative().max(100_000),
});
export const BudgetInputSchema = z.array(BudgetLineSchema).min(1).max(BUDGET_CATEGORIES.length);
export type BudgetInput = z.infer<typeof BudgetInputSchema>;

export const ONBOARDING_STEPS = ["thesis", "questions", "goal", "budget", "summary", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Next step after the current one; `done` stays `done`. */
export function nextOnboardingStep(step: OnboardingStep): OnboardingStep {
  const i = ONBOARDING_STEPS.indexOf(step);
  return ONBOARDING_STEPS[Math.min(i + 1, ONBOARDING_STEPS.length - 1)] ?? "done";
}

/** Deterministic fallback questions used when no LLM is configured (sandbox mode). */
export function fallbackQuestions(thesis: string): ClarifyingQuestions {
  const short = thesis.trim().slice(0, 60);
  return {
    questions: [
      { id: "q1", question: "Who exactly pays for this, and what do they use today instead?", why: "Defines the target customer and the alternative we replace.", placeholder: "e.g. B2B agencies with 5-20 staff, currently using freelancers" },
      { id: "q2", question: "What is the smallest version a customer would pay for in the first 30 days?", why: "Scopes the first build.", placeholder: "e.g. one onboarding form and a weekly report" },
      { id: "q3", question: `Why now for "${short}"? What changed in the market or in your life?`, why: "The why-now goes into the thesis.", placeholder: "" },
      { id: "q4", question: "How will you know it works: which number, by when?", why: "Becomes the first goal.", placeholder: "e.g. 10 paying customers in 60 days" },
      { id: "q5", question: "What must the agents never do on your behalf?", why: "Becomes standing rules in the authority engine.", placeholder: "e.g. never email my existing clients" },
    ],
  };
}
