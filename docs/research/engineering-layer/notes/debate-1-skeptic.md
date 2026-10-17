# Debate round, reviewer 1: the Skeptical Methodologist

Status: round-2 critique, 2026-10-17. Inputs: `01-research-protocol.md` and the eight
round-1 notes `notes/RQ1-*.md` to `notes/RQ8-*.md`. Grading scale as in the protocol
(A controlled study or measured production data; B vendor documentation or first-party
account; C practitioner essay; D anecdote or forum). Three outside checks were made
(Vercel post, METR reward-hacking post, Urbach 2014); everything else attacks the notes
on their own text.

Summary verdict: the notes are unusually honest about gaps (every note has a "no
controlled comparison" line for its own hypotheses), but the synthesis sections then
build blueprints on the same evidence as if it were settled, and the grades drift upward
between a note's "Cited Findings" and its "Hypothesis verdicts" table. Of twelve
hypotheses, I find two supported (H2 clause 1, H9 in its narrowed form H9'), six
weakened, one effectively refuted in its stated form (H9 broad), and three undetermined.
Nothing in the corpus measures DV1 (first-pass acceptance) for any topology, plan format
or verification regime. The blueprint will be built on mechanism and vendor practice,
and should say so in every rule.

---

## 1. Systematic problems with the evidence base

### 1.1 Grades are not applied consistently across notes

| Source | Grade in one note | Grade in another | Comment |
| --- | --- | --- | --- |
| Chroma "Context Rot" | A — `RQ4` §Q6 Cited Findings | B — `RQ6` §KQ2 ("vendor research... few accuracy deltas published") | RQ6 is right. A vendor of a vector database publishing that long context fails is B with an incentive flag. |
| Cognition "Don't build multi-agents" | C — `RQ4` §Q3, `RQ6` §KQ3 | B — `RQ7` §KQ4 (both the 2025 and 2026 posts) | Same document, two grades. It is a product company's essay with no numbers: C. |
| Vercel AGENTS.md eval | A-/B — `RQ2` §KQ4, §KQ7 | B — `RQ6` §KQ6 | I fetched the post: no task count, no model named, "with retries" with no count. That is B at best, and the author sells the framework whose docs the AGENTS.md carried. |
| SPOQ (arXiv 2606.03115) | A-/B — `RQ2` §KQ6, §KQ7 | not cited elsewhere | Self-reported preprint, author-defined metrics, "granularity score came from a search snippet". C until replicated. |
| MAST (Cemri et al.) | A — `RQ4` §Q3, `RQ6` §KQ3 | — | A for the trace annotation (κ 0.88). But the +9.4/+15.6 interventions are on ChatDev with GPT-4o on ProgramDev, no single-agent control (`RQ6` §Synthesis (2) says so). The intervention numbers are B. |
| Haynes 2009 checklist | A, "the one grade-A result" — `RQ7` §KQ2; "grade-A anchor" for H11 — `RQ7` §KQ7 (5) | — | Before-after, eight hospitals, Hawthorne-exposed. See §2 H11 for the null replication the note omits. |
| Anthropic harness runs ($9 vs $200) | "A for measured runs, n=1 each" — `RQ4` §Q2 | B — `RQ2` §KQ1, `RQ5` §KQ3 | n=1 per arm, author-graded, no variance. Cannot be A under the protocol's own definition. |

Rule I propose for round 3: a source keeps the lowest grade any note gave it unless the
synthesis writer records why the higher grade is justified.

### 1.2 Grade inflation between "Cited Findings" and "Verdicts"

- `RQ8` §KQ5 grades Cursor's judge removal "B for the account, D for causality", then its
  Takeaway and §Hypothesis verdicts call it "the strongest single datum for H1". The same
  note's §KQ1 quotes the HN commenter: "CI success was not part of PR accept criteria at
  any point." If CI was never a gate, 247/160,469 green runs measures a policy choice,
  not the absence of a judge. The datum is confounded and D-grade.
- `RQ1` §KQ2 Inferences: "Treat the 3-5 cap as a convention supported by proxy evidence,
  not a measured optimum." `RQ1` §Design proposals then fixes "Max 7 questions in round
  1" plus a later round of 3, i.e. up to 10, and the verdict row grades the cap B.
- `RQ3` §KQ4 says H3 is "strong practitioner consensus, one unretrieved industrial case
  study, no controlled experiment" (C), then §Synthesis (2) makes "walking skeleton
  before any horizontal layer" universal across every matrix row and `RQ5` §Regime makes
  "first test is e2e against real infrastructure" invariant I11. A C-grade claim became
  a non-negotiable without passing through round 2.
- `RQ6` §KQ6 reports ClarifyGPT and AgentCoder figures as "from memory, not confirmed";
  `RQ1` §KQ2 grades ClarifyGPT A and the H4 verdict leans on it. One of the two notes
  fetched it; the other did not say which.

### 1.3 Factual slips I could check

- `RQ6` §KQ5 Gaps: "The reported 30.4% (39/128) o3 figure on one blog conflicts with
  METR's 1–2% and is unverified." I fetched the METR post
  (https://metr.org/blog/2025-06-05-recent-reward-hacking/): RE-Bench 39/128 = 30.4%,
  HCAST 8/1,087 = 0.7%, and the post does not state an overall 1–2%. There is no
  conflict; 1–2% is the April o3 report's all-task aggregate and 30.4% is the RE-Bench
  subset. `RQ5` §KQ2 had it right. The blueprint should carry both numbers because the
  gap between them (visible scorer vs not) is the whole point.
- ETH context-file study: `RQ2` §KQ4 read the primary paper (+2.4% developer-written,
  p = 0.21); `RQ6` §KQ6 read coverage ("~+4%") and flags it secondary. Round 3 must use
  RQ2's numbers.
- `RQ4` §Q3 cites Karpathy's eight-agent experiment from a search-indexed title that is
  truncated mid-sentence ("but it's still very"), page HTTP 402, date unverified, graded
  D; the same note's H7 verdict row quotes it as evidence. Delete from any verdict.

### 1.4 Benchmark contamination undermines the benchmark-based numbers the notes lean on

`RQ5` §KQ2 and `RQ6` §KQ1 record that 63% of successful SWE-bench Pro resolutions were
retrieval (Cursor), 76% file-path recall from issue text alone (SWE-Bench Illusion),
32.67% leaked solutions (SWE-Bench+), and a secondary claim that 59.4% of SWE-bench
Verified failures were test flaws. The notes then use SWE-bench-derived rates elsewhere
without discount: ImpossibleBench's "stronger models cheat more" is on SWE-bench
variants; OpenHands' +5.8 critic gain (`RQ4` §Q5) is SWE-bench Verified; the horizon and
leaderboard figures in `RQ6` §KQ1 are aggregator numbers marked unverified. A model that
retrieves the gold patch will also "cheat" more on a contradicting test. The direction
of these findings survives; the magnitudes should not be quoted in the blueprint.

### 1.5 Survivorship and selection in the product evidence

`RQ8` §KQ2 derives "six systemic complaints" from Trustpilot, HN and vendor forums, all
complaint channels with no denominator; the note itself records Lovable at 4.2/5 from
1,834 reviews and warns "Trustpilot samples are self-selected". The whole research
program is motivated by one founder's observed failure (`01-research-protocol.md` §0),
which is an n=1 anecdote about tools from 2025. `RQ8` §KQ5 also notes that the products
asking zero questions have the largest user bases. The notes treat complaint prevalence
as failure prevalence; nothing in the corpus gives a base rate of false "done" per
feature in any product except Replit's talk-derived ">30% of features broken" (ZenML
summary of a conference talk, secondary, `RQ8` §KQ1).

---

## 2. Hypothesis-by-hypothesis attack

Format: evidence for / against as the notes cite it; my re-grade; confounds.

**H1 — independent evaluator with real browser and fresh context raises DV1 more than any amount of self-review.**
- For: self-grading skews positive (Anthropic Mar 2026, B, n=1 app, author-tuned over
  "several rounds"); self-preference bias (Panickssery NeurIPS 2024; Wataoka; A, but on
  text judging, not code); intrinsic self-correction lowers accuracy (Huang ICLR 2024,
  A, on GSM8K/CommonSenseQA, not code); MAST +15.6 from a verification role (B, see 1.1);
  Cursor 247/160,469 (D, confounded, 1.2). Sources: `RQ5` §KQ3, `RQ6` §KQ3, `RQ4` §Q2,
  `RQ8` §KQ5.
- Against: Dan Luu's 160-run experiment, "42 used an independent agent, but these runs
  actually scored worse" (`RQ7` §KQ3, C/A, one model one task); the Anthropic evaluator
  "still misses deep bugs" and Claude "would talk itself into deciding they weren't a
  big deal" (`RQ5` §KQ3); LLM monitors catch 42–50% of cheating on repo-scale tasks
  (`RQ6` §KQ3); nobody has shipped the configuration (`RQ8` §Gap analysis 1).
- Re-grade: B for direction, no grade for magnitude. The phrase "more than any amount of
  self-review" is an unbounded quantifier and cannot be tested.
- Confound: `RQ5` §KQ3 itself amends H1 to "deterministic checks decide and the model
  vetoes". Under that amendment the thing that raises DV1 is the deterministic
  acceptance suite run on a deployed preview; the LLM evaluator is a search heuristic for
  what to check. That is a different hypothesis (see §4).

**H2 — mock-heavy builder-written suites are a leading indicator of false done; deployed-preview evidence removes most false dones.**
- For, clause 1: test modification is >79% of Claude's cheating on ImpossibleBench (A);
  METR special-casing and scorer tampering (A); Claude 3.7 system card (B); LLM oracles
  mirror the implementation (Konstantinou; Mathews & Nagappan; A); Google ch. 13 (B);
  converging D anecdotes in `RQ8` §KQ2. Sources: `RQ5` §KQ2, `RQ6` §KQ5.
- Against, clause 1: what is measured is test *modification* and *special-casing*, not
  *mocking*. No source gives the conditional probability P(false done | mock-heavy suite)
  versus P(false done | real-infra suite). "Leading indicator" is a claim about
  predictive power with no base rate anywhere in the corpus.
- Clause 2: every note that touches it says unmeasured (`RQ5` §KQ4 Gaps, `RQ6` §Synthesis
  (2), `RQ8` §KQ5). ImpossibleBench adds a cost the notes under-weight: hiding tests
  gave "lower legitimate performance" (`RQ6` §KQ5).
- Re-grade: clause 1 A for the mechanism "builder-controlled tests get tampered"; C for
  "mock-heavy predicts false done"; clause 2 ungraded. Restate as H2' (§4).

**H3 — walking skeleton first yields fewer integration failures and earlier feedback than layer-first.**
- For: Cockburn (page 404, quoted via secondaries), GOOS (secondary summaries), Humble &
  Farley ("pipeline first" wording not verified), Hunt & Thomas (not fetched), Bogard,
  Fowler, Anthropic docs. All C. `RQ3` §KQ4.
- Against: none, because nothing measured exists. Mellegård 2018 unretrieved.
- Re-grade: C, honestly stated by RQ3 and then promoted by `RQ3` §Synthesis and `RQ5`
  §Regime (see 1.2). Note also an internal tension: GOOS's first e2e test "may stay red
  during development" (`RQ3` §KQ4) while `RQ5` §Regime G2–G3 require green deterministic
  gates per commit. The blueprint must say which rule wins while the skeleton is red.
- Confound: for an agent builder, e2e-first mostly addresses the H2 failure mode (fake
  tests), not integration failure. The two hypotheses are being credited with the same
  mechanism.

**H4 — a bounded set of decision-oriented clarifying questions beats zero and open interviews on DV1 per founder-minute.**
- For: asking beats guessing (HumanEvalComm, ClarifyGPT, Ask-or-Assume; A on function-
  level benchmarks with simulated users); over-asking hurts (Okanagan 65→27; A); VoI
  framework (A, four non-coding domains); Spec Kit caps (B); Devin green-confidence
  sessions merge 2x (B, correlational). `RQ1` §KQ2, `RQ8` §KQ5.
- Against: `RQ1` §KQ2 Gaps: "No study of clarification budgets for non-technical users
  of app builders"; `RQ1` §Open questions 8: the LLM studies "none measure a human's
  willingness to answer or a product's acceptance"; `RQ1` §KQ1: Wiegers says a document
  "cannot replace human dialogue"; `RQ8`: zero-question products dominate the market.
  HumanEvalComm's own abstract and introduction report inconsistent deltas (`RQ1` §KQ2).
- Re-grade: A that *some* asking beats none on benchmark tasks; nothing above D for
  "bounded beats open" or for any per-founder-minute measure. The cited B support for a
  3–5 cap includes Claude Code's interview prompt "Keep interviewing until we've covered
  everything" (`RQ1` §KQ3), which is explicitly uncapped. Devin's confidence-to-merge
  correlation is confounded by task difficulty (easy tasks are both green and mergeable).

**H5 — machine-checkable plan outperforms prose plans for multi-session execution on DV5 and DV6.**
- For: Anthropic "model is less likely to inappropriately change or overwrite JSON than
  Markdown" (one sentence, no numbers, B); sprint contracts (B); SPOQ (self-reported,
  see 1.1); Claude Code spec advice (B); Kiro/Spec Kit design (B/C). `RQ2` §KQ1, §KQ7,
  `RQ8` §KQ5.
- Against: `RQ2` §KQ7: "no controlled A/B of a prose plan vs a structured plan with the
  same content"; Thoughtworks "over-formalized specs can cause unnecessary trouble" (C);
  Anthropic *removed* sprint contracts in V2 when the model improved (`RQ2` §KQ1), which
  is evidence the contract layer was compensating for the model, not that the format
  moves outcomes; every mass-market product ships prose plans (`RQ8` §KQ5).
- Re-grade: B for "a plan that a script can check is checkable" (near-tautology); C for
  any outcome claim. The "JSON vs Markdown" sentence should not be cited as format
  evidence; it is one author's impression.
- Circularity: DV6 (spec drift) is defined in the protocol as traceability of spec IDs to
  tests and evidence. A prose plan cannot be scored on DV6 at all, so H5 wins DV6 by
  construction. Only DV5 (regression) is a fair comparison.

**H6 — fresh context per feature plus durable progress artifacts beats one long session.**
- For: Liu TACL 2023, NoLiMa ICML 2025, RULER COLM 2024, Laban 2025 (A for degradation
  with length and turns); Anthropic Nov 2025 harness (B); Claude Code "clean session
  almost always outperforms" (B). `RQ4` §Q6, `RQ6` §KQ2.
- Against: Anthropic Mar 2026 V2 "drop context resets from this harness entirely" and ran
  "one continuous session across the whole build" (`RQ7` §KQ4, which explicitly says H6
  "is contested by Anthropic V2"); Cognition runs a single thread with a fine-tuned
  compressor in production (C); Karpathy reports "significantly higher... long-term
  coherence" since Dec 2025 (C). `RQ6` §KQ2 Gaps: Laban's sharded setting "simulates a
  chat user, not an agent loop with tool outputs"; NoLiMa/RULER are needle retrieval.
- Re-grade: premise (context degrades) A but wrong domain; remedy (fresh session vs
  compaction) undetermined, and the model-generation trend in the only agent-build
  account runs against it. `RQ4` §Deliverable 4 "Supported" and `RQ7` "contested" cannot
  both go into round 3 unchanged.
- Confound: "fresh context per feature" bundles bounded task size with fresh context.
  Laban's measured remedy is *consolidating requirements into one instruction* (59.1 →
  90.9), which supports a consolidated spec, not a session boundary.

