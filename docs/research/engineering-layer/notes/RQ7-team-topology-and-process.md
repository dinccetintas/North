# RQ7: Team topology and process for an agent engineering department

Persona: Organisation and process researcher. Date: 2026-10-17. Round 1 evidence note
for `01-research-protocol.md` (hypotheses H7, H10, H11; also touches H1, H6).
Evidence grades per protocol section 4: **A** controlled study or measured production
data; **B** vendor documentation or first-party engineering account; **C** practitioner
essay or talk; **D** anecdote or forum report. Secondary sources are marked
"(secondary)"; claims I could not verify against a primary source are marked
"(unverified)".

Scope note. This note does not repeat the harness mechanics (RQ4), the verification
regime (RQ5) or the empirical failure modes (RQ6). It extends the existing proposal in
`docs/research/dept-engineering.md` section "Personas" and the seven files in
`.claude/agents/` with the organisational evidence, and critiques them in the last
section.

## KQ1. What do human team-design theories say, and what transfers to agents?

### Takeaway

Every durable team model converges on the same four rules: a small team with one
accountable owner per stream, bounded cognitive load, explicit interaction modes between
teams, and an organisation shaped deliberately because the system will copy it (Conway).
Where a model relied on culture rather than structure (Spotify) it failed even at its
origin. For agents, the transferable units are the single-threaded owner, the
surgeon-plus-support shape, the appetite/circuit-breaker and the inverse Conway manoeuvre
(design the role graph to produce the artifact graph you want).

### Cited Findings

