# 22. Spec and plan artifacts

Purpose: the files and rows every build produces, their schemas, who writes each, and the checks that keep requirement, plan, test and evidence tied together across sessions.

Related: `00-README.md`, `01-research-protocol.md`, `10-findings-and-verdicts.md`, `20-blueprint-overview.md`, `21-intake-protocol.md`, `23-architecture-and-principles.md`, `23a-repo-templates.md`, `24-team-topology-and-orchestration.md`, `25-verification-and-evidence.md`, `26-security-controls.md`.

Rulings carried: `notes/synthesis-decisions.md` §2 rows 17, 19, 21, 28; §3.3; §3.5; §4.1 plan row and read-set row; §7 gaps 2, 3, 7, 8.

Tag convention: `[LEVEL · hypothesis · lowest grade · classes · kind]`, as in `20-blueprint-overview.md` §0.

## 1. The artifact set

[MUST · H5 · B · all · invariant]: six artifacts exist for every build; the rest are selected by class (synthesis §2 row 17). All Zod schemas live in `packages/core/src/engineering/*.ts`; every boundary parses before use.

### 1.1 In the founder's repository

| Path | Owner (writes) | Size bound | Created | Updated | Classes |
| --- | --- | --- | --- | --- | --- |
| `CLAUDE.md` | worker, from the template in `23a-repo-templates.md` | ≤200 lines, ≤8 KB | skeleton step 3 | template version bump or assumption flip; never planner prose | all |
| `.claude/rules/<area>.md` | worker, from template | ≤150 lines each | skeleton step 5 | template bump | C2+ |
| `docs/SPEC.md` | planner (C1: template filler) | one row per requirement ID; statement ≤40 words | plan | planner re-plan only; builder edits are a G0 hit | all |
| `docs/plans/features.json` | worker projection (§6) | one row per feature; exempt from the 400-line rule (§13) | after the plan | after every `agent_run` end and every evidence insert | all |
| `docs/plans/progress.md` | worker: `## Now` rewritten, `## Log` appended | `## Now` ≤40 lines; `## Log` unbounded, not in the read set | skeleton step 3 | every session end | all |
| `docs/adr/NNNN-<noun-phrase>.md` | planner | ≤120 lines each | any hard-to-reverse choice | never edited; superseded by a new ADR | C3+ MUST, C2 MAY |
| `docs/design/<slice>.md` | planner | ≤250 lines | data-model-root slice only | planner re-plan | C3+ MUST, C2 MAY |
| `docs/design/modules.json` | planner | one entry per module | only when `parallel: true` | planner | C2+ with parallel |
| `init.sh` | worker, from template | ≤80 lines | skeleton step 3 | template bump | all |
| `**/*.test.ts`, `e2e/dev/**` | builder | per feature; E0 | per feature | builder, inside its `writes` | all |

Not in the repository: acceptance suites, TaskBrief, BuilderClaim, GateReport, TestReport, ReviewReport, FixBrief, Lesson, Evidence, `intake.json` (synthesis §3.3; debate-4 §3.3.6). A builder that creates `e2e/acceptance/**` trips G0.

### 1.2 North side (rows and Storage objects)

