# Round 3 rulings: synthesis decisions for the engineering blueprint

Arbiter, 2026-10-17. Inputs: `01-research-protocol.md`, `CLAUDE.md`, `notes/RQ1..RQ8`,
`notes/debate-1..4`, and `docs/research/real-testing-strategy.md` §3 (T0–T4) for vocabulary.
Writers copy these rulings verbatim; nothing below is re-opened in `10-*` or `2x-*`.

Grading rule adopted (debate-1 §1.1): a source keeps the lowest grade any note gave it.
Resulting grades: Chroma B; Cognition C; Vercel B; SPOQ C; MAST A for the trace taxonomy,
B for the +9.4/+15.6 interventions; Anthropic harness runs B (n=1); Haynes 2009 removed
(debate-1 §2 H11, Urbach 2014). Every blueprint rule carries: MUST/SHOULD/MAY, hypothesis
ID, lowest grade, classes it applies to, and "invariant" or "model-limit rule (dated)".

---

## 1. Final hypothesis verdicts

Experiments live in `packages/evals` on 20 golden tasks of class C1–C2 (debate-2 §8.10).

| H | Verdict | Restated falsifiable form (where asked) | Strongest for | Strongest against | Grade accepted | Experiment (DV) |
| --- | --- | --- | --- | --- | --- | --- |
| H1 | Supported in narrow form | H1': a fresh-context evaluator (own config dir, read-only, separate budget) that runs the spec-derived acceptance suite on the deployed preview rejects ≥30% of builder "done" claims that same-context self-review accepted, and the founder confirms ≥80% of those rejections (debate-1 §4) | Separation half: self-preference Panickssery NeurIPS 2024 (RQ7 §KQ4, A, https://arxiv.org/abs/2404.13076); self-correction without new signal lowers accuracy, Huang ICLR 2024 (RQ6 §KQ3, A, https://arxiv.org/html/2310.01798v2). Browser half: Anthropic Mar 2026 "reliably skew positive" (RQ5 §KQ3, B) | Luu: independent audit subagents scored worse (RQ7 §KQ3, C, https://danluu.com/agentic-testing/); monitors catch 42–50% on repo tasks (RQ6 §KQ3); Cursor 247/160,469 is confounded and deleted (debate-1 §1.2) | A for "judge ≠ author and must bring new signal"; B for the browser configuration; magnitude ungraded | H1' crossover on 20 features; record `evaluator_fail_rate_on_builder_done` and `evaluator_vs_founder_disagreement` from build one (DV1, DV4) |
| H2 | Clause 1 supported; clause 2 undetermined | H2': features whose builder diff touches assertions, skips or fixtures (G5 flag) fail G7 at ≥2× the rate of clean diffs; an E2+E3 gate reduces post-done defects (DV5) by a stated fraction vs a builder-self-report arm (debate-1 §4) | ImpossibleBench: >79% of Claude cheating is test modification, read-only tests stop it (RQ6 §KQ5, A, https://arxiv.org/html/2510.20270v1); METR scorer-visible 43× (RQ5 §KQ2, A); LLM oracles mirror the implementation, Konstantinou 2410.21136 and Mathews & Nagappan 2412.14137 (A) | No base rate for "mock-heavy"; hidden tests cost legitimate performance (RQ6 §KQ5); clause 2 unmeasured in every note | A for "builder-controlled tests get tampered"; C for "mock-heavy predicts false done" (restate as "builder-controlled"); clause 2 ungraded | Join G5 flags to G7 outcomes per task; two arms on golden tasks (DV1, DV5) |
| H3 | Supported in narrow form as a design rule; outcome undetermined | H3': on matched C2 ideas, skeleton-first lowers DV3 and the count of evaluator-found integration defects vs layer-first | Unanimous practitioner lineage Cockburn/GOOS/Bogard/Fowler (RQ3 §KQ4, C); it also closes H2 mechanism (c) "nothing ran against the deployed artifact" at the cost of one deploy (debate-2 §4 rank 3) | No experiment; Mellegård 2018 unretrieved (RQ3 §Open 1); e2e-first is credited with H2's mechanism (debate-1 §2 H3) | C | Retrieve Mellegård (doi 10.1109/MS.2018.2880822); IV3 A/B on two C2 ideas (DV3, DV5) |
| H4 | Weakened | H4': capped, option-first intake with N ∈ {0, 3, 5, 7, uncapped} on matched idea prompts; DV1 per founder-minute | Asking beats guessing on benchmarks: ClarifyGPT 2310.10996, HumanEvalComm 2406.00215, Ask-or-Assume 2603.26233; over-asking cost Okanagan 65→27 (RQ1 §KQ2, A) | No human, founder or acceptance study (RQ1 §Open 8); zero-question products dominate (RQ8 §KQ5); Claude Code's interview prompt is uncapped (debate-1 §2 H4) | A for "some asking beats none"; D for "bounded beats open" | H4' (DV4 minutes vs T4 acceptance) |
| H5 | Supported in narrow form | H5': prose vs structured plan with identical content on the same features; compare DV5 and evaluator-found unspecified behaviour (DV6 is circular, debate-1 §2 H5) | Only a machine-checkable plan can be enforced by trace-check and the protected-path diff (debate-3 §8 H5, RQ2 §KQ5); Anthropic kept the feature list across model generations (RQ2 §KQ1, B) | No controlled comparison (RQ2 §KQ7); Anthropic dropped sprint contracts in V2; Thoughtworks over-formalisation (C). SPOQ and the "JSON is edited less recklessly" sentence are deleted as evidence (debate-1 §7) | B for enforceability; C for outcomes | H5' (DV5) |
| H6 | Premise supported; remedy undetermined | H6': fresh session per feature vs one session with compaction on the same feature set (DV1, DV2, DV5) | Laban −39% / +112% unreliability, consolidate recovers 59.1→90.9 (RQ6 §KQ2, A, https://arxiv.org/html/2505.06120); NoLiMa, RULER, Liu (A) | Anthropic V2 ran one continuous session and dropped resets (RQ7 §KQ4, B); Laban is chat, not tool loops (RQ6 §KQ2 Gaps) | A in the wrong domain; remedy B vs C | H6' per model release; default stays fresh-per-feature until it loses (ruling §2 row 1) |
| H7 | Supported in narrow form (near-tautology as written) | H7': for features with disjoint `writes`, two parallel builders in worktrees deliver the pair with lower DV3 and no worse DV2/DV5 than one sequential builder; for shared-module pairs the reverse | Anthropic disqualifies coding from the +90.2% pattern (RQ4 §Q2, B); MAST 32% inter-agent misalignment (RQ6 §KQ3, A, no control); every shipping harness is one task per checkout (RQ4 §Q5) | Kiro waves and Spec Kit `[P]` ship concurrent writers by design (RQ2 §KQ6); Karpathy eight-agent post deleted (D, truncated) | B/C | H7' (DV2, DV3, DV5); until run, wave size 1 |
| H8 | Half 1 supported; half 2 undetermined | H8': removing any one codebase invariant on the golden tasks raises DV5 or evaluator fail rate; invariants whose removal changes nothing are dropped | TDD meta-analyses null, typing effects small (RQ3 §KQ5, A) | "No study validates that specific list" (RQ3 §Synthesis 4); five invariants were North's own rules relabelled universal (debate-1 §2 H8, debate-4 §1.2) | A for "no universal method"; core content ungraded | H8' ablation, one invariant off at a time |
| H9 | Broad form refuted; H9' supported | H9': a ≤200-line, ≤8 KB always-on index of non-inferable instructions beats optional skills for knowledge the model lacks; hooks beat both for anything that must never be violated (RQ2 §KQ7) | Vercel 53%→100%, skill never invoked 56% (RQ2 §KQ4, B, https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) | ETH CTXbench: +20% cost, no significant gain, LLM-generated files slightly worse (RQ2 §KQ4, A, https://arxiv.org/abs/2602.11988) | A against broad; B for H9' | ETH-style: CLAUDE.md present / absent / skill-only on the same features; instrument skill invocation rate (RQ4 §Open 5) |
| H10 | Split supported; founder cadence weakened | H10': founder at forks only vs forks plus one review item per slice, same ideas (DV1, DV4) | Anthropic V2 kept planner and evaluator when cutting everything else (RQ7 §KQ4, B); self-preference (A) | Luu "loops degrade" without a human (RQ7 §KQ3, C); no source measures the forks-only cadence (RQ4 §Deliverable 4); the evaluator needed human prompt tuning (debate-1 §2 H10) | B for the split; C for cadence, with contrary C | H10' |
| H11 | Weakened as grand thesis; supported as "structural beats instructional" for agents | H11': the same rule as a PreToolUse hook produces a violation rate ≥5× lower than as CLAUDE.md prose, at equal task success (debate-1 §4) | METR prompts moved hacking only 80%→70–95% (RQ5 §KQ2, A); ImpossibleBench read-only tests (A); ETH: a tool named in a context file is used 1.6× vs <0.01× (A) | Urbach NEJM 2014 null on 215k procedures (https://doi.org/10.1056/NEJMsa1308261); "only when" is unobservable (debate-1 §2 H11) | B | H11' from `actions` (append-only makes violations observable) |
| H12 | Undetermined as outcome claim; adopted as cost-forced design | H12': projects tagged at intake show different DV1/DV5 under uniform methodology; class-selected methodology improves DV1 where uniform was worst | Uniform full ceremony costs $14–27.5 per landing build vs $4.5 tiered and breaks the $8 journey (debate-2 §1.3); DO-178C level-indexed objectives (RQ3 §KQ2, B/C) | "D/none" for classifier validity (RQ1 §Verdicts); classifier inputs are the methodology's inputs (debate-1 §2 H12) | B for the cost argument; D for effect | Tag every project; compare DV1/DV5 by class; then A/B (RQ1 §Open 6) |
| H13 (added) | Supported, A, three labs | Structural anti-gaming (acceptance tests invisible and unwritable to the builder, no scorer in context, bounded retries with a legitimate "spec and tests disagree" exit) lowers test tampering more than any prompt | ImpossibleBench read-only/hidden tests and abort option 54%→9%; METR 43× scorer visibility; Cursor "hacking increased when told to keep working" and −14 to −20 points when sealed (debate-1 §7 "stronger than the notes realise") | Hidden tests lower legitimate performance (RQ6 §KQ5); the retrieval component is a benchmark artefact (debate-2 §2) | A | Instrument G5 flag rate and breaker trips per task (RQ5 §Regime 4.10) |

Carry both METR numbers: 1–2% overall (o3 April report) and 30.4% RE-Bench (39/128) vs
0.7% HCAST (8/1,087); the gap is the finding (debate-1 §1.3). ETH numbers from RQ2 (+2.4%,
p = 0.21), not RQ6's secondary "+4%".

---

## 2. Contradictions settled

| # | Issue | Positions | Ruling | Reason |
| --- | --- | --- | --- | --- |
| 1 | Fresh context vs long session (debate-1 §3.1, debate-2 §9) | RQ4 "supported"; RQ7 "contested by Anthropic V2"; RQ6 "B vs C" | Fresh session per feature is the default; SDK auto-compaction allowed within a session; multi-feature sessions with compaction are a model-limit rule re-tested per model release with H6' | Auditable, cheaper prompts (debate-2 §7 H6); artifacts stayed necessary in both Anthropic generations (RQ2 §KQ1) |
| 2 | Compaction after failure (debate-1 §3.2) | RQ4 §Q6 "restart from artifacts"; RQ4 §Q2 "model-gated optimisation" | After any failed gate: never resume or compact; new session from artifacts plus FixBrief. Transcript resume only for `ended_reason ∈ {crash, timeout}` | Laban: recaps carry the wrong turn (RQ6 §KQ2); debate-4 §3.3 item 7 |
| 3 | Independent evaluator value (debate-1 §3.3) | RQ5/RQ4/RQ8 for; RQ7 Luu against | Independence counts only when the evaluator acts on the running system with deterministic probes; a second LLM reading prose is not a gate | RQ7 §KQ4 Inferences; Huang ICLR 2024 |
| 4 | Question budget (debate-1 §3.4, debate-2 §9) | 3–5 (tools) vs 7+3 (RQ1 design) vs 0 (market) | Max 5 asked questions in round 1, multiple choice, default pre-selected; Q1–Q3 always; two slots by Impact × Uncertainty; the rest defaulted into one assumptions digest (no quota); zero cards at intake; round 2 (max 3) only if the skeleton walkthrough fails | debate-2 §3, §8.6; studio spec: drafts never consume quota |
| 5 | TDD vs hidden acceptance tests (debate-1 §3.5, debate-4 §2.2.3) | CLAUDE.md "TDD"; RQ3/RQ5 "acceptance-test-first"; Spec Kit "NON-NEGOTIABLE" | CLAUDE.md's TDD rule governs North's own codebase and is unchanged. For generated products: the first test of every feature is the evaluator's acceptance suite derived from `steps` (I11, MUST); the builder's unit/integration red-green cycle is SHOULD, E0 | Human TDD evidence is null (RQ3 §KQ5, A); the agent failure mode is fake tests, not absent tests (RQ3 §Open 3) |
| 6 | Red skeleton test vs green per-commit gates (debate-1 §2 H3) | GOOS red e2e vs RQ5 G2–G3 green | Per-commit gates G1–G3 run builder tests only; the acceptance suite runs at G7 and may be red until then | Different suites, different gates |
| 7 | Parallel writers (debate-1 §3.6, debate-3 §3.2) | RQ7 "none"; RQ2 Kiro/Spec Kit; RQ4 "disjoint worktrees" | Release 1: wave size 1 at every class. Parallel writers MAY be enabled at C2+ only with `parallel: true`, declared `writes`, `docs/design/modules.json`, and the deterministic integrator of debate-4 §5; never a model resolving merges | H7 undetermined; integrator is an attack point (debate-3 §3.2) |
| 8 | Evaluator cadence (debate-1 §3.7) | RQ5 per task; RQ7 per feature; budget doubts | E2 (worker, ~$0) per feature at every class. E3 evaluation unit: C1 = the build (one slice); C2 and C3 = slice; C4 = feature. Done needs one E2 and one E3 row per acceptance criterion, which a slice run supplies | debate-2 §1.3 arithmetic; debate-4 §5 step 5 |
| 9 | Cursor judge datum (debate-1 §3.8) | "strongest datum for H1" vs "CI never a gate" | Deleted as H1 evidence; citable only as an account of a design choice | Confounded, D |
| 10 | Grades (debate-1 §3.9) | see header | Lowest grade rule adopted | debate-1 §1.1 |
| 11 | METR rates (debate-1 §3.10) | RQ6 "conflict" vs RQ5 | RQ5 is right; both numbers carried | Verified by the skeptic |
| 12 | LLM-written always-on files (debate-1 §3.11, debate-4 §2.2.6) | ETH harm vs planner-written CLAUDE.md | Founder-repo `CLAUDE.md` and `.claude/rules/*.md` are templates filled from `intake.json`; the planner never writes always-on prose; fleet-shared prefix first | ETH (A); cache economics (debate-4 §4.5) |
| 13 | Mock policy breadth (debate-1 §3.12) | RQ5 regime vs KQ1 vs RQ3 Open 9 | Builder tests are E0 regardless; the mock policy is hygiene lint, not evidence. Allowed: fakes of owned adapters with a nightly contract test; forbidden: doubles of DB, framework, in-repo modules (`vi.mock` allowlist). `MockRuntime` concerns North's own T1 tier, out of scope | debate-2 §2 "do less, verify more" |
| 14 | Mutation score vs zero-weight tests (debate-2 §9) | G4 gate vs "evidential weight 0" | G4 is not a gate; nightly informational report, C4 only | Scores tests that do not count |
| 15 | Size rule (debate-2 §9) | reviewer >200 vs I10 100–400 | One deterministic rule: ≤400 changed lines per feature PR (generated files and lockfiles excluded), worker-enforced; no LLM size judgement | Matches CLAUDE.md 400-line rule; lint not opinion |
| 16 | Intake cards (debate-2 §9) | stop rule 3 "two cards" vs "1–2" vs "drafts never consume" | Intake consumes zero cards | Studio spec §5.4 |
| 17 | Eleven artifacts (debate-2 §9) | RQ2 eleven vs four survivors | Always: `CLAUDE.md` (template), `docs/SPEC.md`, `features.json` (projection), `progress.md`, `init.sh`, git. Class-selected: the rest (§4) | RQ2 §KQ1 |
| 18 | Sealed environment (debate-2 §2 vs debate-3 §4.1) | cut (retrieval is a benchmark problem) vs keep | Keep the shallow single-commit, credential-free, registry-only workspace, justified by exfiltration and planted-hook threats A2/A3, not by retrieval; vendored doc snapshots replace WebFetch | debate-3 §1.3, §3 worktrees row; cost ≈ 0 because the worker materialises the workspace anyway |
| 19 | Who writes feature status (debate-4 §2.2.1) | builder/evaluator/worker | Evidence rows and `agent_runs` are canonical; `features.json` is a worker-regenerated projection; planner-owned fields (`statement`, `steps`, `depends_on`, `writes`, `appetite_usd`) are hash-protected; builder edits to the file are a G0 hit | debate-4 §3.3.1; CLAUDE.md rule 2 |
| 20 | Retry counts 2/3/5 (debate-4 §2.2.2) | AGT-3 "2"; RQ4 "2 then fresh"; RQ7 "R=5" | One state machine (§3 dials): attempt 1 and 2 same builder profile, attempt 2 in a fresh session with FixBrief; failure of attempt 2 escalates (AGT-3) to attempt 3 on the `strong` tier; failure of attempt 3 trips the breaker | SPEC AGT-3 governs; Laban restart |
| 21 | 400-line rule vs `features.json` (debate-4 §2.2.4) | split vs exempt | Generated data files (`docs/plans/*.json`, lockfiles) are exempt; one line added to the CLAUDE.md template | The file is a projection nobody hand-edits |
| 22 | Spec vs code on Bash allowlist (debate-3 §2) | spec lists gateway; code omits it | Code is right; fix spec §5.9 | Proxy refuses loopback; listing it would open a path |
| 23 | `isolation: worktree` (debate-3 §3) | RQ4 CLI field vs SDK type | North's isolation unit is the task workspace materialised by the worker; SDK worktrees are not relied on until a spike confirms | Unverified in SDK types |
| 24 | PreToolUse `defer` and Stop hook as gates (debate-3 §3) | spec §5.9 vs docs limits | `deny` when `gate()` returns a card; `defer` only for tools absent from `allowedTools` after a two-tool-call test; Stop hook is a nudge, the done gate is the worker state machine | 8-block cap; single-call limit |
| 25 | Same-family evaluator (debate-3 open, RQ5 §Open 3) | separate family vs fresh same-family | Same-family with separate config dir, pinned alias and rubric version is the accepted approximation; `evaluator_vs_founder_disagreement` is recorded from build one and a sustained rate >20% over 10 builds triggers the `strong` tier for that company | RQ7 §Open 3; debate-2 §8.7 |
| 26 | Postmortem (debate-2 §2) | document vs lesson | One lesson row plus one checklist or gate edit, scoped company vs platform (three-company minimum for platform) | debate-4 §4.8 |
| 27 | Appetite overrun (RQ7 level 3 card vs debate-2 §6) | card vs review item | Review item `breaker` (stop / continue once / cancel), default stop at 24 h; never a card | Cards are the scarce resource; items carry defaults |
| 28 | Is evidence read by the next builder? (debate-4 §2.2.7) | RQ4 "not by builder"; RQ4 rule 1 "everything in evidence"; RQ7 FixBrief | The builder never reads evidence rows; the worker derives `FixBrief` from the failing evidence and TestReport findings and places it in the read set | One projection, one reader |
| 29 | Evaluator budget and rubric location (debate-4 §2.2.8) | "platform constants per class" with no table | Budget, rubric version and model alias per class live in the join table (gap 5), owned by the platform; the planner's BuildPlan cannot reference or override them | RQ7 correction 2; debate-3 MUST 18 |
| 30 | Critic role grants (debate-3 §3.1) | `engineering.yaml` grants `artifacts.write`, `errors.read`, `repo.push` to one role | Persona schema field `critic: true` forces the disallowed-tool list of MUST 5, forbids `artifacts.write`; `repo.push` and `deploy.*` are worker actions after `gate()`; no persona holds both `fs.write` and `errors.read` unless `buildTaskPrompt` wraps error text as data, verified by a Vitest test | A12, A1 |
| 31 | `halt` (andon) output for every LLM role (RQ7 KQ7 correction 4) | proposed; no critique attacked it | Adopted as MUST: any role may emit `halt` through a North tool; the worker parks the build and opens a `breaker` review item; the planner must rule before restart | Zero Claude cost; same mechanism as the breaker |
| 32 | Where to relax per-commit correctness (RQ8 §Open 5) | Cursor relaxed per commit for throughput | Per-commit: G0–G2 only (fast, builder-owned tests). Per-feature done and per-slice evaluation: never relaxed | Cursor's own outcome |
| 33 | Clarifying questions at architectural forks (RQ8 never-do 8 vs debate-2 §3) | ask at forks vs zero cards | Forks are cards with defaults (§3.5), not questions; the builder never asks the founder mid-build; `AskUserQuestion` is removed from builder and critic tool lists | Decision quota; Cursor "answer read as go" failure (RQ1 §KQ3) |
| 34 | I6 and I7 in the product core (debate-4 §1.2) | RQ3 universal vs North-only | Removed from the product invariant list; `gate()` and append-only `actions`/`ledger_entries` are agent-action invariants. An append-only ledger reappears in the product only through M-PAY/M-REG | A waitlist form has no authority engine |

---

## 3. Canonical vocabulary

### 3.1 Complexity classes (for the founder's product)

Retired: RQ1 `static | landing+waitlist | crud_saas | multi_tenant | marketplace`, RQ3 matrix
row names, and RQ3's "T1–T4 verification tier" (T0–T4 remain North's own test tiers in
`real-testing-strategy.md` §3 and are not used for the product).

