import type { ActionSpec, AgentOutput } from "@north/core";
import type { MockScript } from "../runtime/mock";
import { fixtureContext, succeeded } from "./shared";

/** The smallest paid test the growth fixture proposes: $10/day for five days. */
export const FIXTURE_CAMPAIGN_DAILY_USD = 10;
export const FIXTURE_CAMPAIGN_DAYS = 5;

/** Two English-speaking countries, working-age adults; what the ad set is configured with. */
export const FIXTURE_CAMPAIGN_TARGETING = Object.freeze({ countries: Object.freeze(["US", "GB"]), ageMin: 25, ageMax: 55 });

/** The automatic stop: the platform pauses on the budget caps; the agent's own rule is about the message. */
export const FIXTURE_CAMPAIGN_STOP_RULE = "Stop if click-through is below 0.6% after 1,000 impressions, or if cost per sign-up exceeds $15 after $30 spent.";

const markdown = (company: string, customer: string, thesis: string): string => `# Campaign spec: ${company} launch test

## 1. Objective and metric
Prove that ${customer} click and sign up when the promise is stated plainly. Metric: sign-ups. Expected delta: +10 over ${FIXTURE_CAMPAIGN_DAYS} days at $${FIXTURE_CAMPAIGN_DAILY_USD}/day.

## 2. Audience and targeting
${customer}, interest and job-title targeting, excluding current customers. Targeting: countries ${FIXTURE_CAMPAIGN_TARGETING.countries.join(", ")}, ages ${FIXTURE_CAMPAIGN_TARGETING.ageMin}-${FIXTURE_CAMPAIGN_TARGETING.ageMax}. Thesis under test: "${thesis}".

## 3. Creative and landing page
- Headline: The weekly work, done. You keep the final say.
- Body: ${company} runs the routine work for ${customer} and asks you only when money or reputation is on the line.
- CTA: Start free
- Format: single image, 1:1, no stock photos; the product's decision card as the visual.
- Landing page: the company's live site, or the latest preview until it is live (the platform fills the URL in when the campaign starts).

## 4. Budget and schedule
$${FIXTURE_CAMPAIGN_DAILY_USD}/day for ${FIXTURE_CAMPAIGN_DAYS} days ($${FIXTURE_CAMPAIGN_DAILY_USD * FIXTURE_CAMPAIGN_DAYS} total), inside the ads budget cap. The platform pauses the campaign and asks before any cap is exceeded.

## 5. Stop rule and what we learn
${FIXTURE_CAMPAIGN_STOP_RULE} A pass means the message works and the next test is pricing; a fail means the headline, not the channel, is wrong.`;

/** growth:campaign_spec fixture: one artifact plus one K2 `ads.start` request the decision layer must gate. */
export const campaignSpecScript: MockScript = (input) => {
  const ctx = fixtureContext(input);
  const action: ActionSpec = {
    kind: "ads.start",
    companyId: input.companyId,
    agentRole: input.role,
    description: `Start the $${FIXTURE_CAMPAIGN_DAILY_USD}/day launch test for ${ctx.company} (${FIXTURE_CAMPAIGN_DAYS} days)`,
    amountUsd: FIXTURE_CAMPAIGN_DAILY_USD * FIXTURE_CAMPAIGN_DAYS,
    category: "ads",
    payload: {
      name: `${ctx.company} launch test`,
      dailyBudgetUsd: FIXTURE_CAMPAIGN_DAILY_USD,
      audience: ctx.customer,
      targeting: { countries: [...FIXTURE_CAMPAIGN_TARGETING.countries], ageMin: FIXTURE_CAMPAIGN_TARGETING.ageMin, ageMax: FIXTURE_CAMPAIGN_TARGETING.ageMax },
      creativeMarkdown: "# The weekly work, done.\nYou keep the final say. CTA: Start free",
      stopRule: FIXTURE_CAMPAIGN_STOP_RULE,
    },
  };
  const output: AgentOutput = {
    summary: `Campaign spec for ${ctx.company}: a $${FIXTURE_CAMPAIGN_DAILY_USD}/day, ${FIXTURE_CAMPAIGN_DAYS}-day test aimed at ${ctx.customer} in ${FIXTURE_CAMPAIGN_TARGETING.countries.join(" and ")}, measured in sign-ups with a stop rule. The start is requested through the platform and waits for the CEO's card.`,
    artifacts: [{ kind: "campaign_spec", title: `Campaign spec: ${ctx.company} launch test`, markdown: markdown(ctx.company, ctx.customer, ctx.thesis) }],
    memory: [
      { kind: "learning", title: "First paid test", content: `Launch test: $${FIXTURE_CAMPAIGN_DAILY_USD}/day for ${FIXTURE_CAMPAIGN_DAYS} days, metric sign-ups, ${FIXTURE_CAMPAIGN_TARGETING.countries.join("/")} ages ${FIXTURE_CAMPAIGN_TARGETING.ageMin}-${FIXTURE_CAMPAIGN_TARGETING.ageMax}. ${FIXTURE_CAMPAIGN_STOP_RULE}` },
      { kind: "decision", title: "Ad creative direction", content: "Plain promise, product screenshot as visual, no stock imagery. CTA 'Start free'." },
    ],
    actions: [action],
    confidence: "medium",
  };
  return succeeded(input, "campaign_spec", output);
};
