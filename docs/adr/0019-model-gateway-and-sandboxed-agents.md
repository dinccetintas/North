# ADR 0019: The model gateway and sandboxed agent execution

Status: accepted (2026-10-17)

ADR 0018 is reserved by the design spec (section 14) for M8's vendored skills and per-persona mounting; no file exists for it yet.

## Context

ADR 0004 put the Claude Agent SDK behind `AgentRuntime`, with a per-task
`cwd`, role-scoped tools, a `PreToolUse` audit hook and the SDK's per-run
`maxBudgetUsd`. ADR 0015 made the worker the only home of
`ANTHROPIC_API_KEY`. Inside the worker, though, the key went into each agent
subprocess's environment (`subprocessEnvFor` still does that when no gateway
is configured, and says so with `NO_GATEWAY_WARNING`). The subprocess is
where the model's tool calls run, engineering's shell among them: a key in
its environment is a key a prompt-injected command can print. Nothing capped
a day of model spend across runs, and nothing could replay a real model
exchange in a test.

M7 brings five requirements to that one place
(`docs/superpowers/specs/2026-10-16-north-studio-phase-design.md`, sections
5.9, 8 and 12): SEC-1, agent shell commands run sandboxed and no agent
process holds the model key; SEC-2, no agent configuration, memory or
session is shared between companies; TST-1, model profiles and a test budget
guard; TST-2, a real-Claude smoke on every PR within its cap (the code files
the cassettes under it too); LRN-6, memory enters a run as data in a bounded
block. The plan adds that
every cap is enforced by the gateway, not by convention (`docs/plans/M7.md`,
Global Constraints).

## Decision

**A loopback gateway in the worker is the only code that holds the model
key.** `startGateway` (`apps/worker/src/gateway/server.ts`) is a `node:http`
server bound to `127.0.0.1` on an ephemeral port. With
`AGENT_RUNTIME=claude-agent-sdk`, `buildRuntimeDeps`
(`apps/worker/src/services/runtime-deps.ts`) starts it before the runtime and
the LLM client, reads `ANTHROPIC_API_KEY` once and hands it to the gateway
alone (a replaying gateway gets none: it never calls the API);
`WorkerDeps.env` carries the env without the key (`depsEnvOf`). The agent
subprocess gets
`ANTHROPIC_BASE_URL` pointing at the gateway and `ANTHROPIC_API_KEY` set to
the placeholder `north-gateway` (`GATEWAY_PLACEHOLDER_KEY`). The single-call
LLM client goes through the same gateway with the same placeholder, so every
model call of the process is capped, recorded and replayed in one place. The
gateway answers 403 to a non-loopback `Host` (DNS rebinding), 401 to any key
but the exact placeholder and 404 to anything but `POST /v1/messages` and
`/v1/messages/count_tokens`. It forwards an allowlist of request headers
(`headers.ts`), injects the real key, and takes the upstream from its
options, never from the request: `https://api.anthropic.com` unless
`ANTHROPIC_BASE_URL` names another (https unless loopback; loopback only under
`NODE_ENV=production`, `apps/worker/src/env.ts`). Replies stream through byte
for byte. The worker closes the gateway on SIGTERM and SIGINT, cutting what is
in flight.

**The subprocess environment is an allowlist, pinned per company.**
`subprocessEnvFor` (`packages/agents/src/runtime/subprocess-env.ts`) cuts the
base environment to `SUBPROCESS_ENV_ALLOWLIST` (`PATH`, `TMPDIR`, `LANG`,
`LC_ALL`, `SHELL`) whenever a gateway is configured, then pins `HOME` and
`CLAUDE_CONFIG_DIR` to `<AGENT_CONFIG_ROOT>/<companyId>`, `npm_config_cache`
to a directory under it, `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` and
`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1`, and adds the gateway URL and the
placeholder. No provider switch, custom header or cloud credential of the
host reaches the model API around the gateway. `buildQueryOptions`
(`packages/agents/src/runtime/claude-agent-sdk.ts`) passes
`settingSources: []`, no skills, skill shell execution disabled,
`permissionMode: "dontAsk"` and the role's tool lists. The worker always configures a gateway with the
SDK runtime.