| Artifact | Schema file | Writer | When | Reader |
| --- | --- | --- | --- | --- |
| `IntakeRecord` (`intake.json`) | `engineering/intake.ts` | intake worker, planner | intake close; flips | planner, template filler, CLAUDE.md filler |
| `BuildPlan` rows | `engineering/plan.ts` | planner (C1: template) | plan; re-plan | worker (projection, dispatch), evaluator (`steps`) |
| `TaskBrief` | `engineering/task-brief.ts` | worker assembles | every builder attempt | builder |
| `BuilderClaim` | `engineering/builder-claim.ts` | builder | attempt end | transcript audit only; never the state machine |
| `GateReport` (`gates.json`) | `engineering/gate-report.ts` | worker | every pushed SHA | worker, evaluator, FixBrief derivation |
| `TestReport` | `engineering/test-report.ts` | evaluator | every G7 run | worker (`done`), FixBrief derivation, review queue |
| `ReviewReport` | `engineering/review-report.ts` | reviewer | per slice | worker (block on CRITICAL/HIGH) |
| `FixBrief` | `engineering/fix-brief.ts` | worker derives | after any failed gate | next builder attempt |
| `Lesson` | `engineering/lesson.ts` | planner (company), platform (fleet) | after any false done | planner, template owners |
| `Evidence` | `engineering/evidence.ts` (detail in `25-`) | worker, evaluator via `record_evidence()` | every check | SQL `done`, projection, review queue |
| Acceptance suite | files | evaluator | before the builder's first attempt | evaluator (G7), G8 |

Storage paths (synthesis §3.3): `acceptance/<companyId>/<featureId>/<sha256(steps)>/` and `evidence/<companyId>/<taskId>/<commit_sha>/<check>/<sha256>` (write-once).

## 2. Status source of truth

[MUST · H5 · B · all · invariant] (synthesis §2 row 19): `evidence` rows and `agent_runs` are canonical for status, attempts, cost and blockers. `features.json` is a projection the worker regenerates. No role edits it by hand. Planner-owned fields (`requirement`, `statement`, `slice`, `steps`, `depends_on`, `writes`, `appetite_usd`, `assumptions`) are protected by `plan_hash`; a builder edit to the file is a G0 hit (`25-verification-and-evidence.md`).

Derivation (worker, deterministic, after every run end and evidence insert):

| Field | Rule |
| --- | --- |
| `status.build` | `todo` when no `agent_run` exists for the feature; `in_progress` while a run has `ended_reason = null`; `built` when the latest run ended `completed` and a pushed `commit_sha` exists |
| `status.verification` | `verified` when the SQL `done(feature_id)` function is true for the current SHA; `failed` when the latest `GateReport` or `TestReport` for the current SHA has a failed hard item; else `unverified` |
| `status.blocked_on` | the open `fork` card, the first unverified `depends_on` feature, or the integration conflict the integrator recorded; else `null` |
| `status.freshness` | `suspect` when `requirement_hash` differs from the live SPEC row hash, or when any id in `assumptions` has `status = flipped` after the last verification; else `current` |

## 3. `BuildPlan` schema

```ts
export const FeatureId = z.string().regex(/^[A-Z][A-Z0-9]{1,5}-F\d{1,3}$/);
export const RequirementId = z.string().regex(/^[A-Z]{2,5}-\d{1,3}$/);
export const Sha256 = z.string().regex(/^sha256:[0-9a-f]{64}$/);
export const Category = z.enum(["functional","security","compliance","ops","ux"]);
export const EvidenceLevel = z.enum(["E2","E3","E4"]);

export const FeatureStatus = z.object({
  build: z.enum(["todo","in_progress","built"]),
  verification: z.enum(["unverified","verified","failed"]),
  blocked_on: BlockedOn.nullable(),                // schema in 21-intake-protocol.md §13
  freshness: z.enum(["current","suspect"]),
});

export const FeatureRow = z.object({
  id: FeatureId,
  requirement: RequirementId,                       // exactly one; many features per requirement is fine
  requirement_hash: Sha256,                         // §8
  statement: z.string().max(300).regex(EARS),       // §4
  category: Category,
  slice: z.string().max(40),
  steps: z.array(z.string().max(200)).min(3).max(10), // §5
  evidence_required: z.array(EvidenceLevel).min(1), // ["E2","E3"] default; E4 added by M-REG and go_live
  depends_on: z.array(FeatureId),
  writes: z.array(z.string().max(120)).min(1),      // globs the builder may touch
  assumptions: z.array(z.string().regex(/^A-\d{3}$/)),
  appetite_usd: z.number().positive(),
  status: FeatureStatus,                            // worker-derived; ignored on planner input
});

export const BuildPlan = z.object({
  version: z.literal(1),
  company_id: z.string().uuid(), build_id: z.string().uuid(),
  class: ClassCode, flags: z.array(Flag), modules: z.array(Module),
  created_by: z.enum(["planner","template"]),
  spec: z.literal("docs/SPEC.md"),
  closes: z.array(RequirementId).min(1),
  slices: z.array(z.object({ id: z.string(), name: z.string().max(80), spine: z.boolean(), order: z.number().int() })).min(1),
  parallel: z.boolean().default(false),
  appetite_usd_build: z.number().positive(),
  features: z.array(FeatureRow).min(1),
  plan_hash: Sha256,                                // over planner-owned fields of every row, in id order
  created_at: z.string().datetime(),
}).superRefine(acyclicDependsOn).superRefine(exactlyOneSpineSlice).superRefine(appetiteSumWithinBuild);
```