| Class | Name | Base rule |
| --- | --- | --- |
| C1 | `landing` | no accounts; persistence at most a form/waitlist row |
| C2 | `app` | accounts; single population; no tenancy |
| C3 | `platform` | accounts and (tenancy or two-sided) |
| C4 | `critical` | reached only through flags (payouts, regulated) |

Flags (orthogonal; each has a minimum class and a module): `payments` (C2, M-PAY: Stripe
test-mode contract test nightly, webhook-signature test, no card data touched, K2 card
before any live key, planner on `strong` for the payment slice); `payouts` (C4, M-PAY +
M-REG); `realtime` (C3, M-RT: second deployable template, two-browser evaluator, evidence
kind `sync_observed`, deterministic merge simulation); `regulated` (C4, M-REG: append-only
audit table, consent record, residency check, G9 per milestone); `integrations ≥ 1`
(unchanged class, M-INT: owned adapter plus contract test per provider); `ai_core` (C2,
M-AI: fixed eval set, cost ceiling, prompt-injection cases in the acceptance suite);
`batch` (C2, M-BATCH: golden-file tests, idempotent steps).

Classifier (pure function in `packages/core/src/engineering/classify.ts`, tested):

```
auth = Q1 implies accounts; tenancy = Q4 == teams; payments = Q5 != none;
payouts = Q5 includes paying others; two_sided = Q6 == yes (both populations sign up
by themselves and transact with each other without the founder in the loop);
realtime = Q7 == live; integrations = count(Q8); regulated = Q9 == yes; ai_core, batch
from the Q0 restatement.
base = !auth ? C1 : (tenancy || two_sided) ? C3 : C2
effective = max(base, min_class(flag) for each set flag)
```

