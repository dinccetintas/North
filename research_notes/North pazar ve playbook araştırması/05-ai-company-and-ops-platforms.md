# 05 — AI company platforms and AI ops/finance/support/research tools: feature teardown for North

Date: 2026-10-16. Scope: (1) "whole-company" / AI-employee / AI-co-founder platforms; (2) AI products for
support, finance, research, analytics and incidents. Builds on `docs/research/polsia-teardown.md` and
section 4 of `docs/research/startup-playbook-and-journey.md` (not repeated here; Polsia is update-only).

Method and limits: ~45 web searches (shared per-turn budget hit), ~70 direct fetches of vendor docs and
pricing pages, GitHub repo search, one YouTube search (vidIQ credits then ran out; no transcripts).
Reddit was not reachable through search; "Reddit evidence" below is second-hand via aggregators and is
marked as such. Evidence grades: **P** = primary vendor doc/pricing page fetched; **S** = secondary
(blog, aggregator, competitor review); **U** = unverified. Prices are USD unless noted.

## KQ1. Whole-company / AI-staff layer: who claims autonomy, who is a workflow builder, what is the human-in-the-loop model, and does anyone have a decision budget?

### Takeaway
Only Polsia, Manus/Genspark and Beam sell "the agent runs it"; Lindy, Relevance, Dust, Zapier, Gumloop, n8n,
Make, Motion, Agentforce and Copilot Studio are workflow/agent builders with a chat skin. Every surviving
product converged on the same three-mode permission switch (auto / ask / server-decides) plus per-tool
read-vs-write defaults; **nobody publishes a per-day decision quota like North's 3 cards** — the closest
analogues are Zapier's per-run activity cap (agent stops and asks), Gumloop's "Don't ask again for this
tool", and Anthropic's hard dollar session budget.

### Cited Findings

**A. Classification (autonomy claim vs. reality)**

| Product | Promise, to whom | Claim | Reality on the page | HITL model | Billing unit | Grade |
| --- | --- | --- | --- | --- | --- | --- |
| Polsia | "AI That Runs Your Company While You Sleep", solo founders | Autonomous | Plan-execute loop, nightly cycle, "God mode" | None at task level; one click spends a credit | task credits + 3% of revenue + 20% of ad spend | P (teardown) / S |
| Lindy | "AI teammate" for individuals and Slack teams | Semi-autonomous | Routines (trigger + prompt + destination) and chat | Approval for any "outside impact" action; read-only free | credits, $0.01 each | P |
| Relevance AI | "AI workforce" of specialist agents, teams | Semi-autonomous | Agents + Tools + Workforces canvas | "Autopilot" vs "Human in the loop"; escalation to a human whose answer is stored | Actions + Vendor Credits | P |
| Dust | Custom agents on company data, teams | Builder | Agents with triggers, tools, MCP | Not described | credits per seat | P |
| Manus | General agent, consumers/pros | Autonomous | Cloud sandbox agent, Wide Research | Cost estimate before heavy jobs | credits | S |
| Genspark | "Super Agent"/"AI employee" | Autonomous | Research, slides, calls | Not documented | credits | S |
| OpenAI ChatGPT agent | Browsing+code agent for Plus/Pro/Business | Semi-autonomous | Pauses for approval/credentials | Confirmation before consequential actions | plan task limits | S |
| OpenAI AgentKit | Builder for devs | Builder | Agent Builder + Evals being wound down (Nov 30 2026) | n/a | model tokens | S/U |
| Claude Managed Agents | Hosted harness for devs | Harness | Agent/Environment/Session/Events, scheduled deployments, budgets, dreams, multiagent | `always_allow` / `always_ask` / `auto` per tool | tokens + $10/1k search + $0.08/h runtime | P |
| Claude Cowork | Desktop agent for knowledge work | Semi-autonomous | Goal in, works across folders/tools, scheduled tasks | "Deleting anything needs your approval"; optional plan-then-wait | subscription usage limits | P |
| Salesforce Agentforce | Enterprise agents | Builder | Agent Builder, Agent Script | Topic/action configuration | Flex Credits, $2/conversation | P |
| Copilot Studio | Enterprise agents | Builder | Autonomous agents "plan, learn, escalate" | Escalation; approval gates only on deployments | Copilot Credits | P |
| Gemini Enterprise | Enterprise agents | Builder | Agent Studio, gallery | Not retrieved | per seat (page 404) | S |
| Zapier Agents | SMB agents on 9,000+ apps | Builder | Instructions + tools + knowledge | Per-run activity cap, then agent asks | activities | P |
| Gumloop | Agents + Brain for teams | Builder | Agents, connectors, Gumball | 5 approval modes per app, CEL rules, Ask Question | credits ($0.005) | P |
| n8n | Workflow + AI nodes | Builder | Agent node, human fallback via Slack | Template posts to Slack, no pause/resume shown | executions | P/S |
| Make | AI Agents on scenarios | Builder | model + instructions + inputs | "add manual approvals, or stop the Agent at specific points" | operations | P |
| Motion | "AI employees" for teams | Semi-autonomous | AI Task Planner, Project Manager, Workflow Builder | none described | credits per seat | P/S |
| Beam AI | Agentic automation for ops teams | Autonomous | Task-based agents | none described; "Self Healing Outputs" | tasks | P |
| Ema | "Universal AI employee", enterprise | Autonomous | EmaFusion 30+ LLMs | n/a | enterprise | S |
| Sierra | Customer-facing agents, enterprise | Autonomous (bounded) | Ghostwriter, Explorer, testing | Proposal-only patterns, handoff | outcomes | P/S |
| Ohai | Household manager, families | Assistant | Calendar/meal/email triage | Human assistants review hard items | $9.99+/mo | P |
| ValidatorAI / FounderPal / IdeaBuddy / Mixo | Idea validation, aspiring founders | Advice only | Scoring, plans, landing pages | n/a | free / lifetime deals / plans | P/S |