**H7 — parallel subagents pay off only for independent, read-heavy work; one writer for coupled work.**
- For: Anthropic (+90.2% on research, coding "fewer truly parallelizable tasks"; B),
  Cognition 2025/2026 (C), LangChain (C), MAST (A for traces, no single-agent control),
  Claude Code docs (B). `RQ4` §Q3, `RQ6` §KQ3, `RQ7` §KQ4.
- Against: Kiro "tasks within a wave execute concurrently" and Spec Kit `[P]` markers
  (`RQ2` §KQ6) are shipping parallel writers; `RQ7` §KQ4's "None of them has more than
  one writer per unit of work" ignores them. Cursor's self-driving experiment ran many
  writers for a week (`RQ8` §KQ1), outcome unmeasured against a serial control.
- Re-grade: B/C convergent opinion; no A. As written the hypothesis is close to
  definitional: "coupled" work is work whose parallelisation costs coordination, so
  "parallel pays off only for independent work" cannot fail. The notes' agreement
  between Anthropic and Cognition is agreement on a tautology plus a shared commercial
  interest in selling one orchestrated product. See §4 for a falsifiable version.

**H8 — no methodology is universal; a small invariant core is universal, the rest selected by a decision matrix.**
- For, half 1: TDD meta-analyses and replications null or small (A, human subjects);
  typing 15% / "exceedingly small" (A, contested); canon authors disagree in writing
  (C). `RQ3` §KQ1, §KQ5.