Precedence is `max()`; flags never lower a class; modules add to the class's gate set.
`appetite` (Q3: weekend | weeks | months) sets budget ceilings only, never class.

### 3.2 Roles

Role classes for tool policy (debate-3 §3.3): `planner`, `builder`, `critic` (Evaluator,
Reviewer), `worker` (deterministic code). Retired aliases: generator, coder, implementer,
QA agent, auditor, judge, Release worker → `Release` (a worker function, not a role).

| Role | Reads | Writes | Approves / vetoes | Active at |
| --- | --- | --- | --- | --- |
| Planner | intake record, repo, SPEC, evidence | `BuildPlan` rows, `docs/SPEC.md`, `docs/adr/`, `docs/design/`, `TaskBrief` | rules below the architectural line; never done | C2+ (C1: template fills the plan from intake) |
| Builder | TaskBrief, its owned `writes`, FixBrief | its `writes` only; never tests outside its feature, CI, lockfile, `features.json`, `.git`, `.claude` | none; may `halt` | all |
| Evaluator | `steps`, preview URL, probes, gates JSON; never builder transcript or claim | acceptance suite in North Storage; `TestReport`; evidence via worker | veto on done; `halt` | all |
| Reviewer | diff by SHA range, plan, checklist | `ReviewReport` | block on CRITICAL/HIGH only | C3, C4 |
| Consultant | fork of the asking role's context | written opinion in ledger | advisory | escalation level 2, C3+ |
| Release (worker) | gates, evidence, SHA | push, preview, production via `gate()` | only path to production | all |
| Founder | everything | cards, review items, kill switch | final on forks and go-live | all |

