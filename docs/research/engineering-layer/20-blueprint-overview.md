# Blueprint overview: the engineering loop on one page

Purpose: the entry point for the build session; the loop, the complexity classes, the roles, the join table that says what applies at each class, and the reading order for `21`-`26`.
Related: `00-README.md`, `01-research-protocol.md`, `10-findings-and-verdicts.md`, `21-intake-protocol.md`, `22-spec-and-plan-artifacts.md`, `23-architecture-and-principles.md`, `24-team-topology-and-orchestration.md`, `25-verification-and-evidence.md`, `26-security-controls.md`.

Status: final, 2026-10-17. Every rule below is carried from `notes/synthesis-decisions.md` (§3.1, §3.2, §5, §7 gap 5); where that file and a round-1 note disagree, this file follows the rulings. Vocabulary is canonical (`synthesis-decisions.md` §3); the retired aliases listed there do not appear in the blueprint.

## 0. How to read a rule

Every rule in `21`-`26` carries five tags, in this order (`synthesis-decisions.md` header; `debate-1-skeptic.md` §8):

| Tag | Values | Meaning |
| --- | --- | --- |
| Level | MUST, SHOULD, MAY | RFC 2119 force. MUST is enforced by a hook, lint, SQL function or worker check; a MUST that can only live in prose is a defect |
| Hypothesis | H1-H13 | The claim the rule rests on; see `10-findings-and-verdicts.md` §4 |
| Grade | A, B, C, D | The lowest grade any note gave the rule's evidence. C and D rules are design choices and say "to be measured" with the experiment named |
| Classes | C1-C4, or flag names | Where the rule applies. "all" means every class |
| Kind | invariant, model-limit rule (dated), release-1 rule, design choice, process | Invariants are not re-tested. Model-limit rules carry a date and are re-run in `packages/evals` at every model release (`RQ4-agent-harness-orchestration.md` §Open 8) |

Example: "Fresh session per feature; after a failed gate restart from artifacts with `FixBrief`" is MUST, H6, A premise, all classes, model-limit rule dated 2026-10 (`synthesis-decisions.md` §4.1).

The headline rules, tagged (`synthesis-decisions.md` §4.1):

| Rule | Level | H | Grade | Classes | Kind | Detail in |
| --- | --- | --- | --- | --- | --- | --- |
| `done` only from worker or evaluator evidence (E2 + E3 per criterion) via `record_evidence()` and a SQL `done` function; `BuilderClaim` never counts | MUST | H2, H13 | A | all | invariant | 25 |
| Builder cannot write tests outside its feature, CI, lockfiles, `.claude`, `.git`, `features.json` planner fields; G0 runs worker-side on the pushed SHA | MUST | H2, H13 | A | all | invariant | 25, 26 |
| Acceptance suite authored by the Evaluator from `steps` before build, stored in North Storage, fresh recorded seed per run | MUST | H13 | A | C2+ (C1: template smoke suite) | invariant | 25 |
| Pipeline first, deployed preview, first acceptance test before feature code, skeleton kept and replayed nightly | MUST | H3 | C | all | invariant | 23 |
| Evaluator: fresh context, own config dir, read-only, no Agent or web tools, pinned alias and rubric, platform-fixed budget; deterministic criteria decide, model vetoes | MUST | H1 | A separation, B browser | all | invariant | 24, 25 |
| Fresh session per feature; restart from artifacts with `FixBrief` after any failed gate; transcript resume only for crash or timeout | MUST | H6 | A premise | all | model-limit rule, 2026-10 | 24 |
| Session-start read set ≤20 KB in fixed order | MUST | H6, H9' | B | all | invariant | 24 |
| Wave size 1; read-only fan-out ≤3 Explore subagents; parallel writers only per §2 row 7 | MUST | H7 | B/C | all | release-1 rule | 24 |
| `BuildPlan` rows canonical in DB; `features.json` a worker projection; EARS statement; Gherkin `steps`; trace-check | MUST (gates C2+, reports C1) | H5 | B | all | invariant | 22 |
| Intake: 5 multiple-choice questions, defaults pre-selected, zero cards, assumptions digest | MUST | H4, H12 | A/D | all | design choice, to be measured | 21 |
| `CLAUDE.md` ≤200 lines / ≤8 KB from a template filled by `intake.json`; hooks for anything that must never happen | MUST | H9' | B | all | invariant | 23 |
| Codebase invariants I1-I5, I8, I10-I12, I14, I15, all lint or probe | MUST | H8, H11 | A half 1 | all (I14 when `auth`) | invariant until H8' | 23 |
| Review item = one screenshot + one sentence + pass/fail/comment; one per slice, variant pick, breaker | MUST | H10 | C | all | invariant | 24 |
| Cards only from `gate()`, only for forks, with default and deadline; clusters bundled | MUST | H10 | B | all | invariant | 21, 24 |
| Appetite in dollars per feature and build; estimate shown before build; breaker at 1.5× | MUST | H13 | A | all | invariant | 24 |
| Any role may `halt`; the worker parks the build; the Planner rules before restart | MUST | andon | B | all | invariant | 24 |
| Record from build one: `evaluator_fail_rate_on_builder_done`, `evaluator_vs_founder_disagreement`, G5 flag rate, breaker trips, cost per accepted feature by role, DV1-DV6 | MUST | all experiments | n/a | all | invariant | 24 |
| No `WebFetch` or `WebSearch` on any role with write or Bash tools; builder docs are vendored snapshots | MUST | security A1, A2 | n/a | all | invariant | 26 |