- Against, half 2: `RQ3` §Synthesis (4): "The *content* of the core is a proposal; no
  study validates that specific list." Five of the thirteen invariants (I1, I2, I5, I6,
  I7) are North's existing CLAUDE.md rules marked ◆. The hypothesis is being used to
  ratify rules the repo already has.
- Re-grade: half 1 A (and the strongest negative result in the corpus); half 2 ungraded
  and unfalsifiable as stated. Note the TDD null is from *human* experiments, which
  `RQ3` §Open questions 3 concedes; `RQ5` §KQ6 and `RQ3` both use it to drop unit-level
  TDD while `CLAUDE.md` §Working rules mandates TDD and Spec Kit's constitution makes
  test-first "NON-NEGOTIABLE" (`RQ2` §KQ2). Round 3 must resolve this against the repo
  rule, not around it.

**H9 — always-on documentation infrastructure raises accuracy more than optional skills.**
- For: Vercel 100% vs 53%/53%, skill never invoked 56% (B, n/model/retries unstated,
  confirmed by fetch); UCSB/MIT 49% skill load rate (secondary); Claude Code docs (B).
  `RQ2` §KQ4, `RQ6` §KQ6.
- Against the broad form: ETH CTXbench, +20% cost, no significant gain, LLM-generated
  files slightly worse (A, 138 + 300 tasks, four agents). Vendor caps on file length
  (B). No evidence at all that ADRs or spec IDs raise accuracy (`RQ2` §KQ7).
