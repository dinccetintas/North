import type { AgentOutput } from "@north/core";
import type { MockScript } from "../runtime/mock";
import { fixtureContext, succeeded } from "./shared";

const markdown = (company: string, customer: string): string => `# Competitor map: ${company}

## 1. Alternatives
- **Direct**: two venture-backed tools selling the same outcome to ${customer}; strong on breadth, weak on review and undo.
- **Indirect**: freelancers and small agencies ($400-$2,500/month); trusted but slow and inconsistent.
- **Do nothing**: the operator does it late at night or skips it; the real competitor for most of ${customer}.

## 2. Comparison
| Alternative | Price | Target customer | Strengths | Weaknesses | Evidence |
| --- | --- | --- | --- | --- | --- |
| Incumbent A | $99-$299/mo | Mid-market teams | Integrations, reporting | Setup takes days; no review step | pricing page, G2 reviews |
| Incumbent B | $49-$149/mo | Solo operators | Cheap, fast start | Generic output, no voice control | pricing page, Reddit threads |
| Freelancer / agency | $400-$2,500/mo | Anyone with budget | Judgement, accountability | Slow, variable quality, hard to scale | marketplace rate cards |
| Do nothing | $0 | ${customer} | No cost | Outcome never ships; opportunity cost | community complaints |

## 3. Positioning gaps ${company} can own
1. **Review-before-live with undo**: neither incumbent lets the buyer approve before anything goes out. Proof: feature pages and reviews complaining about "surprises".
2. **Voice fidelity from a few examples**: Incumbent B's top complaint is generic output.
3. **Outcome pricing, not seat pricing**: both incumbents charge per seat, which punishes small teams.

## 4. Pricing benchmarks
Market clears between $49 and $299 per month. For ${customer}, a $79-$149 range with a paid pilot keeps ${company} above "cheap tool" and below "needs a budget sign-off".

## 5. Threats to watch
| Threat | Signal it is moving |
| --- | --- |
| Incumbent A adds an approval step | Changelog or "coming soon" on the feature page |
| Incumbent B launches a voice-training feature | Pricing page adds a higher tier |
| Platform provider bundles the capability for free | Announcement at their annual event |`;

/** research:competitor_map fixture — alternatives table, gaps, pricing benchmarks and threats. */
export const competitorMapScript: MockScript = (input) => {
  const ctx = fixtureContext(input);
  const output: AgentOutput = {
    summary: `Two direct incumbents ($49-$299/month), agencies and "do nothing" compete for ${ctx.customer}. ${ctx.company} can own review-before-live with undo, voice fidelity, and outcome-based pricing. Suggested price band: $79-$149/month.`,
    artifacts: [{ kind: "competitor_map", title: `Competitor map: ${ctx.company}`, markdown: markdown(ctx.company, ctx.customer) }],
    memory: [
      { kind: "learning", title: "Positioning gaps", content: "Review-before-live with undo, voice fidelity from a few examples, and outcome pricing instead of seat pricing are unowned by incumbents." },
      { kind: "learning", title: "Price band", content: `Market clears at $49-$299/month; target $79-$149/month for ${ctx.customer} with a paid pilot.` },
      { kind: "decision", title: "Lead with review-before-live", content: "Primary message is control: nothing goes live without approval; every action reversible." },
    ],
    actions: [],
    confidence: "medium",
  };
  return succeeded(input, "competitor_map", output);
};
