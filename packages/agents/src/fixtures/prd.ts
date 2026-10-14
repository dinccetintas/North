import type { AgentOutput } from "@north/core";
import type { MockScript } from "../runtime/mock";
import { fixtureContext, succeeded } from "./shared";

const markdown = (company: string, customer: string, thesis: string): string => `# PRD: ${company} version 0

## 1. Problem
${customer} need the outcome in "${thesis}" every week and have no specialist to do it. Today they pay a freelancer or skip it. Primary persona: the stretched operator (see memory).

## 2. Goal and success metric
Ten paying customers within 60 days of launch. Leading indicator: 30% of trial users approve at least three outputs in week one.

## 3. Version 0 scope
1. Sign-up with magic link; no team features.
2. Onboarding: the user pastes three examples of their own voice and one description of their customer.
3. Weekly generation: the product drafts the outcome; the user sees a review queue.
4. Review queue: approve, edit, or reject each draft; nothing leaves the product without approval.
5. Undo: any approved item can be reverted within 24 hours.
6. Billing: one plan, monthly, card on file after a 14-day trial.

## 4. Non-goals (version 0)
- Multi-user accounts, roles or agencies.
- Integrations beyond copy/export.
- Analytics dashboards.

## 5. User stories and acceptance criteria
| Story | Acceptance criteria |
| --- | --- |
| As an operator I paste three examples and get a draft in my voice | Draft generated within 60 seconds; a blind reviewer matches the voice in 4 of 5 cases |
| As an operator I approve or reject each draft | Queue shows state per item; rejected items never export; approvals logged with timestamp |
| As an operator I undo an approval | Revert within 24h restores the previous state; audit entry recorded |
| As an operator I start a trial without a card | Trial starts on first login; card prompt appears on day 12 and blocks on day 15 |

## 6. Risks and open questions
- Voice fidelity may need more than three examples; test with five early users.
- Review fatigue: if the queue exceeds ten items, batch approvals are needed (version 1).

## 7. Ordered task list for Engineering
1. Auth and account shell (magic link, session) — AC: login works on preview URL.
2. Onboarding form with validation — AC: three examples required; stored per company.
3. Draft generation job and queue model — AC: job creates queue items; failures retried once.
4. Review queue UI (approve/edit/reject) — AC: stories 2 and 3 pass.
5. Undo with 24h window and audit log — AC: story 3 passes; audit entries visible in admin.
6. Billing with 14-day trial — AC: story 4 passes in sandbox mode.
7. Preview deploy with smoke test — AC: preview URL returns 200; test report green.`;

/** strategy_product:prd fixture — version-0 PRD with stories, acceptance criteria and an engineering task list. */
export const prdScript: MockScript = (input) => {
  const ctx = fixtureContext(input);
  const output: AgentOutput = {
    summary: `Version-0 PRD for ${ctx.company}: onboarding from three voice examples, weekly drafts, a review queue with approve/edit/reject, 24-hour undo, and a single plan after a 14-day trial. Success metric: ten paying customers in 60 days. Seven ordered engineering tasks with acceptance criteria.`,
    artifacts: [{ kind: "prd", title: `PRD: ${ctx.company} version 0`, markdown: markdown(ctx.company, ctx.customer, ctx.thesis) }],
    memory: [
      { kind: "decision", title: "Version-0 scope", content: "Magic-link auth, three-example onboarding, weekly drafts, review queue, 24h undo, single monthly plan with 14-day trial. No teams, integrations or dashboards." },
      { kind: "decision", title: "Launch success metric", content: "Ten paying customers within 60 days; leading indicator is 30% of trial users approving three outputs in week one." },
      { kind: "learning", title: "Review fatigue risk", content: "If the review queue exceeds ten items, batch approvals become necessary; planned for version 1." },
    ],
    actions: [],
    confidence: "high",
  };
  return succeeded(input, "prd", output);
};