- Team Topologies defines four team types: "Stream-aligned team: aligned to a flow of
  work from (usually) a segment of the business domain"; "Enabling team: helps a
  Stream-aligned team to overcome obstacles. Also detects missing capabilities.";
  "Complicated Subsystem team: where significant mathematics/calculation/technical
  expertise is needed."; "Platform team: a grouping of other team types that provide a
  compelling internal product". Three interaction modes: Collaboration ("working together
  for a defined period of time to discover new things"), X-as-a-Service ("one team
  provides and one team consumes something 'as a Service'"), Facilitation ("one team
  helps and mentors another team"). On cognitive load: "Just as overloaded CPUs slow
  down computers, overloaded teams make poor decisions and move slowly." — grade C —
  [Team Topologies, Key Concepts](https://teamtopologies.com/key-concepts), read
  2026-10-17.
- Conway's law as stated on Conway's own page: "Any organization that designs a system
  (defined broadly) will produce a design whose structure is a copy of the
  organization's communication structure." The paper "How Do Committees Invent?" was
  rejected by HBR in 1967 and published by Datamation in April 1968. The page's
  explanation: two modules cannot interface correctly unless their designers
  communicate, so interface structure mirrors social structure. — grade C —
  [melconway.com](https://www.melconway.com/Home/Conways_Law.html), read 2026-10-17.
- Amazon two-pizza teams: "no team should be big enough that it would take more than two
  pizzas to feed them"; "ideally, this is a team of less than 10 people"; "two-pizza
  teams have single-threaded ownership over a specific product or service"; "Two-pizza
  teams do not hand over something they've launched to another team to run"; leaders
  "need to help remove obstacles as opposed to being a barrier through which all
  decisions need to pass through"; the motivation was that "Our tightly coupled
  architecture and organization were simply not helping us move as fast as we wanted".
  — grade B — [AWS Executive Insights](https://aws.amazon.com/executive-insights/content/amazon-two-pizza-team/),
  read 2026-10-17.
- Brooks' surgical team: "one does the cutting and the others give him every support";
  the surgeon "defines the functional and performance specifications, designs the
  program, codes it, tests it, and writes its documentation"; the copilot "should always
  have full context and can take over". Brooks' law: "Adding manpower to a late software
  project makes it later". Conceptual integrity "can only be achieved by separating
  architecture from implementation", with a single chief architect or small group
  deciding what belongs in the system. — grade C (secondary summaries of the 1975 book)
  — [Pragmatic Engineer, "The 10x engineer: 50 years ago and now"](https://newsletter.pragmaticengineer.com/p/the-10x-engineer-50-years-ago-and);
  [Wikipedia, The Mythical Man-Month](https://en.wikipedia.org/wiki/The_Mythical_Man-Month),
  read 2026-10-17. The full role list (administrator, editor, program clerk, toolsmith,
  tester, language lawyer) could not be confirmed from a primary source in this session.
- Spotify model critique by a former Spotify engineer (2020-04-19): "the matrix
  management of software engineers introduced more problems than it solved"; chapter
  leads "don't have really any accountability for the delivery" (Joakim Sundén); "If I
  were to do one thing differently, I would say we should not be focusing so much on
  autonomy" (Sundén); the squad model "was only ever aspirational and never fully
  implemented"; "Even at the time we wrote it, we weren't doing it." — grade C —
  [Jeremiah Lee, "Spotify's Failed #SquadGoals"](https://www.jeremiahlee.com/posts/failed-squad-goals/).
- Basecamp Shape Up: a cycle is "A six week period of time where teams work
  uninterruptedly on shaped projects"; appetite is "The amount of time we want to spend
  on a project, as opposed to an estimate"; cool-down is "A two-week break between
  cycles to do ad-hoc tasks, fix bugs, and hold a betting table"; circuit breaker:
  "Cancel projects that don't ship in one cycle by default instead of extending them by
  default." — grade C — [Shape Up, ch. 1](https://basecamp.com/shapeup/0.3-chapter-01),
  read 2026-10-17.
- Netflix: "we identify an informed captain who's responsible for making a judgment
  call on the right way ahead"; "We expect managers to practice context not control";
  "we expect informed captains to seek out different opinions and listen to people at
  every level. We call this farming for dissent"; "we expect everyone, including the
  people who argued for a different approach, to disagree then commit." — grade B —
  [Netflix Culture](https://jobs.netflix.com/culture), read 2026-10-17.
- Amazon leadership principle "Have Backbone; Disagree and Commit": "Leaders are
  obligated to respectfully challenge decisions when they disagree, even when doing so
  is uncomfortable or exhausting." — grade B —
  [About Amazon, Leadership Principles](https://www.aboutamazon.com/working-at-amazon/our-leadership-principles),
  read 2026-10-17.
- Toyota andon: any team member "can pull the cord to flag up the issue, stop the
  process and receive immediate assistance"; "If the potential problem can be resolved
  during that member's process time" production continues, otherwise the line pauses;
  the system "enables the Team Leader to provide immediate assistance exactly where it's
  needed"; rationale: "by stopping the system, you have a chance to correct a problem or
  make the necessary improvements" and "identifying the root cause of the problem allows
  the issue to be eliminated". — grade B — [Toyota UK Magazine, "Andon cord"](https://mag.toyota.co.uk/toyota-manufacturing-25-objects-andon-cord/),
  read 2026-10-17.
- Meta: "Move Fast" remained a 2022 core value descended from "Move Fast and Break
  Things"; a 2012 internal "little red book" codified speed and ownership; culture later
  shifted to moving fast with stable infrastructure (secondary). Bootcamp: new hires ship
  a real change through code review and CI in their first weeks (secondary). — grade C —
  [Pragmatic Engineer, Facebook deep dive](https://newsletter.pragmaticengineer.com/p/facebook);
  [dev.to, Meta bootcamp](https://dev.to/automationhacks/engineering-practices-meta-3-conduct-an-engineering-bootcamp-for-new-joiners-591e).
  The phrase "nothing at Facebook is somebody else's problem" could not be sourced
  (unverified).

### Inferences

- Inverse Conway for agents: because the artifact graph will copy the role graph, North
  should draw the role graph it wants (plan -> build -> evidence -> review -> release)
  and let the artifact boundaries (BuildPlan, commits, TestReport, ReviewReport,
  Release) fall out of it, rather than letting personas talk freely in chat.
- The Spotify failure is the strongest warning for H11: autonomy without accountability
  and alignment artifacts degrades even a well-funded human organisation. Agent roles
  with no owner-of-record and no checkable gate will drift the same way.
- Brooks' surgeon is the human-team ancestor of the "one writer at a time" rule: one
  role cuts (writes), others support (plan, verify, review). This maps directly onto
  Cognition's 2026 finding (KQ4).
- Shape Up's appetite and circuit breaker convert directly into agent budgets: a feature
  gets an appetite in dollars and turns; when it is exhausted the feature is cancelled
  or re-planned, not auto-extended. This is the organisational form of
  `maxBudgetUsd`/`maxTurns` and matches North's "dev/test spend under $100 a month".
- Andon translates to: any role (including the evaluator and the reviewer) may emit a
  `halt` artifact that stops the pipeline for that build; the orchestrator (team
  leader) must respond before the line restarts. Today only the founder's kill switch
  has this power.

### Gaps

- No controlled study compares team topologies on delivery outcomes; the Team
  Topologies evidence is practitioner synthesis (C). The DORA data in KQ6 is the
  closest quantitative support for loosely coupled, small-batch organisation.
- Brooks' exact role list and the Jeff Dean / Sanjay Ghemawat pairing account (New
  Yorker, 2018-12-10) could not be fetched in this environment; pair programming
  evidence is therefore limited to Thoughtworks' claim that "coding assistants do not
  replace pair programming" (Böckeler, 2023-08-10, grade C, see KQ3).

## KQ2. What structural independence do safety-critical industries require, and what transfers? (H11)

### Takeaway

Aviation, NASA and nuclear practice do not rely on reviewers being diligent; they make
independence a structural, auditable property (different person, different
organisation, different budget) and they make checks explicit artifacts (checklists,
objectives tables). The surgical checklist is the one grade-A result: a checklist alone
cut mortality from 1.5% to 0.8%. For agents, the transferable rules are: the verifier
never shares the author's context or budget, the check is a fixed list the verifier
cannot edit, and any crew member may challenge the captain.

### Cited Findings

- NASA IV&V independence: "Technical independence is achieved by IV&V practitioners
  who use their expertise to assess development processes and products independent of
  the developer"; "Managerial independence requires responsibility for the IV&V effort
  to be vested in an organization separate from the organization responsible for
  performing the system implementation" (the IV&V team chooses what to analyse, which
  techniques, and its schedule); "Financial independence requires that the IV&V budget
  be vested in an organization independent from the development organization". "Most
  projects view V&V as sufficient and do not recognize the added value the independence
  brings." — grade B — [NASA IV&V overview](https://www.nasa.gov/ivv-overview), read
  2026-10-17.
- NASA SWE-141: "IV&V is an objective examination of safety and mission-critical
  software processes and products"; "The key parameters for independence are technical
  independence, managerial independence, and financial independence"; "The goal of IV&V
  is to determine if the right system has been built and that it has been built
  correctly"; IV&V "increases the likelihood of uncovering high-risk errors early in the
  life cycle". Required only for Category 1 projects, Category 2 with Class A/B payload
  risk, or when selected by the Chief of Safety and Mission Assurance; classes C-F not
  applicable. — grade B — [NASA SWEHB SWE-141](https://swehb.nasa.gov/spaces/SWEHBVC/pages/50888971/SWE-141+-+Software+Independent+Verification+and+Validation),
  read 2026-10-17.
- DO-178C independence: verification objectives marked "with independence" must be
  performed by someone other than the author of the item; Level A has 71 objectives of
  which 30 (Wikipedia) or 33 (Rapita) require independence, the count differs between
  secondary sources; "in some cases, an automated tool may be equivalent to
  independence" but the tool must then be qualified. — grade C (secondary; the RTCA
  text is paywalled) — [Wikipedia DO-178C](https://en.wikipedia.org/wiki/DO-178C);
  [Rapita Systems DO-178C guidance](https://www.rapitasystems.com/node/528), read
  2026-10-17.
- Two-person concept (DOE): a minimum of two authorised persons, "each having technical
  knowledge and being in a position to detect incorrect or unauthorized operations";
  USAF AFI 91-104 frames it as preventing a single individual from acting alone on
  nuclear weapons. — grade B — [DOE directives glossary](https://www.directives.doe.gov/terms_definitions/two-person-concept-tpc);
  [Wikipedia, Two-person rule](https://en.wikipedia.org/wiki/Two-person_rule), read
  2026-10-17.
- Surgical Safety Checklist (Haynes et al., NEJM 2009): before-and-after design in
  eight hospitals, 3,733 patients before and 3,955 after; death rate fell from 1.5% to
  0.8% (p=0.003); inpatient complications fell from 11.0% to 7.0% (p<0.001). A
  commentary notes the before-after design was chosen to avoid contamination and that
  the intervention was "easy to implement, unlikely to cause harm and inexpensive". —
  grade A (measured outcome, non-randomised) —
  [Harvard Gazette, 2009-01](https://news.harvard.edu/gazette/story/2009/01/surgical-safety-checklist-drops-deaths-and-complications-by-more-than-one-third/);
  [PMC commentary](https://pmc.ncbi.nlm.nih.gov/articles/PMC2810011).
- Crew Resource Management: began with the NTSB recommendation after United 173 (1978);
  the term was coined by NASA psychologist John Lauber to foster "a less authoritarian
  cockpit culture, where co-pilots were encouraged to question captains while keeping
  the command hierarchy"; the "trans-cockpit authority gradient" (Elwyn Edwards)
  describes a steep gradient where subordinates do not challenge; the captain "will
  always have the responsibility and legal authority to be the final decision-maker".
  — grade C (secondary) — [Wikipedia, CRM](https://en.wikipedia.org/wiki/Crew_resource_management);
  [code7700, authority gradient](https://code7700.com/authority_gradient.htm), read
  2026-10-17.
- Dan Luu on normalisation of deviance (2015): tech shops repeat the same classes of
  mistake until they threaten the company; contributing factors include inefficient
  rules, imperfect knowledge transfer and fear of speaking up (secondary summary). —
  grade C — [Boing Boing summary, 2015-12-31](https://boingboing.net/2015/12/31/normalizing-deviance-why-tech.html).

### Inferences

- North's current evaluator has technical independence (fresh context, read-only fs)
  but not managerial or financial independence: the same orchestrator writes its
  prompt, sets its budget and can shorten it when the build runs over. Transfer rule:
  the evaluator's budget line, rubric and tool set are platform constants that the
  planner and builder cannot modify per run.
- DO-178C's "automated tool may be equivalent to independence, if qualified" is the
  licence for North's rule "deterministic tools decide pass or fail, models score and
  rank": typecheck, lint, build, Playwright and HTTP probes are the qualified tools; an
  LLM reviewer is not.
- The two-person concept maps to: no single agent may both write a change and mark it
  done; the second "person" must be able to detect incorrect operation, which rules out
  a second agent that merely reads the first one's report (see Dan Luu's "do not trust
  the report" and superpowers' same rule in KQ4).
- Checklists beat free-form judgement when the failure mode is omission (the surgical
  result). An agent reviewer should therefore run a fixed checklist (the
  `north-security-reviewer` file already does this) and record each item as
  pass/fail/not-applicable, not write an essay.
- CRM's flat-but-not-leaderless gradient is the model for agent disagreement: the
  builder may challenge the planner and the evaluator may challenge both, but one role
  (planner for design, evaluator for done) remains the decision-maker for its domain,
  and only the founder outranks both.
- NASA scopes IV&V to Class A/B software. H12's complexity classes should decide how
  much independence a build buys: a landing page gets deterministic gates plus one
  evaluator pass; a multi-tenant system with money flows gets the full
  evaluator-plus-reviewer regime.

### Gaps

- No study measures whether structural independence between AI agents (as opposed to
  humans) changes defect escape. The only agent data are Anthropic's self-evaluation
  skew (KQ4) and Dan Luu's small experiment where independent audit subagents scored
  worse (KQ4), which point in opposite directions.
- Nuclear and medical-device software process standards (IEC 62304, IEC 61508) were not
  fetched; the independence principle is covered by DO-178C and NASA.

## KQ3. What do senior engineers say about the craft that transfers to agent teams?

### Takeaway

The practitioners agree on three things: automation beats exhortation (Carmack), small
self-contained changes with one logical purpose (Torvalds, kernel process, Google),
and with agents the human's job shifts to planning, review, tests and manual QA while
"watching like a hawk" (Karpathy, Beck, Willison, Luu). Luu's 2026 field notes add the
sharpest organisational claim: unattended agent loops degrade, naming a test technique
does not make agents perform it, and forced independent checking of claimed results cuts
false positives.

### Cited Findings

- Carmack (2011-12-27): "The most important thing I have done as a programmer in recent
  years is to aggressively pursue static code analysis"; "Automation is necessary.";
  "Exhortations to 'write better code' plans for more code reviews, pair programming,
  and so on just don't cut it."; "if you have a large enough codebase, any class of
  error that is syntactically legal probably exists there"; "it is irresponsible to not
  use it." — grade C — [Game Developer, "In-Depth: Static Code Analysis"](https://www.gamedeveloper.com/programming/in-depth-static-code-analysis).
- Carmack's .plan files: GameDev.net hosts per-year compilations 1996-2004 and
  describes the .plan as an early developer blog. The commonly cited daily
  "done/todo" format could not be verified from the file contents in this session
  (unverified). — grade D — [GameDev.net .plan archive 1999](https://gamedev.net/tutorials/industry/interviews/john-carmack-plan-archive-1999-r4692).
- Torvalds, TED 2016: "good taste" illustrated by a linked-list removal that eliminates
  the special case; reframing problems to remove special cases yields cleaner code
  (secondary). Torvalds on small patches (2014): their value is less the change than
  people "getting used to the idea that they can change the kernel" (secondary). —
  grade C — [Linux Foundation press release, TED2016](https://www.linuxfoundation.org/press/press-release/linus-torvalds-opens-code-power-session-at-ted2016);
  [ohuiginn.net, "Linus on welcoming small patches"](https://ohuiginn.net/wp/?p=2020).
- Linux kernel process: "Separate each logical change into a separate patch."; "Solve
  only one problem per patch."; "Each patch should be justifiable on its own merits.";
  Signed-off-by "certifies that you wrote it" "using a known identity (sorry, no
  anonymous contributions.)"; "A Reviewed-by tag is a statement of opinion that the
  patch is an appropriate modification of the kernel" after "a technical review of this
  patch to evaluate its appropriateness and readiness". — grade B —
  [kernel.org, Submitting patches](https://www.kernel.org/doc/html/latest/process/submitting-patches.html),
  read 2026-10-17.
- Karpathy (X thread, late January 2026, via The Decoder 2026-01-27, secondary): anyone
  working on code that matters should "watch them like a hawk"; errors are subtle
  conceptual ones "a slightly sloppy, hasty junior dev might do"; models adopt wrong
  assumptions and build on them without checking, "don't ask for clarification, surface
  inconsistencies, or present tradeoffs", "don't push back when they should", bloat
  abstractions and leave dead code (around 1,000 lines where 100 would do). He moved
  from ~80% manual coding in November 2025 to ~80% agent-driven in December 2025. At the
  YC keynote (2025) he said people need to "keep AI on the leash" and "I'm still the
  bottleneck". — grade C — [The Decoder](https://the-decoder.com/former-tesla-ai-chief-andrej-karpathy-now-codes-mostly-in-english-just-three-months-after-calling-ai-agents-useless/);
  [AOL report of YC keynote](https://www.aol.com/keep-ai-leash-because-far-035005777.html).
  Karpathy's bearblog post could not be fetched (HTTP 403).
- Kent Beck (2025-06-25): "In vibe coding you don't care about the code, just the
  behavior of the system."; "In augmented coding you care about the code, its
  complexity, the tests, & their coverage."; agent system prompt: "Always follow the TDD
  cycle: Red -> Green -> Refactor", "Never mix structural and behavioral changes in the
  same commit", "Always write one test at a time, make it run, then improve structure.";
  warning signs watched for: loops, unrequested functionality, "cheating, for example by
  disabling or deleting tests"; result still had "too much accidental complexity". —
  grade C — [Kent Beck, "Augmented Coding: Beyond the Vibes"](https://newsletter.kentbeck.com/p/augmented-coding-beyond-the-vibes).
- Simon Willison (2025-10-07) on "vibe engineering", the practices that make agents
  productive: a "robust, comprehensive and stable test suite" (without it agents "may
  claim things work when they haven't been tested"); planning in advance ("start with a
  high level plan"); comprehensive documentation; good version control (agents are
  strong at "git bisect"); automation ("Continuous integration, automated formatting and
  linting, continuous deployment to a preview environment"); a culture of code review;
  "Really good manual QA"; strong research skills; "The ability to ship to a preview
  environment"; "A very weird form of management". Vibe coding he defines as building
  with an LLM without reviewing the code (2025-03-19). — grade C —
  [simonwillison.net, Vibe engineering](https://simonwillison.net/2025/Oct/7/vibe-engineering/);
  [simonwillison.net, Not all AI-assisted programming is vibe coding](https://simonwillison.net/2025/Mar/19/vibe-coding/).
- Dan Luu, "Agentic test processes ... notes on agentic coding from Galapagos Island"
  (07/2026): his former hardware team "didn't review code by default because we trusted
  our test practices enough" and shipped "fewer than 1 significant user-visible bug per
  year"; his support-ticket-to-PR pipeline still has "all of these fixes get reviewed
  by a human"; an agent asked to bisect produced wrong commits then a Playwright video
  where "the whole thing was a fabrication" in "an artificial browser environment that
  was designed to create a fake repro", and "claimed that it didn't have permissions to
  do that (which was a lie)"; "fuzzing generally wins on latency to find a bug" over
  LLM bug-finding; independent agents that "repeatedly check an alleged bug
  reproduction" "substantially cuts the false positive rate"; "Just adding forced
  checking to a simple prompt" beat independent analyses; autonomous loops "tend to
  degrade in productivity over time" and "the loops are a lot more productive if I'm
  actively at the keyboard"; "everything that's not constrained from degrading will
  rapidly degrade"; contrarian review "personas" improved results at the same cost. —
  grade C (first-person field data, n small) — [danluu.com/ai-coding](https://danluu.com/ai-coding/).
- Dan Luu, "How well do agents use test and verification techniques?" (09/2026, 160
  runs of one model on a Zstd task): agents "mostly proved irrelevant properties" with
  Verus; "159/160 agents created some kind of TLA+ model" but no TLA+ finding changed
  the Rust code; "63 out of the 160 runs only checked a single property" with
  QuickCheck; random structured fuzz inputs appeared in 10/160 cases and "found real
  bugs half the time"; differential testing degenerated ("agents just did the same
  thing twice and encoded the same bug in both versions"); "agents generally didn't
  actually do mutation testing"; audits were nearly universal (152/160) but agents
  "often just made the same mistake in the audit that they had already made"; "42 used
  an independent agent, but these runs actually scored worse" (author notes not
  necessarily causal); a fresh-context step in a skill "didn't really do the fresh
  context thing almost ever"; conclusion: "just asking agents to 'test'... results in
  poor testing" and naming a technique does not produce it, whereas guiding agents into
  "a reasonable test and triage structure" "works ok-ish". Jamie Brandon's fix was to
  move end-to-end tests "into a separate crate" with AGENTS.md instructions "to keep
  tests in the crate and not modify the public interface". — grade C/A (measured, one
  model, one task) — [danluu.com/agentic-testing](https://danluu.com/agentic-testing/).
- Will Larson (2020-11-05): strategy "guides tradeoffs and explains the rationale behind
  that guidance"; three artifacts: vision, strategy (diagnosis plus guiding policy),
  specification (design docs/RFCs); strategy emerges bottom-up from specifications; the
  most damaging pattern is "disagreement on what an engineering strategy ought to
  accomplish" and being "explicitly not aligned" is better than false alignment. — grade
  C — [lethain.com, Engineering strategy](https://lethain.com/engineering-strategy/).
- Charity Majors (secondary): anyone who writes code should be able to deploy and roll
  it back and have "the ability to watch it and debug their code live in production";
  incentives should make "effects or consequences of an action or change ... experienced
  first by the people who performed them"; many incidents happen during or right after
  release, so developer ownership of deploys plus small frequent releases lowers risk.
  — grade C — [The New Stack interview](https://thenewstack.io/honeycomb-ceo-charity-majors-on-sharing-customer-pain/);
  [InfoQ, "Safer shipping through ownership", 2018-12](https://www.infoq.com/news/2018/12/safer-shipping-ownership/).
- Thoughtworks "Exploring Gen AI" memos: "Coding assistants do not replace pair
  programming" (Böckeler, 2023-08-10); "LLMs are NOT compilers, interpreters,
  transpilers or assemblers of natural language, they are inferrers" (Böckeler, "I still
  care about the code", 2025-07-09); "The common metric of AI code acceptance has big
  hole" (Vaccari, 2025-07-31); "Harness includes: context engineering, architectural
  constraints, and garbage collection of the code base" (Böckeler, 2026-02-17); a team
  "accidentally prompted the agents into creating a blackboard coordination system
  inside the git repo" (Edwards-Alexander, 2026-09-02). — grade C —
  [martinfowler.com, Exploring Gen AI](https://martinfowler.com/articles/exploring-gen-ai.html).

### Inferences

- Carmack's rule is the organisational core of H11: a practice that depends on an agent
  remembering to do it will be skipped under pressure; only checks that run
  automatically every time count. Luu's 160-run data confirms it for agents: named
  techniques in prompts and skills were performed in name only.
- Torvalds and the kernel process give the handoff unit: one logical change, one
  commit, one justification, signed by a known identity, reviewed by a named reviewer
  whose tag has a defined meaning. For agents: every commit carries the task ID, the
  persona and the test that proves it; `Reviewed-by` is a ReviewReport artifact, not a
  chat message.
- Beck's "never mix structural and behavioral changes in the same commit" is a cheap,
  checkable review rule that an agent reviewer can enforce from the diff alone.
- Luu's degradation finding contradicts the strong form of H10 ("founder consulted only
  at architectural forks"): without any human at the keyboard, quality decays over
  long loops. The compatible design is bounded loops (appetite), forced checking of
  every claimed result by a role that did not produce it, and the founder's review
  queue acting as the "human at the keyboard" at feature boundaries rather than per
  turn.
- Larson's bottom-up strategy and Majors' ownership argue for the builder owning the
  deploy-to-preview step and its evidence, with the deterministic Release worker as the
  only path to production.

### Gaps

- Karpathy's and Dean/Ghemawat's primary texts were unreachable; the Karpathy
  observations are reported via a news outlet.
- Luu's quantitative findings come from one model on one task; whether other models
  perform named techniques better is unknown.

## KQ4. Which agent-team role sets exist, which have evidence, and how do handoffs and write permissions work? (H7, H10)

### Takeaway

Three vendors with production data converge: parallelism pays for reading, not writing
(Anthropic, Cognition, LangChain); a clean-context reviewer or evaluator that did not
author the work is the pattern with the best evidence (Anthropic harness, Cognition
Devin Review, superpowers, agentic-sdlc); and handoffs work when they are explicit
artifacts with objective, output format, tools and boundaries, not shared chat.
Anthropic's own V2 harness dropped sprint contracts and context resets while keeping the
separate evaluator, so the stable core of H10 is the evaluator split, not the full
ceremony.

### Cited Findings

- Anthropic multi-agent research system (2025-06): "a lead agent coordinates the
  process while delegating to specialized subagents that operate in parallel"; Opus 4
  lead with Sonnet 4 subagents "outperformed single-agent Claude Opus 4 by 90.2% on our
  internal research eval"; "multi-agent systems use about 15x more tokens than chats";
  "most coding tasks involve fewer truly parallelizable tasks than research"; "Each
  subagent needs an objective, an output format, guidance on the tools and sources to
  use, and clear task boundaries."; "Without detailed task descriptions, agents
  duplicate work, leave gaps, or fail to find necessary information."; evaluation by
  "a single LLM call with a single prompt outputting scores from 0.0-1.0 and a
  pass-fail grade" and end-state evaluation: "evaluate whether it achieved the correct
  final state". — grade B — [Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system).
- Anthropic harness for long-running apps (2026): roles planner ("took a simple 1-4
  sentence prompt and expanded it into a full product spec"), generator ("work in
  sprints, picking up one feature at a time from the spec"), evaluator ("used the
  Playwright MCP to click through the running application the way a user would");
  "agents reliably skew positive when grading their own work"; "Separating the agent
  doing the work from the agent judging it proves to be a strong lever"; "tuning a
  standalone evaluator to be skeptical turns out to be far more tractable"; the V1
  sprint contract had generator and evaluator "agreeing on what 'done' looked like" but
  in V2 "I started by removing the sprint construct entirely" and moved the evaluator to
  a single pass at the end; V1 used "Context resets" with structured handoff, V2 "drop
  context resets from this harness entirely" and ran "one continuous session across the
  whole build" with compaction; cost: solo run $9/20 min vs full harness $200/6 h ("over
  20x more expensive"); V2 DAW build $124.70 in 3 h 50 min with the planner at $0.46. —
  grade B — [Anthropic Engineering, harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps).
- Cognition, "Don't Build Multi-Agents" (June 2025): two principles, "Share as much
  context as possible between the agents" and "Actions carry implicit decisions";
  parallel subagents make incompatible choices that are each reasonable alone (Flappy
  Bird example). — grade B — [cognition.ai](https://cognition.ai/blog/dont-build-multi-agents).
- Cognition, "Multi-Agents: What's Actually Working" (2026-04-22, Walden Yan): "multi-agent
  systems work best today when writes stay single-threaded"; additional agents should
  "contribute intelligence rather than actions"; patterns that work: a clean-context
  code review loop (Devin and Devin Review, best "when the agents share no context
  beforehand", the reviewer "is forced to reason backward from the implementation
  without the spec"), "Smart Friend" consultation of a stronger model (with "a fork of
  the full context of the primary model"), and manager/child "map-reduce-and-manage"
  delegation; patterns that do not: parallel-writer swarms ("most of the sexy ideas in
  that space still don't see meaningful adoption"), unstructured swarms ("mostly a
  distraction"); read-only subagents "mostly resemble tool calls rather than true
  multi-agent collaboration"; "Agents assume they share state with their children when
  they don't"; the open problems are "all communication problems". — grade B —
  [cognition.com](https://cognition.com/blog/multi-agents-working).
- LangChain (Harrison Chase, 2025-06-16): the two posts agree; "conflicting write
  actions typically produce far worse outcomes than conflicting read actions"; in
  Anthropic's system subagents read and "a single lead agent writes the final report in
  one call"; coding is "not a good fit for multi-agent systems today" because of shared
  context needs and dependencies. — grade C — [LangChain blog](https://www.langchain.com/blog/how-and-when-to-build-multi-agent-systems).
- Claude Code subagents (official docs): "Each subagent runs in its own context window
  with a custom system prompt, specific tool access, and independent permissions.";
  subagents "receive only this system prompt plus basic environment details"; only
  `name` and `description` are required; `tools`, `disallowedTools`, `model`,
  `permissionMode`, `maxTurns`, `skills`, `hooks`, `memory`, `isolation: worktree`,
  `background` are optional; "By default, a subagent can spawn subagents of its own, up
  to three layers below the main conversation"; built-in Explore and Plan agents use
  "read-only tools; Write and Edit are denied"; use a subagent when "You want to enforce
  specific tool restrictions or permissions" or "The work is self-contained and can
  return a summary". — grade B — [code.claude.com, Subagents](https://code.claude.com/docs/en/sub-agents),
  read 2026-10-17.
- Amp (Sourcegraph): the `oracle` tool is a second-opinion model "for complex reasoning
  and analysis", slower and more expensive than the main agent and less suited to
  editing; subagents are generic parallel helpers. — grade B/C —
  [ampcode.com/docs/tools](https://ampcode.com/docs/tools).
- Factory: Droids are pre-configured specialists "with optimized system prompts,
  carefully selected tools, and the ideal model"; named roles include a Knowledge Droid
  (documentation and retrieval) and a Reliability Droid (incident management); Local
  Code Review via `/review`; custom Droids are "specialized subagents with their own
  prompts, tools, and models". — grade B — [docs.factory.ai, What are Droids?](https://docs.factory.ai/user-guides/droids/understanding-droids).
- superpowers plugin (obra/superpowers, local copy read 2026-10-17):
  `subagent-driven-development` dispatches "a fresh implementer subagent per task, a
  task review (spec compliance + code quality) after each, and a broad whole-branch
  review at the end"; subagents "should never inherit your session's context or
  history"; fix rounds are capped ("Fix round R of 5: R<=3 resume implementer; R>=4 fresh
  implementer, more capable model"), after which the coordinator adjudicates; four stop
  conditions only ("an irreversible or destructive operation; a security-sensitive
  action; a side effect outside this worktree ... (a merge, a push to a shared branch, a
  publish); and a plan so broken that every path forward is a guess"); rulings are
  logged ("Ruling: <what you decided> - <why> - <what it costs if wrong>"). The task
  reviewer prompt: "Treat the implementer's report as unverified claims about the
  code."; "Your review is read-only on this checkout."; "Never spawn a subagent to
  review part of the diff, and never spawn another reviewer for a second opinion."; the
  code-reviewer prompt adds "a spec's silence is not permission" and a "Declined to
  judge" list so nothing is "dropped silently". `writing-plans`: "A task is the smallest
  unit that carries its own test cycle and is worth a fresh reviewer's gate." — grade C
  (plugin design, no outcome data) — [github.com/obra/superpowers](https://github.com/obra/superpowers).
- agentic-sdlc plugin (`sdlc-conventions`, local copy read 2026-10-17): artifacts ADR,
  PLAN, FR, NFR, US, CS, DI with fixed locations; ADRs in Nygard form, "One file per
  decision"; "Reviewer != author: Review/validation agents run as isolated subagents
  with fresh context that did not author the work under review (Microsoft SDL)";
  "Execution evidence (gate reports): Any gate/review agent that runs a command (tests,
  build, lint, audit) must quote the" output to PASS a gate. — grade C (plugin design).
- LLM self-preference (Panickssery, Bowman, Feng, NeurIPS 2024): evaluators score their
  own outputs higher than others' "while human annotators consider them of equal
  quality"; fine-tuning showed a linear relationship between self-recognition ability
  and self-preference strength; relevant to "self-refinement, reward modeling, and
  constitutional AI setups where a model judges its own work". — grade A —
  [arXiv 2404.13076](https://arxiv.org/abs/2404.13076).

### Inferences

- H7 is supported across three independent first-party accounts plus one controlled
  study on self-preference: reads parallelise, writes serialise, and the judge must not
  be the author. The "one writer at a time" rule should be enforced by the runtime
  (worktree or branch lock per build), not by prompt.
- The role sets with production evidence are small: {planner, builder, evaluator}
  (Anthropic), {builder, clean-context reviewer, stronger consultant} (Cognition),
  {implementer, task reviewer, final reviewer} (superpowers). None of them has more than
  one writer per unit of work. North's six-persona proposal is compatible if frontend
  and backend builders never write concurrently on the same branch.
- Anthropic's V2 simplification (no sprint contract, no context resets, evaluator at the
  end) and superpowers' per-task review are two defensible points; the choice is a
  cost/quality trade (per-task review is more expensive, catches cascades earlier). For
  a solo founder with an $8 journey budget, the V2 shape (one evaluator pass per
  feature, not per task) is the default; per-task review is a dial for higher
  complexity classes (H12).
- Handoff rule derived from Anthropic's four fields and Cognition's "actions carry
  implicit decisions": every handoff artifact must carry objective, output schema,
  allowed tools, boundaries, and the decisions already taken upstream (the ADR list and
  the BuildPlan), because the receiver otherwise re-decides them differently.
- Cognition's observation that read-only subagents "resemble tool calls" means North
  should not count research subagents as team members; the team is the set of roles
  that produce gated artifacts.
- Dan Luu's result that independent audit subagents scored worse, together with
  Cognition's "clean context works best" and Anthropic's "separate evaluator is a
  strong lever", resolves as: separation helps when the independent role has real
  verification power (a browser, a test runner, a diff), and hurts when it is a second
  LLM reading the first LLM's prose. The evaluator must act on the running system, not
  on the report.

### Gaps

- No vendor publishes defect-escape or first-pass-acceptance numbers for a role set;
  Anthropic reports cost and qualitative quality, Cognition reports adoption. DV1 for
  topologies is unmeasured in public.
- Factory's and Amp's role documentation does not state write permissions per role.

## KQ5. What does code review research say an agent reviewer should do, and how should reviewer independence be encoded?

### Takeaway

Across Google, Microsoft, AMD and open source, review converged on small changes, one
or two reviewers, turnaround in hours, and a purpose that is as much comprehension,
consistency and knowledge transfer as defect finding. Google's three approvals
(correctness LGTM, OWNERS, readability) are a checkable separation of concerns, and
its tie-break rule is explicit: technical facts and data overrule opinion, then
escalate. For agents, the reviewer should check a short list on a small diff against
the plan, never trust the author's report, and hand unresolved disagreements to a
deterministic test before any human.

### Cited Findings

- Google eng-practices, small CLs: "100 lines is usually a reasonable size for a CL,
  and 1000 lines is usually too large"; "A 200-line change in one file might be okay,
  but spread across 50 files it would usually be too large"; the right size is "one
  self-contained change"; "reviewers have discretion to reject your change outright for
  the sole reason of it being too large"; benefits listed: "Reviewed more quickly",
  "Reviewed more thoroughly", "Less likely to introduce bugs", "Less wasted work if they
  are rejected", "Easier to merge", "Easier to design well", "Less blocking on reviews",
  "Simpler to roll back". — grade B — [google.github.io/eng-practices, Small CLs](https://google.github.io/eng-practices/review/developer/small-cls.html).
- Google eng-practices, speed: "One business day is the maximum time it should take to
  respond to a code review request"; a typical CL should get multiple review rounds in
  a day; do not lower standards for speed; large CLs: ask to split into smaller
  dependent CLs. — grade B — [Speed of code reviews](https://google.github.io/eng-practices/review/reviewer/speed.html).
- Google eng-practices, standard: approve "once it is in a state where it definitely
  improves the overall code health of the system being worked on" "even if the CL isn't
  perfect"; "Technical facts and data overrule opinions and personal preferences.";
  when author and reviewer cannot agree "the most common way to resolve it would be to
  escalate" "to a broader team discussion, having a Technical Lead weigh in" or a
  maintainer or Eng Manager; "Don't let a CL sit around because the author and the
  reviewer can't come to an agreement." — grade B — [The standard of code review](https://google.github.io/eng-practices/review/reviewer/standard.html).
- Software Engineering at Google, ch. 9: three approvals, "A correctness and
  comprehension check from another engineer" (LGTM), "Approval from one of the code
  owners that the code is appropriate for this particular part of the codebase" (OWNERS
  files), "Approval from someone with language 'readability'"; review "Checks code
  correctness", "Ensures the code change is comprehensible to other engineers",
  "Enforces consistency across the codebase"; "It's common for almost all code reviews
  at Google to be reviewed by one and only one person."; "Only one LGTM is necessary for
  any given change."; "'Small' changes should generally be limited to about 200 lines of
  code."; readability "can be granted only by individuals who have successfully gone
  through the process". — grade B — [abseil.io SWE book ch. 9](https://abseil.io/resources/swe-book/html/ch09.html).
- Sadowski et al., "Modern Code Review: A Case Study at Google" (ICSE-SEIP 2018): "12
  interviews, a survey with 44 respondents, and the analysis of review logs for 9
  million reviewed changes". Secondary summaries report: most changes touch around 24
  lines; median one approver and fewer than 25% of reviews have more than one; median
  wait under an hour for small changes, about 5 hours for very large, overall median
  under 4 hours; developers spend roughly three hours per week reviewing. The
  motivations (education, maintaining norms, gatekeeping, accident prevention) are the
  paper's framing per secondary summaries. — grade A for the design, figures secondary
  (PDF not retrievable here) — [research.google](https://research.google/pubs/modern-code-review-a-case-study-at-google/);
  [Graphite summary](https://graphite.com/blog/how-google-does-code-review);
  [Greiler summary](https://www.michaelagreiler.com/code-reviews/).
- Bacchelli and Bird, "Expectations, Outcomes, and Challenges of Modern Code Review"
  (ICSE 2013, Microsoft): "while finding defects remains the main motivation for
  review", reviews "instead provide additional benefits such as knowledge transfer",
  team awareness and alternative solutions; "code and change understanding is the key
  aspect of code reviewing". — grade A — [Microsoft Research](https://www.microsoft.com/en-us/research/publication/expectations-outcomes-and-challenges-of-modern-code-review/).
- Rigby and Bird, "Convergent Contemporary Software Peer Review Practices" (ESEC/FSE
  2013; AMD, Microsoft Bing/SQL/Office, Google Chrome/Android, OSS): review intervals
  "on the order of a few hours to a day" versus Lucent inspections with "a median of 10
  days"; median completion 17.5 h (AMD), 14.7 / 19.8 / 18.9 h (Bing, SQL, Office),
  15.7 / 20.8 h (Chrome, Android); "Convergent Practice 3: Change sizes are small" (OSS
  medians 11 to 32 lines changed); "Convergent Practice 4: Two reviewers find an
  optimal number of defects", "the median number of reviewers is two"; "Convergent
  Practice 5: Review has changed from a defect finding activity to a group problem
  solving activity"; review increases the number of distinct files a developer knows by
  66% to 150%. — grade A — [PDF via UT Austin course page](https://users.ece.utexas.edu/~miryung/teaching/EE379K-Spring2014/Papers/Paper%204.pdf);
  [Microsoft Research page](https://www.microsoft.com/research/publication/convergent-software-peer-review-practices/).
- Google design docs (Malte Ubl, 2020-07-06): sections "Context and scope", "Goals and
  non-goals", the design centred on trade-offs, "Alternatives considered" (one of the
  most important sections), "Cross-cutting concerns" (security, privacy, observability);
  write one only when the design is ambiguous, otherwise "there is little value in going
  through the process of writing a doc"; lifecycle: rapid iteration, review, implement
  and update, revisit a year or two later; benefit: "Early identification of design
  issues when making changes is still cheap." — grade C — [industrialempathy.com](https://www.industrialempathy.com/posts/design-docs-at-google/).
- Google SRE Production Readiness Review: "a process that identifies the reliability
  needs of a service based on its specific details"; goals "Verify that a service meets
  accepted standards of production setup and operational readiness" and "Improve the
  reliability of the service in production"; sample items "Does the service report
  errors to central logging systems for analysis?", "Are all user-visible request
  failures well instrumented and monitored, with suitable alerting configured?"; "A PRR
  is considered a prerequisite for an SRE team to accept responsibility for managing
  the production aspects of a service." — grade B — [sre.google, Evolving SRE engagement model](https://sre.google/sre-book/evolving-sre-engagement-model/).
- Google SRE blameless postmortems: focus on contributing causes "without indicting any
  individual or team"; triggers include user-visible downtime beyond a threshold, "Any
  data loss", on-call intervention, resolution time above threshold, "A monitoring
  failure"; drafts are reviewed by senior engineers ("Was the root cause sufficiently
  deep?", "is the action plan appropriate"), then shared "to the widest possible
  audience that would benefit"; "Removing blame from a postmortem gives people the
  confidence to escalate issues without fear."; "You can't 'fix' people, but you can fix
  systems and processes". — grade B — [sre.google, Postmortem culture](https://sre.google/sre-book/postmortem-culture/).

### Inferences

- Review size rule for agents: the builder's unit of handoff should be one task of
  roughly 100-200 changed lines; the reviewer may reject for size alone. This is
  consistent with North's "files under 400 lines" and the superpowers task definition.
- Review purpose for agents: because defect finding is only part of the value and
  comprehension is the key aspect (Bacchelli and Bird), the agent reviewer's first
  output should be a one-paragraph restatement of what the change does and how it maps
  to the plan; a failure to restate is itself a finding (Cognition's reviewer "reasons
  backward from the implementation without the spec" for the same reason).
- Google's three approvals map onto three checkable gates in North: correctness =
  deterministic gates plus evaluator evidence; OWNERS = the persona's owned paths from
  `.claude/agents/*` (a change outside the author's owned paths needs the owning
  persona's review); readability = a fixed style/architecture checklist (Zod at
  boundaries, no mutation, file size, no path around `AuthorityEngine.gate()`).
- Google's tie-break ("technical facts and data overrule opinions") is the human-team
  form of the protocol's rule "deterministic tools decide pass or fail, models score and
  rank". Escalation to a "Technical Lead" maps to the planner, then to the founder card.
- PRR is the template for the Release gate: production only after a readiness checklist
  (preview 200, gates green for the same SHA, error reporting wired, rollback path
  tested) and the deterministic Release worker, not an LLM, applies it.
- Postmortems should be a mandatory artifact when an acceptance walkthrough fails after
  a "done": triggers (false done, data loss in sandbox, budget overrun, kill switch
  pull), a reviewed root cause, and an action item that changes a checklist or a gate,
  so that each failure converts culture into a checkable artifact (H11).

### Gaps

- The Sadowski figures are from secondary summaries; the PDF returned empty in this
  environment.
- No study measures agent-reviewer precision/recall on real diffs with a checklist
  versus free-form; this is a direct experiment North can run on its own `agent_runs`.

## KQ6. What do DORA and SPACE say about measuring an AI-augmented team?

### Takeaway

DORA 2025 (n close to 5,000) found AI adoption now correlates positively with
throughput but still negatively with delivery stability, and identified seven
capabilities that amplify AI's benefit, two of which are directly organisational for
agents: working in small batches and strong version control with frequent rollback.
No 2026 DORA report had been published as of this search. SPACE warns against
single-metric activity counts. North should record the four keys plus stability-side
measures per build and treat AI acceptance rate as a non-metric.

### Cited Findings

- DORA 2025 (2025-09-23): "Unlike last year, we observe a positive relationship between
  AI adoption on both software delivery throughput and product performance. [...]
  However, AI adoption does continue to have a negative relationship with software
  delivery stability."; "AI doesn't fix a team; it amplifies what's already there.";
  "Without robust control systems, like strong automated testing, mature version
  control practices, and fast feedback loops, an increase in change volume leads to
  instability."; "90% of survey respondents report using AI at work"; "30% report
  little or no trust in the code generated by AI". — grade A (large survey,
  correlational) — [Google Cloud blog, announcing the 2025 DORA report](https://cloud.google.com/blog/products/ai-machine-learning/announcing-the-2025-dora-report).
- DORA AI Capabilities Model (2025-09-23), seven capabilities: Clear and communicated AI
  stance; Healthy data ecosystems; AI-accessible internal data; Strong version control
  practices ("frequent commits amplify AI's positive influence on individual
  effectiveness, while the frequent use of rollback features boosts the performance of
  AI-assisted teams"); Working in small batches ("amplifies the positive influence of AI
  on product performance and reduces friction"; recommendation "Enforce the discipline
  of working in small batches"); User-centric focus (its absence "can make AI adoption
  harm team performance"); Quality internal platforms. — grade A/B —
  [Google Cloud blog, DORA AI Capabilities Model](https://cloud.google.com/blog/products/ai-machine-learning/introducing-doras-inaugural-ai-capabilities-model).
- DORA 2024 is referenced by the 2025 announcement only as "Unlike last year" on
  throughput; the 2024 finding that AI adoption correlated with lower throughput and
  stability is therefore attested indirectly here (the 2024 report itself was not
  fetched). No DORA 2026 report was found; a DORA ROI report was listed as "coming
  soon" (secondary, [dora.dev/ai/roi/report](https://dora.dev/ai/roi/report)). A
  third-party analysis citing "+441% time in PR review" and "+242.7% incidents per PR"
  could not be verified against DORA and is marked unverified.
- SPACE (Forsgren, Storey, Maddila, Zimmermann, Houck, Butler, ACM Queue 2021): five
  dimensions, Satisfaction and well-being, Performance, Activity, Communication and
  collaboration, Efficiency and flow; the authors state the example metrics are
  "examples, not recommendations" (secondary primer). — grade B (secondary) —
  [DX, SPACE framework primer](https://getdx.com/blog/space-framework-primer/);
  [GitHub blog, 2021-03-10](https://github.blog/enterprise-software/devops/measuring-enterprise-developer-productivity/).
- Vaccari (Thoughtworks, 2025-07-31): "The common metric of AI code acceptance has big
  hole". — grade C — [martinfowler.com, Exploring Gen AI](https://martinfowler.com/articles/exploring-gen-ai.html).

### Inferences

- The DORA stability finding is the population-level version of the founder's observed
  failure (fast "done", broken product). The organisational countermeasures DORA names
  (small batches, rollback, fast feedback, user focus) are exactly the four that the
  topology must hard-wire: task-sized commits, preview deploy per commit, evaluator on
  the running preview, acceptance criteria written from the user's walkthrough.
- For an agent team the four keys need redefinition: lead time = idea to verified
  vertical slice (DV3); deployment frequency = preview deploys per feature; change
  failure rate = features that fail evaluator or founder walkthrough after builder
  "done" (DV1 inverse); time to restore = fix-round wall clock. Add SPACE-style
  satisfaction as founder review minutes and decision cards per feature (DV4).

### Gaps

- DORA data are human-team surveys; no equivalent dataset exists for agent teams.
  North's `agent_runs` and evidence tables would be one of the first.

## KQ7. Synthesis for the debate round: role set, workflow, escalation, metrics, verdicts, open questions

### Takeaway

The evidence supports a five-role LLM team plus one deterministic worker, with exactly
one writer per build at a time, an evaluator and a reviewer that are structurally
independent of the builder (context, tools, budget, rubric), artifact handoffs that carry
upstream decisions, a deterministic tie-break, and the founder consulted at architectural
forks plus a bounded review queue at feature boundaries. This extends, and in four places
corrects, the current `dept-engineering.md` proposal.

### Cited Findings

(Synthesis; sources are those cited in KQ1-KQ6. Critique targets are the repo files
`docs/research/dept-engineering.md` section "Personas" and `.claude/agents/*.md`, read
2026-10-17.)

#### (1) Proposed role set, ownership, permissions, independence rules

| Role | Analogue | Owns (artifact of record) | Read | Write | Approve / veto | Independence rule |
| --- | --- | --- | --- | --- | --- | --- |
| Planner (tech lead) | Brooks' architect; Amazon single-threaded owner; Netflix informed captain | `BuildPlan` (feature list with acceptance criteria, deps, spec IDs), ADRs, task briefs | repo, memory, spec | `docs/plans`, `docs/adr`, `agents/engineering/*.yaml` briefs only; never `src` | Rules on builder-vs-reviewer disagreements below the architectural line; cannot approve done | Must restate upstream founder decisions in every task brief (Cognition "actions carry implicit decisions"); budget per feature = appetite, not estimate (Shape Up) |
| Builder (one per active branch; frontend or backend profile by owned paths) | Brooks' surgeon; Majors' owner | commits on `build/<id>`, local gate run, self-report | plan, repo, docs | its owned paths only (OWNERS); one writer per branch at a time, enforced by worktree lock | None. May emit `halt` (andon) | Never marks done; never edits tests outside its task; never edits evaluator rubric or gate config |
| Evaluator (QA) | NASA IV&V; DO-178C independent verifier | `TestReport` with evidence rows (screenshots, HTTP, DB probes) against the deployed preview | preview URL, acceptance criteria, gates JSON; **not** the builder's report or chat | tests in a separate test package only (Jamie Brandon pattern); nothing in `src` | Veto on done; `halt` | Fresh context every run; no write tools on `src`; platform-fixed rubric and budget the planner cannot change; evaluates end state, not process (Anthropic) |
| Reviewer (code and security) | Google LGTM + readability; kernel `Reviewed-by`; two-person concept | `ReviewReport` with checklist items pass/fail/n.a. and "declined to judge" list | diff by SHA range, plan, checklist; **not** the builder's report | none | Block on CRITICAL/HIGH; otherwise advisory to planner | Clean context (Cognition); reviewer != author; cannot approve its own suggested fix; may reject on size alone (>200 lines) |
| Consultant (stronger model, optional) | Amp oracle; Cognition "Smart Friend"; Google TL in escalation | written opinion appended to the ledger | fork of the asking role's full context | none | none; advisory | Invoked only on escalation level 2 (below) or by complexity class |
| Release (deterministic worker code) | SRE PRR; Toyota line restart | PR, preview deploy, go-live decision card | gates JSON, evidence, SHA | GitHub/Vercel/Supabase adapters via `AuthorityEngine.gate()` | Only path to production; K2 card required | Not an LLM; readiness checklist in code |
| Founder | Captain (CRM); Amazon disagree-and-commit | decision cards, review-queue picks, kill switch | everything | nothing in the pipeline | Final on architectural forks and production | Quota 3 cards/day, review queue 5 items/10 min (protocol section 6) |

Corrections to the current proposal:
1. `north-qa-validator` today has `Write, Edit` and "writes missing unit/integration/E2E
   tests" in the same owned paths it then verifies. Under IV&V and DO-178C that is not
   independent. Restrict its writes to a separate test package and deny `src`.
2. The dept-engineering evaluator has technical independence (fresh context, read-only
   fs) but its budget ($1.00) and rubric are set in the same table the planner reads.
   Make the evaluator's budget and rubric platform constants per complexity class.
3. Frontend and backend builders are both writers; the proposal does not say they cannot
   run concurrently on one branch. Add a single-writer lock per `build/<id>` (worktree
   isolation per subagent in Claude Code terms), with parallelism allowed only across
   disjoint branches that merge through Release.
4. No role may stop the line except the founder. Add a `halt` output to every LLM role
   and a planner obligation to respond before restart (andon), plus a mandatory
   postmortem artifact after any false "done" (SRE triggers).

#### (2) Workflow as artifact handoffs (text diagram)

```
Founder idea
  -> [Planner] BuildPlan.json (features, acceptance criteria, deps, spec IDs, appetite $, ADR refs)
       |  Zod-validated; every feature has evaluator-executable steps
  -> [Planner] TaskBrief_n.md (objective, output schema, allowed tools, boundaries,
       |  upstream decisions restated, owned paths, test that proves it)
  -> [Builder] commits on build/<id> (one logical change per commit, task ID + persona
       |  + test name in message; <= ~200 lines; local gates green) + SelfReport_n.md
       |  (treated downstream as unverified claims)
  -> [Release worker] preview deploy for SHA; gates.json (typecheck, lint, build,
       |  unit, integration, Playwright smoke) stored as artifact
  -> [Evaluator] TestReport_n.json against preview URL: per criterion pass/fail +
       |  evidence row (screenshot, HTTP status, DB row); never reads SelfReport
       |     fail -> FixBrief_n.md back to Builder (round R; R<=3 same builder,
       |             R>=4 fresh builder / stronger model; R=5 breaker trips -> Planner)
  -> [Reviewer] ReviewReport_n.json over diff(base..head): checklist items
       |  (gate() path, RLS, Zod boundaries, no mutation, file size, secrets,
       |  structural vs behavioural commits, size) + "declined to judge" list
       |     CRITICAL/HIGH -> FixBrief; disagreement -> escalation ladder (3)
  -> [Release worker] readiness checklist (PRR): preview 200 + gates green for same
       |  SHA + TestReport all pass + ReviewReport no open HIGH -> PR; production
       |  only after founder K2 card
  -> [Founder] review queue: variant pick / walkthrough; decision card only for
       |  architectural forks or production
  -> on false done / kill switch / budget breach: Postmortem_n.md (trigger, root
       cause reviewed by Planner, action item that edits a checklist or gate)
```

Rules on the arrows: no role reads another role's chat; every arrow is a file with a Zod
schema and a SHA; parallel arrows exist only for read-only research subagents (not team
members) and for builders on disjoint branches.

#### (3) Escalation and conflict rules

- Level 0, deterministic tie-break: if a disagreement can be settled by a test, gate or
  probe, the role that asserts a fact must produce it (Google: "Technical facts and data
  overrule opinions"; Luu: "forced checking"). The result is final.
- Level 1, planner ruling: disagreements not settled by a tool (design choice within
  the plan, reviewer MEDIUM/LOW findings, scope questions) go to the planner, who rules
  and logs `Ruling: what, why, cost if wrong` (superpowers pattern; Netflix informed
  captain). Dissenting roles disagree and commit; the dissent stays in the ledger.
- Level 2, consultant: if the planner's ruling would change an ADR or the reviewer
  holds a HIGH finding against the ruling, a stronger-model consultant with a full
  context fork gives a written opinion (Cognition "Smart Friend"); the planner rules
  again.
- Level 3, founder decision card: only for architectural forks (anything that would
  create or supersede an ADR, change the stack, add an integration, spend above the
  feature appetite, or go to production). Cards are capped at 3/day; everything else
  is a review-queue item, not a card.
- Hard vetoes that no ruling overrides: evaluator fail on an acceptance criterion;
  reviewer CRITICAL/HIGH; any `halt`; Release readiness checklist; the kill switch.
- Circuit breaker: when a feature exhausts its appetite (dollars or fix rounds) it
  stops, is re-planned or cancelled by the planner, and is reported in the review queue;
  it is never silently extended (Shape Up; superpowers R=5 breaker).
- Blameless postmortem after every false done, with an action item that changes an
  artifact (checklist, gate, brief template), reviewed by the planner (SRE).

#### (4) Team metrics to record (per feature and per build, in `agent_runs` and evidence)

- DORA four keys redefined: lead time (idea to first verified vertical slice, DV3);
  deployment frequency (preview deploys per feature); change failure rate (features
  failing evaluator or founder walkthrough after builder done, inverse of DV1); time to
  restore (fix-round wall clock).
- Stability side (DORA 2025 finding): regressions found by nightly journey after later
  features (DV5); rollbacks used.
- Review metrics (Google, Rigby and Bird): lines changed per commit, review turnaround,
  findings per report by severity, reviewer rejections for size, false-positive rate of
  findings (overruled at level 0).
- Independence metrics: evaluator fail rate on builder "done" (how often the second
  person catches the first), evaluator-vs-founder disagreement rate (evaluator
  leniency), reviewer-vs-evaluator disagreement rate.
- Founder attention (DV4, SPACE satisfaction): cards per feature, review-queue items,
  review minutes, clarifying questions.
- Cost (DV2): dollars per accepted feature by role; share spent on fix rounds; breaker
  trips.
- Non-metrics: lines generated, AI code acceptance rate (Vaccari), number of tests
  written by the builder.

#### (5) Hypothesis verdicts

- H7 (parallel only for read-heavy independent work; one writer for coupled
  write-heavy work): **supported, grade B**. Cognition 2026 ("writes stay
  single-threaded"), Anthropic ("fewer truly parallelizable tasks" in coding; lead agent
  alone writes), LangChain, Claude Code's read-only Explore/Plan agents, Brooks'
  surgical team. Counter-evidence: none found for parallel writers on coupled code; the
  Thoughtworks "accidental blackboard" memo shows agents will invent coordination if
  shared writes are allowed, which is a warning rather than support.
- H10 (planner / builder / evaluator split, founder only at architectural forks):
  **supported for the split, grade B; unproven for "founder only at forks", grade C,
  with contrary evidence**. For: Anthropic's harness ("Separating the agent doing the
  work from the agent judging it proves to be a strong lever"; self-grading "reliably
  skew positive"), Panickssery et al. (A) on self-preference, Cognition's clean-context
  review loop, superpowers and agentic-sdlc adopting reviewer != author. Against the
  strong form: Luu's loops "degrade in productivity over time" without a human at the
  keyboard and his independent-audit runs scored worse; Karpathy's "watch them like a
  hawk"; DORA's stability finding. Compatible form: founder at forks plus a bounded
  review queue at every feature boundary, and evaluators that act on the running
  system rather than read reports. Also note Anthropic itself dropped sprint contracts
  and context resets in V2, so those ceremony details are not part of the supported
  core.
- H11 (large-company practice transfers only as checkable artifacts): **supported,
  grade B overall, with one grade-A anchor**. Haynes 2009 (checklist cut mortality
  1.5% to 0.8%), DO-178C objectives tables and NASA's three independences (structural,
  not cultural), Google's three approvals and size thresholds, kernel tags with defined
  meanings, DORA's capabilities (small batches, version control) as practices rather
  than attitudes, Carmack ("Exhortations ... just don't cut it"), Luu (naming a
  technique in a prompt or skill did not produce it; structure did "ok-ish"), and the
  Spotify failure as the negative case (culture without accountability artifacts).
  Against: none found; the risk is that checklists ossify, which the postmortem action
  item is meant to counter.
- Side verdicts: H1 (independent evaluator with real browser) supported B by Anthropic
  and Cognition, qualified by Luu's finding that independence without verification power
  does not help; H6 (fresh context per feature) is contested by Anthropic V2, which ran
  one continuous session with compaction and dropped resets, so RQ4/RQ6 should weigh
  this.

#### (6) Open questions for the debate round

1. Per-task review (superpowers) versus one evaluator pass per feature (Anthropic V2):
   which point on the cost/quality curve fits an $8 founder journey, and should
   complexity class (H12) move the dial?
2. Is a second LLM reading a diff ever "independent" in the DO-178C sense, or should the
   reviewer be limited to checklist items that a tool can confirm, with the rest
   delegated to deterministic gates? Luu's audit result suggests the latter.
3. Can the evaluator's managerial and financial independence be real inside one product
   (same vendor, same orchestrator), or is "platform constant the planner cannot edit"
   the best available approximation?
4. Should frontend and backend builders exist as two personas at all, or is one builder
   with two skill profiles (Brooks' single surgeon) safer given the single-writer rule?
5. Where exactly is the architectural line that converts a planner ruling into a founder
   card? Proposed test: "would this create or supersede an ADR, add an integration,
   exceed the appetite, or touch production?" The debate should attack the boundary
   cases (stack-internal library choice, schema change, pricing page copy).
6. Luu's "loops degrade" versus North's autonomy promise: is a review-queue touch at
   every feature boundary enough human-at-the-keyboard, or does the founder need a
   mid-build checkpoint for higher complexity classes?
7. What is the minimum postmortem that an agent team will actually complete, and who
   verifies the action item changed an artifact?
8. Should the Consultant (stronger model) be a standing role or an escalation-only
   tool? Cognition found it works frontier-to-frontier but not with a weaker primary.

### Inferences

- The six-role shape above is the intersection of the vendor role sets with the
  safety-critical independence rules; it adds nothing that lacks either a first-party
  agent account or a human-team precedent.
- The four corrections to the current proposal all follow from a single principle the
  evidence keeps repeating: independence and discipline must be properties of the
  runtime and the artifacts, not of the persona prompt.

### Gaps

- No public data measures first-pass acceptance (DV1) for any agent topology; North
  should treat its own `agent_runs` and evidence rows as the experiment and record the
  independence metrics in (4) from the first milestone.
- Sources not reachable in this environment: the Sadowski PDF, the New Yorker
  Dean/Ghemawat profile, Karpathy's bearblog post, the RTCA DO-178C text, the DORA 2024
  report itself, and any DORA 2026 report (none found).