## 1. The loop

```
 founder idea
      |
      v
 [1] INTAKE ---------- Planner (C1: template) ----> IntakeRecord (class, flags, assumptions)
      |                                             0 cards; <=5 questions; 1 digest
      v
 [2] PLAN ------------ Planner ---------------------> BuildPlan rows, docs/SPEC.md, ADR (C3+),
      |                                             design doc (C3+), features.json (worker projection)
      |                Evaluator ------------------> acceptance suite per feature, from `steps`,
      |                                             in North Storage (never in the repo)
      v
 [3] SKELETON -------- worker: repo from templates, init.sh, pipeline, preview (G6) before any feature
      |                Builder: spine path, fresh session, TaskBrief, writes only
      |                worker: push after gate(); G0-G6 on the pushed SHA
      |                Evaluator: G7 on the preview (E3)   Founder: G9 walkthrough item
      v
 [4] WIDEN ----------- one feature per fresh session; depends_on verified; declared writes;
      |                wave size 1; per commit G0-G2; per feature G0-G6; FixBrief on failure;
      |                attempt 1 -> 2 (fresh, same tier) -> 3 (strong) -> breaker
      v
 [5] EVALUATE -------- Evaluator per unit (C1 build, C2/C3 slice, C4 feature): fresh seed,
      |                deterministic criteria decide, model vetoes; E2 + E3 per criterion -> `done`
      |                Reviewer (C3+): ReviewReport, blocks CRITICAL/HIGH only
      |                Founder: 1 walkthrough item per slice; variant_pick; breaker items
      v
 [6] RELEASE --------- Release (worker): readiness checklist; go_live card; production =
      |                promoted immutable preview; live_key card for M-PAY
      |                nightly G8 replay; regression stops the line; Lesson row after any false done
      +----> metrics: evaluator_fail_rate_on_builder_done, evaluator_vs_founder_disagreement,
             G5 flags, breaker trips, cost per accepted feature, DV1-DV6
```

Walk-through. Each step names the owner, the artifact and the gate; detail lives in the file cited.

