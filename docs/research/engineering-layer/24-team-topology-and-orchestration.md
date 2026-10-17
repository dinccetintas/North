# 24. Team topology and orchestration

Purpose: the roles, permissions, session rules, retry and escalation machines, widening
procedure, continuity model, fleet table and attention policy that the build session
implements for North's engineering layer.

Related: `00-README.md`, `01-research-protocol.md`, `10-findings-and-verdicts.md`,
`20-blueprint-overview.md`, `21-intake-protocol.md`, `22-spec-and-plan-artifacts.md`,
`23-architecture-and-principles.md`, `25-verification-and-evidence.md`,
`26-security-controls.md`. Rulings carried: `notes/synthesis-decisions.md` §2 rows 1, 2,
3, 7, 8, 20, 25, 26, 27; §3.5; gaps 1, 6, 9, 17, 18, 22.

## 0. Rule tag convention

Every rule carries `[LEVEL · hypothesis · lowest grade · classes · kind]`. `LEVEL` is MUST,
SHOULD or MAY. `kind` is `invariant` (holds regardless of model) or `model-limit (dated)`
(re-tested in `packages/evals` at each model release, synthesis-decisions §4.1). Every
dollar figure and count in this file is an estimate until `agent_runs` replaces it after
the 20 golden tasks (synthesis-decisions §5).

## 1. Roles, permissions and class activation

Role classes for tool policy are `planner`, `builder`, `critic` (Evaluator, Reviewer) and
`worker` (deterministic code). Retired aliases are not used anywhere: generator, coder,
implementer, QA agent, auditor, judge, "Release worker" as a role (synthesis-decisions §3.2).

| Role | Class | Reads | Writes | Approves or vetoes | Active at |
| --- | --- | --- | --- | --- | --- |
| Planner | `planner` | intake record, repo, `docs/SPEC.md`, evidence | `BuildPlan` rows, `docs/SPEC.md`, `docs/adr/`, `docs/design/`, `TaskBrief` | rules below the architectural line (§5); never done | C2+ (C1: template fills the plan from intake) |
| Builder | `builder` | TaskBrief, its owned `writes`, FixBrief | its `writes` only; never tests outside its feature, CI, lockfile, `features.json`, `.git`, `.claude` | none; may `halt` | all |
| Evaluator | `critic` | `steps`, preview URL, probes, gates JSON; never the builder transcript or `BuilderClaim` | acceptance suite in North Storage; `TestReport`; evidence via worker | veto on done; `halt` | all |
| Reviewer | `critic` | diff by SHA range, plan, checklist | `ReviewReport` | block on CRITICAL/HIGH only | C3, C4 |
| Consultant | `planner` (fork) | fork of the asking role's context | written opinion in ledger | advisory | escalation level 2, C3+ |
| Release | `worker` | gates, evidence, SHA | push, preview, production via `gate()` | only path to production | all |
| Founder | human | everything | cards, review items, kill switch | final on forks and go-live | all |

Tool policy per class, enforced by the runtime and checked by a Vitest test over every
persona file (`26-security-controls.md` rules 5, 6):

| Class | Allowed | Forbidden | Config dir |
| --- | --- | --- | --- |
| `planner` | Read, Glob, Grep, `mcp__north__*` read tools, Write to `docs/**` only | Bash, WebFetch, WebSearch, `AskUserQuestion` | `<configRoot>/<companyId>/planner` |
| `builder` | Read, Write, Edit, MultiEdit, Glob, Grep, Bash (sandboxed), ≤3 Explore subagents | WebFetch, WebSearch, `AskUserQuestion`, `Agent` with write tools, fork subagents | `<configRoot>/<companyId>/builder` |
| `critic` | Read, Glob, Grep, `mcp__north__page_screenshot`, `mcp__north__http_probe`, `mcp__north__db_probe` | Bash, Write, Edit, MultiEdit, NotebookEdit, Agent, WebFetch, WebSearch, `artifacts.write` | `<configRoot>/<companyId>/critic` |
| `worker` | North code; GitHub, Vercel, Supabase adapters through `gate()` | n/a | n/a |

Rules:

- Persona schema field `critic: true` forces the forbidden list above and a separate config
  dir. `[MUST · H1 · A · all · invariant]` (synthesis-decisions §2 row 30; debate-3 §3.1).