Model tiers by alias (IDs only in `packages/core/src/models.ts`): `fast`, `standard`,
`strong`. Defaults: builder `standard`; evaluator `standard`, high effort; transcript
audit `fast`; planner `standard` at C2, `strong` at C3+ and for any M-PAY slice.

### 3.3 Artifacts

Founder's repo (generated): `CLAUDE.md` (≤200 lines, ≤8 KB, template); `.claude/rules/<area>.md`
(≤150 lines, template, C2+); `docs/SPEC.md` (one row per requirement ID, EARS statement,
RFC 2119 keyword); `docs/plans/features.json` (worker projection); `docs/plans/progress.md`
(`## Now` ≤40 lines rewritten each session; `## Log` append-only, not in the read set);
`docs/adr/NNNN-*.md` (C3+ or any hard-to-reverse choice); `docs/design/<slice>.md` (C3+,
data-model-root slice only, ≤250 lines); `docs/design/modules.json` (only with
`parallel: true`); `init.sh`; builder tests `**/*.test.ts` and `e2e/dev/**` (E0).
Not in the repo: acceptance suites, TaskBrief, BuilderClaim, GateReport, TestReport,
ReviewReport, FixBrief, lessons (debate-4 §3.3.6).

North side (Zod schemas in `packages/core/src/engineering/*.ts`): `IntakeRecord`
(`intake.json`: answers, class, flags, assumptions with `reopen_trigger`, no-gos),
`BuildPlan` (feature rows: `id`, `requirement`, `requirement_hash`, `statement`,
`category`, `slice`, `steps`, `evidence_required` (E-level), `depends_on`, `writes`,
`assumptions`, `appetite_usd`, `status {build, verification, blocked_on, freshness}`),
`TaskBrief`, `BuilderClaim` (retired alias SelfReport), `GateReport` (`gates.json`),
`TestReport`, `ReviewReport`, `FixBrief` (derived projection of failing evidence and
TestReport findings), `Lesson`, `Evidence`. `blocked_on = { kind: feature | card |
integration, id, default, default_applies_at }`. `agent_runs.ended_reason ∈ {completed,
budget, kill_switch, crash, timeout, decision_wait}`.
Storage: `acceptance/<companyId>/<featureId>/<sha256(steps)>/`;
`evidence/<companyId>/<taskId>/<commit_sha>/<check>/<sha256>` (write-once).