1. Intake (`21`). The Planner reads the idea and writes Q0: a one-paragraph press release, a breadboard, and the ten coverage categories marked Clear / Partial / Missing. Q1-Q3 are confirmations of drafts; two more slots go to the highest Impact × Uncertainty among Q4-Q9; everything else becomes a row in the assumptions digest with a reopen trigger. At most five questions, multiple choice, recommended default first, zero cards. The classifier (§2) computes class and flags and shows them as one sentence. Output: `IntakeRecord` (`intake.json`). Round 2 (max 3 questions) runs only after a failed skeleton walkthrough (`synthesis-decisions.md` §2 row 4, §3.6).
2. Plan (`22`). At C1 the intake template emits a single-slice `BuildPlan`. At C2+ the Planner writes `BuildPlan` rows (`id`, `requirement`, `requirement_hash`, EARS `statement`, `category`, `slice`, Gherkin `steps`, `evidence_required`, `depends_on`, `writes`, `assumptions`, `appetite_usd`, `status`), `docs/SPEC.md` rows with RFC 2119 keywords, an ADR for tenancy or the data-model root at C3+, and a ≤250-line design doc for the data-model-root slice at C3+ (MAY at C2). The worker regenerates `features.json` from DB rows and runs trace-check. The appetite estimate per feature and per build is shown before anything is built.
3. Acceptance suites (`25`). The Evaluator authors one acceptance suite per feature from `steps`, before the Builder starts, stored at `acceptance/<companyId>/<featureId>/<sha256(steps)>/`; a changed hash regenerates the suite. C1 uses a template smoke suite. The Builder's workspace never contains acceptance files.
4. Repo and pipeline (`23`). The worker materialises the founder's repo from templates: `CLAUDE.md` (≤200 lines, ≤8 KB, slots filled from `intake.json`), `.claude/rules/<area>.md` (C2+), `init.sh`, lint configuration for the class, the infrastructure template per class and module. A trivial page deploys to a preview (G6) before any feature code. Structural guardrails (dependency direction, boundary Zod lint, size lint, `vi.mock` allowlist) are installed here, not later.
5. Skeleton (`23`, `24`). The Builder runs in a fresh session with the read set in fixed order (`CLAUDE.md`, `## Now`, feature row plus `depends_on`, `TaskBrief`, latest `FixBrief`, `git log -20`; ≤20 KB) and implements the spine path: the P1 journey from Q2 extended to the first gated external effect. Builder tests are E0 and may be red-green (SHOULD). The Builder pushes nothing; the worker reads the workspace, runs G0 on the diff, pushes through the GitHub adapter after `gate()`, then runs G1-G6 in a verifier sandbox from the pushed SHA.
6. Skeleton evaluation (`25`). The Evaluator runs the acceptance suite on the preview with a fresh seed (G7); deterministic criteria decide, the model vetoes or ranks. E2 rows (deploy READY, HTTP with body, `db_row`) come from the worker; E3 rows from the Evaluator. The founder gets a G9 walkthrough item: a generated script from `steps`, one tap per step, one screenshot plus one sentence. DV3 is measured here.
7. Widen (`24`). Candidates are features whose `depends_on` are verified and `freshness` is `current`. Release 1 runs wave size 1 at every class. Features touching shared paths (migrations, generated types, route table, shared schemas, `package.json`, lockfile, `CONTEXT.md`, `CLAUDE.md`, `features.json`) run serially; a feature needing a migration is split into a serial `<id>-schema` feature first. Per commit only G0-G2 run. Parallel writers MAY be enabled at C2+ with `parallel: true`, declared `writes`, `docs/design/modules.json` and the deterministic integrator; never a model resolving merges.
8. Fail and retry (`24`). Any failed gate ends the session. The worker derives a `FixBrief` from the failing evidence and `TestReport` findings and starts attempt 2 in a fresh session on the same tier. Failure of attempt 2 escalates to attempt 3 on the `strong` tier. Failure of attempt 3 trips the breaker: the Planner re-plans or cancels and a `breaker` review item opens. Spend ≥1.5× `appetite_usd` trips the breaker independently. Transcripts are resumed only for `ended_reason ∈ {crash, timeout}`. Any role may `halt`.
9. Evaluate per unit (`25`). E2 runs per feature at every class. E3 runs once per build at C1, per slice at C2 and C3, per feature at C4. `done` is a SQL function requiring one E2 and one E3 row per acceptance criterion; no agent output can set it. At C3+ the Reviewer reads the diff by SHA range against a fixed checklist and blocks CRITICAL/HIGH only; items a tool can confirm are moved to G1 or G6.
10. Founder touch (`24`). Review items (5 per day) are `walkthrough` (one per slice), `variant_pick` and `breaker`. Digests are free: assumptions, lockfile diff, regression notice, trust score. Cards (3 per day) open only from `gate()`: `connect_account`, `go_live`, `fork` (phrased as a product consequence with default and `default_applies_at`), `live_key`. A fork cluster is one card with a recommended set. The Builder never asks the founder mid-build.
11. Release (`26`). Release is a worker function, not a role: readiness checklist (preview READY for the SHA, gates green for the same SHA, `TestReport` all pass, no open HIGH), then a PR, then production only after the `go_live` card. Production is the promoted immutable preview build, never a rebuild. Any live key needs a `live_key` card. Per-company kill covers runs, worktrees and preview deploys within 5 s.
12. Keep it alive (`24`, `25`). Nightly G8 replays all verified suites deterministically on staging for companies with a commit or dependency bump in the last 7 days, full sweep weekly. A regression stops the line, is bisected by reverse revert, and opens a `FixBrief`; no new feature until green. After any false done: one `Lesson` row plus one checklist or gate edit, scoped company or platform (three-company minimum). `evaluator_vs_founder_disagreement` above 20% over 10 builds moves the Evaluator to `strong` for that company.

