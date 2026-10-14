# ADR 0006: pnpm monorepo with `apps/web`, `apps/worker` and pure `packages/core`

Status: accepted (2026-10-14)

## Context

The UI runs well on Vercel; the agent runtime spawns a Claude Code subprocess
and needs a long-lived Node process. The domain rules (authority, quota, ledger)
must be testable without I/O and shared by both.

## Decision

pnpm workspaces: `apps/web` (Next.js 16), `apps/worker` (Node 24 + Inngest
serve + AgentRuntime), `packages/core` (pure TS, no I/O), `packages/db`,
`packages/agents`, `packages/integrations`. One TypeScript base config, one
ESLint config, Vitest per package. No Turborepo until build times demand it.

## Consequences

- `packages/core` can reach ≥90% coverage cheaply and is the home of every rule.
- Two deploy targets (Vercel + a container host) from M3 onward.
- Workspace imports use `@north/<pkg>`.
