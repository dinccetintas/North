# North engineering layer: research and blueprint

Purpose: the index of this folder; what was asked, what was found, and how the build session turns the blueprint into milestones.
Related: `01-research-protocol.md`, `10-findings-and-verdicts.md`, `20-blueprint-overview.md`, `21-intake-protocol.md`, `22-spec-and-plan-artifacts.md`, `23-architecture-and-principles.md`, `23a-repo-templates.md`, `24-team-topology-and-orchestration.md`, `25-verification-and-evidence.md`, `26-security-controls.md`.

Status: 2026-10-17; research complete; blueprint v1; implementation not started.

## Abstract

North must turn a non-technical founder's idea into software that survives its first real click, inside a bounded budget of money and founder attention. The question (RQ0): how should an AI engineering team of agents, artifacts, process and verification be structured so that an arbitrary product idea passes a real walkthrough on the first "done"?

Method: 8 research personas gathered graded evidence on elicitation, spec formats, architecture, agent harnesses, verification, empirical failure modes, team topology and competing products (round 1). 4 adversarial reviewers attacked every hypothesis and listed contradictions between notes (round 2). 1 arbiter settled 34 contradictions and fixed one vocabulary; 3 writers produced the report and blueprint from those rulings in parallel; 1 editor made the folder consistent (round 3).

Headline findings. The best-measured lever is structural anti-gaming: tests the builder cannot see or write, no scorer in context, bounded retries with a legitimate exit (three labs, grade A). Self-grading bias is peer-reviewed and vendor-independent (A). Context degrades with length and turns (A), but the remedy for coding agents is unmeasured. Always-on instruction files help only when short and non-inferable (B); long or model-written files cost more and help nothing (A). No source anywhere measures first-pass acceptance for any topology, plan format or verification regime. Several claims the notes leaned on were deleted as evidence.

Central recommendation. Build structural controls, not instructions. Evidence is produced by a deterministic worker or an independent evaluator acting on the deployed preview, never by the builder. The first deliverable is a deployed vertical slice. Each feature runs in a fresh session. The founder's review budget, not compute, is the throughput ceiling. The product's complexity class, computed at intake, selects how much ceremony applies. Every rule carries its grade and the experiment that could retire it.

## Özet

Soru: teknik olmayan bir kurucunun fikrini, ilk gerçek tıklamada çalışan yazılıma çeviren bir yapay zeka mühendislik ekibi nasıl kurulur? Para ve kurucu dikkati sınırlı kalmalı.

Yöntem: 8 araştırma personası kanıt topladı, 4 eleştirmen her hipoteze saldırdı, 1 hakem 34 çelişkiyi karara bağladı, 3 yazar planı yazdı, 1 editör bütünü tutarlı hale getirdi.

Bulgular: en güçlü kanıt yapısal kontrollerde. Kodu yazan ajan testleri görmez ve değiştiremez; "bitti" kararını yalnızca bağımsız bir değerlendirici ve deterministik araçlar verir; her özellik taze bir oturumda yapılır. Hiçbir kaynak ilk seferde kabul oranını ölçmüyor; North bunu kendisi ölçecek.

Öneri: önce dağıtılmış ince bir dilim, sonra dilim dilim genişleme. Fikir alımında en fazla 5 soru, sıfır karar kartı. Ürün sınıfı (C1 sayfa, C2 uygulama, C3 platform, C4 kritik) ne kadar tören uygulanacağını seçer. Günde 5 inceleme ve 3 kart sınırı hızı belirler; bir C2 ürünü en az iki kurucu-günü inceleme ister. Her sayı, `agent_runs` ölçmeden önce tahmindir.

## How the build session uses this folder