## 2. Complexity classes

Classes describe the founder's product. North's own test tiers T0-T4 (`docs/research/real-testing-strategy.md` §3) are not used for the product (`synthesis-decisions.md` §3.1).

| Class | Name | Base rule |
| --- | --- | --- |
| C1 | `landing` | no accounts; persistence at most a form or waitlist row |
| C2 | `app` | accounts; single population; no tenancy |
| C3 | `platform` | accounts and (tenancy or two-sided) |
| C4 | `critical` | reached only through flags (payouts, regulated) |

Flags are orthogonal. Each has a minimum class and a module that adds to the class's gate set.

| Flag | Minimum class | Module | What the module adds |
| --- | --- | --- | --- |
| `payments` | C2 | M-PAY | Stripe test-mode contract test nightly; webhook-signature test; no card data touched; `live_key` card before any live key; Planner on `strong` for the payment slice |
| `payouts` | C4 | M-PAY + M-REG | as above plus the regulated module |
| `realtime` | C3 | M-RT | second deployable template; two-browser Evaluator; evidence kind `sync_observed`; deterministic merge simulation |
| `regulated` | C4 | M-REG | append-only audit table; consent record; residency check; G9 per milestone |
| `integrations ≥ 1` | unchanged | M-INT | owned adapter plus contract test per provider |
| `ai_core` | C2 | M-AI | fixed eval set; cost ceiling; prompt-injection cases in the acceptance suite |
| `batch` | C2 | M-BATCH | golden-file tests; idempotent steps |

Classifier (pure function in `packages/core/src/engineering/classify.ts`, tested; `21` gives the schema and tests):

```
auth = Q1 implies accounts; tenancy = Q4 == teams; payments = Q5 != none;
payouts = Q5 includes paying others; two_sided = Q6 == yes (both populations sign up
by themselves and transact with each other without the founder in the loop);
realtime = Q7 == live; integrations = count(Q8); regulated = Q9 == yes;
ai_core, batch from the Q0 restatement.
base = !auth ? C1 : (tenancy || two_sided) ? C3 : C2
effective = max(base, min_class(flag) for each set flag)
```

Precedence is `max()`. Flags never lower a class. Modules add to the class's gate set. `appetite` (Q3: weekend | weeks | months) sets budget ceilings only, never class. A class change at runtime (for example payments added) is a `fork` card phrased as a consequence: "you asked for payments; that adds X days and a Stripe account" (`synthesis-decisions.md` §3.7).

## 3. Roles

Role classes for tool policy are `planner`, `builder`, `critic` (Evaluator, Reviewer) and `worker` (deterministic code) (`synthesis-decisions.md` §3.2; `debate-3-security.md` §3.3). Release is a worker function, not a role.

| Role | Reads | Writes | Approves / vetoes | Active at |
| --- | --- | --- | --- | --- |
| Planner | intake record, repo, SPEC, evidence | `BuildPlan` rows, `docs/SPEC.md`, `docs/adr/`, `docs/design/`, `TaskBrief` | rules below the architectural line; never done | C2+ (C1: template fills the plan from intake) |
| Builder | `TaskBrief`, its owned `writes`, `FixBrief` | its `writes` only; never tests outside its feature, CI, lockfile, `features.json`, `.git`, `.claude` | none; may `halt` | all |
| Evaluator | `steps`, preview URL, probes, gates JSON; never builder transcript or claim | acceptance suite in North Storage; `TestReport`; evidence via worker | veto on done; `halt` | all |
| Reviewer | diff by SHA range, plan, checklist | `ReviewReport` | block on CRITICAL/HIGH only | C3, C4 |
| Consultant | fork of the asking role's context | written opinion in ledger | advisory | escalation level 2, C3+ |
| Release (worker) | gates, evidence, SHA | push, preview, production via `gate()` | only path to production | all |
| Founder | everything | cards, review items, kill switch | final on forks and go-live | all |