Rules on the plan: `depends_on` is acyclic; exactly one slice has `spine: true`; `sum(appetite_usd) ≤ appetite_usd_build`; a feature whose `steps` cannot be walked in one browser session is two features (RQ2 §KQ6). `parallel: true` is allowed only at C2+ with `docs/design/modules.json` present (synthesis §2 row 7). Evaluator budget, rubric version and model alias are not plan fields; they live in the platform join table (synthesis §2 row 29).

## 4. EARS conventions for `statement` and `docs/SPEC.md`

[MUST · H5 · B · all · invariant]: every requirement and every feature `statement` is one EARS sentence with exactly one `SHALL` (RQ2 §KQ3, https://en.wikipedia.org/wiki/Easy_Approach_to_Requirements_Syntax; Kiro, https://kiro.dev/docs/specs/feature-specs/). RFC 2119 keyword is `SHALL` for requirements and `SHOULD` for soft ones that never gate.

```
EARS = /^((WHEN|WHILE|WHERE) [^,]{3,120}, |IF [^,]{3,120}, THEN )?THE (system|[A-Za-z ]{2,30}) (SHALL|SHOULD) [^.]{5,200}\.$/
```

| Pattern | Example |
| --- | --- |
| Ubiquitous | `THE system SHALL show the waitlist form on the landing page.` |
| Event-driven | `WHEN a visitor submits a valid email, THE system SHALL store one waitlist row and show a confirmation.` |
| State-driven | `WHILE a user is signed out, THE system SHALL refuse every write to that user's data.` |
| Unwanted behaviour | `IF the same email is submitted twice, THEN THE system SHALL keep one row and show the same confirmation.` |
| Optional feature | `WHERE payments are enabled, THE system SHALL verify the Stripe webhook signature before any state change.` |

`docs/SPEC.md` row format in the generated repository (English only):

```
| ID | Statement | Keyword | Category | Slice |
| LND-2 | WHEN a visitor submits a valid email, THE system SHALL store one waitlist row and show a confirmation. | SHALL | functional | spine |
```

Lint (worker, G1 at C2+, report at C1): ID regex, EARS regex, exactly one `SHALL` or `SHOULD`, ≤40 words, every ID unique. The founder never reads this file; cards and the walkthrough script render plain words (debate-2 §5).

## 5. Gherkin conventions for `steps`

`steps` are the contract between planner and evaluator and the source of the acceptance suite, the walkthrough script (G9) and the suite hash (RQ2 §KQ3, https://cucumber.io/docs/gherkin/reference/).

| Rule | Check |
| --- | --- |
| Each step starts with `Given`, `When`, `Then` or `And`; at least one of each of the first three | regex |
| Every `Then` names an observable: page text, HTTP status and body fragment, a row count, a received test email, a 429 | word list; no component or function names |
| Fresh data uses `{seed}` placeholders; the evaluator substitutes a recorded seed per run (synthesis §4.1 row 3) | placeholder regex |
| 3 to 10 steps; more means two features | schema |
| C3: every actor is qualified, `Given org A user {seed.a}`; a cross-tenant step is required per feature that touches tenant data (gap 16, detail in `25-`) | word list `org A`, `org B`, `unauthenticated` |
| M-RT: two browsers, `Given browser 1 ... Given browser 2 ...`, and a `Then browser 2 sees ... within 2 s` step producing `sync_observed` | word list |

Example (C3): `Given org A user {seed.a} created a project "{seed.p}"`, `When org B user {seed.b} opens /projects/{seed.p}`, `Then the response is 404 and no project text is shown`.

## 6. `features.json` projection

[MUST · H5 · B · all · invariant]: `docs/plans/features.json` is generated by the worker from the `BuildPlan` rows and the derivations of §2. It is committed through the Release path after every run end. Nobody edits it.

```ts
export const FeaturesJson = z.object({
  version: z.literal(1),
  rule: z.literal("Generated by the North worker from evidence rows. Hand edits are a G0 violation. Only evidence changes status."),
  build_id: z.string().uuid(), class: ClassCode, flags: z.array(Flag), modules: z.array(Module),
  spec: z.literal("docs/SPEC.md"), closes: z.array(RequirementId),
  plan_hash: Sha256,
  generated_at: z.string().datetime(),
  generated_from: z.object({ last_run_id: z.string().uuid().nullable(), last_evidence_id: z.string().uuid().nullable() }),
  slices: BuildPlan.shape.slices,
  features: z.array(FeatureRow.extend({
    verified_at: z.object({ commit_sha: z.string(), evaluator_run_id: z.string().uuid(), cost_usd: z.number() }).nullable(),
    attempts: z.number().int().min(0),               // from agent_runs
    cost_usd: z.number().nonnegative(),              // from agent_runs
  })),
});
```

Regeneration steps: (1) load plan rows; (2) verify `plan_hash`; (3) derive `status`, `attempts`, `cost_usd`, `verified_at` per §2; (4) write the file; (5) run trace-check (§8); (6) commit `chore(plan): regenerate features.json [skip-builder]` with `repo.push` through `gate()`. A `plan_hash` mismatch stops the build and opens a `breaker` review item.

Continuity with North's own `M7.features.json`: `id`, `requirement`, `statement` and the header `rule` keep their names; `proof` and `passes` are retired in favour of `steps`, `evidence_required` and the four status axes (RQ2 §KQ0, §KQ6).

## 7. `progress.md` template

[MUST · H6 · A premise · all · invariant] (gap 8): `## Now` is rewritten by the worker at every session end and is the only part in the read set. `## Log` is append-only, newest first, one line per event, never read at session start.

```markdown
# Progress

## Now
<!-- rewritten by the worker; <=40 lines; this block is in the session-start read set -->
- Build: {build_id} · class {class} · slice {current_slice} ({n_verified}/{n_total} verified)
- Next feature: {feature_id} · {statement}
- Blocked: {feature_id} on {blocked_on.kind} {blocked_on.id}; default "{default}" applies at {default_applies_at}
- Preview: {preview_url} · last READY deploy {deploy_id} for {commit_sha}
- Environment: Supabase project {ref}; providers connected: {providers}
- Last verified: {f1} ({sha}), {f2} ({sha}), {f3} ({sha})
- Open FixBrief: {fix_brief_id} for {feature_id} (attempt {n})
- Appetite: ${spent} of ${appetite_usd_build}; breaker at ${1.5x}

## Log
<!-- append-only, newest first, one line per event; not in the read set -->
- {date} · {run_id} · {feature_id} · {event: started|built|gate_fail G{n}|verified|failed E3|fix_brief|halt|breaker} · {one fact}
```

Facts the Log must carry (continuity with `M7.progress.md`): provider account ids, first measured cost per feature, run URLs. Nothing in the Log flips a status.

## 8. `requirement_hash` and trace-check

[MUST · H5 · B · all · invariant; gate at C2+, report at C1]: `requirement_hash = sha256("<ID>|<statement>|<keyword>")` over the SPEC row with whitespace collapsed and trimmed (RQ2 §KQ5, IEC 62304 change-impact pattern, https://jamb.readthedocs.io/en/latest/iec-62304/traceability.html; NASA SWEHB, https://swehb.nasa.gov/x/agH7). The worker recomputes it on every projection; a mismatch sets `freshness: suspect` and the planner must re-plan or re-confirm the row before the feature is dispatched again.

`trace-check` (worker, `packages/core/src/engineering/trace-check.ts`, runs inside G1):

| # | Check | On failure |
| --- | --- | --- |
| 1 | Every id in `closes` has ≥1 feature row | fail (C2+); report (C1) |
| 2 | Every `feature.requirement` exists in `docs/SPEC.md` | fail |
| 3 | Every `requirement_hash` matches the live row | `freshness: suspect`; dispatch refused for that feature |
| 4 | Every `statement` passes the EARS regex; every `steps` array passes §5 | fail |
| 5 | `depends_on` acyclic; every `depends_on` id exists | fail |
| 6 | Every `writes` glob is inside the repo and outside the protected list (`25-` G0) | fail |
| 7 | Every `verified` feature has ≥1 E2 and ≥1 E3 row for the current SHA per criterion (the SQL `done` function) | status flips to `failed` |
| 8 | Status transitions legal: `todo→in_progress→built`; `unverified→{verified,failed}`; `failed→unverified` only on a new SHA | fail |
| 9 | Every builder test file names a feature or requirement ID in a test title | report only (SHOULD) |
| 10 | `plan_hash` matches the planner-owned fields | fail; `breaker` item |

Trace-check prevents drift (DV6). It does not prevent false done; that is the evidence pipeline in `25-` (debate-2 §4).

## 9. Handoff schemas

[MUST · H7 · B · all · invariant] (synthesis §4.1): every handoff carries objective, output schema, allowed tools, boundaries and the upstream decisions already taken (RQ7 §KQ4 Inferences; Cognition, https://cognition.ai/blog/dont-build-multi-agents).

```ts
export const ReadSetItem = z.object({ path: z.string(), max_bytes: z.number().int().positive(), order: z.number().int() });

export const FixBrief = z.object({                              // derived by the worker; the builder never reads evidence rows
  task_id: z.string().uuid(), feature_id: FeatureId, next_attempt: z.number().int().min(2).max(3),
  derived_from: z.object({ gate_report: z.string().uuid().nullable(), test_report: z.string().uuid().nullable() }),
  failures: z.array(z.object({ source: z.enum(["gate","criterion","probe"]), ref: z.string(),
                               observed: z.string().max(300), expected: z.string().max(300) })).min(1),
  do_not: z.array(z.string().max(120)),                        // "do not edit tests", "do not add sleeps"
  commit_sha: z.string().length(40), created_by: z.literal("worker"),
});

export const TaskBrief = z.object({
  task_id: z.string().uuid(), run_attempt: z.number().int().min(1).max(3),
  role: z.literal("builder"), model_alias: z.enum(["fast","standard","strong"]), effort: z.enum(["low","medium","high","xhigh"]),
  objective: z.string().max(400),                               // "make feature {id} pass its steps"
  feature: FeatureRow.omit({ status: true }),                   // planner fields only
  depends_on_rows: z.array(FeatureRow.pick({ id: true, statement: true, writes: true })),
  output_schema: z.literal("BuilderClaim"),
  allowed_tools: z.array(z.string()),
  boundaries: z.object({ writes: z.array(z.string()), protected: z.array(z.string()), no_gos: z.array(z.string()) }),
  upstream_decisions: z.object({ adr_ids: z.array(z.string()), assumption_ids: z.array(z.string()), class: ClassCode }),
  read_set: z.array(ReadSetItem).max(6),                        // §11
  fix_brief: FixBrief.nullable(),
  budget_usd: z.number().positive(),
});

export const BuilderClaim = z.object({                          // E0; evidential weight zero
  task_id: z.string().uuid(), attempt: z.number().int(),
  files_changed: z.array(z.string()), tests_run: z.array(z.string()),
  step_claims: z.array(z.object({ step: z.number().int(), claim: z.string().max(200) })),
  halted: z.boolean(), halt_reason: z.string().max(300).nullable(),
  notes: z.string().max(1000),
});

export const GateResult = z.object({
  gate: z.enum(["G0","G1","G2","G3","G4","G5","G6"]), status: z.enum(["pass","fail","skipped","info"]),
  exit_code: z.number().int().nullable(), started_at: z.string().datetime(), ended_at: z.string().datetime(),
  log_sha256: Sha256, storage_path: z.string(), details: z.record(z.unknown()),
});
export const GateReport = z.object({                            // gates.json
  task_id: z.string().uuid(), commit_sha: z.string().length(40), attempt: z.number().int(),
  check_version: z.string(), gates: z.array(GateResult), verdict: z.enum(["pass","fail"]),
});

export const Criterion = z.object({
  index: z.number().int(), step: z.string(), hard: z.boolean(), result: z.enum(["pass","fail"]),
  evidence_refs: z.array(z.string()),                           // storage paths
});
export const TestReport = z.object({
  task_id: z.string().uuid(), feature_id: FeatureId, commit_sha: z.string().length(40), preview_url: z.string().url(),
  suite_hash: Sha256, seed: z.string(), rubric_version: z.string(), model_alias: z.string(),
  criteria: z.array(Criterion).min(1),
  axe_violations: z.number().int(), lighthouse: z.object({ performance: z.number(), accessibility: z.number() }),
  probes: z.array(z.object({ name: z.string(), result: z.enum(["pass","fail"]), detail: z.string() })),
  veto: z.object({ vetoed: z.boolean(), reason: z.string().max(400) }),   // model may veto or rank only
  verdict: z.enum(["pass","fail"]), captured_at: z.string().datetime(),
});

export const ReviewReport = z.object({
  slice_id: z.string(), sha_range: z.object({ from: z.string(), to: z.string() }), checklist_version: z.string(),
  findings: z.array(z.object({ id: z.string(), severity: z.enum(["CRITICAL","HIGH","MEDIUM","LOW"]),
                               file: z.string(), line: z.number().int().nullable(), text: z.string().max(400),
                               tool_confirmable: z.boolean() })),   // true means: move it to G1/G6
  lockfile_diff: z.array(z.string()),
  verdict: z.enum(["pass","block"]),                            // block only on CRITICAL or HIGH
});

export const Lesson = z.object({
  id: z.string().uuid(), scope: z.enum(["company","platform"]), company_id: z.string().uuid().nullable(),
  trigger: z.enum(["false_done","regression","breaker","founder_disagreement"]),
  feature_id: FeatureId.nullable(), text: z.string().max(300),
  edit: z.object({ artifact: z.enum(["checklist","gate","template","rule"]), ref: z.string(), change: z.string().max(300) }),
  companies_observed: z.number().int().min(1),                 // platform scope requires >= 3 (synthesis §2 row 26)
  created_at: z.string().datetime(),
});
```

`Evidence` is defined in `25-verification-and-evidence.md`; its fields are `producer`, `level`, `commit_sha`, `preview_url`, `check_version`, `sha256`, `captured_at`, `seed` (synthesis §3.5).

## 10. Status vocabulary

One word per axis; `CONTEXT.md` carries the same words (synthesis §3.5).

| Axis | Values | Written by | Retired aliases |
| --- | --- | --- | --- |
| `status.build` | `todo`, `in_progress`, `built` | worker, from `agent_runs` | `pending`, `completed` (Kiro) |
| `status.verification` | `unverified`, `verified`, `failed` | worker, from evidence; `verified` is the only meaning of done | `passes` (Anthropic), `deferred` (Taskmaster) |
| `status.blocked_on` | `{ kind: feature \| card \| integration, id, default, default_applies_at }` or `null` | worker | `needs_decision` (RQ2) |
| `status.freshness` | `current`, `suspect` | worker, trace-check | none |
| `agent_runs.ended_reason` | `completed`, `budget`, `kill_switch`, `crash`, `timeout`, `decision_wait` | worker | none |
| Evidence `producer` | `worker`, `evaluator`, `founder`, `provider`, `builder_claim` | `record_evidence()` | `SelfReport` |

## 11. Session-start read set

[MUST · H6, H9' · A premise, B · all · invariant] (synthesis §4.1): the worker assembles the read set in this fixed order, with byte caps, before a builder session starts. The builder does not browse `docs/`. Total ≤20 KB. Detail and the retry state machine are in `24-team-topology-and-orchestration.md`.

| Order | Item | Cap |
| --- | --- | --- |
| 1 | `CLAUDE.md` | 8 KB |
| 2 | `progress.md` `## Now` | 3 KB |
| 3 | The feature row plus its `depends_on` rows | 2 KB |
| 4 | `TaskBrief` | 4 KB |
| 5 | Latest `FixBrief` for this feature, if any | 2 KB |
| 6 | `git log -20 --oneline` | 1 KB |

[SHOULD · Liu U-curve · A · all · model-limit (dated 2026-10)]: spec and acceptance criteria at prompt start, the task at the end (RQ4 §Q6, https://arxiv.org/html/2307.03172).

## 12. ADRs and design docs by class

| Class | ADR | Design doc |
| --- | --- | --- |
| C1 | none | none |
| C2 | MAY, for a hard-to-reverse choice the planner names | MAY |
| C3, C4 | MUST for tenancy model, data-model root, auth provider, payment provider, second deployable (M-RT) | MUST for the data-model-root slice, ≤250 lines |

[MUST at C3+, MAY at C2 · RQ2 §KQ3 · C · C3, C4 · design choice]. ADR format follows North's own `docs/adr/0003-supabase-postgres-rls-local-first.md`: `# ADR NNNN: <noun phrase>`, `Status: accepted (<date>)`, `## Context`, `## Decision` ("We will ..."), `## Consequences`. Numbers are monotonic and never reused; a reversed decision gets a new ADR that names the superseded one (Nygard, https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions). ADRs never open cards by themselves; a fork becomes a `fork` card only through `gate()` (debate-2 §3).

Design doc sections (RQ2 §KQ8 (3), machine-checked parts only): header with slice, status, linked requirement IDs and ADRs; goals and non-goals; requirements touched (ID, statement, evidence level); the design (C4 level 1, tables with RLS and append-only flags); alternatives considered; cross-cutting (security, privacy, cost); verification plan as `steps`; expected cards with defaults; zero `[NEEDS CLARIFICATION]` markers before status `reviewed`.

## 13. The 400-line exemption

[MUST · CLAUDE.md · n/a · all · invariant] (synthesis §2 row 21): generated data files are exempt from the 400-line rule. The exemption is one line in the `CLAUDE.md` template (`23a-repo-templates.md`): "Files under 400 lines; functions under 50. Generated data files (`docs/plans/*.json`, lockfiles) are exempt." Source files never are; G1 enforces `max-lines` 400 and `max-lines-per-function` 50 on everything else.

## 14. What this file does not decide

Gate thresholds, the acceptance suite's regeneration rule and the `sync_observed` evidence kind are in `25-verification-and-evidence.md`. The retry state machine, the widening procedure and the `modules.json` schema are in `24-team-topology-and-orchestration.md`. The protected-path list for G0 is in `25-` and `26-security-controls.md`.