1. Read `20-blueprint-overview.md` first: the loop (§1), the class and flag system (§2), the roles (§3) and the join table (§4). Find the class the first golden tasks belong to (C1 and C2).
2. Read `21` to `26` in loop order: intake (`21`), plan artifacts (`22`), architecture and the walking skeleton (`23`, templates in `23a`), orchestration (`24`), verification (`25`), security (`26`).
3. Treat every MUST rule as an acceptance criterion. A MUST that only lives in prose is a defect (`20` §0); it needs a hook, lint, SQL function or worker check, and a test that proves the check fires.
4. Treat the Zod schemas as the contracts to implement. They are `IntakeRecord` and `classify()` (`21` §9, §10); `BuildPlan`, `FeaturesJson` and the handoff schemas (`22` §3, §6, §9); `Evidence` and `SyncObserved` (`25` §1, §9); `ModulesMap` (`24` §7). Files go under `packages/core/src/engineering/`.
5. Create `docs/plans/M<n>.md` from the join table in `20` §4: one milestone per column group, starting with everything C1 needs, then the C2 additions. Each milestone names its gates, roles, evidence and the SPEC IDs it closes, with the acceptance test from `25`.
6. Record every number as an estimate until `agent_runs` measures it (`20` §8). Publish no per-feature price before the 20 golden tasks have run.
7. Run the experiments in `10-findings-and-verdicts.md` §8 in `packages/evals`; record `evaluator_fail_rate_on_builder_done`, `evaluator_vs_founder_disagreement`, G5 flag rate, breaker trips and DV1-DV6 from build one (MUST).
8. Make the spec corrections in `26` §7 before the first engineering run, and the `verifier.ts` change in `25` §13.
9. Keep `CONTEXT.md` aligned with the status vocabulary of `20` §5 and `22` §10; retired aliases do not enter code, DB or UI.

### A milestone split the join table suggests

One way to cut `20` §4 into `docs/plans/M<n>.md` files. Numbers are placeholders; the build session assigns real milestone IDs.

| Milestone | Scope | Blueprint sections | Acceptance test (from `25`) |
| --- | --- | --- | --- |
| M-A | Intake worker, Q0 drafting, question selection and stop rule, `IntakeRecord`, `classify()` with the 14 test cases, class sentence, assumptions digest | `21` §1-§11 | Every row of `21` §10.1 passes; a record with six asked questions is rejected |
| M-B | `BuildPlan` rows, C1 template filler, `docs/SPEC.md` lint, `features.json` projection, `progress.md`, trace-check, `requirement_hash` | `22` §1-§8, `21` §12 | Hand edit to `features.json` is a G0 hit; `plan_hash` mismatch opens a `breaker` item |
| M-C | Repo templates, hooks, `init.sh`, lint, infrastructure template, pipeline before features, G0-G2 and G6 in the verifier sandbox | `23` §3-§5, `23a`, `25` §2 | A trivial page is READY on a preview for a pushed SHA before any feature; a crafted diff to `e2e/acceptance/**` fails G0 |
| M-D | Evaluator role, acceptance-suite authoring and Storage, G7, `record_evidence()`, SQL `done`, `verifier.ts` change, G9 walkthrough script | `25` §1, §3-§4, §8, §13, `24` §1 | `done` unreachable without E2 plus E3 rows (property test); a `builder_claim` insert into `evidence` is rejected |
| M-E | Read set, fresh-context rules, retry machine, breaker, `halt`, escalation ladder, review queue and card policy, metrics view | `24` §2-§5, §11-§12 | Attempt counters follow `24` §4; a second builder in one build is refused; `halt` parks the build |
| M-F | Security rules 1-24, kill switch checklist, budget guards, provider ownership, spec corrections, G8 nightly replay and bisection | `26`, `25` §7 | Kill flag stops a `sleep 300` sandboxed run within 5 s; nightly regression stops the line and names the culprit |
| M-G | C2 additions: planner role, `.claude/rules`, G3, RLS probe, G5 transcript audit as MUST, M-PAY and M-INT modules, per-slice evaluation | `20` §4 column C2, `23` §2, `26` §3 | The first C2 golden task reaches `verified` with one E2 and one E3 row per criterion |

