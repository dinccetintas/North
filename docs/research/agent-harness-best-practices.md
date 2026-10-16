# Agent and harness best practices, applied to North

Research date 2026-10-16. Scope: how North should run agents (Claude Agent SDK, hosting, orchestration,
evaluation, third-party skills) so that departments draft, critique, revise and wait for review, within
a dev/test budget under $100/month. Every claim carries a source; "unverified" marks what could not be checked.

## Summary

1. North pins `@anthropic-ai/claude-agent-sdk` 0.3.299; 0.3.301 is current (npm, 2026-10-15) and bundles
   Claude Code 2.1.301. Everything the founder asked for (skills, plugins, subagents, live streaming,
   forks, MCP over HTTP) exists in the installed major line; no framework change is needed [S1][S2].
2. Load skills with `plugins: [{ type: "local", path, skipMcpDiscovery: true }]` plus a per-role
   `skills: [...]` list, keeping `settingSources: []`. The `skills` option is a context filter, not a
   sandbox: unlisted skill files stay readable, so mount only the role's own plugin dirs [S3][S4][S2].
3. `settingSources: []` does not isolate tenants on its own: auto memory and `~/.claude.json` still load.
   North passes `HOME` through and sets neither `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` nor a per-company
   `CLAUDE_CONFIG_DIR` [S5][S6]. Fix this before skills arrive.
4. Session transcripts live on the worker's local disk. Resuming a parked task on another Fly machine
   needs a `sessionStore` adapter (Anthropic ships a Postgres reference adapter) [S7][S8].
5. The live work view is `includePartialMessages: true` (raw API stream events), `forwardSubagentText`
   and `agentProgressSummaries`; persist coarse events, not tokens [S9][S2].
6. Anthropic's 2026 harness results say: separate generator and evaluator, give the evaluator a browser
   (Playwright screenshots) and a weighted rubric with hard thresholds, and remove scaffolding a newer
   model no longer needs. Self-critique by the generator is too lenient [S20].
7. Do not adopt LangGraph. Model each department workflow as an Inngest function plus a pure state
   machine in `packages/core`; Inngest already gives durable steps, retries, `cancelOn` and waits [S30][S31].
8. Human review must reuse North's settle pattern (answer stored in the DB, then an event starts a settle
   function), because `step.waitForEvent` never sees events sent before the wait starts [S31].
9. Evaluation fits the budget: Haiku 5.5 costs $0.10/$0.50 per MTok and Sonnet 5.5 $2/$10, Batch API
   halves both, cache hits on Sonnet 5.5 cost 5% of input [S40]. A rubric judge call is about $0.002 on
   Haiku and $0.04 on Sonnet; the cost driver is generating outputs, not judging them.
10. Third-party skills are executable supply chain: 341 of 2,857 ClawHub skills were malicious in
    February 2026 [S50]. Vendor with pinned SHAs, review every file, strip `hooks:` and `` !`cmd` ``
    blocks, set `disableSkillShellExecution`, and keep North's `PreToolUse` gate as the only allow path [S12][S51].

## Findings

### 1. Claude Agent SDK (TypeScript), 0.3.301

Option names below are read from `sdk.d.ts` in the 0.3.301 tarball [S2] and the SDK docs.

