# Debate 4: Scale and executability review of the round-1 notes

Reviewer persona: platform engineer running this for thousands of founders, and the planner
agent that must execute the blueprint in a fresh session with no memory of this research.
Read: `01-research-protocol.md`; `CLAUDE.md`; `docs/plans/M7.md`, `M7.features.json`,
`M7.progress.md`; `docs/adr/0012-signals-become-cards-through-the-gate.md`; the eight notes
`notes/RQ1-*.md` to `notes/RQ8-*.md`. Date: 2026-10-17.

Method: five founder ideas walked through every proposed artifact (section 1); every
artifact and rule tested for mechanical followability and for conflicts (section 2);
continuity over 50 sessions (section 3); fleet concerns (section 4); a widening procedure
the notes do not supply (section 5); verdicts (section 6); the gap list (section 7).

Summary verdict: the round-1 notes contain the right ingredients, but as a set they are not
executable. Three vocabularies for "how hard is this product" (RQ1 class, RQ3 matrix row,
T1-T4) and three for "how proven is this feature" (RQ2 `proof.kind`, RQ5 E0-E4, RQ5 G0-G9)
are never joined; two artifacts claim to be the source of truth for status; the "universal"
invariant core applies North's own runtime rules to the founder's product; nothing addresses
more than one build at a time; and no note gives a procedure for parallel widening after
the skeleton. Each is fixable with a schema or a table, listed in section 7.

---

## 1. Generality test: five ideas through the proposed pipeline

Legend: OK = the proposal gives a usable answer; NA = no answer; WRONG = an answer that is
wrong or contradicts another note; LP = an answer that fits only the landing page.

| Stage (note, section) | (1) Landing page + waitlist | (2) Salon booking + payments | (3) B2B SaaS, teams, roles, Stripe billing | (4) Real-time whiteboard | (5) Marketplace, payouts, disputes |
| --- | --- | --- | --- | --- | --- |
| Intake questions (RQ1 "Design proposals" 1) | OK; Q4-Q7 skipped when Q3 = weekend | OK, but Q6 misfires (see 1.2) | OK; Q4 catches tenancy | OK; Q7 catches real-time | OK for Q5/Q6; answers fan out into 4+ forks the set never asks (fee model, escrow, refund, payout timing) |
| Classifier (RQ1 "Design proposals" 3) | OK after fixing undefined `waitlist-only` | WRONG: `crud_saas`, payments has no effect on class or tier | OK: `multi_tenant` | OK: `crud_saas` + `realtime` flag, but no precedence rule when a flag meets a row | OK: `marketplace` + `regulated` |
| Decision matrix row (RQ3 "Synthesis deliverables" 2) | OK: "Static / landing" row | NA: no row for "single-tenant app that charges cards"; closest are "CRUD SaaS" (T2) and "Payments / regulated" (T4) | NA: no `multi_tenant` row; "CRUD SaaS" row has no tenancy isolation or role matrix | OK row exists; conflicts with classifier (row vs flag) | WRONG: "Marketplace" row says T3, "Payments" row says T4; flags "raise the tier" with no arithmetic |
| Plan format (RQ2 KQ8 2) | OK | OK | Partial: `steps` have no actor/tenant notion for two-org isolation proofs | Partial: Gherkin steps need a two-browser template | OK but 60-feature cap per milestone and the 400-line rule collide (2.3) |
| Team topology (RQ7 KQ7 1; RQ3 matrix) | WRONG: RQ3 says "no planner round beyond intake"; RQ4 decision tree node 2 forbids any write before a planner-written machine-checkable spec | OK: planner + builder + evaluator | OK, plus reviewer | NA: RQ3 names a "dedicated runtime engineer" that exists in no role set | OK: adds security reviewer, but two rows disagree on whether T3 or T4 |
| Build order (RQ3 "Synthesis deliverables" 3) | OK | OK; spine = book a slot and pay in Stripe test mode | OK; spine = sign up, create org, invite, see row | LP: step 3 "preview deployment per branch" assumes one deployable; a WebSocket service needs a second preview per branch (Vercel cannot host it) | OK; spine named in the matrix row |
| Gate sequence (RQ5 "Verification regime" 3) | LP in reverse: G4 mutation score and G5 transcript audit on a static page are cost without risk; no per-class scaling exists in RQ5 | OK | Partial: no cross-tenant probe; RQ8 "never do" 9 only says probe as unauthenticated | WRONG: E2 "DB row read back", G6 "smoke HTTP with body assertions" assume request/response; CRDT ops over a socket produce neither | OK, cost unbounded (G7 per feature at T4) |
| Founder stall points | Q1 only | Stripe test keys (fine), Google Calendar OAuth consent (Q8 integration) | Stripe test keys; one card for the role model (RQ1 open Q3 admits the line is unsettled) | None beyond Q1 | Card storm: 4-8 architectural forks at 3 cards a day with a slow founder is a week of idle agents |

