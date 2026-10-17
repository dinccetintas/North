# RQ2 — Spec, plan and documentation formats for agent-executed software

Persona: Spec and Documentation Engineer. Date of research: 2026-10-17. Protocol: `docs/research/engineering-layer/01-research-protocol.md` (hypotheses H5, H9; IV2 spec form, IV8 documentation infrastructure; DV5 regression, DV6 spec drift). Evidence grades: **A** controlled study or measured production data; **B** vendor documentation or first-party engineering account; **C** practitioner essay; **D** anecdote or forum.

Scope note: every source was fetched on 2026-10-17; versions and dates are the ones visible on that day. Where a fetched page did not contain a detail the assignment asked for, it is recorded under Gaps rather than filled from memory.

---

## KQ0. What North already does (baseline for the comparison)

### Takeaway
North already runs a three-artifact plan stack (prose task plan, JSON feature list with proofs, newest-first progress log) plus requirement IDs and 16 Nygard-style ADRs; the pieces that work are the ID discipline in tests and the "only a passing test flips `passes`" rule, while the weak points are a spec whose IDs are embedded in a Turkish prose table, a plan file far above the repo's own 400-line rule, and no machine check that ties ID → test → evidence together.

### Cited Findings
- `docs/SPEC.md` is 250 lines, written in Turkish, with requirement IDs (`ONB-1`, `DEC-1`, `AGT-2` …) in a Markdown table whose columns are ID / requirement / acceptance criterion / phase; 41 ID occurrences in the file; the acceptance criterion column is prose, e.g. `AGT-2 … Kanıtsız görev done olamaz` — local file `/home/user/North/docs/SPEC.md` (lines 93–116).
- `CLAUDE.md` (project root) is a 60-line index: pointers to SPEC, architecture spec, glossary and milestone plan; seven numbered non-negotiables; working rules (TDD, immutability, 400-line files, 50-line functions, Zod at boundaries); commands; persona list — `/home/user/North/CLAUDE.md`.
- `docs/plans/M7.md` is 593 lines / 77 KB (M6.md is 106 KB): a header with Goal, Architecture, Tech Stack, Spec pointer and the requirement IDs the milestone closes; Global Constraints; a "Review Focus" list of five adversarial inputs each pinned to the task that owns them; a file-structure table (Create / Modify per package); explicit execution order with independence statements ("Tasks 2, 3, 4, 5 are independent of each other"); then per task: Files, Interfaces (Produces / Consumes with exact TypeScript signatures), and five checkbox steps (failing test → run to verify failure → implement → run to verify pass → commit with `type(M7): … (IDs)`) — `/home/user/North/docs/plans/M7.md`.
- `docs/plans/M7.features.json` (30 lines) holds 21 features with fields `id` (`M7-F1`…), `requirement` (spec ID), `statement`, `proof` (test file paths or evidence paths such as `docs/evidence/M7/acceptance/<date>/`), `passes` (boolean, all `false` at the time of reading) and a top-level `rule`: "Only a passing test or a completed acceptance run flips `passes` to true. Tests are never edited to pass." — `/home/user/North/docs/plans/M7.features.json`.
- `docs/plans/M7.progress.md` is a newest-first log with a rules header ("one line per event; name the task number … never mark a feature `passes` here, only in `M7.features.json` from a passing test") and an "Open items the plan asks to record" list of facts to capture (SDK option names, first real cost, run URLs); entries are dense paragraphs of verified facts and carry-overs ("Task 12 fix round 1", "Task 11 carry-overs") — `/home/user/North/docs/plans/M7.progress.md`.
- 138 of 199 Vitest/Playwright files (69%) contain a requirement ID inside a `describe`/`it`/`test` name (grep on 2026-10-17) — local repo.
- 16 ADRs in `docs/adr/`, numbered `0001`–`0016`, each with `# ADR NNNN: <noun phrase>`, `Status: accepted (date)`, `## Context`, `## Decision`, `## Consequences`; ADR 0016 adds an `## Amendment: M6 security review (2026-10-16)` section rather than a superseding ADR; sizes grew from ~1 KB (0001–0006) to 7–12 KB (0009–0016) — `/home/user/North/docs/adr/`.
- `CONTEXT.md` glossary is 86 lines; seven persona files exist under `.claude/agents/` — local repo.

### Inferences
- North already implements the Anthropic Nov-2025 pattern (feature list JSON + progress file + git) and extends it with a `requirement` and a `proof` field; the gap is enforcement: nothing checks that each `proof` path exists, that the named test passes, or that every spec ID in the milestone header has at least one feature and one test.
- The plan file violates the repo's own "files under 400 lines" rule by 1.5–2.5×, so a fresh-context agent must read 77–106 KB before working; the feature list (5 KB) and the progress log (12 KB) are the right size to be the per-session entry point, and the plan should be read per task, not whole.
- SPEC.md's bilingual state (Turkish spec, English code) is a drift risk: the glossary enforces English code names, but acceptance criteria are not in a form any tool can check.

### Gaps
- No measurement exists in the repo of how often an agent session re-read the whole M7.md versus the task it owned, or how often `passes` was flipped without the named test passing; this would be the cheapest A-grade data to collect in M8.

---

## KQ1. Anthropic's long-running harness articles: artifacts, fields, status rules, earlier failures

### Takeaway
Anthropic's Nov-2025 harness is a feature-list JSON (`category`, `description`, `steps`, `passes`), a `claude-progress.txt` log, an `init.sh` and git, with the rule that agents may only flip `passes` and never delete or edit tests; the Mar-2026 follow-up adds a planner / generator / evaluator split with "sprint contracts" that define done before coding, then removes the sprint construct once Opus 4.6 could decompose natively, recording that harness complexity must be re-tested at every model release.