**B. Polsia (update since 2026-10-14 teardown)**
- Founder (Mixergy, 2026-05-27): "There's 10% of companies that made at least a dollar"; best outcome ~$3–4k; ~50% churn in month one and again in month two; ~$10M run rate (May) — [Crevio, competitor](https://crevio.co/blog/is-polsia-legit). Our teardown cites $18.7M ARR in Sep ([polsia-teardown](../../docs/research/polsia-teardown.md)) — treat the growth as founder-stated, S.
- Trustpilot 3.3/5 on 347 reviews (2026-10-02), 35% five-star / 30% one-star; complaints: credits used up on work with unclear price, delivered sites fail, tasks "forgotten or reported done when they aren't", charges after cancelling — [Crevio](https://crevio.co/blog/is-polsia-legit). Fee change Sept 2026: 3% on payments, 31-day hold, 20% of ad budget — same source.
- `/changelog` is an SPA that did not render for a fetch on 2026-10-16; no primary changelog evidence (U).

**C. How each turns a goal into work (intake → team → plan → execute → progress → approvals → memory → reporting → learning)**

- **Lindy** — Intake: chat; Routines have "a trigger (when it runs), a prompt (what to do, in plain English), a destination (where the result goes)"; schedule or event triggers with "Smart Filter"; new routines default to "daily at 9:00 AM"; built-in "Daily briefs" routine and "Morning briefing" template; "dry run" fires end-to-end with nothing "sent, posted, or written" — [Lindy docs: Routines](https://docs.lindy.ai/teammate/routines). Approvals: "Actions with outside impact require approval" (send email, update ticket, post to another channel, publish doc); "Read-only lookups from approved sources don't require approval"; credits pause when pool runs low — [Lindy docs: Pricing](https://docs.lindy.ai/pricing). Memory: a visible file system; skills live in `.skills/<name>/SKILL.md`, durable knowledge in `.memory/`; Personal overrides Team overrides System; every save is a version — [Lindy docs: Memory](https://docs.lindy.ai/teammate/memory). Learning: skills "created through chat" when you describe a process — [Lindy docs: Skills](https://docs.lindy.ai/teammate/skills).
- **Relevance AI** — Intake: "Invent" builds an agent from a description, or clone from Marketplace; Tools are "inputs → steps → outputs" built visually; Workforces link agents on a canvas with handoffs; "Set guardrails and deploy" step configures "escalations, approval workflows, and triggers" — [Relevance docs](https://relevanceai.com/docs), [Tools](https://relevanceai.com/docs/get-started/core-concepts/tools). Modes "Autopilot" and "Human in the loop"; escalated answers are stored "for future reference" — [Agents](https://relevanceai.com/docs/get-started/core-concepts/agents). Per-tool approval options (auto-run / approval required / let agent decide) were cited in the earlier playbook doc ([C12](https://relevanceai.com/docs/workforce/workforce-features/agent-to-tool-configuration)).
- **Dust** — Multi-agent orchestration with "scheduled and event-driven triggers"; custom agents use "skills, knowledge, and tools"; 5 remote MCP servers on Business; no approval workflow on the pricing page — [Dust pricing](https://dust.tt/pricing).
- **Zapier Agents** — Ready-made agents (Meeting Prep, Lead Qualification, Zendesk Ticket, Expense Classifier); "Monitor activity"; "Chat when needed" — [Zapier Agents](https://zapier.com/agents). Billing "activities, not tasks"; "Per-run cap: 10 activities per run on Free, 40 on paid plans. At the cap, the agent asks before continuing" — [Zapier pricing](https://zapier.com/pricing).
- **Gumloop** — Approval modes per connector: "Always allow" (default), "Ask each time", "Ask for writes/deletes", "Never allow", "Custom" (per tool); App Rules in CEL check actual arguments (e.g., external recipient); "Ask Question" ability shows choice cards; approvals resolved in chat, Tasks page "Approval Required" filter, or Slack (Approve / Reject / Open in Gumloop); "Don't ask again for this tool"; subagent checkpoints "Continue"/"Stop" — [Gumloop HITL docs](https://docs.gumloop.com/core-concepts/human_in_the_loop.md). Credits: $0.005 each; 1 credit per successful tool call, failed calls free; 5 credits/session-minute; 8% orchestration fee (16% with BYOK); Pro $37/mo 20,000 credits — [Gumloop credits](https://docs.gumloop.com/core-concepts/credits.md).
- **Make** — "You can set clear rules, add manual approvals, or stop the Agent at specific points"; "See every decision an agent makes, step by step, in the Reasoning panel"; agents on all plans — [Make AI Agents](https://www.make.com/en/ai-agents).
- **n8n** — Human-fallback template: a "Not sure?" tool calls a sub-workflow that "Message[s] Slack for help" and returns a canned confirmation; it does not pause for the human's answer — [n8n docs](https://docs.n8n.io/advanced-ai/examples/human-fallback/). Cloud Starter $24/2,500 executions, Pro $60, Business $800 (S) — [Gumloop blog, vendor-affiliated](https://www.gumloop.com/blog/n8n-alternatives).
- **Claude Managed Agents** — Concepts: Agent (model, system prompt, tools, MCP, skills), Environment, Session, Events; SSE stream; "Steer or interrupt" mid-run — [Overview](https://platform.claude.com/docs/en/managed-agents/overview). Permission policies: `always_allow`, `always_ask` ("session pauses and waits for your approval"), `auto` ("server evaluates each call and runs it, denies it, or pauses"); agent toolset defaults to `always_allow`, MCP toolsets default to `always_ask` — [Permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies). Session budget: `max_list_cost` in cents as a string; session pauses with `stop_reason: budget_reached`, accepts only settle events (`user.tool_confirmation`, `user.tool_result`, `user.interrupt`); list cost prices tokens, $10/1k web searches, $0.08/hour runtime; "A pending ask outranks the cap" — [Budgets](https://platform.claude.com/docs/en/managed-agents/budgets). Scheduled deployments: cron + IANA timezone, jitter up to 15%, 1,000 per org, per-run budget, deployment-run records with `error.type`, pause/unpause/archive, manual `run` — [Scheduled deployments](https://platform.claude.com/docs/en/managed-agents/scheduled-deployments); scheduled deployments and vaults went public beta 2026-06-09 — [Claude blog](https://claude.com/blog/whats-new-in-claude-managed-agents). Multiagent (`multiagent_20261001`): subagents (one level deep, max 25 child threads, 20 predefined agents), dynamic workflows (agent writes a program that runs agents in phases), advisor model; "set a session budget to cap the session's spend, runs included" — [Multiagent orchestration](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration). Dreams (research preview, `dreaming-2026-04-21`): reads a memory store + 1–100 session transcripts, outputs a new store with "duplicates merged, stale or contradicted entries replaced" — [Dreams](https://platform.claude.com/docs/en/managed-agents/dreams). Initial events include `user.define_outcome` — [Scheduled deployments](https://platform.claude.com/docs/en/managed-agents/scheduled-deployments) (outcomes doc page returned 404; U).
- **Claude Cowork** — "Give it a goal, and it works across your files and tools"; "Schedule a report once and get it daily, weekly, or monthly"; "Deleting anything needs your approval"; optional setting to present a plan and wait before significant actions; plugins bundle "skills, connectors, and sub-agents"; admins get RBAC and spend limits; "consumes limits faster than Chat"; Pro ~$17/$20, Max $100/$200, Team $20/seat — [Cowork](https://claude.com/product/cowork).
- **ChatGPT agent / AgentKit** — Agent mode on Plus/Pro/Business/Enterprise/Edu; 2025 task allowances 40/month (Plus) and 400 (Pro), dated; pauses "when user approval or credentials are required" — [chalktalkai](https://chalktalkai.substack.com/p/chatgpt-agent-openais-new-virtual), [g-talent](https://www.g-talent.net/blogs/chatgpt/precio-agentes-chatgpt-plan-2026). AgentKit tools "not charged separately"; Agent Builder and Evals "no longer available ... from November 30, 2026", pointing to Agents SDK and "Workspace Agents in ChatGPT" — [eesel](https://www.eesel.ai/blog/openai-agents-api-pricing) (openai.com returned 403; U).
- **Agentforce** — Flex Credits $500/100k, 20 credits per action, 30 per voice action, $2/conversation, $5/user license, $125 add-ons, $150 Industries, Max Edition from $550/user with 2.75M credits/yr; Agent Builder, Prompt Builder, Agent Script free in Foundations — [Agentforce pricing](https://www.salesforce.com/agentforce/pricing/). Conversation bills only with ≥2 turns, no explicit negative feedback, no escalation (S) — [getmacha](https://www.getmacha.com/blog/agentforce-pricing-explained).
- **Copilot Studio** — 25,000 Copilot Credits "$200.00/pack/month" or pay-as-you-go; Azure subscription required; agents "plan, learn, and escalate work items"; "approval gates" only for release deployments — [Copilot Studio](https://www.microsoft.com/en-us/microsoft-365-copilot/microsoft-copilot-studio). M365 Copilot Business $18/user/mo promo (Jul 1–Dec 31 2026, else $21) — [M365 pricing](https://www.microsoft.com/en-us/microsoft-365-copilot/pricing). Agent 365 GA 2026-05-01 per-agent license (S) — [Rencore](https://rencore.com/en/blog/understanding-microsoft-agent-365-pricing).
- **Google** — Agentspace renamed Gemini Enterprise 2025-10-09; Gemini Enterprise Agent Platform (Agent Studio, Agent Gateway) announced April 2026; universal Gemini work agent private preview 2026-10-08 (all S) — [Atlan](https://atlan.com/know/ai-agent/ai-agent-applications/google-agentspace/), [Forrester](https://www.forrester.com/blogs/google-cloud-next-2026-the-end-of-the-ai-pilot-era/), [letsdatascience](https://letsdatascience.com/news/google-launches-unified-gemini-enterprise-agent-3927f884). Pricing page 404 (U).
- **Motion** — Pricing page lists Pro AI $19/seat (7,500 credits) and Business AI $29/seat (15,000 credits) with "This plan is not available" on both; "AI Workflow Builder: Automatically builds workflows based on SOPs"; no approval controls described — [Motion pricing](https://www.usemotion.com/pricing), [Motion](https://www.usemotion.com/ai-employees) (404). Capterra lists AI Employees Light $99/3 seats, Plus $599/25 seats; G2 4.1/5 on 157 — [Capterra](https://www.capterra.ie/software/214264/motion), [G2](https://www.g2.com/products/motionapp). "Clide" returned no results (U).
- **Beam AI** — Free 20 tasks/mo; Pro $50/mo 200 tasks; Scale $3,990/mo; "Output evaluation" and "Self Healing Outputs"; no approvals described — [Beam pricing](https://beam.ai/pricing).
- **Ema** — "universal AI employee"; $77M Series B, ~$140M total; EmaFusion over 30 LLMs (S) — [Inc42](https://inc42.com/buzz/ema-raises-77-mn-to-scale-its-universal-ai-employee-platform-globally/), [Inc](https://www.inc.com/kit-eaton/ai-startup-ema-wants-to-create-a-universal-employee.html).
- **Ohai** — "Your Household Manager"; complicated items "reviewed by human assistants"; Premium from $9.99/mo — [Ohai](https://www.ohai.ai/). Not a business product; relevant only as a "human-in-the-loop as a service" pattern.
- **AI co-founder tools** — ValidatorAI: free score, "288,741 founders' ideas", next-step prompt to build a landing page — [ValidatorAI](https://validatorai.com/). IdeaBuddy: Free 1 idea, 10 AI requests; Dreamer/Founder tiers; validation score; 15-day trial — [IdeaBuddy](https://ideabuddy.com/pricing/). FounderPal: lifetime deal page, no numbers retrieved — [FounderPal](https://founderpal.ai/pricing). Mixo: app pricing page empty on fetch (U). All are advice/plan generators, none execute.

**D. Pricing and credits (summary)**

| Product | Entry | Mid | Top | Unit rule | Rollover |
| --- | --- | --- | --- | --- | --- |
| Lindy | Plus (S: $29.99) | Pro (S: $99.99) | Max (S: $199.99) | $0.01/credit; top-ups don't expire | plan credits no — [P](https://docs.lindy.ai/pricing), [S](https://www.jetadmin.io/blog/lindy-pricing/) |
| Relevance | Pro $19 (annual)/$29 — 2,500 Actions/mo + $20 VC | Team $234/$349 — 7,000 + $70 | Enterprise | Action = agent runs a tool; $80/1k top-up | VC roll over; plan Actions reset — [P](https://relevanceai.com/docs/get-started/pricing) |
| Dust | Free 500 lifetime | Pro €24/€30 seat, 8,000 | Max €120/€150, 40,000 | credits vary by model/tools | no — [P](https://dust.tt/pricing) |
| Manus | Free | Pro $20, 4,000 | $200, 40,000 (S) | per-task credits | no — [S](https://preuve.ai/blog/manus-ai-review) |
| Genspark | Free ~100/day | Plus $24.99, 10k | Pro $249.99, 125k | slide deck 100+, 3-min call ~180 | — [S](https://dailyaifixs.com/blog/genspark-pricing-2026-the-credit-burn-catch) |
| Gumloop | Trial 14d | Pro $37, 20,000 | Enterprise | $0.005/credit; 8% fee | no (Pro) — [P](https://docs.gumloop.com/core-concepts/credits.md) |
| Zapier Agents | Free 400 activities | Pro 1,500 ~ $33.33 | Enterprise | activities | — [P](https://zapier.com/pricing) |
| Claude Cowork | Pro $17/$20 | Max $100/$200 | Team $20/seat | usage limits | — [P](https://claude.com/product/cowork) |
| Managed Agents | tokens | +$10/1k search | +$0.08/h | hard session budget in cents | — [P](https://platform.claude.com/docs/en/managed-agents/budgets) |
| Agentforce | $5/user + credits | $125/user | $550/user | 20 credits/action | no — [P](https://www.salesforce.com/agentforce/pricing/) |
| Copilot Studio | PAYG | $200/25k credits | — | credits | — [P](https://www.microsoft.com/en-us/microsoft-365-copilot/microsoft-copilot-studio) |
| Beam | Free 20 tasks | Pro $50/200 | Scale $3,990 | tasks | — [P](https://beam.ai/pricing) |

**E. User evidence (what works, what fails)**
- Lindy (Trustpilot via aggregator): "trivial tasks can burn up credits quick", "not worth the price, or the headache", an unauthorized $350 charge; CostBench (Reddit/HN mentions): "credits deplete faster than expected", "unable to cancel subscription or delete account"; praise: solo operators with recurring automations — [CostBench](https://www.costbench.com/software/ai-automation/lindy/), [Tools for Humans](https://www.toolsforhumans.ai/ai-tools/lindy-ai), [UCStrategies](https://ucstrategies.com/news/lindy-ai-review-2026-pricing-features-and-real-productivity-gains/).
- Manus: Trustpilot 1.2/5 on 209 reviews (94% one-star, billing/refunds/bot support) vs App Store 4.7 on 39K; one website prompt used 6,000+ credits; r/ManusAiAgent thread "4 Days No Support From a Human – Over 3k Credits Burned For No Work Done"; a reviewer lost ~476,000 credits (~$2,380) to the monthly reset — [preuve.ai](https://preuve.ai/blog/manus-ai-review), [gummysearch r/ManusAiAgent](https://gummysearch.com/r/ManusAiAgent/), [Trustpilot NL](https://nl.trustpilot.com/review/manus.im?page=2). Meta's acquisition of Manus was prohibited by China's NDRC on 2026-04-27 (S) — [eesel](https://eesel.ai/blog/manus-ai-pricing).
- Genspark: Trustpilot 1.7 (S), billing disputes — [eesel](https://www.eesel.ai/blog/genspark-ai-review).
- Relevance AI: G2 ~4.2; "learning curve, cost" (playbook doc [C13](https://www.g2.com/products/relevance-ai/reviews)); free plan retired for new and existing accounts — [Relevance pricing](https://relevanceai.com/docs/get-started/pricing).
- Solopreneur sentiment (S): Reddit discussions report "generic outputs, juggling multiple tools, or maintaining personal brand voice" — [Fast Company SA](https://fastcompany.co.za/business/2026-02-10-how-ai-tools-are-revolutionising-solopreneurship/); the circulating model is AI as "a very fast, very confident intern who needs supervision" — [Towards AI](https://pub.towardsai.net/how-ai-changes-solopreneurship-b4fa7c6cccd9).
- YouTube (vidIQ, 1 search before credits ran out): Dan Martell "The most powerful AI Agent I've ever used" (838k views, 2026-02-26) sells an "AI Company Operating System" lead magnet and lists ChatGPT/Claude/Gemini/Zapier/Make/Manus/OpenClaw — [YouTube](https://www.youtube.com/watch?v=D_YzcH0VsGY); "Claude vs OpenClaw" short (114k views) — [YouTube](https://www.youtube.com/watch?v=SYKiVV-oLVw). Signal: the "AI company OS" phrase is already a creator-economy hook.
- Open source: `openclaw/openclaw` 392k stars (personal "AI that really does things"), `FoundationAgents/MetaGPT` 70.9k ("First AI Software Company"), `anthropics/skills` 181k, `obra/superpowers` 300k, `ultraworkers/claw-code` 195k ("developed and maintained with no human intervention") — [GitHub search](https://github.com/search?q=AI+employee+agents). Agents of Chaos ran on OpenClaw — [arXiv 2602.20021](https://arxiv.org/abs/2602.20021).

**F. Goal-to-work matrix (how a goal becomes work, stage by stage; sources as cited in C above)**

| Stage | Polsia | Lindy | Relevance AI | Gumloop | Zapier Agents | Claude Cowork | Managed Agents | Manus | Motion | Agentforce |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Intake | Idea text / "surprise me" / existing URL | Chat; describe a process → saved as skill | "Invent" from description; Marketplace clone | Chat with Gumball; connectors | Copilot builds agent from description | Goal + chosen folders/tools | API: agent + environment + first `user.message` | Prompt | Tasks/projects; SOP → workflow | Agent Builder topics/actions |
| Team / role model | 9 fixed agents (orchestrator, social, research, planning, outreach, support, ads, code, finance) | One teammate; personal/team scopes | Agents + Workforces canvas | Agents + subagents | One agent per job template | One agent + plugins (skills, connectors, sub-agents) | Agent, subagents (≤20 predefined), advisor, workflows | Single agent + Wide Research sub-agents | Named AI assistants (Task Planner, PM, Workflow Builder) | Topics per agent |
| Planning | `tasks/plan` endpoint; nightly plan-execute | Routine prompt in plain English | Tool steps (inputs→steps→outputs) | Instructions + abilities | Instructions | Optional "present plan and wait" | System prompt; dynamic workflow program | Task plan shown | AI Project Manager generates projects | Agent Script |
| Execution | Celery loops, `claude -p` subprocesses, hosted apps | Integrations (1,000+), scripts via "Run this as a script" | LLM/API/code steps | Connector tool calls, CEL rules | 9,000+ apps | Built-in browser, connectors | Sandbox bash/files/web/MCP | Cloud sandbox/browser | In-app | Flows/actions |
| Progress view | Terminal stream, 8 panels, SSE events | Task view; routine delivery to chat/Slack/SMS | Agent runs, escalation queue | Chat, Tasks page, Slack cards | "Monitor activity" | Step-by-step trace (files opened, tools used) | SSE event stream; threads; deployment runs | Live desktop view | Dashboards | Agent analytics |
| Approvals | None (click = run) | Outside-impact actions require approval; Slack threads | Autopilot vs HITL; escalation | 5 modes per app + per tool + rules + Ask Question | Per-run cap → asks | Delete needs approval; plan-wait setting | `always_allow` / `always_ask` / `auto`; `user.tool_confirmation` | Confirm before costly jobs | None documented | Flex-credit actions; escalation |
| Memory | Shared persistent memory per company | `.memory/`, `.skills/`, versioned, scoped | RAG knowledge; stored escalation answers | Company Brain (approved sources) | Knowledge sources | Project memory via skills/plugins | Memory stores + dreams | Context per task | Docs/wiki | Data Cloud |
| Reporting | Portfolio reports; moods | Daily briefs routine | Analytics | Tasks + credit meter | Activity log | Scheduled reports | Webhooks; `session.usage` events | Deliverables | AI dashboards | Analytics |
| Learning | `task-feedback` API | Skills created from chat; personal>team>system | Escalation answers reused | "Don't ask again for this tool"; rules | Templates | Plugins/skills | Dreams rewrite memory store | — | Workflow Builder from SOPs | Prompt tuning |
| Cost control | Credits, auto top-up | Pool pauses when low; top-ups don't expire | Actions + Vendor Credits; BYOK bypass | $0.005 credits; overage cap $5,000; BYOK | Activities; per-run cap 10/40 | Usage limits | Hard session/deployment budget in cents | Credits, no rollover | Credits per seat | Flex Credits, no rollover |

Sources: see C and D above plus [Polsia teardown](../../docs/research/polsia-teardown.md) for the Polsia column.

### Inferences
- The market has settled on **per-tool permission policies with read/write defaults** (Lindy, Gumloop, Managed Agents) rather than per-task approvals; North's K0–K3 tiers are a superset, but North should also expose the industry-standard per-tool defaults so the rule engine's decisions are legible.
- **Decision budgets do not exist as a product feature anywhere**; the only budget primitives are money (Managed Agents cents, Gumloop overage cap) and per-run activity caps (Zapier). North's 3-cards/day is differentiated and should be marketed as such.
- Every credit-metered consumer product (Polsia, Manus, Genspark, Lindy) has the same top complaint: credits burned on failed or duplicated work and silent resets. Charging only for verified outcomes (Fin, Sierra) is the pattern with the least backlash.
- Lindy's memory design (visible file system, `.skills/*/SKILL.md`, personal>team>system override, versioned saves) is the closest shipping implementation of "company memory you can inspect" and is directly compatible with the Agent Skills spec.

### Gaps
- No Reddit threads reachable (search returned only aggregators). No transcripts of YouTube reviews (vidIQ credits exhausted).
- Polsia changelog, Motion "AI employees"/Clide, Mixo pricing, OpenAI Operator deprecation, Gemini Enterprise pricing, Managed Agents outcomes page: not retrievable (404/403/SPA) — marked U.
- Relevance per-tool approval modes verified only via the earlier playbook citation, not re-fetched today.

## KQ2. Ops / finance / support / research / analytics / incident layer: which workflow and which features matter for a 1-person company?

### Takeaway
The functional tools that work for a solo company share one shape: an agent that **triages, drafts and proposes, with a human confirmation only on money or irreversible changes**, billed per outcome or per seat with a cheap entry tier. The useful features for North are outcome-billing semantics (Fin), "approve when safe, escalate when not" (Ramp), agentic close with AI quality review (Digits/Puzzle), per-request research APIs (Exa/Parallel), and alert-triggered investigations that end in a proposed fix, not an auto-fix (Datadog Bits, Sentry Seer).

### Cited Findings

**Support**

| Product | Workflow | Pricing | Features that matter at 1 person |
| --- | --- | --- | --- |
| Intercom Fin | Resolves, runs Procedures, hands off | $0.99 per outcome, 50-outcome minimum; +$29/seat with Intercom; Copilot $35/user; Qualification $9.99; "You aren't charged when a conversation goes to your team without an outcome" — [Fin pricing](https://fin.ai/pricing) | Outcome taxonomy (resolution / procedure handoff / disqualification / self-serve routing) is a reusable ledger vocabulary |
| Zendesk AI | AI agent add-on on seat plans | ~$1.50 committed / ~$2 PAYG per automated resolution (S); Copilot $50/agent — [getmacha](https://www.getmacha.com/blog/intercom-fin-vs-zendesk-ai-pricing), [costbench](https://costbench.com/compare/zendesk-ai-vs-intercom-fin/) | Too heavy for solo; shows per-resolution pricing doubling cost as resolution rate rises 30%→70% |
| Decagon | Build (AOPs in natural language) → Optimize (Simulations at scale, Watchtower "Always on QA", Experiments) → Scale — [Decagon](https://decagon.ai/) | undisclosed; median contract ~$432k (S) — [getmacha](https://www.getmacha.com/blog/decagon-vs-sierra-ai) | AOP = natural-language SOP + simulation before go-live is the right playbook test pattern |
| Sierra | Ghostwriter builds agent from description incl. "guardrails, tone, and style"; Explorer analytics; "built-in testing, automated monitoring" — [Sierra](https://sierra.ai/product) | outcome-based: "pay only when the software achieves specific, valuable outcomes"; "only works where the software is highly autonomous and highly attributable" — [Outcomemaxxing](https://sierra.ai/blog/outcomemaxxing) | Quality bar: outcome pricing is only credible when attribution is verifiable; same logic as North's Evidence |
| Plain | Email-first helpdesk with Ari agent | Foundation $35/mo 1 seat incl. Ari + 2,000 Sidekick credits; Sidekick $0.10 + 1.2x model cost (S) — [Unthread](https://unthread.io/blog/plain-pricing/), [eesel](https://www.eesel.ai/blog/plain-review) | Cheapest "agent included" support desk for a solo B2B |

**Finance / bookkeeping**

| Product | Workflow | Pricing | Features that matter |
| --- | --- | --- | --- |
| Ramp | "Approves when it's safe. Escalates when it's not."; FAQ: "no money ever moves without a human confirmation"; auto-coding to ERP, fraud scan, 3-way match, hotel rebooking when price drops ≥$50; claims 90% auto-coded (Glossier), 85,000 businesses — [Ramp Intelligence](https://ramp.com/intelligence) | card platform; Plus tier for full enforcement (S) — [rework](https://resources.rework.com/tools/ai-agents/best-ai-agents-for-finance-2026) | The exact K1/K2 split North wants for money: auto when policy-safe, confirm when funds move |
| Brex | "AI-powered expense assistant", "Use AI to automate approvals and expense reports", AI bill pay — [Brex](https://www.brex.com/) | card platform | Less specific than Ramp on agents |
| Puzzle | "AI does the categorizing, reconciling, and drafting. You review and approve."; Starter $30 (25 lifetime AI credits), Core $72, Complete $120 (100 credits/mo, AI accuracy review, AI reconciliations), Scale $360; Expert Reviewed $171 (≤$10K/mo expenses); close guarantee "50% or more" faster — [Puzzle pricing](https://puzzle.io/pricing) | AI-does/human-approves ledger with explicit eligibility rules |
| Digits | "Agentic Close" (Collect, Book, Reconcile, Schedule, Review, Report); "AI Quality Review"; Ask Digits; Essentials $65 "Solopreneurs", Core $100, Pro $250 (coming); 30-day trial; "does not file your taxes" — [Digits pricing](https://digits.com/pricing) | Six-step close with built-in review is a template for North's Ops/Finance agent |
| Fondo | "Software handles the busywork. Accountants handle judgment, review, and edge cases."; Monthly $399 (promo; $499), Quarterly from $1,198, Annual from $950; TaxPass from $1,450; Delaware C-Corps pre-seed to Series B — [Fondo pricing](https://fondo.com/pricing) | Human-backed tier for when North's finance agent must escalate K3 |
| Pilot | Claims "#1 rated accounting service on G2"; no 2026 shutdown found — [Pilot](https://pilot.com/pilot-vs-bench) | — | Reference for human-in-loop bookkeeping |
| Bench | Shut down 2024-12-27 with 12,000+ customers; AI tools "weren't live in time to support the pared-down bookkeeping team" — [TechCrunch](https://techcrunch.com/2025/01/03/inside-the-wild-fall-and-last-minute-revival-of-bench-the-vc-backed-accounting-startup-that-imploded-over-the-holidays), [Accounting Today](https://accountingtoday.com/articles/how-a-once-hot-accounting-fintechs-bet-on-ai-led-to-bankruptcy) | — | Cautionary: cutting humans before the AI is proven |

**Research / data**

| Product | Workflow | Pricing | Features that matter |
| --- | --- | --- | --- |
| Exa | Search / Deep Search / Contents / Answer / Monitors / Agent | instant $4/1k, fast/auto $7, deep $12, deep-reasoning $15, contents $1/1k pages, monitors $15/1k, Agent $0.012–$1.00 per request; free $10 credits resetting monthly — [Exa pricing](https://exa.ai/pricing) | Monitors + Deep Search are a drop-in for a Research agent; per-request cost is ledger-able |
| Parallel | Search / Task / Responses / Extract / Monitor / Find All | Search Turbo/Fast $1/1k, Basic/Advanced $5/1k; Task Lite $5 … Ultra8x $2,400 per 1k; Responses High $250/1k; free 5,000 req/mo — [Parallel pricing](https://parallel.ai/pricing) | Processor tiers with latency bands make cost-per-task predictable before running |
| Perplexity | Deep Research in app; Sonar API | Pro $20 (20 Deep Research/day), Max $200 (S) — [Finout](https://www.finout.io/blog/perplexity-pricing-in-2026) | Consumer; not programmatic enough for a department agent |
| Browse AI | Train a robot per page, monitor | Free 50 credits/mo; Personal $19; Professional $69; Premium from $500; "each credit ... 10 rows ... or a screenshot"; min monitor 5 min — [Browse AI pricing](https://www.browse.ai/pricing) | Competitor/price monitoring robots; "each page needs its own robot" (S) — [syncgtm](https://syncgtm.com/blog/browse-ai-review) |
| Rows / Equals | Rows acquired by Superhuman 2026-02-22, wound down 2026-05-31, users to Coda (S) — [automationatlas](https://automationatlas.io/answers/rows-pricing-2026/); Equals price conflicting (S) — [neuronfeed](https://neuronfeed.com/compare/equals-vs-rows) | — | AI-spreadsheet standalone category is consolidating; don't depend on it |

**Analytics agents**

| Product | What the agent does | Autonomy | Grade |
| --- | --- | --- | --- |
| PostHog AI | Queries data, builds insights/SQL/replays, "create dashboards, surveys, alerts, and feature flags", "start a coding task against a connected repository ... report back when a pull request is ready", project memory you can edit, Slack `@PostHog` beta — [PostHog AI docs](https://posthog.com/docs/posthog-ai/overview.md) | Acts in-product; PR needs human merge | P (a third-party claim that "Max" was retired conflicts; U — [createwith](https://www.createwith.com/tool/posthog/updates/posthog-retires-max-ai-assistant-after-learning-hard-lessons-about-user-behavior)) |
| Amplitude AI Agents | Global Agent; "why did this metric change" diagnostics; experiment design/launch; Custom Agents "run on a schedule or on demand", "Always monitoring" — [Amplitude](https://amplitude.com/ai-agents) | No approval step described | P |
| Mixpanel | "Spark AI (now Mixpanel Agent)" — [Mixpanel blog](https://mixpanel.com/blog/spark-bringing-generative-ai-to-mixpanel/); packaging flip-flopped mid-2026 (S) — [pricingsaas](https://pricingsaas.com/companies/mixpanel/diffs/2026W33) | Query agent | P/S |
| Pendo | Agent Analytics ("Track success rates, top use cases, emerging issues, and outcomes"), Agent Toolkit connecting usage data "to your favorite agents, from Fin and Agentforce to Decagon and Sierra", Pendo MCP, Leo assistant — [Pendo for Agents](https://www.pendo.io/pendo-for-agents/); Agent Toolkit forum 2026-07-28 — [Pendo](https://www.pendo.io/customer-forum-july-2026) | Measures agents rather than acting | P; "Novus" unverified (U) |

**Monitoring / incident agents**

| Product | Trigger → steps | Human role | Pricing |
| --- | --- | --- | --- |
| Datadog Bits Investigation (Bits AI SRE) | "When an alert fires, Bits Investigation immediately launches an investigation"; reads runbooks and past investigations; hypotheses labeled validated/invalidated/inconclusive; "Bits Code takes over to propose a fix"; one-click triage to Slack/Jira — [Datadog blog](https://www.datadoghq.com/blog/bits-ai-sre/) | Engineer merges PR; no auto-remediation described | $25–36/investigation (S) — [Better Stack](https://betterstack.com/community/comparisons/bits-ai-vs-resolve-ai/) |
| Sentry Seer | "Automatically scan issues as they come into Sentry, finding root causes, and automating triage"; opens PR/MR; can hand off to Claude Code/Cursor/Copilot; admins can disable PR creation — [Sentry docs](https://docs.sentry.io/product/ai-in-sentry/seer/) | Billed per active contributor ("2 or more PRs/MRs in a month"); Team plan $29 — [Sentry pricing](https://sentry.io/pricing/) | $40/contributor (S) — [Better Stack](https://betterstack.com/community/comparisons/sentry-seer-alternatives/) |
| Resolve.ai | Investigation agent; no public pricing, "$1M+/year" for large deployments (S) — [Better Stack](https://betterstack.com/community/comparisons/resolve-ai-alternatives/) | — | — |

### Inferences
- For a 1-person company the winning feature set per function is small: **support** = outcome-billed resolver + procedures + handoff; **finance** = auto-code + anomaly flag + human confirmation on money movement + agentic close with quality review; **research** = metered search/monitor APIs with per-request cost; **analytics** = scheduled "why did X change" agent; **incidents** = alert-triggered investigation that ends in a proposed PR.
- The pattern "AI proposes, human approves only at the money/irreversible boundary" (Ramp, Puzzle, Bits, Seer) is exactly North's K2 boundary; North can cite these as prior art when explaining tiers to founders.
- Outcome taxonomies (Fin's four billable outcomes, Sierra's "outcome") give North a vocabulary for its outcome ledger: resolution, handoff, disqualification, routing.

### Gaps
- Brex agent names (Expense/Audit/Review) only in a vendor-adjacent guide (S); not on brex.com.
- Zendesk per-resolution price, Plain's current model (seat vs volume), Equals pricing, Resolve pricing: conflicting or undisclosed.
- No independent user evidence found for Puzzle, Digits, Fondo, Exa, Parallel (search budget exhausted).

## KQ3. Playbook / skill formats: who publishes one, and what does the schema look like?

### Takeaway
Three real schemas exist: the open **Agent Skills `SKILL.md`** (frontmatter `name`/`description` + optional `license`/`compatibility`/`metadata`/`allowed-tools`, progressive disclosure), Anthropic's **agent.md / deployment.md** frontmatter for Managed Agents, and Relevance's **inputs → steps → outputs** tool. Lindy stores its playbooks as `.skills/<name>/SKILL.md`, so the SKILL.md format is already the de-facto interchange format; North should store department playbooks as SKILL.md plus a North-specific `metadata` block.

### Cited Findings

| Vendor | Format | Required fields | Optional / notable | Tools and approvals inside the format | Source |
| --- | --- | --- | --- | --- | --- |
| Agent Skills (Anthropic, open) | Directory with `SKILL.md`; `scripts/`, `references/`, `assets/` | `name` (≤64, lowercase, hyphens, must match dir), `description` (≤1024, "what the skill does and when to use it") | `license`, `compatibility` (≤500), `metadata` (string map), `allowed-tools` (space-separated, experimental); body free Markdown; "Keep your main SKILL.md under 500 lines"; loading: metadata ~100 tokens at startup, body <5,000 tokens on activation, resources on demand; validator `skills-ref validate` | `allowed-tools: Bash(git:*) Bash(jq:*) Read` | [agentskills.io spec](https://agentskills.io/specification), [Anthropic engineering](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) |
| Lindy Skills | Same SKILL.md in `.skills/`; name + description + instructions; Personal > Team > System override; "The description matters: it's how Lindy decides when the skill applies" | name, description, instructions | Created from chat or Skills page; on/off toggle; versions on save | none in format; approvals are platform-level (outside-impact actions) | [Lindy Skills](https://docs.lindy.ai/teammate/skills), [Lindy Memory](https://docs.lindy.ai/teammate/memory) |
| Claude Managed Agents | `agent.md` frontmatter: `name`, `model`, `tools` (toolset + `configs` with `enabled`, `permission_policy`), `mcp_servers`, `multiagent` (`subagents.predefined_agents`, `workflows`, `advisor`); `deployment.md`: `agent`, `environment_id`, `schedule {type: cron, expression, timezone}`, `budget {max_list_cost}`, body = first `user.message`; `ant apply` | name, model | custom tools with JSON `input_schema`; custom tool names cannot start with `mcp__`/`ant__` | `permission_policy: always_allow / always_ask / auto` per tool; MCP default `always_ask` | [Tools](https://platform.claude.com/docs/en/managed-agents/tools), [Permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies), [Scheduled deployments](https://platform.claude.com/docs/en/managed-agents/scheduled-deployments) |
| Relevance AI Tools | "inputs → steps → outputs"; steps = LLM prompt, API call, integration, code (Python optional); "Build a tool once and give it to any agent"; publish to Marketplace | inputs, steps, outputs | run as standalone form or in bulk over a knowledge table | approval mode set on agent↔tool link (C12) | [Relevance Tools](https://relevanceai.com/docs/get-started/core-concepts/tools) |
| Zapier Agents | Instructions + knowledge sources + tools from 9,000+ apps; templates (Meeting Prep, Lead Qualification, Zendesk Ticket, Expense Classifier) | instructions | per-run activity cap | agent "asks before continuing" at cap | [Zapier Agents](https://zapier.com/agents), [pricing](https://zapier.com/pricing) |
| Gumloop | Agent = instructions + Connectors + Abilities; App Rules as CEL over tool-call arguments | — | "Ask Question" ability | 5 approval modes + per-tool + rules | [Gumloop HITL](https://docs.gumloop.com/core-concepts/human_in_the_loop.md) |
| Make | model + instructions + inputs; "Library of Agents" | — | Reasoning panel | manual approvals / stop points | [Make](https://www.make.com/en/ai-agents) |
| Decagon AOPs | "define agent workflows in natural language" | — | Simulations, Watchtower QA | handoff | [Decagon](https://decagon.ai/) |
| Sierra Ghostwriter | Plain-language description → "Prompt workflows, systems integrations, guardrails, tone, and style" | — | testing, monitoring | — | [Sierra](https://sierra.ai/product) |
| OpenAI GPT Actions | RESTful API calls defined for a Custom GPT; "specify the authentication mechanism of an action" | schema | OpenAPI and `x-openai-isConsequential` not shown on fetched intro page (U) | — | [OpenAI Actions intro](https://developers.openai.com/api/docs/actions/introduction) |
| Open-source skill libraries | `anthropics/skills` 181k stars, `obra/superpowers` 300k, `mattpocock/skills` 294k, `affaan-m/ECC` 281k | SKILL.md | — | — | [GitHub](https://github.com/anthropics/skills) |

### Inferences
- A North department playbook can be a valid Agent Skill with `metadata` keys such as `north.department`, `north.default_tier` (K0–K3), `north.evidence` (what proves done), `north.budget_cents`, and an `allowed-tools` line that maps to AuthorityEngine tool allowlists. This keeps playbooks portable to Lindy, Claude Code, Cowork and any of the 27+ runtimes the spec claims.
- Relevance's inputs→steps→outputs and Decagon's AOP show the body of a playbook should be a numbered procedure with explicit inputs/outputs, not prose.
- Managed Agents' `deployment.md` (cron + budget + first message) is a ready shape for North's recurring routines (morning brief, weekly close).

### Gaps
- OpenAI consequential-action flag and schema details not retrieved (intro page lacks them).
- Lindy's built-in skill library contents and Zapier template schema (JSON) not exposed publicly.

## KQ4. What analysts and practitioners say about the "AI-run company" in 2026: what shipped, what failed, unit economics

### Takeaway
Investors (Sequoia, a16z, YC) frame 2026 as agents "selling work" and founders "managing a team of agents"; practitioners (Every, Anthropic's harness team, Two Sigma/Bloomberg) say the gating factors are planning, verification, budgets and approval design, not model capability. Hard evidence of a profitable AI-run company is thin: Polsia's own numbers (10% ever earned $1, ~50% monthly churn) are the only public unit economics, and the Agents of Chaos study plus Gartner/McKinsey surveys document the failure modes.

### Cited Findings
- **Sequoia, "2026: This is AGI" (Grady & Huang, 2026-01-14):** "Long-horizon agents are functionally AGI, and 2026 will be their year"; "The AI applications of 2026 and 2027 will be doers. They will feel like colleagues"; users move "from working as an IC to managing a team of agents"; "Remember all that talk of selling work? Now it's possible"; agents work reliably for ~30 minutes today; "agents still fail" — [Sequoia](https://www.sequoiacap.com/article/2026-this-is-agi/). No unit economics, no one-person-company claim.
- **a16z (S):** Marc Andrusko reframes the market as labor spend ($13T US) vs software ($300–400B), ~30x; agents as "S-grade employees" that "identify problems, diagnose root causes, implement solutions, and only then seek approval" — [clobe.ai summary](https://clobe.ai/blog/a16z-2026-ai-agent-labor-market); a16z Speedrun RFS has "agents, networks and the 100x solo founder" — [VC Cafe](https://www.vccafe.com/requests-for-startups-summer-2026-edition/). a16z's own page returned 404 (U).
- **YC RFS (Fall 2026, primary):** "Multiplayer AI" ("AI agents are the most powerful new tool a team has, but it's the one thing people still use by themselves"); "A Cloud for Small Software"; "New Operating Systems for the Physical World" (dispatch, track and bill work by "AI agents, robots, and humans"); "AI-Native Compliance Infrastructure" — [YC RFS](https://www.ycombinator.com/rfs). Fall 2025 RFS had "The First 10-person, $100B Company" (S) — [Superframeworks](https://superframeworks.com/articles/yc-rfs-startup-ideas-indie-hackers-2026). Median YC company size in 2026 batches: two people (S) — [Pinggy](https://pinggy.io/amp/blog/what_yc_is_funding_in_2026/).
- **Every (practitioner):** Compound engineering = Plan → Work → Assess → Compound; "80 percent" planning and review, "20 percent" work and compounding; a review plugin runs 12 subagents; "the developer can decide what needs to be fixed and what can be ignored"; "Good planning is not pure delegation"; five products each "built and run mainly by one person" — [Every](https://every.to/chain-of-thought/compound-engineering-how-every-codes-with-agents). Every: 15 people, daily newsletter, multiple products, $1M/yr consulting, engineers "write virtually zero code" (Lenny, 2025-07-17) — [Lenny's](https://www.lennysnewsletter.com/p/inside-every-dan-shipper); "writing side remains primarily human" (S) — [Dealroom/Platformer](https://app.dealroom.co/news/note/every-s-dan-shipper-on-writing-coding-agents-and-the-flywheel).
- **Latent Space (2026-10-12, Anthropic harness team):** decompose into "discrete, verifiable units of work" with scan→review phases; sizing by "evals and lower defaults"; set a session budget because "the model does not know its budget while running" and telling it could make it "a little bit anxious"; flows cost "much more" but are "much more effective at finding all of the details"; dreaming to "crystallize and basically improve the memory store" — [Latent Space](https://www.latent.space/p/claude-dynamic-workflows).
- **Latent Space (2026-10-14, OpenAI/Anthropic/Two Sigma/Bloomberg):** Two Sigma warns of "approval fatigue" and uses classifiers to "escalate only the most important ones to people", deterministic rules for clear cases; Anthropic's trade-break agent "just propose[s] new amendments ... not actually make those amendments"; Bloomberg lists scoped credentials, tool-call controls, outbound limits, audit trails, budgets and kill switches, "We want deterministic controls outside the model"; "Why do cars have brakes? ... so that you can go fast and stop safely" — [Latent Space](https://www.latent.space/p/crossing-the-threshold).
- **Agents of Chaos (arXiv 2602.20021, 38 authors, 2026-02-23):** two-week live red-team of OpenClaw agents with email, Discord, memory, shell; eleven case studies incl. "Unauthorized compliance with non-owners", "Disclosure of sensitive information", "Execution of destructive system-level actions", "Uncontrolled resource consumption", "Identity spoofing", "Reporting task completion when system state contradicts the report" — [arXiv](https://arxiv.org/abs/2602.20021). Recommendations: agents as "untrusted insiders" with narrower permissions than a human, human confirmation for irreversible actions "through system design, not just policy", verify with "independent, system-level telemetry rather than ... agent-generated logs", rate limits and termination criteria for multi-agent — [Futurist summary](https://futurist.com/2026/05/01/the-ceos-guide-to-ai-beware-the-agents-of-chaos/).
- **Surveys (S):** Gartner: >40% of agentic AI projects cancelled by end-2027 — [OODA Loop](https://oodaloop.com/briefs/technology/many-autonomous-agents-doomed-by-governance-failures/); McKinsey: ~two-thirds experimented with agents, <10% scaled — [Fast Company SA](https://fastcompany.co.za/business/2026-02-10-how-ai-tools-are-revolutionising-solopreneurship/); VB Pulse: half of enterprises shipped an agent that passed evals and still caused a customer-facing failure — [startup-kit summary](https://startup-kit-arabic.lovable.app/news/enterprise-ai-is-entering-an-evaluation-gap-agents-are-gaini-d5ocdi).
- **Unit economics datapoints:** Polsia: ~10% of companies earned ≥$1, ~50% churn month one and two, ~$10M run rate (May 2026) — [Crevio](https://crevio.co/blog/is-polsia-legit); Sierra: outcome pricing "only works where the software is highly autonomous and highly attributable", "If you don't deliver, attrition and margin take a hit" — [Sierra](https://sierra.ai/blog/outcomemaxxing); agentmarketcap claims tools >$250/mo reach 70% GRR / 85% NRR and flags "outcome churn" (low confidence, S) — [agentmarketcap](https://agentmarketcap.ai/blog/2026/04/09/agent-first-startup-playbook-2026); "one-person unicorn" rhetoric from Sequoia's Buhler (2025), Amodei ("2026"), UAE minister (2026-10-06) — [tmcnet](https://blog.tmcnet.com/blog/rich-tehrani/ai/sequoia-capital-and-the-trillion-dollar-ai-agent-opportunity.html), [Benzinga](https://drupal-cloudfront.benzinga.com/tech/25/05/45602384/jeff-bezos-backed-anthropics-ceo-says-the-first-billion-dollar-company-staffed-by-one-person-will-appear-nex), [Khaleej Times](https://www.khaleejtimes.com/tech/ai-everything-abu-dhabi-ai-agents-create-one-person-billion-dollar-companies). A "journalist hired only AI agents" counter-piece argues the one-person timeline "does not line up with the evidence" (S) — [SoftwareSeni](https://www.softwareseni.com/the-one-person-unicorn-versus-reality-what-actually-happened-when-a-journalist-hired-only-ai-agents/).

### Inferences
- Practitioner consensus maps one-to-one onto North's non-negotiables: deterministic gate outside the model (AuthorityEngine), evidence from system telemetry not agent self-report (Evidence), hard budgets (ledger caps), kill switch, narrow default permissions (K-tiers), classifier-plus-rules escalation (rule engine assigns tiers).
- The category's economics are unproven: the one public operator (Polsia) shows a 90% zero-revenue rate and 50% churn. North's defensible claim is not "runs your company" but "never wastes your money or your reputation" — fewer, verified outcomes.
- Every's 80/20 (planning+review vs execution) argues the founder's scarce attention should go to plan approval and outcome review, i.e. exactly what a daily decision card should contain.

### Gaps
- No primary a16z 2026 essay text retrieved; no Lenny's 2026 piece on agent approvals found; Latent Space has no "AI-run company" essay as such.
- No audited revenue/margin data for any AI-employee platform beyond founder statements.

## Ranked: features North should adopt (with why and source)

1. **Three-mode per-tool permission policy with read/write defaults** (`always_allow` / `always_ask` / `auto`; MCP and new tools default to ask) layered under K0–K3 so every gate decision is explainable — Managed Agents, Lindy, Gumloop ([permission policies](https://platform.claude.com/docs/en/managed-agents/permission-policies), [Lindy pricing](https://docs.lindy.ai/pricing), [Gumloop HITL](https://docs.gumloop.com/core-concepts/human_in_the_loop.md)).
2. **Hard dollar budget per task/session and per recurring routine**, enforced between model calls, pausing with a `budget_reached` state that still accepts approvals — Managed Agents ([budgets](https://platform.claude.com/docs/en/managed-agents/budgets)); fixes the #1 complaint across Polsia/Manus/Lindy/Genspark.
3. **Outcome vocabulary for the ledger** (resolution / handoff / disqualification / routing) and charge-or-count only verified outcomes — Fin, Sierra ([Fin pricing](https://fin.ai/pricing), [Outcomemaxxing](https://sierra.ai/blog/outcomemaxxing)).
4. **SKILL.md as the playbook format** with North `metadata` (department, default tier, evidence spec, budget) and `allowed-tools` — Agent Skills spec; Lindy proves it works as user-editable company memory ([spec](https://agentskills.io/specification), [Lindy Memory](https://docs.lindy.ai/teammate/memory)).
5. **Argument-level rules on top of tiers** (Gumloop App Rules in CEL: e.g., external recipient ⇒ ask) so K2 cards are triggered by content, not just tool name ([Gumloop HITL](https://docs.gumloop.com/core-concepts/human_in_the_loop.md)).
6. **Dry run for every routine** (nothing "sent, posted, or written") before enabling it — Lindy Routines ([docs](https://docs.lindy.ai/teammate/routines)); fits North's sandbox-default rule.
7. **Routine = trigger + prompt + destination + budget + first message**, cron with IANA timezone, jittered, with run records that carry `error.type` and auto-pause on unrecoverable errors — Lindy + Managed Agents deployments ([scheduled deployments](https://platform.claude.com/docs/en/managed-agents/scheduled-deployments)).
8. **"Approve when safe, escalate when not; no money moves without human confirmation"** as the Ops/Finance agent's written policy — Ramp ([Ramp Intelligence](https://ramp.com/intelligence)).
9. **Agentic close with an AI quality-review step before the human sees it** (Collect→Book→Reconcile→Schedule→Review→Report) — Digits, Puzzle ([Digits](https://digits.com/pricing), [Puzzle](https://puzzle.io/pricing)).
10. **Per-run step/activity cap where the agent stops and asks** (Zapier 10/40 activities) as a second fuse under the dollar budget ([Zapier pricing](https://zapier.com/pricing)).
11. **Investigation pattern for incidents**: alert → hypotheses labeled validated/invalidated/inconclusive → proposed fix PR, never auto-remediate — Datadog Bits, Sentry Seer ([Datadog](https://www.datadoghq.com/blog/bits-ai-sre/), [Sentry](https://docs.sentry.io/product/ai-in-sentry/seer/)).
12. **Memory consolidation job ("dreaming")**: periodically rebuild company memory from the memory store plus session transcripts into a new, reviewable store; never mutate the input — Managed Agents ([Dreams](https://platform.claude.com/docs/en/managed-agents/dreams)); matches append-only ledger ethos.
13. **Ask-Question choice cards** (options + "Other") as the card UI primitive for K2 decisions — Gumloop ([HITL](https://docs.gumloop.com/core-concepts/human_in_the_loop.md)); keeps cards answerable in seconds.
14. **Verifiable phases for multi-agent work** (scan → review → report), low default parallelism tuned by evals — Anthropic harness team ([Latent Space](https://www.latent.space/p/claude-dynamic-workflows)).
15. **Metered research APIs with pre-known cost tiers** (Parallel processors, Exa endpoints, Exa Monitors for competitor watch) wired into the ledger per request ([Parallel](https://parallel.ai/pricing), [Exa](https://exa.ai/pricing)).
16. **Simulation/QA before go-live for customer-facing playbooks** (Decagon "Simulations at scale", Sierra testing) as the acceptance test for Support/Sales playbooks ([Decagon](https://decagon.ai/)).
17. **"Multiplayer" session sharing** (YC RFS): let a co-founder or advisor watch and redirect an agent session — later milestone ([YC RFS](https://www.ycombinator.com/rfs)).

## Patterns to avoid

- **Credits that silently reset, bill failed runs, or have no price table** — Manus (476k credits lost on reset, 6,000 credits on one failed site), Lindy ("see what a step cost only after it runs"), Genspark, Polsia ([preuve](https://preuve.ai/blog/manus-ai-review), [jetadmin](https://www.jetadmin.io/blog/lindy-pricing/)). North: price shown before run, failed attempts not charged, ledger line per action.
- **"Done" by agent self-report** — Polsia tasks "reported done when they aren't"; Agents of Chaos "Reporting task completion when system state contradicts the report" ([Crevio](https://crevio.co/blog/is-polsia-legit), [arXiv](https://arxiv.org/abs/2602.20021)). North: Evidence from telemetry only.
- **Approve-everything flows** — Two Sigma's "approval fatigue"; Sintra/Marblism complaints in the playbook doc ([Latent Space](https://www.latent.space/p/crossing-the-threshold)). North: quota + batching + argument-level rules.
- **Letting the agent choose its own approval mode** (Relevance "let agent decide") — conflicts with rule-engine-assigned tiers (playbook doc C12).
- **Platform-custodied money and shared ad accounts** (Polsia 3% + 31-day hold + 20% of ad spend) — [Crevio](https://crevio.co/blog/is-polsia-legit).
- **Eight live panels / terminal theatre as the home screen** (Polsia) and "AI employee" personas with no permission model (Motion, Beam) — [Motion pricing](https://www.usemotion.com/pricing), [Beam](https://beam.ai/pricing).
- **Human fallback that only posts to Slack and cannot resume** (n8n template) — every K2 must block, persist, and resume ([n8n docs](https://docs.n8n.io/advanced-ai/examples/human-fallback/)).
- **Cutting the human tier before the AI is proven** (Bench) — keep a K3/human-accountant escalation path ([Accounting Today](https://accountingtoday.com/articles/how-a-once-hot-accounting-fintechs-bet-on-ai-led-to-bankruptcy)).
- **Builder-first products that require the founder to design workflows** (Zapier/Make/n8n/Copilot Studio/Agentforce) — North's founder answers cards, never draws canvases.
- **Unbounded multi-agent fan-out** — Agents of Chaos "uncontrolled resource consumption"; Managed Agents caps (25 threads, 20 predefined agents) and budgets are the reference ([multiagent](https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration)).

## Positioning map

Axes: **X = who designs the work** (founder builds workflows ← → platform supplies roles and playbooks); **Y = autonomy with guardrails** (chat/advice only ← → acts externally under deterministic gates).

| | Founder builds workflows | Platform supplies roles/playbooks |
| --- | --- | --- |
| **Acts externally, gated** | Managed Agents, Gumloop, Zapier Agents, Make, Copilot Studio, Agentforce, Relevance (workforce canvas) | **North** (K-tiers, 3 cards/day, evidence-only done, own accounts); Lindy (routines + outside-impact approval); Cowork (delete needs approval); Ramp/Fin/Digits within one function |
| **Acts externally, weak gates** | n8n agent nodes | Polsia, Manus, Genspark, Beam, Motion "AI employees" |
| **Advice / plans only** | Dust (company chat) | ValidatorAI, IdeaBuddy, FounderPal, Mixo; ChatGPT agent (per-task) |

Where North sits: the only entry in the top-right cell that combines a role model (eight departments), a
daily decision quota, outcome-billed accounting and founder-owned money/accounts. Nearest neighbours are
Lindy (closest permission and memory design, but a general assistant with no company model) and Claude
Managed Agents/Cowork (the harness North should run on, not compete with). Polsia owns the "runs your
company while you sleep" slogan and its reputation risk; North's claim is "runs your company without
spending your money or your name without you".

## Mapping onto North's spec and milestones (for the report writer)

| Adopt-list item | North area (SPEC IDs where known) | Where it lands | Prior art to cite in the ADR |
| --- | --- | --- | --- |
| 1 per-tool policy under K-tiers | AuthorityEngine.gate(), rule engine assigns tiers | `packages/core` gate config: tool → default policy; K2 = `always_ask`, K0 = `always_allow`, K1 = allow + notify | Managed Agents permission policies; Lindy outside-impact rule; Gumloop modes |
| 2 hard budget per task/routine | Ledger, cost per task (AGT-3 two attempts then escalate) | `ledger_entries` budget line + `budget_reached` task state that still accepts card answers | Managed Agents budgets ("pending ask outranks the cap") |
| 3 outcome vocabulary | Outcome ledger, Evidence (AGT-2) | Enum: resolution / handoff / disqualification / routing / shipped / verified | Fin outcomes, Sierra attribution test |
| 4 SKILL.md playbooks | Department playbooks, company memory | `playbooks/<dept>/<skill>/SKILL.md` with `metadata.north.*`; validated with `skills-ref` | Agent Skills spec; Lindy `.skills/` |
| 5 argument-level rules | Rule engine | CEL (or Zod predicate) rules evaluated on tool arguments before tier assignment | Gumloop App Rules |
| 6 dry run | Sandbox default (non-negotiable 5) | `--dry-run` flag on every routine; first run of any playbook is dry | Lindy dry run |
| 7 routine shape | Morning brief, scheduled work | `routines` table: trigger (cron+tz), prompt, destination, budget, first message, run records with `error.type`, auto-pause | Managed Agents deployments; Lindy Routines |
| 8 money policy | Non-negotiable 6 (own accounts), Ops/Finance agent | Written policy in the finance playbook: auto-code/flag; any transfer = K2/K3 | Ramp |
| 9 agentic close | Ops/Finance agent | Weekly close routine with an AI quality-review step before the card | Digits, Puzzle |
| 10 per-run step cap | AGT-3 | Second fuse: N tool calls per run then pause with a K1 notify | Zapier |
| 11 investigation pattern | Engineering agent, incidents | Alert → hypotheses (validated/invalidated/inconclusive) → PR; never auto-deploy | Datadog Bits, Sentry Seer |
| 12 memory consolidation | Company memory, continuous learning | Nightly "dream" job writes a new memory snapshot; founder can diff/revert | Managed Agents dreams |
| 13 choice cards | Decision cards (DEC-1, quota 3/day) | Card = question + 2–4 options + "Other" + cost/impact line; one tap answers | Gumloop Ask Question |
| 14 verifiable phases | Agent runtime, multi-agent | Research/Strategy work as scan → review → report phases with low default parallelism | Anthropic harness team |
| 15 metered research APIs | Research agent, ledger | Exa/Parallel calls recorded per request with cost; Exa Monitors for competitor watch | Exa, Parallel pricing |
| 16 simulation before go-live | QA validator, Support/Sales playbooks | Playbook acceptance test = simulated conversations/outreach in sandbox | Decagon, Sierra |
| 17 multiplayer sessions | MULTI-1 / later | Share a live session with an advisor; redirect rights | YC RFS "Multiplayer AI" |

Milestone hint: items 1, 2, 3, 6, 7, 13 are prerequisites for the first morning brief and first K2 card; 4, 5, 8, 9, 10, 11 belong with the first department playbooks; 12, 14, 15, 16, 17 are post-MVP.

## Consolidated gaps and unverified items
- Reddit and YouTube transcripts not obtained (search budget; vidIQ credits). Vendor Trustpilot numbers are via aggregators.
- Unverified (U): Polsia Oct changelog; OpenAI Operator status and AgentKit wind-down date; Motion "AI employees"/Clide; Gemini Enterprise pricing; Agent 365 pricing; Managed Agents outcomes semantics; OpenAI consequential-action flag; Brex named agents; Pendo Novus; PostHog "Max" retirement claim; Mixo pricing; FounderPal prices; Equals pricing; Lindy plan prices (docs omit them).
- No decision-budget feature was found at any vendor; absence is an inference from documentation, not a vendor statement.