### 1.1 Where the pipeline gives no answer

- **No join between class and everything downstream.** RQ1 emits `static | landing+waitlist |
  crud_saas | multi_tenant | marketplace` plus flags `realtime | ai_heavy | regulated` (RQ1
  "Complexity-class classifier sketch"). RQ3's matrix has seven rows: static, CRUD SaaS,
  marketplace, real-time, data pipeline, AI-agent product, payments/regulated (RQ3 "(2)
  Methodology decision matrix"). `multi_tenant` has no row; `data pipeline` has no class;
  `realtime` is a flag in RQ1 and a row in RQ3; `payments` is a row in RQ3 and absent from
  RQ1 (only `payouts` sets `regulated`). The tiers T1-T4 named in both notes and in the
  protocol are defined nowhere: RQ5 defines E0-E4 and G0-G9 and never mentions T-levels. A
  planner agent holding all three notes cannot compute which gates idea (2) must pass.
- **No precedence rule.** Idea (4) is `crud_saas` + `realtime`; idea (5) is `marketplace` +
  `regulated`. RQ1 says flags "add checklist modules" and "raise the verification tier"; RQ3
  gives each flag its own row with its own tier. Neither says max(), sum, or "row wins".
- **No cost or card budget per class.** RQ4 Q7 gives multipliers (4x, 15x, 22x) but no
  per-class budget; the protocol fixes $8 per founder journey (section 6). A marketplace at
  T4 with G7 per feature and a security reviewer does not fit $8, and no note says what the
  founder is told or charged when the class exceeds the budget. RQ2's PRD template section
  10 checks that expected cards are "≤ the daily quota headroom" but gives no action when a
  class needs 12 cards.

### 1.2 Where it gives a wrong answer

- **Payments without payouts is invisible.** Idea (2) charges real cards. RQ1's classifier
  computes `payments = Q5 != none` and then never uses it: class is `crud_saas`, no flag is
  set (`regulated = regulated || payouts`), so the salon tool gets T2, no security reviewer,
  no property tests on money, no kill-switch test, while RQ3's "Payments / regulated /
  money-moving" row demands T4 for exactly this. The classifier must set a `payments` flag
  and the join table must map it to at least the payments row's testing column.
- **Q6 misfires on service businesses.** "Two different kinds of people who need to find each
  other" is answered "yes" by a salon founder (clients and stylists) although no matching
  exists. The decision it drives ("doubles the skeleton", RQ1 Q6 row) is then wrong. The
  question needs the discriminator the classifier actually uses: do both populations sign up
  by themselves and transact with each other without the founder in the loop.
- **Landing page gets no planner, but no writes are allowed without a planner.** RQ3 matrix
  row 1: "Builder + evaluator; no planner round beyond intake". RQ4 Deliverable 2 node 2:
  if the spec is not machine-checkable, "run the planner alone first ... Never fan out
  writers before the implicit decisions are explicit". Someone must still write
  `features.json` for the landing page. The fix is cheap (the intake step emits a one-slice
  feature list from a template) but must be stated.
- **The invariant core applies North's runtime to the founder's product.** RQ3 "(1) Proposed
  universal invariant core" marks I6 "Every outside-world action passes
  `AuthorityEngine.gate()`" and I7 "Append-only audit tables; never update/delete `actions`,
  `ledger_entries`" with ◆ as CLAUDE.md constraints and lists them as universal for the
  product. `AuthorityEngine.gate()` governs what North's agents do (deploy, push, send). A
  salon booking app has no `AuthorityEngine`; a landing page has no `ledger_entries`. The
  blueprint must split the rules into (a) rules on the agents' actions, which are North's and
  always on, and (b) rules on the generated codebase, which are per class. Today's notes mix
  them in one table, and a planner following RQ3 literally will scaffold an authority engine
  into a waitlist form.

### 1.3 Where it fits only the landing page

- RQ3 skeleton step 3 "preview deployment per branch" and RQ5 G6 "Deploy preview; worker
  confirms `deploy_id` READY" assume one Vercel deployable. Ideas (4) and (5) need a worker or
  socket service (Fly) and provider webhooks (Stripe) reaching a per-branch URL. No note
  gives an infrastructure template per class (what is deployed where, how a preview gets a
  stable public URL for webhooks, how two deployables are pinned to one `commit_sha` in the
  evidence row).
- RQ5's evidence ladder E2 ("HTTP response ... DB row read back") is the right shape for ideas
  (1)-(3) and the wrong shape for (4). Real-time needs an evidence kind "two sessions observed
  the same state within N ms" with a trace from both browsers; nothing in RQ5 produces it.

---

## 2. Executability test: can a fresh planner follow this mechanically?

Scale: M = mechanical (inputs, outputs, stop condition, path or schema given); J = needs
judgment the note has not encoded; S = needs a schema, template or checklist before use.

### 2.1 Artifact by artifact

| Artifact or rule (note, section) | Rating | What is missing |
| --- | --- | --- |
| Ordered question set, 10 rows (RQ1 "Design proposals" 1) | M for wording; S for output | No schema for the Assumptions table ("default, trigger that would reopen it"); the "ten Spec Kit categories" of the coverage map are not listed in the note; no file path for the intake record ("stored with the spec" is not a path) |
| Stop rule (RQ1 "Design proposals" 2) | J | Rule 2 ("would not change the first vertical slice, the data-model root, the payment path or the verification tier") is a judgment call with no procedure; rules 1, 3, 4 are mechanical |
| Classifier (RQ1 "Design proposals" 3) | S | Undefined terms: `waitlist-only` is not a Q5 answer; `appetite<=weeks` presumes an order on strings; `ai_core` "from Q0 restatement" is judgment; `payments` computed and unused |
| Artifact set, 11 rows (RQ2 KQ8 1) | M | Best-specified deliverable in round 1: size bounds, owner, script check per row. Two defects below (2.2, 2.3) |
| Feature-list JSON (RQ2 KQ8 2) | S | Given as JSONC prose, not a Zod schema; `parallel_safe` "touches files disjoint from other unbuilt features" cannot be computed because no field declares the feature's write set; `attempts` has no writer named; `blocked_on` has no deadline or default |
| PRD / design-doc template (RQ2 KQ8 3) | M for structure | Each MC item needs the regex or script named; "cost figures present and under cap" needs the cap per class (1.1) |
| Trace-check script (RQ2 KQ8 1, row 10) | M | None; this is the one artifact that would make the rest enforceable |
| Invariant core I1-I13 (RQ3 "(1)") | M for I1-I5, I8, I10, I12; J for I9, I13; WRONG for I6, I7 scope (1.2) | Lint configs are named by rule, not by file; a `.eslintrc` template per class is needed |
| Decision matrix (RQ3 "(2)") | J | Row choice is unaided; "Google 80/15/5 ratio", "property tests on money/state machines", "chaos test for reconnect" are not checklists |
| Walking-skeleton steps 1-12 (RQ3 "(3)") | M except step 2 (J) and step 3 (S) | Step 2 "pick the spine path" needs the rule "the P1 journey from Q2, extended to the first `gate()`-ed external effect"; step 3 needs the infrastructure template per class |
| Decision tree, 7 nodes (RQ4 Deliverable 2) | M except nodes 3 and 4 | Node 3 needs declared write sets; node 4 "wall-clock matters more than dollars" needs a per-plan knob with a default (default: dollars) |
| Context strategy table (RQ4 Deliverable 3) | S | Progress log "`claude-progress.txt` or DB row per run": the "or" must be resolved (section 3); FixBrief missing from the table although RQ7 makes it the only way a fresh builder learns why it failed |
| Evidence ladder E0-E4 (RQ5 1) | M | Row schema is given in prose (`producer`, `commit_sha`, ...); needs Zod and a storage path |
| Mock policy (RQ5 2) | M for allowed list; S for forbidden list | "mocking ... any in-repo module" is lint-able (`vi.mock` target allowlist); "asserts only shape" is lint-able; neither rule is written |
| Gates G0-G9 (RQ5 3) | S | G4 "mutation score ≥ floor" with no floor; G5 "assertion-density check" with no threshold; G0 forbids editing `**/*.acceptance.*` without defining that path convention anywhere else |
| Anti-gaming controls 1-10 (RQ5 4) | M for 2, 4, 6, 9; J for 7, 8 | Control 1 (evaluator-written hidden acceptance tests) conflicts with CLAUDE.md TDD (2.2) |
| Failure-mode table (RQ6 "(1)") | informative | No artifact; the mitigations column is the raw material for the gate table and should be cited there |
| Role set (RQ7 KQ7 1) | S | "its owned paths only (OWNERS)" needs an OWNERS format; "platform-fixed rubric and budget per complexity class" needs the table that 1.1 says is missing |
| Workflow handoffs (RQ7 KQ7 2) | S | Six file kinds (`BuildPlan.json`, `TaskBrief_n.md`, `SelfReport_n.md`, `TestReport_n.json`, `ReviewReport_n.json`, `FixBrief_n.md`, `Postmortem_n.md`) with "a Zod schema and a SHA" each, none given, no path |
| Escalation ladder (RQ7 KQ7 3) | M for levels 0-2; J for level 3 | The "architectural line" has a proposed four-part test (RQ7 open Q5) that should become a checklist |
| Copy / never lists (RQ8) | advice | Copy 2 (builder confidence score routes cards) is self-grading, which RQ8 open Q4 itself notes |

### 2.2 Rules that conflict with each other or with CLAUDE.md

1. **Who writes `features.json` status.** RQ2 schema: builder sets `status.build`, evaluator
   sets `status.verification`. RQ4 Deliverable 3: "Planner creates; evaluator flips `passes`;
   builder never edits". RQ5 "Ordered gates": "`done` is set by the worker when G1-G7
   Evidence exists ... the builder has no code path to set it". Three writers for one field.
   RQ5 is the one consistent with CLAUDE.md rule 2 and with SLSA (RQ5 KQ4 inference:
   provenance from the platform). Resolution proposed in section 3.
2. **Retry counts.** RQ2 schema `attempts`: "AGT-3 caps at 2 before escalation". RQ4 node 7:
   "fails its gate twice ... start a fresh session". RQ7 workflow: "R<=3 same builder; R>=4
   fresh builder / stronger model; R=5 breaker trips". RQ8 copy 11: "two attempts then
   escalate". A fresh planner finds 2, 3 and 5. One state machine is needed.
3. **TDD versus hidden acceptance tests.** CLAUDE.md: "write the failing test first". RQ3 I11:
   "The first test of every feature is end-to-end against real infrastructure". RQ5
   anti-gaming 1: acceptance tests are "written from the spec by the evaluator before
   implementation and stored outside the builder's checkout; the builder never sees them".
   The builder cannot run a first failing test it is not allowed to see. Resolution: the
   builder writes and sees unit and integration tests and the Gherkin `steps` in
   `features.json`; the evaluator owns the Playwright implementation of those steps, stored
   outside the repo (3.3). RQ3 open Q3 asks this question; no note answers it.
4. **The 400-line rule versus the feature list.** CLAUDE.md: files under 400 lines. RQ2 bounds
   `features.json` at 60 features; the schema in RQ2 KQ8 2 is about 25 lines per feature, so
   the file passes 400 lines at 16 features. Either data files are exempt (say so in
   CLAUDE.md) or the file is split per slice (`docs/plans/<slice>.features.json`). RQ2 KQ0
   already shows M7.md at 593 lines breaking the same rule.
5. **Zod at every boundary versus no schemas.** Every note says its artifact is "Zod-validated";
   none supplies a schema. For an agent, a JSONC comment block is not a boundary check.
6. **LLM-written always-on files.** RQ2 KQ4 cites the ETH finding that LLM-generated context
   files cost +20% for no gain; RQ2 artifact 1 and 2 then have the architect persona (an LLM)
   write `CLAUDE.md` and `.claude/rules/*.md` for each founder repo. For the fleet these must
   be templates filled from the intake record, not generated prose (RQ2 open Q4).
7. **Evidence is not read by the next builder.** RQ4 Deliverable 3 evidence row: "Read by
   evaluator and review queue, not by builder's next session". RQ4 rule 1: "everything a later
   session needs is in the plan, progress log, evidence and git". RQ7 adds `FixBrief_n.md` as
   the carrier. The three statements are reconcilable only if the FixBrief is a derived
   projection of the evidence row; nobody says so.
8. **Evaluator budget.** RQ7 correction 2 wants the evaluator's budget and rubric as "platform
   constants per complexity class"; RQ3's matrix is the only place class-to-tier lives and it
   has no budget column.

### 2.3 Rules that need a schema, checklist or template before an agent can use them

Listed once, in section 7, ordered by how often an agent will hit them.

---

## 3. Multi-session continuity: 50 sessions, three weeks, a slow founder

### 3.1 What must persist

| State | Proposed home in the notes | Problem at 50 sessions |
| --- | --- | --- |
| Intake answers, class, flags, assumptions with reopen triggers | "stored with the spec" (RQ1 classifier) | No path, no schema; a reopened assumption has no link to the features built on it |
| Requirements and hashes | `docs/SPEC.md` + `requirement_hash` (RQ2) | Covers spec edits; does not cover assumption flips, which are the common change when a founder answers late |
| Feature status, deps, attempts, blockers | `features.json` (RQ2, RQ4) and evidence rows (RQ5) | Two sources of truth (2.2 item 1) |
| Progress log | `docs/plans/<M>.progress.md` newest-first, "one entry per session" (RQ2 artifact 9) | No size bound. `M7.progress.md` is 12 KB after 7 entries of 1-3 KB each; 50 sessions is 60-100 KB read at every session start, which is the context-rot failure RQ6 KQ2 documents |
| Evidence files | `docs/evidence/<M>/` + append-only rows + Storage (RQ2, RQ5) | Fine; needs the path convention fixed |
| Pending decision cards, deadlines, defaults | `blocked_on: <card id>` (RQ2) | No `default_applies_at`, no default value, no writer that applies the default; RQ1 KQ6 promises "a deadline after which the default applies" and no artifact implements it |
| Evaluator's hidden acceptance suite | "outside the builder's checkout" (RQ5 anti-gaming 1) | No location; must survive three weeks and regenerate when `steps` change |
| Branch and worktree map, preview URLs, deploy ids | git (RQ4) | Stale worktrees from crashed sessions have no owner; RQ4 Q1 only covers subagent worktrees removed "when it finishes without changes" |
| Open FixBriefs, ReviewReports | files (RQ7) | No path; unclear whether they live in the founder's repo (they should not: process files in a customer's codebase) |
| Cost per feature | `verified_at.cost_usd` (RQ2); ledger | Fine |
| Lessons | postmortem action item "edits a checklist or gate" (RQ7) | Scope problem, section 4 |

