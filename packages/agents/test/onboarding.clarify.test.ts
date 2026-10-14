import { describe, expect, it } from "vitest";
import { fallbackQuestions } from "@north/core";
import { LlmError, MockLlm, type LlmClient } from "../src/llm/client";
import { CLARIFY_LLM_KEY, generateClarifyingQuestions } from "../src/onboarding/clarify";

const THESIS = "Bookkeeping for solo consultants that closes the month in one click.";

const question = (n: number) => ({ id: `q${n}`, question: `Question number ${n} about the thesis?`, why: "because", placeholder: "" });

describe("generateClarifyingQuestions", () => {
  it("returns the scripted questions from MockLlm (at most five) using the classifier model", async () => {
    const llm = MockLlm.fromRecord({ [CLARIFY_LLM_KEY]: { questions: [question(1), question(2), question(3)] } });
    const result = await generateClarifyingQuestions(THESIS, llm);
    expect(result.questions).toHaveLength(3);
    expect(result.questions[0]?.id).toBe("q1");
    expect(llm.history[0]?.model).toBe("classifier");
    expect(llm.history[0]?.user).toContain(THESIS);
  });

  it("falls back to the deterministic questions when the mock has no script", async () => {
    const result = await generateClarifyingQuestions(THESIS, new MockLlm());
    expect(result).toEqual(fallbackQuestions(THESIS));
    expect(result.questions.length).toBeLessThanOrEqual(5);
  });

  it("falls back when the model returns more than five questions (schema rejects)", async () => {
    const llm = MockLlm.fromRecord({ [CLARIFY_LLM_KEY]: { questions: [1, 2, 3, 4, 5, 6].map(question) } });
    const result = await generateClarifyingQuestions(THESIS, llm);
    expect(result).toEqual(fallbackQuestions(THESIS));
  });

  it("falls back when the client throws any error", async () => {
    const llm: LlmClient = { name: "anthropic", structured: async () => Promise.reject(new LlmError("rate limited", 429)) };
    const result = await generateClarifyingQuestions(THESIS, llm);
    expect(result.questions.length).toBe(5);
  });

  it("does not call the model for an empty thesis", async () => {
    const llm = new MockLlm();
    const result = await generateClarifyingQuestions("   ", llm);
    expect(llm.history).toHaveLength(0);
    expect(result.questions.length).toBe(5);
  });
});