## Headline numbers (all estimates until `agent_runs` measures them)

| | C1 `landing` | C2 `app` | C3 `platform` | C4 `critical` |
| --- | --- | --- | --- | --- |
| Claude cost per build | $4.5 | ~$45 | ~$150-200 | ~$300 |
| Review items per build | 2 + 1 digest | ~10 | ~15 | ~20 |
| Cards per build | 2 | ~4 | 6-8 | 8-12 |
| Appetite ceiling per build | $6 | $60 | $250 | $400 |
| Founder time | one walkthrough | at least two founder-days | more | more; `go_live` per milestone |

Source: `20` §4 and §8; provenance of each number in `notes/synthesis-decisions.md` §5. The founder journey check for C1 is $4.8 plus $1.71 non-engineering, under the $8 ceiling.

## File map

| File | Purpose | Lines | Who reads it |
| --- | --- | --- | --- |
| `00-README.md` | This index; abstract; how to use the folder | 152 | founder, build session |
| `01-research-protocol.md` | The question, variables, hypotheses, method and deliverables (read-only history) | 129 | build session, evaluator |
| `10-findings-and-verdicts.md` | Research report: results per RQ, verdicts, 35 settled contradictions, limitations, experiments, editor's log | 383 | founder (abstract, §6), build session (§8), evaluator |
| `20-blueprint-overview.md` | The loop, classes and flags, roles, join table, gates at a glance, vocabulary, throughput ceiling, reading order, estimate register | 260 | founder (§2, §6), build session, planner agent, evaluator |
| `21-intake-protocol.md` | Q0 restatement, Q1-Q10, selection and stop rules, assumptions digest, `IntakeRecord`, classifier with tests, C1 plan template, fork cards | 350 | build session, planner agent |
| `22-spec-and-plan-artifacts.md` | Artifact set, status source of truth, `BuildPlan`, EARS and Gherkin, `features.json`, `progress.md`, handoff schemas, trace-check | 355 | build session, planner agent |
| `23-architecture-and-principles.md` | Agent-action and codebase invariants, decision matrix by class and module, walking skeleton, infrastructure, always-on files | 183 | build session, planner agent |
| `23a-repo-templates.md` | Rendered `CLAUDE.md`, rules, hooks, `init.sh`, lint and `SPEC.md` header templates | 214 | build session |
| `24-team-topology-and-orchestration.md` | Roles and tool policy, read set, fresh-context rules, retry machine, escalation ladder, widening, continuity, fleet table, lessons, review policy, metrics | 318 | build session, planner agent, evaluator |
| `25-verification-and-evidence.md` | Evidence ladder, gates G0-G9, evaluation unit, acceptance suites, mock lint, gaming scan, G8 replay, walkthrough script, `sync_observed`, probes, thresholds, `verifier.ts` | 296 | build session, evaluator |
| `26-security-controls.md` | Threat model, 24 MUST rules, generated-app security table, kill switch, budget and quota guards, provider ownership, SDK names, spec corrections | 312 | build session, evaluator |
| `notes/` | Round-1 evidence (RQ1-RQ8), round-2 critiques (debate-1..4), round-3 rulings (`synthesis-decisions.md`); read-only | 13 files | anyone checking a claim or URL |

"Planner agent" is the North role that writes `BuildPlan` rows at C2+; "evaluator" is the critic role and any reviewer of this research.

## Reading order

| Reader | Order |
| --- | --- |
| Founder | `00` Abstract and Özet; `20` §2 (which class is my idea), §6 (how much of my time a build takes); `10` §6; the open questions below |
| Build session | `20`, `21`, `22`, `23`, `23a`, `24`, `25`, `26`, then `10` §8 and `26` §7 |
| Planner agent (as reference material) | `20` §2-§5, `21` §12-§13, `22` §3-§8, `23` §2-§3, `24` §5-§7 |
| Evaluator or reviewer of the research | `01`, `10`, `notes/synthesis-decisions.md`, then the note behind any claim |

