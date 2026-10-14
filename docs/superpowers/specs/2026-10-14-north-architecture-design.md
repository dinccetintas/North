# North: architecture and build design

Status: approved by the founder's brief ("plan first, then build, do not stop until
it works"). Source of requirements: `docs/SPEC.md` (requirement IDs such as DEC-1
are used below and in commits/tests). Reference product: Polsia
(`docs/research/polsia-teardown.md`). Glossary: `CONTEXT.md`.

## 1. Intent

North is the operating system for a one-person company. The user is the CEO; AI
agents are the staff. The user states a thesis, a goal and a budget, then runs the
company by answering at most three decision cards a day. Everything an agent does
is tied to a metric, gated by an authority tier, written to an immutable audit
trail, and reversible or stoppable.

Success (north star): decisions per week per active company that were made by the
user, executed by agents, and measured in the outcome ledger.

Polsia proves the demand and the speed (idea to live landing page in minutes). Its
documented failures (no validation, unverifiable "done", unapproved outreach,
credit burn, lock-in) are the gaps North closes. We copy the speed and the
editorial aesthetic; we replace "eight live panels and a chat" with a briefing and
cards.

## 2. Product surface (screens)

| Screen | Route | Polsia equivalent | North difference |
| --- | --- | --- | --- |
| Landing | `/` | `/` | Same structure (hero, ticker, terminal strip, one CTA), North copy |
| Sign in | `/login` | `/login` | Google + magic link (Supabase Auth) |
| New company | `/new` | `/new` | Idea text or existing website; ≤5 clarifying questions (ONB-1); then goal + budget (ONB-2); then connections (ONB-3); then first plan summary and approval |
| Morning (home) | `/c/[slug]` | `/dashboard/:slug` | Brief, ≤3 pending cards, goal progress. No panels, no mandatory chat |
| Card detail | `/c/[slug]/decisions/[id]` | task click | Question, options, recommendation, evidence links, cost, due, safe default, "don't ask again" |
| Company | `/c/[slug]/company` | business panel | Thesis, goals, metrics, budgets, weekly plan, ledger summary |
| Team | `/c/[slug]/team` | team panel + terminal | Role cards, running tasks, last-24h action stream (SSE), stop task, kill switch |
| Ledger | `/c/[slug]/ledger` | analytics | Action → metric → delta → cost; working vs not-working channels; export |
| Artifacts | `/c/[slug]/artifacts` | documents/website | Versioned PRD, plan, deck, site links, creatives; download MD/PDF/PPTX |
| Chief of Staff | `/c/[slug]/chat` | chat | Optional, memory-backed; commands "new goal", "research this" |
| Connections | `/settings/connections` | `/connect` | OAuth status and scopes |
| Settings & billing | `/settings` | `/usage`, `/fund` | Plan, credits, quota, auto rules |
| Portfolio (V2) | `/companies` | `/companies` | One brief across companies |
| Public page (opt-in) | `/p/[slug]` | public dashboard | Off by default |

Mobile-first; installable PWA; the home screen loads in 1.5 s; a card answer
reaches the queue in 2 s (DEC-2, performance NFR).

## 3. System architecture

```
                 ┌──────────────────────────────┐
  browser/PWA ──▶│ apps/web  (Next.js 16)       │──▶ Supabase (Auth, Postgres+RLS,
                 │  UI, route handlers, server  │    pgvector, Storage, Vault)
                 │  actions, Inngest serve for  │
                 │  light functions, SSE stream │◀── Inngest (events, crons, waits)
                 └──────────────┬───────────────┘
                                │ events (inngest.send)
                 ┌──────────────▼───────────────┐
                 │ apps/worker (Node 24)         │──▶ Claude Agent SDK (subprocess per
                 │  Inngest serve for agent     │    task, in-process MCP tools)
                 │  functions; AgentRuntime;    │──▶ Integrations adapters (GitHub,
                 │  Authority gate; evidence    │    Vercel, Stripe, Resend, Gmail,
                 │  verification; ledger writes │    Meta/Google Ads, PostHog, Reddit)
                 └──────────────────────────────┘
```

