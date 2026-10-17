# 26. Security controls

Purpose: the threat model, the twenty MUST rules with the arbiter's amendments, the
generated-app security table, kill switch and quota scope, provider sandbox ownership, the
verified SDK option names, and the two spec corrections the build session must make.

Related: `00-README.md`, `01-research-protocol.md`, `10-findings-and-verdicts.md`,
`20-blueprint-overview.md`, `21-intake-protocol.md`, `22-spec-and-plan-artifacts.md`,
`23-architecture-and-principles.md`, `24-team-topology-and-orchestration.md`,
`25-verification-and-evidence.md`. Rulings carried: `notes/synthesis-decisions.md` §6;
§2 rows 18, 22, 23, 24; gaps 16, 20, 23.

## 0. Tag convention and stance

Tags are `[LEVEL · hypothesis · lowest grade · classes · kind]` as in `24-*.md` §0. Every
rule here is `invariant` and applies to all classes unless stated. Stance (debate-3
preamble): prompts never count as controls. METR's "don't cheat" prompts moved hacking from
~80% to 70–95% (RQ5 §KQ2, A, https://metr.org/blog/2025-06-05-recent-reward-hacking/).
The one quality metric that did not improve with model generation is the security pass
rate (Veracode 45% / 56%, RQ8 §KQ2), which is the strongest argument for deterministic
gates (debate-1 §8).

## 1. Threat model summary (debate-3 §1)

### 1.1 Assets

| Asset | Where it lives | Who must never hold it |
| --- | --- | --- |
| Model API key | worker env; the gateway injects it | any agent process, any sandbox |
| Founder's GitHub, Vercel, Supabase tokens | `connections` rows (ADR 0008), used by worker adapters behind `gate()` | any agent process; the generated repo |
| Founder's repository and history | founder's GitHub; a copy in `<workspaceRoot>/<taskId>` | other companies' runs; the evaluator may not alter it |
| North's database (`actions`, `ledger_entries`, `evidence`, cards, lessons) | Supabase with RLS and append-only triggers | any agent; only the worker writes evidence |
| Company transcripts and config | `<configRoot>/<companyId>/<roleClass>` | other companies; the builder must not read the critic's |
| Founder attention (3 cards, 5 items per day) | `decision_cards` trigger, `planCards`, `review_items` | no agent may burn it to force a default |
| The product's end-user data | the founder's Supabase project | the public internet (CVE-2025-48757 pattern) |

### 1.2 Actors

Trusted: worker code, migrations, the founder's own answers. Semi-trusted (can be wrong or
steered): planner, builder, evaluator, reviewer, retro. Untrusted: fetched pages, issue and
Sentry text, npm packages and install scripts, vendored skill text, the founder's existing
repo contents, the product's end users, and the generated app itself once deployed.

### 1.3 Attack paths and closing control

| # | Path | Control (rule number in §2) |
| --- | --- | --- |
| A1 | Prompt injection through docs, README, issue text, errors, package README | no WebFetch/WebSearch on write roles; vendored doc snapshots; every effect gated; evidence platform-produced (6, 7) |
| A2 | Exfiltration through Bash network | OS sandbox, registry-only allowlist, `strictAllowlist: true` (1, 20) |
| A3 | Exfiltration or escalation through file tools; planted git hooks | in-workspace deny list; worker never runs git with hooks in an agent workspace (2, 3) |
| A4 | Builder edits tests, fixtures, CI, lockfile | worker-side G0 on the pushed SHA (9) |
| A5 | Builder reads the scorer | config dir per role class; transcripts purged; suite in North Storage (4, 10) |
| A6 | Evaluator collusion through shared context | critic tool list, no fork, `CLAUDE_CODE_FORK_SUBAGENT=0` (5) |
| A7 | Evaluator steered by the app under test | request allowlist to the preview origin; page text as data; model vetoes only (14) |
| A8 | Skills with scripts or hooks | lock verified at mount; `has_hooks` rejected (12) |
| A9 | Lockfile tampering, typosquat, install scripts | frozen lockfile, OSV scan, lockfile diff as review item (11) |
| A10 | Secrets in generated code or client bundle | gitleaks, bundle JWT decode (13) |
| A11 | RLS off or permissive in the product | RLS probe as a gate with no founder switch (13) |
| A12 | Fake evidence | `record_evidence()`, producer enum, `plausibleRef` removed (7, 8) |
| A13 | Founder-attention exhaustion | cards only from `gate()` at architectural forks; defaults (19) |
| A14 | Run outlives the kill switch | `query.close()`, `sandbox.stop()`, process-group kill within 5 s (16) |