### 3.2 Attack on RQ2 and RQ4

- RQ2's artifact 9 is the only artifact without a size bound and it is the one that grows
  linearly with sessions. RQ4 Deliverable 3 loads it at every session start. Together they
  recreate the 77 KB plan problem RQ2 KQ0 criticises, three weeks later.
- RQ4 rule 1 says fresh context per feature; RQ4 Deliverable 3 says the progress log is
  loaded at every session; RQ6 KQ2 says focused prompts beat long ones. The notes never state
  a byte budget for the session-start read set. Without one, "fresh context" degrades into
  "fresh context plus 100 KB of history".
- Neither note states what the dispatcher passes to a builder session versus what the
  builder reads itself. RQ2 artifact 8 ("read per session, never whole-milestone") is the
  right instinct and applies only to task cards.
- RQ4's "resume a transcript only to recover an interrupted run" is right, but there is no
  rule for what "interrupted" means (worker crash versus budget stop versus kill switch) or
  how the next session learns which of the three happened.

### 3.3 Proposed recovery design (for round 3)

1. **One source of truth.** Evidence rows and `agent_runs` in the database are canonical for
   status, attempts, cost and blockers. `features.json` is a projection the worker regenerates
   after every run and commits; no role edits it by hand. This resolves 2.2 item 1 and gives
   the trace-check a single thing to verify. The planner still authors the rows' `statement`,
   `steps`, `depends_on`, `writes`; those fields are planner-owned and hash-protected.