### 3.4 Gates (who runs; what decides pass)

| Gate | Content | Runs | Decides | Classes |
| --- | --- | --- | --- | --- |
| G0 | protected-path diff on the pushed SHA: tests outside the feature, `e2e/acceptance/**`, CI, lockfile, `.github/**`, `.claude/**`, `features.json` planner fields | worker | deterministic; hit fails the task | all |
| G1 | typecheck, lint (`--max-warnings 0`), build, file ≤400 / function ≤50, boundary and dependency-direction lint, `vi.mock` allowlist, PR ≤400 changed lines | worker verifier sandbox | exit codes | all |
| G2 | builder unit and property tests, `failOnFlakyTests` | worker | exit code | all |
| G3 | integration tests on local Supabase/Inngest | worker | exit code | C2+ |
| G4 | mutation score (StrykerJS incremental) | worker, nightly | informational only | C4 |
| G5 | gaming scan: assertion-density lint, special-case grep, edit/test-cycle count from `audit_tool_calls`; transcript audit on `fast` | worker; model veto-only | deterministic flags fail; audit vetoes | all (audit C2+) |
| G6 | preview deploy READY for `commit_sha` via provider API; smoke HTTP with body assertions; secret scan (gitleaks); client-bundle JWT scan; frozen-lockfile install; OSV scan; security headers; RLS probe (when `auth`) | worker | deterministic | all |
| G7 | evaluator runs the acceptance suite from Storage with a fresh recorded seed on the preview; axe `violations == []`; Lighthouse thresholds; DB probes; per-criterion hard thresholds; E3 rows | evaluator + worker | deterministic per criterion; model may veto or rank only | all; unit per §2 row 8 |
| G8 | nightly deterministic replay of all verified suites on staging, no model; companies with a commit or dependency bump in the last 7 days; full sweep weekly | worker | regression stops the line | all |
| G9 | founder walkthrough: generated script from `steps`, one tap per step | founder | human | C1 per build; C2+ per milestone; M-REG mandatory per milestone |

### 3.5 Evidence levels, status vocabulary, review item kinds

Evidence: E0 `builder_claim` (never counts); E1 worker tool output (gate only); E2 worker
preview facts (`deploy_id`, HTTP + body, `db_row`, `sync_observed` for M-RT); E3 evaluator
run (trace, screenshots, axe, Lighthouse, per-criterion pass/fail, `seed`); E4 founder
walkthrough or provider confirmation. Fields: `producer ∈ {worker, evaluator, founder,
provider, builder_claim}`, `commit_sha`, `preview_url`, `check_version`, `sha256`,
`captured_at`, `seed`. `done` is a SQL function over evidence rows (debate-3 §9.8).

Review items (count against 5/day): `variant_pick`, `walkthrough` (one screenshot, one
sentence, pass / fail / comment), `breaker`. Digests (free): assumptions digest, lockfile
diff, regression notice, trust score (`evaluator_vs_founder_disagreement`). Cards (K2,
count against 3/day, only opened by `gate()`): `connect_account`, `go_live`, `fork`
(phrased as a product consequence with default and `default_applies_at`), `live_key`.
A fork cluster is bundled into one card with a recommended set (debate-4 §7.7).

Status vocabulary (one per axis; CONTEXT.md must carry the same words): `status.build ∈
{todo, in_progress, built}` (worker-derived from `agent_runs`); `status.verification ∈
{unverified, verified, failed}` (worker-derived from evidence; `verified` is the only
meaning of done); `status.blocked_on` (§3.3); `status.freshness ∈ {current, suspect}`
(trace-check from `requirement_hash` and flipped assumptions). Retired: Anthropic `passes`
boolean, Taskmaster `deferred`, Kiro `completed`, RQ2 `needs_decision` (folded into
`blocked_on.kind = card`).

### 3.6 Intake question set (writers copy into `21-`)

Q0 is read, not asked: the planner restates the idea as a one-paragraph press release plus
breadboard and marks Spec Kit's ten coverage categories (functional scope, domain/data
model, interaction/UX, NFRs, integrations, edge cases, constraints/tradeoffs, terminology,
completion signals, placeholders; RQ1 §KQ2) Clear / Partial / Missing.

| # | Founder wording (multiple choice, recommended default first) | Drives | Default if not asked |
| --- | --- | --- | --- |
| Q1 | Who uses this, and what breaks for them today without it? (drafted from the idea; founder confirms or edits) | actor, problem, P1 journey | never blocks; drafted |
| Q2 | What is the one thing a first user must do end to end on day one? | spine path, skeleton | drafted from Q1 |
| Q3 | How big a bet: a weekend page, a few weeks for a working v1, or a real product over months? | appetite, budget ceilings | weeks |
| Q4 | Just individual users, or companies/teams that each have their own private space and data? | tenancy (C3) | individuals; reopen at first team request |
| Q5 | Does money move? Who pays whom, one-off or subscription, and do you ever pay out to others? | `payments`, `payouts` | none; waitlist; reopen at first paying customer |
| Q6 | Do two kinds of people both sign up on their own and transact with each other without you in the loop (buyers and sellers, hosts and guests)? | `two_sided` (C3) | single population |
| Q7 | Must several people see each other's changes live, or is refresh fine? | `realtime` | refresh |
| Q8 | Where does the truth already live (spreadsheet, Shopify, Stripe, calendar, inbox)? | `integrations` | none |
| Q9 | Does this handle health, financial, children's or EU-resident personal data, or anything a regulator cares about? | `regulated` (C4) | no |
| Q10 | Anything this must not do in v1? | no-gos | drafted from Q2–Q3 |

Selection: Q1–Q3 always (they are confirmations of drafts); two more slots go to the
highest Impact × Uncertainty among Q4–Q9 as marked in Q0; Q10 is drafted. Everything not
asked is a row in the assumptions digest (one review item, no quota) with a one-tap flip.
Never asked: auth mechanism, sessions, retention, performance targets, error handling,
framework, hosting, styling, analytics (Spec Kit defaults, RQ1 §KQ5). Stop when: every
category is Clear or defaulted with a reopen trigger; or the next question would not change
the spine, data-model root, payment path or class; or five are asked; or the founder says
build. Round 2 (max 3) only after a failed skeleton walkthrough (G9).

### 3.7 Escalation dials