Permissions are enforced by the runtime, not the prompt: a persona with `critic: true` is forced to `disallowedTools: [Bash, Write, Edit, MultiEdit, NotebookEdit, Agent, WebFetch, WebSearch]`, a separate config dir, and no `artifacts.write`; `AskUserQuestion` is removed from builder and critic tool lists; `CLAUDE_CODE_FORK_SUBAGENT=0` for every critic (`synthesis-decisions.md` §2 rows 30, 33; §6).

Model tiers by alias (IDs only in `packages/core/src/models.ts`): `fast`, `standard`, `strong`. Defaults: Builder `standard`; Evaluator `standard` at high effort; transcript audit `fast`; Planner `standard` at C2, `strong` at C3+ and for any M-PAY slice. `effort` and tool lists stay constant within a role's run (cache invalidation); forks are used only for variant drafts (N = 2-3), never for critics.

## 4. The join table

One table from class to everything downstream (`synthesis-decisions.md` §5, §3.4, §7 gap 5). Columns are cumulative: C2 includes C1, and so on. Every dollar figure and count is an estimate until `agent_runs` measures 20 golden tasks (§8).

| | C1 `landing` | C2 `app` | C3 `platform` | C4 `critical` |
| --- | --- | --- | --- | --- |
| Features / slices (typical, est.) | 6 / 1 | 30 / 6 | 50-80 / 8-12 | 80+ / 12+ |
| Gates | G0, G1, G2, G5 (deterministic flags plus `fast` audit), G6, G7 once, G8, G9 per build | + G3, RLS probe, trace-check as gate, G7 per slice, G9 per milestone | + Reviewer, ADR, design doc, cross-tenant and cross-role probe, M-RT when flagged | + M-PAY / M-REG modules, G7 per feature, G4 nightly informational, Consultant on escalation |
| Roles | Builder + Evaluator + worker (plan from template) | + Planner (`standard`; `strong` on an M-PAY slice) | + Reviewer; Planner `strong`; Consultant on escalation level 2 (MAY) | + Consultant on escalation level 2; security checklist mandatory |
| Evaluator tier | `standard`, one pass | `standard` per slice; `strong` after sustained founder disagreement | `standard` per slice | `standard` per feature |
| Evaluation unit (E3) | the build (one slice) | slice | slice | feature |
| Evidence for `done` | one E2 and one E3 row per acceptance criterion | same | same, plus cross-tenant E3 rows | same, plus module evidence (`sync_observed` for M-RT; audit and consent probes for M-REG) |
| Retry caps | attempt 1 and 2 `standard` (attempt 2 fresh with `FixBrief`), attempt 3 `strong`, then breaker; 1.5× appetite | same | same | same |
| Review items per build (est.) | 2 (direction pick, skeleton walkthrough) + 1 digest | ~10 (6 slice walkthroughs, 1 pick, ~2 breakers) + digests | ~15 | ~20 |
| Cards per build (est.) | 2 (`connect_account`, `go_live`) | ~4 (+ `live_key`, one `fork`) | 6-8, bundled by cluster | 8-12, bundled; defaults apply at deadline |
| Claude cost per feature (est.) | $0.75 | $1.50 | $2.50 | $3.75 |
| Claude cost per build (est.) | $4.5 (+$0.3 for 3 forked directions) | ~$45 | ~$150-200 | ~$300 |
| Founder journey check | $4.8 + $1.71 non-engineering = $6.5 < $8 | n/a; price per accepted feature | n/a | not dogfoodable inside $100/month |
| Appetite breaker | build $6; change run $1; 1.5× → `breaker` item | build $60 | build $250 | build $400 |
| G9 founder walkthrough | per build | per milestone | per milestone | per milestone; mandatory under M-REG |
| Infrastructure (`23`) | one deployable; preview per branch; founder's own Supabase when a row is stored | one deployable; stable preview URL for provider webhooks when `payments` or `integrations` | second deployable only through the M-RT template, both pinned to one `commit_sha` | same, plus M-PAY and M-REG provider accounts per `26` |
| Artifacts beyond the six always-on | none | `.claude/rules/<area>.md`; design doc MAY | `docs/adr/`, `docs/design/<slice>.md` (data-model-root slice) | + module artifacts; `docs/design/modules.json` only with `parallel: true` |
| Security additions (`26`) | base table imposed, no founder switch | RLS probe as unauthenticated user; secret and bundle JWT scan; M-PAY webhook-signature test when flagged | `tenant_id` in every policy; second-org, second-role, unauthenticated probes as required E3 rows | append-only audit table, consent record, residency check (M-REG) |

