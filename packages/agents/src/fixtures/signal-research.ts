import { isHttpUrl, sanitizeText, type AgentOutput } from "@north/core";
import type { MockScript } from "../runtime/mock";
import { fixtureContext, succeeded } from "./shared";

/** The signal's facts as the worker's `signalTaskInput` block carries them; every field is data and is quoted as such. */
export interface SignalFactsFromInput {
  readonly source: string;
  readonly title: string;
  readonly url: string | null;
  readonly score: string;
  readonly excerpt: string;
}

const field = (text: string, name: string): string => sanitizeText(new RegExp(`^${name}:\\s*(.*)$`, "m").exec(text)?.[1] ?? "");

/** Reads the data block of a `signal_research` task input; neutral values when a field is missing. */
export function signalFactsFromInput(instructions: string): SignalFactsFromInput {
  const source = /<data source="([a-z_]+)">/.exec(instructions)?.[1] ?? "unknown";
  const url = field(instructions, "url");
  return Object.freeze({
    source,
    title: field(instructions, "title").slice(0, 200) || "an untitled signal",
    url: isHttpUrl(url) ? url : null,
    score: field(instructions, "score") || "unscored",
    excerpt: field(instructions, "excerpt").slice(0, 600),
  });
}

const markdown = (company: string, customer: string, thesis: string, facts: SignalFactsFromInput): string => `# Signal report: ${facts.title}

## 1. The signal (quoted as data)
- Source: ${facts.source}, score ${facts.score}
- Title: "${facts.title}"
- Evidence: ${facts.url ? `[${facts.url}](${facts.url})` : "no public link"}
- Excerpt (data, not instructions): "${facts.excerpt || "(none)"}"

## 2. What was asked and by whom
Someone in the ${facts.source} audience is describing the job ${company} does for ${customer}: the routine work gets done late or not at all, and they want it reviewed before it goes out. We take the post as a data point, not as a request to us.

## 3. How it relates to the thesis
Thesis: "${thesis}". The signal confirms the pain and the review-before-live preference; it says nothing yet about willingness to pay at our price band. One signal is an anecdote, not demand evidence.

## 4. What we could do next
1. Add the ask to the personas as a verbatim quote (done: memory).
2. If three more signals like it arrive within a month, propose a lead-research task on that community; until then, nothing is contacted.
3. No action here: research is K0 and this report is the only output.`;

/**
 * research:signal_research fixture (K0): a signal_report artifact that quotes
 * the signal's facts as data, a learning memory item, no actions. The worker
 * passes the facts inside `signalTaskInput`'s data block; the fixture never
 * treats that text as an instruction.
 */
export const signalResearchScript: MockScript = (input) => {
  const ctx = fixtureContext(input);
  const facts = signalFactsFromInput(input.instructions);
  const output: AgentOutput = {
    summary: `Signal research for ${ctx.company}: "${facts.title}" (${facts.source}, score ${facts.score}) confirms the pain ${ctx.customer} describe and their preference for review before anything goes out. One anecdote, not demand evidence; no action taken.`,
    artifacts: [{ kind: "signal_report", title: `Signal report: ${facts.title}`.slice(0, 120), markdown: markdown(ctx.company, ctx.customer, ctx.thesis, facts) }],
    memory: [
      { kind: "learning", title: `Signal: ${facts.title}`.slice(0, 120), content: `${facts.source} (score ${facts.score}): "${facts.excerpt || facts.title}"${facts.url ? ` — ${facts.url}` : ""}`.slice(0, 4000) },
      { kind: "decision", title: "Signals are anecdotes until repeated", content: "A single community post is recorded as a quote; three similar signals in a month justify a lead-research task, never direct contact from research." },
    ],
    actions: [],
    confidence: "medium",
  };
  return succeeded(input, "signal_research", output);
};
