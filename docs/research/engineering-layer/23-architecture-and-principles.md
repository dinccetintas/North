# 23. Architecture and principles

Purpose: the rules that bind North's agents, the rules that bind the generated codebase, the architecture chosen per class and module, and the walking-skeleton procedure that starts every build.

Related: `00-README.md`, `01-research-protocol.md`, `10-findings-and-verdicts.md`, `20-blueprint-overview.md`, `21-intake-protocol.md`, `22-spec-and-plan-artifacts.md`, `23a-repo-templates.md`, `24-team-topology-and-orchestration.md`, `25-verification-and-evidence.md`, `26-security-controls.md`.

Rulings carried: `notes/synthesis-decisions.md` §2 rows 5, 6, 12, 34; §3.1; §4.1 invariant rows; §7 gaps 4, 11, 15, 19. Templates are in `23a-repo-templates.md` (split rule, synthesis §8).

Tag convention: `LEVEL [hypothesis · lowest grade · classes · kind]`, as in `21-intake-protocol.md`.

## 1. Two invariant tables

Debate-4 §1.2 found that RQ3 listed North's runtime rules (`gate()`, append-only `actions`) as universal product rules. A waitlist form has no authority engine. The arbiter split them (synthesis §2 row 34): table A binds what North's agents do and is always on; table B binds the code they produce and applies per class. Nothing in table A is scaffolded into a founder's product.

### 1.1 Table A: agent-action invariants (North's agents, every class)

MUST [CLAUDE.md, H2, H13 · A/B · all · invariant] for every row unless marked.