Always-on artifacts at every class: `CLAUDE.md` (template), `docs/SPEC.md`, `docs/plans/features.json` (projection), `docs/plans/progress.md`, `init.sh`, git (`synthesis-decisions.md` §2 row 17). Not in the founder's repo at any class: acceptance suites, `TaskBrief`, `BuilderClaim`, `GateReport`, `TestReport`, `ReviewReport`, `FixBrief`, `Lesson`.

Thresholds carried into the gates (`synthesis-decisions.md` §5; detail in `25`): assertion density ≥1 value assertion per test; edit/test cycles per file ≤8 before G5 flags; rate-limit probe 30 requests in 10 s expects 429; Lighthouse performance ≥70 and accessibility ≥90 at C1-C2, ≥80 and ≥95 at C3+; PR ≤400 changed lines (generated files and lockfiles excluded); axe `violations == []`. All tuned on DV5, never on self-report.

One inconsistency inside the rulings, for the build session: `synthesis-decisions.md` §3.4 lists the G5 transcript audit as C2+, while §5 includes a `fast` audit at C1 at about $0.02 per run. This table follows §5; treat the C1 audit as MAY until `agent_runs` shows whether it ever vetoes at C1.

Monthly dev budget, tiered (est.): $49 in total; 80 change runs $22, 4 acceptance builds $19, nightly G8 $3, sandbox $5 (`debate-2-pragmatist.md` §1.4).

Gates at a glance (`synthesis-decisions.md` §3.4; detail and thresholds in `25`):

| Gate | Content | Runs | Decides | Classes |
| --- | --- | --- | --- | --- |
| G0 | protected-path diff on the pushed SHA: tests outside the feature, `e2e/acceptance/**`, CI, lockfile, `.github/**`, `.claude/**`, `features.json` planner fields | worker | deterministic; a hit fails the task | all |
| G1 | typecheck, lint (`--max-warnings 0`), build, file ≤400 / function ≤50, boundary and dependency-direction lint, `vi.mock` allowlist, PR ≤400 changed lines | worker verifier sandbox | exit codes | all |
| G2 | builder unit and property tests, `failOnFlakyTests` | worker | exit code | all |
| G3 | integration tests on local Supabase and Inngest | worker | exit code | C2+ |
| G4 | mutation score (StrykerJS incremental) | worker, nightly | informational only | C4 |
| G5 | gaming scan: assertion-density lint, special-case grep, edit/test-cycle count from `audit_tool_calls`; transcript audit on `fast` | worker; model veto-only | deterministic flags fail; audit vetoes | all (audit: see note above) |
| G6 | preview deploy READY for `commit_sha` via provider API; smoke HTTP with body assertions; secret scan; client-bundle JWT scan; frozen-lockfile install; OSV scan; security headers; RLS probe when `auth` | worker | deterministic | all |
| G7 | Evaluator runs the acceptance suite from Storage with a fresh recorded seed on the preview; axe `violations == []`; Lighthouse thresholds; DB probes; per-criterion hard thresholds; E3 rows | Evaluator + worker | deterministic per criterion; model may veto or rank only | all; unit per the join table |
| G8 | nightly deterministic replay of all verified suites on staging, no model; companies with a commit or dependency bump in the last 7 days; full sweep weekly | worker | regression stops the line | all |
| G9 | founder walkthrough: generated script from `steps`, one tap per step | Founder | human | per the join table |

## 5. Vocabulary quick reference

Evidence levels (`synthesis-decisions.md` §3.5). Every row carries `producer`, `commit_sha`, `preview_url`, `check_version`, `sha256`, `captured_at`, `seed`; rows are append-only; `done` is a SQL function over them.

