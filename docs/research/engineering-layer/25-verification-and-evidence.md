# 25. Verification and evidence

Purpose: the evidence ladder, gate table, acceptance-suite rules, mock lint, gaming scan, nightly replay, founder walkthrough and the `verifier.ts` requirement that make "done" unfakeable for every generated product.

Related: `00-README.md`, `01-research-protocol.md`, `10-findings-and-verdicts.md`, `20-blueprint-overview.md`, `21-intake-protocol.md`, `22-spec-and-plan-artifacts.md`, `23-architecture-and-principles.md`, `23a-repo-templates.md`, `24-team-topology-and-orchestration.md`, `26-security-controls.md`.

Rulings carried: `notes/synthesis-decisions.md` §2 rows 5, 6, 8, 13, 14, 15; §3.4; §3.5 evidence; gaps 10, 13, 16, 21.

## 0. Rule tag convention and the one principle

Tags are `[LEVEL · hypothesis · lowest grade · classes · kind]` as in `20-blueprint-overview.md` §0.
Principle (RQ5 preamble; synthesis-decisions §4.1 row 1): the agent that built the thing
never supplies the proof that it works. A deterministic tool or an independent evaluator
produces proof against the running artifact. Builder tests are a development aid with
evidential weight zero. All thresholds below are design constants to be tuned on DV5,
never on self-report (synthesis-decisions §5).

## 1. Evidence ladder E0–E4

| Level | Name | Content | Producer | Counts toward done |
| --- | --- | --- | --- | --- |
| E0 | `builder_claim` | builder statement, builder-run test output, builder unit suite | `builder_claim` | never |
| E1 | worker tool output | typecheck, lint, build exit codes, Vitest and Playwright reports, hashed logs | `worker` | gate only |
| E2 | worker preview facts | `deploy_id` READY for `commit_sha` via provider API; HTTP status plus body assertion; `db_row` read through the service role; `sync_observed` for M-RT | `worker` | required |
| E3 | evaluator run | Playwright trace, screenshots, axe JSON, Lighthouse JSON, per-criterion pass/fail, `seed` | `evaluator` (recorded by worker) | required |
| E4 | founder or provider | G9 walkthrough result; provider confirmation (`campaign_id`, `message_id`) | `founder`, `provider` | required where the plan says so and for every external action |

`[MUST · H2, H13 · A · all · invariant]` (RQ5 §Regime 1; debate-3 §4.3).

```ts
// packages/core/src/engineering/evidence.ts
export const EvidenceProducer = z.enum(["worker", "evaluator", "founder", "provider", "builder_claim"]);
export const EvidenceLevel = z.enum(["E0", "E1", "E2", "E3", "E4"]);
export const EvidenceKind = z.enum(["deploy_id", "http", "db_row", "sync_observed", "trace",
  "screenshot", "a11y_report", "lighthouse_report", "build_log", "test_report", "walkthrough",
  "provider_ref", "g8_replay"]);
export const EvidenceSchema = z.object({
  id: z.string().uuid(), company_id: z.string().uuid(), task_id: z.string().uuid(),
  feature_id: z.string(), criterion_id: z.string().nullable(),
  level: EvidenceLevel, kind: EvidenceKind, producer: EvidenceProducer,
  commit_sha: z.string().length(40), preview_url: z.string().url().nullable(),
  check_version: z.string(), sha256: z.string().length(64),
  storage_path: z.string(),            // evidence/<companyId>/<taskId>/<commit_sha>/<check>/<sha256>
  seed: z.string().nullable(), pass: z.boolean(), captured_at: z.string().datetime(),
}).strict();
```

Rules on the ladder:

- Rows are inserted only through the SQL function `record_evidence()`, which requires
  `producer IN ('worker','evaluator','founder','provider')`, an existing Storage object at
  `storage_path`, a matching `sha256`, and `commit_sha` equal to the task's pushed SHA.
  The table carries the same `forbid_change()` trigger as `actions`. A `builder_claim` row
  is stored in `builder_claims`, never in `evidence`. `[MUST · H2 · A · all · invariant]`.