- Re-grade: broad form refuted at A; narrowed form H9' ("short, non-inferable,
  always-on index beats optional skills *for knowledge the model lacks*") supported at B
  on one unquantified vendor eval. The reconciliation in `RQ2` §KQ4 Inferences (Vercel
  injected unknown APIs, ETH injected inferable overviews) is plausible but is the
  authors' post-hoc reading, not a tested moderator.
- Incentive flag: ETH's +20% cost finding is also an argument for "no CLAUDE.md"; the
  notes keep CLAUDE.md anyway because North's own file is 60 lines. Fine, but say it is
  a cost decision, not an accuracy finding.

**H10 — planner / builder / evaluator split, founder consulted only at architectural forks.**
- For the split: Anthropic V2 kept planner and evaluator (B, n=1); self-preference
  (A, indirect); superpowers and agentic-sdlc adopt reviewer != author (C, plugin
  design, no outcome data). `RQ4` §Deliverable 4, `RQ7` §KQ4.
- Against "founder only at forks": Luu "loops... degrade in productivity over time"
  without a human at the keyboard (C); Karpathy "watch them like a hawk" (C via news);
  `RQ4`: "no source measures the 'architectural forks only' cadence"; cost 22x solo in
  the one measured case; the Anthropic evaluator needed a human to tune its prompt over
  several rounds, so the published result is not founder-free.
- Re-grade: split B; founder cadence C with contrary C. `RQ7` §KQ7 (5) states exactly
  this; `RQ4` §Deliverable 4 says "Supported" for the whole hypothesis. Carry RQ7's
  version.

**H11 — large-company practices transfer only when converted into checkable artifacts.**
- For: Holzmann's design premise (B); Google test sizes, CL size, flake budget (B);
  Amazon ORR (B); Packwerk (B); Claude Code "advisory vs deterministic" (B); Haynes
  2009 "grade-A anchor" (`RQ7` §KQ7); Luu: naming a technique in a prompt did not make
  agents perform it (C/A, one model). `RQ3` §KQ2–3, `RQ7` §KQ2–3.