| Level | Content | Producer | Counts toward `done`? |
| --- | --- | --- | --- |
| E0 | `builder_claim`: the Builder's statement, its own test output, its own suite | builder | never |
| E1 | worker tool output: typecheck, lint, build, test report, hashed log | worker | gate only |
| E2 | worker preview facts: `deploy_id`, HTTP status plus body, `db_row`, `sync_observed` (M-RT) | worker | required, one per criterion |
| E3 | Evaluator run: trace, screenshots, axe, Lighthouse, per-criterion pass/fail, `seed` | evaluator | required, one per criterion |
| E4 | founder walkthrough or provider confirmation | founder, provider | milestone acceptance; every external action |

Status, one word per axis (`CONTEXT.md` carries the same words): `status.build ∈ {todo, in_progress, built}` (worker-derived from `agent_runs`); `status.verification ∈ {unverified, verified, failed}` (`verified` is the only meaning of done); `status.blocked_on = { kind: feature | card | integration, id, default, default_applies_at }`; `status.freshness ∈ {current, suspect}` (trace-check from `requirement_hash` and flipped assumptions). `agent_runs.ended_reason ∈ {completed, budget, kill_switch, crash, timeout, decision_wait}`.

Founder-facing kinds. Review items (count against 5 per day): `variant_pick`, `walkthrough`, `breaker`. Digests (free): assumptions digest, lockfile diff, regression notice, trust score. Cards (count against 3 per day; opened only by `gate()`): `connect_account`, `go_live`, `fork`, `live_key`.

Handoff artifacts (Zod schemas in `packages/core/src/engineering/*.ts`; see `22`): `IntakeRecord`, `BuildPlan`, `TaskBrief`, `BuilderClaim`, `GateReport` (`gates.json`), `TestReport`, `ReviewReport`, `FixBrief`, `Lesson`, `Evidence`. Storage paths: `acceptance/<companyId>/<featureId>/<sha256(steps)>/` and `evidence/<companyId>/<taskId>/<commit_sha>/<check>/<sha256>` (write-once).

## 6. The throughput ceiling

The review budget, not compute, bounds how fast a build completes (`synthesis-decisions.md` §5; `debate-2-pragmatist.md` §3). A C2 build of about 30 features produces about 10 review items and about 4 cards. At 5 items and 3 cards a day that is at least two founder-days of review and two days of cards, however fast the agents build. The founder sees this estimate before the build starts, next to the appetite. The budget is only consistent if every item is one screenshot plus one sentence with pass / fail / comment, which is why that shape is MUST.

Three rules keep the ceiling from falling: review per slice, not per feature; fork clusters bundled into one card with a recommended set and a default that applies at `default_applies_at`; and digests (assumptions, lockfile diff, regression notice, trust score) that cost no quota.

## 7. Reading order for the build session

Read in this order. Each file answers one question and carries the rulings listed in `synthesis-decisions.md` §8.

| Order | File | Question it answers | Carries |
| --- | --- | --- | --- |
| 1 | `00-README.md` | What is in this folder and how does a build session use it? | grading rule; §5 caveat on numbers |
| 2 | `20-blueprint-overview.md` (this file) | What is the loop, which class am I in, who does what, what applies at my class? | §3.1, §3.2, §5 |
| 3 | `21-intake-protocol.md` | Which questions, in what order, when to stop, how to classify, what the C1 plan looks like, how cards carry defaults? | §2 rows 4, 16; §3.1; intake rule; gaps 7, 12, 14 |
| 4 | `22-spec-and-plan-artifacts.md` | What are the artifacts, their Zod schemas, size bounds and owners; how do `BuildPlan`, `features.json`, `progress.md`, `TaskBrief`, `FixBrief`, `GateReport`, `TestReport`, `ReviewReport`, `Lesson` look? | §2 rows 17, 19, 21; §3.3; gaps 2, 3, 7, 8 |
| 5 | `23-architecture-and-principles.md` | Which invariants bind agents and which bind the codebase, with the lint or probe for each; the decision matrix by class and module; the walking-skeleton procedure; infrastructure and `CLAUDE.md` templates? | §4.1 invariants; §2 rows 5, 6, 12; gaps 4, 11, 15, 19 |
| 6 | `24-team-topology-and-orchestration.md` | Roles and permissions; session-start read set; fresh-context and restart rules; retry state machine; escalation ladder and the architectural line; widening procedure; fleet table; lesson scope; review-queue and card policy; metrics? | §2 rows 1, 2, 3, 7, 8, 20, 25, 26, 27; §3.5; gaps 1, 6, 9, 17, 18, 22 |
| 7 | `25-verification-and-evidence.md` | Evidence ladder E0-E4 with schema; gates G0-G9 with class column; evaluation unit; acceptance-suite authorship, storage and regeneration; mock policy as lint; gaming scan; nightly G8 and bisection; walkthrough script; thresholds; `sync_observed`? | §2 rows 5, 6, 8, 13, 14, 15; §3.4; §3.5; gaps 10, 13, 16, 21 |
| 8 | `26-security-controls.md` | Threat model; the twenty MUST rules with amendments; generated-app security table and class modules; kill switch and quota; provider sandbox ownership; spec corrections? | §6; §2 rows 18, 22, 23, 24; gaps 16, 20, 23 |
| 9 | `10-findings-and-verdicts.md` | Why these rules; what the evidence supports and refutes; what North must measure? | §1, §2, deletions |
| 10 | `01-research-protocol.md` and `notes/synthesis-decisions.md` | The question, variables and hypotheses; the rulings themselves | source of record |

