# RQ3 — Architecture and design principles: what applies when, and how "vertical slice first" is done correctly

Persona: Principal Architect and Software-Engineering Historian. Date: 2026-10-17.
Evidence grades per protocol §4: **A** controlled study or measured production data; **B** vendor documentation or first-party engineering account; **C** practitioner essay or talk; **D** anecdote or forum report. Items marked **[not fetched this session]** are cited from the author's prior knowledge of a stable primary source and should be spot-checked by the debate round; items marked **[unverifiable]** could not be traced to a primary source at all.

Scope note: this note covers only RQ3 (principles, architecture, build order, methodology selection, LLM-legible code). Verification regimes (RQ5), harness orchestration (RQ4) and team organisation (RQ7) are touched only where a source speaks directly to architecture.

---

## Key question 1 — The canon: what each author actually claims, and when it fails

### Takeaway
The canon is not a single doctrine; its most prominent authors disagree in writing on method size, comments and TDD, and the empirical literature finds only small effects for the practices they argue about. What the canon *does* agree on, across fifty years, is a short list: hide design decisions behind interfaces (Parnas), keep the core free of I/O and UI (Cockburn, Bernhardt), prefer deep modules and simple interfaces (Ousterhout), minimise entanglement of concerns (Hickey), and treat duplication as cheaper than a wrong abstraction (Metz, Abramov). Everything else is contested.

### Cited Findings

