import type { AgentOutput, LeadDraft } from "@north/core";
import type { MockScript } from "../runtime/mock";
import { fixtureContext, succeeded } from "./shared";

/** Five prospects "from public research" on the reserved .test domain; the same five every run, nothing can reach a real inbox. */
export const FIXTURE_LEADS: readonly LeadDraft[] = Object.freeze([
  Object.freeze({ name: "Mara Lindqvist", email: "mara@example.test", company: "Northwind Studio", why: "Posted a part-time bookkeeper role last week; the routine we replace is being hired for." }),
  Object.freeze({ name: "Dev Okafor", email: "dev@example.test", company: "Okafor Consulting", why: "Solo consultant billing monthly retainers; closes the month by hand per their newsletter." }),
  Object.freeze({ name: "Sofia Reyes", email: "sofia@example.test", company: "Reyes & Partners", why: "Two-person firm that asked publicly for a 'close the month in a click' tool." }),
  Object.freeze({ name: "Jonas Weber", email: "jonas@example.test", company: "Weber Advisory", why: "Switched from an agency to running the work alone; same weekly routine, no operator." }),
  Object.freeze({ name: "Priya Natarajan", email: "priya@example.test", company: "Natarajan Labs", why: "Founder-led sales with visible weekly reporting; the goal metric we move is the one they track." }),
]);

const markdown = (company: string, customer: string, thesis: string): string => `# Lead list: ${company} first five

## 1. Who we looked for
${customer} with a visible weekly routine and no in-house operator, matching the thesis "${thesis}". Source: public research only (company sites, job posts, newsletters); no scraped personal data, no purchased lists.

## 2. The leads
| Name | Company | Email | Why now |
| --- | --- | --- | --- |
${FIXTURE_LEADS.map((l) => `| ${l.name} | ${l.company} | ${l.email} | ${l.why} |`).join("\n")}

## 3. What happens next
Nothing is contacted here. The platform stores these leads; the next outreach batch takes the unsent ones and asks the CEO before any first-contact email goes out.

## 4. What we learn
If fewer than two of five reply, the segment or the "why now" is wrong before the message is.`;

/** sales:lead_research fixture (K0): a lead_list artifact plus `leads[]` the worker persists; no action requests. */
export const leadResearchScript: MockScript = (input) => {
  const ctx = fixtureContext(input);
  const output: AgentOutput = {
    summary: `Lead research for ${ctx.company}: five ${ctx.customer} from public research, each with the reason they fit now. Stored for the next outreach batch; nobody is contacted by this task.`,
    artifacts: [{ kind: "lead_list", title: `Lead list: ${ctx.company} first five`, markdown: markdown(ctx.company, ctx.customer, ctx.thesis) }],
    memory: [
      { kind: "learning", title: "Lead sources", content: "Job posts for the routine we replace and public 'how I close the month' notes are the two signals that found fits fastest." },
      { kind: "decision", title: "Lead research rules", content: "Public research only; five leads per run while the message is unproven; every lead carries a why-now the email can use." },
    ],
    actions: [],
    leads: FIXTURE_LEADS.map((l) => ({ ...l })),
    confidence: "medium",
  };
  return succeeded(input, "lead_research", output);
};