## Vocabulary pointer

One vocabulary, defined once: `notes/synthesis-decisions.md` §3 (classes, flags and modules, roles, artifacts, gates, evidence levels, status words, review-item and card kinds, question set, escalation dials). `20-blueprint-overview.md` §5 is the quick reference the blueprint files use. `CONTEXT.md` must carry the same words. Retired aliases (generator, coder, implementer, QA agent, auditor, judge, SelfReport, `passes`, `deferred`, `completed`, `needs_decision`, the RQ1 archetype names, the RQ3 "verification tier") appear only in tables that name them as retired.

## What is decided vs what is to be measured

| Decided (invariant or ruling) | To be measured (estimate, design choice, model-limit rule) |
| --- | --- |
| `done` only from worker E2 and evaluator E3 rows per criterion; builder claims never count (`25` §1) | Magnitude of the evaluator effect, H1' (`10` §8) |
| Builder cannot touch tests outside its feature, CI, lockfile, `.claude`, `.git`, planner fields; G0 on the pushed SHA (`25` §2, `26` rule 9) | Whether G5 flags predict G7 failure, H2' |
| Acceptance suite authored by the evaluator from `steps`, hidden in Storage, fresh seed per run (`25` §4) | Skeleton-first vs layer-first outcomes, H3' |
| Walking skeleton before feature code; nightly G8 replay (`23` §3, `25` §7) | Question cap of 5, round 2 cap of 3, H4' |
| Classes C1-C4 and flags with `max()` precedence; the classifier is a tested pure function (`21` §10) | Class-selected methodology effect, H12' |
| Fresh session per feature; restart from artifacts with `FixBrief`; resume only for crash or timeout (`24` §3) | Fresh session vs compaction per model release, H6' (dated 2026-10) |
| Wave size 1 at release 1; parallel writers only with `parallel: true`, `writes`, `modules.json`, deterministic integrator (`24` §6-§7) | Parallel writers at C2+, H7' |
| Retry machine: 2 attempts, then `strong`, then breaker; breaker also at 1.5× appetite (`24` §4) | Every dollar figure and count in `20` §4 and §8 |
| Intake: at most 5 multiple-choice questions, zero cards, one assumptions digest (`21`) | Thresholds: assertion density ≥1, cycles ≤8, Lighthouse 70/90 and 80/95, 30 requests in 10 s |
| Review item = one screenshot, one sentence, pass/fail/comment; 5 items and 3 cards per day; cards only from `gate()` (`24` §11) | Codebase invariants I1-I15 one by one, H8' ablation |
| `CLAUDE.md` ≤200 lines, ≤8 KB, template filled from `intake.json`; hooks for never-rules (`23` §5, `23a`) | Always-on index vs skills on North's own features, H9' |
| The 24 security MUST rules; generated-app security table with no founder switch (`26` §2-§3) | G5 `fast` transcript audit at C1 (MAY; MUST at C2+) |
| Any role may `halt`; the worker parks the build; the planner rules before restart (`24` §5) | Evaluator `strong` after >20% sustained disagreement over 10 builds |

## Relationship to other North documents

