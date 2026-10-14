# Stack decisions and pinned versions

Checked against the npm registry on 2026-10-14. Node on this machine: v24.14.1,
pnpm 10.32.1, Playwright 1.64.1 (chromium installed), Docker 28.4, Vercel CLI 50.

| Concern | Choice | Version | Why (and what we verified) |
| --- | --- | --- | --- |
| Web app | Next.js App Router | 16.4.1 | Turbopack default, `proxy.ts` replaces `middleware.ts`, async request APIs only, `next lint` removed (use ESLint CLI), Node ≥20.9, TS ≥5.1 (upgrade guide indexed) |
| React | React | 19.3.1 | Peer of Next 16 |
| Language | TypeScript | 5.9.3 | TS 7 (Go port) is published but we pin 5.9 for ecosystem stability |
| Styling | Tailwind CSS v4 + `@tailwindcss/postcss` | 4.3.3 | CSS-first tokens via `@theme`; matches our design tokens approach |
| Components | shadcn | 4.21.5 (CLI) | Radix primitives, we re-skin to the North design system |
| Auth / DB / storage | Supabase (`@supabase/supabase-js`, `@supabase/ssr`) | 2.117.3 / 0.12.7 | Postgres + RLS + pgvector + Storage + Vault; `getClaims()` in `proxy.ts` per the SSR guide |
| Local DB | Supabase CLI (`supabase start`) | 2.121.0 | Full local stack in Docker for tests; the hosted project's MCP connection is currently failing auth, so local-first is also the safer path |
| Durable jobs | Inngest v4 | 4.24.0 | `createFunction({ triggers: [event|cron()] })`, `step.run`, `step.sleep`, `step.waitForEvent` (decision cards), `cancelOn` (kill switch); Dev Server at :8288 (`INNGEST_DEV=1`) |
| Agent runtime | `@anthropic-ai/claude-agent-sdk` | 0.3.299 | `query()` with in-process MCP tools (`createSdkMcpServer`/`tool`), `hooks` (PreToolUse audit + authority gate), `outputFormat` JSON schema, `maxBudgetUsd`, `settingSources: []`, bundled Claude Code binary; peers zod ^4, `@anthropic-ai/sdk` ≥0.93 |
| Direct model calls | `@anthropic-ai/sdk` | 0.134.0 | Classification, summaries, briefs; model routing per spec |
| Validation | zod | 4.6.7 | Shared by SDK tools and API boundaries |
| Payments | stripe | 23.0.0 | Platform subscriptions and credits (test mode until launch) |
| Email | resend | 6.33.0 | Decision cards, briefs, magic links (Supabase sends auth mail itself) |
| Push | web-push | 3.6.7 | PWA notifications |
| Unit/integration tests | vitest | 5.0.4 | Fast, TS-native |
| E2E / visual validation | @playwright/test | 1.64.1 | Chromium already installed; also used for computer-use style checks |
| Observability | Sentry (`@sentry/nextjs` 11.7), Langfuse 3.39 | optional | Added in M5; cost tracking starts with our own `agent_runs` table from day one |
| Config files | yaml | 2.9.1 | `agents/*.yaml` role definitions |

## Models (per the claude-api skill, cached 2026-10-06)

- Planning, Chief of Staff, Strategy, Engineering: `claude-opus-5-5` (default), adaptive thinking, effort `high`; `xhigh` for engineering tasks.
- Research, Growth, Sales drafting: `claude-sonnet-5-5`.
- Classification, summaries, signal scoring, brief compression: `claude-haiku-5-5`.
- All model IDs are configuration (`packages/core/src/models.ts`), never hard-coded in call sites.

## Rejected alternatives

- **Python backend (as in the PolsiaAI reference repo)**: one language keeps the
  Engineering agent, the app and the tests in the same stack; the Agent SDK is
  first-class in TypeScript.
- **Celery/Redis**: Inngest gives durable, resumable runs and `waitForEvent`,
  which maps one-to-one onto decision cards; no infra to run.
- **Drizzle/Prisma ORM**: SQL migrations through the Supabase CLI are the source
  of truth; generated types (`supabase gen types`) give end-to-end typing with
  no second schema.
- **Claude Managed Agents for every task**: kept as a later adapter behind the
  `AgentRuntime` interface; the Agent SDK runs locally today without extra beta
  access and supports a deterministic mock for tests.