## 2. The twenty MUST rules (debate-3 §9, verbatim) with amendments (synthesis-decisions §6)

Each rule: text, threat closed, how it is checked. Tags: `[MUST · H13 or H11 · A or B ·
all · invariant]`; the grade is named per rule. Amendments are marked `Amendment:`.

1. MUST run every engineering Bash in the OS sandbox with `enabled`, `failIfUnavailable: true`,
   `allowUnsandboxedCommands: false`, `strictAllowlist: true`, `allowedDomains` limited to the
   package registry, no `excludedCommands`, no `enableWeakerNestedSandbox`. Threat A2. Check:
   Vitest over `engineeringSandbox()`; a run-time probe `curl https://example.com` fails.
   Grade B (vendor docs §7). Today's `engineeringSandbox()` lacks `strictAllowlist`.
2. MUST deny file-tool paths outside the task workspace and, inside it, `.git/**`, `.claude/**`,
   `.mcp.json`, shell rc files, and CI config for builder roles. Threat A3. Check: Vitest over
   `pathOutsideWorkspace` plus a new deny list; audit rows show the denial. Grade B.
3. MUST never run `git` with hooks enabled, or any interpreter, inside an agent workspace on the
   worker host; pushes go through the GitHub adapter after `gate()`. Threat A3. Check: grep CI
   rule on `apps/worker` for `simple-git`/`child_process` with a workspace cwd. Grade B.
4. MUST give every role class its own `CLAUDE_CONFIG_DIR`, deny the builder reads of transcript
   directories, and purge local transcripts after the DB mirror flushes. Threat A5. Check: Vitest
   over `subprocessEnvFor` and `engineeringSandbox()`; integration test that the builder's `ls`
   of the evaluator dir fails. Grade A (METR scorer visibility 43×). Today `subprocessEnvFor`
   sets one dir per company; it becomes `<configRoot>/<companyId>/<roleClass>` with
   `roleClass ∈ {planner, builder, critic}`.
