import type { AgentOutput } from "@north/core";
import type { MockScript } from "../runtime/mock";
import { fixtureContext, succeeded } from "./shared";

const placeholder = (label: string, w = 390, h = 240): string => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="100%" height="100%" fill="#fafafa" stroke="#000" stroke-width="2"/><text x="50%" y="50%" font-family="monospace" font-size="14" text-anchor="middle" dominant-baseline="middle" fill="#555">${label}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
};

const screen = (n: number, name: string, purpose: string, order: readonly string[], action: string, persona: string): string => `## ${n}. ${name}

**Purpose.** ${purpose}

![${name} at 390px](${placeholder(`${name} · 390px`)})

**Content order (mobile first).**
${order.map((line, i) => `${i + 1}. ${line}`).join("\n")}

**Primary action.** ${action}

**States.** Empty: a one-line explanation and the primary action. Loading: ascii spinner next to the heading, content keeps its layout. Error: a mono-label line in red under the heading, the action stays available. Success: the next screen, never a modal.

**Desktop (1280px).** Same order in a single 48rem column; the primary action stays above the fold.

**Rationale.** ${persona}`;

const markdown = (company: string, customer: string): string => `# Screen designs: ${company} v0

Three screens for the PRD's first scope, built from the brand kit (editorial serif display, serif body, mono uppercase labels, black and white, hairline borders, one orange accent). Copy is final; imagery is described, not drawn.

${screen(1, "Landing", `Turn a visitor who is ${customer} into a waitlist email in under a minute.`, ["Promise in one line (display serif, 2.4rem)", "Who it is for and the thesis in one sentence", "Email field and 'Start free' button", "Problem, how it works (three steps), proof, pricing, FAQ", "Footer with a real contact address"], "'Start free' submits the email; the button is the only filled element on the page.", `${customer} decide in seconds whether a page is for them; the promise and the audience come before any feature.`)}

${screen(2, "Welcome", "Confirm the signup and set the one expectation that matters: the first result arrives within 24 hours.", ["'You are in' heading", "What happens next, three lines with times", "A single button to the app"], "'Open ${company}' goes to the app; no secondary links.", "A new user needs one next step, not a tour.")}

${screen(3, "First result", "Show the first artifact (the market report) and the first decision card side by side so the user sees both halves of the product at once.", ["Morning header with date", "Decisions today · 0 of 3 (empty state copy)", "The first artifact as a card with a one-line summary", "'Read the report' as the primary action"], "'Read the report' opens the artifact; the decisions block stays visible above it.", "Trust is built on the first real output; the design puts it in the centre and keeps the controls (quota, kill switch) in view.")}

## Accessibility
Text contrast at least 4.5:1 on paper and on the surface grey; focus rings 2px dark; every control has a visible label; state is never colour alone (label plus icon).`;

/** design:screen_designs fixture: three screens as a markdown artifact with placeholder images and full copy. */
export const screenDesignsScript: MockScript = (input) => {
  const ctx = fixtureContext(input);
  const output: AgentOutput = {
    summary: `Screen designs for ${ctx.company} v0: landing, welcome and first-result screens at 390px and 1280px with final copy, states and the brand kit applied, each tied to what ${ctx.customer} need first.`,
    artifacts: [{ kind: "screen_designs", title: `Screen designs: ${ctx.company} v0`, markdown: markdown(ctx.company, ctx.customer) }],
    memory: [
      { kind: "decision", title: "Screen order", content: "Landing → Welcome → First result. The first result screen shows the artifact and the decisions block together." },
      { kind: "learning", title: "Landing copy", content: "Promise: 'The weekly work, done. You keep the final say.' CTA: 'Start free'. Audience sentence before features." },
    ],
    actions: [],
    confidence: "high",
  };
  return succeeded(input, "screen_designs", output);
};