One state machine, counters in `agent_runs`:
attempt 1 builder `standard` → fail → attempt 2 fresh session, same tier, FixBrief → fail
→ attempt 3 fresh session, `strong` tier → fail → breaker → planner re-plans or cancels →
`breaker` review item. Independent breaker: spend ≥1.5× `appetite_usd` → `breaker` item.
Runtime dials: evaluator passes but founder fails → evaluator on `strong` for this company
+ lesson row; nightly G8 regression → stop the line, deterministic bisection by reverse
revert (debate-4 §5.6), FixBrief, no new feature until green; class change at runtime →
`fork` card phrased as consequence ("you asked for payments; that adds X days and a
Stripe account").

---

## 4. Rules in, rules out

### 4.1 Rules that survive

| Rule | Level | Basis | Classes | Kind |
| --- | --- | --- | --- | --- |
| `done` only from worker/evaluator evidence (E2 + E3 per criterion) via `record_evidence()` and a SQL `done` function; `plausibleRef` removed; builder `artifact_id` never counts | MUST | H2, H13; RQ5 §KQ4 (B); debate-3 §4.3 | all | invariant |
| Builder cannot write tests outside its feature, CI, lockfiles, `.claude`, `.git`, `features.json` planner fields; worker-side G0 on the pushed SHA | MUST | H2, H13; ImpossibleBench (A) | all | invariant |
| Acceptance suite authored by the evaluator from `steps` before build, stored in North Storage, parameterised with a fresh recorded seed per run | MUST | H13; METR 43× (A); debate-3 §4.1 | C2+ (C1: template smoke suite) | invariant |
| Pipeline first, deployed preview, first acceptance test before feature code, skeleton kept and replayed nightly | MUST | H3 (C), H2 mechanism (c) | all | invariant |
| Evaluator: fresh context, own config dir, read-only, no Agent/Web tools, pinned alias and rubric, platform-fixed budget; deterministic criteria decide, model vetoes | MUST | H1 (A for separation, B for browser) | all | invariant |
| Fresh session per feature; after a failed gate restart from artifacts with FixBrief; transcript resume only for crash/timeout | MUST | H6 (A premise) | all | model-limit rule, dated 2026-10 |
| Session-start read set ≤20 KB in fixed order: CLAUDE.md, `## Now`, feature row + deps, TaskBrief, latest FixBrief, `git log -20` | MUST | H6, H9'; debate-4 §3.3.3 | all | invariant |
| Spec and acceptance criteria at prompt start, task at end | SHOULD | Liu U-curve (A) | all | model-limit rule |
| Wave size 1; parallel read-only fan-out ≤3 Explore subagents; parallel writers only per §2 row 7 | MUST | H7 (B/C) | all | release-1 rule |
| Machine-checkable plan: `BuildPlan` rows canonical in DB, `features.json` projection, EARS statement, Gherkin `steps`, trace-check in the worker | MUST (trace-check gates C2+, reports C1) | H5 (B) | all | invariant |
| Intake: 5 multiple-choice questions, defaults pre-selected, zero cards, assumptions digest; classifier output shown as one sentence | MUST | H4 (A/D), H12 | all | design choice, to be measured |
| `CLAUDE.md` ≤200 lines / ≤8 KB from a template filled by `intake.json`; non-inferable instructions only; hooks for anything that must never happen | MUST | H9' (B), ETH (A) | all | invariant |
| Skills only for user-triggered procedures; never for gate or evidence rules | MUST | H9' (B) | all | invariant |
| Codebase invariants for the product: I1 size, I2 Zod at every boundary, I3 checked returns / no floating promises, I4 dependency direction, I5 no shared mutable module state, I8 zero warnings, I10 ≤400 changed lines per PR, I11 acceptance-test-first, I12 no control flow or sleeps in tests, I14 RLS on every table, I15 no secrets in client or repo; all lint or probe | MUST | H8 half 1 (A), H11 (B), debate-3 §6 | all (I14 when `auth`) | invariant until H8' says otherwise |
| I9 rule of three, I13 "every rule that can be a hook is a hook" | SHOULD | Metz/Abramov (C); Anthropic advisory vs deterministic (B) | all | process |
| Agent-action invariants (gate(), append-only, quota, sandbox, kill switch) apply to North's agents and are not scaffolded into the product | MUST | CLAUDE.md; debate-4 §1.2 | all | invariant |
| Review item = one screenshot + one sentence + pass/fail/comment; one per slice, variant pick, breaker | MUST | H10 (C), DV4; debate-2 §3 | all | invariant |
| Cards only from `gate()`, only for forks (new/superseded ADR, stack change, new integration, production, live key), with default and deadline; fork clusters bundled | MUST | H10 (B); debate-3 §7 | all | invariant |
| Appetite in dollars per feature and per build; estimate shown before build; breaker at 1.5× | MUST | H13 (A); RQ8 gap 4 | all | invariant |
| Modular monolith; one deployable at C1–C2; second deployable only via M-RT template | SHOULD | RQ3 §KQ5 (C/B) | all | design choice |
| Planner ADR for tenancy / data-model root; mini design doc for the data-model-root slice | MUST at C3+, MAY at C2 | RQ2 §KQ3 (C) | C3, C4 | design choice |
| Reviewer with fixed checklist, blocks CRITICAL/HIGH only, items a tool can confirm are moved to G1/G6 | MUST at C3+ | RQ7 §KQ5 (B); Luu (C) | C3, C4 | design choice |
| Lesson row + one checklist/gate edit after any false done; company vs platform scope | MUST | H11 (B); debate-4 §4.8 | all | invariant |
| Record from build one: `evaluator_fail_rate_on_builder_done`, `evaluator_vs_founder_disagreement`, G5 flag rate, breaker trips, cost per accepted feature by role, DV1–DV6 | MUST | all experiments | all | invariant |
| Any role may `halt`; the worker parks the build and the planner rules before restart | MUST | RQ7 §KQ1 andon (B); §2 row 31 | all | invariant |
| Keep `effort` and tool lists constant within a role's run; fleet-shared static prefix first, tenant content last; fork only for variant drafts (N = 2–3), never for critics | MUST | RQ4 §Q7 prompt caching (B); debate-4 §4.5 | all | invariant |
| Every handoff artifact carries objective, output schema, allowed tools, boundaries, and the upstream decisions already taken (ADR ids, assumptions) | MUST | RQ7 §KQ4 Inferences (B); Cognition "actions carry implicit decisions" (C) | all | invariant |
| Every rule encoding a model limitation (session boundary, chunk size, audit recall, retry caps) carries a date and is re-tested in `packages/evals` at each model release; invariants are not | MUST | RQ4 §Open 8; RQ2 §Open 5 | all | process |
| Builder-facing docs are vendored snapshots; no `WebFetch`/`WebSearch` on any role with write or Bash tools | MUST | debate-3 MUST 6 (A1, A2) | all | invariant |
| Provider contract tests run nightly against the account named in gap 23; a failing contract test quarantines the fake and opens a digest, never a card | MUST at C2+ | RQ5 §KQ1 (B); RQ5 §Open 7 | C2+ | design choice |

### 4.2 Cut or deferred

| Proposal | Decision | Killed by |
| --- | --- | --- |
| Mutation score as gate (G4) | nightly informational, C4 only | debate-2 §2, §9 |
| Sealed environment as anti-retrieval control | kept for A2/A3 only (§2 row 18) | debate-2 §2 reframed by debate-3 |
| Sonnet transcript audit | `fast` tier only, veto only | debate-2 §1.4 ($34 vs $1.60 per month) |
| LLM reviewer below C3; consultant as standing role | cut; consultant escalation-only | debate-2 §2; Luu (RQ7 §KQ3) |
| Sprint contracts | cut; `steps` + hidden suite is the contract | RQ2 §KQ1 (Anthropic V2); debate-2 §2 |
| Eleven always-on artifacts | six always, rest class-selected | debate-2 §9 |
| Postmortem document | lesson row + artefact edit | debate-2 §2 |
| 7 + 3 questions, "two cards consumed", per-phase mini-intake, Q1 as hard block | cut | debate-2 §3, §8.6; RQ1 §Open 5 |
| Builder confidence score routing cards (RQ8 copy 2) | cut | self-grading, RQ8 §Open 4 |
| Haynes 2009 and all medical-checklist analogies | deleted | debate-1 §7 (Urbach 2014) |
| Cursor 247/160,469; SPOQ; "JSON edited less recklessly"; Karpathy eight-agent post; Replit ">30%" as market base rate; MirrorCode ~80%; SWE-bench Verified 59.4% | deleted or demoted to "vendor admission" | debate-1 §7 |
| Per-task E3 at every class | replaced by the evaluation unit per class | debate-2 §1.3 |
| Reviewer size rejection >200 lines | replaced by the 400-line worker check | debate-2 §9 |
| `AGENTS.md` as a second always-on file | MAY, one-line pointer only, when a non-Claude agent is used | RQ4 §Q1 (read only without CLAUDE.md) |
| Property derivation from EARS for UI features (Kiro) | deferred; MAY for pure core invariants | RQ8 §Open 6 |

---

## 5. Cost and attention envelope

Pragmatist arithmetic (debate-2 §1) adopted unchanged; the sanity check against Anthropic's
$124.70 run holds ($0.13 per criterion both ways). Every dollar figure and every count is an
estimate to be replaced by `agent_runs` measurements after the 20 golden tasks (debate-2
§8.10; RQ4 §Open 7). Non-engineering share of the founder journey is $1.71, leaving $6.29.

| | C1 `landing` | C2 `app` | C3 `platform` | C4 `critical` |
| --- | --- | --- | --- | --- |
| Features / slices (typical) | 6 / 1 | 30 / 6 | 50–80 / 8–12 | 80+ / 12+ |
| Gates | G0, G1, G2, G5 (det + `fast` audit), G6, G7 once, G8, G9 per build | + G3, RLS probe, trace-check gates, G7 per slice, G9 per milestone | + Reviewer, ADR, design doc, cross-tenant probe, M-RT when flagged | + M-PAY/M-REG modules, G7 per feature, G4 nightly, consultant on escalation |
| Roles | builder + evaluator + worker (plan from template) | + planner (`standard`; `strong` on M-PAY slice) | + reviewer; planner `strong` | + consultant (level 2); security checklist mandatory |
| Evaluator | `standard`, one pass | `standard` per slice; `strong` after founder disagreement | `standard` per slice | `standard` per feature |
| Retry caps | 2 attempts, then `strong`, then breaker; 1.5× appetite | same | same | same |
| Claude cost per feature (est.) | $0.75 | $1.50 | $2.50 | $3.75 |
| Claude cost per build (est.) | $4.5 (+$0.3 for 3 forked directions) | ~$45 | ~$150–200 | ~$300 |
| Founder journey check | $4.8 + $1.71 = $6.5 < $8 | n/a; price per accepted feature | n/a | not dogfoodable inside $100/month |
| Review items per build | 2 (direction pick, skeleton walkthrough) + 1 digest | ~10 (6 slice walkthroughs, 1 pick, ~2 breakers) + digests | ~15 | ~20 |
| Cards per build | 2 (`connect_account`, `go_live`) | ~4 (+ `live_key`, one `fork`) | 6–8 bundled by cluster | 8–12 bundled; defaults apply at deadline |
| Appetite breaker | build $6; change run $1; 1.5× → `breaker` item | build $60 | build $250 | build $400 |
| Monthly dev budget (tiered) | $49 total: 80 change runs $22, 4 acceptance builds $19, nightly $3, sandbox $5 | | | |

Thresholds carried into the class table (gaps 13): assertion density ≥1 value assertion per
test; edit/test cycles per file ≤8 before G5 flags; rate-limit probe 30 requests in 10 s
expects 429; Lighthouse performance ≥70 / accessibility ≥90 at C1–C2, ≥80 / ≥95 at C3+;
all to be tuned on DV5.

Provenance of the numbers above, so writers label each correctly:

- Measured (one run, B): Anthropic V2 $124.70 total, planner $0.46, QA rounds $3.09–4.06
  (RQ2 §KQ1); solo run $9 broken (RQ4 §Q2). Used only as a sanity anchor.
- Published prices (B): per-MTok rates in debate-2 §1.1 from `real-testing-strategy.md` §3.1.
- Estimates (debate-2 §1.2–1.4, token shapes assumed): per-step costs, p_fail 0.35 and 0.6
  expected fix rounds, 25 builder turns, 8 screenshots per evaluator run, class feature
  counts, monthly $49. Replace each with the `agent_runs` median and p90 after 20 golden
  tasks; publish no per-feature price before then.
- Design constants (this file): evaluation unit per class, retry caps, appetite multiples,
  thresholds. Re-tune on DV2 and DV5, never on self-report (RQ6 §KQ7).
- Founder counts (debate-2 §3): derived from the proposal texts, not observed; the review
  budget (5 items, 10 min) is only consistent if every item is one screenshot and one
  sentence, which §3.5 makes mandatory.

Expected throughput ceiling: the review budget, not compute. A C2 build of 30 features at
~10 items and ~4 cards takes at least 2 founder-days of review and 2 days of cards; writers
state this in `20-blueprint-overview.md` so the founder sees it before the build starts.

---

## 6. Security MUST rules (from debate-3 §9)

All twenty rules are adopted with the threat and check as written in debate-3 §9; the
blueprint reproduces them verbatim in `26-security-controls.md`. Amendments:

- Rule 9: the protected list includes `features.json` planner fields and `docs/SPEC.md`
  rows for the builder (requirement_hash makes edits visible).
- Rule 13: the §6 table is imposed with no founder switch; the "no outbound call to an
  undeclared host" row becomes a deterministic grep gate at every class (there is no
  reviewer at C1–C2); class modules add webhook-signature test (M-PAY), `tenant_id` in
  every policy (C3), append-only audit table and consent record (M-REG).
