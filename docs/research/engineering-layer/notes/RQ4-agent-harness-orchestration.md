# RQ4: How leading agent harnesses orchestrate planning, context, memory, subagents and parallel vs sequential execution

Persona: Agent Runtime Engineer. Research date: 2026-10-17. Protocol: `../01-research-protocol.md`
(evidence grades A controlled study or measured production data, B vendor docs or first-party
engineering account, C practitioner essay or talk, D anecdote or forum). Hypotheses in scope: H6,
H7, H10 (also touches H1, H9).

This note extends `docs/research/agent-harness-best-practices.md` (2026-10-16); it does not repeat
its SDK option table. Where that note is now stale, this note says so in the "Staleness" list at the
end of question 1.

Reading guide: every bullet carries a source link and a grade in brackets. "Unverified" marks
claims I could only find in secondary coverage. Quotations are exact unless marked paraphrase.

---

## Q1. Claude Code and the Agent SDK: how subagents, plan mode, memory, compaction, background work, worktrees and sessions behave today

### Takeaway

Claude Code 2.1.302 and `@anthropic-ai/claude-agent-sdk` 0.3.302 (both 2026-10-16) give North every
orchestration primitive it needs: subagents with isolated context that return a summary, forked
subagents that inherit context, worktree isolation per subagent or session, plan mode (read-only),
deterministic hooks (`Stop` can block the turn until a check passes), auto-compaction with a
tunable window, auto memory, `resume`/`forkSession`, structured outputs, `maxTurns`,
`maxBudgetUsd` and an OS-level sandbox. The docs themselves state the one constraint everything else
is built around: "LLM performance degrades as context fills."

### Cited Findings

Versions and dates