5. MUST give critics `disallowedTools: [Bash, Write, Edit, MultiEdit, NotebookEdit, Agent,
   WebFetch, WebSearch]`, a pinned model alias and rubric version, and never `forkSession` from a
   builder; set `CLAUDE_CODE_FORK_SUBAGENT=0`. Threat A6. Check: Vitest over every persona file.
   Grade A (self-preference, Panickssery NeurIPS 2024, https://arxiv.org/abs/2404.13076).
   Amendment (§6, from debate-3 §3): also `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS ≤ 3` for
   builders, `strictAllowlist: true`, and the SDK upgrade to 0.3.302 only with these set.
6. MUST never grant `WebFetch`/`WebSearch` to a role with file-write or Bash tools. Threat A1,
   A2. Check: Vitest over role and persona tool lists. Grade B. Builder-facing docs are
   vendored snapshots (synthesis-decisions §4.1).
7. MUST produce evidence only from the worker or evaluator, through `record_evidence()` with
   storage-object existence and hash checks, into an append-only table; `artifact_id` from the
   task's own run never counts; `plausibleRef` is removed. Threat A12. Check: DB test inserting a
   `builder_claim` row expects rejection; Vitest over `verifyEvidence`. Grade A (H2).
8. MUST compute `done` in a SQL function from evidence rows per acceptance criterion; no agent
   output field can set it. Threat: false claim. Check: property test that `done` is unreachable
   without E2+E3 rows. Grade A.
9. MUST run the protected-path diff (tests, `e2e/acceptance/**`, CI, lockfile, feature-list
   status fields) on the pushed SHA in the worker and fail the task on a hit. Threat A4. Check:
   integration test with a crafted diff. Grade A (ImpossibleBench read-only tests,
   https://arxiv.org/html/2510.20270v1). Amendment: the protected list includes
   `features.json` planner fields and `docs/SPEC.md` rows for the builder;
   `requirement_hash` makes edits visible.
10. MUST keep the acceptance suite out of the builder's checkout and parameterise it with a fresh
    recorded seed per run. Threat: special-casing. Check: evidence row carries `seed`; test that
    the workspace contains no acceptance files. Grade A.
11. MUST install dependencies in the verifier with a frozen lockfile from a per-role cache, run an
    OSV scan, and list the lockfile diff as a review item. Threat A9. Check: gate output in
    `gates.json`. Grade B. The lockfile diff is a digest, free of quota.
12. MUST verify the skills lock at mount and reject `has_hooks`; skill scripts only via sandboxed
    Bash. Threat A8. Check: worker unit test with a tampered lock refuses to start the run. Grade B.
13. MUST impose the §6 table on every generated app with no founder-facing switch, with RLS and
    service-role checks blocking any K2 deploy. Threat A11, A10. Check: gate functions with
    fixtures (table without RLS, bundle with service-role JWT) fail. Grade B (Veracode, CVE
    pattern). Amendment: the "no outbound call to an undeclared host" row is a deterministic
    grep gate at every class, since there is no reviewer at C1–C2; class modules add a
    webhook-signature test (M-PAY), `tenant_id` in every policy (C3), an append-only audit
    table and consent record (M-REG). The table is §3 below.
14. MUST run the evaluator's browser with a request allowlist limited to the preview origin and
    treat page text and screenshots as data; the model's score can veto, never pass. Threat A7.
    Check: Playwright test that a page requesting the worker's loopback is blocked; rubric code
    test that a hard-criterion fail cannot be overridden by score. Grade B.
15. MUST return `deny` from the PreToolUse hook when `gate()` returns a card; `defer` only for
    tools absent from `allowedTools`, after a two-tool-call test. Threat: ungated execution.
    Check: Vitest over the hook with a card-returning gate. Grade B (hooks docs §7;
    synthesis-decisions §2 row 24). The Stop hook is a nudge; the done gate is the worker.
16. MUST stop every live run of a company within 5 s of the kill flag: `query.close()`,
    `sandbox.stop()`, process-group kill, per-command Bash timeout. Threat A14. Check: integration
    test with `sleep 300`. Grade B. Scope in §4.
17. MUST enforce spend at the gateway per run, workflow and profile, covering evaluators and
    retros; `maxBudgetUsd` is advisory. Threat: runaway loop. Check: gateway unit test refuses the
    request past cap. Grade B.
18. MUST allow lessons to change only briefs and soft rubric weights; gates, hard criteria and
    tool policies have no lesson or override path. Threat: memory poisoning. Check: Zod reject
    list on lesson statements; no code path from `rubric_overrides` to hard criteria. Grade B.
19. MUST open decision cards only from `gate()`, only for RQ7 level-3 forks for engineering, and
    park a task that needs a second card in a day. Threat A13. Check: grep for card-insert paths;
    quota trigger test. Grade B. Amendment: a task needing a second card in one day proceeds
    on the card's default at `default_applies_at`; it is parked only when no safe default
    exists. Level-3 forks are the four-part checklist in `24-*.md` §5.
20. MUST ship bubblewrap and socat in the worker image and fail the deploy if `/sandbox` reports
    a missing dependency. Threat A2 (silent unsandboxed fallback). Check: image smoke test.
    Grade B.

Added rules from the amendments (synthesis-decisions §6):

21. MUST make the evaluator's and verifier's UA and headers indistinguishable from a normal
    browser except the bypass secret; MUST make one anonymous fetch without bypass per
    acceptance run. Threat: evaluator detection (debate-3 §4.2 item 2). Check: Playwright
    test that the app receives no `north-*` header or UA. Grade B.
22. MUST promote the immutable preview build to production; never rebuild. Threat: pass the
    preview, fail production (debate-3 §4.2 item 3). Check: production `deploy_id` references
    the same build artifact as the verified preview. Grade B.
23. MUST seed fresh test data per acceptance run and record the seed (debate-3 §4.1). Check:
    E3 row `seed` is non-null and differs from the previous run. Grade A.
24. MUST keep per-company kill covering runs, task workspaces and preview deploys within 5 s,
    and a separate fleet-wide stop for model incidents (debate-3 §7; debate-4 §4.10). §4.

Rejected: none. Downgraded: "sealed environment holds against retrieval" is kept as an A2/A3
control, not as an anti-cheating result (synthesis-decisions §2 row 18). The shallow
single-commit, credential-free, registry-only workspace costs ≈0 because the worker
materialises it anyway.

## 3. Security imposed on every generated app (debate-3 §6)

Regardless of the founder's answers, because the founder cannot review code and the security
pass rate did not improve across model generations. No founder-facing switch.
`[MUST · H11, I14, I15 · B · all · invariant]`.

| Requirement | Deterministic check (worker-run gate) | Gate |
| --- | --- | --- |
| Auth through the platform provider (Supabase Auth); server reads `getUser()`, never trusts `getSession()` | ESLint ban on `getSession` in server code; semgrep rule | G1 |
| RLS enabled on every table in `public`; no `using (true)` policy for `anon` on a table not declared public in the plan | SQL probe over `pg_class.relrowsecurity` and `pg_policies`; anonymous-key `select`/`insert` on every table expects deny except declared public tables | G6 (when `auth`) |
| Service-role key never in client code or bundle; `.env*` not committed | gitleaks on diff; scan `.next` client chunks for JWTs, decode, fail on `role: service_role` | G6 |
| Zod validation at every server action, route handler and webhook | lint: exported handler must call `parse`/`safeParse` on its input | G1 |
| Dependency pinning | lockfile committed; `--frozen-lockfile` in verifier; OSV scan; lockfile diff as digest | G6 |
| Rate limit on every unauthenticated write endpoint | probe: 30 requests in 10 s expects 429 | G7 |
| Security headers | HTTP probe: CSP, HSTS, `X-Content-Type-Options`, `frame-ancestors` present | G6 |
| OWASP Top 10 static pass | semgrep `p/owasp-top-ten` + `p/nextjs` with zero ERROR findings | G1 |
| No outbound call to a host not declared in the plan | grep of `fetch(` and SDK imports against `intake.json` Q8 integration list; deterministic at every class (Amendment, rule 13) | G1 |
| Public preview protection | Vercel deployment protection on; the worker holds the bypass secret; the builder never sees it | G6 |

Class and flag modules (synthesis-decisions §3.1):

| Module | Trigger | Added checks |
| --- | --- | --- |
| M-PAY | `payments` (C2) | webhook-signature verification test; no card data touched (grep for PAN patterns and `card_number` fields); Stripe test-mode contract test nightly; `live_key` card before any live key; planner `strong` for the payment slice |
| M-PAY + M-REG | `payouts` (C4) | both modules |
| C3 tenancy | `tenancy` or `two_sided` | every table has `tenant_id` in every policy (SQL check); cross-tenant and cross-role probe as required E3 rows (`25-*.md` §10) |
| M-RT | `realtime` (C3) | second deployable pinned to the same `commit_sha`; socket origin allowlist; `sync_observed` evidence |
| M-REG | `regulated` (C4) | append-only audit table with `forbid_change()` trigger; consent record per user; residency check on the Supabase region; retention job; G9 per milestone |
| M-INT | `integrations ≥ 1` | owned adapter plus nightly contract test per provider; provider keys only in the worker |
| M-AI | `ai_core` (C2) | prompt-injection cases in the acceptance suite; cost ceiling per request; fixed eval set |

## 4. Kill switch and quota controls (gap 20)

### 4.1 Per-company kill (CLAUDE.md rule 7; SPEC within 5 s)

The runtime subscribes to the kill flag (poll ≤2 s or Realtime). On the flag, the worker
runs this checklist and asserts completion within 5 s. `[MUST · rule 16, 24 · B · all ·
invariant]`.

| # | Target | Action | Check |
| --- | --- | --- | --- |
| 1 | every live `query()` of the company (builder, planner, critic, retro) | `query.close()` terminates the subprocess; `abortController.abort()` | no child process after 5 s |
| 2 | every sandbox of the company | `sandbox.stop()`; process-group kill; bubblewrap children die with the group (verify, do not assume) | integration test `sleep 300` in a sandboxed run, flip flag, no process within 5 s |
| 3 | every Bash call | per-command timeout (`BASH_MAX_TIMEOUT_MS` or explicit cap) so a running command cannot outlive the flag | unit test on the options |
| 4 | Inngest runs | `cancelOn` on `run-task` and every engineering function, including nightly G8 and background evaluators | run states `cancelled` |
| 5 | task workspaces and branches | labelled `killed`, reaped at next worker tick; no push after the flag | `agent_runs.ended_reason = kill_switch` |
| 6 | preview deploys in progress | cancel through the provider API; label the deployment; production never promoted | provider state `CANCELED` |
| 7 | review items and cards | frozen; no default applies while killed | `review_items.status = frozen` |
| 8 | PreToolUse hook | `isKilled` denies every further tool call (already in `auditHook`) | existing test |

Both existing controls (`cancelOn`, `isKilled`) act only at a step or tool boundary, so
items 1–3 are the additions that make 5 s real (debate-3 §7).

### 4.2 Fleet-wide stop

A separate operator control, not the founder's kill switch: the gateway refuses every
request, Inngest pauses every engineering function, and no new sandbox starts. Trigger:
model incident or cost runaway. Owner: North operator. It never touches founder data and
never applies card defaults. `[MUST · debate-4 §4.10 · invariant · fleet]`.

### 4.3 Budget guards (rule 17)

| Guard | Scope | Hard or advisory |
| --- | --- | --- |
| `maxBudgetUsd` on `query()` | per run | advisory ("the estimate can pass this value", SDK docs) |
| Gateway per-run cap | per run, including evaluators and retros | hard: 402 ends the run with `ended_reason: budget` |
| Gateway per-workflow cap | per build | hard |
| Gateway per-profile cap | per model profile | hard |
| Appetite breaker at 1.5× `appetite_usd` | per feature and per build | `breaker` review item, default stop at 24 h |
| Workspace spend limit | Anthropic workspace | hard, last line |

### 4.4 Decision quota

The database trigger on `decision_cards` is the control; `planCards` defers rather than
drops. Guards against starvation and coercion: only `gate()` opens cards; engineering cards
only for the four-part architectural line; a task needing a second card in a day proceeds
on the default at `default_applies_at`; `review_items` from critics count against the 5-item
budget and overflow waits for tomorrow (studio design §5.4). `[MUST · rule 19 · B · all ·
invariant]`.

## 5. Provider sandbox ownership (gap 23)

Rule: the founder's own account where the product needs it anyway; North's fenced account
otherwise. Contract tests for allowed fakes (`25-*.md` §5) run nightly against the account
in the third column; a failing contract test quarantines the fake and opens a digest.
`[MUST · RQ5 §KQ1 · B · C2+ · design choice]` (debate-4 §4.9; synthesis-decisions §4.1).

| Provider | Owner | Contract tests run against | Consent and key path |
| --- | --- | --- | --- |
| GitHub (product repo) | founder's account | founder's repo via the worker adapter | `connect_account` card (K2) at skeleton |
| Vercel (product hosting) | founder's project or team | founder's project | `connect_account` card |
| Supabase (product DB and auth) | founder's project | founder's project; RLS probe uses its anon key | `connect_account` card |
| Stripe (`payments`) | founder's account, test mode | founder's `sk_test_` key | `connect_account` card; `live_key` card before any live key |
| Resend or product email | founder's account when the product sends mail | founder's sandbox domain | `connect_account` card |
| Google (Calendar, Sheets, Gmail as Q8 integrations) | founder's OAuth grant for the product; North's fenced test app for the contract test | North's fenced app (consent refreshed weekly while in Testing status) | `connect_account` card for the product grant |
| Shopify, other Q8 integrations | founder's store or account | North's fenced dev store for the contract test | `connect_account` card |
| Meta, LinkedIn, other North-department providers | North's fenced sandbox | North's sandbox | no founder action; `NORTH_TEST_FENCE=1` deny-by-default |
| Model API | North's gateway | n/a | never in a sandbox or repo |

Fences: with `NORTH_TEST_FENCE=1`, `gate()` blocks any external action whose target is not
allow-listed (studio design §8). Founder-owned accounts are reached only through worker
adapters after `gate()`; no provider key ever enters an agent process or the generated repo.

## 6. SDK option names and versions verified (debate-3 §5, re-read 2026-10-17)

Quoted exactly from code.claude.com. The build session treats these as the names to use.

| Item | Exact text or names | URL |
| --- | --- | --- |
| Sandbox scope | "The sandbox covers shell commands only. Claude's file tools, MCP servers, and hooks run outside it"; "A `denyRead` entry doesn't stop the Read tool, and `allowedDomains` doesn't limit WebFetch" | https://code.claude.com/docs/en/sandboxing |
| `SandboxSettings` fields | `enabled`, `failIfUnavailable` (default `true` in the SDK), `autoAllowBashIfSandboxed` (default `true`), `excludedCommands`, `allowUnsandboxedCommands` (default `true`), `network`, `filesystem`, `ignoreViolations`, `enableWeakerNestedSandbox` ("considerably weakens security"), `ripgrep` | https://code.claude.com/docs/en/agent-sdk/typescript |
| `SandboxNetworkConfig` fields | `allowedDomains`, `deniedDomains`, `strictAllowlist`, `allowManagedDomainsOnly`, `allowLocalBinding`, `allowUnixSockets` (Docker socket warning) | same |
| Settings scopes | `sandbox.network.strictAllowlist`, `sandbox.filesystem.disabled`, `sandbox.network.tlsTerminate` are "User or managed" only; `allowManagedDomainsOnly` is managed only; `disableSkillShellExecution` is any scope | https://code.claude.com/docs/en/settings-reference |
| Protected paths | Bash writes denied to `.claude/*`, `.mcp.json`, `.bashrc`, `.gitconfig`, `.git/hooks`, `.git/config`, `CLAUDE_CONFIG_DIR` contents; "there is no way to exempt one of these paths" | https://code.claude.com/docs/en/sandboxing |
| Network proxy | the proxy "refuses the connection when the name resolves only to local addresses" including `169.254.169.254`; under `dontAsk` hosts outside the allowlist are "Refused"; "Allowing broad domains such as `github.com` can create paths for data exfiltration"; Linux needs `bubblewrap` and `socat` | same |
| Permissions | order hooks → deny rules → ask rules → mode → allow rules → `canUseTool`; "a hook deny applies even in `bypassPermissions` mode"; `Agent` "doesn't ask before running" | https://code.claude.com/docs/en/agent-sdk/permissions |
| Hooks | `permissionDecision: "allow" \| "deny" \| "ask" \| "defer"`; precedence `deny > defer > ask > allow`; `defer` "works only when Claude makes a single tool call in the turn"; "no timeout or retry limit"; Stop hooks capped at 8 consecutive blocks (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`) | https://code.claude.com/docs/en/hooks |
| Query control | `query.close()` "terminate[s] the underlying process"; `interrupt()` is streaming-input only; `abortController` option exists | https://code.claude.com/docs/en/agent-sdk/typescript |
| Subagent env | `CLAUDE_CODE_FORK_SUBAGENT=0` turns fork subagents off (on by default since 2.1.302); `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (default 20); `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (default 3) | https://code.claude.com/docs/en/changelog; https://code.claude.com/docs/en/sub-agents |
| Versions | `@anthropic-ai/claude-agent-sdk` 0.3.302 and Claude Code 2.1.302, both 2026-10-16; `packages/agents/package.json` pins 0.3.301 | https://code.claude.com/docs/en/changelog; npm registry |
| `isolation: worktree` | present on the Claude Code subagent frontmatter page; not present in the SDK `AgentDefinition` type read. North's isolation unit is the task workspace; SDK worktrees are not relied on until a spike confirms (synthesis-decisions §2 row 23) | https://code.claude.com/docs/en/sub-agents |

Not verified this session (carry as open): `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` semantics,
pnpm `minimumReleaseAge`, bubblewrap support in the Fly worker image.

What already holds in the runtime and must not regress (debate-3 §2): `engineeringSandbox()`
with `enabled`, `failIfUnavailable: true`, `allowUnsandboxedCommands: false`,
`autoAllowBashIfSandboxed: false`, `allowedDomains: ["registry.npmjs.org"]`, `denyRead` on
the config and workspace roots with `allowRead` for this run only; `pathOutsideWorkspace`
real-path confinement; fail-closed `auditHook`; `settingSources: []`,
`disableSkillShellExecution: true`, `skills: []`, explicit `tools`, `permissionMode: "dontAsk"`;
per-company `HOME` and `CLAUDE_CONFIG_DIR`, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`,
`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`; append-only triggers; the quota trigger; the
verifier's no-redirect and private-host rules.

## 7. Spec corrections the build session must make

| # | Where | Current text | Change | Reason |
| --- | --- | --- | --- | --- |
| 1 | `docs/superpowers/specs/2026-10-16-north-studio-phase-design.md` §5.9 | Bash sandbox "network allowlist (npm registry, the gateway)" | Allowlist is the package registry only. The gateway is reached by the Claude process outside the sandbox; listing loopback would let a command reach it, and the proxy refuses local addresses anyway. | synthesis-decisions §2 row 22; `claude-agent-sdk.ts` comment; sandboxing docs |
| 2 | same §5.9 and `packages/agents/package.json` | "Upgrade the Agent SDK to the current 0.3.x release"; pin `0.3.301` | Upgrade to 0.3.302 only together with `CLAUDE_CODE_FORK_SUBAGENT=0`, `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS ≤ 3` for builders, and `strictAllowlist: true`, each covered by a Vitest test. Fork subagents became default-on in that release. | synthesis-decisions §6; RQ4 §Q1 |
| 3 | same §5.9 | `waiting_decision` uses PreToolUse `defer` when `gate()` returns a card | The hook returns `deny` when `gate()` returns a card; the run ends and `settleDecisionFn` re-dispatches. `defer` only for North MCP tools absent from `allowedTools`, after a two-tool-call test proves the multi-call case denies. | synthesis-decisions §2 row 24; hooks docs single-call limit |
| 4 | `packages/agents/src/runtime/subprocess-env.ts` | one `CLAUDE_CONFIG_DIR` per company | one per `(companyId, roleClass)`; builder `denyRead` on the critic and planner dirs; transcripts purged after the mirror flushes | rule 4; debate-3 §3.3 |
| 5 | `apps/worker/src/services/verifier.ts` | `plausibleRef` for `deploy_id` and `test_report`; `artifact_id` on existence; UA `north-verifier/1.0` | per `25-verification-and-evidence.md` §13 | rules 7, 21 |
| 6 | `agents/engineering.yaml` and persona schema | one role holds `artifacts.write`, `errors.read`, `repo.push`, `deploy.*` | `critic: true` forbids `artifacts.write` and the rule-5 tool list; `repo.push` and `deploy.*` are worker actions after `gate()`; `fs.write` and `errors.read` together only with wrapped error text, tested | synthesis-decisions §2 row 30 |
| 7 | `.claude/agents/north-qa-validator.md` | `Write, Edit` on the paths it verifies | critic class: read-only on `src`; writes only the acceptance suite in North Storage | RQ7 §KQ7 correction 1 |
