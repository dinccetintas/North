# Startup playbook and founder journey: from idea to first customers

Date: 2026-10-16. Scope: the "founder starting from scratch" persona (founder decision, 2026-10-16).
Method: WebSearch and WebFetch of primary pages where they loaded (essays, vendor docs, GitHub
READMEs), secondary reviews where they did not. Reddit could not be fetched from this environment
(the crawler is blocked), so every Reddit claim below is second-hand and marked so. The GitHub API
was blocked in this session; repo facts come from the public GitHub pages on 2026-10-16.
Citations are `[ID]` keys resolved in **Sources**. Numbers labelled "North default" are proposals,
not findings.

## Summary

1. All the playbooks we checked use the same order: find a real problem, talk to users about their past
   behaviour, run the smallest test of demand, ask for money early, win the first customers by
   hand, then measure retention ([P1] [P2] [P4] [P8] [P12] [P13]). Polsia builds before validating,
   and it reports that about 10% of its companies ever made $1, with roughly 50% churn in month one ([C2]).
2. North's first 24 hours (`apps/worker/src/services/onboard.ts` `ONBOARDING_TASKS`) write a PRD, a
   business plan and an investor deck before any customer evidence exists. Reorder them to: market scan,
   2-3 ICP options, an assumption map with pre-registered thresholds, a Mom Test interview kit and a
   demand-test plan. The deck and the business plan become on-demand artifacts.
3. Talking to users is the one step North cannot delegate ([P1] [P5] [P6]). North should make it cheap
   (target list, a K2 outreach card, booking, a brief before each call, synthesis after) and count
   interview notes and Mom Test commitments ([P8]) as `Evidence`.
4. Exit criteria must be numbers written down before the test runs. Signups show intent, and
   card-backed commitments show demand. Published benchmarks disagree; only read a conversion rate
   after at least 200 targeted visitors ([P18]).
5. The proposed 11-step journey fits in 30 days at 3 or fewer K2 cards a day. It does this by
   folding each go/no-go gate into the card for the action that follows it ("interviews say X:
   launch the waitlist page?").
6. None of the competitors combines validation gates, verified evidence and an attention budget.
   Marblism users spend 10-30 min/day reviewing ([C4]). Sintra users complain about approving every
   post ([C9]). Polsia runs tasks without confirmation ([C2]). Relevance AI can let the agent decide
   when to ask ([C12]).
7. Patterns worth copying: Devin's Progress tab and plan approval ([C21]); Lovable's select-element,
   pinned comments and comments on part of a plan ([C17] [C18]); variant grids from Midjourney,
   Stitch and Atoms ([U4] [U12] [C23]); LangChain Agent Inbox's accept/edit/respond/ignore ([U1]);
   and Devin's knowledge suggestions as the model for "add to context" ([C21]).
8. The review queue needs its own budget (proposed: at most 5 items and 10 minutes a day, delivered in
   2 digests per the notification-batching study [U3]). Every item needs a safe default so work never stalls.
9. Team proposal should use constrained generation: pick personas from a vetted catalog (the role
   fixes tools and max tier) and generate only the persona brief. Re-propose the team at phase gates,
   as AgentVerse does ([T2]).
10. Skills: the best vendorable base is `phuryn/pm-skills` (MIT, about 69 skills) plus
   `anthropics/knowledge-work-plugins` (Apache-2.0). Add `wondelai/skills` (MIT) for Mom Test and
   Lean Startup. `deanpeters/Product-Manager-Skills` is CC BY-NC-SA, so North cannot use it
   commercially. The `lenny-skills` content belongs to Lenny Rachitsky, so do not vendor it ([K2]-[K5]).

## 1. Findings: what proven 0-to-1 playbooks require

- **Problem first, narrow and deep.** "Look for problems, preferably problems you have yourself."
  Build a "well": narrow and deep, not broad and shallow. Test: "Who wants this so much that they'll use
  it even when it's a crappy version one?" "Made-up" or "sitcom" ideas sound plausible but have no
  urgent users ([P2]).
- **Recruit users by hand.** "The most common unscalable thing founders have to do at the start is to
  recruit users manually." Stripe's "Collison installation" ("give me your laptop"), Airbnb going door to
  door, picking one user and consulting for them. "It's not the product that should be insanely great,
  but the experience of being your user." Launches and partnerships rarely substitute for this ([P1]).
- **Talk to users before building, keep the MVP tiny, launch fast** (Seibel, "How to Plan an MVP", YC
  Startup School recap [P4]). Migicovsky's "How to Talk to Users" lists five questions: the hardest part
  of the problem, the last time it happened, why it was hard, what was tried, and what was disliked about
  those fixes. His talk is based on The Mom Test ([P5] [P6]).
- **The Mom Test** ([P8]). Three rules: talk about their life, not your idea; ask about specific past
  behaviour, not future opinions; validate by asking for commitments. A commitment costs the customer
  time (next meeting, a trial), reputation (an intro to a decision maker, a testimonial) or money (a
  letter of intent, a pre-order, a deposit). "It's not a real sales lead until you've given them such a
  concrete chance to reject you."
- **Lean Startup / Running Lean.** An MVP is the smallest thing that completes one Build-Measure-Learn
  loop and tests one hypothesis. A "smoke test" lets customers pre-order something that does not exist yet ([P17]).
  Maurya stages the work as Problem Interview, then Solution Interview, then MVP, then quantitative
  product/market fit ([P16]). The Dropbox video MVP figures (5k to 75k on the waitlist) are repeated only
  by secondary sources ([P17]).
- **Price before building.** Buffer used two pages, then added a pricing page between them. People
  kept clicking through and a few chose paid plans; the first payment came 4 days after a launch built
  in 7 weeks; about 4% of users were paying later ([P12]). Monetizing Innovation says to hold
  willingness-to-pay conversations before design and "design the product around the price" (secondary
  summary [P15]). Van Westendorp's four questions give a range of acceptable prices, not true
  willingness to pay; pair them with a behavioural test ([P14]).
- **Waitlists and fake doors.** There is no agreed benchmark. Sources cite a minimum of about 200
  targeted visitors before a rate means anything, treat under 2% as noise, and say a "notify me"
  button in a hyped category can hit 8-15%. Card capture or pre-pay is the strong signal
  (vendor/blog sources, weak evidence [P18]).
- **First customers by trust.** Lenny's B2B sequence: personal network, then strategic cold outbound,
  investor networks, communities, content, PR (which "rarely" works), then launch. Start with the
  channels that carry the most trust. Examples: Okta reached 15-18 new IT contacts a month; Stytch
  turned 40-50% of signups into demos ([P10]). Consumer apps: seven strategies; "No one found success
  from more than three"; the most common is going directly to users ([P11]). (We found no Lenny post
  specifically on the "first 100 customers"; these two posts cover the first 10 B2B and first 1,000
  consumer users.)