- Against, which the notes omit: Urbach et al., NEJM 2014, 101 Ontario hospitals,
  109,341 procedures before and 106,370 after mandatory checklists, adjusted mortality
  0.71% → 0.65%, OR 0.91 (95% CI 0.80–1.03, p = 0.13), complications 3.86% → 3.82%
  (https://doi.org/10.1056/NEJMsa1308261; coverage at
  https://psnet.ahrq.gov/node/43042/psn-pdf). The checklist literature is contested at
  population scale; Haynes is eight hospitals, before-after, with the Hawthorne effect
  uncontrolled. Haynes cannot anchor anything.
- Survivorship: `RQ3` §Synthesis (4) admits "the evidence is that every successful
  transfer observed took artefact form". Cultural transfers that worked would leave no
  artefact to observe. The hypothesis as stated ("only when") is unfalsifiable from this
  evidence.
- Re-grade: B for the agent-specific sub-claim "structural controls beat prompt
  instructions" (METR prompts moved hacking 80% → 70–95%; ImpossibleBench read-only
  tests stop modification; ETH: a tool named in a context file is used 1.6x per instance
  vs <0.01x — agents follow explicit instructions). That sub-claim is stronger than the
  grand "culture to artefact" thesis (see §7).

**H12 — complexity class classified at intake selects methodology.**
- For: DO-178C levels select objective counts (B/C, regulatory precedent with no outcome
  measurement); BMAD levels, Kiro Quick vs Feature Spec (B, vendor design); tenancy and
  payments are expensive to retrofit (C). `RQ1` §KQ4, `RQ3` §KQ5.
- Against: `RQ1` §Verdicts: "D/none for a validated archetype classifier or measured
  effect"; `RQ3` §Synthesis (4): "No evidence yet on which classification boundaries
  matter"; `RQ1` §Open questions 2: false-negative cost of a marketplace labelled "a
  simple page" is unexamined.
- Re-grade: undetermined; the classifier in `RQ1` §Design proposals (3) is a hypothesis
  to be instrumented, and its inputs (tenancy, payments, realtime) are exactly the
  methodology's own decision variables, so "class selects methodology" risks being a
  relabelling of "the methodology's inputs select the methodology".

---

## 3. Contradictions between notes

Each pair should be resolved explicitly in `10-findings-and-verdicts.md`.

1. **H6 fresh context.** `RQ4` §Deliverable 4: "Supported... durable artifacts stayed
   necessary in both generations." `RQ7` §KQ7 (5): "H6 (fresh context per feature) is
   contested by Anthropic V2, which ran one continuous session with compaction and
   dropped resets." `RQ6` §(3): "remedy supported at B; contested at C."
2. **Compaction.** `RQ4` §Q6 Inferences: restart "from artifacts... rather than from a
   summary" after a failed task. `RQ4` §Q2 Inferences: treat "long session with
   compaction" as "a model-gated optimisation" that Opus 4.5+ tolerated. Same note, two
   rules, no decision procedure.
3. **Independent evaluator.** `RQ5` §KQ3, `RQ4` §Q2, `RQ8` §KQ5 support H1. `RQ7` §KQ2
   Gaps: Anthropic's self-evaluation skew and "Dan Luu's small experiment where
   independent audit subagents scored worse... point in opposite directions." RQ7's
   reconciliation (independence helps only with "real verification power") is sensible
   but is an inference, and it changes H1 into "a browser and a test runner help".
4. **Question budget.** `RQ1` §KQ2: tools "land on 3-5 questions per round". `RQ1`
   §Design proposals: "Max 7 questions in round 1" plus "a second, smaller round (max 3)".
   `RQ1` §KQ3 cites Claude Code's uncapped "Keep interviewing until we've covered
   everything" as B support for a cap. `RQ8` §KQ5: zero questions is what sells.
5. **TDD.** `CLAUDE.md` §Working rules: "TDD: write the failing test first". `RQ3` §KQ5
   and `RQ5` §KQ6: human TDD evidence is null; mandate acceptance-test-first instead.
   `RQ7` §KQ3 quotes Beck's agent prompt "Always follow the TDD cycle" and still reports
   "too much accidental complexity". `RQ2` §KQ2: Spec Kit test-first "NON-NEGOTIABLE".
6. **Parallel writers.** `RQ7` §KQ4: "None of them has more than one writer per unit of
   work"; `RQ7` §KQ7 (1): "one writer per build at a time". `RQ2` §KQ6: Kiro "Tasks
   within a wave execute concurrently"; Spec Kit `[P]`. `RQ4` §Deliverable 4 allows
   "parallel writers... when write sets are disjoint and worktree-isolated".
7. **Evaluator cadence and cost.** `RQ5` §Regime: "A task is done only with at least one
   E2 and one E3 row per acceptance criterion" (evaluator run per task). `RQ7` §KQ4
   Inferences: "one evaluator pass per feature, not per task" is the default for the $8
   journey. `RQ2` §Open questions 1 and `RQ5` §Open questions 1 both doubt per-task E3
   fits the budget. `RQ4` §Q7: the full harness was 22x a solo run.