| Document | What this folder changes or extends |
| --- | --- |
| `CLAUDE.md` | Unchanged. The seven non-negotiables become table A of `23` §1.1 with a deterministic check per row; the TDD rule governs North's own code only (`10` §5 row 5); generated data files gain a 400-line exemption line in the founder-repo template (`22` §13) |
| `docs/SPEC.md` | Extends: engineering requirements will carry the schemas, gates and metrics of `21`-`26` as new IDs; AGT-3 governs the retry caps (`24` §4); the Bash allowlist text in the studio spec is corrected (`26` §7 row 1) |
| `docs/superpowers/specs/2026-10-16-north-studio-phase-design.md` | Extends the planner / builder / evaluator split and the 5-item, 10-minute review budget; corrects §5.9 (allowlist, SDK upgrade conditions, `deny` not `defer` when `gate()` returns a card) per `26` §7 rows 1-3 |
| `docs/research/dept-engineering.md` | Tested its recommendations against graded evidence; keeps the harness shape and the stack; replaces the uniform gate set with class-selected gates; adopts its four persona corrections (`10` §3 RQ7, §9) |
| `docs/research/real-testing-strategy.md` | Unchanged for North's own tiers T0-T4; the product uses classes C1-C4 instead (`20` §2); its per-MTok prices feed the cost estimates (`20` §8) |
| `docs/research/agent-harness-best-practices.md` | Extended by `24` (read set, fresh-context rules, fleet table) and `26` §6 (verified SDK option names, versions and limits re-read 2026-10-17) |

## Provenance

Everything in `10` and `20`-`26` traces to `notes/`:

| Notes | Content | Cited as |
| --- | --- | --- |
| `notes/RQ1-*.md` to `notes/RQ8-*.md` | Round-1 evidence per sub-question, with URL and grade per finding | `RQn §KQm`, `RQn §Open k` |
| `notes/debate-1-skeptic.md` to `notes/debate-4-scale-executability.md` | Round-2 critiques: grades, contradictions, falsifiable restatements, cost arithmetic, threat model and twenty security rules, five-idea walkthrough and gaps | `debate-n §k` |
| `notes/synthesis-decisions.md` | Round-3 rulings: verdicts (§1), 34 contradictions (§2), vocabulary (§3), rules in and out (§4), cost envelope (§5), security amendments (§6), gaps (§7), document plan (§8) | `synthesis §k` or `synthesis-decisions.md §k` |

All URLs live in the notes and in `10` Sources. Grades: A controlled study or measured production data; B vendor documentation or first-party account; C practitioner essay; D anecdote. A source keeps the lowest grade any note gave it. Where a note and a ruling disagree, the ruling wins; where the rulings are silent, the blueprint prefers the lowest-cost deterministic option and labels the rule "to be measured". One known inconsistency in the rulings (G5 audit at C1) was settled by the editor and is recorded in `10` §5 row 35.

## Open questions for the founder

| # | Question | Raised in |
| --- | --- | --- |
| 1 | Which provider accounts will you connect for the first product: GitHub, Vercel, Supabase, and Stripe test mode? Each is a `connect_account` card at skeleton step 3. | `26` §5, `21` §6 |
| 2 | Do you accept the default stack (Next.js, Supabase, Vercel, Fly for realtime, Stripe) as never-asked defaults, with any change costing a `fork` card? | `23` §2.3 |
| 3 | Do you accept that an unanswered card applies its recommended default after 24 hours, and that intake never asks you a card? | `21` §13, `24` §11 |
| 4 | Is at least two founder-days of review per C2 build acceptable, given 5 items and 3 cards a day? If not, which items would you delegate? | `20` §6 |
| 5 | Which appetite ceilings do you want per class: $6, $60, $250, $400 per build, with the breaker at 1.5×? | `20` §4, `24` §9 |
| 6 | C4 products are not dogfoodable inside the $100 per month dev budget. Raise the budget for C4 tests, or exclude C4 from release 1? | `20` §4 |
| 7 | Production is only ever a promoted preview after a `go_live` card, and any live key needs a `live_key` card. Do you accept these two taps as the only human steps before money or users? | `20` §1 step 11, `26` rules 22, 5 |
| 8 | Should North create fenced Google and Shopify test accounts now, so M-INT contract tests can run before the first integration is requested? | `26` §5 |
| 9 | Do you confirm that the generated-app security table is imposed with no founder-facing switch, even when it slows a demo? | `26` §3 |
| 10 | Which two C2 ideas should be the matched pair for the skeleton-first experiment (H3'), and which 20 golden tasks fill the C1-C2 evaluation set? | `10` §8 |
