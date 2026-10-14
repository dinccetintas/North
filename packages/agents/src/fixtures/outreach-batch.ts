import type { ActionSpec, AgentOutput } from "@north/core";
import type { MockScript } from "../runtime/mock";
import { fixtureContext, succeeded } from "./shared";

/** Three example prospects on a reserved domain; nothing here can reach a real inbox. */
export const FIXTURE_PROSPECTS = Object.freeze([
  { name: "Mara Lindqvist", email: "mara@example.test", company: "Northwind Studio" },
  { name: "Dev Okafor", email: "dev@example.test", company: "Okafor Consulting" },
  { name: "Sofia Reyes", email: "sofia@example.test", company: "Reyes & Partners" },
] as const);

const emailText = (prospect: (typeof FIXTURE_PROSPECTS)[number], company: string, thesis: string): string =>
  `Hi ${prospect.name.split(" ")[0]},

${prospect.company} looks like it runs on the same weekly routine most ${company} customers had before: the work gets done, but only when you do it.

${company} takes that routine over and asks you only when money or reputation is on the line. The thesis in one line: ${thesis}

If a 15-minute look is worth it, reply with a day that works. If not, no follow-up.

Thanks,
${company}`;

const markdown = (company: string, customer: string): string => `# Outreach batch: ${company} first contacts

## 1. Who and why
Three ${customer} with a visible weekly routine and no in-house operator. Source: public research only; no scraped personal data.

## 2. The message
One short email each, same structure: what we noticed, what ${company} does, one ask, no follow-up pressure. No fake personalisation.

## 3. Prospects
| Name | Company | Why now |
| --- | --- | --- |
${FIXTURE_PROSPECTS.map((p) => `| ${p.name} | ${p.company} | Hiring for the routine we replace |`).join("\n")}

## 4. Sending rules
First contact is K2: the CEO approves the batch before anything is sent. Replies inside the thread are K1 and reported in the brief. Metric: email replies.

## 5. What we learn
Reply rate above 10% means the message works; below 3% means the segment or the promise is wrong.`;

/** sales:outreach_batch fixture: an artifact plus three K2 `email.send.first_contact` requests. */
export const outreachBatchScript: MockScript = (input) => {
  const ctx = fixtureContext(input);
  const actions: ActionSpec[] = FIXTURE_PROSPECTS.map((prospect) => ({
    kind: "email.send.first_contact",
    companyId: input.companyId,
    agentRole: input.role,
    description: `First-contact email to ${prospect.name} at ${prospect.company}`,
    payload: { to: prospect.email, subject: `${prospect.company} and the weekly routine`, text: emailText(prospect, ctx.company, ctx.thesis) },
  }));
  const output: AgentOutput = {
    summary: `Outreach batch for ${ctx.company}: three first-contact emails to ${ctx.customer}, each with one plain ask. Sending waits for the CEO's approval; replies are the metric.`,
    artifacts: [{ kind: "outreach_batch", title: `Outreach batch: ${ctx.company} first contacts`, markdown: markdown(ctx.company, ctx.customer) }],
    memory: [
      { kind: "learning", title: "Outreach structure", content: "What we noticed, what we do, one ask, no follow-up pressure. Three prospects per batch while the message is unproven." },
      { kind: "decision", title: "Outreach sources", content: "Public research and the CEO's uploads only. No scraped personal data, no fake personalisation." },
    ],
    actions,
    confidence: "medium",
  };
  return succeeded(input, "outreach_batch", output);
};