- `apps/web` runs on Vercel. It never spawns agents. It renders, validates input,
  writes through the Supabase client under RLS, and emits Inngest events.
- `apps/worker` is a long-running Node service (local `pnpm dev`, later Fly/Railway
  or a Vercel Node function with a longer timeout if the SDK subprocess fits). It
  owns every agent execution and every external action.
- `packages/core` is pure TypeScript with no I/O: the authority engine, decision
  desk, ledger math, planner contracts, budget guard, quota, auto-rule inference.
  It is the most tested code in the repo.
- `packages/db`: SQL migrations (Supabase CLI), generated types, repositories.
- `packages/agents`: role definitions loaded from `agents/*.yaml`, prompts, tool
  registry, structured-output schemas, the `AgentRuntime` interface and its two
  adapters (`ClaudeAgentSdkRuntime`, `MockRuntime`).
- `packages/integrations`: one adapter per provider, each with a `sandbox`
  implementation that records intended effects instead of performing them
  (`INTEGRATIONS_MODE=sandbox|live`, default sandbox).

Monorepo with pnpm workspaces; shared `tsconfig`, ESLint, Vitest config.

## 4. Deep modules (packages/core)

Each module exposes a small interface and hides the rules. Tests cross the same
interface as callers.

### 4.1 AuthorityEngine (DEC-1, kill switch, budget protections)

```ts
classify(action: ActionSpec, ctx: PolicyContext): Tier          // pure
gate(action: ActionSpec, ctx: PolicyContext): GateDecision      // pure
// GateDecision = { kind: "run" } | { kind: "notify" } | { kind: "card", card: CardDraft }
//              | { kind: "block", reason } 
```

Rules (single module, `packages/core/src/authority/`):
- K0: no external effect or fully reversible (research, drafts, preview deploys).
- K1: external, reversible, no spend (templated support reply, publish an approved calendar item).
- K2: spends money, says something new in public, contacts a new person, goes live.
- K3: irreversible or legally/financially binding (contracts, payment-account changes, data deletion, domain transfer, any single spend > $500).
- Budget: if the action's cost would exceed the category's daily or total cap → K2 card, never silent.
- Kill switch active → `block` for every tier.
- Auto rules: a matching active `AutoRule` turns a K2 into `run` and records the rule id on the action.
- The agent may pass `requestedTier` only to raise; the engine ignores attempts to lower.
- Every path that touches the outside world calls `gate()` first. An action row with `tier` null is a bug caught by a DB constraint and a test (DEC-1 acceptance).

### 4.2 DecisionDesk (DEC-2, DEC-3)

`openCard(draft, quota)`, `answerCard(id, option, by)`, `applyDefault(id)`,
`rankAndMerge(pending, quota)`, `suggestAutoRule(history)`. Enforces the daily
quota (default 3, 1-5), merges low-priority cards, and proposes an `AutoRule`
after three identical answers (only created when the user accepts).

### 4.3 TaskLifecycle (AGT-1/2/3)

State machine `queued → running → (waiting_decision ↔ running) → done | failed`.
`markDone` requires `Evidence` whose kind matches the task type and that the
verifier confirmed (HTTP 200 on a URL, deploy ID present via the Vercel adapter,
message ID present via the mail adapter, test report attached). Two attempts with
different strategy notes, then `failed` and a Chief of Staff follow-up task.

### 4.4 OutcomeLedger (OUT-1)

`record(entry)` append-only; `attribute(task, before, after, cost)`;
`channelReport(company, window)` → working/not-working channels; weekly input
to `Planner.revise` (PLN-2).

### 4.5 Planner contracts (PLN-1/2)