- No persona holds both `fs.write` and `errors.read` unless `buildTaskPrompt` wraps error
  text as data, verified by a Vitest test. `[MUST · H11 · B · all · invariant]`.
- `repo.push`, `deploy.preview` and `deploy.production` are worker actions after `gate()`,
  never persona tools. `[MUST · CLAUDE.md rule 1 · invariant · all]`.
- Model tiers by alias (IDs only in `packages/core/src/models.ts`): builder `standard`;
  evaluator `standard`, high effort; transcript audit `fast`; planner `standard` at C2,
  `strong` at C3+ and for any M-PAY slice. `[MUST · H12 · B · all · design choice]`.
- `effort` and tool lists stay constant within a role's run; fleet-shared static prefix
  first, tenant content last; fork only for variant drafts (N = 2 or 3), never for critics.
  `[MUST · H1, RQ4 §Q7 · B · all · invariant]`.

## 2. Session-start read set (gap 1)

The dispatcher (worker) assembles this set in this order and passes it in the prompt. The
builder never browses `docs/` to find context. `[MUST · H6, H9' · B · all · invariant]`
(debate-4 §3.3 item 3; Liu U-curve for the order, RQ6 §KQ2, A).

| # | Item | Cap | Source |
| --- | --- | --- | --- |
| 1 | `CLAUDE.md` of the founder repo (template) | ≤200 lines, ≤8 KB | repo root |
| 2 | `## Now` head of `docs/plans/progress.md` | ≤40 lines, ≤3 KB | repo |
| 3 | The feature row plus its `depends_on` rows | ≤2 KB | `features.json` projection |
| 4 | `TaskBrief` for this task | ≤120 lines | North DB |
| 5 | Latest `FixBrief` for this feature, if any | ≤2 KB | North DB (derived projection) |
| 6 | `git log -20 --oneline` | ≤2 KB | task workspace |
| Total | | ≤20 KB before the first source file is opened | |

Order inside the prompt: spec and acceptance criteria (`steps`) at the start, the task at
the end. `[SHOULD · H6 · A · all · model-limit (2026-10)]`. The `## Log` tail of
`progress.md` is never in the read set. Evidence rows are never in the read set; the
worker derives `FixBrief` from failing evidence and `TestReport` findings
(synthesis-decisions §2 row 28).

## 3. Fresh context and never-resume rules

| Rule | Tag | Source |
| --- | --- | --- |
| One fresh session per feature. SDK auto-compaction is allowed within a session. Multi-feature sessions with compaction are re-tested per model release with H6'. | `[MUST · H6 · A premise, B remedy · all · model-limit (2026-10)]` | synthesis-decisions §2 row 1; Laban 2505.06120 |
| After any failed gate: never resume or compact. Start a new session from artifacts plus `FixBrief`. | `[MUST · H6 · A · all · invariant]` | §2 row 2; debate-4 §3.3 item 7 |
| Transcript resume only when `agent_runs.ended_reason ∈ {crash, timeout}`. `completed`, `budget`, `kill_switch`, `decision_wait` start fresh from artifacts. | `[MUST · H6 · B · all · invariant]` | debate-4 §3.3 item 7 |
| Parallel read-only fan-out ≤3 Explore subagents, Write and Edit denied, each returning a summary. | `[MUST · H7 · B · all · release-1 rule]` | RQ4 §Deliverable 2 node 1 |
| The evaluator is never a fork of the builder; `CLAUDE_CODE_FORK_SUBAGENT=0`. | `[MUST · H1 · A · all · invariant]` | debate-3 MUST 5 |

Why not compaction after failure: a recap carries the wrong turn (Laban: Recap 76.6 vs
Concat 90.9, RQ6 §KQ2). A consolidated restart is the measured remedy.

## 4. Retry state machine (gap 6)

One machine, counters in `agent_runs`. SPEC AGT-3 governs: two attempts, then escalate.
`[MUST · H13 · A · all · invariant]` (synthesis-decisions §2 row 20, §3.7).

```
state          builder tier   session           input                      on pass        on fail
-------------  -------------  ----------------  -------------------------  -------------  -----------------------
attempt_1      standard       fresh             read set (§2)              verified       -> attempt_2
attempt_2      standard       fresh             read set + FixBrief_1      verified       -> attempt_3 (AGT-3 escalation)
attempt_3      strong         fresh             read set + FixBrief_2      verified       -> breaker
breaker        none           none              planner re-plans/cancels   -> attempt_1   -> cancelled
                                                 opens `breaker` item         (new plan)
```

