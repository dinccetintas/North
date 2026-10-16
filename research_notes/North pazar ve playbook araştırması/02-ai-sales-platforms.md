# AI sales platforms: competitor and product teardown for North (as of 2026-10-16)

Scope: the product layer only. Lead data providers, verification, sending infrastructure, legal and LinkedIn are
covered in `docs/research/dept-sales.md` and are not repeated here. Method: official product/docs/pricing pages
fetched directly where they resolved; where a vendor page returned 404/403 (11x pricing, Reply.io, Salesforce SDR,
Outreach, Gong, Relevance AI, Attention product, Landbase docs) the claim is taken from a named secondary source and
marked **unverified**. The web-search budget ran out after the third round; YouTube transcripts were unavailable
(vidIQ credits exhausted), so video evidence is limited to titles/descriptions. Reddit cannot be fetched directly;
Reddit claims come via secondary pages that quote threads.

## Q1. Teardown of the leaders: what they do, how a request becomes an outcome, pricing, approval UX

### Takeaway
Every "autonomous AI SDR" (11x, Artisan, AiSDR, Jason, Landbase) runs the same nine-stage loop — ICP → list → enrich
→ signal → research → sequence → reply → book → CRM write-back — and every one of them has quietly added a
review/"copilot" mode in 2025-26. The assistive products (Unify, Clay, Apollo, HubSpot Breeze, Amplemarket Duo,
Valley, Topo, Lavender) differ mainly in *where* the human sits: before the list (Clay/Unify), before the send
(Breeze/Valley/Topo/Duo), or before the reply (AiSDR co-pilot, Instantly HITL). North's "first contact needs a
founder card" is a stricter version of what the market already converged on.

### Cited Findings

**Agentic vs assistive classification (with evidence per product)**

