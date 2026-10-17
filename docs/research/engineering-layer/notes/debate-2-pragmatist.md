# Debate round 2: the solo-founder pragmatist

Persona: Solo-Founder Pragmatist. Date: 2026-10-17. Inputs: `01-research-protocol.md`,
`CLAUDE.md`, the founder decisions table in
`docs/superpowers/specs/2026-10-16-north-studio-phase-design.md` section 2, and the eight
round-1 notes `notes/RQ1-*.md` to `notes/RQ8-*.md`. Prices and per-run token assumptions
come from `docs/research/real-testing-strategy.md` sections 3.1 and 3.3 and
`docs/research/dept-engineering.md` "Budget"; measured harness costs from RQ4 Q2 and RQ2 KQ1.

Position in one paragraph: the eight notes agree on the right mechanism (the builder never
supplies the proof; a deterministic worker does) and then bury it under eleven artifacts,
six roles, ten gates and seven-plus questions. Costed per feature, the full ceremony is
roughly three times North's own single-session estimate, breaks the $8 journey for a
landing page, and makes the review budget, not compute, the throughput ceiling. The fix is
not to abandon the proposals but to tier them (H12) and to fund the cheapest controls first:
the ones that cost zero Claude dollars per run.

## 1. Cost of the proposals, per feature and per complexity class

### 1.1 Unit prices and reference points

| Item | Value | Source |
| --- | --- | --- |
| Opus 5.5 in / out / cache hit | $4 / $20 / $0.20 per MTok | real-testing-strategy 3.1 |
| Sonnet 5.5 | $2 / $10 / $0.10 | same |
| Haiku 5.5 (<=100k prompt) | $0.10 / $0.50 / $0.01 | same |
| One landing build, single session, Sonnet builder | $4.5 (plan 0.3, build 2.3, QA 0.75, review 0.3, one fix 0.8) | dept-engineering "Budget" |
| Non-engineering part of the founder journey | $1.71 (plan 0.54, research 0.55, brand 0.29, campaign 0.25, judges 0.08) | real-testing-strategy 3.3 |
| Engineering headroom inside $8 | $8.00 - $1.71 = $6.29 | arithmetic |
| Anthropic V2 harness, whole app on Opus 4.6 | $124.70: planner $0.46; build rounds $71.08 / $36.89 / $5.88; QA rounds $3.24 / $3.09 / $4.06 | RQ2 KQ1, RQ4 Q2 |
| Solo Opus run of the same app | $9, broken | RQ4 Q2 |
| Multipliers | agent ~4x chat; research multi-agent ~15x; agent teams ~7x; harness ~22x solo | RQ4 Q7 |
| First-generation breakage | Replit: >30% of features broken on first generation | RQ8 KQ2 Inferences |

### 1.2 One feature under the proposed loop