- **Launch again and again.** YC's launch talk covers silent launches, friends and family, communities,
  request-access, pre-orders and feature launches; one launch is not the event ([P7]).
- **Measure.** Growth: "A good growth rate during YC is 5-7% a week". Measure revenue, or active
  users if you are not charging ([P3]). PMF: 40% "very disappointed" (Sean Ellis). Superhuman
  went from 22% to 33% by segmenting and to 58% in three quarters, splitting the roadmap half on
  "what users love" and half on what blocks the rest ([P13]).

## 2. The ordered MUST steps with exit criteria

The order comes from the sources. Thresholds are North defaults unless cited, and each one is
editable on the gate card.

| # | Step | Basis | Exit criterion (North default) | Stop / narrow rule |
| --- | --- | --- | --- | --- |
| S0 | Frame: thesis, one goal, budget, team | SPEC ONB-1/2 | Thesis v1, goal, budget, approved team in at most 10 min | — |
| S1 | Problem and ICP hypothesis | [P2] well; "who wants this so much" | 1 primary ICP picked from 2-3 options; problem stated as past behaviour | No ICP with evidence of an existing workaround: narrow |
| S2 | Riskiest assumptions and test plan | Lean [P17], Running Lean [P16] | Top 3 assumptions, each with a pre-registered metric and threshold | — |
| S3 | Problem interviews (Mom Test) | [P5] [P8] | at least 10 conversations with ICP people; at least 5 commitments (time, reputation or money) | Fewer than 3 people describe paying for or hacking a workaround: narrow or stop |
| S4 | Offer: positioning, price, MVP scope | [P4] [P12] [P14] [P15] | One-line value prop; price range from at least 20 qualified answers; scope of landing page + waitlist | Price ceiling below unit cost: stop |
| S5 | Brand basics | founder decision | Name (if open), logo and brand kit as files; domain bought (K2) | — |
| S6 | Smoke-test site live | [P12] [P17] | Live URL with value prop, pricing or a deposit option, a working waitlist and analytics; evidence = deploy ID plus a test submission | — |
| S7 | Demand test traffic, trust-first | [P10] [P11] | at least 200 targeted visitors from at most 3 channels ([P11] [P18]) | — |
| S8 | Demand readout | [P18] | Visitor-to-waitlist rate at or above threshold, plus at least 5 card-backed commitments (deposit or pre-order) | Under 2% from targeted traffic: stop or re-position |
| S9 | First customers by hand | [P1] [P10] | First paying customer, then 10 (or 3-5 paying design partners for B2B) | — |
| S10 | Retention / PMF (next phase, full app) | [P3] [P13] | 40% "very disappointed" in the core segment; 5-7% weekly growth | Below 40% after 2 iterations: re-segment |

## 3. Mapping steps to North departments, evidence, cards and review

K2 cards follow the founder decision: spend, public posts, first contact and going live. Drafts and
variants go to the **review queue**, which does not consume the 3-card quota.

