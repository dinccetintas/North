import type { AgentOutput } from "@north/core";
import type { MockScript } from "../runtime/mock";
import { fixtureContext, succeeded } from "./shared";

const markdown = (company: string, customer: string, thesis: string): string => `# Business plan: ${company}

## 1. Summary
${company} delivers "${thesis}" to ${customer} as a reviewed, reversible weekly service at a price below one freelancer day. Goal: ten paying customers in 60 days, $10k MRR within 12 months.

## 2. Customer, problem, solution, why-now
- **Customer**: ${customer}; primary persona is the stretched operator.
- **Problem**: the outcome is required weekly, there is no specialist, and alternatives are slow or expensive.
- **Solution**: drafts in the customer's voice, a review queue, undo, one plan.
- **Why now**: delivery cost collapsed; incumbents are priced for the old cost base; buyers accept AI-assisted work with human review.

## 3. Pricing and unit economics (assumptions labelled)
| Item | Value | Assumption |
| --- | --- | --- |
| Price | $99/month | Mid-point of the $79-$149 band from the competitor map |
| Cost to serve | $14/month | Model spend ~$9, hosting and email ~$5 per active customer |
| Gross margin | ~86% | Before support time |
| Trial-to-paid | 25% | Comparable self-serve tools report 20-30% |
| Monthly churn | 5% | Assumed; measure from month two |

## 4. Go-to-market
- **First channel**: founder communities and newsletters where ${customer} gather; one post per week with a worked example.
- **First 10 customers**: 30 outreach conversations from the personas' channels, offering a paid pilot with a refund.
- **Budget**: $300 for a paid test campaign in month two, only if organic conversion is above 20%.

## 5. 12-month milestones
| Month | Milestone | Metric |
| --- | --- | --- |
| 1 | Version 0 live on preview, 5 pilots | 5 paying customers |
| 2 | Public launch | 10 paying customers, $1k MRR |
| 4 | Batch approvals, first integration | 30 customers, $3k MRR |
| 8 | Agency tier | 70 customers, $7k MRR |
| 12 | Break-even on variable costs | 100 customers, $10k MRR |

Cash needed to month 12 at this plan: ~$6k in tooling and model spend plus founder time; no external funding required.

## 6. Risks and stop conditions
- Trial-to-paid below 10% after 50 trials: stop and revisit the segment.
- Churn above 10% monthly for two months: stop acquisition, fix retention.
- Incumbent bundles review-before-live for free: reposition on voice fidelity or stop.`;

/** strategy_product:business_plan fixture — pricing, unit economics, GTM, milestones and stop conditions. */
export const businessPlanScript: MockScript = (input) => {
  const ctx = fixtureContext(input);
  const output: AgentOutput = {
    summary: `Business plan for ${ctx.company}: $99/month single plan, ~86% gross margin, first channel is founder communities, ten customers in 60 days and $10k MRR in 12 months with ~$6k cash. Stop conditions on trial conversion and churn are explicit.`,
    artifacts: [{ kind: "business_plan", title: `Business plan: ${ctx.company}`, markdown: markdown(ctx.company, ctx.customer, ctx.thesis) }],
    memory: [
      { kind: "decision", title: "Pricing", content: "Single plan at $99/month after a 14-day trial; cost to serve ~$14/month; ~86% gross margin." },
      { kind: "decision", title: "First channel", content: `Founder communities and newsletters where ${ctx.customer} gather; paid test only if organic conversion exceeds 20%.` },
      { kind: "learning", title: "Stop conditions", content: "Trial-to-paid under 10% after 50 trials, or churn above 10% for two months, triggers a strategy review." },
    ],
    actions: [],
    confidence: "medium",
  };
  return succeeded(input, "business_plan", output);
};