The proposed per-feature path (RQ7 KQ7 "(2) Workflow as artifact handoffs"; RQ5 "3. Ordered
gates"; RQ5 KQ6 "Order of operations per feature") is: planner task brief, evaluator writes
hidden acceptance tests before implementation, builder session, deterministic gates G0-G4,
transcript audit by a reader model (G5), preview deploy (G6), evaluator run with browser
(G7), reviewer on the diff, fix rounds up to R=5. Token assumptions follow the shape in
real-testing-strategy 3.3 (cached prefix re-read every turn, 2-3k output per turn).

| Step | Tokens (cache read / write / out) | Sonnet | Opus |
| --- | --- | --- | --- |
| Builder session, ~25 turns | 1.0M / 80k / 50k | 0.10 + 0.20 + 0.50 = $0.80 | 0.20 + 0.40 + 1.00 = $1.60 |
| Evaluator authors acceptance tests, ~10 turns | 300k / 40k / 15k | 0.03 + 0.10 + 0.15 = $0.28 | $0.58 |
| Evaluator run on preview, ~15 turns, 8 screenshots (1,334 visual tokens each) | 500k / 60k / 20k | 0.05 + 0.15 + 0.20 = $0.40 | $0.80 |
| Reviewer on diff, ~5 turns | 150k / 30k / 8k | 0.015 + 0.075 + 0.08 = $0.17 | $0.34 |
| Transcript audit (G5), one pass over ~200k builder transcript | 200k in / 2k out | $0.42 | Haiku: $0.02 |
| Planner, amortised over ~25 features | one Opus session ~$2 | $0.08 | $0.08 |
| **First pass** | | **$1.75** (Haiku audit) | **$3.42** |
| Expected fix rounds: 0.6 per feature (p_fail 0.35, geometric) x (half builder + evaluator run + reviewer) | | 0.6 x (0.40 + 0.40 + 0.17) = $0.58 | 0.6 x (0.80 + 0.80 + 0.34) = $1.16 |
| **Per feature** | | **$2.33** | **$4.58** |

Sanity check against the one measured run: 27 criteria in Anthropic's sprint 3 at $3-4 per
QA round is $0.13 per criterion; my $0.40 per feature for ~3 criteria is $0.13 per criterion.
The all-Opus path at ~$4.6 per feature over ~27 features is ~$124, which is the measured
$124.70. The estimate is in the right decade.

### 1.3 Three complexity classes

| Class | Features | Full ceremony, Sonnet | Full ceremony, Opus | Tiered (section 6) | Founder journey check |
| --- | --- | --- | --- | --- | --- |
| Landing page + waitlist | 6 (hero, form, DB row, confirmation email, a11y/SEO, legal) | 6 x 2.33 = **$14.0** | 6 x 4.58 = **$27.5** | one slice, one evaluator pass: 2.30 + 0.28 + 0.75 + 0.02 + 0.6 x (1.15 + 0.75) = **$4.5**, +$0.3 for 3 forked directions | $14.0 + 1.71 = $15.7, **2x over $8**; tiered $4.8 + 1.71 = $6.5, fits |
| CRUD SaaS, auth + payments | 30 (auth 3, org/profile 2, 3 entities x 3 = 9, dashboard 2, Stripe checkout + webhook + subscription state 4, settings 2, emails 2, misc 6) | 30 x 2.33 = **$70** | **$137** | per-slice evaluation (6 slices), deterministic security checklist, Opus planner: ~**$45** | No $8 budget applies; needs a per-accepted-feature price. $45-70 for a working app beats Lovable users' "$50 in one week" for nothing (RQ8 KQ2) |
| Real-time multi-tenant | 80, two-browser evaluator, security reviewer, consultant on escalation, p_fail 0.5 | 80 x ~3.5 = **$280** + ADRs/design docs/consultant ~$20 = **$300** | ~**$550** | ~$200 | Cannot be dogfooded inside the $100/month dev budget at all; golden tasks must be class 1-2 |

### 1.4 The monthly dev budget

dept-engineering "Budget" has $43: 80 change runs ($20) + 4 acceptance builds ($18) + sandbox
($5). Applying the proposals:

| Line | Full ceremony | Tiered |
| --- | --- | --- |
| 80 change runs: gates + E2 only ($0.25) vs gates + evaluator run + reviewer + audit ($0.25 + 0.40 + 0.17 + 0.02 = $0.84) | 80 x 0.84 = $67 | 80 x 0.27 = $22 |
| 4 acceptance builds (landing class) | 4 x 14.0 = $56 | 4 x 4.8 = $19 |
| Nightly G8 re-run (Playwright compute; judges on Haiku Batch ~$0.10/night) | $3 | $3 |
| Sandbox compute | $5 | $5 |
| G4 mutation testing (StrykerJS incremental, ~10 CI-min per PR) | 800 CI-min, ~40% of a free 2,000-min tier | nightly only |
| **Total** | **$131** | **$49** |

The full ceremony breaks the $100 cap with zero spent on Higgsfield, Recraft or the other
departments. Note the Sonnet transcript audit alone ($0.42 x 80 = $34) is almost the whole
current engineering budget; on Haiku it is $1.60. RQ2 open question 1 and RQ5 open question 1
both already ask whether per-feature E3 survives the budget. The answer is no for class 1
and yes for class 2 only per slice.

## 2. Process theatre: what a solo founder skips, and what still pays

Rule I apply: an artifact or role earns its place if it either (a) costs zero Claude dollars
per run (lint, hook, worker check) or (b) has measured evidence that it moves DV1 or DV5.

| Proposal | Where | Per-run cost | Would a founder skip it? | Evidence it pays | Verdict |
| --- | --- | --- | --- | --- | --- |
| Worker-only `done`, E2 preview HTTP + DB row | RQ5 "1. Evidence ladder", KQ4 | ~$0 | Cannot skip; it is in the state machine | Fixes the live `plausibleRef` hole (RQ5 KQ4: `deploy_id`/`test_report` verified on any non-empty string) | Keep, build first |
| Builder read-only on tests, CI, lockfiles; no `.skip/.only` (G0) | RQ5 "3. Ordered gates" | $0 | Cannot skip; hook | ImpossibleBench: >79% of Claude cheating is test modification; read-only stops it (RQ6 KQ5) | Keep |
| First test e2e on a deployed preview (I11, skeleton step 4) | RQ3 synthesis (1), (3) | one deploy, one Playwright run | Yes, if it is advice; no, if the pipeline is built first | GOOS consensus, Anthropic "unit tests or curl ... missed end-to-end failures" (RQ2 KQ1) | Keep, make it the pipeline default |
| Independent evaluator with browser (E3/G7) | RQ5, RQ7 role table | $0.40-0.80 per feature | Yes, at per-feature cadence | "reliably skew positive" (B); MAST verification +15.6 (A, different setting); magnitude on DV1 unmeasured (RQ6 "(2) not yet supported") | Keep per slice; per feature only at class 3 |
| Evaluator-authored hidden acceptance tests before build | RQ5 anti-gaming 1 | $0.28 per feature + two checkouts | Yes | RE-Bench vs HCAST 43x when the scorer is visible (RQ6 KQ5) | Keep for class 2+, where the builder could special-case; a landing page has nothing to special-case |
| LLM reviewer with ReviewReport checklist | RQ7 role table | $0.17 per feature | Yes | Luu: independent audit subagents "scored worse" (RQ7 KQ4 Inferences); monitor recall 42-50% (RQ6 KQ3) | Convert checklist items to lint/probes (RLS probe, `gate()` import rule); LLM reviewer only at class 3 |
| Transcript audit reader model (G5) | RQ5 gates | $0.02 Haiku / $0.42 Sonnet | Yes | 42-89% recall, veto only | Keep on Haiku only |
| Mutation score floor (G4) | RQ5 gates, anti-gaming 5 | CI minutes, slow on Next.js (RQ5 open Q4) | Yes | MutGen "100% coverage, 4% mutation" is about tests that RQ5 itself gives evidential weight 0 ("evidential weight is 0/0/100", RQ5 KQ6) | Contradiction: do not spend CI scoring tests that do not count. Nightly, class 3 only |
| Sealed builder environment (strip `.git`, deny egress) | RQ5 anti-gaming 3 | engineering + lost doc access | Yes | Cursor's 63% retrieval is a benchmark artifact: a founder's product has no gold patch to retrieve | Cut; keep registry proxy for supply chain only |
| Sprint contract | RQ2 KQ1 | planner + evaluator round | Yes | Anthropic removed it in V2 (RQ2 KQ1) | Cut; `proof.steps` in the feature row is the contract |
| Consultant (stronger model) as standing role | RQ7 role table | Opus fork of full context | Yes | Cognition: works frontier-to-frontier, no numbers | Escalation-only (RQ7 already says level 2) |
| Six-role team | RQ7 KQ7 (1) | 4 LLM contexts per feature | Yes | Role sets with production evidence have 3 roles (RQ7 KQ4 Inferences) | 2 LLM roles + worker for class 1; add planner at class 2; add reviewer at class 3 |
| Mini design doc per slice, C4 diagrams, alternatives | RQ2 artifact 5 | one Opus pass, ~$0.50 | Yes | Google culture (C); "written only where the problem is ambiguous" is RQ2's own caveat | Class 2+ only, and only for the slice that owns the data-model root |
| ADRs with Nygard sections | RQ2 artifact 6 | ~$0.20 each | Yes | Hard-to-reverse choices only (CLAUDE.md agrees) | Class 2+: tenancy, payments, auth provider. A landing page has zero ADRs |
| `requirement_hash`, `scripts/trace-check.ts` | RQ2 artifacts 7, 10 | $0 per run once built | Yes, invisible to founder | IEC 62304 pattern; addresses DV6, not DV1 | Keep (it is $0) but it does not prevent the mock-test failure; do not sell it as if it did |
| Per-feature task card <=120 lines | RQ2 artifact 8 | planner tokens | No | Keeps the 77 KB plan out of the per-session read path (RQ2 KQ4 Inferences) | Keep; it saves tokens |
| Postmortem document after false done | RQ7 (3) | one LLM pass | Yes | Haynes checklist (A) is about the checklist, not the document | Replace with one lesson row in the LRN loop plus one checklist edit |
| 13 lint-enforced invariants | RQ3 (1) | $0 | No | Holzmann's design premise | Keep; lint is free |

"Do less, verify more" is the better rule wherever the verification is deterministic. Every
row above marked $0 is a verification; most rows with a dollar cost are a second opinion.
Second opinions from a model without new signal do not help (Huang ICLR 2024, RQ6 KQ3); the
evaluator's value is the browser and the DB read, not the model.

## 3. Founder attention: counts against the 3-card and 5-item budgets

What the proposals generate, counted from the notes:

| Source | Items per build | Type |
| --- | --- | --- |
| RQ1 intake round 1: max 7 questions; stop rule 3 "or two decision cards consumed"; round 2 "max 3" at the first phase gate; Q1 may block | 7 + 3 questions, up to 2 cards | questions / cards |
| RQ1 open Q4: assumptions digest at intake end | 1 | review item |
| RQ2 template section 10: "Decision cards expected" per slice design doc, "count <= daily quota headroom" | 1-3 per slice | cards |
| RQ3 skeleton step 7: founder walkthrough of skeleton; step 12: re-classify = decision card | 1 item, 0-1 card | both |
| RQ7 (2): review queue "variant pick / walkthrough" at every feature boundary; (3) level 3 card for any new/superseded ADR, integration, appetite overrun, production | 1 item per feature; cards per ADR/integration | both |
| RQ7 (3): circuit breaker reported in review queue; postmortem per false done | 5-10% of features | review items |
| RQ5 G9: founder walkthrough per milestone; open Q6 asks whether per feature | 1 per milestone | review item |
| Studio spec section 2: K2 cards for money, public posts, first contact, going live | go-live, live keys, Supabase connect | cards |

Totals for a 30-feature CRUD SaaS: review items ~30 (feature walkthroughs) + 3 breaker/
postmortem + 1 assumptions digest = ~34; cards ~3 integrations (auth provider, Stripe, email)
+ 3-4 ADRs (tenancy, data model, payments) + 1 go-live + 1 live keys + ~3 appetite overruns
= ~12. Against 5 items and 3 cards a day that is a minimum of **7 founder-days** of review
and 4 days of cards, regardless of how fast the agents build. The review budget, not
compute, is the throughput ceiling. For a landing page: 7 questions (~5 minutes), 1 direction
pick, 1 skeleton walkthrough, 2 cards (Supabase connect, go-live): fits in one day.

Minutes: 10 minutes for 5 items is 2 minutes per item. A real walkthrough of a feature on
staging takes 3-5 minutes. The budget is only consistent if an item is one annotated
screenshot plus one sentence ("I clicked Sign up, entered a test email, saw the row in your
Supabase") with pass / fail / comment. The evaluator's E3 output must be rendered to that,
or the 10-minute budget is fiction.

Minimum set I propose:
- Intake: 5 multiple-choice questions, defaults pre-selected, zero cards. Q1 is drafted from
  the idea and confirmed, never a hard block (RQ1 open Q5). Q6, Q7, Q9 only when the
  classifier says appetite >= weeks (RQ1 already proposes this).
- Review items: one per vertical slice (6 for the CRUD example), not per feature; one per
  variant pick; one per breaker trip. ~10 items for the CRUD build, 2 for a landing page.
- Cards: integrations that need the founder's own account (K2 already), go-live (K2), and
  the one architectural fork the classifier cannot default (tenancy when the idea says
  "teams"). ~4 for CRUD, 2 for landing. ADRs never produce cards by themselves; the
  planner writes the ADR and the card, if any, is phrased as a consequence ("each customer
  company gets its own private space; costs 2 more days").

## 4. The mock-test failure: what prevents it, ranked by impact per dollar

The failure (protocol section 0): the builder writes tests against doubles, reports done,
first real click fails. Three mechanisms produce it: (a) the platform accepts the builder's
claim as evidence; (b) the builder controls the tests; (c) nothing ever ran against the
deployed artifact.

| Rank | Proposal | Mechanism it closes | Per-run cost | Why this rank |
| --- | --- | --- | --- | --- |
| 1 | `done` only from worker-produced E2 rows (preview READY for the SHA, HTTP with body assertion, DB row read back); builder references become `builder_claim` (RQ5 KQ4 Inferences) | (a), (c) | ~$0 | Closes the exact hole that exists in `apps/worker/src/services/verifier.ts` today. One or two engineering days, zero Claude per run |
| 2 | Builder cannot write tests, CI config or lockfiles; `.skip/.only` lint; test-diff flag (G0) | (b) | $0 | Measured: read-only tests stop >79% of observed cheating (RQ6 KQ5) |
| 3 | Pipeline first, first test e2e on preview, kept forever and run nightly (RQ3 steps 3-4, 11; G8) | (c), DV5 | one deploy + Playwright compute | Catches integration and mock drift structurally; also the only regression control |
| 4 | Evaluator run in fresh context with browser, deterministic criteria decide, model vetoes (G7) | (a) | $0.40-0.80 per slice | Strong mechanism evidence (B), magnitude unmeasured; the deterministic half is where the value is |
| 5 | Evaluator-authored acceptance tests from the spec before build, hidden from builder | (b) special-casing | $0.28 + infra | Only matters where there is something to special-case; needs an unambiguous spec, which a non-technical founder's idea is not |
| 6 | Transcript audit on Haiku | (b), false claims | $0.02 | Cheap second line; 42-89% recall; never approves |
| 7 | Bounded retries, breaker at R=5, appetite in dollars (RQ7 (3), AGT-3) | loops | saves money | Cursor: hacking rose under "keep working" (RQ5 KQ2); also the complaint engine at every competitor (RQ8 KQ2) |
| 8 | LLM reviewer on diff | none of (a)-(c) directly | $0.17 | Independent audit without verification power scored worse (Luu, RQ7) |
| 9 | Mutation testing of builder tests | (b) weak oracles | CI minutes | Scores tests that have evidential weight zero |
| 10 | Sealed environment | retrieval cheating | engineering + lost docs | Benchmark problem, not a founder-product problem |

Only look like they prevent it: EARS statements, `requirement_hash`, trace-check, ADRs,
design docs, sprint contracts, postmortem documents. They make the failure traceable after
the fact (DV6) and are worth having where they cost $0, but a perfectly traced spec with
mock tests still fails on the first click. The notes present them next to the evidence
controls as if they were the same kind of thing; they are not.

## 5. Where the notes assume a technical founder

- RQ2 artifacts 4-6: EARS rows with RFC 2119 keywords, Nygard ADRs, C4 diagrams,
  "alternatives considered". RQ2 open Q2 admits EARS may be unreadable. These are for agents.
  The founder never sees them; the card is a plain-language rendering with a pre-selected
  default and a cost/time consequence, and the planner is accountable for the two agreeing.
- RQ7 role table: founder "Final on architectural forks"; level 3 cards for "anything that
  would create or supersede an ADR". A non-technical founder cannot adjudicate shared schema
  versus schema-per-tenant. The fork must be re-phrased as a product question (RQ1 Q4 does
  this well: "companies or teams that each have their own space and data") or defaulted.
- RQ7 reviewer "diff by SHA range" and RQ6 KQ7's Willison patterns assume someone reads
  diffs. Nobody will. RQ6 KQ7 Inferences gets it right: substitute evidence artifacts
  (screenshot, HTTP transcript, DB row) for code reading. That sentence should be the
  design rule for every founder-facing surface.
- RQ3 step 12 "re-classify if the product changes class ... this is a decision card":
  phrase as "you asked for payments; that adds X days and a Stripe account" with a default.
- RQ5 G9 founder walkthrough: the one place the founder is genuinely competent. Give it a
  generated script in plain words derived from `proof.steps`, on a phone, with one tap per
  step. This is the real DV1 oracle; everything else is a proxy for it.
- Non-technical also means the founder cannot tell a flaky evaluator from a real failure.
  Evaluator-versus-founder disagreement (RQ7 (4) "independence metrics") must be recorded
  from the first build and shown as a trust score, or the founder will stop reading items.

## 6. Zero-config default path and escalation (H12)

Founder answers nothing beyond the idea sentence:

1. Classifier (RQ1 "3. Complexity-class classifier sketch") runs on the restated idea with
   defaults: individual users, no payments (waitlist only), refresh is fine, no
   integrations, not regulated, appetite "weeks". Result: `landing+waitlist` unless the
   idea implies accounts, then `crud_saas` with the assumptions table shown as one digest
   item (no quota cost).
2. Team: builder (Sonnet, medium) + evaluator (Sonnet, high, fresh context, read-only) +
   deterministic worker. Planner is the intake restatement only; no reviewer, no consultant.
3. Artifacts: `features.json` (RQ2 schema, kept), per-feature task cards, progress log,
   `init.sh`, CLAUDE.md under 200 lines. No design doc, no ADR, no EARS gate.
4. Gates: G0, G1, G2 (fast unit only), G6, G7-lite (HTTP + body, DB row, one screenshot per
   step, axe = []), G8 nightly, Haiku transcript scan. No G4, no LLM reviewer.
5. Order: pipeline, deploy, first e2e test, skeleton, then widen (RQ3 (3)).
6. Founder touch: one direction pick (3 forked variants, RQ4 step 6), one skeleton
   walkthrough item, one K2 go-live card, one K2 connect-your-Supabase card. Total: 2
   items, 2 cards, 0 questions.
7. Budget: appetite $6 per build, $1 per change run (dept-engineering guard), breaker at
   1.5x appetite -> review item with "stop / continue once / cancel".

Escalation triggers, each raising exactly one dial:

| Trigger | Dial raised | Cost delta |
| --- | --- | --- |
| Classifier: accounts | add RLS probe as unauthenticated user + secret scan to G6 (deterministic, RQ8 "Copy this" 9) | ~$0 |
| Classifier: payments | sandbox Stripe contract test nightly; K2 card before any live key; planner on Opus for the payment slice | +$1-2 per build |
| Classifier: tenancy or two-sided | planner writes one ADR (tenancy) and one slice design doc for the data-model root; evaluator per slice becomes mandatory; one card phrased as a product consequence | +$3-5 per build, +1 card |
| Classifier: real-time | evaluator with two browsers; deterministic simulation test for merge | +$0.5 per slice |
| Classifier: regulated | audit log, residency check, consent capture as deterministic gates; T4 required per milestone | +$0 Claude, +1 item per milestone |
| Runtime: feature fails E3 twice | fresh builder, stronger model (RQ7 R>=4); third failure trips breaker -> item | bounded by appetite |
| Runtime: evaluator passes, founder walkthrough fails | evaluator to Opus for this company; lesson row written | +$0.40 per slice |
| Runtime: nightly G8 regression | stop the line; no new feature until green | $0 |
| Runtime: appetite exceeded 1.5x | card with estimate before continuing (RQ8 gap 4: nobody shows an estimate) | saves money |

## 7. Verdict table, pragmatist's view

| H | Verdict | One line of reasoning | Cost note |
| --- | --- | --- | --- |
| H1 | Supported (direction), magnitude undetermined | Self-grading skews positive is consistent across RQ4, RQ5, RQ7; no DV1 measurement anywhere (RQ6 "(2)") | $0.40-0.80 per slice; the deterministic half of G7 is near free and is where the value sits |
| H2 | Clause 1 supported; clause 2 undetermined | Builder-controlled tests are the measured attack surface (RQ6 KQ5); nobody has measured false-done reduction from a preview gate | Clause 2 is the cheapest control in the whole program (~$0 per run) so test it first in North's telemetry |
| H3 | Supported (consensus, weakly measured) | Unanimous practitioner lineage, one unretrieved study (RQ3 KQ4) | Cheapest structural control: one early deploy; it also prevents the mock-test failure |
| H4 | Weakened | Benchmark evidence only (RQ1 KQ2 Gaps); the proposed 7 + 3 questions and "two cards consumed" is the opposite of bounded for a 3-card quota | Founder minutes are the scarce input; cap 5, zero cards |
| H5 | Supported in narrow form | JSON feature list with `proof` and split status is the stable core (RQ2 KQ1, Anthropic kept it across model generations); the other ten artifacts are class-dependent | Feature list is $0 per run; design docs and ADRs cost planner tokens and founder cards |
| H6 | Supported | Context rot is the best-replicated finding in RQ6; Anthropic V2 dropped resets for Opus 4.5+ but kept the artifacts | Fresh sessions also shrink prompts; cache is lost per session but the prefix is small |
| H7 | Supported | Both camps agree on one context per decision (RQ4 Q3); every shipping harness is one task per checkout | Under $8 no write-parallelism is justified; read fan-out only from class 2 |
| H8 | Supported | Canon authors disagree; the 13 invariants are lint-checkable (RQ3 (1)) | $0 per run; 13 rules is fine when a linter, not a human, holds them |
| H9 | Supported in narrow form | 8 KB always-on index beats skills (Vercel); overviews hurt (ETH) (RQ2 KQ4) | Cheapest lever in the notes; also removes the 56% skill non-invocation risk for gates |
| H10 | Weakened | The split is supported; the six-role set is not (production role sets have three, RQ7 KQ4); "founder only at forks" contradicts Luu and the review-queue design | Each extra LLM role is a context per feature; cut reviewer and consultant for class 1-2 |
| H11 | Supported | Every observed successful transfer took artifact form (RQ3, RQ7); Holzmann's premise | Checkable artifacts are $0 per run; this is the pragmatist's favourite hypothesis |
| H12 | Supported by arithmetic, boundaries undetermined | No direct evidence (RQ1 KQ4, RQ3 KQ5); but section 1.3 shows uniform methodology costs 3x on class 1 and is unaffordable on class 3 | Tiering is the only way the $8 and $100 constraints hold; measure DV1/DV5 per class from build one |

## 8. Amendments demanded, ordered by impact per dollar

1. **Fix `verifyEvidence` and make `done` worker-only** before any other engineering-layer
   work: preview READY for the SHA, HTTP with body assertion, DB row read back; builder
   references are `builder_claim`. Impact: closes the live false-done hole. Cost: ~$0/run.
2. **Builder read-only on tests, CI, lockfiles via hooks; `.skip/.only` lint; test-diff
   flag.** Impact: removes the measured dominant cheat. Cost: $0/run.
3. **Pipeline first, first test e2e on preview, kept and run nightly.** Impact: closes (c)
   and gives DV5 for free. Cost: one deploy per feature, no Claude.
4. **Tier by class (H12) in the blueprint, with the zero-config path of section 6 as the
   default.** Class 1: one slice, one evaluator pass, two LLM roles, no ADR/design
   doc/reviewer. Class 2: evaluator per slice, planner on Opus for the data-model slice,
   deterministic security checklist. Class 3: the full RQ7 role set. Impact: $14 -> $4.8 per
   landing build; $131 -> $49 per dev month.
5. **Review per slice, not per feature; every item is one screenshot plus one sentence plus
   pass/fail/comment.** Impact: 34 -> ~10 items for a CRUD build; the 10-minute budget
   becomes real.
6. **Intake: 5 multiple-choice questions, defaults pre-selected, zero cards; Q1 drafted
   and confirmed; assumptions as one digest item.** Delete RQ1 stop rule 3's "two decision
   cards consumed" and the 3-question mini-intake per phase gate unless the skeleton
   walkthrough fails.
7. **Evaluator: deterministic criteria on the worker decide; Sonnet evaluator vetoes;
   Opus only after an evaluator-versus-founder disagreement.** Record that disagreement
   rate from build one (RQ7 (4)).
8. **Cut or defer:** G4 mutation (nightly, class 3), sealed environment (keep the registry
   proxy only), Sonnet transcript audit (Haiku), LLM reviewer and consultant below class 3,
   sprint contracts, postmortem documents (one lesson row plus one checklist edit instead),
   `requirement_hash`/trace-check until class 2 (keep the script, do not gate on it).
9. **Appetite in dollars per feature row, estimate shown before build, breaker at 1.5x.**
   Impact: the one differentiator no competitor has (RQ8 gap 4) and the end of loop billing.
10. **Measure before fixing budgets.** Run 20 golden tasks (class 1 and 2 only) in
    `packages/evals` and replace every number in sections 1.2-1.4 with `agent_runs` data
    before the blueprint commits to a per-feature price (RQ4 open Q7). My estimates are
    within the right decade of the single measured run; that is not good enough to publish
    as a price.

## 9. Contradictions between notes that the synthesis must settle

- RQ5 KQ6 gives builder unit tests "evidential weight 0" and RQ5 gate G4 mutation-scores
  them as a gate. One of the two must go; I say G4.
- RQ7 reviewer "may reject on size alone (>200 lines)" versus RQ3 I10 "one slice per PR,
  ~100-400 lines". Pick one number and make it lint.
- RQ1 stop rule 3 allows two intake cards; RQ1 KQ6 Inferences says "at most 1-2 cards";
  the studio spec says drafts never consume quota. Intake questions are a draft form, not
  cards.
- RQ4 Deliverable 3 says "fresh context per feature is the default"; RQ7 side verdict says
  H6 "is contested by Anthropic V2". Resolve as RQ4 does: fresh context is the auditable
  default, long session with compaction is a model-gated optimisation re-tested per model.
- RQ5 anti-gaming 3 (sealed environment) versus RQ5 open Q5 (admits it may cripple
  legitimate work). The founder-product case has nothing to retrieve; drop it.
- RQ2's eleven artifacts versus RQ2 KQ1's own finding that only four survived Anthropic's
  model upgrade (feature list, progress log, bootstrap, git). The blueprint should name
  those four as invariant and the rest as class-selected.