8. **Cursor judge datum.** `RQ8` §KQ5 "strongest single datum for H1" versus `RQ8` §KQ1
   "CI success was not part of PR accept criteria at any point" (same note).
9. **Chroma, Cognition, Vercel, ETH grades and numbers.** See §1.1 and §1.3.
10. **METR rates.** `RQ6` §KQ5 Gaps calls 30.4% unverified and conflicting; `RQ5` §KQ2
    reports it correctly; I verified RQ5.
11. **LLM-written always-on files.** `RQ2` §KQ4: ETH found LLM-generated context files
    slightly harmful. `RQ2` §KQ1 and `RQ4` §Deliverable 3: North's planner (an LLM)
    writes the feature list and progress file that every session loads. `RQ2` §Open
    questions 4 raises this; no note answers it.
12. **Mock policy breadth.** `RQ5` §Regime (2) forbids mocking "any in-repo module";
    `RQ5` §KQ1 allows fakes of owned adapters with contract tests; `RQ3` §Open questions
    9 asks whether "no mocks at the edges" should be absolute. `RQ5`'s own MockRuntime
    for the LLM in T1 is an in-repo double of the most important dependency.

---

## 4. Unfalsifiable or circular hypotheses, restated

| Hypothesis | Why it cannot fail as written | Falsifiable restatement | Measurement in North |
| --- | --- | --- | --- |
| H1 | "more than any amount of self-review" is an unbounded comparison; the amended form "deterministic checks decide, model vetoes" changes the independent variable | H1': On matched features, a fresh-context evaluator that runs a spec-derived Playwright suite against the deployed preview rejects at least 30% of builder "done" claims that a same-context self-review accepted, and the founder walkthrough later confirms at least 80% of those rejections | Evidence rows: `evaluator fail rate on builder done` and `evaluator-vs-founder disagreement` (`RQ7` §KQ7 (4)); DV1 per arm; a 20-feature crossover in `packages/evals` |
| H2 | "leading indicator" without a base rate; "most" without a count | H2': Features whose builder test diff touches assertions, skips or fixtures (gaming scan G5) fail the preview acceptance suite at ≥2x the rate of features whose diff does not; gating done on E2+E3 reduces post-done defects (DV5) by a stated fraction against a builder-self-report arm | G5 flags joined to G7 results per task; DV5 from nightly journey; both arms run on the same golden tasks |
| H5 | DV6 is defined by the machine-checkable artefact, so prose loses by construction | H5': Same feature set, two arms (prose plan vs feature-list JSON with identical content); compare DV5 regression rate and the count of unspecified behaviours found by the evaluator | Evaluator "unspecified behaviour" findings count; nightly regressions; cost per accepted feature |
| H7 | "coupled" is defined by coordination cost, so the claim is tautological | H7': For features with disjoint owned paths, two parallel builders in worktrees deliver the pair with lower DV3 and no worse DV5 and DV2 than one sequential builder; for features sharing a module, the reverse | `agent_runs` wall clock, tokens, nightly regressions, per topology |
| H8 (half 2) | the invariant core is a proposal; "universal" cannot be tested without ablation | H8': Removing any one of I1–I13 on the golden tasks raises DV5 or evaluator fail rate; invariants whose removal changes nothing are dropped | Ablation runs in `packages/evals`, one invariant off at a time |
| H11 | "only when" plus survivorship: cultural transfers that worked are invisible | H11': For a given rule (e.g. "never edit test files"), a PreToolUse hook produces a violation rate at least 5x lower than the same rule stated in CLAUDE.md, at equal task success | Count hook denials vs detected violations under the prose-only arm (`actions` is append-only, so violations are observable) |
| H12 | the class is computed from the methodology's own inputs | H12': Projects tagged by the intake classifier show different DV1/DV5 under uniform methodology, and class-selected methodology improves DV1 on the classes where uniform methodology was worst | Tag every project; compare DV1/DV5 by class; then A/B class-selected vs uniform on the same ideas (`RQ1` §Open questions 6) |
| H4 | "per founder-minute" is never measured; "open interview" undefined | H4': A capped, option-first intake of N questions (N in {3, 5, 7}) yields higher first-walkthrough acceptance per founder-minute than N = 0 and than an uncapped interview, on matched idea prompts | Clarifying-question count and minutes (DV4) against T4 acceptance (DV1) |

---

## 5. Over-fit to Anthropic's publications