Rules on the machine:

- A failed gate is any of: G0 hit, G1-G3 non-zero exit, G5 deterministic flag or audit
  veto, G6 failure, any G7 criterion failed (`25-verification-and-evidence.md` §2).
- `429` or `529` from the gateway, `crash` and `timeout` never count as an attempt. The
  worker requeues with backoff (§8). `[MUST · gap 17 · invariant · all]`.
- Independent breaker: spend ≥1.5× `appetite_usd` for the feature or the build opens a
  `breaker` review item regardless of attempt count. Default `stop` applies at 24 h.
  `[MUST · H13 · A · all · invariant]` (§2 row 27).
- Edit/test cycles on one file >8 (counted from `audit_tool_calls`) is a G5 flag that ends
  the attempt; the builder does not continue the loop (Cursor: "hacking increased when
  told to keep working", RQ5 §KQ2, A).
- The builder has a legitimate exit: `halt` with reason `spec_and_tests_disagree`. It ends
  the attempt without counting as a failure and opens a `breaker` item for the planner
  (ImpossibleBench abort option 54%→9%, RQ6 §KQ5, A).
- `attempt` and `ended_reason` are written by the worker only. The `FixBrief` names the
  failing gate, the failing criterion ids, the probe output and the TestReport findings,
  nothing from the previous transcript.

## 5. Escalation ladder and the architectural line (gap 22)

| Level | Who rules | Trigger | Output | Cost |
| --- | --- | --- | --- | --- |
| 0 | Deterministic tie-break | Any disagreement a test, gate or probe can settle | The role asserting a fact produces it; the result is final | $0 |
| 1 | Planner ruling | Design choice within the plan, Reviewer MEDIUM/LOW, scope question | `Ruling: what, why, cost if wrong` in the ledger; dissent logged, roles commit | planner turn |
| 2 | Consultant | Ruling would change an ADR, or Reviewer holds HIGH against the ruling (C3+) | written opinion in ledger; planner rules again | one `strong` fork |
| 3 | Founder card | The architectural-line checklist below returns yes | `fork` card with default and `default_applies_at` | 1 of 3 daily cards |

`[MUST · H10 · B split, C cadence · all · invariant]` (RQ7 §KQ7 (3); synthesis-decisions
§3.5). Hard vetoes no ruling overrides: evaluator fail on a criterion, Reviewer
CRITICAL/HIGH, any `halt`, Release readiness checklist, the kill switch.

Architectural-line checklist (worker evaluates; a card is allowed only on a yes):

```
1. Would the change create or supersede an ADR (docs/adr/)?                      yes/no
2. Would it change the stack named in intake.json or the infrastructure template?  yes/no
3. Would it add an integration not in intake.json Q8 (new provider, new OAuth)?    yes/no
4. Would it reach production or enter a live key (K2)?                             yes/no
any yes -> level 3 `fork` card (or `connect_account` / `go_live` / `live_key`)
all no  -> level 1 planner ruling; never a card
```

Cards are phrased as a product consequence with a recommended default ("you asked for
payments; that adds X days and a Stripe account"). A fork cluster is bundled into one card
with a recommended set (debate-4 §7.7). Appetite overrun is a `breaker` review item, never
a card (§2 row 27). The builder never asks the founder mid-build; `AskUserQuestion` is
removed from builder and critic tool lists (§2 row 33).

`halt` (andon): any LLM role emits `halt` through the North tool
`mcp__north__halt { reason, feature_id }`. The worker parks the build, sets
`agent_runs.ended_reason = decision_wait` for the run and opens a `breaker` item. The
planner rules before restart. `[MUST · RQ7 §KQ1 andon · B · all · invariant]` (§2 row 31).

## 6. Sequential vs parallel decision tree

Release 1: wave size 1 at every class. `[MUST · H7 · B/C · all · release-1 rule]`
(synthesis-decisions §2 row 7; RQ4 §Deliverable 2).

```
unit of work arrives
1. produces writes?            no  -> read-only fan-out, ≤3 Explore subagents, summaries back
                               yes -> 2
2. BuildPlan row exists with    no  -> planner (C2+) or intake template (C1) writes it first
   steps, writes, depends_on?   yes -> 3
3. plan.parallel == true AND    no  -> single builder, sequential (release 1 default)
   class ≥ C2 AND
   docs/design/modules.json
   exists AND writes declared?  yes -> 4
4. H7' has been run and won     no  -> single builder, sequential
   for this class?              yes -> wave per §7, size ≤ min(5, budget ÷ mean feature cost)
```

Conditions for later parallel waves, all required: `parallel: true` in the BuildPlan,
declared `writes` on every candidate row, `docs/design/modules.json`, the deterministic
integrator of §7, and a recorded H7' result on golden tasks showing lower DV3 with no worse
DV2 or DV5. A model never resolves merges (debate-3 §3.2).

## 7. Horizontal widening procedure (gap 9)

From debate-4 §5. Preconditions: skeleton verified (one E2 and one E3 row exist);
`BuildPlan` rows carry `depends_on`, `slice`, `writes: [glob]`; `docs/design/modules.json`
exists when `parallel: true`.

```json
// docs/design/modules.json (Zod: ModulesMapSchema in packages/core/src/engineering/)
{ "modules": [ { "module": "billing", "paths": ["src/billing/**"], "owner": "feature-id" } ],
  "shared": ["supabase/migrations/**", "src/db/types.ts", "src/routes.ts",
             "packages/schemas/**", "package.json", "pnpm-lock.yaml",
             "CONTEXT.md", "CLAUDE.md", "docs/plans/features.json"] }
```

| Step | Who | Action | Stop condition |
| --- | --- | --- | --- |
| 1 Partition | worker | Candidates = rows with all `depends_on` verified and `freshness: current`. A wave is a maximal set whose `writes` are pairwise disjoint and disjoint from `shared`. Rows touching `shared` are serial features run alone between waves. Order by feature id. Wave size ≤ min(5, remaining budget ÷ mean cost per feature of this class); release 1: 1. | no candidates |
| 2 Schema first | planner | Any wave feature needing a migration is split: serial `<id>-schema` (migration, generated types, Zod) runs first; the feature depends on it. Builders in a wave never write migrations. | n/a |
| 3 Build | builder | Branch `feat/<id>` from `main` tip, own task workspace, fresh session, read set §2. PreToolUse hook denies edits outside `writes`. Branch gates G0-G5; branch preview; E2 rows for the branch. | gate fail → §4 |
| 4 Integrate | worker | Merge wave branches onto `integration` in id order with `--no-ff`; run G1-G3 after each merge. Conflict: stop, `blocked_on: { kind: integration }`, FixBrief "rebase onto `<sha>`, re-run gates" for a fresh builder. G1-G3 failure after a clean merge: revert that merge commit, same FixBrief. No model touches a merge. | conflict or failure |
| 5 Evaluate | evaluator + worker | Deploy `integration` preview; run the suites of all wave features plus every previously verified suite (regression, DV5). E3 rows against the integration `commit_sha`. Done is set only from integration evidence. | any criterion fails |
| 6 Regression triage | worker | Revert wave merges in reverse id order, re-running only the failed suite each time, until green. Last reverted feature is the culprit; FixBrief names the failing feature id. Deterministic bisection, no model. | green |
| 7 Promote | worker | Fast-forward `main` to `integration`; regenerate `features.json`; rewrite `## Now`; Release gates decide whether a `go_live` card is due. | n/a |
| 8 Consolidate | planner | Rule-of-three extraction (I9) is a serial feature after a wave, never inside one. | n/a |

`[MUST · H7, H3 · B/C · C2+ when parallel · design choice, to be measured]`. With wave
size 1 the same steps run with one branch; steps 4 and 6 are then trivial.

## 8. Multi-session continuity (debate-4 §3)

What persists where. Evidence rows and `agent_runs` are canonical; `features.json` is a
worker-regenerated projection; planner-owned fields are hash-protected
(synthesis-decisions §2 row 19).

| State | Home | Writer | Bound |
| --- | --- | --- | --- |
| Intake answers, class, flags, assumptions with `reopen_trigger` | `IntakeRecord` row; `intake.json` | intake step | one row |
| Requirements and `requirement_hash` | `docs/SPEC.md`; `BuildPlan.requirement_hash` | planner | one row per ID |
| Feature status, attempts, blockers, cost | `agent_runs`, `evidence`; projected to `docs/plans/features.json` | worker | projection regenerated after every run |
| Progress | `docs/plans/progress.md`: `## Now` rewritten each session; `## Log` append-only | worker from `agent_runs` | `## Now` ≤40 lines |
| Pending cards, defaults, deadlines | `blocked_on { kind, id, default, default_applies_at }`; feature `assumptions: [id]` | worker applies default at deadline, marks dependants `freshness: suspect` | n/a |
| Acceptance suite | `acceptance/<companyId>/<featureId>/<sha256(steps)>/` in North Storage | evaluator; regenerated on hash change | never in the repo |
| TaskBrief, BuilderClaim, GateReport, TestReport, ReviewReport, FixBrief, Lesson | North DB rows or Storage objects referenced from `agent_runs` | roles named in `22-spec-and-plan-artifacts.md` | never in the repo |
| Branches, task workspaces, preview URLs, `deploy_id` | `agent_runs` columns; `## Now` environment facts | worker | stale workspaces reaped at `ended_reason` |
| Transcripts | `agent_session_entries` mirror; local copy purged after flush | SDK + worker | resume only for crash/timeout |

Recovery procedure for a fresh session (worker, deterministic):

1. Read `agent_runs` for the company ordered by `started_at`; take the last run per feature.
2. If the last run has `ended_reason ∈ {crash, timeout}` and the transcript mirror is
   complete, resume by `session_id`. Otherwise discard the transcript.
3. Regenerate `features.json` and `## Now` from `agent_runs` and `evidence`.
4. Apply any `blocked_on.default` whose `default_applies_at` has passed; write the
   assumption row; mark dependants `freshness: suspect`.
5. Reap task workspaces whose run has ended; label and cancel orphaned preview deploys.
6. Pick the next candidate per §7 step 1 and dispatch with the read set of §2.

## 9. Fleet table (gap 17)

| Dimension | C1 `landing` | C2 `app` | C3 `platform` | C4 `critical` |
| --- | --- | --- | --- | --- |
| Isolation unit | task workspace `<workspaceRoot>/<taskId>`; config dir per `(companyId, roleClass)` | same | same | same |
| Builder sandbox | SDK OS sandbox in-process (M7); est. compute $0.05/run | same; per-task VM from pinned snapshot when `SandboxProvider` lands (M9) | per-task VM | per-task VM |
| Verifier sandbox | one per pushed SHA, frozen lockfile, own cache; compute only, $0 Claude | same | same | same |
| Inngest concurrency key | `company:<id>` limit 1 builder run | `company:<id>` limit 1 builder + 1 critic | same | same |
| Global ceiling | workspace tokens-per-minute cap at the gateway; fairness: round-robin by company, oldest queued first | same | same | same |
| Rate limits | 429/529: exponential backoff 2 s to 60 s, max 6 tries, never counts as an attempt; 402 at the cap ends the run with `ended_reason: budget` | same | same | same |
| Prompt caching | fleet-shared prefix (system prompt, role skills, `CLAUDE.md` template) first; tenant content last; `effort` constant per run | same | same | same |
| Model profile (builder / evaluator / planner / audit) | standard / standard / template / fast | standard / standard / standard (`strong` on M-PAY) / fast | standard / standard / strong / fast | standard / standard / strong / fast; consultant `strong` at level 2 |
| Appetite breaker | build $6; change run $1 | build $60 | build $250 | build $400 |
| Nightly G8 | deterministic replay, no model; companies with a commit or dependency bump in 7 days; weekly full sweep; budget per company | same | same | same, plus G4 nightly |
| Lesson scope | company lessons loaded for that company only; platform lessons as counts and patterns only, three-company minimum | same | same | same |

`[MUST · fleet · design choice, to be measured · all]` (debate-4 §4; synthesis-decisions §5).
Tags for the budget column: `appetite_usd` per feature and per build, estimate shown before
build, breaker at 1.5× `[MUST · H13 · A · all · invariant]`.

## 10. Lesson scope (gap 18)

| Rule | Tag |
| --- | --- |
| After any false done (evaluator pass, founder fail; or nightly regression on a verified feature) the worker opens one `Lesson` row and the planner makes one checklist or gate edit. No postmortem document. | `[MUST · H11 · B · all · invariant]` (§2 row 26) |
| `Lesson.scope ∈ {company, platform}`. Company lessons load only for that company. Platform lessons hold counts and patterns, never tenant facts (domain, provider ids, founder decisions), and need three distinct companies. | `[MUST · debate-4 §4.8 · invariant · all]` |
| Lessons change briefs and soft rubric weights only. Gates, hard criteria and tool policies have no lesson path. | `[MUST · debate-3 MUST 18 · invariant · all]` |
| `evaluator_vs_founder_disagreement` sustained >20% over 10 builds moves the evaluator to `strong` for that company. | `[MUST · H1 · B · all · design choice]` (§2 row 25) |

## 11. Review-queue and card policy

Review items count against 5 per day and 10 minutes. Cards count against 3 per day and are
opened only by `gate()`. Digests are free. `[MUST · H10 · B/C · all · invariant]`
(studio design §5.4; synthesis-decisions §3.5).

| Kind | Type | Content | Default at 24 h |
| --- | --- | --- | --- |
| `variant_pick` | review item | ≤3 variants, one recommended | recommended advances |
| `walkthrough` | review item | one screenshot, one sentence, pass / fail / comment | pass, nothing public happens |
| `breaker` | review item | stop / continue once / cancel, with spend and estimate | stop |
| assumptions digest, lockfile diff, regression notice, trust score | digest | read-only | n/a |
| `connect_account`, `go_live`, `fork`, `live_key` | card (K2) | product consequence, default, `default_applies_at` | card default applies; task parks only when no safe default exists |

Per-class budgets (estimates from debate-2 §3, to be measured):

| | C1 | C2 | C3 | C4 |
| --- | --- | --- | --- | --- |
| Review items per build | 2 (direction pick, skeleton walkthrough) + 1 digest | ~10 (6 slice walkthroughs, 1 pick, ~2 breakers) + digests | ~15 | ~20 |
| Cards per build | 2 (`connect_account`, `go_live`) | ~4 (+ `live_key`, one `fork`) | 6–8 bundled by cluster | 8–12 bundled; defaults apply at deadline |
| Walkthrough cadence | per build | per slice | per slice | per feature |

Throughput ceiling: a C2 build of 30 features needs at least two founder-days of review
and two days of cards. The queue, not compute, is the limit. Intake consumes zero cards.

## 12. Team metrics (DV1–DV6 and DORA keys)

Recorded from build one. `[MUST · all experiments · invariant · all]` (synthesis-decisions
§4.1). A derived view `feature_metrics` joins the sources; no self-report enters it.

| Metric | Definition | Source table and field |
| --- | --- | --- |
| DV1 first-pass acceptance | first G7 run for a feature has all criteria pass | `evidence` rows with `producer = evaluator`, first `captured_at` per feature |
| `evaluator_fail_rate_on_builder_done` | share of `BuilderClaim` rows followed by a failing G7 | `builder_claims` joined to `evidence` |
| `evaluator_vs_founder_disagreement` | G7 pass followed by `walkthrough` fail, or G7 fail the founder passes | `evidence` joined to `review_items.kind = walkthrough` |
| DV2 cost per accepted feature | Claude dollars plus compute from first run to `verified`, by role | `agent_runs.cost_usd`, `agent_runs.role`, `ledger_entries` |
| DV3 time to first verified slice | idea `created_at` to first E3 row of the skeleton feature | `companies`, `evidence` |
| DV4 founder attention | questions asked, review items, cards, review minutes per feature | `intake_records.asked`, `review_items`, `decision_cards`, `review_items.minutes` |
| DV5 defect escape and regression | failures after `verified`: G8 regressions and `walkthrough` fails | `evidence` with `check = g8_replay`, `review_items` |
| DV6 spec drift | requirement IDs with no `evaluator` or `worker` evidence; unspecified behaviour findings | trace-check output row, `test_reports.findings[kind = unspecified]` |
| G5 flag rate, breaker trips | per task | `gate_reports.g5_flags`, `agent_runs.ended_reason = breaker` |
| DORA lead time | = DV3 | as above |
| DORA deployment frequency | preview deploys per feature | `evidence.kind = deploy_id` count per feature |
| DORA change failure rate | features failing G7 or walkthrough after a `BuilderClaim` | = `evaluator_fail_rate_on_builder_done` plus walkthrough fails |
| DORA time to restore | wall clock from failing gate to `verified` | `agent_runs.started_at`, `evidence.captured_at` |
| Non-metrics | lines generated, AI code acceptance rate, builder test count | not recorded as quality signals |
