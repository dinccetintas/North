# RQ1: Requirements elicitation from a non-technical founder

Round-1 evidence note. Persona: Requirements engineer. Date: 2026-10-17.
Scope: which questions an AI engineering team should ask a founder who brings a product
idea, in what order, how many, when to stop, how answers map to architecture, and how
to classify the idea's complexity class at intake. Evidence grades follow the protocol:
A controlled study or production data; B vendor documentation or first-party account;
C practitioner essay or talk; D anecdote or forum. Unverifiable claims are marked.

Not duplicated here: the business-validation journey (problem interviews, demand tests,
Mom Test) is covered in `docs/research/startup-playbook-and-journey.md`. This note starts
where that one ends: the founder has an idea they want built.

## KQ1. What do requirements-engineering authorities say about elicitation, and which questions matter most?

### Takeaway

The authorities converge on three ordered moves: (1) fix the problem, customer and
appetite before any solution talk (Shape Up, Working Backwards, Cagan, Wiegers);
(2) express scope as a thin end-to-end slice with prioritised user goals (Cockburn,
Patton, Spec Kit's P1/P2 stories); (3) de-risk by walking a concrete use case "in slow
motion" and declaring out-of-bounds (Shape Up, Adzic). None of them prescribes a fixed
question count; all of them prescribe question *kinds* and an order.

### Cited Findings

- Shape Up: before discussing solutions, set the **appetite**, a time budget rather than
  an estimate: "small batch" is one designer plus one or two programmers for one or two
  weeks; "big batch" is the same team for six weeks. "Estimates start with a design and
  end with a number. Appetites start with a number and end with a design." Fixed time,
  variable scope. (grade C, primary) — [Shape Up ch. 3](https://basecamp.com/shapeup/1.2-chapter-03)
- Shape Up: narrow the problem before shaping. Ask "What's really going wrong?" and
  "At what point specifically does someone's current workflow break down without this
  thing they're asking for?" The chapter warns against grab-bag requests ("redesign the
  Files section") with no clear start, end or problem. — [Shape Up ch. 3](https://basecamp.com/shapeup/1.2-chapter-03)
- Shape Up: shape with breadboards (places, affordances, connection lines) and fat-marker
  sketches; stay "concrete enough to make progress on a specific solution" without
  detail. Shaping output "isn't a spec. It's more like the boundaries and rules of a
  game." — [Shape Up ch. 4](https://basecamp.com/shapeup/1.3-chapter-04)
- Shape Up de-risking questions: "walk through a use case in slow motion" and ask "Does
  this require new technical work we've never done before?", "Are we making assumptions
  about how the parts fit together?", "Are we assuming a design solution exists that we
  couldn't come up with ourselves?", "Is there a hard decision we should settle in
  advance so it doesn't trip up the team?" Then "declare out of bounds" and "cut back".
  "Beware the simple question: 'Is this possible?'"; ask instead "is X possible in
  6-weeks?" — [Shape Up ch. 5](https://basecamp.com/shapeup/1.4-chapter-05)
- Shape Up pitch has five ingredients: problem, appetite, solution, rabbit holes, no-gos
  (secondary summaries agree on the list). (grade C) — [Reflectoring review](https://reflectoring.io/book-review-shape-up/); [Rubick wiki](https://www.rubick.com/wiki/process/shape-up)
- Amazon Working Backwards: the PR/FAQ is written before building; press release "a few
  paragraphs" under a page, FAQ five pages or less; reviewers ask "so what?" and "Why
  will this new product be compelling enough for customers to take action and buy it?"
  The document "helps leaders decide which ideas are worth funding before development
  resources are committed." (grade B, first-party) — [About Amazon](https://www.aboutamazon.com/news/workplace/an-insider-look-at-amazons-culture-and-processes)
- Amazon's own material says the method pairs "five customer questions" with the
  PR/FAQ, but neither Amazon's page nor the secondary guides I reached list all five
  verbatim; one summary gives the first as "Who is the customer?" **The full list is
  unverified in this note.** — [AWS Working Backwards](https://amer.resources.awscloud.com/vidyard-all-players-2/working-backwards); [Nidhi Wadmark summary](https://nidhiwadmark.substack.com/p/working-backwards)
- A PR/FAQ guide (secondary) splits FAQs into external ("How much does it cost?", "How
  is it different from alternatives?", "How do I get started?") and internal ("How big is
  the opportunity?", "What is the unit economics?", "What are the biggest risks?"). (grade C) — [koji.so guide](https://www.koji.so/docs/working-backwards-pr-faq-guide)
- Cagan's four big risks: value ("whether customers will buy it or users will choose to
  use it"), usability ("whether users can figure out how to use it"), feasibility
  ("whether our engineers can build what we need with the time, skills and technology we
  have"), business viability ("whether this solution also works for the various aspects
  of our business"). Strong teams "Tackle the big risks early – especially value risk and
  business risk." (grade C, primary) — [SVPG](https://svpg.com/four-big-risks/)
- Cockburn goal levels: summary (kite/cloud) goals span hours to weeks and "even large
  systems only have about five use cases at this level"; user goals at "sea level" pass
  the test "Can the primary actor go away happily after the use case finished?";
  subfunctions sit "under water". Stakeholders include people who never act in a scenario. (grade C, secondary teaching material citing Cockburn) — [Otago course notes](https://cs.otago.ac.nz/coursework/cosc461/usecases.htm); [Cockburn paper](https://atlas-project-tdaq-awg.web.cern.ch/Documents/StructuringUseCasesWithGoals.pdf)
- Patton's story map: activities left to right form the backbone; the walking skeleton
  is "the smallest possible system you could build that would give you end to end
  functionality. It is built by taking the highest-priority task from each backbone
  activity" (credited to Cockburn). Releases are horizontal slices spanning the whole
  x-axis. (grade C, secondary) — [koji.so story mapping](https://www.koji.so/docs/user-story-mapping)
- Wiegers: "business requirements should come from the person who is ultimately
  accountable for the business value expected from the product"; understand business
  objectives and user goals first, then choose features (usage-centric, not
  product-centric). Cosmic Truth #8: even the best requirements document "cannot, and
  should not, replace human dialogue." (grade C) — [Goodreads quotes](https://www.goodreads.com/work/quotes/339685); [ADT Magazine 2004](https://adtmag.com/articles/2004/11/10/requirements-guru-shares-cosmic-truths.aspx)
- Wiegers' inception steps (via a course deck citing his ch. 5): gain agreement on the
  problem definition, understand root causes, identify stakeholders. (grade C) — [uOttawa SEG3101](https://www.site.uottawa.ca/~bochmann/SEG3101/Notes/SEG3101-ch2-1%20-%20Inception.pdf)
- ISO/IEC/IEEE 29148: RE processes are stakeholder requirements definition, system
  requirements analysis, software requirements analysis, with StRS / SyRS / SRS outputs;
  stakeholder needs (wants, expectations, perceived constraints) are refined into formal
  stakeholder requirements, traced to business requirements from the start. I could not
  open the standard itself (paywalled, ANSI preview returned 403); the individual
  requirement characteristics (necessary, unambiguous, singular, feasible, verifiable,
  traceable) are **from memory, unverified here**. (grade C, secondary) — [cwnp summary](https://www.cwnp.com/req-eng); [SEBoK](https://sebokwiki.org/draft/Special:Random/Absorption_(glossary))
- Gause & Weinberg's "context-free questions" are the part of *Exploring Requirements*
  reviewers single out ("apply to many situations"), covering functions, attributes,
  constraints and preferences; **the question wording could not be retrieved from any
  open source and is unverified.** — [Bill Wake review](https://xp123.com/?p=439)
- Adzic, *Specification by Example*: "Deriving scope from goals" is the first key process
  pattern after "Initiating the changes", before "Specifying collaboratively"; the method
  specifies requirements and tests as realistic examples. Chapter content not reachable
  online. (grade C) — [Manning / Simon & Schuster listing](https://www.simonandschuster.co.uk/books/Specification-by-Example/Gojko-Adzic/9781638351368)

### Inferences

- Every authority puts **problem + customer + appetite** before solution. For North the
  first questions must be about who, what breaks today, and how big a bet, not about
  features or stack.
- Shape Up's four rabbit-hole questions are the closest thing in the literature to
  "decision-oriented" questions: each one, if answered yes, changes the plan (spike,
  decide early, or cut). They can be asked by the agent of itself after reading the
  founder's answers, and only surfaced to the founder when a hard decision remains.
- Cockburn's "about five summary-level use cases" and Patton's walking skeleton give a
  natural cap on scope questions: identify the backbone (3-7 activities), pick the
  highest-priority task in each, and that is the first vertical slice (ties to H3).
- Wiegers' "human dialogue" truth argues against a pure fixed questionnaire (IV1 level 2)
  and for a bounded interview that can follow up.

### Gaps

- Exact text of Gause & Weinberg's context-free questions, Amazon's five customer
  questions, Wiegers' interview question lists and ISO 29148 clauses: all behind books or
  paywalls; only secondary descriptions were reachable.

## KQ2. Question budgets: how many questions before disengagement; decision-oriented vs information-gathering questions; LLM clarification research

### Takeaway

Shipping tools cap clarification at 3-5 questions (Spec Kit: 3 markers in /specify,
5 questions in /clarify), survey data shows attrition rises sharply past roughly 15 items
or 6-8 minutes, and the LLM literature shows (a) models default to guessing (60%+ of
ambiguous coding tasks answered without a question), (b) asking raises pass rates by
roughly 7-10 points, and (c) the right trigger is a cost-benefit (value of information)
rule, not a fixed count or confidence threshold. No study measures founder disengagement
per clarifying question directly.

### Cited Findings

- Spec Kit `/speckit.specify`: "LIMIT: Maximum 3 [NEEDS CLARIFICATION] markers total";
  mark only when the choice "meaningfully affects scope or user experience", when
  "several reasonable readings lead to different outcomes", or when "no sensible default
  exists". Priority order for markers: scope, then security/privacy, then user
  experience, then technical details. Explicitly **do not ask** about data retention,
  performance targets, error handling or auth method; default to "Standard session-based
  or OAuth2 for web apps" and record each default in an Assumptions section. If markers
  remain, up to three questions are shown as option tables. (grade B) — [specify.md](https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/specify.md)
- Spec Kit `/speckit.clarify`: "Maximum of 5 total questions across the whole session";
  scans ten categories (functional scope, domain/data model, interaction/UX, NFRs,
  integrations, edge cases, constraints/tradeoffs, terminology, completion signals,
  placeholders), marks each Clear/Partial/Missing, picks the top five by an
  "(Impact * Uncertainty) heuristic", excludes implementation and tech-stack questions,
  offers 2-5 options with a "Recommended" option first or a <=5-word short answer with a
  "Suggested" value, stops when "done"/"good"/"no more" or at five, and reports
  Resolved / Deferred / Clear / Outstanding per category. (grade B) — [clarify.md](https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/clarify.md)
- Spec Kit spec template: stories are "PRIORITIZED as user journeys ordered by
  importance" (P1, P2, ...), each with "Why this priority", Given/When/Then acceptance
  scenarios and an "Independent Test" so that "implementing just one still yields a
  viable MVP". Assumptions section is required. (grade B) — [spec-template.md](https://raw.githubusercontent.com/github/spec-kit/main/templates/spec-template.md)
- Survey attrition (vendor data, grade A-/B): SurveyMonkey (100k surveys, 2009-10) found
  drop-off "not linear", steepest in the first 15 questions; a secondary summary reports
  completion ~89% at 10 questions, 87% at 20, 85% at 30, 79% at 40. SurveyRock reports
  completion falling from 98% to 77% past 15 questions and 67% of abandonment in the
  first half. SMG (time-based) found abandonment steepest after 8 minutes on PC and 6 on
  mobile, 14% vs 6% abandonment on mobile vs PC for 10+ minute surveys. — [SurveyMonkey](https://www.surveymonkey.com/curiosity/survey_questions_and_completion_rates/); [SurveyRock](https://www.surveyrock.com/blog/survey-completion-rate-benchmarks); [SMG PDF](https://smg.com/wp-content/uploads/2021/08/increasing_response_rates_by_managing_survey_length.pdf)
- HumanEvalComm (TOSEM, Jan 2025): with inconsistent, ambiguous or incomplete problem
  descriptions, "more than 60% of responses from Code LLMs still generate code rather than
  ask questions"; Pass@1 drops 35-52%. Communication rates: ChatGPT 14.21%, CodeLlama
  10.16%, CodeQwen1.5 4.82%, DeepSeek Coder 30.76%. The Okanagan agent raised
  communication rate to 72.73% (ChatGPT base) and Pass@1 on modified problems from 27.45%
  to 39.62%, but the paper's abstract and introduction report inconsistent deltas (58%/38%
  vs 59%/5%). (grade A) — [arXiv 2406.00215](https://arxiv.org/html/2406.00215v3)
- ClarifyGPT (FSE 2024): detect ambiguity via a code-consistency check, then ask
  targeted questions; GPT-4 Pass@1 on MBPP-sanitized 70.96% -> 80.80%; average across
  five benchmarks 62.43% -> 69.60% (GPT-4) and 54.32% -> 62.37% (ChatGPT). Human eval
  with ten participants plus a simulated-user method. Uses 4 LLM calls. (grade A) — [arXiv 2310.10996](https://arxiv.org/abs/2310.10996)
- ClarifyCoder (2025): fine-tuned DeepSeek Coder raised communication rate 24.12% ->
  63.61% and good-question rate 21.29% -> 51.93% while HumanEval Pass@1 stayed ~73-75%;
  contrasts Okanagan, which "tends to still ask questions that appear to be unnecessary"
  with Pass@1 on standard tasks falling 65% -> 27%. Notes ClarifyGPT, TICODER and
  ClariGen "require a user or simulated-user interaction step, even for tasks that are
  already clear." (grade A) — [arXiv 2504.16331](https://arxiv.org/html/2504.16331v2)
- Ask or Assume? (EMNLP 2026): on an underspecified SWE-bench Verified variant, a
  multi-agent scaffold that "decouples underspecification detection from code execution"
  reaches 69.40% resolve rate, closes most of the gap to fully specified instructions,
  and "asks fewer questions on simple tasks and more on complex issues". (grade A) — [arXiv 2603.26233](https://arxiv.org/abs/2603.26233)
- Learning to Ask / Ask-when-Needed (EMNLP 2025): with imperfect instructions "LLMs tend
  to arbitrarily generate the missed argument"; Noisy ToolBench; AwN asks only when
  blocked and outperforms tool-learning baselines on accuracy and efficiency. (grade A) — [arXiv 2409.00557](https://arxiv.org/abs/2409.00557)
- Value of Information framework (Jan 2026): decide to ask when expected utility gain
  exceeds the user's cognitive cost; confidence thresholds are "brittle" and "require
  task-specific tuning" and ignore differing stakes; VoI matched or beat tuned baselines
  across four domains, up to +1.36 utility in high-cost settings. (grade A) — [arXiv 2601.06407](https://arxiv.org/abs/2601.06407)
- Curiosity by Design (Jul 2025): a query classifier flags unclear coding requests, a
  fine-tuned model writes the question; users preferred its questions over zero-shot
  baseline. (grade A) — [arXiv 2507.21285](https://arxiv.org/abs/2507.21285)
- Claude Code docs: auto mode "nudges Claude to keep working without stopping for
  clarifying questions, though Claude still asks when your prompt or a skill explicitly
  relies on it"; scheduled tasks "can't ask clarifying questions", so prompts must state
  success criteria and what to do with results. (grade B) — [permission modes](https://code.claude.com/docs/en/permission-modes); [common workflows](https://code.claude.com/docs/en/common-workflows)
- Lovable (Dec 2025): "Most AI mistakes happen because the AI doesn't fully understand
  what you want to build"; vague prompts -> wrong assumptions -> apps that "miss the
  mark and waste credits"; questions cover "target audience, specific features, design
  preferences, or technical requirements"; no count given. (grade B) — [Lovable blog](https://lovable.dev/blog/chat-mode-and-questions)

### Inferences

- Two independent product teams (GitHub Spec Kit, Kiro) and the Claude Code best-practice
  prompt all land on **3-5 questions per round**, well below the survey knee at ~15; a
  founder intake of 5-7 decision questions plus 1-2 optional follow-ups is inside every
  observed budget.
- The research supports **decision-oriented triggers**: Spec Kit's marker rules
  ("meaningfully affects scope", "different outcomes", "no sensible default") and the
  VoI framework are the same idea. A question earns its slot only if two plausible answers
  lead to two different plans and no safe default exists.
- Over-asking has a measured cost (Okanagan's Pass@1 collapse on clear tasks, Spec Kit's
  explicit "do not ask" list), so the stop rule must be symmetric: stop when remaining
  gaps have safe defaults, not only when the quota is spent.
- No source measures *founder* attrition per clarifying question; survey data is the
  nearest proxy and it is about anonymous respondents, not motivated founders. Treat the
  3-5 cap as a convention supported by proxy evidence, not a measured optimum.

### Gaps

- No study of clarification budgets for non-technical users of app builders (Lovable,
  Bolt, Replit) with retention or acceptance outcomes.
- The "decision-oriented vs information-gathering" distinction has no controlled study;
  it is inferred from tool design (Spec Kit) and decision theory (VoI).

## KQ3. How do Claude Code, Kiro, Spec Kit, OpenSpec, BMAD, Lovable, Cursor and Devin ask questions?

### Takeaway

Every current tool separates a read-only planning phase from building, and most ask
questions in that phase; they differ in whether questions are capped (Spec Kit 3/5),
up-front (Kiro Quick Spec, Lovable Chat Mode, Claude Code "interview me"), gated by
approval between artifacts (Kiro Feature Spec, Claude Code plan approval), or
free-form (Cursor, OpenSpec explore). Only Spec Kit publishes its selection heuristic.

### Cited Findings

- Claude Code plan mode: "Claude reads files, runs shell commands to explore, and
  writes a plan, but does not edit your source"; approve with options or "No, keep
  planning"; `Ctrl+G` opens the plan for direct editing; `/plan` prefixes a single
  prompt; `defaultMode: plan` in `.claude/settings.json`. (grade B) — [permission modes](https://code.claude.com/docs/en/permission-modes)
- Claude Code best practices: "for larger features have Claude interview you and write a
  spec before you start implementing"; recommended prompt: "Interview me in detail using
  the AskUserQuestion tool. Ask about technical implementation, UI/UX, edge cases,
  concerns, and tradeoffs. Don't ask obvious questions, dig into the hard parts I might
  not have considered. Keep interviewing until we've covered everything, then write a
  complete spec to SPEC.md." Then "start a fresh session to execute it." Also: "If you
  could describe the diff in one sentence, skip the plan." (grade B) — [best practices](https://code.claude.com/docs/en/best-practices)
- Claude Agent SDK: AskUserQuestion fires the `canUseTool` callback with questions as
  multiple-choice options (text, choices, multi-select flag); the host app renders the
  UI; the tool must be in the `tools` list or Claude cannot ask. A GitHub issue reports a
  60-second timeout and a conflict about availability inside subagents (**unverified**). (grade B / D) — [SDK approvals](https://code.claude.com/docs/en/agent-sdk/approvals); [issue 20275](https://github.com/anthropics/claude-code/issues/20275)
- Kiro: specs are `requirements.md` (user stories + EARS acceptance criteria),
  `design.md` (architecture, sequence diagrams), `tasks.md`; EARS template "WHEN
  [condition/event] THE SYSTEM SHALL [expected behavior]"; Feature Specs have approval
  gates between phases and a Markdown Review where you comment on passages; Quick Spec
  asks clarifying questions "up front" covering "scope, constraints, edge cases, and
  anything else that affects the output", then generates all three files with "no
  approval gates between phases"; recommended for "well-understood features" and rapid
  prototyping, while Feature Specs suit "unfamiliar territory" and compliance-sensitive
  work. Kiro also asks whether you are building a Feature or fixing a Bug. (grade B) — [Kiro specs](https://kiro.dev/docs/specs/); [feature specs](https://kiro.dev/docs/specs/feature-specs/); [quick spec](https://kiro.dev/docs/specs/quick-spec/)
- Spec Kit: `/speckit.specify` (3 markers max, defaults + Assumptions), `/speckit.clarify`
  (5 questions max, Impact x Uncertainty), then plan, tasks, implement; README now lists
  hyphenated skill names and a `/speckit-converge` loop, calling clarification,
  checklists and consistency analysis optional "quality gates". (grade B) — [README](https://github.com/github/spec-kit/blob/main/README.md); [clarify.md](https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/clarify.md)
- OpenSpec: `/opsx:explore` is "a no-stakes thinking partner that reads your code, weighs
  options, and shapes a plan before any code gets written"; `/opsx:propose` creates
  proposal.md, specs/ (requirements with SHALL + WHEN/THEN scenarios), design.md,
  tasks.md; "update any artifact anytime, no rigid phase gates"; no published
  clarification cap or heuristic. (grade B) — [OpenSpec README](https://github.com/Fission-AI/OpenSpec/blob/main/README.md)
- BMAD (v6.12 stable, v7 alpha): "sizes itself to the work. Small changes go straight to
  build. Complex work gets the depth it needs"; a "Choose a Planning Path" guide; loop of
  Clarify -> Plan -> Build and verify -> Learn. Third-party sources describe levels 0-4
  (0: atomic change; 1: small feature, ~2-10 stories; 2: medium, PRD; 3-4: complex /
  enterprise with architecture phase, 12-40+ stories); **level boundaries are from
  secondary sources, unverified against the official repo.** (grade B / D) — [BMAD README](https://github.com/bmad-code-org/BMAD-METHOD/blob/main/README.md); [mintlify concepts mirror](https://www.mintlify.com/bmad-code-org/BMAD-METHOD/concepts)
- Cursor Plan Mode (Oct 7 2025): when asked to plan, Cursor "researches your codebase to
  find relevant files, review docs, and ask clarifying questions", then writes a Markdown
  plan with file paths you can edit; "We've seen this significantly improve the code
  generated" (no data). Forum reports plan mode sometimes reads a follow-up answer as a
  cue to start building. (grade B; forum D) — [Cursor blog](https://cursor.com/blog/plan-mode); [forum](https://forum.cursor.com/t/plan-mode-how-to-prevent-cursor-from-switching-to-agent-mode-automatically/151214)
- Lovable: Plan mode "never modifies your code", one credit per message, produces an
  editable plan; Chat Mode (off by default) lets projects start by talking before any
  code; a questions tool asks "when Lovable needs clarification". (grade B) — [Lovable plan mode docs](https://docs.lovable.dev/features/plan-mode); [Lovable blog](https://lovable.dev/blog/chat-mode-and-questions)
- Devin: official docs describe an Ask mode for "planning tasks, and generating
  high-context sessions" and a first-run choice between Ask and Agent mode; a search
  snippet of an "Interactive Planning" page says Devin "analyzes the codebase and
  surfaces relevant files, key findings, and implementation questions" and proposes an
  editable plan, but the page itself returned a tutorial index when fetched. The
  `/megaplan` command (asks about deployment, integrations, stack, exclusions) appears
  only in third-party posts: **unverified.** (grade B / D) — [Devin docs index](https://docs.devin.ai/llms.txt); [Devin interactive planning (snippet)](https://docs.devin.ai/work-with-devin/interactive-planning); [LevelUp article](https://levelup.gitconnected.com/ai-coding-tip-038-make-the-ai-ask-before-it-builds-bda219b21a4f)

### Inferences

- The industry consensus for an agent harness is: **separate plan from build, make the
  plan an editable artifact, and ask in the plan phase.** North already has planner /
  builder / evaluator; intake belongs to the planner, before any builder run.
- Spec Kit's design is the most reusable: per-category coverage map, Impact x Uncertainty
  ranking, recommended option first, "do not ask" list with recorded defaults. Kiro's
  Quick Spec vs Feature Spec split shows one vendor already keying process depth on
  familiarity and risk (supports H12 weakly).
- Cursor's forum issue (answers read as "go") is a concrete failure mode: intake must be
  a distinct state in North's state machine, not a chat convention.

### Gaps

- No vendor publishes acceptance or rework data tied to its clarification feature;
  Cursor's claim is unquantified.
- Devin's planning docs could not be fetched in full.

## KQ4. How should complexity class be detected at intake, and which questions change with class? (H12)

### Takeaway

Only BMAD (levels 0-4) and Kiro (Quick vs Feature Spec) key process depth on complexity,
and both do so by story count or familiarity rather than by architectural properties. No
source offers a validated classifier for product archetypes; the evidence for H12 is
therefore indirect (tools do scale process; multi-tenancy is widely reported as hard to
retrofit) and a classifier must be designed, then measured, by North.

### Cited Findings

- BMAD "automatically adjusts planning depth based on project complexity, with
  lightweight flows for small changes and full architecture for larger systems" (official
  concepts page mirror); levels and story-count bands from secondary sources, tech-spec
  for L0-1, PRD for L2, architecture phase for L3-4. (grade B / D) — [BMAD concepts](https://www.mintlify.com/bmad-code-org/BMAD-METHOD/concepts); [vibeindex router](https://www.vibeindex.ai/skills/bacoco/bmad-skills/main-workflow-router)
- Kiro: Quick Spec for well-understood features and prototypes; Feature Spec with gates
  for unfamiliar, iterative, compliance-sensitive or high-stakes work. (grade B) — [Kiro quick spec](https://kiro.dev/docs/specs/quick-spec/)
- Claude Code: "Planning is most useful when you're uncertain about the approach, when
  the change modifies multiple files, or when you're unfamiliar with the code"; small
  clear changes should skip planning. (grade B) — [best practices](https://code.claude.com/docs/en/best-practices)
- Spec Kit `/clarify` excludes tech-stack questions and treats auth method, retention,
  performance as defaultable; `/specify` priority is scope > security/privacy > UX >
  technical. (grade B) — [specify.md](https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/specify.md)
- Multi-tenancy: practitioner and vendor guides agree tenancy decisions (data isolation,
  migration strategy, backup granularity, per-tenant encryption) "must be made before the
  first migration runs"; retrofitting multi-tenancy into a single-tenant app is "a
  frequent mistake"; tenant context should be in request tokens from the outset; the
  "3x-5x retrofit cost" figure is a single vendor's self-report (**unverified**). (grade C / D) — [WorkOS](https://workos.com/blog/developers-guide-saas-multi-tenant-architecture); [AWS ISV building blocks](https://aws.amazon.com/isv/resources/building-blocks-of-multi-tenant/)
- General web-app taxonomies (static, dynamic, SPA/MPA, PWA, enterprise) exist in
  hosting-vendor content but none define SaaS multi-tenancy, marketplace or real-time as
  distinct archetypes with architectural consequences. (grade D) — [Hostinger](https://www.hostinger.com/au/tutorials/types-of-web-applications/); [Edana](https://edana.ch/en/2026/04/07/web-app-development-what-types-of-web-applications-can-you-build/)
- Cagan: feasibility risk is the engineer's, value and viability the PM's; tackle value
  and business risk first. (grade C) — [SVPG](https://svpg.com/four-big-risks/)

### Inferences

- Complexity class is best derived from a small set of **binary architectural
  properties** (who logs in; more than one organisation shares the system; money moves;
  two user populations transact; state must update live between users; regulated data;
  external systems of record; AI inference in the critical path) rather than from a
  free-text label. The properties are exactly the questions Spec Kit tells you *not* to
  default (scope, security/privacy) plus the ones practitioners say cannot be retrofitted.
- BMAD's story-count levels are an output of planning, not an intake signal; North needs
  a classifier that runs *before* planning and selects the planning depth (H12's claim).
- Class changes the question set: a landing page needs appetite and a single call to
  action; a CRUD SaaS adds auth and tenancy; a marketplace adds payments, two roles and
  trust; real-time adds consistency and presence; regulated adds residency and audit.

### Gaps

- No published, validated classifier of product archetypes with measured downstream
  effects on plan quality or acceptance. H12 must be tested in North's own data.

## KQ5. Which questions have the highest architectural leverage, and which can be deferred with safe defaults?

### Takeaway

High leverage: who the users are and how they log in, whether multiple organisations
share the system (tenancy), whether money moves and who is paid, whether two populations
transact (marketplace), whether state must be live between users, which external systems
are the source of truth, and whether data is regulated. Safe-default candidates, per Spec
Kit and the practitioners: auth mechanism, retention, performance targets, error handling,
styling, hosting region when not regulated, analytics.

### Cited Findings

- Spec Kit: default rather than ask for data retention, performance targets, error
  handling, authentication method ("Standard session-based or OAuth2 for web apps"),
  record in Assumptions; marker priority scope > security/privacy > UX > technical. (grade B) — [specify.md](https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/specify.md)
- Spec Kit `/clarify` requires each question to "affect architecture, data modeling, task
  decomposition, test design, UX, operations, or compliance". (grade B) — [clarify.md](https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/clarify.md)
- Shape Up: settle "a hard decision ... in advance so it doesn't trip up the team";
  flag "new technical work we've never done before"; declare no-gos. (grade C) — [Shape Up ch. 5](https://basecamp.com/shapeup/1.4-chapter-05)
- Tenancy and tenant identity must be decided before the first migration; isolation
  model (shared schema / schema-per-tenant / database-per-tenant; pool / bridge / silo)
  depends on compliance. (grade C) — [WorkOS](https://workos.com/blog/developers-guide-saas-multi-tenant-architecture); [AWS ISV](https://aws.amazon.com/isv/resources/building-blocks-of-multi-tenant/)
- Cockburn: summary-level use cases number "about five" even for large systems; the
  primary actor and non-acting stakeholders are listed separately. (grade C) — [Otago notes](https://cs.otago.ac.nz/coursework/cosc461/usecases.htm)
- Claude Code interview prompt targets "technical implementation, UI/UX, edge cases,
  concerns, and tradeoffs" and "the hard parts I might not have considered". (grade B) — [best practices](https://code.claude.com/docs/en/best-practices)

### Inferences

- Leverage ranking (highest first), combining the sources: (1) users and roles, (2)
  tenancy, (3) money and payout direction, (4) marketplace / two-sided, (5) real-time
  collaboration, (6) external systems of record and integrations, (7) regulated data /
  residency, (8) offline or mobile-native, (9) scale expectations. Items 1-5 reshape the
  data model; 6-7 reshape boundaries and compliance; 8-9 are usually deferable for a
  first vertical slice.
- Everything Spec Kit defaults is also what a non-technical founder cannot usefully
  answer (auth mechanism, retention, performance). North should never put these on a
  decision card; it should record them as assumptions with a safe default.

### Gaps

- No empirical ranking of which early requirement decisions cause the most rework;
  the ranking above is inferred from tool rules and practitioner consensus.

## KQ6. How should unanswered questions be handled: safe default + assumption, decision card later, or block?

### Takeaway

The tools and the research agree: default and record when a safe default exists, ask
(decision card) when two readings lead to different architectures and no default is
safe, and block only when the answer gates an irreversible or external action. Blocking
is rare and should map onto North's existing authority tiers.

### Cited Findings

- Spec Kit: unspecified details get "reasonable defaults" recorded in Assumptions; only
  scope/UX-changing, divergent-outcome or no-default items become markers; deferred
  high-impact gaps are flagged "with rationale" in the coverage report. (grade B) — [specify.md](https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/specify.md); [clarify.md](https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/clarify.md)
- Spec Kit `/clarify` always offers a "Recommended" option first so "yes" is a valid
  answer; ambiguous replies are disambiguated without consuming quota. (grade B) — [clarify.md](https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/clarify.md)
- VoI: ask when expected utility gain exceeds user cognitive cost; stakes matter, so a
  fixed threshold is wrong. (grade A) — [arXiv 2601.06407](https://arxiv.org/abs/2601.06407)
- Ask-when-Needed: ask only when the missing information blocks the action; otherwise
  models "arbitrarily generate the missed argument", which is the failure to avoid. (grade A) — [arXiv 2409.00557](https://arxiv.org/abs/2409.00557)
- Claude Code: autonomous runs "can't ask clarifying questions", so success criteria and
  result handling must be written into the prompt; auto mode discourages stopping to ask
  except where the prompt relies on it. (grade B) — [common workflows](https://code.claude.com/docs/en/common-workflows); [permission modes](https://code.claude.com/docs/en/permission-modes)
- Shape Up: "declare out of bounds" and "cut back" are the default response to
  unresolved scope; the raw-idea default is "Interesting. Maybe some day." (grade C) — [Shape Up ch. 3](https://basecamp.com/shapeup/1.2-chapter-03); [ch. 5](https://basecamp.com/shapeup/1.4-chapter-05)
- North's own constraints: at most 3 decision cards a day; review queue 5 items / 10
  minutes a day; every review item needs a safe default so work never stalls (prior
  research note). — [startup playbook note](/home/user/North/docs/research/startup-playbook-and-journey.md); [protocol](/home/user/North/docs/research/engineering-layer/01-research-protocol.md)

### Inferences

- A three-way policy: **Default+Assume** (record in an Assumptions table with the chosen
  default and the trigger that would reopen it), **Card** (two plausible answers produce
  different plans; Impact x Uncertainty high; present as options with a recommended
  default and a deadline after which the default applies), **Block** (answer gates an
  external, irreversible or paid action, e.g. real payment provider, sending to real
  users, live keys; this is already an `AuthorityEngine.gate()` tier).
- Because the quota is 3 cards a day, intake cards compete with sales and marketing
  cards; intake should spend at most 1-2 cards and carry everything else as assumptions
  that the evaluator checks during the first walkthrough.

### Gaps

- No evidence on how founders react to "assumed defaults" they later disagree with
  (trust cost of silent assumptions). Should be measured through North's review queue.

## Design proposals for the intake protocol

### 1. Draft ordered question set (decision each answer drives)

Q0 is read, not asked: the agent first restates the idea as a one-paragraph Working
Backwards press release plus a breadboard (places, affordances) and marks each of the
ten Spec Kit categories Clear / Partial / Missing. Only Partial/Missing items with high
Impact x Uncertainty become questions. Max 7 questions in round 1; each is multiple
choice with a recommended default first; "yes" accepts the default.

| # | Question (founder wording) | Decision it drives | Default if unanswered |
| --- | --- | --- | --- |
| 1 | Who uses this, and what breaks for them today without it? | Primary actor, problem statement, P1 user journey (Shape Up "what's really going wrong", Cagan value risk) | Block: no default; without it nothing else is decidable |
| 2 | What is the one thing a first user must be able to do end to end on day one? | Walking skeleton / first vertical slice (Patton, Cockburn sea-level goal); acceptance scenario for T4 | Agent proposes from Q1; card only if two candidates |
| 3 | How big a bet is this: a weekend page to test interest, a few weeks for a working v1, or a real product over months? | Appetite (Shape Up), budget cap, complexity-class prior, verification tier | "A few weeks for a working v1" |
| 4 | Who else is in the picture: just individual users, or companies or teams that each have their own space and data? | Tenancy model; auth and roles; data model root (highest retrofit cost) | Individual users, single tenant; recorded as assumption with reopen trigger "first team signup request" |
| 5 | Does money move? Who pays whom, one-off or subscription, and do you ever pay out to other people? | Payments provider, marketplace vs SaaS, ledger, authority tier for live keys, compliance | No payments in v1; waitlist / manual invoicing; reopen at first paying customer |
| 6 | Are there two different kinds of people who need to find each other (buyers and sellers, hosts and guests)? | Marketplace class: two role models, listing + matching, trust/reviews; doubles the skeleton | Single population |
| 7 | Must several people see each other's changes live, or is page refresh fine? | Real-time class: websockets/presence, conflict handling, verification needs multi-browser evaluator | Refresh is fine |
| 8 | Where does the truth already live (a spreadsheet, Shopify, Stripe, a calendar, an email inbox)? | Integrations and system of record; sandbox vs live; import path | None; manual entry |
| 9 | Does this handle health, financial, children's or EU-resident personal data, or anything a regulator cares about? | Regulated class: residency, audit log, retention, consent; raises verification tier | No; standard privacy defaults |
| 10 | Is there anything this must *not* do or must not include in v1? | No-gos (Shape Up), scope fence for the evaluator | Agent drafts no-gos from Q2-Q3 for confirmation |

Never asked of the founder (recorded as assumptions, per Spec Kit): auth mechanism,
session handling, retention periods, performance targets, error-handling style,
framework and hosting choices, styling system, analytics.

Ordering logic: Q1-Q3 fix problem, slice and appetite (every authority puts these
first); Q4-Q7 are the four class-defining architectural forks ordered by retrofit cost;
Q8-Q9 set boundaries and compliance; Q10 fences scope. Questions 6, 7 and 9 are skipped
when Q3 = "weekend page" (landing-page class) because they do not change the plan.

### 2. Proposed stop rule

Stop asking when **any** of the following holds, checked after every answer:

1. Every category in the coverage map is Clear or has a recorded safe default whose
   reopen trigger is defined (coverage-based stop, Spec Kit).
2. The next candidate question would not change the first vertical slice, the data-model
   root, the payment path or the verification tier (decision-based stop: zero
   architectural leverage means default and move on; VoI gain below cost).
3. Seven questions have been asked in this round, or two decision cards consumed
   (budget stop: inside survey knee, inside the 3-card quota).
4. The founder says done / go / build it (user stop, Spec Kit).

Stop does not mean silence: the planner emits the Assumptions table and the complexity
class, and the evaluator treats every assumption as a check in the first walkthrough.
A second, smaller round (max 3) is allowed only at the first phase gate, triggered by
evidence from the deployed skeleton, not by curiosity.

### 3. Complexity-class classifier sketch

Compute from the answers (and from the restated idea when a question was skipped):

```
auth        = Q1 implies accounts            (bool)
tenancy     = Q4 == teams/companies           (bool)
payments    = Q5 != none                      (bool)
payouts     = Q5 includes paying others       (bool)
two_sided   = Q6 == yes                       (bool)
realtime    = Q7 == live                      (bool)
integrations= count(Q8)                       (0,1,2+)
regulated   = Q9 == yes                       (bool)
ai_core     = idea requires model inference in the user path (from Q0 restatement)
appetite    = Q3 in {weekend, weeks, months}

class =
  "static"        if !auth && !payments && appetite==weekend
  "landing+waitlist" if !auth && (payments ? waitlist-only : true) && appetite<=weeks
  "crud_saas"     if auth && !two_sided && !realtime && !tenancy
  "multi_tenant"  if auth && tenancy && !two_sided
  "marketplace"   if two_sided || payouts
  "realtime"      if realtime            (orthogonal flag, can combine)
  "ai_heavy"      if ai_core             (orthogonal flag)
  "regulated"     if regulated || payouts (orthogonal flag; raises verification tier)
```

The base class selects plan depth (Quick-Spec-style single pass for static /
landing; gated spec for crud_saas and above; architecture decision record required for
multi_tenant / marketplace), team composition and the T4 evaluator tier; the flags add
checklist modules (realtime: multi-browser evaluator; regulated: audit log, residency,
consent; ai_heavy: eval set and cost ceiling). The classifier output is shown to the
founder as one sentence ("This is a two-sided marketplace with payouts; that means ...")
and stored with the spec so later sessions inherit it. Validate by measuring DV1 and DV5
per class once North has data; no external validation exists.

### 4. Hypothesis verdicts

| Hypothesis | Verdict | Grade | Basis |
| --- | --- | --- | --- |
| H4: bounded, decision-oriented questions beat zero questions and open interviews on DV1 per founder-minute | **Supports (partial)** | A for "asking beats not asking" (ClarifyGPT +8-10 pts Pass@1; HumanEvalComm 60%+ silent guessing; Ask-or-Assume closes most of the underspecification gap); A for "trigger must be cost-aware" (VoI; ClarifyCoder vs Okanagan over-asking cost); B for the 3-5 cap (Spec Kit, Kiro, Claude Code interview prompt) with only survey-attrition proxy data for the budget; **no direct study compares bounded vs open-ended interviews on acceptance**, so the "beats open interview" half is inferred | [2310.10996](https://arxiv.org/abs/2310.10996), [2406.00215](https://arxiv.org/html/2406.00215v3), [2603.26233](https://arxiv.org/abs/2603.26233), [2601.06407](https://arxiv.org/abs/2601.06407), [2504.16331](https://arxiv.org/html/2504.16331v2), [clarify.md](https://raw.githubusercontent.com/github/spec-kit/main/templates/commands/clarify.md) |
| H12: complexity class should be classified at intake and select the methodology | **Weak support, no direct evidence** | B that vendors already scale process depth by complexity or familiarity (BMAD levels, Kiro Quick vs Feature Spec, Claude Code "skip the plan for one-sentence diffs"); C that tenancy and payments are hard to retrofit and must be decided early; **D/none** for a validated archetype classifier or measured effect of class-selected methodology on acceptance | [BMAD README](https://github.com/bmad-code-org/BMAD-METHOD/blob/main/README.md), [Kiro quick spec](https://kiro.dev/docs/specs/quick-spec/), [best practices](https://code.claude.com/docs/en/best-practices), [WorkOS](https://workos.com/blog/developers-guide-saas-multi-tenant-architecture) |

Related evidence for other RQs: Spec Kit's P1/P2 stories with "Independent Test" and
Patton's walking skeleton support H3 (vertical slice first); the "write the spec, then
start a fresh session to execute it" guidance supports H6.

### 5. Open questions for the debate round

1. Is 7 questions too many for a non-technical founder on mobile? Survey data says the
   knee is ~15 items or 6-8 minutes, but founders are motivated and the questions are
   consequential. Should the cap be 5 with the rest as "assumptions you can override"?
2. Can the planner reliably skip Q4-Q7 for a landing page without the classifier
   mis-labelling a marketplace described as "a simple page"? Proposal: always ask Q4-Q6
   when Q3 >= weeks; the skeptic should attack the false-negative cost.
3. Spec Kit says never ask about auth method; North's AuthorityEngine and tenancy make
   the *role model* architectural even when the mechanism is not. Where exactly is the
   line between "auth mechanism" (default) and "who can see what" (ask)?
4. Silent assumptions versus trust: a founder who discovers an assumed default at the
   walkthrough may lose trust in the team. Should assumptions be shown as a read-only
   digest item (no quota cost) at intake end?
5. Should intake ever block (Q1 unanswered)? Alternative: the planner drafts Q1 from the
   idea and asks only for confirmation, so no question is ever a hard stop.
6. H12 has no direct evidence. What is the cheapest experiment North can run: tag every
   project with the classifier output and compare DV1/DV5 per class, or A/B class-selected
   vs uniform methodology on the same ideas?
7. Multi-round intake: tools re-plan per feature (Spec Kit per feature, Kiro per spec).
   Should North re-run a 3-question mini-intake at each phase gate, and does that count
   against the daily card quota?
8. Validation gap: the LLM clarification studies use benchmark problems and simulated
   users; none measure a human's willingness to answer or a product's acceptance. The
   debate should decide whether that evidence transfers to founder intake at all.