| # | Invariant | Check (deterministic) | Source |
| --- | --- | --- | --- |
| A1 | Every outside-world action passes `AuthorityEngine.gate()`: push, deploy, send, provider calls | Import lint: only the gate module imports integration SDKs; Vitest that a direct call throws; `actions` row per call | `CLAUDE.md` 1; ADR 0001 |
| A2 | `actions`, `ledger_entries`, `evidence` are append-only | `forbid_change()` trigger; migration test attempts UPDATE and DELETE and expects refusal | `CLAUDE.md` 3; debate-3 §4.3 |
| A3 | `done` only from E2 + E3 rows per criterion via `record_evidence()` and the SQL `done` function; `plausibleRef` removed; builder `artifact_id` never counts | Property test: `done` unreachable without both rows; DB test rejects `producer = builder_claim` | synthesis §4.1 row 1 (H2, H13, A) |
| A4 | Decision quota (3/day) never exceeded; cards only from `gate()`; intake consumes none | DB trigger on `decision_cards`; `planCards` defers; Vitest that no agent tool opens a card | `CLAUDE.md` 4; synthesis §2 rows 16, 33 |
| A5 | Sandbox by default; live keys entered by the founder only; `live_key` is a K2 card | Vitest over `engineeringSandbox()`; fence refuses non-test keys | `CLAUDE.md` 5; debate-3 MUST 1 |
| A6 | Money moves only from the founder's own accounts; North never custodies funds | No custody code path; provider adapters bind to the founder's connection | `CLAUDE.md` 6 |
| A7 | Kill switch stops runs, worktrees and preview deploys of a company within 5 s; a separate fleet stop exists | Integration test: `sleep 300` in a sandboxed run, flag flipped, no process after 5 s | `CLAUDE.md` 7; synthesis §6 |
| A8 | Builder never writes tests outside its feature, CI, lockfiles, `.claude/**`, `.git/**`, `e2e/acceptance/**`, `features.json` planner fields, `docs/SPEC.md` rows | G0 protected-path diff on the pushed SHA, worker side; `PreToolUse` deny inside the workspace | H2, H13 (ImpossibleBench A, https://arxiv.org/html/2510.20270v1) |
| A9 | Critics (Evaluator, Reviewer) are read-only: own `CLAUDE_CONFIG_DIR`, no `Bash`, `Write`, `Edit`, `Agent`, `WebFetch`, `WebSearch`; pinned alias and rubric; never a fork of a builder | Vitest over every persona file; `critic: true` forces the disallowed list | H1 (A for separation); debate-3 MUST 4, 5 |
| A10 | No role with file-write or Bash tools has `WebFetch` or `WebSearch`; builder docs are vendored snapshots | Vitest over tool lists | debate-3 MUST 6 |
| A11 | Fresh session per feature; after any failed gate a new session from artifacts plus `FixBrief`; transcript resume only for `crash` or `timeout` | Worker state-machine test over `ended_reason` | H6 (A premise) · model-limit (dated 2026-10) |
| A12 | Session-start read set ≤20 KB in the fixed order of `22-` §11 | Dispatcher test over byte caps and order | H6, H9' |
| A13 | Any role may `halt` through a North tool; the worker parks the build and opens a `breaker` item | Tool exists in every role's list; worker test | synthesis §2 row 31 |
| A14 | `CLAUDE.md` and `.claude/rules/*.md` in founder repos are templates filled from `intake.json`; the planner never writes always-on prose | Diff of the committed file against the rendered template is empty | synthesis §2 row 12 (ETH, A, https://arxiv.org/abs/2602.11988) |
| A15 | Wave size 1 at release 1; parallel writers only per `24-` §widening with declared `writes` | Dispatcher refuses two active builders per build unless `parallel: true` and `modules.json` exist | H7 (B/C) · release-1 rule |
| A16 | Metrics recorded from build one: `evaluator_fail_rate_on_builder_done`, `evaluator_vs_founder_disagreement`, G5 flag rate, breaker trips, cost per accepted feature by role | Columns on `agent_runs` and `evidence`; nightly report | synthesis §4.1 metrics row |

### 1.2 Table B: generated-codebase invariants (the founder's product)

MUST [H8 half 1 (A), H11 (B) · all unless noted · invariant until H8' says otherwise]. Each row is a lint, probe or test the worker runs in G1 or G6 (`25-verification-and-evidence.md`). Ablation H8' drops any row whose removal moves nothing (synthesis §1).

| # | Invariant | Check | Classes | Lineage |
| --- | --- | --- | --- | --- |
| I1 | Files ≤400 lines; functions ≤50 lines; generated data files exempt | ESLint `max-lines` 400, `max-lines-per-function` 50; ignore `docs/plans/*.json`, lockfiles | all | Holzmann R4, https://spinroot.com/gerard/pdf/P10.pdf; `CLAUDE.md` |
| I2 | Zod `parse` or `safeParse` at every boundary: route handlers, server actions, webhooks, env, provider responses | Custom lint: every exported handler calls a schema; `dependency-cruiser` forbids raw `Request` or SDK response types outside `adapters/**` | all | Holzmann R7; Cockburn ports and adapters, https://alistair.cockburn.us/hexagonal-architecture/ |
| I3 | Every return value checked; no floating promises; explicit error types | `@typescript-eslint/no-floating-promises`, `no-unused-expressions`, `tsc --strict` | all | Holzmann R7; RQ3 §KQ2 |
| I4 | Dependency direction one way: `core` ← `adapters` ← `app`; `core` has no I/O | `dependency-cruiser` rules in `23a-` | all | Cockburn; Bernhardt; Shopify Packwerk, https://shopify.engineering/enforcing-modularity-rails-apps-packwerk |
| I5 | No shared mutable module state; return new objects | `eslint-plugin-functional` `no-let` at module scope, `immutable-data`; `readonly` types | all | Hickey; Salomon (RQ3 §KQ6) |
| I8 | Zero warnings: `tsc --strict`, `eslint --max-warnings 0`, build | Exit codes in G1 | all | Holzmann R10 |
| I10 | ≤400 changed lines per feature PR, generated files and lockfiles excluded | Worker count on the pushed SHA; no LLM size judgement | all | synthesis §2 row 15; Google small CLs, https://google.github.io/eng-practices/review/developer/small-cls.html |
| I11 | Acceptance-test-first: the evaluator's suite for the feature exists in Storage before the builder's first attempt | Worker check `acceptance/<companyId>/<featureId>/<sha256(steps)>/` exists at dispatch | C2+ (C1: template smoke suite) | synthesis §2 row 5; GOOS (RQ3 §KQ4) |
| I12 | No control flow or sleeps in tests; flaky tests fail the gate | ESLint on `*.test.ts`: no `if`, `for`, `while`, `setTimeout`; Vitest `failOnFlakyTests` | all | Google SWE book ch. 11, https://abseil.io/resources/swe-book/html/ch11.html |
| I14 | RLS on every table in `public`; anonymous probe denied except declared public tables; `tenant_id` in every policy at C3 | SQL probe over `pg_class.relrowsecurity` and `pg_policies`; anon-key probe | when `auth` | debate-3 §6; ADR 0003 |
| I15 | No secrets in client bundle or repo | gitleaks on diff; client-chunk JWT scan fails on `service_role`; `.env*` untracked | all | debate-3 §6 |
| S | The generated-app security table of `26-security-controls.md` (auth via `getUser()`, rate limit, headers, semgrep OWASP, frozen lockfile and OSV, no undeclared outbound host) | G6 checks, no founder switch | all | debate-3 §6 |

SHOULD [Metz/Abramov (C); Anthropic advisory vs deterministic (B) · all · process]:

| # | Rule | Check |
| --- | --- | --- |
| I9 | Rule of three: no abstraction before the third occurrence; inline a wrong abstraction rather than parameterise it | `jscpd` report, informational; Reviewer checklist item at C3+ (https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction) |
| I13 | Every rule that can be a hook is a hook; `CLAUDE.md` keeps only what cannot be checked | Template audit at each template version: each line maps to a hook, lint, or deletion |
| E0 | Builder red-green unit cycle inside its `writes` | Builder tests run at G2; evidential weight zero (synthesis §2 row 5) |

Retired from the product core: I6 `gate()` and I7 append-only `actions` (now A1, A2). An append-only ledger reappears in the product only through M-PAY or M-REG (synthesis §2 row 34).

G1 runs table B as four commands with exit codes: `pnpm typecheck`, `pnpm lint` (ESLint, `dependency-cruiser`, test lint), `pnpm build`, and the worker's own line counter on the pushed diff. Configuration is in `23a-repo-templates.md` §5.

### 1.3 Contested in the canon, so not rules

RQ3 §KQ1 records the canon's authors disagreeing in writing on these points, and RQ3 §KQ5 finds small or null measured effects. None is encoded as a rule or a lint; a planner or builder that adds one as a repo rule is drifting.

| Topic | Positions | Why it is not a rule | Source |
| --- | --- | --- | --- |
| Function size below 50 lines | Martin "one thing" vs Ousterhout "deep modules" | I1's cap is the only deterministic line; depth below it is not measurable | https://github.com/johnousterhout/aposd-vs-clean-code/blob/main/README.md (C) |
| Comment density | Martin "potential misinformation" vs Ousterhout "10–100x cost of missing comments" | No defect data either way | same (C) |
| Unit-level TDD vs test-after | Martin for; Ousterhout against; meta-analyses null | The agent failure mode is fake tests, not absent tests; I11 replaces the question (synthesis §2 row 5) | RQ3 §KQ5 (A), https://bura.brunel.ac.uk/bitstream/2438/14828/3/Fulltext.pdf |
| OOP vs FP, DDD everywhere, event sourcing beyond money and audit | Selected by class in §2 | Case-study literature only | RQ3 §KQ5 (C) |
| Microservices | Contraindicated for every class here | Fowler monolith first; Prime Video and Segment consolidations | https://martinfowler.com/bliki/MonolithFirst.html (C) |
| Framework, hosting, styling | Fixed by the default stack of §2 | Never asked of the founder (`21-` §3); changing them is a `fork` card | RQ1 §KQ5 (B) |

## 2. Decision matrix by class and module

SHOULD [RQ3 §KQ5 (C/B); H12 (B cost) · all · design choice (to be measured)]. The default stack is a design choice that intake never asks about: Next.js (TypeScript), Supabase (Auth, Postgres with RLS, Storage), Vercel previews, Fly for a second deployable, Stripe for money. Grade B (vendor documentation) and North's own ADRs 0003, 0006, 0007. Every cell is one line; the reason follows in parentheses with its grade.

### 2.1 By class

| Class | Architecture | Paradigm | Data | Testing approach | Deployment |
| --- | --- | --- | --- | --- | --- |
| C1 `landing` | One Next.js deployable; static page plus one server action (Fowler monolith first, C) | Data-oriented templates; no domain model (RQ3 matrix row 1, C) | One `waitlist` table, RLS on, writes only through the server action (debate-3 §6, B) | Template smoke suite, G7 once per build; builder unit tests optional E0; axe and Lighthouse thresholds (synthesis §5) | Vercel preview per branch; production is the promoted preview; founder's Supabase via `connect_account` (gap 23) |
| C2 `app` | Modular monolith; vertical slice per use case; Transaction Script first (Bogard, C, https://www.jimmybogard.com/vertical-slice-architecture/) | Types first: Zod schemas are the data model; functional core, imperative shell (RQ3 §KQ1, C) | Supabase Auth; RLS keyed by `user_id`; migrations in repo; generated types (ADR 0003, B) | Evaluator suite per feature from `steps`; G7 per slice; G3 integration on local Supabase; G5 audit on `fast` (synthesis §5) | One deployable; Vercel plus Supabase; job runner only with `batch` |
| C3 `platform` | Modular monolith with enforced package boundaries per context (Shopify Packwerk precedent, B) | DDD-lite: bounded contexts named in the glossary; explicit state machines for orders and memberships (RQ3 matrix, C) | `org_id` on every table and in every policy; data-model root designed first, with ADR and design doc (WorkOS, C, https://workos.com/blog/developers-guide-saas-multi-tenant-architecture) | Plus cross-tenant and cross-role probes as required E3 rows; Reviewer per slice; G7 per slice; planner `strong` | One deployable plus M-RT second deployable when flagged; stable webhook alias (§4) |
| C4 `critical` | As C3; money and audit paths event-sourced (append-only tables) (RQ3 §KQ5, C) | DDD for the money context; exhaustive state types; runtime assertions on invariants (Holzmann R5, B) | Append-only ledger and audit tables with `forbid_change()`; consent record; residency pinned | G7 per feature; G4 nightly informational; property tests on ledger invariants; consultant at escalation level 2; G9 per milestone | As C3; `go_live` card per milestone; production only by promotion |

### 2.2 By module (adds to the class row)

| Module | Architecture | Paradigm | Data | Testing approach | Deployment |
| --- | --- | --- | --- | --- | --- |
| M-PAY (`payments`, C2+) | Stripe Checkout and webhooks behind an owned adapter (ADR 0005 pattern, B) | Money as integer minor units; idempotent webhook handler keyed by event id | `payments`, `stripe_events` append-only | Nightly Stripe test-mode contract test; webhook-signature test; lint: no card fields in any schema; planner `strong` for the slice (synthesis §3.1) | Stable webhook alias (§4); `live_key` card before any live key |
| M-RT (`realtime`, C3) | Second deployable: socket or CRDT service behind a port; no further split (RQ3 matrix, C) | Pure, deterministic merge core (FP) | Event log for state | Two-browser evaluator; `sync_observed` evidence; deterministic merge simulation (`25-`) | Two deployables pinned to one `commit_sha` (§4) |
| M-REG (`regulated`, C4) | Audit table and consent record as first-class modules | Explicit retention and consent states | Append-only audit table; consent rows; residency check | G9 mandatory per milestone; residency probe; E4 required | Region pinned at project creation |
| M-INT (`integrations`) | One owned adapter per provider behind a port; fakes allowed only with a nightly contract test (synthesis §2 row 13) | Ports and adapters | Sync tables per provider with provenance | Contract test against the account named in `26-` gap 23; `vi.mock` allowlist | `connect_account` card; sandbox mode default |
| M-AI (`ai_core`, C2+) | Model calls behind a port; model IDs in one file; prompts as data (RQ3 matrix, C) | Functional core, imperative shell; typed tool schemas | Fixed eval set stored with the plan | Prompt-injection cases in the acceptance suite; cost ceiling per run as a gate | None extra |
| M-BATCH (`batch`, C2+) | Pure transforms plus an imperative shell on a job runner; idempotent steps (RQ3 matrix, C) | Schema per stage (Zod) | Golden files in repo | Golden-file tests; row-count and schema-drift gates | Job runner (pg_cron or Inngest) in the same deployable |

Precedence: class row first, then every module row adds. Nothing in a module row removes a class requirement (synthesis §3.1).

### 2.3 Never-asked defaults

`21-intake-protocol.md` §3 lists the questions intake never asks (RQ1 §KQ5, Spec Kit, https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/specify.md). Each becomes an assumption row with the value below and the reopen trigger shown. The planner may not change a default without a `fork` card.

| Topic | Default | Applies | Reopen trigger |
| --- | --- | --- | --- |
| Auth mechanism | Supabase Auth: magic link plus Google OAuth; server reads `getUser()` | C2+ | Founder names an identity provider |
| Sessions | Supabase cookie sessions; 7-day refresh; sign-out everywhere on password change | C2+ | A `regulated` flag (shorter sessions via M-REG) |
| Roles | C2: one role. C3: `owner`, `member` per org; `admin` only when a feature needs it | C2+ | A Q2 spine that names a second role |
| Data retention | Keep until the owner deletes; soft delete with 30-day purge | all | `regulated` flag; founder request |
| Performance targets | Lighthouse performance ≥70, accessibility ≥90 (C1–C2); ≥80, ≥95 (C3+); p95 server action < 1 s on preview | all | Founder complaint recorded as a `walkthrough` fail |
| Error handling | Typed results from server actions; a friendly message plus a reference id; errors logged server side, never shown raw | all | none |
| Framework and hosting | Next.js on Vercel; Fly only for M-RT | all | `fork` card only |
| Styling | Tailwind with a single tokens file; system fonts; no component library at C1 | all | Founder supplies a brand file |
| Analytics | None at C1; privacy-respecting page views (no cookies) at C2+ | all | Founder asks for funnels |
| Email | None at C1 (on-page confirmation); transactional email through an owned adapter at C2+ via `connect_account` | all | Founder asks for an email |
| Locale and time | Founder's locale from the company record; UTC in the database; owner zone in the UI | all | A Q2 spine with several zones |

## 3. Walking-skeleton procedure

MUST [H3 (C), H2 mechanism (c) · all · invariant] (synthesis §4.1 row 4): pipeline first, deployed preview, first acceptance test before feature code, skeleton kept and replayed nightly. RQ3 §Synthesis (3) steps 1–12, amended by the rulings. Each step names who runs it and what ends it.

| # | Step | Runs | Ends when |
| --- | --- | --- | --- |
| 1 | Classify. Read `intake.json`; the class, flags and modules select the rows of §2 and the gate set of `25-`. Record them in the `BuildPlan` header. | worker (C1), planner (C2+) | `BuildPlan` row validates |
| 2 | Pick the spine. Rule: the spine is the Q2 journey, extended to the first outside-world effect the product cannot exist without (a stored row, a sent email, a test-mode payment). It is the one `spine: true` slice. Its features are the smallest set whose `steps` cover that journey. | planner (C2+); template (C1) | `slices` has exactly one spine; every spine feature has `steps` |
| 3 | Pipeline before features. Apply the infrastructure template of §4: repository, CI with G0–G2, preview deployment, seeded database, sandbox credentials, `CLAUDE.md` and `init.sh` from templates. Open `connect_account` cards for providers in Q8 through `gate()`. | worker | A trivial page is READY on a preview URL for a pushed `commit_sha` (E2 `deploy_id`) |
| 4 | First acceptance test. The evaluator authors the suite for the spine features from `steps` into Storage (I11). It runs red against the trivial page. At C1 the template smoke suite is used. | evaluator (C2+); template (C1) | Suite exists at `acceptance/.../<sha256(steps)>/`; TestReport `fail` recorded |
| 5 | Guardrails before feature code. Install table B lints, `dependency-cruiser`, RLS probe (when `auth`), `.claude/rules/*.md`, hooks, protected-path list. | worker, from templates | G1 passes on the empty skeleton |
| 6 | Thinnest code that makes the spine pass. Real adapters, real rows, real HTTP; Transaction Script allowed; no mocks at the edges. One feature per session. | builder | Spine features reach `built` with G0–G6 pass |
| 7 | Evaluate the spine. G7 on the preview with a fresh seed; E2 and E3 rows per criterion. | evaluator and worker | `verified` on every spine feature |
| 8 | Founder walkthrough of the skeleton. One `walkthrough` review item: generated script from `steps`, one tap per step, one screenshot, one sentence (G9). DV3 is measured here. | founder | pass, or fail which opens intake round 2 (`21-` §5) |
| 9 | Widen slice by slice. Each feature: fresh session, its own `writes`, ≤400 changed lines, evaluated per the class's evaluation unit. Wave size 1 at release 1; `24-` holds the widening procedure. | worker dispatch, builder, evaluator | All features in a slice `verified`; one `walkthrough` item per slice at C2+ |
| 10 | Consolidate on the third occurrence. When three slices share a shape, the planner schedules one serial consolidation feature after the wave (I9), kept deep and behind the dependency lint. | planner, builder | G1–G7 green after the consolidation feature |
| 11 | Keep the skeleton alive. The spine suite and every verified suite replay nightly without a model (G8); a regression stops the line and triggers deterministic bisection (`24-`). | worker | Nightly report green |
| 12 | Re-classify on change. A flipped assumption or a new flag re-runs `classify()`; a class change opens one `fork` card phrased as a consequence with a default (`21-` §13). Modules add their gates from the next feature on. | worker, `gate()` | Card answered or default applied at `default_applies_at` |

Step 4 and step 6 together resolve the TDD question (synthesis §2 row 5): the evaluator's acceptance suite is the first test of every feature; the builder's unit red-green cycle is E0 and stays inside its `writes`. Per-commit gates G1–G3 run builder tests only; the acceptance suite may stay red until G7 (synthesis §2 row 6).

## 4. Infrastructure template per class and module

MUST [debate-4 §1.3 · B · all · design choice] (gap 11). What deploys where, how a preview gets a stable public URL, and how two deployables are pinned to one `commit_sha` in evidence.

| Class or module | Deployables | Preview | Production | Data | Evidence pin |
| --- | --- | --- | --- | --- | --- |
| C1, C2 | One Vercel project per company | One preview deployment per pushed `commit_sha`; deployment protection on; worker holds the bypass secret | Promotion of the verified preview build, never a rebuild (`26-`) | Founder's Supabase project; separate preview and production projects where the plan allows, else Supabase branching; migrations applied by the worker before G6 | `deploy_id` + `commit_sha` on every E2 row |
| C3 | As C2 plus the data-model-root migration first | As C2 | As C2; `go_live` card at first production | As C2 with `org_id` everywhere | As C2 |
| C4 | As C3 | As C3 | `go_live` card per milestone | Region pinned; audit and ledger tables append-only | As C3 plus E4 (founder or provider) per milestone |
| M-PAY | No new deployable | Webhooks need a stable URL: a per-company alias `preview-<companyId>.<north-preview-domain>` that the worker repoints to the latest READY preview of the integration branch; the Stripe test-mode endpoint is registered once against the alias | Production webhook on the production domain | `stripe_events` keyed by event id | Webhook test evidence names the alias and `commit_sha` |
| M-RT | Second deployable: a Fly app per company for the socket or CRDT service | One Fly release per `commit_sha` (image tag = `commit_sha`); the web preview points at it by env | Both promoted together | Event log table | E2 row carries `deploy_id` (Vercel) and `fly_release` (Fly) with the same `commit_sha`; G6 confirms both READY before G7 |
| M-INT | No new deployable | Provider sandbox or test account per `26-` gap 23; `connect_account` card for the founder's own | Live keys only via `live_key` card | Sync tables | Contract-test evidence nightly |
| M-BATCH | No new deployable; job runner in the same project | Jobs run against preview data with `{seed}` prefix | As class | Golden files | Row-count evidence per run |

Common rules: every preview run seeds fresh test data with the recorded seed and deletes nothing; one anonymous fetch without the bypass secret per G6 (debate-3 §4.2); `init.sh` boots the local stack in one command; secrets live in Vercel and Fly env, never in the repo (I15).

## 5. Always-on files for the founder repository

MUST [H9' (B), ETH (A) · all · invariant] (synthesis §4.1 `CLAUDE.md` row; §2 row 12).

| Rule | Detail |
| --- | --- |
| `CLAUDE.md` ≤200 lines, ≤8 KB | Vercel's winning index was 8 KB (https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals); Claude Code targets under 200 lines (https://code.claude.com/docs/en/memory) |
| Template, not prose | Filled from `intake.json` slots by the worker; the planner never writes it (A14). LLM-written context files cost +20% for no gain (ETH, https://arxiv.org/abs/2602.11988) |
| Fleet-shared prefix first, tenant content last | The static part is byte-identical across companies for prompt caching (debate-4 §4.5); tenant slots sit at the end |
| Non-inferable only | Commands with flags, protected paths, the four status words, pointers to `docs/SPEC.md` and `features.json`; no repository overview, no "write clean code" |
| Hooks for never-rules | `PreToolUse` denies edits outside `writes` and on protected paths; the Stop hook is a nudge, the done gate is the worker (synthesis §2 row 24) |
| `.claude/rules/<area>.md` | ≤150 lines, `paths:` frontmatter, C2+; loaded only when a matching file is touched |
| Skills | Only user-triggered procedures; none carry gate or evidence rules (synthesis §4.1) |
| `AGENTS.md` | MAY, one-line pointer to `CLAUDE.md`, only when a non-Claude agent is used (synthesis §4.2) |
| 400-line exemption | One line in the template (gap 19) |

The rendered templates, the hooks snippet, the lint configuration, `init.sh` and the `docs/SPEC.md` header are in `23a-repo-templates.md`.

## 6. What is measured before any row changes

H8' ablation: one table B row off at a time on the 20 golden tasks; keep rows whose removal raises DV5 or the evaluator fail rate. H3': skeleton-first against layer-first on two matched C2 ideas (DV3, DV5); retrieve Mellegård 2018 (doi 10.1109/MS.2018.2880822). Until then table B is an invariant and the matrix is a design choice.