- Claude Code latest changelog entry is 2.1.302, 2026-10-16; 2.1.301 on 2026-10-15; 2.1.300 and
  2.1.299 on 2026-10-14; 2.1.296 on 2026-10-09 — [Claude Code changelog](https://code.claude.com/docs/en/changelog) [B]
- `@anthropic-ai/claude-agent-sdk` current npm version is 0.3.302, modified 2026-10-16T20:54Z;
  `@anthropic-ai/claude-code` is 2.1.302 — npm registry read via `npm view` on 2026-10-17 [B]
- 2.1.302: "Fork subagents (`subagent_type: "fork"`) are now on by default in `claude -p`, the Agent
  SDK, the desktop app, and VS Code. Set `CLAUDE_CODE_FORK_SUBAGENT=0` to turn them off." Also:
  "Auto mode's server-side classifier now compacts conversations that are too long for the safety
  check" — [changelog](https://code.claude.com/docs/en/changelog) [B]
- 2.1.299: idle compaction, "a conversation of 200K+ tokens left idle for about 54 minutes is
  compacted before its one-hour prompt cache expires"; tune with `CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS`
  or disable with `"idleCompaction": false` — [changelog](https://code.claude.com/docs/en/changelog) [B]
- 2.1.296: subagent frontmatter accepts `autoCompactWindow`, "so a subagent can auto-compact
  earlier than the main conversation" — [changelog](https://code.claude.com/docs/en/changelog) [B]

Subagents (Claude Code and SDK `agents` option)

- "Each subagent runs in its own context window with a custom system prompt, specific tool access,
  and independent permissions." Subagents "don't see your conversation history, the skills you've
  already invoked, or the files Claude has already read." — [Subagents](https://code.claude.com/docs/en/sub-agents) [B]
- Use one "when a side task would flood your main conversation with search results, logs, or file
  contents you won't reference again: the subagent does that work in its own context and returns
  only the summary." Use the main conversation for tasks needing "frequent back-and-forth or
  iterative refinement" — [Subagents](https://code.claude.com/docs/en/sub-agents) [B]
- Built-ins: `Explore` ("A fast, read-only agent", Write/Edit denied, thoroughness quick/medium/very
  thorough), `Plan` (read-only, used in plan mode), `general-purpose`. Explore and Plan start without
  CLAUDE.md and git status; others load both unless `omitClaudeMd: true` — [Subagents](https://code.claude.com/docs/en/sub-agents) [B]
- Frontmatter: `tools`, `disallowedTools`, `model` (`sonnet`/`opus`/`haiku`/`fable`/`inherit`),
  `permissionMode`, `maxTurns` (output marked partial, resumable since v2.1.246), `skills`
  (preloaded), `memory` (`user`/`project`/`local`; loads first 200 lines or 25KB of `MEMORY.md`),
  `background`, `isolation: worktree`, `effort`, `omitClaudeMd`, `autoCompactWindow`;
  `AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode` are always removed from subagents —
  [Subagents](https://code.claude.com/docs/en/sub-agents) [B]
- Nesting default three layers (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`); concurrency default 20
  (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`, v2.1.217+). "Each subagent invocation creates a new
  instance rather than continuing an earlier one"; continue one with `SendMessage` by agent ID or
  name; Explore and Plan are one-shot — [Subagents](https://code.claude.com/docs/en/sub-agents) [B]
- Fork subagent (`/subtask`, v2.1.212+) "inherits the full conversation"; a non-fork subagent's
  initial context is "its system prompt, the task message, CLAUDE.md files (unless omitted), git
  status, and any preloaded skills" — [Subagents](https://code.claude.com/docs/en/sub-agents) [B]
- Foreground subagents "block the main conversation until complete"; background subagents "run
  concurrently while you continue working" with a smaller tool set; Ctrl+B backgrounds a running
  task — [Subagents](https://code.claude.com/docs/en/sub-agents) [B]
- Subagent output "is scanned before Claude reads it ... It is not a security boundary." Combined
  non-built-in subagent descriptions over 15,000 tokens trigger a startup warning —
  [Subagents](https://code.claude.com/docs/en/sub-agents) [B]
- Transcripts: `~/.claude/projects/{project}/{sessionId}/subagents/agent-{agentId}.jsonl`, deleted
  after `cleanupPeriodDays` (30 default). "Auto-compaction applies to each subagent's own context
  window." — [Subagents](https://code.claude.com/docs/en/sub-agents) [B]

Plan mode and verification loops

- Plan mode: "Claude reads files and proposes a plan but makes no edits until you approve";
  `claude --permission-mode plan` or Shift+Tab; `Ctrl+G` opens the plan in an editor —
  [Common workflows](https://code.claude.com/docs/en/common-workflows) [B]
- "Planning is most useful when you're uncertain about the approach, when the change modifies
  multiple files, or when you're unfamiliar with the code being modified. If you could describe the
  diff in one sentence, skip the plan." — [Best practices](https://code.claude.com/docs/en/best-practices) [B]
- "Claude stops when the work looks done. Without a check it can run, 'looks done' is the only
  signal available." Four gating strengths: in-prompt check; `/goal` ("A separate evaluator
  re-checks it after every turn"); `Stop` hook ("runs your check as a script and blocks the turn
  from ending until it passes"); "a verification subagent ... has a fresh model try to refute the
  result, so the agent doing the work isn't the one grading it" —
  [Best practices](https://code.claude.com/docs/en/best-practices) [B]
- "Have Claude show evidence rather than asserting success: the test output, the command it ran
  and what it returned, or a screenshot of the result." —
  [Best practices](https://code.claude.com/docs/en/best-practices) [B]
- Adversarial review caveat: "A reviewer prompted to find gaps will usually report some, even when
  the work is sound ... Tell the reviewer to flag only gaps that affect correctness or the stated
  requirements" — [Best practices](https://code.claude.com/docs/en/best-practices) [B]
- Writer/Reviewer pattern across two sessions: "A fresh context improves code review since Claude
  won't be biased toward code it just wrote." — [Best practices](https://code.claude.com/docs/en/best-practices) [B]
- Hooks: "Unlike CLAUDE.md instructions which are advisory, hooks are deterministic and guarantee
  the action happens." — [Best practices](https://code.claude.com/docs/en/best-practices) [B]

Memory: CLAUDE.md, rules, AGENTS.md, auto memory

- Two systems, both "loaded at the start of every conversation. Claude treats them as context, not
  enforced configuration. To block an action regardless of what Claude decides, use a PreToolUse
  hook instead." Auto memory: "Per repository, shared across worktrees", loaded "first 200 lines or
  25KB" — [Memory](https://code.claude.com/docs/en/memory) [B]
- Locations: managed policy (`/etc/claude-code/CLAUDE.md` on Linux), user `~/.claude/CLAUDE.md`,
  project `./CLAUDE.md` or `./.claude/CLAUDE.md`, local `./CLAUDE.local.md`; files above cwd load
  at launch, subdirectory files load "once Claude reads, writes, or edits another file in that
  subdirectory"; all are concatenated root-down, not overridden — [Memory](https://code.claude.com/docs/en/memory) [B]
- "target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce
  adherence." `@path` imports, max depth four hops; `.claude/rules/*.md` with path-scoped `paths`
  frontmatter — [Memory](https://code.claude.com/docs/en/memory) [B]
- AGENTS.md read directly (v2.1.277+) only when no CLAUDE.md exists in cwd or above; `~/.claude/CLAUDE.md`,
  managed CLAUDE.md and `.claude/rules/` still load alongside — [Memory](https://code.claude.com/docs/en/memory) [B]
- CLAUDE.md hygiene: "For each line, ask: 'Would removing this cause Claude to make mistakes?' If
  not, cut it. Bloated CLAUDE.md files cause Claude to ignore your actual instructions!" "For domain
  knowledge or workflows that are only relevant sometimes, use skills instead." —
  [Best practices](https://code.claude.com/docs/en/best-practices) [B]
- "If you've corrected Claude more than twice on the same issue in one session, the context is
  cluttered with failed approaches. Run `/clear`" — [Best practices](https://code.claude.com/docs/en/best-practices) [B]

Compaction

- "Claude Code automatically compacts conversation history when you approach context limits";
  `/compact <instructions>`; rewind-and-summarize from a checkpoint; CLAUDE.md can carry compaction
  instructions ("When compacting, always preserve the full list of modified files and any test
  commands") — [Best practices](https://code.claude.com/docs/en/best-practices) [B]
- After compaction Claude Code continues with the summary plus "the five most recently accessed
  files"; "tool result clearing" is the lightest-touch compaction —
  [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) (2025-09-29) [B]
- "`/compact` reads the conversation it summarizes, so compacting a large context is itself a
  large request. When you want a fresh start instead of continuity, `/clear` costs nothing" —
  [Costs](https://code.claude.com/docs/en/costs) [B]

Parallel surfaces: worktrees, agent view, agent teams, /batch, workflows

- Five ways to run in parallel: subagents, agent view (research preview), agent teams
  (experimental, off by default), dynamic workflows, projects. Decision questions: "Who coordinates
  the work?", "Do the workers need to talk to each other?", "Do the tasks touch the same files?
  Isolate the work with worktrees ... Agent teams don't isolate teammates in worktrees, so partition
  the work so each teammate owns a different set of files." — [Run agents in parallel](https://code.claude.com/docs/en/agents) [B]
- `claude --worktree <name>` creates `.claude/worktrees/<name>/` on branch `worktree-<name>`;
  `isolation: worktree` on a subagent gives it a temporary worktree removed when it finishes
  without changes; isolation checks block edits, commands and git redirects into the main checkout —
  [Worktrees](https://code.claude.com/docs/en/worktrees) [B]
- Agent view: "Before a dispatched session edits files, Claude moves it into its own git worktree
  ... it never pushes to `main` or `master`, force-pushes, or merges." "ten parallel agents consume
  quota roughly ten times as fast as one." — [Agent view](https://code.claude.com/docs/en/agent-view) [B]
- `/batch` splits one change "across 5 to 30 subagents. Each subagent works in its own worktree." —
  [Best practices](https://code.claude.com/docs/en/best-practices) [B]
- Agent teams: "For sequential tasks, same-file edits, or work with many dependencies, a single
  session or subagents are more effective." "Two teammates editing the same file leads to
  overwrites." "Start with 3-5 teammates". Not available in `-p`/SDK mode: "Claude doesn't spawn
  teammates". Plan approval is auto-granted by the lead "without the lead reviewing it" —
  [Agent teams](https://code.claude.com/docs/en/agent-teams) [B]
- "Agent teams use approximately 7x more tokens than standard sessions when teammates run in plan
  mode" — [Costs](https://code.claude.com/docs/en/costs) [B]
- Enterprise average "$13 per developer per active day and $150-250 per developer per month" —
  [Costs](https://code.claude.com/docs/en/costs) [B]

Sessions in the SDK

- `continue` (most recent session in cwd), `resume` (by ID), `forkSession` ("creates a new session
  that starts with a copy of the original's history. The original stays unchanged"); "Sessions
  persist the conversation, not the filesystem" (use file checkpointing for files); resume works
  "Same machine only" unless a `SessionStore` mirrors transcripts; alternative: "Don't rely on
  session resume. Capture the results you need ... as application state and pass them into a fresh
  session's prompt. This is often more robust than shipping transcript files around." —
  [Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions) [B]
- Prompt caching economics for forks: cache read 0.1x base (0.05x on Opus 5.5 / Sonnet 5.5, 0.025x
  on Fable 5.1), 5-minute write 1.25x, 1-hour write 2x; hits require identical prefix in order
  `tools -> system -> messages`; a second request that changes only the last user message reads the
  shared prefix from cache — [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) [B]
- In-process teammate requests fall outside the main conversation's cache TTL bucket (5 minutes
  unless `subagentPromptCacheTtl: 1h`) — [Agent teams](https://code.claude.com/docs/en/agent-teams) [B]

Staleness of `agent-harness-best-practices.md` (2026-10-16)

- Versions: SDK 0.3.301 -> 0.3.302 and Claude Code 2.1.301 -> 2.1.302 (both 2026-10-16) [B].
- New since: fork subagents are on by default in the SDK (2.1.302); North's runtime should decide
  explicitly (`CLAUDE_CODE_FORK_SUBAGENT=0` for isolated critics, since a forked critic inherits the
  builder's reasoning and loses the independence the harness post relies on) [inference].
- Idle compaction (2.1.299) and `autoCompactWindow` per subagent (2.1.296) exist and were not in the
  earlier note.
- The earlier note's S32 summary says the long-running harness tested "in a browser"; the primary
  post used the Puppeteer MCP server, not Playwright (Playwright MCP appears in the 2026 post).
- Agent teams are not usable from the SDK, so the orchestration layer North builds must do its own
  coordination (Inngest + core state machine, as the earlier note recommends).

### Inferences

- The vendor's own guidance converges on one control loop: explore (read-only), plan, implement with
  a check the harness can run, then an independent reviewer in fresh context. North's planner /
  builder / evaluator split matches the vendor's recommended shape, not a departure from it.
- `Stop` hooks and `/goal` are the deterministic gates; CLAUDE.md is advisory. North's "no evidence,
  no done" rule belongs in a `Stop`/`SubagentStop` hook or in the Inngest state machine, never in
  prose instructions alone.
- Because the SDK cannot spawn agent teams, "parallel" for North means either (a) subagents inside
  one `query()` (fan-out with summaries back) or (b) separate `query()` runs orchestrated by
  Inngest, each in its own worktree. Shared-file parallelism has no vendor-supported path.

### Gaps

- No official measurement of how much subagent delegation improves task outcomes versus reading in
  the main context; the docs argue from context budget, not from an eval.
- The exact auto-compact trigger threshold is not published (the context-engineering post gives no
  token number; the model-config page's "auto-compact window" was not fetched).

---

## Q2. Anthropic engineering posts: concrete rules and measured numbers

### Takeaway

Across six posts (2024-12 to 2026-03) Anthropic's measured numbers are: agents ~4x chat tokens,
multi-agent ~15x; multi-agent research beat single Opus 4 by 90.2% on an internal eval with token
usage explaining 80% of variance; parallel tool calls cut research time up to 90%; subagents return
1,000-2,000-token summaries; a full planner/generator/evaluator harness cost $200 and 6 hours versus
$9 and 20 minutes for a broken solo run; and "agents reliably skew positive when grading their own
work." The posts also say coding is a poor fit for parallel multi-agent, and that scaffolding should
be removed as models improve.

### Cited Findings

Building effective agents (2024-12-19)

- "Workflows are systems where LLMs and tools are orchestrated through predefined code paths.
  Agents, on the other hand, are systems where LLMs dynamically direct their own processes and tool
  usage." "we recommend finding the simplest solution possible, and only increasing complexity when
  needed." — [Building effective agents](https://www.anthropic.com/research/building-effective-agents) [B]
- Orchestrator-workers suits "Coding products that make complex changes to multiple files each
  time"; evaluator-optimizer fits when "we have clear evaluation criteria, and when iterative
  refinement provides measurable value"; parallelization = sectioning ("Breaking a task into
  independent subtasks run in parallel") and voting; "Agentic systems often trade latency and cost
  for better task performance"; coding: "Code solutions are verifiable through automated tests" —
  [Building effective agents](https://www.anthropic.com/research/building-effective-agents) [B]

Multi-agent research system (2025-06-13)

- Opus 4 lead with Sonnet 4 subagents "outperformed single-agent Claude Opus 4 by 90.2% on our
  internal research eval"; on BrowseComp "token usage by itself explains 80% of the variance";
  agents use ~4x chat tokens, multi-agent "about 15x more tokens than chats"; parallel tool calling
  "cut research time by up to 90% for complex queries" —
  [Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) [A for the internal numbers; B for the account]
- Effort scaling in prompts: "1 agent with 3-10 tool calls" for simple fact-finding, "2-4 subagents
  with 10-15 calls each" for comparisons, >10 subagents for complex research; lead spins up "3-5
  subagents in parallel rather than serially" — same source [B]
- Limits: "most coding tasks involve fewer truly parallelizable tasks than research", and domains
  that need "all agents to share the same context" are a poor fit; "our lead agents execute
  subagents synchronously, waiting for each set of subagents to complete before proceeding";
  context over 200,000 tokens is truncated so the lead saves its plan to memory first; "we built
  systems that can resume from where the agent was when the errors occurred" — same source [B]

Effective context engineering (2025-09-29)

- Context rot: "the model's ability to accurately recall information from that context decreases"
  as tokens grow; "n² pairwise relationships for n tokens"; system prompt at the "right altitude"
  between brittle hardcoded logic and vague guidance; just-in-time retrieval with "lightweight
  identifiers (file paths, stored queries, web links, etc.)"; Claude Code hybrid: "CLAUDE.md files
  are naively dropped into context up front" while glob/grep fetch just-in-time —
  [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) [B]
- Compaction keeps "architectural decisions, unresolved bugs, and implementation details", drops
  redundant tool outputs; "Start by maximizing recall", then improve precision. Sub-agents return
  "only a condensed, distilled summary of its work (often 1,000-2,000 tokens)" while spending "tens
  of thousands of tokens or more" exploring — same source [B]

Effective harnesses for long-running agents (2025-11-26)

- Initializer agent writes a JSON feature list ("over 200 features", each initially failing; coding
  agents may only flip `passes`; "It is unacceptable to remove or edit tests"), `claude-progress.txt`,
  `init.sh`, an initial git commit; JSON chosen because "the model is less likely to overwrite it
  than Markdown" (paraphrase); coding agent each session: `pwd`, git log, progress file, feature
  list, `init.sh`, basic end-to-end check, then one feature — [Effective harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) [B]
- Observed failure modes: trying to one-shot the app and running out of context mid-feature;
  "declaring victory early"; marking features done on unit tests or `curl` without end-to-end
  browser testing (Puppeteer MCP; Claude could not see browser-native alert modals). Compaction
  alone "doesn't always pass perfectly clear instructions to the next agent." No quantitative
  results reported — same source [B]

Harness design for long-running application development (2026-03-24)

- Roles: planner expands a 1-4 sentence prompt into a spec; generator builds in sprints; evaluator
  uses Playwright MCP, "would navigate the page on its own, screenshotting and carefully studying the
  implementation." Rubric: design quality, originality, craft, functionality (first two weighted
  higher); full-stack rubric with hard per-criterion thresholds; 5-15 iterations per generation;
  sprint 3 alone had 27 criteria — [Harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps) [B]
- Costs: solo run 20 min, $9, broken; full harness 6 h, $200 ("over 20x more expensive"); DAW run on
  Opus 4.6 3 h 50 min, $124.70 — same source [A for measured runs, n=1 each]
- "agents reliably skew positive when grading their own work"; out of the box Claude "would talk
  itself into deciding they weren't a big deal and approve the work anyway" — same source [B]
- Model-dependence: Sonnet 4.5 showed context anxiety so resets were essential; Opus 4.5 "largely
  removed that behavior on its own", so resets were dropped for SDK auto-compaction; for Opus 4.6 the
  sprint construct was removed and the evaluator moved to a single end-of-run pass; "the scaffold
  surrounding the model matters less over time"; workflow is sequential (planner, generator,
  evaluator), parallelism not discussed — same source [B]

### Inferences

- The 90.2% gain is a research (read-heavy, breadth-first) result; the same post disqualifies most
  coding from the pattern. Carrying the number into engineering orchestration is a category error.
- Anthropic's two harness posts moved in opposite directions on context: 2025 added resets and
  progress files because the model needed them; 2026 removed resets because Opus 4.5+ did not. The
  durable artifacts (feature list, progress file, git) stayed. North should treat "fresh context per
  feature" as the safe default and "long session with compaction" as a model-gated optimisation.
- Evaluator leniency is reported in both the 2026 post and the Claude Code docs; the fix in both
  is separation (fresh context, own rubric, hard thresholds), not better self-prompting. This is
  direct support for H1 and a dependency of H10.

### Gaps

- No Anthropic post publishes a controlled comparison of single long session vs fresh session per
  feature on the same task; the 2025 harness post gives qualitative failure modes only.
- The 15x token figure is for research fan-out; no equivalent multiplier is published for coding
  fan-out with worktrees.

---

## Q3. Cognition's "Don't build multi-agents" versus Anthropic's multi-agent position: where they agree, and when parallelism is safe (H7)

### Takeaway

The two positions agree on more than the titles suggest: both say decisions carry implicit context,
both say coding tasks are weakly parallelizable, both make the subagent return a summary to a single
decision-maker, and both reach for compression (a dedicated summarizer at Cognition; compaction and
memory at Anthropic) rather than more agents. The disagreement is scope: Cognition rejects parallel
writers that make product decisions independently; Anthropic defends parallel readers under one
lead. Parallelism is safe when the parallel units are read-only, or write to disjoint files in
separate worktrees with the integration decision made by one agent.

### Cited Findings

- Cognition, Walden Yan, 2025-06-12. Principle 1: "Share context, and share full agent traces, not
  just individual messages". Principle 2: "Actions carry implicit decisions, and conflicting
  decisions carry bad results". Flappy Bird example: one subagent builds a Super Mario-style
  background, the other a bird that does not move like Flappy Bird; passing the original task to
  each does not fix the mismatch — [Don't build multi-agents](https://cognition.com/blog/dont-build-multi-agents) [C]
- Recommended architecture: a single-threaded linear agent; for long tasks "a dedicated model that
  compresses the history of actions and conversation into key details, events, and decisions"
  (paraphrase), which Cognition has fine-tuned a smaller model for; multi-agent systems in 2025 are
  fragile because "decisions are too dispersed and context isn't shared thoroughly enough"
  (paraphrase) — same source [C]
- On Claude Code (as of June 2025): the subtask agent "never does work in parallel with the subtask
  agent" and is "usually only tasked with answering a question, not writing any code", because it
  lacks the main agent's context; the benefit is that investigative work stays out of the main
  trace — same source [C]
- Anthropic concedes the same constraint: coding has "fewer truly parallelizable tasks than
  research" and domains needing shared context are a poor fit; subagents return condensed results
  to a single lead that compiles the answer; the lead runs subagents synchronously —
  [Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) [B]
- Claude Code docs (2026): parallel implementation only when "each teammate owns a different set of
  files"; "Start with research and review ... without the coordination challenges that come with
  parallel implementation"; worktrees exist so "parallel sessions each edit their own copy of the
  files" — [Agent teams](https://code.claude.com/docs/en/agent-teams), [Run agents in parallel](https://code.claude.com/docs/en/agents) [B]
- Independent evidence that multi-agent failures are structural: MAST taxonomy (Cemri et al.,
  NeurIPS 2025 D&B) from 1,642 annotated traces across seven frameworks; failures fall into
  specification issues, inter-agent misalignment and task verification; prompt and topology fixes
  gave ChatDev +14% but "did not resolve all failure cases" — [arXiv 2503.13657](https://arxiv.org/abs/2503.13657v2) [A]
- Karpathy's eight-agent experiment (four Claude, four Codex, one GPU each, nanochat, trying to
  "delete logit softcap without regression"): "The TLDR is that it doesn't work and it's a mess...
  but it's still very" [truncated in the indexed title] — [X post 2027521323275325622](https://x.com/karpathy/status/2027521323275325622) [D; the X page returned HTTP 402, text taken from the search-indexed title; date 2026-02-27 per secondary coverage, unverified]
- Where Cognition's own product landed: Devin guidance is "Carve out independent tasks and run them
  simultaneously" via managed Devins or the API, each Devin a single-threaded session; sessions
  should be "XS, S, or M" and under about three hours of human-equivalent work —
  [When to use Devin](https://docs.devin.ai/essential-guidelines/when-to-use-devin) [B]

### Inferences

- Both camps implement the same invariant: one context owns each decision. Anthropic's lead agent is
  Cognition's single thread; the subagents are its tool calls. H7's framing ("Cognition vs
  Anthropic") is therefore a false dichotomy; the real variable is whether a parallel unit makes
  decisions that another unit must later be consistent with.
- Safe parallelism checklist derived from the sources: (1) read-only output (research, review,
  hypothesis testing), or (2) disjoint write sets enforced by worktree isolation, with (3) a
  single integrator that reads the summaries and owns the merge, and (4) a spec/feature list written
  before fan-out so the implicit decisions are already explicit. Cognition's Flappy Bird failure is a
  missing (4), not a failure of parallelism as such.
- Cognition's compression model and Anthropic's compaction plus progress files are the same move:
  keep one thread, shrink its history. For North, the state machine plus `features.json` plus
  progress file is that compressor, implemented as data rather than as a fine-tuned model.

### Gaps

- No controlled study compares single-writer vs parallel-writer on realistic feature work with
  worktrees. MAST covers frameworks (ChatDev, MetaGPT, AG2 etc.), not Claude Code worktree fan-out.
- Cognition has not published numbers on its compression model's accuracy.

---

## Q4. Andrej Karpathy: what he has said about how coding agents should work (2025-2026)

### Takeaway

Karpathy's position moved from "keep the AI on the leash, small incremental chunks, I'm still the
bottleneck" (June 2025) through "coding agents basically didn't work before December and basically
work since" (2026-02-26) to running many agents with the human programming the harness, not the
code (autoresearch, March 2026: "The agent only touches `train.py`", the human edits `program.md`).
The constant across all three is the generation-verification loop: humans verify, and verification
must be made fast and cheap; "you can outsource your thinking, but you can't outsource your
understanding."

### Cited Findings

- Vibe coding coined on X, 2025-02-02: a mode where you "forget that the code even exists"; he
  describes using Cursor Composer by voice and barely touching the keyboard —
  [Snyk summary](https://snyk.io/es/articles/is-vibe-coding-secure/), [Know Your Meme](https://knowyourmeme.com/memes/vibe-coding) [C; original post not fetched]
- YC AI Startup School talk "Software Is Changing (Again)", June 2025: Latent.Space recap gives
  "Demo is works.any(), product is works.all()", "More partial autonomy, custom GUIs and autonomy
  sliders", "To improve verification: Make it easy, fast to win", "To improve generation: Keep AI
  on tight leash", "BUILD FOR AGENTS", Iron Man suit as augmentation plus autonomy, Tesla Autopilot
  and Cursor as autonomy-slider examples — [Latent.Space, 2025-06-17](https://www.latent.space/p/s3) [C; recap, full transcript paywalled]
- Business Insider's report of the same talk (via AOL): he told developers to keep AI on a leash,
  said "I'm still the bottleneck", and "I always go in small incremental chunks" —
  [AOL/Business Insider](https://www.aol.com/keep-ai-leash-because-far-035005777.html) [C; page returned 404 on fetch, quotes from search snippet, unverified against video]
- nanochat, October 2025: the repo "is basically entirely hand-written (with tab autocomplete)";
  he tried Claude and Codex agents and found them unhelpful, suspecting the code was too far off
  the training distribution — [Simon Willison, 2025-10-18](https://simonwillison.net/2025/Oct/18/agi-is-still-a-decade-away/) [C]
- X post, 2026-02-26: "It is hard to communicate how much programming has changed due to AI in the
  last 2 months", "coding agents basically didn't work before December and basically work since",
  "the models have significantly higher quality, long-term coherence and tenacity", "they can power
  through large and long tasks" — [Simon Willison quoting x.com/karpathy/status/2026731645169185220](https://simonwillison.net/2026/Feb/26/andrej-karpathy/) [C]
- Same thread, as reported: a 30-minute unattended agent run (SSH setup, benchmarking, dashboard)
  that "could easily have been a weekend project just three months ago"; "It's not magic, it's
  delegation."; "ascending the layers of abstraction" (on orchestrating parallel instances) —
  [Implicator.ai, 2026-02-26](https://www.implicator.ai/karpathy-says-ai-coding-agents-made-programming-unrecognizable-since-december.md) [C; secondary]
- "Agentic engineering" coined in February 2026 as the successor term to vibe coding —
  [letsdatascience](https://letsdatascience.com/news/andrej-karpathy-coins-agentic-engineering-term-a55528b6) [D; secondary]
- autoresearch README (signed "-@karpathy, March 2026"): "It modifies the code, trains for 5
  minutes, checks if the result improved, keeps or discards, and repeats."; "Single file to modify.
  The agent only touches `train.py`."; "`program.md` ... This file is edited and iterated on by the
  human."; "you're not touching any of the Python files like you normally would as a researcher ...
  you are programming the `program.md` Markdown files that provide context to the AI agents";
  "approx 12 experiments/hour and approx 100 experiments while you sleep" —
  [github.com/karpathy/autoresearch](https://github.com/karpathy/autoresearch) [C, primary]
- Eight-agent nanochat "research org" experiment, 2026-02-27: "it doesn't work and it's a mess" —
  [X post](https://x.com/karpathy/status/2027521323275325622) [D, see Q3]
- Sequoia AI Ascent fireside, 2026-04-30 (video: [YouTube 96jN2OCOfLs](https://www.youtube.com/watch?v=96jN2OCOfLs)): "you can outsource your thinking, but you can't outsource your
  understanding."; agent code chunks became "larger, more coherent, and more reliable"; agents are
  "fallible and stochastic"; the summary lists spec design, diff review and eval design as the
  human skills — [StartupHub.ai](https://www.startuphub.ai/ai-news/ai-figures/2026/figure-andrej-karpathy-agentic-engineering-sequoia-2026-07-31) [C; quotes from his blog summary as relayed, not checked against video]
- Secondary reports that he "hasn't typed a line of code since December 2025" and runs "up to 20"
  agents in parallel come from podcast coverage and are not verified against a primary source —
  [htek.dev](https://htek.dev/articles/karpathy-directs-ai-agents-december-shift), [Forbes 2026-03-22](https://www.forbes.com/sites/josipamajic/2026/03/22/ai-agents-wrote-80-of-karpathys-code-junior-developers-are-paying-the-price/) [D, unverified]

### Inferences

- autoresearch is a one-writer, one-file, one-metric harness with a deterministic keep/discard gate:
  exactly the single-writer plus deterministic-evaluator shape H10 proposes, at research scale. His
  eight-agent org experiment failing in the same month is the counterexample for free-form
  multi-agent coordination. Together they are the strongest practitioner evidence for H7.
- The "autonomy slider" maps directly onto North's review dials (autopilot vs review_drafts) and
  decision cards; "make verification fast" maps onto evidence rows with screenshots rather than
  transcripts.
- His reversal between October 2025 and February 2026 is a warning for the blueprint: rules that
  encode model limitations (chunk size, reset frequency) must be dated and re-tested per model
  generation, which is also Anthropic's 2026 finding.

### Gaps

- I could not fetch the primary X posts (HTTP 402) or the full YC transcript; exact wording for
  "keep AI on the leash" and "small incremental chunks" rests on Business Insider's report.
- No Karpathy source states a preferred diff size or review cadence in numbers.

---

## Q5. Other harness designs: topology, context strategy, verification, evals

### Takeaway

Every shipping coding harness is a single decision-maker per task. Where parallelism exists (Codex
cloud, Cursor cloud agents, Jules, Devin, Claude agent view) it is task-level: one isolated VM or
worktree per task, one branch or PR per task, a human merging. Internal structure varies: Aider
splits proposer and editor; OpenHands and Amp add a critic or oracle; SWE-agent and Factory argue
the tool interface (ACI) and harness matter more than the model, with measured ablations
(+10.7 points from the ACI; 60.6% -> 66.4% from best-of-5 with a trained critic).

### Cited Findings

- OpenAI Codex cloud: "Each task has its own workspace"; multiple tasks start from one published
  environment with separate working state; environment setup is agent-assisted then published;
  configurable internet presets and network secrets; output is reviewed as changed files and test
  results then committed or opened as a PR — [Codex cloud docs](https://learn.chatgpt.com/docs/cloud) [B]
- Codex AGENTS.md discovery: per directory it checks `AGENTS.override.md`, then `AGENTS.md`, then
  `project_doc_fallback_filenames`; files concatenate root-down so closer files appear later; stops
  at `project_doc_max_bytes` (32 KiB default) — [Codex AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md) [B; via search summary of the official page]
- OpenAI harness engineering write-up (as summarized by InfoQ, primary page 403): five months,
  ~1M lines, "without any manually written source code"; docs directory with maps, plans and specs
  "serve as the single source of truth for agents"; architecture "mechanically enforced with linters
  and CI validation", dependency order Types -> Config -> Repo -> Service -> Runtime -> UI; agents
  use logs, metrics and spans to reproduce bugs; humans shift to "designing environments,
  specifying intent, and providing structured feedback" —
  [InfoQ 2026-02](https://www.infoq.com/news/2026/02/openai-harness-engineering-codex) [B/C; secondary of a first-party account]
- Cursor cloud agents (formerly background agents): "isolated VM", repo cloned on a separate branch,
  "merge-ready" PRs with screenshots, videos and logs as artifacts, "You can run as many agents as
  you want in parallel", user takes remote-desktop control to test; environment from
  `.cursor/environment.json` — [Cursor cloud agent docs](https://cursor.com/docs/cloud-agent) [B]
- Cursor rules: `.cursor/rules/*.mdc` with Always Apply / glob-attached / Apply Intelligently /
  Manual types; `AGENTS.md` as "a simple alternative"; `.cursorrules` deprecated —
  [Cursor rules docs](https://cursor.com/docs/context/rules) [B]
- Devin (Cognition): "Tasks with test suites, CI checks, or verifiable outcomes yield the best
  results"; "if a task would take you three hours or less, Devin can most likely do it. For longer
  tasks, break them into smaller sessions."; Devin "can spin up your app locally, click through the
  UI, take screenshots, record screen recordings, and QA its own changes before opening a PR";
  Devin Review and Auto-Fix respond to CI and review comments; parallel via managed Devins/API —
  [When to use Devin](https://docs.devin.ai/essential-guidelines/when-to-use-devin) [B]
- Devin Interactive Planning: initial assessment (files, findings, open questions), then a detailed
  plan with code citations deep-linked into the IDE; "Devin waits thirty seconds for feedback before
  automatically proceeding" by default — [Devin docs](https://docs.devin.ai/work-with-devin/interactive-planning) [B; via search summary, direct fetch returned the tutorial index]
- Google Jules: shows a plan before changing code, user edits plan before/during/after; each task in
  its own cloud VM with the full repo cloned; several tasks at once; Gemini 2.5 Pro at launch —
  [InfoQ 2025-08](https://www.infoq.com/news/2025/08/google-jules), [ZenML LLMOps DB](https://www.zenml.io/llmops-database/parallel-asynchronous-ai-coding-agents-for-development-workflows) [C]
- Amp (Sourcegraph): "Each subagent has its own context window"; "They work in isolation, so they
  can't communicate with each other, you can't guide them mid-task"; "The main agent only receives
  their final summary"; Oracle "handles difficult reasoning and planning questions"; Librarian
  "researches external codebases"; Amp "uses different models for different kinds of work" —
  [Amp models and subagents](https://ampcode.com/docs/models-and-subagents) [B]
- Aider architect/editor: the architect model "proposes how to solve the problem", the editor model
  "turns that proposal into specific file edits"; suits models that struggle to both propose and
  specify edits; costs two LLM requests; the page cites no benchmark number —
  [Aider modes](https://aider.chat/docs/usage/modes.html) [B]
- SWE-agent (NeurIPS 2024): pass@1 12.47% of 2,294 SWE-bench tasks with GPT-4 Turbo; on SWE-bench
  Lite the ACI "solves 10.7 percentage points more instances than the baseline agent" using only the
  shell; design: guardrails against common mistakes, "specific, concise feedback" per command —
  [NeurIPS proceedings](https://papers.neurips.cc/paper_files/paper/2024/hash/5a7c947568c1b1328ccc5230172e1e7c-Abstract-Conference.html) [A]
- OpenHands (2025-04-17): "log-linear performance improvement from 60.6% on a single trajectory
  rollout to 66.4% with five attempts" on SWE-bench Verified with Claude 3.7 Sonnet; critic is a
  Qwen 2.5 Coder 32B fine-tuned on trajectories with a TD objective from the final test result;
  "we trained a dedicated critic model, which we found provided more effective results" than
  prompt-based reranking — [OpenHands blog](https://www.openhands.dev/blog/sota-on-swe-bench-verified-with-inference-time-scaling-and-critic-model) [A, self-reported]
- Factory Droid (2025-09-25): Terminal-Bench "58.75%"; "Agent design, not just choice of model, is
  the decisive factor"; "the right agent framework can lead to greater improvements than model
  selection"; three-tier prompting (tool descriptions, system prompt, system notifications; the
  notifications tier "proved particularly crucial"); "Strictly limiting the tool repertoire to
  essential operations"; collects system context at session start; tuned timeouts; five runs per
  model, all submitted — [Factory](https://factory.com/news/terminal-bench) [B, self-reported]

### Inferences

- No shipping coding harness lets two agents write the same tree concurrently; the industry's
  parallel unit is a task with its own checkout. This is the design North should copy at the Inngest
  layer: one `query()` per task, one worktree per task, deterministic gates per task.
- The two measured gains that transfer to North are cheap: a trained or at least separate critic
  choosing among candidates (+5.8 points at N=5), and an agent-computer interface with guardrails and
  concise feedback (+10.7 points). Both are harness changes, not model changes.
- Every harness except Aider puts verification outside the generator (CI, browser QA, critic,
  evaluator). Aider's architect/editor split addresses edit reliability, not correctness.

### Gaps

- Codex cloud, Cursor, Jules and Devin publish no eval numbers for their orchestration choices.
- Amp's oracle model identity and Factory's internal architecture are not disclosed.

---

## Q6. Context management evidence: context rot, lost in the middle, multi-turn degradation, compaction, progress files, memory tools, skills vs always-on docs (H6, H9)

### Takeaway

Three independent studies show that more context and more turns both degrade output: Chroma's 18
models degrade with input length even on trivial tasks and do better on ~300-token focused prompts
than ~113k-token full prompts; "Lost in the Middle" shows a U-shaped curve with >20% drops for
GPT-3.5-Turbo; Laban et al. show a 39% average multi-turn drop across 15 LLMs, driven by a 112% rise
in unreliability, with the recommendation to restart with consolidated instructions. Vendors
responded with compaction, progress files and memory tools; the memory tool's own system prompt says
"ASSUME INTERRUPTION: Your context window might be reset at any moment."

### Cited Findings

- Chroma "Context Rot" (Hong, Troynikov, Huber, 2025-07-14): 18 LLMs, 8 input lengths, 11 needle
  positions, 194,480 calls; "Across all experiments, model performance consistently degrades with
  increasing input length."; lower needle-question similarity degrades faster; one distractor hurts,
  four hurt more; shuffled haystacks beat coherent ones on all 18 models; LongMemEval: 306 prompts
  averaging ~113k tokens full vs ~300 tokens focused, "significantly higher performance on focused
  prompts compared to full prompts", Claude models show the largest gap from abstentions —
  [Chroma](https://www.trychroma.com/research/context-rot) [A]
- "Lost in the Middle" (Liu et al., TACL 2023): "we observe a distinctive U-shaped performance
  curve"; "performance is often highest when relevant information occurs at the beginning or end of
  the input context"; "GPT-3.5-Turbo's multi-document QA performance can drop by more than 20%",
  falling below its 56.1% closed-book score in the worst case —
  [arXiv 2307.03172](https://arxiv.org/html/2307.03172) [A]
- "LLMs Get Lost In Multi-Turn Conversation" (Laban, Hayashi, Zhou, Neville, 2025-05-09): 15 LLMs
  from eight families, 200,000+ simulated conversations, "an average drop of 39% across six
  generation tasks"; aptitude drop "non-significant ... average drop of 16%" while "unreliability
  skyrockets with an average increase of 112%"; "when LLMs take a wrong turn in a conversation, they
  get lost and do not recover"; recommendations: "If time allows, try again" ("starting a new
  conversation that repeats the same information might yield significantly better outcomes") and
  "Consolidate before retrying" — [arXiv 2505.06120](https://arxiv.org/html/2505.06120) [A]
- Vendor echo: "LLM performance degrades as context fills. When the context window is getting full,
  Claude may start 'forgetting' earlier instructions or making more mistakes." and "A clean session
  with a better prompt almost always outperforms a long session with accumulated corrections." —
  [Best practices](https://code.claude.com/docs/en/best-practices) [B]
- Anthropic memory tool (`memory_20250818`, client-side `/memories` directory with view / create /
  str_replace / insert / delete / rename): the API auto-injects "ALWAYS VIEW YOUR MEMORY DIRECTORY
  BEFORE DOING ANYTHING ELSE ... ASSUME INTERRUPTION: Your context window might be reset at any
  moment, so you risk losing any progress that is not recorded in your memory directory."
  Multisession pattern: initializer session writes progress log, feature checklist and startup
  script; each later session reads them first and updates at end; "Work on one feature at a time.
  Mark a feature complete only after end-to-end verification confirms it works, not when the code is
  written." — [Memory tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) [B]
- Memory tool pairs with context editing (client-side tool-result clearing) and server-side
  compaction: "compaction keeps the active context small without client-side bookkeeping, and memory
  preserves the information that must survive summarization" — same source [B]
- Claude Code auto memory: Claude-written, "Per repository, shared across worktrees", first 200
  lines / 25KB loaded every session; subagents can have their own via `memory:` —
  [Memory](https://code.claude.com/docs/en/memory) [B]
- Skills vs always-on docs (H9): "CLAUDE.md is loaded every session, so only include things that
  apply broadly. For domain knowledge or workflows that are only relevant sometimes, use skills
  instead."; "Skills load on-demand only when invoked ... Aim to keep CLAUDE.md under 200 lines" —
  [Best practices](https://code.claude.com/docs/en/best-practices), [Costs](https://code.claude.com/docs/en/costs) [B]
- Codex caps always-on instructions at 32 KiB by default (`project_doc_max_bytes`) and merges
  nested files root-down — [Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md) [B]
- Compaction versus artifacts: compaction "doesn't always pass perfectly clear instructions to the
  next agent", which is why the feature list, progress file and git log exist —
  [Effective harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) [B]

### Inferences

- H6's mechanism is now triangulated: input length alone degrades recall (Chroma), position matters
  (Liu), and turn count alone degrades reliability even when total information is constant (Laban).
  A long build session accumulates all three. Fresh context per feature plus a durable spec removes
  the first and third and makes the second controllable (put the spec and acceptance criteria at the
  start, the current task at the end).
- The Laban result reframes "compaction": a summary that preserves an early wrong assumption
  preserves the "wrong turn". Restart from artifacts (spec, feature list, git) rather than from a
  summary of the conversation when a task has failed twice; Claude Code's own "two corrections, then
  /clear" rule is the same heuristic.
- For H9, the vendor position is nuanced: always-on docs raise adherence only while short; the
  200-line / 25KB / 32KiB limits are the operational definition of "short". The right design is a
  small always-on index (CLAUDE.md pointing at spec IDs and commands) plus on-demand skills, plus
  deterministic hooks for anything that must never be skipped. The agent's failure to invoke
  optional skills (H9's worry) is not measured anywhere I found.

### Gaps

- No study measures compaction quality (what fraction of decisions survive a summary) on coding
  agents.
- No eval compares "progress file + fresh session" against "one long session with auto-compaction"
  on the same feature set with current models; Anthropic's 2026 post reports the second worked on
  Opus 4.5+ but gives no controlled comparison.
- The multi-turn paper tests conversational sharding, not agentic tool loops; transfer to coding
  agents is an inference.

---

## Q7. Cost and latency of each topology; where caching changes the economics

### Takeaway

Published multipliers: agent ~4x chat, research multi-agent ~15x chat, agent teams in plan mode ~7x
a single session, ten background agents ~10x quota, full planner/generator/evaluator harness ~22x a
solo run in dollars (and 18x in wall clock) with a working product at the end. Prompt caching
changes the picture for forks and critics: cache reads cost 5-10% of input (2.5% on Fable 5.1), so
N forks of one briefing cost roughly one prefix plus N suffixes, while independent fresh-context
runs pay full price for their prefix each time.

### Cited Findings

- ~4x and ~15x: [Multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system) [B]
- Agent teams "approximately 7x more tokens than standard sessions when teammates run in plan mode";
  "Token costs scale linearly" with teammates — [Costs](https://code.claude.com/docs/en/costs), [Agent teams](https://code.claude.com/docs/en/agent-teams) [B]
- "ten parallel agents consume quota roughly ten times as fast as one" — [Agent view](https://code.claude.com/docs/en/agent-view) [B]
- $9 / 20 min solo (broken) vs $200 / 6 h harness; $124.70 / 3 h 50 min on Opus 4.6 —
  [Harness design](https://www.anthropic.com/engineering/harness-design-long-running-apps) [A, n=1]
- Cache read 0.1x base (0.05x Opus 5.5 / Sonnet 5.5, 0.025x Fable 5.1 / Mythos 5.1), 5-minute write
  1.25x, 1-hour write 2x; 512-token minimum on current models; prefix must match exactly in order
  tools -> system -> messages; changing `output_config.effort` or thinking config invalidates
  message-level cache — [Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) [B]
- Subagent/teammate requests sit outside the main cache TTL bucket (5 minutes default,
  `subagentPromptCacheTtl: 1h` to extend) — [Agent teams](https://code.claude.com/docs/en/agent-teams) [B]
- Idle compaction fires at ~54 minutes on 200K+ contexts specifically to beat the 1-hour cache
  expiry — [Changelog 2.1.299](https://code.claude.com/docs/en/changelog) [B]
- Best-of-N: 5 attempts for +5.8 points (60.6 -> 66.4), "log-linear" — [OpenHands](https://www.openhands.dev/blog/sota-on-swe-bench-verified-with-inference-time-scaling-and-critic-model) [A]
- Background token use "typically under $0.04 per session"; enterprise average $13/dev/active day —
  [Costs](https://code.claude.com/docs/en/costs) [B]

### Inferences

- Rough per-feature model for North (our arithmetic, to be validated in `packages/evals`): a
  sequential planner -> builder -> evaluator run is ~3 contexts; adding a fresh-context evaluator is
  cheap because the evaluator reads artifacts (diff, screenshots), not the builder's transcript.
  Research fan-out (3-5 Explore subagents, read-only) adds ~1k-2k tokens each to the lead but
  tens of thousands in the subagents. Parallel writers in worktrees add a full context per writer
  plus an integration pass; use only when wall-clock matters more than dollars.
- Forks are the cheap way to get variants (shared cached prefix); independent fresh runs are the
  cheap way to get independence (no shared bias). North should fork for drafts and run fresh for
  critics, never the reverse.
- Keep `effort` and tool lists constant within a role's run: changing either invalidates the message
  cache and silently multiplies input cost.

### Gaps

- No published multiplier for coding fan-out with worktrees versus a sequential single writer.
- The 7x agent-teams figure is for plan-mode teammates; the general-case multiplier is not given.

---

## Deliverable 1: Comparison table of harnesses

| Harness (source date) | Topology | Context strategy | Verification | Human checkpoints | Published numbers |
| --- | --- | --- | --- | --- | --- |
| Claude Code 2.1.302 (2026-10-16) | Single lead; subagents return summaries; fork subagents inherit context; worktree-isolated subagents/sessions; agent teams experimental, not in SDK | CLAUDE.md (<200 lines) + rules + skills on demand; auto memory 200 lines/25KB; auto-compaction, idle compaction, `/clear`; subagents for verbose work | Tests/build as in-prompt checks; `/goal` evaluator; `Stop` hook as deterministic gate; verification subagent in fresh context; `/code-review` | Plan mode approval; permission modes; auto mode classifier; rewind checkpoints | Enterprise $13/dev/day; teams ~7x tokens; 10 bg agents ~10x quota |
| Claude Agent SDK 0.3.302 (2026-10-16) | Same primitives programmatically: `agents`, `maxTurns`, `maxBudgetUsd`, hooks, `outputFormat`, `resume`/`forkSession`, `sessionStore`, sandbox | Same; `autoCompactWindow` per agent; memory tool pattern (initializer, progress log, feature checklist) | Hooks (`Stop` block), structured outputs for rubric scores | `permissionMode`, `canUseTool`, PreToolUse `defer` | none beyond Claude Code |
| Anthropic long-running harness (2025-11) | One agent per session, sequential; initializer then coding agent | JSON feature list, `claude-progress.txt`, `init.sh`, git log; fresh context per session | End-to-end browser test (Puppeteer MCP) before `passes: true` | None in loop (autonomous) | >200 features; no pass rates |
| Anthropic app-dev harness (2026-03) | Planner -> generator -> evaluator, sequential sprints; later single end-of-run evaluation on Opus 4.6 | Context resets on Sonnet 4.5; SDK compaction on Opus 4.5+ | Playwright-driving evaluator, weighted rubric, hard thresholds, 5-15 iterations | None in loop | $9/20 min broken vs $200/6 h; $124.70/3 h 50 on Opus 4.6 |
| Anthropic research system (2025-06) | Orchestrator-workers, 3-5+ parallel read-only subagents, synchronous waits | Lead saves plan to memory before 200k; subagents return condensed results | LLM judge 0-1 + pass/fail; end-state grading | None | +90.2% vs single Opus 4; 15x chat tokens; up to 90% faster |
| Cognition "Don't build multi-agents" (2025-06) / Devin (2026) | Single-threaded linear agent; parallelism only as independent Devin sessions | Dedicated fine-tuned compression model; Devin Wiki/Ask Devin for repo knowledge | Devin runs app, clicks UI, screenshots, records; Devin Review; CI | Interactive Planning with 30 s auto-proceed; PR review | none |
| OpenAI Codex cloud + harness engineering (2026-02) | One sandboxed workspace per task, many tasks in parallel, human merges PRs | AGENTS.md hierarchy (32 KiB cap); docs directory as single source of truth | CI, structural layer tests enforced mechanically; agent-readable telemetry | PR review; environment publish step | ~1M lines in 5 months, no hand-written code (secondary) |
| Cursor cloud agents (2026) | One VM and branch per agent, unlimited parallel | `.cursor/rules` types + AGENTS.md | Artifacts (screenshots, video, logs) on PR; user remote-desktop | PR review; take-over control | none |
| Google Jules (2025) | One VM per task, plan shown first | Repo cloned per task | Tests rerun per plan | Plan edit/approve before execution | none |
| Amp (2026) | Main agent + isolated subagents (parallel, summary back) + Oracle for planning + Librarian | Threads, handoff, multi-model routing | Task subagent does "verification work end to end" | Thread review | none |
| Aider architect/editor | Two-model proposer/editor, single thread | Repo map (not fetched) | Lint/test hooks (not fetched) | Ask mode then code mode | none on modes page |
| SWE-agent (NeurIPS 2024) | Single agent with designed ACI | Windowed file viewer, concise feedback | Benchmark tests | None | 12.47% SWE-bench; +10.7 pp from ACI |
| OpenHands (2025-04) | Single CodeAct agent; best-of-5 + trained critic | n/a | Trained critic predicts test pass | None | 60.6% -> 66.4% SWE-bench Verified |
| Factory Droid (2025-09) | Single agent, minimal tool set, three-tier prompting | System context collected at start | Benchmark harness | n/a | 58.75% Terminal-Bench |
| Karpathy autoresearch (2026-03) | One agent, one editable file, deterministic keep/discard loop | Human edits `program.md`; agent edits `train.py` only | 5-minute training metric, keep if improved | Human reviews log in the morning | ~12 experiments/hour, ~100 overnight |

---

## Deliverable 2: Decision tree for sequential vs parallel vs single-writer execution

Conditions are drawn from the sources above; each node names its evidence.

```
START: a unit of work arrives (feature, bug, research question, review).

1. Does the unit produce code or other writes?
   NO  -> PARALLEL READ-ONLY FAN-OUT is allowed.
          Use Explore-type subagents (Write/Edit denied), 3-5 in parallel, each returning a
          1,000-2,000-token summary to one lead that owns the synthesis.
          [Anthropic research system; context-engineering post; Claude Code Explore agent]
          Cap: effort scaled to complexity (1 agent 3-10 calls for simple; 2-4 agents 10-15 calls
          for comparisons). Expect ~15x chat tokens at full fan-out; use Haiku/Sonnet workers.
   YES -> go to 2.

2. Is the spec machine-checkable and already written (feature list with acceptance criteria,
   spec IDs, status)?
   NO  -> SEQUENTIAL: run the planner alone first (plan mode / read-only) and produce the spec.
          Never fan out writers before the implicit decisions are explicit.
          [Cognition Flappy Bird; Anthropic initializer agent; Claude Code "explore, plan, code"]
   YES -> go to 3.

3. Can the work be partitioned into units with DISJOINT write sets (different files/modules/
   packages), each independently verifiable by a deterministic check?
   NO  -> SINGLE WRITER, SEQUENTIAL. One builder session per feature, fresh context, reads
          spec + progress + git log, implements one feature, runs the check, commits, updates
          progress. Interleaving writers on coupled files has no vendor-supported path.
          [Agent teams doc: "same-file edits ... a single session"; Cognition principle 2]
   YES -> go to 4.

4. Does wall-clock matter more than dollars for this batch, AND is each unit small enough to
   finish inside one context (Devin "XS/S/M", Anthropic "one feature at a time")?
   NO  -> SINGLE WRITER, SEQUENTIAL over the units (cheapest; simplest to audit).
   YES -> PARALLEL WRITERS WITH ISOLATION: one query()/session per unit, each in its own
          worktree (isolation: worktree or --worktree), no shared mutable state, each ending in
          a commit on its own branch. Then exactly ONE integrator session merges in a fixed
          order, re-runs the full deterministic gate (typecheck, lint, unit, integration, smoke)
          and the end-to-end check, and owns any conflict resolution.
          [Worktrees doc; agent view "never pushes to main"; /batch pattern; Codex/Cursor/Jules
          one-task-one-VM; MAST inter-agent misalignment]
          Start with 3-5 parallel units; expect linear token scaling.

5. For EVERY writer path (3 or 4): after the builder reports done, run an INDEPENDENT EVALUATOR
   in fresh context (not a fork), with read-only tools plus browser screenshots of the deployed
   preview, a weighted rubric with hard thresholds, and a Zod-validated structured output.
   Deterministic tools decide pass/fail; the model scores and ranks. The builder never flips
   `passes`; only the evaluator's verified evidence does.
   [Harness design 2026 "agents reliably skew positive"; Best practices "fresh model try to
   refute"; memory tool "Mark a feature complete only after end-to-end verification"]

6. Variants (design directions, alternative implementations): FORK one briefing session N=2-3
   times (shared cached prefix), judge pairwise, keep one. Do not fork the evaluator.
   [Sessions doc forkSession; prompt caching]

7. Failure handling: if a builder fails its gate twice on the same feature, do NOT continue the
   session or compact it. Discard the transcript, keep the artifacts (spec, failing test output,
   evaluator findings), and start a fresh session with consolidated instructions.
   [Laban et al. "try again" / "consolidate"; Best practices "after two failed corrections, /clear"]
```

---

## Deliverable 3: Context-management strategy for a multi-session build (what persists where)

| Layer | What it holds | Who writes | Where it lives | Loaded when | Evidence |
| --- | --- | --- | --- | --- | --- |
| Always-on index (CLAUDE.md, <200 lines) | Commands, non-negotiables, pointers to spec IDs and the feature list; compaction instructions | Humans / orchestrator, rarely | repo root (`CLAUDE.md`), path-scoped `.claude/rules/` | Every session start | Memory doc 200-line target; Best practices "would removing this cause mistakes?" |
| Machine-checkable plan | `features.json`: id, spec IDs, acceptance criteria, dependencies, `passes`, evidence refs | Planner creates; evaluator flips `passes`; builder never edits | repo, versioned | Start of every build/eval session | Effective harnesses (JSON over Markdown; "unacceptable to remove or edit tests") |
| Progress log | What each session did, what is next, known bugs | Each session at end | `claude-progress.txt` or DB row per run | Start of next session with `git log` | Effective harnesses; memory tool multisession pattern |
| Environment bootstrap | `init.sh` / `pnpm dev` recipe, seeded DB, preview URL | Initializer | repo | Every session before work | Effective harnesses |
| Evidence store | Test output, HTTP checks, screenshots, evaluator rubric JSON | Evaluator run and deterministic gates | append-only `evidence` rows + Storage | Read by evaluator and review queue, not by builder's next session | CLAUDE.md non-negotiable 2; Harness design 2026 |
| Skills (on demand) | Stack conventions, rubric playbooks, long how-tos | Humans, vendored and pinned | plugin roots per role | Only when invoked | Best practices "use skills instead"; earlier note's supply-chain rules |
| Deterministic hooks | "No done without evidence", path restrictions, gate() | Engineering | `PreToolUse`, `Stop`, `SubagentStop` | Every tool call / turn end | Best practices "hooks are deterministic"; memory doc "use a PreToolUse hook" |
| Session transcript | Full conversation | SDK | worker disk + `SessionStore` mirror | Only to resume an interrupted run; never as the primary carrier of state | Sessions doc "capture the results you need as application state" |
| Auto memory | Claude's own learnings | Claude | per repo (disable per tenant: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`) | Session start | Memory doc; earlier note's tenant-isolation warning |
| Compaction | Summary of this session's history | SDK | in-context | Approaching window; `autoCompactWindow` lower for subagents | Context-engineering post; changelog 2.1.296 |

Rules that follow:

1. Fresh context per feature is the default (H6). Resume a transcript only to recover an
   interrupted run; everything a later session needs is in the plan, progress log, evidence and git.
2. Put the spec and acceptance criteria at the start of the prompt and the current task at the end
   (U-shaped attention); keep the middle for just-in-time file reads.
3. Subagents for anything verbose (test runs, log reads, doc fetches); only the summary returns.
4. Lower `autoCompactWindow` for subagents than for the lead; let the lead compact rarely and
   restart often.
5. Separate the evaluator's context from the builder's completely: it reads artifacts, not the
   transcript, and is never a fork.
6. Treat CLAUDE.md as an index with hard limits (200 lines) and move everything else to skills or
   hooks; measure adherence by whether behaviour changes when a line is removed.

---

## Deliverable 4: Hypothesis verdicts

| Hypothesis | Verdict from RQ4 evidence | Strength | Key sources |
| --- | --- | --- | --- |
| H6 Fresh context per feature plus durable progress artifacts beats one long session | Supported. Mechanism triangulated by three A-grade studies (length, position, turn count); vendor practice (initializer/progress/feature list; "clean session with a better prompt almost always outperforms"). Caveat: Anthropic 2026 found Opus 4.5+ tolerated long sessions with compaction, so the gap narrows with model generation; durable artifacts stayed necessary in both generations. | A for mechanism; B for practice; no head-to-head on coding | Chroma 2025; Liu 2023; Laban 2025; Effective harnesses 2025; Harness design 2026; Best practices |
| H7 Parallel subagents pay off only for independent, read-heavy work; write-heavy coupled work needs one writer at a time | Supported, with a refinement: parallel writers are acceptable when write sets are disjoint and worktree-isolated, with one integrator. Anthropic and Cognition agree on the invariant (one context per decision); every shipping harness uses one task per checkout. Karpathy's eight-agent org "doesn't work and it's a mess" while his single-writer autoresearch runs 100 experiments a night. | B/C convergent; A from MAST on structural failure causes; no controlled coding comparison | Multi-agent research system; Don't build multi-agents; Agent teams doc; MAST; autoresearch |
| H10 Planner / builder / evaluator split with founder at architectural forks via decision cards | Supported for the split (Anthropic's 2026 harness kept planner and evaluator even when it removed sprints and resets; Claude Code docs recommend fresh-context reviewer; OpenHands critic +5.8 points). Founder-checkpoint shape is consistent with Karpathy's autonomy slider and Devin's plan approval, but no source measures the "architectural forks only" cadence. Cost warning: the full harness was ~22x a solo run in one measured case. | B for the split; C for the checkpoint design; A for critic gains | Harness design 2026; Best practices; OpenHands; Latent.Space S3 recap; Devin Interactive Planning |
| H1 (touched) Independent evaluator with real browser beats self-review | Supported: "agents reliably skew positive when grading their own work"; evaluator drove Playwright; Devin QA clicks the UI. | B | Harness design 2026; Devin docs |
| H9 (touched) Always-on docs raise accuracy more than optional skills | Partially supported and bounded: always-on wins only while short (200 lines / 25KB / 32KiB caps); past that adherence falls. No measurement of skill-invocation failure rate found. | B | Memory doc; Best practices; Codex AGENTS.md |

---

## Deliverable 5: Open questions for the debate round

1. Model-gating of resets: Anthropic removed context resets for Opus 4.5+ and kept them for Sonnet
   4.5. Should North's blueprint make "fresh session per feature" a fixed rule (simpler, auditable)
   or a per-model switch with an eval that re-tests it each model bump? What is the eval?
2. Where exactly does parallel writing start paying off for a solo founder's product? The only
   measured parallel gains are research (+90.2%, 15x tokens). With a $8-per-journey budget, is any
   write-parallelism justified, or only read fan-out?
3. Fork vs fresh for the evaluator: the SDK now defaults to fork subagents. Is a forked evaluator
   (cheaper via cache, but inherits builder reasoning) ever acceptable, e.g. for a pre-screen before
   the independent one?
4. Compaction as a hidden failure carrier: Laban shows wrong early turns persist; does a compaction
   summary transmit the wrong turn? Should North forbid resuming a session after a failed gate and
   always restart from artifacts? What does that cost?
5. H9: nobody has measured how often agents fail to invoke a relevant skill. Should North instrument
   `Skill` invocations against expected invocations in its evals before deciding the CLAUDE.md vs
   skills split?
6. Evaluator leniency drift: both Anthropic and Claude Code docs warn the reviewer either skews
   positive (self) or invents findings (adversarial prompt). What calibration loop against founder
   labels keeps North's evaluator honest, and who owns the rubric thresholds?
7. Cost model validation: the ~3-contexts-per-feature estimate and the 22x harness multiplier are
   from n=1 runs. Which 20-30 golden tasks should `packages/evals` run to produce North's own
   multipliers before the blueprint fixes budgets?
8. Karpathy's reversal (agents "didn't work before December") suggests harness rules decay within
   months. Which rules in this note are model-limit rules (date them) and which are invariants
   (one writer per decision, evidence before done, deterministic gates)?