**Robert Martin (Clean Code, Clean Architecture) vs John Ousterhout (A Philosophy of Software Design) — the documented disagreement**
- Martin favours very short functions and the "One Thing" rule; he says "if I must err, I'd rather err on the side of decomposition", and that the 2–4 line functions in his example came from Swing's structure, not an arbitrary limit. Ousterhout counters that "the best methods are those that provide a lot of functionality but have a very simple interface" and that too-small methods become "shallow"; he says "entangled methods can usually be improved by combining them". Martin concedes it took him effort to understand his own eight-method `PrimeGenerator` again, but still defends the decomposition. — [Ousterhout & Martin, aposd-vs-clean-code discussion, GitHub](https://github.com/johnousterhout/aposd-vs-clean-code/blob/main/README.md) (grade C, primary record of both authors' positions)
- On comments: Martin says "I look at every comment as potential misinformation" and "I prefer long names to comments"; Ousterhout says "the cost of missing comments is easily 10–100x the cost of incorrect comments" and finds names like `isLeastRelevantMultipleOfLargerPrimeFactor` cryptic. — [same source](https://github.com/johnousterhout/aposd-vs-clean-code/blob/main/README.md) (C)
- On TDD: Ousterhout says TDD has "serious problems without any compensating advantages that I have been able to identify", that its one-test-at-a-time unit of work is too small for design thinking, that it "guarantees initial bad code", and prefers "bundling" (design a few methods or a class, then test). Martin claims TDD yields a comprehensive test suite, less coupled designs because code must be testable, fearless refactoring (his strongest claim) and less debugging. Ousterhout's closing position: best cases are similar for both, but "average and worst cases are much worse for TDD". Both agree unit tests are valuable, over-decomposition is possible, and code and comments should be reviewed by others. — [same source](https://github.com/johnousterhout/aposd-vs-clean-code/blob/main/README.md) (C)
- Ousterhout's book is published through Stanford: [A Philosophy of Software Design](https://web.stanford.edu/~ouster/cgi-bin/book.php) **[not fetched this session]**.

**Performance critique of Clean Code (Muratori, Blow)**
- Casey Muratori's 2023 "'Clean' Code, Horrible Performance" measured a polymorphic shape hierarchy at ~35 cycles/shape versus ~24 cycles/shape for a switch-based version (≈1.5x); secondary write-ups quote 10x after further table-driven optimisation and "15x or more" — the 15x figure could not be verified against Muratori's own material. His thesis: four of five Clean Code rules (polymorphism over switch, don't know internals, small functions, one thing) hurt performance "pervasively" when scaled to real objects. — [The New Stack](https://thenewstack.io/when-clean-code-hampers-application-performance/); [SE Radio 577](https://se-radio.net/2023/08/se-radio-577-casey-muratori-on-clean-code-horrible-performance/) (grade C; the original post is at [computerenhance.com](https://www.computerenhance.com/p/clean-code-horrible-performance) **[not fetched this session]**)
- Critics note a 12-cycle/object difference matters for shaders and physics but not for typical business software. — [Lemmy thread](https://lemmy.brendan.ie/comment/1129332) (grade D)
- Jonathan Blow's critiques of OOP exist as talks and streams; I found no written primary source to cite this session. **[gap]**

**Duplication vs the wrong abstraction (Metz, Abramov)**
- Sandi Metz: a wrong abstraction arises when a shared abstraction is later bent with parameters and conditional branches for requirements that "almost fit"; sunk cost prevents abandoning it. Her rule: "duplication is far cheaper than the wrong abstraction"; remedy: re-inline into every caller, delete unused branches, then re-extract — "the fastest way forward is back". — [sandimetz.com](https://sandimetz.com/blog/2016/1/20/the-wrong-abstraction) (C)
- Dan Abramov's "Goodbye, Clean Code" (2020): a de-duplicating refactor of resize-handle code made later requirement changes harder; the abstraction "would have to become several times more convoluted"; lesson: "learn how and when to let go of the rules". — [overreacted.io](https://overreacted.io/goodbye-clean-code/) (C)

**Hexagonal / Ports and Adapters (Cockburn)**
- Intent: "Allow an application to equally be driven by users, programs, automated test or batch scripts, and to be developed and tested in isolation from its eventual run-time devices and databases." Motivation: "infiltration of business logic into the user interface code" means "the system can't neatly be tested with automated test suites"; the same with database coupling. A port "identifies a purposeful conversation"; an adapter "converts the API definition to the signals needed by that device". — [alistair.cockburn.us](https://alistair.cockburn.us/hexagonal-architecture/) (C, primary)

**Functional core / imperative shell (Bernhardt)**
- The screencast page is JavaScript-rendered and the body did not parse; from the title and catalog it is Gary Bernhardt's 2012 Destroy All Software screencast. The claim as generally reported: isolate decision-making in pure functions (core), push I/O into a thin shell; the core gets many fast unit tests, the shell a few integration tests. — [destroyallsoftware.com](https://www.destroyallsoftware.com/screencasts/catalog/functional-core-imperative-shell) (C; **content not verified this session**; companion talk "Boundaries" at [destroyallsoftware.com/talks/boundaries](https://www.destroyallsoftware.com/talks/boundaries) **[not fetched]**)

**Rich Hickey, "Simple Made Easy" (2011)**
- Simple = one role/task/concept, no interleaving; easy = near at hand/familiar; "Simple != easy". To "complect" is to braid together. Complecting constructs: state, objects, methods, inheritance, ORM, imperative loops, conditionals, switch, vars, actors, syntax. Simpler alternatives: values, functions, namespaces, data, queues, declarative data manipulation, polymorphism à la carte, managed refs, set functions, rules. He calls testing, refactoring and type systems "good but secondary" safety nets that "do not enforce simplicity"; a bug can pass the type checker and every test. — [InfoQ](https://www.infoq.com/presentations/Simple-Made-Easy/) (C)

**Fowler: Monolith First; Strangler Fig**
- "Almost all the successful microservice stories have started with a monolith that got too big and was broken up"; systems built as microservices from scratch have "ended up in serious trouble". Reasons: a "MicroservicePremium" that slows early teams (YAGNI); and "even experienced architects … have great difficulty getting boundaries right at the beginning"; "any refactoring of functionality between services is much harder than it is in a monolith". Caveat: "You cannot assume that you can take an arbitrary system and break it into microservices" — the monolith must be modular from the start; he treats his evidence as limited and the view "by no means unanimous". — [martinfowler.com/bliki/MonolithFirst](https://martinfowler.com/bliki/MonolithFirst.html) (C)
- Strangler Fig Application: incremental replacement of a legacy system by routing calls to new code around the old. — [martinfowler.com/bliki/StranglerFigApplication](https://martinfowler.com/bliki/StranglerFigApplication.html) **[not fetched this session]** (C)

**Vertical slice architecture (Bogard)**
- Layered, onion and clean architectures "suit only a minority of a system's requests"; their dependency rules are rarely useful and their mock-heavy designs over-abstracted (controller → service → repository for everything). A vertical slice is organised around a single request and contains all its concerns front to back; "Minimize coupling between slices, and maximize coupling in a slice". Start with Transaction Script and refactor toward richer domain patterns only when smells appear; new features should mostly *add* code rather than modify shared code. Caveat: this works only if the team recognises smells and can refactor. — [jimmybogard.com](https://www.jimmybogard.com/vertical-slice-architecture/) (C)

**Google: Hyrum's Law**
- "With a sufficient number of users of an API, it does not matter what you promise in the contract: all observable behaviors of your system will be depended on by somebody." The implementation becomes the de facto interface ("bug-for-bug compatibility"). — [hyrumslaw.com](https://www.hyrumslaw.com/) (C, primary)

**Older canon, cited from prior knowledge [not fetched this session]**
- Parnas (1972) "On the Criteria To Be Used in Decomposing Systems into Modules": decompose by design decisions likely to change, not by flowchart steps; information hiding. — [ACM](https://dl.acm.org/doi/10.1145/361598.361623)
- Brooks (1986) "No Silver Bullet": essential vs accidental complexity; no single technique will yield an order-of-magnitude improvement; "grow, don't build" software (incremental development) and "buy vs build". — [PDF mirror](http://worrydream.com/refs/Brooks-NoSilverBullet.pdf). Brooks (1975) *Mythical Man-Month*: conceptual integrity requires one or few minds (architect).
- Gamma et al. (1994) *Design Patterns*: "Program to an interface, not an implementation"; "Favor object composition over class inheritance".
- Hunt & Thomas (1999) *Pragmatic Programmer*: DRY, orthogonality, "Use tracer bullets to find the target" (thin end-to-end code that is kept, vs prototypes that are thrown away). — [pragprog.com tips](https://pragprog.com/tips/)
- Kent Beck: "Make it work, make it right, make it fast". — [c2 wiki](https://wiki.c2.com/?MakeItWorkMakeItRightMakeItFast)
- Evans (2003) *Domain-Driven Design*; Vernon (2013) *Implementing DDD*: bounded contexts, ubiquitous language, aggregates; DDD is explicitly for domains with complex business rules and is costly for simple CRUD. — standard references; no URL fetched.

### Inferences
- The strongest-signal fact about the canon is that its authorities disagree in public on the very rules most often handed to agents (function length, comment density, test-first). An agent team should therefore not encode "Clean Code" as a rulebook; it should encode the intersection (information hiding, I/O at the edges, deep modules, simple interfaces, no premature abstraction) and leave the contested rules to a decision matrix.
- Hickey's "tests and types are secondary safety nets that do not enforce simplicity" and Ousterhout's "TDD guarantees initial bad code" both point the same way: design (module boundaries, data shape) must be decided before code, which for an agent team means in the plan/spec artefact, not discovered test-by-test.
- The Metz/Abramov position is directly relevant to LLMs, which are prone to extracting helpers eagerly; "rule of three before abstracting" is a cheap, teachable rule.

### Gaps
- No primary written source for Jonathan Blow's OOP critique was located; the position exists in talks only.
- Bernhardt's screencast body could not be read; the FC/IS description above is from general knowledge.
- No empirical study was found that tests Ousterhout's "deep modules" claim or Martin's small-function claim against defect data.

---

## Key question 2 — Safety-critical rule sets: what transfers, and which rules are mechanically checkable

### Takeaway
Holzmann's Power of 10 is the single most transferable artefact: it is explicitly designed so that every rule is checkable by a tool, is kept to ten rules because longer standards are ignored, and its rationale ("rules must be specific enough to be checked mechanically") is exactly the property an agent team needs. DO-178C contributes the idea that *assurance level selects the objective count* (a precedent for H12) and bidirectional traceability (requirements → code → tests). MISRA, the JPL C standard, SpaceX and Tesla contribute less that is both public and transferable.

### Cited Findings

**NASA/JPL Power of 10 (Holzmann)** — [spinroot.com P10.pdf](https://spinroot.com/gerard/pdf/P10.pdf) (grade B, primary; originally IEEE Computer, June 2006 **[venue from prior knowledge]**)
- Design premise: most coding guidelines "contain well over a hundred rules, sometimes with questionable justification", "tend to have little effect on what developers actually do", and "rarely allow for comprehensive tool-based compliance checks". "To be effective … the set of rules has to be small … The rules will have to be specific enough that they can be checked mechanically."
- Rule 1: simple control flow — no goto, setjmp/longjmp, no direct or indirect recursion (guarantees an acyclic call graph; bounded execution provable). Rule 2: all loops have a statically provable fixed upper bound. Rule 3: no dynamic memory allocation after initialisation. Rule 4: no function longer than one printed page, "typically … no more than about 60 lines of code per function". Rule 5: at least two side-effect-free assertions per function on average, each with an explicit recovery action; assertions a tool can prove always-true violate the rule. Rule 6: declare data at the smallest possible scope. Rule 7: "The return value of non-void functions must be checked by each calling function, and the validity of parameters must be checked inside each function" — "possibly the most frequently violated rule"; ignoring a return value must be explicit (`(void)` cast) and justified. Rule 8: preprocessor limited to includes and simple macros; conditional compilation flagged and justified ("with just ten conditional compilation directives, there could be up to 2^10 possible versions of the code"). Rule 9: at most one level of pointer dereference; no function pointers. Rule 10: compile from day one with all warnings at the most pedantic setting, zero warnings; run at least one state-of-the-art static analyser daily with zero warnings; if the analyser is confused, rewrite the code to be "more trivially valid".
- Rationale for rule 5 cites industry statistics that "unit tests often find at least one defect per 10 to 100 lines of code written". Status: "being used experimentally at JPL in the writing of mission critical software, with encouraging results"; developers "find that compliance … does tend to benefit code clarity, analyzability, and code safety".
- JPL Institutional Coding Standard for the C Programming Language (2009) extends P10 into ~31 rules at six "levels of compliance" (LOC-1 … LOC-6). **[not fetched this session; URL not confirmed — treat as unverifiable until the debate round locates the PDF]**

**DO-178C (airborne software)** — vendor and consultancy summaries, grade B/C
- Software level (DAL A–E) determines the number of objectives: one compliance guide counts 71 objectives for DAL A; structural coverage objectives A7-5/6/7 require MC/DC, decision and statement coverage respectively at Level A; "for level A software MC/DC is obligatory on top of statement and decision coverage". Traceability is "the foundation": every system requirement traces to high-level requirements, low-level requirements, code and tests, and back. At Level A, if the compiler generates code not traceable to source, additional (object-code) verification is required (§6.4.4.2.b). Coverage analysis is used to reveal dead code and untested code. — [LDRA](https://ldra.com/ldra-blog/do-178c-structural-coverage-analysis/); [Rapita Systems](https://www.rapitasystems.com/node/528); [Modern Requirements guide](https://www.modernrequirements.com/resources/modern-requirements-whitepapers/do-178c-compliance-guide/) (all vendor sources; the standard itself is paywalled by RTCA)
- MISRA C:2012 is a ~143-rule / ~16-directive standard whose rules are classified "decidable/undecidable" for static analysis. **[not fetched this session; misra.org.uk]**

**SpaceX flight software (public fragments only)** — grade C/D
- A Dragon software lead (Gerding) said the C++ code is built to limit the impact of failures and engineers "constantly check error codes and return values", with verification and validation built into development. — [Dice summarising Stack Overflow interview](https://dice.com/career-advice/spacex-software-development-lead-talks-writing-high-flying-code) (C)
- "Table rockets": flight computers wired as on the vehicle run full simulated flights; a flight computer is randomly shut off mid-simulation to test response. — [Acquisition Talk](https://acquisitiontalk.com/2020/12/is-continuous-testing-the-key-to-spacex-software-success/) (D, secondary)
- A SpaceX test-infrastructure job posting describes an in-house framework for production, integration and high-fidelity simulation testing. — [The Muse job post](https://www.themuse.com/jobs/spacex/software-engineer-backend-cc) (B for existence of such a team; nothing about rules)
- Claims that developers write their own tests with no separate QA team come from a recruiting blog. — [Zero G Talent](https://zerogtalent.com/blog/software-engineer-spacex-2026) (D)

**Tesla Autopilot software practices** — I found no first-party public documentation of coding rules or review practice. **[gap]**

**Boeing/Airbus assurance** — DO-178C is the governing standard; no company-specific public rule set beyond it was located. **[gap]**

### Inferences
- Of the P10 rules, the following transfer directly to a TypeScript/Node agent team and are lint-checkable today: function length (ESLint `max-lines-per-function`), file length (`max-lines`), bounded loops (partially: `no-constant-condition`, plus a project rule forbidding `while(true)` outside workers), smallest scope (`no-var`, `prefer-const`, `block-scoped-var`), checked return values (`@typescript-eslint/no-floating-promises`, `no-unused-expressions`), parameter validation at entry (Zod parse at every boundary — checkable by a custom lint rule or an import-boundary rule that forbids raw request/tool data outside `*/adapters`), zero warnings (`--max-warnings 0`, `tsc --strict`), daily static analysis (CI). Rules 3, 8, 9 are C-specific and do not transfer. Rule 5 (assertion density) transfers as "two invariants per function" but is hard to lint meaningfully; a weaker checkable proxy is "every exported function has at least one test".
- DO-178C's level-indexed objective count is the strongest precedent for H12: rigour should scale with consequence class, and the mapping should be a table, not judgement.
- SpaceX's one transferable idea is the randomised fault injection during simulation ("shut off a computer mid-flight"), which maps to chaos-style tests of the kill switch and of integration adapter failures.

### Gaps
- The JPL C standard and MISRA documents were not fetched; rule counts are from memory.
- DO-178C claims come from tool vendors; exact objective numbers should be checked against RTCA text by anyone relying on them.
- Nothing public and specific on Tesla; little on Boeing/Airbus beyond the standard.

---

## Key question 3 — Large-organisation engineering practice: what transfers to an agent team building a stranger's product

### Takeaway
Google, Amazon and Shopify all did the same thing: they turned cultural preferences into mechanically enforced artefacts — test-size rules and flake budgets, a 100-line CL guideline, an ORR checklist generated from incident post-mortems, a static analyser (Packwerk) for module boundaries. That conversion step, not the culture, is what an agent team can import. Anthropic's own Claude Code guidance makes the same distinction explicitly: CLAUDE.md instructions are "advisory", hooks are "deterministic and guarantee the action happens".

### Cited Findings

**Google** — [Software Engineering at Google, ch. 11](https://abseil.io/resources/swe-book/html/ch11.html) (grade B, first-party)
- Test sizes are defined by resource constraints, not line counts: *small* = single process, no sleep, no I/O, no network or disk; *medium* = may use multiple processes, threads, blocking calls, network to `localhost` only; *large* = may span machines, reserved for end-to-end and legacy. Rough mix by count: ~80% unit, ~15% integration, ~5% end-to-end; antipatterns "ice cream cone" (too many e2e) and "hourglass" (too few integration).
- Flakiness: at 10,000 daily tests even 0.1% flake rate ≈ 10 investigations/day; "as flakiness approaches 1%, tests begin to lose value"; Google's rate hovers ~0.15% and is actively fought. Brittle tests "over-specify outcomes"; misused mocks are a major source of brittleness; replace sleeps with polling.
- Beyoncé rule: "test everything that you don't want to break" (including performance, accessibility, security, failure handling). Tests should be "obvious upon inspection"; avoid control flow in tests; a broken test on a requirement change signals outdated "documentation".
- Small CLs: "100 lines is usually a reasonable size for a CL, and 1000 lines is usually too large"; one self-contained change with its tests; small CLs are reviewed faster and more thoroughly, "less likely to introduce bugs", easier to roll back; exceptions for file deletions and trusted automated refactors. — [google.github.io/eng-practices](https://google.github.io/eng-practices/review/developer/small-cls.html) (B)
- Hyrum's Law (above) motivates Google's "test everything observable" stance. — [hyrumslaw.com](https://www.hyrumslaw.com/) (C)
- Readability process (per-language certification of reviewers) is described in SWE-at-Google ch. 3. **[not fetched this session]** — [abseil.io ch03](https://abseil.io/resources/swe-book/html/ch03.html)

**Amazon**
- API mandate: teams must expose data and functionality only through service interfaces; no direct DB reads, shared memory or backdoors; any technology; all interfaces "designed from the ground up to be externalizable". **The text exists only as Steve Yegge's recollection ("back around 2002 I think, plus or minus a year") in a leaked Google-internal post; no Amazon primary document.** — [Kong summary](https://konghq.com/blog/api-mandate); [Yegge rant mirror](https://gist.github.com/kislayverma/d48b84db1ac5d737715e8319bd4dd368) (grade D for exact wording; the practice itself is corroborated by Amazon's later SOA/AWS history)
- Operational Readiness Review: a checklist run "before a workload launches to general availability and then throughout the software development lifecycle", covering architecture, operational process, event management and release quality; the Correction of Errors (COE) post-incident process is "a major driver of these items"; published as a Well-Architected custom lens. — [AWS ORR guide](https://docs.aws.amazon.com/wellarchitected/latest/operational-readiness-reviews/wa-operational-readiness-reviews.html); [OPS07-BP02](https://docs.aws.amazon.com/wellarchitected/2023-04-10/framework/ops_ready_to_support_const_orr.html) (B)
- Prime Video monitoring service (2023): the audio/video quality-monitoring tool, first built as distributed components orchestrated by Step Functions with S3 intermediate storage, hit account limits on state transitions and was rebuilt as a single process on ECS/EC2 with "up to 90%" cost reduction; the team said the distributed approach "did not add much value for this use case". **The primary post now redirects to a marketing page; figures here are from secondary coverage, and the two secondary sources disagree on whether the limit was hit at ~5% or 90% of expected load.** — [DevClass](https://devclass.com/2023/05/05/reduce-costs-by-90-by-moving-from-microservices-to-monolith-amazon-internal-case-study-raises-eyebrows/); [Simform](https://simformnewsletter.substack.com/p/amazon-cuts-90-infra-cost-by-going) (B for the event, D for exact figures)
- Two-pizza teams / single-threaded owners: no first-party source fetched this session. **[not fetched; see RQ7]**

**Shopify (modular monolith)**
- Ruby "doesn't come with a lot of boundary enforcements out of the box, and Rails only provides a very basic layering structure", so Shopify built Packwerk, a static analyser that enforces that packages talk only through public APIs and flags external use of private constants; run in CI so violations are caught before architectural drift; preceded by an in-house call-graph tool (Wedge). — [Shopify Engineering](https://shopify.engineering/enforcing-modularity-rails-apps-packwerk) (B); [InfoQ 2019](https://www.infoq.com/news/2019/07/shopify-modular-monolith) (C); Babbel adopted the same tool — [Babbel](https://www.babbel.com/en/magazine/modularizing-our-rails-monolith-with-packwerk) (B)

**Basecamp, Segment, Meta, Netflix, Stripe** — [not fetched this session]
- DHH, "The Majestic Monolith" (2016): a well-structured monolith is the right default for small teams. — [m.signalvnoise.com](https://m.signalvnoise.com/the-majestic-monolith/) (C)
- Segment, "Goodbye Microservices" (2018): consolidated ~140 services back into one after operational overhead. — [segment.com](https://segment.com/blog/goodbye-microservices/) (B)
- Meta: monorepo, Sapienz automated search-based testing at scale. — [engineering.fb.com](https://engineering.fb.com/2018/05/02/developer-tools/sapienz-intelligent-automated-software-testing-at-scale/) (B)
- Netflix and Stripe: no source fetched; their published material is operational (chaos engineering; API versioning) rather than design-principle guidance. **[gap]**

**Anthropic (Claude Code best practices)** — [code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices) (grade B, first-party)
- "Unlike CLAUDE.md instructions which are advisory, hooks are deterministic and guarantee the action happens." "Bloated CLAUDE.md files cause Claude to ignore your actual instructions!" Include in CLAUDE.md only what Claude cannot infer (commands, non-default style rules, test runners, architectural decisions, gotchas); exclude "self-evident practices like 'write clean code'" and file-by-file descriptions.
- "Claude stops when the work looks done. Without a check it can run, 'looks done' is the only signal available"; the check can be tests, build exit code, linter, a diff-against-fixture script or a browser screenshot; escalation ladder: run in prompt → `/goal` condition re-checked by a separate evaluator → Stop hook as a deterministic gate → "a verification subagent … has a fresh model try to refute the result, so the agent doing the work isn't the one grading it". "Have Claude show evidence rather than asserting success." "If you can't verify it, don't ship it."
- "A fresh context improves code review since Claude won't be biased toward code it just wrote"; Writer/Reviewer pattern across sessions; one Claude writes tests, another writes code to pass them. Specs should "name the files and interfaces involved, state what is out of scope, and end with an end-to-end verification step".
- Reviewer prompted to find gaps "will usually report some, even when the work is sound"; instruct it to flag only correctness/requirement gaps to avoid over-engineering.

### Inferences
- Every transferable large-company practice is already a *checkable artefact*: size thresholds, resource-constrained test tiers, flake budgets, a boundary linter, a launch checklist derived from incidents. The pattern is identical to Holzmann's: culture → small rule set → tool. This is the mechanism behind H11.
- The Prime Video and Segment cases, together with Fowler's observation, converge on modular monolith as the default for new products; the Shopify evidence shows how to keep it modular (CI-enforced package boundaries), which Fowler names as the precondition for a later split.
- Anthropic's "advisory vs deterministic" distinction is the agent-team form of H11: prose rules in CLAUDE.md are the *culture*; hooks, lint, type-check and Stop gates are the *artefacts*.

### Gaps
- No first-party Amazon document for the API mandate or two-pizza teams; the Prime Video primary post is gone.
- Netflix, Stripe, Meta design-principle material was not fetched; their public content is mostly operational.

---

## Key question 4 — Walking skeleton, tracer bullets, steel thread, pipeline-first: correct order of first steps; evidence on layer-first failure (H3)

### Takeaway
The practitioner literature is unanimous and consistent across 25 years (Cockburn, Hunt & Thomas, Freeman & Pryce, Humble & Farley, Bogard): the first deliverable is the thinnest possible end-to-end path through all layers, deployed through a real pipeline and covered by one real end-to-end test, and it is *kept* and grown, not thrown away. Hard empirical evidence that layer-first builds fail at integration is thin: one peer-reviewed case study exists (Mellegård et al. 2018) but its results could not be retrieved; the rest is expert consensus (grade C).

### Cited Findings
- Cockburn's definition (his page now returns 404; quoted via secondary sources): a walking skeleton is "a tiny implementation of the system that performs a small end-to-end function. It need not use the final architecture, but it should link together the main architectural components. The architecture and the functionality can then evolve in parallel." Coined in the 1990s, written up on his site in 2008. — [Dolfing](https://henricodolfing.com/2018/04/start-your-project-with-walking-skeleton.html); [Ben's Guide](https://bensguide.substack.com/p/walking-skeleton); [ACCU 2012 slides](https://accu.org/content/conf2012/Walking_skeleton.pdf) (grade C; **primary page unavailable**)
- Distinction from spike/prototype: spikes are thrown away; the skeleton is meant to evolve. — [Hector Correa](https://hectorcorrea.com/blog/2008-09-16/skeletons-mona-lisa-and-problem-solving) (C)
- Freeman & Pryce, GOOS ch. 4 "First, Test a Walking Skeleton": "the simplest version of your application possible which at the same time crosses all layers end-to-end", e.g. "a simple HTML page which renders some string from the real database"; "This skeleton should be covered with an end-to-end test which should become the first test in your test suite"; the technique "allows you to focus on building a deployment pipeline without paying too much attention to the application's architecture"; setting up deployment early "reveal[s] potential integration issues right away, before you write a substantial amount of code". Two-level cycle: each feature starts with a failing end-to-end test (progress measure, may stay red during development) and is built with unit-level red-green-refactor (regression suite, must stay green). — [Enterprise Craftsmanship summary](https://enterprisecraftsmanship.com/posts/growing-object-oriented-software-guided-by-tests-without-mocks/); [writesoftwarewell summary](https://writesoftwarewell.com/growing-object-oriented-software-guided-by-tests); book: [Pearson](https://www.pearson.com/en-us/subject-catalog/p/growing-object-oriented-software-guided-by-tests/P200000009298/) (C; secondary summaries of a primary text)
- Humble & Farley, *Continuous Delivery* (2010): the deployment pipeline is "an automated process for managing all changes, from check-in to release"; the book's own recommendation to build the pipeline skeleton first could not be confirmed from the publisher pages found. — [Pearson](https://www.pearson.com/en-us/subject-catalog/p/continuous-delivery-reliable-software-releases-through-build-test-and-deployment-automation/P200000009113) (B for the book's existence; **the "pipeline first" wording is not verified this session**)
- Hunt & Thomas, tracer bullets: write thin end-to-end code early that you keep, as opposed to a prototype that you discard. **[not fetched this session]** — [pragprog tips](https://pragprog.com/tips/)
- Bogard (above): slices add code rather than modify shared code; shared cross-slice logic kept to a minimum. — [jimmybogard.com](https://www.jimmybogard.com/vertical-slice-architecture/) (C)
- Fowler (above): boundaries are hard to get right early; refactoring across service boundaries is much harder than within a monolith — an argument for proving the path end-to-end before fixing structure. — [MonolithFirst](https://martinfowler.com/bliki/MonolithFirst.html) (C)
- Big-bang vs incremental integration: an IEEE Software case study (Mellegård, Burden, Levin, Lind, Magazinius, 2018, vol. 37 no. 3, "Contrasting Big Bang With Continuous Integration Through Defect Reports") compared two consecutive projects of a Swedish vehicle manufacturer's advanced-safety software; **the abstract available via OpenAlex states only the premise ("earlier defect detection"); the results were not retrievable**. — [OpenAlex record](https://api.openalex.org/works/doi:10.1109/MS.2018.2880822) (would be grade A if results confirm; currently unverified)
- Teaching material states that big-bang integration "will uncover too many problems at the same time" and makes "locating subtle errors … very difficult", while incremental integration "can significantly reduce error localization and correction time" at some overhead, and that big-bang suits only "simple and small systems with low dependency among components". — [NUS CS2103 handout](https://www.comp.nus.edu.sg/~cs2103/AY1617S4/files/handouts/%5bL7P3%5d%20How%20to%20Avoid%20a%20Big%20Bang%20-%20Integrating%20Software%20Components.pdf) (C, textbook consensus, not data)
- Anthropic's guidance that specs should "end with an end-to-end verification step that proves the feature works" and that without a runnable check "'looks done' is the only signal available" is the agent-era restatement of GOOS's first end-to-end test. — [code.claude.com](https://code.claude.com/docs/en/best-practices) (B)

### Inferences
- The correct first steps, synthesised from the above: (1) choose the one user-visible path that touches every technical layer the product needs (UI → API → DB → external integration); (2) build the deployment pipeline and a deployed preview *before* features; (3) write one real end-to-end test against the deployed preview that becomes the first test; (4) implement the thinnest code that makes it pass, with real adapters (real DB row, real HTTP), not mocks; (5) only then widen — each subsequent feature is itself a slice that starts with a failing e2e test. See the numbered procedure in the synthesis section.
- H3's mechanism is well-argued but weakly measured. The research program should treat H3 as "strong practitioner consensus, one unretrieved industrial case study, no controlled experiment" and test it with North's own DV3/DV5 data rather than assume it proven.
- The protocol's observed failure ("mock tests that never represented real behaviour") is precisely GOOS's reason for making the *first* test end-to-end against real infrastructure: it forces integration risk to the front.

### Gaps
- Cockburn's primary page is offline; his exact wording is quoted from secondary sources.
- The Mellegård 2018 defect-report results (the only peer-reviewed comparison found) were not retrieved. The debate round should obtain the full text.
- No controlled experiment comparing vertical-slice-first with layer-first on integration defects was found.

---

## Key question 5 — Methodology selection by product class (H8, H12, H11): what the empirical literature actually supports

### Takeaway
The empirical literature finds small or null effects for the two most-argued methodology choices: TDD vs iterative test-last (meta-analyses and replications: no reliable quality or productivity gain) and static vs dynamic typing (at most ~15% of public JavaScript bugs detectable by Flow/TypeScript; the large GitHub language-defect study collapsed to "exceedingly small" effects on reproduction). Microservices show real, documented costs for small teams. This supports H8: the invariant core should be *verification and boundary* rules, and paradigm choice should be selected by product properties rather than imposed.

### Cited Findings

**TDD**
- Rafique & Mišić (2013) meta-analysis: TDD improves external quality versus waterfall, but the improvement "is not strong"; in the academic subset where TDD is compared to iterative test-last (ITL), "TDD becomes disadvantageous"; productivity results inconclusive. — summarised in search results; the paper is IEEE TSE 39(6) **[DOI 10.1109/TSE.2012.28 from prior knowledge, not fetched]** (A for the meta-analysis design)
- Fucci, Turhan & Oivo replication: "no evidence to support the claim that external quality and productivity are improved by the adoption of TDD compared to test-last"; process conformance linked to quality but not productivity. — [Brunel repository PDF](https://bura.brunel.ac.uk/bitstream/2438/14828/3/Fulltext.pdf) (A)
- Industrial experiment with 24 professionals (Empirical Software Engineering, 2017): no statistical difference in quality between TDD and test-last; productivity higher under TDD on a simple task and "drops significantly" on a complex brownfield task. — [doi 10.1007/s10664-016-9490-0](https://www.doi.org/10.1007/s10664-016-9490-0) (A)
- Oulu dissertation synthesising a family of experiments: "TDD is not associated with improvements in external quality, or developers' productivity"; gains attributed to skill rather than process; novices may benefit from test-first. — [Oulu repository](https://oulurepo.oulu.fi/handle/10024/34912) (A)
- A study of eight systematic literature reviews found their conclusions on TDD quality and productivity vary. — [Reliability of SLRs on TDD](https://redi.cedia.edu.ec/document/522464) (A-level meta-evidence)
- Ousterhout's practitioner position (above) is consistent with these results; Martin's is not. — [aposd-vs-clean-code](https://github.com/johnousterhout/aposd-vs-clean-code/blob/main/README.md) (C)

**Static typing**
- Gao, Bird & Barr (ICSE 2017), "To Type or Not to Type": adding annotations to ~400 real public JavaScript bugs, Flow 0.30 and TypeScript 2.0 each detect 15%; the authors call this an under-estimate because the bugs had already survived testing and review. Commentators note it does not establish cost-effectiveness versus the same effort on tests. — [IEEE Xplore](https://ieeexplore.ieee.org/document/7985711/authors); [The Morning Paper](https://blog.acolyer.org/2017/09/19/to-type-or-not-to-type-quantifying-detectable-bugs-in-javascript); [Never Work in Theory](https://neverworkintheory.org/2021/09/08/to-type-or-not-to-type.html) (A)
- Ray et al. (FSE 2014; CACM 2017) claimed language/defect associations across 729 GitHub projects; Berger, Hollenbeck, Maj, Vitek & Vitek (TOPLAS 2019) reproduced it and found "only four languages have a statistically significant association with defects, and even for those the effect size is exceedingly small"; Ray et al. rebutted that Berger et al. "largely replicated our results, and agree with us … that the effects … are small"; Berger et al. maintained their critique. — [Berger et al. arXiv 1901.10220](https://arxiv.org/pdf/1901.10220); [Ray et al. rebuttal](https://api.deepai.org/publication/rebuttal-to-berger-et-al-toplas-2019); [Berger et al. counter arXiv 1911.11894](https://ar5iv.arxiv.org/html/1911.11894) (A, contested)

**Microservices vs monolith**
- Survey of 53 practitioners (2024): top migration drivers were easier maintenance/evolution (81.1%), scalability (79.2%), independent deployment (75.4%); testing "is hard to get right", monitoring is essential, database management and data consistency remain difficult; most prefer decentralised databases but consistency is a problem. — [arXiv 2408.10434](https://arxiv.org/abs/2408.10434) (A, survey)
- Earlier empirical work reports difficulty identifying service boundaries, infrastructure cost for deploy/monitor, and need for skilled developers; decomposing the monolith and splitting data are the main technical challenges. — [EMSE 2021](https://people.ece.ubc.ca/mjulia/publications/Microservices_EMSE_2021.pdf) (A); anti-pattern taxonomy from industrial survey — [Taibi et al.](https://trepo.tuni.fi/bitstream/10024/136115/1/Microservices_Anti_Patterns_A_Taxonomy_5.pdf) (A)
- No study quantifying outright microservice *failure rates* was found. **[gap]**
- Fowler, Prime Video, Segment, DHH (above) all point to monolith/modular-monolith first for new products (C/B).

**Rigour scaled by consequence class**
- DO-178C selects objective count and coverage criterion by software level (A–E) (above) — a mature precedent for classifying at intake and selecting method by class. (B/C)

**Agent-era maintainability data**
- GitClear (2026, 623M changes): cross-file function calls (reuse) down 35%, refactoring line-moves down 70%, "long-term maintenance" down 74% vs 2022. — [GitClear](https://www.gitclear.com/the_ai_code_quality_maintainability_gap) (B, vendor data; methodology not independently verified)
- A preprint titled "Is Agent Code Less Maintainable Than Human Code?" exists; not read this session. — [arXiv 2606.21804](https://arxiv.org/pdf/2606.21804) **[not fetched]**

### Inferences
- Because the measured effects of TDD-vs-test-after and typed-vs-dynamic are small, the *choice* matters less than the agent-specific failure mode (false "done" from mock tests). For an LLM builder the relevant question is not "TDD or not" but "is the first test real and end-to-end, and does the final gate run against a deployed preview" — which is RQ5's territory and H2.
- However, both small-effect results still favour explicit types *for agents*: 15% of surviving bugs caught at zero marginal attention is a cheap, deterministic gate, and types are also the mechanism by which an agent discovers an interface without reading the implementation (locality; see KQ6). The decision is driven by agent legibility, not by the human-defect literature.
- Microservices for a one-founder product built by agents are contraindicated by every source found; modular monolith with enforced package boundaries is the default, with the boundary linter (Packwerk-style; in TS: `dependency-cruiser` or `eslint-plugin-boundaries`) as the artefact that keeps a later split possible.
- DDD and event sourcing are selected by domain complexity and audit requirements, not by default: DDD where business rules dominate (marketplaces, payments), event sourcing where append-only history is itself a requirement (ledgers, regulated flows) — which North's own `actions`/`ledger_entries` already are.

### Gaps
- No empirical work found on DDD, event sourcing or hexagonal architecture outcomes (these are case-study and practitioner literatures only).
- No study found on functional vs object-oriented paradigm outcomes with defect data.
- No microservice failure-rate statistic.

---

## Key question 6 — Principles that make code safer for an LLM to modify

### Takeaway
There is no controlled study yet that measures which code properties make LLM edits safer. The available evidence is (a) first-party harness guidance (Anthropic) built on one mechanism — context is the scarce resource and "performance degrades as it fills" — and (b) a 2026 practitioner synthesis that derives locality, small blast radius, explicit boundaries, navigability, cohesion and restrained complexity from that same mechanism, citing Parnas, Fowler and Ousterhout. Both converge on the same rules the human canon already agreed on, with an added emphasis on deterministic verification hooks over prose instructions.

### Cited Findings
- Anthropic: "Most best practices are based on one constraint: Claude's context window fills up fast, and performance degrades as it fills"; "When the context window is getting full, Claude may start 'forgetting' earlier instructions or making more mistakes." Hence: scope investigations, use subagents to keep research out of the main context, `/clear` between tasks, keep CLAUDE.md short, prefer running single tests over the whole suite. "If you work with a typed language, install a code intelligence plugin to give Claude precise symbol navigation and automatic error detection after edits." — [code.claude.com best practices](https://code.claude.com/docs/en/best-practices) (B)
- Salomon (2026), "How to Design a Maintainable Codebase for AI Coding Agents": principles are *locality* (changes stay in a small area so the agent need not load much of the system; scattered helpers and side effects make it "likelier to miss a dependency"), *blast radius* (stable interfaces, mechanically enforced dependency rules, isolated worktrees), *boundary integrity* (agents "reason from partial observations and can infer the wrong contract from local code"), *navigability* (progressive disclosure, short entry documents), *cohesion/coupling* (global-state, temporal, control-flag and convention coupling ranked most damaging because they enlarge the context needed for a safe change), *restrained complexity* (premature abstraction adds "context cost, which matters more for agents because of token budgets"). **No original measurements; no file- or function-size thresholds given**; the diagnostic is "can a new agent find the relevant behavior, change one bounded area, and run the smallest meaningful verification without guessing?" — [maintainable.software](https://maintainable.software/agentic-engineering-part-2-agentic-codebase-principles/) (C)
- Mason (2026): teams moved away from embedding whole codebases toward agents searching with grep and file reads; Anthropic's guidance is to load data just in time with tools. — [mikemason.ca](https://mikemason.ca/writing/ai-coding-agents-jan-2026/) (C)
- Agent context files study (2,303 AGENTS.md/CLAUDE.md files from 1,925 repos): most common content is test procedures (75.9%), implementation details (70.8%), architecture (68.1%); security (14.8%) and performance (14.5%) rarely covered; files evolve by frequent small additions "like configuration code" and are "complex and difficult to read"; the study describes content only and does not measure which guidance helps. — [arXiv 2511.12884](https://arxiv.org/abs/2511.12884) (A for the descriptive statistics; no causal claim)
- Karpathy: searches for a Karpathy statement on "LLM-legible code", small files or explicit types found none; the attributable material is his "LLM wiki" pattern (documents as source, LLM as compiler) and a four-rule CLAUDE.md (think before coding, keep it simple, surgical changes, verify success criteria) that a reviewer calls "small, legible". — [Developers Digest](https://www.developersdigest.tech/blog/karpathy-claude-md-skills-menu); [AAIF](https://aaif.io/blog/karpathys-llm-wiki-as-agent-memory) (D; **the "LLM-legible code" attribution in the assignment is unverified**)
- Hyrum's Law applies with force to agents: an agent that reads an implementation will depend on observable behaviour, not the documented contract, unless the contract is the only thing it needs to read (explicit types, Zod schemas). — [hyrumslaw.com](https://www.hyrumslaw.com/) (C) + inference
- Holzmann's rules 4 (≤60-line functions), 6 (smallest scope), 7 (check every return value, validate parameters on entry) and 10 (zero warnings, daily static analysis) are exactly the properties that reduce what an agent must hold in context to make a safe local edit. — [P10](https://spinroot.com/gerard/pdf/P10.pdf) (B) + inference
- Google small-CL guidance (≈100 lines, one self-contained change with tests) maps to agent task sizing: one slice per fresh-context session. — [eng-practices](https://google.github.io/eng-practices/review/developer/small-cls.html) (B) + inference
- GitClear 2026 data suggests AI-assisted code shows less reuse and less refactoring (above), i.e. the Metz/Abramov failure mode may be inverted for agents (too little consolidation) as well as the eager-abstraction mode; both are context-locality problems. — [GitClear](https://www.gitclear.com/the_ai_code_quality_maintainability_gap) (B, vendor)

### Inferences
- Agent-legibility rules, each with a lint or test: small files (`max-lines` 400 — already in North's CLAUDE.md); small functions (`max-lines-per-function` 50 — already in CLAUDE.md; Holzmann's 60 is the safety-critical analogue); explicit exported types and `strict` TypeScript with `noImplicitAny` (type checker); Zod parse at every boundary (import-boundary lint: raw `Request`, tool results, env and webhook bodies may only be touched inside `*/adapters/**`); dependency direction (`dependency-cruiser`: `core` may not import `adapters`, `adapters` may not import `web`); no shared mutable module state (`eslint-plugin-functional` `no-let` at module scope, `readonly` types); colocated tests (`*.test.ts` beside source; a CI script fails if an exported function has no sibling test file); checked return values/promises (`no-floating-promises`); zero warnings; one slice per PR with the e2e test in the same PR.
- Prose principles ("write clean code") should be removed from CLAUDE.md and replaced by the hook/lint that enforces them, per Anthropic's own advice; this is H11 applied to the harness.

### Gaps
- No controlled study measuring LLM edit-safety as a function of file size, typing, purity or DI was found. This is the largest open evidence gap for RQ3 and should be measured by North itself (DV5 as a function of file length / module fan-in).
- Karpathy "LLM-legible code" could not be sourced.

---

## Synthesis deliverables for the debate round

### (1) Proposed universal invariant core
Each rule: source lineage, whether it is lint- or test-checkable in a TypeScript monorepo, and how. "Lint" means a deterministic static check in CI; "test" means a deterministic runtime check; "review" means only a human/LLM reviewer can judge it. North constraints from CLAUDE.md are marked ◆.

| # | Rule | Lineage | Checkable? | Mechanism |
|---|------|---------|------------|-----------|
| I1 | Files ≤ 400 lines; functions ≤ 50 lines ◆ | Holzmann R4 (≤60); Google small CLs; Martin/Ousterhout agree over-size is bad even if they disagree on the floor | Lint | ESLint `max-lines`, `max-lines-per-function` |
| I2 | Validate every input at every boundary; no raw external data past the adapter layer ◆ | Holzmann R7 (parameter validity checked inside each function); Cockburn ports/adapters; Anthropic "never trust tool results" | Lint + test | Zod `parse` required in `adapters/**`; `dependency-cruiser` forbids `Request`/tool/webhook types outside adapters |
| I3 | Check every return value; no unhandled promise; explicit error types | Holzmann R7; SpaceX "constantly check error codes" | Lint | `@typescript-eslint/no-floating-promises`, `no-unused-expressions`, `strict` |
| I4 | Dependency direction is one-way: core ← adapters ← web/worker; core has no I/O | Cockburn hexagonal; Bernhardt FC/IS; Parnas information hiding; Shopify Packwerk precedent | Lint | `dependency-cruiser` / `eslint-plugin-boundaries` rules |
| I5 | No shared mutable state; return new objects ◆ | Hickey (state complects); Salomon (global-state coupling most damaging for agents) | Lint (partial) | `eslint-plugin-functional` (`no-let`, `immutable-data`), `readonly` types; residual by review |
| I6 | Every outside-world action passes `AuthorityEngine.gate()` ◆ | Amazon API mandate (one sanctioned path, no backdoors); DO-178C traceability | Lint + test | Import rule: only `gate()` may import integration SDKs; test that a direct call without gate throws |
| I7 | Append-only audit tables; never update/delete `actions`, `ledger_entries` ◆ | Event-sourcing literature; DO-178C traceability; Hyrum's law (history is depended upon) | Test + DB | Postgres rule/RLS denying UPDATE/DELETE; migration test |
| I8 | Zero warnings: `tsc --strict`, lint `--max-warnings 0`, run on every commit | Holzmann R10; Google CI | Lint | CI gate |
| I9 | No abstraction before the third occurrence; inline a wrong abstraction rather than parameterise it | Metz; Abramov; Bogard (add code, don't modify shared code); Salomon (restrained complexity) | Review | Reviewer checklist item; `jscpd` duplication report is informational, not a gate |
| I10 | Smallest possible scope for every declaration; smallest meaningful change set (one slice per PR, ~100–400 lines) | Holzmann R6; Google 100-line CL; Anthropic fresh-context-per-task | Lint + process | `prefer-const`, `block-scoped-var`; PR size check |
| I11 | The first test of every feature is end-to-end against real infrastructure (deployed preview, real DB row, real HTTP); unit tests are added behind it | GOOS "first, test a walking skeleton"; Cockburn; Anthropic "if you can't verify it, don't ship it" | Test + process | Feature spec ID must map to ≥1 Playwright/e2e test hitting the preview URL; done gate requires `Evidence` row ◆ |
| I12 | Tests contain no control flow and no sleeps; flake budget enforced | Google ch. 11 | Lint + CI | ESLint rule on `*.test.ts` forbidding `if`/`for`/`setTimeout`; flaky-test quarantine with budget |
| I13 | Advisory prose lives in CLAUDE.md only if it cannot be made a hook; every rule that can be a hook is a hook | Anthropic ("advisory" vs "deterministic"); Holzmann (rules nobody checks are ignored) | Process | Periodic audit: each CLAUDE.md line → hook/lint or deletion |

Not in the core (contested or product-dependent): function size *below* 50 lines, comment density, TDD vs test-after at the unit level, OOP vs FP, DDD, event sourcing beyond audit tables, services vs monolith, framework choice.

### (2) Methodology decision matrix
Columns are what the plan should select at intake (H12). "Team shape" uses the protocol's planner / builder / evaluator roles. Evidence basis per row is C unless noted; the matrix is a hypothesis for the debate round, not a measured result.

| Product properties | Architecture | Paradigm / design method | Testing approach | Team shape and verification tier |
|---|---|---|---|---|
| Static / landing / content site: no auth, no persistence beyond forms | Single deployable; static generation; one adapter for form/email via `gate()` | Data-oriented templates; no domain model | One e2e smoke on deployed preview (page renders, form submits, email/DB row observed); Lighthouse/a11y gate | Builder + evaluator; no planner round beyond intake; T1 verification |
| CRUD SaaS: auth, a few entities, dashboards, billing | Modular monolith, vertical slices per use case, Transaction Script first (Bogard) | Types-first data model (Zod schemas as source of truth); FC/IS; no DDD aggregates until rules get complex | Walking skeleton first (sign-up → create entity → see it); e2e per slice; unit tests on pure core; Google 80/15/5 ratio | Planner + builder + independent evaluator; founder decision cards at schema forks; T2 |
| Marketplace / multi-sided: two user roles, matching, payments, disputes | Modular monolith with enforced package boundaries (Packwerk-style lint) around each context (listing, matching, payment, dispute) | DDD-lite: bounded contexts and ubiquitous language in CONTEXT.md; explicit state machines for orders | Skeleton = one listing → one purchase in sandbox payments → one payout record; property tests on money/state machines; contract tests on payment adapter | Planner + builder per context + evaluator; security reviewer on payments; T3 |
| Real-time collaborative: presence, concurrent edits | Monolith + one real-time service (WebSocket/CRDT) behind a port; no further split | FP core for merge/CRDT logic (pure, deterministic); event log for state | Skeleton = two browsers see each other's change on preview; deterministic simulation tests for merge; chaos test for reconnect | Builder + dedicated runtime engineer + evaluator with two real browsers; T3 |
| Data pipeline / ETL / reporting | Batch jobs as pure transforms + imperative shell (Inngest/worker); idempotent steps | FP; schema-per-stage (Zod); no OOP hierarchy | Skeleton = one record ingested → transformed → visible in report; golden-file tests; replay from append-only source | Builder + evaluator; data-quality gates (row counts, schema drift); T2 |
| AI-agent product: LLM calls, tools, memory | Hexagonal with model calls behind a port; model IDs in one file ◆; every tool action through `gate()` | FC/IS; typed tool schemas; prompt templates as data | Skeleton = one user message → one tool call in sandbox → one evidence row; eval suite with fixed fixtures; adversarial inputs (prompt injection) in e2e | Planner + builder + *adversarial* evaluator (fresh context); T3 with cost gates (DV2) |
| Payments / regulated / money-moving | Modular monolith; append-only ledger; event-sourced money paths; sandbox default ◆ | DDD for the money context; explicit invariants with runtime assertions (Holzmann R5); exhaustive types for states | DO-178C-style traceability: every requirement ID → test → evidence; property tests on ledger invariants; mutation testing on money code; kill-switch test (≤5 s) ◆ | Planner + builder + evaluator + security reviewer; founder approval card before any live key; T4 |

Universal across rows: invariants I1–I13; walking skeleton before any horizontal layer; fresh-context session per slice; evaluator never the builder.

### (3) Walking-skeleton procedure (vertical slice first, then horizontal)
Synthesised from Cockburn, Hunt & Thomas, Freeman & Pryce, Humble & Farley, Bogard, Fowler and Anthropic, adapted to North's constraints.

1. **Classify the product** at intake using the matrix row (H12); record the class, the verification tier and the chosen row in the plan with a spec ID.
2. **Pick the spine path**: the single user-visible journey that touches every technical layer the product cannot exist without (e.g. sign-up → create the core entity → see it on a page → one external action through `gate()` in sandbox). It must be something the founder would click first.
3. **Pipeline before features**: create the repo, CI (typecheck, lint with zero warnings, unit, e2e), preview deployment per branch, seeded database, and sandbox credentials. Nothing user-facing is written until a trivial page deploys to a preview URL from CI (GOOS: build the deployment pipeline "without paying too much attention to the application's architecture").
4. **Write the first end-to-end test against the preview URL**, asserting a real DB row / real HTTP response / screenshot. It fails. It is the first test in the suite and it is never deleted.
5. **Install the structural guardrails before the first feature code**: dependency-direction lint, boundary-validation lint, file/function size lint, append-only DB rules, `gate()` import rule, test-size tags. These are cheap now and expensive later (Fowler: boundaries must be modular from the start for any later split).
6. **Implement the thinnest code that makes the e2e test pass** with real adapters (no mocks at the edges). Transaction Script is acceptable (Bogard). Record the `Evidence` row. The architecture "need not be final, but it must link together the main components" (Cockburn).
7. **Founder walkthrough of the skeleton on the preview URL** — the first real feedback and the first decision card if the spine was wrong. DV3 (time to first verified vertical slice) is measured here.
8. **Widen slice by slice**: each feature starts with its own failing e2e test (GOOS two-level cycle), is built in a fresh-context session with its own spec ID, adds code rather than modifying shared code (Bogard), and ships as one small PR (Google) with evidence.
9. **Refactor horizontally only on the third occurrence** (Metz/Abramov): when three slices share a shape, extract the shared module; keep it deep (Ousterhout) and behind the dependency-direction lint.
10. **Independent evaluation before "done"**: a fresh-context evaluator runs the full e2e suite on the preview, and refutes rather than confirms (Anthropic). Done requires `Evidence`; self-report never suffices.
11. **Keep the skeleton alive**: the original e2e test runs nightly (DV5); any regression is a stop-the-line event; flake budget enforced.
12. **Re-classify if the product changes class** (e.g. payments added) and raise the tier; this is a decision card.

### (4) Hypothesis verdicts (RQ3 assignment)

| Hypothesis | Verdict | Strength | Basis |
|---|---|---|---|
| H3 — walking skeleton first yields fewer integration failures and earlier real feedback than layer-first | **Supported in mechanism; weakly measured** | C (unanimous practitioner consensus across Cockburn, Hunt & Thomas, GOOS, Humble & Farley, Bogard, Fowler, Anthropic); one unretrieved peer-reviewed case study (Mellegård 2018) could raise to A | No controlled experiment found. North should measure DV3/DV5 under IV3 itself. |
| H8 — no universal methodology; a small invariant core is universal and the rest is selected by a decision matrix | **Supported** | B/A for the "no universal method" half (meta-analyses show small/null TDD effects; typing effects small or 15%; canon authors disagree in writing); B for the core being checkable (Holzmann's design premise; Google, Shopify, Anthropic artefacts) | The *content* of the core (table 1) is a proposal; no study validates that specific list. |
| H11 — large-company practices transfer only when converted into checkable artefacts | **Supported** | B (Holzmann's explicit argument that unchecked guidelines are ignored; Google test sizes/CL size/flake budget; Amazon ORR lens derived from COE; Shopify Packwerk; Anthropic "advisory vs deterministic") | No comparative study of culture-only vs artefact-enforced transfer; the evidence is that every successful transfer observed took artefact form. |
| H12 — complexity class is classified at intake and selects methodology | **Supported by precedent; untested for agent teams** | B (DO-178C levels select objective counts and coverage criteria — a mature, regulated instance of class-selected rigour; Fowler and Bogard select architecture by scale/complexity) | No evidence yet on *which* classification boundaries matter for LLM-built products; the matrix rows above are a hypothesis for round 2. |

### (5) Open questions for the debate round
1. Is the Mellegård et al. (2018) defect-report comparison retrievable, and does it support or weaken H3? It is the only peer-reviewed data point located.
2. Holzmann caps rules at ten because longer standards are ignored by humans. Does the same cap apply to agents, or can an agent follow 13+ lint-enforced invariants without degradation? (Anthropic's "bloated CLAUDE.md" warning suggests prose rules degrade; lint rules may not.)
3. The empirical TDD literature is for humans. Does test-first change anything for an LLM builder, given its known failure mode is *fake* tests rather than *absent* tests? Should the unit-level TDD rule be dropped in favour of "first test is e2e and real" (I11) only?
4. Static typing catches ~15% of surviving human bugs. Is the agent-side benefit (interface discovery without reading implementations; deterministic post-edit error signal) larger, and can North measure it (DV5 by typed vs untyped boundary)?
5. Ousterhout's "deep modules" vs Martin's "small functions": the 50-line function cap in CLAUDE.md sides with Martin. Should the cap be loosened toward Holzmann's 60 or Ousterhout's "as deep as the interface allows", with depth measured as fan-in/fan-out rather than lines?
6. GitClear reports AI-assisted code shows *less* reuse and refactoring. Does the Metz/Abramov "prefer duplication" rule, when given to an agent, worsen this, and should I9 be paired with a periodic consolidation pass?
7. Where exactly do the decision-matrix class boundaries sit for a non-technical founder's intake? Which observable properties (money movement, multi-user concurrency, external side effects, regulated data) move a product between rows, and who decides when the founder cannot?
8. The API-mandate text, Cockburn's walking-skeleton page, the Prime Video post and the Pragmatic Programmer tips are all cited from secondary or memory sources this session. Which of these does the blueprint actually depend on, and which can be dropped?
9. Should "no mocks at the edges" (I11) be absolute, or should the matrix allow test doubles for third-party services at T1/T2 provided a contract test against the sandbox exists?
10. Hyrum's law implies that agents reading implementations will couple to accidental behaviour. Does a rule "an agent may read only the type/schema of a module it does not own" (enforced by tool restrictions) improve DV5, or does it starve the agent of needed context?