**Prices live in `models.ts`; the gateway enforces one cap per UTC day.**
`PRICE_USD_PER_MTOK` and `costOfUsage` (`packages/core/src/models.ts`, the
only home of model IDs) price input, 5-minute and 1-hour cache writes, cache
reads and output, Haiku's long-prompt tier, and fast mode at twice the price.
`NORTH_MODEL_PROFILE` (`production`, `staging`, `smoke`) picks the models the
role aliases resolve to (`resolveModel`, `resolveEffort`). The gateway prices
every 2xx reply from its own usage (a stream as it passes, `sse.ts`; a JSON
body from a bounded copy, `capture.ts`, `usage.ts`) and settles it on its
`GatewayBudget` (`budget.ts`, over the pure guard in
`packages/core/src/budget/test-run.ts`). Once the day's spend reaches
`NORTH_DAILY_CAP_USD` (0 is no cap), `/v1/messages` answers 402
`north_budget_exceeded`. A model with no price is charged the dearest rate
and counted `unpriced`; under a cap, a 2xx reply with no readable usage
closes the day (402 `north_budget_unpriced`) until the next UTC day; a 2xx
stream that carried only an `error` event costs nothing. The day is the
worker clock's UTC day. Staging restarts often (auto-stop, deploys, secret
changes), so the budget starts from a seed: `buildRuntimeDeps` reads the
day's spend in `agent_runs` (`sumRunCostsSince`) and passes it as
`initialSpentUsd`; a failed read seeds the full cap (fail closed). `/health`
reports the gateway's mode and `budget` (`capUsd`, `spentUsd`, `unpriced`,
`exhausted`, `seededUsd`), never the key. The role's `maxBudgetUsd` still
reaches the SDK per run.

**Cassettes: `off`, `record`, `replay`.** `NORTH_CASSETTE_MODE=off` is the
gateway's `live` mode (forward, store nothing). `record` forwards and stores
each complete `/v1/messages` exchange as `<key>.json` in `NORTH_CASSETTE_DIR`
(default `<repo root>/cassettes`). `replay` never contacts the API: it
answers from that directory (a miss is 502
`north_cassette_miss` naming the key; `count_tokens` is 501) and prices the
stored reply like a live one, so the cap behaves the same. The key is the
sha256 of the canonical request path, the sorted `anthropic-beta` flags and
the body, after UUIDs, ISO date-times and `Task id:` lines are normalised
(`cassetteKey` in `apps/worker/src/gateway/cassette.ts`). The stored request
is scrubbed (`sk-ant-` keys, bearer tokens, `@north.test` addresses) and
keeps only the forwarded headers, never `x-api-key` or `authorization`. The
stored response is verbatim, so replay serves exactly what was recorded; a
response that holds an `sk-ant-` key (JSON strings decoded, a stream's deltas
joined) is not recorded at all, nor is a compressed one or one over the 8 MB
capture limit. A `meta` block records the Agent SDK version from the user
agent, the time and whether scrubbing changed the key's inputs.
`pnpm cassette:check` (`scripts/cassette-check.ts`, a `pnpm validate` and CI
step) fails on a secret, a renamed file, a key that no longer
recomputes or an SDK version other than the pin in
`packages/agents/package.json`. Under `NODE_ENV=production`, `record` and
`replay` need `NORTH_ENV=staging`; the production check refuses both, the
staging check refuses `replay`. Cassettes are recorded by hand from synthetic
companies (`cassettes/README.md`). `pnpm e2e:replay` runs the Playwright
flows against a replaying worker, and its global setup fails the run unless
the worker's `/health` reports the SDK runtime and a replaying gateway.

**Engineering's shell runs in the SDK sandbox.** Engineering is the only role
that may run `Bash` or write files
(`packages/agents/src/runtime/tool-policy.ts`) and the only one given sandbox
options (`engineeringSandbox` in `claude-agent-sdk.ts`): enabled,
`failIfUnavailable: true`,
`allowUnsandboxedCommands: false`, `autoAllowBashIfSandboxed: false`, and one
network host, `registry.npmjs.org`. `denyRead` covers the config root, the
workspace root, and the worker's own cwd and repo root where `.env` lives
(`sandboxDenyRead`); `allowRead` re-opens only this run's task workspace and
company dir; `allowWrite` is the company's npm cache alone. The company dir
is not writable because `<companyDir>/.claude/settings.json` is the
subprocess's user settings, and a command that could write there could
loosen the next run's sandbox. The gateway is not on the network list: the
Claude process calls it outside the sandbox, which wraps shell commands only,
and listing loopback would let a command reach it. On Linux the sandbox needs
bubblewrap and socat: `apps/worker/Dockerfile` installs both in the runtime
stage, and CI asserts them in the image.

**File tools are path-scoped by the audit hook.** The built-in file tools run
in the Claude process, outside the OS sandbox, for every role. The
`PreToolUse` hook (`auditHook`) records every call through the audit, and
denies a tool outside the role's list, every call once the company's kill
switch is on, and every call it cannot audit. For `Read`, `Glob`, `Grep`,
`Edit`, `MultiEdit`, `Write` and `NotebookEdit` it asks `pathOutsideWorkspace`
(`packages/agents/src/runtime/path-scope.ts`) whether every path the call
names, a Glob pattern's fixed prefix included, really lands inside
`<workspaceRoot>/<taskId>`: symlinks are followed (dangling ones too), `..`
climbs, `~` and NUL are refused, and a check that cannot finish is a denial.

