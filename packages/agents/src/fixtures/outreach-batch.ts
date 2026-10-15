import type { ActionSpec, AgentOutput } from "@north/core";
import type { MockScript } from "../runtime/mock";
import { parseLeadsVar, type AgentRunInput, type LeadVar } from "../runtime/types";
import { FIXTURE_LEADS } from "./lead-research";
import { fixtureContext, succeeded } from "./shared";

/** The built-in five prospects (the lead-research fixture's leads) used when the task carries no `vars.leads`. */
export const FIXTURE_PROSPECTS: readonly LeadVar[] = Object.freeze(FIXTURE_LEADS.map((l) => Object.freeze({ name: l.name, email: l.email, company: l.company, why: l.why })));

const BATCH_ID_MAX = 64;

/** One batch per task: the same task (even on a retry) reuses the same card. */
export const batchIdFor = (taskId: string): string => `batch-${taskId}`.slice(0, BATCH_ID_MAX);

const firstName = (name: string): string => name.split(" ")[0] ?? name;
const companyOf = (lead: LeadVar): string => lead.company || `${firstName(lead.name)}'s company`;

const emailText = (lead: LeadVar, company: string, thesis: string): string =>
  `Hi ${firstName(lead.name)},

${companyOf(lead)} looks like it runs on the same weekly routine most ${company} customers had before: the work gets done, but only when you do it.${lead.why ? ` What we noticed: ${lead.why}` : ""}

${company} takes that routine over and asks you only when money or reputation is on the line. The thesis in one line: ${thesis}

If a 15-minute look is worth it, reply with a day that works. If not, no follow-up.

Thanks,
${company}`;

const markdown = (company: string, customer: string, leads: readonly LeadVar[]): string => `# Outreach batch: ${company} first contacts

## 1. Who and why
${leads.length} ${customer} with a visible weekly routine and no in-house operator. Source: the company's lead list (public research and the CEO's uploads); no scraped personal data.

## 2. The message
One short email each, same structure: what we noticed, what ${company} does, one ask, no follow-up pressure. No fake personalisation.

## 3. Prospects
| Name | Company | Why now |
| --- | --- | --- |
${leads.map((l) => `| ${l.name} | ${companyOf(l)} | ${l.why || "Hiring for the routine we replace"} |`).join("\n")}

## 4. Sending rules
First contact is K2: one decision card for the whole batch; nothing is sent before the CEO approves it. Replies inside the thread are K1 and reported in the brief. Metric: email replies.

## 5. What we learn
Reply rate above 10% means the message works; below 3% means the segment or the promise is wrong.`;

const leadsFor = (input: AgentRunInput): readonly LeadVar[] => {
  const fromVars = parseLeadsVar(input.vars);
  return fromVars.length > 0 ? fromVars : FIXTURE_PROSPECTS;
};

/**
 * sales:outreach_batch fixture: an artifact plus one K2 `email.send.first_contact`
 * per lead. Every action carries the same `payload.batchId` and the full
 * `recipients` list (core `BatchPayloadSchema`), so the gate opens ONE card
 * for the batch and the worker records one pending row per email.
 */
export const outreachBatchScript: MockScript = (input) => {
  const ctx = fixtureContext(input);
  const leads = leadsFor(input);
  const batchId = batchIdFor(input.taskId);
  const recipients = leads.map((l) => l.email);
  const actions: ActionSpec[] = leads.map((lead) => ({
    kind: "email.send.first_contact",
    companyId: input.companyId,
    agentRole: input.role,
    description: `First-contact email to ${lead.name} at ${companyOf(lead)}`,
    payload: {
      batchId,
      recipients,
      to: lead.email,
      subject: `${companyOf(lead)} and the weekly routine`,
      text: emailText(lead, ctx.company, ctx.thesis),
      ...(lead.id ? { leadId: lead.id } : {}),
    },
  }));
  const output: AgentOutput = {
    summary: `Outreach batch for ${ctx.company}: ${leads.length} first-contact emails to ${ctx.customer}, each with one plain ask. One card covers the batch; sending waits for the CEO's approval; replies are the metric.`,
    artifacts: [{ kind: "outreach_batch", title: `Outreach batch: ${ctx.company} first contacts`, markdown: markdown(ctx.company, ctx.customer, leads) }],
    memory: [
      { kind: "learning", title: "Outreach structure", content: "What we noticed, what we do, one ask, no follow-up pressure. Five prospects per batch while the message is unproven." },
      { kind: "decision", title: "Outreach sources", content: "The company's lead list only: public research and the CEO's uploads. No scraped personal data, no fake personalisation." },
    ],
    actions,
    confidence: "medium",
  };
  return succeeded(input, "outreach_batch", output);
};