| Step | Lead (support) | Artifact and Evidence | K2 cards | Review-queue items | Founder reviews |
| --- | --- | --- | --- | --- | --- |
| S0 | Chief of Staff | `Thesis`, `Goal`, `Budget`, team roster | 0 (onboarding flow) | team proposal (inside onboarding) | team, dials, budget |
| S1 | Research | `market_report`, `competitor_map`, `personas` with source links | 0 | pick 1 of 3 ICPs | ICP pick |
| S2 | Research (Strategy) | new `assumption_map`: hypothesis, metric, threshold | 0 | accept thresholds (edit inline) | the numbers that will kill the idea |
| S3 | Research (Sales, CoS) | new `interview_kit`, per-call brief, `interview_synthesis` with quotes and commitments; Evidence = calendar event + notes or email reply id | 1 `outreach_batch` (first contact) + `ConnectCard` for Gmail/Calendar if needed | script, target-list criteria | conversations (founder holds the calls) |
| S4 | Strategy | new `positioning`, `pricing_test` (Van Westendorp form), `prd` scoped to landing + waitlist | 0 | 3 headline/positioning variants; price range | value prop, price |
| S5 | Design | `brand_kit` files (SVG/PNG), naming shortlist | 1 domain purchase (money) | 3 brand directions, then a comment-driven v2 | brand |
| S6 | Engineering (Design) | `screen_designs` (2-3 directions), `build_site` with critic screenshots; Evidence = deploy ID, Lighthouse, form test | 1 go-live (merged with the S3 gate) | site direction pick; preview with pinned comments | live site |
| S7 | Growth (Sales) | `campaign_spec`, posts, network outreach | 1-2: public post / ad test (spend) / outreach batch | ad and post creatives (variants) | channels, creatives |
| S8 | Research (CoS) | new `demand_readout`: visitors, conversion, commitments vs thresholds | 1 gate merged with next action (e.g. open pre-orders on the user's Stripe) | — | go / narrow / stop |
| S9 | Sales (CoS, Strategy) | personal emails to the waitlist, concierge onboarding notes; Evidence = Stripe payment id | 1 per outreach batch | email drafts | first customers |

## 4. Competitors (2026): how they show work, review, variants, comments and chat

| Product | Work in progress | Human review | Variants | Comments | 1:1 chat / memory | Praise | Complaints |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Polsia | Live terminal + 8-panel dashboard, SSE stream ([C1]) | None: one click runs a task and spends a credit ([C2]) | None seen | `task-feedback` API ([C1]) | Company chat with proactive greeting ([C1]) | Speed: "execution speed is genuinely impressive" ([C2]) | No validation; unapproved posts and emails; false "done"; infra lock-in; Trustpilot 3.4/5 on 409 reviews (2026-10-14) ([C2]); PH 2.0, 1 review ([C3]) |
| Marblism | Each employee "checks in once a day with work for you to review" ([C4]) | Approve drafts; Eva drafts but cannot send ([C4]) | — | — | Not described on the site ([C5]) | Setup, 20-30 h/week saved ([C4]); Trustpilot 4.5-4.8 ([C6]) | Lead-gen results, lost context, 10-30 min/day of review, hours billing ([C4]) |
| Sintra | Chat per helper ([C7]) | "Set priorities, guidelines, and approval levels" ([C7]) | — | — | 12 helpers + "Brain AI" shared memory ([C7]) | Fast drafts; better with Brain filled ([C8]) | Credits run out (250/mo, failed tasks still charge); refunds; generic output ([C8]); approving every auto-scheduled post is tedious ([C9]); TrustScore withheld for review incentives ([C8]) |
| Lindy | Task view ([C10]) | "Ask for confirmation" per side-effect action; Slack Approve/Deny ([C10]) | — | — | Agent chat | Approval controls ([C11]) | Cost and unpredictable credits (affiliate blogs, [C11]) |
| Relevance AI | Agent runs, escalation queues ([C12]) | Auto run / Approval required / **Let agent decide** ([C12]) | — | — | Escalate to Slack/email ([C12]) | Easy setup, G2 about 4.2 ([C13]) | Learning curve, cost ([C13]) |
| Manus | Watch "your desktop live on your phone"; Cascade projects ([C14]) | Cost estimate + confirm before Wide Research ([C15]) | Parallel sub-agents ([C15]) | Edit the video timeline, then revise ([C14]) | Cue group chat of agents ([C14]) | Research quality ([C16]) | Loops that burn credits, "done" that isn't, refunds (secondary, [C16]) |
| Lovable | Chat + live preview; Plan mode writes a plan you approve ([C18]) | Plan approval; highlight part of the plan, then "Comment" ([C18]) | — | Pinned comments are free; sending them to the AI costs credits; select-element + prompt; draw annotation ([C17]) | Plan/Build modes in chat; version history + revert ([C18]) | G2 4.6 on 273 (secondary [C19]) | Credit drain in fix loops: "one bug reported... two new bugs" ([C19]) |
| Motion | AI Dashboards, reports ([C20]) | Clide replies "wait for approval in a click" ([C20]) | — | — | Natural-language chat; custom employee from a description ([C20]) | 8-figure ARR in 3 months (company claim, [C20]) | No independent reviews found |
| Devin | Progress tab: one log of shell, edits and browser; take over the browser ([C21]) | "Wait for my approval" on the plan; steer mid-run ([C21]) | — | Review comments auto-fix ([C21]) | Read-only side chats; knowledge suggestions you approve ([C21]) | No independent praise verified | 3/20 tasks succeeded; "time we spent trying to salvage these attempts" ([C22]) |
| Atoms (MetaGPT) | Team leader, PM, architect, engineer, analyst, growth ([C23]) | Plan, then user approval, then execution ([C23]) | "Race Mode": several teams or models on one brief ([C23]) | — | — | Deploys a full app after plan approval ([C23]) | Mostly secondary sources ([C23]) |
| Genspark | Super Agent / "AI employee" ([C24]) | — | — | — | — | Research, slides ([C24]) | Trustpilot 1.7, billing and vanishing credits (secondary, [C24]) |
| Claude Design | Canvas; refine via chat, inline comments, sliders ([C25]) | — | Tweaks on a component ([C25]) | Inline comments sometimes vanish before Claude reads them (review, [C25]) | Chat | Exports to PDF/PPTX/HTML ([C25]) | Gaps in image/Figma export ([C25]) |

**Lessons.** (a) Products that win praise show progress and keep the user in control; the complaints
cluster on cost surprises, false completion and unapproved actions. (b) Approving every item kills
the value of automation (Sintra [C9], Marblism [C4]). Review needs batching, defaults and auto-rules.
(c) Letting the agent pick its own approval mode ([C12]) breaks North's rule that the rule engine
assigns tiers. (d) Free comments plus paid revisions (Lovable [C17]) is a good cost model for North's budget.

## 5. Human-in-the-loop UX patterns and the 3-card budget

| Pattern | Exemplar | Pull or push | Quota-safe? | North use |
| --- | --- | --- | --- | --- |
| Live activity stream / step log | Devin Progress tab [C21]; Polsia terminal [C1]; Manus live view [C14] | Pull | Yes, never notifies | Task page: steps, tools, skills used, screenshots, cost |
| Plan approval before execution | Devin "Wait for my approval" [C21]; Lovable Plan mode [C18]; Atoms [C23] | Push (one item) | Review queue | Only for multi-step builds (site, campaign), not research |
| Review inbox with 4 verbs | LangChain Agent Inbox accept / edit / respond / ignore [U1] | Push, batched | Yes, if batched | Accept, Edit, Comment (new version), Skip (safe default) |
| Variant picker | Midjourney V1-V4 grid [U4]; Stitch variants (default 3) [U12]; Atoms Race Mode [C23] | Push | Yes | 2-3 variants, critic-recommended first, one tap to pick |
| Pinned / inline comments | Figma pins, long-press on mobile, resolve [U6]; Lovable select element [C17]; Canvas highlight-to-edit [U7] | Pull | Yes | Text range, DOM selector or image x/y anchor; a batch of comments makes one revision |
| Suggestion mode | Google Docs accept/reject one or all [U5] | Pull | Yes | Agent's v2 shown as a diff against v1 |
| Approval with feedback | Lindy confirm in task view, Slack Approve/Deny [C10] | Push | Only K2 | K2 card "Change and approve" = feedback + new version |
| Add to context | Devin knowledge suggestions (edit, save or discard) [C21] | Pull | Yes | Explicit tap on a chat message; agent-proposed memories enter review |
| Takeover | Devin browser [C21]; ChatGPT agent "Take over browser", confirmation before payment [U8] | Pull | Yes | Later (logins, CAPTCHAs); never for money |
| Scheduled digests | Apple Scheduled Summary [U10]; batching 3x/day improved wellbeing [U3] | Push, batched | Yes | Review digests at 2 owner-chosen times; cards keep instant push |
| Cost preview + confirm | Manus Wide Research estimate [C15] | Push | K2 only if over budget | Show estimated credits on every variant/revision request |

**Attention rules.** (1) Only K2/K3 cards interrupt. Everything else is pull or arrives in a digest. (2) Review
budget: at most 5 items and 10 minutes a day (North default), shown on the home screen as "Review · 3 ·
~4 min". (3) Each item has a default after 24 h: the critic-recommended variant advances as a *draft*.
Nothing external happens, because the external step is a K2 card. (4) Comments are free to write and
batched into one revision; at most 2 revisions per item, then the Chief of Staff escalates (mirrors
AGT-3). (5) The same pick made 3 times proposes a dial change, "switch Design to Autopilot?" (mirrors
DEC-3). (6) Microsoft's guidelines (initial, during, when wrong, over time [U2]) and NN/g's 2026 emphasis on
transparency and control [U11] both support showing "why" and "what it cost" on every item.

## 6. Proposing the team at onboarding

- **Evidence.** AutoAgents drafts a task-specific team and plan through a Planner and two observers,
  then executes ([T1]). AgentVerse uses a "recruiter" that writes expert descriptions from the goal and
  changes the group as progress is evaluated ([T2]). MetaGPT shows that role SOPs with structured
  artifacts beat free chat ([T3]). Products either ship a fixed named team (Marblism [C5], Sintra
  [C7], Motion [C20]) or build one from a description (Motion's custom employee [C20], Atoms [C23]).
- **North design.** Constrained generation. (1) The Chief of Staff reads the thesis, the answers and the
  goal, and selects departments and 1-3 personas each from a vetted catalog (`agents/personas/*.yaml`).
  A persona is a role, a skill bundle, task guides and a default dial; tools and `max_action_tier`
  come only from the role yaml. (2) It generates the persona *brief* only (segment, tone, focus) and
  one line per department on why it serves the goal, plus an estimated monthly credit cost. (3) The
  user toggles departments, swaps personas from the catalog, sets each dial (Autopilot or Review drafts;
  Design defaults to review) and renames. They cannot raise a tier. (4) At each phase gate (S2, S6, S8)
  the Chief of Staff proposes a change as a review item, e.g. "turn on Sales for first-customer outreach".
- **Example for a B2B idea.** Research: Market Analyst, Customer Discovery Lead. Strategy: Positioning
  and Pricing Strategist. Design: Brand Designer, Web Designer (review). Engineering: Landing Page
  Engineer. Growth: off until S7. Sales: Discovery Outreach (drafts only until a card). Ops: off.

## 7. Skill libraries for Research and Strategy (beyond North's current set)

Maintenance dates were not visible in the page fetches, and the API was blocked. Pin a commit SHA and
re-check the license at vendoring time.

| Library | What it holds | License | Signal (2026-10-16) | North use | Risk |
| --- | --- | --- | --- | --- | --- |
| `phuryn/pm-skills` [K2] | 9 plugins, about 69 skills: discovery (interview-script, summarize-interview, identify/prioritize-assumptions, brainstorm-experiments, opportunity-solution-tree), strategy (value-proposition, lean-canvas, pricing-strategy, monetization-strategy), market research (market-sizing, competitor-analysis, user-personas), GTM (beachhead-segment, ideal-customer-profile), execution (create-prd, pre-mortem, strategy-red-team) | MIT | 27.1k stars, 82 commits | Main base for Research and Strategy personas | Quality varies; README counts don't match (68 vs 69) |
| `anthropics/knowledge-work-plugins` [K1] | product-management: competitive-brief, metrics-review, product-brainstorming, roadmap-update, sprint-planning, stakeholder-update, synthesize-research, write-spec; small-business: 44 skills, "every skill pauses for your approval before sending, posting, paying" | Apache-2.0 | 29.8k stars, 1,117 commits | synthesize-research, competitive-brief, write-spec; the approval pattern | Written for interactive use; adapt to the gate |
| `wondelai/skills` [K5] | Book-based frameworks: mom-test, lean-startup, jobs-to-be-done, hooked-ux, plus UX and copy skills | MIT | 2.4k stars, 82 commits | Customer Discovery Lead, Experiment Designer | Summaries of copyrighted books; check each attribution |
| `alirezarezvani/claude-skills` [K6] | About 388 skills: product team (17), C-level advisory (46), research | MIT | 28.3k stars | Cherry-pick (experiment designer, UX researcher) | Size; uneven depth |
| `deanpeters/Product-Manager-Skills` [K3] | About 77 PM skills (problem-framing-canvas, prd-development, market-landscape-scan) | **CC BY-NC-SA 4.0** | v0.84, 2026-08-10 | Reference only | NonCommercial: cannot ship in a paid product |
| `RefoundAI/lenny-skills` [K4] | 76-86 skills distilled from Lenny's podcast and newsletter, incl. a "Zero to One" playbook | MIT structure; content "belongs to Lenny Rachitsky" | 1.4k stars, 4 commits | Reading list for authoring North skills | Content rights; not affiliated with Lenny |

North-authored skills to add (no good vendorable equivalent found): `evidence-citations` (every claim has
a URL, estimates labelled), `commitment-ledger` (tag each Mom Test commitment with type and proof),
`preregistered-threshold` (write metric + threshold + stop rule before a test), `demand-readout`
(compare against thresholds, recommend go/narrow/stop) and `critic-rubric-<kind>` for the
evaluator-optimizer loop ([U9]).

## 8. Recommendations for North (ranked)

1. **Re-order the first 24 hours (validation before building).** `apps/worker/src/services/onboard.ts`
   (`ONBOARDING_TASKS`), the `FIRST_DAY_PLAN` copy in
   `apps/web/src/app/(app)/c/[slug]/onboarding/steps/summary-step.tsx`, and the M1 e2e
   (`apps/web/e2e/m1-onboarding.spec.ts`). New order: `market_report`, `competitor_map`, `personas` (as
   3 ICP options), `assumption_map`, `interview_kit`. `business_plan` and `investor_deck` stay as task
   types but only run on request. This changes the M1 acceptance in SPEC; it is the founder's call.
2. **Add the validation task types and metrics.** `packages/core/src/tasks/types.ts`: task types
   `assumption_map`, `interview_kit`, `interview_synthesis`, `positioning`, `pricing_test`,
   `demand_readout`; outcome metrics `interviews_held`, `commitments`, `preorders`. Guides in
   `packages/agents/src/prompts/task-guides.ts`; Evidence rules in `packages/core/src/evidence.ts` (an
   interview counts only with a calendar event id, an uploaded note or an email reply id; never generated).
3. **Review queue separate from decision cards.** A migration with `review_items` (company_id, task_id,
   artifact_id, kind `variant_pick|draft|plan|memory_suggestion|team_change`, variants at most 3,
   recommended, default_at, status) and `artifact_comments` (artifact_id, version, anchor json, body,
   resolved_at), both behind RLS. Core module `packages/core/src/review/` holds the budget and
   defaults. Route `/c/[slug]/review`; the home screen gets a "Review · n · ~m min" line under
   `DecisionsSection` (`apps/web/src/app/(app)/c/[slug]/page.tsx`). It never writes `decision_cards`,
   so quota logic is untouched.
4. **Per-department dial.** Add `agents.review_mode` (`autopilot|review_drafts`), seeded by
   `seedAgents`, editable on `/c/[slug]/team`. Design defaults to `review_drafts`.
5. **Journey stage strip on home.** A "Stage: Validate → Build → Launch → First customers" strip with
   the current step's exit criteria and progress. Read-only, computed from metrics and artifacts in
   `packages/core/src/plan/`. It tells the founder why today's cards exist.
6. **Gate cards merged with the next action.** In `packages/core/src/decisions/`, a card can carry
   `gate` context (thresholds vs actuals) next to its K2 action, e.g. go-live after S3 and pre-orders
   after S8. One decision, at most 3 options, quota unchanged.
7. **Live work view.** Append-only `task_events` (step, tool, skill id + version, screenshot path,
   tokens/cost) written by `packages/agents/src/runtime/claude-agent-sdk.ts`. New route
   `/c/[slug]/tasks/[id]`; the team-page terminal (`team/page.tsx`) links each row there. Pull only.
8. **Variants and comments on artifacts.** `artifacts/[id]/page.tsx` gets a version switcher, a diff
   view (suggestion mode), and pins for text ranges, DOM selectors (site previews) and image x/y. A
   batch of comments becomes one revision task with `parent_artifact_version`.
9. **1:1 chat with "Add to context".** Route `/c/[slug]/chat/[role]` (covers CHAT-1 for the Chief of
   Staff). Each message has an "Add to context" action that writes `memory_items` (kind
   `learning|decision`, provenance = message id) with undo. Chat can only create tasks; external steps
   still go through `AuthorityEngine.gate()`.
10. **Team proposal step.** New onboarding step `team` between budget and summary
    (`onboarding/steps/team-step.tsx`, `packages/core/src/onboarding.ts`), plus a catalog in
    `agents/personas/*.yaml` validated by Zod.
11. **Cost guard for variants.** Default to 3 variants only for brand, site direction and headlines; 1
    draft plus a critic for research text. Cap the critic loop at 2 passes. Show estimated credits on
    "more variants". This keeps dev/test spend under $100/month.

### Recommended founder journey (30 days)

| Day | Screen | Agents do | Founder does (min) | K2 cards | Review items |
| --- | --- | --- | --- | --- | --- |
| 0 | `/new` → onboarding (questions, goal, budget, **team**, summary) | CoS proposes team | Answers, edits team (10) | 0 | team (inline) |
| 1 | Home + Review | Market scan, competitors, 3 ICPs, assumption map, interview kit | Pick ICP, accept thresholds (6) | 1-2: connect Gmail/Calendar, interview outreach batch | 3 |
| 2-6 | Home, Review, chat with Research | Book calls, brief before each call, synthesis after; Strategy drafts positioning and price form; Design brand directions | 3-5 calls (20-30 each), review (5/day) | 1 on day 3: domain | 2-3/day |
| 7 | Home (gate card) | `interview_synthesis`, site directions | Read readout, pick site direction (8) | 1: "Evidence X: launch waitlist page to ICP Y?" | 2 |
| 8-9 | Task live view, preview with comments | Build, critic screenshots, revise | Pin comments on preview (5) | 1: go live + announce post | 1-2 |
| 10-14 | Home, ledger | Network outreach, community posts drafted, ad test | Approve channels (3) | 1-2/day: outreach batch, ad test spend | 1-2/day |
| 15 | Home (gate card) | `demand_readout` vs thresholds | Decide (3) | 1: "Open pre-orders at $P on your Stripe?" | 0 |
| 16-30 | Home, chat with Sales | Personal emails to the waitlist, concierge onboarding, weekly plan from the ledger | Calls with first customers | at most 1/day | at most 3/day |

### Research and Strategy department personas

| Dept | Persona | Task types | Skills (vendored) | Dial |
| --- | --- | --- | --- | --- |
| Research | Market Analyst | market_report, competitor_map | pm-skills market-sizing, competitor-analysis; kwp competitive-brief; `evidence-citations` | Autopilot |
| Research | Customer Discovery Lead | interview_kit, interview_synthesis | wondelai mom-test; pm-skills interview-script, summarize-interview; kwp synthesize-research; `commitment-ledger` | Review |
| Research | Experiment Designer | assumption_map, demand_readout | pm-skills identify-assumptions-new, prioritize-assumptions, brainstorm-experiments-new; wondelai lean-startup; `preregistered-threshold` | Review |
| Research | Signal Scout (exists) | signal_research | `evidence-citations` | Autopilot |
| Strategy | Positioning Strategist | positioning, personas (ICP pick) | pm-skills value-proposition, beachhead-segment, ideal-customer-profile, positioning-ideas, product-name | Review |
| Strategy | Pricing Strategist | pricing_test | pm-skills pricing-strategy, monetization-strategy; Van Westendorp form ([P14]) | Review |
| Strategy | Product Lead | prd (landing + waitlist scope) | kwp write-spec; pm-skills create-prd, pre-mortem | Autopilot |
| Shared | Red-Team Critic | critic pass on every draft | pm-skills strategy-red-team; `critic-rubric-<kind>` | always on |

`kwp` = `anthropics/knowledge-work-plugins`; backticked names are North-authored skills (section 7).
Tools and tiers stay as in `agents/research.yaml` and `agents/strategy-product.yaml` (K0).

### Success metrics per step

| Step | Metric (North default target) |
| --- | --- |
| S0 | Onboarding at most 10 min (ONB-1); team accepted with at most 2 edits |
| S1-S2 | 100% of claims cite a URL; 3 assumptions with thresholds by end of day 1 |
| S3 | Interviews held at least 10; commitments at least 5; share of past-behaviour questions at least 80% (Mom Test scoring) |
| S4 | Price range from at least 20 answers; one value prop picked within 2 variant rounds |
| S5-S6 | Site live by day 9; critic pass; form test evidence; first-load LCP under 2.5 s |
| S7-S8 | At least 200 targeted visitors; conversion at or above threshold; at least 5 deposits or pre-orders |
| S9 | First payment by day 21; 10 paying (or 3-5 paid design partners) by day 30 |
| S10 | 40% very disappointed; 5-7% weekly growth ([P3] [P13]) |
| Attention | Cards/day at most 3 (never exceeded); review at most 10 min/day; median card answer under 60 s; north star = measured and approved decisions per week (SPEC) |

### Mobile-first notes

- Home stays brief + at most 3 cards; the review line and stage strip sit under them; everything else is one tap away.
- Variants scroll in a horizontal carousel with the recommended one first; tap to pick, tap-and-hold to
  comment (Figma's long-press on mobile [U6]). Images open full screen with pinch zoom.
- Comments: a voice note is transcribed into the comment; site previews open in a phone frame and pins
  map to DOM selectors.
- The live view collapses to one line ("Design · step 4/7 · applying brand-kit skill · $0.12") that expands into the log.
- Chat is a bottom sheet from any agent or artifact; "Add to context" is a long-press action on a message.
- Push only for cards plus the 2 review digests; tap targets at least 44 px; offline brief already exists (M6).

## Risks

- **Founder skips interviews.** An async survey fallback is weaker evidence; North must say so on the
  gate card and never synthesise "interviews" from web content (research.yaml already forbids invented conversations).
- **Review fatigue moves rather than disappears** ([C4] [C9]). The review budget, defaults and
  dial-change proposals are mandatory, not polish.
- **Merged gate cards** could hide two decisions in one; keep one question, at most 3 options and an
  explicit "not yet" safe default.
- **Benchmarks are weak** ([P18]); thresholds must be editable and shown as the founder's own bet.
- **Skill licences**: NC and content-rights traps ([K3] [K4]); book-summary skills ([K5]) may draw copyright complaints.
- **Outreach compliance**: first-contact email stays the user's legal responsibility (CAN-SPAM/GDPR, see [C4]); keep K2 per batch.
- **Cost**: variants and critic loops multiply tokens; at about $100/month for dev/test, acceptance runs
  should use 2 variants and cached research.

## Open questions for the founder

1. Accept changing M1's acceptance (PRD, business plan and deck in 24 h) to validation artifacts first?
2. Should go/no-go gates be merged into the next K2 card (recommended), or be a new card kind that counts against the quota?
3. Do you want an async survey fallback for founders who won't take calls, clearly labelled as weaker evidence?
4. Review budget defaults: 5 items / 10 min / 2 digests a day, with a 24 h default. OK?
5. When chat asks for an external action and the quota is full, does it wait until tomorrow, or may the founder raise the quota (1-5) inline?
6. Pre-orders and deposits on the user's own Stripe at S8: allowed in this phase, or waitlist only?

## Sources

- [P1] Paul Graham, "Do Things That Don't Scale" — https://paulgraham.com/ds.html
- [P2] Paul Graham, "How to Get Startup Ideas" — https://paulgraham.com/startupideas.html
- [P3] Paul Graham, "Startup = Growth" — https://paulgraham.com/growth.html
- [P4] YC Startup School week 2 recap (Seibel, How to Plan an MVP) — https://blog.ycombinator.com/startup-school-week-2-recap-michael-seibel-adora-cheung-and-ilya-volodarsky
- [P5] YC Startup School week 1 recap (Migicovsky, How to Talk to Users) — https://blog.ycombinator.com/startup-school-week-1-recap-kevin-hale-and-eric-migicovsky
- [P6] Eric Migicovsky, notes on the talk — https://ericmigi.com/blog/startup-school-how-to-talk-to-users
- [P7] YC Startup School week 4 recap (Mañalac, How to Launch Again and Again) — https://blog.ycombinator.com/startup-school-week-4-recap-kat-manalac-and-gustaf-alstromer/
- [P8] Sachin Rekhi, primer on The Mom Test — https://www.sachinrekhi.com/the-mom-test-rob-fitzpatrick
- [P10] Lenny's Newsletter, first 10 B2B customers — https://www.lennysnewsletter.com/p/how-to-win-your-first-10-b2b-customers
- [P11] Lenny's Newsletter, first 1,000 consumer users — https://www.lennysnewsletter.com/p/how-the-biggest-consumer-apps-got
- [P12] Buffer, "Idea to Paying Customers in 7 Weeks" — https://buffer.com/resources/idea-to-paying-customers-in-7-weeks-how-we-did-it
- [P13] First Round Review, Superhuman PMF engine — https://review.firstround.com/how-superhuman-built-an-engine-to-find-product-market-fit
- [P14] Van Westendorp survey recipe — https://startup-recipes.innovationworks.org/recipes/conducting-a-pricing-survey-with-the-van-westendorp-price-sensitivity-survey ; https://www.intotheminds.com/blog/en/?p=72426
- [P15] Monetizing Innovation summary (secondary) — https://echai.ventures/books/monetizing-innovation
- [P16] Running Lean summaries — https://fourweekmba.com/running-lean-ash-maurya ; https://student.cs.uwaterloo.ca/~cs445/Winter2026/Week02/02e_ProblemInterview_slides.pdf
- [P17] Lean Startup MVP summary (secondary) — https://fourweekmba.com/minimum-viable-product/ ; Dropbox video MVP — https://www.shortform.com/blog/?p=7858
- [P18] Smoke-test and waitlist benchmarks (vendor/blog) — https://hub.causo.ai/guides/fake-door-smoke-testing-validate-demand-2026 ; https://echai.ventures/startingup/validate-idea/is-a-waitlist-with-a-lot-of-signups-actual-proof-of-demand
- [C1] North, Polsia teardown — docs/research/polsia-teardown.md
- [C2] Preuve AI, Polsia review (updated 2026-10-14; competitor-adjacent) — https://preuve.ai/blog/polsia-review.md
- [C3] Product Hunt, Polsia — https://www.producthunt.com/products/polsia
- [C4] Crevio, Marblism review (2026-10-02; competitor) — https://crevio.co/blog/marblism-review
- [C5] Marblism — https://www.marblism.com/
- [C6] Trustpilot, Marblism — https://www.trustpilot.com/review/marblism.com
- [C7] Sintra — https://sintra.ai/
- [C8] Crevio, Sintra review (2026-10-02) — https://crevio.co/blog/is-sintra-ai-legit
- [C9] Trustpilot, Sintra — https://www.trustpilot.com/review/sintra.ai?page=2
- [C10] Lindy Academy, Human in the Loop — https://www.lindy.ai/academy-lessons/human-in-the-loop ; Lindy docs, Slack — https://docs.lindy.ai/skills/popular-integrations/slack
- [C11] Lindy review (affiliate) — https://www.usecarly.com/blog/lindy-ai-review/
- [C12] Relevance AI, Agent-to-Tool configuration — https://relevanceai.com/docs/workforce/workforce-features/agent-to-tool-configuration ; https://relevanceai.com/approvals-escalations
- [C13] G2, Relevance AI — https://www.g2.com/products/relevance-ai/reviews
- [C14] Manus 2.0 (2026-09-28) — https://manus.im/blog/introducing-manus-2-0
- [C15] Manus Wide Research — https://manus.im/docs/features/wide-research ; https://help.manus.im/en/articles/11960169-what-is-wide-research ; https://trust.manus.im/faq
- [C16] Manus reviews (secondary) — https://usecarly.com/blog/manus-ai-review ; https://fr.trustpilot.com/review/manus.ai
- [C17] Lovable, Edit from the preview — https://docs.lovable.dev/features/design
- [C18] Lovable, Plan mode and history — https://docs.lovable.dev/features/plan-mode ; https://docs.lovable.dev/features/projects/history
- [C19] Lovable reviews — https://www.trustpilot.com/review/lovable.dev?page=1 ; https://www.superappp.com/blog/lovable-review-2026-pricing-reviews-is-it-worth-it
- [C20] Motion AI Employees — https://www.usemotion.com/use-cases/startups ; https://www.usemotion.com/use-cases/sales-teams ; https://www.reworked.co/the-wire/motion-raises-60m-at-550m-valuation-to-build-the-agentic-work-suite-for-businesses/
- [C21] Devin docs — https://docs.devin.ai/work-with-devin/devin-session-tools ; https://docs.devin.ai/release-notes/2025 ; https://docs.devin.ai/es/product-guides/knowledge
- [C22] Answer.AI, "Thoughts On A Month With Devin" — https://www.answer.ai/posts/2025-01-08-devin
- [C23] Atoms launch (press release) — https://www.barchart.com/story/news/37069197/atoms-launches-ai-powered-business-team-to-support-one-person-companies-and-solo-founders ; https://www.datalearner.com/en/ai-agents/ai-agent-detail/atoms
- [C24] Genspark review (secondary) — https://fast.io/resources/genspark-ai-review-2026/
- [C25] Claude Design coverage — https://www.unite.ai/anthropic-launches-claude-design-for-visual-prototyping-and-presentations/ ; https://flowstep.ai/blog/claude-design-review/
- [U1] LangChain Agent Inbox and HITL — https://github.com/langchain-ai/agent-inbox ; https://docs.langchain.com/oss/python/langchain/human-in-the-loop
- [U2] Amershi et al., Guidelines for Human-AI Interaction (CHI 2019) — https://www.microsoft.com/en-us/research/publication/guidelines-for-human-ai-interaction/
- [U3] Fitz et al., batching notifications (2019) — https://work21.gatech.edu/?p=402 ; https://communities.springernature.com/posts/batching-notifications-can-improve-attention-well-being-and-productivity
- [U4] Midjourney, Variations — https://docs.midjourney.com/docs/variations
- [U5] Google Docs, Suggest edits — https://support.google.com/docs/answer/6033474
- [U6] Figma, Add comments to files — https://help.figma.com/hc/en-us/articles/360041068574-Add-comments-to-files
- [U7] OpenAI, Introducing canvas — https://openai.com/index/introducing-canvas/ ; https://help.openai.com/en/articles/9930697
- [U8] OpenAI, ChatGPT agent (retired) and confirmations — https://help.openai.com/en/articles/11752874-chatgpt-agent ; https://deploymentsafety.openai.com/chatgpt-agent/user-confirmations
- [U9] Anthropic, Building effective agents — https://www.anthropic.com/engineering/building-effective-agents
- [U10] Apple, notifications and Scheduled Summary — https://support.apple.com/guide/iphone/view-and-respond-to-notifications-iph6534c01bc/ios
- [U11] NN/g, State of UX 2026 — https://www.nngroup.com/articles/state-of-ux-2026/
- [U12] Google Stitch variants (secondary) — https://alternativeto.net/news/2025/9/google-stitch-introduces-design-variants-canvas-organization-and-easy-sharing ; https://tutorialsdojo.com/what-google-stitch-actually-does-and-where-it-falls-short/
- [T1] AutoAgents (IJCAI 2024) — https://arxiv.org/abs/2309.17288
- [T2] AgentVerse (ICLR 2024) — https://arxiv.org/abs/2308.10848
- [T3] MetaGPT (ICLR 2024) — https://arxiv.org/abs/2308.00352
- [K1] anthropics/knowledge-work-plugins — https://github.com/anthropics/knowledge-work-plugins ; https://github.com/anthropics/knowledge-work-plugins/tree/main/product-management/skills ; https://github.com/anthropics/knowledge-work-plugins/tree/main/small-business
- [K2] phuryn/pm-skills — https://github.com/phuryn/pm-skills
- [K3] deanpeters/Product-Manager-Skills — https://github.com/deanpeters/Product-Manager-Skills
- [K4] RefoundAI/lenny-skills — https://github.com/refoundai/lenny-skills
- [K5] wondelai/skills — https://github.com/wondelai/skills
- [K6] alirezarezvani/claude-skills — https://github.com/alirezarezvani/claude-skills