2. **Progress log with a bounded head.** `progress.md` = a `## Now` head rewritten each
   session (≤40 lines: next feature, open blockers with card ids and deadlines, environment
   facts such as preview URLs and provider account ids, last three verified features) plus an
   append-only `## Log` tail that no session reads unless it needs history for a named
   feature. The head is the only part in the session-start read set.
3. **Session-start read set, fixed order and byte budget.** `CLAUDE.md` (≤8 KB), the `## Now`
   head (≤3 KB), the one `features.json` row plus its `depends_on` rows (≤2 KB), the task card
   (≤120 lines), the latest FixBrief for this feature if any (≤2 KB), `git log -20
   --oneline`. Target ≤20 KB before the builder opens a source file. The dispatcher assembles
   this; the builder does not browse `docs/`.
4. **Decision cards carry defaults.** `blocked_on: { card, default, default_applies_at }`;
   the worker applies the default at the deadline, writes the assumption row, and marks
   every feature listing that assumption id `freshness: suspect`. Features gain
   `assumptions: [id]` so a late answer that flips a default has a computable blast radius
   (RQ2 `requirement_hash` does this for SPEC rows only).
5. **Hidden acceptance suite location.** North Storage, keyed by company, feature id and
   sha256 of the feature's `steps`; regenerated by the evaluator when the hash changes;
   never checked into the founder's repo.