Where a `2x` file is silent, prefer the lowest-cost deterministic option and label the rule "to be measured" (`synthesis-decisions.md` §8 closing line).

## 8. Numbers that are estimates until `agent_runs` measures them

Provenance from `synthesis-decisions.md` §5. The build session publishes no per-feature price before 20 golden tasks (C1-C2) have run in `packages/evals`.

| Number | Status | Replace with |
| --- | --- | --- |
| Claude cost per feature $0.75 / $1.50 / $2.50 / $3.75 and per build $4.5 / ~$45 / ~$150-200 / ~$300 | Estimate: assumed token shapes, 25 builder turns, 8 screenshots per Evaluator run, p_fail 0.35, 0.6 expected fix rounds (`debate-2-pragmatist.md` §1.2) | `agent_runs` median and p90 per class and role |
| Feature and slice counts per class (6/1, 30/6, 50-80/8-12, 80+/12+) | Estimate from proposal texts | `BuildPlan` row counts per tagged project |
| Review items and cards per build (2+1, ~10, ~15, ~20; 2, ~4, 6-8, 8-12) | Derived counts, not observed (`debate-2-pragmatist.md` §3) | `review_items` and `decision_cards` per build |
| Monthly dev budget $49 (80 change runs $22, 4 acceptance builds $19, nightly $3, sandbox $5) | Estimate | ledger by month |
| Evaluation unit per class, retry caps (2 then `strong` then breaker), appetite multiples (1.5×), appetite ceilings ($6 / $60 / $250 / $400) | Design constants | re-tune on DV2 and DV5 only |
| Thresholds: assertion density ≥1, cycles ≤8, 30 requests in 10 s, Lighthouse 70/90 and 80/95, PR ≤400 lines | Design constants | re-tune on DV5 |
| Question cap of 5, round 2 cap of 3, read set ≤20 KB, `CLAUDE.md` ≤200 lines / ≤8 KB, `## Now` ≤40 lines | Vendor conventions and proxy data (B/D) | H4', H9' and read-set experiments (`10-findings-and-verdicts.md` §8) |
| Fresh session per feature | Model-limit rule dated 2026-10 | H6' at each model release |
| Wave size 1 | Release-1 rule | H7' |
| Evaluator `standard` tier; `strong` after >20% sustained disagreement over 10 builds | Design constant | `evaluator_vs_founder_disagreement` from build one |
| Anthropic sanity anchor: $124.70 per app, planner $0.46, QA rounds $3.09-4.06; $0.13 per criterion both ways | Measured once, B, n=1 (`RQ2-spec-and-plan-formats.md` §KQ1) | not a target; a check that estimates are in the right decade |
| Published per-MTok prices | B, vendor price list (`real-testing-strategy.md` §3.1) | re-read at each price change |

Measured from build one, by rule (MUST): `evaluator_fail_rate_on_builder_done`, `evaluator_vs_founder_disagreement`, G5 flag rate, breaker trips, cost per accepted feature by role, and DV1-DV6, all from logs and evidence rows, never from agent or founder self-report.