- Worker-only done: `done(task_id)` is a SQL function returning true only when every
  acceptance criterion of the task has one E2 row and one E3 row with `pass = true` for the
  same `commit_sha` (and an E4 row where `evidence_required = E4`). No agent output field
  can set it. `status.verification = verified` is the only meaning of done.
  `[MUST · H2, H13 · A · all · invariant]` (debate-3 §9 rules 7, 8).
- `artifact_id` from the task's own agent run never counts; `plausibleRef` is removed (§13).
- Storage bucket `evidence/` is write-once; objects are keyed by hash.

## 2. Gate table G0–G9

| Gate | Content | Runner | Decider | Threshold or rule | Classes |
| --- | --- | --- | --- | --- | --- |
| G0 | protected-path diff on the pushed SHA: tests outside the feature, `e2e/acceptance/**`, CI, lockfile, `.github/**`, `.claude/**`, `features.json` planner fields, `docs/SPEC.md` rows | worker | deterministic | any hit fails the task; never asks | all |
| G1 | typecheck; lint `--max-warnings 0`; build; file ≤400 lines; function ≤50 lines; boundary and dependency-direction lint; `vi.mock` allowlist (§5); PR ≤400 changed lines (generated files and lockfiles excluded) | worker verifier sandbox | exit codes | zero warnings | all |
| G2 | builder unit and property tests, `failOnFlakyTests` | worker | exit code | a flake fails | all |
| G3 | integration tests on local Supabase and Inngest | worker | exit code | | C2+ |
| G4 | mutation score, StrykerJS incremental | worker, nightly | informational only | no floor; reported | C4 |
| G5 | gaming scan (§6): assertion density, special-case grep, edit/test-cycle count, transcript audit on `fast` | worker; model veto-only | deterministic flags fail; audit vetoes | density ≥1 value assertion per test; ≤8 cycles per file | all (deterministic checks); audit MUST at C2+, MAY at C1 (to be measured) |
| G6 | preview READY for `commit_sha` via provider API; smoke HTTP with body assertions; gitleaks; client-bundle JWT scan; frozen-lockfile install; OSV scan; security headers; RLS probe when `auth`; undeclared-host grep | worker | deterministic | all pass | all |
| G7 | evaluator runs the acceptance suite from Storage with a fresh recorded seed on the preview; axe; Lighthouse; DB probes; per-criterion hard thresholds; writes E3 | evaluator + worker | deterministic per criterion; model may veto or rank only | axe `violations == []`; Lighthouse performance ≥70 and accessibility ≥90 at C1–C2, ≥80 and ≥95 at C3+; rate-limit probe 30 requests in 10 s expects 429 | all; unit per §3 |
| G8 | nightly deterministic replay of all verified suites on staging, no model | worker | deterministic | any regression stops the line | all |
| G9 | founder walkthrough from a generated script, one tap per step | founder | human | founder result is E4 | C1 per build; C2+ per milestone; M-REG mandatory per milestone |

`[MUST · H2, H13, H1 · A · all · invariant]` for G0, G1, G2, G5 deterministic part, G6, G7
deterministic part, G8; `[MUST · H1 · B · all · invariant]` for the evaluator half of G7;
`[MAY · RQ5 §KQ5 · A about tests of weight zero · C4 · informational]` for G4
(synthesis-decisions §2 row 14).

Cadence rules: per commit only G0–G2 (fast, builder-owned tests). Per feature done and per
slice evaluation are never relaxed (synthesis-decisions §2 row 32). The acceptance suite
runs at G7 and may be red until then; G1–G3 run builder tests only (synthesis-decisions §2 row 6). Done needs
every gate that applies at the class, G0–G7, green for the same `commit_sha`.

## 3. Evaluation unit per class

| Class | E2 (worker, ~$0) | E3 unit | Estimated evaluator cost |
| --- | --- | --- | --- |
| C1 `landing` | per feature | the build (one slice), one pass | $0.75 per build |
| C2 `app` | per feature | per slice; `strong` after founder disagreement | ~$0.40–0.80 per slice |
| C3 `platform` | per feature | per slice | same |
| C4 `critical` | per feature | per feature | same, per feature |