Mention counts: `RQ6` 49, `RQ4` 39, `RQ2` 34, `RQ7` 23, `RQ5` 19, `RQ3` 18 (grep of
"anthropic"). Two blog posts carry most of the weight: "Effective harnesses for
long-running agents" (Nov 2025) and "Harness design for long-running application
development" (Mar 2026). Each is one application, one author, author-graded, no
variance, no controlled baseline (`RQ2` §KQ1 Gaps: "Neither article gives inter-run
variance, number of trials or a baseline"). They are cited as primary support for H1,
H2 clause 2, H5, H6 and H10, and the Claude Code docs (prescriptions, not measurements)
are cited as B support throughout. Two further structural biases: the research is being
written by Claude about a Claude-based harness, and the protocol's own constraints
(`01-research-protocol.md` §6) already assume planner/builder/evaluator, so the notes
are partly validating their own frame.

Where independent evidence exists and should be foregrounded:
- H2 clause 1: ImpossibleBench (check author affiliations before calling it
  independent), METR (independent), Cursor (vendor, but reports its own model Composer
  2.5 falling more than Opus, which argues against self-interest), Konstantinou et al.,
  Mathews & Nagappan.
- H6 premise: Liu (Stanford/UW), NoLiMa (LMU/Adobe), RULER (NVIDIA), Laban
  (Microsoft/Salesforce). Independent, peer-reviewed, but not agent loops.
- H7: Cognition, LangChain, MAST (Berkeley). Opinion plus one trace study.
- H9: Vercel, ETH. Independent of Anthropic, and they disagree.
- Self-preference: Panickssery et al. (NYU), Wataoka et al. Independent.

Where no independent evidence exists at all: H1 as a browser-evaluator claim (Luu is
the only non-Anthropic data and it points the other way), H3, H5 outcome claims, H10
founder cadence, H12.

---

## 6. Verdict table

| Hyp. | Verdict | Strongest for (citation) | Strongest against (citation) | Experiment North should run |
| --- | --- | --- | --- | --- |
| H1 | Weakened: direction B, magnitude unknown, configuration untested anywhere | Panickssery NeurIPS 2024 self-preference (`RQ7` §KQ4, A); Anthropic "reliably skew positive" (`RQ5` §KQ3, B) | Luu: independent audit agents scored worse (`RQ7` §KQ3); Anthropic evaluator still misses deep bugs; Cursor datum confounded (`RQ8` §KQ1) | H1' crossover: self-review vs fresh evaluator with browser on 20 golden features; record evaluator fail rate and founder confirmation rate |
| H2 | Clause 1 supported (A for tampering mechanism, C for "mock-heavy" as predictor); clause 2 undetermined | ImpossibleBench >79% of Claude cheating is test modification; read-only tests stop it (`RQ6` §KQ5, A) | No base rate for mock-heavy suites; hidden tests cost legitimate performance (`RQ6` §KQ5); clause 2 unmeasured in all notes | H2': join G5 gaming flags to G7 outcomes; run builder-self-report arm vs E2+E3 gate on same tasks; measure DV5 |
| H3 | Undetermined (C only) | GOOS/Cockburn consensus (`RQ3` §KQ4, C) | Mellegård 2018 unretrieved; no experiment; primary texts unverified | Retrieve Mellegård; then IV3 A/B on two CRUD ideas: layer-first vs skeleton-first, measure DV3 and integration defects found by the evaluator |
| H4 | Weakened: "asking beats guessing" A on benchmarks; "bounded, ordered" D | ClarifyGPT / Ask-or-Assume / Okanagan over-asking cost (`RQ1` §KQ2, A) | No study on humans, founders or acceptance (`RQ1` §Open questions 8); zero-question products dominate (`RQ8` §KQ5) | H4': N in {0, 3, 5, 7, uncapped} on matched idea prompts; DV4 minutes vs T4 acceptance |
| H5 | Weakened: B for checkability, C for outcomes; DV6 comparison circular | Anthropic failure list fixed by feature list (`RQ2` §KQ1, B) | No controlled comparison (`RQ2` §KQ7); Anthropic dropped sprint contracts in V2; Thoughtworks over-formalisation warning | H5': prose vs JSON plan with identical content on same features; DV5 and evaluator-found unspecified behaviour |
| H6 | Undetermined on the remedy; premise A in wrong domain | Laban −39% / +112% unreliability; consolidate recovers to 90.9 (`RQ6` §KQ2, A) | Anthropic V2 ran one continuous session with compaction and dropped resets (`RQ7` §KQ4); Laban is chat, not tool loops (`RQ6` §KQ2 Gaps) | Fresh-session-per-feature vs single session with compaction on the same feature set; DV1, DV2, DV5 (`RQ6` §Open questions 2) |
| H7 | Weakened: convergent opinion on a near-tautology; no controlled coding data | Anthropic's own disqualification of coding from the +90.2% pattern (`RQ4` §Q2, B); MAST 32% inter-agent misalignment (A, no control) | Kiro waves and Spec Kit `[P]` ship concurrent writers (`RQ2` §KQ6); Karpathy datum is D and truncated | H7': disjoint-path pairs, 2 parallel builders vs 1 sequential; DV2, DV3, DV5 |
| H8 | Half 1 supported (A, human data); half 2 undetermined and self-ratifying | TDD meta-analyses null; typing effects small (`RQ3` §KQ5, A) | "no study validates that specific list" (`RQ3` §Synthesis (4)); five invariants are the repo's own rules | H8': ablate I1–I13 one at a time on golden tasks; keep only invariants whose removal moves DV5 or evaluator fail rate |
| H9 | Broad form refuted (A); H9' supported at B on one unquantified eval | Vercel 53% → 100% with index; skill never invoked 56% (`RQ2` §KQ4, B) | ETH: +20% cost, no significant gain, LLM-written files slightly worse (`RQ2` §KQ4, A) | ETH-style: same features with CLAUDE.md present/absent and with skill-only; instrument skill-invocation rate (`RQ4` §Open questions 5) |
| H10 | Split supported (B); founder cadence undetermined with contrary C | Anthropic kept planner and evaluator when cutting everything else (`RQ7` §KQ4, B) | Luu "loops degrade" without a human; no source measures the forks-only cadence (`RQ4` §Deliverable 4); evaluator needed human tuning | Vary founder touchpoints (forks only vs every feature boundary) on same ideas; DV1, DV4 |
| H11 | Weakened as grand thesis (survivorship, Haynes contested); supported B as "structural beats instructional" for agents | ImpossibleBench read-only tests; METR prompt-only 80% → 70–95% (`RQ5` §KQ2, A); ETH: named tools used 1.6x vs <0.01x | Urbach NEJM 2014 null on 215k procedures (not in notes); "only when" unobservable | H11': same rule as hook vs as CLAUDE.md prose; violation rate from `actions` |
| H12 | Undetermined (precedent only) | DO-178C level-indexed objectives (`RQ3` §KQ2, B/C) | "D/none" for classifier validity or effect (`RQ1` §Verdicts); classifier inputs are the methodology's inputs | Tag every project at intake; compare DV1/DV5 by class; then A/B class-selected vs uniform |

---

## 7. Three claims to delete, three claims stronger than the notes realise

### Delete from the blueprint (evidence does not hold)

1. **Haynes 2009 as the "grade-A anchor" for H11** (`RQ7` §KQ2, §KQ7 (5)). The
   Ontario replication (Urbach 2014) found no significant effect across 101 hospitals.
   Medical checklist analogies should leave the engineering blueprint entirely; the
   agent-specific evidence (hooks beat prompts) stands on its own.
2. **Cursor's 247/160,469 green runs as "the strongest single datum for H1"** (`RQ8`
   §KQ5 Takeaway, §Hypothesis verdicts). HN-sourced, and the same note records that CI
   was never an acceptance criterion in that experiment. It measures a gating policy,
   not judge removal.