6. **Process files out of the product repo.** TaskBrief, SelfReport, TestReport, ReviewReport,
   FixBrief, Postmortem are rows (or Storage objects) with Zod schemas, referenced from
   `agent_runs`; the founder's repo holds only `CLAUDE.md`, rules, SPEC, ADRs, design docs,
   `features.json`, `progress.md` and evidence pointers.
7. **Interruption kinds.** `agent_runs.ended_reason ∈ {completed, budget, kill_switch, crash,
   timeout, decision_wait}`; only `crash` and `timeout` permit transcript resume; the others
   start fresh from artifacts (RQ4 node 7 generalised).

---

## 4. Fleet concerns: thousands of concurrent builds

What the notes say: RQ4 Deliverable 3 disables auto memory per tenant; RQ5 KQ4 applies the
SLSA rule that tenant-set fields are untrusted; the studio spec already fixes per-company
`CLAUDE_CONFIG_DIR` and `HOME` (M7 Task 9 and 12, `M7.progress.md` 2026-10-16 entries).
Everything else below is absent from all eight notes.

1. **Isolation per company.** Repo ownership (founder's GitHub account versus a North org),
   one Vercel project per company, one Supabase project or one schema per company for the
   product's own database, provider test accounts per company: none is discussed. RQ3's
   skeleton step 3 says "create the repo, CI, preview deployment" as if it were free and
   singular. A thousand companies × preview deploy per branch × features is a Vercel bill
   and a quota problem the blueprint must own.
2. **Sandbox cost.** M7 runs the SDK in-process sandbox; the per-task VM is M9. RQ5's "sealed
   environment" (anti-gaming 3) presumes a VM per builder run with egress proxy. At fleet
   scale that is the dominant compute cost after model tokens; no note estimates it or
   scales it by class (a landing page does not need a sealed VM).
3. **Queueing and fairness.** Inngest concurrency keys per company, a global ceiling against
   the Anthropic workspace rate limit (tokens per minute), and a fairness rule so one
   marketplace build does not starve fifty landing pages: unmentioned. RQ4 Q1 lists SDK
   concurrency defaults (20 subagents) as if one process were the whole fleet.
4. **Rate limits and retries.** 429 and 529 handling, backoff, and what a builder session does
   when the gateway refuses (M7 Task 11 answers 402 at the cap) are platform behaviour the
   blueprint must specify for the planner's "two attempts then escalate" rule, otherwise a
   rate-limit refusal counts as a failed attempt.
5. **Prompt caching across tenants.** RQ4 Q7 covers forks and `effort` invalidation. For a fleet
   the design rule is: a fleet-wide static prefix (system prompt, role skills, the CLAUDE.md
   template) first; tenant-specific content (intake record, feature row, task card) last;
   never a per-company edit to the prefix. Per-company `CLAUDE.md` prose written by an
   architect persona (RQ2 artifact 1) breaks the shared prefix and costs full input price on
   every session of every company. Templates fix both this and 2.2 item 6.
6. **Model profile tiers.** M7 Task 1 defines `production | staging | smoke` for North's own
   testing. The fleet needs a second axis: role × class (planner on the top tier for
   `marketplace`, Sonnet for `landing`; evaluator effort by tier). RQ3's matrix hints at it in
   the "team shape" column; no table exists.
7. **Nightly evaluation at scale.** RQ5 G8 re-runs "all done features on staging" nightly; RQ3
   step 11 runs the skeleton test nightly. For a thousand companies that is a thousand
   Playwright suites a night against a thousand previews. Needed: deterministic-only nightly
   (no model), run only for companies with a commit or a dependency bump in the last seven
   days, full sweep weekly, budget per company, and a regression triage rule (who opens the
   FixBrief, does it count against the founder's budget).
8. **Lesson learning without leakage.** RQ7's postmortem "action item that edits a checklist or
   gate" has no scope. If the checklist is platform-wide, a tenant postmortem edits a shared
   artifact and may carry tenant facts (domain, provider ids, founder decisions). Two tiers:
   company lessons (stored with the company, loaded only for it) and platform lessons
   (counts and patterns only, curated by North, with the three-company minimum the studio
   spec already requires for pooled data). RQ4 open Q6's evaluator calibration against
   founder labels is cross-tenant pooling and needs the same rule.
9. **Shared provider sandboxes.** RQ5's mock policy allows fakes only with a nightly contract
   test "against the sandbox account". Whose account? If North's, a thousand tenants share one
   Stripe test mode and one Meta sandbox with their rate limits; if the founder's, the
   contract test needs the founder's consent and runs a thousand times. Decide per provider.
10. **Kill switch scope.** CLAUDE.md rule 7 is per company. In-flight builder sessions, their
    worktrees and preview deploys must be stopped and labelled within 5 seconds; a fleet-wide
    stop (model incident, cost runaway) is a separate control. Neither appears in RQ4 or RQ7.

---

## 5. Horizontal widening: a procedure the notes do not give

RQ3 step 8 says "widen slice by slice ... in a fresh-context session"; RQ4 node 4 says
"parallel writers with isolation ... one integrator session merges in a fixed order"; RQ7
correction 3 says "parallelism allowed only across disjoint branches that merge through
Release". None says how to partition, how to detect disjointness, how migrations are
handled, or what happens on a conflict or a regression. Draft:

**Preconditions.** Skeleton verified (E2 and E3 rows exist). `features.json` rows carry
`depends_on`, `slice` and a new `writes: [glob]` field. A module map
`docs/design/modules.json` lists `{ module, paths: [glob], owner }` and a `shared` set of
globs that no parallel feature may touch: migrations, generated DB types, the route table,
shared Zod schema packages, `package.json` and the lockfile, `CONTEXT.md`, `CLAUDE.md`,
`features.json`.

1. **Partition into waves (worker, deterministic).** Candidates = features with all
   `depends_on` verified and `freshness: current`. A wave is a maximal set of candidates whose
   `writes` are pairwise disjoint and disjoint from `shared`. Features touching `shared` are
   serial features; one runs alone between waves. Wave size ≤ min(5, remaining budget ÷ mean
   cost per feature of this class). Order inside a wave by feature id.
2. **Schema first.** If any wave feature needs a migration, the planner splits it: a serial
   feature `<id>-schema` (migration, generated types, Zod) runs first; the parallel feature
   depends on it. Builders in a wave never write migrations. This removes the most common
   conflict source before it happens.
3. **One builder per feature.** Branch `feat/<id>` from the current `main` tip, own worktree,
   fresh session, the read set of 3.3 item 3. The builder commits only within `writes`; a
   `PreToolUse` hook denies edits outside them (RQ7 "owned paths" made deterministic). Branch
   CI runs G1-G5; a branch preview is deployed; E2 rows are captured for the branch.
4. **Integrate (worker, deterministic, no model).** Merge wave branches onto `integration` in
   id order with `--no-ff`; after each merge run G1-G3. On a conflict: stop, mark that feature
   `blocked_on: integration`, open a FixBrief ("rebase onto `<sha>`, re-run gates") for a
   fresh builder session; never let the integrator resolve conflicts with a model. On a G1-G3
   failure after a clean merge: revert that merge commit, same FixBrief.
5. **Evaluate once per wave.** Deploy the `integration` preview; the evaluator runs the hidden
   suites of all wave features plus the full suite of every previously verified feature
   (regression, DV5). E3 rows are written against the integration `commit_sha`. This is
   Anthropic's V2 shape (RQ7 KQ4 inferences) and halves the evaluator cost of per-branch
   evaluation. Done is only ever set from integration evidence.
6. **Regression triage.** If a previously verified feature fails, revert wave merges in reverse
   id order, re-running only the failed suite each time, until it passes; the last reverted
   feature is the culprit and gets the FixBrief with the failing feature id. Deterministic
   bisection, no model.
7. **Promote.** Fast-forward `main` to `integration`; regenerate `features.json`; rewrite the
   progress head; release gates (RQ7 Release worker) decide whether a K2 card is due.
8. **Consolidation pass.** RQ3 step 9 (extract on the third occurrence) is a serial feature
   scheduled by the planner after a wave, never inside one.

Costs: parallelism adds one full builder context per feature plus the integration gates;
evaluation stays at one pass per wave. The default for every class is wave size 1 (sequential)
unless the plan sets `parallel: true` and the class budget allows it (RQ4 node 4's knob with
dollars as the default).

---

## 6. Verdicts from the scale and executability view

| Hyp. | Verdict | One line |
| --- | --- | --- |
| H1 | Supported, narrowed | Independent evaluation with a browser is the only thing in the market that refuses done (RQ8 gap 1); at fleet cost it survives only as deterministic-decides, model-vetoes, one pass per wave, tiered by class |
| H2 | Clause 1 supported; clause 2 undetermined | Preview evidence requires per-class infrastructure (two deployables, webhooks, socket evidence) that no note templates; until then the gate is executable for ideas (1)-(3) only |
| H3 | Supported in mechanism | The skeleton procedure is the most followable in round 1; step 2 needs a rule and step 3 an infrastructure template per class |
| H4 | Weakened | Seven bounded questions work for ideas (1)-(3); for (5) they defer, not remove, 4-8 forks, which then collide with the 3-card quota and a slow founder |
| H5 | Supported, conditional | Machine-checkable plans are the right form; executable only with one status source of truth, Zod schemas, declared write sets and a size rule that fits the 400-line constraint |
| H6 | Supported | Fresh context per feature is right; the continuity artifacts proposed grow unbounded and lack a session-start read set, so the hypothesis is not yet implemented by the notes |
| H7 | Supported in principle; refinement undetermined | "Disjoint write sets with one integrator" is right and unimplementable without `writes`, a module map and the merge procedure of section 5 |
| H8 | Weakened | The "universal" core misapplies North runtime rules to product code (I6, I7); the matrix has no precedence, no budget, and rows that do not match the classifier |
| H9 | Supported, narrowed (H9′) | Always-on short indexes win; for the fleet they must be templates filled from intake, never planner prose, or they cost cache and adherence |
| H10 | Split supported; "founder only at forks" weakened | At 3 cards a day, classes (3)-(5) stall for days unless cards carry defaults with deadlines and are bundled per fork cluster |
| H11 | Supported | Correct, and the round-1 notes themselves prove it by leaving most of their rules as prose; section 7 is the conversion backlog |
| H12 | Supported in direction; undetermined as artifact | Class must select method, but class, row, T-tier, evidence level, gate and `proof.kind` are six unjoined vocabularies today |

---

## 7. Gaps the blueprint must fill, ordered by how often an agent hits them

| # | Hit frequency | Gap | Artifact that fills it |
| --- | --- | --- | --- |
| 1 | Every session start | No fixed session-start read set or byte budget (3.2) | Checklist: ordered read list with size caps, assembled by the dispatcher (3.3 item 3) |
| 2 | Every status change | Two sources of truth for status; three writers for one field (2.2 item 1) | Decision + schema: evidence rows canonical, `features.json` a worker-generated projection with planner-owned, hash-protected fields |
| 3 | Every handoff | No Zod schemas for `features.json`, intake record, evidence row, TaskBrief, TestReport, FixBrief, ReviewReport, Postmortem (2.2 item 5) | Schemas in `packages/core/src/engineering/*.ts`, exported and used by trace-check |
| 4 | Every build | North agent rules and product code rules mixed in one "universal" core (1.2) | Two tables: agent-action invariants (always on) and codebase invariants per class, each with its lint or hook |
| 5 | Every gate | Class, matrix row, T-tier, E-level, G-gate and `proof.kind` are not joined (1.1) | One join table: class + flags → tier → required gates → required evidence levels → roles → model profile → budget ceiling → expected cards |
| 6 | Every failure | Retry counts 2 / 3 / 5 disagree (2.2 item 2) | One state machine: attempt 1-2 same builder, attempt 3 fresh builder, attempt 4 stronger model, then breaker to planner; counters in `agent_runs` |
| 7 | Every fork | Cards have no default, deadline or blast radius; card storms in classes (3)-(5) (1.1, 3.3 item 4) | Schema fields `blocked_on.default`, `default_applies_at`, feature `assumptions: [id]`; policy: bundle a fork cluster into one card with a recommended set |
| 8 | Every session end | Progress log unbounded (3.2) | Template: `## Now` head ≤40 lines rewritten, `## Log` tail append-only |
| 9 | Every widening | No partition, merge, migration or regression procedure (section 5) | Procedure of section 5 plus `writes` field and `docs/design/modules.json` schema |
| 10 | Every evaluation | Hidden acceptance suite has no home or regeneration rule (3.3 item 5) | Storage path convention keyed by company, feature id, `steps` hash |
| 11 | Once per build | No infrastructure template per class: deployables, preview URLs, webhooks, socket evidence (1.3) | Template per class: what deploys where, how a preview gets a stable URL, how two deployables pin to one `commit_sha` |
| 12 | Once per build | Intake outputs have no schema; classifier has undefined terms; Q6 misfires; `payments` unused (1.2, 2.1) | `intake.json` schema (answers, class, flags incl. `payments`, assumptions with reopen triggers); classifier as a pure function with tests; the ten coverage categories listed |
| 13 | Once per build, read every gate | Gate thresholds undefined: mutation floor, assertion density, acceptance path convention (2.1) | Per-class threshold table inside the join table of gap 5; `**/*.acceptance.*` convention documented |
| 14 | Once per build | Landing page gets no planner yet writes need a spec (1.2) | Template: single-slice `features.json` emitted by intake for `static` and `landing+waitlist` |
| 15 | Once per build | Always-on files for founder repos would be planner-written (2.2 item 6, section 4 item 5) | Templates for `CLAUDE.md` and `.claude/rules/*.md` filled from `intake.json`, fleet-shared prefix first |
| 16 | Per feature in class (3)+ | No cross-tenant or cross-role isolation probe (1.1) | Evaluator checklist: second org, second role, unauthenticated; required E3 rows for `multi_tenant` |
| 17 | Platform, once | No per-class budget, model profile per role × class, queue and rate-limit policy, nightly sampling (section 4) | Fleet table: budget ceiling, profile, concurrency key, nightly cadence per class |
| 18 | Per postmortem | Lesson scope undefined; cross-tenant leakage (section 4 item 8) | Policy: company lessons vs platform lessons with the three-company minimum |
| 19 | Rare | 400-line rule collides with the feature list (2.2 item 4) | One-line CLAUDE.md exemption for generated data files, or per-slice feature files |
| 20 | Rare | Kill switch scope for in-flight worktrees, previews and the fleet (section 4 item 10) | Checklist: per-company stop within 5 s covering runs, worktrees, deploys; separate fleet stop |
