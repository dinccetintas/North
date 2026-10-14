import type { AgentOutput } from "@north/core";
import type { MockScript } from "../runtime/mock";
import { fixtureContext, succeeded } from "./shared";

const markdown = (company: string, customer: string, thesis: string): string => `# Personas: ${company}

Thesis in scope: "${thesis}". Three personas, one primary.

## Persona A (primary): the stretched operator
- **Who**: runs a small team among ${customer}; owns the outcome personally but has no specialist on staff.
- **Trigger**: a missed deadline or a lost deal that traces back to the outcome not being done.
- **Jobs to be done**: get the outcome done weekly without becoming the bottleneck; show progress to the team.
- **Current alternatives**: a freelancer at $400-$1,200/month with slow turnaround, or doing it themselves late at night.
- **Buying process**: decides alone up to ~$200/month; wants a trial and one proof point from a peer.
- **Objections**: "Will it sound like us?", "What if it does something embarrassing?" Answer: review before anything goes live, with a clear undo.
- **Channels**: founder communities, LinkedIn, newsletters for ${customer}.

## Persona B: the in-house generalist
- **Who**: the one person at the company who was handed the outcome on top of their actual job.
- **Trigger**: a new quarter target they cannot hit alone.
- **Jobs**: look competent fast; reduce hours spent; have a defensible process.
- **Alternatives**: templates, a patchwork of free tools, asking a friend.
- **Buying process**: recommends; the operator (Persona A) approves spend.
- **Objections**: "I don't have time to set up another tool." Answer: first result within the first session.

## Persona C: the agency owner (later)
- **Who**: serves ${customer} and sells the outcome as a service.
- **Trigger**: margin pressure; wants to serve more clients with the same team.
- **Jobs**: deliver consistently at lower cost; white-label.
- **Alternatives**: hiring juniors; offshore contractors.
- **Why later**: needs multi-client features that are out of version-0 scope.

## Messaging that answers each objection
| Objection | Message |
| --- | --- |
| It will not sound like us | Learns your voice from three examples; you approve the first ten outputs |
| Risk of an embarrassing mistake | Nothing goes live without your review; every action is reversible |
| No time to set up | First result in the first session, no integration required |

## Primary persona choice
Persona A, because they feel the pain directly, control the budget, and gather in reachable channels. Personas B and C inform roadmap, not the first launch.`;

/** research:personas fixture — three personas with a primary pick and objection handling. */
export const personasScript: MockScript = (input) => {
  const ctx = fixtureContext(input);
  const output: AgentOutput = {
    summary: `Three personas for ${ctx.company}: the stretched operator (primary, decides alone up to ~$200/month), the in-house generalist (recommends), and the agency owner (later). Objections centre on voice and risk of mistakes; review-before-live answers both.`,
    artifacts: [{ kind: "personas", title: `Personas: ${ctx.company}`, markdown: markdown(ctx.company, ctx.customer, ctx.thesis) }],
    memory: [
      { kind: "persona", title: "Primary persona: stretched operator", content: `Small-team operator among ${ctx.customer}; owns the outcome, no specialist on staff, decides alone up to ~$200/month, wants a trial and one peer proof point.` },
      { kind: "persona", title: "Secondary persona: in-house generalist", content: "Handed the outcome on top of their job; recommends tools, operator approves spend; needs a first result in the first session." },
      { kind: "learning", title: "Top objections", content: "Voice fidelity and fear of embarrassing mistakes; answered by review-before-live and reversible actions." },
    ],
    actions: [],
    confidence: "medium",
  };
  return succeeded(input, "personas", output);
};