| Need | Exact option / API | Notes that matter for North |
| --- | --- | --- |
| Skills | `settingSources: SettingSource[]` (`'user' \| 'project' \| 'local'`), `skills?: string[] \| 'all'`, `plugins` | With `skills` set, the SDK adds the `Skill` tool to `allowedTools`; with an explicit `tools` list you must include `"Skill"`. Names are exact; plugin skills are `plugin:skill`; wildcards throw since 0.3.221. The `init` message lists loaded `skills` and `plugins` [S3][S4]. No programmatic skill registration exists [S3]. |
| Plugins | `plugins: SdkPluginConfig[]` = `{ type: 'local', path, skipMcpDiscovery? }` | A plugin root holds `skills/`, `agents/`, `hooks/hooks.json`, `.mcp.json`. `skipMcpDiscovery: true` stops a plugin from starting its own MCP servers. A missing path is skipped silently; check `plugin_errors` [S4][S2]. |
| Subagents | `agents: Record<string, AgentDefinition>`; invoked via the `Agent` tool (`Task` in the init tool list) | Fields: `description`, `prompt`, `tools`, `disallowedTools`, `model`, `skills` (preloaded), `mcpServers`, `maxTurns`, `effort`, `permissionMode`, `background`, `omitClaudeMd`, `autoCompactWindow` (0.3.296+). Subagents may nest 3 deep by default; cap with `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` and `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (default 20); `maxBudgetUsd` covers subagent spend. Messages carry `parent_tool_use_id` and `agent_id` (0.3.292+) [S10]. |
| Hooks | `hooks: Partial<Record<HookEvent, HookCallbackMatcher[]>>` | 33 events incl. `PreToolUse`, `PostToolUse`, `PostToolBatch`, `Stop`, `SubagentStart/Stop`, `PermissionDenied` [S2]. `PreToolUse` may return `permissionDecision: "defer"`, ending the turn with `stop_reason: "tool_deferred"` for later resume; `PostToolUse` may set `additionalContext` or `updatedToolOutput`; deny beats every allow [S11]. `Stop`/`SubagentStop` accept `decision: "block"` + `reason` to send the agent back to work [S12]. |
| Structured output | `outputFormat: { type: 'json_schema', schema }` | JSON Schema draft-07 (Zod: `z.toJSONSchema(s, { target: "draft-7" })`). Failure subtype `error_max_structured_output_retries`; a `success` without `structured_output` is also a failure. With partial streaming the JSON streams unvalidated [S13]. |
| Sessions | `resume`, `forkSession`, `continue`, `sessionId`, `resumeSessionAt`, `persistSession`, `sessionStore` | Files under `~/.claude/projects/<encoded-cwd>/`; resume works on the same machine only unless a `SessionStore` (`append`, `load`, optional `listSubkeys` for subagents) mirrors them. `persistSession: false` and file checkpointing conflict with a store [S7][S8]. A recorded system prompt is replayed as-is on resume (`systemPrompt.snapshot`), so revision instructions belong in the user turn [S2]. |
| Live view | `includePartialMessages`, `forwardSubagentText`, `agentProgressSummaries`, `includeHookEvents` | `stream_event` carries raw API events (`content_block_start/delta/stop`); subagent token deltas are not forwarded; progress summaries fork a running subagent about every 30 s [S9][S2]. |
| Permissions | `permissionMode`: `default`, `acceptEdits`, `bypassPermissions`, `plan`, `dontAsk`, `auto`; `canUseTool`; `permissionPrompts: 'host' \| 'none'` | Order: hooks, deny rules, ask rules, mode, allow rules, `canUseTool`. In `dontAsk`, calls that need no approval still run (reads in cwd, `Agent`). Bare allow entries never reach `canUseTool`. Since 0.3.286 omitting the mode may start in `auto`, so keep passing it [S14]. |
| MCP | `mcpServers`: `{type:'sdk'}` via `createSdkMcpServer`, stdio `{command,args,env}`, `{type:'sse'\|'http', url, headers, tools, timeout, alwaysLoad}` | The SDK never runs an OAuth flow: run OAuth in North, pass `Authorization: Bearer` in `headers`; a challenged server reports `needs-auth`. Tool search defers MCP tools by default. Results over 25,000 tokens spill to a file. 0.3.301 adds per-tool `always_ask`/`always_deny` for SDK servers [S15][S2][S1]. |
| Sandbox | `sandbox: { enabled, failIfUnavailable, network: { allowedDomains, deniedDomains }, filesystem: { allowWrite, denyRead, ... }, credentials }` | OS-level (bubblewrap/Seatbelt) for Bash; shares the host kernel and does not inspect TLS [S16][S2]. |
| Cost limits | `maxTurns`, `maxBudgetUsd`, `taskBudget: { total }` (alpha, `task-budgets-2026-03-13`), `effort`, `thinking`, `fallbackModel` | `total_cost_usd` and `modelUsage` are client-side estimates; per-step `output_tokens` is a placeholder; read totals from the result [S17][S2]. |
| Prompt caching | automatic | `ENABLE_PROMPT_CACHING_1H=1`, `CLAUDE_CODE_PROMPT_CACHE_TTL`, `CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL` choose 5 m or 1 h TTL; caches are per workspace [S17][S41]. |
| Tool surface | `tools: string[] \| { type: 'preset', preset: 'claude_code' }` | `[]` disables all built-ins. North passes no `tools`, so every built-in definition is sent and then denied by the hook [S2]. |

Gaps in North's runtime (`packages/agents/src/runtime/claude-agent-sdk.ts`, `tool-policy.ts`):
- `effort` is never passed; `EFFORT_BY_ALIAS` is used only by `llm/client.ts`. Runs get whatever
  default the bundled Claude Code picks (the API default on Opus 5.5 is `medium`), not the per-alias
  value; engineering's intended `xhigh` is not applied [S42][S2].
- No `tools`, no `skills: []`: bundled skills may still be listed, and all built-in tool schemas cost
  context on every turn [S3][S2].
- `mapResult` has a `TODO(M2)` for `waiting_decision`; the `defer` hook decision is the native mechanism [S11].
- The audit hook checks only names. Adding `Skill` and `Read` needs path checks (skill files and the task
  workspace only), because `skills` does not restrict file access [S2].

### 2. Claude Managed Agents and other hosted options

Managed Agents (beta header `managed-agents-2026-04-01`) hosts the agent loop and a per-session
container. Agents are versioned objects; sessions pin a version [S21]. Features North would otherwise
build: **outcomes** (`user.define_outcome` with a rubric; a separate grader with its own context runs
iterate/grade/revise up to `max_iterations`, default 3, max 20) [S22]; multiagent rosters [S23]; skills
(Anthropic or Skills API, max 500 per session) [S24]; vault credentials substituted at egress; hard
dollar session budgets; self-hosted sandboxes where tool execution runs on your machines over an
outbound-only work queue [S25]. Runtime costs $0.08 per session-hour plus tokens [S40].

When it fits North: long engineering builds that outgrow a Fly worker (the SDK needs about 1 GiB RAM and
5 GiB disk per agent [S6]) and rubric-driven single deliverables. Why not now: every tool that touches
the outside world must still pass `AuthorityEngine.gate()`, which means custom tools answered by North
or `always_ask` confirmations, and the kill switch becomes a remote `user.interrupt`; the MockRuntime
and sandbox-mode tests would need a second path. ADR 0004 already keeps it as a later adapter.

### 3. Anthropic's published patterns, as rules

| Source | Rule North should apply |
| --- | --- |
| Building effective agents (2024-12-19) [S26] | Prefer workflows (fixed code paths) over autonomous agents when the steps are known. Evaluator-optimizer fits when criteria are clear and iteration measurably helps; orchestrator-workers fits when subtasks are not known in advance. Keep frameworks thin; poka-yoke tool arguments (absolute paths, enums). |
| Multi-agent research system (2025-06-13) [S27] | Multi-agent runs use about 15x chat tokens; use them only for breadth-first, parallel work. Delegate with objective, output format, tools and boundaries. Scale effort to complexity (simple: 1 agent, 3-10 tool calls). Judge with one LLM call giving 0.0-1.0 plus pass/fail; start with about 20 real queries; grade end states, not paths; resume from failure points. |
| Writing tools for agents (2025-09-11) [S28] | Few, consolidated tools; namespaced names; human-readable fields over IDs; `response_format` concise/detailed; paginate and truncate; actionable error text; evaluate tools with held-out tasks. |
| Context engineering (2025-09-29) [S29] | Smallest high-signal context; system prompt at the "right altitude"; few canonical examples; just-in-time retrieval; subagents return 1,000-2,000-token summaries; structured notes outside context for long work. |
| Agent Skills post (2025-10-16) and best practices [S18][S19] | Three-level progressive disclosure. `name` max 64 chars, lowercase/digits/hyphens; `description` max 1,024 chars, third person, what plus when. Body under 500 lines; references one level deep; build three evaluations before writing; test on Haiku, Sonnet and Opus; scripts for deterministic steps; plan-validate-execute for risky batches. |
| Effective harnesses for long-running agents (2025-11-26) [S32] | Initializer writes a JSON feature list (`passes: false`), `init.sh` and a progress file; each later session reads git log and progress, picks one feature, tests end to end in a browser, commits, updates progress. JSON resists corruption better than Markdown. |
| Demystifying evals (2026-01-09) [S33] | One isolated judge per dimension; allow "unknown"; calibrate against humans; pass@k vs pass^k; capability evals start low, regression evals stay near 100%; 20-50 tasks from real failures; read transcripts. |
| Harness design for long-running apps (2026-03-24) [S20] | Planner, generator and a separate evaluator. The frontend evaluator drove the live page with Playwright MCP, screenshotted and scored design quality, originality, craft and functionality (the first two weighted higher), 5-15 iterations. Sprint contracts with hard per-criterion thresholds. Solo run: 20 min, $9, broken; full harness: 6 h, $200. On newer models sprints and context resets were removed and the evaluator moved to one end-of-run pass. |

### 4. "Harness engineering" in 2026

The term means everything around the model: guides that steer before the agent acts (instructions,
skills, conventions, bootstrap scripts) and sensors that check after (tests, linters, type checks,
browser checks, LLM judges), each either computational or inferential [S34]. OpenAI's write-up of a
five-month Codex project (about one million lines, no hand-written code) stresses docs as the system of
record, mechanically enforced architecture (structural tests on a fixed layer order), agents that
reproduce bugs and iterate on PRs, and agent-readable logs and metrics; the primary page returned 403 to
our fetcher, so details come from InfoQ [S35][S36]. Shared design rules: verification loops on every
change (cheap computational sensors always, inferential ones where judgment matters); progress and
feature-list files outside context; test-first; an evaluator separate from the generator that looks at
real screenshots; error messages written as instructions for the next attempt; fix the harness when a
mistake repeats; delete scaffolding a new model no longer needs [S20][S34].

### 5. Graph orchestration vs Inngest

LangGraph.js 1.5.0 (MIT) offers state graphs with cycles, checkpointers and `interrupt()`/`Command({ resume })`
for human input. On resume the interrupted node re-runs from its start, so side effects before the
interrupt must be idempotent, and a durable checkpointer is required [S37][S38]. North already has a
durable engine: Inngest 4.24.0 steps memoize, retry and cancel on the kill switch [S30]. Running
LangGraph inside Inngest would duplicate durability (two checkpoint stores, two retry models) and move
state outside the RLS-protected database. Inngest AgentKit 0.13.2 (Apache-2.0) has not published since
February 2026; XState 5.33.2 (MIT) and Mastra 1.78.0 (Apache-2.0) are alternatives [S38].

A draft/critique/revise/review/publish loop is a small finite state machine: about seven states and a
bounded revision counter. It belongs in `packages/core` as a pure, Zod-validated transition function
(the immutability and one-module rules in CLAUDE.md), driven by an Inngest function whose steps call it.
The human review step must not use an in-run `waitForEvent`: a review answered before the wait starts is
lost [S31], and a cancelled run would strand the answer. North's `settleDecisionFn` already solves this
for cards; the review queue should copy it.

### 6. Evaluating agent output within $100/month

Prices per MTok (input / output / cache hit): Opus 5.5 $4 / $20 / $0.20; Sonnet 5.5 $2 / $10 / $0.10;
Haiku 5.5 $0.10 / $0.50 / $0.01 for prompts up to 100k tokens; Batch API 50% off [S40]. A judge call
with two screenshots, a rubric and the artifact (about 11k input, 1.5k output) costs about $0.0019 on
Haiku 5.5 and $0.037 on Sonnet 5.5 (our arithmetic). Methods: per-dimension rubric judges with
anchored scales and an "unknown" option [S33]; pairwise comparison for picking among variants
(promptfoo `select-best`) [S43]; deterministic sensors first (HTTP 200, Lighthouse/axe, contrast, link
checks). Keep budgets by routing (Haiku pre-screen, Sonnet for visual design judgment, Opus never as
judge in tests), by judging stored golden outputs instead of regenerating them, by batching nightly
suites, and by a Console workspace spend limit on a dedicated dev workspace [S41].

### 7. Third-party skill security

A skill is instructions plus code. Claude Code skill frontmatter can `allowed-tools` (pre-approves, does
not restrict, and is not gated by workspace trust), register `hooks`, change `model`, and run
`` !`command` `` blocks before the model reads the skill; `disableSkillShellExecution: true` replaces
those commands with a placeholder [S12]. Anthropic's guidance: install from trusted sources, audit
scripts, dependencies and bundled resources, and look for instructions to reach untrusted hosts [S18].
In the wild: Koi Security found 341 malicious skills among 2,857 on ClawHub (Feb 2026), mostly fake
"prerequisite" install steps delivering a credential stealer [S50]; Snyk's ToxicSkills audit of 3,984
skills reported 13.4% with a critical issue (figures differ across reports) [S51]. Anthropic's own
`anthropics/skills` repo mixes Apache-2.0 and source-available document skills and is labelled "for
demonstration and educational purposes" [S52]. Repository skills are part of the trust boundary [S24].

## Comparison tables

**Where the agent loop runs**

| | Agent SDK on the Fly worker (today) | Managed Agents, cloud container | Managed Agents, self-hosted sandbox |
| --- | --- | --- | --- |
| Gate on every external action | Native (`PreToolUse` hook + in-process tools) | Custom tools / `always_ask` round trip | Same as cloud |
| Kill switch in 5 s | Abort controller + hook deny, local | Remote `user.interrupt` | Remote interrupt |
| Tests on MockRuntime | Yes | Needs new adapter + fakes | Needs new adapter |
| Rubric iterate loop | Build it (this doc) | Built in (outcomes) | Built in |
| Infra cost | Fly machine time | $0.08/session-hour [S40] | Your machines |
| Transcript location | Worker disk / own store | Anthropic | Anthropic (tool I/O), you (files) |

**Orchestration**

| | Inngest function + core state machine | LangGraph.js | XState inside Inngest |
| --- | --- | --- | --- |
| Durability | Inngest steps (have it) | Own checkpointer (second store) | Inngest |
| Human review | DB answer + settle event (pattern exists) | `interrupt()`; node re-runs | DB + settle event |
| New dependency | None | `@langchain/langgraph` | `xstate` |
| Testability | Pure function, Vitest | Graph harness | Actor tests |

**Eval tooling**

| Tool | License / cost | Fit for North |
| --- | --- | --- |
| In-repo judge runner on `@anthropic-ai/sdk` | Already a dependency; token cost only | Default: Vitest suite, Batch API, Zod-validated scores |
| promptfoo 0.124.1 | MIT; acquired by OpenAI March 2026, stated to stay MIT [S44] | Optional: prompt-injection red-team configs, `llm-rubric`, `select-best` |
| Langfuse (3.39 in stack) | Hobby free: 50k units/mo, 30 days, LLM-as-judge included; Core $29 [S45] | Traces, human annotation of judge calibration |
| Braintrust | Starter free: 1 GB, 10k scores, 14 days; Pro $249/mo [S46] | Skip: Pro alone exceeds the budget |

## Recommendations for North (ranked)

1. **Harden the runtime before adding skills** (small, P0). In `claude-agent-sdk.ts`: bump to 0.3.301
   (read the 0.3.300 note: hook `updatedInput` now drops unknown keys [S1]); pass `effort:
   EFFORT_BY_ALIAS[role.model]`; pass `tools` built from `tool-policy.ts` (explicit built-ins only);
   default `skills: []`; add `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`, a per-company `CLAUDE_CONFIG_DIR` and
   `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` to the subprocess env; pass `settings: { disableSkillShellExecution: true }`.
   Add a `SessionStore` adapter (copy the Postgres reference adapter [S8]) in
   `packages/agents/src/runtime/session-store.ts` over a new append-only `agent_session_entries` table in
   `packages/db`. Tests: init message lists no unexpected skills, tools or plugins.
2. **Native `waiting_decision`**: in-process North tools call the gate; on a `card` result the
   `PreToolUse` hook returns `defer`, the run ends with `tool_deferred`, `mapResult` returns
   `waiting_decision`, and `settleDecisionFn` resumes through the session store [S11][S7].
3. **Live work view**: add `onEvent` to `ClaudeAgentSdkDeps`, enable `includePartialMessages`,
   `forwardSubagentText`, `agentProgressSummaries`. The worker (`apps/worker/src/services/execute-task.ts`)
   writes coarse events (text block done, tool start/end with redacted input, `Skill` invocations,
   screenshot Storage paths, subagent progress) to an append-only `agent_run_events` table the web app
   reads through Supabase Realtime under RLS. Token deltas, if wanted, go through Inngest Realtime
   (`inngest.realtime.publish`) and are never stored [S39].
4. **Department workflow = Inngest function + core state machine.** `packages/core/src/workflow/review-loop.ts`:
   states `briefing, drafting, critiquing, revising, awaiting_review, approved, publishing, done, failed`,
   events `draft_ready, critique_passed, critique_failed, revision_limit, review_approved,
   review_commented, gate_result`. `apps/worker/src/inngest/review-functions.ts`: `run-department-workflow`
   (steps call the reducer and `runtime.run`, `cancelOn` kill switch) and `settle-review` (triggered by
   `review/answered`, reads the stored verdict). Reviews live in a new `review_items` table, never in the
   decision quota; anything public, paid, first-contact or go-live still becomes a K2 card through `gate()`.
   No LangGraph.
5. **Critic as a separate run, not self-critique** [S20][S27]. A `critic` invocation is a fresh `query()`
   with read-only tools, `effort: "low"`, `outputFormat` = rubric score schema, and an in-process tool
   `mcp__north__page_screenshot` that the worker implements with Playwright 1.64 against the preview URL
   (agent gets images, never a browser or Bash). Rubrics live in `agents/rubrics/*.yaml` with weights,
   anchored 1-5 scales, hard thresholds and an "unknown" option. Haiku 5.5 pre-screens; Sonnet 5.5 judges
   visual design; at most two revisions, then the best-scoring draft goes to review with its scores.
6. **Variants by fork.** Run one `briefing` turn, then `forkSession: true` N times (2-3) with different
   direction prompts; forks reuse the cached prefix. A pairwise Sonnet judge orders them; the user picks in
   the review queue; inline comments resume the chosen fork with the comments as the next user turn [S7].
7. **Skills: vendored plugins, mounted per role.** `skills/vendor/<source>/` (one plugin root each) and
   `skills/north/`; `skills/skills.lock.yaml` records repo URL, commit SHA, tree SHA-256, license,
   reviewer, date and flags (`has_scripts`, `has_hooks`, `has_shell_injection`). A CI test in
   `packages/agents/test/skills-lock.test.ts` fails on drift, a missing license, frontmatter `hooks`,
   `` !` `` blocks, or URLs outside an allowlist. The runtime passes only the plugin roots and skill names the
   role lists. `tool-policy.ts` maps a role's skills to `Skill` plus path-scoped `Read`, checked in
   `auditHook` against the plugin roots and the task workspace.
8. **Extend `agents/*.yaml`** (`packages/agents/src/roles/schema.ts`, Zod; all new fields optional so the
   eight roles still load):

```yaml
role: design
title: Design
mission: Brand identity, website directions, ad creatives.
max_action_tier: K0
model: drafter                # alias only; IDs stay in packages/core/src/models.ts
effort: medium                # optional override of EFFORT_BY_ALIAS
max_turns: 30
max_budget_usd: 2.00          # per run; the workflow has its own cap below
tools: [memory.search, artifacts.write, artifacts.read, images.generate]
outputs: [BrandKit, ScreenDesigns, AdCreatives]
review_mode: review_drafts    # default dial: autopilot | review_drafts; company override in DB
skills:                       # names must exist in skills/skills.lock.yaml
  - frontend-design:frontend-design
  - north:brand-identity
subagents:                    # internal helpers of this role's run, never cross-role handoffs
  - name: reference-scout
    description: Finds 5-8 visual references for a brief and returns one summary.
    prompt_file: agents/prompts/design/reference-scout.md
    model: classifier
    tools: [web.search, web.fetch]
    max_turns: 8
workflow:
  kind: draft_critique_revise # single_shot | draft_critique_revise
  variants: { count: 3, strategy: fork }
  max_revisions: 2
  max_workflow_budget_usd: 1.50
  critic:
    model: drafter
    effort: low
    prescreen_model: classifier
    rubric: agents/rubrics/website-direction.yaml
    pass_score: 0.75          # weighted, 0..1
    hard_criteria: [contrast_aa, single_primary_cta, renders_390px]
    evidence: [screenshot_390x844, screenshot_1440x900, artifact]
  human_review:
    queue: review             # separate from DecisionQuota
    max_comment_rounds: 3
  publish:
    action: site.publish      # always through AuthorityEngine.gate()
system_prompt: |
  You design for {{company.name}}. ...
```

9. **Eval harness on a budget** (`packages/evals`, new): golden inputs and stored outputs per task type
   (20-30 to start, from real failures [S33]); judges through `packages/agents/src/llm/client.ts` with the
   Batch API nightly; scores written to Langfuse for human calibration. Add a test model profile in
   `packages/core/src/models.ts` (per-change runs map `planner`/`coder` to Sonnet 5.5 at low effort with
   a $0.25 cap); milestone acceptance keeps production routing. Proposed monthly split (estimate): $35
   per-change real-Claude smoke runs, $30 live E2E acceptance (about 5 runs), $10 evals and judges,
   $20 Higgsfield, $5 reserve; enforce with a dev workspace spend limit [S41].
10. **Harness engineering for North's own dev loop**: per milestone, a `docs/plans/M<n>.features.json`
    (`passes` flags only agents flip, tests never edited) and a progress file, with `pnpm validate` and the
    Playwright walkthrough as the sensors the orchestrator runs before `passes: true` [S32].
11. **Managed Agents later**: a `ManagedAgentsRuntime` spike behind `AgentRuntime` for long engineering
    builds once the gate round trip is designed; use outcomes there instead of rebuilding the loop [S22].

## Risks

- `plugins` with `settingSources: []` is documented as the alternative path [S3] but untested in North;
  assert the init message in a test before relying on it.
- `skills` hides but does not block files; a vendored skill with scripts is code running in the worker.
  Non-engineering roles should not get skills with scripts until script execution goes through a North tool.
- Critic leniency and judge drift: LLM judges stay generous [S20]; calibrate monthly against founder
  labels in Langfuse and keep deterministic checks as hard gates.
- Cost overrun from forks and subagents: forks share cache only within the TTL and workspace; subagent
  fan-out multiplies tokens about 15x [S27]. Keep `maxBudgetUsd` per run and a workflow cap.
- Session store writes are best-effort (`mirror_error`); a parked task whose transcript was dropped must
  fall back to a fresh run with the stored artifacts [S8].
- SDK churn: the 0.3.x line ships near-daily with occasional breaking notes [S1]; pin exact versions and
  read the changelog before each bump.
- promptfoo's long-term direction after the OpenAI acquisition is uncertain [S44].

## Open questions for the founder

1. Should the critic's scores be visible to you in the review queue, or only its verdict and top three issues?
2. Default variant count: 3 directions (better choice, about 3x drafting cost) or 2?
3. May skills with scripts run for Design and Growth (sandboxed), or only for Engineering at first?
4. Is a Postgres table for agent transcripts acceptable for retention and export (EXP-1), or should
   transcripts expire after N days?
5. Accept the proposed $100 split, or reserve more for live acceptance runs?
6. Which external skill sources are pre-approved for vendoring review (Anthropic, obra/superpowers, others)?

## Sources

- [S1] claude-agent-sdk-typescript CHANGELOG: https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md ; npm: https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk
- [S2] `sdk.d.ts` and `package.json` in `@anthropic-ai/claude-agent-sdk@0.3.301` (npm tarball, read 2026-10-16)
- [S3] Agent SDK, Skills: https://code.claude.com/docs/en/agent-sdk/skills
- [S4] Agent SDK, Plugins: https://code.claude.com/docs/en/agent-sdk/plugins
- [S5] Agent SDK, Claude Code features / settingSources: https://code.claude.com/docs/en/agent-sdk/claude-code-features
- [S6] Agent SDK, Hosting: https://code.claude.com/docs/en/agent-sdk/hosting
- [S7] Agent SDK, Sessions: https://code.claude.com/docs/en/agent-sdk/sessions
- [S8] Agent SDK, Session storage: https://code.claude.com/docs/en/agent-sdk/session-storage
- [S9] Agent SDK, Streaming output: https://code.claude.com/docs/en/agent-sdk/streaming-output
- [S10] Agent SDK, Subagents: https://code.claude.com/docs/en/agent-sdk/subagents
- [S11] Agent SDK, Hooks: https://code.claude.com/docs/en/agent-sdk/hooks
- [S12] Claude Code skills reference: https://code.claude.com/docs/en/skills ; hooks reference: https://code.claude.com/docs/en/hooks
- [S13] Agent SDK, Structured outputs: https://code.claude.com/docs/en/agent-sdk/structured-outputs
- [S14] Agent SDK, Permissions: https://code.claude.com/docs/en/agent-sdk/permissions
- [S15] Agent SDK, MCP: https://code.claude.com/docs/en/agent-sdk/mcp
- [S16] Agent SDK, Secure deployment: https://code.claude.com/docs/en/agent-sdk/secure-deployment
- [S17] Agent SDK, Cost tracking: https://code.claude.com/docs/en/agent-sdk/cost-tracking
- [S18] Equipping agents with Agent Skills: https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
- [S19] Skill authoring best practices: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices
- [S20] Harness design for long-running application development: https://www.anthropic.com/engineering/harness-design-long-running-apps
- [S21] Managed Agents overview: https://platform.claude.com/docs/en/managed-agents/overview
- [S22] Managed Agents, Define outcomes: https://platform.claude.com/docs/en/managed-agents/define-outcomes
- [S23] Managed Agents, Multi-agent: https://platform.claude.com/docs/en/managed-agents/multiagent-orchestration
- [S24] Managed Agents, Skills: https://platform.claude.com/docs/en/managed-agents/skills
- [S25] Managed Agents, Self-hosted sandboxes: https://platform.claude.com/docs/en/managed-agents/self-hosted-sandboxes
- [S26] Building effective agents: https://www.anthropic.com/engineering/building-effective-agents
- [S27] How we built our multi-agent research system: https://www.anthropic.com/engineering/multi-agent-research-system
- [S28] Writing effective tools for agents: https://www.anthropic.com/engineering/writing-tools-for-agents
- [S29] Effective context engineering: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- [S30] Inngest JS (4.24.0, Apache-2.0): https://github.com/inngest/inngest-js
- [S31] Inngest, Wait for an event: https://www.inngest.com/docs/features/inngest-functions/steps-workflows/wait-for-event
- [S32] Effective harnesses for long-running agents: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- [S33] Demystifying evals for AI agents: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- [S34] Böckeler, Harness engineering for coding agent users: https://martinfowler.com/articles/harness-engineering.html
- [S35] OpenAI, Harness engineering (403 to our fetcher): https://openai.com/index/harness-engineering/
- [S36] InfoQ summary of OpenAI harness engineering: https://www.infoq.com/news/2026/02/openai-harness-engineering-codex
- [S37] LangGraph.js interrupts: https://docs.langchain.com/oss/javascript/langgraph/interrupts
- [S38] npm registry (versions, licenses, 2026-10-16): https://www.npmjs.com/package/@langchain/langgraph , https://www.npmjs.com/package/@inngest/agent-kit , https://www.npmjs.com/package/xstate , https://www.npmjs.com/package/@mastra/core , https://www.npmjs.com/package/@playwright/mcp
- [S39] Inngest Realtime: https://www.inngest.com/docs/features/realtime
- [S40] Claude pricing (models, cache, Batch, Managed Agents runtime): https://platform.claude.com/docs/en/about-claude/pricing
- [S41] Workspaces (spend limits, per-workspace prompt cache): https://platform.claude.com/docs/en/manage-claude/workspaces
- [S42] Effort parameter: https://platform.claude.com/docs/en/build-with-claude/effort
- [S43] promptfoo model-graded assertions: https://www.promptfoo.dev/docs/configuration/expected-outputs/model-graded/
- [S44] OpenAI acquires Promptfoo (secondary): https://finance.yahoo.com/news/openai-acquires-promptfoo-secure-ai-174904138.html
- [S45] Langfuse pricing: https://langfuse.com/pricing
- [S46] Braintrust pricing: https://www.braintrust.dev/pricing
- [S50] The Hacker News on Koi Security's ClawHub audit: https://thehackernews.com/2026/02/researchers-find-341-malicious-clawhub.html
- [S51] Snyk ToxicSkills: https://snyk.io/blog/toxicskills-malicious-ai-agent-skills-clawhub
- [S52] anthropics/skills README: https://github.com/anthropics/skills