### Cited Findings
- Published Nov 26, 2025; the initializer agent expands the prompt into a `feature_list.json` (the transcript calls it `tests.json`), creates `init.sh`, a `claude-progress.txt` and an initial git commit; coding agents in later sessions read git log and progress file, pick the highest-priority unfinished feature, start the dev server via `init.sh` and run a basic end-to-end check before new work — [Anthropic, Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (grade B).
- Feature entry fields: `category` ("functional"), `description` ("New chat button creates a fresh conversation"), `steps` (ordered end-to-end actions to verify, five in the example), `passes` (boolean) — same source.
- Status rule: every feature starts failing; "It is unacceptable to remove or edit tests because this could lead to missing or buggy functionality"; coding agents may only edit `passes`, and only "after careful testing" — same source.
- Format rationale: JSON was chosen because "the model is less likely to inappropriately change or overwrite JSON than Markdown" — same source (B; stated as the authors' experience, no numbers).
- Earlier failure modes named: one-shotting (building too much, running out of context mid-feature, leaving a half-built undocumented feature); premature completion (a later agent saw progress and declared the project done); premature sign-off (features marked complete without end-to-end testing); setup overhead after a session ended in a broken state — same source.
- Fixes: "work on only one feature at a time" ("turned out to be critical"); end each session with "a git commit and progress update"; leave code "appropriate for merging to a main branch"; test "as a human user would" with the Puppeteer MCP, because without that prompt Claude relied on unit tests or curl and missed end-to-end failures; known limit: browser-native alert modals are invisible through Puppeteer MCP — same source.
- Scale: over 200 features for a claude.ai clone; model Opus 4.5; no token counts given — same source.
- Published Mar 24, 2026 (Prithvi Rajasekaran, Anthropic Labs): two recurring failures, "context anxiety" (models "begin wrapping up work prematurely as they approach what they believe is their context limit") and self-evaluation ("agents reliably skew positive when grading their own work"); remedy: "tuning a standalone evaluator to be skeptical turns out to be far more tractable" — [Anthropic, Harness design for long-running application development](https://www.anthropic.com/engineering/harness-design-long-running-apps) (B).
- Three roles: planner (expands a 1–4 sentence prompt into a product spec), generator (sprints, one feature at a time, self-evaluates at sprint end, uses git), evaluator (Playwright MCP, tests UI, API and database state); handoff is file-based: "one agent would write a file, another agent would read it and respond either within that file or with a new file"; no file names are given — same source.
- Sprint contract: "The generator proposed what it would build and how success would be verified"; the evaluator reviews; coding starts only after agreement; Sprint 3 of the example had 27 testable criteria; full-stack grading used four criteria (product depth, functionality, visual design, code quality), "Each criterion had a hard threshold, and if any one fell below it, the sprint failed" — same source.
- Cost: Opus 4.5 solo run 20 min / $9 vs harness 6 h / $200 ("over 20x more expensive, but the difference in output quality was immediately apparent"); Opus 4.6 V2 harness total 3 h 50 min / $124.70 (planner $0.46, three build rounds $71.08 / $36.89 / $5.88, three QA rounds $3.24 / $3.09 / $4.06) — same source (B, single run, not a controlled comparison).
- Simplification after Opus 4.6: sprint construct removed, per-sprint evaluation replaced by one evaluator pass at the end, context resets dropped earlier because Opus 4.5 "largely removed that behavior on its own"; kept the planner (without it the generator under-scoped) and the evaluator ("worth the cost when the task sits beyond what the current model does reliably solo"); method: a radical cut failed, then one component removed at a time — same source. Secondary summary: [InfoQ, Apr 2026](https://infoq.com/news/2026/04/anthropic-three-agent-harness-ai/) (C).

### Inferences
- The two articles converge on four durable artifacts regardless of model: a machine-readable feature list with a boolean verified flag, a human-readable progress log, a one-command environment bootstrap, and git as the recovery mechanism. Everything else (sprints, resets, per-sprint evaluation) was model-generation-specific scaffolding.
- "Sprint contract" is the missing piece in North's stack: a pre-implementation agreement between builder and evaluator on how a feature will be verified. North's `proof` field names the test file but is written by the planner alone.
- The "JSON is edited less recklessly than Markdown" claim is the strongest first-party evidence for H5's format component, but it is experiential (B), not measured.

### Gaps
- Neither article gives inter-run variance, number of trials or a baseline with the same budget spent on a solo agent, so the quality claim is qualitative.
- The Mar-2026 article does not publish the contract file format or the evaluator rubric text.

---

## KQ2. Spec-driven development systems: artifact structure, granularity, binding tasks to acceptance criteria, reported failure modes

### Takeaway
All six systems converge on the same chain (principles → requirements → design → task list → implementation) and differ mainly in requirement syntax (EARS in Kiro, `### Requirement` / `#### Scenario` WHEN/THEN in OpenSpec, user stories in Spec Kit) and task binding (Spec Kit `[US1]` labels and `[P]` parallel markers, Kiro dependency waves, Taskmaster `dependencies` + `testStrategy`); the reported failure modes are context exhaustion leading to skipped tasks, spec/code drift after change, and the absence of any evaluation method for specs themselves.

### Cited Findings
**GitHub Spec Kit** (141.6k stars on 2026-10-17; releases section empty on the page):
- Commands `/speckit-constitution`, `/speckit-specify`, `/speckit-plan`, `/speckit-tasks`, `/speckit-implement`, plus `/speckit-converge` ("repeat implement and converge until it reports Converged"); bug extension (`/speckit-bug-assess`, `-fix`, `-test` with verdict `verified` / `partial` / `failed`); idea-assessment extension ending in go / needs-clarification / kill — [github/spec-kit README](https://github.com/github/spec-kit) (B).
- Methodology: "Specifications must be precise, complete, and unambiguous enough to generate working systems"; chain `spec.md → plan.md → tasks.md → code and tests`; `plan.md` supported by `research.md`, `data-model.md`, `contracts/`, `quickstart.md`; `[P]` marks tasks safe to run in parallel; `[NEEDS CLARIFICATION: specific question]` markers stop the LLM from guessing and a checklist item requires none remain; constitution articles include "III. Test-first … NON-NEGOTIABLE", "VII. Simplicity: Maximum 3 projects", "VIII. Anti-abstraction", "IX. Integration-first: Prefer real databases over mocks"; plan templates enforce these through "Phase -1" gates and a "Complexity Tracking" section for justified violations; "Raw AI generation without structure produces chaos" — [spec-kit/spec-driven.md](https://github.com/github/spec-kit/blob/main/spec-driven.md) (B).
- Task line format from the template: `- [ ] [TaskID] [P?] [Story?] Description with file path`; story labels `[US1]`, `[US2]` map to user stories in spec.md; phases: Setup → Foundational (blocking) → one phase per user story in priority order → Polish — [Spec Kit templates (Mintlify mirror)](https://www.mintlify.com/github/spec-kit/advanced/templates) and community skill copies (C; the official `tasks-template.md` was not fetched directly).
- Issue tracker (253 results for drift/context/ignores terms, first page read): `#4940 "[Feature]: Core flow-back step for drift where the code is ahead of the spec"` (closed Oct 13, 2026), `#4944 "Explore opt-in persistence extensions for flow-back, flow-forward, and flow-always ('Living')"` (open), `#4916` per-step reasoning effort and context size, `#4804 "evidence.md convention for speckit.bug.assess (pre-digested inputs such as reduced logs)"` — [spec-kit issues](https://github.com/github/spec-kit/issues?q=is%3Aissue+ignores+OR+%22too+long%22+OR+drift+OR+%22context+window%22+OR+skips) (D, titles only).
- Third-party reports: Spec Kit docs on complex features warn agents "can skip tasks or hallucinate as context fills" and suggest smaller runs or smaller specs — [Wavect production guide](https://wavect.io/blog/github-spec-kit-production-guide.md) (C); Spec Kit does not prescribe what happens to artifacts after requirements change; three models (flow-back, flow-forward, living spec) each with risks — [Verdent guide](https://www.verdent.ai/guides/coding/spec-driven-development) (C); static-spec drift called "a dominant failure mode in practitioner reports from 2025–2026", agents "follow outdated plans without flagging divergence" — [agentpatterns.ai](https://agentpatterns.ai/workflows/spec-driven-development/) (C); the feedback loop from implementation back to the spec is "the step teams most often skip" — [HackerNoon, the seams](https://hackernoon.com/spec-driven-development-has-a-blind-spot-the-seams) (C).

**AWS Kiro**:
- Three files: `requirements.md` ("user stories, acceptance criteria, or bug analysis in structured notation"), `design.md` (architecture, sequence diagrams, data flow, error handling, testing strategy), `tasks.md` ("discrete, trackable tasks"); Requirements-First or Design-First workflow chosen at creation; Quick Spec skips approval gates; "Run all Tasks" builds a dependency graph and groups tasks into waves: "Waves execute sequentially; tasks within a wave execute concurrently"; task statuses shown are in-progress / completed — [kiro.dev/docs/specs](https://kiro.dev/docs/specs/) (B).
- EARS pattern "WHEN [condition/event] THE SYSTEM SHALL [expected behavior]", example "WHEN a user submits a form with invalid data THE SYSTEM SHALL display validation errors next to the relevant fields"; claimed benefits clarity, testability, traceability, completeness; "Analyze Requirements" checks inconsistencies, ambiguities, conflicting constraints and gaps before design — [kiro.dev feature specs](https://kiro.dev/docs/specs/feature-specs/) (B).
- Best practices: bugfix specs state behaviour that must not change as "WHEN [condition] THEN the system SHALL CONTINUE TO [existing behavior]"; keeping specs in sync is manual ("update requirements.md, ask Kiro to update design.md, then choose Sync Files in tasks.md"); prefer multiple feature specs over one spec for the codebase; specs are "designed to be version-controlled" — [kiro.dev best practices](https://kiro.dev/docs/specs/best-practices/) (B).
- Task-to-requirement citation syntax: community skills show tasks numbered `1.1, 1.2, 1.3` with `1.3` depending on `1.1` and `1.2`, and "Validates: Requirement X.Y" lines — [Classmethod on Kiro 0.12](https://dev.classmethod.jp/articles/kiro-ide-012-analyzespec/), [Smithery kiro-specs skill](https://smithery.ai/skills/peterfile/kiro-specs) (C/D); the official pages fetched do not show the `_Requirements: 1.1_` line.

**OpenSpec** (72.2k stars, 127 open issues, Node ≥ 20.19, MIT):
- Per-change folder `openspec/changes/<name>/` with `proposal.md`, `specs/`, `design.md`, `tasks.md`; live specs in `openspec/specs/`; delta files start `## ADDED Requirements`; requirement format `### Requirement: Theme selection` + "The app SHALL …" + `#### Scenario:` with **WHEN** / **THEN** bullets; commands `/opsx:explore`, `/opsx:propose`, `/opsx:apply`, `/opsx:archive` (expanded profile adds `/opsx:verify`, `/opsx:ff`, `/opsx:continue`); archive moves the change to a dated folder and "Specs updated"; positioning: "fluid not rigid … built for brownfield not just greenfield"; Spec Kit called "Thorough but heavyweight … Rigid phase gates, lots of Markdown, Python setup" — [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec) (B).

**BMAD-METHOD** (54.2k stars; stable v6.12 "frozen aside from bug fixes"; V7 preview alpha, ETA Oct 16, 2026):
- Rationale: coding assistants "often turn unstated assumptions into code"; BMAD keeps "product and technical decisions" available so they need not be re-explained per chat; artifacts named only generically as "briefs, specifications, and architecture" — [bmad-code-org/BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) (B). The README fetched does not describe story files or sharding.

**Agent OS** (v3): "Every time you prompt an AI coding agent, you're re-teaching it context that should already be known"; four steps Install → Discover (extract standards) → Inject → Shape (specs in plan mode); outputs are Markdown under `agent-os/` — [buildermethods.com/agent-os](https://buildermethods.com/agent-os) (B; file structure not on the landing page).

**Taskmaster** (28.2k stars): task fields `id`, `title`, `description`, `status` ("pending", "done", "deferred" shown), `dependencies` (prerequisite IDs with ✅/⏱️ rendering), `priority`, `details` ("Implementation instructions"), `testStrategy` ("How to verify success"), `subtasks` (`taskId.subtaskId`); `next` picks pending/in-progress tasks whose dependencies are all satisfied, ranked "by priority level, dependency count, and task ID"; "The more detailed your PRD, the better the generated tasks will be" — [docs.task-master.dev task structure](https://docs.task-master.dev/capabilities/task-structure), [eyaltoledano/claude-task-master](https://github.com/eyaltoledano/claude-task-master) (B).

**Critique of the paradigm**: Thoughtworks (Liu Shangqi, Dec 4, 2025): the radical view (code disposable, spec the only truth) vs the author's view ("specs are merely elements that drive code generation, as it does in test-driven development"); "Spec drift and hallucination are inherently difficult to avoid"; generation "isn't deterministic"; "over-formalized specs can cause unnecessary trouble"; "there's not yet a systematic way to evaluate specs as we do with evals"; "We still need highly deterministic CI/CD practices" — [Thoughtworks](https://www.thoughtworks.com/insights/blog/agile-engineering-practices/spec-driven-development-unpacking-2025-new-engineering-practices) (C).

**Academic**: "LLM-Assisted Repository-Level Generation with Structured Spec-Driven Engineering" (Feng, Chen, Meyer, Mussbacher; FSE Companion '26; arXiv 4 May 2026): "output quality significantly declines when scaling to repository-level systems"; "natural language prompts suffer from inherent ambiguity and a lack of verifiability"; proposes SSDE with structured artifacts; pilot on MVC business logic for three systems with five LLMs; the abstract page reports no pass rates — [arXiv 2605.02455](https://arxiv.org/abs/2605.02455) (B/C position paper).

### Inferences
- Granularity: Spec Kit and Kiro bind at the user-story level (a story spans several tasks); Taskmaster and North bind at the task/feature level with an explicit verification field (`testStrategy` / `proof`). The task-level binding is what makes a plan checkable; story-level binding only makes it navigable.
- Only OpenSpec treats the spec as a merge target with deltas (ADDED / MODIFIED / REMOVED), which is the one structural answer to drift; Kiro answers with a manual "Sync Files" button; Spec Kit answers with a 2026 "flow-back" step still being designed (#4940, #4944).
- Every system that reports a failure mode names context exhaustion → skipped tasks, which supports "smallest independently verifiable increment" and a per-task entry point rather than a per-milestone one.
- No system ships an evaluation of its own specs; Kiro's "Analyze Requirements" and Spec Kit's `[NEEDS CLARIFICATION]` are the only pre-implementation linting steps found.

### Gaps
- No controlled comparison of Spec Kit vs Kiro vs OpenSpec on outcome metrics was found; all comparisons are positioning statements or practitioner guides (C).
- Spec Kit issue bodies could not be read (REST search endpoints are blocked in this session), so the "agents ignore the constitution" complaint remains unverified beyond titles.
- Kiro's official `_Requirements:` citation syntax in `tasks.md` is unconfirmed from first-party docs.

---

## KQ3. Big-company design-doc culture and formal notations: which elements are machine-checkable

### Takeaway
Google design docs, Amazon narratives, Uber RFCs, Nygard ADRs, arc42 and C4 are human-review instruments whose checkable content is limited to structure (required sections present, status field, monotonic numbering, length bounds); the notations that produce checkable statements are RFC 2119 keyword use, EARS clause patterns, and Gherkin scenarios bound to step definitions.

### Cited Findings
- Google design doc anatomy: Context and scope; Goals and non-goals; the actual design (system-context diagram, APIs sketched "only for relevant parts", data storage, code "should rarely appear except for novel algorithms", degree of constraint); Alternatives considered ("one of the most important sections"); Cross-cutting concerns (security, privacy, observability; Google requires a dedicated privacy design doc and reviews); length "10-20ish pages" for larger projects, 1–3 pages for a mini design doc; skip the doc when the problem is not ambiguous, when it would be an "implementation manual", or when prototyping is cheaper; lifecycle creation → review → implementation → maintenance; "they cost money, because creation and review take time" — [Malte Ubl, Design Docs at Google](https://www.industrialempathy.com/posts/design-docs-at-google/) (C, first-person account of practice).
- Nygard ADR (2011): title as "short noun phrases"; Context in "value-neutral" language; Decision "in full sentences, with active voice" as "We will …"; Status proposed / accepted / deprecated / superseded ("If a decision is reversed, we will keep the old one around, but mark it as superseded"); Consequences "not just the positive ones"; "numbered sequentially and monotonically. Numbers will not be reused"; "one or two pages long"; stored at `doc/arch/adr-NNN.md`; motivation: "Large documents are never kept up to date. Nobody ever reads large documents, either" — [Cognitect blog](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) (C, origin source); template collection at [adr.github.io](https://adr.github.io/) (C).
- arc42: 12 sections (1 Introduction & Goals, 2 Constraints, 3 Context & Scope, 4 Solution Strategy, 5 Building Block View, 6 Runtime View, 7 Deployment View, 8 Crosscutting Concepts, 9 Architectural Decisions "unless described elsewhere", 10 Quality Requirements as quality tree and scenarios, 11 Risks & Technical Debt, 12 Glossary); tailorable; one-page "arc42 canvas" for light use — [arc42.org/overview](https://arc42.org/overview) (B).
- C4: four zoom levels System Context → Container → Component → Code, "maps of your code"; supplementary system-landscape, dynamic and deployment diagrams — [c4model.com](https://c4model.com/introduction) (B).
- Uber RFCs: used up to ~2019 to spread knowledge and reduce silos while scaling; templates evolved (accessibility added for mobile; service template covered load/performance testing, multi-data-center, metrics and monitoring) — [Pragmatic Engineer, Scaling engineering teams via RFCs](https://blog.pragmaticengineer.com/scaling-engineering-teams-via-writing-things-down-rfcs/) (C). Stripe: described only second-hand as a "write-heavy culture" using internal RFCs — [techinterview.org](https://techinterview.org/stripe-interview/) (D).
- Amazon: six-pager narratives (no slide decks, Bezos S-Team email 2004, rationale that full sentences force clarity) and the PR/FAQ for Working Backwards: a one-page future-dated press release answering who the customer is, what problem is solved, why the solution is remarkable, plus customer and internal FAQs — [Tech Lead Journal #218 (Calbucci)](https://techleadjournal.dev/episodes/218/), [Amazon Chronicles, Dave Limp](https://amazonchronicles.substack.com/p/working-backwards-dave-limp-on-amazons) (C; secondary to the Bryar & Carr book).
- RFC 2119 defines MUST / MUST NOT / REQUIRED / SHALL / SHOULD / MAY as requirement-level keywords for specifications — [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) (B, standard; not re-fetched, stable text).
- EARS (Mavin et al., Rolls-Royce, RE'09 2009): generic form `WHILE <preconditions>, WHEN <trigger>, the <system name> SHALL <system response>`; five patterns: Ubiquitous `THE <system> SHALL <response>`; Event-driven `WHEN <trigger>, the <system> SHALL …`; State-driven `WHILE <state>, the <system> SHALL …`; Optional `WHERE <feature>, the <system> SHALL …`; Unwanted behaviour `IF <trigger>, THEN the <system> SHALL …`; Complex combinations; targets ambiguity, vagueness, incompleteness; adopters Airbus, Bosch, Dyson, Honeywell, Intel, NASA, Rolls-Royce, Siemens; Kiro's native notation since 2025 — [Wikipedia, EARS](https://en.wikipedia.org/wiki/Easy_Approach_to_Requirements_Syntax) (C, encyclopedic summary of a B-grade paper).
- Gherkin: `Given` "describe the initial context", `When` "an event, or an action", `Then` "an expected outcome, or result", "An outcome should be on an observable output"; "Cucumber executes each step in a scenario one at a time … looks for a matching step definition"; "Implementation details should be hidden in the step definitions" — [cucumber.io Gherkin reference](https://cucumber.io/docs/gherkin/reference/) (B).

### Inferences
- Machine-checkable today with a 50-line script: section presence and order (design doc, ADR, arc42), ADR status enum and monotonic numbering, page/line bounds, RFC 2119 keyword presence per requirement, EARS pattern conformance per acceptance criterion (regex on `WHEN|WHILE|IF|WHERE … SHALL`), one `SHALL` per requirement, Gherkin parse validity and the existence of a step definition per step. Not machine-checkable: whether alternatives were honestly considered, whether consequences are complete, whether the goal is right.
- For an agent team, EARS is the better acceptance-criterion syntax than Gherkin at the spec level (one line, one observable response, no step-definition code to maintain), while Gherkin-shaped `steps` arrays (as in Anthropic's feature list) are the right form for the evaluator's walkthrough.
- The Google "degree of constraint" and "alternatives considered" sections map directly to North's decision cards: a design doc for a founder is a decision card with context, 2–3 options, recommended option and safe default; the 10–20-page form does not fit a 3-card-a-day attention budget and should be collapsed to the 1–3-page "mini design doc".

### Gaps
- No source quantifies defect reduction from EARS or Gherkin on LLM-generated code; the 2009 EARS paper's internal results were not retrieved.
- Stripe's actual RFC template was not found in any first-party source.

---

## KQ4. Vercel's AGENTS.md-vs-skills eval, counter-evidence, and vendor guidance on CLAUDE.md / AGENTS.md / rules (H9)

### Takeaway
Vercel's eval (Jan 2026) found a compressed AGENTS.md docs index reached 100% versus 53% baseline and 53% for a default skill (never invoked in 56% of cases), but the ETH Zurich study (CTXbench, 138 tasks, 4 agent/model pairs) found context files raise cost by over 20% with no significant success gain, and LLM-generated files slightly hurt; both agree that agents follow explicit instructions reliably and that generic overviews are noise, so H9 survives only in the narrow form "always-on, short, non-inferable instructions beat optional skills for knowledge the model lacks".

### Cited Findings
- Vercel (Jude Gao, Jan 27, 2026): evals on Next.js 16 APIs outside training data (`connection()`, `'use cache'`, `cacheLife()`/`cacheTag()`, `forbidden()`/`unauthorized()`, `proxy.ts`, async `cookies()`/`headers()`, `after()`); four conditions; pass rates Baseline 53% (Build 84 / Lint 95 / Test 63), Skill default 53% (+0 pp), Skill with explicit invocation instruction 79% (+26 pp), AGENTS.md index 100% (+47 pp); "In 56% of eval cases, the skill was never invoked"; "Without those instructions, skills performed no better than having no documentation at all"; "You MUST invoke the skill" wording made agents anchor on docs and miss project context; the index was compressed from ~40 KB to ~8 KB "with no loss in pass rate"; explanation offered as a "working theory" (no decision point, always in the system prompt, no sequencing); caveats: may close as tool use improves, skills still right for "vertical, user-triggered workflows", not tested on other frameworks; task count and model names not stated — [Vercel blog](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) (A-/B: measured, but single framework, retries unspecified, n unstated).
- ETH Zurich (Gloaguen, Mündler, Müller, Raychev, Vechev; arXiv v1 12 Feb 2026, v3 29 Sep 2026): CTXbench 138 Python instances from 12 repos with developer-committed context files, plus SWE-bench Lite 300 tasks; agents Claude Code + Sonnet 4.5, Codex + GPT-5.2 and GPT-5.1 mini, Qwen Code + Qwen3-30B-coder; LLM-generated context files changed success −0.5% (SWE-bench) and −2% (CTXbench), not significant; developer-written files +2.4% on CTXbench (p = 21%, not significant); developer-written beat LLM-generated (p = 3.8%); cost +20% / +23% (LLM-generated) and up to +19% (developer-written); "context files are not effective at providing a repository overview"; instructions are followed: a tool named in the file was used 1.6× per instance vs <0.01× when not mentioned; agents run more tests, explore more, use more reasoning tokens (+22% for GPT-5.2); recommendation: files "should only contain specific additional instructions beyond what is already available in the codebase" and be evaluated before adoption — [arXiv 2602.11988](https://arxiv.org/abs/2602.11988), [HTML](https://arxiv.org/html/2602.11988) (A).
- Third-party replication of Vercel reported vanilla skills at 0% invocation and argued single-shot evals penalize skills because real sessions accumulate context — [mcp.directory summary](https://mcp.directory/blog/claude-md-vs-agents-md-vs-skills-2026) (D, secondary).
- Claude Code memory docs: CLAUDE.md and auto memory are "context, not enforced configuration. To block an action regardless of what Claude decides, use a PreToolUse hook instead"; "target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence"; imports "don't reduce its context cost, because imported files also load at launch"; auto memory loads "first 200 lines or 25KB"; conflicting instructions: "Claude may pick one arbitrarily"; keep CLAUDE.md to "build commands, conventions, project layout, 'always do X' rules"; multi-step procedures or part-of-codebase knowledge go to a skill or a path-scoped rule in `.claude/rules/` (YAML `paths:` frontmatter, loaded when a matching file is read/edited); subdirectory CLAUDE.md files load on demand when a file there is touched; `/init` generates a starter, `/doctor` proposes cuts — [code.claude.com memory](https://code.claude.com/docs/en/memory) (B).
- Claude Code best practices: "Bloated CLAUDE.md files cause Claude to ignore your actual instructions!"; "If Claude keeps doing something you don't want despite having a rule against it, the file is probably too long and the rule is getting lost"; include table (bash commands Claude can't guess, style rules that differ from defaults, test runners, repo etiquette, project-specific architectural decisions, env quirks, gotchas) vs exclude (anything derivable from code, standard conventions, API docs, frequently changing info, tutorials, file-by-file descriptions); emphasis "IMPORTANT" on one line only; "Unlike CLAUDE.md instructions which are advisory, hooks are deterministic"; "The over-specified CLAUDE.md … Claude ignores half of it"; spec advice: "The most useful specs are self-contained: they name the files and interfaces involved, state what is out of scope, and end with an end-to-end verification step"; start "a fresh session to execute it"; verification: "/goal" evaluator, Stop hook as "deterministic gate", "verification subagent" so "the agent doing the work isn't the one grading it"; "Have Claude show evidence rather than asserting success" — [code.claude.com best practices](https://code.claude.com/docs/en/best-practices) (B).
- AGENTS.md: "A simple, open format for guiding coding agents", "just standard Markdown. Use any headings you like"; "used by over 60k open-source projects"; readers include Codex, Jules, Aider, Cursor, Windsurf, Copilot, VS Code; stewarded by the Agentic AI Foundation under the Linux Foundation; nearest file in the tree wins; explicit chat prompts override everything — [agents.md](https://agents.md/) (B).
- Codex: global `~/.codex/AGENTS.md` then project root → cwd chain, one file per directory, concatenated root-down ("Files closer to your current directory override earlier guidance because they appear later in the combined prompt"); stops adding once combined size reaches `project_doc_max_bytes` default 32 KiB; `AGENTS.override.md`; "Keep rules concise" — [Codex AGENTS.md guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md) (B).
- Cursor: rule types Always / Apply to Specific Files (globs) / Apply Intelligently (description) / Manual; `.cursor/rules/*.mdc` with `description`, `globs`, `alwaysApply`; "Keep rules under 500 lines", "Split large rules into multiple, composable rules", "Avoid vague guidance. Write rules like clear internal docs"; AGENTS.md supported with nested precedence — [cursor.com rules](https://cursor.com/docs/context/rules) (B).
- GitHub analysis of 2,500+ agents.md files (Matt Nigh, Nov 19, 2025): "Most agent files fail because they're too vague"; six core areas commands, testing, project structure, code style, git workflow, boundaries; "Include flags and options, not just tool names"; "One real code snippet showing your style beats three paragraphs describing it"; boundaries in three tiers always / ask first / never; "Never commit secrets" the most common helpful constraint; no sampling or scoring method described; no length guidance — [GitHub Blog](https://github.blog/ai-and-ml/github-copilot/how-to-write-a-great-agents-md-lessons-from-over-2500-repositories/) (C, descriptive, method unstated).

### Inferences
- The two measured studies are not in conflict once the content variable is separated: Vercel injected knowledge the model could not have (new APIs) and saw a large gain; ETH injected mostly repository overviews the model could infer and saw cost without gain. The reconciled rule is: always-on files carry only non-inferable instructions and pointers; nothing descriptive.
- Size bounds are now vendor-stated: Claude Code ~200 lines, Codex 32 KiB hard cap, Cursor 500 lines per rule, Vercel's winning index ~8 KB. North's 60-line CLAUDE.md is inside every bound; M7.md at 77 KB would be truncated by Codex if it were an instruction file, which is one more reason to keep plans out of the always-on layer and read per task.
- The "index that points to retrievable files" (Vercel) is the same mechanism as Claude Code's path-scoped rules and on-demand subdirectory CLAUDE.md: always-on index, lazy detail. This is the concrete form H9 should take, not "put everything in CLAUDE.md".
- Skills are appropriate where Vercel and Anthropic agree: user-triggered procedures with side effects (`disable-model-invocation: true`), not knowledge the agent must have every time.

### Gaps
- No study measures adherence as a function of CLAUDE.md length directly; the 200-line / "half of it ignored" claims are vendor experience (B), not published curves.
- Vercel's n, model and retry count are unstated; the ETH study is Python-only and issue-resolution-only, not greenfield builds; neither tested a North-like setup (monorepo, TypeScript, feature-list plan).

---

## KQ5. Traceability: requirement → task → test → evidence in regulated industries, and the lightweight agent-team version

### Takeaway
DO-178C, ISO 26262 and IEC 62304 all require bidirectional traceability (requirement ↔ design/code ↔ test) and use the matrix to find untested requirements and tests without a requirement; the lightweight agent-team version is a single machine-readable table (spec ID, feature ID, test file, evidence path, status) plus a script that fails CI on orphans in either direction and marks downstream rows suspect when the upstream text changes.

### Cited Findings
- DO-178C revision demands bidirectional trace from requirements through design and code to tests and back, partly to stop embedding trace links in operational or test code — [Military & Aerospace, DO-178C core changes](https://www.militaryaerospace.com/commercial-aerospace/article/14224954/do-178c-core-changes) (C); "bidirectional correlation between test results and work items provides the basis of requirements traceability" — [Parasoft DO-178C traceability](https://www.parasoft.com/learning-center/do-178c/requirements-traceability/) (C, vendor).
- NASA Software Engineering Handbook: traceability "can point out software requirements that are not tested (i.e., missing tests) as well as tests that do not serve to test requirements (i.e., extra tests)"; a single matrix shows forward and backward trace; fill it left to right as phases complete; flag orphan elements with no parent requirement; matrices are "the most common" but not the only method — [NASA SWEHB](https://swehb.nasa.gov/x/agH7), [SWEHB requirements](https://swehb.nasa.gov/x/7QL7) (B, agency handbook).
- IEC 62304: forward trace requirements → design → code → tests, backward tests → requirements; "Every requirement must trace to its parent … and to the tests that verify it … Gaps in either direction indicate incomplete coverage and are findings in an audit"; change impact (Clause 8.2) implemented with content hashes that mark downstream links suspect when the upstream item changes; test records (Clause 5.7.5) need test name, software version tested, results — [jamb IEC 62304 traceability](https://jamb.readthedocs.io/en/latest/iec-62304/traceability.html) (C, tool documentation interpreting the standard).
- ISO 26262: requirements management mandatory; matrix links requirements to test cases, static-analysis findings, source files and code reviews — [Parasoft ISO 26262](https://parasoft.com/learning-center/iso-26262/requirements-traceability) (C, vendor).
- North today: `requirement` → `proof` link exists per feature in `M7.features.json`; 69% of test files carry an ID in a test name; commit messages carry IDs; evidence paths (`docs/evidence/M7/...`) are named in `proof` but no script verifies them — local repo (see KQ0).

### Inferences
- The regulated-industry matrix is exactly North's feature list plus two columns (evidence path, verified-at commit) and two scripts: an orphan check (every spec ID in the milestone header has ≥1 feature; every feature's `proof` paths exist and the named tests contain the ID; every test ID resolves to a spec ID) and a suspect check (hash of the requirement row stored on the feature; a changed hash sets `status: suspect` until the test is re-run).
- Content hashing of requirement text is the cheapest answer to DV6 spec drift: the agent cannot silently change a requirement without every dependent feature going amber.
- The 400-line and 50-line rules already in CLAUDE.md are the same kind of deterministic, scriptable gate; traceability should be enforced the same way (a `pnpm validate` step), not by instruction.

### Gaps
- The standards' normative text was not read; all statements are via NASA, tool vendors and tool documentation.
- No published example was found of an LLM-agent project running an orphan/suspect traceability check in CI; this would be a North-first measurement.

---

## KQ6. Plan granularity: task size, dependency graphs, and status vocabularies ("blocked", "needs decision", "verified")

### Takeaway
Evidence converges on tasks sized to one independently verifiable change (one PR, one feature, 1–3 h, a single "done when" check) with explicit dependency graphs executed in waves, and on a status vocabulary that separates agent-reported completion from externally verified completion; no source offers a controlled study of task size against outcome, so the size rules are B/C-grade heuristics backed by the context-exhaustion failure mode.

### Cited Findings
- "work on only one feature at a time" was "critical"; end with commit and progress update; choose "the highest-priority unfinished feature" — [Anthropic Nov 2025](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) (B).
- Generator "works in sprints, one feature at a time"; Sprint 3 contract had 27 testable criteria; sprint construct later removed when Opus 4.6 "plans more carefully, sustains agentic tasks for longer" — [Anthropic Mar 2026](https://www.anthropic.com/engineering/harness-design-long-running-apps) (B).
- Kiro executes all tasks as dependency waves ("Wave 1 contains tasks with no dependencies"; "Tasks with dependencies wait their turn") — [kiro.dev specs](https://kiro.dev/docs/specs/), [best practices](https://kiro.dev/docs/specs/best-practices/) (B).
- Spec Kit `[P]` marks tasks that touch different files and have no dependency on unfinished tasks; phases Setup → Foundational → per-story → Polish — [Spec Kit templates mirror](https://www.mintlify.com/github/spec-kit/advanced/templates) (C).
- Taskmaster `next` = pending/in-progress with all `dependencies` satisfied, ranked by priority, dependency count, id; statuses shown pending / done / deferred — [Taskmaster docs](https://docs.task-master.dev/capabilities/task-structure) (B).
- SPOQ (Carbowitz & Kumar, arXiv 2 Jun 2026): wave-based dispatch from dependency graphs plus dual validation gates; planning coverage 93.0 → 99.75, parallelism 31.0 → 75.25, defects per task 0.34 → 0.20 with dual validation, test pass rate 91.25% → 99.75%, residual defects per task 0.47 → 0.03 with human specialist review; replicated on Qwen3.6-35B-A3B — [arXiv 2606.03115](https://arxiv.org/abs/2606.03115) (A-/B: self-reported benchmarks, metrics defined by the authors' own rubric; the granularity score "share of tasks estimated at 1–4 hours" came from a search snippet and was not visible on the abstract page).
- Practitioner heuristics: "if you would review the change as a single pull request, it is probably a single agent task"; keep together for 1–3 tightly coupled files and <~100K tokens of context, split at 5+ loosely related files or >150K tokens; prompt elements Goal / Context / Constraints / Done when; "If you cannot write a concrete 'done when' clause, the task is too vague to hand to an agent"; four-file handoff (`Prompt.md` frozen spec, `Plan.md` milestones with acceptance criteria, `Implement.md` runbook, `Documentation.md` living status log) — [Codex task decomposition](https://codex.danielvaughan.com/2026/04/28/codex-cli-task-decomposition-right-sizing-agent-work/) (C; thresholds are rules of thumb, no measurements).
- Community Kiro task-generation guidance: every requirement maps to a task, tasks 1–3 h — [Tessl kiro-spec-tasks](https://tessl.io/registry/skills/github/gotalab/cc-sdd/kiro-spec-tasks) (D).
- Claude Code: "If you could describe the diff in one sentence, skip the plan"; planning pays when "the change modifies multiple files" — [best practices](https://code.claude.com/docs/en/best-practices) (B).
- Status vocabularies found: Anthropic `passes` boolean only; Taskmaster pending / in-progress / done / deferred (others such as blocked / review / cancelled appear in community docs but not on the fetched page); Kiro in-progress / completed; Spec Kit bug verdicts `verified` / `partial` / `failed` and assessment outcomes go / needs-clarification / kill; Spec Kit `[NEEDS CLARIFICATION: …]` as an inline blocked-on-human marker; North `AGT-1` task states queued / running / waiting_decision / done / failed (SPEC.md line 98) and the CLAUDE.md rule "A task is `done` only with verified `Evidence`" — sources above and local repo.

### Inferences
- The right unit for North is the feature row: one spec-ID-bound behaviour, one proof, one session, one commit; a feature whose `steps` cannot be walked by the evaluator in one browser session is two features.
- The status model should distinguish four axes that the sources conflate: build state (`todo` / `in_progress` / `built`), verification state (`unverified` / `verified` / `failed`), blocking (`blocked_on: <feature id>` or `needs_decision: <card id>`), and freshness (`suspect` when the requirement hash changed). Anthropic's single `passes` boolean is the floor, not the ceiling; it cannot express "built but the evaluator failed it" or "waiting on the founder", both of which North's loop needs for the 3-card quota.
- `waiting_decision` already exists in North's task model (AGT-1); the plan artifact should carry the same word so the planner, the runtime and the founder-facing UI agree (CONTEXT.md discipline).

### Gaps
- No controlled study varies task size and measures defect or completion rate; SPOQ measures its full method, not granularity alone.
- No source reports how often "blocked" or "needs decision" states occur per feature in practice, which North will need for the decision-quota budget.

---

## KQ7. Hypothesis verdicts (H5, H9) with evidence grades

### Takeaway
H5 is supported in its format and binding components by B-grade first-party accounts and one A-grade orchestration paper, with no direct controlled comparison of machine-checkable vs prose plans; H9 is supported in a narrowed form (always-on, short, non-inferable instructions beat optional skills) by one A-/B-grade eval and contradicted in its broad form (more documentation infrastructure raises accuracy) by an A-grade study.

### Cited Findings
**H5 — a machine-checkable plan (feature list with acceptance criteria, status, dependencies, spec IDs) outperforms prose plans for multi-session execution on DV5/DV6.**
- Supports (B): JSON feature list chosen because the model "is less likely to inappropriately change or overwrite JSON than Markdown"; the plan fixed premature completion and half-built features — [Anthropic Nov 2025](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents).
- Supports (B): pre-agreed testable criteria per sprint with hard thresholds; planner kept because without it the generator under-scoped — [Anthropic Mar 2026](https://www.anthropic.com/engineering/harness-design-long-running-apps).
- Supports (A-/B): dependency-graph planning with validation gates raised test pass rate 91.25% → 99.75% and cut defects per task 0.34 → 0.20 — [SPOQ](https://arxiv.org/abs/2606.03115).
- Supports (B): "The most useful specs are self-contained: they name the files and interfaces involved, state what is out of scope, and end with an end-to-end verification step" — [Claude Code best practices](https://code.claude.com/docs/en/best-practices).
- Supports (C, convergent design): every SDD system binds tasks to requirements and verification (`testStrategy`, `[US1]`, scenario WHEN/THEN, EARS) — KQ2 sources.
- Contradicts / limits (C): "Spec drift and hallucination are inherently difficult to avoid", "over-formalized specs can cause unnecessary trouble", no systematic spec evaluation exists — [Thoughtworks](https://www.thoughtworks.com/insights/blog/agile-engineering-practices/spec-driven-development-unpacking-2025-new-engineering-practices); static specs mislead agents who "follow outdated plans without flagging divergence" — [agentpatterns.ai](https://agentpatterns.ai/workflows/spec-driven-development/).
- No evidence: no controlled A/B of a prose plan vs a structured plan with the same content was found.
- **Verdict: supports, grade B overall** (A-grade only for the orchestration sub-claim). The format alone does nothing for drift; it helps only when a script enforces the links (KQ5).

**H9 — always-on documentation infrastructure (CLAUDE.md / AGENTS.md index, ADRs, spec IDs) raises agent accuracy more than optional skills, which agents often fail to invoke.**
- Supports (A-/B): AGENTS.md index 100% vs skill 53% vs baseline 53%; skill never invoked in 56% of cases — [Vercel](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals).
- Supports (B): skills load "when you invoke them or when Claude determines they're relevant"; CLAUDE.md "loaded every session" — [Claude Code memory](https://code.claude.com/docs/en/memory).
- Contradicts the broad form (A): context files "does not generally improve task success rates" and raise cost "over 20%"; LLM-generated files −0.5% / −2%; overviews useless; developer-written files +2.4% (n.s.) — [ETH Zurich](https://arxiv.org/abs/2602.11988).
- Contradicts the "more is better" reading (B): "Bloated CLAUDE.md files cause Claude to ignore your actual instructions!"; "target under 200 lines" — [Claude Code best practices](https://code.claude.com/docs/en/best-practices), [memory](https://code.claude.com/docs/en/memory).
- Supports the index-plus-lazy-detail form (B/C): Codex 32 KiB cap and root→cwd nesting; Cursor 500-line rules and glob scoping; Claude Code path-scoped rules; Vercel's 40 KB → 8 KB compression at equal pass rate — KQ4 sources.
- No evidence: nothing measures whether ADRs or spec IDs specifically raise agent accuracy; their value is argued (Nygard: rationale prevents blind acceptance or blind reversal) not measured.
- **Verdict: supports in narrowed form, grade B; contradicts in broad form, grade A.** Replace H9 with H9′: "A short always-on index of non-inferable rules and pointers (≤200 lines), with detail loaded by path or on demand, beats both optional skills and long always-on documentation; deterministic hooks beat both for anything that must never be violated."

### Inferences
- The protocol's IV6 level "docs index (AGENTS.md / CLAUDE.md) vs skills" is a false dichotomy; the measured winner is a three-layer stack: deterministic gates (hooks, CI scripts) > short always-on index > lazy detail (rules by path, specs by task) > skills for user-triggered procedures.
- H5 and H9′ are the same claim at two levels: the plan must be a data file a script can check, and the instruction file must be an index a model can hold.

### Gaps
- Both hypotheses lack a North-specific measurement; the M8 build could run the ETH-style comparison cheaply (same feature, CLAUDE.md present vs absent, cost and first-pass acceptance).

---

## KQ8. Synthesis for the debate round: artifact set, feature-list schema, PRD/design-doc template, open questions

### Takeaway
The recommended infrastructure is nine small artifacts, each under its own size bound, with one JSON feature list as the executable centre and one CI script that makes the links between spec IDs, features, tests and evidence fail loudly.

### (1) Recommended artifact set

| # | Artifact | Purpose (one paragraph) | Size bound | Owner | Checkable by script |
| --- | --- | --- | --- | --- | --- |
| 1 | `CLAUDE.md` (or `AGENTS.md`, one imports the other) | The always-on index: non-negotiables as numbered rules, commands with flags, pointers to 2–9, nothing derivable from code. Per [Claude Code memory](https://code.claude.com/docs/en/memory), [Vercel](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals) and [ETH](https://arxiv.org/abs/2602.11988): instructions and pointers, no overview. | ≤200 lines, ≤8 KB | architect | line count; every pointer path exists |
| 2 | `.claude/rules/<area>.md` with `paths:` | Lazy detail per package (db conventions, UI patterns, test runner quirks) that loads only when a matching file is touched — [memory docs](https://code.claude.com/docs/en/memory). | ≤150 lines each | package owner persona | frontmatter parses; globs match ≥1 file |
| 3 | `CONTEXT.md` glossary | One name per concept across spec, DB, code and UI; the drift detector for vocabulary. | ≤150 lines | architect | every code name appears in `packages/core` types |
| 4 | `docs/SPEC.md` requirements | Numbered requirements with one EARS-form acceptance criterion each and an RFC 2119 keyword; English, since code and tests are English. | one row per ID; ≤40 words per criterion | planner + founder (via decision cards) | ID regex; EARS regex; one SHALL per row |
| 5 | `docs/design/<slice>.md` mini design doc | 1–3 pages per vertical slice: context, goals/non-goals, system-context (C4 level 1–2), data, degree of constraint, alternatives, cross-cutting (security, privacy, cost) — [Ubl](https://www.industrialempathy.com/posts/design-docs-at-google/). Written only where the problem is ambiguous. | ≤3 pages / ≤250 lines | architect | required headings present |
| 6 | `docs/adr/NNNN-*.md` | One hard-to-reverse decision each, Nygard sections, status enum, monotonic numbering, supersede-never-edit — [Nygard](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions). | 1–2 pages | architect | numbering monotonic; status ∈ enum; superseded ADR names successor |
| 7 | `docs/plans/<M>.features.json` | The executable plan: one row per independently verifiable behaviour, bound to a spec ID, with steps the evaluator walks, dependencies, status axes and evidence. Schema in (2). | ≤60 features per milestone; a feature's `steps` ≤10 | planner writes; builder sets `build`; evaluator sets `verification` | JSON schema; orphan check; proof paths exist; hash freshness |
| 8 | `docs/plans/<M>.tasks/<feature-id>.md` | Per-feature task card (the former per-task section of `M<n>.md`): files, interfaces produced/consumed, failing-test-first steps, commit message. Read per session, never whole-milestone. | ≤120 lines each | planner | file exists for every feature; ≤400-line rule holds |
| 9 | `docs/plans/<M>.progress.md` + `docs/evidence/<M>/` | Newest-first log of verified facts per session, and the evidence files (test output, run URLs, screenshots, HTTP transcripts) that `verification` points at — [Anthropic Nov 2025](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents). | one entry per session; evidence files immutable | every agent that acts | each `verified` feature has ≥1 evidence path that exists |
| 10 | `scripts/trace-check.ts` (run in `pnpm validate`) | The traceability gate: forward and backward orphan detection, proof existence, test-name ID presence, requirement-hash freshness, status-transition legality — NASA SWEHB / IEC 62304 pattern (KQ5). | — | qa-validator | it is the check |
| 11 | `init.sh` / `pnpm dev` + a 30-second smoke | One-command environment bootstrap and a basic end-to-end check run before new work — [Anthropic Nov 2025](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents). | — | backend | exit code |

Explicitly not recommended: a monolithic `M<n>.md` above 400 lines (split into 7 + 8); LLM-generated repository overviews in any always-on file (ETH); skills for knowledge the builder must have every session (Vercel); Markdown as the status store (Anthropic's JSON rationale).

### (2) Feature-list JSON schema proposal with field-level rationale

```jsonc
{
  "$schema": "https://north.dev/schemas/feature-list.v1.json",
  "milestone": "M8",
  "spec": "docs/SPEC.md",                 // the requirements file whose IDs this plan closes
  "closes": ["AGT-2", "DEC-1"],           // spec IDs the milestone claims; trace-check demands >=1 feature per ID
  "rules": [                              // kept in the data file so a fresh session sees them without CLAUDE.md
    "Only the evaluator sets verification=verified, from evidence files that exist.",
    "Tests and steps are never edited to pass; add a new feature instead."
  ],
  "features": [
    {
      "id": "M8-F3",                       // stable, never reused (ADR numbering rule)
      "requirement": "AGT-2",             // exactly one spec ID; many features per ID is fine
      "requirement_hash": "sha256:9f1c…",  // hash of the SPEC.md row text; mismatch -> freshness=suspect (IEC 62304 change impact)
      "statement": "WHEN a task has no Evidence row, the runtime SHALL refuse to mark it done",
                                           // EARS, one SHALL; readable by founder and regex
      "category": "functional",            // functional | security | compliance | ops | ux (Anthropic field, enum added)
      "slice": "task-lifecycle",           // vertical slice name; groups features for walkthroughs (H3 linkage)
      "steps": [                           // the evaluator's walkthrough, Gherkin-shaped, observable outcomes only
        "Given a task in state running with zero evidence rows",
        "When the builder calls completeTask(taskId)",
        "Then the call returns {kind:'refused', reason:'no_evidence'} and the row state is unchanged"
      ],
      "proof": {
        "tests": ["packages/core/test/task.complete.test.ts"],   // files must exist and contain the ID in a test name
        "evidence": ["docs/evidence/M8/F3/"],                     // directory the evaluator fills; immutable once verified
        "kind": "unit+integration"                               // unit | integration | e2e-preview | live-acceptance (verification tier)
      },
      "depends_on": ["M8-F1"],             // feature IDs; the dispatcher only offers features whose deps are verified (Taskmaster/Kiro waves)
      "parallel_safe": true,               // Spec Kit [P]: touches files disjoint from other unbuilt features
      "status": {
        "build": "built",                  // todo | in_progress | built  (builder-owned)
        "verification": "failed",          // unverified | verified | failed  (evaluator-owned; the only field that counts as done)
        "blocked_on": null,                // feature id | decision card id | null
        "freshness": "current"             // current | suspect  (set by trace-check from requirement_hash)
      },
      "verified_at": null,                 // { "commit": "abc123", "run": "https://…", "cost_usd": 0.42, "evaluator": "north-qa-validator" }
      "attempts": 1,                       // increments per build session; AGT-3 caps at 2 before escalation
      "owner": "north-backend",            // persona file in .claude/agents
      "task_card": "docs/plans/M8.tasks/M8-F3.md",  // the per-feature prose, read only when building this row
      "decision_cards": []                 // card IDs raised while building; links founder attention (DV4) to features
    }
  ]
}
```

Field-level rationale, each tied to a source or a failure mode:
- `id`, `requirement`, `requirement_hash`: the two-way trace plus change impact (NASA SWEHB, IEC 62304 Clause 8.2 pattern); the hash turns DV6 drift into a visible state instead of a silent one.
- `statement` in EARS with one SHALL: Kiro's and Mavin's testability claim; the founder can read it; a regex can lint it.
- `category`, `steps`, boolean-free status: from Anthropic's `feature_list.json`, with `passes` split into `build` and `verification` because Anthropic's own Mar-2026 finding is that self-grading "skews positive"; only the evaluator writes `verification`.
- `steps` Gherkin-shaped with observable `Then`: cucumber.io's "An outcome should be on an observable output"; the evaluator's Playwright walk is the step definition.
- `proof.tests` containing the ID in a test name: already North practice (69% coverage), made mandatory and scriptable.
- `proof.kind`: lets the trace-check demand a minimum tier per category (security and compliance features need integration or e2e-preview, never unit-only), the lightweight form of DO-178C's level-dependent objectives.
- `depends_on`, `parallel_safe`: Kiro waves, Spec Kit `[P]`, Taskmaster `next`; gives the dispatcher one feature per session with satisfied dependencies.
- `blocked_on` pointing at a decision card: binds the plan to North's quota (DEC-3) so the planner can see how many features one card unblocks and rank cards by it.
- `attempts`: implements AGT-3 (two attempts, then escalate) in the artifact rather than in memory.
- `task_card`: moves the 77 KB plan out of the per-session read path; the session reads one ≤120-line card.
- `verified_at.cost_usd`: feeds DV2 directly from the artifact.
- JSON rather than Markdown: Anthropic's stated reason (agents overwrite Markdown more readily); schema validation with Zod at the boundary is the repo rule anyway.

### (3) PRD / design-doc template outline, with machine-checkable sections marked

Mini design doc per vertical slice (≤3 pages), modelled on Ubl's anatomy with EARS/RFC 2119 added; "MC" = a script can check it, "HR" = human/evaluator review only.

1. **Header** — slice name, status (draft / reviewed / superseded), owner persona, date, linked spec IDs, linked ADRs. **MC**: status enum, IDs resolve.
2. **Context and scope** — the founder's thesis sentence, the complexity class from intake (landing page / CRUD / multi-tenant real-time), what exists already. **HR**.
3. **Goals and non-goals** — bullets; each goal names the spec ID it serves. **MC**: every goal has an ID; non-goals section non-empty.
4. **Requirements touched** — table of ID → EARS statement → verification tier. **MC**: EARS regex, one SHALL, tier ∈ enum, each ID appears in the feature list.
5. **The design** — overview paragraph; C4 level-1 system-context diagram (Mermaid or Structurizr DSL text); C4 level-2 containers only if more than one deployable; APIs sketched for changed surfaces only; data storage (tables, append-only flags, RLS). **MC**: diagram source parses; every table named exists in a migration or is listed under "new"; append-only tables appear in the non-negotiables check. **HR**: the design itself.
6. **Degree of constraint** — greenfield vs bounded by existing packages; the invariants that bind (gate(), Evidence, quota, sandbox). **MC**: the seven CLAUDE.md non-negotiables are each addressed by a sentence or "n/a".
7. **Alternatives considered** — at least one, with the reason rejected; if the choice is hard to reverse, "ADR NNNN" is cited. **MC**: section non-empty; ADR link resolves. **HR**: honesty of the comparison.
8. **Cross-cutting concerns** — security (threat list), privacy (what personal data, retention), cost (Claude dollars per run and per month against the $100 cap), observability (what the evaluator will look at). **MC**: cost figures present and under cap; each row non-empty.
9. **Verification plan** — the end-to-end walkthrough the evaluator will run on a deployed preview, written as `steps` in Gherkin form, and the real-data rule (no mocks past unit tier). **MC**: steps parse; every feature in the slice has `proof.kind` ≥ the tier named here.
10. **Decision cards expected** — the forks where the founder must choose, with options, recommended option and safe default, ranked by how many features each unblocks. **MC**: count ≤ the daily quota headroom; each card lists ≤3 options and a default.
11. **Open questions** — `[NEEDS CLARIFICATION: …]` markers (Spec Kit). **MC**: zero markers before status may become "reviewed".

What stays prose and why: 2, 5 (design), 7 (judgement) are where the Google doc's value lives ("early identification of design issues when … still cheap"); a script can only confirm they exist.

### (4) Hypothesis verdicts (summary table)

| Hypothesis | Verdict | Grade | Decisive evidence |
| --- | --- | --- | --- |
| H5 machine-checkable plan > prose plan for multi-session execution | Supports, with the condition that links are script-enforced | B (A for the orchestration sub-claim) | Anthropic Nov 2025 JSON rationale and failure list; Anthropic Mar 2026 sprint contracts; SPOQ 91.25% → 99.75% pass; Claude Code "self-contained spec … end-to-end verification step" |
| H9 always-on docs infrastructure > optional skills | Supports in narrowed form H9′ (short, non-inferable, indexed, lazily detailed); contradicts broad form | B for H9′; A against the broad form | Vercel 100% vs 53% / 56% non-invocation; ETH +20% cost, no success gain, overviews useless; Claude Code ≤200 lines, bloat causes ignored rules |

### (5) Open questions for the debate round

1. Does the evaluator-owned `verification` field survive the solo-founder cost constraint ($8 per founder journey)? Anthropic's QA rounds cost $3–4 each at Opus pricing; three per milestone fits, but per-feature evaluation may not. What is the cheapest tier that still blocks false dones?
2. Is EARS readable enough for a non-technical founder, or does the decision card need a plain-language rendering generated from the EARS row? Who checks that the two agree?
3. `requirement_hash` makes a changed requirement visible; who is allowed to change SPEC.md at all once a milestone is in flight: the planner (via a card), the founder (directly), neither?
4. The ETH result says LLM-generated context files hurt. North's planner is an LLM. Should every always-on artifact (CLAUDE.md, rules, glossary) be founder- or architect-approved before it loads, and how is that gated without burning a decision card?
5. The Mar-2026 Anthropic post removed scaffolding when the model improved. Which of the eleven artifacts above are model-generation-specific (candidates: one-feature-per-session, task cards) and which are invariant (spec IDs, evidence, trace-check)? Who re-tests at each model release, and against what metric?
6. Spec Kit's community is still designing "flow-back" for code-ahead-of-spec drift (#4940, #4944). OpenSpec's delta files are the only shipped answer. Should North adopt ADDED / MODIFIED / REMOVED requirement deltas per milestone instead of editing SPEC.md in place, so the spec itself becomes append-only like `actions`?
7. The protocol's IV8 levels are "none; ADRs plus spec IDs plus traceability; full design-doc culture". The evidence suggests the middle level plus a 1–3-page slice design doc only where ambiguity exists. Is "ambiguity" decidable at intake (H12's complexity class), or does it need a planner judgement that itself must be reviewed?
8. 69% of North's tests already carry an ID. Is the right CI rule "every test file names an ID" (strict, may produce fake IDs) or "every ID in `closes` has a passing test" (looser, but is what the trace matrix actually needs)?
