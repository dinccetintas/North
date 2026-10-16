# North studio phase (M7-M13): design

Status: design approved by the founder on 2026-10-16 in conversation; this written spec
awaits the founder's review. Inputs: the founder's brief of 2026-10-16, four rounds of
answers (section 2), and seven research documents in `docs/research/`
(`agent-harness-best-practices.md`, `startup-playbook-and-journey.md`,
`dept-design-frontend.md`, `dept-engineering.md`, `dept-marketing.md`, `dept-sales.md`,
`real-testing-strategy.md`). Those documents hold the sources; this spec holds the
decisions. Base architecture: `docs/superpowers/specs/2026-10-14-north-architecture-design.md`.

## 1. Intent

M0-M6 built the frame: authority gate, decision cards, ledger, eight roles, billing. The
founder's verdict is that the staff is not yet good enough to make a founder succeed:

- A company succeeds through its team. Every North agent must be best in class in its
  field, equipped with the right skills, plugins, connectors and sources.
- Design, marketing and sales are iterative. One prompt and one output is not how good
  work happens; drafts, critique, variants and revisions are.
- The founder must see the work while it happens, pick among variants, comment on an
  output, approve or reject it, and talk to any agent directly, with what they say
  flowing back into company memory.
- Quality is proven by real tests: Playwright driving the deployed app like a real
  user, with real Claude, not fixtures. "Done" means the founder logs in and it works.

Success for this phase:

- Every milestone passes its live acceptance (tier T4, section 8) on staging with the
  production model profile, and the evidence is committed.
- The attention budget holds: at most 3 decision cards a day, never exceeded, and a
  median of at most 10 minutes a day in the review queue during acceptance runs.
- Output quality is measured: every draft that reaches the founder has passed its
  department's hard gates, and the founder accepts the recommended variant, or a
  revision after at most two comment rounds, in at least 70% of review items.
- One full founder journey (idea to live site to campaign draft) costs at most $8 of
  Claude on the production profile, and dev/test spend stays under $100 a month.

## 2. Founder decisions (2026-10-16)

| Topic | Decision |
| --- | --- |
| Primary user | A founder starting from scratch. "Grow an existing business" and "hire one department" come later. |
| Control | A per-department dial: Autopilot or Review drafts. Design and creatives default to Review drafts. Drafts live in a review queue that never consumes the decision quota. Money, public posts, first contact and going live stay K2 cards. |
| Interaction | All four: live work view, pick among 2-3 variants, comments on an output that produce a new version, 1:1 chat with any agent with "Add to context". |
| Team | The system proposes departments and specialist personas from the goal; the founder approves or edits. |
| Skills | A curated library vendored with pinned versions and licence checks, plus North-authored skills. Research looks beyond the libraries the founder named. Never fetched at run time. |
| Order | Design + Frontend first, then the other departments. |
| Engineering target | An excellent landing page with a waitlist this phase; the full app later. |
| Generation tools | The user's own account for Higgsfield and similar tools. Trials on North credits only through providers whose terms allow resale, checked before M9 starts (Recraft is the first candidate); Higgsfield trials wait for its written approval. |
| Sales sources | Licensed providers on the user's account (Apollo, Hunter, Exa) plus open web research. No LinkedIn scraping. |
| Regions | US, UK, Canada, the Gulf states and the EU are all in scope. Each region opens only when its rule set is encoded and tested; consent-only jurisdictions require recorded consent. |
| Marketing channels | Meta ads and Instagram, TikTok short video, YouTube with vidIQ, SEO and LinkedIn/X organic. |
| Design outputs | Logo and brand identity as real files, 2-3 website directions and the live site, 3D and animated experiences. |
| Testing | Tiered: every change runs real Claude against a sandboxed world; every milestone acceptance runs a full live journey on test accounts. |
| Environment | A live staging deployment the founder logs into. |
| Budget | Dev/test spend under $100 a month (Claude, generation credits, staging worker, CI). Vercel Pro is a production cost. |
| Approach | Ground truth first, then the shared studio with Design as its first tenant, then departments (section 4). |
| Journey | Validation before building: the first 24 hours produce evidence about customers, not a PRD and an investor deck. This changes M1's acceptance. |
| Waitlist | In the user's own Supabase project. |
| Review budget | 5 items and 10 minutes a day, two digests, a 24-hour default. |

## 3. What the research changed

- **Security gap.** Engineering's Bash runs on the worker host with the model API key in
  its environment, and `settingSources: []` alone does not isolate companies (auto memory
  and `HOME` leak through). Fixed first, in M7.
- **Compliance gap.** The Gmail send path has no opt-out line, postal address or
  List-Unsubscribe header, and never marks bounces or opt-outs. Fixed in M7, before any
  further live send.
- **Stale Meta adapter.** It targets a deprecated Graph API version and sends text-only
  creatives. The version moves in M7; creative upload lands in M11.
- **Self-critique fails.** Anthropic's 2026 harness work: a separate, skeptical evaluator
  with a browser, a weighted rubric and hard thresholds beats a generator grading
  itself. Code decides pass or fail from tool output; the model only scores and ranks.
- **Validate first.** Every 0-to-1 playbook puts customer evidence before building;
  Polsia's own numbers (about 10% of companies ever made $1) show the cost of skipping it.
- **Approval fatigue** is the top complaint about competitors. The review queue needs a
  budget and defaults, not just a list.