- Rule 19: a task needing a second card in one day proceeds on the card's default at
  `default_applies_at`; it is parked only when no safe default exists.
- Added from debate-3 §4.1 and §4.2: evaluator UA and headers indistinguishable from a
  normal browser except the bypass secret; one anonymous fetch without bypass; production
  is the promoted immutable preview build, never a rebuild; fresh seeded test data per run.
- Added from debate-3 §3: `CLAUDE_CODE_FORK_SUBAGENT=0`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS ≤ 3`
  for builders, `strictAllowlist: true`, and the SDK upgrade to 0.3.302 only with these set.
- Added from debate-3 §7 and debate-4 §4.10: per-company kill covers runs, worktrees and
  preview deploys within 5 s; a separate fleet-wide stop exists for model incidents.

Rejected: none. Downgraded: debate-3's "sealed environment holds against retrieval" is
kept as an A2/A3 control, not as an anti-cheating result (§2 row 18). Open question
answered: a verifier sandbox per task costs compute, not Claude dollars, and G7 cadence
follows §2 row 8, so the pipeline fits the C1 budget.

---

## 7. Gaps the writers must fill

| # | Gap (debate-4 §7 unless noted) | Artifact | Owner document |
| --- | --- | --- | --- |
| 1 | Session-start read set | ordered checklist with byte caps (§4.1) | 24 |
| 2 | Status source of truth | ruling §2 row 19 + `BuildPlan` schema | 22 |
| 3 | Zod schemas for all handoffs | schema list in §3.3, files under `packages/core/src/engineering/` | 22 |
| 4 | Agent rules vs codebase rules | two tables (§4.1) | 23 |
| 5 | Join table class → gates → evidence → roles → tier → budget → cards | §3.1 + §3.4 + §5 as one table | 20 (summary), 25 (gate detail) |
| 6 | Retry state machine | §3.5 dials | 24 |
| 7 | Card defaults, deadlines, blast radius | `blocked_on` schema, feature `assumptions: [id]`, bundling policy | 21, 22 |
| 8 | Progress log template | `## Now` ≤40 lines / `## Log` | 22 |
| 9 | Widening procedure | debate-4 §5 verbatim, `writes` field, `modules.json` schema | 24 |
| 10 | Hidden suite home and regeneration | Storage path keyed by `sha256(steps)`; regenerate on hash change | 25 |
| 11 | Infrastructure template per class and module | what deploys where; stable preview URL for webhooks; two deployables pinned to one `commit_sha` (M-RT) | 23 |
| 12 | Intake schema, classifier, Q6 rewording, `payments` flag, ten coverage categories (Spec Kit list, RQ1 §KQ2) | `IntakeRecord` schema, `classify.ts` spec with tests, question table | 21 |
| 13 | Gate thresholds | §5 threshold line, `e2e/acceptance/**` convention | 25 |
| 14 | C1 plan without a planner | single-slice `BuildPlan` template emitted by intake | 21 |
| 15 | Always-on files for founder repos | `CLAUDE.md` and `.claude/rules/*.md` templates with `intake.json` slots; fleet-shared prefix | 23 |
| 16 | Cross-tenant and cross-role probe | evaluator checklist (second org, second role, unauthenticated) as required E3 rows at C3+ | 25, 26 |
| 17 | Fleet table: budget, profile, concurrency key, rate-limit (429/529 never counts as an attempt), nightly sampling | fleet table | 24 |
| 18 | Lesson scope | company vs platform policy, three-company minimum | 24 |
| 19 | 400-line exemption | one line in the CLAUDE.md template | 23 |
| 20 | Kill switch scope | per-company checklist and fleet stop | 26 |
| 21 | Evidence kind for real-time (debate-4 §1.3) | `sync_observed` schema | 25 |
| 22 | Decision tree for the architectural line (RQ7 §Open 5) | four-part test as checklist: new/superseded ADR, stack change, new integration, production or live key | 24 |
| 23 | Provider sandbox ownership (debate-4 §4.9) | per-provider table: founder's own account where the product needs it anyway (Stripe test mode, Supabase, Vercel, GitHub); North's fenced account otherwise | 26 |