Zod schemas for `Plan`, `TaskSpec` (owner role, expected metric delta, cost
estimate), `BriefInput`, `Brief`. The Chief of Staff agent must return these
shapes (Agent SDK `outputFormat`); the planner rejects tasks for roles whose
`max_action_tier` is below the task's likely tier.

### 4.6 BudgetGuard, Quota, SignalScorer, MemoryIndex (contracts)

Small pure modules used by the worker; `MemoryIndex` defines chunking/embedding
contracts implemented over pgvector in `packages/db`.

## 5. Agent runtime (packages/agents)

```ts
interface AgentRuntime {
  run(input: AgentRunInput): Promise<AgentRunResult>   // one task, one role
}
```

`ClaudeAgentSdkRuntime` wraps `query()` from `@anthropic-ai/claude-agent-sdk`:
- `cwd`: an isolated per-task workspace directory (engineering tasks get the
  user's repo cloned there; other roles get an empty scratch dir).
- `settingSources: []` (no host CLAUDE.md leakage), `systemPrompt` built from the
  role YAML + company memory digest + task.
- `allowedTools`: only the role's tools. Non-engineering roles get no `Bash`,
  `Write`, `WebFetch`; they get North's MCP tools. Engineering gets file tools and
  `Bash` inside the workspace with `sandbox` enabled where available.
- `mcpServers: { north: createSdkMcpServer({ tools }) }` where every tool handler
  calls an integrations adapter **through `AuthorityEngine.gate()`**. A `card`
  decision returns `{ status: "waiting_decision", cardId }` to the model and the
  run ends; the Inngest function then `waitForEvent`s and re-runs the agent with
  the answer (resume via `resume: sessionId`).
- `hooks.PreToolUse`: writes an audit row for every tool call (K0 observation),
  denies any tool not in the role's list (defense in depth).
- `outputFormat`: JSON schema per task type (plan, report, draft, evidence).
- `maxBudgetUsd` and `maxTurns` from the role YAML; `total_cost_usd` and
  `modelUsage` from the result go to `agent_runs`.
- `model` from `packages/core/src/models.ts` routing table.

`MockRuntime` replays scripted results per role/task type from
`packages/agents/fixtures/` so the whole loop runs deterministically in tests and
in the smoke script with no API key.

Role definition (`agents/<role>.yaml`): `role`, `title`, `mission`, `tools[]`,
`max_action_tier`, `model`, `max_turns`, `max_budget_usd`, `outputs[]`,
`system_prompt` (markdown). Validated by Zod at load; `agents` table mirrors it.

## 6. Durable workflows (Inngest v4)

Events (typed with `eventType`):
`company/created`, `company/onboarded`, `plan/requested`, `plan/created`,
`task/dispatch`, `task/finished`, `action/requested`, `decision/opened`,
`decision/answered`, `decision/expired`, `signal/detected`, `metric/collect`,
`brief/generate`, `company/killswitch`, `company/resume`.

Functions:
- `onboard-company` (event `company/onboarded`): research K0 tasks + landing preview (M1 acceptance: first outputs within 24 h).
- `plan-week` (event `plan/requested`, cron Monday 06:00 per company timezone): Chief of Staff produces a `Plan`; fan-out `task/dispatch`.
- `run-task` (event `task/dispatch`): `step.run(agent)`, then for each requested action `gate()`; on `card` → `step.waitForEvent("decision/answered", match: data.cardId, timeout: due)`; `null` → apply safe default; execute via adapter; verify evidence; `ledger.record`; `task/finished`. `cancelOn: [{ event: "company/killswitch", match: "data.companyId" }]`.
- `daily-brief` (cron hourly, fans out to users whose local time is 07:00): BRF-1.
- `scan-signals` (cron every 6 h): PRO-1; Haiku scoring; threshold → card.
- `collect-metrics` (cron hourly): OUT-2 from Stripe/analytics/ads adapters.
- `watch-errors` (event from Sentry webhook): PRO-2 → engineering fix task.
- `kill-switch` (event `company/killswitch`): pause campaigns via adapters, mark company paused; measured under 5 s in tests.

Light functions (brief, metrics, signals) are served from `apps/web`
(`/api/inngest`); agent functions from `apps/worker`. Both register with the same
Inngest app family and the local Dev Server.

## 7. Data model (Supabase Postgres)

Tables follow `docs/SPEC.md` §Veri modeli: `users` (profile over `auth.users`),
`companies`, `theses`, `goals`, `budgets`, `agents`, `plans`, `tasks`, `actions`,
`decision_cards`, `auto_rules`, `signals`, `metrics`, `ledger_entries`,
`memory_items` (vector(1536)), `artifacts`, `briefs`, `connections`, `usage`,
plus `agent_runs` (cost/trace) and `audit_tool_calls`.

Rules:
- Every table has `company_id` (or `user_id`) and RLS `owner_id = auth.uid()` via
  a `companies` join; service role bypasses only in the worker, which always
  scopes queries by the company it is processing (asserted in code).
- `actions` and `ledger_entries` are append-only: triggers reject UPDATE/DELETE.
- `actions.tier` is NOT NULL with a CHECK on `K0..K3`; `actions.decision_card_id`
  is required when `tier in (K2,K3)` (DEC-1 at the database level).
- `tasks.status = 'done'` requires `evidence` not null (CHECK).
- `decision_cards` unique partial index on `(company_id, day, seq)` enforces quota
  in the database as well as in code.
- Migrations are SQL files under `packages/db/supabase/migrations`; types are
  generated to `packages/db/src/types.ts`.

## 8. API surface (apps/web)

Server actions for forms (create company, answer card, change goal/budget, accept
auto rule, kill switch) and route handlers for machine clients:
`POST /api/companies`, `POST /api/companies/[id]/decisions/[cardId]/answer`,
`POST /api/companies/[id]/killswitch`, `GET /api/companies/[id]/stream` (SSE of
actions/tasks via Supabase Realtime or polling), `POST /api/webhooks/stripe`,
`POST /api/webhooks/sentry`, `GET|POST|PUT /api/inngest`, `GET /auth/callback`.
All inputs validated with Zod; every mutation checks ownership under RLS.

## 9. UI design system

Adapted from the Polsia teardown with free fonts:
- Display serif: Instrument Serif; body serif: Newsreader; mono: Geist Mono
  (labels 11px, uppercase, tracking 0.06em). Loaded with `next/font`.
- Tokens (Tailwind v4 `@theme`): `--color-ink: #000`, `--color-paper: #fff`,
  grays 1a/55/6a/88/aa/cc/dd/e5/fa, `--color-deep: #e65100` (single accent),
  success `#2e7d32`, error `#c62828`, warning `#f97316`, link `#2383e2`; radius
  0 and 2px; hairline borders; terminal surface black/white.
- Components (shadcn re-skinned): `DecisionCard`, `BriefPanel`, `GoalProgress`,
  `RoleCard`, `ActionStream` (terminal look), `LedgerTable`, `ArtifactCard`,
  `KillSwitchButton` (fixed, every screen), `MonoLabel`, `RetroButton`.
- Motion: ascii spinner, card pulse on new card, reduced-motion respected.
- Dark mode via `prefers-color-scheme` and a manual toggle.

## 10. Security and trust (NFRs)

- OAuth tokens in Supabase Vault; narrowest scopes; never logged.
- Agent sandboxes: per-task workspace, no shared filesystem across companies,
  network allowlist for engineering runs (SDK `sandbox.network.allowedDomains`).
- Prompt-injection: all tool results and fetched content are wrapped as data with
  a system note; agents can only act through gated tools, so injected text cannot
  spend money or contact anyone without a card.
- Kill switch: `company/killswitch` cancels runs (`cancelOn`), pauses campaigns,
  freezes dispatch; SLA 5 s verified by an integration test.
- Cost: per-task `maxBudgetUsd`, model routing, monthly per-user cost in `usage`;
  alert at 40% of plan price.
- Privacy: no training on user data; cross-company isolation proven by RLS tests
  (M0 acceptance).

## 11. Testing and validation layer

Layers, all runnable with one command (`pnpm validate`):
1. Unit (Vitest): `packages/core` ≥90% lines; every rule in AuthorityEngine has a
   named test with its requirement ID.
2. Integration (Vitest against local Supabase): RLS isolation (two users, two
   companies), append-only triggers, quota index, DEC-1 database constraint,
   kill-switch latency.
3. Workflow (Inngest Dev Server + MockRuntime): the full loop
   onboarding → plan → K0 task done with evidence → K2 task opens a card → answer
   → action executes → ledger entry → brief. This is `scripts/smoke.ts` and must
   pass before any milestone is called done.
4. E2E (Playwright): sign in (magic link via local Inbucket), create company,
   answer a card on mobile viewport, kill switch, settings. Screenshots stored
   under `docs/evidence/e2e/`.
5. Visual/computer-use check: after each milestone the orchestrator opens the app
   in the browser pane, walks the flow, and records findings in
   `docs/plans/M<n>.md` → "Acceptance evidence".
6. Agent evals (M3+): fixture tasks with graded outputs per role; a task that
   returns "done" without evidence fails the eval.

CI (GitHub Actions): typecheck, lint, unit, integration (Supabase in Docker),
smoke; E2E on main.

## 12. Delivery process

- Milestones M0-M6 from the spec, each with its own plan in `docs/plans/`, an
  executable acceptance test, and an evidence section. No milestone starts before
  the previous one's acceptance passes.
- Work is dispatched to the dev personas in `.claude/agents/` (architect,
  backend, frontend, agent-runtime, qa-validator, security-reviewer, design) in
  parallel where files do not overlap; the orchestrator reviews and runs the
  validation layer.
- TDD per feature; commit messages carry requirement IDs (`feat(DEC-1): ...`).

## 13. Open decisions (defaults in force until the founder changes them)

| Decision | Default |
| --- | --- |
| Product name / domain | **North** (working name "AI CEO OS" retired) |
| Market and language | Global, English UI; Turkish copy later |
| Prices and credits | Solo $99 (1 company), Pro $299 (3), Scale $999 (10); configurable |
| Durable queue | Inngest |
| Model routing | Opus 5.5 plan/code, Sonnet 5.5 drafting/research, Haiku 5.5 classify/summarise |
| Lead data source | User-uploaded list + web research |
| Legal copy for ads/email | Placeholder until counsel review |
| Worker hosting | Local in dev; Fly.io or Railway in prod (decided in M3) |

## 14. Repository layout

```
North/
├── CLAUDE.md                 # agent instructions (short, pointers)
├── CONTEXT.md                # glossary
├── README.md
├── agents/                   # product agent roles (yaml)
├── .claude/agents/           # dev-team personas
├── docs/
│   ├── SPEC.md               # founder spec (verbatim)
│   ├── research/             # teardown, stack decisions
│   ├── superpowers/specs/    # this design
│   ├── plans/M0..M6.md
│   ├── adr/
│   └── evidence/             # REA captures, screenshots, test reports
├── apps/
│   ├── web/                  # Next.js 16
│   └── worker/               # Inngest agent worker
├── packages/
│   ├── core/                 # pure domain modules
│   ├── db/                   # supabase migrations, types, repositories
│   ├── agents/               # runtime, roles, prompts, tools, fixtures
│   └── integrations/         # provider adapters (+ sandbox)
├── scripts/                  # smoke.ts, seed.ts, validate.sh
└── .github/workflows/ci.yml
```