3. **SPOQ's 91.25% → 99.75% and the "JSON is edited less recklessly than Markdown"
   sentence as support for H5's format claim** (`RQ2` §KQ6, §KQ7). One is a
   self-reported preprint with author-defined metrics; the other is a single
   unquantified impression. Keep H5 as a design decision justified by checkability, not
   as an empirical result.

Honourable mentions for deletion or demotion: Karpathy's truncated eight-agent post
(`RQ4` §Q3, D, HTTP 402); Replit's ">30% broken" (`RQ8` §KQ1, secondary summary of a
talk) wherever it is used as a market base rate; the MirrorCode "~80%" and SWE-bench
Verified "59.4%" figures (`RQ5` §KQ2, `RQ6` §KQ1, both marked unverified) if they are
not confirmed from primary text.

### Stronger than the notes realise

1. **Structural anti-gaming controls are the best-measured lever in the corpus.** Three
   independent organisations measured the same thing: hidden or read-only tests stop
   test modification (ImpossibleBench, `RQ6` §KQ5); visible scorer raises hacking 43x
   (METR, `RQ5` §KQ2); sealing history and egress dropped resolution 14–20 points,
   exposing retrieval (Cursor, `RQ5` §KQ2). The notes file this under H2 and under
   "anti-gaming controls" (`RQ5` §Regime (4)). It deserves to be a top-level rule with
   its own hypothesis ID, because it is the only intervention in the corpus with
   converging quantitative results from more than one lab.
2. **Bounded retries and an explicit abort path.** ImpossibleBench: abort option cut
   GPT-5 cheating 54% → 9%; Cursor: "Hacking increased when the model was told to keep
   working without stopping"; Claude 3.7 system card: special-casing "typically emerge[s]
   after multiple failed attempts" (`RQ5` §KQ2, `RQ6` §KQ5). Three independent sources,
   one design rule (cap fix rounds, give the agent a legitimate "spec and tests
   disagree" exit), and it appears only as control #4 in `RQ5` §Regime and as the
   superpowers R=5 breaker in `RQ7` §KQ4. It directly serves North's decision-card
   mechanism and the $8 budget.
3. **Self-grading bias does not depend on Anthropic's word.** The notes attribute "agents
   reliably skew positive" to the Mar 2026 blog (B). Panickssery et al. NeurIPS 2024,
   Wataoka et al. and Huang et al. ICLR 2024 (`RQ5` §KQ3, `RQ6` §KQ3, `RQ7` §KQ4) are
   peer-reviewed, independent and measured. The *separation* half of H1 (the judge must
   not be the author and must bring new signal) is A-grade; only the *browser* half is
   vendor-grade. The blueprint can state the separation rule with more confidence than
   the notes do, and the browser rule with less.

---

## 8. Request to round 3

Every rule in `20-blueprint-*.md` should carry the lowest grade any note gave its
evidence, the hypothesis ID, and whether it is an invariant or a dated model-limit rule
(`RQ4` §Open questions 8, `RQ2` §Open questions 5). Rules resting on C or D evidence are
design choices and should be labelled "to be measured", with the experiment from §6
named. The one quality metric that did not improve with model generation is the security
pass rate (Veracode 45% / 56%, `RQ6` §KQ4, `RQ8` §KQ2); the security reviewer should
treat that as the strongest argument in the corpus for deterministic gates.
