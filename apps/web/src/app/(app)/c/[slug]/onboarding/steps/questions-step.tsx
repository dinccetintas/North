import Link from "next/link";
import { currentThesis } from "@north/db";
import { selectLlm } from "@north/agents/llm/client";
import { generateClarifyingQuestions } from "@north/agents/onboarding/clarify";
import { createClient } from "@/lib/supabase/server";
import { answerQuestionsAction } from "../actions";
import { inputClass, WizardHeader } from "./wizard-header";

const ANSWER_MAX_LENGTH = 1000;

/** Step 1: at most five clarifying questions generated from the thesis (deterministic fallback in sandbox). */
export async function QuestionsStep({ slug, companyId }: { slug: string; companyId: string }) {
  const db = await createClient();
  const thesis = await currentThesis(db, companyId);
  if (!thesis) {
    return (
      <>
        <WizardHeader step={1} label="Questions" title="No thesis yet">
          This company has no thesis on record. Start again from the new company form.
        </WizardHeader>
        <Link href="/new" className="retro-button mt-8 inline-block">
          New company
        </Link>
      </>
    );
  }

  const { questions } = await generateClarifyingQuestions(thesis.text, selectLlm(process.env));
  const previous = new Map(thesis.clarifications.map((c) => [c.id, c.answer]));

  return (
    <>
      <WizardHeader step={1} label="Questions" title="A few questions first">
        Short answers are fine. The research agent reads these before it writes the market report; leave a question blank
        if it does not apply.
      </WizardHeader>

      <form action={answerQuestionsAction} className="mt-8 flex flex-col gap-6">
        <input type="hidden" name="slug" value={slug} />
        {questions.map((q, index) => (
          <div key={q.id} className="flex flex-col gap-2">
            <input type="hidden" name={`${q.id}-question`} value={q.question} />
            <label htmlFor={`answer-${q.id}`} className="flex flex-col gap-1">
              <span className="mono-label text-faint">
                {index + 1} of {questions.length}
              </span>
              <span className="text-xl leading-snug">{q.question}</span>
              <span className="text-sm text-muted">{q.why}</span>
            </label>
            <textarea
              id={`answer-${q.id}`}
              name={`answer-${q.id}`}
              data-testid={`answer-${q.id}`}
              rows={3}
              maxLength={ANSWER_MAX_LENGTH}
              placeholder={q.placeholder}
              defaultValue={previous.get(q.id) ?? ""}
              className={inputClass}
            />
          </div>
        ))}
        <button type="submit" className="retro-button retro-button-primary self-start" data-testid="questions-continue">
          Continue
        </button>
      </form>
    </>
  );
}