| Product | Class (2026) | Where the human sits | Evidence |
|---|---|---|---|
| 11x Alice | Agentic, optional review | "review and edit each message, or put Alice on autopilot" (11x-sponsored video script); Smart Replies escalate "sensitive conversations" | [11x Alice](https://www.11x.ai/worker/alice); [Tools 8020 video, 11x-sourced](https://www.youtube.com/watch?v=Ek5HBmlGCsA) |
| Artisan Ava | Agentic by default, HITL controls | "human-in-the-loop controls (approvals, tone and CTA locks, escalation rules)" | [Artisan llms-full](https://www.artisan.co/llms-full.txt) |
| AiSDR Ami | Agentic, co-pilot for replies | replies "in 5-10 min or co-pilot mode"; managed plan: "You review and approve before anything sends" | [AiSDR pricing](https://aisdr.com/pricing) |
| Reply.io Jason | Agentic with Copilot mode | "Autopilot … on its own" vs "Copilot, where it drafts every step and waits for your approval before sending" | [Mailtrap/Reply review (author is Reply staff)](https://mailtrap.io/blog/reply-io-review/) |
| Regie.ai | Agentic within guardrails | agents work "within configured guardrails; human reps approve customer-facing communications" (secondary, **unverified**) | [toolsforhumans](https://www.toolsforhumans.ai/ai-tools/regie-ai) |
| Agentforce SDR | Agentic, inbound-leaning | welcome email, configurable "nudge", replies with rep's meeting link and "automatically copy the rep"; all logged to Activity Timeline | [eesel guide (competitor-written)](https://www.eesel.ai/blog/agentforce-sales-development) |
| HubSpot Breeze Prospecting | Agentic with default review | "option to review and edit AI-drafted emails before they are sent"; later "fully autonomous mode, which sends emails without requiring review first" | [HubSpot](https://www.hubspot.com/products/sales/ai-prospecting-agent) |
| Clay (Tables, Claygent, Workflows, Signals) | Assistive/orchestration | Workflows example routes AI drafts "to Slack for approval before anything sends"; no built-in approval node | [Clay Workflows](https://www.clay.com/blog/introducing-workflows) |
| Apollo Outbound Copilot | Assistive → semi-agentic | "Launch with approvals: Manual or automatic approval controls what goes out" | [Apollo insights](https://www.apollo.io/insights/ai-assistant-for-outbound-teams-needing-speed) |
| Unify | Assistive by stance | "AI for SDRs, not AI SDRs"; does not auto-send, auto-sell or call; Plays page says "on autopilot" for personalization | [Unify founder guide](https://www.unifygtm.com/explore/how-to-do-founder-led-sales); [Unify Plays](https://www.unifygtm.com/product/plays) |
| Common Room | Data/context layer + agents | RevOps "govern how AI agents execute"; no approval step described | [Common Room product](https://www.commonroom.io/product/) |
| Instantly AI Reply Agent | Agentic reply bot, two modes | "Human-in-the-Loop queues drafts for approval, and Autopilot sends without review" | [Instantly blog](https://instantly.ai/blog/instantly-ai-reply-agent-vs-smartlead-lemlist-reply-io/) |
| Smartlead | Assistive + agents | AI Lead Categorization uses the user-chosen OpenAI model (16 Oct 2026); Auto-Replace burning mailboxes (15 Sep 2026); "AI Team" tab | [Smartlead updates](https://updates.smartlead.ai/) |
| Amplemarket Duo | Assistive (copilot) | "never sends or changes things without visibility"; learns from dismissals and edits | [Amplemarket Duo](https://www.amplemarket.com/duo) |
| Valley | Assistive | "Write in your voice. Review before sending."; "Keep control of approvals, timing and follow-ups" | [Valley](https://www.joinvalley.co/) |
| Topo | Assistive | "Copilot mode lets reps review and approve every lead and message before outreach goes out" | [Topo](https://www.topo.io/) |
| Lindy | Builder; approval optional | "actions that write or send can wait for your approval"; demo shows gmail.send without visible gate | [Lindy sales](https://www.lindy.ai/solutions/sales) |
| Lavender | Assistive (coach) + Ora agent | Email Coach scores drafts; "Ora … writes emails like a top seller" | [Lavender](https://www.lavender.ai/) |
| Salesloft Rhythm | Assistive prioritizer + agents | signals → "prioritized daily workflow"; actions tagged Agent / Human / Agent+Human | [Salesloft platform](https://www.salesloft.com/platform) |
| Persana | Assistive data+sequencer | "AI Research Agents", "AI SEQUENCER", 75+ signals, 100+ providers; no review step on page | [Persana](https://persana.ai/) |
| Landbase GTM-1 Omni | Agentic multi-model | planning/decisioning, generator, and "prediction and reward models" | [Landbase launch post](https://landbase.com/blog/landbase-announces-gtm-1-omni-action-models-the-future-of-go-to-market-automation) |

**Per-product teardown (a-e). (f) is consolidated in Q5.**

*11x (Alice outbound, Julian inbound/phone).*
- Signals/triggers: "Funding rounds, hiring spikes, job changes, technology shifts, and site visits", G2 buying signals, website visitor tracking; signal page adds "executive hires, tech stack shifts, earnings reports, negative competitor reviews, contract renewal windows". Users weight signals, combine events, set thresholds "by segment or campaign"; "When a relevant event fires, 11x agents act on it immediately" — [11x signals](https://www.11x.ai/platform/data-lead-generation/signals-and-triggers), [11x Alice](https://www.11x.ai/worker/alice).
- Research: "Deep Research" combines "real-time web research - from news articles to 10-K filings" with CRM context; messages written "for a single contact, not filled from a template" — [11x Alice](https://www.11x.ai/worker/alice).
- Sequencing: one sequence across email, social and power dialer, "buyer context carried across touches". Replies: "Smart Replies" answer questions/objections, escalate sensitive threads, honor opt-outs "immediately". CRM: "Deep Bi-directional CRM Integration", CRM stays source of truth. Reporting: optimized for "meetings booked, not opens or replies"; test "messages, segments, and triggers" — same page.
- Pricing: official page 404. Secondary: Growth $3,750/mo billed annually (~$45k/yr), 5 users, 2,000 prospects/mo, managed Gmail mailboxes; Pro 10 users/5,000 prospects; Enterprise custom — [SyncGTM](https://syncgtm.com/blog/11x-ai-review); FAQ "$36,000/yr" start — [Landbase](https://www.landbase.com/blog/11x-ai-pricing) **unverified, conflicting**. Case-study stats on the Alice page ($4M pipeline, 57X ROI) are vendor claims.
- Trust record: see dept-sales (TechCrunch, customers claimed it did not have).

*Artisan (Ava).*
- Stages named: "lead discovery, enrichment, campaign creation, autonomous replies, and scheduling"; "database of 250M+ verified contacts"; "Intent signals to prioritize and target accounts showing buying behavior"; sends "from your own domains in your reps' names"; positive replies converted to meetings via calendar integration — [Artisan llms-full](https://www.artisan.co/llms-full.txt).
- HITL: "approvals, tone and CTA locks, escalation rules" (configuration not described). Enterprise: SOC 2 Type II, SSO/SAML, audit logs. Pricing "Credit-based", scoped to lead volume, mailboxes, dialer seats; no amounts — same page. Third-party estimates ~$2,000/mo entry ([Landbase](https://landbase.com/blog/artisan-ai-pricing)) vs "around $500/month" ([Modern Inbound](https://moderninbound.com/blog/artisan-vs-aisdr)) — **unverified, conflicting**. "Ava 2.0 (July 2026) guardrails, credit usage, native dialer" appeared only in a search summary with no primary page — **unverified**.
- Field results: G2 review cited as "ten booked calls in two months" ([Parallel Labs](https://parallellabs.app/best-ai-sdr-tools/)); a small YouTube reviewer claims "1,400 cold emails … zero replies" ([AIToolSpott](https://www.youtube.com/watch?v=n4WsWnCB2i4), 6 views, low weight); G2 3.9/5 from 22 reviews vs 11x 4.5/5 from 30 ([G2 compare](https://www.g2.com/compare/11x-vs-artisan-sales), search snippet).

*AiSDR (Ami).*
- Request → outcome: "Get a full campaign play from your product and ICP" (submit URL → targets, timing, opening angles); plain-language audience → list; job-change and engagement filters; personalization from "LinkedIn, company news, and the wider web"; one flow across "email, LinkedIn, calls, video, and voice" timed to intent; replies "within 10 minutes" with a rep pulled in "only for high-intent replies or edge cases"; booking "the moment someone says yes"; HubSpot/Salesforce write-back; deliverability (warm-up, ramps, validation, bounce protection); memory: "Ami remembers what you told it last time", "Start from what already works" — [AiSDR features](https://aisdr.com/features/).
- Pricing (official page, fetched): Pay-as-you-go "$1.50 per person prospected", billed daily; Teams for 1,000+ contacts/mo, quarterly contracts, annual -20%; add-ons: warmed mailbox $33, per-campaign managed service $149, fully managed $2,500/mo; "three bounce checks before sending" — [AiSDR pricing](https://aisdr.com/pricing). A Sept-2026 video lists $250 Solo / $900 Explore / $2,500 Scale ([new Mantra video](https://www.youtube.com/watch?v=x4bFjsTX-Cg)) — pricing appears to have changed to PAYG recently; **conflict noted**.

*Regie.ai (RegieOne, AI Agents, AI Dialer).*
- Archived bundle "starts at $35,000 / yr", parallel dialing $150/rep/mo — [Regie pricing archive](https://www.regie.ai/pricing-archive). 2026 per-seat: $180/user/mo AI SEP (10-seat min) or $499/user/mo (5-seat min), annual — [OneAway](https://oneaway.io/blog/ai-sdr-tools-2026), [marketbetter](https://marketbetter.ai/blog/regie-ai-pricing-breakdown-2026/) **unverified**. "100+ built-in signals" incl. G2 and SEC filings — [toolsforhumans](https://www.toolsforhumans.ai/ai-tools/regie-ai) **unverified**.

*Reply.io Jason AI.*
- Inputs: "an ICP, a value proposition, and a set of intent signals to watch". Starter $500/mo annual ($800 monthly), 1,000-3,000 contacts, unlimited mailboxes; Growth from $1,500/mo, 5,000-10,000 contacts, "custom playbooks"; Agency plan $500/mo per client — [Mailtrap/Reply](https://mailtrap.io/blog/reply-io-review/) (author is Reply's Head of Content; not independent). Reply classification tags "interested / not interested / meeting booked" — [Instantly comparison](https://instantly.ai/blog/instantly-ai-reply-agent-vs-smartlead-lemlist-reply-io/).

*Salesforce Agentforce SDR.*
- Built in Agent Builder: "define the agent's tasks, upload knowledge files, set engagement rules, and define its tone of voice"; needs its own "Agent User" licence; prerequisites Sales Engagement, Einstein Activity Capture, Data 360; setup "days to weeks". Pricing: "$2 per conversation" or Flex Credits "$500 per 100K credits", not both in one org — [eesel](https://www.eesel.ai/blog/agentforce-sales-development) (competitor-written; Salesforce page 404). Positioned as mainly inbound/CRM-lead follow-up; "fully autonomous outbound is less mature" (search snippet, **unverified**). SaaStr reports "72% open rate on previously ghosted CRM contacts" — [SaaStr](https://www.saastr.com/dear-saastr-i-want-to-roll-out-an-ai-sdr-how-do-i-start).

*HubSpot Breeze Prospecting Agent.*
- "monitors buying signals like funding rounds, leadership changes, and site visits"; "scores accounts against your ideal customer profile"; "sources the full buying committee from providers, including ZoomInfo, Apollo, Surfe, and Seamless"; "drafts emails in each rep's voice, personalized by account, grounded in company signals"; configurable "research criteria, messaging style, and engagement rules". Outcome pricing: "$1/per lead" when the agent "recommends outreach for a lead", on HubSpot Credits; available on Starter, Professional, Enterprise — [HubSpot](https://www.hubspot.com/products/sales/ai-prospecting-agent).

*Clay.*
- Template catalogue tags: AI copywriting, AI personalization, AI research, Account research, Automated inbound, Automated outbound, Claygent, Enrichment, List building, Qualification & classification, Scoring & signals; examples "Find lookalikes of warm leads and send to a Smartlead campaign", "Score leads based on several criteria" — [Clay templates](https://www.clay.com/templates).
- Workflows (open beta): run against **Audiences** ("source of truth"); triggers = audience membership, schedule over a segment, webhook, cron, manual; nodes = enrichments, actions, Claygents, **Code nodes (Python)** for "transforms, scoring, routing logic"; branching by field rule, Python expression, or "a Claygent's judgment"; "Results write back to the record, so your next play starts from what the last one learned"; per-run tracing, record-level cost, version snapshots pinned per run — [Clay Workflows](https://www.clay.com/blog/introducing-workflows).
- Claybook anatomy (champion tracking): Import champions from CRM → find LinkedIn URL → "Monitor for job changes" (look-back 3/6/12 months; refresh daily/weekly/monthly/quarterly; outputs new company, domain, work email, old company, start date) → "Act on job mover signals" (update CRM, stack signals, Slack alert) — [Clay University](https://www.university.clay.com/claybooks/track-job-changes-for-champions-at-existing-customers).

*Apollo.*
- Outbound Copilot five steps: define ICP in plain English → AI research from web + Apollo DB → sequence with "signal-based personalization via Messaging 4.0" → "Launch with approvals" (manual/automatic) → post-meeting follow-ups from conversation summaries; recommends manual review for new ICP segments and "volume caps per run"; AI Content Center configured with value prop, pains, differentiators — [Apollo insights](https://www.apollo.io/insights/ai-assistant-for-outbound-teams-needing-speed). Workflows = "a trigger, optional conditions, and one or more actions" (enroll in sequence, assign task, update record, notify) — [Apollo Workflows Overview](https://knowledge.apollo.io/hc/en-us/articles/14296116597901-Workflows-Overview) (snippet; page returned 403). No product called "plays" found. Solo-founder 60-day test: reply 4.2%→5.8%, cost/meeting $32→$21 — [aiagentrank](https://aiagentrank.io/blog/apollo-io-review-2026) **unverified**.

*Unify.*
- Plays: signals "across website visits, product usage, job changes and more"; "Trigger any series of actions from enrichment, prospecting, AI Agents, sequencing, Slack alerts"; "multi-step Agents that can research, qualify, and personalize messaging"; sequences blend "automated email, manual tasks, call steps, and social engagement"; "Run outbound from a single chat" — [Unify Plays](https://www.unifygtm.com/product/plays). Pricing: Growth $1,740/mo annual, 50,000 credits/yr, 1 user, 8 managed mailboxes — [ZoomInfo pricing page](https://pipeline.zoominfo.com/sales/unify-gtm-pricing) **unverified, other sources differ**.

*Common Room.* Context360 unifies "CRM, product, marketing, and engagement" signals; Person360, Enrichment (400M+ directory), Prospector, AI Scoring, Buying Committee, "MCP & CLI"; DataAgent cleans duplicates/stale records; Engage pre-fills emails and auto-advances sequences; Dial; Forecast — [Common Room](https://www.commonroom.io/product/). Essential ~$2,100-2,500/mo annual ([Landbase](https://www.landbase.com/blog/commonroom-pricing), [salesmotion](https://salesmotion.io/blog/common-room-pricing)) **unverified**; "Zoom agreed to acquire Common Room on 2 July 2026" — search snippet, **unverified**.

*Instantly / Smartlead.* Instantly AI Reply Agent: reads replies, drafts within five minutes, custom labels ("Interested", "Closed-Won", "Not Interested"), Reply Macros, HITL vs Autopilot, 5 credits per AI reply; plans $37/$97/$358 — [Instantly](https://instantly.ai/blog/instantly-ai-reply-agent-vs-smartlead-lemlist-reply-io/). Smartlead classes "Interested, Objection, Referral, Out-of-Office, Unsubscribe" (same page); SmartAssistant chat panel in every account — [Smartlead](https://www.smartlead.ai/blog/what-is-smartassistant).

*Lavender.* "analyzes your historic emails to understand what works"; benchmark of 231,818 cold emails (4 Feb 2026) excluding auto-replies, segmented by department/seniority/industry; A-grade to operations 5.4% reply (+58%), finance A-grade +79%, engineering/product 5.2% — [Lavender benchmark](https://lavender.ai/blog/the-cold-email-benchmark-report); "0–50 word emails get 23% more replies" — [Lavender best practices](https://www.lavender.ai/blog/6879935-lavender-best-practices) (snippet); A-grade 3.4%→4.3% — [Woodpecker](https://woodpecker.co/blog/lavender-ai/).

*Lindy.* Credit pricing: free $50 credits, Team $29.99/mo for 3,000 credits, top-ups $10/1,000; handoff demo = 5 tool calls (hubspot.update_deal, notion.create_doc, slack.post_message, zoom.schedule, gmail.send) — [Lindy](https://www.lindy.ai/solutions/sales).

*Valley.* $199/seat/mo or $149/mo billed quarterly; one LinkedIn account per seat; signals "Hiring AEs", "Competitor complaints", "Keyword engagement", LinkedIn post engagers, profile viewers; "15-45%" reply claim is vendor marketing — [Valley](https://www.joinvalley.co/).

*Topo.* Signals: competitors, hiring, CRM data, funding; multichannel email/social/call; calling queue with signal context; Copilot approval; no public pricing — [Topo](https://www.topo.io/).

*Landbase.* GTM-1 Omni = orchestrated agents (list, copy, send/schedule) with "planning and decisioning", "generator" and "prediction and reward" models; trained on "40 million historical campaigns" (vendor claim); $30M raise — [Landbase blog](https://landbase.com/blog/landbase-announces-gtm-1-omni-action-models-the-future-of-go-to-market-automation), [dev.to repost](https://dev.to/landbasegtm/landbase-raises-30m-to-scale-gtm-1-omni-reinforcement-learning-meets-go-to-market-23km). Docs page 404.

*Gong / Clari-Salesloft (brief).* Aggregator claims: Gong "Mission Andromeda" (Feb 2026) autonomous agents, "Gong Credits" consumption pricing (June 2026); Clari-Salesloft "dozens of named AI agents" and "an MCP server that lets Claude and ChatGPT query live pipeline data" — [AI Agent Index](https://theaiagentindex.com/compare/gong-vs-clari-copilot) **all unverified; primary pages not reachable**. Salesloft's own page confirms Rhythm and Agent/Human/Agent+Human action tags — [Salesloft](https://www.salesloft.com/platform).

*Outreach, Attention, Relevance AI, Persana pricing.* Outreach agents page 404 (aggregator lists it "Semi-autonomous" — [aiagentrank](https://aiagentrank.io/compare/lavender-vs-outreach) low value). Attention homepage only says "AI agents that learn from your best sales conversations" — [Attention](https://attention.com/). Relevance AI's Bosh "enterprise-only and sold through a demo" — [Salesforge](https://www.salesforge.ai/blog/relevance-ai-vs-lindy-ai) **unverified**. Persana $68-$85/mo — conflicting third-party figures, **unverified**.

**Stage-by-stage: how "get me 20 meetings with X" becomes an outcome (leaders only; "—" = not described on the sources fetched)**

| Stage | 11x Alice | Artisan Ava | AiSDR Ami | Jason (Reply.io) | HubSpot Breeze | Apollo Copilot | Clay Workflows | Unify |
|---|---|---|---|---|---|---|---|---|
| ICP definition | target buyers + "moments" configured; CRM context | title/industry/geo/company filters | URL → "full campaign play" (targets, timing, angles) | user supplies ICP, value prop, intent signals | ICP scoring of accounts; research criteria | plain-English ICP → filtered list | Audience segments (data layer) | chat builds list from plain language; 30-100 named accounts |
| List building | 400M-contact DB (vendor claim) | 250M+ contacts | 2B+ profiles / 300M native | sources prospects (Autopilot) | buying committee from ZoomInfo, Apollo, Surfe, Seamless | Apollo DB | search in tables; workflows cannot yet source | 1.1B+ contacts (vendor) |
| Enrichment | — | enrichment stage | waterfall across 20 providers | — | provider data | AI research from web + DB | enrichments, waterfall via function | B2B Data |
| Intent signals | funding, hiring, job change, tech, site visits, G2, earnings, competitor reviews, renewals; weighted/layered | intent data | job change, LinkedIn activity, content downloads | intent signals "to watch" | funding, leadership change, site visits, blog reading | signal-based personalization (Messaging 4.0) | signals + Python intent score | 25+ signals: web visits, funding, hiring, competitor mentions |
| Research | Deep Research (news, 10-K) | — | LinkedIn, news, web | — | account research | AI Research | Claygent multi-step | agent gathers research |
| Sequencing | email + social + dialer, context carried | campaign creation | email, LinkedIn, calls, video, voice | builds sequences | email, calls, LinkedIn | email, call, social tasks | hand-off to Smartlead/HeyReach etc. | email + manual tasks + calls + social |
| Personalization | one message per contact | Personalization Waterfall (secondary, unverified) | brand voice + ICP + research | — | "each rep's voice", signal-grounded | AI Content Center (value prop, pains) | AI copywriting columns/nodes | founder voice; founder edits first touch |
| Reply handling | Smart Replies; escalate sensitive; opt-out immediate | autonomous replies | <10 min; co-pilot; rep for high-intent | handles replies (Autopilot) | — | — | — | founder answers every conversation |
| Booking | — (Julian has it) | calendar integration | immediate calendar booking | books meetings | — | post-meeting follow-ups | — | human |
| CRM sync | bi-directional, CRM is source of truth | — | HubSpot/Salesforce logging + scoring write-back | — | native (Smart CRM) | native | write-back to record | — |
| Reporting | meetings booked, test messages/segments/triggers | — | Ami reviews campaign data on request | — | — | — | per-run traces, cost per record | Analytics (nav only) |
| Learning loop | scale what converts | — | remembers ICP/preferences; reuse best structures | — | review → autonomous once quality OK | — | next play starts from last play's write-back | — |

Sources for the table: [11x Alice](https://www.11x.ai/worker/alice), [11x signals](https://www.11x.ai/platform/data-lead-generation/signals-and-triggers), [Artisan](https://www.artisan.co/llms-full.txt), [AiSDR features](https://aisdr.com/features/), [AiSDR pricing](https://aisdr.com/pricing), [Mailtrap/Reply](https://mailtrap.io/blog/reply-io-review/), [HubSpot](https://www.hubspot.com/products/sales/ai-prospecting-agent), [Apollo](https://www.apollo.io/insights/ai-assistant-for-outbound-teams-needing-speed), [Clay Workflows](https://www.clay.com/blog/introducing-workflows), [Unify guide](https://www.unifygtm.com/explore/how-to-do-founder-led-sales), [Unify Plays](https://www.unifygtm.com/product/plays).

**Approval-UX patterns observed (what the founder actually clicks)**

| Pattern | Who uses it | Mechanism | North mapping |
|---|---|---|---|
| Review every draft, then graduate to autopilot | HubSpot Breeze, 11x (per 11x-sourced video), Apollo "manual or automatic" | per-enrollment review toggle; switch off once "satisfied with output quality" | Keep first contact on cards permanently; allow graduation only for follow-up bumps and known-contact re-engagement |
| Copilot mode for replies only | AiSDR, Instantly HITL, Artisan "optional approval mode holds each reply" | AI classifies and drafts; human releases | Reply card (K0) with the AI draft pre-filled; auto-send only for OOO/unsubscribe acknowledgements |
| Locks and escalation rules | Artisan ("tone and CTA locks, escalation rules"), Regie "guardrails" | policy fields on the campaign | Put locks on the Play record so a batch approval is safe |
| Slack review channel above a score threshold | Clay signal-based play | score ≥ threshold → post draft to channel | Equivalent to North's card queue; add the score to the card |
| "Never sends without visibility", learns from dismissals | Amplemarket Duo, Valley, Topo | suggest → edit/regenerate/send; dismissals feed model | Store card edits/dismissals as critic training data |
| Handoff with context | Agentforce (copies rep, logs timeline), GTMLens "booking is the handoff" | meeting link from rep calendar; full thread logged | Cal.com booking webhook writes thread + brief + signal into the pipeline record |

Sources: [HubSpot](https://www.hubspot.com/products/sales/ai-prospecting-agent), [Tools 8020 video](https://www.youtube.com/watch?v=Ek5HBmlGCsA), [Apollo](https://www.apollo.io/insights/ai-assistant-for-outbound-teams-needing-speed), [AiSDR pricing](https://aisdr.com/pricing), [Instantly](https://instantly.ai/blog/instantly-ai-reply-agent-vs-smartlead-lemlist-reply-io/), [Artisan](https://www.artisan.co/llms-full.txt), [Clay](https://www.clay.com/blog/introducing-workflows), [Amplemarket](https://www.amplemarket.com/duo), [Valley](https://www.joinvalley.co/), [Topo](https://www.topo.io/), [eesel/Agentforce](https://www.eesel.ai/blog/agentforce-sales-development), [GTMLens](https://gtmlens.com/bp-why-ai-sdrs-fail-three-patterns/).

**Pricing summary (lowest public entry point; vendor page unless noted)**

| Product | Entry price | Unit | Source quality |
|---|---|---|---|
| AiSDR | $1.50 per person prospected, PAYG | per contact | official |
| HubSpot Breeze | $1 per recommended lead (credits) | per outcome | official |
| Agentforce SDR | $2/conversation or $0.005/credit | per usage | secondary |
| Instantly | $37/mo + 5 credits/AI reply | seat+usage | official blog |
| Lindy | $29.99/mo (3,000 credits) | credits | official |
| Valley | $149-199/seat/mo | seat | official |
| Reply.io Jason | $500/mo annual | agent | vendor-authored review |
| Unify | ~$1,740/mo annual | credits+seats | unverified |
| Common Room | ~$2,100-2,500/mo annual | contacts+seats | unverified |
| Regie | $180-499/user/mo, 5-10 seat min | seat | unverified |
| 11x | ~$3,750/mo annual | agent+prospects | unverified |
| Artisan | credit-based, quote only | credits | official (no figures) |

### Inferences
- The market priced "autonomy" at $36k-45k/yr (11x) and is now being undercut by outcome/usage pricing ($1/lead Breeze, $1.50/contact AiSDR, $2/conversation Salesforce). North's cost structure (user's own API keys, founder approval) fits the usage end, not the agent-salary end.
- Approval UX has converged on three toggles: (1) review-every-draft vs autopilot, (2) reply co-pilot (human for "high-intent or edge cases"), (3) "locks" (tone, CTA) and escalation rules. North's decision card is toggle (1) made mandatory for first contact; it should add (2) and (3) explicitly.
- The only vendors that log *why* a message was sent (signal that fired, research with sources) are 11x ("Deep Research", signal-fired action) and Clay (per-run traces with Claygent reasoning). That is the evidence model North already requires; it is a differentiator, not table stakes.

### Gaps
- No official pricing for 11x, Artisan, Regie, Unify, Common Room, Topo, Persana; figures above are third-party and conflict.
- Outreach, Gong, Clari, Relevance AI Bosh, Attention and Landbase docs: primary pages unreachable; no verified feature inventory.
- No independent benchmark of reply-agent accuracy (Instantly vs Smartlead vs Jason).

## Q2. What practitioners and reviews say: which AI SDRs produce meetings in 2026 and why many fail

### Takeaway
Practitioner sources agree on four failure causes — bad/bulk lists, deliverability collapse from volume, template-shaped "personalization", and unmonitored replies — and on one fix: a human owns targeting, reviews copy, and answers replies; the AI owns research, drafting and monitoring. The hard numbers are all vendor- or operator-reported, not independent.

### Cited Findings
- Operator study (OneAway, ~1.5M cold emails): AI-SDR-style sending produced "roughly 6.4x the volume with roughly 38% lower reply rates"; "'Autonomous' is marketing, not reality"; AiSDR works out to "$0.56–$0.75 per AI message" — [OneAway](https://oneaway.io/blog/ai-sdr-tools-2026) (vendor of done-for-you outbound).
- GTMLens: 0.5% positive reply on 5,000 contacts = 25 replies vs 3% on 500 = 15; open rates fell "from 40–50% in week one to 8–12% by week three" on shared pools; "The meeting booking should be the handoff, not the endpoint." Patterns that work: (A) 50–200 named accounts, AI writes a "3–5 sentence research summary per contact", human writes sequence, 5–10% positive reply; (B) DIY on Claude, human reviews and sends, 60–80 emails/day, 3–5% positive; (C) AI drafts, human reviews every draft and handles replies, $6-8k/mo. Figures are "operator-reported outcomes … through Q1 2026" — [GTMLens](https://gtmlens.com/bp-why-ai-sdrs-fail-three-patterns/).
- SaaStr rollout advice: "AI SDRs don't fix a fuzzy ideal customer profile"; "Don't let the vendor write your templates" (5–7 templates from closed deals); "The first 1,000 emails need to be manually reviewed"; "It took 30 days of daily tuning"; then "30–45 minutes per day, minimum, for the first 60–90 days"; define handoff and response SLA before launch. Results: Artisan 5.5% response on cold, 11–12% on warm; Agentforce 72% open on ghosted CRM contacts; Qualified 71% of a month's closed-won from AI-qualified inbound — [SaaStr](https://www.saastr.com/dear-saastr-i-want-to-roll-out-an-ai-sdr-how-do-i-start).
- firstsales.io "7 mistakes": churn "between 50 and 70 percent" within three months; safe volume "ten to twenty emails per day"; Google complaint target 0.08%; "Route prospects into sequences only when a qualifying signal fires, not on a fixed schedule"; positive replies to a human "within four hours"; weekly review of 25–50 emails per campaign; "Require human sign-off for new segments, new templates, and large sends"; AI kept emailing after an opt-out ("the conversation we haven't had yet") — [firstsales](https://firstsales.io/blog/ai-sdr-mistakes/) (figures unsourced).
- AiSDR's own industry report (75+ production teams): "88% of pilots stall before production"; failed rollouts end by "9 weeks"; "50% of failed AI SDR teams had well-personalized copy but lost on context and timing"; scaling teams run a "70/30 AI-to-human split"; "3.5 to 16.2 meetings per SDR per month" by month 6 — [AiSDR report](https://aisdr.com/ai-sdr-industry-report/) (vendor, methodology undisclosed).
- Study of 100,000 outbound emails: AI-written 4.1% reply / 0.7% meetings vs human 5.2% / 1.1% — [ZielLab](https://ziellab.com/post/ai-sdr-2026-what-works-b2b-guide) (search snippet; primary study not located).
- Reddit (via secondary): r/sales "Human SDRs vs AI SDRs": "it does automates cold email task, but I guess SDR does a lot more than cold emailing" (u/NeedleworkerHour169); r/sales "Cold outreach that actually works": "Keep it short. Keep it relevant. Sound like a human." — [Postelix](https://www.postelix.com/ai-sdr-reddit) quoting [thread 1](https://www.reddit.com/r/sales/comments/1f55p2f/human_sdrs_vs_ai_sdrs/), [thread 2](https://www.reddit.com/r/sales/comments/1kpnfkd/cold_outreach_that_actually_works/). r/SalesOperations user cancelled an AI SDR "after about two payments at roughly $2k a month" — [Yalc](https://www.yalc.ai/blog/best-ai-sdr-tools-reddit/) (secondary).
- Hands-on reviewer of 11x/Artisan/AiSDR: 11x "the biggest disappointment", both 11x and Artisan "cannot handle replies at all", annual lock-in — [Medium, saassalesdirector](https://saassalesdirector.medium.com/11x-ai-review-worth-the-hype-a33e89a9716f) (page 403; from search summary, **unverified**).
- G2: Artisan Sales 3.9/5 (22 reviews) vs 11x 4.5/5 (30) — [G2](https://www.g2.com/compare/11x-vs-artisan-sales) (snippet).
- Founder-focused YouTube framing (July 2026): "AI should own research, signal monitoring, enrichment, and first-touch drafts. Humans should own judgment, reply quality, pricing conversations … Why reply review and handoff rules are the real product" — [Matterable](https://www.youtube.com/watch?v=kRjUsUK8XlM) (description only; transcript unavailable).
- Mailbox provider rules and the 3.43% average / 10%+ top-decile reply benchmark are in dept-sales (Instantly 2026 report) and not repeated.

### Inferences
- Meetings come from the list and the signal, not the model. Every success pattern caps volume (≤200 contacts/month, ≤20/day/inbox) and keeps a human on replies within hours. North's defaults (batch 5→10→20, cap 20/day, reply triage K0) are aligned; the missing piece is a **reply SLA** surfaced to the founder (positive reply → card within 4 hours).
- The highest-conviction fully-agentic use case is inbound/warm (Qualified Piper, Agentforce on ghosted CRM contacts), not cold outbound. North could allow autopilot for *replies to existing threads* and *re-engagement of known contacts* while keeping cards for first contact.

### Gaps
- No independent, methodology-disclosed benchmark of AI SDR meeting rates exists in the sources found; all figures are vendor or operator claims.
- Direct Reddit thread content could not be fetched; 30 Minutes to President's Club material was not reachable before the search budget ended.

## Q3. How products encode playbooks: what a reusable "play" looks like as data

### Takeaway
Across Clay, Apollo, Unify, 11x and HubSpot a play is the same object: **trigger (signal or schedule or membership) → audience filter → enrich/research steps → score/branch → draft (with voice/offer config) → approval gate → sequence → write-back + stop rules**, with per-run traces and versions. Clay Workflows is the most explicit data model and the closest to North's needs.

### Cited Findings
- Clay Workflow = Audience segment + trigger (membership, schedule, webhook, cron, manual) + nodes (enrichment, Claygent, Code/Python, integrations) + branching (field rule, Python expression, Claygent judgment) + write-back to record; each run has tracing, record-level cost and is "pinned to the version it started on"; signal-based outbound play "layers several account signals into an intent score" and posts above-threshold drafts to a Slack review channel — [Clay Workflows](https://www.clay.com/blog/introducing-workflows).
- Claybook template = ordered steps with configurable parameters (look-back 3/6/12 months, refresh cadence) and a final "Act on job mover signals" step with pluggable actions — [Clay University](https://www.university.clay.com/claybooks/track-job-changes-for-champions-at-existing-customers).
- Clay template taxonomy tags (List building, Enrichment, Scoring & signals, Qualification & classification, AI research, AI personalization, Automated outbound/inbound) — [Clay templates](https://www.clay.com/templates).
- Apollo Workflow = "a trigger, optional conditions, and one or more actions"; Copilot adds "volume caps per run" and manual/automatic approval — [Apollo Workflows](https://knowledge.apollo.io/hc/en-us/articles/14296116597901-Workflows-Overview), [Apollo insights](https://www.apollo.io/insights/ai-assistant-for-outbound-teams-needing-speed).
- Unify Play = signal → "any series of actions from enrichment, prospecting, AI Agents, sequencing, Slack alerts" → multi-channel sequence mixing automated email, manual tasks, calls, social — [Unify Plays](https://www.unifygtm.com/product/plays). Unify's founder guide adds explicit **stop rules**: opt-out → stop; bounce rate "above a few percent" → pause and re-verify; drafts going out unread → restore review; no reply after 3 touches → change angle, wait 5 days; OOO → pause until return +2 days; list > ~100 weak-fit → cut back — [Unify founder guide](https://www.unifygtm.com/explore/how-to-do-founder-led-sales).
- 11x signal config = signal types with weights, thresholds, and layering ("several open SDR roles plus a recent VP Sales departure") varying "by segment or campaign" — [11x signals](https://www.11x.ai/platform/data-lead-generation/signals-and-triggers).
- HubSpot agent config = "research criteria, messaging style, and engagement rules" + per-rep voice — [HubSpot](https://www.hubspot.com/products/sales/ai-prospecting-agent). AiSDR adds persistent memory of ICP/preferences and "Start from what already works" — [AiSDR features](https://aisdr.com/features/). Amplemarket Duo "learns from dismissals and edits" — [Amplemarket](https://www.amplemarket.com/duo).
- Open-source: a GitHub search for AI SDR / cold-email agents returned only two 0-star 2026 repos (LangGraph research→decision-maker→email; Airflow+Gemini pipeline) — [lazerbeam47](https://github.com/lazerbeam47/Auto-SDR-Sales-Dev-Representative-), [alex3ai](https://github.com/alex3ai/marketing-ai-agent). The skills repos (Anthropic sales plugin, marketingskills) are covered in dept-sales.

### Inferences
- A North `Play` record should be: `{id, version, trigger: {kind: signal|schedule|membership|manual, signal_types[], weights, threshold}, audience: {icp_filters, suppression_refs}, steps: [{kind: enrich|research|score|draft|approve|send|wait|branch, params}], voice_profile_ref, offer_ref, caps: {per_run, per_day_per_inbox}, stop_rules[], write_back: [...]}`, with each run append-only and pinned to the play version — exactly Clay's model, with North's `AuthorityEngine.gate()` as the mandatory `approve` step for `email.send.*` first contact.
- "Learning loop" in the market is mostly (a) memory of founder edits/dismissals and (b) reuse of best-performing structures, not RL. North can get 80% of it by storing the founder's edits on each card as training examples for the critic.

### Gaps
- No vendor publishes its play schema; the above is reconstructed from docs and blog descriptions. Clay's Workflows export format was not found.

## Q4. Solo founder, founder-led sales: recommended first-30-days motion in 2026 and what to automate

### Takeaway
The consistent 2026 advice: 30–100 named accounts, signal-ordered, researched first touch in the founder's voice, ≤20 emails/day/inbox, 3–5 touches, every reply answered by the founder within hours; automate research, monitoring, warmup, verification and follow-up bumps; never automate the first touch's wording or the conversation. Hire or hand to an agent only once the motion is repeatable.

### Cited Findings
- Unify five-step founder playbook: "Tighten the ICP" to 30–100 named accounts; "Let signals set the order"; "Personalize from research, in your voice" (agent gathers and drafts, "The founder edits and sends"); "Protect deliverability" (21-day mailbox ramp, pacing, pre-send verification); "Scale before hiring" via task-based sequences; expected ~50–70% open, ~5% reply; rule "automate the research, not the relationship"; enterprise sellers use sequences "only for follow-up bumps, never the first touch"; EU sellers need consent handling — [Unify](https://www.unifygtm.com/explore/how-to-do-founder-led-sales) (Peridio case study self-reported).
- Mailshake: start with 10–20 companies "that would benefit most from your product right now", "about 90 minutes per day", no CRM required — [Mailshake](https://mailshake.com/blog/founder-led-outbound/).
- SaaStr: 2–4 weeks of ICP and messaging work before any AI send; review the first 1,000 emails; daily 30–45 min tuning for 60–90 days — [SaaStr](https://www.saastr.com/dear-saastr-i-want-to-roll-out-an-ai-sdr-how-do-i-start).
- GTMLens pattern A: 50–200 named accounts, AI research summary per contact, hand-written sequence, ~200 contacts/month, 5–10% positive reply — [GTMLens](https://gtmlens.com/bp-why-ai-sdrs-fail-three-patterns/).
- Salesflow: most founders hire an SDR "before there is a proven ICP, tested messaging, or a sequence worth handing off" — [Salesflow](https://salesflow.io/audiobooks/sell-it-yourself-first-the-founders-guide-to-saas-outbound). Valley solo-founder stack claims ~2 hours/week of human review — [Valley](https://www.joinvalley.co/blog/solo-founder-outbound-playbook-2026) (vendor). Founder 15–30% vs SDR 3–8% reply — [Danish Leadco](https://danishleadco.io/blog/why-most-saas-founders-should-run-their-first-outbound) **unsourced**.
- AI-assist proof points: Apollo solo-founder test reply 4.2%→5.8% over 60 days — [aiagentrank](https://aiagentrank.io/blog/apollo-io-review-2026) **unverified**; Lavender A-grade emails +27% replies (3.4%→4.3%) — [Woodpecker](https://woodpecker.co/blog/lavender-ai/).

### Inferences
- A North "Day 1–30" default play: Week 1 ICP + offer + voice profile + 50 named accounts (cards: approve ICP, approve offer); Week 2 DNS/warmup, verification, research briefs, first 5 contacts/day via cards; Week 3 raise to 10/day if bounce <2% and no complaints, add fixed follow-ups (day 3–4, 8–10); Week 4 review: reply-rate by signal type and angle, prune angles with 0 replies after 3 touches, write the learned sequence as a versioned play.
- Automate: list building, enrichment, verification, signal watch, research brief, draft, follow-up bumps, reply classification, pipeline logging, bounce/opt-out suppression. Keep human (card or founder inbox): ICP/offer, first-touch final wording, any reply from a person, pricing, meeting itself.

### Gaps
- No source gives a controlled comparison of founder-written vs AI-drafted first touches at equal list quality; the 15–30% founder reply figure is unsourced.

## Q5. Features North should adopt (ranked) and patterns to avoid

### Takeaway
Adopt the market's signal→research→draft→gate→sequence→write-back loop with explicit stop rules, reply SLAs and run-level traces; avoid volume, shared infrastructure, template personalization, hidden autopilot and annual lock-in.

### Cited Findings (features North should adopt, ranked by evidence and fit)
1. **Signal-fired plays with weights, thresholds and layering** (11x), routed "only when a qualifying signal fires, not on a fixed schedule" (firstsales); reply-rate lift claims for signal-led lists (Unify ~5%, firstsales 15–25% unsourced) — [11x signals](https://www.11x.ai/platform/data-lead-generation/signals-and-triggers), [firstsales](https://firstsales.io/blog/ai-sdr-mistakes/), [Unify](https://www.unifygtm.com/explore/how-to-do-founder-led-sales). Why: the card already demands a "why"; a weighted signal makes it machine-checkable.
2. **Research brief with citations per contact** (11x "Deep Research … 10-K filings"; GTMLens "3–5 sentence research summary per contact") — [11x](https://www.11x.ai/worker/alice), [GTMLens](https://gtmlens.com/bp-why-ai-sdrs-fail-three-patterns/). Why: this is the card's evidence body.
3. **Versioned plays with per-run traces, record-level cost and write-back** (Clay Workflows) — [Clay](https://www.clay.com/blog/introducing-workflows). Why: maps onto North's append-only `actions` and evidence model.
4. **Stop rules as data** (Unify: opt-out, bounce >few %, unread drafts, 3 touches no reply, OOO +2 days, list bloat) — [Unify](https://www.unifygtm.com/explore/how-to-do-founder-led-sales). Why: cheap, deterministic, protects the domain and the founder's reputation.
5. **Reply classification + reply SLA + co-pilot handoff** (Instantly labels and HITL mode; AiSDR "rep pulled in only for high-intent replies"; firstsales "positive replies … to a human within four hours") — [Instantly](https://instantly.ai/blog/instantly-ai-reply-agent-vs-smartlead-lemlist-reply-io/), [AiSDR](https://aisdr.com/features/), [firstsales](https://firstsales.io/blog/ai-sdr-mistakes/). Why: replies are where meetings are won or lost; North should raise a K0/K1 card the moment a human replies.
6. **Tone/CTA locks and escalation rules** (Artisan) — [Artisan](https://www.artisan.co/llms-full.txt). Why: lets the founder approve a *batch* safely (dept-sales rec. 4) without reading every follow-up.
7. **Learning from edits and dismissals** (Amplemarket Duo; AiSDR memory; Lavender historic-email analysis) — [Amplemarket](https://www.amplemarket.com/duo), [AiSDR](https://aisdr.com/features/), [Lavender](https://www.lavender.ai/). Why: every card edit is free training data for the critic persona.
8. **Email scoring before approval** (Lavender grade; 0–50 words +23%) — [Lavender best practices](https://www.lavender.ai/blog/6879935-lavender-best-practices). Why: a rubric score on the card reduces founder review time.
9. **Volume caps per run and per inbox, and "new segment/template requires sign-off"** (Apollo caps; firstsales 20/day until 90 clean days) — [Apollo](https://www.apollo.io/insights/ai-assistant-for-outbound-teams-needing-speed), [firstsales](https://firstsales.io/blog/ai-sdr-mistakes/).
10. **Outcome-based accounting** (HubSpot $1/lead, AiSDR $1.50/contact; 11x "optimized for meetings booked") — [HubSpot](https://www.hubspot.com/products/sales/ai-prospecting-agent), [AiSDR](https://aisdr.com/pricing), [11x](https://www.11x.ai/worker/alice). Why: North's reporting should show cost per approved contact and per meeting, not opens.
11. **Meeting as handoff, not endpoint**: booking carries the thread, research and signal into the pipeline record (GTMLens; Agentforce copies the rep and logs to timeline) — [GTMLens](https://gtmlens.com/bp-why-ai-sdrs-fail-three-patterns/), [eesel](https://www.eesel.ai/blog/agentforce-sales-development).
12. **Champion job-change play** as the first non-cold play (Clay Claybook; AiSDR "Catch champions when they switch companies") — [Clay University](https://www.university.clay.com/claybooks/track-job-changes-for-champions-at-existing-customers), [AiSDR](https://aisdr.com/features/). Why: warm, high-reply, low-volume.

### Cited Findings (patterns to avoid)
- **Volume as the lever**: 6.4x volume → 38% lower replies; open rates collapsing to 8–12% by week three — [OneAway](https://oneaway.io/blog/ai-sdr-tools-2026), [GTMLens](https://gtmlens.com/bp-why-ai-sdrs-fail-three-patterns/).
- **Shared sending pools / vendor-managed mailboxes** (11x managed Gmail, Reply shared infra) — [SyncGTM](https://syncgtm.com/blog/11x-ai-review), [OneAway](https://oneaway.io/blog/ai-sdr-tools-2026); conflicts with North non-negotiable 6 (user's own accounts).
- **Template personalization** ("I noticed you recently joined Acme Corp … congratulations") — [firstsales](https://firstsales.io/blog/ai-sdr-mistakes/), [OneAway](https://oneaway.io/blog/ai-sdr-tools-2026).
- **Silent autopilot** (Breeze "fully autonomous mode", Unify Plays "on autopilot", Lindy demo sending without a visible gate) — [HubSpot](https://www.hubspot.com/products/sales/ai-prospecting-agent), [Unify Plays](https://www.unifygtm.com/product/plays), [Lindy](https://www.lindy.ai/solutions/sales).
- **Unmonitored reply queues / AI answering after opt-out** — [firstsales](https://firstsales.io/blog/ai-sdr-mistakes/).
- **Vendor-written templates and fuzzy ICP** — [SaaStr](https://www.saastr.com/dear-saastr-i-want-to-roll-out-an-ai-sdr-how-do-i-start).
- **Annual lock-in and hidden pricing** (11x, Artisan, Regie, Unify, Common Room all quote-gated) — [OneAway](https://oneaway.io/blog/ai-sdr-tools-2026), [Regie archive](https://www.regie.ai/pricing-archive).
- **Inflated outcome claims** (11x customer list; Valley 15–45%; Landbase 4–7x) — dept-sales TechCrunch; [Valley](https://www.joinvalley.co/), [Landbase](https://landbase.com/blog/landbase-announces-gtm-1-omni-action-models-the-future-of-go-to-market-automation).

### Inferences
- North's positioning line, supported by the evidence above: "the AI SDR that sends 20 emails a day, each with a signal, a sourced brief and the CEO's approval" — this is GTMLens pattern A/B productised, which is the pattern practitioners report works, at usage-level cost.
- The three decision-cards/day quota is compatible with the market's successful cadence only if cards approve *batches* (one card = one play run of ≤20 contacts) and reply cards are separate K0 items; otherwise the quota caps outreach at 3 contacts/day.

### Gaps
- Could not verify Artisan "Ava 2.0", Gong/Clari agent launches, Zoom–Common Room, Outreach agent inventory, or 11x/Artisan current pricing from primary sources.
- No YouTube transcript evidence (credits exhausted); no 30MPC or a16z/Bessemer/First Round primary analysis found before the search budget ended.
