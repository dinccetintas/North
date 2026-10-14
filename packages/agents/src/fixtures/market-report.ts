import type { AgentOutput } from "@north/core";
import type { MockScript } from "../runtime/mock";
import { fixtureContext, succeeded } from "./shared";

const markdown = (company: string, customer: string, thesis: string): string => `# Market report: ${company}

## 1. Market definition
${company} is built on the thesis: "${thesis}". The job the buyer is hiring for is getting a repeatable outcome without hiring a specialist. The buyer is ${customer}; the budget today is split between freelancers, agencies and DIY tools.

## 2. Size (estimate, bottom-up)
| Segment | Count (est.) | Willingness to pay / month | Serviceable spend / year |
| --- | --- | --- | --- |
| ${customer} (primary) | 40,000 | $49-$199 | $24M-$95M |
| Adjacent small teams | 120,000 | $29-$99 | $42M-$143M |
| Mid-market (later) | 8,000 | $500+ | $48M+ |

These are estimates derived from public company counts and comparable pricing; treat the ranges as order-of-magnitude, not forecasts.

## 3. Demand evidence
- Search demand: head terms for the category show stable, rising interest over 24 months (Google Trends, retrieved during this run).
- Communities: recurring "how do I do X without hiring" threads on Reddit and Indie Hackers; the pain is described in the buyer's own words.
- Existing spend: comparable tools charge $49-$199/month and publicly report thousands of paying customers, which proves budget exists.
- Verdict: demand exists for the outcome; the open question is whether ${customer} will trust an automated product with it. That is a positioning problem, not a demand problem.

## 4. Trends and why-now
1. Cost of delivering the outcome dropped sharply in the last 18 months; incumbents are priced for the old cost base.
2. ${customer} are consolidating tools and will trade features for fewer vendors.
3. Buyers increasingly accept "AI-assisted" delivery when a human can review before anything goes live.

## 5. Risks and open questions
| Risk | Effect on thesis | How to check |
| --- | --- | --- |
| Incumbent adds the same capability at no extra cost | High | Watch release notes; monitor pricing pages monthly |
| ${customer} will not pay before seeing results | Medium | Offer a paid pilot with a refund; measure conversion |
| Channel cost too high for the price point | Medium | Run a $300 test campaign; target CAC under 2 months of revenue |

## 6. Recommendation
Proceed, narrowed to ${customer}. Validate willingness to pay with a paid pilot before building beyond version 0.`;

/** research:market_report fixture — evidence-backed market report with a clear verdict. */
export const marketReportScript: MockScript = (input) => {
  const ctx = fixtureContext(input);
  const output: AgentOutput = {
    summary: `Demand exists for ${ctx.company}'s outcome among ${ctx.customer}; comparable tools prove budget at $49-$199/month. Biggest risk is an incumbent bundling the capability. Recommend proceeding with a narrowed segment and a paid pilot to test willingness to pay.`,
    artifacts: [{ kind: "market_report", title: `Market report: ${ctx.company}`, markdown: markdown(ctx.company, ctx.customer, ctx.thesis) }],
    memory: [
      { kind: "learning", title: "Serviceable market estimate", content: `Bottom-up estimate for ${ctx.customer}: ~40,000 buyers at $49-$199/month ($24M-$95M/year). Order-of-magnitude only.` },
      { kind: "learning", title: "Comparable pricing", content: "Comparable tools charge $49-$199 per month and report thousands of paying customers; budget exists in the category." },
      { kind: "decision", title: "Narrow to the primary segment", content: `Focus the first version on ${ctx.customer}; defer adjacent segments until a paid pilot converts.` },
    ],
    actions: [],
    confidence: "medium",
  };
  return succeeded(input, "market_report", output);
};
