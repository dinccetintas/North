import type { AgentOutput } from "@north/core";
import type { MockScript } from "../runtime/mock";
import { fixtureContext, succeeded } from "./shared";

const markdown = (company: string, customer: string, thesis: string): string => `# Investor deck: ${company}

## Slide 1: ${company}
"${thesis}" delivered as a reviewed, reversible weekly service for ${customer}.

## Slide 2: The problem
${customer} must produce the outcome weekly and have no specialist. They pay $400-$2,500/month for slow freelancers or skip it. The skip rate is the market.

## Slide 3: The solution
Drafts in your voice from three examples. A review queue: approve, edit, reject. Undo within 24 hours. One plan, no setup.

## Slide 4: Why now
Delivery cost fell by an order of magnitude in 18 months. Incumbents are priced for the old cost base. Buyers accept AI-assisted work when a human approves it.

## Slide 5: Market
~40,000 primary buyers at $49-$199/month ($24M-$95M/year serviceable, bottom-up estimate); adjacent small teams add $42M-$143M. Notes: estimates from public company counts and comparable pricing.

## Slide 6: Product
Version 0 is live on preview: onboarding, weekly drafts, review queue, undo, billing. Next: batch approvals, first integration, agency tier.

## Slide 7: Traction plan
Ten paying customers in 60 days via founder communities; $1k MRR at month two; $10k MRR at month twelve. Notes: leading indicator is 30% of trials approving three outputs in week one.

## Slide 8: Business model
$99/month, ~86% gross margin, 25% trial-to-paid assumed, 5% monthly churn assumed. Notes: churn measured from month two.

## Slide 9: Competition
Incumbent A ($99-$299, no review step), Incumbent B ($49-$149, generic output), agencies, do-nothing. ${company} owns review-before-live, voice fidelity and outcome pricing.

## Slide 10: Team
Founder-led with an AI operating team covering research, product, engineering, design and growth; every external action is gated by authority rules.

## Slide 11: The ask
$150k pre-seed for 18 months: 50% growth experiments, 30% product, 20% operations. Milestone for the next round: $25k MRR with churn under 5%.

## Slide 12: Appendix
Unit economics table, persona summaries and competitor evidence links are in the company memory.`;

/** strategy_product:investor_deck fixture — twelve slides as markdown sections with a single ask. */
export const investorDeckScript: MockScript = (input) => {
  const ctx = fixtureContext(input);
  const output: AgentOutput = {
    summary: `Twelve-slide investor deck for ${ctx.company}: problem, solution, why-now, market ($24M-$95M serviceable, estimate), product, traction plan, business model ($99/month, ~86% margin), competition, team, and a $150k pre-seed ask with use of funds.`,
    artifacts: [{ kind: "investor_deck", title: `Investor deck: ${ctx.company}`, markdown: markdown(ctx.company, ctx.customer, ctx.thesis) }],
    memory: [
      { kind: "decision", title: "Fundraising ask", content: "$150k pre-seed for 18 months: 50% growth, 30% product, 20% operations. Next-round milestone: $25k MRR, churn under 5%." },
      { kind: "learning", title: "Deck narrative", content: `Lead with the skip rate among ${ctx.customer} as the market; position on review-before-live and voice fidelity.` },
    ],
    actions: [],
    confidence: "medium",
  };
  return succeeded(input, "investor_deck", output);
};
