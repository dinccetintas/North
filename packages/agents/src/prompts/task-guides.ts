import type { ArtifactKind, TaskType } from "@north/core";

/** Artifact kind each task type is expected to produce. */
export const ARTIFACT_KIND_FOR_TASK: Readonly<Record<TaskType, ArtifactKind>> = Object.freeze({
  market_report: "market_report",
  personas: "personas",
  competitor_map: "competitor_map",
  prd: "prd",
  business_plan: "business_plan",
  investor_deck: "investor_deck",
  brand_kit: "brand_kit",
  campaign_spec: "campaign_spec",
  outreach_batch: "outreach_batch",
  plan_week: "plan",
  brief: "brief",
});

/** Short "what a great X contains" guidance, appended to the user prompt per task type. */
export const TASK_GUIDES: Readonly<Record<TaskType, string>> = Object.freeze({
  market_report: `A great market report contains:
- Market definition and the job the customer is hiring for, in one paragraph.
- Size with a bottom-up estimate (who, how many, what they pay) labelled as an estimate, plus any top-down figure with its source.
- Demand evidence: search volume, communities, existing spend, quotes with links; say plainly whether demand exists and how you know.
- Trends and why-now, with dated sources.
- Risks and open questions, ranked by how much they change the thesis.
- A one-line recommendation: proceed, narrow, or stop.`,
  personas: `Great personas contain, for two or three segments:
- Name, role, context and the trigger that starts their search.
- Jobs to be done, current alternatives and what they cost (money, time).
- Buying process: who decides, who blocks, what proof they need.
- Objections and the message that answers each.
- Where they gather (channels) and how to reach them first.
- A primary persona choice with the reason.`,
  competitor_map: `A great competitor map contains:
- Direct, indirect and do-nothing alternatives, with one line each on what they do well.
- A comparison table: price, target customer, key features, weaknesses, evidence links.
- Positioning gaps the company can own, with the proof for each gap.
- Pricing benchmarks and the implied price range.
- Threats to watch and the signal that would show them moving.`,
  prd: `A great PRD contains:
- Problem statement and target persona, referencing memory.
- Smallest launchable scope ("version 0") with explicit non-goals.
- User stories with acceptance criteria that an engineer can test.
- Success metric tied to the company's goal and the number that proves it.
- Open questions and risks.
- An ordered task list for Engineering, each with acceptance criteria.`,
  business_plan: `A great business plan contains:
- One-paragraph summary a founder could say aloud.
- Customer, problem, solution and why-now.
- Pricing model and unit economics (price, cost to serve, margin) with assumptions labelled.
- Go-to-market: first channel, first 10 customers plan, budget.
- 12-month milestones tied to metrics and the cash needed to get there.
- Key risks and what would make you stop.`,
  investor_deck: `A great investor deck (as markdown, one section per slide) contains:
- Title, problem, solution, why-now, market, product, traction or plan, business model, competition, team, ask.
- Numbers on every slide that claims scale; sources or assumptions in speaker notes.
- A single clear ask with use of funds.
- Ten to twelve slides, each with a headline that states the takeaway.`,
  brand_kit: `A great brand kit contains:
- Name usage rules and a one-line positioning statement.
- Colour palette with hex values and usage (primary, accent, neutrals, states).
- Typography: display and body fonts with sizes and weights.
- Voice and tone: three adjectives, do/don't examples, sample headline and CTA.
- Logo direction and imagery guidance (described, no binary assets).
- Accessibility notes (contrast ratios) and a short rationale.`,
  campaign_spec: `A great campaign spec contains:
- One objective tied to the goal metric, with the expected delta and the budget that buys it.
- Audience definition precise enough to configure, with exclusions.
- Creative: headline, body, CTA and format, with no stock imagery and no claims the product cannot keep.
- Budget and schedule inside the ads cap, plus an automatic pause rule.
- A stop rule and what a pass or fail teaches.
- Exactly one \`ads.start\` action request with amountUsd and category "ads"; the platform opens the decision card.`,
  outreach_batch: `A great outreach batch contains:
- Who and why: a handful of prospects from public research or the CEO's uploads, never scraped personal data.
- One short email per prospect: what we noticed, what we do, one ask, no follow-up pressure, no fake personalisation.
- A prospects table with the reason each is a fit now.
- Sending rules: first contact waits for the CEO's approval (K2); replies in-thread are K1.
- The metric (replies) and the thresholds that mean the message works or fails.
- One \`email.send.first_contact\` action request per email with payload.to, payload.subject and payload.text.`,
  plan_week: `A great weekly plan contains:
- Three to five tasks, each owned by exactly one role and tied to one metric with an expected delta and a cost estimate.
- Work ordered so research precedes building, and building precedes publishing.
- A rationale that names what the CEO should expect to see by the end of the week and the first signal that the plan is wrong.
- Only task types the platform knows; no manual work for the CEO unless it is a decision card.`,
  brief: `A great morning brief contains:
- What happened since the last brief: outcomes with numbers, not activity.
- What is blocked and what decision would unblock it.
- Today's plan in three lines.
- Spend to date against budget.
- Readable in 60 seconds; no filler.`,
});
