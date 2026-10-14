import type { AgentOutput } from "@north/core";
import type { MockScript } from "../runtime/mock";
import { fixtureContext, succeeded } from "./shared";

const markdown = (company: string, customer: string): string => `# Brand kit: ${company}

## 1. Name and positioning
Write the name as "${company}" in running text; never all-caps. Positioning: ${company} gives ${customer} a weekly outcome they can review, approve and undo, without hiring a specialist.

## 2. Colour palette
| Role | Hex | Usage |
| --- | --- | --- |
| Primary | #1F4D3A | Buttons, links, active states |
| Primary dark | #143326 | Hover, focus rings |
| Accent | #E8A33D | Highlights, "needs review" badges |
| Neutral 900 | #1A1A1A | Body text |
| Neutral 600 | #5C5C5C | Secondary text |
| Neutral 100 | #F4F3EF | Backgrounds |
| Success | #2E7D32 | Approved state |
| Danger | #B3261E | Rejected state, destructive actions |

Contrast: primary on Neutral 100 is 8.9:1; accent is decorative only and never carries text under 18px.

## 3. Typography
- **Display**: Inter Tight, 600 weight; 40/48px for page titles, 28/36px for section titles.
- **Body**: Inter, 400 weight; 16/24px; 14/20px for tables and metadata.
- **Mono**: JetBrains Mono for identifiers and logs.

## 4. Voice and tone
Three adjectives: plain, calm, accountable.
- Do: "Three drafts are ready for your review." Don't: "Your AI magic is here!"
- Do: "Approved. You can undo this until 14:00 tomorrow." Don't: "Published successfully!!!"
- Sample headline: "The weekly work, done. You keep the final say."
- Sample CTA: "Start a free 14-day trial"

## 5. Logo direction and imagery
Wordmark in Inter Tight 600 with a single geometric mark: a check inside a rounded square, drawn with a 2px stroke. Imagery shows real work surfaces (queues, documents), not abstract robots. No stock photos of handshakes.

## 6. Accessibility
All text pairs meet WCAG AA (4.5:1). Focus rings use Primary dark at 2px. State is never conveyed by colour alone; approved/rejected carry an icon and a label.

## 7. Rationale
${customer} buy trust, not novelty. A restrained palette, plain language and visible control states reinforce the review-before-live promise.`;

/** design:brand_kit fixture — palette, type, voice, logo direction and accessibility notes with rationale. */
export const brandKitScript: MockScript = (input) => {
  const ctx = fixtureContext(input);
  const output: AgentOutput = {
    summary: `Brand kit for ${ctx.company}: restrained green/amber palette with WCAG AA contrast, Inter Tight and Inter type, a plain-calm-accountable voice, and a check-in-square wordmark. Built to reinforce review-before-live for ${ctx.customer}.`,
    artifacts: [{ kind: "brand_kit", title: `Brand kit: ${ctx.company}`, markdown: markdown(ctx.company, ctx.customer) }],
    memory: [
      { kind: "decision", title: "Brand voice", content: "Plain, calm, accountable. State outcomes and what the user can undo; no hype words, no exclamation marks." },
      { kind: "decision", title: "Brand palette", content: "Primary #1F4D3A, accent #E8A33D, neutrals #1A1A1A/#5C5C5C/#F4F3EF, success #2E7D32, danger #B3261E." },
    ],
    actions: [],
    confidence: "high",
  };
  return succeeded(input, "brand_kit", output);
};