- **Vendor terms.** Higgsfield forbids reselling generations without approval; Apollo's
  data may not be pooled across tenants or embedded in memory; the Anthropic
  `claude-code` repository is proprietary, so `frontend-design` is vendored from
  `anthropics/skills` (Apache-2.0); some skills fetch rules or binaries at run time and
  must be vendored as snapshots.
- **Budget fits.** About $45 of Claude a month covers per-PR smoke runs, nightly staging
  runs and two acceptance runs, if tests use cheaper model profiles and replay recorded
  runs.

## 4. Approach and roadmap

Three approaches were weighed: everything-platform first (late visible value, one huge
milestone), department by department without a shared studio (fast, then rewritten per
department), and the chosen one: ground truth, then the shared studio proven on Design,
then departments in the founder's order.

| Milestone | Scope | Acceptance (T4 live, on staging) |
| --- | --- | --- |
| M7 Ground truth | SEC-1/2, CMP-1, Meta version, model profiles and test budget guard, model gateway with record/replay, real-Claude smoke per PR, staging, test-account fence, nightly journey | Today's journey (sign up, idea, research, PRD, site, campaign draft, kill switch) runs on staging with real Claude; a gap report lists what is weak, with evidence |
| M8 Studio | Skill library and lock, persona catalog and team proposal, studio loop with critic, variants, review queue, comments and versions, live work view, agent chat, validation-first onboarding order | A brand kit arrives as 3 variants with critic scores; the founder picks one, pins two comments, gets a new version with a diff; a chat preference lands in memory; cards stay at most 3 |
| M9 Design + Frontend | Brand Designer, Art Director, Frontend Engineer, Motion & 3D Engineer, Design Critic; engineering sandbox; Supabase connection; Next.js landing with waitlist | From an idea: real SVG logo files, 3 site directions with screenshots, a pick, a build in the user's repo, critic gates green, go-live card, live URL, a test signup row found in the user's Supabase |
| M10 Research + Strategy | ICP options, assumption map with pre-set thresholds, interview kit and synthesis, positioning, pricing test, demand readout, journey stage strip, gate context on K2 cards | A company cannot reach the go-live card without a readout against its own thresholds; interview evidence only from real calendar events, notes or replies |
| M11 Marketing | Creative pipeline (Higgsfield on the user's account, Recraft trials, Remotion), Meta paused-first campaigns, Instagram, TikTok drafts, YouTube with vidIQ, SEO briefs, LinkedIn/X, marketing critic | A creative set is generated, critiqued, picked, uploaded paused to the Meta sandbox ad account, previewed on the K2 card, and started on approval; disclosure flags set |
| M12 Sales | Apollo, Hunter, Exa and email verification behind North tools, deliverability guard, region rule sets, sequences, pipeline, Cal.com | A verified, compliant first-contact batch to test inboxes; a reply moves the lead; an opt-out writes a suppression; a booking moves it to meeting |
| M13 Thirty-day live run | The founder's own idea (the GCC Function Health-style app) on production for 30 days | The SPEC M6 acceptance, now with the studio: decisions and reviews only, measured in the ledger |

Each milestone gets `docs/plans/M<n>.md` with its acceptance test before code starts
(section 11).

## 5. Architecture

### 5.1 Roles, personas, departments and the team proposal (TEAM-1, TEAM-2)

- **Role** stays the authority unit: the eight `agents/*.yaml` files keep the tool ceiling
  and `max_action_tier`. Nothing below a role can exceed it.
- **Persona** is a specialist inside one role: `agents/personas/<department>/<persona>.yaml`,
  with `role:` naming its parent. A persona narrows the parent's tools and adds skills,
  model alias, effort, budget, output contract and evidence rules. The schema extension
  (`skills`, `effort`, `subagents`, `workflow`, `review_mode`, `evidence`) is in
  `agent-harness-best-practices.md` §8; every new field is optional so the eight roles still load.
- **Department** groups personas for the founder: `design_frontend` (Brand Designer, Art
  Director, Frontend Engineer, Motion & 3D Engineer, Design Critic), `research_strategy`,
  `marketing`, `sales`, `engineering`, `operations`. The review dial is per department.
- **Handoffs.** Personas never assign work to each other. A department workflow is worker
  code that sequences personas inside a plan step the Chief of Staff owns, and every step
  is recorded, which keeps the SPEC rule that every handoff goes through the Chief of Staff.
- **Team proposal.** A new onboarding step `team` between budget and summary. The Chief
  of Staff picks personas from the vetted catalog for the goal (it never invents a persona;
  it writes only each persona's brief) and proposes dials. The founder edits; the result
  seeds `agents` rows. It proposes team changes again at each journey gate.
- **Migration.** Each existing `agents` row becomes its role's default persona, so M0-M6
  companies keep working without a new onboarding.

### 5.2 Skills (SKL-1, SKL-2)

- Layout: `skills/vendor/<owner>__<repo>@<sha>/` copied at a pinned commit, and
  `skills/north/` for North-authored skills. One local plugin root per persona bundle.
- `skills/skills.lock.json`: repo URL, commit SHA, SPDX licence, sha256 per file, reviewer,
  date, `modified` flag, and risk flags (`has_scripts`, `has_hooks`, `has_shell_injection`,
  `fetches_at_runtime`).
- `scripts/skills-verify.ts` joins `pnpm validate` and fails on hash drift, a licence
  outside {MIT, Apache-2.0, CC-BY-4.0, CC-BY-SA-4.0 unmodified}, frontmatter `hooks`,
  shell-injection blocks, or URLs outside an allowlist. Run-time fetchers are replaced by
  vendored snapshots.
- Loading: the runtime passes `plugins` (only the persona's plugin roots) and a `skills`
  allowlist, keeps `settingSources: []`, and sets `disableSkillShellExecution`. The SDK's
  `skills` option is a context filter, not a sandbox, so unlisted skills are never mounted.
- The live work view shows the skills listed in the run's `init` message and every
  `Skill` invocation, with name and lock version.
- An Anthropic evaluation found a framework skill unused in 56% of runs while an
  `AGENTS.md` docs index scored 100%. Each vendored skill must earn its place: the eval
  harness (section 8) compares a persona with and without it on golden inputs, and a
  skill that does not raise the score is dropped.
- A monthly vendor-bump PR is reviewed by `north-security-reviewer`.
- First batch, from the research: `anthropics/skills` (frontend-design, canvas-design,
  theme-factory, webapp-testing), `pbakaus/impeccable` (markdown plus a hashed engine or
  markdown only), `emilkowalski/skills`, `ibelick/ui-skills`, `Leonxlnx/taste-skill`,
  `nextlevelbuilder/ui-ux-pro-max-skill` data, `vercel-labs/agent-skills`,
  `obra/superpowers` (planning, TDD, verification), Matt Pocock's skills,
  `anthropics/knowledge-work-plugins`, `phuryn/pm-skills`, `wondelai/skills`,
  `coreyhaines31/marketingskills`, Remotion's official agent skills. Excluded for licence
  reasons: `deanpeters/Product-Manager-Skills` (non-commercial), Superdesign (AGPL),
  react-bits (Commons Clause), Anthropic's document skills and `claude-security` plugin
  (proprietary). Every entry is rechecked when vendored.

### 5.3 The studio loop (LOOP-1, LOOP-2)

A pure state machine in `packages/core/src/workflow/review-loop.ts` and an Inngest
function in `apps/worker/src/inngest/review-functions.ts`. No graph framework: Inngest
already gives durable steps, retries, waits and `cancelOn` for the kill switch.

```
briefing ─▶ drafting ─▶ critiquing ──pass──▶ awaiting_review ──approved──▶ publishing ─▶ done
                          ▲     │                 │       │
                          │     fail (≤2 rounds)  │       └──rejected──▶ failed
                          │     ▼                 │
                          └── revising ◀──commented
```

- **Variants.** One briefing turn, then `forkSession` 2-3 times with directions forced
  apart (taste dials and a distinctness check), so forks share the cached prefix. Three
  variants by default for brand, site direction, headlines and creatives; one draft plus
  a critic for research text.
- **Critic.** A separate run of the department's critic persona with a fresh context,
  read-only tools and `outputFormat` set to the rubric schema. It never critiques its own
  work. It receives screenshots from `mcp__north__page_screenshot`, a worker-side
  Playwright tool limited to the preview host (390 and 1440 wide); it never gets a browser
  or Bash. Rubrics live in `agents/rubrics/*.yaml` with weights, anchored 1-5 scales, an
  "unknown" option, hard criteria and few-shot calibration examples the founder reviews.
- **Who decides.** Deterministic tools decide pass or fail (axe, Lighthouse, the
  impeccable detector, SVG validity, contrast, build exit codes, link checks). The model
  scores and ranks. A cheap Haiku-tier pass pre-screens; the Sonnet tier judges visual work.
- **Stop rule.** Pass, two revisions, or the workflow budget, whichever comes first; then
  the best-scoring draft goes to review with its scores. AGT-3 still caps task attempts.
- **Autopilot.** The critic's top pick advances; the founder can still comment later and
  the comment starts a revision. Anything external still goes through `gate()`.

### 5.4 Review queue and attention budget (REV-1)

- `review_items` is separate from `decision_cards`. It never touches `DecisionQuota`, so
  DEC-3 logic stays untouched.
- Kinds: `variant_pick`, `draft`, `plan`, `memory_suggestion`, `team_change`.
- Each item has at most 3 variants, a recommended one, a 24-hour default (the critic's
  pick advances as a draft; nothing public happens by default), and a status.
- Budget: at most 5 items and an estimated 10 minutes a day, delivered in two push
  digests. Overflow waits for tomorrow, ranked by what blocks the plan.
- The answer is stored first, then a `review/answered` event starts `settle-review`
  (the `settleDecisionFn` pattern), because `step.waitForEvent` misses events sent before
  the wait begins.
- Home screen: a "Review · n · ~m min" line under the cards. Route `/c/[slug]/review`.

### 5.5 Comments and versions (REV-2)

- `artifact_comments` anchor to an artifact version: a text range, a DOM selector on a
  site preview, or an x/y point on an image, plus the body and a status.
- The founder collects comments and sends them as one batch ("Send 3 comments"). The
  batch becomes one `revise_artifact` task whose input carries the parent version and
  the comments as data, never as instructions.
- The new version shows a diff against its parent and can be reverted. Artifacts gain
  `parent_version`, `variant_group`, `variant_label` and `status` (`draft|approved`).

### 5.6 Live work view (LIVE-1)

- The runtime enables `includePartialMessages`, `forwardSubagentText` and
  `agentProgressSummaries` and reports coarse events to the worker through an `onEvent`
  callback.
- The worker writes them to an append-only `agent_run_events` table: text block finished,
  tool start and end with redacted input, `Skill` invocation, screenshot storage path,
  subagent progress, tokens and cost so far. Token deltas are never stored.
- The web app reads them through Supabase Realtime under RLS at `/c/[slug]/tasks/[id]`;
  each row of the Team screen's terminal links there.
- On mobile it collapses to one line ("Design · step 4/7 · brand-kit skill · $0.12").

### 5.7 Agent chat (CHAT-1, CHAT-2)

- Route `/c/[slug]/chat/[persona]`; the Chief of Staff thread is CHAT-1. Chat is never
  required and never opens on its own.
- A chat turn is a short Agent SDK run of that persona with `memory_search`, read-only
  tools and the persona's current work as context. It has one action tool,
  `propose_task`, which files a request the Chief of Staff plans. Chat never performs an
  external action.
- "Add to context" on any message writes a `memory_items` row (kind `preference`,
  `decision` or `learning`, provenance = message id) with undo. Memory suggestions from
  the agent go to the review queue.
- Tables `agent_threads` and `agent_messages`, both under RLS.

### 5.8 Vendor MCP servers and pasted keys (MCP-1)

- Meta (`mcp.facebook.com/ads`), Higgsfield, vidIQ, Apollo and Clay ship official MCP
  servers whose write tools spend money or publish. Agents see only a read-only allowlist
  per vendor through `packages/integrations/src/live/mcp-client.ts`, using the user's
  OAuth bearer token stored under ADR 0008.
- Every write (activate a campaign, generate, publish, send) is called by the worker
  after `AuthorityEngine.gate()`. Non-negotiable 1 holds for MCP exactly as for adapters.
- Providers without OAuth (Apollo before partner approval, Hunter, Exa, MillionVerifier,
  DataForSEO) use a `connections` row of kind `api_key`, encrypted under ADR 0008 and
  validated with a cheap identity call. They are wrapped as in-process North tools
  (`leads.search_provider`, `leads.enrich`, `leads.verify`), like `memory_search`.

### 5.9 Runtime hardening and the model gateway (SEC-1, SEC-2)

- Upgrade the Agent SDK to the current 0.3.x release; pass `effort` from
  `EFFORT_BY_ALIAS` (it is never sent today); pass an explicit built-in `tools` list.
- Per-company isolation: `CLAUDE_CONFIG_DIR` per company, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`,
  `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`, and `HOME` set to the per-company directory
  instead of the host's.
- **Model gateway.** A loopback proxy in the worker. Agent subprocesses get
  `ANTHROPIC_BASE_URL` pointing at it and a placeholder key. The gateway:
  - injects the real key, so no agent process ever holds it;
  - enforces per-run, per-workflow and per-profile spend caps;
  - records and replays runs as cassettes in test modes.
  The worker refuses a non-loopback base URL in production.
- Engineering Bash runs under the SDK sandbox with `allowUnsandboxedCommands: false` and
  a network allowlist (npm registry, the gateway) from M7.
- In M9, after a spike, it moves to a per-task VM through a `SandboxProvider` (Vercel
  Sandbox first, E2B as fallback) from a pinned snapshot. GitHub, Vercel and Supabase stay
  outside the sandbox, reached only through the worker's gated adapters. The kill switch
  stops sandboxes too.
- A `SessionStore` over an append-only `agent_session_entries` table lets a parked task
  resume on any worker machine.
- `waiting_decision` uses the SDK's own mechanism: the `PreToolUse` hook returns `defer`
  when `gate()` returns a card, the run ends with `tool_deferred`, and `settleDecisionFn`
  resumes it from the session store.

### 5.10 Data model changes

New migrations from `0019`; RLS on every table; append-only tables reject update and delete.

| Table / change | Milestone | Notes |
| --- | --- | --- |
| `suppressions` (append-only) | M7 | email, domain, reason `opt_out|bounce|complaint|manual|legal_block`, source action id; read by `gate()` |
| `companies.postal_address`, `companies.legal_name` | M7 | required before any live first contact; changing them is K3 |
| `agent_session_entries` (append-only) | M7 | SDK session store |
| `agents.persona`, `agents.department`, `agents.review_mode` | M8 | unique `(company_id, persona)`; `role` stays |
| `review_items`, `artifact_comments` | M8 | section 5.4, 5.5 |
| `artifacts.parent_version`, `variant_group`, `variant_label`, `status` | M8 | versions stay immutable rows |
| `critiques` (append-only) | M8 | artifact version, rubric id and version, scores, hard results, tool evidence paths, model alias |
| `agent_run_events` (append-only) | M8 | section 5.6 |
| `agent_threads`, `agent_messages`; `memory_items.kind` + `preference` | M8 | section 5.7 |
| `connections.kind` `oauth|api_key` | M11 | pasted keys |
| `lead_verifications`, `pipeline_events` (append-only); lead `country`, `source_provider`, `source_url`, `signal`, `lawful_basis` | M12 | sales |

New task types: `assumption_map`, `interview_kit` (M8); `design_directions`,
`design_critique`, `revise_artifact` (M8-M9; `screen_designs` is replaced);
`interview_synthesis`, `positioning`, `pricing_test`, `demand_readout` (M10);
`creative_brief`, `ad_variant_set`, `video_script`, `content_calendar`, `seo_brief`,
`critic_report` (M11); `reply_triage`, `pipeline_review` (M12). New action kinds:
`generation.spend`, `ads.creative.upload` (K1, paused objects),
`social.upload.draft` (K1), `video.metadata.update` (K1 inside an approved plan).

## 6. Departments

The full persona tables (skills, tools, outputs, evidence, tiers) are in the research
documents; this section fixes the scope per milestone.

### 6.1 Design + Frontend (M9)

- **Brand Designer** (drafter): real logo, mark and wordmark SVGs through a vector model:
  Recraft on a North key for trials if its terms allow resale, else the user's own
  Recraft or Higgsfield account, favicons, OG image,
  `tokens.json`, `DESIGN.md`, a contrast table computed by a tool, fonts from a vendored
  catalogue with OFL or Apache licences. Done: each SVG parses, has a viewBox, holds no
  embedded raster, is at most 30 KB after SVGO, and every contrast pair passes. (DSN-1)
- **Art Director** (drafter): 2-3 directions as static HTML with 390 and 1440 screenshots,
  passing the distinctness check and a critic pre-score. Page copy stays here this phase.
  (DSN-2)
- **Frontend Engineer** (coder): Next.js and Tailwind v4 with shadcn and Motion in the
  user's GitHub repo, built by Vercel from git. The waitlist form writes to a table in the
  user's Supabase project, created through a new Supabase connection. Creating the table
  is K1; creating a project is K1 on the free plan and K2 on a paid org. (WEB-1)
- **Motion & 3D Engineer** (coder, only when a direction asks for it): React Three Fiber
  and drei with a poster image first, reduced-motion support, a GLB size budget, and a
  rule that the canvas is never the LCP element. Motion is the default animation library;
  GSAP is excluded this phase. (DSN-3)
- **Design Critic** (drafter, fresh context): Playwright screenshots, axe, Lighthouse 13
  run directly, the impeccable detector, and the rubric on Anthropic's four criteria
  (design quality, originality, craft, functionality).
- **Done for the build** means worker-run gates for the deployed commit: build exit 0,
  Playwright waitlist flow, axe and Lighthouse thresholds at 390 and 1440, links, and a
  synthetic signup row found in the user's Supabase. An agent-written test report alone
  never counts. Vercel previews are read with the automation bypass header only on the
  project's own hosts.
- North's daily health check submits a test signup, because free Supabase projects
  pause after 7 idle days.
- Flow: brand kit, then directions, then the review pick, then the build (plus 3D), then
  the critique loop, then the K2 go-live card.

### 6.2 Research + Strategy (onboarding order in M8, the rest in M10)

- **M8 onboarding order** (VAL-1): `market_report`, `competitor_map`, `personas` as 3 ICP
  options, `assumption_map` (top 3 assumptions, each with a pre-registered metric and
  threshold), `interview_kit`. `prd`, `business_plan` and `investor_deck` run on request
  or when the plan reaches them.
- **M10 personas**: Market Analyst, Customer Discovery Lead, Experiment Designer,
  Positioning Strategist, Pricing Strategist, Product Lead, and a shared Red-Team Critic.
- **Interview evidence** (VAL-3) comes only from a calendar event id, an uploaded note or
  an email reply id; North never synthesises interviews from web content. The founder
  holds the calls; North books them, briefs before and synthesises after.
- **Gates** (VAL-2): a go/no-go decision is folded into the K2 card of the action that
  follows ("Interviews show X: launch the waitlist page to ICP Y?"), showing thresholds
  against actuals. It is one question with at most 3 options and an explicit "not yet"
  safe default, so the quota is unchanged.
- **Journey stage strip** on home: Validate, Build, Launch, First customers, with the
  current step's exit criteria, computed in `packages/core/src/plan/`.

### 6.3 Marketing (M11)

- Personas: Performance Marketer, Creative Director, Video Producer, Social Media
  Manager, YouTube Strategist, SEO Strategist, Marketing Critic.
- **Creative pipeline** (MKT-1): generate (Higgsfield on the user's account; Recraft or
  another resale-permitted provider for trials), copy to Storage immediately (Higgsfield
  keeps outputs about 7 days), critique, review pick, then upload to Meta. Campaign, ad set
  and ad are created PAUSED and a `/generatepreviews` preview goes on the K2 card;
  activation happens only on approval. Advantage+ AI features default to opt-out.
- **Video**: a `packages/video` of Remotion compositions sharing brand tokens, rendered by
  an Inngest function on the worker in 9:16, 1:1 and 16:9 with captions and safe zones,
  verified with ffprobe. Remotion is free while North has at most 3 people.
- **Channels and tiers** (MKT-3): TikTok uploads to drafts (K1) until the app audit;
  YouTube private or unlisted uploads (K1); anything new and public is K2; items on an
  approved calendar are K1. LinkedIn member posts and X pay-per-use posts.
- **Disclosure** (MKT-2): every channel's AI-content flag is set on every generated asset.
  AI-generated people stay off this phase.
- **Research**: vidIQ MCP on the free plan for outliers, keywords and titles (MKT-4);
  Search Console first and DataForSEO only after a funded deposit; SEO pages land as PRs
  (MKT-5).
- A monthly generation cap is approved once by a K2 card; generations inside it are K1.

### 6.4 Sales (CMP-1 in M7, the rest in M12)

- **M7 compliance** (CMP-1): a footer with sender name, company, postal address and a
  plain opt-out line; `List-Unsubscribe` with mailto and https plus
  `List-Unsubscribe-Post`; a worker `/u/{token}` endpoint that writes a suppression;
  bounces marked and suppressed; opt-out replies suppressed at once; `gate()` refuses
  suppressed addresses and companies without a postal address.
- **M12 personas**: Lead Researcher, Deliverability Guard (mostly code), SDR Copywriter,
  Sales Critic, Pipeline Manager.
- **Sources** (SLS-1): Apollo people search and enrich, Hunter, Exa company and news
  search, MillionVerifier, all on user-pasted keys. Apollo data never enters pgvector or
  any cross-tenant cache. North asks Apollo Partnerships to confirm the model before
  marketing it.
- **Deliverability** (SLS-2): DNS checks (SPF, DKIM, DMARC) at connect time and weekly;
  live first contact is refused without DMARC; verification no older than 30 days;
  per-inbox daily cap (default 20); send windows in the recipient's time zone; a
  stop-loss above 2% hard bounces or any complaint pauses sending (K1). Batch size grows
  5, 10, 20 with clean weeks.
- **Regions** (CMP-2): US, UK and Canada rule sets ship in M12. Gulf and EU countries open
  one at a time as their rule sets are encoded and tested. An unknown country is blocked;
  consent-only jurisdictions need recorded consent. Enabling a consent-only region is K3.
- **Sequences** (SLS-3): the first-contact card approves step 1 and up to two fixed-text
  follow-ups. Follow-ups run as K1 and are cancelled by any reply, bounce, opt-out or
  booking.
- **Pipeline** (SLS-4): internal `pipeline_events` plus a board; a signed Cal.com webhook
  moves a lead to `meeting` with the booking uid as evidence.
- **Gmail** keeps `gmail.send`; `gmail.readonly` is restricted, so a CASA assessment is
  planned before public launch.

### 6.5 Engineering beyond the landing page (later phase)

The personas from `dept-engineering.md` (Tech Lead, Backend, QA, Code & Security
Reviewer) and Anthropic's planner-builder-evaluator harness with `feature_list.json` and
`PROGRESS.md` in the user's repo are designed here but built only as far as M9 needs. The
full app is the next phase.

## 7. Founder journey

| Day | Founder sees | Agents do | Founder time | Cards | Review items |
| --- | --- | --- | --- | --- | --- |
| 0 | Onboarding: idea, questions, goal, budget, team, summary | Chief of Staff proposes the team | 10 min | 0 | team (inline) |
| 1 | Home, review | Market scan, competitors, 3 ICPs, assumption map, interview kit | 6 min | 1-2 (connect, interview outreach) | 3 |
| 2-6 | Home, review, chat with Research | Book and brief calls, synthesise; positioning and price; brand directions | calls + 5 min/day | 1 (domain) | 2-3/day |
| 7 | Gate card | Interview synthesis, site directions | 8 min | 1 (launch the waitlist page?) | 2 |
| 8-9 | Live view, preview with comments | Build, critique, revise | 5 min | 1 (go live) | 1-2 |
| 10-14 | Home, ledger | Network outreach, posts, ad test | 3 min/day | 1-2/day | 1-2/day |
| 15 | Gate card | Demand readout against thresholds | 3 min | 1 (open pre-orders on your Stripe?) | 0 |
| 16-30 | Home, chat with Sales | Personal emails to the waitlist, concierge onboarding, weekly plan | first customers | at most 1/day | at most 3/day |

Mobile first: home stays brief plus at most 3 cards, with the review line and stage strip
under them. Variants scroll in a carousel with the recommended one first. A long press
comments. Chat is a bottom sheet from any agent or artifact.

## 8. Testing and staging (TST-1..5, STG-1)

| Tier | Trigger | World | Model profile | Cap | Evidence |
| --- | --- | --- | --- | --- | --- |
| T0 unit | every commit | pure | none | $0 | CI log |
| T1 integration and replay E2E | every PR | local stack, sandbox adapters, MockRuntime or cassette replay | none | $0 | Playwright report |
| T2 real-Claude smoke | every PR push and merge | local stack in CI, sandbox | `smoke` (Haiku tier) | $0.50/run | `smoke-llm.json`: tokens, cost, schema and evidence checks |
| T3 nightly real E2E | cron, plus a biweekly `staging` profile run | staging, real Claude, fenced live test accounts | `smoke`; biweekly `staging` | $1/run, $3 biweekly | HTML report, traces, `summary.json`, judge scores; re-recorded cassettes by PR; an issue on red |
| T4 milestone live acceptance | manual dispatch, founder approves | staging, all fenced test accounts, real magic-link email, no North mocks | `production` | $10/run | `docs/evidence/M<n>/acceptance/<date>/`: run.json, mobile and desktop screenshots per step, judges.json, staging-check.json |

- **Model profiles** (TST-1): `production`, `staging` and `smoke` in
  `packages/core/src/models.ts` (the only home of model IDs); `resolveModel(alias,
  profile)` defaults to `production`, and the production check fails on any other
  profile. The tier models do not accept a non-default temperature, so tests assert
  structure, evidence and rubric scores, never exact text.
- **Test budget guard**: a pure guard in `packages/core/src/budget/test-run.ts`, enforced
  in the model gateway, backed by a dedicated Anthropic workspace with a $50 spend limit
  as the hard stop.
- **Cassettes**: the gateway records real runs (synthetic companies only, scrubbed,
  secret-scanned) and replays them in T1. `cassette:check` fails when the SDK's request
  shape drifts.
- **Test-account fence** (TST-5): with `NORTH_TEST_FENCE=1`, `gate()` blocks any external
  action whose target is not allow-listed: the Meta sandbox ad account, the GitHub test
  org, `e2e-` Vercel projects, test inboxes, `sk_test_` Stripe keys. It defaults to deny.
  Staging asserts it on; production asserts it off. A test never answers its own K2 card
  through a back door: acceptance uses a fresh company and the real card UI.
- **Staging** (STG-1): a Vercel `staging` environment in the Pro team, Supabase
  `north-staging`, a Fly `north-worker-staging` with auto-stop, an Inngest staging
  environment, a Langfuse project, and Resend SMTP for Supabase Auth (hosted Supabase's
  built-in mail is limited to team members). Runbook `docs/runbooks/staging.md`,
  `scripts/production-check.ts --env staging`.
- **The live journey spec**, `apps/web/e2e/live/journey.live.spec.ts`: sign up by magic
  link, idea, research, brand, site, campaign draft, kill switch within 5 seconds.
  Department milestones extend it with their own steps.
- **Eval harness**: `packages/evals` holds golden inputs per task type, starting with
  20-30 drawn from real failures. Batch-API judges run nightly, rubric and judge versions
  are pinned in `judges.json`, and scores go to Langfuse for founder calibration. A judge
  never marks a task done; Evidence does.
- Google OAuth apps in Testing status lose consent every 7 days, so staging Gmail and
  YouTube connections need a weekly refresh until the consent screen is published.

## 9. Budget (dev and test, monthly)

| Line | $/month |
| --- | --- |
| Claude: per-PR smoke (about 50 runs) | 5 |
| Claude: nightly staging runs plus 2 fidelity runs | 20 |
| Claude: 2 live acceptance runs | 14 |
| Claude: judges and founder exploration | 6 |
| Recraft trial key and the founder's Higgsfield credits for tests | 15 |
| Fly staging worker | 6 |
| GitHub Actions overage if the repository is private | 6 |
| Supabase, Inngest, Langfuse, Sentry, Resend free tiers | 0 |
| **Total** (Vercel Pro booked to production) | **72** |

Estimates from published prices: about $5.70-7.20 for a full design cycle and about
$4.50 for a landing build on the production profile. `agent_runs` measurements replace
the estimates from M7 on. A runaway loop is stopped by the per-run cap, the workflow cap,
the gateway's profile cap and the workspace limit, in that order.

## 10. Accounts and keys the founder provides

| Milestone | Items |
| --- | --- |
| M7 | Anthropic workspace `north-test` with a $50 limit and a key; Vercel Pro team with a staging environment, a token and an automation bypass secret; Supabase `north-staging` (URL, keys, DB password, access token); Fly app and deploy token; Inngest staging keys; Langfuse staging keys; Resend with a verified staging domain and SMTP credentials; Stripe sandbox key and webhook secret; a GitHub test org and a staging OAuth app; a Google Cloud OAuth client in Testing with the founder's test Gmail; a staging encryption key and VAPID pair; GitHub Environments `staging` and `acceptance` with the founder as required reviewer; the postal address and legal name for outreach |
| M9 | Recraft API key for trials; Supabase OAuth app for user connections; a test Supabase account for the waitlist target |
| M11 | Meta developer app (development mode), a sandbox ad account, an Instagram professional test account and Page; the founder's Higgsfield account; vidIQ free plan with a read-only key; YouTube Data and Search Console APIs on the Google project; TikTok developer app with sandbox accounts; LinkedIn "Share on LinkedIn" app; X pay-per-use credits; optionally a $50 DataForSEO deposit; a request to Higgsfield for trial resale approval |
| M12 | SPF, DKIM and DMARC on the sending domain; MillionVerifier; Apollo free plan key; Hunter free; Exa; Cal.com with a webhook; a question to Apollo Partnerships |

## 11. How we build (harness for our own work)

- Each milestone starts with `docs/plans/M<n>.md` (scope, file-level tasks per dev
  persona, acceptance test), `docs/plans/M<n>.features.json` (one entry per acceptance
  step with a `passes` flag that only a passing test flips; tests are never edited to
  pass), and `docs/plans/M<n>.progress.md`, a running log that survives context resets.
- TDD: the failing Vitest or Playwright test first, with the requirement ID in its name.
- `north-architect` decomposes, the owning personas build, `north-security-reviewer`
  reviews before each milestone commit, `north-qa-validator` runs `pnpm validate`, the
  staging walkthrough and T4.
- A milestone is done only when T4 passes on staging, the evidence is committed and the
  founder has logged in and walked the same path.
- Every change keeps the non-negotiables. The review queue, chat and studio loop add no
  path around `gate()`, Evidence, the quota or the kill switch, and tests prove it.

## 12. New requirement IDs

These join `docs/SPEC.md` as a "Faz 2" table in M7 and are used in commits and test names.

| ID | Requirement | Milestone |
| --- | --- | --- |
| SEC-1 | Agent shell commands run sandboxed; no agent process holds the model key | M7 |
| SEC-2 | No agent configuration, memory or session is shared between companies | M7 |
| CMP-1 | Every first-contact email carries the footer, postal address and List-Unsubscribe; suppressions are honoured by `gate()` | M7 |
| CMP-2 | Email goes only to regions whose rule set is encoded and tested; consent-only jurisdictions need recorded consent | M12 |
| TST-1 | Model profiles and a test budget guard; the production check rejects non-production profiles | M7 |
| TST-2 | Real-Claude smoke on every PR within its cap | M7 |
| TST-3 | Nightly real journey on staging | M7 |
| TST-4 | Milestone live acceptance with founder approval and committed evidence | M7 |
| TST-5 | The test-account fence in `gate()` | M7 |
| STG-1 | A staging environment the founder logs into | M7 |
| SKL-1 | Vendored skills with a lock file and licence and hash checks in `pnpm validate` | M8 |
| SKL-2 | Each persona mounts only its own skills; loaded and invoked skills are visible | M8 |
| TEAM-1 | The team proposal at onboarding, from the vetted catalog | M8 |
| TEAM-2 | A per-department review dial | M8 |
| LOOP-1 | Draft, separate critic, revise; hard gates decided by code; at most 2 revisions | M8 |
| LOOP-2 | 2-3 variants by fork, ranked before the founder picks | M8 |
| REV-1 | The review queue, separate from the decision quota, with its budget and 24-hour default | M8 |
| REV-2 | Anchored comments produce one revision with a diff and revert | M8 |
| LIVE-1 | The live work view from append-only run events | M8 |
| CHAT-2 | 1:1 chat with any persona; "Add to context" writes memory with provenance | M8 |
| VAL-1 | Validation-first onboarding tasks | M8 |
| VAL-2 | Gate context on the next K2 card | M10 |
| VAL-3 | Interview evidence only from real sources | M10 |
| DSN-1 | The brand kit as verified files | M9 |
| DSN-2 | 2-3 site directions with screenshots | M9 |
| DSN-3 | 3D and motion with poster fallback and performance gates | M9 |
| WEB-1 | Landing page and waitlist in the user's repo, Vercel and Supabase, verified by worker-run gates | M9 |
| MCP-1 | Vendor MCP servers expose read-only tools to agents; writes run in the worker after `gate()` | M11 |
| MKT-1 | The creative pipeline with paused-first Meta campaigns | M11 |
| MKT-2 | AI disclosure flags on every generated asset | M11 |
| MKT-3 | Channel tiers: drafts and private uploads K1, new public posts K2 | M11 |
| MKT-4 | YouTube research through vidIQ | M11 |
| MKT-5 | SEO briefs and pages as pull requests | M11 |
| SLS-1 | Licensed lead providers on user keys behind North tools | M12 |
| SLS-2 | Verification and the deliverability guard | M12 |
| SLS-3 | Sequences approved per batch; follow-ups K1 and auto-cancelled | M12 |
| SLS-4 | Pipeline events and Cal.com bookings | M12 |

## 13. Glossary additions (`CONTEXT.md`)

Persona, Department, Review Dial, Skill, Skill Lock, Studio Loop, Variant, Critique,
Rubric, Hard Gate, Review Item, Review Queue, Review Budget, Comment, Run Event, Agent
Thread, Model Profile, Model Gateway, Cassette, Test Fence, Gate Context, Suppression,
Journey Stage.

## 14. ADRs to write

0017 staging topology and the test-account fence; 0018 vendored skills and per-persona
mounting; 0019 the model gateway and sandboxed agent execution; 0020 the review queue
outside the decision quota; 0021 validation-first onboarding (changes M1's acceptance);
0022 vendor MCP servers as read-only agent tools; 0023 user-pasted API keys.

## 15. Out of scope this phase

The full app beyond the landing page and waitlist; the "grow an existing business" and
"hire one department" user types; moving agent runs to Claude Managed Agents (a spike
behind `AgentRuntime` may follow M9); Apollo partner OAuth; TikTok Ads; LinkedIn company
pages; AI-generated people; GSAP; LinkedIn automation of any kind.

## 16. Risks

- **Spend runaway.** Mitigated by four nested caps and the workspace limit.
- **Lenient critics.** Hard gates decide, the founder calibrates the examples, and Design
  defaults to Review drafts.
- **Skill supply chain.** Mitigated by the lock, the scan, the monthly reviewed bump and
  the with-and-without eval.
- **Review fatigue moving from cards to the review queue.** The review budget and
  defaults are part of the design, not polish.
- **Vendor terms and churn.** Higgsfield resale, Apollo's "on behalf of" clause, Meta's
  version cadence and X's pricing; adapters are pinned to documented versions.
- **Remote sandbox bridging is unproven.** A spike gates the move; the SDK sandbox
  covers M7-M8.
- **Founder-held access.** Weekly Google re-consent and 2FA on test accounts.
- **Interview reluctance.** A founder who skips calls weakens the evidence; North says so
  on the gate card and offers a labelled survey fallback.

## 17. Open items (non-blocking)

Whether the repository is private (Actions minutes); whether the founder has Google
Workspace (an Internal OAuth app may avoid the 7-day expiry); which identity owns the
test accounts; whether golden cassettes may be committed; the Gulf rule sets, researched
in M12; a trademark screen before the go-live card.