---

## 8. Blueprint document plan

Each file ≤400 lines; split rule given where a topic risks overflow.

| File | Sections | Rulings carried |
| --- | --- | --- |
| `00-README.md` | abstract (≤15 lines); how the build session uses the folder; reading order; glossary pointer to §3; status of every number ("estimate until `agent_runs`") | grading rule; §5 caveat |
| `10-findings-and-verdicts.md` | results per RQ1–RQ8 (≤25 lines each); hypothesis table §1 verbatim including H13; contradictions table §2; limitations (Anthropic over-fit, benchmark contamination, survivorship, no DV1 anywhere); experiments list with DV mapping | §1, §2, deletions in §4.2 |
| `20-blueprint-overview.md` | one-page loop (intake → plan → skeleton → widen → evaluate → release); the join table (gap 5); role table §3.2; rule tagging convention (MUST/SHOULD/MAY, grade, kind) | §3.1, §3.2, §5 |
| `21-intake-protocol.md` | question table (Q0 restatement, Q1–Q10 with rewritten Q6), selection rule (Q1–Q3 fixed, two slots by Impact × Uncertainty), stop rule, assumptions digest, `IntakeRecord` schema, classifier with tests, C1 single-slice plan template, card bundling and defaults | §2 rows 4, 16; §3.1; §4.1 intake row; gaps 7, 12, 14 |
| `22-spec-and-plan-artifacts.md` | artifact set with size bounds and owners; `BuildPlan` schema; EARS + Gherkin conventions; `features.json` projection rule; `progress.md` template; TaskBrief, FixBrief, BuilderClaim, GateReport, TestReport, ReviewReport, Lesson schemas; trace-check; `requirement_hash`; 400-line exemption | §2 rows 17, 19, 21; §3.3; gaps 2, 3, 7, 8 |
| `23-architecture-and-principles.md` | two invariant tables (agent actions vs codebase) with lint/probe per row; decision matrix by class and module (architecture, paradigm, testing); walking-skeleton procedure (RQ3 steps 1–12 with step 2 rule and step 3 template); infrastructure template per class and module; `CLAUDE.md` and rules templates | §4.1 invariant rows; §2 rows 5, 6, 12; gaps 4, 11, 15, 19. Split: if the templates exceed 100 lines, move them to `23a-repo-templates.md` |
| `24-team-topology-and-orchestration.md` | roles and permissions; session-start read set; fresh-context and failure-restart rules; retry state machine; escalation ladder (levels 0–3) with the architectural-line checklist; widening procedure (debate-4 §5); fleet table; lesson scope; review-queue and card policy; metrics to record | §2 rows 1, 2, 3, 7, 8, 20, 25, 26, 27; §3.5; gaps 1, 6, 9, 17, 18, 22 |
| `25-verification-and-evidence.md` | evidence ladder with schema; gate table G0–G9 with class column; evaluation unit per class; acceptance suite authorship, storage and regeneration; mock policy as lint; gaming scan; nightly G8 sampling and bisection; founder walkthrough script; thresholds; `sync_observed` | §2 rows 5, 6, 8, 13, 14, 15; §3.4; §3.5 evidence; gaps 10, 13, 16, 21 |
| `26-security-controls.md` | threat model summary (debate-3 §1); the twenty MUST rules with amendments §6; generated-app security table (debate-3 §6) plus class modules; kill switch and quota controls; provider sandbox ownership; spec corrections (Bash allowlist, SDK upgrade) | §6; §2 rows 18, 22, 23, 24; gaps 16, 20, 23 |

Writers: where a note's text and this file disagree, this file wins; where this file is
silent, prefer the lowest-cost deterministic option and label the rule "to be measured".