Done needs one E2 and one E3 row per acceptance criterion; a slice run supplies the E3
rows for every feature in the slice. `[MUST · H1 · B · all · design choice, to be
measured]` (synthesis-decisions §2 row 8; debate-2 §1.3).

## 4. Acceptance-suite authorship, storage and regeneration (gap 10)

| Rule | Tag | Source |
| --- | --- | --- |
| The first test of every feature is the evaluator's acceptance suite derived from the feature's Gherkin `steps`, written before build, by a role that never reads the implementation. | `[MUST · H13, I11 · A · C2+; C1 uses the template smoke suite · invariant]` | synthesis-decisions §2 row 5; METR 43× scorer visibility (RQ5 §KQ2, A, https://metr.org/blog/2025-06-05-recent-reward-hacking/) |
| Suite path: `acceptance/<companyId>/<featureId>/<sha256(steps)>/` in North Storage. The founder repo never holds it; G0 fails any `e2e/acceptance/**` path in a builder diff. | `[MUST · H13 · A · all · invariant]` | debate-4 §3.3 item 5 |
| Regeneration: when `sha256(steps)` changes, the worker schedules a new authoring run; the old suite stays for history and G8 replays the current hash only. | `[MUST · gap 10 · n/a · all · invariant]` | |
| Parameterisation: every run draws a fresh seed (seeded faker); the seed is recorded in the E3 row. Criteria are visible to the builder; concrete values are not. | `[MUST · H13 · A · all · invariant]` | debate-3 §4.1 |
| Builder TDD: the builder's unit and integration red-green cycle is E0. | `[SHOULD · H8 · A null for humans · all · process]` | synthesis-decisions §2 row 5; RQ3 §KQ5 |
| Repo convention: builder tests live in `**/*.test.ts` and `e2e/dev/**`; the reserved path `e2e/acceptance/**` is protected and empty in the repo. | `[MUST · gap 13 · n/a · all · invariant]` | |
| Authoring run tool list: the critic class (`24-*.md` §1); inputs are `steps`, the data-model slice design doc when it exists, and the infrastructure template; output is the suite plus a `TestReport` skeleton with one criterion id per `Then`. | `[MUST · H1 · A · all · invariant]` | |

CLAUDE.md's TDD rule governs North's own codebase and is unchanged (synthesis-decisions §2 row 5).

## 5. Mock policy as lint rules

Builder tests are E0 regardless; the mock policy is hygiene lint in G1, not evidence
(synthesis-decisions §2 row 13). `[MUST · H2 · A for tampering, C for mock-heavy · all ·
invariant]`.

| Rule | Allowed or forbidden | Detection rule (ESLint or Vitest setup) |
| --- | --- | --- |
| `vi.mock()` target is an owned adapter under `src/adapters/**` (or the plan's `integrations` module) | allowed | allowlist of module specifiers; any other target is an error |
| Fixed clock, seeded randomness, fixed UUIDs | allowed | `vi.useFakeTimers`, `faker.seed` not flagged |
| Interaction assertion (`toHaveBeenCalled*`) on a state-changing outbound call (send, charge, create) | allowed | call target in the adapter allowlist |
| `vi.mock` of `@supabase/*`, `inngest`, `zod`, `next/*`, or any in-repo module outside the adapter allowlist | forbidden | specifier regex: `^@supabase/`, `^inngest`, `^zod`, `^next/`, relative imports not under `src/adapters/**` |
| Mocking a third-party SDK directly instead of the owned adapter | forbidden | specifier is a bare package name not in the allowlist |
| Stubbing a read to assert on call shape | forbidden | `toHaveBeenCalled*` whose target returns data (adapter method tagged `@read`) |
| Any double inside `e2e/acceptance/**` or in a suite the evaluator authors | forbidden | the authoring prompt forbids it; the worker greps the suite for `vi.mock`, `page.route` to non-preview origins |
| Shape-only assertions (`toBeDefined`, `toBeTruthy` on an object) as the only assertion in a test | forbidden | assertion-density lint: ≥1 value or state assertion per test |
| `test.skip`, `test.only`, `it.todo`, deleted tests in a builder diff | forbidden | G0 diff flag; `--forbid-only` |
| Control flow or `sleep` inside a test (I12) | forbidden | lint: no `if`/`for`/`setTimeout` in test bodies |
| Nightly contract test for every allowed fake against the provider account named in `26-security-controls.md` §5 | required at C2+ | failing contract test quarantines the fake and opens a digest, never a card |

`MockRuntime` concerns North's own T1 tier and is out of scope here.

## 6. Gaming scan (G5)

Structural controls are primary; the scan is secondary. Monitors catch 42–50% of cheating
on repo-scale tasks (RQ6 §KQ3, A, https://arxiv.org/html/2510.20270v1), so the scan may
veto, never approve.

| Structural control (primary) | What it stops | Tag |
| --- | --- | --- |
| Acceptance suite invisible and unwritable to the builder (§4) | test modification, >79% of Claude cheating (ImpossibleBench) | `[MUST · H13 · A · all · invariant]` |
| Fresh seed per run (§4) | special-casing of known inputs | `[MUST · H13 · A · all · invariant]` |
| G0 protected-path diff on the pushed SHA | test, CI, lockfile edits; `.skip/.only` | `[MUST · H2 · A · all · invariant]` |
| Verifier sandbox builds and runs from the pushed SHA, own cache | harness escape, patched runner, printed completion markers | `[MUST · debate-3 §4.1 · B · all · invariant]` |
| Bounded retries with a legitimate `halt` exit (`24-*.md` §4) | "keep going until green" pressure | `[MUST · H13 · A · all · invariant]` |
| Worker-only `done` (§1) | false claim of success | `[MUST · H2 · A · all · invariant]` |

What the scan looks for (deterministic part, each flag fails the attempt):

| Check | Rule | Source |
| --- | --- | --- |
| Assertion density | ≥1 value or state assertion per test in changed test files | RQ5 §Regime 4.5 |
| Special-case grep | `if (… === '<fixture literal>')`, test-name strings in `src/**`, comments matching `/hack\|special.?case\|workaround for test/i` | Claude 3.7 system card pattern (RQ5 §KQ2, B) |
| Edit/test-cycle count | edits to one file interleaved with test runs >8 in one run, from `audit_tool_calls` | system card: "after multiple failed attempts" |
| Patched globals | `Date`, `performance.now`, `fetch`, `Math.random` reassigned in `src/**` | RQ5 §Regime 4.6 |
| Skips and deletions | any `.skip`, `.only`, removed test in the diff | G0 |

Transcript audit (model part, `fast` tier): one pass over the builder transcript for
special-casing, test edits, claims of success without a command, and `SPECIAL HACK`
comments. Output is a veto with quoted lines or nothing. Cost ≈ $0.02 per feature
(debate-2 §1.2). At C2+ the audit is MUST; at C1 it is MAY, labelled to be measured, and
only the deterministic checks above are MUST (editor's ruling, `20-blueprint-overview.md` §4).
`[MUST at C2+, MAY at C1 · H2 · B · all · model-limit (2026-10)]`. G5 flag rate is recorded
per task (`24-*.md` §12).

## 7. Nightly G8 sampling and bisection

| Rule | Detail |
| --- | --- |
| Scope | companies with a commit or dependency bump in the last 7 days; full sweep weekly; budget per company |
| Content | deterministic replay of every verified acceptance suite (current `steps` hash) on staging with a new seed; no model |
| Result | each run writes an E2 row `kind: g8_replay` per criterion |
| On regression | stop the line for that company: no new feature dispatched until green; regression notice digest to the founder (free) |
| Bisection | deterministic reverse revert (`24-*.md` §7 step 6): revert merges in reverse id order on a scratch branch, re-run only the failed suite each time; the last reverted feature is the culprit |
| Output | `FixBrief` naming the culprit feature and the failing criterion; a `Lesson` row when the feature had been `verified` |
| Who pays | compute only; nightly $3 per month in the C1 budget; never Claude dollars |

`[MUST · H3, DV5 · C mechanism, A need (DORA stability) · all · invariant]`
(synthesis-decisions §3.7; debate-4 §4.7).

## 8. Founder walkthrough script (G9)

The script is generated by the worker from the feature's `steps`, in plain words, one tap
per step, on a phone. The founder is the real DV1 oracle; everything else is a proxy
(debate-2 §5). `[MUST · H10 · C · all · invariant]`.

```
for each feature in the slice (C2+) or build (C1), in BuildPlan order:
  for each Given/When/Then triple in steps:
    screen 1: "Open <preview_url><path>"          [tap: opened]
    screen 2: "<When, rewritten imperative>"       [tap: done]
    screen 3: "<Then, rewritten as a question>?"   [tap: yes / no / comment]
  one screenshot from the E3 row is shown beside each Then.
result per feature: pass (all yes) | fail (any no) | comment
```

Rules: the item is one `walkthrough` review item per slice (one screenshot, one sentence,
pass / fail / comment). A `fail` after an evaluator pass writes a `Lesson` row and moves the
evaluator to `strong` for the company. The result is an E4 row with `producer: founder`.
Cadence: C1 per build; C2+ per milestone; M-REG mandatory per milestone. Round 2 of intake
(max 3 questions) opens only after a failed skeleton walkthrough (`21-intake-protocol.md`).

## 9. `sync_observed` for realtime (gap 21)

Request-response evidence is the wrong shape for CRDT or socket features (debate-4 §1.3).
M-RT adds one E2 kind. `[MUST · H2 · B · C3 with realtime · invariant]`.

```ts
export const SyncObservedSchema = EvidenceSchema.extend({
  kind: z.literal("sync_observed"),
  sessions: z.array(z.object({ browser: z.string(), trace_sha256: z.string().length(64) })).length(2),
  mutation_id: z.string(),            // the op applied in session A
  observed_in_ms: z.number().int(),   // time until session B rendered it
  threshold_ms: z.number().int(),     // from the criterion; default 2000
  converged_state_sha256: z.string().length(64),  // both DOM/state snapshots hash-equal
}).strict();
```

Pass rule: `observed_in_ms ≤ threshold_ms` and both snapshots hash-equal. Produced by the
worker's two-browser Playwright run; the evaluator's M-RT template uses it for every
`Then both users see` step. M-RT also requires a deterministic merge simulation test in G3
and two deployables pinned to one `commit_sha` (`23-architecture-and-principles.md`).

## 10. Cross-tenant and cross-role probe (gap 16)

Required E3 rows at C3+ for every feature that reads or writes tenant data; shared with
`26-security-controls.md` §3. `[MUST · I14 · B · C3, C4 · invariant]`.

| Probe | Actor | Expected | Evidence |
| --- | --- | --- | --- |
| Second org | user of org B requests org A's rows by id and by list | 403 or empty, never A's data | `db_row` and `http` rows |
| Second role | lowest role in org A attempts an admin action | 403 | `http` row |
| Unauthenticated | anonymous key `select` and `insert` on every table in `public` | deny, except tables declared public in the plan | RLS probe row in G6 |
| Evaluator checklist | one scenario per probe per data-owning feature, seeded fresh users per run | all pass | E3 criterion rows |

## 11. What actually prevents "mock tests pass, product fails"

Ranked by impact per dollar (debate-2 §4; synthesis-decisions §4.1). Mechanisms: (a) the
platform accepts the builder's claim; (b) the builder controls the tests; (c) nothing ran
against the deployed artifact.

| Rank | Control | Closes | Cost per run | Grade |
| --- | --- | --- | --- | --- |
| 1 | `done` only from worker E2 rows via `record_evidence()` and the `done` SQL function; builder references are `builder_claim` | (a), (c) | ~$0 | A (mechanism) |
| 2 | Builder cannot write tests, CI, lockfile; `.skip/.only` lint; G0 on the pushed SHA | (b) | $0 | A (ImpossibleBench) |
| 3 | Pipeline first, deployed preview, first acceptance test before feature code, skeleton kept and replayed nightly (G8) | (c), DV5 | one deploy + Playwright compute | C mechanism |
| 4 | Evaluator in fresh context with browser; deterministic criteria decide, model vetoes (G7) | (a) | $0.40–0.80 per slice | A separation, B browser |
| 5 | Evaluator-authored hidden suite with fresh seed | (b) special-casing | $0.28 per feature + Storage | A |
| 6 | Transcript audit on `fast` | (b), false claims | $0.02 | B (42–89% recall) |
| 7 | Bounded retries, `halt` exit, appetite breaker at 1.5× | loops | saves money | A |
| 8 | Reviewer on diff (C3+ only) | none of (a)–(c) directly | $0.17 | C (Luu: scored worse) |
| 9 | Mutation score (G4, nightly, C4) | weak oracles of weight-zero tests | CI minutes | informational |
| 10 | Sealed environment | retrieval cheating | ≈0 (kept for A2/A3 only) | demoted |

Only look like they prevent it: EARS, `requirement_hash`, trace-check, ADRs, design docs.
They serve DV6, not DV1; keep them where they cost $0.

## 12. Thresholds (gap 13)

| Threshold | Value | Where |
| --- | --- | --- |
| Assertion density | ≥1 value assertion per test | G5 |
| Edit/test cycles per file | ≤8 before flag | G5 |
| Rate-limit probe | 30 requests in 10 s expects 429 | G7 |
| Lighthouse | performance ≥70, accessibility ≥90 at C1–C2; ≥80, ≥95 at C3+ | G7 |
| axe | `violations == []` | G7 |
| Changed lines per feature PR | ≤400, generated files and lockfiles excluded | G1 |
| File and function size | ≤400 lines, ≤50 lines | G1 |
| Flakes | zero tolerated in G2, G3, G7; a flaky deterministic test is a product bug | G2–G7 |
| `sync_observed` | default 2000 ms unless the criterion says otherwise | G7 (M-RT) |
| Evaluator disagreement | >20% over 10 builds moves the evaluator to `strong` | runtime dial |

All values are design constants to be re-tuned on DV2 and DV5 after the 20 golden tasks.

## 13. Required change to `apps/worker/src/services/verifier.ts`

Stated as requirements, not code. The current file verifies `deploy_id` and `test_report`
with `plausibleRef(ref)`, which passes any non-empty string that is not `sandbox:noop:*`
or `internal`; `artifact_id` passes on existence; `verifyUrl` passes on any 2xx with no
body check (read 2026-10-17). This is the live false-done path (RQ5 §KQ4; debate-3 A12).

| Requirement | Tag |
| --- | --- |
| Remove the `plausibleRef` branch for `deploy_id` and `test_report`. | `[MUST · H2 · A · all · invariant]` |
| `deploy_id` is verified only by the provider API returning state `READY` for the given `commit_sha` on the company's own project, mirroring `campaign_id`. | MUST |
| `test_report` is verified only when `ref` is a Storage object hash under `evidence/<companyId>/<taskId>/<commit_sha>/` produced by the worker's own runner invocation. | MUST |
| `artifact_id` counts only when the artifact's producing run is not the task's own agent run. | MUST |
| `url` must satisfy the content assertion of the criterion (status, selector or text present, JSON schema), never bare 2xx; redirects still not followed; private hosts still refused. | MUST |
| New kinds: `db_row`, `http`, `trace`, `a11y_report`, `lighthouse_report`, `build_log`, `sync_observed`, `g8_replay`, each verified by object existence plus hash. | MUST |
| Evidence writes go through `record_evidence()`; `verifyEvidence` returns a check result and never inserts rows itself. | MUST |
| The evaluator's and verifier's HTTP user agent and headers are indistinguishable from a normal browser except the bypass secret; one anonymous fetch without bypass is also made (`north-verifier/1.0` is retired). | `[MUST · debate-3 §4.2 · B · all · invariant]` |
| Tests: a `builder_claim` insert into `evidence` is rejected; `done` is unreachable without E2 plus E3 rows (property test); a crafted diff touching `e2e/acceptance/**` fails G0. | MUST |