**Sessions and memory are company-scoped data.** The SDK's `sessionStore` is
`createNorthSessionStore` (`packages/agents/src/runtime/session-store.ts`)
over a `SessionEntriesPort` whose `append` and `read` take the company id
first. The worker binds it to `agent_session_entries` (migration 0020:
append-only, service role only, an entry at most 256 KB) and refuses to read
a session another company wrote (`apps/worker/src/services/session-port.ts`).
Entries are sanitised for jsonb: U+0000 and lone surrogates become U+FFFD,
counted and logged, never dropped. Memory reaches a run only as data:
`memory_search` returns `renderMemoryHits`
(`packages/agents/src/runtime/memory-tool.ts`), one `<memory_results>` block
with each hit as `## title (kind, department)` and its content; every field
passes through `stripDelimiters`, so memory text cannot close the block or a
`<company_memory>` section; a hit is cut at `MEMORY_HIT_MAX_CHARS` (1 200)
and the body at `MEMORY_RESULT_MAX_CHARS` (6 000), and the closing tag is
always there (LRN-6).

**The web never carries the model key and never calls the model.** Agents
and the worker's single-call client run behind the gateway. The web's
`GET /api/health` (`apps/web/src/app/api/health/route.ts`) reports
`llm: "live"` only when its own process has `AGENT_RUNTIME=claude-agent-sdk`
and an `ANTHROPIC_API_KEY`, `"mock"` otherwise, and never the key. The
production check fails unless it reads `"mock"`, in production and in
staging; both runbooks keep `ANTHROPIC_API_KEY` off Vercel, and the staging
one leaves `AGENT_RUNTIME` unset there too. That closes the one model path
in the web process: the onboarding questions step calls
`selectLlm(process.env)`, which builds a live client under exactly the
condition the health line reports as `"live"`, and a mock one otherwise.

## Consequences

- SEC-1 holds by construction on the SDK runtime: an agent subprocess, its
  tools and its shell see a placeholder that works only against a loopback
  server that also enforces the cap. The key stays in the worker's own
  environment and in the gateway's options.
- The placeholder is a constant in the source, so any process on the worker
  machine can call the gateway up to the day's cap; the loopback bind, the
  `Host` check and the cap are the control.
- The cap is checked before a request and the cost lands after it, so
  requests in flight together can pass the cap by their own cost. On staging
  the `north-test` workspace's $50 limit is the ceiling above it.
- The boot seed is a lower bound: `agent_runs` holds the SDK's price per run,
  not the gateway's, and a run cut off by a restart may be missing. M8
  persists the gateway's own priced spend per day.
- A new model caller in the worker must take the gateway from
  `buildRuntimeDeps`; anything else would hold the key and escape the cap.
- Cassettes go stale when a prompt, a model alias or the SDK pin changes and
  are re-recorded by hand. None is committed yet, so CI's `e2e-replay` job is
  skipped and the mock `e2e` job stays the gate; the nightly does not record
  in M7 (an M8 follow-up, `docs/evidence/README.md`).
- With `failIfUnavailable: true`, a machine that cannot run bubblewrap
  refuses every engineering shell instead of running one unsandboxed. CI's
  image step asserts bubblewrap and socat once CI runs (on a pull request or
  a push to `north-ceo-os` or `main`; M7 had no Docker daemon to build the
  image locally, `docs/plans/M7.progress.md`), and no engineering run has
  used the sandbox on a Fly machine yet (ADR 0017, runbook section 15).
- M7 mirrors transcripts into the session store but does not resume a parked
  task through it: `waiting_decision` through the SDK's `defer` hook result
  is M8 (`docs/plans/M7.md`).
- The follow-up is a per-task VM: spec section 5.9 moves engineering's
  commands to a `SandboxProvider` (Vercel Sandbox first, E2B as fallback)
  from a pinned snapshot in M9, after a spike. GitHub, Vercel and Supabase
  stay outside that sandbox, reached only through the worker's gated
  adapters.

## Alternatives

- **Vercel Sandbox or E2B now.** A remote VM per task isolates more than a
  bubblewrap sandbox on the worker. It lost for M7 because bridging the agent
  loop in the worker to commands in a remote VM is unproven (spec, section
  16, Risks) and needs a spike; the SDK sandbox runs in the image the worker
  already has. M9's spike decides.
- **A key per agent or per company.** Every subprocess would still hold a
  working credential its tools and shell could read, which SEC-1 forbids, and
  the cap and the cassettes would need one enforcement point per key instead
  of one gateway.
- **The real key in the SDK subprocess (the behaviour before M7).** The
  simplest, and what `subprocessEnvFor` still does without a gateway. It lost
  because the subprocess runs model-chosen tools and engineering's shell, so
  an injected instruction could read the key from the environment, and
  nothing inside the capped process can be trusted to enforce its own cap.
- **Caps by convention.** The SDK's `maxBudgetUsd` is per run and enforced
  inside the process it caps; a test tier or a staging day needs a cap that
  holds across runs and restarts, which only the gateway (with its boot seed)
  sees.
- **The single-call client on its own key.** It would be a second holder of
  the key outside the cap and the cassettes; it shares the gateway instead.
